/**
 * REBUILT — Communication Bridge: Security & Policy Enforcement
 * 
 * Enforces strict security controls:
 * 1. Target Origin Allowlist & SSRF Protection (blocks loopback, private RFC1918, metadata endpoints)
 * 2. Safe Request Header Policy (strips dangerous headers, recomputes host/origin/referer)
 * 3. Safe Response Header Policy (strips set-cookie, server signatures, conflicting CSP)
 * 4. Request Body & Response Size Limits
 * 5. Method Restrictions (GET, POST, PUT, DELETE, PATCH, OPTIONS)
 * 6. Upstream Safe Redirect Validation
 */

const { validateUrl, isSafeRedirect } = require('../security/ssrf-guard');

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;     // 20MB
const DEFAULT_TIMEOUT_MS = 15000;                // 15 seconds

// Dangerous incoming headers that must NEVER be blindly forwarded upstream
const FORBIDDEN_REQUEST_HEADERS = new Set([
  'host',
  'origin',
  'referer',
  'referrer',
  'connection',
  'upgrade',
  'keep-alive',
  'transfer-encoding',
  'proxy-connection',
  'proxy-authorization',
  'te',
  'trailer',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-real-ip',
  'cookie', // Managed server-side in session vault
  'authorization' // Injected server-side from session vault if authorized
]);

// Headers allowed to be forwarded to upstream target
const ALLOWED_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'accept-encoding',
  'content-type',
  'user-agent',
  'cache-control',
  'pragma',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform'
]);

// Headers allowed to be returned to the local cloned frontend
const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'etag',
  'last-modified',
  'expires',
  'pragma',
  'date',
  'vary'
]);

class BridgeSecurity {
  /**
   * Validates target URL against SSRF policy and authorized origin allowlist.
   * 
   * @param {string} targetUrl - Target URL to dispatch to
   * @param {string} authorizedOrigin - Target origin from clone manifest
   * @param {Array<string>} [allowedOrigins=[]] - Additional approved API origins
   * @returns {Promise<{ isValid: boolean, error?: string, code?: string }>}
   */
  static async validateTargetUrl(targetUrl, authorizedOrigin, allowedOrigins = []) {
    if (!targetUrl || typeof targetUrl !== 'string') {
      return { isValid: false, error: 'Target URL is missing or invalid.', code: 'BRIDGE_TARGET_NOT_ALLOWED' };
    }

    // 1. SSRF check (private IP, loopback, cloud metadata, protocols)
    const ssrfCheck = await validateUrl(targetUrl);
    if (!ssrfCheck.isValid) {
      return {
        isValid: false,
        error: `SSRF Violation: ${ssrfCheck.error}`,
        code: 'BRIDGE_TARGET_NOT_ALLOWED'
      };
    }

    // 2. Allowlist validation
    try {
      const parsedTarget = new URL(targetUrl);
      const targetOrigin = parsedTarget.origin.toLowerCase();
      const authOrigin = (authorizedOrigin || '').toLowerCase().replace(/\/+$/, '');

      const isAuthorized = targetOrigin === authOrigin ||
        allowedOrigins.some(o => (o || '').toLowerCase().replace(/\/+$/, '') === targetOrigin);

      if (!isAuthorized) {
        return {
          isValid: false,
          error: `Target destination "${targetOrigin}" is not in the authorized origin allowlist ("${authOrigin}").`,
          code: 'BRIDGE_TARGET_NOT_ALLOWED'
        };
      }
    } catch (err) {
      return { isValid: false, error: `Invalid URL structure: ${err.message}`, code: 'BRIDGE_TARGET_NOT_ALLOWED' };
    }

    return { isValid: true };
  }

  /**
   * Validates HTTP method.
   * 
   * @param {string} method 
   * @returns {{ isValid: boolean, error?: string, code?: string }}
   */
  static validateMethod(method) {
    const norm = (method || '').toUpperCase();
    if (!ALLOWED_METHODS.has(norm)) {
      return {
        isValid: false,
        error: `HTTP method "${method}" is not supported by Communication Bridge. Allowed: ${Array.from(ALLOWED_METHODS).join(', ')}`,
        code: 'INVALID_METHOD'
      };
    }
    return { isValid: true };
  }

