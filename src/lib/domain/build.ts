import { z } from "zod";
import { productIntentSchema, type CompatibilityStatus, type Country, type Currency, type Price, type ProductCandidate, type ProductIntent, type RequestMission } from "./commerce";

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
  /** A planning target from splitting the user's total build budget by weighted role -
   * not a hard per-component cap. Search results are never filtered down to this amount
   * (see `buildProductIntentFromComponent`); it only steers which candidate `selectBuildPick`
   * prefers and whether it gets flagged `aboveTarget`. The only hard constraint is the
   * total browse cost against the user's overall budget (see `calculateBuildTotal`). */
  targetAllocation: Price | null;
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

/**
 * Reuses the exact existing Agnic search architecture: a component becomes a ProductIntent,
 * nothing more. Unknown compatibility facts are carried forward as caveats, never invented.
 * `integratedFeatures` (see `integratedFeaturesOf`) are folded in as part of what this
 * component must have, never as anything searched or budgeted on their own.
 *
 * `intent.budget.maxAmount` is the user's overall stated build budget, not this
 * component's own weighted target allocation (`BuildPlanItem.targetAllocation`). The
 * target is a planning number for ranking/display, not a search-time hard filter - passing
 * it here would let `filterCandidates` (request-mission.ts) silently discard every real
 * product priced even slightly above an internal planning split, which is exactly what
 * produced zero results for a real component search. The one hard constraint that
 * remains is the overall budget, enforced by `calculateBuildTotal`.
 */
export function buildProductIntentFromComponent(component: BuildComponent, constraints: BuildConstraints, integratedFeatures: BuildComponent[] = []): ProductIntent {
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
    budget: { maxAmount: constraints.budgetMaxAmount ?? null, currency: "CAD" },
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
    const targetAllocation: Price | null = totalMinor != null && included && totalWeight > 0
      ? { amountMinor: Math.floor((totalMinor * ROLE_WEIGHT[component.role] * component.quantity) / totalWeight), currency: "CAD" }
      : null;
    const features = integratedFeaturesOf(component, analysis);
    return {
      componentId: component.id, name: component.name, role: component.role, quantity: component.quantity,
      owned, included, targetAllocation,
      intent: included ? buildProductIntentFromComponent(component, constraints, features) : null,
    };
  });
  const dependencies = analysis.dependencies.filter(dep => purchasableIds.has(dep.sourceComponentId) && purchasableIds.has(dep.targetComponentId));
  const warnings = ["Catalogue price and availability can change. Shipping and tax require a quote."];
  if (totalMinor != null && includedNonOwned.length === 0) warnings.push("No components are currently selected for purchase, so your budget was not allocated.");
  return { title: analysis.scene.title, budget: { maxAmount: constraints.budgetMaxAmount ?? null, currency: "CAD" }, country: "CA", items, dependencies, warnings };
}

export interface BuildComponentResult {
  componentId: string;
  products: ProductCandidate[];
  /** The full mission for live results (so the existing checkout pipeline can review a
   * selection); always null for fixtures, which never reach checkout. */
  mission: RequestMission | null;
  source: "agnic" | "fixture";
  error: string | null;
  /** Set only when the primary search returned zero results and exactly one deterministic
   * (non-AI) broader search was then attempted (see `broadenSearchQuery`) - the query that
   * was actually tried. Optional/absent on any result predating this field, and never set
   * for a fixture-sourced result (there is no second fixture dataset to fall back to).
   * Always shown honestly in the UI, whether or not the broadened search itself found
   * anything - see PHASE5_REPORT.md. */
  broadenedTo?: string | null;
}

const SEARCH_STYLE_MODIFIERS = new Set([
  // colors
  "black", "white", "grey", "gray", "silver", "gold", "brown", "blue", "navy", "red", "green", "pink", "beige", "tan",
  // materials/finishes
  "wood", "wooden", "metal", "metallic", "glass", "leather", "fabric", "plastic", "mesh", "steel", "aluminum", "walnut", "oak", "natural",
  // aesthetic descriptors
  "minimal", "minimalist", "modern", "vintage", "rustic", "sleek", "premium", "luxury", "stylish", "elegant", "classic", "contemporary",
  // scale descriptors - dropped for breadth, not because size never matters: a broader
  // category search still returns a workable range of sizes to choose from
  "compact", "large", "small", "mini", "slim", "portable", "oversized", "standard",
  // connectivity/feature descriptors that don't change the fundamental product category
  "wireless", "wired", "bluetooth", "rgb", "backlit", "adjustable", "foldable", "stackable",
]);

/**
 * Deterministic, non-AI query broadening for a zero-result Build component search (see
 * `BuildService.runSearch`). Strips known low-priority visual/style words from the search
 * phrase, keeping every other word - including whatever forms the core product category,
 * which this can therefore never remove or change (it only ever deletes words it
 * recognizes as style/material/aesthetic modifiers, never invents or reorders anything).
 * Returns null when there is nothing to strip (already at the core category, or no
 * recognized modifier present), so the caller knows not to attempt a second search.
 */
