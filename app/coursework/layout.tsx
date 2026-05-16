import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/owner";

// Owner-only guard for the entire Coursework section (list + all nested
// learner/slovenia/images/ideas routes). Coursework has no public path.
export default async function CourseworkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isOwner(session)) redirect("/");
  return <>{children}</>;
}
