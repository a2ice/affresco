const assert=require('node:assert/strict');
const core=require('../public/assets/js/tryon-core.js');
assert.equal(core.fits({width_cm:500,height_cm:275},core.presets.standard),true);
assert.equal(core.fits({width_cm:501,height_cm:275},core.presets.standard),false);
assert.equal(core.fits({width_cm:100,height_cm:351},core.presets.high),false);
assert.equal(core.fits({width_cm:1000,height_cm:1000},{width:null,height:null}),true);
assert.equal(core.fits({width_cm:500,height_cm:300},{width:null,height:275}),false);
assert.equal(core.wallValue(''),null);assert.ok(Number.isNaN(core.wallValue('-4')));assert.ok(Number.isNaN(core.wallValue('Infinity')));
const quad=core.rectangle({x:100,y:100,width:400,height:300});
const moved=core.corner(quad,0,{x:100,y:180},1000,800);
assert.equal(moved[0].y,180);assert.deepEqual(moved.slice(1),quad.slice(1));
assert.deepEqual(core.corner(quad,0,{x:600,y:500},1000,800),quad,'Crossed quadrilateral rejected');
for(const [u,v,index] of [[0,0,0],[1,0,1],[1,1,2],[0,1,3]]){
 const p=core.project(moved,u,v);assert.ok(Math.abs(p.x-moved[index].x)<1e-8);assert.ok(Math.abs(p.y-moved[index].y)<1e-8);
}
const translated=core.translate(moved,-500,1000,1000,800);
assert.ok(translated.every(p=>p.x>=0&&p.y>=0&&p.x<=1000&&p.y<=800));
const resized=core.resize(moved,100,1000,800);assert.ok(core.convex(resized));assert.ok(resized.every(p=>p.x>=0&&p.y>=0&&p.x<=1000&&p.y<=800));
const center=core.project(moved,.5,.5);assert.equal(core.inside(moved,center),true);
let images=0,mask=0,borders=0;
const ctx={canvas:{width:1000,height:800},drawImage(){images++;},save(){},restore(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},clip(){},transform(){},fill(){mask++;},stroke(){borders++;},setLineDash(){},fillRect(){},strokeRect(){}};
core.draw(ctx,{},{width:400,height:300},moved,true,false);
assert.equal(images,1+24*24*2,'Room and perspective texture are both exported');assert.equal(mask,1);assert.equal(borders,0,'Export excludes selection controls');
console.log('PASS: presets, optional dimensions, fit warning, independent corners, convexity, perspective mapping, bounds and JPEG compositing path');

assert.equal(core.historyLimit('guest'),3);
assert.equal(core.historyLimit('account:tester'),12);
const vm=require('node:vm'),fs=require('node:fs');
const bootstrap=fs.readFileSync(require('node:path').join(__dirname,'../public/assets/js/tryon-compat.js'),'utf8');
function compatibility(missing){
 const elements=new Map(['tryOnWall','tryonBrowserNotice','tryonGlobalNotice','tryonCompatibilityMessage','tryonUploadStep'].map(id=>[id,{hidden:true,disabled:false,setAttribute(k,v){this[k]=v;}}]));
 const window={Promise,fetch(){},indexedDB:{},File:function(){},Blob:function(){},URL:{createObjectURL(){},revokeObjectURL(){}},Uint8Array,PointerEvent:function(){},crypto:{randomUUID(){}},CustomEvent:function(){}};
 if(missing)window[missing]=undefined;
 const document={createElement:()=>({getContext:()=>({}),toDataURL(){}}),getElementById:id=>elements.get(id)};
 vm.runInNewContext(bootstrap,{window,document});return {window,elements};
}
const modern=compatibility();assert.equal(modern.window.affrescoTryonCompat.supported,true);assert.equal(modern.elements.get('tryOnWall').disabled,false);
for(const feature of ['PointerEvent','indexedDB','crypto']){
 const older=compatibility(feature);assert.equal(older.window.affrescoTryonCompat.supported,false);assert.equal(older.elements.get('tryOnWall').disabled,true);assert.equal(older.elements.get('tryonGlobalNotice').hidden,false);assert.equal(older.elements.get('tryonUploadStep').hidden,true);
}
console.log('PASS: guest/account history caps and capability-based browser gating');


