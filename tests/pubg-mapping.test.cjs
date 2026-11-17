const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const expectedMappings = {
  'pubg-10': '16803185',
  'pubg-60': '168009',
  'pubg-120': '168008',
  'pubg-180': '650039',
  'pubg-325': '168010',
  'pubg-385': '650040',
  'pubg-660': '168011',
  'pubg-720': '650059',
  'pubg-985': '650041',
  'pubg-1045': '650042',
  'pubg-1320': '650043',
  'pubg-1800': '168012',
  'pubg-1920': '650044',
  'pubg-2125': '650045',
  'pubg-2460': '650046',
  'pubg-3850': '168013',
  'pubg-8100': '168014',
};
const removedPackages = [
  'pubg-16200',
  'pubg-24300',
  'pubg-72900',
  'pubg-first-purchase-pack',
  'pubg-prime-1-month',
  'pubg-firearm-materials-pack',
  'pubg-prime-3-month',
  'pubg-mythic-emblem-pack',
  'pubg-prime-plus-1-month',
  'pubg-prime-plus-3-month',
];

const source = fs.readFileSync('functions/api/[[path]].js', 'utf8');
const apiPromise = import('data:text/javascript;base64,' + Buffer.from(
  source + '\nexport { PRODUCTS, getMappedStockReleaseId, productsWithSupplierPrices };'
).toString('base64'));

async function call(route, body, env = {}) {
  const api = await apiPromise;
  const response = await api.onRequest({
    request: new Request(`https://test/api/${route}`, { method: 'POST', body: JSON.stringify(body) }),
    env,
    params: { path: [route] },
  });
  return { status: response.status, data: await response.json() };
}

test('PUBG catalog matches every live MXShop StockIDX 168 package', async () => {
  const { PRODUCTS } = await apiPromise;
  const packages = PRODUCTS.pubg.packages;
  const actualMappings = Object.fromEntries(packages.map((pkg) => [pkg.id, pkg.mxshopStockReleaseId]));

  assert.deepEqual(actualMappings, expectedMappings);
  assert.equal(packages.length, 17);
  assert.ok(packages.every((pkg) => pkg.mxshopStockId === '168'));
  assert.ok(packages.every((pkg) => pkg.supplier === 'mxshop' && pkg.checkoutAvailable === true));
  assert.equal(packages.find((pkg) => pkg.id === 'pubg-10').supplierPriceThb, 5.5);
  assert.ok(removedPackages.every((id) => !packages.some((pkg) => pkg.id === id)));
});

test('PUBG mapping resolution trusts only the active server catalog', async () => {
  const { getMappedStockReleaseId } = await apiPromise;
  for (const [packageId, variationId] of Object.entries(expectedMappings)) {
    assert.equal(getMappedStockReleaseId(packageId, {}, { gameKey: 'pubg', pkg: { mxshopStockReleaseId: '999' } }), variationId);
  }
  for (const packageId of removedPackages) {
    assert.equal(getMappedStockReleaseId(packageId, { MXSHOP_PACKAGE_MAP: JSON.stringify({ [packageId]: '999' }) }, { gameKey: 'pubg', pkg: { mxshopStockReleaseId: '999' } }), '');
  }
});

test('removed PUBG packages are rejected before order persistence', async () => {
  for (const packageId of ['pubg-16200', 'pubg-prime-1-month']) {
    const result = await call('create-order', { order: {
      gameKey: 'pubg',
      pkg: { id: packageId, mxshopStockReleaseId: '999' },
      userId: '5123456789',
      contact: 'test',
      payKey: 'kbz',
      payment: 'KBZPay',
    } });
    assert.equal(result.status, 400);
  }
});

test('supplier price refresh requests PUBG StockIDX 168', async () => {
  const { productsWithSupplierPrices } = await apiPromise;
  const originalFetch = global.fetch;
  const stocks = [];
  global.fetch = async (url, options) => {
    assert.ok(url.endsWith('/get_stockreleaselist'));
    const stock = JSON.parse(options.body).StockIDX;
    stocks.push(stock);
    const result = stock === '168' ? [{ stockreleaselist_id: '16803185', price: 4.5 }] : [];
    return new Response(JSON.stringify({ success: true, result }));
  };
  try {
    const { products, supplierUpdated } = await productsWithSupplierPrices({ MXSHOP_MX_KEY: 'test', MXSHOP_PASSKEY: 'test' });
    assert.ok(stocks.includes('168'));
    assert.equal(supplierUpdated, true);
    assert.equal(products.pubg.packages.find((pkg) => pkg.id === 'pubg-10').supplierPriceThb, 4.5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('standalone Netlify fulfillment uses the same PUBG whitelist', () => {
  const { getMappedStockReleaseId } = require('../netlify/functions/mxshop-topup.js');
  for (const [packageId, variationId] of Object.entries(expectedMappings)) {
    assert.equal(getMappedStockReleaseId(packageId, { gameKey: 'pubg', pkg: { mxshopStockReleaseId: '999' } }), variationId);
  }
  for (const packageId of removedPackages) {
    assert.equal(getMappedStockReleaseId(packageId, { gameKey: 'pubg', pkg: { mxshopStockReleaseId: '999' } }), '');
  }
});

test('both storefronts embed the complete current PUBG mapping', () => {
  const expectedUcMappings = Object.fromEntries(Object.entries(expectedMappings).map(([id, value]) => [id.slice(5), value]));
  for (const file of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(file, 'utf8');
    const match = html.match(/const PUBG_MX_IDS=(\{[^;]+\});/);
    assert.ok(match, `${file} should define PUBG_MX_IDS`);
    assert.deepEqual(JSON.parse(match[1]), expectedUcMappings);
    assert.match(html, /\["10",5\.50,true\]/);
    assert.doesNotMatch(html, /pubg-prime-1-month|\["16200",/);
  }
});
