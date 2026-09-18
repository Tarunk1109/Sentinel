import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { CheckoutService } from '@/lib/server/services/checkout';
import type { CheckoutProvider } from '@/lib/server/services/live-contracts';
import type { CheckoutSession, Merchant, ProviderOrder, SandboxConsent } from '@/lib/domain/checkout';
import type { SafePreview } from '@/lib/domain/commerce';
import { ProviderError } from '@/lib/server/provider-error';
import { intent, product } from './fixtures';

const owner = 'fixture-owner';
const signal = () => new AbortController().signal;
const merchant: Merchant = { id: product.merchantId!, name: 'Fixture test merchant', domain: 'example.com', rail: 'shopify', isTest: true, currency: 'CAD' };
const testProduct = { ...product, price: { amountMinor: 100, currency: 'CAD' as const } };
const preview: SafePreview = { source: 'agnic', status: 'quoted', productId: product.id, quantity: 1, browsePrice: testProduct.price, subtotal: testProduct.price, shipping: null, tax: null, amount: testProduct.price, amountIsFinal: true, priceChanged: false, requirements: [], message: 'Fixture test quote', quotedAt: '2026-09-17T10:00:00Z', requiresFulfillment: false, selectedFulfillmentId: null };
const order: ProviderOrder = { id: 'order_fixture', merchantId: merchant.id, status: 'pending', approvedAmount: testProduct.price, chargedAmount: null, orderUrl: null, timestamp: null, test: true, retryAction: null, errorCode: null };
function mockJournal() {
  return { claim: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined), record: vi.fn<(id: string, orderId: string | null, status: string) => Promise<void>>().mockResolvedValue(undefined) };
}
function setup(selectionProduct = product, journal = mockJournal()) {
  const provider = {
    searchProducts: vi.fn<CheckoutProvider['searchProducts']>().mockResolvedValue([testProduct]),
    previewOrder: vi.fn<CheckoutProvider['previewOrder']>().mockResolvedValue(preview),
    placeOrder: vi.fn<CheckoutProvider['placeOrder']>().mockRejectedValue(new Error('disabled')),
    getMerchant: vi.fn<CheckoutProvider['getMerchant']>().mockResolvedValue(merchant),
    getSandboxProducts: vi.fn<CheckoutProvider['getSandboxProducts']>().mockResolvedValue({ merchant, products: [testProduct] }),
    explore: vi.fn<CheckoutProvider['explore']>().mockResolvedValue({ orderId: 'explore_fixture', merchantId: null, status: 'pending' }),
    resolveProduct: vi.fn<CheckoutProvider['resolveProduct']>().mockResolvedValue(product),
    getOrder: vi.fn<CheckoutProvider['getOrder']>().mockResolvedValue(order),
    dispatchSandbox: vi.fn<CheckoutProvider['dispatchSandbox']>().mockResolvedValue(order),
  } satisfies CheckoutProvider;
  const select = vi.fn().mockReturnValue({ product: selectionProduct, intent });
  return { provider, select, journal, service: new CheckoutService(provider, select, journal) };
}
async function quoted(service: CheckoutService) {
  const state = await service.beginSandbox(owner, testProduct.id, signal());
  return service.quote(owner, state.id, signal());
}
function consent(state: CheckoutSession): SandboxConsent {
  if (!state.quoteId) throw new Error('Test fixture requires a quote');
  return { checkoutId: state.id, quoteId: state.quoteId, confirmed: true, confirmationText: 'Confirm Test Purchase' };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
  vi.stubEnv('SENTINEL_SANDBOX_CARD_ALIAS_ID', 'card_test_fixture');
  vi.stubEnv('SENTINEL_SANDBOX_CARD_CONFIRMED', 'true');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('checkout selection and ownership', () => {
  it('reuses a selected product session without exploring, quoting, or dispatching', () => {
    const { service, provider, select } = setup();
    const first = service.begin(owner, 'mission_fixture', product.id);
    const second = service.begin(owner, 'mission_fixture', product.id);
    expect(second.id).toBe(first.id);
    expect(select).toHaveBeenCalledWith(owner, 'mission_fixture', product.id);
    expect(provider.explore).not.toHaveBeenCalled();
    expect(provider.previewOrder).not.toHaveBeenCalled();
    expect(provider.dispatchSandbox).not.toHaveBeenCalled();
  });
  it('rejects another browser session before any merchant or checkout call', async () => {
    const { service, provider } = setup();
    const state = service.begin(owner, 'mission_fixture', product.id);
    await expect(service.quote('another-owner', state.id, signal())).rejects.toMatchObject({ code: 'CHECKOUT_EXPIRED' });
    await expect(service.refresh('another-owner', state.id, signal())).rejects.toMatchObject({ code: 'CHECKOUT_EXPIRED' });
    expect(provider.getMerchant).not.toHaveBeenCalled();
  });
  it('keeps a real product selection non-executable even if its merchant is a test merchant', async () => {
    const { service, provider } = setup();
    const state = service.begin(owner, 'mission_fixture', product.id);
    const reviewed = await service.quote(owner, state.id, signal());
    expect(reviewed.canConfirm).toBe(false);
    await expect(service.confirm(owner, consent(reviewed), signal())).rejects.toMatchObject({ code: 'REAL_PURCHASES_DISABLED' });
    expect(provider.dispatchSandbox).not.toHaveBeenCalled();
  });
  it('refuses a server catalogue whose documented merchant is not marked test', async () => {
    const { service, provider } = setup();
    provider.getSandboxProducts.mockResolvedValue({ merchant: { ...merchant, isTest: false }, products: [testProduct] });
    await expect(service.beginSandbox(owner, testProduct.id, signal())).rejects.toMatchObject({ code: 'SANDBOX_MERCHANT_REQUIRED' });
    expect(provider.dispatchSandbox).not.toHaveBeenCalled();
  });
  it('accepts only product IDs in the server-verified sandbox catalogue', async () => {
    const { service } = setup();
    await expect(service.beginSandbox(owner, 'frontend-invented-product', signal())).rejects.toMatchObject({ code: 'SANDBOX_PRODUCT_UNAVAILABLE' });
  });
});

describe('merchant exploration tracking', () => {
  it('checks an onboarded merchant without starting exploration', async () => {
    const { service, provider } = setup();
    const state = service.begin(owner, 'mission_fixture', product.id);
    expect((await service.prepare(owner, state.id, signal())).stage).toBe('ready');
    expect(provider.getMerchant).toHaveBeenCalledTimes(1);
    expect(provider.explore).not.toHaveBeenCalled();
  });
  it('explores once and polls only the returned job until merchant readiness is confirmed', async () => {
    const { service, provider } = setup({ ...product, merchantId: null, onboardRequired: true });
    const state = service.begin(owner, 'mission_fixture', product.id);
    expect((await service.prepare(owner, state.id, signal())).stage).toBe('exploring');
    await service.prepare(owner, state.id, signal());
    expect(provider.explore).toHaveBeenCalledTimes(1);
    provider.getOrder.mockResolvedValue({ ...order, id: 'explore_fixture', status: 'explored' });
    expect((await service.refresh(owner, state.id, signal())).stage).toBe('ready');
    expect(provider.getOrder).toHaveBeenCalledWith('explore_fixture', expect.any(Object));
    expect(provider.resolveProduct).toHaveBeenCalledTimes(1);
    expect(provider.dispatchSandbox).not.toHaveBeenCalled();
  });
  it('stops polling after the exploration window and resumes only the existing job', async () => {
    const { service, provider } = setup({ ...product, merchantId: null, onboardRequired: true });
    const state = service.begin(owner, 'mission_fixture', product.id);
    await service.prepare(owner, state.id, signal());
    vi.advanceTimersByTime(180001);
    expect((await service.refresh(owner, state.id, signal())).stage).toBe('timed-out');
    expect(provider.getOrder).not.toHaveBeenCalled();
    expect((await service.prepare(owner, state.id, signal())).stage).toBe('exploring');
    await service.refresh(owner, state.id, signal());
    expect(provider.explore).toHaveBeenCalledTimes(1);
    expect(provider.getOrder).toHaveBeenCalledWith('explore_fixture', expect.any(Object));
  });
  it('does not restart exploration after an uncertain provider failure without a job ID', async () => {
    const { service, provider } = setup({ ...product, merchantId: null, onboardRequired: true });
    provider.explore.mockRejectedValue(new ProviderError('AGNIC_TIMEOUT', 'Exploration timed out.'));
    const state = service.begin(owner, 'mission_fixture', product.id);
    await expect(service.prepare(owner, state.id, signal())).rejects.toMatchObject({ code: 'AGNIC_TIMEOUT' });
    await expect(service.prepare(owner, state.id, signal())).rejects.toMatchObject({ code: 'EXPLORE_OUTCOME_UNKNOWN' });
    await service.refresh(owner, state.id, signal());
    expect(provider.explore).toHaveBeenCalledTimes(1);
    expect(provider.getOrder).not.toHaveBeenCalled();
  });
});

describe('quote and consent enforcement', () => {
  it('rejects fulfillment IDs that were not returned by the current quote', async () => {
    const { service, provider } = setup();
    const state = await service.beginSandbox(owner, testProduct.id, signal());
    await expect(service.quote(owner, state.id, signal(), 'invented-expensive-option')).rejects.toMatchObject({ code: 'FULFILLMENT_INVALID' });
    expect(provider.previewOrder).not.toHaveBeenCalled();
  });
  it('cannot confirm until a complete fresh quote exists', async () => {
    const { service, provider } = setup();
    const state = await quoted(service);
    vi.advanceTimersByTime(5 * 60000);
    await expect(service.confirm(owner, consent(state), signal())).rejects.toMatchObject({ code: 'CONSENT_INVALID' });
    expect(provider.dispatchSandbox).not.toHaveBeenCalled();
  });
  it('rejects a quote ID that does not match the reviewed quote', async () => {
    const { service, provider } = setup();
    const state = await quoted(service);
    await expect(service.confirm(owner, { ...consent(state), quoteId: 'stale-quote' }, signal())).rejects.toMatchObject({ code: 'CONSENT_INVALID' });
    expect(provider.dispatchSandbox).not.toHaveBeenCalled();
  });
  it('re-verifies merchant test status immediately before placement', async () => {
    const { service, provider } = setup();
    const state = await quoted(service);
    provider.getMerchant.mockResolvedValue({ ...merchant, isTest: false });
    await expect(service.confirm(owner, consent(state), signal())).rejects.toMatchObject({ code: 'SANDBOX_MERCHANT_REQUIRED' });
    expect(provider.dispatchSandbox).not.toHaveBeenCalled();
  });
  it('requires new review when a fresh amount changes, without dispatching', async () => {
    const { service, provider, journal } = setup();
    const state = await quoted(service);
    provider.previewOrder.mockResolvedValue({ ...preview, amount: { amountMinor: 108, currency: 'CAD' } });
    const changed = await service.confirm(owner, consent(state), signal());
    expect(changed).toMatchObject({ stage: 'blocked', canConfirm: false, quoteId: null });
    expect(changed.message).toContain('Quote changed');
    expect(provider.dispatchSandbox).not.toHaveBeenCalled();
    expect(journal.claim).not.toHaveBeenCalled();
  });
  it('requires new review when final amount becomes only a ceiling', async () => {
    const { service, provider } = setup();
    const state = await quoted(service);
    provider.previewOrder.mockResolvedValue({ ...preview, amountIsFinal: false });
    expect((await service.confirm(owner, consent(state), signal())).stage).toBe('blocked');
    expect(provider.dispatchSandbox).not.toHaveBeenCalled();
  });
});

describe('once-only dispatch and truthful order status', () => {
  it('coalesces concurrent confirmations and permanently locks out another dispatch', async () => {
    const { service, provider, journal } = setup();
    const state = await quoted(service);
    const [first, second] = await Promise.all([service.confirm(owner, consent(state), signal()), service.confirm(owner, consent(state), signal())]);
    expect(first.stage).toBe('processing');
    expect(second.order?.id).toBe(order.id);
    expect(journal.claim).toHaveBeenCalledTimes(1);
    expect(provider.dispatchSandbox).toHaveBeenCalledTimes(1);
    expect(journal.claim.mock.invocationCallOrder[0]).toBeLessThan(provider.dispatchSandbox.mock.invocationCallOrder[0]);
    const attemptId = journal.claim.mock.calls[0][0];
    expect(attemptId).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(attemptId).not.toBe(state.id);
    expect(JSON.stringify(first)).not.toContain(attemptId);
    expect(journal.record).toHaveBeenCalledWith(attemptId, order.id, 'pending');
    await service.confirm(owner, consent(state), signal());
    expect(provider.dispatchSandbox).toHaveBeenCalledTimes(1);
  });
  it('fails closed when the durable journal says a dispatch was already attempted', async () => {
    const { service, provider, journal } = setup();
    const state = await quoted(service);
    journal.claim.mockRejectedValue(new ProviderError('DISPATCH_ALREADY_ATTEMPTED', 'Saved dispatch exists.'));
    await expect(service.confirm(owner, consent(state), signal())).rejects.toMatchObject({ code: 'DISPATCH_ALREADY_ATTEMPTED' });
    expect(provider.dispatchSandbox).not.toHaveBeenCalled();
  });
  it('never retries an uncertain dispatch failure', async () => {
    const { service, provider, journal } = setup();
    const state = await quoted(service);
    provider.dispatchSandbox.mockRejectedValue(new ProviderError('AGNIC_TIMEOUT', 'The order outcome is uncertain.'));
    expect((await service.confirm(owner, consent(state), signal())).stage).toBe('unknown');
    expect((await service.confirm(owner, consent(state), signal())).stage).toBe('unknown');
    expect(provider.dispatchSandbox).toHaveBeenCalledTimes(1);
    expect(journal.record).toHaveBeenCalledWith(journal.claim.mock.calls[0][0], null, 'unknown');
  });
  it.each(['expiry', 'restart'])('blocks another dispatch of an uncertain selection after checkout %s', async reason => {
    const first = setup();
    const attempts = new Set<string>();
    first.journal.claim.mockImplementation(async id => {
      if (attempts.has(id)) throw new ProviderError('DISPATCH_ALREADY_ATTEMPTED', 'Saved dispatch exists.');
      attempts.add(id);
    });
    const state = await quoted(first.service);
    first.provider.dispatchSandbox.mockRejectedValue(new ProviderError('AGNIC_TIMEOUT', 'The order outcome is uncertain.'));
    await first.service.confirm(owner, consent(state), signal());

    if (reason === 'expiry') vi.advanceTimersByTime(30 * 60000 + 1);
    const next = reason === 'restart' ? setup(product, first.journal) : first;
    const recreated = await quoted(next.service);
    expect(recreated.id).not.toBe(state.id);
    await expect(next.service.confirm(owner, consent(recreated), signal())).rejects.toMatchObject({ code: 'DISPATCH_ALREADY_ATTEMPTED' });
    expect(first.journal.claim.mock.calls[1][0]).toBe(first.journal.claim.mock.calls[0][0]);
    expect(first.provider.dispatchSandbox).toHaveBeenCalledTimes(1);
    if (reason === 'restart') expect(next.provider.dispatchSandbox).not.toHaveBeenCalled();
  });
  it.each(['owner', 'merchant', 'sku'])('keeps a different sandbox %s in a separate dispatch identity', async field => {
    const first = setup();
    const state = await quoted(first.service);
    await first.service.confirm(owner, consent(state), signal());

    const next = setup(product, first.journal);
    const nextOwner = field === 'owner' ? 'another-owner' : owner;
    const nextMerchant = field === 'merchant' ? { ...merchant, id: 'another-merchant' } : merchant;
    const nextProduct = { ...testProduct, merchantId: nextMerchant.id, sku: field === 'sku' ? 'another-sku' : testProduct.sku };
    next.provider.getSandboxProducts.mockResolvedValue({ merchant: nextMerchant, products: [nextProduct] });
    next.provider.getMerchant.mockResolvedValue(nextMerchant);
    const selected = await next.service.beginSandbox(nextOwner, nextProduct.id, signal());
    const reviewed = await next.service.quote(nextOwner, selected.id, signal());
    await next.service.confirm(nextOwner, consent(reviewed), signal());
    expect(first.journal.claim.mock.calls[1][0]).not.toBe(first.journal.claim.mock.calls[0][0]);
    expect(next.provider.dispatchSandbox).toHaveBeenCalledTimes(1);
  });
  it('polls the saved order at a bounded interval without ever redispatching', async () => {
    const { service, provider, journal } = setup();
    const state = await quoted(service);
    await service.confirm(owner, consent(state), signal());
    await service.refresh(owner, state.id, signal());
    await service.refresh(owner, state.id, signal());
    expect(provider.getOrder).toHaveBeenCalledTimes(1);
    expect(provider.getOrder).toHaveBeenCalledWith(order.id, expect.any(Object));
    expect(journal.record).toHaveBeenLastCalledWith(journal.claim.mock.calls[0][0], order.id, 'pending');
    vi.advanceTimersByTime(5000);
    await service.refresh(owner, state.id, signal());
    expect(provider.getOrder).toHaveBeenCalledTimes(2);
    expect(provider.dispatchSandbox).toHaveBeenCalledTimes(1);
  });
  it('stops order polling after four minutes without inventing success or redispatching', async () => {
    const { service, provider } = setup();
    const state = await quoted(service);
    await service.confirm(owner, consent(state), signal());
    vi.advanceTimersByTime(240001);
    expect((await service.refresh(owner, state.id, signal())).stage).toBe('timed-out');
    await service.refresh(owner, state.id, signal());
    expect(provider.getOrder).toHaveBeenCalledTimes(1);
    expect(provider.dispatchSandbox).toHaveBeenCalledTimes(1);
    provider.getOrder.mockResolvedValue({ ...order, status: 'succeeded' });
    vi.advanceTimersByTime(5000);
    expect((await service.refresh(owner, state.id, signal())).stage).toBe('succeeded');
    expect(provider.dispatchSandbox).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('requires provider test=true before displaying a successful test proof: %s', async test => {
    const { service, provider } = setup();
    const state = await quoted(service);
    await service.confirm(owner, consent(state), signal());
    provider.getOrder.mockResolvedValue({ ...order, status: 'succeeded', test, chargedAmount: { amountMinor: 98, currency: 'CAD' }, timestamp: '2026-09-17T10:01:00Z' });
    const completed = await service.refresh(owner, state.id, signal());
    expect(completed.stage).toBe(test ? 'succeeded' : 'unknown');
    expect(completed.order?.chargedAmount?.amountMinor).toBe(98);
    expect(completed.canConfirm).toBe(false);
  });
  it('shows a test payment failure rather than completing or retrying the order', async () => {
    const { service, provider } = setup();
    const state = await quoted(service);
    await service.confirm(owner, consent(state), signal());
    provider.getOrder.mockResolvedValue({ ...order, status: 'payment_gate_hit', errorCode: 'payment_declined' });
    const failed = await service.refresh(owner, state.id, signal());
    expect(failed.stage).toBe('failed');
    expect(failed.message).toContain('declined');
    expect(provider.dispatchSandbox).toHaveBeenCalledTimes(1);
  });
  it('rejects an order belonging to a different merchant', async () => {
    const { service, provider } = setup();
    const state = await quoted(service);
    await service.confirm(owner, consent(state), signal());
    provider.getOrder.mockResolvedValue({ ...order, merchantId: 'different_merchant', status: 'succeeded' });
    await expect(service.refresh(owner, state.id, signal())).rejects.toMatchObject({ code: 'ORDER_MERCHANT_MISMATCH' });
  });
});
