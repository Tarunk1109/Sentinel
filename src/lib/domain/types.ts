/** Shared, serializable contracts. This module never reads server credentials. */
export type Mode = "inspect" | "build" | "request";

export type ProductCategory = "monitor" | "keyboard" | "headphones" | "hub";

export interface Money {
  amount: number;
  currency: "USD";
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  description: string;
  price: Money;
  category: ProductCategory;
  highlights: string[];
  compatibility: {
    status: "unverified";
    summary: string;
  };
  imageKind: ProductCategory;
  recommended: boolean;
}

export interface AgentStep {
  id: string;
  label: string;
  detail: string;
  status: "complete" | "active" | "pending" | "blocked";
}

export interface Mission {
  id: string;
  prompt: string;
  mode: "request";
  status: "ready" | "no-results";
  summary: string;
  constraints: string[];
  products: Product[];
  steps: AgentStep[];
  source: "demo";
  createdAt: string;
}

export interface MissionRequest {
  prompt: string;
}

export interface MissionResponse {
  mission: Mission;
}

export interface ApiErrorResponse {
  error: { code: string; message: string };
}

export interface UnderstoodIntent {
  prompt: string;
  category: ProductCategory | null;
  budget: { amount: number; inclusive: boolean } | null;
  minimumBudget: number | null;
  currency: "USD" | "unsupported";
  constraints: string[];
  compatibilityTarget: string | null;
  /** Constraints preserved for the next milestone, not verified by demo data. */
  unresolvedConstraints: string[];
}

/** Future real checkout contracts. No simulated orders or consent are produced. */
export interface OrderPreview {
  id: string;
  productId: string;
  quantity: number;
  merchantName: string;
  subtotal: Money;
  shipping: Money;
  tax: Money;
  total: Money;
  expiresAt: string;
  source: "agnic";
}

export interface ExplicitPurchaseConsent {
  previewId: string;
  exactTotal: Money;
  acceptedAt: string;
  consentTextVersion: string;
}

export interface PurchaseProof {
  orderId: string;
  previewId: string;
  merchantName: string;
  totalPaid: Money;
  purchasedAt: string;
  receiptUrl: string;
  source: "agnic";
}
