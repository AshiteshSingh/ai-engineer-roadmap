//! Coursera page parsers — *articles* (`/articles/<slug>`) **and** *courses*
//! (`/learn/<slug>`).
//!
//! Unlike Udemy, Coursera pages are server-rendered, so the shared
//! [`crate::udemy::crawler::UdemyClient`] reqwest path fetches them directly —
//! no Playwright needed.
//!
//! Both shapes map onto the existing corpus model so they flow through the same
//! embed/store/frontend pipeline: one [`Course`] row plus one [`Chapter`] per
//! section. Articles use `category = "Article"`, `price = "Free"`; `/learn/`
//! courses use `category = "Course"`, `price = "Free Trial"` and carry the real
//! rating / review_count / level / duration / enrolled extracted from the
//! page's JSON-LD `Course` block, `__NEXT_DATA__`, and DOM text. `provider`
//! stays `"Coursera"` (bound at the upsert call site).
//!
//! [`parse_coursera_page`] dispatches by URL (`/learn/` → course,
//! `/articles/` → article, else JSON-LD `@type`). [`parse_coursera_links`]
//! discovers both `/articles/` and `/learn/` links so a course's
//! recommendations rail is BFS-followed. The article path is byte-identical to
//! before — standalone `coursera` keeps using the article-only functions.

use std::sync::LazyLock;

use anyhow::Result;
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::Value;
use tracing::info;

use crate::udemy::types::{Chapter, Course};

static JSONLD_SEL: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse("script[type=\"application/ld+json\"]").unwrap());
static H1_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("h1").unwrap());
static HEADING_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("h2, h3").unwrap());
static PARA_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("p").unwrap());
static A_HREF_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("a[href]").unwrap());
/// Containers we prefer to scope body extraction to, in priority order.
static BODY_CONTAINER_SELS: LazyLock<Vec<Selector>> = LazyLock::new(|| {
    ["article", "main", "[role=\"main\"]"]
        .iter()
        .map(|s| Selector::parse(s).unwrap())
        .collect()
});
static NEXT_DATA_SEL: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse("script#__NEXT_DATA__").unwrap());

const ARTICLE_TYPES: &[&str] = &[
    "Article",
    "BlogPosting",
    "TechArticle",
    "NewsArticle",
    "ScholarlyArticle",
    "Report",
];

/// schema.org `@type` values that denote a Coursera `/learn/` course.
const COURSE_TYPES: &[&str] = &["Course", "LearningResource", "CreativeWork"];

/// JSON-LD schema.org Article-ish object embedded in Coursera pages.
#[derive(Debug, Default, Deserialize)]
struct JsonLdArticle {
    headline: Option<String>,
    name: Option<String>,
    description: Option<String>,
    #[serde(rename = "articleBody")]
    article_body: Option<String>,
    image: Option<Value>,
    author: Option<Value>,
    #[serde(rename = "inLanguage")]
    in_language: Option<String>,
}

/// Derive the article slug from a Coursera URL
/// (`https://www.coursera.org/articles/embedding-model` → `embedding-model`).
pub fn slug_from_url(url: &str) -> String {
    url.split(['?', '#'])
        .next()
        .unwrap_or(url)
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("unknown")
        .to_string()
}

/// Collapse runs of whitespace into single spaces and trim.
fn clean_text(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Parse a Coursera article page from pre-fetched HTML + its URL.
///
/// Returns the article as a [`Course`] (so it rides the existing
/// embed/store/frontend pipeline) plus one [`Chapter`] per section heading.
pub fn parse_article_html(html: &str, url: &str) -> Result<(Course, Vec<Chapter>)> {
    let doc = Html::parse_document(html);
    let slug = slug_from_url(url);
    let course_id = format!("coursera-{slug}");

    let jsonld = extract_jsonld_article(&doc);

    // ── Title ───────────────────────────────────────────────────────────
    let title = jsonld
        .as_ref()
        .and_then(|j| j.headline.clone().or_else(|| j.name.clone()))
        .map(|s| clean_text(&s))
        .filter(|s| !s.is_empty())
        .or_else(|| extract_meta(&doc, "og:title"))
        .or_else(|| extract_h1(&doc))
        .unwrap_or_else(|| slug.replace('-', " "));

    // ── Summary / description ───────────────────────────────────────────
    let body_text = extract_body_text(&doc);
    let description = jsonld
        .as_ref()
        .and_then(|j| j.description.clone())
        .map(|s| clean_text(&s))
        .filter(|s| !s.is_empty())
        .or_else(|| extract_meta(&doc, "og:description"))
        .or_else(|| extract_meta(&doc, "description"))
        .or_else(|| {
            let b = jsonld
                .as_ref()
                .and_then(|j| j.article_body.clone())
                .map(|s| clean_text(&s))
                .unwrap_or_else(|| body_text.clone());
            if b.is_empty() {
                None
            } else {
                Some(b.chars().take(600).collect())
            }
        })
        .unwrap_or_default();

    // ── Image ───────────────────────────────────────────────────────────
    let image_url = jsonld
        .as_ref()
        .and_then(|j| j.image.as_ref())
        .and_then(jsonld_image)
        .or_else(|| extract_meta(&doc, "og:image"))
        .unwrap_or_default();

    // ── Language ────────────────────────────────────────────────────────
    let language = jsonld
        .as_ref()
        .and_then(|j| j.in_language.clone())
        .map(|l| normalise_language(&l))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "English".to_string());

    // ── Author (stored in the `instructor` slot) ────────────────────────
    let instructor = jsonld
        .as_ref()
        .and_then(|j| j.author.as_ref())
        .and_then(jsonld_author)
        .or_else(|| extract_meta(&doc, "author"))
        .map(|s| clean_text(&s))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Coursera Staff".to_string());

    // ── Section headings → topics + chapters ────────────────────────────
    let sections = extract_sections(&doc);
    let topics_json = serde_json::to_string(&sections).unwrap_or_else(|_| "[]".to_string());
    let chapters: Vec<Chapter> = sections
        .iter()
        .enumerate()
        .map(|(i, h)| Chapter {
            course_id: course_id.clone(),
            course_title: title.clone(),
            chapter_index: i as u32,
            title: h.clone(),
        })
        .collect();

    let course = Course {
        course_id,
        title,
        url: url.to_string(),
        description,
        instructor,
        level: "All Levels".to_string(),
        rating: 0.0,
        review_count: 0,
        num_students: 0,
        duration_hours: 0.0,
        price: "Free".to_string(),
        language,
        category: "Article".to_string(),
        image_url,
        topics_json,
    };

    info!(
        "Parsed Coursera article: {} ({} sections)",
        course.title,
        chapters.len()
    );
    Ok((course, chapters))
}

