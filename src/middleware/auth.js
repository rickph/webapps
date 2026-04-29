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

function requirePro(req, res, next) {
  if (req.user?.plan !== 'pro') {
    return res.status(403).json({ error: 'Pro plan required', upgrade: true });
  }
  next();
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, plan: user.plan },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Limits for free plan
const FREE_LIMITS = {
  leagues: 1,
  teams: 10,
  players: 30,
};

module.exports = { requireAuth, optionalAuth, requirePro, generateToken, FREE_LIMITS };
