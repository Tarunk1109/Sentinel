import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { OpenAIReasoner } from '@/lib/server/adapters/openai';
import { context, intent } from './fixtures';
import { buildAnalysisFixtures } from '@/lib/server/demo/build-fixtures';
import { inspectionFixtures } from '@/lib/server/demo/inspection-fixtures';

beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'offline-test-key'); vi.stubEnv('SENTINEL_ALLOW_PAID_AI', 'true'); });
afterEach(() => vi.unstubAllEnvs());

const budget = () => ({ reserve: vi.fn().mockResolvedValue('reservation'), settle: vi.fn().mockResolvedValue(undefined) });
function result(value: unknown, status = 'completed') { return { status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 900, output_tokens: 500 } }; }
const scene = buildAnalysisFixtures['gaming-desk-setup'];
const image = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), type: 'image/jpeg' as const, dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(2_000_000) };

describe('bounded structured OpenAI build scene analysis', () => {
  it('sends one multimodal request with the image and constraints text, never a raw byte-length reservation', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(scene)));
    const ledger = budget(); const ctx = context();
    const analysis = await new OpenAIReasoner(network, ledger).analyzeBuildScene(image, { goal: 'gaming desk', alreadyOwn: 'a MacBook', requirements: 'under C$800' }, ctx);
    expect(analysis).toEqual(scene);
    const [url, options] = network.mock.calls[0]; const body = JSON.parse(String(options?.body));
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.input[0].content[1]).toEqual({ type: 'input_image', image_url: image.dataUrl });
    expect(body.input[0].content[0].text).toContain('gaming desk');
    expect(body.input[0].content[0].text).toContain('MacBook');
    expect(ctx.usage).toMatchObject({ modelCalls: 1, inputTokens: 900, outputTokens: 500 });
    const [, reservedTokens] = ledger.reserve.mock.calls[0];
    expect(reservedTokens).toBeLessThan(20_000);
  });
  it('honors SENTINEL_BUILD_MODEL when it names a known model, independent of SENTINEL_INSPECT_MODEL', async () => {
    vi.stubEnv('SENTINEL_BUILD_MODEL', 'gpt-6-astra');
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(scene)));
    await new OpenAIReasoner(network, budget()).analyzeBuildScene(image, {}, context());
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).model).toBe('gpt-6-astra');
  });
  it('defaults to the economical model without requiring Astra', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(scene)));
    await new OpenAIReasoner(network, budget()).analyzeBuildScene(image, {}, context());
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).model).toBe('gpt-5.6-luna');
  });
  it('fails closed for invalid structured output and respects the two-call limit', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result({ bogus: true })));
    await expect(new OpenAIReasoner(network, budget()).analyzeBuildScene(image, {}, context())).rejects.toThrow();
    const network2 = vi.fn<typeof fetch>(); const ctx = context(); ctx.usage.modelCalls = 2;
    await expect(new OpenAIReasoner(network2, budget()).analyzeBuildScene(image, {}, ctx)).rejects.toThrow('two-call');
    expect(network2).not.toHaveBeenCalled();
  });
  it('sanitizes a provider failure so no credential or raw error body reaches the caller', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: 'secret-test-key-should-never-leak' } }, { status: 401 }));
    await expect(new OpenAIReasoner(network, budget()).analyzeBuildScene(image, {}, context())).rejects.not.toThrow('secret-test-key-should-never-leak');
  });
  it('stops before the network when paid AI is disabled', async () => {
    vi.stubEnv('SENTINEL_ALLOW_PAID_AI', 'false');
    const network = vi.fn<typeof fetch>();
    await expect(new OpenAIReasoner(network, budget()).analyzeBuildScene(image, {}, context())).rejects.toThrow('disabled');
    expect(network).not.toHaveBeenCalled();
  });
});

// Hardening after a real live test failed with "The model did not complete its structured
// response within the token limit. No retry was made." See PHASE5_REPORT.md.
describe('build_analysis output-token limit: raised, bounded, and isolated from other modes', () => {
  it('requests the new, larger Build-specific output-token ceiling for a realistic multi-component scene', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(scene)));
    await new OpenAIReasoner(network, budget()).analyzeBuildScene(image, {}, context());
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).max_output_tokens).toBe(3600);
  });

  it('fails safely with the exact honest error when the model returns an incomplete/truncated structured response', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(scene, 'incomplete')));
    await expect(new OpenAIReasoner(network, budget()).analyzeBuildScene(image, {}, context()))
      .rejects.toMatchObject({ code: 'OPENAI_INCOMPLETE', message: expect.stringContaining('did not complete its structured response within the token limit') });
  });

  it('never automatically retries after an incomplete/truncated response - exactly one network call is made', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result(scene, 'incomplete')));
    await expect(new OpenAIReasoner(network, budget()).analyzeBuildScene(image, {}, context())).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('raising Build Mode\'s output-token limit does not change Request Mode\'s or Inspect Mode\'s own limits', async () => {
    const network = vi.fn<typeof fetch>();
    const reasoner = new OpenAIReasoner(network, budget());

    network.mockResolvedValueOnce(Response.json(result(intent)));
    await reasoner.understand('a mechanical keyboard under 100 CAD', context());
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).max_output_tokens).toBe(1000);

    network.mockResolvedValueOnce(Response.json(result(inspectionFixtures['broken-office-chair-caster'])));
    await reasoner.analyzeInspectionImage(image, context());
    expect(JSON.parse(String(network.mock.calls[1][1]?.body)).max_output_tokens).toBe(1600);

    network.mockResolvedValueOnce(Response.json(result(scene)));
    await reasoner.analyzeBuildScene(image, {}, context());
    expect(JSON.parse(String(network.mock.calls[2][1]?.body)).max_output_tokens).toBe(3600);
  });
});
