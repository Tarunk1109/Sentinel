import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { currencySchema, type Price, type ProductCandidate, type ProductIntent, type SafePreview } from "@/lib/domain/commerce";
import { getAgnicToken } from "@/lib/server/config";
import { ProviderError } from "@/lib/server/provider-error";
import { assertRealPurchasesEnabled, getSandboxShipTo } from "@/lib/server/safety";
import type { CallContext, CommerceProvider } from "@/lib/server/services/live-contracts";

// Verified against https://docs.agnic.ai/docs/api-reference/checkout.
// Product search and Shopify quote are non-charging. No transaction route exists here.
const AGNIC_ORIGIN = "https://api.agnic.ai";
const SEARCH_PATH = "/api/autofill/products/search";
const QUOTE_PATH = "/api/autofill/shopify/quote";
const text = z.string().max(2000);
const productSchema = z.object({
  sku: z.string().min(1).max(160),
  product_gid: text.nullish(),
  title: z.string().min(1).max(1000),
  vendor: text.nullish(),
  price_minor: z.unknown().optional(),
  currency: z.unknown().optional(),
  available: z.boolean().nullish(),
  image_url: text.nullish(),
  product_url: text.nullish(),
  merchant: z.object({ name: text, domain: text, merchant_id: text.nullish() }).passthrough(),
  onboard: z.object({ merchant_url: text }).passthrough().nullish(),
}).passthrough();
const searchSchema = z.object({ products: z.array(productSchema).max(100) }).passthrough();
const fulfillmentSchema = z.object({ id: text, type: text.optional(), title: text.optional(), description: text.optional(), requires_address: z.boolean().optional(), eta: text.optional(), price_minor: z.unknown().optional(), currency: z.unknown().optional() }).passthrough();
const quoteSchema = z.object({
  rail: z.literal("shopify"),
  fulfillment_options: z.array(fulfillmentSchema).max(100).optional(),
  requires_fulfillment_choice: z.boolean().optional(),
  selected_option_id: text.nullish(),
  expected_amount_minor: z.unknown().optional(),
  amount_is_final: z.boolean().optional(),
  subtotal_minor: z.unknown().optional(),
  currency: z.unknown().optional(),
  billing_uses_ship_to: z.boolean().optional(),
  unfulfillable: z.object({ reason: text.optional() }).passthrough().nullish(),
}).passthrough();

function price(amount: unknown, currency: unknown): Price | null {
  const parsedCurrency = currencySchema.safeParse(currency);
  return typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0 && parsedCurrency.success
    ? { amountMinor: amount, currency: parsedCurrency.data }
    : null;
}

/** Product URLs are display-only; the server never follows merchant/image links. */
export function safePublicHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (!host.includes(".") || isIP(host) || host.startsWith("[") || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test)$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}

function invalidResponse(): ProviderError {
  return new ProviderError("AGNIC_INVALID_RESPONSE", "Agnic returned product or price data that could not be verified. No order was placed.");
}

class BudgetQuoteError extends ProviderError {
  constructor(readonly total: number | null) { super('AGNIC_BUDGET_EXCEEDED', 'The checkout exceeds your original budget. No purchase is allowed.', 409); }
}
async function responseError(response: Response): Promise<ProviderError> {
  // Only an explicitly recognised error code influences a fixed public message.
  let code: unknown;
  let total: number | null = null;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      code = body.error;
      if ('expected_amount_minor' in body && typeof body.expected_amount_minor === 'number' && Number.isSafeInteger(body.expected_amount_minor) && body.expected_amount_minor >= 0) total = body.expected_amount_minor;
    }
  } catch { /* Provider bodies, headers and details are never disclosed. */ }
  if (response.status === 401 || response.status === 403) return new ProviderError("AGNIC_AUTH_REQUIRED", "Agnic rejected the server credential. Check the Agnic account configuration.", 503);
  if (response.status === 402) return new ProviderError("AGNIC_PAYMENT_REQUIRED", "Agnic requested payment or account setup. SENTINEL stopped without paying.", 503);
  if (response.status === 429) return new ProviderError("AGNIC_RATE_LIMITED", "Agnic is rate limiting requests. Wait a moment before trying again.", 429);
  if (response.status === 422) return new ProviderError("AGNIC_UNKNOWN_SKU", "The selected variant could not be quoted. Search again and select an available product.", 422);
  if (code === "unsupported_country") return new ProviderError("AGNIC_UNSUPPORTED_COUNTRY", "Agnic product search supports Canada, the US, the UK and Australia.", 400);
  if (code === "constraint_total_exceeded" || code === "constraint_shipping_exceeded") return new BudgetQuoteError(total);
  if (code === "setup_required" || code === "ship_to_invalid") return new ProviderError("AGNIC_SETUP_REQUIRED", "Agnic needs account or delivery setup before this product can be quoted.", 409);
  if (response.status === 409) return new ProviderError("AGNIC_QUOTE_UNAVAILABLE", "Agnic could not verify fulfillment or the requested spending limits. No order was placed.", 409);
  return new ProviderError("AGNIC_UNAVAILABLE", "Agnic could not complete this request. This does not mean the product does not exist. Try again later.");
}

