/* Manual room try-on. Room photos stay in the browser until explicit email sending. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),core=window.affrescoTryonCore;
  if(window.affrescoTryonCompat?.supported===false){
    window.affrescoTryon={start:()=>window.dispatchEvent(new CustomEvent('affresco:open-modal',{detail:'tryon'})),renderHistory:()=>{
      const target=$('accountTryonList');if(target)target.textContent='Обновите браузер, чтобы работать с ручными примерками.';
    }};
    return;
  }
  const canvas=$('tryonCanvas'),ctx=canvas.getContext('2d',{alpha:false}),stage=$('tryonStage');
  let view={zoom:1,panX:0,panY:0};
  const pointers=new Map();
  let pinch=null;
  const stageBounds=()=>stage.getBoundingClientRect();
  function scene(){
    const bounds=stageBounds();
    return {bounds,...core.viewTransform(canvas.width,canvas.height,bounds.width,bounds.height,view)};
  }
  function layoutScene(){
    if(!room)return;
    const {scale,x,y}=scene();
    if(!Number.isFinite(scale)||scale<=0)return;
    canvas.style.left=x+'px';canvas.style.top=y+'px';
    canvas.style.width=(canvas.width*scale)+'px';
    canvas.style.height=(canvas.height*scale)+'px';
    $('tryonZoomValue').textContent=Math.round(view.zoom*100)+'%';
  }
  function updateView(next){
    if(!room)return;
    view=next;layoutScene();renderControls();
  }
  const fitPhoto=()=>updateView({zoom:1,panX:0,panY:0});
  function fitWall(){
    if(!wallQuad||!room)return;
    const bounds=stageBounds();
    updateView(core.fitQuadView(wallQuad,canvas.width,canvas.height,bounds.width,bounds.height));
  }
  function zoomAt(factor,at){
    if(!room)return;
    const bounds=stageBounds();
    updateView(core.zoomViewAt(view,factor,at||{x:bounds.width/2,y:bounds.height/2},bounds.width,bounds.height));
  }
  function keepCornerVisible(index){
    if(index<0||!wallQuad)return;
    const p=(layer==='wall'?wallQuad:quad)?.[index];
    if(!p)return;
    const {bounds,scale,x,y}=scene(),margin=28;
    const sx=x+p.x*scale,sy=y+p.y*scale;
    const dx=sx<margin?margin-sx:sx>bounds.width-margin?bounds.width-margin-sx:0;
    const dy=sy<margin?margin-sy:sy>bounds.height-margin?bounds.height-margin-sy:0;
    if(dx||dy)updateView({...view,panX:view.panX+dx,panY:view.panY+dy});
  }
  let selected=true,lightMode=false,lighting=null,layer='wall',wallQuad=null,placed=null,lastWall={width:500,height:275};
  let selection=null,room=null,crop=null,quad=null,placing=false,revision=0,savedRevision=-1,saved=null,busy=false,drag=null,operation=0,historyRequest=0;
  const keyOwner=()=>window.affrescoAccount?.current()?.id?'account:'+window.affrescoAccount.current().id:'guest';
  const open=()=>window.dispatchEvent(new CustomEvent('affresco:open-modal',{detail:'tryon'}));
  const feedback=(message,error=false)=>{$('tryonFeedback').textContent=message;$('tryonFeedback').classList.toggle('is-error',error);};
  function imageFrom(source){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('image_decode'));img.src=source;});}
  function database(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open('affresco-manual-tryons',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('images',{keyPath:'id'});
      req.onerror=()=>reject(Error('local_storage'));req.onblocked=()=>reject(Error('local_storage'));
      req.onsuccess=()=>resolve(req.result);
    });
  }
  async function records(owner=keyOwner()){
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('images','readonly'),req=tx.objectStore('images').getAll();
      tx.oncomplete=()=>{db.close();resolve((req.result||[]).filter(r=>r.owner===owner).sort((a,b)=>b.created-a.created));};
      tx.onerror=tx.onabort=()=>{db.close();reject(Error('local_storage'));};
    });
  }
  async function store(record){
    const db=await database();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('images','readwrite');tx.objectStore('images').put(record);
      tx.oncomplete=()=>{db.close();resolve();};tx.onerror=tx.onabort=()=>{db.close();reject(Error('local_storage'));};
    });
    await prune(record.owner);
  }
  function storageNote(owner=keyOwner()){
    return core.historyLimit(owner)===3
      ?'Гостю доступны 3 последние примерки на этом устройстве. Авторизуйтесь, чтобы сохранять до 12.'
      :'';
  }
  async function prune(owner){
    const list=await records(owner),limit=core.historyLimit(owner);
    if(list.length>limit){
      const db=await database();await new Promise((resolve,reject)=>{
        const tx=db.transaction('images','readwrite');for(const item of list.slice(limit))tx.objectStore('images').delete(item.id);
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=tx.onabort=()=>{db.close();reject(Error('local_storage'));};
      });
    }
    return list.slice(0,limit);
  }
  async function storageAvailable(){
    const db=await database();
    return new Promise((resolve,reject)=>{
      const id='probe-'+crypto.randomUUID(),tx=db.transaction('images','readwrite'),store=tx.objectStore('images');
      store.put({id,owner:'probe'});store.delete(id);
      tx.oncomplete=()=>{db.close();resolve();};tx.onerror=tx.onabort=()=>{db.close();reject(Error('local_storage'));};
    });
  }
  function wall(){return {width:core.wallValue($('tryonWallWidth').value),height:core.wallValue($('tryonWallHeight').value)};}
  function validWall(){const w=wall();return Number.isFinite(w.width)&&Number.isFinite(w.height);}
  const cm=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1})+' см';
  function rebuildPlacement(percent){
    if(!validWall()||!selection)return;
    const w=wall();
    const previous=placed;
    const value=percent??(previous?previous.width/selection.width_cm*100:100);
    placed=core.placement(selection,w,value,previous);lastWall=w;
    if(wallQuad)quad=core.placementQuad(wallQuad,w,placed);
    $('tryonScale').max=core.maxPlacementPercent(selection,w);
    $('tryonScale').value=placed.width/selection.width_cm*100;
    $('tryonScaleValue').textContent=cm(placed.width)+' × '+cm(placed.height)+' · '+Number($('tryonScale').value).toFixed(1).replace(/\.0$/,'')+'%';
  }
  function setLayer(value){
    if(value==='fresco'&&!placing)return;
    layer=value;selected=true;lightMode=false;drag=null;
    $('tryonHandle').value='layer';
    $('tryonLayerWall').setAttribute('aria-pressed',String(layer==='wall'));
    $('tryonLayerFresco').setAttribute('aria-pressed',String(layer==='fresco'));
    paint();
  }
  function checkFit(){
    const invalid=!validWall();
    $('tryonFit').textContent=invalid?'Укажите ширину и высоту стены от 30 до 5000 см.'
      :!placing?'Выделите четыре угла стены и подтвердите её размеры.'
      :'Размещение: '+cm(placed.width)+' × '+cm(placed.height)+'. Максимум — размер исходного кадра и границы стены.';
    $('tryonFit').classList.toggle('is-warning',invalid);
    for(const id of ['tryonBegin','tryonSave','tryonDownload','tryonEmail'])$(id).disabled=busy||invalid;
    $('tryonLayerWall').disabled=busy;$('tryonLayerFresco').disabled=busy||!placing;
    $('tryonScale').disabled=busy||invalid||layer!=='fresco';
    return invalid;
  }
  function paint(){
    if(!room)return;
    checkFit();
    if(placing&&placed&&wallQuad)quad=core.placementQuad(wallQuad,lastWall,placed);
    core.draw(ctx,room,placing?crop:null,placing?quad:null,false,false,lighting,12);
    layoutScene();renderControls();syncLightTools();
  }
  function syncLightTools(){
    $('tryonLightToggle').setAttribute('aria-pressed',String(lightMode));
    $('tryonLightTone').hidden=!lightMode;
    $('tryonLightCancel').disabled=busy||!lighting;
    canvas.classList.toggle('is-light-mode',lightMode);
  }
  function renderControls(){
    const svg=$('tryonControls');
    if(!room||!wallQuad){svg.innerHTML='';return;}
    const {bounds,scale,x:ox,y:oy}=scene();
    if(!Number.isFinite(scale)||scale<=0){svg.innerHTML='';return;}
    const map=q=>core.controlPoints(q,scale,ox,oy);
    function outline(q,active,color){return '<polygon points="'+map(q).map(p=>p.x+','+p.y).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="'+(active?1.5:1)+'" stroke-dasharray="5 4" opacity="'+(active?1:.5)+'"/>';}
    function dimensions(q,width,height,color){
      const points=map(q),bottom={x:(points[3].x+points[2].x)/2,y:(points[3].y+points[2].y)/2+22},left={x:(points[0].x+points[3].x)/2-30,y:(points[0].y+points[3].y)/2};
      function label(p,value){
        const text=cm(value),w=text.length*7+14,x=Math.max(w/2+3,Math.min(bounds.width-w/2-3,p.x)),y=Math.max(14,Math.min(bounds.height-12,p.y));
        return '<rect x="'+(x-w/2)+'" y="'+(y-11)+'" width="'+w+'" height="21" rx="2" fill="#faf9f6" opacity=".94"/><text x="'+x+'" y="'+(y+3)+'" text-anchor="middle" fill="'+color+'" font-family="Manrope,Arial,sans-serif" font-size="11">'+text+'</text>';
      }
      return label(bottom,width)+label(left,height);
    }
    let markup='';
    if(selected&&!lightMode){
      markup+=outline(wallQuad,layer==='wall','#766453')+dimensions(wallQuad,lastWall.width,lastWall.height,'#766453');
      if(placing&&quad)markup+=outline(quad,layer==='fresco','#25231f')+dimensions(quad,placed.width,placed.height,'#25231f');
      for(const p of map(layer==='wall'?wallQuad:quad)){
        markup+='<circle cx="'+p.x+'" cy="'+p.y+'" r="18" fill="#faf9f6" fill-opacity=".35" stroke="#766453" stroke-opacity=".4" stroke-width="1"/>';
        markup+='<rect class="tryon-corner" x="'+(p.x-6)+'.5" y="'+(p.y-6)+'.5" width="12" height="12" fill="#fff" stroke="#766453" stroke-width="1"/>';
      }
    }
    if(lightMode&&lighting){
      const a={x:lighting.from.x*canvas.width*scale+ox,y:lighting.from.y*canvas.height*scale+oy},b={x:lighting.to.x*canvas.width*scale+ox,y:lighting.to.y*canvas.height*scale+oy};
      const angle=Math.atan2(b.y-a.y,b.x-a.x),size=9;
      const left={x:b.x-size*Math.cos(angle-.5),y:b.y-size*Math.sin(angle-.5)},right={x:b.x-size*Math.cos(angle+.5),y:b.y-size*Math.sin(angle+.5)};
      markup+='<path d="M '+a.x+' '+a.y+' L '+b.x+' '+b.y+' M '+left.x+' '+left.y+' L '+b.x+' '+b.y+' L '+right.x+' '+right.y+'" stroke="#f0c67b" stroke-width="2" fill="none"/><circle cx="'+a.x+'" cy="'+a.y+'" r="4" fill="#f0c67b" stroke="#766453"/>';
    }
    svg.innerHTML=markup;
  }
  window.addEventListener('resize',()=>{if(room)paint();});
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{if(room)paint();}).observe(stage);
  function changed(){revision++;saved=null;feedback('');paint();}
  function summary(){if(selection){$('tryonSummary').textContent='Арт. '+selection.sku+' · Исходный кадр '+cm(selection.width_cm)+' × '+cm(selection.height_cm);$('tryonCopyFeedback').textContent='';}}
  function showStep(which){
    $('tryonUploadStep').hidden=which!=='upload';$('tryonWorkspace').hidden=!['setup','placement'].includes(which);$('tryonSavedStep').hidden=which!=='saved';
    $('tryonSetupActions').hidden=which!=='setup';$('tryonPlacementActions').hidden=which!=='placement';
    $('tryonFooter').hidden=!['placement','saved'].includes(which);
    $('tryonFooterPlacement').hidden=which!=='placement';$('tryonFooterSaved').hidden=which!=='saved';
    $('tryonChangeRoom').hidden=!['setup','placement'].includes(which);
    if(which!=='placement')$('tryonControls').innerHTML='';
  }
  function resetRoom(){view={zoom:1,panX:0,panY:0};pointers.clear();pinch=null;stage.classList.remove('is-panning');wallQuad=null;placed=null;layer='wall';lastWall={width:500,height:275};$('tryonLayerWall').setAttribute('aria-pressed','true');$('tryonLayerFresco').setAttribute('aria-pressed','false');selected=true;lightMode=false;lighting=null;syncLightTools();room=null;quad=null;placing=false;drag=null;saved=null;revision++;savedRevision=-1;$('tryonRoomFile').value='';showStep('upload');feedback('');}
  async function start(value){
    operation++;selection={...value};crop=null;resetRoom();summary();
    $('tryonPreset').value='standard';$('tryonWallWidth').value=500;$('tryonWallHeight').value=275;$('tryonBack').hidden=false;
    $('tryonScaleValue').textContent='100%';$('tryonHandle').value='layer';
    $('tryonStorageNote').textContent=storageNote();$('tryonStorageNote').hidden=!$('tryonStorageNote').textContent;
    $('tryonCompatibilityMessage').hidden=true;
    $('tryonUploadZone').disabled=true;
    const token=operation;open();
    try{await storageAvailable();if(token===operation){$('tryonUploadZone').disabled=false;await prune(keyOwner());}}
    catch(_){if(token===operation){showStep('unsupported');$('tryonCompatibilityMessage').textContent='Браузер не разрешает сохранять примерки на этом устройстве. Разрешите хранение данных сайта или попробуйте другой браузер.';$('tryonCompatibilityMessage').hidden=false;}}
  }
  async function loadRoom(file){
    if(!file||!selection||busy)return;
    const token=++operation;feedback('Загружаем фото…');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024){feedback('Выберите JPEG, PNG или WebP размером до 15 МБ.',true);return;}
    let url;
    try{
      url=URL.createObjectURL(file);
      const source=await imageFrom(url);
      if(source.naturalWidth<100||source.naturalHeight<100||source.naturalWidth*source.naturalHeight>60000000)throw Error('image_size');
      const scale=Math.min(1,1800/source.naturalWidth,1800/source.naturalHeight),buffer=document.createElement('canvas');
      buffer.width=Math.round(source.naturalWidth*scale);buffer.height=Math.round(source.naturalHeight*scale);
      const bctx=buffer.getContext('2d',{alpha:false});bctx.fillStyle='#fff';bctx.fillRect(0,0,buffer.width,buffer.height);bctx.drawImage(source,0,0,buffer.width,buffer.height);
      const loadedCrop=await imageFrom(selection.image);
      if(token!==operation)return;
      room=buffer;crop=loadedCrop;canvas.width=buffer.width;canvas.height=buffer.height;view={zoom:1,panX:0,panY:0};
      wallQuad=core.rectangle({x:canvas.width*.1,y:canvas.height*.12,width:canvas.width*.8,height:canvas.height*.7});
      placing=false;layer='wall';selected=true;rebuildPlacement(100);showStep('setup');feedback('');setLayer('wall');
    }catch(_){if(token===operation)feedback('Не удалось прочитать фото. Выберите изображение от 100 × 100 пикселей, до 60 мегапикселей.',true);}
    finally{if(url)URL.revokeObjectURL(url);$('tryonRoomFile').value='';}
  }
  $('tryonRoomFile').addEventListener('change',()=>{void loadRoom($('tryonRoomFile').files?.[0]);});
  $('tryonUploadZone').addEventListener('click',()=>{$('tryonRoomFile').click();});
  let dragDepth=0;
  const dropZone=$('tryonUploadZone');
  dropZone.addEventListener('dragenter',event=>{event.preventDefault();if(dropZone.disabled)return;dragDepth++;dropZone.classList.add('is-dragging');});
  dropZone.addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=dropZone.disabled?'none':'copy';});
  dropZone.addEventListener('dragleave',event=>{event.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)dropZone.classList.remove('is-dragging');});
  dropZone.addEventListener('drop',event=>{
    event.preventDefault();dragDepth=0;dropZone.classList.remove('is-dragging');if(dropZone.disabled)return;
    const files=event.dataTransfer?.files;
    if(files?.length!==1){feedback('Перетащите одно фото комнаты.',true);return;}
    void loadRoom(files[0]);
  });
  // Dropping outside the upload area must not navigate away from the editor.
  for(const type of ['dragover','drop'])$('tryonModal').addEventListener(type,event=>{if(event.dataTransfer&&Array.from(event.dataTransfer.types).includes('Files'))event.preventDefault();});
  $('tryonPreset').addEventListener('change',()=>{
    const preset=core.presets[$('tryonPreset').value];
    if(preset){$('tryonWallWidth').value=preset.width;$('tryonWallHeight').value=preset.height;}
    rebuildPlacement();changed();
  });
  for(const id of ['tryonWallWidth','tryonWallHeight'])$(id).addEventListener('input',()=>{$('tryonPreset').value='custom';rebuildPlacement();changed();});
  $('tryonLayerWall').addEventListener('click',()=>{if(!busy)setLayer('wall');});
  $('tryonLayerFresco').addEventListener('click',()=>{if(!busy)setLayer('fresco');});
  $('tryonBegin').addEventListener('click',()=>{if(!validWall()||!room||!crop||!wallQuad)return;rebuildPlacement(100);placing=true;showStep('placement');setLayer('fresco');changed();canvas.focus();});
  $('tryonScale').addEventListener('input',()=>{if(!room||!quad||!validWall())return;rebuildPlacement(Number($('tryonScale').value));changed();});
  $('tryonZoomIn').addEventListener('click',()=>{if(!busy)zoomAt(1.25);});
  $('tryonZoomOut').addEventListener('click',()=>{if(!busy)zoomAt(.8);});
  $('tryonFitPhoto').addEventListener('click',()=>{if(!busy)fitPhoto();});
  $('tryonFitWall').addEventListener('click',()=>{if(!busy)fitWall();});
  stage.addEventListener('wheel',event=>{
    if(!room||busy||!event.ctrlKey)return;
    event.preventDefault();
    const bounds=stageBounds();
    zoomAt(Math.exp(-event.deltaY*.002),{x:event.clientX-bounds.left,y:event.clientY-bounds.top});
  },{passive:false});
  $('tryonCopySku').addEventListener('click',async()=>{
    if(!selection)return;
    try{await navigator.clipboard.writeText(selection.sku);$('tryonCopyFeedback').textContent='Скопировано';}
    catch(_){$('tryonCopyFeedback').textContent='Не удалось скопировать артикул';}
  });
  function point(event){
    const {bounds,scale,x,y}=scene();
    return {x:(event.clientX-bounds.left-x)/scale,y:(event.clientY-bounds.top-y)/scale};
  }
  function pointerCenter(){
    const bounds=stageBounds(),values=[...pointers.values()],a=values[0],b=values[1];
    return {x:(a.x+b.x)/2-bounds.left,y:(a.y+b.y)/2-bounds.top,distance:Math.hypot(a.x-b.x,a.y-b.y)||1};
  }
  stage.addEventListener('pointerdown',event=>{
    if(busy||!room||!wallQuad||!validWall())return;
    if(event.pointerType==='touch'){
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size===2){
        const center=pointerCenter();
        pinch={view:{...view},center,distance:center.distance};
        drag=null;stage.setPointerCapture(event.pointerId);event.preventDefault();return;
      }
      if(pointers.size>2)return;
    }
    const p=point(event);
    if(lightMode){
      if(p.x<0||p.y<0||p.x>canvas.width||p.y>canvas.height)return;
      event.preventDefault();canvas.focus();
      drag={id:event.pointerId,kind:'light',start:p,previous:lighting};
      lighting=core.makeLight(p,p,$('tryonLightTone').value,canvas.width,canvas.height);
      stage.setPointerCapture(event.pointerId);paint();return;
    }
    const activeQuad=layer==='wall'?wallQuad:quad;
    if(!activeQuad)return;
    const radius=24/scene().scale;
    const index=selected?activeQuad.findIndex(c=>Math.hypot(c.x-p.x,c.y-p.y)<=radius):-1;
    if(index<0&&!core.inside(activeQuad,p)){
      selected=false;drag={id:event.pointerId,kind:'pan',x:event.clientX,y:event.clientY,panX:view.panX,panY:view.panY};
      stage.classList.add('is-panning');
    }else{
      selected=true;$('tryonHandle').value=index<0?'layer':String(index);
      drag={...p,id:event.pointerId,index,kind:'geometry'};
    }
    event.preventDefault();canvas.focus();stage.setPointerCapture(event.pointerId);paint();
  });
  let framePending=false;
  stage.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch'&&pointers.has(event.pointerId)){
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pinch&&pointers.size>=2){
        const current=pointerCenter(),bounds=stageBounds();
        const zoomed=core.zoomViewAt(pinch.view,current.distance/pinch.distance,pinch.center,bounds.width,bounds.height);
        updateView({...zoomed,panX:zoomed.panX+current.x-pinch.center.x,panY:zoomed.panY+current.y-pinch.center.y});
        event.preventDefault();return;
      }
    }
    if(!drag||event.pointerId!==drag.id||busy)return;
    if(drag.kind==='pan'){
      updateView({...view,panX:drag.panX+event.clientX-drag.x,panY:drag.panY+event.clientY-drag.y});
      return;
    }
    const p=point(event);
    if(drag.kind==='light')lighting=core.makeLight(drag.start,p,$('tryonLightTone').value,canvas.width,canvas.height);
    else{
      if(layer==='wall')wallQuad=drag.index>=0
        ?core.freeCorner(wallQuad,drag.index,p,canvas.width,canvas.height)
        :core.freeTranslate(wallQuad,p.x-drag.x,p.y-drag.y,canvas.width,canvas.height);
      else{
        const current=core.unproject(wallQuad,p),previous=core.unproject(wallQuad,drag);
        if(current&&previous){
          placed=drag.index>=0?core.resizePlacement(placed,drag.index,{x:current.x*lastWall.width,y:current.y*lastWall.height},selection,lastWall):core.movePlacement(placed,(current.x-previous.x)*lastWall.width,(current.y-previous.y)*lastWall.height,lastWall);
          quad=core.placementQuad(wallQuad,lastWall,placed);
          $('tryonScale').value=placed.width/selection.width_cm*100;
          $('tryonScaleValue').textContent=cm(placed.width)+' × '+cm(placed.height)+' · '+Number($('tryonScale').value).toFixed(1).replace(/\.0$/,'')+'%';
        }
      }
      drag={...drag,...p};
    }
    revision++;saved=null;
    if(!framePending){framePending=true;requestAnimationFrame(()=>{framePending=false;feedback('');paint();});}
  });
  function stopDrag(event){
    if(event?.pointerType==='touch'){
      pointers.delete(event.pointerId);
      if(pointers.size<2)pinch=null;
    }
    if(drag?.id!==event?.pointerId)return;
    if(drag.kind==='light'&&(event.type==='pointercancel'||!lighting||lighting.strength<.015))lighting=drag.previous;
    const index=drag.kind==='geometry'?drag.index:-1;
    drag=null;stage.classList.remove('is-panning');
    if(index>=0)keepCornerVisible(index);
    paint();
  }
  stage.addEventListener('pointerup',stopDrag);
  stage.addEventListener('pointercancel',stopDrag);
  stage.addEventListener('lostpointercapture',stopDrag);
  canvas.addEventListener('keydown',event=>{
    if(busy||!selected||lightMode||!wallQuad||!validWall())return;
    if(['0','1','2','3','4'].includes(event.key)){event.preventDefault();$('tryonHandle').value=event.key==='0'?'layer':String(Number(event.key)-1);return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const n=event.shiftKey?10:1,dx=event.key==='ArrowLeft'?-n:event.key==='ArrowRight'?n:0,dy=event.key==='ArrowUp'?-n:event.key==='ArrowDown'?n:0,index=$('tryonHandle').value;
    if(layer==='wall')wallQuad=index==='layer'?core.freeTranslate(wallQuad,dx*3,dy*3,canvas.width,canvas.height):core.freeCorner(wallQuad,Number(index),{x:wallQuad[Number(index)].x+dx*3,y:wallQuad[Number(index)].y+dy*3},canvas.width,canvas.height);
    else placed=core.movePlacement(placed,dx,dy,lastWall);
    changed();
  });
  $('tryonResetPerspective').addEventListener('click',()=>{
    if(busy||!crop)return;selected=true;lightMode=false;
    if(layer==='wall')wallQuad=core.rectangle({x:canvas.width*.1,y:canvas.height*.12,width:canvas.width*.8,height:canvas.height*.7});
    else {placed=null;rebuildPlacement(100);}
    changed();
  });
  $('tryonApply').addEventListener('click',()=>{if(busy)return;selected=false;lightMode=false;drag=null;paint();});
  $('tryonLightToggle').addEventListener('click',()=>{if(busy||!placing)return;const enable=!lightMode;if(enable&&layer!=='fresco')setLayer('fresco');lightMode=enable;if(lightMode)selected=false;drag=null;paint();});
  $('tryonLightTone').addEventListener('change',()=>{if(lighting){lighting={...lighting,tone:$('tryonLightTone').value==='cold'?'cold':'warm'};changed();}else syncLightTools();});
  $('tryonLightCancel').addEventListener('click',()=>{if(busy)return;lighting=null;lightMode=false;drag=null;changed();});
  $('tryonChangeRoom').addEventListener('click',()=>{if(busy)return;operation++;resetRoom();});
  $('tryonBack').addEventListener('click',()=>window.dispatchEvent(new CustomEvent('affresco:open-modal',{detail:'editor'})));
  function jpeg(){
    const output=document.createElement('canvas');output.width=canvas.width;output.height=canvas.height;
    core.draw(output.getContext('2d',{alpha:false}),room,crop,quad,checkFit(),false,lighting);
    let image;
    for(const quality of [.88,.78,.68,.58]){image=output.toDataURL('image/jpeg',quality);if(image.length<2900000)break;}
    if(image.length>=2900000)throw Error('image_export');
    return image;
  }
  function lock(value){busy=value;for(const id of ['tryonZoomIn','tryonZoomOut','tryonFitPhoto','tryonFitWall','tryonSave','tryonDownload','tryonEmail','tryonChangeRoom','tryonPreset','tryonWallWidth','tryonWallHeight','tryonScale','tryonBack','tryonHandle','tryonResetPerspective','tryonApply','tryonLightToggle','tryonLightTone','tryonLightCancel','tryonLayerWall','tryonLayerFresco'])$(id).disabled=value;syncLightTools();}
  async function save(){
    if(busy||!placing||!validWall())return null;
    await window.affrescoAccount?.ready;
    const owner=keyOwner(),identity=window.affrescoAccount?.identity(),sceneRevision=revision;
    if(saved&&savedRevision===revision&&saved.owner===owner&&saved.tracked)return saved;
    const token=operation;drag=null;lock(true);feedback('Сохраняем примерку…');
    try{
      let record=saved&&savedRevision===revision&&saved.owner===owner?saved:{id:crypto.randomUUID(),owner,created:Date.now(),image:jpeg(),sku:selection.sku,width_cm:placed.width,height_cm:placed.height,source_width_cm:selection.width_cm,source_height_cm:selection.height_cm,wall_width_cm:lastWall.width,wall_height_cm:lastWall.height,placement_cm:{...placed},wall_quad:wallQuad.map(p=>({x:p.x/canvas.width,y:p.y/canvas.height})),kind:'tryon',tracked:false};
      // Store a recoverable local JPEG before recording the completed result.
      await store(record);
      if(sceneRevision===revision){saved=record;savedRevision=sceneRevision;}
      if(token!==operation)throw Error('identity_changed');
      if(identity!==window.affrescoAccount?.identity())throw Error('identity_changed');
      const response=await fetch('/api/manual-tryon.php',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Affresco-Request':'1'},body:JSON.stringify({id:record.id,sku:record.sku,width_cm:record.width_cm,height_cm:record.height_cm,owner})});
      const data=await response.json();if(!response.ok||data.accepted!==true)throw Error(data.error||'tracking_unavailable');
      record={...record,tracked:true};
      try{await store(record);}catch(_){} // JPEG is already stored; retry uses the same event ID.
      if(sceneRevision===revision){saved=record;savedRevision=sceneRevision;}
      if(identity!==window.affrescoAccount?.identity())throw Error('identity_changed');
      await window.affrescoAccount?.refreshProfile().catch(()=>{});
      feedback('Примерка сохранена. Она доступна в личном кабинете на этом устройстве.');
      void renderHistory();return record;
    }catch(error){feedback(error.message==='identity_changed'?'Аккаунт изменился. Сохраните примерку повторно.':error.message==='local_storage'?'Не удалось сохранить изображение на устройстве. Проверьте свободное место и разрешения браузера.':'Не удалось сохранить примерку. Проверьте соединение и повторите попытку.',true);return null;}
    finally{lock(false);paint();}
  }
  function download(record){
    const encoded=record.image.split(',')[1],binary=atob(encoded),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'})),link=document.createElement('a');
    link.href=url;link.download='affresco-room-'+record.sku+'.jpg';link.hidden=true;document.body.append(link);link.click();
    setTimeout(()=>{link.remove();URL.revokeObjectURL(url);},60000);
  }
  function email(record){window.dispatchEvent(new CustomEvent('affresco:email-tryon',{detail:record}));}
  $('tryonSave').addEventListener('click',()=>{void save();});
  $('tryonDownload').addEventListener('click',async()=>{const record=await save();if(record)download(record);});
  $('tryonEmail').addEventListener('click',async()=>{const record=await save();if(record)email(record);});
  $('tryonSavedDownload').addEventListener('click',()=>{if(saved&&saved.owner===keyOwner())download(saved);});
  $('tryonSavedEmail').addEventListener('click',()=>{if(saved&&saved.owner===keyOwner())email(saved);});
  async function renderHistory(){
    const target=$('accountTryonList');if(!target)return;
    if(!$('accountPanelGenerations')||$('accountPanelGenerations').hidden)return;
    const owner=keyOwner(),request=++historyRequest;
    try{
      $('accountTryonStorageNote').textContent=storageNote(owner);$('accountTryonStorageNote').hidden=!$('accountTryonStorageNote').textContent;
      const list=await prune(owner);if(owner!==keyOwner()||request!==historyRequest)return;
      target.replaceChildren();
      if(!list.length){target.textContent='Пока нет сохранённых примерок.';return;}
      for(const record of list){
        const button=document.createElement('button');button.type='button';button.className='account-sku-link';
        button.textContent='Арт. '+record.sku+' · '+new Date(record.created).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
        button.addEventListener('click',()=>{
          if(record.owner!==keyOwner())return;operation++;selection={...record};saved=record;savedRevision=-1;placing=false;
          $('tryonSavedImage').src=record.image;$('tryonSavedMeta').textContent='Сохранено '+new Date(record.created).toLocaleString('ru-RU');
          $('tryonBack').hidden=true;showStep('saved');summary();feedback('');open();
        });target.append(button);
      }
    }catch(_){if(owner===keyOwner()&&request===historyRequest)target.textContent='История примерок на этом устройстве недоступна.';}
  }
  window.addEventListener('affresco:auth-changed',()=>{operation++;saved=null;$('tryonStorageNote').textContent=storageNote();$('tryonStorageNote').hidden=!$('tryonStorageNote').textContent;void renderHistory();});
  window.affrescoTryon={start,renderHistory};
  void window.affrescoAccount?.ready.then(()=>renderHistory());
})();



