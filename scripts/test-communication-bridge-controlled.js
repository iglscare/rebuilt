/**
 * REBUILT — Communication Bridge: Controlled Application Verification Test Suite
 * 
 * Tests the local Communication Bridge against a controlled authorized test application:
 * 1. HTTP Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
 * 2. Query parameters & JSON body handling
 * 3. Session state: POST /api/login sets server-side cookie, GET /api/profile verifies server cookie injection
 * 4. Safe redirects: 302 within authorized target vs blocked untrusted external redirect
 * 5. Error classifications: 401, 403, 404, 500, timeout, SSRF
 * 6. Manifest modes: LIVE_BRIDGE vs SNAPSHOT
 * 7. Safe request logging & developer panel monitor (no password/cookie leaks)
 */

process.env.ALLOW_LOCAL_TESTING = 'true';

const assert = require('assert');
const http = require('http');
const { bridgeRequestHandler } = require('../src/bridge/request-handler');
const { RouteMap } = require('../src/bridge/route-map');
const { BridgeSecurity } = require('../src/bridge/security');
const { ManifestManager, MODES } = require('../src/bridge/manifest');
const { bridgeSessionManager } = require('../src/bridge/session');

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

/**
 * Creates an in-process authorized mock target server
 */
function createMockTargetServer(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk.toString(); });
      req.on('end', () => {
        let parsedBody = null;
        if (bodyStr) {
          try { parsedBody = JSON.parse(bodyStr); } catch (_) { parsedBody = bodyStr; }
        }

        // Route: GET /api/user
        if (method === 'GET' && pathname === '/api/user') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ id: 1, name: 'Authorized Test User', role: 'admin' }));
        }

        // Route: POST /api/login (Sets session cookie)
        if (method === 'POST' && pathname === '/api/login') {
          if (parsedBody && parsedBody.username === 'testuser') {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Set-Cookie': 'auth_session=token_abc_12345; Path=/; HttpOnly; SameSite=Lax'
            });
            return res.end(JSON.stringify({ success: true, message: 'Authenticated successfully' }));
          }
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid credentials' }));
        }

        // Route: GET /api/profile (Requires session cookie)
        if (method === 'GET' && pathname === '/api/profile') {
          const cookieHeader = req.headers['cookie'] || '';
          if (cookieHeader.includes('auth_session=token_abc_12345')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ user: 'testuser', profile: 'Authorized Admin Profile' }));
          }
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid session cookie' }));
        }

        // Route: POST /api/data (Creates data)
        if (method === 'POST' && pathname === '/api/data') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ created: true, data: parsedBody }));
        }

        // Route: PUT /api/data/:id
        if (method === 'PUT' && pathname.startsWith('/api/data/')) {
          const id = pathname.slice('/api/data/'.length);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ updated: true, id, data: parsedBody }));
        }

        // Route: PATCH /api/data/:id
        if (method === 'PATCH' && pathname.startsWith('/api/data/')) {
          const id = pathname.slice('/api/data/'.length);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ patched: true, id, delta: parsedBody }));
        }

        // Route: DELETE /api/data/:id
        if (method === 'DELETE' && pathname.startsWith('/api/data/')) {
          const id = pathname.slice('/api/data/'.length);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ deleted: true, id }));
        }

        // Route: GET /api/search (Query parameters)
        if (method === 'GET' && pathname === '/api/search') {
          const queryParams = Object.fromEntries(url.searchParams.entries());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ results: ['item1', 'item2'], query: queryParams }));
        }

        // Route: GET /api/redirect (Safe upstream redirect)
        if (method === 'GET' && pathname === '/api/redirect') {
          res.writeHead(302, { 'Location': `/api/user` });
          return res.end();
        }

        // Route: GET /api/redirect-external (Untrusted redirect)
        if (method === 'GET' && pathname === '/api/redirect-external') {
          res.writeHead(302, { 'Location': `https://untrusted-attacker.com/steal` });
          return res.end();
        }

        // Error triggers
        if (pathname === '/api/error-401') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Unauthorized access' }));
        }
        if (pathname === '/api/error-403') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
        if (pathname === '/api/error-404') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Resource not found' }));
        }
        if (pathname === '/api/error-500') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Internal server error' }));
        }

        // Fallback 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      });
    });

    server.listen(port, () => {
      resolve(server);
    });
  });
}

