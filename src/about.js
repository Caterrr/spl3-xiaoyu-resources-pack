const socialDialog=document.querySelector('#social-dialog');
let socialTrigger;
for(const button of document.querySelectorAll('button[data-qr-image]')){
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

// One state for desktop hover, keyboard navigation, and touch/narrow click.
const aboutRows=[...document.querySelectorAll('.about-section')];
const hoverAnswers=matchMedia('(hover:hover) and (pointer:fine) and (width > 1080px)');
let activeAnswer,answerCloseTimer;
function setAnswer(row){
  clearTimeout(answerCloseTimer);
  for(const item of aboutRows){
    const open=item===row;
    item.dataset.open=String(open);
    item.querySelector('.about-trigger').setAttribute('aria-expanded',String(open));
    item.querySelector('.about-answer').inert=!open;
  }
  activeAnswer=row;
}
function scheduleAnswerClose(row){
  clearTimeout(answerCloseTimer);
  answerCloseTimer=setTimeout(()=>{
    if(socialDialog.open)return;
    const keyboardInside=row.contains(document.activeElement)&&document.activeElement.matches(':focus-visible');
    if(activeAnswer===row&&!row.matches(':hover')&&!keyboardInside)setAnswer(null);
  },140);
}
for(const row of aboutRows){
  const trigger=row.querySelector('.about-trigger');
  let triggerPointer;
  trigger.addEventListener('pointerdown',event=>{triggerPointer=event.pointerType;});
  row.addEventListener('pointerenter',event=>{if(hoverAnswers.matches&&event.pointerType==='mouse')setAnswer(row);});
  row.addEventListener('pointerleave',event=>{if(hoverAnswers.matches&&event.pointerType==='mouse')scheduleAnswerClose(row);});
  trigger.addEventListener('click',event=>{
    const keepOpen=hoverAnswers.matches&&(event.detail===0||(event.pointerType||triggerPointer)==='mouse');
    setAnswer(keepOpen||activeAnswer!==row?row:null);
  });
  row.addEventListener('focusin',event=>{if(event.target.matches(':focus-visible'))setAnswer(row);});
  row.addEventListener('focusout',()=>{
    setTimeout(()=>{if(activeAnswer===row&&!row.contains(document.activeElement)&&!row.matches(':hover')&&!socialDialog.open)setAnswer(null);},0);
  });
  trigger.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      const step=event.key==='ArrowDown'?1:-1,index=aboutRows.indexOf(row);
      aboutRows[(index+step+aboutRows.length)%aboutRows.length].querySelector('.about-trigger').focus();
    }
  });
}
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&activeAnswer&&!socialDialog.open){
    const trigger=activeAnswer.querySelector('.about-trigger');trigger.focus({preventScroll:true});setAnswer(null);
  }
});
hoverAnswers.addEventListener('change',()=>setAnswer(null));
