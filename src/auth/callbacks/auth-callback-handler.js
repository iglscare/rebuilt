/**
 * REBUILT 2.0 — Auth Callback Handler
 * 
 * Express router handling authorized OAuth/OIDC callbacks and session control:
 * - GET /api/auth/login - Initiates OAuth flow with PKCE
 * - GET /api/auth/callback - Receives authorization code from identity provider
 * - GET /api/auth/session - Returns active session status (redacted)
 * - POST /api/auth/revoke - Revokes authorized session
 */

const express = require('express');
const { OAuthOidcAdapter } = require('../providers/oauth-oidc-adapter');
const { sessionManager } = require('../sessions/session-manager');
const { authFlowObserver, EVENT_TYPES } = require('../auth-flow-observer');
const { AuthDiagnosticsEngine } = require('../auth-diagnostics');
const { getCloneManifest } = require('../../storage/clone-storage');

const router = express.Router();

/**
 * GET /api/auth/login
 * Initiates the legitimate OAuth/OIDC flow for an authorized target application.
 */
router.get('/login', async (req, res) => {
  const cloneId = req.query.cloneId;
  if (!cloneId) {
    return res.status(400).json({ error: 'Missing required "cloneId" query parameter.' });
  }

  const manifest = await getCloneManifest(cloneId);
  if (!manifest) {
    return res.status(404).json({ error: `Manifest for clone "${cloneId}" not found.` });
  }

  const authConfig = manifest.auth || {};
  const authorizationEndpoint = req.query.authEndpoint || authConfig.authorizationEndpoint;
  const tokenEndpoint = req.query.tokenEndpoint || authConfig.tokenEndpoint;
  const clientId = req.query.clientId || authConfig.clientId || 'rebuilt-local-client';
  const scopes = req.query.scope ? req.query.scope.split(' ') : (authConfig.scopes || ['openid', 'profile', 'email']);

  if (!authorizationEndpoint) {
    return res.status(400).json({
      error: 'No authorizationEndpoint configured for this application.',
      code: 'AUTH_ENDPOINT_REQUIRED'
    });
  }

  const host = req.get('host');
  const protocol = req.protocol;
  const callbackUrl = `${protocol}://${host}/api/auth/callback`;

  try {
    const { authorizationUrl, state } = OAuthOidcAdapter.initiateAuthorization({
      cloneId,
      targetOrigin: manifest.targetOrigin,
      authorizationEndpoint,
      tokenEndpoint,
      clientId,
      scopes,
      callbackUrl
    });

    if (req.query.json === 'true') {
      return res.json({ authorizationUrl, state });
    }

    // Redirect user to the original identity provider
    return res.redirect(302, authorizationUrl);
  } catch (err) {
    return res.status(500).json({ error: err.message, code: 'AUTH_INIT_ERROR' });
  }
});

/**
 * GET /api/auth/callback
 * Handles the redirect callback from the identity provider after the user authenticates.
 */
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(403).json({
      error: `Identity provider authorization error: ${error}`,
      description: error_description,
      code: 'OAUTH_PROVIDER_DENIED'
    });
  }

  if (!code || !state) {
    return res.status(400).json({
      error: 'Missing required "code" or "state" parameters in authorization callback.',
      code: 'INVALID_CALLBACK_PARAMS'
    });
  }

  try {
    const result = await OAuthOidcAdapter.handleAuthorizationCallback({ code, state });

    // Redirect user back to local clone preview with active authorized session
    const previewRedirect = `/clones/${encodeURIComponent(result.cloneId)}/?authorized=true`;
    return res.redirect(302, previewRedirect);
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || 'AUTH_CALLBACK_FAILED'
    });
  }
});

/**
 * GET /api/auth/session
 * Checks if the specified clone has an active authorized session.
 */
router.get('/session', async (req, res) => {
  const cloneId = req.query.cloneId;
  if (!cloneId) {
    return res.status(400).json({ error: 'Missing required "cloneId" query parameter.' });
  }

  const manifest = await getCloneManifest(cloneId);
  const targetOrigin = manifest ? manifest.targetOrigin : (req.query.targetOrigin || '');

  if (!targetOrigin) {
    return res.status(400).json({ error: 'Target origin could not be resolved for clone.' });
  }

  const session = sessionManager.getSession(cloneId, targetOrigin);
  if (!session) {
    return res.json({
      authenticated: false,
      cloneId,
      targetOrigin,
      status: 'TARGET_REQUIRES_AUTHORIZATION'
    });
  }

  return res.json({
    authenticated: true,
    cloneId,
    targetOrigin,
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    userProfile: session.userProfile
  });
});

/**
 * POST /api/auth/revoke
 * Revokes the authorized session for a given clone.
 */
