/* AFFRESCO unified account UI. Credentials travel only in JSON POST. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const endpoint='/api/auth.php',stateEndpoint='/api/account-state.php';
  let user=null,drafts={},favorites=[],guestActivity={};
  let latestStateRequest=0,collectionRevision=0,identityRevision=0;
  let catalogTitles=new Map(),draftQueue=Promise.resolve(),activeTab='Info';
  const tabs=['Info','Favorites','Drafts','Generations'];
  const guestSaveKey='affresco:guest-saves:v1';
  async function request(url,method='GET',body){
    const options={method,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}};
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
  function normalizedFavorites(data){
    return Array.isArray(data.items)?data.items.map(sku=>
      typeof sku==='number'&&Number.isSafeInteger(sku)&&sku>=0?String(sku):sku
    ).filter(sku=>typeof sku==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(sku)):[];
  }
  function signedIn(){return Boolean(user);}
  function getDraft(sku){return signedIn()?drafts[sku]||null:null;}
  function guestDrafts(){
    const result={};
    try{
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);
        if(!key?.startsWith('afreska:crop:v1:'))continue;
        const sku=key.slice('afreska:crop:v1:'.length);
        if(!/^[a-zA-Z0-9_.-]{1,100}$/.test(sku))continue;
        let value;
        try{value=JSON.parse(localStorage.getItem(key)||'null');}catch(_){continue;}
        if(value&&['zoom','dx','dy','ratio','width','height'].every(k=>Number.isFinite(value[k])))result[sku]=value;
      }
    }catch(_){}
    return result;
  }
  function guestSaves(){
    try{
      const value=JSON.parse(localStorage.getItem(guestSaveKey)||'{}');
      return value&&typeof value==='object'?value:{};
    }catch(_){return {};}
  }
  function recordGuestSave(){
    if(signedIn())return;
    try{
      const old=guestSaves();
      localStorage.setItem(guestSaveKey,JSON.stringify({count:Math.max(0,Number(old.count)||0)+1,last:new Date().toISOString()}));
    }catch(_){}
    renderDashboard();
  }
  function dateLabel(value){
    if(!value)return 'Пока нет';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'Пока нет':date.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
  }
  let imageLibraryRevision=0;
  async function renderServerImageLibrary(){
    const target=$('accountServerImageList'),note=$('accountServerImagesFeedback');
    if(!target||!note)return;
    const identity=identityRevision,revision=++imageLibraryRevision;
    target.replaceChildren();
    if(!signedIn()){note.textContent='Войдите, чтобы посмотреть изображения, сохранённые на сервере.';return;}
    note.textContent='Загружаем изображения…';
    try{
      const data=await request('/api/ai-tryon.php?library=1');
      if(identity!==identityRevision||revision!==imageLibraryRevision||!signedIn())return;
      const items=Array.isArray(data.items)?data.items:[];
      note.textContent=items.length?'Сохранено на сервере: '+items.length:'Пока нет сохранённых изображений на сервере.';
      for(const item of items){
        if(!['ai','manual'].includes(item.type)||typeof item.id!=='string'||typeof item.image_url!=='string')continue;
        const card=document.createElement('div');card.className='account-server-image';
        const img=document.createElement('img');img.src=item.image_url;
        img.alt=item.type==='ai'?'AI-визуализация фрески':'Ручная примерка фрески';img.loading='lazy';
        const title=document.createElement('span');title.className='account-server-image-label';
        const date=new Date(Number(item.created)||Date.now());
        title.textContent=(item.type==='ai'?'AI-визуализация':'Ручная примерка')+' · '+date.toLocaleDateString('ru-RU');
        const remove=document.createElement('button');remove.type='button';
        remove.className='account-server-delete';remove.textContent='Удалить';
        remove.setAttribute('aria-label','Удалить '+(item.type==='ai'?'AI-визуализацию':'ручную примерку'));
        remove.addEventListener('click',async()=>{
          if(!window.confirm('Вы уверены, что хотите удалить изображение? Восстановить его будет невозможно.'))return;
          remove.disabled=true;note.textContent='Удаляем изображение…';
          try{
            await request('/api/ai-tryon.php?delete=1','POST',{type:item.type,id:item.id});
            if(identity!==identityRevision)return;
            if(item.type==='manual')await window.affrescoTryon?.removeSavedRecord?.(item.id);
            window.dispatchEvent(new CustomEvent('affresco:ai-image-deleted',{detail:{id:item.id,type:item.type}}));
            await renderServerImageLibrary();
          }catch(error){
            if(identity===identityRevision){
              note.textContent=error.message==='not_found'?'Изображение уже удалено. Обновите список.':'Не удалось удалить изображение. Попробуйте снова.';
              remove.disabled=false;
            }
          }
        });
        card.append(img,title,remove);target.append(card);
      }
    }catch(_){
      if(identity===identityRevision&&revision===imageLibraryRevision)note.textContent='Не удалось загрузить изображения с сервера. Откройте раздел повторно.';
    }
  }
  function selectTab(name,focus=false){
    activeTab=tabs.includes(name)?name:'Info';
    for(const tab of tabs){
      const button=$('accountTab'+tab),selected=tab===activeTab;
      button.setAttribute('aria-selected',String(selected));
      button.tabIndex=selected?0:-1;
      $('accountPanel'+tab).hidden=!selected;
      if(selected&&focus)button.focus();
    }
    if(activeTab==='Generations'){void window.affrescoTryon?.renderHistory?.();void renderServerImageLibrary();}
  }
  for(const name of tabs){
    const button=$('accountTab'+name);
    button.addEventListener('click',()=>selectTab(name));
    button.addEventListener('keydown',event=>{
      let index=tabs.indexOf(name);
      if(event.key==='ArrowRight')index=(index+1)%tabs.length;
      else if(event.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;
      else if(event.key==='Home')index=0;
      else if(event.key==='End')index=tabs.length-1;
      else return;
      event.preventDefault();selectTab(tabs[index],true);
    });
  }
  function updateHeader(){
    const toggle=$('accountToggle'),mobile=$('mobileLogin');
    document.querySelector('.site-header')?.classList.toggle('has-account',signedIn());
    if(toggle){
      toggle.hidden=false;toggle.textContent=user?user.login:'Войти';
      toggle.title=user?'Личный кабинет: '+user.login:'Открыть личный кабинет';
    }
    if(mobile)mobile.textContent=user?'Личный кабинет · '+user.login:'Личный кабинет / Войти';
  }
  function renderSkuList(id,skus,emptyText){
    const target=$(id);target.replaceChildren();
    if(!skus.length){target.textContent=emptyText;return;}
    const fragment=document.createDocumentFragment();
    for(const sku of skus){
      const button=document.createElement('button');
      button.type='button';button.className='account-sku-link';
      button.textContent=(catalogTitles.get(sku)||'Фреска')+' · Арт. '+sku;
      button.setAttribute('aria-label','Открыть редактор фрески, артикул '+sku);
      button.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('affresco:open-fresco',{detail:{sku}})));
      fragment.append(button);
    }
    target.append(fragment);
  }
  function renderDashboard(){
    const member=signedIn(),activity=user||guestActivity,saves=guestSaves();
    const currentDrafts=member?drafts:guestDrafts();
    $('accountGuestAccess').hidden=member;
    $('accountMemberAccess').hidden=!member;
    $('logoutButton').hidden=!member;
    $('accountTitle').textContent=member?'Ваш аккаунт':'Ваше пространство';
    const email=$('accountEmail');
    if(!member)email.value='';
    else if(document.activeElement!==email)email.value=user.email||'';
    $('accountFavorites').textContent=String(favorites.length);
    $('accountEdits').textContent=String(Object.keys(currentDrafts).length);
    $('accountGenerations').textContent=String((user?.generations_used||0)+(activity.manual_generations_used||0));
    $('accountIdentity').textContent=member?'Логин: '+user.login:'Вы просматриваете коллекцию как гость.';
    $('accountScope').textContent=member
      ?'Избранное, кадры и активность принадлежат вашему аккаунту. Гостевые данные хранятся отдельно.'
      :'Избранное связано с гостевой сессией, кадры сохраняются в этом браузере. После входа откроются данные аккаунта.';
    const rows=[
      ['Входов в аккаунт',member?String(activity.login_count||0):'0'],
      ['Последний вход',member?dateLabel(activity.last_login):'Вы не авторизованы'],
      ['Сохранений кадра',member?String(activity.updates_count||0):String(saves.count||0)],
      ['Последнее сохранение',dateLabel(member?activity.last_update:saves.last)],
      ['Отправок на почту',String(activity.emails_count||0)],
      ['Последняя отправка',dateLabel(activity.last_email)],
      ['Ручных примерок',String(activity.manual_generations_used||0)],
      ['Последняя примерка',dateLabel(activity.last_manual_generation)],
      ['AI-генераций',String(user?.generations_used||0)]
    ];
    const list=$('accountActivity');list.replaceChildren();
    for(const [label,value] of rows){
      const dt=document.createElement('dt'),dd=document.createElement('dd');
      dt.textContent=label;dd.textContent=value;list.append(dt,dd);
    }
    $('accountQuota').textContent=member
      ?'AI: использовано '+(user.generations_used||0)+' из '+(user.generations_limit||0)+' · Неудачных попыток: '+(user.generations_failed||0)
      :'AI-примерка будет доступна после входа в аккаунт.';
    $('accountManualQuota').textContent='Ручные примерки: '+String(activity.manual_generations_used||0)+' · Без ограничений';
    $('accountDraftScope').textContent=member?'Кадры вашего аккаунта.':'Кадры, сохранённые в этом браузере.';
    renderSkuList('accountFavoriteList',favorites,'Пока нет избранных фресок.');
    $('accountShowFavorites').hidden=favorites.length===0;
    renderSkuList('accountDraftList',Object.keys(currentDrafts),'Пока нет сохранённых кадров.');
    selectTab(activeTab);
  }
  async function refreshProfile(){
    const revision=identityRevision;
    const response=await request(endpoint);
    if(revision!==identityRevision)return;
    // Do not change identity from an old background request.
    if(Boolean(response.authenticated)!==signedIn())return;
    if(signedIn())user=response.account;
    else guestActivity=response.activity||{};
    renderDashboard();
  }
  async function refreshState(){
    const requestNumber=++latestStateRequest,revision=collectionRevision,identity=identityRevision;
    const data=await request(signedIn()?stateEndpoint:'/api/favorites.php');
    if(requestNumber!==latestStateRequest||revision!==collectionRevision||identity!==identityRevision)return;
    favorites=normalizedFavorites(data);
    if(signedIn())drafts=data.drafts&&typeof data.drafts==='object'?data.drafts:{};
    renderDashboard();return data;
  }
  function saveDraft(sku,payload){
    if(!signedIn())return Promise.resolve();
    const identity=identityRevision;
    draftQueue=draftQueue.catch(()=>{}).then(async()=>{
      if(!signedIn()||identity!==identityRevision)return;
      const data=await request(stateEndpoint,'POST',{action:'save_draft',sku,draft:payload});
      if(!signedIn()||identity!==identityRevision)return;
      drafts=data.drafts&&typeof data.drafts==='object'?data.drafts:drafts;
      if(data.account)user=data.account;
      collectionRevision++;renderDashboard();
    });return draftQueue;
  }
  function setCollection(data){
    if(!data||data.scope!==(signedIn()?'account':'guest'))return;
    favorites=normalizedFavorites(data);collectionRevision++;renderDashboard();
  }
  function setCatalogItems(items){
    catalogTitles=new Map(Array.isArray(items)?items.map(item=>[String(item.sku),typeof item.name==='string'?item.name.trim():null]):[]);
    renderDashboard();
  }
  function openWindow(){window.dispatchEvent(new CustomEvent('affresco:open-modal',{detail:'account'}));}
  function changedIdentity(response){
    identityRevision++;latestStateRequest++;collectionRevision++;imageLibraryRevision++;
    user=response.authenticated?response.account:null;
    guestActivity=response.activity||{};favorites=[];drafts={};
    $('accountEmailFeedback').textContent='';$('accountFeedback').textContent='';
    $('loginFeedback').textContent='Войдите, чтобы открыть данные своего аккаунта.';
    $('backToEditor').hidden=true;
    selectTab('Info');updateHeader();renderDashboard();
    window.dispatchEvent(new CustomEvent('affresco:auth-changed'));
  }
  const ready=(async()=>{
    try{
      const response=await request(endpoint);
      user=response.authenticated===true&&response.account?.login?response.account:null;
      guestActivity=response.activity||{};
      await refreshState();
    }catch(_){$('accountFeedback').textContent='Не удалось загрузить кабинет. Откройте его повторно.';}
    updateHeader();renderDashboard();
  })();
  async function openAccount(){
    await ready;openWindow();
    $('accountFeedback').textContent='';
    try{await Promise.all([refreshState(),refreshProfile()]);}
    catch(_){$('accountFeedback').textContent='Не удалось обновить данные. Закройте и откройте кабинет, чтобы повторить.';}
  }
  $('accountToggle')?.addEventListener('click',()=>{void openAccount();});
  $('mobileLogin')?.addEventListener('click',()=>{$('menuToggle')?.click();void openAccount();});
  $('accountShowFavorites').addEventListener('click',()=>window.dispatchEvent(new CustomEvent('affresco:show-favorites')));
  $('loginForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=$('loginSubmit'),feedback=$('loginFeedback');
    if(button.disabled)return;
    button.disabled=true;feedback.textContent='Проверяем данные…';
    try{
      const response=await request(endpoint,'POST',{action:'login',login:$('loginName').value.trim(),password:$('loginPassword').value});
      if(!response?.authenticated||!response.account?.login)throw Error('login_not_confirmed');
      $('loginPassword').value='';changedIdentity(response);
      $('accountEmail').focus();
      try{await refreshState();}catch(_){$('accountFeedback').textContent='Вы вошли. Не удалось загрузить коллекции — откройте кабинет повторно.';}
    }catch(error){
      feedback.textContent=({invalid_credentials:'Неверный логин или пароль.',too_many_attempts:'Слишком много попыток. Повторите через 15 минут.',accounts_not_configured:'Вход временно недоступен.'})[error.message]||'Не удалось войти. Повторите попытку.';
    }finally{button.disabled=false;}
  });
  $('accountEmailForm').addEventListener('submit',async event=>{
    event.preventDefault();if(!signedIn())return;
    const input=$('accountEmail');if(!input.reportValidity())return;
    const button=$('accountEmailSubmit'),feedback=$('accountEmailFeedback'),identity=identityRevision;
    if(button.disabled)return;
    button.disabled=true;feedback.textContent='Сохраняем адрес…';
    try{
      const data=await request('/api/account-email.php','POST',{email:input.value.trim()});
      if(identity!==identityRevision)return;
      user.email=data.email;feedback.textContent='Электронная почта сохранена.';renderDashboard();
    }catch(error){
      if(identity===identityRevision)feedback.textContent=error.message==='invalid_email'?'Проверьте адрес электронной почты.':'Не удалось сохранить адрес.';
    }finally{button.disabled=false;}
  });
  $('logoutButton').addEventListener('click',async()=>{
    const button=$('logoutButton');button.disabled=true;
    try{
      // Finish an already queued account save before switching to guest state.
      await draftQueue.catch(()=>{});
      const response=await request(endpoint,'POST',{action:'logout'});
      changedIdentity(response);$('loginName').value='';$('loginPassword').value='';$('loginName').focus();
      try{await refreshState();}catch(_){$('accountFeedback').textContent='Вы вышли. Не удалось обновить гостевое избранное.';}
    }catch(_){$('accountFeedback').textContent='Выход не удался. Попробуйте снова.';}
    finally{button.disabled=false;}
  });
  window.addEventListener('storage',()=>{if(!signedIn())renderDashboard();});
  window.affrescoAccount={ready,signedIn,getDraft,saveDraft,setCollection,setCatalogItems,refreshState,refreshProfile,recordGuestSave,renderServerImageLibrary,
    identity:()=>identityRevision,current:()=>user,savedEmail:()=>signedIn()&&typeof user.email==='string'?user.email:'',
    setEmailFromSend:email=>{if(signedIn()){user.email=email;renderDashboard();}},
    url:()=>signedIn()?stateEndpoint:'/api/favorites.php'};
})();

