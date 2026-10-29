/* Browser-only session media library. No room or personal fresco uploads to the server. */
(()=>{
  'use strict';
  const KEY='affresco:tryon-session:v1';
  let session;
  try{session=sessionStorage.getItem(KEY);if(!session){session=crypto.randomUUID();sessionStorage.setItem(KEY,session);}}
  catch(_){session=crypto.randomUUID();}
  function db(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('affresco-tryon-session-media',1);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('media'))db.createObjectStore('media',{keyPath:'key'});};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||Error('storage'));
    });
  }
  async function all(kind){
    const database=await db();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction('media');
      const req=tx.objectStore('media').getAll();
      req.onsuccess=()=>resolve((req.result||[]).filter(x=>x.session===session&&x.kind===kind).sort((a,b)=>a.created-b.created));
      req.onerror=()=>reject(req.error);
      tx.oncomplete=()=>database.close();
      tx.onerror=()=>database.close();
    });
  }
  async function put(kind,blob,details={}){
    const list=await all(kind),limit=kind==='room'?3:12;
    if(list.length>=limit)throw Error('session_limit');
    const data={...details,session,kind,id:crypto.randomUUID(),created:Date.now(),blob};
    data.key=session+':'+kind+':'+data.id;
    const database=await db();
    await new Promise((resolve,reject)=>{
      const tx=database.transaction('media','readwrite');tx.objectStore('media').put(data);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });database.close();
    return data;
  }
  async function remove(kind,id){
    const database=await db();
    await new Promise((resolve,reject)=>{
      const tx=database.transaction('media','readwrite');tx.objectStore('media').delete(session+':'+kind+':'+id);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });database.close();
  }
  async function get(kind,id){return (await all(kind)).find(x=>x.id===id)||null;}
  window.affrescoMediaLibrary={all,put,remove,get,session};
})();
