import "server-only";
import { z } from "zod";
import { policyIdFrom, readOptionalJson } from "@/lib/autopilot/http";
import { autopilotService } from "@/lib/autopilot/runtime";
import { errorResponse, session } from "@/lib/server/http";
import { ProviderError } from "@/lib/server/provider-error";

export const runtime = "nodejs";

/** ACTIVE -> PAUSED. Reduces authority, so no confirmation is required. Idempotent. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const body = await readOptionalJson(request);
    const id = await policyIdFrom(params);
    if (!z.object({}).strict().safeParse(body).success) throw new ProviderError("INVALID_REQUEST", "Pause takes no options.", 400);
    const { owner, headers } = session(request);
    return Response.json({ autopilot: await autopilotService.pause(owner, id) }, { headers });
  } catch (error) { return errorResponse(error); }
}
