/**
 * Rebuilt Subpage Pre-Warmer
 *
 * Pre-renders all discovered internal subpage links to disk BEFORE QA starts.
 * This ensures QA navigation loads from local filesystem (~50ms) instead of
 * triggering on-demand Playwright renders mid-crawl (~15-40s each).
 *
 * Works for both single-page and multi-page clones.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { getCloneDirPath } = require('../storage/clone-storage');

const CONCURRENCY = 2;
const PAGE_TIMEOUT_MS = 6000;
const MAX_SUBPAGES = 12;

/**
 * Finds the root index.html for a clone.
 * Single-page: <cloneDir>/index.html
 * Multi-page:  may be in <cloneDir>/clones/index.html or a subdirectory
 */
function findRootIndexHtml(cloneDir) {
  const direct = path.join(cloneDir, 'index.html');
  if (fs.existsSync(direct)) return direct;

  // Multi-page clones: search one level deep
  try {
    const entries = fs.readdirSync(cloneDir);
    for (const entry of entries) {
      if (entry === 'assets' || entry === 'screenshots') continue;
      const candidate = path.join(cloneDir, entry, 'index.html');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch (_) {}
  return null;
}

/**
 * Extracts unique subpage paths from a cloned HTML file.
 * Handles rewritten local paths (/clones/:id/en/about) and raw paths (/en/about).
 *
 * @param {string} html
 * @param {string} cloneId
 * @param {string} targetOrigin  e.g. "https://www.bugatti.com"
 * @returns {string[]}  clean relative subpaths e.g. ["en/about", "en/models/chiron"]
 */
function extractSubpagePaths(html, cloneId, targetOrigin) {
  const seen = new Set();
  const results = [];
  const clonePrefix = `/clones/${cloneId}/`;

  const hrefRe = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    let href = m[1].trim();
    if (!href) continue;
    if (/^(mailto:|tel:|javascript:|data:|#)/.test(href)) continue;

    let subpath = '';

    if (href.startsWith(clonePrefix)) {
      // Rewritten local: /clones/:id/en/about/careers
      subpath = href.slice(clonePrefix.length);
    } else if (href.startsWith('/clones/')) {
      continue; // Another clone's link
    } else if (href.startsWith(targetOrigin)) {
      // Absolute target origin URL
      subpath = href.slice(targetOrigin.length).replace(/^\/+/, '');
    } else if (href.startsWith('/') && !href.startsWith('//')) {
      // Root-relative on target site
      subpath = href.replace(/^\/+/, '');
    } else if (!href.startsWith('http') && !href.startsWith('//')) {
      subpath = href;
    } else {
      continue; // External link
    }

    // Clean up
    subpath = subpath.split('?')[0].split('#')[0].replace(/\/+$/, '').trim();
    if (!subpath) continue;
    // Skip assets
    if (/\.(css|js|png|jpe?g|gif|svg|webp|ico|mp4|webm|woff2?|ttf|eot|otf|json|wasm)$/i.test(subpath)) continue;
    // Skip "clones" prefix (leftover from rewriting)
    if (subpath === 'clones' || subpath.startsWith('clones/')) continue;
    // Skip single-segment fragments that look like IDs
    if (/^[a-f0-9]{6,}$/.test(subpath)) continue;

    if (!seen.has(subpath)) {
      seen.add(subpath);
      results.push(subpath);
    }
  }
  return results;
}

function httpGet(url, timeoutMs = PAGE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
        res.on('error', () => resolve(0));
      });
      req.on('error', () => resolve(0));
      req.on('timeout', () => { req.destroy(); resolve(0); });
    } catch (_) { resolve(0); }
  });
}

async function waitForFile(filePath, timeoutMs = 8000) {
  const start = Date.now();
  let delay = 200;
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return true;
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 2000);
  }
  return false;
}

/**
 * Pre-warms all discovered subpages for a clone by triggering on-demand renders
 * and waiting for disk saves. Uses parallel batches of CONCURRENCY.
 */
async function prewarmSubpages({ cloneId, port = 3000, targetOrigin, maxSubpages = MAX_SUBPAGES }) {
  const cloneDir = getCloneDirPath(cloneId);
  const indexPath = findRootIndexHtml(cloneDir);

  if (!indexPath) {
    console.warn(`[Prewarmer] No index.html found for clone ${cloneId}. Skipping pre-warm.`);
    return { prewarmed: 0, failed: 0, paths: [] };
  }

  console.log(`[Prewarmer] Reading index from: ${indexPath}`);
  const html = fs.readFileSync(indexPath, 'utf8');
  const links = extractSubpagePaths(html, cloneId, targetOrigin).slice(0, maxSubpages);

  if (links.length === 0) {
    console.log(`[Prewarmer] No internal subpage links found. Nothing to pre-warm.`);
    return { prewarmed: 0, failed: 0, paths: [] };
  }

  console.log(`\n[Prewarmer] 🔥 Pre-warming ${links.length} subpage(s) on port ${port}...`);

  let prewarmed = 0, failed = 0;
  const prewarmedPaths = [];

  for (let i = 0; i < links.length; i += CONCURRENCY) {
    const batch = links.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (subpath) => {
      const localUrl = `http://localhost:${port}/clones/${cloneId}/${subpath}`;
      const savedFilePath = path.join(cloneDir, subpath, 'index.html');

      if (fs.existsSync(savedFilePath)) {
        console.log(`[Prewarmer] ✅ Cached: ${subpath}`);
        prewarmed++;
        prewarmedPaths.push(savedFilePath);
        return;
      }

      console.log(`[Prewarmer] 🌐 Rendering: ${subpath}`);
      const status = await httpGet(localUrl, PAGE_TIMEOUT_MS);

      if (status >= 200 && status < 400) {
        const saved = await waitForFile(savedFilePath, 8000);
        if (saved) {
          console.log(`[Prewarmer] ✅ Saved: ${subpath} (HTTP ${status})`);
          prewarmed++;
          prewarmedPaths.push(savedFilePath);
        } else {
          console.log(`[Prewarmer] ⚠️  Served (HTTP ${status}) but not yet on disk: ${subpath}`);
          prewarmed++; // Server renders it live on next QA visit
        }
      } else {
        console.log(`[Prewarmer] ❌ Failed (HTTP ${status}): ${subpath}`);
        failed++;
      }
    }));
  }

  console.log(`[Prewarmer] 🏁 Done: ${prewarmed}/${links.length} ready, ${failed} failed.\n`);
  return { prewarmed, failed, paths: prewarmedPaths };
}

module.exports = { prewarmSubpages, extractSubpagePaths };
