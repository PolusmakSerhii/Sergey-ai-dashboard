import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import session from '../api/session.js';
import proxy from '../api/private.js';
import {configuration,signSession,validSession,COOKIE,TTL} from '../server/private-session.js';
const env={SM1M_SESSION_SECRET:'session-test-'.repeat(4),SM1M_OWNER_PASSWORD:'password-test-'.repeat(4),SM1M_API_SECRET:'backend-test-'.repeat(4),SM1M_FRONTEND_ORIGIN:'https://dashboard.test',SM1M_BACKEND_ORIGIN:'https://backend.test'};
Object.assign(process.env,env);
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
const request=(extra={})=>({method:'GET',headers:{origin:env.SM1M_FRONTEND_ORIGIN},query:{endpoint:'market'},...extra});
const cookie=()=>`${COOKIE}=${signSession(configuration())}`;
test('owner login sets only secure HttpOnly session; logout clears it',async()=>{
 const r=response();await session(request({method:'POST',body:{password:env.SM1M_OWNER_PASSWORD}}),r);
 assert.equal(r.code,200);assert.match(r.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);assert.ok(!JSON.stringify(r).includes(env.SM1M_OWNER_PASSWORD));
 const out=response();await session(request({method:'DELETE'}),out);assert.match(out.headers['Set-Cookie'],/Max-Age=0/);
});
test('invalid password and cross-origin login are denied',async()=>{for(const extra of [{body:{password:'bad'}},{body:{password:env.SM1M_OWNER_PASSWORD},headers:{origin:'https://evil.test'}}]){const r=response();await session(request({method:'POST',...extra}),r);assert.ok([401,403].includes(r.code));}});
test('missing, tampered, duplicate, expired session rejected',()=>{const c=configuration(),token=signSession(c);for(const value of ['',`${COOKIE}=${token}x`,`${COOKIE}=${token}; ${COOKIE}=${token}`,`${COOKIE}=${signSession(c,Date.now()-(TTL+2)*1000)}`])assert.equal(validSession({headers:{cookie:value}},c),false);assert.equal(validSession({headers:{cookie:cookie()}},c),true);});
test('unauthorized proxy and CSRF never fetch backend',async()=>{const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('unexpected');};try{for(const headers of [{},{cookie:'invalid'},{cookie:cookie(),origin:'https://evil.test'},{cookie:cookie(),'sec-fetch-site':'cross-site'}]){const r=response();await proxy(request({headers}),r);assert.ok([401,403].includes(r.code));}assert.equal(calls,0);}finally{global.fetch=original;}});
test('authorized proxy uses fixed destination and server token; ignores forged internal headers',async()=>{const original=global.fetch;let calls=0;global.fetch=async(url,options)=>{calls++;assert.equal(new URL(url).origin,env.SM1M_BACKEND_ORIGIN);assert.equal(options.headers.Authorization,`Bearer ${env.SM1M_API_SECRET}`);assert.equal(options.headers['x-sm1m-analysis-source'],undefined);assert.equal(options.headers.cookie,undefined);assert.equal(options.redirect,'error');return {status:200,json:async()=>({ok:true})};};try{const r=response();await proxy(request({headers:{cookie:cookie(),authorization:'forged','x-sm1m-analysis-source':'scanner'}}),r);assert.equal(r.code,200);assert.equal(calls,1);}finally{global.fetch=original;}});
test('browser refresh, arbitrary endpoints and unsupported POST are denied',async()=>{for(const extra of [{query:{endpoint:'market',refresh:'true'}},{query:{endpoint:'test-okx'}},{method:'POST',query:{endpoint:'market',mode:'scanner'}}]){const r=response();await proxy(request({...extra,headers:{cookie:cookie(),origin:env.SM1M_FRONTEND_ORIGIN}}),r);assert.ok([403,404,405].includes(r.code));}});
test('missing auth configuration fails closed for login and proxy',async()=>{delete process.env.SM1M_API_SECRET;try{for(const handler of [session,proxy]){const r=response();await handler(request(),r);assert.equal(r.code,503);}}finally{Object.assign(process.env,env);}});
test('fetch adapter routes existing market/news/chat requests through same-origin BFF without secrets',async()=>{const calls=[];const window={location:{href:'https://dashboard.test/',origin:'https://dashboard.test',assign(){}},fetch:async(...args)=>{calls.push(args);return {status:200};}};await runAdapter(window);for(const endpoint of ['market','news','chat'])await window.fetch(`https://sergey-ai-trader-api.vercel.app/api/${endpoint}?symbol=OKBUSDT`);assert.equal(calls.length,3);for(const [r,o]of calls){assert.equal(new URL(r.url).origin,'https://dashboard.test');assert.equal(new URL(r.url).pathname,'/api/private');assert.equal(o.credentials,'same-origin');}await window.fetch('https://other.test/');assert.equal(calls[3][0],'https://other.test/');});
test('insecure origins and reused secrets fail closed',()=>{for(const [key,value]of [['SM1M_FRONTEND_ORIGIN','http://dashboard.test'],['SM1M_BACKEND_ORIGIN','https://user:pass@backend.test'],['SM1M_SESSION_SECRET',env.SM1M_API_SECRET]]){process.env[key]=value;assert.throws(configuration);Object.assign(process.env,env);}});
test('adapter preserves POST body and cancellation while stripping client auth',async()=>{let captured;const window={location:{href:'https://dashboard.test/',origin:'https://dashboard.test',assign(){}},fetch:async(r,o)=>{captured={r,o};return {status:200};}};await runAdapter(window);const controller=new AbortController();await window.fetch('https://sergey-ai-trader-api.vercel.app/api/market?mode=risk-manager',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'forged','x-sm1m-analysis-source':'scanner'},body:JSON.stringify({tradeId:'test'}),signal:controller.signal});assert.equal(captured.r.method,'POST');assert.deepEqual(await captured.r.json(),{tradeId:'test'});assert.equal(captured.o.headers.has('Authorization'),false);assert.equal(captured.o.headers.has('x-sm1m-analysis-source'),false);controller.abort();assert.equal(captured.r.signal.aborted,true);});
test('login backstop bounds attempts without Redis',async()=>{const {allowLoginAttempt}=await import('../server/private-session.js');const now=Date.now()+120000;for(let i=0;i<10;i++)assert.equal(allowLoginAttempt(now),true);assert.equal(allowLoginAttempt(now),false);assert.equal(allowLoginAttempt(now+60000),true);});

