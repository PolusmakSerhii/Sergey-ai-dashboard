import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../trade-journal.js',import.meta.url),'utf8');
const c={window:{},document:{querySelector:()=>null}};vm.runInNewContext(source,c);
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
test('ALL retains unknown; cohort filters preserve records and validation cohort',()=>{
 const records=[rec('2026-10-10T00:00:00Z','Active'),rec('2026-10-12T00:00:00Z'),rec(null)];
 const before=JSON.stringify(records);
 assert.equal(api.filterCohort(records).length,3);
 for(const cohort of ['PRE-LIVE','LIVE'])assert.equal(api.filterRecords(new Map(records.map((r,i)=>[i,r])),{...api.defaultFilters(),cohort}).length,1);
 assert.equal(JSON.stringify(records),before);
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
function uiRuntime(){const c={window:{},document:{querySelector:()=>null,createElement:()=>new Element()},AbortSignal};vm.runInNewContext(source,c);return c.window.Sm1mTradeJournal;}
const ui=uiRuntime();
const button=(root,label)=>descendants(root).find(e=>e.type==='button'&&e.value===label);
test('performance default uses full backend metrics, not records; selector is local; source unchanged',()=>{
 const root=new Element(),state={liveCohorts:cohorts(),records:new Map(),outcomes:{netR:999}};const before=JSON.stringify(state.liveCohorts);
 ui.renderPerformance(root,state);assert.equal(root.performanceCohort,'PRE-LIVE');
 for(const t of ['7','+12.35R','17.3%','+4.56R','+8.9R','Canonical/modelled','not confirmed exchange P&L','history completeness is not guaranteed'])assert.ok(root.textContent.includes(t),t);
 button(root,'LIVE · FROM 12 OCT 2026').listeners.click();assert.equal(root.performanceCohort,'LIVE');assert.match(root.textContent,/LIVE starts 12 Oct 2026/);assert.match(root.textContent,/N\/A/);assert.doesNotMatch(root.textContent,/Performance unavailable/);assert.equal(JSON.stringify(state.liveCohorts),before);
 assert.equal(button(root,'LIVE · FROM 12 OCT 2026')['aria-pressed'],'true');
});
for(const variant of ['missing','bad boundary','bad count','error'])test('unavailable is not zero: '+variant,()=>{
 const root=new Element(),state={liveCohorts:cohorts()};
 if(variant==='missing')delete state.liveCohorts;
 if(variant==='bad boundary')state.liveCohorts.startAt='bad';
 if(variant==='bad count')state.liveCohorts.summaries['PRE-LIVE'].completed=null;
 if(variant==='error')state.error=true;
 ui.renderPerformance(root,state);assert.match(root.textContent,/Performance unavailable/);assert.ok(!descendants(root).some(e=>e.className==='journal-fields'));
});
test('Journal cohort controls combine with filters, reset ALL, unknown warning, empty and partial wording',()=>{
 const root=new Element(),state={filters:ui.defaultFilters(),records:new Map(),loaded:true,next:1,total:3,boundary:null,liveCohorts:cohorts()};
 state.liveCohorts.summaries.UNKNOWN.total=1;
 const rows=[rec('2026-10-10T00:00:00Z'),rec(null)]; rows.forEach((r,i)=>state.records.set(i,r));
 const before=JSON.stringify(rows);ui.render(root,state,new Element(),()=>{throw Error('unexpected request');});
 assert.equal(state.filters.cohort,'ALL');assert.match(root.textContent,/Записей без однозначной даты происхождения: 1/);
 button(root,'PRE-LIVE').listeners.click();assert.equal(ui.filterRecords(state.records,state.filters).length,1);assert.match(root.textContent,/FILTERED COHORT/);
 button(root,'LIVE').listeners.click();assert.match(root.textContent,/В загруженных записях нет LIVE-сделок/);assert.match(root.textContent,/Архив загружен не полностью/);
 state.next=null;ui.render(root,state,new Element(),()=>{});assert.doesNotMatch(root.textContent,/Архив загружен не полностью/);
 state.filters.search='BTC';ui.render(root,state,new Element(),()=>{});assert.match(root.textContent,/No matching loaded records/);assert.doesNotMatch(root.textContent,/нет LIVE-сделок/);
 button(root,'Reset').listeners.click();assert.equal(state.filters.cohort,'ALL');assert.equal(state.filters.search,'');assert.equal(button(root,'ALL')['aria-pressed'],'true');assert.equal(JSON.stringify(rows),before);
});
test('session-gated bootstrap shares exactly one initial GET with Journal, concurrent and loaded clicks reuse it',async()=>{
 const root=new Element(),dialog=new Element(),performance=new Element(),tabs=new Element();let calls=0,resolve;
 const c={window:{fetch:()=>{calls++;return new Promise(r=>resolve=r);}},document:{createElement:()=>new Element(),querySelector:selector=>({'#trade-journal-content':root,'#trade-journal-dialog':dialog,'#statistics-trade-analytics':performance,'.dashboard-tabs':tabs}[selector]||null)},AbortSignal};
 vm.runInNewContext(source,c);assert.equal(calls,1);
 const click=()=>tabs.listeners.click({target:{closest:()=>({dataset:{dashboardTab:'trade-journal'}})}});
 click();assert.equal(calls,1);
 resolve({ok:true,json:async()=>({ok:true,records:[],totalArchived:0,nextOffset:null,liveCohorts:cohorts()})});
 await new Promise(r=>setImmediate(r));click();assert.equal(calls,1);assert.match(performance.textContent,/12.35R/);
 button(performance,'LIVE · FROM 12 OCT 2026').listeners.click();button(root,'LIVE').listeners.click();assert.equal(calls,1);
});
test('store retains summary separately from paginated records; no invented response timestamp',async()=>{
 const data=cohorts();const store=ui.createStore(async()=>({ok:true,json:async()=>({ok:true,records:[rec('2026-10-10T00:00:00Z')],nextOffset:1,totalArchived:20,liveCohorts:data})}),()=>{});
 await store.load();assert.equal(store.state.liveCohorts,data);assert.equal(store.state.records.size,1);assert.equal(store.state.next,1);assert.equal(store.state.total,20);
});
test('old Statistics loader cannot overwrite cohorts; no periodic archive load; gated script and scoped CSS',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const loader=html.slice(html.indexOf('async function loadStatisticsOverview()'),html.indexOf('function renderRankingFreshness()'));
 assert.doesNotMatch(loader,/statistics-trade-analytics|renderTradeAnalytics|liveCohorts/);
 assert.match(html,/data-private-dashboard data-private-src="\.\/trade-journal.js"/);
 assert.doesNotMatch(source,/setInterval|setTimeout|Date\.now/);
 const css=readFileSync(new URL('../trade-journal.css',import.meta.url),'utf8');assert.match(css,/\.cohort-controls[^}]*flex-wrap: wrap/);assert.match(css,/\.cohort-ru/);
});
test('redesigned performance: six live KPIs, drawdown magnitude, details and honest directional values',()=>{
 const root=new Element(),data=cohorts(),s=data.summaries['PRE-LIVE'];
 Object.assign(s,{completed:19,active:3,winRate:42.1,netR:-6.123,profitFactor:0.73,maxDrawdownR:17.19});
 s.directions.Long={count:4,wins:2,netR:3};s.directions.Short={count:0,wins:0,netR:0};
 const before=JSON.stringify(data);ui.renderPerformance(root,{liveCohorts:data});
 const kpis=descendants(root).find(e=>e.className==='performance-kpis');
 assert.equal(kpis.children.length,6);
 assert.deepEqual(kpis.children.map(e=>e.children[1].textContent.trim()),['19','42.1%','-6.12R','0.73','17.19R','3']);
 assert.doesNotMatch(kpis.textContent,/\+17.19R/);
 const long=descendants(root).find(e=>e.className==='performance-direction is-long');
 assert.match(long.textContent,/LONG TRADES/);assert.match(long.textContent,/50.0%/);assert.match(long.textContent,/\+0.75R/);
 const loss=descendants(long).find(e=>e.children.length===2 && e.children[0]?.textContent.trim().startsWith('Losses'));assert.equal(loss.children[1].textContent.trim(),'2');
 const short=descendants(root).find(e=>e.className==='performance-direction is-short');assert.doesNotMatch(short.textContent,/Infinity|NaN/);assert.match(short.textContent,/N\/A/);
 assert.match(root.textContent,/DETAILED STATISTICS/);assert.equal(JSON.stringify(data),before);
 button(root,'LIVE · FROM 12 OCT 2026').listeners.click();assert.match(root.textContent,/LIVE starts/);
 assert.deepEqual(descendants(root).find(e=>e.className==='performance-kpis').children.map(e=>e.children[1].textContent.trim()),['0','N/A','0R','N/A','0R','0']);
});

for (const [side, be, expected] of [
 [{count:6,wins:1,netR:0},0,'5'],
 [{count:6,wins:1,netR:0},1,'N/A'],
 [{count:6,wins:1,netR:0,breakEvens:2},2,'3'],
 [{count:6,wins:1,netR:0,losses:4},1,'4'],
 [{count:6,wins:9,netR:0},0,'N/A']
]) test('directional losses safely resolved '+JSON.stringify(side)+' BE '+be,()=>{
 const data=cohorts();data.summaries['PRE-LIVE'].breakEvens=be;data.summaries['PRE-LIVE'].directions.Long=side;
 const root=new Element();ui.renderPerformance(root,{liveCohorts:data});
 const long=descendants(root).find(e=>e.className==='performance-direction is-long');
 const loss=descendants(long).find(e=>e.children.length===2 && e.children[0]?.textContent.trim().startsWith('Losses'));
 assert.equal(loss.children[1].textContent.trim(),expected);
});
