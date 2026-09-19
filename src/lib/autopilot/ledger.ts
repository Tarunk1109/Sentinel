import type { AutopilotPolicy } from "./policy";
import { AUTOPILOT_CURRENCY, sumMinor } from "./money";
import { isoWeekWindow } from "./time";

/**
 * AUTHORIZATION_HOLD: weekly authority committed by an AUTO_AUTHORIZED decision. No money
 * moved - it only stops repeated authorizations from exceeding the weekly mandate.
 * CONFIRMED_SPEND: reserved for a future checkout integration that has a real, confirmed
 * order. Nothing in this phase writes it.
 */
export type LedgerEntryKind = "AUTHORIZATION_HOLD" | "CONFIRMED_SPEND";

export interface AutopilotLedgerEntry {
  id: string;
  policyId: string;
  runId: string | null;
  kind: LedgerEntryKind;
  amountMinor: number;
  currency: typeof AUTOPILOT_CURRENCY;
  recordedAt: string;
}

export interface AutopilotBudgetSummary {
  currency: typeof AUTOPILOT_CURRENCY;
  /** ISO week (Monday 00:00 local) in the policy's timezone. */
  windowStart: string;
  windowEnd: string;
  weeklyAuthorityMinor: number;
  perRunCapMinor: number;
  heldMinor: number;
  spentMinor: number;
  committedMinor: number;
  remainingMinor: number;
}

export function summarizeLedger(entries: readonly AutopilotLedgerEntry[], policy: Pick<AutopilotPolicy, "budget" | "schedule">, now: Date): AutopilotBudgetSummary {
  const window = isoWeekWindow(now, policy.schedule.timezone);
  const inWindow = entries.filter(entry => {
    const at = Date.parse(entry.recordedAt);
    return entry.currency === AUTOPILOT_CURRENCY && at >= window.start.getTime() && at < window.end.getTime();
  });
  const heldMinor = sumMinor(inWindow.filter(entry => entry.kind === "AUTHORIZATION_HOLD").map(entry => entry.amountMinor));
  const spentMinor = sumMinor(inWindow.filter(entry => entry.kind === "CONFIRMED_SPEND").map(entry => entry.amountMinor));
  const committedMinor = heldMinor + spentMinor;
  const weeklyAuthorityMinor = policy.budget.maximumPerWeekMinor;
  return {
    currency: AUTOPILOT_CURRENCY,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    weeklyAuthorityMinor,
    perRunCapMinor: policy.budget.maximumPerRunMinor,
    heldMinor,
    spentMinor,
    committedMinor,
    remainingMinor: Math.max(0, weeklyAuthorityMinor - committedMinor),
  };
}
