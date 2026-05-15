# AI Governance: Compliance, Auditing & Risk Management

The rapid deployment of large language models into high-stakes domains has outpaced the regulatory frameworks designed to govern them. AI governance -- the policies, processes, and technical controls that ensure AI systems are developed and deployed responsibly -- is no longer optional for engineering teams. This article examines the emerging regulatory landscape, practical frameworks for AI risk assessment and auditing, and the engineering practices required to build compliant, accountable AI systems.

## TL;DR

- The EU AI Act is the world's first comprehensive AI regulation, using a risk-based tier system with enforcement deadlines from February 2025 through August 2027.
- Model cards and system cards are both communication tools and compliance artifacts — maintain them as living documents alongside code.
- Audit trails must be immutable and capture the full decision pipeline: inputs (or hashes), model version, retrieved context, outputs, and safety check results.
- ISO 42001 provides a certifiable AI management system standard that maps to multiple regulations and is becoming a procurement prerequisite.
- The OWASP LLM Top 10 offers a security checklist covering prompt injection, data poisoning, excessive agency, and seven other critical risk categories.

## The Regulatory Landscape

### The EU AI Act

The European Union's AI Act, which entered into force in August 2024, is the world's first comprehensive AI regulation. It establishes a risk-based classification framework that directly impacts how AI systems must be built, tested, and deployed.

**Unacceptable Risk (Prohibited)**: AI systems that pose a clear threat to safety, livelihoods, or rights are banned outright. This includes social scoring by governments, real-time biometric identification in public spaces (with limited exceptions), and manipulation techniques that exploit vulnerabilities.

**High Risk**: AI systems used in critical domains must meet stringent requirements. These domains include employment and worker management (resume screening, performance evaluation), education (automated grading, admissions), essential private and public services (credit scoring, insurance), law enforcement (predictive policing, evidence evaluation), and migration and border control (visa assessment, risk profiling).

High-risk systems must comply with requirements for risk management systems, data governance, technical documentation, record-keeping, transparency, human oversight, accuracy, robustness, and cybersecurity.

**Limited Risk**: Systems with specific transparency obligations, primarily chatbots and deepfake generators that must disclose their AI nature.

**Minimal Risk**: Most AI systems, including spam filters and AI-enabled video games, face no specific requirements beyond existing law.

### Enforcement Timeline and Practical Compliance Steps

The EU AI Act follows a phased enforcement schedule that engineering teams must plan around:

- **February 2025**: Prohibitions on unacceptable-risk AI systems take effect (social scoring, manipulative techniques, untargeted facial recognition database scraping).
- **August 2025**: Obligations for general-purpose AI (GPAI) models become enforceable, including transparency requirements and systemic risk assessments for the most capable models.
- **August 2026**: The full set of requirements for high-risk AI systems kicks in -- risk management, data governance, technical documentation, logging, human oversight, accuracy, and robustness.
- **August 2027**: Extended deadline for high-risk AI systems that are safety components of products already regulated under existing EU sectoral legislation (medical devices, automotive, aviation).

For engineering teams, practical compliance steps include:

- Conduct an internal AI system inventory to classify each system by risk tier.
- Establish a conformity assessment process for high-risk systems (self-assessment for most, third-party audit for biometric systems).
- Implement the required logging infrastructure well before the August 2026 deadline.
- Designate an authorized representative if operating from outside the EU.
- Budget for compliance — penalties reach up to 35 million EUR or 7% of global annual turnover for prohibited practices, and up to 15 million EUR or 3% for other violations.

> **Note:** The August 2026 deadline for full high-risk system compliance is closer than it appears. Logging infrastructure and conformity assessments take months to implement correctly — start now.

### Engineering Implications of the EU AI Act

For engineering teams building LLM applications, the EU AI Act imposes concrete requirements:

```python
class EUAIActCompliance:
    """Technical requirements for high-risk AI systems under EU AI Act."""

    REQUIRED_DOCUMENTATION = [
        "system_description",        # General description of the AI system
        "design_specifications",      # Design and development methodology
        "training_data_description",  # Description of training datasets
        "validation_testing",         # Validation and testing procedures
        "risk_management_measures",   # Risk management measures adopted
        "performance_metrics",        # Accuracy and robustness metrics
        "human_oversight_measures",   # How human oversight is implemented
        "expected_lifetime",          # Expected lifetime and maintenance
    ]

    LOGGING_REQUIREMENTS = {
        "input_data": True,           # Log inputs (or hashes for privacy)
        "output_data": True,          # Log outputs
        "model_version": True,        # Which model version produced output
        "timestamp": True,            # When inference occurred
        "confidence_scores": True,    # Model confidence metrics
        "human_override": True,       # Whether human overrode the output
        "data_retention_period": "as specified by deployer, minimum for "
                                 "regulatory purposes",
    }
```

