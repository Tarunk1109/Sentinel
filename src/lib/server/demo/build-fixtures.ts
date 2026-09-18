import "server-only";
import type { BuildAnalysis, BuildComponent } from "@/lib/domain/build";
import type { ProductCandidate } from "@/lib/domain/commerce";

/**
 * DEVELOPMENT FIXTURE build scenes and product results. These never run in normal production
 * execution: they exist only for offline automated tests and an explicit, opt-in local dev
 * bypass (`SENTINEL_BUILD_FIXTURE`), which must stay unset for any real demo or deployment.
 * Fixture products are clearly labelled invented data and are never stored through the real
 * mission/checkout pipeline, so they can never be selected for checkout by construction, not
 * only by convention.
 */

function component(id: string, overrides: Partial<BuildComponent> & Pick<BuildComponent, "name" | "category" | "role">): BuildComponent {
  return {
    id, brand: null, model: null, confidence: 0.75, visibleEvidence: [], inferredRequirements: [],
    compatibilityRequirements: [], unknowns: [], quantity: 1, componentKind: "PURCHASABLE", parentComponentId: null, ...overrides,
  };
}

function fixtureProduct(id: string, name: string, amountMinor: number, description: string): ProductCandidate {
  return {
    id, sku: `fixture-sku-${id}`, productGid: null, name: `${name} (DEVELOPMENT FIXTURE)`, brand: null, description,
    merchantName: "Fixture Demo Merchant (invented, not real)", merchantId: null, merchantUrl: null, productUrl: null, imageUrl: null,
    price: { amountMinor, currency: "CAD" }, availability: "available", country: "CA", onboardRequired: false,
    metadata: {}, compatibility: { status: "NEEDS_VERIFICATION", reasons: [], missingInformation: ["Fixture data has no real listing evidence."] },
    requiredConstraintsSatisfied: null, score: 0, recommendation: "Invented development fixture option.",
  };
}

