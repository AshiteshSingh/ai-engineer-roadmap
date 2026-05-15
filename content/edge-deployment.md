# Edge Deployment: On-Device Models, ONNX & WebLLM

The centralized cloud model of LLM inference -- where every token is generated on remote GPU clusters -- is increasingly challenged by latency requirements, privacy regulations, connectivity constraints, and cost pressures. Edge deployment places inference computation closer to (or directly on) the end user's device, encompassing everything from llama.cpp on a laptop to WebGPU-accelerated models in a browser tab. This article examines the runtime landscape, optimization techniques, and architectural patterns that make on-device and edge LLM inference practical, along with the trade-offs that determine when edge deployment is the right choice.

## TL;DR

- INT4 quantization is the edge sweet spot: 8x size reduction with only 1-3% quality loss makes 7-8B models practical on consumer hardware.
- llama.cpp is the universal on-device runtime; MLX is the best choice specifically for Apple Silicon; ONNX Runtime provides the widest cross-platform hardware coverage.
- Hybrid edge-cloud architectures outperform either approach alone -- use edge for latency-sensitive preprocessing and privacy filtering, cloud for complex generation.
- Platform providers (Apple Intelligence, Gemini Nano, Samsung Galaxy AI) now treat on-device models as OS-level capabilities, not app-level concerns.
- The edge deployment decision comes down to four factors: latency requirements, privacy constraints, cost at scale, and offline needs.

## The Case for Edge Inference

### Latency

Cloud LLM inference adds network round-trip latency (50-200ms), TLS handshake overhead, and queue wait time before the first token is even generated. For real-time applications -- autocomplete, voice assistants, interactive coding tools -- this overhead is perceptible and degrades user experience. On-device inference eliminates network latency entirely, delivering first-token times under 100ms for small models.

### Privacy

Certain use cases require that data never leaves the device. Healthcare applications processing patient records, legal tools analyzing privileged documents, and enterprise systems handling classified information all benefit from inference that operates entirely within the device's trust boundary. No API call means no data in transit, no third-party data processing agreements, and no risk of prompt data appearing in provider logs.

### Cost

Once the model is downloaded to the device, inference is "free" from a marginal cost perspective -- the user's hardware provides the compute. For applications with millions of users making frequent small requests (autocomplete, grammar checking, classification), the aggregate API cost can be substantial. Edge deployment shifts this cost to the user's existing hardware.

### Offline Capability

Edge models work without internet connectivity, enabling use cases in aircraft, remote locations, industrial environments, and mobile applications with spotty connectivity.

> **Note:** If none of these four factors -- latency, privacy, cost at scale, or offline need -- are compelling for your use case, cloud inference remains simpler to operate and gives access to larger, more capable models.

## On-Device Inference Runtimes

### llama.cpp

llama.cpp (Gerganov, 2023) is the most influential on-device LLM runtime. Written in C/C++ with no dependencies beyond the standard library, it runs on virtually any hardware: x86, ARM, Apple Silicon, Android, and even microcontrollers. Its GGUF model format has become the de facto standard for quantized model distribution.

Key technical features:
- **Quantization support**: 2-bit through 8-bit quantization with multiple schemes (Q4_K_M, Q5_K_S, Q8_0, etc.)
- **Platform-specific optimizations**: AVX2/AVX-512 on x86, NEON on ARM, Metal on Apple Silicon, CUDA on NVIDIA GPUs, Vulkan for cross-platform GPU
- **Memory-mapped model loading**: Maps model weights directly from disk, allowing the OS to manage memory paging
- **Speculative decoding**: Built-in support for draft model speculation

```bash
# Build llama.cpp with Metal (Apple Silicon) support
cmake -B build -DLLAMA_METAL=ON
cmake --build build --config Release

# Run inference with a quantized model
./build/bin/llama-cli \
    -m models/llama-3.1-8b-instruct-Q4_K_M.gguf \
    -p "Explain edge computing in one paragraph" \
    -n 256 \
    --temp 0.7 \
    -ngl 99    # Offload all layers to GPU
```

Performance on Apple Silicon (M3 Max 36GB / M4 Pro 24GB):

| Model | Quantization | Size | M3 Max tok/s | M4 Pro tok/s |
|---|---|---|---|---|
| Llama 3.1 8B | Q4_K_M | 4.9 GB | ~55 | ~62 |
| Llama 3.1 8B | Q8_0 | 8.5 GB | ~40 | ~46 |
| Llama 3.1 70B | Q4_K_M | 40 GB | ~12 | ~14 |
| Phi-3 Mini 3.8B | Q4_K_M | 2.3 GB | ~85 | ~95 |
| Qwen 2.5 7B | Q4_K_M | 4.4 GB | ~58 | ~66 |

