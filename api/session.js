import {configuration,sameOrigin,signSession,validSession,sessionCookie,privateHeaders,equal,allowLoginAttempt} from '../server/private-session.js';
export default async function handler(req,res) {
  privateHeaders(res);
  let config;
  try {config=configuration();}catch{return res.status(503).json({ok:false,error:'Private access unavailable'});}
  if(!['GET','POST','DELETE'].includes(req.method))return res.status(405).json({ok:false});
  if(!sameOrigin(req,config,req.method!=='GET'))return res.status(403).json({ok:false});
  if(req.method==='GET')return res.status(validSession(req,config)?200:401).json({ok:validSession(req,config)});
  if(req.method==='DELETE') {res.setHeader('Set-Cookie',sessionCookie('',0));return res.status(200).json({ok:true});}
  if(!allowLoginAttempt()){res.setHeader('Retry-After','60');return res.status(429).json({ok:false,error:'Try again later'});}
  const password=req.body?.password;
  if(typeof password!=='string'||password.length>1024||!equal(password,config.password))return res.status(401).json({ok:false,error:'Invalid credentials'});
  res.setHeader('Set-Cookie',sessionCookie(signSession(config)));
  return res.status(200).json({ok:true});
}