/// Extract Coursera `/articles/<slug>` **and** `/learn/<slug>` links from a
/// page's HTML and return fully-qualified URLs (deduplicated). Works on index
/// pages and on individual article/course pages, so a course's
/// recommendations rail is BFS-followed. Used by the unified `rag-deep-scrape`
/// Coursera crawl.
pub fn parse_coursera_links(html: &str) -> Vec<String> {
    let doc = Html::parse_document(html);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();

    // One dedup closure (single mutable borrow of `seen`); article/course
    // validity is checked inline so the two rule sets stay distinct.
    let mut push = |key: String, url: String, out: &mut Vec<String>| {
        if seen.insert(key) {
            out.push(url);
        }
    };

    // Strategy 1: <a href> attributes.
    for el in doc.select(&A_HREF_SEL) {
        if let Some(href) = el.value().attr("href") {
            if let Some(slug) = article_slug_from_href(href) {
                if is_article_slug(&slug) {
                    push(
                        format!("a:{slug}"),
                        format!("https://www.coursera.org/articles/{slug}"),
                        &mut out,
                    );
                }
            }
            if let Some(slug) = course_slug_from_href(href) {
                if is_course_slug(&slug) {
                    push(
                        format!("l:{slug}"),
                        format!("https://www.coursera.org/learn/{slug}"),
                        &mut out,
                    );
                }
            }
        }
    }

    // Strategy 2: raw-HTML scan (catches links embedded in inline JSON / Next
    // data payloads that aren't real <a> elements).
    let mut rest = html;
    while let Some(idx) = rest.find("/articles/") {
        let after = &rest[idx + "/articles/".len()..];
        let slug: String = after
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect();
        if is_article_slug(&slug) {
            push(
                format!("a:{slug}"),
                format!("https://www.coursera.org/articles/{slug}"),
                &mut out,
            );
        }
        rest = &after[slug.len().min(after.len())..];
        if rest.is_empty() {
            break;
        }
    }
    let mut rest = html;
    while let Some(idx) = rest.find("/learn/") {
        let after = &rest[idx + "/learn/".len()..];
        let slug: String = after
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect();
        if is_course_slug(&slug) {
            push(
                format!("l:{slug}"),
                format!("https://www.coursera.org/learn/{slug}"),
                &mut out,
            );
        }
        rest = &after[slug.len().min(after.len())..];
        if rest.is_empty() {
            break;
        }
    }

    out
}

/// Article-only discovery (back-compat). Standalone `coursera` uses this, so
/// its crawl frontier is provably unchanged: the `/articles/` subset of
/// [`parse_coursera_links`], in the same order, deduped identically.
pub fn parse_articles_index(html: &str) -> Vec<String> {
    parse_coursera_links(html)
        .into_iter()
        .filter(|u| u.contains("/articles/"))
        .collect()
}

/// Dispatch a Coursera page to the right parser. `/articles/` → the verbatim
/// [`parse_article_html`] (byte-identical to before); `/learn/` →
/// [`parse_course_html`]; ambiguous URLs route by JSON-LD `@type`.
pub fn parse_coursera_page(html: &str, url: &str) -> Result<(Course, Vec<Chapter>)> {
    if url.contains("/articles/") {
        return parse_article_html(html, url);
    }
    if url.contains("/learn/") {
        return parse_course_html(html, url);
    }
    let doc = Html::parse_document(html);
    if has_course_jsonld(&doc) {
        parse_course_html(html, url)
    } else {
        parse_article_html(html, url)
    }
}

