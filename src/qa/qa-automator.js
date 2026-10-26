/**
 * Rebuilt Automated QA — In-Browser Autonomous Explorer
 * 
 * Safely navigates through local rebuilt clone screens, triggers progressive
 * lazy loading, tests interactive elements (buttons, tabs, accordions, modals, menus),
 * and collects rich runtime diagnostics (CORS, 4xx/5xx, missing fonts/assets, console exceptions).
 */

const fs = require('fs');
const path = require('path');
const { acquireContext, releaseContext } = require('../renderer/browser-pool');
const { normalizeUrl } = require('../crawler/url-utils');
const { getCloneDirPath } = require('../storage/clone-storage');

const DEFAULT_TIMEOUT_MS = 20000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Normalizes a URL to ensure it strictly targets the local clone preview space.
 * @param {string} urlStr
 * @param {string} localBase
 * @param {string} cloneId
 * @returns {string}
 */
function cleanLocalUrl(urlStr, localBase, cloneId) {
  try {
    const baseParsed = new URL(localBase);
    const parsed = new URL(urlStr, localBase);

    // Strictly enforce localhost and port
    parsed.protocol = baseParsed.protocol;
    parsed.host = baseParsed.host;

    // Strictly enforce /clones/:id prefix
    const clonePrefix = `/clones/${cloneId}`;
    if (!parsed.pathname.startsWith(clonePrefix)) {
      parsed.pathname = `${clonePrefix}/${parsed.pathname.replace(/^\/+/, '')}`;
    }

    parsed.hash = '';
    // Preserve trailing slash on paths (server serves both, no 301 redirect)
    return parsed.toString();
  } catch (_) {
    return urlStr;
  }
}

/**
 * Creates a filesystem-safe slug from a URL or title.
 * @param {string} str
 * @returns {string}
 */
function toSafeSlug(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'screen';
}

/**
 * Runs automated QA exploration on a local clone.
 * 
 * @param {object} params
 * @param {string} params.cloneId - Unique ID of the clone to audit
 * @param {number} [params.port=3000] - Local server port
 * @param {string} [params.targetOrigin] - Remote original target origin (e.g. https://www.apple.com)
 * @param {number} [params.maxDepth=2] - Traversal depth limit
 * @param {number} [params.maxPages=10] - Screen discovery limit
 * @param {number} [params.maxExecutionTime=60000] - Total exploration time budget in ms
 * @returns {Promise<{ rawEvents: Array<object>, metrics: object, screenshots: Array<string> }>}
 */
