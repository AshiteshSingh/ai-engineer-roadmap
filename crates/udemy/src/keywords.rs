//! Keyword-based slug mapping and relevance scoring.
//!
//! Ported from `scripts/scrape-udemy-courses.ts`.

/// Keywords that must appear in a course's full text for it to be relevant.
/// At least one must match for a course to be stored.
pub const RELEVANCE_KEYWORDS: &[&str] = &[
    // Vector / search
    "vector database",
    "vector db",
    "vectorstore",
    "vector store",
    "pinecone",
    "weaviate",
    "qdrant",
    "milvus",
    "chroma",
    "chromadb",
    "pgvector",
    "faiss",
    "similarity search",
    "embedding",
    "vector search",
    "nearest neighbor",
    // RAG / retrieval
    "rag",
    "retrieval augmented",
    "retrieval-augmented",
    // LLM frameworks
    "langchain",
    "llamaindex",
    "langgraph",
    // Broad AI/ML
    "machine learning",
    "deep learning",
    "neural network",
    "pytorch",
    "tensorflow",
    "transformer model",
    "large language model",
    "llm",
    "fine-tuning",
    "fine tuning",
    "hugging face",
    "huggingface",
    "openai",
    "gpt",
    "stable diffusion",
    "diffusion model",
    "computer vision",
    "natural language processing",
    "nlp",
    "mlops",
    "prompt engineering",
    "attention mechanism",
    "convolutional",
    "generative ai",
    // CSS & Layout
    "css",
    "flexbox",
    "grid layout",
    "css grid",
    "responsive design",
    "css animation",
    "css layout",
    "box model",
    "css specificity",
    "css positioning",
    "media queries",
    "sass",
    "scss",
    // React & Frontend
    "react",
    "react hooks",
    "usestate",
    "useeffect",
    "react component",
    "react patterns",
    "jsx",
    "virtual dom",
    "react performance",
    "next.js",
    "nextjs",
    // TypeScript & JavaScript
    "typescript",
    "type system",
    "generics",
    "type inference",
    "javascript",
    "es6",
    // General Frontend
    "frontend",
    "front-end",
    "design system",
    "component library",
    "web accessibility",
    "a11y",
    "aria",
    "storybook",
];

// ── Topic group classification ──────────────────────────────────────────────

pub struct TopicGroup {
    pub name: &'static str,
    pub signals: &'static [&'static str],
}

