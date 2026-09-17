import "server-only";

import type {
  ExplicitPurchaseConsent,
  Mission,
  OrderPreview,
  Product,
  PurchaseProof,
  UnderstoodIntent,
} from "@/lib/domain/types";

export interface IntentUnderstandingService {
  understand(prompt: string): Promise<UnderstoodIntent>;
}

export interface ProductDiscoveryService {
  search(intent: UnderstoodIntent): Promise<Product[]>;
}

export interface MissionService {
  run(prompt: string): Promise<Mission>;
}

/** Implement only after quote validation and server-side consent binding exist. */
export interface CommerceService {
  previewOrder(input: {
    productId: string;
    quantity: number;
  }): Promise<OrderPreview>;
  placeOrder(input: {
    previewId: string;
    consent: ExplicitPurchaseConsent;
    idempotencyKey: string;
  }): Promise<PurchaseProof>;
}
