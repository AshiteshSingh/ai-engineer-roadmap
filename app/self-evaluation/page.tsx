import { Topbar } from "@/components/topbar";
import { getResearchPapers } from "@/lib/research-papers";
import { PaperCard } from "@/components/paper-card";

export const metadata = {
  title: "Self-Evaluation: Harness Design — AI Engineering",
  description:
    "Research papers on harness design for long-running application development with AI agents",
};

export default function SelfEvaluationPage() {
  const data = getResearchPapers();
  const generatedDate = data.generated_at
    ? new Date(data.generated_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <>
      <Topbar />
      <main className="se-main">
        <div className="se-banner">
          <h1 className="se-title">Harness Design for Long-Running Application Development</h1>
          <p className="se-subtitle">
            Research papers across {data.topics.length} topics from Anthropic&apos;s{" "}
            <a
              href={data.blog_post_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              engineering blog post
            </a>
          </p>
          <div className="se-stats">
            <span className="se-stat">{data.total_papers} papers</span>
            <span className="se-stat">{data.topics.length} topics</span>
            {generatedDate && <span className="se-stat">Generated {generatedDate}</span>}
          </div>
        </div>

        <div className="se-content">
          {data.topics.map((topic) => (
            <section key={topic.id} className="se-topic-section">
              <div className="se-topic-header">
                <h2 className="se-topic-name">{topic.name}</h2>
                <span className="se-topic-count">{topic.papers.length} papers</span>
              </div>
              <p className="se-topic-description">{topic.description}</p>
              <div className="se-papers-list">
                {topic.papers.map((paper, i) => (
                  <PaperCard key={`${topic.id}-${i}`} paper={paper} />
                ))}
              </div>
            </section>
          ))}

          {data.topics.length === 0 && (
            <p className="se-empty">
              No papers yet. Run <code>cargo run --bin harness-design-research</code> from{" "}
              <code>crates/research</code> to generate data.
            </p>
          )}
        </div>
      </main>
    </>
  );
}
