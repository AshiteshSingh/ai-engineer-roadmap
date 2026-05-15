import { createAuth } from "@ai-apps/auth";
import { db } from "@/src/db";

export const auth = createAuth(db);
