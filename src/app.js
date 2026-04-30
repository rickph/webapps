require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const path       = require('path');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { initDb } = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── FORCE OVERRIDE CSP BEFORE ANYTHING ELSE ───────────────────────────────────
// Railway injects its own CSP - we override it on every response
app.use(function(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "script-src-elem 'self' 'unsafe-inline'; " +
    "script-src-attr 'unsafe-inline' 'unsafe-hashes'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self';"
  );
  next();
});

// ── SECURITY ──────────────────────────────────────────────────────────────────
app.use(cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// ── TRUST PROXY (required for Railway) ───────────────────────────────────────
app.set('trust proxy', 1);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'phhoops-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  }
}));

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/',      require('./routes/auth'));
app.use('/',      require('./routes/public'));
app.use('/admin', require('./routes/admin'));
app.get('/upgrade', (req, res) => res.redirect('/admin'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Not Found | PH Hoops</title>
<link rel="stylesheet" href="/css/main.css"></head>
<body class="dark-bg" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;text-align:center">
  <div style="font-size:64px">🏀</div>
  <h1 style="font-family:'Russo One',sans-serif">Page Not Found</h1>
  <p style="color:#666">The page you are looking for does not exist.</p>
  <a href="/" style="color:#ff6b35;font-weight:700">Go Home</a>
</body></html>`);
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── BOOT ──────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════════╗
║  🏀  PH HOOPS League Manager             ║
║  http://localhost:${PORT}                   ║
║  Demo: demo@phhoops.com / demo1234       ║
╚══════════════════════════════════════════╝`);
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    console.error('Make sure DATABASE_URL is set in your .env file.');
    process.exit(1);
  }
}

boot();
module.exports = app;