### US Executive Order on AI Safety

Executive Order 14110, signed in October 2023, established reporting requirements for frontier AI models. Companies training models using more than 10^26 FLOPs must report safety testing results to the government. The order also directs agencies to develop AI risk standards, though its long-term implementation depends on political continuity.

### Other Regulatory Developments

China's AI regulations require algorithmic recommendation transparency, deepfake labeling, and government approval for generative AI services. Canada's proposed Artificial Intelligence and Data Act (AIDA) focuses on high-impact systems with requirements similar to the EU AI Act but with a lighter enforcement framework. Brazil's AI Act proposal follows the EU risk-based approach while adding provisions specific to the Brazilian context.

## Model Cards and Documentation

Model cards, introduced by Mitchell et al. (2019) in "Model Cards for Model Reporting," provide a standardized framework for documenting AI models. They serve as both a communication tool and a compliance artifact.

### Model Card Structure

```yaml
model_card:
  model_details:
    name: "CustomerAssist-v3"
    version: "3.2.1"
    type: "Fine-tuned LLM for customer service"
    base_model: "Llama-3-70B"
    training_date: "2025-09-15"
    developers: "AI Platform Team"
    license: "Internal use only"

  intended_use:
    primary_uses:
      - "Automated customer support for product inquiries"
      - "Order status checking and basic troubleshooting"
    out_of_scope_uses:
      - "Medical or health advice"
      - "Financial investment recommendations"
      - "Legal guidance"
      - "Decisions affecting employment or credit"
    target_users:
      - "Customer service platform operators"
      - "End users via chat interface"

  training_data:
    datasets:
      - name: "internal_support_logs"
        size: "2.4M conversations"
        date_range: "2022-01 to 2025-06"
        preprocessing: "PII removed, quality filtered"
      - name: "product_documentation"
        size: "50K documents"
        preprocessing: "Chunked, deduplicated"
    known_biases:
      - "English-language dominant (85% of training data)"
      - "Overrepresents North American customer patterns"
      - "Product categories unevenly represented"

  performance_metrics:
    task_accuracy:
      overall: 0.89
      by_category:
        billing: 0.92
        technical: 0.85
        returns: 0.91
    fairness_metrics:
      demographic_parity_ratio: 0.94
      equalized_odds_ratio: 0.91
    safety_metrics:
      toxicity_rate: 0.001
      hallucination_rate: 0.03
      refusal_rate: 0.05

  limitations:
    - "Cannot access real-time inventory or order systems without API tools"
    - "May hallucinate product specifications for recently launched products"
    - "Lower accuracy on multi-language queries"
    - "Not tested for accessibility compliance (screen reader compatibility)"

  ethical_considerations:
    - "Automated responses may lack empathy in sensitive situations"
    - "Model may perpetuate biases in historical support interactions"
    - "Customer data privacy requires careful context management"
```

### System Cards

For deployed AI systems (as opposed to standalone models), system cards extend model cards to include the full deployment context: infrastructure, guardrails, monitoring, human oversight mechanisms, and incident response procedures. Anthropic publishes system cards for Claude models, providing a reference template for the industry.

## AI Risk Assessment Frameworks

### NIST AI Risk Management Framework

The National Institute of Standards and Technology (NIST) AI RMF, released in January 2023, provides a voluntary framework organized around four functions: Govern, Map, Measure, and Manage.

**Govern**: Establishing organizational AI risk governance structures. This includes defining roles and responsibilities, setting risk tolerance levels, and creating policies for AI development and deployment.

**Map**: Understanding the context in which AI systems operate. This involves identifying stakeholders, mapping potential impacts, and characterizing the AI system's technical properties.

**Measure**: Quantifying AI risks through testing, evaluation, verification, and validation (TEVV). This includes bias testing, robustness evaluation, and performance benchmarking.

**Manage**: Implementing controls to address identified risks. This includes technical mitigations, organizational processes, and monitoring systems.

### Practical Risk Assessment

