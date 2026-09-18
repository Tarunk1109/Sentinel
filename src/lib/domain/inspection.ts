import { z } from "zod";
import { productIntentSchema, type ProductIntent } from "./commerce";

/** Shared, serializable contracts for Inspect Mode. Never reads server credentials. */

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const shortItem = z.string().min(1).max(180);
const shortList = z.array(shortItem).max(8);

/** Image-level failures only: can this photo be analyzed at all. A valid, analyzable
 * scene is always ANALYZED, even when nothing is wrong or multiple items are involved -
 * see `recommendedAction` and `primarySubjectAmbiguous` for those (non-failure) states. */
export const inspectionOutcomeSchema = z.enum([
  "ANALYZED",
  "NO_OBJECT_DETECTED",
  "MULTIPLE_UNRELATED_OBJECTS",
  "IMAGE_TOO_BLURRY",
  "IMAGE_TOO_DARK",
  "UNSUPPORTED_IMAGE",
]);
export type InspectionOutcome = z.infer<typeof inspectionOutcomeSchema>;

export const objectRoleSchema = z.enum(["PRIMARY", "SECONDARY", "BACKGROUND", "UNKNOWN"]);
export type ObjectRole = z.infer<typeof objectRoleSchema>;

/** What the primary subject's physical state is - independent of what, if anything, to do about it. */
export const conditionStatusSchema = z.enum(["DAMAGED", "MISSING_PART", "EMPTY_OR_DEPLETED", "INTACT", "POSSIBLE_HAZARD", "UNCERTAIN"]);
export type ConditionStatus = z.infer<typeof conditionStatusSchema>;

/** What SENTINEL should do next - separate from condition, so "it exists" never implies "buy something." */
export const recommendedActionTypeSchema = z.enum([
  "SEARCH_REPLACEMENT",
  "SEARCH_PART",
  "SEARCH_REFILL",
  "ASK_USER_INTENT",
  "ASK_CLARIFICATION",
  "CHOOSE_SUBJECT",
  "NO_ACTION",
]);
export type RecommendedActionType = z.infer<typeof recommendedActionTypeSchema>;

/** One visually distinct object in the photo. Attributes/evidence stay scoped to their own
 * object only - there is no separate free-floating "object" field for the model to fill
 * inconsistently, which is what let a foreground cable's connector and a background
 * adapter's AC pins get merged into one hallucinated "two-pin AC power cord" previously. */
export const detectedObjectSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  category: z.string().min(1).max(120),
  brand: z.string().max(120).nullable(),
  model: z.string().max(120).nullable(),
  role: objectRoleSchema,
  confidence: z.number().min(0).max(1),
  visibleEvidence: shortList,
}).strict();
export type DetectedObject = z.infer<typeof detectedObjectSchema>;

export const inspectionAnalysisSchema = z.object({
  outcome: inspectionOutcomeSchema,
  outcomeMessage: z.string().min(1).max(300),
  detectedObjects: z.array(detectedObjectSchema).min(1).max(6),
  /** Null when no single object stands out, or when outcome !== ANALYZED. */
  primarySubjectId: z.string().max(40).nullable(),
  /** True when two+ objects are comparably prominent and none is clearly the inspection subject. */
  primarySubjectAmbiguous: z.boolean(),
  condition: z.object({
    status: conditionStatusSchema,
    summary: z.string().min(1).max(400),
    visibleIssues: shortList,
    confidence: z.number().min(0).max(1),
  }).strict(),
  compatibilityRequirements: z.object({
    verified: shortList,
    likely: shortList,
    unknown: shortList,
  }).strict(),
  searchIntent: z.object({
    searchQuery: z.string().min(2).max(180),
    productType: z.string().min(1).max(100),
    requiredFeatures: shortList,
    preferredFeatures: shortList,
    compatibilityRequirements: shortList,
  }).strict(),
  recommendedAction: z.object({
    action: recommendedActionTypeSchema,
    reason: z.string().min(1).max(300),
  }).strict(),
  warnings: z.array(z.string().min(1).max(220)).max(6),
  needsUserClarification: z.boolean(),
  clarificationQuestions: z.array(z.string().min(1).max(200)).max(2),
}).strict();
export type InspectionAnalysis = z.infer<typeof inspectionAnalysisSchema>;

/** DEVELOPMENT FIXTURE results are always labelled as such; never used silently in production. */
export interface InspectionResponse {
  analysis: InspectionAnalysis;
  source: "live" | "fixture";
}

