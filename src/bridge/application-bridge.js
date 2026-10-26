/**
 * REBUILT 2.0 — Application Communication Bridge
 * 
 * Bridges local frontend clone requests with authorized target servers:
 * 1. Matches requests against clone-manifest.json
 * 2. Enforces SSRF and security controls
 * 3. Dispatches authorized remote requests
 * 4. Normalizes and sanitizes responses for localhost
 * 5. Maintains safe audit logging
 */

const { RequestValidator } = require('./request-validator');
const { TargetDispatcher } = require('./target-dispatcher');
const { ResponseNormalizer } = require('./response-normalizer');
const { getCloneManifest } = require('../storage/clone-storage');
const { authFlowObserver } = require('../auth/auth-flow-observer');

class ApplicationCommunicationBridge {
  constructor() {
    this.auditLogs = [];
    this.maxLogs = 200;
  }

  /**
   * Forwards a local client request through the communication bridge to the authorized target.
   *
   * @param {object} params
   * @param {string} [params.cloneId] - Clone identifier to look up manifest
   * @param {object} [params.manifest] - In-memory manifest override
   * @param {string} params.method - HTTP method
   * @param {string} params.path - Path requested by client
   * @param {string|object} [params.query] - Query parameters
   * @param {object} [params.headers] - Request headers
   * @param {any} [params.body] - Request body
   * @returns {Promise<{ status: number, headers: object, data: any, isBinary: boolean, durationMs: number }>}
   */
  async forwardRequest({ cloneId, manifest, method, path, query = '', headers = {}, body = null }) {
    // 1. Resolve manifest
    let resolvedManifest = manifest;
    if (!resolvedManifest && cloneId) {
      resolvedManifest = await getCloneManifest(cloneId);
    }

    if (!resolvedManifest) {
      const err = new Error(`No clone-manifest.json found for clone ID: "${cloneId || 'unknown'}".`);
      err.code = 'MANIFEST_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    // 2. Validate request
    const validation = await RequestValidator.validate({
      method,
      path,
      query,
      headers,
      body,
      manifest: resolvedManifest
    });

    if (!validation.isValid) {
      this.recordAudit({
        method,
        path,
        status: 403,
        error: validation.error,
        code: validation.code,
        targetOrigin: resolvedManifest.targetOrigin
      });

      const err = new Error(validation.error);
      err.code = validation.code;
      err.statusCode = validation.code === 'REQUEST_NOT_IN_MANIFEST' ? 403 : 400;
      throw err;
    }

    const { targetUrl, matchedRoute, sanitizedHeaders } = validation;

    // 2b. Enforce authorized session requirement
    if (matchedRoute && matchedRoute.requiresAuth) {
      const { sessionManager } = require('../auth/sessions/session-manager');
      const hasSession = cloneId
        ? sessionManager.hasActiveSession(cloneId, resolvedManifest.targetOrigin)
        : false;

      if (!hasSession) {
        this.recordAudit({
          method,
          path,
          status: 401,
          code: 'TARGET_REQUIRES_AUTHORIZATION',
          targetOrigin: resolvedManifest.targetOrigin
        });

        const authErr = new Error('TARGET_REQUIRES_AUTHORIZATION: This route requires an authorized session. Please authenticate via the authorized identity provider.');
        authErr.code = 'TARGET_REQUIRES_AUTHORIZATION';
        authErr.statusCode = 401;
        throw authErr;
      }
    }

    const isAuthCandidate = (matchedRoute && matchedRoute.requiresAuth) || /login|auth|session|account|token|ajax|checkpoint/i.test(path);
    if (cloneId && isAuthCandidate) {
      authFlowObserver.recordRequestStarted(cloneId, {
        method,
        origin: resolvedManifest.targetOrigin,
        path,
        url: targetUrl,
        resourceType: 'bridge'
      });
    }

    // 3. Dispatch to remote target
    let dispatchResult;
    try {
      dispatchResult = await TargetDispatcher.dispatch({
        targetUrl,
        method,
        headers: sanitizedHeaders,
        body,
        requiresAuth: Boolean(matchedRoute.requiresAuth),
        cloneId
      });
    } catch (dispatchErr) {
      if (cloneId && isAuthCandidate) {
        authFlowObserver.recordNetworkError(cloneId, {
          method,
          url: targetUrl || path,
          errorType: 'NETWORK_FAILURE',
          message: dispatchErr.message
        });
      }
      throw dispatchErr;
    }

    // 4. Sanitize and normalize response
    const normalizedHeaders = ResponseNormalizer.sanitizeHeaders(dispatchResult.headers);
    const contentType = normalizedHeaders['content-type'] || '';
    const { data, isBinary, byteLength } = ResponseNormalizer.normalizeBody(dispatchResult.buffer, contentType);

    // 5. Record safe audit log
    this.recordAudit({
      method,
      path,
      targetOrigin: resolvedManifest.targetOrigin,
      status: dispatchResult.status,
      durationMs: dispatchResult.durationMs,
      byteSize: byteLength
    });

    if (cloneId && isAuthCandidate) {
      authFlowObserver.recordResponse(cloneId, {
        method,
        origin: resolvedManifest.targetOrigin,
        path,
        url: targetUrl,
        status: dispatchResult.status,
        duration: dispatchResult.durationMs,
        headers: normalizedHeaders
      });

      // Observable challenge detection (e.g. checkpoint, MFA, CAPTCHA)
      if (typeof data === 'string' || (data && typeof data === 'object')) {
        const textData = typeof data === 'string' ? data : JSON.stringify(data);
        if (/checkpoint_required|two_factor_required|challenge_required/i.test(textData)) {
          const cType = textData.includes('two_factor') ? 'MFA' : (textData.includes('checkpoint') ? 'INSTAGRAM_CHECKPOINT' : 'SECURITY_CHALLENGE');
          authFlowObserver.recordChallenge(cloneId, {
            challengeType: cType,
            description: `Target responded with ${cType}`
          });
        } else if (/turnstile|recaptcha|hcaptcha|cf-browser-verification/i.test(textData)) {
          authFlowObserver.recordChallenge(cloneId, {
            challengeType: 'CAPTCHA',
            description: 'Target responded with anti-bot / CAPTCHA challenge.'
          });
        }
      }
    }

    return {
      status: dispatchResult.status,
      headers: normalizedHeaders,
      data,
      isBinary,
      durationMs: dispatchResult.durationMs
    };
  }

  /**
   * Express middleware to handle bridge requests.
   * Mounts at `/api/bridge/clone/:id/*` or `/clones/:id/api/*`.
   */
  createMiddleware() {
    return async (req, res, next) => {
      const cloneId = req.params.id || req.params.cloneId;
      if (!cloneId) {
        return next();
      }

      // Universal CORS headers for all bridge responses
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');

      // Handle CORS preflight OPTIONS
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }

      // Determine requested path
      // If path is wildcard e.g. /clones/:id/api/courses -> path is /api/courses
      let reqPath = req.url.split('?')[0];
      if (req.params[0]) {
        reqPath = '/' + req.params[0].replace(/^\/+/, '');
      }

      try {
        const result = await this.forwardRequest({
          cloneId,
          method: req.method,
          path: reqPath,
          query: req.query,
          headers: req.headers,
          body: req.body
        });

        // Set response headers
        for (const [key, value] of Object.entries(result.headers)) {
          res.setHeader(key, value);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');

        res.status(result.status);
        if (result.isBinary) {
          return res.send(result.data);
        } else if (typeof result.data === 'object') {
          return res.json(result.data);
        } else {
          return res.send(result.data);
        }
      } catch (err) {
        // Fallback for unmanifested requests if targetOrigin is available:
        // Gracefully forward to remote target to keep dynamic SPA clones functional
        if (err.code === 'REQUEST_NOT_IN_MANIFEST') {
          try {
            const { getCloneManifest } = require('../storage/clone-storage');
            const manifest = await getCloneManifest(cloneId);
            if (manifest && manifest.targetOrigin) {
              const targetUrl = new URL(reqPath, manifest.targetOrigin).toString() + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
              const sanitizedHeaders = RequestValidator.sanitizeHeaders(req.headers);
              const dispatchResult = await TargetDispatcher.dispatch({
                targetUrl,
                method: req.method,
                headers: sanitizedHeaders,
                body: req.body
              });
              const normalized = ResponseNormalizer.normalize({
                status: dispatchResult.status,
                headers: dispatchResult.headers,
                rawBody: dispatchResult.body,
                byteLength: dispatchResult.byteLength
              });
              for (const [key, value] of Object.entries(normalized.headers)) {
                res.setHeader(key, value);
              }
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.status(normalized.status);
              return normalized.isBinary ? res.send(normalized.data) : (typeof normalized.data === 'object' ? res.json(normalized.data) : res.send(normalized.data));
            }
          } catch (_) {}
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({
          error: err.message,
          code: err.code || 'BRIDGE_DISPATCH_FAILURE',
          bridge: 'rebuilt_2.0'
        });
      }
    };
  }

  /**
   * Records safe operational metadata (never logs credentials, tokens, or cookies).
   */
  recordAudit(entry) {
    const safeEntry = {
      timestamp: new Date().toISOString(),
      method: entry.method,
      path: entry.path,
      targetOrigin: entry.targetOrigin,
      status: entry.status,
      durationMs: entry.durationMs || 0,
      byteSize: entry.byteSize || 0,
      code: entry.code || null
    };

    this.auditLogs.unshift(safeEntry);
    if (this.auditLogs.length > this.maxLogs) {
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

const applicationBridge = new ApplicationCommunicationBridge();

module.exports = {
  ApplicationCommunicationBridge,
  applicationBridge
};
