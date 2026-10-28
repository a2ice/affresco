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
