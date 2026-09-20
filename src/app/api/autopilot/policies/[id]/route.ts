import "server-only";
import { policyIdFrom } from "@/lib/autopilot/http";
import { autopilotService } from "@/lib/autopilot/runtime";
import { assertLocalRequest, errorResponse, readJson, session } from "@/lib/server/http";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 16_384;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertLocalRequest(request);
    const id = await policyIdFrom(params);
    const { owner, headers } = session(request);
    return Response.json({ autopilot: await autopilotService.get(owner, id) }, { headers });
  } catch (error) { return errorResponse(error); }
}

/** Name/goal can change at any time; mandate fields only while DRAFT or PAUSED. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const body = await readJson(request, MAX_BODY_BYTES);
    const id = await policyIdFrom(params);
    const { owner, headers } = session(request);
    return Response.json({ autopilot: await autopilotService.update(owner, id, body) }, { headers });
  } catch (error) { return errorResponse(error); }
}
