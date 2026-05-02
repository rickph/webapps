const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const router   = express.Router();
const db       = require('../db/database');
const { generateToken } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../email');
const { esc, page } = require('../helpers');

// ── GET /login ────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  const msg = req.query.verified ? '<div class="alert-success">✅ Email verified! You can now log in.</div>' : '';
  const pw  = req.query.changed  ? '<div class="alert-success">✅ Password changed successfully. Please log in.</div>' : '';
  res.send(page('Login | PH Hoops', authCard(`
    <div class="auth-logo">🏀 PH HOOPS</div>
    <h2>Commissioner Login</h2>
    <p class="auth-sub">Manage your basketball league</p>
    ${msg}${pw}
    <form action="/login" method="POST">
      <div class="field-group"><label>Email</label>
        <input name="email" type="text" class="input" placeholder="your@email.com" autofocus required /></div>
      <div class="field-group"><label>Password</label>
        <input name="password" type="password" class="input" placeholder="••••••••" required /></div>
      <button type="submit" class="btn-primary full">Login →</button>
    </form>
    <div style="text-align:center;margin-top:12px">
      <a href="/forgot-password" style="font-size:12px;color:var(--muted)">Forgot password?</a>
    </div>
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
        <div class="auth-logo">🏀 PH HOOPS</div>
        <h2>Commissioner Login</h2>
        <div class="alert-error">❌ Invalid email or password.</div>
        <form action="/login" method="POST">
          <div class="field-group"><label>Email</label>
            <input name="email" type="text" class="input" value="${esc(email)}" autofocus required /></div>
          <div class="field-group"><label>Password</label>
            <input name="password" type="password" class="input" required /></div>
          <button type="submit" class="btn-primary full">Login →</button>
        </form>
        <div style="text-align:center;margin-top:12px">
          <a href="/forgot-password" style="font-size:12px;color:var(--muted)">Forgot password?</a>
        </div>
        <div class="auth-alt">No account? <a href="/register">Register here</a></div>
      `)));
    }

    // Block unverified users (except superadmin)
    if (!user.email_verified && user.role !== 'superadmin') {
      return res.send(page('Login | PH Hoops', authCard(`
        <div class="auth-logo">🏀 PH HOOPS</div>
        <h2>Email Not Verified</h2>
        <div class="alert-error" style="margin-bottom:16px">
          📧 Please check your email and click the verification link before logging in.
        </div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px">
          Didn't receive the email? Check your spam folder or resend it.
        </p>
        <form action="/resend-verification" method="POST">
          <input type="hidden" name="email" value="${esc(user.email)}" />
          <button type="submit" class="btn-ghost full">📧 Resend Verification Email</button>
        </form>
        <div class="auth-alt"><a href="/login">← Back to Login</a></div>
      `)));
    }

    // Issue token
    req.session.token = generateToken(user);

    // Super admin → superadmin panel
    if (user.role === 'superadmin') return res.redirect('/superadmin');

    // Force password change on first login
    if (user.must_change_password) return res.redirect('/change-password?first=1');

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
    email:   '⚠ Failed to send verification email. Try again.',
  };
  const errMsg = errMap[req.query.error] || '';
  res.send(page('Register | PH Hoops', authCard(`
    <div class="auth-logo">🏀 PH HOOPS</div>
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

    const hash  = bcrypt.hashSync(password, 10);
    const token = crypto.randomBytes(32).toString('hex');

    const user = await db.queryOne(
      `INSERT INTO users (email,password,name,plan,role,email_verified,must_change_password,verification_token)
       VALUES ($1,$2,$3,'free','commissioner',FALSE,TRUE,$4) RETURNING *`,
      [email.toLowerCase().trim(), hash, name.trim(), token]
    );

    // Send verification email
    try {
      await sendVerificationEmail(user, token);
    } catch (emailErr) {
      console.error('Email send failed:', emailErr.message);
      // Don't block registration if email fails — show success anyway
    }

    // Show success page — don't log them in yet
    res.send(page('Check Your Email | PH Hoops', authCard(`
      <div class="auth-logo">🏀 PH HOOPS</div>
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:48px;margin-bottom:16px">📧</div>
        <h2 style="margin-bottom:8px">Check Your Email</h2>
        <p style="color:var(--muted);font-size:14px;line-height:1.7;margin-bottom:20px">
          We sent a verification link to<br>
          <strong style="color:var(--text)">${esc(email)}</strong>
        </p>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px">
          Click the link in the email to activate your account. Check your spam folder if you don't see it.
        </p>
        <form action="/resend-verification" method="POST">
          <input type="hidden" name="email" value="${esc(email)}" />
          <button type="submit" class="btn-ghost full">📧 Resend Email</button>
        </form>
      </div>
      <div class="auth-alt"><a href="/login">← Back to Login</a></div>
    `)));
  } catch (err) {
    console.error('Register error:', err);
    res.redirect('/register?error=invalid');
  }
});

// ── GET /verify-email ─────────────────────────────────────────────────────────
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.redirect('/login');

    const user = await db.queryOne(
      'SELECT * FROM users WHERE verification_token=$1', [token]
    );

    if (!user) {
      return res.send(page('Verification Failed | PH Hoops', authCard(`
        <div class="auth-logo">🏀 PH HOOPS</div>
        <h2>Link Expired or Invalid</h2>
        <div class="alert-error">❌ This verification link is invalid or has already been used.</div>
        <div style="margin-top:16px">
          <a href="/register" class="btn-primary full">Register Again</a>
        </div>
        <div class="auth-alt"><a href="/login">← Back to Login</a></div>
      `)));
    }

    // Mark as verified
    await db.run(
      'UPDATE users SET email_verified=TRUE, verification_token=NULL WHERE id=$1',
      [user.id]
    );

    res.redirect('/login?verified=1');
  } catch (err) {
    console.error('Verify error:', err);
    res.redirect('/login');
  }
});

// ── POST /resend-verification ─────────────────────────────────────────────────
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await db.queryOne(
      'SELECT * FROM users WHERE email=$1 AND email_verified=FALSE', [email?.toLowerCase().trim()]
    );

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      await db.run('UPDATE users SET verification_token=$1 WHERE id=$2', [token, user.id]);
      try { await sendVerificationEmail(user, token); } catch(e) { console.error(e.message); }
    }

    // Always show success (security: don't reveal if email exists)
    res.send(page('Email Sent | PH Hoops', authCard(`
      <div class="auth-logo">🏀 PH HOOPS</div>
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:48px;margin-bottom:16px">📧</div>
        <h2 style="margin-bottom:8px">Email Sent!</h2>
        <p style="color:var(--muted);font-size:14px;line-height:1.7">
          If that email is registered and unverified, a new verification link has been sent.
        </p>
      </div>
      <div class="auth-alt" style="margin-top:20px"><a href="/login">← Back to Login</a></div>
    `)));
  } catch (err) {
    console.error(err);
    res.redirect('/login');
  }
});

// ── GET /change-password (force on first login) ───────────────────────────────
router.get('/change-password', (req, res) => {
  const first = req.query.first === '1';
  res.send(page('Change Password | PH Hoops', authCard(`
    <div class="auth-logo">🏀 PH HOOPS</div>
    <h2>${first ? '🔐 Set Your Password' : 'Change Password'}</h2>
    ${first ? `<div class="alert-info" style="margin-bottom:16px">
      👋 Welcome! For security, please set a new password before continuing.
    </div>` : ''}
    <form action="/change-password" method="POST">
      <input type="hidden" name="first" value="${first ? '1' : '0'}" />
      ${!first ? `<div class="field-group"><label>Current Password</label>
        <input name="current" type="password" class="input" placeholder="Current password" required /></div>` : ''}
      <div class="field-group"><label>New Password</label>
        <input name="password" type="password" class="input" placeholder="Min 8 characters" required /></div>
      <div class="field-group"><label>Confirm New Password</label>
        <input name="confirm" type="password" class="input" placeholder="Repeat new password" required /></div>
      <button type="submit" class="btn-primary full">${first ? 'Set Password & Continue →' : 'Change Password →'}</button>
    </form>
    ${!first ? '<div class="auth-alt"><a href="/admin">← Cancel</a></div>' : ''}
  `)));
});

// ── POST /change-password ─────────────────────────────────────────────────────
router.post('/change-password', async (req, res) => {
  try {
    const token = req.session?.token;
    if (!token) return res.redirect('/login');

    const jwt  = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'phhoops-jwt-secret-change-in-production';
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); } catch { return res.redirect('/login'); }

    const { password, confirm, current, first } = req.body;

    if (!password || password.length < 8) {
      return res.send(page('Change Password | PH Hoops', authCard(`
        <div class="auth-logo">🏀 PH HOOPS</div>
        <h2>${first === '1' ? '🔐 Set Your Password' : 'Change Password'}</h2>
        <div class="alert-error">❌ Password must be at least 8 characters.</div>
        <div style="margin-top:16px"><a href="/change-password${first==='1'?'?first=1':''}" class="btn-primary full">Try Again</a></div>
      `)));
    }

    if (password !== confirm) {
      return res.send(page('Change Password | PH Hoops', authCard(`
        <div class="auth-logo">🏀 PH HOOPS</div>
        <h2>${first === '1' ? '🔐 Set Your Password' : 'Change Password'}</h2>
        <div class="alert-error">❌ Passwords do not match.</div>
        <div style="margin-top:16px"><a href="/change-password${first==='1'?'?first=1':''}" class="btn-primary full">Try Again</a></div>
      `)));
    }

    // Verify current password if not first login
    if (first !== '1') {
      const user = await db.queryOne('SELECT * FROM users WHERE id=$1', [decoded.id]);
      if (!user || !bcrypt.compareSync(current, user.password)) {
        return res.send(page('Change Password | PH Hoops', authCard(`
          <div class="auth-logo">🏀 PH HOOPS</div>
          <h2>Change Password</h2>
          <div class="alert-error">❌ Current password is incorrect.</div>
          <div style="margin-top:16px"><a href="/change-password" class="btn-primary full">Try Again</a></div>
        `)));
      }
    }

    // Update password and clear must_change_password flag
    await db.run(
      'UPDATE users SET password=$1, must_change_password=FALSE WHERE id=$2',
      [bcrypt.hashSync(password, 10), decoded.id]
    );

    // Refresh session token
    const updatedUser = await db.queryOne('SELECT * FROM users WHERE id=$1', [decoded.id]);
    req.session.token = generateToken(updatedUser);

    if (first === '1') {
      res.redirect('/admin');
    } else {
      res.redirect('/login?changed=1');
    }
  } catch (err) {
    console.error('Change password error:', err);
    res.redirect('/change-password');
  }
});

// ── GET /forgot-password ──────────────────────────────────────────────────────
router.get('/forgot-password', (req, res) => {
  const sent = req.query.sent === '1';
  res.send(page('Forgot Password | PH Hoops', authCard(`
    <div class="auth-logo">🏀 PH HOOPS</div>
    <h2>Forgot Password</h2>
    ${sent ? `<div class="alert-success" style="margin-bottom:16px">
      📧 If that email is registered, a reset link has been sent.
    </div>` : `
    <p class="auth-sub">Enter your email and we'll send a reset link.</p>
    <form action="/forgot-password" method="POST">
      <div class="field-group"><label>Email</label>
        <input name="email" type="email" class="input" placeholder="your@email.com" required /></div>
      <button type="submit" class="btn-primary full">Send Reset Link →</button>
    </form>`}
    <div class="auth-alt"><a href="/login">← Back to Login</a></div>
  `)));
});

// ── POST /forgot-password ─────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email = '' } = req.body;
    const user = await db.queryOne('SELECT * FROM users WHERE email=$1', [email.toLowerCase().trim()]);

    if (user) {
      const token  = crypto.randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await db.run(
        'UPDATE users SET reset_token=$1, reset_token_expiry=$2 WHERE id=$3',
        [token, expiry.toISOString(), user.id]
      );
      try { await sendPasswordResetEmail(user, token); } catch(e) { console.error(e.message); }
    }

    res.redirect('/forgot-password?sent=1');
  } catch (err) {
    console.error(err);
    res.redirect('/forgot-password?sent=1');
  }
});

// ── GET /reset-password ───────────────────────────────────────────────────────
router.get('/reset-password', async (req, res) => {
  const { token } = req.query;
  const user = token ? await db.queryOne(
    'SELECT * FROM users WHERE reset_token=$1 AND reset_token_expiry > NOW()', [token]
  ) : null;

  if (!user) {
    return res.send(page('Link Expired | PH Hoops', authCard(`
      <div class="auth-logo">🏀 PH HOOPS</div>
      <h2>Link Expired</h2>
      <div class="alert-error">❌ This reset link is invalid or has expired.</div>
      <div style="margin-top:16px"><a href="/forgot-password" class="btn-primary full">Request New Link →</a></div>
    `)));
  }

  res.send(page('Reset Password | PH Hoops', authCard(`
    <div class="auth-logo">🏀 PH HOOPS</div>
    <h2>Set New Password</h2>
    <form action="/reset-password" method="POST">
      <input type="hidden" name="token" value="${esc(token)}" />
      <div class="field-group"><label>New Password</label>
        <input name="password" type="password" class="input" placeholder="Min 8 characters" required /></div>
      <div class="field-group"><label>Confirm Password</label>
        <input name="confirm" type="password" class="input" placeholder="Repeat new password" required /></div>
      <button type="submit" class="btn-primary full">Reset Password →</button>
    </form>
  `)));
});

// ── POST /reset-password ──────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirm } = req.body;
    const user = await db.queryOne(
      'SELECT * FROM users WHERE reset_token=$1 AND reset_token_expiry > NOW()', [token]
    );

    if (!user) return res.redirect('/forgot-password');
    if (!password || password.length < 8 || password !== confirm)
      return res.redirect(`/reset-password?token=${token}&error=1`);

    await db.run(
      'UPDATE users SET password=$1, reset_token=NULL, reset_token_expiry=NULL, must_change_password=FALSE WHERE id=$2',
      [bcrypt.hashSync(password, 10), user.id]
    );

    res.redirect('/login?changed=1');
  } catch (err) {
    console.error(err);
    res.redirect('/login');
  }
});

// ── GET /logout ───────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function authCard(inner) {
  return `<div class="auth-wrap"><div class="auth-card">${inner}</div></div>`;
}

module.exports = router;
