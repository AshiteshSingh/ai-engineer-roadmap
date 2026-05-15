# Vision-Language Models: Architecture, Training & Applications

Vision-language models (VLMs) represent one of the most consequential advances in AI engineering, enabling systems that jointly reason over images and text. From CLIP's contrastive pretraining to GPT-4V's multimodal reasoning capabilities, these models have transformed how we build applications that understand visual content. This article explores the architectural patterns, training methodologies, and practical applications that define the current VLM landscape.

## The Foundation: Contrastive Vision-Language Pretraining

### CLIP and the Contrastive Paradigm

OpenAI's CLIP (Contrastive Language-Image Pretraining), introduced by Radford et al. (2021), fundamentally changed how we think about connecting vision and language. Rather than training a classifier on a fixed set of labels, CLIP learns a shared embedding space where images and their corresponding text descriptions are pulled together while non-matching pairs are pushed apart.

The architecture is deceptively simple: a vision encoder (either a ResNet or Vision Transformer) processes images into embeddings, while a text encoder (a Transformer) processes text into embeddings. Both are projected into a shared space where cosine similarity measures alignment. Training uses a symmetric cross-entropy loss over the similarity matrix of a batch of image-text pairs.

```python
# Simplified CLIP forward pass
import torch
import torch.nn.functional as F

class CLIP(torch.nn.Module):
    def __init__(self, vision_encoder, text_encoder, embed_dim):
        super().__init__()
        self.vision_encoder = vision_encoder
        self.text_encoder = text_encoder
        self.vision_projection = torch.nn.Linear(vision_encoder.output_dim, embed_dim)
        self.text_projection = torch.nn.Linear(text_encoder.output_dim, embed_dim)
        self.temperature = torch.nn.Parameter(torch.ones([]) * 0.07)

    def forward(self, images, texts):
        # Encode both modalities
        image_features = self.vision_projection(self.vision_encoder(images))
        text_features = self.text_projection(self.text_encoder(texts))

        # Normalize embeddings
        image_features = F.normalize(image_features, dim=-1)
        text_features = F.normalize(text_features, dim=-1)

        # Compute similarity matrix
        logits = (image_features @ text_features.T) / self.temperature

        # Symmetric cross-entropy loss
        labels = torch.arange(len(logits), device=logits.device)
        loss_i2t = F.cross_entropy(logits, labels)
        loss_t2i = F.cross_entropy(logits.T, labels)
        return (loss_i2t + loss_t2i) / 2
```

The key insight was scale: CLIP was trained on 400 million image-text pairs scraped from the internet (WebImageText dataset). This scale, combined with natural language supervision rather than fixed labels, produced representations that generalize remarkably well to zero-shot classification, retrieval, and downstream tasks.

### SigLIP and Scaling Improvements

Google's SigLIP (Zhai et al., 2023) improved upon CLIP by replacing the softmax-based contrastive loss with a sigmoid loss that operates on individual image-text pairs rather than requiring a full batch similarity matrix. This seemingly minor change has significant practical implications: it removes the need for large batch sizes and cross-device synchronization, making training more efficient and scalable.

The sigmoid loss treats each image-text pair independently:

```python
# SigLIP loss - operates on pairs, not the full matrix
def siglip_loss(image_features, text_features, temperature, bias):
    logits = (image_features @ text_features.T) / temperature + bias
    # Create labels: 1 for matching pairs, -1 for non-matching
    labels = 2 * torch.eye(len(logits), device=logits.device) - 1
    loss = -torch.nn.functional.logsigmoid(labels * logits).mean()
    return loss
```

OpenCLIP, the open-source reproduction of CLIP, has been instrumental in democratizing VLM research. Models trained with OpenCLIP on LAION-5B achieve performance competitive with or exceeding the original CLIP, and serve as the vision encoder backbone for many downstream VLMs.

## Vision Encoder Design

### Vision Transformers (ViT)

The Vision Transformer (Dosovitskiy et al., 2020) divides an image into fixed-size patches (typically 14x14 or 16x16 pixels), linearly embeds each patch, adds positional embeddings, and processes the sequence through standard Transformer layers. The `[CLS]` token's output or the mean-pooled patch embeddings serve as the image representation.

Resolution handling is a critical design decision. ViT models are typically trained at a fixed resolution (e.g., 224x224 or 336x336), but many VLMs need to handle higher-resolution inputs for tasks like document understanding. Approaches include:

