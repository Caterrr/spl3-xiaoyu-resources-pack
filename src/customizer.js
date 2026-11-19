import * as THREE from './vendor/three/build/three.module.min.js';
import {OrbitControls} from './vendor/three/examples/jsm/controls/OrbitControls.js';
import {setupPosePanel} from './customizer-pose-menu.js?v=a9f289512a99';
const gameKey=new URLSearchParams(location.search).get('game')==='spl3'?'spl3':'raiders';
const gameName=gameKey==='spl3'?'喷3':'涂击队';
const profiles={raiders:{catalog:'./catalog/raiders/customizer.json?v=afa33936a92f',core:'./customizer-core.js?v=d0730188e677'},spl3:{catalog:'./catalog/spl3/customizer.json?v=c662621acc70',core:'./customizer-spl3-core.js?v=820db583589c'}};
let DEFAULTS,normalize,assemble,dispose,tint,setEye,exportCharacter,supports,headgearAvailable,wearFlags;

const $=s=>document.querySelector(s),stage=$('#character-stage'),status=$('#stage-message'),overlay=$('#stage-status'),retry=$('#retry-character'),download=$('#download-character'),downloadStatus=$('#download-status');
let catalog,state,model,renderer,controls,camera,scene,requestId=0,exporting=false,loading=true,hasError=false;
const storageKey=gameKey+'-character-v1';
let previewPose='rest',poseData=null,poseTicket=0,poseFrame=0,poseMenu,loadPreviewPose,setPreviewPose;
let wearKind='clothes';
const wearKey=()=>({clothes:'outfit',bottoms:'bottom'})[wearKind]||wearKind;
function showStatus(message,error=false){status.textContent=message;overlay.hidden=!message;retry.hidden=!error;}
const downloadBlend=$('#download-blend'),downloadVRM=$('#download-vrm'),dice=$('#randomize-character');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function rollDiceIcon() {
  const icon = dice.querySelector('svg');
  for (const previous of icon.getAnimations()) {
    previous.onfinish = null;
    previous.cancel();
  }
  const faces = [1, 2, 3, 4, 5, 6].filter(face => face !== Number(icon.dataset.face));
  const next = String(faces[Math.floor(Math.random() * faces.length)]);
  function land() {
    icon.dataset.face = next;
    for (const pip of icon.querySelectorAll('circle')) {
      pip.setAttribute('visibility', pip.dataset.faces.includes(next) ? 'visible' : 'hidden');
    }
  }
  if (reducedMotion.matches) {
    land();
    return;
  }
  const roll = icon.animate([
    {transform: 'rotate(0deg)'},
    {transform: 'rotate(-12deg)', offset: 0.25},
    {transform: 'rotate(16deg)', offset: 0.6},
    {transform: 'rotate(0deg)'}
  ], {duration: 300, easing: 'ease-in-out'});
  roll.onfinish = land;
}
function updateDownload(){dice.disabled=downloadVRM.disabled=downloadBlend.disabled=download.disabled=loading||exporting||hasError||!model;for(const el of document.querySelectorAll('.editor-toolbar,.editor-panel'))el.inert=exporting;$('#reset-character').disabled=exporting;}
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
async function choosePose(id,reveal=false){
  const ticket=++poseTicket;
  poseMenu.select(id,reveal);
  try{
    const data=await loadPreviewPose(id);
    if(ticket!==poseTicket)return;
    previewPose=id;poseData=data;
    if(model&&!loading&&!hasError)transitionToPose();
  }catch(error){
    if(ticket!==poseTicket)return;
    poseMenu.select(previewPose,reveal);downloadStatus.textContent='姿势加载失败，请重新选择。';
  }
}
function selectedButtons(container,id){for(const b of container.querySelectorAll('button[data-id]'))b.setAttribute('aria-pressed',String(b.dataset.id===String(id)));}
function sync(){
  for(const input of document.querySelectorAll('.identity-options input'))input.checked=input.value===state[input.name];
  $('#identity-value').textContent = [state.species === 'octopus' ? '章鱼' : '鱿鱼', state.gender === 'male' ? '男' : '女'].join(' · ');
  $('#hair-color').value=state.color;$('#hair-hex').value=state.color;
  selectedButtons($('#hair-choices'),state.hair);selectedButtons($('#outfit-choices'),state[wearKey()]);
  selectedButtons($('#brow-choices'),state.brow);
  selectedButtons($('#hair-swatches'),state.color);selectedButtons($('#eye-swatches'),state.eye);
  if(gameKey==='spl3'){
    const flags=wearFlags(catalog,state);
    const blocked=wearKind==='shoes'&&flags.integratedShoes?'这套衣服自带鞋子，换下后恢复所选鞋子。'
      :wearKind==='bottoms'&&flags.hidePants?'这套衣服自带下装，换下后恢复所选裤子。':'';
    $('#wear-notice').textContent=blocked;
    $('#wear-notice').hidden=!blocked;
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
  else if(wearKind==='headgear')entries=catalog.headgear.filter(entry=>headgearAvailable(entry,state));
  else entries=catalog[wearKind].filter(entry=>supports(entry,state.gender));
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
  if(tab.id==='tab-pose')poseMenu.showSelected();
}
async function init(){
  try{
    document.documentElement.dataset.game=gameKey;document.title='奇迹鱿鱿 · '+gameName;
    const core=await import(profiles[gameKey].core);
    ({DEFAULTS,normalize,assemble,dispose,tint,setEye,exportCharacter,supports,headgearAvailable,wearFlags,setPreviewPose,loadPreviewPose}=core);
    if(setPreviewPose){
      const poses=core.previewPoses;
      poseMenu=setupPosePanel($('#panel-pose'),poses,choosePose);
      $('#tab-pose').hidden=false;
      if(poses.length>0){
        dice.hidden=false;
        dice.addEventListener('click',()=>{
          const choices=poses.filter(pose=>pose.id!==previewPose);
          if (choices.length) {
            choosePose(choices[Math.floor(Math.random() * choices.length)].id, true);
            rollDiceIcon();
          }
        });
      }
    }
    const response=await fetch(profiles[gameKey].catalog);if(!response.ok)throw Error('搭配目录加载失败');catalog=await response.json();
    if(gameKey==='spl3'&&catalog.game!=='spl3'||catalog.game&&catalog.game!==gameKey)throw Error('搭配目录不匹配，请刷新重试');
    $('#wear-categories').hidden=gameKey!=='spl3';
    const wearTabs = document.querySelectorAll('#wear-categories button');
    for (const button of wearTabs) button.addEventListener('click', () => {
      if (wearKind === button.dataset.kind) return;
      wearKind = button.dataset.kind;
      for (const tab of wearTabs) tab.setAttribute('aria-pressed', String(tab === button));
      outfitChoices();
      $('.outfit-scroll').scrollTop = 0;
    });
    let saved;try{saved=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
    state=normalize(saved||DEFAULTS,catalog);
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.LinearToneMapping;renderer.toneMappingExposure=1;
    renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','角色三维预览，拖动旋转、滚轮或双指缩放，也可使用方向键平移');stage.prepend(renderer.domElement);
    scene=new THREE.Scene();scene.background=new THREE.Color('#171717');camera=new THREE.PerspectiveCamera(34,1,.01,100);
    scene.add(new THREE.HemisphereLight(0xffffff,0x6f737e,2.6));const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(3,5,5);scene.add(key);const fill=new THREE.DirectionalLight(0xaabfff,1.2);fill.position.set(-3,2,-3);scene.add(fill);
    controls=new OrbitControls(camera,renderer.domElement);controls.minDistance=.7;controls.maxDistance=7;controls.maxPolarAngle=Math.PI*.95;controls.enablePan=true;controls.addEventListener('change',render);controls.listenToKeyEvents(renderer.domElement);
    controls.addEventListener('start',()=>{if(poseFrame){cancelPoseMotion();setPreviewPose(model,poseData);render();}});
    new ResizeObserver(()=>{const r=stage.getBoundingClientRect();camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderer.setSize(r.width,r.height,false);fitCamera();}).observe(stage);
    fitCamera(true);hairChoices();browChoices();outfitChoices();
    swatches($('#hair-swatches'),['#ff5d1c','#f5cc26','#a5d83d','#25b89a','#3587ed','#6147d4','#b546da','#ef68ae','#eeeeee','#222222'].map(x=>({id:x,color:x,name:x})),color=>change({color}));
    swatches($('#eye-swatches'),catalog.eyes.map((x,i)=>({...x,id:String(i)})),eye=>change({eye:Number(eye)}));sync();
    for(const input of document.querySelectorAll('.identity-options input'))input.addEventListener('change',()=>{if(input.checked)change({[input.name]:input.value});});
    $('#hair-color').addEventListener('input',e=>change({color:e.target.value}));
    $('#hair-hex').addEventListener('change',e=>{const v=e.target.value.trim();if(/^#[\da-f]{6}$/i.test(v)){e.target.setCustomValidity('');change({color:v});}else{e.target.setCustomValidity('请输入 # 加六位颜色值，例如 #ff5d1c');e.target.reportValidity();}});
    $('#hair-hex').addEventListener('input',e=>e.target.setCustomValidity(''));
    const tabs=[...$('.editor-tabs').querySelectorAll('[role=tab]:not([hidden])')];
    const initialTab = tabs.find(tab => tab.id === 'tab-' + new URLSearchParams(location.search).get('tab'));
    if (initialTab) activateTab(initialTab);
    for(const [index,tab] of tabs.entries()){
      tab.addEventListener('click',()=>activateTab(tab));
      tab.addEventListener('keydown',event=>{
        const next={ArrowLeft:(index+tabs.length-1)%tabs.length,ArrowRight:(index+1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
        if(next===undefined)return;
        event.preventDefault();activateTab(tabs[next]);tabs[next].focus();
      });
    }
    $('#reset-character').addEventListener('click',event=>{
      if (!reducedMotion.matches) {
        const label = event.currentTarget.querySelector('span');
        for (const previous of label.getAnimations()) previous.cancel();
        label.animate([{transform: 'var(--pressed-transform)'}, {transform: 'none'}],
          {duration: 180, easing: 'ease-out'});
      }
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
        const outfit=(gameKey==='spl3'?catalog.clothes:catalog.outfits).find(x=>x.id===selection.outfit).name;
        const title=`${gameName}-${selection.species==='squid'?'鱿鱼':'章鱼'}-${selection.gender==='female'?'女':'男'}-${outfit}`;
        let blob;
        if(format==='vrm'){
          const {exportVRM}=await import('./customizer-vrm.js?v=4dd990facd12');
          blob=await exportVRM(selected,title);
        }else{
          const bytes=await exportCharacter(selected);
          blob=format==='blend' ? await (await import('./customizer-blend.js')).blenderCharacter(bytes)
            : new Blob([bytes],{type:'model/gltf-binary'});
        }
        const url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download=`${title}.${format}`;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
        downloadStatus.textContent=format==='blend'?'在 Blender 中打开文件，点击 ▶ 或按 Alt + P 载入搭配，然后保存。':`已生成 ${format.toUpperCase()} · ${(blob.size/1024/1024).toFixed(1)} MB`;
      }catch(e){downloadStatus.textContent='下载未完成，请重新点击下载。';console.error(e);}
      finally{exporting=false;updateDownload();}
    }
    download.addEventListener('click',()=>downloadModel('glb'));
    downloadVRM.addEventListener('click',()=>downloadModel('vrm'));
    downloadBlend.addEventListener('click',()=>downloadModel('blend'));
    await rebuild();
  }catch(e){showStatus(e.message?.includes('WebGL')?'当前浏览器无法开启三维预览，请开启硬件加速后刷新。':e.message||'页面加载失败，请刷新重试',true);retry.onclick=()=>location.reload();download.disabled=true;}
}
init();
