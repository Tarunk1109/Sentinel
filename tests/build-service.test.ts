import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { BuildService } from '@/lib/server/services/build';
import { buildAnalysisFixtures } from '@/lib/server/demo/build-fixtures';
import type { SceneAnalyzer } from '@/lib/server/services/live-contracts';
import type { RequestMissionService } from '@/lib/server/services/request-mission';
import { product } from './fixtures';

function png(): Buffer { const buf = Buffer.alloc(24, 0); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf); return buf; }
const imageBase64 = png().toString('base64');
const gaming = buildAnalysisFixtures['gaming-desk-setup'];
function signal() { return new AbortController().signal; }
function mockMission(overrides: Partial<Parameters<RequestMissionService['runFromIntent']>[0]> = {}) {
  return vi.fn(async (intent) => ({ id: 'mission-1', prompt: intent.originalRequest, intent, products: [product], steps: [], source: 'agnic' as const, status: 'ready' as const, summary: '', warnings: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), cacheHit: false, usage: { modelCalls: 0, agnicCalls: 1, inputTokens: 0, outputTokens: 0 }, counts: { discovered: 1, withinBudget: 1, shortlisted: 1 }, ...overrides }));
}

afterEach(() => vi.unstubAllEnvs());

describe('BuildService.analyze', () => {
  it('validates the image and makes exactly one live scene-analysis call by default', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const service = new BuildService(analyzer, { runFromIntent: vi.fn() });
    const result = await service.analyze(imageBase64, {}, 'owner', signal());
    expect(result.source).toBe('live'); expect(analyzer.analyzeBuildScene).toHaveBeenCalledOnce();
    expect(result.plan.items.some(i => i.componentId === 'desk' && i.included)).toBe(true);
  });
  it('rejects an invalid image before ever calling the model', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn() };
    const service = new BuildService(analyzer, { runFromIntent: vi.fn() });
    await expect(service.analyze(Buffer.from('not an image').toString('base64'), {}, 'owner', signal())).rejects.toThrow();
    expect(analyzer.analyzeBuildScene).not.toHaveBeenCalled();
  });
  it('returns a clearly labelled fixture only when explicitly configured in development/test, skipping the paid call', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SENTINEL_BUILD_FIXTURE', 'gaming-desk-setup');
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn() };
    const service = new BuildService(analyzer, { runFromIntent: vi.fn() });
    const result = await service.analyze(imageBase64, {}, 'owner', signal());
    expect(result.source).toBe('fixture'); expect(result.analysis).toEqual(gaming);
    expect(analyzer.analyzeBuildScene).not.toHaveBeenCalled();
  });
  it('rejects a configured fixture in production without substituting a live call', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SENTINEL_BUILD_FIXTURE', 'gaming-desk-setup');
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn() };
    const service = new BuildService(analyzer, { runFromIntent: vi.fn() });
    await expect(service.analyze(imageBase64, {}, 'owner', signal())).rejects.toMatchObject({ code: 'BUILD_FIXTURE_DISABLED', status: 503 });
    expect(analyzer.analyzeBuildScene).not.toHaveBeenCalled();
  });
  it('rejects concurrent analyze calls from the same owner to prevent duplicate paid submissions', async () => {
    let resolveFirst!: (value: typeof gaming) => void;
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn(() => new Promise<typeof gaming>(resolve => { resolveFirst = resolve; })) };
    const service = new BuildService(analyzer, { runFromIntent: vi.fn() });
    const first = service.analyze(imageBase64, {}, 'owner', signal());
    await expect(service.analyze(imageBase64, {}, 'owner', signal())).rejects.toMatchObject({ code: 'BUILD_BUSY' });
    resolveFirst(gaming); await first;
  });
});

describe('BuildService.search', () => {
  it('searches at most 3 pending components per call using the existing mission pipeline unchanged', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const runFromIntent = mockMission();
    const service = new BuildService(analyzer, { runFromIntent });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    const view = await service.search('owner', session.id, ['desk', 'monitor', 'keyboard', 'mouse', 'monitor-arm'], undefined, signal());
    expect(runFromIntent).toHaveBeenCalledTimes(3);
    expect(view.results).toHaveLength(3);
    expect(view.remainingIds).toHaveLength(2);
  });
  it('accumulates results across multiple calls without re-searching completed components', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const runFromIntent = mockMission();
    const service = new BuildService(analyzer, { runFromIntent });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    await service.search('owner', session.id, ['desk', 'monitor', 'keyboard', 'mouse', 'monitor-arm'], undefined, signal());
    const view = await service.search('owner', session.id, ['desk', 'monitor', 'keyboard', 'mouse', 'monitor-arm'], undefined, signal());
    expect(runFromIntent).toHaveBeenCalledTimes(5);
    expect(view.results).toHaveLength(5); expect(view.remainingIds).toHaveLength(0);
  });
  it('never calls the real commerce pipeline for a fixture session; fixture products never reach it', async () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('SENTINEL_BUILD_FIXTURE', 'gaming-desk-setup');
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn() };
    const runFromIntent = vi.fn();
    const service = new BuildService(analyzer, { runFromIntent });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    const view = await service.search('owner', session.id, ['desk', 'monitor'], undefined, signal());
    expect(runFromIntent).not.toHaveBeenCalled();
    expect(view.results.every(r => r.source === 'fixture')).toBe(true);
    expect(view.results.find(r => r.componentId === 'desk')?.products[0].name).toContain('DEVELOPMENT FIXTURE');
  });
  it('isolates a per-component search failure instead of failing the whole batch', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const runFromIntent = vi.fn(async (intent) => { if (intent.productType === 'external monitor') throw new Error('boom'); return mockMission()(intent); });
    const service = new BuildService(analyzer, { runFromIntent });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    const view = await service.search('owner', session.id, ['desk', 'monitor'], undefined, signal());
    expect(view.results.find(r => r.componentId === 'monitor')?.error).toBeTruthy();
    expect(view.results.find(r => r.componentId === 'desk')?.error).toBeNull();
  });
  it('requires session ownership: another owner cannot search someone else’s plan', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const service = new BuildService(analyzer, { runFromIntent: mockMission() });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    await expect(service.search('attacker', session.id, ['desk'], undefined, signal())).rejects.toMatchObject({ code: 'BUILD_SESSION_EXPIRED' });
  });
  it('recomputes the plan for a changed selection before searching, never keeping a stale allocation', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const service = new BuildService(analyzer, { runFromIntent: mockMission() });
    const session = await service.analyze(imageBase64, { budgetMaxAmount: 800 }, 'owner', signal());
    const view = await service.search('owner', session.id, ['desk'], undefined, signal());
    expect(view.plan.items.find(i => i.componentId === 'desk')!.budgetAllocation!.amountMinor).toBe(80000);
  });
});
