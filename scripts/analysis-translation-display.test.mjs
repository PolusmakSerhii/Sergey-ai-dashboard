import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('    function coinAnalysisRussian('),end=html.indexOf('    async function openCoinModal(',start);
const source=html.slice(start,end),c={};vm.runInNewContext(source,c);
const tr=(section,text)=>c.coinAnalysisRussian(section,text);
const render=(section,text)=>c.coinAnalysisEscape(text)+c.coinAnalysisTranslation(section,text);
test('all literal dictionary mappings resolve exactly in their own context',()=>{
 const contexts=['label','recommendation','environment','reason','smart-money'];
 const dictionaries=[...source.matchAll(/const (?:labels|values|common) = \{([\s\S]*?)\n\s*\};/g)].map(m=>m[1]).join('\n');
 const pairs=[...dictionaries.matchAll(/"([^"\n]+)"\s*:\s*"([^"\n]*[А-Яа-я][^"\n]*)"/g)];
 assert.ok(pairs.length>45);
 for(const [,en,ru] of pairs)assert.ok(contexts.some(ctx=>tr(ctx,en)===ru),en);
});
for(const side of ['Bullish','Bearish'])test(side+' static and numeric reason families',()=>{
 const lower=side.toLowerCase();
 for(const text of ['Strong '+lower+' EMA trend','RSI confirms '+lower+' momentum',...['break of structure','change of character','market structure shift','candle imbalance','Smart Money','Smart Money score','FVG detected','order block detected','structure'].map(x=>side+' '+x),'Strong '+lower+' confluence'])assert.ok(tr('reason',text),text);
 for(const kind of ['FVG','order block'])for(const range of ['97.700-97.830','1e-8–2e-8'])assert.ok(tr('reason',side+' '+kind+' near price: '+range).endsWith(range));
 assert.ok(tr('reason',side+' derivatives signal: +08').endsWith('+08'));
 assert.ok(tr('reason',side+' volume confirmation: 0.170x average volume').includes('0.170×'));
 assert.ok(tr('reason',side+': MACD above zero'));
});
test('liquidity, zones and derivative factors retain cautious semantics',()=>{
 for(const side of ['highs','lows'])assert.ok(tr('reason','Equal '+side+' liquidity near 97.1900').endsWith('97.1900'));
 for(const zone of ['discount','premium'])for(const prefix of ['Price in ','Price is in '])assert.ok(tr('smart-money',prefix+zone+' zone'));
 for(const label of ['Funding','Open Interest','Long/Short','Liquidations'])for(const bias of ['Bullish','Bearish'])assert.ok(tr('reason','Derivatives: '+label+': '+bias+' Contrarian'));
 assert.equal(tr('reason','Derivatives: unknown factor'),null);
 assert.match(tr('smart-money','Buy-side liquidity sweep'),/выше предыдущего максимума/);
 assert.match(tr('smart-money','Sell-side liquidity sweep'),/ниже предыдущего минимума/);
});
test('environment variants preserve exact numeric fragments and never grant permission',()=>{
 for(const prefix of ['Very high','Healthy','Low','Very low'])assert.ok(tr('environment',prefix+' market participation: 0.170x average volume').includes('0.170×'));
 for(const prefix of ['Volatility is too low','Tradable volatility','Elevated volatility','Extreme volatility'])assert.ok(tr('environment',prefix+': ATR 1.230%').endsWith('1.230%'));
 for(const condition of ['Excellent','Healthy','Caution','Poor','Dangerous'])assert.ok(tr('environment','Condition: '+condition));
 for(const yes of ['YES','NO'])assert.match(tr('environment','Tradable: '+yes),/Не является разрешением на вход/);
 assert.equal(tr('environment','Score: 50 / 100'),'Оценка рыночной среды: 50 / 100');
});
test('known summaries and instructions preserve Active and candidate semantics',()=>{
 const active='Existing trade follows its frozen plan. Live analysis does not authorize a new entry.';
 const analysis='Analysis only. No new entry permission; follow the Execution status.';
 for(const candidate of ['Directional analysis','Bullish candidate','Bearish candidate']){
 assert.match(tr('summary',candidate+'. '+active),/Текущий анализ не разрешает новый вход/);
 assert.match(tr('summary',candidate+'. '+analysis),/Разрешения на новый вход нет/);
 }
 for(const side of ['BUY','SELL'])assert.ok(tr('summary',side+' setup confirmed. Signal strength 88/100 and confidence 90/100.').includes('88/100'));
 for(const side of ['Bullish','Bearish','Neutral'])assert.ok(tr('summary',side+' market bias, but no confirmed trade. Signal strength 88/100 and confidence 90/100.'));
 for(const text of ['Entry is allowed only between 1.000 and 2e-8','Wait for price to return to the entry zone 1.000 - 2e-8']){
 const out=tr('recommendation',text);assert.ok(out.includes('1.000'));assert.ok(out.includes('2e-8'));
 }
});
test('unknown/future strings remain safely visible; source objects unchanged; no I/O',()=>{
 const data=Object.freeze({status:'Future <img onerror="x">',value:97.700});
 const before=JSON.stringify(data);
 for(const ctx of ['reason','summary','recommendation','environment','unknown']){
 assert.equal(tr(ctx,data.status),null);const out=render(ctx,data.status);
 assert.ok(out.includes('&lt;img'));assert.doesNotMatch(out,/<img|coin-analysis-ru/);
 }
 assert.equal(JSON.stringify(data),before);
 assert.equal(tr('reason','Bullish FVG near price: <script>-4'),null);
 assert.equal(tr('summary',null),null);
 assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|localStorage|sessionStorage|redis|setTimeout/i);
});
test('actual render bindings include all sections; metrics and decision logic unchanged',()=>{
 const hash=s=>createHash('sha256').update(s.trim()).digest('hex');
 const segment=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
 assert.equal(hash(segment(html,'    function getAnalysisDiagnosticDisplay(','    // Presentation only:')),'a8dbf4982243d135d1906ebd89e80b7b80172a66283215039eb013d44d5ea132');
 assert.equal(hash(segment(html,'const tradeStatistics =','console.log("Trade Statistics:"')),'373ec0154dc576c470d06c2ce0e8b3d80876fe333cd8535be6ecdc9ff59b5a79');
 for(const key of ['confidence','conviction ?? 0','signalStrength ?? 0','setupScore ?? 0'])assert.ok(html.includes('style="width:${tradeStatistics.'+key+'}%"'));
 for(const ctx of ['summary','recommendation','reason','smart-money','environment','label'])assert.ok(html.slice(end).includes('coinAnalysisTranslation("'+ctx+'"'));
 assert.match(html,/#coin-analysis-content \.coin-analysis-ru \{[^}]*font-size:11px;[^}]*line-height:1.4;[^}]*margin-top:3px;[^}]*overflow-wrap:anywhere/);
 assert.doesNotMatch(html,/\.coin-analysis-ru::before/);
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=|application\/ld\+json/.test(m[1]))new vm.Script(m[2]);
});
