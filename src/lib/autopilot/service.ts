import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { ProductCandidate, ProductIntent, RequestMission } from "@/lib/domain/commerce";
import { ProviderError } from "@/lib/server/provider-error";
import { decideAutopilotAction, type AutopilotDecision, type ProposedLine } from "./decision";
import { autopilotDemoAllowed, cafeDemoPolicyInput, CAFE_DEMO_FIXTURE_ID } from "./demo";
import { buildAutopilotIntents, type AutopilotIntent } from "./intent";
import { summarizeLedger, type AutopilotBudgetSummary, type AutopilotLedgerEntry } from "./ledger";
import { AUTOPILOT_CURRENCY, formatMinor, multiplyMinor } from "./money";
import { AUTOPILOT_LIMITS, autopilotPolicyInputSchema, autopilotPolicyPatchSchema, DESCRIPTIVE_FIELDS, normalizedMandate, policyToInput, STATUS_TRANSITIONS, type AutopilotMandate, type AutopilotPolicy, type StatusAction } from "./policy";
import { authorizeRequestSchema, evaluateRequestSchema, searchRequestSchema } from "./requests";
import { appendEvents, auditEvent, type AutopilotAuditEvent, type AutopilotRun, type AutopilotRunSelection, type AutopilotRunStatus } from "./run";
import { calculateNextRunAt, isPolicyDue, nextRunAfterScheduledRun } from "./schedule";
import { AutopilotStoreFullError, type AutopilotStore } from "./store";
import { evaluateTrigger, type AutopilotRunTrigger, type InventoryObservation } from "./trigger";

/**
 * The existing SENTINEL commerce engine, narrowed to what Autopilot may use: search and
 * reading back a search result. There is intentionally no checkout, quote or dispatch here.
 */
export interface AutopilotCommerce {
  isAvailable(): boolean;
  search(intent: ProductIntent, owner: string, signal: AbortSignal): Promise<RequestMission>;
  getSelection(owner: string, missionId: string, productId: string): { product: ProductCandidate; intent: ProductIntent };
}

export interface AutopilotPolicyView { policy: AutopilotPolicy; due: boolean; budget: AutopilotBudgetSummary }

const SEARCHABLE = new Set<AutopilotRunStatus>(["SEARCH_READY", "AUTO_AUTHORIZED", "NEEDS_APPROVAL", "BLOCKED"]);
const TRANSITION_ERROR: Record<StatusAction, string> = {
  ACTIVATE: "Only a draft autopilot can be activated. Resume a paused one instead.",
  PAUSE: "Only an active autopilot can be paused.",
  RESUME: "Only a paused autopilot can be resumed. Activate a draft instead.",
};

function parse<S extends z.ZodType>(schema: S, value: unknown, fallback: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ProviderError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? fallback, 400);
  return parsed.data;
}