const shortLight=core.makeLight({x:100,y:200},{x:150,y:200},'warm',1000,700);
const longLight=core.makeLight({x:100,y:200},{x:900,y:200},'cold',1000,700);
assert.ok(longLight.strength>shortLight.strength);assert.equal(longLight.strength,1);
assert.equal(longLight.tone,'cold');assert.equal(shortLight.from.x,.1);
assert.equal(core.makeLight({x:0,y:0},{x:0,y:0},'warm',1000,700).strength,0);
const stops=[];let clipped=0;
const lightingContext={canvas:{width:1000,height:700},createLinearGradient(...points){assert.deepEqual(points,[100,200,900,200]);return {addColorStop:(at,color)=>stops.push({at,color})};},save(){},restore(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},clip(){clipped++;},fillRect(){}};
core.drawLight(lightingContext,moved,longLight);
assert.equal(clipped,1,'Lighting must be clipped to the fresco');assert.equal(stops.length,3);assert.match(stops[0].color,/178,220,255/);assert.match(stops[2].color,/12,30,52/);
const controlA=core.controlPoints(moved,.5),controlB=core.controlPoints(moved,2);
assert.equal(controlA.length,4);assert.equal(controlB.length,4);
assert.equal(controlA[0].x,50);assert.equal(controlB[0].x,200);
console.log('PASS: light direction/tone/intensity, fresco-only clipping and CSS-space control coordinates');


const calibratedWall=[{x:80,y:100},{x:900,y:40},{x:820,y:650},{x:110,y:580}];
for(const [u,v] of [[0,0],[1,1],[.5,.5],[.15,.85],[.9,.1]]){
 const p=core.project(calibratedWall,u,v),back=core.unproject(calibratedWall,p);
 assert.ok(Math.abs(back.x-u)<1e-8&&Math.abs(back.y-v)<1e-8,'Wall coordinate inversion');
}
const wall={width:500,height:275},source={width_cm:320,height_cm:210};
const physical=core.placement(source,wall,100);
assert.equal(physical.width,320);assert.equal(physical.height,210);
const over=core.placement(source,wall,500);assert.equal(over.width,320,'Cannot exceed source size');
const oversized=core.placement(source,{width:200,height:100},100);
assert.ok(oversized.width<=200&&oversized.height<=100,'Cannot exceed wall');
const mapped=core.placementQuad(calibratedWall,wall,physical);
for(let i=0;i<4;i++){
 const un=core.unproject(calibratedWall,mapped[i]);assert.ok(un.x>=-1e-8&&un.y>=-1e-8&&un.x<=1+1e-8&&un.y<=1+1e-8);
}
for(let i=0;i<4;i++){
 const enlarged=core.resizePlacement(physical,i,{x:i===0||i===3?-1000:1500,y:i===0||i===1?-1000:1500},source,wall);
 assert.ok(enlarged.width<=320+1e-8&&enlarged.height<=210+1e-8);
 assert.ok(enlarged.x>=-1e-8&&enlarged.y>=-1e-8&&enlarged.x+enlarged.width<=500+1e-8&&enlarged.y+enlarged.height<=275+1e-8);
 assert.ok(Math.abs(enlarged.width/enlarged.height-320/210)<1e-8);
}
const bounded=core.movePlacement(physical,10000,-10000,wall);
assert.equal(bounded.y,0);assert.ok(bounded.x+bounded.width<=500);
console.log('PASS: wall calibration, inverse perspective, physical source/wall caps, aspect ratio and bounded placement');
