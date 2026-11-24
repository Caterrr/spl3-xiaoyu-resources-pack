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

assert.equal(normalize({},catalog).skin,3);
assert.equal(normalize({skin:'bad'},catalog).skin,3);
assert.equal(normalize({skin:-1},catalog).skin,0);
assert.equal(normalize({skin:99},catalog).skin,8);
assert.equal(normalize({skin:1.5},catalog).skin,3);
const spl3=await import('./repo/src/customizer-spl3-core.js');
const wear={variants:{female:{},male:{}}};
const spl3Catalog={game:'spl3',eyes:Array.from({length:21},(_,i)=>({id:String(i)})),hair:[{id:'spl3:Har_SQD001',species:'squid',...wear},{id:'spl3:Har_OCT001',species:'octopus',...wear}],clothes:[{id:'spl3:Clt_TES000',...wear}],bottoms:[{id:'spl3:Btm_000',...wear}],shoes:[{id:'spl3:Shs_SDL000',...wear}],headgear:[{id:'spl3:none:headgear',empty:true}]};
assert.deepEqual(spl3.normalize(spl3.DEFAULTS,spl3Catalog),spl3.DEFAULTS);
for(const [skin,expected] of [[undefined,3],['bad',3],[-1,0],[99,8],[1.5,3]])assert.equal(spl3.normalize(skin===undefined?{}:{skin},spl3Catalog).skin,expected);
console.log('SKIN_LOGIC_OK default tone, invalid index fallback, spl3 normalize');
