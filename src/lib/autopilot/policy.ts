import { z } from "zod";
import { AUTOPILOT_CURRENCY, formatMinor } from "./money";
import { canonicalTimeZone, isValidTimeZone } from "./time";

/** Hard bounds on every user-controlled size. Policies are user input and untrusted. */
export const AUTOPILOT_LIMITS = Object.freeze({
  maxItems: 8,
  maxBrandsPerItem: 3,
  maxNameLength: 80,
  maxGoalLength: 300,
  maxLabelLength: 80,
  maxSearchQueryLength: 120,
  maxProductTypeLength: 80,
  maxBrandLength: 60,
  /** Matches ProductIntent.quantity's own ceiling. */
  maxQuantityPerItem: 10,
  /** C$2,000.00 per week. A restock mandate above this is rejected, not clamped. */
  maxWeeklyAuthorityMinor: 200_000,
  maxInventoryUnits: 10_000,
  maxPoliciesPerOwner: 20,
});

export const AUTOPILOT_STATUSES = ["DRAFT", "ACTIVE", "PAUSED"] as const;
export type AutopilotStatus = (typeof AUTOPILOT_STATUSES)[number];

export const AUTOPILOT_CATEGORIES = ["BEVERAGES", "SNACKS", "PANTRY", "CLEANING_SUPPLIES", "PAPER_GOODS", "OFFICE_SUPPLIES", "PERSONAL_CARE", "PET_SUPPLIES"] as const;
export const autopilotCategorySchema = z.enum(AUTOPILOT_CATEGORIES, { error: `Category must be one of: ${AUTOPILOT_CATEGORIES.join(", ")}.` });
export type AutopilotCategory = z.infer<typeof autopilotCategorySchema>;

export const CADENCES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type AutopilotCadence = (typeof CADENCES)[number];

function hasControlCharacters(value: string): boolean {
  for (const character of value) { const code = character.charCodeAt(0); if (code < 32 || code === 127) return true; }
  return false;
}
function text(max: number, label: string) {
  return z.string({ error: `${label} must be text.` }).trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine(value => !hasControlCharacters(value), `${label} contains unsupported characters.`);
}
function minorAmount(label: string) {
  return z.number({ error: `${label} must be a number of cents.` })
    .int(`${label} must be a whole number of cents.`)
    .positive(`${label} must be greater than zero.`)
    .max(AUTOPILOT_LIMITS.maxWeeklyAuthorityMinor, `${label} cannot exceed ${formatMinor(AUTOPILOT_LIMITS.maxWeeklyAuthorityMinor)}.`);
}

export const itemIdSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "Item ids use lowercase letters, numbers and dashes (40 characters max).");

export const autopilotItemSchema = z.object({
  id: itemIdSchema,
  label: text(AUTOPILOT_LIMITS.maxLabelLength, "Item label"),
  category: autopilotCategorySchema,
  searchQuery: text(AUTOPILOT_LIMITS.maxSearchQueryLength, "Search phrase").refine(value => value.length >= 2, "Search phrase must be at least 2 characters."),
  productType: text(AUTOPILOT_LIMITS.maxProductTypeLength, "Product type"),
  /** Brands rank candidates but never exclude alternatives: see `brandMatch`. */
  preferredBrands: z.array(text(AUTOPILOT_LIMITS.maxBrandLength, "Brand")).max(AUTOPILOT_LIMITS.maxBrandsPerItem, `Up to ${AUTOPILOT_LIMITS.maxBrandsPerItem} preferred brands per item.`).default([]),
  /** Explicit in the contract: brand names are preferences, not mandatory requirements. */
  brandMatch: z.literal("PREFERRED").default("PREFERRED"),
  quantity: z.number().int("Quantity must be a whole number.").min(1, "Quantity must be at least 1.").max(AUTOPILOT_LIMITS.maxQuantityPerItem, `Quantity cannot exceed ${AUTOPILOT_LIMITS.maxQuantityPerItem}.`).default(1),
}).strict();
export type AutopilotItem = z.infer<typeof autopilotItemSchema>;

