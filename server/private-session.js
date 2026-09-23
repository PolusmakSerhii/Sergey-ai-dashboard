import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';
export const COOKIE = '__Host-sm1m-session';
export const TTL = 8 * 60 * 60;
const digest = value => createHash('sha256').update(value).digest();
export const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
export function configuration() {
  const sessionSecret = process.env.SM1M_SESSION_SECRET;
  const password = process.env.SM1M_OWNER_PASSWORD;
  const apiSecret = process.env.SM1M_API_SECRET;
  if (![sessionSecret, password, apiSecret].every(s => typeof s === 'string' && s.length >= 32) ||
      new Set([sessionSecret,password,apiSecret]).size !== 3) throw Error('Private access unavailable');
  const frontend = new URL(process.env.SM1M_FRONTEND_ORIGIN);
  const backend = new URL(process.env.SM1M_BACKEND_ORIGIN);
  for (const url of [frontend,backend]) if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw Error('Invalid origin');
  return {sessionSecret,password,apiSecret,frontend:frontend.origin,backend:backend.origin};
}
export function sameOrigin(req, config, requireOrigin = false) {
  const origin = req.headers?.origin, site = req.headers?.['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return origin ? origin === config.frontend : !requireOrigin;
}
export function signSession(config, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({v:1,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+TTL,
    nonce:randomBytes(16).toString('hex')})).toString('base64url');
  return body+'.'+createHmac('sha256',config.sessionSecret).update(body).digest('base64url');
}
export function validSession(req, config, now = Date.now()) {
  try {
    const header=req.headers?.cookie;
    if(typeof header !== 'string' || header.length > 8192)return false;
    const tokens=header.split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));
    if(tokens.length!==1)return false;
    const [body,signature,...extra]=tokens[0].slice(COOKIE.length+1).split('.');
    if(!body||!signature||extra.length||body.length>1024)return false;
    const expected=createHmac('sha256',config.sessionSecret).update(body).digest('base64url');
    if(!equal(signature,expected))return false;
    const value=JSON.parse(Buffer.from(body,'base64url').toString());
    const time=Math.floor(now/1000);
    return value.v===1 && Number.isInteger(value.iat) && Number.isInteger(value.exp) &&
      value.iat<=time && value.exp>time && value.exp-value.iat===TTL && typeof value.nonce==='string';
  } catch {return false;}
}
export function sessionCookie(value, seconds=TTL) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}
export function privateHeaders(res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
}
// Best-effort per-instance backstop. Distributed enforcement belongs at Vercel WAF.
let attempts=0, windowEnd=0;
export function allowLoginAttempt(now=Date.now()) {
  if(now>=windowEnd){attempts=0;windowEnd=now+60000;}
  return ++attempts<=10;
}
