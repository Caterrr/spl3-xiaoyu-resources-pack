import {impactScales, recoilFace, scatterSquares} from './credit-scatter.js?v=f831e0529eac';

const dialog = document.querySelector('#credit-dialog');
const refusal = dialog.querySelector('.credit-secondary');
const face = refusal.querySelector('.credit-button-face');
const accept = dialog.querySelector('.credit-primary');
let hits = 0, recoil, clearBurst;

dialog.addEventListener('keydown', event => {
  if (event.key === 'Tab') dialog.setAttribute('data-keyboard-nav', '');
});

async function dismiss() {
  if (dialog.hasAttribute('data-closing')) return;
  dialog.setAttribute('data-closing', '');
  recoil?.cancel();
  clearBurst?.();
  await Promise.allSettled(dialog.getAnimations().map(animation => animation.finished));
  dialog.close();
  dialog.removeAttribute('data-closing');
}

refusal.addEventListener('click', async () => {
  if (hits >= impactScales.length || dialog.hasAttribute('data-closing')) return;
  recoil = recoilFace(face, hits++, recoil);
  if (hits < impactScales.length) return;
  if (document.activeElement === refusal) accept.focus({preventScroll: true});
  refusal.disabled = true;
  try { await recoil?.finished; } catch { return; }
  if (dialog.open && !dialog.hasAttribute('data-closing')) clearBurst = scatterSquares(refusal);
});
accept.addEventListener('click', dismiss);
dialog.addEventListener('cancel', event => event.preventDefault());
dialog.showModal();
