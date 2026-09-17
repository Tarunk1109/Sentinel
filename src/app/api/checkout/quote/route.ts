import { checkoutQuoteSchema } from '@/lib/domain/checkout';
import { checkoutPost } from '@/lib/server/checkout-route';
import { checkoutService } from '@/lib/server/services/runtime';
export const runtime = 'nodejs';
export async function POST(request: Request) { return checkoutPost(request,checkoutQuoteSchema,(owner,input,signal) => checkoutService.quote(owner,input.checkoutId,signal,input.fulfillmentId)); }
