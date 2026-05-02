const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();
const db       = require('../db/database');
const { generateToken } = require('../middleware/auth');
const { esc, page } = require('../helpers');

// ── GET /login ────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.send(page('Login | PH Hoops', authCard(`
    <div class="auth-logo"><img src="/icons/icon-192.png" alt="PH Hoops" style="width:72px;height:72px;border-radius:16px;object-fit:cover;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto"><div style="font-family:'Russo One',sans-serif;font-size:20px;letter-spacing:2px;color:var(--text)">PH HOOPS</div></div>
    <h2>Commissioner Login</h2>
    <p class="auth-sub">Manage your basketball league</p>
    <form action="/login" method="POST">
      <div class="field-group"><label>Email</label>
        <input name="email" type="text" class="input" placeholder="your@email.com" autofocus required /></div>
      <div class="field-group"><label>Password</label>
        <input name="password" type="password" class="input" placeholder="••••••••" required /></div>
      <button type="submit" class="btn-primary full">Login →</button>
    </form>
    <div class="auth-alt">No account? <a href="/register">Register here</a></div>
  `)));
});

// ── POST /login ───────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body;
    const user = await db.queryOne(
      'SELECT * FROM users WHERE email=$1', [email.toLowerCase().trim()]
    );
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.send(page('Login | PH Hoops', authCard(`
        <div class="auth-logo"><img src="/icons/icon-192.png" alt="PH Hoops" style="width:72px;height:72px;border-radius:16px;object-fit:cover;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto"><div style="font-family:'Russo One',sans-serif;font-size:20px;letter-spacing:2px;color:var(--text)">PH HOOPS</div></div>
        <h2>Commissioner Login</h2>
        <div class="alert-error">❌ Invalid email or password.</div>
        <form action="/login" method="POST">
          <div class="field-group"><label>Email</label>
            <input name="email" type="text" class="input" value="${esc(email)}" autofocus required /></div>
          <div class="field-group"><label>Password</label>
            <input name="password" type="password" class="input" required /></div>
          <button type="submit" class="btn-primary full">Login →</button>
        </form>
        <div class="auth-alt">No account? <a href="/register">Register here</a></div>
      `)));
    }
    // Always use DB role (not cached token) for redirect
    req.session.token = generateToken(user);
    if (user.role === 'superadmin') return res.redirect('/superadmin');
    res.redirect('/admin');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Server error');
  }
});

// ── GET /register ─────────────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  const errMap = {
    exists:  '⚠ Email already registered.',
    invalid: '⚠ Please fill all fields (password must be at least 6 characters).',
  };
  const errMsg = errMap[req.query.error] || '';
  res.send(page('Register | PH Hoops', authCard(`
    <div class="auth-logo"><img src="/icons/icon-192.png" alt="PH Hoops" style="width:72px;height:72px;border-radius:16px;object-fit:cover;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto"><div style="font-family:'Russo One',sans-serif;font-size:20px;letter-spacing:2px;color:var(--text)">PH HOOPS</div></div>
    <h2>Create Account</h2>
    <p class="auth-sub">Start managing your league for free</p>
    ${errMsg ? `<div class="alert-error">${errMsg}</div>` : ''}
    <form action="/register" method="POST">
      <div class="field-group"><label>Full Name</label>
        <input name="name" class="input" placeholder="Commissioner Name" required /></div>
      <div class="field-group"><label>Email</label>
        <input name="email" type="email" class="input" placeholder="your@email.com" required /></div>
      <div class="field-group"><label>Password</label>
        <input name="password" type="password" class="input" placeholder="Min 6 characters" required /></div>
      <button type="submit" class="btn-primary full">Create Account →</button>
    </form>
    <div class="auth-alt">Already have an account? <a href="/login">Login</a></div>
  `)));
});

// ── POST /register ────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name = '', email = '', password = '' } = req.body;
    if (!name.trim() || !email.trim() || password.length < 6)
      return res.redirect('/register?error=invalid');
    const existing = await db.queryOne('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (existing) return res.redirect('/register?error=exists');
    const hash = bcrypt.hashSync(password, 10);
    const user = await db.queryOne(
      `INSERT INTO users (email,password,name,plan,role) VALUES ($1,$2,$3,'free','commissioner') RETURNING *`,
      [email.toLowerCase().trim(), hash, name.trim()]
    );
    req.session.token = generateToken(user);
    res.redirect('/admin');
  } catch (err) {
    console.error('Register error:', err);
    res.redirect('/register?error=invalid');
  }
});

// ── GET /logout ───────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

function authCard(inner) {
  return `<div class="auth-wrap"><div class="auth-card">${inner}</div></div>`;
}

module.exports = router;
