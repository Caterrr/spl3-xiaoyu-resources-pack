import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DEFAULTS,normalize,avatarId,browId,assetBytes} from './repo/src/customizer-core.js';
const catalog=JSON.parse(await fs.readFile(new URL('./repo/src/catalog/raiders/customizer.json',import.meta.url),'utf8'));
assert.deepEqual(normalize(DEFAULTS,catalog),DEFAULTS);
for(const species of ['squid','octopus'])for(const gender of ['female','male']){const state=normalize({species,gender,hair:'invalid',eye:99},catalog);assert(catalog.hair.some(x=>x.id===state.hair&&x.species===species));assert.equal(state.eye,20);assert(catalog.avatars.some(x=>x.id===avatarId(state)));}
const bad=normalize({species:'bad',gender:'bad',outfit:'bad',color:'javascript:x',eye:1.2},catalog);assert.equal(bad.species,'squid');assert.equal(bad.gender,'female');assert.equal(bad.outfit,DEFAULTS.outfit);assert.equal(bad.color,DEFAULTS.color);assert.equal(bad.eye,0);
const bytes=Buffer.from('test download integrity'),good={id:'test-retry',url:'data:application/octet-stream;base64,'+bytes.toString('base64'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
await assert.rejects(assetBytes({...good,sha256:'wrong'}),/校验失败/);
assert.deepEqual(Buffer.from(await assetBytes(good)),bytes);
assert.deepEqual(Buffer.from(await assetBytes(good)),bytes);
await assert.rejects(assetBytes({...good,id:'test-length',bytes:1}),/不完整/);
console.log('LOGIC_OK defaults, state validation, compatible hairstyle fallback, checksum failure, size failure, retry, cache');

for(const species of ['squid','octopus'])for(const gender of ['female','male'])for(let brow=0;brow<4;brow++){const s=normalize({species,gender,brow},catalog);assert.equal(s.brow,brow);assert(catalog.brows.some(x=>x.id===browId(s)&&x.style===brow&&x.species===species&&x.gender===gender));}
assert.equal(normalize({brow:'bad'},catalog).brow,1);assert.equal(normalize({brow:-2},catalog).brow,0);assert.equal(normalize({brow:8},catalog).brow,3);
console.log('BROW_LOGIC_OK all 16 source variants, invalid style fallback');
