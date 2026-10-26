const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { validateUrl } = require('../src/security/ssrf-guard');
const { saveClone, getClone, listClones, CLONES_DIR } = require('../src/storage/clone-storage');
const { cloneWebsite } = require('../src/service/clone-service');
const { app } = require('../server');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`  Testing: ${name} ... `);
  try {
    await fn();
    console.log('✓ PASSED');
    passedTests++;
  } catch (err) {
    console.log('❌ FAILED');
    console.error('    Error:', err.message);
  }
}

async function runAllTests() {
  console.log('\n=================================================');
  console.log('   Rebuilt Web Cloner — Phase 1 Test Suite       ');
  console.log('=================================================\n');

  // --- Suite 1: SSRF Guard ---
  console.log('[Suite 1: SSRF & URL Security Guard]');

  await runTest('Reject empty or non-string URL', async () => {
    const res1 = await validateUrl('');
    assert.strictEqual(res1.isValid, false);
    const res2 = await validateUrl(null);
    assert.strictEqual(res2.isValid, false);
  });

  await runTest('Reject non-http/https schemes (file, ftp, javascript)', async () => {
    const resFile = await validateUrl('file:///etc/passwd');
    assert.strictEqual(resFile.isValid, false);
    assert(resFile.error.includes('Unsupported protocol'));

    const resFtp = await validateUrl('ftp://ftp.example.com');
    assert.strictEqual(resFtp.isValid, false);

    const resJs = await validateUrl('javascript:alert(1)');
    assert.strictEqual(resJs.isValid, false);
  });

  await runTest('Reject localhost and loopback addresses', async () => {
    const resLocal = await validateUrl('http://localhost:3000');
    assert.strictEqual(resLocal.isValid, false);

    const resIp = await validateUrl('http://127.0.0.1:8080');
    assert.strictEqual(resIp.isValid, false);

    const resZero = await validateUrl('http://0.0.0.0:8000');
    assert.strictEqual(resZero.isValid, false);
  });

  await runTest('Reject cloud metadata endpoint (169.254.169.254)', async () => {
    const resMeta = await validateUrl('http://169.254.169.254/latest/meta-data/');
    assert.strictEqual(resMeta.isValid, false);
  });

  await runTest('Reject private RFC1918 IPv4 ranges (10.x, 192.168.x, 172.16.x)', async () => {
    const res10 = await validateUrl('http://10.0.0.1/admin');
    assert.strictEqual(res10.isValid, false);

    const res192 = await validateUrl('http://192.168.1.1/');
    assert.strictEqual(res192.isValid, false);

    const res172 = await validateUrl('http://172.16.0.1/');
    assert.strictEqual(res172.isValid, false);
  });

  await runTest('Accept valid public domain (https://example.com)', async () => {
    const res = await validateUrl('https://example.com');
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.sanitizedUrl, 'https://example.com/');
  });

  // --- Suite 2: Storage Subsystem ---
  console.log('\n[Suite 2: Storage & Manifest Management]');

  const testCloneId = `test_clone_${Date.now()}`;

  await runTest('Save clone HTML and metadata.json', async () => {
    const dummyHtml = '<!DOCTYPE html><html><head><title>Test Page</title></head><body><h1>Hello Rebuilt</h1></body></html>';
    const metadata = await saveClone({
      id: testCloneId,
      originalUrl: 'https://test.example.com',
      finalUrl: 'https://test.example.com/',
      title: 'Test Page',
      html: dummyHtml,
      renderTimeMs: 120
    });

    assert.strictEqual(metadata.id, testCloneId);
    assert.strictEqual(metadata.title, 'Test Page');
    assert.strictEqual(metadata.status, 'ready');
    assert.strictEqual(metadata.pageCount, 1);
    assert.strictEqual(metadata.previewUrl, `/clones/${testCloneId}/`);

    // Verify files on disk
    const htmlPath = path.join(CLONES_DIR, testCloneId, 'index.html');
    const metaPath = path.join(CLONES_DIR, testCloneId, 'metadata.json');

    assert(fs.existsSync(htmlPath), 'index.html must exist');
    assert(fs.existsSync(metaPath), 'metadata.json must exist');

    const readHtml = fs.readFileSync(htmlPath, 'utf8');
    assert.strictEqual(readHtml, dummyHtml);
  });

  await runTest('Retrieve clone metadata by ID', async () => {
    const retrieved = await getClone(testCloneId);
    assert(retrieved !== null);
    assert.strictEqual(retrieved.id, testCloneId);
    assert.strictEqual(retrieved.originalUrl, 'https://test.example.com');
  });

  await runTest('List clones includes saved clone', async () => {
    const list = await listClones();
    assert(Array.isArray(list));
    const found = list.find((c) => c.id === testCloneId);
    assert(found !== undefined, 'Saved clone should be present in list');
  });

  // --- Suite 3: Playwright Chromium Dynamic Rendering ---
  console.log('\n[Suite 3: Playwright Chromium Headless Renderer]');

  let liveCloneId = null;

  await runTest('Render public site (https://example.com) via Playwright', async () => {
    const cloneResult = await cloneWebsite({ url: 'https://example.com' });
    liveCloneId = cloneResult.id;

    assert(cloneResult.id);
    assert.strictEqual(cloneResult.status, 'ready');
    assert(cloneResult.title.includes('Example Domain'));
    assert(cloneResult.size > 200, 'HTML size should be non-trivial');
    assert(cloneResult.previewUrl.startsWith('/clones/'));

    // Check disk content
    const htmlPath = path.join(CLONES_DIR, liveCloneId, 'index.html');
    assert(fs.existsSync(htmlPath));
    const content = fs.readFileSync(htmlPath, 'utf8');
    assert(content.includes('Example Domain'));
  });

  // --- Suite 4: Local Preview Serving & HTTP API ---
  console.log('\n[Suite 4: Express HTTP Server & Local Preview]');

  await runTest('Local Preview serves saved clone via HTTP', async () => {
    const testPort = 3999;
    const server = await new Promise((resolve) => {
      const s = app.listen(testPort, () => resolve(s));
    });

    try {
      // 1. Fetch preview HTML
      const htmlContent = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${testPort}/clones/${liveCloneId}/`, (res) => {
          assert.strictEqual(res.statusCode, 200);
          assert(res.headers['content-type'].includes('text/html'));
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => resolve(body));
        }).on('error', reject);
      });

      assert(htmlContent.includes('Example Domain'), 'Preview must serve the rendered page content');

      // 2. Test API Error handling for SSRF attempt
      const apiResponse = await new Promise((resolve, reject) => {
        const postData = JSON.stringify({ url: 'http://127.0.0.1:8080' });
        const req = http.request(`http://localhost:${testPort}/api/web-cloner/clone`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        }, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      assert.strictEqual(apiResponse.status, 403);
      assert.strictEqual(apiResponse.data.code, 'SECURITY_VIOLATION');
      assert(!apiResponse.data.stack, 'Must not leak stack trace');

      // 3. Test DELETE /api/web-cloner/clones/:id
      const deleteResponse = await new Promise((resolve, reject) => {
        const req = http.request(`http://localhost:${testPort}/api/web-cloner/clones/${liveCloneId}`, {
          method: 'DELETE'
        }, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
        });
        req.on('error', reject);
        req.end();
      });

      assert.strictEqual(deleteResponse.status, 200);
      assert.strictEqual(deleteResponse.data.success, true);
      assert(!fs.existsSync(path.join(CLONES_DIR, liveCloneId)), 'Deleted clone directory must not exist');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Summary
  console.log('\n=================================================');
  console.log(`Results: ${passedTests} of ${totalTests} assertions passed.`);
  if (passedTests === totalTests) {
    console.log('✓ ALL FOUNDATION TESTS PASSED!');
    console.log('=================================================\n');
    process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('=================================================\n');
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
