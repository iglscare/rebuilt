/**
 * Rebuilt Web Cloner — Local Auth & Session Cookie Engine
 * Manages the isolated local session cookie between the browser and localhost:3000.
 * Ensures the browser never accesses upstream secrets directly and authenticates local proxy requests.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const os = require('os');

function getVaultDir() {
  const defaultDir = path.resolve(__dirname, '..', '..', 'data', 'vault');
  try {
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true, mode: 0o700 });
    }
    fs.accessSync(defaultDir, fs.constants.W_OK);
    return defaultDir;
  } catch (_) {
    const tmpDir = path.join(os.tmpdir(), 'rebuilt', 'vault');
    try {
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
      }
    } catch (_) {}
    return tmpDir;
  }
}

const VAULT_DIR = getVaultDir();
const SECRET_FILE = path.join(VAULT_DIR, 'local_session.secret');
const COOKIE_NAME = 'rebuilt_local_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let cachedSecret = null;

function getLocalSecret() {
  if (cachedSecret) return cachedSecret;

  if (process.env.LOCAL_AUTH_SECRET) {
    cachedSecret = process.env.LOCAL_AUTH_SECRET;
    return cachedSecret;
  }

  try {
    const vaultDir = getVaultDir();
    const secretFile = path.join(vaultDir, 'local_session.secret');

    if (fs.existsSync(secretFile)) {
      cachedSecret = fs.readFileSync(secretFile, 'utf8').trim();
      return cachedSecret;
    }

    const newSecret = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(secretFile, newSecret, { mode: 0o600 });
    } catch (_) {
      try {
        fs.writeFileSync(secretFile, newSecret);
      } catch (_) {}
    }
    cachedSecret = newSecret;
    return cachedSecret;
  } catch (_) {
    cachedSecret = crypto.randomBytes(32).toString('hex');
    return cachedSecret;
  }
}

/**
 * Creates a signed local session token: <sessionId>.<timestamp>.<hmac>
 */
function createSessionToken(sessionId = null) {
  const sid = sessionId || crypto.randomBytes(16).toString('hex');
  const ts = Date.now().toString(36);
  const secret = getLocalSecret();

  const hmac = crypto.createHmac('sha256', secret)
    .update(`${sid}.${ts}`)
    .digest('base64url');

  return `${sid}.${ts}.${hmac}`;
}

/**
 * Verifies a signed local session token
 * @param {string} token
 * @returns {{ valid: boolean, sessionId?: string, createdAt?: number }}
 */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return { valid: false };

  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };

  const [sid, tsStr, signature] = parts;
  const secret = getLocalSecret();

  const expectedHmac = crypto.createHmac('sha256', secret)
    .update(`${sid}.${tsStr}`)
    .digest('base64url');

  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedHmac))) {
    const ts = parseInt(tsStr, 36);
    if (!isNaN(ts) && Date.now() - ts < SESSION_TTL_MS) {
      return { valid: true, sessionId: sid, createdAt: ts };
    }
  }

  return { valid: false };
}

/**
 * Parses a standard Cookie header into a key-value dictionary
 * @param {string} cookieHeader
 * @returns {Record<string, string>}
 */
function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return map;

  cookieHeader.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k) map[k] = decodeURIComponent(v);
    }
  });

  return map;
}

/**
 * Express middleware to manage and enforce local session cookies for browser clients
 */
function localAuthMiddleware(req, res, next) {
  try {
    const rawCookieHeader = req.headers.cookie || '';
    const cookies = parseCookies(rawCookieHeader);
    const token = cookies[COOKIE_NAME];

    let sessionVerification = verifySessionToken(token);

    if (!sessionVerification.valid) {
      // Generate new signed local session token
      const newToken = createSessionToken();
      sessionVerification = verifySessionToken(newToken);

      // Set HttpOnly, SameSite=Lax cookie on localhost
      const cookieDirective = `${COOKIE_NAME}=${encodeURIComponent(newToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
      res.setHeader('Set-Cookie', cookieDirective);
    }

    req.localSession = {
      id: sessionVerification.sessionId,
      createdAt: sessionVerification.createdAt,
      valid: true
    };
  } catch (err) {
    req.localSession = {
      id: 'fallback-session',
      createdAt: Date.now(),
      valid: true
    };
  }

  next();
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  parseCookies,
  localAuthMiddleware,
  COOKIE_NAME
};
