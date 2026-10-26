const fs = require('fs');
const { validateUrl } = require('../security/ssrf-guard');
const { renderPage } = require('../renderer/playwright-renderer');
const { crawlSiteSwarm } = require('../crawler/swarm-crawler');
const { saveClone, saveMultiPageClone, getClone, listClones, generateCloneId, getCloneDirPath } = require('../storage/clone-storage');
const { rewriteHtmlForPreview, rewriteInternalLinks } = require('../rewriter/html-rewriter');
const { profileTechnologies } = require('../profiler/tech-profiler');
const { downloadAndRewriteAssets } = require('../downloader/asset-downloader');
const { orchestrateQaAndRepair } = require('../qa/qa-orchestrator');
const { communicationBridge } = require('../bridge/communication-bridge');
const { tunnelService } = require('../tunnel/tunnel-service');

class ClonerError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'ClonerError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Orchestrates the cloning of a public web page or multi-page site:
 * 1. Validates URL and prevents SSRF
 * 2. If maxDepth > 0, traverses same-origin links using DFS
 * 3. Inlines styles, extracts fonts, and rewrites cross-page internal links
 * 4. Saves HTML and metadata locally
 * 5. Returns clone metadata with preview link
 *
 * @param {object} params
 * @param {string} params.url - Public URL to clone
 * @param {string} [params.id] - Optional custom clone ID
 * @param {number} [params.maxDepth=0] - Crawl depth (0 = single page)
 * @param {number} [params.maxPages=1] - Maximum pages to crawl
 * @returns {Promise<object>} Clone result metadata
 */
