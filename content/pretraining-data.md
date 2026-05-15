# Pre-training: Data Curation, Objectives & Curriculum

Pre-training is where a language model acquires the vast majority of its knowledge and capabilities, yet the data engineering behind pre-training remains one of the least transparent aspects of modern AI. While frontier labs invest hundreds of millions of dollars in training compute, the quality, composition, and curation of training data often matters as much as scale. This article examines the full pre-training pipeline — from web scraping and deduplication through quality filtering and data mixing — alongside the training objectives and curriculum strategies that determine how models learn from their data.

## The Pre-training Data Pipeline

A modern pre-training data pipeline processes petabytes of raw web crawl data into a curated, deduplicated, filtered corpus. The pipeline typically has four stages: acquisition, deduplication, quality filtering, and mixing.

### Data Acquisition: Web Crawling at Scale

The foundation of most pre-training datasets is **Common Crawl**, a nonprofit organization that performs regular crawls of the public web and makes the data freely available. Each monthly crawl contains 3-5 billion web pages, totaling 200-300 TB of compressed WARC files.

Raw Common Crawl data is unsuitable for training directly:

- **HTML noise**: navigation bars, advertisements, boilerplate, JavaScript
- **Duplicated content**: the same text appears on many pages (syndication, scraping, templates)
- **Low-quality text**: spam, auto-generated content, incomprehensible text
- **Harmful content**: hate speech, malware, personally identifiable information

The first step is text extraction — converting raw HTML into clean text. **Trafilatura** (**Barbaresi, 2021**) and **jusText** are commonly used tools that identify the main content area of a web page and strip boilerplate.

```python
import trafilatura

def extract_text_from_html(html_content):
    """Extract main content from HTML, removing boilerplate."""
    text = trafilatura.extract(
        html_content,
        include_comments=False,
        include_tables=True,
        no_fallback=False,
        favor_precision=True
    )
    return text
```

### Language Identification

After text extraction, each document is tagged with its language using a classifier such as **fastText's language identification model** (**Joulin et al., 2017**), which achieves 95%+ accuracy across 176 languages. This enables language-specific filtering and controlled multilingual mixing.

## Deduplication

Deduplication is arguably the single most impactful data processing step. **Lee et al. (2022)** showed that training on deduplicated data produces better models at the same compute budget — duplicate data wastes training FLOPs and can cause memorization of specific passages.

### Exact Deduplication

The simplest form removes documents with identical content. This is typically done by computing a hash (SHA-256 or similar) of each document's text and removing duplicates:

```python
import hashlib

def exact_dedup(documents):
    """Remove exactly duplicated documents."""
    seen_hashes = set()
    unique_docs = []
    for doc in documents:
        h = hashlib.sha256(doc.encode('utf-8')).hexdigest()
        if h not in seen_hashes:
            seen_hashes.add(h)
            unique_docs.append(doc)
    return unique_docs
```

Exact deduplication is fast and removes a surprising amount of data — typically 10-30% of a raw web crawl. However, it misses near-duplicates: documents that differ by a few words, a date, or formatting.

### MinHash for Near-Deduplication

**MinHash** locality-sensitive hashing (**Broder, 1997**) is the standard approach for near-deduplication at scale. The algorithm estimates the Jaccard similarity between document shingle sets without comparing all pairs:

```python
from datasketch import MinHash, MinHashLSH

def create_minhash(text, num_perm=128, ngram_size=5):
    """Create a MinHash signature for a document."""
    m = MinHash(num_perm=num_perm)
    # Create character n-gram shingles
    shingles = set()
    for i in range(len(text) - ngram_size + 1):
        shingles.add(text[i:i+ngram_size])
    for shingle in shingles:
        m.update(shingle.encode('utf-8'))
    return m

def near_dedup(documents, threshold=0.8):
    """Remove near-duplicate documents using MinHash LSH."""
    lsh = MinHashLSH(threshold=threshold, num_perm=128)
    unique_indices = []

    for i, doc in enumerate(documents):
        mh = create_minhash(doc)
        # Check if similar document already exists
        result = lsh.query(mh)
        if not result:
            lsh.insert(str(i), mh)
            unique_indices.append(i)

    return [documents[i] for i in unique_indices]
```