export const autopilotBudgetSchema = z.object({
  maximumPerWeekMinor: minorAmount("Weekly maximum"),
  /** Defaults to the weekly maximum when omitted. */
  maximumPerRunMinor: minorAmount("Per-run maximum").optional(),
}).strict();

const timeZoneSchema = z.string({ error: "Timezone is required." })
  .refine(isValidTimeZone, "Unknown timezone. Use an IANA name such as America/Vancouver.")
  .transform(canonicalTimeZone);

export const autopilotScheduleSchema = z.object({
  cadence: z.enum(CADENCES, { error: "Cadence must be DAILY, WEEKLY or MONTHLY." }),
  timezone: timeZoneSchema,
  timeOfDay: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Time of day must be HH:MM in 24-hour time.").default("09:00"),
  /** ISO weekday, Monday = 1. Required for WEEKLY only. */
  dayOfWeek: z.number().int("Day of week must be 1 (Monday) to 7 (Sunday).").min(1, "Day of week must be 1 (Monday) to 7 (Sunday).").max(7, "Day of week must be 1 (Monday) to 7 (Sunday).").optional(),
  /** 1-28 only, so the date exists in every month. Required for MONTHLY only. */
  dayOfMonth: z.number().int("Day of month must be a whole number.").min(1, "Day of month must be 1 to 28.").max(28, "Day of month must be 1 to 28 so it exists in every month.").optional(),
}).strict();

export const inventoryThresholdSchema = z.object({
  itemId: itemIdSchema,
  minimumUnits: z.number().int("Minimum units must be a whole number.").min(1, "Minimum units must be at least 1.").max(AUTOPILOT_LIMITS.maxInventoryUnits, `Minimum units cannot exceed ${AUTOPILOT_LIMITS.maxInventoryUnits}.`),
}).strict();

export const autopilotTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SCHEDULED") }).strict(),
  /** Architecture + deterministic evaluation only: counts are supplied by the caller. */
  z.object({ type: z.literal("INVENTORY_BELOW"), thresholds: z.array(inventoryThresholdSchema).min(1, "Add at least one inventory threshold.").max(AUTOPILOT_LIMITS.maxItems, `Up to ${AUTOPILOT_LIMITS.maxItems} thresholds.`) }).strict(),
], { error: "Trigger type must be SCHEDULED or INVENTORY_BELOW." });
export type AutopilotTrigger = z.infer<typeof autopilotTriggerSchema>;

export const autopilotAuthorizationSchema = z.object({
  /** When true, actions inside every mandate limit are AUTO_AUTHORIZED - a mandate decision, never a payment. */
  autoAuthorizeWithinMandate: z.boolean({ error: "Say whether actions within the mandate may be auto-authorized." }),
  /** Any run total above this needs human approval even when inside the budget. */
  requireApprovalAboveMinor: minorAmount("Approval threshold").nullable().default(null),
  /** What happens when a proposal exceeds the per-run or weekly authority. */
  overMandate: z.enum(["REQUIRE_APPROVAL", "BLOCK"], { error: "overMandate must be REQUIRE_APPROVAL or BLOCK." }).default("REQUIRE_APPROVAL"),
}).strict();
export type AutopilotAuthorization = z.infer<typeof autopilotAuthorizationSchema>;

const policyFields = {
  name: text(AUTOPILOT_LIMITS.maxNameLength, "Name"),
  goal: text(AUTOPILOT_LIMITS.maxGoalLength, "Goal"),
  budget: autopilotBudgetSchema,
  schedule: autopilotScheduleSchema,
  trigger: autopilotTriggerSchema,
  allowedCategories: z.array(autopilotCategorySchema).min(1, "Allow at least one category.").max(AUTOPILOT_CATEGORIES.length),
  items: z.array(autopilotItemSchema).min(1, "Add at least one item to keep stocked.").max(AUTOPILOT_LIMITS.maxItems, `Up to ${AUTOPILOT_LIMITS.maxItems} items per autopilot.`),
  authorization: autopilotAuthorizationSchema,
};

