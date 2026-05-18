//! Loose JSON extraction — 1:1 port of
//! `backend/knowledge_agent/llm.py::_parse_json`.
//!
//! The Python `ainvoke_json` adds `response_format={"type":"json_object"}`
//! only for non-local base URLs; the actual robustness comes from
//! `_parse_json`, which (a) strips a leading ```` ``` ```` fence and (b) falls
//! back to extracting the first `{...}`/`[...]` span. We replicate that
//! fallback exactly so behaviour matches whether or not the model honours JSON
//! mode — no `response_format` field is needed on the request.

use serde_json::Value;

/// Parse model output into JSON, mirroring Python's `_parse_json`:
///
/// 1. `strip()` the text.
/// 2. If it starts with ```` ``` ````, drop the first line and a trailing
///    ```` ``` ```` line (the language tag / fence), then `strip()`.
/// 3. `json.loads` the result.
/// 4. On failure, `re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)` — i.e. the
///    span from the first `{` to the last `}`, else first `[` to last `]` —
///    and parse that.
/// 5. If nothing matches, return the original parse error.
pub fn parse_loose(raw: &str) -> anyhow::Result<Value> {
    let mut text = raw.trim().to_string();

    if text.starts_with("```") {
        let mut lines: Vec<&str> = text.split('\n').collect();
        if !lines.is_empty() {
            lines.remove(0); // drop the ```lang opening fence line
        }
        if lines.last().map(|l| l.trim()) == Some("```") {
            lines.pop(); // drop the closing fence line
        }
        text = lines.join("\n").trim().to_string();
    }

    match serde_json::from_str::<Value>(&text) {
        Ok(v) => Ok(v),
        Err(first_err) => {
            if let Some(span) = greedy_span(&text) {
                serde_json::from_str::<Value>(span)
                    .map_err(|e| anyhow::anyhow!("json extract parse failed: {e}"))
            } else {
                Err(anyhow::anyhow!("json parse failed: {first_err}"))
            }
        }
    }
}

/// Equivalent of the greedy `(\{.*\}|\[.*\])` DOTALL search: object span wins
/// (first `{` … last `}`); otherwise array span (first `[` … last `]`).
fn greedy_span(text: &str) -> Option<&str> {
    if let (Some(s), Some(e)) = (text.find('{'), text.rfind('}')) {
        if e >= s {
            return Some(&text[s..=e]);
        }
    }
    if let (Some(s), Some(e)) = (text.find('['), text.rfind(']')) {
        if e >= s {
            return Some(&text[s..=e]);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_object() {
        let v = parse_loose(r#"{"a": 1}"#).unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn fenced_json_block() {
        let v = parse_loose("```json\n{\"x\": [1,2]}\n```").unwrap();
        assert_eq!(v["x"][1], 2);
    }

    #[test]
    fn fence_without_lang_tag() {
        let v = parse_loose("```\n{\"ok\": true}\n```").unwrap();
        assert_eq!(v["ok"], true);
    }

    #[test]
    fn prose_wrapped_object_extracted() {
        let v = parse_loose("Sure! Here you go:\n{\"score\": 7}\nHope that helps.")
            .unwrap();
        assert_eq!(v["score"], 7);
    }

    #[test]
    fn array_payload_extracted() {
        let v = parse_loose("noise [1, 2, 3] trailing").unwrap();
        assert_eq!(v.as_array().unwrap().len(), 3);
    }

    #[test]
    fn unparseable_errors() {
        assert!(parse_loose("definitely not json").is_err());
    }
}