### MLX (Apple Silicon)

MLX is Apple's machine learning framework specifically designed for Apple Silicon's unified memory architecture, where CPU and GPU share the same memory pool -- eliminating the costly CPU-to-GPU memory transfers that bottleneck inference on discrete GPU systems. With M4-generation chips, MLX benefits from increased memory bandwidth (up to 273 GB/s on M4 Max) and a larger Neural Engine (38 TOPS on M4 vs. 18 TOPS on M3), translating directly to higher inference throughput.

```python
import mlx.core as mx
from mlx_lm import load, generate

# Load a model optimized for MLX
model, tokenizer = load("mlx-community/Llama-3.1-8B-Instruct-4bit")

# Generate text
response = generate(
    model,
    tokenizer,
    prompt="What are the advantages of edge deployment?",
    max_tokens=256,
    temp=0.7,
)
print(response)
```

MLX's key advantage over llama.cpp on Apple Silicon is its Python-first API and tight integration with the PyTorch ecosystem, making it easier to fine-tune models directly on Mac hardware. The `mlx-lm` library provides a streamlined workflow for quantization, conversion, and serving.

```python
# Quantize a model for MLX
from mlx_lm import convert

convert(
    hf_path="meta-llama/Llama-3.1-8B-Instruct",
    mlx_path="models/llama-3.1-8b-mlx-4bit",
    quantize=True,
    q_bits=4,
    q_group_size=64,
)
```

### ONNX Runtime

ONNX Runtime provides a cross-platform inference engine that runs on CPUs, GPUs, and specialized accelerators. Its strength is hardware abstraction: a single ONNX model can run on NVIDIA GPUs (via CUDA/TensorRT), Intel CPUs (via OpenVINO), Qualcomm NPUs (via QNN), and Apple Silicon (via Core ML) through execution providers.

```python
import onnxruntime as ort
import numpy as np

# Create session with appropriate execution provider
providers = [
    ("CUDAExecutionProvider", {"device_id": 0}),      # NVIDIA GPU
    ("CoreMLExecutionProvider", {}),                     # Apple Neural Engine
    ("CPUExecutionProvider", {}),                        # Fallback
]

session = ort.InferenceSession("model.onnx", providers=providers)

# Run inference
input_ids = tokenizer.encode("Hello, how are you?", return_tensors="np")
outputs = session.run(None, {"input_ids": input_ids})
```

For LLM inference specifically, ONNX Runtime GenAI extends the base runtime with autoregressive generation support, KV-cache management, and beam search:

```python
import onnxruntime_genai as og

model = og.Model("models/phi-3-mini-onnx")
tokenizer = og.Tokenizer(model)

params = og.GeneratorParams(model)
params.set_search_options(max_length=256, temperature=0.7)

prompt = "Explain ONNX Runtime"
input_tokens = tokenizer.encode(prompt)
params.input_ids = input_tokens

generator = og.Generator(model, params)
while not generator.is_done():
    generator.compute_logits()
    generator.generate_next_token()

output = tokenizer.decode(generator.get_sequence(0))
```

The ONNX ecosystem excels at model optimization through graph transformations: operator fusion, constant folding, and layout optimization can improve inference speed by 20-40% beyond what the original framework achieves.

## Browser-Based Inference

### WebLLM and WebGPU

WebLLM (MLC team, built on Apache TVM) brings LLM inference directly to the browser using WebGPU, the modern GPU API that replaces WebGL for general-purpose GPU computing. This enables truly client-side inference with no server involvement.

```javascript
import { CreateMLCEngine } from "@mlc-ai/web-llm";

// Initialize the engine (downloads and caches model on first use)
const engine = await CreateMLCEngine("Llama-3.1-8B-Instruct-q4f16_1-MLC", {
    initProgressCallback: (progress) => {
        console.log(`Loading: ${progress.text}`);
    }
});

// Use OpenAI-compatible API
const response = await engine.chat.completions.create({
    messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is WebGPU?" }
    ],
    temperature: 0.7,
    max_tokens: 256,
    stream: true,
});

// Stream the response
for await (const chunk of response) {
    const content = chunk.choices[0]?.delta?.content || "";
    process.stdout.write(content);
}
```

WebLLM's architecture:

```text
┌─────────────────────────────────────────┐
│              Browser Tab                │
│  ┌───────────────────────────────────┐  │
│  │     JavaScript Application       │  │
│  │  (OpenAI-compatible API)         │  │
│  └────────────┬──────────────────────┘  │
│               │                         │
│  ┌────────────▼──────────────────────┐  │
│  │      WebLLM Runtime              │  │
│  │  (TVM-compiled model, WASM)      │  │
│  └────────────┬──────────────────────┘  │
│               │                         │
│  ┌────────────▼──────────────────────┐  │
│  │         WebGPU API               │  │
│  │  (GPU shader compilation)        │  │
│  └────────────┬──────────────────────┘  │
│               │                         │
└───────────────┼─────────────────────────┘
                │
    ┌───────────▼───────────────┐
    │      GPU Hardware         │
    │  (Metal/Vulkan/D3D12)     │
    └───────────────────────────┘
```

**Limitations**: WebGPU is not yet universally supported (notably absent in Firefox as of early 2026), model download sizes are large (2-8GB for useful models), and browser memory constraints limit model size. Performance is typically 60-80% of native llama.cpp on the same hardware.

### Transformers.js (@huggingface/transformers)

Hugging Face's Transformers.js -- now published as `@huggingface/transformers` (the `@xenova/transformers` package is deprecated) -- runs transformer models in the browser using ONNX Runtime Web (WASM + WebGPU backends). Version 3.x added WebGPU acceleration, text-generation pipelines, and multimodal model support, significantly expanding beyond the original focus on classification and embedding tasks.

```javascript
import { pipeline } from "@huggingface/transformers";

// Text classification in the browser
const classifier = await pipeline(
    "sentiment-analysis",
    "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
);
const result = await classifier("I love this product!");
// [{label: "POSITIVE", score: 0.9998}]

// Feature extraction (embeddings) in the browser
const embedder = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
);
const embedding = await embedder("Hello world", {
    pooling: "mean",
    normalize: true,
});

// Text generation (new in v3)
const generator = await pipeline(
    "text-generation",
    "onnx-community/Qwen2.5-0.5B-Instruct",
    { dtype: "q4", device: "webgpu" }
);
const output = await generator("Explain edge inference:", { max_new_tokens: 128 });
```

## Mobile Deployment

### Core ML (iOS/macOS)

Apple's Core ML framework is the primary path for deploying ML models on iOS and macOS. Models are compiled into the `.mlmodelc` format and can execute on the CPU, GPU, or Apple Neural Engine (ANE) -- a dedicated ML accelerator present in all modern Apple chips.

```swift
import CoreML

// Load the compiled model
let config = MLModelConfiguration()
config.computeUnits = .all  // Use CPU + GPU + ANE

let model = try MLModel(contentsOf: modelURL, configuration: config)

// For LLM inference, use the generate API
let input = try MLDictionaryFeatureProvider(dictionary: [
    "input_ids": MLMultiArray(inputTokens),
    "attention_mask": MLMultiArray(attentionMask),
])

let output = try model.prediction(from: input)
```

Apple's `coremltools` library converts PyTorch and TensorFlow models to Core ML format with optional quantization:

```python
import coremltools as ct

# Convert a PyTorch model to Core ML
mlmodel = ct.convert(
    traced_model,
    inputs=[ct.TensorType(shape=(1, ct.RangeDim(1, 2048)), dtype=np.int32)],
    compute_units=ct.ComputeUnit.ALL,
    minimum_deployment_target=ct.target.iOS17,
)

# Apply palettization (weight clustering) for size reduction
from coremltools.optimize.coreml import OpPalettizerConfig, OptimizationConfig

config = OptimizationConfig(
    global_config=OpPalettizerConfig(nbits=4, mode="kmeans")
)
compressed_model = ct.optimize.coreml.palettize_weights(mlmodel, config)
compressed_model.save("model_4bit.mlpackage")
```

### TensorFlow Lite / LiteRT (Android)

Google's TensorFlow Lite (recently rebranded as LiteRT) is the primary framework for on-device inference on Android. It supports GPU delegation (via OpenCL or Vulkan), NNAPI for hardware accelerator access, and hexagon DSP delegation on Qualcomm chips.

```kotlin
// Android: Load and run a TFLite model
val interpreter = Interpreter(modelFile, Interpreter.Options().apply {
    addDelegate(GpuDelegate())  // Use GPU acceleration
    setNumThreads(4)
})

val inputBuffer = ByteBuffer.allocateDirect(inputSize)
// ... fill input buffer with tokenized input

val outputBuffer = ByteBuffer.allocateDirect(outputSize)
interpreter.run(inputBuffer, outputBuffer)
```

For LLM-scale models on Android, the MediaPipe LLM Inference API provides a higher-level abstraction:

```kotlin
val llmInference = LlmInference.createFromOptions(
    context,
    LlmInference.LlmInferenceOptions.builder()
        .setModelPath("/data/local/tmp/gemma-2b-it-gpu-int4.bin")
        .setMaxTokens(1024)
        .setResultListener { partialResult, done ->
            // Handle streaming tokens
            updateUI(partialResult)
        }
        .build()
)

llmInference.generateResponseAsync("What is edge computing?")
```

## Model Optimization for Edge

### Quantization

Quantization reduces model precision from FP32/FP16 to lower bit-widths, directly reducing model size and improving inference speed. The main techniques:

> **Tip:** INT4 (Q4_K_M in GGUF, 4-bit groupwise in ExecuTorch) is the default recommendation for edge deployment. It halves memory versus INT8 with only 1-3% quality degradation on most benchmarks -- the best quality-per-byte tradeoff available.

**Post-Training Quantization (PTQ)**: Applied after training without fine-tuning. GPTQ (Frantar et al., 2022) and AWQ (Lin et al., 2023, "AWQ: Activation-aware Weight Quantization for LLM Compression and Acceleration") are the leading methods.

```python
# AWQ quantization with autoawq
from awq import AutoAWQForCausalLM
from transformers import AutoTokenizer

model = AutoAWQForCausalLM.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")
tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")

# Calibrate with representative data
quant_config = {
    "zero_point": True,
    "q_group_size": 128,
    "w_bit": 4,
    "version": "GEMM"
}

model.quantize(tokenizer, quant_config=quant_config)
model.save_quantized("llama-3.1-8b-awq-4bit")
```

**Quality impact by bit-width** (approximate, model-dependent):

| Bit-width | Size Reduction | Quality Impact | Use Case |
|---|---|---|---|
| FP16 | 2x vs FP32 | None | Server baseline |
| INT8 | 4x vs FP32 | Negligible (<1%) | Edge with quality priority |
| INT4 | 8x vs FP32 | Small (1-3%) | Edge default sweet spot |
| INT3 | 10x vs FP32 | Moderate (3-8%) | Memory-constrained devices |
| INT2 | 16x vs FP32 | Significant (8-15%) | Extreme compression |

### Pruning

Pruning removes unnecessary weights or structures from the model. **Structured pruning** removes entire attention heads, neurons, or layers, producing a genuinely smaller model. **Unstructured pruning** zeroes out individual weights, requiring sparse matrix support for speedup.

The SparseGPT algorithm (Frantar & Alistarh, 2023) achieves 50-60% unstructured sparsity with minimal quality loss on large models:

```python
# Conceptual structured pruning: remove attention heads with lowest importance
def prune_attention_heads(model, num_heads_to_remove_per_layer=4):
    for layer in model.layers:
        head_importance = compute_head_importance(layer, calibration_data)
        heads_to_prune = head_importance.argsort()[:num_heads_to_remove_per_layer]
        layer.self_attn.prune_heads(heads_to_prune)
    return model
```

### Knowledge Distillation

Knowledge distillation trains a small "student" model to mimic the outputs of a large "teacher" model. For edge deployment, this can produce models that are both smaller and more task-specific than general-purpose quantized models.

```python
# Distillation training loop (simplified)
def distillation_step(teacher, student, input_ids, temperature=2.0, alpha=0.5):
    with torch.no_grad():
        teacher_logits = teacher(input_ids).logits

    student_logits = student(input_ids).logits

    # Soft target loss (KL divergence between teacher and student distributions)
    soft_loss = F.kl_div(
        F.log_softmax(student_logits / temperature, dim=-1),
        F.softmax(teacher_logits / temperature, dim=-1),
        reduction="batchmean"
    ) * (temperature ** 2)

    # Hard target loss (standard cross-entropy)
    hard_loss = F.cross_entropy(student_logits, input_ids[:, 1:])

    # Combined loss
    return alpha * soft_loss + (1 - alpha) * hard_loss
```

## Hybrid Edge-Cloud Architectures

Pure edge deployment limits model capability; pure cloud deployment limits latency, privacy, and offline use. Hybrid architectures combine both.

### Speculative Edge-Cloud

Use a small edge model for speculative decoding, with a cloud model as the verifier. The edge model generates draft tokens locally (fast, private), and the cloud model verifies and corrects in parallel:

```python
class HybridSpeculativeInference:
    def __init__(self, edge_model, cloud_client):
        self.edge = edge_model       # Small model running locally
        self.cloud = cloud_client    # API client for large model

    async def generate(self, prompt: str, max_tokens: int = 256):
        tokens = tokenize(prompt)
        output = []

        while len(output) < max_tokens:
            # Edge model generates K draft tokens (fast, local)
            draft_tokens = self.edge.generate(tokens, num_tokens=8)

            # Cloud model verifies in parallel (one forward pass)
            verified = await self.cloud.verify(tokens, draft_tokens)

            # Accept verified tokens
            accepted = verified.accepted_tokens
            output.extend(accepted)
            tokens.extend(accepted)

            if verified.hit_eos:
                break

        return detokenize(output)
```

### Tiered Processing

Route requests based on complexity: handle simple tasks on-device and escalate complex tasks to the cloud:

```python
class TieredInference:
    def __init__(self, edge_model, cloud_client, complexity_threshold=0.6):
        self.edge = edge_model
        self.cloud = cloud_client
        self.threshold = complexity_threshold

    async def process(self, request: str) -> str:
        # Quick complexity assessment on-device
        complexity = self.edge.assess_complexity(request)

        if complexity < self.threshold:
            # Handle locally
            return self.edge.generate(request)
        else:
            # Escalate to cloud (if connected)
            if self.is_online():
                return await self.cloud.generate(request)
            else:
                # Fallback: best-effort local generation
                return self.edge.generate(
                    request,
                    system="You may not have enough capability for this. "
                           "Do your best and note any uncertainty."
                )
```

### Edge Preprocessing + Cloud Generation

Use edge models for preprocessing tasks (embedding, classification, extraction) and cloud models only for generation:

```text
User Device                          Cloud
┌─────────────────┐                 ┌──────────────────┐
│ Edge Model       │                 │ Cloud LLM         │
│ - Embed query    │──embedding──>   │ - RAG retrieval   │
│ - Classify intent│──intent────>    │ - Generate response│
│ - Extract entities│──entities──>   │                    │
│ - PII detection  │                 │                    │
│   (strip before  │                 │                    │
│    sending)      │                 │                    │
└─────────────────┘                 └──────────────────┘
```

This pattern preserves privacy by filtering PII on-device before any data reaches the cloud, while still leveraging cloud model capability for the generation task.

## Performance Benchmarking on Edge

When evaluating edge deployment options, standardize your benchmarks:

```python
@dataclass
class EdgeBenchmarkResult:
    runtime: str              # "llama.cpp", "mlx", "onnxruntime", etc.
    model: str                # Model name and size
    quantization: str         # "Q4_K_M", "4bit", "INT8", etc.
    device: str               # "M3 Max", "iPhone 15 Pro", "Pixel 8"
    model_load_time_s: float  # Time to load model into memory
    model_size_gb: float      # On-disk model size
    memory_usage_gb: float    # Peak RAM/VRAM during inference
    prefill_tok_per_s: float  # Input processing speed
    decode_tok_per_s: float   # Output generation speed
    ttft_ms: float            # Time to first token
    power_draw_w: float       # Power consumption during inference
    battery_impact: str       # Estimated battery life impact
```

## On-Device Model Ecosystems

The major platform providers have moved beyond treating on-device AI as an afterthought. Apple, Google, and Samsung now ship integrated model ecosystems that blur the line between operating system and inference runtime.

### Apple Intelligence

Apple Intelligence, introduced with iOS 18 and macOS Sequoia, runs a family of Apple-trained foundation models directly on-device. The system routes requests between a ~3B parameter on-device model and Apple's Private Cloud Compute servers based on task complexity -- an approach conceptually similar to the tiered processing pattern described earlier in this article.

On-device processing handles text rewriting, summarization, priority classification in Mail, and smart reply generation. Tasks requiring greater capability are routed to server-side models running on Apple Silicon servers, with a cryptographic guarantee that user data is not stored or accessible to Apple.

The on-device model runs through Core ML on the Apple Neural Engine, with 4-bit palettized weights and grouped query attention to fit within mobile memory constraints. Apple's approach is notable for its tight integration: the model is embedded in the OS, invisible to the user, and invoked through system APIs rather than a standalone app. Third-party developers access Apple Intelligence through system frameworks (like the Writing Tools API) rather than running models directly.

### Gemini Nano

Google's Gemini Nano is the on-device member of the Gemini model family, available through Android's AICore system service. Gemini Nano powers Smart Reply in Gboard, summarization in Recorder, and contextual suggestions across Google apps. Unlike Apple's approach, Google exposes Gemini Nano to third-party developers through the ML Kit On-Device AI API, allowing any Android app to run inference without bundling a model.

Gemini Nano uses 4-bit quantization and runs on supported hardware through Android's NNAPI, which dispatches operations to the most capable available accelerator -- GPU, DSP, or NPU. The model is downloaded and updated through Google Play Services, meaning it shares storage across apps and receives updates independently of the OS version.

