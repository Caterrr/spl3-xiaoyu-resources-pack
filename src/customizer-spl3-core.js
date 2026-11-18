import * as THREE from './vendor/three/build/three.module.min.js';
import {GLTFExporter} from './vendor/three/examples/jsm/exporters/GLTFExporter.js';
import {clone} from './vendor/three/examples/jsm/utils/SkeletonUtils.js';
import {loadAsset,joinAsset,prepareTints,dispose,tint,setEye} from './customizer-core.js?v=69cc12eec1d2';
import {restoreExportPose} from './customizer-spl3-poses.js?v=cccff232be2b';
export {previewPoses,loadPreviewPose,setPreviewPose} from './customizer-spl3-poses.js?v=cccff232be2b';
export {dispose,tint,setEye};

export const DEFAULTS=Object.freeze({species:'squid',gender:'female',hair:'spl3:Har_SQD001',brow:1,outfit:'spl3:Clt_TES000',bottom:'spl3:Btm_000',headgear:'spl3:none:headgear',shoes:'spl3:Shs_SDL000',eye:0,color:'#ff5d1c'});
export function avatarId(s){return 'spl3:Player0'+(Number(s.species==='octopus')*2+Number(s.gender==='male'));}
export function browId(s){return `spl3:Eyb_${s.species==='octopus'?'OCT':'SQD'}00${s.brow}_${s.gender==='male'?'M':'F'}`;}
export function supports(entry,gender){return !!entry&&(entry.empty||!!entry.variants?.[gender]);}
export function headgearRule(entry,s){return entry?.fitByAvatar?.[avatarId(s)]||{};}
export function headgearHair(entry,state){
  if(entry?.empty)return state.hair;
  if(!supports(entry,state.gender))return undefined;
  const rule=entry.fitByAvatar?.[avatarId(state)];
  if(!rule)return undefined;
  if(rule.hideHair)return null;
  // The published catalog stores allowed styles by gender. Style keys also encode species.
  const speciesPrefix=state.species==='octopus'?'spl3:Har_OCT':'spl3:Har_SQD';
  const allowed=rule.hair??entry.compatibleHair?.[state.gender]?.filter(style=>style.startsWith(speciesPrefix))??[];
  if(allowed.includes(state.hair))return state.hair;
  return allowed.includes(rule.fallbackHair)?rule.fallbackHair:allowed[0];
}
export function normalize(input,catalog){
  if(catalog.game!=='spl3')throw Error('喷3搭配目录不匹配');
  const s={...DEFAULTS,...input};
  if(!['squid','octopus'].includes(s.species))s.species=DEFAULTS.species;
  if(!['female','male'].includes(s.gender))s.gender=DEFAULTS.gender;
  const hair=catalog.hair.filter(e=>e.species===s.species&&supports(e,s.gender));
  if(!hair.length)throw Error('发型资源不完整');
  if(!hair.some(e=>e.id===s.hair))s.hair=(hair.find(e=>e.id===DEFAULTS.hair)||hair[0]).id;
  for(const [key,entries] of [['outfit',catalog.clothes],['bottom',catalog.bottoms],['shoes',catalog.shoes],['headgear',catalog.headgear]]){
    const valid=entries.filter(e=>supports(e,s.gender));
    if(!valid.length)throw Error('服装资源不完整');
    if(!valid.some(e=>e.id===s[key]))s[key]=(valid.find(e=>e.id===DEFAULTS[key])||valid[0]).id;
  }
  if(headgearHair(catalog.headgear.find(e=>e.id===s.headgear),s)===undefined)s.headgear=DEFAULTS.headgear;
  s.eye=Number.isInteger(Number(s.eye))?Math.max(0,Math.min(catalog.eyes.length-1,Number(s.eye))):0;
  s.brow=Number.isInteger(Number(s.brow))&&Number(s.brow)>=0&&Number(s.brow)<=3?Number(s.brow):DEFAULTS.brow;
  if(!/^#[\da-f]{6}$/i.test(s.color))s.color=DEFAULTS.color;
  return {species:s.species,gender:s.gender,hair:s.hair,brow:s.brow,outfit:s.outfit,bottom:s.bottom,headgear:s.headgear,shoes:s.shoes,eye:s.eye,color:s.color.toLowerCase()};
}
export function wearFlags(catalog,s){return catalog.clothes.find(e=>e.id===s.outfit)?.variants?.[s.gender]?.flags||{};}
function rigOf(scene){let found;scene.traverse(o=>{if(o.userData.canonicalRig)found=o;});if(!found)throw Error('角色骨骼缺失');return found;}
async function load(entry){
  if(!entry||entry.game!=='spl3'||!entry.id.startsWith('spl3:'))throw Error('服装与角色必须来自喷3');
  const asset=await loadAsset(entry);
  if(asset.scene.userData.game!=='spl3'){dispose(asset.scene);throw Error('模型游戏版本不匹配');}
  return asset;
}
function variant(entry,s){if(!entry||entry.empty)return null;const asset=entry.variants?.[s.gender];if(!asset)throw Error('缺少对应性别的模型');return asset;}
function canvasImage(image,w=image.width,h=image.height){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);return {canvas,ctx,pixels:ctx.getImageData(0,0,w,h)};}
async function image(url){const im=new Image();im.src=url;await im.decode();return im;}
function replaceMap(material,canvas){const previous=material.map;if(!previous)throw Error('角色贴图缺失');const map=previous.clone();map.source=new THREE.Source(canvas);map.needsUpdate=true;material.map=map;previous.dispose();material.needsUpdate=true;}
async function maskBody(mesh,urls){
  const base=canvasImage(mesh.material.map.image);
  const masks=await Promise.all(urls.filter(Boolean).map(image));
  for(const mask of masks){const alpha=canvasImage(mask,base.canvas.width,base.canvas.height).pixels.data;for(let i=3;i<base.pixels.data.length;i+=4)base.pixels.data[i]=Math.min(base.pixels.data[i],alpha[i]);}
  base.ctx.putImageData(base.pixels,0,0);replaceMap(mesh.material,base.canvas);mesh.material.alphaTest=.5;mesh.material.transparent=false;mesh.material.needsUpdate=true;
}
export async function assemble(catalog,input){
  const state=normalize(input,catalog),flags=wearFlags(catalog,state);
  const outfit=catalog.clothes.find(e=>e.id===state.outfit),headgear=catalog.headgear.find(e=>e.id===state.headgear),shoe=catalog.shoes.find(e=>e.id===state.shoes);
  const headRule=headgearRule(headgear,state);
  const effectiveHair=headgearHair(headgear,state);
  const bottom=catalog.bottoms.find(e=>e.id===state.bottom);
  const entries={body:catalog.avatars.find(e=>e.id===avatarId(state)),wear:variant(outfit,state),brow:catalog.brows.find(e=>e.id===browId(state))};
  if(!flags.hidePants)entries.bottom=variant(bottom,state);
  if(!flags.integratedShoes&&!shoe.empty)entries.shoes=variant(shoe,state);
  if(!headgear.empty)entries.headgear=variant(headgear,state);
  if(effectiveHair)entries.hair=variant(catalog.hair.find(e=>e.id===effectiveHair),state);
  const keys=Object.keys(entries),loaded=await Promise.allSettled(keys.map(key=>load(entries[key])));
  const failure=loaded.find(r=>r.status==='rejected');
  if(failure){for(const r of loaded)if(r.status==='fulfilled')dispose(r.value.scene);throw failure.reason;}
  const assets=Object.fromEntries(keys.map((key,i)=>[key,loaded[i].value]));
  const character=new THREE.Group();character.name='Splatoon3_Character';character.add(assets.body.scene);
  try{
    const rig=rigOf(assets.body.scene),roles={};assets.body.scene.traverse(o=>{if(o.userData.role)roles[o.userData.role]=o;});
    if(!roles.body||!roles.eye||!roles.face||!roles.faceNoEars)throw Error('角色部件不完整');
    roles.face.visible=!headRule.hideEars;roles.faceNoEars.visible=!!headRule.hideEars;
    for(const [key,asset] of Object.entries(assets))if(key!=='body')joinAsset(character,asset.scene,rig);
    const maskFor=entry=>{const key=entry?.maskTexture;if(!key)return null;if(!catalog.masks[key])throw Error('服装遮罩缺失');return catalog.masks[key];};
    const masks=[maskFor(entries.wear)];
    if(entries.bottom)masks.push(maskFor(entries.bottom));
    if(entries.shoes)masks.push(maskFor(entries.shoes));
    await maskBody(roles.body,masks);
    const eyeImages=await Promise.all(assets.body.scene.userData.eyes.map(image));
    const eyeCanvas=canvasImage(eyeImages[state.eye],Math.max(...eyeImages.map(im=>im.width)),Math.max(...eyeImages.map(im=>im.height)));replaceMap(roles.eye.material,eyeCanvas.canvas);
    const tints=await prepareTints(character);tint(tints,state.color);character.updateMatrixWorld(true);
    return {game:'spl3',character,rig,tints,eyeImages,eyeCanvas,eyeMaterial:roles.eye.material,state:{...state},effectiveHair,flags};
  }catch(error){dispose(character);for(const asset of Object.values(assets))if(!asset.scene.parent)dispose(asset.scene);throw error;}
}
export async function exportCharacter(model){
  if(model.game!=='spl3')throw Error('只能导出喷3角色');
  const scene=clone(model.character),materials=new Map();
  restoreExportPose(model,scene);
  scene.traverse(o=>{o.userData={};if(o.material){const copy=m=>{if(!materials.has(m)){const n=m.clone();n.userData={};materials.set(m,n);}return materials.get(m);};o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);}});
  scene.userData={game:'Splatoon 3',customization:{...model.state,hair:model.effectiveHair}};
  try{return await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true,maxTextureSize:4096});}
  finally{for(const m of materials.values())m.dispose();scene.traverse(o=>o.skeleton?.dispose());}
}
