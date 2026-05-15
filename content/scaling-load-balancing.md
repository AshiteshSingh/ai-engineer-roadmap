# Scaling & Load Balancing: GPU Clusters, Model Parallelism & Routing

Operating large language models at scale demands a deep understanding of distributed systems principles applied to GPU-centric workloads. Unlike CPU-based web services where horizontal scaling is relatively straightforward, LLM serving must contend with models that exceed single-GPU memory, heterogeneous hardware, and inference patterns where a single request may consume billions of floating-point operations. This article explores the parallelism strategies, cluster management techniques, and load balancing approaches that make production-scale LLM inference viable.

## Why LLM Scaling Is Different

Traditional web services scale by adding stateless replicas behind a load balancer. LLM serving breaks this model in several ways. First, the model itself may not fit on a single GPU -- a 70B parameter model in FP16 requires ~140GB of GPU memory, exceeding even an H100's 80GB. Second, the KV-cache grows with context length and batch size, creating dynamic memory pressure that changes per-request. Third, GPU resources are expensive (an H100 costs $2-3/hour in the cloud), so utilization efficiency directly impacts economics.

These constraints mean that scaling LLM inference involves two orthogonal axes: scaling a single model across multiple GPUs (model parallelism) and scaling the system to handle more concurrent requests (data parallelism and replication).

## Model Parallelism Strategies

### Tensor Parallelism (TP)

Tensor parallelism splits individual layers across multiple GPUs, with each GPU computing a portion of each matrix multiplication. For a transformer's self-attention and feed-forward layers, the weight matrices are sharded column-wise or row-wise across GPUs.

Megatron-LM (Shoeybi et al., 2019, "Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism") established the canonical approach. For a linear layer `Y = XA`, the weight matrix `A` is split column-wise across N GPUs:

```
GPU 0: Y_0 = X @ A_0    (A_0 is columns 0..d/N)
GPU 1: Y_1 = X @ A_1    (A_1 is columns d/N..2d/N)
...
GPU N: Y_N = X @ A_N

# For column-parallel, outputs are concatenated
Y = [Y_0, Y_1, ..., Y_N]

# For row-parallel, outputs are all-reduced (summed)
Y = AllReduce(Y_0 + Y_1 + ... + Y_N)
```

The MLP block in a transformer uses a column-parallel split for the first linear layer and a row-parallel split for the second, requiring only one all-reduce per MLP block. Similarly, in multi-head attention, heads are distributed across GPUs, with each GPU computing a subset of attention heads.

**Communication cost**: Tensor parallelism requires all-reduce operations at every layer, making it extremely latency-sensitive to inter-GPU bandwidth. It works well within a single node connected by NVLink (900 GB/s on H100 SXM, up to 1.8 TB/s on B200 with NVLink 5th-gen) but poorly across nodes connected by InfiniBand (typically 400 Gb/s = 50 GB/s, an order of magnitude slower).

```python
# vLLM tensor parallelism configuration
from vllm import LLM

# Shard a 70B model across 4 GPUs within a single node
llm = LLM(
    model="meta-llama/Llama-3.1-70B-Instruct",
    tensor_parallel_size=4,      # Split across 4 GPUs
    gpu_memory_utilization=0.90, # Use 90% of each GPU's memory
)
```

### Pipeline Parallelism (PP)

Pipeline parallelism assigns different layers to different GPUs. GPU 0 runs layers 0-19, GPU 1 runs layers 20-39, and so on. Each GPU processes its layers and passes activations to the next GPU.

The naive approach creates a "bubble" where only one GPU is active at a time. GPipe (Huang et al., 2019) and PipeDream (Narayanan et al., 2019) introduced **micro-batching** to fill the bubble: a batch is split into micro-batches, and as GPU 0 finishes processing micro-batch 1, it starts micro-batch 2 while GPU 1 processes micro-batch 1.

```
Naive Pipeline (3 GPUs, 1 batch):
GPU 0: [████]
GPU 1:       [████]
GPU 2:             [████]
              ^bubble^

Micro-batched Pipeline (3 GPUs, 4 micro-batches):
GPU 0: [█1][█2][█3][█4]
GPU 1:     [█1][█2][█3][█4]
GPU 2:         [█1][█2][█3][█4]
         less bubble waste
```