/// Parse a Coursera `/learn/<slug>` course page. Tier 1 JSON-LD `Course`
/// (reliable title/description/rating/review_count), Tier 2 `__NEXT_DATA__`
/// (fills level/duration/enrolled/skills/modules), Tier 3 og:/meta + DOM text
/// scans. Returns the course as a [`Course`] plus one [`Chapter`] per module.
pub fn parse_course_html(html: &str, url: &str) -> Result<(Course, Vec<Chapter>)> {
    let doc = Html::parse_document(html);
    let slug = slug_from_url(url);
    let course_id = format!("coursera-{slug}");

    // Tier 1: JSON-LD Course.   Tier 2: __NEXT_DATA__ (fills gaps).
    let mut f = extract_jsonld_course(&doc);
    if let Some(nd) = extract_next_data_course(&doc, &slug) {
        if f.title.is_none() {
            f.title = nd.title;
        }
        if f.description.is_none() {
            f.description = nd.description;
        }
        if f.level.is_none() {
            f.level = nd.level;
        }
        if f.instructor.is_none() {
            f.instructor = nd.instructor;
        }
        if f.image.is_none() {
            f.image = nd.image;
        }
        if f.language.is_none() {
            f.language = nd.language;
        }
        if f.duration_hours.is_none() {
            f.duration_hours = nd.duration_hours;
        }
        if f.rating.is_none() {
            f.rating = nd.rating;
        }
        if f.review_count.is_none() {
            f.review_count = nd.review_count;
        }
        if f.num_students.is_none() {
            f.num_students = nd.num_students;
        }
        if f.sections.is_empty() {
            f.sections = nd.sections;
        }
    }

    // Tier 3: og:/meta + DOM/text fallbacks.
    let body_text = extract_body_text(&doc);
    let full_text = doc.root_element().text().collect::<String>();

    let title = f
        .title
        .map(|s| clean_text(&s))
        .filter(|s| !s.is_empty())
        .or_else(|| extract_meta(&doc, "og:title"))
        .or_else(|| extract_h1(&doc))
        .unwrap_or_else(|| slug.replace('-', " "));

    let description = f
        .description
        .map(|s| clean_text(&s))
        .filter(|s| !s.is_empty())
        .or_else(|| extract_meta(&doc, "og:description"))
        .or_else(|| extract_meta(&doc, "description"))
        .or_else(|| {
            if body_text.is_empty() {
                None
            } else {
                Some(body_text.chars().take(600).collect())
            }
        })
        .unwrap_or_default();

    let image_url = f
        .image
        .filter(|s| !s.is_empty())
        .or_else(|| extract_meta(&doc, "og:image"))
        .unwrap_or_default();

    let language = f
        .language
        .map(|l| normalise_language(&l))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "English".to_string());

    let instructor = f
        .instructor
        .map(|s| clean_text(&s))
        .filter(|s| !s.is_empty())
        .or_else(|| extract_meta(&doc, "author"))
        .unwrap_or_else(|| "Coursera".to_string());

    let level = f
        .level
        .map(|s| normalise_level(&s))
        .filter(|s| !s.is_empty())
        .or_else(|| extract_level_text(&full_text))
        .unwrap_or_else(|| "All Levels".to_string());

    let duration_hours = f
        .duration_hours
        .filter(|h| *h > 0.0)
        .or_else(|| {
            let h = parse_course_duration_hours(&full_text);
            (h > 0.0).then_some(h)
        })
        .unwrap_or(0.0);

    let rating = f.rating.filter(|r| *r > 0.0).unwrap_or(0.0);
    let review_count = f.review_count.unwrap_or(0);
    // Enrollment is only taken from structured data (`__NEXT_DATA__`
    // enrollmentCount). Coursera JSON-LD carries no enrollment and the
    // rendered DOM concatenates sibling numbers ("97% liked", module counts)
    // around the "enrolled" label, so a text scan yields wrong values — we
    // store unknown (0) rather than a misleading number.
    let num_students = f.num_students.unwrap_or(0);

    let sections = if f.sections.is_empty() {
        extract_sections(&doc)
    } else {
        dedup_bounded(f.sections)
    };
    let topics_json = serde_json::to_string(&sections).unwrap_or_else(|_| "[]".to_string());
    let chapters: Vec<Chapter> = sections
        .iter()
        .enumerate()
        .map(|(i, h)| Chapter {
            course_id: course_id.clone(),
            course_title: title.clone(),
            chapter_index: i as u32,
            title: h.clone(),
        })
        .collect();

    let course = Course {
        course_id,
        title,
        url: url.to_string(),
        description,
        instructor,
        level,
        rating,
        review_count,
        num_students,
        duration_hours: duration_hours as f32,
        price: "Free Trial".to_string(),
        language,
        category: "Course".to_string(),
        image_url,
        topics_json,
    };

    info!(
        "Parsed Coursera course: {} ({} sections, {:.1}\u{2605}/{})",
        course.title,
        chapters.len(),
        course.rating,
        course.review_count
    );
    Ok((course, chapters))
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Article slugs are kebab-case, ≥3 chars, and exclude listing/section paths.
fn is_article_slug(slug: &str) -> bool {
    let len_ok = slug.len() >= 3 && slug.len() <= 100;
    let shape_ok = slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && slug.chars().next().is_some_and(|c| c != '-');
    // Coursera uses /articles/category/... and a bare /articles index; skip
    // anything that isn't a leaf article slug.
    const NON_ARTICLE: &[&str] = &["category", "subject", "page", "all", "index"];
    len_ok && shape_ok && !NON_ARTICLE.contains(&slug)
}

fn article_slug_from_href(href: &str) -> Option<String> {
    let path = href.split(['?', '#']).next().unwrap_or(href);
    let after = path.split("/articles/").nth(1)?;
    // Reject nested paths like /articles/category/foo.
    let first = after.trim_end_matches('/').split('/').next()?;
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

/// Find the first JSON-LD block that looks like an Article. Handles a single
/// object, a top-level array, and a `@graph` wrapper.
fn extract_jsonld_article(doc: &Html) -> Option<JsonLdArticle> {
    for el in doc.select(&JSONLD_SEL) {
        let text = el.text().collect::<String>();
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let mut candidates: Vec<&Value> = Vec::new();
        match &value {
            Value::Array(arr) => candidates.extend(arr.iter()),
            Value::Object(map) => {
                if let Some(Value::Array(graph)) = map.get("@graph") {
                    candidates.extend(graph.iter());
                } else {
                    candidates.push(&value);
                }
            }
            _ => {}
        }
        for item in candidates {
            if jsonld_is_article(item) {
                if let Ok(article) = serde_json::from_value::<JsonLdArticle>(item.clone()) {
                    if article.headline.is_some()
                        || article.name.is_some()
                        || article.description.is_some()
                    {
                        return Some(article);
                    }
                }
            }
        }
    }
    None
}

/// `@type` may be a string or an array of strings.
fn jsonld_is_article(item: &Value) -> bool {
    match item.get("@type") {
        Some(Value::String(t)) => ARTICLE_TYPES.contains(&t.as_str()),
        Some(Value::Array(ts)) => ts
            .iter()
            .filter_map(Value::as_str)
            .any(|t| ARTICLE_TYPES.contains(&t)),
        _ => false,
    }
}

/// `image` may be a URL string, `{ "url": ... }`, or an array of either.
fn jsonld_image(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Object(o) => o.get("url").and_then(Value::as_str).map(str::to_string),
        Value::Array(a) => a.iter().find_map(jsonld_image),
        _ => None,
    }
}

