export type ApplicationStatus =
  | "saved"
  | "applied"
  | "interviewing"
  | "offer"
  | "rejected";

export interface AppData {
  id: string;
  slug: string;
  company: string;
  position: string;
  url: string | null;
  status: ApplicationStatus;
  notes: string | null;
  jobDescription: string | null;
  interviewQuestions: string | null;
  // Owner-only, regen-proof tailored prep. Populated by the API ONLY when the
  // requester is the owner (data/app-prep/<slug>.owner.json); null for the
  // public seed and every non-owner response. Never overwritten by gen-app-prep.
  ownerPrep: string | null;
  techStack: string | null;
  interviewers: string | null;
  techDismissedTags: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TabBaseProps {
  app: AppData;
  isAdmin: boolean;
}
