//! `fetch_courses` — 1:1 port of
//! `backend/knowledge_agent/fetch_courses_graph.py`.
//!
//! Two-node pipeline: `rank` (REASONER_TEMP 0.0, deterministic) →
//! `summarize` (FAST_TEMP 0.5, warmer prose). State threads through so the
//! summarizer sees the ranked picks; the final object merges input + ranked +
//! summary, exactly like LangGraph's `ainvoke`.

use deepseek::{DeepSeekClient, HttpClient};
use serde_json::{json, Map, Value};

use super::{ask_json, as_object, merge, msg};

const REASONER_TEMP: f64 = 0.0;
const FAST_TEMP: f64 = 0.5;
const MAX_COURSES_TO_RANK: usize = 30;
const MAX_DESC_CHARS: usize = 600;
const MAX_LEARN_ITEMS: usize = 6;

/// Python `a or b` over JSON values: first truthy, else the second.
fn or<'a>(a: Option<&'a Value>, b: Option<&'a Value>) -> Value {
    match a {
        Some(v) if is_truthy(v) => v.clone(),
        _ => b.cloned().unwrap_or(Value::Null),
    }
}

fn is_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

fn get<'a>(o: &'a Map<String, Value>, k: &str) -> Option<&'a Value> {
    o.get(k)
}

/// `_slim_for_prompt`: project a ScrapedCourse to the ranker-relevant fields.
fn slim_for_prompt(course: &Value) -> Value {
    let course = course.as_object().cloned().unwrap_or_default();
    let metadata = course
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    // desc = course.description or metadata.subtitle or ""
    let mut desc = match (course.get("description"), metadata.get("subtitle")) {
        (Some(d), _) if is_truthy(d) => d.clone(),
        (_, Some(s)) if is_truthy(s) => s.clone(),
        _ => Value::String(String::new()),
    };
    if let Value::String(s) = &desc {
        if s.chars().count() > MAX_DESC_CHARS {
            let truncated: String = s.chars().take(MAX_DESC_CHARS).collect();
            desc = Value::String(format!("{truncated}…"));
        }
    }

    let learn = match metadata.get("whatYoullLearn") {
        Some(Value::Array(a)) => {
            Value::Array(a.iter().take(MAX_LEARN_ITEMS).cloned().collect())
        }
        Some(v) if is_truthy(v) => v.clone(),
        _ => Value::Array(vec![]),
    };

    json!({
        "url": get(&course, "url").cloned().unwrap_or(json!("")),
        "title": get(&course, "title").cloned().unwrap_or(json!("")),
        "subtitle": metadata.get("subtitle").cloned().unwrap_or(Value::Null),
        "description": desc,
        "rating": get(&course, "rating").cloned().unwrap_or(Value::Null),
        "review_count": or(course.get("reviewCount"), course.get("review_count")),
        "enrolled": get(&course, "enrolled").cloned().unwrap_or(Value::Null),
        "duration_hours": or(course.get("durationHours"), course.get("duration_hours")),
        "level": get(&course, "level").cloned().unwrap_or(Value::Null),
        "is_free": {
            match course.get("isFree") {
                Some(v) if is_truthy(v) => v.clone(),
                _ => course.get("is_free").cloned().unwrap_or(json!(false)),
            }
        },
        "what_youll_learn": learn,
        "instructors": match metadata.get("instructors") {
            Some(v) if is_truthy(v) => v.clone(),
            _ => json!([]),
        },
    })
}

fn ranker_prompt(topic_name: &str, count: i64) -> String {
    format!(
        "You are a curriculum curator selecting the best Udemy courses for the topic \
\"{topic_name}\". You will be given a JSON array of candidate courses scraped \
from Udemy's most-reviewed search results.\n\n\
Return STRICTLY a JSON object of this shape:\n\
{{\"ranked\": [{{\"url\": \"...\", \"relevance\": 0.0-1.0, \"why\": \"<=15 words\"}}]}}\n\n\
Selection rules:\n\
1. Pick the top {count} courses MOST relevant to \"{topic_name}\".\n\
2. Prefer courses with high review_count (signals proven popularity), then high rating.\n\
3. Penalize off-topic courses even if highly reviewed (e.g. for a soft-skill topic, \
reject courses that are mostly about something else).\n\
4. relevance must reflect topical fit to \"{topic_name}\", not just course quality.\n\
5. ``why`` must be ≤15 words and concrete (mention what the course covers).\n\
6. Output the {count} URLs in descending order of relevance.\n\
7. Use the EXACT url string from each candidate.\n"
    )
}

