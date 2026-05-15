# Kubernetes

## The 30-Second Pitch
Kubernetes is a container orchestration platform that automates the deployment, scaling, and management of containerized applications. It solves the problem of operating complex, distributed systems at scale by abstracting away the underlying infrastructure. A team would pick Kubernetes over simpler alternatives like Docker Compose or managed VM services because it provides declarative configuration, self-healing capabilities, service discovery, load balancing, and a unified API for managing compute, networking, and storage across any cloud or on-premises environment. For an AI engineering team, it's particularly valuable for managing the lifecycle of model training jobs, inference services, and the supporting microservices that make up a modern AI application stack.

## How It Actually Works

### Core Architecture: The Control Plane and Data Plane
At its heart, Kubernetes follows a client-server architecture. The **control plane** (master nodes) makes global decisions about the cluster and responds to cluster events. The **data plane** (worker nodes) runs the actual containerized workloads.

**Control Plane Components:**
- **kube-apiserver**: The front door to Kubernetes. All communication (CLI, UI, other components) goes through this REST API.
- **etcd**: A consistent, highly-available key-value store that holds all cluster data (the "source of truth").
- **kube-scheduler**: Watches for newly created Pods with no assigned node and selects a node for them to run on based on resource requirements, constraints, and policies.
- **kube-controller-manager**: Runs controller processes (Node Controller, Job Controller, Endpoints Controller, etc.) that regulate the state of the cluster. The **cloud-controller-manager** lets you link your cluster into your cloud provider's API (for managing load balancers, storage volumes, etc.).

**Node Components:**
- **kubelet**: An agent that runs on each node, ensuring containers are running in a Pod. It takes PodSpecs and ensures the described containers are running and healthy.
- **kube-proxy**: Maintains network rules on nodes, enabling communication to your Pods from network sessions inside or outside the cluster.
- **Container Runtime**: The software responsible for running containers (e.g., Docker, containerd, CRI-O).

### The Mental Model: Desired State Reconciliation
Kubernetes is a **declarative system**. You provide a *desired state* (e.g., "I want 5 replicas of my web app"), and the control plane's controllers work incessantly to make the *observed state* match it. This is the **reconciliation loop**. If a Pod crashes, the ReplicaSet controller observes the discrepancy (desired: 5, observed: 4) and instructs the API to create a new one.

### Key Objects and Their Hierarchy
Think of objects as nested layers of abstraction:

```
Cluster
├── Namespace (logical grouping)
│   └── Deployment (manages Pod lifecycle)
│       └── ReplicaSet (ensures Pod count)
│           └── Pod (schedules onto a Node)
│               ├── Container (your app)
│               ├── Container (sidecar, e.g., log shipper)
│               └── Volumes (attached storage)
└── Service (stable network endpoint for Pods)
    └── Endpoints (auto-populated list of Pod IPs)
```

**Pod**: The smallest deployable unit. It's a logical host for one or more containers that share network namespace (IP address) and storage volumes. Containers in a Pod are co-located and co-scheduled.

**Service**: An abstraction that defines a logical set of Pods and a policy to access them. It provides a stable IP address (ClusterIP) and DNS name. Traffic is load-balanced across the Pods.

**Ingress**: Manages external HTTP/HTTPS access to Services, typically providing load balancing, SSL termination, and name-based virtual hosting. It's not a Service type but its own resource, backed by an **Ingress Controller** (e.g., nginx, AWS ALB).