/// `author` may be `{ "name": ... }`, an array of those, or a bare string.
fn jsonld_author(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Object(o) => o.get("name").and_then(Value::as_str).map(str::to_string),
        Value::Array(a) => {
            let names: Vec<String> = a.iter().filter_map(jsonld_author).collect();
            if names.is_empty() {
                None
            } else {
                Some(names.join(", "))
            }
        }
        _ => None,
    }
}

fn extract_meta(doc: &Html, name: &str) -> Option<String> {
    for attr in ["property", "name"] {
        let selector_str = format!("meta[{attr}=\"{name}\"]");
        let sel = Selector::parse(&selector_str).ok()?;
        if let Some(el) = doc.select(&sel).next() {
            if let Some(content) = el.value().attr("content") {
                let trimmed = clean_text(content);
                if !trimmed.is_empty() {
                    return Some(trimmed);
                }
            }
        }
    }
    None
}

fn extract_h1(doc: &Html) -> Option<String> {
    doc.select(&H1_SEL)
        .next()
        .map(|el| clean_text(&el.text().collect::<String>()))
        .filter(|s| !s.is_empty())
}

/// Concatenated paragraph text, scoped to the main content container when one
/// is present (keeps nav/footer boilerplate out of the summary fallback).
fn extract_body_text(doc: &Html) -> String {
    for sel in BODY_CONTAINER_SELS.iter() {
        if let Some(container) = doc.select(sel).next() {
            let text: String = container
                .select(&PARA_SEL)
                .map(|el| clean_text(&el.text().collect::<String>()))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            if !text.is_empty() {
                return text;
            }
        }
    }
    doc.select(&PARA_SEL)
        .map(|el| clean_text(&el.text().collect::<String>()))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Clean, length-bound, and order-preserving-dedupe a stream of heading
/// elements. Generic over the iterator so it accepts both `Html::select`
/// and `ElementRef::select` (which are distinct types).
fn collect_headings<'a, I>(it: I) -> Vec<String>
where
    I: Iterator<Item = scraper::ElementRef<'a>>,
{
    let mut seen = std::collections::HashSet::new();
    it.map(|el| clean_text(&el.text().collect::<String>()))
        .filter(|s| s.len() >= 3 && s.len() <= 160)
        .filter(|s| seen.insert(s.clone()))
        .collect()
}

/// Section headings (`<h2>`/`<h3>`) inside the main content container, in
/// document order, deduplicated.
fn extract_sections(doc: &Html) -> Vec<String> {
    for sel in BODY_CONTAINER_SELS.iter() {
        if let Some(container) = doc.select(sel).next() {
            let items = collect_headings(container.select(&HEADING_SEL));
            if !items.is_empty() {
                return items;
            }
        }
    }
    collect_headings(doc.select(&HEADING_SEL))
}

/// Map BCP-47-ish language codes to the human names used elsewhere in the
/// corpus (`English`, …); pass through anything already spelled out.
fn normalise_language(code: &str) -> String {
    let c = code.trim();
    match c.split(['-', '_']).next().unwrap_or(c).to_lowercase().as_str() {
        "en" => "English".to_string(),
        "es" => "Spanish".to_string(),
        "fr" => "French".to_string(),
        "de" => "German".to_string(),
        "pt" => "Portuguese".to_string(),
        "" => "English".to_string(),
        _ => c.to_string(),
    }
}

// ── Course-page helpers (/learn/<slug>) ─────────────────────────────────────

/// Course-ish fields gathered from JSON-LD `Course` and/or `__NEXT_DATA__`.
#[derive(Debug, Default)]
struct CourseFields {
    title: Option<String>,
    description: Option<String>,
    level: Option<String>,
    instructor: Option<String>,
    image: Option<String>,
    language: Option<String>,
    duration_hours: Option<f64>,
    rating: Option<f32>,
    review_count: Option<u32>,
    num_students: Option<u32>,
    sections: Vec<String>,
}

/// True if any JSON-LD block on the page is a `Course`-ish type.
fn has_course_jsonld(doc: &Html) -> bool {
    for el in doc.select(&JSONLD_SEL) {
        let text = el.text().collect::<String>();
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let mut candidates: Vec<&Value> = Vec::new();
        match &value {
            Value::Array(arr) => candidates.extend(arr.iter()),
            Value::Object(map) => {
                if let Some(Value::Array(graph)) = map.get("@graph") {
                    candidates.extend(graph.iter());
                } else {
                    candidates.push(&value);
                }
            }
            _ => {}
        }
        if candidates.iter().any(|c| jsonld_is_course(c)) {
            return true;
        }
    }
    false
}

/// `@type` may be a string or an array of strings.
fn jsonld_is_course(item: &Value) -> bool {
    match item.get("@type") {
        Some(Value::String(t)) => COURSE_TYPES.contains(&t.as_str()),
        Some(Value::Array(ts)) => ts
            .iter()
            .filter_map(Value::as_str)
            .any(|t| COURSE_TYPES.contains(&t)),
        _ => false,
    }
}

/// Numbers in Coursera JSON-LD/Next data come as both `4.8` and `"4.8"`.
fn num_from_value(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().replace(',', "").parse::<f64>().ok(),
        _ => None,
    }
}

