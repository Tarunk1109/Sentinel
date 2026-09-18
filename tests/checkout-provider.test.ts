import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { AgnicCheckoutProvider } from '@/lib/server/adapters/agnic-checkout';
import type { SandboxDispatch } from '@/lib/domain/checkout';
import { context, intent, product } from './fixtures';

// Offline provider fixtures. These tests never contact Agnic or use real credentials.
const merchant = { id: 'fixture-merchant', name: 'Fixture test merchant', domain: 'example.com', rail: 'shopify', is_test: true, default_currency: 'CAD' };
const order = { order_id: 'order_fixture', merchant_id: merchant.id, status: 'pending', amount_minor: 100, currency: 'CAD', test: true };
const dispatch: SandboxDispatch = { merchantId: merchant.id, sku: product.sku, quantity: 1, amount: { amountMinor: 100, currency: 'CAD' }, maxTotalMinor: 100, approvedAt: '2026-09-17T10:00:00.000Z', confirmationText: 'Confirm Test Purchase', originalRequest: 'Fixture sandbox purchase' };
const quote = { rail: 'shopify', requires_fulfillment_choice: false, amount_is_final: true, expected_amount_minor: 19500, subtotal_minor: 17900, currency: 'CAD' };

function setup(body: unknown, status = 200) {
  vi.stubEnv('AGNIC_API_KEY', 'agnic_tok_offline_fixture');
  const network = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body, { status }));
  return { network, provider: new AgnicCheckoutProvider(network) };
}
function withDispatch() {
  const result = setup(merchant);
  result.network.mockResolvedValueOnce(Response.json(merchant)).mockResolvedValueOnce(Response.json(order));
  vi.stubEnv('SENTINEL_SANDBOX_CARD_ALIAS_ID', 'card_test_fixture');
  vi.stubEnv('SENTINEL_SANDBOX_CARD_CONFIRMED', 'true');
  return result;
}
afterEach(() => vi.unstubAllEnvs());

