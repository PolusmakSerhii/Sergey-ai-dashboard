import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('    const FAVORITES_STORAGE_KEY'), html.indexOf('    const GLOBAL_RANKING_REFRESH_MS'));
const mobile = html.slice(html.indexOf('    function renderMobileMarketList'), html.indexOf('    function renderCoreMarkets'));
const row = { symbol: 'TESTUSDT', opportunityScore: 86, grade: 'A', confidence: 94,
  recommendationConfidence: 74, direction: 'Long', action: 'Buy', confirmedAPlus: false };
function harness(saved = [], ranking = []) {
  let stored = JSON.stringify(saved);
  const list = { innerHTML: '' };
  const context = vm.createContext({ globalRankingResults: ranking,
    document: { querySelector: () => list },
    localStorage: { getItem(key) { assert.equal(key, 'sergey-ai-trader:favorites:v1'); return stored; },
      setItem(key, value) { assert.equal(key, 'sergey-ai-trader:favorites:v1'); stored = value; } },
    getScannerAction: () => { throw Error('No score-derived Watchlist action'); },
    getScannerActionClass: () => 'neutral',
    fetch: () => { throw Error('Watchlist must not fetch single-market analysis'); }
  });
  vm.runInContext(source + mobile, context);
  return { context, list, values: () => JSON.parse(vm.runInContext('JSON.stringify(favoriteCoins)', context)),
    sync: () => context.syncFavoriteCoinsWithRanking('2026-09-29T10:00:00Z') };
}

test('Ranking SWAP contract is stored; explicit row identity takes precedence', () => {
  const h = harness();
  assert.equal(h.context.compactFavoriteCoin(row).instrumentType, 'SWAP');
  assert.equal(h.context.compactFavoriteCoin({ ...row, instrumentType: 'SPOT' }).instrumentType, 'SPOT');
});
for (const grade of ['D', 'C', 'B', 'A', 'A+']) {
  test(`Ranking ${grade} replaces the entire analytical snapshot without saved-field fallback`, () => {
    const fresh = { ...row, grade, opportunityScore: 77, direction: 'Short', action: 'Sell' };
    const h = harness([{ ...row, opportunityScore: 99, grade: 'A+' }], [fresh]);
    h.sync();
    const result = h.values()[0];
    for (const field of ['symbol', 'grade', 'opportunityScore', 'direction', 'action', 'confidence', 'recommendationConfidence'])
      assert.equal(result[field], fresh[field]);
    assert.equal(result.updatedAt, '2026-09-29T10:00:00Z');
    assert.equal(result.updateStatus, 'ranking');
    assert.match(h.list.innerHTML, /Ranking snapshot/);
  });
}
test('Legacy favorites load stale and acquire identity from matching Ranking', () => {
  const h = harness([row], [{ ...row, instrumentType: 'SWAP' }]);
  assert.equal(h.values()[0].updateStatus, 'stale');
  assert.equal(h.values()[0].instrumentType, undefined);
  h.sync();
  assert.equal(h.values()[0].instrumentType, 'SWAP');
});
test('Missing Ranking preserves saved fields and timestamp, visibly stale on desktop and mobile', () => {
  const saved = { ...row, instrumentType: 'SWAP', updatedAt: '2026-09-28T00:00:00Z' };
  const h = harness([saved]); h.sync();
  assert.deepEqual(h.values()[0], { ...saved, updateStatus: 'stale' });
  assert.equal((h.list.innerHTML.match(/Saved \/ stale/g) || []).length, 2);
});
test('SPOT row cannot refresh a saved SWAP record', () => {
  const h = harness([{ ...row, instrumentType: 'SWAP' }], [{ ...row, instrumentType: 'SPOT', opportunityScore: 10 }]);
  h.sync();
  assert.equal(h.values()[0].opportunityScore, 86);
  assert.equal(h.values()[0].updateStatus, 'stale');
});
test('Missing Ranking fields stay unavailable rather than borrowing saved values or fabricating defaults', () => {
  const h = harness([row], [{ symbol: row.symbol }]); h.sync();
  const result = h.values()[0];
  for (const field of ['opportunityScore', 'confidence', 'recommendationConfidence']) assert.equal(result[field], null);
  for (const field of ['grade', 'direction', 'action']) assert.equal(result[field], '—');
  assert.equal(h.context.compactFavoriteCoin({ symbol: row.symbol }).updatedAt, null);
});
test('High score and saved Grade A+ never manufacture canonical confirmation', () => {
  const h = harness();
  for (const confirmedAPlus of [undefined, null, false, 'true']) {
    const result = h.context.compactFavoriteCoin({ ...row, opportunityScore: 99, grade: 'A+', confirmedAPlus });
    assert.equal(result.confirmedAPlus, false);
  }
  assert.equal(h.context.compactFavoriteCoin({ ...row, confirmedAPlus: true }).confirmedAPlus, true);
  assert.equal(h.context.compactFavoriteCoin({ ...row, opportunityScore: 99 }).grade, 'A');
});
test('Add/remove and max 20 remain browser-local, including legacy load limit', () => {
  const saved = Array.from({ length: 22 }, (_, i) => ({ ...row, symbol: `COIN${i}USDT` }));
  const h = harness(saved);
  assert.equal(h.values().length, 20);
  h.context.toggleFavoriteCoin(row);
  assert.equal(h.values().length, 20);
  assert.equal(h.values()[0].symbol, row.symbol);
  h.context.toggleFavoriteCoin(row);
  assert.equal(h.values().length, 19);
  assert.ok(h.values().every(coin => coin.symbol !== row.symbol));
});
test('No fallback, polling or backend persistence; existing Market Analysis click remains', () => {
  assert.doesNotMatch(source, /fetch\(|loadFavoriteCoinAnalysis|setInterval|setTimeout|redis/i);
  assert.match(html, /openCoinModal\(favoriteCoin\.dataset\.symbol\)/);
  const h = harness([row]); h.sync(); // Would throw if any per-symbol request were attempted.
});
