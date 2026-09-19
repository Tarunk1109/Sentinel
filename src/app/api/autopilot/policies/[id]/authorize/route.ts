import "server-only";
import { policyIdFrom } from "@/lib/autopilot/http";
import { autopilotService } from "@/lib/autopilot/runtime";
import { errorResponse, readJson, session } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Mandate decision for selected search results: AUTO_AUTHORIZED / NEEDS_APPROVAL / BLOCKED.
 * Never places an order: AUTO_AUTHORIZED only means the standing mandate permits the action.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const body = await readJson(request);
    const id = await policyIdFrom(params);
    const { owner, headers } = session(request);
    return Response.json({ run: await autopilotService.authorize(owner, id, body) }, { headers });
  } catch (error) { return errorResponse(error); }
}