export const buildAnalysisFixtures = {
  "gaming-desk-setup": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified a minimal gaming desk setup with a monitor, keyboard, mouse, and accessories.",
    scene: { title: "Minimal gaming desk setup", description: "A single-monitor desk setup with a keyboard, mouse, monitor arm, and light decorative accents.", confidence: 0.8 },
    components: [
      component("desk", { name: "Desk", category: "desk", role: "ESSENTIAL", confidence: 0.85, visibleEvidence: ["Rectangular desk surface spanning the frame"], inferredRequirements: ["Must physically fit the monitor and accessories"], unknowns: ["Desk width and depth", "Available room space"] }),
      component("monitor", { name: "Monitor", category: "external monitor", role: "ESSENTIAL", confidence: 0.82, visibleEvidence: ["Single external monitor on a stand"], inferredRequirements: ["Should suit typical desktop viewing distance"], compatibilityRequirements: ["VESA mount pattern for the monitor arm"], unknowns: ["Exact screen size", "VESA pattern", "Weight"] }),
      component("keyboard", { name: "Keyboard", category: "keyboard", role: "ESSENTIAL", confidence: 0.7, visibleEvidence: ["Keyboard visible on the desk surface"], unknowns: ["Layout", "Wired or wireless"] }),
      component("mouse", { name: "Mouse", category: "mouse", role: "ESSENTIAL", confidence: 0.7, visibleEvidence: ["Mouse visible beside the keyboard"] }),
      component("monitor-arm", { name: "Monitor arm", category: "monitor arm", role: "RECOMMENDED", confidence: 0.55, visibleEvidence: ["Monitor appears mounted on an articulating arm rather than its stock stand"], inferredRequirements: ["Must support the monitor's VESA pattern and weight"], compatibilityRequirements: ["Monitor VESA pattern and weight"], unknowns: ["Monitor weight", "Desk clamp thickness"] }),
      component("desk-mat", { name: "Desk mat", category: "desk mat", role: "RECOMMENDED", confidence: 0.5, visibleEvidence: ["A mat-like surface under the keyboard and mouse"], unknowns: ["Desk mat size"] }),
      component("led-lighting", { name: "LED lighting", category: "LED strip light", role: "DECORATIVE", confidence: 0.45, visibleEvidence: ["Ambient colored light visible along the desk edge"] }),
    ],
    dependencies: [
      { sourceComponentId: "monitor-arm", targetComponentId: "monitor", relationship: "The monitor arm must support the monitor's VESA mount pattern and weight.", importance: "REQUIRED" },
      { sourceComponentId: "desk", targetComponentId: "monitor", relationship: "The desk surface must physically fit the monitor's footprint or clamp.", importance: "RECOMMENDED" },
    ],
    existingItems: [],
    missingInformation: ["Total budget", "Whether a monitor arm is wanted", "Room dimensions"],
    needsClarification: true,
    clarificationQuestions: ["What is your maximum budget?", "Do you already own a computer or monitor?"],
    buildSummary: "A minimal single-monitor gaming desk setup. Core components are clear; exact sizes and an existing computer/monitor remain unknown.",
  },
  "home-office-setup": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified a home office setup with a desk, chair, monitor, and video-call accessories.",
    scene: { title: "Home office setup", description: "A desk-and-chair home office setup with a monitor and basic video-call accessories.", confidence: 0.78 },
    components: [
      component("desk", { name: "Desk", category: "desk", role: "ESSENTIAL", confidence: 0.85, visibleEvidence: ["Desk surface with a chair pulled up to it"] }),
      component("office-chair", { name: "Office chair", category: "office chair", role: "ESSENTIAL", confidence: 0.8, visibleEvidence: ["Task chair with armrests and casters"], inferredRequirements: ["Should suit the desk's height"], unknowns: ["Desk height"] }),
      component("monitor", { name: "Monitor", category: "external monitor", role: "ESSENTIAL", confidence: 0.7, visibleEvidence: ["External monitor on the desk"], unknowns: ["Screen size"] }),
      component("webcam", { name: "Webcam", category: "webcam", role: "RECOMMENDED", confidence: 0.5, visibleEvidence: ["Small camera mounted on or near the monitor"] }),
      component("desk-lamp", { name: "Desk lamp", category: "desk lamp", role: "OPTIONAL", confidence: 0.45, visibleEvidence: ["Adjustable lamp at the edge of the desk"] }),
      component("cable-organizer", { name: "Cable organizer", category: "cable organizer", role: "DECORATIVE", confidence: 0.35, visibleEvidence: ["Cables appear bundled along the desk leg"] }),
    ],
    dependencies: [
      { sourceComponentId: "office-chair", targetComponentId: "desk", relationship: "The chair's seat height should suit the desk's height.", importance: "RECOMMENDED" },
    ],
    existingItems: [],
    missingInformation: ["Total budget", "Whether the user already owns a computer"],
    needsClarification: true,
    clarificationQuestions: ["What is your maximum budget?", "Do you already own a computer?"],
    buildSummary: "A standard desk-and-chair home office setup with a monitor and light video-call accessories.",
  },
  "simple-streaming-setup": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified a simple streaming setup with a camera, microphone, and lighting.",
    scene: { title: "Simple streaming setup", description: "A desk-mounted streaming setup with a webcam, microphone, ring light, and optional capture card.", confidence: 0.75 },
    components: [
      component("webcam", { name: "Streaming camera", category: "webcam", role: "ESSENTIAL", confidence: 0.75, visibleEvidence: ["Camera mounted on an arm above the desk"], compatibilityRequirements: ["Desk mount arm weight capacity"], unknowns: ["Camera weight"] }),
      component("microphone", { name: "Microphone", category: "USB microphone", role: "ESSENTIAL", confidence: 0.72, visibleEvidence: ["Microphone on a boom arm near the desk edge"] }),
      component("ring-light", { name: "Ring light", category: "ring light", role: "RECOMMENDED", confidence: 0.6, visibleEvidence: ["Circular light positioned facing the seating area"] }),
      component("desk-mount-arm", { name: "Camera mount arm", category: "desk mount arm", role: "RECOMMENDED", confidence: 0.55, visibleEvidence: ["Articulating arm holding the camera"], inferredRequirements: ["Must support the camera's weight"], compatibilityRequirements: ["Camera weight"], unknowns: ["Camera weight", "Desk edge thickness"] }),
      component("capture-card", { name: "Capture card", category: "capture card", role: "OPTIONAL", confidence: 0.3, visibleEvidence: [] }),
      component("green-screen", { name: "Green screen", category: "green screen backdrop", role: "DECORATIVE", confidence: 0.4, visibleEvidence: ["Solid green backdrop behind the seating area"] }),
    ],
    dependencies: [
      { sourceComponentId: "desk-mount-arm", targetComponentId: "webcam", relationship: "The mount arm must support the camera's weight.", importance: "RECOMMENDED" },
    ],
    existingItems: [],
    missingInformation: ["Total budget", "Existing computer/capture hardware"],
    needsClarification: true,
    clarificationQuestions: ["What is your maximum budget?", "Do you already own a capture card or computer for streaming?"],
    buildSummary: "A simple desk streaming setup centered on a camera, microphone, and lighting, with an optional capture card.",
  },
  "desk-with-integrated-storage": {
    outcome: "ANALYZED",
    outcomeMessage: "Identified a compact wooden computer desk with a built-in keyboard shelf and storage compartment, plus a separate folding chair.",
    scene: { title: "Compact desk and chair setup", description: "A compact wooden computer desk with an integrated pull-out keyboard/work shelf and a lower storage compartment, next to a separate black folding chair.", confidence: 0.82 },
    components: [
      component("desk", { name: "Compact wooden computer desk", category: "computer desk", role: "ESSENTIAL", confidence: 0.88, visibleEvidence: ["Compact wooden desk surface with a pull-out shelf and an enclosed lower compartment"], inferredRequirements: ["Must fit a computer setup in a compact footprint"], unknowns: ["Exact desk dimensions", "Weight capacity"] }),
      component("keyboard-shelf", { name: "Pull-out keyboard/work shelf", category: "keyboard shelf", role: "RECOMMENDED", confidence: 0.8, visibleEvidence: ["A pull-out shelf beneath the desktop, sized for a keyboard"], inferredRequirements: ["Must slide freely beneath the desktop"], componentKind: "INTEGRATED_FEATURE", parentComponentId: "desk" }),
      component("storage-compartment", { name: "Lower storage compartment", category: "storage compartment", role: "RECOMMENDED", confidence: 0.75, visibleEvidence: ["An enclosed storage compartment below the desktop"], componentKind: "INTEGRATED_FEATURE", parentComponentId: "desk" }),
      component("chair", { name: "Black folding chair", category: "folding chair", role: "ESSENTIAL", confidence: 0.85, visibleEvidence: ["A separate black folding chair beside the desk"], unknowns: ["Weight capacity", "Seat dimensions"] }),
    ],
    dependencies: [],
    existingItems: [],
    missingInformation: ["Total budget", "Room dimensions"],
    needsClarification: true,
    clarificationQuestions: ["What is your maximum budget?"],
    buildSummary: "A compact desk-and-chair setup. The desk has a built-in pull-out keyboard shelf and lower storage compartment, which are integrated features of the desk, not separately purchasable products.",
  },
} as const satisfies Record<string, BuildAnalysis>;

