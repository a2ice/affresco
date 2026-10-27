/* AFFRESCO MVP: catalogue from FTP images, client-side crop drafts, auth gate. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const catalogGrid = $('catalogGrid');
  const catalogStatus = $('catalogStatus');
  const catalogLoadMore = $('catalogLoadMore');
  const catalogBatchLoader = $('catalogBatchLoader');
  const catalogMoreButton = $('catalogMoreButton');
  const CATALOG_BATCH_SIZE = 6;
  let displayedCatalogCount = 0;
  let catalogLoadingBatch = false;
  let catalogGeneration = 0;
  let catalogObserver = null;
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
  const modalEditor = $('editorModal');
  const modalLogin = $('loginModal');
  const modalFuture = $('futureModal');
  const modals = [modalEditor, modalLogin, modalFuture];
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
      showFeedback('Настройки кадрирования сохранены в этом браузере.');
    } catch (_) {
      showFeedback('Браузер не разрешил сохранить черновик.', true);
    }
  }
  function showFeedback(message, error=false) {
    feedback.textContent = message;
    feedback.classList.toggle('error', error);
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
  function buildCard(item) {
    const card = document.createElement('button');
    card.type='button';
    card.className='catalog-card';
    card.setAttribute('aria-label','Открыть редактор фрески, артикул ' + item.sku);
    const figure = document.createElement('div');
    figure.className='catalog-image';
    const photo = document.createElement('img');
    photo.src=item.image;
    photo.alt='Фреска, артикул ' + item.sku;
    // Only create and request the six images in the current batch.
    photo.loading='eager';
    photo.decoding='async';
    photo.onerror = () => {
      photo.removeAttribute('src');
      photo.alt='Изображение временно недоступно';
      figure.style.background = 'linear-gradient(135deg,#ded6c8,#a49c8e)';
    };
    const flag = document.createElement('span');
    flag.className='catalog-label';
    flag.textContent='Выбрать фреску';
    figure.append(photo,flag);
    const meta = document.createElement('span');
    meta.className='catalog-meta';
    const title = document.createElement('strong');
    title.textContent='Арт. ' + item.sku;
    const arrow = document.createElement('span');
    arrow.textContent='Кадрировать ↗';
    meta.append(title,arrow);
    card.append(figure,meta);
    card.addEventListener('click', () => openEditor(item,card));
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
  function updateCatalogStatus() {
    catalogStatus.textContent='Показано '+displayedCatalogCount+' из '+items.length+' · Выберите фреску для кадрирования';
  }
  function watchCatalogBottom() {
    if(catalogObserver) catalogObserver.disconnect();
    if(displayedCatalogCount>=items.length || catalogLoadingBatch) return;
    if(!catalogLoadMore || !('IntersectionObserver' in window)) return; // Older HTML / manual fallback.
    if(!catalogObserver) {
      catalogObserver=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting)) void renderNextCatalogBatch();
      },{rootMargin:'0px',threshold:0});
    }
    catalogObserver.observe(catalogLoadMore);
  }
  async function renderNextCatalogBatch() {
    if(catalogLoadingBatch || displayedCatalogCount>=items.length) return;
    const generation=catalogGeneration;
    catalogLoadingBatch=true;
    if(catalogLoadMore) catalogLoadMore.hidden=false;
    loading(catalogBatchLoader,true);
    if(catalogMoreButton) catalogMoreButton.hidden=true;

    const isAdditionalBatch=displayedCatalogCount>0;
    const started=performance.now();
    const next=items.slice(displayedCatalogCount,displayedCatalogCount+(catalogLoadMore ? CATALOG_BATCH_SIZE : items.length));
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
    if(isAdditionalBatch) {
      catalogGrid.append(fragment);
      requestAnimationFrame(()=>cards.forEach(card=>card.classList.remove('catalog-card-pending')));
    }
    updateCatalogStatus();
    catalogLoadingBatch=false;
    loading(catalogBatchLoader,false);
    if(catalogLoadMore) catalogLoadMore.hidden=displayedCatalogCount>=items.length;
    if(catalogMoreButton) catalogMoreButton.hidden=!catalogLoadMore || catalogLoadMore.hidden;
    watchCatalogBottom();
  }
  function resetCatalogPagination() {
    ++catalogGeneration;
    if(catalogObserver) catalogObserver.disconnect();
    displayedCatalogCount=0;
    catalogLoadingBatch=false;
    if(catalogLoadMore) catalogLoadMore.hidden=true;
    if(catalogMoreButton) catalogMoreButton.hidden=false;
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
      void renderNextCatalogBatch();
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
      // Click handling is registered once below for all catalog states.
    } catch (error) {
      if(requestGeneration!==catalogGeneration) return;
      catalogStatus.textContent='Каталог временно недоступен';
      stopHeroLoading();
      catalogMessage('Не удалось получить список фотографий с сервера. Проверьте размещение Images/catalog и доступность PHP-обработчика /api/catalog.php.');
    }
  }

  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function ratioFromDimensions() {
    const width=Number(widthInput.value),height=Number(heightInput.value);
    if (!Number.isFinite(width)||!Number.isFinite(height)||width<30||height<30||width>1000||height>1000) return false;
    state.width=width;state.height=height;state.ratio=width/height;
    return true;
  }
  function setRatio(value) {
    state.ratio=value;
    state.height=Math.round(state.width/value);
    if (state.height<30 || state.height>1000) {state.width=300;state.height=Math.round(300/value);}
    widthInput.value=state.width;
    heightInput.value=state.height;
    document.querySelectorAll('[data-ratio]').forEach(btn => btn.setAttribute('aria-pressed',String(Math.abs(Number(btn.dataset.ratio)-state.ratio)<.018)));
    updateCrop(true);
    saveDraft();
  }
  function metrics() {
    const width=cropViewport.clientWidth, height=cropViewport.clientHeight;
    const nw=cropImage.naturalWidth, nh=cropImage.naturalHeight;
    if (!imageLoaded||!width||!height||!nw||!nh) return null;
    const scale=Math.max(width/nw,height/nh)*state.zoom;
    const drawW=nw*scale, drawH=nh*scale;
    return {width,height,nw,nh,scale,drawW,drawH,maxX:Math.max(0,(drawW-width)/2),maxY:Math.max(0,(drawH-height)/2)};
  }
  function getCrop() {
    const m=metrics();if(!m)return null;
    return {x:clamp((m.drawW-m.width)/2-state.dx,0,m.drawW)/m.scale/m.nw,
      y:clamp((m.drawH-m.height)/2-state.dy,0,m.drawH)/m.scale/m.nh,
      width:Math.min(m.width/m.scale/m.nw,1),
      height:Math.min(m.height/m.scale/m.nh,1)};
  }
  function updateCrop(resetPosition=false) {
    if (resetPosition) {state.dx=0;state.dy=0;}
    cropViewport.style.aspectRatio=String(clamp(state.ratio,.3,3.5));
    document.querySelectorAll('[data-ratio]').forEach(btn => btn.setAttribute('aria-pressed',String(Math.abs(Number(btn.dataset.ratio)-state.ratio)<.018)));
    zoom.value=state.zoom;
    $('zoomValue').textContent=Math.round(state.zoom*100)+'%';
    const m=metrics();if(!m)return;
    state.dx=clamp(state.dx,-m.maxX,m.maxX);
    state.dy=clamp(state.dy,-m.maxY,m.maxY);
    cropImage.style.width=m.drawW+'px';
    cropImage.style.height=m.drawH+'px';
    cropImage.style.transform='translate(calc(-50% + '+state.dx+'px),calc(-50% + '+state.dy+'px))';
  }
  function openEditor(item,trigger) {
    if(!item||!safeSku(item.sku))return;
    currentItem=item;
    state={zoom:1,dx:0,dy:0,ratio:4/3,width:300,height:225,...(getDraft(item.sku)||{})};
    state.zoom=clamp(state.zoom,1,3);
    state.width=clamp(state.width,30,1000);state.height=clamp(state.height,30,1000);
    state.ratio=state.width/state.height;
    widthInput.value=state.width;
    heightInput.value=state.height;
    editorTitle.textContent='Ваш кадр фрески';
    selectedSku.textContent='Артикул '+item.sku;
    imageLoaded=false;
    clearTimeout(cropTimer);
    loading(cropLoader,true);
    cropImage.removeAttribute('src');
    showFeedback('Передвигайте изображение пальцем или мышью и меняйте масштаб.');
    setModal(modalEditor,trigger);
    cropImage.onload=()=>{ imageLoaded=true; stopCropLoading();updateCrop(); };
    cropImage.onerror=()=>{ imageLoaded=false;stopCropLoading();showFeedback('Не удалось загрузить фото фрески. Проверьте путь на FTP.',true); };
    cropImage.src=item.image;
    cropTimer=setTimeout(()=>{if(!imageLoaded){stopCropLoading();showFeedback('Изображение загружается слишком долго. Проверьте файл и повторите попытку.',true);}},12000);
    updateCrop();
  }
  document.querySelectorAll('[data-ratio]').forEach(btn => btn.addEventListener('click',()=>setRatio(Number(btn.dataset.ratio))));
  [widthInput,heightInput].forEach(input => input.addEventListener('change',()=>{
    if (!ratioFromDimensions()) {
      showFeedback('Введите ширину и высоту от 30 до 1000 см.',true);
      widthInput.value=state.width;heightInput.value=state.height;
      return;
    }
    updateCrop(true);saveDraft();
  }));
  zoom.addEventListener('input',()=>{state.zoom=clamp(Number(zoom.value),1,3);updateCrop();});
  zoom.addEventListener('change',saveDraft);
  cropViewport.addEventListener('pointerdown',(e)=>{
    if(!imageLoaded)return;
    if(e.button!==0 && e.pointerType==='mouse')return;
    activePointer={id:e.pointerId,x:e.clientX,y:e.clientY,dx:state.dx,dy:state.dy};
    cropViewport.setPointerCapture(e.pointerId);
  });
  cropViewport.addEventListener('pointermove',(e)=>{
    if(!activePointer || activePointer.id!==e.pointerId)return;
    state.dx=activePointer.dx+(e.clientX-activePointer.x);
    state.dy=activePointer.dy+(e.clientY-activePointer.y);
    updateCrop();
  });
  for(const name of ['pointerup','pointercancel'])cropViewport.addEventListener(name,(e)=>{
    if(activePointer?.id!==e.pointerId)return;
    activePointer=null;saveDraft();
  });
  cropViewport.addEventListener('wheel',(e)=>{
    if(!imageLoaded)return;
    e.preventDefault();
    state.zoom=clamp(Math.round((state.zoom+(e.deltaY<0?.1:-.1))*10)/10,1,3);
    updateCrop();saveDraft();
  },{passive:false});
  $('saveCrop').addEventListener('click',saveDraft);
  $('resetCrop').addEventListener('click',()=>{
    state.zoom=1;state.dx=0;state.dy=0;updateCrop();saveDraft();
  });
  window.addEventListener('resize',()=>{if(openDialog===modalEditor) updateCrop();});
  $('tryOnWall').addEventListener('click',async()=>{
    if(!currentItem||!imageLoaded){showFeedback('Сначала дождитесь загрузки изображения.',true);return;}
    saveDraft();
    const trigger=$('tryOnWall');
    trigger.disabled=true;
    trigger.textContent='Проверяем вход…';
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
      trigger.textContent='Примерить на стену ↗';
    }
  });
  $('backToEditor').addEventListener('click',()=>setModal(modalEditor));
  $('retryCatalog').addEventListener('click',loadCatalog);
  if(catalogMoreButton) catalogMoreButton.addEventListener('click',()=>void renderNextCatalogBatch());
  $('openFirstEditor').addEventListener('click',()=>{
    if(items.length)openEditor(items[0],$('openFirstEditor'));
    else location.hash='catalog';
  });
  loadCatalog();
})();