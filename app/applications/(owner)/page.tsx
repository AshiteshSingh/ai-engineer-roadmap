import { redirect } from "next/navigation";

// The Application Pipeline is split into tabbed sub-routes: an "All" overview
// plus per-status tabs (/applications/all, /saved, /applied, /interviewing,
// /offer, /rejected). The bare /applications path redirects to the All tab so
// the landing view always shows every application regardless of status. The
// owner-guard is enforced by the (owner)/layout.tsx server component that wraps
// this route.
export default function ApplicationsIndex() {
  redirect("/applications/all");
}
