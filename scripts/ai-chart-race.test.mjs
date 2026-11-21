import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source = await readFile(new URL('../ai-chart.js', import.meta.url), 'utf8');
function harness(realToolbar = false) {
  const timers = new Map(); let timerId = 0;
  const requests = [], writes = [], errors = [];
  const element = () => ({ style: {}, dataset: {}, children: [], hidden: false,
    setAttribute() {}, appendChild(child) { this.children.push(child); },
    addEventListener(name, callback) { this[name] = callback; } });
  const chartContainer = element();
  const layer = name => ({
    applyOptions: value => writes.push([name, 'options', value]),
    setData: value => writes.push([name, 'data', value])
  });
  const c = vm.createContext({
    setTimeout: (fn, ms) => { assert.equal(ms, 250); timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    window: { SergeyMarketData: { getCandles: options => new Promise((resolve, reject) => requests.push({ options, resolve, reject })) } },
    console: { log() {}, error: (...args) => errors.push(args), warn: (...args) => errors.push(args) },
    chart: { timeScale: () => ({ fitContent: () => writes.push(['fit']), setVisibleLogicalRange: value => writes.push(['range', value]) }) },
    candlestickSeries: layer('candles'), ema20Series: layer('ema20'),
    ema50Series: layer('ema50'), ema200Series: layer('ema200'), volumeSeries: layer('volume'), title: {}, loading: {}, symbol: 'TESTUSDT',
    document: { createElement: element }, chartContainer,
    timeframeToolbar: { setActiveTimeframe: value => writes.push(['toolbar', value]) },
    chartLegend: { setValues: value => writes.push(['legend', value]) }
  });
  vm.runInContext(source, c);
  const a = source.indexOf('  let activeTimeframe = "1H";');
  const b = source.indexOf('const timeframeToolbar =', a);
  assert.ok(a > 0 && b > a);
  vm.runInContext(source.slice(a, realToolbar ? source.indexOf('chartContainer.prepend', b) : b), c);
  const reply = (index, base) => requests[index].resolve({ ok: true, source: 'fixture',
    candles: Array.from({ length: 220 }, (_, i) => ({ time: 1700000000 + i * 60,
      open: base + i, high: base + i + 2, low: base + i - 1, volume: i, close: base + i + 1 })) });
  return { c, requests, writes, errors, reply, reload: c.reloadTimeframe,
    toolbar: realToolbar ? vm.runInContext("timeframeToolbar", c) : null,
    flush: async () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); await Promise.resolve(); },
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


test('user switch waits 250ms; initial load and retry remain immediate', async () => {
  const h = harness(true), initial = h.reload('1H');
  assert.equal(h.requests.length, 1); h.reply(0, 100); await initial;
  const click = h.toolbar.buttons.get('4H').click();
  assert.equal(h.requests.length, 1);
  await h.flush(); assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].options.timeframe, '4H');
  h.reply(1, 200); await click; assert.equal(h.toolbar.activeTimeframe, '4H');
  const fail = h.reload('4H'); h.requests[2].resolve({ok:false,error:'offline'}); await fail;
  const retry = h.panel.children[1].click();
  assert.equal(h.requests.length, 4); h.reply(3, 200); await retry;
});
test('rapid toolbar clicks send only 1D; ignored switch does not roll back button', async () => {
  const h = harness(true), initial = h.reload('1H'); h.reply(0,100); await initial;
  const a = h.toolbar.buttons.get('4H').click();
  const b = h.toolbar.buttons.get('1D').click();
  await a; assert.equal(h.toolbar.activeTimeframe,'1D');
  assert.equal(h.requests.length,1);
  await h.flush(); assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].options.timeframe,'1D');
  h.reply(1,300); await b;
  assert.equal(h.toolbar.activeTimeframe,'1D'); assert.equal(h.timeframe(),'1D');
  assert.deepEqual(h.errors,[]);
});
test('new selection invalidates in-flight response during debounce', async () => {
  const h = harness(true), initial = h.reload('1H');
  const click = h.toolbar.buttons.get('1D').click();
  h.reply(0,100); assert.equal((await initial).ignored,true);
  assert.deepEqual(h.writes,[]); assert.equal(h.toolbar.activeTimeframe,'1D');
  await h.flush(); h.reply(1,300); await click;
  assert.equal(h.timeframe(),'1D'); assert.deepEqual(h.errors,[]);
});
test('failure after superseded debounce rolls back to loaded timeframe', async () => {
  const h = harness(true), initial = h.reload('1H'); h.reply(0,100); await initial;
  const a = h.toolbar.buttons.get('4H').click(), b = h.toolbar.buttons.get('1D').click();
  await a; await h.flush(); h.requests[1].resolve({ok:false,error:'offline'}); await b;
  assert.equal(h.toolbar.activeTimeframe,'1H'); assert.equal(h.timeframe(),'1H');
  assert.equal(h.toolbar.buttons.get('4H').disabled,false);
  assert.equal(h.toolbar.buttons.get('1D').disabled,false);
});

