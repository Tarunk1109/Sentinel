import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { applyEvaluations, filterCandidates, RequestMissionService } from '@/lib/server/services/request-mission';
import { context, intent, product } from './fixtures';
import type { CommerceProvider, ProductReasoner } from '@/lib/server/services/live-contracts';
import type { MissionEvent } from '@/lib/domain/commerce';
function setup() {
  const reasoner = { understand: vi.fn<ProductReasoner['understand']>().mockResolvedValue(intent), evaluate: vi.fn<ProductReasoner['evaluate']>().mockResolvedValue({ candidates: [] }) };
  const commerce = { searchProducts: vi.fn<CommerceProvider['searchProducts']>().mockResolvedValue([structuredClone(product)]), previewOrder: vi.fn<CommerceProvider['previewOrder']>(), placeOrder: vi.fn<CommerceProvider['placeOrder']>() };
  return { reasoner, commerce, service: new RequestMissionService(reasoner, commerce) };
}
describe('live mission orchestration with offline fixtures', () => {
  it('reviews catalogue relevance without claiming missing compatibility; selection causes no quote', async () => {
    const { service, reasoner, commerce } = setup(); const events: MissionEvent[] = [];
    const mission = await service.run('monitor under 200', 'owner', context().signal, e => events.push(e));
    expect(mission.source).toBe('agnic'); expect(mission.products).toHaveLength(1);
    expect(reasoner.evaluate).toHaveBeenCalledOnce(); expect(commerce.searchProducts).toHaveBeenCalledTimes(1); expect(commerce.previewOrder).not.toHaveBeenCalled(); expect(commerce.placeOrder).not.toHaveBeenCalled();
    expect(mission.steps.find(s => s.id === 'verify')?.status).toBe('blocked'); expect(mission.steps.find(s => s.id === 'purchase')?.status).toBe('blocked'); expect(events[0].type).toBe('step');
    const cached = await service.run('MONITOR  under 200', 'owner', context().signal);
    expect(cached.cacheHit).toBe(true); expect(cached.usage.modelCalls).toBe(0); expect(reasoner.understand).toHaveBeenCalledTimes(1);
  });
  it('coalesces in-flight duplicates and isolates owner cache', async () => {
    const { service, reasoner, commerce } = setup();
    const [a,b] = await Promise.all([service.run('monitor', 'one', context().signal), service.run('monitor', 'one', context().signal)]);
    expect(a.id).toBe(b.id); expect(reasoner.understand).toHaveBeenCalledTimes(1); expect(commerce.searchProducts).toHaveBeenCalledTimes(1);
    await service.run('monitor', 'two', context().signal); expect(reasoner.understand).toHaveBeenCalledTimes(2);
  });
  it('preserves a $1 budget and skips further AI when nothing fits', async () => {
    const { service, reasoner } = setup(); reasoner.understand.mockResolvedValue({ ...intent, budget: { maxAmount: 1, currency: 'CAD' } });
    const mission = await service.run('gaming laptop under $1', 'owner', context().signal); expect(mission.products).toEqual([]); expect(mission.intent.budget.maxAmount).toBe(1); expect(reasoner.evaluate).not.toHaveBeenCalled();
  });
  it('requires session-owned server selection for quotes', async () => {
    const { service, commerce } = setup(); const mission = await service.run('monitor', 'owner', context().signal);
    await expect(service.preview('attacker', mission.id, product.id, context().signal)).rejects.toThrow('expired');
    await expect(service.preview('owner', mission.id, 'forged-sku', context().signal)).rejects.toThrow('expired'); expect(commerce.previewOrder).not.toHaveBeenCalled();
  });
  it('filters quantity, currency, availability and duplicates without conversion', () => {
    expect(filterCandidates([product, product, { ...product, id: 'usd', price: { amountMinor: 1, currency: 'USD' } }, { ...product, id: 'out', availability: 'unavailable' }], intent)).toHaveLength(1);
    expect(filterCandidates([product], { ...intent, quantity: 2 })).toHaveLength(0);
  });
  it('rejects hallucinated evidence and unknown/duplicate IDs', () => {
    const candidate = { candidateId: product.id, status: 'VERIFIED' as const, reasons: [{ claim: 'Works with MacBook', evidenceQuote: 'USB-C DisplayPort Alt Mode' }], missingInformation: [], requiredConstraintsSatisfied: true, score: 100 };
    expect(applyEvaluations([product], { candidates: [candidate] })[0].compatibility.status).toBe('NEEDS_VERIFICATION');
    expect(applyEvaluations([product], { candidates: [{ ...candidate, candidateId: 'invented' }] })[0].score).toBe(0);
    expect(applyEvaluations([product], { candidates: [candidate, candidate] })[0].score).toBe(0);
  });
});
