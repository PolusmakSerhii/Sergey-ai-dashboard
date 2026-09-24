import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('    function renderLiquidationFlow('),html.indexOf('    function renderTradeAnalytics('));
class Element {
  children=[]; textContent=''; className='';
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
}
const text=n=>[n.textContent,...n.children.map(text)].join(' ');
function context(data){
 const c={window:{},document:{createElement:()=>new Element()},URL,AbortSignal,API_URL:'https://example.invalid/api/market',fetch:async()=>({ok:true,json:async()=>data})};
 vm.createContext(c);vm.runInContext(source,c);return c;
}
test('daily OI keeps values, sources, UTC periods and unavailable state',()=>{
 const c=context();const data={available:true,priceChangePct:0.86,openInterestChangePct:-1.26,windowStart:'2026-09-22T16:00:00Z',windowEnd:'2026-09-23T16:00:00Z',state:'PRICE_UP_OI_DOWN'};
 const before=JSON.stringify(data),out=c.renderOpenInterestPrice(data);
 for(const value of ['+0.86%','-1.26%','OKX closed candles','CoinGlass · USD','2026-09-22 16:00 UTC','2026-09-23 16:00 UTC','Price rose · OI decreased','context-positive','context-negative'])assert.ok(out.includes(value));
 assert.equal(JSON.stringify(data),before);assert.match(c.renderOpenInterestPrice(null),/N\/A/);
});
test('liquidations preserve amounts, shares, imbalance and dominant-side meaning',()=>{
 const c=context();for(const [side,imbalance] of [['LONG',67.62],['SHORT',-67.62]]){
 const data={available:true,longUsd:5270,shortUsd:1020,longSharePct:83.81,shortSharePct:16.19,imbalancePct:imbalance,dominantSide:side,sideTotalUsd:6290,totalDifferenceUsd:1};
 const before=JSON.stringify(data),out=c.renderLiquidationFlow(data);
 for(const value of ['$5.27K','$1.02K','83.81%','16.19%',`${imbalance>0?'+':''}${imbalance.toFixed(2)}%`,`на стороне ${side}`,'reported total differs'])assert.ok(out.includes(value));
 assert.equal(JSON.stringify(data),before);
 }assert.match(c.renderLiquidationFlow(null),/N\/A/);
});
test('CVD structured values preserve all closed-4h diagnostics without mutating data',async()=>{
 const data={symbol:'TEST',orderFlow:{available:true,deltaUsd:31242,cvdUsd:-290067,startTime:100000,endTime:200000},context4h:{liquidations:{available:true,longUsd:10,shortUsd:20,relativeToBaseline:1.5,dominantSide:'SHORT',startTime:100000,endTime:200000},oiPrice:{available:true,priceChangePct:2,openInterestChangePct:-3,startTime:100000,endTime:200000}}};
 const before=JSON.stringify(data),c=context(data),details=new Element(),el=new Element();
 el.isConnected=true;el.parentElement={querySelector:()=>details};await c.loadOrderFlow('TEST',el);
 assert.match(text(el),/\+\$31,242/);assert.match(text(el),/-\$290,067/);assert.match(text(el),/1970-01-01T00:01:40.000Z/);
 for(const value of ['LONG $10','SHORT $20','1.50×','SHORT','2.00%','-3.00%','Binance futures','CoinGlass','OKX'])assert.ok(details.textContent.includes(value));
 assert.equal(JSON.stringify(data),before);
});
test('missing order flow remains N/A; details closed by default and layout scoped',async()=>{
 const c=context(null),el=new Element();el.isConnected=true;el.parentElement={querySelector:()=>null};await c.loadOrderFlow('EMPTY',el);assert.match(el.textContent,/N\/A/);
 assert.match(html,/<details><summary>Дополнительные данные<\/summary>/);
 assert.match(html,/\.market-context \.liquidation-flow-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
 assert.match(html,/\.liquidation-flow-grid > div \{ min-width: 0; \}/);
 assert.match(html,/overflow-wrap: anywhere/);
});
