import type { Merchant } from './checkout';

/** Agnic Testing documentation (2026-09-20): this ordinary Shopify shop uses
 * gateway test mode, so merchant.is_test and order.test remain false.
 * Only this exact identity and the two support-confirmed variants qualify.
 * https://docs.agnic.ai/docs/agentic-commerce/testing
 */
export const OFFICIAL_SANDBOX_ITEMS = [
  { sku: 'gid://shopify/ProductVariant/43945235349570', name: 'Hex Token Fidget' },
  { sku: 'gid://shopify/ProductVariant/43945255567426', name: 'Paw Print Charm' },
] as const;
export function isOfficialShopifySandbox(merchant: Merchant | null | undefined): boolean {
  return merchant?.id === 'merchant_untitled_fidget_shop' && merchant.domain === 'untitled-fidget.shop' && merchant.rail === 'shopify' && merchant.currency === 'CAD';
}
export function isSandboxMerchant(merchant: Merchant | null | undefined): boolean {
  return Boolean(merchant && merchant.rail === 'shopify' && (merchant.isTest || isOfficialShopifySandbox(merchant)));
}
