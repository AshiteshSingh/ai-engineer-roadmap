import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/owner";

// Owner-only guard for the Applications list. Signed-out visitors are sent to
// /login with a callbackURL so they can sign in and land back here; logged-in
// non-owners are redirected to the homepage. Individual public-shared
// applications live outside this route group.
export default async function ApplicationsOwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect(`/login?callbackURL=${encodeURIComponent("/applications")}`);
  }
  if (!isOwner(session)) redirect("/");
  return <>{children}</>;
}
