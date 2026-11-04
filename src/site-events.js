(() => {
  const enabled = location.protocol === 'https:' && location.hostname === 'caterrr.github.io' && location.pathname.startsWith('/spl3-xiaoyu-resources-pack/');
  if (!enabled) return;
  const endpoint = 'https://spl3-usage.cater-dcy.workers.dev/events';
  const ua = navigator.userAgent || '';
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const ios = ipad || /iPhone|iPod/.test(ua);
  const android = /Android/.test(ua);
  const device_type = ipad || /Tablet|PlayBook|Silk/.test(ua) || (android && !/Mobile/.test(ua)) ? 'tablet'
    : /iPhone|iPod|Mobile/.test(ua) ? 'mobile'
    : /Windows NT|Macintosh|X11|CrOS|Linux/.test(ua) ? 'desktop' : 'other';
  const os = ios ? 'iOS' : android ? 'Android' : /Windows NT/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'macOS' : /Linux|X11|CrOS/.test(ua) ? 'Linux' : 'other';
  const browser = /MicroMessenger/.test(ua) ? 'WeChat' : /Edg(?:e|A|iOS)?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'other';
  const common = {device_type, os, browser};
  const test = new URL(location.href).searchParams.get('analytics_test') === '1';
  const pending = []; let timer;
  const id = () => crypto.randomUUID(); // One-operation identifiers, never persisted across pages.
  function flush() {
    clearTimeout(timer); timer = undefined;
    if (!pending.length) return;
    const events = pending.splice(0, 8);
    try {
      fetch(endpoint, {
        method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true, referrerPolicy: 'no-referrer',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'},
        body: JSON.stringify({path: location.pathname, test, events}),
      }).catch(() => {});
    } catch {}
    if (pending.length) timer = setTimeout(flush, 300);
  }
  function emit(event, values = {}) {
    try {
      if (pending.length >= 48) return;
      pending.push({...common, ...values, event});
      if (pending.length >= 6) flush();
      else if (!timer) timer = setTimeout(flush, 1000);
    } catch {} // Measurement must never interrupt previews or downloads.
  }
  const elapsed = start => Math.max(0, Math.round(performance.now() - start));
  window.Spl3Metrics = {
    previewStart(item, section) {
      const values = {model_id: item.id, section, preview_id: id(), model_bytes: item.glbBytes};
      const start = performance.now(); let settled = false;
      emit('preview_start', values);
      return {
        model_id: item.id, preview_id: values.preview_id,
        ready() { if (!settled) { settled = true; emit('preview_ready', {...values, duration_ms: elapsed(start)}); } },
        error(reason = 'unknown') { if (!settled) { settled = true; emit('preview_error', {...values, reason, duration_ms: elapsed(start)}); } },
        cancel() { if (!settled) { settled = true; emit('preview_cancel', {...values, duration_ms: elapsed(start)}); } },
      };
    },
    downloadClick(item, format, preview) {
      const values = {model_id: item.id, format, download_id: id(), preview_id: preview?.model_id === item.id ? preview.preview_id : undefined};
      const start = performance.now(); let settled = false;
      emit('download_click', values);
      return {
        ready() { if (!settled) { settled = true; emit('download_file_ready', {...values, duration_ms: elapsed(start)}); } },
        error(reason = 'unknown') { if (!settled) { settled = true; emit('download_error', {...values, reason, duration_ms: elapsed(start)}); } },
      };
    },
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  const params=new URL(location.href).searchParams;
  const game=['spl3','raiders','phantom'].includes(params.get('game'))?params.get('game'):'spl3';
  const section=params.get('section');
  emit('page_open',{section:game+':'+(['old','new','sub-special','weapons','skills','maps','scenes','props','characters','decor'].includes(section)?section:'home')});
})();
