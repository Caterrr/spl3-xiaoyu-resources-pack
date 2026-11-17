import {Quaternion} from './vendor/three/build/three.module.min.js';
import {poses} from './catalog/spl3/poses.js?v=5a2c69b67b13';

export const previewPoses = poses.map(({id,label}) => ({id,label}));
const bindPoses = new WeakMap();

function bodyBones(character) {
  let body;
  character.traverse(object => { if (object.userData.role === 'body') body = object; });
  return body.skeleton.bones;
}

export function setPreviewPose(model, id) {
  let bind = bindPoses.get(model);
  if (!bind) {
    bind = bodyBones(model.character).map(bone => ({
      bone, position: bone.position.clone(), rotation: bone.quaternion.clone(), scale: bone.scale.clone()
    }));
    bindPoses.set(model,bind);
  }
  const pose = poses.find(item => item.id === id);
  const avatar = 'Player0' + (Number(model.state.species === 'octopus')*2 + Number(model.state.gender === 'male'));
  const changes = pose?.variants[avatar] ?? pose?.bones;
  const turn = new Quaternion();
  for (const {bone,position,rotation,scale} of bind) {
    bone.position.copy(position);
    bone.quaternion.copy(rotation);
    bone.scale.copy(scale);
    const d = changes?.[bone.name];
    if (!d) continue;
    bone.position.x += d[0]; bone.position.y += d[1]; bone.position.z += d[2];
    bone.quaternion.multiply(turn.fromArray(d,3)).normalize();
    bone.scale.set(scale.x*d[7], scale.y*d[8], scale.z*d[9]);
  }
  model.character.updateMatrixWorld(true);
  model.character.traverse(object => {
    if (object.isSkinnedMesh) {
      object.computeBoundingBox();
      object.computeBoundingSphere();
    }
  });
}

// Export the editable rig in its original bind pose even when the fitting-room preview is posed.
export function restoreExportPose(model, copy) {
  const bind = bindPoses.get(model);
  if (!bind) return;
  const bones = bodyBones(copy);
  bind.forEach(({position,rotation,scale},i) => {
    bones[i].position.copy(position);
    bones[i].quaternion.copy(rotation);
    bones[i].scale.copy(scale);
  });
  copy.updateMatrixWorld(true);
}
