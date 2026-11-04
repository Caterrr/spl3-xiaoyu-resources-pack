const base=document.querySelector('meta[name=resource-base]')?.content||location.href;
const pending=new Map(),cached=new Map(),workerJobs=new Map();
const CACHE_LIMIT=24*1024*1024;let cacheBytes=0,sequence=0,worker;
const aborted=()=>new DOMException('Aborted','AbortError');
function remember(key,blob){
 if(blob.size>CACHE_LIMIT/2)return;
 cached.set(key,blob);cacheBytes+=blob.size;
 while(cached.size>2||cacheBytes>CACHE_LIMIT){const first=cached.keys().next().value;cacheBytes-=cached.get(first).size;cached.delete(first);}
}
function background(item,format,signal,onProgress){
 if(typeof Worker==='undefined')return import('./model-transport.mjs?v=bdee3beb9438').then(m=>m.loadModelFile(item,format,{base,signal,onProgress}));
 try{
  if(!worker){
   worker=new Worker(new URL('./model-file-worker.js?v=6b1aa3f200cf',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{
    const job=workerJobs.get(data.id);if(!job)return;
    if(data.type==='progress'){job.onProgress(data.value);return;}
    workerJobs.delete(data.id);job.cleanup();
    if(data.type==='ready')job.resolve(data.blob);
    else{const error=new Error(data.message);error.name=data.name;job.reject(error);}
   };
   worker.onerror=()=>{
    worker.terminate();worker=undefined;
    for(const [id,job] of workerJobs){workerJobs.delete(id);job.cleanup();job.fallback();}
   };
  }
 }catch{return import('./model-transport.mjs?v=bdee3beb9438').then(m=>m.loadModelFile(item,format,{base,signal,onProgress}));}
 return new Promise((resolve,reject)=>{
  const id=++sequence;
  const cancel=()=>{worker?.postMessage({id,type:'cancel'});workerJobs.delete(id);signal.removeEventListener('abort',cancel);reject(aborted());};
  signal.addEventListener('abort',cancel,{once:true});
  if(signal.aborted){cancel();return;}
  workerJobs.set(id,{resolve,reject,onProgress,cleanup:()=>signal.removeEventListener('abort',cancel),fallback:()=>import('./model-transport.mjs?v=bdee3beb9438').then(m=>m.loadModelFile(item,format,{base,signal,onProgress})).then(resolve,reject)});
  worker.postMessage({id,type:'load',base,item,format});
 });
}
// One verified transfer can serve a preview and an early download independently.
export function loadModelFile(item,format,{signal,onProgress=()=>{}}={}){
 if(signal?.aborted)return Promise.reject(aborted());
 const key=[new URL(item[format],base).href,item[format+'Sha256'],item[format+'Bytes']].join(':');
 if(cached.has(key)){const blob=cached.get(key);cached.delete(key);cached.set(key,blob);onProgress(1);return Promise.resolve(blob);}
 let task=pending.get(key);
 if(!task){
  task={controller:new AbortController(),subscribers:new Set(),progress:0};pending.set(key,task);
  task.promise=background(item,format,task.controller.signal,p=>{
   task.progress=p;for(const sub of task.subscribers)sub.progress(p);
  });
  task.promise.then(blob=>{
   if(pending.get(key)===task)pending.delete(key);
   if(!task.controller.signal.aborted)remember(key,blob);
   for(const sub of task.subscribers){sub.cleanup();sub.resolve(blob);}task.subscribers.clear();
  },error=>{
   if(pending.get(key)===task)pending.delete(key);
   for(const sub of task.subscribers){sub.cleanup();sub.reject(error);}task.subscribers.clear();
  });
 }
 return new Promise((resolve,reject)=>{
  const sub={resolve,reject,progress:onProgress,cleanup:()=>signal?.removeEventListener('abort',cancel)};
  const cancel=()=>{
   sub.cleanup();task.subscribers.delete(sub);reject(aborted());
   if(!task.subscribers.size){if(pending.get(key)===task)pending.delete(key);task.controller.abort();}
  };
  task.subscribers.add(sub);signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted){cancel();return;}onProgress(task.progress);
 });
}

export function saveModelFile(blob,filename,{url:existingUrl}={}){
 const url=existingUrl||URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
 if(!existingUrl)setTimeout(()=>URL.revokeObjectURL(url),60000);
}
