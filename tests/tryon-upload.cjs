const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const core=require('../public/assets/js/tryon-core.js');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/index.html'),'utf8');
const images=new Map();let member=null,accepted=0;
class Element{
 constructor(){this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.handlers={};this.classList={add(){},remove(){},toggle(){}};this.width=1000;this.height=700;this.style={};}
 addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}
 async fire(k,event={}){for(const fn of this.handlers[k]||[])await fn({type:k,preventDefault(){},...event});}
 setAttribute(k,v){this[k]=v;}
 getBoundingClientRect(){return {width:1000,height:700,left:0,top:0};}
 click(){this.clicks=(this.clicks||0)+1;}focus(){}append(){}replaceChildren(){}setPointerCapture(){}
 getContext(){return {canvas:this,createLinearGradient(){return {addColorStop(){}};},drawImage(){},fillRect(){},save(){},restore(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},clip(){},transform(){},fill(){},stroke(){},setLineDash(){},strokeRect(){}};}
 toDataURL(){return 'data:image/jpeg;base64,TEST';}
}
const els=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
const $=id=>els.get(id);$('accountPanelGenerations').hidden=true;
const document={getElementById:$,createElement:()=>new Element(),body:new Element()};
const db={close(){},transaction(){
 const tx={};tx.objectStore=()=>({put:r=>images.set(r.id,{...r}),delete:id=>images.delete(id),getAll:()=>({result:[...images.values()]})});
 setTimeout(()=>tx.oncomplete?.(),0);return tx;
}};
const indexedDB={open(){const req={result:db};setTimeout(()=>req.onsuccess?.(),0);return req;}};
class FakeImage{set src(v){this.naturalWidth=1000;this.naturalHeight=700;setTimeout(()=>this.onload(),0);}}
const window={affrescoTryonCore:core,affrescoTryonCompat:{supported:true},affrescoAccount:{ready:Promise.resolve(),current:()=>member,identity:()=>member?'account':'guest',refreshProfile:async()=>{}},dispatchEvent(){},addEventListener(){}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/assets/js/tryon.js'),'utf8'),{window,document,indexedDB,Image:FakeImage,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},crypto:{randomUUID},CustomEvent:class{},requestAnimationFrame:fn=>fn(),setTimeout,fetch:async()=>{accepted++;return {ok:true,json:async()=>({accepted:true})};}});
const delay=()=>new Promise(r=>setTimeout(r,30));
(async()=>{
 await window.affrescoTryon.start({image:'data:image/jpeg;base64,TEST',sku:'6039',width_cm:200,height_cm:200});
 assert.equal($('tryonUploadZone').disabled,false);assert.match($('tryonStorageNote').textContent,/3 последние/);
 await $('tryonUploadZone').fire('click');assert.equal($('tryonRoomFile').clicks,1);
 await $('tryonUploadZone').fire('drop',{dataTransfer:{files:[{},{}]}});assert.match($('tryonFeedback').textContent,/одно фото/);
 await $('tryonUploadZone').fire('drop',{dataTransfer:{files:[{type:'text/plain',size:20}]}});assert.match($('tryonFeedback').textContent,/Выберите JPEG/);
 await $('tryonUploadZone').fire('drop',{dataTransfer:{files:[{type:'image/png',size:1000}]}});await delay();
 assert.equal($('tryonWorkspace').hidden,false);
 assert.equal($('tryonPreset').value,'standard');assert.equal(Number($('tryonWallWidth').value),500);assert.equal(Number($('tryonWallHeight').value),275);
 assert.equal($('tryonLayerFresco').disabled,true);assert.equal($('tryonFooter').hidden,true,'Cannot place before wall confirmation');
 assert.match($('tryonControls').innerHTML,/500 см/);
 // Wall corners may leave the photo while remaining manipulable inside the padded viewport.
 await $('tryonStage').fire('pointerdown',{clientX:188,clientY:142,pointerId:8,pointerType:'mouse'});
 await $('tryonStage').fire('pointermove',{clientX:60,clientY:50,pointerId:8,pointerType:'mouse'});
 await $('tryonStage').fire('pointerup',{clientX:60,clientY:50,pointerId:8,pointerType:'mouse'});
 await $('tryonZoomIn').fire('click');assert.equal($('tryonZoomValue').textContent,'125%');
 await $('tryonFitWall').fire('click');assert.ok(Number($('tryonZoomValue').textContent.replace('%',''))>0);
 await $('tryonFitPhoto').fire('click');assert.equal($('tryonZoomValue').textContent,'100%');
 // Pan in workspace never moves the wall; two touches pinch the camera.
 const x0=parseFloat($('tryonCanvas').style.left);
 await $('tryonStage').fire('pointerdown',{clientX:10,clientY:10,pointerId:30,pointerType:'touch'});
 await $('tryonStage').fire('pointermove',{clientX:40,clientY:40,pointerId:30,pointerType:'touch'});
 assert.ok(parseFloat($('tryonCanvas').style.left)>x0,'Empty space pans the photo');
 await $('tryonStage').fire('pointerdown',{clientX:300,clientY:300,pointerId:31,pointerType:'touch'});
 await $('tryonStage').fire('pointermove',{clientX:370,clientY:370,pointerId:31,pointerType:'touch'});
 assert.notEqual($('tryonZoomValue').textContent,'100%','Pinch changes viewport zoom');
 await $('tryonStage').fire('pointerup',{pointerId:31,pointerType:'touch'});
 await $('tryonStage').fire('pointerup',{pointerId:30,pointerType:'touch'});
 await $('tryonFitPhoto').fire('click');assert.equal($('tryonZoomValue').textContent,'100%');

 
 await $('tryonBegin').fire('click');
 assert.equal($('tryonLayerFresco')['aria-pressed'],'true');
 await $('tryonLayerWall').fire('click');assert.equal($('tryonScale').disabled,true);
 await $('tryonLayerFresco').fire('click');assert.equal($('tryonScale').disabled,false);
 $('tryonWallWidth').value=150;await $('tryonWallWidth').fire('input');
 assert.equal($('tryonPreset').value,'custom');assert.ok(Number($('tryonScale').max)<=75);
 $('tryonPreset').value='standard';await $('tryonPreset').fire('change');await $('tryonResetPerspective').fire('click');

 assert.equal($('tryonFooter').hidden,false);assert.match($('tryonControls').innerHTML,/width="12" height="12"/);
 await $('tryonApply').fire('click');assert.equal($('tryonControls').innerHTML,'');
 await $('tryonStage').fire('pointerdown',{clientX:500,clientY:329,pointerId:1});await $('tryonStage').fire('pointerup',{pointerId:1});assert.match($('tryonControls').innerHTML,/<rect/);
 await $('tryonStage').fire('pointerdown',{clientX:10,clientY:10,pointerId:1});assert.equal($('tryonControls').innerHTML,'');
 await $('tryonLightToggle').fire('click');assert.equal($('tryonLightToggle')['aria-pressed'],'true');assert.equal($('tryonLightTone').hidden,false);
 await $('tryonStage').fire('pointerdown',{clientX:200,clientY:300,pointerId:1});await $('tryonStage').fire('pointermove',{clientX:700,clientY:300,pointerId:1});await $('tryonStage').fire('pointerup',{pointerId:1});
 assert.equal($('tryonLightCancel').disabled,false);assert.match($('tryonControls').innerHTML,/<path/);
 $('tryonLightTone').value='cold';await $('tryonLightTone').fire('change');
 await $('tryonLightToggle').fire('click');assert.equal($('tryonLightTone').hidden,true);assert.equal($('tryonLightCancel').disabled,false);
 await $('tryonLightCancel').fire('click');assert.equal($('tryonLightCancel').disabled,true);assert.equal($('tryonLightToggle')['aria-pressed'],'false');

 for(let i=0;i<4;i++){$('tryonScale').value=40+i;await $('tryonScale').fire('input');await $('tryonSave').fire('click');await delay();}
 assert.equal([...images.values()].filter(r=>r.owner==='guest').length,3);assert.equal(accepted,4);
 assert.ok([...images.values()].filter(r=>r.owner==='guest').every(r=>r.wall_quad[0].x<0),'Wall point outside photo persists in saved geometry');
 await $('tryonSave').fire('click');await delay();assert.equal(accepted,4,'Same result counted twice');
 await $('tryonZoomIn').fire('click');await $('tryonSave').fire('click');await delay();
 assert.equal(accepted,4,'Viewport-only change must not count a new generation');
 await $('tryonFitPhoto').fire('click');

 member={id:'tester'};
 for(let i=0;i<13;i++){$('tryonScale').value=50+i;await $('tryonScale').fire('input');await $('tryonSave').fire('click');await delay();}
 assert.equal([...images.values()].filter(r=>r.owner==='account:tester').length,12);
 assert.equal([...images.values()].filter(r=>r.owner==='guest').length,3);
 assert.equal(accepted,17);
 indexedDB.open=()=>{const req={};setTimeout(()=>req.onerror?.(),0);return req;};
 await window.affrescoTryon.start({image:'data:image/jpeg;base64,TEST',sku:'6039',width_cm:200,height_cm:200});
 assert.equal($('tryonUploadStep').hidden,true);assert.match($('tryonCompatibilityMessage').textContent,/не разрешает сохранять/);
 console.log('PASS: clickable upload, rejected multi-file/invalid drops, valid drop decoding, 3/12 retention, account isolation and idempotent save');
})().catch(error=>{console.error(error);process.exitCode=1;});


