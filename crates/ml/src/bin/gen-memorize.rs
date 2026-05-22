//! `gen-memorize` — full-Rust replacement for the deleted
//! `POST /api/applications/[id]/memorize/generate` route + the
//! knowledge-server `memorize_generate` graph.
//!
//! Resolves an `applications` row by slug, runs `memorize::run` in-process
//! (plain DeepSeek orchestration — no server), then writes the same two
//! places the old route did: upserts each item into `concepts` and stores
//! the categories JSON in `applications.memorize_categories` (Cloudflare D1
//! over the HTTP API — see `aer_ml::d1::D1Client`).
//!
//!   DEEPSEEK_API_KEY=… CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_AUDIO_D1_ID=… \
//!   CLOUDFLARE_D1_API_TOKEN=… \
//!     cargo run -p aer-ml --release --bin gen-memorize -- --slug <slug>

use aer_ml::d1::D1Client;
use aer_ml::server::{graphs::memorize, llm};
use anyhow::Context;
use clap::Parser;
use serde_json::{json, Value};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

#[derive(Parser)]
#[command(name = "gen-memorize")]
struct Args {
    /// Application slug.
    #[arg(long, default_value = "european-central-bank-ssm-cockpit-developer")]
    slug: String,
    /// Disambiguate when several `applications` rows share the slug.
    #[arg(long)]
    user_id: Option<String>,
    /// Regenerate even if `memorize_categories` is already set.
    #[arg(long)]
    force: bool,
    /// Generate + print only; skip the D1 writes.
    #[arg(long)]
    no_db: bool,
}

/// Read a string column from a D1 JSON result row.
fn col(row: &Value, k: &str) -> Option<String> {
    row.get(k).and_then(Value::as_str).map(String::from)
}

fn parse_tech_stack(s: Option<&str>) -> Vec<Value> {
    s.and_then(|s| serde_json::from_str::<Value>(s).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
}

fn filter_dismissed(techs: Vec<Value>, dismissed: Option<&str>) -> Vec<Value> {
    let set: std::collections::HashSet<String> = dismissed
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|t| t.to_lowercase())
        .collect();
    if set.is_empty() {
        return techs;
    }
    techs
        .into_iter()
        .filter(|t| {
            let tag = t.get("tag").and_then(Value::as_str).unwrap_or("");
            !set.contains(&tag.to_lowercase())
        })
        .collect()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with_writer(std::io::stderr)
        .init();
    let args = Args::parse();

    let d1 = D1Client::from_env()?
        .context("D1 env vars (CLOUDFLARE_ACCOUNT_ID/_AUDIO_D1_ID/_D1_API_TOKEN) not set")?;

    let rows = d1
        .query_rows(
            "SELECT id, user_id, company, position, tech_stack, \
             tech_dismissed_tags, memorize_categories \
             FROM applications WHERE slug = ?",
            vec![json!(args.slug)],
        )
        .await?;
    anyhow::ensure!(!rows.is_empty(), "no applications row for slug {:?}", args.slug);

    let row = if rows.len() > 1 {
        let uid = args.user_id.clone().ok_or_else(|| {
            for r in &rows {
                eprintln!(
                    "  user-id={} id={}",
                    col(r, "user_id").unwrap_or_default(),
                    col(r, "id").unwrap_or_default(),
                );
            }
            anyhow::anyhow!("{} rows match slug {:?}; pass --user-id", rows.len(), args.slug)
        })?;
        rows.into_iter()
            .find(|r| col(r, "user_id").as_deref() == Some(uid.as_str()))
            .ok_or_else(|| anyhow::anyhow!("no row for slug {:?} user-id {:?}", args.slug, uid))?
    } else {
        rows.into_iter().next().unwrap()
    };

    let id: String = col(&row, "id").context("row missing id")?;
    let company: String = col(&row, "company").unwrap_or_default();
    let position: String = col(&row, "position").unwrap_or_default();
    let tech_stack: Option<String> = col(&row, "tech_stack");
    let dismissed: Option<String> = col(&row, "tech_dismissed_tags");
    let existing: Option<String> = col(&row, "memorize_categories");

    if existing.as_deref().map_or(false, |s| !s.trim().is_empty()) && !args.force {
        println!("memorize_categories already set for {} — use --force to regenerate.", args.slug);
        return Ok(());
    }

    let techs = filter_dismissed(parse_tech_stack(tech_stack.as_deref()), dismissed.as_deref());
    anyhow::ensure!(
        !techs.is_empty(),
        "no tech stack for {:?} (run prep first / all dismissed)",
        args.slug
    );
    println!("==> {} — {position} @ {company}: {} techs", args.slug, techs.len());

    let cfg = llm::LlmConfig::from_env();
    let client = llm::reqwest_client(&cfg);
    let result = memorize::run(
        json!({ "company": company, "position": position, "techs": techs }),
        &client,
        &cfg.model,
        cfg.temperature,
    )
    .await
    .context("memorize::run")?;

    let categories = result
        .get("categories")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let item_count: usize = categories
        .iter()
        .filter_map(|c| c.get("items").and_then(Value::as_array))
        .map(Vec::len)
        .sum();
    anyhow::ensure!(
        !categories.is_empty() && item_count > 0,
        "memorize produced no items"
    );
    println!(
        "==> generated {} categories, {item_count} items",
        categories.len()
    );

    if args.no_db {
        println!("{}", serde_json::to_string_pretty(&Value::Array(categories))?);
        println!("--no-db: skipping D1 writes.");
        return Ok(());
    }

    // Mirror the old route: upsert each item into `concepts`, then store the
    // categories JSON on the applications row.
    let mut upserts = 0usize;
    for cat in &categories {
        let items = cat.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
        for item in &items {
            let item_id = item.get("id").and_then(Value::as_str).unwrap_or("");
            if item_id.is_empty() {
                continue;
            }
            let name = format!("app:{id}:{item_id}");
            let description = item.get("description").and_then(Value::as_str).unwrap_or("");
            let metadata = json!({
                "term": item.get("term").cloned().unwrap_or(Value::Null),
                "details": item.get("details").cloned().unwrap_or(Value::Null),
                "context": item.get("context").cloned().unwrap_or(Value::Null),
                "relatedItems": item.get("relatedItems").cloned().unwrap_or(Value::Null),
                "mnemonicHint": item.get("mnemonicHint").cloned().unwrap_or(Value::Null),
            })
            .to_string();
            d1.exec(
                "INSERT INTO concepts (id, name, description, concept_type, metadata, created_at) \
                 VALUES (?, ?, ?, 'skill', ?, unixepoch()) \
                 ON CONFLICT (name) DO UPDATE SET \
                   description = excluded.description, metadata = excluded.metadata",
                vec![
                    json!(Uuid::new_v4().to_string()),
                    json!(name),
                    json!(description),
                    json!(metadata),
                ],
            )
            .await
            .with_context(|| format!("upsert concept {name}"))?;
            upserts += 1;
        }
    }

    d1.exec(
        "UPDATE applications SET memorize_categories = ?, updated_at = unixepoch() \
         WHERE id = ?",
        vec![
            json!(serde_json::to_string(&Value::Array(categories.clone()))?),
            json!(id),
        ],
    )
    .await
    .context("UPDATE applications.memorize_categories")?;

    println!(
        "✓ D1 updated: id={id} slug={} — {} concepts upserted, memorize_categories set ({} categories)",
        args.slug, upserts, categories.len()
    );
    Ok(())
}