/** Key-order-independent JSON, so an intent that round-tripped through search compares equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => inner && typeof inner === "object" && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : inner);
}

export class AutopilotService {
  constructor(
    private readonly store: AutopilotStore,
    private readonly commerce: AutopilotCommerce,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  async list(owner: string): Promise<AutopilotPolicyView[]> {
    const now = this.clock();
    return Promise.all((await this.store.listPolicies(owner)).map(policy => this.view(owner, policy, now)));
  }

  async get(owner: string, id: string): Promise<AutopilotPolicyView> {
    return this.view(owner, await this.requirePolicy(owner, id));
  }

  /** Always creates a DRAFT. Nothing runs until the user explicitly activates it. */
  async create(owner: string, input: unknown): Promise<AutopilotPolicyView> {
    const mandate = this.parseMandate(input);
    return this.insert(owner, mandate, { status: "DRAFT", demo: false, fixtureId: null, dueNow: false });
  }

  async update(owner: string, id: string, input: unknown): Promise<AutopilotPolicyView> {
    const patch = parse(autopilotPolicyPatchSchema, input, "Provide valid autopilot changes.");
    return this.store.withPolicyLock(owner, id, async () => {
      const policy = await this.requirePolicy(owner, id);
      const changed = Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => key);
      if (policy.status === "ACTIVE" && changed.some(key => !(DESCRIPTIVE_FIELDS as readonly string[]).includes(key))) {
        throw new ProviderError("AUTOPILOT_POLICY_ACTIVE", "Pause this autopilot before changing its budget, items, schedule, trigger or authorization.", 409);
      }
      const merged = { ...policyToInput(policy), ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) };
      const mandate = this.parseMandate(merged);
      const now = this.clock();
      const next: AutopilotPolicy = { ...policy, ...mandate, schedule: { ...mandate.schedule, nextRunAt: policy.schedule.nextRunAt }, version: policy.version + 1, updatedAt: now.toISOString() };
      return this.view(owner, await this.store.updatePolicy(owner, next), now);
    });
  }

  activate(owner: string, id: string): Promise<AutopilotPolicyView> { return this.changeStatus(owner, id, "ACTIVATE"); }
  pause(owner: string, id: string): Promise<AutopilotPolicyView> { return this.changeStatus(owner, id, "PAUSE"); }
  resume(owner: string, id: string): Promise<AutopilotPolicyView> { return this.changeStatus(owner, id, "RESUME"); }

  /** Manual "run now": evaluates the trigger and generates intents. Never searches or buys. */
  async evaluate(owner: string, id: string, input: unknown = {}): Promise<AutopilotRun> {
    const { inventory } = parse(evaluateRequestSchema, input, "Provide valid inventory counts.");
    const policy = await this.requirePolicy(owner, id);
    this.assertActive(policy);
    return this.createRun(owner, policy, "MANUAL", null, inventory, this.newId(), this.clock());
  }

  /**
   * Evaluates every due ACTIVE policy for this owner once per schedule slot. This is the
   * single entry point a future hosted scheduler would call; nothing calls it automatically.
   */
  async runDue(owner: string): Promise<AutopilotRun[]> {
    const now = this.clock();
    const due = (await this.store.listPolicies(owner)).filter(policy => isPolicyDue(policy, now));
    const runs: AutopilotRun[] = [];
    for (const policy of due) {
      const run = await this.runScheduled(owner, policy, now);
      if (run) runs.push(run);
    }
    return runs;
  }

  /** Runs the EXISTING commerce search for one item of a run. Only on explicit request. */
  async search(owner: string, id: string, input: unknown, signal: AbortSignal): Promise<{ run: AutopilotRun; mission: RequestMission }> {
    const { runId, itemId } = parse(searchRequestSchema, input, "Provide a run id and item id.");
    const policy = await this.requirePolicy(owner, id);
    this.assertActive(policy);
    const run = await this.requireRun(owner, policy, runId);
    const planned = run.intents.find(intent => intent.itemId === itemId);
    if (!planned) throw new ProviderError("AUTOPILOT_SELECTION_INVALID", "That item is not part of this run.", 400);
    if (!SEARCHABLE.has(run.status)) throw new ProviderError("AUTOPILOT_RUN_NOT_SEARCHABLE", "This run has no product searches to perform.", 409);
    if (!this.commerce.isAvailable()) throw new ProviderError("COMMERCE_UNAVAILABLE", "Commerce search is unavailable because the Agnic integration is not configured. Nothing was searched or purchased.", 503);
    const requestedAt = this.clock();
    const mission = await this.commerce.search(planned.intent, owner, signal);
    return this.store.withPolicyLock(owner, id, async () => {
      const latest = await this.requireRun(owner, await this.requirePolicy(owner, id), runId);
      const doneAt = this.clock();
      const found = mission.products.length;
      const saved = await this.store.saveRun(owner, {
        ...latest,
        searches: [...latest.searches.filter(search => search.itemId !== itemId), { itemId, missionId: mission.id, status: mission.status, candidateCount: found, searchedAt: doneAt.toISOString() }],
        events: appendEvents(latest.events, [
          auditEvent("COMMERCE_SEARCH_REQUESTED", `Searched the commerce catalogue for ${planned.itemLabel}.`, requestedAt),
          auditEvent("COMMERCE_SEARCH_COMPLETED", found ? `${found} candidate${found === 1 ? "" : "s"} found for ${planned.itemLabel}.` : `No candidates within ${formatMinor(policy.budget.maximumPerRunMinor)} were found for ${planned.itemLabel}.`, doneAt),
        ]),
        updatedAt: doneAt.toISOString(),
      });
      return { run: saved, mission };
    });
  }

  /**
   * Checks selected search results against the mandate. Prices are read from the server's own
   * search results, and each selection must come from this run's own intent for that item.
   * An AUTO_AUTHORIZED result holds weekly authority; it places no order and moves no money.
   */
  async authorize(owner: string, id: string, input: unknown): Promise<AutopilotRun> {
    const { runId, selections } = parse(authorizeRequestSchema, input, "Provide a run id and product selections.");
    return this.store.withPolicyLock(owner, id, async () => {
      const policy = await this.requirePolicy(owner, id);
      const run = await this.requireRun(owner, policy, runId);
      if (!SEARCHABLE.has(run.status)) throw new ProviderError("AUTOPILOT_RUN_NOT_SEARCHABLE", "This run has no product searches to authorize.", 409);
      const seen = new Set<string>();
      const lines: ProposedLine[] = [];
      const chosen: AutopilotRunSelection[] = [];
      for (const selection of selections) {
        if (seen.has(selection.itemId)) throw new ProviderError("AUTOPILOT_SELECTION_INVALID", "Select at most one product per item.", 400);
        seen.add(selection.itemId);
        const planned = run.intents.find(intent => intent.itemId === selection.itemId);
        if (!planned) throw new ProviderError("AUTOPILOT_SELECTION_INVALID", "A selected item is not part of this run.", 400);
        const found = this.commerce.getSelection(owner, selection.missionId, selection.productId);
        if (canonical(found.intent) !== canonical(planned.intent)) {
          throw new ProviderError("AUTOPILOT_SELECTION_MISMATCH", `That product did not come from this run's search for ${planned.itemLabel}. Search again from this run.`, 409);
        }
        const price = found.product.price;
        const quantity = planned.intent.quantity;
        const validPrice = price !== null && Number.isSafeInteger(price.amountMinor) && price.amountMinor >= 0;
        lines.push({ itemId: planned.itemId, itemLabel: planned.itemLabel, category: planned.category, unitPriceMinor: price?.amountMinor ?? null, currency: price?.currency ?? policy.currency, quantity });
        chosen.push({ itemId: planned.itemId, missionId: selection.missionId, productId: selection.productId, productName: found.product.name, merchantName: found.product.merchantName, unitPrice: price, quantity, lineTotalMinor: validPrice ? multiplyMinor(price.amountMinor, quantity) : null });
      }
      const now = this.clock();
      // Re-authorizing a run replaces its own earlier hold rather than stacking another.
      const others = (await this.store.listLedger(owner, policy.id)).filter(entry => entry.runId !== run.id);
      const decision = decideAutopilotAction({ policy, lines, budget: summarizeLedger(others, policy, now), now });
      await this.store.setRunHold(owner, policy.id, run.id, this.holdFor(policy, run, decision, now));
      const budget = summarizeLedger(await this.store.listLedger(owner, policy.id), policy, now);
      const events: AutopilotAuditEvent[] = chosen.map(line => auditEvent("CANDIDATE_SELECTED", `Selected "${line.productName}" from ${line.merchantName} for ${run.intents.find(intent => intent.itemId === line.itemId)?.itemLabel ?? line.itemId}: ${line.lineTotalMinor === null ? "price unknown" : formatMinor(line.lineTotalMinor)}.`, now));
      events.push(auditEvent("BUDGET_CHECKED", decision.proposedTotalMinor === null
        ? `Weekly authority remaining: ${formatMinor(decision.remainingBudgetBeforeMinor)}. The proposal could not be totalled.`
        : `${formatMinor(decision.proposedTotalMinor)} proposed against ${formatMinor(decision.remainingBudgetBeforeMinor)} remaining weekly authority and a ${formatMinor(policy.budget.maximumPerRunMinor)} per-run limit.`, now));
      events.push(auditEvent("DECISION_RECORDED", this.decisionMessage(decision), now));
      return this.store.saveRun(owner, { ...run, selections: chosen, decision, status: decision.decision, budget, events: appendEvents(run.events, events), updatedAt: now.toISOString() });
    });
  }

  async runs(owner: string, id: string): Promise<AutopilotRun[]> {
    await this.requirePolicy(owner, id);
    return this.store.listRuns(owner, id);
  }

  /** DEV/TEST ONLY. Seeds the clearly-labelled café DEMO policy as ACTIVE and due now. */
  async seedDemo(owner: string, timezone: string): Promise<AutopilotPolicyView> {
    if (!autopilotDemoAllowed()) throw new ProviderError("AUTOPILOT_DEMO_DISABLED", "The café demo autopilot is only available in development or test environments.", 503);
    const existing = (await this.store.listPolicies(owner)).find(policy => policy.fixtureId === CAFE_DEMO_FIXTURE_ID);
    if (existing) return this.view(owner, existing);
    return this.insert(owner, this.parseMandate(cafeDemoPolicyInput(timezone)), { status: "ACTIVE", demo: true, fixtureId: CAFE_DEMO_FIXTURE_ID, dueNow: true });
  }

  private async insert(owner: string, mandate: AutopilotMandate, meta: Pick<AutopilotPolicy, "status" | "demo" | "fixtureId"> & { dueNow: boolean }): Promise<AutopilotPolicyView> {
    if ((await this.store.listPolicies(owner)).length >= AUTOPILOT_LIMITS.maxPoliciesPerOwner) {
      throw new ProviderError("AUTOPILOT_POLICY_LIMIT", `You can keep up to ${AUTOPILOT_LIMITS.maxPoliciesPerOwner} autopilots.`, 409);
    }
    const now = this.clock();
    const { dueNow, ...lifecycle } = meta;
    const policy: AutopilotPolicy = {
      id: this.newId(), version: 1, ...lifecycle, ...mandate,
      schedule: { ...mandate.schedule, nextRunAt: dueNow ? now.toISOString() : null },
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    try { return this.view(owner, await this.store.createPolicy(owner, policy), now); }
    catch (error) {
      if (error instanceof AutopilotStoreFullError) throw new ProviderError("AUTOPILOT_STORAGE_FULL", "Autopilot demo storage is full. Restart the server to clear it.", 503);
      throw error;
    }
  }

  private async changeStatus(owner: string, id: string, action: StatusAction): Promise<AutopilotPolicyView> {
    return this.store.withPolicyLock(owner, id, async () => {
      const policy = await this.requirePolicy(owner, id);
      const transition = STATUS_TRANSITIONS[action];
      if (policy.status === transition.to) return this.view(owner, policy);
      if (policy.status !== transition.from) throw new ProviderError("AUTOPILOT_INVALID_TRANSITION", TRANSITION_ERROR[action], 409);
      const now = this.clock();
      // Resuming never back-fills missed slots: scheduling restarts from now.
      const nextRunAt = transition.to === "ACTIVE" ? calculateNextRunAt(policy.schedule, now).toISOString() : null;
      return this.view(owner, await this.store.updatePolicy(owner, { ...policy, status: transition.to, version: policy.version + 1, schedule: { ...policy.schedule, nextRunAt }, updatedAt: now.toISOString() }), now);
    });
  }

  private async runScheduled(owner: string, policy: AutopilotPolicy, now: Date): Promise<AutopilotRun | null> {
    const slot = policy.schedule.nextRunAt;
    if (slot === null) return null;
    const runId = this.newId();
    if (!(await this.store.claimSlot(owner, policy.id, slot, runId))) {
      // Another evaluation already owns this slot: return its run, never a duplicate.
      const existingId = await this.store.runIdForSlot(owner, policy.id, slot);
      return existingId ? this.store.getRun(owner, policy.id, existingId) : null;
    }
    const run = await this.createRun(owner, policy, "SCHEDULE", slot, undefined, runId, now);
    await this.store.withPolicyLock(owner, policy.id, async () => {
      const latest = await this.store.getPolicy(owner, policy.id);
      if (!latest || latest.status !== "ACTIVE" || latest.schedule.nextRunAt !== slot) return;
      // Advancing the slot is bookkeeping, not a user edit, so the version (and this run) stay current.
      await this.store.updatePolicy(owner, { ...latest, schedule: { ...latest.schedule, nextRunAt: nextRunAfterScheduledRun(latest.schedule, new Date(slot), now).toISOString() } });
    });
    return run;
  }

  private async createRun(owner: string, policy: AutopilotPolicy, trigger: AutopilotRunTrigger, slot: string | null, inventory: InventoryObservation | undefined, runId: string, now: Date): Promise<AutopilotRun> {
    const events: AutopilotAuditEvent[] = [auditEvent("POLICY_EVALUATED", `${policy.name} was evaluated.`, now)];
    const outcome = evaluateTrigger(policy, trigger, inventory);
    let status: AutopilotRunStatus;
    let intents: AutopilotIntent[] = [];
    if (outcome.outcome === "NEEDS_INPUT") {
      status = "ACTION_REQUIRED";
      events.push(auditEvent("INPUT_REQUIRED", outcome.reason, now));
    } else if (outcome.outcome === "NOT_MATCHED") {
      status = "NO_ACTION";
      events.push(auditEvent("TRIGGER_NOT_MATCHED", outcome.reason, now));
    } else {
      events.push(auditEvent("TRIGGER_MATCHED", outcome.reason, now));
      intents = buildAutopilotIntents(policy, outcome.itemIds);
      for (const intent of intents) events.push(auditEvent("INTENT_GENERATED", `Search intent for ${intent.itemLabel}: "${intent.intent.searchQuery}", up to ${formatMinor(policy.budget.maximumPerRunMinor)}.`, now));
      if (this.commerce.isAvailable()) {
        status = "SEARCH_READY";
        events.push(auditEvent("COMMERCE_SEARCH_READY", `${intents.length} product search${intents.length === 1 ? " is" : "es are"} ready. Nothing is searched until requested.`, now));
      } else {
        status = "COMMERCE_UNAVAILABLE";
        events.push(auditEvent("COMMERCE_UNAVAILABLE", "Commerce search is unavailable because the Agnic integration is not configured. Nothing was searched or purchased.", now));
      }
    }
    const budget = summarizeLedger(await this.store.listLedger(owner, policy.id), policy, now);
    return this.store.saveRun(owner, {
      id: runId, policyId: policy.id, policyName: policy.name, policyVersion: policy.version, demo: policy.demo,
      trigger, triggerReason: outcome.reason, scheduledFor: slot, status, intents, searches: [], selections: [], decision: null,
      budget, events, purchaseExecuted: false, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
  }

  private holdFor(policy: AutopilotPolicy, run: AutopilotRun, decision: AutopilotDecision, now: Date): AutopilotLedgerEntry | null {
    if (decision.decision !== "AUTO_AUTHORIZED" || decision.proposedTotalMinor === null || decision.proposedTotalMinor <= 0) return null;
    return { id: this.newId(), policyId: policy.id, runId: run.id, kind: "AUTHORIZATION_HOLD", amountMinor: decision.proposedTotalMinor, currency: AUTOPILOT_CURRENCY, recordedAt: now.toISOString() };
  }

  private decisionMessage(decision: AutopilotDecision): string {
    if (decision.decision === "AUTO_AUTHORIZED") return "Auto-authorized by the standing mandate. No purchase was placed; checkout remains a separate, explicit step.";
    if (decision.decision === "NEEDS_APPROVAL") return `Approval required: ${decision.reasons[decision.reasons.length - 1]}`;
    return `Blocked: ${decision.reasons[0]}`;
  }

  private async view(owner: string, policy: AutopilotPolicy, now: Date = this.clock()): Promise<AutopilotPolicyView> {
    return { policy, due: isPolicyDue(policy, now), budget: summarizeLedger(await this.store.listLedger(owner, policy.id), policy, now) };
  }

  private parseMandate(input: unknown): AutopilotMandate {
    return normalizedMandate(parse(autopilotPolicyInputSchema, input, "Provide a valid autopilot."));
  }

  private async requirePolicy(owner: string, id: string): Promise<AutopilotPolicy> {
    const policy = await this.store.getPolicy(owner, id);
    if (!policy) throw new ProviderError("AUTOPILOT_POLICY_NOT_FOUND", "That autopilot doesn't exist.", 404);
    return policy;
  }

  private async requireRun(owner: string, policy: AutopilotPolicy, runId: string): Promise<AutopilotRun> {
    const run = await this.store.getRun(owner, policy.id, runId);
    if (!run) throw new ProviderError("AUTOPILOT_RUN_NOT_FOUND", "That autopilot run doesn't exist or has expired.", 404);
    if (run.policyVersion !== policy.version) throw new ProviderError("AUTOPILOT_RUN_STALE", "This autopilot changed after the run started. Run it again.", 409);
    return run;
  }

  private assertActive(policy: AutopilotPolicy): void {
    if (policy.status !== "ACTIVE") {
      throw new ProviderError("AUTOPILOT_POLICY_NOT_ACTIVE", policy.status === "PAUSED" ? "This autopilot is paused. Resume it before running it." : "This autopilot is a draft. Activate it before running it.", 409);
    }
  }

}
