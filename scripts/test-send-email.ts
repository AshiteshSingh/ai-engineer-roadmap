/**
 * Send a test email via Cloudflare Email Service (Email Sending, beta).
 *
 * Usage:
 *   tsx --env-file=.env.local scripts/test-send-email.ts --to you@example.com
 *   tsx --env-file=.env.local scripts/test-send-email.ts --to you@example.com --from contact@ai-engineer-roadmap.xyz
 *
 * Requires the domain to be onboarded under Email Sending and a
 * CLOUDFLARE_EMAIL_SENDING_API_TOKEN with the "Email Sending" permission.
 * Run `pnpm email:status` first to confirm readiness.
 */
import { sendEmail, emailSendingConfigured } from "../lib/email/cloudflare";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = arg("--to");
  if (!to) {
    console.error("Usage: tsx scripts/test-send-email.ts --to you@example.com [--from addr@ai-engineer-roadmap.xyz]");
    process.exit(1);
  }
  if (!emailSendingConfigured()) {
    console.error(
      "Cloudflare Email Sending not configured: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_SENDING_API_TOKEN in .env.local",
    );
    process.exit(1);
  }

  const stamp = new Date().toISOString();
  const result = await sendEmail({
    to,
    from: arg("--from"),
    subject: `Cloudflare Email Service test — ${stamp}`,
    html: `<h1>It works</h1><p>Sent from ai-engineer-roadmap.xyz via Cloudflare Email Service at ${stamp}.</p>`,
    text: `It works. Sent from ai-engineer-roadmap.xyz via Cloudflare Email Service at ${stamp}.`,
  });

  console.log(`✓ Sent to ${to} (HTTP ${result.status}${result.id ? `, id ${result.id}` : ""})`);
}

main().catch((e) => {
  console.error(`✘ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
