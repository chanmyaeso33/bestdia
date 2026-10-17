const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('functions/api/[[path]].js', 'utf8');
const apiPromise = import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { refundEligibility };').toString('base64'));

test('refunds are limited to charged, unsuccessful BestDia Balance orders', async () => {
  const { refundEligibility } = await apiPromise;
  const purchase = { type: 'purchase', amount: -42 };
  assert.equal(refundEligibility({ payKey: 'kbz', status: 'failed' }, purchase).code, 'not_balance');
  assert.equal(refundEligibility({ payKey: 'balance', status: 'processing' }, purchase).code, 'not_unsuccessful');
  assert.equal(refundEligibility({ payKey: 'balance', status: 'failed' }, null).code, 'not_charged');
  assert.deepEqual(refundEligibility({ payKey: 'balance', status: 'failed' }, purchase), { eligible: true, code: 'eligible', amount: 42 });
  assert.deepEqual(refundEligibility({ payment: 'BestDia Balance', status: 'cancelled' }, { type: 'purchase', amount: -19.6 }), { eligible: true, code: 'eligible', amount: 20 });
});

test('duplicate refund requests and completed refunds are blocked', async () => {
  const { refundEligibility } = await apiPromise;
  const purchase = { type: 'purchase', amount: -42 };
  assert.equal(refundEligibility({ payKey: 'balance', status: 'failed', refundStatus: 'requested' }, purchase).code, 'already_requested');
  assert.equal(refundEligibility({ payKey: 'balance', status: 'failed', refundStatus: 'approved' }, purchase).code, 'already_refunded');
  assert.equal(refundEligibility({ payKey: 'balance', status: 'failed', balanceRefundedAmount: 42 }, purchase).code, 'already_refunded');
});

test('Netlify exposes both refund endpoints', () => {
  assert.match(fs.readFileSync('netlify/functions/request-refund.js', 'utf8'), /request-refund/);
  assert.match(fs.readFileSync('netlify/functions/admin-process-refund.js', 'utf8'), /admin-process-refund/);
});
