import {Quaternion,Sphere} from './vendor/three/build/three.module.min.js';
import {poses} from './catalog/spl3/poses.js?v=5a2c69b67b13';

export const previewPoses=poses.map(({id,label,clip})=>({id,label,clip,group:'原版姿势'}));
const bindPoses=new WeakMap();
export function loadPreviewPose(id){
  return poses.find(p=>p.id===id)??null;
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
