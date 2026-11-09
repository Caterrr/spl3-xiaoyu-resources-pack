(() => {
  const storageKey = 'xiaoyu:ink-arrival';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const pages = /\/(?:index|library|about)\.html$/;
  const root = document.documentElement;
  const COVER_MS = 840;
  const REVEAL_AT_MS = 1200;
  const REVEAL_MS = 1000;
  let overlay, dispose;
  let frame = 0;

  // A growing noise threshold joins ink islands into a solid sheet. The reveal
  // is a separate downward wipe, accelerating as the ink leaves the screen.
  const fragment = `
    precision highp float;
    uniform vec2 size;
    uniform float progress;
    uniform float uncover;
    uniform float seed;
    const vec3 purple = vec3(96., 59., 255.) / 255.;
    const vec3 lime = vec3(234., 255., 62.) / 255.;

    vec2 gradient(vec2 cell) {
      float angle = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453) * 6.283185;
      return vec2(cos(angle), sin(angle));
    }
    float noise(vec2 p) {
      vec2 cell = floor(p), f = fract(p);
      vec2 w = f * f * f * (f * (f * 6. - 15.) + 10.);
      float a = dot(gradient(cell), f);
      float b = dot(gradient(cell + vec2(1., 0.)), f - vec2(1., 0.));
      float c = dot(gradient(cell + vec2(0., 1.)), f - vec2(0., 1.));
      float d = dot(gradient(cell + vec2(1., 1.)), f - vec2(1., 1.));
      return clamp(.5 + 1.35 * mix(mix(a, b, w.x), mix(c, d, w.x), w.y), .08, .92);
    }
    float field(vec2 p, vec2 bounds, float radius) {
      vec2 center = mix(vec2(0.), bounds * .5, progress);
      float distance = length(p - center) - max(bounds.x, bounds.y) * radius * progress;
      return 1. - smoothstep(-.4, .4 * progress, distance) + smoothstep(.9, 1., progress);
    }
    void main() {
      float unit = min(size.x, size.y);
      vec2 bounds = size / unit;
      vec2 p = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y) / unit;
      float primary, under;
      if (uncover < .5) {
        float n = noise(p * 2.4 + seed);
        float coverage = field(p, bounds, .80);
        primary = smoothstep(n - .006, n + .006, coverage);
        under = smoothstep(n - .006, n + .006, coverage + .035 * (1. - progress));
      } else {
        float t = progress * progress;
        float front = mix(-.4, bounds.y + .4, t);
        float n = noise(p * 2. + vec2(seed, seed + t * 18.)) - .5;
        float edge = p.y - front + n * .44;
        primary = smoothstep(-.003, .003, edge);
        under = smoothstep(-.003, .003, edge + .065 * sin(t * 3.141593));
      }
      gl_FragColor = vec4(mix(lime, purple, primary), max(primary, under));
    }
  `;

  function createPainter(canvas, seedValue) {
    const gl = canvas.getContext('webgl', {alpha: true, premultipliedAlpha: false, antialias: false});
    if (!gl) return;
    function shader(type, source) {
      const result = gl.createShader(type);
      gl.shaderSource(result, source);
      gl.compileShader(result);
      return result;
    }
    const program = gl.createProgram();
    const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 point; void main(){gl_Position=vec4(point,0.,1.);}');
    const pixel = shader(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, pixel);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const point = gl.getAttribLocation(program, 'point');
    gl.enableVertexAttribArray(point);
    gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
    const size = gl.getUniformLocation(program, 'size');
    const progress = gl.getUniformLocation(program, 'progress');
    const uncover = gl.getUniformLocation(program, 'uncover');
    gl.uniform1f(gl.getUniformLocation(program, 'seed'), seedValue);
    dispose = () => {gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(pixel);gl.getExtension('WEBGL_lose_context')?.loseContext();};

    return (value, incoming) => {
      const scale = Math.min(devicePixelRatio || 1, 1280 / Math.max(innerWidth, innerHeight));
      const width = Math.max(1, Math.round(innerWidth * scale));
      const height = Math.max(1, Math.round(innerHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.uniform2f(size, width, height);
      gl.uniform1f(progress, value);
      gl.uniform1f(uncover, incoming ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  }

  function removeOverlay() {
    cancelAnimationFrame(frame);
    overlay?.remove();
    overlay = undefined;
    dispose?.();dispose = undefined;
    delete root.dataset.inkArrival;
  }

  function play(incoming, stamp, done) {
    overlay = document.createElement('div');
    overlay.className = 'ink-navigation';
    overlay.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    overlay.append(canvas);
    document.body.append(overlay);
    let paint;
    try { paint = createPainter(canvas, stamp.seed); } catch {}
    if (!paint) {
      canvas.remove();
      overlay.classList.add('ink-navigation-fallback');
    }
    const started = performance.now();
    const hold = incoming ? Math.max(0, stamp.revealAt - Date.now()) : 0;
    const duration = incoming ? REVEAL_MS : COVER_MS;
    function draw(now) {
      const t = reducedMotion.matches ? 1 : Math.min(1, Math.max(0, now - started - hold) / duration);
      if (paint) paint(incoming ? t : .1 + .9 * t, incoming);
      else overlay.style.clipPath = incoming ? `inset(${t * t * 100}% 0 0)` : `circle(${(.1 + .9 * t) * 150}vmax at 0 0)`;
      if (t < 1) frame = requestAnimationFrame(draw);
      else done();
    }
    draw(started);
    delete root.dataset.inkArrival;
  }

  let arrival;
  try {
    const stamp = JSON.parse(sessionStorage.getItem(storageKey));
    if (stamp?.url === location.href && Date.now() - stamp.at < 15000) arrival = stamp;
    sessionStorage.removeItem(storageKey);
  } catch {}
  if (arrival && !reducedMotion.matches) play(true, {...arrival, seed: arrival.seed || 1, revealAt: arrival.revealAt || Date.now()}, removeOverlay);
  else delete root.dataset.inkArrival;

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || reducedMotion.matches ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('.navigation a[href], .game-choice[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !pages.test(url.pathname) || url.hash || url.href === location.href) return;
    event.preventDefault();
    if (overlay) return;
    const at = Date.now();
    const stamp = {url: url.href, at, revealAt: at + REVEAL_AT_MS, seed: Math.random() * 100};
    const preload = document.createElement('link');
    preload.rel = 'prefetch';preload.href = url.href;document.head.append(preload);
    play(false, stamp, () => {
      try { sessionStorage.setItem(storageKey, JSON.stringify(stamp)); } catch {}
      location.assign(url.href);
    });
  });
  window.addEventListener('pagehide', removeOverlay);
})();