A practical risk assessment for an LLM deployment involves systematic evaluation across multiple dimensions:

```python
class AIRiskAssessment:
    def __init__(self, system_name: str):
        self.system_name = system_name
        self.risks = []

    def assess_risk(
        self,
        category: str,
        description: str,
        likelihood: int,  # 1-5
        impact: int,       # 1-5
        controls: list[str],
        residual_likelihood: int,
        residual_impact: int,
    ) -> dict:
        inherent_risk = likelihood * impact
        residual_risk = residual_likelihood * residual_impact

        risk_entry = {
            "category": category,
            "description": description,
            "inherent_risk": {
                "likelihood": likelihood,
                "impact": impact,
                "score": inherent_risk,
                "level": self._risk_level(inherent_risk),
            },
            "controls": controls,
            "residual_risk": {
                "likelihood": residual_likelihood,
                "impact": residual_impact,
                "score": residual_risk,
                "level": self._risk_level(residual_risk),
            },
        }
        self.risks.append(risk_entry)
        return risk_entry

    def _risk_level(self, score: int) -> str:
        if score >= 20:
            return "critical"
        elif score >= 12:
            return "high"
        elif score >= 6:
            return "medium"
        return "low"
```

A typical assessment might include risks such as:

| Category | Risk | Inherent | Controls | Residual |
|----------|------|----------|----------|----------|
| Accuracy | Hallucinated information leads to wrong decisions | High (4x4=16) | RAG grounding, citation verification | Medium (2x4=8) |
| Bias | Discriminatory outputs in hiring context | Critical (5x5=25) | Fairness testing, human review | High (3x4=12) |
| Privacy | PII leakage in model outputs | High (3x5=15) | PII detection filter, data minimization | Medium (2x3=6) |
| Security | Prompt injection bypasses safety controls | High (4x4=16) | Input validation, output filtering | Medium (3x3=9) |
| Availability | Model service outage affects business operations | Medium (3x3=9) | Fallback systems, graceful degradation | Low (2x2=4) |

## Audit Trails for AI Systems

Auditability requires comprehensive logging that captures the full decision-making pipeline. This goes far beyond standard application logging.

### What to Log

```python
@dataclass
class AIAuditRecord:
    # Identity
    record_id: str
    timestamp: datetime
    session_id: str
    user_id: str  # Pseudonymized

    # Input
    input_hash: str  # Hash for privacy, full text in secure store
    input_classification: dict  # Topic, intent, risk level

    # Model
    model_id: str
    model_version: str
    system_prompt_hash: str
    temperature: float
    max_tokens: int

    # Context
    retrieved_documents: list[str]  # Document IDs used for RAG
    retrieval_scores: list[float]

    # Output
    output_hash: str
    output_tokens: int
    latency_ms: float

    # Safety
    guardrail_results: dict  # Which guardrails triggered
    content_classification: dict  # Toxicity, PII, etc.
    human_override: bool
    override_reason: str | None

    # Provenance
    citation_ids: list[str]
    grounding_score: float
```

### Audit Log Storage and Retention

> **Tip:** Audit logs must be stored immutably — they cannot be modified after creation. Append-only databases, write-once storage, or blockchain-based solutions provide the required immutability. Chain each record's hash to the previous one for tamper-evidence.

Audit logs must be stored immutably -- they cannot be modified after creation. Append-only databases, write-once storage, or blockchain-based solutions provide the required immutability. Retention periods depend on the regulatory context: the EU AI Act requires logs to be kept for the duration that the system is on the market plus a reasonable period, while industry-specific regulations (HIPAA, SOX) may impose longer requirements.

```python
class ImmutableAuditLog:
    def __init__(self, storage_backend):
        self.storage = storage_backend

    def write(self, record: AIAuditRecord) -> str:
        # Compute integrity hash
        record_bytes = json.dumps(asdict(record), default=str).encode()
        integrity_hash = hashlib.sha256(record_bytes).hexdigest()

        # Store with integrity hash
        stored_record = {
            **asdict(record),
            "integrity_hash": integrity_hash,
            "previous_hash": self._get_latest_hash(),
        }

        # Append-only write
        record_id = self.storage.append(stored_record)
        return record_id

    def verify_integrity(self, record_id: str) -> bool:
        """Verify record has not been tampered with."""
        record = self.storage.get(record_id)
        stored_hash = record.pop("integrity_hash")
        previous_hash = record.pop("previous_hash")
        computed_hash = hashlib.sha256(
            json.dumps(record, default=str).encode()
        ).hexdigest()
        return computed_hash == stored_hash
```

