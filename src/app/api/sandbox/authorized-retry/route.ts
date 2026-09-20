import { authorizedRetryConsentSchema, authorizedRetryStartSchema } from '@/lib/domain/checkout';
import { checkoutService } from '@/lib/server/services/runtime';
import { errorResponse, readJson, session } from '@/lib/server/http';
import { ProviderError } from '@/lib/server/provider-error';

export const runtime = 'nodejs';
export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const { owner, headers } = session(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
    const start = authorizedRetryStartSchema.safeParse(body);
    if (start.success) return Response.json({ checkout: await checkoutService.beginAuthorizedRetry(owner, start.data.previousOrderId, signal) }, { headers });
    const confirm = authorizedRetryConsentSchema.safeParse(body);
    if (confirm.success) return Response.json({ checkout: await checkoutService.confirmAuthorizedRetry(owner, confirm.data, signal) }, { headers });
    throw new ProviderError('INVALID_AUTHORIZED_RETRY_REQUEST', 'Only the exact provider-authorized retry operation is accepted.', 400);
  } catch (error) {
    return errorResponse(error);
  }
}
