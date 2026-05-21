//! Mirror the already-produced content artifacts into Cloudflare D1 so the app
//! can serve them at request time (new/edited content shows on refresh, no
//! redeploy). Publishes existing files only — no recompute, mirroring the R2
//! `upload_dir` helper.
//!
//!   data/content/index.json   -> content_cache(kind='index', slug='__index__')
//!   data/content/<slug>.json  -> content_cache(kind='lesson', slug=<slug>)   (driven by the index)
//!   data/audio/<slug>.json    -> content_cache(kind='audio',  slug=<slug>)   (script + metadata)
//!
//! Usage:  cargo run -p aer-ml --release --bin sync-d1
//! Env:    CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AUDIO_D1_ID, CLOUDFLARE_D1_API_TOKEN
//!         (loaded from the app `.env.local`; missing => no-op).
//! Opt:    KNOWLEDGE_AUDIO_MANIFEST_DIR — dir of real-audio manifests (knowledge_tts
//!         output / R2 mirror). When a `<slug>.json` exists there, its per-chapter
//!         audio_url/file_size_bytes + top-level voice/audio_url are overlaid onto
//!         the script-bearing guide so the D1 row carries both text and audio.

use std::path::{Path, PathBuf};

use aer_ml::d1::D1Client;
use anyhow::{Context, Result};
use serde_json::Value;

fn app_root() -> PathBuf {
    // CARGO_MANIFEST_DIR = <app>/crates/ml ; the app root is two levels up.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

#[tokio::main]
async fn main() -> Result<()> {
    let root = app_root();
    // Load creds from the app env files (best-effort).
    let _ = dotenvy::from_path(root.join(".env.local"));
    let _ = dotenvy::from_path(root.join(".env"));

    let client = match D1Client::from_env()? {
        Some(c) => c,
        None => {
            eprintln!("sync-d1: D1 not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AUDIO_D1_ID / CLOUDFLARE_D1_API_TOKEN) — skipping.");
            return Ok(());
        }
    };
    client.ensure_table().await.context("ensure content_cache table")?;

    let content_dir = root.join("data/content");
    let audio_dir = root.join("data/audio");
    let manifest_dir = std::env::var("KNOWLEDGE_AUDIO_MANIFEST_DIR")
        .ok()
        .map(PathBuf::from);

    let mut lessons = 0usize;
    let mut audios = 0usize;
    let mut audio_slugs: Vec<String> = Vec::new();

    // --- index + lessons -------------------------------------------------
    let index_path = content_dir.join("index.json");
    if index_path.exists() {
        let raw = std::fs::read_to_string(&index_path)
            .with_context(|| format!("read {}", index_path.display()))?;
        client.upsert("index", "__index__", &raw).await.context("upsert index")?;
        eprintln!("  index __index__ ({} bytes)", raw.len());

        let index: Value = serde_json::from_str(&raw).context("parse index.json")?;
        if let Some(arr) = index.get("lessons").and_then(|l| l.as_array()) {
            for lesson in arr {
                let Some(slug) = lesson.get("slug").and_then(|s| s.as_str()) else {
                    continue;
                };
                let file = content_dir.join(format!("{slug}.json"));
                if !file.exists() {
                    eprintln!("  SKIP lesson {slug}: {} missing", file.display());
                    continue;
                }
                let body = std::fs::read_to_string(&file)
                    .with_context(|| format!("read {}", file.display()))?;
                client.upsert("lesson", slug, &body).await.with_context(|| format!("upsert lesson {slug}"))?;
                lessons += 1;
                eprintln!("  lesson {slug} ({} bytes)", body.len());
            }
        }
    } else {
        eprintln!("  no {} — skipping lessons", index_path.display());
    }

    // --- audio guides ----------------------------------------------------
    if audio_dir.exists() {
        let mut entries: Vec<_> = std::fs::read_dir(&audio_dir)
            .with_context(|| format!("read dir {}", audio_dir.display()))?
            .flatten()
            .filter(|e| e.path().extension().map_or(false, |x| x == "json"))
            .collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let slug = entry.path().file_stem().unwrap().to_string_lossy().into_owned();
            let raw = std::fs::read_to_string(entry.path())
                .with_context(|| format!("read {}", entry.path().display()))?;
            let mut meta: Value = serde_json::from_str(&raw)
                .with_context(|| format!("parse {}", entry.path().display()))?;

            if let Some(dir) = &manifest_dir {
                let mpath = dir.join(format!("{slug}.json"));
                if mpath.exists() {
                    if let Ok(mraw) = std::fs::read_to_string(&mpath) {
                        if let Ok(audio) = serde_json::from_str::<Value>(&mraw) {
                            merge_audio(&mut meta, &audio);
                        }
                    }
                }
            }

            let payload = serde_json::to_string(&meta)?;
            client.upsert("audio", &slug, &payload).await.with_context(|| format!("upsert audio {slug}"))?;
            audios += 1;
            eprintln!("  audio {slug} ({} bytes)", payload.len());
            audio_slugs.push(slug);
        }
    } else {
        eprintln!("  no {} — skipping audio", audio_dir.display());
    }

    eprintln!("\nsync-d1: done — {lessons} lessons, {audios} audio guides, 1 index.");

    // On-demand revalidation: bust the live page's tagged R2 fetch so updates
    // show in seconds instead of waiting out the revalidate:3600 TTL. Best-effort
    // — runs only when REVALIDATE_URL + WORKER_AUTH_SECRET are set; never fails the sync.
    revalidate(&audio_slugs).await;

    Ok(())
}

