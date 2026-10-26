/**
 * REBUILT 2.0 — SessionManager
 * 
 * Responsibilities:
 * - Maintain authorized sessions
 * - Securely store session state using Authenticated AES-256-GCM
 * - Enforce session expiration (TTL)
 * - Revoke sessions on demand
 * - Isolate sessions strictly by (cloneId, targetOrigin)
 * - Prevent one clone from accessing another clone's session
 */

const crypto = require('crypto');
const sessionVault = require('../../security/session-vault');

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class SessionManager {
  constructor() {
    // In-memory cache of active sessions: key = `${cloneId}:::${normalizedOrigin}`
    this.sessions = new Map();
  }

  /**
   * Builds an isolated composite session key.
   * Prevents cross-clone session pollution.
   */
  buildSessionKey(cloneId, targetOrigin) {
    if (!cloneId || typeof cloneId !== 'string') {
      throw new Error('A valid cloneId is required for session isolation.');
    }
    if (!targetOrigin || typeof targetOrigin !== 'string') {
      throw new Error('A valid targetOrigin is required for session isolation.');
    }
    const normOrigin = new URL(targetOrigin).origin.toLowerCase();
    return `${cloneId.trim()}:::${normOrigin}`;
  }

  /**
   * Stores an authorized session securely with expiration and origin isolation.
   *
   * @param {object} params
   * @param {string} params.cloneId - Unique clone ID
   * @param {string} params.targetOrigin - Target server origin
   * @param {string} [params.accessToken] - OAuth / API access token
   * @param {string} [params.refreshToken] - OAuth refresh token
   * @param {string} [params.cookieHeader] - Serialized Cookie header
   * @param {object} [params.userProfile] - User profile metadata
   * @param {number} [params.ttlMs] - Session time-to-live in ms
   * @returns {object} Stored session summary
   */
  createSession({ cloneId, targetOrigin, accessToken = null, refreshToken = null, cookieHeader = null, userProfile = null, ttlMs = DEFAULT_SESSION_TTL_MS }) {
    const sessionKey = this.buildSessionKey(cloneId, targetOrigin);
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const sessionId = `sess_${crypto.randomBytes(8).toString('hex')}`;

    const sessionData = {
      sessionId,
      cloneId,
      targetOrigin: new URL(targetOrigin).origin,
      accessToken,
      refreshToken,
      cookieHeader,
      userProfile: userProfile || { role: 'authorized_user' },
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      expiresAtTs: expiresAt,
      status: 'active'
    };

    // 1. Store in memory
    this.sessions.set(sessionKey, sessionData);

    // 2. Persist securely into Encrypted Session Vault (AES-256-GCM)
    try {
      const vaultHost = `clone_${cloneId}_${new URL(targetOrigin).hostname}`;
      sessionVault.saveSession(vaultHost, {
        cookies: cookieHeader ? [{ name: 'authorized', value: 'true' }] : [],
        cookieHeader: cookieHeader || (accessToken ? `Bearer ${accessToken}` : ''),
        headers: accessToken ? { 'authorization': `Bearer ${accessToken}` } : {},
        authType: accessToken ? 'bearer' : 'cookie',
        createdAt: sessionData.createdAt,
        expiresAt: sessionData.expiresAt
      });
    } catch (_) {}

    return {
      sessionId: sessionData.sessionId,
      cloneId: sessionData.cloneId,
      targetOrigin: sessionData.targetOrigin,
      status: 'active',
      createdAt: sessionData.createdAt,
      expiresAt: sessionData.expiresAt
    };
  }

  /**
   * Retrieves an active session strictly matching cloneId and targetOrigin.
   * Automatically expires sessions that have exceeded their TTL.
   *
   * @param {string} cloneId
   * @param {string} targetOrigin
   * @returns {object|null} Active session data or null
   */
  getSession(cloneId, targetOrigin) {
    const sessionKey = this.buildSessionKey(cloneId, targetOrigin);
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return null;
    }

    // Check expiration
    if (Date.now() > session.expiresAtTs) {
      this.revokeSession(cloneId, targetOrigin);
      return null;
    }

    return session;
  }

  /**
   * Checks if an active authorized session exists for the given clone and target origin.
   * @param {string} cloneId
   * @param {string} targetOrigin
   * @returns {boolean}
   */
  hasActiveSession(cloneId, targetOrigin) {
    return this.getSession(cloneId, targetOrigin) !== null;
  }

  /**
   * Enforces authorized session presence.
   * Throws TARGET_REQUIRES_AUTHORIZATION error if unauthenticated or expired.
   *
   * @param {string} cloneId
   * @param {string} targetOrigin
   * @throws {Error} TARGET_REQUIRES_AUTHORIZATION
   */
  requireSession(cloneId, targetOrigin) {
    const session = this.getSession(cloneId, targetOrigin);
    if (!session) {
      const err = new Error('TARGET_REQUIRES_AUTHORIZATION: This route requires an authorized session. Please complete the authorization flow.');
      err.code = 'TARGET_REQUIRES_AUTHORIZATION';
      err.statusCode = 401;
      throw err;
    }
    return session;
  }

  /**
   * Revokes and purges a specific session.
   * @param {string} cloneId
   * @param {string} targetOrigin
   * @returns {boolean} True if revoked
   */
  revokeSession(cloneId, targetOrigin) {
    const sessionKey = this.buildSessionKey(cloneId, targetOrigin);
    const existed = this.sessions.delete(sessionKey);

    try {
      const vaultHost = `clone_${cloneId}_${new URL(targetOrigin).hostname}`;
      sessionVault.deleteSession(vaultHost);
    } catch (_) {}

    return existed;
  }

  /**
   * Revokes all sessions belonging to a specific clone.
   * @param {string} cloneId
   */
  revokeAllCloneSessions(cloneId) {
    for (const [key, session] of this.sessions.entries()) {
      if (session.cloneId === cloneId) {
        this.revokeSession(cloneId, session.targetOrigin);
      }
    }
  }

  /**
   * Returns metadata of all active sessions (without revealing tokens or secrets).
   * @returns {Array<object>}
   */
  listActiveSessions() {
    const list = [];
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (now <= session.expiresAtTs) {
        list.push({
          sessionId: session.sessionId,
          cloneId: session.cloneId,
          targetOrigin: session.targetOrigin,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          status: 'active'
        });
      }
    }
    return list;
  }
}

const sessionManager = new SessionManager();

module.exports = {
  SessionManager,
  sessionManager
};
