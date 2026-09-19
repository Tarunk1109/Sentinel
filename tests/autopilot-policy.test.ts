import { describe, expect, it } from "vitest";
import { formatMinor, minorToMajor, multiplyMinor, sumMinor } from "@/lib/autopilot/money";
import { AUTOPILOT_LIMITS, autopilotPolicyInputSchema, autopilotPolicyPatchSchema, normalizedMandate, type AutopilotPolicyInput } from "@/lib/autopilot/policy";
import { policyInput } from "./autopilot-helpers";

function firstIssue(input: unknown): string | null {
  const parsed = autopilotPolicyInputSchema.safeParse(input);
  return parsed.success ? null : parsed.error.issues[0]?.message ?? "invalid";
}
const withBudget = (budget: AutopilotPolicyInput["budget"]) => policyInput({ budget });
const item = (index: number) => ({ id: `item-${index}`, label: `Item ${index}`, category: "BEVERAGES" as const, searchQuery: `drink ${index}`, productType: "soft drink" });

describe("Autopilot policy validation", () => {
  it("#1 creates a valid weekly CAD policy with integer-cent budgets", () => {
    const parsed = autopilotPolicyInputSchema.parse(policyInput());
    const mandate = normalizedMandate(parsed);
    expect(mandate.currency).toBe("CAD");
    expect(mandate.schedule).toEqual({ cadence: "WEEKLY", dayOfWeek: 1, timeOfDay: "09:00", timezone: "America/Toronto" });
    expect(mandate.budget).toEqual({ maximumPerWeekMinor: 7000, maximumPerRunMinor: 7000 });
    expect(mandate.items.map(entry => entry.id)).toEqual(["cola", "lemon-lime", "orange"]);
  });

  it("#2 rejects a zero budget", () => {
    expect(firstIssue(withBudget({ maximumPerWeekMinor: 0 }))).toBe("Weekly maximum must be greater than zero.");
  });

  it("#3 rejects a negative budget, including a negative per-run cap", () => {
    expect(firstIssue(withBudget({ maximumPerWeekMinor: -7000 }))).toBe("Weekly maximum must be greater than zero.");
    expect(firstIssue(withBudget({ maximumPerWeekMinor: 7000, maximumPerRunMinor: -1 }))).toBe("Per-run maximum must be greater than zero.");
  });

  it("#4 rejects budgets beyond the policy limit instead of clamping them", () => {
    expect(firstIssue(withBudget({ maximumPerWeekMinor: AUTOPILOT_LIMITS.maxWeeklyAuthorityMinor + 1 }))).toBe("Weekly maximum cannot exceed C$2,000.00.");
    expect(firstIssue(withBudget({ maximumPerWeekMinor: Number.MAX_SAFE_INTEGER }))).toBe("Weekly maximum cannot exceed C$2,000.00.");
    expect(firstIssue(withBudget({ maximumPerWeekMinor: 5000, maximumPerRunMinor: 6000 }))).toBe("The per-run maximum cannot exceed the weekly maximum.");
  });

  it("#5 rejects an empty or meaningless policy", () => {
    expect(firstIssue({})).not.toBeNull();
    expect(firstIssue(policyInput({ items: [] }))).toBe("Add at least one item to keep stocked.");
    expect(firstIssue(policyInput({ goal: "   " }))).toBe("Goal is required.");
    expect(firstIssue(policyInput({ allowedCategories: [] }))).toBe("Allow at least one category.");
  });

  it("#15 money is integer minor units: fractional cents are rejected and arithmetic is exact", () => {
    expect(firstIssue(withBudget({ maximumPerWeekMinor: 70.5 }))).toBe("Weekly maximum must be a whole number of cents.");
    expect(firstIssue(withBudget({ maximumPerWeekMinor: "7000" as unknown as number }))).toBe("Weekly maximum must be a number of cents.");
    expect(multiplyMinor(1049, 3)).toBe(3147);
    expect(sumMinor([1049, 999, 1100])).toBe(3148);
    expect(formatMinor(3148)).toBe("C$31.48");
    expect(formatMinor(7000)).toBe("C$70.00");
    expect(formatMinor(123456789)).toBe("C$1,234,567.89");
    expect(minorToMajor(3149)).toBe(31.49);
    expect(() => formatMinor(31.48)).toThrow(RangeError);
    expect(() => sumMinor([0.1, 0.2])).toThrow(RangeError);
  });

  it("rejects unsupported currencies", () => {
    expect(firstIssue({ ...policyInput(), currency: "USD" })).toBe("Autopilot supports CAD only in this phase.");
  });

  it("rejects malformed schedules and impossible dates", () => {
    const schedule = (value: object) => firstIssue(policyInput({ schedule: value as AutopilotPolicyInput["schedule"] }));
    expect(schedule({ cadence: "WEEKLY", timezone: "America/Toronto" })).toBe("Weekly schedules need dayOfWeek (1 = Monday ... 7 = Sunday).");
    expect(schedule({ cadence: "MONTHLY", dayOfMonth: 31, timezone: "America/Toronto" })).toBe("Day of month must be 1 to 28 so it exists in every month.");
    expect(schedule({ cadence: "MONTHLY", timezone: "America/Toronto" })).toBe("Monthly schedules need dayOfMonth (1-28).");
    expect(schedule({ cadence: "DAILY", dayOfWeek: 2, timezone: "America/Toronto" })).toBe("dayOfWeek applies to weekly schedules only.");
    expect(schedule({ cadence: "WEEKLY", dayOfWeek: 8, timezone: "America/Toronto" })).toBe("Day of week must be 1 (Monday) to 7 (Sunday).");
    expect(schedule({ cadence: "WEEKLY", dayOfWeek: 1, timeOfDay: "25:00", timezone: "America/Toronto" })).toBe("Time of day must be HH:MM in 24-hour time.");
    expect(schedule({ cadence: "WEEKLY", dayOfWeek: 1, timezone: "Mars/Olympus_Mons" })).toBe("Unknown timezone. Use an IANA name such as America/Vancouver.");
    expect(schedule({ cadence: "WEEKLY", dayOfWeek: 1, timezone: "../../etc/passwd" })).toBe("Unknown timezone. Use an IANA name such as America/Vancouver.");
    expect(schedule({ cadence: "HOURLY", timezone: "America/Toronto" })).toBe("Cadence must be DAILY, WEEKLY or MONTHLY.");
  });

  it("canonicalizes the timezone spelling", () => {
    const parsed = autopilotPolicyInputSchema.parse(policyInput({ schedule: { cadence: "DAILY", timezone: "america/vancouver" } }));
    expect(parsed.schedule.timezone).toBe("America/Vancouver");
    expect(parsed.schedule.timeOfDay).toBe("09:00");
  });

  it("bounds user-controlled arrays and strings", () => {
    expect(firstIssue(policyInput({ items: Array.from({ length: 9 }, (_, index) => item(index)) }))).toBe("Up to 8 items per autopilot.");
    expect(firstIssue(policyInput({ name: "x".repeat(81) }))).toBe("Name must be 80 characters or fewer.");
    expect(firstIssue(policyInput({ goal: "g".repeat(301) }))).toBe("Goal must be 300 characters or fewer.");
    expect(firstIssue(policyInput({ name: "Drinks\u0000Restock" }))).toBe("Name contains unsupported characters.");
    expect(firstIssue(policyInput({ items: [{ ...item(1), preferredBrands: ["a", "b", "c", "d"] }] }))).toBe("Up to 3 preferred brands per item.");
    expect(firstIssue(policyInput({ items: [{ ...item(1), quantity: 11 }] }))).toBe("Quantity cannot exceed 10.");
    expect(firstIssue(policyInput({ items: [{ ...item(1), id: "Bad Id!" }] }))).toBe("Item ids use lowercase letters, numbers and dashes (40 characters max).");
  });

  it("rejects items outside allowed categories and duplicate item ids", () => {
    expect(firstIssue(policyInput({ items: [{ ...item(1), category: "SNACKS" }] }))).toBe("Item 1 is in SNACKS, which this autopilot does not allow.");
    expect(firstIssue(policyInput({ items: [item(1), item(1)] }))).toBe("Item id \"item-1\" is used more than once.");
    expect(firstIssue(policyInput({ allowedCategories: ["BEVERAGES", "BEVERAGES"] }))).toBe("Allowed categories must not repeat.");
    expect(firstIssue(policyInput({ allowedCategories: ["WEAPONS" as never] }))).toContain("Category must be one of");
  });

  it("only ever creates DRAFT policies and rejects unknown fields", () => {
    expect(firstIssue({ ...policyInput(), status: "ACTIVE" })).toBe("New autopilots are created as DRAFT. Activate one separately after review.");
    expect(autopilotPolicyInputSchema.safeParse({ ...policyInput(), status: "DRAFT" }).success).toBe(true);
    expect(firstIssue({ ...policyInput(), dispatch: true })).toContain("Unrecognized key");
    expect(firstIssue({ ...policyInput(), realPurchasesEnabled: true })).toContain("Unrecognized key");
  });

  it("treats brand names as preferences, never requirements, in the type model", () => {
    const parsed = autopilotPolicyInputSchema.parse(policyInput());
    expect(parsed.items.every(entry => entry.brandMatch === "PREFERRED")).toBe(true);
    expect(firstIssue(policyInput({ items: [{ ...item(1), brandMatch: "REQUIRED" as never }] }))).not.toBeNull();
  });

  it("validates inventory thresholds against the policy's own items", () => {
    expect(firstIssue(policyInput({ trigger: { type: "INVENTORY_BELOW", thresholds: [{ itemId: "cola", minimumUnits: 12 }] } }))).toBeNull();
    expect(firstIssue(policyInput({ trigger: { type: "INVENTORY_BELOW", thresholds: [{ itemId: "ghost", minimumUnits: 12 }] } }))).toBe("Threshold refers to unknown item \"ghost\".");
    expect(firstIssue(policyInput({ trigger: { type: "INVENTORY_BELOW", thresholds: [{ itemId: "cola", minimumUnits: 0 }] } }))).toBe("Minimum units must be at least 1.");
  });

  it("patches must be non-empty and cannot touch status or server-managed fields", () => {
    expect(autopilotPolicyPatchSchema.safeParse({}).success).toBe(false);
    expect(autopilotPolicyPatchSchema.safeParse({ name: "Renamed" }).success).toBe(true);
    expect(autopilotPolicyPatchSchema.safeParse({ status: "ACTIVE" }).success).toBe(false);
    expect(autopilotPolicyPatchSchema.safeParse({ schedule: { cadence: "WEEKLY", dayOfWeek: 1, timezone: "UTC", nextRunAt: "2020-01-01T00:00:00Z" } }).success).toBe(false);
  });
});
