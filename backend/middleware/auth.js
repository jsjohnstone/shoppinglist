import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const AUTH_MODES = ['full', 'admin', 'none'];

/**
 * How much of the app needs a login. Set with AUTH_MODE:
 *   full  - login for everything (default)
 *   admin - the shopping list is open to anyone who can reach the app;
 *           settings and other administration need a login
 *   none  - no login at all, everything acts as the shared "default" user
 *
 * DISABLE_AUTH=true is the older way to ask for "none" and still works when
 * AUTH_MODE is not set. An unrecognised AUTH_MODE falls back to "full".
 */
export function getAuthMode() {
  const mode = (process.env.AUTH_MODE || '').trim().toLowerCase();

  if (mode) {
    return AUTH_MODES.includes(mode) ? mode : 'full';
  }

  return process.env.DISABLE_AUTH === 'true' ? 'none' : 'full';
}

const DEFAULT_USER = { id: 1, username: 'default' };

function getBearerToken(req) {
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
}

// Returns the logged-in user for a request, or null if there is no valid token
export function getUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function requireLogin(req, res, next) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// For everyday shopping list routes. Needs a login in "full" mode only; in
// "admin" mode a request without a valid login carries on as an anonymous user.
export function authenticateToken(req, res, next) {
  const mode = getAuthMode();

  if (mode === 'none') {
    req.user = { ...DEFAULT_USER };
    return next();
  }

  if (mode === 'admin') {
    req.user = getUserFromRequest(req) || { id: null, username: 'anonymous' };
    return next();
  }

  return requireLogin(req, res, next);
}

// For administration routes (settings, API keys, devices, list and category
// management). Needs a login in both "full" and "admin" modes.
export function requireAdmin(req, res, next) {
  if (getAuthMode() === 'none') {
    req.user = { ...DEFAULT_USER };
    return next();
  }

  return requireLogin(req, res, next);
}

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}
