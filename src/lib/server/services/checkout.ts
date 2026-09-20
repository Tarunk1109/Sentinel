import 'server-only';
import { isSandboxMerchant, isOfficialShopifySandbox } from '@/lib/domain/sandbox';
import { createHash, randomUUID } from 'node:crypto';
import { AUTHORIZED_RETRY_ORDER_ID, type AuthorizedRetryConsent, type CheckoutSession, type Merchant, type SandboxConsent, type SandboxInfo } from '@/lib/domain/checkout';
import type { ProductCandidate, ProductIntent, SafePreview } from '@/lib/domain/commerce';
import type { CallContext, CheckoutProvider } from './live-contracts';
import { assertSandboxMerchant, getTestCardAlias } from '../safety';
import { ProviderError, publicError } from '../provider-error';
import { DispatchJournal } from '../dispatch-journal';

const context = (signal: AbortSignal): CallContext => ({ signal, usage: { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 } });
type Selection = { product: ProductCandidate; intent: ProductIntent };
type Entry = { owner: string; state: CheckoutSession; intent: ProductIntent; expires: number; exploreAttempted: boolean; exploreId: string | null; started: number; lastPoll: number; dispatched: boolean; dispatchAttemptId: string | null; fulfillmentId?: string; retryOfOrderId?: string };
function sandboxAttemptId(owner: string, merchantId: string, sku: string): string {
  // Keep the durable claim stable across checkout expiry and process restarts, without exposing the owner.
  const hash = createHash('sha256').update(JSON.stringify(['sandbox-dispatch-v1', owner, merchantId, sku])).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}
