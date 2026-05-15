"use client";

import { NotesPanel } from "./NotesPanel";
import type { TabBaseProps } from "./types";

export function NotesTab({ app, isAdmin }: TabBaseProps) {
  return (
    <NotesPanel
      app={app}
      isAdmin={isAdmin}
      kind="note"
      heading="Notes"
      addLabel="Add Note"
      emptyLabel="No notes yet."
      newDialogTitle="New Note"
      deleteTitle="Delete note?"
      titlePlaceholder="e.g. Recruiter Intel, CSS Prep, React Patterns..."
      contentPlaceholder="Write your note..."
    />
  );
}
