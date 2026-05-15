import data from "../data/harness-design-papers.json";

export interface ResearchPaper {
  title: string;
  authors: string[];
  year: number | null;
  citation_count: number | null;
  abstract: string | null;
  url: string | null;
  pdf_url: string | null;
  doi: string | null;
  source: string;
  source_id: string;
}

export interface ResearchTopic {
  id: string;
  name: string;
  description: string;
  papers: ResearchPaper[];
}

export interface ResearchData {
  generated_at: string;
  blog_post_url: string;
  total_papers: number;
  topics: ResearchTopic[];
}

export function getResearchPapers(): ResearchData {
  return data as ResearchData;
}
