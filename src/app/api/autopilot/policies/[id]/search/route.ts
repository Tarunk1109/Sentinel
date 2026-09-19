import "server-only";
import { policyIdFrom } from "@/lib/autopilot/http";
import { autopilotService } from "@/lib/autopilot/runtime";
import { errorResponse, readJson, session } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * Runs the existing SENTINEL commerce search (the same pipeline as Request/Inspect) for one
 * item of a run, using the run's server-generated intent. Explicit user action only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const body = await readJson(request);
    const id = await policyIdFrom(params);
    const { owner, headers } = session(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(85000)]);
    return Response.json(await autopilotService.search(owner, id, body, signal), { headers });
  } catch (error) { return errorResponse(error); }
}
