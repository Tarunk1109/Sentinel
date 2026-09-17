import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/services/runtime', () => ({ missionService: { run: vi.fn(), preview: vi.fn() } }));
import { POST } from '@/app/api/missions/route';
import { POST as preview } from '@/app/api/checkout/preview/route';
import { missionService } from '@/lib/server/services/runtime';
function request(body: unknown, headers = {}) { return new Request('http://localhost/api/missions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
describe('API boundary', () => {
  it.each([{ prompt: '' }, { prompt: 'a'.repeat(1001) }, { prompt: 'ab' }, null, {}, { prompt: 'monitor', apiKey: 'forbidden' }])('rejects invalid body %j', async body => expect((await POST(request(body))).status).toBe(400));
  it('rejects non-JSON, malformed JSON, oversized bodies and cross-site calls', async () => {
    expect((await POST(request({ prompt: 'monitor' }, { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect((await POST(new Request('http://localhost/api/missions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }))).status).toBe(400);
    expect((await POST(request({ prompt: 'x'.repeat(9000) }))).status).toBe(413);
    expect((await POST(request({ prompt: 'monitor' }, { Origin: 'https://untrusted.example' }))).status).toBe(403);
  });
  it('does not accept client prices or checkout identifiers', async () => {
    expect((await preview(request({ missionId: 'not-real', productId: 'fixture', sku: 'forged', price: 1 }))).status).toBe(400);
  });
  it('accepts the actual same-origin Host when Next normalizes its request URL', async () => {
    const response = await POST(request({ prompt: 'ab' }, { Host: '127.0.0.1', Origin: 'http://127.0.0.1', 'Sec-Fetch-Site': 'same-origin' }));
    expect(response.status).toBe(400); expect((await response.json()).error.code).toBe('INVALID_REQUEST');
    expect((await POST(request({ prompt: 'ab' }, { Host: 'evil.example', Origin: 'http://evil.example' }))).status).toBe(403);
  });
  it('returns safe errors, including during progress streaming', async () => {
    vi.mocked(missionService.run).mockRejectedValue(new Error('raw-secret-provider-error'));
    const json = await POST(request({ prompt: 'monitor' })); expect(await json.text()).not.toContain('raw-secret');
    const stream = await POST(request({ prompt: 'monitor' }, { Accept: 'application/x-ndjson' }));
    expect(stream.headers.get('Content-Type')).toBe('application/x-ndjson'); expect(stream.headers.get('Set-Cookie')).toContain('HttpOnly');
    const events = await stream.text(); expect(events).toContain('"type":"error"'); expect(events).not.toContain('raw-secret');
  });
});
