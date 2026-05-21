import { z } from "zod";

export const WorkflowRunStatusSchema = z.enum([
  "pending_ai_generation",
  "ai_generation_processing",
  "ai_generation_completed",
  "ai_generation_failed"
]);

export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

