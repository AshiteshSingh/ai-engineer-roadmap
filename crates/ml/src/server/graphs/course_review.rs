//! `course_review` — 1:1 port of
//! `backend/knowledge_agent/course_review_graph.py`.
//!
//! 10 expert LLM calls fan out concurrently (per-expert temperature: 0.0 for
//! the three reasoner experts + aggregator, 0.3 for the six soft experts),
//! then a deterministic aggregator. The final object merges the input course
//! fields + 10 expert scores + aggregator fields (LangGraph `ainvoke` shape),
//! matching `CourseReviewResult` in `src/lib/backend-client.ts`.

use deepseek::{DeepSeekClient, HttpClient};
use futures::future::join_all;
use serde_json::{json, Map, Value};

use super::course_review_prompts as prompts;
use super::{ask_json, as_object, merge, msg};

const REASONER_TEMP: f64 = 0.0;
const FAST_TEMP: f64 = 0.3;

type PromptFn = fn(&str) -> String;

/// (state_key, prompt_fn, temperature) — order matches `_EXPERTS`.
fn experts() -> Vec<(&'static str, PromptFn, f64)> {
    vec![
        ("pedagogy_score", prompts::pedagogy, REASONER_TEMP),
        ("technical_accuracy_score", prompts::technical_accuracy, REASONER_TEMP),
        ("content_depth_score", prompts::content_depth, FAST_TEMP),
        ("practical_application_score", prompts::practical_application, FAST_TEMP),
        ("instructor_clarity_score", prompts::instructor_clarity, FAST_TEMP),
        ("curriculum_fit_score", prompts::curriculum_fit, FAST_TEMP),
        ("prerequisites_score", prompts::prerequisites, FAST_TEMP),
        ("domain_relevance_score", prompts::domain_relevance, REASONER_TEMP),
        ("community_health_score", prompts::community_health, FAST_TEMP),
        ("value_proposition_score", prompts::value_proposition, FAST_TEMP),
    ]
}

// ── numeric/format helpers (Python parity) ────────────────────────────────

fn as_f64(v: Option<&Value>, default: f64) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(default),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(default),
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => default,
    }
}

fn as_i64_trunc(v: Option<&Value>, default: i64) -> i64 {
    match v {
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f.trunc() as i64))
            .unwrap_or(default),
        Some(Value::String(s)) => s
            .trim()
            .parse::<i64>()
            .ok()
            .or_else(|| s.trim().parse::<f64>().ok().map(|f| f.trunc() as i64))
            .unwrap_or(default),
        _ => default,
    }
}

/// Python `round()` — round-half-to-even at `nd` decimals.
fn py_round(x: f64, nd: i32) -> f64 {
    let m = 10f64.powi(nd);
    let y = x * m;
    let f = y.floor();
    let diff = y - f;
    let r = if (diff - 0.5).abs() < 1e-9 {
        if (f as i64) % 2 == 0 {
            f
        } else {
            f + 1.0
        }
    } else {
        y.round()
    };
    r / m
}

/// Python `f"{n:,}"` thousands grouping.
fn comma_group(n: i64) -> String {
    let neg = n < 0;
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    let len = digits.len();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if neg {
        format!("-{out}")
    } else {
        out
    }
}