## Data Governance for LLMs

Data governance for LLM systems presents unique challenges because the model's "memory" of training data is implicit -- encoded in billions of parameters -- making traditional data governance approaches (data lineage, deletion, access control) much more complex.

### Training Data Governance

Organizations must track what data was used to train or fine-tune their models. Key practices include:

- **Data inventories**: Catalog all datasets used in training with metadata about source, consent, licensing, and content.
- **Data quality assessments**: Regularly audit training data for bias, toxicity, and accuracy.
- **Data rights management**: Establish processes for handling data subject rights (deletion requests, consent withdrawal). Note that removing specific data from a trained model requires retraining.
- **Licensing compliance**: Verify that training data usage complies with applicable licenses, especially for copyrighted material.

### Inference-Time Data Governance

Data flowing through the system at inference time requires its own governance:

```python
class InferenceDataGovernance:
    def __init__(self):
        self.data_policies = {}

    def classify_input_data(self, input_text: str) -> dict:
        """Classify input data sensitivity and applicable policies."""
        return {
            "contains_pii": self.detect_pii(input_text),
            "data_classification": self.classify_sensitivity(input_text),
            "applicable_regulations": self.identify_regulations(input_text),
            "retention_policy": self.determine_retention(input_text),
            "geographic_restrictions": self.check_data_residency(input_text),
        }

    def enforce_policies(self, classification: dict, context: dict) -> dict:
        """Apply governance policies based on classification."""
        actions = {}

        if classification["contains_pii"]:
            actions["pii_handling"] = "redact_before_logging"

        if "GDPR" in classification["applicable_regulations"]:
            actions["consent_check"] = "required"
            actions["data_minimization"] = "active"

        if classification["geographic_restrictions"]:
            actions["routing"] = "region_specific_endpoint"

        return actions
```

## Compliance Engineering

Compliance engineering translates regulatory requirements into technical specifications and automated checks. It bridges the gap between legal text and code.

### Automated Compliance Testing

```python
class ComplianceTestSuite:
    """Automated compliance tests run as part of CI/CD pipeline."""

    def test_transparency_disclosure(self, system):
        """EU AI Act Article 52: Transparency obligations."""
        response = system.generate("Hello, who are you?")
        assert "AI" in response or "artificial intelligence" in response.lower(), \
            "System must disclose AI nature in interactions"

    def test_human_oversight_capability(self, system):
        """EU AI Act Article 14: Human oversight."""
        # Verify override mechanism exists and functions
        result = system.generate_with_oversight(
            "Process this loan application",
            override_available=True
        )
        assert result.override_mechanism_active, \
            "Human override must be available for high-risk decisions"

    def test_data_minimization(self, system):
        """GDPR Article 5(1)(c): Data minimization."""
        audit_log = system.get_latest_audit_log()
        assert "raw_user_input" not in audit_log, \
            "Raw user input must not be stored in audit logs"
        assert "input_hash" in audit_log, \
            "Input hash should be stored for traceability"

    def test_right_to_explanation(self, system):
        """GDPR Article 22: Right to explanation for automated decisions."""
        result = system.generate("Why was my application rejected?")
        assert result.explanation is not None, \
            "Automated decisions must be explainable"
        assert len(result.contributing_factors) > 0, \
            "Contributing factors must be provided"
```

### Compliance as Code

Treating compliance requirements as code enables version control, automated testing, and continuous verification:

```yaml
# compliance-policies.yaml
policies:
  - id: "EUAI-ART52-TRANSPARENCY"
    regulation: "EU AI Act"
    article: "52"
    requirement: "AI systems interacting with persons must disclose AI nature"
    implementation:
      type: "system_prompt_injection"
      content: "Always identify yourself as an AI assistant."
    test: "test_transparency_disclosure"
    frequency: "every_deployment"

  - id: "EUAI-ART14-OVERSIGHT"
    regulation: "EU AI Act"
    article: "14"
    requirement: "High-risk AI systems must allow human oversight"
    implementation:
      type: "architecture_pattern"
      pattern: "human_in_the_loop"
      threshold: "all high-risk decisions"
    test: "test_human_oversight_capability"
    frequency: "every_deployment"
```

## AI Incident Response

Despite best efforts, AI systems will produce harmful outputs. A structured incident response process ensures these events are handled effectively.

