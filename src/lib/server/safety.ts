import "server-only";
import { isSandboxMerchant } from "@/lib/domain/sandbox";
import { ProviderError } from './provider-error';
import { z } from 'zod';
import type { Merchant, SandboxShipTo } from '@/lib/domain/checkout';

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
  if (!isSandboxMerchant(merchant)) throw new ProviderError('SANDBOX_MERCHANT_REQUIRED', 'Checkout blocked: the merchant is neither a verified test merchant nor Agnic’s documented Shopify gateway sandbox.', 403);
}
export function getTestCardAlias(): string | null {
  const alias = process.env.SENTINEL_SANDBOX_CARD_ALIAS_ID?.trim();
  return process.env.SENTINEL_SANDBOX_CARD_CONFIRMED === 'true' && alias && !/^(default|null|undefined)$/i.test(alias) ? alias : null;
}
const sandboxShipToSchema = z.object({
  name: z.string().trim().min(2).max(100),
  street_address: z.string().trim().min(3).max(200),
  address_locality: z.string().trim().min(2).max(100),
  address_region: z.string().trim().min(2).max(100),
  postal_code: z.string().trim().min(3).max(20),
  address_country: z.enum(['CA', 'US']),
  phone: z.string().trim().min(7).max(30).optional(),
}).strict();
export function getSandboxShipTo(): SandboxShipTo | null {
  const configured = process.env.SENTINEL_SANDBOX_SHIP_TO_JSON?.trim();
  if (!configured) return null;
  try { return sandboxShipToSchema.parse(JSON.parse(configured)); }
  catch { throw new ProviderError('SANDBOX_SHIPPING_INVALID', 'The local sandbox shipping configuration is invalid. No order was placed.', 503); }
}
