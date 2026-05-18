use std::collections::HashSet;
use std::sync::LazyLock;

static TERMS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    HashSet::from([
        // ── Foundations ──────────────────────────────────────────
        "transformer", "attention", "self-attention", "multi-head", "feedforward",
        "embedding", "tokenizer", "tokenization", "encoder", "decoder",
        "softmax", "relu", "gelu", "silu", "swiglu", "layernorm", "rmsnorm",
        "dropout", "backpropagation", "gradient", "optimizer", "adam", "adamw",
        "sgd", "learning-rate", "batch", "mini-batch", "epoch", "overfitting",
        "underfitting", "regularization", "weight-decay", "warmup", "cosine-schedule",
        "linear-schedule",

        // ── Architecture ─────────────────────────────────────────
        "bert", "gpt", "gpt-2", "gpt-3", "gpt-4", "llama", "llama-2", "llama-3",
        "mistral", "mixtral", "qwen", "phi", "phi-2", "phi-3", "gemma", "gemma-2",
        "deepseek", "deepseek-v2", "claude", "command-r", "cohere",
        "diffusion", "vae", "gan", "autoencoder", "convolution", "cnn", "rnn",
        "lstm", "gru", "resnet", "unet", "vit", "dino", "siglip",
        "mamba", "rwkv", "ssm", "state-space", "jamba", "retnet",
        "moe", "mixture-of-experts", "sparse-moe", "dense-model",

        // ── Training ─────────────────────────────────────────────
        "pretraining", "pre-training", "fine-tuning", "finetuning", "sft",
        "lora", "qlora", "dora", "peft", "adapter", "prefix-tuning",
        "rlhf", "rlaif", "dpo", "ppo", "grpo", "orpo", "kto",
        "distillation", "pruning", "quantization", "int8", "int4", "fp16",
        "bf16", "fp8", "gptq", "awq", "gguf", "ggml",
        "mixed-precision", "checkpoint", "checkpointing", "curriculum",
        "gradient-accumulation", "gradient-checkpointing",
        "data-parallel", "tensor-parallel", "pipeline-parallel",
        "fsdp", "deepspeed", "zero", "megatron",

        // ── RAG & Retrieval ──────────────────────────────────────
        "rag", "retrieval", "vector", "pgvector", "faiss", "hnsw", "ivf",
        "annoy", "scann", "milvus", "qdrant", "weaviate", "pinecone",
        "chroma", "chromadb",
        "chunking", "chunk", "reranking", "reranker", "cross-encoder",
        "bi-encoder", "bm25", "tf-idf", "tfidf", "cosine", "similarity",
        "embedding-model", "dense-retrieval", "sparse-retrieval", "hybrid-search",
        "reciprocal-rank-fusion", "rrf", "colbert", "splade",
        "semantic-search", "lexical-search", "keyword-search",
        "parent-document", "hypothetical-document", "hyde",

        // ── Agents ───────────────────────────────────────────────
        "agent", "function-calling", "tool-use", "tool-calling",
        "chain-of-thought", "cot", "react", "reflection", "reflexion",
        "planning", "orchestration", "multi-agent", "swarm",
        "langgraph", "langchain", "llamaindex", "autogen", "crewai",
        "semantic-kernel", "haystack",
        "state-machine", "workflow", "dag", "graph",
        "human-in-the-loop", "hitl", "supervisor", "router",

        // ── Evaluation ───────────────────────────────────────────
        "eval", "evaluation", "benchmark", "bleu", "rouge", "meteor",
        "perplexity", "f1-score", "f1", "precision", "recall", "accuracy",
        "hallucination", "faithfulness", "groundedness", "relevance",
        "coherence", "fluency", "toxicity-score",
        "mmlu", "hellaswag", "arc", "gsm8k", "humaneval", "mbpp",
        "mt-bench", "chatbot-arena", "elo", "win-rate",
        "deepeval", "ragas", "trulens", "langsmith", "braintrust",

        // ── Infrastructure ───────────────────────────────────────
        "inference", "serving", "vllm", "tgi", "triton", "onnx", "tensorrt",
        "ollama", "llama-cpp", "mlx", "candle",
        "cuda", "metal", "rocm", "gpu", "tpu", "npu",
        "latency", "throughput", "batching", "dynamic-batching",
        "kv-cache", "paged-attention", "speculative-decoding",
        "continuous-batching", "tensor-parallelism",
        "model-serving", "model-registry", "mlflow", "mlops",
        "a/b-testing", "canary", "blue-green",
        "rate-limiting", "load-balancing", "auto-scaling",

        // ── Safety & Alignment ───────────────────────────────────
        "alignment", "constitutional-ai", "guardrails", "guardrail",
        "red-teaming", "red-team", "jailbreak", "jailbreaking",
        "prompt-injection", "prompt-leaking",
        "toxicity", "bias", "fairness", "debiasing",
        "watermark", "watermarking", "provenance",
        "interpretability", "explainability", "mechanistic-interpretability",
        "sae", "sparse-autoencoder", "probing", "feature-visualization",
        "governance", "audit", "compliance",

        // ── Prompting ────────────────────────────────────────────
        "prompt", "prompt-engineering", "few-shot", "zero-shot", "one-shot",
        "in-context-learning", "icl", "system-prompt", "meta-prompt",
        "structured-output", "json-mode", "grammar-constrained",
        "chain-of-thought", "tree-of-thought", "graph-of-thought",
        "self-consistency", "majority-voting",
        "prompt-template", "prompt-chaining", "prompt-optimization",
        "dspy", "automatic-prompt-engineering",

        // ── ML Fundamentals ──────────────────────────────────────
        "neural-network", "deep-learning", "machine-learning", "supervised",
        "unsupervised", "semi-supervised", "self-supervised",
        "reinforcement-learning", "classification", "regression",
        "clustering", "dimensionality-reduction", "pca", "t-sne", "umap",
        "cross-validation", "k-fold", "hyperparameter", "hyperparameter-tuning",
        "feature-engineering", "feature-selection", "feature-extraction",
        "ensemble", "bagging", "boosting", "xgboost", "random-forest",
        "decision-tree", "svm", "logistic-regression", "linear-regression",
        "naive-bayes", "k-nearest-neighbors", "knn",

        // ── Data ─────────────────────────────────────────────────
        "dataset", "annotation", "labeling", "labelling",
        "synthetic-data", "augmentation", "data-augmentation",
        "preprocessing", "normalization", "standardization",
        "train-test-split", "stratification", "imbalanced-data",
        "oversampling", "undersampling", "smote",
        "data-pipeline", "etl", "data-cleaning", "deduplication",

        // ── Context & Memory ─────────────────────────────────────
        "context-window", "context-length", "rope", "alibi", "yarn",
        "ntk-aware", "position-encoding", "rotary-embedding",
        "flash-attention", "flash-attention-2", "sliding-window",
        "memory", "retrieval-augmented", "long-context",
        "ring-attention", "infini-attention",
        "context-compression", "context-distillation",

        // ── Multimodal ───────────────────────────────────────────
        "vision-language", "vlm", "clip", "blip", "blip-2", "llava",
        "whisper", "tts", "asr", "ocr", "speech-to-text", "text-to-speech",
        "image-generation", "stable-diffusion", "sdxl", "dalle", "dall-e",
        "midjourney", "flux", "imagen",
        "video-generation", "sora", "text-to-video",
        "multimodal", "cross-modal", "vision-encoder",

        // ── Math / Stats ─────────────────────────────────────────
        "tensor", "matrix", "convex", "loss-function", "cross-entropy",
        "mse", "mae", "kl-divergence", "js-divergence",
        "bayesian", "posterior", "prior", "likelihood",
        "markov", "monte-carlo", "mcmc", "sampling",
        "temperature", "top-k", "top-p", "nucleus", "min-p",
        "beam-search", "greedy-decoding", "contrastive-decoding",

        // ── Tokenization (expanded) ──────────────────────────────
        "bpe", "byte-pair-encoding", "sentencepiece", "wordpiece",
        "unigram", "tiktoken", "vocab", "vocabulary", "subword",

        // ── Scaling & Efficiency ─────────────────────────────────
        "scaling-law", "chinchilla", "compute-optimal",
        "flops", "parameters", "billion-parameters",
        "knowledge-distillation", "model-compression", "sparsity",
        "structured-pruning", "unstructured-pruning",
        "weight-sharing", "parameter-efficient",

        // ── Code & Software Engineering AI ───────────────────────
        "code-generation", "code-completion", "copilot",
        "code-review", "code-agent", "code-interpreter",
        "ast", "abstract-syntax-tree", "static-analysis",
        "test-generation", "bug-detection",

        // ── Conversational AI ────────────────────────────────────
        "chatbot", "dialogue", "dialog", "conversational",
        "turn-taking", "grounding", "persona", "role-play",
        "instruction-following", "instruction-tuning",
        "chat-template", "chat-format",

        // ── Search & Recommendations ─────────────────────────────
        "search-engine", "recommendation", "collaborative-filtering",
        "content-based-filtering", "matrix-factorization",
        "click-through-rate", "ctr", "ranking", "learning-to-rank",
        "personalization", "user-embedding",

        // ── Cloud & DevOps (AI-relevant) ─────────────────────────
        "sagemaker", "bedrock", "vertex-ai", "azure-openai",
        "lambda", "serverless", "container", "kubernetes", "docker",
        "ci-cd", "mlops", "feature-store", "model-monitoring",
        "drift-detection", "data-drift", "concept-drift",

        // ── Miscellaneous / Emerging ─────────────────────────────
        "synthetic-data-generation", "data-flywheel",
        "knowledge-graph", "ontology", "entity-extraction", "ner",
        "named-entity-recognition", "relation-extraction",
        "summarization", "abstractive", "extractive",
        "translation", "machine-translation", "nmt",
        "sentiment-analysis", "topic-modeling", "lda",
        "attention-mask", "causal-mask", "padding",
        "positional-encoding", "sinusoidal",
        "residual-connection", "skip-connection",
        "batch-normalization", "group-normalization",
        "activation-function", "non-linearity",
        "weight-initialization", "xavier", "kaiming", "he-initialization",
        "curriculum-learning", "self-play",
        "reward-model", "reward-hacking", "reward-shaping",
        "preference-learning", "preference-data",
        "safety-filter", "content-filter", "moderation",
    ])
});

pub fn is_technical(word: &str) -> bool {
    let lower = word.to_lowercase();
    let cleaned = lower.trim_matches(|c: char| !c.is_alphanumeric() && c != '-');
    TERMS.contains(cleaned)
}

pub fn term_count() -> usize {
    TERMS.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_known_terms() {
        assert!(is_technical("transformer"));
        assert!(is_technical("Transformer"));
        assert!(is_technical("RLHF"));
        assert!(is_technical("fine-tuning"));
        assert!(is_technical("kv-cache"));
    }

    #[test]
    fn rejects_common_words() {
        assert!(!is_technical("the"));
        assert!(!is_technical("hello"));
        assert!(!is_technical("running"));
    }

    #[test]
    fn strips_punctuation() {
        assert!(is_technical("transformer,"));
        assert!(is_technical("(embedding)"));
        assert!(is_technical("\"rag\""));
    }

    #[test]
    fn term_count_is_large() {
        assert!(term_count() > 300, "Expected 300+ terms, got {}", term_count());
    }
}
