import * as THREE from '../vendor/three/build/three.module.min.js';
import {OrbitControls} from '../vendor/three/examples/jsm/controls/OrbitControls.js';
import {GLTFLoader} from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import {loadModelFile} from '../model-files.js';
import {dispose} from '../customizer-core.js';
import {profiles} from './customizer-profiles.js';

const sources = new Map();
export async function characterSource(game) {
  if (!sources.has(game)) {
    const profile = profiles[game];
    if (!profile) throw Error('未知角色来源');
    sources.set(game, Promise.all([
      import(profile.core),
      fetch(profile.catalog).then(response => {
        if (!response.ok) throw Error('角色目录加载失败');
        return response.json();
      })
    ]).then(([core, catalog]) => ({core, catalog})).catch(error => {
      sources.delete(game);
      throw error;
    }));
  }
  return sources.get(game);
}

export function dimensions(settings) {
  const [w, h] = settings.size === 'custom' ? [settings.width, settings.height] : settings.size.split('x').map(Number);
  return settings.turned ? [h, w] : [w, h];
}

export function paintBackground(ctx, width, height, settings, photo) {
  if (settings.background === 'transparent') return;
  ctx.fillStyle = settings.first;
  if (settings.background === 'gradient') {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, settings.first);
    gradient.addColorStop(1, settings.second);
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, width, height);
  if (settings.background === 'photo' && photo) {
    const zoom = Math.max(width / photo.naturalWidth, height / photo.naturalHeight);
    const w = photo.naturalWidth * zoom, h = photo.naturalHeight * zoom;
    ctx.drawImage(photo, (width - w) / 2, (height - h) / 2, w, h);
  }
  if (settings.background === 'dots') {
    const step = Math.max(4, width / 20);
    ctx.fillStyle = settings.second;
    for (let y = 0, row = 0; y < height + step; y += step, row++) {
      for (let x = (row % 2) * step / 2; x <= width; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, step * .17, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
}

const vec = (...args) => new THREE.Vector3(...args);
export class StudioStage {
  constructor(canvas, onCamera, onMove) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true});
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.LinearToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.ambient = new THREE.HemisphereLight(0xffffff, 0x87828c, 2.4);
    this.key = new THREE.DirectionalLight(0xffffff, 2.6);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024,1024);
    this.key.shadow.bias = -.0003;
    this.key.shadow.normalBias = .015;
    this.fill = new THREE.DirectionalLight(0xe0efff, 1);
    this.fill.position.set(-3,2,-2);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.22,depthWrite:false}));
    this.ground.rotation.x = -Math.PI/2;
    this.ground.receiveShadow = true;
    this.ground.position.y = -.012;
    this.scene.add(this.ambient,this.key,this.key.target,this.fill,this.ground);
    this.camera = new THREE.PerspectiveCamera(34,1,.02,2000);
    this.camera.position.set(.3,1.1,5);
    this.controls = new OrbitControls(this.camera,canvas);
    this.controls.target.set(0,.9,0);
    this.controls.minDistance = .08;
    this.controls.maxDistance = 300;
    this.controls.maxPolarAngle = Math.PI*.98;
    this.slots = new Map();
    this.onMove = onMove;
    this.controls.addEventListener('change', () => this.render());
    this.controls.addEventListener('end', () => onCamera(this.cameraState()));
    this.installDrag();
  }
  installDrag() {
    const ray = new THREE.Raycaster();
    let drag;
    const hit = event => {
      const r=this.canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),this.camera);
    };
    this.canvas.addEventListener('pointerdown', event => {
      if (!this.moving || drag || event.button !== 0) return;
      hit(event);
      let object = ray.intersectObjects(this.world.children,true)[0]?.object;
      while (object && !object.userData.studioId) object=object.parent;
      if (!object) return;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(vec()), object.position);
      const point = ray.ray.intersectPlane(plane, vec());
      if (!point) return;
      drag={id:object.userData.studioId, offset:object.position.clone().sub(point), plane, pointer:event.pointerId};
      this.canvas.setPointerCapture(event.pointerId);
      this.onMove(drag.id, object.position, false);
    });
    this.canvas.addEventListener('pointermove', event => {
      if (!drag || drag.pointer!==event.pointerId) return;
      hit(event);
      const point = ray.ray.intersectPlane(drag.plane,vec());
      if (point) this.onMove(drag.id,point.add(drag.offset),false);
    });
    const end = event => {
      if (!drag || drag.pointer!==event.pointerId) return;
      const id=drag.id;
      drag=null;
      const slot=this.slots.get(id);
      if (slot?.group) this.onMove(id,slot.group.position,true);
    };
    for (const name of ['pointerup','pointercancel','lostpointercapture']) this.canvas.addEventListener(name,end);
  }
  setMoving(value) { this.moving=value; this.controls.enabled=!value; }
  render() { this.renderer.render(this.scene,this.camera); }
  cameraState() { return {position:this.camera.position.toArray(),target:this.controls.target.toArray()}; }
  restoreCamera(saved) {
    if (!saved) return;
    this.camera.position.fromArray(saved.position);
    this.controls.target.fromArray(saved.target);
    this.controls.update();
    this.render();
  }
  resize(w,h) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setSize(w,h,false);
    this.camera.aspect=w/h;
    this.camera.updateProjectionMatrix();
    this.render();
  }
  setLights(light) {
    this.key.intensity=light.key;
    this.ambient.intensity=light.ambient;
    this.renderer.toneMappingExposure=light.exposure;
    this.key.color.set(light.color);
    const angle=light.angle*Math.PI/180;
    this.key.position.set(Math.sin(angle)*5,4,Math.cos(angle)*5);
    this.ground.visible=light.shadow;
    this.render();
  }
  fit(clock=false,id=null,fraction=1) {
    const target=this.slots.get(id)?.group || this.world;
    const box=new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    const size=box.getSize(vec());
    if(fraction<1){
      box.min.y=box.max.y-size.y*fraction;
      const mid=(box.min.x+box.max.x)/2;
      box.min.x=mid-size.x*fraction/2;
      box.max.x=mid+size.x*fraction/2;
    }
    const center=box.getCenter(vec());
    const direction=this.camera.position.clone().sub(this.controls.target).normalize();
    const right=vec().crossVectors(this.camera.up,direction).normalize(), up=vec().crossVectors(direction,right);
    const slope=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2));
    if(clock) center.addScaledVector(up,size.y*fraction*.20);
    let distance=.1;
    for(const x of [box.min.x,box.max.x]) for(const y of [box.min.y,box.max.y]) for(const z of [box.min.z,box.max.z]){
      const corner=vec(x,y,z).sub(center);
      distance=Math.max(distance,corner.dot(direction)+1.12*Math.max(Math.abs(corner.dot(up)), Math.abs(corner.dot(right))/this.camera.aspect)/slope);
    }
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction,distance);
    this.controls.update();
    this.render();
  }
  remove(id) {
    const slot=this.slots.get(id);
    if (!slot) return;
    this.slots.delete(id);
    slot.controller.abort();
    if (slot.group) { this.world.remove(slot.group); dispose(slot.group); }
    this.render();
  }
  transform(actor) {
    const group=this.slots.get(actor.id)?.group;
    if(!group)return;
    group.position.set(actor.x,actor.y,actor.z);
    group.rotation.y=actor.angle*Math.PI/180;
    group.scale.setScalar(actor.scale);
    this.render();
  }
  async pose(actor) {
    const slot=this.slots.get(actor.id);
    if (!slot?.model) return;
    const wanted=actor.pose;
    const pose=await slot.core.loadPreviewPose(wanted);
    if(this.slots.get(actor.id)!==slot || actor.pose!==wanted)return;
    slot.core.setPreviewPose(slot.model,pose);
    this.render();
  }
  async load(actor) {
    this.remove(actor.id);
    const slot={controller:new AbortController()};
    this.slots.set(actor.id,slot);
    let object;
    try {
      if (actor.kind==='character') {
        const {core,catalog}=await characterSource(actor.game);
        if(this.slots.get(actor.id)!==slot)return;
        slot.core=core;
        slot.model=await core.assemble(catalog,core.normalize(actor.look,catalog));
        object=slot.model.character;
      } else {
        const blob=await loadModelFile(actor.item,'glb',{signal:slot.controller.signal});
        const asset=await new GLTFLoader().parseAsync(await blob.arrayBuffer(),'');
        object=asset.scene;
      }
      if (this.slots.get(actor.id)!==slot) {dispose(object);return;}
      const box=new THREE.Box3().setFromObject(object);
      if(box.isEmpty()) throw Error('模型没有可显示的几何体');
      const size=box.getSize(vec()), center=box.getCenter(vec());
      const base=actor.kind==='character' ? 1.65/Math.max(.001,size.y) :
        (actor.ground?9:.9)/Math.max(.001,size.x,size.y,size.z);
      const normalized=new THREE.Group();
      normalized.add(object);
      normalized.scale.setScalar(base);
      normalized.position.set(-center.x*base,-box.min.y*base,-center.z*base);
      const group=new THREE.Group();
      group.userData.studioId=actor.id;
      group.add(normalized);
      group.traverse(mesh=>{if(mesh.isMesh){mesh.castShadow=!actor.ground; mesh.receiveShadow=!!actor.ground;}});
      slot.group=group;
      this.world.add(group);
      this.transform(actor);
      if(slot.model) await this.pose(actor);
    } catch(error) {
      if(this.slots.get(actor.id)!==slot)return;
      if(object && !slot.group)dispose(object);
      this.remove(actor.id);
      throw error;
    }
  }
  async image(settings,photo) {
    const [baseW,baseH]=dimensions(settings);
    const w=Math.round(baseW*settings.scale),h=Math.round(baseH*settings.scale);
    if(w*h>64000000 || Math.max(w,h)>16384)throw Error('这张图超过导出上限，请调低倍率或尺寸。');
    const output=document.createElement('canvas');
    output.width=w;output.height=h;
    const ctx=output.getContext('2d');
    if(!ctx)throw Error('设备内存不足，请调低导出倍率。');
    paintBackground(ctx,w,h,settings,photo);
    const renderer=this.renderer;
    const original=renderer.getSize(new THREE.Vector2()), ratio=renderer.getPixelRatio();
    const camera=this.camera.clone();
    camera.aspect=w/h;
    const quality=settings.quality||1;
    const chunk=Math.max(2,Math.floor(Math.min(2048,renderer.capabilities.maxTextureSize)/quality/2)*2);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    try {
      renderer.setPixelRatio(1);
      for(let y=0;y<h;y+=chunk){
        for(let x=0;x<w;x+=chunk){
          const cw=Math.min(chunk,w-x), ch=Math.min(chunk,h-y);
          camera.setViewOffset(w,h,x,y,cw,ch);
          renderer.setSize(Math.round(cw*quality),Math.round(ch*quality),false);
          renderer.render(this.scene,camera);
          ctx.drawImage(this.canvas,x,y,cw,ch);
        }
      }
    } finally {
      renderer.setPixelRatio(ratio);
      renderer.setSize(original.x,original.y,false);
      this.render();
    }
    const mime=settings.format==='jpeg' && settings.background!=='transparent'?'image/jpeg':'image/png';
    const blob=await new Promise(resolve=>output.toBlob(resolve,mime,.94));
    output.width=output.height=1;
    if(!blob)throw Error('图片生成失败，请调低导出倍率。');
    return blob;
  }
}