**Penedo et al. (2023)** in the RefinedWeb paper reported that MinHash deduplication removed an additional 30-40% of data beyond exact deduplication, and the resulting models showed measurable quality improvements, particularly on memorization-sensitive evaluations.

### Suffix Array Deduplication

**Lee et al. (2022)** demonstrated that **substring-level deduplication** using suffix arrays can further improve data quality. Rather than removing entire near-duplicate documents, this approach identifies and removes duplicated spans of text (e.g., repeated boilerplate paragraphs, copied passages) that occur across many documents. This is more fine-grained than document-level deduplication and catches a class of redundancy that MinHash misses.

The computational cost is significant — building suffix arrays over trillions of tokens requires specialized distributed algorithms — but the quality improvement justifies the cost for major training runs.

## Quality Filtering

After deduplication, the corpus still contains substantial low-quality text. Quality filtering aims to retain text that will be most useful for training.

### Heuristic Filtering

Simple heuristic rules remove clearly low-quality documents:

```python
def heuristic_filter(text):
    """Apply basic quality heuristics."""
    # Too short or too long
    if len(text) < 200 or len(text) > 500000:
        return False
    # Low alphabetic ratio (likely code/tables/binary)
    alpha_ratio = sum(c.isalpha() for c in text) / len(text)
    if alpha_ratio < 0.4:
        return False
    # High ratio of repeated lines
    lines = text.split('\n')
    unique_lines = set(lines)
    if len(unique_lines) / max(len(lines), 1) < 0.3:
        return False
    # Check for known low-quality patterns
    if any(spam in text.lower() for spam in [
        'buy now', 'click here', 'subscribe to our newsletter',
        'cookie policy', 'terms and conditions'
    ]):
        return False  # Oversimplified; real filters are more nuanced
    return True
```

**Rae et al. (2021)** in the Gopher paper detailed an extensive heuristic filtering pipeline including:

- Removing documents with excessive special character ratios
- Filtering based on word length distributions (catching garbled text)
- Removing documents where a single line constitutes more than 30% of the text (indicative of boilerplate-heavy pages)
- Filtering based on "stop word" frequency (text with very few common words is likely not natural language)

### Classifier-Based Filtering

**Brown et al. (2020)** trained a binary classifier to distinguish "high-quality" text (using Wikipedia and curated book corpora as positive examples) from random web text. Documents scoring above a threshold were retained. This approach, while effective, introduces a quality bias: the model learns to prefer text that "looks like" Wikipedia, which may not be the best proxy for training data quality.

**Penedo et al. (2023)** in RefinedWeb argued that heavy classifier-based filtering can be counterproductive, as it reduces dataset diversity and introduces systematic biases. They showed that with sufficient deduplication, lighter heuristic filtering produces comparable or better models.

### Perplexity-Based Filtering

An alternative approach uses a pre-trained language model (typically a small one, like a 5-gram KenLM model) to score documents by perplexity. Documents with very high perplexity (incomprehensible text, non-natural language) or very low perplexity (highly repetitive, template text) are removed:

```python
import kenlm

model = kenlm.Model('web_lm.arpa')

def perplexity_filter(text, min_pp=10, max_pp=1000):
    """Filter documents by KenLM perplexity."""
    pp = model.perplexity(text)
    return min_pp <= pp <= max_pp
```

**CCNet** (**Wenzek et al., 2020**), used to create the CC-100 dataset and subsequently adopted by many projects, uses this approach to partition Common Crawl into quality buckets.

## Pre-training Objectives

The training objective determines what the model learns from its data. While next-token prediction dominates, several alternatives and augmentations exist.

### Causal Language Modeling (CLM)

The standard objective for decoder-only models: predict the next token given all previous tokens.

$$\mathcal{L}_{CLM} = -\sum_{t=1}^{T} \log P(x_t \mid x_1, \ldots, x_{t-1})$$

Every token in the training sequence provides a training signal, making CLM extremely data-efficient in terms of utilization — each sequence of $T$ tokens yields $T$ prediction targets.

CLM is used by GPT, Llama, Mistral, Claude, and most modern LLMs.