type PolicyShape = {
  budget: z.infer<typeof autopilotBudgetSchema>;
  schedule: z.infer<typeof autopilotScheduleSchema>;
  trigger: AutopilotTrigger;
  allowedCategories: AutopilotCategory[];
  items: AutopilotItem[];
};

function checkPolicy(policy: PolicyShape, ctx: z.RefinementCtx): void {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
  const { budget, schedule, trigger, allowedCategories, items } = policy;
  if (budget.maximumPerRunMinor !== undefined && budget.maximumPerRunMinor > budget.maximumPerWeekMinor) issue("The per-run maximum cannot exceed the weekly maximum.", ["budget", "maximumPerRunMinor"]);
  if (schedule.cadence === "WEEKLY" && schedule.dayOfWeek === undefined) issue("Weekly schedules need dayOfWeek (1 = Monday ... 7 = Sunday).", ["schedule", "dayOfWeek"]);
  if (schedule.cadence !== "WEEKLY" && schedule.dayOfWeek !== undefined) issue("dayOfWeek applies to weekly schedules only.", ["schedule", "dayOfWeek"]);
  if (schedule.cadence === "MONTHLY" && schedule.dayOfMonth === undefined) issue("Monthly schedules need dayOfMonth (1-28).", ["schedule", "dayOfMonth"]);
  if (schedule.cadence !== "MONTHLY" && schedule.dayOfMonth !== undefined) issue("dayOfMonth applies to monthly schedules only.", ["schedule", "dayOfMonth"]);
  if (new Set(allowedCategories).size !== allowedCategories.length) issue("Allowed categories must not repeat.", ["allowedCategories"]);
  const ids = new Set<string>();
  items.forEach((item, index) => {
    if (ids.has(item.id)) issue(`Item id "${item.id}" is used more than once.`, ["items", index, "id"]);
    ids.add(item.id);
    if (!allowedCategories.includes(item.category)) issue(`${item.label} is in ${item.category}, which this autopilot does not allow.`, ["items", index, "category"]);
  });
  if (trigger.type === "INVENTORY_BELOW") {
    const seen = new Set<string>();
    trigger.thresholds.forEach((threshold, index) => {
      if (!ids.has(threshold.itemId)) issue(`Threshold refers to unknown item "${threshold.itemId}".`, ["trigger", "thresholds", index, "itemId"]);
      if (seen.has(threshold.itemId)) issue(`Item "${threshold.itemId}" has more than one threshold.`, ["trigger", "thresholds", index, "itemId"]);
      seen.add(threshold.itemId);
    });
  }
}

export const autopilotPolicyInputSchema = z.object({
  /** New policies are always drafts; activation is a separate, explicitly confirmed step. */
  status: z.literal("DRAFT", { error: "New autopilots are created as DRAFT. Activate one separately after review." }).optional(),
  ...policyFields,
  currency: z.literal(AUTOPILOT_CURRENCY, { error: "Autopilot supports CAD only in this phase." }),
  trigger: autopilotTriggerSchema.default({ type: "SCHEDULED" }),
}).strict().superRefine(checkPolicy);
export type AutopilotPolicyInput = z.input<typeof autopilotPolicyInputSchema>;
export type ParsedAutopilotPolicyInput = z.output<typeof autopilotPolicyInputSchema>;

