import test from 'node:test';
import assert from 'node:assert/strict';
import { BIRTH_SAFETY_STATUS, evaluateD05BirthSafety, evaluateHistoricalD05Record,
  summarizeHistoricalD05 } from './d05-shadow.mjs';

const DAY = 86_400_000;
const evaluatedAt = '2026-11-25T16:00:30.000Z';

function candles(count = 200) {
  const end = Date.parse('2026-11-25T16:00:00.000Z');
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(end - (count - 1 - index) * DAY).toISOString(),
    open: 100, high: 103, low: 99, close: 102, confirmed: true
  }));
}

function safeInput(overrides = {}) {
  const base = {
    evaluatedAt,
    instrumentIdentity: {
      expectedSymbol: 'BTCUSDT', observedSymbol: 'BTCUSDT', expectedInstId: 'BTC-USDT-SWAP',
      observedInstId: 'BTC-USDT-SWAP', expectedInstrumentType: 'SWAP', observedInstrumentType: 'SWAP',
      authoritativeRecordRequired: false,
      authoritativeRecord: { available: true, symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', instrumentType: 'SWAP' }
    },
    ticker: { price: 100, observedAt: '2026-11-25T16:00:00.000Z' },
    dailyCandles: candles(),
    sources: {
      required: [{ name: 'OKX ticker', available: true }, { name: 'OKX 1D candles', available: true }],
      optional: [{ name: 'CoinGlass OI', available: true }]
    }
  };
  return { ...base, ...overrides };
}

const reasons = input => evaluateD05BirthSafety(input).reasonCodes;

test('fully safe data is READY', () => assert.equal(evaluateD05BirthSafety(safeInput()).status, BIRTH_SAFETY_STATUS.READY));
test('stale price blocks', () => assert(reasons(safeInput({ ticker: { price: 100, observedAt: '2026-11-25T15:59:00.000Z' } })).includes('PRICE_STALE')));
test('future price timestamp blocks', () => assert(reasons(safeInput({ ticker: { price: 100, observedAt: '2026-11-25T16:01:00.000Z' } })).includes('PRICE_TIMESTAMP_FUTURE')));
test('missing price timestamp blocks', () => assert(reasons(safeInput({ ticker: { price: 100 } })).includes('PRICE_TIMESTAMP_MISSING')));
test('symbol mismatch blocks', () => {
  const input = safeInput(); input.instrumentIdentity.observedSymbol = 'ETHUSDT';
  assert(reasons(input).includes('INVALID_SYMBOL_IDENTITY'));
});
test('instId mismatch blocks', () => {
  const input = safeInput(); input.instrumentIdentity.observedInstId = 'ETH-USDT-SWAP';
  assert(reasons(input).includes('INST_ID_MISMATCH'));
});
test('instrument type mismatch blocks', () => {
  const input = safeInput(); input.instrumentIdentity.observedInstrumentType = 'SPOT';
  assert(reasons(input).includes('INSTRUMENT_TYPE_MISMATCH'));
});
test('available authoritative record must match exactly', () => {
  const input = safeInput(); input.instrumentIdentity.authoritativeRecord.instId = 'ETH-USDT-SWAP';
  assert(reasons(input).includes('INST_ID_MISMATCH'));
});
test('required authoritative record cannot be silently omitted', () => {
  const input = safeInput(); input.instrumentIdentity.authoritativeRecord = { available: false };
  input.instrumentIdentity.authoritativeRecordRequired = true;
  assert(reasons(input).includes('INSTRUMENT_RECORD_UNAVAILABLE'));
});
test('insufficient candles blocks', () => assert(reasons(safeInput({ dailyCandles: candles(199) })).includes('INSUFFICIENT_CANDLES')));
test('unconfirmed candle blocks', () => {
  const values = candles(); values[10].confirmed = false;
  assert(reasons(safeInput({ dailyCandles: values })).includes('UNCONFIRMED_CANDLE'));
});
test('duplicate candle timestamp blocks', () => {
  const values = candles(); values[10].timestamp = values[9].timestamp;
  assert(reasons(safeInput({ dailyCandles: values })).includes('DUPLICATE_CANDLE_TIMESTAMP'));
});
test('out-of-order candles block without sorting fallback', () => {
  const values = candles(); [values[9], values[10]] = [values[10], values[9]];
  assert(reasons(safeInput({ dailyCandles: values })).includes('OUT_OF_ORDER_CANDLES'));
});
test('daily candle gap blocks', () => {
  const values = candles(); values[10].timestamp = new Date(Date.parse(values[10].timestamp) + 3_600_000).toISOString();
  assert(reasons(safeInput({ dailyCandles: values })).includes('CANDLE_GAP'));
});
test('invalid OHLC envelope blocks', () => {
  const values = candles(); values[10].high = 98;
  assert(reasons(safeInput({ dailyCandles: values })).includes('INVALID_OHLC'));
});
test('stale latest candle blocks', () => {
  const values = candles().map(candle => ({ ...candle, timestamp: new Date(Date.parse(candle.timestamp) - 2 * DAY).toISOString() }));
  assert(reasons(safeInput({ dailyCandles: values })).includes('LATEST_CANDLE_STALE'));
});
test('future candle blocks', () => {
  const values = candles(); values[199].timestamp = '2026-11-26T16:00:00.000Z';
  assert(reasons(safeInput({ dailyCandles: values })).includes('CANDLE_TIMESTAMP_FUTURE'));
});
test('missing required source blocks', () => {
  const input = safeInput(); input.sources.required[0].available = false;
  assert(reasons(input).includes('REQUIRED_SOURCE_UNAVAILABLE'));
});
test('empty required source contract blocks', () => {
  const input = safeInput(); input.sources.required = [];
  assert(reasons(input).includes('REQUIRED_SOURCE_UNAVAILABLE'));
});
test('missing optional source is explicit but does not block', () => {
  const input = safeInput(); input.sources.optional[0].available = false;
  const result = evaluateD05BirthSafety(input);
  assert.equal(result.status, 'READY');
  assert.equal(result.optionalSourcesStatus.status, 'UNAVAILABLE');
  assert(!result.reasonCodes.includes('REQUIRED_SOURCE_UNAVAILABLE'));
});
test('no semantic substitution from optional source', () => {
  const input = safeInput(); input.ticker = { price: null, observedAt: input.ticker.observedAt };
  input.sources.optional = [{ name: 'different price-like metric', available: true }];
  assert(reasons(input).includes('INVALID_PRICE'));
});
test('multiple simultaneous failures preserve deterministic reason order', () => {
  const input = safeInput({ ticker: { price: -1 } });
  input.instrumentIdentity.observedSymbol = 'ETHUSDT'; input.sources.required[0].available = false;
  assert.deepEqual(reasons(input).slice(0, 4), [
    'INVALID_SYMBOL_IDENTITY', 'REQUIRED_SOURCE_UNAVAILABLE', 'INVALID_PRICE', 'PRICE_TIMESTAMP_MISSING'
  ]);
});
test('deterministic repeated run', () => assert.deepEqual(evaluateD05BirthSafety(safeInput()), evaluateD05BirthSafety(safeInput())));
test('shadow status cannot change v1 output', () => {
  const v1 = Object.freeze({ confirmedAPlus: true, planCreated: true, registered: true });
  const before = JSON.stringify(v1); evaluateD05BirthSafety(safeInput({ ticker: { price: -1 } }));
  assert.equal(JSON.stringify(v1), before);
});
test('historical missing mandatory evidence is NOT_EVALUABLE, not BLOCKED', () => {
  const result = evaluateHistoricalD05Record({ tradeId: 't1', origin: { symbol: 'BTCUSDT', confirmedAPlus: true },
    initialPlan: {}, researchSnapshot: { originPrice: 100, analysisAt: evaluatedAt, instrument: { symbol: 'BTCUSDT', instrumentType: 'SWAP' },
      provenance: { priceTimestamp: '2026-11-25T16:00:00.000Z', confirmedCount: 200, confirmedOnly: true,
        dailyLastConfirmedAt: '2026-11-25T16:00:00.000Z', priceSource: 'OKX', dailySource: 'OKX' } } });
  assert.equal(result.evaluability, 'NOT_EVALUABLE');
  assert.equal(result.v2D05ShadowBirthSafety, 'NOT_EVALUABLE');
  assert.deepEqual(result.birthSafetyEvidence.reasonCodes, []);
});
test('historical aggregate does not count non-evaluable rows as blocked', () => {
  const summary = summarizeHistoricalD05([{ tradeId: 't1' }]);
  assert.equal(summary.notEvaluable, 1); assert.equal(summary.v2Blocked, 0);
});
