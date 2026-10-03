import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const textTree=n=>[n.textContent||'',...(n.children||[]).map(textTree)].join(' ');
const source=readFileSync(new URL('../risk-manager.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function run(){const c={window:{}};vm.runInNewContext(source,c);return c.window.SM1MRisk;}
test('canonical ready does not imply account execution permission',()=>{
 const r=run();assert.equal(r.applySafety({title:'READY TO ENTER'},{status:'READY'}).title,'RISK CHECK REQUIRED');
 assert.equal(r.applySafety({title:'READY TO ENTER'},null).title,'DATA SAFETY BLOCKED');
 assert.equal(r.applySafety({title:'WAIT FOR ENTRY'},{status:'BLOCKED'}).title,'DATA SAFETY BLOCKED');
});
test('Active lifecycle presentation remains unchanged even with stale data',()=>{
 const original={title:'ACTIVE TRADE',message:'frozen'};assert.equal(run().applySafety(original,{status:'BLOCKED'}),original);
});
test('N/A reason text is fixed safe text, never provider HTML',()=>{
 const r=run();assert.equal(r.reasonText('STALE_DATA'),'Provider history is stale.');
 assert.doesNotMatch(r.reasonText('<img onerror=alert(1)>'),/<|>/);
});
test('no percentage labelled Position Size and safety always applied in actual modal',()=>{
 assert.doesNotMatch(html,/>Position Size<\/div>/);assert.match(html,/Suggested risk % \/ leverage/);
 assert.match(html,/applySafety\(setupExecutionStatus, data.dataSafety\)/);
 assert.match(html,/SM1MRisk\?\.mount\(riskElement/);
 assert.doesNotMatch(source,/localStorage|innerHTML|registerOpenTrade|refresh=true/);
});
test('risk form sends only explicit scenario, starts unavailable and no calls on mount',async()=>{
 class Node {constructor(tag){this.tag=tag;this.children=[];this.events={};this.value='';this.checked=false;}append(...x){this.children.push(...x);}prepend(...x){this.children.unshift(...x);}replaceChildren(...x){this.children=x;}setAttribute(){}addEventListener(n,f){this.events[n]=f;}style={};}
 const root=new Node('section'),calls=[],timers=[];
 const c={window:{},document:{createElement:t=>new Node(t)},Date,URL,AbortSignal,setTimeout:fn=>timers.push(fn),
 fetch:async(url,options)=>{calls.push({url:String(url),options});return {ok:true,json:async()=>({ok:true,risk:{status:'READY',reasonCodes:[],validUntil:new Date(Date.now()+5000).toISOString()}})};}};
 vm.runInNewContext(source,c);c.window.SM1MRisk.mount(root,{apiUrl:'https://example.test/api/market',tradeId:'frozen-id'});
 assert.equal(calls.length,0);const form=root.children.find(n=>n.tag==='form');
 const inputs=form.children.flatMap(n=>n.children).filter(n=>n.tag==='input'&&n.type==='number');
 assert.equal(inputs.find(n=>n.name==='balance').value,'');assert.equal(inputs.find(n=>n.name==='openRiskAmount').value,'');
 assert.equal(inputs.find(n=>n.name==='leverage').value,'1');
 for(const n of inputs)if(n.value==='')n.value='0';inputs.find(n=>n.name==='balance').value='1000';
 const box=form.children.flatMap(n=>n.children).find(n=>n.type==='checkbox');box.checked=true;
 await form.events.submit({preventDefault(){}});assert.equal(calls.length,1);
 assert.equal(calls[0].options.method,'POST');assert.equal(new URL(calls[0].url).search,'?mode=risk-manager');
 const body=JSON.parse(calls[0].options.body);assert.equal(body.tradeId,'frozen-id');assert.equal(body.account.confirmedCurrent,true);
 assert.equal(body.plan,undefined);assert.equal(body.confirmedAPlus,undefined);
 assert.equal(timers.length,1);timers[0]();assert.match(textTree(root.children.at(-1)),/expired/);
 form.events.input();assert.match(textTree(root.children.at(-1)),/inputs changed/);
});
test('syntax checks inline scripts and isolated risk renderer',()=>{
 new vm.Script(source);
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=|application\/ld\+json/.test(match[1]))new vm.Script(match[2]);
});

test('tracked Active and completed modes never offer a new sizing form',()=>{
 class Node {children=[];style={};append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;}}
 const c={window:{},document:{createElement:tag=>Object.assign(new Node(),{tag})},fetch:()=>assert.fail('no request on mount')};
 vm.runInNewContext(source,c);
 const text=n=>[n.textContent||'',...n.children.map(text)].join(' ');
 for(const status of ['Active','Stopped','TP3Hit','Expired']){
 const root=new Node(),trackedSignal={tradeId:'id',initialPlan:{entryPrice:100,initialStopLoss:90},outcome:{status,entryPrice:99.5,currentStopLoss:99.5,exits:[{target:'TP1'}]}};
 const before=JSON.stringify(trackedSignal);
 c.window.SM1MRisk.mount(root,{tradeId:'id',trackedSignal});
 assert.equal(root.children.some(n=>n.tag==='form'),false);
 assert.match(text(root),status==='Active'?/ACTIVE POSITION/:/historical trade/);
 if(status==='Active')for(const value of ['PLANNED ENTRY','Плановый вход · Frozen A+ plan 100','ACTUAL ENTRY','Вход по модели 99.5','INITIAL STOP LOSS','Начальный стоп · Frozen A+ plan 90','CURRENT STOP LOSS','Текущий стоп 99.5'])assert.ok(text(root).includes(value));
 assert.equal(JSON.stringify(trackedSignal),before);
 }
});

const potential={mode:'planned',currency:'USDT',basis:'linear-gross-before-costs',
 tp1:{fraction:.25,rMultiple:1,contribution:2.5},tp2:{fraction:.25,rMultiple:2,contribution:5},tp3:{fraction:.5,rMultiple:3,contribution:15},weightedR:2.25,weightedAmount:22.5};
async function renderRisk(risk){
 class Node {constructor(tag){this.tag=tag;this.children=[];this.events={};this.value='';}style={};append(...n){this.children.push(...n);}prepend(...n){this.children.unshift(...n);}replaceChildren(...n){this.children=n;}setAttribute(){}addEventListener(e,f){this.events[e]=f;}remove(){}}
 const root=new Node('section');const c={window:{},document:{createElement:t=>new Node(t)},Date,URL,AbortSignal,setTimeout(){},fetch:async()=>({ok:true,json:async()=>({ok:true,risk:{status:'READY',mode:'planned-entry',validUntil:new Date(Date.now()+10000).toISOString(),...risk}})})};
 vm.runInNewContext(source,c);c.window.SM1MRisk.mount(root,{apiUrl:'https://example.test/api/market',tradeId:'id'});
 await root.children.find(n=>n.tag==='form').events.submit({preventDefault(){}});
 const text=n=>[n.textContent||'',...n.children.map(text)].join('\n');return text(root);
}
test('planned backend contributions display fractions, weighted potential and gross disclaimer',async()=>{
 const text=await renderRisk({targetPotential:potential});
 for(const label of ['TP1 · 25% contribution: +2.50 USDT','TP2 · 25% contribution: +5.00 USDT','TP3 · 50% contribution: +15.00 USDT','Weighted TP Potential: +22.50 USDT · +2.25R','Gross · before fees/funding/slippage','Условный gross-результат при достижении всех целей.'])assert.ok(text.includes(label),label);
});
for(const [name,risk] of [['null',{targetPotential:null}],['missing',{}],['unsupported currency',{targetPotential:{...potential,currency:'BTC'}}],['invalid amount',{targetPotential:{...potential,weightedAmount:Infinity}}],['blocked',{status:'BLOCKED',targetPotential:potential}],['Active',{mode:'existing-position',targetPotential:potential}]])test('no fake planned potential: '+name,async()=>{
 const text=await renderRisk(risk);assert.doesNotMatch(text,/PLANNED TARGET POTENTIAL|Weighted TP Potential|TP1 ·|\+0\.00 USDT/);
 if(name==='Active')assert.match(text,/ACTIVE POSITION/);
});

function uiHarness(risk={}, fail=false) {
 class N {constructor(tag){this.tag=tag;this.children=[];this.events={};this.value='';this.checked=false;this.style={};}append(...xs){for(const x of xs){x.parent=this;this.children.push(x);}}prepend(...xs){this.children.unshift(...xs);}replaceChildren(...xs){this.children=[];this.append(...xs);}setAttribute(){}addEventListener(e,f){this.events[e]=f;}remove(){this.parent.children=this.parent.children.filter(x=>x!==this);}}
 const root=new N('section'),calls=[],timers=[];
 const c={window:{},document:{createElement:t=>new N(t)},Date,URL,AbortSignal,setTimeout:f=>timers.push(f),fetch:async(url,options)=>{calls.push({url:String(url),options});if(fail)throw Error('network');return{ok:true,json:async()=>({ok:true,risk:{status:'READY',mode:'planned-entry',validUntil:new Date(Date.now()+10000).toISOString(),...risk}})}}};
 vm.runInNewContext(source,c);return {root,calls,timers,mount:args=>c.window.SM1MRisk.mount(root,{apiUrl:'https://example.test/api/market',tradeId:'id',...args})};
}
const descendants=n=>[n,...n.children.flatMap(descendants)];
test('bilingual pre-entry preserves every input/default/required and payload, numbers unchanged',async()=>{
 const calculation={positionNotional:1000,requiredMargin:200,expectedGrossLossAtSL:10,portfolioOpenRisk:20,projectedOpenRiskAmount:30};
 const h=uiHarness({calculation});h.mount({trackedSignal:{tradeId:'id',initialPlan:{entryPrice:100,initialStopLoss:90},outcome:{status:'WaitingEntry'}},safety:{status:'READY'}});
 const inputs=descendants(h.root).filter(n=>n.type==='number');
 assert.deepEqual(inputs.map(n=>[n.name,n.value,n.required]),[['balance','',true],['riskPercent','0.25',true],['maxOpenRiskPercent','1',true],['maxTrades','2',true],['leverage','1',true],['openRiskAmount','',true],['openTrades','',true],['usedMargin','',true]]);
 const vals=['1000','1','5','4','5','20','1','100'];inputs.forEach((n,i)=>n.value=vals[i]);const check=descendants(h.root).find(n=>n.type==='checkbox');assert.equal(check.required,true);assert.equal(check.checked,false);check.checked=true;
 assert.equal(h.calls.length,0);await h.root.children.find(n=>n.tag==='form').events.submit({preventDefault(){}});
 const payload=JSON.parse(h.calls[0].options.body);const {asOf,...account}=payload.account;assert.ok(Number.isFinite(Date.parse(asOf)));assert.deepEqual(account,{balance:1000,riskPercent:1,maxOpenRiskPercent:5,maxTrades:4,leverage:5,openRiskAmount:20,openTrades:1,usedMargin:100,confirmedCurrent:true});assert.equal(payload.tradeId,'id');assert.deepEqual(Object.keys(payload).sort(),['account','tradeId']);
 for(const value of ['1000.00 USDT','200.00 USDT','10.00 USDT','20.00 USDT','30.00 USDT'])assert.ok(textTree(h.root).includes(value));
});
for(const state of ['Active','Stopped','Closed','Expired','TP1Hit','TP3Hit'])test(`${state}: no sizing, source unchanged; Active includes post-TP1 state`,()=>{
 const h=uiHarness(),trackedSignal={tradeId:'id',price:999,initialPlan:{entryPrice:100,initialStopLoss:90},outcome:{status:state,entryPrice:101,currentStopLoss:101,reanalysisPending:true,lastReanalysis:{decision:'CLOSE',executionStatus:'pending'},exits:[{target:'TP1'}]}};
 const before=JSON.stringify(trackedSignal);h.mount({trackedSignal});assert.equal(descendants(h.root).some(n=>n.tag==='form'),false);assert.equal(h.calls.length,0);assert.equal(JSON.stringify(trackedSignal),before);
 if(state==='Active'){const metrics=descendants(h.root).filter(n=>n.className==='risk-manager-value');assert.deepEqual(metrics.map(n=>n.textContent),['100','101','90','101']);assert.match(textTree(h.root),/Вход по модели/);}
});
test('backend existing-position removes form and renders four saved references',async()=>{
 const h=uiHarness({mode:'existing-position',reference:{plannedEntry:100,actualEntry:99,initialStopLoss:90,currentStopLoss:99}});h.mount();await h.root.children.find(n=>n.tag==='form').events.submit({preventDefault(){}});
 assert.equal(descendants(h.root).some(n=>n.tag==='form'),false);assert.deepEqual(descendants(h.root).filter(n=>n.className==='risk-manager-value').map(n=>n.textContent),['100','99','90','99']);assert.match(textTree(h.root),/ACTIVE POSITION/);
});
for(const state of ['READY','BLOCKED','UNAVAILABLE'])test(`${state} bilingual result and safe unknown reason`,async()=>{
 const h=uiHarness({status:state,reasonCodes:['<img onerror=alert(1)>']});h.mount();await h.root.children.find(n=>n.tag==='form').events.submit({preventDefault(){}});assert.match(textTree(h.root),new RegExp(state));assert.doesNotMatch(textTree(h.root),/<img/);assert.match(textTree(h.root),/Data unavailable or incomplete/);
});
test('collapsed provenance retains provider/type/time; blocked freshness remains outside',()=>{
 const h=uiHarness();h.mount({safety:{status:'BLOCKED',price:{source:'OKX',instrumentType:'SWAP',asOf:'2026-10-03T00:00:00Z',fresh:true},candles:{source:'OKX',instrumentType:'SWAP',lastConfirmedAt:'2026-10-02T23:59:00Z',fresh:false}}});
 const details=h.root.children.find(n=>n.tag==='details');assert.notEqual(details.open,true);assert.match(textTree(details),/OKX · SWAP · 2026-10-03T00:00:00Z/);
 const visible=h.root.children.filter(n=>n!==details).map(textTree).join(' ');assert.match(visible,/DATA SAFETY BLOCKED/);assert.match(visible,/Недоступны \/ устарели/);assert.match(visible,/Fresh/);
});
test('network error fails closed with bilingual message',async()=>{
 const h=uiHarness({},true);h.mount();await h.root.children.find(n=>n.tag==='form').events.submit({preventDefault(){}});assert.match(textTree(h.root),/UNAVAILABLE/);assert.match(textTree(h.root),/Не удалось проверить данные риска/);
});
test('no trade mounts unavailable without requests and responsive CSS shrinks below 150px',()=>{
 const h=uiHarness();h.mount({tradeId:null});assert.equal(h.calls.length,0);assert.equal(descendants(h.root).some(n=>n.tag==='form'),false);
 assert.match(html,/\.risk-manager-metrics, \.risk-manager-form\s*\{[^}]*minmax\(min\(100%,150px\),1fr\)/);assert.match(html,/\.risk-manager-metric, \.risk-manager-field, \.risk-manager-panel\s*\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/);
});
