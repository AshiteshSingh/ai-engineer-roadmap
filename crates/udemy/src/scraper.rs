//! Udemy course page parser.
//!
//! Udemy is behind Cloudflare bot protection, so we can't fetch pages with
//! reqwest directly. Instead, `scripts/scrape-udemy.ts` (a Playwright script)
//! navigates topic and course pages in a real browser and writes a Course[]
//! JSON file.  Run it first, then feed the output to `scrape-udemy` binary:
//!
//! ```sh
//! cd scripts && pnpm install && tsx scrape-udemy.ts --output ../data/courses.json
//! cargo run --bin scrape-udemy -- --json ./data/courses.json
//! ```
//!
//! This module's `load_courses_json` reads that JSON file; `parse_course_html`
//! is kept for ad-hoc HTML debugging.

use std::path::Path;
use std::sync::LazyLock;

use anyhow::{Context, Result};
use scraper::{Html, Selector};
use serde::Deserialize;
use tracing::{info, warn};

use crate::types::Course;

// Selectors with constant query strings are compiled once. (`extract_meta`
// builds its selector from dynamic args, so it stays per-call.)
static JSONLD_SEL: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse("script[type=\"application/ld+json\"]").unwrap());
static H1_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("h1").unwrap());
static OBJECTIVE_SPAN_SEL: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse("[data-purpose=\"objective\"] span").unwrap());
static INSTRUCTOR_SELS: LazyLock<Vec<Selector>> = LazyLock::new(|| {
    [
        "a[data-purpose=\"instructor-url\"]",
        ".instructor-links a",
        "[class*=\"instructor\"] a",
    ]
    .iter()
    .map(|s| Selector::parse(s).unwrap())
    .collect()
});
static CATEGORY_SELS: LazyLock<Vec<Selector>> = LazyLock::new(|| {
    [
        "nav[aria-label=\"Breadcrumb\"] a",
        "[data-purpose=\"breadcrumb\"] a",
    ]
    .iter()
    .map(|s| Selector::parse(s).unwrap())
    .collect()
});
static TOPIC_SELS: LazyLock<Vec<Selector>> = LazyLock::new(|| {
    [
        "[data-purpose=\"course-objectives\"] li",
        "[class*=\"what-you-will-learn\"] li",
        ".what-you-will-learn--objective-item li",
    ]
    .iter()
    .map(|s| Selector::parse(s).unwrap())
    .collect()
});

/// Load courses from a JSON file (output of `scripts/scrape-udemy.ts`).
pub fn load_courses_json(path: &Path) -> Result<Vec<Course>> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("reading {}", path.display()))?;
    let courses: Vec<Course> =
        serde_json::from_str(&content).context("parsing courses JSON")?;
    info!("Loaded {} courses from {}", courses.len(), path.display());
    Ok(courses)
}

