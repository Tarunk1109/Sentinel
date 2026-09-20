import type { ProductCandidate, ProductIntent, RequestMission } from "@/lib/domain/commerce";
import type { AutopilotPolicyInput } from "@/lib/autopilot/policy";
import { product } from "./fixtures";

export const OWNER = "11111111-1111-4111-8111-111111111111";
export const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
/** Monday 2026-09-21 09:00 in America/Toronto (EDT). */
export const MONDAY_9AM_TORONTO = "2026-09-21T13:00:00.000Z";

export function policyInput(overrides: Partial<AutopilotPolicyInput> = {}): AutopilotPolicyInput {
  return {
    name: "Café Drinks",
    goal: "Keep café drinks stocked.",
    currency: "CAD",
    budget: { maximumPerWeekMinor: 7000 },
    schedule: { cadence: "WEEKLY", dayOfWeek: 1, timeOfDay: "09:00", timezone: "America/Toronto" },
    trigger: { type: "SCHEDULED" },
    allowedCategories: ["BEVERAGES"],
    items: [
      { id: "cola", label: "Coca-Cola or cola", category: "BEVERAGES", searchQuery: "Coca-Cola soft drink", productType: "cola soft drink", preferredBrands: ["Coca-Cola"] },
      { id: "lemon-lime", label: "Sprite or lemon-lime soft drink", category: "BEVERAGES", searchQuery: "Sprite soft drink", productType: "lemon-lime soft drink", preferredBrands: ["Sprite"] },
      { id: "orange", label: "Fanta or orange soft drink", category: "BEVERAGES", searchQuery: "Fanta soft drink", productType: "orange soft drink", preferredBrands: ["Fanta"] },
    ],
    authorization: { autoAuthorizeWithinMandate: true, requireApprovalAboveMinor: null, overMandate: "REQUIRE_APPROVAL" },
    ...overrides,
  };
}

export function drink(id: string, name: string, amountMinor: number | null): ProductCandidate {
  return { ...product, id, sku: `sku-${id}`, name, merchantName: "Test Beverage Co", price: amountMinor === null ? null : { amountMinor, currency: "CAD" } };
}

export class MutableClock {
  private value: number;
  constructor(iso: string) { this.value = Date.parse(iso); }
  readonly now = (): Date => new Date(this.value);
  set(iso: string): void { this.value = Date.parse(iso); }
  advance(ms: number): void { this.value += ms; }
}

let missionCounter = 0;
/**
 * Mirrors RequestMissionService's contract that Autopilot relies on: search stores the
 * mission (with the intent exactly as passed) per owner, and getSelection reads it back or
 * throws SELECTION_EXPIRED. No network, no model.
 */
export class FakeCommerce {
  available: boolean;
  catalog: ProductCandidate[];
  searches: ProductIntent[] = [];
  private missions = new Map<string, { owner: string; mission: RequestMission }>();
  constructor(
    available = true,
    catalog: ProductCandidate[] = [drink("coke-12", "Coca-Cola 12 x 355 mL", 1049)],
    private readonly expired: () => Error = () => new Error("This selection expired. Find the product again to continue."),
  ) {
    this.available = available;
    this.catalog = catalog;
  }
  isAvailable = (): boolean => this.available;
  search = async (intent: ProductIntent, owner: string): Promise<RequestMission> => {
    this.searches.push(structuredClone(intent));
    missionCounter++;
    const id = `00000000-0000-4000-8000-${String(missionCounter).padStart(12, "0")}`;
    const mission: RequestMission = {
      id, prompt: intent.originalRequest, intent: structuredClone(intent), products: structuredClone(this.catalog), steps: [], source: "agnic",
      status: this.catalog.length ? "ready" : "no-results", summary: "", warnings: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString(),
      cacheHit: false, usage: { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 }, counts: { discovered: this.catalog.length, withinBudget: this.catalog.length, shortlisted: this.catalog.length },
    };
    this.missions.set(id, { owner, mission });
    return structuredClone(mission);
  };
  getSelection = (owner: string, missionId: string, productId: string): { product: ProductCandidate; intent: ProductIntent } => {
    const record = this.missions.get(missionId);
    const found = record?.owner === owner ? record.mission.products.find(item => item.id === productId) : undefined;
    if (!record || !found) throw this.expired();
    return structuredClone({ product: found, intent: record.mission.intent });
  };
}
