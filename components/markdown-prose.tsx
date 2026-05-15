"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMemo, type ReactNode } from "react";
import type { AudioChapter } from "@/lib/audio";
import { MermaidFlow } from "@/components/mermaid-flow";
import { XyflowDirect } from "@/components/xyflow-direct";
// Scoped prose styles (extracted from globals.css, Phase 1). Owned here:
// styles target react-markdown output under the .markdown-prose wrapper.
import "@/app/styles/markdown.css";

export const SEEK_AUDIO_EVENT = "knowledge:seek-audio";

function makeHeading(
  Tag: "h2" | "h3",
  children: ReactNode,
  seekMap: Map<string, number>,
) {
  const id = slugify(extractText(children));
  const seconds = seekMap.get(id);
  if (seconds === undefined) {
    return <Tag id={id}>{children}</Tag>;
  }
  const fire = () =>
    window.dispatchEvent(
      new CustomEvent(SEEK_AUDIO_EVENT, { detail: { seconds } }),
    );
  return (
    <Tag
      id={id}
      className="md-seek"
      role="button"
      tabIndex={0}
      title="Jump audio to this section"
      onClick={fire}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire();
        }
      }}
    >
      {children}
    </Tag>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function extractText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractText((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

export function MarkdownProse({
  content,
  chapters,
}: {
  content: string;
  chapters?: AudioChapter[];
}) {
  const stripped = content.replace(/^# .+$/m, "");

  const seekMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const ch of chapters ?? []) {
      m.set(slugify(ch.title), ch.start_secs);
    }
    return m;
  }, [chapters]);

  return (
    <div className="markdown-prose" style={{ maxWidth: 720 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        children={stripped}
        components={{
          h1: ({ children }) => {
            const id = slugify(extractText(children));
            return <h1 id={id}>{children}</h1>;
          },
          h2: ({ children }) => makeHeading("h2", children, seekMap),
          h3: ({ children }) => makeHeading("h3", children, seekMap),
          a: ({ href, children, ...props }) => {
            const isExternal = href?.startsWith("http");
            return isExternal ? (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            ) : (
              <a href={href} {...props}>
                {children}
              </a>
            );
          },
          blockquote: ({ children }) => {
            const text = extractText(children);
            let calloutType = "";
            if (/^(Key Takeaway|Takeaway)/i.test(text)) calloutType = "takeaway";
            else if (/^(Note|Info)/i.test(text)) calloutType = "note";
            else if (/^(Warning|Caution)/i.test(text)) calloutType = "warning";
            else if (/^(Tip|Pro tip|Best practice)/i.test(text)) calloutType = "tip";
            return (
              <blockquote className={calloutType ? `callout callout--${calloutType}` : undefined}>
                {children}
              </blockquote>
            );
          },
          pre: ({ children, ...props }) => {
            // Extract language from the code child
            let lang = "";
            let rawText = "";
            if (children && typeof children === "object" && "props" in (children as unknown as Record<string, unknown>)) {
              const codeProps = (children as unknown as { props: { className?: string; children?: string } }).props;
              const match = codeProps?.className?.match(/language-(\w+)/);
              if (match) lang = match[1];
              rawText = String(codeProps?.children || "").replace(/\n$/, "");
            }

            if (lang === "xyflow") {
              return <XyflowDirect json={rawText} />;
            }
            if (lang === "mermaid") {
              return <MermaidFlow chart={rawText} />;
            }

            return (
              <div className="code-block-wrapper">
                <div className="code-block-bar">
                  <div className="code-block-dots">
                    <span /><span /><span />
                  </div>
                  {lang && <span className="code-block-lang">{lang}</span>}
                </div>
                <pre {...props}>{children}</pre>
              </div>
            );
          },
        }}
      />
    </div>
  );
}
