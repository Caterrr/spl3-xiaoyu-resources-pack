const resourceBase=document.querySelector('meta[name=resource-base]')?.content||'';
const resourceUrl=path=>resourceBase?new URL(path,resourceBase).href:path;
const links=[...document.querySelectorAll('.navigation a')];
const content=document.querySelector('#content');
const catalogs=new Map();
let renderVersion=0;
const downloadDialog=document.querySelector('#download-dialog');
let downloadTrigger;
function size(bytes){return bytes>=1073741824?(bytes/1073741824).toFixed(1)+' GB':bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.ceil(bytes/1024)+' KB';}
function openDownload(item,trigger){
 downloadTrigger=trigger;
 document.querySelector('#download-title').textContent=item.name;
 document.querySelector('#download-preview').src=resourceUrl(item.poster);
 document.querySelector('#download-preview').alt=item.name;
 for(const format of ['blend','glb']){
  const link=document.querySelector('#download-'+format);link.href=resourceUrl(item[format])+'?download='+encodeURIComponent(item.id+'.'+format);link.download=item.id+'.'+format;
  document.querySelector('#download-'+format+'-size').textContent=size(item[format+'Bytes']);
 }
 const note=document.querySelector('#download-note');
 note.textContent=[item.layoutNote,item.notes].filter(Boolean).join(' ');note.hidden=!note.textContent;
 downloadDialog.showModal();
}
async function renderSection(){
 const version=++renderVersion;
 const requested=new URL(location.href).searchParams.get('section');
 const active=links.find(link=>link.dataset.section===requested)||links.find(link=>link.dataset.section==='new');
 for(const link of links){if(link===active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
 content.setAttribute('aria-label',active.textContent);document.title=active.textContent+' · spl3 xiaoyu resources pack';
 content.replaceChildren();
 const status=document.createElement('p');status.className='library-status';status.setAttribute('role','status');status.textContent='加载中';content.append(status);
 try{
  const section=active.dataset.section;
  if(!catalogs.has(section)){
   const response=await fetch('./catalog/'+section+'.json');if(!response.ok)throw Error(response.status);
   catalogs.set(section,await response.json());
  }
  if(version!==renderVersion)return;
  const data=catalogs.get(section), items=data.items;status.remove();
  const gallery=document.createElement('div');gallery.className='model-list';gallery.setAttribute('role','list');content.append(gallery);
  const more=document.createElement('button');more.type='button';more.className='load-more';more.textContent='更多';
  let cursor=0;
  function addPage(){
   const fragment=document.createDocumentFragment();
   for(const item of items.slice(cursor,cursor+60)){
    const entry=document.createElement('div');entry.className='model-entry';entry.setAttribute('role','listitem');
    const button=document.createElement('button');button.type='button';button.className='model-card';button.setAttribute('aria-label','下载 '+item.name);button.title=item.name;
    const image=document.createElement('img');image.src=resourceUrl(item.poster);image.alt=item.name;image.loading='lazy';image.decoding='async';image.width=360;image.height=360;
    button.append(image);button.addEventListener('click',()=>openDownload(item,button));
    if(item.notes){const flag=document.createElement('span');flag.className='model-note';flag.textContent='i';flag.setAttribute('aria-label',item.notes);flag.title=item.notes;button.append(flag);}
    entry.append(button);fragment.append(entry);
   }
   cursor+=60;gallery.append(fragment);more.hidden=cursor>=items.length;
  }
  if(!items.length){status.textContent='暂无模型';content.append(status);}else{addPage();content.append(more);more.addEventListener('click',addPage);}
 }catch(error){if(version===renderVersion)status.textContent='暂时无法加载，请刷新重试';}
}
document.querySelector('#download-close').addEventListener('click',()=>downloadDialog.close());
downloadDialog.addEventListener('click',event=>{if(event.target!==downloadDialog)return;const b=downloadDialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)downloadDialog.close();});
downloadDialog.addEventListener('close',()=>downloadTrigger?.focus({preventScroll:true}));
for(const link of links){
  link.addEventListener('click',event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    if(location.href!==link.href)history.pushState(null,'',link.href);
    renderSection();
  });
}
window.addEventListener('popstate',renderSection);
renderSection();

const socialDialog=document.querySelector('#social-dialog');
let socialTrigger;
for(const button of document.querySelectorAll('.social-links button')){
  button.addEventListener('click',()=>{
    socialTrigger=button;
    document.querySelector('#social-title').textContent=button.dataset.platform;
    const image=document.querySelector('#social-qr-image');
    const frame=document.querySelector('#social-qr-frame');
    const status=document.querySelector('#social-pending');
    const source=button.dataset.qrImage;
    frame.hidden=true;
    status.hidden=false;
    status.textContent=source?'加载中':'二维码待添加';
    if(source){
      image.alt=button.dataset.platform+'二维码原图';
      frame.href=source;
      frame.setAttribute('aria-label','查看'+button.dataset.platform+'完整原图，在新标签页打开');
      frame.title='查看原图';
      image.onload=()=>{
        frame.hidden=false;
        status.hidden=true;
      };
      image.onerror=()=>{status.textContent='二维码暂时无法显示';};
      image.src=source;
    } else image.removeAttribute('src');
    socialDialog.showModal();
  });
}
document.querySelector('#social-close').addEventListener('click',()=>socialDialog.close());
socialDialog.addEventListener('click',event=>{
  if(event.target!==socialDialog)return;
  const box=socialDialog.getBoundingClientRect();
  if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)socialDialog.close();
});
socialDialog.addEventListener('close',()=>socialTrigger?.focus({preventScroll:true}));
