/* AFFRESCO account UI. Credentials are sent only with JSON POST. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const endpoint='/api/auth.php';
  const stateEndpoint='/api/account-state.php';
  let user=null;
  let drafts={};
  let favorites=[];
  let callback=null;
  let latestStateRequest=0;
  let draftQueue=Promise.resolve();
  async function request(url,method='GET',body){
    const options={method,credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json'}};
    if(method==='POST'){
      options.headers['Content-Type']='application/json';
      options.headers['X-Affresco-Request']='1';
      options.body=JSON.stringify(body);
    }
    const response=await fetch(url,options);
    let result=null;
    try{result=await response.json();}catch(_){}
    if(!response.ok)throw new Error(result?.error||'HTTP '+response.status);
    return result;
  }
  function signedIn(){return Boolean(user);}
  function getDraft(sku){return signedIn()?drafts[sku]||null:null;}
  function updateHeader(){
    const toggle=$('accountToggle'),mobile=$('mobileLogin');
    document.querySelector('.site-header')?.classList.toggle('has-account',Boolean(user));
    if(toggle){
      toggle.hidden=false;
      toggle.textContent=user?user.login:'Войти';
      toggle.title=user?'Личный кабинет: '+user.login:'Войти в личный кабинет';
    }
    if(mobile)mobile.textContent=user?'Личный кабинет · '+user.login:'Войти в личный кабинет';
  }
  function renderDashboard(){
    if(!user)return;
    $('accountName').textContent=user.login;
    const emailField=$('accountEmail');
    if(emailField && document.activeElement!==emailField){
      emailField.value=typeof user.email==='string'?user.email:'';
    }
    $('accountFavorites').textContent=String(favorites.length);
    $('accountEdits').textContent=String(Object.keys(drafts).length);
    $('accountGenerations').textContent=String(user.generations_used||0);
    $('accountQuota').textContent='Лимит генераций: '+String(user.generations_used||0)+
      ' из '+String(user.generations_limit||0)+
      ' · Неудачных попыток: '+String(user.generations_failed||0);
    $('accountActivity').textContent='Входов: '+String(user.login_count||0)+
      ' · Сохранений кадра: '+String(user.updates_count||0);
    $('accountFavoriteList').textContent=favorites.length?'Артикулы: '+favorites.join(', '):
      'Пока нет избранных фресок.';
    const skus=Object.keys(drafts);
    $('accountDraftList').textContent=skus.length?'Артикулы: '+skus.join(', '):
      'Пока нет сохранённых кадров.';
  }
  async function refreshState(){
    if(!signedIn())return;
    const requestNumber=++latestStateRequest;
    const data=await request(stateEndpoint);
    if(requestNumber!==latestStateRequest||!signedIn())return;
    favorites=Array.isArray(data.items)?data.items:[];
    drafts=data.drafts&&typeof data.drafts==='object'?data.drafts:{};
    renderDashboard();
    return data;
  }
  function saveDraft(sku,payload){
    if(!signedIn())return Promise.resolve();
    const userId=String(user.id);
    draftQueue=draftQueue.catch(()=>{}).then(async()=>{
      if(!signedIn()||String(user.id)!==userId)return;
      const data=await request(stateEndpoint,'POST',{action:'save_draft',sku,draft:payload});
      if(!signedIn()||String(user.id)!==userId)return;
      drafts=data.drafts&&typeof data.drafts==='object'?data.drafts:drafts;
      renderDashboard();
    });
    return draftQueue;
  }
  function setCollection(data){
    if(!signedIn()||!data)return;
    favorites=Array.isArray(data.items)?data.items:[];
    if(data.drafts&&typeof data.drafts==='object')drafts=data.drafts;
    renderDashboard();
  }
  function openWindow(which){
    window.dispatchEvent(new CustomEvent('affresco:open-modal',{detail:which}));
  }
  const ready=(async()=>{
    try{
      const response=await request(endpoint);
      if(response?.authenticated===true && response.account?.login){
        user=response.account;
        await refreshState();
      }
    }catch(_){}
    updateHeader();
    renderDashboard();
  })();
  $('accountToggle')?.addEventListener('click',()=>{
    if(signedIn()){void refreshState().finally(()=>openWindow('account'));}
    else openWindow('login');
  });
  $('mobileLogin')?.addEventListener('click',()=>{
    $('menuToggle')?.click();
    if(signedIn()){void refreshState().finally(()=>openWindow('account'));}
    else openWindow('login');
  });
  $('loginForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=$('loginSubmit'),feedback=$('loginFeedback');
    if(button.disabled)return;
    button.disabled=true;
    feedback.textContent='Проверяем данные…';
    const password=$('loginPassword').value,login=$('loginName').value.trim();
    try{
      const response=await request(endpoint,'POST',{action:'login',login,password});
      if(!response?.authenticated)throw Error('login_not_confirmed');
      $('loginPassword').value='';
      window.location.reload();
    }catch(error){
      const map={invalid_credentials:'Неверный логин или пароль.',
        too_many_attempts:'Слишком много попыток. Повторите через 15 минут.',
        accounts_not_configured:'Файл аккаунтов недоступен для PHP. Проверьте путь на FTP.'};
      feedback.textContent=map[error.message]||'Не удалось войти. Повторите попытку.';
      button.disabled=false;
    }
  });
  $('accountEmailForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!signedIn())return;
    const input=$('accountEmail');
    if(!input.reportValidity())return;
    const value=input.value.trim();
    const button=$('accountEmailSubmit'),feedback=$('accountEmailFeedback');
    button.disabled=true;
    feedback.textContent='Сохраняем адрес…';
    try{
      const data=await request('/api/account-email.php','POST',{email:value});
      user.email=data.email;
      feedback.textContent='Электронная почта сохранена.';
      renderDashboard();
    }catch(error){
      const errors={invalid_email:'Проверьте адрес электронной почты.',
        email_storage_unavailable:'Не удалось записать адрес в accounts.json на сервере.'};
      feedback.textContent=errors[error.message]||'Не удалось сохранить адрес.';
    }finally{button.disabled=false;}
  });
  $('logoutButton')?.addEventListener('click',async()=>{
    const button=$('logoutButton');
    button.disabled=true;
    $('accountFeedback').textContent='';
    try{
      await request(endpoint,'POST',{action:'logout'});
      window.location.reload();
    }catch(_){
      $('accountFeedback').textContent='Выход не удался. Попробуйте снова.';
      button.disabled=false;
    }
  });
  window.affrescoAccount={
    ready, signedIn, getDraft, saveDraft, setCollection, refreshState,
    current:()=>user,
    savedEmail:()=>signedIn() && typeof user.email==='string'?user.email:'',
    setEmailFromSend:email=>{
      if(signedIn()){
        user.email=email;
        renderDashboard();
      }
    },
    url:()=>signedIn()?stateEndpoint:'/api/favorites.php'
  };
})();
