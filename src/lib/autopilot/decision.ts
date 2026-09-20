import type { AutopilotBudgetSummary } from "./ledger";
import { AUTOPILOT_CURRENCY, formatMinor, multiplyMinor, sumMinor } from "./money";
import { AUTOPILOT_LIMITS, type AutopilotPolicy } from "./policy";

/**
 * AUTO_AUTHORIZED means only: "the user's standing mandate permits this action."
 * It never means money was spent; this module has no path to checkout or dispatch.
 */
export type AutopilotDecisionKind = "AUTO_AUTHORIZED" | "NEEDS_APPROVAL" | "BLOCKED";

/** One proposed purchase line. Prices come from server-side search results, never the client. */
export interface ProposedLine {
  itemId: string;
  itemLabel: string;
  category: string;
  unitPriceMinor: number | null;
  currency: string;
  quantity: number;
}

export interface AutopilotDecision {
  decision: AutopilotDecisionKind;
  /** Concise, factual, user-facing reasons. Never model reasoning. */
  reasons: string[];
  proposedTotalMinor: number | null;
  currency: typeof AUTOPILOT_CURRENCY;
  remainingBudgetBeforeMinor: number;
  remainingBudgetAfterMinor: number;
  decidedAt: string;
}

export interface DecisionInput {
  policy: AutopilotPolicy;
  lines: readonly ProposedLine[];
  budget: AutopilotBudgetSummary;
  now: Date;
}

/** Pure and deterministic. Rules apply in order: hard blocks, unknown prices, mandate limits, approval rules. */
export function decideAutopilotAction({ policy, lines, budget, now }: DecisionInput): AutopilotDecision {
  const remaining = budget.remainingMinor;
  const result = (decision: AutopilotDecisionKind, reasons: string[], total: number | null): AutopilotDecision => ({
    decision, reasons, proposedTotalMinor: total, currency: AUTOPILOT_CURRENCY,
    remainingBudgetBeforeMinor: remaining,
    remainingBudgetAfterMinor: decision === "AUTO_AUTHORIZED" && total !== null ? remaining - total : remaining,
    decidedAt: now.toISOString(),
  });

  if (policy.status !== "ACTIVE") return result("BLOCKED", [policy.status === "PAUSED" ? "This autopilot is paused." : "This autopilot is a draft and has not been activated."], null);
  if (lines.length === 0) return result("BLOCKED", ["No products were proposed."], null);

  const items = new Map(policy.items.map(item => [item.id, item]));
  const blocks: string[] = [];
  for (const line of lines) {
    const item = items.get(line.itemId);
    if (!item) { blocks.push(`${line.itemLabel} is not one of this autopilot's items.`); continue; }
    if (!(policy.allowedCategories as readonly string[]).includes(line.category)) blocks.push(`${line.category} is not a category this autopilot may buy.`);
    else if (line.category !== item.category) blocks.push(`${line.itemLabel} does not match its item's category.`);
    if (line.currency !== policy.currency) blocks.push(`${line.itemLabel} is not priced in ${policy.currency}.`);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > AUTOPILOT_LIMITS.maxQuantityPerItem) blocks.push(`${line.itemLabel} has an invalid quantity.`);
    if (line.unitPriceMinor !== null && (!Number.isSafeInteger(line.unitPriceMinor) || line.unitPriceMinor < 0)) blocks.push(`${line.itemLabel} has an invalid price.`);
  }
  if (blocks.length) return result("BLOCKED", [...new Set(blocks)], null);

  const unpriced = lines.filter(line => line.unitPriceMinor === null);
  if (unpriced.length) return result("NEEDS_APPROVAL", unpriced.map(line => `${line.itemLabel} has no listed price, so it can't be checked against the mandate.`), null);

  const total = sumMinor(lines.map(line => multiplyMinor(line.unitPriceMinor as number, line.quantity)));
  const categoryReason = lines.length === 1 ? "The item is in a permitted category." : "All items are in permitted categories.";
  const overRun = total > budget.perRunCapMinor;
  const overWeek = total > remaining;
  if (overRun || overWeek) {
    const reasons: string[] = [];
    if (overRun) reasons.push(`${formatMinor(total)} exceeds the ${formatMinor(budget.perRunCapMinor)} per-run limit.`);
    if (overWeek) reasons.push(`${formatMinor(total)} exceeds the remaining ${formatMinor(remaining)} weekly authority.`);
    return result(policy.authorization.overMandate === "BLOCK" ? "BLOCKED" : "NEEDS_APPROVAL", reasons, total);
  }

  const withinBudget = `${formatMinor(total)} is within the remaining ${formatMinor(remaining)} weekly authority.`;
  if (!policy.authorization.autoAuthorizeWithinMandate) return result("NEEDS_APPROVAL", [withinBudget, "This autopilot requires your approval for every purchase."], total);
  const threshold = policy.authorization.requireApprovalAboveMinor;
  if (threshold !== null && total > threshold) return result("NEEDS_APPROVAL", [withinBudget, `${formatMinor(total)} is above the ${formatMinor(threshold)} auto-approval threshold.`], total);
  return result("AUTO_AUTHORIZED", [categoryReason, withinBudget], total);
}
