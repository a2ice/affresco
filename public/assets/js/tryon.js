/* Manual room try-on. Room photos stay in the browser until explicit email sending. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),core=window.affrescoTryonCore;
  const canvas=$('tryonCanvas'),ctx=canvas.getContext('2d',{alpha:false});
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
    // Keep twelve recent JPEGs per owner on this device; counters have no such limit.
    const list=await records(record.owner);
    if(list.length>12){
      const clean=await database();await new Promise((resolve,reject)=>{
        const tx=clean.transaction('images','readwrite');for(const item of list.slice(12))tx.objectStore('images').delete(item.id);
        tx.oncomplete=()=>{clean.close();resolve();};tx.onerror=tx.onabort=()=>{clean.close();reject(Error('local_storage'));};
      });
    }
  }
  function wall(){return {width:core.wallValue($('tryonWallWidth').value),height:core.wallValue($('tryonWallHeight').value)};}
  function validWall(){const w=wall();return !Number.isNaN(w.width)&&!Number.isNaN(w.height);}
  function checkFit(){
    const w=wall(),invalid=!validWall(),fits=selection&&core.fits(selection,w);
    $('tryonFit').textContent=invalid?'Укажите размеры стены от 30 до 5000 см или оставьте поля пустыми.'
      :w.width==null&&w.height==null?'Размеры не заданы — проверка размещения отключена.'
      :fits?'Выбранный кадр помещается в указанные размеры стены.'
      :'Фреска больше стены. Уточните размеры стены или уменьшите кадр в редакторе.';
    $('tryonFit').classList.toggle('is-warning',invalid||!fits);
    for(const id of ['tryonBegin','tryonSave','tryonDownload','tryonEmail'])$(id).disabled=busy||invalid;
    return !invalid&&!fits;
  }
  function paint(){
    if(!room)return;
    const warning=checkFit();
    core.draw(ctx,room,placing?crop:null,placing?quad:null,warning,placing);
  }
  function changed(){revision++;saved=null;feedback('');paint();}
  function summary(){if(selection)$('tryonSummary').textContent='Арт. '+selection.sku+' · Фреска '+selection.width_cm+' × '+selection.height_cm+' см';}
  function showStep(which){
    $('tryonUploadStep').hidden=which!=='upload';$('tryonWorkspace').hidden=!['setup','placement'].includes(which);$('tryonSavedStep').hidden=which!=='saved';
    $('tryonSetupActions').hidden=which!=='setup';$('tryonPlacementActions').hidden=which!=='placement';
  }
  function resetRoom(){room=null;quad=null;placing=false;drag=null;saved=null;revision++;savedRevision=-1;$('tryonRoomFile').value='';showStep('upload');feedback('');}
  function start(value){
    operation++;selection={...value};crop=null;resetRoom();summary();
    $('tryonPreset').value='';$('tryonWallWidth').value='';$('tryonWallHeight').value='';$('tryonBack').hidden=false;
    $('tryonScaleValue').textContent='50%';$('tryonHandle').value='layer';
    open();
  }
  $('tryonRoomFile').addEventListener('change',async()=>{
    const file=$('tryonRoomFile').files?.[0];if(!file||!selection)return;
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
      room=buffer;crop=loadedCrop;canvas.width=buffer.width;canvas.height=buffer.height;
      quad=core.rectangle(core.frame(canvas.width,canvas.height,crop.naturalWidth/crop.naturalHeight,50));
      placing=false;$('tryonScale').value=50;showStep('setup');feedback('');paint();
    }catch(_){if(token===operation)feedback('Не удалось прочитать фото. Выберите изображение от 100 × 100 пикселей, до 60 мегапикселей.',true);}
    finally{if(url)URL.revokeObjectURL(url);}
  });
  $('tryonPreset').addEventListener('change',()=>{
    const preset=core.presets[$('tryonPreset').value];
    $('tryonWallWidth').value=preset?.width??'';$('tryonWallHeight').value=preset?.height??'';changed();
  });
  for(const id of ['tryonWallWidth','tryonWallHeight'])$(id).addEventListener('input',()=>{$('tryonPreset').value='';changed();});
  $('tryonBegin').addEventListener('click',()=>{if(!validWall()||!room||!crop)return;placing=true;showStep('placement');changed();canvas.focus();});
  $('tryonScale').addEventListener('input',()=>{
    if(!room||!quad)return;
    quad=core.resize(quad,Number($('tryonScale').value),canvas.width,canvas.height);
    $('tryonScaleValue').textContent=$('tryonScale').value+'%';changed();
  });
  function point(event){
    const bounds=canvas.getBoundingClientRect(),scale=Math.min(bounds.width/canvas.width,bounds.height/canvas.height);
    return {x:(event.clientX-bounds.left-(bounds.width-canvas.width*scale)/2)/scale,y:(event.clientY-bounds.top-(bounds.height-canvas.height*scale)/2)/scale};
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!placing||busy||!quad)return;const p=point(event);
    const bounds=canvas.getBoundingClientRect(),scale=Math.min(bounds.width/canvas.width,bounds.height/canvas.height),radius=22/scale;
    const index=quad.findIndex(c=>Math.hypot(c.x-p.x,c.y-p.y)<=radius);
    if(index<0&&!core.inside(quad,p))return;
    event.preventDefault();canvas.focus();$('tryonHandle').value=index<0?'layer':String(index);drag={...p,id:event.pointerId,index};canvas.setPointerCapture(event.pointerId);
  });
  let framePending=false;
  canvas.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id||busy)return;
    const p=point(event);
    quad=drag.index>=0?core.corner(quad,drag.index,p,canvas.width,canvas.height):core.translate(quad,p.x-drag.x,p.y-drag.y,canvas.width,canvas.height);
    drag={...p,id:drag.id,index:drag.index};revision++;saved=null;
    if(!framePending){framePending=true;requestAnimationFrame(()=>{framePending=false;feedback('');paint();});}
  });
  function stopDrag(){drag=null;}
  canvas.addEventListener('pointerup',stopDrag);canvas.addEventListener('pointercancel',stopDrag);canvas.addEventListener('lostpointercapture',stopDrag);
  canvas.addEventListener('keydown',event=>{
    if(!placing||busy||!quad||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const n=event.shiftKey?20:5;
    const dx=event.key==='ArrowLeft'?-n:event.key==='ArrowRight'?n:0,dy=event.key==='ArrowUp'?-n:event.key==='ArrowDown'?n:0;
    const index=$('tryonHandle').value;
    quad=index==='layer'?core.translate(quad,dx,dy,canvas.width,canvas.height):core.corner(quad,Number(index),{x:quad[Number(index)].x+dx,y:quad[Number(index)].y+dy},canvas.width,canvas.height);changed();
  });
  $('tryonResetPerspective').addEventListener('click',()=>{if(busy||!crop)return;quad=core.rectangle(core.frame(canvas.width,canvas.height,crop.naturalWidth/crop.naturalHeight,Number($('tryonScale').value)));changed();});
  $('tryonChangeRoom').addEventListener('click',()=>{if(busy)return;operation++;resetRoom();});
  $('tryonBack').addEventListener('click',()=>window.dispatchEvent(new CustomEvent('affresco:open-modal',{detail:'editor'})));
  function jpeg(){
    const output=document.createElement('canvas');output.width=canvas.width;output.height=canvas.height;
    core.draw(output.getContext('2d',{alpha:false}),room,crop,quad,checkFit(),false);
    let image;
    for(const quality of [.88,.78,.68,.58]){image=output.toDataURL('image/jpeg',quality);if(image.length<2900000)break;}
    if(image.length>=2900000)throw Error('image_export');
    return image;
  }
  function lock(value){busy=value;for(const id of ['tryonSave','tryonDownload','tryonEmail','tryonChangeRoom','tryonPreset','tryonWallWidth','tryonWallHeight','tryonScale','tryonBack','tryonHandle','tryonResetPerspective'])$(id).disabled=value;}
  async function save(){
    if(busy||!placing||!validWall())return null;
    await window.affrescoAccount?.ready;
    const owner=keyOwner(),identity=window.affrescoAccount?.identity(),sceneRevision=revision;
    if(saved&&savedRevision===revision&&saved.owner===owner&&saved.tracked)return saved;
    const token=operation;drag=null;lock(true);feedback('Сохраняем примерку…');
    try{
      let record=saved&&savedRevision===revision&&saved.owner===owner?saved:{id:crypto.randomUUID(),owner,created:Date.now(),image:jpeg(),sku:selection.sku,width_cm:selection.width_cm,height_cm:selection.height_cm,kind:'tryon',tracked:false};
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
      const list=await records(owner);if(owner!==keyOwner()||request!==historyRequest)return;
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
  window.addEventListener('affresco:auth-changed',()=>{operation++;saved=null;void renderHistory();});
  window.affrescoTryon={start,renderHistory};
  void window.affrescoAccount?.ready.then(()=>renderHistory());
})();
