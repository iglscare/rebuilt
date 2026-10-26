/**
 * Autonomous Background Preload Swarm
 * 
 * Automatically discovers all interactive buttons, hyperlinks, dropdown menus,
 * and navigation routes from the initial cloned page, and preloads them in the
 * background so that whenever the user clicks ANY button or link, the target page
 * is ALREADY sitting on local disk and loads instantly.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { getClone, getCloneDirPath, saveCloneMetadata } = require('../storage/clone-storage');
const { communicationBridge } = require('../bridge/communication-bridge');
const { tunnelService } = require('../tunnel/tunnel-service');

const cpuCount = Math.max(2, os.cpus() ? os.cpus().length : 4);
const DEFAULT_CONCURRENCY = Math.max(4, Math.min(16, cpuCount * 2));
const MAX_PRELOAD_PAGES = 30;
const PRELOAD_TIMEOUT_MS = 6000;

// In-memory swarm tracking registry
const activeSwarms = new Map();

/**
 * Extracts and prioritizes all interactive links, buttons, and navigation targets from HTML.
 *
 * @param {string} html
 * @param {string} cloneId
 * @param {string} targetOrigin e.g. "https://www.example.com"
 * @returns {Array<{ path: string, type: 'nav'|'button'|'link'|'footer', priority: number }>}
 */
function extractInteractiveTargets(html, cloneId, targetOrigin) {
  if (!html || typeof html !== 'string') return [];

  const seen = new Set();
  const targets = [];
  const clonePrefix = `/clones/${cloneId}/`;

  // 1. Helper to clean subpath
  function cleanSubpath(rawHref) {
    if (!rawHref) return null;
    let href = rawHref.trim();
    if (!href || /^(mailto:|tel:|sms:|callto:|fax:|javascript:|data:|blob:|#)/i.test(href)) return null;

    let subpath = '';
    if (href.startsWith(clonePrefix)) {
      subpath = href.slice(clonePrefix.length);
    } else if (href.startsWith('/clones/')) {
      return null; // Another clone
    } else if (targetOrigin && href.startsWith(targetOrigin)) {
      subpath = href.slice(targetOrigin.length).replace(/^\/+/, '');
    } else if (href.startsWith('/') && !href.startsWith('//')) {
      subpath = href.replace(/^\/+/, '');
    } else if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//')) {
      subpath = href;
    } else {
      return null;
    }

    subpath = subpath.split('?')[0].split('#')[0].replace(/\/+$/, '').trim();
    if (!subpath || /^(mailto:|tel:|sms:|callto:|fax:|javascript:|data:|blob:)/i.test(subpath)) return null;
    if (/\.(css|js|png|jpe?g|gif|svg|webp|ico|mp4|webm|woff2?|ttf|eot|otf|json|wasm)$/i.test(subpath)) return null;
    if (subpath === 'clones' || subpath.startsWith('clones/')) return null;
    if (/^[a-f0-9]{6,}$/.test(subpath)) return null;

    return subpath;
  }

  // 2. Extract Navigation & Header links (Priority 100)
  const navSectionRegex = /<(nav|header)[^>]*>([\s\S]*?)<\/\1>/gi;
  let navMatch;
  while ((navMatch = navSectionRegex.exec(html)) !== null) {
    const navContent = navMatch[2];
    const hrefRe = /href=["']([^"']+)["']/gi;
    let m;
    while ((m = hrefRe.exec(navContent)) !== null) {
      const clean = cleanSubpath(m[1]);
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        targets.push({ path: clean, type: 'nav', priority: 100 });
      }
    }
  }

  // 3. Extract Interactive Buttons (Priority 80)
  // Look for buttons or anchor tags styled as buttons or with click actions
  const buttonRegex = /<(?:button|a)[^>]*(?:class=["'][^"']*(?:btn|button|cta|action|link)[^"']*["']|role=["']button["']|data-href=["']([^"']+)["']|data-url=["']([^"']+)["']|onclick=["'][^"']*['"])[^>]*>/gi;
  let btnMatch;
  while ((btnMatch = buttonRegex.exec(html)) !== null) {
    const tag = btnMatch[0];
    const dataHref = btnMatch[1] || btnMatch[2];
    let linkCandidate = dataHref;

    if (!linkCandidate) {
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
      if (hrefMatch) linkCandidate = hrefMatch[1];
    }

    if (linkCandidate) {
      const clean = cleanSubpath(linkCandidate);
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        targets.push({ path: clean, type: 'button', priority: 80 });
      }
    }
  }

  // 4. Extract all other general hyperlinks <a> (Priority 50, or 20 for footer)
  const isFooterLink = (idx) => {
    const footerIdx = html.toLowerCase().indexOf('<footer');
    return footerIdx !== -1 && idx > footerIdx;
  };

  const generalHrefRegex = /href=["']([^"']+)["']/gi;
  let genMatch;
  while ((genMatch = generalHrefRegex.exec(html)) !== null) {
    const clean = cleanSubpath(genMatch[1]);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      const isFoot = isFooterLink(genMatch.index);
      targets.push({
        path: clean,
        type: isFoot ? 'footer' : 'link',
        priority: isFoot ? 20 : 50
      });
    }
  }

  // Sort descending by priority
  targets.sort((a, b) => b.priority - a.priority);
  return targets;
}

