import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../trade-journal.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
class Element {
  constructor(){this.children=[];this.dataset={};this.listeners={};this.value='';}
  set textContent(v){this.value=String(v);} get textContent(){return this.value+' '+this.children.map(c=>c.textContent).join(' ');}
  setAttribute(key,value){this[key]=value;}
  set innerHTML(v){throw Error('Unsafe HTML');}
  append(...children){this.children.push(...children);} replaceChildren(...children){this.value='';this.children=children;}
  addEventListener(type,fn){this.listeners[type]=fn;} showModal(){this.open=true;} close(){this.open=false;}
}
function runtime(){const context=vm.createContext({window:{},document:{visibilityState:'visible',createElement:()=>new Element(),querySelector:()=>null},AbortSignal});vm.runInContext(source,context);return context.window.Sm1mTradeJournal;}
const api=runtime();
const fixture={tradeId:'frozen:1',origin:{symbol:'OKBUSDT',direction:'Long',grade:'A+',opportunityScore:88,confidence:97,action:'Strong Buy',detectedAt:'2026-09-01T00:00:00Z',riskReward:2},initialPlan:{entryPrice:100,entryZone:{from:99,to:101},initialStopLoss:90,takeProfit1:110,takeProfit2:120,takeProfit3:130},outcome:{status:'Stopped',entryPrice:101,currentStopLoss:101,exitPrice:101,resultR:0.25,activatedAt:'2026-09-01T00:01:00Z',checkedAt:'2026-09-01T00:05:00Z',exits:[{target:'TP1',price:110,initialFraction:0.25,realizedR:0.25,checkedAt:'2026-09-01T00:03:00Z'}]}};
for(const [value,label] of [[1,'WIN'],[-1,'LOSS'],[0,'BREAK EVEN'],[0.25,'WIN']])test(`final ${value} classified ${label}`,()=>assert.equal(api.result({...fixture,outcome:{status:'Stopped',resultR:value,checkedAt:fixture.outcome.checkedAt}}).label,label));
for(const status of ['Expired','Active','WaitingEntry','Pending'])test(`${status} cannot become final result`,()=>assert.equal(api.result({...fixture,outcome:{status,resultR:1}}).label,'N/A'));
test('saved details distinguish planned/actual, stops and exits without fetch',()=>{const dialog=new Element();api.details(fixture,dialog);for(const t of ['Planned Entry / midpoint','100','Actual / Modelled Entry','101','Initial Stop Loss','90','Final / Current Stop Loss','TP1','0.25','Original detectedAt','Strong Buy','88','97','not necessarily exchange fills'])assert.ok(dialog.textContent.includes(t),t);assert.equal(dialog.open,true);});
test('missing fields safe; malformed exits ignored; no reconstructed exits',()=>{const d=new Element();api.details({tradeId:'x',outcome:{exits:[null,2]}},d);assert.match(d.textContent,/N\/A/);assert.match(d.textContent,/No recorded partial exits/);});
test('archive strings remain text, never HTML',()=>{const d=new Element();api.details({...fixture,origin:{symbol:'<img onerror=alert(1)>'}},d);assert.ok(d.textContent.includes('<img onerror=alert(1)>'));});
const response=data=>({ok:true,json:async()=>({ok:true,...data})});
test('no polling, live analysis, account inputs or monetary computation',()=>{assert.doesNotMatch(source,/setInterval|setTimeout|riskAmount|riskPercent|balance|leverage|mode=refresh|symbol=/);assert.equal((source.match(/fetcher\(/g)||[]).length,1);});
test('navigation uses existing generic tab mechanism and session-gated script',()=>{for(const tab of ['global-ranking','entry-setups','top-coins','watchlist','trade-journal'])assert.ok(html.includes(`data-dashboard-tab="${tab}"`));assert.ok(html.includes('data-private-dashboard data-private-src="./trade-journal.js"'));assert.ok(html.includes('panel.hidden = panel.dataset.dashboardPanel !== selectedTab'));});
test('all inline and journal JS parse',()=>{new vm.Script(source);for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);});

