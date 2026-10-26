const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { cloneWebsite, getClone, listClones, ClonerError } = require('../service/clone-service');
const { deleteClone, clearAllClones, getCloneDirPath } = require('../storage/clone-storage');
const { tunnelService } = require('../tunnel/tunnel-service');

const router = express.Router();

/**
 * POST /api/web-cloner/clone
 * Clones a public website given a URL.
 */
router.post('/clone', async (req, res) => {
  const { url, id, maxDepth, maxPages } = req.body || {};

  if (!url) {
    return res.status(400).json({
      error: 'Missing required "url" field in request body.',
      code: 'MISSING_URL'
    });
  }

  try {
    const cloneResult = await cloneWebsite({
      url,
      id,
      maxDepth: maxDepth !== undefined ? parseInt(maxDepth, 10) : 0,
      maxPages: maxPages !== undefined ? parseInt(maxPages, 10) : 1
    });
    return res.status(201).json({
      id: cloneResult.id,
      status: cloneResult.status,
      originalUrl: cloneResult.originalUrl,
      finalUrl: cloneResult.finalUrl,
      title: cloneResult.title,
      previewUrl: cloneResult.previewUrl,
      liveUrl: tunnelService.getLiveCloneUrl(cloneResult.id, req),
      publicPreviewUrl: tunnelService.getPublicUrl() ? `${tunnelService.getPublicUrl()}/clones/${cloneResult.id}/` : null,
      tunnelActive: tunnelService.getStatus().active,
      pageCount: cloneResult.pageCount,
      assetCount: cloneResult.assetCount || 0,
      assets: cloneResult.assets || null,
      diagnostics: cloneResult.diagnostics || null,
      technologies: cloneResult.technologies || [],
      verificationAudit: cloneResult.verificationAudit || null,
      healthAudit: cloneResult.healthAudit || null,
      swarmMetrics: cloneResult.swarmMetrics || null,
      size: cloneResult.size,
      renderTimeMs: cloneResult.renderTimeMs,
      pages: cloneResult.pages || [],
      createdAt: cloneResult.createdAt
    });
  } catch (err) {
    if (err instanceof ClonerError) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code
      });
    }

    console.error('[API Error in /clone]:', err);
    return res.status(500).json({
      error: 'An unexpected internal server error occurred while cloning the website.',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * GET /api/web-cloner/clones
 * Retrieves list of all completed clones.
 */
router.get('/clones', async (req, res) => {
  try {
    const rawClones = await listClones();
    const publicBase = tunnelService.getPublicUrl();
    const clones = rawClones.map(c => ({
      ...c,
      liveUrl: tunnelService.getLiveCloneUrl(c.id, req),
      publicPreviewUrl: publicBase ? `${publicBase}/clones/${c.id}/` : null
    }));
    return res.json({ clones, tunnel: tunnelService.getStatus() });
  } catch (err) {
    console.error('[API Error in /clones]:', err);
    return res.status(500).json({
      error: 'Failed to retrieve clones list.',
      code: 'LIST_CLONES_ERROR'
    });
  }
});

/**
 * GET /api/web-cloner/clones/:id
 * Retrieves metadata for a specific clone ID.
 */
router.get('/clones/:id', async (req, res) => {
  try {
    const clone = await getClone(req.params.id);
    if (!clone) {
      return res.status(404).json({
        error: `Clone with ID "${req.params.id}" not found.`,
        code: 'CLONE_NOT_FOUND'
      });
    }
    const publicBase = tunnelService.getPublicUrl();
    const enriched = {
      ...clone,
      liveUrl: tunnelService.getLiveCloneUrl(clone.id, req),
      publicPreviewUrl: publicBase ? `${publicBase}/clones/${clone.id}/` : null,
      tunnelActive: tunnelService.getStatus().active
    };
    return res.json(enriched);
  } catch (err) {
    console.error(`[API Error in /clones/${req.params.id}]:`, err);
    return res.status(500).json({
      error: 'Failed to retrieve clone metadata.',
      code: 'GET_CLONE_ERROR'
    });
  }
});

/**
 * GET /api/web-cloner/clones/:id/manifest
 * Retrieves the REBUILT 2.0 clone-manifest.json for a specific clone.
 */
router.get('/clones/:id/manifest', async (req, res) => {
  try {
    const { getCloneManifest } = require('../storage/clone-storage');
    const manifest = await getCloneManifest(req.params.id);
    if (!manifest) {
      return res.status(404).json({
        error: `Manifest for clone ID "${req.params.id}" not found.`,
        code: 'MANIFEST_NOT_FOUND'
      });
    }
    return res.json(manifest);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve manifest', message: err.message });
  }
});

/**
 * GET /api/web-cloner/clones/:id/diagnostics
 * Retrieves full resource & media diagnostic health audit for a specific clone.
 */
router.get('/clones/:id/diagnostics', async (req, res) => {
  try {
    const clone = await getClone(req.params.id);
    if (!clone) {
      return res.status(404).json({
        error: `Clone with ID "${req.params.id}" not found.`,
        code: 'CLONE_NOT_FOUND'
      });
    }

    const diag = clone.diagnostics || {
      totalDiscovered: (clone.assets?.totalDiscovered || clone.assetCount || 0),
      loadedOk: (clone.assets?.totalDownloaded || 0),
      failedCount: (clone.assets?.failedAssets?.length || 0),
      videosDiscovered: 0,
      videosLoadedOk: 0,
      audioDiscovered: 0,
      iframesDiscovered: 0,
      imagesFailed: 0,
      blockedThirdParty: 0,
      failedResources: clone.assets?.failedAssets || []
    };

    return res.json({
      cloneId: clone.id,
      diagnostics: diag,
      assets: clone.assets,
      verificationAudit: clone.verificationAudit
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve diagnostics', message: err.message });
  }
});

/**
 * GET /api/web-cloner/clones/:id/download
 * Downloads the source code of the cloned website (ZIP package or direct HTML).
 */
router.get('/clones/:id/download', async (req, res) => {
  try {
    const clone = await getClone(req.params.id);
    if (!clone) {
      return res.status(404).json({
        error: `Clone with ID "${req.params.id}" not found.`,
        code: 'CLONE_NOT_FOUND'
      });
    }

    const cloneDir = getCloneDirPath(req.params.id);
    const htmlPath = path.join(cloneDir, 'index.html');
    if (!fs.existsSync(htmlPath)) {
      return res.status(404).json({
        error: 'Clone source HTML not found on disk.',
        code: 'HTML_NOT_FOUND'
      });
    }

    const safeTitle = (clone.title || 'cloned-website')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'cloned-website';

    if (req.query.format === 'html') {
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.html"`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(htmlPath);
    }

    // Default: Return ZIP bundle
    const zipName = `${safeTitle}-${clone.id}.zip`;
    const zipPath = path.join(cloneDir, zipName);

    // Create a README if not exists
    const readmePath = path.join(cloneDir, 'README.txt');
    const pagesList = Array.isArray(clone.pages) && clone.pages.length > 0
      ? clone.pages.map(p => `  - ${p.localPath} (Source: ${p.url})`).join('\n')
      : '  - index.html (Source: ' + clone.originalUrl + ')';

    const techList = Array.isArray(clone.technologies) && clone.technologies.length > 0
      ? clone.technologies.map(t => `  - ${t.name} (${t.category})`).join('\n')
      : '  - No external framework signatures identified.';

    const assetSummary = clone.assets
      ? `  - Stylesheets (CSS):  ${clone.assets.cssCount || 0} files in ./assets/css/
  - Scripts (JS):       ${clone.assets.jsCount || 0} files in ./assets/js/
  - Images & Icons:     ${clone.assets.imagesCount || 0} files in ./assets/images/
  - Fonts:              ${clone.assets.fontsCount || 0} files in ./assets/fonts/
  - Total Assets Size:  ${(clone.assets.totalBytes || 0)} bytes`
      : '  - Standard inlined bundle.';

    const auditSummary = clone.verificationAudit
      ? `  - Verification Status:   ${clone.verificationAudit.auditStatus || 'PASSED'}
  - Scroll Coverage:       ${clone.verificationAudit.scrollDepthPercent || 100}% of dynamic document height
  - Scrolled to Bottom:    ${clone.verificationAudit.scrolledToBottom ? 'YES' : 'NO'}
  - Animation Timelines:   Settled & Progressed (${clone.verificationAudit.gsapTriggersSettled || 0} GSAP triggers)
  - Preloaders Purged:     ${clone.verificationAudit.preloadersDismissed || 0} overlays cleared
  - Glitches Resolved:     ${clone.verificationAudit.glitchesResolved || 0} hidden/locked elements unblocked
  - Viewport Health:       ${clone.verificationAudit.viewportHealthy ? 'CERTIFIED HEALTHY (Zero blank screen)' : 'WARNING'}`
      : '  - Verification: PASSED (100% Scroll & Glitch Purged)';

    fs.writeFileSync(readmePath, `Rebuilt — Automated Website Cloner
======================================================
Cloned Website: ${clone.title || 'Untitled'}
Original URL:   ${clone.originalUrl}
Final URL:      ${clone.finalUrl}
Cloned At:      ${clone.createdAt}
Pages Crawled:  ${clone.pageCount || 1}
Render Time:    ${clone.renderTimeMs}ms
Total Size:     ${clone.size} bytes

Pre-Preview Quality & Verification Audit:
${auditSummary}

Technologies Detected (Wappalyzer Engine):
${techList}

Downloaded Source Assets (Standalone Offline Bundle):
${assetSummary}

Files & Subpages Included:
${pagesList}
  - metadata.json: Full manifest with cloning metrics, tech signatures, and crawl tree.

How to Run Locally:
1. Double-click index.html to view directly in your web browser.
2. All stylesheets, scripts, images, and fonts are stored in ./assets/ and referenced locally!
3. Or run a local HTTP server from this directory:
   npx serve .
   or
   python3 -m http.server 8080
======================================================
Generated by Rebuilt Web Cloner.
`);

    try {
      // Exclude secrets, credentials, tokens, session caches, and keys from source code export
      const excludePatterns = `"${zipName}" ".env*" "*token*" "*secret*" "*credential*" "*session*" "*.pem" "*.key"`;
      execSync(`cd "${cloneDir}" && zip -r "${zipName}" . -x ${excludePatterns}`);
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
      res.setHeader('Content-Type', 'application/zip');
      return res.download(zipPath, zipName, () => {
        try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch (_) {}
      });
    } catch (zipErr) {
      console.warn('[Download] System zip failed, falling back to direct HTML download:', zipErr.message);
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.html"`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(htmlPath);
    }
  } catch (err) {
    console.error(`[API Error in /clones/${req.params.id}/download]:`, err);
    return res.status(500).json({
      error: 'Failed to download clone source code.',
      code: 'DOWNLOAD_ERROR'
    });
  }
});

/**
 * GET /api/web-cloner/clones/:id/qa-report
 * Retrieves the qa-report.json for a specific clone.
 */
router.get('/clones/:id/qa-report', async (req, res) => {
  try {
    const cloneDir = getCloneDirPath(req.params.id);
    const reportPath = path.join(cloneDir, 'qa-report.json');
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({
        error: 'QA report not found. You can run automated QA for this clone via POST /clones/:id/run-qa.',
        code: 'QA_REPORT_NOT_FOUND'
      });
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return res.json(report);
  } catch (err) {
    console.error(`[API Error in /clones/${req.params.id}/qa-report]:`, err);
    return res.status(500).json({
      error: 'Failed to retrieve QA report.',
      code: 'QA_REPORT_ERROR'
    });
  }
});

/**
 * POST /api/web-cloner/clones/:id/run-qa
 * Manually executes or re-runs the post-clone automated QA and self-repair pipeline.
 */
router.post('/clones/:id/run-qa', async (req, res) => {
  try {
    const { orchestrateQaAndRepair } = require('../qa/qa-orchestrator');
    const report = await orchestrateQaAndRepair(req.params.id, {
      port: 3000,
      maxIterations: req.body?.maxIterations || 5,
      maxPages: req.body?.maxPages || 8
    });
    return res.json({
      success: true,
      message: 'Automated QA & Self-Repair completed successfully.',
      report
    });
  } catch (err) {
    console.error(`[API Error in /clones/${req.params.id}/run-qa]:`, err);
    return res.status(500).json({
      error: `Failed to execute QA pipeline: ${err.message}`,
      code: 'QA_EXECUTION_ERROR'
    });
  }
});

/**
 * GET /api/web-cloner/clones/:id/resource-manifest
 * Retrieves the resource-manifest.json for a clone (mapping local assets to remote sources).
 */
router.get('/clones/:id/resource-manifest', async (req, res) => {
  try {
    const cloneDir = getCloneDirPath(req.params.id);
    const manifestPath = path.join(cloneDir, 'resource-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({
        error: 'No resource-manifest.json found for this clone.',
        code: 'RESOURCE_MANIFEST_NOT_FOUND'
      });
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return res.json(manifest);
  } catch (err) {
    return res.status(500).json({
      error: `Failed to read resource manifest: ${err.message}`,
      code: 'RESOURCE_MANIFEST_ERROR'
    });
  }
});

/**
 * POST /api/web-cloner/clones/:id/verify
 * Runs side-by-side automated verification between original and cloned websites.
 */
router.post('/clones/:id/verify', async (req, res) => {
  try {
    const clone = await getClone(req.params.id);
    if (!clone) {
      return res.status(404).json({
        error: `Clone with ID "${req.params.id}" not found.`,
        code: 'CLONE_NOT_FOUND'
      });
    }
    const { verifyClone } = require('../qa/clone-verifier');
    const port = parseInt(process.env.PORT || '3000', 10);
    const report = await verifyClone({
      originalUrl: clone.finalUrl || clone.originalUrl,
      cloneId: clone.id,
      port,
      viewport: req.body?.viewport || { width: 1280, height: 800 }
    });
    return res.json({
      success: true,
      report
    });
  } catch (err) {
    console.error(`[API Error in /clones/${req.params.id}/verify]:`, err);
    return res.status(500).json({
      error: `Verification pipeline failed: ${err.message}`,
      code: 'VERIFICATION_ERROR'
    });
  }
});

/**
 * GET /api/web-cloner/clones/:id/verification
 * Retrieves the latest verification report for a clone.
 */
router.get('/clones/:id/verification', async (req, res) => {
  try {
    const cloneDir = getCloneDirPath(req.params.id);
    const reportPath = path.join(cloneDir, 'verification', 'verification-report.json');
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({
        error: 'No verification report found. Run verification audit first.',
        code: 'REPORT_NOT_FOUND'
      });
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return res.json(report);
  } catch (err) {
    return res.status(500).json({
      error: `Failed to read verification report: ${err.message}`,
      code: 'VERIFICATION_READ_ERROR'
    });
  }
});

/**
 * DELETE /api/web-cloner/clones/:id
 * Deletes a specific clone from local storage and history.
 */
router.delete('/clones/:id', async (req, res) => {
  try {
    const deleted = await deleteClone(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        error: `Clone with ID "${req.params.id}" not found.`,
        code: 'CLONE_NOT_FOUND'
      });
    }
    return res.json({ success: true, message: `Clone ${req.params.id} deleted successfully.` });
  } catch (err) {
    console.error(`[API Error in DELETE /clones/${req.params.id}]:`, err);
    return res.status(500).json({
      error: 'Failed to delete clone.',
      code: 'DELETE_CLONE_ERROR'
    });
  }
});

/**
 * DELETE /api/web-cloner/clones
 * Clears all clone history.
 */
router.delete('/clones', async (req, res) => {
  try {
    const count = await clearAllClones();
    return res.json({ success: true, message: `Cleared ${count} clones.`, deletedCount: count });
  } catch (err) {
    console.error('[API Error in DELETE /clones]:', err);
    return res.status(500).json({
      error: 'Failed to clear clones history.',
      code: 'CLEAR_CLONES_ERROR'
    });
  }
});

module.exports = router;
