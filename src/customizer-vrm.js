import {
  Bone, BufferAttribute, Matrix3, Matrix4, Mesh, MeshBasicMaterial, Scene, Skeleton,
  SkinnedMesh, Uint16BufferAttribute, Vector3
} from './vendor/three/build/three.module.min.js';
import {clone} from './vendor/three/examples/jsm/utils/SkeletonUtils.js';
import {GLTFExporter} from './vendor/three/examples/jsm/exporters/GLTFExporter.js';
import {restoreExportPose} from './customizer-spl3-poses.js?v=7800c405309e';

function humanoid(bodyBones, nodeIndex) {
  const byName = new Map(bodyBones.map(bone => [bone.name, bone]));
  const humanBones = {};
  function assign(slot, name, optional = false) {
    const bone = byName.get(name);
    if (bone) humanBones[slot] = {node: nodeIndex(bone)};
    else if (!optional) throw Error('缺少角色骨骼 ' + name);
  }
  for (const [slot, name] of Object.entries({
    hips:'Skl_Root', spine:'Spine_2', chest:'Spine_3', neck:'Neck', head:'Head'
  })) assign(slot, name);
  for (const [side, suffix] of [['left','L'], ['right','R']]) {
    for (const [slot, name] of Object.entries({
      Shoulder:'Clavicle', UpperArm:'Arm_1', LowerArm:'Arm_2', Hand:'Wrist',
      UpperLeg:'Leg_1', LowerLeg:'Leg_2', Foot:'Ankle', Toes:'Toe'
    })) assign(side + slot, name + '_' + suffix);
    for (const [finger, letter] of Object.entries({Thumb:'A', Index:'B', Middle:'C', Ring:'D', Little:'E'})) {
      const segments = finger === 'Thumb' ? ['Metacarpal','Proximal','Distal'] : ['Proximal','Intermediate','Distal'];
      segments.forEach((segment, i) => assign(side + finger + segment, `Finger_${letter}_${i+1}_${suffix}`, true));
    }
  }
  return {humanBones};
}

// Accessories have their own coordinate systems, sometimes with the same bone names.
// Keep bone identity and ancestry while baking the fitted T-pose into one coordinate system.
function makeRig(source) {
  const bones = new Map(), indices = new Map(), names = new Set();
  const root = new Bone();
  root.name = 'AvatarRoot';
  source.traverse(original => {
    if (!original.isBone) return;
    let parent = original.parent;
    while (parent && !bones.has(parent)) parent = parent.parent;
    const bone = new Bone();
    let name = original.name;
    for (let i = 2; names.has(name); i++) name = original.name + '_' + i;
    bone.name = name;
    names.add(name);
    const target = bones.get(parent) || root;
    target.add(bone);
    const local = target.matrixWorld.clone().invert().multiply(original.matrixWorld);
    local.decompose(bone.position, bone.quaternion, bone.scale);
    bone.quaternion.normalize();
    bone.scale.set(1,1,1);
    bone.updateMatrixWorld(true);
    indices.set(original, bones.size + 1);
    bones.set(original, bone);
  });
  return {root, bones, indices};
}