fn summary_prompt(topic_name: &str, count: usize) -> String {
    format!(
        "Write a 2–3 sentence intro paragraph (under 60 words) for the \"{topic_name}\" \
lesson page that introduces these {count} curated Udemy courses. \
Be concrete about what learners will get; do not list course titles. \
Return STRICTLY {{\"summary\": \"...\"}}."
    )
}

/// `_normalize_ranked`. `valid_urls` is the candidate-order unique url list
/// (replaces Python's nondeterministic `set` for a stable fallback).
fn normalize_ranked(raw: &Value, valid_urls: &[String], count: usize) -> Vec<Value> {
    let items: Vec<Value> = match raw {
        Value::Object(m) => {
            let r = m.get("ranked").filter(|v| is_truthy(v));
            let c = m.get("courses").filter(|v| is_truthy(v));
            r.or(c)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        }
        Value::Array(a) => a.clone(),
        _ => Vec::new(),
    };

    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<Value> = Vec::new();
    for item in &items {
        let Value::Object(o) = item else { continue };
        let url = match o.get("url") {
            Some(v) if is_truthy(v) => v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()),
            _ => String::new(),
        };
        let url = url.trim().to_string();
        if url.is_empty() || seen.contains(&url) {
            continue;
        }
        let relevance = o
            .get("relevance")
            .map(|v| match v {
                Value::Number(n) => n.as_f64().unwrap_or(0.5),
                Value::String(s) => s.trim().parse::<f64>().unwrap_or(0.5),
                _ => 0.5,
            })
            .unwrap_or(0.5);
        let relevance = relevance.clamp(0.0, 1.0);
        let relevance = (relevance * 100.0).round() / 100.0;
        let why = match o.get("why") {
            Some(v) if is_truthy(v) => v
                .as_str()
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| v.to_string()),
            _ => String::new(),
        };
        out.push(json!({ "url": url, "relevance": relevance, "why": why }));
        seen.insert(url);
        if out.len() >= count {
            break;
        }
    }

    let any_valid = out.iter().any(|r| {
        r.get("url")
            .and_then(Value::as_str)
            .map(|u| valid_urls.iter().any(|v| v == u))
            .unwrap_or(false)
    });
    if !any_valid {
        return valid_urls
            .iter()
            .take(count)
            .map(|u| json!({ "url": u, "relevance": 0.5, "why": "" }))
            .collect();
    }
    out
}

