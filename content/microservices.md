# Microservices

## The 30-Second Pitch
Microservices is an architectural style that structures an application as a collection of loosely coupled, independently deployable services, each organized around a specific business capability. It solves the problems of monolithic applications—like slow release cycles, scaling inefficiencies, and technological lock-in—by enabling teams to develop, deploy, and scale services autonomously. A team would pick it over a monolith when they need faster innovation, independent scaling of components (crucial for AI workloads with varying resource needs), and the ability to use different tech stacks per service, but they must be prepared for the operational complexity of distributed systems.

## How It Actually Works
The core mental model is **distributed bounded contexts**. Instead of a single codebase with a shared database, you have multiple services, each with its own data store and API. Communication happens over the network via lightweight protocols (HTTP/REST, gRPC, or async messaging). A critical internal component is the **service mesh** (like Istio or Linkerd), which handles cross-cutting concerns like service discovery, load balancing, and resilience (retries, circuit breakers) at the infrastructure layer, separate from your business logic.

Here's a simplified view of the data flow for a user request in a system with an API Gateway:
```
[Client] -> [API Gateway / Ingress] -> [Service Discovery (e.g., Consul, Eureka)] -> [Target Microservice (e.g., User Service)]
                                                                      |
                                                                      v
                                                             [Private Database/Vector DB for that Service]
```
The API Gateway acts as a single entry point, routing requests, handling authentication, and potentially aggregating responses. Each service is typically packaged as a container (Docker) and orchestrated by a platform like Kubernetes, which manages deployment, scaling, and networking. For state, services follow the **Database-per-Service** pattern, which ensures loose coupling but introduces challenges in data consistency, often solved via **Saga Pattern** (event-driven choreography or orchestration) for transactions or eventual consistency.

## Patterns You Should Know

### 1. API Gateway Pattern (with BFF - Backend for Frontend)
In an AI-heavy stack, you might have a BFF service tailored for your AI agent's interface, aggregating data from multiple downstream services (user, document, inference).
```javascript
// Node.js BFF Service snippet using Express
const express = require('express');
const axios = require('axios'); // For inter-service calls
const app = express();

app.get('/ai-agent/context/:userId', async (req, res) => {
  try {
    // Concurrently fetch data from bounded contexts
    const [userProfile, userDocuments] = await Promise.all([
      axios.get(`http://user-service/users/${req.params.userId}`),
      axios.get(`http://document-service/documents?owner=${req.params.userId}`)
    ]);

    // Structure data specifically for the AI Agent's expected context
    const agentContext = {
      user: userProfile.data,
      recentDocs: userDocuments.data.map(doc => ({ id: doc.id, title: doc.title })),
      systemPrompt: "You are assisting a user with their documents."
    };
    res.json(agentContext);
  } catch (error) {
    // Implement circuit breaker logic here in production
    res.status(502).json({ error: 'Failed to aggregate upstream services' });
  }
});
```

### 2. Event-Driven Communication for Loose Coupling
Instead of synchronous HTTP calls, services publish events when their state changes. This is critical for building reactive AI pipelines where one service's output (e.g., "document ingested") triggers another (e.g., "generate embeddings").
```javascript
// Using a message broker like AWS SNS/SQS or Azure Service Bus
const { publishToEventBus } = require('./eventBus'); // Your abstraction

class DocumentService {
  async processUpload(file) {
    // ... save to blob storage, create DB record
    const documentRecord = await db.documents.create({ /* ... */ });

    // Publish an event, not caring who listens
    await publishToEventBus('DocumentIngested', {
      documentId: documentRecord.id,
      location: documentRecord.storageUrl,
      ownerId: documentRecord.userId,
      timestamp: new Date().toISOString()
    });
    return documentRecord;
  }
}

// A separate Embedding Service subscribes to that event
class EmbeddingService {
  async onDocumentIngested(event) {
    const { documentId, location } = event;
    const text = await fetchTextFromStorage(location);
    const embeddings = await callEmbeddingModel(text); // e.g., OpenAI, Cohere
    await vectorDB.upsert(documentId, embeddings);
    // Could then publish 'DocumentEmbedded' event
  }
}
```

### 3. Service Discovery & Client-Side Load Balancing
Services need to find each other in a dynamic environment where instances scale up/down. While Kubernetes provides DNS, a robust pattern uses a registry.
```javascript
// Pattern using a library like Netflix Eureka (Java/Spring common) or Consul.
// In Node, you might use `consul` npm package or rely on K8s services.
const Consul = require('consul');

