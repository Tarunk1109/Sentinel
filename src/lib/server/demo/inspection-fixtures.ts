import "server-only";
import type { InspectionAnalysis } from "@/lib/domain/inspection";

/**
 * DEVELOPMENT FIXTURE inspection results. These never run in normal production execution:
 * they exist only for offline automated tests and an explicit, opt-in local dev bypass
 * (`SENTINEL_INSPECT_FIXTURE`), which must stay unset for any real demo or deployment.
 *
 * `damaged-usb-cable-with-adapter` and `intact-water-bottle` are regression fixtures built
 * directly from two real live-multimodal-test failures (Phase 4B): the model previously
 * merged a foreground cable and a background wall adapter into one hallucinated object, and
 * separately assumed an undamaged water bottle needed replacing just because it was
 * inspected. Keep both shapes exactly as SENTINEL should have answered, not as it did.
 */
export const inspectionFixtures = {
  "broken-office-chair-caster": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified an office chair with a damaged rear caster wheel.",
    detectedObjects: [
      { id: "chair", label: "Office chair", category: "office chair", brand: null, model: null, role: "PRIMARY", confidence: 0.86, visibleEvidence: ["Task chair with a five-star wheelbase", "Rear caster wheel cracked and off-axis"] },
    ],
    primarySubjectId: "chair",
    primarySubjectAmbiguous: false,
    condition: { status: "DAMAGED", summary: "One rear caster wheel is cracked and no longer rolls freely.", visibleIssues: ["Cracked caster wheel housing", "Wheel appears partially detached from the stem"], confidence: 0.78 },
    compatibilityRequirements: { verified: [], likely: ["Standard swivel chair caster stem"], unknown: ["Stem diameter", "Stem length", "Wheel diameter", "Floor type (hardwood vs. carpet)"] },
    searchIntent: { searchQuery: "office chair replacement caster wheels", productType: "office chair caster wheels", requiredFeatures: [], preferredFeatures: ["Safe for hardwood floors"], compatibilityRequirements: ["Chair caster stem compatibility"] },
    recommendedAction: { action: "SEARCH_PART", reason: "The rear caster is visibly cracked and no longer functions, which is a part-level defect on an otherwise usable chair." },
    warnings: ["Stem diameter and length are not visible clearly enough in this photo to confirm an exact match."],
    needsUserClarification: true,
    clarificationQuestions: ["Do you know the chair's brand or model?", "Can you provide a close-up photo of the caster stem?"],
  },
  "damaged-usb-cable-with-adapter": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified a damaged USB-C cable in the foreground, with a separate wall adapter visible behind it.",
    detectedObjects: [
      { id: "cable", label: "USB-C charging cable", category: "USB-C cable", brand: null, model: null, role: "PRIMARY", confidence: 0.82, visibleEvidence: ["White cable with a USB-C male connector in sharp foreground focus", "Insulation is split and frayed near the connector's strain relief"] },
      { id: "adapter", label: "Wall power adapter", category: "wall charger", brand: null, model: null, role: "BACKGROUND", confidence: 0.63, visibleEvidence: ["Separate small white block with two round AC prongs", "Out of focus, positioned behind the cable"] },
    ],
    primarySubjectId: "cable",
    primarySubjectAmbiguous: false,
    condition: { status: "POSSIBLE_HAZARD", summary: "The cable's insulation is visibly split near the connector, exposing the strain relief.", visibleIssues: ["Split/frayed insulation near the USB-C connector", "Exposed strain relief"], confidence: 0.74 },
    compatibilityRequirements: { verified: ["USB-C male connector visible on the damaged cable"], likely: ["USB charging cable"], unknown: ["Device being charged", "Required wattage / USB Power Delivery support", "Data transfer capability", "Cable length", "USB generation"] },
    searchIntent: { searchQuery: "USB-C charging cable replacement", productType: "USB-C cable", requiredFeatures: [], preferredFeatures: [], compatibilityRequirements: ["USB-C connector compatibility with the charged device"] },
    recommendedAction: { action: "SEARCH_REPLACEMENT", reason: "The cable's insulation is visibly damaged near the connector; the wall adapter behind it shows no defect and is a separate object." },
    warnings: ["Visible cable damage near the connector may pose an electrical safety risk. Avoid using it until replaced.", "The wall adapter in the background appears undamaged; only the cable's condition drove this recommendation."],
    needsUserClarification: true,
    clarificationQuestions: ["What device does this cable connect to?"],
  },
  "damaged-single-cable": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified a damaged USB-C cable.",
    detectedObjects: [
      { id: "cable", label: "USB-C charging cable", category: "USB-C cable", brand: null, model: null, role: "PRIMARY", confidence: 0.85, visibleEvidence: ["USB-C male connector visible", "Insulation split near the connector"] },
    ],
    primarySubjectId: "cable",
    primarySubjectAmbiguous: false,
    condition: { status: "DAMAGED", summary: "The cable's insulation is split near the connector.", visibleIssues: ["Split insulation near the connector"], confidence: 0.8 },
    compatibilityRequirements: { verified: ["USB-C male connector"], likely: ["USB charging cable"], unknown: ["Device being charged", "Required wattage", "Cable length"] },
    searchIntent: { searchQuery: "USB-C charging cable replacement", productType: "USB-C cable", requiredFeatures: [], preferredFeatures: [], compatibilityRequirements: [] },
    recommendedAction: { action: "SEARCH_REPLACEMENT", reason: "The cable's insulation is visibly damaged near the connector." },
    warnings: [],
    needsUserClarification: false,
    clarificationQuestions: [],
  },
  "intact-water-bottle": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified a reusable water bottle with no visible damage.",
    detectedObjects: [
      { id: "bottle", label: "Reusable water bottle", category: "reusable water bottle", brand: null, model: null, role: "PRIMARY", confidence: 0.9, visibleEvidence: ["Plastic bottle with a 400 ml / 14 oz capacity marking", "Orange screw cap with a carry tether", "No cracks, dents, or leaks visible"] },
    ],
    primarySubjectId: "bottle",
    primarySubjectAmbiguous: false,
    condition: { status: "INTACT", summary: "The bottle shows no cracks, dents, or damage; the cap and tether are intact.", visibleIssues: [], confidence: 0.87 },
    compatibilityRequirements: { verified: [], likely: [], unknown: [] },
    searchIntent: { searchQuery: "reusable water bottle", productType: "reusable water bottle", requiredFeatures: [], preferredFeatures: [], compatibilityRequirements: [] },
    recommendedAction: { action: "ASK_USER_INTENT", reason: "The bottle appears intact and usable; nothing in the photo indicates a need to replace it." },
    warnings: [],
    needsUserClarification: false,
    clarificationQuestions: [],
  },
  "ambiguous-desk-objects": {
    outcome: "ANALYZED",
    outcomeMessage: "Two comparably prominent items are visible; it isn't clear which one should be inspected.",
    detectedObjects: [
      { id: "chair", label: "Office chair", category: "office chair", brand: null, model: null, role: "UNKNOWN", confidence: 0.55, visibleEvidence: ["Task chair occupying the left half of the frame"] },
      { id: "lamp", label: "Desk lamp", category: "desk lamp", brand: null, model: null, role: "UNKNOWN", confidence: 0.52, visibleEvidence: ["Adjustable desk lamp occupying the right half of the frame"] },
    ],
    primarySubjectId: null,
    primarySubjectAmbiguous: true,
    condition: { status: "UNCERTAIN", summary: "Two unrelated items share the frame with similar prominence; condition was not assessed until one is chosen.", visibleIssues: [], confidence: 0.3 },
    compatibilityRequirements: { verified: [], likely: [], unknown: [] },
    searchIntent: { searchQuery: "unclear item", productType: "unknown item", requiredFeatures: [], preferredFeatures: [], compatibilityRequirements: [] },
    recommendedAction: { action: "CHOOSE_SUBJECT", reason: "The chair and the lamp are both prominent and unrelated; SENTINEL cannot guess which one you want inspected." },
    warnings: [],
    needsUserClarification: false,
    clarificationQuestions: [],
  },
  "missing-part-visible": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified a blender missing its lid.",
    detectedObjects: [
      { id: "blender", label: "Countertop blender", category: "blender", brand: null, model: null, role: "PRIMARY", confidence: 0.8, visibleEvidence: ["Blender jar and base visible", "No lid present on top of the jar"] },
    ],
    primarySubjectId: "blender",
    primarySubjectAmbiguous: false,
    condition: { status: "MISSING_PART", summary: "The blender jar has no lid in this photo.", visibleIssues: ["Lid is absent from the jar"], confidence: 0.72 },
    compatibilityRequirements: { verified: [], likely: ["Standard blender jar lid"], unknown: ["Jar diameter", "Brand-specific lid fitting"] },
    searchIntent: { searchQuery: "blender jar replacement lid", productType: "blender lid", requiredFeatures: [], preferredFeatures: [], compatibilityRequirements: ["Jar diameter compatibility"] },
    recommendedAction: { action: "SEARCH_PART", reason: "The jar is missing its lid, which is a part-level gap on an otherwise usable blender." },
    warnings: ["Brand and jar diameter are not visible in this photo."],
    needsUserClarification: true,
    clarificationQuestions: ["Do you know the blender's brand or model?"],
  },
  "image-too-blurry": {
    outcome: "IMAGE_TOO_BLURRY",
    outcomeMessage: "This photo is too blurry to identify the item reliably.",
    detectedObjects: [{ id: "unknown", label: "unknown item", category: "unknown", brand: null, model: null, role: "UNKNOWN", confidence: 0, visibleEvidence: [] }],
    primarySubjectId: null,
    primarySubjectAmbiguous: false,
    condition: { status: "UNCERTAIN", summary: "The photo is too blurry to assess condition.", visibleIssues: [], confidence: 0 },
    compatibilityRequirements: { verified: [], likely: [], unknown: [] },
    searchIntent: { searchQuery: "unclear item", productType: "unknown item", requiredFeatures: [], preferredFeatures: [], compatibilityRequirements: [] },
    recommendedAction: { action: "NO_ACTION", reason: "The image quality does not support any recommendation." },
    warnings: ["The photo is too blurry to identify details."],
    needsUserClarification: false,
    clarificationQuestions: [],
  },
  "irrelevant-photo": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified a houseplant; this does not appear to be a shoppable item in need of repair or replacement.",
    detectedObjects: [
      { id: "plant", label: "Potted houseplant", category: "houseplant", brand: null, model: null, role: "PRIMARY", confidence: 0.7, visibleEvidence: ["Green leafy plant in a ceramic pot"] },
    ],
    primarySubjectId: "plant",
    primarySubjectAmbiguous: false,
    condition: { status: "INTACT", summary: "The plant appears healthy with no visible damage.", visibleIssues: [], confidence: 0.65 },
    compatibilityRequirements: { verified: [], likely: [], unknown: [] },
    searchIntent: { searchQuery: "unclear item", productType: "unknown item", requiredFeatures: [], preferredFeatures: [], compatibilityRequirements: [] },
    recommendedAction: { action: "NO_ACTION", reason: "This does not appear to be a product that needs repair, replacement, or a purchase." },
    warnings: [],
    needsUserClarification: false,
    clarificationQuestions: [],
  },
} as const satisfies Record<string, InspectionAnalysis>;

export type InspectionFixtureName = keyof typeof inspectionFixtures;
export function isInspectionFixtureName(value: string): value is InspectionFixtureName {
  return value in inspectionFixtures;
}
