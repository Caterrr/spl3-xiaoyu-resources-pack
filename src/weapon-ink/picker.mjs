let profiles;
function getProfiles() {
  return profiles??=fetch(new URL('./materials.json?v=9a6209640033',import.meta.url)).then(r=>{
    if(!r.ok) throw Error('Ink profiles unavailable');
    return r.json();
  }).catch(error=>{profiles=undefined;throw error;});
}
function createWorker() {
  const worker=new Worker(new URL('./worker.mjs?v=ink-live-1',import.meta.url),{type:'module'});
  const pending=new Map();let seq=0,failed;
  function rejectAll(error) {
    for(const job of pending.values())job.reject(error);
    pending.clear();
  }
  worker.onmessage=({data})=>{
    const job=pending.get(data.id);if(!job)return;
    pending.delete(data.id);
    if(data.error)job.reject(Error(data.error));else job.resolve(data.result);
  };
  worker.onerror=()=>{failed=Error('Ink worker failed');rejectAll(failed);};
  return {
    request(type,data) {
      if(failed)return Promise.reject(failed);
      const id=++seq;
      return new Promise((resolve,reject)=>{
        pending.set(id,{resolve,reject});worker.postMessage({type,id,...data});
      });
    },
    close(){worker.terminate();rejectAll(new DOMException('Cancelled','AbortError'));}
  };
}
// Update only the colour textures so the same scene and camera remain interactive.
function liveMaterials(viewer) {
  const slots=new Map();
  function slotFor(index) {
    if(slots.has(index))return slots.get(index);
    const pbr=viewer.model.materials[index].pbrMetallicRoughness;
    const original=pbr.baseColorTexture.texture, texture=viewer.createCanvasTexture();
    if(original) {
      const sampler=original.sampler;
      texture.sampler.setMinFilter(sampler.minFilter);
      texture.sampler.setMagFilter(sampler.magFilter);
      texture.sampler.setWrapS(sampler.wrapS);
      texture.sampler.setWrapT(sampler.wrapT);
    }
    const canvas=texture.source.element,context=canvas.getContext('2d');
    const slot={pbr,original,factor:pbr.baseColorFactor,texture,canvas,context,active:false};
    slots.set(index,slot);
    return slot;
  }
  return {
    show(surfaces) {
      for(const {width,height,rgba,materials,paint} of surfaces) {
        const image=new ImageData(rgba,width,height);
        for(const index of materials) {
          const slot=slotFor(index);
          if(slot.canvas.width!==width)slot.canvas.width=width;
          if(slot.canvas.height!==height)slot.canvas.height=height;
          slot.context.putImageData(image,0,0);
          if(!slot.active) {
            slot.pbr.baseColorTexture.setTexture(slot.texture);
            if(paint) {
              slot.texture.sampler.setScale({u:1,v:1});
              slot.texture.sampler.setOffset({u:0,v:0});
              slot.texture.sampler.setRotation(0);
              slot.pbr.setBaseColorFactor([1,1,1,slot.factor[3]]);
            }
            slot.active=true;
          }
          slot.texture.source.update();
        }
      }
    },
    restore() {
      for(const slot of slots.values())if(slot.active) {
        slot.pbr.baseColorTexture.setTexture(slot.original);
        slot.pbr.setBaseColorFactor(slot.factor);
        slot.active=false;
      }
    }
  };
}

