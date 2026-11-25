import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticalRoundingFixtures, evaluateD04Shadow, OKX_TICK_SOURCE, quantizeToTick,
  summarizeD04 } from './d04-shadow.mjs';

const observedAt = '2026-11-25T09:30:00.000Z';
const contract = (tickSize = '0.01', overrides = {}) => ({
  symbol: 'TESTUSDT', instId: 'TEST-USDT-SWAP', instrumentType: 'SWAP', tickSize,
  tickSource: OKX_TICK_SOURCE, instrumentRecordObservedAt: observedAt, ...overrides
});
const geometry = (overrides = {}) => ({
  symbol: 'TESTUSDT', instrumentType: 'SWAP', plannedEntry: 100.123, entryZoneLow: 100.011, entryZoneHigh: 100.239,
  stop: 98.987, tp1: 102.345, tp2: 104.567, tp3: 106.789, ...overrides
});
const shadow = (direction = 'Long', geometryOverrides = {}, tickSize = '0.01') =>
  evaluateD04Shadow({ direction, geometry: geometry(geometryOverrides), tickContract: contract(tickSize) });

test('BTC-like tick uses exact decimal units', () => assert.equal(quantizeToTick('67432.127', '0.1', 'nearest'), '67432.1'));
test('$100 asset tick', () => assert.equal(quantizeToTick('100.1234', '0.01', 'floor'), '100.12'));
test('sub-$1 asset tick', () => assert.equal(quantizeToTick('0.12347', '0.0001', 'nearest'), '0.1235'));
test('sub-cent asset tick', () => assert.equal(quantizeToTick('0.00447', '0.0001', 'floor'), '0.0044'));
test('very cheap asset tick', () => assert.equal(quantizeToTick('0.00001237', '0.0000001', 'ceil'), '0.0000124'));
test('exact tick boundary stays exact', () => assert.equal(quantizeToTick('100.12', '0.01', 'nearest'), '100.12'));
test('non-tick boundary rounds half-up for nearest', () => assert.equal(quantizeToTick('100.125', '0.01', 'nearest'), '100.13'));
test('LONG stop rounds down', () => assert.equal(shadow().v2D04TickGeometry.exactDecimal.stop, '98.98'));
test('SHORT stop rounds up', () => assert.equal(shadow('Short', {
  plannedEntry: 100.123, entryZoneLow: 100.011, entryZoneHigh: 100.239, stop: 102.345,
  tp1: 98.987, tp2: 96.765, tp3: 94.543
}).v2D04TickGeometry.exactDecimal.stop, '102.35'));
test('LONG targets round down', () => assert.equal(shadow().v2D04TickGeometry.exactDecimal.tp1, '102.34'));
test('SHORT targets round up', () => assert.equal(shadow('Short', {
  stop: 102.345, tp1: 98.987, tp2: 96.765, tp3: 94.543
}).v2D04TickGeometry.exactDecimal.tp1, '98.99'));
test('entry zone quantizes inward', () => {
  const result = shadow();
  assert.equal(result.v2D04TickGeometry.exactDecimal.entryZoneLow, '100.02');
  assert.equal(result.v2D04TickGeometry.exactDecimal.entryZoneHigh, '100.23');
});
test('planned entry is constrained inside quantized zone', () => {
  const result = shadow('Long', { plannedEntry: 100.001 });
  assert.equal(result.v2D04TickGeometry.exactDecimal.plannedEntry, '100.02');
});
test('collapsed entry zone is invalid after quantization', () => {
  const result = shadow('Long', { entryZoneLow: 100.011, entryZoneHigh: 100.019 });
  assert.equal(result.status, 'INVALID_AFTER_QUANTIZATION');
  assert(result.reasonCodes.includes('ENTRY_ZONE_COLLAPSED'));
});
test('invalid directional geometry after quantization is not repaired', () => {
  const result = shadow('Long', { tp1: 100.239 });
  assert.equal(result.status, 'INVALID_AFTER_QUANTIZATION');
  assert(result.reasonCodes.includes('INVALID_LONG_GEOMETRY'));
});
test('unknown tick is unavailable', () => {
  const result = evaluateD04Shadow({ direction: 'Long', geometry: geometry(), tickContract: null });
  assert.equal(result.status, 'UNAVAILABLE');
});
test('tick is never inferred from price decimals', () => {
  const result = evaluateD04Shadow({ direction: 'Long', geometry: geometry({ plannedEntry: 100.123456 }),
    tickContract: contract('', { tickSize: null }) });
  assert.equal(result.status, 'UNAVAILABLE');
});
test('raw analytical precision is preserved separately', () => {
  const fixtures = buildAnalyticalRoundingFixtures();
  assert.equal(fixtures.find(item => item.name === 'very-cheap-token').rawValue, '0.0000123');
  assert(fixtures.every(item => item.rawValuesPreserved));
});
test('distinct raw levels are not merged by tick-aware fixture output', () => {
  const item = buildAnalyticalRoundingFixtures().find(value => value.name === 'sub-0.01');
  assert.notEqual(item.tickAwareExecutableValue, item.tickAwareDistinctLevel);
});
test('toFixed(2) zero-collapse is proven', () => {
  const fixtures = buildAnalyticalRoundingFixtures();
  assert(fixtures.some(item => item.zeroCollapse));
});
test('toFixed(2) level merge changes structural predicate', () => {
  const fixtures = buildAnalyticalRoundingFixtures();
  assert(fixtures.some(item => item.mergesDistinctLevels && item.changesStructuralPredicate));
});
test('D01 metrics are recomputed from tick-aligned geometry', () => {
  const result = shadow();
  assert.equal(result.status, 'VALID');
  assert(Number.isFinite(result.comparison.shadowMetrics.tp1WeightedR));
  assert(Number.isFinite(result.comparison.metricDeltas.modeledCostRAtEntry));
});
test('repeated run and aggregate are deterministic', () => {
  const result = shadow();
  const records = [{ evaluability: 'FULLY_EVALUABLE', tickMetadataAvailable: true, shadow: result }];
  assert.deepEqual(evaluateD04Shadow({ direction: 'Long', geometry: geometry(), tickContract: contract() }), result);
  assert.deepEqual(summarizeD04(records), summarizeD04(records));
});
test('shadow cannot affect v1 geometry or result', () => {
  const v1 = geometry(); const before = structuredClone(v1);
  const result = evaluateD04Shadow({ direction: 'Long', geometry: v1, tickContract: contract() });
  assert.deepEqual(v1, before);
  assert.deepEqual(result.v1CurrentGeometry, before);
});