### Incident Classification

```python
class AIIncident:
    SEVERITY_LEVELS = {
        "P0_critical": {
            "description": "Immediate harm to users or severe legal exposure",
            "examples": ["PII data breach", "discriminatory hiring decision",
                         "dangerous medical advice followed by user"],
            "response_time": "15 minutes",
            "escalation": "VP Engineering + Legal + Comms",
        },
        "P1_high": {
            "description": "Significant risk of harm or regulatory violation",
            "examples": ["Systematic bias detected", "safety bypass discovered",
                         "hallucinated critical information"],
            "response_time": "1 hour",
            "escalation": "Engineering Manager + Legal",
        },
        "P2_medium": {
            "description": "Moderate quality or safety issue",
            "examples": ["Increased hallucination rate", "guardrail false positives",
                         "bias drift detected"],
            "response_time": "24 hours",
            "escalation": "Team Lead",
        },
        "P3_low": {
            "description": "Minor issue requiring tracking",
            "examples": ["Edge case failure", "user complaint about tone",
                         "performance degradation"],
            "response_time": "1 week",
            "escalation": "On-call engineer",
        },
    }
```

### Response Playbook

A structured response playbook ensures consistent handling of AI incidents:

1. **Detect**: Automated monitoring flags the incident through anomaly detection, user reports, or routine audits.
2. **Assess**: Classify severity and determine scope -- how many users affected, what type of harm, ongoing or contained.
3. **Contain**: Implement immediate mitigations such as adding guardrail rules, reducing model capability, or routing to human agents.
4. **Investigate**: Analyze root cause through audit logs, model behavior analysis, and input pattern examination.
5. **Remediate**: Implement permanent fixes such as model retraining, guardrail updates, or architectural changes.
6. **Communicate**: Notify affected users, regulators (if required), and internal stakeholders.
7. **Review**: Conduct blameless post-incident review and update risk assessments, monitoring, and procedures.

## International AI Safety Institutes

As AI capabilities advance, governments have established dedicated bodies to evaluate frontier models and set safety standards. These institutes are shaping the technical benchmarks that compliance teams will ultimately need to meet.

### UK AI Safety Institute (AISI)

The UK AI Safety Institute, established in November 2023, was the first government body dedicated to evaluating advanced AI models for safety. AISI conducts pre-deployment evaluations of frontier models in collaboration with leading AI labs, developing standardized evaluation methodologies for dangerous capabilities (biosecurity, cybersecurity, persuasion, autonomy). Its evaluation framework, Inspect, is open-source and provides a reusable toolkit for building AI safety benchmarks. AISI has published results from evaluations of models from Anthropic, OpenAI, Google DeepMind, and Meta, establishing a norm of government access to pre-release models.

### US AI Safety Institute (USAISI)

Housed within the National Institute of Standards and Technology (NIST), the US AI Safety Institute was established in early 2024 to develop measurement science for AI safety. It coordinates with AISI UK under a bilateral agreement and focuses on:

- Developing evaluation standards for generative AI
- Creating guidelines for red-teaming methodologies (complementing the approaches in [Red Teaming & Adversarial Testing](/red-teaming))
- Producing technical guidance for watermarking and content provenance

USAISI works with the AI Safety Institute Consortium (AISIC), which includes over 200 organizations contributing to standards development.

### Other National Initiatives

Several additional national bodies are active:

- **Japan** established its AI Safety Institute in February 2024, focusing on evaluation standards harmonized with UK and US approaches.
- **EU** is building the European AI Office within the European Commission, which will oversee enforcement of GPAI model obligations under the AI Act.
- **Singapore's AI Verify Foundation** provides an open-source testing toolkit for AI governance.

These bodies increasingly coordinate through the International Network of AI Safety Institutes, formed at the 2024 Seoul AI Summit, aiming to develop interoperable evaluation standards that reduce the compliance burden for organizations operating across jurisdictions.

For engineering teams, the practical implication is that pre-deployment safety evaluation is becoming a baseline expectation. Teams should build evaluation pipelines that can accommodate the testing methodologies these institutes produce -- most of which align with the structured red-teaming and benchmark approaches already considered best practice.

## ISO 42001 and Enterprise AI Compliance

ISO/IEC 42001:2023 is the first international management system standard for artificial intelligence. Published in December 2023, it provides a certifiable framework for establishing, implementing, maintaining, and continually improving an AI management system (AIMS) within an organization.

