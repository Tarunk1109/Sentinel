import { z } from "zod";
import { productIntentSchema, type Country, type Currency, type Price, type ProductIntent } from "./commerce";

/**
 * Shared, serializable contracts for Build Mode. Never reads server credentials, never
 * carries image data. Intentionally separate from `lib/domain/inspection.ts`: Inspect selects
 * one primary subject from a photo of something broken; Build classifies MANY components from
 * a reference photo of something to create. Forcing one shared "detected object" shape across
 * both would either drag Inspect's single-subject assumption into Build, or blur Build's
 * role/dependency/quantity concerns into Inspect. They intentionally share conventions
 * (strict Zod schemas, evidence-scoped honesty, the same image validation) without sharing a type.
 */

const shortItem = z.string().min(1).max(180);
const shortList = z.array(shortItem).max(8);

/**
 * Per-component evidence/requirement fields specifically (visibleEvidence,
 * inferredRequirements, compatibilityRequirements, unknowns). These are the fields that
 * multiply by component count, so they get a tighter cap than `shortList` above (used for
 * the analysis-level existingItems/missingInformation, which don't multiply and weren't
 * implicated in the token-limit failure this bounds). See PHASE5_REPORT.md for the
 * output-token incident this was sized against.
 */
const componentEvidenceItem = z.string().min(1).max(120);
const componentEvidenceList = z.array(componentEvidenceItem).max(3);

/** Image-level failures only: can this photo be analyzed at all. */
export const buildOutcomeSchema = z.enum(["ANALYZED", "NO_OBJECT_DETECTED", "IMAGE_TOO_BLURRY", "IMAGE_TOO_DARK", "UNSUPPORTED_IMAGE"]);
export type BuildOutcome = z.infer<typeof buildOutcomeSchema>;

/** Functional priority to the user's goal, not visual prominence. Budget favors function over aesthetics. */
export const buildComponentRoleSchema = z.enum(["ESSENTIAL", "RECOMMENDED", "OPTIONAL", "DECORATIVE"]);
export type BuildComponentRole = z.infer<typeof buildComponentRoleSchema>;

/**
 * Purchase structure, independent of `role`: `role` says how important a component is to
 * the goal; `componentKind` says whether it is ever its own line item at all.
 * - PURCHASABLE: a standalone item someone would normally buy on its own.
 * - ACCESSORY: also standalone and separately bought, but optional/complementary rather
 *   than core (a monitor arm, a desk mat).
 * - DECORATIVE: visual styling that is still its own purchasable item if the user opts
 *   in, but must never be auto-selected (see `defaultSelection`).
 * - INTEGRATED_FEATURE: physically part of another component (`parentComponentId`) and
 *   never sold separately - a desk's built-in keyboard tray, a chair's attached armrests.
 *   Never gets a plan item, budget allocation, selection checkbox, or search of its own;
 *   its evidence instead becomes part of its parent's own ProductIntent.
 */
export const buildComponentKindSchema = z.enum(["PURCHASABLE", "INTEGRATED_FEATURE", "ACCESSORY", "DECORATIVE"]);
export type BuildComponentKind = z.infer<typeof buildComponentKindSchema>;

export const buildComponentSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  category: z.string().min(1).max(60),
  brand: z.string().max(60).nullable(),
  model: z.string().max(60).nullable(),
  role: buildComponentRoleSchema,
  componentKind: buildComponentKindSchema,
  /** Non-null only for componentKind INTEGRATED_FEATURE; the id of the component this is
   * physically part of. A value that doesn't resolve to a real, non-feature component in
   * the same analysis is treated as unparented (dropped from any parent's intent, never a
   * crash or a fabricated separate purchase) - see `integratedFeaturesOf`. */
  parentComponentId: z.string().min(1).max(40).nullable(),
  confidence: z.number().min(0).max(1),
  visibleEvidence: componentEvidenceList,
  inferredRequirements: componentEvidenceList,
  compatibilityRequirements: componentEvidenceList,
  unknowns: componentEvidenceList,
  quantity: z.number().int().min(1).max(10),
}).strict();
export type BuildComponent = z.infer<typeof buildComponentSchema>;

