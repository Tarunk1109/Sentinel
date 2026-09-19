import { z } from "zod";
import { AUTOPILOT_LIMITS, AUTOPILOT_STATUSES, autopilotPolicyInputSchema, CADENCES } from "@/lib/autopilot/policy";
import { VOICE_TRANSCRIPT_MAX } from "./text";

export const voiceInterpretRequestSchema = z.object({
  transcript: z.string({ error: "Send the transcript as text." }).trim()
    .min(1, "The transcript is empty. Say or type something first.")
    .max(VOICE_TRANSCRIPT_MAX, `Keep voice commands to ${VOICE_TRANSCRIPT_MAX} characters or fewer.`),
  /** The browser's IANA timezone, used only for schedules in a drafted autopilot. */
  timezone: z.string().max(64).optional(),
}).strict();

const policyRefSchema = z.object({ id: z.string().uuid(), name: z.string().max(AUTOPILOT_LIMITS.maxNameLength), status: z.enum(AUTOPILOT_STATUSES) }).strict();
export type VoicePolicyRef = z.infer<typeof policyRefSchema>;

/** A drafted autopilot is always a DRAFT and must be reviewed and activated by the user. */
const draftSchema = autopilotPolicyInputSchema.refine(draft => draft.status === "DRAFT", "Voice can only draft autopilots.");

export const CLARIFY_TOPICS = ["AUTOPILOT_CREATE", "AUTOPILOT_PAUSE", "AUTOPILOT_RESUME", "AUTOPILOT_RUN_NOW"] as const;
export const CLARIFY_FIELDS = ["items", "cadence", "budget", "currency", "policy"] as const;

/**
 * Every interpretation, from any interpreter, must parse against this schema before it is
 * returned. There is no command type that purchases, checks out, approves a purchase or
 * activates an autopilot: those remain explicit on-screen actions.
 */
export const voiceCommandSchema = z.discriminatedUnion("type", [
  /** Prefill for Request Mode. Nothing runs until the user submits it there. */
  z.object({ type: z.literal("REQUEST"), text: z.string().min(3).max(VOICE_TRANSCRIPT_MAX) }).strict(),
  z.object({ type: z.literal("AUTOPILOT_CREATE"), requiresConfirmation: z.literal(true), summary: z.string().max(400), draft: draftSchema }).strict(),
  z.object({ type: z.literal("AUTOPILOT_PAUSE"), requiresConfirmation: z.literal(false), policy: policyRefSchema }).strict(),
  z.object({ type: z.literal("AUTOPILOT_RESUME"), requiresConfirmation: z.literal(true), policy: policyRefSchema }).strict(),
  z.object({ type: z.literal("AUTOPILOT_RUN_NOW"), requiresConfirmation: z.literal(false), policy: policyRefSchema }).strict(),
  z.object({
    type: z.literal("NEEDS_CLARIFICATION"),
    about: z.enum(CLARIFY_TOPICS),
    reason: z.string().max(300),
    missing: z.array(z.enum(CLARIFY_FIELDS)).max(CLARIFY_FIELDS.length),
    candidates: z.array(policyRefSchema).max(AUTOPILOT_LIMITS.maxPoliciesPerOwner),
    /** What was understood so far, so the UI can prefill instead of starting over. */
    understood: z.object({
      items: z.array(z.string().max(AUTOPILOT_LIMITS.maxLabelLength)).max(AUTOPILOT_LIMITS.maxItems),
      cadence: z.enum(CADENCES).nullable(),
      weeklyBudgetMinor: z.number().int().nonnegative().nullable(),
    }).strict().nullable(),
  }).strict(),
  z.object({ type: z.literal("UNKNOWN"), reason: z.string().max(300) }).strict(),
]);
export type VoiceCommand = z.infer<typeof voiceCommandSchema>;
export type VoiceCommandInput = z.input<typeof voiceCommandSchema>;

export interface InterpretContext {
  /** This session's autopilots, for resolving "pause my café drinks autopilot". */
  policies: readonly VoicePolicyRef[];
  timezone: string;
}

/**
 * Pluggable interpreter contract. The deterministic interpreter implements it today. A
 * future AI interpreter must: make at most one model call per interpretation, never retry,
 * use a strict structured schema, and return output that passes `voiceCommandSchema`; it
 * still cannot activate, purchase or dispatch because no such command type exists.
 */
export interface VoiceCommandInterpreter {
  interpret(transcript: string, context: InterpretContext): VoiceCommandInput | Promise<VoiceCommandInput>;
}
