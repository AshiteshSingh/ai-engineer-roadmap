use serde::{Deserialize, Serialize};

pub const DIM: usize = 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lesson {
    pub slug: String,
    pub title: String,
    pub excerpt: String,
    pub content: String,
    pub category: String,
    pub word_count: usize,
}

impl Lesson {
    pub fn embed_text(&self) -> String {
        format!("{}\n\n{}", self.title, self.excerpt)
    }
}