export const buildDependencyImportanceSchema = z.enum(["REQUIRED", "RECOMMENDED"]);
export const buildDependencySchema = z.object({
  sourceComponentId: z.string().min(1).max(40),
  targetComponentId: z.string().min(1).max(40),
  relationship: z.string().min(1).max(160),
  importance: buildDependencyImportanceSchema,
}).strict();
export type BuildDependency = z.infer<typeof buildDependencySchema>;

export const buildAnalysisSchema = z.object({
  outcome: buildOutcomeSchema,
  outcomeMessage: z.string().min(1).max(300),
  scene: z.object({
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(400),
    confidence: z.number().min(0).max(1),
  }).strict(),
  /** Capped at 8, not the schema's old 12: only materially relevant components -
   * independently purchasable items, important integrated features, and meaningful
   * accessories - never every visually insignificant object. See STEP 2 in
   * `analyzeBuildScene`'s instructions and PHASE5_REPORT.md for why. */
  components: z.array(buildComponentSchema).min(1).max(8),
  dependencies: z.array(buildDependencySchema).max(10),
  /** Component names the user's text already told us they own; matched case-insensitively
   * against `components[].name` when building the plan. Never guessed from the photo alone. */
  existingItems: shortList,
  missingInformation: shortList,
  needsClarification: z.boolean(),
  clarificationQuestions: z.array(z.string().min(1).max(200)).max(3),
  buildSummary: z.string().min(1).max(400),
}).strict();
export type BuildAnalysis = z.infer<typeof buildAnalysisSchema>;

/** DEVELOPMENT FIXTURE results are always labelled as such; never used silently in production. */
export interface BuildAnalysisResponse { analysis: BuildAnalysis; source: "live" | "fixture" }

export const buildConstraintsSchema = z.object({
  budgetMaxAmount: z.number().positive().max(1000000).nullable().optional(),
  goal: z.string().trim().max(200).optional(),
  alreadyOwn: z.string().trim().max(300).optional(),
  requirements: z.string().trim().max(300).optional(),
}).strict();
export type BuildConstraints = z.infer<typeof buildConstraintsSchema>;

export const buildImageRequestSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1).max(80),
  constraints: buildConstraintsSchema.optional(),
}).strict();

/**
 * The signed, server-issued contents of a Build session token (see
 * `lib/server/build-session-token.ts`). This is the entire trust boundary for the
 * analyze -> search flow: everything in here is cryptographically bound together, so a
 * component's role, budget allocation, and the analysis it came from can never be split
 * apart or substituted by a client. Never includes image bytes or a secret.
 */
export const buildSessionPayloadSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(64),
  owner: z.string().min(1).max(100),
  analysis: buildAnalysisSchema,
  constraints: buildConstraintsSchema,
  source: z.enum(["live", "fixture"]),
  fixtureName: z.string().min(1).max(60).nullable(),
  usage: z.object({
    modelCalls: z.number().int().nonnegative(),
    agnicCalls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }).strict(),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
}).strict();
export type BuildSessionPayload = z.infer<typeof buildSessionPayloadSchema>;

export const buildSearchRequestSchema = z.object({
  /** Opaque, server-signed. Carries the trusted analysis/constraints/owner; never parsed
   * or trusted client-side. See `verifyBuildSession`. */
  token: z.string().min(1).max(200_000),
  selectedIds: z.array(z.string().min(1).max(40)).max(12),
  /** The caller's own previously-returned results, echoed back so a session with no
   * server-side memory can still report a complete, accumulated view. Opaque display data,
   * never trusted for pricing, ownership, or anything security-relevant - a client can only
   * ever deceive itself by tampering with this. */
  priorResults: z.array(z.unknown()).max(12).optional(),
  clarification: z.string().trim().max(300).optional(),
}).strict();
export type BuildSearchRequest = z.infer<typeof buildSearchRequestSchema>;

