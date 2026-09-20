import { z } from 'zod';
import type { Price, ProductCandidate, SafePreview } from './commerce';

export type CommerceMode = 'REAL_COMMERCE_MODE' | 'SANDBOX_COMMERCE_MODE';
export interface Merchant { id: string; name: string; domain: string; rail: string; isTest: boolean; currency: string }
export interface ProviderOrder {
  id: string; merchantId: string | null; status: string; approvedAmount: Price | null;
  chargedAmount: Price | null; orderUrl: string | null; timestamp: string | null;
  test: boolean; retryable: boolean | null; retryAction: string | null; errorCode: string | null;
  chargeState: 'none' | 'attempted' | 'unknown' | 'confirmed' | null;
  billingMode: string | null;
}
export interface ExploreResult { orderId: string | null; merchantId: string | null; status: string }
export type CheckoutStage = 'selected' | 'exploring' | 'ready' | 'fulfillment' | 'quoted' | 'blocked' | 'dispatching' | 'processing' | 'succeeded' | 'failed' | 'unknown' | 'timed-out';
export interface CheckoutSession {
  id: string; mode: CommerceMode; product: ProductCandidate; quantity: number;
  stage: CheckoutStage; message: string; merchant: Merchant | null;
  preview: SafePreview | null; quoteId: string | null; quoteExpiresAt: string | null;
  order: ProviderOrder | null; approvedAt: string | null;
  retryOfOrderId: string | null;
  canConfirm: boolean; setup: { testCardConfigured: boolean; cardSetupUrl: string; guideUrl: string; profileSetupUrl?: string };
}
export interface SandboxInfo { merchant: Merchant; products: ProductCandidate[]; blocked: boolean; message: string }
export const checkoutSelectionSchema = z.object({ missionId: z.string().uuid(), productId: z.string().min(1).max(160) }).strict();
export const checkoutActionSchema = z.object({ checkoutId: z.string().uuid() }).strict();
export const checkoutQuoteSchema = checkoutActionSchema.extend({ fulfillmentId: z.string().min(1).max(2000).optional() }).strict();
export const sandboxSelectionSchema = z.object({ productId: z.string().min(1).max(160) }).strict();
export const sandboxAutoQuoteSchema = z.object({ productId: z.string().min(1).max(160) }).strict();
export const sandboxAutoConfirmSchema = sandboxAutoQuoteSchema.extend({ confirmed: z.literal(true), confirmationText: z.literal('Confirm Test Purchase') }).strict();
export const sandboxOrderStatusSchema = sandboxAutoQuoteSchema.extend({ orderId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/) }).strict();
export const sandboxConsentSchema = checkoutActionSchema.extend({ quoteId: z.string().uuid(), confirmed: z.literal(true), confirmationText: z.literal('Confirm Test Purchase') }).strict();
export type SandboxConsent = z.infer<typeof sandboxConsentSchema>;
export const AUTHORIZED_RETRY_ORDER_ID = 'af_ord_mu9enrtcm1rvph4a' as const;
export const authorizedRetryStartSchema = z.object({ action: z.literal('start'), previousOrderId: z.literal(AUTHORIZED_RETRY_ORDER_ID) }).strict();
export const authorizedRetryConsentSchema = z.object({
  action: z.literal('confirm'),
  checkoutId: z.string().uuid(),
  quoteId: z.string().uuid(),
  previousOrderId: z.literal(AUTHORIZED_RETRY_ORDER_ID),
  confirmed: z.literal(true),
  confirmationText: z.literal('Confirm Provider-Authorized Test Retry'),
}).strict();
export type AuthorizedRetryConsent = z.infer<typeof authorizedRetryConsentSchema>;
export interface SandboxPaymentReadiness { aliasFound: boolean; brand: string | null; lastFour: string | null }
export interface SandboxDispatch {
  merchantId: string; sku: string; quantity: number; amount: Price;
  maxTotalMinor: number; fulfillmentId?: string; approvedAt: string;
  confirmationText: 'Confirm Test Purchase'; originalRequest: string;
  shipTo?: SandboxShipTo;
}
export interface SandboxShipTo {
  name: string;
  street_address: string;
  address_locality: string;
  address_region: string;
  postal_code: string;
  address_country: 'CA' | 'US';
  phone?: string;
}