// Existing transport checks use an already verified session; startup cases below control it explicitly.
async function runAdapter(window) {
 const fetch = window.fetch;
 window.fetch = async (...args) => args[0] === '/api/session'
   ? {status:200,json:async()=>({ok:true})} : fetch(...args);
 vm.runInNewContext(await readFile(new URL('../private-access.js',import.meta.url),'utf8'), {
   window,URL,Request,Headers,AbortSignal,
   document:{readyState:'loading',addEventListener(){}}
 });
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function startup() {
 let resolveSession, rejectSession;
 const session = new Promise((resolve,reject)=>{resolveSession=resolve;rejectSession=reject;});
 const calls=[], redirects=[], scripts=[];
 const status={textContent:'Проверка Private Access…',remove(){this.removed=true;}};
 const root={pending:true,removeAttribute(name){assert.equal(name,'data-private-access');this.pending=false;}};
 const window={location:{href:'https://dashboard.test/',origin:'https://dashboard.test',assign(url){redirects.push(url);}},
   fetch:async(input,options)=>{calls.push({input,options});return input==='/api/session'?session:{status:200};}};
 const placeholders=[
   {textContent:'window.initialized = true; window.dashboardRequest = window.fetch("https://sergey-ai-trader-api.vercel.app/api/market?mode=scanner&globalRank=true");',getAttribute(){return null;}},
   {getAttribute(){return './dependency.js';}}
 ];
 let context;
 for(const p of placeholders)p.replaceWith=script=>{scripts.push(script);if(script.src)queueMicrotask(()=>script.onload());else vm.runInContext(script.textContent,context);};
 const document={readyState:'complete',documentElement:root,
   querySelector(){return status;},querySelectorAll(){return placeholders;},createElement(){return {};}};
 context=vm.createContext({window,document,URL,Request,Headers,AbortSignal});
 vm.runInContext(await readFile(new URL('../private-access.js',import.meta.url),'utf8'),context);
 return {window,calls,redirects,scripts,status,root,resolveSession,rejectSession};
}
test('session 200 permits Dashboard initialization only after verification; scripts retain order',async()=>{
 const h=await startup();await settle();assert.equal(h.window.initialized,undefined);assert.equal(h.scripts.length,0);assert.equal(h.root.pending,true);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].input,'/api/session');assert.equal(h.calls[0].options.credentials,'same-origin');
 h.resolveSession({status:200,json:async()=>({ok:true})});await settle();await h.window.dashboardRequest;
 assert.equal(h.window.initialized,true);assert.equal(h.scripts.length,2);assert.equal(h.scripts[1].src,'./dependency.js');
 assert.equal(h.root.pending,false);assert.equal(h.status.removed,true);assert.equal(h.calls.length,2);
});
for(const code of [401,403])test(`session ${code} redirects without initializing or requesting protected data`,async()=>{
 const h=await startup();h.resolveSession({status:code});await settle();assert.deepEqual(h.redirects,['/login.html']);
 assert.equal(h.scripts.length,0);assert.equal(h.window.initialized,undefined);assert.equal(h.root.pending,true);assert.equal(h.calls.length,1);
});
test('session 503 shows configuration error and blocks initialization without login redirect',async()=>{
 const h=await startup();h.resolveSession({status:503});await settle();assert.match(h.status.textContent,/Ошибка конфигурации Private Access/);
 assert.deepEqual(h.redirects,[]);assert.equal(h.scripts.length,0);assert.equal(h.root.pending,true);assert.equal(h.calls.length,1);
});
for(const failure of ['network','unexpected status','invalid payload'])test(`session ${failure} fails closed`,async()=>{
 const h=await startup();if(failure==='network')h.rejectSession(Error('offline'));else h.resolveSession({status:failure==='unexpected status'?500:200,json:async()=>({ok:false})});
 await settle();assert.equal(h.scripts.length,0);assert.equal(h.root.pending,true);assert.match(h.status.textContent,/Не удалось проверить Private Access/);assert.deepEqual(h.redirects,[]);assert.equal(h.calls.length,1);
});
test('premature protected fetch waits for session; denial never reaches native fetch',async()=>{
 for(const allow of [true,false]){
   const h=await startup();const pending=h.window.fetch('/api/private?endpoint=market');
   const outcome=pending.then(()=>true,()=>false);await settle();assert.equal(h.calls.length,1);
   h.resolveSession({status:allow?200:401,json:async()=>({ok:true})});assert.equal(await outcome,allow);await settle();
   if(!allow)assert.equal(h.calls.length,1);
 }
});
test('index has a hidden initial state and every Dashboard script is inert until auth loader runs',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/<html[^>]+data-private-access="pending"/);assert.match(html,/body > :not\(#private-access-status\).*display: none !important/);
 const tags=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];assert.equal(tags.length,8);
 assert.match(tags[0][1],/src="\.\/private-access.js"/);
 for(const [,attrs]of tags.slice(1)){assert.match(attrs,/type="text\/plain"/);assert.match(attrs,/data-private-dashboard/);assert.doesNotMatch(attrs,/(?:^|\s)src=/);}
 assert.deepEqual(tags.slice(2).map(([,attrs])=>attrs.match(/data-private-src="([^"]+)"/)[1]),[
 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js','./coin-overview.js','./risk-manager.js','./entry-setups.js','./market-data.js','./ai-chart.js']);
 new vm.Script(tags[1][2]);
});
