(() => {
  try {
    const h = location.hostname;
    let v;
    if (h.startsWith('happy.')) v = 'happy';
    else if (h.startsWith('tech.')) v = 'tech';
    else if (h.startsWith('finance.')) v = 'finance';

    if (!v && (h === 'localhost' || h === '127.0.0.1' || '__TAURI_INTERNALS__' in window)) {
      v = localStorage.getItem('worldmonitor-variant');
    }

    if (v) document.documentElement.dataset.variant = v;
    else document.documentElement.removeAttribute('data-variant');

    const t = localStorage.getItem('worldmonitor-theme');
    if (t === 'dark' || t === 'light') {
      document.documentElement.dataset.theme = t;
    } else if (v === 'happy') {
      document.documentElement.dataset.theme = 'light';
    }
  } catch {
    // Ignore storage access and hostname parsing errors during early boot.
  }

  document.documentElement.classList.add('no-transition');
})();
