const favoriteIds=['rest','stand','crouch','Emote_WaveHands_EdWait','Emote_BlowKiss_EdWait','Emote_SittingCrossedLegs_EdWait','Wait_Plaza_LeanWall00','win15'];
const pageSize=8;

export function setupPosePanel(panel,poses,onChoose){
  const list=panel.querySelector('.pose-list'),search=panel.querySelector('input'),category=panel.querySelector('select');
  const records=new Map(poses.map(p=>[p.id,p]));
  records.set('rest',{id:'rest',label:'初始姿势',clip:'',group:''});
  const common=favoriteIds.map(id=>records.get(id)).filter(Boolean);
  const sections=new Set(poses.map(p=>p.group));
  category.replaceChildren(new Option('常用姿势',''));
  for(const section of sections)category.add(new Option(section,section));
  let selected='rest',limit=pageSize;

  function label(pose){return pose.id==='win15'?'斜举手':pose.label;}
  function filtered(){
    const query=search.value.trim().toLowerCase();
    if(query)return [...records.values()].filter(p=>[label(p),p.label,p.clip,p.group].join(' ').toLowerCase().includes(query));
    return category.value?poses.filter(p=>p.group===category.value):common;
  }
  function draw(resetScroll=true){
    const rows=filtered(),fragment=document.createDocumentFragment();
    for(const pose of rows.slice(0,limit)){
      const button=document.createElement('button');
      button.type='button';button.textContent=label(pose);button.dataset.pose=pose.id;
      button.setAttribute('aria-pressed',String(pose.id===selected));fragment.append(button);
    }
    if(rows.length>limit){
      const more=document.createElement('button');more.type='button';more.dataset.more='1';more.textContent='显示更多';fragment.append(more);
    }
    if(!rows.length){const empty=document.createElement('p');empty.textContent='没有匹配的姿势';fragment.append(empty);}
    const scroll=list.scrollTop;list.replaceChildren(fragment);list.scrollTop=resetScroll?0:scroll;
  }
  function select(id,reveal=false){
    selected=id;
    if(reveal&&!list.querySelector('[data-pose="'+id+'"]')){
      const pose=records.get(id);
      search.value='';category.value=pose.group;
      const index=filtered().findIndex(p=>p.id===id);
      limit=pageSize*(1+Math.floor(index/pageSize));draw();
    }
    for(const b of list.querySelectorAll('[data-pose]'))b.setAttribute('aria-pressed',String(b.dataset.pose===id));
    if(reveal)showSelected();
  }
  function showSelected(){
    const button=list.querySelector('[aria-pressed=true]');
    if(!button||panel.hidden)return;
    const row=button.getBoundingClientRect(),box=list.getBoundingClientRect();
    if(row.top<box.top)list.scrollTop+=row.top-box.top;
    else if(row.bottom>box.bottom)list.scrollTop+=row.bottom-box.bottom;
  }
  function firstPage(){limit=pageSize;draw();}
  search.addEventListener('input',()=>{if(search.value)category.value='';firstPage();});
  category.addEventListener('change',()=>{search.value='';firstPage();});
  panel.addEventListener('keydown',e=>{
    if(e.target===category||!['ArrowUp','ArrowDown'].includes(e.key))return;
    const buttons=[...list.querySelectorAll('button')];if(!buttons.length)return;
    const index=buttons.indexOf(document.activeElement);
    e.preventDefault();buttons[Math.min(buttons.length-1,Math.max(0,index+(e.key==='ArrowUp'?-1:1)))].focus();
  });
  list.addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button)return;
    if(button.dataset.more){
      const previous=limit;limit+=pageSize;draw(false);list.querySelectorAll('[data-pose]')[previous]?.focus();return;
    }
    onChoose(button.dataset.pose);
  });
  firstPage();
  return {select,showSelected,reset(){selected='rest';search.value='';category.value='';firstPage();}};
}
