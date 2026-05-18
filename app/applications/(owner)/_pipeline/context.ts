"use client";

import { createContext, useContext } from "react";
import type { AppData, ApplicationStatus } from "@/components/app-detail/types";

export interface PipelineContextValue {
  apps: AppData[];
  loading: boolean;
  handleMove: (slug: string, status: ApplicationStatus) => Promise<void>;
  handleReject: (slug: string) => void;
  addApp: (app: AppData) => void;
}

export const PipelineContext = createContext<PipelineContextValue | null>(null);

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) {
    throw new Error("usePipeline must be used within the pipeline layout");
  }
  return ctx;
}
