"use client";

import { memo, useMemo } from "react";
import { IFRAME_DARK_VARS } from "@/lib/iframe-dark-vars";

interface LiveDemoProps {
  html: string;
  css: string;
  height?: number | string;
}

export const LiveDemo = memo(function LiveDemo({
  html,
  css,
  height = 120,
}: LiveDemoProps) {
  const srcdoc = useMemo(
    () =>
      `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${IFRAME_DARK_VARS}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--gray-1);color:var(--gray-12);padding:16px}
${css}</style></head><body>${html}</body></html>`,
    [html, css],
  );

  return (
    <iframe
      srcDoc={srcdoc}
      sandbox="allow-same-origin"
      title="CSS demo preview"
      style={{ width: "100%", height, border: "none", background: "var(--gray-1)" }}
    />
  );
});
