import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { OpenAIReasoner } from '@/lib/server/adapters/openai';
import { context, intent, product } from './fixtures';
beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'offline-test-key'); vi.stubEnv('SENTINEL_ALLOW_PAID_AI', 'true'); });
afterEach(() => vi.unstubAllEnvs());
const budget = () => ({ reserve: vi.fn().mockResolvedValue('reservation'), settle: vi.fn().mockResolvedValue(undefined) });
function result(value: unknown, status = 'completed') { return { status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 400, output_tokens: 200 } }; }
describe('bounded structured OpenAI requests', () => {
  it('uses cheap structured intent with no tools, storage or retries', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(intent))); const ledger = budget(); const ctx = context();
    expect(await new OpenAIReasoner(network, ledger).understand(intent.originalRequest, ctx)).toEqual(intent);
    const [url, options] = network.mock.calls[0]; const body = JSON.parse(String(options?.body));
    expect(url).toBe('https://api.openai.com/v1/responses'); expect(body).toMatchObject({ model: 'gpt-5.6-luna', store: false, tools: [], max_output_tokens: 1000, reasoning: { effort: 'none' }, text: { format: { type: 'json_schema', strict: true } } });
    expect(ctx.usage).toMatchObject({ modelCalls: 1, inputTokens: 400, outputTokens: 200 }); expect(ledger.reserve).toHaveBeenCalledOnce(); expect(ledger.settle).toHaveBeenCalledOnce();
  });
  it('uses Astra for evidence-rich technical compatibility', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result({ candidates: [] })));
    await new OpenAIReasoner(network, budget()).evaluate(intent, [{ ...product, description: 'USB-C DisplayPort Alt Mode listed' }], context());
    expect(JSON.parse(String(network.mock.calls[0][1]?.body))).toMatchObject({ model: 'gpt-6-astra', max_output_tokens: 1800, reasoning: { effort: 'low' } });
  });
  it('uses Luna for simple feature comparison', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result({ candidates: [] })));
    await new OpenAIReasoner(network, budget()).evaluate({ ...intent, compatibilityRequirements: [] }, [product], context());
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).model).toBe('gpt-5.6-luna');
  });
  it('retains unknown-cost reservations and sanitizes provider failures', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: 'secret-test-key' } }, { status: 401 })); const ledger = budget();
    await expect(new OpenAIReasoner(network, ledger).understand('monitor', context())).rejects.not.toThrow('secret-test-key'); expect(network).toHaveBeenCalledOnce(); expect(ledger.settle).not.toHaveBeenCalled();
  });
  it('fails closed for invalid structured output and incomplete generation', async () => {
    for (const value of [result({ bogus: true }), result(intent, 'incomplete')]) {
      const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(value));
      await expect(new OpenAIReasoner(network, budget()).understand('monitor', context())).rejects.toThrow(); expect(network).toHaveBeenCalledOnce();
    }
  });
  it('stops before network when disabled, over call limit, or budget rejected', async () => {
    const network = vi.fn<typeof fetch>(); const ledger = budget(); const provider = new OpenAIReasoner(network, ledger);
    vi.stubEnv('SENTINEL_ALLOW_PAID_AI', 'false'); await expect(provider.understand('monitor', context())).rejects.toThrow('disabled');
    vi.stubEnv('SENTINEL_ALLOW_PAID_AI', 'true'); const ctx = context(); ctx.usage.modelCalls = 2; await expect(provider.understand('monitor', ctx)).rejects.toThrow('two-call');
    ledger.reserve.mockRejectedValue(new Error('cap')); await expect(provider.understand('monitor', context())).rejects.toThrow('cap'); expect(network).not.toHaveBeenCalled();
  });
});