pub async fn run<H: HttpClient>(
    input: Value,
    client: &DeepSeekClient<H>,
    model: &str,
) -> anyhow::Result<Value> {
    let state = as_object(input);

    // ── rank node ─────────────────────────────────────────────────────────
    let raw_courses: Vec<Value> = state
        .get("courses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let topic_name = match state.get("topic_name") {
        Some(v) if is_truthy(v) => v.as_str().unwrap_or("this topic").to_string(),
        _ => "this topic".to_string(),
    };
    let count: i64 = match state.get("count") {
        Some(Value::Number(n)) if is_truthy(&Value::Number(n.clone())) => {
            n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)).unwrap_or(10)
        }
        Some(Value::String(s)) if !s.is_empty() => s.trim().parse::<i64>().unwrap_or(10),
        _ => 10,
    };
    let count = count.max(1) as usize;

    let candidates: Vec<Value> = raw_courses
        .iter()
        .take(MAX_COURSES_TO_RANK)
        .map(slim_for_prompt)
        .collect();
    let mut valid_urls: Vec<String> = Vec::new();
    for c in &candidates {
        if let Some(u) = c.get("url").and_then(Value::as_str) {
            if !u.is_empty() && !valid_urls.iter().any(|x| x == u) {
                valid_urls.push(u.to_string());
            }
        }
    }

    let ranked: Vec<Value> = if candidates.is_empty() {
        Vec::new()
    } else {
        let user = format!(
            "Candidate courses (JSON array):\n{}",
            serde_json::to_string(&candidates)?
        );
        let parsed = ask_json(
            client,
            model,
            REASONER_TEMP,
            vec![msg("system", ranker_prompt(&topic_name, count as i64)), msg("user", user)],
        )
        .await?;
        normalize_ranked(&parsed, &valid_urls, count)
    };

    // ── summarize node ────────────────────────────────────────────────────
    let summary = if ranked.is_empty() {
        String::new()
    } else {
        let by_url: std::collections::HashMap<String, &Value> = raw_courses
            .iter()
            .filter_map(|c| {
                c.get("url")
                    .and_then(Value::as_str)
                    .map(|u| (u.to_string(), c))
            })
            .collect();
        let mut picks: Vec<Value> = Vec::new();
        for r in &ranked {
            let url = r.get("url").and_then(Value::as_str).unwrap_or("");
            if let Some(course) = by_url.get(url) {
                picks.push(json!({
                    "title": course.get("title").cloned().unwrap_or(Value::Null),
                    "rating": course.get("rating").cloned().unwrap_or(Value::Null),
                    "review_count": or(course.get("reviewCount"), course.get("review_count")),
                    "why": r.get("why").cloned().unwrap_or(Value::Null),
                }));
            }
        }
        let user = format!(
            "Curated courses:\n{}",
            serde_json::to_string(&picks)?
        );
        // summarize swallows any LLM/parse error → "".
        match ask_json(
            client,
            model,
            FAST_TEMP,
            vec![
                msg("system", summary_prompt(&topic_name, picks.len())),
                msg("user", user),
            ],
        )
        .await
        {
            Ok(Value::Object(m)) => m
                .get("summary")
                .map(|v| match v {
                    Value::String(s) => s.trim().to_string(),
                    Value::Null => String::new(),
                    other => other.to_string(),
                })
                .unwrap_or_default(),
            Ok(_) => String::new(),
            Err(_) => String::new(),
        }
    };

    Ok(merge(
        state,
        vec![
            ("ranked", Value::Array(ranked)),
            ("summary", json!(summary)),
        ],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slim_truncates_and_falls_back_to_subtitle() {
        let long = "x".repeat(700);
        let c = json!({
            "url": "u",
            "title": "T",
            "metadata": {"subtitle": "sub", "whatYoullLearn": [1,2,3,4,5,6,7,8]},
            "rating": 4.5
        });
        let s = slim_for_prompt(&c);
        assert_eq!(s["description"], "sub");
        assert_eq!(s["what_youll_learn"].as_array().unwrap().len(), 6);

        let c2 = json!({ "url": "u", "description": long });
        let s2 = slim_for_prompt(&c2);
        let d = s2["description"].as_str().unwrap();
        assert!(d.ends_with('…') && d.chars().count() == 601);
    }

    #[test]
    fn normalize_dedupes_clamps_and_caps() {
        let raw = json!({"ranked": [
            {"url": "a", "relevance": 1.5, "why": " w "},
            {"url": "a", "relevance": 0.9},
            {"url": "b", "relevance": -1},
            {"url": "c", "relevance": 0.4}
        ]});
        let out = normalize_ranked(&raw, &["a".into(), "b".into(), "c".into()], 2);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["url"], "a");
        assert_eq!(out[0]["relevance"], 1.0);
        assert_eq!(out[0]["why"], "w");
        assert_eq!(out[1]["relevance"], 0.0);
    }

    #[test]
    fn normalize_falls_back_when_all_hallucinated() {
        let raw = json!({"ranked": [{"url": "ghost", "relevance": 0.9}]});
        let out = normalize_ranked(&raw, &["real1".into(), "real2".into()], 5);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["url"], "real1");
        assert_eq!(out[0]["relevance"], 0.5);
    }
}