const record=(id,score,r=1,direction='Long',status='Stopped')=>({...fixture,tradeId:id,origin:{...fixture.origin,symbol:id,direction,opportunityScore:score},outcome:{...fixture.outcome,status,resultR:r}});
const sample=[record('BTCUSDT',85,1),record('ETHUSDT',89.99,-1,'Short'),record('SOLUSDT',90,0),record('XRPUSDT',94.99,2,'Short'),record('OKBUSDT',95,0.001),record('LOW',84.99),record('MISSING',null),record('ACTIVE',99,3,'Long','Active'),record('EXPIRED',99,3,'Long','Expired')];
const filtered=(changes,rows=sample)=>api.filterRecords(new Map(rows.map(r=>[r.tradeId,r])),{...api.defaultFilters(),cohort:'ALL',...changes});
for(const [label,changes,ids] of [
 ['symbol',{search:'btcu'},['BTCUSDT']],
 ['Long',{direction:'Long'},['BTCUSDT','SOLUSDT','OKBUSDT','LOW','MISSING','ACTIVE','EXPIRED']],
 ['Short',{direction:'Short'},['ETHUSDT','XRPUSDT']],
 ['WIN',{result:'WIN'},['BTCUSDT','XRPUSDT','OKBUSDT','LOW','MISSING']],
 ['LOSS',{result:'LOSS'},['ETHUSDT']],
 ['BE',{result:'BREAK EVEN'},['SOLUSDT']],
 ['85–89',{score:'85–89'},['BTCUSDT','ETHUSDT']],
 ['90–94',{score:'90–94'},['SOLUSDT','XRPUSDT']],
 ['95+',{score:'95+'},['OKBUSDT','ACTIVE','EXPIRED']],
 ['combined',{search:'usdt',direction:'Short',result:'WIN',score:'90–94'},['XRPUSDT']]
])test(`filter ${label}`,()=>assert.deepEqual(Array.from(filtered(changes),r=>r.tradeId),ids));
test('score numeric filters exclude missing/nonfinite/string values, ALL retains them',()=>{const rows=[null,NaN,Infinity,'90'].map((s,i)=>record(String(i),s));assert.equal(filtered({score:'95+'},rows).length,0);assert.equal(filtered({},rows).length,4);});
test('canonical summary: BE denominator, final R only, unrounded positive Stopped',()=>{const rows=[record('a',90,2),record('b',90,-1),record('c',90,0),{...record('d',90,12,'Long','Active'),outcome:{status:'Active',realizedR:999,resultR:12,checkedAt:fixture.outcome.checkedAt}}];const s=api.summarize(rows);assert.equal(s.completed,3);assert.equal(s.wins,1);assert.equal(s.losses,1);assert.equal(s.breakEven,1);assert.equal(s.netR,1);assert.equal(s.averageR,1/3);assert.ok(Math.abs(s.winRate-100/3)<1e-12);assert.equal(api.result(record('tiny',90,0.001)).label,'WIN');});
for(const value of [null,undefined,NaN,Infinity,'1'])test(`invalid final R ${String(value)} excluded`,()=>assert.equal(api.summarize([record('bad',90,value===undefined?1:value)].map(r=>({...r,outcome:{...r.outcome,resultR:value}}))).completed,0));
for(const stamp of [undefined,null,'invalid',123])test(`invalid completion timestamp ${String(stamp)} excluded`,()=>{const r=record('bad',90);r.outcome.checkedAt=stamp;assert.equal(api.result(r).label,'N/A');assert.equal(api.summarize([r]).completed,0);});
test('empty completed cohort has null WR/average and zero net; dedupe once',()=>{const s=api.summarize([record('active',90,3,'Long','Active')]);assert.equal(s.winRate,null);assert.equal(s.averageR,null);assert.equal(s.netR,0);assert.equal(api.summarize([fixture,fixture]).completed,1);});
function descendants(element){return [element,...element.children.flatMap(descendants)];}

