//! `app_prep` — 1:1 port of `backend/knowledge_agent/app_prep_graph.py`.
//!
//! Two concurrent LLM calls (asyncio.gather → tokio::join!): a JSON tech-stack
//! extraction and a markdown interview-prep document. Categories match the
//! memorize generator so downstream flashcards get the right icon/color.

use deepseek::{DeepSeekClient, HttpClient};
use serde_json::{json, Value};

use super::{ask, ask_json, as_object, merge, msg, str_field};

/// `app_prep_graph.py::CATEGORIES`, rendered exactly as Python's `str(list)`
/// (the f-string interpolates the list repr into the prompt).
pub const CATEGORIES: &[&str] = &[
    "Databases & Storage",
    "Backend Frameworks",
    "Frontend Frameworks",
    "Cloud & DevOps",
    "Languages",
    "Testing & Quality",
    "API & Communication",
];

const CATEGORIES_REPR: &str = "['Databases & Storage', 'Backend Frameworks', 'Frontend Frameworks', 'Cloud & DevOps', 'Languages', 'Testing & Quality', 'API & Communication']";

const INTERVIEW_INSTRUCTION: &str = "Generate a focused interview-prep document for the candidate, as GitHub-flavored markdown. Sections:\n1. **Technical screen likely topics** (bullet list, 6-10 items)\n2. **System design scenarios** (2-3 realistic prompts tailored to the role)\n3. **Behavioral themes** (4-6 bullets, drawing from the JD's stated values)\n4. **Questions to ask them** (5 thoughtful questions)\n\nBe specific to the tech and domain named in the JD. Don't pad — high signal only.";

fn tech_stack_instruction() -> String {
    format!(
        "Extract the tech stack mentioned or implied in the job description below. \
Return JSON only: {{ \"techs\": [{{\"tag\": \"react\", \"label\": \"React\", \
\"category\": \"Frontend Frameworks\", \"relevance\": \"primary\"}}, ...] }}\n\n\
Rules:\n\
- tag: lowercase kebab-case identifier (e.g., 'react', 'postgres', 'aws-lambda')\n\
- label: human-readable name (e.g., 'React', 'PostgreSQL', 'AWS Lambda')\n\
- category: one of {CATEGORIES_REPR}\n\
- relevance: 'primary' for core required tech, 'secondary' for nice-to-haves\n\
- Aim for 8-15 items. Merge synonyms (e.g., 'JS'+'JavaScript' → one entry).\n\
- Skip soft skills, seniority labels, and non-tech keywords."
    )
}

fn user_content(company: &str, position: &str, jd: &str) -> String {
    format!("Company: {company}\nPosition: {position}\n\nJob description:\n{jd}")
}

/// `str(value)` for the `.get(key, "")` access pattern: missing → "".
fn pystr(v: Option<&Value>) -> String {
    match v {
        None => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) => "None".into(),
        Some(Value::Bool(true)) => "True".into(),
        Some(Value::Bool(false)) => "False".into(),
        Some(Value::Number(n)) => n.to_string(),
        Some(other) => other.to_string(),
    }
}

fn clean_tech_stack(result: &Value) -> Value {
    let techs = match result {
        Value::Object(m) => m.get("techs").cloned().unwrap_or(Value::Null),
        Value::Array(_) => result.clone(),
        _ => Value::Null,
    };
    let items = techs.as_array().cloned().unwrap_or_default();

    let mut cleaned = Vec::new();
    for t in &items {
        let Value::Object(o) = t else { continue };
        let tag = pystr(o.get("tag")).trim().to_lowercase();
        let label = pystr(o.get("label")).trim().to_string();
        let category = pystr(o.get("category")).trim().to_string();
        let mut relevance = if o.contains_key("relevance") {
            pystr(o.get("relevance")).trim().to_lowercase()
        } else {
            "secondary".to_string()
        };
        if tag.is_empty() || label.is_empty() || !CATEGORIES.contains(&category.as_str()) {
            continue;
        }
        if relevance != "primary" && relevance != "secondary" {
            relevance = "secondary".to_string();
        }
        cleaned.push(json!({
            "tag": tag,
            "label": label,
            "category": category,
            "relevance": relevance,
        }));
    }
    Value::Array(cleaned)
}

pub async fn run<H: HttpClient>(
    input: Value,
    client: &DeepSeekClient<H>,
    model: &str,
    temp: f64,
) -> anyhow::Result<Value> {
    let state = as_object(input);
    let jd = str_field(&state, "job_description").to_string();

    if jd.is_empty() {
        return Ok(merge(
            state,
            vec![
                ("tech_stack", json!([])),
                ("interview_questions", json!("")),
            ],
        ));
    }

    let company = str_field(&state, "company").to_string();
    let position = str_field(&state, "position").to_string();
    let user = user_content(&company, &position, &jd);

    let tech_fut = ask_json(
        client,
        model,
        temp,
        vec![
            msg("system", tech_stack_instruction()),
            msg("user", user.clone()),
        ],
    );
    let iv_fut = ask(
        client,
        model,
        temp,
        vec![msg("system", INTERVIEW_INSTRUCTION), msg("user", user)],
    );
    let (tech_res, iv_res) = tokio::join!(tech_fut, iv_fut);

    let tech_stack = clean_tech_stack(&tech_res?);
    let interview_questions = iv_res?;

    Ok(merge(
        state,
        vec![
            ("tech_stack", tech_stack),
            ("interview_questions", json!(interview_questions)),
        ],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_and_filters_techs() {
        let raw = json!({
            "techs": [
                {"tag": "React", "label": "React", "category": "Frontend Frameworks", "relevance": "PRIMARY"},
                {"tag": "x", "label": "X", "category": "Bogus Category", "relevance": "primary"},
                {"tag": "pg", "label": "Postgres", "category": "Databases & Storage"},
                {"label": "no tag", "category": "Languages", "relevance": "primary"},
                "not-an-object"
            ]
        });
        let out = clean_tech_stack(&raw);
        let arr = out.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["tag"], "react");
        assert_eq!(arr[0]["relevance"], "primary");
        // missing relevance defaults to secondary
        assert_eq!(arr[1]["tag"], "pg");
        assert_eq!(arr[1]["relevance"], "secondary");
    }

    #[test]
    fn accepts_bare_list_result() {
        let raw = json!([{"tag": "go", "label": "Go", "category": "Languages", "relevance": "primary"}]);
        assert_eq!(clean_tech_stack(&raw).as_array().unwrap().len(), 1);
    }

    #[test]
    fn prompt_embeds_category_repr() {
        assert!(tech_stack_instruction().contains(CATEGORIES_REPR));
    }
}
