import {configuration,sameOrigin,validSession,privateHeaders} from '../server/private-session.js';
export default async function handler(req,res) {
  privateHeaders(res);
  let config;
  try{config=configuration();}catch{return res.status(503).json({ok:false,error:'Private access unavailable'});}
  if(!sameOrigin(req,config,req.method!=='GET'))return res.status(403).json({ok:false,error:'Forbidden origin'});
  if(!validSession(req,config))return res.status(401).json({ok:false,error:'Unauthorized'});
  const endpoint=req.query?.endpoint;
  const diagnostic=['open-trades-diagnostic','forward-storage-diagnostic'].includes(endpoint);
  const forward=['forward-worker','forward-lifecycle','forward-activation','open-trades-repair'].includes(endpoint);
  if((!diagnostic&&!forward&&!['market','news','chat'].includes(endpoint))||!['GET','POST'].includes(req.method))return res.status(404).json({ok:false});
  if(diagnostic&&req.method!=='GET')return res.status(405).json({ok:false});
  if(forward&&req.method!=='POST')return res.status(405).json({ok:false});
  if(!diagnostic&&!forward&&String(req.query.refresh||'false').toLowerCase()==='true')return res.status(403).json({ok:false,error:'Refresh requires scheduler authorization'});
  if(!forward&&req.method==='POST' && !(endpoint==='chat'||(endpoint==='market'&&req.query.mode==='risk-manager')))return res.status(405).json({ok:false});
  // Temporary incident-only route: owner session, fixed production destination, no client payload.
  const url=endpoint==='open-trades-repair'
    ? new URL('https://sergey-ai-trader-api.vercel.app/api/open-trades-repair')
    : endpoint==='forward-storage-diagnostic' ? new URL('https://sergey-ai-trader-api.vercel.app/api/forward-storage-diagnostic')
    : diagnostic ? new URL('https://sergey-ai-trader-api.vercel.app/api/open-trades-diagnostic')
    : new URL('/api/'+endpoint,config.backend);
  for(const [key,value]of Object.entries((forward||diagnostic)?{}:req.query||{})) {
    if(key==='endpoint')continue;
    if(typeof value!=='string'||value.length>2048)return res.status(400).json({ok:false});
    url.searchParams.set(key,value);
  }
  try{
    const response=await fetch(url,{method:req.method,redirect:'error',signal:AbortSignal.timeout(60000),
      headers:{Authorization:`Bearer ${config.apiSecret}`,'Content-Type':'application/json',Origin:config.frontend},
      ...(req.method==='POST'?{body:JSON.stringify(forward?{}:req.body||{})}:{})});
    const payload=await response.json();
    if((forward||diagnostic)&&JSON.stringify(payload)?.includes(config.apiSecret))return res.status(502).json({ok:false,error:'Private backend unavailable'});
    return res.status(response.status).json(payload);
  }catch{return res.status(502).json({ok:false,error:'Private backend unavailable'});}
}
