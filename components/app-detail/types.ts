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
  aiInterviewQuestions: string | null;
  aiTechStack: string | null;
  aiInterviewers: string | null;
  techDismissedTags: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TabBaseProps {
  app: AppData;
  isAdmin: boolean;
}
