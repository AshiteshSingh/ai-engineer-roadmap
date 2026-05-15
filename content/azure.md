# Microsoft Azure

## The 30-Second Pitch
Azure is Microsoft's comprehensive cloud computing platform, providing over 200 products and services spanning Infrastructure (IaaS), Platform (PaaS), and Software (SaaS). It solves the core problem of building, deploying, and managing applications without the capital expense and operational overhead of physical data centers. A team would pick Azure over alternatives like AWS or GCP for several key reasons: deep native integration with the Microsoft ecosystem (Active Directory, .NET, Office 365, Windows Server), enterprise-grade hybrid cloud capabilities via Azure Arc, strong AI/ML tooling with Azure OpenAI Service and Azure Machine Learning, and robust compliance certifications that are critical for government and regulated industries. For a role blending AI and full-stack development, Azure offers a cohesive suite from compute (App Service, Container Instances, AKS) to AI services (Cognitive Services, Azure OpenAI) to data (Cosmos DB, Azure SQL) that can streamline development.

## How It Actually Works
Azure's architecture is built on a global network of **regions** (geographic locations) and **availability zones** (physically separate, fault-tolerant data centers within a region). The core mental model revolves around **Resource Groups**—logical containers that hold related resources for an application (like a VM, database, and networking components). All deployment and management flows through the **Azure Resource Manager (ARM)**, which is the unified control plane and API layer. You interact with ARM via the Azure Portal, CLI, PowerShell, or SDKs (like the Azure SDK for Python or JavaScript).

**Key Internals & Data Flow:**
1.  **Control Plane vs. Data Plane:** When you create a resource (e.g., `az vm create`), you talk to ARM (control plane). Once the VM exists, SSH/RDP traffic goes directly to the VM's IP (data plane).
2.  **Networking Foundation:** Every resource gets a **Virtual Network (VNet)** context. Subnets, Network Security Groups (NSGs), and Azure Firewall control traffic flow. The **Azure Load Balancer** (Layer 4) and **Application Gateway** (Layer 7, with WAF) distribute traffic.
3.  **Identity is Central:** **Azure Active Directory (Azure AD/Entra ID)** is the identity backbone. Every principal (user, service, application) gets an identity. **Managed Identities** are crucial for service-to-service auth without password management.
4.  **Storage Abstraction:** Data services build on Azure Storage—a massively scalable object store. Blob Containers, File Shares, Queues, and Tables are abstractions on top. Even Azure Disk storage for VMs uses this infrastructure.
5.  **Compute Spectrum:** Options range from fully abstracted (Serverless Functions, Logic Apps) to containerized (Azure Container Instances, Azure Kubernetes Service - AKS) to virtualized (Virtual Machines, VM Scale Sets) to platform-managed (App Service, Azure Spring Apps).

```
[Developer/DevOps]
        |
        v
[Azure Resource Manager (ARM) - Control Plane]
        |
        |---> [Compute: App Service, AKS, VMs]
        |---> [Data: Cosmos DB, SQL DB, Storage]
        |---> [AI: ML Studio, OpenAI Service]
        |---> [Networking: VNet, Load Balancer]
        |
        v
[Global Fabric Controller] - Manages physical hardware, fault domains, updates.
```

For an AI engineer, the flow for a RAG application might be: User request -> Azure Front Door (CDN/WAF) -> Containerized Node.js API in AKS -> Uses Managed Identity to call Azure OpenAI Service -> Queries vectorized data in Azure Cosmos DB for MongoDB (with native vector search) -> Returns augmented response.

## Patterns You Should Know

### 1. Secure Microservices on AKS with Managed Identities & Key Vault
Instead of embedding secrets in environment variables or code, use Azure Key Vault. Pods in AKS can use a Managed Identity (via `aad-pod-identity` or the newer Azure Workload Identity) to retrieve secrets securely at runtime.