pub const TOPIC_GROUPS: &[TopicGroup] = &[
    TopicGroup {
        name: "Generative AI & LLMs",
        signals: &[
            "generative ai", "chatgpt", "gpt-4", "gpt-3", "gpt4", "gpt3",
            "large language model", "llm", "prompt engineering", "openai api",
            "anthropic", "claude", "gemini", "mistral", "llama 2", "llama2",
        ],
    },
    TopicGroup {
        name: "RAG & Vector Search",
        signals: &[
            "rag", "retrieval augmented", "retrieval-augmented",
            "vector database", "vector db", "vectorstore", "vector store",
            "pinecone", "weaviate", "qdrant", "milvus", "chroma", "chromadb",
            "pgvector", "faiss", "similarity search", "embedding model",
            "semantic search", "vector search",
        ],
    },
    TopicGroup {
        name: "AI Agents & Frameworks",
        signals: &[
            "ai agent", "langchain", "langgraph", "llamaindex", "llama-index",
            "autogen", "crewai", "function calling", "tool calling", "tool use",
            "agentic", "multi-agent",
        ],
    },
    TopicGroup {
        name: "Fine-tuning & RLHF",
        signals: &[
            "fine-tun", "fine tune", "lora", "qlora", "peft",
            "rlhf", "instruction tuning", "dpo", "sft", "adapter",
        ],
    },
    TopicGroup {
        name: "Deep Learning",
        signals: &[
            "deep learning", "neural network", "pytorch", "tensorflow", "keras",
            "backpropagation", "cnn", "rnn", "lstm", "gru", "attention mechanism",
        ],
    },
    TopicGroup {
        name: "Computer Vision",
        signals: &[
            "computer vision", "image recognition", "object detection",
            "yolo", "image segmentation", "convolutional neural", "cv2", "opencv",
        ],
    },
    TopicGroup {
        name: "NLP & Transformers",
        signals: &[
            "natural language processing", "nlp", "transformers", "hugging face",
            "bert", "text classification", "named entity", "sentiment analysis",
            "text generation", "tokenization",
        ],
    },
    TopicGroup {
        name: "MLOps & Deployment",
        signals: &[
            "mlops", "model deployment", "model serving", "mlflow", "kubeflow",
            "bentoml", "triton", "docker for ml", "kubernetes for ml",
            "ci/cd for ml", "model monitoring",
        ],
    },
    TopicGroup {
        name: "Reinforcement Learning",
        signals: &[
            "reinforcement learning", "rl agent", "openai gym", "ppo", "dqn",
            "policy gradient", "q-learning", "actor-critic",
        ],
    },
    TopicGroup {
        name: "ML Foundations",
        signals: &[
            "machine learning", "scikit-learn", "sklearn", "xgboost",
            "gradient boosting", "random forest", "decision tree",
            "logistic regression", "linear regression", "statistics for data",
            "data science",
        ],
    },
    // ── Frontend ────────────────────────────────────────────────────────────
    TopicGroup {
        name: "CSS & Layout",
        signals: &[
            "css", "flexbox", "css grid", "grid layout", "responsive design",
            "css animation", "css layout", "box model", "css specificity",
            "css positioning", "media queries", "sass", "scss", "tailwind",
            "css architecture", "css modules", "styled-components",
        ],
    },
    TopicGroup {
        name: "React & Frontend Frameworks",
        signals: &[
            "react hooks", "usestate", "useeffect", "react component",
            "react pattern", "jsx", "virtual dom", "react performance",
            "react router", "next.js", "nextjs", "remix", "gatsby",
            "react native", "react context", "react redux", "zustand",
            "react query", "tanstack",
        ],
    },
    TopicGroup {
        name: "TypeScript & JavaScript",
        signals: &[
            "typescript", "type system", "type inference", "generics",
            "javascript", "es6", "es2015", "ecmascript", "promises",
            "async await", "closure", "prototype", "dom manipulation",
        ],
    },
    TopicGroup {
        name: "Design Systems & Accessibility",
        signals: &[
            "design system", "component library", "design tokens",
            "storybook", "accessibility", "a11y", "aria", "screen reader",
            "keyboard navigation", "wcag", "inclusive design",
        ],
    },
    TopicGroup {
        name: "Frontend Interview Prep",
        signals: &[
            "frontend interview", "front-end interview", "css interview",
            "react interview", "javascript interview", "coding challenge",
            "css challenge", "react challenge", "frontend assessment",
            "take-home", "whiteboard",
        ],
    },
];

/// Classify text into one of the 10 topic groups. Returns "Other" if no match.
pub fn classify_topic_group(text: &str) -> &'static str {
    let lower = text.to_lowercase();
    for group in TOPIC_GROUPS {
        if group.signals.iter().any(|s| lower.contains(s)) {
            return group.name;
        }
    }
    "Other"
}

// ── Follow-topic filtering ─────────────────────────────────────────────────

/// Keywords used to decide whether to follow a discovered related topic.
pub const FOLLOW_TOPIC_KEYWORDS: &[&str] = &[
    "ai", "ml", "machine-learning", "deep-learning", "neural",
    "llm", "gpt", "openai", "generative", "langchain", "llama",
    "vector", "embed", "rag", "retriev",
    "nlp", "natural-language", "transformers", "bert",
    "computer-vision", "image", "object-detect",
    "pytorch", "tensorflow", "keras",
    "mlops", "deploy", "model-serv",
    "fine-tun", "reinforcement", "agent",
    // Frontend
    "css", "react", "frontend", "front-end", "typescript", "javascript",
    "component", "responsive", "accessibility", "design-system", "web-dev",
    "layout", "flexbox", "grid", "sass", "tailwind", "next-js",
];

/// Returns true if a discovered topic slug is worth following.
pub fn should_follow_topic(slug: &str) -> bool {
    FOLLOW_TOPIC_KEYWORDS.iter().any(|kw| slug.contains(kw))
}

