import { createNextHandler } from "@ai-apps/auth";
import { auth } from "@/lib/auth";

export const { GET, POST } = createNextHandler(auth);
