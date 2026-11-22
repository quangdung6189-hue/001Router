(function () {
  try {
    var saved = localStorage.getItem('r001-color-scheme');
    var scheme = saved === 'light' || saved === 'dark' ? saved : saved === 'system' ? 'light dark' : 'dark';
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = scheme;
    var resolved =
      scheme === 'light dark'
        ? window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : scheme;
    document.documentElement.dataset.theme = resolved;
    var tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.content = resolved === 'light' ? '#FDFAF6' : '#1a1a1a';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
