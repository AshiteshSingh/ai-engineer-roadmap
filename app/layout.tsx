import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Theme } from "@radix-ui/themes";
import { Analytics } from "@vercel/analytics/next";
import "@radix-ui/themes/styles.css";
// Pinned cascade order (Phase 1 — globals.css dissolution):
// radix base → design tokens → base resets → (transitional) legacy globals
// → shared keyframes (global; CSS Modules can't reference cross-file).
import "./styles/tokens.css";
import "./styles/base.css";
import "./globals.css";
import "./styles/motion.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "AI Engineering",
  description: "A structured learning path for junior engineers to master AI engineering: evals, RAG, agents, fine-tuning, prompting & production AI systems",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} ${inter.className}`}>
        <Theme appearance="dark" accentColor="indigo" grayColor="slate" radius="small" panelBackground="solid">
          {children}
        </Theme>
        <Analytics />
      </body>
    </html>
  );
}
