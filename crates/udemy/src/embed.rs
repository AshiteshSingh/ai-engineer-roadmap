//! HTTP client helpers for the candle embed-server (`/embed`, `/health`).
//!
//! Promoted out of `bin/udemy.rs` so the binary and the `generate` pipeline
//! share one implementation.

use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct EmbedResponse {
    pub data: Vec<EmbedData>,
}

#[derive(Deserialize)]
pub struct EmbedData {
    pub embedding: Vec<f32>,
}

/// Embed a batch of texts via the candle embed-server (`POST {url}/embed`).
pub async fn embed_batch(
    client: &reqwest::Client,
    url: &str,
    texts: &[String],
) -> Result<Vec<Vec<f32>>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let resp: EmbedResponse = client
        .post(format!("{url}/embed"))
        .json(&serde_json::json!({ "input": texts }))
        .send()
        .await
        .context("calling embed server")?
        .json()
        .await
        .context("parsing embed response")?;

    let vecs: Vec<Vec<f32>> = resp.data.into_iter().map(|d| d.embedding).collect();
    if vecs.len() != texts.len() {
        anyhow::bail!(
            "embed server returned {} vectors for {} inputs",
            vecs.len(),
            texts.len()
        );
    }
    Ok(vecs)
}

/// Embed a single text, returning its vector.
pub async fn embed_one(client: &reqwest::Client, url: &str, text: &str) -> Result<Vec<f32>> {
    if text.trim().is_empty() {
        anyhow::bail!("cannot embed empty text");
    }
    let texts = [text.to_string()];
    let mut v = embed_batch(client, url, &texts).await?;
    v.pop().context("embed server returned no vector")
}

/// Preflight: `GET {url}/health`.
pub async fn health(client: &reqwest::Client, url: &str) -> Result<()> {
    client
        .get(format!("{url}/health"))
        .send()
        .await
        .context("embed server not reachable — start it with: cargo run -p candle --bin embed-server --features server")?
        .error_for_status()
        .context("embed server health check failed")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn embed_batch_empty_slice_is_noop_without_network() {
        // Returns before any HTTP call, so an unreachable URL is fine.
        let c = reqwest::Client::new();
        let out = embed_batch(&c, "http://127.0.0.1:1", &[]).await.unwrap();
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn embed_one_rejects_empty_text_before_network() {
        let c = reqwest::Client::new();
        assert!(embed_one(&c, "http://127.0.0.1:1", "   \n ").await.is_err());
        assert!(embed_one(&c, "http://127.0.0.1:1", "").await.is_err());
    }
}