export const inspectImageRequestSchema = z.object({
  imageBase64: z.string().min(1).max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4096),
  mimeType: z.string().min(1).max(80),
}).strict();
export type InspectImageRequest = z.infer<typeof inspectImageRequestSchema>;

export const inspectConstraintsSchema = z.object({
  clarification: z.string().trim().max(300).optional(),
  extraRequirement: z.string().trim().max(160).optional(),
  budgetMaxAmount: z.number().positive().max(1000000).nullable().optional(),
}).strict();
export type InspectConstraints = z.infer<typeof inspectConstraintsSchema>;

/** The client may resubmit an edited, analysis-derived intent; it only steers search, never a charge. */
export const inspectSearchRequestSchema = z.object({ intent: productIntentSchema }).strict();
export type InspectSearchRequest = z.infer<typeof inspectSearchRequestSchema>;

/** What the user explicitly wants, when the photo alone doesn't justify a search automatically. */
export const userIntentActionSchema = z.enum(["REPLACE_ITEM", "REPLACE_PART", "REFILL", "UPGRADE", "ACCESSORY", "FIND_SIMILAR"]);
export type UserIntentAction = z.infer<typeof userIntentActionSchema>;
export interface UserIntentOverride { action: UserIntentAction; note?: string }

/** Which object the user means, required only when `primarySubjectAmbiguous` is true. */
export interface InspectionDecision { subjectId?: string; userIntent?: UserIntentOverride }

export function getDetectedObject(analysis: InspectionAnalysis, id: string | null): DetectedObject | null {
  if (!id) return null;
  return analysis.detectedObjects.find(o => o.id === id) ?? null;
}

const AUTO_SEARCH_ACTIONS = new Set<RecommendedActionType>(["SEARCH_REPLACEMENT", "SEARCH_PART", "SEARCH_REFILL"]);

/**
 * The UI branch to render for a completed inspection. Pure so it can drive the interface
 * and be unit-tested without React: an object merely existing is never enough on its own to
 * reach READY_TO_SEARCH - see `buildProductIntentFromInspection`, which enforces the same
 * rule again at the point an intent is actually built, independent of what the UI did.
 */
export type InspectionStep = "CHOOSE_SUBJECT" | "ASK_USER_INTENT" | "ASK_CLARIFICATION" | "READY_TO_SEARCH" | "NO_ACTION";
export function resolveInspectionStep(analysis: InspectionAnalysis, selectedSubjectId: string | null): InspectionStep {
  if (analysis.outcome !== "ANALYZED") throw new Error("Cannot resolve a step for an inspection that did not complete.");
  if (analysis.primarySubjectAmbiguous && !selectedSubjectId) return "CHOOSE_SUBJECT";
  if (AUTO_SEARCH_ACTIONS.has(analysis.recommendedAction.action)) return "READY_TO_SEARCH";
  if (analysis.recommendedAction.action === "ASK_CLARIFICATION") return "ASK_CLARIFICATION";
  if (analysis.recommendedAction.action === "NO_ACTION") return "NO_ACTION";
  // ASK_USER_INTENT, or CHOOSE_SUBJECT already resolved by a selected subject above.
  return "ASK_USER_INTENT";
}

const actionSentence: Record<UserIntentAction, (subjectLabel: string, partType: string) => string> = {
  REPLACE_ITEM: (subjectLabel) => `A replacement ${subjectLabel} similar to the one shown in the uploaded photo.`,
  REPLACE_PART: (subjectLabel, partType) => `Replacement ${partType} for the ${subjectLabel} shown in the uploaded photo.`,
  REFILL: (subjectLabel) => `A refill for the ${subjectLabel} shown in the uploaded photo.`,
  UPGRADE: (subjectLabel) => `An upgraded ${subjectLabel}, better than the one shown in the uploaded photo.`,
  ACCESSORY: (subjectLabel) => `An accessory for the ${subjectLabel} shown in the uploaded photo.`,
  FIND_SIMILAR: (subjectLabel) => `Another ${subjectLabel}, similar to the one shown in the uploaded photo.`,
};
function adjustSearchQuery(action: UserIntentAction, baseQuery: string, category: string): string {
  switch (action) {
    case "UPGRADE": return `premium ${baseQuery}`;
    case "ACCESSORY": return `${category} accessories`;
    case "REFILL": return /refill/i.test(baseQuery) ? baseQuery : `${baseQuery} refill`;
    default: return baseQuery;
  }
}

