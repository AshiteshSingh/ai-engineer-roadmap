use serde::{Deserialize, Serialize};

use crate::types::Lesson;

/// Flat N x N similarity matrix with slug index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarityMatrix {
    pub slugs: Vec<String>,
    pub scores: Vec<f32>,
    pub n: usize,
}

/// Cosine similarity between two vectors.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

impl SimilarityMatrix {
    /// Embed all lessons and compute the pairwise cosine similarity matrix.
    pub fn compute(
        lessons: &[Lesson],
        model: &candle::EmbeddingModel,
    ) -> anyhow::Result<Self> {
        let n = lessons.len();
        let texts: Vec<String> = lessons.iter().map(|l| l.embed_text()).collect();

        // Embed in batches of 8
        let mut all_embeddings: Vec<Vec<f32>> = Vec::with_capacity(n);
        for chunk in texts.chunks(8) {
            let refs: Vec<&str> = chunk.iter().map(|s| s.as_str()).collect();
            let tensor = model.embed(&refs)?;
            for i in 0..refs.len() {
                let row = tensor.get(i)?.to_vec1::<f32>()?;
                all_embeddings.push(row);
            }
        }

        // Compute pairwise cosine similarity
        let mut scores = vec![0.0f32; n * n];
        for i in 0..n {
            scores[i * n + i] = 1.0; // self-similarity
            for j in (i + 1)..n {
                let sim = cosine_similarity(&all_embeddings[i], &all_embeddings[j]);
                scores[i * n + j] = sim;
                scores[j * n + i] = sim;
            }
        }

        let slugs = lessons.iter().map(|l| l.slug.clone()).collect();

        Ok(Self { slugs, scores, n })
    }

    /// Return the top-k most similar lessons for the given slug (excluding self).
    pub fn top_k(&self, slug: &str, k: usize) -> Vec<(String, f32)> {
        let idx = match self.slugs.iter().position(|s| s == slug) {
            Some(i) => i,
            None => return Vec::new(),
        };

        let row_start = idx * self.n;
        let mut pairs: Vec<(usize, f32)> = (0..self.n)
            .filter(|&j| j != idx)
            .map(|j| (j, self.scores[row_start + j]))
            .collect();

        pairs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        pairs.truncate(k);

        pairs
            .into_iter()
            .map(|(j, score)| (self.slugs[j].clone(), score))
            .collect()
    }

    /// Serialize to a JSON file.
    pub fn save_json(&self, path: &std::path::Path) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = std::fs::File::create(path)?;
        serde_json::to_writer_pretty(file, self)?;
        Ok(())
    }

    /// Deserialize from a JSON file.
    pub fn load_json(path: &std::path::Path) -> anyhow::Result<Self> {
        let file = std::fs::File::open(path)?;
        let matrix = serde_json::from_reader(file)?;
        Ok(matrix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_vectors_have_similarity_one() {
        let a = vec![1.0, 2.0, 3.0];
        let sim = cosine_similarity(&a, &a);
        assert!((sim - 1.0).abs() < 1e-6, "Expected 1.0, got {sim}");
    }

    #[test]
    fn orthogonal_vectors_have_similarity_zero() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6, "Expected 0.0, got {sim}");
    }

    #[test]
    fn opposite_vectors_have_similarity_negative_one() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![-1.0, -2.0, -3.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim + 1.0).abs() < 1e-6, "Expected -1.0, got {sim}");
    }

    #[test]
    fn zero_vector_returns_zero() {
        let a = vec![0.0, 0.0, 0.0];
        let b = vec![1.0, 2.0, 3.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6, "Expected 0.0 for zero vector, got {sim}");
    }

    #[test]
    fn top_k_works() {
        let matrix = SimilarityMatrix {
            slugs: vec!["a".into(), "b".into(), "c".into()],
            scores: vec![
                1.0, 0.9, 0.3,
                0.9, 1.0, 0.5,
                0.3, 0.5, 1.0,
            ],
            n: 3,
        };

        let top = matrix.top_k("a", 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].0, "b");
        assert!((top[0].1 - 0.9).abs() < 1e-6);
        assert_eq!(top[1].0, "c");
    }

    #[test]
    fn top_k_unknown_slug_returns_empty() {
        let matrix = SimilarityMatrix {
            slugs: vec!["a".into()],
            scores: vec![1.0],
            n: 1,
        };
        assert!(matrix.top_k("unknown", 5).is_empty());
    }
}
