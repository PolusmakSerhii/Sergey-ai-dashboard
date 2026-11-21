#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { calculateLifecycleAlignedEconomics, summarizeD01 } from './d01.mjs';

export const REPLAY_VERSION = 'entry-tp1-replay-v1';
export const REPLAY_MODE = 'v1-parity';
export const MINUTE_MS = 60_000;
export const RESULT = Object.freeze({
  TP1: 'TP1_BEFORE_SL',
  SL: 'SL_BEFORE_TP1',
  AMBIGUOUS: 'AMBIGUOUS_SAME_CANDLE',
  UNRESOLVED: 'UNRESOLVED',
  INVALID: 'INVALID_INPUT'
});

export const REPLAY_INPUT_SCHEMA = Object.freeze({
  required: {
    tradeId: 'non-empty string',
    symbol: 'uppercase USDT symbol',
    direction: 'Long | Short',
    originAt: 'ISO-8601 timestamp',
    plannedAt: 'ISO-8601 timestamp aligned to one minute',
    expiresAt: 'ISO-8601 timestamp after plannedAt',
    plannedEntry: 'finite positive number',
    entryZone: '{ from: finite positive number, to: finite positive number }',
    initialStopLoss: 'finite positive number',
    takeProfit1: 'finite positive number',
    exitPolicyVersion: 'non-empty string',
    replayEndAt: 'ISO-8601 timestamp after plannedAt',
    candles: 'confirmed 1m OHLC array covering the required replay interval'
  },
  optional: {
    strategyVersion: 'saved strategy identifier when explicitly available; null when archive did not persist one',
    activationAt: 'archived activation ISO timestamp',
    archivedResult: 'TP1_BEFORE_SL | SL_BEFORE_TP1 | AMBIGUOUS_SAME_CANDLE | UNRESOLVED',
    instrument: 'tick/precision metadata',
    diagnostics: 'saved ATR, volatility, score, provenance, trend and structure evidence',
    headlineRiskReward: 'saved v1 headline R:R for D01 comparison',
    observedRemainderR: 'archived post-TP1 remainder R, observation only',
    observedFinalGrossR: 'archived final gross R, observation only'
  },
  candle: '{ timestamp: epoch milliseconds, open, high, low, close: finite positive numbers, confirmed: true }'
});

const finitePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isoTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const round = value => Number.isFinite(value) ? Number(value.toPrecision(15)) : null;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function invalid(reasonCodes, details = {}) {
  return {
    replayResult: RESULT.INVALID,
    tp1ReachedBeforeSl: 'UNRESOLVED',
    reasonCodes: [...new Set(reasonCodes)],
    ...details
  };
}

function validateCandle(candle) {
  if (!candle || typeof candle !== 'object') return 'INVALID_CANDLE_OBJECT';
  if (!Number.isInteger(candle.timestamp) || candle.timestamp % MINUTE_MS !== 0) return 'INVALID_CANDLE_TIMESTAMP';
  if (![candle.open, candle.high, candle.low, candle.close].every(finitePositive)) return 'INVALID_CANDLE_PRICE';
  if (candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close) || candle.low > candle.high) {
    return 'INVALID_CANDLE_OHLC';
  }
  if (candle.confirmed !== true) return 'UNCONFIRMED_CANDLE';
  return null;
}

