//! DeepLearning.AI short-courses catalog + per-course parser
//! (`https://www.deeplearning.ai/courses/`, `/courses/<slug>/`,
//! `/short-courses/<slug>/`).
//!
//! DeepLearning.AI is a Next.js site. Like Coursera articles, the pages are
//! server-rendered, so the shared [`crate::udemy::crawler::UdemyClient`]
//! reqwest path fetches them directly — no Playwright needed. The richest
//! signal is the embedded `<script id="__NEXT_DATA__">` JSON payload, so this
//! parser tries that first, then JSON-LD (`Course`/`LearningResource`), then
//! falls back to `og:`/`meta` + DOM.
//!
//! Each course maps onto the existing corpus model so it flows through the
//! same embed/store/frontend pipeline as Udemy/Coursera: one [`Course`] row
//! (`category = "Short Course"`, `price = "Free"`) plus one [`Chapter`] per
//! syllabus section/lesson. No schema change — `provider` is bound to
//! `"DeepLearning.AI"` at the upsert call site.

use std::sync::LazyLock;

use anyhow::Result;
use scraper::{Html, Selector};
use serde_json::Value;
use tracing::info;

use crate::udemy::types::{Chapter, Course};

static JSONLD_SEL: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse("script[type=\"application/ld+json\"]").unwrap());
static NEXT_DATA_SEL: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse("script#__NEXT_DATA__").unwrap());
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

/// schema.org `@type` values that denote a course on DeepLearning.AI.
const COURSE_TYPES: &[&str] = &["Course", "LearningResource", "CreativeWork"];

/// Course-ish fields gathered from `__NEXT_DATA__` or JSON-LD.
#[derive(Debug, Default)]
struct CourseFields {
    title: Option<String>,
    description: Option<String>,
    level: Option<String>,
    instructor: Option<String>,
    image: Option<String>,
    language: Option<String>,
    duration_hours: Option<f64>,
    sections: Vec<String>,
}

/// Derive the course slug from a DeepLearning.AI URL
/// (`https://www.deeplearning.ai/courses/ai-agents-in-langgraph/`
/// → `ai-agents-in-langgraph`). Handles `/short-courses/<slug>` too.
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

/// Parse a DeepLearning.AI course page from pre-fetched HTML + its URL.
///
/// Returns the course as a [`Course`] (so it rides the existing
/// embed/store/frontend pipeline) plus one [`Chapter`] per syllabus section.
pub fn parse_course_html(html: &str, url: &str) -> Result<(Course, Vec<Chapter>)> {
    let doc = Html::parse_document(html);
    let slug = slug_from_url(url);
    let course_id = format!("deeplearning-{slug}");

    // Tier 1: __NEXT_DATA__   Tier 2: JSON-LD   (merge, Next data wins)
    let mut f = extract_next_data_course(&doc, &slug).unwrap_or_default();
    if f.title.is_none() || f.description.is_none() || f.sections.is_empty() {
        let j = extract_jsonld_course(&doc);
        if f.title.is_none() {
            f.title = j.title;
        }
        if f.description.is_none() {
            f.description = j.description;
        }
        if f.level.is_none() {
            f.level = j.level;
        }
        if f.instructor.is_none() {
            f.instructor = j.instructor;
        }
        if f.image.is_none() {
            f.image = j.image;
        }
        if f.language.is_none() {
            f.language = j.language;
        }
        if f.duration_hours.is_none() {
            f.duration_hours = j.duration_hours;
        }
        if f.sections.is_empty() {
            f.sections = j.sections;
        }
    }

    // Tier 3: og:/meta + DOM fallbacks.
    let title = f
        .title
        .map(|s| clean_text(&s))
        .filter(|s| !s.is_empty())
        .or_else(|| extract_meta(&doc, "og:title"))
        .or_else(|| extract_h1(&doc))
        .unwrap_or_else(|| slug.replace('-', " "));

    let body_text = extract_body_text(&doc);
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
        .unwrap_or_else(|| "DeepLearning.AI".to_string());

    let level = f
        .level
        .map(|s| clean_text(&s))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "All Levels".to_string());

    let duration_hours = f.duration_hours.filter(|h| *h > 0.0).unwrap_or(0.0);

    // Sections from structured data, else DOM headings.
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
        rating: 0.0,
        review_count: 0,
        num_students: 0,
        duration_hours: duration_hours as f32,
        price: "Free".to_string(),
        language,
        category: "Short Course".to_string(),
        image_url,
        topics_json,
    };

    info!(
        "Parsed DeepLearning.AI course: {} ({} sections)",
        course.title,
        chapters.len()
    );
    Ok((course, chapters))
}

