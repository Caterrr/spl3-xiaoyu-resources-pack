(() => {
  const menus = [...document.querySelectorAll('.game-menu')];
  const hover = matchMedia('(hover:hover) and (pointer:fine)');
  const controls = menus.map(menu => ({
    menu,
    trigger: menu.querySelector('.game-menu-trigger'),
    panel: menu.querySelector('.game-subnavigation'),
    items: [...menu.querySelectorAll('.game-subnavigation a')],
    closeTimer: undefined,
  }));

  function setOpen(control, open) {
    clearTimeout(control.closeTimer);
    if (open) controls.filter(other => other !== control).forEach(other => setOpen(other, false));
    control.menu.dataset.open = String(open);
    control.trigger.setAttribute('aria-expanded', String(open));
    control.panel.inert = !open;
  }

  function syncActive() {
    const params = new URLSearchParams(location.search);
    const libraryPage = location.pathname.endsWith('/library.html');
    const gameKey = params.get('game') || 'spl3';
    const section = params.get('section') || (gameKey === 'spl3' ? 'new' : 'weapons');
    for (const control of controls) {
      const active = libraryPage && control.menu.dataset.game === gameKey;
      control.menu.dataset.active = String(active);
      if (active) control.trigger.setAttribute('aria-current', 'true');
      else control.trigger.removeAttribute('aria-current');
      for (const link of control.items) {
        if (active && link.dataset.section === section) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    }
  }

  for (const control of controls) {
    const {menu, trigger, panel, items} = control;
    let triggerPointer;
    trigger.addEventListener('pointerdown', event => {
      triggerPointer = event.pointerType;
    });
    trigger.addEventListener('click', event => {
      const mouseClick = event.detail > 0 && hover.matches && (event.pointerType || triggerPointer) === 'mouse';
      setOpen(control, mouseClick || menu.dataset.open !== 'true');
    });
    menu.addEventListener('pointerenter', event => {
      if (hover.matches && event.pointerType === 'mouse') setOpen(control, true);
    });
    menu.addEventListener('pointerleave', event => {
      if (!hover.matches || event.pointerType !== 'mouse') return;
      control.closeTimer = setTimeout(() => {
        if (!menu.contains(document.activeElement) || !document.activeElement.matches(':focus-visible')) setOpen(control, false);
      }, 200);
    });
    trigger.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      setOpen(control, true);
      (event.key === 'ArrowUp' ? items.at(-1) : items.find(link => link.hasAttribute('aria-current')) || items[0]).focus();
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(control, false);
        trigger.focus({preventScroll: true});
      } else if (panel.contains(event.target) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    });
    menu.addEventListener('focusout', () => {
      setTimeout(() => { if (!menu.contains(document.activeElement)) setOpen(control, false); }, 0);
    });
    for (const link of items) {
      link.addEventListener('click', event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        setOpen(control, false);
        trigger.focus({preventScroll: true});
        queueMicrotask(syncActive);
      });
    }
    setOpen(control, false);
  }
  document.addEventListener('pointerdown', event => {
    controls.filter(control => !control.menu.contains(event.target)).forEach(control => setOpen(control, false));
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const control of controls.filter(control => control.menu.dataset.open === 'true')) {
      const returnFocus = control.menu.contains(document.activeElement);
      setOpen(control, false);
      if (returnFocus) control.trigger.focus({preventScroll: true});
    }
  });
  window.addEventListener('popstate', () => {
    controls.forEach(control => setOpen(control, false));
    syncActive();
  });
  hover.addEventListener('change', () => controls.forEach(control => setOpen(control, false)));
  syncActive();
})();