router.post('/revoke', async (req, res) => {
  const { cloneId, targetOrigin } = req.body || {};
  if (!cloneId) {
    return res.status(400).json({ error: 'Missing "cloneId" parameter in body.' });
  }

  let resolvedOrigin = targetOrigin;
  if (!resolvedOrigin) {
    const manifest = await getCloneManifest(cloneId);
    if (manifest) resolvedOrigin = manifest.targetOrigin;
  }

  if (resolvedOrigin) {
    sessionManager.revokeSession(cloneId, resolvedOrigin);
  } else {
    sessionManager.revokeAllCloneSessions(cloneId);
  }

  return res.json({ success: true, message: `Session revoked for clone "${cloneId}".` });
});

/**
 * POST /api/auth/diagnostic/event
 * Ingests client-side observed authentication lifecycle events.
 * Strips and redacts any sensitive attributes.
 */
router.post('/diagnostic/event', async (req, res) => {
  const { cloneId, eventType, payload = {} } = req.body || {};
  if (!cloneId) {
    return res.status(400).json({ error: 'Missing "cloneId" in request body.' });
  }
  if (!eventType) {
    return res.status(400).json({ error: 'Missing "eventType" in request body.' });
  }

  let recordedEvent = null;

  switch (eventType) {
    case EVENT_TYPES.FORM_DETECTED:
      recordedEvent = authFlowObserver.recordFormDetected(cloneId, payload);
      break;
    case EVENT_TYPES.FORM_INSPECTION:
      recordedEvent = authFlowObserver.recordFormInspection(cloneId, payload);
      break;
    case EVENT_TYPES.INPUT_EVENT_TRACE:
      recordedEvent = authFlowObserver.recordInputEvent(cloneId, payload);
      break;
    case EVENT_TYPES.TEST_MANUAL_TYPING:
      recordedEvent = authFlowObserver.recordManualTypingTest(cloneId, payload);
      break;
    case EVENT_TYPES.BUTTON_CLICK_ATTEMPT:
      recordedEvent = authFlowObserver.recordClickAttempt(cloneId, payload);
      break;
    case EVENT_TYPES.CLICK_BLOCKED_BY_DISABLED_STATE:
      recordedEvent = authFlowObserver.recordClickBlocked(cloneId, payload);
      break;
    case EVENT_TYPES.FORM_SUBMIT_ATTEMPT:
      recordedEvent = authFlowObserver.recordSubmitAttempt(cloneId, payload);
      break;
    case EVENT_TYPES.LOGIN_ACTION:
      recordedEvent = authFlowObserver.recordLoginAction(cloneId, payload);
      break;
    case EVENT_TYPES.REQUEST_STARTED:
      recordedEvent = authFlowObserver.recordRequestStarted(cloneId, payload);
      break;
    case EVENT_TYPES.RESPONSE:
    case EVENT_TYPES.REQUEST_COMPLETED:
      recordedEvent = authFlowObserver.recordResponse(cloneId, payload);
      break;
    case EVENT_TYPES.REDIRECT:
      recordedEvent = authFlowObserver.recordRedirect(cloneId, payload);
      break;
    case EVENT_TYPES.CHALLENGE_DETECTED:
      recordedEvent = authFlowObserver.recordChallenge(cloneId, payload);
      break;
    case EVENT_TYPES.SESSION_STATE_CHANGE:
      recordedEvent = authFlowObserver.recordSessionStateChange(cloneId, payload);
      break;
    case EVENT_TYPES.NETWORK_ERROR:
      recordedEvent = authFlowObserver.recordNetworkError(cloneId, payload);
      break;
    default:
      // Arbitrary safe event recording
      recordedEvent = authFlowObserver._record(cloneId, eventType, payload);
  }

  return res.json({
    success: true,
    cloneId,
    eventType,
    recordedAt: recordedEvent ? recordedEvent.timestamp : Date.now()
  });
});

/**
 * GET /api/auth/diagnostic/:cloneId
 * Returns the current technical authentication diagnostic report,
 * failure layer, checklist, chronological timeline, and formatted panel readout.
 */
router.get('/diagnostic/:cloneId', async (req, res) => {
  const { cloneId } = req.params;
  if (!cloneId) {
    return res.status(400).json({ error: 'Missing cloneId parameter.' });
  }

  let targetOrigin = '';
  try {
    const manifest = await getCloneManifest(cloneId);
    if (manifest) targetOrigin = manifest.targetOrigin || '';
  } catch (_) {}

  const events = authFlowObserver.getEvents(cloneId);
  const state = authFlowObserver.getState(cloneId);

  const report = AuthDiagnosticsEngine.diagnose({
    events,
    state,
    context: { cloneId, targetOrigin }
  });

  const panelReadout = AuthDiagnosticsEngine.formatPanelReadout(report);

  return res.json({
    cloneId,
    targetOrigin,
    ...report,
    panelReadout
  });
});

/**
 * POST /api/auth/diagnostic/:cloneId/reset
 * Resets observer event history and state for a clone to run a clean diagnostic test.
 */
router.post('/diagnostic/:cloneId/reset', (req, res) => {
  const { cloneId } = req.params;
  authFlowObserver.reset(cloneId);
  return res.json({ success: true, message: `Diagnostic observer reset for clone "${cloneId}".` });
});

module.exports = router;
