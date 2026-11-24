import test from 'node:test';
import assert from 'node:assert/strict';
import { compareD03Semantics, D03_CLASSIFICATION, evaluateD03Shadow, summarizeD03Comparisons } from './d03-shadow.mjs';

const input = overrides => ({ openInterestChange24h: 2, priceChange24h: 3,
  openInterestSource: 'CoinGlass', priceSource: 'OKX SWAP ticker', observedAt: '2026-11-24T10:00:00.000Z', ...overrides });

for (const [name, oi, price, classification] of [
  ['OI up / price up', 2, 3, D03_CLASSIFICATION.BULLISH],
  ['OI up / price down', 2, -3, D03_CLASSIFICATION.BEARISH],
  ['OI down / price up', -2, 3, D03_CLASSIFICATION.SHORT_COVERING],
  ['OI down / price down', -2, -3, D03_CLASSIFICATION.LONG_LIQUIDATION]
]) test(name, () => assert.equal(evaluateD03Shadow(input({ openInterestChange24h: oi, priceChange24h: price })).classification, classification));

test('OI zero is explicitly stable', () => assert.equal(
  evaluateD03Shadow(input({ openInterestChange24h: 0 })).classification, D03_CLASSIFICATION.OI_FLAT));
test('price zero is explicitly flat', () => assert.equal(
  evaluateD03Shadow(input({ priceChange24h: 0 })).classification, D03_CLASSIFICATION.PRICE_FLAT));
test('both zero is explicitly flat', () => assert.equal(
  evaluateD03Shadow(input({ openInterestChange24h: 0, priceChange24h: 0 })).classification, D03_CLASSIFICATION.BOTH_FLAT));
test('missing OI is unavailable', () => assert.deepEqual(
  evaluateD03Shadow(input({ openInterestChange24h: null })).reasonCodes, ['MISSING_OPEN_INTEREST_CHANGE_24H']));
test('missing price is unavailable', () => assert.deepEqual(
  evaluateD03Shadow(input({ priceChange24h: undefined })).reasonCodes, ['MISSING_PRICE_CHANGE_24H']));
test('NaN is unavailable without coercion', () => assert.equal(
  evaluateD03Shadow(input({ priceChange24h: NaN })).classification, D03_CLASSIFICATION.UNAVAILABLE));
test('Infinity is unavailable without coercion', () => assert.equal(
  evaluateD03Shadow(input({ openInterestChange24h: Infinity })).classification, D03_CLASSIFICATION.UNAVAILABLE));
test('v2 never substitutes OI change for price change', () => {
  const result = compareD03Semantics(input({ openInterestChange24h: 2, priceChange24h: -3 }));
  assert.equal(result.v1.classification, D03_CLASSIFICATION.BULLISH);
  assert.equal(result.v2.classification, D03_CLASSIFICATION.BEARISH);
  assert.equal(result.comparison, 'DIFFERENT');
});
test('source labels are preserved', () => {
  const result = evaluateD03Shadow(input());
  assert.equal(result.input.openInterestSource, 'CoinGlass');
  assert.equal(result.input.priceSource, 'OKX SWAP ticker');
});
test('observedAt is preserved canonically', () => assert.equal(
  evaluateD03Shadow(input()).input.observedAt, '2026-11-24T10:00:00.000Z'));
test('shadow calculation cannot mutate a v1 production-shaped object', () => {
  const v1 = Object.freeze({ probability: Object.freeze({ score: 91 }), opportunityScore: 88, confirmedAPlus: true });
  const before = JSON.stringify(v1); compareD03Semantics(input()); assert.equal(JSON.stringify(v1), before);
});
test('downstream counterfactual is not invented from incomplete contract', () => {
  const result = compareD03Semantics(input());
  assert.equal(result.downstreamCounterfactual.status, 'NOT_PROVEN');
  assert.equal(result.downstreamCounterfactual.probabilityDelta, null);
});
test('repeated run and aggregate are deterministic', () => {
  const records = [{ comparison: compareD03Semantics(input()) },
    { comparison: compareD03Semantics(input({ priceChange24h: null })) }];
  assert.deepEqual(summarizeD03Comparisons(records), summarizeD03Comparisons(records));
});
