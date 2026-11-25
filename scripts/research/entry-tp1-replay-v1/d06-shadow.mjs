import { calculateLifecycleAlignedEconomics } from './d01.mjs';
import { evaluateD04Shadow } from './d04-shadow.mjs';

export const D06_CONTRACT_VERSION = 'd06-true-range-atr-shadow-v1';
export const ATR_PERIOD = 14;
const DAY_MS = 86_400_000;
const finitePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const round = value => Number.isFinite(value) ? Number(value.toPrecision(15)) : null;
const precision6 = value => Number.isFinite(value) ? Number(value.toPrecision(6)) : null;

function validOhlc(candle) {
  const values = [candle?.open, candle?.high, candle?.low, candle?.close];
  return values.every(finitePositive) && candle.low <= candle.open && candle.open <= candle.high &&
    candle.low <= candle.close && candle.close <= candle.high;
}

function addReason(reasons, condition, code) {
  if (condition && !reasons.includes(code)) reasons.push(code);
}

export function volatilityLabel(atr, price) {
  if (!finitePositive(atr) || !finitePositive(price)) return { atrPercent: null, label: 'Unknown' };
  const atrPercent = atr / price * 100;
  const label = atrPercent < 1 ? 'Very Low' : atrPercent < 2 ? 'Low' : atrPercent <= 5 ? 'Normal'
    : atrPercent <= 8 ? 'High' : 'Extreme';
  return { atrPercent: round(atrPercent), label };
}

export function evaluateD06Atr({ candles, evaluatedAt, price }) {
  const reasons = [];
  const evaluatedAtMs = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluatedAtMs)) throw new TypeError('evaluatedAt must be a valid timestamp');
  const values = Array.isArray(candles) ? candles : [];
  addReason(reasons, values.length < ATR_PERIOD + 1, 'INSUFFICIENT_CANDLES');
  addReason(reasons, !finitePositive(price), 'INVALID_REFERENCE_PRICE');
  addReason(reasons, values.some(candle => candle?.confirmed !== true), 'UNCONFIRMED_CANDLE');
  addReason(reasons, values.some(candle => !validOhlc(candle)), 'INVALID_OHLC');
  const times = values.map(candle => Date.parse(candle?.timestamp));
  const validTimes = times.every(Number.isFinite);
  addReason(reasons, !validTimes, 'INVALID_CANDLE_TIMESTAMP');
  addReason(reasons, validTimes && new Set(times).size !== times.length, 'DUPLICATE_CANDLE_TIMESTAMP');
  const outOfOrder = validTimes && times.some((value, index) => index > 0 && value < times[index - 1]);
  addReason(reasons, outOfOrder, 'OUT_OF_ORDER_CANDLES');
  const duplicate = validTimes && new Set(times).size !== times.length;
  addReason(reasons, validTimes && !outOfOrder && !duplicate && times.some((value, index) =>
    index > 0 && value - times[index - 1] !== DAY_MS), 'CANDLE_GAP');
  addReason(reasons, validTimes && times.some(value => value > evaluatedAtMs), 'CANDLE_TIMESTAMP_FUTURE');
  if (reasons.length) return {
    contractVersion: D06_CONTRACT_VERSION, status: 'UNAVAILABLE', reasonCodes: reasons,
    countTrObservations: 0, atrV1: null, atrV2TrueRange: null, comparison: null, gapAttribution: null,
    volatility: null
  };

  const window = values.slice(-(ATR_PERIOD + 1));
  const observations = [];
  for (let index = 1; index < window.length; index += 1) {
    const previousClose = window[index - 1]?.close;
    if (!finitePositive(previousClose)) return {
      contractVersion: D06_CONTRACT_VERSION, status: 'UNAVAILABLE', reasonCodes: ['PREVIOUS_CLOSE_MISSING'],
      countTrObservations: 0, atrV1: null, atrV2TrueRange: null, comparison: null, gapAttribution: null,
      volatility: null
    };
    const candle = window[index];
    const highLow = candle.high - candle.low;
    const highPreviousClose = Math.abs(candle.high - previousClose);
    const lowPreviousClose = Math.abs(candle.low - previousClose);
    const trueRange = Math.max(highLow, highPreviousClose, lowPreviousClose);
    const gapDirection = previousClose < candle.low ? 'UP' : previousClose > candle.high ? 'DOWN' : null;
    const gapComponent = gapDirection === 'UP' ? candle.low - previousClose
      : gapDirection === 'DOWN' ? previousClose - candle.high : 0;
    observations.push({
      timestamp: new Date(Date.parse(candle.timestamp)).toISOString(), previousClose,
      highLow: round(highLow), highPreviousClose: round(highPreviousClose),
      lowPreviousClose: round(lowPreviousClose), trueRange: round(trueRange),
      gapAffected: gapDirection !== null && trueRange > highLow,
      gapDirection, gapComponent: round(gapComponent)
    });
  }
  const mean = field => observations.reduce((sum, item) => sum + item[field], 0) / ATR_PERIOD;
  // Match the existing v1 six-significant-digit output so the isolated variable is the TR formula.
  const atrV1 = precision6(mean('highLow')); const atrV2 = precision6(mean('trueRange'));
  const absoluteDelta = round(Math.abs(atrV2 - atrV1));
  const percentDelta = round(absoluteDelta / atrV1 * 100);
  const v1Volatility = volatilityLabel(atrV1, price); const v2Volatility = volatilityLabel(atrV2, price);
  const gapAffected = observations.filter(item => item.gapAffected);
  return {
    contractVersion: D06_CONTRACT_VERSION,
    status: 'AVAILABLE',
    reasonCodes: [],
    countTrObservations: observations.length,
    atrV1,
    atrV2TrueRange: atrV2,
    comparison: {
      absoluteDelta, percentDelta, atrV2Greater: atrV2 > atrV1, atrEqual: atrV2 === atrV1
    },
    gapAttribution: {
      countGapAffectedTr: gapAffected.length,
      maxSingleTrGapComponent: gapAffected.length ? Math.max(...gapAffected.map(item => item.gapComponent)) : 0,
      gapUpCount: gapAffected.filter(item => item.gapDirection === 'UP').length,
      gapDownCount: gapAffected.filter(item => item.gapDirection === 'DOWN').length,
      observations
    },
    volatility: {
      v1AtrPercent: v1Volatility.atrPercent,
      v2AtrPercent: v2Volatility.atrPercent,
      v1VolatilityLabel: v1Volatility.label,
      v2D06VolatilityLabel: v2Volatility.label,
      volatilityLabelChanged: v1Volatility.label !== v2Volatility.label
    }
  };
}