### Masked Language Modeling (MLM)

The objective used by BERT (**Devlin et al., 2019**): randomly mask 15% of tokens and predict them from the bidirectional context. MLM produces strong bidirectional representations but is less natural for generation tasks.

$$\mathcal{L}_{MLM} = -\sum_{t \in \mathcal{M}} \log P(x_t \mid x_{\setminus \mathcal{M}})$$

where $\mathcal{M}$ is the set of masked positions.

MLM models (BERT, RoBERTa, DeBERTa) excel at classification and extraction tasks but require separate decoder architectures for generation. The 15% masking rate means only 15% of tokens provide a training signal per sequence, making MLM less data-efficient than CLM.

### Prefix Language Modeling

A hybrid approach where the first portion of the sequence (the "prefix") is processed with bidirectional attention, and the remainder is predicted autoregressively:

$$\mathcal{L}_{prefix} = -\sum_{t=p+1}^{T} \log P(x_t \mid x_1, \ldots, x_{t-1})$$

where position $1$ through $p$ are the prefix tokens seen bidirectionally. T5 uses a variant of this, and **Tay et al. (2022)** in UL2 showed that mixing multiple objective types (prefix LM, CLM, and span corruption) can produce models that are strong at both understanding and generation.

### Span Corruption

Used by T5 (**Raffel et al., 2020**), span corruption replaces random contiguous spans of tokens with sentinel tokens, and the model must generate the missing spans:

```
Input:  "The <X> sat on the <Y>."
Target: "<X> cat <Y> mat </s>"
```

Span corruption is more data-efficient than single-token MLM because the model must predict multiple consecutive tokens, learning local coherence. The span length distribution affects what the model learns: short spans emphasize local syntax, while long spans require more semantic understanding.

## Data Mixing Strategies

The composition of the training data — the relative proportions of different data sources and domains — significantly affects model capabilities.

### Source Categories

Modern training corpora typically include:

| Source | Proportion | Purpose |
|--------|-----------|---------|
| Web text | 60-80% | General knowledge, language understanding |
| Code | 5-15% | Programming, structured reasoning |
| Books | 3-10% | Long-form reasoning, narrative, specialized knowledge |
| Academic papers | 2-5% | Scientific knowledge, technical writing |
| Wikipedia | 2-5% | Factual knowledge, structured information |
| Conversational data | 1-5% | Dialogue, informal language |
| Math | 1-5% | Mathematical reasoning |
| Multilingual | Variable | Non-English language capability |

### Mixing Laws

**Ye et al. (2024)** studied how data mixing ratios affect model capabilities and found:

1. **Upweighting high-quality sources** (Wikipedia, books, academic papers) beyond their natural proportion improves quality on knowledge-intensive tasks.
2. **Code data** improves not just code generation but also general reasoning (**Muennighoff et al., 2023**), likely because code requires precise logical thinking.
3. **Diminishing returns from repetition**: repeating high-quality data more than 4x provides diminishing benefit (**Muennighoff et al., 2023**).

**Xie et al. (2024)** with DoReMi introduced an algorithm that learns optimal data mixing ratios using a small proxy model:

```python
def doremi_mixing(proxy_model, reference_model, domains, val_data):
    """
    DoReMi: learn domain weights that minimize worst-case
    excess loss across domains.
    """
    domain_weights = torch.ones(len(domains)) / len(domains)

    for step in range(num_steps):
        # Sample batch according to current weights
        batch = sample_weighted(domains, domain_weights)

        # Compute excess loss per domain
        proxy_loss = proxy_model.loss(batch)
        ref_loss = reference_model.loss(batch)
        excess_loss = proxy_loss - ref_loss

        # Update weights: upweight domains with high excess loss
        domain_weights *= torch.exp(eta * excess_loss)
        domain_weights /= domain_weights.sum()

    return domain_weights
```

## Major Open Datasets

### The Pile

**Gao et al. (2020)** created The Pile, an 825 GB English text dataset assembled from 22 diverse sources. The Pile was significant because it:

- Made the data mixture explicit and reproducible
- Included underrepresented domains (Enron emails, USPTO patents, NIH grants, PhilPapers)
- Provided a standardized benchmark for data quality research

