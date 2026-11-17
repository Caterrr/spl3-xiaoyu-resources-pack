// The Blender 4.5 template stores the selected GLB in a native integer-array
// scene property. Only that array, its two counts and its DATA size change.
const templateURL = new URL('./rig/character-v1.blend.gz', import.meta.url);
const decoder = new TextDecoder();
let templatePromise;

async function loadTemplate() {
  const response = await fetch(templateURL);
  if (!response.ok) throw new Error('动画骨骼下载失败');
  const body = await response.blob();
  const signature = new Uint8Array(await body.slice(0, 2).arrayBuffer());
  if (signature[0] !== 31 || signature[1] !== 139) return body.arrayBuffer();
  return new Response(body.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

export function insertCharacter(template, character) {
  const bytes = new Uint8Array(template);
  const view = new DataView(template);
  const glb = new DataView(character);
  if (decoder.decode(bytes.subarray(0, 12)) !== 'BLENDER-v405' ||
      glb.byteLength < 20 || glb.getUint32(0, true) !== 0x46546c67 ||
      glb.getUint32(8, true) !== glb.byteLength || glb.byteLength % 4) {
    throw new Error('动画工程数据不完整');
  }
  for (let block = 12; block + 24 <= bytes.length;) {
    const data = block + 24;
    const size = view.getUint32(block + 4, true);
    const next = data + size;
    if (next > bytes.length) break;
    if (size === 136 && decoder.decode(bytes.subarray(data + 20, data + 38)) === 'yy_character_data\0') {
      if (next + 88 > bytes.length ||
          view.getBigUint64(data + 88, true) !== view.getBigUint64(next + 8, true) ||
          view.getUint32(data + 120, true) !== 16 || view.getUint32(data + 124, true) !== 16 ||
          view.getUint32(next + 4, true) !== 64 || view.getUint32(next + 24, true) !== 1122071001) break;
      const header = bytes.slice(0, next + 24);
      const out = new DataView(header.buffer);
      out.setUint32(data + 120, glb.byteLength / 4, true);
      out.setUint32(data + 124, glb.byteLength / 4, true);
      out.setUint32(next + 4, glb.byteLength, true);
      return new Blob([header, character, bytes.subarray(next + 88)], {type:'application/octet-stream'});
    }
    block = next;
  }
  throw new Error('动画骨骼模板版本不匹配');
}

export async function blenderCharacter(character) {
  templatePromise ??= loadTemplate().catch(error => {templatePromise = null; throw error;});
  return insertCharacter(await templatePromise, character);
}
