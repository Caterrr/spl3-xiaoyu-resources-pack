import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const item={id:'item',name:'Sample',poster:'./model.webp',blend:'./file.blend',glb:'./file.glb',glbBytes:42,blendBytes:42};

function gallery({hasWebGL=true}={}){
 const elements=new Map(), events=[], calls={transfers:[],runtime:0,released:0};
 class Element extends EventTarget {
  dataset={};children=[];attributes={};open=true;style={setProperty(){}};classList={remove(){}};
  setAttribute(key,val){this.attributes[key]=val;}
  removeAttribute(key){delete this.attributes[key];}
  replaceChildren(...nodes){this.children=nodes;}
  append(node){this.children.push(node);}
  querySelector(tag){return this.children.find(el=>el.tag===tag);}
 }
 const document={
  querySelector(key){if(!elements.has(key))elements.set(key,new Element());return elements.get(key);},
  querySelectorAll(query){return query.includes('navigation')?[{dataset:{section:'weapons',game:'spl3'},getAttribute(){return 'page';},setAttribute(){},addEventListener(){}}]:[];},
  createElement(tag){const el=new Element();el.tag=tag;if(tag==='canvas')el.getContext=()=>hasWebGL?{getExtension:()=>({loseContext:()=>calls.released++})}:null;return el;}
 };
 const URLMock=class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}};
 const context=vm.createContext({
  document,window:{libraryGame:{key:'spl3',defaultSection:'weapons'},addEventListener(){},Spl3Metrics:{previewStart:()=>({error:e=>events.push(e),ready:()=>events.push('ready'),cancel(){}})}},
  location:{href:'https://example.test/library.html'},URL:URLMock,AbortController,setTimeout,requestAnimationFrame:fn=>fn(),
  customElements:{get:()=>({})}, runtimeModule:()=>{calls.runtime++;return Promise.resolve();},
  fileModule:Promise.resolve({loadModelFile:async (_item,format)=>{calls.transfers.push(format);return new Blob(['asset']);},saveModelFile(){}}),
  fetch:async()=>({ok:true,json:async()=>({items:[]})})
 });
 vm.runInContext(source.replace("import('./model-files.js?v=a8179dcb47a1')",'fileModule').replace("import('./vendor/model-viewer.min.js')",'runtimeModule()'),context);
 return {calls,events,get:key=>document.querySelector(key),select:()=>{context.item=item;return vm.runInContext('activeGroup=item; selectModelVariant();',context);},setWebGL:v=>{hasWebGL=v;}};
}

test('unsupported WebGL shows the correct poster and keeps both formats downloadable',async()=>{
 const app=gallery({hasWebGL:false});
 await app.select();
 await new Promise(resolve=>setTimeout(resolve,15));
 const image=app.get('#model-stage').children[0];
 assert.equal(app.get('#model-dialog').dataset.state,'error');
 assert.match(app.get('#model-status').textContent,/仍可下载模型/);
 assert.equal(image.src,'https://example.test/model.webp');
 assert.deepEqual(app.events,['viewer']);
 assert.equal(app.calls.runtime,0);
 assert.deepEqual(app.calls.transfers,[]);
 for(const format of ['glb','blend']){
  const link=app.get('#download-'+format);
  assert.match(link.href,new RegExp('file\\.'+format));
  link.onclick({preventDefault(){}});
 }
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(app.calls.transfers,['glb','blend']);
});

test('retry after WebGL becomes available keeps the regular interactive 3D path',async()=>{
 const app=gallery({hasWebGL:false});
 await app.select();
 await new Promise(resolve=>setTimeout(resolve,15));
 app.setWebGL(true);
 app.get('#model-retry').dispatchEvent(new Event('click'));
 await new Promise(resolve=>setTimeout(resolve,15));
 const viewer=app.get('#model-stage').children[0];
 assert.equal(viewer.tag,'model-viewer');
 assert.equal(viewer.attributes['camera-controls'],'');
 viewer.modelIsVisible=true;
 viewer.dispatchEvent(new Event('load'));
 assert.equal(app.get('#model-dialog').dataset.state,'ready');
 assert.deepEqual(app.events,['viewer','ready']);
 assert.deepEqual(app.calls.transfers,['glb']);
 assert.equal(app.calls.released,1);
});
