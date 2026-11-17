import * as THREE from './vendor/three/build/three.module.min.js';
import {OrbitControls} from './vendor/three/examples/jsm/controls/OrbitControls.js';
import {setupPoseMenu} from './customizer-pose-menu.js?v=48df6872dd7d';
const gameKey=new URLSearchParams(location.search).get('game')==='spl3'?'spl3':'raiders';
const gameName=gameKey==='spl3'?'喷3':'涂击队';
const profiles={raiders:{catalog:'./catalog/raiders/customizer.json?v=afa33936a92f',core:'./customizer-core.js?v=69cc12eec1d2'},spl3:{catalog:'./catalog/spl3/customizer.json?v=29b27084bf03',core:'./customizer-spl3-core.js?v=d1c8b6ddb6b4'}};
let DEFAULTS,normalize,assemble,dispose,tint,setEye,exportCharacter,supports,headgearHair,wearFlags;

const $=s=>document.querySelector(s),stage=$('#character-stage'),status=$('#stage-message'),overlay=$('#stage-status'),retry=$('#retry-character'),download=$('#download-character'),downloadStatus=$('#download-status');
let catalog,state,model,renderer,controls,camera,scene,requestId=0,exporting=false,loading=true,hasError=false;
const storageKey=gameKey+'-character-v1';
let previewPose='rest',poseData=null,poseTicket=0,poseFrame=0,poseMenu,loadPreviewPose,setPreviewPose;
const poseTrigger=$('.pose-trigger');
let wearKind='clothes';
const wearKey=()=>({clothes:'outfit',bottoms:'bottom'})[wearKind]||wearKind;
function showStatus(message,error=false){status.textContent=message;overlay.hidden=!message;retry.hidden=!error;}
const downloadBlend=$('#download-blend');
function updateDownload(){poseTrigger.disabled=exporting;downloadBlend.disabled=download.disabled=loading||exporting||hasError||!model;for(const el of document.querySelectorAll('.identity-fields,.editor-tabs,.editor-panel'))el.inert=exporting;$('#reset-character').disabled=exporting;}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{} }
function render(){if(renderer&&scene&&camera)renderer.render(scene,camera);}
function framing(reset=false){
  if(!camera||!controls)return;
  const box=model?new THREE.Box3().setFromObject(model.character):new THREE.Box3(new THREE.Vector3(-1,0,-.4),new THREE.Vector3(1,2,.4));
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const direction=reset?new THREE.Vector3(.12,.08,1).normalize():camera.position.clone().sub(controls.target).normalize();
  const angle=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);
  let distance=Math.max(size.y/(2*angle),Math.max(size.x,size.z)/(2*angle*Math.max(.1,camera.aspect)))*1.16;
  if(model && previewPose!=='rest'){
    // Viewed at an angle, a hand or shoe may be much closer to the lens than the body's center.
    const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize();
    const up=new THREE.Vector3().crossVectors(direction,right);
    const corner=new THREE.Vector3();
    distance=0;
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      corner.set(x,y,z).sub(center);
      const halfHeight=Math.max(Math.abs(corner.dot(up)),Math.abs(corner.dot(right))/camera.aspect);
      distance=Math.max(distance,corner.dot(direction)+1.12*halfHeight/angle);
    }
  }
  return {center,position:center.clone().addScaledVector(direction,distance),limit:Math.max(7,distance*2)};
}
function fitCamera(reset=false){
  if(!camera||!controls)return;
  const frame=framing(reset);
  controls.target.copy(frame.center);camera.position.copy(frame.position);controls.maxDistance=frame.limit;if(!controls.update())render();
}
function cancelPoseMotion(){
  cancelAnimationFrame(poseFrame);poseFrame=0;
}
function transitionToPose(){
  cancelPoseMotion();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){setPreviewPose(model,poseData);fitCamera();return;}
  const startTarget=controls.target.clone(),startCamera=camera.position.clone();
  const blend=setPreviewPose(model,poseData,true),end=framing();
  controls.maxDistance=Math.max(controls.maxDistance,end.limit);
  const start=performance.now();
  // Ease out over the same 420 ms as the site's navigation. A new selection starts at the visible pose.
  function tick(now){
    const time=Math.min(1,(now-start)/420),t=1-(1-time)**4;
    blend(t);controls.target.lerpVectors(startTarget,end.center,t);camera.position.lerpVectors(startCamera,end.position,t);
    if(!controls.update())render();
    poseFrame=time<1?requestAnimationFrame(tick):0;
  }
  tick(start);
}
async function choosePose(id){
  const ticket=++poseTicket;
  poseMenu.select(id);
  try{
    const data=await loadPreviewPose(id);
    if(ticket!==poseTicket)return;
    previewPose=id;poseData=data;
    if(model&&!loading&&!hasError)transitionToPose();
  }catch(error){
    if(ticket!==poseTicket)return;
    poseMenu.select(previewPose);downloadStatus.textContent='姿势加载失败，请重新选择。';
  }
}
function selectedButtons(container,id){for(const b of container.querySelectorAll('button[data-id]'))b.setAttribute('aria-pressed',String(b.dataset.id===String(id)));}
function sync(){
  for(const input of document.querySelectorAll('.identity-options input'))input.checked=input.value===state[input.name];
  $('#hair-color').value=state.color;$('#hair-hex').value=state.color;
  selectedButtons($('#hair-choices'),state.hair);selectedButtons($('#outfit-choices'),state[wearKey()]);
  selectedButtons($('#brow-choices'),state.brow);
  selectedButtons($('#hair-swatches'),state.color);selectedButtons($('#eye-swatches'),state.eye);
  const hairNotice=$('#hair-notice');
  const effectiveHair=gameKey==='spl3'?headgearHair(catalog.headgear.find(x=>x.id===state.headgear),state):undefined;
  const headgearNotice=effectiveHair===null?'当前发饰会遮住发型，取下后恢复所选发型。'
    :effectiveHair&&effectiveHair!==state.hair?'试戴中暂时使用适配发型，取下后恢复所选发型。':'';
  if(gameKey==='spl3'){
    hairNotice.textContent=headgearNotice;
    hairNotice.hidden=!headgearNotice;
    const flags=wearFlags(catalog,state);
    const blocked=wearKind==='shoes'&&flags.integratedShoes?'这套衣服自带鞋子，换下后恢复所选鞋子。'
      :wearKind==='bottoms'&&flags.hidePants?'这套衣服自带下装，换下后恢复所选裤子。':'';
    const notice=blocked||(wearKind==='headgear'?headgearNotice:'');
    $('#wear-notice').textContent=notice;
    $('#wear-notice').hidden=!notice;
    for(const button of $('#outfit-choices').querySelectorAll('button'))button.disabled=!!blocked;
  }
}
function choices(target,entries,onSelect){
  target.replaceChildren(...entries.map(entry=>{
    const button=document.createElement('button');button.type='button';button.className='choice-button';button.dataset.id=entry.id;button.setAttribute('aria-pressed', 'false');button.setAttribute('aria-label',entry.accessibleName||entry.name);
    if(entry.poster){const img=document.createElement('img');img.src=entry.poster;img.alt='';img.loading='lazy';img.width=128;img.height=128;button.append(img);}
    else{const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 40 40');icon.setAttribute('aria-hidden','true');icon.innerHTML='<circle cx="20" cy="20" r="13"/><path d="m11 29 18-18"/>';button.classList.add('choice-none');button.append(icon);}
    button.addEventListener('click',()=>onSelect(entry.id));return button;
  }));
}
function hairChoices(){choices($('#hair-choices'),catalog.hair.filter(x=>x.species===state.species).map(x=>({...x,poster:x.variants?.[state.gender]?.poster||x.poster})),id=>change({hair:id}));}
function browChoices(){choices($('#brow-choices'),catalog.brows.filter(x=>x.species===state.species&&x.gender===state.gender).map(x=>({...x,id:String(x.style)})),id=>change({brow:Number(id)}));}
function outfitChoices(){
  let entries;
  if(gameKey!=='spl3')entries=catalog.outfits;
  else if(wearKind==='headgear'){
    entries=catalog.headgear.filter(entry=>headgearHair(entry,state)!==undefined).map(entry=>{
      const hair=headgearHair(entry,state);
      return hair&&hair!==state.hair?{...entry,accessibleName:entry.name+'，试戴时暂时更换发型'}:entry;
    });
  }else entries=catalog[wearKind].filter(entry=>supports(entry,state.gender));
  choices($('#outfit-choices'),entries.map(entry=>({...entry,poster:entry.variants?.[state.gender]?.poster||entry.poster})),id=>change({[wearKey()]:id}));
  selectedButtons($('#outfit-choices'),state[wearKey()]);
  if(gameKey==='spl3')sync();
}
function swatches(target,entries,onSelect){
  target.replaceChildren(...entries.map(e=>{const b=document.createElement('button');b.type='button';b.className='swatch';b.style.setProperty('--swatch',e.color);b.dataset.id=e.id;b.title=e.name;b.setAttribute('aria-label',e.name);b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>onSelect(e.id));return b;}));
}
async function rebuild(resetView=false){
  cancelPoseMotion();
  const ticket=++requestId;loading=true;hasError=false;updateDownload();showStatus('加载搭配…');downloadStatus.textContent='';
  const requested={...state};
  try{
    const next=await assemble(catalog,requested);
    if(ticket!==requestId){dispose(next.character);return;}
    // Colour changes during a model load apply to the newest selected values.
    tint(next.tints,state.color);setEye(next,state.eye);next.state={...state};
    if(setPreviewPose && previewPose!=='rest')setPreviewPose(next,poseData);
    const previous=model;model=next;scene.add(model.character);if(previous){scene.remove(previous.character);dispose(previous.character);}
    showStatus('');loading=false;hasError=false;updateDownload();fitCamera(resetView||!previous);
  }catch(e){if(ticket!==requestId)return;loading=false;hasError=true;showStatus(e.message||'搭配加载失败，请重试',true);updateDownload();}
}
function change(patch){
  const previous={...state};state=normalize({...state,...patch},catalog);persist();
  if(previous.species!==state.species||gameKey==='spl3'&&previous.gender!==state.gender)hairChoices();
  if(gameKey==='spl3'&&['species','gender','hair'].some(k=>state[k]!==previous[k]))outfitChoices();
  if(previous.species!==state.species||previous.gender!==state.gender)browChoices();sync();
  if(['species','gender','hair','brow','outfit','bottom','headgear','shoes'].some(k=>state[k]!==previous[k])){rebuild();return;}
  if(model&&!loading&&!hasError){if(previous.color!==state.color)tint(model.tints,state.color);if(previous.eye!==state.eye)setEye(model,state.eye);model.state={...state};render();}
}
function activateTab(tab){
  for(const button of document.querySelectorAll('[role=tab]')){const active=button===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$('#'+button.getAttribute('aria-controls')).hidden=!active;}
}
async function init(){
  try{
    document.documentElement.dataset.game=gameKey;document.title='奇迹鱿鱿 · '+gameName;
    const core=await import(profiles[gameKey].core);
    ({DEFAULTS,normalize,assemble,dispose,tint,setEye,exportCharacter,supports,headgearHair,wearFlags,setPreviewPose,loadPreviewPose}=core);
    if(setPreviewPose)poseMenu=setupPoseMenu($('#pose-field'),core.previewPoses,choosePose);
    const response=await fetch(profiles[gameKey].catalog);if(!response.ok)throw Error('搭配目录加载失败');catalog=await response.json();
    if(gameKey==='spl3'&&catalog.game!=='spl3'||catalog.game&&catalog.game!==gameKey)throw Error('搭配目录不匹配，请刷新重试');
    $('#wear-categories').hidden=gameKey!=='spl3';
    for(const button of document.querySelectorAll('#wear-categories button'))button.addEventListener('click',()=>{wearKind=button.dataset.kind;for(const b of document.querySelectorAll('#wear-categories button'))b.setAttribute('aria-pressed',String(b===button));outfitChoices();});
    let saved;try{saved=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
    state=normalize(saved||DEFAULTS,catalog);
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.LinearToneMapping;renderer.toneMappingExposure=1;
    renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','角色三维预览，拖动旋转、滚轮或双指缩放，也可使用方向键平移');stage.prepend(renderer.domElement);
    scene=new THREE.Scene();scene.background=new THREE.Color('#171717');camera=new THREE.PerspectiveCamera(34,1,.01,100);
    scene.add(new THREE.HemisphereLight(0xffffff,0x6f737e,2.6));const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(3,5,5);scene.add(key);const fill=new THREE.DirectionalLight(0xaabfff,1.2);fill.position.set(-3,2,-3);scene.add(fill);
    controls=new OrbitControls(camera,renderer.domElement);controls.minDistance=.7;controls.maxDistance=7;controls.maxPolarAngle=Math.PI*.95;controls.enablePan=true;controls.addEventListener('change',render);controls.listenToKeyEvents(renderer.domElement);
    controls.addEventListener('start',()=>{if(poseFrame){cancelPoseMotion();setPreviewPose(model,poseData);render();}});
    new ResizeObserver(()=>{const r=stage.getBoundingClientRect();stage.style.setProperty('--stage-height',r.height+'px');camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderer.setSize(r.width,r.height,false);fitCamera();}).observe(stage);
    fitCamera(true);hairChoices();browChoices();outfitChoices();
    swatches($('#hair-swatches'),['#ff5d1c','#f5cc26','#a5d83d','#25b89a','#3587ed','#6147d4','#b546da','#ef68ae','#eeeeee','#222222'].map(x=>({id:x,color:x,name:x})),color=>change({color}));
    swatches($('#eye-swatches'),catalog.eyes.map((x,i)=>({...x,id:String(i)})),eye=>change({eye:Number(eye)}));sync();
    for(const input of document.querySelectorAll('.identity-options input'))input.addEventListener('change',()=>{if(input.checked)change({[input.name]:input.value});});
    $('#hair-color').addEventListener('input',e=>change({color:e.target.value}));
    $('#hair-hex').addEventListener('change',e=>{const v=e.target.value.trim();if(/^#[\da-f]{6}$/i.test(v)){e.target.setCustomValidity('');change({color:v});}else{e.target.setCustomValidity('请输入 # 加六位颜色值，例如 #ff5d1c');e.target.reportValidity();}});
    $('#hair-hex').addEventListener('input',e=>e.target.setCustomValidity(''));
    for(const tab of document.querySelectorAll('[role=tab]')){tab.addEventListener('click',()=>activateTab(tab));tab.addEventListener('keydown',e=>{const tabs=[...document.querySelectorAll('[role=tab]')];if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;activateTab(tabs[i]);tabs[i].focus();});}
    $('#reset-character').addEventListener('click',()=>{
      ++poseTicket;previewPose='rest';poseData=null;poseMenu?.reset();
      state=normalize(DEFAULTS,catalog);persist();hairChoices();browChoices();outfitChoices();sync();rebuild(true);
    });
    retry.addEventListener('click',()=>rebuild());
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();hasError=true;updateDownload();showStatus('三维预览已暂停，正在恢复…');});
    renderer.domElement.addEventListener('webglcontextrestored',()=>rebuild());
    async function downloadModel(format){
      if(download.disabled||downloadBlend.disabled)return;exporting=true;updateDownload();downloadStatus.textContent='正在打包模型与贴图…';
      const selected=model,selection={...model.state};
      try{
        const bytes=await exportCharacter(selected);
        const blob=format==='blend'
          ? await (await import('./customizer-blend.js')).blenderCharacter(bytes)
          : new Blob([bytes],{type:'model/gltf-binary'});
        const url=URL.createObjectURL(blob),a=document.createElement('a');
        const title=(gameKey==='spl3'?catalog.clothes:catalog.outfits).find(x=>x.id===selection.outfit).name;
        a.href=url;a.download=`${gameName}-${selection.species==='squid'?'鱿鱼':'章鱼'}-${selection.gender==='female'?'女':'男'}-${title}.${format}`;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
        downloadStatus.textContent=format==='blend'?'在 Blender 中打开文件，点击 ▶ 或按 Alt + P 载入搭配，然后保存。':`已生成 GLB · ${(bytes.byteLength/1024/1024).toFixed(1)} MB`;
      }catch(e){downloadStatus.textContent='下载未完成，请重新点击下载。';console.error(e);}
      finally{exporting=false;updateDownload();}
    }
    download.addEventListener('click',()=>downloadModel('glb'));
    downloadBlend.addEventListener('click',()=>downloadModel('blend'));
    await rebuild();
  }catch(e){showStatus(e.message?.includes('WebGL')?'当前浏览器无法开启三维预览，请开启硬件加速后刷新。':e.message||'页面加载失败，请刷新重试',true);retry.onclick=()=>location.reload();download.disabled=true;}
}
init();