export function broadenSearchQuery(query: string): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return null;
  const stripped = words.filter(word => !SEARCH_STYLE_MODIFIERS.has(word.toLowerCase()));
  if (stripped.length === 0 || stripped.length === words.length) return null;
  return stripped.join(" ");
}

export interface BuildPick {
  product: ProductCandidate | null;
  label: "SENTINEL_PICK" | "TOP_MATCH" | "NONE";
  /** Set only when the picked product's price exceeds `target`. Never hides the product -
   * see requirement 2B: an above-target candidate is shown, never silently relabelled. */
  aboveTarget: Price | null;
}

const COMPATIBILITY_TIER: Record<CompatibilityStatus, number> = { VERIFIED: 3, LIKELY_COMPATIBLE: 2, NEEDS_VERIFICATION: 1, INCOMPATIBLE: 0 };

/**
 * Chooses which of a component's already-ranked candidates (from the shared, untouched
 * Request Mode pipeline - `rankCandidates` in request-mission.ts) to present as the
 * recommendation, and how confidently.
 *
 * `target` is a planning allocation, not a hard cap (`BuildPlanItem.targetAllocation`): if
 * the top-ranked candidate exceeds it, a same-compatibility-tier candidate that IS within
 * target is preferred instead; otherwise the top-ranked candidate is kept and flagged
 * `aboveTarget` rather than silently swapped for a worse-verified but cheaper option.
 *
 * SENTINEL_PICK requires the chosen candidate to be genuinely defensible: within target
 * (or no target set) AND backed by at least LIKELY_COMPATIBLE evidence - never just "the
 * first result by default". This is intentionally unconditional, not skipped when the
 * component "has no real compatibility requirements": `ProductIntent.compatibilityRequirements`
 * (which a caller might otherwise consult to decide whether evidence was even "needed") also
 * carries every photo-derived `unknowns` caveat via `buildProductIntentFromComponent`, and
 * some of those (like a room's available space) can never be resolved by any product
 * listing - a component-type-based exemption would leave those permanently stuck unable to
 * ever earn SENTINEL_PICK for the wrong reason. NEEDS_VERIFICATION/INCOMPATIBLE always fall
 * back to TOP_MATCH.
 */
export function selectBuildPick(products: ProductCandidate[], target: Price | null): BuildPick {
  if (products.length === 0) return { product: null, label: "NONE", aboveTarget: null };
  const top = products[0];
  const topExceedsTarget = Boolean(target && top.price && top.price.amountMinor > target.amountMinor);
  const withinTarget = topExceedsTarget && target ? products.find(p => !p.price || p.price.amountMinor <= target.amountMinor) : undefined;
  const chosen = withinTarget && COMPATIBILITY_TIER[withinTarget.compatibility.status] === COMPATIBILITY_TIER[top.compatibility.status] ? withinTarget : top;
  const aboveTarget: Price | null = target && chosen.price && chosen.price.amountMinor > target.amountMinor
    ? { amountMinor: chosen.price.amountMinor - target.amountMinor, currency: target.currency }
    : null;
  const hasStrongEvidence = chosen.compatibility.status === "VERIFIED" || chosen.compatibility.status === "LIKELY_COMPATIBLE";
  const defensible = !aboveTarget && hasStrongEvidence;
  return { product: chosen, label: defensible ? "SENTINEL_PICK" : "TOP_MATCH", aboveTarget };
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

export interface BuildTotal { subtotal: Price | null; missingComponentIds: string[]; overBudget: boolean; overBy: Price | null }

/**
 * The browse-time total from real selected product prices - never a final checkout total.
 * Sums whatever `selectBuildPick` would actually recommend per component (so the total
 * always matches what the UI shows as picked), not blindly the top-ranked product -
 * underspend on one component (e.g. a keyboard well under its target) can offset overspend
 * on another (e.g. a monitor over its target); only the total against the user's overall
 * budget is a hard constraint (`overBudget`/`overBy`), never each component individually.
 */
export function calculateBuildTotal(plan: BuildPlan, results: Record<string, BuildComponentResult>): BuildTotal {
  const purchasable = plan.items.filter(item => item.included && !item.owned);
  let amountMinor = 0;
  const missingComponentIds: string[] = [];
  for (const item of purchasable) {
    const products = results[item.componentId]?.products ?? [];
    const price = selectBuildPick(products, item.targetAllocation).product?.price;
    if (!price) { missingComponentIds.push(item.componentId); continue; }
    amountMinor += price.amountMinor * item.quantity;
  }
  // Only a complete subtotal is ever returned - a partial sum could be mistaken for the whole
  // build's cost while components are still searching or failed.
  const subtotal: Price | null = missingComponentIds.length === 0 ? { amountMinor, currency: "CAD" } : null;
  const budgetMinor = plan.budget.maxAmount != null ? Math.round(plan.budget.maxAmount * 100) : null;
  const overBudget = Boolean(subtotal && budgetMinor != null && subtotal.amountMinor > budgetMinor);
  const overBy: Price | null = overBudget ? { amountMinor: subtotal!.amountMinor - budgetMinor!, currency: "CAD" } : null;
  return { subtotal, missingComponentIds, overBudget, overBy };
}