const setup = () => ({ testCardConfigured: Boolean(getTestCardAlias()), cardSetupUrl: 'https://app.agnic.ai/partner/cards/new', profileSetupUrl: 'https://app.agnic.ai', guideUrl: 'https://docs.agnic.ai/docs/agentic-commerce/testing' });
const terminalMessages: Record<string, string> = {
  merchant_error: 'The merchant could not complete checkout. Review the existing order with Agnic; no second dispatch was sent.',
  worker_error: 'The checkout gateway reported an error. Check the saved order; do not resubmit.',
  price_changed: 'The checkout price changed. SENTINEL will not increase your approved amount. Review the order outcome before requesting a new quote.',
  out_of_stock: 'The selected item is now out of stock. No replacement was purchased.',
  payment_unconfirmed: 'Payment confirmation is uncertain. Do not submit another order; inspect the existing checkout evidence.',
  payment_gate_hit: 'The test payment was declined or requires a hosted payment step. Inspect the existing order in Agnic.',
  timeout: 'The checkout timed out. Its outcome is not assumed to be success. Do not dispatch again.',
};
export class CheckoutService {
  private entries = new Map<string, Entry>();
  private selections = new Map<string, string>();
  private jobs = new Map<string, Promise<CheckoutSession>>();
  private sandbox: { value: SandboxInfo; expires: number } | null = null;
  constructor(private readonly provider: CheckoutProvider, private readonly select: (owner: string, missionId: string, productId: string) => Selection, private readonly journal: Pick<DispatchJournal, 'claim' | 'record' | 'verifyAuthorizedRetry' | 'claimAuthorizedRetry' | 'recordAuthorizedRetry'> = new DispatchJournal()) {}
  private entry(owner: string, id: string): Entry {
    const e = this.entries.get(id);
    if (!e || e.owner !== owner || e.expires < Date.now()) throw new ProviderError('CHECKOUT_EXPIRED', 'This checkout session expired or belongs to another session. Start from the product selection. Never repeat an existing order.', 409);
    return e;
  }
  private view(e: Entry): CheckoutSession { return structuredClone({ ...e.state, setup: setup() }); }
  private create(owner: string, selection: Selection, sandbox = false): CheckoutSession {
    for (const [id,e] of this.entries) if (e.expires < Date.now()) this.entries.delete(id);
    if (this.entries.size >= 80) throw new ProviderError('CHECKOUT_BUSY', 'Too many active checkout sessions. Finish an existing session first.', 429);
    const state: CheckoutSession = { id: randomUUID(), mode: sandbox ? 'SANDBOX_COMMERCE_MODE' : 'REAL_COMMERCE_MODE', product: selection.product, quantity: selection.intent.quantity, stage: 'selected', message: 'Review your selection. Merchant preparation and price checks do not purchase anything.', merchant: null, preview: null, quoteId: null, quoteExpiresAt: null, order: null, approvedAt: null, retryOfOrderId: null, canConfirm: false, setup: setup() };
    this.entries.set(state.id, { owner, state, intent: selection.intent, expires: Date.now() + 30 * 60_000, exploreAttempted: false, exploreId: null, started: 0, lastPoll: 0, dispatched: false, dispatchAttemptId: null }); return structuredClone(state);
  }
  begin(owner: string, missionId: string, productId: string): CheckoutSession {
    const key = `${owner}:${missionId}:${productId}`;
    const prior = this.selections.get(key);
    if (prior && this.entries.get(prior)?.expires && this.entries.get(prior)!.expires > Date.now()) return this.view(this.entry(owner, prior));
    const state = this.create(owner, this.select(owner, missionId, productId));
    if (this.selections.size >= 100) this.selections.delete(this.selections.keys().next().value!);
    this.selections.set(key, state.id); return state;
  }
  async sandboxCatalog(signal: AbortSignal): Promise<SandboxInfo> {
    if (this.sandbox && this.sandbox.expires > Date.now()) return structuredClone(this.sandbox.value);
    const { merchant, products } = await this.provider.getSandboxProducts(context(signal));
    const value = { merchant, products, blocked: !isSandboxMerchant(merchant) || !products.length, message: !isSandboxMerchant(merchant) ? 'Sandbox blocked: merchant safety identity is not verified.' : !products.length ? 'No test products available.' : isOfficialShopifySandbox(merchant) ? 'Official Shopify gateway sandbox. Agnic is_test remains false by design; only the support-confirmed C$1 variants and a confirmed vaulted test card are allowed. Obtain a live quote.' : 'Official test merchant verified by Agnic. Select a test product to prepare a quote.' };
    this.sandbox = { value, expires: Date.now() + 60_000 }; return structuredClone(value);
  }
  async beginSandbox(owner: string, productId: string, signal: AbortSignal): Promise<CheckoutSession> {
    const catalog = await this.sandboxCatalog(signal);
    assertSandboxMerchant(catalog.merchant);
    const product = catalog.products.find(p => p.id === productId);
    if (!product || product.availability !== 'available' || catalog.blocked) throw new ProviderError('SANDBOX_PRODUCT_UNAVAILABLE', 'Select an available product from the server-verified test catalogue.', 409);
    const intent: ProductIntent = { originalRequest: `Test checkout: ${product.name}`, searchQuery: 'official test item', productType: 'test item', quantity: 1, budget: { maxAmount: 20, currency: 'CAD' }, country: 'CA', requiredFeatures: [], preferredFeatures: [], excludedFeatures: [], compatibilityRequirements: [], brandPreferences: [], merchantPreferences: [], urgency: null };
    const key = `${owner}:sandbox:${productId}`;
    const prior = this.selections.get(key);
    if (prior && this.entries.get(prior) && this.entries.get(prior)!.expires > Date.now()) return this.view(this.entry(owner, prior));
    const state = this.create(owner, { product, intent }, true); this.selections.set(key, state.id); return state;
  }
  /** Runs the non-purchase sandbox setup in one invocation so serverless routing
   * cannot lose an in-memory checkout between prepare, fulfillment and quote. */
  async autoQuoteSandbox(owner: string, productId: string, signal: AbortSignal): Promise<CheckoutSession> {
    // A hosted page may retain a cookie after a prior dispatch. A fresh preview
    // must never inherit that attempted order. Its explicit confirmation gets
    // a new dispatch token; the journal protects that token from retries.
    this.selections.delete(`${owner}:sandbox:${productId}`);
    let state = await this.beginSandbox(owner, productId, signal);
    state = await this.prepare(owner, state.id, signal);
    if (state.stage === 'exploring') return state;
    state = await this.quote(owner, state.id, signal);
    if (state.stage !== 'fulfillment') return state;
    const standard = state.preview?.fulfillmentOptions?.find(option => option.title === 'Standard');
    if (!standard) throw new ProviderError('STANDARD_FULFILLMENT_REQUIRED', 'The verified sandbox checkout did not return Standard delivery. No purchase was prepared.', 409);
    return this.quote(owner, state.id, signal, standard.id);
  }
  async autoConfirmSandbox(owner: string, productId: string, attemptId: string, signal: AbortSignal): Promise<CheckoutSession> {
    const quoted = await this.autoQuoteSandbox(owner, productId, signal);
    if (quoted.stage !== 'quoted' || !quoted.quoteId || !quoted.canConfirm) throw new ProviderError('CONSENT_INVALID', 'A fresh complete sandbox quote is required before confirmation.', 409);
    return this.confirm(owner, { checkoutId: quoted.id, quoteId: quoted.quoteId, confirmed: true, confirmationText: 'Confirm Test Purchase' }, signal, attemptId);
  }
  async sandboxOrderStatus(productId: string, orderId: string, signal: AbortSignal): Promise<CheckoutSession> {
    const catalog = await this.sandboxCatalog(signal); assertSandboxMerchant(catalog.merchant);
    const product = catalog.products.find(item => item.id === productId);
    if (!product) throw new ProviderError('SANDBOX_PRODUCT_UNAVAILABLE', 'This sandbox product is no longer available.', 409);
    const order = await this.provider.getOrder(orderId, context(signal));
    const succeeded = order.status === 'succeeded' && (order.test || isOfficialShopifySandbox(catalog.merchant));
    const stage: CheckoutSession['stage'] = succeeded ? 'succeeded' : ['pending', 'dispatched'].includes(order.status) ? 'processing' : terminalMessages[order.status] ? 'failed' : 'unknown';
    return { id: randomUUID(), mode: 'SANDBOX_COMMERCE_MODE', product, quantity: 1, stage, message: succeeded ? 'Agnic confirms the test order succeeded. No real money moved and no real goods will ship.' : stage === 'processing' ? 'Test order is processing. SENTINEL is reading the existing Agnic order only.' : 'Agnic returned a non-successful status for the existing test order.', merchant: catalog.merchant, preview: null, quoteId: null, quoteExpiresAt: null, order, approvedAt: null, retryOfOrderId: null, canConfirm: false, setup: setup() };
  }
  private billingProfileVerified(): boolean {
    return process.env.SENTINEL_AGNIC_AUTHORIZED_RETRY_ORDER_ID === AUTHORIZED_RETRY_ORDER_ID && process.env.SENTINEL_AGNIC_BILLING_PROFILE_CONFIRMED === 'true';
  }
  private async verifiedRetry(signal: AbortSignal) {
    if (!this.billingProfileVerified()) throw new ProviderError('AUTHORIZED_RETRY_NOT_CONFIGURED', 'The exact provider authorization and billing-profile confirmation are not configured. Retry remains blocked.', 403);
    const [previous, payment] = await Promise.all([
      this.provider.getOrder(AUTHORIZED_RETRY_ORDER_ID, context(signal)),
      this.provider.getSandboxPaymentReadiness(context(signal)),
    ]);
    await this.journal.verifyAuthorizedRetry(previous, true, payment);
    return { previous, payment };
  }
  async beginAuthorizedRetry(owner: string, previousOrderId: string, signal: AbortSignal): Promise<CheckoutSession> {
    if (previousOrderId !== AUTHORIZED_RETRY_ORDER_ID) throw new ProviderError('AUTHORIZED_RETRY_FORBIDDEN', 'This order has no provider-authorized retry.', 403);
    await this.verifiedRetry(signal);
    const catalog = await this.sandboxCatalog(signal);
    assertSandboxMerchant(catalog.merchant);
    const sku = 'gid://shopify/ProductVariant/43945255567426';
    const product = catalog.products.find(candidate => candidate.sku === sku);
    if (!product || product.availability !== 'available' || catalog.blocked) throw new ProviderError('SANDBOX_PRODUCT_UNAVAILABLE', 'The provider-authorized retry product is not currently available.', 409);
    const intent: ProductIntent = { originalRequest: `Provider-authorized sandbox retry of ${previousOrderId}: Paw Print Charm`, searchQuery: 'Paw Print Charm', productType: 'test item', quantity: 1, budget: { maxAmount: 14.95, currency: 'CAD' }, country: 'CA', requiredFeatures: [], preferredFeatures: [], excludedFeatures: [], compatibilityRequirements: [], brandPreferences: [], merchantPreferences: [], urgency: null };
    const state = this.create(owner, { product, intent }, true);
    const entry = this.entry(owner, state.id);
    entry.retryOfOrderId = previousOrderId;
    entry.state.retryOfOrderId = previousOrderId;
    entry.state.message = 'Agnic support-authorized retry prepared. Obtain and review a fresh Standard-delivery quote before the one allowed retry.';
    return this.view(entry);
  }
  private async job(e: Entry, operation: () => Promise<void>): Promise<CheckoutSession> {
    const running = this.jobs.get(e.state.id); if (running) return running;
    const job = Promise.resolve().then(operation).then(() => this.view(e)).finally(() => this.jobs.delete(e.state.id));
    this.jobs.set(e.state.id, job); return job;
  }
  private async merchantReady(e: Entry, signal: AbortSignal): Promise<Merchant> {
    if (!e.state.product.merchantId || e.state.product.onboardRequired) e.state.product = await this.provider.resolveProduct(e.state.product, context(signal));
    const merchant = await this.provider.getMerchant(e.state.product.merchantId!, context(signal));
    if (!e.state.product.merchantUrl || merchant.domain !== new URL(e.state.product.merchantUrl).hostname) throw new ProviderError('MERCHANT_MISMATCH', 'The prepared merchant does not match the selected product.', 403);
    if (merchant.rail !== 'shopify') throw new ProviderError('QUOTE_RAIL_UNSUPPORTED', 'This merchant is not on the supported Shopify pricing rail. Choose another merchant.', 409);
    e.state.merchant = merchant; return merchant;
  }
  async prepare(owner: string, id: string, signal: AbortSignal): Promise<CheckoutSession> {
    const e = this.entry(owner,id);
    if (e.dispatched) return this.view(e);
    return this.job(e, async () => {
      e.state.canConfirm = false; e.state.quoteId = null; e.state.quoteExpiresAt = null; e.state.preview = null;
      if (!e.state.product.onboardRequired && e.state.product.merchantId) {
        await this.merchantReady(e,signal); e.state.stage = 'ready'; e.state.message = 'Merchant is already ready for a safe price check.'; return;
      }
      if (e.exploreAttempted) {
        if (!e.exploreId) throw new ProviderError('EXPLORE_OUTCOME_UNKNOWN', 'The earlier preparation may still exist at Agnic. Check with Agnic before starting another; no duplicate exploration was sent.', 409);
        e.started = Date.now(); e.state.stage = 'exploring'; e.state.message = 'Checking the existing exploration job. No new exploration was started.'; return;
      }
      e.exploreAttempted = true; e.started = Date.now(); e.state.stage = 'exploring'; e.state.message = 'Preparing merchant — this can take up to approximately 2 minutes.';
      try {
        const result = await this.provider.explore(e.state.product,e.intent,context(signal));
        e.exploreId = result.orderId;
        if (result.status === 'explored' || (!result.orderId && result.merchantId)) {
          await this.merchantReady(e,signal); e.state.stage = 'ready'; e.state.message = 'Merchant prepared and selected variant resolved. Ready to check the live price.';
        } else if (!result.orderId) throw new ProviderError('EXPLORE_INCOMPLETE', 'Preparation returned no trackable job. Check Agnic before retrying.');
      } catch (error) { e.state.stage = 'blocked'; e.state.message = publicError(error).message; throw error; }
    });
  }
  async quote(owner: string, id: string, signal: AbortSignal, fulfillmentId?: string): Promise<CheckoutSession> {
    const e = this.entry(owner,id);
    if (e.dispatched) return this.view(e);
    return this.job(e, async () => {
      if (e.state.product.onboardRequired) throw new ProviderError('MERCHANT_PREPARATION_REQUIRED', 'Prepare the selected merchant before checking its price.', 409);
      if (fulfillmentId && !e.state.preview?.fulfillmentOptions?.some(o => o.id === fulfillmentId)) throw new ProviderError('FULFILLMENT_INVALID', 'Select a fulfillment option returned by the current merchant quote.', 400);
      e.state.canConfirm = false; e.state.quoteId = null; e.state.quoteExpiresAt = null;
      await this.merchantReady(e, signal);
      const preview = await this.provider.previewOrder(e.state.product,e.intent,context(signal),fulfillmentId);
      e.state.preview = preview;
      e.fulfillmentId = fulfillmentId ?? preview.selectedFulfillmentId ?? undefined;
      e.state.stage = preview.requiresFulfillment ? 'fulfillment' : preview.status === 'quoted' ? 'quoted' : 'blocked';
      e.state.message = preview.budgetViolation ? 'Purchase blocked: checkout exceeds your original budget. Edit the request to set new constraints; SENTINEL will not silently raise them.' : preview.message;
      if (preview.status === 'quoted' && preview.amount && !preview.requiresFulfillment) {
        e.state.quoteId = randomUUID(); e.state.quoteExpiresAt = new Date(Date.now() + 5*60_000).toISOString();
        e.state.canConfirm = e.state.mode === 'SANDBOX_COMMERCE_MODE' && isSandboxMerchant(e.state.merchant) && Boolean(getTestCardAlias());
      }
    });
  }
  async refresh(owner: string, id: string, signal: AbortSignal): Promise<CheckoutSession> {
    const e = this.entry(owner,id);
    if (this.jobs.has(id)) return this.view(e);
    if (Date.now() - e.lastPoll < 5000) return this.view(e);
    const exploring = e.state.stage === 'exploring' && e.exploreId;
    const manualOrderCheck = ['timed-out', 'unknown', 'blocked'].includes(e.state.stage) && e.state.order;
    const processing = (e.state.stage === 'processing' || manualOrderCheck) && e.state.order;
    if (!exploring && !processing) return this.view(e);
    const timeout = exploring ? 180000 : 240000;
    if (!manualOrderCheck && Date.now() - e.started > timeout) { e.state.stage = 'timed-out'; e.state.message = exploring ? 'Preparation exceeded the polling window. Prepare Merchant will check the same job again; it will not start another exploration.' : 'Automatic order tracking timed out. Check Existing Status will read this saved order once; it will never submit another purchase.'; return this.view(e); }
    e.lastPoll = Date.now();
    return this.job(e, async () => {
      const order = await this.provider.getOrder(exploring ? e.exploreId! : e.state.order!.id,context(signal));
      if (exploring) {
        if (order.status === 'explored') { await this.merchantReady(e,signal); e.state.stage = 'ready'; e.state.message = 'Merchant preparation completed. The selected variant is ready for a price check.'; }
        else if (terminalMessages[order.status] || order.status === 'unknown' || order.status === 'succeeded') { e.state.stage = 'blocked'; e.state.message = 'Merchant exploration did not return a confirmed explored state. Inspect Agnic setup before continuing.'; }
        return;
      }
      if (order.merchantId && order.merchantId !== e.state.merchant?.id) throw new ProviderError('ORDER_MERCHANT_MISMATCH', 'Order metadata does not match the approved test merchant. Stop and contact Agnic.', 403);
      e.state.order = { ...order, orderUrl: order.orderUrl ?? e.state.order?.orderUrl ?? null };
      if (order.status === 'succeeded' && (order.test === true || isOfficialShopifySandbox(e.state.merchant))) { e.state.stage = 'succeeded'; e.state.message = 'Agnic confirms the test order succeeded. No real money moved and no real goods will ship.'; }
      else if (order.status === 'succeeded' || order.status === 'unknown') { e.state.stage = 'unknown'; e.state.message = 'The provider did not supply a verified test success. Inspect the existing order; no receipt was fabricated.'; }
      else if (terminalMessages[order.status]) { e.state.stage = 'failed'; e.state.message = ['payment_declined', 'card_declined', 'test_card_declined'].includes(order.errorCode ?? '') ? 'The test payment was declined. Check the configured test card in Agnic; this order will not be dispatched again.' : terminalMessages[order.status]; }
      else if (order.status === 'approval_required') { e.state.stage = 'blocked'; e.state.message = 'Agnic requires hosted setup or approval. Inspect the existing order; do not dispatch again.'; }
      if (e.retryOfOrderId) await this.journal.recordAuthorizedRetry(e.retryOfOrderId,order.id,order.status);
      else await this.journal.record(e.dispatchAttemptId!,order.id,order.status);
    });
  }
  async confirm(owner: string, input: SandboxConsent, signal: AbortSignal, confirmationAttemptId?: string): Promise<CheckoutSession> {
    const e = this.entry(owner,input.checkoutId);
    if (e.state.mode !== 'SANDBOX_COMMERCE_MODE') throw new ProviderError('REAL_PURCHASES_DISABLED', 'Real purchasing is disabled. This selection cannot be dispatched.', 403);
    if (e.dispatched) return this.view(e);
    return this.job(e, async () => {
      if (input.confirmed !== true || input.confirmationText !== 'Confirm Test Purchase' || input.quoteId !== e.state.quoteId || !e.state.quoteExpiresAt || Date.parse(e.state.quoteExpiresAt) <= Date.now() || e.state.stage !== 'quoted') throw new ProviderError('CONSENT_INVALID', 'Confirm a fresh, complete test quote before proceeding.', 409);
      const merchant = await this.merchantReady(e,signal); assertSandboxMerchant(merchant);
      if (!getTestCardAlias()) throw new ProviderError('TEST_CARD_REQUIRED', 'Set up and explicitly configure a test-card alias using Agnic’s hosted page. SENTINEL will not use the default card.', 409);
      const approved = e.state.preview;
      const fresh = await this.provider.previewOrder(e.state.product,e.intent,context(signal),e.fulfillmentId);
      if (!this.sameQuote(approved,fresh)) { e.state.preview = fresh; e.state.quoteId = null; e.state.quoteExpiresAt = null; e.state.canConfirm = false; e.state.stage = 'blocked'; e.state.message = 'Quote changed since review. Check the updated price and obtain a new confirmation.'; return; }
      const amount = fresh.amount!;
      // Each explicit interactive consent receives one token. Reusing it is
      // blocked durably; a later fresh quote and consent is a separate order.
      const attemptId = confirmationAttemptId ?? sandboxAttemptId(e.owner,merchant.id,e.state.product.sku);
      await this.journal.claim(attemptId);
      // Mark once BEFORE any execution. Unknown outcomes may never be retried.
      e.dispatchAttemptId = attemptId; e.dispatched = true; e.state.canConfirm = false; e.state.stage = 'dispatching'; e.state.approvedAt = new Date().toISOString(); e.started = Date.now();
      try {
        const order = await this.provider.dispatchSandbox({ merchantId: merchant.id, sku: e.state.product.sku, quantity: e.intent.quantity, amount, maxTotalMinor: Math.floor(e.intent.budget.maxAmount! * 100), fulfillmentId: e.fulfillmentId, approvedAt: e.state.approvedAt, confirmationText: input.confirmationText, originalRequest: e.intent.originalRequest },context(signal));
        e.state.order = order; e.state.stage = 'processing'; e.state.message = 'Test order dispatched once. Merchant checkout processing; only order status will be polled.';
        await this.journal.record(attemptId,order.id,order.status);
      } catch (error) { e.state.stage = 'unknown'; e.state.message = publicError(error).message + ' This dispatch attempt is saved and cannot be repeated.'; await this.journal.record(attemptId,e.state.order?.id ?? null,'unknown'); }
    });
  }
  async confirmAuthorizedRetry(owner: string, input: AuthorizedRetryConsent, signal: AbortSignal): Promise<CheckoutSession> {
    const e = this.entry(owner, input.checkoutId);
    if (e.retryOfOrderId !== AUTHORIZED_RETRY_ORDER_ID || input.previousOrderId !== e.retryOfOrderId) throw new ProviderError('AUTHORIZED_RETRY_FORBIDDEN', 'This checkout is not the exact provider-authorized retry.', 403);
    if (e.dispatched) return this.view(e);
    return this.job(e, async () => {
      if (input.confirmed !== true || input.confirmationText !== 'Confirm Provider-Authorized Test Retry' || input.quoteId !== e.state.quoteId || !e.state.quoteExpiresAt || Date.parse(e.state.quoteExpiresAt) <= Date.now() || e.state.stage !== 'quoted') throw new ProviderError('CONSENT_INVALID', 'Confirm the fresh provider-authorized test quote before proceeding.', 409);
      const merchant = await this.merchantReady(e, signal); assertSandboxMerchant(merchant);
      const { previous, payment } = await this.verifiedRetry(signal);
      const approved = e.state.preview;
      const fresh = await this.provider.previewOrder(e.state.product, e.intent, context(signal), e.fulfillmentId);
      const standard = fresh.fulfillmentOptions?.find(option => option.id === fresh.selectedFulfillmentId);
      if (!this.sameQuote(approved, fresh) || !fresh.amount || fresh.amount.currency !== 'CAD' || fresh.amount.amountMinor > 1495 || standard?.title !== 'Standard') {
        e.state.preview = fresh; e.state.quoteId = null; e.state.quoteExpiresAt = null; e.state.canConfirm = false; e.state.stage = 'blocked'; e.state.message = 'The fresh Standard-delivery quote changed or exceeds C$14.95. The retry was not claimed or dispatched.'; return;
      }
      await this.journal.claimAuthorizedRetry(previous, true, payment);
      e.dispatchAttemptId = `provider-authorized-retry-${previous.id}`; e.dispatched = true; e.state.canConfirm = false; e.state.stage = 'dispatching'; e.state.approvedAt = new Date().toISOString(); e.started = Date.now();
      try {
        const order = await this.provider.dispatchSandbox({ merchantId: merchant.id, sku: e.state.product.sku, quantity: 1, amount: fresh.amount, maxTotalMinor: 1495, fulfillmentId: e.fulfillmentId, approvedAt: e.state.approvedAt, confirmationText: 'Confirm Test Purchase', originalRequest: e.intent.originalRequest }, context(signal));
        e.state.order = order; e.state.stage = 'processing'; e.state.message = 'The single provider-authorized sandbox retry was dispatched. Only this new order status may now be polled.';
        await this.journal.recordAuthorizedRetry(previous.id, order.id, order.status);
      } catch (error) {
        e.state.stage = 'unknown'; e.state.message = publicError(error).message + ' The provider-authorized retry is permanently consumed and cannot run again.';
        await this.journal.recordAuthorizedRetry(previous.id, e.state.order?.id ?? null, 'unknown');
      }
    });
  }
  private sameQuote(a: SafePreview | null, b: SafePreview): boolean {
    return a?.status === 'quoted' && b.status === 'quoted' && !b.requiresFulfillment && !b.budgetViolation && Boolean(a.amount && b.amount) && a.amount?.amountMinor === b.amount?.amountMinor && a.amount?.currency === b.amount?.currency && a.amountIsFinal === b.amountIsFinal && a.quantity === b.quantity && a.selectedFulfillmentId === b.selectedFulfillmentId && JSON.stringify(a.shipping) === JSON.stringify(b.shipping) && JSON.stringify(a.subtotal) === JSON.stringify(b.subtotal);
  }
}
