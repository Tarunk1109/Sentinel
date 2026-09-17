import "server-only";

import { z } from "zod";

export const MAX_PROMPT_LENGTH = 1000;

export const missionRequestSchema = z.object({
  prompt: z.string()
    .trim()
    .min(3, "Describe what you need in at least 3 characters.")
    .max(MAX_PROMPT_LENGTH, `Keep your request to ${MAX_PROMPT_LENGTH} characters or fewer.`),
}).strict();
