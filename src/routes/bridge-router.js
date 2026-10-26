/**
 * Rebuilt Communication Bridge Router
 * Endpoints for real-time EventStream (SSE), client-to-server messaging, and bridge telemetry.
 */

const express = require('express');
const { communicationBridge } = require('../bridge/communication-bridge');
const { urlWebBridge } = require('../bridge/url-web-bridge');

const router = express.Router();

/**
 * ALL /api/bridge/url
 * Live Web URL Bridge proxy: bridges any public web URL with real-time telemetry,
 * asset rewriting, and injected communication client.
 */
router.all('/url', (req, res) => {
  const targetUrl = req.query.url || (req.body && req.body.url);
  return urlWebBridge.handleBridgeRequest(req, res, targetUrl);
});

/**
 * POST /api/bridge/url/session
 * Registers a tracked URL Web Bridge session.
 */
router.post('/url/session', async (req, res) => {
  const { url, options } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing required "url" parameter in body' });
  }

  try {
    const session = await urlWebBridge.createSession(url, options);
    const bridgeUrl = urlWebBridge.buildBridgeUrl(url, session.id);
    return res.status(201).json({
      success: true,
      session,
      bridgeUrl
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/bridge/url/sessions
 * Lists active URL web bridge sessions.
 */
router.get('/url/sessions', (req, res) => {
  return res.json({ sessions: urlWebBridge.listSessions() });
});

/**
 * GET /api/bridge/events
 * Real-time Server-Sent Events (SSE) stream for Dashboard & Preview webviews.
 */
router.get('/events', (req, res) => {
  communicationBridge.subscribe(req, res);
});

/**
 * POST /api/bridge/message
 * Bidirectional messaging endpoint for frontend & in-page preview scripts.
 */
router.post('/message', (req, res) => {
  const message = req.body;
  if (!message || typeof message !== 'object') {
    return res.status(400).json({ error: 'Message body must be a valid JSON object' });
  }

  const senderInfo = {
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  };

  const response = communicationBridge.handleClientMessage(message, senderInfo);
  return res.json(response);
});

/**
 * GET /api/bridge/status
 * Diagnostic status and telemetry of the communication bridge.
 */
router.get('/status', (req, res) => {
  const status = communicationBridge.getStatus();
  return res.json(status);
});

/**
 * POST /api/bridge/broadcast
 * Allows services or authorized agents to trigger a broadcast event.
 */
router.post('/broadcast', (req, res) => {
  const { event, data, filter } = req.body || {};
  if (!event || typeof event !== 'string') {
    return res.status(400).json({ error: 'Missing "event" string parameter in body' });
  }

  const count = communicationBridge.broadcast(event, data || {}, filter || {});
  return res.json({ success: true, deliveredTo: count, event });
});

/**
 * REBUILT 2.0: Application Communication Bridge Routes
 * Directs dynamic requests matching clone-manifest.json to authorized target.
 */
const { applicationBridge } = require('../bridge/application-bridge');

/**
 * GET /api/bridge/audit
 * Returns safe operational audit telemetry of bridged requests.
 */
router.get('/audit', (req, res) => {
  return res.json({
    bridge: 'rebuilt_2.0',
    auditLogs: applicationBridge.getAuditLogs()
  });
});

/**
 * ALL /api/bridge/clone/:id/*
 * Bridge endpoint forwarding local frontend requests to authorized target server.
 */
router.all('/clone/:id/*', applicationBridge.createMiddleware());

module.exports = router;
