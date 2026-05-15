# AWS AI/ML Services: Interview Preparation Knowledge Base

## The 30-Second Pitch

AWS offers the most comprehensive managed AI/ML portfolio in the cloud, spanning foundation model access (Bedrock), end-to-end ML operations (SageMaker), and a full suite of pre-trained AI APIs (Rekognition, Textract, Comprehend, Translate, Transcribe, Polly, Lex, Kendra, Forecast, Personalize). The core value proposition is that organizations can build AI-enabled solutions without managing infrastructure, at any scale, with deep integration into existing AWS services. At an AI-enabled technology consulting company, the ability to compose these services into client-ready architectures—and articulate the trade-offs between them—is the core skill being evaluated.

---

## 1. Amazon Bedrock

### What It Is

Bedrock is AWS's fully managed foundation model (FM) service. It provides API access to third-party and Amazon-native FMs without requiring model hosting infrastructure. Think of it as a router to the best available FMs, wrapped in [AWS IAM](/aws/iam-security), VPC, and compliance controls.

### Foundation Models Available

| Provider | Model Family | Key Use Cases |
|---|---|---|
| Anthropic | Claude 3.5 Sonnet, Claude 3 Haiku, Claude 3 Opus | Complex reasoning, coding, long-context analysis |
| Amazon | Titan Text (G1 Lite, Express), Titan Embeddings V2, Titan Image Generator | General text, embeddings, image generation |
| Meta | Llama 3.1 8B/70B/405B | Open-weight tasks, fine-tuning candidates |
| Mistral | Mistral 7B, Mixtral 8x7B, Mistral Large | Efficient inference, multilingual |
| Cohere | Command R, Command R+, Embed | RAG, tool use, enterprise search |
| Stability AI | Stable Diffusion | Image generation, inpainting |
| AI21 Labs | Jamba 1.5, Jurassic | Long-context, structured generation |

**Model selection heuristic**: Claude for complex reasoning/coding, Titan Embeddings for [RAG pipelines](/advanced-rag) (native AWS integration), Llama for cost-sensitive inference or when [fine-tuning](/fine-tuning-fundamentals) is needed, Cohere Command R+ for agentic/tool-use workflows.

### Inference Modes

**On-Demand (default)**: Pay per token, no commitment. Ideal for variable or exploratory workloads. No provisioned capacity—requests are served from shared infrastructure. Latency can vary.

**Provisioned Throughput**: Reserve model units (MUs) for a committed period (1 month or 6 months). Guarantees consistent throughput (tokens per minute). Required for custom [fine-tuned models](/fine-tuning-fundamentals) in Bedrock. Cost is fixed regardless of actual usage—only economical at sustained high volume.

**Batch Inference**: Submit a JSONL file to [S3](/aws/storage-s3), Bedrock processes it asynchronously, outputs results to S3. Pricing is roughly 50% of on-demand. No SLA on completion time. Ideal for bulk document processing, offline evaluation, or dataset enrichment.

```python
import boto3, json

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")

# On-demand invocation (Claude)
response = bedrock.invoke_model(
    modelId="anthropic.claude-3-5-sonnet-20241022-v2:0",
    contentType="application/json",
    accept="application/json",
    body=json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "Explain RAG in two sentences."}]
    })
)
result = json.loads(response["body"].read())
print(result["content"][0]["text"])

# Streaming invocation
response = bedrock.invoke_model_with_response_stream(
    modelId="anthropic.claude-3-5-sonnet-20241022-v2:0",
    body=json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "Write a haiku about distributed systems."}]
    })
)
for event in response["body"]:
    chunk = json.loads(event["chunk"]["bytes"])
    if chunk.get("type") == "content_block_delta":
        print(chunk["delta"]["text"], end="", flush=True)
```

### Knowledge Bases (RAG)

Bedrock Knowledge Bases is a fully managed [RAG](/advanced-rag) service. You point it at a data source ([S3](/aws/storage-s3), Confluence, Salesforce, SharePoint, web crawl), it handles [chunking](/chunking-strategies), [embedding](/embeddings), and indexing into a [vector store](/vector-databases), and exposes a `RetrieveAndGenerate` API.

**Supported [vector stores](/vector-databases)**: Amazon OpenSearch Serverless (default), Amazon Aurora PostgreSQL (pgvector), Amazon RDS PostgreSQL (pgvector), Pinecone, Redis Enterprise Cloud, MongoDB Atlas.

**Key parameters**:
- **[Chunking strategy](/chunking-strategies)**: Fixed-size (tokens), semantic (sentence-boundary aware), hierarchical (parent-child), no chunking (full documents)
- **Overlap**: Prevents context loss at chunk boundaries
- **[Embedding model](/embeddings)**: Titan Embeddings V2 (1,536-dim) or Cohere Embed
- **Number of results (K)**: Top-K chunks retrieved before generation

```python
bedrock_agent = boto3.client("bedrock-agent-runtime", region_name="us-east-1")

# Retrieve and Generate (single API call for full RAG)
response = bedrock_agent.retrieve_and_generate(
    input={"text": "What are our refund policies for SaaS subscriptions?"},
    retrieveAndGenerateConfiguration={
        "type": "KNOWLEDGE_BASE",
        "knowledgeBaseConfiguration": {
            "knowledgeBaseId": "XYZABC123",
            "modelArn": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0",
            "retrievalConfiguration": {
                "vectorSearchConfiguration": {"numberOfResults": 5}
            }
        }
    }
)
print(response["output"]["text"])
# Citations are in response["citations"]

# Retrieve-only (for custom generation logic)
retrieve_response = bedrock_agent.retrieve(
    knowledgeBaseId="XYZABC123",
    retrievalQuery={"text": "refund policy SaaS"},
    retrievalConfiguration={
        "vectorSearchConfiguration": {
            "numberOfResults": 10,
            "filter": {"equals": {"key": "documentType", "value": "policy"}}
        }
    }
)
```

**Metadata filtering**: Attach metadata to source documents (e.g., `department`, `document_type`, `version`). Filter at retrieval time to scope results without increasing K. See [retrieval strategies](/retrieval-strategies) for broader retrieval design patterns.

### Bedrock Agents

Agents extend Bedrock FMs with tool use ([function calling](/function-calling)) and multi-step reasoning. You define **Action Groups** (OpenAPI schemas describing callable APIs or [Lambda](/aws/lambda-serverless) functions) and optionally attach a Knowledge Base. The agent autonomously decides which tools to call, in what order, to complete a user task. For a deeper look at agent design patterns, see [agent architectures](/agent-architectures).

**Components**:
- **Agent**: The FM + instruction prompt + action groups + KB
- **Action Group**: A [Lambda](/aws/lambda-serverless) function or inline code block exposed via an OpenAPI schema
- **Session**: Maintains conversation memory across multi-turn interactions
- **Alias**: A versioned deployment target (like a Lambda alias)
- **Prompt overrides**: Customize the orchestration, pre-processing, post-processing, or KB response prompts

```python
# Invoking an agent
response = bedrock_agent.invoke_agent(
    agentId="AGENT123",
    agentAliasId="TSTALIASID",
    sessionId="user-session-abc",
    inputText="Book a flight from NYC to London next Tuesday, under $800"
)
# Response is a streaming EventStream
for event in response["completion"]:
    if "chunk" in event:
        print(event["chunk"]["bytes"].decode(), end="")
```

**Return of control (ROC)**: The agent can pause and return tool call parameters to your application instead of executing them directly—useful when you need to perform actions in your own backend before resuming. See [LangGraph](/langgraph) for an alternative open-source approach to stateful agent orchestration.

### Guardrails

Guardrails are content filters that can be attached to any Bedrock model call (including Agents and Knowledge Bases). They operate independently of the underlying FM.

**Filter categories**:
- **Hate speech, violence, sexual, insults**: Block or flag at configurable strength (LOW/MEDIUM/HIGH)
- **Prompt attack (jailbreak)**: Detect attempts to override system instructions
- **PII redaction**: Detect and redact or block 30+ PII types (SSN, credit card, email, etc.)
- **Grounding check**: Verify the FM's response is grounded in retrieved context (reduces hallucination)
- **Relevance check**: Verify the response is relevant to the user's query
- **Denied topics**: Define topics the model should refuse (e.g., "do not discuss competitor products")
- **Word filters**: Block specific words or phrases

```python
response = bedrock.invoke_model(
    modelId="anthropic.claude-3-5-sonnet-20241022-v2:0",
    guardrailIdentifier="guardrail-id-123",
    guardrailVersion="DRAFT",  # or "1", "2", etc.
    body=json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 512,
        "messages": [{"role": "user", "content": "..."}]
    })
)
# Check if guardrail intervened
usage = response.get("amazon-bedrock-guardrailAction")  # "INTERVENED" or "NONE"
```

### Model Evaluation

Bedrock Model Evaluation lets you systematically compare models on your own dataset or built-in datasets (TREX, BoolQ, TriviaQA, etc.).

**Evaluation types**:
- **Automatic**: Algorithmic metrics—Accuracy, Robustness, Toxicity. Fast and cheap but limited nuance.
- **Human**: Route responses to an internal team or AWS Mechanical Turk for qualitative assessment.

**Use case**: Before migrating from Claude 3 Sonnet to Haiku for cost reduction, run evaluation on 500 representative queries to measure quality degradation.

