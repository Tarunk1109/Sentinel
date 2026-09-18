import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('server-only', () => ({}));
import { BuildSessionSigner, newSessionExpiry } from '@/lib/server/build-session-token';
import { buildAnalysisFixtures } from '@/lib/server/demo/build-fixtures';
import type { BuildSessionPayload } from '@/lib/domain/build';

const gaming = buildAnalysisFixtures['gaming-desk-setup'];
const directories: string[] = [];
async function tempDir(): Promise<string> { const directory = await mkdtemp(join(tmpdir(), 'sentinel-build-session-token-test-')); directories.push(directory); return directory; }
function payload(overrides: Partial<BuildSessionPayload> = {}): BuildSessionPayload {
  const { issuedAt, expiresAt } = newSessionExpiry();
  return { v: 1, id: 'session-1', owner: 'owner', analysis: gaming, constraints: {}, source: 'live', fixtureName: null, usage: { modelCalls: 1, agnicCalls: 0, inputTokens: 0, outputTokens: 0 }, issuedAt, expiresAt, ...overrides };
}

afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });

describe('BuildSessionSigner', () => {
  it('signs and verifies a payload round-trip exactly, without any secret or image bytes inside it', async () => {
    const signer = new BuildSessionSigner(await tempDir());
    const original = payload();
    const token = await signer.sign(original);
    expect(token).not.toContain('imageBase64');
    const verified = await signer.verify(token, 'owner');
    expect(verified).toEqual(original);
  });

  it('rejects a tampered payload even when the signature segment is preserved verbatim', async () => {
    const signer = new BuildSessionSigner(await tempDir());
    const token = await signer.sign(payload());
    const [body, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    decoded.constraints = { budgetMaxAmount: 999999 };
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
    await expect(signer.verify(tampered, 'owner')).rejects.toMatchObject({ code: 'BUILD_SESSION_INVALID' });
  });

  it('rejects a structurally invalid token string instead of throwing an unhandled error', async () => {
    const signer = new BuildSessionSigner(await tempDir());
    await expect(signer.verify('not-a-real-token', 'owner')).rejects.toMatchObject({ code: 'BUILD_SESSION_INVALID' });
    await expect(signer.verify('', 'owner')).rejects.toMatchObject({ code: 'BUILD_SESSION_INVALID' });
    await expect(signer.verify('a.b.c', 'owner')).rejects.toMatchObject({ code: 'BUILD_SESSION_INVALID' });
  });

  it('rejects a token whose owner does not match the current caller', async () => {
    const signer = new BuildSessionSigner(await tempDir());
    const token = await signer.sign(payload({ owner: 'owner-a' }));
    await expect(signer.verify(token, 'owner-b')).rejects.toMatchObject({ code: 'BUILD_SESSION_EXPIRED' });
  });

  it('rejects an expired token', async () => {
    const signer = new BuildSessionSigner(await tempDir());
    const token = await signer.sign(payload({ issuedAt: Date.now() - 1_000_000, expiresAt: Date.now() - 1_000 }));
    await expect(signer.verify(token, 'owner')).rejects.toMatchObject({ code: 'BUILD_SESSION_EXPIRED' });
  });

  it('persists a generated secret to disk so two independently constructed signers pointed at the same directory agree - no shared process/module state required', async () => {
    const directory = await tempDir();
    const signerA = new BuildSessionSigner(directory);
    const token = await signerA.sign(payload());
    const signerB = new BuildSessionSigner(directory); // a fresh instance, as a separate worker process would construct
    await expect(signerB.verify(token, 'owner')).resolves.toMatchObject({ id: 'session-1' });
    const secretFile = await readFile(join(directory, 'build-session-secret'), 'utf8');
    expect(secretFile.trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('prefers an explicit SENTINEL_BUILD_SESSION_SECRET over the persisted file, so real multi-instance deployments can share config instead of a filesystem', async () => {
    vi.stubEnv('SENTINEL_BUILD_SESSION_SECRET', 'shared-deployment-secret');
    // Two signers with no directory in common at all - the only thing making them agree
    // is the shared env var, proving the persisted-file path is not required when set.
    const signerA = new BuildSessionSigner(await tempDir());
    const signerB = new BuildSessionSigner(await tempDir());
    const token = await signerA.sign(payload());
    await expect(signerB.verify(token, 'owner')).resolves.toMatchObject({ id: 'session-1' });
  });
});
