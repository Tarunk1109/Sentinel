import "server-only";
import { ProviderError } from './provider-error';
import type { Merchant } from '@/lib/domain/checkout';

/** DO NOT REMOVE THIS GUARD UNTIL THE HACKATHON TEAM EXPLICITLY ENABLES REAL CHECKOUT.
 * Real commerce is compiled without transaction execution. Even changing environment flags
 * cannot enable spending. Frontend approval, natural language, and sandbox flags have no authority.
 */
export const REAL_PURCHASE_EXECUTION = false as const;
export const DEVELOPMENT_MODE = true as const;
export const MAX_DEVELOPMENT_SPEND_MINOR = 0;

export class PurchaseSafetyError extends Error {
  readonly code = "REAL_PURCHASES_DISABLED";
  constructor() { super("Real purchasing is disabled in development mode."); this.name = "PurchaseSafetyError"; }
}

export function assertRealPurchasesEnabled(): never {
  // The explicit environment check also protects a future implementation.
  if (process.env.SENTINEL_REAL_PURCHASES_ENABLED !== "true" || process.env.SENTINEL_DEVELOPMENT_MODE !== "false") {
    throw new PurchaseSafetyError();
  }
  // This real-commerce entry point stays locked. Verified sandbox execution is separate.
  throw new PurchaseSafetyError();
}

/** Legacy discovery metadata only. The separate sandbox service re-verifies merchant status. */
export const TEST_CHECKOUT = Object.freeze({ merchantHost: "untitled-fidget.shop", executionEnabled: false, requiresSeparateAuthorization: true });

export const REAL_COMMERCE_MODE = 'REAL_COMMERCE_MODE' as const;
export const SANDBOX_COMMERCE_MODE = 'SANDBOX_COMMERCE_MODE' as const;
export function assertSandboxMerchant(merchant: Merchant): void {
  if (merchant.isTest !== true || merchant.rail !== 'shopify') throw new ProviderError('SANDBOX_MERCHANT_REQUIRED', 'Checkout blocked: Agnic must independently identify this Shopify merchant as is_test=true. A test-looking name or domain is not enough.', 403);
}
export function getTestCardAlias(): string | null {
  const alias = process.env.SENTINEL_SANDBOX_CARD_ALIAS_ID?.trim();
  return process.env.SENTINEL_SANDBOX_CARD_CONFIRMED === 'true' && alias && !/^(default|null|undefined)$/i.test(alias) ? alias : null;
}
