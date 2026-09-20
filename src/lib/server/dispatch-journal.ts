import 'server-only';
import { mkdir, open, readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProviderError } from './provider-error';
import { AUTHORIZED_RETRY_ORDER_ID, type ProviderOrder, type SandboxPaymentReadiness } from '@/lib/domain/checkout';

interface JournalRecord { orderId?: string | null; status?: string; recordedAt?: string }

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
  private authorizedRetryPath(previousOrderId: string): string {
    if (previousOrderId !== AUTHORIZED_RETRY_ORDER_ID) throw new ProviderError('AUTHORIZED_RETRY_FORBIDDEN', 'This order has no provider-authorized retry.', 403);
    return join(this.directory, `provider-authorized-retry-${previousOrderId}.json`);
  }
  private async originalRecord(previousOrderId: string): Promise<{ file: string; record: JournalRecord }> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const matches: { file: string; record: JournalRecord }[] = [];
    for (const file of await readdir(this.directory)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(file)) continue;
      try {
        const record = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as JournalRecord;
        if (record.orderId === previousOrderId) matches.push({ file, record });
      } catch { /* An unrelated malformed journal cannot authorize a retry. */ }
    }
    if (matches.length !== 1 || matches[0].record.status !== 'worker_error') throw new ProviderError('AUTHORIZED_RETRY_ORIGINAL_MISSING', 'The exact failed original dispatch journal is unavailable or does not match. Retry remains blocked.', 409);
    return matches[0];
  }
  async verifyAuthorizedRetry(previous: ProviderOrder, billingProfileVerified: boolean, payment: SandboxPaymentReadiness): Promise<void> {
    if (previous.id !== AUTHORIZED_RETRY_ORDER_ID || previous.status !== 'worker_error' || previous.errorCode !== 'CHECKOUT_INCOMPLETE' || previous.chargedAmount !== null || previous.chargeState === 'confirmed' || previous.billingMode !== 'cardholder' || previous.retryAction !== 'contact_support') throw new ProviderError('AUTHORIZED_RETRY_STATE_INVALID', 'Agnic no longer reports the exact provider-authorized, uncharged failure with cardholder billing. Retry remains blocked.', 409);
    if (!billingProfileVerified || !payment.aliasFound || payment.brand !== 'visa' || payment.lastFour !== '4242') throw new ProviderError('AUTHORIZED_RETRY_BILLING_UNVERIFIED', 'The provider-authorized billing and test-card readiness checks did not pass. Retry remains blocked.', 409);
    await this.originalRecord(previous.id);
  }
  async claimAuthorizedRetry(previous: ProviderOrder, billingProfileVerified: boolean, payment: SandboxPaymentReadiness): Promise<string> {
    await this.verifyAuthorizedRetry(previous, billingProfileVerified, payment);
    const original = await this.originalRecord(previous.id);
    const path = this.authorizedRetryPath(previous.id);
    const file = await open(path, 'wx', 0o600).catch(() => { throw new ProviderError('AUTHORIZED_RETRY_ALREADY_ATTEMPTED', 'The one provider-authorized retry has already been claimed. It can never be retried again.', 409); });
    try {
      await file.writeFile(JSON.stringify({ kind: 'provider-authorized-retry', previousOrderId: previous.id, originalAttemptFile: original.file, status: 'claimed', recordedAt: new Date().toISOString() }));
      await file.sync();
    } finally { await file.close(); }
    return original.file.replace(/\.json$/, '');
  }
  async recordAuthorizedRetry(previousOrderId: string, orderId: string | null, status: string): Promise<void> {
    const path = this.authorizedRetryPath(previousOrderId);
    const temp = join(this.directory, `${randomUUID()}.tmp`);
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify({ kind: 'provider-authorized-retry', previousOrderId, orderId, status, recordedAt: new Date().toISOString() })); await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
  }
}
