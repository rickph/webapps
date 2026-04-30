require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const path       = require('path');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { initDb } = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY ──────────────────────────────────────────────────────────────────
// Disable CSP for now — inline scripts needed for admin panel
app.use(helmet({ contentSecurityPolicy: false }));
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
const authRouter   = require('./routes/auth');
const publicRouter = require('./routes/public');
const adminRouter  = require('./routes/admin');

app.use('/',      authRouter);
app.use('/',      publicRouter);
app.use('/admin', adminRouter);

// Upgrade stub
app.get('/upgrade', (req, res) => res.redirect('/admin'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Not Found | PH Hoops</title>
<link rel="stylesheet" href="/css/main.css"></head>
<body class="dark-bg" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;text-align:center">
  <div style="font-size:64px">🏀</div>
  <h1 style="font-family:'Russo One',sans-serif">Page Not Found</h1>
  <p style="color:#666">The page you're looking for doesn't exist.</p>
  <a href="/" style="color:#ff6b35;font-weight:700">← Go Home</a>
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
║                                          ║
║  Demo: demo@phhoops.com / demo1234       ║
╚══════════════════════════════════════════╝`);
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    console.error('\nMake sure DATABASE_URL is set in your .env file.');
    console.error('See .env.example for the format.\n');
    process.exit(1);
  }
}

boot();
module.exports = app;
