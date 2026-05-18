//! `app_prep_owner` — owner-only, evidence-grounded interview prep.
//!
//! Sibling to `app_prep` but a SEPARATE lane: it takes a curated, git/code-
//! verified candidate evidence dossier plus the same job description the public
//! prep was built from, and emits a single markdown document tailored to the
//! candidate. Written to `data/app-prep/<slug>.owner.json` by the
//! `gen-app-prep-owner` bin and rendered owner-gated on the prep page — it never
//! touches the public `<slug>.json`, so neither regeneration path can clobber
//! the other.
//!
//! One LLM call (no tech-stack extraction). The system prompt pins three
//! sections and a strict no-invented-metrics guardrail, and uses the prep
//! page's callout vocabulary (`**Say this:**`, `**Common mistake:**`,
//! `**If they ask:**`, `⏱ Target:`) so the output renders styled with no
//! frontend changes.

use deepseek::{DeepSeekClient, HttpClient};
use serde_json::{json, Value};

use super::{ask, as_object, merge, msg, str_field};

pub const OWNER_INSTRUCTION: &str = "You write an owner-only, evidence-grounded \
interview-prep document for ONE specific candidate, as GitHub-flavored markdown. \
You are given the job description and a verified evidence dossier about the \
candidate's real work on a project. Produce exactly these level-2 sections, in \
order:\n\n\
## Evidence cheat-sheet\n\
A table or tight bullet list mapping each key job requirement to a one-line, \
citable proof from the dossier the candidate can say under pressure.\n\n\
## Behavioral STAR stories\n\
For every behavioral theme implied by the job description, a full Situation / \
Task / Action / Result story drawn ONLY from the dossier. Use a `**Say this:**` \
line for the spoken version and `⏱ Target:` for a spoken-length target.\n\n\
## Your angle\n\
For each likely technical-screen topic and system-design scenario in the job \
description, how THIS candidate should answer it from their real experience. \
Where the role's stack differs from the dossier, bridge it HONESTLY as \
transferable — never claim direct experience the dossier doesn't support. Use \
`**If they ask:**` for follow-up framing and `**Common mistake:**` for traps.\n\n\
GUARDRAIL (follow exactly): use ONLY facts present in the evidence dossier. Do \
NOT invent metrics, percentages, team sizes, or outcomes. State impact \
qualitatively unless a number is explicitly in the dossier. If the dossier marks \
something as a gap or 'transferable, not direct', honor that framing — do not \
upgrade it to direct experience. High signal only; no padding.";

fn user_content(company: &str, position: &str, jd: &str, evidence: &str) -> String {
    format!(
        "Company: {company}\nPosition: {position}\n\n\
Job description:\n{jd}\n\n\
=== VERIFIED EVIDENCE DOSSIER (the only source of truth for factual claims) ===\n\
{evidence}"
    )
}

pub async fn run<H: HttpClient>(
    input: Value,
    client: &DeepSeekClient<H>,
    model: &str,
    temp: f64,
) -> anyhow::Result<Value> {
    let state = as_object(input);
    let jd = str_field(&state, "job_description").to_string();
    let evidence = str_field(&state, "evidence").to_string();

    // Mirror app_prep's empty-JD short-circuit, and also require evidence —
    // without it there is nothing owner-specific to ground the prep in.
    if jd.is_empty() || evidence.is_empty() {
        return Ok(merge(state, vec![("owner_prep", json!(""))]));
    }

    let company = str_field(&state, "company").to_string();
    let position = str_field(&state, "position").to_string();
    let user = user_content(&company, &position, &jd, &evidence);

    let owner_prep = ask(
        client,
        model,
        temp,
        vec![msg("system", OWNER_INSTRUCTION), msg("user", user)],
    )
    .await?;

    Ok(merge(state, vec![("owner_prep", json!(owner_prep))]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_pins_sections_and_guardrail() {
        assert!(OWNER_INSTRUCTION.contains("## Evidence cheat-sheet"));
        assert!(OWNER_INSTRUCTION.contains("## Behavioral STAR stories"));
        assert!(OWNER_INSTRUCTION.contains("## Your angle"));
        assert!(OWNER_INSTRUCTION.contains("Do NOT invent metrics"));
        assert!(OWNER_INSTRUCTION.contains("transferable"));
    }

    #[test]
    fn user_content_carries_jd_and_evidence() {
        let u = user_content("ECB", "Dev", "the-jd-text", "the-evidence-text");
        assert!(u.contains("Company: ECB"));
        assert!(u.contains("the-jd-text"));
        assert!(u.contains("VERIFIED EVIDENCE DOSSIER"));
        assert!(u.contains("the-evidence-text"));
    }
}