class ServiceDiscoveryClient {
  constructor() {
    this.consul = new Consul({ host: 'consul-server' });
    this.serviceCache = new Map();
  }

  async getServiceUrl(serviceName) {
    // Check cache first
    if (this.serviceCache.has(serviceName)) {
      const instances = this.serviceCache.get(serviceName);
      // Simple round-robin client-side load balancing
      const instance = instances[Math.floor(Math.random() * instances.length)];
      return `http://${instance.Address}:${instance.Port}`;
    }
    // Query Consul for healthy instances
    const instances = await this.consul.health.service({
      service: serviceName,
      passing: true
    });
    this.serviceCache.set(serviceName, instances);
    // ... update cache periodically or watch for changes
    return this.getServiceUrl(serviceName); // recursive call with now-populated cache
  }
}

// Usage in another service
const discovery = new ServiceDiscoveryClient();
const userServiceUrl = await discovery.getServiceUrl('user-service');
const response = await axios.get(`${userServiceUrl}/users/123`);
```

### 4. Circuit Breaker Pattern for Resilience
Prevent a cascade failure when a downstream service is unhealthy. Libraries like `opossum` or `resilience4j` implement this.
```javascript
const CircuitBreaker = require('opossum');

const breakerOptions = {
  timeout: 3000, // Fail if no response in 3s
  errorThresholdPercentage: 50, // Trip after 50% errors
  resetTimeout: 30000 // Wait 30s before trying again
};

const callExternalService = async (url) => {
  const response = await axios.get(url);
  return response.data;
};

const breaker = new CircuitBreaker(callExternalService, breakerOptions);

// Fire the circuit breaker
try {
  const result = await breaker.fire('http://llamaindex-service/query');
  console.log('Success:', result);
} catch (error) {
  // Handle the error or provide a fallback
  if (breaker.opened) {
    console.error('Circuit is OPEN. Using fallback data.');
    return getCachedFallbackData();
  }
  console.error('Request failed:', error.message);
}
```

### 5. Distributed Tracing for Observability
In a mesh of AI services (LLM calls, embedding, vector search), tracing is non-negotiable to debug latency.
```javascript
// Using OpenTelemetry with Node.js
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new JaegerExporter()));
provider.register();