export type BuildFixtureName = keyof typeof buildAnalysisFixtures;
export function isBuildFixtureName(value: string): value is BuildFixtureName {
  return value in buildAnalysisFixtures;
}

/** Invented product options per component, keyed by fixture name then component id. Never real listings. */
export const buildProductFixtures: Record<BuildFixtureName, Record<string, ProductCandidate[]>> = {
  "gaming-desk-setup": {
    desk: [fixtureProduct("desk-1", "Compact gaming desk", 17900, "120cm x 60cm desk surface."), fixtureProduct("desk-2", "Adjustable-height desk", 24900, "Sit-stand desk, 120cm wide.")],
    monitor: [fixtureProduct("monitor-1", "27-inch 144Hz monitor", 24900, "27 inch, VESA 100x100mm mount."), fixtureProduct("monitor-2", "24-inch monitor", 17900, "24 inch, VESA 75x75mm mount.")],
    keyboard: [fixtureProduct("keyboard-1", "Mechanical keyboard", 7900, "Tenkeyless mechanical keyboard."), fixtureProduct("keyboard-2", "Wireless keyboard", 5900, "Compact wireless keyboard.")],
    mouse: [fixtureProduct("mouse-1", "Wireless gaming mouse", 4900, "Lightweight wireless mouse."), fixtureProduct("mouse-2", "Wired gaming mouse", 2900, "Wired optical mouse.")],
    "monitor-arm": [fixtureProduct("arm-1", "Single monitor arm", 7900, "VESA 75x75/100x100mm, supports up to 9kg."), fixtureProduct("arm-2", "Heavy-duty monitor arm", 9900, "VESA 100x100mm, supports up to 12kg.")],
    "desk-mat": [fixtureProduct("mat-1", "Large desk mat", 3900, "90cm x 40cm desk mat.")],
    "led-lighting": [fixtureProduct("led-1", "LED strip light", 2900, "USB-powered RGB LED strip.")],
  },
  "home-office-setup": {
    desk: [fixtureProduct("desk-3", "Home office desk", 19900, "140cm x 70cm desk surface."), fixtureProduct("desk-4", "Compact writing desk", 12900, "100cm x 50cm desk surface.")],
    "office-chair": [fixtureProduct("chair-1", "Ergonomic office chair", 22900, "Adjustable height, lumbar support."), fixtureProduct("chair-2", "Mesh task chair", 14900, "Breathable mesh back, adjustable height.")],
    monitor: [fixtureProduct("monitor-3", "24-inch office monitor", 15900, "24 inch, VESA 100x100mm mount.")],
    webcam: [fixtureProduct("webcam-1", "1080p webcam", 4900, "1080p USB webcam with autofocus.")],
    "desk-lamp": [fixtureProduct("lamp-1", "LED desk lamp", 3900, "Adjustable LED desk lamp.")],
    "cable-organizer": [fixtureProduct("cable-1", "Under-desk cable tray", 1900, "Clip-on cable management tray.")],
  },
  "simple-streaming-setup": {
    webcam: [fixtureProduct("cam-1", "1080p streaming camera", 8900, "1080p 60fps USB camera."), fixtureProduct("cam-2", "4K streaming camera", 15900, "4K 30fps USB camera.")],
    microphone: [fixtureProduct("mic-1", "USB condenser microphone", 9900, "Cardioid USB condenser microphone."), fixtureProduct("mic-2", "Dynamic USB microphone", 12900, "Dynamic broadcast-style USB microphone.")],
    "ring-light": [fixtureProduct("ring-1", "10-inch ring light", 3900, "10 inch LED ring light with phone/camera clip.")],
    "desk-mount-arm": [fixtureProduct("mount-1", "Camera desk mount arm", 5900, "Supports up to 2kg camera weight.")],
    "capture-card": [fixtureProduct("capture-1", "USB capture card", 6900, "HDMI to USB 3.0 capture card.")],
    "green-screen": [fixtureProduct("green-1", "Collapsible green screen", 4900, "150cm x 200cm collapsible backdrop.")],
  },
  "desk-with-integrated-storage": {
    // Deliberately no entries for "keyboard-shelf"/"storage-compartment": they are
    // integrated features of the desk and must never be independently searched. If a
    // future regression ever tried, it would fail loudly (a fixture-not-configured
    // error) rather than silently returning a fabricated separate product.
    desk: [fixtureProduct("desk-5", "Compact wooden computer desk with pull-out shelf and storage", 15000, "A compact wooden computer desk with an integrated pull-out keyboard shelf and a lower storage compartment.")],
    chair: [fixtureProduct("chair-3", "Black folding chair", 4000, "A black folding chair.")],
  },
};
