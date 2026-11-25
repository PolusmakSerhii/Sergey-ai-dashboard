import { calculateLifecycleAlignedEconomics } from './d01.mjs';

export const D04_CONTRACT_VERSION = 'd04-tick-size-price-precision-shadow-v1';
export const OKX_TICK_SOURCE = 'OKX public instruments';

const finitePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const round = value => Number.isFinite(value) ? Number(value.toPrecision(15)) : null;

function decimalParts(value) {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string') return null;
  const match = text.trim().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;
  const negative = match[1] === '-';
  const fraction = match[3] || '';
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent)) return null;
  let coefficient = BigInt(`${match[2]}${fraction}` || '0');
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  if (negative) coefficient = -coefficient;
  return { coefficient, scale };
}

function rescale(parts, scale) {
  return parts.coefficient * 10n ** BigInt(scale - parts.scale);
}

function formatDecimal(coefficient, scale) {
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  if (scale) digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  digits = scale ? digits.replace(/\.?0+$/, '') : digits;
  return `${negative ? '-' : ''}${digits || '0'}`;
}

function compareDecimal(left, right) {
  const a = decimalParts(left); const b = decimalParts(right);
  if (!a || !b) throw new TypeError('Invalid decimal comparison');
  const scale = Math.max(a.scale, b.scale);
  const aa = rescale(a, scale); const bb = rescale(b, scale);
  return aa < bb ? -1 : aa > bb ? 1 : 0;
}

export function quantizeToTick(value, tickSize, mode = 'nearest') {
  const valueParts = decimalParts(value); const tickParts = decimalParts(tickSize);
  if (!valueParts || !tickParts || tickParts.coefficient <= 0n || valueParts.coefficient < 0n) return null;
  const scale = Math.max(valueParts.scale, tickParts.scale);
  const amount = rescale(valueParts, scale); const tick = rescale(tickParts, scale);
  const quotient = amount / tick; const remainder = amount % tick;
  let units = quotient;
  if (mode === 'ceil' && remainder !== 0n) units += 1n;
  else if (mode === 'nearest' && remainder * 2n >= tick) units += 1n;
  else if (!['floor', 'ceil', 'nearest'].includes(mode)) throw new TypeError(`Unknown quantization mode: ${mode}`);
  return formatDecimal(units * tick, scale);
}

function validTickContract(contract, geometry) {
  const expectedInstId = typeof geometry?.symbol === 'string' && geometry.symbol.endsWith('USDT')
    ? `${geometry.symbol.slice(0, -4)}-USDT-SWAP` : null;
  return contract?.tickSource === OKX_TICK_SOURCE && contract?.instrumentType === 'SWAP' &&
    geometry?.instrumentType === 'SWAP' && contract?.symbol === geometry?.symbol && contract?.instId === expectedInstId &&
    typeof contract?.tickSize === 'string' && decimalParts(contract.tickSize)?.coefficient > 0n &&
    typeof contract?.instrumentRecordObservedAt === 'string' && Number.isFinite(Date.parse(contract.instrumentRecordObservedAt));
}

function numericGeometry(geometry) {
  return Object.fromEntries(Object.entries(geometry).map(([key, value]) => [key, value == null ? null : Number(value)]));
}

function currentMetrics(direction, geometry) {
  const sign = direction === 'Long' ? 1 : direction === 'Short' ? -1 : null;
  if (!sign) return null;
  const entry = Number(geometry.plannedEntry); const stop = Number(geometry.stop); const tp1 = Number(geometry.tp1);
  if (![entry, stop, tp1].every(finitePositive)) return null;
  const riskDistance = Math.abs(entry - stop); const tp1Distance = sign * (tp1 - entry);
  if (!(riskDistance > 0) || !(tp1Distance > 0)) return null;
  const d01 = calculateLifecycleAlignedEconomics({ direction, plannedEntryReference: entry,
    initialStopLoss: stop, takeProfit1: tp1,
    entryZone: { from: Number(geometry.entryZoneLow), to: Number(geometry.entryZoneHigh) } });
  if (!d01.valid) return null;
  return {
    riskDistance: round(riskDistance), tp1Distance: round(tp1Distance), tp1R: round(tp1Distance / riskDistance),
    tp1WeightedR: d01.tp1WeightedR, modeledCostRAtEntry: d01.modeledCostRAtEntry,
    tp1WeightedRAfterCost: d01.tp1WeightedRAfterCost
  };
}

