// Shared HTML helpers used across routes

const esc = (s = '') => String(s)
  .replace(/&/g,'&amp;')
  .replace(/"/g,'&quot;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;');

const levelColor = (l) => ({
  'Barangay':      '#00d4aa',
  'City/Municipal':'#ff6b35',
  'Provincial':    '#f7c948',
  'Regional':      '#a78bfa'
}[l] || '#888');

const levelBadge = (l) => {
  const c = levelColor(l);
  return `<span class="badge" style="color:${c};background:${c}18;border:1px solid ${c}40">${l}</span>`;
};

const statusBadge = (s) => {
  const map = {
    ongoing: ['#00d4aa', '● ONGOING'],
    upcoming:['#ff6b35', '◷ UPCOMING'],
    final:   ['#888',    '✓ FINAL'],
  };
  const [c, t] = map[s] || ['#888', s];
  return `<span class="badge" style="color:${c};background:${c}18;border:1px solid ${c}40">${t}</span>`;
};

const page = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#e63329">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="PH HOOPS">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png?v=2">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png?v=2">
<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src-elem 'self' 'unsafe-inline'; script-src-attr 'self' 'unsafe-inline' 'unsafe-hashes'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:;">
<title>${title}</title>
<link rel="stylesheet" href="/css/main.css">
</head>
<body class="dark-bg">${body}<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
</script>
</body>
</html>`;

module.exports = { esc, levelColor, levelBadge, statusBadge, page };