export function rawPlanGeometry(direction, referencePrice, atr) {
  if (!['Long', 'Short'].includes(direction) || !finitePositive(referencePrice) || !finitePositive(atr)) return null;
  if (direction === 'Long') {
    const entryZoneLow = referencePrice - atr * 0.25;
    const entryZoneHigh = referencePrice + atr * 0.1;
    return {
      plannedEntry: (entryZoneLow + entryZoneHigh) / 2,
      entryZoneLow,
      entryZoneHigh,
      stop: referencePrice - atr,
      tp1: referencePrice + atr,
      tp2: referencePrice + atr * 2,
      tp3: referencePrice + atr * 3
    };
  }
  const entryZoneLow = referencePrice - atr * 0.1;
  const entryZoneHigh = referencePrice + atr * 0.25;
  return {
    plannedEntry: (entryZoneLow + entryZoneHigh) / 2,
    entryZoneLow,
    entryZoneHigh,
    stop: referencePrice + atr,
    tp1: referencePrice - atr,
    tp2: referencePrice - atr * 2,
    tp3: referencePrice - atr * 3
  };
}

function d01(direction, geometry) {
  return calculateLifecycleAlignedEconomics({
    direction,
    plannedEntryReference: geometry.plannedEntry,
    initialStopLoss: geometry.stop,
    takeProfit1: geometry.tp1,
    entryZone: { from: geometry.entryZoneLow, to: geometry.entryZoneHigh }
  });
}

function geometryMetrics(direction, geometry) {
  const sign = direction === 'Long' ? 1 : -1;
  const riskDistance = Math.abs(geometry.plannedEntry - geometry.stop);
  const tp1Distance = sign * (geometry.tp1 - geometry.plannedEntry);
  return { riskDistance: round(riskDistance), tp1Distance: round(tp1Distance),
    tp1RewardRisk: round(tp1Distance / riskDistance) };
}

