//! Topic aggregation: group raw signals into deduplicated topics with evidence.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::rules::EXTRA_RULES;
use crate::taxonomy::TAXONOMY;

/// A single grep hit from the scanner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSignal {
    pub tag: String,
    pub file: String,
    pub line: usize,
    pub snippet: String,
}

/// A source-code reference backing a topic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evidence {
    pub file: String,
    pub line: usize,
    pub snippet: String,
}

/// An extracted learning topic ready for embedding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Topic {
    pub slug: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub evidence: Vec<Evidence>,
    pub source_count: usize,
}

impl Topic {
    /// The text that gets embedded — title + description gives strong signal.
    pub fn embed_text(&self) -> String {
        format!("{}\n\n{}", self.title, self.description)
    }
}

/// Aggregate raw signals into deduplicated topics.
///
/// Groups by tag, merges evidence, assigns category and synthesizes description.
/// Returns topics sorted by source_count descending (most-used first).
pub fn aggregate(signals: Vec<RawSignal>) -> Vec<Topic> {
    // Group signals by tag.
    let mut groups: HashMap<String, Vec<RawSignal>> = HashMap::new();
    for sig in signals {
        groups.entry(sig.tag.clone()).or_default().push(sig);
    }

    let mut topics: Vec<Topic> = groups
        .into_iter()
        .map(|(tag, sigs)| {
            // Distinct source files.
            let files: HashSet<&str> = sigs.iter().map(|s| s.file.as_str()).collect();
            let source_count = files.len();

            // Collect evidence (cap at 10 entries to keep JSON manageable).
            let evidence: Vec<Evidence> = sigs
                .iter()
                .take(10)
                .map(|s| Evidence {
                    file: s.file.clone(),
                    line: s.line,
                    snippet: s.snippet.clone(),
                })
                .collect();

            // Look up label and category from taxonomy or extra rules.
            let (title, category) = resolve_label_category(&tag);

            // Synthesize description.
            let description = synthesize_description(&title, source_count, &evidence);

            Topic {
                slug: tag,
                title,
                description,
                category,
                evidence,
                source_count,
            }
        })
        .collect();

    topics.sort_by(|a, b| b.source_count.cmp(&a.source_count));
    topics
}

