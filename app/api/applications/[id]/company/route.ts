import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/src/db";
import { applications } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { getLeadgenDb } from "@/src/lib/leadgen-db";
import { getCompanyIntel, resolveCompanyKey } from "@ai-apps/company-intel/reads";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function whereApp(id: string, userId: string) {
  const col = UUID_RE.test(id) ? applications.id : applications.slug;
  return and(eq(col, id), eq(applications.userId, userId));
}

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

// Returns the lead-gen company intel (company + facts + contacts) for an
// application. If leadgen_company_key is not set, attempts resolution from
// the application's company name + url and persists the result.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [session, { id }] = await Promise.all([getSession(), params]);

  // Allow public access for apps marked public; otherwise require auth.
  const col = UUID_RE.test(id) ? applications.id : applications.slug;

  const where = session
    ? whereApp(id, session.user.id)
    : and(eq(col, id), eq(applications.public, true));

  const [app] = await db
    .select({
      id: applications.id,
      company: applications.company,
      url: applications.url,
      leadgenCompanyKey: applications.leadgenCompanyKey,
    })
    .from(applications)
    .where(where);

  if (!app) {
    return NextResponse.json(
      { error: session ? "Not found" : "Unauthorized" },
      { status: session ? 404 : 401 },
    );
  }

  const leadgenDb = getLeadgenDb();
  if (!leadgenDb) {
    return NextResponse.json(
      { error: "lead-gen integration not configured (LEADGEN_DATABASE_URL missing)" },
      { status: 503 },
    );
  }

  let key = app.leadgenCompanyKey;
  if (!key) {
    key = await resolveCompanyKey(leadgenDb, {
      name: app.company,
      url: app.url,
    });
    if (key) {
      await db
        .update(applications)
        .set({ leadgenCompanyKey: key, updatedAt: new Date() })
        .where(eq(applications.id, app.id));
    }
  }

  if (!key) {
    return NextResponse.json({ key: null, intel: null });
  }

  const intel = await getCompanyIntel(leadgenDb, key);
  return NextResponse.json({ key, intel });
}
