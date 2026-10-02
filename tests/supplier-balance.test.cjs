const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('functions/api/[[path]].js', 'utf8');
const apiPromise = import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { extractMxBalanceAmount, getMxshopBalance, performMxshopTopup };').toString('base64'));

test('extracts MXShop balances from supported response shapes', async () => {
  const { extractMxBalanceAmount } = await apiPromise;
  assert.equal(extractMxBalanceAmount({ result: { balance: '299.50 THB' } }), 299.5);
  assert.equal(extractMxBalanceAmount({ data: { credit: 450 } }), 450);
  assert.equal(extractMxBalanceAmount({ result: { account: { wallet_balance: '301.25' } } }), 301.25);
  assert.ok(Number.isNaN(extractMxBalanceAmount({ result: {} })));
});

test('holds an order, skips purchase, and alerts Telegram when balance is insufficient', async () => {
  const { performMxshopTopup } = await apiPromise;
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/get_balance')) return new Response(JSON.stringify({ success: true, result: { balance: 25 } }), { status: 200 });
    if (String(url).includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    if (String(url).includes('/api/v1/buy')) throw new Error('purchase must not be called');
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const result = await performMxshopTopup({ MXSHOP_AUTO_TOPUP_ENABLED: 'true', MXSHOP_MX_KEY: 'key', MXSHOP_PASSKEY: 'pass', TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_CHAT_ID: 'chat' }, {
      id: 'BD123456', gameKey: 'free-fire', userId: '123456789', pkg: { id: 'free-fire-310', mxshopStockReleaseId: '150104', supplierPriceThb: 86.5 },
    });
    assert.equal(result.status, 'held');
    assert.equal(result.supplierBalance.amount, 25);
    assert.equal(calls.some(call => call.url.includes('/api/v1/buy')), false);
    const telegram = calls.find(call => call.url.includes('api.telegram.org'));
    assert.ok(telegram);
    assert.match(JSON.parse(telegram.options.body).text, /Low Supplier Balance/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('warns on low balance but submits an affordable order', async () => {
  const { performMxshopTopup } = await apiPromise;
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes('/get_balance')) return new Response(JSON.stringify({ success: true, result: 250 }), { status: 200 });
    if (String(url).includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    if (String(url).includes('/api/v1/buy')) return new Response(JSON.stringify({ success: true, transaction_id: 'tx-1' }), { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const result = await performMxshopTopup({ MXSHOP_AUTO_TOPUP_ENABLED: 'true', MXSHOP_MX_KEY: 'key', MXSHOP_PASSKEY: 'pass', TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_CHAT_ID: 'chat' }, {
      id: 'BD654321', gameKey: 'free-fire', userId: '123456789', pkg: { id: 'free-fire-33', mxshopStockReleaseId: '150101', supplierPriceThb: 9.9 },
    });
    assert.equal(result.status, 'success');
    assert.ok(calls.some(url => url.includes('/api/v1/buy')));
    assert.ok(calls.some(url => url.includes('api.telegram.org')));
  } finally {
    global.fetch = originalFetch;
  }
});
