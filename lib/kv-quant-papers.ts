import fs from "fs";
import path from "path";
import type { ResearchData } from "@/lib/research-papers";

const DATA_PATH = path.join(process.cwd(), "data", "kv-quant-papers.json");

export function getKvQuantPapers(): ResearchData {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw) as ResearchData;
  } catch {
    return {
      generated_at: new Date().toISOString(),
      blog_post_url: "",
      total_papers: 0,
      topics: [],
    };
  }
}
