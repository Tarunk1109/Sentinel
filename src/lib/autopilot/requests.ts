import { z } from "zod";
import { AUTOPILOT_LIMITS, itemIdSchema } from "./policy";
import { inventoryObservationSchema } from "./trigger";

/** Activation and resume grant standing authority, so the caller must confirm explicitly. */
export const confirmRequestSchema = z.object({
  confirm: z.literal(true, { error: "Activating or resuming an autopilot requires { \"confirm\": true } after the user reviews it." }),
}).strict();

export const evaluateRequestSchema = z.object({ inventory: inventoryObservationSchema.optional() }).strict();

export const searchRequestSchema = z.object({
  runId: z.string().uuid("Provide the run id returned by evaluate."),
  itemId: itemIdSchema,
}).strict();

export const authorizeRequestSchema = z.object({
  runId: z.string().uuid("Provide the run id returned by evaluate."),
  /** References to real search results. Prices are always read server-side, never sent by the client. */
  selections: z.array(z.object({
    itemId: itemIdSchema,
    missionId: z.string().uuid("Provide the mission id returned by the search."),
    productId: z.string().min(1).max(160),
  }).strict()).min(1, "Select at least one product.").max(AUTOPILOT_LIMITS.maxItems, `Up to ${AUTOPILOT_LIMITS.maxItems} selections.`),
}).strict();
export type AuthorizeRequest = z.infer<typeof authorizeRequestSchema>;

export const demoRequestSchema = z.object({ timezone: z.string().max(64).optional() }).strict();