for (const count of [240, 300]) {
  test(count + ' candles: sorted, last duplicate wins, missing volume stays missing', async () => {
    const h = harness(), pending = h.reload('5m');
    const rows = Array.from({ length: count }, (_, i) => ({
      time: 1000 + i, open: 10, high: 12, low: 8, close: 11, volume: i
    })).reverse();
    rows.push({ ...rows[0], close: 9, volume: '42' }, { ...rows[1], volume: null },
      { ...rows[2], volume: Infinity }, { ...rows[3], volume: '' }, { time: NaN });
    h.requests[0].resolve({ ok: true, candles: rows }); await pending;
    const data = name => h.writes.find(x => x[0] === name && x[1] === 'data')[2];
    assert.deepEqual(Array.from(data('candles'), c => c.time), Array.from({length:count}, (_, i) => 1000+i));
    const volumes = data('volume');
    assert.equal(volumes.length, count-3);
    assert.equal(volumes[0].value, 0);
    assert.equal(volumes.at(-1).time, 999+count);
    assert.equal(volumes.at(-1).value, 42);
    assert.notEqual(volumes.at(-1).color, volumes[0].color);
    for (const period of [20,50,200]) {
      assert.equal(data('ema'+period).length, count-period+1);
      assert.equal(data('ema'+period)[0].value, 11);
    }
  });
}
test('late success and empty latest dataset preserve loaded header, series and EMA legend', async () => {
  const h=harness(), first=h.reload('1H'); h.reply(0,100); await first;
  const before=structuredClone(h.writes), old=h.reload('4H'), next=h.reload('15m');
  assert.equal(h.c.title.textContent,'TESTUSDT · 1H');
  assert.match(h.c.loading.textContent,/15m/);
  h.requests[2].resolve({ok:true,candles:[]}); assert.equal((await next).ok,false);
  h.reply(1,200); assert.equal((await old).ignored,true);
  assert.deepEqual(structuredClone(h.writes),before);
  assert.equal(h.c.title.textContent,'TESTUSDT · 1H'); assert.equal(h.panel.hidden,false);
});

test('narrow chart shows recent candles without discarding history, EMA or volume', async () => {
  const h = harness(); h.c.chartContainer.clientWidth = 260;
  const p = h.reload('1H'); h.reply(0, 100);
  assert.equal((await p).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes.find(x => x[0] === 'range')[1])), {from:180,to:222});
  assert.equal(h.writes.find(x => x[0] === 'candles' && x[1] === 'data')[2].length, 220);
  assert.equal(h.writes.find(x => x[0] === 'volume' && x[1] === 'data')[2].length, 220);
  assert.equal(h.requests[0].options.limit, 300);
  assert.equal(h.writes.filter(x => x[0] === 'fit').length, 0);
});
