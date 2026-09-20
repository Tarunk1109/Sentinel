import { sandboxAutoQuoteSchema } from '@/lib/domain/checkout';
import { checkoutPost } from '@/lib/server/checkout-route';
import { checkoutService } from '@/lib/server/services/runtime';

export const runtime = 'nodejs';
export const maxDuration = 90;

export async function POST(request: Request) {
  return checkoutPost(request, sandboxAutoQuoteSchema, (owner, input, signal) =>
    checkoutService.autoQuoteSandbox(owner, input.productId, signal), 90_000);
}
