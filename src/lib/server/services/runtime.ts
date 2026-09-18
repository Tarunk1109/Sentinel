import "server-only";
import { AgnicCheckoutProvider } from "../adapters/agnic-checkout";
import { createReasoner } from '../ai-provider';
import { RequestMissionService } from "./request-mission";
import { CheckoutService } from './checkout';
import { InspectionService } from './inspection';
import { BuildService } from './build';

const reasoner = createReasoner();
export const commerceProvider = new AgnicCheckoutProvider();
export const missionService = new RequestMissionService(reasoner, commerceProvider);
export const checkoutService = new CheckoutService(commerceProvider, (owner, missionId, productId) => missionService.getSelection(owner, missionId, productId));
export const inspectionService = new InspectionService(reasoner);
export const buildService = new BuildService(reasoner, missionService);
