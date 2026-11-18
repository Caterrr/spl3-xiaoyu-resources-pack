const favorites=[
  ['rest','初始姿势'],['stand','自然站立'],['crouch','蹲姿'],['Emote_WaveHands_EdWait','挥手'],
  ['Emote_BlowKiss','飞吻'],['Emote_SittingCrossedLegs_EdWait','盘腿坐'],['Wait_Plaza_LeanWall00','倚墙'],
  ['win15','斜举手'],['warm','取暖'],['win13','胜利姿势 13']
];
const pageSize=8;
function familyOf(pose){
  const {clip='',label,group}=pose;
  const key=clip.replace(/^amiibo_Pose_|^amiiboPose_|^Emote_/,'');
  const phase=/_FistBump_L$/.test(clip)?'左碰拳':/_FistBump_R$/.test(clip)?'右碰拳':
    /_StWait$/.test(clip)?'起始':label.endsWith(' · 动作中')?'动作中段':'收势';
  let name=label.replace(/（变体）$/,'').replace(/ · (?:左碰拳|右碰拳|动作中|起始)$/,'');
  let section=group,variant=label;
  if(key.startsWith('Win')||/^amiibo_Pose_|^Emote_/.test(clip)){
    const weapon=/^Win_(?!Pair|Tricol|X00)/.test(key);
    section=weapon?'武器动作':key.startsWith('Win')?'胜利动作':'拍照与表情';
    const number=weapon?name.match(/ (\d+)$/)?.[1]:'';
    if(number)name=name.slice(0,-number.length-1);
    variant=(number?'姿态 '+number+' · ':'')+phase;
  }else if(clip.startsWith('amiibo')){
    section='拍照与表情';
    const match=name.match(/^(站姿|坐姿) (交谈|对战)/);
    if(match)name=match[1]+match[2];
    else name=name.replace(/ (?:起始 )?[BT]$/,'');
  }else if(group==='宣传造型'){
    name=name.split(' · ')[0];
  }else if(group==='试穿与造型'){
    name=name.split(' · ')[0];
  }else{
    name=name.replace(/(?: 待机变化| 起始)$/,'').replace(/ (?:\d+[A-Z]?|[A-Z])$/,'');
  }
  return {section,name,variant,key:section+'/'+name};
}
export function setupPosePanel(panel,poses,onChoose){
  const list=panel.querySelector('.pose-list');
  const search=panel.querySelector('input'),category=panel.querySelector('select');
  const rest={id:'rest',label:'初始姿势',clip:'',group:''};
  const records=new Map([rest,...poses].map(p=>[p.id,p]));
  const common=favorites.filter(([id])=>records.has(id)).slice(0,pageSize);
  const sections=new Set(),families=new Map();
  for(const p of poses){
    const f=familyOf(p);
    sections.add(f.section);
    if(!families.has(f.key))families.set(f.key,{...f,rows:[]});
    families.get(f.key).rows.push({p,variant:f.variant});
  }
  for(const family of families.values()){
    const counts=new Map();
    for(const row of family.rows)counts.set(row.variant,(counts.get(row.variant)||0)+1);
    for(const row of family.rows){
      if(counts.get(row.variant)>1)row.variant+=' · '+(row.p.clip.startsWith('amiibo')?'amiibo':'对战');
      if(row.p.label.endsWith('（变体）'))row.variant+='（变体）';
    }
  }
  category.replaceChildren(new Option('常用姿势',''));
  for(const section of sections)category.add(new Option(section,section));
  category.hidden=poses.length<pageSize;
  let selected='rest',detail=null,limit=pageSize;
  function button(label,data,active){
    const b=document.createElement('button');b.type='button';b.textContent=label;
    Object.assign(b.dataset,data);
    if(active!==undefined)b.setAttribute('aria-pressed',String(active));
    return b;
  }
  function matches(row,query,f){
    return (row.p.label+' '+row.p.clip+' '+row.variant+' '+f.name+' '+f.section).toLowerCase().includes(query);
  }
  function draw(resetScroll=true){
    const q=search.value.trim().toLowerCase();
    const fragment=document.createDocumentFragment(),rows=[];
    if(detail){
      const f=families.get(detail);
      fragment.append(button('‹ '+f.name,{back:'1'}));
      for(const row of f.rows){
        if(!q||matches(row,q,f))rows.push(button(row.variant,{pose:row.p.id},selected===row.p.id));
      }
    }else if(!q&&!category.value){
      for(const [id,label] of common)rows.push(button(label,{pose:id},selected===id));
    }else{
      for(const f of families.values()){
        if(category.value && f.section!==category.value)continue;
        const found=q?f.rows.filter(row=>matches(row,q,f)):f.rows;
        if(!found.length)continue;
        if(found.length===1)rows.push(button(q?found[0].p.label:f.name,{pose:found[0].p.id},selected===found[0].p.id));
        else rows.push(button(f.name,{family:f.key}));
      }
    }
    fragment.append(...rows.slice(0,limit));
    if(rows.length>limit)fragment.append(button('显示更多',{more:'1'}));
    if(!rows.length){const empty=document.createElement('p');empty.textContent='没有匹配的姿势';fragment.append(empty);}
    const previousScroll=list.scrollTop;
    list.replaceChildren(fragment);list.scrollTop=resetScroll?0:previousScroll;
  }
  function overview(){detail=null;limit=pageSize;draw();}
  function select(id){
    selected=id;
    for(const b of list.querySelectorAll('[data-pose]'))b.setAttribute('aria-pressed',String(b.dataset.pose===id));
  }
  panel.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&detail){e.preventDefault();overview();search.focus();return;}
    if(e.target===category||!['ArrowUp','ArrowDown'].includes(e.key))return;
    const buttons=[...list.querySelectorAll('button')];if(!buttons.length)return;
    const i=buttons.indexOf(document.activeElement);
    e.preventDefault();buttons[Math.min(buttons.length-1,Math.max(0,i+(e.key==='ArrowUp'?-1:1)))].focus();
  });
  search.addEventListener('input',()=>{if(search.value)category.value='';overview();});
  category.addEventListener('change',()=>{search.value='';overview();});
  list.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.more){const previous=limit;limit+=pageSize;draw(false);list.querySelectorAll('button')[previous+(detail?1:0)]?.focus();return;}
    if(b.dataset.back){const old=detail;overview();[...list.querySelectorAll('[data-family]')].find(x=>x.dataset.family===old)?.focus();return;}
    if(b.dataset.family){detail=b.dataset.family;limit=pageSize;draw();list.querySelector('[data-back]').focus();return;}
    onChoose(b.dataset.pose);
  });
  overview();
  return {select,reset(){selected='rest';search.value='';category.value='';overview();}};
}
