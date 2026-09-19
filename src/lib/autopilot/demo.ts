import "server-only";
import type { AutopilotPolicyInput } from "./policy";

/**
 * DEMO FIXTURE - development and test only. A sample café restock mandate for exercising
 * the engine. It is never a real order, never seeded automatically, and never used as a
 * fallback: it exists only when explicitly requested via POST /api/autopilot/demo, and
 * policies/runs created from it carry `demo: true` so checkout integration must refuse them.
 */
export const CAFE_DEMO_FIXTURE_ID = "cafe-drinks-restock";

export function autopilotDemoAllowed(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

export function cafeDemoPolicyInput(timezone: string): AutopilotPolicyInput {
  const drink = (id: string, label: string, brand: string, productType: string) => ({
    id, label, category: "BEVERAGES" as const, searchQuery: `${brand} soft drink`, productType,
    preferredBrands: [brand], brandMatch: "PREFERRED" as const, quantity: 1,
  });
  return {
    name: "Café Drinks Restock (DEMO)",
    goal: "Keep café drinks stocked.",
    currency: "CAD",
    budget: { maximumPerWeekMinor: 7000, maximumPerRunMinor: 7000 },
    schedule: { cadence: "WEEKLY", dayOfWeek: 1, timeOfDay: "09:00", timezone },
    trigger: { type: "SCHEDULED" },
    allowedCategories: ["BEVERAGES"],
    items: [
      drink("cola", "Coca-Cola or cola", "Coca-Cola", "cola soft drink"),
      drink("lemon-lime", "Sprite or lemon-lime soft drink", "Sprite", "lemon-lime soft drink"),
      drink("orange", "Fanta or orange soft drink", "Fanta", "orange soft drink"),
    ],
    authorization: { autoAuthorizeWithinMandate: true, requireApprovalAboveMinor: null, overMandate: "REQUIRE_APPROVAL" },
  };
}
