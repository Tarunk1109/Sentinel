import { productIntentSchema, type ProductIntent } from "@/lib/domain/commerce";
import { formatMinor, minorToMajor } from "./money";
import type { AutopilotCategory, AutopilotPolicy } from "./policy";

/**
 * Autopilot is another source of the SAME ProductIntent that Request, Inspect and Build
 * produce - this envelope only adds where the intent came from. The wrapped `intent` goes
 * to the existing commerce search unchanged.
 */
export interface AutopilotIntent {
  source: "AUTOPILOT";
  policyId: string;
  itemId: string;
  itemLabel: string;
  category: AutopilotCategory;
  intent: ProductIntent;
}

function cap(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * One validated ProductIntent per item. Deterministic for a given policy version (no
 * timestamps), so a later selection can be bound back to exactly this intent.
 *
 * `budget.maxAmount` is the policy's per-run cap, never a per-item share: the existing
 * `filterCandidates` treats it as a hard price filter, and the combined run total is
 * enforced separately by the mandate decision.
 */
export function buildAutopilotIntents(policy: AutopilotPolicy, itemIds: readonly string[]): AutopilotIntent[] {
  const wanted = new Set(itemIds);
  return policy.items.filter(item => wanted.has(item.id)).map(item => ({
    source: "AUTOPILOT",
    policyId: policy.id,
    itemId: item.id,
    itemLabel: item.label,
    category: item.category,
    intent: productIntentSchema.parse({
      originalRequest: cap(`Autopilot restock for "${policy.name}": ${item.label}. Standing goal: ${policy.goal} Spending limit: ${formatMinor(policy.budget.maximumPerRunMinor)} per run.`, 1000),
      searchQuery: item.searchQuery,
      productType: item.productType,
      quantity: item.quantity,
      budget: { maxAmount: minorToMajor(policy.budget.maximumPerRunMinor), currency: policy.currency },
      country: "CA",
      requiredFeatures: [],
      preferredFeatures: [],
      excludedFeatures: [],
      compatibilityRequirements: [],
      brandPreferences: item.preferredBrands,
      merchantPreferences: [],
      urgency: null,
    }),
  }));
}
