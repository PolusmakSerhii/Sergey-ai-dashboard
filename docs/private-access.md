# SM1M private access

## Boundary and audit

Before this change, all five backend API handlers were publicly callable. CORS and origin checks were not authentication. In particular, a successful single-market SWAP GET could call `registerLiveAnalysisTrade` and atomically register a canonical A+ trade. Global Ranking POST refresh already required a QStash signature.

| Handler/path | Existing effects after authorization |
| --- | --- |
| market scanner/ranking | Cached Redis reads; internal scanner/provider requests; signed refresh persists Ranking, open trades/history, statistics and research/archive hooks |
| market single-market | Providers; canonical A+ registration/open-trade/archive writes |
| market statistics, entry-setups, validation-archive | Existing Redis reads |
| market risk-manager | Existing open trades read and price/candle providers; no execution authorization |
| market symbols/ticker/chart/order-flow | Existing provider/cache paths |
| news | Existing cache read; RSS fetch/cache write on miss |
| chat | Existing OpenAI call and Redis rate limiting |
| test-okx, coinglass-test | Now always 404; no provider access |

All user requests are authenticated before these effects. OPTIONS remains a side-effect-free preflight. Invalid/missing API token returns 401; missing/short secret returns 503. Denied requests do not call Redis/providers. Trading functions and formulas are unchanged.

## Model

Owner password → `/api/session` → signed 8-hour `__Host-sm1m-session` cookie (Secure, HttpOnly, SameSite=Strict) → same-origin `/api/private` → backend server-only bearer secret. Login and POST/DELETE require the configured Origin; cross-site fetch metadata is rejected. GET proxy also requires a valid session. The proxy only forwards market/news/chat JSON requests to the configured backend and does not forward client credentials, scanner headers or QStash signatures. Redirects are rejected. Browser refresh=true is denied.

`private-access.js` reroutes existing browser fetches to that proxy without changing chart/trading code. It contains no secret. Owner visits `/login.html`, enters the owner password and is returned to the dashboard. Logout is available on the login page. No secret/session is saved in localStorage.

This is one shared owner identity, not per-user roles or individual revocation. Give the password only to explicitly authorized people. Password rotation affects future login; rotate SESSION_SECRET to revoke ALL outstanding cookies immediately. Logout clears the current browser cookie; a copied cookie remains valid until expiry/key rotation.

## Required Vercel environment configuration (do not put values in Git)

Backend:
- `SM1M_API_SECRET`: secret, at least 32 cryptographically random characters.
- `SM1M_BACKEND_ORIGIN`: exact HTTPS backend origin, without path/query. Set explicitly per environment. Fallback is the current production backend origin.
- Keep existing `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` unchanged.

Frontend server functions:
- `SM1M_API_SECRET`: same secret as backend.
- `SM1M_SESSION_SECRET`: separate random secret, at least 32 characters.
- `SM1M_OWNER_PASSWORD`: separate high-entropy owner password, at least 32 characters.
- `SM1M_FRONTEND_ORIGIN`: `https://sergey-ai-dashboard.vercel.app` (or the exact chosen canonical dashboard origin).
- `SM1M_BACKEND_ORIGIN`: `https://sergey-ai-trader-api.vercel.app` (or the matching environment's exact backend origin).

All three frontend secrets must differ. Do not use public/build-exposed environment variable prefixes. Missing/invalid frontend configuration returns 503. Preview environments need their own explicit origins/secrets; never give untrusted preview code production secrets. Existing chat Origin policy remains tied to the production dashboard origin (alternate domains need a separately reviewed configuration change).

## Background refresh

Only the existing POST scanner/globalRank/refresh route can use the existing successfully verified QStash signature instead of a user API token. Backend API configuration is still required. Internal batch and single-symbol scanner requests carry the server bearer token and use a fixed configured origin, never incoming Host. The existing scanner marker continues to suppress live registration. Redirects cannot forward the bearer elsewhere. No browser session is needed by QStash.

## Rate limits and cost

Login has a best-effort ten attempts/minute PER FUNCTION INSTANCE backstop. It is not a global distributed limiter; add a Vercel WAF rule for `/api/session` POST before public rollout. A strong generated owner password remains mandatory. Existing chat Redis rate limits remain unchanged. Authentication/session validation adds zero Redis commands; no per-static-asset Redis access. Authorized browser API calls now add one frontend function hop, one server-to-server request, and associated Vercel cost/latency.

## Deployment boundary / external actions required

This implementation protects data/API access, NOT delivery of static HTML/JS. Enable Vercel Deployment Protection with a scope explicitly covering the production domain AND deployment aliases if the entire dashboard must be private. Check plan/scope support in the actual project; do not assume Standard Protection covers production. Invite only authorized users. Git repository visibility is a separate control and was not changed.

Existing older deployment URLs remain old code: restrict/remove their public access separately; deploying new authenticated code does not retroactively protect them. Do not blindly enable backend platform protection: it can block QStash/internal scanner before application signature/token checks. Any platform automation bypass must be configured and verified separately without exposing it to browser code.

Configure secrets for both projects, coordinate deployment of both repositories, then verify login/logout, all dashboard API views and an actual scheduled signed refresh. There is no unauthenticated fallback during deployment. Ensure the proxy function duration supports its 60-second upstream timeout; verify actual Vercel runtime/plan limits. No Vercel settings, secrets, deployment or production data were changed by this task.

References: https://vercel.com/docs/deployment-protection and https://vercel.com/docs/functions/runtimes/node-js
