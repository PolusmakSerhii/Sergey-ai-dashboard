import {configuration,sameOrigin,validSession,privateHeaders} from '../server/private-session.js';
export default async function handler(req,res) {
  privateHeaders(res);
  let config;
  try{config=configuration();}catch{return res.status(503).json({ok:false,error:'Private access unavailable'});}
  if(!sameOrigin(req,config,req.method!=='GET'))return res.status(403).json({ok:false,error:'Forbidden origin'});
  if(!validSession(req,config))return res.status(401).json({ok:false,error:'Unauthorized'});
  const endpoint=req.query?.endpoint;
  if(!['market','news','chat'].includes(endpoint)||!['GET','POST'].includes(req.method))return res.status(404).json({ok:false});
  if(String(req.query.refresh||'false').toLowerCase()==='true')return res.status(403).json({ok:false,error:'Refresh requires scheduler authorization'});
  if(req.method==='POST' && !(endpoint==='chat'||(endpoint==='market'&&req.query.mode==='risk-manager')))return res.status(405).json({ok:false});
  const url=new URL('/api/'+endpoint,config.backend);
  for(const [key,value]of Object.entries(req.query||{})) {
    if(key==='endpoint')continue;
    if(typeof value!=='string'||value.length>2048)return res.status(400).json({ok:false});
    url.searchParams.set(key,value);
  }
  try{
    const response=await fetch(url,{method:req.method,redirect:'error',signal:AbortSignal.timeout(60000),
      headers:{Authorization:`Bearer ${config.apiSecret}`,'Content-Type':'application/json',Origin:config.frontend},
      ...(req.method==='POST'?{body:JSON.stringify(req.body||{})}:{})});
    const payload=await response.json();
    return res.status(response.status).json(payload);
  }catch{return res.status(502).json({ok:false,error:'Private backend unavailable'});}
}
