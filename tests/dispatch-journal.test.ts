import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));
import { DispatchJournal } from '@/lib/server/dispatch-journal';
import { AUTHORIZED_RETRY_ORDER_ID, type ProviderOrder } from '@/lib/domain/checkout';

const id = 'd16a7a6c-715a-4570-b77e-91e48988bc69';
const directories: string[] = [];
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'sentinel-dispatch-test-'));
  directories.push(directory);
  return { directory, journal: new DispatchJournal(directory) };
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('durable dispatch journal', () => {
  it('allows exactly one concurrent claim across independent instances', async () => {
    const { directory, journal } = await setup();
    const second = new DispatchJournal(directory);
    const outcomes = await Promise.allSettled([journal.claim(id), second.claim(id)]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    await expect(new DispatchJournal(directory).claim(id)).rejects.toMatchObject({ code: 'DISPATCH_ALREADY_ATTEMPTED' });
    expect(JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8'))).toMatchObject({ status: 'unknown' });
  });
  it('retains the once-only claim when order IDs and later statuses are recorded', async () => {
    const { directory, journal } = await setup();
    await journal.claim(id);
    await journal.record(id, 'order_fixture', 'pending');
    await expect(new DispatchJournal(directory).claim(id)).rejects.toMatchObject({ code: 'DISPATCH_ALREADY_ATTEMPTED' });
    await journal.record(id, 'order_fixture', 'succeeded');
    await expect(new DispatchJournal(directory).claim(id)).rejects.toMatchObject({ code: 'DISPATCH_ALREADY_ATTEMPTED' });
    const saved = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({ orderId: 'order_fixture', status: 'succeeded' });
    expect(Object.keys(saved).sort()).toEqual(['orderId', 'recordedAt', 'status']);
    expect((await stat(join(directory, `${id}.json`))).mode & 0o777).toBe(0o600);
  });
  it('preserves an uncertain outcome across a fresh service process', async () => {
    const { directory, journal } = await setup();
    await journal.claim(id);
    await journal.record(id, null, 'unknown');
    await expect(new DispatchJournal(directory).claim(id)).rejects.toMatchObject({ code: 'DISPATCH_ALREADY_ATTEMPTED' });
  });
  it('rejects a path injection identifier before creating a claim', async () => {
    const { journal } = await setup();
    await expect(journal.claim('../outside')).rejects.toMatchObject({ code: 'INVALID_CHECKOUT' });
  });
});

describe('provider-authorized retry journal', () => {
  const payment = { aliasFound: true, brand: 'visa', lastFour: '4242' };
  const failed: ProviderOrder = {
    id: AUTHORIZED_RETRY_ORDER_ID,
    merchantId: 'merchant_untitled_fidget_shop',
    status: 'worker_error',
    approvedAmount: { amountMinor: 1495, currency: 'CAD' },
    chargedAmount: null,
    orderUrl: null,
    timestamp: null,
    test: false,
    retryable: null,
    retryAction: 'contact_support',
    errorCode: 'CHECKOUT_INCOMPLETE',
    chargeState: 'attempted',
    billingMode: 'cardholder',
  };
  async function authorizedSetup() {
    const result = await setup();
    await result.journal.claim(id);
    await result.journal.record(id, AUTHORIZED_RETRY_ORDER_ID, 'worker_error');
    return result;
  }

  it('allows the exact provider-authorized failed order once and preserves its original record', async () => {
    const { directory, journal } = await authorizedSetup();
    const originalBefore = await readFile(join(directory, `${id}.json`), 'utf8');
    await journal.claimAuthorizedRetry(failed, true, payment);
    await expect(journal.claimAuthorizedRetry(failed, true, payment)).rejects.toMatchObject({ code: 'AUTHORIZED_RETRY_ALREADY_ATTEMPTED' });
    expect(await readFile(join(directory, `${id}.json`), 'utf8')).toBe(originalBefore);
  });

  it.each([
    [{ ...failed, status: 'succeeded' }, 'successful'],
    [{ ...failed, chargedAmount: { amountMinor: 1, currency: 'CAD' as const }, chargeState: 'confirmed' as const }, 'charged'],
  ])('blocks a %s previous order', async (previous) => {
    const { journal } = await authorizedSetup();
    await expect(journal.claimAuthorizedRetry(previous, true, payment)).rejects.toMatchObject({ code: 'AUTHORIZED_RETRY_STATE_INVALID' });
  });

  it('blocks every other previous order ID', async () => {
    const { journal } = await authorizedSetup();
    await expect(journal.claimAuthorizedRetry({ ...failed, id: 'af_ord_wrong' }, true, payment)).rejects.toMatchObject({ code: 'AUTHORIZED_RETRY_STATE_INVALID' });
  });

  it('keeps ordinary duplicate protection unchanged', async () => {
    const { journal } = await authorizedSetup();
    await expect(journal.claim(id)).rejects.toMatchObject({ code: 'DISPATCH_ALREADY_ATTEMPTED' });
  });
});
