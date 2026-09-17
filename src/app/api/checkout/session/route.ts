import { checkoutSelectionSchema } from '@/lib/domain/checkout';
import { checkoutPost } from '@/lib/server/checkout-route';
import { checkoutService } from '@/lib/server/services/runtime';
export const runtime = 'nodejs';
export async function POST(request: Request) { return checkoutPost(request,checkoutSelectionSchema,(owner,input) => checkoutService.begin(owner,input.missionId,input.productId)); }
