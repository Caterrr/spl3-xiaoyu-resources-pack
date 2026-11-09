(() => {
  const storageKey = 'xiaoyu:ink-arrival';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const pages = /\/(?:index|library|about)\.html$/;
  const root = document.documentElement;
  let overlay;
  let frame = 0;

  const fragment = `
    precision highp float;
    uniform vec2 size;
    uniform float progress;
    uniform float uncover;
    const vec3 ink = vec3(.019, .016, .022);

    float pool(vec2 p, float radius, float seed) {
      float angle = atan(p.y, p.x);
      float edge = .09 * sin(5.0 * angle + seed)
                 + .061 * sin(9.0 * angle - seed)
                 + .032 * cos(17.0 * angle + seed);
      return length(p) - radius * (1.0 + edge);
    }

    void main() {
      vec2 uv = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
      vec2 bounds = size / length(size);
      vec2 p = uv / length(size);
      if (uncover > .5) p = bounds - p;

      float t = progress;
      float swell = t * t * (3.0 - 2.0 * t);
      vec2 start = vec2(-.05, -.075) * bounds;
      float edge = pool(p - start - bounds * .14 * swell, 1.38 * swell, 1.7);
      for (int i = 0; i < 13; ++i) {
        float id = float(i);
        float seed = fract(sin(id * 39.29 + 4.7) * 1597.53);
        float theta = -.33 + id * .183 + seed * .17;
        vec2 ray = vec2(cos(theta), sin(theta));
        float travel = (.46 + .59 * seed) * pow(t, .77);
        float r = (.032 + .115 * seed) * smoothstep(.01, .38, t);
        edge = min(edge, pool(p - start - ray * travel, r, id * 1.45));
        vec2 fleck = start + ray * (travel + (.09 + .11 * seed) * sin(t * 2.2));
        edge = min(edge, length(p - fleck) - (.005 + .018 * seed) * sin(t * 3.14));
      }

      float coverage = 1.0 - smoothstep(-.002, .002, edge);
      coverage = mix(coverage, 1.0, smoothstep(.86, 1.0, t));
      float rim = smoothstep(-.009, -.001, edge) * (1.0 - smoothstep(.72, .91, t));
      gl_FragColor = vec4(mix(ink, vec3(.29, .11, .045), rim * .36), coverage);
    }
  `;

  function createPainter(canvas) {
    const gl = canvas.getContext('webgl', {alpha: true, premultipliedAlpha: false, antialias: false});
    if (!gl) return;
    function shader(type, source) {
      const result = gl.createShader(type);
      gl.shaderSource(result, source);
      gl.compileShader(result);
      return result;
    }
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 point; void main(){gl_Position=vec4(point,0.,1.);}'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const point = gl.getAttribLocation(program, 'point');
    gl.enableVertexAttribArray(point);
    gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
    const size = gl.getUniformLocation(program, 'size');
    const progress = gl.getUniformLocation(program, 'progress');
    const uncover = gl.getUniformLocation(program, 'uncover');

    return (value, incoming) => {
      const scale = Math.min(1, 960 / Math.max(innerWidth, innerHeight));
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
    delete root.dataset.inkArrival;
  }

  function play(incoming, done) {
    overlay = document.createElement('div');
    overlay.className = 'ink-navigation';
    overlay.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    overlay.append(canvas);
    document.body.append(overlay);
    let paint;
    try { paint = createPainter(canvas); } catch {}
    if (!paint) {
      canvas.remove();
      overlay.classList.add('ink-navigation-fallback');
    }
    const started = performance.now();
    const duration = incoming ? 570 : 480;
    function draw(now) {
      const t = reducedMotion.matches ? 1 : Math.min(1, (now - started) / duration);
      const value = incoming ? 1 - t : t;
      if (paint) paint(value, incoming);
      else {
        const center = incoming ? '100% 100%' : '0 0';
        overlay.style.clipPath = `circle(${value * 160}vmax at ${center})`;
      }
      if (t < 1) frame = requestAnimationFrame(draw);
      else done();
    }
    draw(started);
    delete root.dataset.inkArrival;
  }

  let arrival = false;
  try {
    const stamp = JSON.parse(sessionStorage.getItem(storageKey));
    arrival = stamp?.url === location.href && Date.now() - stamp.at < 15000;
    sessionStorage.removeItem(storageKey);
  } catch {}
  if (arrival && !reducedMotion.matches) play(true, removeOverlay);
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
    play(false, () => {
      try { sessionStorage.setItem(storageKey, JSON.stringify({url: url.href, at: Date.now()})); } catch {}
      location.assign(url.href);
    });
  });
  window.addEventListener('pagehide', removeOverlay);
})();
