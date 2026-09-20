import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { assertLocalRequest } from '@/lib/server/http';

afterEach(() => vi.unstubAllEnvs());

describe('request origin boundary', () => {
  it('allows the exact configured production origin', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SENTINEL_APP_ORIGIN', 'https://sentinel.example');
    expect(() => assertLocalRequest(new Request('https://sentinel.example/api/status', { headers: { host: 'sentinel.example', origin: 'https://sentinel.example', 'sec-fetch-site': 'same-origin' } }))).not.toThrow();
  });

  it('fails closed for an unconfigured production host', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertLocalRequest(new Request('https://unknown.example/api/status', { headers: { host: 'unknown.example' } }))).toThrow();
  });

  it('rejects cross-site requests even when the host is configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SENTINEL_APP_ORIGIN', 'https://sentinel.example');
    expect(() => assertLocalRequest(new Request('https://sentinel.example/api/status', { headers: { host: 'sentinel.example', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }))).toThrow();
  });
});
