/* Pure geometry shared by the preview and its tests. */
(function(root){
  'use strict';
  const presets={standard:{width:500,height:275},high:{width:500,height:350},hall:{width:800,height:400},compact:{width:300,height:250},wide:{width:650,height:300}};
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function wallValue(value){if(value===''||value==null)return null;const n=Number(value);return Number.isFinite(n)&&n>=30&&n<=5000?n:NaN;}
  function fits(crop,wall){return (wall.width==null||crop.width_cm<=wall.width)&&(wall.height==null||crop.height_cm<=wall.height);}
  function frame(width,height,aspect,percent,x=.5,y=.5){
    const w=Math.min(width*clamp(percent,5,100)/100,height*aspect),h=w/aspect;
    return {x:clamp(x*width-w/2,0,width-w),y:clamp(y*height-h/2,0,height-h),width:w,height:h};
  }
  function move(rect,dx,dy,width,height){return {...rect,x:clamp(rect.x+dx,0,width-rect.width),y:clamp(rect.y+dy,0,height-rect.height)};}
  const rectangle=rect=>[{x:rect.x,y:rect.y},{x:rect.x+rect.width,y:rect.y},{x:rect.x+rect.width,y:rect.y+rect.height},{x:rect.x,y:rect.y+rect.height}];
  function convex(quad){
    let area=0;
    for(let i=0;i<4;i++){
      const a=quad[i],b=quad[(i+1)%4],c=quad[(i+2)%4];
      if((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)<16)return false;
      if(Math.hypot(b.x-a.x,b.y-a.y)<24)return false;
      area+=a.x*b.y-b.x*a.y;
    }
    return area>800;
  }
  function corner(quad,index,point,width,height){
    const next=quad.map(p=>({...p}));next[index]={x:clamp(point.x,0,width),y:clamp(point.y,0,height)};
    return convex(next)?next:quad;
  }
  function translate(quad,dx,dy,width,height){
    dx=clamp(dx,-Math.min(...quad.map(p=>p.x)),width-Math.max(...quad.map(p=>p.x)));
    dy=clamp(dy,-Math.min(...quad.map(p=>p.y)),height-Math.max(...quad.map(p=>p.y)));
    return quad.map(p=>({x:p.x+dx,y:p.y+dy}));
  }
  function resize(quad,percent,width,height){
    const center={x:quad.reduce((n,p)=>n+p.x,0)/4,y:quad.reduce((n,p)=>n+p.y,0)/4};
    const spanX=Math.max(...quad.map(p=>p.x))-Math.min(...quad.map(p=>p.x)),spanY=Math.max(...quad.map(p=>p.y))-Math.min(...quad.map(p=>p.y));
    const scale=Math.min(width*clamp(percent,5,100)/100/spanX,height/spanY);
    const next=quad.map(p=>({x:center.x+(p.x-center.x)*scale,y:center.y+(p.y-center.y)*scale}));
    return translate(next,0,0,width,height);
  }
  function project(quad,u,v){
    const [a,b,c,d]=quad;
    const dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x;
    const dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y;
    const den=dx1*dy2-dx2*dy1;
    let g=0,h=0;
    if(Math.abs(dx3)+Math.abs(dy3)>1e-8&&Math.abs(den)>1e-8){g=(dx3*dy2-dx2*dy3)/den;h=(dx1*dy3-dx3*dy1)/den;}
    const divisor=g*u+h*v+1;
    return {x:((b.x-a.x+g*b.x)*u+(d.x-a.x+h*d.x)*v+a.x)/divisor,y:((b.y-a.y+g*b.y)*u+(d.y-a.y+h*d.y)*v+a.y)/divisor};
  }
  function triangle(ctx,image,src,dst){
    const [s0,s1,s2]=src,[d0,d1,d2]=dst;
    const det=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);
    if(Math.abs(det)<1e-8)return;
    const coeff=key=>[
      (d0[key]*(s1.y-s2.y)+d1[key]*(s2.y-s0.y)+d2[key]*(s0.y-s1.y))/det,
      (d0[key]*(s2.x-s1.x)+d1[key]*(s0.x-s2.x)+d2[key]*(s1.x-s0.x))/det,
      (d0[key]*(s1.x*s2.y-s2.x*s1.y)+d1[key]*(s2.x*s0.y-s0.x*s2.y)+d2[key]*(s0.x*s1.y-s1.x*s0.y))/det
    ];
    const x=coeff('x'),y=coeff('y');ctx.save();ctx.beginPath();
    // A small overlap avoids hairline gaps between antialiased triangles.
    const cx=(d0.x+d1.x+d2.x)/3,cy=(d0.y+d1.y+d2.y)/3;
    dst.forEach((p,i)=>{const length=Math.hypot(p.x-cx,p.y-cy)||1,px=p.x+(p.x-cx)/length*.45,py=p.y+(p.y-cy)/length*.45;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});
    ctx.closePath();ctx.clip();ctx.transform(x[0],y[0],x[1],y[1],x[2],y[2]);ctx.drawImage(image,0,0);ctx.restore();
  }
  function warp(ctx,image,quad,steps=16){
    const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
    ctx.save();ctx.beginPath();quad.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.clip();
    for(let row=0;row<steps;row++)for(let col=0;col<steps;col++){
      const uv=[[col/steps,row/steps],[(col+1)/steps,row/steps],[(col+1)/steps,(row+1)/steps],[col/steps,(row+1)/steps]];
      const src=uv.map(([u,v])=>({x:u*w,y:v*h})),dst=uv.map(([u,v])=>project(quad,u,v));
      triangle(ctx,image,[src[0],src[1],src[2]],[dst[0],dst[1],dst[2]]);
      triangle(ctx,image,[src[0],src[2],src[3]],[dst[0],dst[2],dst[3]]);
    }
    ctx.restore();
  }
  function inside(quad,p){return quad.every((a,i)=>{const b=quad[(i+1)%4];return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)>=0;});}
  function makeLight(from,to,tone,width,height){
    const start={x:clamp(from.x/width,0,1),y:clamp(from.y/height,0,1)},end={x:clamp(to.x/width,0,1),y:clamp(to.y/height,0,1)};
    const distance=Math.hypot((end.x-start.x)*width,(end.y-start.y)*height);
    return {from:start,to:end,tone:tone==='cold'?'cold':'warm',strength:clamp(distance/(Math.min(width,height)*.6),0,1)};
  }
  function drawLight(ctx,quad,light){
    if(!light||!Number.isFinite(light.strength)||light.strength<=0)return;
    const amount=clamp(light.strength,0,1),w=ctx.canvas.width,h=ctx.canvas.height;
    const gradient=ctx.createLinearGradient(light.from.x*w,light.from.y*h,light.to.x*w,light.to.y*h);
    const bright=light.tone==='cold'?'178,220,255':'255,207,139',dark=light.tone==='cold'?'12,30,52':'48,30,16';
    gradient.addColorStop(0,'rgba('+bright+','+(amount*.75)+')');
    gradient.addColorStop(.45,'rgba('+bright+','+(amount*.08)+')');
    gradient.addColorStop(1,'rgba('+dark+','+(amount*.75)+')');
    ctx.save();ctx.beginPath();quad.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.clip();
    ctx.globalCompositeOperation='soft-light';ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);ctx.restore();
  }
  function controlPoints(quad,scale,offsetX=0,offsetY=0){return quad.map(p=>({x:Math.round(p.x*scale+offsetX),y:Math.round(p.y*scale+offsetY)}));}
  function draw(ctx,room,crop,quad,warning=false,border=false,light=null,steps=border?12:24){
    ctx.drawImage(room,0,0,ctx.canvas.width,ctx.canvas.height);
    if(!crop||!quad)return;
    warp(ctx,crop,quad,steps);
    drawLight(ctx,quad,light);
    if(warning){ctx.fillStyle='rgba(190,35,35,0.30)';ctx.beginPath();quad.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();}
    if(border){
      ctx.strokeStyle=warning?'#b12424':'#ffffff';ctx.lineWidth=2;ctx.setLineDash([8,5]);ctx.beginPath();quad.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();ctx.setLineDash([]);
      const size=Math.max(12,ctx.canvas.width/40);
      for(const p of quad){ctx.fillStyle='#fff';ctx.strokeStyle='#766453';ctx.lineWidth=2;ctx.fillRect(p.x-size/2,p.y-size/2,size,size);ctx.strokeRect(p.x-size/2,p.y-size/2,size,size);}
    }
  }
  function historyLimit(owner){return typeof owner==='string'&&owner.indexOf('account:')===0?12:3;}
  const api={makeLight,drawLight,controlPoints,historyLimit,presets,wallValue,fits,frame,move,rectangle,convex,corner,translate,resize,project,inside,warp,draw};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.affrescoTryonCore=api;
})(typeof window!=='undefined'?window:globalThis);


