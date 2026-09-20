import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=readFileSync(new URL('../entry-setups.js',import.meta.url),'utf8');
class Element {constructor(){this.children=[];this.listeners={};this.dataset={};this.value='';}set textContent(v){this.value=String(v);}get textContent(){return this.value+this.children.map(x=>x.textContent).join('|');}set innerHTML(v){throw new Error('Unsafe HTML');}append(...xs){this.children.push(...xs);}replaceChildren(...xs){this.children=xs;this.value='';}addEventListener(k,f){this.listeners[k]=f;}showModal(){this.open=true;}close(){this.open=false;}}
function runtime(enabled=false){const root=new Element(),dialog=new Element(),tabs=new Element();root.dataset.enabled=String(enabled);let calls=0;const c=vm.createContext({window:{fetch:()=>{calls++;throw Error('Unexpected request');}},document:{createElement:()=>new Element(),querySelector:s=>s==='#entry-setups-content'?root:s==='#entry-setups-dialog'?dialog:tabs}});vm.runInContext(source,c);return {api:c.window.Sm1mEntrySetups,root,dialog,tabs,calls:()=>calls};}
const fixture={symbol:'<img src=x onerror=alert(1)>',tradeId:'original',lifecycleStatus:'Active',origin:{confirmedAPlus:true,originalGrade:'A+',detectedAt:'ORIGINAL-TIME'},current:{currentGrade:'C',asOf:'RANKING-TIME'},entryAnalysis:{status:null,structureValid:null},originalPlan:{}};
test('safe rendering, original/current separation and no entry permission',()=>{const r=runtime();r.api.render(r.root,[fixture],r.dialog);assert.ok(r.root.textContent.includes(fixture.symbol));assert.ok(r.root.textContent.includes('Lifecycle: Active'));assert.ok(r.root.textContent.includes('Analysis pending'));r.api.details(fixture,r.dialog);for(const t of ['ORIGINAL A+ PLAN','CURRENT ENTRY ANALYSIS','ORIGINAL-TIME','RANKING-TIME','Does not change trade execution.','N/A'])assert.ok(r.dialog.textContent.includes(t));assert.equal(r.calls(),0);});
const response=(stamp,items=[fixture])=>({ok:true,json:async()=>({ok:true,generatedAt:stamp,setups:items})});
test('out-of-order response cannot overwrite latest request',async()=>{const r=runtime(),pending=[],shown=[];const loader=r.api.createLoader(()=>new Promise(resolve=>pending.push(resolve)),s=>shown.push(s),()=>assert.fail());const a=loader.load(),b=loader.load();pending[1](response('2026-09-20T01:00:00Z'));await b;pending[0](response('2026-09-20T00:00:00Z'));await a;assert.equal(shown.length,1);});
test('older server snapshot and cancelled response cannot overwrite state',async()=>{const r=runtime(),shown=[];let n=0;const loader=r.api.createLoader(async()=>response(n++?'2026-09-19T00:00:00Z':'2026-09-20T00:00:00Z'),s=>shown.push(s),()=>assert.fail());await loader.load();await loader.load();assert.equal(shown.length,1);let resolve;const second=r.api.createLoader(()=>new Promise(r=>resolve=r),()=>assert.fail(),()=>assert.fail());const p=second.load();second.cancel();resolve(response('2026-09-20T00:00:00Z'));await p;});
test('disabled module has no network or tab handlers',()=>{const r=runtime();assert.equal(r.calls(),0);assert.deepEqual(r.tabs.listeners,{});});
test('enabled module loads lazily and exclusively uses read-only mode',async()=>{const r=runtime(true);assert.equal(r.calls(),0);assert.equal(typeof r.tabs.listeners.click,'function');let url;const loader=r.api.createLoader(async u=>{url=u;return response('2026-09-20T00:00:00Z',[{...fixture,origin:{confirmedAPlus:false}}]);},s=>assert.equal(s.length,0),()=>assert.fail());await loader.load();assert.equal(new URL(url).search,'?mode=entry-setups');});
test('tab ordering and integration syntax',()=>{const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');const keys=['global-ranking','entry-setups','top-coins','watchlist'].map(x=>html.indexOf('data-dashboard-tab="'+x+'"'));assert.ok(keys.every((v,i)=>v>=0&&(!i||v>keys[i-1])));for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);new vm.Script(source);});

for (const state of ['success', 'empty', 'error']) test(`tab loading replaces initial placeholder then renders ${state}`, async () => {
  const root = new Element(), dialog = new Element(), tabs = new Element();
  root.dataset.enabled = 'true';
  root.textContent = 'Open this tab to load verified setups.';
  let resolve, calls = 0;
  const c = vm.createContext({ window: { fetch: () => {
    calls++;
    assert.equal(root.textContent, 'Loading Entry Setups...');
    return new Promise(r => { resolve = r; });
  } }, document: { createElement: () => new Element(), querySelector: s =>
    s === '#entry-setups-content' ? root : s === '#entry-setups-dialog' ? dialog : tabs } });
  vm.runInContext(source, c);
  assert.equal(calls, 0);
  assert.equal(root.textContent, 'Open this tab to load verified setups.');
  tabs.listeners.click({ target: { closest: () => ({ dataset: { dashboardTab: 'entry-setups' } }) } });
  assert.equal(calls, 1);
  assert.equal(root.textContent, 'Loading Entry Setups...');
  resolve(state === 'error' ? { ok: false } : response('2026-09-20T00:00:00Z', state === 'empty' ? [] : [fixture]));
  await new Promise(r => setImmediate(r));
  assert.ok(!root.textContent.includes('Loading Entry Setups...'));
  assert.ok(root.textContent.includes(state === 'error' ? 'Entry Setup data unavailable.' :
    state === 'empty' ? 'No verified open A+ setups.' : fixture.symbol));
});
