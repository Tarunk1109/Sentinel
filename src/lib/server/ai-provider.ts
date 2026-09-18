import 'server-only';
import { OpenAIReasoner } from './adapters/openai';
import { ProviderError } from './provider-error';
import type { ImageInspector, ProductReasoner, SceneAnalyzer } from './services/live-contracts';

/** Gateway extension point. No assumed gateway model or silent provider fallback. */
export const AGNIC_GATEWAY = Object.freeze({ baseUrl: 'https://api.agnic.ai/v1', enabled: false, modelEnvironmentKey: 'AGNIC_AI_MODEL' });
export function createReasoner(): ProductReasoner & ImageInspector & SceneAnalyzer {
  const provider = process.env.AI_PROVIDER?.trim() || 'openai';
  if (provider === 'openai') return new OpenAIReasoner();
  // Defer the configuration error to submission, rather than breaking page/build.
  const disabled = async (): Promise<never> => { throw new ProviderError('AI_PROVIDER_UNAVAILABLE', 'This AI provider is not enabled. Keep AI_PROVIDER=openai until an Agnic Gateway model and structured-output contract are verified.', 503); };
  return { understand: disabled, evaluate: disabled, analyzeInspectionImage: disabled, analyzeBuildScene: disabled };
}
