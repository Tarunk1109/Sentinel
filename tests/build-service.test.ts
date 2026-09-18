import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { BuildService } from '@/lib/server/services/build';
import { BuildSessionSigner } from '@/lib/server/build-session-token';
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

// A fixed shared secret stands in for the real deployment config (`SENTINEL_BUILD_SESSION_
// SECRET`) so every test below signs/verifies without touching the filesystem. Persisted-
// file secret loading has its own dedicated coverage in build-session-token.test.ts.
beforeEach(() => vi.stubEnv('SENTINEL_BUILD_SESSION_SECRET', 'test-only-shared-signing-secret'));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

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
    const view = await service.search('owner', session.token, ['desk', 'monitor', 'keyboard', 'mouse', 'monitor-arm'], undefined, undefined, signal());
    expect(runFromIntent).toHaveBeenCalledTimes(3);
    expect(view.results).toHaveLength(3);
    expect(view.remainingIds).toHaveLength(2);
  });
  it('accumulates results across multiple calls without re-searching completed components', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const runFromIntent = mockMission();
    const service = new BuildService(analyzer, { runFromIntent });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    const first = await service.search('owner', session.token, ['desk', 'monitor', 'keyboard', 'mouse', 'monitor-arm'], undefined, undefined, signal());
    const second = await service.search('owner', session.token, ['desk', 'monitor', 'keyboard', 'mouse', 'monitor-arm'], first.results, undefined, signal());
    expect(runFromIntent).toHaveBeenCalledTimes(5);
    expect(second.results).toHaveLength(5); expect(second.remainingIds).toHaveLength(0);
  });
  it('never calls the real commerce pipeline for a fixture session; fixture products never reach it', async () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('SENTINEL_BUILD_FIXTURE', 'gaming-desk-setup');
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn() };
    const runFromIntent = vi.fn();
    const service = new BuildService(analyzer, { runFromIntent });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    const view = await service.search('owner', session.token, ['desk', 'monitor'], undefined, undefined, signal());
    expect(runFromIntent).not.toHaveBeenCalled();
    expect(view.results.every(r => r.source === 'fixture')).toBe(true);
    expect(view.results.find(r => r.componentId === 'desk')?.products[0].name).toContain('DEVELOPMENT FIXTURE');
  });
  it('isolates a per-component search failure instead of failing the whole batch', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const runFromIntent = vi.fn(async (intent) => { if (intent.productType === 'external monitor') throw new Error('boom'); return mockMission()(intent); });
    const service = new BuildService(analyzer, { runFromIntent });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    const view = await service.search('owner', session.token, ['desk', 'monitor'], undefined, undefined, signal());
    expect(view.results.find(r => r.componentId === 'monitor')?.error).toBeTruthy();
    expect(view.results.find(r => r.componentId === 'desk')?.error).toBeNull();
  });
  it('requires session ownership: another owner cannot search someone else’s plan (test #6: owner binding)', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const service = new BuildService(analyzer, { runFromIntent: mockMission() });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    await expect(service.search('attacker', session.token, ['desk'], undefined, undefined, signal())).rejects.toMatchObject({ code: 'BUILD_SESSION_EXPIRED' });
  });
  it('recomputes the plan for a changed selection before searching, never keeping a stale allocation', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const service = new BuildService(analyzer, { runFromIntent: mockMission() });
    const session = await service.analyze(imageBase64, { budgetMaxAmount: 800 }, 'owner', signal());
    const view = await service.search('owner', session.token, ['desk'], undefined, undefined, signal());
    expect(view.plan.items.find(i => i.componentId === 'desk')!.budgetAllocation!.amountMinor).toBe(80000);
  });
});