fn resolve_label_category(tag: &str) -> (String, String) {
    // Try taxonomy first.
    if let Some(skill) = TAXONOMY.get(tag) {
        return (skill.label.to_string(), skill.category.to_string());
    }
    // Try extra rules.
    for (extra_tag, cat, _) in EXTRA_RULES.iter() {
        if *extra_tag == tag {
            let label = tag
                .split('-')
                .map(|w| {
                    let mut c = w.chars();
                    match c.next() {
                        Some(f) => f.to_uppercase().to_string() + c.as_str(),
                        None => String::new(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            return (label, cat.to_string());
        }
    }
    // Fallback: title-case the slug.
    let label = tag
        .split('-')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().to_string() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    (label, "Other".to_string())
}

fn synthesize_description(title: &str, source_count: usize, evidence: &[Evidence]) -> String {
    let file_word = if source_count == 1 { "file" } else { "files" };

    // Pick up to 3 distinct file paths as context.
    let mut example_files: Vec<&str> = Vec::new();
    let mut seen = HashSet::new();
    for ev in evidence {
        if seen.insert(ev.file.as_str()) {
            example_files.push(&ev.file);
        }
        if example_files.len() >= 3 {
            break;
        }
    }

    let examples = example_files.join(", ");
    format!(
        "{title} is used in {source_count} {file_word} across the lead-gen codebase. Found in: {examples}."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(tag: &str, file: &str, line: usize) -> RawSignal {
        RawSignal {
            tag: tag.to_string(),
            file: file.to_string(),
            line,
            snippet: format!("snippet from {file}"),
        }
    }

    #[test]
    fn aggregate_groups_by_tag() {
        let signals = vec![
            sig("react", "app.tsx", 1),
            sig("react", "page.tsx", 5),
            sig("typescript", "app.tsx", 1),
        ];
        let topics = aggregate(signals);
        assert_eq!(topics.len(), 2);
        let react = topics.iter().find(|t| t.slug == "react").unwrap();
        assert_eq!(react.source_count, 2);
        assert_eq!(react.evidence.len(), 2);
    }

    #[test]
    fn aggregate_sorts_by_source_count_desc() {
        let signals = vec![
            sig("react", "a.tsx", 1),
            sig("react", "b.tsx", 1),
            sig("react", "c.tsx", 1),
            sig("typescript", "a.tsx", 1),
        ];
        let topics = aggregate(signals);
        assert_eq!(topics[0].slug, "react");
        assert_eq!(topics[0].source_count, 3);
        assert_eq!(topics[1].slug, "typescript");
        assert_eq!(topics[1].source_count, 1);
    }

    #[test]
    fn aggregate_deduplicates_source_files() {
        let signals = vec![
            sig("react", "app.tsx", 1),
            sig("react", "app.tsx", 10), // same file
        ];
        let topics = aggregate(signals);
        let react = topics.iter().find(|t| t.slug == "react").unwrap();
        assert_eq!(react.source_count, 1, "source_count should deduplicate files");
    }

    #[test]
    fn aggregate_caps_evidence_at_10() {
        let signals: Vec<RawSignal> = (0..15)
            .map(|i| sig("react", &format!("file{i}.tsx"), i))
            .collect();
        let topics = aggregate(signals);
        let react = topics.iter().find(|t| t.slug == "react").unwrap();
        assert_eq!(react.evidence.len(), 10, "evidence should be capped at 10");
        assert_eq!(react.source_count, 15, "source_count should reflect all files");
    }

    #[test]
    fn resolve_taxonomy_label() {
        let (title, category) = resolve_label_category("graphql");
        assert_eq!(title, "GraphQL");
        assert_eq!(category, "Architecture");
    }

    #[test]
    fn resolve_extra_rule_label() {
        let (title, category) = resolve_label_category("dataloader-pattern");
        assert_eq!(title, "Dataloader Pattern");
        assert_eq!(category, "Architecture");
    }

    #[test]
    fn resolve_unknown_tag_falls_back() {
        let (title, category) = resolve_label_category("my-custom-thing");
        assert_eq!(title, "My Custom Thing");
        assert_eq!(category, "Other");
    }

    #[test]
    fn description_singular_file() {
        let evidence = vec![Evidence {
            file: "app.tsx".to_string(),
            line: 1,
            snippet: "test".to_string(),
        }];
        let desc = synthesize_description("React", 1, &evidence);
        assert!(desc.contains("1 file"), "should say 'file' not 'files': {desc}");
    }

    #[test]
    fn description_plural_files() {
        let evidence = vec![
            Evidence { file: "a.tsx".to_string(), line: 1, snippet: "test".to_string() },
            Evidence { file: "b.tsx".to_string(), line: 1, snippet: "test".to_string() },
        ];
        let desc = synthesize_description("React", 5, &evidence);
        assert!(desc.contains("5 files"), "should say 'files': {desc}");
    }

    #[test]
    fn description_limits_to_3_files() {
        let evidence: Vec<Evidence> = (0..5)
            .map(|i| Evidence {
                file: format!("file{i}.tsx"),
                line: 1,
                snippet: "test".to_string(),
            })
            .collect();
        let desc = synthesize_description("React", 5, &evidence);
        // Should mention file0, file1, file2 but not file3/file4
        assert!(desc.contains("file0.tsx"));
        assert!(desc.contains("file2.tsx"));
        assert!(!desc.contains("file3.tsx"));
    }

    #[test]
    fn embed_text_format() {
        let topic = Topic {
            slug: "react".to_string(),
            title: "React".to_string(),
            description: "React is used in 5 files.".to_string(),
            category: "Frontend".to_string(),
            evidence: vec![],
            source_count: 5,
        };
        assert_eq!(topic.embed_text(), "React\n\nReact is used in 5 files.");
    }

    #[test]
    fn aggregate_empty_signals() {
        let topics = aggregate(vec![]);
        assert!(topics.is_empty());
    }
}