**When to use PP vs TP**: Pipeline parallelism communicates less data (only activations between stages, once per layer boundary) but introduces latency bubbles. It works better across nodes where bandwidth is limited. In practice, most production deployments use TP within a node and PP across nodes:

```
Node 0 (4x H100 NVLink):  TP=4, Layers 0-39
Node 1 (4x H100 NVLink):  TP=4, Layers 40-79
Combined: TP=4, PP=2
```

### Expert Parallelism (EP)

Mixture-of-Experts (MoE) models like Mixtral, DeepSeek-V3, and Grok present a unique parallelism opportunity. Since only a subset of experts is activated per token, experts can be distributed across GPUs with tokens routed to the appropriate GPU.

```
Token routing in MoE with Expert Parallelism:
GPU 0: Experts 0-3    <-- tokens routed to these experts
GPU 1: Experts 4-7    <-- tokens routed to these experts
GPU 2: Experts 8-11   <-- tokens routed to these experts
GPU 3: Experts 12-15  <-- tokens routed to these experts

All-to-all communication shuffles tokens between GPUs
based on expert assignments.
```

DeepSeek-V3's paper describes using EP combined with TP for the attention layers, a pattern increasingly common for large MoE models. For a deeper look at the architectural motivations behind MoE routing and how expert counts affect inference cost, see [Article 05: Inference Optimization](/inference-optimization).

### Sequence and Context Parallelism

As context windows grow from 8K to 128K to 1M+ tokens, a new bottleneck emerges: the KV-cache and attention computation for a single sequence may exceed the memory of a single GPU, even when the model weights fit comfortably. Context parallelism (CP) addresses this by partitioning the sequence dimension itself across multiple GPUs, allowing each device to handle a contiguous chunk of the input sequence.

**Ring attention** (Liu et al., 2023, "Ring Attention with Blockwise Transformers for Near-Infinite Context") is the foundational technique. Each GPU holds a shard of the KV-cache corresponding to its portion of the sequence. During attention computation, KV blocks are passed between GPUs in a ring topology -- GPU 0 sends its KV block to GPU 1, GPU 1 to GPU 2, and so on, with the last GPU sending back to GPU 0. Each GPU computes partial attention scores against the visiting KV block while simultaneously forwarding it to the next peer:

```
Ring Attention (4 GPUs, sequence split into 4 chunks):

          ┌──── KV_0 ────►┐
GPU 0 [Q_0, KV_0]    GPU 1 [Q_1, KV_1]
  ▲                          │
  │ KV_3              KV_1   │
  │                          ▼
GPU 3 [Q_3, KV_3]    GPU 2 [Q_2, KV_2]
          └◄── KV_2 ────┘

Each GPU computes attention for its Q chunk against
all KV chunks via P rounds of ring communication.
```

The critical property of ring attention is that it overlaps communication with computation. While a GPU is computing attention against one KV block, the next KV block is already in transit. For large enough chunk sizes, the communication cost is entirely hidden behind compute, making context parallelism nearly free in terms of wall-clock overhead.

Meta's Llama 3.1 405B deployment uses context parallelism to serve its 128K context window. The model runs with TP=8 within a node and CP=4 across nodes, enabling each request to spread its 128K-token KV-cache across 4 node-groups. Without CP, a single 128K-token request for a 405B model would require roughly 120GB of KV-cache alone (in FP8), exceeding the capacity available after model weights are loaded.

**Practical considerations**: Context parallelism is most beneficial when sequence lengths are long relative to model size. For short prompts (under 8K tokens), the overhead of ring communication exceeds the benefit. Most serving frameworks activate CP dynamically -- short requests are served with TP only, while long-context requests trigger CP across additional GPU groups. This is closely related to the disaggregated prefill/decode architecture discussed in [Article 37: LLM Serving](/llm-serving), where long-context prefill jobs can be routed to CP-enabled pools while short decode requests use compact TP-only replicas.

## Data Parallelism and Replication

Once a single model instance is configured with appropriate TP/PP, scaling to handle more traffic means running multiple replicas. Each replica independently serves requests, with a load balancer distributing incoming traffic.

### Replica Sizing

The fundamental question is how many GPUs per replica vs. how many replicas. Consider a 70B model on H100 GPUs:

| Configuration | GPUs/Replica | Replicas (16 GPUs) | Single-request Latency | Throughput |
|---|---|---|---|---|
| TP=1 (quantized INT4) | 1 | 16 | Higher | Highest total |
| TP=2 | 2 | 8 | Medium | High |
| TP=4 | 4 | 4 | Lowest | Medium |
| TP=8 | 8 | 2 | Lowest | Lower total |

More replicas generally means more aggregate throughput (more independent batches), but higher per-request latency (less parallelism within a single request). The optimal point depends on your latency SLA and traffic pattern.

### Autoscaling Patterns

LLM workloads exhibit bursty traffic patterns. Autoscaling must account for the slow startup time of LLM instances (model loading can take 2-10 minutes):

```python
# Kubernetes HPA configuration for LLM serving
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: llm-serving-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: llm-serving
  minReplicas: 2          # Always keep 2 warm replicas
  maxReplicas: 16
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60   # React quickly to load
      policies:
        - type: Pods
          value: 2                      # Add max 2 pods at a time
          periodSeconds: 120            # Every 2 minutes
    scaleDown:
      stabilizationWindowSeconds: 300  # Wait 5 min before scaling down
      policies:
        - type: Pods
          value: 1
          periodSeconds: 300
  metrics:
    - type: Pods
      pods:
        metric:
          name: gpu_kv_cache_utilization
        target:
          type: AverageValue
          averageValue: "70"            # Scale up at 70% KV-cache usage
```

**Predictive autoscaling** can pre-warm instances based on historical traffic patterns (e.g., knowing that usage spikes at 9 AM on weekdays). Some teams maintain a pool of "warm standby" instances with the model loaded but not serving traffic, enabling faster scale-up.

## Load Balancing Strategies

### The Challenge of LLM Load Balancing

Traditional load balancing (round-robin, least connections) works poorly for LLM workloads because requests are not equal. A request with a 10K-token prompt and 2K-token output consumes orders of magnitude more GPU resources than a 100-token prompt with a 50-token output. Naive round-robin can create severe imbalance.

### Token-Aware Load Balancing

A better approach estimates the resource cost of each request and routes to the least-loaded backend:

```python
class TokenAwareLoadBalancer:
    def __init__(self, backends: list[Backend]):
        self.backends = backends

    async def route(self, request: LLMRequest) -> Backend:
        prompt_tokens = estimate_prompt_tokens(request)
        max_output_tokens = request.max_tokens or 1024

        # Estimate total token cost
        estimated_cost = prompt_tokens + max_output_tokens

        # Find backend with lowest pending token load
        best_backend = min(
            self.backends,
            key=lambda b: b.pending_token_load + estimated_cost
        )

        best_backend.pending_token_load += estimated_cost
        return best_backend

    async def on_request_complete(self, backend: Backend, actual_tokens: int):
        backend.pending_token_load -= actual_tokens
```

### KV-Cache-Aware Routing

When prefix caching is enabled, routing requests with similar prompts to the same backend can dramatically improve cache hit rates. This is especially valuable for applications where many users share a common system prompt:

```python
class PrefixAwareRouter:
    def __init__(self, backends: list[Backend]):
        self.backends = backends
        self.prefix_affinity = {}  # hash(prefix) -> backend_id

    async def route(self, request: LLMRequest) -> Backend:
        # Hash the system prompt / common prefix
        prefix = request.messages[0].content if request.messages else ""
        prefix_hash = hashlib.sha256(prefix.encode()).hexdigest()[:16]

        # Check if we have affinity for this prefix
        if prefix_hash in self.prefix_affinity:
            preferred = self.prefix_affinity[prefix_hash]
            if preferred.is_healthy and preferred.load < 0.85:
                return preferred

        # Otherwise, use least-loaded routing and establish affinity
        backend = self.least_loaded_backend()
        self.prefix_affinity[prefix_hash] = backend
        return backend
```

### Session Affinity for Multi-Turn Conversations

Multi-turn conversations benefit from routing subsequent turns to the same backend, where the KV-cache from previous turns may still be resident. This avoids re-computing the entire conversation history:

```python
class SessionAffinityRouter:
    def __init__(self, backends, ttl_seconds=300):
        self.session_map = TTLCache(maxsize=100000, ttl=ttl_seconds)
        self.backends = backends

    async def route(self, request: LLMRequest) -> Backend:
        session_id = request.session_id or request.conversation_id

        if session_id and session_id in self.session_map:
            backend = self.session_map[session_id]
            if backend.is_healthy:
                return backend

        backend = self.least_loaded_backend()
        if session_id:
            self.session_map[session_id] = backend
        return backend
```

## GPU Cluster Management

### Hardware Topology Awareness

Modern GPU clusters have complex interconnect topologies. Within a node, GPUs may be connected via NVLink or PCIe. Across nodes, InfiniBand or RoCE provides RDMA networking. The serving system must be topology-aware to minimize communication overhead.

With the NVIDIA B200 and GB200 NVL72 systems entering deployment in 2025, the scale-up story has changed significantly. A GB200 NVL72 rack connects 72 B200 GPUs via a single NVLink domain, delivering 130 TB/s of aggregate bisection bandwidth within the rack. This effectively makes the entire rack behave like a single node for tensor parallelism purposes, eliminating the TP-within-node / PP-across-node split for models up to roughly 700B parameters. For serving infrastructure, this means a single GB200 NVL72 rack can host a full Llama 3.1 405B instance with TP=72, yielding lower latency than any multi-node configuration achievable with prior hardware:

```
DGX H100 Node Topology:
┌──────────────────────────────────────┐
│  GPU0 ═══NVLink═══ GPU1              │
│   ║                  ║               │
│  GPU2 ═══NVLink═══ GPU3              │
│   ║                  ║               │
│  GPU4 ═══NVLink═══ GPU5              │
│   ║                  ║               │
│  GPU6 ═══NVLink═══ GPU7              │
│        NVSwitch (full mesh)          │
└──────────┬───────────────────────────┘
           │ InfiniBand (400 Gb/s)
           │
┌──────────┴───────────────────────────┐
│          Spine Switch                │
└──────────┬───────────────────────────┘
           │
       Other Nodes
```

### Heterogeneous GPU Clusters

Production clusters rarely consist of a single GPU generation. Organizations accumulate hardware over successive procurement cycles, resulting in mixed fleets -- A100s purchased in 2022 running alongside H100s from 2023 and B200s arriving in 2025. Managing these heterogeneous clusters effectively is a significant operational challenge.

