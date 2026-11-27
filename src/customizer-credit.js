(() => {
  const dialog = document.querySelector('#credit-dialog');
  const copy = dialog.querySelector('[data-copy]');
  const fallback = dialog.querySelector('#credit-fallback');
  const url = dialog.querySelector('#credit-url');

  async function dismiss() {
    if (dialog.hasAttribute('data-closing')) return;
    dialog.setAttribute('data-closing', '');
    await Promise.allSettled(dialog.getAnimations().map(animation => animation.finished));
    dialog.close();
    dialog.removeAttribute('data-closing');
  }

  dialog.querySelector('[data-accept]').addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    dismiss();
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url.value);
    } catch {
      if (!dialog.open) return;
      fallback.hidden = false;
      url.focus();
      url.select();
      try {
        if (!document.execCommand('copy')) return;
      } catch {
        return;
      }
      fallback.hidden = true;
      copy.focus();
    }
    copy.textContent = '已复制';
  });
  dialog.showModal();
})();
