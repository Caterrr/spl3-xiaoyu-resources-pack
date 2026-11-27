let profiles;
function getProfiles() {
  return profiles??=fetch(new URL('./materials.json',import.meta.url)).then(r=>{
    if(!r.ok) throw Error('Ink profiles unavailable');
    return r.json();
  }).catch(error=>{profiles=undefined;throw error;});
}
function createWorker() {
  const worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
  const pending=new Map();let seq=0,failed;
  function rejectAll(error) {
    for(const job of pending.values())job.reject(error);
    pending.clear();
  }
  worker.onmessage=({data})=>{
    const job=pending.get(data.id);if(!job)return;
    pending.delete(data.id);
    if(data.error)job.reject(Error(data.error));else job.resolve(data.blob);
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
export async function enableInk({item,signal,original,links,loadBlend,showGlb,size,ready}) {
  const profile=(await getProfiles())[item.id];
  if(signal.aborted || !profile || profile.glb!==item.glbSha256 || profile.blend!==item.blendSha256)return;
  const box=document.querySelector('#weapon-ink'), presets=box.querySelector('select');
  const custom=box.querySelector('input'),status=box.querySelector('[role=status]');
  const defaults=Object.fromEntries(Object.entries(links).map(([key,link])=>[key,link.href]));
  let urls={},blobs,worker,initialized,requested='',applied='',running=false,revision=0;
  const clearUrls=()=>{for(const url of Object.values(urls))URL.revokeObjectURL(url);urls={};};
  const setDownloads=(pending)=>{
    for(const [key,link] of Object.entries(links)) {
      if(pending)link.removeAttribute('href');else link.href=urls[key]||defaults[key];
      link.setAttribute('aria-disabled',String(pending));
      link.download=item.id+(requested?'-'+requested.slice(1):'')+'.'+key;
      link.querySelector('small').textContent=pending?'…':size(blobs?.[key].size??item[key+'Bytes']);
    }
  };
  async function initialize() {
    try {
      const blend=await loadBlend();
      if(signal.aborted)throw signal.reason;
      worker=createWorker();await worker.request('init',{profile,blend,glb:original});
    } catch(error) {
      worker?.close();worker=initialized=undefined;throw error;
    }
  }
  async function update() {
    if(running)return;
    running=true;
    try {
      while(!signal.aborted && requested!==applied) {
        const color=requested,turn=revision;
        status.textContent='正在换色…';
        try {
          await (initialized??=initialize());
          if(turn!==revision || signal.aborted)continue;
          const [glb,blend]=await Promise.all(['glb','blend'].map(type=>worker.request(type,{hex:color})));
          if(turn!==revision || signal.aborted)continue;
          const next={glb:URL.createObjectURL(glb),blend:URL.createObjectURL(blend)};
          showGlb(next.glb);clearUrls();urls=next;blobs={glb,blend};applied=color;
          status.textContent='';setDownloads(false);
        } catch(error) {
          if(turn!==revision || signal.aborted)continue;
          worker?.close();worker=initialized=undefined;
          status.textContent='换色失败，请重新选色';return;
        }
      }
    } finally {running=false;}
  }
  function choose(hex) {
    requested=hex;revision++;
    if(!hex) {
      showGlb(null);clearUrls();blobs=undefined;applied='';
      status.textContent='';setDownloads(false);
    } else if(requested===applied) {
      status.textContent='';setDownloads(false);
    } else {
      setDownloads(true);update();
    }
  }
  presets.value='';custom.value='#ff5d1c';status.textContent='';
  presets.addEventListener('change',()=>{
    const color=presets.value;if(color)custom.value=color;else custom.value='#ff5d1c';
    choose(color);
  },{signal});
  custom.addEventListener('change',()=>{
    const hex=custom.value.toLowerCase();
    presets.value=[...presets.options].some(o=>o.value===hex)?hex:'custom';
    choose(hex);
  },{signal});
  signal.addEventListener('abort',()=>{worker?.close();clearUrls();box.hidden=true;},{once:true});
  ready({
    selected:()=>Boolean(requested),
    download(format){return applied===requested?blobs?.[format]:undefined;}
  });
  box.hidden=false;
}
