import "server-only";
import type { InspectionAnalysis } from "@/lib/domain/inspection";

/**
 * DEVELOPMENT FIXTURE inspection results. These never run in normal production execution:
 * they exist only for offline automated tests and an explicit, opt-in local dev bypass
 * (`SENTINEL_INSPECT_FIXTURE`), which must stay unset for any real demo or deployment.
 */
export const inspectionFixtures = {
  "broken-office-chair-caster": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified an office chair with a damaged rear caster wheel.",
    object: { category: "Office chair", probableName: "Task office chair", brand: null, model: null, confidence: 0.86 },
    observedCondition: { summary: "One rear caster wheel is cracked and no longer rolls freely.", visibleIssues: ["Cracked caster wheel housing", "Wheel appears partially detached from the stem"], confidence: 0.78 },
    userNeed: { action: "REPLACE_PART", productType: "office chair caster wheel" },
    compatibilityRequirements: {
      verified: [],
      likely: ["Standard swivel chair caster stem"],
      unknown: ["Stem diameter", "Stem length", "Wheel diameter", "Floor type (hardwood vs. carpet)"],
    },
    searchIntent: {
      searchQuery: "office chair replacement caster wheels",
      productType: "office chair caster wheels",
      requiredFeatures: [],
      preferredFeatures: ["Safe for hardwood floors"],
      compatibilityRequirements: ["Chair caster stem compatibility"],
    },
    warnings: ["Stem diameter and length are not visible clearly enough in this photo to confirm an exact match."],
    needsUserClarification: true,
    clarificationQuestions: ["Do you know the chair's brand or model?", "Can you provide a close-up photo of the caster stem?"],
  },
} as const satisfies Record<string, InspectionAnalysis>;

export type InspectionFixtureName = keyof typeof inspectionFixtures;
export function isInspectionFixtureName(value: string): value is InspectionFixtureName {
  return value in inspectionFixtures;
}
