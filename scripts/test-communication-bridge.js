/**
 * Communication Bridge Verification Test Suite
 * Tests SSE streaming, bi-directional message handling, broadcast delivery,
 * status reporting, and HTML script bridge injection.
 */

const http = require('http');
const assert = require('assert');
const { app, startServer, communicationBridge } = require('../server');
const { rewriteHtmlForPreview } = require('../src/rewriter/html-rewriter');

async function runTests() {
  console.log('\n======================================================');
  console.log('   ⚡ Rebuilt Communication Bridge Test Suite        ');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return (async () => {
      process.stdout.write(`  Testing: ${name} ... `);
      try {
        await fn();
        console.log('✓ PASSED');
        passed++;
      } catch (err) {
        console.log('✗ FAILED');
        console.error('    Error:', err.message);
        failed++;
      }
    })();
  }

  // Start test server
  const testPort = 3899;
  const server = await startServer(testPort);

  try {
    // Test 1: Check bridge status endpoint
    await test('GET /api/bridge/status returns active status', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/bridge/status`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'active');
      assert.strictEqual(typeof data.connectedClients, 'number');
      assert.strictEqual(typeof data.messagesSent, 'number');
    });

    // Test 2: Connect SSE client to /api/bridge/events and verify handshake
    await test('SSE Stream /api/bridge/events sends bridge:connected handshake', async () => {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${testPort}/api/bridge/events?type=test_runner`, (res) => {
          assert.strictEqual(res.statusCode, 200);
          assert.strictEqual(res.headers['content-type'], 'text/event-stream');

          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk.toString();
            if (buffer.includes('event: bridge:connected')) {
              req.destroy();
              resolve();
            }
          });
        });

        req.on('error', (err) => {
          if (req.destroyed) return;
          reject(err);
        });

        setTimeout(() => {
          req.destroy();
          reject(new Error('Timed out waiting for bridge:connected event'));
        }, 5000);
      });
    });

    // Test 3: Broadcast an event and receive it over SSE stream
    await test('Real-time broadcast event is delivered to SSE client', async () => {
      await new Promise((resolve, reject) => {
        let testClientId = null;

        const req = http.get(`http://localhost:${testPort}/api/bridge/events?type=listener`, (res) => {
          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk.toString();

            // Once connected, trigger broadcast
            if (buffer.includes('bridge:connected') && !testClientId) {
              testClientId = 'ready';
              setTimeout(() => {
                communicationBridge.broadcast('test:custom_event', {
                  greeting: 'Hello Rebuilt Bridge',
                  timestamp: 12345
                });
              }, 50);
            }

            if (buffer.includes('event: test:custom_event') && buffer.includes('Hello Rebuilt Bridge')) {
              req.destroy();
              resolve();
            }
          });
        });

        req.on('error', (err) => {
          if (req.destroyed) return;
          reject(err);
        });

        setTimeout(() => {
          req.destroy();
          reject(new Error('Timed out waiting for test:custom_event broadcast'));
        }, 5000);
      });
    });

    // Test 4: Post message to /api/bridge/message (ping -> pong)
    await test('POST /api/bridge/message handles ping action with pong', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/bridge/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ping',
          payload: { timestamp: Date.now() }
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.action, 'pong');
      assert.strictEqual(typeof data.serverTime, 'number');
    });

    // Test 5: Speculative preload request over message bridge
    await test('POST /api/bridge/message handles request_preload action', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/bridge/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request_preload',
          cloneId: 'test_clone_001',
          payload: { path: 'pricing' }
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.status, 'preload_queued');
      assert.strictEqual(data.path, 'pricing');
    });

    // Test 6: Verify in-page communication bridge is injected into rewritten HTML
    await test('HTML Rewriter injects window.__REBUILT_BRIDGE__ into preview pages', () => {
      const sampleHtml = `<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>`;
      const rewritten = rewriteHtmlForPreview(sampleHtml, 'https://example.com', {
        cloneId: 'test_clone_001'
      });

      assert(rewritten.includes('window.__REBUILT_BRIDGE__'), 'Rewritten HTML must contain window.__REBUILT_BRIDGE__');
      assert(rewritten.includes('/api/bridge/message'), 'In-page bridge must target /api/bridge/message');
      assert(rewritten.includes('rebuilt_bridge_message'), 'In-page bridge must support parent postMessage bridge');
    });

    // Test 7: Create URL Web Bridge session
    await test('POST /api/bridge/url/session creates a tracked URL Web Bridge session', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/bridge/url/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.session.targetUrl, 'https://example.com/');
      assert(data.bridgeUrl.includes('/api/bridge/url?url='), 'Bridge URL must point to /api/bridge/url');
    });

    // Test 8: Fetch via Live URL Web Bridge (/api/bridge/url)
    await test('GET /api/bridge/url proxies live web URL and injects window.__REBUILT_URL_BRIDGE__', async () => {
      const target = encodeURIComponent('https://example.com');
      const res = await fetch(`http://localhost:${testPort}/api/bridge/url?url=${target}`);

      assert.strictEqual(res.status, 200);
      assert(res.headers.get('content-type').includes('text/html'), 'Content-Type must be text/html');
      const html = await res.text();
      assert(html.includes('Example Domain'), 'Response must contain target page content');
      assert(html.includes('window.__REBUILT_URL_BRIDGE__'), 'Response must contain injected URL bridge client');
    });

    // Test 9: List URL Web Bridge sessions
    await test('GET /api/bridge/url/sessions lists active URL bridge sessions', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/bridge/url/sessions`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert(Array.isArray(data.sessions), 'Sessions must be an array');
      assert(data.sessions.length > 0, 'Must have at least 1 session');
    });

    // Test 10: Local API - Status & Capability check
    await test('GET /api/local/status returns ready status and capability list', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/local/status`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ready');
      assert(Array.isArray(data.capabilities), 'capabilities must be an array');
    });

    // Test 11: Local API - Fulfill user request (status action)
    await test('POST /api/local/request fulfills "status" action', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/local/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.action, 'status');
      assert.strictEqual(data.server.status, 'online');
    });

    // Test 12: Local API - Fulfill user request (bridge_url action)
    await test('POST /api/local/request fulfills "bridge_url" user request', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/local/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bridge_url',
          url: 'https://example.com'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.action, 'bridge_url');
      assert(data.bridgeUrl.includes('/api/bridge/url?url='), 'Must return a valid bridgeUrl');
    });

  } finally {
    server.close();
  }

  console.log('\n======================================================');
  console.log(`Results: ${passed} of ${passed + failed} tests passed.`);
  if (failed === 0) {
    console.log('✓ ALL COMMUNICATION BRIDGE TESTS PASSED!');
    process.exit(0);
  } else {
    console.log(`✗ ${failed} test(s) failed.`);
    process.exit(1);
  }
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