The Pile was used to train GPT-Neo, GPT-J, and Pythia models, making it one of the most studied training datasets.

### RedPajama

**Together (2023)** created RedPajama as an open reproduction of the Llama training data. RedPajama v1 replicated the seven-source composition of Llama (Common Crawl, C4, GitHub, Wikipedia, books, ArXiv, StackExchange) totaling 1.2T tokens.

**RedPajama v2** expanded to 30T tokens of raw web data with quality signals, enabling researchers to apply their own filtering criteria.

### Dolma

**Soldaini et al. (2024)** at the Allen Institute for AI created Dolma, a 3T token dataset used to train the OLMo model family. Dolma's contribution is not just its size but its transparency:

- Full documentation of every processing step
- Open-source data processing toolkit (Dolma toolkit)
- Detailed analysis of data composition and quality
- Reproducible pipeline from raw Common Crawl to training-ready data

```bash
# Dolma processing pipeline (conceptual)
# 1. Download Common Crawl WARC files
# 2. Extract text with trafilatura
# 3. Language identification with fastText
# 4. Exact dedup with SHA-256
# 5. Near dedup with MinHash (Jaccard threshold 0.8)
# 6. Quality filtering with heuristics + perplexity
# 7. PII removal (email, phone, SSN patterns)
# 8. Tokenization and mixing
```

### FineWeb

**Penedo et al. (2024)** at Hugging Face released FineWeb, a 15T token English web dataset derived from 96 Common Crawl snapshots. FineWeb demonstrated that careful deduplication and filtering of web data alone, without curated sources like Wikipedia or books, can produce models competitive with those trained on mixed-source datasets.

The companion **FineWeb-Edu** subset used a classifier trained on educational content to extract high-quality educational text, achieving strong results on knowledge benchmarks.

### DCLM (DataComp for Language Models)

**Li et al. (2024)** introduced DCLM, applying the DataComp competition framework — originally developed for vision-language datasets — to language model pre-training. Rather than fixing the data and varying the model, DCLM fixes the model architecture and training recipe, then benchmarks different data curation strategies against each other on a standardized evaluation suite. The resulting DCLM-Baseline dataset, curated from Common Crawl using a fastText-based quality filter trained on OpenHermes 2.5 examples, produced a 7B-parameter model that matched or exceeded models trained on significantly more tokens. DCLM demonstrated that the data curation algorithm matters more than the raw data volume — a theme that connects directly to the scaling law insights discussed in [Scaling Laws](/agent/scaling-laws). The full competition framework and datasets are open-source, enabling the community to systematically compare filtering, deduplication, and mixing strategies on equal footing.

### FineWeb2

**Penedo et al. (2024)** extended FineWeb into the multilingual domain with FineWeb2, covering over 1000 languages extracted from Common Crawl. FineWeb2 applies the same rigorous deduplication and quality filtering pipeline as its English predecessor, adapted to handle the additional challenges of multilingual data: language identification accuracy degrades for low-resource languages, quality classifiers trained on English transfer poorly, and tokenization efficiency varies dramatically across scripts (see [Tokenization](/agent/tokenization) for how vocabulary design interacts with multilingual data). FineWeb2 provides per-language quality scores and deduplication metadata, making it practical to construct custom multilingual training mixtures. For many low-resource languages, FineWeb2 represents the largest curated text corpus available.

## Synthetic Data for Pre-training

The use of synthetically generated text as pre-training data has moved from experimental curiosity to mainstream practice, driven by the recognition that carefully crafted synthetic data can fill gaps that web-crawled data cannot.

### Textbook-Quality Synthetic Generation

The **Phi model family** (**Gunasekar et al., 2023; Li et al., 2023**) demonstrated that small models trained on high-quality synthetic data can dramatically outperform larger models trained on web crawls. The Phi-1 model (1.3B parameters) matched the code generation performance of models 10x its size by training on "textbook-quality" synthetic data: code exercises and explanations generated by GPT-3.5 and GPT-4 that followed a pedagogical structure — introducing concepts, providing worked examples, and building in complexity. Phi-1.5 and Phi-2 extended this approach to general reasoning, generating synthetic textbook chapters, exercises, and explanations across science, mathematics, and common-sense reasoning. The key insight is that synthetic data works not because it contains novel facts but because it presents information in a form optimized for learning — structured, progressive, and redundancy-free.