async function main() {
  console.log('\n======================================================');
  console.log('   ⚡ REBUILT — Controlled Communication Bridge Tests  ');
  console.log('======================================================\n');

  const TEST_PORT = 39871;
  const mockServer = await createMockTargetServer(TEST_PORT);
  const targetOrigin = `http://localhost:${TEST_PORT}`;
  const cloneId = 'controlled_test_clone';

  // Build authorized manifest with object routes structure
  const testManifest = {
    version: '2.0.0',
    targetOrigin,
    allowedOrigins: [targetOrigin],
    mode: MODES.LIVE_BRIDGE,
    routes: {
      '/api/user': { target: '/api/user', methods: ['GET'] },
      '/api/login': { target: '/api/login', methods: ['POST'] },
      '/api/profile': { target: '/api/profile', methods: ['GET'] },
      '/api/data': { target: '/api/data', methods: ['POST'] },
      '/api/data/:id': { target: '/api/data/:id', methods: ['PUT', 'PATCH', 'DELETE'] },
      '/api/search': { target: '/api/search', methods: ['GET'] },
      '/api/redirect': { target: '/api/redirect', methods: ['GET'] },
      '/api/redirect-external': { target: '/api/redirect-external', methods: ['GET'] },
      '/api/error-401': { target: '/api/error-401', methods: ['GET'] },
      '/api/error-403': { target: '/api/error-403', methods: ['GET'] },
      '/api/error-404': { target: '/api/error-404', methods: ['GET'] },
      '/api/error-500': { target: '/api/error-500', methods: ['GET'] }
    }
  };

  try {
    // 1. GET request
    await runTest('1. GET /api/user -> 200 OK with authorized target data', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'GET',
        path: '/api/user'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.name, 'Authorized Test User');
      assert.strictEqual(res.headers['x-rebuilt-bridge'], 'active');
    });

    // 2. POST request with JSON body & Session Cookie capture
    await runTest('2. POST /api/login -> 200 OK and captures server session cookie', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'POST',
        path: '/api/login',
        body: { username: 'testuser', password: 'SafePassword123!' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      // Server-side cookie manager should now have cookie
      const cookieHeader = bridgeSessionManager.getCookieHeader(cloneId, `localhost`);
      assert(cookieHeader.includes('auth_session=token_abc_12345'), 'Cookie captured server-side');
      // Set-Cookie must NOT be sent back to client
      assert.strictEqual(res.headers['set-cookie'], undefined, 'Set-Cookie stripped from client response');
    });

    // 3. GET /api/profile using server-side session cookie injection
    await runTest('3. GET /api/profile -> 200 OK via server-injected session cookie', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'GET',
        path: '/api/profile'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.profile, 'Authorized Admin Profile');
    });

    // 4. POST /api/data with JSON body
    await runTest('4. POST /api/data -> 201 Created with JSON body forwarding', async () => {
      const payload = { title: 'Test Document', count: 42 };
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'POST',
        path: '/api/data',
        body: payload
      });
      assert.strictEqual(res.status, 201);
      assert.deepStrictEqual(res.data.data, payload);
    });

    // 5. PUT /api/data/:id (parameterized route)
    await runTest('5. PUT /api/data/101 -> 200 OK parameterized update', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'PUT',
        path: '/api/data/101',
        body: { name: 'Updated Item' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.id, '101');
      assert.strictEqual(res.data.updated, true);
    });

    // 6. PATCH /api/data/:id
    await runTest('6. PATCH /api/data/101 -> 200 OK partial update', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'PATCH',
        path: '/api/data/101',
        body: { status: 'active' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.patched, true);
      assert.strictEqual(res.data.delta.status, 'active');
    });

    // 7. DELETE /api/data/:id
    await runTest('7. DELETE /api/data/101 -> 200 OK deletion', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'DELETE',
        path: '/api/data/101'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.deleted, true);
      assert.strictEqual(res.data.id, '101');
    });

    // 8. Query parameters: GET /api/search?q=testing&page=2
    await runTest('8. Query Parameters: GET /api/search -> query string preserved upstream', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'GET',
        path: '/api/search',
        query: { q: 'testing', page: '2' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.query.q, 'testing');
      assert.strictEqual(res.data.query.page, '2');
    });

    // 9. Safe Upstream Redirect: GET /api/redirect -> 302 followed within authorized target
    await runTest('9. Upstream Redirect: 302 followed safely to target destination', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'GET',
        path: '/api/redirect'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.name, 'Authorized Test User');
    });

    // 10. Untrusted Redirect Blocked: GET /api/redirect-external -> BRIDGE_REDIRECT_BLOCKED
    await runTest('10. Untrusted Redirect: Blocks redirect to unauthorized external domain', async () => {
      let threw = false;
      try {
        await bridgeRequestHandler.handleRequest({
          cloneId,
          manifest: testManifest,
          method: 'GET',
          path: '/api/redirect-external'
        });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.code, 'BRIDGE_REDIRECT_BLOCKED');
      }
      assert(threw, 'Must throw BRIDGE_REDIRECT_BLOCKED');
    });

    // 11. Error handling: 401 Unauthorized
    await runTest('11. Error handling: 401 Unauthorized returns target status without crashing', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'GET',
        path: '/api/error-401'
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.error, 'Unauthorized access');
    });

    // 12. Error handling: 403 Forbidden
    await runTest('12. Error handling: 403 Forbidden returns target status', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'GET',
        path: '/api/error-403'
      });
      assert.strictEqual(res.status, 403);
    });

    // 13. Error handling: 404 Not Found
    await runTest('13. Error handling: 404 Not Found returns target status', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'GET',
        path: '/api/error-404'
      });
      assert.strictEqual(res.status, 404);
    });

    // 14. Error handling: 500 Internal Server Error
    await runTest('14. Error handling: 500 Internal Server Error returns target status', async () => {
      const res = await bridgeRequestHandler.handleRequest({
        cloneId,
        manifest: testManifest,
        method: 'GET',
        path: '/api/error-500'
      });
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.data.error, 'Internal server error');
    });

    // 15. Unmanifested endpoint rejection -> BRIDGE_ROUTE_NOT_FOUND
    await runTest('15. Route Allowlist: Unmanifested endpoint rejected with BRIDGE_ROUTE_NOT_FOUND', async () => {
      let threw = false;
      try {
        await bridgeRequestHandler.handleRequest({
          cloneId,
          manifest: testManifest,
          method: 'GET',
          path: '/api/unmanifested-secret-route'
        });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.code, 'BRIDGE_ROUTE_NOT_FOUND');
      }
      assert(threw, 'Must throw BRIDGE_ROUTE_NOT_FOUND');
    });

    // 16. Mode SNAPSHOT: Rejects live dispatch with BRIDGE_MODE_SNAPSHOT
    await runTest('16. Mode SNAPSHOT: Halts live dispatch with BRIDGE_MODE_SNAPSHOT', async () => {
      const snapshotManifest = {
        ...testManifest,
        mode: MODES.SNAPSHOT
      };
      let threw = false;
      try {
        await bridgeRequestHandler.handleRequest({
          cloneId,
          manifest: snapshotManifest,
          method: 'GET',
          path: '/api/user'
        });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.code, 'BRIDGE_MODE_SNAPSHOT');
      }
      assert(threw, 'Must throw BRIDGE_MODE_SNAPSHOT');
    });

    // 17. SSRF Protection: Rejects attempt to bridge to metadata endpoint
    await runTest('17. SSRF Guard: Rejects destination pointing to cloud metadata (169.254.169.254)', async () => {
      const ssrfManifest = {
        ...testManifest,
        targetOrigin: 'http://169.254.169.254',
        allowedOrigins: ['http://169.254.169.254']
      };
      let threw = false;
      try {
        await bridgeRequestHandler.handleRequest({
          cloneId,
          manifest: ssrfManifest,
          method: 'GET',
          path: '/api/user'
        });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.code, 'BRIDGE_TARGET_NOT_ALLOWED');
      }
      assert(threw, 'Must throw BRIDGE_TARGET_NOT_ALLOWED');
    });

    // 18. Safe Audit Logs: Verifies no passwords or cookies leaked in telemetry
    await runTest('18. Safe Logging: Audit logs record method, status, timing without leaking secrets', async () => {
      const logs = bridgeRequestHandler.getAuditLogs();
      assert(logs.length > 0, 'Audit logs recorded');
      const serialized = JSON.stringify(logs);
      assert(!serialized.includes('SafePassword123!'), 'Password not leaked in audit logs');
      assert(!serialized.includes('token_abc_12345'), 'Session cookie not leaked in audit logs');

      const loginLog = logs.find(l => l.localPath === '/api/login');
      assert(loginLog, 'Login request logged');
      assert.strictEqual(loginLog.method, 'POST');
      assert.strictEqual(loginLog.status, 200);
      assert.strictEqual(loginLog.authState, 'SUCCESS');
    });

    // 19. Manifest Generation from Discovery Data
    await runTest('19. Manifest Generation: Automatically builds route manifest from discovery entries', async () => {
      const discoveryEntries = [
        { url: 'https://example.com/api/users', method: 'GET', resourceType: 'fetch', contentType: 'application/json' },
        { url: 'https://example.com/api/login', method: 'POST', resourceType: 'xhr', contentType: 'application/json' },
        { url: 'https://example.com/assets/logo.png', method: 'GET', resourceType: 'image' } // Should be excluded
      ];
      const gen = ManifestManager.generateFromDiscovery({
        targetOrigin: 'https://example.com',
        discoveryEntries,
        mode: MODES.LIVE_BRIDGE
      });

      assert.strictEqual(gen.targetOrigin, 'https://example.com');
      assert.strictEqual(gen.mode, MODES.LIVE_BRIDGE);
      assert(gen.routes['/api/users'], 'Route /api/users included');
      assert(gen.routes['/api/login'], 'Route /api/login included');
      assert(!gen.routes['/assets/logo.png'], 'Static asset excluded from API manifest');
    });

  } finally {
    mockServer.close();
  }

  // Print results
  console.log('\n======================================================');
  console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('======================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
