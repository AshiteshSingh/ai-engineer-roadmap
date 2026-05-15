//! Parse Udemy topic listing pages to extract course URLs and related topics.

use regex::Regex;
use scraper::{Html, Selector};

use crate::keywords::is_promo_slug;

/// Result of parsing a topic listing page.
#[derive(Debug, Default)]
pub struct TopicPageResult {
    /// Deduplicated, promo-filtered course URLs.
    pub course_urls: Vec<String>,
    /// Related topic slugs found on the page.
    pub related_topics: Vec<String>,
}

/// Parse topic page HTML to extract course URLs and related topic slugs.
pub fn parse_topic_page(html: &str) -> TopicPageResult {
    let doc = Html::parse_document(html);
    let mut seen_slugs = std::collections::HashSet::new();
    let mut course_urls = Vec::new();

    // Strategy 1: <a> hrefs containing /course/
    if let Ok(sel) = Selector::parse("a[href]") {
        for el in doc.select(&sel) {
            if let Some(href) = el.value().attr("href") {
                if let Some(slug) = extract_course_slug(href) {
                    if seen_slugs.insert(slug.clone()) {
                        course_urls.push(format!("https://www.udemy.com/course/{slug}/"));
                    }
                }
            }
        }
    }

    // Strategy 2: __NEXT_DATA__ script tag — regex for /course/slug
    if let Ok(sel) = Selector::parse("script#__NEXT_DATA__") {
        if let Some(el) = doc.select(&sel).next() {
            let text: String = el.text().collect();
            extract_course_slugs_from_text(&text, &mut seen_slugs, &mut course_urls);
        }
    }

    // Strategy 3: Raw HTML regex for /course/ patterns
    extract_course_slugs_from_text(html, &mut seen_slugs, &mut course_urls);

    // Filter promo slugs
    course_urls.retain(|url| {
        let slug = url
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or("");
        !is_promo_slug(slug)
    });

    // Extract related topic slugs from /topic/ links
    let mut topic_seen = std::collections::HashSet::new();
    let mut related_topics = Vec::new();

    if let Ok(sel) = Selector::parse("a[href]") {
        for el in doc.select(&sel) {
            if let Some(href) = el.value().attr("href") {
                if let Some(slug) = extract_topic_slug(href) {
                    if topic_seen.insert(slug.clone()) {
                        related_topics.push(slug);
                    }
                }
            }
        }
    }

    TopicPageResult {
        course_urls,
        related_topics,
    }
}

/// Returns true if the HTML looks like a Cloudflare challenge page.
pub fn is_cloudflare_blocked(html: &str) -> bool {
    html.contains("<title>Just a moment</title>")
        || html.contains("cf-turnstile")
        || html.contains("challenge-platform")
}

/// Extract a course slug from a URL or path like `/course/my-slug/`.
fn extract_course_slug(url_or_path: &str) -> Option<String> {
    let re = Regex::new(r"/course/([a-z0-9][a-z0-9-]{2,80})").ok()?;
    re.captures(url_or_path)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

/// Extract a topic slug from a URL like `https://www.udemy.com/topic/my-topic/`.
fn extract_topic_slug(url_or_path: &str) -> Option<String> {
    let re = Regex::new(r"/topic/([a-z0-9][a-z0-9-]+)").ok()?;
    re.captures(url_or_path)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

/// Regex-scan text for /course/slug patterns, adding new ones to the set.
fn extract_course_slugs_from_text(
    text: &str,
    seen: &mut std::collections::HashSet<String>,
    out: &mut Vec<String>,
) {
    let re = match Regex::new(r"/course/([a-z0-9][a-z0-9-]{2,80})") {
        Ok(r) => r,
        Err(_) => return,
    };
    for cap in re.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let slug = m.as_str().to_string();
            if seen.insert(slug.clone()) {
                out.push(format!("https://www.udemy.com/course/{slug}/"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_courses_from_anchors() {
        let html = r#"
        <html><body>
            <a href="https://www.udemy.com/course/langchain-masterclass/">LangChain</a>
            <a href="/course/deep-learning-pytorch/">PyTorch</a>
            <a href="https://www.udemy.com/topic/machine-learning/">ML Topic</a>
        </body></html>
        "#;
        let result = parse_topic_page(html);
        assert!(result.course_urls.iter().any(|u| u.contains("langchain-masterclass")));
        assert!(result.course_urls.iter().any(|u| u.contains("deep-learning-pytorch")));
        assert!(result.related_topics.contains(&"machine-learning".to_string()));
    }

    #[test]
    fn extract_courses_from_next_data() {
        let html = r#"
        <html><head>
            <script id="__NEXT_DATA__" type="application/json">
            {"props":{"courses":["/course/vector-databases-101/","/course/rag-pipeline/"]}}
            </script>
        </head><body></body></html>
        "#;
        let result = parse_topic_page(html);
        assert!(result.course_urls.iter().any(|u| u.contains("vector-databases-101")));
        assert!(result.course_urls.iter().any(|u| u.contains("rag-pipeline")));
    }

    #[test]
    fn deduplicates_urls() {
        let html = r#"
        <html><body>
            <a href="/course/my-course/">Link 1</a>
            <a href="https://www.udemy.com/course/my-course/">Link 2</a>
        </body></html>
        "#;
        let result = parse_topic_page(html);
        let count = result.course_urls.iter().filter(|u| u.contains("my-course")).count();
        assert_eq!(count, 1, "expected 1 deduplicated URL, got {count}");
    }

    #[test]
    fn filters_promo_slugs() {
        let html = r#"
        <html><body>
            <a href="/course/google-ai-fundamentals/">Promo</a>
            <a href="/course/real-course-here/">Real</a>
        </body></html>
        "#;
        let result = parse_topic_page(html);
        assert!(!result.course_urls.iter().any(|u| u.contains("google-ai-fundamentals")));
        assert!(result.course_urls.iter().any(|u| u.contains("real-course-here")));
    }

    #[test]
    fn cloudflare_detection() {
        assert!(is_cloudflare_blocked("<html><head><title>Just a moment</title></head></html>"));
        assert!(!is_cloudflare_blocked("<html><head><title>Udemy</title></head></html>"));
    }

    #[test]
    fn empty_page_returns_empty() {
        let result = parse_topic_page("<html><body></body></html>");
        assert!(result.course_urls.is_empty());
        assert!(result.related_topics.is_empty());
    }
}