export interface BuildPlanItem {
  componentId: string;
  name: string;
  role: BuildComponentRole;
  quantity: number;
  owned: boolean;
  included: boolean;
  budgetAllocation: Price | null;
  intent: ProductIntent | null;
}
export interface BuildPlan {
  title: string;
  budget: { maxAmount: number | null; currency: Currency };
  country: Country;
  items: BuildPlanItem[];
  dependencies: BuildDependency[];
  warnings: string[];
}

const ROLE_WEIGHT: Record<BuildComponentRole, number> = { ESSENTIAL: 4, RECOMMENDED: 2, OPTIONAL: 1, DECORATIVE: 0.5 };

/** True only when the user's own "already own" text names this component; never inferred from the photo. */
function isOwned(component: BuildComponent, analysis: BuildAnalysis): boolean {
  const needle = component.name.trim().toLowerCase();
  return analysis.existingItems.some(item => {
    const owned = item.trim().toLowerCase();
    return owned.length > 0 && (owned === needle || needle.includes(owned) || owned.includes(needle));
  });
}

/** True only for a component that is ever its own line item - never an integrated feature. */
function isPurchasableKind(component: BuildComponent): boolean {
  return component.componentKind !== "INTEGRATED_FEATURE";
}

/** Every INTEGRATED_FEATURE component whose `parentComponentId` names this one. A feature
 * naming a parent that isn't a real, purchasable component in this analysis simply never
 * matches here - dropped from the parent's intent, never a crash and never promoted into
 * a purchasable item of its own. */
export function integratedFeaturesOf(component: BuildComponent, analysis: BuildAnalysis): BuildComponent[] {
  return analysis.components.filter(c => c.componentKind === "INTEGRATED_FEATURE" && c.parentComponentId === component.id);
}

/** Components auto-selected before the user reviews anything: essentials and recommendations, never decorative, never an integrated feature (which is never separately selectable at all). */
function defaultSelection(analysis: BuildAnalysis): string[] {
  return analysis.components.filter(c => isPurchasableKind(c) && !isOwned(c, analysis) && (c.role === "ESSENTIAL" || c.role === "RECOMMENDED")).map(c => c.id);
}

function cap(value: string, max: number): string { return value.length > max ? value.slice(0, max) : value; }
function dedupe(items: string[]): string[] { return [...new Set(items.map(item => item.trim()).filter(Boolean))]; }

/** Reuses the exact existing Agnic search architecture: a component becomes a ProductIntent,
 * nothing more. Unknown compatibility facts are carried forward as caveats, never invented.
 * `integratedFeatures` (see `integratedFeaturesOf`) are folded in as part of what this
 * component must have, never as anything searched or budgeted on their own. */