### Cosmopedia and Large-Scale Synthetic Corpora

**Ben Allal et al. (2024)** at Hugging Face released **Cosmopedia**, a 25B-token synthetic dataset generated by Mixtral-8x7B-Instruct. Cosmopedia contains synthetic textbooks, blog posts, stories, and WikiHow-style articles covering topics derived from web content seeds. The generation pipeline uses curated prompts that specify audience level (e.g., "explain to a college student"), format, and topic, then post-filters the output for quality and coherence. The resulting dataset was used to train the SmolLM model family, demonstrating competitive performance at small model sizes.

### When Synthetic Data Helps vs. Hurts

Synthetic data is not universally beneficial. Research has identified several failure modes:

- **Model collapse**: **Shumailov et al. (2024)** showed that training on model-generated text iteratively — where each generation trains the next model whose output trains the next — causes progressive degradation. The tails of the data distribution are lost first, producing increasingly bland, mode-seeking text.
- **Diversity loss**: synthetic generators tend to produce text that is more stylistically uniform than real web data. A model trained exclusively on synthetic text may lose the ability to handle the full range of natural language variation.
- **Factual confabulation**: LLMs generating training data will introduce factual errors. For domains where factual accuracy matters (science, medicine, history), synthetic data must be verified or constrained.

The emerging consensus is that synthetic data works best as a **supplement** to web-crawled data, not a replacement. It is most effective for domains where web data is scarce (mathematical reasoning, structured problem-solving) or where the pedagogical structure of the data matters more than the factual content.

## The Data Wall and Alternatives

A growing concern in the LLM community is the **data wall** — the impending exhaustion of unique, high-quality text available on the public internet.

### The Scale of the Problem

**Villalobos et al. (2024)** estimated that the stock of high-quality English text on the internet is approximately 9 trillion tokens, with total web text (including low-quality content) at roughly 50-90 trillion tokens. Frontier models trained in 2024 already consumed 15T+ tokens, and Llama 3 405B was trained on 15.6T tokens — meaning that the highest-quality web text has already been used at least once by leading labs. Extrapolating the historical growth rate of model training data suggests that unique high-quality text could be effectively exhausted by 2028, a timeline that connects directly to the compute-data tradeoffs examined in [Scaling Laws](/agent/scaling-laws).

### Multi-Epoch Training

When unique data is limited, an obvious strategy is to train on the same data multiple times. **Muennighoff et al. (2023)** systematically studied multi-epoch training and found that repeating data up to 4 epochs causes minimal degradation, but beyond that, models begin to memorize rather than generalize. The effective value of repeated data follows a roughly logarithmic decay — the second pass through the data is worth approximately 60-70% of the first, the third pass 40-50%, and so on. **Taylor et al. (2022)** in the Galactica paper trained for multiple epochs on curated scientific text and showed that when data quality is very high, more epochs can be tolerated before diminishing returns set in.

### Data Recycling and Augmentation

Several strategies extend the effective size of a fixed corpus:

- **Rephrasing and paraphrasing**: generating alternative phrasings of existing documents to create "new" training examples. This must be done carefully to avoid the model collapse dynamics described above.
- **Document-level augmentation**: reordering sections, combining passages from different documents, or creating synthetic question-answer pairs from existing text.
- **Back-translation for multilingual expansion**: translating English text into other languages and back, producing paraphrased English text and multilingual training data simultaneously.

### Beyond Text: Video and Audio as Data Sources

One path around the text data wall is to tap into the vast quantities of human knowledge encoded in video and audio. YouTube alone hosts over 800 million videos, with an estimated 10+ billion hours of spoken content — potentially trillions of tokens if transcribed. **Whisper** (**Radford et al., 2023**) demonstrated that high-quality speech-to-text models can transcribe audio at scale with low error rates. Several projects have explored using Whisper-transcribed YouTube, podcast, and lecture content as training data. The quality characteristics of transcribed speech differ from written text — it is more conversational, contains disfluencies, and represents a different distribution of topics — but it provides genuine human-generated content that is not yet exhausted.

