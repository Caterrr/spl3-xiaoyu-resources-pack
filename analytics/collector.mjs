// Public write-only collector. Reports are visible only through the owner's Cloudflare account.
const ORIGIN = 'https://caterrr.github.io';
const PREFIX = '/spl3-xiaoyu-resources-pack/';
const EVENTS = new Set(['page_open', 'preview_start', 'preview_ready', 'preview_error', 'preview_cancel', 'download_click', 'download_file_ready', 'download_error']);
const DEVICES = new Set(['mobile', 'desktop', 'tablet', 'other']);
const SYSTEMS = new Set(['iOS', 'Android', 'Windows', 'macOS', 'Linux', 'other']);
const BROWSERS = new Set(['Safari', 'Chrome', 'Edge', 'Firefox', 'Samsung Internet', 'WeChat', 'other']);
const bounded = (value, values, fallback = 'other') => values.has(value) ? value : fallback;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,180}$/.test(value) ? value : '';
const number = (value, max) => Number.isFinite(value) && value >= 0 ? Math.min(max, Math.round(value)) : undefined;
const limits = new Map();

export function sanitizeEvent(event, path, test = false) {
  if (!event || !EVENTS.has(event.event)) return null;
  const row = {
    kind: 'spl3_usage', schema_version: 1, site: 'spl3-xiaoyu-resources-pack',
    mode: test ? 'test' : 'production', event: event.event, path,
    device_type: bounded(event.device_type, DEVICES),
    os: bounded(event.os, SYSTEMS), browser: bounded(event.browser, BROWSERS),
  };
  for (const key of ['model_id', 'preview_id', 'download_id', 'section']) {
    const value = identifier(event[key]);
    if (value) row[key] = value;
  }
  if (['blend', 'glb'].includes(event.format)) row.format = event.format;
  const duration = number(event.duration_ms, 3600000);
  if (duration !== undefined) row.duration_ms = duration;
  const bytes = number(event.model_bytes, 21474836480);
  if (bytes !== undefined) row.model_bytes = bytes;
  if (['load', 'viewer', 'fetch', 'save', 'unknown'].includes(event.reason)) row.reason = event.reason;
  // Deliberately discard all unknown fields, full URLs, raw UA, identifiers, and error messages.
  return row;
}

async function boundedBody(request) {
  if (Number(request.headers.get('content-length')) > 16384) throw new Error('large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('empty');
  const chunks = []; let size = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new Error('large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = {'Access-Control-Allow-Origin': ORIGIN, 'Vary': 'Origin', 'Cache-Control': 'no-store'};
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ok: true, version: 1, service: 'spl3-usage'}, {headers});
    }
    if (url.pathname !== '/events') return new Response('Not found', {status: 404});
    if (request.headers.get('Origin') !== ORIGIN) return new Response('Forbidden', {status: 403});
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type'}});
    if (request.method !== 'POST') return new Response('Method not allowed', {status: 405, headers});
    if (/bot|crawler|spider|headless/i.test(request.headers.get('User-Agent') || '')) return new Response(null, {status: 204, headers});
    // Short-lived, per-isolate abuse limit; no IP addresses are logged or stored durably.
    const now = Date.now(), ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (limits.size > 5000) limits.clear();
    let rate = limits.get(ip);
    if (!rate || now - rate.started > 60000) { rate = {started: now, count: 0}; limits.set(ip, rate); }
    if (++rate.count > 120) return new Response(null, {status: 429, headers});
    try {
      const body = await boundedBody(request);
      if (typeof body.path !== 'string' || !body.path.startsWith(PREFIX) || body.path.length > 160 || /[?#\s]/.test(body.path)) throw new Error('path');
      if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 8) throw new Error('batch');
      const rows = body.events.map(event => sanitizeEvent(event, body.path, body.test === true));
      if (rows.some(row => !row)) throw new Error('event');
      for (const row of rows) console.log(row);
      return new Response(null, {status: 204, headers});
    } catch {
      return new Response('Invalid event batch', {status: 400, headers});
    }
  },
};