export function buildProductIntentFromComponent(component: BuildComponent, constraints: BuildConstraints, budgetAllocation: Price | null, integratedFeatures: BuildComponent[] = []): ProductIntent {
  const goal = constraints.goal?.trim();
  let originalRequest = `${component.name} for ${goal ? `a ${goal} build` : "a build"}, identified from an uploaded reference photo.`;
  if (integratedFeatures.length) originalRequest += ` Must include, built in: ${integratedFeatures.map(f => f.name).join(", ")}.`;
  if (constraints.requirements?.trim()) originalRequest += ` Additional requirement from the user: "${constraints.requirements.trim()}"`;
  const featureRequirements = integratedFeatures.flatMap(feature => [feature.name, ...feature.inferredRequirements]);
  const featureCompatibility = integratedFeatures.flatMap(feature => [
    ...feature.compatibilityRequirements,
    ...feature.unknowns.map(item => cap(`${item} (not confirmed by the uploaded photo)`, 180)),
  ]);
  const compatibilityRequirements = dedupe([
    ...component.compatibilityRequirements,
    ...component.unknowns.map(item => cap(`${item} (not confirmed by the uploaded photo)`, 180)),
    ...featureCompatibility,
  ]).slice(0, 12);
  const searchQuery = integratedFeatures.length
    ? cap(`${component.category} with ${dedupe(integratedFeatures.map(f => f.name.toLowerCase())).join(" and ")}`, 180)
    : cap(component.category, 180);
  return productIntentSchema.parse({
    originalRequest: cap(originalRequest, 1000),
    searchQuery,
    productType: cap(component.category, 100),
    quantity: component.quantity,
    budget: { maxAmount: budgetAllocation ? Number((budgetAllocation.amountMinor / 100).toFixed(2)) : null, currency: budgetAllocation?.currency ?? "CAD" },
    country: "CA",
    requiredFeatures: dedupe([...component.inferredRequirements, ...featureRequirements]).slice(0, 12),
    preferredFeatures: [],
    excludedFeatures: [],
    compatibilityRequirements,
    brandPreferences: component.brand ? [component.brand] : [],
    merchantPreferences: [],
    urgency: null,
  });
}

/**
 * Converts a completed scene analysis and the user's constraints into a commerce-ready plan.
 * Pure and framework-agnostic. Allocation is weighted by functional role and quantity, never
 * split equally and never exceeding the user's own stated budget (rounding only ever removes
 * cents from the total, never adds them). This is a coherent estimate, not a claimed
 * optimization - see PHASE5_REPORT.md. Owned items are kept for dependency context but are
 * never allocated budget and are never auto-included for purchase.
 *
 * An INTEGRATED_FEATURE component (e.g. a desk's built-in keyboard tray) never becomes its
 * own `BuildPlanItem`: it has no plan row, no budget allocation, no selection checkbox, and
 * is never searched - only `purchasable` components are. Its evidence is instead folded
 * into its parent's own ProductIntent (see `buildProductIntentFromComponent`), and any
 * dependency edge naming it is dropped rather than left pointing at a component that will
 * never itself have a search result to verify against.
 */
export function createBuildPlan(analysis: BuildAnalysis, constraints: BuildConstraints, selectedIds?: string[]): BuildPlan {
  if (analysis.outcome !== "ANALYZED") throw new Error("Cannot build a plan from an analysis that did not complete.");
  const purchasable = analysis.components.filter(isPurchasableKind);
  const purchasableIds = new Set(purchasable.map(c => c.id));
  const selected = new Set(selectedIds ?? defaultSelection(analysis));
  const totalMinor = constraints.budgetMaxAmount != null ? Math.round(constraints.budgetMaxAmount * 100) : null;
  const includedNonOwned = purchasable.filter(c => selected.has(c.id) && !isOwned(c, analysis));
  const totalWeight = includedNonOwned.reduce((sum, c) => sum + ROLE_WEIGHT[c.role] * c.quantity, 0);
  const items: BuildPlanItem[] = purchasable.map(component => {
    const owned = isOwned(component, analysis);
    const included = selected.has(component.id) && !owned;
    const budgetAllocation: Price | null = totalMinor != null && included && totalWeight > 0
      ? { amountMinor: Math.floor((totalMinor * ROLE_WEIGHT[component.role] * component.quantity) / totalWeight), currency: "CAD" }
      : null;
    const features = integratedFeaturesOf(component, analysis);
    return {
      componentId: component.id, name: component.name, role: component.role, quantity: component.quantity,
      owned, included, budgetAllocation,
      intent: included ? buildProductIntentFromComponent(component, constraints, budgetAllocation, features) : null,
    };
  });
  const dependencies = analysis.dependencies.filter(dep => purchasableIds.has(dep.sourceComponentId) && purchasableIds.has(dep.targetComponentId));
  const warnings = ["Catalogue price and availability can change. Shipping and tax require a quote."];
  if (totalMinor != null && includedNonOwned.length === 0) warnings.push("No components are currently selected for purchase, so your budget was not allocated.");
  return { title: analysis.scene.title, budget: { maxAmount: constraints.budgetMaxAmount ?? null, currency: "CAD" }, country: "CA", items, dependencies, warnings };
}

