/**
 * Cloudflare email setup verifier / reporter for ai-engineer-roadmap.xyz.
 *
 * Usage:
 *   tsx --env-file=.env.local scripts/email-status.ts            # report only
 *   tsx --env-file=.env.local scripts/email-status.ts --ensure-routing
 *
 * Read-only by default. With --ensure-routing it idempotently creates the
 * inbound rule (contact@ -> destination) and destination address if missing
 * (a missing destination triggers a Cloudflare verification email you must
 * click). Outbound "Email Sending" onboarding is dashboard-only in the beta
 * and is only reported here, not created — see docs/cloudflare-email.md.
 */

const API = "https://api.cloudflare.com/client/v4";
const DOMAIN = process.env.EMAIL_DOMAIN || "ai-engineer-roadmap.xyz";
const LOCAL_PART = "contact";
const DESTINATION = process.env.EMAIL_ROUTE_DESTINATION || "nicolai.vadim@gmail.com";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const ROUTING_TOKEN = process.env.CLOUDFLARE_EMAIL_API_TOKEN;
const SENDING_TOKEN =
  process.env.CLOUDFLARE_EMAIL_SENDING_API_TOKEN ||
  process.env.CLOUDFLARE_EMAIL_API_TOKEN;

const ENSURE = process.argv.includes("--ensure-routing");

if (!ACCOUNT_ID || !ROUTING_TOKEN) {
  console.error(
    "Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_EMAIL_API_TOKEN in .env.local",
  );
  process.exit(1);
}

async function cf(
  path: string,
  init: RequestInit = {},
  token: string = ROUTING_TOKEN as string,
): Promise<{ status: number; json: any }> {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  let json: any = {};
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

const ok = (b: boolean) => (b ? "✅" : "⚠️ ");

async function main() {
  // 1. Zone
  const z = await cf(`/zones?name=${DOMAIN}`);
  const zone = (z.json.result || [])[0];
  if (!zone) {
    console.error(`✘ Zone ${DOMAIN} not found on this account`);
    process.exit(1);
  }
  const zid = zone.id;
  console.log(`\nDomain: ${DOMAIN}  (zone ${zid}, status ${zone.status})`);

  // 2. Inbound routing rule + destination
  const rules = await cf(`/zones/${zid}/email/routing/rules`);
  const wanted = `${LOCAL_PART}@${DOMAIN}`;
  let rule = (rules.json.result || []).find((r: any) =>
    (r.matchers || []).some((m: any) => m.value === wanted),
  );
  const addrs = await cf(`/accounts/${ACCOUNT_ID}/email/routing/addresses`);
  let dest = (addrs.json.result || []).find(
    (a: any) => a.email === DESTINATION,
  );

  if (ENSURE && !dest) {
    const r = await cf(`/accounts/${ACCOUNT_ID}/email/routing/addresses`, {
      method: "POST",
      body: JSON.stringify({ email: DESTINATION }),
    });
    dest = r.json.result;
    console.log(
      `→ Created destination ${DESTINATION} — check that inbox and click the Cloudflare verification link.`,
    );
  }
  if (ENSURE && !rule) {
    const r = await cf(`/zones/${zid}/email/routing/rules`, {
      method: "POST",
      body: JSON.stringify({
        name: `${LOCAL_PART}@ -> ${DESTINATION}`,
        enabled: true,
        matchers: [{ type: "literal", field: "to", value: wanted }],
        actions: [{ type: "forward", value: [DESTINATION] }],
      }),
    });
    rule = r.json.result;
    console.log(`→ Created routing rule ${wanted} -> ${DESTINATION}`);
  }

  // 3. DNS records (routing MX/SPF + sending DKIM/DMARC/cf-bounce)
  const dns = await cf(`/zones/${zid}/dns_records?per_page=200`);
  const recs: any[] = dns.json.result || [];
  const has = (pred: (r: any) => boolean) => recs.some(pred);
  const mxCloudflare = has(
    (r) => r.type === "MX" && /mx\.cloudflare\.net$/.test(r.content),
  );
  const apexSpf = has(
    (r) =>
      r.type === "TXT" && r.name === DOMAIN && r.content.includes("v=spf1"),
  );
  const dkim = has(
    (r) => r.type === "TXT" && r.name.includes("_domainkey"),
  );
  const dmarc = has(
    (r) => r.type === "TXT" && r.name === `_dmarc.${DOMAIN}`,
  );
  const cfBounce = has((r) => r.name.startsWith("cf-bounce."));

  // 4. Sending API reachability with the configured send token
  const send = await cf(
    `/accounts/${ACCOUNT_ID}/email/sending/domains`,
    {},
    SENDING_TOKEN as string,
  );
  const sendingApiOk = send.status === 200;

  console.log("\n── Inbound (Email Routing) ─────────────────────────────");
  console.log(`${ok(!!rule && rule.enabled)} Rule ${wanted} -> forward`);
  console.log(
    `${ok(!!dest && !!dest.verified)} Destination ${DESTINATION} ${
      dest ? (dest.verified ? "(verified)" : "(UNVERIFIED — click the email)") : "(missing)"
    }`,
  );
  console.log(`${ok(mxCloudflare)} MX → *.mx.cloudflare.net`);
  console.log(`${ok(apexSpf)} SPF TXT at apex`);

  console.log("\n── Outbound (Email Sending, beta) ──────────────────────");
  console.log(`${ok(dkim)} DKIM TXT (*_domainkey*)`);
  console.log(`${ok(dmarc)} DMARC TXT (_dmarc.${DOMAIN})`);
  console.log(`${ok(cfBounce)} cf-bounce.* records`);
  console.log(
    `${ok(sendingApiOk)} Sending API reachable with send token (HTTP ${send.status})`,
  );

  const sendingReady = dkim && dmarc && cfBounce && sendingApiOk;
  if (!sendingReady) {
    console.log(
      "\nTo finish OUTBOUND sending (one-time, dashboard-only in beta):\n" +
        "  1. Cloudflare dashboard → Compute → Email Service → Email Sending\n" +
        "  2. Enable Email Sending → Onboard Domain → " +
        DOMAIN +
        "\n  3. Continue → \"Add records and onboard\" (adds DKIM/DMARC/cf-bounce)\n" +
        "  4. Mint an API token with the 'Email Sending' permission and set\n" +
        "     CLOUDFLARE_EMAIL_SENDING_API_TOKEN (the routing token lacks Sending scope)\n" +
        "  5. Re-run this script, then: pnpm email:test --to you@example.com\n" +
        "  See docs/cloudflare-email.md for detail.",
    );
  } else {
    console.log("\n✅ Outbound sending is fully configured.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