/** Only these fields may change while a policy is ACTIVE; mandate fields need it paused or in draft. */
export const DESCRIPTIVE_FIELDS = ["name", "goal"] as const;
export const autopilotPolicyPatchSchema = z.object({
  name: policyFields.name.optional(),
  goal: policyFields.goal.optional(),
  budget: policyFields.budget.optional(),
  schedule: policyFields.schedule.optional(),
  trigger: policyFields.trigger.optional(),
  allowedCategories: policyFields.allowedCategories.optional(),
  items: policyFields.items.optional(),
  authorization: policyFields.authorization.optional(),
}).strict().refine(patch => Object.values(patch).some(value => value !== undefined), "Provide at least one field to update.");
export type AutopilotPolicyPatch = z.infer<typeof autopilotPolicyPatchSchema>;

export interface AutopilotSchedule {
  cadence: AutopilotCadence;
  timezone: string;
  timeOfDay: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  /** Server-managed. null unless the policy is ACTIVE. */
  nextRunAt: string | null;
}

export interface AutopilotPolicy {
  id: string;
  /** Increments on every user-driven change; runs created under an older version go stale. */
  version: number;
  status: AutopilotStatus;
  name: string;
  goal: string;
  currency: typeof AUTOPILOT_CURRENCY;
  budget: { maximumPerRunMinor: number; maximumPerWeekMinor: number };
  schedule: AutopilotSchedule;
  trigger: AutopilotTrigger;
  allowedCategories: AutopilotCategory[];
  items: AutopilotItem[];
  authorization: AutopilotAuthorization;
  /** true only for the DEV/TEST café fixture. Demo policies must never reach checkout. */
  demo: boolean;
  fixtureId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The user-defined mandate: everything except identity, lifecycle and server-managed fields. */
export type AutopilotMandate = Pick<AutopilotPolicy, "name" | "goal" | "currency" | "budget" | "trigger" | "allowedCategories" | "items" | "authorization"> & { schedule: Omit<AutopilotSchedule, "nextRunAt"> };

function scheduleFields(schedule: Omit<AutopilotSchedule, "nextRunAt">): Omit<AutopilotSchedule, "nextRunAt"> {
  const { cadence, timezone, timeOfDay, dayOfWeek, dayOfMonth } = schedule;
  return { cadence, timezone, timeOfDay, ...(dayOfWeek !== undefined ? { dayOfWeek } : {}), ...(dayOfMonth !== undefined ? { dayOfMonth } : {}) };
}

/** Fills defaults that depend on other fields (per-run cap) after schema validation. */
export function normalizedMandate(input: ParsedAutopilotPolicyInput): AutopilotMandate {
  return {
    name: input.name,
    goal: input.goal,
    currency: input.currency,
    budget: { maximumPerWeekMinor: input.budget.maximumPerWeekMinor, maximumPerRunMinor: input.budget.maximumPerRunMinor ?? input.budget.maximumPerWeekMinor },
    schedule: scheduleFields(input.schedule),
    trigger: input.trigger,
    allowedCategories: input.allowedCategories,
    items: input.items.map(item => ({ ...item, preferredBrands: [...new Set(item.preferredBrands)] })),
    authorization: input.authorization,
  };
}

/** The editable mandate of a stored policy, in input form, for re-validating a merged patch. */
export function policyToInput(policy: AutopilotPolicy): AutopilotPolicyInput {
  return { name: policy.name, goal: policy.goal, currency: policy.currency, budget: policy.budget, schedule: scheduleFields(policy.schedule), trigger: policy.trigger, allowedCategories: policy.allowedCategories, items: policy.items, authorization: policy.authorization };
}

export type StatusAction = "ACTIVATE" | "PAUSE" | "RESUME";
export const STATUS_TRANSITIONS: Readonly<Record<StatusAction, { from: AutopilotStatus; to: AutopilotStatus }>> = Object.freeze({
  ACTIVATE: { from: "DRAFT", to: "ACTIVE" },
  PAUSE: { from: "ACTIVE", to: "PAUSED" },
  RESUME: { from: "PAUSED", to: "ACTIVE" },
});
