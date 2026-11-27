export function mountBoard(root, {api,avatarURL,paint,store,refresh=true}) {
  const $ = selector => root.querySelector(selector);
  const form=$('.gb-compose'), name=form.elements.nickname, body=form.elements.message;
  const picker=$('.gb-picker'), edit=$('.gb-avatar-edit'), preview=$('canvas'), avatarImg=edit.querySelector('img');
  const status=$('.gb-feedback'), feed=$('.gb-stream'), listStatus=$('.gb-list-feedback'), more=$('.gb-more');
  const replyBar=$('.gb-replying'), apply=$('.gb-apply'), send=$('.gb-send');
  const defaultRecipe={actor:0,face:0,ink:'#ff702e',paper:'#e8d6bc'};
  const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  const read=(key,fallback)=>{try { return JSON.parse(store.getItem(key)) ?? fallback; } catch {return fallback;}};
  const write=(key,item)=>{try { store.setItem(key,JSON.stringify(item)); } catch {}};
  let drafts=read('ink-board-drafts',{}), target=read('ink-board-target',null);
  let recipe=read('ink-board-recipe',defaultRecipe);
  let avatar=store.getItem('ink-board-avatar') || '', busy=false, paintRun=0, loading=false;
  let entries=[], next=null, serial=0, syncVersion=0;
  const expanded=new Map(), likeBusy=new Set();
  const make=(tag,cls,value)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(value!=null)node.textContent=value;return node;};
  const btn=(cls,label,handler)=>{const b=make('button',cls,label);b.type='button';b.addEventListener('click',handler);return b;};
  function icon(kind) {
    const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg'), path=document.createElementNS(ns,'path');
    svg.setAttribute('class','gb-icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    path.setAttribute('d',kind==='heart' ? 'M20.5 4.8a5.2 5.2 0 0 0-7.4 0L12 6l-1.1-1.2a5.2 5.2 0 0 0-7.4 7.4l1.2 1.2L12 21l7.3-7.6 1.2-1.2a5.2 5.2 0 0 0 0-7.4Z' : 'M20 11a8 8 0 0 1-8 8H9l-5 3 1.5-5A8 8 0 1 1 20 11Z');
    svg.append(path);return svg;
  }
  function setAvatar(photo) {
    avatar=photo;avatarImg.hidden=!photo;edit.querySelector('span').hidden=!!photo;
    if(photo) avatarImg.src=photo;
    edit.setAttribute('aria-label',photo ? '更换头像':'捏头像');
  }
  function photoFingerprint(photo) {
    let hash=2166136261;
    for (let i=0;i<photo.length;i++) hash=Math.imul(hash^photo.charCodeAt(i),16777619);
    return hash>>>0;
  }
  function activeKey(){return String(target?.id || 'root');}
  function rememberDraft() {
    const key=activeKey(),old=drafts[key]||{};
    if(body.value) drafts[key]={...old,body:body.value};
    else delete drafts[key];
    write('ink-board-drafts',drafts);
  }
  function selectTarget(entry,focus=true) {
    rememberDraft();target=entry;write('ink-board-target',target);showTarget();
    if(focus) {form.scrollIntoView?.({block:'center'});body.focus();}
  }
  function showTarget() {
    replyBar.hidden=!target;replyBar.querySelector('span').textContent=target ? '回复 '+target.author:'';
    send.textContent=target ? '发送回复':'发送留言';body.placeholder=target ? '写下你的回复…':'想说点什么？';
    body.value=drafts[activeKey()]?.body || '';
  }
  function readRecipe() {
    return {actor:Number(form.elements.actor.value),face:Number(form.elements.face.value),ink:form.elements.ink.value,paper:form.elements.paper.value};
  }
  async function repaint() {
    const run=++paintRun;
    const full=$('.gb-customizer');
    if(full){
      const {actor,face,ink,paper}=readRecipe();
      const query=new URLSearchParams({game:actor<4?'spl3':'raiders',shot:'pose',actor,face,ink,paper});
      full.href='./customizer.html?'+query;
    }
    apply.disabled=true;
    try {
      await paint(preview,readRecipe());
      if(run===paintRun) apply.disabled=false;
    } catch {if(run===paintRun)status.textContent='头像加载失败，重新打开可重试。';}
  }
  function openPicker(open) {
    picker.hidden=!open;edit.setAttribute('aria-expanded',String(open));
    if(open) {for(const key of Object.keys(defaultRecipe)) form.elements[key].value=recipe[key] ?? defaultRecipe[key];repaint();}
  }
  name.value=store.getItem('ink-board-name') || '';
  name.addEventListener('input',()=>{try {store.setItem('ink-board-name',name.value);} catch {}});
  body.addEventListener('input',rememberDraft);
  edit.addEventListener('click',()=>openPicker(picker.hidden));
  picker.addEventListener('input',repaint);
  apply.addEventListener('click',()=>{
    const photo=preview.toDataURL('image/png');recipe=readRecipe();setAvatar(photo);
    try {store.setItem('ink-board-avatar',photo);} catch {}
    write('ink-board-recipe',recipe);openPicker(false);status.textContent='';edit.focus();
  });
  replyBar.querySelector('button').addEventListener('click',()=>selectTarget(null));
  showTarget();setAvatar(avatar);
  function stamp(ms) {
    const date=new Date(ms), age=Math.max(0,(Date.now()-ms)/60000);
    if(age<1)return '刚刚';if(age<60)return Math.floor(age)+' 分钟前';if(age<1440)return Math.floor(age/60)+' 小时前';
    return date.toLocaleDateString('zh-CN',{month:'short',day:'numeric',...(date.getFullYear()!==new Date().getFullYear()?{year:'numeric'}:{})});
  }
  function article(row, nested=false) {
    const el=make('article',nested?'gb-reply':'gb-post');el.dataset.id=row.id;
    const author=make('div','gb-author'), img=make('img');img.alt='';img.src=avatarURL(row.avatar);img.loading='lazy';
    const meta=make('div'), time=make('time',null,stamp(row.created));time.dateTime=new Date(row.created).toISOString();time.title=new Date(row.created).toLocaleString('zh-CN');
    meta.append(make('strong',null,row.author),time);author.append(img,meta);
    const message=make('p','gb-body',row.body);
    if(nested && row.parent!==row.thread) message.prepend(make('span','gb-target','回复 '+row.target+' · '));
    const actions=make('div','gb-actions');
    const like=btn('',null,async()=>{
      if(likeBusy.has(row.id)) return;
      likeBusy.add(row.id);like.disabled=true;++syncVersion;
      try {
        const result=await api('messages/'+row.id+'/like','PUT',{liked:!row.liked});
        Object.assign(row,result);drawLike();
      } catch(error) {listStatus.textContent=error.message;}
      finally {likeBusy.delete(row.id);like.disabled=false;++syncVersion;}
    });
    function drawLike(){like.replaceChildren(icon('heart'),make('span',null,row.likes||'赞'));like.setAttribute('aria-label',(row.liked?'取消点赞':'点赞')+'，'+row.likes+' 个赞');like.setAttribute('aria-pressed',String(!!row.liked));}
    drawLike();like.dataset.action='like';
    const reply=btn('',null,()=>selectTarget({id:row.id,author:row.author,thread:row.thread||row.id}));
    reply.append(icon('reply'),document.createTextNode('回复'));reply.setAttribute('aria-label','回复 '+row.author);reply.dataset.action='reply';
    actions.append(like,reply);el.append(author,message,actions);
    if(!nested && row.replies) {
      const thread=expanded.get(row.id);
      const toggle=btn('gb-thread-toggle',thread?'收起回复':'查看 '+row.replies+' 条回复',async()=>{
        if(expanded.has(row.id)) {expanded.delete(row.id);++syncVersion;render();return;}
        toggle.disabled=true;
        try {expanded.set(row.id,await api('messages?thread='+row.id));++syncVersion;render();}
        catch (e) {listStatus.textContent=e.message;toggle.disabled=false;}
      });
      toggle.setAttribute('aria-expanded',String(!!thread));actions.append(toggle);
      if(thread) {
        const kids=make('section','gb-replies');kids.setAttribute('aria-label','回复');
        for(const item of thread.items)kids.append(article(item,true));
        if(thread.next)kids.append(btn('gb-more','更多回复',async e=>{
          e.currentTarget.disabled=true;
          try { const page=await api('messages?thread='+row.id+'&cursor='+thread.next);thread.items.push(...page.items);thread.next=page.next; }
          catch(err){listStatus.textContent=err.message;}
          ++syncVersion;render();
        }));
        el.append(kids);
      }
    }
    return el;
  }
  function render() {
    const old=document.activeElement, ref=old?.closest?.('[data-id]')?.dataset.id, action=old?.dataset.action;
    feed.replaceChildren(...entries.map(row=>article(row)));more.hidden=!next;
    if(ref && action)feed.querySelector('[data-id="'+ref+'"] [data-action="'+action+'"]')?.focus({preventScroll:true});
  }
  async function load(append=false,quiet=false) {
    if(loading && (append||quiet))return;
    const run=++serial, version=syncVersion;loading=true;more.disabled=true;
    try {
      const page=await api('messages'+(append&&next?'?cursor='+next:''));
      if(run!==serial || (quiet && (version!==syncVersion || likeBusy.size || busy)))return;
      if(quiet && entries.length) {
        const last=entries.at(-1).id;
        while(page.next && page.items.at(-1).id>last) {
          const extra=await api('messages?cursor='+page.next);
          page.items.push(...extra.items);page.next=extra.next;
        }
        const threads=await Promise.all([...expanded].map(async ([id,old])=>{
          const fresh=await api('messages?thread='+id);
          while(fresh.next && fresh.items.length<old.items.length) {
            const part=await api('messages?thread='+id+'&cursor='+fresh.next);
            fresh.items.push(...part.items);fresh.next=part.next;
          }
          return [id,fresh];
        }));
        if(run!==serial || version!==syncVersion || likeBusy.size || busy)return;
        const changed=threads.some(([id,data])=>JSON.stringify(data)!==JSON.stringify(expanded.get(id)));
        if(!changed && JSON.stringify(page.items)===JSON.stringify(entries) && page.next===next)return;
        for(const [id,data] of threads)expanded.set(id,data);
      }
      entries=append ? [...entries,...page.items] : page.items;next=page.next;
      listStatus.textContent=entries.length?'':'还没有留言。';render();
    } catch(err) {
      if(run!==serial || quiet)return;
      listStatus.replaceChildren(document.createTextNode(err.message+' '),btn('','重试',()=>load(append)));
    } finally {if(run===serial){loading=false;more.disabled=false;}}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const author=name.value.trim(), text=body.value.trim();
    if(!author){status.textContent='先写一个昵称。';name.focus();return;}
    if(!text){status.textContent='先写点内容。';body.focus();return;}
    if(!avatar){status.textContent='先选一个留言头像。';openPicker(true);apply.focus();return;}
    const key=activeKey(),dest=target, draft=drafts[key]||{};
    const signature=JSON.stringify([author,text,photoFingerprint(avatar),dest?.id||null]);
    const ticket=signature===draft.signature?draft.ticket:random();
    drafts[key]={body:body.value,ticket,signature};write('ink-board-drafts',drafts);
    busy=true;send.disabled=true;status.textContent='正在发送…';
    let sent=false;
    try {
      const result=await api('messages','POST',{author,body:text,avatar,parent:dest?.id||null,ticket});
      sent=true;
      if(drafts[key]?.body.trim()===text)delete drafts[key];
      write('ink-board-drafts',drafts);
      if(target===dest) {target=null;write('ink-board-target',target);showTarget();}
      status.textContent=dest?'回复已发送。':'留言已发送。';
      if(dest) {
        const pages=await api('messages?thread='+dest.thread);
        while(pages.next && !pages.items.some(item=>item.id===result.id)) {
          const page=await api('messages?thread='+dest.thread+'&cursor='+pages.next);
          pages.items.push(...page.items);pages.next=page.next;
        }
        expanded.set(dest.thread,pages);
        const row=entries.find(item=>item.id===dest.thread);
        if(row){row.replies=Math.max(row.replies+1,pages.items.length);render();}
        else await load();
      } else {await load();}
    } catch(err) {status.textContent=sent?'已发送，稍后刷新可查看。':err.message;}
    finally {busy=false;send.disabled=false;}
  });
  more.addEventListener('click',()=>load(true));
  load();
  if(refresh) {
    const update=()=>{if(!document.hidden&&!busy&&!likeBusy.size)load(false,true);};
    window.addEventListener('focus',update);window.setInterval(update,20000);
  }
}