/// Extract DeepLearning.AI course links from a page's HTML and return
/// fully-qualified course URLs (deduplicated). Works on the catalog index and
/// on individual course pages (for BFS discovery of the "related courses"
/// rail). Handles both `/courses/<slug>` and `/short-courses/<slug>`.
pub fn parse_courses_index(html: &str) -> Vec<String> {
    let doc = Html::parse_document(html);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();

    let mut push_slug = |slug: &str, out: &mut Vec<String>| {
        if is_course_slug(slug) && seen.insert(slug.to_string()) {
            out.push(format!("https://www.deeplearning.ai/courses/{slug}/"));
        }
    };

    // Strategy 1: <a href> attributes.
    for el in doc.select(&A_HREF_SEL) {
        if let Some(href) = el.value().attr("href") {
            if let Some(slug) = course_slug_from_href(href) {
                push_slug(&slug, &mut out);
            }
        }
    }

    // Strategy 2: raw-HTML scan (catches links embedded in the __NEXT_DATA__
    // JSON payload that aren't real <a> elements — this is how the Next.js
    // catalog actually ships its course list).
    for marker in ["/courses/", "/short-courses/"] {
        let mut rest = html;
        while let Some(idx) = rest.find(marker) {
            let after = &rest[idx + marker.len()..];
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
    }

    out
}

/// Brief-named alias for [`parse_courses_index`].
pub use self::parse_courses_index as parse_catalog_html;

// ── Helpers ─────────────────────────────────────────────────────────────

/// Course slugs are kebab-case, ≥3 chars, and exclude listing/section paths.
fn is_course_slug(slug: &str) -> bool {
    let len_ok = slug.len() >= 3 && slug.len() <= 100;
    let shape_ok = slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && slug.chars().next().is_some_and(|c| c != '-');
    const NON_COURSE: &[&str] = &[
        "category",
        "short-courses",
        "all",
        "page",
        "index",
        "specializations",
        "login",
        "search",
    ];
    len_ok && shape_ok && !NON_COURSE.contains(&slug)
}

fn course_slug_from_href(href: &str) -> Option<String> {
    let path = href.split(['?', '#']).next().unwrap_or(href);
    let after = path
        .split("/courses/")
        .nth(1)
        .or_else(|| path.split("/short-courses/").nth(1))?;
    // Reject nested paths like /courses/category/foo.
    let first = after.trim_end_matches('/').split('/').next()?;
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
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

/// Pull a `f64` hour count out of a human duration string
/// ("1.5 Hours", "90 minutes", "2h 30m", "5 weeks"). Best-effort; 0.0 if
/// nothing parseable.
fn parse_duration_hours(s: &str) -> f64 {
    let chars: Vec<char> = s.to_lowercase().chars().collect();
    let mut hours = 0.0f64;
    let mut found = false;
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        // Read the number.
        let mut num = String::new();
        while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
            num.push(chars[i]);
            i += 1;
        }
        // Skip whitespace, then read the trailing unit word.
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let mut unit = String::new();
        while i < chars.len() && chars[i].is_ascii_alphabetic() {
            unit.push(chars[i]);
            i += 1;
        }
        if let Ok(v) = num.parse::<f64>() {
            if unit.starts_with("week") {
                hours += v * 5.0; // ~5h of content per "week" on DL.AI
                found = true;
            } else if unit.starts_with("hour") || unit == "hr" || unit == "hrs" || unit == "h" {
                hours += v;
                found = true;
            } else if unit.starts_with("min") || unit == "m" {
                hours += v / 60.0;
                found = true;
            }
        }
    }
    if found {
        (hours * 100.0).round() / 100.0
    } else {
        0.0
    }
}

/// Recursively search a JSON value for the first object that looks like a
/// course (has a name/title plus a description), preferring one whose `slug`
/// matches the page slug.
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

