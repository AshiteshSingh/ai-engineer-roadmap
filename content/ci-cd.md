# CI/CD

## The 30-Second Pitch
CI/CD is the engineering practice and toolchain that automates the integration, testing, and deployment of code changes. It solves the problem of manual, error-prone, and slow release processes by creating a reliable, repeatable pipeline. A team would pick CI/CD to increase deployment frequency, improve code quality with automated gates, reduce the "time to market" for features, and enable rapid, safe rollbacks—all of which are critical for maintaining a competitive edge and a stable product, especially in a complex, microservices-based AI stack.

## How It Actually Works
The mental model is a pipeline: a series of automated stages triggered by a code change (e.g., a git push). Each stage acts as a gate; failure stops the pipeline and alerts the team.

**Core Components & Data Flow:**
1.  **Source/Version Control (e.g., Git):** The pipeline is triggered by an event (push, PR) on a branch.
2.  **CI Server/Pipeline Orchestrator (e.g., Jenkins, GitLab CI, GitHub Actions, CircleCI):** This is the brain. It fetches the code, provisions an ephemeral environment (often a container), and executes the pipeline definition (e.g., `.gitlab-ci.yml`, `Jenkinsfile`).
3.  **Build Stage:** Compiles code, installs dependencies. For our stack: `npm install` for Node.js, pulling Python packages for AI libraries.
4.  **Test Stage:** Runs automated tests. This is multi-layered:
    *   **Unit Tests:** Fast, isolated tests for functions/classes (e.g., Jest for Node, pytest for Python/LLM logic).
    *   **Integration Tests:** Tests interactions between services or with LlamaIndex/vector DBs. May require test doubles or lightweight containers.
    *   **AI/Model Validation:** Unique to this role. This could involve running a subset of evaluation datasets to ensure LLM response quality or embedding accuracy hasn't regressed beyond a threshold.
5.  **Security & Code Quality Scans (Shift-Left):** SAST (Static Application Security Testing), SCA (Software Composition Analysis for deps), and linters (ESLint, Prettier) run in parallel to tests.
6.  **Artifact Repository:** The built, tested application is packaged into an immutable artifact (e.g., a Docker image) and pushed to a registry (Amazon ECR, Azure Container Registry, Google Artifact Registry).
7.  **Deployment Stages (CD):** The artifact is deployed to environments.
    *   **Staging/Pre-Prod:** Mirrors production. Here, you run broader integration tests, performance tests, and potentially "smoke tests" with the live AI model.
    *   **Production:** The final deployment. Strategies matter:
        *   **Recreate:** Downtime. (Avoid for user-facing services).
        *   **Rolling Update:** (Kubernetes default). New pods replace old ones gradually.
        *   **Blue-Green:** Two identical environments. Switch traffic from "blue" (old) to "green" (new) instantly.
        *   **Canary:** Release to a small percentage of users/traffic first, monitor, then proceed.

```
[Developer Git Push] --> [CI Server] --> [Build & Test] --> [Package Image] --> [Push to Registry]
                                                                  |
                                                                  v
[Promote to Staging] --> [Integration/Smoke Tests] --> [Deploy to Prod (Canary)] --> [Monitor & Rollback if needed]
```

**Key Internals:** The pipeline itself is **code** (Infrastructure as Code). The orchestrator uses **executors** (shell, Docker, Kubernetes Pod) to run jobs. State (like test results, artifacts) is passed between stages. Secrets (API keys, cloud credentials) are injected via a secure vault, never hard-coded.

## Patterns You Should Know

### 1. The Multi-Stage Docker Build for AI Applications
This optimizes the final image size and separates build dependencies from runtime dependencies, crucial for large AI libraries.

```dockerfile
# Stage 1: Builder
FROM python:3.11-slim as builder
WORKDIR /app
COPY requirements.txt .
# Install build deps and packages; torch/transformers can be huge
RUN pip install --user --no-cache-dir -r requirements.txt

# Stage 2: Runtime
FROM python:3.11-slim
WORKDIR /app
# Copy only the installed packages from the builder stage
COPY --from=builder /root/.local /root/.local
# Ensure scripts in .local are usable
ENV PATH=/root/.local/bin:$PATH
# Copy application code
COPY . .
# Your app might use Node.js as well; you could add a multi-arch pattern here
CMD ["python", "app.py"]
```

### 2. Environment-Specific Configuration with Pipeline Variables
Never bake configs into the image. Use the CI/CD system's variables and a template.