function invalidReasonCodes(direction, geometry) {
  const codes = [];
  const { entryZoneLow: low, entryZoneHigh: high, plannedEntry: entry, stop } = geometry;
  const targets = [geometry.tp1, geometry.tp2, geometry.tp3].filter(value => value != null);
  if (compareDecimal(low, high) >= 0) codes.push('ENTRY_ZONE_COLLAPSED');
  if (compareDecimal(entry, low) < 0 || compareDecimal(entry, high) > 0) codes.push('PLANNED_ENTRY_OUTSIDE_ZONE');
  if (direction === 'Long') {
    if (compareDecimal(stop, low) >= 0 || targets.some(target => compareDecimal(target, high) <= 0)) codes.push('INVALID_LONG_GEOMETRY');
  } else if (direction === 'Short') {
    if (compareDecimal(stop, high) <= 0 || targets.some(target => compareDecimal(target, low) >= 0)) codes.push('INVALID_SHORT_GEOMETRY');
  } else codes.push('INVALID_DIRECTION');
  return codes;
}

export function evaluateD04Shadow({ direction, geometry, tickContract }) {
  const v1CurrentGeometry = geometry ? structuredClone(geometry) : null;
  if (!geometry || !validTickContract(tickContract, geometry)) return {
    contractVersion: D04_CONTRACT_VERSION,
    status: 'UNAVAILABLE', reasonCodes: ['AUTHORITATIVE_TICK_METADATA_UNAVAILABLE'],
    tickContract: tickContract ?? null, v1CurrentGeometry, v2D04TickGeometry: null, comparison: null
  };
  const required = ['plannedEntry', 'entryZoneLow', 'entryZoneHigh', 'stop', 'tp1'];
  const optionalInvalid = ['tp2', 'tp3'].some(key => geometry[key] != null && !finitePositive(geometry[key]));
  if (required.some(key => !finitePositive(geometry[key])) || optionalInvalid) return {
    contractVersion: D04_CONTRACT_VERSION,
    status: 'UNAVAILABLE', reasonCodes: ['INVALID_CURRENT_GEOMETRY'],
    tickContract, v1CurrentGeometry, v2D04TickGeometry: null, comparison: null
  };
  const tick = tickContract.tickSize;
  const quantized = {
    entryZoneLow: quantizeToTick(geometry.entryZoneLow, tick, 'ceil'),
    entryZoneHigh: quantizeToTick(geometry.entryZoneHigh, tick, 'floor'),
    stop: quantizeToTick(geometry.stop, tick, direction === 'Long' ? 'floor' : 'ceil'),
    tp1: quantizeToTick(geometry.tp1, tick, direction === 'Long' ? 'floor' : 'ceil'),
    tp2: geometry.tp2 == null ? null : quantizeToTick(geometry.tp2, tick, direction === 'Long' ? 'floor' : 'ceil'),
    tp3: geometry.tp3 == null ? null : quantizeToTick(geometry.tp3, tick, direction === 'Long' ? 'floor' : 'ceil')
  };
  let plannedEntry = quantizeToTick(geometry.plannedEntry, tick, 'nearest');
  if (compareDecimal(plannedEntry, quantized.entryZoneLow) < 0) plannedEntry = quantized.entryZoneLow;
  if (compareDecimal(plannedEntry, quantized.entryZoneHigh) > 0) plannedEntry = quantized.entryZoneHigh;
  const decimalGeometry = { symbol: geometry.symbol, plannedEntry, ...quantized };
  const reasons = invalidReasonCodes(direction, decimalGeometry);
  const v2 = { ...numericGeometry(decimalGeometry), symbol: geometry.symbol, exactDecimal: decimalGeometry };
  const fields = ['plannedEntry', 'entryZoneLow', 'entryZoneHigh', 'stop', 'tp1', 'tp2', 'tp3'];
  const deltas = Object.fromEntries(fields.map(field => [field,
    geometry[field] == null || v2[field] == null ? null : round(v2[field] - geometry[field])]));
  const current = currentMetrics(direction, geometry);
  const shadow = reasons.length ? null : currentMetrics(direction, v2);
  const metricDeltas = current && shadow ? Object.fromEntries(Object.keys(current).map(key => [key, round(shadow[key] - current[key])])) : null;
  return {
    contractVersion: D04_CONTRACT_VERSION,
    status: reasons.length ? 'INVALID_AFTER_QUANTIZATION' : 'VALID',
    reasonCodes: reasons,
    tickContract,
    v1CurrentGeometry,
    v2D04TickGeometry: v2,
    comparison: {
      geometryChanged: Object.values(deltas).some(value => value !== null && value !== 0),
      deltas,
      currentMetrics: current,
      shadowMetrics: shadow,
      metricDeltas
    }
  };
}

