import { z } from "zod";

export const SlackSlashCommandSchema = z.object({
  command: z.string().startsWith("/"),
  text: z.string().max(500).default(""),
  user_id: z.string().min(1),
  team_id: z.string().min(1),
  channel_id: z.string().optional(),
  response_url: z.string().url().optional(),
}).strict();

export type SlackSlashCommand = z.infer<typeof SlackSlashCommandSchema>;