// This automatically instruments HTTP calls. In your route handler:
app.post('/generate', async (req, res) => {
  const tracer = trace.getTracer('ai-orchestrator');
  const span = tracer.startSpan('generate-response');
  span.setAttribute('user.id', req.user.id);
  span.setAttribute('llm.model', 'gpt-4');

  try {
    const response = await callLLM(req.body.prompt); // This child call will be auto-traced if instrumented
    span.setStatus({ code: SpanStatusCode.OK });
    res.json({ response });
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    res.status(500).send();
  } finally {
    span.end();
  }
});
```

## What Interviewers Actually Ask

**Q: Explain the trade-offs between synchronous HTTP/REST and asynchronous event-driven communication between microservices.**
**A:** Synchronous HTTP (like REST or gRPC) is simpler, provides immediate feedback, and fits request/response flows, but it creates tight temporal coupling—if the downstream service is slow or down, the caller blocks or fails. Asynchronous messaging (via Kafka, SQS) decouples services in time, improving resilience and scalability, and enables event-driven architectures. The trade-off is complexity: you now deal with message ordering, idempotency, and eventual consistency. For an AI pipeline, use sync for real-time queries to an LLM, but async for background tasks like generating embeddings after a document upload.

**Q: How do you handle data consistency across multiple services, each with its own database?**
**A:** You abandon distributed ACID transactions. Instead, you embrace eventual consistency and use patterns like the Saga Pattern. For example, in a "user upgrade" saga: 1) Order Service places an order in a "pending" state and emits an event. 2) Payment Service listens, charges the card, and emits a "payment completed" event. 3) Order Service updates the order to "confirmed." If any step fails, you run compensating transactions (e.g., refund). Alternatively, use the Outbox Pattern to reliably publish events from within a database transaction.

**Q: You see high latency in an API endpoint that calls three other microservices. How do you diagnose it?**
**A:** First, I'd check distributed tracing (e.g., Jaeger traces) to see which service or network hop is the bottleneck. Then, I'd examine metrics for each service: CPU, memory, and database query latency. I'd also check for synchronous, sequential calls that could be made concurrent using `Promise.all` or similar. In an AI context, a common culprit is a slow call to an external LLM API or a vector database query that's scanning too many dimensions. Implementing timeouts and circuit breakers at the caller can prevent the cascade.

**Q: When would you NOT choose a microservices architecture?**
**A:** Don't choose microservices for a small team building a new, unproven product (startup phase). The operational overhead (monitoring, deployment, testing) will slow you down. Stick with a modular monolith until your bounded contexts are well-defined and you have a clear need for independent scaling or deployment. Also, avoid it if you have strict, complex transactional requirements that are hard to split—sometimes a monolith with a single database is simpler.

**Q: How does an API Gateway differ from a Service Mesh like Istio?**
**A:** An API Gateway is a north-south traffic controller, handling external client requests (auth, routing, rate limiting). A Service Mesh is an east-west traffic controller, managing communication *between* internal services (retries, circuit breaking, mTLS). They are complementary. In a typical setup, external traffic hits the API Gateway, which then routes to a fronting service inside the mesh, which then communicates with other services via the mesh's sidecar proxies.

**Q: How would you deploy a machine learning model as a microservice?**
**A:** Package the model and its inference code into a container (Docker). The service exposes a well-defined REST or gRPC endpoint (e.g., `/predict`). Use a model registry (like MLflow) to version models. The deployment pipeline (CI/CD) would fetch the new model version, build the container, and roll it out via Kubernetes (using a rolling update strategy). For performance, consider a sidecar pattern where a dedicated "model server" (like TorchServe or Triton) runs alongside your application container, or use serverless inference (AWS SageMaker Endpoints) and treat it as an external service.

**Q: How do you manage configuration and secrets across dozens of microservices?**
**A:** Avoid baking config into container images. Use environment variables for non-secret config, injected at runtime by Kubernetes (ConfigMaps). For secrets (API keys, DB passwords), use a dedicated secret manager (AWS Secrets Manager, HashiCorp Vault) and mount them as volumes or inject as env vars via Kubernetes Secrets (though base64 encoding is not encryption). For dynamic config, consider a configuration service that services can query, but keep it simple—too much centralization reintroduces coupling.

**Q: How does the microservices pattern fit with serverless functions (AWS Lambda, Azure Functions)?**
**A:** Serverless functions can be considered "nanoservices"—they take single responsibility to an extreme. They are great for event-driven, glue-logic microservices (processing a file upload, reacting to a message). However, for core, always-on business services with complex logic and state, traditional containerized microservices offer more control over runtime, performance, and networking. A hybrid approach is common: containers for core services, functions for edge logic.

## How It Connects to This Role's Stack
As a Senior Full Stack AI Engineer, microservices are the backbone for building scalable, maintainable AI applications. **LlamaIndex** would likely be encapsulated within a "Retrieval Service" that handles document ingestion, chunking, and vector store updates, exposing a query endpoint. This service would consume events from a "Document Service" and publish events when embeddings are ready. **Node.js** is a prime choice for building lightweight, high-I/O API gateways and BFFs for your AI agents. On **AWS/Azure/GCP**, you'd leverage managed services to reduce operational load: AWS ECS/EKS for orchestration, SQS/SNS for messaging, and SageMaker/Bedrock endpoints for inference. **CI/CD** pipelines become critical, with each service having its own build/test/deploy pipeline, possibly using GitOps (ArgoCD). **Docker** containers standardize the packaging of diverse components (Python for ML, Node for API). **Kubernetes** is the de facto platform for orchestrating these containers, providing service discovery (K8s Services), load balancing, and scaling (HPA) which is essential for AI workloads that can be bursty (e.g., many simultaneous LLM requests).

## Red Flags to Avoid
*   **"We should break our monolith into microservices because they're cool."** Always tie the decision to business or technical drivers: independent scaling, team autonomy, or technology heterogeneity.
*   **Ignoring the network.** Saying "it's just like calling a function" underestimates latency, partial failures, and the need for retries, timeouts, and circuit breakers.
*   **Creating distributed monoliths.** This happens when services are too tightly coupled (chatty synchronous calls, shared databases). Services should be loosely coupled and communicate via well-defined APIs or events.
*   **Underestimating operational complexity.** Not mentioning monitoring (metrics, logs, traces), deployment automation, or configuration management shows a lack of production experience.
*   **Forgetting about data.** Not having a strategy for cross-service queries or transactions (Saga, CQRS) is a major gap. Also, suggesting a single shared database for all services is anathema to the pattern.
*   **Over-engineering for a small team.** Advocating for a full-blown microservices architecture for a 3-person startup project is a red flag for misaligned priorities.
*   **Not considering the AI/ML lifecycle.** Treating an ML model as a static artifact in a service. In reality, you need to consider model versioning, A/B testing, rollback, and data drift detection as part of the service design.