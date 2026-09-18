import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { OpenAIReasoner } from '@/lib/server/adapters/openai';
import { context } from './fixtures';
import { inspectionFixtures } from '@/lib/server/demo/inspection-fixtures';

beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'offline-test-key'); vi.stubEnv('SENTINEL_ALLOW_PAID_AI', 'true'); });
afterEach(() => vi.unstubAllEnvs());

const budget = () => ({ reserve: vi.fn().mockResolvedValue('reservation'), settle: vi.fn().mockResolvedValue(undefined) });
function result(value: unknown, status = 'completed') { return { status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 900, output_tokens: 300 } }; }
const analyzed = inspectionFixtures['broken-office-chair-caster'];
const image = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), type: 'image/jpeg' as const, dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(2_000_000) };

describe('bounded structured OpenAI image inspection', () => {
  it('sends one multimodal request with the image as input_image, never as raw byte-length reservation', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(analyzed)));
    const ledger = budget(); const ctx = context();
    const analysis = await new OpenAIReasoner(network, ledger).analyzeInspectionImage(image, ctx);
    expect(analysis).toEqual(analyzed);
    const [url, options] = network.mock.calls[0]; const body = JSON.parse(String(options?.body));
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.input[0].content[1]).toEqual({ type: 'input_image', image_url: image.dataUrl });
    expect(ctx.usage).toMatchObject({ modelCalls: 1, inputTokens: 900, outputTokens: 300 });
    // A ~2.7 MB base64 payload (2,000,012 chars) must never inflate the reserved token estimate:
    // the fixed image ceiling plus the instructions' own length is used instead, which stays
    // orders of magnitude below what including the encoded string itself would produce.
    const [, reservedTokens] = ledger.reserve.mock.calls[0];
    expect(reservedTokens).toBeLessThan(20_000);
  });
  it('honors SENTINEL_INSPECT_MODEL when it names a known model', async () => {
    vi.stubEnv('SENTINEL_INSPECT_MODEL', 'gpt-6-astra');
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(analyzed)));
    await new OpenAIReasoner(network, budget()).analyzeInspectionImage(image, context());
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).model).toBe('gpt-6-astra');
  });
  it('ignores an unknown SENTINEL_INSPECT_MODEL and falls back to the economical default', async () => {
    vi.stubEnv('SENTINEL_INSPECT_MODEL', 'not-a-real-model');
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(analyzed)));
    await new OpenAIReasoner(network, budget()).analyzeInspectionImage(image, context());
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).model).toBe('gpt-5.6-luna');
  });
  it('surfaces a NO_OBJECT_DETECTED outcome from the model without treating it as an error', async () => {
    const noObject = { ...analyzed, outcome: 'NO_OBJECT_DETECTED', outcomeMessage: 'No object visible in this photo.' };
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(noObject)));
    const analysis = await new OpenAIReasoner(network, budget()).analyzeInspectionImage(image, context());
    expect(analysis.outcome).toBe('NO_OBJECT_DETECTED');
  });
  it('fails closed for invalid structured output, respects the two-call limit, and never retries', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result({ bogus: true })));
    await expect(new OpenAIReasoner(network, budget()).analyzeInspectionImage(image, context())).rejects.toThrow();
    expect(network).toHaveBeenCalledOnce();
    const network2 = vi.fn<typeof fetch>(); const ctx = context(); ctx.usage.modelCalls = 2;
    await expect(new OpenAIReasoner(network2, budget()).analyzeInspectionImage(image, ctx)).rejects.toThrow('two-call');
    expect(network2).not.toHaveBeenCalled();
  });
  it('sanitizes a provider failure so no credential or raw error body reaches the caller', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: 'secret-test-key-should-never-leak' } }, { status: 401 }));
    await expect(new OpenAIReasoner(network, budget()).analyzeInspectionImage(image, context())).rejects.not.toThrow('secret-test-key-should-never-leak');
  });
  it('stops before the network when paid AI is disabled or the budget rejects the reservation', async () => {
    vi.stubEnv('SENTINEL_ALLOW_PAID_AI', 'false');
    const network = vi.fn<typeof fetch>();
    await expect(new OpenAIReasoner(network, budget()).analyzeInspectionImage(image, context())).rejects.toThrow('disabled');
    vi.stubEnv('SENTINEL_ALLOW_PAID_AI', 'true');
    const ledger = budget(); ledger.reserve.mockRejectedValue(new Error('cap'));
    await expect(new OpenAIReasoner(network, ledger).analyzeInspectionImage(image, context())).rejects.toThrow('cap');
    expect(network).not.toHaveBeenCalled();
  });
});
