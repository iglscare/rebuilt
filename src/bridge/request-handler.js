/**
 * REBUILT — Communication Bridge: Request Handler
 * 
 * Central coordinator for executing bridged requests between local clone and target backend:
 * 1. Resolves manifest, mode (SNAPSHOT, LIVE_BRIDGE, HYBRID), and route mapping
 * 2. Enforces SSRF, method, body size, and origin allowlists
 * 3. Sanitizes headers and handles server-side session cookies
 * 4. Dispatches upstream with timeout and safe redirect inspection
 * 5. Integrates with AuthFlowObserver for auth status telemetry
 * 6. Maintains safe audit logging (redacts credentials, cookies, tokens)
 */

const { RouteMap } = require('./route-map');
const { BridgeSecurity, DEFAULT_TIMEOUT_MS } = require('./security');
const { ManifestManager, MODES } = require('./manifest');
const { bridgeSessionManager } = require('./session');
const { BridgeResponseHandler } = require('./response-handler');
const { authFlowObserver } = require('../auth/auth-flow-observer');

const MAX_AUDIT_LOGS = 200;
const MAX_REDIRECTS = 5;

class BridgeRequestHandler {
  constructor() {
    this.auditLogs = [];
  }

  /**
   * Forwards a local client request through the bridge to the authorized target backend.
   * 
   * @param {object} params
   * @param {string} [params.cloneId] - Clone identifier
   * @param {object} [params.manifest] - In-memory manifest override
   * @param {string} params.method - HTTP method (GET, POST, etc.)
   * @param {string} params.path - Requested path (e.g. /api/user)
   * @param {string|object} [params.query] - Query parameters
   * @param {object} [params.headers] - Request headers
   * @param {any} [params.body] - Request body
   * @param {string} [params.clientOrigin] - Origin of local frontend (e.g. http://localhost:3000)
   * @returns {Promise<{ status: number, headers: object, data: any, isBinary: boolean, durationMs: number }>}
   */
  async handleRequest({ cloneId, manifest: manifestOverride, method, path: reqPath, query = '', headers = {}, body = null, clientOrigin = '' }) {
    const startTime = Date.now();
    const normMethod = (method || 'GET').toUpperCase();

    // 1. Method validation
    const methodCheck = BridgeSecurity.validateMethod(normMethod);
    if (!methodCheck.isValid) {
      const err = new Error(methodCheck.error);
      err.code = methodCheck.code || 'INVALID_METHOD';
      err.statusCode = 405;
      throw err;
    }

    // 2. Resolve manifest
    const manifest = await ManifestManager.load(cloneId, manifestOverride);
    if (!manifest) {
      const err = new Error(`No clone-manifest.json found for clone ID "${cloneId || 'unknown'}".`);
      err.code = 'BRIDGE_ROUTE_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    // 3. Mode check: SNAPSHOT mode halts backend dispatch
    if (manifest.mode === MODES.SNAPSHOT) {
      const err = new Error('BRIDGE_MODE_SNAPSHOT: Cloned frontend is operating in SNAPSHOT mode. Live backend requests are disabled.');
      err.code = 'BRIDGE_MODE_SNAPSHOT';
      err.statusCode = 503;
      this.recordAudit({
        method: normMethod,
        localPath: reqPath,
        targetUrl: 'N/A (Snapshot)',
        status: 503,
        durationMs: 0,
        authState: 'SNAPSHOT',
        code: 'BRIDGE_MODE_SNAPSHOT'
      });
      throw err;
    }

    // 4. Request body size check
    const bodyCheck = BridgeSecurity.validateBodySize(body, headers);
    if (!bodyCheck.isValid) {
      const err = new Error(bodyCheck.error);
      err.code = bodyCheck.code;
      err.statusCode = 413;
      throw err;
    }

    // 5. Match route in manifest
    const matchedRoute = RouteMap.match(normMethod, reqPath, manifest.routes);
    if (!matchedRoute) {
      const err = new Error(`BRIDGE_ROUTE_NOT_FOUND: Request "${normMethod} ${reqPath}" is not declared in clone-manifest.json.`);
      err.code = 'BRIDGE_ROUTE_NOT_FOUND';
      err.statusCode = 403;
      this.recordAudit({
        method: normMethod,
        localPath: reqPath,
        targetUrl: 'UNKNOWN',
        status: 403,
        durationMs: 0,
        authState: 'ROUTE_NOT_FOUND',
        code: 'BRIDGE_ROUTE_NOT_FOUND'
      });
      throw err;
    }

    // 6. Check route authorization requirement
    if (matchedRoute.requiresAuth) {
      const parsedTargetHost = (new URL(manifest.targetOrigin)).hostname;
      const hasAuth = bridgeSessionManager.hasSession(cloneId, parsedTargetHost);
      if (!hasAuth) {
        const authErr = new Error('TARGET_REQUIRES_AUTHORIZATION: This route requires an authorized session with the target application.');
        authErr.code = 'TARGET_REQUIRES_AUTHORIZATION';
        authErr.statusCode = 401;
        this.recordAudit({
          method: normMethod,
          localPath: reqPath,
          targetUrl: manifest.targetOrigin,
          status: 401,
          durationMs: 0,
          authState: 'REQUIRES_AUTH',
          code: 'TARGET_REQUIRES_AUTHORIZATION'
        });
        throw authErr;
      }
    }

    // 7. Resolve upstream target URL
    const targetUrl = RouteMap.resolveTargetUrl(manifest.targetOrigin, matchedRoute.targetPath, query);

    // 8. Validate target URL against SSRF policy & allowed origins
    const targetCheck = await BridgeSecurity.validateTargetUrl(targetUrl, manifest.targetOrigin, manifest.allowedOrigins);
    if (!targetCheck.isValid) {
      const err = new Error(targetCheck.error);
      err.code = targetCheck.code;
      err.statusCode = 403;
      this.recordAudit({
        method: normMethod,
        localPath: reqPath,
        targetUrl,
        status: 403,
        durationMs: 0,
        authState: 'NOT_ALLOWED',
        code: targetCheck.code
      });
      throw err;
    }

    // 9. Sanitize request headers
    const sanitizedHeaders = BridgeSecurity.sanitizeRequestHeaders(headers, targetUrl);

    // 10. Inject authorized server-side cookies
    const parsedTarget = new URL(targetUrl);
    const targetHost = parsedTarget.hostname;
    const cookieHeader = bridgeSessionManager.getCookieHeader(cloneId, targetHost);
    if (cookieHeader) {
      sanitizedHeaders['cookie'] = cookieHeader;
    }

    // 11. Auth telemetry notification: Request Started
    const isAuthCandidate = matchedRoute.requiresAuth || /login|auth|session|account|token|ajax|checkpoint/i.test(reqPath);
    if (cloneId && isAuthCandidate) {
      authFlowObserver.recordRequestStarted(cloneId, {
        method: normMethod,
        origin: manifest.targetOrigin,
        path: reqPath,
        url: targetUrl,
        resourceType: 'bridge'
      });
    }

    // 12. Execute upstream fetch with timeout and safe redirect handling
    let currentUrl = targetUrl;
    let redirectCount = 0;
    let finalResponse = null;

    while (redirectCount <= MAX_REDIRECTS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      try {
        const fetchOptions = {
          method: normMethod,
          headers: sanitizedHeaders,
          redirect: 'manual', // Audit all redirects for SSRF
          signal: controller.signal
        };

        if (body && !['GET', 'HEAD'].includes(normMethod)) {
          fetchOptions.body = typeof body === 'object' && !Buffer.isBuffer(body)
            ? JSON.stringify(body)
            : body;
        }

        const response = await fetch(currentUrl, fetchOptions);
        clearTimeout(timer);

        // Handle upstream redirects
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          redirectCount++;
          const location = response.headers.get('location');
          if (!location) {
            finalResponse = response;
            break;
          }

          const resolvedRedirect = new URL(location, currentUrl).toString();
          const isSafeRedirect = await BridgeSecurity.isSafeUpstreamRedirect(resolvedRedirect, manifest.targetOrigin, manifest.allowedOrigins);
          if (!isSafeRedirect) {
            if (cloneId && isAuthCandidate) {
              authFlowObserver.recordRedirect(cloneId, {
                originalUrl: currentUrl,
                redirectUrl: resolvedRedirect,
                status: response.status,
                completed: false
              });
            }
            const redErr = new Error(`BRIDGE_REDIRECT_BLOCKED: Upstream redirected to untrusted destination: ${resolvedRedirect}`);
            redErr.code = 'BRIDGE_REDIRECT_BLOCKED';
            redErr.statusCode = 502;
            throw redErr;
          }

          if (cloneId && isAuthCandidate) {
            authFlowObserver.recordRedirect(cloneId, {
              originalUrl: currentUrl,
              redirectUrl: resolvedRedirect,
              status: response.status,
              completed: true
            });
          }

          currentUrl = resolvedRedirect;
          continue;
        }

        finalResponse = response;
        break;
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          if (cloneId && isAuthCandidate) {
            authFlowObserver.recordNetworkError(cloneId, {
              method: normMethod,
              url: targetUrl,
              errorType: 'TIMEOUT',
              message: `Bridge request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`
            });
          }
          const timeoutErr = new Error(`BRIDGE_TIMEOUT: Target server did not respond within ${DEFAULT_TIMEOUT_MS / 1000}s.`);
          timeoutErr.code = 'BRIDGE_TIMEOUT';
          timeoutErr.statusCode = 504;
          this.recordAudit({
            method: normMethod,
            localPath: reqPath,
            targetUrl,
            status: 504,
            durationMs: Date.now() - startTime,
            authState: 'TIMEOUT',
            code: 'BRIDGE_TIMEOUT'
          });
          throw timeoutErr;
        }

        if (err.code === 'BRIDGE_REDIRECT_BLOCKED') {
          this.recordAudit({
            method: normMethod,
            localPath: reqPath,
            targetUrl: currentUrl,
            status: 502,
            durationMs: Date.now() - startTime,
            authState: 'REDIRECT_BLOCKED',
            code: 'BRIDGE_REDIRECT_BLOCKED'
          });
          throw err;
        }

        if (cloneId && isAuthCandidate) {
          authFlowObserver.recordNetworkError(cloneId, {
            method: normMethod,
            url: targetUrl,
            errorType: 'NETWORK_FAILURE',
            message: err.message
          });
        }
        const netErr = new Error(`BRIDGE_NETWORK_ERROR: ${err.message}`);
        netErr.code = 'BRIDGE_NETWORK_ERROR';
        netErr.statusCode = 502;
        this.recordAudit({
          method: normMethod,
          localPath: reqPath,
          targetUrl,
          status: 502,
          durationMs: Date.now() - startTime,
          authState: 'NETWORK_ERROR',
          code: 'BRIDGE_NETWORK_ERROR'
        });
        throw netErr;
      }
    }

