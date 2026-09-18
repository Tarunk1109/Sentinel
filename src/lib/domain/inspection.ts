import { z } from "zod";
import { productIntentSchema, type ProductIntent } from "./commerce";

/** Shared, serializable contracts for Inspect Mode. Never reads server credentials. */

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const shortItem = z.string().min(1).max(180);
const shortList = z.array(shortItem).max(8);

export const inspectionOutcomeSchema = z.enum([
  "ANALYZED",
  "NO_OBJECT_DETECTED",
  "MULTIPLE_UNRELATED_OBJECTS",
  "IMAGE_TOO_BLURRY",
  "IMAGE_TOO_DARK",
  "UNSUPPORTED_IMAGE",
  "CANNOT_DETERMINE_NEED",
]);
export type InspectionOutcome = z.infer<typeof inspectionOutcomeSchema>;

export const userNeedActionSchema = z.enum(["REPLACE_PART", "REPLACE_ITEM", "REFILL", "UPGRADE", "ACCESSORY", "UNKNOWN"]);
export type UserNeedAction = z.infer<typeof userNeedActionSchema>;

export const inspectionAnalysisSchema = z.object({
  outcome: inspectionOutcomeSchema,
  outcomeMessage: z.string().min(1).max(300),
  object: z.object({
    category: z.string().min(1).max(120),
    probableName: z.string().max(160).nullable(),
    brand: z.string().max(120).nullable(),
    model: z.string().max(120).nullable(),
    confidence: z.number().min(0).max(1),
  }).strict(),
  observedCondition: z.object({
    summary: z.string().min(1).max(400),
    visibleIssues: shortList,
    confidence: z.number().min(0).max(1),
  }).strict(),
  userNeed: z.object({
    action: userNeedActionSchema,
    productType: z.string().max(160).nullable(),
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
  warnings: z.array(z.string().min(1).max(220)).max(6),
  needsUserClarification: z.boolean(),
  clarificationQuestions: z.array(z.string().min(1).max(200)).max(3),
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

/**
 * Converts a completed inspection into the same ProductIntent shape Request Mode produces.
 * Pure and framework-agnostic: safe to call from the browser (no extra AI call) or from tests.
 * Unknown compatibility facts are carried forward as caveats, never dropped or invented.
 */
export function buildProductIntentFromInspection(analysis: InspectionAnalysis, constraints: InspectConstraints = {}): ProductIntent {
  if (analysis.outcome !== "ANALYZED") throw new Error("Cannot build a product intent from an inspection that did not complete.");
  const cap = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);
  const dedupe = (items: string[]) => [...new Set(items.map(item => item.trim()).filter(Boolean))];
  const subject = analysis.object.probableName?.trim() || analysis.object.category;
  const clarification = constraints.clarification?.trim();
  const extraRequirement = constraints.extraRequirement?.trim();
  let originalRequest = `Replacement ${analysis.searchIntent.productType} for the ${subject} shown in the uploaded photo.`;
  if (clarification) originalRequest += ` Additional detail from the user: "${clarification}"`;
  const unknownRequirements = analysis.compatibilityRequirements.unknown.map(item => cap(`${item} (not confirmed by the uploaded photo)`, 180));
  const compatibilityRequirements = dedupe([
    ...(clarification ? [cap(`User-provided detail: ${clarification}`, 180)] : []),
    ...analysis.searchIntent.compatibilityRequirements,
    ...analysis.compatibilityRequirements.verified,
    ...analysis.compatibilityRequirements.likely,
    ...unknownRequirements,
  ]).slice(0, 12);
  const preferredFeatures = dedupe([...analysis.searchIntent.preferredFeatures, ...(extraRequirement ? [extraRequirement] : [])]).slice(0, 12);
  return productIntentSchema.parse({
    originalRequest: cap(originalRequest, 1000),
    searchQuery: cap(analysis.searchIntent.searchQuery, 180),
    productType: cap(analysis.searchIntent.productType, 100),
    quantity: 1,
    budget: { maxAmount: constraints.budgetMaxAmount ?? null, currency: "CAD" },
    country: "CA",
    requiredFeatures: dedupe(analysis.searchIntent.requiredFeatures).slice(0, 12),
    preferredFeatures,
    excludedFeatures: [],
    compatibilityRequirements,
    brandPreferences: analysis.object.brand ? [analysis.object.brand] : [],
    merchantPreferences: [],
    urgency: null,
  });
}
