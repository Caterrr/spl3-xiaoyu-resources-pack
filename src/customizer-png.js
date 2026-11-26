// Snapshot the current pose and camera before returning the canvas to its preview background.
export function captureTransparentPng(renderer, scene, camera) {
  const background = scene.background;
  const clearAlpha = renderer.getClearAlpha();
  try {
    scene.background = null;
    renderer.setClearAlpha(0);
    renderer.render(scene, camera);
    return new Promise((resolve, reject) => {
      renderer.domElement.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('无法生成 PNG'));
      }, 'image/png');
    });
  } finally {
    scene.background = background;
    renderer.setClearAlpha(clearAlpha);
    renderer.render(scene, camera);
  }
}
