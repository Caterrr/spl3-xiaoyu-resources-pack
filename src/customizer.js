import * as THREE from './vendor/three/build/three.module.min.js';
import {OrbitControls} from './vendor/three/examples/jsm/controls/OrbitControls.js';
import {DEFAULTS,normalize,assemble,dispose,tint,setEye,exportCharacter} from './customizer-core.js?v=cdcdf13e8e2a';

const $=s=>document.querySelector(s),stage=$('#character-stage'),status=$('#stage-message'),overlay=$('#stage-status'),retry=$('#retry-character'),download=$('#download-character'),downloadStatus=$('#download-status');
let catalog,state,model,renderer,controls,camera,scene,requestId=0,exporting=false,loading=true,hasError=false;
const storageKey='raiders-character-v1';
function showStatus(message,error=false){status.textContent=message;overlay.hidden=!message;retry.hidden=!error;}
function updateDownload(){download.disabled=loading||exporting||hasError||!model;for(const el of document.querySelectorAll('.identity-fields,.editor-tabs,.editor-panel'))el.inert=exporting;$('#reset-character').disabled=exporting;}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{} }
function render(){if(renderer&&scene&&camera)renderer.render(scene,camera);}
function fitCamera(reset=false){
  if(!camera||!controls)return;
  const box=model?new THREE.Box3().setFromObject(model.character):new THREE.Box3(new THREE.Vector3(-1,0,-.4),new THREE.Vector3(1,2,.4));
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const direction=reset?new THREE.Vector3(.12,.08,1).normalize():camera.position.clone().sub(controls.target).normalize();
  const angle=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);
  const distance=Math.max(size.y/(2*angle),Math.max(size.x,size.z)/(2*angle*Math.max(.1,camera.aspect)))*1.16;
  controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance);controls.maxDistance=Math.max(7,distance*2);controls.update();render();
}
function resetCamera(){fitCamera(true);}
function selectedButtons(container,id){for(const b of container.querySelectorAll('button[data-id]'))b.setAttribute('aria-pressed',String(b.dataset.id===String(id)));}
function sync(){
  $('#species').value=state.species;$('#gender').value=state.gender;
  $('#hair-color').value=state.color;$('#hair-hex').value=state.color;
  selectedButtons($('#hair-choices'),state.hair);selectedButtons($('#outfit-choices'),state.outfit);
  selectedButtons($('#brow-choices'),state.brow);
  selectedButtons($('#hair-swatches'),state.color);selectedButtons($('#eye-swatches'),state.eye);
  $('#hair-notice').hidden=!catalog.outfits.find(x=>x.id===state.outfit).hideHair;
}
function choices(target,entries,onSelect){
  target.replaceChildren(...entries.map(entry=>{
    const button=document.createElement('button');button.type='button';button.className='choice-button';button.dataset.id=entry.id;button.setAttribute('aria-pressed', 'false');
    const img=document.createElement('img');img.src=entry.poster;img.alt='';img.loading='lazy';img.width=128;img.height=128;
    const label=document.createElement('span');label.textContent=entry.name;
    button.append(img,label);button.addEventListener('click',()=>onSelect(entry.id));return button;
  }));
}
function hairChoices(){choices($('#hair-choices'),catalog.hair.filter(x=>x.species===state.species),id=>change({hair:id}));}
function browChoices(){choices($('#brow-choices'),catalog.brows.filter(x=>x.species===state.species&&x.gender===state.gender).map(x=>({...x,id:String(x.style)})),id=>change({brow:Number(id)}));}
function outfitChoices(){const query=$('#outfit-search').value.trim().toLowerCase();const entries=catalog.outfits.filter(x=>x.name.toLowerCase().includes(query));choices($('#outfit-choices'),entries,id=>change({outfit:id}));$('#outfit-empty').hidden=entries.length>0;selectedButtons($('#outfit-choices'),state.outfit);}
function swatches(target,entries,onSelect){
  target.replaceChildren(...entries.map(e=>{const b=document.createElement('button');b.type='button';b.className='swatch';b.style.setProperty('--swatch',e.color);b.dataset.id=e.id;b.title=e.name;b.setAttribute('aria-label',e.name);b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>onSelect(e.id));return b;}));
}
async function rebuild(){
  const ticket=++requestId;loading=true;hasError=false;updateDownload();showStatus('加载搭配…');downloadStatus.textContent='';
  const requested={...state};
  try{
    const next=await assemble(catalog,requested);
    if(ticket!==requestId){dispose(next.character);return;}
    // Colour changes during a model load apply to the newest selected values.
    tint(next.tints,state.color);setEye(next,state.eye);next.state={...state};
    const previous=model;model=next;scene.add(model.character);if(previous){scene.remove(previous.character);dispose(previous.character);}
    showStatus('');loading=false;hasError=false;updateDownload();fitCamera(!previous);render();
  }catch(e){if(ticket!==requestId)return;loading=false;hasError=true;showStatus(e.message||'搭配加载失败，请重试',true);updateDownload();}
}
function change(patch){
  const previous={...state};state=normalize({...state,...patch},catalog);persist();
  if(previous.species!==state.species)hairChoices();
  if(previous.species!==state.species||previous.gender!==state.gender)browChoices();sync();
  if(['species','gender','hair','brow','outfit'].some(k=>state[k]!==previous[k])){rebuild();return;}
  if(model&&!loading&&!hasError){if(previous.color!==state.color)tint(model.tints,state.color);if(previous.eye!==state.eye)setEye(model,state.eye);model.state={...state};render();}
}
function activateTab(tab){
  for(const button of document.querySelectorAll('[role=tab]')){const active=button===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$('#'+button.getAttribute('aria-controls')).hidden=!active;}
}
async function init(){
  try{
    const response=await fetch('./catalog/raiders/customizer.json?v=4ede3dcc607e');if(!response.ok)throw Error('搭配目录加载失败');catalog=await response.json();
    let saved;try{saved=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
    state=normalize(saved||DEFAULTS,catalog);
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.LinearToneMapping;renderer.toneMappingExposure=1;
    renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','角色三维预览，拖动旋转、滚轮或双指缩放，也可使用方向键平移');stage.prepend(renderer.domElement);
    scene=new THREE.Scene();scene.background=new THREE.Color('#171717');camera=new THREE.PerspectiveCamera(34,1,.01,100);
    scene.add(new THREE.HemisphereLight(0xffffff,0x6f737e,2.6));const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(3,5,5);scene.add(key);const fill=new THREE.DirectionalLight(0xaabfff,1.2);fill.position.set(-3,2,-3);scene.add(fill);
    controls=new OrbitControls(camera,renderer.domElement);controls.minDistance=.7;controls.maxDistance=7;controls.maxPolarAngle=Math.PI*.95;controls.enablePan=true;controls.addEventListener('change',render);controls.listenToKeyEvents(renderer.domElement);
    new ResizeObserver(()=>{const r=stage.getBoundingClientRect();camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderer.setSize(r.width,r.height,false);fitCamera();}).observe(stage);
    resetCamera();hairChoices();browChoices();outfitChoices();
    swatches($('#hair-swatches'),['#ff5d1c','#f5cc26','#a5d83d','#25b89a','#3587ed','#6147d4','#b546da','#ef68ae','#eeeeee','#222222'].map(x=>({id:x,color:x,name:x})),color=>change({color}));
    swatches($('#eye-swatches'),catalog.eyes.map((x,i)=>({...x,id:String(i)})),eye=>change({eye:Number(eye)}));sync();
    $('#species').addEventListener('change',e=>change({species:e.target.value}));$('#gender').addEventListener('change',e=>change({gender:e.target.value}));
    $('#outfit-search').addEventListener('input',outfitChoices);
    $('#hair-color').addEventListener('input',e=>change({color:e.target.value}));
    $('#hair-hex').addEventListener('change',e=>{const v=e.target.value.trim();if(/^#[\da-f]{6}$/i.test(v)){e.target.setCustomValidity('');change({color:v});}else{e.target.setCustomValidity('请输入 # 加六位颜色值，例如 #ff5d1c');e.target.reportValidity();}});
    $('#hair-hex').addEventListener('input',e=>e.target.setCustomValidity(''));
    for(const tab of document.querySelectorAll('[role=tab]')){tab.addEventListener('click',()=>activateTab(tab));tab.addEventListener('keydown',e=>{const tabs=[...document.querySelectorAll('[role=tab]')];if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;activateTab(tabs[i]);tabs[i].focus();});}
    $('#reset-view').addEventListener('click',resetCamera);
    $('#reset-character').addEventListener('click',()=>{state=normalize(DEFAULTS,catalog);persist();hairChoices();browChoices();$('#outfit-search').value='';outfitChoices();sync();resetCamera();rebuild();});
    retry.addEventListener('click',rebuild);
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();hasError=true;updateDownload();showStatus('三维预览已暂停，正在恢复…');});
    renderer.domElement.addEventListener('webglcontextrestored',()=>rebuild());
    download.addEventListener('click',async()=>{
      if(download.disabled)return;exporting=true;updateDownload();downloadStatus.textContent='正在打包模型与贴图…';
      const selected=model,selection={...model.state};
      try{
        const bytes=await exportCharacter(selected),blob=new Blob([bytes],{type:'model/gltf-binary'}),url=URL.createObjectURL(blob),a=document.createElement('a');
        const title=catalog.outfits.find(x=>x.id===selection.outfit).name;
        a.href=url;a.download=`涂击队-${selection.species==='squid'?'墨灵':'章鱼'}-${selection.gender==='female'?'女':'男'}-${title}.glb`;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
        downloadStatus.textContent=`已生成 GLB · ${(bytes.byteLength/1024/1024).toFixed(1)} MB`;
      }catch(e){downloadStatus.textContent='下载未完成，请重新点击下载。';console.error(e);}
      finally{exporting=false;updateDownload();}
    });
    await rebuild();
  }catch(e){showStatus(e.message?.includes('WebGL')?'当前浏览器无法开启三维预览，请开启硬件加速后刷新。':e.message||'页面加载失败，请刷新重试',true);retry.onclick=()=>location.reload();download.disabled=true;}
}
init();
