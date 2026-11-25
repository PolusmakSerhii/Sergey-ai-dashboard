import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateD06Atr, evaluateD06Geometry, rawPlanGeometry, summarizeD06, volatilityLabel } from './d06-shadow.mjs';
import { OKX_TICK_SOURCE } from './d04-shadow.mjs';

const DAY = 86_400_000;
const start = Date.parse('2026-11-01T16:00:00.000Z');
const evaluatedAt = '2026-11-16T15:00:00.000Z';

function candles(count = 15) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(start + index * DAY).toISOString(),
    open: 100, high: 101, low: 99, close: 100, confirmed: true
  }));
}

const atr = (values = candles(), price = 100) => evaluateD06Atr({ candles: values, evaluatedAt, price });
const tickContract = { symbol: 'TESTUSDT', instId: 'TEST-USDT-SWAP', instrumentType: 'SWAP', tickSize: '0.01',
  tickSource: OKX_TICK_SOURCE, instrumentRecordObservedAt: '2026-11-25T09:25:16.000Z' };
const longV1 = { plannedEntry: 100, entryZoneLow: 99.5, entryZoneHigh: 100.2, stop: 98, tp1: 102, tp2: 104, tp3: 106 };
const shortV1 = { plannedEntry: 100, entryZoneLow: 99.8, entryZoneHigh: 100.5, stop: 102, tp1: 98, tp2: 96, tp3: 94 };

test('no-gap candle uses high-low true range', () => {
  const result = atr(); assert.equal(result.atrV1, 2); assert.equal(result.atrV2TrueRange, 2);
});
test('gap-up candle uses previous close', () => {
  const values = candles(); values[14] = { ...values[14], open: 106, high: 107, low: 105, close: 106 };
  const result = atr(values); assert.equal(result.gapAttribution.gapUpCount, 1); assert(result.atrV2TrueRange > result.atrV1);
});
test('gap-down candle uses previous close', () => {
  const values = candles(); values[14] = { ...values[14], open: 94, high: 95, low: 93, close: 94 };
  const result = atr(values); assert.equal(result.gapAttribution.gapDownCount, 1); assert(result.atrV2TrueRange > result.atrV1);
});
test('first candle supplies previous close and is not a TR observation', () => {
  const result = atr(); assert.equal(result.countTrObservations, 14);
  assert.equal(result.gapAttribution.observations[0].timestamp, candles()[1].timestamp);
});
test('exactly 15 candles are available', () => assert.equal(atr(candles(15)).status, 'AVAILABLE'));
test('fewer than 15 candles are unavailable', () => assert(atr(candles(14)).reasonCodes.includes('INSUFFICIENT_CANDLES')));
test('duplicate timestamp is unavailable', () => {
  const values = candles(); values[5].timestamp = values[4].timestamp;
  assert(atr(values).reasonCodes.includes('DUPLICATE_CANDLE_TIMESTAMP'));
});
test('out-of-order candles are unavailable', () => {
  const values = candles(); [values[4], values[5]] = [values[5], values[4]];
  assert(atr(values).reasonCodes.includes('OUT_OF_ORDER_CANDLES'));
});
test('daily candle gap is unavailable', () => {
  const values = candles(); values[5].timestamp = new Date(Date.parse(values[5].timestamp) + 3_600_000).toISOString();
  assert(atr(values).reasonCodes.includes('CANDLE_GAP'));
});
test('unconfirmed candle is unavailable', () => {
  const values = candles(); values[5].confirmed = false;
  assert(atr(values).reasonCodes.includes('UNCONFIRMED_CANDLE'));
});
test('invalid OHLC is unavailable', () => {
  const values = candles(); values[5].high = 98;
  assert(atr(values).reasonCodes.includes('INVALID_OHLC'));
});
test('future candle is unavailable', () => {
  const values = candles(); values[14].timestamp = '2026-11-17T16:00:00.000Z';
  assert(atr(values).reasonCodes.includes('CANDLE_TIMESTAMP_FUTURE'));
});
test('arithmetic mean is deterministic and not Wilder smoothing', () => {
  const values = candles(); values[14] = { ...values[14], open: 106, high: 107, low: 105, close: 106 };
  assert.equal(atr(values).atrV2TrueRange, Number(((13 * 2 + 7) / 14).toPrecision(6)));
});
test('ATR v1 and v2 parity holds without gaps', () => assert.equal(atr().comparison.atrEqual, true));
test('ATR v2 is greater with a gap', () => {
  const values = candles(); values[14] = { ...values[14], open: 106, high: 107, low: 105, close: 106 };
  assert.equal(atr(values).comparison.atrV2Greater, true);
});
test('volatility label is unchanged inside same threshold band', () => {
  assert.equal(volatilityLabel(2.1, 100).label, volatilityLabel(3.5, 100).label);
});
test('volatility label changes at frozen threshold', () => {
  const values = candles().map(candle => ({ ...candle, open: 100, high: 100.45, low: 99.55, close: 100 }));
  values[14] = { ...values[14], open: 103.5, high: 104, low: 103, close: 103.5 };
  const result = atr(values); assert.equal(result.volatility.v1VolatilityLabel, 'Very Low');
  assert.equal(result.volatility.v2D06VolatilityLabel, 'Low'); assert.equal(result.volatility.volatilityLabelChanged, true);
});
test('LONG geometry recomputes only from reference price and ATR', () => {
  assert.deepEqual(rawPlanGeometry('Long', 100, 2), { ...longV1, plannedEntry: 99.85 });
});
test('SHORT geometry recomputes only from reference price and ATR', () => {
  assert.deepEqual(rawPlanGeometry('Short', 100, 2), { ...shortV1, plannedEntry: 100.15 });
});
test('D04 tick quantization is preserved in D06 geometry', () => {
  const result = evaluateD06Geometry({ direction: 'Long', symbol: 'TESTUSDT', referencePrice: 100.123,
    atrV2: 2.127, tickContract, v1Geometry: longV1 });
  assert.equal(result.status, 'AVAILABLE'); assert.equal(result.v2D06Geometry.exactDecimal.stop, '97.99');
});
test('D01 metrics are recomputed from D06 tick geometry', () => {
  const result = evaluateD06Geometry({ direction: 'Long', symbol: 'TESTUSDT', referencePrice: 100.123,
    atrV2: 2.127, tickContract, v1Geometry: longV1 });
  assert.equal(result.d01.shadow.valid, true); assert(Number.isFinite(result.d01.deltas.modeledCostRAtEntry));
});
test('D06 creates no expected-value field', () => {
  const result = atr(); assert.equal(Object.hasOwn(result, 'expectedValue'), false);
});
test('repeated run and aggregate are deterministic', () => {
  const result = atr(); assert.deepEqual(result, atr());
  const records = [{ evaluability: 'FULLY_EVALUABLE', atr: result,
    geometry: evaluateD06Geometry({ direction: 'Long', symbol: 'TESTUSDT', referencePrice: 100,
      atrV2: 2, tickContract, v1Geometry: longV1 }) }];
  assert.deepEqual(summarizeD06(records), summarizeD06(records));
});
test('shadow cannot affect frozen v1 input', () => {
  const v1 = structuredClone(longV1); const before = structuredClone(v1);
  evaluateD06Geometry({ direction: 'Long', symbol: 'TESTUSDT', referencePrice: 100.123,
    atrV2: 2.127, tickContract, v1Geometry: v1 });
  assert.deepEqual(v1, before);
});
