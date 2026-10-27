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
  const modalLogin = $('loginModal');
  const modalFuture = $('futureModal');
  const modals = [modalPicker, modalEditor, modalLogin, modalFuture];
  let previousFocus = null;
  let openDialog = null;
  let items = [];
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
    try {
      localStorage.setItem(storageKey(currentItem.sku), JSON.stringify(payload));
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

  function setModal(modal, trigger=null) {
    if (!openDialog && trigger) previousFocus = trigger;
    if(modal !== modalPicker && pickerObserver) pickerObserver.disconnect();
    modals.forEach(el => el.hidden = el !== modal);
    openDialog = modal;
    document.body.classList.toggle('modal-open', Boolean(modal));
    if (modal) {
      const target = modal.querySelector('[data-close]') || modal.querySelector('button, [href], input');
      if (target) target.focus();
    } else if (previousFocus?.isConnected) {
      previousFocus.focus();
      previousFocus = null;
    }
  }
  modals.forEach(modal => {
    modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => setModal(null)));
    modal.addEventListener('pointerdown', e => { if (e.target === modal) setModal(null); });
  });
  document.addEventListener('keydown', (event) => {
    if (!openDialog) return;
    if (event.key === 'Escape') { event.preventDefault(); setModal(null); return; }
    if (event.key !== 'Tab') return;
    const tabbables = [...openDialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el => el.getClientRects().length);
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
    flag.textContent='Выбрать фреску';
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
    card.append(content,favoriteButton);
    updateFavoriteButton(favoriteButton,item.sku);
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
    const source=favoritesOnly?items.filter(item=>favorites.has(item.sku)):items;
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
    button.disabled=!favoritesReady||pendingFavoriteSkus.has(sku);
  }
  function refreshFavoritesUI(){
    favoritesCount.textContent=String(favorites.size);
    favoritesToggle.setAttribute('aria-pressed',String(favoritesOnly));
    favoritesToggle.setAttribute('aria-label',
      (favoritesOnly?'Показать всю коллекцию':'Показать избранное')+
      ', '+favorites.size+' фресок');
    favoritesToggle.title=favoritesOnly?'Показать всю коллекцию':'Показать избранное';
    document.querySelectorAll('[data-favorite-sku]').forEach(button=>
      updateFavoriteButton(button,button.dataset.favoriteSku));
  }
  function showFavoritesError(message){
    favoritesFeedback.textContent=message;
    favoritesFeedback.hidden=!message;
  }
  async function loadFavorites(){
    // Refresh from the server when returning to a tab; never blindly copy
    // guest data into an account (the API explicitly separates scopes).
    if(pendingFavoriteSkus.size)return;
    const requestRevision=favoritesRevision;
    try{
      const result=await fetch('/api/favorites.php',{
        credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}
      });
      if(!result.ok)throw Error('HTTP '+result.status);
      const data=await result.json();
      // An in-flight GET must not overwrite a more recent heart click.
      if(requestRevision!==favoritesRevision)return;
      if(!data||data.scope!=='guest'||!Array.isArray(data.items))throw Error('invalid favorites');
      const previous=favorites;
      favorites=new Set(data.items.filter(safeSku));
      favoritesReady=true;
      showFavoritesError('');
      if(favoritesOnly && items.length &&
        (favorites.size!==previous.size || [...favorites].some(sku=>!previous.has(sku)))){
        resetAndRenderCatalog();
      }
    }catch(_){
      if(requestRevision!==favoritesRevision)return;
      favoritesReady=false;
      showFavoritesError('Избранное временно недоступно. Попробуйте обновить страницу.');
    }
    refreshFavoritesUI();
  }
  function toggleFavorite(sku){
    if(!favoritesReady||!safeSku(sku)||pendingFavoriteSkus.has(sku))return Promise.resolve();
    pendingFavoriteSkus.add(sku);
    ++favoritesRevision;
    refreshFavoritesUI();
    // Serialize writes: an older response must never replace a newer list
    // when the user taps hearts for two different SKUs in quick succession.
    favoriteMutationQueue=favoriteMutationQueue.then(async()=>{
      const action=favorites.has(sku)?'remove':'add';
      try{
        const result=await fetch('/api/favorites.php',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'Content-Type':'application/json','Accept':'application/json','X-Affresco-Request':'1'},
          body:JSON.stringify({action,sku})
        });
        if(!result.ok)throw Error('HTTP '+result.status);
        const data=await result.json();
        if(!data||data.scope!=='guest'||!Array.isArray(data.items))throw Error('invalid favorites');
        favorites=new Set(data.items.filter(safeSku));
        showFavoritesError('');
        if(favoritesOnly)resetAndRenderCatalog();
      }catch(_){
        showFavoritesError('Не получилось сохранить избранное. Попробуйте ещё раз.');
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
  favoritesToggle.addEventListener('click',()=>{
    if(!favoritesReady){showFavoritesError('Избранное ещё не загрузилось.');return;}
    favoritesOnly=!favoritesOnly;
    refreshFavoritesUI();
    hideCatalogSuggestions();
    resetAndRenderCatalog();
    document.getElementById('catalog').scrollIntoView({block:'start',behavior:'smooth'});
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
      catalogGrid.replaceChildren();
      if (items.length===0) {
        catalogStatus.textContent='Пока нет изображений';
        stopHeroLoading();
        catalogMessage('Как только изображения по артикулам появятся в /Images/catalog/ на FTP, карточки автоматически появятся здесь. Также поддерживается /Images/каталог/.');
        return;
      }
      // Only six cards/images are mounted at first. Remaining images wait for scrolling.
      resetAndRenderCatalog();
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
  function syncDimensionsAfterResize(before,after,startWidthCm,startHeightCm){
    // Both dimensions scale with their respective crop edges. In particular,
    // shrinking the frame horizontally must NEVER increase its height in cm.
    // Start from pointer-down values rather than rounded intermediate frames.
    if(before.w<=0||before.h<=0)return;
    state.width=clamp(Math.round(startWidthCm*(after.w/before.w)),30,1000);
    state.height=clamp(Math.round(startHeightCm*(after.h/before.h)),30,1000);
    state.ratio=state.width/state.height;
    widthInput.value=state.width;
    heightInput.value=state.height;
  }
  function ratioFromDimensions(){
    const width=Number(widthInput.value),height=Number(heightInput.value);
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<30||height<30||width>1000||height>1000)return false;
    state.width=width;state.height=height;state.ratio=width/height;
    fitSelectionToRatio(state.ratio);
    updateCrop(true);
    return true;
  }
  function setRatio(value){
    state.width=clamp(state.width,30,1000);
    state.height=Math.round(state.width/value);
    if(state.height<30||state.height>1000){state.width=300;state.height=Math.round(300/value);}
    state.ratio=state.width/state.height;
    state.lockRatio=true;ratioLock.checked=true;
    widthInput.value=state.width;heightInput.value=state.height;
    fitSelectionToRatio(state.ratio);
    updateCrop(true);saveDraft();
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
  function openEditor(item,trigger){
    if(!item||!safeSku(item.sku))return;
    pickerHasSearchContext=openDialog===modalPicker;
    currentItem=item;
    const draft=getDraft(item.sku);
    // The first crop adopts the selected SKU's catalogue dimensions.
    // An existing per-SKU saved crop always wins over the catalogue defaults.
    const catalogWidth=Number(item.width_cm),catalogHeight=Number(item.height_cm);
    const hasDimensions=Number.isFinite(catalogWidth)&&Number.isFinite(catalogHeight)&&
      catalogWidth>=30&&catalogWidth<=1000&&catalogHeight>=30&&catalogHeight<=1000;
    const startingWidth=hasDimensions?catalogWidth:300;
    const startingHeight=hasDimensions?catalogHeight:225;
    state={zoom:1,dx:0,dy:0,ratio:startingWidth/startingHeight,
      width:startingWidth,height:startingHeight,lockRatio:true,selection:null,...(draft||{})};
    const dimensionsNote=$('editorDimensionsNote');
    dimensionsNote.hidden=!hasDimensions||item.dimensions_estimated!==true;
    state.zoom=clamp(state.zoom,1,3);
    state.width=clamp(state.width,30,1000);state.height=clamp(state.height,30,1000);
    state.ratio=state.width/state.height;
    state.lockRatio=state.lockRatio!==false;
    if(!validSelection(state.selection))state.selection=null;
    ratioLock.checked=state.lockRatio;
    widthInput.value=state.width;heightInput.value=state.height;
    editorTitle.textContent='Ваш кадр фрески';
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
      updateCrop();
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
      showFeedback('Введите ширину и высоту от 30 до 1000 см.',true);
      widthInput.value=oldW;heightInput.value=oldH;return;
    }
    saveDraft();
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
  $('saveCrop').addEventListener('click',saveDraft);
  $('resetCrop').addEventListener('click',()=>{
    if(!imageLoaded)return;
    const aspect=cropImage.naturalWidth/cropImage.naturalHeight;
    state.zoom=1;state.dx=0;state.dy=0;
    state.width=300;state.height=clamp(Math.round(300/aspect),30,1000);
    state.ratio=state.width/state.height;state.lockRatio=true;ratioLock.checked=true;
    state.selection={x:0,y:0,w:1,h:1};
    widthInput.value=state.width;heightInput.value=state.height;
    updateCrop();saveDraft();
    showFeedback('Исходное изображение восстановлено, кадрирование и масштаб сброшены.');
  });
  window.addEventListener('resize',()=>{
    if(openDialog===modalEditor)updateCrop();
  });
  $('tryOnWall').addEventListener('click',async()=>{
    if(!currentItem||!imageLoaded){showFeedback('Сначала дождитесь загрузки изображения.',true);return;}
    saveDraft();
    const trigger=$('tryOnWall');
    const triggerLabel=$('tryOnWallLabel');
    trigger.disabled=true;
    trigger.setAttribute('aria-label','Проверяем вход');
    triggerLabel.textContent='Проверка…';
    try {
      const response=await fetch('/api/session.php',{cache:'no-store',headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('session HTTP '+response.status);
      const session=await response.json();
      if(session.authenticated===true){
        $('futureSku').textContent=currentItem.sku;
        setModal(modalFuture);
      } else {
        $('loginFeedback').textContent='Чтобы примерить фреску на стену, войдите в аккаунт. Сейчас авторизация временно недоступна, но настройки кадра сохранены.';
        setModal(modalLogin);
      }
    } catch(_){
      showFeedback('Проверка входа сейчас недоступна. Черновик сохранён, попробуйте позже.',true);
    } finally {
      trigger.disabled=false;
      trigger.setAttribute('aria-label','Примерить на стену');
      triggerLabel.textContent='Примерить';
    }
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

  function pickerResultsFor(query) {
    const q=query.trim().toLocaleLowerCase('ru');
    if(!q) return items;
    return items.filter(item =>
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