async function runQaAudit({
  cloneId,
  port = 3000,
  targetOrigin = '',
  maxDepth = 2,
  maxPages = 8,
  maxExecutionTime = 60000
}) {
  const startTime = Date.now();
  const localBase = `http://localhost:${port}/clones/${cloneId}/`;
  const cloneDir = getCloneDirPath(cloneId);
  const screenshotsDir = path.join(cloneDir, 'screenshots');
  const errorScreenshotsDir = path.join(screenshotsDir, 'errors');

  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
  if (!fs.existsSync(errorScreenshotsDir)) fs.mkdirSync(errorScreenshotsDir, { recursive: true });

  const rawEvents = [];
  const visitedUrls = new Set();
  const screenScreenshots = [];

  const metrics = {
    screensDiscovered: 0,
    screensTested: 0,
    linksTested: 0,
    buttonsTested: 0,
    tabsTested: 0,
    accordionsTested: 0,
    modalsTested: 0,
    imagesChecked: 0,
    fontsChecked: 0,
    cssChecked: 0,
    jsChecked: 0,
    apiRequestsChecked: 0
  };

  const queue = [{ url: localBase, depth: 0 }];
  visitedUrls.add(cleanLocalUrl(localBase, localBase, cloneId));

  // Use the shared browser pool context (avoids competing Chromium processes)
  let context = null;
  try {
    context = await acquireContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true
    });
  } catch (ctxErr) {
    console.warn(`[QAAutomator] Could not acquire browser context: ${ctxErr.message}`);
    return { rawEvents, metrics, screenshots: screenScreenshots };
  }

  try {
    let page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);

    // --- Reusable Telemetry Attachment ---
    function attachTelemetry(p) {
      p.on('requestfailed', (req) => {
        const errText = req.failure()?.errorText || 'Request failed';
        if (errText.includes('ERR_ABORTED') && ['document', 'media'].includes(req.resourceType())) return;
        rawEvents.push({
          category: 'requestfailed',
          url: req.url(),
          errorMessage: errText,
          resourceType: req.resourceType(),
          page: p.url()
        });
      });

      p.on('response', (res) => {
        const status = res.status();
        const type = res.request().resourceType();
        const url = res.url();
        if (type === 'image') metrics.imagesChecked++;
        else if (type === 'font') metrics.fontsChecked++;
        else if (type === 'stylesheet') metrics.cssChecked++;
        else if (type === 'script') metrics.jsChecked++;
        else if (['fetch', 'xhr'].includes(type) || url.includes('/api/')) metrics.apiRequestsChecked++;
        if (status >= 400) {
          rawEvents.push({
            category: 'http_error',
            url,
            statusCode: status,
            resourceType: type,
            page: p.url(),
            errorMessage: `HTTP ${status} on ${type}`
          });
        }
      });

      p.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (text.includes('favicon.ico') || text.includes('chrome-extension') || text.includes('/b/ss')) return;
          const loc = typeof msg.location === 'function' ? msg.location() : null;
          rawEvents.push({
            category: 'console_error',
            url: (loc && loc.url) || '',
            errorMessage: text,
            page: p.url()
          });
        }
      });

      p.on('pageerror', (err) => {
        rawEvents.push({
          category: 'page_error',
          errorMessage: err.message,
          page: p.url()
        });
      });
    }

    // Attach telemetry to initial page
    attachTelemetry(page);

    // --- Screen Crawl & Exploration Loop ---
    while (queue.length > 0 && metrics.screensTested < maxPages) {
      if (Date.now() - startTime > maxExecutionTime) {
        console.log(`[QAAutomator] Reached max execution time budget (${maxExecutionTime}ms). Wrapping up crawl.`);
        break;
      }

      const currentTask = queue.shift();
      const currentUrl = currentTask.url;
      const currentDepth = currentTask.depth;

      console.log(`[QAAutomator] 🔍 Visiting screen ${metrics.screensTested + 1}/${maxPages} (depth: ${currentDepth}): ${currentUrl}`);

      try {
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        metrics.screensTested++;
      } catch (navErr) {
        const errMsg = navErr.message || '';
        // Detect browser/context closed errors (pool context was recycled) and recover
        if (errMsg.includes('has been closed') || errMsg.includes('Target closed') || errMsg.includes('browser has been closed')) {
          console.warn(`[QAAutomator] Page context closed mid-crawl — creating fresh page and retrying: ${currentUrl}`);
          try {
            page = await context.newPage();
            page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
            page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
            attachTelemetry(page); // Re-attach all network/console listeners to new page
            await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
            metrics.screensTested++;
          } catch (retryErr) {
            rawEvents.push({
              category: 'navigation_error',
              url: currentUrl,
              errorMessage: `Navigation timeout or failure: ${retryErr.message}`,
              page: currentUrl,
              statusCode: 504
            });
            continue;
          }
        } else {
          rawEvents.push({
            category: 'navigation_error',
            url: currentUrl,
            errorMessage: `Navigation timeout or failure: ${errMsg}`,
            page: currentUrl,
            statusCode: 504
          });
          continue;
        }
      }

      // 1. Trigger Progressive Lazy Loading Scroll
      await scrollAndHydrateLazyContent(page);

      // 2. Discover Internal Links & Safe Client Routes
      if (currentDepth < maxDepth) {
        const discoveredLinks = await page.evaluate(({ cloneId, maxLinks }) => {
          const links = [];
          document.querySelectorAll('a[href]').forEach(a => {
            const rawHref = a.getAttribute('href') || '';
            if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
              return;
            }
            if (rawHref.startsWith('/') || rawHref.startsWith('./') || rawHref.includes('/clones/')) {
              links.push(rawHref);
            }
          });
          return Array.from(new Set(links)).slice(0, maxLinks);
        }, { cloneId, maxLinks: 15 });

        metrics.screensDiscovered += discoveredLinks.length;

        for (const rawHref of discoveredLinks) {
          let resolvedUrl;
          if (rawHref.includes(`/clones/${cloneId}`)) {
            const match = rawHref.match(new RegExp(`/clones/${cloneId}/?.*$`));
            resolvedUrl = `http://localhost:${port}${match[0]}`;
          } else {
            const cleanSub = rawHref.replace(/^\/+/, '').replace(/^\.\//, '');
            resolvedUrl = `http://localhost:${port}/clones/${cloneId}/${cleanSub}`;
          }
          const cleaned = cleanLocalUrl(resolvedUrl, localBase, cloneId);
          if (!visitedUrls.has(cleaned)) {
            visitedUrls.add(cleaned);
            queue.push({ url: cleaned, depth: currentDepth + 1 });
          }
        }
      }

      // 3. Capture Screen Screenshot
      const screenSlug = toSafeSlug(new URL(currentUrl).pathname.replace(`/clones/${cloneId}`, '') || 'home');
      const screenShotPath = path.join(screenshotsDir, `${screenSlug}.png`);
      try {
        await page.screenshot({ path: screenShotPath, fullPage: false });
        screenScreenshots.push(screenShotPath);
      } catch (_) {}

      // 4. Safely Test Interactive Elements
      await testInteractiveElements(page, rawEvents, metrics, errorScreenshotsDir, screenSlug);
    }

  } finally {
    await releaseContext(context).catch(() => {});
  }

  return {
    rawEvents,
    metrics,
    screenshots: screenScreenshots
  };
}

