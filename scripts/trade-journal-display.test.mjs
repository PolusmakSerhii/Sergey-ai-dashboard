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
function runtime(){const context=vm.createContext({window:{},document:{createElement:()=>new Element(),querySelector:()=>null},AbortSignal});vm.runInContext(source,context);return context.window.Sm1mTradeJournal;}
const api=runtime();
const fixture={tradeId:'frozen:1',origin:{symbol:'OKBUSDT',direction:'Long',grade:'A+',opportunityScore:88,confidence:97,action:'Strong Buy',detectedAt:'2026-09-01T00:00:00Z',riskReward:2},initialPlan:{entryPrice:100,entryZone:{from:99,to:101},initialStopLoss:90,takeProfit1:110,takeProfit2:120,takeProfit3:130},outcome:{status:'Stopped',entryPrice:101,currentStopLoss:101,exitPrice:101,resultR:0.25,activatedAt:'2026-09-01T00:01:00Z',checkedAt:'2026-09-01T00:05:00Z',exits:[{target:'TP1',price:110,initialFraction:0.25,realizedR:0.25,checkedAt:'2026-09-01T00:03:00Z'}]}};
for(const [value,label] of [[1,'WIN'],[-1,'LOSS'],[0,'BREAK EVEN'],[0.25,'WIN']])test(`final ${value} classified ${label}`,()=>assert.equal(api.result({...fixture,outcome:{status:'Stopped',resultR:value,checkedAt:fixture.outcome.checkedAt}}).label,label));
for(const status of ['Expired','Active','WaitingEntry','Pending'])test(`${status} cannot become final result`,()=>assert.equal(api.result({...fixture,outcome:{status,resultR:1}}).label,'N/A'));
test('saved details distinguish planned/actual, stops and exits without fetch',()=>{const dialog=new Element();api.details(fixture,dialog);for(const t of ['Planned Entry / midpoint','100','Actual / Modelled Entry','101','Initial Stop Loss','90','Final / Current Stop Loss','TP1','0.25','Original detectedAt','Strong Buy','88','97','not necessarily exchange fills'])assert.ok(dialog.textContent.includes(t),t);assert.equal(dialog.open,true);});
test('missing fields safe; malformed exits ignored; no reconstructed exits',()=>{const d=new Element();api.details({tradeId:'x',outcome:{exits:[null,2]}},d);assert.match(d.textContent,/N\/A/);assert.match(d.textContent,/No recorded partial exits/);});
test('archive strings remain text, never HTML',()=>{const d=new Element();api.details({...fixture,origin:{symbol:'<img onerror=alert(1)>'}},d);assert.ok(d.textContent.includes('<img onerror=alert(1)>'));});
const response=data=>({ok:true,json:async()=>({ok:true,...data})});
test('explicit pagination deduplicates IDs and stops, detail makes zero requests',async()=>{const calls=[];const pages=[{records:[fixture],totalArchived:2,nextOffset:1},{records:[fixture,{...fixture,tradeId:'frozen:2'}],totalArchived:2,nextOffset:null}];const store=api.createStore(async url=>{calls.push(url);return response(pages.shift());},()=>{});await store.load();assert.match(calls[0],/mode=validation-archive&offset=0&limit=100$/);api.details(fixture,new Element());assert.equal(calls.length,1);await store.load();assert.equal(store.state.records.size,2);assert.match(calls[1],/offset=1/);await store.load();assert.equal(calls.length,2);});
test('concurrent load guarded and loading published before request',async()=>{let resolve,calls=0;const store=api.createStore(()=>{calls++;assert.equal(store.state.loading,true);return new Promise(r=>resolve=r);},()=>{});const pending=store.load();await store.load();assert.equal(calls,1);resolve(response({records:[]}));await pending;});
test('errors retain records and allow explicit retry',async()=>{let fail=true;const store=api.createStore(async()=>{if(fail)throw Error();return response({records:[fixture]});},()=>{});await store.load();assert.equal(store.state.error,true);fail=false;await store.load();assert.equal(store.state.records.size,1);});
test('malformed record skipped without crashing valid rows',async()=>{const store=api.createStore(async()=>response({records:[null,{},fixture]}),()=>{});await store.load();assert.equal(store.state.skipped,2);assert.equal(store.state.records.size,1);const root=new Element();api.render(root,store.state,new Element(),()=>{});assert.equal(root.journalView.children.find(c=>c.className==='journal-list').children[0].dataset.tradeId,fixture.tradeId);});
test('empty, coverage and load-more rendering',async()=>{const store=api.createStore(async()=>response({records:[]}),()=>{});await store.load();const root=new Element();api.render(root,store.state,new Element(),()=>{});assert.match(root.textContent,/No archived trades/);assert.match(root.textContent,/Архив может содержать не всю историю сделок/);assert.match(root.textContent,/Граница архива: N\/A/);});
test('invalid pagination fails closed',async()=>{const store=api.createStore(async()=>response({records:[fixture],nextOffset:0}),()=>{});await store.load();assert.equal(store.state.error,true);assert.equal(store.state.records.size,0);});
test('no polling, live analysis, account inputs or monetary computation',()=>{assert.doesNotMatch(source,/setInterval|setTimeout|riskAmount|riskPercent|balance|leverage|mode=refresh|symbol=/);assert.equal((source.match(/fetcher\(/g)||[]).length,1);});
test('navigation uses existing generic tab mechanism and session-gated script',()=>{for(const tab of ['global-ranking','entry-setups','top-coins','watchlist','trade-journal'])assert.ok(html.includes(`data-dashboard-tab="${tab}"`));assert.ok(html.includes('data-private-dashboard data-private-src="./trade-journal.js"'));assert.ok(html.includes('panel.hidden = panel.dataset.dashboardPanel !== selectedTab'));});
test('all inline and journal JS parse',()=>{new vm.Script(source);for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);});

