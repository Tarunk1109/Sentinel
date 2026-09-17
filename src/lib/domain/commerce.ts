import { z } from "zod";

export const currencySchema = z.enum(["CAD", "USD", "GBP", "AUD"]);
export const countrySchema = z.enum(["CA", "US", "GB", "AU"]);
export type Currency = z.infer<typeof currencySchema>;
export type Country = z.infer<typeof countrySchema>;

const shortList = z.array(z.string().min(1).max(180)).max(12);
export const productIntentSchema = z.object({
  originalRequest: z.string().min(3).max(1000),
  searchQuery: z.string().min(2).max(180),
  productType: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(10),
  budget: z.object({ maxAmount: z.number().nonnegative().max(1000000).nullable(), currency: currencySchema }).strict(),
  country: countrySchema,
  requiredFeatures: shortList,
  preferredFeatures: shortList,
  excludedFeatures: shortList,
  compatibilityRequirements: shortList,
  brandPreferences: shortList,
  merchantPreferences: shortList,
  urgency: z.string().max(180).nullable(),
}).strict();
export type ProductIntent = z.infer<typeof productIntentSchema>;

/** Monetary values are integer minor units, never floating point checkout totals. */
export interface Price { amountMinor: number; currency: Currency }
export type CompatibilityStatus = "VERIFIED" | "LIKELY_COMPATIBLE" | "NEEDS_VERIFICATION" | "INCOMPATIBLE";
export interface SupportedReason { claim: string; evidenceQuote: string }
export interface Compatibility {
  status: CompatibilityStatus;
  reasons: SupportedReason[];
  missingInformation: string[];
}
export interface ProductCandidate {
  id: string;
  sku: string;
  productGid: string | null;
  name: string;
  brand: string | null;
  description: string | null;
  merchantName: string;
  merchantId: string | null;
  merchantUrl: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  price: Price | null;
  availability: "available" | "unavailable" | "unknown";
  country: Country;
  onboardRequired: boolean;
  onboardUrl?: string | null;
  /** Only allowlisted public product fields; never a raw provider response. */
  metadata: Record<string, string>;
  compatibility: Compatibility;
  requiredConstraintsSatisfied: boolean | null;
  score: number;
  recommendation: string;
}

export const evaluationSchema = z.object({ candidates: z.array(z.object({
  candidateId: z.string().min(1).max(160),
  status: z.enum(["VERIFIED", "LIKELY_COMPATIBLE", "NEEDS_VERIFICATION", "INCOMPATIBLE"]),
  reasons: z.array(z.object({ claim: z.string().max(200), evidenceQuote: z.string().min(1).max(300) }).strict()).max(4),
  missingInformation: z.array(z.string().max(180)).max(5),
  requiredConstraintsSatisfied: z.boolean().nullable(),
  score: z.number().int().min(0).max(100),
}).strict()).max(12) }).strict();
export type CandidateEvaluation = z.infer<typeof evaluationSchema>;

export type StepId = "understand" | "discover" | "filter" | "verify" | "compare" | "select" | "prepare" | "preview" | "consent" | "purchase" | "proof";
export interface ActivityStep {
  id: StepId;
  label: string;
  detail: string;
  status: "pending" | "active" | "complete" | "blocked" | "error";
}
export interface UsageCounts { modelCalls: number; agnicCalls: number; inputTokens: number; outputTokens: number }
export interface RequestMission {
  id: string;
  prompt: string;
  intent: ProductIntent;
  products: ProductCandidate[];
  steps: ActivityStep[];
  source: "agnic";
  status: "ready" | "no-results";
  summary: string;
  warnings: string[];
  createdAt: string;
  expiresAt: string;
  cacheHit: boolean;
  usage: UsageCounts;
  counts: { discovered: number; withinBudget: number; shortlisted: number };
}
export interface SafePreview {
  source: "agnic";
  status: "quoted" | "needs-setup" | "unavailable";
  productId: string;
  quantity: number;
  browsePrice: Price | null;
  subtotal: Price | null;
  shipping: Price | null;
  tax: Price | null;
  amount: Price | null;
  amountIsFinal: boolean;
  priceChanged: boolean | null;
  requirements: string[];
  message: string;
  quotedAt: string;
  fulfillmentOptions?: FulfillmentOption[];
  selectedFulfillmentId?: string | null;
  requiresFulfillment?: boolean;
  budgetViolation?: { limit: Price; checkout: Price | null };
}
export interface FulfillmentOption { id: string; type: string; title: string; description: string; price: Price | null; requiresAddress: boolean; eta: string | null }
export interface PublicError { code: string; message: string }
export type MissionEvent =
  | { type: "step"; step: ActivityStep }
  | { type: "intent"; intent: ProductIntent }
  | { type: "complete"; mission: RequestMission }
  | { type: "error"; error: PublicError };
export interface RuntimeStatus {
  aiCredential: "detected" | "missing";
  agnicCredential: "detected" | "missing";
  aiEnabled: boolean;
  model: "gpt-6-astra";
  realPurchasesEnabled: false;
  developmentMode: true;
  intentModel?: "gpt-5.6-luna";
  aiBudget?: { spentCad: number; limitCad: number } | null;
  aiProvider?: "openai";
}

export const submissionSchema = z.object({ prompt: z.string().trim().min(3, "Describe what you need in at least 3 characters.").max(1000, "Keep your request to 1000 characters or fewer.") }).strict();
export const previewRequestSchema = z.object({ missionId: z.string().uuid(), productId: z.string().min(1).max(160) }).strict();
