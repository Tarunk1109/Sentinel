import "server-only";
import { policyIdFrom } from "@/lib/autopilot/http";
import { autopilotService } from "@/lib/autopilot/runtime";
import { assertLocalRequest, errorResponse, session } from "@/lib/server/http";

export const runtime = "nodejs";

/** Recent runs for one policy, newest first, with their audit events. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertLocalRequest(request);
    const id = await policyIdFrom(params);
    const { owner, headers } = session(request);
    return Response.json({ runs: await autopilotService.runs(owner, id) }, { headers });
  } catch (error) { return errorResponse(error); }
}
