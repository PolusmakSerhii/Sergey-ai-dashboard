export const D03_SHADOW_VERSION = 'd03-oi-price-semantics-shadow-v1';

export const D03_CLASSIFICATION = Object.freeze({
  BULLISH: 'Bullish Confirmation',
  BEARISH: 'Bearish Confirmation',
  SHORT_COVERING: 'Short Covering',
  LONG_LIQUIDATION: 'Long Liquidation',
  OI_FLAT: 'Stable Open Interest',
  PRICE_FLAT: 'Price Flat',
  BOTH_FLAT: 'OI and Price Flat',
  UNAVAILABLE: 'UNAVAILABLE'
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const validTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function reasonCodes(input) {
  const reasons = [];
  if (!finite(input?.openInterestChange24h)) reasons.push(input?.openInterestChange24h == null
    ? 'MISSING_OPEN_INTEREST_CHANGE_24H' : 'INVALID_OPEN_INTEREST_CHANGE_24H');
  if (!finite(input?.priceChange24h)) reasons.push(input?.priceChange24h == null
    ? 'MISSING_PRICE_CHANGE_24H' : 'INVALID_PRICE_CHANGE_24H');
  if (!nonempty(input?.openInterestSource)) reasons.push('MISSING_OPEN_INTEREST_SOURCE');
  if (!nonempty(input?.priceSource)) reasons.push('MISSING_PRICE_SOURCE');
  if (!validTimestamp(input?.observedAt)) reasons.push('MISSING_OR_INVALID_OBSERVED_AT');
  return reasons;
}

function classifySigns(openInterestChange24h, priceChange24h) {
  if (openInterestChange24h === 0 && priceChange24h === 0) return D03_CLASSIFICATION.BOTH_FLAT;
  if (openInterestChange24h === 0) return D03_CLASSIFICATION.OI_FLAT;
  if (priceChange24h === 0) return D03_CLASSIFICATION.PRICE_FLAT;
  if (openInterestChange24h > 0 && priceChange24h > 0) return D03_CLASSIFICATION.BULLISH;
  if (openInterestChange24h > 0 && priceChange24h < 0) return D03_CLASSIFICATION.BEARISH;
  if (openInterestChange24h < 0 && priceChange24h > 0) return D03_CLASSIFICATION.SHORT_COVERING;
  return D03_CLASSIFICATION.LONG_LIQUIDATION;
}

export function evaluateD03Shadow(input) {
  const reasons = reasonCodes(input);
  const provenance = {
    openInterestSource: nonempty(input?.openInterestSource) ? input.openInterestSource : null,
    priceSource: nonempty(input?.priceSource) ? input.priceSource : null,
    observedAt: validTimestamp(input?.observedAt) ? new Date(input.observedAt).toISOString() : null
  };
  if (reasons.length) return {
    version: D03_SHADOW_VERSION,
    available: false,
    classification: D03_CLASSIFICATION.UNAVAILABLE,
    reasonCodes: reasons,
    input: {
      openInterestChange24h: finite(input?.openInterestChange24h) ? input.openInterestChange24h : null,
      priceChange24h: finite(input?.priceChange24h) ? input.priceChange24h : null,
      ...provenance
    }
  };
  return {
    version: D03_SHADOW_VERSION,
    available: true,
    classification: classifySigns(input.openInterestChange24h, input.priceChange24h),
    reasonCodes: [],
    input: {
      openInterestChange24h: input.openInterestChange24h,
      priceChange24h: input.priceChange24h,
      ...provenance
    }
  };
}

// Research model of the proven v1 semantic substitution. It is never imported by production.
export function evaluateV1SemanticShadow(input) {
  const v1Input = {
    ...input,
    priceChange24h: input?.openInterestChange24h
  };
  const result = evaluateD03Shadow(v1Input);
  return {
    ...result,
    version: 'd03-v1-substitution-shadow-model',
    semanticModel: 'priceChange24h receives openInterestChange24h'
  };
}

export function compareD03Semantics(input) {
  const v1 = evaluateV1SemanticShadow(input);
  const v2 = evaluateD03Shadow(input);
  const comparable = v1.available && v2.available;
  return {
    version: D03_SHADOW_VERSION,
    comparable,
    comparison: comparable ? (v1.classification === v2.classification ? 'SAME' : 'DIFFERENT') : 'NOT_PROVEN',
    v1,
    v2,
    downstreamCounterfactual: {
      status: 'NOT_PROVEN',
      probabilityDelta: null,
      confidenceDelta: null,
      readinessDelta: null,
      opportunityScoreDelta: null,
      aPlusEligibilityDelta: null,
      reason: 'Full same-snapshot scoring inputs are not part of this typed D03 contract'
    }
  };
}

export function summarizeD03Comparisons(records) {
  const comparisons = records.map(record => record.comparison);
  const unavailableReasons = {};
  for (const result of comparisons) {
    for (const reason of result.v2.reasonCodes) unavailableReasons[reason] = (unavailableReasons[reason] || 0) + 1;
  }
  return {
    contractVersion: D03_SHADOW_VERSION,
    countAnalyzed: comparisons.length,
    comparableCount: comparisons.filter(result => result.comparable).length,
    classificationSame: comparisons.filter(result => result.comparison === 'SAME').length,
    classificationDifferent: comparisons.filter(result => result.comparison === 'DIFFERENT').length,
    v2UnavailableCount: comparisons.filter(result => !result.v2.available).length,
    notProvenCount: comparisons.filter(result => result.comparison === 'NOT_PROVEN').length,
    unavailableReasons,
    downstreamDeltas: {
      status: comparisons.every(result => result.downstreamCounterfactual.status === 'NOT_PROVEN') ? 'NOT_PROVEN' : 'PARTIAL',
      recordsProven: comparisons.filter(result => result.downstreamCounterfactual.status === 'PROVEN').length,
      recordsNotProven: comparisons.filter(result => result.downstreamCounterfactual.status !== 'PROVEN').length,
      probabilityDelta: null,
      confidenceDelta: null,
      readinessDelta: null,
      opportunityScoreDelta: null,
      aPlusEligibilityDelta: null
    },
    strategyRecommendation: null
  };
}
