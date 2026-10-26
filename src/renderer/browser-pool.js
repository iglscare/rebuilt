/**
 * Persistent Warm Browser Pool for Rebuilt Web Cloner
 * Manages a singleton Chromium instance kept warm in memory,
 * allowing instant context and page creation (<30ms) instead of
 * cold-launching Chromium processes (~1500ms) on every clone.
 */

const os = require('os');
const { chromium } = require('playwright');

let browserInstance = null;
let launchPromise = null;
let isShuttingDown = false;

const cpuCount = Math.max(2, os.cpus() ? os.cpus().length : 4);

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
  '--disable-web-security=false',
  '--disable-blink-features=AutomationControlled',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-ipc-flooding-protection',
  '--disable-breakpad',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-extensions',
  '--disable-hang-monitor',
  '--disable-prompt-on-repost',
  '--disable-sync',
  '--force-color-profile=srgb',
  '--metrics-recording-only',
  '--no-first-run',
  '--password-store=basic',
  '--use-mock-keychain',
  // === GPU Hardware & Graphics Pipeline Acceleration ===
  '--enable-gpu',
  '--enable-gpu-rasterization',
  '--enable-zero-copy',
  '--enable-accelerated-2d-canvas',
  '--enable-accelerated-video-decode',
  '--enable-native-gpu-memory-buffers',
  '--gpu-memory-buffer-compositor-resources',
  '--force-gpu-mem-available-mb=4096',
  '--enable-features=CanvasOopRasterization,UseSkiaRenderer,WebAssemblySimd,ParallelDownloading,NetworkServiceInProcess2',
  // === CPU Multi-Threading & Process Concurrency Acceleration ===
  `--num-raster-threads=${cpuCount}`,
  `--renderer-process-limit=${Math.max(8, cpuCount * 4)}`
];

/**
 * Returns the singleton warm Chromium browser instance.
 * Automatically recovers and restarts if disconnected or crashed.
 * @returns {Promise<import('playwright').Browser>}
 */
async function getBrowser() {
  if (isShuttingDown) {
    throw new Error('Browser pool is shutting down.');
  }

  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  if (launchPromise) {
    return launchPromise;
  }

  launchPromise = (async () => {
    try {
      console.log('[BrowserPool] Launching warm Chromium instance with hardware & headless acceleration...');
      const startTime = Date.now();
      const browser = await chromium.launch({
        headless: true,
        args: CHROMIUM_ARGS
      });

      browser.on('disconnected', () => {
        console.warn('[BrowserPool] Chromium instance disconnected or crashed. Ready to re-launch on next request.');
        browserInstance = null;
        launchPromise = null;
      });

      browserInstance = browser;
      console.log(`[BrowserPool] Warm Chromium instance ready in ${Date.now() - startTime}ms.`);
      return browser;
    } catch (err) {
      console.error('[BrowserPool] Failed to launch Chromium:', err);
      browserInstance = null;
      throw err;
    } finally {
      launchPromise = null;
    }
  })();

  return launchPromise;
}

/**
 * Warms up the browser in the background. Does not throw if it fails.
 */
function warmupBrowser() {
  getBrowser().catch((err) => {
    console.warn('[BrowserPool] Background warmup warning:', err.message);
  });
}

/**
 * Creates and configures a lightweight, isolated browser context on the warm browser.
 * Takes ~20ms compared to 1500ms for a full launch.
 *
 * @param {object} contextOptions - Playwright context options
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function acquireContext(contextOptions = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext(contextOptions);

  // Evade bot detection and preserve WebGL drawing buffers
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    } catch (_) {}

    try {
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, attributes) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
          attributes = Object.assign({}, attributes, { preserveDrawingBuffer: true });
        }
        return origGetContext.call(this, type, attributes);
      };
    } catch (_) {}
  });

  return context;
}

/**
 * Safely releases (closes) an ephemeral browser context.
 *
 * @param {import('playwright').BrowserContext} context
 */
async function releaseContext(context) {
  if (!context) return;
  try {
    await context.close();
  } catch (_) {}
}

/**
 * Gracefully shuts down the warm browser.
 */
async function closeBrowser() {
  isShuttingDown = true;
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (_) {}
    browserInstance = null;
  }
}

// Register process exit listeners for clean lifecycle
const cleanupHandler = () => {
  if (browserInstance) {
    browserInstance.close().catch(() => {});
    browserInstance = null;
  }
};

process.once('SIGINT', cleanupHandler);
process.once('SIGTERM', cleanupHandler);
process.once('exit', cleanupHandler);

module.exports = {
  getBrowser,
  acquireContext,
  releaseContext,
  warmupBrowser,
  closeBrowser,
  cpuCount,
  CHROMIUM_ARGS
};
