const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/assets/js/tryon-library.js'),'utf8');
const values=new Map(),session=new Map();
const sessionStorage={
 getItem:key=>session.get(key)||null,
 setItem:(key,value)=>session.set(key,String(value)),
 clear:()=>session.clear()
};
let made=false;
const database={
 objectStoreNames:{contains:()=>made},createObjectStore:()=>{made=true;},
 close(){},
 transaction:()=>{
  const tx={};tx.objectStore=()=>({
   put:item=>{values.set(item.key,item);setImmediate(()=>tx.oncomplete?.());},
   delete:key=>{values.delete(key);setImmediate(()=>tx.oncomplete?.());},
   getAll:()=>{const req={};setImmediate(()=>{req.result=[...values.values()];req.onsuccess?.();tx.oncomplete?.();});return req;}
  });return tx;
 }
};
const indexedDB={open:()=>{const req={result:database};setImmediate(()=>{if(!made)req.onupgradeneeded?.();req.onsuccess?.();});return req;}};
function boot(){
 const window={};vm.runInNewContext(source,{window,indexedDB,sessionStorage,crypto:{randomUUID}});
 return window.affrescoMediaLibrary;
}
(async()=>{
 const media=boot();
 assert.equal((await media.all('room')).length,0);
 const blob={type:'image/jpeg',size:1000};
 for(let i=0;i<3;i++)await media.put('room',blob,{name:'room-'+i});
 assert.equal((await media.all('room')).length,3,'Three room images available without sign-in');
 await assert.rejects(()=>media.put('room',blob),/session_limit/,'Fourth room image rejected');
 const first=(await media.all('room'))[0];
 assert.equal((await media.get('room',first.id)).name,'room-0');
 const afterReload=boot();
 assert.equal((await afterReload.all('room')).length,3,'Page reload in same session keeps three rooms');
 await afterReload.remove('room',first.id);
 assert.equal((await afterReload.all('room')).length,2);
 await afterReload.put('room',blob,{name:'replacement'});
 assert.equal((await afterReload.all('room')).length,3,'Deleted slot reusable');
 for(let i=0;i<12;i++)await media.put('fresco',blob,{sku:'own-'+i,width_cm:100,height_cm:80});
 assert.equal((await media.all('fresco')).length,12);
 await assert.rejects(()=>media.put('fresco',blob),/session_limit/);
 sessionStorage.clear();
 const unrelated=boot();
 assert.equal((await unrelated.all('room')).length,0,'New independent session cannot see prior photos');
 assert.equal((await unrelated.all('fresco')).length,0,'New independent session cannot see prior custom murals');
 console.log('PASS: browser-session room and artwork library, 3-room limit, removal and session isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