/**
 * Progressively scrolls the viewport to trigger IntersectionObserver,
 * lazy-loaded pictures, and interactive entrance animations.
 * 
 * @param {import('playwright').Page} page
 */
async function scrollAndHydrateLazyContent(page) {
  try {
    await page.evaluate(async () => {
      const maxScroll = Math.min(document.body.scrollHeight || 5000, 8000);
      window.scrollTo(0, Math.floor(maxScroll / 2));
      window.dispatchEvent(new Event('scroll'));
      await new Promise(r => setTimeout(r, 25));
      window.scrollTo(0, maxScroll);
      window.dispatchEvent(new Event('scroll'));
      await new Promise(r => setTimeout(r, 25));
      // Return to top for standard viewport testing
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event('scroll'));
    });
  } catch (_) {}
}

/**
 * Safely clicks and exercises buttons, tabs, accordions, and modals on the screen.
 * Never executes destructive forms or dangerous endpoints.
 * 
 * @param {import('playwright').Page} page
 * @param {Array<object>} rawEvents
 * @param {object} metrics
 * @param {string} errorScreenshotsDir
 * @param {string} screenSlug
 */
async function testInteractiveElements(page, rawEvents, metrics, errorScreenshotsDir, screenSlug) {
  // A. Tabs Testing
  try {
    const tabSelectors = [
      '[role="tab"]',
      '.tab-button',
      '.tab-link',
      '[data-tab]',
      '.nav-tabs > li > a'
    ];

    for (const sel of tabSelectors) {
      const tabs = await page.$$(sel);
      if (tabs.length > 0) {
        for (let i = 0; i < Math.min(tabs.length, 6); i++) {
          try {
            const isVisible = await tabs[i].isVisible();
            if (isVisible) {
              await tabs[i].click({ timeout: 1500 });
              metrics.tabsTested++;
              await page.waitForTimeout(100);
            }
          } catch (_) {}
        }
        break;
      }
    }
  } catch (_) {}

  // B. Accordions & <details> Testing
  try {
    const accordions = await page.$$('details > summary, .accordion-header, [data-accordion-trigger], .collapse-toggle');
    for (let i = 0; i < Math.min(accordions.length, 5); i++) {
      try {
        if (await accordions[i].isVisible()) {
          await accordions[i].click({ timeout: 1500 });
          metrics.accordionsTested++;
          await page.waitForTimeout(100);
        }
      } catch (_) {}
    }
  } catch (_) {}

  // C. Safe Non-Destructive Buttons
  try {
    const buttons = await page.$$('button:not([type="submit"]), [role="button"], .btn:not([type="submit"])');
    for (let i = 0; i < Math.min(buttons.length, 8); i++) {
      try {
        const text = (await buttons[i].innerText().catch(() => '')) || '';
        const lower = text.toLowerCase();

        // Strictly avoid destructive actions
        const isDestructive = lower.includes('delete') ||
                              lower.includes('remove') ||
                              lower.includes('checkout') ||
                              lower.includes('pay') ||
                              lower.includes('logout') ||
                              lower.includes('sign out') ||
                              lower.includes('unsubscribe');

        if (!isDestructive && (await buttons[i].isVisible())) {
          await buttons[i].click({ timeout: 1500 });
          metrics.buttonsTested++;
          await page.waitForTimeout(150);

          // If a modal or dialog opened, dismiss it
          const modalCloseBtn = await page.$('[aria-label*="close" i], .modal-close, .close-modal, .dialog-close');
          if (modalCloseBtn && (await modalCloseBtn.isVisible())) {
            await modalCloseBtn.click({ timeout: 1000 }).catch(() => {});
            metrics.modalsTested++;
          }
        }
      } catch (_) {}
    }
  } catch (_) {}

  // D. Safe Links Testing
  try {
    const localLinks = await page.$$('a[href^="#"], a[href^="?"]');
    for (let i = 0; i < Math.min(localLinks.length, 5); i++) {
      try {
        if (await localLinks[i].isVisible()) {
          await localLinks[i].click({ timeout: 1000 });
          metrics.linksTested++;
          await page.waitForTimeout(100);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

module.exports = {
  runQaAudit
};