## Multimodal Pre-training Data

As models expand beyond text to handle images, video, and audio natively, the curation of multimodal training data has become its own discipline.

### Image-Text Datasets

The earliest large-scale image-text datasets were constructed by scraping alt-text from web images. **LAION-5B** (**Schuhmann et al., 2022**) collected 5.85 billion image-text pairs from Common Crawl, filtered using CLIP similarity scores to retain pairs where the image and text were semantically related. LAION-5B enabled the training of open models like Stable Diffusion, but also raised concerns: subsequent audits found CSAM, copyrighted material, and biased content in the dataset, leading to its temporary takedown and a re-filtered release.

**DataComp** (**Gadre et al., 2024**) applied the same competition-based framework as DCLM to image-text data, providing standardized evaluation for different filtering strategies. DataComp demonstrated that aggressive CLIP-score filtering improves model quality but reduces dataset diversity, echoing the tension between quality and diversity seen in text-only data curation.

### Interleaved Multimodal Corpora

Training models that can naturally mix text and images — like GPT-4V or Gemini — requires interleaved multimodal data where images appear inline within text passages, replicating how images function in web pages, textbooks, and articles. **OBELICS** (**Laurençon et al., 2023**) extracted 141 million interleaved image-text documents from Common Crawl, preserving the spatial relationship between text and images on the original web pages. This is fundamentally harder than collecting separate image-caption pairs: the filtering pipeline must assess whether images are content-relevant (not advertisements or icons), whether the surrounding text actually references the image, and whether the document as a whole is coherent.

### Video Data

Video pre-training data adds temporal complexity. Datasets like **WebVid** (**Bain et al., 2021**) collected millions of short video clips with text descriptions, while **InternVid** (**Wang et al., 2024**) scaled to over 200 million video clips. The challenge with video data is both the storage requirements (orders of magnitude larger than text or images) and the annotation quality — automatically generated descriptions of video content are often shallow ("a person walks across a room") and miss the temporal dynamics that make video informative. Current multimodal models typically sample sparse frames from videos rather than processing full video streams, a compromise driven by computational cost. The relationship between how multimodal data is tokenized and how models process it connects to the broader tokenization challenges discussed in [Tokenization](/agent/tokenization).

## Curriculum Learning

Curriculum learning — the idea that the order in which data is presented during training matters — has shown promise in LLM pre-training.

### Data Ordering Strategies

**Bengio et al. (2009)** originally proposed curriculum learning for neural networks: start with "easy" examples and gradually increase difficulty. For LLMs, "difficulty" can be operationalized as:

- **Perplexity** under a reference model (low perplexity = easier)
- **Document length** (shorter = easier)
- **Domain complexity** (Wikipedia before academic papers)

### Phase-Based Training

A more practical form of curriculum learning is phase-based training, where the data mixture changes over the course of training:

1. **Phase 1 (80% of training)**: standard web-heavy mixture focused on broad coverage.
2. **Phase 2 (15% of training)**: increased proportion of high-quality sources (code, math, academic text).
3. **Phase 3 (5% of training, "annealing")**: highly curated, instruction-like data to improve model calibration.

**Llama 3** (**Meta, 2024**) used this approach, with an explicit annealing phase where the learning rate was decayed while training on a high-quality data subset. This improved benchmark performance significantly compared to continuing with the standard mixture.

### The Annealing Effect

The annealing phase has become a standard technique. **Blakeney et al. (2024)** showed that training on high-quality data during the final phase of pre-training, when the learning rate is being decayed, has an outsized effect on model quality. The intuition is that at low learning rates, the model makes small, precise adjustments rather than large updates, and high-quality data at this stage "polishes" the model's knowledge.

## Data Contamination and Benchmark Integrity

A persistent challenge in pre-training data curation is **benchmark contamination** — the accidental inclusion of evaluation benchmark data in the training corpus. Since training data is sourced from the web, and benchmarks are often published online, contamination is difficult to avoid entirely.

