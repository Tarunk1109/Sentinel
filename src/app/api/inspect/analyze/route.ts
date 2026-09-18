import "server-only";
import { inspectImageRequestSchema, MAX_IMAGE_BYTES } from "@/lib/domain/inspection";
import { readJson, session, errorResponse } from "@/lib/server/http";
import { ProviderError } from "@/lib/server/provider-error";
import { inspectionService } from "@/lib/server/services/runtime";

export const runtime = "nodejs";
export const maxDuration = 60;
// Base64 grows a raw file by ~4/3; leave headroom for the JSON envelope around it.
const MAX_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8192;

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = inspectImageRequestSchema.safeParse(await readJson(request, MAX_BODY_BYTES));
    if (!parsed.success) throw new ProviderError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Provide a valid image.", 400);
    const { headers } = session(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55000)]);
    const result = await inspectionService.analyze(parsed.data.imageBase64, signal);
    return Response.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}
