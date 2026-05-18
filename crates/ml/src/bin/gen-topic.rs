//! Pure-Rust owner-only "topic deep-dive" generator — a sibling of
//! `gen-app-prep.rs` / `gen-article.rs`. One LLM call produces an in-depth
//! GFM study guide for a single technical topic; the artifact is reshaped by
//! `lib/topic-seed.ts` (`getTopicSeed`) and rendered at an owner-gated route
//! (e.g. `/module-federation`).
//!
//!   cd crates/ml && cargo run -p aer-ml --release --bin gen-topic -- \
//!       --topic "Webpack Module Federation" \
//!       --slug module-federation [--no-write]
//!
//! Output: `<out-dir>/<slug>.json` with { slug, title, body, generatedAt }.

use std::path::PathBuf;

use aer_ml::server::{
    graphs::{ask, msg},
    llm,
};
use clap::Parser;
use serde_json::json;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "gen-topic")]
struct Args {
    /// Human-readable topic, e.g. "Webpack Module Federation".
    #[arg(long)]
    topic: String,
    /// URL slug; defaults to toSlug(topic) (port of lib/slug.ts).
    #[arg(long)]
    slug: Option<String>,
    /// Output directory for <slug>.json.
    #[arg(long, default_value = "../../data/topics")]
    out_dir: PathBuf,
    /// Print the artifact instead of writing it.
    #[arg(long)]
    no_write: bool,
}

/// Rust port of `lib/slug.ts::toSlug` — byte-identical with the TS impl and
/// with `gen-app-prep.rs::to_slug` (kept local per that bin's convention):
/// lowercase → drop `[^a-z0-9\s-]` → whitespace runs to `-` → collapse `-+`
/// → trim leading/trailing `-`.
fn to_slug(input: &str) -> String {
    let lower = input.to_lowercase();
    let kept: String = lower
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || c.is_whitespace())
        .collect();

    let mut out = String::with_capacity(kept.len());
    let mut prev_dash = false;
    for ch in kept.chars() {
        let is_sep = ch == '-' || ch.is_whitespace();
        if is_sep {
            if !prev_dash {
                out.push('-');
            }
            prev_dash = true;
        } else {
            out.push(ch);
            prev_dash = false;
        }
    }
    out.trim_matches('-').to_string()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let args = Args::parse();

    let slug = args
        .slug
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| to_slug(&args.topic));
    anyhow::ensure!(!slug.is_empty(), "empty slug");

    let cfg = llm::LlmConfig::from_env();
    let client = llm::reqwest_client(&cfg);

    let sys = "You are a principal frontend architect writing an in-depth, \
technically precise study guide for an experienced engineer preparing for a \
senior interview. Write in GitHub-Flavored Markdown. Begin with a single \
`# <Title>` H1, then `##` sections. Use fenced code blocks with language tags \
for configuration and code, and tables where they clarify. Be concrete and \
correct (real APIs, real option names, real failure modes); no marketing, no \
filler. Cover, in this order: (1) what it is and the problem it solves; \
(2) host vs remote and the `exposes` / `remotes` / `shared` model; (3) a \
worked Webpack 5 `ModuleFederationPlugin` host+remote example; (4) shared \
dependencies — singletons, `requiredVersion`, `strictVersion`, eager vs lazy, \
and runtime version-skew failures; (5) dynamic / runtime remotes (loading \
remotes at runtime, `init`/`get`); (6) micro-frontend architecture — team and \
deployment boundaries, independent deploys, contract/versioning strategy; \
(7) failure modes & pitfalls (singleton mismatch, duplicate React, eager \
consumption errors, CSS leakage, sharing types); (8) testing & deployment \
(CI, contract tests, canary, graceful fallback when a remote is down); \
(9) Module Federation across Webpack 5 vs Rspack vs Vite \
(`@module-federation/vite`); (10) an `## Interview Q&A` section with about 8 \
senior-level question/answer pairs. Close with a short section applying it to \
a regulated supervisory dashboard (a 'cockpit') split across multiple teams.";
    let user = format!(
        "Topic: {}\n\nWrite the complete study guide now.",
        args.topic
    );

    println!("Generating topic deep-dive: {}  (slug={slug})", args.topic);
    println!();

    let body = ask(
        &client,
        &cfg.model,
        cfg.temperature,
        vec![msg("system", sys), msg("user", user)],
    )
    .await?;

    anyhow::ensure!(!body.trim().is_empty(), "LLM returned an empty study guide");

    let artifact = json!({
        "slug": slug,
        "title": args.topic,
        "body": body,
        "generatedAt": chrono::Utc::now().to_rfc3339(),
    });

    if args.no_write {
        println!("{}", serde_json::to_string_pretty(&artifact)?);
    } else {
        std::fs::create_dir_all(&args.out_dir)?;
        let out_path = args.out_dir.join(format!("{slug}.json"));
        std::fs::write(&out_path, serde_json::to_string_pretty(&artifact)?)?;
        println!("Wrote {}", out_path.display());
    }

    println!("Done! body={} chars", body.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::to_slug;

    #[test]
    fn topic_slug_matches_route() {
        // The default-slug path must equal the live route segment exactly, or
        // the topic seed loader never matches.
        assert_eq!(to_slug("Module Federation"), "module-federation");
        assert_eq!(
            to_slug("Webpack Module Federation"),
            "webpack-module-federation"
        );
    }
}
