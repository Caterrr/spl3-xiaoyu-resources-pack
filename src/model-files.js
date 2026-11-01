const base=document.querySelector('meta[name=resource-base]')?.content||'';
const resolve=path=>base?new URL(path,base).href:new URL(path,location.href).href;
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');

// The same verified GLB is used for the viewer and the download.
export async function loadModelFile(item,format,{signal,onProgress=()=>{}}={}){
 const expectedBytes=item[format+'Bytes'],expectedSha=item[format+'Sha256'];
 let payload;
 if(item[format+'Manifest']){
  const response=await fetch(resolve(item[format]),{signal});if(!response.ok)throw Error('manifest');
  const manifest=await response.json();
  if(manifest.version!==1||manifest.bytes!==expectedBytes||manifest.sha256!==expectedSha||!Array.isArray(manifest.chunks)||!manifest.chunks.length)throw Error('manifest_contract');
  let total=0;
  for(const chunk of manifest.chunks){if(chunk.offset!==total||!Number.isSafeInteger(chunk.bytes)||chunk.bytes<=0)throw Error('chunk_layout');total+=chunk.bytes;}
  if(total!==expectedBytes)throw Error('file_size');
  payload=new Uint8Array(total);let cursor=0,received=0;
  await Promise.all(Array.from({length:Math.min(3,manifest.chunks.length)},async()=>{
   while(cursor<manifest.chunks.length){
    const chunk=manifest.chunks[cursor++],url=new URL(chunk.url,response.url);
    if(url.origin!==new URL(response.url).origin)throw Error('chunk_origin');
    const part=await fetch(url,{signal});if(!part.ok)throw Error('chunk');
    const bytes=new Uint8Array(await part.arrayBuffer());
    if(bytes.length!==chunk.bytes||await digest(bytes)!==chunk.sha256)throw Error('chunk_integrity');
    payload.set(bytes,chunk.offset);received+=bytes.length;onProgress(received/total);
   }
  }));
 }else{
  const response=await fetch(resolve(item[format]),{signal});if(!response.ok)throw Error('model');
  if(response.body&&Number.isSafeInteger(expectedBytes)&&expectedBytes>0){
   payload=new Uint8Array(expectedBytes);let received=0;const reader=response.body.getReader();
   while(true){const {done,value}=await reader.read();if(done)break;if(received+value.length>expectedBytes){await reader.cancel();throw Error('file_size');}payload.set(value,received);received+=value.length;onProgress(received/expectedBytes);}
   if(received!==expectedBytes)throw Error('file_size');
  }else payload=new Uint8Array(await response.arrayBuffer());
 }
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(payload.length!==expectedBytes||await digest(payload)!==expectedSha)throw Error('file_integrity');
 onProgress(1);
 return new Blob([payload],{type:format==='glb'?'model/gltf-binary':'application/octet-stream'});
}

export function saveModelFile(blob,filename,{url:existingUrl}={}){
 const url=existingUrl||URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
 if(!existingUrl)setTimeout(()=>URL.revokeObjectURL(url),60000);
}
