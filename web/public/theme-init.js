// Applies the saved theme before the first paint. A file, not an inline script, because the server's CSP allows scripts from 'self' only.
try {
  var t = localStorage.getItem('tally.theme');
  if (t !== 'system') document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'light');
}