async function cloneWebsite({ url, id, maxDepth = 0, maxPages = 1 }) {
  const cloneId = id || generateCloneId();

  communicationBridge.broadcast('clone:started', {
    cloneId,
    url,
    maxDepth,
    maxPages
  });

  // Step 1: Input & SSRF Validation
  if (!url || typeof url !== 'string') {
    communicationBridge.broadcast('clone:error', { cloneId, error: 'A valid URL string is required.', code: 'INVALID_URL' });
    throw new ClonerError('A valid URL string is required.', 'INVALID_URL', 400);
  }

  communicationBridge.broadcast('clone:step', {
    cloneId,
    step: 'ssrf',
    status: 'active',
    label: 'Auditing URL security & SSRF defense...'
  });

  const validation = await validateUrl(url);
  if (!validation.isValid) {
    const errorMsg = validation.error || 'Invalid or forbidden URL.';
    communicationBridge.broadcast('clone:step', { cloneId, step: 'ssrf', status: 'failed', label: 'Security Violation' });
    communicationBridge.broadcast('clone:error', { cloneId, error: errorMsg, code: 'SECURITY_VIOLATION' });
    throw new ClonerError(errorMsg, 'SECURITY_VIOLATION', 403);
  }

  communicationBridge.broadcast('clone:step', { cloneId, step: 'ssrf', status: 'completed', label: 'Security Verified ✓' });

  const sanitizedUrl = validation.sanitizedUrl;
  const targetOrigin = new URL(sanitizedUrl).origin;
  const activePort = parseInt(process.env.ACTIVE_PORT || '3000', 10);

  // High-Velocity First Page Render & Capture (Lightning Fast 3-5s response)
  console.log(`[CloneService] ⚡ High-Velocity Page 1 Capture for: ${sanitizedUrl} (Clone ID: ${cloneId})`);
  communicationBridge.broadcast('clone:step', {
    cloneId,
    step: 'browser',
    status: 'active',
    label: 'Launching Chromium & rendering DOM...'
  });
  let renderResult;
  try {
    renderResult = await renderPage(sanitizedUrl, { timeout: 30000 });
    communicationBridge.broadcast('clone:step', { cloneId, step: 'browser', status: 'completed', label: 'Chromium Connected ✓' });
    communicationBridge.broadcast('clone:step', {
      cloneId,
      step: 'render',
      status: 'completed',
      label: 'DOM Hydrated & Rendered ✓',
      renderTimeMs: renderResult.renderTimeMs,
      title: renderResult.title
    });
    communicationBridge.broadcast('clone:step', {
      cloneId,
      step: 'storage',
      status: 'active',
      label: 'Extracting assets & writing local manifest...'
    });
  } catch (err) {
    communicationBridge.broadcast('clone:error', { cloneId, error: err.message, code: 'BROWSER_RENDER_FAILURE' });
    console.error(`[CloneService] Render failure for ${sanitizedUrl}:`, err.message);

    if (err.message.includes('timed out') || err.message.includes('Timeout')) {
      throw new ClonerError(
        `Website timed out during rendering (${sanitizedUrl}). The server took too long to respond.`,
        'RENDERING_TIMEOUT',
        504
      );
    }
    if (err.message.includes('DNS') || err.message.includes('not found') || err.message.includes('ENOTFOUND')) {
      throw new ClonerError(
        `Could not resolve domain name for ${sanitizedUrl}. Please check spelling.`,
        'DNS_FAILURE',
        404
      );
    }
    if (err.message.includes('Connection refused') || err.message.includes('ECONNREFUSED')) {
      throw new ClonerError(
        `Remote server refused connection at ${sanitizedUrl}.`,
        'CONNECTION_REFUSED',
        502
      );
    }
    if (err.message.includes('SSL') || err.message.includes('ERR_CERT')) {
      throw new ClonerError(
        `SSL certificate verification failed for ${sanitizedUrl}.`,
        'SSL_ERROR',
        502
      );
    }

    throw new ClonerError(
      `Failed to render website DOM: ${err.message}`,
      'BROWSER_RENDER_FAILURE',
      500
    );
  }

  // Step 2: Tech profiling & Preview normalization
  const technologies = profileTechnologies({
    html: renderResult.html,
    windowGlobals: renderResult.windowGlobals || {},
    headers: renderResult.headers || {}
  });

  const cloneDir = getCloneDirPath(cloneId);
  if (!fs.existsSync(cloneDir)) fs.mkdirSync(cloneDir, { recursive: true });

  const previewReadyHtml = rewriteHtmlForPreview(renderResult.html, renderResult.finalUrl, {
    fonts: renderResult.fonts,
    stylesheets: renderResult.stylesheets,
    cloneId: cloneId
  });

  // Step 3: Fast asset download for Page 1
  let finalHtml = previewReadyHtml;
  let assetMetrics = { totalDownloaded: 0, cssCount: 0, jsCount: 0, imagesCount: 0, fontsCount: 0, mediaCount: 0, dataCount: 0, totalBytes: 0 };

  try {
    const origin = new URL(renderResult.finalUrl).origin;
    const assetResult = await downloadAndRewriteAssets({
      cloneDir,
      html: previewReadyHtml,
      baseOrigin: origin,
      depth: 0,
      networkAssets: renderResult.networkAssets || null
    });
    finalHtml = assetResult.rewrittenHtml;
    assetMetrics = assetResult.metrics;
  } catch (assetErr) {
    console.warn('[CloneService] Page 1 asset download warning:', assetErr.message);
  }

  // Merge browser diagnostics with asset downloader diagnostics
  const combinedDiagnostics = {
    totalDiscovered: (renderResult.diagnostics?.totalDiscovered || 0) + (assetMetrics.totalDiscovered || 0),
    loadedOk: (renderResult.diagnostics?.loadedOk || 0) + (assetMetrics.totalDownloaded || 0),
    failedCount: (renderResult.diagnostics?.failedCount || 0) + (assetMetrics.failedAssets?.length || 0),
    videosDiscovered: renderResult.diagnostics?.videosDiscovered || 0,
    videosLoadedOk: renderResult.diagnostics?.videosLoadedOk || 0,
    audioDiscovered: renderResult.diagnostics?.audioDiscovered || 0,
    iframesDiscovered: renderResult.diagnostics?.iframesDiscovered || 0,
    imagesFailed: renderResult.diagnostics?.imagesFailed || 0,
    blockedThirdParty: renderResult.diagnostics?.blockedThirdParty || 0,
    failedResources: [
      ...(renderResult.diagnostics?.failedResources || []),
      ...(assetMetrics.failedAssets || [])
    ]
  };

  // Step 4: Save Page 1 immediately to disk so preview is available right away
  let storedMetadata;
  try {
    storedMetadata = await saveClone({
      id: cloneId,
      originalUrl: url,
      finalUrl: renderResult.finalUrl,
      title: renderResult.title,
      html: finalHtml,
      renderTimeMs: renderResult.renderTimeMs,
      byteSize: Buffer.byteLength(finalHtml, 'utf8'),
      technologies,
      assets: assetMetrics,
      diagnostics: combinedDiagnostics,
      mediaDiscovery: renderResult.mediaDiscovery || null,
      dynamicComponents: renderResult.dynamicComponents || null,
      consoleErrors: renderResult.consoleErrors || [],
      failedRequests: renderResult.failedRequests || [],
      clientRouteChanges: renderResult.clientRouteChanges || [],
      verificationAudit: renderResult.verificationAudit || null,
      healthAudit: renderResult.healthAudit || null,
      manifest: renderResult.manifest || null
    });
    communicationBridge.broadcast('clone:step', {
      cloneId,
      step: 'storage',
      status: 'completed',
      label: 'Saved & Ready ✓'
    });
    const publicLiveUrl = tunnelService.getLiveCloneUrl(storedMetadata.id);
    const hasPublicTunnel = tunnelService.getStatus().active;

    communicationBridge.broadcast('clone:ready', {
      cloneId,
      title: storedMetadata.title,
      previewUrl: `http://localhost:${activePort}/clones/${storedMetadata.id}/`,
      publicPreviewUrl: hasPublicTunnel ? publicLiveUrl : null,
      liveUrl: publicLiveUrl,
      renderTimeMs: renderResult.renderTimeMs,
      metadata: storedMetadata
    });
  } catch (err) {
    console.error(`[CloneService] Storage failure for ${sanitizedUrl}:`, err);
    throw new ClonerError('Failed to save clone files locally.', 'STORAGE_FAILURE', 500);
  }

  console.log(
    `[CloneService] 🚀 Page 1 INSTANTLY READY for "${storedMetadata.title}" (${storedMetadata.id}) in ${renderResult.renderTimeMs}ms!`
  );
  console.log(`[CloneService] 🌐 Local Preview:   http://localhost:${activePort}/clones/${storedMetadata.id}/`);
  const publicBase = tunnelService.getPublicUrl();
  if (publicBase) {
    console.log(`[CloneService] 🚀 Public Live URL:  ${publicBase}/clones/${storedMetadata.id}/`);
  }

  // Step 5: Start Autonomous Background Swarm Crawler & Preloader for ALL buttons & hyperlinks
  // Runs non-blocking so the user gets the preview URL in ~3-5 seconds!
  const finalOrigin = new URL(storedMetadata.finalUrl).origin;
  const preloadCeiling = maxPages > 1 ? maxPages : (maxDepth > 0 ? 30 : 25);

  setImmediate(() => {
    console.log(`[CloneService] 🐝 Launching Autonomous Preload Swarm for clone ${cloneId}...`);
    try {
      const { startAutonomousPreloadSwarm } = require('../crawler/autonomous-preload-swarm');
      startAutonomousPreloadSwarm(cloneId, {
        port: activePort,
        targetOrigin: finalOrigin,
        maxPages: preloadCeiling,
        concurrency: 3
      });
    } catch (swarmErr) {
      console.warn(`[CloneService] Autonomous Preload Swarm error:`, swarmErr.message);
    }
  });

  storedMetadata.preloadSwarm = {
    status: 'running',
    message: 'Autonomous background swarm is preloading all buttons, links, and subpages.'
  };

  return storedMetadata;
}

module.exports = {
  cloneWebsite,
  getClone,
  listClones,
  orchestrateQaAndRepair,
  ClonerError
};
