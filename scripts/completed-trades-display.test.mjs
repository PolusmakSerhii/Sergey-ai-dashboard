import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('    function renderCompletedTrades('),html.indexOf('    function formatAiChatMessage('));
function render(value){
 const container={},count={};
 const context=vm.createContext({document:{querySelector:selector=>selector==='#statistics-completed-trades'?container:count}});
 vm.runInContext(source,context);
 const trade={tradeId:'TEST:1',symbol:'TESTUSDT',outcome:{status:'Stopped',resultR:value,entryPrice:0.123456789012345,exitPrice:0.234567890123456,activatedAt:'2026-09-23T08:10:00Z',checkedAt:'2026-09-24T09:20:00Z'}};
 const before=structuredClone(trade);context.renderCompletedTrades([], [trade],1);assert.deepEqual(trade,before);
 return container.innerHTML;
}
for(const [value,expected]of [[0.234270134,'+0.23R'],[0.743327886,'+0.74R'],[-1,'-1R'],[0,'0R'],[-0.234270134,'-0.23R'],[1,'+1R'],[-0.001,'0R'],[null,'—'],[NaN,'—'],[Infinity,'—']])test(`Result ${value} displays ${expected} without modifying stored trade`,()=>assert.ok(render(value).includes(`Result<strong>${expected}</strong>`)));
test('metadata preserves Entry/Exit precision and readable separate dates/times',()=>{
 const output=render(0.743327886);
 assert.match(output,/Entry<strong>0\.123456789012345<\/strong>/);assert.match(output,/Exit<strong>0\.234567890123456<\/strong>/);
 for(const label of ['Entry','Exit','Result','Opened','Closed'])assert.equal(output.split(`<span>${label}<strong>`).length-1,1);
 assert.match(output,/completed-trade-date">23\.09\.2026/);assert.match(output,/completed-trade-date">24\.09\.2026/);
 assert.equal((output.match(/class="completed-trade-time"/g)||[]).length,2);
});
test('classification uses original R, including values rounded to display zero',()=>{
 assert.match(render(0.001),/WIN · STOP LOSS/);assert.match(render(-0.001),/LOSS · STOP LOSS/);assert.match(render(0),/BREAK EVEN/);
});
test('completed metadata reflows by available width and wraps values without truncation',()=>{
 assert.match(html,/\.completed-trade-levels\s*\{\s*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 72px\), 1fr\)\)/);
 assert.match(html,/\.completed-trade-levels strong\s*\{\s*overflow-wrap: anywhere;/);
 assert.match(html,/\.completed-trade-date,\s*\.completed-trade-time\s*\{\s*display: block;\s*white-space: normal;\s*overflow-wrap: anywhere;/);
});
