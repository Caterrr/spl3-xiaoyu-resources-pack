import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {PNG} from 'pngjs';

const catalog=JSON.parse(await fs.readFile('dist/catalog/spl3/old.json'));
const names=['Roller_Wide_00','Brush_Normal_00','Roller_Compact_00'];
catalog.items=catalog.items.filter(item=>names.includes(item.name));
assert.equal(catalog.items.length,3);
await fs.mkdir('dist/ink-ui-fixtures',{recursive:true});
for(const item of catalog.items)for(const format of ['blend','glb']) {
 const resp=await fetch(item[format],{signal:AbortSignal.timeout(45000)});
 assert(resp.ok,item.name+' '+resp.status);
 const bytes=Buffer.from(await resp.arrayBuffer());
 assert.equal(bytes.length,item[format+'Bytes']);
 const file=item.id+'.'+format;await fs.writeFile('dist/ink-ui-fixtures/'+file,bytes);
 item[format]='http://127.0.0.1:8765/ink-ui-fixtures/'+file;
}
await fs.writeFile('dist/catalog/spl3/old.json',JSON.stringify(catalog));
const mime={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 try{const file=resolve('dist','.'+new URL(req.url,'http://localhost').pathname);
 res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(8765,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1050,height:740},acceptDownloads:true});
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
const liveSite=process.argv.includes('--live');
const url=liveSite?'https://caterrr.github.io/spl3-xiaoyu-resources-pack/library.html?game=spl3&section=old&v=14f4d169c820':'http://127.0.0.1:8765/library.html?game=spl3&section=old';
const ease=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const sample=async()=>{await ease();const src=await page.locator('model-viewer').evaluate(v=>v.toDataURL('image/png'));return PNG.sync.read(Buffer.from(src.split(',')[1],'base64'));};
function delta(a,b){assert.equal(a.width,b.width);assert.equal(a.height,b.height);let err=0,area=0;for(let i=0;i<a.data.length;i+=4)if(a.data[i+3]>192 && b.data[i+3]>192){for(let k=0;k<3;k++)err+=Math.abs(a.data[i+k]-b.data[i+k]);area++;}assert(area>100);return err/(3*area);}
async function loadItem(name){
 const button=page.getByRole('button',{name:'预览 '+name,exact:true});
 await page.locator('.model-card').first().waitFor({timeout:30000});
 for(let i=0;i<5 && !(await button.count());i++){
  const cards=page.locator('.model-card'),count=await cards.count();await cards.last().scrollIntoViewIfNeeded();
  await page.waitForFunction(n=>document.querySelectorAll('.model-card').length>n,count,{timeout:10000});
 }
 await button.click();
 await page.locator('#weapon-ink').waitFor({state:'visible',timeout:35000});
 await page.locator('#weapon-ink summary').click();await page.locator('.ink-swatch').first().waitFor();
 await page.evaluate(()=>{const v=document.querySelector('model-viewer');v.cameraOrbit='48deg 73deg 110%';v.jumpCameraToGoal();window.testSrc=v.src;window.testLoads=0;v.addEventListener('load',()=>window.testLoads++);});await ease();
}
async function waitColor(){await page.waitForFunction(()=>Array.from(document.querySelector('model-viewer').model.materials).some(m=>m.pbrMetallicRoughness.baseColorTexture?.texture?.source?.element instanceof HTMLCanvasElement),{},{timeout:25000});}
async function dl(format){
 const done=page.waitForEvent('download');await page.locator('#download-'+format).click();
 const file=await done;return {name:file.suggestedFilename(),path:await file.path()};
}
try {
 if(liveSite){
  let ready=false;
  for(let i=0;i<32;i++){
   const resp=await fetch(url+'&verify='+i);if(resp.ok && (await resp.text()).includes('./app.js?v=ink-live-1')){ready=true;break;}
   await new Promise(r=>setTimeout(r,10000));
  }
  assert(ready,'Published Pages revision did not arrive');
 }
 await page.goto(url+(liveSite?'&test='+Date.now():''));for(const [idx,name] of names.entries()) {
  await loadItem(name);
  const original=await sample(),camera=await page.locator('model-viewer').evaluate(v=>v.getCameraOrbit().toString());
  if(!idx) {
   assert.equal(await page.locator('.ink-swatch').count(),10);
   await page.getByRole('button',{name:'蓝',exact:true}).click();
   await page.getByRole('button',{name:'粉',exact:true}).click();
   await page.locator('[aria-label="墨水十六进制颜色值"]').fill('#47C791');
  } else await page.getByRole('button',{name:'青绿',exact:true}).click();
  await waitColor();
  const hex=idx?'25b89a':'47c791';
  assert((await page.locator('#weapon-ink summary').getAttribute('aria-label')).includes(idx?'青绿':'#47c791'));
  assert(await page.locator('model-viewer').evaluate(v=>v.src===window.testSrc && window.testLoads===0));
  assert.equal(await page.locator('model-viewer').evaluate(v=>v.getCameraOrbit().toString()),camera);
  const glb=await dl('glb'),native=await dl('blend');
  for(const file of [native,glb])assert(file.name.includes(hex));
  const blend=await fs.readFile(native.path),bytes=await fs.readFile(glb.path);assert.equal(blend.toString('ascii',0,7),'BLENDER');assert.equal(bytes.toString('ascii',0,4),'glTF');
  await page.locator('#weapon-ink summary').click();const live=await sample();
  await page.evaluate(async(base64)=>{
    const v=document.querySelector('model-viewer');
    const ready=new Promise(resolve=>v.addEventListener('load',resolve,{once:true}));
    const raw=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([raw],{type:'model/gltf-binary'}));v.src=url;
    await ready;URL.revokeObjectURL(url);v.cameraOrbit='48deg 73deg 110%';v.jumpCameraToGoal();
  },bytes.toString('base64'));
  const exported=await sample(),difference=delta(live,exported),visibleChange=delta(original,live);
  console.log(name,'live/export average RGB difference',difference.toFixed(3),'recolour',visibleChange.toFixed(3));
  assert(visibleChange>.12,'No visible colour change');assert(difference<Math.max(1.8,visibleChange*.25),'Live/export mismatch');
  await page.getByRole('button',{name:'关闭模型预览'}).click();await page.locator('#model-dialog').waitFor({state:'hidden'});
 }
 await page.setViewportSize({width:375,height:667});await loadItem(names[0]);
 const bounds=await page.locator('.ink-panel').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=375);
 await page.getByRole('button',{name:'青绿',exact:true}).click();await waitColor();
 await page.locator('#weapon-ink input[type=color]').evaluate(async input=>{
  for(const hex of ['#de086c','#35b499','#b66adb','#3dadbf']){
   input.value=hex;input.dispatchEvent(new Event('input',{bubbles:true}));
   await new Promise(r=>setTimeout(r,16));
  }
  input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.getByRole('button',{name:'原色',exact:true}).click();assert(await page.locator('model-viewer').evaluate(v=>v.src===window.testSrc && !v.model.materials.some(m=>m.pbrMetallicRoughness.baseColorTexture?.texture?.source?.element instanceof HTMLCanvasElement)));
 await page.keyboard.press('Escape');assert.equal(await page.locator('#weapon-ink').getAttribute('open'),null);assert(await page.locator('#model-dialog').isVisible());
 console.log('Desktop and mobile, quick colour changes, custom HEX, reset, keyboard and downloads passed.');
} finally {await browser.close();server.close();}