```yaml
# .gitlab-ci.yml snippet
deploy:staging:
  stage: deploy
  script:
    # Use CI variables to populate a config template
    - envsubst < config.template.json > config.json
    - kubectl apply -f kubernetes/deployment.yaml
  variables:
    ENVIRONMENT: "staging"
    LLM_API_ENDPOINT: "https://staging-llm.example.com"
    VECTOR_DB_HOST: "staging-pinecone-host"
  only:
    - main

deploy:production:
  stage: deploy
  script: ...
  variables:
    ENVIRONMENT: "production"
    LLM_API_ENDPOINT: "https://llm.example.com" # Or use Azure OpenAI, etc.
    VECTOR_DB_HOST: "$PRODUCTION_VECTOR_DB_HOST" # Secret variable
  only:
    - tags # Deploy only on version tags
```

### 3. Parallelized Testing for Speed
Run your unit, integration, and linting jobs in parallel to get fast feedback.

```yaml
# GitHub Actions workflow snippet
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
  integration-tests:
    runs-on: ubuntu-latest
    needs: [unit-tests] # Run after unit tests pass
    services:
      postgres: ... # Spin up a test DB
    steps:
      - uses: actions/checkout@v4
      - run: docker-compose -f docker-compose.test.yml up --exit-code-from app
  lint-and-scan:
    runs-on: ubuntu-latest
    steps: # Runs in parallel with unit-tests
      - uses: actions/checkout@v4
      - run: npm run lint
      - uses: snyk/actions/node@master
        with:
          args: --severity-threshold=high
```

### 4. Canary Deployment with Kubernetes and Service Mesh
Automate a gradual, monitored rollout. This is critical for AI services where model changes can have unpredictable effects.

```yaml
# Kubernetes Deployment with canary steps (conceptual, often managed by Flagger or Argo Rollouts)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-query-service-canary
spec:
  replicas: 2 # Start with 2 pods of the new version
  selector: { ... }
  template:
    spec:
      containers:
      - name: app
        image: my-registry/ai-service:v2.1.0 # The new candidate
---
# The Service's selector might initially point to both `app: ai-query-service` and `version: v2.0.0`.
# A canary controller would gradually shift traffic from the main Deployment to this canary Deployment based on metrics (latency, error rate, custom LLM eval scores).
```

### 5. Pipeline as Code for Multi-Cloud
Abstract your pipeline definition to be portable across AWS, Azure, and GCP.

```groovy
// Jenkinsfile (Declarative Pipeline) using shared libraries
pipeline {
  agent any
  parameters {
    choice(name: 'CLOUD_PROVIDER', choices: ['aws', 'azure', 'gcp'], description: 'Target cloud')
  }
  stages {
    stage('Build & Test') {
      steps { script { buildTestSteps() } } // Shared Lib
    }
    stage('Deploy to Cloud') {
      steps {
        script {
          if (params.CLOUD_PROVIDER == 'aws') {
            deployToEKS() // Shared Lib function for AWS EKS
          } else if (params.CLOUD_PROVIDER == 'azure') {
            deployToAKS() // Shared Lib function for Azure AKS
          }
        }
      }
    }
  }
}
```

## What Interviewers Actually Ask

**Q: Explain the difference between CI and CD.**
**A:** Continuous Integration (CI) is the practice of automatically building and testing every code change. Its goal is to find integration errors fast. Continuous Delivery (CD) extends CI by automatically preparing every change for a release to production. Continuous Deployment goes a step further by automatically releasing every passing change to production. CD is about capability; Continuous Deployment is about automation.

**Q: How would you design a CI/CD pipeline for an AI/ML service that uses LlamaIndex?**
**A:** Beyond standard build/test, I'd add specific AI validation stages. After unit tests, I'd run a lightweight "model evaluation" job using a curated test dataset to check retrieval accuracy or response quality against the updated LlamaIndex logic. This might compare embeddings or query results. I'd also version the index/vector store itself as a separate artifact. The deployment would be canary, with monitoring for novel failure modes like a spike in LLM API latency or cost.

**Q: When would you choose a managed CI/CD service (like GitHub Actions) over a self-hosted one (like Jenkins)?**
**A:** I'd choose a managed service for faster setup, lower maintenance, and native integration with its ecosystem (e.g., GitHub Actions for GitHub repos). I'd choose self-hosted Jenkins for maximum control, complex custom workflows, security requirements that demand on-premise agents, or when needing a single pane of glass for pipelines across multiple git providers or legacy systems.

