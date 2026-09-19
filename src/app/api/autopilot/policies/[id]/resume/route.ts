import "server-only";
import { policyIdFrom } from "@/lib/autopilot/http";
import { confirmRequestSchema } from "@/lib/autopilot/requests";
import { autopilotService } from "@/lib/autopilot/runtime";
import { errorResponse, readJson, session } from "@/lib/server/http";
import { ProviderError } from "@/lib/server/provider-error";

export const runtime = "nodejs";

/** PAUSED -> ACTIVE. Requires { "confirm": true }; scheduling restarts from now (no back-fill). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const confirmed = confirmRequestSchema.safeParse(await readJson(request));
    const id = await policyIdFrom(params);
    if (!confirmed.success) throw new ProviderError("AUTOPILOT_CONFIRMATION_REQUIRED", confirmed.error.issues[0]?.message ?? "Confirmation is required.", 400);
    const { owner, headers } = session(request);
    return Response.json({ autopilot: await autopilotService.resume(owner, id) }, { headers });
  } catch (error) { return errorResponse(error); }
}
