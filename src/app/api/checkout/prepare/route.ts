import { checkoutActionSchema } from '@/lib/domain/checkout';
import { checkoutPost } from '@/lib/server/checkout-route';
import { checkoutService } from '@/lib/server/services/runtime';
export const runtime = 'nodejs';
export const maxDuration = 150;
export async function POST(request: Request) { return checkoutPost(request,checkoutActionSchema,(owner,input,signal) => checkoutService.prepare(owner,input.checkoutId,signal),135000); }
