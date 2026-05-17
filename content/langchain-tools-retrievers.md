# LangChain Tools & Retrievers: Grounding Chains in Your Own Data

A bare chain knows only what the model memorized at training time. Two LangChain abstractions break that ceiling: **tools** let a model call code and APIs, and **retrievers** let a chain pull relevant documents into the prompt at request time. Both are Runnables, so they compose with the LCEL pipelines from [LangChain Fundamentals](/langchain-fundamentals) and graduate cleanly into graphs in [LangGraph](/langgraph). This lesson covers the tool and retriever contracts and wires a production retrieval pipeline on Cloudflare Vectorize behind a Workers handler. For the broader retrieval theory see [RAG](/rag) and [Advanced RAG](/advanced-rag); for the model-side calling primitive see [Tool Use & Function Calling](/function-calling).

## Mental Model

### What problem does it solve?

Models hallucinate when asked about facts they never saw and cannot act on the world at all. A tool is a typed function the model is *allowed to request*: the model emits a structured call, your runtime executes it, and the result returns as a message. A retriever is a read-only specialization — given a query string it returns the top-k documents — used to stuff a prompt with grounded context before generation. Tools change state and answer "do X"; retrievers fetch evidence and answer "what do we know about Y". Most real assistants need both.

### The research-assistant analogy

Picture a research assistant with a filing cabinet and a telephone. The filing cabinet is the retriever: ask a question, get back the three most relevant folders. The telephone is the tool set: call the billing system, book a meeting, run a calculation. A good assistant decides per question whether to open the cabinet, pick up the phone, or both, then writes the answer from what came back. LangChain gives you the cabinet and the phone with a uniform interface; deciding *when* to use which is the model's job, refined by your prompt.

### A tool in ~10 lines

```python
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

@tool
def order_status(order_id: str) -> str:
    """Look up the shipping status for an order id."""
    row = d1.prepare("SELECT status FROM orders WHERE id=?").bind(order_id).first()
    return row["status"] if row else "unknown"

model = ChatOpenAI(model="@cf/meta/llama-3.1-70b-instruct").bind_tools([order_status])
ai = model.invoke("Where is order A-42?")
print(ai.tool_calls)  # [{'name': 'order_status', 'args': {'order_id': 'A-42'}}]
```

The `@tool` decorator turns a typed function plus its docstring into a schema the model sees. `bind_tools` attaches that schema; the model returns *intent*, not execution — your runtime runs the call and feeds the result back, the loop the diagram below traces.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "q", "label": "user question", "shape": "stadium"},
    {"id": "model", "label": "model.bind_tools", "shape": "rect"},
    {"id": "dec", "label": "tool_calls present?", "shape": "diamond"},
    {"id": "exec", "label": "execute tool fn (D1)", "shape": "rect"},
    {"id": "obs", "label": "ToolMessage result", "shape": "rect"},
    {"id": "ans", "label": "final answer", "shape": "stadium"}
  ],
  "edges": [
    {"source": "q", "target": "model"},
    {"source": "model", "target": "dec"},
    {"source": "dec", "target": "exec", "label": "yes"},
    {"source": "dec", "target": "ans", "label": "no"},
    {"source": "exec", "target": "obs"},
    {"source": "obs", "target": "model", "label": "loop back"}
  ]
}
```

## Core Concepts

### The tool contract

A tool is a Runnable with a name, a description, an argument schema (a Pydantic model or typed signature), and an implementation. The description is prompt-critical: the model selects tools by reading it, so vague docstrings cause wrong calls. Tools may be sync or async; on Workers prefer async so a slow API call yields the event loop. Errors should return a structured failure the model can recover from, not raise — a raised exception aborts the run, while a `"error: order not found"` string lets the model apologize or retry.

### The retriever contract

A retriever implements `get_relevant_documents(query)` (and the async `aget_relevant_documents`). The canonical implementation is `VectorStoreRetriever`: embed the query, nearest-neighbor search a vector index, return documents with metadata. On Cloudflare the vector index is [Vectorize](/vectorize-rag) and embeddings come from Workers AI. Retrievers are swappable — keyword (BM25), vector, or hybrid — without touching the chain that consumes them, the same substitutability you saw with models in [LangChain Fundamentals](/langchain-fundamentals).

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "base", "label": "BaseRetriever", "shape": "rect"},
    {"id": "vs", "label": "VectorStoreRetriever (Vectorize)", "shape": "rect"},
    {"id": "bm", "label": "BM25Retriever (keyword)", "shape": "rect"},
    {"id": "mq", "label": "MultiQueryRetriever", "shape": "rect"},
    {"id": "cc", "label": "ContextualCompressionRetriever", "shape": "rect"},
    {"id": "ens", "label": "EnsembleRetriever", "shape": "diamond"}
  ],
  "edges": [
    {"source": "base", "target": "vs"},
    {"source": "base", "target": "bm"},
    {"source": "vs", "target": "mq", "label": "wraps"},
    {"source": "vs", "target": "cc", "label": "wraps + reranks"},
    {"source": "vs", "target": "ens"},
    {"source": "bm", "target": "ens", "label": "weighted fuse"}
  ]
}
```

## How It Works

### A RAG chain composed from a retriever

The retriever plugs into the `.assign` enrichment pattern: keep the question, add retrieved context, format a grounded prompt, generate. Because the retriever is a Runnable, the whole pipeline streams and traces like any LCEL chain.

