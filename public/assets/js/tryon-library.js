/* Private server-backed media. Session cookie for guests, account ID for members. */
(()=>{
  'use strict';
  const base='/api/media.php';
  const signedIn=()=>Boolean(window.affrescoAccount?.signedIn?.());
  const errorFrom=async res=>{const data=await res.json().catch(()=>({}));throw Error(data.error||'media_unavailable');};
  async function all(kind){
    const res=await fetch(base+'?kind='+encodeURIComponent(kind),{credentials:'same-origin',cache:'no-store'});
    if(!res.ok)return errorFrom(res);
    const body=await res.json();
    return body.items||[];
  }
  async function put(kind,blob,details={}){
    const form=new FormData();
    form.append('action','upload');form.append('kind',kind);
    form.append('image',blob,kind+'.jpg');
    form.append('name',details.name||'');
    if(details.replace_id)form.append('replace_id',String(details.replace_id));
    if(kind==='fresco'){
      form.append('width_cm',String(details.width_cm));
      form.append('height_cm',String(details.height_cm));
    }
    const res=await fetch(base+'?kind='+encodeURIComponent(kind),{
      method:'POST',headers:{'X-Affresco-Request':'1'},
      credentials:'same-origin',body:form
    });
    if(!res.ok)return errorFrom(res);
    return (await res.json()).item;
  }
  async function remove(kind,id){
    const form=new FormData();form.append('action','delete');form.append('kind',kind);form.append('id',id);
    const res=await fetch(base+'?kind='+encodeURIComponent(kind),{
      method:'POST',headers:{'X-Affresco-Request':'1'},credentials:'same-origin',body:form
    });
    if(!res.ok)return errorFrom(res);
    return res.json();
  }
  async function get(kind,id){return (await all(kind)).find(x=>x.id===id)||null;}
  function imageUrl(item){return item.url;}
  window.affrescoMediaLibrary={all,put,remove,get,imageUrl,limit:()=>signedIn()?3:1};
})();