/// JSON-LD schema.org Course object embedded in Udemy pages.
#[derive(Debug, Deserialize)]
struct JsonLdCourse {
    name: Option<String>,
    description: Option<String>,
    image: Option<String>,
    #[serde(rename = "inLanguage")]
    in_language: Option<String>,
    #[serde(rename = "aggregateRating")]
    aggregate_rating: Option<JsonLdRating>,
    instructor: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct JsonLdRating {
    #[serde(rename = "ratingValue")]
    rating_value: Option<f64>,
    #[serde(rename = "ratingCount")]
    rating_count: Option<u64>,
    #[serde(rename = "reviewCount")]
    review_count: Option<u64>,
}

/// Parse a Udemy course page from pre-fetched HTML + its URL.
pub fn parse_course_html(html: &str, url: &str) -> Result<Course> {
    let doc = Html::parse_document(html);

    // ── JSON-LD extraction (primary source) ─────────────────────────────
    let jsonld = extract_jsonld_course(&doc);

    // ── Title ───────────────────────────────────────────────────────────
    let title = jsonld
        .as_ref()
        .and_then(|j| j.name.clone())
        .or_else(|| extract_meta(&doc, "og:title"))
        .or_else(|| extract_h1(&doc))
        .unwrap_or_else(|| slug_from_url(url).replace('-', " "));

    // ── Description ─────────────────────────────────────────────────────
    let description = jsonld
        .as_ref()
        .and_then(|j| j.description.clone())
        .or_else(|| extract_meta(&doc, "og:description"))
        .or_else(|| extract_meta(&doc, "description"))
        .unwrap_or_default();

    // ── Rating & reviews ────────────────────────────────────────────────
    let (rating, review_count) = jsonld
        .as_ref()
        .and_then(|j| j.aggregate_rating.as_ref())
        .map(|r| {
            (
                r.rating_value.unwrap_or(0.0) as f32,
                r.review_count.or(r.rating_count).unwrap_or(0) as u32,
            )
        })
        .unwrap_or((0.0, 0));

    // ── Image ───────────────────────────────────────────────────────────
    let image_url = jsonld
        .as_ref()
        .and_then(|j| j.image.clone())
        .or_else(|| extract_meta(&doc, "og:image"))
        .unwrap_or_default();

    // ── Language ─────────────────────────────────────────────────────────
    let language = jsonld
        .as_ref()
        .and_then(|j| j.in_language.clone())
        .unwrap_or_else(|| "English".to_string());

    // ── Instructor ──────────────────────────────────────────────────────
    let instructor = extract_instructor_jsonld(&jsonld)
        .or_else(|| extract_instructor_html(&doc, html))
        .unwrap_or_default();

    // ── Level ───────────────────────────────────────────────────────────
    let level = extract_level(html);

    // ── Duration ────────────────────────────────────────────────────────
    let duration_hours = extract_duration(html);

    // ── Price ───────────────────────────────────────────────────────────
    let price = extract_price(&doc, html);

    // ── Number of students ──────────────────────────────────────────────
    let num_students = extract_num_students(html);

    // ── Category ────────────────────────────────────────────────────────
    let category = extract_category(&doc).unwrap_or_default();

    // ── Topics ("What you'll learn") ────────────────────────────────────
    let topics = extract_topics(&doc);
    let topics_json = serde_json::to_string(&topics).unwrap_or_else(|_| "[]".to_string());

    let course = Course {
        course_id: slug_from_url(url),
        title,
        url: url.to_string(),
        description,
        instructor,
        level,
        rating,
        review_count,
        num_students,
        duration_hours,
        price,
        language,
        category,
        image_url,
        topics_json,
    };

    info!(
        "Parsed: {} — {:.1}★ ({} reviews)",
        course.title, course.rating, course.review_count
    );
    Ok(course)
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Derive a slug from a Udemy course URL.
fn slug_from_url(url: &str) -> String {
    url.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("unknown")
        .to_string()
}

/// Extract the first JSON-LD block that looks like a Course.
fn extract_jsonld_course(doc: &Html) -> Option<JsonLdCourse> {
    for el in doc.select(&JSONLD_SEL) {
        let text = el.text().collect::<String>();
        // Single Course object
        if let Ok(course) = serde_json::from_str::<JsonLdCourse>(&text) {
            if course.name.is_some() {
                return Some(course);
            }
        }
        // JSON array — find the Course entry
        if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&text) {
            for item in arr {
                if let Some(t) = item.get("@type").and_then(|v| v.as_str()) {
                    if t == "Course" {
                        if let Ok(course) = serde_json::from_value::<JsonLdCourse>(item) {
                            return Some(course);
                        }
                    }
                }
            }
        }
    }
    None
}

fn extract_meta(doc: &Html, name: &str) -> Option<String> {
    for attr in ["property", "name"] {
        let selector_str = format!("meta[{attr}=\"{name}\"]");
        let sel = Selector::parse(&selector_str).ok()?;
        if let Some(el) = doc.select(&sel).next() {
            if let Some(content) = el.value().attr("content") {
                let trimmed = content.trim().to_string();
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
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
}

fn extract_instructor_jsonld(jsonld: &Option<JsonLdCourse>) -> Option<String> {
    let j = jsonld.as_ref()?;
    let instr = j.instructor.as_ref()?;
    if let Some(arr) = instr.as_array() {
        let names: Vec<String> = arr
            .iter()
            .filter_map(|i| i.get("name").and_then(|n| n.as_str()))
            .map(|s| s.to_string())
            .collect();
        if !names.is_empty() {
            return Some(names.join(", "));
        }
    }
    instr
        .get("name")
        .and_then(|n| n.as_str())
        .map(|s| s.to_string())
}

fn extract_instructor_html(doc: &Html, body: &str) -> Option<String> {
    for sel in INSTRUCTOR_SELS.iter() {
        if let Some(el) = doc.select(sel).next() {
            let text = el.text().collect::<String>().trim().to_string();
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    // "Created by ..." — cut at the first '<' or after 80 chars, whichever
    // comes first. `char_indices` keeps the slice on a UTF-8 boundary so a
    // multibyte instructor name with no following '<' can't panic.
    if let Some(idx) = body.find("Created by") {
        let after = &body[idx + "Created by".len()..];
        let mut end = after.len();
        for (count, (byte_idx, ch)) in after.char_indices().enumerate() {
            if ch == '<' || count >= 80 {
                end = byte_idx;
                break;
            }
        }
        let name = after[..end].trim().to_string();
        if !name.is_empty() {
            return Some(name);
        }
    }
    None
}

fn extract_level(body: &str) -> String {
    let lower = body.to_lowercase();
    if lower.contains("all levels") {
        "All Levels".to_string()
    } else if lower.contains("beginner level") {
        "Beginner".to_string()
    } else if lower.contains("intermediate level") {
        "Intermediate".to_string()
    } else if lower.contains("advanced level") {
        "Advanced".to_string()
    } else {
        "All Levels".to_string()
    }
}

fn extract_duration(body: &str) -> f32 {
    let lower = body.to_lowercase();
    for pattern in ["total hours", "hours of video", "hours on-demand"] {
        if let Some(idx) = lower.find(pattern) {
            let before = &lower[..idx];
            let num_str: String = before
                .chars()
                .rev()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect::<String>()
                .chars()
                .rev()
                .collect();
            if let Ok(hours) = num_str.parse::<f32>() {
                if hours > 0.0 && hours < 500.0 {
                    return hours;
                }
            }
        }
    }
    0.0
}

fn extract_price(doc: &Html, body: &str) -> String {
    if let Some(price) = extract_meta(doc, "udemy_com:price") {
        return price;
    }
    if let Some(price) = extract_meta(doc, "product:price:amount") {
        let currency = extract_meta(doc, "product:price:currency").unwrap_or_default();
        return if currency.is_empty() {
            format!("${price}")
        } else {
            format!("{price} {currency}")
        };
    }
    let lower = body.to_lowercase();
    if lower.contains("free") && lower.contains("enroll") {
        return "Free".to_string();
    }
    String::new()
}

fn extract_num_students(body: &str) -> u32 {
    let lower = body.to_lowercase();
    if let Some(idx) = lower.find(" students") {
        let before = &lower[..idx];
        let num_str: String = before
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit() || *c == ',')
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        let cleaned: String = num_str.chars().filter(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = cleaned.parse::<u32>() {
            return n;
        }
    }
    0
}

fn extract_category(doc: &Html) -> Option<String> {
    if let Some(cat) = extract_meta(doc, "udemy_com:category") {
        return Some(cat);
    }
    for sel in CATEGORY_SELS.iter() {
        let links: Vec<String> = doc
            .select(sel)
            .map(|el| el.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty() && s != "Udemy")
            .collect();
        if let Some(last) = links.last() {
            return Some(last.clone());
        }
    }
    None
}

fn extract_topics(doc: &Html) -> Vec<String> {
    for sel in TOPIC_SELS.iter() {
        let items: Vec<String> = doc
            .select(sel)
            .map(|el| el.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !items.is_empty() {
            return items;
        }
    }
    let items: Vec<String> = doc
        .select(&OBJECTIVE_SPAN_SEL)
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if !items.is_empty() {
        return items;
    }
    warn!("Could not extract 'What you'll learn' topics");
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_from_url_handles_trailing_slash() {
        assert_eq!(slug_from_url("https://www.udemy.com/course/foo-bar/"), "foo-bar");
        assert_eq!(slug_from_url("https://www.udemy.com/course/foo-bar"), "foo-bar");
        assert_eq!(slug_from_url(""), "unknown");
    }

    #[test]
    fn extract_level_variants() {
        assert_eq!(extract_level("This is an All Levels course"), "All Levels");
        assert_eq!(extract_level("Beginner Level intro"), "Beginner");
        assert_eq!(extract_level("Intermediate Level"), "Intermediate");
        assert_eq!(extract_level("Advanced Level deep dive"), "Advanced");
        assert_eq!(extract_level("nothing here"), "All Levels");
    }

    #[test]
    fn extract_duration_parses_and_bounds() {
        assert_eq!(extract_duration("has 12.5 total hours of content"), 12.5);
        assert_eq!(extract_duration("3 hours of video lessons"), 3.0);
        assert_eq!(extract_duration("no duration listed"), 0.0);
        assert_eq!(extract_duration("999 total hours"), 0.0);
    }

    #[test]
    fn extract_num_students_parses_thousands() {
        assert_eq!(extract_num_students("1,234 students enrolled"), 1234);
        assert_eq!(extract_num_students("no count here"), 0);
    }

    #[test]
    fn extract_instructor_html_no_panic_on_multibyte_tail() {
        let doc = Html::parse_document("<html><body></body></html>");
        let body = format!("Created by {}", "\u{e9}".repeat(100));
        let got = extract_instructor_html(&doc, &body);
        assert!(got.is_some());
        assert!(got.unwrap().starts_with('\u{e9}'));
    }

    #[test]
    fn parse_course_html_extracts_from_jsonld_and_body() {
        let html = r#"<!DOCTYPE html>
<html><head>
<meta property="og:title" content="OG Title">
<script type="application/ld+json">
{"@type":"Course","name":"Mastering Rust","description":"Learn Rust deeply.","image":"https://img/x.jpg","inLanguage":"English","aggregateRating":{"ratingValue":4.5,"reviewCount":1234},"instructor":{"name":"Jane Doe"}}
</script>
</head><body>
<h1>Mastering Rust</h1>
<p>This course has 12.5 total hours of content. 1,234 students enrolled. Beginner Level course.</p>
<ul data-purpose="course-objectives">
  <li>Understand ownership</li>
  <li>Build CLIs</li>
</ul>
</body></html>"#;

        let c = parse_course_html(html, "https://www.udemy.com/course/mastering-rust/")
            .expect("parse");
        assert_eq!(c.course_id, "mastering-rust");
        assert_eq!(c.title, "Mastering Rust");
        assert_eq!(c.description, "Learn Rust deeply.");
        assert!((c.rating - 4.5).abs() < 1e-6);
        assert_eq!(c.review_count, 1234);
        assert_eq!(c.instructor, "Jane Doe");
        assert_eq!(c.level, "Beginner");
        assert!((c.duration_hours - 12.5).abs() < 1e-6);
        assert_eq!(c.num_students, 1234);
        assert_eq!(c.language, "English");
        assert_eq!(c.image_url, "https://img/x.jpg");
        let topics: Vec<String> = serde_json::from_str(&c.topics_json).unwrap();
        assert_eq!(topics, vec!["Understand ownership", "Build CLIs"]);
    }

    #[test]
    fn load_courses_json_round_trips() {
        let course = Course {
            course_id: "abc".to_string(),
            title: "T".to_string(),
            url: "https://www.udemy.com/course/abc/".to_string(),
            description: "D".to_string(),
            instructor: "I".to_string(),
            level: "All Levels".to_string(),
            rating: 4.2,
            review_count: 7,
            num_students: 42,
            duration_hours: 1.5,
            price: "Free".to_string(),
            language: "English".to_string(),
            category: "Dev".to_string(),
            image_url: "img".to_string(),
            topics_json: "[\"x\"]".to_string(),
        };
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("courses.json");
        std::fs::write(&path, serde_json::to_string(&vec![course.clone()]).unwrap())
            .expect("write");

        let loaded = load_courses_json(&path).expect("load");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].course_id, course.course_id);
        assert_eq!(loaded[0].rating, course.rating);
        assert_eq!(loaded[0].topics_json, course.topics_json);
    }
}