**Dodge et al. (2021)** and **Jacovi et al. (2023)** documented widespread contamination across major models and datasets. Mitigation strategies include:

- **n-gram overlap detection**: checking training data for long n-gram matches with benchmark examples
- **Canary strings**: embedding unique strings in benchmarks to detect if they appear in model outputs
- **Held-out benchmarks**: creating new benchmarks from data that post-dates the training cutoff

```python
def check_contamination(train_docs, benchmark_examples, n=13):
    """Check for n-gram overlap between training data and benchmarks."""
    # Build n-gram index from benchmark examples
    benchmark_ngrams = set()
    for example in benchmark_examples:
        tokens = example.split()
        for i in range(len(tokens) - n + 1):
            benchmark_ngrams.add(tuple(tokens[i:i+n]))

    contaminated = []
    for doc in train_docs:
        tokens = doc.split()
        for i in range(len(tokens) - n + 1):
            if tuple(tokens[i:i+n]) in benchmark_ngrams:
                contaminated.append(doc)
                break
    return contaminated
```

## Ethical and Legal Considerations

Pre-training data curation intersects with significant ethical and legal questions:

- **Copyright**: training on copyrighted text (books, news articles, code) is the subject of ongoing litigation. The legal status varies by jurisdiction and remains unsettled.
- **Personal information**: web crawls inevitably contain personally identifiable information (PII). Responsible data curation includes PII detection and removal, though perfect removal is impractical at scale.
- **Consent**: individuals whose text appears in training data generally did not consent to this use. The ethical implications are debated.
- **Bias**: web text reflects the biases of its authors and platforms. Data filtering can amplify or mitigate biases depending on the criteria used.

**Longpre et al. (2023)** in the Data Provenance Initiative documented the provenance and licensing status of 1800+ text datasets, finding significant ambiguity in licensing terms and frequent chain-of-custody issues where datasets are derived from other datasets without preserving license constraints.

## Summary and Key Takeaways

- **Data quality dominates data quantity** for pre-training effectiveness. Careful deduplication and filtering can substitute for 5-10x more raw data — a relationship formalized by the scaling laws covered in [Scaling Laws](/agent/scaling-laws).
- **Deduplication** should be multi-level: exact hash deduplication, MinHash near-deduplication, and optionally substring-level deduplication. Each removes a distinct class of redundancy.
- **Quality filtering** works best with a combination of heuristic rules, perplexity-based scoring, and classifier-based filtering. Over-filtering reduces diversity, which can hurt model generalization.
- **Causal language modeling (CLM)** is the dominant pre-training objective for decoder-only models. It is maximally data-efficient (every token provides a training signal) and naturally supports generation.
- **Data mixing ratios** significantly affect model capabilities. Code data improves general reasoning; upweighting high-quality sources improves knowledge tasks. DoReMi provides a principled approach to learning optimal mixing ratios.
- **Curriculum learning** and **annealing phases** (training on high-quality data with decaying learning rate) are now standard practices that meaningfully improve final model quality.
- Major open datasets (**The Pile, RedPajama, Dolma, FineWeb, DCLM, FineWeb2**) have made pre-training research more accessible and reproducible, though frontier models still use proprietary data.
- **Synthetic data** — particularly textbook-quality generated text — can dramatically improve data efficiency for small models, but carries risks of model collapse and diversity loss when overused.
- **The data wall** is a real constraint: unique high-quality web text may be effectively exhausted within a few years. Multi-epoch training, synthetic augmentation, and transcribed audio/video are the primary strategies for extending the data supply.
- **Multimodal pre-training data** — image-text pairs, interleaved documents, and video corpora — requires its own curation pipelines that address alignment quality, content safety, and the interaction between data format and [tokenization strategy](/agent/tokenization).
- Pre-training data quality directly determines the quality of downstream [embedding models](/agent/embedding-models), since embeddings inherit both the knowledge and the biases present in the pre-training corpus.
- **Data contamination** with benchmark data is a pervasive problem that undermines evaluation integrity. n-gram overlap detection and held-out benchmarks are partial mitigations.
- The legal and ethical landscape around training data is rapidly evolving, and responsible data curation requires attention to copyright, privacy, and bias considerations.
