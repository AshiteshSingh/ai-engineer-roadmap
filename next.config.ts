import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/*": ["./data/content/**", "./data/audio/**"],
    "/langgraph/lead-gen": ["./data/langgraph-lead-gen.script.md"],
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
