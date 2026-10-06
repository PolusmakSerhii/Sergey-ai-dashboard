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