### Samsung Galaxy AI

Samsung's Galaxy AI, featured on the S24 series and newer, combines on-device models with cloud-based processing. The on-device stack runs on Qualcomm's AI Engine (Hexagon NPU + Adreno GPU), handling real-time tasks like Live Translate (on-device speech translation during phone calls), transcript summarization, and photo editing suggestions. Samsung partners with both Google (Gemini Nano integration) and its own proprietary models (Samsung Gauss) to power different features.

The common pattern across all three ecosystems: platform providers treat on-device models as a system capability rather than an app-level concern, manage model lifecycle and updates through OS-level infrastructure, and use hybrid routing to balance capability against latency and privacy.

## ExecuTorch and PyTorch Mobile

Meta's ExecuTorch is the successor to PyTorch Mobile, providing a unified framework for deploying PyTorch models on mobile and edge devices. Where the earlier PyTorch Mobile used TorchScript (a restricted Python subset) for model serialization, ExecuTorch uses `torch.export` to capture a clean computation graph as an ExportedProgram, then compiles it for target hardware through a delegate system.

The deployment workflow follows a clear pipeline:

```python
import torch
from executorch.exir import to_edge
from executorch.backends.xnnpack.partition import XnnpackPartitioner

# 1. Export the model using torch.export
model = MyModel()
example_inputs = (torch.randn(1, 3, 224, 224),)
exported = torch.export.export(model, example_inputs)

# 2. Lower to edge representation and delegate to backend
edge_program = to_edge(exported)
edge_program = edge_program.to_backend(XnnpackPartitioner())

# 3. Convert to ExecuTorch program
et_program = edge_program.to_executorch()

# 4. Save the .pte file for deployment
with open("model.pte", "wb") as f:
    f.write(et_program.buffer)
```

ExecuTorch supports multiple backend delegates: XNNPACK for optimized CPU inference, Core ML for Apple Neural Engine dispatch, Qualcomm QNN for Hexagon NPU, and Vulkan for cross-platform GPU. The key design decision is that delegation is composable -- operations not supported by a given accelerator fall back to a portable CPU implementation, ensuring the model always runs even on unfamiliar hardware.

For LLM-scale models, Meta has demonstrated Llama 3.2 1B and 3B running through ExecuTorch on recent Android and iOS devices, with 4-bit groupwise quantization (via the `torchao` library) bringing the 3B model under 2GB on disk. The ExecuTorch runtime itself is under 1MB, making it feasible to embed in mobile apps without significant size overhead.

ExecuTorch represents the direction PyTorch deployment is heading: a single export path from research to production, with hardware-specific optimization handled by the delegate layer rather than requiring separate model formats for each target platform.

> **Tip:** For teams already in the PyTorch ecosystem, ExecuTorch is the lowest-friction path to mobile deployment -- it eliminates the conversion step to ONNX or Core ML and preserves the ability to debug inference issues in the same framework used for training.

## NPU / Neural Accelerator Landscape

Modern mobile and laptop SoCs include dedicated neural processing units (NPUs) -- fixed-function or semi-programmable accelerators designed for high-throughput, energy-efficient matrix operations. These NPUs are critical for practical edge inference because they deliver significantly better performance-per-watt than running the same operations on the CPU or GPU.

| Accelerator | Vendor | Found In | Peak TOPS (INT8) | Key Characteristics |
|---|---|---|---|---|
| Apple Neural Engine (ANE) | Apple | M1-M4, A15-A18 Pro | 38 (M4) / 35 (A18 Pro) | 16-core engine; tight Core ML integration; excels at conv/matmul but limited control flow |
| Hexagon NPU | Qualcomm | Snapdragon 8 Gen 3/Elite X | 45 (8 Gen 3) / 75 (Elite X) | Scalar + vector + tensor cores; QNN SDK; best Android NPU ecosystem |
| Google TPU Mobile (Tensor G) | Google | Pixel 8/9 series | ~10-12 (estimated) | Derived from cloud TPU architecture; tightly coupled with AICore/NNAPI; powers Gemini Nano |
| Samsung NPU (Exynos) | Samsung | Exynos 2400/2500 | 14.7 (Exynos 2400) | Dual NPU cores; used alongside Qualcomm AI Engine in Galaxy S24 (market-dependent) |
| Intel NPU | Intel | Core Ultra (Meteor Lake+) | 10-11 | Integrated in laptop SoCs; OpenVINO SDK; targets sustained low-power workloads |
| AMD XDNA (Ryzen AI) | AMD | Ryzen AI 300 series | 50 (Ryzen AI 9 HX 370) | Block FP16 support; targets Copilot+ PC workloads via DirectML |

