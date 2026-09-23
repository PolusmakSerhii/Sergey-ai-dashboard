// No secret is present here. Server-side session + proxy enforce authorization.
(function () {
  const nativeFetch=window.fetch.bind(window);
  let redirecting=false;
  const domReady = document.readyState === 'loading'
    ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, {once:true}))
    : Promise.resolve();
  function redirectToLogin() {
    if (!redirecting) { redirecting = true; window.location.assign('/login.html'); }
  }
  let accessError = 'Не удалось проверить Private Access. Обновите страницу.';
  const sessionReady = (async () => {
    try {
      const response = await nativeFetch('/api/session', {method:'GET', credentials:'same-origin',
        cache:'no-store', redirect:'error', signal:AbortSignal.timeout(15000)});
      if (response.status === 401 || response.status === 403) { redirectToLogin(); return false; }
      if (response.status === 503) {
        accessError = 'Ошибка конфигурации Private Access. Dashboard не запущен. Обратитесь к владельцу платформы.';
        return false;
      }
      return response.status === 200 && (await response.json()).ok === true;
    } catch { return false; }
  })();
  // Keep every Dashboard script inert until the server confirms the session.
  (async () => {
    await domReady;
    const status = document.querySelector('#private-access-status');
    if (!(await sessionReady)) { status.textContent = accessError; return; }
    try {
      for (const placeholder of document.querySelectorAll('script[data-private-dashboard]')) {
        const script = document.createElement('script');
        const src = placeholder.getAttribute('data-private-src');
        if (src) {
          await new Promise((resolve, reject) => {
            script.onload = resolve; script.onerror = reject;
            script.src = src; script.async = false;
            placeholder.replaceWith(script);
          });
        } else {
          script.textContent = placeholder.textContent;
          placeholder.replaceWith(script);
        }
      }
      status.remove();
      document.documentElement.removeAttribute('data-private-access');
    } catch {
      status.textContent = 'Не удалось загрузить Dashboard. Обновите страницу.';
    }
  })();
  window.fetch=async function(input,options) {
    const original=new URL(input instanceof Request ? input.url : String(input),window.location.href);
    const backend = original.origin === 'https://sergey-ai-trader-api.vercel.app';
    const proxyRequest = original.origin === window.location.origin && original.pathname === '/api/private';
    if ((backend || proxyRequest) && !(await sessionReady)) throw Error('Private access not verified');
    if(!backend)return nativeFetch(input,options);
    const match=/^\/api\/(market|news|chat)$/.exec(original.pathname);
    if(!match)throw Error('Unsupported private endpoint');
    const proxy=new URL('/api/private',window.location.origin);
    proxy.search=original.search;proxy.searchParams.set('endpoint',match[1]);
    const request=new Request(input,options);
    const headers=new Headers(request.headers);headers.delete('Authorization');headers.delete('x-sm1m-analysis-source');
    const response=await nativeFetch(new Request(proxy,request),{headers,credentials:'same-origin',redirect:'error'});
    if(response.status===401)redirectToLogin();
    return response;
  };
})();
