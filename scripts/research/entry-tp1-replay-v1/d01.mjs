export const D01_VERSION = 'lifecycle-aligned-economics-d01-v1';
export const TP1_ALLOCATION = 0.5;
export const MODELED_COST_RATE = 0.0015;

const finitePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const round = value => Number.isFinite(value) ? Number(value.toPrecision(15)) : null;

function pointGeometry(direction, entry, stop, tp1) {
  if (!finitePositive(entry) || !finitePositive(stop) || !finitePositive(tp1) || entry === stop) return null;
  const sign = direction === 'Long' ? 1 : direction === 'Short' ? -1 : null;
  if (sign === null || sign * (entry - stop) <= 0 || sign * (tp1 - entry) <= 0) return null;
  const initialRisk = Math.abs(entry - stop);
  const tp1RewardR = sign * (tp1 - entry) / initialRisk;
  const tp1WeightedR = TP1_ALLOCATION * tp1RewardR;
  const modeledCostR = MODELED_COST_RATE * entry / initialRisk;
  return {
    entryReference: entry,
    initialRisk: round(initialRisk),
    tp1RewardR: round(tp1RewardR),
    tp1WeightedR: round(tp1WeightedR),
    modeledCostR: round(modeledCostR),
    tp1WeightedRAfterCost: round(tp1WeightedR - modeledCostR)
  };
}

function extrema(points, field, best = 'max') {
  const ordered = [...points].sort((a, b) => a[field] - b[field] || a.entryReference - b.entryReference);
  return best === 'min' ? ordered[0] : ordered.at(-1);
}

function zoneRange(direction, zone, stop, tp1) {
  if (!zone || !finitePositive(zone.from) || !finitePositive(zone.to)) return null;
  const low = Math.min(zone.from, zone.to);
  const high = Math.max(zone.from, zone.to);
  const midpoint = (low + high) / 2;
  const points = [low, high].map(entry => pointGeometry(direction, entry, stop, tp1));
  const middle = pointGeometry(direction, midpoint, stop, tp1);
  if (points.some(point => point === null) || middle === null) return null;
  const bestTp1 = extrema(points, 'tp1RewardR');
  const worstTp1 = extrema(points, 'tp1RewardR', 'min');
  const bestCost = extrema(points, 'modeledCostR', 'min');
  const worstCost = extrema(points, 'modeledCostR');
  const bestNet = extrema(points, 'tp1WeightedRAfterCost');
  const worstNet = extrema(points, 'tp1WeightedRAfterCost', 'min');
  return {
    zoneLow: low,
    zoneHigh: high,
    bestZoneTp1R: bestTp1.tp1RewardR,
    bestZoneTp1REntryReference: bestTp1.entryReference,
    midpointZoneTp1R: middle.tp1RewardR,
    midpointEntryReference: midpoint,
    worstZoneTp1R: worstTp1.tp1RewardR,
    worstZoneTp1REntryReference: worstTp1.entryReference,
    bestZoneCostR: bestCost.modeledCostR,
    bestZoneCostREntryReference: bestCost.entryReference,
    midpointZoneCostR: middle.modeledCostR,
    worstZoneCostR: worstCost.modeledCostR,
    worstZoneCostREntryReference: worstCost.entryReference,
    bestZoneTp1WeightedRAfterCost: bestNet.tp1WeightedRAfterCost,
    bestZoneTp1WeightedRAfterCostEntryReference: bestNet.entryReference,
    midpointZoneTp1WeightedRAfterCost: middle.tp1WeightedRAfterCost,
    worstZoneTp1WeightedRAfterCost: worstNet.tp1WeightedRAfterCost,
    worstZoneTp1WeightedRAfterCostEntryReference: worstNet.entryReference
  };
}

export function observedRemainderFromOutcome(outcome) {
  if (!outcome || !Array.isArray(outcome.exits) || !outcome.exits.some(exit => exit?.target === 'TP1')) return null;
  const remainder = outcome.exits.filter(exit => exit?.target !== 'TP1').reduce((sum, exit) =>
    typeof exit?.realizedR === 'number' && Number.isFinite(exit.realizedR) ? sum + exit.realizedR : sum, 0);
  return round(remainder);
}