**Key considerations when targeting NPUs:**

**Operator coverage varies widely.** NPUs accelerate a subset of operations -- typically matrix multiplications, convolutions, and element-wise activations. Transformer-specific operations like rotary positional embeddings, KV-cache manipulation, or custom attention patterns may fall back to the CPU or GPU. This means that simply compiling a model for NPU dispatch does not guarantee full acceleration; profiling actual operator placement is essential.

**Programming models are fragmented.** Apple requires Core ML format. Qualcomm uses QNN. Google routes through NNAPI (soon to be replaced by the ML Accelerator API on Android 16). Intel uses OpenVINO. There is no universal NPU programming interface, which is why cross-platform runtimes like ONNX Runtime (with per-vendor execution providers) and ExecuTorch (with per-vendor delegates) are valuable -- they abstract the backend while exposing a single developer-facing API.

**Power efficiency is the real advantage.** NPUs typically deliver 5-10x better performance-per-watt than the GPU for supported operations. For always-on or battery-sensitive tasks (voice detection, background text analysis, on-device search indexing), NPU dispatch is the difference between a feature being practical and draining the battery in two hours.

> **Note:** Always profile actual operator placement on your target NPU before publishing performance numbers. A model that shows 10 TOPS theoretical throughput may achieve only 2-3 TOPS in practice if key transformer operations fall back to CPU.

## Model Selection for Edge

Choosing the right model for edge deployment requires balancing capability, size, and hardware fit. The landscape of small language models has expanded rapidly, with multiple model families targeting the sub-10B parameter range. Here is a decision framework based on practical deployment constraints.

### Sub-1B: Extreme Edge

For devices with under 2GB of available memory (low-end phones, embedded systems, browser contexts):

- **Qwen 2.5 0.5B**: Strongest multilingual capability at this scale. Performs well on classification, extraction, and simple instruction following. Available in GGUF, ONNX, and ExecuTorch formats.
- **SmolLM2 360M/1.7B** (Hugging Face): Purpose-built for edge. The 360M variant runs comfortably in-browser via Transformers.js with WebGPU.

### 1B-4B: Mobile Sweet Spot

For flagship phones, tablets, and resource-constrained laptops:

- **Llama 3.2 1B/3B**: Meta's purpose-built mobile models. First-class ExecuTorch support. The 3B variant at Q4 fits in ~2GB and handles summarization, instruction following, and tool use. Limited multilingual capability compared to Qwen.
- **Gemma 2 2B / Gemma 3 1B/4B**: Google's compact models optimized for mobile deployment. Gemma 3 4B offers strong multilingual and multimodal (vision) capability. Well-supported through MediaPipe and LiteRT on Android.
- **Phi-3.5 Mini 3.8B / Phi-4 Mini 3.8B**: Microsoft's small models punch above their weight on reasoning benchmarks. Phi-4 Mini adds improved instruction following and function calling. Available in ONNX format with ONNX Runtime GenAI, making them straightforward to deploy cross-platform.

### 4B-10B: Laptop and Desktop

For devices with 8GB+ RAM (M-series Macs, gaming laptops, workstations):

- **Llama 3.1 8B**: The general-purpose workhorse. Extensive ecosystem support (GGUF, MLX, ONNX, ExecuTorch). Strong instruction following and tool use.
- **Qwen 2.5 7B**: Best-in-class for multilingual use cases and coding tasks at this scale. Excellent GGUF quantization quality.
- **Gemma 2 9B**: Strong reasoning capability. Higher quality than its size suggests due to distillation from larger Gemma models (see [Article 24: Distillation & Model Compression](/distillation-compression) for distillation techniques).
- **Mistral 7B / Mistral Nemo 12B**: Efficient architectures with sliding window attention. Nemo 12B pushes the upper bound of what runs comfortably on 16GB devices at Q4.

### Decision Matrix

| Constraint | Recommended Model | Quantization | Approx. Size | Runtime |
|---|---|---|---|---|
| Browser, no server | Qwen 2.5 0.5B | Q4 | ~400 MB | WebLLM or @huggingface/transformers |
| Mobile, 3GB RAM budget | Llama 3.2 1B | Q4 | ~800 MB | ExecuTorch / Core ML |
| Mobile, 6GB RAM budget | Gemma 3 4B or Phi-4 Mini | Q4 | ~2.5 GB | MediaPipe / ONNX Runtime |
| Laptop, 8GB RAM | Llama 3.1 8B | Q4_K_M | ~4.9 GB | llama.cpp / MLX |
| Laptop, 16GB+ RAM | Qwen 2.5 14B or Mistral Nemo 12B | Q4_K_M | ~8-9 GB | llama.cpp / MLX |