    if (!finalResponse) {
      const redLimitErr = new Error(`BRIDGE_REDIRECT_BLOCKED: Exceeded maximum redirect limit (${MAX_REDIRECTS}).`);
      redLimitErr.code = 'BRIDGE_REDIRECT_BLOCKED';
      redLimitErr.statusCode = 502;
      throw redLimitErr;
    }

    // 13. Capture server-side session cookies (never sent to client)
    const setCookie = finalResponse.headers.get('set-cookie');
    if (setCookie) {
      bridgeSessionManager.captureCookies(cloneId, targetHost, setCookie);
    }

    // 14. Read body buffer
    const arrayBuffer = await finalResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const durationMs = Date.now() - startTime;

    // 15. Normalize response
    const processed = BridgeResponseHandler.processResponse({
      status: finalResponse.status,
      headers: finalResponse.headers,
      buffer,
      clientOrigin,
      durationMs
    });

    // 16. Determine Auth State & notify observer
    let authState = 'NONE';
    if (isAuthCandidate) {
      const hasCookieNow = bridgeSessionManager.hasSession(cloneId, targetHost);
      const is2xx = finalResponse.status >= 200 && finalResponse.status < 300;
      const is4xx = finalResponse.status >= 400 && finalResponse.status < 500;

      // Check text content for security challenges
      const textPreview = typeof processed.data === 'string'
        ? processed.data
        : (typeof processed.data === 'object' ? JSON.stringify(processed.data) : '');

      if (/checkpoint|two_factor|mfa|otp/i.test(textPreview)) {
        authState = 'CHALLENGE_REQUIRED';
        if (cloneId) {
          authFlowObserver.recordChallenge(cloneId, {
            challengeType: /two_factor|mfa|otp/i.test(textPreview) ? 'MFA' : 'CHECKPOINT',
            description: 'Target requested additional challenge verification.'
          });
        }
      } else if (/turnstile|recaptcha|hcaptcha/i.test(textPreview)) {
        authState = 'CAPTCHA_REQUIRED';
        if (cloneId) {
          authFlowObserver.recordChallenge(cloneId, {
            challengeType: 'CAPTCHA',
            description: 'Target requested interactive CAPTCHA challenge.'
          });
        }
      } else if (is4xx) {
        authState = 'AUTH_REJECTED';
      } else if (is2xx && hasCookieNow) {
        authState = 'SUCCESS';
        if (cloneId) {
          authFlowObserver.recordAuthenticatedState(cloneId, {
            method: normMethod,
            url: targetUrl
          });
        }
      } else if (is2xx) {
        authState = 'SESSION NOT ESTABLISHED';
      }

      if (cloneId) {
        authFlowObserver.recordResponse(cloneId, {
          method: normMethod,
          origin: manifest.targetOrigin,
          path: reqPath,
          url: targetUrl,
          status: finalResponse.status,
          duration: durationMs,
          headers: processed.headers
        });
      }
    }

