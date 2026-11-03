(() => {
  // Only measure the published model library, never local previews or other projects.
  if (
    location.protocol !== 'https:' ||
    location.hostname !== 'caterrr.github.io' ||
    !location.pathname.startsWith('/spl3-xiaoyu-resources-pack/') ||
    document.querySelector('script[data-cf-beacon]')
  ) return;

  const beacon = document.createElement('script');
  beacon.type = 'module';
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  // This public site identifier is generated for embedding by Cloudflare Web Analytics.
  beacon.dataset.cfBeacon = JSON.stringify({ token: 'f9639180fd0c4516aba4dfb0b05d44a5' });
  document.head.append(beacon);
})();