```yaml
# azure-vote.yaml (Simplified)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: azure-vote-app
spec:
  template:
    metadata:
      labels:
        app: azure-vote-app
      annotations:
        # Annotation for Azure Workload Identity
        azure.workload.identity/client-id: $(CLIENT_ID)
    spec:
      serviceAccountName: workload-identity-sa
      containers:
      - name: azure-vote-app
        image: mcr.microsoft.com/azuredocs/azure-vote-app:v1
        env:
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: kv-secret # Populated by an init container or external-secrets operator
---
# Using the Azure SDK for Node.js in your application code
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const credential = new DefaultAzureCredential(); // Automatically uses Workload Identity
const vaultUrl = "https://my-ai-keyvault.vault.azure.net";
const client = new SecretClient(vaultUrl, credential);
const secret = await client.getSecret("database-connection-string");
```

### 2. Serverless AI Pipeline with Functions, Event Grid, and Cognitive Services
Process unstructured data (images, documents) in a scalable, event-driven manner. Upload a file to Blob Storage, which triggers an Event Grid event, which executes an Azure Function to analyze it.

```javascript
// index.js for an Azure Function (Node.js) with HTTP trigger
const { BlobServiceClient } = require("@azure/storage-blob");
const { ComputerVisionClient } = require("@azure/cognitiveservices-computervision");
const { CognitiveServicesCredentials } = require("@azure/ms-rest-azure-js");

module.exports = async function (context, eventGridEvent) {
    const blobUrl = eventGridEvent.data.url;
    
    // 1. Authenticate to Cognitive Services using Managed Identity
    const credentials = new DefaultAzureCredential();
    const cognitiveToken = await credentials.getToken("https://cognitiveservices.azure.com/.default");
    
    const computerVisionClient = new ComputerVisionClient(
        { credentials: { token: cognitiveToken.token } },
        process.env["VISION_ENDPOINT"]
    );

    // 2. Analyze the image from Blob Storage
    const analysis = await computerVisionClient.analyzeImage(blobUrl, {
        visualFeatures: ['Tags', 'Description', 'Objects']
    });

    // 3. Store results in Cosmos DB or another Blob
    context.bindings.outputDocument = {
        id: context.bindingData.id,
        blobUrl: blobUrl,
        analysis: analysis,
        processedAt: new Date().toISOString()
    };
};
```
**Function.json bindings:**
```json
{
  "bindings": [
    {
      "type": "eventGridTrigger",
      "name": "eventGridEvent",
      "direction": "in"
    },
    {
      "type": "cosmosDB",
      "name": "outputDocument",
      "databaseName": "AIDb",
      "collectionName": "ImageAnalysis",
      "createIfNotExists": true,
      "connectionStringSetting": "CosmosDBConnection",
      "direction": "out"
    }
  ]
}
```

### 3. Multi-Cloud AI Orchestration with Azure Arc & Azure Machine Learning
For a role at WWT that mentions AWS and GCP, hybrid/multi-cloud is key. Azure Arc can extend Azure's management plane to Kubernetes clusters running elsewhere. You can then use Azure Machine Learning to train or deploy models on that non-Azure infrastructure.

```python
# attach-an-eks-cluster.py
# Using Azure CLI (conceptual steps)
# 1. Connect your external Kubernetes cluster (e.g., AWS EKS) to Azure Arc
# az connectedk8s connect --name my-arc-eks --resource-group my-ai-rg --location eastus

# 2. In your Azure Machine Learning Python SDK code, define a compute target pointing to the Arc cluster
from azureml.core import Workspace, ComputeTarget
from azureml.core.compute import KubernetesCompute, ComputeInstance

ws = Workspace.from_config()

# Attach the Arc-enabled Kubernetes cluster as an AML compute target
compute_config = KubernetesCompute.attach_configuration(
    resource_id="/subscriptions/<sub-id>/resourceGroups/my-ai-rg/providers/Microsoft.Kubernetes/connectedClusters/my-arc-eks",
    namespace="default",
    default_instance_type="Standard_D3_v2"
)
arc_compute = ComputeTarget.attach(ws, 'my-arc-compute', compute_config)
arc_compute.wait_for_completion(show_output=True)

# 3. Submit a training job to this multi-cloud compute
from azureml.core import ScriptRunConfig, Environment

env = Environment.get(ws, name="AzureML-PyTorch-1.9-CU11-ubuntu18.04-Py37")
src = ScriptRunConfig(source_directory='./src',
                      script='train.py',
                      compute_target=arc_compute,
                      environment=env)
run = ws.submit(src)
```

