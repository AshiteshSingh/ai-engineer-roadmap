"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef, memo, type KeyboardEvent, type ChangeEvent } from "react";
import type { ReactElement } from "react";
import {
  Heading,
  Button,
  Flex,
  Text,
  Box,
  Card,
  Skeleton,
  Badge,
} from "@radix-ui/themes";
import { ArrowLeftIcon, ExternalLinkIcon } from "@radix-ui/react-icons";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AppData } from "@/components/app-detail/types";
import { MermaidFlow } from "@/components/mermaid-flow";
import { Section, Heading as DSHeading } from "@/components/ui";
import { useSession } from "@/lib/auth-client";
import { isOwner } from "@/lib/owner";
import { OwnerDeepDives } from "@/components/app-detail/OwnerDeepDives";
import styles from "./page.module.css";

const remarkPlugins = [remarkGfm];

const LANG_LABELS: Record<string, string> = {
  jsx: "React", tsx: "React", react: "React",
  css: "CSS", scss: "CSS", sass: "CSS", less: "CSS",
  js: "JavaScript", javascript: "JavaScript",
  ts: "TypeScript", typescript: "TypeScript",
  html: "HTML", json: "JSON", bash: "Terminal", sh: "Terminal",
  sql: "SQL", python: "Python", py: "Python",
};

function langLabel(lang: string): string {
  return LANG_LABELS[lang.toLowerCase()] || lang.toUpperCase();
}

/** Merge consecutive fenced code blocks into a single `codepair` block.
 *  Uses negative lookahead to prevent content capture from crossing ``` boundaries. */
function groupCodeBlocks(md: string): string {
  const fence = "((?:(?!```)(?:.|\\n))*?)";
  const re = new RegExp(
    "```(\\w+)\\n" + fence + "```\\n{1,3}```(\\w+)\\n" + fence + "```",
    "g",
  );
  return md.replace(re, (_, l1, c1, l2, c2) =>
    `\`\`\`codepair\n${l1}\n${c1.trimEnd()}\n====CODESPLIT====\n${l2}\n${c2.trimEnd()}\n\`\`\``,
  );
}

/** Extract inline style="" attrs into class-based CSS rules (deduped) */
function extractInlineStyles(html: string): { cleanHtml: string; css: string } | null {
  let counter = 0;
  const styleToClass = new Map<string, string>();
  const rules: string[] = [];

  const cleanHtml = html.replace(/\s+style="([^"]*)"/g, (_, styleValue: string) => {
    let cls = styleToClass.get(styleValue);
    if (!cls) {
      counter++;
      cls = `s${counter}`;
      styleToClass.set(styleValue, cls);
      const props = styleValue
        .split(";")
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((s: string) => `  ${s};`)
        .join("\n");
      rules.push(`.${cls} {\n${props}\n}`);
    }
    return ` class="${cls}"`;
  });

  if (counter === 0) return null;
  return { cleanHtml, css: rules.join("\n\n") };
}

const SEMANTIC_TAGS = new Set([
  "nav", "aside", "main", "header", "footer", "section", "article",
  "form", "button", "table", "thead", "tbody", "ul", "ol", "li",
  "a", "label", "input", "textarea", "select", "blockquote",
]);

function inferClassName(
  tag: string,
  style: string,
  text: string,
  counters: Map<string, number>,
): string {
  const clean = text.trim().replace(/[^a-zA-Z0-9 ]/g, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  let base: string;

  if (clean.length >= 2 && words.length <= 3 && /^[a-zA-Z]/.test(clean)) {
    base = clean.toLowerCase().replace(/\s+/g, "-");
  } else if (tag !== "div" && tag !== "span" && SEMANTIC_TAGS.has(tag)) {
    base = tag;
  } else if (clean.length === 1 && /^[a-zA-Z]$/.test(clean)) {
    base = `item-${clean.toLowerCase()}`;
  } else {
    const s = style.toLowerCase();
    if (/display\s*:\s*grid/.test(s)) base = "grid";
    else if (/display\s*:\s*flex/.test(s)) base = "container";
    else if (/position\s*:\s*fixed/.test(s)) base = "overlay";
    else if (/position\s*:\s*absolute/.test(s)) base = "badge";
    else if (s.includes("border") && s.includes("border-radius") && s.includes("padding")) base = "card";
    else base = "box";
  }

  const count = (counters.get(base) || 0) + 1;
  counters.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

/** Expand single-line CSS rules into formatted multi-line blocks */
function formatCss(css: string): string {
  return css.replace(/([^{}]*)\{([^}]*)\}/g, (_, selector, body) => {
    const props = body.split(";").map((s: string) => s.trim()).filter(Boolean);
    return `${selector.trim()} {\n${props.map((p: string) => `  ${p};`).join("\n")}\n}`;
  }).replace(/\}\s*\./g, "}\n\n.");
}