export class AgnicProvider implements CommerceProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  // ECMAScript-private and runtime-allowlisted: no caller-controlled endpoint or method.
  async #request(path: typeof SEARCH_PATH | typeof QUOTE_PATH, context: CallContext, query?: URLSearchParams, body?: object): Promise<unknown> {
    if ((path !== SEARCH_PATH && path !== QUOTE_PATH) || (path === SEARCH_PATH && body !== undefined) || (path === QUOTE_PATH && (body === undefined || query !== undefined))) {
      throw new ProviderError("AGNIC_OPERATION_DISABLED", "This Agnic operation is unavailable in development mode.", 403);
    }
    const token = getAgnicToken();
    if (!token) throw new ProviderError("AGNIC_NOT_CONFIGURED", "Add an Agnic API token to the server configuration to search live products.", 503);
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(15000)]);
    if (signal.aborted) throw new ProviderError("AGNIC_CANCELLED", "The request was cancelled. No order was placed.", 499);
    const url = new URL(path, AGNIC_ORIGIN);
    if (query) url.search = query.toString();
    try {
      context.usage.agnicCalls += 1;
      const response = await this.fetcher(url, {
        method: path === SEARCH_PATH ? "GET" : "POST",
        headers: { "X-Agnic-Token": token, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal,
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) throw await responseError(response);
      try { return await response.json(); } catch { throw invalidResponse(); }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) {
        throw new ProviderError("AGNIC_TIMEOUT", "The Agnic request timed out or was cancelled. No order was placed.", 504);
      }
      throw new ProviderError("AGNIC_UNAVAILABLE", "Agnic could not be reached. No order was placed. Please try again later.");
    }
  }

  async searchProducts(intent: ProductIntent, context: CallContext): Promise<ProductCandidate[]> {
    const raw = await this.#request(SEARCH_PATH, context, new URLSearchParams({ q: intent.searchQuery, country: intent.country, limit: "10" }));
    const parsed = searchSchema.safeParse(raw);
    if (!parsed.success) throw invalidResponse();
    return parsed.data.products.slice(0, 10).map((product): ProductCandidate => ({
      id: `agnic-${createHash("sha256").update(`${product.merchant.domain}:${product.sku}`).digest("hex").slice(0, 24)}`,
      sku: product.sku,
      productGid: product.product_gid ?? null,
      name: product.title,
      brand: product.vendor || null,
      description: null,
      merchantName: product.merchant.name,
      merchantId: product.merchant.merchant_id || null,
      merchantUrl: safePublicHttpsUrl(`https://${product.merchant.domain}`),
      productUrl: safePublicHttpsUrl(product.product_url),
      imageUrl: safePublicHttpsUrl(product.image_url),
      price: price(product.price_minor, product.currency),
      availability: product.available === true ? "available" : product.available === false ? "unavailable" : "unknown",
      country: intent.country,
      onboardRequired: !product.merchant.merchant_id || Boolean(product.onboard),
      onboardUrl: safePublicHttpsUrl(product.onboard?.merchant_url),
      metadata: { priceSource: "Browse-time Agnic catalogue; shipping and tax not included", availabilitySource: "Agnic catalogue; confirm current stock at preview" },
      compatibility: { status: "NEEDS_VERIFICATION", reasons: [], missingInformation: ["The product catalogue does not provide verified compatibility specifications."] },
      requiredConstraintsSatisfied: null,
      score: 0,
      recommendation: "Product discovery result. Requirements and compatibility need verification.",
    }));
  }

  async previewOrder(product: ProductCandidate, intent: ProductIntent, context: CallContext, fulfillmentId?: string): Promise<SafePreview> {
    const base: SafePreview = {
      source: "agnic", status: "needs-setup", productId: product.id, quantity: intent.quantity,
      browsePrice: product.price, subtotal: null, shipping: null, tax: null, amount: null,
      amountIsFinal: false, priceChanged: null, requirements: [], message: "", quotedAt: new Date().toISOString(),
    };
    if (!product.merchantId || product.onboardRequired) return { ...base, requirements: ["Select Prepare Merchant to inspect this merchant's checkout before quoting."], message: "Merchant setup is required before a real quote is available." };
    if (product.availability === "unavailable") return { ...base, status: "unavailable", message: "The catalogue reports this product as unavailable. Search again for another option." };
    if (intent.budget.maxAmount !== null && (!product.price || product.price.currency !== intent.budget.currency)) return { ...base, requirements: ["The product currency must match your budget before a spending limit can be checked."], message: "A quote cannot safely apply this budget. No currency conversion was performed." };

    // The budget is for the whole request, not per item. Flooring never increases a cap.
    const maxTotalMinor = intent.budget.maxAmount === null ? undefined : Math.floor(Number((intent.budget.maxAmount * 100).toFixed(8)));
    let raw: unknown;
    const isOfficialSandboxProduct = product.merchantId === 'merchant_untitled_fidget_shop' && product.merchantUrl && new URL(product.merchantUrl).hostname === 'untitled-fidget.shop';
    const sandboxShipTo = isOfficialSandboxProduct ? getSandboxShipTo() : null;
    try { raw = await this.#request(QUOTE_PATH, context, undefined, {
      merchant_id: product.merchantId,
      items: [{ sku: product.sku, quantity: intent.quantity }],
      ...(sandboxShipTo ? { ship_to: sandboxShipTo } : {}),
      ...(fulfillmentId ? { fulfillment_option_id: fulfillmentId } : {}),
      ...(maxTotalMinor === undefined ? {} : { constraints: { max_total_minor: maxTotalMinor } }),
    }); } catch (error) {
      if (error instanceof BudgetQuoteError && maxTotalMinor !== undefined) return { ...base, message: error.message, budgetViolation: { limit: { amountMinor: maxTotalMinor, currency: intent.budget.currency }, checkout: error.total === null ? null : { amountMinor: error.total, currency: intent.budget.currency } } };
      throw error;
    }
    const parsed = quoteSchema.safeParse(raw);
    if (!parsed.success) throw invalidResponse();
    const quote = parsed.data;
    base.fulfillmentOptions = (quote.fulfillment_options ?? []).map(o => ({ id: o.id, type: o.type ?? 'other', title: o.title ?? 'Fulfillment option', description: o.description ?? '', price: price(o.price_minor, o.currency), requiresAddress: o.requires_address ?? true, eta: o.eta ?? null }));
    base.requiresFulfillment = quote.requires_fulfillment_choice === true;
    base.selectedFulfillmentId = quote.selected_option_id ?? null;
    if (quote.unfulfillable) return { ...base, status: "unavailable", message: "The merchant cannot fulfill this cart. No order was placed." };
    const subtotal = price(quote.subtotal_minor, quote.currency);
    const priceChanged = subtotal && product.price && subtotal.currency === product.price.currency ? subtotal.amountMinor !== product.price.amountMinor * intent.quantity : null;
    const requirements: string[] = [];
    if (quote.billing_uses_ship_to) requirements.push("The merchant would also receive the delivery address as the billing address.");
    if (quote.requires_fulfillment_choice) return { ...base, subtotal, priceChanged, requirements: [...requirements, "A delivery or pickup option must be selected before Agnic can quote this cart."], message: "Fulfillment choice required. No final amount is available yet." };
    const amount = price(quote.expected_amount_minor, quote.currency);
    if (!amount || quote.amount_is_final === undefined) return { ...base, subtotal, priceChanged, requirements: [...requirements, "Agnic has not supplied a complete amount and pricing status for this cart."], message: "A complete quote is unavailable. Further account or fulfillment setup may be needed." };
    if (maxTotalMinor !== undefined && (amount.currency !== intent.budget.currency || amount.amountMinor > maxTotalMinor)) return { ...base, subtotal, priceChanged, budgetViolation: { limit: { amountMinor: maxTotalMinor, currency: intent.budget.currency }, checkout: amount }, requirements: [...requirements, "The quote must be in your budget currency and within the original total limit."], message: "The quote does not satisfy your budget. No limit was changed and no order was placed." };
    const options = quote.fulfillment_options ?? [];
    const selected = options.find((option) => option.id === quote.selected_option_id) ?? (!quote.selected_option_id && options.length === 1 ? options[0] : undefined);
    const shipping = selected ? price(selected.price_minor, selected.currency) : null;
    if (!quote.amount_is_final) requirements.push("Tax is finalized at checkout. The displayed amount is a maximum charge, not an exact total.");
    return {
      ...base, status: "quoted", subtotal, priceChanged,
      shipping: shipping?.currency === amount.currency ? shipping : null,
      amount, amountIsFinal: quote.amount_is_final, requirements,
      message: quote.amount_is_final ? "Agnic returned a tax-inclusive quote. Real purchasing remains disabled." : "Agnic returned a spending ceiling. The exact charge is not yet known; real purchasing remains disabled.",
    };
  }

  async placeOrder(): Promise<never> { return assertRealPurchasesEnabled(); }
}

export { AgnicProvider as AgnicAdapter };