### 4. Implementing RAG with Azure OpenAI, Cosmos DB, and LlamaIndex
This directly ties to the role's stack (LlamaIndex). Use Azure OpenAI's embedding and chat models with Cosmos DB's integrated vector search.

```python
# rag_azure.py
import os
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, StorageContext
from llama_index.vector_stores.azurecosmosmongo import AzureCosmosDBMongoDBVectorSearch
from llama_index.embeddings.azure_openai import AzureOpenAIEmbedding
from llama_index.llms.azure_openai import AzureOpenAI
from pymongo import MongoClient

# 1. Setup LLM and Embedding using Azure OpenAI
llm = AzureOpenAI(
    deployment_name="gpt-4",
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_version="2024-02-01"
)
embed_model = AzureOpenAIEmbedding(
    deployment_name="text-embedding-ada-002",
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_version="2024-02-01"
)

# 2. Connect to Azure Cosmos DB for MongoDB with vector search enabled
mongo_uri = os.getenv("COSMOS_MONGO_CONNECTION_STRING")
client = MongoClient(mongo_uri)
db = client["KnowledgeBase"]
collection = db["Documents"]

# Ensure vector index exists (done once)
collection.create_index([("contentVector", "cosmosSearch")], cosmosSearch={"kind": "vector-ivf", "numLists": 1, "similarity": "COS", "dimensions": 1536})

# 3. Create LlamaIndex vector store and index
vector_store = AzureCosmosDBMongoDBVectorSearch(
    mongo_client=client,
    db_name="KnowledgeBase",
    collection_name="Documents",
    embedding_key="contentVector",
    text_key="content",
    metadata_key="metadata",
)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

# 4. Load documents, generate embeddings, and store them
documents = SimpleDirectoryReader("./data").load_data()
index = VectorStoreIndex.from_documents(
    documents, storage_context=storage_context, embed_model=embed_model
)

# 5. Query using the index and Azure OpenAI
query_engine = index.as_query_engine(llm=llm)
response = query_engine.query("What are the security best practices for AKS?")
print(response)
```

## What Interviewers Actually Ask

**Q: Explain the difference between Azure App Service, Azure Container Instances (ACI), and Azure Kubernetes Service (AKS). When would you choose one over the others?**
**A:** App Service is a fully managed PaaS for web apps (code or containers) – use it for simple web APIs or frontends when you don't want to manage infrastructure. ACI is serverless containers for a single container instance – perfect for short-lived tasks, batch jobs, or simple microservices where you don't need orchestration. AKS is a managed Kubernetes service for container orchestration at scale – choose it for complex microservices architectures requiring service discovery, load balancing, secrets management, and automated scaling across many containers. The choice balances complexity against control and operational needs.

**Q: How does Azure implement high availability for a service like Azure SQL Database?**
**A:** Azure SQL Database uses a quorum-based commit model with a primary replica and multiple secondary replicas. Data is written to the primary and synchronously replicated to a local secondary replica within the same data center for immediate failover. For regional resilience, it can asynchronously replicate to a secondary region. The service is split across compute (SQL engine) and storage (Azure Premium Storage with triple replication). If the primary fails, the system automatically fails over to the secondary with minimal data loss (RPO < 5s, RTO < 30s for Hyperscale tier). This is abstracted from the user behind a single connection string endpoint.

**Q: When would you NOT use Azure Functions and choose a different compute option instead?**
**A:** Avoid Functions for long-running processes (over 10 minutes for consumption plan, though premium/premium plans have longer limits), stateful workflows (use Durable Functions or Logic Apps), applications with predictable, steady traffic (where an App Service Plan would be more cost-effective), or when you need fine-grained control over the underlying OS, networking, or middleware. Also, cold starts in the consumption plan can be problematic for latency-sensitive APIs.

**Q: You have a Node.js microservice in AKS that's experiencing intermittent "Timeout" errors when calling Azure Cosmos DB. What's your debugging checklist?**
**A:** First, check Cosmos DB metrics in Azure Monitor for throttling (429 status codes) – you may need to increase RU/s or optimize queries. Second, examine the AKS node and pod resource utilization (CPU/Memory) – resource starvation can cause timeouts. Third, review network latency between the AKS cluster region and the Cosmos DB region; they should be co-located. Fourth, inspect the Node.js SDK configuration – ensure `connectionPolicy` is optimized (Direct Mode for performance, Gateway Mode for firewall issues) and retry policies are appropriate. Finally, check for thread pool starvation in Node.js due to synchronous operations blocking the event loop.

