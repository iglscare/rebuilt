/**
 * Rebuilt Automated QA — Self-Repair Orchestrator
 * 
 * Orchestrates the closed-loop QA & Self-Repair pipeline:
 * 1. Executes autonomous in-browser QA exploration across discovered routes.
 * 2. Collects network failures, HTTP 4xx/5xx, missing fonts/assets, CORS violations, and JS errors.
 * 3. Classifies errors into structured taxonomy with root cause analysis.
 * 4. Applies generalized self-repairs (downloading missing fonts/assets, rewriting URLs, proxying APIs).
 * 5. Re-tests the application up to MAX_REPAIR_ITERATIONS (limit: 5) to verify repairs and check regressions.
 * 6. Generates qa-report.json and updates clone metadata.
 */

const fs = require('fs');
const path = require('path');
const { runQaAudit } = require('./qa-automator');
const { tunnelService } = require('../tunnel/tunnel-service');
const { classifyError, aggregateErrors } = require('./error-classifier');
const { applySelfRepairs } = require('./repair-engine');
const { prewarmSubpages } = require('./subpage-prewarmer');
const { getClone, saveCloneMetadata, getCloneDirPath } = require('../storage/clone-storage');

const MAX_REPAIR_ITERATIONS = 5;

/**
 * Runs the complete post-clone QA & self-repair pipeline for a clone.
 * 
 * @param {string} cloneId - Unique clone ID
 * @param {object} [options]
 * @param {number} [options.port=3000] - Local server port
 * @param {number} [options.maxIterations=5] - Maximum repair iterations
 * @param {number} [options.maxPages=8] - Exploration page limit
 * @returns {Promise<object>} Complete QA report and status
 */
