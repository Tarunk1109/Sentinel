import { z } from "zod";
import { AUTOPILOT_LIMITS, itemIdSchema, type AutopilotPolicy } from "./policy";
import { CADENCE_LABEL } from "./schedule";

export type AutopilotRunTrigger = "SCHEDULE" | "MANUAL";

/** Caller-supplied stock counts (a manual count today; a future vision phase later). */
export const inventoryObservationSchema = z.array(z.object({
  itemId: itemIdSchema,
  units: z.number().int("Units must be a whole number.").min(0, "Units cannot be negative.").max(AUTOPILOT_LIMITS.maxInventoryUnits, `Units cannot exceed ${AUTOPILOT_LIMITS.maxInventoryUnits}.`),
}).strict()).max(AUTOPILOT_LIMITS.maxItems, `Up to ${AUTOPILOT_LIMITS.maxItems} inventory counts.`);
export type InventoryObservation = z.infer<typeof inventoryObservationSchema>;

export interface TriggerEvaluation {
  outcome: "MATCHED" | "NOT_MATCHED" | "NEEDS_INPUT";
  itemIds: string[];
  reason: string;
}

/**
 * Pure. SCHEDULED restocks every item whenever the run proceeds. INVENTORY_BELOW restocks
 * only items whose supplied count is below their minimum; items without a count are never
 * assumed low (unknown is not the same as empty).
 */
export function evaluateTrigger(policy: AutopilotPolicy, trigger: AutopilotRunTrigger, inventory?: InventoryObservation): TriggerEvaluation {
  const cadence = CADENCE_LABEL[policy.schedule.cadence].toLowerCase();
  const allItems = policy.items.map(item => item.id);
  if (policy.trigger.type === "SCHEDULED") {
    return { outcome: "MATCHED", itemIds: allItems, reason: trigger === "SCHEDULE" ? `The ${cadence} schedule is due.` : "A run was requested manually." };
  }
  if (!inventory || inventory.length === 0) {
    return { outcome: "NEEDS_INPUT", itemIds: [], reason: "Current stock counts are needed to check the restock thresholds." };
  }
  const counts = new Map(inventory.map(observation => [observation.itemId, observation.units]));
  const labels = new Map(policy.items.map(item => [item.id, item.label]));
  const low: string[] = [];
  let uncounted = 0;
  for (const threshold of policy.trigger.thresholds) {
    const units = counts.get(threshold.itemId);
    if (units === undefined) { uncounted++; continue; }
    if (units < threshold.minimumUnits) low.push(threshold.itemId);
  }
  const skipped = uncounted ? ` ${uncounted} item${uncounted === 1 ? " had" : "s had"} no count and ${uncounted === 1 ? "was" : "were"} not restocked.` : "";
  if (low.length === 0) return { outcome: "NOT_MATCHED", itemIds: [], reason: `All counted items are at or above their minimum stock.${skipped}` };
  return { outcome: "MATCHED", itemIds: low, reason: `Below minimum stock: ${low.map(id => labels.get(id) ?? id).join(", ")}.${skipped}` };
}
