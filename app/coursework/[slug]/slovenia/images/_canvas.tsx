"use client";

import { useRef, useState } from "react";
import { Box, Button, Dialog, Flex, Text } from "@radix-ui/themes";
import {
  ImgItem,
  PHRASES,
  SLUG,
  WM_URLS,
} from "./_data";

// Fetch the bytes via fetch() (separate cache slot from <img>), then decode
// from a same-origin Blob URL — guarantees the canvas is never tainted, even
// if the rendered <img> happened to use a non-CORS cached entry.
export async function loadImg(src: string): Promise<HTMLImageElement> {
  const res = await fetch(src, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) pentru ${src}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Decodare eșuată pentru ${src}`));
      img.src = objectUrl;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
): number {
  for (const ln of lines) {
    ctx.fillText(ln, x, y);
    y += lineHeight;
  }
  return y;
}

export function triggerDownload(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    "image/jpeg",
    0.95,
  );
}

// Composes a single A4-portrait canvas: image + title + caption. The image is
// drawn at its natural aspect ratio at the maximum size that fits within the
// page — no pillar/letter-box gray bars.
export async function composeCardCanvas(item: ImgItem): Promise<HTMLCanvasElement> {
  const img = await loadImg(item.src);

  const W = 2480;
  const H = 3508;
  const PAD = 40;
  const CONTENT_W = W - 2 * PAD;
  const IMG_TEXT_GAP = 56;
  const TITLE_LH = 122;
  const CAPTION_LH = 82;
  const TEXT_GAP = 32;
  const TITLE_FONT =
    "bold 100px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
  const CAPTION_FONT =
    "60px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "top";
  ctx.font = TITLE_FONT;
  const titleLines = wrapLines(ctx, item.title, CONTENT_W);
  ctx.font = CAPTION_FONT;
  const captionLines = wrapLines(ctx, item.caption, CONTENT_W);
  const textBandH =
    titleLines.length * TITLE_LH + TEXT_GAP + captionLines.length * CAPTION_LH;
  const maxImgH = H - 2 * PAD - textBandH - IMG_TEXT_GAP;

  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const imgRatio = sw / sh;
  let dh = maxImgH;
  let dw = dh * imgRatio;
  if (dw > CONTENT_W) {
    dw = CONTENT_W;
    dh = dw / imgRatio;
  }

  const blockH = dh + IMG_TEXT_GAP + textBandH;
  const blockTop = PAD + Math.max(0, (H - 2 * PAD - blockH) / 2);
  const dx = PAD + (CONTENT_W - dw) / 2;
  const dy = blockTop;

  if (item.bg) {
    ctx.fillStyle = item.bg;
    ctx.fillRect(dx, dy, dw, dh);
  }
  ctx.drawImage(img, dx, dy, dw, dh);

  ctx.fillStyle = "#0f172a";
  ctx.font = TITLE_FONT;
  let y = dy + dh + IMG_TEXT_GAP;
  y = drawLines(ctx, titleLines, PAD, y, TITLE_LH);

  y += TEXT_GAP;
  ctx.fillStyle = "#334155";
  ctx.font = CAPTION_FONT;
  drawLines(ctx, captionLines, PAD, y, CAPTION_LH);

  return canvas;
}

export async function downloadCardAsJpg(item: ImgItem) {
  const canvas = await composeCardCanvas(item);
  triggerDownload(canvas, `slovenia-${SLUG(item.title)}.jpg`);
}

export function composePhrasesCanvas(): HTMLCanvasElement {
  const W = 2480;
  const H = 3508;
  const FRAME = 100;
  const INNER_PAD = 40;
  const PAD = FRAME + INNER_PAD;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const stripeX = PAD - 50;
  const stripeW = 36;
  const stripeTop = PAD;
  const stripeH = H - 2 * PAD;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(stripeX, stripeTop, stripeW, stripeH / 3);
  ctx.fillStyle = "#0b4ea2";
  ctx.fillRect(stripeX, stripeTop + stripeH / 3, stripeW, stripeH / 3);
  ctx.fillStyle = "#c8102e";
  ctx.fillRect(stripeX, stripeTop + (2 * stripeH) / 3, stripeW, stripeH / 3);

  ctx.fillStyle = "#0f172a";
  ctx.textBaseline = "top";
  ctx.font = "bold 128px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("Cuvinte de bază în slovenă", PAD + 60, PAD + 40);

  ctx.fillStyle = "#475569";
  ctx.font = "italic 56px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("De memorat pentru prezentare — repetați cu pronunția", PAD + 60, PAD + 220);

  let y = PAD + 400;
  for (const p of PHRASES) {
    ctx.fillStyle = "#0b4ea2";
    ctx.font = "bold 88px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(p.sl, PAD + 60, y);

    ctx.fillStyle = "#0f172a";
    ctx.font = "64px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`→  ${p.ro}`, PAD + 60 + 720, y + 16);

    if (p.ipa) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "italic 52px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(p.ipa, PAD + 60 + 1520, y + 24);
    }
    y += 160;
  }

  void FRAME;

  return canvas;
}

export async function downloadPhrasesAsJpg() {
  const canvas = composePhrasesCanvas();
  triggerDownload(canvas, "slovenia-cuvinte-de-baza.jpg");
}

// Cutting sheet: 1 big stema on top + 3×3 grid of 9 small stemas below.
export async function composeStemaSheetCanvas(): Promise<HTMLCanvasElement> {
  const img = await loadImg(WM_URLS.coat);

  const W = 2480;
  const H = 3508;
  const PAD = 60;
  const SECTION_GAP = 80;
  const CELL_GAP = 40;
  const CONTENT_W = W - 2 * PAD;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const aspect = sw / sh;

  const halfH = (H - 2 * PAD - SECTION_GAP) / 2;

  let bigH = halfH;
  let bigW = bigH * aspect;
  if (bigW > CONTENT_W) {
    bigW = CONTENT_W;
    bigH = bigW / aspect;
  }
  const bigX = PAD + (CONTENT_W - bigW) / 2;
  const bigY = PAD + (halfH - bigH) / 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(bigX, bigY, bigW, bigH);
  ctx.drawImage(img, bigX, bigY, bigW, bigH);

  const gridTop = PAD + halfH + SECTION_GAP;
  const cellW = (CONTENT_W - 2 * CELL_GAP) / 3;
  const cellH = (halfH - 2 * CELL_GAP) / 3;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let dh = cellH;
      let dw = dh * aspect;
      if (dw > cellW) {
        dw = cellW;
        dh = dw / aspect;
      }
      const cellX = PAD + col * (cellW + CELL_GAP);
      const cellY = gridTop + row * (cellH + CELL_GAP);
      const dx = cellX + (cellW - dw) / 2;
      const dy = cellY + (cellH - dh) / 2;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(dx, dy, dw, dh);
      ctx.drawImage(img, dx, dy, dw, dh);
    }
  }

  return canvas;
}

export async function downloadStemaSheetAsJpg() {
  const canvas = await composeStemaSheetCanvas();
  triggerDownload(canvas, "slovenia-stema-fisa-decupat.jpg");
}

export async function canvasToJpgFile(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.95),
  );
  if (!blob) throw new Error(`Generare eșuată pentru ${filename}`);
  return new File([blob], filename, { type: "image/jpeg" });
}

// Web Share API with files works in Safari (macOS 14+, iOS 15+) and Chrome
// Android. Desktop Chrome/Edge typically doesn't support file sharing — we
// fall back to bulk-download + a prefilled mailto: in those cases.
export async function shareOrDownloadAndMail(
  files: File[],
): Promise<"shared" | "fallback" | "canceled"> {
  const subject = "Slovenia — imagini A4 pentru proiect";

  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  if (
    typeof nav.share === "function" &&
    typeof nav.canShare === "function" &&
    nav.canShare({ files })
  ) {
    try {
      await nav.share({ files, title: subject });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "canceled";
    }
  }

  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    await new Promise((r) => setTimeout(r, 200));
  }
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
  return "fallback";
}

// ---------- UI primitives reused across pages ----------

export function DownloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function MailIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <polyline points="3 7 12 13 21 7" />
    </svg>
  );
}

export function PreviewDialog({
  trigger,
  compose,
  filename,
  title,
}: {
  trigger: React.ReactNode;
  compose: () => Promise<HTMLCanvasElement>;
  filename: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const cleanup = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPreviewUrl(null);
    canvasRef.current = null;
    setErr(null);
  };

  const handleOpenChange = async (next: boolean) => {
    setOpen(next);
    if (!next) {
      cleanup();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const canvas = await compose();
      canvasRef.current = canvas;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.95),
      );
      if (!blob) throw new Error("Generare eșuată");
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setPreviewUrl(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Generare eșuată");
    } finally {
      setBusy(false);
    }
  };

  const onDownload = () => {
    if (!canvasRef.current) return;
    triggerDownload(canvasRef.current, filename);
  };

  void open;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger>{trigger}</Dialog.Trigger>
      <Dialog.Content maxWidth="900px">
        <Dialog.Title>Previzualizare — {title}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Format JPG, A4 portrait (2480×3508 px, 300dpi). Apăsați „Descarcă JPG” pentru a salva fișierul.
        </Dialog.Description>

        <Box
          style={{
            width: "100%",
            minHeight: 240,
            maxHeight: "70vh",
            overflow: "auto",
            background: "#f3f3f3",
            borderRadius: "var(--radius-3)",
            padding: 12,
            display: "flex",
            alignItems: "safe center",
            justifyContent: "safe center",
          }}
        >
          {busy && (
            <Text size="2" color="gray">
              Se generează previzualizarea…
            </Text>
          )}
          {err && (
            <Text size="2" color="red">
              {err}
            </Text>
          )}
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={`Previzualizare ${title}`}
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                borderRadius: "var(--radius-2)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            />
          )}
        </Box>

        <Flex gap="3" justify="end" mt="4">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Închide
            </Button>
          </Dialog.Close>
          <Button onClick={onDownload} disabled={!previewUrl} color="teal">
            <DownloadIcon size={14} /> Descarcă JPG
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
