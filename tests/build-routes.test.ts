import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/services/runtime', () => ({ buildService: { analyze: vi.fn(), search: vi.fn() } }));
import { POST as analyze } from '@/app/api/build/analyze/route';
import { POST as search } from '@/app/api/build/search/route';
import { buildService } from '@/lib/server/services/runtime';
import { buildAnalysisFixtures } from '@/lib/server/demo/build-fixtures';
import { createBuildPlan, type BuildComponentResult } from '@/lib/domain/build';
import type { BuildSessionView } from '@/lib/server/services/build';

function png(): Buffer { const buf = Buffer.alloc(24, 0); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf); return buf; }
const imageBase64 = png().toString('base64');
function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
const gaming = buildAnalysisFixtures['gaming-desk-setup'];
function sessionView(overrides: Partial<BuildSessionView> = {}): BuildSessionView {
  return { id: '11111111-1111-4111-8111-111111111111', analysis: gaming, constraints: {}, plan: createBuildPlan(gaming, {}), source: 'live', usage: { modelCalls: 1, agnicCalls: 0, inputTokens: 0, outputTokens: 0 }, results: [] as BuildComponentResult[], remainingIds: [], expiresAt: new Date(Date.now() + 60000).toISOString(), ...overrides };
}

describe('POST /api/build/analyze', () => {
  it('rejects a missing image, wrong types, and an oversized declared body', async () => {
    expect((await analyze(request('/api/build/analyze', {}))).status).toBe(400);
    expect((await analyze(request('/api/build/analyze', { imageBase64: 123, mimeType: 'image/png' }))).status).toBe(400);
    expect((await analyze(request('/api/build/analyze', { imageBase64, mimeType: 'image/png' }, { 'Content-Length': String(20 * 1024 * 1024) }))).status).toBe(413);
  });
  it('rejects cross-site calls the same way other API routes do', async () => {
    expect((await analyze(request('/api/build/analyze', { imageBase64, mimeType: 'image/png' }, { Origin: 'https://untrusted.example' }))).status).toBe(403);
  });
  it('rejects an invalid constraints payload without reaching the service', async () => {
    expect((await analyze(request('/api/build/analyze', { imageBase64, mimeType: 'image/png', constraints: { budgetMaxAmount: -5 } }))).status).toBe(400);
    expect(buildService.analyze).not.toHaveBeenCalled();
  });
  it('never logs or echoes the raw image payload back on failure', async () => {
    vi.mocked(buildService.analyze).mockRejectedValue(new Error('raw-secret-image-bytes'));
    const response = await analyze(request('/api/build/analyze', { imageBase64, mimeType: 'image/png' }));
    expect(await response.text()).not.toContain('raw-secret');
  });
  it('returns the session and source on success, setting no-store', async () => {
    vi.mocked(buildService.analyze).mockResolvedValue(sessionView());
    const response = await analyze(request('/api/build/analyze', { imageBase64, mimeType: 'image/png', constraints: { goal: 'gaming desk', budgetMaxAmount: 800 } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body.session.source).toBe('live');
    expect(body.session.plan.items.length).toBeGreaterThan(0);
  });
});

describe('POST /api/build/search', () => {
  it('rejects an invalid plan id or oversized selection', async () => {
    expect((await search(request('/api/build/search', { planId: 'not-a-uuid', selectedIds: [] }))).status).toBe(400);
    expect((await search(request('/api/build/search', {})))).toMatchObject({ status: 400 });
  });
  it('rejects cross-site calls', async () => {
    expect((await search(request('/api/build/search', { planId: '11111111-1111-4111-8111-111111111111', selectedIds: [] }, { Origin: 'https://untrusted.example' }))).status).toBe(403);
  });
  it('runs the build search and never touches a checkout/dispatch route', async () => {
    vi.mocked(buildService.search).mockResolvedValue(sessionView({ results: [{ componentId: 'desk', products: [], mission: null, source: 'agnic', error: null }] }));
    const response = await search(request('/api/build/search', { planId: '11111111-1111-4111-8111-111111111111', selectedIds: ['desk'] }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.session.results).toHaveLength(1);
    expect(vi.mocked(buildService.search)).toHaveBeenCalledWith(expect.any(String), '11111111-1111-4111-8111-111111111111', ['desk'], undefined, expect.anything());
  });
  it('streams NDJSON progress and sanitizes errors', async () => {
    vi.mocked(buildService.search).mockRejectedValue(new Error('raw-secret-provider-error'));
    const stream = await search(request('/api/build/search', { planId: '11111111-1111-4111-8111-111111111111', selectedIds: ['desk'] }, { Accept: 'application/x-ndjson' }));
    expect(stream.headers.get('Content-Type')).toBe('application/x-ndjson');
    const events = await stream.text();
    expect(events).toContain('"type":"error"');
    expect(events).not.toContain('raw-secret');
  });
});
