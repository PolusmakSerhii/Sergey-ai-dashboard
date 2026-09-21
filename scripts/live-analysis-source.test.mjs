import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const overview=readFileSync(new URL('../coin-overview.js',import.meta.url),'utf8');
function run(data, ranking={opportunityScore:86,opportunityGrade:'A',action:'Buy'}, options={}){
 const c={data,scannerCoin:ranking,window:{}};
 const start=html.indexOf('const probability =',html.indexOf('const scannerCoin ='));
 const end=html.indexOf('const liveTradePlan =',start);
 const a=html.indexOf('       const action =',html.indexOf('const diagnosticDisplay ='));
 const b=html.indexOf('  coinDetails.innerHTML',a);
 vm.runInNewContext(html.slice(start,end)+html.slice(a,b)+';globalThis.values={probability,direction,grade,opportunityScore,action,recommendationConfidence};',c);
 vm.runInNewContext(overview,c);
 return {values:c.values,markup:c.window.SergeyCoinOverview.render({data,ranking,...options})};
}
const plan={validTrade:true,direction:'Long',entryZone:{from:99,to:101},stopLoss:90,takeProfit1:110,takeProfit2:120,takeProfit3:130};
test('fresh live 88/A+/Strong Buy replaces old ranking 86/A/Buy and permits existing execution',()=>{
 const data={technical:{opportunityScore:88,opportunityGrade:'A+',confirmedAPlus:true,probability:{confidence:{score:97},direction:'Long'},recommendation:{action:'Strong Buy',confidence:77},tradePlan:plan}};
 const r=run(data);assert.equal(r.values.opportunityScore,88);assert.equal(r.values.grade,'A+');assert.equal(r.values.action,'Strong Buy');assert.equal(r.values.probability,97);assert.equal(r.values.recommendationConfidence,77);
 assert.match(r.markup,/Текущий Grade: A\+ ★/);assert.match(r.markup,/Confirmed A\+/);assert.doesNotMatch(r.markup,/>86</);
 const c={};vm.runInNewContext(html.slice(html.indexOf('    function getTradeExecutionStatus('),html.indexOf('    function getAnalysisDiagnosticDisplay(')),c);
 assert.equal(c.getTradeExecutionStatus({confirmedAPlus:true,liveTradePlan:plan,tradePlan:plan,hasValidTrade:true,price:100}).title,'READY TO ENTER');
});
test('unconfirmed live values stay unconfirmed',()=>{
 const r=run({technical:{opportunityScore:86,opportunityGrade:'A',confirmedAPlus:false,recommendation:{action:'Buy'}}});
 assert.equal(r.values.grade,'A');assert.equal(r.values.action,'Buy');assert.match(r.markup,/Ожидает подтверждения/);assert.doesNotMatch(r.markup,/Confirmed A\+/);
});
test('missing live fields never borrow ranking values',()=>{
 const r=run({technical:{confirmedAPlus:false}});
 for(const value of Object.values(r.values))assert.equal(value,'—');
 assert.doesNotMatch(r.markup,/>86</);assert.match(r.markup,/Текущий Grade: —/);
});
test('actual modal template uses live bindings and syntax parses',()=>{
 const modal=html.slice(html.indexOf('const diagnosticDisplay ='),html.indexOf('async function',html.indexOf('const diagnosticDisplay =')));
 for(const name of ['opportunityScore','grade','action'])assert.ok(modal.includes('${'+name+'}'));
 assert.doesNotMatch(modal,/opportunityScore >= 90/);
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=|application\/ld\+json/.test(m[1]))new vm.Script(m[2]);
 new vm.Script(overview);
});

 test('88/A/false separates numerical threshold from canonical confirmation',()=>{
 const r=run({technical:{opportunityScore:88,opportunityGrade:'A',confirmedAPlus:false}});
 assert.match(r.markup,/Текущий Grade: A<\/span>/);
 assert.match(r.markup,/✓ Числовой порог A\+ достигнут/);
 assert.match(r.markup,/⚠ A\+ не подтверждён/);
 assert.doesNotMatch(r.markup,/Confirmed A\+|Все условия A\+ подтверждены/);
 });
 for(const flag of [undefined,null,'true',1]) test(`unavailable confirmation ${String(flag)} never confirms`,()=>{
 const r=run({technical:{opportunityScore:88,opportunityGrade:'A+',confirmedAPlus:flag}});
 assert.match(r.markup,/Подтверждение A\+ недоступно/);
 assert.doesNotMatch(r.markup,/Confirmed A\+|Все условия A\+ подтверждены|A\+ ★/);
 });
 test('inconsistent A+/false preserves backend grade without confirmation',()=>{
 const r=run({technical:{opportunityScore:88,opportunityGrade:'A+',confirmedAPlus:false}});
 assert.match(r.markup,/Текущий Grade: A\+<\/span>/);
 assert.match(r.markup,/Несогласованные данные/);
 assert.match(r.markup,/A\+ не подтверждён/);
 assert.doesNotMatch(r.markup,/Confirmed A\+|A\+ ★/);
 });
 test('ranking A+ cannot replace fresh live A',()=>{
 const r=run({technical:{opportunityScore:88,opportunityGrade:'A',confirmedAPlus:false}},
 {opportunityScore:95,opportunityGrade:'A+',confirmedAPlus:true});
 assert.equal(r.values.grade,'A');assert.match(r.markup,/Текущий Grade: A<\/span>/);
 assert.doesNotMatch(r.markup,/Confirmed A\+|Текущий Grade: A\+/);
 });
 test('modal labels ranking preview separately from fresh live values',()=>{
 const modal=html.slice(html.indexOf('    async function openCoinModal('));
 assert.match(modal,/Ranking snapshot · предварительные данные/);
 assert.match(modal,/Fresh Live Analysis · текущие Score и Grade/);
 });
 test('saved plan remains separate from unconfirmed current live grade',()=>{
 const frozen={...plan,stopLoss:80};const before=JSON.stringify(frozen);
 const r=run({technical:{opportunityScore:88,opportunityGrade:'A',confirmedAPlus:false}}, {},
 {tracked:true,plan:frozen,execution:{title:'ACTIVE TRADE'}});
 assert.match(r.markup,/Сохранённый план сделки/);assert.match(r.markup,/Текущий Grade: A<\/span>/);
 assert.match(r.markup,/Уровни сохранённого плана/);assert.equal(JSON.stringify(frozen),before);
 });