async function orchestrateQaAndRepair(cloneId, options = {}) {
  const port = options.port || 3000;
  const maxIterations = Math.min(options.maxIterations || MAX_REPAIR_ITERATIONS, 5);
  const maxPages = options.maxPages || 8;

  const metadata = await getClone(cloneId);
  if (!metadata) {
    throw new Error(`[QAOrchestrator] Clone metadata not found for ID: ${cloneId}`);
  }

  const targetOrigin = metadata.finalUrl ? new URL(metadata.finalUrl).origin : (metadata.originalUrl ? new URL(metadata.originalUrl).origin : '');
  const cloneDir = getCloneDirPath(cloneId);

  console.log(`\n======================================================`);
  console.log(`  🔬 Starting Post-Clone QA + Self-Repair Pipeline   `);
  console.log(`  Clone ID:      ${cloneId}                          `);
  console.log(`  Target:        ${metadata.finalUrl || metadata.originalUrl} `);
  console.log(`  Local Preview: http://localhost:${port}/clones/${cloneId}/ `);
  console.log(`  Max Iterations: ${maxIterations}                   `);
  console.log(`======================================================\n`);

  let iteration = 0;
  let initialErrorCount = null;
  let totalRepairedCount = 0;
  let remainingErrors = [];
  let latestAuditMetrics = {};
  let latestScreenshots = [];
  const repairHistory = [];

  // ─────────────────────────────────────────────────────────────────
  // Phase 0: Pre-warm all subpages to disk BEFORE QA starts.
  // This renders every internal link found in index.html to the local
  // filesystem, so QA navigation is instant (~50ms) instead of
  // triggering on-demand Playwright renders mid-crawl (~15s+ each).
  // ─────────────────────────────────────────────────────────────────
  console.log(`[QAOrchestrator] 🔥 Phase 0: Pre-warming all subpages to disk...`);
  try {
    await prewarmSubpages({
      cloneId,
      port,
      targetOrigin,
      maxSubpages: 30
    });
  } catch (prewarmErr) {
    console.warn(`[QAOrchestrator] Pre-warm warning (non-fatal): ${prewarmErr.message}`);
  }

  while (iteration < maxIterations) {
    iteration++;
    console.log(`[QAOrchestrator] 🚀 Beginning QA Exploration Iteration ${iteration}/${maxIterations}...`);

    // Step 1: Autonomous In-Browser Exploration
    // Now pages are pre-warmed on disk so navigation is near-instant
    const auditResult = await runQaAudit({
      cloneId,
      port,
      targetOrigin,
      maxPages: Math.max(maxPages, 20),
      maxExecutionTime: 120000
    });

    latestAuditMetrics = auditResult.metrics;
    latestScreenshots = auditResult.screenshots;

    // Step 2: Error Classification
    const classifiedList = auditResult.rawEvents
      .map(e => classifyError(e, targetOrigin))
      .filter(Boolean);

    const aggregated = aggregateErrors(classifiedList);

    if (initialErrorCount === null) {
      initialErrorCount = aggregated.length;
    }

    console.log(`[QAOrchestrator] 📊 Iteration ${iteration} Findings: ${aggregated.length} active error(s) detected.`);

    // If zero errors, we are fully validated!
    if (aggregated.length === 0) {
      console.log(`[QAOrchestrator] ✅ No runtime errors detected on iteration ${iteration}! QA verification passed cleanly.`);
      remainingErrors = [];
      break;
    }

    remainingErrors = aggregated;

    // Check if all remaining errors are of types that cannot be self-repaired
    // (NAVIGATION_FAILURE, BROKEN_ROUTE, RESOURCE_TIMEOUT are informational only)
    const UNFIXABLE_TYPES = new Set(['NAVIGATION_FAILURE', 'BROKEN_ROUTE', 'RESOURCE_TIMEOUT']);
    const allUnfixable = aggregated.every(e => UNFIXABLE_TYPES.has(e.type));
    if (allUnfixable) {
      console.log(`[QAOrchestrator] ℹ️ All remaining ${aggregated.length} error(s) are informational / non-repairable (${aggregated.map(e => e.type).join(', ')}). Exiting repair loop.`);
      break;
    }

    // If we've reached the maximum repair iteration, stop
    if (iteration >= maxIterations) {
      console.log(`[QAOrchestrator] ⚠️ Reached maximum repair iterations (${maxIterations}). Halting self-repair loop.`);
      break;
    }

    // Step 3: Apply Generalized Self-Repairs
    console.log(`[QAOrchestrator] 🛠️ Applying generalized self-repairs for ${aggregated.length} error(s)...`);
    const repairResult = await applySelfRepairs({
      classifiedErrors: aggregated,
      cloneId,
      targetOrigin
    });

    totalRepairedCount += repairResult.repairedCount;
    repairHistory.push({
      iteration,
      repairedCount: repairResult.repairedCount,
      log: repairResult.repairLog
    });

    console.log(`[QAOrchestrator] 🩹 Repaired ${repairResult.repairedCount} issue(s) in iteration ${iteration}. Retesting...`);

    // If no repairs could be applied this round, break to prevent spinning
    if (repairResult.repairedCount === 0) {
      console.log(`[QAOrchestrator] ℹ️ No further automatic repairs could be applied. Halting loop.`);
      break;
    }
  }

  // Step 4: Generate Final QA Report
  const qaReport = {
    target: metadata.finalUrl || metadata.originalUrl,
    localUrl: `http://localhost:${port}/clones/${cloneId}/`,
    cloneId,
    verifiedAt: new Date().toISOString(),
    status: remainingErrors.length === 0 ? 'CERTIFIED_HEALTHY' : 'PARTIALLY_REPAIRED',
    iterationsRun: iteration,
    screensDiscovered: latestAuditMetrics.screensDiscovered || 1,
    screensTested: latestAuditMetrics.screensTested || 1,
    interactions: {
      linksTested: latestAuditMetrics.linksTested || 0,
      buttonsTested: latestAuditMetrics.buttonsTested || 0,
      tabsTested: latestAuditMetrics.tabsTested || 0,
      accordionsTested: latestAuditMetrics.accordionsTested || 0,
      modalsTested: latestAuditMetrics.modalsTested || 0
    },
    resourcesChecked: {
      images: latestAuditMetrics.imagesChecked || 0,
      fonts: latestAuditMetrics.fontsChecked || 0,
      css: latestAuditMetrics.cssChecked || 0,
      js: latestAuditMetrics.jsChecked || 0,
      apiRequests: latestAuditMetrics.apiRequestsChecked || 0
    },
    initialErrors: initialErrorCount || 0,
    automaticallyRepaired: totalRepairedCount,
    remainingCount: remainingErrors.length,
    remainingErrors: remainingErrors.map(e => ({
      type: e.type,
      url: e.url,
      sourceUrl: e.sourceUrl,
      localUrl: e.localUrl,
      statusCode: e.statusCode,
      resourceType: e.resourceType,
      page: e.page,
      errorMessage: e.errorMessage,
      probableCause: e.probableCause
    })),
    repairHistory,
    screenshots: latestScreenshots
  };

  // Save qa-report.json inside clone directory
  const reportPath = path.join(cloneDir, 'qa-report.json');
  try {
    fs.writeFileSync(reportPath, JSON.stringify(qaReport, null, 2), 'utf8');
    console.log(`[QAOrchestrator] 📄 Saved QA Report to: ${reportPath}`);
  } catch (err) {
    console.warn(`[QAOrchestrator] Warning saving qa-report.json:`, err.message);
  }

  // Update clone metadata with QA summary
  try {
    await saveCloneMetadata(cloneId, {
      ...metadata,
      qaStatus: qaReport.status,
      qaAudit: {
        verifiedAt: qaReport.verifiedAt,
        status: qaReport.status,
        initialErrors: qaReport.initialErrors,
        automaticallyRepaired: qaReport.automaticallyRepaired,
        remainingCount: qaReport.remainingCount,
        reportPath: `qa-report.json`
      }
    });
  } catch (_) {}

  console.log(`\n======================================================`);
  console.log(`  🎉 POST-CLONE QA & REPAIR COMPLETE                 `);
  console.log(`  Status:               ${qaReport.status}           `);
  console.log(`  Initial Errors:       ${qaReport.initialErrors}    `);
  console.log(`  Automatically Repaired: ${qaReport.automaticallyRepaired} `);
  console.log(`  Remaining Errors:     ${qaReport.remainingCount}   `);
  console.log(`  Screens Tested:       ${qaReport.screensTested}    `);
  console.log(`  Preview (Local):      ${qaReport.localUrl}         `);
  const publicBase = tunnelService.getPublicUrl();
  if (publicBase) {
    console.log(`  Preview (Public Live): ${publicBase}/clones/${cloneId}/         `);
  }
  console.log(`======================================================\n`);

  return qaReport;
}

module.exports = {
  orchestrateQaAndRepair,
  MAX_REPAIR_ITERATIONS
};
