import "server-only";
import { previewRequestSchema } from "@/lib/domain/commerce";
import { readJson, session, errorResponse } from "@/lib/server/http";
import { ProviderError } from "@/lib/server/provider-error";
import { missionService } from "@/lib/server/services/runtime";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = previewRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ProviderError('INVALID_SELECTION', 'Select a product from an active mission to check its price.', 400);
    const { owner, headers } = session(request);
    const preview = await missionService.preview(owner, parsed.data.missionId, parsed.data.productId, AbortSignal.any([request.signal, AbortSignal.timeout(20000)]));
    return Response.json({ preview }, { headers });
  } catch (error) { return errorResponse(error); }
}