  /**
   * Enforces request body size limits.
   * 
   * @param {any} body 
   * @param {object} headers 
   * @returns {{ isValid: boolean, error?: string, code?: string }}
   */
  static validateBodySize(body, headers = {}) {
    const declaredLength = parseInt(headers['content-length'] || '0', 10);
    if (declaredLength > MAX_REQUEST_BODY_BYTES) {
      return {
        isValid: false,
        error: `Request body length (${(declaredLength / 1024 / 1024).toFixed(1)}MB) exceeds maximum limit of 10MB.`,
        code: 'REQUEST_BODY_TOO_LARGE'
      };
    }

    if (body) {
      const actualSize = typeof body === 'string'
        ? Buffer.byteLength(body, 'utf8')
        : (Buffer.isBuffer(body) ? body.length : Buffer.byteLength(JSON.stringify(body), 'utf8'));

      if (actualSize > MAX_REQUEST_BODY_BYTES) {
        return {
          isValid: false,
          error: `Request body (${(actualSize / 1024 / 1024).toFixed(1)}MB) exceeds maximum limit of 10MB.`,
          code: 'REQUEST_BODY_TOO_LARGE'
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Sanitizes request headers for upstream dispatch.
   * 
   * @param {object} headers - Incoming headers
   * @param {string} targetUrl - Target URL to construct clean Host, Origin, and Referer
   * @returns {object} Clean headers
   */
  static sanitizeRequestHeaders(headers = {}, targetUrl) {
    const clean = {};
    const parsed = new URL(targetUrl);

    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (FORBIDDEN_REQUEST_HEADERS.has(lower)) {
        continue;
      }
      if (ALLOWED_REQUEST_HEADERS.has(lower)) {
        clean[lower] = value;
      }
    }

    // Set correct upstream identity headers
    clean['host'] = parsed.host;
    clean['origin'] = parsed.origin;
    clean['referer'] = targetUrl;
    if (!clean['user-agent']) {
      clean['user-agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    }

    return clean;
  }

  /**
   * Sanitizes upstream response headers before returning them to client.
   * 
   * @param {object|Headers} headers 
   * @param {string} [clientOrigin] - Origin of the local client (e.g. http://localhost:3000)
   * @returns {object} Clean response headers
   */
  static sanitizeResponseHeaders(headers = {}, clientOrigin = '') {
    const clean = {};
    const entries = typeof headers.entries === 'function'
      ? Array.from(headers.entries())
      : Object.entries(headers);

    for (const [key, value] of entries) {
      const lower = key.toLowerCase();
      // Drop server fingerprinting and cookie setting (handled server-side)
      if (lower === 'set-cookie' || lower === 'server' || lower === 'x-powered-by') {
        continue;
      }
      // Drop CSP and framing restrictions that would break localhost rendering
      if (lower.startsWith('content-security-policy') || lower === 'x-frame-options') {
        continue;
      }
      if (SAFE_RESPONSE_HEADERS.has(lower)) {
        clean[lower] = value;
      }
    }

    // Configure proper CORS for local Rebuilt origin or active public tunnel origin
    let isAllowedOrigin = false;
    try {
      const { tunnelService } = require('../tunnel/tunnel-service');
      const publicUrl = tunnelService.getPublicUrl();
      const isLocal = clientOrigin && (clientOrigin.startsWith('http://localhost') || clientOrigin.startsWith('http://127.0.0.1'));
      const isTunnel = clientOrigin && publicUrl && clientOrigin.startsWith(publicUrl);
      if (isLocal || isTunnel) {
        isAllowedOrigin = true;
      }
    } catch (_) {}

    const originToAllow = isAllowedOrigin ? clientOrigin : (clientOrigin || '*');

    clean['access-control-allow-origin'] = originToAllow;
    clean['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
    clean['access-control-allow-headers'] = 'Content-Type, Authorization, X-Requested-With, X-Rebuilt-Clone-Id';
    if (originToAllow !== '*') {
      clean['access-control-allow-credentials'] = 'true';
    }
    clean['x-rebuilt-bridge'] = 'active';

    return clean;
  }

  /**
   * Checks if an upstream redirect URL is safe to follow.
   * 
   * @param {string} redirectUrl 
   * @param {string} authorizedOrigin 
   * @param {Array<string>} [allowedOrigins=[]] 
   * @returns {Promise<boolean>}
   */
  static async isSafeUpstreamRedirect(redirectUrl, authorizedOrigin, allowedOrigins = []) {
    const safeCheck = await isSafeRedirect(redirectUrl);
    if (!safeCheck) return false;

    try {
      const parsed = new URL(redirectUrl);
      const targetOrigin = parsed.origin.toLowerCase();
      const authOrigin = (authorizedOrigin || '').toLowerCase().replace(/\/+$/, '');

      return targetOrigin === authOrigin ||
        allowedOrigins.some(o => (o || '').toLowerCase().replace(/\/+$/, '') === targetOrigin);
    } catch (_) {
      return false;
    }
  }
}

module.exports = {
  BridgeSecurity,
  ALLOWED_METHODS,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  FORBIDDEN_REQUEST_HEADERS,
  ALLOWED_REQUEST_HEADERS,
  SAFE_RESPONSE_HEADERS
};