function restGeometry(mesh, rig) {
  const original = mesh.geometry, geometry = original.clone();
  const weights = original.getAttribute('skinWeight'), joints = original.getAttribute('skinIndex');
  const transforms = mesh.skeleton.bones.map((bone, i) => mesh.matrixWorld.clone()
    .multiply(mesh.bindMatrixInverse).multiply(bone.matrixWorld)
    .multiply(mesh.skeleton.boneInverses[i]).multiply(mesh.bindMatrix));
  const remap = mesh.skeleton.bones.map(bone => {
    if (!rig.indices.has(bone)) throw Error('配件未绑定至角色');
    return rig.indices.get(bone);
  });
  const position = original.getAttribute('position'), normal = original.getAttribute('normal');
  const vertex = new Vector3(), skin = new Matrix4(), normalMatrix = new Matrix3();
  const positions = new Float32Array(position.count * 3), normals = new Float32Array(positions.length);
  const newJoints = new Uint16Array(joints.count * 4);
  for (let v = 0; v < position.count; v++) {
    skin.elements.fill(0);
    for (let c = 0; c < 4; c++) {
      const index = joints.getComponent(v, c), weight = weights.getComponent(v, c);
      if (weight === 0) continue;
      newJoints[v * 4 + c] = remap[index];
      const matrix = transforms[index].elements;
      for (let j = 0; j < 16; j++) skin.elements[j] += weight * matrix[j];
    }
    vertex.fromBufferAttribute(position, v).applyMatrix4(skin).toArray(positions, v * 3);
    if (normal) vertex.fromBufferAttribute(normal, v).applyNormalMatrix(normalMatrix.getNormalMatrix(skin)).toArray(normals, v * 3);
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  if (normal) geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(newJoints, 4));
  geometry.deleteAttribute('tangent');
  geometry.computeBoundingBox();
  return geometry;
}

export async function exportVRM(model, name) {
  const source = clone(model.character);
  restoreExportPose(model, source);
  source.updateMatrixWorld(true);
  const rig = makeRig(source), scene = new Scene(), meshes = [], materials = new Map();
  scene.add(rig.root);
  let bodyBones, floor = Infinity, skeleton;
  function unlit(m) {
    if (!materials.has(m)) {
      const flat = new MeshBasicMaterial({
        name:m.name, map:m.map, color:m.color, opacity:m.opacity, alphaTest:m.alphaTest,
        transparent:m.transparent, side:m.side, vertexColors:m.vertexColors
      });
      materials.set(m, flat);
    }
    return materials.get(m);
  }
  try {
    source.traverseVisible(original => {
      if (!original.isMesh) return;
      if (!original.isSkinnedMesh) throw Error('缺少配件骨骼 ' + original.name);
      if (original.userData.role === 'body') bodyBones = original.skeleton.bones;
      const geometry = restGeometry(original, rig);
      const material = Array.isArray(original.material) ? original.material.map(unlit) : unlit(original.material);
      // Write the bind matrices once. Every part uses the same joint indices.
      const mesh = meshes.length ? new Mesh(geometry, material) : new SkinnedMesh(geometry, material);
      mesh.name = original.name;
      meshes.push(mesh);
      scene.add(mesh);
      floor = Math.min(floor, geometry.boundingBox.min.y);
    });
    if (!bodyBones || !Number.isFinite(floor)) throw Error('角色骨骼或网格不完整');
    rig.root.position.y = -floor;
    rig.root.updateMatrixWorld(true);
    skeleton = new Skeleton([rig.root, ...rig.bones.values()]);
    for (const mesh of meshes) mesh.geometry.translate(0, -floor, 0);
    meshes[0].bind(skeleton, new Matrix4());
    const exporter = new GLTFExporter();
    exporter.register(writer => ({
      writeNode(object, node) {
        if (object.isMesh) node.skin = 0;
      },
      afterParse() {
        const json = writer.json;
        writer.extensionsUsed.VRMC_vrm = true;
        json.extensions = {...json.extensions, VRMC_vrm:{
          specVersion:'1.0',
          meta:{
            name, version:'1.0', authors:['Nintendo (original game assets)'],
            copyrightInformation:(model.game === 'spl3' ? 'Splatoon 3' : 'Splatoon Raiders') + ' © Nintendo',
            licenseUrl:'https://vrm.dev/licenses/1.0/'
          },
          humanoid:humanoid(bodyBones, bone => writer.nodeMap.get(rig.bones.get(bone)))
        }};
      }
    }));
    const data = await exporter.parseAsync(scene, {binary:true, trs:true, maxTextureSize:4096});
    return new Blob([data], {type:'application/octet-stream'});
  } finally {
    for (const mesh of meshes) mesh.geometry.dispose();
    for (const material of materials.values()) material.dispose();
    skeleton?.dispose();
    source.traverse(o => o.skeleton?.dispose());
  }
}
