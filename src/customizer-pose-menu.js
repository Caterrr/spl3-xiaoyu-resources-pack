export function setupPoseMenu(field,poses,onChoose){
  const trigger=field.querySelector('.pose-trigger'),panel=field.querySelector('.pose-panel');
  const current=trigger.querySelector('.pose-current'),list=panel.querySelector('.pose-list');
  const search=panel.querySelector('input'),category=panel.querySelector('select');
  const options=[{id:'rest',label:'初始姿势',group:'',clip:''},...poses];
  const groups=[...new Set(poses.map(p=>p.group))];
  for(const group of groups)category.add(new Option(group,group));
  let selected='rest',open=false;
  function showList(){
    const query=search.value.trim().toLowerCase();
    const fragment=document.createDocumentFragment();
    let lastGroup=null;
    for(const p of options){
      if(category.value&&p.group!==category.value)continue;
      if(query && !(p.label+' '+p.group+' '+p.clip).toLowerCase().includes(query))continue;
      if(p.group && lastGroup!==p.group){
        const heading=document.createElement('div');heading.className='pose-group';heading.textContent=p.group;fragment.append(heading);
      }
      lastGroup=p.group;
      const b=document.createElement('button');b.type='button';b.dataset.pose=p.id;
      b.setAttribute('aria-pressed',String(p.id===selected));b.textContent=p.label;fragment.append(b);
    }
    if(!fragment.childElementCount){
      const empty=document.createElement('p');empty.textContent='没有匹配的姿势';fragment.append(empty);
    }
    list.replaceChildren(fragment);list.scrollTop=0;
  }
  function toggle(next,focusTrigger=false){
    open=next;trigger.setAttribute('aria-expanded',String(next));panel.inert=!next;
    if(next){showList();const active=list.querySelector('[aria-pressed=true]');if(active)list.scrollTop=Math.max(0,active.offsetTop-list.offsetTop-40);search.focus({preventScroll:true});}
    else if(focusTrigger)trigger.focus({preventScroll:true});
  }
  function select(id){
    const pose=options.find(p=>p.id===id);
    selected=id;current.textContent=pose.label;trigger.title=pose.label;
  }
  trigger.addEventListener('click',()=>toggle(!open));
  field.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&open){e.preventDefault();toggle(false,true);return;}
    if(!open||e.target===category||!['ArrowUp','ArrowDown'].includes(e.key))return;
    const buttons=[...list.querySelectorAll('button')];if(!buttons.length)return;
    const i=buttons.indexOf(document.activeElement);
    e.preventDefault();buttons[Math.min(buttons.length-1,Math.max(0,i+(e.key==='ArrowUp'?-1:1)))].focus();
  });
  field.addEventListener('focusout',e=>{if(open&&e.relatedTarget&&!field.contains(e.relatedTarget))toggle(false);});
  document.addEventListener('pointerdown',e=>{if(open&&!field.contains(e.target))toggle(false);});
  search.addEventListener('input',showList);
  category.addEventListener('change',showList);
  list.addEventListener('click',e=>{
    const b=e.target.closest('button[data-pose]');if(!b)return;
    toggle(false,true);onChoose(b.dataset.pose);
  });
  field.hidden=false;
  return {select,reset(){search.value='';category.value='';select('rest');toggle(false);}};
}
