// Packed game textures and the GLB colour bakes are non-interlaced 8-bit PNGs.
// Read raw samples so that mask values and RGB behind translucent pixels survive.
const signature = Uint8Array.of(137,80,78,71,13,10,26,10);
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({length:256}, (_, i) => {
  for (let j=0; j<8; j++) i = (i >>> 1) ^ ((i & 1) ? 0xedb88320 : 0);
  return i;
});
function paeth(a,b,c) {
  const p=a+b-c, da=Math.abs(p-a), db=Math.abs(p-b), dc=Math.abs(p-c);
  return da<=db && da<=dc ? a : db<=dc ? b : c;
}
export async function readPng(bytes) {
  if (!signature.every((v,i)=>bytes[i]===v)) throw Error('Invalid ink texture');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const width=view.getUint32(16), height=view.getUint32(20), type=bytes[25];
  const channels=({0:1,2:3,3:1,4:2,6:4})[type];
  if (!channels || !width || !height || width*height>16777216 ||
      bytes[24]!==8 || bytes[26] || bytes[27] || bytes[28]) throw Error('Unsupported ink PNG');
  let palette, transparency;
  const compressed=[];
  for (let at=8; at+12<=bytes.length;) {
    const length=view.getUint32(at), tag=decoder.decode(bytes.subarray(at+4,at+8));
    if (at+12+length>bytes.length) throw Error('Truncated ink PNG');
    const data=bytes.subarray(at+8,at+8+length);
    if (tag==='IDAT') compressed.push(data);
    if (tag==='PLTE') palette=data;
    if (tag==='tRNS') transparency=data;
    at+=12+length;
    if (tag==='IEND') break;
  }
  const stream=new Blob(compressed).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw=new Uint8Array(await new Response(stream).arrayBuffer());
  const stride=width*channels;
  if (raw.length!==(stride+1)*height) throw Error('Invalid ink scanlines');
  const rgba=new Uint8Array(width*height*4);
  for (let y=0,out=0; y<height; y++) {
    const begin=y*(1+stride)+1, filter=raw[begin-1];
    if (filter>4) throw Error('Invalid PNG filter');
    for(let x=0; x<stride; x++) {
      const i=begin+x, a=x>=channels?raw[i-channels]:0, b=y?raw[i-stride-1]:0;
      const c=y && x>=channels?raw[i-stride-1-channels]:0;
      if (filter===1) raw[i]+=a;
      else if (filter===2) raw[i]+=b;
      else if (filter===3) raw[i]+=(a+b)>>>1;
      else if (filter===4) raw[i]+=paeth(a,b,c);
    }
    for (let i=begin;i<begin+stride;i+=channels) {
      const v=raw[i], rgb=type===2||type===6;
      rgba[out++]=type===3?palette[v*3]:v;
      rgba[out++]=type===3?palette[v*3+1]:rgb?raw[i+1]:v;
      rgba[out++]=type===3?palette[v*3+2]:rgb?raw[i+2]:v;
      rgba[out++]=type===3?(transparency?.[v]??255):type===4?raw[i+1]:type===6?raw[i+3]:255;
    }
  }
  return {width,height,rgba};
}
function chunk(type,bytes) {
  const result=new Uint8Array(12+bytes.length), view=new DataView(result.buffer);
  view.setUint32(0,bytes.length);result.set(encoder.encode(type),4);result.set(bytes,8);
  let crc=0xffffffff;
  for(let i=4;i<result.length-4;i++) crc=crcTable[(crc^result[i])&255]^(crc>>>8);
  view.setUint32(result.length-4,~crc);
  return result;
}
export async function writePng({width,height,rgba}) {
  const header=new Uint8Array(13), view=new DataView(header.buffer);
  view.setUint32(0,width);view.setUint32(4,height);header.set([8,6],8);
  const stride=width*4, raw=new Uint8Array(height*(stride+1));
  for (let y=0;y<height;y++) {
    const start=y*stride, pos=y*(stride+1);
    raw[pos]=1;
    for (let x=0;x<stride;x++) raw[pos+1+x]=rgba[start+x]-(x>=4?rgba[start+x-4]:0);
  }
  const stream=new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  const data=new Uint8Array(await new Response(stream).arrayBuffer());
  return new Blob([signature,chunk('IHDR',header),chunk('IDAT',data),chunk('IEND',new Uint8Array())],{type:'image/png'});
}