- **Interpolating positional embeddings**: Simple but introduces artifacts
- **AnyRes / dynamic resolution**: Splitting high-resolution images into tiles, encoding each independently, and combining representations (used by LLaVA-NeXT and GPT-4V)
- **NaViT (Native Resolution ViT)**: Packing variable-resolution images into sequences without resizing (Dehghani et al., 2024)

### The Vision Encoder's Role in VLMs

In modern VLMs, the vision encoder serves as a perception module that converts raw pixels into a sequence of visual tokens that a language model can process. The quality of these visual tokens directly impacts downstream performance. Key considerations include:

- **Feature extraction layer**: Using features from the last layer vs. intermediate layers. Some architectures (like LLaVA-1.5) use the penultimate layer's features, which retain more spatial information
- **Token count**: A 336x336 image with 14x14 patches produces 576 visual tokens. Higher resolutions increase this quadratically, creating context length pressure
- **Token compression**: Methods like Perceiver Resampler (used in Flamingo) or Q-Former (used in BLIP-2) compress variable-length visual features into a fixed number of tokens

## Generative VLM Architectures

### The LLaVA Family

LLaVA (Large Language and Vision Assistant), introduced by Liu et al. (2023), established the most influential architecture pattern for open-source VLMs. The design is elegant in its simplicity:

1. A frozen CLIP vision encoder extracts image features
2. A projection layer (MLP) maps vision features into the language model's embedding space
3. A large language model processes the interleaved visual and text tokens

```
Image -> CLIP ViT-L/14 -> MLP Projection -> [Visual Tokens] + [Text Tokens] -> LLM -> Response
```

LLaVA's training follows a two-stage process:

**Stage 1 - Feature Alignment**: Only the projection layer is trained on 558K image-caption pairs. This teaches the model to translate visual features into the language model's representation space.

**Stage 2 - Visual Instruction Tuning**: The projection layer and LLM are jointly fine-tuned on 150K multimodal instruction-following examples generated with GPT-4. This is where the model learns to follow complex visual instructions.

LLaVA-1.5 improved upon the original with a two-layer MLP projector (instead of linear), higher input resolution (336px), and training on academic VQA datasets. LLaVA-NeXT further pushed performance with dynamic resolution handling and more diverse training data.

### BLIP-2 and Q-Former

BLIP-2 (Li et al., 2023) introduced the Querying Transformer (Q-Former), a lightweight module that bridges frozen image encoders and frozen language models. The Q-Former uses a set of learnable query tokens that attend to the image features through cross-attention, producing a fixed number of output tokens regardless of input resolution.

The Q-Former is trained in two stages:
1. **Vision-language representation learning**: Contrastive, matching, and generation objectives align query outputs with text
2. **Vision-to-language generative learning**: Query outputs are fed to a frozen LLM for caption generation

This approach is remarkably parameter-efficient since both the vision encoder and LLM remain frozen during training.

### GPT-4V and Proprietary Architectures

While OpenAI has not published the full architecture details of GPT-4V, observable behaviors and the GPT-4 Technical Report (2023) provide insights:

- **Multi-resolution handling**: GPT-4V processes images at multiple resolutions, using a tile-based approach for high-resolution inputs (up to 2048x2048)
- **Interleaved multimodal inputs**: Multiple images can be processed in a single conversation turn
- **Spatial reasoning**: The model demonstrates understanding of spatial relationships, text in images, and complex visual scenes
- **Token budget**: High-resolution images consume significant context window tokens (estimated 765 tokens for a 512x512 image in "high detail" mode)

Google's Gemini models use a similar approach but with a natively multimodal architecture trained from scratch on interleaved image, video, audio, and text data, rather than retrofitting vision capabilities onto a text-only model.

## Visual Instruction Tuning

### Data Generation and Curation

The quality of visual instruction tuning data is arguably more important than architectural choices. The original LLaVA used GPT-4 to generate instruction-following data from COCO image captions, producing three types of data:

1. **Conversations**: Multi-turn dialogues about image content
2. **Detailed descriptions**: Rich, paragraph-length image descriptions
3. **Complex reasoning**: Questions requiring multi-step visual reasoning

Subsequent work has expanded and refined this approach:

