import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLifecycleAlignedEconomics, observedRemainderFromOutcome, summarizeD01 } from './d01.mjs';

const input = overrides => ({ direction: 'Long', plannedEntryReference: 100, activationEntryReference: 100,
  initialStopLoss: 95, takeProfit1: 105, entryZone: { from: 99, to: 101 }, currentHeadlineRR: 2, ...overrides });

test('LONG exact 1R TP1 geometry', () => {
  const x = calculateLifecycleAlignedEconomics(input());
  assert.equal(x.initialRisk, 5); assert.equal(x.tp1RewardR, 1); assert.equal(x.tp1WeightedR, 0.5);
});
test('SHORT exact 1R TP1 geometry', () => {
  const x = calculateLifecycleAlignedEconomics(input({ direction: 'Short', initialStopLoss: 105, takeProfit1: 95 }));
  assert.equal(x.initialRisk, 5); assert.equal(x.tp1RewardR, 1); assert.equal(x.tp1WeightedR, 0.5);
});
test('non-1R TP1 geometry', () => assert.equal(calculateLifecycleAlignedEconomics(input({ takeProfit1: 110 })).tp1RewardR, 2));
test('entry equal to stop is invalid', () => assert.deepEqual(
  calculateLifecycleAlignedEconomics(input({ initialStopLoss: 100 })).reasonCodes, ['ENTRY_EQUALS_STOP']));
test('LONG zone best/mid/worst is direction-aware', () => {
  const z = calculateLifecycleAlignedEconomics(input()).zoneRange;
  assert.equal(z.bestZoneTp1REntryReference, 99); assert.equal(z.midpointEntryReference, 100);
  assert.equal(z.worstZoneTp1REntryReference, 101); assert.equal(z.bestZoneTp1R, 1.5);
});
test('SHORT zone best/mid/worst is direction-aware', () => {
  const z = calculateLifecycleAlignedEconomics(input({ direction: 'Short', initialStopLoss: 105, takeProfit1: 95 })).zoneRange;
  assert.equal(z.bestZoneTp1REntryReference, 101); assert.equal(z.midpointEntryReference, 100);
  assert.equal(z.worstZoneTp1REntryReference, 99); assert.equal(z.bestZoneTp1R, 1.5);
  assert.equal(z.bestZoneCostREntryReference, 99); assert.equal(z.worstZoneCostREntryReference, 101);
  assert.equal(z.bestZoneTp1WeightedRAfterCostEntryReference, 101);
  assert.equal(z.worstZoneTp1WeightedRAfterCostEntryReference, 99);
});
test('zone cost best/mid/worst uses numeric cost extrema', () => {
  const z = calculateLifecycleAlignedEconomics(input()).zoneRange;
  assert.equal(z.bestZoneCostR, 0.02525); assert.equal(z.midpointZoneCostR, 0.03); assert.equal(z.worstZoneCostR, 0.037125);
});
test('cost-in-R and TP1 weighted after cost', () => {
  const x = calculateLifecycleAlignedEconomics(input());
  assert.equal(x.modeledCostRAtEntry, 0.03); assert.equal(x.tp1WeightedRAfterCost, 0.47);
});
test('planned and activation entry references are never silently substituted', () => {
  const x = calculateLifecycleAlignedEconomics(input({ activationEntryReference: 99 }));
  assert.equal(x.plannedEntryReference, 100); assert.equal(x.initialRisk, 5);
  assert.equal(x.activationEntryReference, 99); assert.equal(x.activationGeometry.initialRisk, 4);
});
test('weighted-after-cost zone extrema are explicit', () => {
  const z = calculateLifecycleAlignedEconomics(input()).zoneRange;
  assert.equal(z.bestZoneTp1WeightedRAfterCostEntryReference, 99);
  assert.equal(z.worstZoneTp1WeightedRAfterCostEntryReference, 101);
});
test('observed remainder stays separate from pre-entry geometry', () => {
  const remainder = observedRemainderFromOutcome({ exits: [
    { target: 'TP1', realizedR: 0.5 }, { target: 'CLOSE', realizedR: -0.2 }
  ] });
  const x = calculateLifecycleAlignedEconomics(input({ observedRemainderR: remainder, observedFinalGrossR: 0.3 }));
  assert.equal(x.observedRemainderR, -0.2); assert.equal(x.tp1WeightedR, 0.5);
  assert.equal(x.observedFinalModeledNetR, 0.27);
});
test('no expected-value field exists', () => {
  const keys = JSON.stringify(calculateLifecycleAlignedEconomics(input()));
  assert.doesNotMatch(keys, /expected/i);
});
test('reanalysis close remains parametric and is not probability weighted', () => {
  const scenario = calculateLifecycleAlignedEconomics(input()).scenarioVector.scenarioTp1ThenReanalysisClose;
  assert.equal(scenario.remainderR, null); assert.equal(scenario.totalModeledNetR, null);
  assert.match(scenario.remainderRFormula, /reanalysisClosePrice/);
});
test('D01 aggregate comparison is deterministic', () => {
  const trades = [input(), input({ takeProfit1: 110 })].map(value => ({ lifecycleAlignedEconomics: calculateLifecycleAlignedEconomics(value) }));
  assert.deepEqual(summarizeD01(trades), summarizeD01(trades));
  assert.equal(summarizeD01(trades).filterRecommendation, null);
});
