/**
 * REBUILT 2.0 — Phase 2 Verification Test Suite
 * Validates NetworkDiscoveryEngine, header/secret redaction, and clone-manifest.json production.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { NetworkDiscoveryEngine, SENSITIVE_KEY_PATTERN } = require('../src/discovery/network-discovery-engine');
const { renderPage } = require('../src/renderer/playwright-renderer');
const { saveClone, getCloneManifest } = require('../src/storage/clone-storage');

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
  console.log('   ⚡ REBUILT 2.0 — Phase 2 Network Discovery Tests   ');
  console.log('======================================================\n');

  // Test 1: Header Sanitization and Redaction
  await runTest('Sanitizes sensitive headers and detects auth indicators', () => {
    const engine = new NetworkDiscoveryEngine({ targetOrigin: 'https://authorized-app.com' });
    const rawHeaders = {
      'authorization': 'Bearer super-secret-jwt-token-12345',
      'cookie': 'session_id=abcdef123456; secret=xyz',
      'x-api-key': 'secret-api-key-999',
      'accept': 'application/json',
      'content-type': 'application/json',
      'user-agent': 'RebuiltBrowser/2.0'
    };

    const { allowedHeaders, hasAuthHeader } = engine.sanitizeRequestHeaders(rawHeaders);

    assert.strictEqual(hasAuthHeader, true, 'Should detect auth indicator');
    assert.strictEqual(allowedHeaders['authorization'], undefined, 'Must strip authorization');
    assert.strictEqual(allowedHeaders['cookie'], undefined, 'Must strip cookie');
    assert.strictEqual(allowedHeaders['x-api-key'], undefined, 'Must strip api key');
    assert.strictEqual(allowedHeaders['accept'], 'application/json', 'Must keep accept header');
    assert.strictEqual(allowedHeaders['content-type'], 'application/json', 'Must keep content-type');
  });

  // Test 2: Query Parameter Redaction
  await runTest('Redacts sensitive query parameters', () => {
    const engine = new NetworkDiscoveryEngine({ targetOrigin: 'https://authorized-app.com' });
    const params = new URLSearchParams('page=2&sort=desc&api_key=secretKey123&authToken=xyz789&user_id=42');
    const sanitized = engine.sanitizeQueryParams(params);

    assert.strictEqual(sanitized['page'], '2');
    assert.strictEqual(sanitized['sort'], 'desc');
    assert.strictEqual(sanitized['api_key'], '[REDACTED]', 'Must redact api_key');
    assert.strictEqual(sanitized['authToken'], '[REDACTED]', 'Must redact authToken');
    assert.strictEqual(sanitized['user_id'], '42');
  });

  // Test 3: Request & Response Body Shape Inference
  await runTest('Infers payload schema shapes without storing confidential values', () => {
    const engine = new NetworkDiscoveryEngine({ targetOrigin: 'https://authorized-app.com' });
    const sensitivePayload = JSON.stringify({
      username: 'john_doe',
      password: 'SuperSecretPassword123!',
      apiKey: 'xyz-secret-token',
      preferences: { theme: 'dark', notifications: true }
    });

    const shape = engine.inferBodyShape(sensitivePayload, 'application/json');
    assert.strictEqual(shape.type, 'object');
    assert.strictEqual(shape.fieldCount, 4);

    // Verify raw secret password is not saved
    const shapeStr = JSON.stringify(shape);
    assert.strictEqual(shapeStr.includes('SuperSecretPassword123!'), false, 'Shape must not contain raw password');
    assert.strictEqual(shapeStr.includes('xyz-secret-token'), false, 'Shape must not contain raw API key');

    // Password field is flagged as sensitive
    const passField = shape.fields.find(f => f.field === 'password');
    assert.ok(passField, 'Password field should be recognized in schema');
    assert.strictEqual(passField.isSensitive, true, 'Password field must be flagged as sensitive');
  });

  // Test 4: Dynamic API Route Discovery & Manifest Generation
  await runTest('Generates standard clone-manifest.json with observed routes', () => {
    const engine = new NetworkDiscoveryEngine({ targetOrigin: 'https://authorized-app.com' });

    engine.registerRoute({
      method: 'GET',
      path: '/api/courses',
      origin: 'https://authorized-app.com',
      resourceType: 'fetch',
      contentType: 'application/json',
      requiresAuthentication: false
    });

    engine.registerRoute({
      method: 'POST',
      path: '/api/search',
      origin: 'https://authorized-app.com',
      resourceType: 'fetch',
      contentType: 'application/json',
      requiresAuthentication: false,
      requestBodyShape: { type: 'object', fields: [{ field: 'query', type: 'string' }] }
    });

    engine.registerRoute({
      method: 'GET',
      path: '/api/profile',
      origin: 'https://authorized-app.com',
      resourceType: 'fetch',
      contentType: 'application/json',
      requiresAuthentication: true
    });

    const manifest = engine.generateManifest();

    assert.strictEqual(manifest.version, '2.0.0');
    assert.strictEqual(manifest.targetOrigin, 'https://authorized-app.com');
    assert.strictEqual(manifest.frontend.mode, 'local');
    assert.strictEqual(manifest.communication.mode, 'bridge');
    assert.strictEqual(manifest.routes.length, 3);

    const getCourses = manifest.routes.find(r => r.path === '/api/courses');
    assert.ok(getCourses);
    assert.strictEqual(getCourses.method, 'GET');
    assert.strictEqual(getCourses.mode, 'proxy');
    assert.strictEqual(getCourses.requiresAuth, false);

    const postSearch = manifest.routes.find(r => r.path === '/api/search');
    assert.ok(postSearch);
    assert.strictEqual(postSearch.method, 'POST');
    assert.strictEqual(postSearch.mode, 'proxy');

    const getProfile = manifest.routes.find(r => r.path === '/api/profile');
    assert.ok(getProfile);
    assert.strictEqual(getProfile.requiresAuth, true);

    assert.strictEqual(manifest.stats.apiRoutesCount, 3);
    assert.strictEqual(manifest.stats.authRequiredCount, 1);
  });

  // Test 5: Storage Layer writes and retrieves clone-manifest.json
  await runTest('Storage layer saves and retrieves clone-manifest.json', async () => {
    const testId = `test_manifest_${Date.now()}`;
    const engine = new NetworkDiscoveryEngine({ targetOrigin: 'https://test-authorized-site.com' });
    engine.registerRoute({
      method: 'GET',
      path: '/api/test-data',
      origin: 'https://test-authorized-site.com',
      resourceType: 'fetch',
      contentType: 'application/json'
    });
    const manifest = engine.generateManifest();

    await saveClone({
      id: testId,
      originalUrl: 'https://test-authorized-site.com',
      finalUrl: 'https://test-authorized-site.com',
      title: 'Manifest Test Site',
      html: '<!DOCTYPE html><html><body><h1>Test</h1></body></html>',
      manifest
    });

    const retrievedManifest = await getCloneManifest(testId);
    assert.ok(retrievedManifest, 'Retrieved manifest must exist');
    assert.strictEqual(retrievedManifest.targetOrigin, 'https://test-authorized-site.com');
    assert.strictEqual(retrievedManifest.routes.length, 1);
    assert.strictEqual(retrievedManifest.routes[0].path, '/api/test-data');

    // Clean up test clone dir
    const { getCloneDirPath, deleteClone } = require('../src/storage/clone-storage');
    await deleteClone(testId).catch(() => {});
  });

  // Test 6: End-to-End Playwright Render with Real Dynamic API Traffic
  await runTest('Playwright renderer captures live API requests into manifest', async () => {
    // Spin up an ephemeral local mock server with API endpoints
    const mockServer = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Dynamic SPA Test</title></head>
            <body>
              <h1>SPA App</h1>
              <div id="data">Loading...</div>
              <script>
                // Trigger client-side dynamic fetch requests
                fetch('/api/products')
                  .then(r => r.json())
                  .then(data => {
                    document.getElementById('data').innerText = data.length + ' products';
                  });

                fetch('/api/user/info', {
                  headers: { 'Authorization': 'Bearer test-token-secret' }
                });
              </script>
            </body>
          </html>
        `);
      } else if (req.url === '/api/products') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: 1, name: 'Product A' }, { id: 2, name: 'Product B' }]));
      } else if (req.url === '/api/user/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ userId: 123, role: 'admin' }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    const mockPort = 3982;
    await new Promise((resolve) => mockServer.listen(mockPort, resolve));

    try {
      const renderResult = await renderPage(`http://localhost:${mockPort}/`, { timeout: 15000 });
      assert.ok(renderResult, 'Render result must be returned');
      assert.ok(renderResult.manifest, 'Manifest must be produced by renderer');
      assert.strictEqual(renderResult.manifest.version, '2.0.0');

      const routes = renderResult.manifest.routes;
      assert.ok(routes.length >= 1, `Expected observed routes, got ${routes.length}`);

      const productsRoute = routes.find(r => r.path === '/api/products');
      assert.ok(productsRoute, 'Must observe /api/products request');
      assert.strictEqual(productsRoute.method, 'GET');
      assert.strictEqual(productsRoute.mode, 'proxy');

      // Verify no sensitive tokens leaked into manifest
      const manifestJson = JSON.stringify(renderResult.manifest);
      assert.strictEqual(manifestJson.includes('test-token-secret'), false, 'Token must never leak into manifest');
    } finally {
      mockServer.close();
    }
  });

  console.log('\n======================================================');
  console.log(`Results: ${testsPassed} of ${testsPassed + testsFailed} assertions passed.`);
  if (testsFailed === 0) {
    console.log('✓ ALL PHASE 2 TESTS PASSED!');
    const { closeBrowser } = require('../src/renderer/browser-pool');
    await closeBrowser().catch(() => {});
    process.exit(0);
  } else {
    console.error(`✗ ${testsFailed} tests failed.`);
    process.exit(1);
  }
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