export function evaluateD06Geometry({ direction, symbol, instrumentType = 'SWAP', referencePrice, atrV2,
  tickContract, v1Geometry }) {
  const raw = rawPlanGeometry(direction, referencePrice, atrV2);
  if (!raw || !v1Geometry) return { status: 'UNAVAILABLE', reasonCodes: ['GEOMETRY_INPUT_UNAVAILABLE'] };
  const tickShadow = evaluateD04Shadow({ direction, geometry: { symbol, instrumentType, ...raw }, tickContract });
  if (tickShadow.status !== 'VALID') return {
    status: 'UNAVAILABLE', reasonCodes: ['D04_TICK_GEOMETRY_UNAVAILABLE', ...tickShadow.reasonCodes], rawD06Geometry: raw,
    d04TickShadow: tickShadow
  };
  const v2 = tickShadow.v2D04TickGeometry;
  const fields = ['plannedEntry', 'entryZoneLow', 'entryZoneHigh', 'stop', 'tp1', 'tp2', 'tp3'];
  const deltas = Object.fromEntries(fields.map(field => [field, round(v2[field] - v1Geometry[field])]));
  const currentD01 = d01(direction, v1Geometry); const shadowD01 = d01(direction, v2);
  const d01Deltas = currentD01.valid && shadowD01.valid ? {
    tp1WeightedR: round(shadowD01.tp1WeightedR - currentD01.tp1WeightedR),
    modeledCostRAtEntry: round(shadowD01.modeledCostRAtEntry - currentD01.modeledCostRAtEntry),
    tp1WeightedRAfterCost: round(shadowD01.tp1WeightedRAfterCost - currentD01.tp1WeightedRAfterCost)
  } : null;
  return {
    status: 'AVAILABLE', reasonCodes: [], rawD06Geometry: raw, d04TickShadow: tickShadow,
    v1Geometry, v2D06Geometry: v2,
    comparison: {
      geometryChanged: Object.values(deltas).some(value => value !== 0), deltas,
      v1Metrics: geometryMetrics(direction, v1Geometry), v2Metrics: geometryMetrics(direction, v2)
    },
    d01: { current: currentD01, shadow: shadowD01, deltas: d01Deltas }
  };
}

export function summarizeD06(records) {
  const full = records.filter(record => record.evaluability === 'FULLY_EVALUABLE');
  const atr = full.map(record => record.atr).filter(item => item?.status === 'AVAILABLE');
  const geometry = full.map(record => record.geometry).filter(item => item?.status === 'AVAILABLE');
  const d01Deltas = geometry.map(item => item.d01?.deltas).filter(Boolean);
  const mean = values => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const meanAbs = field => mean(d01Deltas.map(item => Math.abs(item[field])));
  return {
    contractVersion: D06_CONTRACT_VERSION,
    countAnalyzed: records.length,
    fullyEvaluable: full.length,
    partiallyEvaluable: records.filter(record => record.evaluability === 'PARTIALLY_EVALUABLE').length,
    notEvaluable: records.filter(record => record.evaluability === 'NOT_EVALUABLE').length,
    atrChanged: atr.filter(item => !item.comparison.atrEqual).length,
    atrUnchanged: atr.filter(item => item.comparison.atrEqual).length,
    meanAtrPercentDelta: mean(atr.map(item => item.comparison.percentDelta)),
    maxAtrPercentDelta: atr.length ? Math.max(...atr.map(item => item.comparison.percentDelta)) : null,
    gapAffectedTrTotal: atr.reduce((sum, item) => sum + item.gapAttribution.countGapAffectedTr, 0),
    volatilityChangedCount: atr.filter(item => item.volatility.volatilityLabelChanged).length,
    volatilityUnchangedCount: atr.filter(item => !item.volatility.volatilityLabelChanged).length,
    geometryChanged: geometry.filter(item => item.comparison.geometryChanged).length,
    geometryUnchanged: geometry.filter(item => !item.comparison.geometryChanged).length,
    d01MetricComparableCount: d01Deltas.length,
    meanAbsTp1WeightedRDelta: meanAbs('tp1WeightedR'),
    meanAbsCostRDelta: meanAbs('modeledCostRAtEntry'),
    meanAbsTp1WeightedRAfterCostDelta: meanAbs('tp1WeightedRAfterCost'),
    strategyRecommendation: null
  };
}
