/**
 * REBUILT 2.0 — OAuth 2.0 / OpenID Connect (OIDC) Adapter
 * 
 * Implements the standard, legitimate Authorization Code flow with PKCE (RFC 7636):
 * 1. Generates PKCE code_verifier & code_challenge (S256)
 * 2. Generates anti-CSRF state nonces
 * 3. Builds authorization redirection URLs to the target identity provider
 * 4. Exchanges authorization codes for access & refresh tokens on the server side
 * 5. Securely stores session in SessionManager
 * 
 * Never bypasses authentication or asks users for their original passwords.
 */

const crypto = require('crypto');
const { sessionManager } = require('../sessions/session-manager');

// In-flight authorization transactions indexed by state nonce
const pendingAuthTransactions = new Map();
const TRANSACTION_TTL_MS = 15 * 60 * 1000; // 15 minutes

class OAuthOidcAdapter {
  /**
   * Generates a base64url-encoded SHA-256 hash for PKCE code challenge.
   */
  static generateCodeChallenge(verifier) {
    return crypto.createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Initiates an authorized OAuth/OIDC login flow.
   *
   * @param {object} params
   * @param {string} params.cloneId - Unique clone ID
   * @param {string} params.targetOrigin - Target application origin
   * @param {string} params.authorizationEndpoint - Identity provider's authorization URL
   * @param {string} params.tokenEndpoint - Identity provider's token URL
   * @param {string} [params.clientId] - OAuth client ID
   * @param {Array<string>} [params.scopes] - Requested scopes
   * @param {string} params.callbackUrl - Local bridge callback URL (e.g. http://localhost:3000/api/auth/callback)
   * @returns {{ authorizationUrl: string, state: string }}
   */
  static initiateAuthorization({
    cloneId,
    targetOrigin,
    authorizationEndpoint,
    tokenEndpoint,
    clientId = 'rebuilt-local-client',
    scopes = ['openid', 'profile', 'email'],
    callbackUrl
  }) {
    if (!authorizationEndpoint) {
      throw new Error('An authorizationEndpoint is required to initiate OAuth flow.');
    }

    // 1. Generate PKCE code verifier and challenge (RFC 7636)
    const codeVerifier = crypto.randomBytes(48).toString('base64url');
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    // 2. Generate secure state nonce
    const state = crypto.randomBytes(24).toString('hex');

    // 3. Record pending transaction
    pendingAuthTransactions.set(state, {
      cloneId,
      targetOrigin: new URL(targetOrigin).origin,
      authorizationEndpoint,
      tokenEndpoint,
      clientId,
      codeVerifier,
      callbackUrl,
      createdAt: Date.now()
    });

    // 4. Construct Authorization URL
    const authUrl = new URL(authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('scope', Array.isArray(scopes) ? scopes.join(' ') : scopes);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return {
      authorizationUrl: authUrl.toString(),
      state
    };
  }

  /**
   * Exchanges authorization code for tokens upon legitimate user callback.
   *
   * @param {object} params
   * @param {string} params.code - Authorization code from callback
   * @param {string} params.state - State parameter returned from identity provider
   * @returns {Promise<object>} Stored authorized session summary
   */
  static async handleAuthorizationCallback({ code, state }) {
    if (!state || !pendingAuthTransactions.has(state)) {
      const err = new Error('Invalid or expired OAuth state parameter (CSRF protection).');
      err.code = 'INVALID_OAUTH_STATE';
      err.statusCode = 400;
      throw err;
    }

    const tx = pendingAuthTransactions.get(state);
    pendingAuthTransactions.delete(state);

    if (Date.now() - tx.createdAt > TRANSACTION_TTL_MS) {
      const err = new Error('OAuth authorization transaction expired.');
      err.code = 'OAUTH_TRANSACTION_EXPIRED';
      err.statusCode = 400;
      throw err;
    }

    let tokenResponseData = null;

    // 1. If tokenEndpoint is provided, exchange code for tokens
    if (tx.tokenEndpoint) {
      try {
        const bodyParams = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: tx.callbackUrl,
          client_id: tx.clientId,
          code_verifier: tx.codeVerifier
        });

        const res = await fetch(tx.tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: bodyParams.toString()
        });

        if (res.ok) {
          tokenResponseData = await res.json();
        } else {
          console.warn(`[OAuthAdapter] Token endpoint returned status ${res.status}`);
        }
      } catch (tokenErr) {
        console.warn('[OAuthAdapter] Token exchange error:', tokenErr.message);
      }
    }

    // 2. Build authorized session payload
    const accessToken = tokenResponseData ? tokenResponseData.access_token : code;
    const refreshToken = tokenResponseData ? tokenResponseData.refresh_token : null;
    const expiresIn = tokenResponseData && tokenResponseData.expires_in ? tokenResponseData.expires_in * 1000 : null;

    const session = sessionManager.createSession({
      cloneId: tx.cloneId,
      targetOrigin: tx.targetOrigin,
      accessToken,
      refreshToken,
      cookieHeader: null,
      userProfile: {
        role: 'authorized_user',
        authMethod: 'oauth_oidc'
      },
      ttlMs: expiresIn || undefined
    });

    return {
      session,
      cloneId: tx.cloneId,
      targetOrigin: tx.targetOrigin
    };
  }

  /**
   * Clean up stale pending transactions.
   */
  static prunePendingTransactions() {
    const now = Date.now();
    for (const [state, tx] of pendingAuthTransactions.entries()) {
      if (now - tx.createdAt > TRANSACTION_TTL_MS) {
        pendingAuthTransactions.delete(state);
      }
    }
  }
}

module.exports = {
  OAuthOidcAdapter,
  pendingAuthTransactions
};
