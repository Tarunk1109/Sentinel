import 'server-only';
import { isOfficialShopifySandbox, isSandboxMerchant, OFFICIAL_SANDBOX_ITEMS } from '@/lib/domain/sandbox';
import { z } from 'zod';
import { AgnicProvider, safePublicHttpsUrl } from './agnic';
import { getAgnicToken } from '../config';
import { assertSandboxMerchant, getSandboxShipTo, getTestCardAlias } from '../safety';
import { ProviderError } from '../provider-error';
import { currencySchema, type Price, type ProductCandidate, type ProductIntent } from '@/lib/domain/commerce';
import type { ExploreResult, Merchant, ProviderOrder, SandboxDispatch } from '@/lib/domain/checkout';
import type { CallContext, CheckoutProvider } from '../services/live-contracts';

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
const merchantSchema = z.object({ id: identifier, name: z.string().max(1000), domain: z.string().max(1000), rail: z.string().max(100), is_test: z.boolean(), default_currency: z.string().max(10) });
const orderSchema = z.object({ id: identifier.optional(), order_id: identifier.optional(), merchant_id: identifier.nullish(), status: z.string().max(100), amount_minor: z.number().int().nonnegative().nullish(), amount_charged_minor: z.number().int().nonnegative().nullish(), currency: z.string().nullish(), order_url: z.string().nullish(), created_at: z.string().nullish(), test: z.boolean().optional(), retryable: z.boolean().nullable().optional(), retry_action: z.string().nullish(), error_code: z.string().nullish(), evidence: z.object({ charge_state: z.enum(['none', 'attempted', 'unknown', 'confirmed']).nullish(), billing_mode: z.string().max(100).nullish() }).passthrough().nullish() }).passthrough();
const cardsSchema = z.object({ cards: z.array(z.object({ id: z.string().min(1).max(300), last_four: z.string().regex(/^\d{4}$/), brand: z.string().max(40) }).passthrough()).max(50) }).passthrough();
const knownStatuses = new Set(['pending', 'dispatched', 'approval_required', 'succeeded', 'merchant_error', 'worker_error', 'price_changed', 'out_of_stock', 'payment_unconfirmed', 'payment_gate_hit', 'timeout', 'explored']);
function money(amount: number | null | undefined, currency: string | null | undefined): Price | null { const c = currencySchema.safeParse(currency); return amount != null && c.success ? { amountMinor: amount, currency: c.data } : null; }
function metadata(value: unknown): Merchant {
  const p = merchantSchema.safeParse(value);
  if (!p.success) throw new ProviderError('AGNIC_METADATA_INVALID', 'Agnic did not provide complete merchant safety metadata. Checkout remains blocked.');
  return { id: p.data.id, name: p.data.name, domain: p.data.domain, rail: p.data.rail, isTest: p.data.is_test, currency: p.data.default_currency };
}
function normalizeOrder(raw: unknown, fallbackId?: string): ProviderOrder {
  const p = orderSchema.safeParse(raw);
  if (!p.success || !(p.data.id || p.data.order_id || fallbackId)) throw new ProviderError('AGNIC_ORDER_INVALID', 'Agnic returned incomplete order status. Do not place the order again.');
  const o = p.data;
  if (fallbackId && (o.id ?? o.order_id ?? fallbackId) !== fallbackId) throw new ProviderError('ORDER_ID_MISMATCH', 'Agnic returned a different order. Stop and inspect the existing checkout.', 403);
  const link = safePublicHttpsUrl(o.order_url);
  // Only Agnic's stable evidence surface is exposed, never live_view_url.
  const safeLink = link && new URL(link).hostname === 'app.agnic.ai' && !new URL(link).search ? link : null;
  return { id: o.id ?? o.order_id ?? fallbackId!, merchantId: o.merchant_id ?? null, status: knownStatuses.has(o.status) ? o.status : 'unknown', approvedAmount: money(o.amount_minor, o.currency), chargedAmount: money(o.amount_charged_minor, o.currency), orderUrl: safeLink, timestamp: o.created_at && Number.isFinite(Date.parse(o.created_at)) ? new Date(o.created_at).toISOString() : null, test: o.test === true, retryable: o.retryable ?? null, retryAction: ['re_preview', 'poll', 'handoff', 'contact_support', 'none'].includes(o.retry_action ?? '') ? o.retry_action! : null, errorCode: o.error_code && /^[a-zA-Z0-9_]{1,100}$/.test(o.error_code) ? o.error_code : null, chargeState: o.evidence?.charge_state ?? null, billingMode: o.evidence?.billing_mode ?? null };
}

