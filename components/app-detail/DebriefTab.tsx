"use client";

import { NotesPanel } from "./NotesPanel";
import type { TabBaseProps } from "./types";

export function DebriefTab({ app, isAdmin }: TabBaseProps) {
  return (
    <NotesPanel
      app={app}
      isAdmin={isAdmin}
      kind="debrief"
      heading="Post-Interview Debrief"
      addLabel="Add Debrief"
      emptyLabel="No debriefs yet."
      newDialogTitle="New Debrief"
      deleteTitle="Delete debrief?"
      titlePlaceholder="e.g. Round 1 — Recruiter Screen, Tech Round, Final..."
      contentPlaceholder="How did it go? Questions asked, what went well, what to improve, next steps..."
    />
  );
}
