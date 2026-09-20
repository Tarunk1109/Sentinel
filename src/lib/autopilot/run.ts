import type { Price } from "@/lib/domain/commerce";
import type { AutopilotDecision } from "./decision";
import type { AutopilotIntent } from "./intent";
import type { AutopilotBudgetSummary } from "./ledger";
import type { AutopilotRunTrigger } from "./trigger";

/**
 * Minimal status set. There is deliberately no PURCHASED/ORDERED status: Autopilot never
 * places orders, and `purchaseExecuted` is the literal `false` on every run.
 */
export type AutopilotRunStatus =
  | "NO_ACTION"            // evaluated; nothing needed (e.g. all stock above minimum)
  | "ACTION_REQUIRED"      // needs user input to continue (e.g. stock counts)
  | "SEARCH_READY"         // intents generated; searches run only when explicitly requested
  | "COMMERCE_UNAVAILABLE" // intents generated, but commerce search is not configured
  | "AUTO_AUTHORIZED"      // the standing mandate permits the selected action; no money moved
  | "NEEDS_APPROVAL"       // outside the auto-authorization rules; a person must decide
  | "BLOCKED";             // the mandate forbids the selected action

/** Factual lifecycle events only - suitable for display, never hidden reasoning. */
export type AutopilotAuditEventType =
  | "POLICY_EVALUATED"
  | "TRIGGER_MATCHED"
  | "TRIGGER_NOT_MATCHED"
  | "INPUT_REQUIRED"
  | "INTENT_GENERATED"
  | "COMMERCE_SEARCH_READY"
  | "COMMERCE_UNAVAILABLE"
  | "COMMERCE_SEARCH_REQUESTED"
  | "COMMERCE_SEARCH_COMPLETED"
  | "CANDIDATE_SELECTED"
  | "BUDGET_CHECKED"
  | "DECISION_RECORDED";

export interface AutopilotAuditEvent {
  type: AutopilotAuditEventType;
  timestamp: string;
  message: string;
}

export interface AutopilotRunSearch {
  itemId: string;
  missionId: string;
  status: "ready" | "no-results";
  candidateCount: number;
  searchedAt: string;
}

export interface AutopilotRunSelection {
  itemId: string;
  missionId: string;
  productId: string;
  productName: string;
  merchantName: string;
  unitPrice: Price | null;
  quantity: number;
  lineTotalMinor: number | null;
}

export interface AutopilotRun {
  id: string;
  policyId: string;
  policyName: string;
  policyVersion: number;
  /** Inherited from the policy; DEMO runs must never be handed to checkout. */
  demo: boolean;
  trigger: AutopilotRunTrigger;
  triggerReason: string;
  /** The schedule slot this run served; null for manual runs. */
  scheduledFor: string | null;
  status: AutopilotRunStatus;
  intents: AutopilotIntent[];
  searches: AutopilotRunSearch[];
  selections: AutopilotRunSelection[];
  decision: AutopilotDecision | null;
  budget: AutopilotBudgetSummary;
  events: AutopilotAuditEvent[];
  purchaseExecuted: false;
  createdAt: string;
  updatedAt: string;
}

export const MAX_RUN_EVENTS = 60;

export function auditEvent(type: AutopilotAuditEventType, message: string, at: Date): AutopilotAuditEvent {
  return { type, timestamp: at.toISOString(), message };
}

/** Appends while keeping the log bounded (oldest events after the first are dropped). */
export function appendEvents(events: readonly AutopilotAuditEvent[], added: readonly AutopilotAuditEvent[]): AutopilotAuditEvent[] {
  const all = [...events, ...added];
  return all.length <= MAX_RUN_EVENTS ? all : [all[0], ...all.slice(all.length - (MAX_RUN_EVENTS - 1))];
}
