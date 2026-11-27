import {decompress} from '../vendor/fzstd.mjs';
import {readPng,writePng} from './png.mjs';

const linear=Float32Array.from({length:256},(_,i)=>{
  const x=i/255;
  return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
});
function toByte(x) {
  return Math.round(255*Math.min(1,Math.max(0,x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055)));
}
function colorChannels(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw Error('Invalid ink colour');
  return [1,3,5].map(i=>linear[parseInt(hex.slice(i,i+2),16)]);
}
const padding=n=>(4-n%4)%4;
export async function unpackBlend(blob) {
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let raw=bytes;
  if(bytes[0]===0x28 && bytes[1]===0xb5) raw=decompress(bytes);
  else if(bytes[0]===0x1f && bytes[1]===0x8b)
    raw=new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if(new TextDecoder().decode(raw.subarray(0,7))!=='BLENDER') throw Error('Invalid Blender file');
  return raw;
}
export function colorBlend(raw,profile,hex) {
  const tint=colorChannels(hex), view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const parts=[];let start=0;
  const rgb=new Uint8Array(12), floats=new DataView(rgb.buffer);
  tint.forEach((v,c)=>floats.setFloat32(c*4,v,true));
  const edits=profile.offsets.map(offset=>{
    if([255,93,28].some((v,c)=>Math.abs(view.getFloat32(offset+c*4,true)-linear[v])>.00001))
      throw Error('Unexpected Blender ink socket');
    return {at:offset,skip:12,bytes:rgb};
  });
  if(profile.graph) {
    // Each record edits node links or inserts a MixRGB node. Original image and mesh blocks stay intact.
    const patch=decompress(Uint8Array.from(atob(profile.graph),c=>c.charCodeAt(0)));
    const records=new DataView(patch.buffer,patch.byteOffset,patch.byteLength);
    for(let i=0;i<patch.byteLength;) {
      const at=records.getUint32(i,true), skip=records.getUint32(i+4,true);
      const size=records.getUint32(i+8,true), color=records.getUint32(i+12,true);
      i+=16;
      if(i+size>patch.length)throw Error('Invalid Blender paint node');
      const bytes=patch.subarray(i,i+size);
      if(color!==0xffffffff)bytes.set(rgb,color);
      edits.push({at,skip,bytes});i+=size;
    }
  }
  for(const {at,skip,bytes} of edits.sort((a,b)=>a.at-b.at || a.skip-b.skip)) {
    if(at<start || at+skip>raw.length)throw Error('Invalid Blender material patch');
    parts.push(raw.subarray(start,at),bytes);start=at+skip;
  }
  return new Blob([...parts,raw.subarray(start)],{type:'application/octet-stream'});
}
function readGlb(raw) {
  const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength), length=v.getUint32(12,true);
  if(v.getUint32(0,true)!==0x46546c67 || v.getUint32(4,true)!==2 || v.getUint32(8,true)!==raw.byteLength ||
     v.getUint32(16,true)!==0x4e4f534a || v.getUint32(24+length,true)!==0x004e4942) throw Error('Invalid weapon GLB');
  return {doc:JSON.parse(new TextDecoder().decode(raw.subarray(20,20+length))),bin:raw.subarray(28+length)};
}
function packGlb(doc,parts,binSize) {
  doc.buffers[0].byteLength=binSize;
  const json=new TextEncoder().encode(JSON.stringify(doc)), extra=padding(json.length), end=padding(binSize);
  const head=new ArrayBuffer(20), v=new DataView(head);
  [0x46546c67,2,28+json.length+extra+binSize+end,json.length+extra,0x4e4f534a].forEach((x,i)=>v.setUint32(i*4,x,true));
  const bh=new ArrayBuffer(8), b=new DataView(bh);
  b.setUint32(0,binSize+end,true);b.setUint32(4,0x004e4942,true);
  return new Blob([head,json,new Uint8Array(extra).fill(32),bh,...parts,new Uint8Array(end)],{type:'model/gltf-binary'});
}
// Centre-of-texel sampling matches the source material bake, including the wrap mode at the UV seam.
function sampler(image,w,h,repeat,srgb,transform={}) {
  const [sx,sy]=transform.scale||[1,1], [dx,dy]=transform.offset||[0,0];
  const {width,height,rgba}=image, table=srgb?linear:null;
  const sample=(p,c)=>table?table[rgba[p+c]]:rgba[p+c]/255;
  if(w===width && h===height && sx===1 && sy===1 && dx===0 && dy===0) return (x,y,c)=>sample((y*w+x)*4,c);
  function axis(size,target,scale,offset,wrap) {
    const lo=new Int32Array(target), hi=new Int32Array(target), t=new Float32Array(target);
    const edge=n=>wrap?((n%size)+size)%size:Math.min(size-1,Math.max(0,n));
    for(let i=0;i<target;i++) {
      const coord=((i+.5)*scale/target+offset)*size-.5, a=Math.floor(coord);
      lo[i]=edge(a);hi[i]=edge(a+1);t[i]=coord-a;
    }
    return {lo,hi,t};
  }
  const xx=axis(width,w,sx,dx,repeat[0]??repeat), yy=axis(height,h,sy,dy,repeat[1]??repeat);
  return (x,y,c)=>{
    const a=yy.lo[y]*width, b=yy.hi[y]*width, tx=xx.t[x], ty=yy.t[y];
    return ((1-tx)*sample(4*(a+xx.lo[x]),c)+tx*sample(4*(a+xx.hi[x]),c))*(1-ty)
          +((1-tx)*sample(4*(b+xx.lo[x]),c)+tx*sample(4*(b+xx.hi[x]),c))*ty;
  };
}
export async function prepareInk(glb,raw,profile) {
  const {doc,bin}=readGlb(new Uint8Array(await glb.arrayBuffer()));
  const images=await Promise.all(profile.images.map(([at,len])=>readPng(raw.subarray(at,at+len))));
  const recipes=new Map(), targets=[];
  for(const row of profile.materials) {
    const pbr=doc.materials[row.material].pbrMetallicRoughness;
    const source=doc.images[doc.textures[pbr.baseColorTexture.index].source], view=doc.bufferViews[source.bufferView];
    const key=JSON.stringify([view.byteOffset,view.byteLength,row.base,row.mask,row.ao]);
    if(!recipes.has(key)) {
      const original=await readPng(bin.subarray(view.byteOffset,view.byteOffset+view.byteLength));
      const inputs=[row.base,row.mask,row.ao].filter(Number.isInteger).map(i=>images[i]);
      const w=Math.max(1,...inputs.map(im=>im.width)),h=Math.max(1,...inputs.map(im=>im.height));
      const get=(ref,srgb,fallback)=>{
        if(ref===undefined)return ()=>fallback;
        if(ref.rgb)return (x,y,c)=>ref.rgb[c];
        return sampler(images[ref],w,h,profile.images[ref][2],srgb);
      };
      recipes.set(key,{original,w,h,base:get(row.base,true,0),mask:get(row.mask,false,1),ao:get(row.ao,false,1)});
    }
    targets.push({material:row.material,key});
  }
  // The paint shader uses its own _cp0 mask. Preserve the already-assembled albedo
  // outside that mask, including team trim baked into the grip of a shared atlas.
  const paint=[];
  for(const row of profile.paint||[]) {
    const pbr=doc.materials[row.material].pbrMetallicRoughness, slot=pbr.baseColorTexture;
    const maskImage=images[row.mask];
    let original;
    if(slot) {
      const image=doc.images[doc.textures[slot.index].source], view=doc.bufferViews[image.bufferView];
      const offset=view.byteOffset||0;
      original=await readPng(bin.subarray(offset,offset+view.byteLength));
    }
    const transform=slot?.extensions?.KHR_texture_transform||{};
    const [sx,sy]=transform.scale||[1,1];
    const width=Math.max(maskImage.width,(original?.width||1)*sx);
    const height=Math.max(maskImage.height,(original?.height||1)*sy);
    const sourceSampler=slot && doc.samplers?.[doc.textures[slot.index].sampler];
    const wrap=[sourceSampler?.wrapS!==33071,sourceSampler?.wrapT!==33071];
    const mask=sampler(maskImage,width,height,profile.images[row.mask][2],false);
    const base=original?sampler(original,width,height,wrap,true,transform):()=>1;
    const alpha=original?sampler(original,width,height,wrap,false,transform):()=>1;
    paint.push({material:row.material,width,height,base,alpha,mask});
  }
  return {doc,bin,recipes,targets,paint};
}
export async function colorGlb(prepared,hex) {
  const {bin,recipes,targets}=prepared, doc=structuredClone(prepared.doc);
  const tint=colorChannels(hex), parts=[bin], generated=new Map();
  let size=bin.length;
  async function appendImage(width,height,rgba) {
    const png=await writePng({width,height,rgba}), pad=padding(size);
    parts.push(new Uint8Array(pad),png);size+=pad;
    const bufferView=doc.bufferViews.push({buffer:0,byteOffset:size,byteLength:png.size})-1;
    size+=png.size;return doc.images.push({bufferView,mimeType:'image/png'})-1;
  }
  for(const [key,{original,w,h,base,mask,ao}] of recipes) {
    const {width,height}=original, rgba=original.rgba.slice();
    const resized=w!==width || h!==height;
    const baked=resized?new Uint8Array(w*h*4):rgba;
    for(let y=0,p=0;y<h;y++) for(let x=0;x<w;x++,p+=4) {
      const m=mask(x,y,0);
      if(resized)baked[p+3]=m>0?255:0;
      else if(m===0)continue;
      for(let c=0;c<3;c++) baked[p+c]=toByte(((1-m)*base(x,y,c)+m*tint[c])*ao(x,y,c));
    }
    // When alpha was supplied at a higher resolution, the GLB exporter enlarged the baked RGB.
    if(resized) {
      const sample=sampler({rgba:baked,width:w,height:h},width,height,false,false);
      for(let y=0,p=0;y<height;y++)for(let x=0;x<width;x++,p+=4) {
        if(sample(x,y,3)===0)continue;
        for(let c=0;c<3;c++)rgba[p+c]=Math.round(255*sample(x,y,c));
      }
    }
    generated.set(key,await appendImage(width,height,rgba));
  }
  for(const {material,key} of targets) {
    const slot=doc.materials[material].pbrMetallicRoughness.baseColorTexture;
    const texture={...doc.textures[slot.index],source:generated.get(key)};
    slot.index=doc.textures.push(texture)-1;
  }
  for(const {material,width,height,mask,base,alpha} of prepared.paint) {
    const pbr=doc.materials[material].pbrMetallicRoughness;
    const factor=pbr.baseColorFactor||[1,1,1,1], slot=pbr.baseColorTexture;
    const rgba=new Uint8Array(width*height*4);
    for(let y=0,p=0;y<height;y++)for(let x=0;x<width;x++,p+=4) {
      const coverage=mask(x,y,0);
      for(let c=0;c<3;c++)rgba[p+c]=toByte((1-coverage)*base(x,y,c)*factor[c]+coverage*tint[c]);
      rgba[p+3]=Math.round(255*alpha(x,y,3));
    }
    const image=await appendImage(width,height,rgba);
    const texture=slot?{...doc.textures[slot.index]}:{};
    texture.source=image;
    // The source UV transform was baked into the base layer. The paint mask uses UV0.
    pbr.baseColorTexture={index:doc.textures.push(texture)-1};
    pbr.baseColorFactor=[1,1,1,factor[3]];
  }
  return packGlb(doc,parts,size);
}
