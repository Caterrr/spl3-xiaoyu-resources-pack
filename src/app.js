const resourceBase=document.querySelector('meta[name=resource-base]')?.content||'';
const resourceUrl=path=>new URL(path,resourceBase||location.href).href;
const game=window.libraryGame;
const links=[...document.querySelectorAll('.navigation a[data-section]')].filter(link=>link.dataset.game===game.key);
const content=document.querySelector('#content');
const catalogs=new Map();
let renderVersion=0;
let pageObserver;
const fileRuntime=import('./model-files.js?v=a8179dcb47a1');
const modelDownloads=new Map();
const modelDialog=document.querySelector('#model-dialog');
const modelStage=document.querySelector('#model-stage');
const modelStatus=document.querySelector('#model-status');
const modelProgress=document.querySelector('#model-progress');
const modelVariant=document.querySelector('#model-variant');
const modelVariantControl=document.querySelector('#model-variant-control');
const modelBackground=document.querySelector('#model-background');
let backgroundMaterials=[];
function setBackgroundMaterial({material,color,mode},visible){
 material.setAlphaMode(visible?mode:'BLEND');
 material.pbrMetallicRoughness.setBaseColorFactor(visible?color:[...color.slice(0,3),0]);
}
function setModelBackground(visible){
 for(const row of backgroundMaterials)setBackgroundMaterial(row,visible);
 modelBackground.setAttribute('aria-pressed',String(visible));
 modelBackground.title=visible?'隐藏背景':'显示背景';
}
modelBackground.addEventListener('click',()=>setModelBackground(modelBackground.getAttribute('aria-pressed')!=='true'));
let modelTrigger,activeItem,activeGroup,modelRuntime,modelVersion=0,modelAbort,modelBlob,modelObjectUrl,analyticsPreview;
const metric=(method,...args)=>{try{return window.Spl3Metrics?.[method](...args);}catch{}};
const runtime=()=>modelRuntime??=import('./vendor/model-viewer.min.js').catch(error=>{modelRuntime=undefined;throw error;});
const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
let warmupScheduled=false;
function warmupViewer(){
 if(warmupScheduled||navigator.connection?.saveData||/^(slow-)?2g$/.test(navigator.connection?.effectiveType||''))return;
 warmupScheduled=true;
 const warm=()=>{if(!document.hidden&&!modelDialog.open)runtime().catch(()=>{});};
 if('requestIdleCallback'in window)requestIdleCallback(warm,{timeout:5000});else setTimeout(warm,1800);
}