/// `aggregateRating` → (ratingValue, reviewCount|ratingCount).
fn jsonld_rating(o: &serde_json::Map<String, Value>) -> (Option<f32>, Option<u32>) {
    let Some(ar) = o.get("aggregateRating") else {
        return (None, None);
    };
    let val = ar
        .get("ratingValue")
        .and_then(num_from_value)
        .map(|v| v as f32)
        .filter(|r| *r > 0.0);
    let cnt = ar
        .get("reviewCount")
        .or_else(|| ar.get("ratingCount"))
        .and_then(num_from_value)
        .map(|v| v as u32);
    (val, cnt)
}

/// JSON-LD `hasPart`/`syllabusSections` → section names.
fn jsonld_sections(o: &serde_json::Map<String, Value>) -> Vec<String> {
    for k in ["hasPart", "syllabusSections", "hasCourseInstance"] {
        if let Some(Value::Array(arr)) = o.get(k) {
            let titles: Vec<String> = arr
                .iter()
                .filter_map(|i| i.get("name").and_then(Value::as_str).map(str::to_string))
                .collect();
            if !titles.is_empty() {
                return titles;
            }
        }
    }
    Vec::new()
}

/// Tier 1: parse JSON-LD `Course` objects (single, top-level array, `@graph`).
fn extract_jsonld_course(doc: &Html) -> CourseFields {
    for el in doc.select(&JSONLD_SEL) {
        let text = el.text().collect::<String>();
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let mut candidates: Vec<&Value> = Vec::new();
        match &value {
            Value::Array(arr) => candidates.extend(arr.iter()),
            Value::Object(map) => {
                if let Some(Value::Array(graph)) = map.get("@graph") {
                    candidates.extend(graph.iter());
                } else {
                    candidates.push(&value);
                }
            }
            _ => {}
        }
        for item in candidates {
            if !jsonld_is_course(item) {
                continue;
            }
            let Some(o) = item.as_object() else { continue };
            let (rating, review_count) = jsonld_rating(o);
            let f = CourseFields {
                title: str_field(o, &["name", "headline", "title"]),
                description: str_field(o, &["description", "abstract"]),
                level: str_field(o, &["educationalLevel", "level"]),
                instructor: jsonld_author(
                    o.get("author")
                        .or_else(|| o.get("provider"))
                        .or_else(|| o.get("creator"))
                        .unwrap_or(&Value::Null),
                ),
                image: o.get("image").and_then(jsonld_image),
                language: str_field(o, &["inLanguage"]),
                duration_hours: str_field(o, &["timeRequired", "duration"])
                    .map(|d| parse_course_duration_hours(&d))
                    .filter(|h| *h > 0.0),
                rating,
                review_count,
                num_students: None,
                sections: jsonld_sections(o),
            };
            if f.title.is_some() || f.description.is_some() || f.rating.is_some() {
                return f;
            }
        }
    }
    CourseFields::default()
}

/// Tier 2: parse the `<script id="__NEXT_DATA__">` JSON payload (if any).
fn extract_next_data_course(doc: &Html, slug: &str) -> Option<CourseFields> {
    let el = doc.select(&NEXT_DATA_SEL).next()?;
    let text = el.text().collect::<String>();
    let root: Value = serde_json::from_str(&text).ok()?;
    let obj = find_course_object(&root, slug)?;
    let o = obj.as_object()?;

    let mut f = CourseFields {
        title: str_field(o, &["name", "title", "heading"]),
        description: str_field(
            o,
            &["description", "shortDescription", "summary", "subtitle"],
        ),
        level: str_field(
            o,
            &["level", "difficulty", "productDifficultyLevel", "educationalLevel"],
        ),
        image: str_field(o, &["image", "thumbnail", "ogImage", "coverImage", "photoUrl"]),
        language: str_field(o, &["inLanguage", "language", "primaryLanguage"]),
        ..Default::default()
    };
    f.instructor = jsonld_author(
        o.get("instructors")
            .or_else(|| o.get("collaborators"))
            .or_else(|| o.get("author"))
            .or_else(|| o.get("instructor"))
            .or_else(|| o.get("partners"))
            .unwrap_or(&Value::Null),
    );
    if f.image.is_none() {
        f.image = o.get("image").and_then(jsonld_image);
    }
    f.duration_hours = str_field(
        o,
        &[
            "duration",
            "length",
            "timeRequired",
            "totalTime",
            "estimatedLearningTime",
            "timeCommitment",
        ],
    )
    .map(|d| parse_course_duration_hours(&d))
    .filter(|h| *h > 0.0);
    f.num_students = num_field(
        o,
        &[
            "enrollmentCount",
            "numEnrollments",
            "learnerCount",
            "enrolledCount",
            "numLearners",
        ],
    )
    .map(|n| n as u32);
    f.rating = num_field(
        o,
        &["averageFiveStarRating", "rating", "avgRating", "ratingValue"],
    )
    .map(|n| n as f32)
    .filter(|r| *r > 0.0);
    f.review_count = num_field(
        o,
        &["ratingCount", "reviewCount", "numRatings", "numReviews"],
    )
    .map(|n| n as u32);
    f.sections = sections_from_object(o);
    Some(f)
}

