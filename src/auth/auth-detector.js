/**
 * REBUILT 2.0 — Observable Authentication Flow Detector
 * 
 * Non-intrusively detects observable authentication architectures used by target applications:
 * - OAuth 2.0 / OpenID Connect (OIDC)
 * - SAML 2.0 / Enterprise SSO (Okta, Azure AD, Auth0, Ping, Keycloak)
 * - Session Cookie / Bearer Token based authentication
 * 
 * Does NOT scrape credentials, passwords, or bypass access controls.
 * Detects endpoints so the user can authenticate legitimately through their provider.
 */

const KNOWN_OAUTH_PATTERNS = [
  { provider: 'google', regex: /accounts\.google\.com\/o\/oauth2/i },
  { provider: 'github', regex: /github\.com\/login\/oauth/i },
  { provider: 'microsoft', regex: /login\.(microsoftonline|live)\.com/i },
  { provider: 'auth0', regex: /auth0\.com\/(authorize|oauth)/i },
  { provider: 'okta', regex: /okta\.com\/oauth2/i },
  { provider: 'keycloak', regex: /\/auth\/realms\/[^/]+\/protocol\/openid-connect/i },
  { provider: 'cognito', regex: /amazoncognito\.com\/oauth2/i }
];

class AuthDetector {
  /**
   * Analyzes observed network traffic, DOM, and manifest routes to detect authentication architecture.
   *
   * @param {object} params
   * @param {string} [params.html] - Rendered HTML
   * @param {Array<object>} [params.observedRequests] - Requests recorded by NetworkDiscoveryEngine
   * @param {object} [params.manifest] - Clone manifest
   * @param {string} params.targetOrigin - Base URL of target app
   * @returns {object} Detection report
   */
  static detect({ html = '', observedRequests = [], manifest = null, targetOrigin }) {
    const report = {
      detected: false,
      authType: 'NONE',
      providerName: 'unknown',
      authorizationEndpoint: null,
      tokenEndpoint: null,
      clientId: null,
      scopes: ['openid', 'profile', 'email'],
      requiresAuthorization: false,
      details: {},
      discoveredAt: new Date().toISOString()
    };

    // 1. Inspect observed network requests for OAuth/OIDC authorize endpoints
    for (const req of observedRequests) {
      const urlStr = req.origin ? `${req.origin}${req.path}` : (req.path || '');
      const query = req.query || {};

      // Check for OAuth authorization parameters: response_type=code or client_id
      if (query.client_id || query.response_type === 'code' || urlStr.includes('/oauth') || urlStr.includes('/openid')) {
        report.detected = true;
        report.authType = 'OAUTH_OIDC';
        report.authorizationEndpoint = urlStr.split('?')[0];
        if (query.client_id) report.clientId = query.client_id;
        if (query.scope) report.scopes = String(query.scope).split(' ');

        // Identify known provider
        for (const kp of KNOWN_OAUTH_PATTERNS) {
          if (kp.regex.test(urlStr)) {
            report.providerName = kp.provider;
            break;
          }
        }
        if (report.providerName === 'unknown') {
          report.providerName = 'generic_oauth';
        }
        report.requiresAuthorization = true;
        break;
      }

      // Check for SAML SSO endpoints
      if (urlStr.includes('/saml') || urlStr.includes('SAMLRequest') || urlStr.includes('/adfs/ls/')) {
        report.detected = true;
        report.authType = 'SAML';
        report.providerName = 'saml_sso';
        report.authorizationEndpoint = urlStr.split('?')[0];
        report.requiresAuthorization = true;
        break;
      }

      // Check if request required authentication
      if (req.requiresAuthentication || req.status === 401 || req.status === 403) {
        report.requiresAuthorization = true;
      }
    }

    // 2. Inspect HTML links and scripts for observable OAuth login links if not yet detected
    if (!report.detected && html) {
      // Look for href links matching authorize patterns
      const oauthLinkMatches = [...html.matchAll(/href=["'](https?:\/\/[^"']*(?:oauth\/authorize|oauth2\/v\d+\/authorize|accounts\.google\.com|github\.com\/login\/oauth|login\.microsoftonline\.com|auth0\.com)[^"']*)["']/gi)];
      if (oauthLinkMatches.length > 0) {
        const authUrlStr = oauthLinkMatches[0][1];
        try {
          const parsedAuthUrl = new URL(authUrlStr);
          report.detected = true;
          report.authType = 'OAUTH_OIDC';
          report.authorizationEndpoint = `${parsedAuthUrl.protocol}//${parsedAuthUrl.host}${parsedAuthUrl.pathname}`;
          report.clientId = parsedAuthUrl.searchParams.get('client_id');
          if (parsedAuthUrl.searchParams.get('scope')) {
            report.scopes = parsedAuthUrl.searchParams.get('scope').split(' ');
          }

          for (const kp of KNOWN_OAUTH_PATTERNS) {
            if (kp.regex.test(authUrlStr)) {
              report.providerName = kp.provider;
              break;
            }
          }
          if (report.providerName === 'unknown') report.providerName = 'generic_oauth';
          report.requiresAuthorization = true;
        } catch (_) {}
      }

      // Look for standard login forms
      if (!report.detected) {
        const hasLoginForm = /<form[^>]+(?:action=["'][^"']*(?:login|signin|auth)[^"']*["']|id=["'][^"']*login[^"']*["'])/i.test(html) ||
                             /<input[^>]+type=["']password["']/i.test(html);
        if (hasLoginForm) {
          report.detected = true;
          report.authType = 'SESSION_COOKIE';
          report.providerName = 'standard_session';
          report.requiresAuthorization = true;
        }
      }
    }

    // 3. Inspect manifest routes for authenticated endpoints
    if (manifest && Array.from(manifest.routes || []).some(r => r.requiresAuth)) {
      report.requiresAuthorization = true;
      if (!report.detected) {
        report.detected = true;
        report.authType = 'SESSION_COOKIE';
        report.providerName = 'authenticated_api';
      }
    }

    return report;
  }
}

module.exports = {
  AuthDetector,
  KNOWN_OAUTH_PATTERNS
};
