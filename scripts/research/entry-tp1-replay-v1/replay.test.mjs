import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplayArtifact, calculateCostDiagnostics, replayV1Parity, RESULT } from './replay.mjs';

const T = Date.parse('2026-11-02T00:00:00.000Z');
const candle = (minute, open, high, low, close = open) => ({ timestamp: T + minute * 60_000, open, high, low, close, confirmed: true });
const base = (overrides = {}) => ({
  tradeId: 'TESTUSDT:Long:2026-11-02T00:00:00.000Z', symbol: 'TESTUSDT', direction: 'Long',
  originAt: '2026-11-02T00:00:00.000Z', plannedAt: '2026-11-02T00:00:00.000Z',
  expiresAt: '2026-11-02T01:00:00.000Z', replayEndAt: '2026-11-02T00:03:00.000Z',
  plannedEntry: 100, entryZone: { from: 99, to: 101 }, initialStopLoss: 95, takeProfit1: 105,
  strategyVersion: 'core-v1', exitPolicyVersion: 'tp1-50-reanalyse-v1',
  candles: [candle(0, 100, 101, 99), candle(1, 101, 105, 100)], ...overrides
});

test('LONG TP1 before SL', () => assert.equal(replayV1Parity(base()).replayResult, RESULT.TP1));
test('LONG SL before TP1', () => assert.equal(replayV1Parity(base({ candles: [candle(0, 100, 101, 99), candle(1, 99, 100, 95)] })).replayResult, RESULT.SL));
test('SHORT TP1 before SL', () => assert.equal(replayV1Parity(base({ direction: 'Short', entryZone: { from: 99, to: 101 }, initialStopLoss: 105, takeProfit1: 95, candles: [candle(0, 100, 101, 99), candle(1, 99, 100, 95)] })).replayResult, RESULT.TP1));
test('SHORT SL before TP1', () => assert.equal(replayV1Parity(base({ direction: 'Short', entryZone: { from: 99, to: 101 }, initialStopLoss: 105, takeProfit1: 95, candles: [candle(0, 100, 101, 99), candle(1, 101, 105, 100)] })).replayResult, RESULT.SL));
test('same candle SL and TP1 is ambiguous', () => assert.equal(replayV1Parity(base({ candles: [candle(0, 100, 105, 95)] })).replayResult, RESULT.AMBIGUOUS));
test('unresolved window', () => assert.equal(replayV1Parity(base({ candles: [candle(0, 100, 101, 99), candle(1, 100, 102, 98)] })).replayResult, RESULT.UNRESOLVED));
test('malformed candle fails closed', () => assert.deepEqual(replayV1Parity(base({ candles: [candle(0, 100, 99, 98)] })).reasonCodes, ['INVALID_CANDLE_OHLC']));
test('missing geometry fails closed', () => assert.equal(replayV1Parity(base({ entryZone: null })).replayResult, RESULT.INVALID));
test('entry equal to SL fails closed', () => assert.ok(replayV1Parity(base({ plannedEntry: 95 })).reasonCodes.includes('ENTRY_EQUALS_STOP')));
test('duplicate candle timestamps fail closed', () => assert.ok(replayV1Parity(base({ candles: [candle(0, 100, 101, 99), candle(0, 100, 101, 99)] })).reasonCodes.includes('DUPLICATE_CANDLE_TIMESTAMP')));
test('out-of-order candles are deterministically sorted', () => {
  const result = replayV1Parity(base({ candles: [candle(1, 101, 105, 100), candle(0, 100, 101, 99)] }));
  assert.equal(result.replayResult, RESULT.TP1); assert.equal(result.inputWasOutOfOrder, true);
});
test('gap after sorting is unresolved', () => assert.deepEqual(replayV1Parity(base({ candles: [candle(2, 101, 105, 100), candle(0, 100, 101, 99)] })).reasonCodes, ['CANDLE_GAP']));
test('exact boundary touches count', () => assert.equal(replayV1Parity(base({ candles: [candle(0, 101, 101, 101), candle(1, 101, 105, 101)] })).replayResult, RESULT.TP1));
test('cost-in-R formula', () => assert.equal(calculateCostDiagnostics({ entryPrice: 100, entryZone: { from: 99, to: 101 }, initialStopLoss: 95 }).modeledCostRAtEntry, 0.03));
test('best and worst zone cost-in-R use endpoint extrema', () => {
  const costs = calculateCostDiagnostics({ entryPrice: 100, entryZone: { from: 99, to: 101 }, initialStopLoss: 95 });
  assert.equal(costs.bestZoneCostR, 0.02525); assert.equal(costs.worstZoneCostR, 0.037125);
});
test('archived parity match and mismatch are explicit', () => {
  assert.equal(replayV1Parity(base({ archivedResult: RESULT.TP1 })).parity, 'MATCH');
  assert.equal(replayV1Parity(base({ archivedResult: RESULT.SL })).parity, 'MISMATCH');
});
test('stable output on repeated run with frozen generatedAt', () => {
  const metadata = { generatedAt: '2026-11-21T00:00:00.000Z' };
  assert.deepEqual(buildReplayArtifact([base()], metadata), buildReplayArtifact([base()], metadata));
});
test('missing separately persisted strategy version does not invent or block geometry replay', () => {
  assert.equal(replayV1Parity(base({ strategyVersion: null })).replayResult, RESULT.TP1);
});
