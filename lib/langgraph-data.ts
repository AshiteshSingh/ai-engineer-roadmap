export interface LangGraphCourse {
  id: string;
  title: string;
  url: string;
  instructor: string;
  instructorTitle: string;
  headline: string;
  description: string;
  rating: number;
  reviewCount: number;
  numStudents: number;
  numLectures: number;
  level: string;
  durationHours: number;
  lastUpdated: string;
  whatYouLearn: string[];
  requirements: string[];
  tags: string[];
}

export interface LangGraphConcept {
  id: string;
  name: string;
  icon: string;
  description: string;
  details: string[];
}

export interface LangGraphStep {
  num: number;
  title: string;
  description: string;
}

export const concepts: LangGraphConcept[] = [
  {
    id: "state-graph",
    name: "StateGraph",
    icon: "\u{1f9e9}",
    description:
      "The core abstraction. A typed state object flows through every node in the graph, accumulating information as it moves.",
    details: [
      "Define state as a TypedDict or Pydantic model",
      "Reducers control how node outputs merge into state",
      "State is the single source of truth for the entire workflow",
    ],
  },
  {
    id: "nodes",
    name: "Nodes",
    icon: "\u{2699}\u{fe0f}",
    description:
      "Python functions that receive the current state, perform work (LLM calls, tool use, computation), and return state updates.",
    details: [
      "Each node is a regular Python function",
      "Nodes can call LLMs, APIs, databases, or other tools",
      "Return a dict of state keys to update",
    ],
  },
  {
    id: "edges",
    name: "Edges",
    icon: "\u{27a1}\u{fe0f}",
    description:
      "Connections between nodes that define the execution flow. Normal edges always route to one target; conditional edges branch dynamically.",
    details: [
      "Normal edges: deterministic A \u2192 B routing",
      "Conditional edges: runtime branching based on state",
      "START and END are special sentinel nodes",
    ],
  },
  {
    id: "conditional-routing",
    name: "Conditional Routing",
    icon: "\u{1f500}",
    description:
      "Branching logic that inspects state and decides which node to execute next \u2014 the mechanism that enables agentic decision-making.",
    details: [
      "Router functions return the name of the next node",
      "Enables cycles: agents can loop until a condition is met",
      "Supports fan-out to multiple parallel branches",
    ],
  },
  {
    id: "checkpointing",
    name: "Checkpointing",
    icon: "\u{1f4be}",
    description:
      "Automatic persistence of graph state after every node execution. Enables time-travel debugging, replay, and fault tolerance.",
    details: [
      "Built-in memory, SQLite, and Postgres checkpointers",
      "Resume interrupted graphs from any checkpoint",
      "Thread-based isolation for concurrent conversations",
    ],
  },
  {
    id: "human-in-the-loop",
    name: "Human-in-the-Loop",
    icon: "\u{1f9d1}\u200d\u{1f4bb}",
    description:
      "Interrupt the graph at designated breakpoints so humans can inspect, approve, edit, or reject state before the graph continues.",
    details: [
      "interrupt_before / interrupt_after on any node",
      "Human can modify state before resuming",
      "Critical for high-stakes decisions (approvals, reviews)",
    ],
  },
  {
    id: "subgraphs",
    name: "Subgraphs",
    icon: "\u{1f4e6}",
    description:
      "Nested graphs that encapsulate a sub-workflow. Compose complex agents from smaller, testable, reusable graph modules.",
    details: [
      "Each subgraph has its own state schema",
      "Parent passes data in, subgraph returns results",
      "Enables team-of-experts and modular architectures",
    ],
  },
  {
    id: "multi-agent",
    name: "Multi-Agent Patterns",
    icon: "\u{1f916}",
    description:
      "Orchestration patterns for multiple specialized agents: supervisor delegates, teams collaborate, hierarchies scale.",
    details: [
      "Supervisor pattern: one agent routes to specialists",
      "Swarm: agents hand off to each other dynamically",
      "Hierarchical: nested supervisors manage sub-teams",
    ],
  },
];

