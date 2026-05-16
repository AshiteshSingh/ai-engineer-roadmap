import { createAuth } from "@ai-apps/auth";
import { db } from "@/src/db";
import { sendEmail } from "@/lib/email/cloudflare";

export const auth = createAuth(db, undefined, {
  emailVerify: {
    subject: "Confirm your email to activate your AI Engineer Roadmap account",
    send: async ({ to, subject, html, text }) => {
      await sendEmail({
        to,
        subject,
        html,
        text,
        replyTo: "contact@ai-engineer-roadmap.xyz",
      });
    },
  },
});
