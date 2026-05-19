import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/*": ["./data/content/**", "./data/audio/**", "./data/app-prep/**", "./data/topics/**"],
  },
  // The tracing root is the monorepo, where a background loop continuously
  // rebuilds the Rust crates' multi-GB `target/` dir. Never trace any Rust
  // crate/target into the serverless functions — the web app reads only the
  // pre-exported JSON under data/ at runtime. Without this, file tracing
  // races the loop and blows past the 2 GB serverless function limit.
  outputFileTracingExcludes: {
    "*": [
      "**/crates/**",
      "**/target/**",
      // Cloudflare Python worker (workers/deepen) is separate infra deployed
      // via wrangler — never trace its source into the Vercel functions.
      "**/workers/**",
      "**/*.rlib",
      "**/*.rmeta",
      "**/*.d",
    ],
  },
  async redirects() {
    return [
      {
        source: "/agent-:num(\\d+)-:slug",
        destination: "/:slug",
        permanent: true,
      },
      // AWS deep-dive articles moved to /aws/[slug]
      { source: "/aws-lambda-serverless", destination: "/aws/lambda-serverless", permanent: true },
      { source: "/aws-api-gateway-networking", destination: "/aws/api-gateway-networking", permanent: true },
      { source: "/aws-iam-security", destination: "/aws/iam-security", permanent: true },
      { source: "/aws-compute-containers", destination: "/aws/compute-containers", permanent: true },
      { source: "/aws-storage-s3", destination: "/aws/storage-s3", permanent: true },
      { source: "/aws-cicd-devops", destination: "/aws/cicd-devops", permanent: true },
      { source: "/aws-architecture", destination: "/aws/architecture", permanent: true },
      { source: "/aws-ai-ml-services", destination: "/aws/ai-ml-services", permanent: true },
      { source: "/dynamodb-data-services", destination: "/aws/dynamodb-data-services", permanent: true },
    ];
  },
};

export default nextConfig;
