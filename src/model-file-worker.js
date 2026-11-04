import {loadModelFile} from './model-transport.mjs?v=bdee3beb9438';
const jobs=new Map();
self.onmessage=async ({data})=>{
 const {id,type}=data;
 if(type==='cancel'){jobs.get(id)?.abort();return;}
 const controller=new AbortController();jobs.set(id,controller);let last=0;
 try{
  const blob=await loadModelFile(data.item,data.format,{base:data.base,signal:controller.signal,onProgress:value=>{
   const now=performance.now();if(value===1||now-last>=100){last=now;self.postMessage({id,type:'progress',value});}
  }});
  if(!controller.signal.aborted)self.postMessage({id,type:'ready',blob});
 }catch(error){self.postMessage({id,type:'error',name:error.name,message:error.message});}
 finally{jobs.delete(id);}
};
