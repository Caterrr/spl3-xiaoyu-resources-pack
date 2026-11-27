import * as THREE from './vendor/three/build/three.module.min.js';
import {clone} from './vendor/three/examples/jsm/utils/SkeletonUtils.js';
import {restoreExportPose, setPreviewPose, loadPreviewPose} from './customizer-spl3-poses.js?v=7800c405309e';

const resolution = 1024;

// Offsets in character-facing coordinates, in the same units as the avatar rig.
const expressions = {
  neutral: {},
  smile: {corner:[.022,.027,0], cheek:[.004,.011,0], brow:[0,.007,0]},
  pout: {corner:[-.029,-.006,.014], cheek:[.012,.004,.008], brow:[-.006,-.009,0]},
  brow: {leftBrow:[0,.034,0], rightBrow:[0,-.010,0], leftCorner:[.013,.012,0]}
};

function facialControls(character) {
  const tracked = [];
  character.traverse(object => {
    if (!object.isBone) return;
    // The separate eyebrow armature receives a numeric suffix from GLTFLoader.
    const match = /^(Mouth_Corner|Head_Cheek|Head_Eyeblow)_([LR])(?:_\d+)?$/.exec(object.name);
    if (!match) return;
    const part = {Mouth_Corner:'corner', Head_Cheek:'cheek', Head_Eyeblow:'brow'}[match[1]];
    const side = match[2] === 'L' ? 'left' : 'right';
    tracked.push({bone:object, start:object.position.clone(), part, side});
  });
  return expression => {
    const settings = expressions[expression];
    for (const {bone, start, part, side} of tracked) {
      bone.position.copy(start);
      const offset = settings[side + part[0].toUpperCase() + part.slice(1)] || settings[part];
      if (!offset) continue;
      const [out, up, forward] = offset;
      const world = bone.parent.localToWorld(start.clone());
      world.add(new THREE.Vector3(side === 'left' ? out : -out, up, forward));
      bone.position.copy(bone.parent.worldToLocal(world));
    }
    character.updateMatrixWorld(true);
  };
}

function portraitCameras(character) {
  const eyes = character.getObjectByProperty('name', 'Eye_Model__M_Eye');
  const face = new THREE.Box3().setFromObject(eyes, true).getCenter(new THREE.Vector3());
  const vertex = new THREE.Vector3();
  let top = face.y, halfWidth = 0;
  character.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
      top = Math.max(top, vertex.y);
      if (vertex.y >= face.y - .06) halfWidth = Math.max(halfWidth, Math.abs(vertex.x - face.x));
    }
  });
  function cameraAbove(bone, margin) {
    const bottom = character.getObjectByName(bone).getWorldPosition(vertex).y - margin;
    const span = Math.max((top - bottom) / .91, 2 * halfWidth / .94);
    const middle = top + span * .07 - span / 2;
    const camera = new THREE.OrthographicCamera(-span/2, span/2, span/2, -span/2, .01, 12);
    camera.position.set(face.x, middle, face.z + 4);
    camera.lookAt(face.x, middle, face.z);
    return camera;
  }
  return {head:cameraAbove('Neck', .065), bust:cameraAbove('Waist', .085)};
}

function actionCamera(character,standCameras,framing,settings) {
  const {yaw,pitch,zoom,panX,panY}=settings;
  const az=THREE.MathUtils.degToRad(yaw),el=THREE.MathUtils.degToRad(pitch);
  const direction=new THREE.Vector3(Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el));
  const right=new THREE.Vector3(Math.cos(az),0,-Math.sin(az));
  const up=direction.clone().cross(right);
  const eye=character.getObjectByName('Eye_Model__M_Eye');
  const face=new THREE.Box3().setFromObject(eye,true).getCenter(new THREE.Vector3());
  const headRadius=standCameras.head.top;
  let center=face.clone().addScaledVector(up,headRadius*.10), span=headRadius*2;
  if(framing==='bust') {
    let left=-headRadius,top=headRadius*1.10,bottom=-headRadius*.85,rgt=headRadius;
    character.traverse(bone=>{
      if(!bone.isBone || !/^(Waist|Spine\w*|Neck|Arm\w*|Hand\w*|Wrist\w*|Elbow\w*)(?:_[LR])?$/.test(bone.name))return;
      const point=bone.getWorldPosition(new THREE.Vector3()).sub(face);
      const x=point.dot(right),y=point.dot(up),pad=headRadius*.12;
      left=Math.min(left,x-pad);rgt=Math.max(rgt,x+pad);
      top=Math.max(top,y+pad);bottom=Math.min(bottom,y-pad);
    });
    span=Math.max(rgt-left,top-bottom)*1.08;
    center=face.clone().addScaledVector(right,(rgt+left)/2).addScaledVector(up,(top+bottom)/2);
  }
  span/=zoom;
  center.addScaledVector(right,-panX*span).addScaledVector(up,panY*span);
  const camera=new THREE.OrthographicCamera(-span/2,span/2,span/2,-span/2,.01,18);
  camera.up.copy(up);camera.position.copy(center).addScaledVector(direction,6);camera.lookAt(center);camera.updateMatrixWorld();
  return camera;
}