/// Pull section/lesson titles out of a course object's syllabus-ish arrays.
fn sections_from_object(o: &serde_json::Map<String, Value>) -> Vec<String> {
    const SECTION_KEYS: &[&str] = &[
        "syllabus",
        "lessons",
        "modules",
        "curriculum",
        "chapters",
        "topics",
        "sections",
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

/// Tier 1: parse the `<script id="__NEXT_DATA__">` JSON payload.
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
        level: str_field(o, &["level", "difficulty", "courseLevel", "educationalLevel"]),
        image: str_field(o, &["image", "thumbnail", "ogImage", "coverImage"]),
        language: str_field(o, &["inLanguage", "language"]),
        ..Default::default()
    };
    // Instructor: instructors[].name / collaborators[].name / author.name
    f.instructor = jsonld_author(
        o.get("instructors")
            .or_else(|| o.get("collaborators"))
            .or_else(|| o.get("author"))
            .or_else(|| o.get("instructor"))
            .unwrap_or(&Value::Null),
    );
    if f.image.is_none() {
        f.image = o.get("image").and_then(jsonld_image);
    }
    f.duration_hours = str_field(o, &["duration", "length", "timeRequired", "totalTime"])
        .map(|d| parse_duration_hours(&d))
        .filter(|h| *h > 0.0);
    f.sections = sections_from_object(o);
    Some(f)
}

/// Tier 2: parse JSON-LD `Course`/`LearningResource` objects. Handles a single
/// object, a top-level array, and a `@graph` wrapper.
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
                    .map(|d| parse_duration_hours(&d))
                    .filter(|h| *h > 0.0),
                sections: jsonld_sections(o),
            };
            if f.title.is_some() || f.description.is_some() {
                return f;
            }
        }
    }
    CourseFields::default()
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

