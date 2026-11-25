export const D05_CONTRACT_VERSION = 'd05-mandatory-birth-safety-shadow-v1';

export const BIRTH_SAFETY_STATUS = Object.freeze({ READY: 'READY', BLOCKED: 'BLOCKED' });
export const EVALUABILITY = Object.freeze({
  FULLY_EVALUABLE: 'FULLY_EVALUABLE',
  PARTIALLY_EVALUABLE: 'PARTIALLY_EVALUABLE',
  NOT_EVALUABLE: 'NOT_EVALUABLE'
});

export const D05_LIMITS = Object.freeze({
  maximumPriceAgeMs: 60_000,
  minimumConfirmedDailyCandles: 200,
  dailyCandleIntervalMs: 86_400_000,
  maximumLatestConfirmedCandleAgeMs: 86_400_000 + 300_000
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isoOrNull = value => timestamp(value) ? new Date(value).toISOString() : null;

function sourceStatus(entries, emptyIsUnavailable = false) {
  const normalized = Array.isArray(entries) ? entries.map(entry => ({
    name: nonempty(entry?.name) ? entry.name : null,
    available: entry?.available === true,
    observedAt: isoOrNull(entry?.observedAt)
  })) : [];
  return {
    status: (!emptyIsUnavailable || normalized.length > 0) && normalized.every(entry => entry.name && entry.available)
      ? 'AVAILABLE' : 'UNAVAILABLE',
    sources: normalized
  };
}

function validOhlc(candle) {
  const values = [candle?.open, candle?.high, candle?.low, candle?.close];
  return values.every(value => finite(value) && value > 0) &&
    candle.low <= candle.open && candle.open <= candle.high &&
    candle.low <= candle.close && candle.close <= candle.high;
}

function reasonCollector() {
  const values = [];
  return {
    add(condition, code) { if (condition && !values.includes(code)) values.push(code); },
    values
  };
}

export function evaluateD05BirthSafety(input) {
  const reasons = reasonCollector();
  const evaluatedAtMs = Date.parse(input?.evaluatedAt);
  if (!Number.isFinite(evaluatedAtMs)) throw new TypeError('evaluatedAt must be a valid timestamp');

  const identity = input?.instrumentIdentity || {};
  reasons.add(!nonempty(identity.expectedSymbol) || identity.observedSymbol !== identity.expectedSymbol, 'INVALID_SYMBOL_IDENTITY');
  reasons.add(!nonempty(identity.expectedInstId) || identity.observedInstId !== identity.expectedInstId, 'INST_ID_MISMATCH');
  reasons.add(!nonempty(identity.expectedInstrumentType) || identity.observedInstrumentType !== identity.expectedInstrumentType,
    'INSTRUMENT_TYPE_MISMATCH');

  const record = identity.authoritativeRecord;
  const recordAvailable = record?.available === true;
  if (recordAvailable) {
    reasons.add(record.symbol !== identity.expectedSymbol, 'INVALID_SYMBOL_IDENTITY');
    reasons.add(record.instId !== identity.expectedInstId, 'INST_ID_MISMATCH');
    reasons.add(record.instrumentType !== identity.expectedInstrumentType, 'INSTRUMENT_TYPE_MISMATCH');
  } else if (identity.authoritativeRecordRequired === true) {
    reasons.add(true, 'INSTRUMENT_RECORD_UNAVAILABLE');
  }

  const requiredSourcesStatus = sourceStatus(input?.sources?.required, true);
  const optionalSourcesStatus = sourceStatus(input?.sources?.optional);
  reasons.add(requiredSourcesStatus.status !== 'AVAILABLE', 'REQUIRED_SOURCE_UNAVAILABLE');

  const ticker = input?.ticker || {};
  reasons.add(!finite(ticker.price) || ticker.price <= 0, 'INVALID_PRICE');
  const priceObservedAtMs = Date.parse(ticker.observedAt);
  reasons.add(!Number.isFinite(priceObservedAtMs), 'PRICE_TIMESTAMP_MISSING');
  const priceAgeMs = Number.isFinite(priceObservedAtMs) ? evaluatedAtMs - priceObservedAtMs : null;
  reasons.add(priceAgeMs != null && priceAgeMs < 0, 'PRICE_TIMESTAMP_FUTURE');
  reasons.add(priceAgeMs != null && priceAgeMs > D05_LIMITS.maximumPriceAgeMs, 'PRICE_STALE');

  const candles = Array.isArray(input?.dailyCandles) ? input.dailyCandles : [];
  reasons.add(candles.length < D05_LIMITS.minimumConfirmedDailyCandles, 'INSUFFICIENT_CANDLES');
  reasons.add(candles.some(candle => candle?.confirmed !== true), 'UNCONFIRMED_CANDLE');
  reasons.add(candles.some(candle => !validOhlc(candle)), 'INVALID_OHLC');

  const candleTimes = candles.map(candle => Date.parse(candle?.timestamp));
  const validCandleTimes = candleTimes.every(Number.isFinite);
  reasons.add(!validCandleTimes, 'CANDLE_TIMESTAMP_INVALID');
  const duplicate = validCandleTimes && new Set(candleTimes).size !== candleTimes.length;
  reasons.add(duplicate, 'DUPLICATE_CANDLE_TIMESTAMP');
  const outOfOrder = validCandleTimes && candleTimes.some((value, index) => index > 0 && value < candleTimes[index - 1]);
  reasons.add(outOfOrder, 'OUT_OF_ORDER_CANDLES');
  const gap = validCandleTimes && !outOfOrder && !duplicate && candleTimes.some((value, index) =>
    index > 0 && value - candleTimes[index - 1] !== D05_LIMITS.dailyCandleIntervalMs);
  reasons.add(gap, 'CANDLE_GAP');
  reasons.add(validCandleTimes && candleTimes.some(value => value > evaluatedAtMs), 'CANDLE_TIMESTAMP_FUTURE');

  const confirmedCandleTimes = validCandleTimes
    ? candleTimes.filter((value, index) => candles[index]?.confirmed === true) : [];
  const latestCandleMs = confirmedCandleTimes.length ? Math.max(...confirmedCandleTimes) : null;
  const lastConfirmedCandleAgeMs = latestCandleMs == null ? null : evaluatedAtMs - latestCandleMs;
  reasons.add(lastConfirmedCandleAgeMs != null && lastConfirmedCandleAgeMs > D05_LIMITS.maximumLatestConfirmedCandleAgeMs,
    'LATEST_CANDLE_STALE');

  const instrumentIdentityStatus = reasons.values.some(code => [
    'INVALID_SYMBOL_IDENTITY', 'INST_ID_MISMATCH', 'INSTRUMENT_TYPE_MISMATCH', 'INSTRUMENT_RECORD_UNAVAILABLE'
  ].includes(code)) ? 'MISMATCH' : 'MATCH';
  const candleContinuityStatus = reasons.values.some(code => [
    'INSUFFICIENT_CANDLES', 'UNCONFIRMED_CANDLE', 'DUPLICATE_CANDLE_TIMESTAMP', 'OUT_OF_ORDER_CANDLES',
    'CANDLE_GAP', 'INVALID_OHLC', 'CANDLE_TIMESTAMP_INVALID', 'CANDLE_TIMESTAMP_FUTURE', 'LATEST_CANDLE_STALE'
  ].includes(code)) ? 'INVALID' : 'VALID';

  return {
    status: reasons.values.length ? BIRTH_SAFETY_STATUS.BLOCKED : BIRTH_SAFETY_STATUS.READY,
    reasonCodes: reasons.values,
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
    priceObservedAt: isoOrNull(ticker.observedAt),
    priceAgeMs,
    lastConfirmedCandleAt: latestCandleMs == null ? null : new Date(latestCandleMs).toISOString(),
    lastConfirmedCandleAgeMs,
    candleCount: candles.length,
    candleContinuityStatus,
    instrumentIdentityStatus,
    requiredSourcesStatus,
    optionalSourcesStatus,
    contractVersion: D05_CONTRACT_VERSION
  };
}

const historicalChecks = Object.freeze([
  ['symbolIdentity', record => nonempty(record?.origin?.symbol) && record.origin.symbol === record?.researchSnapshot?.instrument?.symbol],
  ['instIdMatch', () => false],
  ['instrumentTypeMatch', () => false],
  ['authoritativeInstrumentRecordMatch', () => false],
  ['positiveFiniteTickerPrice', record => finite(record?.researchSnapshot?.originPrice) && record.researchSnapshot.originPrice > 0],
  ['validTickerProviderTimestamp', record => timestamp(record?.researchSnapshot?.provenance?.priceTimestamp)],
  ['tickerAgeWithin60Seconds', record => timestamp(record?.researchSnapshot?.analysisAt) && timestamp(record?.researchSnapshot?.provenance?.priceTimestamp)],
  ['atLeast200ConfirmedDailyCandles', record => Number.isInteger(record?.researchSnapshot?.provenance?.confirmedCount)],
  ['confirmedCandlesOnly', record => record?.researchSnapshot?.provenance?.confirmedOnly === true],
  ['sortedCandles', () => false],
  ['uniqueCandleTimestamps', () => false],
  ['contiguousDailySequence', () => false],
  ['positiveFiniteOhlc', () => false],
  ['validOhlcEnvelope', () => false],
  ['noFutureCandleTimestamps', () => false],
  ['latestConfirmedCandleAge', record => timestamp(record?.researchSnapshot?.analysisAt) && timestamp(record?.researchSnapshot?.provenance?.dailyLastConfirmedAt)],
  ['requiredSourcesAvailable', record => nonempty(record?.researchSnapshot?.provenance?.priceSource) &&
    nonempty(record?.researchSnapshot?.provenance?.dailySource)]
]);

export function evaluateHistoricalD05Record(record) {
  const evidenceAvailability = Object.fromEntries(historicalChecks.map(([name, check]) => [name, check(record) ? 'SAVED' : 'NOT_SAVED']));
  const savedCount = Object.values(evidenceAvailability).filter(value => value === 'SAVED').length;
  const missingEvidence = Object.entries(evidenceAvailability).filter(([, value]) => value === 'NOT_SAVED').map(([name]) => name);
  const fullyEvaluable = missingEvidence.length === 0;
  return {
    tradeId: record?.tradeId ?? null,
    v1CurrentBirthResult: record?.initialPlan && record?.origin?.confirmedAPlus === true ? 'BORN' : 'NOT_BORN',
    evaluability: fullyEvaluable ? EVALUABILITY.FULLY_EVALUABLE : EVALUABILITY.NOT_EVALUABLE,
    evidenceAvailability,
    savedEvidenceCount: savedCount,
    mandatoryEvidenceCount: historicalChecks.length,
    missingEvidence,
    v2D05ShadowBirthSafety: fullyEvaluable ? null : 'NOT_EVALUABLE',
    birthSafetyEvidence: fullyEvaluable ? null : {
      status: 'NOT_EVALUABLE',
      reasonCodes: [],
      evaluatedAt: isoOrNull(record?.researchSnapshot?.analysisAt),
      priceObservedAt: isoOrNull(record?.researchSnapshot?.provenance?.priceTimestamp),
      priceAgeMs: timestamp(record?.researchSnapshot?.analysisAt) && timestamp(record?.researchSnapshot?.provenance?.priceTimestamp)
        ? Date.parse(record.researchSnapshot.analysisAt) - Date.parse(record.researchSnapshot.provenance.priceTimestamp) : null,
      lastConfirmedCandleAt: isoOrNull(record?.researchSnapshot?.provenance?.dailyLastConfirmedAt),
      lastConfirmedCandleAgeMs: timestamp(record?.researchSnapshot?.analysisAt) && timestamp(record?.researchSnapshot?.provenance?.dailyLastConfirmedAt)
        ? Date.parse(record.researchSnapshot.analysisAt) - Date.parse(record.researchSnapshot.provenance.dailyLastConfirmedAt) : null,
      candleCount: Number.isInteger(record?.researchSnapshot?.provenance?.confirmedCount)
        ? record.researchSnapshot.provenance.confirmedCount : null,
      candleContinuityStatus: 'NOT_EVALUABLE',
      instrumentIdentityStatus: 'NOT_EVALUABLE',
      requiredSourcesStatus: 'PARTIALLY_SAVED',
      optionalSourcesStatus: 'UNAVAILABLE_NOT_SUBSTITUTED',
      contractVersion: D05_CONTRACT_VERSION
    }
  };
}

export function summarizeHistoricalD05(records) {
  const evaluated = records.map(evaluateHistoricalD05Record);
  const fully = evaluated.filter(record => record.evaluability === EVALUABILITY.FULLY_EVALUABLE);
  const blocked = fully.filter(record => record.v2D05ShadowBirthSafety === BIRTH_SAFETY_STATUS.BLOCKED);
  const blockedReasonCounts = {};
  for (const record of blocked) for (const code of record.birthSafetyEvidence.reasonCodes) {
    blockedReasonCounts[code] = (blockedReasonCounts[code] || 0) + 1;
  }
  const missingEvidenceCounts = {};
  for (const record of evaluated) for (const key of record.missingEvidence) {
    missingEvidenceCounts[key] = (missingEvidenceCounts[key] || 0) + 1;
  }
  return {
    contractVersion: D05_CONTRACT_VERSION,
    countAnalyzed: evaluated.length,
    fullyEvaluable: fully.length,
    partiallyEvaluable: evaluated.filter(record => record.evaluability === EVALUABILITY.PARTIALLY_EVALUABLE).length,
    notEvaluable: evaluated.filter(record => record.evaluability === EVALUABILITY.NOT_EVALUABLE).length,
    v2Ready: fully.filter(record => record.v2D05ShadowBirthSafety === BIRTH_SAFETY_STATUS.READY).length,
    v2Blocked: blocked.length,
    v1BornV2Ready: fully.filter(record => record.v1CurrentBirthResult === 'BORN' &&
      record.v2D05ShadowBirthSafety === BIRTH_SAFETY_STATUS.READY).length,
    v1BornV2Blocked: blocked.filter(record => record.v1CurrentBirthResult === 'BORN').length,
    blockedReasonCounts,
    missingEvidenceCounts,
    records: evaluated
  };
}
