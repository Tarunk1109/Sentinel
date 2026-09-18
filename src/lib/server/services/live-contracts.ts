import "server-only";
import type { CandidateEvaluation, ProductCandidate, ProductIntent, SafePreview, UsageCounts } from "@/lib/domain/commerce";
import type { ExploreResult, Merchant, ProviderOrder, SandboxDispatch } from '@/lib/domain/checkout';
import type { InspectionAnalysis } from "@/lib/domain/inspection";
import type { ValidatedImage } from "../image-validation";

export interface CallContext { signal: AbortSignal; usage: UsageCounts }
export interface ProductReasoner {
  understand(prompt: string, context: CallContext): Promise<ProductIntent>;
  evaluate(intent: ProductIntent, products: ProductCandidate[], context: CallContext): Promise<CandidateEvaluation>;
}
/** A single bounded multimodal call; never a recursive or per-render vision loop. */
export interface ImageInspector {
  analyzeInspectionImage(image: ValidatedImage, context: CallContext): Promise<InspectionAnalysis>;
}
export interface CommerceProvider {
  searchProducts(intent: ProductIntent, context: CallContext): Promise<ProductCandidate[]>;
  previewOrder(product: ProductCandidate, intent: ProductIntent, context: CallContext, fulfillmentId?: string): Promise<SafePreview>;
  placeOrder(): Promise<never>;
}
export interface CheckoutProvider extends CommerceProvider {
  getMerchant(id: string, context: CallContext): Promise<Merchant>;
  getSandboxProducts(context: CallContext): Promise<{ merchant: Merchant; products: ProductCandidate[] }>;
  explore(product: ProductCandidate, intent: ProductIntent, context: CallContext): Promise<ExploreResult>;
  resolveProduct(product: ProductCandidate, context: CallContext): Promise<ProductCandidate>;
  getOrder(id: string, context: CallContext): Promise<ProviderOrder>;
  dispatchSandbox(input: SandboxDispatch, context: CallContext): Promise<ProviderOrder>;
}
