//! `memorize_generate` — 1:1 port of
//! `backend/knowledge_agent/memorize_generate_graph.py`.
//!
//! Per-tech fan-out (asyncio.gather → join_all): each tech gets one LLM call
//! (8 items for `primary`, 4 for `secondary`), then items are grouped back
//! into frontend `MemorizeCategory` shapes, preserving first-seen order.

use deepseek::{DeepSeekClient, HttpClient};
use futures::future::join_all;
use serde_json::{json, Value};

use super::{ask_json, as_object, merge, msg, str_field};

fn category_icon(name: &str) -> &'static str {
    match name {
        "Databases & Storage" => "db",
        "Backend Frameworks" => "server",
        "Frontend Frameworks" => "layout",
        "Cloud & DevOps" => "cloud",
        "Languages" => "code",
        "Testing & Quality" => "check",
        "API & Communication" => "plug",
        _ => "code",
    }
}

fn category_color(name: &str) -> &'static str {
    match name {
        "Databases & Storage" => "cyan",
        "Backend Frameworks" => "green",
        "Frontend Frameworks" => "violet",
        "Cloud & DevOps" => "blue",
        "Languages" => "orange",
        "Testing & Quality" => "red",
        "API & Communication" => "indigo",
        _ => "gray",
    }
}

/// `re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")`.
fn category_id(name: &str) -> String {
    let mut out = String::new();
    let mut in_sep = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            in_sep = false;
        } else if !in_sep {
            out.push('-');
            in_sep = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Python `str(get(key, default))`: absent → default; present-null → "None".
fn pystr(v: Option<&Value>, default: &str) -> String {
    match v {
        None => default.to_string(),
        Some(Value::Null) => "None".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => if *b { "True" } else { "False" }.into(),
        Some(Value::Number(n)) => n.to_string(),
        Some(other) => other.to_string(),
    }
}

/// Python `str(value or "")` — falsy (None/false/0/""/[]/{}) collapses to "".
fn py_or_empty(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::Bool(false)) => String::new(),
        Some(Value::Bool(true)) => "True".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => {
            if n.as_f64() == Some(0.0) {
                String::new()
            } else {
                n.to_string()
            }
        }
        Some(Value::Array(a)) if a.is_empty() => String::new(),
        Some(Value::Object(o)) if o.is_empty() => String::new(),
        Some(other) => other.to_string(),
    }
}

/// `bool(value)` truthiness for the `if r` filter on relatedItems.
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

fn item_prompt(tech: &Value, position: &str, company: &str, count: i64) -> String {
    let label = tech.get("label").and_then(Value::as_str).unwrap_or("");
    let category = tech.get("category").and_then(Value::as_str).unwrap_or("");
    format!(
        "Generate exactly {count} flashcard-style memorization items for a software \
engineer preparing for a \"{position}\" interview at {company}.\n\n\
Technology: {label} (category: {category})\n\n\
For each item, produce a JSON object with these fields:\n\
- \"id\": kebab-case identifier (e.g., \"use-effect-cleanup\")\n\
- \"term\": the concept name (e.g., \"useEffect Cleanup\")\n\
- \"description\": 1-2 sentence explanation\n\
- \"details\": array of {{\"label\": string, \"description\": string}} pairs — \
key syntax points, gotchas, or patterns (3-5 per item)\n\
- \"context\": when/why this matters in interviews (1 sentence)\n\
- \"relatedItems\": array of related concept ids (can be empty)\n\
- \"mnemonicHint\": a short memory aid (1 sentence)\n\n\
Focus on concepts commonly asked in technical interviews: core APIs, common \
patterns, gotchas, performance considerations, best practices.\n\n\
Return ONLY valid JSON: {{ \"items\": [...] }}\n\
No markdown fences, no explanation — just the JSON object."
    )
}

