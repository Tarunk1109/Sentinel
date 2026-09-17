import "server-only";

import type { AgentStep, Mission, UnderstoodIntent } from "@/lib/domain/types";
import { DemoProductDiscoveryService } from "@/lib/server/demo/discovery";
import { DemoIntentService } from "@/lib/server/demo/intent";
import type {
  IntentUnderstandingService,
  MissionService,
  ProductDiscoveryService,
} from "@/lib/server/services/contracts";

function buildSteps(intent: UnderstoodIntent, count: number): AgentStep[] {
  return [
    { id: "understand", label: "Understand intent", detail: "Demo parser reads the category and numeric USD budget. Live AI reasoning is not connected.", status: "complete" },
    { id: "search", label: "Search products", detail: count ? `Found ${count} invented demo products in the local sample catalog.` : "No matching demo products. Try a monitor, keyboard, headphones, or USB hub with a suitable USD budget.", status: "complete" },
    { id: "compare", label: "Compare options", detail: count ? "Sample options filtered by category and budget. Recommendations are illustrative, not a live evaluation." : "No matching options are available to compare.", status: count ? "complete" : "blocked" },
    { id: "verify", label: "Verify compatibility", detail: intent.compatibilityTarget ? `${intent.compatibilityTarget} compatibility is unverified. Live specifications and exact device details are needed.` : "Compatibility is unverified. Live specifications and exact device details are needed.", status: "blocked" },
    { id: "select", label: "Select a product", detail: count ? "Select a demo option to inspect the approval panel." : "Submit another request to find a demo option.", status: count ? "active" : "pending" },
    { id: "preview", label: "Preview exact order", detail: "Agnic order preview is not connected. No shipping, tax, or exact payable total is available.", status: "pending" },
    { id: "consent", label: "Explicit approval", detail: "Purchase consent will be requested only after a real, unexpired order preview is available.", status: "pending" },
    { id: "purchase", label: "Place order & show proof", detail: "Purchasing is disabled in Milestone 1. No payment or order will be submitted.", status: "pending" },
  ];
}

/** Legacy M1 demo fixture, used only by offline regression tests. No live route imports this module. */
export class DemoMissionService implements MissionService {
  constructor(
    private readonly understanding: IntentUnderstandingService = new DemoIntentService(),
    private readonly discovery: ProductDiscoveryService = new DemoProductDiscoveryService(),
  ) {}

  async run(prompt: string): Promise<Mission> {
    const intent = await this.understanding.understand(prompt);
    const products = await this.discovery.search(intent);
    const count = products.length;
    const noResultsReason = intent.currency === "unsupported"
      ? "The demo catalog supports USD only."
      : !intent.category
        ? "The demo supports one category per request: monitors, keyboards, headphones, or USB hubs."
        : "No demo products match this budget.";

    return {
      id: crypto.randomUUID(),
      prompt,
      mode: "request",
      status: count ? "ready" : "no-results",
      summary: count
        ? `${count} demo options match your category and numeric USD budget. All products, specifications, and prices are invented sample data. Other requirements and compatibility remain unverified.`
        : `${noResultsReason} This is an invented sample catalog, not a live product search.`,
      constraints: intent.constraints,
      products,
      steps: buildSteps(intent, count),
      source: "demo",
      createdAt: new Date().toISOString(),
    };
  }
}

export function createMissionService(): MissionService {
  return new DemoMissionService();
}
