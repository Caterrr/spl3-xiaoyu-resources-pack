const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const oranges = ['#ff5e18', '#ff6c1e', '#ff7c2c', '#f76b20', '#ff8937'];
const random = (min, max) => min + Math.random() * (max - min);

export const impactScales = [0.8, 0.6, 0.4, 0];

export function recoilFace(face, index, previousAnimation) {
  const current = getComputedStyle(face).transform;
  previousAnimation?.cancel();
  const from = index === 0 ? 1 : impactScales[index - 1];
  const to = impactScales[index];
  const resting = 'scale(' + to + ')';
  face.style.transform = resting;
  if (reducedMotion.matches) return;

  const contact = 'scale(' + from * .94 + ',' + from * .78 + ')';
  const rebound = 'scale(' + to * 1.04 + ',' + to * 1.07 + ')';
  return face.animate([
    {transform: current},
    {transform: contact, offset: .16},
    {transform: contact, offset: .37},
    {transform: to === 0 ? contact : rebound, offset: .78},
    {transform: resting}
  ], {duration: to === 0 ? 96 : 185});
}

export function scatterSquares(button) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  const dialog = button.closest('dialog');
  canvas.className = 'credit-scatter-layer';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none',
    margin: '0', padding: '0', border: '0', background: 'transparent', pointerEvents: 'none', zIndex: '10'
  });
  // Native dialogs occupy the top layer. Give the particles their own viewport-sized surface there.
  if (dialog && canvas.showPopover) canvas.setAttribute('popover', 'manual');
  (dialog || document.body).append(canvas);
  if (canvas.hasAttribute('popover')) canvas.showPopover();

  const box = button.getBoundingClientRect();
  const bounds = canvas.getBoundingClientRect();
  const x = box.left + box.width / 2 - bounds.left;
  const y = box.top + box.height / 2 - bounds.top;
  const gravity = Math.max(680, bounds.height * 1.14);
  const lift = Math.sqrt(2 * gravity * Math.max(8, Math.min(y - 10, 154)));
  const still = reducedMotion.matches;
  const drag = 2.8;
  const count = still ? 18 : 88;
  const squares = Array.from({length: count}, (_, i) => {
    const angle = (i + random(-.4, .4)) * Math.PI * 2 / count;
    const speed = 490 * random(.30, 1);
    return {
      x: x + (still ? random(-18, 18) : random(-2, 2)),
      y: y + (still ? random(-8, 8) : random(-2, 2)),
      vx: Math.max((4 - x) * drag, Math.min((bounds.width - 4 - x) * drag, Math.cos(angle) * speed)),
      vy: Math.max(-lift, Math.sin(angle) * speed * .77 - 36),
      gravity: gravity * random(1, 1.13), delay: random(0, .018),
      size: random(2, 4.4), color: oranges[Math.floor(random(0, oranges.length))],
      angle: random(0, Math.PI), spin: random(-4, 4)
    };
  });
  const start = performance.now();
  let frame;
  function remove() {
    cancelAnimationFrame(frame);
    canvas.remove();
  }
  function draw(now) {
    const age = (now - start) / 1000;
    if (still && age >= .18) { remove(); return; }
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.globalAlpha = still ? Math.max(0, 1 - age / .18) : 1;
    for (let i = squares.length - 1; i >= 0; i--) {
      const p = squares[i];
      if (age < p.delay) continue;
      const t = still ? 0 : age - p.delay;
      const py = p.y + p.vy * t + .5 * p.gravity * t * t;
      if (py - p.size > height && p.vy + p.gravity * t > 0) {
        squares.splice(i, 1);
        continue;
      }
      const px = p.x + p.vx * -Math.expm1(-drag * t) / drag;
      context.save();
      context.translate(px, py);
      context.rotate(p.angle + p.spin * t);
      context.fillStyle = p.color;
      context.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      context.restore();
    }
    if (squares.length) frame = requestAnimationFrame(draw);
    else remove();
  }
  frame = requestAnimationFrame(draw);
  return remove;
}
