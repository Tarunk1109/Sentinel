import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/services/runtime', () => ({ missionService: { runFromIntent: vi.fn() }, inspectionService: { analyze: vi.fn() } }));
import { POST as analyze } from '@/app/api/inspect/analyze/route';
import { POST as search } from '@/app/api/inspect/search/route';
import { inspectionService, missionService } from '@/lib/server/services/runtime';
import { buildProductIntentFromInspection } from '@/lib/domain/inspection';
import { inspectionFixtures } from '@/lib/server/demo/inspection-fixtures';
import { intent as fixtureIntent } from './fixtures';

function png(): Buffer { const buf = Buffer.alloc(24, 0); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf); return buf; }
const imageBase64 = png().toString('base64');
function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('POST /api/inspect/analyze', () => {
  it('rejects a missing image, wrong types, and an oversized declared body', async () => {
    expect((await analyze(request('/api/inspect/analyze', {}))).status).toBe(400);
    expect((await analyze(request('/api/inspect/analyze', { imageBase64: 123, mimeType: 'image/png' }))).status).toBe(400);
    expect((await analyze(request('/api/inspect/analyze', { imageBase64: imageBase64, mimeType: 'image/png' }, { 'Content-Length': String(20 * 1024 * 1024) }))).status).toBe(413);
  });
  it('rejects cross-site calls the same way other API routes do', async () => {
    expect((await analyze(request('/api/inspect/analyze', { imageBase64, mimeType: 'image/png' }, { Origin: 'https://untrusted.example' }))).status).toBe(403);
  });
  it('never logs or echoes the raw image payload back on failure', async () => {
    vi.mocked(inspectionService.analyze).mockRejectedValue(new Error('raw-secret-image-bytes'));
    const response = await analyze(request('/api/inspect/analyze', { imageBase64, mimeType: 'image/png' }));
    expect(await response.text()).not.toContain('raw-secret');
  });
  it('returns the analysis and source on success, setting no-store and a session cookie', async () => {
    vi.mocked(inspectionService.analyze).mockResolvedValue({ analysis: inspectionFixtures['broken-office-chair-caster'], source: 'live' });
    const response = await analyze(request('/api/inspect/analyze', { imageBase64, mimeType: 'image/png' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body.source).toBe('live');
    expect(body.analysis.outcome).toBe('ANALYZED');
  });
});

describe('POST /api/inspect/search', () => {
  const validIntent = buildProductIntentFromInspection(inspectionFixtures['broken-office-chair-caster']);
  it('rejects an invalid or forged intent payload', async () => {
    expect((await search(request('/api/inspect/search', { intent: { ...fixtureIntent, quantity: 999 } }))).status).toBe(400);
    expect((await search(request('/api/inspect/search', {}))).status).toBe(400);
  });
  it('rejects cross-site calls', async () => {
    expect((await search(request('/api/inspect/search', { intent: validIntent }, { Origin: 'https://untrusted.example' }))).status).toBe(403);
  });
  it('runs the shared mission pipeline from the supplied intent and never calls a checkout/dispatch route', async () => {
    vi.mocked(missionService.runFromIntent).mockResolvedValue({ id: 'm1', prompt: validIntent.originalRequest, intent: validIntent, products: [], steps: [], source: 'agnic', status: 'no-results', summary: '', warnings: [], createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), cacheHit: false, usage: { modelCalls: 0, agnicCalls: 1, inputTokens: 0, outputTokens: 0 }, counts: { discovered: 0, withinBudget: 0, shortlisted: 0 } });
    const response = await search(request('/api/inspect/search', { intent: validIntent }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.mission.intent).toEqual(validIntent);
    expect(vi.mocked(missionService.runFromIntent)).toHaveBeenCalledWith(validIntent, expect.any(String), expect.anything());
  });
  it('streams NDJSON progress and sanitizes errors, the same as Request Mode', async () => {
    vi.mocked(missionService.runFromIntent).mockRejectedValue(new Error('raw-secret-provider-error'));
    const stream = await search(request('/api/inspect/search', { intent: validIntent }, { Accept: 'application/x-ndjson' }));
    expect(stream.headers.get('Content-Type')).toBe('application/x-ndjson');
    const events = await stream.text();
    expect(events).toContain('"type":"error"');
    expect(events).not.toContain('raw-secret');
  });
});
