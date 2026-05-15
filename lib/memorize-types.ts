// ── Generic Memorization Types ─────────────────────────────────────────
// Domain-agnostic interfaces used by the MemorizeDashboard and all
// practice-mode components.  The CSS property dataset adapts into these
// via lib/memorize-adapters.ts so the existing CSS memorize keeps working.

export interface MemorizeItemDetail {
  label: string;
  description: string;
}

export interface MemorizeItemDemo {
  html: string;
  css: string;
  highlightProp: string;
}

export interface MemorizeItem {
  id: string;
  term: string;
  description: string;
  details: MemorizeItemDetail[];
  context?: string;
  demo?: MemorizeItemDemo;
  relatedItems: string[];
  mnemonicHint?: string;
  sourceLesson?: string;
}

export interface MemorizeCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  items: MemorizeItem[];
}
