/**
 * Rebuilt Local API Endpoint - Unified User Request Fulfillment
 * 
 * Local API Endpoint (/api/local) designed to fulfill all user operations:
 * - clone: Clones a public website with headless Chromium
 * - bridge_url: Bridges any remote web URL into a live communication session
 * - status: Checks live health of background cloner, swarm, and bridge
 * - qa: Runs automated QA and self-repair on a clone
 * - inspect: Inspects live DOM or metadata of a clone
 * - list_clones: Lists all locally mirrored clones
 * - delete_clone: Deletes a clone
 */

const express = require('express');
const { cloneWebsite, getClone, listClones, ClonerError } = require('../service/clone-service');
const { deleteClone, clearAllClones, getCloneDirPath } = require('../storage/clone-storage');
const { urlWebBridge } = require('../bridge/url-web-bridge');
const { communicationBridge } = require('../bridge/communication-bridge');
const { orchestrateQaAndRepair } = require('../qa/qa-orchestrator');

const router = express.Router();

/**
 * POST /api/local/request
 * Main unified local API endpoint to fulfill user requests dynamically.
 * 
 * Payload structure:
 * {
 *   action: 'clone' | 'bridge_url' | 'qa' | 'status' | 'inspect' | 'list_clones' | 'delete_clone',
 *   url?: string,
 *   cloneId?: string,
 *   options?: object
 * }
 */
router.post('/request', async (req, res) => {
  const { action, url, cloneId, options = {} } = req.body || {};

  if (!action) {
    return res.status(400).json({
      success: false,
      error: 'Missing required "action" field. Supported actions: clone, bridge_url, qa, status, inspect, list_clones, delete_clone',
      code: 'MISSING_ACTION'
    });
  }

  // Notify communication bridge of incoming local API fulfillment request
  communicationBridge.broadcast('local_api:request_received', {
    action,
    url: url || null,
    cloneId: cloneId || null,
    timestamp: Date.now()
  });

  try {
    switch (action.toLowerCase()) {
      // 1. CLONE WEBSITE ACTION
      case 'clone': {
        if (!url) {
          return res.status(400).json({ success: false, error: 'URL is required for action "clone"', code: 'MISSING_URL' });
        }
        const maxDepth = options.maxDepth !== undefined ? parseInt(options.maxDepth, 10) : 0;
        const maxPages = options.maxPages !== undefined ? parseInt(options.maxPages, 10) : 1;

        const result = await cloneWebsite({
          url,
          id: cloneId || options.id,
          maxDepth,
          maxPages
        });

        communicationBridge.broadcast('local_api:request_fulfilled', {
          action: 'clone',
          cloneId: result.id,
          title: result.title,
          status: 'success'
        });

        return res.status(200).json({
          success: true,
          action: 'clone',
          message: 'Website cloned and mirrored successfully.',
          data: result
        });
      }

      // 2. BRIDGE WEB URL ACTION
      case 'bridge_url': {
        if (!url) {
          return res.status(400).json({ success: false, error: 'URL is required for action "bridge_url"', code: 'MISSING_URL' });
        }
        const session = await urlWebBridge.createSession(url, options);
        const bridgeUrl = urlWebBridge.buildBridgeUrl(url, session.id);

        communicationBridge.broadcast('local_api:request_fulfilled', {
          action: 'bridge_url',
          sessionId: session.id,
          targetUrl: session.targetUrl,
          status: 'success'
        });

        return res.status(200).json({
          success: true,
          action: 'bridge_url',
          message: 'Live URL Web Bridge session established.',
          session,
          bridgeUrl
        });
      }

      // 3. QA & SELF-REPAIR ACTION
      case 'qa': {
        const targetId = cloneId || options.cloneId;
        if (!targetId) {
          return res.status(400).json({ success: false, error: 'cloneId is required for action "qa"', code: 'MISSING_CLONE_ID' });
        }
        const port = parseInt(process.env.ACTIVE_PORT || '3000', 10);
        const report = await orchestrateQaAndRepair(targetId, {
          port,
          maxIterations: options.maxIterations || 2,
          maxPages: options.maxPages || 8
        });

        communicationBridge.broadcast('local_api:request_fulfilled', {
          action: 'qa',
          cloneId: targetId,
          status: 'success'
        });

        return res.status(200).json({
          success: true,
          action: 'qa',
          message: 'QA certification and self-repair executed.',
          report
        });
      }

      // 4. STATUS & TELEMETRY ACTION
      case 'status': {
        const bridgeStatus = communicationBridge.getStatus();
        const activeSessions = urlWebBridge.listSessions();
        const port = parseInt(process.env.ACTIVE_PORT || '3000', 10);

        return res.status(200).json({
          success: true,
          action: 'status',
          server: {
            status: 'online',
            port,
            timestamp: new Date().toISOString()
          },
          bridge: bridgeStatus,
          urlBridgeSessions: activeSessions
        });
      }

      // 5. INSPECT CLONE ACTION
      case 'inspect': {
        const targetId = cloneId || options.cloneId;
        if (!targetId) {
          return res.status(400).json({ success: false, error: 'cloneId is required for action "inspect"', code: 'MISSING_CLONE_ID' });
        }
        const metadata = await getClone(targetId);
        if (!metadata) {
          return res.status(404).json({ success: false, error: `Clone "${targetId}" not found`, code: 'NOT_FOUND' });
        }

        return res.status(200).json({
          success: true,
          action: 'inspect',
          clone: metadata
        });
      }

      // 6. LIST CLONES ACTION
      case 'list_clones': {
        const clones = await listClones();
        return res.status(200).json({
          success: true,
          action: 'list_clones',
          total: clones.length,
          clones
        });
      }

      // 7. DELETE CLONE ACTION
      case 'delete_clone': {
        const targetId = cloneId || options.cloneId;
        if (!targetId) {
          return res.status(400).json({ success: false, error: 'cloneId is required for action "delete_clone"', code: 'MISSING_CLONE_ID' });
        }
        const deleted = await deleteClone(targetId);
        return res.status(200).json({
          success: deleted,
          action: 'delete_clone',
          message: deleted ? `Clone ${targetId} deleted.` : `Clone ${targetId} not found.`
        });
      }

      default:
        return res.status(400).json({
          success: false,
          error: `Unrecognized action "${action}". Supported actions: clone, bridge_url, qa, status, inspect, list_clones, delete_clone`,
          code: 'INVALID_ACTION'
        });
    }
  } catch (err) {
    console.error(`[LocalAPI] Error fulfilling user request (${action}):`, err);

    communicationBridge.broadcast('local_api:request_failed', {
      action,
      error: err.message
    });

    return res.status(err instanceof ClonerError ? err.statusCode : 500).json({
      success: false,
      action,
      error: err.message,
      code: err.code || 'LOCAL_API_ERROR'
    });
  }
});

/**
 * GET /api/local/status
 * Quick health and capability check for local API users.
 */
router.get('/status', (req, res) => {
  res.json({
    status: 'ready',
    service: 'Rebuilt Local Request Fulfillment API',
    version: '1.2.0',
    capabilities: [
      'clone (Chromium render & offline mirror)',
      'bridge_url (Live web proxy & SSE event bridge)',
      'qa (Automated certification & repair)',
      'status (System health & telemetry)',
      'inspect (Metadata & local assets inspection)',
      'list_clones (Library catalog)',
      'delete_clone (Storage management)'
    ]
  });
});

module.exports = router;