### What ISO 42001 Requires

The standard follows the familiar ISO management system structure (shared with ISO 27001 for information security and ISO 9001 for quality), making it accessible to organizations already operating under those frameworks. Core requirements include:

- **AI Policy**: A documented organizational policy covering responsible AI development and use, endorsed by leadership.
- **Risk Assessment**: Systematic identification and assessment of risks related to AI systems, including impacts on individuals and groups. This aligns with the NIST AI RMF approach described earlier in this article.
- **AI Impact Assessment**: Evaluating potential impacts of AI systems on affected stakeholders before deployment.
- **Data Management**: Controls for data quality, provenance, and preparation throughout the AI lifecycle.
- **Resource and Competence Management**: Ensuring personnel involved in AI development and operations have appropriate skills and training.
- **AI System Lifecycle Processes**: Documented processes covering design, development, testing, deployment, monitoring, and retirement.
- **Third-Party and Supply Chain Management**: Governance of AI components sourced from external providers, including foundation models and API services.
- **Continuous Improvement**: Mechanisms for monitoring, measurement, analysis, and ongoing enhancement of the AIMS.

### Certification Process

Certification follows the standard ISO audit process: a Stage 1 audit reviews documentation and readiness, followed by a Stage 2 audit that evaluates implementation effectiveness. Certification is valid for three years with annual surveillance audits. Several accredited certification bodies now offer ISO 42001 audits, and early adopters report that the process takes six to twelve months from initiation to certification.

### Why Enterprises Are Pursuing It

ISO 42001 certification is becoming a competitive differentiator and a procurement prerequisite. Enterprises pursue it to:

- Demonstrate due diligence in AI governance (relevant for liability defense).
- Satisfy customer and partner requirements in regulated industries.
- Create a structured foundation that maps to multiple regulations (EU AI Act, sector-specific rules).
- Reduce audit fatigue by consolidating AI governance into a recognized international framework.

The standard does not prescribe specific technical controls, making it compatible with the technical compliance approaches described elsewhere in this article.

## Open-Source Model Governance

Open-weight models present a distinct governance challenge: once model weights are publicly released, the provider has no technical mechanism to enforce usage policies. Governance must therefore shift from provider-side controls to deployer-side responsibility.

> **Note:** Under the EU AI Act, deployers of open-source models used in high-risk applications bear the same compliance obligations as deployers of proprietary models. The openness of the model does not reduce the regulatory burden.

### The Governance Gap

With proprietary API models (GPT-4, Claude), the provider can enforce acceptable use policies, apply safety filters, and revoke access. With open-weight models (Llama, Mistral, Qwen, Gemma), the deployer assumes full responsibility for safety, compliance, and misuse prevention. This means:

- Building your own [guardrails and content filtering](/guardrails-filtering) pipeline
- Conducting your own [bias and fairness evaluations](/bias-fairness)
- Implementing your own monitoring and audit infrastructure

Under the EU AI Act, deployers of open-source models used in high-risk applications bear the same compliance obligations as deployers of proprietary models -- the openness of the model does not reduce the regulatory burden.

### License Types and Their Implications

Open-weight model licenses vary significantly in what they permit:

**Permissive Licenses**: Apache 2.0 (used by Mistral, some Google models) imposes minimal restrictions. Deployers can modify, distribute, and use the model commercially with few obligations beyond attribution and license notice preservation. This maximizes flexibility but provides no governance guardrails.

**Community and Responsible Use Licenses**: Meta's Llama Community License permits commercial use but includes an acceptable use policy that prohibits certain applications (weapons development, surveillance, generating disinformation). It also imposes a monthly active user threshold (700 million) above which a separate license is required. Google's Gemma license similarly includes prohibited use restrictions.

**Restricted and Research-Only Licenses**: Some models are released under licenses that prohibit commercial use, limit redistribution, or require specific attribution. Research-only releases (common for safety-sensitive models) restrict deployment entirely.

**Model-Specific Terms**: An increasing number of models ship with supplementary use policies or "responsible use guides" that exist alongside the formal license. These may not be legally binding in the same way but signal the developers' intent and may factor into liability assessments.

For engineering teams, the key practice is to maintain a model license registry that tracks the license, acceptable use policy, and any additional terms for every model in use -- including models embedded in dependencies or used through third-party integrations.

## OWASP LLM Top 10

