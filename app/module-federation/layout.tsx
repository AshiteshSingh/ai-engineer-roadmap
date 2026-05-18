import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/owner";

// Owner-only guard for the Module Federation deep-dive. Non-owners (including
// anonymous visitors) are redirected to the homepage with no flash and no hint
// the route exists — matching /coursework and /applications/(owner).
export default async function ModuleFederationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isOwner(session)) redirect("/");
  return <>{children}</>;
}