/// POST `audio:<slug>` tags to the app's /api/revalidate route (bearer-authed).
/// No-op if REVALIDATE_URL / WORKER_AUTH_SECRET are unset; logs on failure.
async fn revalidate(audio_slugs: &[String]) {
    let (url, secret) = match (
        std::env::var("REVALIDATE_URL").ok().filter(|v| !v.is_empty()),
        std::env::var("WORKER_AUTH_SECRET").ok().filter(|v| !v.is_empty()),
    ) {
        (Some(u), Some(s)) => (u, s),
        _ => {
            eprintln!("revalidate: skipped (REVALIDATE_URL / WORKER_AUTH_SECRET unset)");
            return;
        }
    };
    if audio_slugs.is_empty() {
        return;
    }
    let tags: Vec<String> = audio_slugs.iter().map(|s| format!("audio:{s}")).collect();
    let body = serde_json::json!({ "tags": tags });
    let client = reqwest::Client::new();
    match client
        .post(&url)
        .bearer_auth(&secret)
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if status.is_success() {
                eprintln!("revalidate: {} tags → {status} {text}", tags.len());
            } else {
                eprintln!("revalidate: FAILED {status} {text}");
            }
        }
        Err(e) => eprintln!("revalidate: request error: {e}"),
    }
}

/// Overlay real-audio fields from a knowledge_tts/R2 manifest (`audio`) onto a
/// script-bearing guide (`base`), matching chapters by index. `base` keeps its
/// `script`/`full_script`; `audio` supplies `audio_url`/`file_size_bytes`/voice.
fn merge_audio(base: &mut Value, audio: &Value) {
    for key in ["voice", "audio_url", "duration_secs", "file_size_bytes"] {
        if let Some(v) = audio.get(key) {
            if let Some(obj) = base.as_object_mut() {
                obj.insert(key.to_string(), v.clone());
            }
        }
    }
    let Some(src) = audio.get("chapters").and_then(|c| c.as_array()) else {
        return;
    };
    let Some(dst) = base.get_mut("chapters").and_then(|c| c.as_array_mut()) else {
        return;
    };
    for ch in dst.iter_mut() {
        let idx = ch.get("index").and_then(|i| i.as_u64());
        if let Some(s) = src.iter().find(|s| s.get("index").and_then(|i| i.as_u64()) == idx) {
            if let Some(obj) = ch.as_object_mut() {
                for key in ["audio_url", "file_size_bytes", "duration_secs", "start_secs"] {
                    if let Some(v) = s.get(key) {
                        obj.insert(key.to_string(), v.clone());
                    }
                }
            }
        }
    }
}
