const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'harbor-helm-dev-secret-change-me';
const JWT_DAYS = 14;

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      isAdmin: !!user.isAdmin || !!user.is_admin,
    },
    JWT_SECRET,
    { expiresIn: `${JWT_DAYS}d` }
  );
}

function authOptional(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

function authRequired(req, res, next) {
  authOptional(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Sign in required' });
    }
    next();
  });
}

function adminRequired(req, res, next) {
  authOptional(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Admin sign in required' });
    }
    if (!req.user.isAdmin) {
      // double-check DB in case token is stale
      const { db } = require('../db');
      const row = db
        .prepare('SELECT is_admin FROM users WHERE id = ?')
        .get(req.user.sub);
      if (!row || !row.is_admin) {
        return res.status(403).json({ error: 'Admin access only' });
      }
      req.user.isAdmin = true;
    }
    next();
  });
}

module.exports = {
  signToken,
  authOptional,
  authRequired,
  adminRequired,
  JWT_SECRET,
};
