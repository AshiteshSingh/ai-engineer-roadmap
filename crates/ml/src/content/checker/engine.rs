//! The content checking engine — a **verbatim** port of the historical
//! `bin/content_gate.rs::run_scan` corpus pass, with every former `const`
//! replaced by a per-lesson resolved [`Profile`] field.
//!
//! Genericity without regression: the corpus-global structures (link sets,
//! reciprocity `need_backlink`, the quality `qmap`) are still built across
//! **all** lessons regardless of profile, so a per-slug override
//! (e.g. `rag → overview`) never perturbs another lesson's cross-lesson
//! Q1/R3/R4 verdict. Only *issue emission* for a given lesson is gated by
//! that lesson's profile.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::content::profiles::ProfileSet;
use crate::content::similarity::SimilarityMatrix;
use crate::content::{readability, Lesson};

use super::scan::{
    collect_links, prose_words, section_body, shingle_set, structure_check, jaccard,
    ContentMetrics, LinkSets,
};

/// Categories (from `parser::category_from_slug`) that are NOT
/// AI-engineering topics. With `ai_only`, lessons in these categories leave
/// the loop entirely — not gated, not failed, not counted.
const NON_AI: [&str; 4] = [
    "Cloud Platforms",
    "AWS Deep Dives",
    "Software Engineering",
    "Other",
];

#[derive(Debug, Clone)]
pub struct LessonOutcome {
    pub slug: String,
    pub file: String,
    /// Resolved profile name (e.g. `deep-dive`, `overview`). Not serialized
    /// into the content worklist — kept for `hub-gate` reporting.
    pub profile_name: String,
    pub structure_ok: bool,
    pub relation_ok: bool,
    pub quality_ok: bool,
    pub ok: bool,
    pub structure_issues: Vec<String>,
    pub relation_issues: Vec<String>,
    pub quality_issues: Vec<String>,
    pub metrics: ContentMetrics,
}

pub struct EngineReport {
    pub generated_at_unix: u64,
    pub warnings: Vec<String>,
    pub skipped: Vec<String>,
    pub excluded_non_ai: Vec<String>,
    /// Every lesson, in `parser::load_lessons` order (slug-sorted).
    pub lessons: Vec<LessonOutcome>,
    pub worklist: Vec<String>,
    pub summary_total: usize,
    pub summary_skipped: usize,
    pub summary_pass: usize,
    pub summary_fail: usize,
    /// `!no_quality` — surfaced verbatim in the worklist `thresholds`.
    pub quality_enabled: bool,
}

struct QData {
    mm: Option<HashSet<u64>>,
    ri: Option<HashSet<u64>>,
    mm_prose: usize,
    ri_prose: usize,
}