const current=(id='current',time='2026-11-01T22:00:00.000Z',status='Closed')=>({...fixture,tradeId:id,origin:{...fixture.origin,detectedAt:time},initialPlan:{...fixture.initialPlan,createdAt:time},outcome:{...fixture.outcome,status}});
const stableState=records=>({filters:api.defaultFilters(),records:new Map(records.map(r=>[r.tradeId,r])),loaded:true,loading:false,error:false,boundary:'2026-09-01T00:00:00Z',operationalCohort:api.operationalSummary(records)});
const button=(root,label)=>descendants(root).find(e=>e.type==='button'&&e.value===label);
test('default/reset operational, history/UNKNOWN accessible; controls and secondary filters make zero requests',()=>{
 const data=[fixture,current(),{...current('unknown'),origin:{...fixture.origin,detectedAt:null}}],before=JSON.stringify(data),state=stableState(data),root=new Element();
 api.render(root,state,new Element());assert.equal(state.filters.cohort,'OPERATIONAL');assert.match(root.textContent,/LIVE TRADING · FROM 02 NOV 2026/);assert.equal(api.filterRecords(state.records,state.filters).length,1);
 assert.equal(button(root,'LIVE TRADING')['aria-pressed'],'true');assert.equal(button(root,'PRE-LIVE'),undefined);assert.equal(button(root,'LIVE'),undefined);assert.equal(button(root,'LOAD MORE'),undefined);
 button(root,'HISTORY / ALL').listeners.click();assert.equal(api.filterRecords(state.records,state.filters).length,3);assert.match(root.journalView.textContent,/HISTORY \/ ALL/);
 button(root,'LIVE TRADING').listeners.click();assert.equal(api.filterRecords(state.records,state.filters).length,1);
 const search=descendants(root).find(e=>e.type==='search'),selects=descendants(root).filter(e=>e.listeners.change);
 search.value='absent';search.listeners.input();assert.match(root.textContent,/No matching archived trades/);
 for(const select of selects){select.value='test';select.listeners.change();}
 button(root,'HISTORY / ALL').listeners.click();button(root,'Reset').listeners.click();
 assert.equal(state.filters.cohort,'OPERATIONAL');assert.equal(search.value,'');for(const key of ['direction','result','score'])assert.equal(state.filters[key],'ALL');
 assert.equal(button(root,'LIVE TRADING')['aria-pressed'],'true');assert.equal(button(root,'HISTORY / ALL')['aria-pressed'],'false');assert.equal(api.filterRecords(state.records,state.filters).length,1);assert.equal(JSON.stringify(data),before);
});
for(const [time,count] of [['2026-11-01T21:59:59.999Z',0],['2026-11-01T22:00:00.000Z',1],['2026-11-01T22:00:00.001Z',1]])test('Journal exact operational cutoff '+time,()=>{
 const data=[current('one',time)],s=stableState(data);assert.equal(api.filterRecords(s.records,s.filters).length,count);assert.equal(s.operationalCohort.summary.total,count);
});
test('shared selector parity, origin consistency, pre-cutoff lifecycle and history retention',()=>{
 const data=[current('good'),current('old-active','2026-11-01T21:59:59.999Z','Active'),current('old-completed','2026-11-01T21:59:59.999Z'),current('missing'),current('invalid'),current('conflict'),current('absent')];
 data[2].outcome.checkedAt='2026-11-04T00:00:00Z';delete data[3].origin.detectedAt;data[4].origin.detectedAt='invalid';data[5].initialPlan.createdAt='2026-11-04T00:00:00Z';delete data[6].initialPlan.createdAt;
 const s=stableState(data),before=JSON.stringify(data);assert.deepEqual(Array.from(api.filterRecords(s.records,s.filters),r=>r.tradeId),['good','absent']);
 assert.deepEqual(Array.from(api.selectOperationalRecords(data),r=>r.tradeId),Array.from(api.filterRecords(s.records,s.filters),r=>r.tradeId));assert.equal(s.operationalCohort.summary.total,2);
 s.filters.cohort='ALL';assert.equal(api.filterRecords(s.records,s.filters).length,7);assert.equal(JSON.stringify(data),before);
});
test('loading/failure clears previous Journal counts/cards in both modes; stable empty is distinct',()=>{
 for(const cohort of ['OPERATIONAL','ALL']){
 const s=stableState([current()]),root=new Element();s.filters.cohort=cohort;api.render(root,s,new Element());assert.ok(descendants(root).some(e=>e.className==='journal-card'));
 s.loading=true;s.operationalCohort=null;api.render(root,s,new Element());assert.match(root.textContent,/Loading archived trades/);assert.ok(!descendants(root).some(e=>e.className==='journal-card'||e.className==='journal-fields'));
 s.loading=false;s.error=true;api.render(root,s,new Element());assert.match(root.textContent,/Statistics temporarily unavailable/);assert.ok(!descendants(root).some(e=>e.className==='journal-card'||e.className==='journal-fields'));assert.doesNotMatch(root.textContent,/No LIVE TRADING trades/);
 }
 const root=new Element();api.render(root,stableState([fixture]),new Element());assert.match(root.textContent,/No LIVE TRADING trades in the current stable archive snapshot/);assert.match(root.textContent,/COMPLETED/);
});
test('one loader supplies >100 records to Journal and Dashboard; tab/mode/filter/reset cause zero GET',async()=>{
 const records=Array.from({length:101},(_,i)=>current(String(i).padStart(4,'0'))),root=new Element(),dialog=new Element(),performance=new Element(),tabs=new Element(),events={};let calls=0;
 const context={window:{fetch:async url=>{calls++;const offset=Number(new URL(url).searchParams.get('offset'));return response({initialized:true,schemaVersion:1,rulesRevision:'canonical-trade-archive-v1',validationStartAt:'2026-09-01T00:00:00Z',offset,limit:100,totalArchived:101,nextOffset:offset===0?100:null,records:records.slice(offset,offset+100)});}},document:{visibilityState:'visible',createElement:()=>new Element(),addEventListener:(k,f)=>events[k]=f,querySelector:k=>({'#trade-journal-content':root,'#trade-journal-dialog':dialog,'#statistics-trade-analytics':performance,'.dashboard-tabs':tabs}[k]||null)},AbortSignal};
 vm.runInNewContext(source,context);await new Promise(r=>setImmediate(r));assert.equal(calls,4);assert.equal(descendants(root).filter(e=>e.className==='journal-card').length,101);assert.match(performance.textContent,/Completed: 101/);
 tabs.listeners.click?.({target:{closest:()=>({dataset:{dashboardTab:'trade-journal'}})}});
 button(root,'HISTORY / ALL').listeners.click();button(root,'LIVE TRADING').listeners.click();
 const search=descendants(root).find(e=>e.type==='search');search.value='OKB';search.listeners.input();
 for(const select of descendants(root).filter(e=>e.listeners.change)){select.value='ALL';select.listeners.change();}
 button(root,'Reset').listeners.click();events['operational-statistics-tick']();events.visibilitychange();await new Promise(r=>setImmediate(r));assert.equal(calls,4);
 assert.equal(button(root,'LOAD MORE'),undefined);assert.doesNotMatch(source,/function createStore\(|store.load\(\).*trade-journal/);
});

test('actual shared refresh failure hides Journal snapshot and Dashboard; successful refresh preserves filters',async()=>{
 let time=0,fail=false;const root=new Element(),performance=new Element();
 const store=api.createOperationalStore(async()=>{if(fail)throw Error('offline');return response({initialized:true,schemaVersion:1,rulesRevision:'canonical-trade-archive-v1',validationStartAt:'2026-09-01T00:00:00Z',offset:0,limit:100,totalArchived:1,nextOffset:null,records:[current()]});},s=>{api.render(root,s,new Element());api.renderPerformance(performance,s);},{now:()=>time,visible:()=>true});
 await store.load();button(root,'HISTORY / ALL').listeners.click();assert.ok(descendants(root).some(e=>e.className==='journal-card'));
 time=300000;fail=true;await store.load();assert.match(root.textContent,/Statistics temporarily unavailable/);assert.match(performance.textContent,/Statistics temporarily unavailable/);assert.ok(!descendants(root).some(e=>e.className==='journal-card'||e.className==='journal-fields'));
 assert.equal(store.state.records.size,1);time=600000;fail=false;await store.load();assert.equal(store.state.filters.cohort,'ALL');assert.ok(descendants(root).some(e=>e.className==='journal-card'));assert.equal(button(root,'HISTORY / ALL')['aria-pressed'],'true');
});
