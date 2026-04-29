const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db/database');
const { generateToken } = require('../middleware/auth');

router.get('/login', (req, res) => res.send(page('Login', authCard(`
  <div class="auth-logo">🏀 PH HOOPS</div>
  <h2>Commissioner Login</h2>
  <p class="auth-sub">Manage your basketball league</p>
  <form action="/login" method="POST">
    <div class="field-group"><label>Email</label><input name="email" type="email" class="input" placeholder="you@email.com" required /></div>
    <div class="field-group"><label>Password</label><input name="password" type="password" class="input" placeholder="••••••••" required /></div>
    <button type="submit" class="btn-primary full">Login →</button>
  </form>
  <div class="auth-alt">No account? <a href="/register">Register free</a></div>
`))));

router.post('/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body;
    const user = await db.queryOne('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.send(page('Login', authCard(`
        <div class="auth-logo">🏀 PH HOOPS</div>
        <h2>Commissioner Login</h2>
        <div class="alert-error">❌ Invalid email or password.</div>
        <form action="/login" method="POST">
          <div class="field-group"><label>Email</label><input name="email" type="email" class="input" value="${esc(email)}" required /></div>
          <div class="field-group"><label>Password</label><input name="password" type="password" class="input" required /></div>
          <button type="submit" class="btn-primary full">Login →</button>
        </form>
        <div class="auth-alt">No account? <a href="/register">Register free</a></div>
      `)));
    }
    req.session.token = generateToken(user);
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.get('/register', (req, res) => {
  const errMap = { exists: '⚠ Email already registered.', invalid: '⚠ Please fill all fields (min 6 char password).' };
  const errMsg = errMap[req.query.error] || '';
  res.send(page('Register', authCard(`
    <div class="auth-logo">🏀 PH HOOPS</div>
    <h2>Create Account</h2>
    <p class="auth-sub">Start managing your league for free</p>
    ${errMsg ? `<div class="alert-error">${errMsg}</div>` : ''}
    <form action="/register" method="POST">
      <div class="field-group"><label>Full Name</label><input name="name" class="input" placeholder="Commissioner Name" required /></div>
      <div class="field-group"><label>Email</label><input name="email" type="email" class="input" placeholder="you@email.com" required /></div>
      <div class="field-group"><label>Password</label><input name="password" type="password" class="input" placeholder="Min 6 characters" required /></div>
      <button type="submit" class="btn-primary full">Create Free Account →</button>
    </form>
    <div class="auth-alt">Already have an account? <a href="/login">Login</a></div>
    <div class="plan-note">
      <b>Free Plan:</b> 1 league · 10 teams · 30 players<br>
      <b>Pro (₱199/mo):</b> Unlimited everything + PDF exports + Brackets
    </div>
  `)));
});

router.post('/register', async (req, res) => {
  try {
    const { name = '', email = '', password = '' } = req.body;
    if (!name.trim() || !email.trim() || password.length < 6) return res.redirect('/register?error=invalid');
    const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing) return res.redirect('/register?error=exists');
    const hash = bcrypt.hashSync(password, 10);
    const user = await db.queryOne(
      'INSERT INTO users (email,password,name,plan) VALUES ($1,$2,$3,$4) RETURNING *',
      [email.toLowerCase().trim(), hash, name.trim(), 'free']
    );
    req.session.token = generateToken(user);
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.redirect('/register?error=invalid');
  }
});

router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// helpers
const esc = (s = '') => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const authCard = (inner) => `<div class="auth-wrap"><div class="auth-card">${inner}</div></div>`;
const page = (title, body) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | PH Hoops</title><link rel="stylesheet" href="/css/main.css"></head><body class="dark-bg">${body}</body></html>`;

module.exports = router;