/// Recursively find the first course-ish object, preferring a `slug` match.
fn find_course_object<'a>(v: &'a Value, slug: &str) -> Option<&'a Value> {
    fn name_of(o: &serde_json::Map<String, Value>) -> Option<&str> {
        o.get("name")
            .or_else(|| o.get("title"))
            .or_else(|| o.get("heading"))
            .and_then(Value::as_str)
    }
    fn desc_of(o: &serde_json::Map<String, Value>) -> bool {
        ["description", "shortDescription", "summary", "subtitle"]
            .iter()
            .any(|k| o.get(*k).and_then(Value::as_str).is_some_and(|s| !s.is_empty()))
    }
    let mut best: Option<&Value> = None;
    let mut stack = vec![v];
    while let Some(cur) = stack.pop() {
        match cur {
            Value::Object(o) => {
                let is_course_type = o
                    .get("@type")
                    .and_then(Value::as_str)
                    .is_some_and(|t| COURSE_TYPES.contains(&t));
                let looks_courseish = name_of(o).is_some() && desc_of(o);
                if is_course_type || looks_courseish {
                    let slug_match = o
                        .get("slug")
                        .and_then(Value::as_str)
                        .is_some_and(|s| s == slug);
                    if slug_match {
                        return Some(cur);
                    }
                    if best.is_none() {
                        best = Some(cur);
                    }
                }
                for val in o.values() {
                    stack.push(val);
                }
            }
            Value::Array(a) => {
                for val in a {
                    stack.push(val);
                }
            }
            _ => {}
        }
    }
    best
}

