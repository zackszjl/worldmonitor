(() => {
  if (!('serviceWorker' in navigator)) return;

  const key = 'wm-sw-nuke';
  if (sessionStorage.getItem(key)) return;

  window.addEventListener('error', (e) => {
    const target = e.target;
    const url = target && (target.src || target.href) || '';
    if (!url || !/\/assets\//.test(url)) return;

    sessionStorage.setItem(key, '1');
    navigator.serviceWorker.getRegistrations().then((regs) => {
      const unregisters = regs.map((r) => r.unregister());
      Promise.all(unregisters).then(() => {
        if (caches && caches.keys) {
          caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => {
            location.reload();
          });
        } else {
          location.reload();
        }
      });
    });
  }, true);
})();