/// Run the full content gate over an already-loaded corpus.
///
/// * `lessons` — from `parser::load_lessons` (slug-sorted).
/// * `canonical` — `LESSON_SLUGS` from articles.ts, or the loaded slugs.
/// * `matrix` — similarity matrix for R4 (None ⇒ R4 skipped + warning).
/// * `profiles` — per-slug profile resolution.
/// * `no_quality` — disables the quality tier (Q0–Q3) globally.
/// * `ai_only` — restrict summary/worklist to AI-engineering categories.
pub fn run_content(
    lessons: &[Lesson],
    canonical: &[String],
    matrix: Option<&SimilarityMatrix>,
    profiles: &ProfileSet,
    no_quality: bool,
    ai_only: bool,
) -> EngineReport {
    let loaded: BTreeSet<String> = lessons.iter().map(|l| l.slug.clone()).collect();
    let canonical_set: HashSet<&str> = canonical.iter().map(|s| s.as_str()).collect();

    // Valid link targets: canonical ∪ on-disk (avoids false R2 on real files).
    let mut valid_targets: HashSet<String> = loaded.iter().cloned().collect();
    valid_targets.extend(canonical.iter().cloned());

    let mut warnings = Vec::new();
    if matrix.is_none() {
        warnings.push("similarity_matrix_missing".to_string());
    }

    // Per-lesson link sets (one pass), for R3 reciprocity.
    let mut links: HashMap<String, LinkSets> = HashMap::new();
    for l in lessons {
        links.insert(l.slug.clone(), collect_links(&l.content));
    }
    let all_targets: HashMap<&str, HashSet<&str>> = links
        .iter()
        .map(|(s, ls)| (s.as_str(), ls.all.iter().map(|x| x.as_str()).collect()))
        .collect();

    // Reciprocity gaps: A links to B in a Related section, B does not link
    // back. need_backlink[B] = {A, ...} → B is enqueued to add B→A.
    let mut need_backlink: HashMap<String, BTreeSet<String>> = HashMap::new();
    for l in lessons {
        let a = l.slug.as_str();
        for b in &links[a].in_relation_section {
            if b == a || !loaded.contains(b) {
                continue;
            }
            let b_links_back = all_targets.get(b.as_str()).is_some_and(|s| s.contains(a));
            if !b_links_back {
                need_backlink.entry(b.clone()).or_default().insert(a.to_string());
            }
        }
    }

    // ── Quality corpus pass (Q1 needs cross-lesson comparison) ──────
    // Built for ALL lessons whenever quality is globally on, independent of
    // any per-slug profile, so cross-lesson comparisons are unperturbed.
    let quality_on = !no_quality;
    let mut qmap: HashMap<String, QData> = HashMap::new();
    if quality_on {
        for l in lessons {
            let (_, prof) = profiles.resolve(&l.slug);
            let k = prof.quality.shingle_k;
            let mm = section_body(&l.content, "Mental Model");
            let ri = section_body(&l.content, "Runtime Internals");
            let mm_prose = mm.as_deref().map(prose_words).unwrap_or(0);
            let ri_prose = ri.as_deref().map(prose_words).unwrap_or(0);
            let mm_sh = mm.as_deref().map(|s| shingle_set(s, k));
            let ri_sh = ri.as_deref().map(|s| shingle_set(s, k));
            qmap.insert(
                l.slug.clone(),
                QData {
                    mm: mm_sh,
                    ri: ri_sh,
                    mm_prose,
                    ri_prose,
                },
            );
        }
    }

    let mut reports: Vec<LessonOutcome> = Vec::with_capacity(lessons.len());
    for l in lessons {
        let slug = l.slug.clone();
        let (profile_name, p) = profiles.resolve(&slug);

        let (structure_issues, metrics) = structure_check(&l.content, &p.structure);
        let structure_ok = structure_issues.is_empty();

        let mut relation_issues: Vec<String> = Vec::new();
        let ls = &links[&slug];

        if p.relation.enabled {
            // R1 — minimum outbound cross-refs.
            if metrics.cross_refs < p.relation.min_crossrefs {
                relation_issues.push(format!(
                    "Relations: only {} cross-refs (min {} for a connected lesson)",
                    metrics.cross_refs, p.relation.min_crossrefs
                ));
            }

            // R2 — no broken slug links.
            if p.relation.check_broken_links {
                let mut broken: BTreeSet<&str> = BTreeSet::new();
                for t in &ls.all {
                    if !valid_targets.contains(t) {
                        broken.insert(t.as_str());
                    }
                }
                if !broken.is_empty() {
                    let list =
                        broken.iter().map(|s| format!("/{s}")).collect::<Vec<_>>().join(", ");
                    relation_issues.push(format!(
                        "Relations: broken cross-ref link(s) to non-existent lesson(s): {list}"
                    ));
                }
            }

            // R3 — reciprocity. The obligation falls solely on the lesson
            // that must ADD the outgoing back-link (resolvable by editing
            // only that lesson on its own tick). We deliberately do NOT
            // also fail the lesson that already links out.
            if p.relation.check_reciprocity {
                if let Some(sources) = need_backlink.get(&slug) {
                    for a in sources {
                        relation_issues.push(format!(
                            "Relations: add reciprocal link back to /{a} (referenced from /{a}'s Related/Prerequisite section)"
                        ));
                    }
                }
            }

            // R4 — similarity top-k coverage.
            if let Some(m) = &matrix {
                let top = m.top_k(&slug, p.relation.topk);
                if !top.is_empty() {
                    let linked: &HashSet<&str> =
                        all_targets.get(slug.as_str()).expect("links computed for every lesson");
                    let mut missing: Vec<String> = Vec::new();
                    let mut hits = 0usize;
                    for (cand, _) in &top {
                        if linked.contains(cand.as_str()) {
                            hits += 1;
                        } else {
                            missing.push(format!("/{cand}"));
                        }
                    }
                    if hits < p.relation.topk_hits {
                        relation_issues.push(format!(
                            "Relations: only {hits}/{} top-similar lessons cross-referenced (min {}): missing high-similarity links to {}",
                            p.relation.topk, p.relation.topk_hits,
                            missing.join(", ")
                        ));
                    }
                }
            }
        }

        let relation_ok = relation_issues.is_empty();

        // ── Quality tier (Q0–Q3) — blocking unless globally off or the
        // lesson's profile disables it ──────────────────────────────
        let mut quality_issues: Vec<String> = Vec::new();
        if quality_on && p.quality.enabled {
            if let Some(q) = qmap.get(&slug) {
                // Q1 — MM / RI cross-lesson near-duplicate (boilerplate)
                for (label, mine) in [("Mental Model", &q.mm), ("Runtime Internals", &q.ri)] {
                    if let Some(mine) = mine {
                        let mut best = 0.0f32;
                        let mut who = String::new();
                        for (os, oq) in &qmap {
                            if os == &slug {
                                continue;
                            }
                            let other = if label == "Mental Model" { &oq.mm } else { &oq.ri };
                            if let Some(other) = other {
                                let j = jaccard(mine, other);
                                if j > best {
                                    best = j;
                                    who = os.clone();
                                }
                            }
                        }
                        if best >= p.quality.dup_jaccard {
                            quality_issues.push(format!(
                                "Q1: {label} section is {best:.2} Jaccard-similar to /{who} (ceiling {:.2}) — rewrite it lesson-specifically, drop the template",
                                p.quality.dup_jaccard
                            ));
                        }
                    }
                }
                // Q2 — readability / substance (reuses readability.rs)
                let rm = readability::analyze_lesson(l).overall;
                if rm.flesch_kincaid_grade < p.quality.fk_min
                    || rm.flesch_kincaid_grade > p.quality.fk_max
                {
                    quality_issues.push(format!(
                        "Q2: Flesch-Kincaid {:.1} outside [{:.0},{:.0}]",
                        rm.flesch_kincaid_grade, p.quality.fk_min, p.quality.fk_max
                    ));
                }
                if rm.technical_term_density < p.quality.tech_min {
                    quality_issues.push(format!(
                        "Q2: technical-term density {:.4} < {:.3} (filler / not substantive)",
                        rm.technical_term_density, p.quality.tech_min
                    ));
                }
                // Q3 — section prose floors
                if q.mm.is_some() && q.mm_prose < p.quality.section_min_prose {
                    quality_issues.push(format!(
                        "Q3: Mental Model section has {} prose words (min {})",
                        q.mm_prose, p.quality.section_min_prose
                    ));
                }
                if q.ri.is_some() && q.ri_prose < p.quality.section_min_prose {
                    quality_issues.push(format!(
                        "Q3: Runtime Internals section has {} prose words (min {})",
                        q.ri_prose, p.quality.section_min_prose
                    ));
                }
            }
        }
        let quality_ok = quality_issues.is_empty();
        let ok = structure_ok && relation_ok && quality_ok;
        reports.push(LessonOutcome {
            slug: slug.clone(),
            file: format!("content/{slug}.md"),
            profile_name,
            structure_ok,
            relation_ok,
            quality_ok,
            ok,
            structure_issues,
            relation_issues,
            quality_issues,
            metrics,
        });
    }

    // Skipped = canonical slugs with no markdown on disk (stubs).
    let skipped: Vec<String> = canonical
        .iter()
        .filter(|s| !loaded.contains(s.as_str()) && canonical_set.contains(s.as_str()))
        .cloned()
        .collect();

    // AI-topics-only scope: lessons in non-AI categories leave the loop
    // entirely — not gated, not failed, not counted.
    let non_ai_slugs: BTreeSet<String> = if ai_only {
        lessons
            .iter()
            .filter(|l| NON_AI.contains(&l.category.as_str()))
            .map(|l| l.slug.clone())
            .collect()
    } else {
        BTreeSet::new()
    };
    let excluded_non_ai: Vec<String> = non_ai_slugs.iter().cloned().collect();

    let scoped: Vec<&LessonOutcome> = reports
        .iter()
        .filter(|r| !non_ai_slugs.contains(&r.slug))
        .collect();
    let scoped_total = scoped.len();
    let pass = scoped.iter().filter(|r| r.ok).count();
    let fail = scoped_total - pass;

    // Worklist: failing in-scope slugs, most-issues-first, slug-asc tiebreak.
    let mut failing: Vec<&LessonOutcome> = scoped.into_iter().filter(|r| !r.ok).collect();
    failing.sort_by(|a, b| {
        let ai = a.structure_issues.len() + a.relation_issues.len() + a.quality_issues.len();
        let bi = b.structure_issues.len() + b.relation_issues.len() + b.quality_issues.len();
        bi.cmp(&ai).then_with(|| a.slug.cmp(&b.slug))
    });
    let worklist: Vec<String> = failing.iter().map(|r| r.slug.clone()).collect();

    let generated_at_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    EngineReport {
        generated_at_unix,
        warnings,
        summary_total: scoped_total + skipped.len(),
        summary_skipped: skipped.len(),
        summary_pass: pass,
        summary_fail: fail,
        skipped,
        excluded_non_ai,
        lessons: reports,
        worklist,
        quality_enabled: !no_quality,
    }
}