- **ShareGPT4V** (Chen et al., 2023): Used GPT-4V itself to generate higher-quality captions
- **ALLaVA** (Chen et al., 2024): Systematic framework for generating diverse visual instruction data
- **Cambrian-1** (Tong et al., 2024): Comprehensive study of data composition effects, finding that balanced mixtures across task types outperform scaling any single category

### Training Recipes

Modern VLM training typically follows a multi-stage recipe:

```
Stage 1: Pretraining (alignment)
  - Data: Large-scale image-caption pairs (e.g., LAION, CC3M)
  - Trainable: Projection layer only
  - Duration: ~1 epoch

Stage 2: Supervised fine-tuning
  - Data: Mixed instruction-following data
  - Trainable: Projection layer + LLM (often with LoRA)
  - Duration: ~1 epoch

Stage 3 (optional): RLHF/DPO for preference alignment
  - Data: Preference pairs for visual responses
  - Trainable: LLM weights
  - Duration: Varies
```

Freezing vs. unfreezing the vision encoder is a key decision. Most approaches keep it frozen, but InternVL and PaLI-X show that unfreezing (especially the later layers) during fine-tuning can improve performance on tasks requiring fine-grained visual understanding.

## Multimodal Embedding Spaces

### Beyond CLIP: Unified Embedding Models

While CLIP demonstrated the power of aligned vision-language embeddings, modern applications often require embedding spaces that support more than two modalities and more nuanced similarity relationships.

**ImageBind** (Girdhar et al., 2023) from Meta extends the idea to six modalities (images, text, audio, depth, thermal, IMU data) using image-paired data for each modality. The key insight is that images serve as a natural binding point: by aligning each modality to images, all modalities become aligned to each other without needing paired data between every pair.

**Nomic Embed Vision** provides an open-source multimodal embedding model trained with contrastive learning on image-text pairs, achieving strong performance on both visual and textual retrieval benchmarks.

### Applications of Multimodal Embeddings

```python
# Multimodal search with embeddings
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('nomic-ai/nomic-embed-vision-v1.5')

# Encode different modalities into same space
image_embedding = model.encode(image)
text_embedding = model.encode("a photograph of a sunset over mountains")

# Cross-modal similarity
similarity = cosine_similarity(image_embedding, text_embedding)

# Use cases:
# - Image search with text queries
# - Finding similar images across large collections
# - Multimodal RAG: retrieve images relevant to text queries
# - Content moderation: compare against reference embeddings
```

## Document AI and OCR Integration

### The Document Understanding Pipeline

VLMs have dramatically improved document understanding tasks. Traditional OCR pipelines extract text first, then reason over it. Modern VLMs can reason directly over document images, understanding layout, tables, figures, and text simultaneously.

Key models in this space include:

- **Donut** (Kim et al., 2022): OCR-free document understanding using a Swin Transformer encoder and BART decoder
- **Pix2Struct** (Lee et al., 2023): Pretrained on web page screenshots with HTML as the target, excels at understanding structured visual content
- **DocOwl** / **DocPedia**: VLMs specifically fine-tuned for document understanding tasks

### Practical Document AI Architecture

A production document AI system typically combines multiple components:

```python
class DocumentProcessor:
    def __init__(self):
        self.layout_detector = LayoutDetector()  # Detect regions
        self.ocr_engine = OCREngine()             # Extract text
        self.vlm = VisionLanguageModel()          # Understand content
        self.table_extractor = TableExtractor()   # Structured tables

    def process(self, document_image):
        # Step 1: Layout analysis
        regions = self.layout_detector.detect(document_image)

        # Step 2: Region-specific processing
        results = []
        for region in regions:
            if region.type == "table":
                structured = self.table_extractor.extract(region.crop)
                results.append(structured)
            elif region.type == "figure":
                caption = self.vlm.describe(region.crop)
                results.append(caption)
            else:
                text = self.ocr_engine.extract(region.crop)
                results.append(text)

        # Step 3: Holistic understanding with VLM
        summary = self.vlm.analyze(
            document_image,
            prompt="Analyze this document, incorporating the extracted content",
            context=results
        )
        return summary
```

For high-accuracy OCR, combining traditional engines (Tesseract, Google Cloud Vision) with VLM-based understanding produces the best results. The VLM handles layout understanding and semantic interpretation, while dedicated OCR handles precise character recognition.

