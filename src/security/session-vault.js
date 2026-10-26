/**
 * Rebuilt Web Cloner — Encrypted Session Vault
 * Securely stores and manages authorized target website sessions (cookies, bearer tokens, auth headers)
 * using authenticated AES-256-GCM encryption on the local machine.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const supabaseClient = require('../storage/supabase-client');

const VAULT_DIR = path.resolve(__dirname, '..', '..', 'data', 'vault');
const VAULT_FILE = path.join(VAULT_DIR, 'sessions.enc');
const KEY_FILE = path.join(VAULT_DIR, 'vault.key');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for AES-GCM
const TAG_LENGTH = 16;

let cachedKey = null;
let inMemoryVaultCache = null;

/**
 * Ensures the data/vault directory exists with secure permissions
 */
function ensureVaultDir() {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Retrieves or generates the 256-bit AES master encryption key
 * @returns {Buffer} 32-byte encryption key
 */
function getMasterKey() {
  if (cachedKey) return cachedKey;

  // 1. Check environment variable override
  if (process.env.SESSION_VAULT_KEY) {
    cachedKey = crypto.createHash('sha256').update(process.env.SESSION_VAULT_KEY).digest();
    return cachedKey;
  }

  // 2. Read or initialize local key file
  ensureVaultDir();
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE);
    if (raw.length === 32) {
      cachedKey = raw;
      return cachedKey;
    }
    // If hex formatted (64 chars)
    if (raw.length === 64) {
      cachedKey = Buffer.from(raw.toString('utf8'), 'hex');
      return cachedKey;
    }
  }

  // Generate new random 256-bit key
  const newKey = crypto.randomBytes(32);
  try {
    fs.writeFileSync(KEY_FILE, newKey, { mode: 0o600 });
  } catch (_) {
    // Fallback if filesystem permissions restrict explicit mode
    fs.writeFileSync(KEY_FILE, newKey);
  }
  cachedKey = newKey;
  return cachedKey;
}

/**
 * Encrypts a plaintext string or object using AES-256-GCM
 * @param {string|object} plaintext
 * @returns {string} Serialized ciphertext JSON
 */
function encrypt(plaintext) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const text = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted
  });
}

/**
 * Decrypts an encrypted payload JSON using AES-256-GCM
 * @param {string} payloadJson
 * @returns {any} Decrypted string or parsed object
 */
function decrypt(payloadJson) {
  const key = getMasterKey();
  const parsed = JSON.parse(payloadJson);
  const iv = Buffer.from(parsed.iv, 'base64');
  const tag = Buffer.from(parsed.tag, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(parsed.data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  try {
    return JSON.parse(decrypted);
  } catch (_) {
    return decrypted;
  }
}

/**
 * Normalizes a domain or URL string into a canonical hostname
 * @param {string} input - Hostname or URL (e.g. "https://api.github.com/v1" or "example.com:443")
 * @returns {string} Lowercase canonical domain (e.g. "api.github.com")
 */
function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return '';
  let cleaned = input.trim().toLowerCase();
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      cleaned = new URL(cleaned).hostname;
    } catch (_) {}
  }
  // Strip port
  cleaned = cleaned.split(':')[0];
  // Strip trailing slashes
  cleaned = cleaned.replace(/^\/+|\/+$/g, '');
  return cleaned;
}

/**
 * Loads and decrypts the entire vault store from disk
 * @returns {object} Vault store dictionary { [domain]: sessionRecord }
 */
function loadVault() {
  if (inMemoryVaultCache) return inMemoryVaultCache;
  ensureVaultDir();

  if (!fs.existsSync(VAULT_FILE)) {
    inMemoryVaultCache = { sessions: {} };
    return inMemoryVaultCache;
  }

  try {
    const raw = fs.readFileSync(VAULT_FILE, 'utf8');
    if (!raw.trim()) {
      inMemoryVaultCache = { sessions: {} };
      return inMemoryVaultCache;
    }
    const decrypted = decrypt(raw);
    inMemoryVaultCache = typeof decrypted === 'object' && decrypted !== null ? decrypted : { sessions: {} };
    if (!inMemoryVaultCache.sessions) inMemoryVaultCache.sessions = {};
    return inMemoryVaultCache;
  } catch (err) {
    console.error('[SessionVault] Error decrypting session vault:', err.message);
    inMemoryVaultCache = { sessions: {} };
    return inMemoryVaultCache;
  }
}