**Q: You see a flaky test that fails randomly in the CI pipeline. How do you troubleshoot it?**
**A:** First, I'd isolate the test and run it locally in a loop to confirm flakiness. Then, I'd check for dependencies: external APIs (LLM calls), database state, concurrency issues, or unmanaged side effects. I'd examine the CI environment: are resources (CPU/memory) consistent? I'd add better logging and potentially use the CI's ability to retry the failed step a limited number times as a short-term mitigation while root cause is found.

**Q: How do you manage secrets (API keys, database passwords) in a CI/CD pipeline?**
**A:** Never store them in code or pipeline files. Use the CI/CD platform's secret store (GitHub Secrets, GitLab CI Variables, Jenkins Credentials). Secrets are injected as environment variables or files at runtime. For Kubernetes deployments, I use a secret management tool like HashiCorp Vault or cloud-native solutions (AWS Secrets Manager) with an sidecar injector, and the CI pipeline would have the limited, temporary credentials needed to access those stores.

**Q: Describe a blue-green deployment. What are its pros and cons vs. a canary release?**
**A:** Blue-green maintains two identical production environments. Traffic is routed entirely from "blue" (old) to "green" (new) in a switch. Pros: Instant, simple rollback (switch back). Cons: Requires double the infrastructure cost during cutover, and the release is "all-or-nothing." Canary releases to a small subset of users first. Pros: Allows for real-world validation with minimal impact, enables metrics-based automated promotion. Cons: More complex to set up (needs traffic routing logic) and observability. For an AI service, I'd start with canary to mitigate model change risks.

**Q: How does CI/CD fit into a microservices architecture?**
**A:** Each microservice should have its own independent CI/CD pipeline, enabling teams to deploy autonomously. This requires clear API contracts and versioning. A challenge is integration testing; I'd use a "consumer-driven contract testing" pattern (e.g., Pact) in the pipeline to verify compatibility without full end-to-end environments. For coordinated releases of multiple services, you might have a higher-level "umbrella" pipeline or use feature flags.

**Q: What metrics do you monitor to know if your CI/CD pipeline is healthy?**
**A:** Lead Time (commit to deploy), Deployment Frequency, Change Failure Rate, and Mean Time To Recovery (MTTR). At a system level: Pipeline success/failure rate, average duration per stage, queue time for agents, and flaky test rate. Monitoring these tells you if you're delivering faster without sacrificing stability.

## How It Connects to This Role's Stack
*   **LlamaIndex/Node.js:** The pipeline builds the Node.js service and its Python dependencies for LlamaIndex in a single, versioned Docker image. The test stage includes validation of the retrieval-augmented generation (RAG) logic.
*   **AWS/Azure/GCP:** The pipeline uses cloud-specific SDKs and CLIs for deployment. It might build once and deploy to multiple clouds using parameterized jobs, storing artifacts in the respective cloud's container registry (ECR, ACR, GAR).
*   **Microservices:** Each service (e.g., user auth, query processing, embedding service) has its own pipeline, promoting loose coupling. Shared libraries ensure consistency.
*   **Docker:** The fundamental packaging format. The pipeline builds, tags (`commit-sha`, `latest`), and pushes images.
*   **Kubernetes:** The primary deployment target. The pipeline's final step is often `kubectl apply` or `helm upgrade` with the new image tag. It integrates with K8s for canary deployments and rollbacks.

For a **Senior Full Stack AI Engineer**, the nuance is ensuring the pipeline validates the *AI-specific* quality: model performance, cost, and ethical guardrails, not just that the code compiles.

## Red Flags to Avoid
*   **"We run all tests in one job."** Shows no understanding of parallelization for speed.
*   **"We store configs and secrets in the Docker image."** Major security and configurability anti-pattern.
*   **"Our pipeline is configured only through the UI (e.g., Jenkins clicks)."** Not treating pipeline as code is a maintainability disaster.
*   **"We deploy straight to production on every merge to main."** This is Continuous Deployment, which can be valid, but saying it without mentioning robust testing, feature flags, and monitoring suggests naivety about risk.
*   **"CI/CD is just about running tests automatically."** Underestimates the "CD" part—the delivery and deployment automation.
*   **"We don't need to run tests for AI components; we just trust the model."** Fails to recognize that the code around the model (prompts, retrieval logic, data preprocessing) is just as bug-prone.
*   **"Rollback means checking out old code and re-running the pipeline."** Slow and error-prone. The correct answer involves immutable artifacts and switching traffic or updating a K8s manifest to the previous, already-built image tag.