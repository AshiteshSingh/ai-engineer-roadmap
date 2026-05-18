//! Pure-Rust job-application interview-prep generator — a CLI front-end for the
//! in-process `app_prep` graph (the same graph the Next.js UI drives via the
//! backend server). Mirrors `gen-article.rs`: resolve the env LLM config, run
//! the graph in-process, write a committed JSON artifact.
//!
//!   cd crates/ml && cargo run -p aer-ml --release --bin gen-app-prep -- \
//!       --company "European Central Bank" \
//!       --position "SSM Cockpit Developer" \
//!       --slug european-central-bank-ssm-cockpit-developer [--no-write]
//!
//! `app_prep::run` returns empty when `job_description` is blank, so when no
//! `--jd`/`--jd-file` is given we synthesize a realistic role brief from the
//! company + position with one LLM call and feed that in ("title only" input).
//! Output: `<out-dir>/<slug>.json` with the fields the prep page's seed loader
//! reshapes into `AppData` (`techStack` is a JSON **string**, matching the DB
//! column and `JSON.stringify(result.tech_stack)` in the prep API route).

use std::path::PathBuf;

use aer_ml::server::{
    graphs::{app_prep, ask, msg},
    llm,
};
use clap::Parser;
use serde_json::json;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "gen-app-prep")]
struct Args {
    /// Company name, e.g. "European Central Bank".
    #[arg(long)]
    company: String,
    /// Role title, e.g. "SSM Cockpit Developer".
    #[arg(long)]
    position: String,
    /// URL slug; defaults to toSlug("{company}-{position}") (port of lib/slug.ts).
    #[arg(long)]
    slug: Option<String>,
    /// Job-description text; used verbatim (no synthesis) when set.
    #[arg(long)]
    jd: Option<String>,
    /// Path to a job-description file (takes precedence over --jd).
    #[arg(long)]
    jd_file: Option<PathBuf>,
    /// Public job-posting URL to record in the artifact.
    #[arg(long)]
    url: Option<String>,
    /// Output directory for <slug>.json.
    #[arg(long, default_value = "../../data/app-prep")]
    out_dir: PathBuf,
    /// Print the artifact instead of writing it.
    #[arg(long)]
    no_write: bool,
}

/// Rust port of `lib/slug.ts::toSlug` — must stay byte-identical so the
/// generated slug matches the route the Next.js UI would create:
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
        .unwrap_or_else(|| to_slug(&format!("{}-{}", args.company, args.position)));

    let cfg = llm::LlmConfig::from_env();
    let client = llm::reqwest_client(&cfg);

    // Resolve the job description: explicit file > explicit text > synthesize.
    let jd = if let Some(path) = &args.jd_file {
        std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("reading --jd-file {}: {e}", path.display()))?
    } else if let Some(text) = args.jd.clone().filter(|t| !t.trim().is_empty()) {
        text
    } else {
        println!("No JD supplied — synthesizing a role brief from title only…");
        let sys = "You write detailed, realistic job descriptions from public knowledge of \
the named company and role. Output ONLY the job description as plain prose with clear \
sections (Responsibilities, Requirements, Tech stack, Domain context). Be concrete about \
the technologies, frameworks, and business domain a candidate would actually face. Do not \
invent confidential details or fabricate a job ID.";
        let user = format!(
            "Company: {}\nRole: {}\n\nWrite the job description.",
            args.company, args.position
        );
        ask(
            &client,
            &cfg.model,
            cfg.temperature,
            vec![msg("system", sys), msg("user", user)],
        )
        .await?
    };

    anyhow::ensure!(!jd.trim().is_empty(), "job description is empty");

    println!(
        "Generating prep: {} — {}  (slug={slug})",
        args.company, args.position
    );
    println!("Pipeline: [resolve JD] -> app_prep (tech_stack ‖ interview_questions)");
    println!();

    let result = app_prep::run(
        json!({
            "company": args.company,
            "position": args.position,
            "job_description": jd,
        }),
        &client,
        &cfg.model,
        cfg.temperature,
    )
    .await?;

    let interview = result
        .get("interview_questions")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tech_stack = result
        .get("tech_stack")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let tech_count = tech_stack.as_array().map(Vec::len).unwrap_or(0);

    anyhow::ensure!(
        !interview.trim().is_empty(),
        "app_prep returned empty interview_questions (JD too thin?)"
    );

    let artifact = json!({
        "slug": slug,
        "company": args.company,
        "position": args.position,
        "url": args.url,
        "status": "saved",
        "jobDescription": jd,
        "interviewQuestions": interview,
        "techStack": serde_json::to_string(&tech_stack)?,
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

    println!(
        "Done! interview_questions={} chars, tech_stack={tech_count} items",
        interview.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::to_slug;

    #[test]
    fn ecb_slug_matches_route() {
        // The default-slug path for the shipped artifact must equal the live
        // route segment exactly, or the seed loader never matches.
        assert_eq!(
            to_slug("European Central Bank-SSM Cockpit Developer"),
            "european-central-bank-ssm-cockpit-developer"
        );
    }

    #[test]
    fn collapses_and_trims_separators() {
        assert_eq!(to_slug("  Foo / Bar  -- Baz!! "), "foo-bar-baz");
    }

    /// Each case is the expected output of `lib/slug.ts::toSlug` on the input,
    /// pinning byte-for-byte parity with the TypeScript implementation.
    #[test]
    fn parity_with_lib_slug_ts() {
        // Drops every char outside [a-z0-9\s-]; '.', '#', '&', '/', '!' go.
        assert_eq!(to_slug("C# & .NET / Node.js!"), "c-net-nodejs");
        // ASCII digits survive ([a-z0-9]).
        assert_eq!(to_slug("Web3 / API v2"), "web3-api-v2");
        // Non-ASCII letters are stripped (JS regex `a-z` is ASCII-only) with
        // NO separator inserted, so the surviving letters close up.
        assert_eq!(to_slug("Café Münchën"), "caf-mnchn");
        // Pre-existing dashes are kept, then `-+` collapses and ends trim.
        assert_eq!(to_slug("---a---b---"), "a-b");
        // All-stripped / whitespace-only inputs yield the empty slug.
        assert_eq!(to_slug("!!!"), "");
        assert_eq!(to_slug("   "), "");
        // Mixed case is lowercased; tabs/newlines are whitespace separators.
        assert_eq!(to_slug("Foo\tBar\nBaz"), "foo-bar-baz");
    }
}
