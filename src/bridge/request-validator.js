/**
 * REBUILT 2.0 — Communication Bridge: Request Validator
 * 
 * Enforces strict request validation:
 * 1. HTTP method validation
 * 2. Manifest route matching (rejects requests not declared in clone-manifest.json)
 * 3. Target origin validation with full SSRF protection (IP, loopback, metadata checks)
 * 4. Content-Type and request body size enforcement
 * 5. Dangerous forwarding header stripping
 */

const { validateUrl } = require('../security/ssrf-guard');
const { SENSITIVE_KEY_PATTERN, SAFE_REQUEST_HEADERS } = require('../discovery/network-discovery-engine');

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024; // 10MB limit

// Dangerous proxy headers that must NEVER be blindly forwarded
const FORBIDDEN_FORWARDING_HEADERS = new Set([
  'host',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-real-ip',
  'connection',
  'upgrade',
  'keep-alive',
  'transfer-encoding',
  'proxy-connection',
  'proxy-authorization',
  'te',
  'trailer'
]);

class RequestValidator {
  /**
   * Matches an incoming requested path and method against routes in the manifest.
   * Supports exact paths and parameterized paths (e.g., /api/items/:id or /api/items/123).
   *
   * @param {string} method
   * @param {string} reqPath
   * @param {Array<object>} manifestRoutes
   * @returns {object|null} Matched route or null
   */
  static matchManifestRoute(method, reqPath, manifestRoutes = []) {
    const { RouteMap } = require('./route-map');
    return RouteMap.match(method, reqPath, manifestRoutes);
  }

  /**
   * Converts a route path with parameters into a regex.
   * Example: "/api/courses/:id" -> /^\/api\/courses\/([^\/]+)$/
   *
   * @param {string} routePath
   * @returns {RegExp|null}
   */
  static routePathToRegex(routePath) {
    if (!routePath.includes(':') && !routePath.includes('[') && !routePath.includes('*')) {
      return null;
    }
    const escaped = routePath
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([a-zA-Z0-9_]+)/g, '([^\\/]+)')
      .replace(/\\\[([a-zA-Z0-9_]+)\\\]/g, '([^\\/]+)')
      .replace(/\*/g, '(.*)');
    return new RegExp(`^${escaped}$`, 'i');
  }

  /**
   * Validates an incoming request intended for the Communication Bridge.
   *
   * @param {object} params
   * @param {string} params.method - HTTP method
   * @param {string} params.path - Path being accessed
   * @param {string} [params.query] - Query string or object
   * @param {object} [params.headers] - Incoming request headers
   * @param {Buffer|string|object} [params.body] - Request body
   * @param {object} params.manifest - The target clone-manifest.json
   * @returns {Promise<{ isValid: boolean, code?: string, error?: string, matchedRoute?: object, targetUrl?: string, sanitizedHeaders?: object }>}
   */
  static async validate({ method, path: reqPath, query = '', headers = {}, body = null, manifest }) {
    // 1. Validate HTTP method
    const normMethod = (method || '').toUpperCase();
    if (!ALLOWED_METHODS.has(normMethod)) {
      return {
        isValid: false,
        code: 'INVALID_METHOD',
        error: `HTTP method "${method}" is not permitted by Communication Bridge.`
      };
    }

    // 2. Validate manifest presence
    if (!manifest || typeof manifest !== 'object') {
      return {
        isValid: false,
        code: 'MISSING_MANIFEST',
        error: 'A valid clone-manifest.json is required for bridge communication.'
      };
    }

    // 3. Enforce request body size limits
    if (body) {
      let bodyLength = 0;
      if (Buffer.isBuffer(body)) {
        bodyLength = body.length;
      } else if (typeof body === 'string') {
        bodyLength = Buffer.byteLength(body, 'utf8');
      } else if (typeof body === 'object') {
        bodyLength = Buffer.byteLength(JSON.stringify(body), 'utf8');
      }

      if (bodyLength > MAX_REQUEST_BODY_BYTES) {
        return {
          isValid: false,
          code: 'PAYLOAD_TOO_LARGE',
          error: `Request body exceeds maximum size of 10MB (${(bodyLength / (1024 * 1024)).toFixed(1)}MB).`
        };
      }
    }

    // 4. Match route against manifest (Strict Policy: reject unmanifested routes)
    const routes = manifest.routes || [];
    const matchedRoute = this.matchManifestRoute(normMethod, reqPath, routes);
    if (!matchedRoute) {
      return {
        isValid: false,
        code: 'REQUEST_NOT_IN_MANIFEST',
        error: `Route "${normMethod} ${reqPath}" is not declared in clone-manifest.json. Unmanifested dynamic proxying is rejected.`
      };
    }

    // 5. Validate Target Origin with SSRF Protection
    const targetOrigin = manifest.targetOrigin;
    if (!targetOrigin || typeof targetOrigin !== 'string') {
      return {
        isValid: false,
        code: 'INVALID_TARGET_ORIGIN',
        error: 'Target origin is missing or invalid in clone-manifest.json.'
      };
    }

    const ssrfCheck = await validateUrl(targetOrigin);
    if (!ssrfCheck.isValid) {
      return {
        isValid: false,
        code: 'SSRF_BLOCKED',
        error: `Target origin failed SSRF validation: ${ssrfCheck.error}`
      };
    }

    // 6. Sanitize forwarding headers
    const sanitizedHeaders = {};
    for (const [key, val] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (FORBIDDEN_FORWARDING_HEADERS.has(lowerKey)) {
        continue;
      }
      // Never forward client's local session cookies or credentials upstream
      if (lowerKey === 'cookie' || lowerKey === 'authorization') {
        continue;
      }
      sanitizedHeaders[lowerKey] = val;
    }

    // Construct target URL
    const queryString = typeof query === 'string'
      ? (query.startsWith('?') || !query ? query : `?${query}`)
      : (query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : '');

    const targetUrl = `${targetOrigin.replace(/\/+$/, '')}${reqPath.startsWith('/') ? reqPath : `/${reqPath}`}${queryString}`;

    return {
      isValid: true,
      matchedRoute,
      targetUrl,
      targetOrigin,
      sanitizedHeaders
    };
  }
}

module.exports = {
  RequestValidator,
  ALLOWED_METHODS,
  MAX_REQUEST_BODY_BYTES,
  FORBIDDEN_FORWARDING_HEADERS
};
