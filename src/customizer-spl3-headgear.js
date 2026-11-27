import {Matrix4} from './vendor/three/build/three.module.min.js';

// Fitting changes the accessory's placement only. The original hair always stays visible.
export async function loadHeadgearFit(headgear, hair) {
  const {default: fits} = await import('./customizer-spl3-headgear-fit-data.js?v=4a4d8ed1aa9b');
  return fits[headgear.sha256.slice(0, 16)]?.[hair.sha256.slice(0, 16)];
}

export function applyHeadgearFit(fit, headgear) {
  if (!fit) return;
  headgear.scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    if (fit.width) mesh.geometry.scale(fit.width, 1, fit.width);
    if (fit.offset) mesh.geometry.translate(...fit.offset);
  });
}

export function mountLibraryHeadgear(character, rig, scene, entry, fit) {
  const head = rig.getObjectByName('Head');
  if (!head?.isBone) throw Error('发饰缺少头部挂点');

  // Move the complete library asset into character bind space, then parent it to the head.
  // Its original materials, geometry and accessory bones travel together.
  const [x, y, z] = fit?.offset ?? [0, 0, 0];
  const width = fit?.width ?? 1;
  const placement = new Matrix4().makeTranslation(x, y, z)
    .multiply(new Matrix4().makeScale(width, 1, width))
    .multiply(new Matrix4().fromArray(entry.headMount));
  scene.name = entry.source;
  scene.userData = {game: 'spl3', kind: 'headgear', source: entry.source};
  scene.applyMatrix4(placement);
  character.add(scene);
  character.updateMatrixWorld(true);
  head.attach(scene);
}
