// Test the production assembly/export code with Node canvas and real asset bytes.
// This exercises glTF data and texture encoding without browser automation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const validator=require('gltf-validator');
const canvas=require('@napi-rs/canvas');
const root=path.dirname(fileURLToPath(import.meta.url));
globalThis.self=globalThis;
globalThis.ImageBitmap=canvas.Image;
globalThis.ImageData=canvas.ImageData;
globalThis.HTMLImageElement=canvas.Image;
globalThis.HTMLCanvasElement=canvas.CanvasElement;
globalThis.OffscreenCanvas=canvas.CanvasElement;
// NAPI has a non-browser data() method. Hide it so GLTFExporter uses Canvas,
// rather than mistaking it for THREE.DataTexture's {data: Uint8Array} shape.
Object.defineProperty(canvas.CanvasElement.prototype,'data',{value:undefined,configurable:true});
canvas.CanvasElement.prototype.convertToBlob=async function({type='image/png'}={}){return new Blob([this.toBuffer(type)],{type});};
canvas.CanvasElement.prototype.toBlob=function(callback,type='image/png'){callback(new Blob([this.toBuffer(type)],{type}));};
globalThis.document={createElement:name=>{if(name!=='canvas')throw Error(name);return canvas.createCanvas(1,1);},createElementNS:(_ns,name)=>{if(name==='img')return new canvas.Image();throw Error(name);}};
globalThis.Image=class extends canvas.Image{decode(){return this.complete?Promise.resolve():new Promise((resolve,reject)=>{this.onload=resolve;this.onerror=reject;});}};
globalThis.createImageBitmap=async blob=>canvas.loadImage(Buffer.from(await blob.arrayBuffer()));
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result=`data:${blob.type};base64,`+Buffer.from(v).toString('base64');this.onloadend?.();});}};
const assetPaths=new Map();
const nativeFetch=globalThis.fetch;
globalThis.fetch=async (url,options)=>assetPaths.has(url)?new Response(await fs.readFile(assetPaths.get(url))):typeof url==='string'&&url.startsWith('/assets/')?new Response(await fs.readFile(root+url)):nativeFetch(url,options);
globalThis.ProgressEvent=class{constructor(type,props){this.type=type;Object.assign(this,props);}};
const core=await import('./repo/src/customizer-core.js');
const THREE=await import('./repo/src/vendor/three/build/three.module.min.js');
const catalog=JSON.parse(await fs.readFile(root+'/repo/src/catalog/raiders/customizer.json','utf8'));
for(const e of [...catalog.avatars,...catalog.hair,...catalog.outfits,...catalog.brows])assetPaths.set(e.url,root+'/assets/'+e.id+'.glb');
await fs.mkdir(root+'/qa/exports',{recursive:true});
const all=process.argv.includes('--all');
const reports=[];
const jobs=[];
for(const species of ['squid','octopus'])for(const gender of ['female','male'])for(const outfit of (all?catalog.outfits:catalog.outfits.filter(x=>['Clt_AGL001','Clt_STR001','Clt_SPRL001','Clt_SPRL002'].includes(x.id)))){
 const hairs=catalog.hair.filter(x=>x.species===species),i=jobs.length;
 jobs.push(core.normalize({species,gender,outfit:outfit.id,hair:hairs[i%hairs.length].id,eye:i%21,brow:i%4,color:['#ff5d1c','#47b4df','#af46dd','#29c57a'][i%4]},catalog));
}
for(const [i,state] of jobs.entries()){
 const file=core.avatarId(state)+'-'+state.outfit+'.glb';
 const reportPath=root+'/qa/exports/'+file+'.json';
 if(all&&!process.argv.includes('--overwrite')&&await fs.stat(reportPath).then(()=>true).catch(()=>false)){reports.push(JSON.parse(await fs.readFile(reportPath,'utf8')));continue;}
 const model=await core.assemble(catalog,state);
 if(i===0){for(const [j,t] of model.tints.entries())await fs.writeFile(root+'/qa/canvas-tint-'+j+'.png',t.canvas.toBuffer('image/png'));await fs.writeFile(root+'/qa/canvas-eye.png',model.eyeCanvas.canvas.toBuffer('image/png'));}
 const browRoots=[];model.character.traverse(o=>{if(/^Eyb_/.test(o.name))browRoots.push(o);});if(browRoots.length!==1||browRoots[0].name!==core.browId(state))throw Error('Wrong/duplicate eyebrows '+browRoots.map(o=>o.name));
 const attached=new Set();model.character.traverse(o=>attached.add(o));model.character.traverse(o=>{if(o.skeleton)for(const b of o.skeleton.bones)if(!attached.has(b))throw Error('Unattached joint '+o.name+' / '+b.name+' parent '+b.parent?.name);});
 model.character.updateMatrixWorld(true);
 let meshes=0,skinVertices=0;const rigBones=new Set();model.rig.traverse(o=>{if(o.isBone)rigBones.add(o);});
 const meshWorld=[];
 model.character.traverse(o=>{if(!o.isMesh||!o.visible)return;meshes++;if(o.isSkinnedMesh){skinVertices+=o.geometry.attributes.position.count;o.skeleton.update();for(const b of o.skeleton.bones){if(!b.parent)throw Error('Detached bone: '+b.name);}}
   const v=new THREE.Vector3();for(let j=0;j<o.geometry.attributes.position.count;j++){o.getVertexPosition(j,v);v.applyMatrix4(o.matrixWorld);if(![v.x,v.y,v.z].every(Number.isFinite))throw Error('Nonfinite vertex');}meshWorld.push(o);});
 const arm=[...rigBones].find(x=>x.name==='Arm_2_L');
 const sample=meshWorld.filter(x=>x.isSkinnedMesh).map(o=>{const a=[];const v=new THREE.Vector3();for(let j=0;j<o.geometry.attributes.position.count;j++){o.getVertexPosition(j,v);a.push(v.clone().applyMatrix4(o.matrixWorld));}return {o,a};});
 const rest=arm.quaternion.clone();arm.rotateX(.4);model.character.updateMatrixWorld(true);model.character.traverse(o=>o.skeleton?.update());
 let moved=0;for(const {o,a} of sample){const v=new THREE.Vector3();let max=0;for(let j=0;j<a.length;j++){o.getVertexPosition(j,v);max=Math.max(max,v.applyMatrix4(o.matrixWorld).distanceTo(a[j]));}if(max>.001)moved++;}
 if(moved<2)throw Error('Garment does not follow arm');arm.quaternion.copy(rest);model.character.updateMatrixWorld(true);model.character.traverse(o=>o.skeleton?.update());
 const head=[...rigBones].find(x=>x.name==='Head'),browMesh=meshWorld.find(o=>o.name.startsWith('Eyeb')),q=head.quaternion.clone();if(!browMesh)throw Error('Missing eyebrow mesh');const browPoint=()=>browMesh.getVertexPosition(0,new THREE.Vector3()).applyMatrix4(browMesh.matrixWorld),before=browPoint();head.rotateX(.35);model.character.updateMatrixWorld(true);model.character.traverse(o=>o.skeleton?.update());if(browPoint().distanceTo(before)<.001)throw Error('Eyebrows did not follow head');head.quaternion.copy(q);model.character.updateMatrixWorld(true);model.character.traverse(o=>o.skeleton?.update());
 const bytes=await core.exportCharacter(model);
 const validation=await validator.validateBytes(new Uint8Array(bytes),{maxIssues:30});
 if(validation.issues.numErrors)throw Error(JSON.stringify(validation.issues));
 const doc=JSON.parse(Buffer.from(bytes,20,new DataView(bytes).getUint32(12,true)).toString());
 if(!doc.skins?.length||doc.images.some(x=>!('bufferView' in x)))throw Error('Missing embedded skins/textures');
 await fs.writeFile(root+'/qa/exports/'+file,Buffer.from(bytes));
 const report={file,state,meshes,skinVertices,moved,bytes:bytes.byteLength,skins:doc.skins.length,images:doc.images.length,errors:validation.issues.numErrors,warnings:validation.issues.numWarnings};
 await fs.writeFile(reportPath,JSON.stringify(report));reports.push(report);core.dispose(model.character);console.log('ROUNDTRIP_OK',i+1,jobs.length,file,bytes.byteLength);
}
await fs.writeFile(root+'/qa/runtime-results.json',JSON.stringify(reports,null,2));console.log('RUNTIME_DONE',reports.length);
