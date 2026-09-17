import "server-only";
import { AgnicCheckoutProvider } from "../adapters/agnic-checkout";
import { createReasoner } from '../ai-provider';
import { RequestMissionService } from "./request-mission";
import { CheckoutService } from './checkout';

export const commerceProvider = new AgnicCheckoutProvider();
export const missionService = new RequestMissionService(createReasoner(), commerceProvider);
export const checkoutService = new CheckoutService(commerceProvider, (owner, missionId, productId) => missionService.getSelection(owner, missionId, productId));
