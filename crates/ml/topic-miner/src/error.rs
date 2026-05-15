use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("candle: {0}")]
    Candle(#[from] candle::Error),

    #[error("lance: {0}")]
    Lance(#[from] lancedb::Error),

    #[error("arrow: {0}")]
    Arrow(#[from] arrow_schema::ArrowError),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("json: {0}")]
    Json(#[from] serde_json::Error),

    #[error("regex: {0}")]
    Regex(#[from] regex::Error),

    #[error("{0}")]
    Other(String),
}

impl From<anyhow::Error> for Error {
    fn from(e: anyhow::Error) -> Self {
        Self::Other(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
