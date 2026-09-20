import { z } from 'zod';
import { readJson, session, errorResponse } from '@/lib/server/http';
import { ProviderError } from '@/lib/server/provider-error';
import { commerceProvider } from '@/lib/server/services/runtime';

export const runtime = 'nodejs';

/** Read-only setup check. Reports whether the configured test-card alias resolves to a
 *  card on the account this deployment's credential belongs to. Never returns the alias,
 *  the credential, or any address. It cannot place or change an order. */
export async function POST(request: Request) {
  try {
    if (!z.object({}).strict().safeParse(await readJson(request)).success) throw new ProviderError('INVALID_SANDBOX_REQUEST', 'This check takes no parameters.', 400);
    const { headers } = session(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20000)]);
    const readiness = await commerceProvider.getSandboxPaymentReadiness({ signal, usage: { modelCalls: 0, agnicCalls: 0, inputTokens: 0, outputTokens: 0 } });
    return Response.json({ readiness }, { headers });
  } catch (error) { return errorResponse(error); }
}
