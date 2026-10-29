/* AFFRESCO MVP: catalogue from FTP images, client-side crop drafts, auth gate. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const catalogGrid = $('catalogGrid');
  const catalogStatus = $('catalogStatus');
  const catalogLoadMore = $('catalogLoadMore');
  const catalogBatchLoader = $('catalogBatchLoader');
  const catalogMoreButton = $('catalogMoreButton');
  const favoritesToggle = $('favoritesToggle');
  const favoritesCount = $('favoritesCount');
  const favoritesFeedback = $('favoritesFeedback');
  const favoritesRetry = $('favoritesRetry');
  const favoritesModalSummary = $('favoritesModalSummary');
  const favoritesModalItems = $('favoritesModalItems');
  const favoritesModalMessage = $('favoritesModalMessage');
  const favoritesLogin = $('favoritesLogin');
  const favoritesReload = $('favoritesReload');
  const favoritesModalNote = $('favoritesModalNote');
  const favoritesBrowse = $('favoritesBrowse');
  const viewList = $('catalogViewList');
  const viewCards = $('catalogViewCards');
  const catalogSearch=$('catalogSearch');
  const catalogSuggestions=$('catalogSuggestions');
  let catalogSearchQuery='';
  let catalogSearchTimer=null;
  const mobileGalleryQuery=window.matchMedia('(max-width: 600px)');
  let catalogView = 'cards';
  let favoritesOnly = false;
  let favoritesReady = false;
  let favorites = new Set();
  const pendingFavoriteSkus = new Set();
  let favoriteMutationQueue=Promise.resolve();
  let favoritesRevision=0;
  const pickerSearch = $('pickerSearch');
  const pickerSuggestions = $('pickerSuggestions');
  const pickerGrid = $('pickerGrid');
  const pickerStatus = $('pickerStatus');
  const pickerScroll = $('pickerScroll');
  const pickerMore = $('pickerMore');
  const pickerLoader = $('pickerLoader');
  const pickerMoreButton = $('pickerMoreButton');
  let pickerMatches = [];
  let pickerRendered = 0;
  let pickerLoading = false;
  let pickerToken = 0;
  let pickerObserver = null;
  let pickerSearchTimer = null;
  let pickerHasSearchContext = false;
  const CATALOG_BATCH_SIZE = 6;
  let displayedCatalogCount = 0;
  let catalogLoadingBatch = false;
  let catalogGeneration = 0;
  let catalogObserver = null;
  let guideNavigationTarget = null;
  let guideNavigationTimeout = 0;
  // A deep link skips the collection: do not eagerly load every batch while
  // jumping over it. Manual "Показать ещё" stays available below the gallery.
  let catalogManualMode = ['#try','#how','#about'].includes(location.hash);
  const menuToggle = $('menuToggle');
  const mobileNav = $('mobileNav');
  const cropViewport = $('cropViewport');
  const cropImage = $('cropImage');
  const cropLoader = $('cropLoader');
  const heroLoader = $('heroLoader');
  const zoom = $('cropZoom');
  const widthInput = $('wallWidth');
  const heightInput = $('wallHeight');
  const feedback = $('editorFeedback');
  const editorTitle = $('editorTitle');
  const selectedSku = $('selectedSku');
  const modalPicker = $('pickerModal');
  const modalEditor = $('editorModal');
  const modalLogin = $('accountModal');
  const modalAccount = $('accountModal');
  const modalTryon = $('tryonModal');
  const modalEmail = $('emailModal');
  const modalEmailSuccess = $('emailSuccessModal');
  const modalFavorites = $('favoritesModal');
  const emailRecipient = $('emailRecipient');
  const emailSendSubmit = $('emailSendSubmit');
  const media=window.affrescoMediaLibrary;
  let ownFrescoes=[];
  const ownImageUrls=new Map();
  let cropConstraint=null,ownUploadConstraint=null;
  let emailSendBusy = false;
  let emailSendRequest = 0;
  let preparedEmailCrop = null;
  let emailReturnModal = modalEditor;
  const modals = [modalPicker, modalEditor, modalAccount, modalTryon, modalEmail, modalEmailSuccess, modalFavorites];
  let previousFocus = null;
  let openDialog = null;
  let items = [];
  window.affrescoCatalog={list:()=>[...ownFrescoes,...items]};
  let currentItem = null;
  let state = {zoom: 1, dx: 0, dy: 0, ratio: 4 / 3, width: 300, height: 225};
  let imageLoaded = false;
  let activePointer = null;
  let heroTimer = null;
  let cropTimer = null;
  function loading(el,show) { if (el) el.hidden=!show; }
  function stopHeroLoading() { clearTimeout(heroTimer); loading(heroLoader,false); }
  function stopCropLoading() { clearTimeout(cropTimer); loading(cropLoader,false); }
  function showCatalogLoading() {
    const wrapper=document.createElement('div');wrapper.className='catalog-loading';
    wrapper.setAttribute('role','status');wrapper.setAttribute('aria-label','Загрузка каталога');
    const ring=document.createElement('span');ring.className='loading-ring';ring.setAttribute('aria-hidden','true');
    wrapper.append(ring);catalogGrid.replaceChildren(wrapper);
  }

  const esc = (value) => String(value);
  const storageKey = (sku) => 'afreska:crop:v1:' + sku;
  const safeSku = (sku) => typeof sku === 'string' && /^[\p{L}\p{N}._-]{1,100}$/u.test(sku);
  // Older API versions serialize numeric-only SKUs as JSON numbers.
  const normalizeSku = (sku) => typeof sku === 'string' ? sku :
    (typeof sku === 'number' && Number.isSafeInteger(sku) && sku >= 0 ? String(sku) : '');
  function getDraft(sku) {
    if(window.affrescoAccount?.signedIn())return window.affrescoAccount.getDraft(sku);
    try {
      const obj = JSON.parse(localStorage.getItem(storageKey(sku)) || 'null');
      if (!obj || typeof obj !== 'object') return null;
      const valid = ['zoom','dx','dy','ratio','width','height'].every(key => Number.isFinite(obj[key]));
      return valid ? obj : null;
    } catch (_) { return null; }
  }
  function saveDraft() {
    if (!currentItem) return;
    const payload = {...state, sku:currentItem.sku, savedAt:new Date().toISOString(), crop:getCrop()};
    if(window.affrescoAccount?.signedIn()){
      void window.affrescoAccount.saveDraft(currentItem.sku,payload)
        .catch(()=>showFeedback('Не удалось сохранить кадр в аккаунте.',true));
      return;
    }
    try {
      localStorage.setItem(storageKey(currentItem.sku), JSON.stringify(payload));
      window.affrescoAccount?.recordGuestSave();
      // Successful saves are silent; errors remain accessible in the footer.
      feedback.textContent='';
      feedback.classList.remove('error');
    } catch (_) {
      showFeedback('Браузер не разрешил сохранить черновик.', true);
    }
  }
  function showFeedback(message, error=false) {
    feedback.textContent = message;
    feedback.classList.toggle('error', error);
  }

  // Section scrollspy: menu state and URL reflect the section in view.
  // history.replaceState changes the address without a native anchor jump
  // or adding hundreds of browser history entries while scrolling.
  const sectionIds=['top','catalog','try','how','about'];
  const trackedSections=sectionIds.map(id=>({id,element:$(id)}))
    .filter(entry=>entry.element);
  const sectionMenuLinks=[...document.querySelectorAll(
    '.desktop-nav a[href^="#"],.mobile-nav a[href^="#"]')];
  function markActiveSection(id){
    sectionMenuLinks.forEach(link=>{
      if(link.getAttribute('href')==='#'+id){
        link.setAttribute('aria-current','location');
      }else{
        link.removeAttribute('aria-current');
      }
    });
  }
  let scrollSpyReady=document.readyState==='complete';
  let scrollSpyFrame=0;
  let regularAnchorNavigation=false;
  let regularAnchorTimer=0;
  function currentViewportSection(){
    const headerHeight=document.querySelector('.site-header')
      ?.getBoundingClientRect().height || 0;
    const marker=headerHeight+Math.min(120,window.innerHeight*.18);
    let current='top';
    trackedSections.forEach(section=>{
      if(section.element.getBoundingClientRect().top<=marker){
        current=section.id;
      }
    });
    return current;
  }
  function updateScrollSpy(){
    scrollSpyFrame=0;
    if(!scrollSpyReady || openDialog || guideNavigationTarget ||
      regularAnchorNavigation)return;
    const id=currentViewportSection();
    markActiveSection(id);
    const hash='#'+id;
    if(location.hash!==hash){
      history.replaceState(history.state,'',
        location.pathname+location.search+hash);
    }
  }
  function scheduleScrollSpy(){
    if(scrollSpyFrame)return;
    scrollSpyFrame=requestAnimationFrame(updateScrollSpy);
  }
  // During an ordinary #top / #catalog smooth click, don't rewrite its hash
  // while the viewport travels past intermediate sections.
  function finishRegularAnchor(){
    regularAnchorNavigation=false;
    clearTimeout(regularAnchorTimer);
    scheduleScrollSpy();
  }
  document.querySelectorAll('a[href="#top"],a[href="#catalog"]').forEach(link=>{
    link.addEventListener('click',event=>{
      if(event.defaultPrevented || event.button!==0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey)return;
      regularAnchorNavigation=true;
      const targetId=link.getAttribute('href').slice(1);
      markActiveSection(targetId);
      clearTimeout(regularAnchorTimer);
      regularAnchorTimer=setTimeout(finishRegularAnchor,1600);
    });
  });
  window.addEventListener('scrollend',()=>{
    if(regularAnchorNavigation)finishRegularAnchor();
  });
  window.addEventListener('scroll',scheduleScrollSpy,{passive:true});
  window.addEventListener('resize',scheduleScrollSpy);
  window.addEventListener('hashchange',()=>{
    const hashId=location.hash.slice(1);
    if(sectionIds.includes(hashId))markActiveSection(hashId);
    // Hash changes can also originate outside our navigation controls.
    scheduleScrollSpy();
  });
  markActiveSection(sectionIds.includes(location.hash.slice(1))
    ?location.hash.slice(1):'top');
  if(scrollSpyReady){
    scheduleScrollSpy();
  }else{
    window.addEventListener('load',()=>{
      scrollSpyReady=true;
      scheduleScrollSpy();
    },{once:true});
  }
  function closeMenu() {
    mobileNav.hidden = true;
    menuToggle.setAttribute('aria-expanded','false');
  }
  menuToggle.addEventListener('click', () => {
    const next = !mobileNav.hidden;
    mobileNav.hidden = next;
    menuToggle.setAttribute('aria-expanded', String(!next));
  });
  mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click',closeMenu));
  window.addEventListener('resize', () => { if (window.innerWidth > 800) closeMenu(); });

  const stepNav=$('affrescoStepNav'),stepBack=$('affrescoStepBack'),stepCollapse=$('affrescoStepCollapse');
  let navCollapsed=false;
  try{navCollapsed=sessionStorage.getItem('affresco:step-nav-collapsed')==='1';}catch(_){}
  function updateStepNav(){
    stepNav.hidden=![modalPicker,modalEditor,modalTryon].includes(openDialog);
    document.body.classList.toggle('has-ux-step-nav',!stepNav.hidden);
    document.body.classList.toggle('ux-step-nav-collapsed',navCollapsed);
    stepNav.classList.toggle('is-collapsed',navCollapsed);
    stepCollapse.setAttribute('aria-expanded',String(!navCollapsed));
    stepCollapse.setAttribute('aria-label',navCollapsed?'Развернуть навигацию':'Свернуть навигацию');
    stepBack.textContent=openDialog===modalTryon?'← К кадрированию':openDialog===modalEditor?'← К выбору фрески':'← К каталогу';
  }
  stepCollapse.addEventListener('click',()=>{navCollapsed=!navCollapsed;try{sessionStorage.setItem('affresco:step-nav-collapsed',navCollapsed?'1':'0');}catch(_){}updateStepNav();});
  stepBack.addEventListener('click',()=>{
    if(openDialog===modalTryon){window.affrescoTryon?.rememberScene?.();setModal(modalEditor);}
    else if(openDialog===modalEditor){setModal(modalPicker);updatePickerResults();}
    else if(openDialog===modalPicker)setModal(null);
  });
  function setModal(modal, trigger=null) {
    // A response from a window that was closed must not reopen the success
    // dialog unexpectedly (the server may already have accepted the email).
    if(modal!==modalEmail && openDialog===modalEmail)emailSendRequest++;
    if (!openDialog && trigger) previousFocus = trigger;
    if(modal !== modalPicker && pickerObserver) pickerObserver.disconnect();
    modals.forEach(el => el.hidden = el !== modal);
    const closingLogin=openDialog===modalLogin&&modal===null;
    openDialog = modal;
    document.body.classList.toggle('modal-open', Boolean(modal));
    updateStepNav();
    if(closingLogin)window.dispatchEvent(new CustomEvent('affresco:modal-closed',{detail:'login'}));
    if (modal) {
      const target = modal.querySelector('[data-close]') || modal.querySelector('button, [href], input');
      if (target) target.focus();
    } else if (previousFocus?.isConnected) {
      previousFocus.focus();
      previousFocus = null;
    }
  }
  window.addEventListener('affresco:open-modal',event=>{
    const target=event.detail==='account'?modalAccount:event.detail==='login'?modalLogin:event.detail==='tryon'?modalTryon:event.detail==='editor'?modalEditor:null;
    if(target)setModal(target);
  });
  modals.forEach(modal => {
    modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => setModal(null)));
    modal.addEventListener('pointerdown', e => { if (e.target === modal) setModal(null); });
  });
  document.addEventListener('keydown', (event) => {
    if (!openDialog || event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); setModal(null); return; }
    if (event.key !== 'Tab') return;
    const tabbables = [
      ...openDialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'),
      ...(!stepNav.hidden?stepNav.querySelectorAll('button:not([disabled])'):[])
    ].filter(el => el.getClientRects().length);
    if (!tabbables.length) return;
    const first = tabbables[0], last = tabbables[tabbables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  function catalogMessage(message) {
    catalogGrid.replaceChildren();
    const box = document.createElement('div');
    box.className = 'catalog-empty';
    const h = document.createElement('h3');
    h.textContent = 'Коллекция готовится';
    const p = document.createElement('p');
    p.textContent = message;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'text-link';
    action.textContent = 'Обновить каталог ↗';
    action.addEventListener('click', loadCatalog);
    box.append(h,p,action);
    catalogGrid.append(box);
  }
  const heartSvg = '<svg class="heart-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>';
  // Distinct buttons: choosing a crop, copying the SKU and favoriting
  // never nest interactive elements or trigger one another.
  let toastTimer=null;
  const catalogToast=$('catalogToast');
  function showCatalogToast(message){
    clearTimeout(toastTimer);
    catalogToast.textContent=message;
    catalogToast.hidden=false;
    toastTimer=setTimeout(()=>{catalogToast.hidden=true;},2400);
  }
  window.addEventListener('affresco:toast',event=>showCatalogToast(String(event.detail||'')));
  async function copyCatalogSku(sku){
    let copied=false;
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(sku);
        copied=true;
      }
    }catch(_){}
    if(!copied){
      // Fallback for older/in-app Safari: temporarily select plain text.
      const field=document.createElement('textarea');
      field.value=sku;
      field.setAttribute('readonly','');
      field.style.cssText='position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.append(field);
      field.select();
      try{copied=document.execCommand('copy');}catch(_){}
      field.remove();
    }
    showCatalogToast(copied?'Артикул скопирован':'Не удалось скопировать артикул');
  }
  function buildCard(item) {
    const card=document.createElement('article');
    card.className='catalog-card';
    const content=document.createElement('div');
    content.className='catalog-card-body';
    const open=document.createElement('button');
    open.type='button';
    open.className='catalog-open';
    open.setAttribute('aria-label','Открыть редактор фрески, артикул '+item.sku);
    const figure=document.createElement('div');
    figure.className='catalog-image';
    const photo=document.createElement('img');
    photo.src=item.image;
    photo.alt='Фреска, артикул '+item.sku;
    photo.loading='eager';
    photo.decoding='async';
    photo.onerror=()=>{
      photo.removeAttribute('src');
      photo.alt='Изображение временно недоступно';
      figure.style.background='linear-gradient(135deg,#ded6c8,#a49c8e)';
    };
    const flag=document.createElement('span');
    flag.className='catalog-label';
    flag.textContent=item.isOwn?'Моя фреска':'Выбрать фреску';
    figure.append(photo,flag);
    open.append(figure);
    open.addEventListener('click',()=>openEditor(item,open));
    const meta=document.createElement('div');
    meta.className='catalog-meta';
    const details=document.createElement('div');
    details.className='catalog-card-details';
    const name=document.createElement('button');
    name.type='button';
    name.className='catalog-card-name';
    name.textContent=typeof item.name==='string'&&item.name.trim()
      ?item.name.trim():'Фреска';
    name.setAttribute('aria-label','Кадрировать фреску '+name.textContent+', артикул '+item.sku);
    name.addEventListener('click',()=>openEditor(item,name));
    const sku=document.createElement('button');
    sku.type='button';
    sku.className='catalog-card-sku';
    sku.textContent='Арт. '+item.sku;
    sku.insertAdjacentHTML('beforeend',
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+
      '<rect x="8" y="8" width="12" height="12" rx="2"/>'+
      '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'+
      '</svg>');
    sku.title='Скопировать артикул';
    sku.setAttribute('aria-label','Скопировать артикул '+item.sku);
    sku.addEventListener('click',()=>void copyCatalogSku(item.sku));
    details.append(name,sku);
    const width=Number(item.width_cm),height=Number(item.height_cm);
    const validW=item.width_cm!==null&&item.width_cm!==undefined&&Number.isFinite(width)&&width>0;
    const validH=item.height_cm!==null&&item.height_cm!==undefined&&Number.isFinite(height)&&height>0;
    if(validW||validH){
      const dimensions=document.createElement('span');
      dimensions.className='catalog-card-dimensions';
      const format=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n);
      const approximate=item.dimensions_estimated===true;
      const formatted=validW&&validH?format(width)+' × '+format(height)+' см'
        :validW?'Ширина '+format(width)+' см':'Высота '+format(height)+' см';
      dimensions.textContent=formatted;
      if(approximate){
        dimensions.title='Ориентировочный формат; фактические размеры не подтверждены';
        dimensions.setAttribute('aria-label','Ориентировочный размер: '+formatted);
      }
      details.append(dimensions);
    }
    if(typeof item.description==='string'&&item.description.trim()){
      const description=document.createElement('p');
      description.className='catalog-card-description';
      description.textContent=item.description.trim();
      details.append(description);
    }
    const crop=document.createElement('button');
    crop.type='button';
    crop.className='catalog-card-open-label';
    crop.textContent='Кадрировать ↗';
    crop.addEventListener('click',()=>openEditor(item,crop));
    meta.append(details,crop);
    content.append(open,meta);
    const favoriteButton=document.createElement('button');
    favoriteButton.type='button';
    favoriteButton.className='catalog-fav';
    favoriteButton.dataset.favoriteSku=item.sku;
    favoriteButton.innerHTML=heartSvg;
    favoriteButton.addEventListener('click',()=>void toggleFavorite(item.sku));
    card.append(content);
    if(!item.isOwn){card.append(favoriteButton);updateFavoriteButton(favoriteButton,item.sku);}
    return card;
  }
  function awaitCardImage(card) {
    const photo=card.querySelector('img');
    if(!photo || photo.complete) return Promise.resolve();
    return new Promise(resolve=>{
      let finished=false;
      const done=()=>{
        if(finished) return;
        finished=true;
        window.clearTimeout(timeout);
        photo.removeEventListener('load',done);
        photo.removeEventListener('error',done);
        resolve();
      };
      const timeout=window.setTimeout(done,10000);
      photo.addEventListener('load',done);
      photo.addEventListener('error',done);
      if(photo.complete) done();
    });
  }
  function catalogItems(){
    const source=favoritesOnly?items.filter(item=>favorites.has(item.sku)):[...ownFrescoes,...items];
    if(!catalogSearchQuery)return source;
    return source.filter(item=>matchesCatalogQuery(item,catalogSearchQuery));
  }
  function matchesCatalogQuery(item,query){
    const q=query.trim().toLocaleLowerCase('ru');
    return !q||item.sku.toLocaleLowerCase('ru').includes(q)||
      (typeof item.name==='string'&&item.name.toLocaleLowerCase('ru').includes(q));
  }
  function updateCatalogStatus(){
    const source=catalogItems();
    catalogStatus.textContent='Загружено '+displayedCatalogCount+' из '+source.length+
      (favoritesOnly?' избранных фресок':' фресок');
  }
  function updateFavoriteButton(button,sku){
    const saved=favorites.has(sku);
    button.setAttribute('aria-pressed',String(saved));
    button.setAttribute('aria-label',(saved?'Убрать из избранного':'Добавить в избранное')+
      ', артикул '+sku);
    button.title=saved?'Убрать из избранного':'Добавить в избранное';
    // Even after a transient GET error the heart remains actionable:
    // the click retries loading instead of becoming a permanently inert icon.
    button.disabled=pendingFavoriteSkus.has(sku);
  }
  function renderFavoritesModal(){
    if(!modalFavorites)return;
    const signedIn=Boolean(window.affrescoAccount?.signedIn());
    const list=[...favorites];
    favoritesModalSummary.textContent=!favoritesReady
      ?'Пока не удалось загрузить избранное.'
      :list.length===0?'У вас пока нет избранных фресок.'
      :list.length+' '+(list.length===1?'фреска сохранена':
        list.length>=2&&list.length<=4?'фрески сохранены':'фресок сохранено');
    favoritesLogin.hidden=signedIn;
    favoritesModalNote.hidden=signedIn;
    favoritesReload.hidden=favoritesReady;
    favoritesModalItems.replaceChildren();
    if(!favoritesReady||!list.length)return;
    for(const sku of list){
      const item=items.find(entry=>entry.sku===sku);
      const row=document.createElement('div');
      row.className='favorites-modal-row';
      const open=document.createElement('button');
      open.type='button';
      open.className='favorites-modal-open';
      const label=document.createElement('span');
      label.className='favorites-modal-name';
      label.textContent=item?.name||'Фреска';
      const code=document.createElement('span');
      code.className='favorites-modal-sku';
      code.textContent='Арт. '+sku;
      if(item?.image){
        const img=document.createElement('img');
        img.className='favorites-modal-thumb';
        img.src=item.image;
        img.alt='';
        img.loading='lazy';
        open.append(img);
      }
      const labels=document.createElement('span');
      labels.className='favorites-modal-labels';
      labels.append(label,code);
      open.append(labels);
      open.setAttribute('aria-label','Открыть фреску '+sku);
      open.disabled=!item;
      open.title=item?'Открыть редактор':'Изображение временно отсутствует в каталоге';
      if(item)open.addEventListener('click',()=>openEditor(item,open));
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='favorites-modal-remove';
      remove.setAttribute('aria-label','Убрать из избранного артикул '+sku);
      remove.title='Убрать из избранного';
      remove.textContent='×';
      remove.disabled=pendingFavoriteSkus.has(sku);
      remove.addEventListener('click',()=>void toggleFavorite(sku));
      row.append(open,remove);
      favoritesModalItems.append(row);
    }
  }
  function refreshFavoritesUI(){
    favoritesCount.textContent=String(favorites.size);
    favoritesToggle.setAttribute('aria-label','Открыть избранное, '+favorites.size+' фресок');
    favoritesToggle.title='Открыть избранное';
    favoritesToggle.removeAttribute('aria-pressed');
    document.querySelectorAll('[data-favorite-sku]').forEach(button=>
      updateFavoriteButton(button,button.dataset.favoriteSku));
    renderFavoritesModal();
  }
  function showFavoritesError(message){
    favoritesFeedback.textContent=message;
    favoritesFeedback.hidden=!message;
    favoritesRetry.hidden=!message;
    favoritesModalMessage.textContent=message;
    favoritesModalMessage.hidden=!message;
    if(message)favoritesReload.hidden=false;
    else favoritesReload.hidden=favoritesReady;
  }
  async function loadFavorites(){
    // Refresh from the server when returning to a tab; never blindly copy
    // guest data into an account (the API explicitly separates scopes).
    if(pendingFavoriteSkus.size)return;
    const requestRevision=favoritesRevision;
    try{
      await window.affrescoAccount?.ready;
      const accountMode=Boolean(window.affrescoAccount?.signedIn());
      const result=await fetch(window.affrescoAccount?.url()||'/api/favorites.php',{
        credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}
      });
      if(!result.ok)throw Error('HTTP '+result.status);
      const data=await result.json();
      // An in-flight GET must not overwrite a more recent heart click.
      if(requestRevision!==favoritesRevision)return;
      if(!data||data.scope!==(accountMode?'account':'guest')||!Array.isArray(data.items))throw Error('invalid favorites');
      if(accountMode!==Boolean(window.affrescoAccount?.signedIn()))return;
      window.affrescoAccount?.setCollection(data);
      const previous=favorites;
      favorites=new Set(data.items.map(normalizeSku).filter(safeSku));
      favoritesReady=true;
      showFavoritesError('');
      if(favoritesOnly && items.length &&
        (favorites.size!==previous.size || [...favorites].some(sku=>!previous.has(sku)))){
        resetAndRenderCatalog();
      }
    }catch(_){
      if(requestRevision!==favoritesRevision)return;
      favoritesReady=false;
      showFavoritesError('Избранное временно недоступно. Нажмите «Повторить загрузку».');
    }
    refreshFavoritesUI();
  }
  function toggleFavorite(sku){
    if(!safeSku(sku)||pendingFavoriteSkus.has(sku))return Promise.resolve();
    if(!favoritesReady){
      // The card must stay clickable after a recoverable loading failure.
      return loadFavorites().then(()=>{
        if(favoritesReady)return toggleFavorite(sku);
        showCatalogToast('Не удалось подключить избранное. Повторите попытку.');
      });
    }
    const identityAtStart=window.affrescoAccount?.identity();
    pendingFavoriteSkus.add(sku);
    ++favoritesRevision;
    refreshFavoritesUI();
    // Serialize writes: an older response must never replace a newer list
    // when the user taps hearts for two different SKUs in quick succession.
    favoriteMutationQueue=favoriteMutationQueue.then(async()=>{
      const action=favorites.has(sku)?'remove':'add';
      try{
        if(identityAtStart!==window.affrescoAccount?.identity())return;
        const accountMode=Boolean(window.affrescoAccount?.signedIn());
        const result=await fetch(window.affrescoAccount?.url()||'/api/favorites.php',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'Content-Type':'application/json','Accept':'application/json','X-Affresco-Request':'1'},
          body:JSON.stringify({action,sku})
        });
        if(!result.ok)throw Error('HTTP '+result.status);
        const data=await result.json();
        if(!data||data.scope!==(accountMode?'account':'guest')||!Array.isArray(data.items))throw Error('invalid favorites');
        if(accountMode!==Boolean(window.affrescoAccount?.signedIn())||identityAtStart!==window.affrescoAccount?.identity())return;
        window.affrescoAccount?.setCollection(data);
        favorites=new Set(data.items.map(normalizeSku).filter(safeSku));
        showFavoritesError('');
        showCatalogToast(action==='add'?'Фреска добавлена в избранное':'Фреска удалена из избранного');
        if(favoritesOnly)resetAndRenderCatalog();
      }catch(_){
        showFavoritesError('Не получилось сохранить избранное. Попробуйте ещё раз.');
        showCatalogToast('Избранное не сохранилось. Попробуйте ещё раз.');
      }finally{
        pendingFavoriteSkus.delete(sku);
        refreshFavoritesUI();
      }
    });
    return favoriteMutationQueue;
  }
  function resetAndRenderCatalog(){
    resetCatalogPagination();
    catalogGrid.replaceChildren();
    if(catalogItems().length)void renderNextCatalogBatch();
    else{
      catalogStatus.textContent=catalogSearchQuery?'Поиск не дал результатов':
        'В избранном пока нет фресок';
      const empty=document.createElement('div');
      empty.className='catalog-empty';
      const title=document.createElement('h3');
      title.textContent=catalogSearchQuery?'Ничего не найдено':
        'Пока ничего не выбрано';
      const info=document.createElement('p');
      info.textContent=catalogSearchQuery?'Попробуйте другой артикул или название.':
        'Нажмите на сердечко у понравившейся фрески.';
      const action=document.createElement('button');
      action.type='button';action.className='text-link';
      action.textContent='Показать всю коллекцию';
      action.addEventListener('click',()=>{
        catalogSearch.value='';
        catalogSearchQuery='';
        hideCatalogSuggestions();
        favoritesOnly=false;
        refreshFavoritesUI();
        resetAndRenderCatalog();
      });
      empty.append(title,info,action);catalogGrid.append(empty);
    }
  }
  function galleryViewKey(){
    return mobileGalleryQuery.matches?'affresco:catalog-view-mobile':'affresco:catalog-view-desktop';
  }
  function restoreCatalogView(){
    const fallback=mobileGalleryQuery.matches?'list':'cards';
    try{
      const saved=sessionStorage.getItem(galleryViewKey());
      return saved==='list'||saved==='cards'?saved:fallback;
    }catch(_){return fallback;}
  }
  function setCatalogView(view,remember=true){
    if(view!=='list'&&view!=='cards')return;
    catalogView=view;
    catalogGrid.dataset.catalogView=view;
    viewList.setAttribute('aria-pressed',String(view==='list'));
    viewCards.setAttribute('aria-pressed',String(view==='cards'));
    if(remember){
      try{sessionStorage.setItem(galleryViewKey(),view);}catch(_){}
    }
  }
  setCatalogView(restoreCatalogView(),false);
  function hideCatalogSuggestions(){
    catalogSuggestions.hidden=true;
    catalogSearch.setAttribute('aria-expanded','false');
  }
  function catalogSuggestionsFor(query){
    const source=favoritesOnly?items.filter(item=>favorites.has(item.sku)):items;
    return source.filter(item=>matchesCatalogQuery(item,query)).slice(0,5);
  }
  function renderCatalogSuggestions(){
    const query=catalogSearch.value.trim();
    catalogSuggestions.replaceChildren();
    if(!query){hideCatalogSuggestions();return;}
    const suggestions=catalogSuggestionsFor(query);
    if(!suggestions.length){hideCatalogSuggestions();return;}
    suggestions.forEach((item,i)=>{
      const option=document.createElement('button');
      option.type='button';
      option.className='catalog-search-suggestion';
      option.id='catalog-suggestion-'+i;
      option.setAttribute('role','option');
      option.textContent=(item.name||'Фреска')+' · Арт. '+item.sku;
      option.addEventListener('click',()=>{
        hideCatalogSuggestions();
        openEditor(item,option);
      });
      catalogSuggestions.append(option);
    });
    catalogSuggestions.hidden=false;
    catalogSearch.setAttribute('aria-expanded','true');
  }
  function applyCatalogSearch(){
    const next=catalogSearch.value.trim().toLocaleLowerCase('ru');
    if(next===catalogSearchQuery)return;
    catalogSearchQuery=next;
    resetAndRenderCatalog();
  }
  catalogSearch.addEventListener('input',()=>{
    renderCatalogSuggestions();
    clearTimeout(catalogSearchTimer);
    catalogSearchTimer=setTimeout(applyCatalogSearch,130);
  });
  catalogSearch.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      hideCatalogSuggestions();
      return;
    }
    if(event.key==='Enter'){
      clearTimeout(catalogSearchTimer);
      applyCatalogSearch();
      const item=catalogSuggestionsFor(catalogSearch.value)[0];
      if(item&&catalogSearch.value.trim()){
        event.preventDefault();
        hideCatalogSuggestions();
        openEditor(item,catalogSearch);
      }
    }else if(event.key==='ArrowDown'&&!catalogSuggestions.hidden){
      event.preventDefault();
      catalogSuggestions.querySelector('button')?.focus();
    }
  });
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest('.catalog-search-wrap'))hideCatalogSuggestions();
  });
  // Only elevate the full-width bar while its sticky top is active.
  const catalogToolbar=$('catalogToolbar');
  let toolbarScrollFrame=0;
  function updateToolbarStuck(){
    toolbarScrollFrame=0;
    const headerHeight=document.querySelector('.site-header')?.getBoundingClientRect().height || 0;
    const toolbarTop=catalogToolbar.getBoundingClientRect().top;
    const stuck=window.scrollY>0 && Math.abs(toolbarTop-headerHeight)<=2;
    catalogToolbar.classList.toggle('is-stuck',stuck);
  }
  function scheduleToolbarStuck(){
    if(toolbarScrollFrame)return;
    toolbarScrollFrame=requestAnimationFrame(updateToolbarStuck);
  }
  window.addEventListener('scroll',scheduleToolbarStuck,{passive:true});
  window.addEventListener('resize',scheduleToolbarStuck);
  scheduleToolbarStuck();
  function scrollToFirstCatalogCard(){
    // Measure after the grid has switched layout so the first card is not
    // hidden behind the sticky site header and the catalogue toolbar.
    requestAnimationFrame(()=>{
      const target=catalogGrid.querySelector('.catalog-card') || catalogGrid;
      const header=document.querySelector('.site-header');
      const toolbar=$('catalogToolbar');
      const offset=(header?.getBoundingClientRect().height || 0)+
        (toolbar?.getBoundingClientRect().height || 0)+12;
      const top=window.scrollY+target.getBoundingClientRect().top-offset;
      const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({top:Math.max(0,top),behavior:reducedMotion?'auto':'smooth'});
    });
  }
  function changeCatalogView(view){
    if(catalogView===view)return;
    setCatalogView(view);
    scrollToFirstCatalogCard();
  }
  viewList.addEventListener('click',()=>changeCatalogView('list'));
  viewCards.addEventListener('click',()=>changeCatalogView('cards'));
  // Remember layouts separately for phone and larger screens, and update on resize.
  let wasMobile=mobileGalleryQuery.matches;
  window.addEventListener('resize',()=>{
    if(wasMobile===mobileGalleryQuery.matches)return;
    wasMobile=mobileGalleryQuery.matches;
    setCatalogView(restoreCatalogView(),false);
  });
  favoritesRetry.addEventListener('click',()=>{
    favoritesRetry.disabled=true;
    favoritesRetry.textContent='Загружаем…';
    void loadFavorites().finally(()=>{
      favoritesRetry.disabled=false;
      favoritesRetry.textContent='Повторить загрузку';
    });
  });
  window.addEventListener('affresco:show-favorites',()=>{
    if(!favoritesReady){
      setModal(null);
      showFavoritesError('Избранное пока недоступно. Повторите загрузку.');
      $('catalog').scrollIntoView({block:'start',behavior:'smooth'});
      return;
    }
    setModal(null);
    favoritesOnly=true;
    catalogSearch.value='';
    catalogSearchQuery='';
    hideCatalogSuggestions();
    refreshFavoritesUI();
    resetAndRenderCatalog();
    $('catalog').scrollIntoView({block:'start',behavior:
      window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  });
  window.addEventListener('affresco:open-fresco',event=>{
    const sku=event.detail?.sku;
    const item=items.find(fresco=>fresco.sku===sku);
    if(item){
      openEditor(item);
    }else{
      setModal(null);
      showFavoritesError('Фреска с артикулом '+String(sku||'')+
        ' сейчас недоступна в каталоге. Попробуйте обновить изображения.');
      $('catalog').scrollIntoView({block:'start',behavior:'smooth'});
    }
  });
  favoritesToggle.addEventListener('click',()=>{
    renderFavoritesModal();
    setModal(modalFavorites,favoritesToggle);
    if(!favoritesReady)void loadFavorites();
  });
  window.addEventListener('affresco:auth-changed',()=>{
    ++favoritesRevision;
    favorites=new Set();
    favoritesReady=false;
    favoritesOnly=false;
    refreshFavoritesUI();
    resetAndRenderCatalog();
    void favoriteMutationQueue.finally(()=>loadFavorites());
  });
  favoritesLogin.addEventListener('click',()=>setModal(modalLogin));
  favoritesReload.addEventListener('click',async()=>{
    favoritesReload.disabled=true;
    favoritesReload.textContent='Загружаем…';
    try{await loadFavorites();}
    finally{
      favoritesReload.disabled=false;
      favoritesReload.textContent='Повторить загрузку';
    }
  });
  favoritesBrowse.addEventListener('click',()=>{
    setModal(null);
    favoritesOnly=false;
    catalogSearch.value='';
    catalogSearchQuery='';
    hideCatalogSuggestions();
    refreshFavoritesUI();
    resetAndRenderCatalog();
    $('catalog').scrollIntoView({block:'start',
      behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  });
  void loadFavorites();
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && !pendingFavoriteSkus.size)void loadFavorites();
  });
  window.addEventListener('pageshow',event=>{
    if(event.persisted && !pendingFavoriteSkus.size)void loadFavorites();
  });
  // Deep anchor jumps cross the catalogue sentinel and must not start image
  // batches that shift the destination. Manual loading remains available below
  // the gallery until the user scrolls back into the collection.
  function finishGuideNavigation(realign=true){
    if(!guideNavigationTarget)return;
    const target=guideNavigationTarget;
    guideNavigationTarget=null;
    clearTimeout(guideNavigationTimeout);
    window.removeEventListener('scrollend',onGuideScrollEnd);
    if(realign){
      const headerHeight=document.querySelector('.site-header')?.getBoundingClientRect().height||0;
      const delta=target.getBoundingClientRect().top-headerHeight-12;
      if(Math.abs(delta)>4){
        // CSS has html{scroll-behavior:smooth}; override it temporarily to
        // make this final correction without starting another smooth scroll.
        const root=document.documentElement;
        const previous=root.style.scrollBehavior;
        root.style.scrollBehavior='auto';
        window.scrollTo(0,Math.max(0,window.scrollY+delta));
        root.style.scrollBehavior=previous;
      }
    }
    // The target remains below the catalogue, so leave its batches paused.
    // A normal manual scroll back into the gallery switches to auto mode.
    updateCatalogMoreControls();
    watchCatalogBottom();
  }
  function onGuideScrollEnd(){finishGuideNavigation();}
  function cancelGuideNavigation(){finishGuideNavigation(false);}
  document.querySelectorAll('a[href="#try"],a[href="#how"],a[href="#about"]').forEach(link=>{
    link.addEventListener('click',event=>{
      if(event.defaultPrevented || event.button!==0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey)return;
      guideNavigationTarget=$(link.getAttribute('href').slice(1));
      catalogManualMode=true;
      if(catalogObserver)catalogObserver.disconnect();
      updateCatalogMoreControls();
      clearTimeout(guideNavigationTimeout);
      window.removeEventListener('scrollend',onGuideScrollEnd);
      window.addEventListener('scrollend',onGuideScrollEnd,{once:true});
      // Native anchor navigation updates the hash; fallback for older Safari.
      guideNavigationTimeout=setTimeout(onGuideScrollEnd,1400);
    });
  });
  // A deliberate user scroll cancels the final snap, avoiding a tug-of-war.
  window.addEventListener('wheel',cancelGuideNavigation,{passive:true});
  window.addEventListener('touchstart',cancelGuideNavigation,{passive:true});
  function catalogCanAutoLoad(){
    return !catalogManualMode && !guideNavigationTarget &&
      'IntersectionObserver' in window;
  }
  function updateCatalogMoreControls(){
    if(!catalogLoadMore)return;
    const hasMore=displayedCatalogCount<catalogItems().length;
    catalogLoadMore.hidden=!hasMore;
    // In auto mode the sentinel remains in the document, but no manual
    // button is shown. It appears after a deliberate deep anchor jump or
    // when IntersectionObserver is unsupported.
    if(catalogMoreButton)catalogMoreButton.hidden=
      !hasMore || catalogLoadingBatch || catalogCanAutoLoad();
  }
  function onCatalogScroll(){
    if(!catalogManualMode || guideNavigationTarget)return;
    const rect=$('catalog').getBoundingClientRect();
    const headerHeight=document.querySelector('.site-header')?.getBoundingClientRect().height||0;
    // Ignore transient passage through the gallery during an anchor jump.
    // A genuine return into the section restores lazy-loading.
    if(rect.top<window.innerHeight-40 && rect.bottom>headerHeight+40){
      catalogManualMode=false;
      updateCatalogMoreControls();
      watchCatalogBottom();
    }
  }
  window.addEventListener('scroll',onCatalogScroll,{passive:true});
  function watchCatalogBottom(){
    if(catalogObserver)catalogObserver.disconnect();
    updateCatalogMoreControls();
    if(!catalogCanAutoLoad() || catalogLoadingBatch ||
      displayedCatalogCount>=catalogItems().length || !catalogLoadMore)return;
    if(!catalogObserver){
      catalogObserver=new IntersectionObserver(entries=>{
        if(catalogCanAutoLoad() && entries.some(entry=>entry.isIntersecting)){
          void renderNextCatalogBatch(false);
        }
      },{rootMargin:'0px',threshold:0});
    }
    catalogObserver.observe(catalogLoadMore);
  }
  async function renderNextCatalogBatch(manual=false){
    if(catalogLoadingBatch || displayedCatalogCount>=catalogItems().length) return;
    const generation=catalogGeneration;
    catalogLoadingBatch=true;
    loading(catalogBatchLoader,true);
    updateCatalogMoreControls();

    const isAdditionalBatch=displayedCatalogCount>0;
    const started=performance.now();
    const source=catalogItems();
    const next=source.slice(displayedCatalogCount,displayedCatalogCount+(catalogLoadMore ? CATALOG_BATCH_SIZE : source.length));
    const cards=next.map(buildCard);
    const fragment=document.createDocumentFragment();
    cards.forEach(card=>{
      if(isAdditionalBatch) card.classList.add('catalog-card-pending');
      fragment.append(card);
    });
    // Keep the loading ring in view: don't append the next six cards until
    // their images are ready. The first six are mounted immediately as before.
    if(!isAdditionalBatch) catalogGrid.append(fragment);
    displayedCatalogCount+=cards.length;
    // Detached eager images load while the existing grid remains stable.
    await Promise.all(cards.map(awaitCardImage));
    if(isAdditionalBatch) {
      const revealDelay=Math.max(0,300-(performance.now()-started));
      if(revealDelay) await new Promise(resolve=>setTimeout(resolve,revealDelay));
    }
    // A refresh may have replaced the catalogue while the old images loaded.
    if(generation!==catalogGeneration) return;
    // Only auto-initiated batches are cancelled when a deep link crosses
    // the sentinel. Explicit "Показать ещё" always completes, even if #try
    // remains in the URL from a previous navigation.
    if(isAdditionalBatch && !manual && !catalogCanAutoLoad()){
      displayedCatalogCount-=cards.length;
      catalogLoadingBatch=false;
      loading(catalogBatchLoader,false);
      watchCatalogBottom();
      return;
    }
    if(isAdditionalBatch) {
      catalogGrid.append(fragment);
      requestAnimationFrame(()=>cards.forEach(card=>card.classList.remove('catalog-card-pending')));
    }
    updateCatalogStatus();
    catalogLoadingBatch=false;
    loading(catalogBatchLoader,false);
    watchCatalogBottom();
  }
  function resetCatalogPagination() {
    ++catalogGeneration;
    if(catalogObserver) catalogObserver.disconnect();
    displayedCatalogCount=0;
    catalogLoadingBatch=false;
    if(catalogLoadMore)catalogLoadMore.hidden=true;
    if(catalogMoreButton)catalogMoreButton.hidden=true;
    loading(catalogBatchLoader,false);
  }
  async function loadCatalog() {
    resetCatalogPagination();
    const requestGeneration=catalogGeneration;
    catalogStatus.textContent='Загружаем изображения…';
    showCatalogLoading();
    try {
      const response=await fetch('/api/catalog.php',{cache:'no-store',headers:{'Accept':'application/json'}});
      if (!response.ok) throw new Error('HTTP '+response.status);
      const body=await response.json();
      if(requestGeneration!==catalogGeneration) return;
      if (!body || !Array.isArray(body.items)) throw new Error('Неверный формат каталога');
      items=body.items.filter(x => x && typeof x === 'object').map(x => ({...x,sku:normalizeSku(x.sku)}))
        .filter(x => safeSku(x.sku) && typeof x.image==='string' && /^\/(?:Images|images)\//.test(x.image));
      window.affrescoAccount?.setCatalogItems(items);
      window.affrescoTryon?.sceneItems?.(items);
      catalogGrid.replaceChildren();
      if (items.length===0 && ownFrescoes.length===0) {
        catalogStatus.textContent='Пока нет изображений';
        stopHeroLoading();
        catalogMessage('Как только изображения по артикулам появятся в /Images/catalog/ на FTP, карточки автоматически появятся здесь. Также поддерживается /Images/каталог/.');
        return;
      }
      // Only six cards/images are mounted at first. Remaining images wait for scrolling.
      resetAndRenderCatalog();
      renderFavoritesModal();
      const first=items[0];
      const heroArt=$('heroArt');
      if (heroArt) {
        clearTimeout(heroTimer);
        loading(heroLoader,true);
        heroArt.onload=stopHeroLoading;
        heroArt.onerror=()=>{stopHeroLoading();heroArt.removeAttribute('src');};
        heroArt.alt='Фрагмент фрески, артикул '+first.sku;
        heroArt.src=first.image;
        if(heroArt.complete && heroArt.naturalWidth>0)stopHeroLoading();
        else heroTimer=setTimeout(stopHeroLoading,12000);
      }
      const teaserArt=$('teaserArt');
      if (teaserArt) {
        const featured = items.length > 1 ? items[1] : first;
        teaserArt.src=featured.image;
        teaserArt.onerror=()=>teaserArt.removeAttribute('src');
      }
      const tryDemo=$('openFirstEditor');
      tryDemo.disabled=false;
      if(openDialog === modalPicker) updatePickerResults();
      // Click handling is registered once below for all catalog states.
    } catch (error) {
      if(requestGeneration!==catalogGeneration) return;
      catalogStatus.textContent='Каталог временно недоступен';
      stopHeroLoading();
      catalogMessage('Не удалось получить список фотографий с сервера. Проверьте размещение Images/catalog и доступность PHP-обработчика /api/catalog.php.');
    }
  }

  // The photograph is rendered across the full stage; the independently
  // resizable selection rectangle determines the exported normalized crop.
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const cropSelection=$('cropSelection');
  const cropDimLayer=$('cropDimLayer');
  const ratioLock=$('cropLockRatio');
  const MIN_CROP_PX=42;

  function validSelection(box){
    return Boolean(box && ['x','y','w','h'].every(k=>Number.isFinite(box[k])) &&
      box.x>=0 && box.y>=0 && box.w>0 && box.h>0 && box.x+box.w<=1.001 && box.y+box.h<=1.001);
  }
  function stageSize(){
    return {w:cropViewport.clientWidth,h:cropViewport.clientHeight};
  }
  function selectionPixels(){
    const {w,h}=stageSize();
    const r=validSelection(state.selection)?state.selection:{x:0,y:0,w:1,h:1};
    return {x:r.x*w,y:r.y*h,w:r.w*w,h:r.h*h};
  }
  function applySelectionPx(r){
    const {w,h}=stageSize();
    if(!w||!h)return;
    state.selection={x:r.x/w,y:r.y/h,w:r.w/w,h:r.h/h};
  }
  function fitSelectionToRatio(ratio,padding=.9){
    const {w,h}=stageSize();
    if(!w||!h)return;
    const maxW=w*padding,maxH=h*padding;
    const boxW=Math.min(maxW,maxH*ratio),boxH=boxW/ratio;
    applySelectionPx({x:(w-boxW)/2,y:(h-boxH)/2,w:boxW,h:boxH});
  }
  function sizeLimits(){
    const dimensions=catalogDimensions(currentItem);
    return dimensions || {width:1000,height:1000};
  }
  function syncDimensionsAfterResize(before,after,startWidthCm,startHeightCm){
    // Both dimensions scale with their respective crop edges. In particular,
    // shrinking the frame horizontally must NEVER increase its height in cm.
    // Start from pointer-down values rather than rounded intermediate frames.
    if(before.w<=0||before.h<=0)return;
    const limits=sizeLimits();
    if(state.lockRatio){
      // The lock applies to physical dimensions as well as crop geometry.
      // Stop both sizes at the first reached per-SKU maximum.
      const scale=Math.min(after.w/before.w,after.h/before.h,
        limits.width/startWidthCm,limits.height/startHeightCm);
      state.width=clamp(Math.round(startWidthCm*scale),30,limits.width);
      state.height=clamp(Math.round(startHeightCm*scale),30,limits.height);
    }else{
      // Without a lock, a change to one edge must not grow the other
      // physical dimension. Each axis has its own catalogue maximum.
      state.width=clamp(Math.round(startWidthCm*(after.w/before.w)),30,limits.width);
      state.height=clamp(Math.round(startHeightCm*(after.h/before.h)),30,limits.height);
    }
    state.ratio=state.width/state.height;
    state.dimensionsSource='custom';
    widthInput.value=state.width;
    heightInput.value=state.height;
  }
  function ratioFromDimensions(){
    const width=Number(widthInput.value),height=Number(heightInput.value);
    const limits=sizeLimits();
    if(!Number.isFinite(width)||!Number.isFinite(height)||
       width<30||height<30||width>limits.width||height>limits.height)return false;
    state.width=width;state.height=height;state.ratio=width/height;
    state.dimensionsSource='custom';
    fitSelectionToRatio(state.ratio);
    updateCrop(true);validateCropWallFit();
    return true;
  }
  function validateCropWallFit(){
    const blocked=Boolean(cropConstraint&&(state.width>cropConstraint.width||state.height>cropConstraint.height));
    cropViewport.classList.toggle('is-invalid-size',blocked);
    $('tryOnWall').disabled=blocked;
    $('sendCrop').disabled=blocked;
    if(blocked)showFeedback('Размер фрески больше допустимого. Уменьшите кадр до размеров стены.',true);
    return !blocked;
  }
  function setRatio(value){
    const limits=sizeLimits();
    // Keep as much of the current width as the chosen ratio and the
    // individual catalogue width/height limits permit.
    state.width=Math.floor(Math.min(limits.width,limits.height*value,
      Math.max(30,state.width)));
    state.height=Math.round(state.width/value);
    if(state.height>limits.height){
      state.height=limits.height;
      state.width=Math.floor(state.height*value);
    }
    state.width=clamp(state.width,30,limits.width);
    state.height=clamp(state.height,30,limits.height);
    state.ratio=state.width/state.height;
    state.dimensionsSource='custom';
    state.lockRatio=true;ratioLock.checked=true;
    widthInput.value=state.width;heightInput.value=state.height;
    fitSelectionToRatio(state.ratio);
    updateCrop(true);validateCropWallFit();saveDraft();
  }
  function metrics(){
    const {w,h}=stageSize();
    const nw=cropImage.naturalWidth,nh=cropImage.naturalHeight;
    if(!imageLoaded||!w||!h||!nw||!nh)return null;
    const scale=Math.max(w/nw,h/nh)*state.zoom;
    const drawW=nw*scale,drawH=nh*scale;
    const box=selectionPixels();
    const minX=box.x+box.w-(w+drawW)/2;
    const maxX=box.x-(w-drawW)/2;
    const minY=box.y+box.h-(h+drawH)/2;
    const maxY=box.y-(h-drawH)/2;
    return {width:w,height:h,nw,nh,scale,drawW,drawH,box,minX,maxX,minY,maxY};
  }
  function getCrop(){
    const m=metrics();if(!m)return null;
    const imageLeft=(m.width-m.drawW)/2+clamp(state.dx,m.minX,m.maxX);
    const imageTop=(m.height-m.drawH)/2+clamp(state.dy,m.minY,m.maxY);
    return {x:clamp((m.box.x-imageLeft)/m.drawW,0,1),
      y:clamp((m.box.y-imageTop)/m.drawH,0,1),
      width:Math.min(m.box.w/m.drawW,1),
      height:Math.min(m.box.h/m.drawH,1)};
  }
  function updateCrop(resetPosition=false){
    if(resetPosition){state.dx=0;state.dy=0;}
    const box=validSelection(state.selection)?state.selection:{x:0,y:0,w:1,h:1};
    cropSelection.style.left=(100*box.x)+'%';
    cropSelection.style.top=(100*box.y)+'%';
    cropSelection.style.width=(100*box.w)+'%';
    cropSelection.style.height=(100*box.h)+'%';
    // Exactly four panels cover the outside; they never hide the selected area.
    cropDimLayer.style.setProperty('--crop-x',(100*box.x)+'%');
    cropDimLayer.style.setProperty('--crop-y',(100*box.y)+'%');
    cropDimLayer.style.setProperty('--crop-w',(100*box.w)+'%');
    cropDimLayer.style.setProperty('--crop-h',(100*box.h)+'%');
    document.querySelectorAll('[data-ratio]').forEach(btn=>btn.setAttribute('aria-pressed',
      String(Math.abs(Number(btn.dataset.ratio)-state.width/state.height)<.018)));
    zoom.value=state.zoom;
    $('zoomValue').textContent=Math.round(state.zoom*100)+'%';
    const m=metrics();if(!m)return;
    state.dx=clamp(state.dx,m.minX,m.maxX);
    state.dy=clamp(state.dy,m.minY,m.maxY);
    cropImage.style.width=m.drawW+'px';
    cropImage.style.height=m.drawH+'px';
    cropImage.style.transform='translate(calc(-50% + '+state.dx+'px),calc(-50% + '+state.dy+'px))';
  }
  // Pure geometry for 8 handles. Locked corners anchor their opposite corner;
  // locked edges anchor the opposite edge and expand symmetrically cross-axis.
  function moveSelection(r,deltaX,deltaY,stageW,stageH){
    // Keep size and aspect ratio; move only the frame within photograph bounds.
    return {x:clamp(r.x+deltaX,0,Math.max(0,stageW-r.w)),
      y:clamp(r.y+deltaY,0,Math.max(0,stageH-r.h)),
      w:r.w,h:r.h};
  }
  function resizeSelection(r,handle,dx,dy,lock,ratio,stageW,stageH){
    const minW=Math.min(MIN_CROP_PX,stageW*.3),minH=Math.min(MIN_CROP_PX,stageH*.3);
    const hasW=handle.includes('w'),hasE=handle.includes('e'),
      hasN=handle.includes('n'),hasS=handle.includes('s');
    const left=r.x,top=r.y,right=r.x+r.w,bottom=r.y+r.h;
    if(!lock){
      const l=hasW?clamp(left+dx,0,right-minW):left;
      const t=hasN?clamp(top+dy,0,bottom-minH):top;
      const rr=hasE?clamp(right+dx,l+minW,stageW):right;
      const bb=hasS?clamp(bottom+dy,t+minH,stageH):bottom;
      return {x:l,y:t,w:rr-l,h:bb-t};
    }
    if(hasW||hasE){
      const fixedX=hasW?right:left;
      let wantedW=hasW?right-(left+dx):(right+dx)-left;
      const centerY=top+r.h/2;
      const fixedY=hasN?bottom:top;
      const allowedX=hasW?fixedX:stageW-fixedX;
      const allowedH=hasN?fixedY:hasS?stageH-fixedY:2*Math.min(centerY,stageH-centerY);
      if(hasN||hasS){
        const wantedH=hasN?bottom-(top+dy):(bottom+dy)-top;
        if(Math.abs(dy)*ratio>Math.abs(dx))wantedW=wantedH*ratio;
      }
      const w=clamp(wantedW,Math.max(minW,minH*ratio),Math.min(allowedX,allowedH*ratio));
      const h=w/ratio;
      const x=hasW?fixedX-w:fixedX;
      const y=hasN?fixedY-h:hasS?fixedY:centerY-h/2;
      return {x,y,w,h};
    }
    // Pure north/south resize: keep the horizontal center fixed.
    const fixedY=hasN?bottom:top,centerX=left+r.w/2;
    const allowedH=hasN?fixedY:stageH-fixedY;
    const allowedW=2*Math.min(centerX,stageW-centerX);
    const height=clamp(hasN?bottom-(top+dy):(bottom+dy)-top,
      Math.max(minH,minW/ratio),Math.min(allowedH,allowedW/ratio));
    const width=height*ratio;
    return {x:centerX-width/2,y:hasN?fixedY-height:fixedY,w:width,h:height};
  }
  function catalogDimensions(item){
    if(!item)return null;
    const width=Number(item.width_cm),height=Number(item.height_cm);
    return item.width_cm!=null && item.height_cm!=null &&
      Number.isFinite(width)&&Number.isFinite(height)&&
      width>=30&&width<=1000&&height>=30&&height<=1000
      ?{width,height}:null;
  }
  function openEditor(item,trigger){
    if(!item||!safeSku(item.sku))return;
    if(!openDialog||openDialog!==modalTryon)cropConstraint=null;
    pickerHasSearchContext=openDialog===modalPicker;
    currentItem=item;
    const draft=getDraft(item.sku);
    // Earlier releases saved 300cm image-based defaults as crop drafts.
    // Only dimensions explicitly changed by the user override catalog JSON.
    const size=catalogDimensions(item);
    const hasDimensions=Boolean(size);
    const startingWidth=hasDimensions?size.width:300;
    const startingHeight=hasDimensions?size.height:225;
    const customSize=draft?.dimensionsSource==='custom';
    state={zoom:1,dx:0,dy:0,ratio:startingWidth/startingHeight,
      width:startingWidth,height:startingHeight,lockRatio:true,selection:null,...(draft||{})};
    if(hasDimensions && !customSize){
      // Keep saved crop geometry, zoom and position while migrating old drafts.
      state.width=startingWidth;
      state.height=startingHeight;
      state.ratio=startingWidth/startingHeight;
    }
    state.dimensionsSource=customSize?'custom':hasDimensions?'catalog':'fallback';
    const dimensionsNote=$('editorDimensionsNote');
    dimensionsNote.hidden=!hasDimensions||item.dimensions_estimated!==true||customSize;
    state.zoom=clamp(state.zoom,1,3);
    const limits=sizeLimits();
    state.width=clamp(state.width,30,limits.width);
    state.height=clamp(state.height,30,limits.height);
    widthInput.max=String(limits.width);
    heightInput.max=String(limits.height);
    state.ratio=state.width/state.height;
    state.lockRatio=state.lockRatio!==false;
    if(!validSelection(state.selection))state.selection=null;
    ratioLock.checked=state.lockRatio;
    widthInput.value=state.width;heightInput.value=state.height;
    editorTitle.textContent='Настройте размер фрески';
    selectedSku.textContent='Артикул '+item.sku;
    imageLoaded=false;activePointer=null;
    clearTimeout(cropTimer);
    loading(cropLoader,true);
    cropImage.removeAttribute('src');
    feedback.textContent='';
    feedback.classList.remove('error');
    setModal(modalEditor,trigger);
    cropImage.onload=()=>{
      imageLoaded=true;stopCropLoading();
      const aspect=cropImage.naturalWidth/cropImage.naturalHeight;
      cropViewport.style.aspectRatio=String(aspect);
      cropViewport.style.maxWidth=Math.round(450*aspect)+'px';
      if(!validSelection(state.selection)){
        // Image fitting never overwrites physical dimensions from the SKU.
        // Older saved drafts without a selection also retain their dimensions.
        state.selection={x:0,y:0,w:1,h:1};
        if(!draft && !hasDimensions){
          state.width=300;
          state.height=clamp(Math.round(300/aspect),30,1000);
        }
        state.ratio=state.width/state.height;
        widthInput.value=state.width;
        heightInput.value=state.height;
      }
      updateCrop();validateCropWallFit();
    };
    cropImage.onerror=()=>{
      imageLoaded=false;stopCropLoading();
      showFeedback('Не удалось загрузить фото фрески. Проверьте путь на FTP.',true);
    };
    cropImage.src=item.image;
    cropTimer=setTimeout(()=>{
      if(!imageLoaded){stopCropLoading();showFeedback('Изображение загружается слишком долго. Повторите попытку.',true);}
    },12000);
  }
  document.querySelectorAll('[data-ratio]').forEach(btn=>btn.addEventListener('click',()=>setRatio(Number(btn.dataset.ratio))));
  [widthInput,heightInput].forEach(input=>input.addEventListener('change',()=>{
    const oldW=state.width,oldH=state.height;
    if(!ratioFromDimensions()){
      const limits=sizeLimits();
      showFeedback('Введите ширину от 30 до '+limits.width+
        ' см и высоту от 30 до '+limits.height+' см.',true);
      widthInput.value=oldW;heightInput.value=oldH;return;
    }
    validateCropWallFit();saveDraft();
  }));
  ratioLock.addEventListener('change',()=>{
    state.lockRatio=ratioLock.checked;
    // Switching aspect-ratio lock must not silently change wall dimensions.
    updateCrop();saveDraft();
  });
  zoom.addEventListener('input',()=>{state.zoom=clamp(Number(zoom.value),1,3);updateCrop();});
  zoom.addEventListener('change',saveDraft);
  cropViewport.addEventListener('pointerdown',e=>{
    if(!imageLoaded||(e.pointerType==='mouse'&&e.button!==0))return;
    const handle=e.target.closest('[data-crop-handle]')?.dataset.cropHandle||null;
    if(!handle && !e.target.closest('#cropSelection'))return;
    e.preventDefault();
    const box=selectionPixels();
    activePointer={id:e.pointerId,x:e.clientX,y:e.clientY,
      handle,box,locked:state.lockRatio,ratio:box.w/box.h,
      startWidthCm:state.width,startHeightCm:state.height};
    cropViewport.setPointerCapture(e.pointerId);
  });
  cropViewport.addEventListener('pointermove',e=>{
    if(!activePointer||activePointer.id!==e.pointerId)return;
    const deltaX=e.clientX-activePointer.x,deltaY=e.clientY-activePointer.y;
    if(activePointer.handle){
      const {w,h}=stageSize();
      const rect=resizeSelection(activePointer.box,activePointer.handle,deltaX,deltaY,
        activePointer.locked,activePointer.ratio,w,h);
      applySelectionPx(rect);
      syncDimensionsAfterResize(activePointer.box,rect,
        activePointer.startWidthCm,activePointer.startHeightCm);
    }else{
      const {w,h}=stageSize();
      applySelectionPx(moveSelection(activePointer.box,deltaX,deltaY,w,h));
      // Dragging the frame never alters the image transform or wall dimensions.
    }
    updateCrop();
  });
  for(const name of ['pointerup','pointercancel'])cropViewport.addEventListener(name,e=>{
    if(activePointer?.id!==e.pointerId)return;
    activePointer=null;
    saveDraft();
  });
  cropSelection.querySelectorAll('[data-crop-handle]').forEach(btn=>btn.addEventListener('keydown',e=>{
    if(!imageLoaded||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
    e.preventDefault();
    const delta=(e.shiftKey?20:8),dx=e.key==='ArrowLeft'?-delta:e.key==='ArrowRight'?delta:0,
      dy=e.key==='ArrowUp'?-delta:e.key==='ArrowDown'?delta:0;
    const {w,h}=stageSize();
    const before=selectionPixels();
    const box=resizeSelection(before,btn.dataset.cropHandle,dx,dy,
      state.lockRatio,before.w/before.h,w,h);
    applySelectionPx(box);
    syncDimensionsAfterResize(before,box,state.width,state.height);
    updateCrop();saveDraft();
  }));
  cropViewport.addEventListener('wheel',e=>{
    if(!imageLoaded)return;
    e.preventDefault();
    state.zoom=clamp(Math.round((state.zoom+(e.deltaY<0?.1:-.1))*10)/10,1,3);
    updateCrop();saveDraft();
  },{passive:false});
  function cropEmailJpeg(){
    const crop=getCrop();
    if(!crop||!imageLoaded||!cropImage.naturalWidth||!cropImage.naturalHeight){
      throw new Error('crop_unavailable');
    }
    const nw=cropImage.naturalWidth,nh=cropImage.naturalHeight;
    const sx=Math.max(0,Math.floor(crop.x*nw));
    const sy=Math.max(0,Math.floor(crop.y*nh));
    const sw=Math.min(nw-sx,Math.max(1,Math.round(crop.width*nw)));
    const sh=Math.min(nh-sy,Math.max(1,Math.round(crop.height*nh)));
    if(sw<20||sh<20)throw new Error('crop_unavailable');
    const scale=Math.min(1,1600/sw,1600/sh);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(sw*scale));
    canvas.height=Math.max(1,Math.round(sh*scale));
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw new Error('image_export_failed');
    ctx.drawImage(cropImage,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
    const output=canvas.toDataURL('image/jpeg',.80);
    if(!output.startsWith('data:image/jpeg;base64,')||output.length>3300000){
      throw new Error('image_too_large');
    }
    return output;
  }
  function validDeliveryEmail(value){
    // type=email by itself accepts domains without a dot (a2ice@yandex).
    // Match the PHP endpoint's expectation of a complete mail domain.
    return value.length<=254 &&
      /^[^\s@]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(value);
  }
  emailRecipient.addEventListener('input',()=>{
    emailRecipient.setCustomValidity('');
    emailRecipient.removeAttribute('aria-invalid');
    $('emailSendFeedback').textContent='';
  });
  $('sendCrop').addEventListener('click',async()=>{
    if(!currentItem||!imageLoaded){
      showFeedback('Сначала дождитесь загрузки фрески.',true);
      return;
    }
    // Capture while the editor is VISIBLE: getCrop() uses the viewport's
    // clientWidth/clientHeight and returns null once the editor is hidden.
    // Retain the exact selected JPEG and dimensions for the mail dialog.
    let attachment;
    try{
      attachment=cropEmailJpeg();
    }catch(error){
      const messages={
        crop_unavailable:'Не удалось выделить кадр. Откройте редактор и попробуйте снова.',
        image_export_failed:'Браузер не смог подготовить изображение. Попробуйте другой браузер.',
        image_too_large:'Изображение слишком большое для отправки. Уменьшите область кадра.',
        SecurityError:'Изображение заблокировано для экспорта браузером.'
      };
      showFeedback(messages[error?.name]||messages[error?.message]||
        'Не удалось подготовить выбранный кадр.',true);
      return;
    }
    emailReturnModal=modalEditor;
    $('emailModalTitle').textContent='Отправить кадр';
    $('emailModalDescription').textContent='Мы отправим выбранный кадр фрески на вашу электронную почту во вложении JPEG.';
    $('emailBackToEditor').textContent='← Вернуться к кадру';
    $('emailSuccessBack').textContent='Вернуться к кадру';
    preparedEmailCrop={image:attachment,sku:currentItem.sku,
      width_cm:state.width,height_cm:state.height};
    saveDraft();
    await window.affrescoAccount?.ready;
    if(!preparedEmailCrop || openDialog!==modalEditor)return;
    $('emailSendForm').reset();
    emailRecipient.setCustomValidity('');
    emailRecipient.removeAttribute('aria-invalid');
    $('emailSendFeedback').textContent='';
    emailRecipient.value=window.affrescoAccount?.savedEmail()||'';
    setModal(modalEmail,$('sendCrop'));
    if(!emailRecipient.value)emailRecipient.focus();
  });
  window.addEventListener('affresco:email-tryon',event=>{
    const selection=event.detail;
    if(!selection?.image?.startsWith('data:image/jpeg;base64,'))return;
    preparedEmailCrop={...selection,kind:'tryon'};
    emailReturnModal=modalTryon;
    $('emailSendForm').reset();
    emailRecipient.setCustomValidity('');emailRecipient.removeAttribute('aria-invalid');
    emailRecipient.value=window.affrescoAccount?.savedEmail()||'';
    $('emailSendFeedback').textContent='';
    $('emailModalTitle').textContent='Отправить примерку';
    $('emailModalDescription').textContent='Фото комнаты с выбранной фреской придёт вам во вложении JPEG.';
    $('emailBackToEditor').textContent='← Вернуться к примерке';
    $('emailSuccessBack').textContent='Вернуться к примерке';
    setModal(modalEmail);
  });
  window.addEventListener('affresco:email-ai-tryon',event=>{
    const context=event.detail?.context;
    if(typeof context!=='string'||!/^[-a-f0-9]{36}$/i.test(context))return;
    preparedEmailCrop={kind:'ai',context};emailReturnModal=modalTryon;
    $('emailSendForm').reset();
    emailRecipient.setCustomValidity('');emailRecipient.removeAttribute('aria-invalid');
    emailRecipient.value=window.affrescoAccount?.savedEmail()||'';
    $('emailSendFeedback').textContent='';
    $('emailModalTitle').textContent='Отправить AI-варианты';
    $('emailModalDescription').textContent='Отправим все изображения текущей примерки: ручные JPEG и AI-варианты. Один файл — изображением, несколько — одним ZIP-архивом.';
    $('emailBackToEditor').textContent='← Вернуться к примерке';
    $('emailSuccessBack').textContent='Вернуться к примерке';
    setModal(modalEmail);
  });
  $('emailSendForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(openDialog!==modalEmail||emailSendBusy)return;
    const email=emailRecipient.value.trim();
    if(!validDeliveryEmail(email)){
      emailRecipient.setAttribute('aria-invalid','true');
      $('emailSendFeedback').textContent='Проверьте адрес: нужен полный email, например name@example.com.';
      emailRecipient.focus();
      return;
    }
    emailRecipient.removeAttribute('aria-invalid');
    emailRecipient.setCustomValidity('');
    const requestId=++emailSendRequest;
    emailSendBusy=true;
    emailSendSubmit.disabled=true;
    emailSendSubmit.textContent='Отправляем…';
    $('emailSendFeedback').textContent='Готовим кадр и отправляем письмо.';
    try{
      // The editor is hidden now, so never recalculate from its zero-sized DOM.
      const selection=preparedEmailCrop;
      if(!selection)throw new Error('crop_unavailable');
      const aiMail=selection.kind==='ai';
      if(aiMail)await window.affrescoTryon.prepareCombinedExport(selection.context);
      const reply=await fetch(aiMail?'/api/ai-tryon-export.php':'/api/send-crop.php',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-Affresco-Request':'1'},
        body:JSON.stringify(aiMail?{email,context:selection.context}:{
          email,sku:selection.sku,width_cm:selection.width_cm,
          height_cm:selection.height_cm,image:selection.image,kind:selection.kind||'crop'
        })
      });
      let result=null;
      try{result=await reply.json();}catch(_){}
      if(!reply.ok||result?.accepted!==true){
        throw new Error(result?.error||'mail_unavailable');
      }
      if(result.email_saved===true)window.affrescoAccount?.setEmailFromSend(email);
      void window.affrescoAccount?.refreshProfile().catch(()=>{});
      if(openDialog===modalEmail&&requestId===emailSendRequest){
        preparedEmailCrop=null;
        $('emailSuccessDescription').textContent=(selection.kind==='ai'?(result.archive?'Письмо с ZIP-архивом всех примерок отправлено на ':'Письмо с изображением отправлено на '):selection.kind==='tryon'?'Письмо с примеркой отправлено на ':'Письмо с выбранным кадром отправлено на ')+email+
          '. Проверьте входящие и папку «Спам».'+
          (result.email_saved===false?' Адрес в профиле сохранить не удалось.':'');
        emailRecipient.value='';
        setModal(modalEmailSuccess);
      }
    }catch(error){
      if(openDialog===modalEmail&&requestId===emailSendRequest){
        const messages={
          crop_unavailable:'Не удалось получить выбранный фрагмент. Повторите попытку.',
          image_export_failed:'Браузер не смог подготовить изображение.',
          image_too_large:'Слишком большой кадр. Попробуйте уменьшить область выделения.',
          invalid_email:'Проверьте адрес: укажите полный email с доменом, например name@example.com.',
          invalid_request:'Данные кадра не прошли проверку сервера. Откройте редактор и попробуйте снова.',
          invalid_image:'Не удалось проверить JPEG-вложение. Выберите кадр повторно.',
          send_rate_limit:'За последнюю минуту уже отправлено пять писем. Попробуйте чуть позже.',
          rate_storage_unavailable:'Сервер пока не может проверить лимит отправок. Попробуйте позже.',
          email_storage_unavailable:'Не удалось сохранить email в аккаунте на сервере.',
          mail_unavailable:'Почтовый сервер пока не принимает письма. Попробуйте позже.',
          zip_unavailable:'На сервере пока нет поддержки ZIP-архивов.',
          zip_too_large:'Архив слишком большой для отправки.',
          ai_no_results:'Сохранённые изображения не найдены.',
          no_results:'Нет изображений для отправки. Сохраните ручную примерку или создайте AI-вариант.',
          manual_storage_limit:'На сервере уже много ручных примерок. Удалите ненужные в личном кабинете.',
          manual_conflict:'Изображение уже привязано к другой примерке. Повторите сохранение.',
          local_storage:'Не удалось прочитать сохранённые изображения из браузера.',
          login_required:'Для отправки ZIP войдите в аккаунт.',
          ai_storage_unavailable:'Сервер не может прочитать изображения.',
          smtp_not_configured:'SMTP-отправка ещё не настроена. Администратору нужно указать почтовый ящик отправителя.',
          smtp_invalid_config:'Неверные настройки почты отправителя. Сообщите администратору.',
          smtp_auth_failed:'Почтовый сервер отклонил логин или пароль отправителя. Сообщите администратору.',
          smtp_unavailable:'Нет соединения с SMTP-сервером или он отклонил письмо. Сообщите администратору.'
        };
        $('emailSendFeedback').textContent=messages[error.message]||
          'Ошибка отправки. Проверьте соединение и попробуйте ещё раз.';
      }
    }finally{
      emailSendBusy=false;
      emailSendSubmit.disabled=false;
      emailSendSubmit.textContent='Отправить';
    }
  });
  $('emailBackToEditor').addEventListener('click',()=>{
    preparedEmailCrop=null;
    setModal(emailReturnModal);
  });
  $('emailSuccessBack').addEventListener('click',()=>{
    preparedEmailCrop=null;
    setModal(emailReturnModal);
  });
  $('resetCrop').addEventListener('click',()=>{
    if(!imageLoaded)return;
    const aspect=cropImage.naturalWidth/cropImage.naturalHeight;
    const initial=catalogDimensions(currentItem);
    state.zoom=1;state.dx=0;state.dy=0;
    state.width=initial?initial.width:300;
    state.height=initial?initial.height:clamp(Math.round(300/aspect),30,1000);
    state.dimensionsSource=initial?'catalog':'fallback';
    state.ratio=state.width/state.height;state.lockRatio=true;ratioLock.checked=true;
    state.selection={x:0,y:0,w:1,h:1};
    widthInput.value=state.width;heightInput.value=state.height;
    updateCrop();validateCropWallFit();saveDraft();
    showFeedback('Исходное изображение восстановлено, кадрирование и масштаб сброшены.');
  });
  window.addEventListener('resize',()=>{
    if(openDialog===modalEditor)updateCrop();
  });
  $('tryOnWall').addEventListener('click',()=>{
    if(!currentItem||!imageLoaded){showFeedback('Сначала дождитесь загрузки изображения.',true);return;}
    if(!validateCropWallFit())return;
    try{
      const selection={image:cropEmailJpeg(),sku:currentItem.sku,width_cm:state.width,height_cm:state.height};
      saveDraft();cropConstraint=null;ownUploadConstraint=null;
      window.affrescoTryon.start(selection);
    }catch(_){showFeedback('Не удалось подготовить кадр для примерки. Попробуйте снова.',true);}
  });
  $('backToEditor').addEventListener('click',()=>setModal(modalEditor));
  $('changeSelectedFresco').addEventListener('click',()=>{
    // Preserve the current framing without mixing drafts between different SKUs.
    if(currentItem && imageLoaded) saveDraft();
    if(!pickerHasSearchContext) pickerSearch.value='';
    setModal(modalPicker);
    hidePickerSuggestions();
    updatePickerResults();
    pickerScroll.scrollTop=0;
    pickerSearch.focus();
  });


  async function refreshOwnFrescoes(){
    if(!media)return;
    try{
      ownFrescoes=(await media.all('fresco')).map(item=>{
        if(!ownImageUrls.has(item.id))ownImageUrls.set(item.id,URL.createObjectURL(item.blob));
        return {...item,image:ownImageUrls.get(item.id),sku:item.sku,
          name:item.name||'Моя фреска',isOwn:true};
      });
      window.affrescoTryon?.sceneItems?.([...ownFrescoes,...items]);
      if(openDialog===modalPicker)updatePickerResults();
      if(items.length||ownFrescoes.length)resetAndRenderCatalog();
    }catch(_){}
  }
  async function addOwnFresco(){
    const file=$('ownFrescoFile').files?.[0],w=Number($('ownFrescoWidth').value),h=Number($('ownFrescoHeight').value);
    const error=$('ownFrescoError');error.hidden=true;
    if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024){
      error.textContent='Выберите изображение JPEG, PNG или WebP до 12 МБ.';error.hidden=false;return;
    }
    if(!Number.isFinite(w)||!Number.isFinite(h)||w<30||h<30||w>1000||h>1000){
      error.textContent='Обязательно укажите ширину и высоту от 30 до 1000 см.';error.hidden=false;return;
    }
    try{
      const url=URL.createObjectURL(file),img=new Image();
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
      if(img.naturalWidth<100||img.naturalHeight<100||img.naturalWidth*img.naturalHeight>60000000)throw Error('image_size');
      const ratio=Math.min(1,1600/img.naturalWidth,1600/img.naturalHeight);
      const canvas=document.createElement('canvas');
      canvas.width=Math.round(img.naturalWidth*ratio);canvas.height=Math.round(img.naturalHeight*ratio);
      canvas.getContext('2d',{alpha:false}).drawImage(img,0,0,canvas.width,canvas.height);
      URL.revokeObjectURL(url);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));
      if(!blob)throw Error('image_encoding');
      const count=(await media.all('fresco')).length;
      const item=await media.put('fresco',blob,{sku:'own-'+crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,'').slice(0,70)||'Моя фреска',width_cm:w,height_cm:h});
      $('ownFrescoFile').value='';
      await refreshOwnFrescoes();
      const own=ownFrescoes.find(x=>x.sku===item.sku);
      if(own){openEditor(own,$('ownFrescoAdd'));if(ownUploadConstraint){cropConstraint=ownUploadConstraint;validateCropWallFit();}}
    }catch(e){
      error.textContent=e.message==='session_limit'?'Можно сохранить до 12 собственных фресок в текущей сессии.':'Не удалось сохранить изображение в браузере.';
      error.hidden=false;
    }
  }
  $('ownFrescoAdd').addEventListener('click',()=>{void addOwnFresco();});
  window.addEventListener('affresco:open-own-fresco',event=>{
    ownUploadConstraint=event.detail==='tryon'?window.affrescoTryon?.wallLimits?.()||null:null;
    const item=currentItem||items[0];
    if(item)openEditor(item);
    if(ownUploadConstraint){cropConstraint=ownUploadConstraint;validateCropWallFit();}
    $('ownFrescoFile').focus();
  });
  window.addEventListener('affresco:tryon-crop-item',event=>{
    if(!event.detail)return;
    const original=[...ownFrescoes,...items].find(x=>String(x.sku)===String(event.detail.sku));
    cropConstraint=window.affrescoTryon?.wallLimits?.()||null;
    openEditor(original||event.detail);
    validateCropWallFit();
  });
  window.addEventListener('affresco:tryon-current-art',event=>{
    const item=[...ownFrescoes,...items].find(x=>String(x.sku)===String(event.detail?.sku));
    if(item)currentItem=item;
  });
  window.addEventListener('affresco:own-fresco-changed',()=>{void refreshOwnFrescoes();});
  void refreshOwnFrescoes();
  function pickerResultsFor(query) {
    const q=query.trim().toLocaleLowerCase('ru');
    const source=[...ownFrescoes,...items];
    if(!q) return source;
    return source.filter(item =>
      item.sku.toLocaleLowerCase('ru').includes(q) ||
      (typeof item.name==='string' && item.name.toLocaleLowerCase('ru').includes(q))
    );
  }
  function hidePickerSuggestions() {
    pickerSuggestions.hidden=true;
    pickerSearch.setAttribute('aria-expanded','false');
  }
  function renderPickerSuggestions() {
    const query=pickerSearch.value.trim();
    pickerSuggestions.replaceChildren();
    if(!query) {hidePickerSuggestions();return;}
    const suggestions=pickerResultsFor(query).slice(0,5);
    if(!suggestions.length) {hidePickerSuggestions();return;}
    suggestions.forEach((item,index)=>{
      const option=document.createElement('button');
      option.type='button';option.className='picker-suggestion';
      option.id='picker-suggestion-'+index;option.setAttribute('role','option');
      option.textContent='Арт. '+item.sku+(item.name && item.name!=='Фреска '+item.sku ? ' · '+item.name : '');
      option.addEventListener('click',()=>{hidePickerSuggestions();openEditor(item,option);});
      pickerSuggestions.append(option);
    });
    pickerSuggestions.hidden=false;
    pickerSearch.setAttribute('aria-expanded','true');
  }
  function watchPickerBottom() {
    if(pickerObserver) pickerObserver.disconnect();
    if(openDialog!==modalPicker || pickerLoading || pickerRendered>=pickerMatches.length) return;
    if(!('IntersectionObserver' in window)) return;
    if(!pickerObserver) {
      pickerObserver=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting)) void loadPickerBatch();
      },{root:pickerScroll,rootMargin:'0px',threshold:0});
    }
    pickerObserver.observe(pickerMore);
  }
  async function loadPickerBatch() {
    if(pickerLoading || pickerRendered>=pickerMatches.length) return;
    const token=pickerToken;
    pickerLoading=true;
    pickerMore.hidden=false;
    loading(pickerLoader,true);
    pickerMoreButton.hidden=true;
    const batch=pickerMatches.slice(pickerRendered,pickerRendered+CATALOG_BATCH_SIZE);
    const cards=batch.map(item=>{
      const card=buildCard(item);
      card.classList.add('picker-card');
      card.querySelector('.catalog-label').textContent='Выбрать фреску';
      return card;
    });
    const fragment=document.createDocumentFragment();
    cards.forEach(card=>fragment.append(card));
    const first=pickerRendered===0;
    if(first)pickerGrid.append(fragment);
    pickerRendered+=cards.length;
    await Promise.all(cards.map(awaitCardImage));
    if(!first)await new Promise(resolve=>setTimeout(resolve,200));
    if(token!==pickerToken || openDialog!==modalPicker) return;
    if(!first)pickerGrid.append(fragment);
    pickerLoading=false;
    loading(pickerLoader,false);
    pickerStatus.textContent='Показано '+pickerRendered+' из '+pickerMatches.length+' фресок';
    pickerMore.hidden=pickerRendered>=pickerMatches.length;
    pickerMoreButton.hidden=pickerMore.hidden;
    watchPickerBottom();
  }
  function updatePickerResults() {
    ++pickerToken;
    if(pickerObserver)pickerObserver.disconnect();
    pickerMatches=pickerResultsFor(pickerSearch.value);
    pickerRendered=0;
    pickerLoading=false;
    pickerGrid.replaceChildren();
    pickerMore.hidden=true;
    pickerMoreButton.hidden=false;
    loading(pickerLoader,false);
    if(!pickerMatches.length){
      pickerStatus.textContent='По вашему запросу фрески не найдены. Попробуйте другой артикул.';
      return;
    }
    pickerStatus.textContent='Найдено '+pickerMatches.length+' фресок';
    void loadPickerBatch();
  }
  pickerSearch.addEventListener('input',()=>{
    renderPickerSuggestions();
    clearTimeout(pickerSearchTimer);
    pickerSearchTimer=setTimeout(updatePickerResults,130);
  });
  pickerSearch.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
      const suggestion=pickerResultsFor(pickerSearch.value)[0];
      if(suggestion && pickerSearch.value.trim()){
        event.preventDefault();
        clearTimeout(pickerSearchTimer);
        hidePickerSuggestions();
        openEditor(suggestion,pickerSearch);
      }
    } else if(event.key==='ArrowDown' && !pickerSuggestions.hidden) {
      event.preventDefault();
      pickerSuggestions.querySelector('button')?.focus();
    }
  });
  pickerMoreButton.addEventListener('click',()=>void loadPickerBatch());

  $('retryCatalog').addEventListener('click',loadCatalog);
  if(catalogMoreButton) catalogMoreButton.addEventListener('click',()=>void renderNextCatalogBatch(true));
  $('openFirstEditor').addEventListener('click',()=>{
    if(!items.length) {location.hash='catalog';return;}
    setModal(modalPicker,$('openFirstEditor'));
    pickerHasSearchContext=true;
    pickerSearch.value='';
    updatePickerResults();
    pickerSearch.focus();
  });
  loadCatalog();
})();