export interface BuildComponentResult {
  componentId: string;
  products: import("./commerce").ProductCandidate[];
  /** The full mission for live results (so the existing checkout pipeline can review a
   * selection); always null for fixtures, which never reach checkout. */
  mission: import("./commerce").RequestMission | null;
  source: "agnic" | "fixture";
  error: string | null;
}

/** Structural check only, for merging a caller-echoed `priorResults` list (see
 * `buildSearchRequestSchema`). Never used to trust pricing or product data - a value that
 * fails this check is simply dropped, never surfaced as an error. */
export function isBuildComponentResultLike(value: unknown): value is BuildComponentResult {
  return Boolean(value) && typeof value === "object" && typeof (value as { componentId?: unknown }).componentId === "string";
}

export interface DependencyEvaluation { dependency: BuildDependency; status: "VERIFIED" | "NEEDS_VERIFICATION"; note: string }

const DIMENSION_PATTERN = /\d+(?:\.\d+)?\s*(?:mm|cm|in(?:ch(?:es)?)?|kg|lbs?|w|watts?|x\s*\d+(?:\.\d+)?)/gi;

/** Cross-component compatibility from real listing text only - the same "quote it or it's
 * unknown" rule Request Mode already applies. Absent evidence stays NEEDS_VERIFICATION;
 * nothing here is ever invented. */
export function evaluateBuildDependencies(dependencies: BuildDependency[], results: Record<string, BuildComponentResult>): DependencyEvaluation[] {
  return dependencies.map(dependency => {
    const source = results[dependency.sourceComponentId]?.products[0];
    const target = results[dependency.targetComponentId]?.products[0];
    if (!source || !target) return { dependency, status: "NEEDS_VERIFICATION", note: "At least one component has no selected product yet." };
    const sourceText = `${source.name} ${source.description ?? ""}`;
    const targetText = `${target.name} ${target.description ?? ""}`;
    const sourceTokens = new Set((sourceText.match(DIMENSION_PATTERN) ?? []).map(t => t.toLowerCase().replace(/\s+/g, "")));
    const targetTokens = (targetText.match(DIMENSION_PATTERN) ?? []).map(t => t.toLowerCase().replace(/\s+/g, ""));
    const shared = targetTokens.find(t => sourceTokens.has(t));
    return shared
      ? { dependency, status: "VERIFIED", note: `Both listings mention a matching measurement (${shared}).` }
      : { dependency, status: "NEEDS_VERIFICATION", note: "The listings do not share a confirmed measurement for this dependency." };
  });
}

export interface BuildTotal { subtotal: Price | null; missingComponentIds: string[]; overBudget: boolean }

/** The browse-time total from real selected product prices - never a final checkout total. */
export function calculateBuildTotal(plan: BuildPlan, results: Record<string, BuildComponentResult>): BuildTotal {
  const purchasable = plan.items.filter(item => item.included && !item.owned);
  let amountMinor = 0;
  const missingComponentIds: string[] = [];
  for (const item of purchasable) {
    const price = results[item.componentId]?.products[0]?.price;
    if (!price) { missingComponentIds.push(item.componentId); continue; }
    amountMinor += price.amountMinor * item.quantity;
  }
  // Only a complete subtotal is ever returned - a partial sum could be mistaken for the whole
  // build's cost while components are still searching or failed.
  const subtotal: Price | null = missingComponentIds.length === 0 ? { amountMinor, currency: "CAD" } : null;
  const budgetMinor = plan.budget.maxAmount != null ? Math.round(plan.budget.maxAmount * 100) : null;
  return { subtotal, missingComponentIds, overBudget: Boolean(subtotal && budgetMinor != null && subtotal.amountMinor > budgetMinor) };
}