fn clean_items(tech: &Value, parsed: &Value) -> Vec<Value> {
    let tag = tech.get("tag").and_then(Value::as_str).unwrap_or("");
    let raw_items = match parsed {
        Value::Object(m) => m.get("items").cloned().unwrap_or(Value::Null),
        _ => Value::Null,
    };
    let Some(raw_items) = raw_items.as_array() else {
        return Vec::new();
    };

    let mut cleaned = Vec::new();
    for item in raw_items {
        let Value::Object(o) = item else { continue };
        let item_id = py_or_empty(o.get("id"));
        let item_id = item_id.trim();
        let term = py_or_empty(o.get("term"));
        let term = term.trim();
        if item_id.is_empty() || term.is_empty() {
            continue;
        }
        let details: Vec<Value> = o
            .get("details")
            .and_then(Value::as_array)
            .map(|ds| {
                ds.iter()
                    .filter_map(|d| d.as_object())
                    .map(|d| {
                        json!({
                            "label": pystr(d.get("label"), ""),
                            "description": pystr(d.get("description"), ""),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let related: Vec<Value> = o
            .get("relatedItems")
            .and_then(Value::as_array)
            .map(|rs| {
                rs.iter()
                    .filter(|&r| truthy(r))
                    .map(|r| json!(pystr(Some(r), "")))
                    .collect()
            })
            .unwrap_or_default();
        cleaned.push(json!({
            "id": format!("{tag}-{item_id}"),
            "term": term,
            "description": py_or_empty(o.get("description")),
            "details": details,
            "context": py_or_empty(o.get("context")),
            "relatedItems": related,
            "mnemonicHint": py_or_empty(o.get("mnemonicHint")),
        }));
    }
    cleaned
}

pub async fn run<H: HttpClient>(
    input: Value,
    client: &DeepSeekClient<H>,
    model: &str,
    temp: f64,
) -> anyhow::Result<Value> {
    let state = as_object(input);
    let techs: Vec<Value> = state
        .get("techs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if techs.is_empty() {
        return Ok(merge(state, vec![("categories", json!([]))]));
    }

    let company = str_field(&state, "company").to_string();
    let position = str_field(&state, "position").to_string();

    let futs = techs.iter().map(|t| {
        let count = if t.get("relevance").and_then(Value::as_str) == Some("primary") {
            8
        } else {
            4
        };
        let prompt = item_prompt(t, &position, &company, count);
        async move {
            // _gen_items_for_tech swallows any LLM/parse error → [].
            match ask_json(
                client,
                model,
                temp,
                vec![
                    msg(
                        "system",
                        "You are a technical interview preparation expert. Return only valid JSON, no markdown.",
                    ),
                    msg("user", prompt),
                ],
            )
            .await
            {
                Ok(parsed) => (t, clean_items(t, &parsed)),
                Err(_) => (t, Vec::new()),
            }
        }
    });
    let results = join_all(futs).await;

    // Group by category, preserving first-seen ordering.
    let mut grouped: Vec<(String, Vec<Value>)> = Vec::new();
    for (tech, items) in results {
        if items.is_empty() {
            continue;
        }
        let cat = tech
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        match grouped.iter_mut().find(|(c, _)| *c == cat) {
            Some((_, v)) => v.extend(items),
            None => grouped.push((cat, items)),
        }
    }

    let categories: Vec<Value> = grouped
        .into_iter()
        .filter(|(_, items)| !items.is_empty())
        .map(|(name, items)| {
            json!({
                "id": category_id(&name),
                "name": name,
                "icon": category_icon(&name),
                "color": category_color(&name),
                "items": items,
            })
        })
        .collect();

    Ok(merge(state, vec![("categories", Value::Array(categories))]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_id_kebabs() {
        assert_eq!(category_id("Databases & Storage"), "databases-storage");
        assert_eq!(category_id("API & Communication"), "api-communication");
        assert_eq!(category_id("Languages"), "languages");
    }

    #[test]
    fn clean_items_prefixes_id_and_filters() {
        let tech = json!({"tag": "react", "category": "Frontend Frameworks", "label": "React"});
        let parsed = json!({
            "items": [
                {"id": "hooks", "term": "Hooks", "description": "d",
                 "details": [{"label": "L", "description": "D"}, "skip"],
                 "relatedItems": ["a", "", "b"], "mnemonicHint": "m", "context": "c"},
                {"id": "", "term": "no id"},
                {"term": "no id key"}
            ]
        });
        let out = clean_items(&tech, &parsed);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["id"], "react-hooks");
        assert_eq!(out[0]["details"].as_array().unwrap().len(), 1);
        assert_eq!(out[0]["relatedItems"], json!(["a", "b"]));
    }

    #[test]
    fn non_dict_items_yield_empty() {
        let tech = json!({"tag": "x"});
        assert!(clean_items(&tech, &json!({"items": "nope"})).is_empty());
        assert!(clean_items(&tech, &json!("nope")).is_empty());
    }
}
