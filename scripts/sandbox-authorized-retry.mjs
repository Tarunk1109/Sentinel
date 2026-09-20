import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';

const ROOT = process.cwd();
const ORDER_ID = 'af_ord_mu9enrtcm1rvph4a';
const SKU = 'gid://shopify/ProductVariant/43945255567426';
const CEILING_MINOR = 1495;
const PORT = 3137;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const JOURNAL_DIR = join(ROOT, '.sentinel', 'sandbox-attempts');
const RETRY_JOURNAL = join(JOURNAL_DIR, `provider-authorized-retry-${ORDER_ID}.json`);
const PROOF = join(ROOT, '.sentinel', 'sandbox-authorized-retry-proof.json');

function stop(message) {
  throw new Error(message);
}

async function assertPreflight() {
  if (process.env.SENTINEL_REAL_PURCHASES_ENABLED === 'true') stop('Real-money execution must remain disabled.');
  if (!process.env.AGNIC_API_KEY && !process.env.AGNIC_TOKEN) stop('Agnic server credential is missing.');
  if (!process.env.SENTINEL_SANDBOX_CARD_ALIAS_ID || process.env.SENTINEL_SANDBOX_CARD_CONFIRMED !== 'true') stop('The confirmed vaulted test card is not configured.');
  if (!process.env.SENTINEL_SANDBOX_SHIP_TO_JSON) stop('Sandbox shipping configuration is missing.');
  await access(join(ROOT, '.next', 'BUILD_ID'), constants.R_OK).catch(() => stop('Production build is missing. Run npm run build first.'));
  await access(RETRY_JOURNAL).then(() => stop('The provider-authorized retry was already claimed and can never run again.'), () => undefined);
  await access(PROOF).then(() => stop('The authorized-retry proof already exists. Inspect it; do not repeat dispatch.'), () => undefined);
  const originals = [];
  for (const name of await readdir(JOURNAL_DIR)) {
    if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    try {
      const record = JSON.parse(await readFile(join(JOURNAL_DIR, name), 'utf8'));
      if (record.orderId === ORDER_ID && record.status === 'worker_error') originals.push(name);
    } catch { /* An unrelated malformed record cannot authorize retry. */ }
  }
  if (originals.length !== 1) stop('The exact original worker_error journal record was not found uniquely.');
}

async function writeProof(value) {
  await mkdir(join(ROOT, '.sentinel'), { recursive: true, mode: 0o700 });
  const file = await open(PROOF, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function request(path, body, cookie = '') {
  const response = await fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json();
  if (!response.ok) stop(payload?.error?.message || `Request failed (${response.status}).`);
  return { payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) stop('The isolated SENTINEL server exited before becoming ready.');
    try {
      const response = await fetch(`${ORIGIN}/api/status`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Keep waiting for the local server only. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  stop('The isolated SENTINEL server did not become ready.');
}

await assertPreflight();
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    SENTINEL_APP_ORIGIN: ORIGIN,
    SENTINEL_REAL_PURCHASES_ENABLED: 'false',
    SENTINEL_AGNIC_AUTHORIZED_RETRY_ORDER_ID: ORDER_ID,
    SENTINEL_AGNIC_BILLING_PROFILE_CONFIRMED: 'true',
  },
});

try {
  await waitForServer(server);
  let cookie = '';
  const started = await request('/api/sandbox/authorized-retry', { action: 'start', previousOrderId: ORDER_ID }, cookie);
  cookie = started.cookie;
  const checkoutId = started.payload.checkout.id;
  if (started.payload.checkout.product?.sku !== SKU || started.payload.checkout.retryOfOrderId !== ORDER_ID) stop('The prepared retry does not match the authorized order and product.');

  const firstQuote = await request('/api/checkout/quote', { checkoutId }, cookie);
  const standard = firstQuote.payload.checkout.preview?.fulfillmentOptions?.find(option => option.title === 'Standard');
  if (!standard) stop('A Standard fulfillment option was not returned.');
  const quoted = await request('/api/checkout/quote', { checkoutId, fulfillmentId: standard.id }, cookie);
  const checkout = quoted.payload.checkout;
  const amount = checkout.preview?.amount;
  if (!checkout.quoteId || checkout.stage !== 'quoted' || !amount || amount.currency !== 'CAD' || amount.amountMinor > CEILING_MINOR || amount.amountMinor < 0 || checkout.preview.selectedFulfillmentId !== standard.id) stop('The fresh Standard quote is incomplete or exceeds C$14.95. No retry was sent.');

  console.log(`\nProvider-authorized sandbox retry: ${ORDER_ID}`);
  console.log('Product: Paw Print Charm × 1');
  console.log('Fulfillment: Standard');
  console.log(`Fresh total: C$${(amount.amountMinor / 100).toFixed(2)}`);
  console.log('Hard ceiling: C$14.95');
  console.log('Payment: vaulted Agnic TEST Visa ending 4242');
  console.log('This is the only allowed retry. Any uncertain outcome permanently consumes it.\n');
  const confirmation = `RETRY ${ORDER_ID} UP TO CAD 14.95`;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Type exactly: ${confirmation}\n> `);
  prompt.close();
  if (answer !== confirmation) stop('Confirmation did not match. No retry was sent.');

  await writeProof({
    kind: 'provider-authorized-sandbox-retry',
    previousOrderId: ORDER_ID,
    product: 'Paw Print Charm',
    sku: SKU,
    quantity: 1,
    fulfillment: 'Standard',
    quotedAmountMinor: amount.amountMinor,
    currency: 'CAD',
    maximumAllowedMinor: CEILING_MINOR,
    status: 'dispatch-starting',
    recordedAt: new Date().toISOString(),
  });

  const result = await request('/api/sandbox/authorized-retry', {
    action: 'confirm',
    checkoutId,
    quoteId: checkout.quoteId,
    previousOrderId: ORDER_ID,
    confirmed: true,
    confirmationText: 'Confirm Provider-Authorized Test Retry',
  }, cookie);
  console.log(`Retry outcome: ${result.payload.checkout.stage}`);
  if (result.payload.checkout.order?.id) console.log(`Agnic order: ${result.payload.checkout.order.id}`);
  console.log(`Proof: ${PROOF}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Authorized retry stopped.');
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
}