/// Udemy topic slugs that should be skipped — Udemy promotes these on every page.
pub const PROMO_SLUGS: &[&str] = &[
    "google-ai-fundamentals",
    "google-ai-for-brainstorming-and-planning",
    "google-ai-for-research-and-insights",
    "google-ai-for-writing-and-communicating",
    "google-ai-for-content-creation",
    "google-ai-for-data-analysis",
    "google-ai-for-workflow-automation",
];

/// Seed topic slugs for the Udemy topic crawler.
pub const SEED_TOPICS: &[&str] = &[
    // RAG / search / agents
    "vector-databases",
    "langchain",
    "openai-api",
    "retrieval-augmented-generation",
    "ai-agents",
    "generative-ai",
    // Broad AI/ML
    "machine-learning",
    "deep-learning",
    "pytorch",
    "tensorflow",
    "natural-language-processing",
    "transformers",
    "hugging-face",
    "computer-vision",
    "mlops",
    "stable-diffusion",
    "prompt-engineering",
    "chatgpt",
    "large-language-models",
    // Frontend / CSS / React / TypeScript
    "css",
    "react-js",
    "typescript",
    "javascript",
    "flexbox",
    "css-grid",
    "frontend-web-development",
    "web-design",
    "responsive-design",
    "web-accessibility",
];

