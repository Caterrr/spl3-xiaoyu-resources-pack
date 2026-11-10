(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fadeIn = {duration:420,easing:'ease-in-out'};
  if (!('onpagereveal' in window) && !reduced.matches) {
    document.body.animate([{opacity:0},{opacity:1}],fadeIn);
  }
  let activeTransition;
  window.changeLibrarySection = async update => {
    activeTransition?.skipTransition();
    if (reduced.matches || !document.startViewTransition) {
      await update();
      if (!reduced.matches) document.querySelector('#content')?.animate([{opacity:0},{opacity:1}],fadeIn);
      return;
    }
    document.documentElement.dataset.pageMotion = 'section';
    const transition = document.startViewTransition(update);
    activeTransition = transition;
    try { await transition.finished; } catch {} finally {
      if (activeTransition === transition) {
        activeTransition = undefined;
        delete document.documentElement.dataset.pageMotion;
      }
    }
  };

  const dialog = document.querySelector('#model-dialog');
  if (!dialog) return;
  const stage = document.querySelector('#model-stage');
  let fade, modelFade, closing = false, generation = 0;
  function cleanup() {
    ++generation;
    fade?.cancel(); modelFade?.cancel();
    fade=modelFade=undefined;
    closing=false;
    dialog.classList.remove('motion-active');
  }
  window.modelMotion = {
    open(button, show) {
      cleanup();
      show();
      if(reduced.matches) return;
      const version=generation;
      dialog.classList.add('motion-active');
      const animation=fade=dialog.animate([{opacity:0},{opacity:1}],{...fadeIn,fill:'forwards'});
      animation.finished.catch(()=>{}).then(()=>{
        if(version!==generation) return;
        animation.cancel(); fade=undefined;
        dialog.classList.remove('motion-active');
      });
    },
    ready() {
      if(reduced.matches || closing || fade || !dialog.open) return;
      modelFade?.cancel();
      modelFade=stage.animate([{opacity:0},{opacity:1}],fadeIn);
    },
    async close() {
      if(closing || !dialog.open) return;
      if(reduced.matches){dialog.close();return;}
      closing=true;
      const version=++generation;
      const opacity=getComputedStyle(dialog).opacity;
      fade?.cancel();
      dialog.classList.add('motion-active');
      fade=dialog.animate([{opacity},{opacity:0}],{duration:280,easing:'ease-in-out',fill:'forwards'});
      await fade.finished.catch(()=>{});
      if(version===generation && dialog.open) dialog.close();
    },
    cleanup
  };
  reduced.addEventListener('change',()=>{
    if(reduced.matches){activeTransition?.skipTransition();const wasClosing=closing;cleanup();if(wasClosing&&dialog.open)dialog.close();}
  });
})();