```python
from langchain_core.runnables import RunnablePassthrough
from langchain_core.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_template(
    "Answer only from context.\n\nContext:\n{context}\n\nQ: {question}")
rag = (
    RunnablePassthrough.assign(context=lambda x: retriever.invoke(x["question"]))
    | prompt | model | StrOutputParser()
)
```

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "qin", "label": "{question}", "shape": "stadium"},
    {"id": "emb", "label": "embed query (Workers AI)", "shape": "rect"},
    {"id": "vz", "label": "Vectorize topK", "shape": "rect"},
    {"id": "docs", "label": "Documents + metadata", "shape": "rect"},
    {"id": "asg", "label": "assign context", "shape": "diamond"},
    {"id": "gen", "label": "prompt | model | parser", "shape": "rect"},
    {"id": "out", "label": "grounded answer", "shape": "stadium"}
  ],
  "edges": [
    {"source": "qin", "target": "emb"},
    {"source": "emb", "target": "vz"},
    {"source": "vz", "target": "docs", "label": "scores"},
    {"source": "docs", "target": "asg"},
    {"source": "qin", "target": "asg", "label": "passthrough"},
    {"source": "asg", "target": "gen"},
    {"source": "gen", "target": "out"}
  ]
}
```

## Runtime Internals

### Contextual compression and reranking

Raw top-k often returns long, partly-irrelevant chunks that waste context window and dilute the answer. `ContextualCompressionRetriever` wraps a base retriever with a compressor — an extractive filter or a cross-encoder reranker — that trims each document to the query-relevant span before it reaches the prompt. On Workers the reranker is a small Workers AI model invoked per candidate; the trade is one extra inference round for a tighter, cheaper generation prompt, a lever that feeds [Cost Optimization](/cost-optimization).

### Multi-query and ensemble fusion

`MultiQueryRetriever` asks the model to paraphrase the question into several variants, retrieves for each, and unions the results — robust against vocabulary mismatch. `EnsembleRetriever` fuses a vector retriever and a BM25 retriever with reciprocal-rank fusion, combining semantic recall with exact-term precision. Both are themselves retrievers, so they drop into the same RAG chain unchanged.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "q", "label": "question", "shape": "stadium"},
    {"id": "v1", "label": "paraphrase 1..n (model)", "shape": "rect"},
    {"id": "vec", "label": "vector retriever", "shape": "rect"},
    {"id": "bm", "label": "BM25 retriever", "shape": "rect"},
    {"id": "rrf", "label": "reciprocal-rank fusion", "shape": "diamond"},
    {"id": "top", "label": "merged top-k", "shape": "stadium"}
  ],
  "edges": [
    {"source": "q", "target": "v1"},
    {"source": "v1", "target": "vec", "label": "each variant"},
    {"source": "q", "target": "bm"},
    {"source": "vec", "target": "rrf"},
    {"source": "bm", "target": "rrf"},
    {"source": "rrf", "target": "top"}
  ]
}
```

## Patterns

**Pattern 1 — Tool-augmented answer.** Bind a few sharp tools; let the model pick. **Pattern 2 — Retriever-as-tool.** Wrap a retriever in `@tool` so an agent decides whether to search at all. **Pattern 3 — Hybrid retrieval.** Ensemble vector + keyword for mixed natural-language and exact-ID queries. **Pattern 4 — Compress then generate.** Rerank to fit a small context window on cheap models. **Pattern 5 — Tool result as evidence.** Treat a tool's structured return as retrieved context for a cited answer, the bridge to [Advanced RAG](/advanced-rag).

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "qa", "label": "agent question", "shape": "stadium"},
    {"id": "router", "label": "model picks capability", "shape": "diamond"},
    {"id": "ret", "label": "retriever-as-tool", "shape": "rect"},
    {"id": "api", "label": "action tool (write)", "shape": "rect"},
    {"id": "syn", "label": "synthesis prompt", "shape": "rect"},
    {"id": "fin", "label": "cited answer", "shape": "stadium"}
  ],
  "edges": [
    {"source": "qa", "target": "router"},
    {"source": "router", "target": "ret", "label": "needs evidence"},
    {"source": "router", "target": "api", "label": "needs action"},
    {"source": "ret", "target": "syn"},
    {"source": "api", "target": "syn"},
    {"source": "syn", "target": "fin"}
  ]
}
```

## Common Pitfalls

**Weak tool descriptions.** The model routes on the docstring; ambiguous text causes wrong-tool calls — write them like API docs. **Raising inside tools.** An exception aborts the run; return a recoverable error string instead. **Unbounded retrieval.** Top-k of 20 long chunks blows the context window and the bill; compress or lower k. **Stale index.** A Vectorize index not refreshed after source changes returns confidently wrong context — wire reindexing into your write path. **Embedding mismatch.** Querying with a different embedding model than you indexed with silently destroys recall; pin the model and version.

## Comparison

A retriever versus a tool: the retriever is read-only, deterministic in shape, and always returns documents; a tool is general, may mutate state, and returns arbitrary typed data. Versus hand-rolled RAG, LangChain's retriever interface buys you free swapping of backends and composable wrappers (multi-query, compression, ensemble) that would otherwise be bespoke code. Versus graph agents in [LangGraph Multi-Agent Topologies](/langgraph-multi-agent), an LCEL tool-and-retriever chain cannot loop or hand off — it is the right tool when retrieval is a single bounded step rather than an open-ended deliberation.

## Cross-References

- [LangChain Fundamentals](/langchain-fundamentals) — the Runnable/LCEL substrate
- [RAG](/rag) and [Advanced RAG](/advanced-rag) — retrieval theory and evaluation
- [Vectorize-backed RAG on Workers](/vectorize-rag) and [Vector Databases](/vector-databases)
- [Tool Use & Function Calling](/function-calling) — the model-side calling primitive
- [LangGraph](/langgraph) — when retrieval becomes a looping, stateful step