export function calculateLifecycleAlignedEconomics({
  direction,
  plannedEntryReference,
  activationEntryReference = null,
  initialStopLoss,
  takeProfit1,
  entryZone = null,
  currentHeadlineRR = null,
  observedRemainderR = null,
  observedFinalGrossR = null
}) {
  if (!['Long', 'Short'].includes(direction)) return { valid: false, reasonCodes: ['INVALID_DIRECTION'] };
  if (!finitePositive(plannedEntryReference) || !finitePositive(initialStopLoss) || !finitePositive(takeProfit1)) {
    return { valid: false, reasonCodes: ['MISSING_OR_INVALID_GEOMETRY'] };
  }
  if (plannedEntryReference === initialStopLoss) return { valid: false, reasonCodes: ['ENTRY_EQUALS_STOP'] };
  const planned = pointGeometry(direction, plannedEntryReference, initialStopLoss, takeProfit1);
  if (!planned) return { valid: false, reasonCodes: ['INVALID_DIRECTIONAL_GEOMETRY'] };
  const activation = activationEntryReference == null ? null
    : pointGeometry(direction, activationEntryReference, initialStopLoss, takeProfit1);
  if (activationEntryReference != null && !activation) return { valid: false, reasonCodes: ['INVALID_ACTIVATION_GEOMETRY'] };
  const range = zoneRange(direction, entryZone, initialStopLoss, takeProfit1);
  const observedCost = activation?.modeledCostR ?? null;
  const observedNet = Number.isFinite(observedFinalGrossR) && observedCost !== null
    ? round(observedFinalGrossR - observedCost) : null;
  return {
    version: D01_VERSION,
    valid: true,
    entryReferencePolicy: 'frozen-planned-entry',
    plannedEntryReference,
    activationEntryReference,
    currentHeadlineRR: Number.isFinite(currentHeadlineRR) ? currentHeadlineRR : null,
    initialRisk: planned.initialRisk,
    tp1RewardR: planned.tp1RewardR,
    tp1Allocation: TP1_ALLOCATION,
    tp1WeightedR: planned.tp1WeightedR,
    modeledCostRAtEntry: planned.modeledCostR,
    tp1WeightedRAfterCost: planned.tp1WeightedRAfterCost,
    activationGeometry: activation,
    zoneRange: range,
    scenarioVector: {
      scenarioTp1ThenBe: {
        remainderAllocation: 0.5,
        remainderR: 0,
        totalGrossR: planned.tp1WeightedR,
        totalModeledNetR: planned.tp1WeightedRAfterCost
      },
      scenarioTp1ThenReanalysisClose: {
        remainderAllocation: 0.5,
        reanalysisClosePrice: null,
        remainderR: null,
        totalGrossR: null,
        totalModeledNetR: null,
        remainderRFormula: `0.5 * ${direction === 'Long' ? '1' : '-1'} * (reanalysisClosePrice - plannedEntryReference) / initialRisk`
      }
    },
    observedRemainderR: Number.isFinite(observedRemainderR) ? round(observedRemainderR) : null,
    observedFinalGrossR: Number.isFinite(observedFinalGrossR) ? round(observedFinalGrossR) : null,
    observedFinalModeledNetR: observedNet,
    observedMetricsPolicy: 'post-outcome-observation-only-not-pre-entry-expectation'
  };
}

export function summarizeD01(trades) {
  const values = trades.map(trade => trade.lifecycleAlignedEconomics).filter(item => item?.valid === true);
  const mean = field => {
    const numbers = values.map(item => item[field]).filter(Number.isFinite);
    return numbers.length ? round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : null;
  };
  return {
    version: D01_VERSION,
    trades: values.length,
    headlineRRMean: mean('currentHeadlineRR'),
    tp1WeightedRMean: mean('tp1WeightedR'),
    tp1WeightedRAfterCostMean: mean('tp1WeightedRAfterCost'),
    tradesWhereHeadlineRRGte2: values.filter(item => item.currentHeadlineRR >= 2).length,
    tradesWhereTp1WeightedRAfterCostLt0_5: values.filter(item => item.tp1WeightedRAfterCost < 0.5).length,
    filterRecommendation: null
  };
}
