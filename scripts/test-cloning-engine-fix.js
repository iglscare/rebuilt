/**
 * Rebuilt Web Cloner — Engine Fix & Upgrade Verification Test
 * 
 * Tests:
 * 1. Resource manifest generation & lookups
 * 2. Server proxy manifest resolution without dummy module placeholder
 * 3. Event listener non-interference (bubble phase, click & submit handlers)
 * 4. Video hydration (controlled vs ambient background videos, poster fadeout)
 * 5. Side-by-side clone verifier execution and report generation
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const { CHROMIUM_ARGS, cpuCount } = require('../src/renderer/browser-pool');
const {
  downloadAndRewriteAssets,
  getMimeType,
  categorizeAsset,
  DYNAMIC_DOWNLOAD_CONCURRENCY,
  keepAliveHttpAgent,
  keepAliveHttpsAgent
} = require('../src/downloader/asset-downloader');
const { DEFAULT_CONCURRENCY, MAX_PRELOAD_PAGES } = require('../src/crawler/autonomous-preload-swarm');
const { livePageRamCache, getLivePageRamCache, setLivePageRamCache } = require('../server');
const { rewriteHtmlForPreview, REBUILT_SHIELD_SCRIPT } = require('../src/rewriter/html-rewriter');
const { verifyClone } = require('../src/qa/clone-verifier');
const { saveClone, getCloneDirPath } = require('../src/storage/clone-storage');

async function runTests() {
  console.log('\n======================================================');
  console.log('   ReBuilt Web Cloner — Engine Fix Verification Test');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  function test(desc, fn) {
    total++;
    process.stdout.write(`  Testing: ${desc} ... `);
    try {
      fn();
      console.log('✓ PASSED');
      passed++;
    } catch (e) {
      console.log('✗ FAILED');
      console.error('   ', e.message);
    }
  }

  async function testAsync(desc, fn) {
    total++;
    process.stdout.write(`  Testing: ${desc} ... `);
    try {
      await fn();
      console.log('✓ PASSED');
      passed++;
    } catch (e) {
      console.log('✗ FAILED');
      console.error('   ', e.message);
    }
  }

  console.log('[Suite 1: Resource Manifest & MIME Resolution]');
  test('getMimeType resolves standard and streaming media types', () => {
    assert.strictEqual(getMimeType('video.mp4'), 'video/mp4');
    assert.strictEqual(getMimeType('stream.m3u8'), 'application/vnd.apple.mpegurl');
    assert.strictEqual(getMimeType('segment.ts'), 'video/mp2t');
    assert.strictEqual(getMimeType('subtitles.vtt'), 'text/vtt');
    assert.strictEqual(getMimeType('styles.css'), 'text/css; charset=utf-8');
    assert.strictEqual(getMimeType('app.mjs'), 'application/javascript; charset=utf-8');
  });

  await testAsync('downloadAndRewriteAssets generates and persists resource-manifest.json', async () => {
    const testCloneDir = path.join(__dirname, '../data/clones/test_engine_fix_' + Date.now());
    fs.mkdirSync(testCloneDir, { recursive: true });

    const sampleHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <link rel="stylesheet" href="https://example.com/assets/theme.css">
        <script src="https://example.com/assets/bundle.js"></script>
      </head>
      <body>
        <img src="https://example.com/images/hero.png" alt="Hero">
        <video controls src="https://example.com/media/presentation.mp4" poster="https://example.com/images/poster.jpg">
          <track kind="subtitles" src="https://example.com/media/captions.vtt" srclang="en">
        </video>
      </body>
      </html>
    `;

    const networkAssets = new Map();
    networkAssets.set('https://example.com/assets/theme.css', {
      type: 'stylesheet',
      contentType: 'text/css',
      buffer: Buffer.from('body { color: red; }')
    });
    networkAssets.set('https://example.com/assets/bundle.js', {
      type: 'script',
      contentType: 'application/javascript',
      buffer: Buffer.from('console.log("ready");')
    });

    const result = await downloadAndRewriteAssets({
      cloneDir: testCloneDir,
      html: sampleHtml,
      baseOrigin: 'https://example.com',
      depth: 0,
      networkAssets
    });

    assert.ok(result.manifest, 'Result must include manifest object');
    assert.ok(result.manifest.lookupByLocalPath, 'Manifest must include lookupByLocalPath');
    assert.ok(result.manifest.lookupByOriginalUrl, 'Manifest must include lookupByOriginalUrl');

    const manifestOnDiskPath = path.join(testCloneDir, 'resource-manifest.json');
    assert.ok(fs.existsSync(manifestOnDiskPath), 'resource-manifest.json must be written to cloneDir');

    const loadedManifest = JSON.parse(fs.readFileSync(manifestOnDiskPath, 'utf8'));
    assert.ok(loadedManifest.lookupByOriginalUrl['https://example.com/assets/theme.css'], 'Theme CSS must be recorded');
    assert.strictEqual(loadedManifest.lookupByOriginalUrl['https://example.com/assets/theme.css'].status, 'downloaded');

    // Clean up test clone dir
    fs.rmSync(testCloneDir, { recursive: true, force: true });
  });

  console.log('\n[Suite 2: Event Shield & Form Interception Fixes]');
  test('REBUILT_SHIELD_SCRIPT uses bubble phase and respects e.defaultPrevented', () => {
    const html = rewriteHtmlForPreview('<html><head></head><body><button id="btn">Click</button></body></html>', 'https://example.com', { cloneId: 'test_123' });
    assert.ok(html.includes("document.addEventListener('click', function(e) {"), 'Click listener must be present');
    assert.ok(html.includes("if (e.defaultPrevented) return;"), 'Click listener must check e.defaultPrevented');
    assert.ok(html.includes("}, false);"), 'Click listener must be in bubble phase (false)');
    assert.ok(html.includes("document.addEventListener('submit', handleFormSubmit, false);"), 'Submit listener must be in bubble phase (false)');
  });

  test('Observable login forms are identified and safely emitted in preview', () => {
    const html = rewriteHtmlForPreview('<html><head></head><body><form action="/login" method="POST"><input type="password"></form></body></html>', 'https://example.com', { cloneId: 'test_123' });
    assert.ok(html.includes("isLoginForm"), 'Form submit handler must detect login forms');
    assert.ok(html.includes("LOGIN_ACTION"), 'Login action must be emitted for observation');
    assert.ok(html.includes("Login submitted (Interactive preview mode)"), 'Preview mode toast must be shown');
  });

  console.log('\n[Suite 3: HTML5 Video & Presentation Animation Fixes]');
  test('Controlled videos do not get forced autoplay loop', () => {
    const html = rewriteHtmlForPreview('<html><head></head><body><video controls src="/video.mp4"></video></body></html>', 'https://example.com', { cloneId: 'test_123' });
    assert.ok(html.includes("isControlled = v.hasAttribute('controls')"), 'Video hydrator must check for controls');
    assert.ok(html.includes("if (!isControlled)"), 'Only uncontrolled videos get autoplay loop');
    assert.ok(html.includes("v.addEventListener('playing'"), 'Poster start-frame must fade out on video playing');
  });

  console.log('\n[Suite 4: Automated Clone Verifier]');
  await testAsync('verifyClone produces comprehensive side-by-side diagnostic report', async () => {
    // Create a mock clone directory
    const testCloneId = 'test_verifier_' + Date.now();
    const testCloneDir = getCloneDirPath(testCloneId);
    fs.mkdirSync(testCloneDir, { recursive: true });

    const testHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head><title>Test Verified Clone</title></head>
      <body>
        <header>
          <nav>
            <a href="/about">About</a>
            <button id="nav-btn" class="btn">Menu</button>
          </nav>
        </header>
        <main>
          <h1>Welcome to Test Clone</h1>
          <video controls poster="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA=" src="data:video/mp4;base64,AAAA"></video>
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA=" alt="Test">
        </main>
      </body>
      </html>
    `;

    await saveClone({
      id: testCloneId,
      originalUrl: 'https://example.com',
      finalUrl: 'https://example.com',
      title: 'Test Verified Clone',
      html: testHtml,
      renderTimeMs: 100,
      byteSize: testHtml.length
    });

    const report = await verifyClone({
      originalUrl: 'https://example.com',
      cloneId: testCloneId,
      port: 3000
    });

    assert.ok(report, 'Verification report must be generated');
    assert.ok(typeof report.fidelityScore === 'number', 'fidelityScore must be a number');
    assert.ok(report.fidelityScore >= 0 && report.fidelityScore <= 100, 'fidelityScore must be 0-100');
    assert.ok(Array.isArray(report.workingFeatures), 'workingFeatures must be an array');
    assert.ok(report.comparison && report.comparison.clone, 'comparison.clone must be present');
    assert.ok(fs.existsSync(path.join(testCloneDir, 'verification/verification-report.json')), 'verification-report.json must be saved on disk');

    // Clean up
    fs.rmSync(testCloneDir, { recursive: true, force: true });
  });

  console.log('\n[Suite 5: Network, GPU & CPU Multithreading Acceleration]');
  test('Chromium browser pool configures GPU hardware acceleration flags', () => {
    assert.ok(CHROMIUM_ARGS.includes('--enable-gpu'), 'must enable GPU');
    assert.ok(CHROMIUM_ARGS.includes('--enable-gpu-rasterization'), 'must enable GPU rasterization');
    assert.ok(CHROMIUM_ARGS.includes('--enable-zero-copy'), 'must enable zero copy');
    assert.ok(CHROMIUM_ARGS.includes('--enable-accelerated-2d-canvas'), 'must enable 2d canvas acceleration');
    assert.ok(CHROMIUM_ARGS.includes('--enable-accelerated-video-decode'), 'must enable video decode acceleration');
    assert.ok(CHROMIUM_ARGS.some(a => a.startsWith('--num-raster-threads=')), 'must configure raster threads');
  });

  test('CSS layer promotion applies hardware GPU compositing to media surfaces', () => {
    assert.ok(REBUILT_SHIELD_SCRIPT.includes('transform: translateZ(0)'), 'must promote video/canvas with translateZ');
    assert.ok(REBUILT_SHIELD_SCRIPT.includes('will-change: transform, opacity'), 'must declare will-change for compositor');
    assert.ok(REBUILT_SHIELD_SCRIPT.includes('backface-visibility: hidden'), 'must include backface-visibility for GPU layer');
  });

  test('CPU multithreading scales download concurrency and swarm workers to CPU cores', () => {
    assert.ok(typeof cpuCount === 'number' && cpuCount >= 2, 'cpuCount must be valid');
    assert.ok(DYNAMIC_DOWNLOAD_CONCURRENCY >= 32, 'download worker pool must scale to >= 32 workers');
    assert.ok(DEFAULT_CONCURRENCY >= 4, 'preload swarm concurrency must scale to >= 4 workers');
    assert.strictEqual(MAX_PRELOAD_PAGES, 30, 'max preload pages must be 30');
  });

  test('Network acceleration configures high-capacity keep-alive socket pools', () => {
    assert.strictEqual(keepAliveHttpAgent.maxSockets, 128, 'HTTP agent maxSockets must be 128');
    assert.strictEqual(keepAliveHttpAgent.maxFreeSockets, 64, 'HTTP agent maxFreeSockets must be 64');
    assert.strictEqual(keepAliveHttpsAgent.maxSockets, 128, 'HTTPS agent maxSockets must be 128');
    assert.strictEqual(keepAliveHttpsAgent.maxFreeSockets, 64, 'HTTPS agent maxFreeSockets must be 64');
  });

  test('Live-time in-memory RAM page cache enables sub-millisecond retrieval', () => {
    const testClone = 'test_accel_' + Date.now();
    const testSubpath = 'pricing/enterprise';
    const testHtml = '<html><body><h1>Enterprise Plan Live</h1></body></html>';

    assert.strictEqual(getLivePageRamCache(testClone, testSubpath), null, 'must be null before caching');
    setLivePageRamCache(testClone, testSubpath, testHtml);
    const cached = getLivePageRamCache(testClone, testSubpath);
    assert.strictEqual(cached, testHtml, 'must retrieve exact cached HTML instantly from RAM');
  });

  test('Speculative preloader injects native link prefetch into document head', () => {
    assert.ok(REBUILT_SHIELD_SCRIPT.includes("prefetchLink.rel = 'prefetch'"), 'must create native link prefetch');
    assert.ok(REBUILT_SHIELD_SCRIPT.includes("prerenderLink.rel = 'prerender'"), 'must create native link prerender');
    assert.ok(REBUILT_SHIELD_SCRIPT.includes('document.head.appendChild(prefetchLink)'), 'must append prefetch to document.head');
  });

  test('Video hydration applies GPU acceleration, preload auto, and resilient proxy fallback', () => {
    assert.ok(REBUILT_SHIELD_SCRIPT.includes("v.setAttribute('preload', 'auto')"), 'must set preload auto');
    assert.ok(REBUILT_SHIELD_SCRIPT.includes("v.setAttribute('data-gpu-accelerated', 'true')"), 'must set data-gpu-accelerated');
    assert.ok(REBUILT_SHIELD_SCRIPT.includes("v.setAttribute('crossorigin', 'anonymous')"), 'must set crossorigin anonymous for scrubber sync');
    assert.ok(REBUILT_SHIELD_SCRIPT.includes("v.addEventListener('error'"), 'must have error listener with proxy fallback');
    assert.ok(REBUILT_SHIELD_SCRIPT.includes("rebuilt:video-seeked"), 'must dispatch rebuilt:video-seeked for interactive animations');
  });

  test('Interactive engine supports universal dynamic components (modals, tabs, carousels)', () => {
    assert.ok(REBUILT_SHIELD_SCRIPT.includes('K2.75: Modal Dismiss'), 'must support modal close buttons');
    assert.ok(REBUILT_SHIELD_SCRIPT.includes('K2.85: Tabs & Tabbed Navigation'), 'must support tabs and tabbed navigation');
    assert.ok(REBUILT_SHIELD_SCRIPT.includes('K2.9: Carousel / Slider Controls'), 'must support carousel and slider controls');
  });

  console.log('\n======================================================');
  console.log(`Results: ${passed} of ${total} assertions passed.`);
  if (passed === total) {
    console.log('✓ ALL ENGINE FIX AND VERIFICATION TESTS PASSED!');
    console.log('======================================================\n');
    process.exit(0);
  } else {
    console.error(`✗ ${total - passed} assertion(s) failed.`);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