/**
 * Sends a lightweight HTTP GET request to the local server to trigger on-demand page cloner.
 */
function requestLocalPage(url, timeoutMs = PRELOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
        res.on('error', () => resolve(0));
      });
      req.on('error', () => resolve(0));
      req.on('timeout', () => {
        req.destroy();
        resolve(0);
      });
    } catch (_) {
      resolve(0);
    }
  });
}

/**
 * Starts the Autonomous Background Preload Swarm for a given clone ID.
 * Runs non-blocking in background.
 *
 * @param {string} cloneId
 * @param {object} [options]
 * @param {number} [options.port=3000]
 * @param {string} [options.targetOrigin]
 * @param {number} [options.maxPages=30]
 * @param {number} [options.concurrency=3]
 * @returns {object} Initial swarm state handle
 */
function startAutonomousPreloadSwarm(cloneId, options = {}) {
  const port = options.port || parseInt(process.env.ACTIVE_PORT || '3000', 10);
  const maxPages = Math.min(options.maxPages || MAX_PRELOAD_PAGES, 50);
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY;

  if (activeSwarms.has(cloneId)) {
    console.log(`[PreloadSwarm] Swarm already running for clone ${cloneId}`);
    return activeSwarms.get(cloneId);
  }

  const swarmState = {
    cloneId,
    status: 'initializing',
    startedAt: Date.now(),
    totalTargets: 0,
    preloadedCount: 0,
    failedCount: 0,
    preloadedPages: [],
    queue: [],
    completed: false
  };

  activeSwarms.set(cloneId, swarmState);

  // Run in background asynchronously (non-blocking)
  setImmediate(async () => {
    try {
      const cloneDir = getCloneDirPath(cloneId);
      const indexPath = path.join(cloneDir, 'index.html');

      if (!fs.existsSync(indexPath)) {
        console.warn(`[PreloadSwarm] No root index.html found at ${indexPath} for clone ${cloneId}`);
        swarmState.status = 'error';
        return;
      }

      const metadata = await getClone(cloneId);
      const targetOrigin = options.targetOrigin ||
        (metadata && metadata.finalUrl ? new URL(metadata.finalUrl).origin :
        (metadata && metadata.originalUrl ? new URL(metadata.originalUrl).origin : ''));

      console.log(`\n======================================================`);
      console.log(`  🐝 Autonomous Background Preload Swarm Starting     `);
      console.log(`  Clone ID:   ${cloneId}                              `);
      console.log(`  Target:     ${targetOrigin}                         `);
      console.log(`  Local Host:  http://localhost:${port}/clones/${cloneId}/ `);
      const publicBase = tunnelService.getPublicUrl();
      if (publicBase) {
        console.log(`  Public Live: ${publicBase}/clones/${cloneId}/ `);
      }
      console.log(`======================================================\n`);

      const rootHtml = fs.readFileSync(indexPath, 'utf8');
      const allTargets = extractInteractiveTargets(rootHtml, cloneId, targetOrigin);
      const queue = allTargets.slice(0, maxPages);

      swarmState.status = 'running';
      swarmState.totalTargets = queue.length;
      swarmState.queue = queue.map(t => t.path);

      console.log(`[PreloadSwarm] 🎯 Discovered ${allTargets.length} interactive targets (buttons/links). Preloading top ${queue.length}...`);

      communicationBridge.broadcast('swarm:started', {
        cloneId,
        totalTargets: queue.length,
        targets: queue.map(t => ({ path: t.path, type: t.type }))
      });

      if (queue.length === 0) {
        swarmState.status = 'completed';
        swarmState.completed = true;
        communicationBridge.broadcast('swarm:completed', {
          cloneId,
          preloadedCount: 0,
          failedCount: 0,
          totalTime: '0.0'
        });
        return;
      }

      // Concurrency worker loop
      let cursor = 0;
      async function worker(workerId) {
        while (cursor < queue.length) {
          const item = queue[cursor++];
          if (!item) break;

          const subpath = item.path;
          const localUrl = `http://localhost:${port}/clones/${cloneId}/${subpath}`;
          const localDiskFile = path.join(cloneDir, subpath, 'index.html');

          if (fs.existsSync(localDiskFile)) {
            console.log(`[PreloadSwarm] ⚡ Worker ${workerId} -> Already cached: ${subpath}`);
            swarmState.preloadedCount++;
            swarmState.preloadedPages.push(subpath);
            communicationBridge.broadcast('swarm:target_ready', {
              cloneId,
              path: subpath,
              status: 200,
              cached: true,
              preloadedCount: swarmState.preloadedCount,
              totalTargets: queue.length
            });
            continue;
          }

          const t0 = Date.now();
          console.log(`[PreloadSwarm] 🌐 Worker ${workerId} preloading [${item.type.toUpperCase()}]: "${subpath}"...`);

          communicationBridge.broadcast('swarm:preloading', {
            cloneId,
            path: subpath,
            type: item.type,
            progress: `${cursor}/${queue.length}`
          });

          const statusCode = await requestLocalPage(localUrl, PRELOAD_TIMEOUT_MS);
          const dur = ((Date.now() - t0) / 1000).toFixed(1);

          if (statusCode >= 200 && statusCode < 400) {
            console.log(`[PreloadSwarm] ✅ Preloaded button/link "${subpath}" in ${dur}s (HTTP ${statusCode}) [${swarmState.preloadedCount + 1}/${queue.length}]`);
            swarmState.preloadedCount++;
            swarmState.preloadedPages.push(subpath);
            communicationBridge.broadcast('swarm:target_ready', {
              cloneId,
              path: subpath,
              status: statusCode,
              cached: false,
              preloadedCount: swarmState.preloadedCount,
              totalTargets: queue.length
            });
          } else {
            console.warn(`[PreloadSwarm] ⚠️ Preload failed for "${subpath}" (HTTP ${statusCode}) after ${dur}s`);
            swarmState.failedCount++;
          }
        }
      }

      // Launch worker pool
      const workers = [];
      const numWorkers = Math.min(concurrency, queue.length);
      for (let i = 1; i <= numWorkers; i++) {
        workers.push(worker(i));
      }

      await Promise.all(workers);

      swarmState.status = 'completed';
      swarmState.completed = true;
      const totalTime = ((Date.now() - swarmState.startedAt) / 1000).toFixed(1);
      console.log(`\n[PreloadSwarm] 🎉 Preload Swarm Completed for clone ${cloneId}: ${swarmState.preloadedCount} buttons & links preloaded in ${totalTime}s! All pages ready on disk.\n`);

      communicationBridge.broadcast('swarm:completed', {
        cloneId,
        preloadedCount: swarmState.preloadedCount,
        failedCount: swarmState.failedCount,
        totalTime
      });

      // Post-Preload: Trigger Background QA & Self-Repair verification
      try {
        const { orchestrateQaAndRepair } = require('../qa/qa-orchestrator');
        console.log(`[PreloadSwarm] 🔬 Triggering background QA certification for ${cloneId}...`);
        orchestrateQaAndRepair(cloneId, { port, maxIterations: 2, maxPages: 10 })
          .then(qaReport => {
            console.log(`[PreloadSwarm] 🛡️  Background QA finished: Status = ${qaReport.status}, Auto-repaired = ${qaReport.automaticallyRepaired}`);
          })
          .catch(e => console.warn(`[PreloadSwarm] Background QA warning: ${e.message}`));
      } catch (_) {}

    } catch (err) {
      console.error(`[PreloadSwarm] Unexpected swarm error for clone ${cloneId}:`, err);
      swarmState.status = 'error';
      swarmState.error = err.message;
    }
  });

  return swarmState;
}