const palette=[
  ['橙','#ff5d1c'],['黄','#f5cc26'],['黄绿','#a5d83d'],['青绿','#25b89a'],['蓝','#3587ed'],
  ['靛紫','#6147d4'],['紫','#b546da'],['粉','#ef68ae'],['白','#eeeeee'],['黑','#222222']
];
const originalChip='#ff5d1c';
export async function enableInk({item,signal,original,links,loadBlend,viewer,size,ready}) {
  const profile=(await getProfiles())[item.id];
  if(signal.aborted || !profile || profile.glb!==item.glbSha256 || profile.blend!==item.blendSha256)return;
  const box=document.querySelector('#weapon-ink'), swatches=box.querySelector('.ink-swatches');
  const summary=box.querySelector('summary'),custom=box.querySelector('[type=color]');
  const field=box.querySelector('[type=text]'),reset=box.querySelector('.ink-reset'),status=box.querySelector('[role=status]');
  const defaults=Object.fromEntries(Object.entries(links).map(([format,link])=>[format,link.href]));
  const preview=liveMaterials(viewer);
  let requested='',applied='',active=false,revision=0,worker,initialized,statusTimer;
  let scrubbing=false,resetCount=0;
  const outputs=new Map();
  function invalidateDownloads() {
    for(const job of outputs.values())if(job.url)URL.revokeObjectURL(job.url);
    outputs.clear();
  }
  function refreshLink(format) {
    const link=links[format],job=outputs.get(format),caption=link.querySelector('small');
    link.download=item.id+(requested?'-'+requested.slice(1):'')+'.'+format;
    if(!requested || job?.url) {
      link.href=job?.url||defaults[format];link.removeAttribute('role');link.removeAttribute('tabindex');
    } else {
      link.removeAttribute('href');link.setAttribute('role','button');link.tabIndex=0;
    }
    if(job?.pending)link.setAttribute('aria-busy','true');else link.removeAttribute('aria-busy');
    caption.textContent=job?.error?'重试下载':job?.pending?'正在导出…':job?.blob?size(job.blob.size):
      requested?'导出所选墨色':size(item[format+'Bytes']);
  }
  function initialize() {
    if(!initialized)initialized=(async()=>{
      const blend=await loadBlend();
      if(signal.aborted)throw new DOMException('Closed','AbortError');
      worker=createWorker();
      await worker.request('init',{profile,blend,glb:original});
    })().catch(error=>{worker?.close();worker=initialized=undefined;throw error;});
    return initialized;
  }
  async function render() {
    if(active)return;
    active=true;
    try {
      while(!signal.aborted && requested!==applied) {
        const color=requested,turn=revision,resetAtStart=resetCount;
        try {
          await initialize();
          if(signal.aborted || revision!==turn)continue;
          const surfaces=await worker.request('preview',{hex:color});
          if(signal.aborted || resetCount!==resetAtStart)continue;
          // Keep native colour drags moving, but never flash an obsolete preset or undo a reset.
          if(revision!==turn && (!scrubbing || requested===applied))continue;
          preview.show(surfaces);applied=color;
          if(requested===applied){clearTimeout(statusTimer);status.textContent='';}
        } catch(error) {
          if(signal.aborted || revision!==turn)continue;
          clearTimeout(statusTimer);status.textContent='换色失败，请重新选色';return;
        }
      }
    } finally {active=false;}
  }
  function choose(hex,dragging=false) {
    scrubbing=dragging;
    if(hex===requested && (active || hex===applied))return;
    requested=hex;revision++;
    clearTimeout(statusTimer);status.textContent='';invalidateDownloads();
    const label=palette.find(([,value])=>value===hex)?.[0]||hex||'原色';
    summary.setAttribute('aria-label','墨水颜色，'+label);
    if(hex)box.style.setProperty('--ink',hex);else box.style.removeProperty('--ink');
    for(const button of swatches.children)button.setAttribute('aria-pressed',String(button.value===hex));
    custom.value=hex||originalChip;field.value=hex.toUpperCase();reset.disabled=!hex;
    field.setCustomValidity('');
    for(const format of Object.keys(links))refreshLink(format);
    if(!hex){resetCount++;preview.restore();applied='';return;}
    if(applied!==hex) {
      statusTimer=setTimeout(()=>{status.textContent='正在换色…';},220);
      void render();
    }
  }
  swatches.replaceChildren(...palette.map(([name,color])=>{
    const button=document.createElement('button');
    button.type='button';button.className='ink-swatch';button.value=color;
    button.title=name;button.setAttribute('aria-label',name);button.setAttribute('aria-pressed','false');
    button.style.setProperty('--swatch',color);return button;
  }));
  swatches.addEventListener('click',event=>{
    const button=event.target.closest('button');if(button)choose(button.value);
  },{signal});
  reset.addEventListener('click',()=>choose(''),{signal});
  for(const event of ['input','change'])custom.addEventListener(event,()=>choose(custom.value.toLowerCase(),event==='input'),{signal});
  function typedColor() {
    const value=field.value.trim();
    return /^#?[0-9a-f]{6}$/i.test(value)?'#'+value.replace('#','').toLowerCase():'';
  }
  field.addEventListener('input',()=>{
    field.setCustomValidity('');
    const hex=typedColor();if(hex)choose(hex);
  },{signal});
  field.addEventListener('keydown',event=>{
    if(event.key==='Enter') {
      event.preventDefault();
      const hex=typedColor();
      if(hex)choose(hex);
      else {field.setCustomValidity('请输入六位十六进制颜色值');field.reportValidity();}
    }
  },{signal});
  field.addEventListener('blur',()=>{field.setCustomValidity('');field.value=requested.toUpperCase();},{signal});
  box.addEventListener('toggle',()=>{if(box.open)initialize().catch(()=>{});},{signal});
  document.addEventListener('pointerdown',event=>{if(box.open && !box.contains(event.target))box.open=false;},{signal});
  document.addEventListener('keydown',event=>{
    if(box.open && event.key==='Escape'){
      event.preventDefault();event.stopPropagation();box.open=false;summary.focus();
    }
  },{signal,capture:true});
  for(const link of Object.values(links))link.addEventListener('keydown',event=>{
    if(link.getAttribute('role')==='button' && (event.key===' ' || event.key==='Enter')) {
      event.preventDefault();link.click();
    }
  },{signal});
  box.open=false;box.style.removeProperty('--ink');
  summary.setAttribute('aria-label','墨水颜色，原色');custom.value=originalChip;field.value='';
  field.setCustomValidity('');reset.disabled=true;status.textContent='';
  signal.addEventListener('abort',()=>{
    clearTimeout(statusTimer);worker?.close();invalidateDownloads();
    box.hidden=true;box.open=false;
    for(const link of Object.values(links)){link.removeAttribute('role');link.removeAttribute('tabindex');}
  },{once:true});
  ready({
    selected:()=>Boolean(requested),
    async download(format) {
      const color=requested;
      if(!color || signal.aborted)return;
      const cached=outputs.get(format);
      if(cached?.blob)return cached.blob;
      if(cached?.pending)return;
      const job={pending:true};outputs.set(format,job);refreshLink(format);
      try {
        await initialize();
        if(signal.aborted)return;
        const blob=await worker.request(format,{hex:color});
        if(signal.aborted)return;
        if(outputs.get(format)===job){job.url=URL.createObjectURL(blob);job.blob=blob;}
        return blob;
      } catch(error) {
        if(signal.aborted)return;
        job.error=true;throw error;
      } finally {
        job.pending=false;
        if(!signal.aborted && outputs.get(format)===job)refreshLink(format);
      }
    }
  });
  box.hidden=false;
}
