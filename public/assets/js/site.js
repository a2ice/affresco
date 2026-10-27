/* AFFRESCO MVP: catalogue from FTP images, client-side crop drafts, auth gate. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const catalogGrid = $('catalogGrid');
  const catalogStatus = $('catalogStatus');
  const catalogLoadMore = $('catalogLoadMore');
  const catalogBatchLoader = $('catalogBatchLoader');
  const catalogMoreButton = $('catalogMoreButton');
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
    // Without a saved crop, open the whole image (no implicit 90% selection).
    state={zoom:1,dx:0,dy:0,ratio:4/3,width:300,height:225,lockRatio:true,selection:null,...(draft||{})};
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
        // Legacy drafts without selection and new visits both start with the full photo.
        state.selection={x:0,y:0,w:1,h:1};
        state.width=300;
        state.height=clamp(Math.round(300/aspect),30,1000);
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
    activePointer={id:e.pointerId,x:e.clientX,y:e.clientY,dx:state.dx,dy:state.dy,
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
      state.dx=activePointer.dx+deltaX;state.dy=activePointer.dy+deltaY;
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
  if(catalogMoreButton) catalogMoreButton.addEventListener('click',()=>void renderNextCatalogBatch());
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