/**
 * Preloads a specific path on-demand with maximum priority (e.g. on button/link hover).
 *
 * @param {string} cloneId
 * @param {string} subpath
 * @param {number} [port=3000]
 * @returns {Promise<boolean>}
 */
async function preloadSpecificPath(cloneId, subpath, port = 3000) {
  if (!cloneId || !subpath) return false;
  const cloneDir = getCloneDirPath(cloneId);
  const cleanSub = subpath.replace(/^\/+/, '').split('?')[0].split('#')[0].replace(/\/+$/, '');
  const localDiskFile = path.join(cloneDir, cleanSub, 'index.html');

  if (fs.existsSync(localDiskFile)) {
    return true; // Already ready
  }

  const localUrl = `http://localhost:${port}/clones/${cloneId}/${cleanSub}`;
  console.log(`[PreloadSwarm] ⚡ High-Priority Speculative Preload (User Hover): "${cleanSub}"`);
  const status = await requestLocalPage(localUrl, 15000);
  return status >= 200 && status < 400;
}

/**
 * Returns current preload swarm status for a clone.
 */
function getPreloadStatus(cloneId) {
  return activeSwarms.get(cloneId) || {
    cloneId,
    status: 'idle',
    totalTargets: 0,
    preloadedCount: 0,
    failedCount: 0,
    preloadedPages: []
  };
}

module.exports = {
  extractInteractiveTargets,
  startAutonomousPreloadSwarm,
  preloadSpecificPath,
  getPreloadStatus,
  DEFAULT_CONCURRENCY,
  MAX_PRELOAD_PAGES
};