export function buildAnalyticalRoundingFixtures() {
  const definitions = [
    ['price-over-10000', '65000.12', '65000.15', '0.01'],
    ['price-around-100', '100.001', '100.004', '0.001'],
    ['price-around-1', '1.001', '1.004', '0.001'],
    ['sub-1', '0.1231', '0.1234', '0.0001'],
    ['sub-0.01', '0.0041', '0.0044', '0.0001'],
    ['very-cheap-token', '0.0000123', '0.0000127', '0.0000001']
  ];
  return definitions.map(([name, rawValue, distinctRawLevel, tickSize]) => {
    const fixedA = Number(rawValue).toFixed(2); const fixedB = Number(distinctRawLevel).toFixed(2);
    const tickA = quantizeToTick(rawValue, tickSize, 'nearest');
    const tickB = quantizeToTick(distinctRawLevel, tickSize, 'nearest');
    const rawDistance = Number(distinctRawLevel) - Number(rawValue);
    const threshold = 2 * Number(tickSize);
    const rawProximity = rawDistance <= threshold ? 'NEAR' : 'FAR';
    const fixedProximity = Math.abs(Number(fixedB) - Number(fixedA)) <= threshold ? 'NEAR' : 'FAR';
    return {
      name, rawValue, distinctRawLevel, tickSize,
      toFixed2Value: fixedA, toFixed2DistinctLevel: fixedB,
      tickAwareExecutableValue: tickA, tickAwareDistinctLevel: tickB,
      rawValuesPreserved: true,
      zeroCollapse: Number(fixedA) === 0 || Number(fixedB) === 0,
      mergesDistinctLevels: compareDecimal(rawValue, distinctRawLevel) !== 0 && fixedA === fixedB,
      changesOrdering: compareDecimal(rawValue, distinctRawLevel) < 0 && Number(fixedA) >= Number(fixedB),
      rawProximity, toFixed2Proximity: fixedProximity,
      changesProximityClassification: rawProximity !== fixedProximity,
      rawStructuralPredicateHigherHigh: compareDecimal(distinctRawLevel, rawValue) > 0,
      toFixed2StructuralPredicateHigherHigh: Number(fixedB) > Number(fixedA),
      changesStructuralPredicate: compareDecimal(distinctRawLevel, rawValue) > 0 && !(Number(fixedB) > Number(fixedA))
    };
  });
}

export function summarizeD04(records, fixtures = buildAnalyticalRoundingFixtures()) {
  const full = records.filter(record => record.evaluability === 'FULLY_EVALUABLE');
  const comparisons = full.map(record => record.shadow).filter(Boolean);
  const validMetricDeltas = comparisons.map(item => item.comparison?.metricDeltas).filter(Boolean);
  const meanAbs = field => validMetricDeltas.length
    ? round(validMetricDeltas.reduce((sum, item) => sum + Math.abs(item[field]), 0) / validMetricDeltas.length) : null;
  return {
    contractVersion: D04_CONTRACT_VERSION,
    countAnalyzed: records.length,
    fullyEvaluable: full.length,
    partiallyEvaluable: records.filter(record => record.evaluability === 'PARTIALLY_EVALUABLE').length,
    notEvaluable: records.filter(record => record.evaluability === 'NOT_EVALUABLE').length,
    tickMetadataAvailable: records.filter(record => record.tickMetadataAvailable).length,
    tickMetadataMissing: records.filter(record => !record.tickMetadataAvailable).length,
    geometryChanged: comparisons.filter(item => item.comparison?.geometryChanged).length,
    geometryUnchanged: comparisons.filter(item => !item.comparison?.geometryChanged).length,
    invalidAfterQuantization: comparisons.filter(item => item.status === 'INVALID_AFTER_QUANTIZATION').length,
    invalidAfterQuantizationReasons: comparisons.flatMap(item => item.reasonCodes).reduce((counts, code) =>
      ({ ...counts, [code]: (counts[code] || 0) + 1 }), {}),
    toFixed2ZeroCollapseProven: fixtures.some(item => item.zeroCollapse),
    toFixed2LevelMergeProven: fixtures.some(item => item.mergesDistinctLevels),
    d01MetricComparableCount: validMetricDeltas.length,
    meanAbsTp1WeightedRDelta: meanAbs('tp1WeightedR'),
    meanAbsCostRDelta: meanAbs('modeledCostRAtEntry'),
    meanAbsTp1WeightedRAfterCostDelta: meanAbs('tp1WeightedRAfterCost'),
    strategyRecommendation: null
  };
}
