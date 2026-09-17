import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { assertRealPurchasesEnabled, assertSandboxMerchant, getTestCardAlias, REAL_PURCHASE_EXECUTION } from '@/lib/server/safety';
import { sandboxConsentSchema, checkoutSelectionSchema, type Merchant } from '@/lib/domain/checkout';

const merchant: Merchant = { id: 'fixture-merchant', name: 'Official-looking test shop', domain: 'untitled-fidget.shop', isTest: true, rail: 'shopify', currency: 'CAD' };
const consent = { checkoutId: 'd16a7a6c-715a-4570-b77e-91e48988bc69', quoteId: '025fd09f-bfe0-4f89-b1c6-bd1c453136a1', confirmed: true, confirmationText: 'Confirm Test Purchase' };
afterEach(() => vi.unstubAllEnvs());

describe('independent real and sandbox financial safety', () => {
  it('keeps real execution compiled off even if environment flags change', () => {
    vi.stubEnv('SENTINEL_REAL_PURCHASES_ENABLED', 'true');
    vi.stubEnv('SENTINEL_DEVELOPMENT_MODE', 'false');
    expect(REAL_PURCHASE_EXECUTION).toBe(false);
    expect(() => assertRealPurchasesEnabled()).toThrow('Real purchasing is disabled');
  });
  it('accepts authoritative test metadata only for the supported test payment rail', () => {
    expect(() => assertSandboxMerchant(merchant)).not.toThrow();
    expect(() => assertSandboxMerchant({ ...merchant, isTest: false })).toThrow('is_test=true');
    expect(() => assertSandboxMerchant({ ...merchant, rail: 'unknown' })).toThrow();
  });
  it('never infers a sandbox from an official-looking domain or name', () => {
    expect(() => assertSandboxMerchant({ ...merchant, isTest: false })).toThrow();
  });
  it.each(['false', ''])('requires an explicit server assertion that a configured alias is a test card: %s', confirmed => {
    vi.stubEnv('SENTINEL_SANDBOX_CARD_ALIAS_ID', 'card_test_fixture');
    vi.stubEnv('SENTINEL_SANDBOX_CARD_CONFIRMED', confirmed);
    expect(getTestCardAlias()).toBeNull();
  });
  it.each(['', '   ', 'default', 'DEFAULT'])('never selects the default account card via alias %j', alias => {
    vi.stubEnv('SENTINEL_SANDBOX_CARD_ALIAS_ID', alias);
    vi.stubEnv('SENTINEL_SANDBOX_CARD_CONFIRMED', 'true');
    expect(getTestCardAlias()).toBeNull();
  });
  it('returns only an explicitly configured and confirmed test alias', () => {
    vi.stubEnv('SENTINEL_SANDBOX_CARD_ALIAS_ID', ' card_test_fixture ');
    vi.stubEnv('SENTINEL_SANDBOX_CARD_CONFIRMED', 'true');
    expect(getTestCardAlias()).toBe('card_test_fixture');
  });
  it('requires explicit consent tied to both a checkout and a quote', () => {
    expect(sandboxConsentSchema.safeParse(consent).success).toBe(true);
    expect(sandboxConsentSchema.safeParse({ ...consent, confirmed: false }).success).toBe(false);
    expect(sandboxConsentSchema.safeParse({ ...consent, confirmationText: 'buy it' }).success).toBe(false);
    expect(sandboxConsentSchema.safeParse({ ...consent, quoteId: undefined }).success).toBe(false);
  });
  it('rejects frontend attempts to submit merchant metadata, prices, or payment fields', () => {
    for (const injected of [{ is_test: true }, { merchantId: merchant.id }, { amount: 1 }, { cardAliasId: 'default' }]) {
      expect(sandboxConsentSchema.safeParse({ ...consent, ...injected }).success).toBe(false);
      expect(checkoutSelectionSchema.safeParse({ missionId: consent.checkoutId, productId: 'fixture-product', ...injected }).success).toBe(false);
    }
  });
});