---

## 2. Amazon SageMaker

### What It Is

SageMaker is AWS's end-to-end ML platform. It covers every stage: data preparation, feature engineering, model training, evaluation, deployment, and monitoring. It's designed for teams that need full control over the ML lifecycle, unlike Bedrock which abstracts away the model.

### SageMaker Studio

Studio is a web-based IDE for ML workflows. It integrates JupyterLab notebooks, experiment tracking, data labeling (Ground Truth), feature engineering (Data Wrangler), and pipeline visualization. **Studio Classic** is the older interface; **Studio** (2023+) is the newer unified experience.

**Key Studio tools**:
- **Data Wrangler**: No-code/low-code data transformation for tabular data. Exports to Feature Store or training scripts.
- **Ground Truth**: Human labeling for images, text, video. Manages workforce (private, vendor, or Mechanical Turk).
- **Clarify**: Bias detection and explainability (SHAP values) for trained models.
- **Experiments**: Track training runs, hyperparameters, and metrics. Compare runs visually.
- **Debugger**: Profile training jobs for bottlenecks (GPU utilization, vanishing gradients, etc.)

### Training Jobs

A Training Job is a managed, containerized execution of your training script. You specify the algorithm (built-in or custom container), instance type, [S3](/aws/storage-s3) input/output paths, and hyperparameters. Training containers run on [EC2-backed instances](/aws/compute-containers) (p3, p4d, p5 families for GPU workloads).

**Built-in algorithms**: XGBoost, Linear Learner, K-Means, PCA, BlazingText (word2vec/text classification), Object Detection, Semantic Segmentation, Seq2Seq, Factorization Machines, KNN, LDA, Random Cut Forest (anomaly detection).

**Training modes**:
- **Single instance**: Standard training on one EC2 instance.
- **Distributed training**: Data parallelism (SageMaker Distributed Data Parallel, Horovod) or model parallelism (SageMaker Model Parallel for very large models). Uses `p3`, `p4d`, `p5` instance families (V100/A100/H100).
- **Spot training**: Use EC2 Spot instances for up to 90% cost reduction. SageMaker handles checkpointing and resumption automatically on interruption.
- **Managed Warm Pools**: Keep instances warm between jobs to avoid startup time (useful in iterative experimentation).

```python
import sagemaker
from sagemaker.estimator import Estimator

estimator = Estimator(
    image_uri="763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-training:2.0-gpu-py310",
    role="arn:aws:iam::123456789:role/SageMakerRole",
    instance_count=2,
    instance_type="ml.p3.8xlarge",
    use_spot_instances=True,
    max_run=7200,
    max_wait=10800,  # Required when use_spot_instances=True
    checkpoint_s3_uri="s3://my-bucket/checkpoints/",
    hyperparameters={"epochs": 10, "batch-size": 32, "lr": 0.001},
    output_path="s3://my-bucket/model-output/"
)
estimator.fit({"train": "s3://my-bucket/data/train/", "val": "s3://my-bucket/data/val/"})
```

### Endpoints (Inference)

**Real-time endpoints**: Low-latency synchronous inference. Backed by auto-scaling EC2 instances. Supports traffic splitting for A/B testing (production variants). Good for interactive applications requiring <1s response.

**Serverless endpoints**: No infrastructure to manage. Auto-scales to zero (no cost when idle). Cold start latency of ~1-3 seconds. Ideal for sporadic, unpredictable traffic or dev/staging environments. Memory: 1–6 GB; concurrency: 1–200.

**Asynchronous endpoints**: For requests >60 seconds or large payloads (up to 1 GB). Requests are queued in S3, processed asynchronously, and results written to S3. Client polls or gets SNS notification. Ideal for batch-style but still model-server architecture.

**Batch Transform**: Offline inference at scale. Reads input from S3, runs inference in parallel, writes to S3. No persistent endpoint; only billed during the job. Best for re-scoring entire datasets or pre-computing predictions.

```python
# Deploy real-time endpoint with auto-scaling
predictor = estimator.deploy(
    initial_instance_count=1,
    instance_type="ml.g4dn.xlarge",
    endpoint_name="my-model-endpoint"
)

# Add auto-scaling
import boto3
aas = boto3.client("application-autoscaling")
aas.register_scalable_target(
    ServiceNamespace="sagemaker",
    ResourceId="endpoint/my-model-endpoint/variant/AllTraffic",
    ScalableDimension="sagemaker:variant:DesiredInstanceCount",
    MinCapacity=1, MaxCapacity=10
)
aas.put_scaling_policy(
    PolicyName="cpu-scaling",
    ServiceNamespace="sagemaker",
    ResourceId="endpoint/my-model-endpoint/variant/AllTraffic",
    ScalableDimension="sagemaker:variant:DesiredInstanceCount",
    PolicyType="TargetTrackingScaling",
    TargetTrackingScalingPolicyConfiguration={
        "TargetValue": 70.0,
        "PredefinedMetricSpecification": {
            "PredefinedMetricType": "SageMakerVariantInvocationsPerInstance"
        }
    }
)
```

### SageMaker Pipelines

Pipelines is a CI/CD workflow orchestration service for ML. For broader AWS CI/CD tooling (CodePipeline, CDK), see [CI/CD & DevOps](/aws/cicd-devops). Define steps as a DAG: Processing (data prep), Training, Evaluation, Condition (if/else branching), Model creation, Register, Transform. Integrated with Model Registry and Experiments.

```python
from sagemaker.workflow.pipeline import Pipeline
from sagemaker.workflow.steps import ProcessingStep, TrainingStep, ConditionStep
from sagemaker.workflow.conditions import ConditionGreaterThanOrEqualTo

# Define steps (simplified)
process_step = ProcessingStep(name="DataPrep", processor=sklearn_processor, ...)
train_step = TrainingStep(name="Train", estimator=estimator,
                          depends_on=[process_step], ...)
eval_step = ProcessingStep(name="Evaluate", processor=eval_processor,
                           depends_on=[train_step], ...)

# Conditional registration: only register if accuracy >= 0.85
cond = ConditionGreaterThanOrEqualTo(
    left=JsonGet(step_name="Evaluate", property_file=eval_output, json_path="accuracy"),
    right=0.85
)
condition_step = ConditionStep(
    name="CheckAccuracy",
    conditions=[cond],
    if_steps=[register_step],
    else_steps=[fail_step]
)

pipeline = Pipeline(name="churn-prediction-pipeline",
                    steps=[process_step, train_step, eval_step, condition_step])
pipeline.upsert(role_arn="arn:aws:iam::123:role/SageMakerRole")
pipeline.start()
```

### Feature Store

A managed repository for ML features with both online (low-latency, [DynamoDB](/aws/dynamodb-data-services)-backed) and offline ([S3](/aws/storage-s3)/Glue-catalogued) stores. Guarantees point-in-time correctness to prevent training/serving skew.

**Key concepts**:
- **Feature Group**: A collection of features (like a table). Has a record identifier and an event time.
- **Online store**: Serves the latest feature value per record ID. Used during inference.
- **Offline store**: Append-only S3 store of all feature updates. Used for training dataset creation.

```python
feature_group = FeatureGroup(name="customer-features", sagemaker_session=sess)
feature_group.ingest(data_frame=df, max_workers=4, wait=True)

# Point-in-time join for training (offline)
dataset_builder = feature_group.as_hive_ddl()
# Use Athena or Glue to query with event_time filters
```

### Model Registry

A catalog for versioning, staging, and approving ML models. Integrates with Pipelines for automated registration and with CI/CD for deployment gating.

**Stages**: `PendingManualApproval` → `Approved` / `Rejected`. Approved models can trigger EventBridge events to automatically deploy to endpoints.

### JumpStart

Pre-trained foundation models and ML solutions deployable in one click (or one API call). Includes Llama, Falcon, Stable Diffusion, and hundreds of HuggingFace models. Handles containerization (via [ECS/EKS-backed infrastructure](/aws/compute-containers)), hardware selection, and endpoint setup automatically. JumpStart also provides [fine-tuning](/fine-tuning-fundamentals) workflows for supported models, including [LoRA adapters](/lora-adapters) on select LLMs.

```python
from sagemaker.jumpstart.model import JumpStartModel

model = JumpStartModel(model_id="meta-textgeneration-llama-3-1-8b-instruct")
predictor = model.deploy(accept_eula=True)
response = predictor.predict({"inputs": "Explain gradient descent"})
```

---

## 3. Amazon Rekognition

### What It Is

Rekognition is a fully managed computer vision service. No ML expertise required—you send an image or video (from S3 or raw bytes) and receive structured JSON with labels, bounding boxes, and confidence scores.

### Core Capabilities

**Image Analysis**:
- `DetectLabels`: General object/scene detection (e.g., "Car", "Beach", "Person"). Returns labels with confidence scores and hierarchical taxonomy.
- `DetectFaces`: Detect up to 100 faces per image with attributes: age range, gender, emotions (7 types), smile, sunglasses, pose, quality.
- `CompareFaces`: Compare a source face to a target image. Returns similarity score (0–100%). Used for identity verification.
- `RecognizeCelebrities`: Identify famous people.
- `DetectModerationLabels`: Content moderation taxonomy (adult/suggestive/violence/drugs/etc.) with two-level hierarchy.
- `DetectText`: OCR for text in natural scenes (not documents—use Textract for that).
- `DetectProtectiveEquipment`: PPE detection for workplace safety (hard hats, vests, masks).