/// Pull section/module titles out of a course object's syllabus-ish arrays.
fn sections_from_object(o: &serde_json::Map<String, Value>) -> Vec<String> {
    const SECTION_KEYS: &[&str] = &[
        "modules",
        "syllabus",
        "lessons",
        "curriculum",
        "chapters",
        "topics",
        "sections",
        "weeks",
    ];
    for k in SECTION_KEYS {
        if let Some(Value::Array(arr)) = o.get(*k) {
            let titles: Vec<String> = arr
                .iter()
                .filter_map(|item| match item {
                    Value::String(s) => Some(s.clone()),
                    Value::Object(io) => io
                        .get("name")
                        .or_else(|| io.get("title"))
                        .or_else(|| io.get("heading"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    _ => None,
                })
                .collect();
            if !titles.is_empty() {
                return titles;
            }
        }
    }
    Vec::new()
}

fn str_field(o: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = o.get(*k).and_then(Value::as_str) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn num_field(o: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<f64> {
    for k in keys {
        match o.get(*k) {
            Some(Value::Number(n)) => {
                if let Some(v) = n.as_f64() {
                    return Some(v);
                }
            }
            Some(Value::String(s)) => {
                if let Ok(v) = s.replace(',', "").parse::<f64>() {
                    return Some(v);
                }
            }
            _ => {}
        }
    }
    None
}

/// Order-preserving dedupe + length bound for a section list.
fn dedup_bounded(items: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .map(|s| clean_text(&s))
        .filter(|s| s.len() >= 3 && s.len() <= 160)
        .filter(|s| seen.insert(s.clone()))
        .collect()
}

/// Find the number immediately preceding `phrase` (e.g. `10` in
/// `"… 10 hours a week"`). Handles decimals; ignores a trailing space.
fn num_before_phrase(text: &str, phrase: &str) -> Option<f64> {
    let idx = text.find(phrase)?;
    let before = text[..idx].trim_end();
    let num: String = before
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    num.parse::<f64>().ok()
}

/// Coursera durations: prefer "N weeks at M hours a week" → N×M; else
/// "approx. N hours" / "N hours to complete" / "N hours"; else "N minutes".
fn parse_course_duration_hours(s: &str) -> f64 {
    let lower = s.to_lowercase();
    let hpw = num_before_phrase(&lower, "hours a week")
        .or_else(|| num_before_phrase(&lower, "hour a week"))
        .or_else(|| num_before_phrase(&lower, "hours/week"))
        .or_else(|| num_before_phrase(&lower, "hours per week"));
    let weeks = num_before_phrase(&lower, "weeks").or_else(|| num_before_phrase(&lower, "week"));
    if let (Some(w), Some(h)) = (weeks, hpw) {
        if w > 0.0 && h > 0.0 {
            return ((w * h) * 100.0).round() / 100.0;
        }
    }
    if let Some(h) = num_before_phrase(&lower, "hours to complete")
        .or_else(|| num_before_phrase(&lower, "hours"))
        .or_else(|| num_before_phrase(&lower, "hour"))
    {
        if h > 0.0 {
            return (h * 100.0).round() / 100.0;
        }
    }
    if let Some(m) = num_before_phrase(&lower, "minutes").or_else(|| num_before_phrase(&lower, "min"))
    {
        if m > 0.0 {
            return ((m / 60.0) * 100.0).round() / 100.0;
        }
    }
    0.0
}

/// Canonicalise a level string; empty when unrecognised so the fallback chain
/// continues.
fn normalise_level(s: &str) -> String {
    let l = s.to_lowercase();
    if l.contains("beginner") {
        "Beginner".to_string()
    } else if l.contains("intermediate") {
        "Intermediate".to_string()
    } else if l.contains("advanced") {
        "Advanced".to_string()
    } else if l.contains("mixed") || l.contains("all level") {
        "All Levels".to_string()
    } else {
        String::new()
    }
}

/// DOM-text fallback: "Intermediate level" → "Intermediate".
fn extract_level_text(text: &str) -> Option<String> {
    let l = text.to_lowercase();
    for (kw, lvl) in [
        ("beginner level", "Beginner"),
        ("intermediate level", "Intermediate"),
        ("advanced level", "Advanced"),
    ] {
        if l.contains(kw) {
            return Some(lvl.to_string());
        }
    }
    None
}

/// Course slugs are kebab-case, ≥3 chars, and exclude listing/section paths.
fn is_course_slug(slug: &str) -> bool {
    let len_ok = slug.len() >= 3 && slug.len() <= 100;
    let shape_ok = slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && slug.chars().next().is_some_and(|c| c != '-');
    const NON_COURSE: &[&str] = &[
        "category",
        "page",
        "index",
        "all",
        "browse",
        "search",
        "login",
        "specializations",
        "professional-certificates",
        "projects",
    ];
    len_ok && shape_ok && !NON_COURSE.contains(&slug)
}

fn course_slug_from_href(href: &str) -> Option<String> {
    let path = href.split(['?', '#']).next().unwrap_or(href);
    let after = path.split("/learn/").nth(1)?;
    let first = after.trim_end_matches('/').split('/').next()?;
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_from_url_strips_query_fragment_and_trailing_slash() {
        assert_eq!(
            slug_from_url("https://www.coursera.org/articles/embedding-model"),
            "embedding-model"
        );
        assert_eq!(
            slug_from_url("https://www.coursera.org/articles/embedding-model/"),
            "embedding-model"
        );
        assert_eq!(
            slug_from_url("https://www.coursera.org/articles/embedding-model?utm=x#sec"),
            "embedding-model"
        );
    }

    #[test]
    fn is_article_slug_filters_listing_paths() {
        assert!(is_article_slug("embedding-model"));
        assert!(is_article_slug("what-is-machine-learning"));
        assert!(!is_article_slug("category"));
        assert!(!is_article_slug("-leading-dash"));
        assert!(!is_article_slug("ab"));
        assert!(!is_article_slug("Not_Kebab"));
    }

    #[test]
    fn parse_article_extracts_jsonld_sections_and_chapters() {
        let html = r#"<!DOCTYPE html>
<html><head>
<meta property="og:title" content="OG fallback title">
<meta property="og:image" content="https://img/og.jpg">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"WebPage","name":"ignore me"},
  {"@type":["Article"],"headline":"What Is an Embedding Model?",
   "description":"Embedding models turn data into numerical vectors.",
   "image":{"url":"https://img/ld.jpg"},
   "author":{"@type":"Organization","name":"Coursera Staff"},
   "inLanguage":"en-US"}
]}
</script>
</head><body>
<header><h1>site chrome</h1><h2>Navigation</h2></header>
<article>
  <h1>What Is an Embedding Model?</h1>
  <p>An embedding model converts complex data into vectors.</p>
  <h2>What is an embedding model?</h2>
  <p>Details here.</p>
  <h3>Types of objects</h3>
  <h2>How to build an embedding model</h2>
  <h2>What is an embedding model?</h2>
</article>
</body></html>"#;

        let (c, chapters) = parse_article_html(
            html,
            "https://www.coursera.org/articles/embedding-model",
        )
        .expect("parse");

        assert_eq!(c.course_id, "coursera-embedding-model");
        assert_eq!(c.title, "What Is an Embedding Model?");
        assert_eq!(
            c.description,
            "Embedding models turn data into numerical vectors."
        );
        assert_eq!(c.instructor, "Coursera Staff");
        assert_eq!(c.language, "English");
        assert_eq!(c.image_url, "https://img/ld.jpg");
        assert_eq!(c.category, "Article");
        assert_eq!(c.price, "Free");
        assert_eq!(c.level, "All Levels");

        // Headings scoped to <article>, deduped, in order. The duplicate
        // "What is an embedding model?" and the <header> chrome are dropped.
        let topics: Vec<String> = serde_json::from_str(&c.topics_json).unwrap();
        assert_eq!(
            topics,
            vec![
                "What is an embedding model?",
                "Types of objects",
                "How to build an embedding model",
            ]
        );
        assert_eq!(chapters.len(), 3);
        assert_eq!(chapters[0].chapter_index, 0);
        assert_eq!(chapters[0].course_id, "coursera-embedding-model");
        assert_eq!(chapters[0].course_title, "What Is an Embedding Model?");
        assert_eq!(chapters[2].title, "How to build an embedding model");
    }

    #[test]
    fn parse_article_falls_back_to_og_and_body() {
        let html = r#"<html><head>
<meta property="og:title" content="Fallback Title">
<meta property="og:description" content="">
</head><body><main>
<p>First paragraph used as the summary fallback.</p>
<h2>Section One</h2>
</main></body></html>"#;
        let (c, chapters) =
            parse_article_html(html, "https://www.coursera.org/articles/foo-bar/")
                .expect("parse");
        assert_eq!(c.title, "Fallback Title");
        assert_eq!(c.instructor, "Coursera Staff");
        assert!(
            c.description
                .starts_with("First paragraph used as the summary"),
            "got: {}",
            c.description
        );
        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].title, "Section One");
    }

    #[test]
    fn parse_articles_index_extracts_and_dedups() {
        let html = r#"<html><body>
<a href="/articles/embedding-model">x</a>
<a href="https://www.coursera.org/articles/what-is-rag?utm=1">y</a>
<a href="/articles/embedding-model">dup</a>
<a href="/articles/category/data-science">skip nested</a>
<a href="/browse/foo">unrelated</a>
<script>{"url":"/articles/vector-databases"}</script>
</body></html>"#;
        let urls = parse_articles_index(html);
        assert!(urls.contains(&"https://www.coursera.org/articles/embedding-model".to_string()));
        assert!(urls.contains(&"https://www.coursera.org/articles/what-is-rag".to_string()));
        assert!(urls.contains(
            &"https://www.coursera.org/articles/vector-databases".to_string()
        ));
        assert!(!urls
            .iter()
            .any(|u| u.contains("category") || u.contains("/browse/")));
        // "embedding-model" appears twice in the markup but only once here.
        assert_eq!(
            urls.iter()
                .filter(|u| u.ends_with("/embedding-model"))
                .count(),
            1
        );
    }

    #[test]
    fn parse_course_extracts_jsonld_rating_level_enrolled() {
        let html = r#"<!DOCTYPE html><html><head>
<meta property="og:title" content="OG fallback">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"WebPage","name":"ignore"},
 {"@type":"Course","name":"Retrieval Augmented Generation (RAG)",
  "description":"Build RAG systems that connect LLMs to external data.",
  "educationalLevel":"Intermediate","inLanguage":"en",
  "image":{"url":"https://img/rag.jpg"},
  "provider":{"@type":"Organization","name":"DeepLearning.AI"},
  "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":193},
  "hasPart":[{"name":"RAG Fundamentals"},{"name":"Retrieval Methods"},{"name":"Scaling RAG"}]}
]}
</script></head><body><main>
<p>51,236 already enrolled</p>
<p>3 weeks at 10 hours a week</p>
</main></body></html>"#;
        let (c, chapters) = parse_course_html(
            html,
            "https://www.coursera.org/learn/retrieval-augmented-generation-rag",
        )
        .expect("parse");

        assert_eq!(c.course_id, "coursera-retrieval-augmented-generation-rag");
        assert_eq!(c.title, "Retrieval Augmented Generation (RAG)");
        assert_eq!(c.level, "Intermediate");
        assert!((c.rating - 4.8).abs() < 1e-4, "rating {}", c.rating);
        assert_eq!(c.review_count, 193);
        // Coursera JSON-LD carries no enrollment and the DOM "enrolled" text is
        // unreliable, so it's deliberately unknown (0) here. The reliable
        // structured path (__NEXT_DATA__ enrollmentCount) is covered by
        // `parse_course_next_data_fallback`.
        assert_eq!(c.num_students, 0);
        assert!((c.duration_hours - 30.0).abs() < 1e-4, "dur {}", c.duration_hours);
        assert_eq!(c.category, "Course");
        assert_eq!(c.price, "Free Trial");
        assert_eq!(c.instructor, "DeepLearning.AI");
        assert_eq!(c.language, "English");
        assert_eq!(c.image_url, "https://img/rag.jpg");
        let topics: Vec<String> = serde_json::from_str(&c.topics_json).unwrap();
        assert_eq!(
            topics,
            vec!["RAG Fundamentals", "Retrieval Methods", "Scaling RAG"]
        );
        assert_eq!(chapters.len(), 3);
        assert_eq!(chapters[2].title, "Scaling RAG");
        assert_eq!(chapters[0].course_id, "coursera-retrieval-augmented-generation-rag");
    }

    #[test]
    fn parse_course_next_data_fallback() {
        let html = r#"<html><head>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"course":{
 "@type":"Course","slug":"introduction-to-rag","name":"Introduction to RAG",
 "description":"RAG basics.","level":"Beginner","inLanguage":"en",
 "duration":"2 weeks at 4 hours a week",
 "instructors":[{"name":"Jane Doe"}],
 "enrollmentCount":12345,
 "modules":[{"title":"Module 1"},{"title":"Module 2"}]}}}}