    // 17. Record safe audit log
    this.recordAudit({
      method: normMethod,
      localPath: reqPath,
      targetUrl,
      status: finalResponse.status,
      durationMs,
      byteSize: processed.byteLength,
      authState,
      code: finalResponse.status >= 500 ? 'BRIDGE_TARGET_5XX' : (finalResponse.status >= 400 ? 'BRIDGE_TARGET_4XX' : 'SUCCESS')
    });

    return processed;
  }

  /**
   * Records safe operational metadata (NEVER logs passwords, tokens, or cookies).
   */
  recordAudit(entry) {
    const d = new Date();
    const timeStr = [
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0')
    ].join(':');

    const safe = {
      time: timeStr,
      timestamp: d.toISOString(),
      method: entry.method,
      localPath: entry.localPath,
      targetUrl: entry.targetUrl,
      status: entry.status,
      durationMs: entry.durationMs || 0,
      byteSize: entry.byteSize || 0,
      authState: entry.authState || 'N/A',
      code: entry.code || null
    };

    this.auditLogs.unshift(safe);
    if (this.auditLogs.length > MAX_AUDIT_LOGS) {
      this.auditLogs.pop();
    }
  }

  /**
   * Returns recent audit logs.
   * @returns {Array<object>}
   */
  getAuditLogs() {
    return [...this.auditLogs];
  }
}

const bridgeRequestHandler = new BridgeRequestHandler();

module.exports = {
  BridgeRequestHandler,
  bridgeRequestHandler
};
