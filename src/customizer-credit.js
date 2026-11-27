(() => {
  const dialog = document.querySelector('#credit-dialog');

  dialog.addEventListener('keydown', event => {
    if (event.key === 'Tab') dialog.setAttribute('data-keyboard-nav', '');
  });

  async function dismiss() {
    if (dialog.hasAttribute('data-closing')) return;
    dialog.setAttribute('data-closing', '');
    await Promise.allSettled(dialog.getAnimations().map(animation => animation.finished));
    dialog.close();
    dialog.removeAttribute('data-closing');
  }

  for (const button of dialog.querySelectorAll('.credit-actions button')) {
    button.addEventListener('click', dismiss);
  }
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    dismiss();
  });
  dialog.showModal();
})();