The OWASP Top 10 for Large Language Model Applications provides a standardized security reference for teams building LLM-powered systems. First published in 2023 and updated for 2025, it catalogs the most critical security risks specific to LLM applications, complementing the general OWASP Top 10 for web applications.

### The Ten Risk Categories

**LLM01: Prompt Injection** -- Attackers craft inputs that override system instructions, causing the model to perform unintended actions. This includes both direct injection (malicious user input) and indirect injection (adversarial content in retrieved documents or tool outputs). Mitigation requires input validation, privilege separation, and output filtering -- the layered defense approach covered in [Guardrails & Content Filtering](/guardrails-filtering).

**LLM02: Sensitive Information Disclosure** -- The model reveals confidential data from training data, system prompts, or connected data sources. This includes PII leakage, system prompt extraction, and memorized training data regurgitation. Controls include data sanitization, output filtering, and least-privilege access to retrieval systems.

**LLM03: Supply Chain Vulnerabilities** -- Risks from third-party model components, including poisoned training data, compromised model weights, and malicious plugins or extensions. This is especially relevant for open-weight models where provenance verification is limited.

**LLM04: Data and Model Poisoning** -- Manipulation of training data or fine-tuning data to introduce backdoors, biases, or targeted misbehavior. This risk is heightened for models fine-tuned on user-generated or scraped data without rigorous quality controls.

**LLM05: Improper Output Handling** -- Downstream systems treat LLM output as trusted, enabling injection attacks (SQL injection, XSS, command injection) through model-generated content. Every LLM output must be treated as untrusted input by consuming systems.

**LLM06: Excessive Agency** -- LLM systems granted too many capabilities, permissions, or autonomy to act on behalf of users. Mitigations include least-privilege tool access, human-in-the-loop confirmation for consequential actions, and rate limiting on tool invocations.

**LLM07: System Prompt Leakage** -- Extraction of system prompts that reveal internal logic, security controls, or sensitive business rules. While not always a direct vulnerability, leaked prompts can inform more targeted attacks.

**LLM08: Vector and Embedding Weaknesses** -- Attacks targeting RAG pipelines through manipulated embeddings, adversarial document injection, or exploitation of similarity search mechanics to surface malicious content.

**LLM09: Misinformation** -- The model generates false, misleading, or fabricated information with high confidence. This covers hallucination in factual domains, fabricated citations, and confident errors in specialized fields.

**LLM10: Unbounded Consumption** -- Resource exhaustion attacks through crafted inputs that cause excessive token generation, recursive tool calls, or denial-of-service through computational overload. Mitigations include token budget limits, timeout controls, and request throttling.

Engineering teams should use the OWASP LLM Top 10 as a checklist during design reviews and [red-teaming exercises](/red-teaming), ensuring that each risk category is addressed through appropriate technical controls.

## AI Liability and Insurance

As AI systems make or influence consequential decisions, the legal frameworks for assigning liability when things go wrong are rapidly evolving. Engineering choices directly affect an organization's liability exposure.

### Emerging Liability Frameworks

**EU AI Liability Directive**: Proposed alongside the AI Act, this directive establishes rules for civil liability claims related to AI systems. It introduces a presumption of causality -- if a claimant can show that a relevant obligation was not complied with and a causal link to the AI output is reasonably likely, the burden of proof shifts to the AI provider or deployer. This makes compliance with the EU AI Act (documentation, logging, risk management) not just a regulatory requirement but a critical liability defense.

**Product Liability Implications**: The EU's revised Product Liability Directive (2024) explicitly includes software and AI systems within its scope. AI systems are treated as products, meaning strict liability applies -- claimants do not need to prove fault, only defect and damage. This has significant implications for organizations deploying AI in consumer-facing applications.

**US Liability Landscape**: The US lacks a federal AI liability framework, but existing tort law, product liability, and sector-specific regulations (FDA for medical AI, EEOC for employment AI) create a patchwork of liability exposure. Several state-level AI liability bills have been introduced, and courts are beginning to establish precedent through cases involving AI-generated content, autonomous vehicle decisions, and algorithmic discrimination.

### The AI Insurance Market

A nascent but growing AI insurance market is emerging to cover risks that traditional policies exclude or inadequately address:

- **AI-specific liability policies** covering claims arising from model errors, bias, and hallucination.
- **Algorithmic audit insurance** covering the cost of third-party audits triggered by regulatory action or suspected bias.
- **Technology errors and omissions (E&O)** policies expanded to explicitly cover AI system failures.
- **Cyber insurance endorsements** that address AI-specific attack vectors including prompt injection and model poisoning.

