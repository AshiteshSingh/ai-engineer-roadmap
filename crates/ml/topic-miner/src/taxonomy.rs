//! Skill taxonomy — ported from lead-gen's skill-taxonomy.ts.
//!
//! Each entry maps a kebab-case slug to a human label, category, and a set of
//! regex patterns that detect the skill in source code.

use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Debug, Clone)]
pub struct SkillDef {
    pub tag: &'static str,
    pub label: &'static str,
    pub category: &'static str,
    /// Regex patterns (case-insensitive) that signal this skill in code.
    pub patterns: &'static [&'static str],
}

/// All canonical skill tags with detection patterns.
pub static TAXONOMY: LazyLock<HashMap<&'static str, SkillDef>> = LazyLock::new(|| {
    let entries: Vec<SkillDef> = vec![
        // ── Programming Languages ────────────────────────────────────────────
        s("javascript", "JavaScript", "Languages", &[r#"\.js$"#, r#"\.mjs$"#, r#"\.cjs$"#]),
        s("typescript", "TypeScript", "Languages", &[r#"\.ts$"#, r#"\.tsx$"#, "tsconfig"]),
        s("python", "Python", "Languages", &[r#"\.py$"#, r#"import\s+\w+"#, r#"from\s+\w+\s+import"#]),
        s("java", "Java", "Languages", &[r#"\.java$"#, r#"import\s+java\."#]),
        s("csharp", "C#", "Languages", &[r#"\.cs$"#, r#"using\s+System"#]),
        s("ruby", "Ruby", "Languages", &[r#"\.rb$"#, r#"require\s+['"]\w+"#]),
        s("php", "PHP", "Languages", &[r#"\.php$"#, r#"<\?php"#]),
        s("go", "Go", "Languages", &[r#"\.go$"#, r#"package\s+main"#, r#"import\s+\("#]),
        s("rust", "Rust", "Languages", &[r#"\.rs$"#, r#"Cargo\.toml"#, r#"use\s+std::"#]),
        s("swift", "Swift", "Languages", &[r#"\.swift$"#, r#"import\s+Foundation"#]),
        s("kotlin", "Kotlin", "Languages", &[r#"\.kt$"#, r#"import\s+kotlin"#]),
        s("scala", "Scala", "Languages", &[r#"\.scala$"#]),
        s("elixir", "Elixir", "Languages", &[r#"\.ex$"#, r#"\.exs$"#, "defmodule"]),

        // ── Frontend Frameworks ──────────────────────────────────────────────
        s("react", "React", "Frontend", &[r#"from\s+['"]react['"]"#, r#"useState|useEffect|useRef|useCallback"#]),
        s("vue", "Vue.js", "Frontend", &[r#"from\s+['"]vue['"]"#, r#"\.vue$"#]),
        s("angular", "Angular", "Frontend", &[r#"@angular/"#, r#"\.component\.ts$"#]),
        s("svelte", "Svelte", "Frontend", &[r#"\.svelte$"#, r#"from\s+['"]svelte['"]"#]),
        s("nextjs", "Next.js", "Frontend", &[r#"from\s+['"]next"#, r#"next\.config"#, r#"app/layout\."#]),

        // ── Backend Frameworks ───────────────────────────────────────────────
        s("nodejs", "Node.js", "Backend", &[r#"require\("#, "node:", r#"process\.env"#]),
        s("express", "Express.js", "Backend", &[r#"from\s+['"]express['"]"#, r#"app\.listen"#]),
        s("django", "Django", "Backend", &[r#"from\s+django"#, "INSTALLED_APPS"]),
        s("flask", "Flask", "Backend", &[r#"from\s+flask"#, r#"@app\.route"#]),
        s("laravel", "Laravel", "Backend", &[r#"use\s+Illuminate"#]),
        s("fastapi", "FastAPI", "Backend", &[r#"from\s+fastapi"#, r#"FastAPI\(\)"#]),
        s("spring-boot", "Spring Boot", "Backend", &["@SpringBoot", "spring-boot"]),

        // ── Mobile ───────────────────────────────────────────────────────────
        s("react-native", "React Native", "Mobile", &["react-native"]),
        s("flutter", "Flutter", "Mobile", &[r#"import\s+['"]package:flutter"#]),
        s("ios", "iOS Development", "Mobile", &[r#"UIKit|SwiftUI|\.xcodeproj"#]),
        s("android", "Android Development", "Mobile", &[r#"android\."#, "AndroidManifest"]),

        // ── Databases ────────────────────────────────────────────────────────
        s("postgresql", "PostgreSQL", "Databases", &[r#"postgres|pg_|pgvector|neon"#, "@neondatabase"]),
        s("mysql", "MySQL", "Databases", &[r#"mysql2?['/]"#]),
        s("mongodb", "MongoDB", "Databases", &["mongodb|mongoose"]),
        s("redis", "Redis", "Databases", &["redis|ioredis"]),
        s("elasticsearch", "Elasticsearch", "Databases", &["elasticsearch|@elastic"]),
        s("cassandra", "Cassandra", "Databases", &["cassandra"]),
        s("dynamodb", "DynamoDB", "Databases", &["dynamodb|DynamoDB"]),
        s("sqlite", "SQLite", "Databases", &["sqlite|better-sqlite"]),
        s("sql", "SQL", "Databases", &[r#"\.sql$"#, r#"SELECT\s+.*FROM"#, r#"INSERT\s+INTO"#]),

        // ── Cloud & DevOps ───────────────────────────────────────────────────
        s("aws", "Amazon Web Services", "Cloud & DevOps", &[r#"@aws-sdk|aws-cdk|s3://|arn:aws"#]),
        s("gcp", "Google Cloud Platform", "Cloud & DevOps", &["@google-cloud|gcloud"]),
        s("azure", "Microsoft Azure", "Cloud & DevOps", &[r#"@azure|azure\."#]),
        s("docker", "Docker", "Cloud & DevOps", &[r#"[Dd]ockerfile|docker-compose|\.dockerignore"#]),
        s("kubernetes", "Kubernetes", "Cloud & DevOps", &["k8s|kubernetes|kubectl|helm"]),
        s("terraform", "Terraform", "Cloud & DevOps", &[r#"\.tf$|terraform"#]),
        s("ansible", "Ansible", "Cloud & DevOps", &[r#"ansible|playbook\.yml"#]),
        s("jenkins", "Jenkins", "Cloud & DevOps", &["[Jj]enkinsfile"]),
        s("ci-cd", "CI/CD", "Cloud & DevOps", &[r#"\.github/workflows|\.gitlab-ci|circleci"#]),
        s("circleci", "CircleCI", "Cloud & DevOps", &[r#"circleci|\.circleci"#]),
        s("serverless", "Serverless", "Cloud & DevOps", &[r#"serverless\.yml|@serverless|edge-runtime"#]),

        // ── Architecture ─────────────────────────────────────────────────────
        s("microservices", "Microservices", "Architecture", &["microservice|service-mesh"]),
        s("rest-api", "REST API", "Architecture", &[r#"app\.(get|post|put|delete|patch)\("#, r#"fetch\(|axios"#]),
        s("graphql", "GraphQL", "Architecture", &[r#"graphql|@apollo|gql|\.graphql$"#, "typeDefs|resolvers"]),
        s("grpc", "gRPC", "Architecture", &[r#"grpc|\.proto$|protobuf"#]),
        s("websocket", "WebSocket", "Architecture", &[r#"[Ww]eb[Ss]ocket|wss?://|ws\.on"#]),
        s("event-driven", "Event-Driven Architecture", "Architecture", &[r#"EventEmitter|pubsub|emit\("#]),

        // ── Tools ────────────────────────────────────────────────────────────
        s("git", "Git", "Tools", &[r#"\.git/|\.gitignore"#]),
        s("linux", "Linux", "Tools", &["/bin/|/usr/|chmod|chown"]),
        s("agile", "Agile", "Tools", &["sprint|kanban|scrum"]),
        s("tdd", "Test-Driven Development", "Tools", &[r#"describe\(|it\(|test\(|expect\(|assert"#]),
        s("webpack", "Webpack", "Tools", &[r#"webpack\.config"#]),
        s("jest", "Jest", "Tools", &[r#"jest\.config"#]),
        s("pytest", "pytest", "Tools", &[r#"import\s+pytest|@pytest"#]),
        s("tailwind", "Tailwind CSS", "Tools", &[r#"tailwind\.config|@tailwind"#]),

        // ── Data Science & ML ────────────────────────────────────────────────
        s("machine-learning", "Machine Learning", "Data Science & ML", &["sklearn|scikit|ml_|machine.?learn"]),
        s("deep-learning", "Deep Learning", "Data Science & ML", &["deep.?learn|neural.?net|backprop"]),
        s("tensorflow", "TensorFlow", "Data Science & ML", &[r#"tensorflow|import\s+tf"#]),
        s("pytorch", "PyTorch", "Data Science & ML", &[r#"import\s+torch|pytorch"#]),
        s("pandas", "Pandas", "Data Science & ML", &[r#"import\s+pandas|pd\.DataFrame"#]),
        s("numpy", "NumPy", "Data Science & ML", &[r#"import\s+numpy|np\.array"#]),
        s("scikit", "scikit-learn", "Data Science & ML", &[r#"from\s+sklearn|scikit"#]),
        s("nlp", "Natural Language Processing", "Data Science & ML", &["nlp|tokeniz|spacy|nltk|huggingface"]),
        s("computer-vision", "Computer Vision", "Data Science & ML", &["computer.?vision|opencv|yolo|image.?classif"]),

        // ── AI / LLM / GenAI ─────────────────────────────────────────────────
        s("llm", "Large Language Models", "AI / LLM", &["llm|large.?language|chat.?completion"]),
        s("rag", "Retrieval-Augmented Generation", "AI / LLM", &[r#"\brag\b|retriev.*generat|retriev.*augment"#]),
        s("prompt-engineering", "Prompt Engineering", "AI / LLM", &["prompt|system.?message|few.?shot"]),
        s("fine-tuning", "Fine-Tuning", "AI / LLM", &["fine.?tun|lora|qlora|adapter"]),
        s("embeddings", "Embeddings", "AI / LLM", &["embed|embedding|vector.?search|cosine.?sim"]),
        s("transformers", "Transformers", "AI / LLM", &["transformer|attention.?head|self.?attention|BertModel"]),
        s("agents", "AI Agents", "AI / LLM", &[r#"\bagent|tool_call|function.?call|agentic"#]),
        s("agentic-ai", "Agentic AI", "AI / LLM", &["agentic|agent.?loop|agent.?team"]),
        s("langchain", "LangChain", "AI / LLM", &[r#"langchain|from\s+langchain"#]),
        s("langgraph", "LangGraph", "AI / LLM", &[r#"langgraph|from\s+langgraph"#]),
        s("openai", "OpenAI", "AI / LLM", &[r#"openai|from\s+['"]openai|gpt-[34]"#]),
        s("anthropic", "Anthropic Claude", "AI / LLM", &["anthropic|claude|@anthropic"]),
        s("vercel-ai-sdk", "Vercel AI SDK", "AI / LLM", &[r#"from\s+['"]ai['"]|from\s+['"]@ai-sdk"#]),
        s("vector-db", "Vector Databases", "AI / LLM", &["vector.?db|lancedb|pgvector|pinecone|weaviate|chromadb"]),
        s("pinecone", "Pinecone", "AI / LLM", &["pinecone|@pinecone"]),
        s("weaviate", "Weaviate", "AI / LLM", &["weaviate"]),
        s("chromadb", "ChromaDB", "AI / LLM", &["chromadb|chroma"]),
        s("mlops", "MLOps", "AI / LLM", &["mlops|mlflow|wandb|weights.?biases"]),
        s("huggingface", "Hugging Face", "AI / LLM", &["huggingface|hf_hub|from_pretrained|transformers"]),
        s("model-evaluation", "Model Evaluation", "AI / LLM", &["eval|benchmark|accuracy|f1.?score|bleu"]),
        s("structured-output", "Structured Output", "AI / LLM", &["structured.?output|json.?schema|zod|response_format"]),
        s("function-calling", "Function Calling", "AI / LLM", &["function.?call|tool.?use|tool_choice"]),
        s("mastra", "Mastra", "AI / LLM", &[r#"mastra|from\s+['"]mastra"#]),

        // ── Cloudflare ───────────────────────────────────────────────────────
        s("cloudflare-workers", "Cloudflare Workers", "Cloudflare", &["cloudflare.*workers|wrangler|miniflare"]),
        s("cloudflare-workers-ai", "Cloudflare Workers AI", "Cloudflare", &["workers.?ai|@cloudflare/ai"]),
        s("cloudflare-d1", "Cloudflare D1", "Cloudflare", &["cloudflare.*d1|D1Database"]),
        s("cloudflare-vectorize", "Cloudflare Vectorize", "Cloudflare", &["vectorize|VectorizeIndex"]),

        // ── Frontend (extended) ──────────────────────────────────────────────
        s("next-auth", "NextAuth.js", "Frontend", &["next-auth|NextAuth"]),
        s("radix-ui", "Radix UI", "Frontend", &["@radix-ui"]),
        s("shadcn-ui", "shadcn/ui", "Frontend", &["shadcn|@/components/ui"]),
        s("storybook", "Storybook", "Frontend", &[r#"storybook|\.stories\."#]),
        s("playwright", "Playwright", "Frontend", &["playwright|@playwright"]),
        s("cypress", "Cypress", "Frontend", &[r#"cypress|cy\."#]),
        s("vitest", "Vitest", "Frontend", &[r#"vitest|from\s+['"]vitest"#]),
        s("react-query", "React Query / TanStack Query", "Frontend", &["@tanstack/react-query|useQuery|useMutation"]),
        s("zustand", "Zustand", "Frontend", &[r#"zustand|create\(\s*\(set"#]),
        s("apollo-client", "Apollo Client", "Frontend", &["@apollo/client|useQuery|useMutation|ApolloProvider"]),
        s("remix", "Remix", "Frontend", &[r#"from\s+['"]@remix|remix\.config"#]),
        s("astro", "Astro", "Frontend", &[r#"\.astro$|astro\.config"#]),

        // ── Backend (extended) ───────────────────────────────────────────────
        s("drizzle-orm", "Drizzle ORM", "Backend", &[r#"drizzle-orm|drizzle-kit|from\s+['"]drizzle"#]),
        s("prisma", "Prisma", "Backend", &[r#"@prisma|prisma\.schema"#]),
        s("trpc", "tRPC", "Backend", &["@trpc|trpc"]),
        s("hono", "Hono", "Backend", &[r#"from\s+['"]hono"#]),
        s("bun", "Bun", "Backend", &[r#"bun\.sh|bunfig|Bun\.serve"#]),
        s("deno", "Deno", "Backend", &[r#"deno\.|Deno\."#]),
    ];

    entries.into_iter().map(|s| (s.tag, s)).collect()
});

fn s(tag: &'static str, label: &'static str, category: &'static str, patterns: &'static [&'static str]) -> SkillDef {
    SkillDef { tag, label, category, patterns }
}

/// Look up a taxonomy entry by slug.
pub fn get(tag: &str) -> Option<&'static SkillDef> {
    TAXONOMY.get(tag)
}

/// All category names present in the taxonomy.
pub fn categories() -> Vec<&'static str> {
    let mut cats: Vec<&str> = TAXONOMY.values().map(|s| s.category).collect();
    cats.sort();
    cats.dedup();
    cats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn taxonomy_is_not_empty() {
        assert!(TAXONOMY.len() > 100, "expected 100+ skills, got {}", TAXONOMY.len());
    }

    #[test]
    fn all_patterns_are_valid_regex() {
        for skill in TAXONOMY.values() {
            for pat in skill.patterns {
                regex::RegexBuilder::new(pat)
                    .case_insensitive(true)
                    .build()
                    .unwrap_or_else(|e| panic!("bad regex for {}: {pat} — {e}", skill.tag));
            }
        }
    }

    #[test]
    fn get_known_tag() {
        let skill = get("graphql").expect("graphql should exist");
        assert_eq!(skill.label, "GraphQL");
        assert_eq!(skill.category, "Architecture");
    }

    #[test]
    fn get_missing_tag_is_none() {
        assert!(get("nonexistent-tag-xyz").is_none());
    }

    #[test]
    fn categories_are_non_empty() {
        let cats = categories();
        assert!(!cats.is_empty());
        assert!(cats.contains(&"Languages"));
        assert!(cats.contains(&"Frontend"));
        assert!(cats.contains(&"Backend"));
    }

    #[test]
    fn no_duplicate_tags() {
        // HashMap enforces uniqueness, but verify count matches vec construction
        let tags: Vec<&str> = TAXONOMY.keys().copied().collect();
        let unique: std::collections::HashSet<&str> = tags.iter().copied().collect();
        assert_eq!(tags.len(), unique.len(), "duplicate tags in taxonomy");
    }

    #[test]
    fn spot_check_patterns_match() {
        let re = |pat: &str| -> regex::Regex {
            regex::RegexBuilder::new(pat)
                .case_insensitive(true)
                .build()
                .unwrap()
        };

        let react = get("react").unwrap();
        assert!(react.patterns.iter().any(|p| re(p).is_match("import { useState } from 'react'")));

        let rust = get("rust").unwrap();
        assert!(rust.patterns.iter().any(|p| re(p).is_match("use std::collections::HashMap;")));

        let docker = get("docker").unwrap();
        assert!(docker.patterns.iter().any(|p| re(p).is_match("Dockerfile")));
    }
}
