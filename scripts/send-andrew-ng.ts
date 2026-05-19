/**
 * Send a one-off outreach email to Andrew Ng (DeepLearning.AI) via Cloudflare
 * Email Service, from contact@ai-engineer-roadmap.xyz.
 *
 * Expresses interest in the DeepLearning.AI Ambassador program and asks about
 * their referral program (emphasis on referral), using AI Engineer Roadmap as
 * credentials. Invents no program specifics — those belong to DeepLearning.AI.
 *
 * Usage (dry-run to self first, then the real recipient):
 *   tsx --env-file=.env.local scripts/send-andrew-ng.ts --to contact@ai-engineer-roadmap.xyz
 *   tsx --env-file=.env.local scripts/send-andrew-ng.ts --to ng@deeplearning.ai
 *
 * Requires CLOUDFLARE_ACCOUNT_ID and a Sending-scoped Cloudflare email token
 * (CLOUDFLARE_EMAIL_SENDING_API_TOKEN, or CLOUDFLARE_EMAIL_API_TOKEN fallback)
 * in .env.local. Run `pnpm email:status` first if unsure.
 */
import { sendEmail, emailSendingConfigured } from "../lib/email/cloudflare";

const SITE_URL = "https://ai-engineer-roadmap.xyz/";
const REPO_URL = "https://github.com/v9ai/ai-engineer-roadmap";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = arg("--to");
  if (!to) {
    console.error(
      "Usage: tsx --env-file=.env.local scripts/send-andrew-ng.ts --to someone@example.com",
    );
    process.exit(1);
  }
  if (!emailSendingConfigured()) {
    console.error(
      "Cloudflare Email Sending not configured: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_SENDING_API_TOKEN in .env.local",
    );
    process.exit(1);
  }

  const subject =
    "Interested in the DeepLearning.AI Ambassador program — and a referral question";

  const text = `Hi Andrew,

I've been building AI Engineer Roadmap (${SITE_URL}) — a hands-on path that takes engineers from transformer internals to shipping production AI systems: 108 deeply-researched lessons across RAG, agents, evals, fine-tuning, and prompting. It's open source: ${REPO_URL}

I'd love to get involved with the DeepLearning.AI Ambassador program — the teaching mission and community line up closely with what I'm building.

What I'm most curious about is the referral side: is there a referral program (for learners and/or ambassadors), and how does it work? That's the part most relevant to how I'd want to contribute, so any pointer there would be hugely appreciated.

Happy to share more about the roadmap or how I could help. Thanks for everything you do for this field.

— Vadim
AI Engineer Roadmap · contact@ai-engineer-roadmap.xyz`;

  const html = `<p>Hi Andrew,</p>
<p>I've been building <strong>AI Engineer Roadmap</strong> (<a href="${SITE_URL}">${SITE_URL}</a>) — a hands-on path that takes engineers from transformer internals to shipping production AI systems: 108 deeply-researched lessons across RAG, agents, evals, fine-tuning, and prompting. It's open source: <a href="${REPO_URL}">${REPO_URL}</a></p>
<p>I'd love to get involved with the <strong>DeepLearning.AI Ambassador program</strong> — the teaching mission and community line up closely with what I'm building.</p>
<p>What I'm most curious about is the <strong>referral side</strong>: is there a referral program (for learners and/or ambassadors), and how does it work? That's the part most relevant to how I'd want to contribute, so any pointer there would be hugely appreciated.</p>
<p>Happy to share more about the roadmap or how I could help. Thanks for everything you do for this field.</p>
<p>— Vadim<br/>AI Engineer Roadmap · contact@ai-engineer-roadmap.xyz</p>`;

  const result = await sendEmail({
    to,
    subject,
    html,
    text,
    replyTo: "contact@ai-engineer-roadmap.xyz",
  });

  console.log(
    `✓ Sent to ${to} (HTTP ${result.status}${result.id ? `, id ${result.id}` : ""})`,
  );
}

main().catch((e) => {
  console.error(`✘ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