/** If HTML is plain text (no tags) but CSS has class selectors, wrap lines in <div> elements */
function scaffoldHtmlFromCss(html: string, css: string): { html: string; css: string } {
  if (/<\w/.test(html)) return { html, css };

  const classRe = /\.([a-zA-Z][\w-]*)\s*\{([^}]*)\}/g;
  const classes: { name: string; props: string }[] = [];
  let m;
  while ((m = classRe.exec(css)) !== null) {
    classes.push({ name: m[1], props: m[2] });
  }
  if (classes.length === 0) return { html, css };

  const containerIdx = classes.findIndex(c => /display\s*:\s*(grid|flex)/.test(c.props));
  const itemClasses = classes.filter((_, i) => i !== containerIdx);
  const lines = html.split("\n").filter(l => l.trim());

  const items = lines.map((line, i) => {
    const cls = itemClasses[i]?.name;
    return cls ? `  <div class="${cls}">${line.trim()}</div>` : `  <div>${line.trim()}</div>`;
  }).join("\n");

  const scaffolded = containerIdx >= 0
    ? `<div class="${classes[containerIdx].name}">\n${items}\n</div>`
    : items;

  return { html: scaffolded, css };
}

/** Rename generic sN class names to meaningful semantic names */
function semanticRenameClasses(html: string, css: string): { html: string; css: string } {
  if (!/\.s\d+\b/.test(css)) return { html, css };

  const seen = new Set<string>();
  const ordered: string[] = [];
  const scanRe = /\.(s\d+)\b/g;
  let m;
  while ((m = scanRe.exec(css)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); ordered.push(m[1]); }
  }
  if (ordered.length === 0) return { html, css };

  const nameMap = new Map<string, string>();
  const counters = new Map<string, number>();

  for (const cls of ordered) {
    const htmlRe = new RegExp(`<(\\w+)[^>]*\\bclass="${cls}"[^>]*>([^<]*)`, "s");
    const htmlMatch = htmlRe.exec(html);
    const tag = htmlMatch?.[1] || "div";
    const text = htmlMatch?.[2] || "";

    const cssBlockRe = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, "s");
    const cssMatch = cssBlockRe.exec(css);
    const styleText = cssMatch?.[1] || "";

    nameMap.set(cls, inferClassName(tag, styleText, text, counters));
  }

  const renamedCss = css.replace(/\.s(\d+)\b/g, (match, num: string) => {
    const name = nameMap.get(`s${num}`);
    return name ? `.${name}` : match;
  });

  const renamedHtml = html.replace(/class="([^"]*)"/g, (match, classValue: string) => {
    const renamed = classValue.replace(/\bs(\d+)\b/g, (_: string, num: string) => {
      return nameMap.get(`s${num}`) || `s${num}`;
    });
    return `class="${renamed}"`;
  });

  return { html: renamedHtml, css: renamedCss };
}

const CodePanel = memo(function CodePanel({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="code-block-wrapper">
      <div className="code-block-bar">
        <div className="code-block-dots" aria-hidden="true"><span /><span /><span /></div>
        <span className="code-block-lang">{langLabel(lang)}</span>
      </div>
      <pre className={styles.codePre}>
        <code>{code}</code>
      </pre>
    </div>
  );
});

import { IFRAME_DARK_VARS } from "@/lib/iframe-dark-vars";