/// JSON-LD `hasPart`/`hasCourseInstance` → section names.
fn jsonld_sections(o: &serde_json::Map<String, Value>) -> Vec<String> {
    for k in ["hasPart", "hasCourseInstance", "syllabusSections"] {
        if let Some(Value::Array(arr)) = o.get(k) {
            let titles: Vec<String> = arr
                .iter()
                .filter_map(|i| {
                    i.get("name")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect();
            if !titles.is_empty() {
                return titles;
            }
        }
    }
    Vec::new()
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

/// Section headings (`<h2>`/`<h3>`) inside the main content container, in
/// document order, deduplicated and length-bounded.
fn extract_sections(doc: &Html) -> Vec<String> {
    for sel in BODY_CONTAINER_SELS.iter() {
        if let Some(container) = doc.select(sel).next() {
            let items: Vec<String> = container
                .select(&HEADING_SEL)
                .map(|el| el.text().collect::<String>())
                .collect();
            let bounded = dedup_bounded(items);
            if !bounded.is_empty() {
                return bounded;
            }
        }
    }
    let all: Vec<String> = doc
        .select(&HEADING_SEL)
        .map(|el| el.text().collect::<String>())
        .collect();
    dedup_bounded(all)
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
            slug_from_url("https://www.deeplearning.ai/courses/ai-agents-in-langgraph/"),
            "ai-agents-in-langgraph"
        );
        assert_eq!(
            slug_from_url("https://www.deeplearning.ai/short-courses/finetuning-large-language-models?x=1#s"),
            "finetuning-large-language-models"
        );
    }

    #[test]
    fn is_course_slug_filters_listing_paths() {
        assert!(is_course_slug("chatgpt-prompt-engineering-for-developers"));
        assert!(is_course_slug("ai-agents-in-langgraph"));
        assert!(!is_course_slug("category"));
        assert!(!is_course_slug("short-courses"));
        assert!(!is_course_slug("-leading-dash"));
        assert!(!is_course_slug("ab"));
        assert!(!is_course_slug("Not_Kebab"));
    }

    #[test]
    fn parse_duration_hours_handles_common_shapes() {
        assert!((parse_duration_hours("1.5 Hours") - 1.5).abs() < 1e-6);
        assert!((parse_duration_hours("90 minutes") - 1.5).abs() < 1e-6);
        assert!((parse_duration_hours("2 weeks") - 10.0).abs() < 1e-6);
        assert_eq!(parse_duration_hours("self-paced"), 0.0);
    }

    #[test]
    fn parse_course_extracts_next_data_sections_and_chapters() {
        let html = r#"<!DOCTYPE html><html><head>
<meta property="og:title" content="OG fallback">
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"course":{
  "@type":"Course",
  "slug":"ai-agents-in-langgraph",
  "name":"AI Agents in LangGraph",
  "description":"Build agentic workflows with LangGraph and LangChain.",
  "level":"Intermediate",
  "duration":"1.5 Hours",
  "inLanguage":"en",
  "image":{"url":"https://img/ld.jpg"},
  "instructors":[{"name":"Harrison Chase"},{"name":"Rotem Weiss"}],
  "lessons":[{"title":"Introduction"},{"title":"Build an Agent from Scratch"},
             {"title":"LangGraph Components"},{"title":"Introduction"}]
}}}}
</script></head><body><h1>chrome</h1></body></html>"#;

        let (c, chapters) = parse_course_html(
            html,
            "https://www.deeplearning.ai/courses/ai-agents-in-langgraph/",
        )
        .expect("parse");

        assert_eq!(c.course_id, "deeplearning-ai-agents-in-langgraph");
        assert_eq!(c.title, "AI Agents in LangGraph");
        assert_eq!(
            c.description,
            "Build agentic workflows with LangGraph and LangChain."
        );
        assert_eq!(c.level, "Intermediate");
        assert_eq!(c.instructor, "Harrison Chase, Rotem Weiss");
        assert_eq!(c.language, "English");
        assert_eq!(c.image_url, "https://img/ld.jpg");
        assert_eq!(c.category, "Short Course");
        assert_eq!(c.price, "Free");
        assert!((c.duration_hours - 1.5).abs() < 1e-6);

        let topics: Vec<String> = serde_json::from_str(&c.topics_json).unwrap();
        assert_eq!(
            topics,
            vec![
                "Introduction",
                "Build an Agent from Scratch",
                "LangGraph Components",
            ]
        );
        assert_eq!(chapters.len(), 3);
        assert_eq!(chapters[0].chapter_index, 0);
        assert_eq!(chapters[0].course_id, "deeplearning-ai-agents-in-langgraph");
        assert_eq!(chapters[2].title, "LangGraph Components");
    }

    #[test]
    fn parse_course_jsonld_fallback() {
        let html = r#"<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"WebPage","name":"ignore"},
 {"@type":"Course","name":"Building Systems with the ChatGPT API",
  "description":"Automate complex workflows using chained LLM calls.",
  "educationalLevel":"Beginner",
  "provider":{"@type":"Organization","name":"DeepLearning.AI"},
  "hasPart":[{"name":"Language Models"},{"name":"Classification"}]}
]}
</script></head><body></body></html>"#;
        let (c, chapters) = parse_course_html(
            html,
            "https://www.deeplearning.ai/short-courses/building-systems-with-the-chatgpt-api/",
        )
        .expect("parse");
        assert_eq!(c.title, "Building Systems with the ChatGPT API");
        assert_eq!(c.level, "Beginner");
        assert_eq!(c.instructor, "DeepLearning.AI");
        assert_eq!(c.category, "Short Course");
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[1].title, "Classification");
    }

    #[test]
    fn parse_course_falls_back_to_og_and_body() {
        let html = r#"<html><head>
<meta property="og:title" content="Fallback Course Title">
<meta property="og:description" content="">
</head><body><main>
<p>First paragraph used as the summary fallback.</p>
<h2>Module One</h2>
</main></body></html>"#;
        let (c, chapters) = parse_course_html(
            html,
            "https://www.deeplearning.ai/courses/foo-bar/",
        )
        .expect("parse");
        assert_eq!(c.title, "Fallback Course Title");
        assert_eq!(c.instructor, "DeepLearning.AI");
        assert_eq!(c.level, "All Levels");
        assert!(c
            .description
            .starts_with("First paragraph used as the summary"));
        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].title, "Module One");
    }

    #[test]
    fn parse_courses_index_extracts_and_dedups() {
        let html = r#"<html><body>
<a href="/courses/chatgpt-prompt-engineering-for-developers">x</a>
<a href="https://www.deeplearning.ai/short-courses/finetuning-large-language-models?x=1">y</a>
<a href="/courses/chatgpt-prompt-engineering-for-developers">dup</a>
<a href="/courses/category/genai">skip nested</a>
<a href="/the-batch/foo">unrelated</a>
<script>{"href":"/courses/knowledge-graphs-rag/"}</script>
</body></html>"#;
        let urls = parse_courses_index(html);
        assert!(urls.contains(
            &"https://www.deeplearning.ai/courses/chatgpt-prompt-engineering-for-developers/"
                .to_string()
        ));
        assert!(urls.contains(
            &"https://www.deeplearning.ai/courses/finetuning-large-language-models/".to_string()
        ));
        assert!(urls.contains(
            &"https://www.deeplearning.ai/courses/knowledge-graphs-rag/".to_string()
        ));
        assert!(!urls.iter().any(|u| u.contains("category") || u.contains("/the-batch/")));
        assert_eq!(
            urls.iter()
                .filter(|u| u.ends_with("/chatgpt-prompt-engineering-for-developers/"))
                .count(),
            1
        );
    }
}
