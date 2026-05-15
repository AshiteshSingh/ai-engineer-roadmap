"use client";

import { createAuthClient } from "@ai-apps/auth/client";

export const authClient = createAuthClient();
export const { signIn, signUp, signOut, useSession } = authClient;
