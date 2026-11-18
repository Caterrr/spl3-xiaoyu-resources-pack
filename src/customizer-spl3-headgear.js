// Fit data is tied to the exact canonical GLBs and loaded on the first try-on.
export async function loadHeadgearFit(headgear, hair) {
  const {default: fits} = await import('./customizer-spl3-headgear-fit-data.js?v=bb2bc35e917d');
  return fits[headgear.sha256.slice(0, 16)]?.[hair.sha256.slice(0, 16)];
}

export function applyHeadgearFit(fit, headgear, hair) {
  if (!fit) return;

  if (fit.offset || fit.width) {
    headgear.scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (fit.width) mesh.geometry.scale(fit.width, 1, fit.width);
      if (fit.offset) mesh.geometry.translate(...fit.offset);
    });
  }

  if (!fit.masks) return;
  hair.scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const binding = hair.parser.associations.get(mesh);
    if (!binding) return;
    const mask = fit.masks[binding.meshes + ':' + binding.primitives];
    if (!mask) return;

    const [triangleCount, bits] = mask;
    const indices = mesh.geometry.index?.array;
    if (indices?.length !== triangleCount * 3) throw Error('发型适配数据与模型不匹配');
    if (bits === null) {
      mesh.visible = false;
      return;
    }
    const removed = atob(bits);
    const visible = [];
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      if (removed.charCodeAt(triangle >> 3) & (1 << (triangle & 7))) continue;
      const index = triangle * 3;
      visible.push(indices[index], indices[index + 1], indices[index + 2]);
    }
    mesh.geometry.setIndex(visible);
  });
}
