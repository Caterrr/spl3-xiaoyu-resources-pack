(() => {
  const dialog = document.querySelector('#credit-dialog');
  const refusal = dialog.querySelector('.credit-secondary');
  const face = refusal.querySelector('.credit-button-face');
  const accept = dialog.querySelector('.credit-primary');
  const steps = 5;
  let remaining = steps;

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

  function burst() {
    const count = 16;
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('i');
      particle.className = 'credit-particle';
      particle.setAttribute('aria-hidden', 'true');
      particle.style.setProperty('--angle', ((i + Math.random() * .5) * 360 / count) + 'deg');
      particle.style.setProperty('--distance', (22 + Math.random() * 22) + 'px');
      particle.style.setProperty('--size', (3 + Math.random() * 4) + 'px');
      refusal.append(particle);
      particle.addEventListener('animationend', () => particle.remove(), {once: true});
    }
  }

  refusal.addEventListener('click', async () => {
    if (remaining === 0 || dialog.hasAttribute('data-closing')) return;
    remaining--;
    face.style.setProperty('--size-factor', remaining / steps);
    if (remaining > 0) return;

    if (document.activeElement === refusal) accept.focus({preventScroll: true});
    refusal.disabled = true;
    await Promise.allSettled(face.getAnimations().map(animation => animation.finished));
    if (dialog.open && !dialog.hasAttribute('data-closing')) burst();
  });
  accept.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.showModal();
})();
