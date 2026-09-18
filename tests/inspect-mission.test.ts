import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { RequestMissionService } from '@/lib/server/services/request-mission';
import { buildProductIntentFromInspection } from '@/lib/domain/inspection';
import { inspectionFixtures } from '@/lib/server/demo/inspection-fixtures';
import { context, product } from './fixtures';
import type { CommerceProvider, ProductReasoner } from '@/lib/server/services/live-contracts';
import type { MissionEvent } from '@/lib/domain/commerce';

const inspectedIntent = buildProductIntentFromInspection(inspectionFixtures['broken-office-chair-caster']);

function setup() {
  const reasoner = { understand: vi.fn<ProductReasoner['understand']>(), evaluate: vi.fn<ProductReasoner['evaluate']>().mockResolvedValue({ candidates: [] }) };
  const commerce = { searchProducts: vi.fn<CommerceProvider['searchProducts']>().mockResolvedValue([structuredClone(product)]), previewOrder: vi.fn<CommerceProvider['previewOrder']>(), placeOrder: vi.fn<CommerceProvider['placeOrder']>() };
  return { reasoner, commerce, service: new RequestMissionService(reasoner, commerce) };
}

describe('Inspect Mode search reuses the Request Mode pipeline', () => {
  it('skips the understand model call entirely and searches with the inspection-derived intent', async () => {
    const { service, reasoner, commerce } = setup(); const events: MissionEvent[] = [];
    const mission = await service.runFromIntent(inspectedIntent, 'owner', context().signal, e => events.push(e));
    expect(reasoner.understand).not.toHaveBeenCalled();
    expect(commerce.searchProducts).toHaveBeenCalledWith(inspectedIntent, expect.anything());
    expect(commerce.previewOrder).not.toHaveBeenCalled();
    expect(commerce.placeOrder).not.toHaveBeenCalled();
    expect(mission.intent).toEqual(inspectedIntent);
    expect(mission.source).toBe('agnic');
    expect(events.some(e => e.type === 'intent' && e.intent === inspectedIntent)).toBe(true);
    const understandStep = mission.steps.find(s => s.id === 'understand');
    expect(understandStep?.status).toBe('complete');
  });
  it('makes checkout selection available the same way a Request Mode mission would', async () => {
    const { service } = setup();
    const mission = await service.runFromIntent(inspectedIntent, 'owner', context().signal);
    const selection = service.getSelection('owner', mission.id, mission.products[0].id);
    expect(selection.product.id).toBe(mission.products[0].id);
  });
  it('does not upgrade a cautious NEEDS_VERIFICATION verdict from the evaluator into VERIFIED', async () => {
    const { reasoner } = setup();
    const withEvidence = { ...product, description: 'Fits an 11mm x 22mm grip ring stem, standard swivel caster.' };
    reasoner.evaluate.mockResolvedValue({ candidates: [{ candidateId: product.id, status: 'NEEDS_VERIFICATION', reasons: [{ claim: 'Stem size not confirmed for this chair', evidenceQuote: '11mm x 22mm grip ring' }], missingInformation: ['Exact chair stem dimensions'], requiredConstraintsSatisfied: null, score: 40 }] });
    const commerceWithEvidence = { searchProducts: vi.fn().mockResolvedValue([withEvidence]), previewOrder: vi.fn(), placeOrder: vi.fn() };
    const serviceWithEvidence = new RequestMissionService(reasoner, commerceWithEvidence);
    const mission = await serviceWithEvidence.runFromIntent(inspectedIntent, 'owner', context().signal);
    expect(mission.products[0]?.compatibility.status).toBe('NEEDS_VERIFICATION');
  });
  it('coalesces duplicate concurrent inspection searches for the same owner and intent', async () => {
    const { service, commerce } = setup();
    const [a, b] = await Promise.all([service.runFromIntent(inspectedIntent, 'owner', context().signal), service.runFromIntent(inspectedIntent, 'owner', context().signal)]);
    expect(a.id).toBe(b.id);
    expect(commerce.searchProducts).toHaveBeenCalledTimes(1);
  });
  it('end-to-end: a multi-object cable+adapter inspection searches for the cable only, never a fabricated combined item', async () => {
    const cableIntent = buildProductIntentFromInspection(inspectionFixtures['damaged-usb-cable-with-adapter']);
    const { service, commerce } = setup();
    const mission = await service.runFromIntent(cableIntent, 'owner', context().signal);
    expect(commerce.searchProducts).toHaveBeenCalledWith(expect.objectContaining({ searchQuery: expect.stringContaining('cable') }), expect.anything());
    expect(mission.intent.searchQuery.toLowerCase()).not.toContain('two-pin');
    expect(mission.intent.originalRequest.toLowerCase()).not.toContain('adapter');
  });
});
