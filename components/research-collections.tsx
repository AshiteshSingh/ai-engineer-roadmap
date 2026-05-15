import Link from "next/link";

export interface ResearchCollection {
  href: string;
  icon: string;
  name: string;
  description: string;
  /** Optional short tag shown as a chip, e.g. "12 papers" or "Active". */
  tag?: string;
}

const DEFAULT_COLLECTIONS: ResearchCollection[] = [
  {
    href: "/kv-quant",
    icon: "🗜️",
    name: "KV-Cache Quantization",
    description:
      "Research papers on quantizing key-value caches for efficient LLM inference — compression, pruning, and long-context methods.",
    tag: "Curated",
  },
];

interface Props {
  collections?: ResearchCollection[];
}

export function ResearchCollections({
  collections = DEFAULT_COLLECTIONS,
}: Props) {
  if (collections.length === 0) return null;

  const [featured, ...rest] = collections;

  return (
    <section className="hp-research" aria-labelledby="hp-research-title">
      <div className="hp-research-head">
        <span className="hp-research-eyebrow" aria-hidden="true">
          ●&nbsp;&nbsp;Index
        </span>
        <h2 id="hp-research-title" className="hp-research-title">
          Research Collections
        </h2>
        <p className="hp-research-lede">
          Hand-picked paper sets, organized by problem area.
        </p>
      </div>

      <div className="hp-research-grid">
        <Link
          href={featured.href}
          className="hp-research-card hp-research-card--featured"
        >
          <span className="hp-research-num" aria-hidden="true">
            01
          </span>
          <span className="hp-research-glow" aria-hidden="true" />
          <div className="hp-research-card-top">
            <span className="hp-research-icon" aria-hidden="true">
              {featured.icon}
            </span>
            {featured.tag ? (
              <span className="hp-research-chip">{featured.tag}</span>
            ) : null}
          </div>
          <h3 className="hp-research-name">{featured.name}</h3>
          <p className="hp-research-desc">{featured.description}</p>
          <span className="hp-research-cta">
            Browse collection
            <svg
              className="hp-research-arrow"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 8h9M8.5 3.5 13 8l-4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </Link>

        {rest.map((c, i) => (
          <Link
            key={c.href}
            href={c.href}
            className="hp-research-card hp-research-card--compact"
          >
            <span className="hp-research-num" aria-hidden="true">
              {String(i + 2).padStart(2, "0")}
            </span>
            <div className="hp-research-card-top">
              <span className="hp-research-icon" aria-hidden="true">
                {c.icon}
              </span>
              {c.tag ? (
                <span className="hp-research-chip">{c.tag}</span>
              ) : null}
            </div>
            <h3 className="hp-research-name">{c.name}</h3>
            <p className="hp-research-desc">{c.description}</p>
            <span className="hp-research-cta">
              Browse
              <svg
                className="hp-research-arrow"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M3 8h9M8.5 3.5 13 8l-4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