export class AgnicCheckoutProvider extends AgnicProvider implements CheckoutProvider {
  constructor(private readonly checkoutFetch: typeof fetch = fetch) { super(checkoutFetch); }
  async #send(path: string, context: CallContext, body?: object, timeout = 15000): Promise<unknown> {
    const allowedRead = /^\/api\/autofill\/(merchants|orders)\/[a-zA-Z0-9_-]{1,160}$/.test(path) || path === '/api/autofill/cards' || path === '/api/autofill/orders' || path.startsWith('/api/autofill/products/lookup?');
    const allowedWrite = path === '/api/autofill/explore' || path === '/api/autofill/dispatch';
    if (body ? !allowedWrite : !allowedRead) throw new ProviderError('OPERATION_DISABLED', 'This commerce operation is not enabled.', 403);
    const token = getAgnicToken();
    if (!token) throw new ProviderError('AGNIC_NOT_CONFIGURED', 'Agnic credential missing.', 503);
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(timeout)]);
    try {
      context.usage.agnicCalls++;
      const response = await this.checkoutFetch(`https://api.agnic.ai${path}`, { method: body ? 'POST' : 'GET', headers: { 'X-Agnic-Token': token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', cache: 'no-store', signal });
      if (response.status === 202 && path.endsWith('/dispatch')) {
        // Agnic holds a vaulted security code for about fifty minutes, then answers a
        // step-up instead of charging. Its own reason and hosted approval link are the
        // only way past it, so both are surfaced. The link is matched by shape rather
        // than by field name, and no token or credential is ever included.
        const detail = await response.json().catch(() => null) as Record<string, unknown> | null;
        const reason = ['error_code', 'error', 'reason', 'required', 'message', 'detail', 'status']
          .map(key => detail?.[key]).find((value): value is string => typeof value === 'string' && value.trim().length > 0);
        const approval = Object.values(detail ?? {}).find((value): value is string =>
          typeof value === 'string' && /^https:\/\/(app|checkout)\.agnic\.ai\//.test(value));
        const step = reason?.trim().slice(0, 120);
        throw new ProviderError('AGNIC_HOSTED_SETUP', `Agnic needs its hosted step-up before it will charge${step ? ` (${step})` : ''}. A vaulted security code is held for about fifty minutes, so re-enter it${approval ? ` at ${approval}` : ' in your hosted Agnic account'}, then start a new test checkout. This attempt is saved and is never repeated automatically.`, 409);
      }
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403 ? 'Agnic rejected the server credential. Check account access.' : response.status === 429 ? 'Agnic is rate limiting requests. Wait before checking this job again.' : response.status === 402 ? 'Agnic needs account or balance setup. SENTINEL will not pay or change limits.' : response.status === 409 ? 'Agnic refused the current amount, fulfillment or constraints. Obtain a new preview; do not repeat dispatch.' : response.status === 422 ? 'The selected SKU is unavailable. Select a current variant.' : response.status >= 500 ? 'Agnic returned a server error. Check the existing job or contact Agnic before trying again; SENTINEL made no automatic retry.' : 'Agnic rejected this operation. Check merchant and account setup before trying again.';
        throw new ProviderError(`AGNIC_HTTP_${response.status}`, message, response.status === 429 ? 429 : 502);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(signal.aborted ? 'AGNIC_TIMEOUT' : 'AGNIC_UNAVAILABLE', signal.aborted ? 'Agnic did not respond within the time limit. The job may still exist; do not repeat order placement.' : 'Agnic is unreachable. No automatic retry was made.', 504);
    }
  }
  async getMerchant(id: string, context: CallContext): Promise<Merchant> {
    if (!identifier.safeParse(id).success) throw new ProviderError('INVALID_MERCHANT', 'Invalid merchant identifier.', 400);
    const merchant = metadata(await this.#send(`/api/autofill/merchants/${id}`, context));
    if (merchant.id !== id) throw new ProviderError('MERCHANT_ID_MISMATCH', 'Agnic returned a different merchant. Checkout is blocked.', 403);
    return merchant;
  }
  async getSandboxProducts(context: CallContext) {
    // A replacement identity must come from Agnic, configured on the server.
    // Configuration selects a merchant; it never overrides its test status.
    const merchant = await this.getMerchant(process.env.SENTINEL_SANDBOX_MERCHANT_ID?.trim() || 'merchant_untitled_fidget_shop', context);
    if (!isSandboxMerchant(merchant)) return { merchant, products: [] };
    assertSandboxMerchant(merchant);
    if (isOfficialShopifySandbox(merchant)) {
      // Shopify quote resolves official variants directly; catalog_error metadata is
      // irrelevant for this documented rail. Availability and totals still need a live quote.
      const products: ProductCandidate[] = OFFICIAL_SANDBOX_ITEMS.map(item => ({
        id: item.sku, sku: item.sku, productGid: null, name: item.name, brand: null,
        description: 'Official Agnic sandbox variant. C$1 reference price; obtain a live quote.',
        merchantName: merchant.name, merchantId: merchant.id, merchantUrl: 'https://untitled-fidget.shop',
        productUrl: null, imageUrl: null, price: { amountMinor: 100, currency: 'CAD' },
        availability: item.sku.endsWith('43945235349570') ? 'unavailable' : 'available', country: 'CA', onboardRequired: false, metadata: { source: 'Agnic support-confirmed SKU' },
        compatibility: { status: 'NEEDS_VERIFICATION', reasons: [], missingInformation: ['Live quote required'] },
        requiredConstraintsSatisfied: null, score: 0, recommendation: 'Official sandbox item; not a live catalogue result.',
      }));
      return { merchant, products };
    }
    const intent: ProductIntent = { originalRequest: 'Official sandbox hex token fidget', searchQuery: 'hex token fidget', productType: 'fidget', quantity: 1, country: 'CA', budget: { maxAmount: 10, currency: 'CAD' }, requiredFeatures: [], preferredFeatures: [], excludedFeatures: [], compatibilityRequirements: [], brandPreferences: [], merchantPreferences: [], urgency: null };
    const products = (await this.searchProducts(intent, context)).filter(p => p.merchantId === merchant.id && p.price?.currency === 'CAD' && p.price.amountMinor <= 100 && p.availability === 'available');
    return { merchant, products };
  }
  async explore(product: ProductCandidate, intent: ProductIntent, context: CallContext): Promise<ExploreResult> {
    const url = safePublicHttpsUrl(product.onboardUrl ?? product.merchantUrl);
    if (!url || !product.merchantUrl || new URL(url).hostname !== new URL(product.merchantUrl).hostname) throw new ProviderError('MERCHANT_URL_INVALID', 'The merchant setup URL could not be verified.', 400);
    const raw = await this.#send('/api/autofill/explore', context, { merchant_url: url, goal: `Inspect checkout readiness for ${intent.quantity} × ${product.name}. Do not purchase.`, prefs: 'Inspect fulfillment options. Stop before payment.', currency: intent.budget.currency }, 125000);
    const p = z.object({ order_id: identifier.optional(), merchant_id: identifier.optional(), status: z.string().max(100).optional() }).safeParse(raw);
    if (!p.success || (!p.data.order_id && !p.data.merchant_id)) throw new ProviderError('EXPLORE_INCOMPLETE', 'Agnic did not return a merchant or exploration job ID. Check Agnic before starting another exploration.');
    return { orderId: p.data.order_id ?? null, merchantId: p.data.merchant_id ?? null, status: p.data.status ?? 'pending' };
  }
  async resolveProduct(product: ProductCandidate, context: CallContext): Promise<ProductCandidate> {
    const url = safePublicHttpsUrl(product.productUrl);
    if (!url) throw new ProviderError('PRODUCT_URL_REQUIRED', 'A verified product variant link is needed to resolve this merchant.');
    const raw = await this.#send(`/api/autofill/products/lookup?${new URLSearchParams({ url })}`, context);
    const p = z.object({ sku: z.string(), available: z.boolean(), merchant: z.object({ merchant_id: identifier.nullable(), domain: z.string() }) }).safeParse(raw);
    if (!p.success || p.data.sku !== product.sku || !product.merchantUrl || p.data.merchant.domain !== new URL(product.merchantUrl).hostname) throw new ProviderError('VARIANT_CHANGED', 'The merchant returned a different or unverified variant. Search again before quoting.');
    if (!p.data.available) throw new ProviderError('OUT_OF_STOCK', 'The selected variant is out of stock. Select another product.', 409);
    if (!p.data.merchant.merchant_id) throw new ProviderError('MERCHANT_NOT_READY', 'Agnic has not made this merchant quote-ready yet. Review the exploration job before trying again.', 409);
    return { ...product, merchantId: p.data.merchant.merchant_id, onboardRequired: false };
  }
  async getOrder(id: string, context: CallContext): Promise<ProviderOrder> {
    if (!identifier.safeParse(id).success) throw new ProviderError('INVALID_ORDER', 'Invalid order identifier.', 400);
    return normalizeOrder(await this.#send(`/api/autofill/orders/${id}`, context), id);
  }
  /** Read-only order history for this account, newest first. Agnic's list omits the
   *  charged amount, so each entry is read individually for its settled figure. */
  async listOrders(context: CallContext, limit = 25): Promise<ProviderOrder[]> {
    const parsed = z.object({ orders: z.array(orderSchema).max(200) }).passthrough().safeParse(await this.#send('/api/autofill/orders', context));
    if (!parsed.success) throw new ProviderError('AGNIC_ORDER_LIST_INVALID', 'Agnic did not return a readable order history.');
    const recent = parsed.data.orders
      .filter(order => order.id ?? order.order_id)
      .sort((a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''))
      .slice(0, limit);
    return Promise.all(recent.map(async order => {
      const id = (order.id ?? order.order_id)!;
      return this.getOrder(id, context).catch(() => normalizeOrder(order, id));
    }));
  }
  async getSandboxPaymentReadiness(context: CallContext) {
    const alias = getTestCardAlias();
    if (!alias) return { aliasFound: false, brand: null, lastFour: null };
    const parsed = cardsSchema.safeParse(await this.#send('/api/autofill/cards', context));
    if (!parsed.success) throw new ProviderError('AGNIC_CARDS_INVALID', 'Agnic did not return verifiable test-card metadata. Retry remains blocked.');
    const card = parsed.data.cards.find(candidate => candidate.id === alias);
    return { aliasFound: Boolean(card), brand: card?.brand.toLowerCase() ?? null, lastFour: card?.last_four ?? null };
  }
  async dispatchSandbox(input: SandboxDispatch, context: CallContext): Promise<ProviderOrder> {
    // Independently re-fetch immediately before the only network execution path.
    const merchant = await this.getMerchant(input.merchantId, context);
    assertSandboxMerchant(merchant);
    if (isOfficialShopifySandbox(merchant) && (!OFFICIAL_SANDBOX_ITEMS.some(item => item.sku === input.sku) || input.quantity !== 1)) throw new ProviderError('SANDBOX_VARIANT_REQUIRED', 'Only one official C$1 sandbox variant is allowed.', 403);
    const alias = getTestCardAlias();
    if (!alias) throw new ProviderError('TEST_CARD_REQUIRED', 'Configure a confirmed test-card alias through Agnic’s hosted setup first. The default or a real card will never be used.', 409);
    if (input.confirmationText !== 'Confirm Test Purchase' || !Number.isFinite(Date.parse(input.approvedAt))) throw new ProviderError('TEST_CONSENT_REQUIRED', 'Explicit test-purchase confirmation is required.', 403);
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 10 || !Number.isSafeInteger(input.amount.amountMinor) || !Number.isSafeInteger(input.maxTotalMinor) || input.maxTotalMinor < 0 || input.amount.amountMinor > input.maxTotalMinor || input.amount.amountMinor < 0 || input.amount.currency !== merchant.currency) throw new ProviderError('BUDGET_EXCEEDED', 'The sandbox checkout has an invalid amount, quantity, currency or limit.', 409);
    // The destination is released only for a fulfillment option that needs one.
    const shipTo = isOfficialShopifySandbox(merchant) && input.deliveryRequired ? getSandboxShipTo() : null;
    return normalizeOrder(await this.#send('/api/autofill/dispatch', context, { merchant_id: input.merchantId, items: [{ sku: input.sku, quantity: input.quantity }], amount_minor: input.amount.amountMinor, currency: input.amount.currency, card_alias_id: alias, user_confirmation_text: input.confirmationText, user_approved_at_iso: input.approvedAt, user_prompt: input.originalRequest, constraints: { max_total_minor: input.maxTotalMinor }, ...(input.fulfillmentId ? { fulfillment_option_id: input.fulfillmentId } : {}), ...(shipTo ? { ship_to: shipTo } : {}) }));
  }
}
