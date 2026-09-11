import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source = await readFile(new URL('../ai-chart.js', import.meta.url), 'utf8');
function harness() {
  const requests = [], writes = [], errors = [];
  const element = () => ({ style: {}, children: [], hidden: false,
    setAttribute() {}, appendChild(child) { this.children.push(child); },
    addEventListener(name, callback) { this[name] = callback; } });
  const chartContainer = element();
  const layer = name => ({
    applyOptions: value => writes.push([name, 'options', value]),
    setData: value => writes.push([name, 'data', value])
  });
  const c = vm.createContext({
    window: { SergeyMarketData: { getCandles: options => new Promise((resolve, reject) => requests.push({ options, resolve, reject })) } },
    console: { log() {}, error: (...args) => errors.push(args), warn: (...args) => errors.push(args) },
    chart: { timeScale: () => ({ fitContent: () => writes.push(['fit']) }) },
    candlestickSeries: layer('candles'), ema20Series: layer('ema20'),
    ema50Series: layer('ema50'), ema200Series: layer('ema200'), symbol: 'TESTUSDT',
    document: { createElement: element }, chartContainer,
    timeframeToolbar: { setActiveTimeframe: value => writes.push(['toolbar', value]) },
    chartLegend: { setTimeframe: value => writes.push(['legend', value]) }
  });
  vm.runInContext(source, c);
  const a = source.indexOf('  let activeTimeframe = "1H";');
  const b = source.indexOf('const timeframeToolbar =', a);
  assert.ok(a > 0 && b > a);
  vm.runInContext(source.slice(a, b), c);
  const reply = (index, base) => requests[index].resolve({ ok: true, source: 'fixture',
    candles: Array.from({ length: 220 }, (_, i) => ({ time: 1700000000 + i * 60,
      open: base + i, high: base + i + 2, low: base + i - 1, close: base + i + 1 })) });
  return { c, requests, writes, errors, reply, reload: c.reloadTimeframe,
    panel: chartContainer.children[0],
    timeframe: () => vm.runInContext('activeTimeframe', c) };
}
test('ordinary 1H loads candles, all EMA series, price formats, fit and legend without console errors', async () => {
  const h = harness(), p = h.reload('1H'); h.reply(0, 100);
  assert.equal((await p).ok, true);
  assert.equal(h.requests[0].options.timeframe, '1H');
  for (const name of ['candles', 'ema20', 'ema50', 'ema200']) {
    assert.equal(h.writes.filter(x => x[0] === name && x[1] === 'data').length, 1);
    assert.equal(h.writes.filter(x => x[0] === name && x[1] === 'options').length, 1);
  }
  assert.equal(h.writes.filter(x => x[0] === 'fit').length, 1);
  assert.equal(h.timeframe(), '1H'); assert.deepEqual(h.errors, []);
});
test('sequential 1H, 4H, 1D switches retain normal behavior', async () => {
  const h = harness();
  for (const [i, timeframe] of ['1H', '4H', '1D'].entries()) {
    const p = h.reload(timeframe); h.reply(i, 100 * (i + 1));
    assert.equal((await p).ok, true); assert.equal(h.timeframe(), timeframe);
  }
  assert.equal(h.writes.filter(x => x[0] === 'fit').length, 3);
  assert.deepEqual(h.errors, []);
});
test('rapid 1H → 4H → 1D: late older responses cannot mutate any chart state', async () => {
  const h = harness();
  const a = h.reload('1H'), b = h.reload('4H'), d = h.reload('1D');
  h.reply(2, 300); assert.equal((await d).ok, true);
  const accepted = structuredClone(h.writes);
  h.reply(0, 100); assert.equal((await a).ignored, true);
  h.reply(1, 200); assert.equal((await b).ignored, true);
  assert.deepEqual(structuredClone(h.writes), accepted);
  assert.equal(h.writes.find(x => x[0] === 'candles' && x[1] === 'data')[2][0].open, 300);
  assert.equal(h.timeframe(), '1D'); assert.deepEqual(h.errors, []);
});
test('stale response cannot paint while latest is pending, including stale API error', async () => {
  const h = harness();
  const a = h.reload('1H'), b = h.reload('4H'), d = h.reload('1D');
  h.reply(0, 100); assert.equal((await a).ignored, true);
  h.requests[1].resolve({ ok: false, error: 'old request failed' });
  assert.equal((await b).ignored, true);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.errors, []);
  h.reply(2, 300); assert.equal((await d).ok, true);
  assert.equal(h.timeframe(), '1D'); assert.deepEqual(h.errors, []);
});

test('API error is visible as text; retry reloads failed timeframe and clears error', async () => {
  const h = harness();
  const p = h.reload('4H');
  h.requests[0].resolve({ ok: false, error: '<b>API unavailable</b>' });
  assert.equal((await p).ok, false);
  assert.equal(h.panel.hidden, false);
  assert.match(h.panel.children[0].textContent, /4H: <b>API unavailable<\/b>/);
  const retry = h.panel.children[1].click();
  assert.equal(h.requests[1].options.timeframe, '4H');
  assert.equal(h.panel.children[1].disabled, true);
  h.reply(1, 100);
  assert.equal((await retry).ok, true);
  assert.equal(h.panel.hidden, true);
  assert.equal(h.panel.children[1].disabled, false);
  assert.equal(h.timeframe(), '4H');
  assert.ok(h.writes.some(x => x[0] === 'toolbar' && x[1] === '4H'));
});
test('initial rejection becomes visible error; stale rejection cannot overwrite newer success', async () => {
  const h = harness(), first = h.reload('1H');
  h.requests[0].reject(new Error('Network unavailable'));
  assert.equal((await first).ok, false);
  assert.match(h.panel.children[0].textContent, /Network unavailable/);
  assert.equal(h.panel.hidden, false);
  const old = h.reload('4H'), latest = h.reload('1D');
  h.reply(2, 300); await latest;
  h.requests[1].reject(new Error('Late failure'));
  assert.equal((await old).ignored, true);
  assert.equal(h.panel.hidden, true);
  assert.equal(h.timeframe(), '1D');
});