### Data Flow Example: `kubectl apply -f deployment.yaml`
1. `kubectl` validates and sends the YAML to the **kube-apiserver**.
2. The apiserver authenticates the request, validates it, and stores the object in **etcd**.
3. The **Deployment controller** (within kube-controller-manager) watches the API for new Deployment objects. It creates a **ReplicaSet** object.
4. The **ReplicaSet controller** watches for new ReplicaSets. It creates **Pod** objects to satisfy the replica count.
5. The **kube-scheduler** watches for Pods with `nodeName` not set. It selects a suitable **Node** based on resources, node selectors/affinity, etc., and updates the Pod spec with the node name.
6. The **kubelet** on the chosen node watches for Pods assigned to it. It instructs the **container runtime** to pull the image and start the container(s).
7. Meanwhile, the **kube-proxy** on each node (or the cloud provider's CNI plugin) watches for Services and Endpoints, updating iptables/IPVS rules to route traffic to the new Pod's IP.

## Patterns You Should Know

### 1. The Sidecar Pattern for AI Pipelines
Extend a primary application container with a helper container in the same Pod. Perfect for log aggregation, model monitoring, or feature store syncing.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: inference-service-with-monitor
spec:
  containers:
  - name: model-api
    image: my-registry/llama-inference:latest
    ports:
    - containerPort: 8000
    env:
    - name: MODEL_PATH
      value: /mnt/models/model.bin
    volumeMounts:
    - name: model-storage
      mountPath: /mnt/models
    - name: shared-logs
      mountPath: /var/log/app
  - name: monitoring-sidecar
    image: fluentbit:latest
    command: ['fluent-bit', '-c', '/etc/fluent-bit.conf']
    volumeMounts:
    - name: shared-logs
      mountPath: /var/log/app
    - name: config-volume
      mountPath: /etc/fluent-bit.conf
      subPath: fluent-bit.conf
  volumes:
  - name: model-storage
    persistentVolumeClaim:
      claimName: model-pvc
  - name: shared-logs
    emptyDir: {}
  - name: config-volume
    configMap:
      name: fluentbit-config
```
**Why it's important:** The sidecar shares the Pod's network and storage, allowing it to access the primary container's logs/files with minimal overhead. For AI, you could have a sidecar that scrapes prediction metrics and sends them to Prometheus.

### 2. Init Containers for Model Pre-loading
Init containers run to completion before the main app containers start. Use them for setup, like downloading a large ML model from cloud storage.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: text-embedder
spec:
  template:
    spec:
      initContainers:
      - name: download-model
        image: amazon/aws-cli:latest
        command: ['sh', '-c']
        args:
        - |
          aws s3 cp s3://my-ai-bucket/models/all-MiniLM-L6-v2 /mnt/models/ --quiet
          echo "Model download complete"
        volumeMounts:
        - name: model-volume
          mountPath: /mnt/models
        env:
        - name: AWS_ACCESS_KEY_ID
          valueFrom:
            secretKeyRef:
              name: aws-credentials
              key: accessKey
        - name: AWS_SECRET_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: aws-credentials
              key: secretKey
      containers:
      - name: embedder
        image: sentence-transformers-service:latest
        volumeMounts:
        - name: model-volume
          mountPath: /models
        resources:
          requests:
            memory: "2Gi"
            cpu: "500m"
      volumes:
      - name: model-volume
        emptyDir: {}
```
**Why it's important:** Ensures the model is locally available before the inference service starts, preventing cold-start latency. The `emptyDir` volume is shared between init and main containers.

### 3. Job & CronJob for Batch Inference and Training
For batch processing, scheduled tasks, or one-off model training runs, use Job and CronJob resources.

```yaml
# One-off training job with parallel workers
apiVersion: batch/v1
kind: Job
metadata:
  name: hyperparameter-sweep
spec:
  completions: 5  # Run 5 pods to completion
  parallelism: 2  # Run 2 pods concurrently
  template:
    spec:
      containers:
      - name: trainer
        image: pytorch-training:latest
        command: ["python", "train.py"]
        args: ["--job-index", "$(JOB_COMPLETION_INDEX)"] # Unique index per pod
        env:
        - name: JOB_COMPLETION_INDEX
          valueFrom:
            fieldRef:
              fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
        resources:
          requests:
            nvidia.com/gpu: 1  # Request a GPU
      restartPolicy: Never
  backoffLimit: 4

# Scheduled nightly batch inference
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-batch-predict
spec:
  schedule: "0 2 * * *"  # 2 AM daily
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: batch-predict
            image: batch-inference:latest
            command: ["python", "run_predictions.py"]
            volumeMounts:
            - name: config
              mountPath: /config
          volumes:
          - name: config
            configMap:
              name: batch-inference-config
          restartPolicy: OnFailure
```
**Why it's important:** Kubernetes manages the lifecycle, retries, and scheduling of batch workloads. The `JOB_COMPLETION_INDEX` allows for partitioned processing (e.g., different hyperparameters per pod). For AI, this is ideal for distributed training or processing large datasets in chunks.

### 4. ConfigMap and Secret for Environment Management
Decouple configuration from container images. Use ConfigMaps for non-sensitive config and Secrets for credentials, API keys, or model registry tokens.

```yaml
# ConfigMap for application settings
apiVersion: v1
kind: ConfigMap
metadata:
  name: ai-service-config
data:
  log-level: "INFO"
  embedding-model: "all-MiniLM-L6-v2"
  batch-size: "32"
  config.json: |
    {
      "max_tokens": 512,
      "temperature": 0.7
    }
---
# Secret for sensitive data (encoded in base64)
apiVersion: v1
kind: Secret
metadata:
  name: openai-secret
type: Opaque
data:
  api-key: <base64-encoded-api-key> # Use `kubectl create secret` in reality
  huggingface-token: <base64-encoded-token>
---
# Deployment consuming both
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-orchestrator
spec:
  template:
    spec:
      containers:
      - name: orchestrator
        image: llama-index-service:latest
        env:
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: ai-service-config
              key: log-level
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: openai-secret
              key: api-key
        volumeMounts:
        - name: config-volume
          mountPath: /app/config
      volumes:
      - name: config-volume
        configMap:
          name: ai-service-config
          items:
          - key: config.json
            path: config.json
```
**Why it's important:** Enables deploying the same container image across environments (dev, staging, prod) with different configs. Secrets are stored encrypted at rest in etcd (if configured) and are only base64-encoded, not encrypted—so consider external secret providers (AWS Secrets Manager, Azure Key Vault) for production.

### 5. Horizontal Pod Autoscaling (HPA) for Inference Endpoints
Automatically scale the number of Pod replicas based on observed CPU, memory, or custom metrics (like requests per second or queue length).

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: inference-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: llama-inference
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  - type: Pods  # Custom metric from Prometheus Adapter
    pods:
      metric:
        name: requests_per_second
      target:
        type: AverageValue
        averageValue: 100
```
**Why it's important:** For AI services, traffic can be spiky. HPA ensures you have enough Pods to handle inference requests during peak times and scales down to save costs during lulls. Custom metrics are crucial for scaling based on application-specific load (e.g., GPU utilization, prediction latency).

## What Interviewers Actually Ask

**Q: Explain what happens when you run `kubectl apply -f pod.yaml`.**
**A:** `kubectl` sends the Pod manifest to the kube-apiserver, which authenticates the request, validates the schema, and stores it in etcd. The kube-scheduler then identifies that the Pod has no assigned node, evaluates nodes based on resource requests, node selectors, and affinity/anti-affinity rules, and binds the Pod to a suitable node by updating the Pod spec in etcd. The kubelet on that target node watches for this update, pulls the container image via the container runtime, creates the container(s) with any specified volumes and network namespaces, and starts them. Finally, kube-proxy updates network rules to potentially include the new Pod in Service endpoints.

**Q: When would you choose a Deployment over a StatefulSet or a bare Pod?**
**A:** Use a **Deployment** for stateless applications where pods are fungible (any pod can handle any request), and you need rolling updates and rollback capabilities. Use a **StatefulSet** for stateful applications that require stable network identifiers (predictable pod hostnames), stable persistent storage per pod (like a database shard), and ordered, graceful deployment and scaling. A **bare Pod** is almost never used directly in production because it won't be rescheduled if the node fails; it's a primitive building block managed by higher-level controllers.

**Q: How do Services work under the hood? What about Ingress?**
**A:** A **Service** is an abstraction that defines a logical set of Pods (selected by labels) and a policy to access them. Internally, the Endpoints controller continuously watches Pods and updates the Endpoints object with the IPs of matching Pods. `kube-proxy` on each node watches Services and Endpoints, and programs packet filtering rules (via iptables or IPVS) to intercept traffic sent to the Service's ClusterIP and load-balance it to a backend Pod IP. An **Ingress** is a higher-level abstraction for exposing HTTP/HTTPS routes. It's not a Service type. An Ingress resource defines rules, and an **Ingress Controller** (a Pod running software like nginx or an AWS ALB) watches Ingress objects and dynamically configures itself as a reverse proxy/load balancer to route external traffic to the appropriate internal Services.

**Q: You have a Pod that's stuck in `Pending` state. What are the first three things you check?**
**A:** First, `kubectl describe pod <name>` to see the `Events` section—it often directly states the issue (e.g., "Insufficient cpu"). Second, check if there are **Node Selectors/Affinities** on the Pod that no node satisfies. Third, check if a **PersistentVolumeClaim** is stuck pending due to lack of available storage. Other common culpits are resource quotas on the namespace or reaching the limit of pods per node.

**Q: How would you securely manage secrets for a production AI service that needs API keys for multiple cloud providers?**
**A:** For basic needs, use Kubernetes **Secrets**, ensuring etcd encryption at rest is enabled. For a more robust production setup, I'd integrate with an external secret manager like **AWS Secrets Manager**, **Azure Key Vault**, or **HashiCorp Vault**. Tools like the **External Secrets Operator** or **CSI Secret Store Driver** can synchronize secrets from these external sources into the cluster as native Secret objects or mount them directly into pods as volumes, providing automatic rotation, fine-grained access policies, and audit logging.

**Q: How does Kubernetes facilitate a CI/CD pipeline for microservices?**
**A:** Kubernetes provides a consistent deployment target for all environments. A typical pipeline uses tools like **Jenkins**, **GitLab CI**, or **ArgoCD**. The pipeline would: 1) Build a container image from code, tag it with the commit hash, and push to a registry. 2) Update the Kubernetes manifest (e.g., Deployment YAML) with the new image tag, often using a tool like **Kustomize** or **Helm**. 3) Apply the manifest to the target cluster (`kubectl apply` or via GitOps). Kubernetes then performs a rolling update, ensuring zero-downtime deployment. For AI services, the pipeline might also include a step to validate model performance before promoting to production.

**Q: When would you *not* recommend Kubernetes for a project?**
**A:** I would not recommend Kubernetes for a small, simple application running on a single server—the operational overhead outweighs the benefits. It's also a poor fit if the team lacks DevOps expertise or if the application is a monolithic legacy system not designed for containers. For projects with extremely tight, predictable resource constraints (like embedded systems) or where extreme low-latency is needed and the container networking abstraction adds unacceptable overhead, a simpler PaaS or managed service might be better.

**Q: How do you handle persistent storage for a distributed model training job that needs