const record=(id,score,r=1,direction='Long',status='Stopped')=>({...fixture,tradeId:id,origin:{...fixture.origin,symbol:id,direction,opportunityScore:score},outcome:{...fixture.outcome,status,resultR:r}});
const sample=[record('BTCUSDT',85,1),record('ETHUSDT',89.99,-1,'Short'),record('SOLUSDT',90,0),record('XRPUSDT',94.99,2,'Short'),record('OKBUSDT',95,0.001),record('LOW',84.99),record('MISSING',null),record('ACTIVE',99,3,'Long','Active'),record('EXPIRED',99,3,'Long','Expired')];
const filtered=(changes,rows=sample)=>api.filterRecords(new Map(rows.map(r=>[r.tradeId,r])),{...api.defaultFilters(),...changes});
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
test('UI filters/reset make zero requests; controls survive rerender and Load More',async()=>{
 let calls=0;
 const pages=[{records:[record('BTC',85)],nextOffset:1,totalArchived:2},{records:[record('ETH',95)],nextOffset:null,totalArchived:2}];
 const root=new Element(),dialog=new Element();
 const store=api.createStore(async()=>{calls++;return response(pages.shift());},s=>api.render(root,s,dialog,()=>store.load()));
 await store.load();
 const all=descendants(root),search=all.find(e=>e.type==='search'),selects=all.filter(e=>e.listeners.change);
 search.value='eth';search.listeners.input();
 assert.equal(calls,1);assert.match(root.textContent,/После фильтрации: 0 из 1/);assert.match(root.textContent,/LOAD MORE/);assert.match(root.textContent,/FILTERED COHORT/);
 await store.load();assert.equal(calls,2);assert.equal(search.value,'eth');assert.equal(store.state.filters.search,'eth');assert.match(root.textContent,/После фильтрации: 1 из 2/);
 selects[0].value='Short';selects[0].listeners.change();assert.match(root.textContent,/После фильтрации: 0 из 2/);assert.equal(calls,2);
 descendants(root).find(e=>e.value==='Reset').listeners.click();assert.equal(search.value,'');assert.equal(store.state.filters.direction,'ALL');assert.equal(store.state.filters.result,'ALL');assert.equal(store.state.filters.score,'ALL');assert.match(root.textContent,/LOADED ARCHIVE COHORT/);assert.match(root.textContent,/После фильтрации: 2 из 2/);
 api.details(fixture,dialog);assert.equal(calls,2);
});
test('coverage + summary update for filter, safe user input, no all-time claim',()=>{const root=new Element(),state={records:new Map(sample.map(r=>[r.tradeId,r])),filters:api.defaultFilters(),next:100,total:null,loaded:true};api.render(root,state,new Element(),()=>{});assert.match(root.textContent,/Аналитика рассчитана только по загруженным сделкам и не является статистикой за всё время/);assert.ok(!root.textContent.includes('из null'));state.filters.result='LOSS';api.render(root,state,new Element(),()=>{});assert.match(root.textContent,/После фильтрации: 1 из 9/);assert.match(root.textContent,/0.0%/);state.filters.search='<img onerror=x>';api.render(root,state,new Element(),()=>{});assert.match(root.textContent,/No matching loaded records/);});
