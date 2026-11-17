// node extract.mjs /path/to/Model /path/to/src/catalog/spl3/poses.js
// Samples frame zero of Switch BFRES v10 FSKA clips in the player's own rest space.
import fs from 'node:fs';
import path from 'node:path';
import {zstdDecompressSync} from 'node:zlib';
import {Euler, Quaternion} from '../../src/vendor/three/build/three.module.min.js';

const [, , directory, destination] = process.argv;
const clips = [
  ['stand', '自然站立', 'amiibo_Pose_Wait'],
  ['crouch', '蹲姿', 'amiibo_Pose_Crouching00_EdWait'],
  ['warm', '取暖', 'amiibo_Pose_FeelingWarm00_EdWait'],
  ['win13', '胜利姿势 13', 'amiibo_Pose_Win13_EdWait'],
  ['win15', '胜利姿势 15', 'amiibo_Pose_Win15_EdWait'],
];
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
function readPlayer(filename) {
  const b = zstdDecompressSync(fs.readFileSync(filename));
  const u16 = i => b.readUInt16LE(i), u32 = i => b.readUInt32LE(i);
  const ptr = i => Number(b.readBigUInt64LE(i));
  const floats = (i,n) => Array.from({length:n}, (_,j) => b.readFloatLE(i+4*j));
  const string = field => {const i=ptr(field);return b.toString('utf8',i+2,i+2+u16(i));};
  if (b.toString('ascii',0,4)!=='FRES' || b[10]!==10) throw Error('Expected Switch BFRES v10');
  const skel=ptr(ptr(40)+24), boneList=ptr(skel+16), boneCount=u16(skel+56);
  const rest=new Map();
  for(let j=0;j<boneCount;j++){
    const i=boneList+j*88;
    if(!(u32(i+44)&0x1000)) throw Error('Unexpected rest rotation mode');
    rest.set(string(i),floats(i+48,10));
  }
  const table=new Map();
  for(let j=0;j<u16(0xe2);j++){
    const i=ptr(88)+80*j;
    if(b.toString('ascii',i,i+4)!=='FSKA') throw Error('Invalid animation table');
    table.set(string(i+8),i);
  }
  function sample(name){
    const entry=table.get(name);
    if(entry===undefined)return null;
    if(!(u32(entry+4)&0x1000))throw Error('Unexpected clip rotation mode');
    const result={};
    for(let j=0;j<u16(entry+76);j++){
      const bone=ptr(entry+40)+56*j, label=string(bone), original=rest.get(label);
      if(!original)throw Error('Missing source bone '+label);
      const values=[...original],flags=u32(bone+40);let start=ptr(bone+16);
      for(const [flag,first,count] of [[8,0,3],[16,3,4],[32,7,3]]){
        if(flags&flag){values.splice(first,count,...floats(start,count));start+=4*count;}
      }
      // AnimData stores translation at byte 16 and Euler rotation at byte 32.
      const channels={4:0,8:1,12:2,16:7,20:8,24:9,32:3,36:4,40:5,44:6};
      for(let c=0;c<b[bone+46];c++){
        const curve=ptr(bone+8)+c*48, format=u16(curve+16), key=ptr(curve+8), frames=ptr(curve);
        if((format&0x70)>0x20 || !u16(curve+18) || b.readFloatLE(curve+24)!==0)throw Error('Unsupported first key');
        const frameType=format&3;
        const firstFrame=frameType===0?b.readFloatLE(frames):frameType===1?b.readInt16LE(frames):b[frames];
        if(firstFrame!==0)throw Error('Curve does not start at frame zero');
        const readKey=['readFloatLE','readInt16LE','readInt8'][(format>>2)&3];
        const index=channels[u32(curve+20)];
        if(index===undefined||!readKey)throw Error('Unsupported bone channel');
        values[index]=b[readKey](key)*(b.readFloatLE(curve+32)||1)+b.readFloatLE(curve+36);
      }
      const delta=relative(original,values);
      if(delta.some((v,k)=>Math.abs(v-identity[k])>.00001))result[label]=delta;
    }
    return result;
  }
  return {sample,count:table.size};
}
const players=Array.from({length:4},(_,i)=>readPlayer(path.join(directory,'Player0'+i+'.bfres.zs')));
const output=clips.map(([id,label,clip])=>{
  const bones=players[0].sample(clip);
  if(!bones || !Object.keys(bones).length)throw Error('Missing '+clip);
  const variants={};
  for(let i=1;i<players.length;i++){const local=players[i].sample(clip);if(local)variants['Player0'+i]=local;}
  return {id,label,clip,bones,variants};
});
fs.writeFileSync(destination,'// Generated from Splatoon 3 player FSKA clips, frame 0.\nexport const poses = [\n'+output.map(p=>JSON.stringify(p)).join(',\n')+'\n];\n');
console.log('Player animation counts:',players.map(p=>p.count), 'presets:', output.map(p=>[p.id,Object.keys(p.bones).length,Object.keys(p.variants)]));
