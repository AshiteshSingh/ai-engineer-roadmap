import { redirect } from "next/navigation";

// The Application Pipeline is split into per-status tabbed sub-routes
// (/applications/saved, /applied, /interviewing, /offer, /rejected). The bare
// /applications path redirects to the first tab. Owner-guard is enforced by
// the (owner)/layout.tsx server component that wraps this route.
export default function ApplicationsIndex() {
  redirect("/applications/saved");
}
