/**
 * REBUILT — Communication Bridge: Session & Cookie Manager
 * 
 * Manages authorized server-side session cookies and credentials:
 * 1. Isolates sessions per cloneId and target host
 * 2. Parses and updates server-side cookie jars from upstream Set-Cookie
 * 3. Injects valid session cookies and authorization tokens when dispatching upstream
 * 4. STRICT PRIVACY: Cookies and authorization tokens are NEVER logged, displayed,
 *    or returned to the client browser.
 */

const sessionVault = require('../security/session-vault');

class BridgeSessionManager {
  constructor() {
    // In-memory cookie stores: `${cloneId}:${targetHost}` -> Map<cookieName, cookieValue>
    this.sessionStores = new Map();
  }

  _getKey(cloneId, host) {
    return `${cloneId || 'global'}:${(host || '').toLowerCase()}`;
  }

  /**
   * Captures and updates cookies received in upstream Set-Cookie headers.
   * 
   * @param {string} cloneId 
   * @param {string} host 
   * @param {string|Array<string>} setCookieHeader 
   */
  captureCookies(cloneId, host, setCookieHeader) {
    if (!setCookieHeader) return;

    const key = this._getKey(cloneId, host);
    if (!this.sessionStores.has(key)) {
      this.sessionStores.set(key, new Map());
    }
    const jar = this.sessionStores.get(key);

    const headersList = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : [setCookieHeader];

    for (const header of headersList) {
      if (!header || typeof header !== 'string') continue;
      // Split cookies if concatenated by comma (avoiding comma in expires date)
      const parts = header.split(/,(?=\s*[a-zA-Z0-9_\-]+=)/);
      for (const p of parts) {
        const cookiePair = p.split(';')[0].trim();
        const eqIdx = cookiePair.indexOf('=');
        if (eqIdx > 0) {
          const name = cookiePair.slice(0, eqIdx).trim();
          const value = cookiePair.slice(eqIdx + 1).trim();
          jar.set(name, value);
        }
      }
    }

    // Also sync to persistent sessionVault for compatibility
    try {
      sessionVault.updateCookiesFromSetCookie(host, setCookieHeader);
    } catch (_) {}
  }

  /**
   * Builds the Cookie header for upstream dispatch.
   * 
   * @param {string} cloneId 
   * @param {string} host 
   * @returns {string|null} Cookie header string or null
   */
  getCookieHeader(cloneId, host) {
    const key = this._getKey(cloneId, host);
    const jar = this.sessionStores.get(key);

    const cookiePairs = [];
    if (jar && jar.size > 0) {
      for (const [name, value] of jar.entries()) {
        cookiePairs.push(`${name}=${value}`);
      }
    }

    // Check fallback in sessionVault
    if (cookiePairs.length === 0) {
      try {
        const vaultSession = sessionVault.getSession(host);
        if (vaultSession && vaultSession.cookieHeader) {
          return vaultSession.cookieHeader;
        }
      } catch (_) {}
    }

    return cookiePairs.length > 0 ? cookiePairs.join('; ') : null;
  }

  /**
   * Clears session cookies for a clone and host.
   * 
   * @param {string} cloneId 
   * @param {string} host 
   */
  clearSession(cloneId, host) {
    const key = this._getKey(cloneId, host);
    this.sessionStores.delete(key);
  }

  /**
   * Checks whether an active session exists (boolean only, without revealing secrets).
   * 
   * @param {string} cloneId 
   * @param {string} host 
   * @returns {boolean}
   */
  hasSession(cloneId, host) {
    const key = this._getKey(cloneId, host);
    const jar = this.sessionStores.get(key);
    if (jar && jar.size > 0) return true;

    try {
      const vaultSession = sessionVault.getSession(host);
      return Boolean(vaultSession && vaultSession.cookies);
    } catch (_) {
      return false;
    }
  }
}

const bridgeSessionManager = new BridgeSessionManager();

module.exports = {
  BridgeSessionManager,
  bridgeSessionManager
};
