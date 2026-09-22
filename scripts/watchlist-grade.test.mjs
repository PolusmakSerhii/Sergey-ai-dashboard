import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('    async function loadFavoriteCoinAnalysis(saved)');
const end = html.indexOf('    async function syncFavoriteCoinsWithRanking()', start);
assert.ok(start >= 0 && end > start);
async function load(technical, ok = true) {
  const saved = { symbol: 'TESTUSDT', opportunityScore: 90, grade: 'A+', confidence: 90, action: 'Buy' };
  const before = structuredClone(saved);
  const calls = [];
  const context = vm.createContext({ console: { error() {} }, fetch: async url => {
    calls.push(url);
    return { ok, status: ok ? 200 : 503, json: async () => ({ ok, technical, time: '2026-09-21T00:00:00Z' }) };
  }});
  vm.runInContext(html.slice(start, end), context);
  const result = await context.loadFavoriteCoinAnalysis(saved);
  assert.deepEqual(saved, before);
  assert.equal(calls.length, 1);
  return result;
}

for (const grade of ['D', 'C', 'B', 'A', 'A+']) {
  test(`Watchlist uses authoritative Opportunity Grade ${grade}, not recommendation grade`, async () => {
    const result = await load({ opportunityGrade: grade, opportunityScore: 90,
      recommendation: { grade: grade === 'A+' ? 'D' : 'A+', action: 'Sell' },
      probability: { confidence: { score: 87 }, aiAssessment: { grade: 'A+', direction: 'Short' } } });
    assert.equal(result.grade, grade);
    assert.equal(result.confidence, 87);
    assert.equal(result.direction, 'Short');
    assert.equal(result.action, 'Sell');
    assert.equal(result.updateStatus, 'direct');
    assert.equal(result.updatedAt, '2026-09-21T00:00:00Z');
  });
}
for (const grade of [undefined, null, '']) {
  test(`Missing canonical grade (${String(grade)}) never falls back to score or legacy A+`, async () => {
    const result = await load({ opportunityGrade: grade, opportunityScore: 99,
      recommendation: { grade: 'A+' }, probability: { aiAssessment: { grade: 'A+' } } });
    assert.equal(result.grade, '—');
  });
}
test('Unavailable response preserves existing stale-cache behavior', async () => {
  const result = await load({}, false);
  assert.equal(result.grade, 'A+');
  assert.equal(result.updateStatus, 'stale');
});
