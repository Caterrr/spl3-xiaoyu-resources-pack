import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

export function applyGearMaterials(dist) {
  const read = path => readFileSync(new URL(path, dist));
  const write = (path, value) => writeFileSync(new URL(path, dist), value);
  const catalogPath = section => 'catalog/spl3/' + section + '.json';
  const customizer = JSON.parse(read(catalogPath('customizer')));
  const fitPath = 'customizer-spl3-headgear-fit-data.js';
  let fits = read(fitPath).toString();
  const library = {};
  for (const group of ['shoes', 'headgear', 'clothes']) {
    library[group] = JSON.parse(read(catalogPath(group)));
  }
  const base = 'https://caterrr.github.io/spl3-xiaoyu-resources-pack/';
  for (const source of readdirSync(new URL('gear-materials/', dist))) {
    const group = {Shs:'shoes', Hed:'headgear', Clt:'clothes'}[source.slice(0,3)];
    const folder = 'gear-materials/' + source + '/';
    const assets = {};
    for (const name of readdirSync(new URL(folder, dist))) {
      const extension = name.slice(name.indexOf('.') + 1);
      const path = folder + name;
      const bytes = extension === 'glb.gz' ? gunzipSync(read(path)) : read(path);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (!name.startsWith(sha256.slice(0,16) + '.')) throw Error('Gear file hash mismatch: ' + path);
      assets[extension] = {url: base + path, sha256, bytes: bytes.length};
    }
    const worn = assets['glb.gz'];
    let matched = false;
    for (const entry of customizer[group]) {
      for (const variant of Object.values(entry.variants || {})) {
        if (variant.source !== source) continue;
        if (group === 'headgear') {
          fits = fits.replaceAll('"' + variant.sha256.slice(0,16) + '":', '"' + worn.sha256.slice(0,16) + '":');
        }
        Object.assign(variant, worn);
        if (assets.webp) entry.poster = variant.poster = assets.webp.url;
        matched = true;
      }
    }
    if (!matched) throw Error('Gear missing from customizer: ' + source);
    if (!assets.glb) continue;
    const items = library[group].items.filter(item => item.source === source);
    if (!items.length) throw Error('Gear missing from model library: ' + source);
    for (const item of items) {
      for (const [field, asset] of Object.entries({glb:assets.glb, blend:assets.blend, poster:assets.webp})) {
        item[field] = asset.url;
        item[field + 'Sha256'] = asset.sha256;
        item[field + 'Bytes'] = asset.bytes;
      }
    }
  }
  for (const [section, data] of Object.entries({...library, customizer})) {
    write(catalogPath(section), JSON.stringify(data));
  }
  write(fitPath, fits);

  // Update only existing cache keys in the built site. The source pages stay authoritative.
  function version(page, dependency, reference = dependency) {
    const content = read(page).toString();
    const token = createHash('sha256').update(read(dependency)).digest('hex').slice(0,12);
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('(' + escaped + ')(?:\\?v=[0-9a-f]+)?(?=[\'"])', 'g');
    if (!pattern.test(content)) throw Error('Missing asset reference: ' + page + ' -> ' + reference);
    write(page, content.replace(pattern, '$1?v=' + token));
  }
  version('customizer-spl3-headgear.js', fitPath);
  version('customizer-spl3-core.js', 'customizer-spl3-headgear.js');
  version('customizer-blend.js', 'rig/character-v1.blend.gz');
  for (const dir of ['', 'studio-preview/']) {
    const script = dir + 'customizer.js';
    const profile = dir ? dir + 'customizer-profiles.js' : script;
    version(profile, catalogPath('customizer'));
    version(profile, 'customizer-spl3-core.js');
    if (dir) version(script, profile, 'customizer-profiles.js');
    version(script, 'customizer-blend.js');
    version(dir + 'customizer.html', script, 'customizer.js');
  }
  version('avatar-studio.js', catalogPath('customizer'));
  version('avatar-studio.js', 'customizer-spl3-core.js');
  version('avatar-studio.html', 'avatar-studio.js');
  for (const section of Object.keys(library)) version('library.html', catalogPath(section));
}