/**
 * Encrypts and writes the vault store to disk atomically
 * @param {object} store
 */
function saveVault(store) {
  ensureVaultDir();
  inMemoryVaultCache = store;

  const serialized = encrypt(store);
  const tmpFile = `${VAULT_FILE}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(tmpFile, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpFile, VAULT_FILE);
  } catch (err) {
    if (fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
    // Fallback direct write
    fs.writeFileSync(VAULT_FILE, serialized, 'utf8');
  }
}

/**
 * Stores or updates an authorized session for a target domain
 *
 * @param {object} params
 * @param {string} params.domain - Authorized target domain (e.g. "example.com")
 * @param {string} [params.cookies] - Cookie string (e.g. "session_id=abc; token=123")
 * @param {object} [params.headers] - Custom authorization headers (e.g. { "Authorization": "Bearer xyz" })
 * @param {string} [params.notes] - Optional developer notes
 * @param {boolean} [params.enabled=true] - Whether session injection is active
 * @returns {object} Stored session record (redacted)
 */
function setSession({ domain, cookies = '', headers = {}, notes = '', enabled = true }) {
  const normDomain = normalizeDomain(domain);
  if (!normDomain) {
    throw new Error('A valid target domain is required to store a session.');
  }

  const store = loadVault();
  const existing = store.sessions[normDomain] || {};

  const cleanCookies = typeof cookies === 'string' ? cookies.trim() : '';
  const cleanHeaders = typeof headers === 'object' && headers !== null ? headers : {};

  store.sessions[normDomain] = {
    domain: normDomain,
    cookies: cleanCookies || existing.cookies || '',
    headers: Object.assign({}, existing.headers || {}, cleanHeaders),
    notes: notes || existing.notes || '',
    enabled: enabled !== false,
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString()
  };

  saveVault(store);

  // Sync encrypted payload to Supabase Admin table if configured
  if (supabaseClient.isSupabaseConfigured()) {
    const encData = encrypt(store.sessions[normDomain]);
    supabaseClient.saveSessionToSupabase({
      domain: normDomain,
      encryptedCredentials: encData,
      cookieKeys: extractCookieKeys(cleanCookies || existing.cookies),
      headerKeys: Object.keys(Object.assign({}, existing.headers || {}, cleanHeaders)),
      notes: notes || existing.notes || '',
      enabled: enabled !== false
    }).catch(err => {
      console.warn('[SessionVault] Failed to sync session to Supabase:', err.message);
    });
  }

  console.log(`[SessionVault] Securely stored session credentials for domain: "${normDomain}" (AES-256-GCM)`);
  return getRedactedSession(normDomain);
}

/**
 * Retrieves the full authorized session credentials for an upstream request
 * Performs exact match followed by parent domain fallback (e.g. sub.example.com -> example.com)
 *
 * @param {string} domainOrUrl
 * @returns {object|null} Decrypted session credentials { domain, cookies, headers } or null
 */
function getSession(domainOrUrl) {
  const normDomain = normalizeDomain(domainOrUrl);
  if (!normDomain) return null;

  const store = loadVault();
  if (!store.sessions) return null;

  // 1. Exact match
  if (store.sessions[normDomain] && store.sessions[normDomain].enabled) {
    return store.sessions[normDomain];
  }

  // 2. Parent domain match (e.g. api.example.com matches example.com session)
  const parts = normDomain.split('.');
  while (parts.length > 2) {
    parts.shift();
    const parent = parts.join('.');
    if (store.sessions[parent] && store.sessions[parent].enabled) {
      return store.sessions[parent];
    }
  }

  return null;
}

/**
 * Removes an authorized session from the vault
 * @param {string} domainOrUrl
 * @returns {boolean} True if deleted, false if not found
 */
function deleteSession(domainOrUrl) {
  const normDomain = normalizeDomain(domainOrUrl);
  if (!normDomain) return false;

  const store = loadVault();
  if (store.sessions && store.sessions[normDomain]) {
    delete store.sessions[normDomain];
    saveVault(store);
    if (supabaseClient.isSupabaseConfigured()) {
      supabaseClient.deleteSessionFromSupabase(normDomain).catch(() => {});
    }
    console.log(`[SessionVault] Removed session credentials for domain: "${normDomain}"`);
    return true;
  }
  return false;
}

/**
 * Helper to extract cookie key names without values for safe UI inspection
 * @param {string} cookieStr
 * @returns {string[]}
 */
function extractCookieKeys(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') return [];
  return cookieStr
    .split(';')
    .map(p => p.trim().split('=')[0].trim())
    .filter(Boolean);
}

/**
 * Returns a redacted representation of a single domain session for safe display
 */
function getRedactedSession(domain) {
  const store = loadVault();
  const session = store.sessions && store.sessions[domain];
  if (!session) return null;

  return {
    domain: session.domain,
    hasCookies: !!(session.cookies && session.cookies.length > 0),
    cookieKeys: extractCookieKeys(session.cookies),
    headerKeys: Object.keys(session.headers || {}),
    notes: session.notes || '',
    enabled: session.enabled,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt
  };
}

/**
 * Lists all stored sessions in redacted format (never leaks secret cookie/token values)
 * @returns {Array<object>}
 */
function listAuthorizedSessions() {
  const store = loadVault();
  if (!store.sessions) return [];
  return Object.keys(store.sessions).map(getRedactedSession).filter(Boolean);
}

/**
 * Merges newly received Set-Cookie headers from the upstream target website into the stored session
 * Keeps session state live and synchronized transparently.
 *
 * @param {string} domainOrUrl
 * @param {string|string[]} setCookieHeaders
 */
function updateCookiesFromSetCookie(domainOrUrl, setCookieHeaders) {
  if (!setCookieHeaders) return;
  const normDomain = normalizeDomain(domainOrUrl);
  if (!normDomain) return;

  const session = getSession(normDomain);
  if (!session) return;

  const headersList = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const cookieMap = new Map();

  // Parse existing cookies
  if (session.cookies) {
    session.cookies.split(';').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx !== -1) {
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        if (key) cookieMap.set(key, val);
      }
    });
  }

  // Merge Set-Cookie directives (take only key=value up to the first semicolon)
  let updated = false;
  headersList.forEach(rawHeader => {
    if (typeof rawHeader !== 'string') return;
    const cookiePart = rawHeader.split(';')[0].trim();
    const idx = cookiePart.indexOf('=');
    if (idx !== -1) {
      const key = cookiePart.slice(0, idx).trim();
      const val = cookiePart.slice(idx + 1).trim();
      if (key && (!val.toLowerCase().includes('deleted') && val !== '""')) {
        cookieMap.set(key, val);
        updated = true;
      }
    }
  });

  if (updated) {
    const newCookieStr = Array.from(cookieMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    setSession({
      domain: normDomain,
      cookies: newCookieStr,
      headers: session.headers,
      notes: session.notes,
      enabled: session.enabled
    });
    console.log(`[SessionVault] Updated ${headersList.length} dynamic cookie(s) for "${normDomain}"`);
  }
}

module.exports = {
  setSession,
  getSession,
  deleteSession,
  listAuthorizedSessions,
  getRedactedSession,
  updateCookiesFromSetCookie,
  normalizeDomain,
  encrypt,
  decrypt,
  VAULT_DIR,
  VAULT_FILE
};
