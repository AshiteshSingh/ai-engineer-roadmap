import { and, eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { applicationNotes } from "../src/db/schema";

function serializeNote(note: Record<string, unknown>) {
  return {
    ...note,
    createdAt: note.createdAt instanceof Date ? note.createdAt.toISOString() : String(note.createdAt),
    updatedAt: note.updatedAt instanceof Date ? note.updatedAt.toISOString() : String(note.updatedAt),
  };
}

export const resolvers = {
  Query: {
    applicationNotes: async (
      _: unknown,
      { applicationId, kind }: { applicationId: string; kind?: string },
    ) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(applicationNotes)
        .where(
          kind
            ? and(
                eq(applicationNotes.applicationId, applicationId),
                eq(applicationNotes.kind, kind),
              )
            : eq(applicationNotes.applicationId, applicationId),
        );
      return rows.map(serializeNote);
    },
    applicationNote: async (_: unknown, { id }: { id: string }) => {
      const db = getDb();
      const [note] = await db
        .select()
        .from(applicationNotes)
        .where(eq(applicationNotes.id, id));
      return note ? serializeNote(note) : null;
    },
  },
  Mutation: {
    createApplicationNote: async (
      _: unknown,
      {
        input,
      }: {
        input: { applicationId: string; title: string; content: string; kind?: string };
      },
    ) => {
      const db = getDb();
      const [note] = await db
        .insert(applicationNotes)
        .values({ ...input, kind: input.kind ?? "note" })
        .returning();
      return serializeNote(note);
    },
    updateApplicationNote: async (
      _: unknown,
      { id, input }: { id: string; input: { title?: string; content?: string } },
    ) => {
      const db = getDb();
      const [note] = await db
        .update(applicationNotes)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(applicationNotes.id, id))
        .returning();
      return serializeNote(note);
    },
    deleteApplicationNote: async (_: unknown, { id }: { id: string }) => {
      const db = getDb();
      const result = await db
        .delete(applicationNotes)
        .where(eq(applicationNotes.id, id))
        .returning();
      return result.length > 0;
    },
  },
};
