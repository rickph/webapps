const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'phhoops-jwt-secret-change-in-production';

function requireAuth(req, res, next) {
  const token = req.session?.token;
  if (!token) return res.redirect('/login');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    req.session.destroy();
    res.redirect('/login');
  }
}

async function requireSuperAdmin(req, res, next) {
  // Check role from DB directly — don't trust old JWT tokens
  // that may have been issued before the role column existed
  try {
    const db = require('../db/database');
    const user = await db.queryOne(
      'SELECT role FROM users WHERE id=$1', [req.user.id]
    );
    if (!user || user.role !== 'superadmin') return res.redirect('/admin');
    next();
  } catch(err) {
    console.error('requireSuperAdmin error:', err);
    res.redirect('/admin');
  }
}

function optionalAuth(req, res, next) {
  const token = req.session?.token;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  }
  next();
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, plan: user.plan || 'free', role: user.role || 'commissioner' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

module.exports = { requireAuth, requireSuperAdmin, optionalAuth, generateToken };
