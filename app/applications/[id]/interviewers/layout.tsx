import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/owner";

// Owner-only guard for the interviewers sub-page.
export default async function ApplicationInterviewersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isOwner(session)) redirect("/");
  return <>{children}</>;
}
