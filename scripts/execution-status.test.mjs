import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const backend = await readFile(new URL('../../backend/api/market.js', import.meta.url), 'utf8');
const frontend = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const context = vm.createContext({ Date });
for (const [source, from, to] of [
  [backend, 'function isConfirmedAPlusTrade(signal) {', '\nfunction isConfirmedAPlusTradeSignal'],
  [backend, 'function calculateScannerOpportunity(data) {', '\nasync function fetchScannerSymbol'],
  [frontend, '    function getTradeExecutionStatus(', '    async function openCoinModal(']
]) {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a >= 0 && b > a);
  vm.runInContext(source.slice(a, b), context);
}
const plan = () => ({ validTrade: true, direction: 'Long',
  entryZone: { from: 99, to: 101 }, stopLoss: 90,
  takeProfit1: 110, takeProfit2: 120, takeProfit3: 130, riskReward: 2 });
const payload = () => ({ symbol: 'TESTUSDT', price: 100,
  technical: {
    probability: { score: 85, confidence: { score: 85 },
      aiAssessment: { direction: 'Long', tradeAllowed: true },
      probabilities: { bullish: 90, bearish: 0, neutral: 10 } },
    recommendation: { action: 'Strong Buy', direction: 'Long', confidence: 85 },
    tradeReadiness: { ready: true, score: 85, status: 'Ready' },
    marketEnvironment: { score: 85, tradable: true }, smartMoney: { score: 85 },
    tradePlan: plan()
  }
});
function inputs(data = payload(), extras = {}) {
  const row = context.createScannerAnalysis(data, data.symbol);
  const confirmedAPlus = context.calculateScannerOpportunity(row).confirmedAPlus;
  return { confirmedAPlus, liveTradePlan: data.technical.tradePlan,
    tradePlan: data.technical.tradePlan, hasValidTrade: true,
    price: data.price, now: Date.parse('2026-09-10T12:00:00Z'), ...extras };
}
const status = value => context.getTradeExecutionStatus(value).title;
for (const [name, change] of [
  ['confidence 84', x => { x.technical.probability.confidence.score = 84; }],
  ['Action Buy', x => { x.technical.recommendation.action = 'Buy'; }],
  ['tradeAllowed false', x => { x.technical.probability.aiAssessment.tradeAllowed = false; }],
  ['readiness false', x => { x.technical.tradeReadiness.ready = false; }],
  ['invalid Entry', x => { x.technical.tradePlan.entryZone = { from: 101, to: 99 }; }],
  ['invalid SL', x => { x.technical.tradePlan.stopLoss = 100; }],
  ['missing target', x => { delete x.technical.tradePlan.takeProfit3; }]
]) test(`${name}: backend gate failure blocks READY even inside candidate zone`, () => {
  const data = payload(); change(data);
  const value = inputs(data);
  assert.equal(value.confirmedAPlus, false);
  assert.equal(status(value), 'WAIT CONFIRMATION');
});
test('backend result comes from the same projection and authoritative gate as Scanner', () => {
  const data = payload(), row = context.createScannerAnalysis(data, data.symbol);
  const opportunity = context.calculateScannerOpportunity(row);
  assert.equal(opportunity.confirmedAPlus, true);
  assert.equal(opportunity.confirmedAPlus, context.isConfirmedAPlusTrade({ ...row, opportunityScore: opportunity.score }));
  assert.equal(row.action, data.technical.recommendation.action);
  assert.equal(row.entryZone, data.technical.tradePlan.entryZone);
});
test('valid LONG inside Entry Zone and both boundaries is READY', () => {
  for (const price of [99, 100, 101]) assert.equal(status(inputs(payload(), { price })), 'READY TO ENTER');
});
test('valid SHORT inside Entry Zone is READY', () => {
  const data = payload();
  Object.assign(data.technical.tradePlan, { direction: 'Short', stopLoss: 110,
    takeProfit1: 90, takeProfit2: 80, takeProfit3: 70 });
  data.technical.probability.aiAssessment.direction = 'Short';
  Object.assign(data.technical.recommendation, { direction: 'Short', action: 'Strong Sell' });
  assert.equal(status(inputs(data)), 'READY TO ENTER');
});
test('confirmed price outside either side waits for entry', () => {
  for (const price of [98, 102]) assert.equal(status(inputs(payload(), { price })), 'WAIT FOR ENTRY');
});
test('missing or false backend eligibility fails closed despite valid levels', () => {
  for (const confirmedAPlus of [undefined, null, false, 'true']) {
    assert.equal(status(inputs(payload(), { confirmedAPlus })), 'WAIT CONFIRMATION');
  }
});
test('WATCH / no valid confirmed plan cannot show READY', () => {
  assert.equal(status(inputs(payload(), { hasValidTrade: false })), 'WAIT CONFIRMATION');
  assert.equal(status(inputs(payload(), { liveTradePlan: { ...plan(), validTrade: false } })), 'WAIT CONFIRMATION');
  assert.equal(status(inputs(payload(), { tradePlan: {} })), 'WAIT CONFIRMATION');
});
test('Expired status and elapsed pending expiry never permit entry', () => {
  for (const trackedSignal of [ { outcome: { status: 'Expired' } },
    { outcome: { status: 'WaitingEntry' }, initialPlan: { expiresAt: '2026-09-10T11:00:00Z' } } ]) {
    assert.equal(status(inputs(payload(), { trackedSignal })), 'EXPIRED');
  }
});
test('ACTIVE precedes live gate and expiry; frozen snapshot is not mutated', () => {
  const trackedSignal = { outcome: { status: 'Active' },
    initialPlan: { ...plan(), expiresAt: '2026-09-09T00:00:00Z', exitStrategy: { version: 'frozen' } } };
  const before = structuredClone(trackedSignal);
  assert.equal(status(inputs(payload(), { trackedSignal, confirmedAPlus: false,
    hasValidTrade: false, liveTradePlan: {}, price: NaN })), 'ACTIVE TRADE');
  assert.deepEqual(trackedSignal, before);
});
test('closed and unknown tracked states cannot authorize entry', () => {
  for (const state of ['Stopped', 'TP1Hit', 'TP3Hit', 'Closed', 'Unknown']) {
    assert.equal(status(inputs(payload(), { trackedSignal: { outcome: { status: state } } })), 'WAIT CONFIRMATION');
  }
});
test('pending matching snapshot can enter; different frozen levels cannot borrow live eligibility', () => {
  const trackedSignal = { outcome: { status: 'WaitingEntry' }, initialPlan: plan() };
  assert.equal(status(inputs(payload(), { trackedSignal, tradePlan: plan() })), 'READY TO ENTER');
  const frozen = { ...plan(), stopLoss: 89 };
  assert.equal(status(inputs(payload(), { trackedSignal, tradePlan: frozen })), 'WAIT CONFIRMATION');
});
test('invalid entry range or price cannot show READY even with supplied true flag', () => {
  for (const entryZone of [{ from: 101, to: 99 }, { from: 0, to: 101 }, { from: NaN, to: 101 }]) {
    const invalid = { ...plan(), entryZone };
    assert.equal(status(inputs(payload(), { tradePlan: invalid, liveTradePlan: invalid })), 'WAIT CONFIRMATION');
  }
  for (const price of [null, undefined, NaN, Infinity, 0]) {
    assert.equal(status(inputs(payload(), { price })), 'WAIT CONFIRMATION');
  }
});
test('broken Stop Loss remains INVALIDATED', () => {
  assert.equal(status(inputs(payload(), { price: 89 })), 'INVALIDATED');
});
test('modal wiring reads fresh backend flag, not cached scanner Grade', () => {
  const a = frontend.indexOf('const tradeExecutionStatus = getTradeExecutionStatus({');
  const b = frontend.indexOf('\n});', a) + 4;
  assert.ok(a >= 0 && b > a);
  const c = vm.createContext({ data: { technical: { confirmedAPlus: false }, price: 100 },
    liveTradePlan: plan(), tradePlan: plan(), hasValidTrade: true, trackedSignal: null,
    getTradeExecutionStatus: context.getTradeExecutionStatus });
  vm.runInContext(frontend.slice(a, b), c);
  assert.equal(vm.runInContext('tradeExecutionStatus.title', c), 'WAIT CONFIRMATION');
});