**Video Analysis** (asynchronous via SNS):
- `StartLabelDetection`, `StartFaceDetection`, `StartContentModeration`, `StartPersonTracking`
- Processes videos stored in S3, tracks entities across frames with timestamps.

**Face Collections** (for recognition at scale):
- `CreateCollection` → `IndexFaces` (add faces) → `SearchFacesByImage` or `SearchFaces`
- Stores face vectors (not images) in a collection. Sub-second search across millions of faces.
- Use case: Employee badge verification, finding a person across surveillance footage.

### Custom Labels

Fine-tune Rekognition on your own images using a visual UI or API. Train image-level classification or object detection models without writing ML code. Uses AWS-managed training infrastructure. Minimum 10 images per label for classification, 50 for object detection.

```python
rekognition = boto3.client("rekognition", region_name="us-east-1")

# Detect objects in an image from S3
response = rekognition.detect_labels(
    Image={"S3Object": {"Bucket": "my-bucket", "Name": "product.jpg"}},
    MaxLabels=10,
    MinConfidence=80.0
)
for label in response["Labels"]:
    print(f"{label['Name']}: {label['Confidence']:.1f}%")

# Content moderation
response = rekognition.detect_moderation_labels(
    Image={"Bytes": image_bytes},
    MinConfidence=60.0,
    HumanLoopConfig={"HumanLoopName": "moderation-review", ...}  # A2I integration
)
```

**Key limits**: Image max 5 MB (inline bytes) or 15 MB (S3). Video max 10 GB. Not real-time for video—async only.

---

## 4. Amazon Textract

### What It Is

Textract goes beyond simple OCR. It understands document structure—tables, forms, key-value pairs—and returns structured data with spatial coordinates. Handles handwriting, low-quality scans, and complex layouts.

### Extraction Types

**Raw text (OCR)**: `DetectDocumentText` returns WORD and LINE blocks with bounding boxes and confidence scores. Basic OCR.

**Forms (key-value pairs)**: `AnalyzeDocument` with `FeatureTypes=["FORMS"]`. Identifies form fields (key: "Date of Birth", value: "01/15/1985") as KEY_VALUE_SET blocks. Critical for extracting structured data from unstructured forms.

**Tables**: `AnalyzeDocument` with `FeatureTypes=["TABLES"]`. Returns TABLE blocks with nested CELL blocks. Each cell has row/column index. Handles merged cells and nested tables.

**Queries**: `AnalyzeDocument` with `FeatureTypes=["QUERIES"]`. Instead of extracting everything, ask specific questions: "What is the patient name?" "What is the total amount due?" Returns only the relevant values. More precise than parsing all key-value pairs.

**Lending Document Analysis**: `AnalyzeLendingDocument` — purpose-built for mortgage and financial documents (W-2, 1099, bank statements, pay stubs). Returns normalized, typed fields specific to each document type.

**Expense Analysis**: `AnalyzeExpense` — extracts line items, totals, tax, vendor info from receipts and invoices. Returns normalized summary fields.

```python
textract = boto3.client("textract", region_name="us-east-1")

# Synchronous (single-page documents, <5MB inline or <150MB S3)
response = textract.analyze_document(
    Document={"S3Object": {"Bucket": "docs", "Name": "application-form.pdf"}},
    FeatureTypes=["FORMS", "TABLES", "QUERIES"],
    QueriesConfig={
        "Queries": [
            {"Text": "What is the applicant name?"},
            {"Text": "What is the annual income?"}
        ]
    }
)

# Asynchronous (multi-page PDFs)
start_response = textract.start_document_analysis(
    DocumentLocation={"S3Object": {"Bucket": "docs", "Name": "50-page-contract.pdf"}},
    FeatureTypes=["TABLES", "FORMS"],
    NotificationChannel={"SNSTopicArn": "arn:aws:sns:...", "RoleArn": "arn:aws:iam::..."}
)
job_id = start_response["JobId"]
# Poll or wait for SNS notification, then:
result = textract.get_document_analysis(JobId=job_id)
```

**Textract + A2I**: Integrate Amazon Augmented AI (A2I) to route low-confidence extractions to human reviewers automatically.

---

## 5. Amazon Comprehend

### What It Is

Comprehend is a fully managed NLP service for text analysis. Pre-trained on a large corpus; no ML background required. Custom models can be trained on your own data.

### Core Capabilities

**Entity Recognition** (`DetectEntities`): Identifies PERSON, ORGANIZATION, LOCATION, DATE, QUANTITY, TITLE, COMMERCIAL_ITEM, EVENT, PHONE_NUMBER, ADDRESS, AGE, URL, EMAIL with character offsets.

**Sentiment Analysis** (`DetectSentiment`): Document-level POSITIVE/NEGATIVE/NEUTRAL/MIXED with confidence scores. Sentence-level sentiment via `DetectTargetedSentiment` (which entity has which sentiment).

**Key Phrases** (`DetectKeyPhrases`): Noun phrase extraction—useful for topic summarization without full NER overhead.

**Language Detection** (`DetectDominantLanguage`): Identifies language from 100+ languages with confidence scores. Use as a pre-filter before translation.

**Syntax Analysis** (`DetectSyntax`): POS tagging (NOUN, VERB, ADJ, etc.) with token offsets.

**PII Detection**:
- `DetectPiiEntities`: Returns PII types (NAME, SSN, PHONE, EMAIL, CREDIT_DEBIT_NUMBER, etc.) with offsets.
- `ContainsPiiEntities`: Faster check if *any* PII exists (without full offsets).
- `CreatePiiEntitiesDetectionJob`: Async batch job that can **redact** PII inline (replace with entity type label or custom mask).

**Toxicity Detection**: Multi-label classification for PROFANITY, HATE_SPEECH, INSULT, GRAPHIC, HARASSMENT_OR_ABUSE, SEXUAL, VIOLENCE_OR_THREAT.

### Custom Classifiers and NER

**Custom Classification**: Train a document classifier on your own categories (e.g., support ticket routing: BILLING/TECHNICAL/ACCOUNT). Multi-class or multi-label. Training requires CSV or augmented manifest from Ground Truth. Minimum 10 documents per class.

**Custom Entity Recognition**: Train on your domain entities (product names, internal IDs, medical terms not in the generic model). Requires annotated training data (entity list + plain documents or annotation file).

```python
comprehend = boto3.client("comprehend", region_name="us-east-1")

# Batch analysis (up to 25 texts per call)
response = comprehend.batch_detect_sentiment(
    TextList=["The product is excellent!", "Shipping was delayed again.", "It's okay I guess."],
    LanguageCode="en"
)
for result in response["ResultList"]:
    print(result["Index"], result["Sentiment"], result["SentimentScore"])

# PII detection and redaction (async batch)
response = comprehend.start_pii_entities_detection_job(
    InputDataConfig={"S3Uri": "s3://my-docs/raw/", "InputFormat": "ONE_DOC_PER_LINE"},
    OutputDataConfig={"S3Uri": "s3://my-docs/redacted/"},
    Mode="ONLY_REDACTION",
    RedactionConfig={
        "PiiEntityTypes": ["NAME", "SSN", "PHONE"],
        "MaskMode": "REPLACE_WITH_PII_ENTITY_TYPE"
    },
    DataAccessRoleArn="arn:aws:iam::123:role/ComprehendRole",
    LanguageCode="en"
)
```

---

## 6. Amazon Translate

### What It Is

A neural machine translation service supporting 75+ languages. Backed by [transformer-based models](/transformer-architecture) trained on large parallel corpora, continuously updated by AWS.

### Modes

**Real-time translation** (`TranslateText`): Synchronous, up to 10,000 bytes per request. Used in streaming chat, UI localization, real-time document display.

**Batch/asynchronous translation** (`StartTextTranslationJob`): Process S3-based document collections asynchronously. Supports plain text, HTML, DOCX, PPTX, XLSX, and XLIFF formats. Preserves document formatting.

**Document translation** (`TranslateDocument`): Synchronous translation of formatted documents up to 100 KB. Preserves HTML/DOCX/XLIFF structure.

### Custom Terminology

A controlled vocabulary that forces the translation model to use your specified term mappings. Essential for brand names, product names, technical jargon, or legal terms that must not be translated or must use specific translations.

```python
translate = boto3.client("translate", region_name="us-east-1")

# Upload custom terminology (CSV: en,fr with header)
translate.import_terminology(
    Name="tech-terms",
    MergeStrategy="OVERWRITE",
    TerminologyData={
        "File": b"en,fr\nLambda,Lambda\nSageMaker,SageMaker\n",
        "Format": "CSV",
        "Directionality": "MULTI"  # UNI (source→target only) or MULTI (both directions)
    }
)

# Translate with custom terminology applied
response = translate.translate_text(
    Text="Deploy your model to SageMaker for real-time inference.",
    SourceLanguageCode="en",
    TargetLanguageCode="fr",
    Settings={"Formality": "FORMAL", "Profanity": "MASK"},
    TerminologyNames=["tech-terms"]
)
print(response["TranslatedText"])
```

**Parallel data**: Provide your own example translations to customize the model's style (formal/informal, domain-specific phrasing). Different from custom terminology—this influences style, not specific word mappings.

