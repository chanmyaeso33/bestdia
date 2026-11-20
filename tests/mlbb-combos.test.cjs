const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('functions/api/[[path]].js', 'utf8');
const apiPromise = import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { PRODUCTS, productsWithSupplierPrices, expandCartOrders, getMappedStockReleaseId };').toString('base64'));

test('six distinct combos preserve recharge totals and fulfill every component at the displayed price', async () => {
  const { PRODUCTS, expandCartOrders, getMappedStockReleaseId } = await apiPromise;
  const combos = PRODUCTS.mlbb.packages.filter(pkg => pkg.comboItems);
  assert.equal(new Set(combos.map(pkg => pkg.id)).size, 6);
  assert.deepEqual(combos.map(pkg => [pkg.rechargeTarget, pkg.wpRecharge, pkg.baseDiamonds, pkg.rechargeTotal]), [
    [250, 80, 206, 286], [250, 80, 206, 286], [500, 80, 440, 520],
    [500, 80, 440, 520], [1000, 80, 937, 1017], [1000, 80, 936, 1016],
  ]);
  for (const combo of combos) {
    const base = combo.comboItems.filter(item => item.pkg.id !== 7).reduce((sum, { pkg, quantity }) =>
      sum + (pkg.baseDiamonds || Number(pkg.name.match(/^\d+/)[0])) * quantity, 0);
    assert.equal(base, combo.baseDiamonds);
    const orders = expandCartOrders({ id: 'BD123456', totalPrice: combo.price * 2, userId: '123', zoneId: '456' }, [{ pkg: combo, quantity: 2 }]);
    assert.equal(orders.filter(order => order.pkg.id === 7).length, 2);
    assert.equal(orders.length, combo.comboItems.reduce((sum, item) => sum + item.quantity, 0) * 2);
    assert.equal(orders.reduce((sum, order) => sum + order.totalPrice, 0), combo.price * 2);
    assert.equal(orders.reduce((sum, order) => sum + order.totalPriceThb, 0), combo.priceThb * 2);
    assert.equal(new Set(orders.map(order => order.id)).size, orders.length);
    for (const order of orders) {
      assert.equal(order.comboId, combo.id);
      assert.equal(order.paymentGroupId, 'BD123456');
      assert.equal(order.paymentGroupTotal, combo.price * 2);
      assert.equal(order.userId, '123');
      assert.equal(getMappedStockReleaseId(order.pkg.id, {}, order), order.pkg.mxshopStockReleaseId);
      assert.ok(!order.pkg.comboItems);
    }
  }
});

test('combo prices and fulfillment snapshots refresh with supplier prices and configured fees', async () => {
  const { PRODUCTS, productsWithSupplierPrices } = await apiPromise;
  const original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ success: true, result: [{ stockreleaselist_id: '169995', price: 100 }] }));
  try {
    const { products } = await productsWithSupplierPrices({ MXSHOP_MX_KEY: 'test', MXSHOP_PASSKEY: 'test', PRICING_PAYMENT_FEE_RATE: '0.02' });
    for (const combo of products.mlbb.packages.filter(pkg => pkg.comboItems)) {
      const originalCombo = PRODUCTS.mlbb.packages.find(pkg => pkg.id === combo.id);
      assert.ok(combo.price > originalCombo.price);
      assert.equal(combo.comboItems.find(item => item.pkg.id === 7).pkg.supplierPriceThb, 100);
      assert.equal(combo.price, combo.comboItems.reduce((sum, item) => sum + item.pkg.price * item.quantity, 0));
    }
  } finally { global.fetch = original; }
});

test('multi-component combos cannot enter the single-order balance fulfillment path', async () => {
  const { onRequest, PRODUCTS } = await apiPromise;
  for (const combo of PRODUCTS.mlbb.packages.filter(pkg => pkg.comboItems)) {
    const response = await onRequest({ request: new Request('https://test/api/create-order', {
      method: 'POST', body: JSON.stringify({ order: { gameKey: 'mlbb', userId: '123', zoneId: '456', contact: 'test', pkg: { id: combo.id, price: 1, comboItems: [] }, payKey: 'balance', payment: 'BestDia Balance' } }),
    }), env: {}, params: { path: ['create-order'] } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /BestDia Balance/);
  }
});

test('storefront combo definitions and initial prices match the trusted catalog', async () => {
  const { PRODUCTS } = await apiPromise;
  const html = fs.readFileSync('index.html', 'utf8');
  const helper = html.match(/function mlbbComboPackages\(packages\) \{[\s\S]*?\n\}/)[0];
  const build = vm.runInNewContext(`(${helper})`);
  const expected = PRODUCTS.mlbb.packages.filter(pkg => pkg.comboItems);
  assert.equal(JSON.stringify(build(PRODUCTS.mlbb.packages.filter(pkg => !pkg.comboItems))), JSON.stringify(expected));
});
