import * as THREE from './vendor/three/build/three.module.min.js';
import {facialControls, portraitCameras, actionCamera, squarePng} from './customizer-portrait.js?v=bd7137f375b1';

const $ = id => document.getElementById(id);
const profiles = {
  spl3:{core:'./customizer-spl3-core.js?v=34174bde4d5b',catalog:'./catalog/spl3/customizer.json?v=c662621acc70'},
  raiders:{core:'./customizer-core.js?v=29bd5c9b69f2',catalog:'./catalog/raiders/customizer.json?v=afa33936a92f'}
};
const modeNames={head:'正脸',bust:'半身',free:'自由'};
const faceNames=['neutral','smile','pout','brow'];
const defaults={yaw:0,pitch:0,zoom:1,panX:0,panY:0};
const paperColors=[['米白','#eee9df'],['天蓝','#99cbea'],['浅粉','#e8b3c1'],['薄荷','#b5d9c3'],['白色','#ffffff'],['炭黑','#252525']];
const gearLabels={clothes:'衣服',bottoms:'裤子',headgear:'发饰',shoes:'鞋子',outfits:'套装'};
const gearKeys={clothes:'outfit',outfits:'outfit',bottoms:'bottom',headgear:'headgear',shoes:'shoes'};
const projectKey='ink-board-portrait-project';
const hex=color=>/^#[a-f0-9]{6}$/i.test(color||'');
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function read(key,session=false) {
  try {return JSON.parse((session?sessionStorage:localStorage).getItem(key));} catch {return null;}
}
const params=new URLSearchParams(location.search);
const from=params.get('from');
const fromCustomizer=from==='customizer'||from==='preview';
const saved=read(projectKey)||{};
const recipe=read('ink-board-recipe')||{};
const source=fromCustomizer?read('ink-studio-source',true):null;
const originGame=params.get('game')==='raiders'?'raiders':'spl3';
const gameValue=fromCustomizer?originGame:(saved.game || (recipe.actor>=4?'raiders':'spl3'));
let game=gameValue==='raiders'?'raiders':'spl3';
const boardURL='./guestbook.html?compose=1'+(location.hash==='#author'?'#author':'');
$('back').href=boardURL;
if(fromCustomizer){
  $('back').href=(from==='preview'?'./studio-preview/':'./')+'customizer.html?game='+game;
  $('back').lastChild.textContent=' 返回奇迹鱿鱿';
  $('use').textContent='用于留言';
}
let mode=Object.hasOwn(modeNames,saved.mode)?saved.mode:'head';
let face=faceNames.includes(saved.face)?saved.face:(faceNames[recipe.face]||'neutral');
let paper=hex(saved.paper)?saved.paper:(hex(recipe.paper)?recipe.paper:paperColors[0][1]);
let pose=saved.pose || 'stand';
if(fromCustomizer && source?.game===game){
  pose=source.pose && source.pose!=='rest'?source.pose:'stand';
  mode=pose==='stand'?'head':'free';
}
const settings={...defaults};
for(const [key,min,max] of [['yaw',-180,180],['pitch',-75,75],['zoom',.5,2.5],['panX',-1,1],['panY',-1,1]]){
  if(Number.isFinite(saved.camera?.[key]))settings[key]=clamp(saved.camera[key],min,max);
}
let activePanel='camera',feature='hair',gear='clothes';
let renderer,scene,model,core,catalog,state,bases,applyFace,shot;
let modelTicket=0,poseTicket=0,built=false,ready=false,saving=false,retryAction;
let stageWidth=0,stageHeight=0,edge=0,raf=0;
const display=new THREE.OrthographicCamera();
const states={};
if(saved.state && Object.hasOwn(profiles,saved.game))states[saved.game]=saved.state;
if(source?.game===game && source.state)states[game]=source.state;
function pressed(element,value){element.setAttribute('aria-pressed',String(value));}
function buttons(selector,attr,value){for(const button of document.querySelectorAll(selector))pressed(button,button.dataset[attr]===value);}
function actionState(){for(const id of ['use','save'])$(id).disabled=!ready||saving;}
function status(text='',retry=null){
  $('load-text').textContent=text;
  $('loading').hidden=!text;
  $('retry').hidden=!retry;
  retryAction=retry;
}
$('retry').onclick=()=>retryAction?.();
function present(){
  if(!renderer||!shot||!edge)return;
  display.copy(shot);
  display.left*=stageWidth/edge;display.right*=stageWidth/edge;
  display.top*=stageHeight/edge;display.bottom*=stageHeight/edge;
  display.updateProjectionMatrix();
  renderer.render(scene,display);
}
function updateShot(){
  if(!built||!bases)return;
  shot=mode==='free'?actionCamera(model.character,bases,'bust',settings):bases[mode];
  present();
}
function scheduleShot(){
  if(!raf)raf=requestAnimationFrame(()=>{raf=0;updateShot();});
}
function resize(){
  const stage=$('stage');
  stageWidth=stage.clientWidth;stageHeight=stage.clientHeight;
  edge=Math.min(stageWidth,stageHeight)*.84;
  stage.style.setProperty('--frame',edge+'px');
  if(renderer&&edge){renderer.setSize(stageWidth,stageHeight,false);present();}
}
function showModes(){
  buttons('[data-mode]','mode',mode);
  buttons('[data-face]','face',face);
  $('free-tools').hidden=mode!=='free';
  $('stage').dataset.free=String(mode==='free');
  if(renderer){
    renderer.domElement.tabIndex=mode==='free'?0:-1;
    if(mode==='free')renderer.domElement.setAttribute('aria-describedby','pan-help');
    else renderer.domElement.removeAttribute('aria-describedby');
  }
  $('shot-label').textContent=modeNames[mode]+' · 1:1';
  for(const id of ['yaw','pitch','zoom']){
    $(id).value=settings[id];
    document.querySelector('output[for="'+id+'"]').value=id==='zoom'?Math.round(settings.zoom*100)+'%':settings[id]+'°';
  }
}
function pickPoseOptions(){
  const groups=new Map();
  for(const item of core.previewPoses){
    if(!groups.has(item.group)){
      const group=document.createElement('optgroup');group.label=item.group;groups.set(item.group,group);
    }
    groups.get(item.group).append(new Option(item.label,item.id));
  }
  $('pose').replaceChildren(...groups.values());
  if(!core.previewPoses.some(item=>item.id===pose))pose='stand';
  $('pose').value=pose;
}
let appliedPose='';
async function applyPose(){
  if(!built)return;
  const ticket=++poseTicket;
  const chosen=mode==='free'?pose:'stand';
  ready=false;actionState();
  try {
    if(appliedPose!==chosen){
      status('正在切换动作…');
      const data=await core.loadPreviewPose(chosen);
      if(ticket!==poseTicket||!built)return;
      applyFace('neutral');
      core.setPreviewPose(model,data);
      applyFace=facialControls(model.character);appliedPose=chosen;
    }
    applyFace(face);updateShot();
    status();ready=true;actionState();
  } catch {if(ticket===poseTicket)status('动作加载失败。',applyPose);}
}
function colors(){
  core.tint(model.tints,state.color);core.setEye(model,state.eye);
  core.setSkinColor(model.skin,state.skinColor,state.skinPreset);model.state={...state};
}
async function build(){
  const ticket=++modelTicket,engine=core;
  ++poseTicket;built=ready=false;actionState();status('正在加载角色…');
  let next;
  try {
    const standing=await engine.loadPreviewPose('stand');
    if(ticket!==modelTicket)return;
    const result=next=await engine.assemble(catalog,{...state});
    if(ticket!==modelTicket){engine.dispose(result.character);return;}
    engine.setPreviewPose(result,standing);
    const nextBases=portraitCameras(result.character);
    if(model){scene.remove(model.character);engine.dispose(model.character);}
    model=result;next=null;scene.add(model.character);
    colors();bases=nextBases;applyFace=facialControls(model.character);appliedPose='stand';built=true;
    await applyPose();
  } catch {
    if(next && next!==model)engine.dispose(next.character);
    if(ticket===modelTicket)status('角色加载失败，请检查网络。',build);
  }
}
function chooseSwatch(parent,items,current,choose){
  parent.replaceChildren(...items.map(({label,color,value})=>{
    const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);
    b.style.setProperty('--swatch',color);b.dataset.value=String(value);pressed(b,current===value);
    b.onclick=()=>choose(value);return b;
  }));
}
function gallery(parent,items,current,changeValue,disabled=false){
  parent.replaceChildren(...items.map(item=>{
    const b=document.createElement('button');b.type='button';b.disabled=disabled;b.dataset.value=String(item.value);
    b.title=item.accessibleName||item.name;b.setAttribute('aria-label',b.title);pressed(b,item.value===current);
    const poster=item.variants?.[state.gender]?.poster||item.poster;
    if(poster){const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt='';img.src=poster;b.append(img);}
    else b.textContent=item.name||'无';
    b.onclick=()=>changeValue(item.value);return b;
  }));
}
function showGallery(){
  if(!catalog||!state)return;
  if(activePanel==='actor'){
    buttons('[data-feature]','feature',feature);
    const items=feature==='hair'?catalog.hair.filter(x=>x.species===state.species&&(game!=='spl3'||core.supports(x,state.gender))):catalog.brows.filter(x=>x.species===state.species&&x.gender===state.gender);
    gallery($('features'),items.map(x=>({...x,value:feature==='hair'?x.id:x.style})),state[feature],value=>change({[feature]:value}));
  }else if(activePanel==='wear'){
    const items=game==='raiders'?catalog.outfits:catalog[gear].filter(x=>gear==='headgear'?core.headgearAvailable(x,state):core.supports(x,state.gender));
    const flags=game==='spl3'?core.wearFlags(catalog,state):{};
    const note=gear==='shoes'&&flags.integratedShoes?'这套衣服自带鞋子。':gear==='bottoms'&&flags.hidePants?'这套衣服自带下装。':'';
    $('wear-note').textContent=note;$('wear-note').hidden=!note;
    const key=gearKeys[gear];
    gallery($('outfits'),items.map(x=>({...x,value:x.id})),state[key],value=>change({[key]:value}),!!note);
  }
}
function showActor(){
  if(!state)return;
  for(const id of ['species','gender'])$(id).value=state[id];
  $('ink').value=state.color;$('skin').value=state.skinColor;
  chooseSwatch($('eyes'),catalog.eyes.map((x,i)=>({label:x.name,color:x.color,value:i})),state.eye,value=>change({eye:value}));
}
function change(patch){
  if(!core||!catalog||!state)return;
  const prev=state;
  state=core.normalize({...state,...patch},catalog);states[game]=state;
  const structure=['species','gender','hair','brow','outfit','bottom','headgear','shoes'].some(key=>prev[key]!==state[key]);
  if(structure){
    const galleryParent=document.activeElement?.closest('.choices');
    const activeValue=galleryParent?document.activeElement.dataset.value:null;
    showActor();showGallery();
    if(galleryParent)Array.from(galleryParent.children).find(b=>b.dataset.value===activeValue)?.focus({preventScroll:true});
    build();return;
  }
  if(built){
    if(prev.color!==state.color)core.tint(model.tints,state.color);
    if(prev.eye!==state.eye)core.setEye(model,state.eye);
    if(prev.skinColor!==state.skinColor||prev.skinPreset!==state.skinPreset)core.setSkinColor(model.skin,state.skinColor,state.skinPreset);
    model.state={...state};present();
  }
  if('eye' in patch)for(const b of $('eyes').children)pressed(b,Number(b.dataset.value)===state.eye);
}
async function loadGame(nextGame){
  if(state)states[game]=state;
  game=nextGame;const ticket=++modelTicket;
  ++poseTicket;state=catalog=core=null;built=ready=false;actionState();
  $('actor').inert=$('wear').inert=true;$('game').value=game;
  status('正在加载搭配目录…');
  try{
    const profile=profiles[game];
    const [engine,data]=await Promise.all([import(profile.core),fetch(profile.catalog).then(r=>{if(!r.ok)throw Error();return r.json();})]);
    if(ticket!==modelTicket)return;
    core=engine;catalog=data;
    let initial=core.restoreSkinSave(states[game]||read(game+'-character-v1'))||core.DEFAULTS;
    if(!fromCustomizer&&!saved.state&&Number.isInteger(recipe.actor)&&!states[game]&&((recipe.actor>=4)===(game==='raiders'))){
      initial={...initial,species:recipe.actor%4<2?'squid':'octopus',gender:recipe.actor%2?'male':'female',color:hex(recipe.ink)?recipe.ink:initial.color};
    }
    state=core.normalize(initial,catalog);gear=game==='raiders'?'outfits':'clothes';
    const types=game==='raiders'?['outfits']:['clothes','headgear','bottoms','shoes'];
    $('gear').replaceChildren(...types.map(id=>new Option(gearLabels[id],id)));$('gear').value=gear;
    pickPoseOptions();showActor();showGallery();$('actor').inert=$('wear').inert=false;
    await build();
  }catch{if(ticket===modelTicket)status('搭配目录加载失败。',()=>loadGame(game));}
}
function updatePaper(color){
  paper=color;$('background').value=color;
  for(const b of $('papers').children)pressed(b,b.dataset.value===color);
  if(scene){scene.background.set(color);present();}
}
for(const b of document.querySelectorAll('[data-panel]'))b.onclick=()=>{
  activePanel=b.dataset.panel;
  buttons('[data-panel]','panel',activePanel);
  for(const p of document.querySelectorAll('.panel'))p.hidden=p.id!==activePanel;
  showGallery();
};
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{
  mode=b.dataset.mode;showModes();applyPose();
};
for(const b of document.querySelectorAll('[data-face]'))b.onclick=()=>{
  face=b.dataset.face;showModes();
  if(ready){applyFace(face);updateShot();}
};
for(const b of document.querySelectorAll('[data-feature]'))b.onclick=()=>{feature=b.dataset.feature;showGallery();};
$('game').onchange=()=>loadGame($('game').value);
for(const id of ['species','gender'])$(id).onchange=()=>change({[id]:$(id).value});
$('ink').oninput=()=>change({color:$('ink').value});
$('skin').oninput=()=>change({skinColor:$('skin').value,skinPreset:null});
$('gear').onchange=()=>{gear=$('gear').value;showGallery();};
$('pose').onchange=()=>{pose=$('pose').value;if(mode==='free')applyPose();};
$('dice').onclick=()=>{
  if(mode!=='free'||!core)return;
  const choices=core.previewPoses.filter(p=>p.id!==pose);
  if(!choices.length)return;
  pose=choices[Math.floor(Math.random()*choices.length)].id;
  $('pose').value=pose;applyPose();
};
$('center').onclick=()=>{Object.assign(settings,defaults);showModes();scheduleShot();};
for(const id of ['yaw','pitch','zoom'])$(id).oninput=()=>{
  settings[id]=Number($(id).value);showModes();scheduleShot();
};
chooseSwatch($('papers'),paperColors.map(([label,color])=>({label,color,value:color})),paper,updatePaper);
$('background').oninput=()=>updatePaper($('background').value);
updatePaper(paper);
function installGestures(canvas){
  const pointers=new Map();
  let start;
  function anchors(){
    const [a,b]=pointers.values();
    if(!a)return null;
    return b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2,span:Math.hypot(b.x-a.x,b.y-a.y)}:{...a,span:0};
  }
  function anchor(){const at=anchors();start=at&&{...at,...settings};}
  canvas.addEventListener('pointerdown',e=>{
    if(mode!=='free'||e.button!==0||pointers.size>=2)return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);anchor();
  });
  canvas.addEventListener('pointermove',e=>{
    if(mode!=='free'||!start||!pointers.has(e.pointerId))return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const at=anchors();
    settings.panX=clamp(start.panX+(at.x-start.x)/edge,-1,1);
    settings.panY=clamp(start.panY+(at.y-start.y)/edge,-1,1);
    if(start.span>1&&at.span){settings.zoom=clamp(start.zoom*at.span/start.span,.5,2.5);showModes();}
    scheduleShot();
  });
  canvas.addEventListener('lostpointercapture',e=>{pointers.delete(e.pointerId);anchor();});
  canvas.addEventListener('keydown',e=>{
    const step={ArrowLeft:[-.025,0],ArrowRight:[.025,0],ArrowUp:[0,-.025],ArrowDown:[0,.025]}[e.key];
    if(mode!=='free'||!step)return;
    e.preventDefault();settings.panX=clamp(settings.panX+step[0],-1,1);settings.panY=clamp(settings.panY+step[1],-1,1);scheduleShot();
  });
  canvas.addEventListener('wheel',e=>{
    if(mode!=='free')return;
    e.preventDefault();settings.zoom=clamp(settings.zoom*Math.exp(-e.deltaY*.0015),.5,2.5);showModes();scheduleShot();
  },{passive:false});
}
function useAvatar(){
  if(!ready||saving)return;
  saving=true;actionState();$('feedback').textContent='';
  try{
    updateShot();
    const ratio=renderer.getPixelRatio();
    let avatar;
    try{
      renderer.setDrawingBufferSize(128,128,1);
      renderer.render(scene,shot);
      avatar=renderer.domElement.toDataURL('image/png');
    }finally{renderer.setDrawingBufferSize(stageWidth,stageHeight,ratio);present();}
    if(!avatar.startsWith('data:image/png;base64,'))throw Error();
    localStorage.setItem('ink-board-avatar',avatar);
    try{localStorage.setItem(projectKey,JSON.stringify({game,state,mode,face,pose,paper,camera:{...settings}}));}catch{}
    location.replace(boardURL.replace('compose=1','compose=avatar'));
  }catch{
    $('feedback').textContent='头像保存失败，请允许浏览器存储后重试。';saving=false;actionState();
  }
}
$('use').onclick=useAvatar;
$('save').onclick=async()=>{
  if(!ready||saving)return;
  saving=true;actionState();$('feedback').textContent='';
  try{
    updateShot();
    const blob=await squarePng(renderer,scene,shot,present);
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='奇迹鱿鱿-头像.png';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),30000);
  }catch{$('feedback').textContent='照片保存失败，请重试。';}
  finally{saving=false;actionState();}
};
function init(){
  try{
    renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.LinearToneMapping;
    renderer.domElement.setAttribute('aria-label','角色预览');
    $('stage').prepend(renderer.domElement);
    scene=new THREE.Scene();scene.background=new THREE.Color(paper);
    scene.add(new THREE.HemisphereLight(0xffffff,0x6f737e,2.6));
    const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(3,5,5);scene.add(key);
    const fill=new THREE.DirectionalLight(0xaabfff,1.2);fill.position.set(-3,2,-3);scene.add(fill);
    renderer.domElement.addEventListener('webglcontextlost',event=>{
      event.preventDefault();++modelTicket;++poseTicket;built=ready=false;actionState();
      status('三维预览已中断。',()=>location.reload());
    });
    installGestures(renderer.domElement);new ResizeObserver(resize).observe($('stage'));resize();showModes();loadGame(game);
  }catch{status('无法打开三维预览，请开启浏览器硬件加速。',()=>location.reload());}
}
init();
