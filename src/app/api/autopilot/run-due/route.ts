import "server-only";
import { z } from "zod";
import { readOptionalJson } from "@/lib/autopilot/http";
import { autopilotService } from "@/lib/autopilot/runtime";
import { errorResponse, session } from "@/lib/server/http";
import { ProviderError } from "@/lib/server/provider-error";

export const runtime = "nodejs";

/**
 * Evaluates this session's due ACTIVE policies once per schedule slot. On-demand only: no
 * background scheduler calls this. A hosted cron would need its own authenticated entry point.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readOptionalJson(request);
    if (!z.object({}).strict().safeParse(body).success) throw new ProviderError("INVALID_REQUEST", "run-due takes no options.", 400);
    const { owner, headers } = session(request);
    return Response.json({ runs: await autopilotService.runDue(owner) }, { headers });
  } catch (error) { return errorResponse(error); }
}