The quantization technique matters as much as the model choice. INT4 quantization (Q4_K_M in GGUF, 4-bit groupwise in ExecuTorch, INT4 in ONNX Runtime) is the default recommendation for edge -- it halves memory again versus INT8 with only 1-3% quality degradation on most benchmarks. For a detailed treatment of quantization algorithms and their quality/size trade-offs, see [Article 05: Inference Optimization](/inference-optimization).

## Cross-References

This article connects to several other topics in this series:

- **[Article 05: Inference Optimization](/inference-optimization)** covers quantization algorithms (GPTQ, AWQ, SmoothQuant), KV-cache management, and speculative decoding in depth -- all techniques that directly apply to edge inference, just at a different scale.
- **[Article 24: Distillation & Model Compression](/distillation-compression)** explores the compression pipeline (distillation, pruning, quantization-aware training) that produces the small models used in edge deployment. Many of the sub-4B models recommended above are themselves distilled from larger teachers.
- **[Article 50: Audio & Speech AI](/audio-speech-ai)** covers ASR and TTS pipelines, which are among the most compelling on-device use cases. Whisper Tiny/Base running locally via llama.cpp or Core ML enables fully offline voice transcription, and on-device TTS eliminates round-trip latency for voice agents.

## Summary and Key Takeaways

1. **llama.cpp is the universal edge runtime**: its C/C++ implementation with no dependencies runs on virtually every platform, and GGUF has become the standard format for quantized model distribution.

2. **MLX excels on Apple Silicon** by leveraging unified memory to eliminate CPU-GPU transfer overhead, with a Python-first API that simplifies development and fine-tuning workflows.

3. **WebLLM brings LLM inference to the browser** via WebGPU, enabling truly client-side applications with no server infrastructure, though model download size and browser compatibility remain limitations.

4. **INT4 quantization is the edge sweet spot**: 8x size reduction with 1-3% quality loss makes it practical to run 7-8B parameter models on consumer hardware at interactive speeds.

5. **Hybrid edge-cloud architectures** offer the best of both worlds -- use edge models for latency-sensitive preprocessing, privacy-preserving PII filtering, and offline capability, while escalating complex generation to cloud models.

6. **Mobile deployment** is maturing rapidly through Core ML (iOS), MediaPipe/LiteRT (Android), and ExecuTorch (cross-platform), with dedicated neural accelerators (Apple Neural Engine, Qualcomm Hexagon) providing energy-efficient inference.

7. **Platform providers are integrating on-device AI at the OS level.** Apple Intelligence, Gemini Nano, and Samsung Galaxy AI treat models as system capabilities, managing lifecycle and routing complexity transparently.

8. **NPU/neural accelerators deliver 5-10x better perf-per-watt** than GPU for supported operations, but operator coverage is incomplete and programming models are fragmented across vendors. Cross-platform runtimes (ONNX Runtime, ExecuTorch) are the practical answer.

9. **Model selection for edge** is a solved problem at every scale: Qwen 2.5 0.5B for browsers, Llama 3.2 1B/3B or Gemma 3 4B for mobile, Llama 3.1 8B or Qwen 2.5 7B for laptops. INT4 quantization is the default.

10. **The edge deployment decision** hinges on four factors: latency requirements, privacy constraints, cost at scale, and offline needs. If none of these are compelling, cloud inference remains simpler to operate and offers access to larger, more capable models.

## Key Takeaways

- **Start with llama.cpp and GGUF**: they run on virtually every platform, have first-class community support, and GGUF quantized weights are available for almost every popular model on Hugging Face.
- **Profile before committing to an NPU backend**: theoretical TOPS figures rarely translate directly to real-world LLM throughput due to incomplete operator support; measure actual decode speed on your target device.
- **Use a hybrid architecture by default**: pure edge limits capability; pure cloud limits latency and offline use. Route simple/latency-sensitive tasks to the edge model and complex generation to the cloud.
- **INT4 quantization is the starting point, not a compromise**: Q4_K_M quality on Llama 3.1 8B is within 1-3% of FP16 on most benchmarks, and the 4.9 GB size fits comfortably in laptop unified memory.
- **Filter PII on-device before any cloud call**: the edge preprocessing + cloud generation pattern is the most practical way to comply with data privacy requirements without sacrificing generation quality.
- **Plan for model lifecycle management**: on-device models need versioning, update delivery, and rollback capability -- especially on mobile where users may run outdated OS versions.
