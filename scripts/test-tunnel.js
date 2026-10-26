/**
 * Test Suite: Port Forwarding & Tunnel Service
 */

const assert = require('assert');
const http = require('http');
const { app, startServer } = require('../server');
const { tunnelService } = require('../src/tunnel/tunnel-service');

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

async function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function main() {
  console.log('\n======================================================');
  console.log('   ⚡ REBUILT — Port Forwarding & Tunnel Test Suite    ');
  console.log('======================================================\n');

  const testPort = 3088;
  const server = await startServer(testPort);

  try {
    // Test 1: Tunnel status endpoint returns valid initial status
    await runTest('GET /api/tunnel/status returns initial status structure', async () => {
      const res = await requestJson(`http://localhost:${testPort}/api/tunnel/status`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(typeof res.json.active, 'boolean');
      assert.strictEqual(res.json.port, testPort);
    });

    // Test 2: Tunnel clone link endpoint
    await runTest('GET /api/tunnel/clone-link/:id returns live URL', async () => {
      const res = await requestJson(`http://localhost:${testPort}/api/tunnel/clone-link/test_clone_123`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.cloneId, 'test_clone_123');
      assert(res.json.liveUrl.includes('test_clone_123'));
    });

    // Test 3: tunnelService getLiveCloneUrl logic
    await runTest('tunnelService resolves local and public URLs correctly', () => {
      const initialUrl = tunnelService.getLiveCloneUrl('sample_id');
      assert(initialUrl.includes('/clones/sample_id/'));

      // Simulate active tunnel URL
      tunnelService.currentUrl = 'https://my-live-tunnel.loca.lt';
      const liveTunnelUrl = tunnelService.getLiveCloneUrl('sample_id');
      assert.strictEqual(liveTunnelUrl, 'https://my-live-tunnel.loca.lt/clones/sample_id/');

      // Reset
      tunnelService.currentUrl = null;
    });

    // Test 4: Stop endpoint safely succeeds even if offline
    await runTest('POST /api/tunnel/stop cleanly responds when stopped', async () => {
      const res = await requestJson(`http://localhost:${testPort}/api/tunnel/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.active, false);
    });

    console.log('\n======================================================');
    console.log(`Results: ${testsPassed} of ${testsPassed + testsFailed} assertions passed.`);
    if (testsFailed === 0) {
      console.log('✓ ALL TUNNEL TESTS PASSED!');
    } else {
      console.error(`✗ ${testsFailed} tests failed.`);
      process.exitCode = 1;
    }
    console.log('======================================================\n');

  } finally {
    server.close();
  }
}

main().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
