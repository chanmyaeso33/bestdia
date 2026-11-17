const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const expectedUcMappings = {
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
const expectedPackMappings = {
  'pubg-prime-1-month': '16801806',
  'pubg-first-purchase-pack': '16802127',
  'pubg-weekly-deal-pack-1': '16802134',
  'pubg-firearm-materials-pack': '16802129',
  'pubg-weekly-mythic-emblem-value-pack': '16802130',
  'pubg-weekly-deal-pack-2': '16802135',
  'pubg-prime-3-month': '16801807',
  'pubg-mythic-emblem-pack': '16802128',
  'pubg-elite-pass-lv1-50': '16802131',
  'pubg-prime-6-month': '16801808',
  'pubg-prime-plus-1-month': '16801810',
  'pubg-elite-pass-lv1-100': '16802132',
  'pubg-prime-12-month': '16801809',
  'pubg-prime-plus-3-month': '16801811',
  'pubg-elite-pass-plus-lv1-100': '16802133',
  'pubg-prime-plus-6-month': '16801812',
  'pubg-prime-plus-12-month': '16802126',
};
const expectedPackPrices = {
  'pubg-prime-1-month': 34,
  'pubg-first-purchase-pack': 34,
  'pubg-weekly-deal-pack-1': 34,
  'pubg-firearm-materials-pack': 92,
  'pubg-weekly-mythic-emblem-value-pack': 92,
  'pubg-weekly-deal-pack-2': 92,
  'pubg-prime-3-month': 100,
  'pubg-mythic-emblem-pack': 150,
  'pubg-elite-pass-lv1-50': 181,
  'pubg-prime-6-month': 187,
  'pubg-prime-plus-1-month': 304,
  'pubg-elite-pass-lv1-100': 362,
  'pubg-prime-12-month': 366,
  'pubg-prime-plus-3-month': 902,
  'pubg-elite-pass-plus-lv1-100': 902,
  'pubg-prime-plus-6-month': 1805,
  'pubg-prime-plus-12-month': 3655,
};
const expectedMappings = { ...expectedUcMappings, ...expectedPackMappings };
const removedPackages = [
  'pubg-16200',
  'pubg-24300',
  'pubg-72900',
  'pubg-unlisted-pack',
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

test('PUBG catalog matches both live MXShop UC and pack catalogs', async () => {
  const { PRODUCTS } = await apiPromise;
  const packages = PRODUCTS.pubg.packages;
  const actualMappings = Object.fromEntries(packages.map((pkg) => [pkg.id, pkg.mxshopStockReleaseId]));

  assert.deepEqual(actualMappings, expectedMappings);
  assert.equal(packages.length, 34);
  assert.ok(Object.keys(expectedUcMappings).every((id) => packages.find((pkg) => pkg.id === id)?.mxshopStockId === '168'));
  assert.ok(Object.keys(expectedPackMappings).every((id) => packages.find((pkg) => pkg.id === id)?.mxshopStockId === '9500008'));
  assert.ok(packages.every((pkg) => pkg.supplier === 'mxshop' && pkg.checkoutAvailable === true));
  assert.equal(packages.find((pkg) => pkg.id === 'pubg-10').supplierPriceThb, 5.5);
  assert.deepEqual(Object.fromEntries(packages.filter((pkg) => pkg.mxshopStockId === '9500008').map((pkg) => [pkg.id, pkg.supplierPriceThb])), expectedPackPrices);
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
  for (const packageId of ['pubg-16200', 'pubg-unlisted-pack']) {
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

test('supplier price refresh requests both PUBG stock catalogs', async () => {
  const { productsWithSupplierPrices } = await apiPromise;
  const originalFetch = global.fetch;
  const stocks = [];
  global.fetch = async (url, options) => {
    assert.ok(url.endsWith('/get_stockreleaselist'));
    const stock = JSON.parse(options.body).StockIDX;
    stocks.push(stock);
    const result = stock === '168'
      ? [{ stockreleaselist_id: '16803185', price: 4.5 }]
      : stock === '9500008'
        ? [{ stockreleaselist_id: '16801806', price: 33 }]
        : [];
    return new Response(JSON.stringify({ success: true, result }));
  };
  try {
    const { products, supplierUpdated } = await productsWithSupplierPrices({ MXSHOP_MX_KEY: 'test', MXSHOP_PASSKEY: 'test' });
    assert.ok(stocks.includes('168'));
    assert.ok(stocks.includes('9500008'));
    assert.equal(supplierUpdated, true);
    assert.equal(products.pubg.packages.find((pkg) => pkg.id === 'pubg-10').supplierPriceThb, 4.5);
    assert.equal(products.pubg.packages.find((pkg) => pkg.id === 'pubg-prime-1-month').supplierPriceThb, 33);
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
  const expectedUcHtmlMappings = Object.fromEntries(Object.entries(expectedUcMappings).map(([id, value]) => [id.slice(5), value]));
  for (const file of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(file, 'utf8');
    const ucMatch = html.match(/const PUBG_MX_IDS=(\{[^;]+\});/);
    const packMatch = html.match(/const PUBG_PACK_MX_IDS=(\{[^;]+\});/);
    assert.ok(ucMatch, `${file} should define PUBG_MX_IDS`);
    assert.ok(packMatch, `${file} should define PUBG_PACK_MX_IDS`);
    assert.deepEqual(JSON.parse(ucMatch[1]), expectedUcHtmlMappings);
    assert.deepEqual(JSON.parse(packMatch[1]), expectedPackMappings);
    assert.match(html, /\["10",5\.50,true\]/);
    for (const packageId of Object.keys(expectedPackMappings)) assert.match(html, new RegExp(`\\["${packageId}"`));
    assert.doesNotMatch(html, /\["16200",/);
  }
});