/**
 * Converts a completed inspection into the same ProductIntent shape Request Mode produces.
 * Pure and framework-agnostic: safe to call from the browser (no extra AI call) or from tests.
 * Unknown compatibility facts are carried forward as caveats, never dropped or invented.
 *
 * This is the enforced guard from Phase 4B: an object merely existing and looking intact is
 * never enough to build a search intent on its own. Building one here requires EITHER the
 * model's own visual evidence of a real problem (`recommendedAction` already one of the
 * SEARCH_* actions) OR the caller supplying an explicit `decision.userIntent` representing a
 * real user choice (e.g. clicking "Find an upgrade"). That check happens in code, not only in
 * the model prompt, so a prompt regression cannot silently start recommending purchases again.
 */
export function buildProductIntentFromInspection(analysis: InspectionAnalysis, constraints: InspectConstraints = {}, decision: InspectionDecision = {}): ProductIntent {
  if (analysis.outcome !== "ANALYZED") throw new Error("Cannot build a product intent from an inspection that did not complete.");
  if (analysis.primarySubjectAmbiguous && !decision.subjectId) throw new Error("Select which item to inspect before searching.");
  const subjectId = decision.subjectId ?? analysis.primarySubjectId;
  const subject = getDetectedObject(analysis, subjectId);
  if (!subject) throw new Error("The selected inspection subject could not be found.");
  const step = resolveInspectionStep(analysis, decision.subjectId ?? null);
  if (step === "CHOOSE_SUBJECT") throw new Error("Select which item to inspect before searching.");
  if (step === "NO_ACTION") throw new Error("This item does not show a problem or a stated need to search for.");
  if (step !== "READY_TO_SEARCH" && !decision.userIntent) throw new Error("A search needs either visible evidence of a problem or your explicit choice.");

  const effectiveAction: UserIntentAction = decision.userIntent?.action
    ?? (analysis.recommendedAction.action === "SEARCH_PART" ? "REPLACE_PART" : analysis.recommendedAction.action === "SEARCH_REFILL" ? "REFILL" : "REPLACE_ITEM");
  const cap = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);
  const dedupe = (items: string[]) => [...new Set(items.map(item => item.trim()).filter(Boolean))];
  const subjectLabel = subject.label.trim() || subject.category;
  const clarification = constraints.clarification?.trim();
  const userNote = decision.userIntent?.note?.trim();
  const extraRequirement = constraints.extraRequirement?.trim();

  let originalRequest = actionSentence[effectiveAction](subjectLabel, analysis.searchIntent.productType);
  if (userNote) originalRequest += ` The user added: "${userNote}"`;
  if (clarification) originalRequest += ` Additional detail from the user: "${clarification}"`;

  const unknownRequirements = analysis.compatibilityRequirements.unknown.map(item => cap(`${item} (not confirmed by the uploaded photo)`, 180));
  const compatibilityRequirements = dedupe([
    ...(userNote ? [cap(`User-provided detail: ${userNote}`, 180)] : []),
    ...(clarification ? [cap(`User-provided detail: ${clarification}`, 180)] : []),
    ...analysis.searchIntent.compatibilityRequirements,
    ...analysis.compatibilityRequirements.verified,
    ...analysis.compatibilityRequirements.likely,
    ...unknownRequirements,
  ]).slice(0, 12);
  const preferredFeatures = dedupe([...analysis.searchIntent.preferredFeatures, ...(extraRequirement ? [extraRequirement] : [])]).slice(0, 12);

  return productIntentSchema.parse({
    originalRequest: cap(originalRequest, 1000),
    searchQuery: cap(adjustSearchQuery(effectiveAction, analysis.searchIntent.searchQuery, subject.category), 180),
    productType: cap(analysis.searchIntent.productType, 100),
    quantity: 1,
    budget: { maxAmount: constraints.budgetMaxAmount ?? null, currency: "CAD" },
    country: "CA",
    requiredFeatures: dedupe(analysis.searchIntent.requiredFeatures).slice(0, 12),
    preferredFeatures,
    excludedFeatures: [],
    compatibilityRequirements,
    brandPreferences: subject.brand ? [subject.brand] : [],
    merchantPreferences: [],
    urgency: null,
  });
}
