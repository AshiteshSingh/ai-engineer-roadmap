//! Coursera *article* page parser (`https://www.coursera.org/articles/<slug>`).
//!
//! Unlike Udemy, Coursera article pages are plain server-rendered HTML, so the
//! shared [`crate::crawler::UdemyClient`] reqwest path fetches them directly —
//! no Playwright needed.
//!
//! An article maps onto the existing corpus model so it flows through the same
//! pipeline as Udemy courses: one [`Course`] row (title / url / summary, with
//! `category = "Article"`, `price = "Free"`) plus one [`Chapter`] per section
//! heading (`<h2>` / `<h3>`). The `chapters` table is what `udemy generate`
//! grounds on, so this gives Coursera both a course-level and a per-section
//! embedding with no schema change.

use std::sync::LazyLock;

use anyhow::Result;
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::Value;
use tracing::info;

use crate::types::{Chapter, Course};

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

const ARTICLE_TYPES: &[&str] = &[
    "Article",
    "BlogPosting",
    "TechArticle",
    "NewsArticle",
    "ScholarlyArticle",
    "Report",
];

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

/// Extract Coursera `/articles/<slug>` links from a page's HTML and return
/// fully-qualified article URLs (deduplicated). Works on both the articles
/// index/listing and on individual article pages (for BFS discovery of the
/// "related articles" rail).
pub fn parse_articles_index(html: &str) -> Vec<String> {
    let doc = Html::parse_document(html);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();

    let mut push_slug = |slug: &str, out: &mut Vec<String>| {
        if is_article_slug(slug) && seen.insert(slug.to_string()) {
            out.push(format!("https://www.coursera.org/articles/{slug}"));
        }
    };

    // Strategy 1: <a href> attributes.
    for el in doc.select(&A_HREF_SEL) {
        if let Some(href) = el.value().attr("href") {
            if let Some(slug) = article_slug_from_href(href) {
                push_slug(&slug, &mut out);
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
        push_slug(&slug, &mut out);
        rest = &after[slug.len().min(after.len())..];
        if rest.is_empty() {
            break;
        }
    }

    out
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
}
