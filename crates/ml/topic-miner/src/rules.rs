//! Compiled regex rule sets for codebase scanning.
//!
//! Each rule maps a regex pattern to a taxonomy tag. The scanner runs these
//! against every line of every source file and emits `RawSignal`s.

use std::sync::LazyLock;

use regex::Regex;

use crate::taxonomy::TAXONOMY;

/// A compiled detection rule: pattern + the taxonomy tag it matches.
pub struct Rule {
    pub tag: &'static str,
    pub regex: Regex,
}

/// All compiled rules, built once from the taxonomy's per-skill patterns.
pub static RULES: LazyLock<Vec<Rule>> = LazyLock::new(|| {
    let mut rules = Vec::new();
    for skill in TAXONOMY.values() {
        for pat in skill.patterns {
            // Compile as case-insensitive by default.
            let re = regex::RegexBuilder::new(pat)
                .case_insensitive(true)
                .build();
            match re {
                Ok(regex) => rules.push(Rule {
                    tag: skill.tag,
                    regex,
                }),
                Err(e) => {
                    eprintln!("WARN: bad regex for {}: {pat} — {e}", skill.tag);
                }
            }
        }
    }
    rules
});

/// Extra rules for detecting patterns NOT in the skill taxonomy
/// (architecture patterns, design patterns, etc.).
pub static EXTRA_RULES: LazyLock<Vec<(&'static str, &'static str, Regex)>> = LazyLock::new(|| {
    let defs: Vec<(&str, &str, &str)> = vec![
        ("dataloader-pattern", "Architecture", r#"[Dd]ata[Ll]oader|\.load\(|\.loadMany\("#),
        ("middleware-pattern", "Architecture", r#"middleware|app\.use\("#),
        ("schema-first", "Architecture", r#"typeDefs|schema\.graphql|\.graphql$"#),
        ("server-components", "Frontend", "use server|use client|server-only"),
        ("streaming", "Architecture", "ReadableStream|TransformStream|streamText"),
        ("caching", "Architecture", r#"cache\(|unstable_cache|revalidate"#),
    ];

    defs.into_iter()
        .filter_map(|(tag, cat, pat)| {
            regex::RegexBuilder::new(pat)
                .case_insensitive(true)
                .build()
                .ok()
                .map(|re| (tag, cat, re))
        })
        .collect()
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_compile_without_errors() {
        // Accessing RULES forces LazyLock to compile all patterns.
        assert!(!RULES.is_empty(), "RULES should not be empty");
    }

    #[test]
    fn extra_rules_compile_without_errors() {
        assert!(!EXTRA_RULES.is_empty(), "EXTRA_RULES should not be empty");
        assert_eq!(EXTRA_RULES.len(), 6, "expected 6 extra rules");
    }

    #[test]
    fn rules_have_valid_taxonomy_tags() {
        use crate::taxonomy::TAXONOMY;
        for rule in RULES.iter() {
            assert!(
                TAXONOMY.contains_key(rule.tag),
                "rule tag '{}' not in taxonomy",
                rule.tag
            );
        }
    }

    #[test]
    fn extra_rules_match_expected_patterns() {
        let tags: Vec<&str> = EXTRA_RULES.iter().map(|(t, _, _)| *t).collect();
        assert!(tags.contains(&"dataloader-pattern"));
        assert!(tags.contains(&"server-components"));
        assert!(tags.contains(&"streaming"));
    }

    #[test]
    fn rules_match_sample_lines() {
        let react_rules: Vec<&Rule> = RULES.iter().filter(|r| r.tag == "react").collect();
        assert!(!react_rules.is_empty());
        let matches = react_rules.iter().any(|r| r.regex.is_match("import React from 'react'"));
        assert!(matches, "react rules should match react import");
    }
}