</script></head><body></body></html>"#;
        let (c, ch) =
            parse_course_html(html, "https://www.coursera.org/learn/introduction-to-rag")
                .expect("parse");
        assert_eq!(c.title, "Introduction to RAG");
        assert_eq!(c.level, "Beginner");
        assert_eq!(c.instructor, "Jane Doe");
        assert_eq!(c.num_students, 12345);
        assert!((c.duration_hours - 8.0).abs() < 1e-4, "dur {}", c.duration_hours);
        assert_eq!(c.category, "Course");
        assert_eq!(ch.len(), 2);
        assert_eq!(ch[1].title, "Module 2");
    }

    #[test]
    fn parse_coursera_links_emits_articles_and_learn() {
        let html = r#"<html><body>
<a href="/articles/what-is-rag">a</a>
<a href="https://www.coursera.org/learn/retrieval-augmented-generation-rag?x=1">c</a>
<a href="/learn/introduction-to-rag">c2</a>
<a href="/learn/category/foo">skip</a>
<script>{"href":"/learn/advanced-rag-with-vector-databases-and-retrievers"}</script>
</body></html>"#;
        let urls = parse_coursera_links(html);
        assert!(urls
            .iter()
            .any(|u| u == "https://www.coursera.org/articles/what-is-rag"));
        assert!(urls
            .iter()
            .any(|u| u == "https://www.coursera.org/learn/retrieval-augmented-generation-rag"));
        assert!(urls
            .iter()
            .any(|u| u == "https://www.coursera.org/learn/introduction-to-rag"));
        assert!(urls.iter().any(
            |u| u == "https://www.coursera.org/learn/advanced-rag-with-vector-databases-and-retrievers"
        ));
        assert!(!urls.iter().any(|u| u.contains("/learn/category")));
    }

    #[test]
    fn parse_articles_index_excludes_learn() {
        let html = r#"<a href="/articles/what-is-rag">a</a><a href="/learn/retrieval-augmented-generation-rag">c</a>"#;
        let urls = parse_articles_index(html);
        assert!(urls.iter().any(|u| u.contains("/articles/what-is-rag")));
        assert!(!urls.iter().any(|u| u.contains("/learn/")));
    }

    #[test]
    fn parse_coursera_page_dispatches_by_url() {
        let article = r#"<html><head><script type="application/ld+json">
{"@type":"Article","headline":"X Article","description":"d"}</script></head>
<body><article><h2>S1</h2></article></body></html>"#;
        let (c, _) =
            parse_coursera_page(article, "https://www.coursera.org/articles/x").expect("a");
        assert_eq!(c.category, "Article");

        let course = r#"<html><head><script type="application/ld+json">
{"@type":"Course","name":"Y Course","description":"d",
 "aggregateRating":{"ratingValue":"4.5","reviewCount":10}}</script></head>
<body></body></html>"#;
        let (c2, _) =
            parse_coursera_page(course, "https://www.coursera.org/learn/y").expect("c");
        assert_eq!(c2.category, "Course");
        assert!((c2.rating - 4.5).abs() < 1e-4);
        assert_eq!(c2.review_count, 10);
    }
}
