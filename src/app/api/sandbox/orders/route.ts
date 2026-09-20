import { z } from 'zod';
import { readJson, session, errorResponse } from '@/lib/server/http';
import { ProviderError } from '@/lib/server/provider-error';
import { commerceProvider } from '@/lib/server/services/runtime';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Read-only sandbox order history, straight from Agnic. Every figure shown is the
 *  provider's own record rather than anything this browser stored. It cannot place,
 *  change or repeat an order. */
export async function POST(request: Request) {
  try {
    if (!z.object({}).strict().safeParse(await readJson(request)).success) throw new ProviderError('INVALID_SANDBOX_REQUEST', 'This history takes no parameters.', 400);
    const { headers } = session(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
    const orders = await commerceProvider.listOrders({ signal, usage: { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 } });
    return Response.json({ orders }, { headers });
  } catch (error) { return errorResponse(error); }
}
