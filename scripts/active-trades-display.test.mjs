import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('    function renderActiveTrades('), html.indexOf('    function renderCompletedTrades('));
function trade(symbol, activatedAt, options = {}) {
  return { symbol, tradeId: symbol, direction: 'Long', price: 102,
    initialPlan: { stopLoss: 90, takeProfit1: 120, exitStrategy: { version: 'tp1-50-reanalyse-v1' } },
    outcome: { status: 'Active', entryPrice: 100, activatedAt }, ...options };
}
function render(trades) {
  const container = {}, count = {}, legacy = [];
  const context = vm.createContext({ document: { querySelector: s => s === '#statistics-active-trades' ? container : count },
    renderTradeVerification: () => '', renderPartialPosition: (signal, card) => {
      legacy.push([signal, card]); return `<button class="active-trade-item partial-trade-item" data-symbol="${signal.symbol}"></button>`;
    } });
  vm.runInContext(source, context);
  context.renderActiveTrades({ readySignals: trades });
  return { output: container.innerHTML, legacy };
}
const order = trades => [...render(trades).output.matchAll(/data-symbol="([^"]+)"/g)].map(m => m[1]);
test('compact CSS applies only to exact new policy, legacy delegates unchanged', () => {
  assert.match(html, /\.active-trade-item\.is-tp1-reanalysis\s*\{\s*align-self: start;\s*\}/);
  const old = trade('LEGACY', '2026-10-01', { initialPlan: { exitStrategy: { version: 'partial-25-25-50-be-v1' } } });
  const { output, legacy } = render([trade('NEW', '2026-10-01'), old, trade('UNKNOWN', null, { initialPlan: {} })]);
  assert.equal((output.match(/class="active-trade-item is-tp1-reanalysis"/g) || []).length, 1);
  assert.equal(legacy[0][0], old); assert.equal(legacy[0][1], true);
});
test('chronology overrides progress across both policies and directions', () => {
  const old = trade('EARLY', '2026-09-29', { initialPlan: { exitStrategy: { version: 'partial-25-25-50-be-v1' } } });
  assert.deepEqual(order([trade('LATE', '2026-10-02', { price: 119 }), trade('MIDDLE', '2026-10-01', { direction: 'Short' }), old]), ['EARLY', 'MIDDLE', 'LATE']);
});
test('verified candle fallback only; primary timestamp takes precedence; unknown last', () => {
  const withCheck = (symbol, activatedAt, timestamp, rule = 'first-complete-candle-touch') => trade(symbol, null, {
    outcome: { status: 'Active', entryPrice: 100, activatedAt, entryCheck: { rule, candle: { timestamp } } }
  });
  assert.deepEqual(order([
    withCheck('UNKNOWN', null, Date.parse('2026-09-01'), 'other'),
    withCheck('PRIMARY', '2026-10-03', Date.parse('2026-09-01')),
    withCheck('FALLBACK', 'invalid', Date.parse('2026-10-01')),
    withCheck('MISSING', null, Date.parse('2026-10-02'))
  ]), ['FALLBACK', 'MISSING', 'PRIMARY', 'UNKNOWN']);
});
test('missing/invalid times ignore creation dates and sort last by id then filtered index', () => {
  const first = trade('FIRST', null, { tradeId: 'same', createdAt: '2000-01-01', plannedAt: '2000-01-01' });
  const second = trade('SECOND', 'invalid', { tradeId: 'same' });
  assert.deepEqual(order([first, trade('Z', null), second, trade('KNOWN', '2026-10-01'), trade('A', '')]), ['KNOWN', 'A', 'Z', 'FIRST', 'SECOND']);
  assert.deepEqual(order([trade('B', '2026-10-01'), trade('A', '2026-10-01')]), ['A', 'B']);
});
test('null/non-finite fallback is not a valid activation', () => {
  for (const timestamp of [null, undefined, NaN, Infinity, '2026-01-01']) {
    const unknown = trade('UNKNOWN', null, { outcome: { status: 'Active', entryCheck: { rule: 'first-complete-candle-touch', candle: { timestamp } } } });
    assert.deepEqual(order([unknown, trade('KNOWN', '2026-10-01')]), ['KNOWN', 'UNKNOWN']);
  }
});
test('source array and nested objects stay unchanged, inactive records excluded', () => {
  const trades = [trade('LATE', '2026-10-02'), trade('EARLY', '2026-10-01'), trade('WAIT', null, { outcome: { status: 'WaitingEntry' } })];
  const before = structuredClone(trades);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(trades); assert.deepEqual(order(trades), ['EARLY', 'LATE']); assert.deepEqual(trades, before);
});
for (const [direction, price, stop, tp, progress, width, left] of [
  ['Long', 110, 90, 120, '+50', 25, 75], ['Long', 95, 90, 120, '-25', 25, 25],
  ['Short', 90, 110, 80, '+50', 25, 75], ['Short', 105, 110, 80, '-25', 25, 25]
]) test(`${direction} price ${price}: metric values/order and progress/markers preserved`, () => {
  const { output } = render([trade('TEST', '2026-10-01', { direction, price, initialPlan: { stopLoss: stop, takeProfit1: tp, exitStrategy: { version: 'tp1-50-reanalyse-v1' } } })]);
  const metrics = [...output.matchAll(/<span>(Stop Loss|Current|Entry|TP1)<strong>(.*?)<\/strong>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(metrics, [['Stop Loss', String(stop)], ['Current', String(price)], ['Entry', '100'], ['TP1', String(tp)]]);
  assert.ok(output.includes(`Прогресс к TP1: ${progress}%`));
  assert.ok(output.includes(`style="width:${width}%"`)); assert.ok(output.includes(`style="left:${left}%"`));
  assert.match(output, /active-trade-progress-entry" aria-hidden="true"/);
});
