import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
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
 assert.equal(timers.length,1);timers[0]();assert.match(root.children.at(-1).textContent,/expired/);
 form.events.input();assert.match(root.children.at(-1).textContent,/inputs changed/);
});
test('syntax checks inline scripts and isolated risk renderer',()=>{
 new vm.Script(source);
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=|application\/ld\+json/.test(match[1]))new vm.Script(match[2]);
});
