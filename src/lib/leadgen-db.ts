import { createClient, type CompanyIntelDB } from "@ai-apps/company-intel/db";

let cached: CompanyIntelDB | null = null;

// Returns a read-only Drizzle client against lead-gen's Neon DB. The knowledge
// app only *reads* company intel — writes happen on the lead-gen side or
// through the LangGraph trigger client. Returns null when LEADGEN_DATABASE_URL
// is not configured so callers can gracefully degrade.
export function getLeadgenDb(): CompanyIntelDB | null {
  if (cached) return cached;
  const url = process.env.LEADGEN_DATABASE_URL;
  if (!url) return null;
  cached = createClient(url);
  return cached;
}
