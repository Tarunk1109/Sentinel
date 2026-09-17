import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('server-only', () => ({}));
import { AiBudget, costCad } from '@/lib/server/ai-budget';
const directories: string[] = [];
async function setup() { const directory = await mkdtemp(join(tmpdir(), 'sentinel-budget-test-')); directories.push(directory); return { directory, ledger: new AiBudget(directory) }; }
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
describe('persistent conservative C$5 budget', () => {
  it('persists reservations across instances and reconciles actual token use', async () => {
    const { directory, ledger } = await setup(); const id = await ledger.reserve('gpt-5.6-luna', 10000, 1000);
    expect((await new AiBudget(directory).status()).spentCad).toBe(costCad('gpt-5.6-luna', 10000, 1000));
    await ledger.settle(id, 'gpt-5.6-luna', 400, 200); expect((await ledger.status()).spentCad).toBe(costCad('gpt-5.6-luna', 400, 200));
    expect(await readFile(join(directory, 'ai-usage.json'), 'utf8')).not.toContain('prompt');
  });
  it('rejects per-call cap and total cap before model calls', async () => {
    const { directory, ledger } = await setup(); await expect(ledger.reserve('gpt-6-astra', 100000, 1800)).rejects.toThrow('limit');
    await writeFile(join(directory, 'ai-usage.json'), JSON.stringify({ spentCad: 4.99, reservations: {} }));
    await expect(ledger.reserve('gpt-6-astra', 1000, 1800)).rejects.toThrow('cap');
  });
  it('fails closed on corruption or a concurrent lock', async () => {
    const { directory, ledger } = await setup(); await writeFile(join(directory, 'ai-usage.json'), 'corrupt'); await expect(ledger.status()).rejects.toThrow('review');
    await writeFile(join(directory, 'ai-usage.lock'), ''); await expect(ledger.reserve('gpt-5.6-luna', 1000, 1000)).rejects.toThrow('busy');
  });
});
