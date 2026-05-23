import { createD1Client, type CompanyIntelDB } from "@ai-apps/company-intel/d1";

let cached: CompanyIntelDB | null = null;

// Returns a read-only Drizzle client against lead-gen's company intel, now on
// Cloudflare D1 (lead-gen retired Neon). The knowledge app only *reads* company
// intel — writes happen on the lead-gen side. Returns null when the Cloudflare
// credentials are not configured so callers can gracefully degrade.
export function getLeadgenDb(): CompanyIntelDB | null {
  if (cached) return cached;
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    return null;
  }
  cached = createD1Client();
  return cached;
}
