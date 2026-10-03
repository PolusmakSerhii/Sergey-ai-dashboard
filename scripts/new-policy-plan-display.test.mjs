import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const overview=readFileSync(new URL('../coin-overview.js',import.meta.url),'utf8');
const source=html.slice(html.indexOf('    function renderPartialPosition('),html.indexOf('    function renderActiveTrades('));
const NEW='tp1-50-reanalyse-v1', LEGACY='partial-25-25-50-be-v1';
function fixture(version,direction='Long') {
 const short=direction==='Short';
 return {direction,initialPlan:{initialStopLoss:short?110:90,takeProfit1:short?80:120,takeProfit2:short?60:140,takeProfit3:short?40:160,exitStrategy:{version,allocations:version===NEW?{TP1:.5}:{TP1:.25,TP2:.25,TP3:.5}}},outcome:{entryPrice:100,currentStopLoss:100,markPrice:short?90:110,priceCheck:{status:'verified'},remainingPosition:.5,realizedR:.75,unrealizedR:.2,totalR:.95,exits:[]}};
}
function render(signal) {const c={renderTradeVerification:()=>''};vm.runInNewContext(source,c);return c.renderPartialPosition(signal);}
for(const direction of ['Long','Short'])test(`${direction}: new targets, scale and R displays are read-only`,()=>{
 const signal=fixture(NEW,direction),before=structuredClone(signal),out=render(signal);
 assert.match(out,/TP1 · 50%/);assert.doesNotMatch(out,/TP2|TP3|After TP2/);
 assert.equal((out.match(/partial-target"/g)||[]).length,1);
 assert.match(out,/After TP1: 50% realized · SL → Break Even · Re-analysis → HOLD \/ CLOSE/);
 for(const label of ['Initial SL','Current SL','Actual Entry','Verified price','Position remaining','Realized R','Unrealized R','Total R'])assert.ok(out.includes(label));
 for(const value of ['+0.75R','+0.2R','+0.95R'])assert.ok(out.includes(value));
 const marker=out.match(/partial-stop" style="left:([^%]+)%/);assert.ok(Math.abs(Number(marker[1])-(direction==='Long'?100/3:200/3))<1e-10);
 signal.initialPlan.takeProfit2=10000;signal.initialPlan.takeProfit3=-10000;assert.equal(render(signal),out);
 signal.initialPlan.takeProfit2=before.initialPlan.takeProfit2;signal.initialPlan.takeProfit3=before.initialPlan.takeProfit3;assert.deepEqual(signal,before);
 signal.outcome.entryPrice=direction==='Long'?80:130;signal.outcome.currentStopLoss=signal.outcome.entryPrice;
 assert.match(render(signal),new RegExp(`partial-stop" style="left:${direction==='Long'?0:100}%`));
});
for(const version of [LEGACY,undefined,'unknown'])test(`${version}: existing target display and explanation retained`,()=>{
 const out=render(fixture(version));
 for(const text of ['TP1 · 25%','TP2 · 25%','TP3 · 50%','After TP1: SL = actual Entry. After TP2: SL unchanged.'])assert.ok(out.includes(text));
 assert.equal((out.match(/partial-target"/g)||[]).length,3);
 assert.match(out,/partial-stop" style="left:14.285714285714285%/);
});
function lower(isTp1ReanalysisPlan){const start=html.indexOf('<div class="coin-detail-card trade-plan-target">',html.indexOf('<div id="coin-trade-plan-section">'));const end=html.indexOf('<div class="coin-detail-card trade-plan-risk">',start);return vm.runInNewContext('`'+html.slice(start,end)+'`',{isTp1ReanalysisPlan,tradePlan:{takeProfit1:120,takeProfit2:140,takeProfit3:160}});}
test('lower cards conditionally render TP1 50% only, legacy keeps three',()=>{
 assert.match(lower(true),/TP1 · 50%/);assert.doesNotMatch(lower(true),/TP2|TP3/);
 for(const target of ['TP1','TP2','TP3'])assert.ok(lower(false).includes(`>${target}</div>`));
 assert.match(html,/const frozenExitPolicyVersion = trackedPlanIsCurrent \? trackedPlan.exitStrategy\?\.version : undefined/);
 assert.match(html,/const isTp1ReanalysisPlan = frozenExitPolicyVersion === "tp1-50-reanalyse-v1"/);
 assert.match(html,/SergeyCoinOverview.render\(\{data, ranking: scannerCoin, plan: tradePlan, tracked: trackedPlanIsCurrent, frozenExitPolicyVersion,/);
});
test('overview hides targets only for explicit frozen policy, never plan shape or tracked flag',()=>{
 const c={window:{}};vm.runInNewContext(overview,c);
 const plan={entryZone:{from:99,to:101},stopLoss:90,takeProfit1:120,takeProfit2:140,takeProfit3:160,exitStrategy:{version:NEW}};
 const before=structuredClone(plan);
 for(const version of [NEW,LEGACY,undefined,'unknown']){
  const out=c.window.SergeyCoinOverview.render({plan,tracked:true,frozenExitPolicyVersion:version});
  assert.ok(out.includes('Цель 1'));
  for(const label of ['Цель 2','Цель 3'])assert.equal(out.includes(label),version!==NEW);
 }
 assert.deepEqual(plan,before);
});
