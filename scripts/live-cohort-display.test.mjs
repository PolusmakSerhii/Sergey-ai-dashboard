import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../trade-journal.js',import.meta.url),'utf8');
const c={window:{},document:{visibilityState:"visible",querySelector:()=>null}};vm.runInNewContext(source,c);
const api=c.window.Sm1mTradeJournal;
const rec=(time,status='Closed',value=1)=>({tradeId:time,cohort:'forward',origin:{detectedAt:time,direction:'Long'},initialPlan:{createdAt:time,exitStrategy:{version:'tp1-50-reanalyse-v1'}},outcome:{status,resultR:value,checkedAt:'2026-10-14T00:00:00Z'}});
for(const [time,cohort] of [['2026-10-11T20:59:59.999Z','PRE-LIVE'],['2026-10-11T21:00:00.000Z','LIVE'],['2026-10-11T21:00:00.001Z','LIVE'],[null,'UNKNOWN'],['invalid','UNKNOWN']])test('boundary '+time,()=>assert.equal(api.classifyLiveCohort(rec(time)).cohort,cohort));
test('equivalent instants accepted; conflict rejected; alternate dates never replace origin',()=>{
 const r=rec('2026-10-11T21:00:00Z');r.initialPlan.createdAt='2026-10-12T00:00:00+03:00';assert.equal(api.classifyLiveCohort(r).cohort,'LIVE');
 r.initialPlan.createdAt='2026-10-12T00:00:00Z';assert.equal(api.classifyLiveCohort(r).cohort,'UNKNOWN');
 r.origin.detectedAt=null;r.createdAt='2026-10-12T00:00:00Z';assert.equal(api.classifyLiveCohort(r).cohort,'UNKNOWN');
});
for(const [value,label] of [[1,'WIN'],[-1,'LOSS'],[0,'BREAK EVEN'],[null,'N/A'],[undefined,'N/A'],[Infinity,'N/A']])test('Closed '+value,()=>{
 const r=rec('2026-10-12T00:00:00Z','Closed',value);if(value===undefined)delete r.outcome.resultR;
 assert.equal(api.result(r).label,label);assert.equal(api.summarize([r,r]).completed,label==='N/A'?0:1);
});

