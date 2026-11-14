import * as THREE from './vendor/three/build/three.module.min.js';
import {GLTFLoader} from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import {GLTFExporter} from './vendor/three/examples/jsm/exporters/GLTFExporter.js';
import {clone} from './vendor/three/examples/jsm/utils/SkeletonUtils.js';

export const DEFAULTS = Object.freeze({species:'squid',gender:'female',hair:'Har_SQD001_F',brow:1,outfit:'Clt_AGL001',eye:0,color:'#ff5d1c'});
export function normalize(input, catalog) {
  const s={...DEFAULTS,...input};
  if(!['squid','octopus'].includes(s.species))s.species=DEFAULTS.species;
  if(!['female','male'].includes(s.gender))s.gender=DEFAULTS.gender;
  const hairs=catalog.hair.filter(x=>x.species===s.species);
  if(!hairs.some(x=>x.id===s.hair))s.hair=hairs[0].id;
  if(!catalog.outfits.some(x=>x.id===s.outfit))s.outfit=DEFAULTS.outfit;
  s.eye=Number.isInteger(Number(s.eye))?Math.max(0,Math.min(20,Number(s.eye))):0;
  s.brow=Number.isInteger(Number(s.brow))?Math.max(0,Math.min(3,Number(s.brow))):DEFAULTS.brow;
  if(!/^#[\da-f]{6}$/i.test(s.color))s.color=DEFAULTS.color;
  return {species:s.species,gender:s.gender,hair:s.hair,brow:s.brow,outfit:s.outfit,eye:s.eye,color:s.color.toLowerCase()};
}
export function avatarId(s){return 'Player0'+(Number(s.species==='octopus')*2+Number(s.gender==='male'));}
export function browId(s){return `Eyb_${s.species==='octopus'?'OCT':'SQD'}00${s.brow}_${s.gender==='male'?'M':'F'}`;}

const cache=new Map();
let cachedBytes=0;
export async function assetBytes(entry) {
  if(cache.has(entry.id)){const hit=cache.get(entry.id);cache.delete(entry.id);cache.set(entry.id,hit);return hit;}
  const pending=(async()=>{
    const response=await fetch(entry.url,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('模型下载失败，请重试');
    let bytes=await response.arrayBuffer();
    const head=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
    if(head[0]===31&&head[1]===139)bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if(bytes.byteLength!==entry.bytes)throw Error('模型文件不完整，请重试');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==entry.sha256)throw Error('模型校验失败，请重试');
    pending.bytes=bytes.byteLength;
    if(cache.get(entry.id)===pending){cachedBytes+=bytes.byteLength;while(cachedBytes>64*1024*1024&&cache.size>1){const key=cache.keys().next().value;const value=cache.get(key);cache.delete(key);cachedBytes-=value.bytes||0;}}
    return bytes;
  })();
  cache.set(entry.id,pending);
  try{return await pending;}catch(e){cache.delete(entry.id);throw e;}
}

export async function loadAsset(entry){return new GLTFLoader().parseAsync(await assetBytes(entry),'');}

function rigOf(scene){let found;scene.traverse(o=>{if(o.userData.canonicalRig)found=o;});if(!found)throw Error('角色骨骼缺失');return found;}
function allBones(root){const result=new Map();function visit(node){for(const child of node.children)if(child.isBone){result.set(child.name,child);visit(child);}}visit(root);return result;}
export function joinAsset(character,asset,rig) {
  character.add(asset);
  character.updateMatrixWorld(true);
  const source=rigOf(asset);
  const targets=allBones(rig),sources=allBones(source);
  // Some jackets add sleeve/waistcloth bones; retain their original hierarchy.
  for(const [name,bone] of sources)if(!targets.has(name)&&(bone.parent===source||targets.has(bone.parent?.name))){(bone.parent===source?(targets.get('nw4f_root')||rig):targets.get(bone.parent.name)).attach(bone);bone.traverse(child=>{if(child.isBone)targets.set(child.name,child);});}
  // Preserve accessory armatures below the corresponding body bone.
  for(const [name,bone] of sources){
    if(!targets.has(name))continue;
    for(const child of [...bone.children])if(!child.isBone)targets.get(name).attach(child);
  }
  const meshes=[];asset.traverse(o=>{if(o.isMesh)meshes.push(o);});
  for(const mesh of meshes){
    if(mesh.isSkinnedMesh){
      mesh.skeleton.bones=mesh.skeleton.bones.map(b=>sources.get(b.name)===b&&targets.has(b.name)?targets.get(b.name):b);
      mesh.skeleton.update();
    }
    if(mesh.parent===source)asset.attach(mesh);
  }
  source.removeFromParent();
  character.updateMatrixWorld(true);
}

export function dispose(root){
  if(!root)return;
  const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
  root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materials.add(m);});
  for(const m of materials){for(const v of Object.values(m))if(v?.isTexture)textures.add(v);m.dispose();}
  for(const t of textures){t.dispose();if(typeof t.image?.close==='function')t.image.close();}
  for(const g of geometries)g.dispose();for(const s of skeletons)s.dispose();
}