## Image Understanding Capabilities

### Visual Question Answering (VQA)

Modern VLMs excel at a range of VQA tasks:

- **Factual VQA**: "What color is the car?" - Direct visual attribute extraction
- **Counting**: "How many people are in this image?" - Object detection and enumeration
- **Spatial reasoning**: "What is to the left of the table?" - Understanding relative positions
- **OCR-VQA**: "What does the sign say?" - Reading text in images
- **Chart/Graph understanding**: "What was the revenue in Q3?" - Interpreting data visualizations
- **Knowledge-based VQA**: "What species of bird is this?" - Combining visual features with world knowledge

### Evaluation Benchmarks

The VLM evaluation landscape is rich and rapidly evolving:

| Benchmark | Focus | Example Task |
|-----------|-------|-------------|
| MMBench | Comprehensive multimodal | Multiple-choice visual reasoning |
| MMMU | Expert-level understanding | University exam questions with images |
| MathVista | Mathematical reasoning | Geometry, charts, function plots |
| RealWorldQA | Practical understanding | Real-world spatial reasoning |
| DocVQA | Document understanding | Questions about document content |
| ChartQA | Chart interpretation | Data extraction from charts |
| TextVQA | Text in images | Reading scene text |
| POPE | Hallucination evaluation | Object existence verification |

The POPE (Polling-based Object Probing Evaluation) benchmark deserves special attention as it measures hallucination - a critical failure mode where VLMs claim to see objects that are not present. Techniques to reduce hallucination include:

- Training with negative examples (objects not in the image)
- Contrastive decoding methods (Li et al., 2023)
- RLHF with hallucination-focused preference data
- Grounding mechanisms that tie text generation to specific image regions

## Practical Deployment Considerations

### Inference Optimization

VLM inference presents unique challenges due to the dual-encoder architecture:

```python
# Optimization strategies for VLM deployment

# 1. Cache vision encoder outputs for repeated queries on same image
from functools import lru_cache

@lru_cache(maxsize=1000)
def encode_image(image_hash):
    return vision_encoder(load_image(image_hash))

# 2. Quantization - vision encoder and LLM can be quantized independently
from transformers import BitsAndBytesConfig

quantization_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_use_double_quant=True,
)

# 3. Visual token compression for long-context efficiency
# Reduce 576 visual tokens to 64 with a learned compressor
class VisualTokenCompressor(torch.nn.Module):
    def __init__(self, num_queries=64):
        super().__init__()
        self.queries = torch.nn.Parameter(torch.randn(num_queries, hidden_dim))
        self.cross_attn = CrossAttention(hidden_dim)

    def forward(self, visual_tokens):
        return self.cross_attn(self.queries, visual_tokens)
```

### Cost and Latency Management

For production VLM applications:

- **Image preprocessing**: Resize images to the model's expected resolution before sending to reduce unnecessary computation
- **Resolution selection**: Use lower resolution for classification tasks, higher for document understanding
- **Batching**: Group image-understanding requests for efficient GPU utilization
- **Caching**: Store embeddings and common query results
- **Model selection**: Use smaller VLMs (e.g., LLaVA-7B, MiniCPM-V) for simpler tasks, reserving larger models for complex reasoning

## Open-Source VLM Landscape (2025)

The open-source VLM ecosystem has matured rapidly, with several model families now rivaling proprietary systems on standard benchmarks. Understanding the relative strengths of each family is essential for practitioners selecting models for production workloads.

### InternVL

InternVL (Chen et al., 2024) from Shanghai AI Lab represents one of the most capable open-source VLM families. InternVL 2.5 scales from 1B to 78B parameters, with the flagship model matching or exceeding GPT-4V on benchmarks like MMMU and MathVista. Key architectural decisions include:

- **Dynamic high-resolution**: InternVL uses a dynamic tiling strategy that adapts the number of image tiles based on aspect ratio and resolution, supporting inputs up to 4K without fixed resolution constraints
- **Unfrozen vision encoder**: Unlike LLaVA, InternVL fine-tunes its InternViT vision encoder during training, which significantly improves fine-grained visual understanding (document text, small objects, chart details)
- **Strong multilingual support**: Trained on multilingual visual instruction data, making it well-suited for non-English document AI and OCR tasks

### Qwen-VL