class Element {
  constructor(){this.children=[];this.dataset={};this.listeners={};this.value='';}
  set textContent(v){this.value=String(v);} get textContent(){return this.value+' '+this.children.map(c=>c.textContent).join(' ');}
  append(...children){this.children.push(...children);} replaceChildren(...children){this.value='';this.children=children;}
  setAttribute(key,value){this[key]=value;}
  addEventListener(type,fn){this.listeners[type]=fn;}
}
const descendants=e=>[e,...e.children.flatMap(descendants)];
const summary=(total=0)=>({total,completed:total,active:0,wins:total,losses:0,breakEvens:0,winRate:null,netR:0,averageR:null,expectancy:null,profitFactor:null,maxDrawdownR:0,currentLossStreak:0,maxLossStreak:0,directions:{Long:{count:0,wins:0,netR:0},Short:{count:0,wins:0,netR:0}}});
const cohorts=()=>({startAt:'2026-10-11T21:00:00.000Z',basis:'canonical-modelled',coverage:'available-archive-records',summaries:{'PRE-LIVE':{...summary(7),netR:12.345,winRate:17.3,averageR:4.56,expectancy:8.9},LIVE:summary(),UNKNOWN:summary()}});
const operational=(s=summary(7))=>({startAt:'2026-11-01T22:00:00.000Z',originField:'origin.detectedAt',basis:'canonical-modelled',coverage:'available-archive-records',summary:s});
function uiRuntime(elements={}){const c={window:{},document:{visibilityState:"visible",querySelector:key=>elements[key]||null,createElement:()=>new Element()},AbortSignal};vm.runInNewContext(source,c);return c.window.Sm1mTradeJournal;}
const ui=uiRuntime();
const button=(root,label)=>descendants(root).find(e=>e.type==='button'&&e.value===label);
test('performance uses only operational pure summary, no toggle; history untouched',()=>{
 const data=operational({...summary(7),netR:12.345,winRate:17.3,averageR:4.56,expectancy:8.9});
 const root=new Element(),state={liveCohorts:cohorts(),operationalCohort:data,records:new Map(),outcomes:{netR:999}};const before=JSON.stringify(state);
 ui.renderPerformance(root,state);
 for(const t of ['7','+12.35R','17.3%','+4.56R','+8.9R','Canonical/modelled','not confirmed exchange P&L','history completeness is not guaranteed','LIVE TRADING · FROM 02 NOV 2026'])assert.ok(root.textContent.includes(t),t);
 assert.equal(button(root,'PRE-LIVE'),undefined);assert.equal(button(root,'LIVE · FROM 12 OCT 2026'),undefined);assert.equal(root.performanceCohort,undefined);
 assert.equal(JSON.stringify(state),before);
});
for(const variant of ['missing','bad boundary','bad origin field','bad count','error'])test('unavailable is not zero: '+variant,()=>{
 const root=new Element(),state={operationalCohort:operational()};
 if(variant==='missing')delete state.operationalCohort;
 if(variant==='bad boundary')state.operationalCohort.startAt='bad';
 if(variant==='bad origin field')state.operationalCohort.originField='completedAt';
 if(variant==='bad count')state.operationalCohort.summary.completed=null;
 if(variant==='error')state.error=true;
 ui.renderPerformance(root,state);assert.match(root.textContent,/Statistics temporarily unavailable/);assert.ok(!descendants(root).some(e=>e.className==='journal-fields'));
});
const rows = n => Array.from({length:n},(_,i)=>({...rec('2026-11-02T00:00:00Z'),tradeId:String(i).padStart(4,'0')}));
function page(records,offset=0) { return {ok:true,initialized:true,schemaVersion:1,rulesRevision:'canonical-trade-archive-v1',validationStartAt:'2026-09-22T00:00:00Z',boundaryPolicy:'test',offset,limit:100,totalArchived:records.length,nextOffset:offset+100<records.length?offset+100:null,records:records.slice(offset,offset+100)}; }
const response = data => ({ok:true,json:async()=>data});
test('two independent complete passes >100, no partial summary or concurrent GET; completed clicks reuse load',async()=>{
 let calls=0; const data=rows(101), states=[];
 const store=ui.createOperationalStore(async url=>{calls++; assert.equal(store.state.operationalCohort,null); return response(page(data,Number(new URL(url).searchParams.get('offset'))));},state=>states.push(Boolean(state.operationalCohort)));
 const loading=store.load(); await store.load(); await loading;
 assert.equal(calls,4);assert.equal(store.state.records.size,101);assert.equal(store.state.operationalCohort.summary.completed,101);
 assert.equal(states.filter(Boolean).length,1);await store.load();assert.equal(calls,4);
});
for(const variant of ['duplicate','next','total','schema','page failure','unstable'])test('full-load rejects '+variant,async()=>{
 let calls=0; const data=rows(101);
 const store=ui.createOperationalStore(async url=>{calls++;const offset=Number(new URL(url).searchParams.get('offset'));const p=page(data,offset);
 if(variant==='duplicate'&&offset===100)p.records=[data[0]];
 if(variant==='next')p.nextOffset=1;
 if(variant==='total'&&offset===100)p.totalArchived=102;
 if(variant==='schema')p.rulesRevision='invalid';
 if(variant==='page failure'&&offset===100)throw Error('offline');
 if(variant==='unstable'&&calls===4)p.records=[{...data[100],outcome:{...data[100].outcome,resultR:5}}];
 return response(p);},()=>{});
 await store.load();assert.equal(store.state.error,true);assert.equal(store.state.operationalCohort,null);assert.equal(store.state.records.size,0);assert.ok(calls<=4);
});
test('stable empty archive is valid zero state only after both passes',async()=>{
 let calls=0;const store=ui.createOperationalStore(async()=>{calls++;return response(page([]));},()=>{});await store.load();
 assert.equal(calls,2);assert.equal(store.state.error,false);assert.equal(store.state.operationalCohort.summary.total,0);
});
test('old Statistics loader cannot overwrite cohorts; no periodic archive load; gated script and scoped CSS',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const loader=html.slice(html.indexOf('async function loadStatisticsOverview()'),html.indexOf('function renderRankingFreshness()'));
 assert.doesNotMatch(loader,/statistics-trade-analytics|renderTradeAnalytics|liveCohorts|#statistics-win-rate|#statistics-outcomes|#statistics-profit-factor|#statistics-r-performance/);
 assert.match(html,/data-private-dashboard data-private-src="\.\/trade-journal.js"/);
 assert.doesNotMatch(source,/setInterval|setTimeout/);
 const css=readFileSync(new URL('../trade-journal.css',import.meta.url),'utf8');assert.match(css,/\.cohort-controls[^}]*flex-wrap: wrap/);assert.match(css,/\.cohort-ru/);
});
test('redesigned performance: six live KPIs, drawdown magnitude, details and honest directional values',()=>{
 const root=new Element(),data=operational(),s=data.summary;
 Object.assign(s,{completed:19,active:3,winRate:42.1,netR:-6.123,profitFactor:0.73,maxDrawdownR:17.19});
 s.directions.Long={count:4,wins:2,netR:3};s.directions.Short={count:0,wins:0,netR:0};
 const before=JSON.stringify(data);ui.renderPerformance(root,{operationalCohort:data});
 const kpis=descendants(root).find(e=>e.className==='performance-kpis');
 assert.equal(kpis.children.length,6);
 assert.deepEqual(kpis.children.map(e=>e.children[1].textContent.trim()),['19','42.1%','-6.12R','0.73','17.19R','3']);
 assert.doesNotMatch(kpis.textContent,/\+17.19R/);
 const long=descendants(root).find(e=>e.className==='performance-direction is-long');
 assert.match(long.textContent,/LONG TRADES/);assert.match(long.textContent,/50.0%/);assert.match(long.textContent,/\+0.75R/);
 const loss=descendants(long).find(e=>e.children.length===2 && e.children[0]?.textContent.trim().startsWith('Losses'));assert.equal(loss.children[1].textContent.trim(),'2');
 const short=descendants(root).find(e=>e.className==='performance-direction is-short');assert.doesNotMatch(short.textContent,/Infinity|NaN/);assert.match(short.textContent,/—/);
 assert.match(root.textContent,/DETAILED STATISTICS/);assert.equal(JSON.stringify(data),before);
 ui.renderPerformance(root,{operationalCohort:operational(summary())});assert.match(root.textContent,/LIVE TRADING starts/);
 assert.deepEqual(descendants(root).find(e=>e.className==='performance-kpis').children.map(e=>e.children[1].textContent.trim()),['0','—','0R','—','0R','0']);
});

