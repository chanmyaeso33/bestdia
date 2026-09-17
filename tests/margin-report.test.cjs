const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('functions/api/[[path]].js', 'utf8');
const apiPromise = import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { marginReport };').toString('base64'));

async function call(route, body, env = {}) {
  const api = await apiPromise;
  const response = await api.onRequest({
    request: new Request(`https://test/api/${route}`, { method: 'POST', body: JSON.stringify(body) }),
    env,
    params: { path: [route] },
  });
  return { status: response.status, data: await response.json() };
}

test('margin report calculates package and per-game totals from trusted customer prices', async () => {
  const { marginReport } = await apiPromise;
  const report = marginReport({ demo: {
    key: 'demo', name: 'Demo Game', packages: [
      { id: 'a', title: 'A', supplierPriceThb: 20, supplierPriceSource: 'live', price: 2800, priceThb: 25 },
      { id: 'b', title: 'B', supplierPriceThb: 30, supplierPriceSource: 'fallback', price: 4200, priceThb: 36 },
    ],
  } });
  const game = report.games[0];
  assert.deepEqual(game.packages.map(({ id, grossProfitThb, supplierPriceSource }) => ({ id, grossProfitThb, supplierPriceSource })), [
    { id: 'a', grossProfitThb: 5, supplierPriceSource: 'live' },
    { id: 'b', grossProfitThb: 6, supplierPriceSource: 'fallback' },
  ]);
  assert.equal(game.packages[0].grossMarginPercent, 20);
  assert.ok(Math.abs(game.packages[1].grossMarginPercent - (100 / 6)) < 1e-12);
  assert.deepEqual({ ...game.totals, grossMarginPercent: undefined }, { supplierCostThb: 50, customerPriceThb: 61, grossProfitThb: 11, grossMarginPercent: undefined });
  assert.ok(Math.abs(game.totals.grossMarginPercent - ((11 / 61) * 100)) < 1e-12);
});

test('margin report is admin-only and supplier cost is absent from the public catalog', async () => {
  const env = { ADMIN_PASSWORD: 'secret' };
  assert.equal((await call('admin-margin-report', {}, env)).status, 401);
  const report = await call('admin-margin-report', { adminPassword: 'secret' }, env);
  assert.equal(report.status, 200);
  assert.ok(report.data.games.length > 0);
  assert.ok(report.data.games.every(game => game.packages.every(pkg => ['live', 'fallback'].includes(pkg.supplierPriceSource))));

  const catalog = await call('catalog', {}, env);
  assert.equal(catalog.status, 200);
  assert.equal(JSON.stringify(catalog.data).includes('supplierPriceThb'), false);
  assert.equal(JSON.stringify(catalog.data).includes('supplierCostThb'), false);
});
