//! spotify-podcasts — seed the /rag "RAG Podcasts" rail from the Spotify Web
//! API (client-credentials flow). Mirrors the provider-seed pattern of the
//! `udemy` bin: fetch → relevance-filter → write JSON the frontend reads.
//!
//!   cd crates/ml && cargo run -p aer-ml --release --bin spotify-podcasts --
//!
//! Required env (workspace-root `.env` or app `.env.local`, looked up via
//! dotenvy — same convention as build-audio-guide's DEEPSEEK_API_KEY):
//!   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET   (free Spotify developer app)
//!
//! Writes ../../data/content/rag-podcasts.json — an array of RagPodcast
//! (shape mirrors lib/db/podcasts.ts). The file is shipped to the serverless
//! bundle via next.config.ts `outputFileTracingIncludes` ("./data/content/**")
//! and survives `export-content` (which only writes the files it owns).
//!
//! The relevance filter is a Rust port of the hoa Spotify pipeline
//! (apps/hoa/backend/spotify_podcast_search.py:278-329): drop compilation /
//! "best of" episodes and require a genuine RAG/AI signal in title+desc.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "spotify-podcasts", about = "Seed the /rag Spotify podcast rail")]
struct Args {
    /// Output JSON (read by lib/db/podcasts.ts).
    #[arg(long, default_value = "../../data/content/rag-podcasts.json")]
    out: PathBuf,
    /// Episodes requested per search query (Spotify caps at 50).
    #[arg(long, default_value_t = 50)]
    limit_per_query: u32,
    /// Max episodes kept in the final rail (sorted by relevance desc).
    #[arg(long, default_value_t = 25)]
    max: usize,
    /// Spotify market for episode availability.
    #[arg(long, default_value = "US")]
    market: String,
    #[arg(long, env = "SPOTIFY_CLIENT_ID", default_value = "")]
    client_id: String,
    #[arg(long, env = "SPOTIFY_CLIENT_SECRET", default_value = "")]
    client_secret: String,
}

/// Search queries derived from the 8 Phase-3 RAG lessons (rag, embeddings,
/// embedding-models, vector-databases, chunking-strategies,
/// retrieval-strategies, advanced-rag, rag-evaluation) plus adjacent terms.
const QUERIES: &[&str] = &[
    "retrieval augmented generation RAG explained",
    "RAG pipeline for LLM engineers",
    "vector databases and embeddings",
    "semantic search vector search",
    "chunking strategies document retrieval RAG",
    "reranking hybrid search retrieval",
    "RAG evaluation metrics RAGAS",
    "advanced RAG agentic RAG GraphRAG",
    "embedding models sentence transformers",
    "LlamaIndex LangChain RAG application",
    "building RAG over your documents",
    "production RAG systems",
];

/// RAG/AI signal terms (lowercase). Presence in title/description marks a
/// genuine topic match; absence on a thin description rejects the episode.
const RAG_TERMS: &[&str] = &[
    "rag", "retrieval augmented", "retrieval-augmented", "retrieval",
    "vector database", "vector search", "vector db", "embedding", "embeddings",
    "semantic search", "chunk", "chunking", "rerank", "reranking",
    "hybrid search", "llamaindex", "langchain", "pinecone", "weaviate",
    "qdrant", "chroma", "pgvector", "knowledge base", "graphrag",
    "llm", "large language model", "generative ai", "knowledge graph",
];

static COMPILATION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)best\s+(of|moments)|highlights|year\s+in\s+review|top\s+episodes|distilled|recap|roundup|round-up|greatest\s+hits",
    )
    .expect("valid compilation regex")
});

// ── Spotify API response shapes (lenient: serde defaults everywhere) ───────

#[derive(Deserialize)]
struct TokenResp {
    access_token: String,
}

#[derive(Deserialize)]
struct SearchResp {
    #[serde(default)]
    episodes: Episodes,
}

#[derive(Deserialize, Default)]
struct Episodes {
    #[serde(default)]
    items: Vec<EpisodeItem>,
}

#[derive(Deserialize)]
struct EpisodeItem {
    // Episodes can come back as JSON null inside items — Option guards that.
    id: Option<String>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    release_date: String,
    #[serde(default)]
    release_date_precision: String,
    #[serde(default)]
    images: Vec<Image>,
    #[serde(default)]
    external_urls: ExternalUrls,
    #[serde(default)]
    show: Show,
}

#[derive(Deserialize, Default)]
struct Image {
    #[serde(default)]
    url: String,
}

#[derive(Deserialize, Default)]
struct ExternalUrls {
    #[serde(default)]
    spotify: String,
}

#[derive(Deserialize, Default)]
struct Show {
    #[serde(default)]
    name: String,
    #[serde(default)]
    publisher: String,
}

// ── Output shape — mirrors RagPodcast in lib/db/podcasts.ts ────────────────

#[derive(Serialize)]
struct RagPodcast {
    id: String,
    title: String,
    show: String,
    publisher: Option<String>,
    url: String,
    #[serde(rename = "imageUrl")]
    image_url: Option<String>,
    description: Option<String>,
    #[serde(rename = "durationMin")]
    duration_min: u64,
    #[serde(rename = "releaseDate")]
    release_date: String,
    relevance: f64,
}

/// Load SPOTIFY_* from the workspace-root `.env` / app `.env.local` if not
/// already in the process env. Same candidate list as build-audio-guide.
fn load_env() {
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../../.env"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../.env"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.env.local"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.env.local"),
    ];
    for path in &candidates {
        if path.exists() {
            let _ = dotenvy::from_filename(path);
        }
    }
}

