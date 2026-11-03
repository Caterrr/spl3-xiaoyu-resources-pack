(() => {
  const menu = document.querySelector('.model-menu');
  const trigger = menu.querySelector('.model-menu-trigger');
  const panel = menu.querySelector('.model-subnavigation');
  const items = [...panel.querySelectorAll('a')];
  const hover = matchMedia('(hover:hover) and (pointer:fine)');
  let closeTimer;
  function setOpen(open) {
    clearTimeout(closeTimer);
    menu.dataset.open = String(open);
    trigger.setAttribute('aria-expanded', String(open));
    panel.inert = !open;
  }
  function syncActive() {
    menu.dataset.active = String(items.some(link => link.getAttribute('aria-current') === 'page'));
    const current = items.find(link => link.getAttribute('aria-current') === 'page');
    trigger.title = current ? '模型菜单 · ' + current.textContent : '模型菜单';
  }
  trigger.addEventListener('click', event => {
    setOpen(event.detail > 0 && hover.matches ? true : menu.dataset.open !== 'true');
  });
  menu.addEventListener('pointerenter', event => {
    if (hover.matches && event.pointerType === 'mouse') setOpen(true);
  });
  menu.addEventListener('pointerleave', () => {
    closeTimer = setTimeout(() => {
      if (!menu.contains(document.activeElement) || !document.activeElement.matches(':focus-visible')) setOpen(false);
    }, 180);
  });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      (event.key === 'ArrowUp' ? items.at(-1) : items.find(link => link.hasAttribute('aria-current')) || items[0]).focus();
    }
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.focus();
    } else if (panel.contains(event.target) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  });
  menu.addEventListener('focusout', () => {
    setTimeout(() => { if (!menu.contains(document.activeElement)) setOpen(false); }, 0);
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) setOpen(false); });
  for (const link of items) {
    link.addEventListener('click', event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      setOpen(false);
      trigger.focus({preventScroll:true});
      syncActive();
    });
  }
  window.addEventListener('popstate', () => { setOpen(false); syncActive(); });
  hover.addEventListener('change', () => setOpen(false));
  setOpen(false);
  syncActive();
})();
