/** Free Agnic diagnostics. No model, card, profile, mandate, or dispatch calls. */
const token = (process.env.AGNIC_API_KEY || process.env.AGNIC_TOKEN || '').trim();
const merchantId = process.env.SENTINEL_SANDBOX_MERCHANT_ID?.trim() || 'merchant_untitled_fidget_shop';
const flags = process.argv.slice(2);
if (!token.startsWith('agnic_tok_') || !/^[a-zA-Z0-9_-]{1,160}$/.test(merchantId) || flags.some(flag => flag !== '--explore')) {
  console.error('Configure the server Agnic token and a valid merchant ID. Only --explore is supported.');
  process.exit(1);
}

const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null;
let calls = 0;
async function request(path, body) {
  calls++;
  try {
    const response = await fetch(`https://api.agnic.ai${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Agnic-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(body ? 125_000 : 15_000),
    });
    const data = await response.json().catch(() => null);
    console.log(JSON.stringify({ operation: body ? 'explore (no payment)' : path, httpStatus: response.status, errorCode: safeCode(data?.error) }));
    return response.ok ? data : null;
  } catch {
    console.log(JSON.stringify({ operation: path, outcome: 'unavailable_or_timed_out', retry: false }));
    return null;
  }
}

const merchant = await request(`/api/autofill/merchants/${merchantId}`);
const listing = await request('/api/autofill/merchants');
console.log(JSON.stringify({
  merchant: merchant && { id: safeCode(merchant.id), isTest: merchant.is_test === true, rail: safeCode(merchant.rail), catalogueError: safeCode(merchant.catalog_error) },
  designatedTestMerchants: Array.isArray(listing?.merchants) ? listing.merchants.filter(m => m.is_test === true).map(m => ({ id: safeCode(m.id), rail: safeCode(m.rail) })) : [],
  testCardConfigured: Boolean(process.env.SENTINEL_SANDBOX_CARD_ALIAS_ID?.trim()) && process.env.SENTINEL_SANDBOX_CARD_CONFIRMED === 'true',
  realPurchasing: 'DISABLED',
}));

// Opt-in only: one documented read-only exploration, never automatic retries.
if (flags.includes('--explore')) {
  if (merchant?.id !== merchantId || typeof merchant.domain !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(merchant.domain)) {
    console.error('Exploration skipped: verified merchant metadata is unavailable.');
  } else {
    const result = await request('/api/autofill/explore', {
      merchant_url: `https://${merchant.domain}`,
      goal: 'Inspect checkout readiness for one low-price catalogue item. Do not purchase.',
      prefs: 'Inspect fulfillment requirements. Stop before payment.',
      currency: ['CAD', 'USD', 'GBP', 'EUR'].includes(merchant.default_currency) ? merchant.default_currency : 'CAD',
    });
    console.log(JSON.stringify({ exploration: { orderId: safeCode(result?.order_id), status: safeCode(result?.status), merchantId: safeCode(result?.merchant_id) } }));
  }
}
console.log(JSON.stringify({ agnicCalls: calls, modelCalls: 0, dispatchCalls: 0 }));