Insurers are increasingly requiring evidence of AI governance practices -- risk assessments, audit trails, bias testing, and incident response plans -- as underwriting prerequisites. Organizations with mature governance frameworks (such as those aligned with ISO 42001 or the NIST AI RMF) are positioned for more favorable terms.

> **Note:** Mature governance practices create a direct financial incentive: comprehensive [observability and audit trails](/observability), systematic [bias testing](/bias-fairness), and robust [guardrails](/guardrails-filtering) all reduce both the likelihood of incidents and the cost of insuring against them.

## Regulatory Landscape Overview

The global AI regulatory landscape is evolving rapidly. Engineering teams should build systems that are adaptable to changing requirements rather than optimized for any single regulation.

Key design principles for regulatory adaptability:

- **Modular safety architecture**: Guardrails and compliance controls are separate components that can be updated independently.
- **Configurable policies**: Compliance requirements are externalized as configuration rather than hardcoded.
- **Comprehensive audit logging**: Captures sufficient data to satisfy any foreseeable audit requirement.
- **Geographic awareness**: The system can adapt behavior based on the user's jurisdiction.
- **Documentation-first development**: Model cards, system cards, and risk assessments are maintained as living documents alongside code.

The trend is clear: AI regulation is becoming more specific, more enforceable, and more global. Organizations that build governance capabilities now will have a significant advantage as regulations mature.

## Related Articles

This article connects to several related topics covered elsewhere in this series:

- **[Guardrails & Content Filtering](/guardrails-filtering)** -- The technical implementation of input/output safety layers that form the runtime enforcement mechanism for many governance requirements, including EU AI Act transparency and safety obligations.
- **[Bias, Fairness & Responsible AI](/bias-fairness)** -- Detailed treatment of bias measurement and mitigation, which underpins the fairness dimensions of risk assessment and is a key area of regulatory scrutiny under both the EU AI Act and emerging US frameworks.
- **[Observability: Tracing, Logging & LLM Monitoring](/observability)** -- The infrastructure foundations for audit trails, compliance logging, and the monitoring capabilities that governance frameworks require for ongoing oversight of deployed systems.
- **[Red Teaming & Adversarial Testing](/red-teaming)** -- Pre-deployment testing methodologies that AI safety institutes are standardizing and that the OWASP LLM Top 10 recommends for validating security controls.

## Key Takeaways

- **The EU AI Act** is the most comprehensive AI regulation, with a phased enforcement timeline running from February 2025 through August 2027. Engineering teams must plan compliance work against these concrete deadlines.
- **AI Safety Institutes** in the UK, US, Japan, and the EU are converging on standardized evaluation methodologies for frontier models. Pre-deployment safety evaluation is becoming a baseline expectation.
- **ISO 42001** provides a certifiable AI management system standard that is becoming a competitive differentiator and procurement prerequisite for enterprises deploying AI.
- **Model cards and system cards** provide standardized documentation that serves both as communication tools and compliance artifacts. They should be maintained as living documents.
- **Open-weight model governance** shifts the full burden of safety, compliance, and monitoring to the deployer. License diversity (Apache 2.0, Llama Community License, restricted licenses) requires careful tracking.
- **Risk assessment** must be systematic and ongoing, covering accuracy, bias, privacy, security, and availability risks with explicit evaluation of inherent risk, controls, and residual risk.
- **The OWASP LLM Top 10** provides a standardized security checklist for LLM applications, covering prompt injection, data poisoning, excessive agency, and seven other critical risk categories.
- **Audit trails** require comprehensive, immutable logging of the entire AI decision pipeline -- inputs, model versions, retrieved context, outputs, and safety checks.
- **AI liability frameworks** are crystallizing rapidly, with the EU treating AI systems as products under strict liability. AI insurance markets are emerging and rewarding mature governance practices.
- **Data governance** for LLMs is uniquely challenging because model "memory" is implicit. Both training data and inference-time data require systematic governance.
- **Compliance engineering** translates regulatory requirements into automated tests and configuration, enabling continuous compliance verification.
- **AI incident response** requires structured severity classification, response playbooks, and blameless post-incident reviews.
- **Build for adaptability**: the regulatory landscape is evolving rapidly, so design systems with modular, configurable compliance controls rather than hardcoding for any single regulation.
