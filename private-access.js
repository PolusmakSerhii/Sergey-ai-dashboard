// No secret is present here. Server-side session + proxy enforce authorization.
(function () {
  const nativeFetch=window.fetch.bind(window);
  let redirecting=false;
  window.fetch=async function(input,options) {
    const original=new URL(input instanceof Request ? input.url : String(input),window.location.href);
    if(original.origin!=='https://sergey-ai-trader-api.vercel.app')return nativeFetch(input,options);
    const match=/^\/api\/(market|news|chat)$/.exec(original.pathname);
    if(!match)throw Error('Unsupported private endpoint');
    const proxy=new URL('/api/private',window.location.origin);
    proxy.search=original.search;proxy.searchParams.set('endpoint',match[1]);
    const request=new Request(input,options);
    const headers=new Headers(request.headers);headers.delete('Authorization');headers.delete('x-sm1m-analysis-source');
    const response=await nativeFetch(new Request(proxy,request),{headers,credentials:'same-origin',redirect:'error'});
    if(response.status===401&&!redirecting){redirecting=true;window.location.assign('/login.html');}
    return response;
  };
})();
