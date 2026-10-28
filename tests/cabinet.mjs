import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
class Element {
  constructor(id=''){this.id=id;this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.children=[];this.attrs={};this.handlers={};this.classList={toggle(){}};}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}
  async fire(k,event={}){for(const fn of this.handlers[k]||[])await fn({preventDefault(){},...event});}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(){this.children=[];this.textContent='';}
  focus(){document.activeElement=this;}
  reportValidity(){return true;}
}
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
const document={activeElement:null,getElementById:id=>elements.get(id)||null,querySelector:()=>new Element(),createElement:()=>new Element(),createDocumentFragment:()=>new Element()};
const storage=new Map([['afreska:crop:v1:6039',JSON.stringify({zoom:1,dx:0,dy:0,ratio:1,width:100,height:100})]]);
const localStorage={get length(){return storage.size;},key:i=>[...storage.keys()][i],getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
let authenticated=false,failLogin=false,failEmail=false,confirmDeletion=false;
const serverItems=[
 {type:'ai',id:'b'.repeat(32),created:Date.now(),image_url:'/api/ai-tryon.php?image='+'b'.repeat(32)},
 {type:'manual',id:'123e4567-e89b-42d3-a456-426614174001',created:Date.now(),image_url:'/api/ai-tryon.php?manual=123e4567-e89b-42d3-a456-426614174001'}
];
const member={id:'test',login:'tester',email:'test@example.com',login_count:4,updates_count:7,emails_count:2,generations_used:0,generations_limit:10};
const calls=[],events=[];
const context=vm.createContext({document,localStorage,Date,Map,CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail;}},window:{addEventListener(){},dispatchEvent:event=>events.push(event),confirm:()=>confirmDeletion,affrescoTryon:{removeSavedRecord:async()=>{}},location:{reload(){throw Error('Unexpected page reload');}}},fetch:async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
  if(url==='/api/auth.php'){
    if(body?.action==='login'){
      if(failLogin)return {ok:false,json:async()=>({error:'invalid_credentials'})};
      authenticated=true;
    }
    if(body?.action==='logout')authenticated=false;
    return {ok:true,json:async()=>authenticated?{authenticated:true,account:{...member}}:{authenticated:false,activity:{emails_count:1}}};
  }
  if(url==='/api/ai-tryon.php?library=1')return {ok:true,json:async()=>({items:authenticated?[...serverItems]:[]})};
  if(url==='/api/ai-tryon.php?delete=1'){
    const index=serverItems.findIndex(item=>item.id===body.id&&item.type===body.type);
    if(index<0)return {ok:false,json:async()=>({error:'not_found'})};
    serverItems.splice(index,1);return {ok:true,json:async()=>({deleted:true})};
  }
  if(url==='/api/account-email.php')return {ok:!failEmail,json:async()=>failEmail?{error:'invalid_email'}:{email:body.email}};
  if(url==='/api/account-state.php')return {ok:true,json:async()=>({scope:'account',items:['6247'],drafts:{6247:{}},account:{...member,updates_count:8}})};
  return {ok:true,json:async()=>({scope:'guest',items:['6039']})};
}});
vm.runInContext(fs.readFileSync(new URL('../public/assets/js/account.js',import.meta.url),'utf8'),context);
const api=context.window.affrescoAccount,$=id=>elements.get(id);
await api.ready;
assert.equal(api.signedIn(),false);
assert.equal($('accountGuestAccess').hidden,false);
assert.equal($('accountEdits').textContent,'1');
assert.equal($('accountFavorites').textContent,'1');
await $('accountTabFavorites').fire('click');
assert.equal($('accountPanelFavorites').hidden,false);
assert.equal($('accountPanelInfo').hidden,true);
await $('accountTabFavorites').fire('keydown',{key:'End'});
assert.equal($('accountTabGenerations').attrs['aria-selected'],'true');
assert.equal($('accountTabGenerations').tabIndex,0);
$('loginName').value='tester';$('loginPassword').value='fixture-password';
failLogin=true;await $('loginForm').fire('submit');
assert.equal(api.signedIn(),false);assert.match($('loginFeedback').textContent,/Неверный/);
failLogin=false;await $('loginForm').fire('submit');
assert.equal(api.signedIn(),true);assert.equal($('loginPassword').value,'');
assert.equal($('accountGuestAccess').hidden,true);assert.equal($('accountMemberAccess').hidden,false);
assert.equal($('accountPanelInfo').hidden,false);
assert.equal($('accountFavoriteList').children[0].children[0].textContent,'Фреска · Арт. 6247');
$('accountEmail').value='saved@example.com';await $('accountEmailForm').fire('submit');
assert.equal(api.savedEmail(),'saved@example.com');assert.match($('accountEmailFeedback').textContent,/сохранена/);
failEmail=true;$('accountEmail').value='invalid';await $('accountEmailForm').fire('submit');
assert.equal(api.savedEmail(),'saved@example.com');assert.match($('accountEmailFeedback').textContent,/Проверьте/);
await api.saveDraft('6247',{});assert.equal(api.current().updates_count,8);
assert.match(html,/class="account-tab-icon"/,'Cabinet uses matching pictogram icons');
await $('accountTabGenerations').fire('click');
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal($('accountServerImageList').children.length,2,'Both AI and manual images appear in cabinet');
const firstDelete=$('accountServerImageList').children[0].children[2];
assert.equal(firstDelete.textContent,'×','Deletion is a cross on account image thumbnail');
await firstDelete.fire('click');
assert.equal(serverItems.length,2,'Cancel confirmation preserves image');
confirmDeletion=true;
await firstDelete.fire('click');
assert.equal(serverItems.length,1,'Confirmation deletes only selected image');
assert.ok(events.some(event=>event.type==='affresco:ai-image-deleted'),'Gallery is informed of deletion');

await $('logoutButton').fire('click');
assert.equal(api.signedIn(),false);assert.equal($('accountEmail').value,'');
assert.equal($('accountMemberAccess').hidden,true);assert.equal($('accountFavorites').textContent,'1');
assert.equal($('accountEdits').textContent,'1');
assert.equal($('accountFavoriteList').children[0].children[0].textContent,'Фреска · Арт. 6039');
api.recordGuestSave();assert.equal(JSON.parse(storage.get('affresco:guest-saves:v1')).count,1);
assert.equal(events.filter(e=>e.type==='affresco:auth-changed').length,2);
assert.equal(calls.filter(c=>c.body?.action==='login').length,2);
console.log('PASS: guest/account isolation, tabs and keyboard, login error/success without reload, email save/error, draft stats, logout, guest activity');