/// `f"{state.get(key, default)}"` — absent → default; null → "None".
fn pyfmt(state: &Map<String, Value>, key: &str, default: &str) -> String {
    match state.get(key) {
        None => default.to_string(),
        Some(Value::Null) => "None".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => if *b { "True" } else { "False" }.into(),
        Some(Value::Number(n)) => n.to_string(),
        Some(other) => other.to_string(),
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

fn format_course_info(s: &Map<String, Value>) -> String {
    let rating = as_f64(s.get("rating"), 0.0);
    let review_count = as_i64_trunc(s.get("review_count"), 0);
    let duration_hours = as_f64(s.get("duration_hours"), 0.0);
    let free_label = if s.get("is_free").map(is_truthy).unwrap_or(false) {
        "Free"
    } else {
        "Paid"
    };
    let description = match s.get("description") {
        Some(v) if is_truthy(v) => match v {
            Value::String(t) => t.clone(),
            other => other.to_string(),
        },
        _ => "N/A".to_string(),
    };
    [
        format!("Title: {}", pyfmt(s, "title", "")),
        format!("Provider: {}", pyfmt(s, "provider", "")),
        format!("URL: {}", pyfmt(s, "url", "")),
        format!("Level: {}", pyfmt(s, "level", "Beginner")),
        format!(
            "Rating: {:.1}/5 ({} reviews)",
            rating,
            comma_group(review_count)
        ),
        format!("Duration: ~{}h", py_round(duration_hours, 0) as i64),
        format!("Price: {free_label}"),
        format!("Description: {description}"),
    ]
    .join("\n")
}

fn normalize_expert(raw: &Value) -> Value {
    let Value::Object(o) = raw else {
        return json!({
            "score": 1, "reasoning": "Invalid response",
            "strengths": [], "weaknesses": []
        });
    };
    let mut score = match o.get("score") {
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f.trunc() as i64))
            .unwrap_or(1),
        Some(Value::String(s)) => s
            .trim()
            .parse::<i64>()
            .ok()
            .or_else(|| s.trim().parse::<f64>().ok().map(|f| f.trunc() as i64))
            .unwrap_or(1),
        None => 1,
        _ => 1,
    };
    score = score.clamp(1, 10);

    let str_list = |key: &str| -> Vec<Value> {
        o.get(key)
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter(|&x| is_truthy(x))
                    .map(|x| match x {
                        Value::String(s) => json!(s),
                        other => json!(other.to_string()),
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let reasoning = match o.get("reasoning") {
        Some(v) if is_truthy(v) => match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        },
        _ => String::new(),
    };
    json!({
        "score": score,
        "reasoning": reasoning,
        "strengths": str_list("strengths"),
        "weaknesses": str_list("weaknesses"),
    })
}

fn format_scores_summary(state: &Map<String, Value>) -> String {
    let join_list = |v: Option<&Value>| -> String {
        v.and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .map(|x| x.as_str().map(str::to_string).unwrap_or_else(|| x.to_string()))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default()
    };
    experts()
        .iter()
        .map(|(key, _, _)| {
            let empty = Value::Object(Map::new());
            let s = state.get(*key).unwrap_or(&empty);
            let so = s.as_object();
            let score = so
                .and_then(|m| m.get("score"))
                .map(|v| v.to_string())
                .unwrap_or_else(|| "?".to_string());
            let reasoning = so
                .and_then(|m| m.get("reasoning"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let strengths = join_list(so.and_then(|m| m.get("strengths")));
            let weaknesses = join_list(so.and_then(|m| m.get("weaknesses")));
            format!(
                "{key}:\n  Score: {score}/10\n  Reasoning: {reasoning}\n  Strengths: {strengths}\n  Weaknesses: {weaknesses}"
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub async fn run<H: HttpClient>(
    input: Value,
    client: &DeepSeekClient<H>,
    model: &str,
) -> anyhow::Result<Value> {
    let mut state = as_object(input);
    let info = format_course_info(&state);

    // experts_node — fan out, propagate any error (Python does not catch).
    let expert_specs = experts();
    let futs = expert_specs.iter().map(|(_key, prompt_fn, temp)| {
        let system = prompt_fn(&info);
        let user = format!("Review this course:\n\n{info}");
        async move {
            ask_json(
                client,
                model,
                *temp,
                vec![msg("system", system), msg("user", user)],
            )
            .await
            .map(|p| normalize_expert(&p))
        }
    });
    let results = join_all(futs).await;
    for ((key, _, _), res) in expert_specs.iter().zip(results) {
        state.insert(key.to_string(), res?);
    }

    // aggregator_node
    let summary = format_scores_summary(&state);
    let parsed = ask_json(
        client,
        model,
        REASONER_TEMP,
        vec![
            msg("system", prompts::aggregator(&info, &summary)),
            msg("user", format!("Aggregate these expert scores:\n\n{summary}")),
        ],
    )
    .await?;
    let parsed = parsed.as_object().cloned().unwrap_or_default();

    let aggregate_score = as_f64(parsed.get("aggregate_score"), 0.0);
    let mut verdict = parsed
        .get("verdict")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if !matches!(verdict.as_str(), "excellent" | "recommended" | "average" | "skip") {
        verdict = if aggregate_score >= 8.5 {
            "excellent"
        } else if aggregate_score >= 7.0 {
            "recommended"
        } else if aggregate_score >= 5.5 {
            "average"
        } else {
            "skip"
        }
        .to_string();
    }
    let str_list = |key: &str| -> Vec<Value> {
        parsed
            .get(key)
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter(|&x| is_truthy(x))
                    .map(|x| match x {
                        Value::String(s) => json!(s),
                        other => json!(other.to_string()),
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let agg_summary = match parsed.get("summary") {
        Some(v) if is_truthy(v) => match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        },
        _ => String::new(),
    };

    Ok(merge(
        state,
        vec![
            ("aggregate_score", json!(py_round(aggregate_score, 1))),
            ("verdict", json!(verdict)),
            ("summary", json!(agg_summary)),
            ("top_strengths", Value::Array(str_list("top_strengths"))),
            ("key_weaknesses", Value::Array(str_list("key_weaknesses"))),
        ],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comma_group_matches_python() {
        assert_eq!(comma_group(0), "0");
        assert_eq!(comma_group(999), "999");
        assert_eq!(comma_group(1234), "1,234");
        assert_eq!(comma_group(1234567), "1,234,567");
    }

    #[test]
    fn py_round_half_even() {
        assert_eq!(py_round(2.5, 0), 2.0);
        assert_eq!(py_round(3.5, 0), 4.0);
        assert_eq!(py_round(8.25, 1), 8.2);
        assert_eq!(py_round(7.96, 1), 8.0);
    }

    #[test]
    fn normalize_expert_clamps_and_defaults() {
        let bad = normalize_expert(&json!("oops"));
        assert_eq!(bad["score"], 1);
        assert_eq!(bad["reasoning"], "Invalid response");

        let v = normalize_expert(&json!({
            "score": 99, "reasoning": "r",
            "strengths": ["a", "", "b"], "weaknesses": []
        }));
        assert_eq!(v["score"], 10);
        assert_eq!(v["strengths"], json!(["a", "b"]));
    }

    #[test]
    fn course_info_formats_rating_and_count() {
        let s = json!({
            "title": "T", "provider": "Udemy", "url": "u",
            "rating": 4.5, "review_count": 12345, "duration_hours": 7.6,
            "is_free": false
        });
        let info = format_course_info(s.as_object().unwrap());
        assert!(info.contains("Rating: 4.5/5 (12,345 reviews)"));
        assert!(info.contains("Duration: ~8h"));
        assert!(info.contains("Level: Beginner"));
        assert!(info.contains("Price: Paid"));
        assert!(info.contains("Description: N/A"));
    }
}
