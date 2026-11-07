const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('functions/api/[[path]].js', 'utf8');
const apiPromise = import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { expandCartOrders, createCartOrderDocs, PRODUCTS };').toString('base64'));

test('three selections of Weekly Diamond Pass x3 create three separately fulfillable orders', async () => {
  const { expandCartOrders, PRODUCTS } = await apiPromise;
  const pkg = PRODUCTS.mlbb.packages.find(p => p.id === 9);
  assert.match(pkg.title, /x3/);
  const orders = expandCartOrders({ id: 'BD123456', userId: '123', zoneId: '456', totalPrice: pkg.price * 3, slip: { name: 'paid.jpg' } }, [{ pkg, quantity: 3 }]);
  assert.deepEqual(orders.map(o => o.id), ['BD123456', 'BD123456-2', 'BD123456-3']);
  assert.equal(orders.reduce((sum, o) => sum + o.totalPrice, 0), pkg.price * 3);
  for (const o of orders) {
    assert.equal(o.pkg.id, 9);
    assert.equal(o.items[0].quantity, 1);
    assert.equal(o.userId, '123');
    assert.equal(o.slip.paymentGroupId, 'BD123456');
    assert.equal(o.slip.name, 'paid.jpg');
  }
});

test('mixed packages preserve every selection and single-package checkout remains one order', async () => {
  const { expandCartOrders } = await apiPromise;
  const a = { id: 1, price: 100 }, b = { id: 2, price: 250 };
  assert.deepEqual(expandCartOrders({ id: 'BD123456' }, [{ pkg: a, quantity: 2 }, { pkg: b, quantity: 1 }]).map(o => o.pkg.id), [1, 1, 2]);
  assert.equal(expandCartOrders({ id: 'BD123456' }, [{ pkg: a, quantity: 1 }]).length, 1);
});

test('cart is saved in one atomic commit with create-only preconditions; failures propagate', async () => {
  const { createCartOrderDocs } = await apiPromise;
  const original = global.fetch;
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.match(url, /documents:commit$/);
    const { writes } = JSON.parse(options.body);
    assert.equal(writes.length, 3);
    assert.ok(writes.every(w => w.currentDocument.exists === false));
    assert.equal(new Set(writes.map(w => w.update.name)).size, 3);
    return new Response(JSON.stringify({ error: { message: 'Conflict' } }), { status: 409 });
  };
  try {
    await assert.rejects(createCartOrderDocs({ projectId: 'test', token: 'test' }, ['BD123456', 'BD123456-2', 'BD123456-3'].map(id => ({ id }))), /Conflict/);
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});

test('invalid quantities and repeated wallet selections are rejected before persistence', async () => {
  const { onRequest } = await apiPromise;
  for (const quantity of [0, -1, 1.5, 11, 'bad', 3]) {
    const response = await onRequest({ request: new Request('https://test/api/create-order', { method: 'POST', body: JSON.stringify({ order: { gameKey: 'free-fire', userId: '123', contact: 'test', pkg: { id: 'free-fire-68' }, items: [{ id: 'free-fire-68', quantity }], payKey: 'balance', payment: 'BestDia Balance' } }) }), env: {}, params: { path: ['create-order'] } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, quantity === 3 ? /BestDia Balance/ : /ရွေးထားသော ပက်ကေ့ချ် မမှန်ကန်ပါ/);
  }
});