for (const [side, be, expected] of [
 [{count:6,wins:1,netR:0},0,'5'],
 [{count:6,wins:1,netR:0},1,'N/A'],
 [{count:6,wins:1,netR:0,breakEvens:2},2,'3'],
 [{count:6,wins:1,netR:0,losses:4},1,'4'],
 [{count:6,wins:9,netR:0},0,'N/A']
]) test('directional losses safely resolved '+JSON.stringify(side)+' BE '+be,()=>{
 const data=operational();data.summary.breakEvens=be;data.summary.directions.Long=side;
 const root=new Element();ui.renderPerformance(root,{operationalCohort:data});
 const long=descendants(root).find(e=>e.className==='performance-direction is-long');
 const loss=descendants(long).find(e=>e.children.length===2 && e.children[0]?.textContent.trim().startsWith('Losses'));
 assert.equal(loss.children[1].textContent.trim(),expected==='N/A'?'—':expected);
});

test('A+ overview and all performance sections share one operational summary, with exact empty state',()=>{
 const ids=['#statistics-win-rate','#statistics-outcomes','#statistics-profit-factor','#statistics-r-performance'];
 const els=Object.fromEntries(ids.map(id=>[id,new Element()])),runtime=uiRuntime(els),root=new Element();
 const s={...summary(4),active:2,wins:2,losses:1,breakEvens:1,winRate:50,netR:1,averageR:.25,expectancy:.25,profitFactor:2};
 s.directions.Long={count:3,wins:1,losses:1,breakEvens:1,netR:0};s.directions.Short={count:1,wins:1,losses:0,breakEvens:0,netR:1};
 runtime.renderPerformance(root,{operationalCohort:operational(s),liveCohorts:cohorts()});
 assert.equal(els['#statistics-win-rate'].textContent.trim(),'50.0%');assert.match(els['#statistics-outcomes'].textContent,/Активных: 2 · WIN: 2 · LOSS: 1 · BREAK EVEN: 1/);
 assert.match(root.textContent,/DETAILED STATISTICS/);assert.match(root.textContent,/LONG TRADES/);assert.match(root.textContent,/SHORT TRADES/);assert.match(root.textContent,/LIVE TRADING · FROM 02 NOV 2026/);
 runtime.renderPerformance(root,{operationalCohort:operational(summary())});
 assert.equal(els['#statistics-win-rate'].textContent.trim(),'—');assert.match(els['#statistics-outcomes'].textContent,/Активных: 0 · WIN: 0 · LOSS: 0 · BREAK EVEN: 0/);assert.equal(els['#statistics-profit-factor'].textContent.trim(),'—');
 assert.match(els['#statistics-r-performance'].textContent,/Gross R \(модель\): 0R · Average R: — · Expectancy: — · Drawdown: 0.00R/);
 const details=descendants(root).find(e=>e.className==='performance-secondary');
 assert.deepEqual(details.children.map(e=>e.children[1].textContent.trim()),['0','0','0','—','—','0','0']);
 for(const dir of ['long','short']){const section=descendants(root).find(e=>e.className==='performance-direction is-'+dir);assert.deepEqual(descendants(section).find(e=>e.className==='performance-secondary').children.map(e=>e.children[1].textContent.trim()),['0','0','0','—','0R','—']);}
 runtime.renderPerformance(root,{operationalCohort:operational(s),error:true});assert.equal(els['#statistics-win-rate'].textContent.trim(),'—');assert.match(els['#statistics-outcomes'].textContent,/unavailable/);
});