describe('merchant discovery and setup', () => {
  it('accepts an organizer-provided server merchant ID but still blocks a non-test merchant', async () => {
    vi.stubEnv('SENTINEL_SANDBOX_MERCHANT_ID', merchant.id);
    const { provider, network } = setup({ ...merchant, is_test: false });
    expect(await provider.getSandboxProducts(context())).toMatchObject({ merchant: { id: merchant.id, isTest: false }, products: [] });
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][0]).toBe(`https://api.agnic.ai/api/autofill/merchants/${merchant.id}`);
  });
  it('rejects an invalid configured merchant ID before network access', async () => {
    vi.stubEnv('SENTINEL_SANDBOX_MERCHANT_ID', '../dispatch');
    const { provider, network } = setup(merchant);
    await expect(provider.getSandboxProducts(context())).rejects.toMatchObject({ code: 'INVALID_MERCHANT' });
    expect(network).not.toHaveBeenCalled();
  });
  it('reads authoritative merchant metadata without exploring an onboarded merchant', async () => {
    const { provider, network } = setup(merchant);
    expect(await provider.getMerchant(merchant.id, context())).toEqual({ id: merchant.id, name: merchant.name, domain: merchant.domain, rail: 'shopify', isTest: true, currency: 'CAD' });
    expect(network).toHaveBeenCalledTimes(1);
    const [url, options] = network.mock.calls[0];
    expect(url).toBe(`https://api.agnic.ai/api/autofill/merchants/${merchant.id}`);
    expect(options).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
  });
  it('rejects metadata attesting to a different merchant ID', async () => {
    const { provider } = setup({ ...merchant, id: 'different-test-merchant' });
    await expect(provider.getMerchant(merchant.id, context())).rejects.toThrow();
  });
  it('requires complete authoritative test metadata', async () => {
    const { provider } = setup({ id: merchant.id, name: 'Looks like a test merchant', domain: 'untitled-fidget.shop', rail: 'shopify' });
    await expect(provider.getMerchant(merchant.id, context())).rejects.toMatchObject({ code: 'AGNIC_METADATA_INVALID' });
  });
  it('retains the exploration job and explicitly stops before payment', async () => {
    const { provider, network } = setup({ order_id: 'explore_fixture', status: 'pending' });
    const result = await provider.explore({ ...product, merchantId: null, onboardRequired: true, onboardUrl: 'https://example.com/checkout' }, intent, context());
    expect(result).toEqual({ orderId: 'explore_fixture', merchantId: null, status: 'pending' });
    const [url, options] = network.mock.calls[0];
    expect(url).toBe('https://api.agnic.ai/api/autofill/explore');
    expect(options?.method).toBe('POST');
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ merchant_url: 'https://example.com/checkout', currency: 'CAD' });
    expect(body.goal).toContain('Do not purchase');
    expect(body.prefs).toContain('Stop before payment');
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('fails clearly if exploration returns neither a job nor a merchant', async () => {
    const { provider, network } = setup({ status: 'pending' });
    await expect(provider.explore(product, intent, context())).rejects.toMatchObject({ code: 'EXPLORE_INCOMPLETE' });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each([401, 429, 500])('sanitizes exploration HTTP %s and never retries', async status => {
    const { provider, network } = setup({ error: 'private credential / address' }, status);
    await expect(provider.explore(product, intent, context())).rejects.toMatchObject({ code: `AGNIC_HTTP_${status}` });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('reports exploration cancellation as an uncertain job, without restarting it', async () => {
    const { provider, network } = setup({});
    const controller = new AbortController();
    const ctx = { ...context(), signal: controller.signal };
    network.mockImplementation(async (_url, options) => {
      controller.abort();
      throw options?.signal?.reason;
    });
    await expect(provider.explore(product, intent, ctx)).rejects.toMatchObject({ code: 'AGNIC_TIMEOUT' });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('resolves the exact selected variant after onboarding', async () => {
    const { provider } = setup({ sku: product.sku, available: true, merchant: { merchant_id: merchant.id, domain: merchant.domain } });
    expect(await provider.resolveProduct({ ...product, merchantId: null, onboardRequired: true }, context())).toMatchObject({ sku: product.sku, merchantId: merchant.id, onboardRequired: false });
  });
  it.each([
    { sku: 'a-different-variant', available: true, code: 'VARIANT_CHANGED' },
    { sku: product.sku, available: false, code: 'OUT_OF_STOCK' },
  ])('blocks a changed or unavailable resolved variant: $code', async fields => {
    const { provider } = setup({ ...fields, merchant: { merchant_id: merchant.id, domain: merchant.domain } });
    await expect(provider.resolveProduct(product, context())).rejects.toMatchObject({ code: fields.code });
  });
  it.each(['javascript:alert(1)', 'https://localhost/', 'https://127.0.0.1/', 'https://user:secret@example.com/', 'https://other.example/'])('rejects unsafe or mismatched exploration target %s before network', async onboardUrl => {
    const { provider, network } = setup({});
    await expect(provider.explore({ ...product, onboardUrl }, intent, context())).rejects.toMatchObject({ code: 'MERCHANT_URL_INVALID' });
    expect(network).not.toHaveBeenCalled();
  });
});

describe('fulfillment and checkout pricing', () => {
  it('shows actual fulfillment options with no fabricated total or ETA', async () => {
    const { provider } = setup({ ...quote, requires_fulfillment_choice: true, fulfillment_options: [{ id: 'standard', type: 'shipping', title: 'Standard', price_minor: 799, currency: 'CAD', requires_address: true }], ship_to: { address: 'private address' }, basket_url: 'https://example.com/private-cart' });
    const result = await provider.previewOrder(product, intent, context());
    expect(result).toMatchObject({ status: 'needs-setup', requiresFulfillment: true, amount: null, amountIsFinal: false, fulfillmentOptions: [{ id: 'standard', price: { amountMinor: 799, currency: 'CAD' }, eta: null }] });
    expect(JSON.stringify(result)).not.toMatch(/private address|private-cart|ship_to|basket_url/);
  });
  it('passes an explicitly selected fulfillment ID back to the quote endpoint', async () => {
    const { provider, network } = setup({ ...quote, selected_option_id: 'standard', fulfillment_options: [{ id: 'standard', price_minor: 799, currency: 'CAD', eta: '3–5 days' }] });
    const result = await provider.previewOrder(product, intent, context(), 'standard');
    expect(result).toMatchObject({ status: 'quoted', selectedFulfillmentId: 'standard', shipping: { amountMinor: 799, currency: 'CAD' }, fulfillmentOptions: [{ eta: '3–5 days' }] });
    expect(JSON.parse(String(network.mock.calls[0][1]?.body))).toMatchObject({ fulfillment_option_id: 'standard', constraints: { max_total_minor: 20000 } });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('preserves the provider final-versus-ceiling flag %s', async amountIsFinal => {
    const { provider } = setup({ ...quote, amount_is_final: amountIsFinal });
    expect(await provider.previewOrder(product, intent, context())).toMatchObject({ status: 'quoted', amountIsFinal, amount: { amountMinor: 19500, currency: 'CAD' }, tax: null });
  });
  it('shows numeric limit and checkout amount when a quote exceeds the budget', async () => {
    const { provider } = setup({ ...quote, expected_amount_minor: 20800 });
    expect(await provider.previewOrder(product, intent, context())).toMatchObject({ status: 'needs-setup', amount: null, budgetViolation: { limit: { amountMinor: 20000, currency: 'CAD' }, checkout: { amountMinor: 20800, currency: 'CAD' } } });
  });
  it('handles a provider constraint rejection without changing the original cap', async () => {
    const { provider } = setup({ error: 'constraint_total_exceeded', expected_amount_minor: 20800, private: 'private payment details' }, 409);
    const result = await provider.previewOrder(product, intent, context());
    expect(result).toMatchObject({ status: 'needs-setup', budgetViolation: { limit: { amountMinor: 20000, currency: 'CAD' }, checkout: { amountMinor: 20800, currency: 'CAD' } } });
    expect(JSON.stringify(result)).not.toContain('private payment details');
  });
});

describe('sandbox dispatch boundary', () => {
  it('independently verifies the merchant and sends exactly one explicitly consented test dispatch', async () => {
    const { provider, network } = withDispatch();
    expect(await provider.dispatchSandbox(dispatch, context())).toMatchObject({ id: order.order_id, status: 'pending', test: true });
    expect(network).toHaveBeenCalledTimes(2);
    expect(String(network.mock.calls[0][0])).toContain(`/merchants/${merchant.id}`);
    expect(network.mock.calls[0][1]?.method).toBe('GET');
    expect(network.mock.calls[1][0]).toBe('https://api.agnic.ai/api/autofill/dispatch');
    expect(JSON.parse(String(network.mock.calls[1][1]?.body))).toMatchObject({ card_alias_id: 'card_test_fixture', user_confirmation_text: 'Confirm Test Purchase', user_approved_at_iso: dispatch.approvedAt, constraints: { max_total_minor: 100 } });
    expect(network.mock.calls.filter(([url]) => String(url).endsWith('/dispatch'))).toHaveLength(1);
  });
  it('ignores frontend test claims and blocks a server-verified real merchant before dispatch', async () => {
    const { provider, network } = setup({ ...merchant, is_test: false });
    const spoofed = { ...dispatch, is_test: true, isTest: true, mode: 'SANDBOX_COMMERCE_MODE' };
    await expect(provider.dispatchSandbox(spoofed, context())).rejects.toMatchObject({ code: 'SANDBOX_MERCHANT_REQUIRED' });
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][1]?.method).toBe('GET');
  });
  it('never falls back to an account default card when test alias is missing', async () => {
    const { provider, network } = setup(merchant);
    vi.stubEnv('SENTINEL_SANDBOX_CARD_ALIAS_ID', '');
    vi.stubEnv('SENTINEL_SANDBOX_CARD_CONFIRMED', 'true');
    await expect(provider.dispatchSandbox(dispatch, context())).rejects.toMatchObject({ code: 'TEST_CARD_REQUIRED' });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('requires a valid explicit consent timestamp before dispatch', async () => {
    const { provider, network } = withDispatch();
    await expect(provider.dispatchSandbox({ ...dispatch, approvedAt: 'not-approved' }, context())).rejects.toMatchObject({ code: 'TEST_CONSENT_REQUIRED' });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('blocks a quote above the approved maximum', async () => {
    const { provider, network } = withDispatch();
    await expect(provider.dispatchSandbox({ ...dispatch, maxTotalMinor: 99 }, context())).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each([
    { quantity: 0 }, { quantity: 1.5 }, { quantity: 11 },
    { maxTotalMinor: Number.NaN }, { maxTotalMinor: Number.POSITIVE_INFINITY }, { maxTotalMinor: -1 },
    { amount: { amountMinor: 1.5, currency: 'CAD' as const } },
    { amount: { amountMinor: Number.NaN, currency: 'CAD' as const } },
    { amount: { amountMinor: -1, currency: 'CAD' as const } },
    { amount: { amountMinor: 100, currency: 'USD' as const } },
  ])('blocks invalid numeric or currency input before dispatch: %j', async invalid => {
    const { provider, network } = withDispatch();
    await expect(provider.dispatchSandbox({ ...dispatch, ...invalid }, context())).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][1]?.method).toBe('GET');
  });
  it('does not retry dispatch when Agnic asks for hosted setup', async () => {
    const { provider, network } = withDispatch();
    network.mockReset().mockResolvedValueOnce(Response.json(merchant)).mockResolvedValueOnce(Response.json({ order_id: 'approval_fixture', private: 'private hosted URL' }, { status: 202 }));
    await expect(provider.dispatchSandbox(dispatch, context())).rejects.toMatchObject({ code: 'AGNIC_HOSTED_SETUP' });
    expect(network.mock.calls.filter(([url]) => String(url).endsWith('/dispatch'))).toHaveLength(1);
  });
});

describe('order polling and proof normalization', () => {
  it('rejects proof returned for an order other than the requested order ID', async () => {
    const { provider } = setup({ ...order, order_id: 'different_order', status: 'succeeded' });
    await expect(provider.getOrder(order.order_id, context())).rejects.toThrow();
  });
  it('reads a saved order ID and retains actual successful proof without private payloads', async () => {
    const { provider, network } = setup({ ...order, status: 'succeeded', amount_charged_minor: 98, created_at: '2026-09-17T10:01:00Z', order_url: 'https://app.agnic.ai/orders/order_fixture', live_view_url: 'https://private.example/signed?token=secret', ship_to: { address: 'private delivery details' } });
    const result = await provider.getOrder(order.order_id, context());
    expect(result).toMatchObject({ id: order.order_id, status: 'succeeded', chargedAmount: { amountMinor: 98, currency: 'CAD' }, orderUrl: 'https://app.agnic.ai/orders/order_fixture', timestamp: '2026-09-17T10:01:00.000Z' });
    expect(JSON.stringify(result)).not.toMatch(/private delivery|token=secret|live_view_url|ship_to/);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][1]?.method).toBe('GET');
  });
  it('retains a declared payment decline without declaring success', async () => {
    const { provider } = setup({ ...order, status: 'merchant_error', error_code: 'payment_declined', retry_action: 'contact_support' });
    expect(await provider.getOrder(order.order_id, context())).toMatchObject({ status: 'merchant_error', errorCode: 'payment_declined', retryAction: 'contact_support', chargedAmount: null });
  });
  it('normalizes unexpected statuses to unknown, without guessing a receipt', async () => {
    const { provider } = setup({ ...order, status: 'new_provider_status', currency: 'EUR', created_at: 'invalid date', retry_action: 'dispatch_again' });
    expect(await provider.getOrder(order.order_id, context())).toMatchObject({ status: 'unknown', approvedAmount: null, chargedAmount: null, timestamp: null, retryAction: null });
  });
  it.each(['https://app.agnic.ai/orders/id?token=private', 'https://app.agnic.ai.evil.example/orders/id', 'https://127.0.0.1/orders/id', 'javascript:alert(1)'])('does not publish an unsafe evidence URL %s', async orderUrl => {
    const { provider } = setup({ ...order, order_url: orderUrl });
    expect((await provider.getOrder(order.order_id, context())).orderUrl).toBeNull();
  });
  it('rejects a path-injection order ID without a network request', async () => {
    const { provider, network } = setup(order);
    await expect(provider.getOrder('../dispatch', context())).rejects.toMatchObject({ code: 'INVALID_ORDER' });
    expect(network).not.toHaveBeenCalled();
  });
});
