const form=document.querySelector('#login-form'),status=document.querySelector('#status');
form.addEventListener('submit',async event=>{
  event.preventDefault();const input=form.elements.password,button=form.querySelector('button');button.disabled=true;
  try{
    const response=await fetch('/api/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input.value})});
    input.value='';
    if(response.ok){window.location.assign('/');return;}
    status.textContent=response.status===503?'Private access ещё не настроен.':response.status===429?'Слишком много попыток. Повторите позже.':'Доступ не подтверждён.';
  }catch{input.value='';status.textContent='Сервис входа недоступен.';}finally{button.disabled=false;}
});
document.querySelector('#logout').addEventListener('click',async()=>{
  try{const r=await fetch('/api/session',{method:'DELETE',credentials:'same-origin'});status.textContent=r.ok?'Сессия завершена.':'Не удалось завершить сессию.';}catch{status.textContent='Сервис недоступен.';}
});