test('informational sample-size line uses operational completed count; exact label and warning unchanged',()=>{
 const root=new Element(),data=operational({...summary(9),completed:9});
 ui.renderPerformance(root,{operationalCohort:data,liveCohorts:cohorts()});
 assert.match(root.textContent,/Completed: 9 · для оценки нужно ≥30 сделок и ≥15 дней/);
 assert.match(root.textContent,/LIVE TRADING · FROM 02 NOV 2026/);assert.match(root.textContent,/not confirmed exchange P&L/);
 ui.renderPerformance(root,{operationalCohort:operational(summary())});assert.match(root.textContent,/Completed: 0 · для оценки нужно ≥30 сделок и ≥15 дней/);
 assert.equal(button(root,'PRE-LIVE'),undefined);
});

for(const [time,n] of [['2026-11-01T21:59:59.999Z',0],['2026-11-01T22:00:00.000Z',1],['2026-11-01T22:00:00.001Z',1]])test('operational cutoff '+time,()=>assert.equal(api.operationalSummary([rec(time)]).summary.completed,n));
test('origin consistency and pre-cutoff lifecycle excluded; absent createdAt accepted',()=>{
 const data=rows(6);data[0].origin.detectedAt=null;data[1].initialPlan.createdAt='bad';
 data[2].origin.detectedAt=data[2].initialPlan.createdAt='2026-11-01T21:59:59.999Z';data[2].outcome.status='Active';
 data[3].origin.detectedAt=data[3].initialPlan.createdAt='2026-11-01T21:59:59.999Z';
 delete data[4].initialPlan.createdAt;data[5].outcome.status='Active';
 const s=api.operationalSummary(data).summary;assert.equal(s.total,2);assert.equal(s.completed,1);assert.equal(s.active,1);
});
test('pure reducer canonical chronology, lexical ties, BE reset, direction and all R metrics',()=>{
 const data=rows(5);const values=[2,-1,-2,0,999];
 data.forEach((r,i)=>{r.outcome.resultR=values[i];r.outcome.checkedAt=i<2?'2026-11-03T01:00:00Z':`2026-11-03T0${i}:00:00Z`;});
 data[1].origin.direction='Short';data[4].outcome.status='Active';
 const before=JSON.stringify(data),s=api.operationalSummary([...data].reverse()).summary;
 assert.equal(s.completed,4);assert.equal(s.wins,1);assert.equal(s.losses,2);assert.equal(s.breakEvens,1);assert.equal(s.active,1);
 assert.equal(s.netR,-1);assert.equal(s.profitFactor,2/3);assert.equal(s.averageR,-.25);assert.equal(s.expectancy,-.25);
 assert.equal(s.winRate,25);assert.equal(s.maxDrawdownR,3);assert.equal(s.currentLossStreak,0);assert.equal(s.maxLossStreak,2);
 assert.equal(s.directions.Short.losses,1);assert.equal(s.directions.Long.breakEvens,1);assert.equal(JSON.stringify(data),before);
 assert.throws(()=>api.operationalSummary([data[0],data[0]]));
});

