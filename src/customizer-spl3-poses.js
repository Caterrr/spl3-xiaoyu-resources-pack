import {Quaternion,Sphere} from './vendor/three/build/three.module.min.js';
import {poses,poseFiles,batchSize} from './catalog/spl3/poses.js?v=1f69fd11048d';

export const previewPoses = poses;
const index = new Map(poses.map((pose,i)=>[pose.id,i]));
const batches = new Map();
const bindPoses = new WeakMap();

export async function loadPreviewPose(id){
  if(id==='rest')return null;
  const i=index.get(id);
  if(i===undefined)throw Error('姿势不存在');
  const batch=Math.floor(i/batchSize);
  if(!batches.has(batch)){
    const url=new URL('./catalog/spl3/'+poseFiles[batch],import.meta.url);
    batches.set(batch,fetch(url).then(async response=>{
      if(!response.ok)throw Error('姿势加载失败');
      const blob=await response.blob();
      const header=new Uint8Array(await blob.slice(0,2).arrayBuffer());
      return header[0]===31 && header[1]===139
        ?new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).json()
        :JSON.parse(await blob.text());
    }).catch(error=>{batches.delete(batch);throw error;}));
  }
  return (await batches.get(batch))[i%batchSize];
}
function bodyBones(character){
  let body;
  character.traverse(o=>{if(o.userData.role==='body')body=o;});
  return body.skeleton.bones;
}
function snapshot(bone){
  return {position:bone.position.clone(),rotation:bone.quaternion.clone(),scale:bone.scale.clone()};
}
// Compute skinned bounds once at the destination, keeping vertex work outside the animation loop.
export function setPreviewPose(model,pose,animate=false){
  let bind=bindPoses.get(model);
  if(!bind){
    bind=bodyBones(model.character).map(bone=>({bone,...snapshot(bone)}));
    bindPoses.set(model,bind);
  }
  const avatar='Player0'+(Number(model.state.species==='octopus')*2+Number(model.state.gender==='male'));
  const changes=pose?.variants[avatar]??pose?.bones;
  const turn=new Quaternion(),tracks=[];
  for(const {bone,position,rotation,scale} of bind){
    const start=animate?snapshot(bone):null;
    bone.position.copy(position);bone.quaternion.copy(rotation);bone.scale.copy(scale);
    const d=changes?.[bone.name];
    if(d){
      bone.position.x+=d[0];bone.position.y+=d[1];bone.position.z+=d[2];
      bone.quaternion.multiply(turn.fromArray(d,3)).normalize();
      bone.scale.set(scale.x*d[7],scale.y*d[8],scale.z*d[9]);
    }
    if(start)tracks.push({bone,start,end:snapshot(bone)});
  }
  model.character.updateMatrixWorld(true);
  model.character.traverse(o=>{if(o.isSkinnedMesh){o.computeBoundingBox();o.boundingBox.getBoundingSphere(o.boundingSphere??=new Sphere());}});
  if(!animate)return;
  return t=>{
    for(const {bone,start,end} of tracks){
      bone.position.lerpVectors(start.position,end.position,t);
      bone.quaternion.slerpQuaternions(start.rotation,end.rotation,t);
      bone.scale.lerpVectors(start.scale,end.scale,t);
    }
  };
}
export function restoreExportPose(model,copy){
  const bind=bindPoses.get(model);
  if(!bind)return;
  const bones=bodyBones(copy);
  bind.forEach(({position,rotation,scale},i)=>{
    bones[i].position.copy(position);bones[i].quaternion.copy(rotation);bones[i].scale.copy(scale);
  });
  copy.updateMatrixWorld(true);
}
