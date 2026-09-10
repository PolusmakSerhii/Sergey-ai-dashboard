import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const backend = await readFile(new URL('../../backend/api/market.js', import.meta.url), 'utf8');
const frontend = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function section(source, from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a >= 0 && b > a, from);
  return source.slice(a, b);
}
const predicate = section(frontend, '    function isConfirmedAPlusSetup(coin)', '\n    function getBestReadySetup');
const c = vm.createContext({}); vm.runInContext(predicate, c);
const confirmed = c.isConfirmedAPlusSetup;
const chooseBackend = rows => {
  const c = vm.createContext({ filteredSuccessful: rows });
  vm.runInContext(section(backend, 'const bestSetup =', '\nlet marketCondition'), c);
  return vm.runInContext('bestSetup', c);
};
const chooseFrontend = rows => {
  const c = vm.createContext({ globalRankingResults: rows }); vm.runInContext(predicate, c);
  vm.runInContext(section(frontend, '   const fullGlobalBestSetup =', '\nconst bestSetupSymbolElement'), c);
  return vm.runInContext('fullGlobalBestSetup', c);
};
const row = (symbol, score, flag = true, readiness = 80, confidence = 85) => ({
  symbol, opportunityScore: score, confirmedAPlus: flag, confidence,
  tradeAllowed: true, tradeReadiness: { ready: true, score: readiness }, grade: 'A+', opportunityGrade: 'A+'
});
test('frontend consumes true backend result without rebuilding thresholds', () => {
  assert.equal(confirmed({ confirmedAPlus: true }), true);
});
test('A+ grade/allowed/readiness never replace false or missing authoritative result', () => {
  for (const confirmedAPlus of [false, undefined, null, 'true', 1]) {
    assert.equal(confirmed({ ...row('A', 100), confirmedAPlus }), false);
  }
});
for (const [name, choose] of [['backend', chooseBackend], ['frontend', chooseFrontend]]) {
  test(`${name} Best Setup excludes high-score unconfirmed candidates`, () => {
    assert.equal(choose([row('BAD', 100, false), row('GOOD', 85)]).symbol, 'GOOD');
  });
  test(`${name} Best Setup preserves score, readiness and confidence tie breaks`, () => {
    const rows = [row('A', 90, true, 80, 90), row('B', 90, true, 85, 85), row('C', 90, true, 85, 90), row('D', 85, true, 100, 100)];
    assert.equal(choose(rows).symbol, 'C');
  });
  test(`${name} Best Setup is null without confirmed candidates, including old cache`, () => {
    assert.equal(choose([row('BAD', 100, false), { ...row('OLD', 99), confirmedAPlus: undefined }]), null);
    assert.equal(choose([]), null);
  });
}
test('scanner construction forwards the actual gate result into compact global rows', () => {
  const c = vm.createContext({ results: [{ ok: true, symbol: 'A' }],
    calculateScannerOpportunity: () => ({ score: 95, grade: 'A', confirmedAPlus: false }) });
  vm.runInContext(section(backend, ' const successful =', '\n  const filteredSuccessful'), c);
  const rows = vm.runInContext('successful', c);
  assert.equal(rows[0].confirmedAPlus, false);
  c.ranked = rows; c.globalScanner = true; c.scannerPage = 1;
  const from = backend.indexOf(' const globalBatchResults =');
  const end = backend.indexOf(': [];', from) + 5;
  vm.runInContext(backend.slice(from, end), c);
  const globalRow = vm.runInContext('globalBatchResults[0]', c);
  assert.equal(globalRow.confirmedAPlus, false);
  assert.equal(globalRow.opportunityScore, 95);
  assert.equal(globalRow.grade, 'A');
});
test('Global Best Opportunity remains the first ranked market even if not confirmed', () => {
  const rows = [row('HIGHEST', 100, false), row('CONFIRMED', 85)];
  const c = vm.createContext({ globalRankingResults: rows });
  vm.runInContext(section(frontend, '  const fullGlobalBestOpportunity =', '\nconst bestOpportunitySymbolElement'), c);
  assert.equal(vm.runInContext('fullGlobalBestOpportunity.symbol', c), 'HIGHEST');
  assert.equal(chooseFrontend(rows).symbol, 'CONFIRMED');
});
function planAllowed(technical, trackedStatus = null, trackedPlanIsCurrent = false) {
  const c = vm.createContext({ data: { technical }, trackedStatus, trackedPlanIsCurrent,
    liveTradePlan: { validTrade: true }, tradePlan: { validTrade: true },
    scannerCoin: row('CACHED', 100) });
  vm.runInContext(predicate, c);
  vm.runInContext(section(frontend, 'const hasValidTrade =', '\nconst rejectionReason'), c);
  return vm.runInContext('hasValidTrade', c);
}
test('new Trade Plan reads fresh technical flag, not old scanner A+', () => {
  assert.equal(planAllowed({ confirmedAPlus: true }), true);
  assert.equal(planAllowed({ confirmedAPlus: false }), false);
  assert.equal(planAllowed({}), false);
});
test('ACTIVE keeps its frozen plan despite absent/failed live flag; Expired never confirms', () => {
  assert.equal(planAllowed({}, 'Active', true), true);
  assert.equal(planAllowed({ confirmedAPlus: false }, 'Active', true), true);
  assert.equal(planAllowed({ confirmedAPlus: true }, 'Expired', false), false);
});
test('waiting plan is not presented as confirmed without authoritative live result', () => {
  assert.equal(planAllowed({}, 'WaitingEntry', true), false);
});
test('selectors do not mutate any candidate or attached historical snapshot', () => {
  const rows = [ { ...row('CLOSED', 100, false), outcome: { status: 'TP3Hit' }, initialPlan: { stopLoss: 90 } }, row('LIVE', 85) ];
  const before = structuredClone(rows); chooseBackend(rows); chooseFrontend(rows);
  assert.deepEqual(rows, before);
});
test('existing A+ filter selects STEP 3 live grade without reconstructing eligibility', () => {
  const c = vm.createContext({ gradeFilter: { value: 'A+' }, coin: { opportunityGrade: 'A' } });
  const code = section(frontend, 'const gradeMatch =', '\nconst action =');
  vm.runInContext(code, c); assert.equal(vm.runInContext('gradeMatch', c), false);
  const d = vm.createContext({ gradeFilter: { value: 'A+' }, coin: { opportunityGrade: 'A+' } });
  vm.runInContext(code, d); assert.equal(vm.runInContext('gradeMatch', d), true);
});
