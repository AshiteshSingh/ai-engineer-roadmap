//! HTTP client for fetching Udemy pages with browser-like headers,
//! Cloudflare detection, and retry with exponential backoff.

use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{self, HeaderMap, HeaderValue};
use tracing::{info, warn};

/// Result of fetching a single page.
#[derive(Debug)]
pub enum FetchResult {
    /// Successfully fetched HTML body.
    Ok(String),
    /// Cloudflare challenge detected — do not retry.
    CloudflareBlocked,
    /// HTTP error after retries.
    HttpError(u16, String),
    /// Network / connection error after retries.
    ConnectionError(String),
}

impl FetchResult {
    pub fn html(&self) -> Option<&str> {
        match self {
            FetchResult::Ok(html) => Some(html),
            _ => None,
        }
    }
}

/// Configuration for the crawler.
pub struct CrawlConfig {
    pub max_retries: u32,
    pub base_delay: Duration,
    pub request_timeout: Duration,
}

impl Default for CrawlConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay: Duration::from_secs(2),
            request_timeout: Duration::from_secs(30),
        }
    }
}

/// HTTP client that mimics a Safari browser for fetching Udemy pages.
pub struct UdemyClient {
    client: reqwest::Client,
    max_retries: u32,
    base_delay: Duration,
}

impl UdemyClient {
    pub fn new(config: &CrawlConfig) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
                 AppleWebKit/605.1.15 (KHTML, like Gecko) \
                 Version/17.4 Safari/605.1.15",
            ),
        );
        headers.insert(
            header::ACCEPT,
            HeaderValue::from_static(
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            ),
        );
        headers.insert(
            header::ACCEPT_LANGUAGE,
            HeaderValue::from_static("en-US,en;q=0.9"),
        );
        headers.insert(
            header::ACCEPT_ENCODING,
            HeaderValue::from_static("gzip, deflate, br"),
        );

        let jar = Arc::new(reqwest::cookie::Jar::default());

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .cookie_provider(jar)
            .timeout(config.request_timeout)
            .gzip(true)
            .brotli(true)
            .build()
            .expect("failed to build reqwest client");

        Self {
            client,
            max_retries: config.max_retries,
            base_delay: config.base_delay,
        }
    }

    /// Fetch a page with retry on 429/503, Cloudflare detection.
    pub async fn fetch_page(&self, url: &str) -> FetchResult {
        let mut attempt = 0u32;

        loop {
            match self.client.get(url).send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let has_cf_ray = resp.headers().contains_key("cf-ray");
                    let body = match resp.text().await {
                        Ok(b) => b,
                        Err(e) => {
                            if attempt < self.max_retries {
                                attempt += 1;
                                warn!("Body read error (attempt {attempt}): {e}");
                                tokio::time::sleep(self.backoff(attempt)).await;
                                continue;
                            }
                            return FetchResult::ConnectionError(e.to_string());
                        }
                    };

                    // Cloudflare detection — do not retry
                    if detect_cloudflare(status, has_cf_ray, &body) {
                        return FetchResult::CloudflareBlocked;
                    }

                    if status == 200 {
                        return FetchResult::Ok(body);
                    }

                    // Retry on 429 / 503
                    if (status == 429 || status == 503) && attempt < self.max_retries {
                        attempt += 1;
                        let delay = self.backoff(attempt);
                        info!("HTTP {status} for {url}, retrying in {delay:?} (attempt {attempt})");
                        tokio::time::sleep(delay).await;
                        continue;
                    }

                    return FetchResult::HttpError(status, body);
                }
                Err(e) => {
                    if attempt < self.max_retries {
                        attempt += 1;
                        let delay = self.backoff(attempt);
                        warn!("Connection error (attempt {attempt}): {e}");
                        tokio::time::sleep(delay).await;
                        continue;
                    }
                    return FetchResult::ConnectionError(e.to_string());
                }
            }
        }
    }

    fn backoff(&self, attempt: u32) -> Duration {
        self.base_delay * 2u32.pow(attempt.saturating_sub(1))
    }
}

fn detect_cloudflare(status: u16, has_cf_ray: bool, body: &str) -> bool {
    if body.contains("<title>Just a moment</title>") {
        return true;
    }
    if body.contains("cf-turnstile") || body.contains("challenge-platform") {
        return true;
    }
    if status == 403 && has_cf_ray {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_cloudflare_challenge_page() {
        assert!(detect_cloudflare(
            403,
            true,
            "<html><head><title>Just a moment</title></head></html>"
        ));
    }

    #[test]
    fn detect_cloudflare_turnstile() {
        assert!(detect_cloudflare(200, false, "<div class=\"cf-turnstile\"></div>"));
    }

    #[test]
    fn detect_cloudflare_403_with_cf_ray() {
        assert!(detect_cloudflare(403, true, "<html>Access denied</html>"));
    }

    #[test]
    fn no_cloudflare_on_normal_page() {
        assert!(!detect_cloudflare(
            200,
            false,
            "<html><head><title>Udemy Course</title></head></html>"
        ));
    }

    #[test]
    fn backoff_increases_exponentially() {
        let client = UdemyClient::new(&CrawlConfig::default());
        assert_eq!(client.backoff(1), Duration::from_secs(2));
        assert_eq!(client.backoff(2), Duration::from_secs(4));
        assert_eq!(client.backoff(3), Duration::from_secs(8));
    }
}