**Q: How would you design a cost-monitoring and alerting strategy for a new AI workload on Azure?**
**A:** I'd start by applying resource tags (e.g., `cost-center`, `project`, `environment`) to all resources for granular cost allocation. Then, I'd use Azure Cost Management + Budgets to create a monthly budget with alerts at 50%, 90%, and 100% thresholds. For deeper analysis, I'd export cost data to a storage account and visualize it in Power BI or with the Cost Management workbook. For real-time resource-level spending, I'd configure Azure Monitor alerts on high-cost metrics (like Cosmos DB RU/s or VM uptime) and use Azure Policy to enforce SKU size limits and mandatory shutdown schedules for non-production VMs.

**Q: Explain how you would implement a CI/CD pipeline for deploying to AKS using Azure DevOps or GitHub Actions.**
**A:** The pipeline would have stages: 1) **Build**: Containerize the application with Docker, run unit tests, and push the image to Azure Container Registry (ACR). 2) **Test**: Deploy to a test AKS namespace, run integration tests. 3) **Deploy**: Use `kubectl` (with `kustomize` or `helm`) or the native `deploy-to-aks` task to apply manifests to the production cluster. Secrets would be managed via Azure Key Vault and injected using the Secrets Store CSI Driver. I'd use a blue-green or canary deployment strategy (leveraging AKS and service mesh/ingress controls) and integrate with Azure Monitor for deployment validation.

**Q: How does Azure's approach to AI/ML differ from AWS SageMaker or GCP Vertex AI?**
**A:** Azure's AI stack strongly emphasizes integration with the broader Microsoft ecosystem and responsible AI. Azure Machine Learning provides a comparable studio interface and MLOps capabilities, but its tight coupling with Azure DevOps, GitHub, and Power BI is a differentiator. The **Azure OpenAI Service** provides managed access to GPT-4, ChatGPT, and embeddings, which is a unique offering. Azure also pushes "Responsible AI" tools (interpretability, fairness, transparency) more prominently into its studio. For an enterprise deeply invested in Microsoft, the unified identity (Azure AD) and security (Purview) across data, compute, and AI is a significant advantage.

**Q: Describe a scenario where you'd use Azure Arc in a multi-cloud environment.**
**A:** A common scenario is a company with legacy applications running on VMware in their own data center, new AI workloads on Azure, and a Kubernetes-based data processing pipeline on AWS EKS for proximity to other AWS services. Azure Arc can bring all these under a single management plane. You could use Azure Policy to enforce security baselines on the EKS clusters, deploy Azure Monitor agents to collect logs and metrics from all locations, and even run Azure data services (like Azure SQL Managed Instance) on the on-premises infrastructure, all managed from the Azure Portal with a consistent governance model.

## How It Connects to This Role's Stack
As a **Senior Full Stack AI Engineer at World Wide Technology**, you're operating in a multi-cloud (AWS, GCP, Azure) and multi-tool (LlamaIndex, Node.js, Docker/K8s) environment. Azure isn't a silo; it's a piece of the puzzle.

*   **LlamaIndex & Azure:** Use Azure OpenAI Service as the LLM/embedding provider. Store and query vector embeddings efficiently using **Azure Cosmos DB for MongoDB with vector search** (as shown in Pattern 4) or **Azure AI Search** (formerly Cognitive Search) for a fully managed search index. This creates a production-ready RAG pipeline.
*   **Node.js & Azure:** Deploy Node.js APIs as containerized microservices on **Azure Kubernetes Service (AKS)** or as serverless functions. Use the **Azure SDK for JavaScript** for seamless integration with other Azure services (Blob Storage, Service Bus, Key Vault). Implement authentication using **Passport.js with Azure AD**.
*   **Multi-Cloud (AWS, GCP) & Azure:** Use **Azure Arc** to manage Kubernetes clusters running on AWS EKS or GCP GKE from a single control plane (as in Pattern 3). Employ **Azure Traffic Manager** or **Front Door