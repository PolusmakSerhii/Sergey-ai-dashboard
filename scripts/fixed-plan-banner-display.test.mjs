import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const slice=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const geometry=slice('    const OPEN_TRACKED_TRADE_STATUSES =','    function cacheTrackedTradeSignals(');
const bindings=slice('const trackedStatus =\n','const tradePlan = trackedPlanIsCurrent');
const template=slice('${trackedPlanIsCurrent ? `','${!hasValidTrade ? `');
function render(signal){
 const before=JSON.stringify(signal),c={trackedSignal:signal,renderPartialPosition:()=>'',renderTradeVerification:()=>''};
 vm.runInNewContext(geometry+bindings+';result = `'+template+'`;',c);
 assert.equal(JSON.stringify(signal),before);return c.result;
}
const fixture=(version='tp1-50-reanalyse-v1',status='Active')=>({
 direction:'Long',initialPlan:{entryZone:{from:100,to:101},stopLoss:90,takeProfit1:110,takeProfit2:120,takeProfit3:130,...(version===null?{}:{exitStrategy:{version}})},
 outcome:{status}
});
const newCopy='Entry Zone, initial Stop Loss, TP1 and exit policy are fixed; current SL follows that policy.';
const legacyCopy='Entry Zone, initial Stop Loss, targets and exit policy are fixed; current SL follows that policy.';
for(const [state,ru] of [['Active','Активен'],['WaitingEntry','Ожидает входа'],['Pending','В ожидании']])test(state+' exact new policy bilingual banner',()=>{
 const out=render(fixture(undefined,state));
 assert.ok(out.includes('Fixed Trade Plan · '+state));assert.ok(out.includes('Зафиксированный торговый план · '+ru));
 assert.ok(out.includes(newCopy));assert.ok(out.includes('Зона входа, начальный Stop Loss, TP1 и правила выхода зафиксированы. Текущий Stop Loss определяется этими правилами.'));
 assert.doesNotMatch(out,/TP2|TP3|HOLD|CLOSE/);
});
for(const policy of ['partial-25-25-50-be-v1','unknown'])test(policy+' preserves targets',()=>{
 const out=render(fixture(policy));assert.ok(out.includes(legacyCopy));assert.ok(out.includes('Зона входа, начальный Stop Loss, цели и правила выхода зафиксированы. Текущий Stop Loss определяется этими правилами.'));assert.ok(!out.includes(newCopy));
});
test('missing policy object preserves locked fallback',()=>{
 const out=render(fixture(null));assert.ok(out.includes('Entry Zone, Stop Loss and targets are locked.'));assert.ok(out.includes('Зона входа, Stop Loss и цели зафиксированы.'));
});
for(const decision of ['HOLD','CLOSE'])test(decision+' stays Active and source unchanged',()=>{
 const f=fixture();Object.assign(f.outcome,{remainingPosition:.5,reanalysisPending:true,lastReanalysis:{decision,executionStatus:'pending'}});
 assert.ok(render(f).includes('Fixed Trade Plan · Active'));
});
for(const status of ['Closed','Stopped','TP3Hit','Expired',null])test(status+' does not gain banner',()=>assert.equal(render(fixture(undefined,status)).trim(),''));
test('invalid geometry does not gain banner',()=>{
 const f=fixture();f.initialPlan.takeProfit2=95;assert.equal(render(f).trim(),'');
});
test('WATCH and scoped style remain independent; no requests in presentation',()=>{
 const watch=slice('${!hasValidTrade ? `','${hasValidTrade ? `');
 assert.ok(watch.includes('<strong>Trade Status: WATCH</strong><br>'));assert.ok(watch.includes('${rejectionReason}'));assert.doesNotMatch(watch,/coin-analysis-ru/);
 assert.match(html,/#coin-analysis-content \.coin-analysis-ru \{[^}]*font-size:11px/);
 assert.match(bindings,/frozenExitPolicyVersion === "tp1-50-reanalyse-v1"/);
 assert.doesNotMatch(template,/fetch|\.push\(|\.status\s*=|takeProfit\d\s*=/);
});
