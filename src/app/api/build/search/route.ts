import "server-only";
import { buildSearchRequestSchema } from "@/lib/domain/build";
import { readJson, session, errorResponse } from "@/lib/server/http";
import { ProviderError, publicError } from "@/lib/server/provider-error";
import { buildService } from "@/lib/server/services/runtime";

export const runtime = "nodejs";
export const maxDuration = 90;
// The signed session token carries the full analysis (up to 12 components' worth of
// evidence/requirement text) instead of a short id, and priorResults echoes back
// previously found products; both are bounded by the schema, but need more room than the
// 8192-byte default.
const MAX_BODY_BYTES = 400_000;

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = buildSearchRequestSchema.safeParse(await readJson(request, MAX_BODY_BYTES));
    if (!parsed.success) throw new ProviderError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Provide a valid selection.", 400);
    const { owner, headers } = session(request);
    const cancelled = new AbortController();
    const signal = AbortSignal.any([request.signal, cancelled.signal, AbortSignal.timeout(85000)]);
    if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
      const built = await buildService.search(owner, parsed.data.token, parsed.data.selectedIds, parsed.data.priorResults, parsed.data.clarification, signal);
      return Response.json({ session: built }, { headers });
    }
    const encoder = new TextEncoder(); let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: unknown) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
        try { await buildService.search(owner, parsed.data.token, parsed.data.selectedIds, parsed.data.priorResults, parsed.data.clarification, signal, emit); }
        catch (error) { emit({ type: "error", error: publicError(error) }); }
        finally { if (!closed) { closed = true; controller.close(); } }
      },
      cancel() { closed = true; cancelled.abort(); },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
