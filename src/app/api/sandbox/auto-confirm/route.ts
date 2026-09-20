import { sandboxAutoConfirmSchema } from '@/lib/domain/checkout';
import { checkoutPost } from '@/lib/server/checkout-route';
import { checkoutService } from '@/lib/server/services/runtime';
export const runtime = 'nodejs';
export const maxDuration = 90;
export async function POST(request: Request) { return checkoutPost(request, sandboxAutoConfirmSchema, (owner, input, signal) => checkoutService.autoConfirmSandbox(owner, input.productId, signal), 90_000); }
