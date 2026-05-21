//! Config-driven quality profiles — the single source of truth for the
//! thresholds the content gate (and `hub-gate`) enforce.
//!
//! Replaces the scattered `const` blocks that used to live in
//! `bin/content_gate.rs` and `crates/udemy/src/generate/quality.rs`. The
//! built-in `deep-dive` profile is **byte-identical** to the historical
//! Python `check_quality()` gate, so loading no config (or a config whose
//! `deep-dive` is unchanged) preserves every existing pass/fail verdict.
//!
//! Resolution is *purely explicit*: a slug uses
//! `assignments[slug]` if present, otherwise `default_profile`. There is no
//! word-count heuristic — silent reclassification would break the
//! byte-identical regression contract.
//!
//! See `crates/ml/quality-profiles.toml` for the on-disk config and the
//! provenance comments on every threshold.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

// ── Built-in `deep-dive` constants (the historical content_gate.rs values) ──
// These are the canonical source; udemy's `generate/quality.rs` mirrors the
// structure subset and is drift-guarded by a test in `checker`.

const DD_MIN_WORD_COUNT: usize = 1500;
const DD_MIN_CODE_BLOCKS: usize = 2;
const DD_MIN_CROSS_REFS: usize = 1;
const DD_MIN_H2_SECTIONS: usize = 3;

const DD_RELATION_MIN_CROSSREFS: usize = 3;
const DD_RELATION_TOPK: usize = 5;
const DD_RELATION_TOPK_HITS: usize = 2;

const DD_Q_DUP_JACCARD: f32 = 0.50;
const DD_Q_SHINGLE_K: usize = 8;
const DD_Q_FK_MIN: f32 = 10.0;
const DD_Q_FK_MAX: f32 = 22.0;
const DD_Q_TECH_MIN: f32 = 0.010;
const DD_Q_SECTION_MIN_PROSE: usize = 120;