function size(bytes){return bytes>=1073741824?(bytes/1073741824).toFixed(1)+' GB':bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.ceil(bytes/1024)+' KB';}
async function loadModel(item){
 const version=++modelVersion;
 analyticsPreview?.cancel();
 const attempt=analyticsPreview=metric('previewStart',item,game.key+':'+(links.find(link=>link.getAttribute('aria-current')==='page')?.dataset.section||game.defaultSection));
 modelAbort?.abort();modelAbort=new AbortController();
 const signal=modelAbort.signal;
 if(modelObjectUrl)URL.revokeObjectURL(modelObjectUrl);
 modelBlob=modelObjectUrl=undefined;
 modelStage.replaceChildren();
 backgroundMaterials=[];modelBackground.hidden=true;
 modelDialog.dataset.state='loading';
 modelStatus.textContent='加载模型…';
 modelProgress.style.setProperty('--progress',0);
 modelProgress.setAttribute('aria-valuenow','0');
 try{
  await nextPaint();
  if(signal.aborted||version!==modelVersion||!modelDialog.open)return;
  let lastProgress=-1;
  const [,blob]=await Promise.all([runtime(),fileRuntime.then(({loadModelFile})=>loadModelFile(item,'glb',{signal,onProgress:fraction=>{
   if(version!==modelVersion)return;
   const progress=Math.round(fraction*70);if(progress===lastProgress)return;lastProgress=progress;modelProgress.style.setProperty('--progress',progress/100);modelProgress.setAttribute('aria-valuenow',String(progress));modelStatus.textContent='加载模型 '+progress+'%';
  }}))]);
  if(version!==modelVersion||!modelDialog.open)return;
  modelBlob=blob;modelObjectUrl=URL.createObjectURL(blob);
  customElements.get('model-viewer').modelCacheSize=0;
  const viewer=document.createElement('model-viewer');
  viewer.setAttribute('alt',item.name+'，可拖动旋转和缩放的三维模型');
  viewer.setAttribute('camera-controls','');
  viewer.setAttribute('touch-action','none');
  viewer.setAttribute('interaction-prompt','none');
  viewer.setAttribute('camera-orbit',item.previewCamera?.orbit||'35deg 70deg 105%');
  viewer.setAttribute('min-camera-orbit',item.previewCamera?.minOrbit||'auto 0deg 40%');
  viewer.setAttribute('max-camera-orbit',item.previewCamera?.maxOrbit||'auto 180deg 600%');
  if(item.previewCamera?.target)viewer.setAttribute('camera-target',item.previewCamera.target);
  if(item.previewCamera){
   viewer.setAttribute('max-field-of-view','45deg');
   viewer.setAttribute('field-of-view','45deg');
  }
  viewer.setAttribute('environment-image','./assets/studio-neutral.hdr');
  viewer.setAttribute('tone-mapping','neutral');
  viewer.setAttribute('exposure','0.85');
  viewer.setAttribute('shadow-intensity','0.55');
  viewer.setAttribute('shadow-softness','0.75');
  viewer.setAttribute('loading','eager');
  viewer.setAttribute('poster',resourceUrl(item.poster));
  viewer.addEventListener('progress',event=>{
   if(version!==modelVersion||modelDialog.dataset.state==='ready')return;
   const progress=70+Math.round(event.detail.totalProgress*30);
   modelProgress.style.setProperty('--progress',progress/100);
   modelProgress.setAttribute('aria-valuenow',String(progress));
   modelStatus.textContent=progress<100?'加载模型 '+progress+'%':'准备预览…';
  });
  viewer.addEventListener('model-visibility',event=>{if(version===modelVersion&&modelDialog.open&&event.detail.visible)attempt?.ready();});
  viewer.addEventListener('load',()=>{if(version===modelVersion){
   backgroundMaterials=(viewer.model?.materials||[]).filter(material=>(item.previewHideMaterialPrefixes||[]).some(prefix=>material.name.startsWith(prefix))).map(material=>({material,color:[...material.pbrMetallicRoughness.baseColorFactor],mode:material.getAlphaMode()}));
   modelBackground.hidden=!backgroundMaterials.length;
   if(backgroundMaterials.length){
    const prefixes=item.previewHiddenMaterialPrefixes||(item.previewBackgroundVisible?[]:item.previewHideMaterialPrefixes||[]);
    let allVisible=true;
    for(const row of backgroundMaterials){const visible=!prefixes.some(prefix=>row.material.name.startsWith(prefix));setBackgroundMaterial(row,visible);allVisible&&=visible;}
    modelBackground.setAttribute('aria-pressed',String(allVisible));modelBackground.title=allVisible?'隐藏背景':'显示背景';
   }
   modelDialog.dataset.state='ready';modelStatus.textContent='';
   window.modelMotion?.ready();
   requestAnimationFrame(()=>requestAnimationFrame(()=>{if(version===modelVersion&&modelDialog.open&&viewer.modelIsVisible)attempt?.ready();}));
  }});
  viewer.addEventListener('error',()=>{if(version===modelVersion){attempt?.error('viewer');showModelError();}});
  viewer.src=modelObjectUrl;
  modelStage.append(viewer);
 }catch(error){if(version===modelVersion&&error.name!=='AbortError'){attempt?.error('load');showModelError();}}
}
function showModelError(){
 window.modelMotion?.ready();
 modelDialog.dataset.state='error';
 modelStatus.textContent='预览暂时无法加载，仍可下载模型';
}
function openModel(item,trigger){
 modelTrigger=trigger;activeGroup=item;
 modelVariant.replaceChildren();
 modelVariantControl.hidden=!item.mapVariants?.length;
 for(const variant of item.mapVariants||[]){
  const option=document.createElement('option');option.value=variant.item.id;option.textContent=variant.label;modelVariant.append(option);
 }
 if(item.mapVariants?.length)modelVariant.value=item.mapDefaultVariantId;
 const show=()=>{modelDialog.showModal();document.body.classList.add('model-open');selectModelVariant();};
 if(window.modelMotion)window.modelMotion.open(trigger,show);else show();
}
function selectModelVariant(){
 const item=activeGroup.mapVariants?.find(variant=>variant.item.id===modelVariant.value)?.item||activeGroup;
 activeItem=item;
 document.querySelector('#model-title').textContent=activeGroup.name;
 for(const format of ['blend','glb']){
  const link=document.querySelector('#download-'+format);link.dataset.downloadKey=item.id+':'+format;link.removeAttribute('aria-busy');
  const downloadResource=resourceUrl(item[format]);
  link.href=downloadResource+(downloadResource.includes('?')?'&':'?')+'download='+encodeURIComponent(item.id+'.'+format);link.download=item.id+'.'+format;
  link.onclick=event=>{
   event.preventDefault();
   if(format==='glb'&&activeItem?.id===item.id&&modelBlob){const blob=modelBlob;const download=metric('downloadClick',item,format,analyticsPreview);fileRuntime.then(({saveModelFile})=>{saveModelFile(blob,item.id+'.glb');download?.ready();}).catch(()=>download?.error('save'));}
   else downloadModel(item,format,link);
  };
  document.querySelector('#download-'+format+'-size').textContent=size(item[format+'Bytes']);
 }
 const note=document.querySelector('#model-note');
 note.textContent=[item.layoutNote,item.notes].filter(Boolean).join(' ');note.hidden=!note.textContent;
 loadModel(item);
}
modelVariant.addEventListener('change',selectModelVariant);
async function downloadModel(item,format,link){
 const key=item.id+':'+format;if(modelDownloads.has(key))return;
 const download=metric('downloadClick',item,format,analyticsPreview);
 const label=document.querySelector('#download-'+format+'-size');
 const update=text=>{if(link.dataset.downloadKey===key)label.textContent=text;};
 const task=(async()=>{
  link.setAttribute('aria-busy','true');update('准备下载');
  try{const {loadModelFile,saveModelFile}=await fileRuntime;const blob=await loadModelFile(item,format,{onProgress:p=>update(Math.round(p*100)+'%')});saveModelFile(blob,item.id+'.'+format);download?.ready();update(size(item[format+'Bytes']));}
  catch(error){download?.error('fetch');update('下载失败，重试');}
  finally{modelDownloads.delete(key);if(link.dataset.downloadKey===key)link.removeAttribute('aria-busy');}
 })();modelDownloads.set(key,task);
}
async function renderSection(){
 const version=++renderVersion;
 pageObserver?.disconnect();pageObserver=undefined;
 const requested=new URL(location.href).searchParams.get('section');
 const active=links.find(link=>link.dataset.section===requested)||links.find(link=>link.dataset.section===game.defaultSection)||links[0];
 for(const link of links){if(link===active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
 content.setAttribute('aria-label',active.textContent);document.title=active.textContent+' · '+game.name+'模型库';
 content.replaceChildren();
 const status=document.createElement('p');status.className='library-status';status.setAttribute('role','status');status.textContent='加载中';content.append(status);
 try{
  const section=active.dataset.section;
  if(!catalogs.has(section)){
   const early=window.libraryCatalogRequest;
   const data=early?.game===game.key&&early.section===section?await early.promise:await fetch(window.libraryCatalogUrls?.[game.key+':'+section]||'./catalog/'+game.key+'/'+section+'.json?v=production-20261103').then(response=>{if(!response.ok)throw Error(response.status);return response.json();});
   catalogs.set(section,data);
  }
  if(version!==renderVersion)return;
  const data=catalogs.get(section), items=data.items;status.remove();
  const gallery=document.createElement('div');gallery.className='model-list';gallery.setAttribute('role','list');content.append(gallery);
  const sentinel=document.createElement('div');sentinel.className='load-sentinel';sentinel.setAttribute('aria-hidden','true');
  let cursor=0;
  const columns=innerWidth>=1440?7:innerWidth>=1280?6:innerWidth>=1080?5:innerWidth>=760?4:innerWidth>=600?3:2;
  const eagerCount=columns*Math.max(1,Math.ceil((innerHeight-120)/((innerWidth-60)/columns+28)));
  function addPage(){
   if(version!==renderVersion||cursor>=items.length)return;
   const fragment=document.createDocumentFragment();
   for(const item of items.slice(cursor,cursor+60)){
    const entry=document.createElement('div');entry.className='model-entry';entry.setAttribute('role','listitem');
    const button=document.createElement('button');button.type='button';button.className='model-card';button.setAttribute('aria-label','预览 '+item.name);button.title=item.name;button.setAttribute('aria-haspopup','dialog');
    const image=document.createElement('img');image.alt=item.name;image.loading=cursor+fragment.childElementCount<eagerCount?'eager':'lazy';image.decoding='async';image.width=360;image.height=360;image.fetchPriority=cursor+fragment.childElementCount<2?'high':'auto';image.src=resourceUrl(item.poster);
    button.append(image);button.addEventListener('click',()=>openModel(item,button));
    if(item.notes){const flag=document.createElement('span');flag.className='model-note';flag.textContent='i';flag.setAttribute('aria-label',item.notes);flag.title=item.notes;button.append(flag);}
    entry.append(button);fragment.append(entry);
   }
   cursor=Math.min(cursor+60,items.length);gallery.append(fragment);
   if(cursor>=items.length){pageObserver?.disconnect();sentinel.remove();}
  }
  if(!items.length){status.textContent=game.emptyMessage||'暂无模型';content.append(status);}else{
   addPage();
   Promise.all([...gallery.querySelectorAll('img[loading="eager"]')].map(image=>image.decode().catch(()=>{}))).then(()=>requestAnimationFrame(warmupViewer));
   if(cursor<items.length){
    content.append(sentinel);
    if('IntersectionObserver'in window){pageObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))addPage();},{rootMargin:'800px 0px'});pageObserver.observe(sentinel);}
    else while(cursor<items.length)addPage();
   }
  }
 }catch(error){if(version===renderVersion)status.textContent='暂时无法加载，请刷新重试';}
}
const closeModel=()=>window.modelMotion?window.modelMotion.close():modelDialog.close();
document.querySelector('#model-close').addEventListener('click',closeModel);
modelDialog.addEventListener('cancel',event=>{event.preventDefault();closeModel();});
document.querySelector('#model-retry').addEventListener('click',()=>{if(activeItem)loadModel(activeItem);});
modelDialog.addEventListener('close',()=>{
 window.modelMotion?.cleanup();
 analyticsPreview?.cancel();analyticsPreview=undefined;
 ++modelVersion;
 modelAbort?.abort();modelAbort=undefined;
 const viewer=modelStage.querySelector('model-viewer');if(viewer)viewer.removeAttribute('src');
 modelStage.replaceChildren();activeItem=activeGroup=undefined;
 modelBlob=undefined;if(modelObjectUrl)URL.revokeObjectURL(modelObjectUrl);modelObjectUrl=undefined;
 document.body.classList.remove('model-open');
 modelTrigger?.focus({preventScroll:true});
});
for(const link of links){
  link.addEventListener('click',event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    if(location.href===link.href)return;
    history.pushState(null,'',link.href);
    window.changeLibrarySection(async()=>{window.scrollTo(0,0);await renderSection();});
  });
}
window.addEventListener('popstate',()=>{if(modelDialog.open)modelDialog.close();window.changeLibrarySection(renderSection);});
renderSection();

