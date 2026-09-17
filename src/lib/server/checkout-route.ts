import 'server-only';
import { z } from 'zod';
import { readJson, session, errorResponse } from './http';
import { ProviderError } from './provider-error';
import type { CheckoutSession } from '@/lib/domain/checkout';

export async function checkoutPost<T>(request: Request, schema: z.ZodType<T>, action: (owner: string, input: T, signal: AbortSignal) => CheckoutSession | Promise<CheckoutSession>, timeout = 60000): Promise<Response> {
  try {
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new ProviderError('INVALID_CHECKOUT_REQUEST', 'Use the selected product and current checkout controls. Extra safety flags, merchant IDs or prices are not accepted.', 400);
    const { owner, headers } = session(request);
    return Response.json({ checkout: await action(owner,parsed.data,AbortSignal.any([request.signal,AbortSignal.timeout(timeout)])) }, { headers });
  } catch (error) { return errorResponse(error); }
}
