//! fetch-article: pull a public web article into a clean markdown-ish
//! grounding file, reusing the browser-like `udemy::crawler` HTTP client
//! (retries, gzip/brotli, Cloudflare detection) and the `scraper` HTML
//! parser already vendored for the course parsers.
//!
//! It is intentionally a *grounding* extractor, not a faithful HTML→MD
//! converter: the output is read by a human author to enrich a lesson, so
//! "good enough, attributed, reproducible" beats pixel-perfect.
//!
//!   cd crates/ml && cargo run -p aer-ml --release --bin fetch-article -- \
//!     --url https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html \
//!     --out ../../data/sources/fowler-sdd-3-tools.md

use std::path::PathBuf;

use aer_ml::udemy::crawler::{CrawlConfig, FetchResult, UdemyClient};
use anyhow::{bail, Context, Result};
use clap::Parser;
use scraper::{ElementRef, Html, Selector};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "fetch-article")]
struct Args {
    /// Article URL to fetch.
    #[arg(long)]
    url: String,
    /// Markdown-ish output file (parent dirs are created).
    #[arg(long)]
    out: PathBuf,
}

/// Collapse runs of whitespace to single spaces and trim.
fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// First element matching any of `sels` (document order within the doc).
fn first<'a>(doc: &'a Html, sels: &[&str]) -> Option<ElementRef<'a>> {
    for s in sels {
        if let Ok(sel) = Selector::parse(s) {
            if let Some(el) = doc.select(&sel).next() {
                return Some(el);
            }
        }
    }
    None
}

/// Walk a content root in document order, projecting block elements to a
/// markdown-ish line. Nested blocks are tolerated (a little duplication is
/// fine for grounding text).
fn extract_blocks(root: ElementRef<'_>) -> String {
    let sel = Selector::parse("h1, h2, h3, h4, p, li, pre, blockquote")
        .expect("static selector");
    let mut out: Vec<String> = Vec::new();
    let mut last = String::new();
    for el in root.select(&sel) {
        let text = norm(&el.text().collect::<String>());
        if text.is_empty() || text == last {
            continue;
        }
        last = text.clone();
        let line = match el.value().name() {
            "h1" => format!("# {text}"),
            "h2" => format!("## {text}"),
            "h3" => format!("### {text}"),
            "h4" => format!("#### {text}"),
            "li" => format!("- {text}"),
            "blockquote" => format!("> {text}"),
            "pre" => format!("```\n{text}\n```"),
            _ => text,
        };
        out.push(line);
    }
    out.join("\n\n")
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();
    let args = Args::parse();

    let client = UdemyClient::new(&CrawlConfig::default())
        .context("build HTTP client")?;
    let html = match client.fetch_page(&args.url).await {
        FetchResult::Ok(body) => body,
        FetchResult::CloudflareBlocked => {
            bail!("{} is behind a Cloudflare challenge — cannot fetch headlessly", args.url)
        }
        FetchResult::HttpError(code, _) => bail!("HTTP {code} fetching {}", args.url),
        FetchResult::ConnectionError(e) => bail!("connection error fetching {}: {e}", args.url),
    };

    let doc = Html::parse_document(&html);
    let title = first(&doc, &["h1", "title"])
        .map(|el| norm(&el.text().collect::<String>()))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| args.url.clone());
    let root = first(&doc, &["article", "main", "[role=\"main\"]", "body"])
        .context("no article/main/body element in the page")?;
    let body = extract_blocks(root);
    if body.split_whitespace().count() < 100 {
        bail!(
            "extracted only {} words from {} — page shape unexpected",
            body.split_whitespace().count(),
            args.url
        );
    }

    if let Some(parent) = args.out.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }
    let stamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let doc_out = format!(
        "<!-- Grounding extract. Source: {}\n     Fetched: {} via `fetch-article` (reuses udemy::crawler).\n     Not a verbatim copy — attribute & cite the original. -->\n\n# {}\n\nSource: {}\n\n{}\n",
        args.url, stamp, title, args.url, body
    );
    std::fs::write(&args.out, doc_out).with_context(|| format!("write {}", args.out.display()))?;
    tracing::info!(
        "Wrote {} ({} words) from {}",
        args.out.display(),
        body.split_whitespace().count(),
        args.url
    );
    Ok(())
}
