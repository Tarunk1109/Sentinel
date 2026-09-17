import "server-only";
import { submissionSchema, type MissionEvent } from "@/lib/domain/commerce";
import { readJson, session, errorResponse } from "@/lib/server/http";
import { ProviderError, publicError } from "@/lib/server/provider-error";
import { missionService } from "@/lib/server/services/runtime";

export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = submissionSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ProviderError('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Enter a valid request.', 400);
    const { owner, headers } = session(request);
    const cancelled = new AbortController();
    const signal = AbortSignal.any([request.signal, cancelled.signal, AbortSignal.timeout(85000)]);
    if (!request.headers.get('accept')?.includes('application/x-ndjson')) {
      return Response.json({ mission: await missionService.run(parsed.data.prompt, owner, signal) }, { headers });
    }
    const encoder = new TextEncoder(); let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: MissionEvent) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); };
        try { emit({ type: 'complete', mission: await missionService.run(parsed.data.prompt, owner, signal, emit) }); }
        catch (error) { emit({ type: 'error', error: publicError(error) }); }
        finally { if (!closed) { closed = true; controller.close(); } }
      },
      cancel() { closed = true; cancelled.abort(); },
    });
    return new Response(stream, { headers: { ...headers, 'Content-Type': 'application/x-ndjson', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return errorResponse(error); }
}
