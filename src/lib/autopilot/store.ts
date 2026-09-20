import "server-only";
import type { AutopilotLedgerEntry } from "./ledger";
import type { AutopilotPolicy } from "./policy";
import type { AutopilotRun } from "./run";

/** Storage contracts. Every method is owner-scoped; one owner can never read another's data. */
export interface AutopilotPolicyRepository {
  createPolicy(owner: string, policy: AutopilotPolicy): Promise<AutopilotPolicy>;
  getPolicy(owner: string, id: string): Promise<AutopilotPolicy | null>;
  listPolicies(owner: string): Promise<AutopilotPolicy[]>;
  updatePolicy(owner: string, policy: AutopilotPolicy): Promise<AutopilotPolicy>;
}
export interface AutopilotRunRepository {
  saveRun(owner: string, run: AutopilotRun): Promise<AutopilotRun>;
  getRun(owner: string, policyId: string, runId: string): Promise<AutopilotRun | null>;
  listRuns(owner: string, policyId: string): Promise<AutopilotRun[]>;
  /** Atomic claim of one schedule slot for one run. false if the slot was already claimed. */
  claimSlot(owner: string, policyId: string, slot: string, runId: string): Promise<boolean>;
  runIdForSlot(owner: string, policyId: string, slot: string): Promise<string | null>;
}
export interface AutopilotLedgerRepository {
  listLedger(owner: string, policyId: string): Promise<AutopilotLedgerEntry[]>;
  /** Replaces (or with null, removes) the single authorization hold owned by `runId`. */
  setRunHold(owner: string, policyId: string, runId: string, entry: AutopilotLedgerEntry | null): Promise<void>;
}
export interface AutopilotTransactions {
  /**
   * Runs `task` exclusively for one policy, so budget checks and holds are atomic. A durable
   * store must implement this as a real transaction or row lock, not an in-process lock.
   */
  withPolicyLock<T>(owner: string, policyId: string, task: () => Promise<T>): Promise<T>;
}
export type AutopilotStore = AutopilotPolicyRepository & AutopilotRunRepository & AutopilotLedgerRepository & AutopilotTransactions;

export class AutopilotStoreFullError extends Error {
  constructor() { super("Autopilot demo storage is full."); this.name = "AutopilotStoreFullError"; }
}

const MAX_TOTAL_POLICIES = 500;
const MAX_RUNS_PER_POLICY = 20;
const LEDGER_RETENTION_MS = 35 * 24 * 60 * 60 * 1000;
const SLOT_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * DEMO/RUNTIME STORAGE ONLY: process memory, bounded, lost on server restart, and not shared
 * between server instances. It exists so the engine is exercisable without adding a
 * database; any durable store can implement the same interfaces.
 */
export class InMemoryAutopilotStore implements AutopilotStore {
  private policies = new Map<string, AutopilotPolicy>();
  private runs = new Map<string, AutopilotRun[]>();
  private ledger = new Map<string, AutopilotLedgerEntry[]>();
  private slots = new Map<string, { runId: string; slot: number }[]>();
  private lockTails = new Map<string, Promise<void>>();
  constructor(private readonly clock: () => Date = () => new Date()) {}

  private key(owner: string, id: string): string { return `${owner}:${id}`; }

  async withPolicyLock<T>(owner: string, policyId: string, task: () => Promise<T>): Promise<T> {
    const key = this.key(owner, policyId);
    const previous = this.lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = previous.then(() => new Promise<void>(resolve => { release = resolve; }));
    this.lockTails.set(key, tail);
    await previous;
    try { return await task(); } finally { release(); if (this.lockTails.get(key) === tail) this.lockTails.delete(key); }
  }

  async createPolicy(owner: string, policy: AutopilotPolicy): Promise<AutopilotPolicy> {
    if (this.policies.size >= MAX_TOTAL_POLICIES) throw new AutopilotStoreFullError();
    this.policies.set(this.key(owner, policy.id), structuredClone(policy));
    return structuredClone(policy);
  }
  async getPolicy(owner: string, id: string): Promise<AutopilotPolicy | null> {
    const policy = this.policies.get(this.key(owner, id));
    return policy ? structuredClone(policy) : null;
  }
  async listPolicies(owner: string): Promise<AutopilotPolicy[]> {
    const prefix = `${owner}:`;
    return [...this.policies.entries()].filter(([key]) => key.startsWith(prefix)).map(([, policy]) => structuredClone(policy)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async updatePolicy(owner: string, policy: AutopilotPolicy): Promise<AutopilotPolicy> {
    const key = this.key(owner, policy.id);
    if (!this.policies.has(key)) throw new Error("Cannot update a policy that does not exist.");
    this.policies.set(key, structuredClone(policy));
    return structuredClone(policy);
  }

  async saveRun(owner: string, run: AutopilotRun): Promise<AutopilotRun> {
    const key = this.key(owner, run.policyId);
    const list = (this.runs.get(key) ?? []).filter(existing => existing.id !== run.id);
    list.unshift(structuredClone(run));
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    this.runs.set(key, list.slice(0, MAX_RUNS_PER_POLICY));
    return structuredClone(run);
  }
  async getRun(owner: string, policyId: string, runId: string): Promise<AutopilotRun | null> {
    const run = this.runs.get(this.key(owner, policyId))?.find(existing => existing.id === runId);
    return run ? structuredClone(run) : null;
  }
  async listRuns(owner: string, policyId: string): Promise<AutopilotRun[]> {
    return structuredClone(this.runs.get(this.key(owner, policyId)) ?? []);
  }
  // No `await` between the check and the set: a concurrent caller cannot interleave here.
  async claimSlot(owner: string, policyId: string, slot: string, runId: string): Promise<boolean> {
    const key = this.key(owner, policyId);
    const slotTime = Date.parse(slot);
    const cutoff = this.clock().getTime() - SLOT_RETENTION_MS;
    const claims = (this.slots.get(key) ?? []).filter(claim => claim.slot >= cutoff);
    if (claims.some(claim => claim.slot === slotTime)) { this.slots.set(key, claims); return false; }
    claims.push({ runId, slot: slotTime });
    this.slots.set(key, claims);
    return true;
  }
  async runIdForSlot(owner: string, policyId: string, slot: string): Promise<string | null> {
    const slotTime = Date.parse(slot);
    return this.slots.get(this.key(owner, policyId))?.find(claim => claim.slot === slotTime)?.runId ?? null;
  }

  async listLedger(owner: string, policyId: string): Promise<AutopilotLedgerEntry[]> {
    return structuredClone(this.ledger.get(this.key(owner, policyId)) ?? []);
  }
  async setRunHold(owner: string, policyId: string, runId: string, entry: AutopilotLedgerEntry | null): Promise<void> {
    const key = this.key(owner, policyId);
    const cutoff = this.clock().getTime() - LEDGER_RETENTION_MS;
    const kept = (this.ledger.get(key) ?? []).filter(existing => !(existing.runId === runId && existing.kind === "AUTHORIZATION_HOLD") && Date.parse(existing.recordedAt) >= cutoff);
    if (entry) kept.push(structuredClone(entry));
    this.ledger.set(key, kept);
  }
}