export function validateReplayInput(input) {
  const reasons = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid(['INVALID_INPUT_OBJECT']);
  if (typeof input.tradeId !== 'string' || !input.tradeId.trim()) reasons.push('MISSING_TRADE_ID');
  if (typeof input.symbol !== 'string' || !/^[A-Z0-9]{1,20}USDT$/.test(input.symbol)) reasons.push('INVALID_SYMBOL');
  if (!['Long', 'Short'].includes(input.direction)) reasons.push('INVALID_DIRECTION');
  for (const field of ['originAt', 'plannedAt', 'expiresAt', 'replayEndAt']) {
    if (!isoTime(input[field])) reasons.push(`INVALID_${field.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
  }
  if (input.activationAt != null && !isoTime(input.activationAt)) reasons.push('INVALID_ACTIVATION_AT');
  for (const [field, value] of [['plannedEntry', input.plannedEntry], ['initialStopLoss', input.initialStopLoss], ['takeProfit1', input.takeProfit1]]) {
    if (!finitePositive(value)) reasons.push(`INVALID_${field.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
  }
  if (!input.entryZone || !finitePositive(input.entryZone.from) || !finitePositive(input.entryZone.to)) reasons.push('INVALID_ENTRY_ZONE');
  if (input.strategyVersion != null && (typeof input.strategyVersion !== 'string' || !input.strategyVersion)) reasons.push('INVALID_STRATEGY_VERSION');
  if (typeof input.exitPolicyVersion !== 'string' || !input.exitPolicyVersion) reasons.push('MISSING_EXIT_POLICY_VERSION');
  if (!Array.isArray(input.candles) || input.candles.length === 0) reasons.push('MISSING_CANDLES');

  const planned = Date.parse(input.plannedAt);
  const expires = Date.parse(input.expiresAt);
  const replayEnd = Date.parse(input.replayEndAt);
  if (Number.isFinite(planned) && planned % MINUTE_MS !== 0) reasons.push('PLANNED_AT_NOT_MINUTE_ALIGNED');
  if (Number.isFinite(expires) && Number.isFinite(planned) && expires <= planned) reasons.push('INVALID_EXPIRY_ORDER');
  if (Number.isFinite(replayEnd) && Number.isFinite(planned) && replayEnd <= planned) reasons.push('INVALID_REPLAY_WINDOW');
  if (finitePositive(input.plannedEntry) && finitePositive(input.initialStopLoss) && input.plannedEntry === input.initialStopLoss) reasons.push('ENTRY_EQUALS_STOP');

  if (input.entryZone && finitePositive(input.entryZone.from) && finitePositive(input.entryZone.to) &&
      finitePositive(input.initialStopLoss) && finitePositive(input.takeProfit1) && ['Long', 'Short'].includes(input.direction)) {
    const low = Math.min(input.entryZone.from, input.entryZone.to);
    const high = Math.max(input.entryZone.from, input.entryZone.to);
    const validGeometry = input.direction === 'Long'
      ? input.initialStopLoss < low && input.takeProfit1 > high
      : input.initialStopLoss > high && input.takeProfit1 < low;
    if (!validGeometry) reasons.push('INVALID_DIRECTIONAL_GEOMETRY');
  }

  const seen = new Set();
  let inputWasOutOfOrder = false;
  if (Array.isArray(input.candles)) {
    input.candles.forEach((candle, index) => {
      const candleError = validateCandle(candle);
      if (candleError) reasons.push(candleError);
      if (Number.isInteger(candle?.timestamp)) {
        if (seen.has(candle.timestamp)) reasons.push('DUPLICATE_CANDLE_TIMESTAMP');
        seen.add(candle.timestamp);
        if (index > 0 && candle.timestamp < input.candles[index - 1]?.timestamp) inputWasOutOfOrder = true;
      }
    });
  }
  return reasons.length ? invalid(reasons, { inputWasOutOfOrder }) : { valid: true, inputWasOutOfOrder };
}

export function calculateCostDiagnostics({ entryPrice, entryZone, initialStopLoss }) {
  const cost = price => finitePositive(price) && finitePositive(initialStopLoss) && price !== initialStopLoss
    ? round(0.0015 * price / Math.abs(price - initialStopLoss)) : null;
  const low = Math.min(entryZone?.from, entryZone?.to);
  const high = Math.max(entryZone?.from, entryZone?.to);
  const endpointCosts = [cost(low), cost(high)].filter(Number.isFinite);
  return {
    modeledCostRAtEntry: cost(entryPrice),
    midpointCostR: cost((low + high) / 2),
    bestZoneCostR: endpointCosts.length ? Math.min(...endpointCosts) : null,
    worstZoneCostR: endpointCosts.length ? Math.max(...endpointCosts) : null
  };
}

function archivedParity(input, replayResult) {
  if (!input.archivedResult) return { parity: 'NOT_AVAILABLE', mismatchCause: null };
  if (input.archivedResult === replayResult) return { parity: 'MATCH', mismatchCause: null };
  const mismatchCause = replayResult === RESULT.AMBIGUOUS ? 'ARCHIVE_ASSIGNED_INTRACANDLE_ORDER'
    : replayResult === RESULT.UNRESOLVED ? 'REPLAY_DATA_INCOMPLETE_OR_WINDOW_ENDED'
      : replayResult === RESULT.INVALID ? 'INVALID_REPLAY_INPUT' : 'ARCHIVE_REPLAY_RESULT_DIFFERENCE';
  return { parity: 'MISMATCH', mismatchCause };
}

function evidence(input, activation, resolvedCandle, costs) {
  const diagnostics = input.diagnostics && typeof input.diagnostics === 'object' ? input.diagnostics : {};
  const zoneLow = Math.min(input.entryZone.from, input.entryZone.to);
  const zoneHigh = Math.max(input.entryZone.from, input.entryZone.to);
  const entryPrice = activation?.entryPrice ?? null;
  const risk = Number.isFinite(entryPrice) ? Math.abs(entryPrice - input.initialStopLoss) : null;
  const zoneWidth = zoneHigh - zoneLow;
  const originPrice = diagnostics.originPrice;
  return {
    direction: input.direction,
    opportunityScore: diagnostics.opportunityScore ?? null,
    opportunityGrade: diagnostics.opportunityGrade ?? null,
    volatilityLabel: diagnostics.volatilityLabel ?? null,
    atr: diagnostics.atr ?? null,
    atrPercent: diagnostics.atrPercent ?? null,
    entryToSlDistance: risk == null ? null : round(risk),
    entryToTp1Distance: entryPrice == null ? null : round(Math.abs(input.takeProfit1 - entryPrice)),
    riskDistancePercentOfPrice: entryPrice == null ? null : round(100 * risk / entryPrice),
    ...costs,
    signalAgeMs: Number.isFinite(Date.parse(input.plannedAt)) && Number.isFinite(Date.parse(input.originAt))
      ? Date.parse(input.plannedAt) - Date.parse(input.originAt) : null,
    analysisToOriginDelayMs: isoTime(diagnostics.analysisAt) ? Date.parse(input.originAt) - Date.parse(diagnostics.analysisAt) : null,
    priceTimestampDelayMs: isoTime(diagnostics.priceTimestamp) ? Date.parse(input.originAt) - Date.parse(diagnostics.priceTimestamp) : null,
    entryZoneWidth: round(zoneWidth),
    entryZoneWidthPercent: round(100 * zoneWidth / input.plannedEntry),
    entryLocationWithinZone: entryPrice == null || zoneWidth === 0 ? null : round((entryPrice - zoneLow) / zoneWidth),
    distanceTraveledBeforeActivation: entryPrice == null || !finitePositive(originPrice) ? null : round(Math.abs(entryPrice - originPrice)),
    activationDelayMs: activation ? activation.timestamp - Date.parse(input.plannedAt) : null,
    archivedActivationDeltaMs: activation && isoTime(input.activationAt) ? activation.timestamp - Date.parse(input.activationAt) : null,
    trendLabel: diagnostics.trendLabel ?? null,
    regimeLabel: diagnostics.regimeLabel ?? null,
    structure: diagnostics.structure ?? null,
    freshness: diagnostics.freshness ?? null,
    instrument: input.instrument ?? null,
    resolvedCandleTimestamp: resolvedCandle?.timestamp ?? null
  };
}

export function replayV1Parity(input) {
  const validation = validateReplayInput(input);
  if (!validation.valid) {
    const result = { tradeId: input?.tradeId ?? null, symbol: input?.symbol ?? null, mode: REPLAY_MODE, ...validation };
    return { ...result, ...archivedParity(input || {}, result.replayResult) };
  }

  const candles = input.candles.map(candle => ({ ...candle })).sort((a, b) => a.timestamp - b.timestamp);
  const lifecycleAlignedEconomics = calculateLifecycleAlignedEconomics({
    direction: input.direction,
    plannedEntryReference: input.plannedEntry,
    activationEntryReference: null,
    initialStopLoss: input.initialStopLoss,
    takeProfit1: input.takeProfit1,
    entryZone: input.entryZone,
    currentHeadlineRR: input.headlineRiskReward,
    observedRemainderR: input.observedRemainderR,
    observedFinalGrossR: input.observedFinalGrossR
  });
  const planned = Date.parse(input.plannedAt);
  const expiry = Date.parse(input.expiresAt);
  const replayEnd = Date.parse(input.replayEndAt);
  const zoneLow = Math.min(input.entryZone.from, input.entryZone.to);
  const zoneHigh = Math.max(input.entryZone.from, input.entryZone.to);
  let expected = planned;
  let activation = null;
  let resolved = null;

  for (const candle of candles) {
    if (candle.timestamp < planned || candle.timestamp >= replayEnd) continue;
    if (candle.timestamp !== expected) {
      const result = {
        tradeId: input.tradeId, symbol: input.symbol, mode: REPLAY_MODE,
        replayResult: RESULT.UNRESOLVED, tp1ReachedBeforeSl: 'UNRESOLVED', reasonCodes: ['CANDLE_GAP'],
        gap: { expectedTimestamp: expected, actualTimestamp: candle.timestamp }, inputWasOutOfOrder: validation.inputWasOutOfOrder
      };
      return { ...result, ...archivedParity(input, result.replayResult) };
    }
    expected += MINUTE_MS;
    const touchesEntry = candle.low <= zoneHigh && candle.high >= zoneLow;
    if (!activation) {
      if (candle.timestamp + MINUTE_MS > expiry) break;
      if (!touchesEntry) continue;
      activation = { timestamp: candle.timestamp, entryPrice: clamp(candle.open, zoneLow, zoneHigh), candle: { ...candle } };
    }

    const stopHit = input.direction === 'Long' ? candle.low <= input.initialStopLoss : candle.high >= input.initialStopLoss;
    const tp1Hit = input.direction === 'Long' ? candle.high >= input.takeProfit1 : candle.low <= input.takeProfit1;
    if (!stopHit && !tp1Hit) continue;
    resolved = candle;
    let replayResult;
    if (stopHit && tp1Hit) replayResult = RESULT.AMBIGUOUS;
    else replayResult = stopHit ? RESULT.SL : RESULT.TP1;
    const label = replayResult === RESULT.TP1 ? 'YES' : replayResult === RESULT.SL ? 'NO' : 'AMBIGUOUS';
    const costs = calculateCostDiagnostics({ entryPrice: activation.entryPrice, entryZone: input.entryZone, initialStopLoss: input.initialStopLoss });
    const result = {
      tradeId: input.tradeId, symbol: input.symbol, mode: REPLAY_MODE, replayResult,
      tp1ReachedBeforeSl: label, reasonCodes: replayResult === RESULT.AMBIGUOUS ? ['SL_AND_TP1_TOUCHED_SAME_CANDLE'] : [],
      inputWasOutOfOrder: validation.inputWasOutOfOrder,
      activation: { timestamp: activation.timestamp, at: new Date(activation.timestamp).toISOString(), entryPrice: activation.entryPrice },
      resolution: { timestamp: candle.timestamp, at: new Date(candle.timestamp).toISOString() },
      evidence: evidence(input, activation, resolved, costs)
    };
    result.lifecycleAlignedEconomics = calculateLifecycleAlignedEconomics({
      direction: input.direction, plannedEntryReference: input.plannedEntry,
      activationEntryReference: activation.entryPrice, initialStopLoss: input.initialStopLoss,
      takeProfit1: input.takeProfit1, entryZone: input.entryZone,
      currentHeadlineRR: input.headlineRiskReward, observedRemainderR: input.observedRemainderR,
      observedFinalGrossR: input.observedFinalGrossR
    });
    return { ...result, ...archivedParity(input, replayResult) };
  }

  const requiredThrough = activation ? replayEnd : Math.min(expiry, replayEnd);
  if (expected < requiredThrough) {
    const result = {
      tradeId: input.tradeId, symbol: input.symbol, mode: REPLAY_MODE,
      replayResult: RESULT.UNRESOLVED, tp1ReachedBeforeSl: 'UNRESOLVED', reasonCodes: ['CANDLE_GAP'],
      gap: { expectedTimestamp: expected, actualTimestamp: null }, inputWasOutOfOrder: validation.inputWasOutOfOrder
    };
    return { ...result, ...archivedParity(input, result.replayResult) };
  }

  const reason = activation ? 'REPLAY_WINDOW_ENDED_BEFORE_TP1_OR_SL' : 'ENTRY_NOT_ACTIVATED_BEFORE_EXPIRY';
  const costs = calculateCostDiagnostics({ entryPrice: activation?.entryPrice ?? input.plannedEntry, entryZone: input.entryZone, initialStopLoss: input.initialStopLoss });
  const result = {
    tradeId: input.tradeId, symbol: input.symbol, mode: REPLAY_MODE,
    replayResult: RESULT.UNRESOLVED, tp1ReachedBeforeSl: 'UNRESOLVED', reasonCodes: [reason],
    inputWasOutOfOrder: validation.inputWasOutOfOrder,
    activation: activation ? { timestamp: activation.timestamp, at: new Date(activation.timestamp).toISOString(), entryPrice: activation.entryPrice } : null,
    evidence: evidence(input, activation, null, costs)
  };
  result.lifecycleAlignedEconomics = activation ? calculateLifecycleAlignedEconomics({
    direction: input.direction, plannedEntryReference: input.plannedEntry,
    activationEntryReference: activation.entryPrice, initialStopLoss: input.initialStopLoss,
    takeProfit1: input.takeProfit1, entryZone: input.entryZone,
    currentHeadlineRR: input.headlineRiskReward, observedRemainderR: input.observedRemainderR,
    observedFinalGrossR: input.observedFinalGrossR
  }) : lifecycleAlignedEconomics;
  return { ...result, ...archivedParity(input, result.replayResult) };
}

export function buildReplayArtifact(inputs, metadata = {}) {
  if (!Array.isArray(inputs)) throw new TypeError('inputs must be an array');
  const trades = inputs.map(replayV1Parity);
  const count = value => trades.filter(trade => trade.replayResult === value).length;
  return {
    version: REPLAY_VERSION,
    sourceCohortIdentifier: metadata.sourceCohortIdentifier ?? 'post-cutoff-confirmatory-v1:2026-11-01T22:00:00.000Z',
    replayMode: REPLAY_MODE,
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    inputSchema: REPLAY_INPUT_SCHEMA,
    availability: metadata.availability ?? null,
    sourceProvenance: metadata.sourceProvenance ?? null,
    aggregate: {
      tradesReplayed: trades.length,
      parityMatch: trades.filter(trade => trade.parity === 'MATCH').length,
      parityMismatch: trades.filter(trade => trade.parity === 'MISMATCH').length,
      parityNotAvailable: trades.filter(trade => trade.parity === 'NOT_AVAILABLE').length,
      ambiguous: count(RESULT.AMBIGUOUS), unresolved: count(RESULT.UNRESOLVED), invalid: count(RESULT.INVALID)
    },
    d01Comparison: summarizeD01(trades),
    trades,
    strategyRecommendation: null
  };
}

async function runCli(argv) {
  const args = Object.fromEntries(argv.map(arg => arg.startsWith('--') ? arg.slice(2).split(/=(.*)/s, 2) : []).filter(pair => pair.length === 2));
  if (!args.input || !args.output) throw new Error('Usage: replay.mjs --input=FILE --output=FILE [--generated-at=ISO]');
  const source = JSON.parse(await fs.readFile(path.resolve(args.input), 'utf8'));
  const inputs = Array.isArray(source) ? source : source.inputs;
  const artifact = buildReplayArtifact(inputs, {
    sourceCohortIdentifier: source.sourceCohortIdentifier,
    generatedAt: args['generated-at']
  });
  await fs.mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
  await fs.writeFile(path.resolve(args.output), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(artifact.aggregate)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
