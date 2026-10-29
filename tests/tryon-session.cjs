const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/assets/js/tryon-library.js'),'utf8');
let member=false,requests=[],next=0;
let lists={room:[],fresco:[]};
class FormData{constructor(){this.fields=new Map();}append(key,value){this.fields.set(key,value);}}
function fetch(url,opts={}){
 const kind=new URL(url,'https://example.invalid').searchParams.get('kind');
 requests.push({url,opts});
 if(!opts.method)return Promise.resolve({ok:true,json:async()=>({items:lists[kind],limit:member?3:1})});
 const action=opts.body.fields.get('action');
 if(action==='upload'){
   if(lists[kind].length >= (member?3:1) && member)return Promise.resolve({ok:false,json:async()=>({error:'media_limit_or_storage_unavailable'})});
   if(lists[kind].length>=1&&!member)lists[kind]=[];
   const item={id:++next+'',kind,name:opts.body.fields.get('name'),sku:'own-'+next,
     width_cm:Number(opts.body.fields.get('width_cm')),height_cm:Number(opts.body.fields.get('height_cm')),
     url:'/api/media.php?kind='+kind+'&id='+next};
   lists[kind].push(item);
   return Promise.resolve({ok:true,json:async()=>({item})});
 }
 if(action==='delete'){lists[kind]=lists[kind].filter(x=>x.id!==opts.body.fields.get('id'));
   return Promise.resolve({ok:true,json:async()=>({deleted:true})});}
 throw Error('unknown action');
}
const window={affrescoAccount:{signedIn:()=>member}};
vm.runInNewContext(source,{window,fetch,FormData});
(async()=>{
 const media=window.affrescoMediaLibrary;
 const blob={type:'image/jpeg',size:1000};
 assert.equal(media.limit(),1,'Guest one upload per kind');
 await media.put('room',blob,{name:'A'});
 await media.put('room',blob,{name:'B'});
 assert.equal((await media.all('room')).length,1,'Guest replacement at server, no empty slot');
 assert.equal((await media.all('room'))[0].name,'B');
 await media.put('fresco',blob,{name:'Mine',width_cm:200,height_cm:100});
 assert.equal((await media.all('fresco')).length,1);
 assert.equal((await media.get('fresco',String(next))).name,'Mine');
 member=true;lists={room:[],fresco:[]};
 assert.equal(media.limit(),3,'Account three photos per kind');
 for(let i=0;i<3;i++)await media.put('room',blob,{name:'Room '+i});
 assert.equal((await media.all('room')).length,3);
 await assert.rejects(()=>media.put('room',blob,{name:'Fourth'}),/media_limit_or_storage_unavailable/);
 await media.remove('room',lists.room[0].id);
 await media.put('room',blob,{name:'Third replacement'});
 assert.equal((await media.all('room')).length,3);
 for(let i=0;i<3;i++)await media.put('fresco',blob,{name:'Fresco '+i,width_cm:300,height_cm:200});
 await assert.rejects(()=>media.put('fresco',blob,{name:'Fourth'}),/media_limit_or_storage_unavailable/);
 assert.ok(requests.filter(r=>r.opts.method==='POST').every(r=>r.opts.headers['X-Affresco-Request']==='1'));
 assert.ok(requests.every(r=>r.opts.credentials==='same-origin'));
 console.log('PASS: server-backed media adapter guest 1 replacement/account 3, metadata, deletion, private cookies');
})().catch(error=>{console.error(error);process.exitCode=1;});