const socialDialog=document.querySelector('#social-dialog');
let socialTrigger;
for(const button of document.querySelectorAll('.social-links button')){
  button.addEventListener('click',()=>{
    socialTrigger=button;
    document.querySelector('#social-title').textContent=button.dataset.platform;
    const image=document.querySelector('#social-qr-image');
    const frame=document.querySelector('#social-qr-frame');
    const status=document.querySelector('#social-pending');
    const source=button.dataset.qrImage;
    frame.hidden=true;
    status.hidden=false;
    status.textContent=source?'加载中':'二维码待添加';
    if(source){
      image.alt=button.dataset.platform+'二维码原图';
      frame.href=source;
      frame.setAttribute('aria-label','查看'+button.dataset.platform+'完整原图，在新标签页打开');
      frame.title='查看原图';
      image.onload=()=>{
        frame.hidden=false;
        status.hidden=true;
      };
      image.onerror=()=>{status.textContent='二维码暂时无法显示';};
      image.src=source;
    } else image.removeAttribute('src');
    socialDialog.showModal();
  });
}
document.querySelector('#social-close').addEventListener('click',()=>socialDialog.close());
socialDialog.addEventListener('click',event=>{
  if(event.target!==socialDialog)return;
  const box=socialDialog.getBoundingClientRect();
  if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)socialDialog.close();
});
socialDialog.addEventListener('close',()=>socialTrigger?.focus({preventScroll:true}));