export const steps: LangGraphStep[] = [
  {
    num: 1,
    title: "Define your State",
    description:
      "Create a TypedDict or Pydantic model that represents all the information your agent needs to track \u2014 messages, intermediate results, tool outputs, decisions.",
  },
  {
    num: 2,
    title: "Create Nodes",
    description:
      "Write Python functions for each step of your workflow. Each node receives the current state, does its work (call an LLM, query a database, run a tool), and returns updates.",
  },
  {
    num: 3,
    title: "Connect with Edges",
    description:
      "Wire nodes together using normal edges for fixed routes and conditional edges for dynamic branching. Add cycles to let agents iterate until they reach a satisfactory result.",
  },
  {
    num: 4,
    title: "Compile the Graph",
    description:
      "Call graph.compile() with an optional checkpointer for persistence. LangGraph validates the graph structure and prepares it for execution.",
  },
  {
    num: 5,
    title: "Invoke with Input",
    description:
      "Pass an initial state to graph.invoke() or stream results with graph.stream(). The graph executes nodes in order, routing through edges until it reaches END.",
  },
];

export const courses: LangGraphCourse[] = [
  {
    id: "langchain-agentic-ai",
    title: "LangChain \u2014 Agentic AI Engineering with LangChain & LangGraph",
    url: "https://www.udemy.com/course/langchain/",
    instructor: "Eden Marco",
    instructorTitle: "LLM Specialist @ Google Cloud",
    headline:
      "Build AI Agents with LangChain and LangGraph RAG, Tools, MCP and Production-Ready Agentic AI Systems (Python)",
    description:
      "Re-recorded for 2026 supporting LangChain 1.2+. Learn how to design and build AI agents and agentic AI systems using LangChain and LangGraph. Covers production-ready AI agents, RAG systems, MCP, Deep Agents, and advanced LLM applications.",
    rating: 4.6,
    reviewCount: 48018,
    numStudents: 166321,
    numLectures: 166,
    level: "Intermediate",
    durationHours: 18.0,
    lastUpdated: "2026-03",
    whatYouLearn: [
      "Become proficient in LangChain",
      "Build end-to-end working generative AI agents",
      "Prompt Engineering: Chain of Thought, ReAct, Few Shot",
      "Context Engineering",
      "Navigate the LangChain open-source codebase",
      "LLM theory for software engineers",
    ],
    requirements: [
      "Familiar with git, Python, pipenv, OOP, testing and debugging",
      "No Machine Learning experience needed",
    ],
    tags: ["Bestseller", "166K+ students"],
  },
  {
    id: "agentic-ai-bootcamp",
    title: "Complete Agentic AI Bootcamp With LangGraph and LangChain",
    url: "https://www.udemy.com/course/complete-agentic-ai-bootcamp-with-langgraph-and-langchain/",
    instructor: "Krish Naik",
    instructorTitle: "Chief AI Engineer",
    headline:
      "Learn to build real-world AI agents, multi-agent workflows, and autonomous apps with LangGraph and LangChain",
    description:
      "Teaches intelligent agent development using LangGraph and LangChain. Students learn how AI agents differ from traditional models, covering memory, tools, and decision-making systems. Spans from foundational concepts through deploying production-ready multi-agent systems.",
    rating: 4.54,
    reviewCount: 4947,
    numStudents: 42641,
    numLectures: 164,
    level: "All Levels",
    durationHours: 38.5,
    lastUpdated: "2025-12",
    whatYouLearn: [
      "Foundational Agentic AI principles and autonomous agent design",
      "LangGraph workflows: state, memory, and event-driven systems",
      "Collaborative multi-agent frameworks",
      "Autonomous event-driven AI workflows with reasoning and tools",
      "Single-agent and multi-agent deployment and optimization",
      "Real-world projects: RAG agents and auto-research agents",
    ],
    requirements: [
      "Basic Python programming",
      "Understanding of APIs and RESTful services",
      "No prior LangGraph experience needed",
    ],
    tags: ["42K+ students", "Most comprehensive"],
  },
  {
    id: "langgraph-eden-marco",
    title: "LangGraph \u2014 Develop LLM-Powered AI Agents with LangGraph",
    url: "https://www.udemy.com/course/langgraph/",
    instructor: "Eden Marco",
    instructorTitle: "GenAI Architect @ Google Cloud, LangChain Ambassador",
    headline:
      "Learn LangGraph by building FAST a real world LLM AI Agents (Python)",
    description:
      "Teaches developers how to leverage LangGraph for building sophisticated LLM-powered agentic applications. Positions LangGraph as superior to standard LangChain for complex agent flows, emphasizing flow engineering as a strategic approach.",
    rating: 4.54,
    reviewCount: 3336,
    numStudents: 25140,
    numLectures: 80,
    level: "Advanced",
    durationHours: 7.7,
    lastUpdated: "2026-03",
    whatYouLearn: [
      "Proficiency with LangGraph for agentic applications",
      "Advanced agent patterns: Multi-agent, Reflection, Reflexion",
      "Navigate the LangGraph open-source codebase",
      "LangGraph ecosystem: Studio/IDE, Cloud API, Managed Service",
      "Advanced RAG: Corrective RAG, Adaptive RAG, Self-RAG",
      "Parallel execution with fan-out/fan-in patterns",
      "Human-in-the-loop workflows and persistence",
      "CrewAI vs LangGraph comparison",
    ],
    requirements: [
      "Strong Python proficiency",
      "Solid LangChain expertise",
      "Software engineering background",
    ],
    tags: ["LangGraph-focused", "25K+ students"],
  },
  {
    id: "complete-langchain-langgraph-langsmith",
    title: "The Complete LangChain, LangGraph, & LangSmith Course (2026)",
    url: "https://www.udemy.com/course/the-complete-langchain-langgraph-langsmith-course/",
    instructor: "Fikayo Adepoju",
    instructorTitle: "Serial Author, 10+ years building distributed apps",
    headline:
      "Modularize with LangChain, Build Agents with LangGraph, and Monitor with LangSmith",
    description:
      "The most complete, up-to-date guide on the modern AI stack: LangChain, LangGraph, and LangSmith. Takes you from beginner to professional AI Engineer by mastering the three pillars of the LangChain ecosystem.",
    rating: 4.67,
    reviewCount: 44,
    numStudents: 373,
    numLectures: 91,
    level: "Beginner",
    durationHours: 29.5,
    lastUpdated: "2026-02",
    whatYouLearn: [
      "LCEL Orchestration: composable AI pipelines with Runnable interfaces",
      "Autonomous agents that reason and interact with external tools",
      "Stateful graphs: non-linear AI workflows with branching and looping",
      "Checkpointers for saving graph state and resuming tasks",
      "LangSmith for production monitoring and tracing",
      "Evaluation functions to measure AI system quality",
    ],
    requirements: [
      "Basic Python knowledge",
      "Understanding of API basics",
      "No prior AI experience required",
    ],
    tags: ["Full stack", "2026 edition"],
  },
  {
    id: "ai-agents-langgraph",
    title: "AI Agents: Develop Autonomous AI Agents with LangGraph",
    url: "https://www.udemy.com/course/ai-agents/",
    instructor: "Paulo Dichone",
    instructorTitle: "Software Engineer, AWS Cloud Practitioner, 350K+ students",
    headline:
      "Develop High-Performance, Autonomous, AI Agents, Using LangChain, LangGraph (Python)",
    description:
      "Meticulously designed to elevate your understanding from beginner to advanced, enabling you to create scalable AI agents. Build a comprehensive Financial Report Writer/Researcher Agent.",
    rating: 4.67,
    reviewCount: 418,
    numStudents: 3719,
    numLectures: 38,
    level: "All Levels",
    durationHours: 3.0,
    lastUpdated: "2025-02",
    whatYouLearn: [
      "Fundamentals and significance of AI agents",
      "LangGraph building blocks and main components",
      "Step-by-step agent construction from basic to advanced",
      "Build a Financial Report Writer/Researcher Agent",
      "Advanced optimization for scalable agents",
    ],
    requirements: [
      "Python basics or any OOP language",
      "Basics of LLM and AI",
    ],
    tags: ["Project-based", "Quick start"],
  },
  {
    id: "ultimate-rag-bootcamp",
    title: "Ultimate RAG Bootcamp Using LangChain, LangGraph & LangSmith",
    url: "https://www.udemy.com/course/ultimate-rag-bootcamp-using-langchainlanggraph-langsmith/",
    instructor: "Krish Naik",
    instructorTitle: "Chief AI Engineer",
    headline:
      "Build powerful RAG pipelines: Traditional, Advanced, Multimodal & Agentic AI with LangChain, LangGraph and LangSmith",
    description:
      "Complete, step-by-step guide to mastering RAG using LangChain, LangGraph, and LangSmith. From fundamentals of RAG pipelines to advanced Agentic RAG architectures used in production. Covers vector databases, chunking strategies, and production deployment.",
    rating: 4.62,
    reviewCount: 2450,
    numStudents: 21138,
    numLectures: 137,
    level: "All Levels",
    durationHours: 31.5,
    lastUpdated: "2025-12",
    whatYouLearn: [
      "Traditional RAG pipelines for information retrieval",
      "Advanced retrieval: hybrid search, multimodal RAG, persistent memory",
      "Multi-agent and autonomous RAG systems using LangGraph",
      "LangSmith for tracking, debugging, and optimizing RAG",
      "Vector databases: FAISS, Pinecone, Weaviate",
      "Domain-specific knowledge chatbots with hybrid search",
      "Multimodal AI assistants processing text and images",
      "Cloud deployment to production",
    ],
    requirements: [
      "Basic Python programming",
      "No prior RAG experience required",
      "Basic LangChain knowledge helpful",
    ],
    tags: ["RAG-focused", "21K+ students"],
  },
  {
    id: "private-agentic-rag-ollama",
    title: "Agentic AI \u2014 Private Agentic RAG with LangGraph and Ollama",
    url: "https://www.udemy.com/course/agentic-ai-private-agentic-rag-with-langgraph-and-ollama/",
    instructor: "Laxmi Kant Tiwari",
    instructorTitle: "Senior Data Science & AI Engineer",
    headline:
      "LangGraph v1, Ollama, Agentic RAG, Private RAG, Corrective RAG, CRAG, Reflexion, Self-RAG, Adaptive RAG",
    description:
      "Advanced, project-based course teaching private, production-ready RAG systems using LangGraph, Ollama, ChromaDB, and Docling. All projects run 100% locally with no external API cost. Uses real SEC financial filings as data sources.",
    rating: 4.61,
    reviewCount: 248,
    numStudents: 3377,
    numLectures: 152,
    level: "Advanced",
    durationHours: 16.5,
    lastUpdated: "2026-03",
    whatYouLearn: [
      "Private Agentic RAG systems with LangGraph v1 and Ollama",
      "LangGraph state machines, nodes, edges, conditional routing",
      "PageRAG, metadata extraction, PDF processing with Docling",
      "ChromaDB, embeddings, metadata filtering, MMR retrieval",
      "Corrective RAG with document grading and web search fallback",
      "Reflexion, Self-RAG and Adaptive RAG systems",
      "Custom Ollama models and Modelfiles",
    ],
    requirements: [
      "Good LangGraph or LangChain knowledge required",
      "Not suitable for absolute beginners",
      "Basic Python programming",
    ],
    tags: ["100% local", "Privacy-first"],
  },
  {
    id: "production-ai-agents-js",
    title: "Production AI Agents with JavaScript: LangChain & LangGraph",
    url: "https://www.udemy.com/course/production-ai-agents-with-javascript-langchain-langgraph/",
    instructor: "Sangam Mukherjee",
    instructorTitle: "Full-Stack & DevOps Instructor",
    headline:
      "Production-grade AI agents with LangChain.js, LangGraph.js, RAG, Next.js, LangSmith & real JS/TS projects",
    description:
      "Built for JavaScript & TypeScript engineers who want real, shippable agentic systems. Build end-to-end projects that mirror how modern teams ship AI features: TypeScript, JSON contracts, LangGraph orchestration, RAG, and real Next.js frontends.",
    rating: 4.61,
    reviewCount: 72,
    numStudents: 624,
    numLectures: 112,
    level: "All Levels",
    durationHours: 16.5,
    lastUpdated: "2025-12",
    whatYouLearn: [
      "Production-ready AI agents with LangChain.js and LangGraph.js",
      "Web search agents, documentation chatbots with RAG",
      "Zod schema validation, tool calling, structured outputs",
      "Multi-provider setup: OpenAI, Gemini, Groq via provider factory",
      "Chunk, embed, upsert into vector store; retrieve with citations",
      "Deploy agents with LangSmith + LangGraph Cloud",
    ],
    requirements: [
      "JavaScript/TypeScript proficiency",
      "Familiarity with Node.js",
      "No prior AI/ML experience required",
    ],
    tags: ["JavaScript/TS", "Next.js"],
  },
  {
    id: "langgraph-basics-to-advanced",
    title: "LangGraph: From Basics to Advanced AI Agents with LLMs",
    url: "https://www.udemy.com/course/langgraph-from-basics-to-advanced-ai-agents-with-llms/",
    instructor: "Tensor Teach",
    instructorTitle: "AI Education That Bridges Theory and Practice",
    headline: "Learn how to build custom AI Agents with LangGraph",
    description:
      "A structured, step-by-step approach to mastering AI agent development with LangGraph, from fundamental concepts to advanced techniques.",
    rating: 4.56,
    reviewCount: 44,
    numStudents: 966,
    numLectures: 19,
    level: "Intermediate",
    durationHours: 1.6,
    lastUpdated: "2025-05",
    whatYouLearn: [
      "Core principles: graphs, nodes, edges, and states",
      "Constructing basic and News Writer agents",
      "Integrating state and tools into agents",
      "Reflection techniques",
      "Human-in-the-loop processes",
      "Checkpointers and threads",
    ],
    requirements: [
      "Prior Python experience",
      "Some experience with LangChain",
    ],
    tags: ["Concise", "Focused"],
  },
  {
    id: "langgraph-in-action",
    title: "LangGraph in Action: Develop Advanced AI Agents with LLMs",
    url: "https://www.udemy.com/course/langgraph-in-action-develop-advanced-ai-agents-with-llms/",
    instructor: "Markus Lang",
    instructorTitle: "Software Engineer, Python Developer, LLM Expert in finance",
    headline:
      "Master the Fundamentals of AI Agents with LangGraph (Version 1.0.0)",
    description:
      "Your ultimate guide to mastering the design and deployment of advanced AI agents using LangGraph. Explore modular, scalable, and production-ready agents with a hands-on approach.",
    rating: 4.45,
    reviewCount: 685,
    numStudents: 5089,
    numLectures: 48,
    level: "Intermediate",
    durationHours: 3.5,
    lastUpdated: "2026-01",
    whatYouLearn: [
      "State-based design with LangGraph nodes and edges",
      "Memory: short-term checkpointers + long-term Store object",
      "Human-in-the-loop, parallel execution, multi-agent patterns",
      "Production: async operations, subgraphs",
      "Full-stack applications with FastAPI and Docker",
      "Unit testing LangGraph applications",
    ],
    requirements: [
      "Software engineering experience",
      "LangChain experience",
      "Python proficiency",
    ],
    tags: ["Production-grade", "FastAPI + Docker"],
  },
  {
    id: "langgraph-for-beginners",
    title: "LangGraph for Beginners: Agentic Workflows in Simple Steps",
    url: "https://www.udemy.com/course/langgraph-for-beginners/",
    instructor: "Bharath Thippireddy",
    instructorTitle: "IT Architect and Best Selling Instructor",
    headline: "Learn to Build Intelligent Agents, One Step at a Time",
    description:
      "Beginner-friendly course teaching LangGraph, an open-source library built on top of LangChain for orchestrating multi-agent applications using a graph-based architecture.",
    rating: 4.49,
    reviewCount: 318,
    numStudents: 2599,
    numLectures: 67,
    level: "Beginner",
    durationHours: 3.1,
    lastUpdated: "2026-03",
    whatYouLearn: [
      "What LangGraph is and how it fits into the GenAI ecosystem",
      "Build workflows using state machines and Pydantic validation",
      "Async, streaming, and conditional routing",
      "Reducers and state transitions",
      "Tool calling with ToolNode",
      "Checkpointers: in-memory, SQLite, Redis",
      "Agentic RAG workflows and Human-in-the-Loop",
      "Real-world: claim processing, customer support, document analysis",
    ],
    requirements: [
      "Basic Python programming",
      "No advanced AI/ML experience required",
    ],
    tags: ["Beginner-friendly", "Real-world use cases"],
  },
  {
    id: "langgraph-mastery",
    title: "LangGraph Mastery: Develop LLM Agents with LangGraph",
    url: "https://www.udemy.com/course/langgraph-mastery-develop-llm-agents-with-langgraph/",
    instructor: "Andrei Dumitrescu",
    instructorTitle: "Software Engineer, Crystal Mind Academy, 50K+ students",
    headline:
      "Master the Power of LLM Agents with LangChain and LangGraph: Create AI Workflows, Automate Tasks and Transform Your Apps",
    description:
      "Delves into LangGraph, an extension of LangChain for agent and multi-agent workflows. Teaches building autonomous LLM agents, multi-agent systems, and production-grade debugging.",
    rating: 4.41,
    reviewCount: 413,
    numStudents: 4235,
    numLectures: 74,
    level: "Intermediate",
    durationHours: 5.4,
    lastUpdated: "2026-03",
    whatYouLearn: [
      "LangGraph fundamentals: nodes, edges, state management",
      "LangChain with real-world tools for multi-agent workflows",
      "Autonomous agents with memory and tool observation",
      "RAG with Pinecone",
      "Debug production apps with LangSmith",
      "Reflection, reflexion, and flow engineering patterns",
      "Tavily AI and agentic search",
    ],
    requirements: [
      "Good knowledge of Python",
      "Good knowledge of LangChain",
      "Not for beginners",
    ],
    tags: ["LangSmith debugging", "Pinecone RAG"],
  },
  {
    id: "master-langgraph-ollama",
    title: "Master LangGraph v1 and Ollama \u2014 Build Gen AI Agents",
    url: "https://www.udemy.com/course/langgraph-with-ollama/",
    instructor: "Laxmi Kant (KGP Talkie)",
    instructorTitle: "Senior Data Science & AI Engineer, IIT Kharagpur Graduate",
    headline:
      "LangChain v1, MCP, MySQL, DeepSeek, GPT-OSS, Qwen3, LLAMA, LangGraph, Ollama",
    description:
      "Re-designed and rebuilt from scratch for LangChain v1+ and LangGraph v1+. Build real AI agents using open source LLMs like GPT-OSS, Qwen3 and Gemma3.",
    rating: 4.35,
    reviewCount: 474,
    numStudents: 4711,
    numLectures: 131,
    level: "Beginner",
    durationHours: 13.7,
    lastUpdated: "2026-03",
    whatYouLearn: [
      "Ollama integration with LangChain v1",
      "Run Qwen3, Gemma3, GPT-OSS, DeepSeek-R1 models",
      "LangGraph v1: states, nodes, reducers, conditional routing",
      "ReAct agents, tool calling, memory, streaming",
      "SQLite + PostgreSQL persistence for agent state",
      "Guardrails, interrupts, human-in-the-loop approvals",
      "Advanced agents: Reflection, Critique, Research, Model-Selection",
      "MCP integration and MySQL agent",
    ],
    requirements: [
      "Basic Python programming",
      "Understanding of APIs",
      "Command line proficiency",
    ],
    tags: ["Open-source LLMs", "MCP integration"],
  },
  {
    id: "basic-rag-ollama",
    title: "Basic RAG with LangChain and LangGraph \u2014 Ollama",
    url: "https://www.udemy.com/course/agentic-rag-with-langchain-and-langgraph/",
    instructor: "Laxmi Kant (KGP Talkie)",
    instructorTitle: "IIT Kharagpur Graduate, Senior AI Engineer, 100K+ students",
    headline:
      "Step-by-Step Guide to RAG with LangChain, LangGraph, and Ollama | DeepSeek R1, QWEN, LLAMA, FAISS",
    description:
      "Step-by-step guide to building smart AI systems using LangChain, LangGraph, Ollama, and OpenAI for Retrieval-Augmented Generation systems.",
    rating: 4.46,
    reviewCount: 52,
    numStudents: 2349,
    numLectures: 68,
    level: "All Levels",
    durationHours: 7.4,
    lastUpdated: "2026-02",
    whatYouLearn: [
      "Ollama setup and configuration for AI models",
      "LangChain and LangGraph basics together",
      "Document loading with Doclings",
      "Vector stores and retrieval pipelines",
      "Agentic RAG: smart assistant-style systems",
      "Corrective, adaptive, and self-improving RAG",
      "Deploy with Streamlit and AWS EC2",
    ],
    requirements: [
      "Basic Python knowledge",
      "Curiosity to learn AI concepts",
    ],
    tags: ["RAG starter", "Streamlit deploy"],
  },
];

/** Aggregate stats derived from course data */
export function getCourseStats() {
  const totalStudents = courses.reduce((s, c) => s + c.numStudents, 0);
  const totalReviews = courses.reduce((s, c) => s + c.reviewCount, 0);
  const totalHours = courses.reduce((s, c) => s + c.durationHours, 0);
  const avgRating =
    courses.reduce((s, c) => s + c.rating, 0) / courses.length;
  return {
    totalStudents,
    totalReviews,
    totalHours: Math.round(totalHours),
    avgRating: avgRating.toFixed(2),
    courseCount: courses.length,
  };
}