**Active Custom Translation (ACT)**: Fine-tune the translation model on your parallel data for a specific domain. Higher quality than standard + parallel data for specialized content.

---

## 7. Amazon Transcribe

### What It Is

Transcribe converts speech to text (STT). It handles streaming and batch modes, multiple speakers, custom vocabulary, and domain-specific language models.

### Core Features

**Standard Transcription**: Async batch (S3 audio) or streaming (WebSocket/HTTP/2). Supports 100+ languages. Returns full transcription with word-level timestamps and confidence scores.

**Speaker Diarization** (`ShowSpeakerLabels`): Labels transcript segments by speaker (Speaker_0, Speaker_1, etc.). Specify max speaker count (2–10). Useful for meeting transcripts, interviews, call recordings.

**Custom Vocabulary**: Upload a word list or phrase table with pronunciation hints. Essential for names, acronyms, industry jargon, product names. Vocabulary filters can block specific words (content moderation for transcribed speech).

**Custom Language Models (CLM)**: Fine-tune the acoustic+language model on domain-specific text data (not audio—just text). Improves recognition accuracy for specialized terminology.

**Content Redaction**: Automatically redact PII from transcripts—replaces spoken PII (SSN, credit card numbers, dates of birth) with `[PII]` in the transcript text.

### Amazon Transcribe Medical

Separate model optimized for medical speech recognition. Handles clinician dictation, clinical terminology, drug names. Produces FHIR-compliant output when needed. HIPAA eligible.

### Amazon Transcribe Call Analytics

Purpose-built for contact center audio. On top of standard transcription, provides:
- Call categorization (tag calls by topic, issue type)
- Issue/action item/outcome detection
- Talk speed, interruptions, non-talk time metrics
- Sentiment per speaker per segment
- PII redaction in audio (not just text—scrubs audio waveform)

```python
transcribe = boto3.client("transcribe", region_name="us-east-1")

# Batch transcription with diarization and redaction
response = transcribe.start_transcription_job(
    TranscriptionJobName="customer-call-2024-001",
    Media={"MediaFileUri": "s3://audio-bucket/call-001.mp3"},
    MediaFormat="mp3",
    LanguageCode="en-US",
    Settings={
        "ShowSpeakerLabels": True,
        "MaxSpeakerLabels": 2,
        "VocabularyName": "finance-terms"
    },
    ContentRedaction={
        "RedactionType": "PII",
        "RedactionOutput": "redacted"
    },
    OutputBucketName="transcripts-bucket"
)

# Streaming transcription (Python, using async)
import asyncio
from amazon_transcribe.client import TranscribeStreamingClient

async def transcribe_stream():
    client = TranscribeStreamingClient(region="us-east-1")
    stream = await client.start_stream_transcription(
        language_code="en-US",
        media_sample_rate_hz=16000,
        media_encoding="pcm"
    )
    # Feed audio chunks to stream.input_stream, read from stream.output_stream
```

---

## 8. Amazon Polly

### What It Is

Polly converts text to speech (TTS). It offers standard (concatenative) and neural (NTTS) voices in 30+ languages, with SSML for fine-grained speech control.

### Voice Types

**Standard voices**: Concatenative synthesis. Lower latency, lower cost. Sounds slightly robotic on long passages. Good for short UI notifications.

**Neural TTS (NTTS)**: Deep learning–based synthesis. More natural, expressive prosody. Higher cost (~4× standard). Required for `speaking-rate`, `volume`, and neural-specific SSML features. Not available for all languages.

**Generative voices** (select voices): Uses a large language model to produce highly natural speech with contextual tone variation. Highest quality and cost.

**Long-form voices**: Optimized for continuous narration (articles, e-learning). Better consistency across long audio.

### SSML Support

SSML (Speech Synthesis Markup Language) gives granular control over speech:

```xml
<speak>
  Welcome to <emphasis level="strong">Acme Corp</emphasis>.
  <break time="500ms"/>
  Your order number is <say-as interpret-as="characters">ABC123</say-as>.
  <prosody rate="slow" pitch="+10%">Please listen carefully.</prosody>
  <phoneme alphabet="ipa" ph="ˈtɒmɑːtoʊ">tomato</phoneme>
</speak>
```

### Custom Lexicons

Define pronunciation for specific words using PLS (Pronunciation Lexicon Specification) in IPA or X-SAMPA. Upload per region, reference by name in `SynthesizeSpeech` call.

```python
polly = boto3.client("polly", region_name="us-east-1")

response = polly.synthesize_speech(
    Text="<speak>Hello, <emphasis>AWS</emphasis> is great!</speak>",
    TextType="ssml",
    OutputFormat="mp3",
    VoiceId="Joanna",          # Standard
    Engine="neural",            # or "standard" or "generative"
    LanguageCode="en-US",
    LexiconNames=["my-lexicon"]
)
audio_bytes = response["AudioStream"].read()

# For long text (>3000 chars), use StartSpeechSynthesisTask (async → S3)
task = polly.start_speech_synthesis_task(
    Text=long_text,
    OutputFormat="mp3",
    VoiceId="Matthew",
    Engine="neural",
    OutputS3BucketName="polly-audio",
    OutputS3KeyPrefix="narrations/"
)
```

---

## 9. Amazon Lex

### What It Is

Lex is a managed conversational AI service for building chatbots and voice bots. It uses the same underlying technology as Alexa. Handles natural language understanding (NLU), not generation—it classifies user intent and extracts slots, then your fulfillment logic generates the response.

### Core Concepts

**Bot**: The top-level container. Has a locale (language/region) and an [IAM](/aws/iam-security) role.

**Intent**: What the user wants to do. Examples: `BookFlight`, `CheckOrderStatus`, `FAQ`. Each intent has:
- **Sample utterances**: Training phrases ("I want to book a flight", "fly me to London")
- **Slots**: Required parameters to fulfill the intent (Departure city, Destination, Date)
- **Fulfillment**: [Lambda](/aws/lambda-serverless) function or dialog action to execute when slots are filled

**Slot type**: The type of data in a slot. Built-in: `AMAZON.City`, `AMAZON.Date`, `AMAZON.Number`. Custom: define allowed values (e.g., `PizzaSize`: SMALL/MEDIUM/LARGE).

**Dialog management**: Lex automatically prompts for unfilled required slots ("Which city are you flying from?"). Re-prompts on invalid input. Handles confirmation prompts ("Booking NYC to London on Tuesday for $750. Confirm?").

**Session state**: Maintains slot values and context across a conversation. Pass `sessionState` back to the Lex API to continue sessions from your backend.

### Lambda Fulfillment

```python
# Lambda handler for Lex fulfillment
def lambda_handler(event, context):
    intent_name = event["sessionState"]["intent"]["name"]
    slots = event["sessionState"]["intent"]["slots"]
    invocation_source = event["invocationSource"]  # "DialogCodeHook" or "FulfillmentCodeHook"

    if intent_name == "BookFlight":
        departure = slots["Departure"]["value"]["interpretedValue"]
        destination = slots["Destination"]["value"]["interpretedValue"]
        travel_date = slots["TravelDate"]["value"]["interpretedValue"]

        if invocation_source == "DialogCodeHook":
            # Validate slots during dialog
            if not is_valid_airport(departure):
                return elicit_slot(intent_name, slots, "Departure",
                                   "I don't recognize that airport. Please try again.")
            return delegate(intent_name, slots)  # Let Lex continue dialog

        elif invocation_source == "FulfillmentCodeHook":
            # All slots filled — execute booking
            booking_id = book_flight(departure, destination, travel_date)
            return close(intent_name, "Fulfilled",
                         f"Booked! Your confirmation is {booking_id}.")

def close(intent_name, fulfillment_state, message):
    return {
        "sessionState": {
            "dialogAction": {"type": "Close"},
            "intent": {"name": intent_name, "state": fulfillment_state}
        },
        "messages": [{"contentType": "PlainText", "content": message}]
    }
```

### Integration with Amazon Connect

