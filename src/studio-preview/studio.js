import {StudioStage,characterSource,dimensions,paintBackground} from './studio-stage.js';
import {actor,project,records,writeProject,lightPresets,handoff,handoffURL} from './studio-store.js';

const el=id=>document.getElementById(id);
const option=(label,value)=>new Option(label,value);
const note=text=>{el('status').textContent=text;};
const gameNames={spl3:'喷 3',raiders:'涂击队'};
const sections={
  spl3:{weapons:'武器','sub-special':'技能',props:'杂物',decor:'装饰',maps:'地图',scenes:'场景',characters:'角色模型',clothes:'衣服',headgear:'发饰',shoes:'鞋子'},
  raiders:{weapons:'武器',skills:'技能',props:'杂物',decor:'装饰',maps:'地图',scenes:'场景',characters:'角色模型',clothing:'服装'},
  phantom:{weapons:'武器',skills:'技能',props:'杂物',decor:'装饰',maps:'地图',scenes:'场景',characters:'角色模型'}
};
const params=new URLSearchParams(location.search);
const entryGame=params.get('game')==='raiders'?'raiders':'spl3';
const returnPage='./customizer.html?game='+entryGame;
el('back').href=returnPage;
let current,stage,photo,photoToken=0,saveTimer,exporting=false,generation=0,initialFrame=false;
let poseRevision=0,libraryRevision=0,libraryItems=[],limit=36,lostContext=false;
const pending=new Map(),failures=new Map();
const selected=()=>current?.actors.find(entry=>entry.id===current.selected);
const errorText=e=>e?.message||'操作未完成，请重试。';
const safe=fn=>async event=>{try{await fn(event);}catch(e){note(errorText(e));}};
const dirty=new WeakSet();
let saveQueue=Promise.resolve();
function save() {
  clearTimeout(saveTimer);
  const doc=current;
  if(!doc || !dirty.has(doc))return saveQueue;
  dirty.delete(doc);
  const copy=structuredClone(doc);
  const task=saveQueue.then(async()=>{
    if(copy.id!==doc.id){copy.id=doc.id;copy.name=doc.name;}
    copy.updated=Date.now();
    const result=await writeProject(copy,doc.revision);
    doc.revision=result.revision;
    if(result.forked){
      doc.id=result.id;doc.name=result.name;
      if(current===doc){rememberProject();note('其他标签页更新了原项目，当前改动已保存为副本。');}
    }
  });
  saveQueue=task.catch(()=>{dirty.add(doc);note('项目未能保存，请检查浏览器存储空间。');});
  return task;
}
function changed() {
  if(!current)return;
  dirty.add(current);
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>save().catch(()=>{}),220);
}
function remembered(key,storage=localStorage){try{return storage.getItem(key);}catch{return null;}}
function rememberProject() {
  try{
    sessionStorage.setItem('xiaoyu-open-studio',current.id);
    localStorage.setItem('xiaoyu-last-studio',current.id);
  }catch{}
  const url=new URL(location.href);
  url.searchParams.set('project',current.id);url.hash='';
  history.replaceState(null,'',url);
}
function character(game,look=null,pose='rest') {
  if(!look){try{look=JSON.parse(remembered('studio-preview-'+game+'-character-v1')||remembered(game+'-character-v1'));}catch{}}
  return {kind:'character',game,look:look||{},pose:pose||'rest'};
}
function loadStatus(){
  el('retry').hidden=failures.size===0;
  el('export').disabled=lostContext || exporting || pending.size>0 || failures.size>0 || !current?.actors.length;
  if(lostContext)note('三维预览已暂停，正在等待浏览器恢复…');
  else if(pending.size)note('正在加载 '+pending.size+' 个模型…');
  else if(failures.size)note([...failures.values()].join(' · '));
  else note('');
}
async function loadActor(a){
  const version=generation;
  const ticket=Symbol();
  pending.set(a.id,ticket);failures.delete(a.id);loadStatus();
  try{await stage.load(a);}
  catch(e){if(version===generation && pending.get(a.id)===ticket && current.actors.includes(a))failures.set(a.id,a.name+'：'+errorText(e));}
  finally{
    if(version===generation && pending.get(a.id)===ticket){
      pending.delete(a.id);loadStatus();
      if(!pending.size && initialFrame){
        initialFrame=false;stage.fit(current.settings.clock); current.camera=stage.cameraState();changed();
      }
    }
  }
}
async function setProject(next){
  ++generation;
  for(const id of [...stage.slots.keys()])stage.remove(id);
  current=next;current.settings.quality??=1;current.settings.framing??='all';pending.clear();failures.clear();initialFrame=!next.camera;
  current.selected=selected()?.id||current.actors[0]?.id;
  rememberProject();
  repaintSettings();drawActors();
  stage.restoreCamera(current.camera);
  await Promise.all(current.actors.map(loadActor));loadStatus();
}
function resize(){
  if(!current||!stage)return;
  const [w,h]=dimensions(current.settings);
  const area=el('frame').parentElement.getBoundingClientRect();
  const scale=Math.max(.001,Math.min(Math.max(1,area.width-24)/w,Math.max(1,area.height-66)/h));
  const pw=Math.max(1,Math.round(w*scale)),ph=Math.max(1,Math.round(h*scale));
  const frame=el('frame');
  frame.style.width=pw+'px';frame.style.height=ph+'px';frame.style.marginBottom='35px';
  el('lock').style.fontSize=Math.min(pw*.05,ph*.06)+'px';
  const time=el('lock').querySelector('strong');
  time.style.fontSize=Math.min(pw*.24,ph*.25)+'px';
  time.style.transform='scaleY('+current.settings.clockHeight/100+')';
  stage.resize(pw,ph);previewBackdrop();
}
const backdrop=document.createElement('canvas');
backdrop.setAttribute('aria-hidden','true');
Object.assign(backdrop.style,{position:'absolute',inset:'0',zIndex:'-1',pointerEvents:'none'});
el('frame').prepend(backdrop);
function previewBackdrop(){
  if(!current)return;
  backdrop.width=Math.max(1,el('frame').clientWidth);
  backdrop.height=Math.max(1,el('frame').clientHeight);
  paintBackground(backdrop.getContext('2d'),backdrop.width,backdrop.height,current.settings,photo);
}
let loadedPhoto='';
async function updatePhoto(){
  const src=current.settings.photo||'';
  if(src===loadedPhoto){previewBackdrop();return;}
  const ticket=++photoToken;
  loadedPhoto=src;photo=null;previewBackdrop();
  if(!src)return;
  try{
    const image=new Image();image.src=src;
    await image.decode();
    if(ticket===photoToken){photo=image;previewBackdrop();}
  }catch{if(ticket===photoToken){loadedPhoto='';note('背景照片读取失败，请重新选择。');}}
}
function ranges(target,specs,onChange) {
  const fields={};
  for(const [key,label,min,max,step] of specs){
    const row=document.createElement('label');row.className='range-row';
    const title=document.createElement('span');title.textContent=label;
    const range=document.createElement('input'), numeric=document.createElement('input');
    range.type='range';numeric.type='number';
    for(const input of [range,numeric]){input.min=min;input.max=max;input.step=step;input.setAttribute('aria-label',label+(input===range?'滑杆':'数值'));}
    const apply=input=>{
      if(input.value==='' || !Number.isFinite(input.valueAsNumber))return;
      const value=Math.min(max,Math.max(min,input.valueAsNumber));
      range.value=numeric.value=value;
      onChange(key,value);
    };
    range.oninput=()=>apply(range);numeric.onchange=()=>apply(numeric);
    row.append(title,range,numeric);el(target).append(row);
    fields[key]=value=>{numeric.value=range.value=String(Number(value.toFixed(2)));};
  }
  return data=>{if(data)for(const [key,set] of Object.entries(fields))set(data[key]);};
}
const updatePosition=ranges('transforms',[
  ['x','左右',-25,25,.01],['y','高度',-25,25,.01],['z','前后',-25,25,.01],['angle','旋转',-180,180,1],['scale','大小',.05,12,.01]
],(k,v)=>{const a=selected();if(a){a[k]=v;stage.transform(a);changed();}});
const updateLight=ranges('lights',[
  ['key','主光',0,6,.05],['ambient','环境光',0,5,.05],['angle','方向',-180,180,1],['exposure','曝光',.3,2,.05]
],(k,v)=>setCustomLight(k,v));
function setCustomLight(k,v){
  const s=current.settings;s.lightName='custom';s.light[k]=v;
  el('light').value='custom';stage.setLights(s.light);changed();
}
function repaintSettings(){
  const s=current.settings;
  for(const id of ['size','width','height','scale','quality','format','background'])el(id).value=s[id];
  el('custom-size').hidden=s.size!=='custom';
  el('framing').value=s.framing;el('clock').checked=s.clock;el('clock-row').hidden=el('lock').hidden=!s.clock;el('clock-height').value=s.clockHeight;
  el('first-color').value=s.first;el('second-color').value=s.second;
  el('first-row').hidden=['transparent','photo'].includes(s.background);
  el('second-row').hidden=!['gradient','dots'].includes(s.background);
  el('photo-row').hidden=s.background!=='photo';
  el('format').disabled=s.background==='transparent';
  if(el('format').disabled)el('format').value='png';
  el('light').value=s.lightName;el('light-color').value=s.light.color;
  el('shadow').checked=s.light.shadow;
  updateLight(s.light);stage.setLights(s.light);resize();updatePhoto();
}
async function drawActors(){
  const a=selected(), id=++poseRevision;
  el('actors').replaceChildren(...current.actors.map(x=>option(x.name,x.id)));
  if(a)el('actors').value=a.id;
  const isCharacter=a?.kind==='character';
  el('dress').hidden=el('save-look').hidden=el('pose-row').hidden=!isCharacter;
  el('remove').disabled=!a;el('transforms').parentElement.hidden=!a;
  updatePosition(a);
  if(!isCharacter)return;
  let core;
  try { ({core}=await characterSource(a.game)); }
  catch { if(id===poseRevision)el('pose').replaceChildren(option('动作目录不可用','')); return; }
  if(id!==poseRevision)return;
  el('pose').replaceChildren(option('初始站姿','rest'),...core.previewPoses.map(p=>option(p.label||p.name||p.id,p.id)));
  el('pose').value=a.pose;
}
async function add(data){
  const next=actor(data,current.actors.length);
  if(next.ground)next.x=0;
  current.actors.push(next);current.selected=next.id;
  el('add-dialog').close();drawActors();changed();
  await loadActor(next);
  if(current.actors.includes(next) && !failures.size){el('framing').value=current.settings.framing='all';frameScene('all');}
}
async function start(){
  stage=new StudioStage(el('view'),camera=>{if(current){current.camera=camera;changed();}},(id,point)=>{
    const a=current.actors.find(item=>item.id===id);
    if(!a)return;
    if(a.id!==current.selected){current.selected=id;drawActors();}
    for(const key of ['x','y','z'])a[key]=Math.min(25,Math.max(-25,point[key]));
    stage.transform(a);updatePosition(a);changed();
  });
  el('view').addEventListener('webglcontextlost',event=>{
    event.preventDefault();lostContext=true;loadStatus();
  });
  el('view').addEventListener('webglcontextrestored',()=>{
    lostContext=false;resize();loadStatus();
  });
  new ResizeObserver(resize).observe(el('frame').parentElement);
  const data=handoff();
  const editId=data?.edit;
  const projectId=params.get('project') || remembered('xiaoyu-open-studio',sessionStorage) || remembered('xiaoyu-last-studio');
  let p=projectId && await records('projects','get',projectId);
  const game=Object.hasOwn(gameNames,data?.game)?data.game:entryGame;
  if(editId && p){
    const a=p.actors.find(item=>item.id===editId && item.kind==='character' && item.game===game);
    if(a){a.look=data.state;a.pose=data.pose||'rest';p.selected=a.id;}
  }else if(data?.state && p){
    const same=p.actors.find(a=>a.kind==='character' && a.game===game && a.pose===(data.pose||'rest') && JSON.stringify(a.look)===JSON.stringify(data.state));
    if(same)p.selected=same.id;
    else{
      const a=actor(character(game,data.state,data.pose),p.actors.length);
      p.actors.push(a);p.selected=a.id;p.camera=null;
    }
  }
  if(!p)p=project('我的摄影棚',actor(character(game,data?.state,data?.pose),0));
  if(!projectId || !p.revision || data){
    const written=await writeProject(p,p.revision);
    p.id=written.id;p.name=written.name;p.revision=written.revision;
  }
  await setProject(p);
}
el('retry').onclick=safe(async()=>{for(const id of [...failures.keys()]){const a=current.actors.find(x=>x.id===id);if(a)await loadActor(a);}});
el('actors').onchange=()=>{current.selected=el('actors').value;drawActors();changed();};
el('pose').onchange=safe(async()=>{
  const a=selected();if(!a)return;
  const old=a.pose, next=el('pose').value;a.pose=next;
  try{await stage.pose(a);changed();}
  catch(e){if(a.pose===next){a.pose=old;drawActors();}throw e;}
});
el('dress').onclick=safe(async()=>{
  const a=selected();if(a?.kind!=='character')return;
  await save();
  location.assign(handoffURL('./customizer.html',{game:a.game},{edit:a.id,project:current.id,entryGame,state:a.look,pose:a.pose}));
});
el('remove').onclick=()=>{
  const a=selected();if(!a)return;
  stage.remove(a.id);pending.delete(a.id);failures.delete(a.id);
  current.actors=current.actors.filter(x=>x!==a);current.selected=current.actors[0]?.id;
  drawActors();loadStatus();changed();
};
function frameScene(mode){
  const a=selected();
  if(mode==='all'||!a)stage.fit(current.settings.clock);
  else stage.fit(current.settings.clock,a.id,mode==='portrait'?.33:.62);
  current.camera=stage.cameraState();changed();
}
el('fit').onclick=()=>{current.settings.framing=el('framing').value='all';frameScene('all');};
el('framing').onchange=()=>{current.settings.framing=el('framing').value;frameScene(current.settings.framing);};
for(const id of ['full','move']){
  el(id).onclick=()=>{
    const value=el(id).getAttribute('aria-pressed')!=='true';
    el(id).setAttribute('aria-pressed',String(value));
    if(id==='move')stage.setMoving(value);
    else{document.body.classList.toggle('large-stage',value);el(id).textContent=value?'退出全屏':'全屏预览';}
  };
}
for(const btn of document.querySelectorAll('[data-pane]'))btn.onclick=()=>{
  for(const b of document.querySelectorAll('[data-pane]')){const on=b===btn;b.setAttribute('aria-pressed',String(on));el(b.dataset.pane).hidden=!on;}
};
for(const key of ['size','width','height','scale','quality','format','background','first-color','second-color','clock','clock-height']){
  const control=el(key);
  control.addEventListener(control.type==='color'||control.type==='range'?'input':'change',()=>{
    const setting={'first-color':'first','second-color':'second','clock-height':'clockHeight'}[key]||key;
    let value=control.value;
    if(key==='clock')value=control.checked;
    if(['width','height','scale','quality','clock-height'].includes(key)){
      value=Number(value);
      if(['width','height'].includes(key))value=Math.min(8192,Math.max(64,Math.round(value)||64));
    }
    current.settings[setting]=value;
    if(key==='size')current.settings.turned=false;
    repaintSettings();
    if(key==='clock' || key==='size')frameScene(el('framing').value);
    changed();
  });
}
el('rotate').onclick=()=>{current.settings.turned=!current.settings.turned;repaintSettings();changed();};
el('light').onchange=()=>{const name=el('light').value;current.settings.lightName=name;current.settings.light={...lightPresets[name]};repaintSettings();changed();};
el('light-color').oninput=()=>setCustomLight('color',el('light-color').value);
el('shadow').onchange=()=>setCustomLight('shadow',el('shadow').checked);
el('photo').onchange=safe(async()=>{
  const file=el('photo').files[0];if(!file)return;
  const target=current, url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const ratio=Math.min(1,4096/Math.max(image.naturalWidth,image.naturalHeight));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(image.naturalWidth*ratio));c.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    c.getContext('2d').drawImage(image,0,0,c.width,c.height);
    if(target===current){current.settings.photo=c.toDataURL('image/webp',.93);await updatePhoto();await save();}
  }finally{URL.revokeObjectURL(url);el('photo').value='';}
});
el('export').onclick=safe(async()=>{
  if(el('export').disabled)return;
  exporting=true;loadStatus();note('正在导出壁纸…');
  try{
    if(current.settings.background==='photo'&&!photo)throw Error('请先选择背景照片。');
    const settings={...current.settings}, name=current.name;
    const blob=await stage.image(settings,photo);
    const filename=name.replace(/[/\\:*?"<>|]/g,'-')+'.'+(blob.type==='image/jpeg'?'jpg':'png');
    const link=el('save-image'), url=URL.createObjectURL(blob);
    link.href=url;link.download=filename;el('result-image').src=url;
    const [w,h]=dimensions(settings);
    el('result-size').textContent=Math.round(w*settings.scale)+' × '+Math.round(h*settings.scale)+' · '+(blob.size/1048576).toFixed(1)+' MB';
    const file=new File([blob],filename,{type:blob.type});
    const share=el('share-image');
    share.hidden=!navigator.canShare?.({files:[file]});
    share.onclick=async()=>{try{await navigator.share({files:[file]});}catch(e){if(e.name!=='AbortError')el('result-size').textContent='分享未完成，可以点击保存图片。';}};
    el('result-dialog').addEventListener('close',()=>{
      el('result-image').removeAttribute('src');link.removeAttribute('href');share.onclick=null;
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    },{once:true});
    el('result-dialog').showModal();
    note('');
  }finally{exporting=false;el('export').disabled=!!(lostContext||pending.size||failures.size||!current.actors.length);}
});
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
async function projectList(){
  const items=await records('projects','getAll');
  el('project-list').replaceChildren(...items.sort((a,b)=>b.updated-a.updated).map(x=>option(x.name,x.id)));
  el('project-list').value=current.id;el('project-name').value=current.name;
}
el('projects').onclick=safe(async()=>{await save();await projectList();el('project-dialog').showModal();});
el('project-list').onchange=safe(async()=>{
  const next=await records('projects','get',el('project-list').value);if(!next)return;
  await save();el('project-dialog').close();await setProject(next);
});
el('rename').onclick=safe(async()=>{
  const name=el('project-name').value.trim();if(!name)return;
  current.name=name;changed();await save();await projectList();
});
for(const id of ['new','duplicate'])el(id).onclick=safe(async()=>{
  await save();
  const next=id==='new'?project('新摄影棚',actor(character(entryGame),0)):structuredClone(current);
  if(id==='duplicate'){next.id=crypto.randomUUID();next.name+=' 副本';next.revision=0;}
  next.revision=(await writeProject(next,next.revision)).revision;el('project-dialog').close();await setProject(next);
});
el('delete').onclick=safe(async()=>{
  if(!confirm('删除项目「'+current.name+'」？'))return;
  clearTimeout(saveTimer);await saveQueue;
  await records('projects','delete',current.id);
  const remaining=await records('projects','getAll');
  const next=remaining.sort((a,b)=>b.updated-a.updated)[0] || project('我的摄影棚',actor(character(entryGame),0));
  if(!remaining.length)next.revision=(await writeProject(next)).revision;el('project-dialog').close();await setProject(next);
});
el('save-look').onclick=safe(async()=>{
  const a=selected(),name=prompt('搭配名称',a.name);
  if(!name?.trim())return;
  await records('looks','put',{id:crypto.randomUUID(),name:name.trim(),game:a.game,look:a.look,pose:a.pose});
  note('已收藏搭配');
});
async function looks(){
  const root=el('looks');root.replaceChildren();
  for(const look of await records('looks','getAll')){
    const row=document.createElement('div');row.className='look-row';
    const title=document.createElement('span');title.textContent=look.name;
    const apply=document.createElement('button'),addButton=document.createElement('button'),remove=document.createElement('button');
    apply.textContent='应用';apply.disabled=selected()?.game!==look.game||selected()?.kind!=='character';
    apply.onclick=safe(async()=>{const a=selected();a.look=structuredClone(look.look);a.pose=look.pose;el('add-dialog').close();changed();drawActors();await loadActor(a);});
    addButton.textContent='加入';addButton.onclick=safe(()=>add(character(look.game,look.look,look.pose)));
    remove.textContent='删除';remove.onclick=safe(async()=>{if(confirm('删除收藏「'+look.name+'」？')){await records('looks','delete',look.id);await looks();}});
    row.append(title,apply,addButton,remove);root.append(row);
  }
}
for(const b of document.querySelectorAll('[data-character]'))b.onclick=safe(()=>add(character(b.dataset.character)));
function librarySections(){
  el('lib-section').replaceChildren(...Object.entries(sections[el('lib-game').value]).map(([id,name])=>option(name,id)));
  el('lib-section').value='props';
}
const base=document.querySelector('meta[name=resource-base]').content;
async function library(){
  const ticket=++libraryRevision, game=el('lib-game').value, section=el('lib-section').value;
  libraryItems=[];el('results').textContent='正在加载…';el('more').hidden=true;
  try{
    const response=await fetch('../catalog/'+game+'/'+section+'.json');
    if(!response.ok)throw Error('目录暂时无法读取');
    const data=await response.json();
    if(ticket!==libraryRevision)return;
    libraryItems=(data.items||[]).flatMap(item=>[item,...(item.mapVariants||[]).map(v=>({...v.item,name:item.name+' · '+v.label}))]).filter(item=>item.glb&&item.glbBytes&&item.glbSha256);
    limit=36;drawLibrary();
  }catch(e){if(ticket===libraryRevision)el('results').textContent=errorText(e);}
}
function drawLibrary(){
  const root=el('results'), query=el('search').value.trim().toLowerCase();
  const list=libraryItems.filter(item=>(item.name+' '+item.id).toLowerCase().includes(query));
  root.replaceChildren();
  for(const item of list.slice(0,limit)){
    const button=document.createElement('button');
    if(item.poster){const img=new Image(60,60);img.alt='';img.loading='lazy';img.src=new URL(item.poster,base);button.append(img);}
    button.append(document.createTextNode(item.name||item.id));
    button.onclick=safe(()=>add({kind:'prop',name:item.name,game:el('lib-game').value,item,ground:['maps','scenes'].includes(el('lib-section').value)}));
    root.append(button);
  }
  if(!list.length)root.textContent='没有匹配的模型';
  el('more').hidden=list.length<=limit;
}
el('lib-game').onchange=()=>{librarySections();library();};
el('lib-section').onchange=library;
el('search').oninput=()=>{limit=36;drawLibrary();};
el('more').onclick=()=>{limit+=36;drawLibrary();};
el('add').onclick=safe(async()=>{
  el('add-dialog').showModal();await looks();library();
});
librarySections();
el('date').textContent=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'short'}).format(new Date());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden' && current)save().catch(()=>{});});
el('back').onclick=safe(async event=>{event.preventDefault();await save();location.assign(returnPage);});
start().catch(e=>{note('摄影棚启动失败：'+errorText(e));el('export').disabled=true;el('retry').hidden=false;el('retry').onclick=()=>location.reload();});
