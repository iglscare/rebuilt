/**
 * REBUILT 2.0 — Communication Bridge: Target Dispatcher
 * 
 * Safely dispatches validated requests to the remote target server:
 * 1. Enforces strict connection timeouts
 * 2. Validates redirect destinations with SSRF protection
 * 3. Enforces response payload limits
 * 4. Captures dynamic session cookies into Encrypted Session Vault when authorized
 * 5. Logs safe operational telemetry
 */

const { isSafeRedirect } = require('../security/ssrf-guard');
const sessionVault = require('../security/session-vault');
const { communicationBridge } = require('./communication-bridge');
const { MAX_RESPONSE_BYTES } = require('./response-normalizer');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

class TargetDispatcher {
  /**
   * Dispatches an HTTP request to the target server.
   *
   * @param {object} params
   * @param {string} params.targetUrl - Validated target URL
   * @param {string} params.method - HTTP method
   * @param {object} [params.headers] - Sanitized headers
   * @param {any} [params.body] - Request body
   * @param {number} [params.timeout=15000] - Request timeout in ms
   * @param {boolean} [params.requiresAuth=false] - Whether route requires authorized credentials
   * @returns {Promise<{ status: number, statusText: string, headers: Headers, buffer: Buffer, durationMs: number }>}
   */
  static async dispatch({ targetUrl, method = 'GET', headers = {}, body = null, timeout = DEFAULT_TIMEOUT_MS, requiresAuth = false, cloneId = null }) {
    const startTime = Date.now();
    const parsedTarget = new URL(targetUrl);
    const targetHost = parsedTarget.hostname;

    // Inject authorized session credentials from SessionManager or Encrypted Session Vault
    const dispatchHeaders = { ...headers };
    if (requiresAuth) {
      try {
        const { sessionManager } = require('../auth/sessions/session-manager');
        const session = cloneId
          ? sessionManager.getSession(cloneId, parsedTarget.origin)
          : null;

        if (session) {
          if (session.accessToken) {
            dispatchHeaders['authorization'] = `Bearer ${session.accessToken}`;
          }
          if (session.cookieHeader) {
            dispatchHeaders['cookie'] = session.cookieHeader;
          }
        } else {
          const authorizedSession = sessionVault.getSession(targetHost);
          if (authorizedSession && authorizedSession.cookieHeader) {
            dispatchHeaders['cookie'] = authorizedSession.cookieHeader;
          }
        }
      } catch (_) {}
    }

    communicationBridge.broadcast('bridge:dispatch', {
      method,
      url: targetUrl,
      requiresAuth,
      timestamp: new Date().toISOString()
    });

    let currentUrl = targetUrl;
    let redirectCount = 0;
    let finalResponse = null;

    while (redirectCount <= MAX_REDIRECTS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const fetchOptions = {
          method,
          headers: dispatchHeaders,
          redirect: 'manual', // Manual handling to audit redirect URLs for SSRF
          signal: controller.signal
        };

        if (body && !['GET', 'HEAD'].includes(method.toUpperCase())) {
          fetchOptions.body = typeof body === 'object' && !Buffer.isBuffer(body)
            ? JSON.stringify(body)
            : body;
        }

        const response = await fetch(currentUrl, fetchOptions);
        clearTimeout(timer);

        // Check for redirects
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          redirectCount++;
          const location = response.headers.get('location');
          if (!location) {
            finalResponse = response;
            break;
          }

          const resolvedRedirect = new URL(location, currentUrl).toString();
          const isSafe = await isSafeRedirect(resolvedRedirect);
          if (!isSafe) {
            throw new Error(`SSRF Violation: Target redirected to restricted destination: ${resolvedRedirect}`);
          }

          currentUrl = resolvedRedirect;
          continue;
        }

        finalResponse = response;
        break;
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          throw new Error(`Bridge request timed out after ${timeout / 1000}s while reaching ${targetUrl}`);
        }
        throw err;
      }
    }

    if (!finalResponse) {
      throw new Error(`Exceeded maximum redirect limit of ${MAX_REDIRECTS} for ${targetUrl}`);
    }

    // Capture and sync session cookies received upstream into Vault (never exposed to browser)
    try {
      const setCookie = finalResponse.headers.get('set-cookie');
      if (setCookie) {
        sessionVault.updateCookiesFromSetCookie(targetHost, setCookie);
      }
    } catch (_) {}

    // Read response buffer with size check
    const arrayBuffer = await finalResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_RESPONSE_BYTES) {
      throw new Error(`Target response payload exceeds maximum 20MB limit (${(buffer.length / (1024 * 1024)).toFixed(1)}MB).`);
    }

    const durationMs = Date.now() - startTime;

    communicationBridge.broadcast('bridge:response', {
      method,
      url: targetUrl,
      status: finalResponse.status,
      durationMs,
      byteSize: buffer.length
    });

    return {
      status: finalResponse.status,
      statusText: finalResponse.statusText,
      headers: finalResponse.headers,
      buffer,
      durationMs
    };
  }
}

module.exports = {
  TargetDispatcher,
  DEFAULT_TIMEOUT_MS,
  MAX_REDIRECTS
};
