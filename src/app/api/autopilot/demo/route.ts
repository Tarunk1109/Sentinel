import "server-only";
import { readOptionalJson } from "@/lib/autopilot/http";
import { demoRequestSchema } from "@/lib/autopilot/requests";
import { autopilotService } from "@/lib/autopilot/runtime";
import { errorResponse, session } from "@/lib/server/http";
import { ProviderError } from "@/lib/server/provider-error";

export const runtime = "nodejs";

/** DEV/TEST ONLY: seeds the café DEMO autopilot (demo: true). Returns 503 in production. */
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = demoRequestSchema.safeParse(await readOptionalJson(request));
    if (!parsed.success) throw new ProviderError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Provide a valid timezone.", 400);
    const { owner, headers } = session(request);
    return Response.json({ autopilot: await autopilotService.seedDemo(owner, parsed.data.timezone ?? "UTC") }, { headers });
  } catch (error) { return errorResponse(error); }
}
