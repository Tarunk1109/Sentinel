import "server-only";
import { autopilotService } from "@/lib/autopilot/runtime";
import { assertLocalRequest, errorResponse, readJson, session } from "@/lib/server/http";

export const runtime = "nodejs";
// A policy at every size limit (8 items with brands) exceeds the 8 KB default.
const MAX_BODY_BYTES = 16_384;

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request);
    const { owner, headers } = session(request);
    return Response.json({ autopilots: await autopilotService.list(owner) }, { headers });
  } catch (error) { return errorResponse(error); }
}

/** Creates a DRAFT only. Activation is a separate, explicitly confirmed call. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request, MAX_BODY_BYTES);
    const { owner, headers } = session(request);
    return Response.json({ autopilot: await autopilotService.create(owner, body) }, { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}
