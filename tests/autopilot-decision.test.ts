import { describe, expect, it } from "vitest";
import { decideAutopilotAction, type ProposedLine } from "@/lib/autopilot/decision";
import { summarizeLedger, type AutopilotLedgerEntry } from "@/lib/autopilot/ledger";
import { autopilotPolicyInputSchema, normalizedMandate, type AutopilotPolicy, type AutopilotPolicyInput } from "@/lib/autopilot/policy";
import { MONDAY_9AM_TORONTO, policyInput } from "./autopilot-helpers";

const NOW = new Date(MONDAY_9AM_TORONTO);
function policy(overrides: Partial<AutopilotPolicyInput> = {}, status: AutopilotPolicy["status"] = "ACTIVE"): AutopilotPolicy {
  const mandate = normalizedMandate(autopilotPolicyInputSchema.parse(policyInput(overrides)));
  return { id: "p1", version: 1, status, ...mandate, schedule: { ...mandate.schedule, nextRunAt: null }, demo: false, fixtureId: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
}
function entry(amountMinor: number, recordedAt: string, kind: AutopilotLedgerEntry["kind"] = "AUTHORIZATION_HOLD"): AutopilotLedgerEntry {
  return { id: `e-${amountMinor}-${recordedAt}`, policyId: "p1", runId: null, kind, amountMinor, currency: "CAD", recordedAt };
}
const line = (overrides: Partial<ProposedLine> = {}): ProposedLine => ({ itemId: "cola", itemLabel: "Coca-Cola or cola", category: "BEVERAGES", unitPriceMinor: 3148, currency: "CAD", quantity: 1, ...overrides });
const decide = (lines: ProposedLine[], p = policy(), entries: AutopilotLedgerEntry[] = []) => decideAutopilotAction({ policy: p, lines, budget: summarizeLedger(entries, p, NOW), now: NOW });

describe("Autopilot budget ledger", () => {
  it("#10 computes weekly authority, committed amount and remaining authority in integer cents", () => {
    const summary = summarizeLedger([entry(2400, "2026-09-21T13:30:00.000Z")], policy(), new Date("2026-09-22T12:00:00Z"));
    expect(summary).toMatchObject({ currency: "CAD", weeklyAuthorityMinor: 7000, heldMinor: 2400, spentMinor: 0, committedMinor: 2400, remainingMinor: 4600, perRunCapMinor: 7000 });
    expect(summary.windowStart).toBe("2026-09-21T04:00:00.000Z");
  });

  it("#14 spend already committed this week reduces authority; last week's does not", () => {
    const p = policy();
    const entries = [
      entry(2000, "2026-09-21T14:00:00.000Z"),
      entry(400, "2026-09-23T14:00:00.000Z", "CONFIRMED_SPEND"),
      entry(6900, "2026-09-20T14:00:00.000Z"), // Sunday of the previous ISO week
    ];
    const summary = summarizeLedger(entries, p, new Date("2026-09-24T12:00:00Z"));
    expect(summary.committedMinor).toBe(2400);
    expect(summary.remainingMinor).toBe(4600);
    expect(summarizeLedger([entry(9000, "2026-09-21T14:00:00.000Z")], p, new Date("2026-09-22T12:00:00Z")).remainingMinor).toBe(0);
  });
});

describe("Autopilot decision engine", () => {
  it("#11 a purchase within the mandate is AUTO_AUTHORIZED with concise, auditable reasons", () => {
    const decision = decide([line()]);
    expect(decision).toEqual({
      decision: "AUTO_AUTHORIZED",
      reasons: ["The item is in a permitted category.", "C$31.48 is within the remaining C$70.00 weekly authority."],
      proposedTotalMinor: 3148,
      currency: "CAD",
      remainingBudgetBeforeMinor: 7000,
      remainingBudgetAfterMinor: 3852,
      decidedAt: NOW.toISOString(),
    });
  });

  it("#11/#12 the spec example: C$38 fits the remaining C$46; C$52 does not", () => {
    const committed = [entry(2400, "2026-09-21T13:00:00.000Z")];
    expect(decide([line({ unitPriceMinor: 3800 })], policy(), committed)).toMatchObject({ decision: "AUTO_AUTHORIZED", remainingBudgetBeforeMinor: 4600, remainingBudgetAfterMinor: 800 });
    const over = decide([line({ unitPriceMinor: 5200 })], policy(), committed);
    expect(over).toMatchObject({ decision: "NEEDS_APPROVAL", reasons: ["C$52.00 exceeds the remaining C$46.00 weekly authority."], remainingBudgetAfterMinor: 4600 });
    const blocking = policy({ authorization: { autoAuthorizeWithinMandate: true, overMandate: "BLOCK" } });
    expect(decide([line({ unitPriceMinor: 5200 })], blocking, committed).decision).toBe("BLOCKED");
  });

  it("#12 a run above the per-run cap needs approval even with weekly room left", () => {
    const capped = policy({ budget: { maximumPerWeekMinor: 7000, maximumPerRunMinor: 3000 } });
    const decision = decide([line({ unitPriceMinor: 3148 })], capped);
    expect(decision.decision).toBe("NEEDS_APPROVAL");
    expect(decision.reasons).toEqual(["C$31.48 exceeds the C$30.00 per-run limit."]);
  });

  it("#13 a disallowed category is BLOCKED regardless of price", () => {
    const decision = decide([line({ category: "PET_SUPPLIES", unitPriceMinor: 100 })]);
    expect(decision).toMatchObject({ decision: "BLOCKED", reasons: ["PET_SUPPLIES is not a category this autopilot may buy."], proposedTotalMinor: null, remainingBudgetAfterMinor: 7000 });
    expect(decide([line({ category: "SNACKS" })], policy({ allowedCategories: ["BEVERAGES", "SNACKS"] })).reasons).toEqual(["Coca-Cola or cola does not match its item's category."]);
  });

  it("blocks items outside the mandate, foreign currencies, invalid quantities and inactive policies", () => {
    expect(decide([line({ itemId: "laptop", itemLabel: "Laptop" })]).reasons).toEqual(["Laptop is not one of this autopilot's items."]);
    expect(decide([line({ currency: "USD" })]).reasons).toEqual(["Coca-Cola or cola is not priced in CAD."]);
    expect(decide([line({ quantity: 50 })]).decision).toBe("BLOCKED");
    expect(decide([line({ unitPriceMinor: -5 })]).decision).toBe("BLOCKED");
    expect(decide([line()], policy({}, "PAUSED")).reasons).toEqual(["This autopilot is paused."]);
    expect(decide([line()], policy({}, "DRAFT")).reasons).toEqual(["This autopilot is a draft and has not been activated."]);
    expect(decide([]).reasons).toEqual(["No products were proposed."]);
  });

  it("fails closed on unknown prices and honours approval rules", () => {
    expect(decide([line({ unitPriceMinor: null })])).toMatchObject({ decision: "NEEDS_APPROVAL", proposedTotalMinor: null });
    const manual = policy({ authorization: { autoAuthorizeWithinMandate: false } });
    expect(decide([line()], manual).reasons).toContain("This autopilot requires your approval for every purchase.");
    const threshold = policy({ authorization: { autoAuthorizeWithinMandate: true, requireApprovalAboveMinor: 2500 } });
    expect(decide([line()], threshold)).toMatchObject({ decision: "NEEDS_APPROVAL", reasons: ["C$31.48 is within the remaining C$70.00 weekly authority.", "C$31.48 is above the C$25.00 auto-approval threshold."] });
  });

  it("#15 totals multi-line proposals exactly in integer cents", () => {
    const decision = decide([line({ unitPriceMinor: 1049, quantity: 1 }), line({ itemId: "lemon-lime", itemLabel: "Sprite", unitPriceMinor: 1049, quantity: 1 }), line({ itemId: "orange", itemLabel: "Fanta", unitPriceMinor: 1049, quantity: 1 })]);
    expect(decision.proposedTotalMinor).toBe(3147);
    expect(Number.isInteger(decision.remainingBudgetAfterMinor)).toBe(true);
    expect(decision.reasons[0]).toBe("All items are in permitted categories.");
  });

  it("AUTO_AUTHORIZED carries no order, payment or dispatch fields - it is a mandate decision only", () => {
    expect(Object.keys(decide([line()])).sort()).toEqual(["currency", "decidedAt", "decision", "proposedTotalMinor", "reasons", "remainingBudgetAfterMinor", "remainingBudgetBeforeMinor"]);
  });
});
