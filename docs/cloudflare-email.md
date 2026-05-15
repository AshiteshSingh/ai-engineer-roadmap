# Email for ai-engineer-roadmap.xyz (Cloudflare)

Two independent halves: **inbound routing** (receive `contact@`) and
**outbound sending** (send from the domain). Zone is on Cloudflare DNS
(`zone 4046252dbb59693118181fcbef988486`, account `a036f50e…`).

## Inbound — Email Routing ✅ DONE

Verified live (2026-05-16):

- MX → `route1/2/3.mx.cloudflare.net`
- Apex SPF TXT → `v=spf1 include:_spf.mx.cloudflare.net ~all`
- Rule `contact@ai-engineer-roadmap.xyz → nicolai.vadim@gmail.com` (enabled)
- Destination `nicolai.vadim@gmail.com` **verified**

Nothing to do. `pnpm email:status` re-checks this; `pnpm email:status:ensure`
recreates the rule/destination idempotently if they ever disappear (a new
destination triggers a Cloudflare verification email you must click).

Token: `CLOUDFLARE_EMAIL_API_TOKEN` (scopes: Account → Email Routing
Addresses:Edit; Zone → Zone:Edit, DNS:Edit, Email Routing Rules:Edit).

## Outbound — Email Sending (beta) ⚠️ NEEDS ONBOARDING

`POST /accounts/{id}/email/sending/send`, flat body `{to,from,subject,html,text}`.
Not yet usable: no DKIM/DMARC/cf-bounce records, and the routing token gets
`404 Unable to authenticate request` on the Sending API.

Onboarding is **dashboard-only** in the beta (Cloudflare generates the DKIM
key, so it cannot be scripted):

1. Dashboard → **Compute → Email Service → Email Sending**
2. **Enable Email Sending** → **Onboard Domain** → `ai-engineer-roadmap.xyz`
3. **Continue** → **Add records and onboard** — auto-adds:
   - `cf-bounce` MX + SPF (bounce processing)
   - `cf-bounce._domainkey` DKIM TXT
   - `_dmarc` DMARC TXT
   (apex SPF stays as-is; routing keeps working)
4. Mint an API token with the **Email Sending** permission and set
   `CLOUDFLARE_EMAIL_SENDING_API_TOKEN` in `.env.local`
   (the routing token does **not** carry Sending scope — keep them separate).
5. `pnpm email:status` → all green, then
   `pnpm email:test --to you@example.com`

## Using it in code

```ts
import { sendEmail } from "@/lib/email/cloudflare";

await sendEmail({
  to: "user@example.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
}); // from defaults to EMAIL_FROM
```

Not wired into Better Auth — this is standalone sending capability only.

## Secrets Store

Both `CLOUDFLARE_EMAIL_API_TOKEN` and `CLOUDFLARE_D1_API_TOKEN` are mirrored
in the account Secrets Store `lead-gen-secrets`
(`ec928f4771fb4577a607a0b122e8087e`, scope `workers`) for future
`secrets_store_secrets` Worker bindings. Writing to that store needs
wrangler's OAuth creds, not `CLOUDFLARE_API_TOKEN` (which lacks the scope):
run from a dir without an `.env` and with `CLOUDFLARE_API_TOKEN` unset.
