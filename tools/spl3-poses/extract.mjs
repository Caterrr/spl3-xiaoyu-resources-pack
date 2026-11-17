// node extract.mjs /path/to/Model /path/to/src/catalog/spl3/poses.js
// Sample authored holds, collection slots and emotes in each player’s rest space.
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync, zstdDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {presets} from './presets.mjs';
import {Euler, Quaternion} from '../../src/vendor/three/build/three.module.min.js';

const [, , directory, destination] = process.argv;
const quaternion = angles => new Quaternion().setFromEuler(new Euler(...angles.slice(0, 3), 'ZYX'));
const relative = (rest, pose) => {
  const rotation = quaternion(rest.slice(3,7)).invert().multiply(quaternion(pose.slice(3,7))).normalize();
  if (rotation.w < 0) rotation.fromArray(rotation.toArray().map(v => -v));
  return [
    ...pose.slice(7).map((v,i) => v-rest[i+7]), ...rotation.toArray(),
    ...pose.slice(0,3).map((v,i) => v/rest[i])
  ].map(v => +v.toFixed(6));
};
const identity = [0,0,0,0,0,0,1,1,1,1];
function readPlayer(filename, baseRest) {
  const b = zstdDecompressSync(fs.readFileSync(filename));
  const u16 = i => b.readUInt16LE(i), u32 = i => b.readUInt32LE(i);
  const ptr = i => Number(b.readBigUInt64LE(i));
  const floats = (i,n) => Array.from({length:n}, (_,j) => b.readFloatLE(i+4*j));
  const string = field => {const i=ptr(field);return b.toString('utf8',i+2,i+2+u16(i));};
  if (b.toString('ascii',0,4)!=='FRES' || b[10]!==10) throw Error('Expected Switch BFRES v10');
  const model=ptr(40),rest=baseRest || new Map();
  if(model && !baseRest){
    const skel=ptr(model+24),boneList=ptr(skel+16);
    for(let j=0;j<u16(skel+56);j++){
      const i=boneList+j*88;
      if(!(u32(i+44)&0x1000)) throw Error('Unexpected rest rotation mode');
      rest.set(string(i),floats(i+48,10));
    }
  }
  const table=new Map();
  for(let j=0;j<u16(0xe2);j++){
    const i=ptr(88)+80*j;
    if(b.toString('ascii',i,i+4)!=='FSKA') throw Error('Invalid animation table');
    table.set(string(i+8),i);
  }
  function curveValue(curve,frame){
    const format=u16(curve+16),count=u16(curve+18),frames=ptr(curve),keys=ptr(curve+8);
    const frameType=format&3,keyType=(format>>2)&3,type=(format>>4)&7;
    if(!count||frameType>2||keyType>2||type>2)throw Error('Unexpected numeric curve '+format);
    const time=i=>[()=>b.readFloatLE(frames+i*4),()=>b.readInt16LE(frames+i*2)/32,()=>b[frames+i]][frameType]();
    let lo=0,hi=count;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(time(mid)<=frame)lo=mid;else hi=mid;}
    const width=[4,2,1][keyType],stride=[4,2,1][type];
    const read=['readFloatLE','readInt16LE','readInt8'][keyType];
    const coeff=i=>b[read](keys+(lo*stride+i)*width);
    const start=time(lo),end=lo+1<count?time(lo+1):start;
    const t=end>start?Math.min(1,Math.max(0,(frame-start)/(end-start))):0;
    let value=coeff(0);
    if(type===0)value+=t*(coeff(1)+t*(coeff(2)+t*coeff(3)));
    if(type===1)value+=t*coeff(1);
    return value*(b.readFloatLE(curve+32)||1)+b.readFloatLE(curve+36);
  }
  function sample(name,frame){
    const entry=table.get(name);
    if(entry===undefined)return null;
    if(!(u32(entry+4)&0x1000))throw Error('Unexpected clip rotation mode');
    const result={};
    for(let j=0;j<u16(entry+76);j++){
      const bone=ptr(entry+40)+56*j, label=string(bone), original=rest.get(label);
      if(!original)continue; // Some clips also animate the separate face or prop skeleton.
      const values=[...original],flags=u32(bone+40);let start=ptr(bone+16);
      for(const [flag,first,count] of [[8,0,3],[16,3,4],[32,7,3]]){
        if(flags&flag){values.splice(first,count,...floats(start,count));start+=4*count;}
      }
      // AnimData stores translation at byte 16 and Euler rotation at byte 32.
      const channels={4:0,8:1,12:2,16:7,20:8,24:9,32:3,36:4,40:5,44:6};
      for(let c=0;c<b[bone+46];c++){
        const curve=ptr(bone+8)+c*48,index=channels[u32(curve+20)];
        if(index===undefined)throw Error('Unsupported bone channel in '+name);
        values[index]=curveValue(curve,frame);
      }
      const delta=relative(original,values);
      if(delta.some((v,k)=>Math.abs(v-identity[k])>.00001))result[label]=delta;
    }
    return result;
  }
  return {sample,rest,clips:new Map([...table].map(([n,i])=>[n,u32(i+64)]))};
}
const files=fs.readdirSync(directory).filter(f=>/^Player0[0-3](?:_v-\d+)?\.bfres\.zs$/.test(f)).sort();
const players=Array.from({length:4},()=>new Map()), allClips=new Map(),rests=[];
for(const file of files){
  const slot=Number(file[7]),source=readPlayer(path.join(directory,file),rests[slot]);
  rests[slot]=source.rest;
  for(const [name,frames] of source.clips){players[slot].set(name,source);allClips.set(name,frames);}
}
const outDir=path.join(path.dirname(destination),'pose-data');
fs.mkdirSync(outDir,{recursive:true});
const entries=presets(allClips),chunks=[],labels=new Set(),ids=new Set();
for(const entry of entries){
  if(ids.has(entry.id))throw Error('Duplicate id '+entry.id);
  ids.add(entry.id);
  const signature=entry.group+'/'+entry.label;
  if(labels.has(signature))entry.label+='（变体）';
  labels.add(signature);
}
for(let i=0;i<entries.length;i+=32){
  const rows=entries.slice(i,i+32).map(({clip,frame})=>{
    const versions=players.map(p=>p.get(clip)?.sample(clip,frame));
    const bones=versions.find(Boolean);
    if(!bones||(!Object.keys(bones).length&&clip!=='Tstance'))throw Error('Empty pose '+clip+' '+frame);
    const variants={};
    versions.forEach((v,j)=>{if(v && JSON.stringify(v)!==JSON.stringify(bones))variants['Player0'+j]=v;});
    return {bones,variants};
  });
  const bytes=gzipSync(JSON.stringify(rows),{level:9});
  const hash=createHash('sha256').update(bytes).digest('hex').slice(0,12);
  const name='batch-'+String(chunks.length).padStart(2,'0')+'.json.gz';
  fs.writeFileSync(path.join(outDir,name),bytes);chunks.push('./pose-data/'+name+'?v='+hash);
}
fs.writeFileSync(destination,'// Generated from the original player skeletons and animation packs.\nexport const batchSize=32;\nexport const poseFiles='+JSON.stringify(chunks)+';\nexport const poses=[\n'+entries.map(e=>JSON.stringify(e)).join(',\n')+'\n];\n');
console.log(entries.length+' poses',Object.fromEntries(Object.entries(Object.groupBy(entries,p=>p.group)).map(([g,a])=>[g,a.length])));