Alibaba's Qwen-VL series integrates vision capabilities directly into the Qwen language model family. Qwen2-VL introduced several notable innovations:

- **Naive Dynamic Resolution**: Rather than cropping images into fixed tiles, Qwen2-VL dynamically maps images to variable-length token sequences, reducing visual token waste for non-square images
- **Multimodal RoPE (M-RoPE)**: Extends rotary position embeddings to jointly encode temporal, height, and width positional information, unifying the handling of images and video within a single positional encoding scheme
- **Strong video understanding**: Qwen2-VL handles video natively by processing frame sequences with temporal position encoding, achieving competitive results on video QA benchmarks without separate video-specific modules

### CogVLM

CogVLM (Wang et al., 2024) from Tsinghua and Zhipu AI takes a different architectural approach by adding a dedicated visual expert module to each Transformer layer. Rather than projecting visual tokens into the LLM's input space and hoping the language model adapts, CogVLM uses separate QKV matrices for visual and text tokens within the same attention computation. This preserves the language model's original text capabilities while adding deep visual reasoning without interference. CogVLM2 extended this with higher resolution support and improved grounding capabilities.

### MiniCPM-V

MiniCPM-V from OpenBMB targets efficient deployment without sacrificing capability. MiniCPM-V 2.6, at roughly 8B parameters, achieves performance competitive with much larger models through:

- **Adaptive visual encoding**: A cross-attention-based token compression scheme that adjusts the number of visual tokens based on image complexity
- **End-side deployment**: Optimized for on-device inference on mobile hardware, achieving real-time image understanding on smartphones — a practical consideration for applications requiring privacy or offline capability (see Article 41 on edge deployment)
- **Efficient training**: Strong performance from relatively modest training compute, demonstrating that data curation and architecture choices can compensate for scale

### Choosing Between Open-Source VLMs

| Model Family | Best For | Parameters | Key Strength |
|-------------|----------|-----------|--------------|
| InternVL 2.5 | General-purpose, documents | 1B-78B | Benchmark-leading accuracy |
| Qwen2-VL | Video + multilingual | 2B-72B | Native video, M-RoPE |
| CogVLM2 | Visual grounding | 19B | Visual expert architecture |
| MiniCPM-V | Edge / mobile deployment | 3B-8B | Efficiency per parameter |
| LLaVA-NeXT | Research, fine-tuning | 7B-34B | Simple architecture, extensible |

## Multimodal RAG

Standard RAG systems retrieve text chunks and feed them to an LLM for synthesis. Multimodal RAG extends this to handle images, diagrams, charts, and other visual content alongside text — a critical capability for knowledge bases where information is encoded visually (technical manuals, research papers with figures, slide decks).

### Architecture Patterns

There are three primary approaches to multimodal RAG, each with distinct tradeoffs:

**Approach 1 — Caption and embed**: Use a VLM to generate text captions for all images at indexing time, then embed the captions alongside document text in a standard vector store. At query time, retrieval operates entirely in text space. This is the simplest approach and works well when images primarily supplement text, but loses visual details that captions fail to capture.

**Approach 2 — Multimodal embeddings**: Use a model like CLIP, SigLIP, or Nomic Embed Vision to embed images directly into the same vector space as text (see Article 13 on embedding models). Queries can retrieve both text chunks and images based on semantic similarity. This preserves visual information but requires careful calibration of cross-modal similarity scores.

**Approach 3 — Late fusion with VLM reasoning**: Retrieve candidate images and text chunks separately, then pass both to a VLM for joint reasoning. This is the most capable approach but also the most expensive, as it requires VLM inference at query time:

```python
class MultimodalRAG:
    def __init__(self, text_index, image_index, vlm):
        self.text_index = text_index      # Standard text vector store
        self.image_index = image_index    # CLIP-based image index
        self.vlm = vlm

    def query(self, question, top_k_text=5, top_k_images=3):
        # Retrieve relevant text chunks
        text_results = self.text_index.search(question, top_k=top_k_text)

        # Retrieve relevant images via CLIP similarity
        image_results = self.image_index.search(question, top_k=top_k_images)

        # Compose multimodal prompt for VLM
        prompt = f"Based on the following context, answer: {question}\n\n"
        prompt += "Text context:\n"
        for chunk in text_results:
            prompt += f"- {chunk.text}\n"

        # Pass images as interleaved visual tokens
        response = self.vlm.generate(
            prompt=prompt,
            images=[img.data for img in image_results],
            image_descriptions=[img.metadata for img in image_results],
        )
        return response
```