/// Normalize Spotify's variable-precision release_date to ISO YYYY-MM-DD.
fn normalize_date(raw: &str, precision: &str) -> String {
    match precision {
        "year" if raw.len() == 4 => format!("{raw}-01-01"),
        "month" if raw.len() == 7 => format!("{raw}-01"),
        _ => raw.to_string(),
    }
}

/// hoa-ported relevance gate + score. Returns None to reject the episode,
/// else a score (RAG-term hits, title-weighted, + a small recency bonus).
fn relevance(title: &str, desc: &str, release_date: &str) -> Option<f64> {
    let t = title.to_lowercase();
    let d = desc.to_lowercase();
    let combined = format!("{t} {d}");

    // Rule: a trivially short / empty description with no RAG signal is most
    // likely an unrelated episode that merely matched a keyword.
    let desc_trivial = desc.trim().len() <= title.trim().len() + 20;
    let any_term = RAG_TERMS.iter().any(|term| combined.contains(term));
    if desc_trivial && !any_term {
        return None;
    }
    if !any_term {
        return None;
    }
    // Compilation / "best of" episodes are recaps, not topic episodes.
    if COMPILATION_RE.is_match(&t) {
        return None;
    }

    let title_hits = RAG_TERMS.iter().filter(|term| t.contains(*term)).count();
    let desc_hits = RAG_TERMS.iter().filter(|term| d.contains(*term)).count();
    let mut score = (title_hits as f64) * 2.0 + (desc_hits as f64);

    // Recency bonus: newer episodes float up within the same topical weight.
    if let Some(year) = release_date.get(0..4).and_then(|y| y.parse::<i32>().ok()) {
        score += ((year - 2020).max(0) as f64) * 0.15;
    }
    Some(score)
}

async fn get_token(client: &reqwest::Client, id: &str, secret: &str) -> Result<String> {
    let resp = client
        .post("https://accounts.spotify.com/api/token")
        .basic_auth(id, Some(secret))
        .form(&[("grant_type", "client_credentials")])
        .send()
        .await
        .context("token request failed")?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("Spotify token endpoint returned {status}: {body}");
    }
    Ok(serde_json::from_str::<TokenResp>(&body)
        .context("parse token response")?
        .access_token)
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    load_env();
    let args = Args::parse();

    if args.client_id.is_empty() || args.client_secret.is_empty() {
        anyhow::bail!(
            "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set — add them to \
             the monorepo-root .env or apps/ai-engineer-roadmap/.env.local \
             (create a free app at developer.spotify.com)."
        );
    }

    let client = reqwest::Client::builder()
        .user_agent("ai-engineer-roadmap/spotify-podcasts")
        .build()?;
    let token = get_token(&client, &args.client_id, &args.client_secret).await?;

    // Dedupe by episode id, keeping the highest score seen across queries.
    let mut best: HashMap<String, RagPodcast> = HashMap::new();
    for q in QUERIES {
        let resp = client
            .get("https://api.spotify.com/v1/search")
            .bearer_auth(&token)
            .query(&[
                ("q", *q),
                ("type", "episode"),
                ("market", args.market.as_str()),
                ("limit", &args.limit_per_query.to_string()),
            ])
            .send()
            .await
            .with_context(|| format!("search failed for {q:?}"))?;
        if !resp.status().is_success() {
            tracing::warn!("query {q:?} → HTTP {}", resp.status());
            continue;
        }
        let parsed: SearchResp = resp.json().await.with_context(|| format!("parse {q:?}"))?;
        for it in parsed.episodes.items {
            let Some(id) = it.id.filter(|s| !s.is_empty()) else { continue };
            let Some(score) = relevance(&it.name, &it.description, &it.release_date) else {
                continue;
            };
            if best.get(&id).map(|p| p.relevance).unwrap_or(f64::MIN) >= score {
                continue;
            }
            let release_date = normalize_date(&it.release_date, &it.release_date_precision);
            let url = if it.external_urls.spotify.is_empty() {
                format!("https://open.spotify.com/episode/{id}")
            } else {
                it.external_urls.spotify.clone()
            };
            let mut description = it.description.trim().replace(['\n', '\r'], " ");
            if description.chars().count() > 320 {
                description = description.chars().take(317).collect::<String>() + "…";
            }
            best.insert(
                id.clone(),
                RagPodcast {
                    id,
                    title: it.name.trim().to_string(),
                    show: it.show.name.trim().to_string(),
                    publisher: (!it.show.publisher.trim().is_empty())
                        .then(|| it.show.publisher.trim().to_string()),
                    url,
                    image_url: it
                        .images
                        .first()
                        .map(|i| i.url.clone())
                        .filter(|u| !u.is_empty()),
                    description: (!description.is_empty()).then_some(description),
                    duration_min: (it.duration_ms as f64 / 60_000.0).round() as u64,
                    release_date,
                    relevance: score,
                },
            );
        }
    }

    let mut episodes: Vec<RagPodcast> = best.into_values().collect();
    episodes.sort_by(|a, b| {
        b.relevance
            .partial_cmp(&a.relevance)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.release_date.cmp(&a.release_date))
    });
    episodes.truncate(args.max);

    if episodes.is_empty() {
        anyhow::bail!("no relevant episodes found — refusing to overwrite {} with []", args.out.display());
    }

    if let Some(parent) = args.out.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&args.out, serde_json::to_vec_pretty(&episodes)?)?;
    tracing::info!("wrote {} episodes → {}", episodes.len(), args.out.display());
    println!(
        "Seeded {} RAG podcast episodes → {}",
        episodes.len(),
        args.out.display()
    );
    Ok(())
}
