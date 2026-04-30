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

function optionalAuth(req, res, next) {
  const token = req.session?.token;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  }
  next();
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

module.exports = { requireAuth, optionalAuth, generateToken };
