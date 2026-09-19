import "server-only";
import { autopilotService } from "@/lib/autopilot/runtime";
import { canonicalTimeZone, isValidTimeZone } from "@/lib/autopilot/time";
import { voiceCommandSchema, voiceInterpretRequestSchema } from "@/lib/voice/commands";
import { deterministicInterpreter } from "@/lib/voice/interpreter";
import { errorResponse, readJson, session } from "@/lib/server/http";
import { ProviderError } from "@/lib/server/provider-error";

export const runtime = "nodejs";

/**
 * Transcript TEXT in, one typed command out. No audio is accepted (JSON only), nothing is
 * stored, and interpreting never creates, activates, searches or buys anything: every
 * command still needs an explicit on-screen action.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = voiceInterpretRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ProviderError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Provide a transcript.", 400);
    const { transcript, timezone } = parsed.data;
    if (timezone !== undefined && !isValidTimeZone(timezone)) throw new ProviderError("INVALID_REQUEST", "Unknown timezone. Use an IANA name such as America/Vancouver.", 400);
    const { owner, headers } = session(request);
    const policies = (await autopilotService.list(owner)).map(({ policy }) => ({ id: policy.id, name: policy.name, status: policy.status }));
    const interpreted = await deterministicInterpreter.interpret(transcript, { policies, timezone: timezone ? canonicalTimeZone(timezone) : "UTC" });
    // Any interpreter's output (a future AI one included) must pass the strict schema; otherwise fail closed.
    const command = voiceCommandSchema.safeParse(interpreted);
    return Response.json({ command: command.success ? command.data : { type: "UNKNOWN", reason: "That command couldn't be understood safely. Try rephrasing it." } }, { headers });
  } catch (error) { return errorResponse(error); }
}
