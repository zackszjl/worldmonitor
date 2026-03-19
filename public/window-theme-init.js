(() => {
  try {
    const t = localStorage.getItem('worldmonitor-theme');
    if (t === 'light') document.documentElement.dataset.theme = 'light';
  } catch {
    // Ignore storage access errors during early boot.
  }

  document.documentElement.classList.add('no-transition');
})();
