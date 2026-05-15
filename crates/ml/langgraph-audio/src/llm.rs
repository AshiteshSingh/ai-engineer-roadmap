use candle_core::quantized::gguf_file;
use candle_core::{Device, Tensor};
use candle_transformers::generation::{LogitsProcessor, Sampling};
use candle_transformers::models::quantized_qwen2::ModelWeights;
use hf_hub::api::sync::Api;
use tokenizers::Tokenizer;

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("hf-hub: {0}")]
    Hub(String),
    #[error("tokenizer: {0}")]
    Tokenizer(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("inference: {0}")]
    Inference(#[from] candle_core::Error),
}

pub type Result<T> = std::result::Result<T, LlmError>;

pub const DEFAULT_MODEL_REPO: &str = "Qwen/Qwen2.5-1.5B-Instruct-GGUF";
pub const DEFAULT_MODEL_FILE: &str = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
/// Tokenizer is distributed separately from the GGUF weights.
pub const DEFAULT_TOKENIZER_REPO: &str = "Qwen/Qwen2.5-1.5B-Instruct";

/// Greedy quantized-Qwen wrapper, mirroring the pattern in
/// `crates/course-review/src/llm.rs`. Greedy decoding keeps the narration
/// script deterministic across runs so the chunker output stays stable.
pub struct QuantizedQwen {
    model: ModelWeights,
    tokenizer: Tokenizer,
    device: Device,
    pub model_name: String,
}

impl QuantizedQwen {
    pub fn load_default(device: &Device) -> Result<Self> {
        Self::load(DEFAULT_MODEL_REPO, DEFAULT_MODEL_FILE, DEFAULT_TOKENIZER_REPO, device)
    }

    pub fn load(
        model_repo: &str,
        model_file: &str,
        tokenizer_repo: &str,
        device: &Device,
    ) -> Result<Self> {
        let api = Api::new().map_err(|e| LlmError::Hub(e.to_string()))?;

        tracing::info!("downloading {model_repo}/{model_file}");
        let model_path = api
            .model(model_repo.to_string())
            .get(model_file)
            .map_err(|e| LlmError::Hub(e.to_string()))?;

        let tokenizer_path = api
            .model(tokenizer_repo.to_string())
            .get("tokenizer.json")
            .map_err(|e| LlmError::Hub(e.to_string()))?;

        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| LlmError::Tokenizer(e.to_string()))?;

        let mut file = std::fs::File::open(&model_path)?;
        let gguf = gguf_file::Content::read(&mut file)?;
        let model = ModelWeights::from_gguf(gguf, &mut file, device)?;

        tracing::info!("LLM loaded: {model_repo}/{model_file}");
        Ok(Self {
            model,
            tokenizer,
            device: device.clone(),
            model_name: model_file.to_string(),
        })
    }

    /// Format a `<system, user>` pair using the Qwen2.5 ChatML template.
    pub fn chat_prompt(system: &str, user: &str) -> String {
        format!(
            "<|im_start|>system\n{system}<|im_end|>\n\
             <|im_start|>user\n{user}<|im_end|>\n\
             <|im_start|>assistant\n"
        )
    }

    /// Run greedy generation against `prompt`. Returns only the newly
    /// generated text (prompt is stripped).
    pub fn generate(&mut self, prompt: &str, max_tokens: usize) -> Result<String> {
        let encoding = self
            .tokenizer
            .encode(prompt, true)
            .map_err(|e| LlmError::Tokenizer(format!("encode: {e}")))?;
        let prompt_tokens: Vec<u32> = encoding.get_ids().to_vec();
        let prompt_len = prompt_tokens.len();

        let eos_token = self
            .tokenizer
            .token_to_id("<|im_end|>")
            .or_else(|| self.tokenizer.token_to_id("<|endoftext|>"))
            .unwrap_or(0);

        let mut logits_processor = LogitsProcessor::from_sampling(42, Sampling::ArgMax);
        let mut all_tokens = prompt_tokens.clone();

        // Prefill: process the full prompt in one forward pass.
        let input = Tensor::new(prompt_tokens.as_slice(), &self.device)?.unsqueeze(0)?;
        let logits = self.model.forward(&input, 0)?;
        let logits = logits.squeeze(0)?.squeeze(0)?;
        let mut next_token = logits_processor.sample(&logits)?;
        all_tokens.push(next_token);

        for step in 1..max_tokens {
            if next_token == eos_token {
                break;
            }
            let input = Tensor::new(&[next_token], &self.device)?.unsqueeze(0)?;
            let logits = self.model.forward(&input, prompt_len + step)?;
            let logits = logits.squeeze(0)?.squeeze(0)?;
            next_token = logits_processor.sample(&logits)?;
            all_tokens.push(next_token);
            if next_token == eos_token {
                break;
            }
        }

        let new_tokens = &all_tokens[prompt_len..];
        let text = self
            .tokenizer
            .decode(new_tokens, true)
            .map_err(|e| LlmError::Tokenizer(format!("decode: {e}")))?;
        Ok(text)
    }
}
