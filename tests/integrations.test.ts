import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { AgnicProvider, safePublicHttpsUrl } from '@/lib/server/adapters/agnic';
import { assertRealPurchasesEnabled } from '@/lib/server/safety';
import { context, intent, product } from './fixtures';
afterEach(() => vi.unstubAllEnvs());
const rawProduct = { sku: product.sku, title: product.name, price_minor: 17900, currency: 'CAD', available: true, merchant: { name: 'Fixture', domain: 'example.com', merchant_id: 'fixture-merchant' }, product_url: product.productUrl };
function setup(body: unknown, status = 200) {
  vi.stubEnv('AGNIC_API_KEY', 'agnic_tok_offline_fixture');
  const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
  return { network, provider: new AgnicProvider(network) };
}
describe('Agnic read-only boundary', () => {
  it('normalizes identifiers and integer prices, with one search and no invented specs', async () => {
    const { provider, network } = setup({ products: [rawProduct] }); const ctx = context();
    const result = await provider.searchProducts(intent, ctx);
    expect(result[0]).toMatchObject({ sku: product.sku, price: product.price, compatibility: { status: 'NEEDS_VERIFICATION' }, description: null });
    expect(network).toHaveBeenCalledTimes(1); expect(ctx.usage.agnicCalls).toBe(1);
    const [url, options] = network.mock.calls[0]; expect(String(url)).toContain('/api/autofill/products/search?'); expect(String(url)).toContain('limit=10'); expect(options?.method).toBe('GET'); expect(options?.redirect).toBe('error');
  });
  it.each(['EUR', null])('does not relabel unsupported currency %s', async currency => {
    const { provider } = setup({ products: [{ ...rawProduct, currency }] }); expect((await provider.searchProducts(intent, context()))[0].price).toBeNull();
  });
  it('quotes only the selected variant with the original total budget', async () => {
    const { provider, network } = setup({ rail: 'shopify', requires_fulfillment_choice: false, amount_is_final: false, expected_amount_minor: 19900, subtotal_minor: 17900, currency: 'CAD', fulfillment_options: [{ id: 'ship', price_minor: 1000, currency: 'CAD' }], selected_option_id: 'ship', ship_to: { address: 'must stay private' }, basket_url: 'https://example.com/secret-cart' });
    const preview = await provider.previewOrder(product, intent, context());
    expect(preview).toMatchObject({ status: 'quoted', amountIsFinal: false, amount: { amountMinor: 19900, currency: 'CAD' }, shipping: { amountMinor: 1000, currency: 'CAD' }, tax: null });
    expect(JSON.stringify(preview)).not.toContain('must stay private'); expect(JSON.stringify(preview)).not.toContain('secret-cart');
    const [url, options] = network.mock.calls[0]; expect(String(url)).toBe('https://api.agnic.ai/api/autofill/shopify/quote'); expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({ merchant_id: product.merchantId, items: [{ sku: product.sku, quantity: 1 }], constraints: { max_total_minor: 20000 } });
  });
  it.each([
    { requires_fulfillment_choice: true },
    { requires_fulfillment_choice: false, expected_amount_minor: null },
    { requires_fulfillment_choice: false, expected_amount_minor: 25000 },
  ])('never represents incomplete or over-budget quotes as success: %j', async fields => {
    const { provider } = setup({ rail: 'shopify', expected_amount_minor: 19000, amount_is_final: true, currency: 'CAD', ...fields });
    const quote = await provider.previewOrder(product, intent, context()); expect(quote.status).toBe('needs-setup'); expect(quote.amount).toBeNull();
  });
  it('recognizes changed price and an exact quote', async () => {
    const { provider } = setup({ rail: 'shopify', requires_fulfillment_choice: false, amount_is_final: true, expected_amount_minor: 19800, subtotal_minor: 18000, currency: 'CAD' });
    expect(await provider.previewOrder(product, intent, context())).toMatchObject({ status: 'quoted', amountIsFinal: true, priceChanged: true });
  });
  it('returns unavailable when fulfillment fails', async () => {
    const { provider } = setup({ rail: 'shopify', unfulfillable: { reason: 'private provider detail' } });
    expect(await provider.previewOrder(product, intent, context())).toMatchObject({ status: 'unavailable', amount: null });
  });
  it('never onboards a merchant automatically', async () => {
    const { provider, network } = setup({});
    expect((await provider.previewOrder({ ...product, onboardRequired: true }, intent, context())).status).toBe('needs-setup'); expect(network).not.toHaveBeenCalled();
  });
  it.each([401, 402, 429, 502, 422])('sanitizes HTTP %s without retry', async status => {
    const { provider, network } = setup({ error: 'private-token-do-not-return', message: 'secret' }, status);
    await expect(provider.searchProducts(intent, context())).rejects.not.toThrow('private-token'); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['false', 'true'])('always refuses execution even when env enabled=%s', async flag => {
    vi.stubEnv('SENTINEL_REAL_PURCHASES_ENABLED', flag); vi.stubEnv('SENTINEL_DEVELOPMENT_MODE', 'false');
    const { provider, network } = setup({}); expect(() => assertRealPurchasesEnabled()).toThrow('disabled'); await expect(provider.placeOrder()).rejects.toThrow('disabled'); expect(network).not.toHaveBeenCalled();
  });
  it.each(['http://example.com', 'https://localhost/', 'https://127.0.0.1/', 'https://user:password@example.com/', 'javascript:alert(1)'])('rejects unsafe display URL %s', url => expect(safePublicHttpsUrl(url)).toBeNull());
});
