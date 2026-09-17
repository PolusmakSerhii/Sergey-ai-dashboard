import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const a = html.indexOf('    function getAnalysisDiagnosticDisplay(');
const b = html.indexOf('    async function openCoinModal(', a);
assert.ok(a >= 0 && b > a);
const c = vm.createContext({});
vm.runInContext(html.slice(a,b),c);
const fixture = direction => ({ direction, summary:`${direction==='Long'?'BUY':'SELL'} setup confirmed.`,
  recommendation:{status:`Valid ${direction} Setup`,confidence:89,
    entryTiming:{status:'Execute in Entry Zone',priority:'High',instruction:'Execute in Entry Zone'},risk:'Low'}});
const display = options => c.getAnalysisDiagnosticDisplay(options);
for (const confirmedAPlus of [false,undefined]) test(`Grade A Long Buy with gate ${confirmedAPlus} shows analysis only`,()=>{
  const input={...fixture('Long'),grade:'A',confirmedAPlus:false,execution:{title:'WAIT CONFIRMATION'}};
  input.confirmedAPlus=confirmedAPlus;input.recommendation.action='Buy';const before=JSON.stringify(input);
  const output=display(input);
  const wording=[output.summary,output.recommendation.status,...Object.values(output.recommendation.entryTiming),output.recommendation.risk].join(' ');
  assert.doesNotMatch(wording,/confirmed|execute|Valid Long Setup|Valid Short Setup/i);
  assert.match(wording,/Bullish candidate/);assert.match(wording,/No new entry permission/);
  assert.equal(output.recommendation.confidence,89);assert.equal(JSON.stringify(input),before);
});
for(const direction of ['Long','Short']) for(const title of ['READY TO ENTER','WAIT FOR ENTRY']) test(`${direction} canonical A+ ${title} preserves wording`,()=>{
  const input={...fixture(direction),confirmedAPlus:true,execution:{title}},output=display(input);
  assert.equal(output.summary,input.summary);assert.equal(output.recommendation,input.recommendation);
});
for(const title of ['WAIT CONFIRMATION','WATCH','EXPIRED','INVALIDATED']) test(`${title} does not display entry permission even with live confirmation`,()=>{
  const output=display({...fixture('Long'),confirmedAPlus:true,execution:{title}});
  assert.doesNotMatch(JSON.stringify(output),/setup confirmed|Execute in Entry Zone|Valid Long Setup/);
  assert.equal(output.recommendation.entryTiming.status,title);
});
test('existing Active remains management-only when live confirmation is lost',()=>{
  const output=display({...fixture('Short'),confirmedAPlus:false,execution:{title:'ACTIVE TRADE'}});
  assert.match(output.summary,/frozen plan/);assert.equal(output.recommendation.entryTiming.status,'ACTIVE TRADE');
});
test('actual legacy HTML blocks consume display values instead of raw backend wording',()=>{
  const start=html.indexOf('${diagnosticDisplay.summary ? `'),end=html.indexOf('${tradeStatistics.confidence',start);
  assert.ok(start>0&&end>start);const block=html.slice(start,end);
  assert.ok(block.includes('${diagnosticDisplay.recommendation.status}'));
  assert.doesNotMatch(block,/\$\{(?:aiSummary|recommendation\.)/);
  const call=html.slice(html.indexOf('const diagnosticDisplay ='),html.indexOf('const diagnosticDisplay =')+300);
  assert.match(call,/confirmedAPlus: data\.technical\?\.confirmedAPlus/);
  assert.match(call,/execution: tradeExecutionStatus/);
});
test('inline frontend scripts parse',()=>{
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(/\bsrc\s*=/.test(match[1])||/application\/ld\+json/.test(match[1]))continue;
    new vm.Script(match[2]);
  }
});
