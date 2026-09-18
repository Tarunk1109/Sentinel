import "server-only";
import type { MissionEvent } from "@/lib/domain/commerce";
import { inspectSearchRequestSchema } from "@/lib/domain/inspection";
import { readJson, session, errorResponse } from "@/lib/server/http";
import { ProviderError, publicError } from "@/lib/server/provider-error";
import { missionService } from "@/lib/server/services/runtime";

export const runtime = "nodejs";
export const maxDuration = 90;
// A fully populated ProductIntent (max-length arrays) exceeds the default 8 KB JSON cap.
const MAX_BODY_BYTES = 20_000;

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = inspectSearchRequestSchema.safeParse(await readJson(request, MAX_BODY_BYTES));
    if (!parsed.success) throw new ProviderError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Provide a valid search intent.", 400);
    const { owner, headers } = session(request);
    const cancelled = new AbortController();
    const signal = AbortSignal.any([request.signal, cancelled.signal, AbortSignal.timeout(85000)]);
    if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
      return Response.json({ mission: await missionService.runFromIntent(parsed.data.intent, owner, signal) }, { headers });
    }
    const encoder = new TextEncoder(); let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: MissionEvent) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
        try { emit({ type: "complete", mission: await missionService.runFromIntent(parsed.data.intent, owner, signal, emit) }); }
        catch (error) { emit({ type: "error", error: publicError(error) }); }
        finally { if (!closed) { closed = true; controller.close(); } }
      },
      cancel() { closed = true; cancelled.abort(); },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