function canvasImage(image,w=image.width,h=image.height){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);return {canvas:c,ctx,pixels:ctx.getImageData(0,0,w,h)};}
async function image(url){const im=new Image();im.src=url;await im.decode();return im;}
function replaceMap(material,canvas){const previous=material.map;const map=previous.clone();map.source=new THREE.Source(canvas);map.needsUpdate=true;material.map=map;previous.dispose();material.needsUpdate=true;}

const linear=Float32Array.from({length:256},(_,i)=>{const c=i/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
function srgb(c){return Math.round(Math.min(1,Math.max(0,c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055))*255);}
export async function prepareTints(root){
  const mats=new Set();root.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])if(m.userData.tintBlack)mats.add(m);});
  return Promise.all([...mats].map(async material=>{
    const [a,b]=await Promise.all([image(material.userData.tintBlack),image(material.userData.tintWhite)]);
    const black=canvasImage(a),white=canvasImage(b),result=canvasImage(a);
    replaceMap(material,result.canvas);
    return {material,black:black.pixels.data,white:white.pixels.data,...result};
  }));
}
export function tint(tints,color){
  const rgb=[1,3,5].map(i=>linear[parseInt(color.slice(i,i+2),16)]);
  for(const t of tints){const d=t.pixels.data;for(let i=0;i<d.length;i+=4)for(let c=0;c<3;c++)d[i+c]=srgb(linear[t.black[i+c]]+(linear[t.white[i+c]]-linear[t.black[i+c]])*rgb[c]);t.ctx.putImageData(t.pixels,0,0);t.material.map.needsUpdate=true;}
}
async function maskBody(mesh,url){
  const m=mesh.material,src=m.map.image,mask=await image(url);
  const base=canvasImage(src),alpha=canvasImage(mask,src.width,src.height).pixels.data;
  for(let i=3;i<base.pixels.data.length;i+=4)base.pixels.data[i]=alpha[i];
  base.ctx.putImageData(base.pixels,0,0);replaceMap(m,base.canvas);m.alphaTest=.5;m.transparent=false;m.needsUpdate=true;
}

export async function assemble(catalog,state){
  const id=avatarId(state),outfit=catalog.outfits.find(x=>x.id===state.outfit);
  const loaded=await Promise.allSettled([loadAsset(catalog.avatars.find(x=>x.id===id)),loadAsset(outfit),loadAsset(catalog.brows.find(x=>x.id===browId(state))),...(!outfit.hideHair?[loadAsset(catalog.hair.find(x=>x.id===state.hair))]:[])]);
  const failure=loaded.find(x=>x.status==='rejected');
  if(failure){for(const x of loaded)if(x.status==='fulfilled')dispose(x.value.scene);throw failure.reason;}
  const [body,wear,brow,hair]=loaded.map(x=>x.value),character=new THREE.Group();character.name='Raiders_Character';
  character.add(body.scene);
  try{
    const rig=rigOf(body.scene),roles={};body.scene.traverse(o=>{if(o.userData.role)roles[o.userData.role]=o;});
    if(!roles.body||!roles.eye||!roles.face||!roles.faceNoEars)throw Error('角色部件不完整');
    roles.face.visible=!outfit.hideEars;roles.faceNoEars.visible=!!outfit.hideEars;
    joinAsset(character,wear.scene,rig);joinAsset(character,brow.scene,rig);if(hair)joinAsset(character,hair.scene,rig);
    await maskBody(roles.body,wear.scene.userData.bodyMasks[id]);
    const eyeImages=await Promise.all(body.scene.userData.eyes.map(image));
    const eyeCanvas=canvasImage(eyeImages[state.eye]);replaceMap(roles.eye.material,eyeCanvas.canvas);
    const tints=await prepareTints(character);tint(tints,state.color);
    character.updateMatrixWorld(true);
    return {character,rig,tints,eyeImages,eyeCanvas,eyeMaterial:roles.eye.material,state:{...state}};
  }catch(e){dispose(character);if(!wear.scene.parent)dispose(wear.scene);if(!brow.scene.parent)dispose(brow.scene);if(hair&&!hair.scene.parent)dispose(hair.scene);throw e;}
}
export function setEye(model,index){model.eyeCanvas.ctx.clearRect(0,0,model.eyeCanvas.canvas.width,model.eyeCanvas.canvas.height);model.eyeCanvas.ctx.drawImage(model.eyeImages[index],0,0);model.eyeMaterial.map.needsUpdate=true;model.state.eye=index;}
export async function exportCharacter(model){
  const scene=clone(model.character),materials=new Map();
  scene.traverse(o=>{
    o.userData={};
    if(o.material){const copy=m=>{if(!materials.has(m)){const n=m.clone();n.userData={};materials.set(m,n);}return materials.get(m);};o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);}
  });
  scene.userData={game:'Splatoon Raiders',customization:{...model.state}};
  try{return await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true,maxTextureSize:4096});}
  finally{for(const m of materials.values())m.dispose();scene.traverse(o=>o.skeleton?.dispose());}
}
