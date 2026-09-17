import { z } from 'zod';
import { readJson, session, errorResponse } from '@/lib/server/http';
import { ProviderError } from '@/lib/server/provider-error';
import { checkoutService } from '@/lib/server/services/runtime';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    if (!z.object({}).strict().safeParse(await readJson(request)).success) throw new ProviderError('INVALID_SANDBOX_REQUEST', 'Test merchant identity is supplied by the server, not the browser.', 400);
    const { headers } = session(request);
    return Response.json({ sandbox: await checkoutService.sandboxCatalog(AbortSignal.any([request.signal,AbortSignal.timeout(35000)])) }, { headers });
  } catch (error) { return errorResponse(error); }
}