Lex integrates natively with Amazon Connect (AWS's cloud contact center). A Lex bot handles the IVR/chat flow; when escalation is needed, Connect routes to a live agent with full conversation history. Common pattern for AI-assisted customer service.

---

## 10. Amazon Kendra

### What It Is

Kendra is an enterprise search service powered by ML. Unlike Elasticsearch (keyword matching), Kendra understands natural language questions and returns specific answers from documents, not just document links.

### Data Connectors (Sources)

Built-in connectors for: S3, SharePoint, Confluence, Salesforce, ServiceNow, RDS/Aurora, Google Drive, GitHub, Jira, Box, Quip, Slack, OneDrive, Web crawler, Database, and custom data sources via the Custom connector API.

Documents are indexed as a combination of text content + metadata attributes (author, date, category, etc.).

### Relevance Tuning

**Boosting**: Increase the ranking of results from specific fields (e.g., boost documents with `document_type=FAQ` for question queries).

**Block lists**: Suppress specific words from queries (stop words for your domain).

**Feedback API**: Submit user click data and positive/negative labels to improve ranking over time.

**Access control**: Documents can have ACL metadata. Kendra filters results based on user identity (via [IAM](/aws/iam-security) or JWT tokens) so users only see documents they're authorized to access.

### Incremental Crawl

Each data source has a sync schedule (on-demand or scheduled). Kendra tracks document change dates and only re-indexes changed documents—efficient for large corpora.

### Kendra vs. Bedrock Knowledge Bases

| | Kendra | Bedrock KB |
|---|---|---|
| Query type | Natural language + keyword | Natural language (RAG) |
| Output | Passages + FAQ answers | Generated response with citations |
| Connectors | 40+ enterprise connectors | S3, Confluence, Salesforce, SharePoint, Web |
| Customization | Relevance tuning, boosting | Chunking strategy, embedding model, vector store |
| Cost | $1,000+/month (Enterprise) | Pay-per-use (tokens + retrieval) |
| Best for | Enterprise document search, compliance | Conversational AI assistant |

For a deeper treatment of RAG evaluation, retrieval quality, and hybrid search tuning, see [RAG evaluation](/rag-evaluation) and [advanced RAG](/advanced-rag).

---

## 11. Amazon Forecast

### What It Is

A fully managed time-series forecasting service. Trained on Amazon's own forecasting research (DeepAR+, CNN-QR, Prophet variants). Handles missing values, holidays, and related time series automatically.

### Algorithms

**CNN-QR** (CNN Quantile Regression): AWS's top performer for large datasets. Handles multiple related time series jointly.

**DeepAR+**: LSTM-based probabilistic forecasting. Good for irregular time series, handles sparse data.

**Prophet**: Good for strong seasonal patterns with trend changes.

**ARIMA, ETS**: Classical statistical methods. Fast, interpretable. Use as baseline.

**AutoML** (`AutoPredictor`): Trains all algorithms on your data and ensembles them. Best accuracy, higher cost and time.

### Dataset Types

**Target time series**: The metric to forecast (e.g., demand by SKU/location/date).
**Related time series**: Exogenous variables known in the future (holidays, promotions, price changes).
**Item metadata**: Static features per item (category, color, weight).

### What-If Analysis

Once a predictor is trained, what-if analysis lets you modify related time series values and see how forecasts change—e.g., "What if we run a 20% discount in Q4?" without re-training.

```python
forecast = boto3.client("forecast", region_name="us-east-1")

# Create predictor (AutoML)
response = forecast.create_auto_predictor(
    PredictorName="demand-forecast-q4",
    ForecastHorizon=30,  # 30 time steps ahead
    ForecastFrequency="D",  # Daily
    DataConfig={
        "DatasetGroupArn": "arn:aws:forecast:...:dataset-group/retail"
    },
    OptimizationMetric="WAPE",  # Weighted Absolute Percentage Error
    ExplainPredictor=True  # Enable Explainability (impact of each feature)
)
```

---

## 12. Amazon Personalize

### What It Is

A fully managed recommendation system service. Based on the same algorithms that power Amazon.com's recommendations. No ML expertise required—you supply interaction data, Personalize trains and deploys a recommendation model.

### Recipe Types (Algorithms)

**USER_PERSONALIZATION**: `aws-user-personalization` — Personalized ranking of items for each user. Considers user history, item metadata, and real-time events.

**PERSONALIZED_RANKING**: Re-rank a curated list of items for a specific user. Use case: personalize editorial picks per user.

**RELATED_ITEMS**: `aws-similar-items` or `aws-sims` — "Customers who viewed X also viewed Y." Item-to-item similarity.

**USER_SEGMENTATION**: Cluster users into segments based on behavioral patterns. Use case: targeted marketing campaigns.

### Real-Time Events

Feed user interactions in real-time (page views, clicks, purchases) via `PutEvents` to update recommendations without re-training. The model adapts to recent behavior within the same session.

```python
personalize_events = boto3.client("personalize-events", region_name="us-east-1")
personalize_runtime = boto3.client("personalize-runtime", region_name="us-east-1")

# Real-time event ingestion
personalize_events.put_events(
    trackingId="tracking-id-abc",
    userId="user-123",
    sessionId="session-456",
    eventList=[{
        "eventId": "event-789",
        "eventType": "CLICK",
        "sentAt": 1700000000,
        "itemId": "product-001",
        "properties": json.dumps({"discount": "true"})
    }]
)

# Get recommendations
response = personalize_runtime.get_recommendations(
    campaignArn="arn:aws:personalize:us-east-1:123:campaign/product-recs",
    userId="user-123",
    numResults=10,
    context={"DEVICE": "mobile", "HOUR_OF_DAY": "14"},
    filterArn="arn:aws:personalize::123:filter/in-stock-only"  # Only show in-stock items
)
recommendations = [r["itemId"] for r in response["itemList"]]
```

**Filters**: Define rules to exclude items (already purchased, out of stock, wrong category). Applied at inference time.

---

## 13. AI/ML Integration Patterns

### Pattern 1: Event-Driven ML Pipeline ([S3](/aws/storage-s3) → [Lambda](/aws/lambda-serverless) → SageMaker → [DynamoDB](/aws/dynamodb-data-services))

The canonical serverless ML inference pipeline for processing uploaded documents or images.

```
S3 (upload trigger)
    → EventBridge / S3 Event Notification
    → Lambda (orchestrator)
        → [optional] Textract / Rekognition (preprocessing)
        → SageMaker Endpoint (inference)
        → DynamoDB (store results)
        → SNS (notify downstream consumers)
```

```python
# Lambda orchestrator triggered by S3
import boto3, json

s3 = boto3.client("s3")
sagemaker_runtime = boto3.client("sagemaker-runtime")
dynamodb = boto3.resource("dynamodb")

def handler(event, context):
    record = event["Records"][0]
    bucket = record["s3"]["bucket"]["name"]
    key = record["s3"]["object"]["key"]

    # 1. Download and preprocess
    obj = s3.get_object(Bucket=bucket, Key=key)
    raw_data = obj["Body"].read()
    features = preprocess(raw_data)  # your feature engineering

    # 2. Invoke SageMaker endpoint
    response = sagemaker_runtime.invoke_endpoint(
        EndpointName="fraud-detection-endpoint",
        ContentType="application/json",
        Body=json.dumps({"features": features})
    )
    prediction = json.loads(response["Body"].read())
    score = prediction["fraud_probability"]

    # 3. Persist to DynamoDB
    table = dynamodb.Table("fraud-results")
    table.put_item(Item={
        "document_id": key,
        "fraud_score": str(score),
        "is_fraud": score > 0.85,
        "processed_at": context.aws_request_id,
        "ttl": int(time.time()) + 86400 * 30  # 30-day TTL
    })

    # 4. Alert on high-risk
    if score > 0.85:
        sns = boto3.client("sns")
        sns.publish(
            TopicArn="arn:aws:sns:us-east-1:123:fraud-alerts",
            Message=json.dumps({"document": key, "score": score}),
            Subject="High fraud probability detected"
        )
```

**Production hardening**: Add SQS between [S3](/aws/storage-s3) events and [Lambda](/aws/lambda-serverless) for backpressure. Use DLQ for failed Lambda invocations. Enable Lambda concurrency limits to avoid overwhelming the SageMaker endpoint. Use [Step Functions](/aws-step-functions) instead of Lambda for complex multi-step workflows with error handling. For [networking and API Gateway](/aws/api-gateway-networking) in front of this pipeline, see the dedicated article.

### Pattern 2: [RAG](/advanced-rag) with Bedrock Knowledge Bases

The recommended managed RAG pattern on AWS when you want minimal infrastructure overhead.

```
[Data Sources: S3, SharePoint, Confluence]
    → Bedrock Knowledge Base (chunking + embedding + indexing)
        → OpenSearch Serverless (vector store)

[User Query]
    → API Gateway → Lambda
        → Bedrock KB: RetrieveAndGenerate API
            → Embedding (Titan Embeddings V2)
            → Vector search (OpenSearch)
            → Retrieved chunks → Claude (generation)
        → Response with citations
    → Client
```

```python
import boto3

bedrock_agent_runtime = boto3.client("bedrock-agent-runtime", region_name="us-east-1")

def rag_query(user_question: str, session_id: str) -> dict:
    response = bedrock_agent_runtime.retrieve_and_generate(
        input={"text": user_question},
        retrieveAndGenerateConfiguration={
            "type": "KNOWLEDGE_BASE",
            "knowledgeBaseConfiguration": {
                "knowledgeBaseId": "KB123456",
                "modelArn": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0",
                "retrievalConfiguration": {
                    "vectorSearchConfiguration": {
                        "numberOfResults": 8,
                        "overrideSearchType": "HYBRID",  # semantic + keyword
                        "filter": {
                            "andAll": [
                                {"equals": {"key": "status", "value": "published"}},
                                {"greaterThan": {"key": "version", "value": 2}}
                            ]
                        }
                    }
                },
                "generationConfiguration": {
                    "promptTemplate": {
                        "textPromptTemplate": "You are a helpful assistant. Answer based on: $search_results$\n\nQuestion: $query$"
                    },
                    "guardrailConfiguration": {
                        "guardrailId": "guardrail-abc",
                        "guardrailVersion": "1"
                    }
                }
            }
        },
        sessionId=session_id
    )
    return {
        "answer": response["output"]["text"],
        "citations": [
            {
                "text": ref["content"]["text"],
                "source": ref["location"]["s3Location"]["uri"]
            }
            for citation in response.get("citations", [])
            for ref in citation.get("retrievedReferences", [])
        ]
    }
```

**When to use custom RAG instead**: When you need custom re-ranking, hybrid search tuning, multi-index federation, or when the retrieval logic is complex enough to justify the engineering investment. LlamaIndex + OpenSearch + Bedrock gives full control. See [advanced RAG](/advanced-rag), [retrieval strategies](/retrieval-strategies), and [RAG evaluation](/rag-evaluation) for implementation guidance.

### Pattern 3: Streaming Inference with Kinesis

For real-time ML on high-volume event streams (clickstream, IoT, financial ticks).

```
[Producers: mobile apps, sensors, services]
    → Kinesis Data Streams (KDS)
        → Kinesis Data Analytics (KDA / Apache Flink)
            → Feature aggregation (rolling windows, sessionization)
            → SageMaker endpoint (real-time inference)
            → Kinesis Data Firehose → S3 (audit log)
            → DynamoDB / ElastiCache (serve predictions)
        → Lambda (per-shard consumer for simple cases)
```

```python
# Kinesis Lambda consumer for ML scoring
import boto3, json, base64

sagemaker_runtime = boto3.client("sagemaker-runtime")
dynamodb = boto3.resource("dynamodb").Table("predictions")

def handler(event, context):
    records = []
    for record in event["Records"]:
        # Kinesis records are base64-encoded
        payload = json.loads(base64.b64decode(record["kinesis"]["data"]))

        # Feature extraction from stream record
        features = extract_features(payload)

        # Batch records to reduce SageMaker invocations
        records.append(features)

    # Batch inference (single endpoint call for all records in shard)
    if records:
        response = sagemaker_runtime.invoke_endpoint(
            EndpointName="real-time-scoring-endpoint",
            ContentType="application/json",
            Body=json.dumps({"instances": records})
        )
        predictions = json.loads(response["Body"].read())["predictions"]

        # Write predictions to DynamoDB with TTL
        with dynamodb.batch_writer() as batch:
            for i, pred in enumerate(predictions):
                batch.put_item(Item={
                    "event_id": event["Records"][i]["kinesis"]["sequenceNumber"],
                    "score": str(pred["score"]),
                    "ttl": int(time.time()) + 3600
                })
```

**Kinesis Data Analytics (Flink)**: For stateful stream processing—rolling averages, session windows, joining streams. Emits enriched records to SageMaker, then results to downstream stores.

**Alternative with MSK (Kafka)**: For multi-cloud or when you need Kafka-native consumers. MSK → Lambda (using MSK trigger) or Flink on MSK.

---

## 14. Common Interview Questions with Strong Answers

### Bedrock and Foundation Models

**Q: A client wants to add a Q&A chatbot to their internal knowledge base. Walk me through the architecture on AWS.**

**A:** Start with Bedrock Knowledge Bases for the [RAG](/advanced-rag) layer. Connect it to their [S3](/aws/storage-s3) documents (or SharePoint/Confluence via native connectors). Choose the [vector store](/vector-databases) based on scale—OpenSearch Serverless for most cases. Use [Titan Embeddings V2](/embeddings) for indexing. Build the chat interface with [API Gateway](/aws/api-gateway-networking) + [Lambda](/aws/lambda-serverless) calling `RetrieveAndGenerate`. Add Bedrock Guardrails for PII protection and topic restrictions. Add a Bedrock Agent if users need to take actions (query a database, file a ticket) not just ask questions. For access control, embed document-level permissions as metadata and filter at retrieval time using [IAM](/aws/iam-security)-backed policies. Monitor via CloudWatch and Bedrock model invocation logs in S3.

---

**Q: How do you evaluate whether switching from Claude Sonnet to Claude Haiku is safe for your use case?**

**A:** Use Bedrock Model Evaluation. Collect 500+ representative production queries with reference answers (or human-rated quality scores). Run evaluation on both models. Compare on accuracy, coherence, and task-specific metrics. For cost-sensitive tasks (classification, extraction), Haiku often matches Sonnet at 10× lower cost. For complex reasoning, multi-step tasks, or long-context work, Sonnet typically wins. Also test latency under peak load—Haiku is faster. Make the decision data-driven, not intuitive.

---

**Q: What is provisioned throughput in Bedrock and when would you use it?**

**A:** Provisioned throughput reserves a fixed number of model units (MUs) for your exclusive use, guaranteeing consistent tokens-per-minute regardless of other customers' demand. You commit for 1 or 6 months. Use it when: (1) you're using a custom fine-tuned model in Bedrock (required—custom models can't run on on-demand), (2) you have sustained high-volume workloads where on-demand throttling causes SLA issues, (3) you need guaranteed latency SLAs for production applications. Avoid it for variable or experimental workloads where on-demand or batch inference is more cost-effective.

---

### SageMaker

**Q: What's the difference between SageMaker real-time, serverless, async, and batch transform endpoints?**

**A:** Real-time: always-on, sub-second synchronous inference—use for interactive apps. Serverless: auto-scales to zero, has cold start—use for sporadic/low-traffic or dev environments. Async: queues requests in S3, returns job ID—use for requests >60s or large payloads (e.g., video analysis). Batch Transform: S3-in/S3-out, no persistent endpoint—use for offline scoring of entire datasets. The decision tree: Is it interactive? → Real-time or serverless. Is it long-running? → Async. Is it offline batch? → Batch Transform. Is traffic very spiky with acceptable cold starts? → Serverless.

---

**Q: How do you prevent training/serving skew in an ML system?**

**A:** Training/serving skew occurs when features at training time differ from features at serving time. Mitigate with: (1) SageMaker Feature Store—the same feature computation code is used to populate both the offline store (training) and online store (inference), using the same SDK; (2) point-in-time consistency in Feature Store ensures training data only sees feature values that existed at event time, preventing data leakage; (3) SageMaker Model Monitor compares the statistical distribution of inference inputs against a baseline captured from training data, alerting on distribution shift; (4) SageMaker Clarify can detect feature drift and bias drift post-deployment.

---

**Q: When would you use SageMaker Pipelines vs. AWS Step Functions for ML workflows?**

**A:** Use SageMaker Pipelines when the workflow is primarily ML steps—training, evaluation, model registration, transformation. It's ML-native: deep integration with Feature Store, Model Registry, and Experiments. Use Step Functions when you need to orchestrate across multiple AWS services beyond SageMaker (Glue ETL, EMR, Lambda data transforms, DynamoDB writes, SNS notifications) or when the workflow has complex branching/retry logic that benefits from Step Functions' visual workflow debugging and broader AWS integration.

---

### AI APIs (Rekognition, Textract, Comprehend, etc.)

**Q: A client runs a gig economy platform with user-uploaded profile photos. They need to verify that photos contain a real human face and screen for inappropriate content. What AWS services would you use?**

**A:** Two-service pipeline: First, `DetectFaces` via Rekognition—confirms a face exists and checks quality attributes (brightness, sharpness, pose). Reject if no face detected or quality is too low. Second, `DetectModerationLabels` via Rekognition—screens for adult/suggestive content. Reject if confidence exceeds your threshold (e.g., 70%). For edge cases below the confidence threshold, route to Amazon Augmented AI (A2I) for human review. If identity verification is also needed (confirm the person is who they claim), add `CompareFaces` against a government ID photo extracted via Textract. The entire pipeline runs in Lambda triggered by S3 upload events.

---

**Q: What's the difference between Amazon Textract and basic OCR? When would you choose Textract?**

**A:** Basic OCR converts image pixels to a character stream. Textract understands document semantics—it knows that "Name:" and "John Smith" form a key-value pair, that cells in a table are structurally related, and that a signature block is different from a paragraph. Choose Textract when you need structured extraction (forms, tables, specific field values) not just raw text. Use it for IDP (intelligent document processing): loan applications, tax forms, invoices, insurance claims. For plain-text PDFs with no structure, basic text extraction (pdfplumber, pypdf) is faster and cheaper. For complex financial/lending documents, use Textract's specialized `AnalyzeLendingDocument` or `AnalyzeExpense` APIs rather than generic form extraction.

---

**Q: When would you use Comprehend vs. calling an LLM for NLP tasks like sentiment analysis or entity extraction?**

**A:** Comprehend: when you need high throughput at low cost on standard NLP tasks, have low-variance text (customer reviews, social media), or need HIPAA/PCI compliance with predictable latency. LLMs: when the task requires reasoning (nuanced sentiment about a specific product attribute), entity extraction from unstructured/complex text (e.g., medical narratives), or when you need custom output formats. Hybrid pattern: use Comprehend for bulk pre-filtering (language detection, coarse sentiment) and LLM for complex cases or secondary analysis. The 10× cost difference matters at scale.

---

### Architecture and Trade-offs

**Q: How would you architect a real-time fraud detection system processing 10,000 transactions per second?**

**A:** Ingest via Kinesis Data Streams (multiple shards for parallelism). Kinesis Data Analytics (Flink) performs stateful feature computation—rolling counts, velocity features, time-window aggregations—within a 100ms window. Features are enriched from [DynamoDB](/aws/dynamodb-data-services) (merchant profile, user history from Feature Store). Flink calls a SageMaker real-time endpoint (auto-scaled, multi-AZ behind ELB) for scoring. Results flow to Kinesis Firehose → [S3](/aws/storage-s3) for audit logging and Flink → DynamoDB for the serving layer (card authorization system reads here). Alert high-risk transactions via SNS → [Lambda](/aws/lambda-serverless) for case management. Use SageMaker Model Monitor to detect data drift in the transaction features. Retrain pipeline triggered by EventBridge on a weekly schedule via SageMaker Pipelines.

---

**Q: How do you handle cold start in a serverless ML inference architecture?**

**A:** For SageMaker Serverless Endpoints: the cold start is typically 1–3 seconds on first invocation and after idle periods. Mitigate with: (1) provisioned concurrency—keeps N instances warm (costs money even when idle); (2) periodic pinger—a CloudWatch Events rule triggers a Lambda every 5 minutes to keep the endpoint warm; (3) use real-time endpoints with scale-to-one instead of serverless for latency-sensitive paths. For Lambda + Bedrock (no dedicated endpoint): Lambda cold starts are ~200ms for Node.js/Python; use provisioned concurrency on Lambda for the most latency-sensitive paths. For Bedrock itself, on-demand inference has no cold start—the model is always available.

---

**Q: A client is concerned about Bedrock sending their proprietary data to Anthropic. How do you address this?**

**A:** This is a common enterprise concern. Key points: (1) AWS's data privacy commitment—Bedrock does NOT use customer data to train or improve foundation models. Inputs/outputs are not shared with model providers (Anthropic, Meta, etc.). (2) VPC-based invocation—use Bedrock VPC endpoints (PrivateLink) so model invocations never traverse the public internet (see [VPC & Networking](/aws-vpc-networking) and [API Gateway & Networking](/aws/api-gateway-networking)). (3) Encryption—all data is encrypted in transit (TLS) and at rest; you can bring your own KMS key for model customization artifacts (see [IAM & Security](/aws/iam-security)). (4) Bedrock model invocation logging—log all requests/responses to your own [S3](/aws/storage-s3) bucket for audit. (5) For highly sensitive workloads, consider deploying open-source models (Llama, Mistral) via SageMaker JumpStart in your own VPC—no data leaves your AWS account at all.

---

**Q: When would you choose Kendra over Bedrock Knowledge Bases for enterprise search?**

**A:** Kendra when: you need 40+ native connectors (ServiceNow, Jira, Box, Quip), your users want document-style search results (links to sources, ranked passages) rather than conversational answers, you need fine-grained access control at the document level, compliance requires no external model calls (Kendra ML runs within AWS), or you need keyword + semantic hybrid search with relevance tuning controls. Bedrock KB when: you're building a conversational assistant that synthesizes answers from documents, you need the response quality of Claude/Titan, you want tight integration with Bedrock Agents, or your data sources are primarily [S3](/aws/storage-s3) and a handful of supported connectors. For enterprise deployments, a hybrid architecture often works: Kendra for structured search/faceted navigation, Bedrock KB for the conversational assistant layer on top. See [RAG evaluation](/rag-evaluation) for how to measure retrieval quality in either approach.

---

**Q: Describe how you would build an end-to-end document processing pipeline for a legal firm that needs to extract clauses from contracts and make them searchable.**

**A:** Ingest: [S3](/aws/storage-s3) bucket (encrypted, versioned) as the document store. Users upload via a pre-signed URL from [API Gateway](/aws/api-gateway-networking) + [Lambda](/aws/lambda-serverless). Process: S3 event triggers a Step Functions workflow. Step 1: Textract `StartDocumentAnalysis` (async, multi-page PDF support). Step 2: Lambda parses Textract output—extracts key-value pairs, tables, and raw text by section. Step 3: Bedrock (Claude) performs clause classification and extraction from raw text (too nuanced for Textract alone). Step 4: Comprehend Custom Entity Recognizer tags legal entities (party names, dates, jurisdiction-specific terms) trained on firm's own contract corpus. Step 5: Store structured results in [DynamoDB](/aws/dynamodb-data-services) (fast lookup by contract ID) and full text + [embeddings](/embeddings) in OpenSearch (semantic search). Search: Kendra or Bedrock KB as the search layer. Bedrock KB for natural language questions ("Which contracts mention arbitration in Delaware?")—backed by [advanced RAG](/advanced-rag) with metadata filtering. Kendra for document-level faceted search (by date, party, contract type). Security: [IAM](/aws/iam-security) and VPC PrivateLink throughout. Attorney-specific access control enforced at the Kendra/Bedrock KB query layer via ACL metadata.

---

## Bedrock Agents — Agentic AI Workflows

Bedrock Agents enable LLMs to autonomously execute multi-step tasks by calling APIs, querying knowledge bases, and taking actions.

### Architecture
```
User Query
    ↓
Bedrock Agent (Foundation Model orchestrator)
    ├── Action Group 1: Order Management (calls Lambda → your API)
    ├── Action Group 2: Inventory Check (calls Lambda → DynamoDB)
    ├── Knowledge Base: Product catalog (OpenSearch/Aurora)
    └── Return Response
```

### Action Groups — Tool Use
Action Groups define the tools an agent can use. Each action group is backed by a [Lambda](/aws/lambda-serverless) function and described by an OpenAPI schema.

```json
// OpenAPI schema for "Order Management" action group
{
  "openapi": "3.0.0",
  "info": {"title": "Order Management API", "version": "1.0"},
  "paths": {
    "/orders": {
      "get": {
        "operationId": "listOrders",
        "description": "Get orders for a customer",
        "parameters": [
          {"name": "customerId", "in": "query", "required": true, "schema": {"type": "string"}},
          {"name": "status", "in": "query", "required": false, "schema": {"type": "string", "enum": ["pending", "shipped", "delivered"]}}
        ],
        "responses": {"200": {"description": "List of orders"}}
      }
    },
    "/orders/{orderId}/cancel": {
      "post": {
        "operationId": "cancelOrder",
        "description": "Cancel a specific order",
        "parameters": [{"name": "orderId", "in": "path", "required": true, "schema": {"type": "string"}}],
        "responses": {"200": {"description": "Cancellation result"}}
      }
    }
  }
}
```

```python
# Lambda function backing the action group
def lambda_handler(event, context):
    agent_action = event['actionGroup']
    api_path = event['apiPath']
    parameters = {p['name']: p['value'] for p in event.get('parameters', [])}

    if api_path == '/orders':
        orders = get_orders_from_db(parameters['customerId'], parameters.get('status'))
        return {
            'response': {'statusCode': 200, 'responseBody': {'application/json': {'body': json.dumps(orders)}}}
        }

    if api_path == '/orders/{orderId}/cancel':
        order_id = parameters['orderId']
        result = cancel_order_in_db(order_id)
        return {
            'response': {'statusCode': 200, 'responseBody': {'application/json': {'body': json.dumps(result)}}}
        }
```

### Knowledge Bases — RAG Without Infrastructure
Bedrock Knowledge Bases is managed [RAG](/advanced-rag): you connect data sources ([S3](/aws/storage-s3), Confluence, SharePoint, Web), Bedrock ingests, chunks, embeds, and stores in a [vector database](/vector-databases).

```python
import boto3

bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name='us-east-1')

# Retrieve and Generate (RAG query)
response = bedrock_agent_runtime.retrieve_and_generate(
    input={'text': 'What is our refund policy for digital products?'},
    retrieveAndGenerateConfiguration={
        'type': 'KNOWLEDGE_BASE',
        'knowledgeBaseConfiguration': {
            'knowledgeBaseId': 'KBID12345',
            'modelArn': 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0',
            'retrievalConfiguration': {
                'vectorSearchConfiguration': {
                    'numberOfResults': 5,
                    'overrideSearchType': 'HYBRID',  # semantic + keyword
                    'filter': {
                        'equals': {'key': 'category', 'value': 'policy'}
                    }
                }
            },
            'generationConfiguration': {
                'promptTemplate': {
                    'textPromptTemplate': 'Answer based on the provided context: $search_results$\n\nQuestion: $query$'
                }
            }
        }
    }
)

print(response['output']['text'])
print('Citations:', response['citations'])  # shows which documents were used

# Retrieve only (no generation — get raw chunks)
retrieval = bedrock_agent_runtime.retrieve(
    knowledgeBaseId='KBID12345',
    retrievalQuery={'text': 'refund policy digital products'},
    retrievalConfiguration={'vectorSearchConfiguration': {'numberOfResults': 10}}
)
```

### Supported Vector Databases for Knowledge Bases
- **OpenSearch Serverless** (managed, recommended for most use cases)
- **Aurora PostgreSQL** (pgvector extension)
- **Pinecone** (third-party, bring your own)
- **Redis Enterprise Cloud** (bring your own)
- **MongoDB Atlas** (bring your own)

### Agents + Knowledge Bases Together
```python
# Agent that can both call APIs AND query knowledge base
response = bedrock_agent_runtime.invoke_agent(
    agentId='AGENTID123',
    agentAliasId='ALIASID456',
    sessionId='session-user-42',
    inputText="I want to cancel order ORD-999. Also, what's your return policy?",
    # Agent will: 1) call Order API to cancel ORD-999, 2) query KB for return policy
    # Then synthesize a response combining both
)

# Stream response
for event in response['completion']:
    if 'chunk' in event:
        print(event['chunk']['bytes'].decode('utf-8'), end='', flush=True)
    if 'trace' in event:
        # Trace shows agent's reasoning: which tools it chose and why
        print('\nTrace:', event['trace']['trace']['orchestrationTrace'])
```

For stateful multi-agent orchestration beyond the managed Bedrock Agents model, see [agent architectures](/agent-architectures) and [LangGraph](/langgraph). For Step Functions-based orchestration of the broader pipeline around agents, see [Step Functions](/aws-step-functions).

---

## Bedrock Guardrails — Safety Layer for GenAI Applications

Guardrails provide a customizable safety layer that screens both inputs and outputs. For broader [IAM](/aws/iam-security) and security context around Bedrock deployments, see [Security Services](/aws-security-services).

### Configurable Controls
- **Content filters**: block harmful content by category (hate speech, violence, sexual, profanity, prompt injection attacks) with strength level (low/medium/high)
- **Denied topics**: define topics the model should refuse (e.g., "competitor products", "legal advice", "financial advice")
- **Word filters**: block specific words/phrases in input or output
- **PII redaction**: detect and redact/block PII types (SSN, credit card, phone, email, address, name)
- **Grounding check**: verify response is grounded in provided context (reduces hallucination for RAG use cases)
- **Contextual grounding**: evaluate whether response is relevant to the prompt

```python
# Invoke model with guardrail
response = bedrock.invoke_model(
    modelId='anthropic.claude-3-5-sonnet-20241022-v2:0',
    body=json.dumps({
        'anthropic_version': 'bedrock-2023-05-31',
        'max_tokens': 1024,
        'messages': [{'role': 'user', 'content': user_message}]
    }),
    guardrailIdentifier='my-guardrail-id',
    guardrailVersion='1',
    trace='ENABLED',
)

result = json.loads(response['body'].read())

# Check if guardrail intervened
if result.get('amazon-bedrock-guardrailAction') == 'GUARDRAIL_INTERVENED':
    # Handle blocked/modified response
    intervention_trace = result.get('amazon-bedrock-trace', {})
    print('Guardrail blocked or modified response:', intervention_trace)
```

---

## Amazon Q — AI Assistant Portfolio

Amazon Q is AWS's family of AI assistants:

### Amazon Q Developer
- AI coding assistant integrated into VS Code, JetBrains, CLI, and AWS Console
- Features:
  - **Inline code suggestions**: like GitHub Copilot but trained on AWS open-source + CodeWhisperer data
  - **Chat in IDE**: ask questions about code, explain errors, refactor, generate tests
  - **AWS Console Q chat**: explain AWS console pages, help with CloudFormation, troubleshoot errors
  - **Code transformation**: upgrade Java 8 → 17, .NET Framework → .NET, semi-automated refactoring
  - **Security scanning**: SAST scan of open files, suggests fixes for CVEs/security issues
  - **CLI companion**: `q chat` in terminal, explain commands, debug errors
- Pricing: Free tier (50 suggestions/month); Pro tier ($19/month with higher limits + SSO)

### Amazon Q Business
- Enterprise chatbot connected to company data sources ([S3](/aws/storage-s3), SharePoint, Salesforce, JIRA, Confluence, RDS)
- Answers questions based on internal documents: "What's our PTO policy?" "Find all tickets related to customer Acme Corp"
- Respects source permissions (user can only see docs they have access to in the source system)
- Custom plugins: call external APIs from within Q Business conversation
- Compare: Bedrock Agents for custom AI applications; Q Business for enterprise internal knowledge search

---

## SageMaker Feature Store & ML Pipelines

### Feature Store — Centralized ML Features
```python
import boto3
from sagemaker.feature_store.feature_group import FeatureGroup
from sagemaker.session import Session

# Define feature group
feature_group = FeatureGroup(
    name='customer-features',
    sagemaker_session=Session(),
)

feature_group.load_feature_definitions(data_frame=customer_df)
feature_group.create(
    s3_uri=f's3://my-ml-bucket/feature-store',
    record_identifier_name='customer_id',
    event_time_feature_name='event_time',
    role_arn='arn:aws:iam::...:role/SageMakerRole',
    enable_online_store=True,   # sub-ms reads for real-time inference
    online_store_security_config=...,
    enable_offline_store=True,  # S3-backed for training; see [Data Analytics](/aws-data-analytics) for Glue/Athena query patterns
)

# Ingest features
feature_group.ingest(data_frame=customer_df, max_workers=3, wait=True)

# Real-time feature lookup
runtime = boto3.client('sagemaker-featurestore-runtime')
record = runtime.get_record(
    FeatureGroupName='customer-features',
    RecordIdentifierValueAsString='cust-42',
)
```

### SageMaker Pipelines — MLOps
```python
from sagemaker.workflow.pipeline import Pipeline
from sagemaker.workflow.steps import ProcessingStep, TrainingStep, TransformStep
from sagemaker.workflow.conditions import ConditionGreaterThanOrEqualTo
from sagemaker.workflow.condition_step import ConditionStep

# Step 1: Data preprocessing
preprocessing_step = ProcessingStep(
    name='PreprocessData',
    processor=SKLearnProcessor(framework_version='1.0', instance_type='ml.m5.xlarge', ...),
    inputs=[ProcessingInput(source=data_s3_uri, destination='/opt/ml/processing/input')],
    outputs=[ProcessingOutput(output_name='train', source='/opt/ml/processing/output/train')],
)

# Step 2: Training
training_step = TrainingStep(
    name='TrainModel',
    estimator=XGBoost(instance_type='ml.m5.2xlarge', ...),
    inputs={'train': TrainingInput(s3_data=preprocessing_step.properties.ProcessingOutputConfig.Outputs['train'].S3Output.S3Uri)},
)

# Step 3: Conditional registration — only register if accuracy > 85%
condition = ConditionGreaterThanOrEqualTo(
    left=JsonGet(step_name=training_step.name, property_file='metrics', json_path='accuracy'),
    right=0.85,
)

pipeline = Pipeline(
    name='customer-churn-pipeline',
    steps=[preprocessing_step, training_step, ConditionStep(name='CheckAccuracy', conditions=[condition], if_steps=[register_step], else_steps=[fail_step])],
    parameters=[instance_type_param, data_uri_param],
)
pipeline.upsert(role_arn=sagemaker_role)
pipeline.start()
```

For broader AWS workflow orchestration (Lambda, Glue, EMR, SNS), see [Step Functions](/aws-step-functions). For [VPC & Networking](/aws-vpc-networking) considerations when running SageMaker in a private subnet (PrivateLink, VPC endpoints), see the dedicated networking article. Monitoring pipeline runs integrates with [Observability](/aws-observability) via CloudWatch metrics and EventBridge triggers.

---

## Amazon Bedrock Model Evaluation

Evaluate models before choosing for production:

```python
# Create model evaluation job
bedrock = boto3.client('bedrock')

response = bedrock.create_evaluation_job(
    jobName='claude-vs-nova-eval',
    jobDescription='Compare Claude 3.5 Sonnet vs Amazon Nova Pro for our use case',
    roleArn='arn:aws:iam::...:role/BedrockEvaluationRole',
    evaluationConfig={
        'automated': {
            'datasetMetricConfigs': [{
                'taskType': 'QuestionAndAnswer',
                'dataset': {'name': 'my-eval-dataset', 's3Uri': 's3://...'},
                'metricNames': ['Accuracy', 'Robustness', 'Toxicity']
            }]
        }
    },
    inferenceConfig={
        'models': [
            {'bedrockModel': {'modelIdentifier': 'anthropic.claude-3-5-sonnet-20241022-v2:0'}},
            {'bedrockModel': {'modelIdentifier': 'amazon.nova-pro-v1:0'}},
        ]
    },
    outputDataConfig={'s3Uri': 's3://my-bucket/eval-results/'},
)
```

Evaluation results land in [S3](/aws/storage-s3) and can feed downstream reporting. For monitoring model quality in production (data drift, quality drift), see [Observability](/aws-observability) and SageMaker Model Monitor.

---

## Red Flags to Avoid

- **Confusing Bedrock and SageMaker**: Bedrock = managed access to third-party FMs, no model management. SageMaker = full ML lifecycle platform, bring your own model or use built-in algorithms. They are complementary, not alternatives for the same problem.
- **"Just use Bedrock for everything"**: Bedrock cannot train custom models from scratch, run custom inference containers, or handle ML pipelines. SageMaker is the answer for custom model development.
- **Ignoring data privacy concerns with Bedrock**: Always address it proactively—VPC endpoints, model invocation logging, AWS data privacy commitments.
- **Treating Textract as just OCR**: Missing that its value is structural extraction (forms, tables, queries). If you describe using it only for text extraction, interviewers will probe further.
- **Not knowing the Comprehend limits**: Comprehend has a 100 KB document size limit (synchronous) and requires UTF-8 text—PDF/image input requires Textract first.
- **Overlooking Lex's scope**: Lex does NLU (intent/slot classification), not NLG (generating responses). The response generation is your Lambda's job. Conflating Lex with a full chatbot shows a misunderstanding.
- **Recommending Forecast or Personalize for small datasets**: Forecast requires at least a few hundred observations per time series; Personalize needs >1,000 interaction events per user to be meaningful. For smaller datasets, simpler statistical methods or Bedrock with prompt-based forecasting may be more appropriate.
- **Not mentioning monitoring**: Production ML systems require SageMaker Model Monitor (data drift, model quality drift), CloudWatch metrics, and Bedrock model invocation logs. Always mention [observability](/aws-observability).