test('operational reducer parity with unchanged approved backend canonical reducer',()=>{
 const backend=readFileSync(new URL('../../backend/api/market.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler');
 const context={Date,URL,process:{env:{}},console};vm.runInNewContext(backend,context);
 const data=rows(8);data.forEach((r,i)=>{r.outcome.resultR=[2,-1,-2,0,1,-.5,-1,0][i];r.outcome.checkedAt=`2026-11-03T0${Math.floor(i/2)}:00:00Z`;r.origin.direction=i%2?'Short':'Long';});
 const expected=context.summarizeLiveCohorts([...data].reverse()).LIVE,actual=api.operationalSummary([...data].reverse()).summary;
 for(const key of ['total','completed','active','wins','losses','breakEvens','netR','maxDrawdownR','currentLossStreak','maxLossStreak','winRate','averageR','expectancy','profitFactor'])assert.equal(actual[key],expected[key],key);
 for(const side of ['Long','Short'])for(const key of ['count','wins','netR'])assert.equal(actual.directions[side][key],expected.directions[side][key]);
});

function lifecycle(fetch, notify=()=>{}) {
 let time=0, shown=true;
 const store=ui.createOperationalStore(fetch,notify,{now:()=>time,visible:()=>shown});
 return {store,advance:ms=>{time+=ms;},show:value=>{shown=value;}};
}
test('five minute refresh: fresh/hidden/stale/visible and new summary replaces old',async()=>{
 let calls=0;const data=rows(1),clock=lifecycle(async()=>{calls++;return response(page(data));});
 await clock.store.load();assert.equal(calls,2);assert.equal(clock.store.state.lastSuccessfulAt,0);
 clock.advance(299999);await clock.store.load();assert.equal(calls,2);
 clock.show(false);clock.advance(1);await clock.store.load();assert.equal(calls,2);
 clock.show(true);data[0].outcome.resultR=-1;await Promise.all([clock.store.load(),clock.store.load()]);
 assert.equal(calls,4);assert.equal(clock.store.state.operationalCohort.summary.losses,1);assert.equal(clock.store.state.lastSuccessfulAt,300000);
 clock.show(false);clock.advance(1);clock.show(true);await clock.store.load();assert.equal(calls,4);
});
for(const failure of ['401','403','proxy','network','pagination','schema','duplicate','continuity','total','unstable'])test('previous success cleared, unavailable, no immediate retry: '+failure,async()=>{
 let calls=0, failing=false;const data=rows(101),root=new Element();
 const ids=['#statistics-win-rate','#statistics-outcomes','#statistics-profit-factor','#statistics-r-performance'];
 const elements=Object.fromEntries(ids.map(k=>[k,new Element()])),runtime=uiRuntime(elements);
 const clock=lifecycle(async url=>{
 calls++; const offset=Number(new URL(url).searchParams.get('offset')),p=page(data,offset);
 if(failing){
   assert.equal(clock.store.state.operationalCohort,null);
   assert.doesNotMatch(elements['#statistics-outcomes'].textContent,/WIN: 101/);
   if(['401','403','proxy'].includes(failure))return {ok:false,status:failure==='proxy'?502:Number(failure)};
   if(failure==='network')throw Error('offline');
   if(failure==='pagination')p.nextOffset=2;
   if(failure==='schema')p.rulesRevision='bad';
   if(failure==='duplicate'&&offset===100)p.records=[data[0]];
   if(failure==='continuity')p.offset=1;
   if(failure==='total'&&offset===100)p.totalArchived=102;
   if(failure==='unstable'&&calls===8)p.records=[{...data[100],outcome:{...data[100].outcome,resultR:-1}}];
 }
 return response(p);
 },s=>runtime.renderPerformance(root,s));
 await clock.store.load();assert.match(elements['#statistics-outcomes'].textContent,/WIN: 101/);
 failing=true;clock.advance(300000);await clock.store.load();
 assert.equal(clock.store.state.operationalCohort,null);assert.equal(clock.store.state.error,true);
 assert.match(root.textContent,/Statistics temporarily unavailable/);
 assert.doesNotMatch(elements['#statistics-outcomes'].textContent,/WIN: 101|WIN: 0/);
 const stopped=calls;await clock.store.load();clock.show(false);clock.show(true);await clock.store.load();assert.equal(calls,stopped);
 assert.equal(clock.store.state.lastSuccessfulAt,0);
});
test('in-flight cycle may finish hidden; concurrent triggers do not duplicate it',async()=>{
 let calls=0,release;const clock=lifecycle(async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return response(page([]));});
 const pending=clock.store.load();await clock.store.load();assert.equal(calls,1);clock.show(false);release();await pending;
 assert.equal(calls,2);assert.equal(clock.store.state.loaded,true);
 clock.advance(300000);for(let i=0;i<10;i++)await clock.store.load();assert.equal(calls,2);
});
test('existing Dashboard tick + visibility share one bounded operational loader, no new polling loop',async()=>{
 let calls=0,time=0;const listeners={};const root=new Element(),dialog=new Element(),performance=new Element();
 class Clock extends Date {static now(){return time;}}
 const context={Date:Clock,AbortSignal,window:{fetch:async()=>{calls++;return response(page([]));}},document:{visibilityState:'hidden',addEventListener:(k,fn)=>listeners[k]=fn,createElement:()=>new Element(),querySelector:k=>({'#trade-journal-content':root,'#trade-journal-dialog':dialog,'#statistics-trade-analytics':performance}[k]||null)}};
 vm.runInNewContext(source,context);assert.equal(calls,0);
 listeners['operational-statistics-tick']();await new Promise(r=>setImmediate(r));assert.equal(calls,0);
 context.document.visibilityState='visible';listeners.visibilitychange();listeners['operational-statistics-tick']();await new Promise(r=>setImmediate(r));assert.equal(calls,2);
 context.document.visibilityState='hidden';time=300000;listeners['operational-statistics-tick']();await new Promise(r=>setImmediate(r));assert.equal(calls,2);
 context.document.visibilityState='visible';listeners.visibilitychange();listeners.visibilitychange();await new Promise(r=>setImmediate(r));assert.equal(calls,4);
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/renderRankingFreshness\(\);\s*document.dispatchEvent\(new Event\('operational-statistics-tick'\)\)/);
 assert.doesNotMatch(source,/setInterval|setTimeout/);
});
