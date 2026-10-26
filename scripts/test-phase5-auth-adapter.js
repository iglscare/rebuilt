/**
 * REBUILT 2.0 — Phase 5 Verification Test Suite
 * Validates Authentication Adapter Architecture:
 * - AuthDetector for observable OAuth/OIDC, SAML, and session patterns
 * - SessionManager with strict clone & origin isolation and TTL expiration
 * - OAuthOidcAdapter with PKCE (RFC 7636) and anti-CSRF state verification
 * - End-to-end authorized flow rejecting unauthorized calls with TARGET_REQUIRES_AUTHORIZATION
 *   and succeeding once authenticated legitimately
 */

const assert = require('assert');
const http = require('http');
const { AuthDetector } = require('../src/auth/auth-detector');
const { SessionManager, sessionManager } = require('../src/auth/sessions/session-manager');
const { OAuthOidcAdapter } = require('../src/auth/providers/oauth-oidc-adapter');
const { applicationBridge } = require('../src/bridge/application-bridge');

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, fn) {
  process.stdout.write(`  Testing: ${name} ... `);
  try {
    await fn();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.log('✗ FAILED');
    console.error(`    Error: ${err.message}`);
    testsFailed++;
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('   ⚡ REBUILT 2.0 — Phase 5 Authentication Tests       ');
  console.log('======================================================\n');

  // Test 1: AuthDetector recognizes OAuth/OIDC from observed network activity
  await runTest('AuthDetector recognizes observable OAuth 2.0 / OIDC architecture', () => {
    const observedRequests = [
      {
        origin: 'https://auth.company.com',
        path: '/oauth2/v1/authorize',
        query: {
          client_id: 'rebuilt-client-123',
          response_type: 'code',
          scope: 'openid profile email'
        },
        requiresAuthentication: false
      }
    ];

    const report = AuthDetector.detect({
      observedRequests,
      targetOrigin: 'https://app.company.com'
    });

    assert.strictEqual(report.detected, true);
    assert.strictEqual(report.authType, 'OAUTH_OIDC');
    assert.strictEqual(report.clientId, 'rebuilt-client-123');
    assert.strictEqual(report.authorizationEndpoint, 'https://auth.company.com/oauth2/v1/authorize');
    assert.strictEqual(report.requiresAuthorization, true);
  });

  // Test 2: AuthDetector recognizes SAML and standard session patterns
  await runTest('AuthDetector identifies SAML and standard login forms', () => {
    const samlReqs = [
      { origin: 'https://idp.enterprise.com', path: '/saml2/sso', query: {}, requiresAuthentication: false }
    ];
    const samlReport = AuthDetector.detect({ observedRequests: samlReqs, targetOrigin: 'https://enterprise.com' });
    assert.strictEqual(samlReport.detected, true);
    assert.strictEqual(samlReport.authType, 'SAML');

    const formHtml = '<html><body><form action="/auth/login"><input type="password" name="pw"></form></body></html>';
    const formReport = AuthDetector.detect({ html: formHtml, targetOrigin: 'https://example.com' });
    assert.strictEqual(formReport.detected, true);
    assert.strictEqual(formReport.authType, 'SESSION_COOKIE');
  });

  // Test 3: SessionManager Enforces Strict Origin & Clone Isolation
  await runTest('SessionManager isolates sessions strictly by cloneId and targetOrigin', () => {
    const sm = new SessionManager();

    // Clone A on site A
    sm.createSession({
      cloneId: 'clone_A',
      targetOrigin: 'https://site-a.com',
      accessToken: 'token-A-secret'
    });

    // Clone B on site B
    sm.createSession({
      cloneId: 'clone_B',
      targetOrigin: 'https://site-b.com',
      accessToken: 'token-B-secret'
    });

    // Clone A can access only its own session
    const sessA = sm.getSession('clone_A', 'https://site-a.com');
    assert.ok(sessA);
    assert.strictEqual(sessA.accessToken, 'token-A-secret');

    // Clone B cannot access Clone A's session
    assert.strictEqual(sm.getSession('clone_B', 'https://site-a.com'), null, 'Clone B must NOT access Clone A session');

    // Clone A cannot access Clone B's session
    assert.strictEqual(sm.getSession('clone_A', 'https://site-b.com'), null, 'Clone A must NOT access Clone B session');
  });

  // Test 4: SessionManager Expiration & Revocation
  await runTest('SessionManager expires sessions after TTL and revokes on demand', async () => {
    const sm = new SessionManager();

    // Create session with 20ms TTL
    sm.createSession({
      cloneId: 'clone_temp',
      targetOrigin: 'https://temp.com',
      accessToken: 'ephemeral-token',
      ttlMs: 20
    });

    assert.strictEqual(sm.hasActiveSession('clone_temp', 'https://temp.com'), true);

    // Wait 30ms for expiration
    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(sm.hasActiveSession('clone_temp', 'https://temp.com'), false, 'Expired session must return null');

    // Revocation test
    sm.createSession({
      cloneId: 'clone_revoke',
      targetOrigin: 'https://revoke.com',
      accessToken: 'active-token'
    });
    assert.strictEqual(sm.hasActiveSession('clone_revoke', 'https://revoke.com'), true);
    sm.revokeSession('clone_revoke', 'https://revoke.com');
    assert.strictEqual(sm.hasActiveSession('clone_revoke', 'https://revoke.com'), false);
  });

  // Test 5: OAuthOidcAdapter PKCE (RFC 7636) and Anti-CSRF State
  await runTest('OAuthOidcAdapter creates PKCE code challenge and verifies state', () => {
    const init = OAuthOidcAdapter.initiateAuthorization({
      cloneId: 'clone_oauth_test',
      targetOrigin: 'https://app.test.com',
      authorizationEndpoint: 'https://auth.test.com/oauth/authorize',
      tokenEndpoint: 'https://auth.test.com/oauth/token',
      clientId: 'my-client-app',
      callbackUrl: 'http://localhost:3000/api/auth/callback'
    });

    assert.ok(init.authorizationUrl);
    assert.ok(init.state);

    const authUrl = new URL(init.authorizationUrl);
    assert.strictEqual(authUrl.searchParams.get('response_type'), 'code');
    assert.strictEqual(authUrl.searchParams.get('client_id'), 'my-client-app');
    assert.strictEqual(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(authUrl.searchParams.get('code_challenge'), 'PKCE code challenge must be present');
    assert.strictEqual(authUrl.searchParams.get('state'), init.state);
  });

  // Test 6: Rejection of Invalid / Tampered State
  await runTest('OAuthOidcAdapter rejects tampered or unknown state parameter', async () => {
    let stateTamperedThrew = false;
    try {
      await OAuthOidcAdapter.handleAuthorizationCallback({
        code: 'valid-auth-code',
        state: 'fake-tampered-state-token'
      });
    } catch (err) {
      stateTamperedThrew = true;
      assert.strictEqual(err.code, 'INVALID_OAUTH_STATE');
      assert.strictEqual(err.statusCode, 400);
    }
    assert.strictEqual(stateTamperedThrew, true, 'Tampered state must be rejected');
  });

  // Test 7: End-to-End Authorized API Bridging Flow
  await runTest('Enforces TARGET_REQUIRES_AUTHORIZATION when unauthenticated and succeeds when authorized', async () => {
    process.env.ALLOW_LOCAL_TESTING = 'true';

    // 1. Mock Target Server with OAuth token endpoint and protected resource
    const targetServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // OAuth token exchange endpoint
      if (req.method === 'POST' && url.pathname === '/oauth/token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          access_token: 'valid_authorized_bearer_token_999',
          token_type: 'Bearer',
          expires_in: 3600
        }));
      }

      // Public API
      if (req.method === 'GET' && url.pathname === '/api/public') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ public: true, message: 'Free access' }));
      }

      // Protected API: requires Authorization header
      if (req.method === 'GET' && url.pathname === '/api/protected') {
        const authHeader = req.headers['authorization'] || '';
        if (authHeader === 'Bearer valid_authorized_bearer_token_999') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ authorized: true, user: 'Dr. Turing', role: 'admin' }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid bearer token' }));
        }
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    const targetPort = 3999;
    await new Promise(r => targetServer.listen(targetPort, r));

    const cloneId = `clone_auth_e2e_${Date.now()}`;
    const targetOrigin = `http://localhost:${targetPort}`;

    const manifest = {
      version: '2.0.0',
      targetOrigin,
      frontend: { mode: 'local' },
      communication: { mode: 'bridge' },
      routes: [
        { method: 'GET', path: '/api/public', mode: 'proxy', requiresAuth: false },
        { method: 'GET', path: '/api/protected', mode: 'proxy', requiresAuth: true }
      ]
    };

    try {
      // Step A: Public request passes without session
      const publicResult = await applicationBridge.forwardRequest({
        cloneId,
        manifest,
        method: 'GET',
        path: '/api/public'
      });
      assert.strictEqual(publicResult.status, 200);
      assert.strictEqual(publicResult.data.public, true);

      // Step B: Protected request WITHOUT session is REJECTED with TARGET_REQUIRES_AUTHORIZATION
      let authBlocked = false;
      try {
        await applicationBridge.forwardRequest({
          cloneId,
          manifest,
          method: 'GET',
          path: '/api/protected'
        });
      } catch (err) {
        authBlocked = true;
        assert.strictEqual(err.code, 'TARGET_REQUIRES_AUTHORIZATION');
        assert.strictEqual(err.statusCode, 401);
      }
      assert.strictEqual(authBlocked, true, 'Must block protected route before authentication');

      // Step C: Legitimate OAuth Authorization flow
      const init = OAuthOidcAdapter.initiateAuthorization({
        cloneId,
        targetOrigin,
        authorizationEndpoint: `${targetOrigin}/oauth/authorize`,
        tokenEndpoint: `${targetOrigin}/oauth/token`,
        clientId: 'rebuilt-app',
        callbackUrl: 'http://localhost:3000/api/auth/callback'
      });

      // Identity provider redirects user back with authorization code & state
      const callbackResult = await OAuthOidcAdapter.handleAuthorizationCallback({
        code: 'auth_code_from_provider_123',
        state: init.state
      });

      assert.strictEqual(callbackResult.cloneId, cloneId);
      assert.strictEqual(sessionManager.hasActiveSession(cloneId, targetOrigin), true);

      // Step D: Now protected request SUCCEEDS through bridge with injected authorized token
      const protectedResult = await applicationBridge.forwardRequest({
        cloneId,
        manifest,
        method: 'GET',
        path: '/api/protected'
      });

      assert.strictEqual(protectedResult.status, 200);
      assert.strictEqual(protectedResult.data.authorized, true);
      assert.strictEqual(protectedResult.data.user, 'Dr. Turing');
    } finally {
      delete process.env.ALLOW_LOCAL_TESTING;
      sessionManager.revokeAllCloneSessions(cloneId);
      targetServer.close();
    }
  });

  console.log('\n======================================================');
  console.log(`Results: ${testsPassed} of ${testsPassed + testsFailed} assertions passed.`);
  if (testsFailed === 0) {
    console.log('✓ ALL PHASE 5 TESTS PASSED!');
    process.exit(0);
  } else {
    console.error(`✗ ${testsFailed} tests failed.`);
    process.exit(1);
  }
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