// serde default thunks — a partial TOML table inherits the deep-dive value
// for any key it omits, so a profile only needs to spell out what differs.
fn d_min_word_count() -> usize { DD_MIN_WORD_COUNT }
fn d_min_code_blocks() -> usize { DD_MIN_CODE_BLOCKS }
fn d_min_cross_refs() -> usize { DD_MIN_CROSS_REFS }
fn d_min_h2_sections() -> usize { DD_MIN_H2_SECTIONS }
fn d_true() -> bool { true }
fn d_relation_min_crossrefs() -> usize { DD_RELATION_MIN_CROSSREFS }
fn d_relation_topk() -> usize { DD_RELATION_TOPK }
fn d_relation_topk_hits() -> usize { DD_RELATION_TOPK_HITS }
fn d_q_dup_jaccard() -> f32 { DD_Q_DUP_JACCARD }
fn d_q_shingle_k() -> usize { DD_Q_SHINGLE_K }
fn d_q_fk_min() -> f32 { DD_Q_FK_MIN }
fn d_q_fk_max() -> f32 { DD_Q_FK_MAX }
fn d_q_tech_min() -> f32 { DD_Q_TECH_MIN }
fn d_q_section_min_prose() -> usize { DD_Q_SECTION_MIN_PROSE }

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructureCfg {
    #[serde(default = "d_min_word_count")]
    pub min_word_count: usize,
    #[serde(default = "d_min_code_blocks")]
    pub min_code_blocks: usize,
    #[serde(default = "d_min_cross_refs")]
    pub min_cross_refs: usize,
    #[serde(default = "d_min_h2_sections")]
    pub min_h2_sections: usize,
    #[serde(default = "d_true")]
    pub require_h1: bool,
    #[serde(default = "d_true")]
    pub require_mental_model: bool,
    #[serde(default = "d_true")]
    pub require_runtime_internals: bool,
    #[serde(default = "d_true")]
    pub reject_mermaid: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelationCfg {
    #[serde(default = "d_true")]
    pub enabled: bool,
    #[serde(default = "d_relation_min_crossrefs")]
    pub min_crossrefs: usize,
    #[serde(default = "d_relation_topk")]
    pub topk: usize,
    #[serde(default = "d_relation_topk_hits")]
    pub topk_hits: usize,
    #[serde(default = "d_true")]
    pub check_reciprocity: bool,
    #[serde(default = "d_true")]
    pub check_broken_links: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QualityCfg {
    #[serde(default = "d_true")]
    pub enabled: bool,
    #[serde(default = "d_q_dup_jaccard")]
    pub dup_jaccard: f32,
    #[serde(default = "d_q_shingle_k")]
    pub shingle_k: usize,
    #[serde(default = "d_q_fk_min")]
    pub fk_min: f32,
    #[serde(default = "d_q_fk_max")]
    pub fk_max: f32,
    #[serde(default = "d_q_tech_min")]
    pub tech_min: f32,
    #[serde(default = "d_q_section_min_prose")]
    pub section_min_prose: usize,
}

impl Default for StructureCfg {
    fn default() -> Self {
        StructureCfg {
            min_word_count: DD_MIN_WORD_COUNT,
            min_code_blocks: DD_MIN_CODE_BLOCKS,
            min_cross_refs: DD_MIN_CROSS_REFS,
            min_h2_sections: DD_MIN_H2_SECTIONS,
            require_h1: true,
            require_mental_model: true,
            require_runtime_internals: true,
            reject_mermaid: true,
        }
    }
}

impl Default for RelationCfg {
    fn default() -> Self {
        RelationCfg {
            enabled: true,
            min_crossrefs: DD_RELATION_MIN_CROSSREFS,
            topk: DD_RELATION_TOPK,
            topk_hits: DD_RELATION_TOPK_HITS,
            check_reciprocity: true,
            check_broken_links: true,
        }
    }
}

impl Default for QualityCfg {
    fn default() -> Self {
        QualityCfg {
            enabled: true,
            dup_jaccard: DD_Q_DUP_JACCARD,
            shingle_k: DD_Q_SHINGLE_K,
            fk_min: DD_Q_FK_MIN,
            fk_max: DD_Q_FK_MAX,
            tech_min: DD_Q_TECH_MIN,
            section_min_prose: DD_Q_SECTION_MIN_PROSE,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    #[serde(default)]
    pub structure: StructureCfg,
    #[serde(default)]
    pub relation: RelationCfg,
    #[serde(default)]
    pub quality: QualityCfg,
}

impl Profile {
    /// The historical content_gate.rs / Python `check_quality()` profile.
    pub fn deep_dive() -> Self {
        Profile::default()
    }

    /// Relaxed profile for short overview / entry lessons (e.g. `rag`):
    /// lower word floor, no MM/RI requirement, quality tier off.
    pub fn overview() -> Self {
        Profile {
            structure: StructureCfg {
                min_word_count: 500,
                min_code_blocks: 1,
                min_cross_refs: 1,
                min_h2_sections: 2,
                require_h1: true,
                require_mental_model: false,
                require_runtime_internals: false,
                reject_mermaid: true,
            },
            relation: RelationCfg {
                enabled: true,
                min_crossrefs: 1,
                topk: 5,
                topk_hits: 1,
                check_reciprocity: false,
                check_broken_links: true,
            },
            quality: QualityCfg { enabled: false, ..QualityCfg::default() },
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileSet {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default = "default_profile_name")]
    pub default_profile: String,
    #[serde(default)]
    pub assignments: BTreeMap<String, String>,
    #[serde(default)]
    pub profiles: BTreeMap<String, Profile>,
}

fn default_profile_name() -> String {
    "deep-dive".to_string()
}

impl ProfileSet {
    /// The zero-config set: `deep-dive` (== historical consts) + `overview`,
    /// default `deep-dive`, no per-slug assignments. With this set every
    /// slug resolves to `deep-dive`, so behaviour is identical to the
    /// pre-refactor gate.
    pub fn builtin() -> Self {
        let mut profiles = BTreeMap::new();
        profiles.insert("deep-dive".to_string(), Profile::deep_dive());
        profiles.insert("overview".to_string(), Profile::overview());
        ProfileSet {
            schema_version: 1,
            default_profile: "deep-dive".to_string(),
            assignments: BTreeMap::new(),
            profiles,
        }
    }

    /// Load the TOML config at `path`. On a missing file or any parse error,
    /// fall back to [`ProfileSet::builtin`] and log to stderr (the notice is
    /// intentionally NOT surfaced in the gate's worklist `warnings`, which
    /// is a stable loop-tooling contract).
    ///
    /// `deep-dive` is always guaranteed present (injected if the file omits
    /// it) so `default_profile` is always resolvable.
    pub fn load_or_builtin(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(text) => match toml::from_str::<ProfileSet>(&text) {
                Ok(mut set) => {
                    set.profiles
                        .entry("deep-dive".to_string())
                        .or_insert_with(Profile::deep_dive);
                    set.profiles
                        .entry("overview".to_string())
                        .or_insert_with(Profile::overview);
                    set
                }
                Err(e) => {
                    eprintln!(
                        "quality-profiles: {} failed to parse ({e}); using built-in defaults",
                        path.display()
                    );
                    ProfileSet::builtin()
                }
            },
            Err(_) => ProfileSet::builtin(),
        }
    }

    /// Resolve a slug to `(profile_name, profile)`. Explicit only:
    /// `assignments[slug]` if present and the named profile exists, else
    /// `default_profile`, else the built-in `deep-dive`.
    pub fn resolve(&self, slug: &str) -> (String, Profile) {
        let name = self
            .assignments
            .get(slug)
            .filter(|n| self.profiles.contains_key(*n))
            .cloned()
            .unwrap_or_else(|| self.default_profile.clone());
        let profile = self
            .profiles
            .get(&name)
            .cloned()
            .unwrap_or_else(Profile::deep_dive);
        (name, profile)
    }

    /// The profile used for the global `thresholds` block of the worklist
    /// (the default profile). Kept == `deep-dive` so the serialized
    /// thresholds stay byte-identical even when per-slug overrides exist.
    pub fn default_profile(&self) -> Profile {
        self.profiles
            .get(&self.default_profile)
            .cloned()
            .unwrap_or_else(Profile::deep_dive)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_dive_matches_historical_consts() {
        let p = Profile::deep_dive();
        assert_eq!(p.structure.min_word_count, 1500);
        assert_eq!(p.structure.min_code_blocks, 2);
        assert_eq!(p.structure.min_cross_refs, 1);
        assert_eq!(p.structure.min_h2_sections, 3);
        assert!(p.structure.require_h1);
        assert!(p.structure.require_mental_model);
        assert!(p.structure.require_runtime_internals);
        assert!(p.structure.reject_mermaid);
        assert!(p.relation.enabled);
        assert_eq!(p.relation.min_crossrefs, 3);
        assert_eq!(p.relation.topk, 5);
        assert_eq!(p.relation.topk_hits, 2);
        assert!(p.relation.check_reciprocity);
        assert!(p.relation.check_broken_links);
        assert!(p.quality.enabled);
        assert_eq!(p.quality.dup_jaccard, 0.50);
        assert_eq!(p.quality.shingle_k, 8);
        assert_eq!(p.quality.fk_min, 10.0);
        assert_eq!(p.quality.fk_max, 22.0);
        assert_eq!(p.quality.tech_min, 0.010);
        assert_eq!(p.quality.section_min_prose, 120);
    }

    #[test]
    fn builtin_resolves_everything_to_deep_dive() {
        let set = ProfileSet::builtin();
        let (name, p) = set.resolve("anything");
        assert_eq!(name, "deep-dive");
        assert_eq!(p.structure.min_word_count, 1500);
    }

    #[test]
    fn assignment_overrides_default() {
        let toml = r#"
schema_version = 1
default_profile = "deep-dive"
[assignments]
rag = "overview"
[profiles.deep-dive]
[profiles.overview]
structure.min_word_count = 500
structure.require_mental_model = false
structure.require_runtime_internals = false
quality.enabled = false
"#;
        let set: ProfileSet = toml::from_str(toml).unwrap();
        let (rag_name, rag) = set.resolve("rag");
        assert_eq!(rag_name, "overview");
        assert_eq!(rag.structure.min_word_count, 500);
        assert!(!rag.quality.enabled);
        // unspecified field inherits the deep-dive default
        assert_eq!(rag.relation.min_crossrefs, 3);
        let (other_name, other) = set.resolve("transformer-architecture");
        assert_eq!(other_name, "deep-dive");
        assert_eq!(other.structure.min_word_count, 1500);
    }
}