For production multimodal RAG pipelines, combining Approach 1 (captioning at index time) with Approach 3 (VLM reasoning at query time) provides the best balance: captioned images are retrievable via text search, while the VLM can also reason directly over the retrieved image pixels for visual details the caption missed. For a deeper treatment of retrieval strategies and reranking, see Article 17 on advanced RAG.

## Visual Grounding

Visual grounding connects VLM text outputs to specific regions within an image — bounding boxes, segmentation masks, or point coordinates. This capability is essential for applications where knowing *where* in the image the model's answer refers to is as important as the answer itself: object detection, robotic manipulation, visual inspection, and interactive image editing.

### Region-Level Output Formats

Modern grounding-capable VLMs output spatial references in several formats:

- **Normalized bounding boxes**: Coordinates as `[x_min, y_min, x_max, y_max]` normalized to [0, 1000] or [0, 1]. Models like Qwen2-VL and CogVLM2 natively produce bounding box coordinates interleaved with text tokens
- **Point coordinates**: Single (x, y) points indicating object centers, used in referring expression comprehension
- **Segmentation tokens**: Some models (like LISA and GLaMM) generate special tokens that decode into pixel-level segmentation masks via a separate mask decoder

### Grounding Architectures

**Kosmos-2** (Microsoft) was an early model to integrate grounding directly into the language model's vocabulary by adding special location tokens (`<loc_XXX>`) that represent discretized spatial coordinates. The model can both describe regions given bounding boxes (grounded captioning) and produce bounding boxes given referring expressions (referring expression comprehension).

**Grounding DINO + VLM**: A modular approach that combines an open-vocabulary object detector (Grounding DINO) with a VLM. The detector localizes objects based on text prompts, then the VLM reasons about the detected regions:

```python
# Modular grounding pipeline
from groundingdino.util.inference import load_model, predict

# Step 1: Detect objects with Grounding DINO
boxes, logits, phrases = predict(
    model=grounding_model,
    image=image,
    caption="the red car near the building",
    box_threshold=0.3,
    text_threshold=0.25,
)

# Step 2: Crop detected regions and pass to VLM for detailed analysis
for box in boxes:
    region = crop_image(image, box)
    description = vlm.describe(region, prompt="Describe this vehicle in detail")
```

**GLaMM** (Rasheed et al., 2024) and **LISA** (Lai et al., 2024) extend VLM architectures with segmentation decoders, enabling pixel-level grounding. The language model generates a special `<SEG>` token, which triggers a SAM-like mask decoder to produce a segmentation mask for the referenced object. This bridges the gap between language understanding and pixel-precise localization.

Grounding also serves as a hallucination mitigation mechanism (see Article 45): if a model claims an object exists in an image, requiring it to also produce a bounding box provides a verifiable check. Models are far less likely to hallucinate objects when forced to spatially localize them.

## Video Understanding Architectures

The naive approach to video understanding — sampling frames uniformly and processing each as an independent image — discards temporal relationships that are often critical for answering questions about actions, causality, and event sequences. Modern video VLMs introduce explicit temporal modeling to address this limitation.

### Temporal Encoding Strategies

**Token-level temporal embeddings**: Models like Video-LLaVA and LLaVA-NeXT-Video add temporal position embeddings to visual tokens from each frame, allowing the language model's attention to learn temporal relationships implicitly. Each frame produces a set of spatial tokens, and frame index embeddings distinguish tokens from different points in time.

**Temporal attention layers**: VideoChat and Video-ChatGPT insert dedicated temporal attention modules between spatial attention layers in the vision encoder. After standard spatial self-attention within each frame, temporal attention operates across frames at each spatial position, capturing motion and state changes.

**Hierarchical encoding**: PLLaVA and similar architectures process video at multiple temporal scales — dense sampling for short clips, sparse keyframe sampling for longer videos — then merge representations through pooling or cross-attention. This handles the tension between temporal detail and context length:

```
Short video (<30s):  Dense sampling -> 1-2 fps -> All frames encoded
Medium video (1-5m): Adaptive sampling -> keyframes + motion segments
Long video (>5m):    Hierarchical -> scene-level summaries + detail on demand

Token budget management:
  - 8 frames x 256 tokens/frame = 2048 visual tokens (manageable)
  - 64 frames x 256 tokens/frame = 16384 visual tokens (requires compression)
  - Temporal token merging: merge similar adjacent frame tokens -> 4-8x reduction
```

### Long Video Understanding

Handling videos longer than a few minutes requires strategies beyond simple frame sampling:

- **Memory-augmented models**: Maintain a compressed memory of past frames, attending to it when processing new frames (similar to how streaming language models handle long documents)
- **Retrieval-based video QA**: Index frames or clips with embeddings, retrieve the most relevant segments for a given question, then process only those segments with a VLM. This is effectively multimodal RAG applied to video
- **Scene graph accumulation**: Build a structured representation of entities and their relationships across frames, enabling reasoning over long temporal spans without retaining all visual tokens

Models like LWM (Large World Model) and Gemini 1.5 Pro demonstrate that extremely long context windows (up to 1M+ tokens) can accommodate hour-length videos directly, though this approach trades compute cost for architectural simplicity.

## Emerging Directions

### Embodied Vision-Language Models

VLMs are increasingly being integrated into robotics and embodied AI:

- **RT-2** (Brohan et al., 2023): Uses a VLM to directly output robot actions
- **PaLM-E** (Driess et al., 2023): An embodied multimodal model that reasons about the physical world
- These models bridge perception and action through a shared language-grounded representation

### World Models

The frontier of VLM research is moving toward world models that don't just describe what they see but can predict what will happen next. Models like Sora and Genie demonstrate that visual generation models trained at scale develop implicit physical understanding, suggesting a path toward VLMs that truly understand the visual world rather than merely describing it.

## Cross-References

- **Article 13 — Embedding Models**: Multimodal embedding spaces (CLIP, SigLIP, Nomic Embed Vision) build on the same contrastive pretraining foundations covered in the embedding models article. Understanding embedding similarity and fine-tuning is essential for multimodal retrieval.
- **Article 17 — Advanced RAG**: Multimodal RAG extends the retrieval-augmented generation patterns discussed in Article 17, adding image retrieval and VLM-based synthesis to text-centric pipelines.
- **Article 45 — Hallucination Mitigation**: Visual grounding provides a spatial verification mechanism for hallucination detection — models forced to localize claims in bounding boxes hallucinate less. POPE and contrastive decoding connect directly to the hallucination mitigation strategies covered there.
- **Article 41 — Edge Deployment**: Efficient VLMs like MiniCPM-V target on-device deployment scenarios. The quantization, ONNX export, and runtime optimization strategies from Article 41 apply directly to deploying vision-language models on mobile and embedded hardware.

## Summary and Key Takeaways

- **CLIP's contrastive pretraining** established the foundation for connecting vision and language through shared embedding spaces, with SigLIP and OpenCLIP providing practical improvements
- **The LLaVA architecture** (vision encoder + projection + LLM) has become the dominant pattern for open-source VLMs due to its simplicity and effectiveness
- **Visual instruction tuning** data quality matters more than architecture choices; GPT-4-generated instruction data bootstrapped the entire field
- **The open-source VLM landscape** has diversified significantly, with InternVL, Qwen-VL, CogVLM, and MiniCPM-V each offering distinct architectural innovations and deployment profiles
- **Multimodal RAG** extends text-centric retrieval to handle images and diagrams, with approaches ranging from simple captioning to full VLM-based visual reasoning at query time
- **Visual grounding** connects VLM outputs to specific image regions through bounding boxes and segmentation masks, serving both practical applications and hallucination mitigation
- **Video understanding** has moved beyond frame sampling to dedicated temporal modeling, with hierarchical encoding and memory-augmented architectures handling long-form video
- **Document AI** benefits enormously from VLMs that can reason over layout and content simultaneously, reducing the need for complex OCR pipelines
- **Hallucination** remains the primary challenge for production VLM deployment; benchmarks like POPE and techniques like contrastive decoding help address it
- **Deployment optimization** requires independent treatment of vision and language components, with visual token compression being critical for cost management
- For practitioners, the choice between proprietary APIs (GPT-4V, Gemini) and open models (LLaVA, InternVL) depends on latency requirements, data privacy constraints, and the specific visual understanding capabilities needed
