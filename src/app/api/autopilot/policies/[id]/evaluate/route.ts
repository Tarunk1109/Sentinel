import "server-only";
import { policyIdFrom, readOptionalJson } from "@/lib/autopilot/http";
import { autopilotService } from "@/lib/autopilot/runtime";
import { errorResponse, session } from "@/lib/server/http";

export const runtime = "nodejs";

/** Manual "run now": trigger check + intent generation only. No search, no purchase. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const body = await readOptionalJson(request);
    const id = await policyIdFrom(params);
    const { owner, headers } = session(request);
    return Response.json({ run: await autopilotService.evaluate(owner, id, body) }, { headers });
  } catch (error) { return errorResponse(error); }
}
