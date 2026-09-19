import "server-only";
import { getAgnicToken } from "@/lib/server/config";
import { missionService } from "@/lib/server/services/runtime";
import { AutopilotService } from "./service";
import { InMemoryAutopilotStore } from "./store";

// `next dev` re-evaluates server modules whenever it compiles a route for the first time,
// which would silently wipe module-level state mid-demo. Holding the store on globalThis
// keeps it for the life of the process; `next start` never recompiles, so production
// behaviour is unchanged. The service itself is rebuilt from current code each time.
const holder = globalThis as typeof globalThis & { __sentinelAutopilotStore?: InMemoryAutopilotStore };
const store = (holder.__sentinelAutopilotStore ??= new InMemoryAutopilotStore());

/**
 * Wires Autopilot to the EXISTING commerce engine: the same RequestMissionService that
 * Request and Inspect use for search, and its owner-scoped result cache for reading back a
 * selected product's real price. No checkout, quote or dispatch capability is passed in.
 */
export const autopilotService = new AutopilotService(store, {
  isAvailable: () => getAgnicToken() !== undefined,
  search: (intent, owner, signal) => missionService.runFromIntent(intent, owner, signal),
  getSelection: (owner, missionId, productId) => missionService.getSelection(owner, missionId, productId),
});
