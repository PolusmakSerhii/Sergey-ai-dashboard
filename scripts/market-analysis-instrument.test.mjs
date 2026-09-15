import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
test('Scanner detail request explicitly uses SWAP for the selected symbol', async () => {
  const start = source.indexOf('async function openCoinModal(symbol)');
  const request = source.slice(start).match(/const response = await fetch\(\s*`https:\/\/sergey-ai-trader-api\.vercel\.app\/api\/market\?symbol=\$\{symbol\}[^`]*`\s*\);/);
  assert.ok(request, 'single-market request must exist in openCoinModal');
  for (const symbol of ['PENDLEUSDT', 'BTCUSDT']) {
    const calls = [];
    const context = vm.createContext({symbol, fetch: async url => { calls.push(new URL(url)); return {}; }});
    await vm.runInContext(`(async () => { ${request[0]} })()`, context);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].searchParams.get('symbol'), symbol);
    assert.equal(calls[0].searchParams.get('instrumentType'), 'SWAP');
  }
});
