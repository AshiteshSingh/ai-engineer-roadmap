/**
 * Send a one-off invitation email via Cloudflare Email Service.
 *
 * The recipient is invited to create an account; on signup BetterAuth sends a
 * confirmation email automatically, and sign-in stays locked until they confirm
 * (requireEmailVerification). This script only sends the initial invite.
 *
 * Usage:
 *   tsx --env-file=.env.local scripts/send-invite.ts --to 2533643340@qq.com --name UnderHear
 *
 * Requires CLOUDFLARE_ACCOUNT_ID and a working Cloudflare email token
 * (CLOUDFLARE_EMAIL_SENDING_API_TOKEN, or CLOUDFLARE_EMAIL_API_TOKEN fallback).
 * Run `pnpm email:status` / `pnpm email:test` first.
 */
import { sendEmail, emailSendingConfigured } from "../lib/email/cloudflare";

const SIGNUP_URL = "https://ai-engineer-roadmap.xyz/signup";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = arg("--to");
  if (!to) {
    console.error(
      'Usage: tsx scripts/send-invite.ts --to someone@example.com [--name "Their Name"]',
    );
    process.exit(1);
  }
  if (!emailSendingConfigured()) {
    console.error(
      "Cloudflare Email Sending not configured: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_SENDING_API_TOKEN in .env.local",
    );
    process.exit(1);
  }

  const name = arg("--name") ?? "there";
  const text = `Hi ${name},

Thanks for reaching out about the AI engineering roadmap — glad you want to join.

Two steps to get started:

1. Create your account: ${SIGNUP_URL}
2. You'll get a confirmation email from us right after — click the link in it
   to activate your account. (Sign-in stays locked until you confirm.)

Once you're in, the full roadmap and lessons are open to you. Reply here if
anything doesn't work.

— Vadim
AI Engineer Roadmap · contact@ai-engineer-roadmap.xyz`;

  const html = `<p>Hi ${name},</p>
<p>Thanks for reaching out about the AI engineering roadmap — glad you want to join.</p>
<p>Two steps to get started:</p>
<ol>
<li>Create your account: <a href="${SIGNUP_URL}">${SIGNUP_URL}</a></li>
<li>You'll get a confirmation email from us right after — click the link in it to activate your account. (Sign-in stays locked until you confirm.)</li>
</ol>
<p>Once you're in, the full roadmap and lessons are open to you. Reply here if anything doesn't work.</p>
<p>— Vadim<br/>AI Engineer Roadmap · contact@ai-engineer-roadmap.xyz</p>`;

  const result = await sendEmail({
    to,
    subject: "Re: How can I join you? — An AI engineering roadmap",
    html,
    text,
    replyTo: "contact@ai-engineer-roadmap.xyz",
  });

  console.log(
    `✓ Invite sent to ${to} (HTTP ${result.status}${result.id ? `, id ${result.id}` : ""})`,
  );
}

main().catch((e) => {
  console.error(`✘ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