const LivePreviewPanel = memo(function LivePreviewPanel({ html, css }: { html: string; css: string }) {
  const srcdoc = useMemo(() =>
    `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${IFRAME_DARK_VARS}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--gray-1);color:var(--gray-12);padding:16px}
${css}</style></head><body>${html}</body></html>`,
  [html, css]);

  return (
    <div className="code-block-wrapper live-preview-wrapper">
      <div className="code-block-bar">
        <div className="code-block-dots" aria-hidden="true"><span /><span /><span /></div>
        <span className="code-block-lang">Preview</span>
      </div>
      <iframe srcDoc={srcdoc} sandbox="allow-same-origin" title="Live preview" aria-label="Live preview of the code" />
    </div>
  );
});

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const EditableCodePanel = memo(function EditableCodePanel({ lang, value, onChange }: { lang: string; value: string; onChange: (v: string) => void }) {
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const updated = value.substring(0, start) + "  " + value.substring(end);
      onChange(updated);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
    }
  }, [value, onChange]);

  const rows = useMemo(() => Math.max(4, value.split("\n").length), [value]);

  return (
    <div className="code-block-wrapper">
      <div className="code-block-bar">
        <div className="code-block-dots" aria-hidden="true"><span /><span /><span /></div>
        <span className="code-block-lang">{langLabel(lang)}</span>
      </div>
      <textarea
        className="code-playground-textarea"
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={rows}
        spellCheck={false}
        wrap="off"
        aria-label={`Editable ${langLabel(lang)} code`}
      />
    </div>
  );
});

type ChallengeMode = "off" | "css" | "html" | "full" | "debug";

function breakCss(cssText: string): string {
  const lines = cssText.split("\n");
  const propLines = lines.reduce<number[]>((acc, line, i) => {
    if (/^\s+\S+\s*:/.test(line) && !/[{}]/.test(line)) acc.push(i);
    return acc;
  }, []);
  if (propLines.length === 0) return cssText;
  const count = Math.max(1, Math.floor(propLines.length * 0.3));
  const picked = propLines.sort(() => Math.random() - 0.5).slice(0, count);
  const result = [...lines];
  for (const idx of picked) {
    const match = result[idx].match(/^(\s*)(\S+\s*:\s*)(.+?)(;?\s*)$/);
    if (match) result[idx] = `${match[1]}${match[2]}/* ??? */;`;
  }
  return result.join("\n");
}

function InteractiveCodePlayground({ initialHtml, initialCss }: { initialHtml: string; initialCss: string }) {
  const [html, setHtml] = useState(initialHtml);
  const [css, setCss] = useState(initialCss);
  const [mode, setMode] = useState<ChallengeMode>("off");
  const [challengeHtml, setChallengeHtml] = useState("");
  const [challengeCss, setChallengeCss] = useState("");

  const activeHtml = mode === "html" || mode === "full" ? challengeHtml : html;
  const activeCss = mode === "css" || mode === "full" || mode === "debug" ? challengeCss : css;
  const setActiveHtml = mode === "html" || mode === "full" ? setChallengeHtml : setHtml;
  const setActiveCss = mode === "css" || mode === "full" || mode === "debug" ? setChallengeCss : setCss;

  const debouncedHtml = useDebouncedValue(activeHtml, 200);
  const debouncedCss = useDebouncedValue(activeCss, 200);
  const dirty = html !== initialHtml || css !== initialCss;

  const activate = (next: ChallengeMode) => {
    if (mode === next) { setMode("off"); return; }
    setMode(next);
    if (next === "css") { setChallengeHtml(html); setChallengeCss(""); }
    else if (next === "html") { setChallengeHtml(""); setChallengeCss(css); }
    else if (next === "full") { setChallengeHtml(""); setChallengeCss(""); }
    else if (next === "debug") { setChallengeHtml(html); setChallengeCss(breakCss(initialCss)); }
  };

  const reset = () => { setHtml(initialHtml); setCss(initialCss); setMode("off"); setChallengeHtml(""); setChallengeCss(""); };

  return (
    <Box mb="4" style={{ position: "relative" }}>
      <Flex gap="3" justify="end" align="center" mb="3" wrap="wrap">
        <Button size="2" variant={mode === "css" ? "solid" : "soft"} color="violet" onClick={() => activate("css")}>
          CSS Challenge
        </Button>
        <Button size="2" variant={mode === "html" ? "solid" : "soft"} color="cyan" onClick={() => activate("html")}>
          HTML Challenge
        </Button>
        <Button size="2" variant={mode === "full" ? "solid" : "soft"} color="orange" onClick={() => activate("full")}>
          Full Rebuild
        </Button>
        <Button size="2" variant={mode === "debug" ? "solid" : "soft"} color="crimson" onClick={() => activate("debug")}>
          Debug
        </Button>
        {mode !== "off" && (
          <Button size="2" variant="outline" color="gray" onClick={() => setMode("off")}>
            Solution
          </Button>
        )}
        <Button size="3" variant="ghost" color="gray" onClick={reset}>
          Reset
        </Button>
      </Flex>
      <div className="code-triple-grid">
        <EditableCodePanel lang="html" value={activeHtml} onChange={setActiveHtml} />
        <EditableCodePanel lang="css" value={activeCss} onChange={setActiveCss} />
        <LivePreviewPanel html={debouncedHtml} css={debouncedCss} />
      </div>
    </Box>
  );
}

function PrepPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = isOwner(session);

  const [app, setApp] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scrollKey = `prep-scroll-${params.id}`;
  const restoredRef = useRef(false);

  // Disable browser's own scroll restoration
  useEffect(() => {
    history.scrollRestoration = "manual";
    return () => { history.scrollRestoration = "auto"; };
  }, []);

  useEffect(() => {
    if (params.id) {
      fetch(`/api/applications/${params.id}`)
        .then((r) => {
          if (r.status === 401) {
            router.push("/login");
            return null;
          }
          if (!r.ok) throw new Error("Not found");
          return r.json();
        })
        .then((data) => data && setApp(data))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [params.id, router]);

  // Restore scroll position after content renders
  useEffect(() => {
    if (!loading && app) {
      const saved = localStorage.getItem(scrollKey);
      if (saved) {
        const y = parseInt(saved, 10);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.scrollTo(0, y);
            restoredRef.current = true;
          });
        });
      } else {
        restoredRef.current = true;
      }
    }
  }, [loading, app, scrollKey]);

  // Persist scroll position on scroll — only after restore completes
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (!restoredRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        localStorage.setItem(scrollKey, String(window.scrollY));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [scrollKey]);

  const content = app?.interviewQuestions;
  const processed = useMemo(() => content ? groupCodeBlocks(content) : null, [content]);

  // Owner-only tailored prep. The API only ever sends `ownerPrep` to the owner
  // (server-gated); `isAdmin &&` below is defense-in-depth, matching how the
  // OwnerDeepDives card is gated. Reuses the same markdown pipeline so the
  // `**Say this:**` / `**Common mistake:**` / `**If they ask:**` / `⏱ Target:`
  // callouts render styled with no extra work.
  const ownerContent = app?.ownerPrep;
  const ownerProcessed = useMemo(
    () => (ownerContent ? groupCodeBlocks(ownerContent) : null),
    [ownerContent],
  );

  const mdComponents = useMemo(() => ({
    h1: ({ children }: { children: React.ReactNode }) => (
      <Heading size="6" mb="3" mt="6" style={{ color: "var(--violet-11)" }}>{children}</Heading>
    ),
    h2: ({ children }: { children: React.ReactNode }) => (
      <Box mt="6" mb="3" pt="5" style={{ borderTop: "2px solid var(--violet-4)" }}>
        <Heading size="5" style={{ color: "var(--violet-11)" }}>{children}</Heading>
      </Box>
    ),
    h3: ({ children }: { children: React.ReactNode }) => (
      <Box mt="5" mb="2" p="3" style={{ borderLeft: "3px solid var(--violet-8)", borderRadius: 0 }}>
        <Heading size="4">{children}</Heading>
      </Box>
    ),
    h4: ({ children }: { children: React.ReactNode }) => (
      <Heading size="3" mt="4" mb="2">{children}</Heading>
    ),
    p: ({ children }: { children: React.ReactNode }) => {
      const kids = Array.isArray(children) ? children : [children];
      const first = kids[0] as ReactElement<{ children?: string }> | undefined;
      const bold = typeof first === "object" && first?.props?.children;
      if (typeof bold === "string") {
        const l = bold.toLowerCase();
        if (/narration|say this|say:|what to say|your script|prioritization script/.test(l))
          return <div className="callout callout-speak"><Text as="p" size="2" style={{ lineHeight: 1.8 }}>{children}</Text></div>;
        if (/common mistake/.test(l))
          return <div className="callout callout-warn"><Text as="p" size="2" style={{ lineHeight: 1.8 }}>{children}</Text></div>;
        if (/if they ask|why this/.test(l))
          return <div className="callout callout-tip"><Text as="p" size="2" style={{ lineHeight: 1.8 }}>{children}</Text></div>;
        if (/⏱|target:/.test(l))
          return <div className="timing-badge">{children}</div>;
      }
      return <Text as="p" size="2" mb="3" style={{ lineHeight: 1.8 }}>{children}</Text>;
    },
    strong: ({ children }: { children: React.ReactNode }) => (
      <strong style={{ fontWeight: 600 }}>{children}</strong>
    ),
    em: ({ children }: { children: React.ReactNode }) => <em>{children}</em>,
    ul: ({ children }: { children: React.ReactNode }) => (
      <ul style={{ paddingLeft: 20, lineHeight: 1.9, marginBottom: 16 }}>{children}</ul>
    ),
    ol: ({ children }: { children: React.ReactNode }) => (
      <ol style={{ paddingLeft: 20, lineHeight: 1.9, marginBottom: 16 }}>{children}</ol>
    ),
    li: ({ children }: { children: React.ReactNode }) => (
      <li style={{ lineHeight: 1.8, marginBottom: 6, fontSize: "var(--font-size-2)" }}>{children}</li>
    ),
    blockquote: ({ children }: { children: React.ReactNode }) => (
      <Box mb="4" pl="4" py="2" style={{ borderLeft: "3px solid var(--violet-6)", borderRadius: "0 var(--radius-2) var(--radius-2) 0" }}>
        {children}
      </Box>
    ),
    table: ({ children }: { children: React.ReactNode }) => (
      <Box mb="4" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--font-size-2)" }}>
          {children}
        </table>
      </Box>
    ),
    thead: ({ children }: { children: React.ReactNode }) => (
      <thead>{children}</thead>
    ),
    th: ({ children }: { children: React.ReactNode }) => (
      <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, borderBottom: "2px solid var(--violet-6)" }}>{children}</th>
    ),
    td: ({ children }: { children: React.ReactNode }) => (
      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--gray-4)" }}>{children}</td>
    ),
    pre: ({ children }: { children: React.ReactNode }) => {
      let lang = "";
      let rawText = "";
      const codeEl = children as ReactElement<{ className?: string; children?: string }>;
      if (codeEl?.props) {
        const match = codeEl.props.className?.match(/language-(\w+)/);
        if (match) lang = match[1];
        rawText = String(codeEl.props.children || "").replace(/\n$/, "");
      }

      if (lang === "mermaid") {
        return <MermaidFlow chart={rawText} />;
      }

      if (lang === "codepair") {
        const parts = rawText.split("\n====CODESPLIT====\n");
        const blocks = parts.map((part) => {
          const lines = part.split("\n");
          return { lang: lines[0], code: lines.slice(1).join("\n") };
        });

        const isHtmlCss =
          blocks.length === 2 &&
          blocks.some((b) => b.lang.toLowerCase() === "html") &&
          blocks.some((b) => b.lang.toLowerCase() === "css");

        if (isHtmlCss) {
          const htmlBlock = blocks.find((b) => b.lang.toLowerCase() === "html")!;
          const cssBlock = blocks.find((b) => b.lang.toLowerCase() === "css")!;
          const formatted = formatCss(cssBlock.code);
          const scaffolded = scaffoldHtmlFromCss(htmlBlock.code, formatted);
          const renamed = semanticRenameClasses(scaffolded.html, scaffolded.css);
          return <InteractiveCodePlayground initialHtml={renamed.html} initialCss={renamed.css} />;
        }

        return (
          <Box mb="4">
            <div className="code-pair-grid">
              {blocks.map((block, i) => (
                <CodePanel key={i} lang={block.lang} code={block.code} />
              ))}
            </div>
          </Box>
        );
      }

      if (lang === "html") {
        const extracted = extractInlineStyles(rawText);
        if (extracted) {
          const formatted = formatCss(extracted.css);
          const renamed = semanticRenameClasses(extracted.cleanHtml, formatted);
          return <InteractiveCodePlayground initialHtml={renamed.html} initialCss={renamed.css} />;
        }
        return (
          <Box mb="4">
            <div className="code-pair-grid">
              <CodePanel lang="html" code={rawText} />
              <LivePreviewPanel html={rawText} css="" />
            </div>
          </Box>
        );
      }

      return (
        <Box mb="4">
          <div className="code-block-wrapper">
            <div className="code-block-bar">
              <div className="code-block-dots" aria-hidden="true"><span /><span /><span /></div>
              {lang && <span className="code-block-lang">{langLabel(lang)}</span>}
            </div>
            <pre className={styles.codePre}>
              {children}
            </pre>
          </div>
        </Box>
      );
    },
    code: ({ children, className }: { children: React.ReactNode; className?: string }) => {
      const isBlock = className?.includes("language-");
      if (isBlock) return <code>{children}</code>;
      return (
        <code style={{ backgroundColor: "var(--violet-3)", padding: "2px 6px", borderRadius: "var(--radius-1)", fontSize: "0.9em", fontFamily: "var(--font-mono, monospace)" }}>
          {children}
        </code>
      );
    },
    hr: () => (
      <Box my="6" style={{ borderTop: "2px solid var(--gray-4)" }} />
    ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any, []);

  if (loading) {
    return (
      <Section>
        <Skeleton height="32px" mb="6" className={styles.skel} />
        <Skeleton height="600px" />
      </Section>
    );
  }

  if (error || !app) {
    return (
      <Section>
        <Card>
          <Flex direction="column" align="center" gap="4" p="6">
            <Heading size="5">{error ? "Error" : "Not Found"}</Heading>
            <Text color="gray">{error ?? "This application doesn\u2019t exist or you don\u2019t have access."}</Text>
            <Button asChild>
              <Link href="/applications">Back to Applications</Link>
            </Button>
          </Flex>
        </Card>
      </Section>
    );
  }

  return (
    <Box className="prep-page" px={{ initial: "4", md: "8" }} py={{ initial: "4", md: "8" }}>
      {/* Navigation */}
      <Flex align="center" gap="3" mb="5">
        <Link
          href={`/applications/${app.slug}`}
          className={styles.backLink}
        >
          <ArrowLeftIcon />
          <Text size="2">{app.company}</Text>
        </Link>
        <Text size="2" color="gray">/</Text>
        <Text size="2" weight="medium">{app.position}</Text>
      </Flex>

      {/* Page header */}
      <Flex justify="between" align="start" mb="6" wrap="wrap" gap="3">
        <Box>
          <DSHeading as="h1" size="xl">Study Plan</DSHeading>
          <Flex align="center" gap="2">
            <Badge color="violet" variant="soft" size="2">Interview Prep</Badge>
            <Text size="2" color="gray">{app.company} &middot; {app.position}</Text>
          </Flex>
        </Box>
        <Flex gap="2">
          <Button size="2" variant="solid" color="violet" asChild>
            <Link href={`/applications/${app.slug}/prep/memorize`}>Memorize</Link>
          </Button>
          <Button size="2" variant="soft" color="gray" asChild>
            <Link href={`/applications/${app.slug}/notes`}>Notes</Link>
          </Button>
          {app.url && (
            <Button size="2" variant="soft" asChild>
              <a href={app.url} target="_blank" rel="noopener noreferrer">
                Job Posting <ExternalLinkIcon />
              </a>
            </Button>
          )}
        </Flex>
      </Flex>

      {isAdmin && <OwnerDeepDives appSlug={app.slug} />}

      {/* Owner-only: tailored, evidence-grounded prep (server-gated). */}
      {isAdmin && ownerProcessed && (
        <details className={styles.ownerBox} open>
          <summary className={styles.ownerSummary}>
            Your evidence &amp; STAR &mdash; owner only
          </summary>
          <Box className="interview-prep-md" mt="4">
            <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>
              {ownerProcessed}
            </ReactMarkdown>
          </Box>
        </details>
      )}

      {/* Content */}
      {processed ? (
        <Box className="interview-prep-md">
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            components={mdComponents}
          >
            {processed}
          </ReactMarkdown>
        </Box>
      ) : (
        <Card style={{ borderLeft: "3px solid var(--violet-6)", borderRadius: 0 }}>
          <Flex direction="column" align="center" justify="center" gap="3" py="8">
            <Text size="2" color="gray">No study plan generated yet.</Text>
            <Text size="2" color="gray">
              Add a job description first, then generate prep from the application detail page.
            </Text>
            <Button size="2" variant="soft" asChild>
              <Link href={`/applications/${app.slug}`}>Go to Application</Link>
            </Button>
          </Flex>
        </Card>
      )}
    </Box>
  );
}

export default function PrepPage() {
  return (
    <Suspense fallback={
      <Section>
        <Skeleton height="32px" mb="6" className={styles.skel} />
        <Skeleton height="600px" />
      </Section>
    }>
      <PrepPageInner />
    </Suspense>
  );
}
