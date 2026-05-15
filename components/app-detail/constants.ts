import type { ApplicationStatus } from "./types";

export const COLUMNS: {
  status: ApplicationStatus;
  label: string;
  color: "gray" | "blue" | "orange" | "green" | "red";
}[] = [
  { status: "saved", label: "Saved", color: "gray" },
  { status: "applied", label: "Applied", color: "blue" },
  { status: "interviewing", label: "Interviewing", color: "orange" },
  { status: "offer", label: "Offer", color: "green" },
  { status: "rejected", label: "Rejected", color: "red" },
];

export const NEXT_STATUS: Partial<Record<ApplicationStatus, ApplicationStatus>> = {
  saved: "applied",
  applied: "interviewing",
  interviewing: "offer",
};

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function companyInitials(name: string): string {
  return name
    .split(/[\s\-_.]/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
