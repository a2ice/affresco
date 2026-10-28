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
  // The wall is an infinite plane in photo coordinates, not a crop of the image.
  // Retain a generous numerical guard to keep malformed pointer input out of the homography.
  function freeCorner(quad,index,point,width,height){
    const limit=20*Math.max(width,height);
    if(!Number.isInteger(index)||index<0||index>3||![point.x,point.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=limit))return quad;
    const next=quad.map(p=>({...p}));next[index]={x:point.x,y:point.y};
    return convex(next)?next:quad;
  }
  function freeTranslate(quad,dx,dy,width,height){
    const limit=20*Math.max(width,height);
    if(!Number.isFinite(dx)||!Number.isFinite(dy))return quad;
    const next=quad.map(p=>({x:p.x+dx,y:p.y+dy}));
    return next.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=limit&&Math.abs(p.y)<=limit)?next:quad;
  }
  function viewTransform(imageWidth,imageHeight,viewportWidth,viewportHeight,view){
    const base=.78*Math.min(viewportWidth/imageWidth,viewportHeight/imageHeight);
    const scale=base*view.zoom;
    return {scale,x:(viewportWidth-imageWidth*scale)/2+view.panX,y:(viewportHeight-imageHeight*scale)/2+view.panY};
  }
  function zoomViewAt(view,ratio,anchor,viewportWidth,viewportHeight){
    const zoom=clamp(view.zoom*ratio,.08,8),factor=zoom/view.zoom;
    const ax=anchor.x-viewportWidth/2,ay=anchor.y-viewportHeight/2;
    return {zoom,panX:ax+(view.panX-ax)*factor,panY:ay+(view.panY-ay)*factor};
  }
  function fitQuadView(quad,imageWidth,imageHeight,viewportWidth,viewportHeight){
    const minX=Math.min(...quad.map(p=>p.x)),maxX=Math.max(...quad.map(p=>p.x));
    const minY=Math.min(...quad.map(p=>p.y)),maxY=Math.max(...quad.map(p=>p.y));
    const base=viewTransform(imageWidth,imageHeight,viewportWidth,viewportHeight,{zoom:1,panX:0,panY:0}).scale;
    const zoom=clamp(Math.min((viewportWidth-64)/(Math.max(1,maxX-minX)*base),(viewportHeight-64)/(Math.max(1,maxY-minY)*base)),.08,8);
    return {zoom,panX:(imageWidth/2-(minX+maxX)/2)*base*zoom,panY:(imageHeight/2-(minY+maxY)/2)*base*zoom};
  }
  function resize(quad,percent,width,height){
    const center={x:quad.reduce((n,p)=>n+p.x,0)/4,y:quad.reduce((n,p)=>n+p.y,0)/4};
    const spanX=Math.max(...quad.map(p=>p.x))-Math.min(...quad.map(p=>p.x)),spanY=Math.max(...quad.map(p=>p.y))-Math.min(...quad.map(p=>p.y));
    const scale=Math.min(width*clamp(percent,5,100)/100/spanX,height/spanY);
    const next=quad.map(p=>({x:center.x+(p.x-center.x)*scale,y:center.y+(p.y-center.y)*scale}));
    return translate(next,0,0,width,height);
  }
  function homography(quad){
    const [a,b,c,d]=quad;
    const dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x;
    const dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y;
    const den=dx1*dy2-dx2*dy1;
    let g=0,h=0;
    if(Math.abs(dx3)+Math.abs(dy3)>1e-8&&Math.abs(den)>1e-8){g=(dx3*dy2-dx2*dy3)/den;h=(dx1*dy3-dx3*dy1)/den;}
    return [b.x-a.x+g*b.x,d.x-a.x+h*d.x,a.x,b.y-a.y+g*b.y,d.y-a.y+h*d.y,a.y,g,h];
  }
  function project(quad,u,v){
    const m=homography(quad),divisor=m[6]*u+m[7]*v+1;
    return {x:(m[0]*u+m[1]*v+m[2])/divisor,y:(m[3]*u+m[4]*v+m[5])/divisor};
  }
  function unproject(quad,point){
    const m=homography(quad),a=m[0]-point.x*m[6],b=m[1]-point.x*m[7],c=point.x-m[2];
    const d=m[3]-point.y*m[6],e=m[4]-point.y*m[7],f=point.y-m[5],det=a*e-b*d;
    if(Math.abs(det)<1e-10)return null;
    return {x:(c*e-b*f)/det,y:(a*f-c*d)/det};
  }
  function maxPlacementPercent(source,wall){return Math.min(100,wall.width/source.width_cm*100,wall.height/source.height_cm*100);}
  function placement(source,wall,percent=100,previous=null){
    const number=Number(percent),factor=clamp(Number.isFinite(number)?number:100,1,maxPlacementPercent(source,wall))/100;
    const width=source.width_cm*factor,height=source.height_cm*factor;
    const cx=previous?previous.x+previous.width/2:wall.width/2,cy=previous?previous.y+previous.height/2:wall.height/2;
    return {x:clamp(cx-width/2,0,wall.width-width),y:clamp(cy-height/2,0,wall.height-height),width,height};
  }
  function placementQuad(wallQuad,wall,box){
    return [[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height]].map(([x,y])=>project(wallQuad,x/wall.width,y/wall.height));
  }
  function movePlacement(box,dx,dy,wall){return {...box,x:clamp(box.x+dx,0,wall.width-box.width),y:clamp(box.y+dy,0,wall.height-box.height)};}
  function resizePlacement(box,index,point,source,wall){
    const left=index===0||index===3,top=index===0||index===1;
    const anchor={x:left?box.x+box.width:box.x,y:top?box.y+box.height:box.y};
    if((left&&point.x>=anchor.x)||(!left&&point.x<=anchor.x)||(top&&point.y>=anchor.y)||(!top&&point.y<=anchor.y))return box;
    const aspect=source.width_cm/source.height_cm;
    const cap=Math.min(source.width_cm,left?anchor.x:wall.width-anchor.x,(top?anchor.y:wall.height-anchor.y)*aspect);
    const wanted=Math.max(Math.abs(point.x-anchor.x),Math.abs(point.y-anchor.y)*aspect);
    const width=clamp(wanted,Math.min(source.width_cm*.01,cap),cap),height=width/aspect;
    return {x:left?anchor.x-width:anchor.x,y:top?anchor.y-height:anchor.y,width,height};
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
  // A visual cast shadow for a fresco lifted ~12 cm above its wall. The light
  // gesture supplies a 2D direction and strength, not a true 3D light position.
  // Use centimeters in the calibrated wall plane so perspective and zoom stay
  // independent of the shadow geometry.
  function shadowProjection(frescoQuad,wallQuad,wallSize,light,imageWidth,imageHeight){
    if(!light||!Number.isFinite(light.strength)||light.strength<=.015||
       !frescoQuad||frescoQuad.length!==4||!wallQuad||wallQuad.length!==4||
       !wallSize||!(wallSize.width>0&&wallSize.height>0)||
       !(imageWidth>0&&imageHeight>0))return null;
    const vx=(light.to.x-light.from.x)*imageWidth,vy=(light.to.y-light.from.y)*imageHeight;
    const length=Math.hypot(vx,vy);
    if(!Number.isFinite(length)||length<1e-6)return null;
    const center=project(frescoQuad,.5,.5),step=Math.max(1,Math.min(imageWidth,imageHeight)*.025);
    const origin=unproject(wallQuad,center);
    const forward=unproject(wallQuad,{x:center.x+vx/length*step,y:center.y+vy/length*step});
    if(!origin||!forward)return null;
    const dirX=(forward.x-origin.x)*wallSize.width,dirY=(forward.y-origin.y)*wallSize.height;
    const dirLength=Math.hypot(dirX,dirY);
    if(!Number.isFinite(dirLength)||dirLength<1e-8)return null;
    // A nominal 12 cm relief does not imply a 12 cm lateral shadow: the
    // illumination angle is unknown in this 2D editor. Keep the penumbra near
    // the artwork (roughly 1–4.6 cm on the wall), even at maximum gesture.
    const strength=clamp(light.strength,0,1);
    let shiftCm=12*(.10+.28*strength);
    const unitU=dirX/dirLength/wallSize.width,unitV=dirY/dirLength/wallSize.height;
    // A perspective can amplify a tiny wall-plane shift dramatically near the
    // image horizon. Cap *every corner* in source-image pixels, not just center.
    const maxShiftPx=Math.min(10,Math.max(3,Math.min(imageWidth,imageHeight)*.012));
    let displaced=null,screenShift=Infinity;
    for(let attempt=0;attempt<5;attempt++){
      displaced=frescoQuad.map(p=>{
        const uv=unproject(wallQuad,p);
        return uv?project(wallQuad,uv.x+unitU*shiftCm,uv.y+unitV*shiftCm):null;
      });
      if(displaced.some(p=>!p||![p.x,p.y].every(v=>Number.isFinite(v)&&Math.abs(v)<Math.max(imageWidth,imageHeight)*30)))return null;
      screenShift=Math.max(...displaced.map((p,i)=>Math.hypot(p.x-frescoQuad[i].x,p.y-frescoQuad[i].y)));
      if(screenShift<=maxShiftPx+.01)break;
      shiftCm*=.95*maxShiftPx/screenShift;
    }
    if(!Number.isFinite(screenShift)||screenShift>maxShiftPx+.1)return null;
    return {
      quad:displaced,
      opacity:.025+.07*strength,
      blur:clamp(7+screenShift*.55,7,15),
      shiftCm,
      screenShift
    };
  }
  function drawShadow(ctx,frescoQuad,wallQuad,wallSize,light){
    const geometry=shadowProjection(frescoQuad,wallQuad,wallSize,light,ctx.canvas.width,ctx.canvas.height);
    if(!geometry)return;
    ctx.save();
    // The shadow is a soft, faint penumbra on the calibrated wall only.
    ctx.beginPath();
    wallQuad.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.closePath();ctx.clip();
    if('filter' in ctx){
      // Blur the *entire mask*; simply setting shadowBlur alongside an opaque
      // fill leaves a crisp duplicate polygon that looks like a deep box.
      ctx.filter='blur('+geometry.blur.toFixed(1)+'px)';
      ctx.fillStyle='rgba(24,21,18,'+geometry.opacity+')';
    }else{
      // Compatibility fallback for Canvas 2D implementations without filter:
      // retain a faint source and let the blurred halo dominate.
      ctx.shadowColor='rgba(24,21,18,'+geometry.opacity+')';
      ctx.shadowBlur=geometry.blur*1.5;
      ctx.fillStyle='rgba(24,21,18,0.012)';
    }
    ctx.beginPath();
    geometry.quad.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.closePath();ctx.fill();
    ctx.restore();
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
  function draw(ctx,room,crop,quad,warning=false,border=false,light=null,steps=border?12:24,wallPlane=null){
    ctx.drawImage(room,0,0,ctx.canvas.width,ctx.canvas.height);
    if(!crop||!quad)return;
    if(wallPlane&&light)drawShadow(ctx,quad,wallPlane.quad,wallPlane.size,light);
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
  const api={homography,unproject,maxPlacementPercent,placement,placementQuad,movePlacement,resizePlacement,makeLight,shadowProjection,drawShadow,drawLight,controlPoints,historyLimit,presets,wallValue,fits,frame,move,rectangle,convex,corner,translate,freeCorner,freeTranslate,viewTransform,zoomViewAt,fitQuadView,resize,project,inside,warp,draw};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.affrescoTryonCore=api;
})(typeof window!=='undefined'?window:globalThis);



