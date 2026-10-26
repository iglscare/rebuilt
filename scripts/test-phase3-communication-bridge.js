/**
 * REBUILT 2.0 — Phase 3 Verification Test Suite
 * Validates CommunicationBridge: RequestValidator, ResponseNormalizer, TargetDispatcher,
 * SSRF defense, unmanifested request rejection, and end-to-end authorized API bridging.
 */

const assert = require('assert');
const http = require('http');
const { RequestValidator } = require('../src/bridge/request-validator');
const { ResponseNormalizer } = require('../src/bridge/response-normalizer');
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
  console.log('   ⚡ REBUILT 2.0 — Phase 3 Communication Bridge Tests ');
  console.log('======================================================\n');

  // Sample valid manifest for testing
  const sampleManifest = {
    version: '2.0.0',
    targetOrigin: 'https://example.com',
    frontend: { mode: 'local' },
    communication: { mode: 'bridge' },
    routes: [
      { method: 'GET', path: '/api/courses', mode: 'proxy', contentType: 'application/json' },
      { method: 'GET', path: '/api/courses/:id', mode: 'proxy', contentType: 'application/json' },
      { method: 'POST', path: '/api/search', mode: 'proxy', contentType: 'application/json' }
    ]
  };

  // Test 1: Method Validation
  await runTest('Rejects disallowed HTTP methods (e.g. TRACE)', async () => {
    const result = await RequestValidator.validate({
      method: 'TRACE',
      path: '/api/courses',
      manifest: sampleManifest
    });
    assert.strictEqual(result.isValid, false);
    assert.strictEqual(result.code, 'INVALID_METHOD');
  });

  // Test 2: Route Matching & Unmanifested Route Rejection
  await runTest('Strictly rejects routes not declared in clone-manifest.json', async () => {
    const result = await RequestValidator.validate({
      method: 'GET',
      path: '/api/unauthorized-endpoint',
      manifest: sampleManifest
    });
    assert.strictEqual(result.isValid, false);
    assert.strictEqual(result.code, 'REQUEST_NOT_IN_MANIFEST');
    assert.ok(result.error.includes('is not declared in clone-manifest.json'));
  });

  // Test 3: Parameterized Route Matching
  await runTest('Matches parameterized routes (/api/courses/:id)', async () => {
    const result = await RequestValidator.validate({
      method: 'GET',
      path: '/api/courses/42',
      manifest: sampleManifest
    });
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.matchedRoute.path, '/api/courses/:id');
    assert.strictEqual(result.targetUrl, 'https://example.com/api/courses/42');
  });

  // Test 4: SSRF Protection on Target Origin
  await runTest('Rejects targets pointing to private IP / localhost (SSRF)', async () => {
    const dangerousManifest = {
      ...sampleManifest,
      targetOrigin: 'http://169.254.169.254'
    };
    const result = await RequestValidator.validate({
      method: 'GET',
      path: '/api/courses',
      manifest: dangerousManifest
    });
    assert.strictEqual(result.isValid, false);
    assert.strictEqual(result.code, 'SSRF_BLOCKED');
  });

  // Test 5: Forwarding Header Sanitization
  await runTest('Strips dangerous forwarding and auth headers', async () => {
    const result = await RequestValidator.validate({
      method: 'GET',
      path: '/api/courses',
      headers: {
        'host': 'evil-domain.com',
        'x-forwarded-for': '1.2.3.4',
        'connection': 'upgrade',
        'cookie': 'session=leaked-cookie',
        'authorization': 'Bearer stolen-token',
        'accept': 'application/json'
      },
      manifest: sampleManifest
    });

    assert.strictEqual(result.isValid, true);
    const headers = result.sanitizedHeaders;
    assert.strictEqual(headers['host'], undefined);
    assert.strictEqual(headers['x-forwarded-for'], undefined);
    assert.strictEqual(headers['connection'], undefined);
    assert.strictEqual(headers['cookie'], undefined);
    assert.strictEqual(headers['authorization'], undefined);
    assert.strictEqual(headers['accept'], 'application/json');
  });

  // Test 6: Request Body Size Limit
  await runTest('Rejects request bodies exceeding 10MB limit', async () => {
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
    const result = await RequestValidator.validate({
      method: 'POST',
      path: '/api/search',
      body: bigBuffer,
      manifest: sampleManifest
    });
    assert.strictEqual(result.isValid, false);
    assert.strictEqual(result.code, 'PAYLOAD_TOO_LARGE');
  });

  // Test 7: Response Normalization
  await runTest('Normalizes response: injects CORS, strips Set-Cookie, parses JSON', () => {
    const rawHeaders = {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': 'target_session=abcdef123; HttpOnly',
      'server': 'Apache/2.4.41 (Unix)',
      'x-powered-by': 'PHP/7.4.3',
      'cache-control': 'public, max-age=3600'
    };

    const cleanHeaders = ResponseNormalizer.sanitizeHeaders(rawHeaders);
    assert.strictEqual(cleanHeaders['set-cookie'], undefined, 'Must strip Set-Cookie');
    assert.strictEqual(cleanHeaders['server'], undefined, 'Must strip Server header');
    assert.strictEqual(cleanHeaders['x-powered-by'], undefined, 'Must strip x-powered-by');
    assert.strictEqual(cleanHeaders['access-control-allow-origin'], '*', 'Must set CORS origin');
    assert.strictEqual(cleanHeaders['cache-control'], 'public, max-age=3600');

    const jsonBuffer = Buffer.from(JSON.stringify({ success: true, count: 10 }));
    const { data, isBinary, byteLength } = ResponseNormalizer.normalizeBody(jsonBuffer, 'application/json');
    assert.strictEqual(isBinary, false);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.count, 10);
    assert.strictEqual(byteLength, jsonBuffer.length);
  });

  // Test 8: End-to-End Authorized API Bridging via HTTP Mock Target Server
  await runTest('End-to-end bridge dispatches request to target and returns normalized response', async () => {
    // Spin up an ephemeral authorized target server
    const targetServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === 'GET' && url.pathname === '/api/courses') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=600',
          'Set-Cookie': 'secret_upstream_cookie=12345; HttpOnly'
        });
        res.end(JSON.stringify([
          { id: 'cs101', title: 'Computer Science 101', instructor: 'Dr. Turing' },
          { id: 'math201', title: 'Discrete Mathematics', instructor: 'Dr. Lovelace' }
        ]));
      } else if (req.method === 'POST' && url.pathname === '/api/search') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ query: parsed.q || '', resultsCount: 2 }));
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      }
    });

    const targetPort = 3991;
    await new Promise(r => targetServer.listen(targetPort, r));

    try {
      // Temporarily enable local test flag for this ephemeral target port
      process.env.ALLOW_LOCAL_TESTING = 'true';

      const liveManifest = {
        version: '2.0.0',
        targetOrigin: `http://localhost:${targetPort}`,
        frontend: { mode: 'local' },
        communication: { mode: 'bridge' },
        routes: [
          { method: 'GET', path: '/api/courses', mode: 'proxy' },
          { method: 'POST', path: '/api/search', mode: 'proxy' }
        ]
      };

      // 1. Dispatch GET /api/courses
      const getResult = await applicationBridge.forwardRequest({
        manifest: liveManifest,
        method: 'GET',
        path: '/api/courses'
      });

      assert.strictEqual(getResult.status, 200);
      assert.strictEqual(Array.isArray(getResult.data), true);
      assert.strictEqual(getResult.data.length, 2);
      assert.strictEqual(getResult.data[0].id, 'cs101');
      assert.strictEqual(getResult.headers['set-cookie'], undefined, 'Set-Cookie was stripped');
      assert.strictEqual(getResult.headers['access-control-allow-origin'], '*');

      // 2. Dispatch POST /api/search
      const postResult = await applicationBridge.forwardRequest({
        manifest: liveManifest,
        method: 'POST',
        path: '/api/search',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: 'algorithms' })
      });

      assert.strictEqual(postResult.status, 200);
      assert.strictEqual(postResult.data.query, 'algorithms');
      assert.strictEqual(postResult.data.resultsCount, 2);

      // 3. Dispatch unmanifested route -> must throw 403
      let unmanifestedThrew = false;
      try {
        await applicationBridge.forwardRequest({
          manifest: liveManifest,
          method: 'GET',
          path: '/api/unmanifested-admin'
        });
      } catch (err) {
        unmanifestedThrew = true;
        assert.strictEqual(err.code, 'REQUEST_NOT_IN_MANIFEST');
        assert.strictEqual(err.statusCode, 403);
      }
      assert.strictEqual(unmanifestedThrew, true, 'Unmanifested request must be rejected with 403');

      // 4. Verify safe audit logs were recorded
      const logs = applicationBridge.getAuditLogs();
      assert.ok(logs.length >= 3, 'Audit log entries should be captured');
      const getLog = logs.find(l => l.path === '/api/courses');
      assert.ok(getLog, 'GET /api/courses must be in audit log');
      assert.strictEqual(getLog.status, 200);
      assert.strictEqual(getLog.targetOrigin, `http://localhost:${targetPort}`);

      // Verify no passwords or tokens in logs
      const logsJson = JSON.stringify(logs);
      assert.strictEqual(logsJson.includes('secret_upstream_cookie'), false);
    } finally {
      delete process.env.ALLOW_LOCAL_TESTING;
      targetServer.close();
    }
  });

  // Test 9: Live Public Authorized API Bridging
  await runTest('Bridges live public authorized API endpoint (https://jsonplaceholder.typicode.com)', async () => {
    const publicManifest = {
      version: '2.0.0',
      targetOrigin: 'https://jsonplaceholder.typicode.com',
      frontend: { mode: 'local' },
      communication: { mode: 'bridge' },
      routes: [
        { method: 'GET', path: '/todos/:id', mode: 'proxy', contentType: 'application/json' }
      ]
    };

    const result = await applicationBridge.forwardRequest({
      manifest: publicManifest,
      method: 'GET',
      path: '/todos/1'
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.id, 1);
    assert.strictEqual(result.data.userId, 1);
    assert.ok(typeof result.data.title === 'string');
    assert.strictEqual(result.headers['access-control-allow-origin'], '*');
    assert.strictEqual(result.headers['x-rebuilt-bridge'], 'active');
  });

  console.log('\n======================================================');
  console.log(`Results: ${testsPassed} of ${testsPassed + testsFailed} assertions passed.`);
  if (testsFailed === 0) {
    console.log('✓ ALL PHASE 3 TESTS PASSED!');
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
