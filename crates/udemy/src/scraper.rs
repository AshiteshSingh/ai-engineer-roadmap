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

use anyhow::{Context, Result};
use scraper::{Html, Selector};
use serde::Deserialize;
use tracing::{info, warn};

use crate::types::Course;

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
    let sel = Selector::parse("script[type=\"application/ld+json\"]").ok()?;
    for el in doc.select(&sel) {
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
    let sel = Selector::parse("h1").ok()?;
    doc.select(&sel)
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
    for selector_str in [
        "a[data-purpose=\"instructor-url\"]",
        ".instructor-links a",
        "[class*=\"instructor\"] a",
    ] {
        if let Ok(sel) = Selector::parse(selector_str) {
            if let Some(el) = doc.select(&sel).next() {
                let text = el.text().collect::<String>().trim().to_string();
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }
    }
    // "Created by ..."
    if let Some(idx) = body.find("Created by") {
        let after = &body[idx + 10..];
        let end = after.find('<').unwrap_or(80).min(80);
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
    for selector_str in [
        "nav[aria-label=\"Breadcrumb\"] a",
        "[data-purpose=\"breadcrumb\"] a",
    ] {
        if let Ok(sel) = Selector::parse(selector_str) {
            let links: Vec<String> = doc
                .select(&sel)
                .map(|el| el.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty() && s != "Udemy")
                .collect();
            if let Some(last) = links.last() {
                return Some(last.clone());
            }
        }
    }
    None
}

fn extract_topics(doc: &Html) -> Vec<String> {
    for selector_str in [
        "[data-purpose=\"course-objectives\"] li",
        "[class*=\"what-you-will-learn\"] li",
        ".what-you-will-learn--objective-item li",
    ] {
        if let Ok(sel) = Selector::parse(selector_str) {
            let items: Vec<String> = doc
                .select(&sel)
                .map(|el| el.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !items.is_empty() {
                return items;
            }
        }
    }
    if let Ok(sel) = Selector::parse("[data-purpose=\"objective\"] span") {
        let items: Vec<String> = doc
            .select(&sel)
            .map(|el| el.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !items.is_empty() {
            return items;
        }
    }
    warn!("Could not extract 'What you'll learn' topics");
    Vec::new()
}
