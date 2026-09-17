import 'server-only';
import { mkdir, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProviderError } from './provider-error';

/** Durable once-only marker. Unknown outcomes remain claimed across restarts. */
export class DispatchJournal {
  constructor(private readonly directory = join(process.cwd(), '.sentinel', 'sandbox-attempts')) {}
  private path(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new ProviderError('INVALID_CHECKOUT', 'Invalid checkout identifier.', 400);
    return join(this.directory, `${id}.json`);
  }
  async claim(id: string): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = await open(this.path(id), 'wx', 0o600).catch(() => { throw new ProviderError('DISPATCH_ALREADY_ATTEMPTED', 'This checkout already has a saved dispatch attempt. Do not place it again; check Agnic order status.', 409); });
    try { await file.writeFile(JSON.stringify({ status: 'unknown', recordedAt: new Date().toISOString() })); await file.sync(); } finally { await file.close(); }
  }
  async record(id: string, orderId: string | null, status: string): Promise<void> {
    const temp = join(this.directory, `${randomUUID()}.tmp`);
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify({ orderId, status, recordedAt: new Date().toISOString() })); await file.sync(); } finally { await file.close(); }
    await rename(temp, this.path(id));
  }
}
