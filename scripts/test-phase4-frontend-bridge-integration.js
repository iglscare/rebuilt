/**
 * REBUILT 2.0 — Phase 4 Verification Test Suite
 * Validates Bridge Integration into Generated Frontend:
 * - Dynamic vs Static resource separation in HTML rewriter
 * - window.fetch and XMLHttpRequest routing to Communication Bridge
 * - Local frontend execution with real bridged backend responses
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const { rewriteHtmlForPreview } = require('../src/rewriter/html-rewriter');
const { saveClone, deleteClone } = require('../src/storage/clone-storage');
const { renderPage } = require('../src/renderer/playwright-renderer');
const { closeBrowser } = require('../src/renderer/browser-pool');

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
  console.log('   ⚡ REBUILT 2.0 — Phase 4 Frontend Bridge Tests      ');
  console.log('======================================================\n');

  // Test 1: HTML Rewriter Injects Communication Bridge Hooks
  await runTest('Rewriter injects Communication Bridge hooks into frontend HTML', () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Test App</title></head>
        <body>
          <div id="app">Hello</div>
        </body>
      </html>
    `;

    const rewritten = rewriteHtmlForPreview(rawHtml, 'https://authorized-app.com/', {
      cloneId: 'clone_test_phase4_1'
    });

    assert.ok(rewritten.includes('window.__REBUILT_CLONE_ID__ = "clone_test_phase4_1"'), 'Must inject clone ID context');
    assert.ok(rewritten.includes('window.__REBUILT_ORIGINAL_ORIGIN__ = "https://authorized-app.com"'), 'Must inject original origin context');
    assert.ok(rewritten.includes('/api/bridge/clone/'), 'Must route dynamic requests through /api/bridge/clone/');
  });

  // Test 2: Dynamic API Route Preservation (Does not turn /api/... into static assets)
  await runTest('Preserves dynamic API routes and differentiates from static assets', () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="stylesheet" href="/assets/style.css">
          <script src="/assets/main.js"></script>
        </head>
        <body>
          <img src="/api/logo.svg" alt="Logo">
          <script>
            // Dynamic API call
            fetch('/api/courses').then(r => r.json());
          </script>
        </body>
      </html>
    `;

    const rewritten = rewriteHtmlForPreview(rawHtml, 'https://authorized-app.com/', {
      cloneId: 'clone_test_phase4_2'
    });

    // Static logo is converted to absolute URL for local resolution
    assert.ok(rewritten.includes('https://authorized-app.com/api/logo.svg'), 'Static asset image src resolved');
    // In-script fetch('/api/courses') remains an API route to be bridged
    assert.ok(rewritten.includes("fetch('/api/courses')"), 'Dynamic script fetch preserved');
  });

  // Test 3: End-to-End Local Frontend Execution with Real Dynamic Bridged Response
  await runTest('Local frontend renders and receives real dynamic data through Communication Bridge', async () => {
    process.env.ALLOW_LOCAL_TESTING = 'true';

    // 1. Create Mock Authorized Target Server
    const targetServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/api/courses') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300'
        });
        res.end(JSON.stringify([
          { id: 'cs101', name: 'Rebuilt 2.0 Engineering', instructor: 'Google Deepmind Team' },
          { id: 'cs102', name: 'Autonomous Communication Bridges', instructor: 'Antigravity' }
        ]));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    const targetPort = 3995;
    await new Promise(r => targetServer.listen(targetPort, r));

    // 2. Start our Rebuilt Express Server on a test port
    const express = require('express');
    const localApp = express();
    localApp.use(express.json());

    const { CLONES_DIR } = require('../src/storage/clone-storage');
    const { applicationBridge } = require('../src/bridge/application-bridge');

    // Mount Communication Bridge route
    localApp.all('/api/bridge/clone/:id/*', applicationBridge.createMiddleware());

    // Mount Static Clones Directory
    localApp.use('/clones', express.static(CLONES_DIR));

    const localServerPort = 3996;
    const localHttpServer = await new Promise(r => {
      const s = localApp.listen(localServerPort, () => r(s));
    });

    const cloneId = `clone_phase4_test_${Date.now()}`;

    try {
      // 3. Create frontend clone with real dynamic fetch script
      const frontendHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Authorized Local Frontend</title>
          </head>
          <body>
            <h1>Local Frontend Clone</h1>
            <div id="status">Loading courses...</div>
            <ul id="courses-list"></ul>

            <script>
              window.__REBUILT_CLONE_ID__ = "${cloneId}";
              window.__REBUILT_ORIGINAL_ORIGIN__ = "http://localhost:${targetPort}";

              // Dynamic API request from local frontend
              fetch("/api/courses")
                .then(function(res) {
                  return res.json();
                })
                .then(function(courses) {
                  document.getElementById("status").innerText = "Loaded " + courses.length + " courses";
                  var list = document.getElementById("courses-list");
                  courses.forEach(function(c) {
                    var li = document.createElement("li");
                    li.textContent = c.id + ": " + c.name + " (" + c.instructor + ")";
                    list.appendChild(li);
                  });
                })
                .catch(function(err) {
                  document.getElementById("status").innerText = "Error: " + err.message;
                });
            </script>
          </body>
        </html>
      `;

      // Rewrite with Universal Preview Shield & Bridge connector
      const previewReadyHtml = rewriteHtmlForPreview(frontendHtml, `http://localhost:${targetPort}/`, {
        cloneId
      });

      // Save Clone with Manifest
      const manifest = {
        version: '2.0.0',
        targetOrigin: `http://localhost:${targetPort}`,
        frontend: { mode: 'local' },
        communication: { mode: 'bridge' },
        routes: [
          { method: 'GET', path: '/api/courses', mode: 'proxy', contentType: 'application/json' }
        ]
      };

      await saveClone({
        id: cloneId,
        originalUrl: `http://localhost:${targetPort}/`,
        finalUrl: `http://localhost:${targetPort}/`,
        title: 'Authorized Local Frontend',
        html: previewReadyHtml,
        manifest
      });

      // 4. Render the Local Clone using Playwright
      const localCloneUrl = `http://localhost:${localServerPort}/clones/${cloneId}/`;
      const renderResult = await renderPage(localCloneUrl, { timeout: 15000 });

      assert.ok(renderResult.html.includes('Loaded 2 courses'), 'Frontend must display "Loaded 2 courses" from target API');
      assert.ok(renderResult.html.includes('Rebuilt 2.0 Engineering'), 'Frontend must contain real course data');
      assert.ok(renderResult.html.includes('Autonomous Communication Bridges'), 'Frontend must contain second course data');
    } finally {
      delete process.env.ALLOW_LOCAL_TESTING;
      await deleteClone(cloneId).catch(() => {});
      targetServer.close();
      localHttpServer.close();
      await closeBrowser().catch(() => {});
    }
  });

  console.log('\n======================================================');
  console.log(`Results: ${testsPassed} of ${testsPassed + testsFailed} assertions passed.`);
  if (testsFailed === 0) {
    console.log('✓ ALL PHASE 4 TESTS PASSED!');
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
