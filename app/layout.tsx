import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Theme } from "@radix-ui/themes";
import { PostHogProvider, PostHogPageView } from "@posthog/next";
import "@radix-ui/themes/styles.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "AI Engineering — From Zero to AI Engineer",
  description: "A structured learning path for junior engineers to master AI engineering: evals, RAG, agents, fine-tuning, prompting & production AI systems",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} ${inter.className}`}>
        <PostHogProvider clientOptions={{ api_host: '/ingest' }} bootstrapFlags>
          <PostHogPageView />
          <Theme appearance="dark" accentColor="teal" radius="small">
            {children}
          </Theme>
        </PostHogProvider>
      </body>
    </html>
  );
}
