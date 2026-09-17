import { checkoutActionSchema } from '@/lib/domain/checkout';
import { assertLocalRequest, session, errorResponse } from '@/lib/server/http';
import { ProviderError } from '@/lib/server/provider-error';
import { checkoutService } from '@/lib/server/services/runtime';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const parsed = checkoutActionSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ProviderError('INVALID_CHECKOUT_REQUEST', 'A current checkout session ID is required.', 400);
    const { owner,headers } = session(request);
    return Response.json({ checkout: await checkoutService.refresh(owner,parsed.data.checkoutId,AbortSignal.any([request.signal,AbortSignal.timeout(25000)])) }, { headers });
  } catch (error) { return errorResponse(error); }
}
