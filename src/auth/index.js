/**
 * REBUILT 2.0 — Authentication Subsystem Index
 */

const { AuthDetector } = require('./auth-detector');
const { SessionManager, sessionManager } = require('./sessions/session-manager');
const { OAuthOidcAdapter } = require('./providers/oauth-oidc-adapter');
const { AuthenticationFlowObserver, authFlowObserver, EVENT_TYPES } = require('./auth-flow-observer');
const { AuthDiagnosticsEngine, AUTH_CLASSIFICATION, FIRST_FAILURE, FAILURE_LAYER } = require('./auth-diagnostics');
const authRouter = require('./callbacks/auth-callback-handler');

module.exports = {
  AuthDetector,
  SessionManager,
  sessionManager,
  OAuthOidcAdapter,
  AuthenticationFlowObserver,
  authFlowObserver,
  AuthDiagnosticsEngine,
  AUTH_CLASSIFICATION,
  FIRST_FAILURE,
  FAILURE_LAYER,
  EVENT_TYPES,
  authRouter
};