// The 10 tests required by the session-persistence fix: analyze -> search must be
// deterministic without relying on shared in-memory state between separate API routes.
describe('Build session token: cross-process determinism and forgery resistance', () => {
  it('test #1: analyze followed immediately by search always succeeds', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const service = new BuildService(analyzer, { runFromIntent: mockMission() });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    const view = await service.search('owner', session.token, ['desk'], undefined, undefined, signal());
    expect(view.results).toHaveLength(1);
  });

  it('test #2: no route pre-warming is required - a brand-new service instance handles both calls on the first request', async () => {
    // Regression guard for the original bug report: the old in-memory session store
    // needed a prior request to have already populated shared module state before search
    // would find its session. This constructs BuildService fresh and only ever calls the
    // two requests a real user makes - no warm-up call precedes either of them.
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const service = new BuildService(analyzer, { runFromIntent: mockMission() });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    await expect(service.search('owner', session.token, ['desk', 'monitor', 'keyboard'], undefined, undefined, signal()))
      .resolves.toMatchObject({ results: expect.arrayContaining([expect.objectContaining({ componentId: 'desk' })]) });
  });

  it('test #3: a fresh server/module context does not invalidate the Build session', async () => {
    // Simulates two separate worker processes: `analyzeWorker` and `searchWorker` are
    // independently constructed BuildService/BuildSessionSigner object graphs that share
    // nothing except the signing secret they'd both read from shared deployment config
    // (SENTINEL_BUILD_SESSION_SECRET) - no object, Map, or module singleton is reused.
    const analyzeWorker = new BuildService({ analyzeBuildScene: vi.fn().mockResolvedValue(gaming) }, { runFromIntent: vi.fn() }, new BuildSessionSigner());
    const session = await analyzeWorker.analyze(imageBase64, {}, 'owner', signal());
    const searchWorker = new BuildService({ analyzeBuildScene: vi.fn() }, { runFromIntent: mockMission() }, new BuildSessionSigner());
    const view = await searchWorker.search('owner', session.token, ['desk'], undefined, undefined, signal());
    expect(view.results).toHaveLength(1);
  });

  it('test #4: a modified/tampered session payload is rejected', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const service = new BuildService(analyzer, { runFromIntent: mockMission() });
    const session = await service.analyze(imageBase64, { budgetMaxAmount: 500 }, 'owner', signal());
    const [body, signature] = session.token.split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    decoded.constraints.budgetMaxAmount = 999999; // attempt to forge a much larger budget
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
    await expect(service.search('owner', forged, ['desk'], undefined, undefined, signal())).rejects.toMatchObject({ code: 'BUILD_SESSION_INVALID' });
  });

  it('test #5: an expired session is rejected', async () => {
    vi.useFakeTimers();
    try {
      const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
      const service = new BuildService(analyzer, { runFromIntent: mockMission() });
      const session = await service.analyze(imageBase64, {}, 'owner', signal());
      vi.advanceTimersByTime(16 * 60_000); // TTL is 15 minutes
      await expect(service.search('owner', session.token, ['desk'], undefined, undefined, signal())).rejects.toMatchObject({ code: 'BUILD_SESSION_EXPIRED' });
    } finally { vi.useRealTimers(); }
  });

  it('test #7: selected component changes remain valid only through the intended API - a forged component id has no effect', async () => {
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const runFromIntent = mockMission();
    const service = new BuildService(analyzer, { runFromIntent });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    const view = await service.search('owner', session.token, ['desk', 'forged-component-id'], undefined, undefined, signal());
    expect(view.plan.items.some(i => i.componentId === 'forged-component-id')).toBe(false);
    expect(view.results.every(r => r.componentId !== 'forged-component-id')).toBe(true);
    expect(runFromIntent).toHaveBeenCalledTimes(1);
  });

  it('test #9: fixtures remain blocked outside dev/test at search time too, not only at analyze time', async () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('SENTINEL_BUILD_FIXTURE', 'gaming-desk-setup');
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn() };
    const service = new BuildService(analyzer, { runFromIntent: vi.fn() });
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    vi.stubEnv('NODE_ENV', 'production');
    await expect(service.search('owner', session.token, ['desk'], undefined, undefined, signal())).rejects.toMatchObject({ code: 'BUILD_FIXTURE_DISABLED' });
  });

  it('test #10: zero dispatch calls - Build only ever calls the search step of the mission pipeline', async () => {
    const dispatchSandbox = vi.fn();
    const runFromIntent = mockMission();
    const missionsWithDispatchSpy = { runFromIntent, dispatchSandbox } as unknown as Pick<RequestMissionService, 'runFromIntent'>;
    const analyzer: SceneAnalyzer = { analyzeBuildScene: vi.fn().mockResolvedValue(gaming) };
    const service = new BuildService(analyzer, missionsWithDispatchSpy);
    const session = await service.analyze(imageBase64, {}, 'owner', signal());
    await service.search('owner', session.token, ['desk', 'monitor', 'keyboard'], undefined, undefined, signal());
    expect(dispatchSandbox).not.toHaveBeenCalled();
    expect(runFromIntent).toHaveBeenCalledTimes(3);
  });

  // test #8 (max 3 searches per batch) is covered above by 'searches at most 3 pending
  // components per call'; test #6 (owner binding) is covered above by 'requires session
  // ownership'. Both are unchanged in spirit by this fix and are kept with the rest of
  // BuildService.search's behavioral coverage rather than duplicated here.
});
