const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('functions/api/[[path]].js', 'utf8');
const apiPromise = import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { NEWS_COLLECTOR_SOURCES, normalizeOpportunityGame, validateOpportunityResult, MARKETING_PRODUCT_SEEDS };').toString('base64'));

test('daily marketing pipeline recognizes every sellable new game and has a collector source', async () => {
  const { NEWS_COLLECTOR_SOURCES, normalizeOpportunityGame, MARKETING_PRODUCT_SEEDS } = await apiPromise;
  const games = ['hok', 'free-fire', 'genshin-impact', 'magic-chess-go-go'];
  assert.deepEqual(MARKETING_PRODUCT_SEEDS.map((product) => product.targetGame), games);
  assert.ok(MARKETING_PRODUCT_SEEDS.every((product) => product.game === 'other'));
  for (const game of games) assert.ok(NEWS_COLLECTOR_SOURCES.some((source) => source.game === game), `missing ${game} source`);
  assert.equal(normalizeOpportunityGame('Honor of Kings'), 'hok');
  assert.equal(normalizeOpportunityGame('FreeFire'), 'free-fire');
  assert.equal(normalizeOpportunityGame('Genshin Impact'), 'genshin-impact');
  assert.equal(normalizeOpportunityGame('MCGG'), 'magic-chess-go-go');
});

test('new-game events are accepted as marketing opportunities', async () => {
  const { validateOpportunityResult } = await apiPromise;
  const result = validateOpportunityResult({
    should_create_opportunity: true, game: 'Genshin Impact', opportunity_type: 'event', title: 'Event', description: 'Event update',
    trend_score: 80, sales_score: 80, urgency_score: 85, myanmar_interest_score: 70, overall_score: 80,
    reasoning: 'Limited event', recommended_channels: ['facebook'], product_matches: [],
  }, { game: 'genshin-impact', title: 'New event' });
  assert.equal(result.game, 'genshin-impact');
  assert.equal(result.opportunity_type, 'event_reminder');
});

test('marketing dashboard returns a JSON error when its data source fails', async () => {
  const api = await apiPromise;
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('<html>upstream failure</html>', { status: 500, headers: { 'Content-Type': 'text/html' } });
  try {
    const response = await api.onRequest({
      request: new Request('https://test/api/admin-opportunities', { method: 'POST', body: JSON.stringify({ adminPassword: 'test', game: 'free-fire' }) }),
      env: { ADMIN_PASSWORD: 'test', SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test' },
      params: { path: ['admin-opportunities'] },
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.match(body.error, /Marketing opportunities query failed: Supabase returned HTTP 500 with a non-JSON response/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('marketing dashboard loads optional QA data concurrently', async () => {
  const api = await apiPromise;
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const path = String(url);
    if (path.includes('today_opportunities')) {
      return new Response(JSON.stringify([{ id: 'opportunity-1', products: [], recommended_channels: [] }]), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const startedAt = Date.now();
    const response = await api.onRequest({
      request: new Request('https://test/api/admin-opportunities', { method: 'POST', body: JSON.stringify({ adminPassword: 'test' }) }),
      env: { ADMIN_PASSWORD: 'test', SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test' },
      params: { path: ['admin-opportunities'] },
    });
    assert.equal(response.status, 200);
    assert.ok(Date.now() - startedAt < 105, 'QA lookups should not be performed serially');
  } finally {
    global.fetch = originalFetch;
  }
});
