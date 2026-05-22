//! Cloudflare D1 REST writer for the dynamic `content_cache` table.
//!
//! The app bakes lesson bodies + audio guides into the Vercel build today, so
//! changing content needs a redeploy. This client lets the offline Rust
//! pipeline mirror those artifacts into D1 (the same D1 the app already uses for
//! audio playback progress), so the app can read them at request time and new
//! content shows on refresh.
//!
//! Pattern mirrors `apps/lead-gen/crates/research-pipeline/src/d1_client.rs`,
//! but env-var names match the app's audio D1 (`lib/d1.ts`) so creds are shared:
//! `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AUDIO_D1_ID`, `CLOUDFLARE_D1_API_TOKEN`.

use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::json;

const D1_API_BASE: &str = "https://api.cloudflare.com/client/v4";

pub struct D1Client {
    account_id: String,
    database_id: String,
    api_token: String,
    http: Client,
}

impl D1Client {
    /// Read CF creds from env. Returns `Ok(None)` when any var is missing so
    /// offline / CI runs without CF access still succeed (the sync becomes a
    /// no-op rather than an error).
    pub fn from_env() -> Result<Option<Self>> {
        let account_id = match non_empty("CLOUDFLARE_ACCOUNT_ID") {
            Some(v) => v,
            None => return Ok(None),
        };
        let database_id = match non_empty("CLOUDFLARE_AUDIO_D1_ID") {
            Some(v) => v,
            None => return Ok(None),
        };
        let api_token = match non_empty("CLOUDFLARE_D1_API_TOKEN") {
            Some(v) => v,
            None => return Ok(None),
        };
        Ok(Some(Self {
            account_id,
            database_id,
            api_token,
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .context("build d1 http client")?,
        }))
    }

    fn query_url(&self) -> String {
        format!(
            "{D1_API_BASE}/accounts/{}/d1/database/{}/query",
            self.account_id, self.database_id
        )
    }

    /// Idempotent CREATE TABLE for the content cache. Call once per process.
    pub async fn ensure_table(&self) -> Result<()> {
        let sql = "CREATE TABLE IF NOT EXISTS content_cache (\
            kind TEXT NOT NULL, \
            slug TEXT NOT NULL, \
            payload TEXT NOT NULL, \
            updated_at TEXT NOT NULL DEFAULT (datetime('now')), \
            PRIMARY KEY (kind, slug)\
        ) WITHOUT ROWID;";
        self.exec(sql, vec![]).await.map(|_| ())
    }

    /// Upsert one JSON document. `payload` is bound as a parameter (never
    /// interpolated) so large JSON bodies and quotes are safe.
    pub async fn upsert(&self, kind: &str, slug: &str, payload: &str) -> Result<()> {
        let sql = "INSERT INTO content_cache (kind, slug, payload, updated_at) \
            VALUES (?, ?, ?, datetime('now')) \
            ON CONFLICT(kind, slug) DO UPDATE SET \
            payload = excluded.payload, updated_at = excluded.updated_at;";
        self.exec(sql, vec![json!(kind), json!(slug), json!(payload)])
            .await
            .map(|_| ())
    }

    /// Run an arbitrary parameterized statement and return the rows as JSON
    /// objects (`result[0].results`). Use for SELECTs; pairs with `exec` for
    /// writes. Params are bound (never interpolated).
    pub async fn query_rows(
        &self,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<Vec<serde_json::Value>> {
        let parsed = self.request(sql, params).await?;
        let rows = parsed
            .get("result")
            .and_then(|r| r.as_array())
            .and_then(|a| a.first())
            .and_then(|r| r.get("results"))
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(rows)
    }

    /// Run a statement and return the number of rows changed (`meta.changes`).
    pub async fn exec(&self, sql: &str, params: Vec<serde_json::Value>) -> Result<usize> {
        let parsed = self.request(sql, params).await?;
        let written = parsed
            .get("result")
            .and_then(|r| r.as_array())
            .and_then(|a| a.first())
            .and_then(|r| r.get("meta"))
            .and_then(|m| m.get("changes"))
            .and_then(|c| c.as_u64())
            .unwrap_or(0) as usize;
        Ok(written)
    }

    /// POST one statement to the D1 query endpoint and return the parsed,
    /// success-checked response body.
    async fn request(&self, sql: &str, params: Vec<serde_json::Value>) -> Result<serde_json::Value> {
        let body = json!({ "sql": sql, "params": params });
        let resp = self
            .http
            .post(self.query_url())
            .bearer_auth(&self.api_token)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .context("d1 query http send")?;
        let status = resp.status();
        let text = resp.text().await.context("d1 query read body")?;
        if !status.is_success() {
            anyhow::bail!("d1 query http {status}: {text}");
        }
        let parsed: serde_json::Value =
            serde_json::from_str(&text).context("d1 query parse json")?;
        if !parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
            anyhow::bail!("d1 query api error: {text}");
        }
        Ok(parsed)
    }
}

fn non_empty(key: &str) -> Option<String> {
    match std::env::var(key) {
        Ok(v) if !v.trim().is_empty() => Some(v),
        _ => None,
    }
}
