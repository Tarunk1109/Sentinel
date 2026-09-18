import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { ActivityStep, CandidateEvaluation, MissionEvent, ProductCandidate, ProductIntent, RequestMission, SafePreview, StepId, UsageCounts } from "@/lib/domain/commerce";
import { ProviderError } from "../provider-error";
import type { CommerceProvider, ProductReasoner } from "./live-contracts";

export function initialSteps(): ActivityStep[] {
  return ([['understand', 'Understand intent'], ['discover', 'Discover products'], ['filter', 'Check budget'], ['verify', 'Verify compatibility'], ['compare', 'Compare candidates'], ['select', 'Select a product'], ['prepare', 'Prepare merchant'], ['preview', 'Check final price'], ['consent', 'Your explicit consent'], ['purchase', 'Real purchase locked'], ['proof', 'Order proof']] as [StepId, string][]).map(([id, label]) => ({ id, label, status: id === 'purchase' || id === 'proof' ? 'blocked' : 'pending', detail: id === 'purchase' || id === 'proof' ? 'Real purchasing is disabled. Verified sandbox checkout has a separate consent flow.' : 'Waiting for the preceding step.' }));
}
export function filterCandidates(products: ProductCandidate[], intent: ProductIntent): ProductCandidate[] {
  const seen = new Set<string>();
  return products.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return p.availability !== 'unavailable' && p.country === intent.country && (!p.price || p.price.currency === intent.budget.currency) && (intent.budget.maxAmount === null || (p.price !== null && p.price.amountMinor * intent.quantity <= Math.floor(Number((intent.budget.maxAmount * 100).toFixed(8)))));
  });
}
export function hasCompatibilityEvidence(products: ProductCandidate[]): boolean {
  return products.some(p => Boolean(p.description?.trim()) || Object.keys(p.metadata).some(k => !['priceSource', 'availabilitySource', 'variant_title', 'vendor', 'title', 'sku', 'product_gid'].includes(k)));
}
export function applyEvaluations(products: ProductCandidate[], result: CandidateEvaluation): ProductCandidate[] {
  return products.map(p => {
    const matches = result.candidates.filter(c => c.candidateId === p.id);
    if (matches.length !== 1) return p;
    const item = matches[0];
    const sources = [p.name, p.description ?? '', ...Object.values(p.metadata)];
    const reasons = item.reasons.filter(r => r.evidenceQuote.trim().length >= 3 && sources.some(s => s.includes(r.evidenceQuote)));
    if (reasons.length === 0 || reasons.length !== item.reasons.length) return p;
    // Exact source snippets constrain attribution. Full device verification is reserved
    // until a future phase collects device-specific facts and authoritative specs.
    const status = !hasCompatibilityEvidence([p]) && item.status !== 'INCOMPATIBLE' ? 'NEEDS_VERIFICATION' : item.status === 'VERIFIED' ? 'LIKELY_COMPATIBLE' : item.status;
    return { ...p, compatibility: { status, reasons, missingInformation: item.missingInformation }, requiredConstraintsSatisfied: item.requiredConstraintsSatisfied, score: item.score, recommendation: reasons.map(r => r.claim).join(' ') };
  });
}
export function rankCandidates(products: ProductCandidate[]): ProductCandidate[] {
  const compatibility = { VERIFIED: 3, LIKELY_COMPATIBLE: 2, NEEDS_VERIFICATION: 1, INCOMPATIBLE: 0 };
  return products.filter(p => p.compatibility.status !== 'INCOMPATIBLE' && p.requiredConstraintsSatisfied !== false).sort((a, b) => Number(b.requiredConstraintsSatisfied === true) - Number(a.requiredConstraintsSatisfied === true) || compatibility[b.compatibility.status] - compatibility[a.compatibility.status] || b.score - a.score || Number(b.availability === 'available') - Number(a.availability === 'available') || (a.price?.amountMinor ?? Infinity) - (b.price?.amountMinor ?? Infinity)).slice(0, 5);
}
const TTL = 15 * 60_000;
type Emit = (event: MissionEvent) => void;
type Job = { promise: Promise<RequestMission>; events: MissionEvent[]; listeners: Set<Emit>; owner: string };
export class RequestMissionService {
  private completed = new Map<string, { owner: string; mission: RequestMission }>();
  private active = new Map<string, Job>();
  private quotes = new Map<string, { expires: number; preview: SafePreview }>();
  private quoteJobs = new Map<string, Promise<SafePreview>>();
  constructor(private readonly reasoner: ProductReasoner, private readonly commerce: CommerceProvider) {}
  private async submit(key: string, owner: string, signal: AbortSignal, emit: Emit, runner: (publish: Emit) => Promise<RequestMission>): Promise<RequestMission> {
    signal.throwIfAborted();
    for (const [k, entry] of this.completed) if (Date.parse(entry.mission.expiresAt) <= Date.now()) this.completed.delete(k);
    const cached = this.completed.get(key);
    if (cached) return structuredClone({ ...cached.mission, cacheHit: true, usage: { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 } });
    const existing = this.active.get(key);
    if (existing) {
      existing.events.forEach(emit); existing.listeners.add(emit);
      try { return structuredClone({ ...await existing.promise, cacheHit: true, usage: { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 } }); }
      finally { existing.listeners.delete(emit); }
    }
    if (this.active.size >= 2 || [...this.active.values()].some(j => j.owner === owner)) throw new ProviderError('MISSION_BUSY', 'A mission is already running. Wait for it to finish before submitting another.', 429);
    const listeners = new Set([emit]);
    const events: MissionEvent[] = [];
    const publish: Emit = event => { events.push(event); listeners.forEach(listener => listener(event)); };
    const promise = Promise.resolve().then(() => runner(publish)).then(mission => {
      if (this.completed.size >= 40) this.completed.delete(this.completed.keys().next().value!);
      this.completed.set(key, { owner, mission: structuredClone(mission) }); return mission;
    }).finally(() => this.active.delete(key));
    this.active.set(key, { promise, events, listeners, owner });
    return promise;
  }
  async run(prompt: string, owner: string, signal: AbortSignal, emit: Emit = () => {}): Promise<RequestMission> {
    const key = createHash('sha256').update(`${owner}:${prompt.trim().replace(/\s+/g, ' ').toLowerCase()}`).digest('hex');
    return this.submit(key, owner, signal, emit, publish => this.execute(prompt, signal, publish));
  }
  /** Skips the understand step: the intent already came from an inspection image analysis, not raw text. */
  async runFromIntent(intent: ProductIntent, owner: string, signal: AbortSignal, emit: Emit = () => {}): Promise<RequestMission> {
    const key = createHash('sha256').update(`${owner}:inspect:${JSON.stringify(intent)}`).digest('hex');
    return this.submit(key, owner, signal, emit, publish => this.executeFromIntent(intent, signal, publish));
  }
  private stepSetter(steps: ActivityStep[], emit: Emit) {
    return (id: StepId, status: ActivityStep['status'], detail: string) => {
      const index = steps.findIndex(s => s.id === id); steps[index] = { ...steps[index], status, detail }; emit({ type: 'step', step: steps[index] });
    };
  }
  private async execute(prompt: string, signal: AbortSignal, emit: Emit): Promise<RequestMission> {
    const steps = initialSteps();
    steps.forEach(step => emit({ type: 'step', step }));
    const step = this.stepSetter(steps, emit);
    const usage: UsageCounts = { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 };
    const context = { signal, usage };
    step('understand', 'active', 'Extracting your request with the economical intent model.');
    const intent = await this.reasoner.understand(prompt, context);
    emit({ type: 'intent', intent });
    step('understand', 'complete', `${intent.productType} · ${intent.country} · ${intent.budget.maxAmount === null ? 'No budget specified' : `Budget ≤ ${intent.budget.maxAmount} ${intent.budget.currency}`}`);
    signal.throwIfAborted();
    return this.runPipeline(prompt, intent, steps, usage, signal, emit);
  }
  /** The image analysis already produced a validated intent; only the discovery pipeline runs here. */
  private async executeFromIntent(intent: ProductIntent, signal: AbortSignal, emit: Emit): Promise<RequestMission> {
    const steps = initialSteps();
    steps.forEach(step => emit({ type: 'step', step }));
    const step = this.stepSetter(steps, emit);
    const usage: UsageCounts = { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 };
    emit({ type: 'intent', intent });
    step('understand', 'complete', `${intent.productType} · ${intent.country} · From your inspected photo · ${intent.budget.maxAmount === null ? 'No budget specified' : `Budget ≤ ${intent.budget.maxAmount} ${intent.budget.currency}`}`);
    signal.throwIfAborted();
    return this.runPipeline(intent.originalRequest, intent, steps, usage, signal, emit);
  }
  private async runPipeline(prompt: string, intent: ProductIntent, steps: ActivityStep[], usage: UsageCounts, signal: AbortSignal, emit: Emit): Promise<RequestMission> {
    const step = this.stepSetter(steps, emit);
    const context = { signal, usage };
    step('discover', 'active', 'Searching the Agnic commerce catalogue once, with up to 10 results.');
    const discovered = await this.commerce.searchProducts(intent, context);
    step('discover', 'complete', `${discovered.length} real catalogue results received.`);
    step('filter', 'active', 'Checking market, currency, availability and the original budget.');
    const filtered = filterCandidates(discovered, intent);
    step('filter', 'complete', `${filtered.length} candidates meet the browse-price and market filters. Shipping and tax are not included.`);
    const warnings: string[] = ['Catalogue price and availability can change. Shipping and tax require a quote.'];
    let evaluated = filtered;
    if (filtered.length === 0) {
      step('verify', 'blocked', 'No candidates survived filtering; no compatibility model call was made.');
      step('compare', 'blocked', 'No candidates to rank. Your budget was not expanded.');
    } else if (intent.compatibilityRequirements.length && !hasCompatibilityEvidence(filtered)) {
      step('verify', 'blocked', 'The catalogue lacks compatibility specifications. An extra model call would not verify your device.');
      step('compare', 'active', 'Using the economical model to exclude irrelevant product types and compare listing evidence.');
      evaluated = applyEvaluations(filtered, await this.reasoner.evaluate(intent, filtered, context));
      step('compare', 'complete', 'Compared product relevance, listed features, availability and price. Device compatibility remains unverified.');
      warnings.push('No technical compatibility evaluation was possible from the available listing data. All candidates need verification.');
    } else {
      step('verify', 'active', 'Checking the supplied evidence. Unsupported specifications cannot establish compatibility.');
      evaluated = applyEvaluations(filtered, await this.reasoner.evaluate(intent, filtered, context));
      const supported = evaluated.filter(p => p.compatibility.status === 'VERIFIED' || p.compatibility.status === 'LIKELY_COMPATIBLE').length;
      step('verify', supported ? 'complete' : 'blocked', supported ? `${supported} candidates have evidence supporting a likely match. Exact device compatibility still needs confirmation.` : 'Evidence review completed; compatibility remains unverified.');
      step('compare', 'complete', 'Ranked by supported requirements, compatibility, value and catalogue availability.');
    }
    const products = rankCandidates(evaluated);
    step('select', products.length ? 'pending' : 'blocked', products.length ? 'Select a candidate to review pricing.' : 'No valid shortlist is available. Your constraints were preserved.');
    step('preview', products.length ? 'pending' : 'blocked', 'A read-only quote runs only after you click Check Checkout Price.');
    step('consent', products.length ? 'pending' : 'blocked', 'Real purchases are blocked. A separate verified sandbox quote requires an explicit confirmation.');
    return { id: randomUUID(), prompt, intent, products, steps, source: 'agnic', status: products.length ? 'ready' : 'no-results', summary: products.length ? `${products.length} real products shortlisted. Review the evidence and unresolved requirements before selecting.` : 'No valid candidates were found in this bounded catalogue search. Your budget was not increased.', warnings, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TTL).toISOString(), cacheHit: false, usage, counts: { discovered: discovered.length, withinBudget: filtered.length, shortlisted: products.length } };
  }
  async preview(owner: string, missionId: string, productId: string, signal: AbortSignal): Promise<SafePreview> {
    const record = [...this.completed.values()].find(v => v.owner === owner && v.mission.id === missionId && Date.parse(v.mission.expiresAt) > Date.now());
    const product = record?.mission.products.find(p => p.id === productId);
    if (!record || !product) throw new ProviderError('SELECTION_EXPIRED', 'This selection has expired or is unavailable. Submit the request again before checking a price.', 409);
    const key = `${missionId}:${productId}`;
    const cached = this.quotes.get(key);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.preview);
    const running = this.quoteJobs.get(key);
    if (running) return running;
    if (this.quoteJobs.size >= 2) throw new ProviderError('QUOTE_BUSY', 'Another price check is running. Please wait.', 429);
    const context = { signal, usage: { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 } };
    const job = this.commerce.previewOrder(product, record.mission.intent, context).then(preview => {
      if (this.quotes.size >= 40) this.quotes.delete(this.quotes.keys().next().value!);
      this.quotes.set(key, { preview: structuredClone(preview), expires: Date.now() + 60_000 }); return preview;
    }).finally(() => this.quoteJobs.delete(key));
    this.quoteJobs.set(key, job); return job;
  }
  getSelection(owner: string, missionId: string, productId: string): { product: ProductCandidate; intent: ProductIntent } {
    const record = [...this.completed.values()].find(v => v.owner === owner && v.mission.id === missionId && Date.parse(v.mission.expiresAt) > Date.now());
    const product = record?.mission.products.find(p => p.id === productId);
    if (!record || !product) throw new ProviderError('SELECTION_EXPIRED', 'This selection expired. Find the product again to continue.', 409);
    return structuredClone({ product, intent: record.mission.intent });
  }
}