type SlugEntry = (&'static str, &'static [&'static str]);

/// Maps each lesson slug to the keywords that indicate a course belongs there.
pub const SLUG_KEYWORDS: &[SlugEntry] = &[
    (
        "vector-databases",
        &[
            "vector database",
            "pinecone",
            "weaviate",
            "qdrant",
            "milvus",
            "chroma",
            "pgvector",
            "faiss",
            "similarity search",
            "nearest neighbor",
            "vector store",
            "vector index",
            "vector search",
            "ann index",
            "hnsw",
        ],
    ),
    (
        "embedding-models",
        &[
            "embedding model",
            "sentence transformer",
            "text-embedding",
            "word2vec",
            "sbert",
            "embed model",
            "vector representation",
            "openai embedding",
        ],
    ),
    (
        "retrieval-strategies",
        &[
            "retrieval",
            "semantic search",
            "hybrid search",
            "reranking",
            "bm25",
            "dense retrieval",
            "sparse retrieval",
            "rag retrieval",
            "search engine",
        ],
    ),
    (
        "advanced-rag",
        &[
            "advanced rag",
            "agentic rag",
            "multi-step retrieval",
            "query decomposition",
            "self-rag",
            "corrective rag",
            "graph rag",
            "rag pipeline",
        ],
    ),
    (
        "chunking-strategies",
        &[
            "chunking",
            "text splitting",
            "document splitting",
            "chunk size",
            "recursive split",
            "semantic chunking",
        ],
    ),
    (
        "rag-evaluation",
        &[
            "rag eval",
            "faithfulness",
            "context relevance",
            "answer relevance",
            "groundedness",
            "ragas",
            "trulens",
        ],
    ),
    (
        "embeddings",
        &[
            "embedding",
            "dense vector",
            "embedding space",
            "cosine similarity",
            "semantic similarity",
            "vector embedding",
        ],
    ),
    (
        "langgraph",
        &["langgraph", "langchain graph", "state graph", "agentic rag"],
    ),
    (
        "function-calling",
        &["function calling", "tool calling", "tool use"],
    ),
    (
        "agent-architectures",
        &[
            "ai agent",
            "agent architecture",
            "react agent",
            "react loop",
            "multi-agent",
            "agentic",
        ],
    ),
    (
        "machine-learning",
        &[
            "machine learning",
            "regression",
            "classification",
            "scikit-learn",
            "sklearn",
            "gradient boosting",
            "xgboost",
            "random forest",
            "feature engineering",
            "model selection",
            "cross-validation",
            "supervised learning",
            "unsupervised learning",
        ],
    ),
    (
        "deep-learning",
        &[
            "deep learning",
            "neural network",
            "backpropagation",
            "convolutional",
            "recurrent",
            "lstm",
            "rnn",
            "cnn",
            "activation function",
            "batch normalization",
            "dropout",
            "residual",
        ],
    ),
    (
        "transformers-nlp",
        &[
            "transformer",
            "attention mechanism",
            "bert",
            "gpt",
            "t5",
            "llama",
            "tokenizer",
            "natural language processing",
            "text classification",
            "named entity recognition",
            "huggingface",
            "hugging face",
            "sequence to sequence",
        ],
    ),
    (
        "computer-vision",
        &[
            "image classification",
            "object detection",
            "yolo",
            "semantic segmentation",
            "image generation",
            "vision transformer",
            "stable diffusion",
            "controlnet",
            "diffusion model",
            "image synthesis",
        ],
    ),
    (
        "mlops",
        &[
            "model deployment",
            "model serving",
            "mlflow",
            "kubeflow",
            "bentoml",
            "triton",
            "model monitoring",
            "data pipeline",
            "feature store",
            "ml pipeline",
            "model registry",
        ],
    ),
    (
        "fine-tuning",
        &[
            "fine-tuning",
            "fine tuning",
            "lora",
            "peft",
            "qlora",
            "instruction tuning",
            "sft",
            "dpo",
            "rlhf",
            "adapter",
            "parameter efficient",
        ],
    ),
    // ── Frontend ────────────────────────────────────────────────────────────
    (
        "css-layout-fundamentals",
        &[
            "flexbox",
            "css grid",
            "grid layout",
            "css layout",
            "responsive design",
            "responsive layout",
            "centering",
            "css centering",
            "media queries",
            "mobile first",
            "css display",
            "css float",
            "css position",
        ],
    ),
    (
        "css-theory",
        &[
            "box model",
            "css specificity",
            "cascade",
            "css positioning",
            "stacking context",
            "z-index",
            "block formatting",
            "bfc",
            "css animation",
            "css transition",
            "css debugging",
            "css inheritance",
            "css variables",
            "custom properties",
        ],
    ),
    (
        "react-patterns",
        &[
            "react hooks",
            "usestate",
            "useeffect",
            "usememo",
            "usecallback",
            "useref",
            "custom hook",
            "component composition",
            "render prop",
            "higher order component",
            "hoc",
            "react context",
            "react performance",
            "react memo",
            "react suspense",
            "error boundary",
        ],
    ),
    (
        "typescript-for-react",
        &[
            "typescript react",
            "react typescript",
            "type inference",
            "generics",
            "discriminated union",
            "type guard",
            "utility type",
            "mapped type",
            "conditional type",
            "typescript generic",
            "typescript interface",
            "typescript enum",
        ],
    ),
    (
        "design-systems",
        &[
            "design system",
            "component library",
            "design tokens",
            "style guide",
            "atomic design",
            "storybook",
            "design pattern",
            "theming",
            "design consistency",
            "ui kit",
        ],
    ),
    (
        "frontend-accessibility",
        &[
            "accessibility",
            "a11y",
            "aria",
            "screen reader",
            "keyboard navigation",
            "wcag",
            "accessible component",
            "semantic html",
            "focus management",
            "color contrast",
            "assistive technology",
        ],
    ),
    (
        "frontend-interview",
        &[
            "frontend interview",
            "front-end interview",
            "css interview",
            "react interview",
            "javascript interview",
            "coding challenge",
            "css challenge",
            "react challenge",
            "frontend assessment",
            "web developer interview",
            "technical interview frontend",
        ],
    ),
];

/// Returns true if the course text passes the hard relevance filter.
pub fn is_relevant(text: &str) -> bool {
    let lower = text.to_lowercase();
    RELEVANCE_KEYWORDS.iter().any(|kw| lower.contains(kw))
}

/// Returns `(slug, score)` pairs for all matching lesson slugs.
///
/// Score formula (from TS): `clamp(0.3, (hits / total) * 1.5, 1.0)`
pub fn match_slugs(text: &str) -> Vec<(String, f32)> {
    let lower = text.to_lowercase();
    let mut matches = Vec::new();

    for (slug, keywords) in SLUG_KEYWORDS {
        let hits = keywords.iter().filter(|kw| lower.contains(*kw)).count();
        if hits > 0 {
            let score = (hits as f32 / keywords.len() as f32 * 1.5)
                .min(1.0)
                .max(0.3);
            let rounded = (score * 100.0).round() / 100.0;
            matches.push((slug.to_string(), rounded));
        }
    }

    matches.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    matches
}

/// Returns true if `slug` is one of the Udemy-promoted topic slugs to skip.
pub fn is_promo_slug(slug: &str) -> bool {
    PROMO_SLUGS.contains(&slug)
}

/// Returns the slug with the highest relevance score for `text`, or `None`
/// if no slug matches.
pub fn top_slug(text: &str) -> Option<String> {
    match_slugs(text).into_iter().next().map(|(slug, _)| slug)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // is_relevant

    #[test]
    fn is_relevant_matches_known_keyword() {
        assert!(is_relevant("A course about embedding models for semantic search"));
    }

    #[test]
    fn is_relevant_rejects_unrelated_text() {
        assert!(!is_relevant("Docker containers and Kubernetes orchestration"));
    }

    #[test]
    fn is_relevant_is_case_insensitive() {
        assert!(is_relevant("DEEP LEARNING WITH PYTORCH"));
    }

    #[test]
    fn is_relevant_empty_string_returns_false() {
        assert!(!is_relevant(""));
    }

    // match_slugs

    #[test]
    fn match_slugs_returns_matching_slug() {
        let results = match_slugs("fine-tuning lora peft qlora");
        let slugs: Vec<&str> = results.iter().map(|(s, _)| s.as_str()).collect();
        assert!(slugs.contains(&"fine-tuning"), "expected fine-tuning in {slugs:?}");
    }

    #[test]
    fn match_slugs_score_formula() {
        // "deep learning", "neural network", "convolutional" = 3 hits out of 12 keywords
        // raw = (3/12) * 1.5 = 0.375, rounded = 0.38
        let results = match_slugs("deep learning neural network convolutional");
        let entry = results.iter().find(|(s, _)| s == "deep-learning");
        assert!(entry.is_some(), "deep-learning not found in results");
        let (_, score) = entry.unwrap();
        assert!((score - 0.38).abs() < 0.005, "expected score ~0.38, got {score}");
    }

    #[test]
    fn match_slugs_results_sorted_descending() {
        // fine-tuning: 5/11 hits → 0.68; deep-learning: 3/12 hits → 0.38
        let text = "fine-tuning fine tuning lora peft qlora deep learning neural network convolutional";
        let results = match_slugs(text);
        assert!(results.len() >= 2, "expected at least 2 matching slugs, got {}", results.len());
        for window in results.windows(2) {
            assert!(
                window[0].1 >= window[1].1,
                "results not sorted: ({}, {:.2}) before ({}, {:.2})",
                window[0].0, window[0].1, window[1].0, window[1].1,
            );
        }
        assert_eq!(results[0].0, "fine-tuning");
    }

    // is_promo_slug

    #[test]
    fn is_promo_slug_known_promo_returns_true() {
        assert!(is_promo_slug("google-ai-fundamentals"));
    }

    #[test]
    fn is_promo_slug_unknown_slug_returns_false() {
        assert!(!is_promo_slug("machine-learning"));
    }

    // top_slug

    #[test]
    fn top_slug_returns_highest_scored_slug() {
        let text = "fine-tuning fine tuning lora peft qlora deep learning neural network convolutional";
        assert_eq!(top_slug(text), Some("fine-tuning".to_string()));
    }

    #[test]
    fn top_slug_returns_none_on_no_match() {
        assert_eq!(top_slug("Docker containers and Kubernetes pods"), None);
    }

    // classify_topic_group

    #[test]
    fn classify_generative_ai() {
        assert_eq!(classify_topic_group("Learn ChatGPT and prompt engineering"), "Generative AI & LLMs");
    }

    #[test]
    fn classify_rag() {
        assert_eq!(classify_topic_group("Build a RAG pipeline with vector database"), "RAG & Vector Search");
    }

    #[test]
    fn classify_agents() {
        assert_eq!(classify_topic_group("Build AI agent with LangChain"), "AI Agents & Frameworks");
    }

    #[test]
    fn classify_fine_tuning() {
        assert_eq!(classify_topic_group("Fine-tuning models with LoRA and PEFT"), "Fine-tuning & RLHF");
    }

    #[test]
    fn classify_other_fallback() {
        assert_eq!(classify_topic_group("Cooking recipes for beginners"), "Other");
    }

    #[test]
    fn classify_is_case_insensitive() {
        assert_eq!(classify_topic_group("DEEP LEARNING WITH PYTORCH"), "Deep Learning");
    }

    // should_follow_topic

    #[test]
    fn should_follow_ai_topic() {
        assert!(should_follow_topic("generative-ai-tools"));
    }

    #[test]
    fn should_follow_pytorch_topic() {
        assert!(should_follow_topic("pytorch-advanced"));
    }

    #[test]
    fn should_not_follow_cooking() {
        assert!(!should_follow_topic("cooking-basics"));
    }

    #[test]
    fn should_not_follow_excel() {
        assert!(!should_follow_topic("microsoft-excel"));
    }

    // ── Frontend relevance ─────────────────────────────────────────────────

    #[test]
    fn is_relevant_matches_css() {
        assert!(is_relevant("Master CSS Flexbox and Grid Layout for modern web design"));
    }

    #[test]
    fn is_relevant_matches_react() {
        assert!(is_relevant("React Hooks: Build modern component-based UIs"));
    }

    #[test]
    fn is_relevant_matches_typescript() {
        assert!(is_relevant("TypeScript Generics and Type Inference deep dive"));
    }

    #[test]
    fn is_relevant_matches_accessibility() {
        assert!(is_relevant("Web Accessibility with ARIA and screen reader testing"));
    }

    // ── Frontend topic group classification ────────────────────────────────

    #[test]
    fn classify_css_layout() {
        assert_eq!(
            classify_topic_group("Learn CSS Flexbox and Grid for responsive design"),
            "CSS & Layout"
        );
    }

    #[test]
    fn classify_react_frontend() {
        assert_eq!(
            classify_topic_group("React hooks usestate useeffect patterns"),
            "React & Frontend Frameworks"
        );
    }

    #[test]
    fn classify_typescript() {
        assert_eq!(
            classify_topic_group("TypeScript type system and generics"),
            "TypeScript & JavaScript"
        );
    }

    #[test]
    fn classify_design_systems() {
        assert_eq!(
            classify_topic_group("Build a design system with Storybook"),
            "Design Systems & Accessibility"
        );
    }

    #[test]
    fn classify_frontend_interview() {
        assert_eq!(
            classify_topic_group("Frontend interview prep with coding challenges and take-home projects"),
            "Frontend Interview Prep"
        );
    }

    #[test]
    fn classify_react_agent_as_ai_not_frontend() {
        assert_eq!(
            classify_topic_group("Build a ReAct agent with LangChain tool calling"),
            "AI Agents & Frameworks"
        );
    }

    // ── Frontend slug matching ─────────────────────────────────────────────

    #[test]
    fn match_slugs_css_layout() {
        let results = match_slugs("Learn flexbox css grid responsive design and media queries");
        let slugs: Vec<&str> = results.iter().map(|(s, _)| s.as_str()).collect();
        assert!(slugs.contains(&"css-layout-fundamentals"), "expected css-layout-fundamentals in {slugs:?}");
    }

    #[test]
    fn match_slugs_react_patterns() {
        let results = match_slugs("React hooks usestate useeffect custom hook component composition");
        let slugs: Vec<&str> = results.iter().map(|(s, _)| s.as_str()).collect();
        assert!(slugs.contains(&"react-patterns"), "expected react-patterns in {slugs:?}");
    }

    #[test]
    fn match_slugs_typescript_for_react() {
        let results = match_slugs("TypeScript React with generics and type inference");
        let slugs: Vec<&str> = results.iter().map(|(s, _)| s.as_str()).collect();
        assert!(slugs.contains(&"typescript-for-react"), "expected typescript-for-react in {slugs:?}");
    }

    // ── Frontend follow-topic ──────────────────────────────────────────────

    #[test]
    fn should_follow_css_topic() {
        assert!(should_follow_topic("css-advanced"));
    }

    #[test]
    fn should_follow_react_topic() {
        assert!(should_follow_topic("react-js-advanced"));
    }

    #[test]
    fn should_follow_typescript_topic() {
        assert!(should_follow_topic("typescript-fundamentals"));
    }

    #[test]
    fn should_follow_accessibility_topic() {
        assert!(should_follow_topic("web-accessibility"));
    }
}