function squarePng(renderer, scene, camera, restore) {
  const size = renderer.getSize(new THREE.Vector2());
  const ratio = renderer.getPixelRatio();
  try {
    renderer.setDrawingBufferSize(resolution, resolution, 1);
    renderer.render(scene, camera);
    return new Promise((resolve, reject) => renderer.domElement.toBlob(blob =>
      blob ? resolve(blob) : reject(Error('照片生成失败，请重试。')), 'image/png'));
  } finally {
    renderer.setDrawingBufferSize(size.x, size.y, ratio);
    restore();
  }
}

export async function openPortrait({model, renderer, sourceScene, render, gameName, currentPose, poses, camera:editorCamera}) {
  const dialog = document.querySelector('#portrait-dialog');
  const image = dialog.querySelector('img');
  const save = dialog.querySelector('[download]');
  const useAvatar = dialog.querySelector('[data-book-avatar]');
  const message = dialog.querySelector('[role=status]');
  const expression = dialog.querySelector('[name=expression]');
  const background = dialog.querySelector('[type=color]');
  const events = new AbortController();
  const {signal} = events;
  const scene = new THREE.Scene();
  const poseSelect=dialog.querySelector('[name=photoPose]'), tools=dialog.querySelector('.portrait-pose-tools');
  const view=dialog.querySelector('.portrait-preview'), roll=dialog.querySelector('[data-roll]');
  const ranges=Object.fromEntries(['yaw','pitch','zoom'].map(key=>[key,dialog.querySelector('[name='+key+']')]));
  const posed=()=>dialog.querySelector('[name=shot]:checked').value==='pose';
  const dir=editorCamera.getWorldDirection(new THREE.Vector3()).negate();
  const initialYaw=Math.round(THREE.MathUtils.radToDeg(Math.atan2(dir.x,dir.z)));
  const initialPitch=Math.round(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y,-1,1))));
  let character, cameraBase, puppet, applyExpression, poseKey, photoURL, frame=0, revision=0;
  let panX=0,panY=0,drag=null;
  function centerFrame(){ranges.yaw.value=initialYaw;ranges.pitch.value=initialPitch;ranges.zoom.value=100;panX=panY=0;}
  centerFrame();
  const groups=new Map();
  poseSelect.replaceChildren(new Option('初始姿势','rest'));
  for(const pose of poses) {
    if(pose.id==='rest')continue;
    if(!groups.has(pose.group)){const group=document.createElement('optgroup');group.label=pose.group||'姿势';groups.set(pose.group,group);poseSelect.append(group);}
    groups.get(pose.group).append(new Option(pose.label||pose.id,pose.id));
  }
  poseSelect.value=currentPose||'rest';
  if(poseSelect.selectedIndex<0)poseSelect.value='rest';
  dialog.querySelector('[name=shot][value='+(currentPose&&currentPose!=='rest'&&currentPose!=='stand'?'pose':'front')+']').checked=true;
  function changeMode(){tools.hidden=!posed();view.classList.toggle('free-framing',posed());}
  changeMode();
  let finish;
  const closed = new Promise(resolve => { finish = resolve; });
  const reset = () => {
    if (useAvatar) useAvatar.disabled = true;
    save.removeAttribute('href');
    save.setAttribute('aria-disabled','true');
  };
  function update() {
    const ticket = ++revision;
    reset();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(async () => {
      try {
        const framing = dialog.querySelector('[name=framing]:checked');
        const active=posed(), next=active?poseSelect.value:'stand';
        if(poseKey!==next) {
          const data=await loadPreviewPose(next);
          if(signal.aborted || ticket!==revision)return;
          if(applyExpression)applyExpression('neutral');
          setPreviewPose(puppet,data);
          applyExpression=facialControls(character);poseKey=next;
        }
        applyExpression(expression.value);
        scene.background.set(background.value);
        const camera=active?actionCamera(character,cameraBase,framing.value,{
          yaw:+ranges.yaw.value,pitch:+ranges.pitch.value,zoom:+ranges.zoom.value/100,panX,panY
        }):cameraBase[framing.value];
        const blob=await squarePng(renderer,scene,camera,render);
        if (signal.aborted || ticket !== revision) return;
        const previous = photoURL;
        photoURL = URL.createObjectURL(blob);
        image.src = save.href = photoURL;
        image.hidden = false;
        save.download = [gameName, model.state.species === 'squid' ? '鱿鱼' : '章鱼',
          framing.value === 'head' ? '头像' : '半身照', expression.selectedOptions[0].text].join('-') + '.png';
        save.removeAttribute('aria-disabled');
        if (useAvatar) useAvatar.disabled = false;
        message.textContent = '';
        if (previous) URL.revokeObjectURL(previous);
      } catch {
        if (signal.aborted || ticket !== revision) return;
        image.hidden = true;
        message.textContent = '照片生成失败，请关闭后重试。';
      }
    });
  }
  useAvatar?.addEventListener('click', async () => {
    const ticket = revision;
    try {
      await image.decode();
      if (signal.aborted || ticket !== revision) return;
      const thumb = document.createElement('canvas');
      thumb.width = thumb.height = 128;
      const ctx = thumb.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image,0,0,128,128);
      localStorage.setItem('ink-board-avatar', thumb.toDataURL('image/png'));
      localStorage.removeItem('ink-board-recipe');
      location.assign(new URL('./guestbook.html',import.meta.url));
    } catch { message.textContent = '头像保存失败，请重试。'; }
  }, {signal});
  reset();
  image.hidden = true;
  message.textContent = '正在取景…';
  dialog.addEventListener('close', () => {
    events.abort();
    cancelAnimationFrame(frame);
    image.removeAttribute('src');
    reset();
    if (photoURL) URL.revokeObjectURL(photoURL);
    // Skeletons belong to the copy. Materials and geometry belong to the editor.
    character?.traverse(object => object.skeleton?.dispose());
    finish();
  }, {once:true});
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close(), {signal});
  renderer.domElement.addEventListener('webglcontextlost', () => dialog.close(), {signal});
  dialog.showModal();
  async function prepare() {
    try {
      const standing = await loadPreviewPose('stand');
      if (signal.aborted) return;
      character = clone(model.character);
      restoreExportPose(model, character);
      puppet={character,state:model.state,game:model.game};setPreviewPose(puppet,standing);poseKey='stand';
      scene.add(character);
      sourceScene.children.filter(object => object.isLight).forEach(light => scene.add(light.clone()));
      scene.background = new THREE.Color();
      applyExpression = facialControls(character);
      cameraBase = portraitCameras(character);
      dialog.addEventListener('input',()=>{changeMode();update();},{signal});
      roll.addEventListener('click',()=>{
        const choices=poses.filter(p=>p.id!==poseSelect.value && p.id!=='rest');
        if(choices.length){poseSelect.value=choices[Math.floor(Math.random()*choices.length)].id;update();}
      },{signal});
      dialog.querySelector('[data-center]').addEventListener('click',()=>{centerFrame();update();},{signal});
      view.addEventListener('pointerdown',e=>{
        if(!posed()||e.button!==0)return;
        drag={id:e.pointerId,x:e.clientX,y:e.clientY,px:panX,py:panY};
        view.setPointerCapture(e.pointerId);
      },{signal});
      view.addEventListener('pointermove',e=>{
        if(!drag||drag.id!==e.pointerId)return;
        const w=view.getBoundingClientRect().width||1;
        panX=THREE.MathUtils.clamp(drag.px+(e.clientX-drag.x)/w,-1,1);
        panY=THREE.MathUtils.clamp(drag.py+(e.clientY-drag.y)/w,-1,1);update();
      },{signal});
      view.addEventListener('lostpointercapture',()=>{drag=null;},{signal});
      view.addEventListener('keydown',e=>{
        if(!posed()||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
        e.preventDefault();
        panX=THREE.MathUtils.clamp(panX+({ArrowLeft:-.025,ArrowRight:.025}[e.key]||0),-1,1);
        panY=THREE.MathUtils.clamp(panY+({ArrowUp:-.025,ArrowDown:.025}[e.key]||0),-1,1);update();
      },{signal});
      update();
    } catch {
      if (!signal.aborted) message.textContent = '角色取景失败，请关闭后重试。';
    }
  }
  prepare();
  await closed;
}