The core problem is that different GPU generations have different memory capacities, compute throughputs, and interconnect bandwidths. An A100-80GB can serve a quantized 70B model at TP=2, but its lower memory bandwidth (2 TB/s vs. H100's 3.35 TB/s) means ~40% lower decode throughput per GPU. Naive scheduling that treats all GPUs as interchangeable wastes capacity or creates latency variance.

**Workload placement strategies** for mixed clusters typically follow a tiered approach:

```
Workload Placement Matrix:

┌─────────────────────┬──────────────┬──────────────┬──────────────┐
│ Workload Type       │ B200/H100    │ A100-80GB    │ A100-40GB    │
├─────────────────────┼──────────────┼──────────────┼──────────────┤
│ Latency-critical    │ Primary      │ Overflow     │ ---          │
│ (real-time chat)    │              │              │              │
├─────────────────────┼──────────────┼──────────────┼──────────────┤
│ Throughput-oriented │ If available │ Primary      │ If quantized │
│ (batch, async)      │              │              │              │
├─────────────────────┼──────────────┼──────────────┼──────────────┤
│ Small models        │ ---          │ If available │ Primary      │
│ (7B-13B)            │              │              │              │
├─────────────────────┼──────────────┼──────────────┼──────────────┤
│ Long-context (128K+)│ Primary      │ ---          │ ---          │
│                     │ (more VRAM)  │              │              │
└─────────────────────┴──────────────┴──────────────┴──────────────┘
```

The load balancer must be GPU-generation-aware. A token-aware router that also knows the hardware behind each backend can weight routing decisions by expected throughput rather than treating all replicas equally. If an H100 backend processes tokens at 1.6x the rate of an A100 backend, it should receive proportionally more traffic. Some teams implement this as a weighted least-connections strategy, where weights are derived from hardware benchmarks:

```python
class HeterogeneousLoadBalancer:
    GPU_THROUGHPUT_WEIGHTS = {
        "B200": 2.5,   # Relative to A100 baseline
        "H100": 1.6,
        "A100_80GB": 1.0,
        "A100_40GB": 0.7,
    }

    async def route(self, request: LLMRequest) -> Backend:
        best_backend = min(
            self.backends,
            key=lambda b: (
                b.pending_token_load
                / self.GPU_THROUGHPUT_WEIGHTS[b.gpu_type]
            ),
        )
        return best_backend
```

Model versioning across GPU types adds another layer of complexity. The same logical model may be deployed as FP16 on H100s (where memory is sufficient) and INT4 on A100-40GBs (where it is not). The load balancer needs to understand that these are quality-equivalent but performance-different replicas, and route accordingly. See [Article 39: Cost Optimization](/cost-optimization) for a broader analysis of how hardware mix decisions affect per-token economics.

### GPU Disaggregation and Pooling

Traditional GPU allocation follows a static model: GPUs are assigned to specific workloads at deployment time and remain dedicated until the workload is removed. This creates poor utilization -- a serving deployment sized for peak traffic may run at 30% utilization during off-hours, while a fine-tuning job queued overnight cannot access those idle GPUs.

GPU disaggregation and pooling, pioneered by platforms like Run.ai and CoreWeave, treats GPUs as a shared resource pool that can be dynamically allocated and reclaimed across workloads. The key insight is separating the GPU resource from the workload lifecycle:

```
Static Allocation (traditional):
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Serving  │  │ Training │  │  Idle    │
│ 8x H100  │  │ 4x H100  │  │ 4x H100  │
│ (40% util)│  │ (95% util)│  │ (0% util) │
└──────────┘  └──────────┘  └──────────┘

Pooled Allocation (disaggregated):
┌─────────────────────────────────────────┐
│          GPU Pool (16x H100)            │
│  ┌────────┐  ┌──────┐  ┌────────────┐  │
│  │Serving │  │Train │  │  Serving   │  │
│  │  4x    │  │ 4x   │  │  overflow  │  │
│  │ (peak) │  │      │  │    8x      │  │
│  └────────┘  └──────┘  └────────────┘  │
│   Allocations shift based on demand     │
└─────────────────────────────────────────┘
```

**Dynamic allocation patterns** in practice involve several mechanisms:

1. **Time-slicing**: Multiple workloads share the same physical GPU with temporal multiplexing. NVIDIA's MIG (Multi-Instance GPU) on A100/H100/B200 provides hardware-level isolation, partitioning a single GPU into up to 7 independent instances with dedicated memory and compute. This is useful for smaller models or development workloads.

2. **Preemption-based sharing**: Low-priority workloads (batch scoring, offline evaluation) are preempted when high-priority workloads (real-time serving) need additional GPUs. The preempted workload checkpoints its state and resumes when resources become available.

3. **Fractional GPU allocation**: Platforms expose GPUs in fractional units, allowing a workload to request 0.5 GPUs when a full GPU would be wasteful. This is implemented via MIG, time-slicing, or vGPU technologies.

The challenge with disaggregation for LLM serving specifically is the cold-start penalty. Loading a 70B model into GPU memory takes 2-5 minutes, so GPUs cannot be freely reclaimed and reassigned without significant downtime. Production systems address this through model-aware scheduling: the orchestrator tracks which models are loaded on which GPUs and preferentially routes new requests to GPUs that already have the required model in memory, falling back to cold-start only when all warm instances are overloaded.

### Multi-GPU Resource Allocation

Kubernetes with the NVIDIA GPU Operator provides the infrastructure for GPU scheduling, but LLM workloads need additional constraints:

```yaml
# Pod spec for a 4-GPU tensor-parallel LLM instance
apiVersion: v1
kind: Pod
metadata:
  name: llm-serving
spec:
  containers:
    - name: vllm
      image: vllm/vllm-openai:latest
      resources:
        limits:
          nvidia.com/gpu: 4
      env:
        - name: CUDA_VISIBLE_DEVICES
          value: "0,1,2,3"
        - name: NCCL_P2P_LEVEL      # Ensure NVLink is used
          value: "NVL"
  # Ensure all GPUs are on the same node (critical for TP)
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: nvidia.com/gpu.count
                operator: Gte
                values: ["4"]
```

### Health Monitoring and Failover

GPU failures in production are common. ECC errors, thermal throttling, and driver crashes require automated detection and recovery:

```python
class GPUHealthMonitor:
    async def check_gpu_health(self, gpu_id: int) -> GPUHealth:
        # Check via nvidia-smi or NVML
        info = pynvml.nvmlDeviceGetInfo(gpu_id)
        memory_info = pynvml.nvmlDeviceGetMemoryInfo(gpu_id)
        temp = pynvml.nvmlDeviceGetTemperature(gpu_id)
        ecc_errors = pynvml.nvmlDeviceGetTotalEccErrors(gpu_id)

        return GPUHealth(
            utilization=info.gpu_utilization,
            memory_used=memory_info.used,
            memory_total=memory_info.total,
            temperature=temp,
            ecc_errors_total=ecc_errors,
            is_healthy=(
                temp < 85 and
                ecc_errors < THRESHOLD and
                memory_info.used < memory_info.total * 0.98
            )
        )
```

## Cost Modeling

### GPU Cost per Token

Understanding the economics of different configurations is essential for capacity planning:

```python
def cost_per_million_tokens(
    gpu_type: str,
    gpu_count: int,
    hourly_cost_per_gpu: float,
    throughput_tokens_per_second: float,
) -> float:
    total_hourly_cost = gpu_count * hourly_cost_per_gpu
    tokens_per_hour = throughput_tokens_per_second * 3600
    cost_per_token = total_hourly_cost / tokens_per_hour
    return cost_per_token * 1_000_000

# Example: Llama 3.1 70B on 4x H100
cost = cost_per_million_tokens(
    gpu_type="H100",
    gpu_count=4,
    hourly_cost_per_gpu=2.50,     # ~$2.50/hr on AWS
    throughput_tokens_per_second=2000,  # ~2K tok/s output with batching
)
# ~$1.39 per million output tokens (competitive with API pricing)
```

### Spot Instance Strategies

For batch workloads and non-latency-sensitive traffic, spot/preemptible instances can reduce costs by 60-70%. The key challenge is handling interruptions gracefully:

1. Run latency-sensitive traffic on on-demand instances
2. Route batch and background traffic to spot instances
3. Implement request draining on interruption notice
4. Maintain enough on-demand capacity to absorb spot interruptions

## Summary and Key Takeaways

1. **Tensor parallelism splits layers across GPUs** and requires high-bandwidth interconnects like NVLink. Use it within a single node for latency-sensitive serving. GB200 NVL72 extends the NVLink domain to an entire rack, changing where the TP/PP boundary falls.

2. **Pipeline parallelism splits layers sequentially** across GPUs/nodes and tolerates lower bandwidth. Use it across nodes in combination with intra-node tensor parallelism.

3. **Context parallelism partitions the sequence dimension** via ring attention, enabling 128K-1M+ token serving that would otherwise exceed single-GPU memory. It complements TP and PP as a third parallelism axis.

4. **Data parallelism (replication) scales throughput** by running independent model replicas. More replicas generally yield more aggregate throughput at the cost of more GPUs.

5. **Token-aware load balancing outperforms round-robin** for LLM workloads because request costs vary by orders of magnitude. Factor in prompt length, expected output length, and current backend KV-cache utilization.

6. **Prefix/session-aware routing improves cache hit rates** by directing requests with similar prompts or the same conversation to the same backend, avoiding redundant KV-cache computation.

7. **Heterogeneous clusters require generation-aware scheduling** -- route latency-critical work to newest hardware, throughput-oriented batch work to older GPUs, and weight load balancing by hardware capability rather than treating all replicas equally.

8. **GPU disaggregation improves fleet utilization** by pooling GPUs across workloads and dynamically reallocating based on demand, though LLM serving's cold-start penalty requires model-aware scheduling.

9. **Autoscaling LLM workloads requires patience** -- model loading takes minutes, so scale-up must be predictive or use warm standby pools. Scale-down should be conservative to avoid thrashing.

10. **Cost optimization is a first-class concern**: choosing the right parallelism configuration, using spot instances for batch work, and right-sizing replicas can reduce serving costs by 2-5x without sacrificing quality. See [Article 39: Cost Optimization](/cost-optimization) for detailed economic analysis.
