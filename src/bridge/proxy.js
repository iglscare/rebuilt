/**
 * REBUILT — Communication Bridge: Reverse Proxy & Router
 * 
 * Express router and middleware mounting the local Communication Bridge:
 * 1. Routes /bridge/api/*, /bridge/clone/:id/*, and /bridge/*
 * 2. Resolves target clone context from headers, params, query, or Referer
 * 3. Handles CORS preflight (OPTIONS)
 * 4. Provides Developer Panel status and telemetry
 */

const express = require('express');
const { bridgeRequestHandler } = require('./request-handler');
const { ManifestManager } = require('./manifest');
const { listClones } = require('../storage/clone-storage');

const router = express.Router();

/**
 * Resolves active clone ID from request signals.
 */
async function resolveCloneId(req) {
  if (req.params && (req.params.cloneId || req.params.id)) {
    return req.params.cloneId || req.params.id;
  }
  if (req.headers['x-rebuilt-clone-id']) {
    return req.headers['x-rebuilt-clone-id'];
  }
  if (req.query && req.query.cloneId) {
    return req.query.cloneId;
  }

  // Check Referer header (e.g., http://localhost:3000/clones/clone_123/...)
  const referer = req.headers['referer'] || req.headers['referrer'] || '';
  const match = referer.match(/\/clones\/([^\/?#]+)/);
  if (match) {
    return match[1];
  }

  // Fallback to most recent clone
  try {
    const clones = await listClones();
    if (clones && clones.length > 0) {
      return clones[0].id;
    }
  } catch (_) {}

  return null;
}

/**
 * Universal proxy request executor.
 */
async function handleBridgeProxy(req, res, pathOverride = null) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const clientOrigin = req.headers['origin'] || '*';
    res.setHeader('Access-Control-Allow-Origin', clientOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Rebuilt-Clone-Id');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    return res.sendStatus(204);
  }

  const cloneId = await resolveCloneId(req);

  // Determine requested route path
  let reqPath = pathOverride;
  if (!reqPath) {
    if (req.params && req.params[0]) {
      reqPath = '/' + req.params[0].replace(/^\/+/, '');
    } else {
      reqPath = req.path;
      // Strip /bridge prefix if present
      if (reqPath.startsWith('/bridge')) {
        reqPath = reqPath.slice('/bridge'.length) || '/';
      }
    }
  }

  const clientOrigin = req.headers['origin'] || (req.headers['host'] ? `http://${req.headers['host']}` : '');

  try {
    const result = await bridgeRequestHandler.handleRequest({
      cloneId,
      method: req.method,
      path: reqPath,
      query: req.query,
      headers: req.headers,
      body: req.body,
      clientOrigin
    });

    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }

    res.status(result.status);
    if (result.isBinary) {
      return res.send(result.data);
    } else if (typeof result.data === 'object') {
      return res.json(result.data);
    } else {
      return res.send(result.data);
    }
  } catch (err) {
    const statusCode = err.statusCode || (err.code === 'BRIDGE_ROUTE_NOT_FOUND' ? 403 : 500);
    return res.status(statusCode).json({
      error: err.message,
      code: err.code || 'BRIDGE_DISPATCH_FAILURE',
      bridge: 'rebuilt_communication_bridge'
    });
  }
}

/**
 * GET /bridge/status
 * Diagnostic status for Rebuilt Developer Panel.
 */
router.get('/status', async (req, res) => {
  const cloneId = await resolveCloneId(req);
  const manifest = cloneId ? await ManifestManager.load(cloneId) : null;
  const recentLogs = bridgeRequestHandler.getAuditLogs().slice(0, 15);

  const targetOrigin = (manifest && manifest.targetOrigin) || (recentLogs[0] ? recentLogs[0].targetUrl : 'https://authorized-target.example');
  const mode = (manifest && manifest.mode) || 'LIVE_BRIDGE';

  // Format ASCII developer panel text
  const panelLines = [
    '============================================================',
    '                   COMMUNICATION BRIDGE                     ',
    '============================================================',
    'Status: RUNNING',
    '',
    'Target:',
    targetOrigin,
    '',
    `Mode: ${mode}`,
    '',
    'Requests:'
  ];

  if (recentLogs.length === 0) {
    panelLines.push('  (No requests bridged yet)');
  } else {
    for (const log of recentLogs) {
      panelLines.push(`\n${log.method.padEnd(5)} ${log.localPath}`);
      panelLines.push(`→ ${log.targetUrl}`);
      panelLines.push(`${log.status} (${log.durationMs}ms)`);
      if (log.authState && log.authState !== 'NONE' && log.authState !== 'N/A') {
        panelLines.push(`Authentication:\n${log.authState}`);
      }
    }
  }

  panelLines.push('============================================================');
  const panelText = panelLines.join('\n');

  if (req.headers['accept'] && req.headers['accept'].includes('text/plain')) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(panelText);
  }

  return res.json({
    status: 'RUNNING',
    mode,
    targetOrigin,
    cloneId,
    requests: recentLogs,
    panelFormatted: panelText
  });
});

/**
 * Route handlers
 */
router.all('/clone/:id/*', (req, res) => {
  const subpath = '/' + (req.params[0] || '').replace(/^\/+/, '');
  return handleBridgeProxy(req, res, subpath);
});

router.all('/*', (req, res) => {
  return handleBridgeProxy(req, res);
});

module.exports = {
  bridgeProxyRouter: router,
  handleBridgeProxy
};
