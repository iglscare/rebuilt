/**
 * REBUILT 2.0 — Network Discovery Engine
 * 
 * Observes, categorizes, and records all observable network activity during Playwright rendering:
 * - Fetch / XHR / REST APIs
 * - GraphQL queries & mutations
 * - JSON endpoints & form submissions
 * - WebSocket connections & protocols
 * - Server-Sent Events (SSE)
 * 
 * Automatically sanitizes sensitive data (passwords, tokens, cookies, auth secrets)
 * and generates a standardized `clone-manifest.json` for the Communication Bridge.
 */

const fs = require('fs');
const path = require('path');

// Sensitive header and field patterns that MUST never be stored or exposed
const SENSITIVE_KEY_PATTERN = /(auth|token|cookie|secret|password|passwd|api[-_]?key|session|bearer|jwt|credential|private|cert|ssh|access[-_]?key)/i;

// Safe headers allowed in request and response metadata
const SAFE_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'accept-encoding',
  'content-type',
  'content-length',
  'origin',
  'referer',
  'user-agent',
  'cache-control',
  'pragma',
  'x-requested-with'
]);

const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'expires',
  'etag',
  'last-modified',
  'vary',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers'
]);

class NetworkDiscoveryEngine {
  /**
   * @param {object} [options]
   * @param {string} [options.targetOrigin] - Base target URL/origin
   */
  constructor(options = {}) {
    this.targetOrigin = options.targetOrigin ? new URL(options.targetOrigin).origin : null;
    this.requests = new Map(); // id -> metadata
    this.routes = new Map();   // `${method}:${path}` -> routeEntry
    this.websockets = [];      // observed websocket endpoints
    this.sseStreams = [];      // observed SSE endpoints
    this.reqCounter = 0;
  }

  /**
   * Attach network observation listeners to a Playwright Page instance.
   * @param {import('playwright').Page} page
   */
  attachToPage(page) {
    if (!page || typeof page.on !== 'function') {
      throw new Error('A valid Playwright page instance is required to attach NetworkDiscoveryEngine.');
    }

    // 1. Observe outgoing requests (Fetch, XHR, Forms, GraphQL, etc.)
    page.on('request', (req) => {
      try {
        this.handleRequest(req);
      } catch (err) {
        // Non-blocking observation
      }
    });

    // 2. Observe incoming responses (Status, response shapes, SSE detection)
    page.on('response', async (res) => {
      try {
        await this.handleResponse(res);
      } catch (err) {
        // Non-blocking observation
      }
    });

    // 3. Observe WebSocket connections
    page.on('websocket', (ws) => {
      try {
        this.handleWebSocket(ws);
      } catch (err) {
        // Non-blocking observation
      }
    });
  }

  /**
   * Evaluates if a request represents a dynamic API, data exchange, or form submission.
   * @param {import('playwright').Request} req
   * @returns {boolean}
   */
  isApiOrDynamicRequest(req) {
    const resourceType = req.resourceType();
    const url = req.url();
    const method = req.method().toUpperCase();
    const headers = req.headers();
    const contentType = (headers['content-type'] || '').toLowerCase();
    const accept = (headers['accept'] || '').toLowerCase();

    // Direct dynamic resource types
    if (['fetch', 'xhr', 'websocket', 'eventsource'].includes(resourceType)) {
      return true;
    }

    // Dynamic methods (POST, PUT, DELETE, PATCH)
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return true;
    }

    // Content types indicating data exchange
    if (
      contentType.includes('application/json') ||
      contentType.includes('application/graphql') ||
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data') ||
      contentType.includes('text/event-stream') ||
      accept.includes('application/json') ||
      accept.includes('application/graphql')
    ) {
      return true;
    }

    // Common API path conventions
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      if (
        pathname.startsWith('/api/') ||
        pathname.startsWith('/v1/') ||
        pathname.startsWith('/v2/') ||
        pathname.startsWith('/v3/') ||
        pathname.startsWith('/graphql') ||
        pathname.startsWith('/rest/') ||
        pathname.startsWith('/oauth/') ||
        pathname.startsWith('/auth/') ||
        pathname.endsWith('.json')
      ) {
        return true;
      }
    } catch (_) {}

    return false;
  }

  /**
   * Handles an observed Playwright request.
   * @param {import('playwright').Request} req
   */
  handleRequest(req) {
    const urlStr = req.url();
    if (!urlStr || urlStr.startsWith('data:') || urlStr.startsWith('blob:')) {
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (_) {
      return;
    }

    if (!this.targetOrigin) {
      this.targetOrigin = parsedUrl.origin;
    }

    const isDynamic = this.isApiOrDynamicRequest(req);
    if (!isDynamic) {
      return;
    }

    this.reqCounter++;
    const id = `req_${Date.now()}_${this.reqCounter}`;
    const method = req.method().toUpperCase();
    const resourceType = req.resourceType();
    const headers = req.headers() || {};
    const contentType = headers['content-type'] || 'unknown';

    // Sanitize headers: strictly allow only safe headers, automatically redact/strip sensitive tokens
    const { allowedHeaders, hasAuthHeader } = this.sanitizeRequestHeaders(headers);

    // Sanitize query parameters: redact values for keys with sensitive naming
    const sanitizedQuery = this.sanitizeQueryParams(parsedUrl.searchParams);

    // Safely infer request body shape without capturing any passwords or credentials
    let requestBodyShape = null;
    const postData = req.postData();
    if (postData) {
      requestBodyShape = this.inferBodyShape(postData, contentType);
    }

    const initiator = req.initiator ? req.initiator() : null;

    const metadata = {
      id,
      method,
      origin: parsedUrl.origin,
      path: parsedUrl.pathname,
      query: sanitizedQuery,
      resourceType,
      contentType,
      status: null, // Populated on response
      requestHeadersAllowed: allowedHeaders,
      responseHeadersAllowed: {},
      responseContentType: null,
      requestBodyShape,
      responseShape: null,
      initiator: initiator ? (initiator.type || 'script') : 'script',
      requiresAuthentication: hasAuthHeader,
      discoveredAt: new Date().toISOString()
    };

    // Index by internal request URL + method to attach response later
    const lookupKey = `${method}:${urlStr}`;
    this.requests.set(lookupKey, metadata);

    // Register route in manifest route map
    this.registerRoute({
      method,
      path: parsedUrl.pathname,
      origin: parsedUrl.origin,
      resourceType,
      contentType,
      requiresAuthentication: hasAuthHeader,
      requestBodyShape
    });
  }

  /**
   * Handles an observed Playwright response.
   * @param {import('playwright').Response} res
   */
  async handleResponse(res) {
    const req = res.request();
    const urlStr = res.url();
    const method = req.method().toUpperCase();
    const lookupKey = `${method}:${urlStr}`;

    const metadata = this.requests.get(lookupKey);
    if (!metadata) {
      return;
    }

    const status = res.status();
    const headers = res.headers() || {};
    const responseContentType = headers['content-type'] || '';

    // Check for authorization signals (401, 403, or auth challenge header)
    if (status === 401 || status === 403 || headers['www-authenticate']) {
      metadata.requiresAuthentication = true;
    }

    // Sanitize response headers (never capture Set-Cookie values)
    metadata.status = status;
    metadata.responseContentType = responseContentType;
    metadata.responseHeadersAllowed = this.sanitizeResponseHeaders(headers);

    // Detect SSE streams
    if (responseContentType.includes('text/event-stream')) {
      this.sseStreams.push({
        path: metadata.path,
        origin: metadata.origin,
        status,
        discoveredAt: new Date().toISOString()
      });
    }

    // Safely infer response body shape (non-sensitive structure representation)
    if (status >= 200 && status < 300) {
      if (responseContentType.includes('application/json')) {
        try {
          const bodyText = await res.text().catch(() => null);
          if (bodyText) {
            metadata.responseShape = this.inferJsonShape(bodyText);
          }
        } catch (_) {}
      }
    }

    // Update corresponding route with enriched metadata
    const routeKey = `${metadata.method}:${metadata.path}`;
    const route = this.routes.get(routeKey);
    if (route) {
      route.status = status;
      route.responseContentType = responseContentType;
      if (metadata.requiresAuthentication) {
        route.requiresAuth = true;
      }
      if (metadata.responseShape && !route.responseShape) {
        route.responseShape = metadata.responseShape;
      }
    }
  }

  /**
   * Handles an observed Playwright WebSocket connection.
   * @param {import('playwright').WebSocket} ws
   */
  handleWebSocket(ws) {
    const wsUrl = ws.url();
    try {
      const parsed = new URL(wsUrl);
      const sanitizedQuery = this.sanitizeQueryParams(parsed.searchParams);
      
      this.websockets.push({
        url: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
        origin: `${parsed.protocol}//${parsed.host}`,
        path: parsed.pathname,
        query: sanitizedQuery,
        protocols: [],
        discoveredAt: new Date().toISOString()
      });

      // Also record in routes
      this.registerRoute({
        method: 'WS',
        path: parsed.pathname,
        origin: `${parsed.protocol}//${parsed.host}`,
        resourceType: 'websocket',
        contentType: 'websocket/stream',
        requiresAuthentication: Object.keys(sanitizedQuery).length > 0
      });
    } catch (_) {}
  }

  /**
   * Registers a unique route entry in the manifest routes map.
   * @param {object} param
   */
  registerRoute({ method, path, origin, resourceType, contentType, requiresAuthentication = false, requestBodyShape = null }) {
    const routeKey = `${method}:${path}`;
    if (!this.routes.has(routeKey)) {
      this.routes.set(routeKey, {
        method,
        path,
        origin,
        mode: 'proxy',
        resourceType,
        contentType,
        requiresAuth: requiresAuthentication,
        requestBodyShape,
        responseShape: null,
        status: null,
        discoveredAt: new Date().toISOString()
      });
    } else {
      const existing = this.routes.get(routeKey);
      if (requiresAuthentication) {
        existing.requiresAuth = true;
      }
      if (requestBodyShape && !existing.requestBodyShape) {
        existing.requestBodyShape = requestBodyShape;
      }
    }
  }

  /**
   * Sanitizes request headers:
   * Retains only safe forwarding headers.
   * Automatically detects and flags authorization markers without persisting credentials.
   *
   * @param {object} headers
   * @returns {{ allowedHeaders: object, hasAuthHeader: boolean }}
   */
  sanitizeRequestHeaders(headers) {
    const allowedHeaders = {};
    let hasAuthHeader = false;

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();

      // Flag sensitive headers indicating authentication requirement
      if (SENSITIVE_KEY_PATTERN.test(lowerKey)) {
        hasAuthHeader = true;
        continue; // Never store sensitive header values
      }

      if (SAFE_REQUEST_HEADERS.has(lowerKey)) {
        allowedHeaders[lowerKey] = value;
      }
    }

    return { allowedHeaders, hasAuthHeader };
  }

  /**
   * Sanitizes response headers:
   * Preserves caching, content metadata, and CORS headers.
   * Strips Set-Cookie and sensitive server markers.
   *
   * @param {object} headers
   * @returns {object}
   */
  sanitizeResponseHeaders(headers) {
    const allowedHeaders = {};

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();

      if (SENSITIVE_KEY_PATTERN.test(lowerKey)) {
        continue;
      }

      if (SAFE_RESPONSE_HEADERS.has(lowerKey)) {
        allowedHeaders[lowerKey] = value;
      }
    }

    return allowedHeaders;
  }

  /**
   * Sanitizes URL search query parameters:
   * Masks values of sensitive query parameters (e.g. token=***, key=***).
   *
   * @param {URLSearchParams} searchParams
   * @returns {object}
   */
  sanitizeQueryParams(searchParams) {
    const sanitized = {};
    for (const [paramKey, paramVal] of searchParams.entries()) {
      if (SENSITIVE_KEY_PATTERN.test(paramKey)) {
        sanitized[paramKey] = '[REDACTED]';
      } else {
        // Truncate overly long values
        sanitized[paramKey] = paramVal.length > 100 ? `${paramVal.slice(0, 100)}...` : paramVal;
      }
    }
    return sanitized;
  }

  /**
   * Safely infers the shape of a request body without recording secret values.
   *
   * @param {string} bodyStr
   * @param {string} contentType
   * @returns {object|null}
   */
  inferBodyShape(bodyStr, contentType = '') {
    if (!bodyStr || typeof bodyStr !== 'string') return null;

    if (contentType.includes('application/json') || bodyStr.trim().startsWith('{') || bodyStr.trim().startsWith('[')) {
      return this.inferJsonShape(bodyStr);
    }

    if (contentType.includes('application/x-www-form-urlencoded')) {
      try {
        const params = new URLSearchParams(bodyStr);
        const fields = [];
        for (const [key] of params.entries()) {
          fields.push({
            name: key,
            isSensitive: SENSITIVE_KEY_PATTERN.test(key)
          });
        }
        return { type: 'form-urlencoded', fields };
      } catch (_) {}
    }

    if (contentType.includes('multipart/form-data')) {
      return { type: 'multipart-form-data' };
    }

    return { type: 'raw', byteLength: Buffer.byteLength(bodyStr, 'utf8') };
  }

  /**
   * Safely infers structural shape of JSON content without recording sensitive values.
   *
   * @param {string|object} raw
   * @returns {object}
   */
  inferJsonShape(raw) {
    let parsed;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        return { type: 'unparseable_json' };
      }
    } else {
      parsed = raw;
    }

    if (Array.isArray(parsed)) {
      const sampleItem = parsed.length > 0 ? this.inferObjectShape(parsed[0]) : null;
      return {
        type: 'array',
        sampleCount: parsed.length,
        itemShape: sampleItem
      };
    }

    if (parsed && typeof parsed === 'object') {
      return this.inferObjectShape(parsed);
    }

    return { type: typeof parsed };
  }

  /**
   * Extracts schema fields of an object.
   * @param {object} obj
   * @returns {object}
   */
  inferObjectShape(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { type: typeof obj };
    }

    const fields = [];
    const keys = Object.keys(obj).slice(0, 30); // Inspect up to 30 schema fields

    for (const key of keys) {
      const val = obj[key];
      const isSensitive = SENSITIVE_KEY_PATTERN.test(key);
      const valType = Array.isArray(val) ? 'array' : typeof val;

      fields.push({
        field: key,
        type: valType,
        isSensitive
      });
    }

    return {
      type: 'object',
      fieldCount: Object.keys(obj).length,
      fields
    };
  }

  /**
   * Produces the standardized `clone-manifest.json` as specified in REBUILT 2.0 architecture.
   *
   * @param {object} [customOverrides]
   * @returns {object}
   */
  generateManifest(customOverrides = {}) {
    const routeEntries = Array.from(this.routes.values()).map((r) => ({
      method: r.method,
      path: r.path,
      mode: 'proxy',
      resourceType: r.resourceType || 'fetch',
      contentType: r.contentType || 'application/json',
      requiresAuth: Boolean(r.requiresAuth),
      ...(r.responseShape ? { responseShape: r.responseShape } : {}),
      ...(r.requestBodyShape ? { requestBodyShape: r.requestBodyShape } : {})
    }));

    const manifest = {
      version: '2.0.0',
      targetOrigin: this.targetOrigin || 'https://authorized-target.local',
      frontend: {
        mode: 'local'
      },
      communication: {
        mode: 'bridge'
      },
      routes: routeEntries,
      websockets: this.websockets.map((ws) => ({
        path: ws.path,
        url: ws.url,
        protocols: ws.protocols
      })),
      sse: this.sseStreams.map((s) => ({
        path: s.path,
        origin: s.origin
      })),
      stats: {
        totalObservedRequests: this.requests.size,
        apiRoutesCount: routeEntries.length,
        authRequiredCount: routeEntries.filter((r) => r.requiresAuth).length,
        websocketsCount: this.websockets.length,
        sseStreamsCount: this.sseStreams.length
      },
      generatedAt: new Date().toISOString(),
      ...customOverrides
    };

    return manifest;
  }

  /**
   * Returns all recorded request metadata objects.
   * @returns {Array<object>}
   */
  getRecordedRequests() {
    return Array.from(this.requests.values());
  }

  /**
   * Returns the list of discovered routes.
   * @returns {Array<object>}
   */
  getDiscoveredRoutes() {
    return Array.from(this.routes.values());
  }

  /**
   * Persists `clone-manifest.json` to the target directory.
   * @param {string} destinationDir
   * @param {object} [overrides]
   * @returns {Promise<string>} Manifest file path
   */
  async saveManifest(destinationDir, overrides = {}) {
    if (!destinationDir || typeof destinationDir !== 'string') {
      throw new Error('A valid directory path is required to save clone-manifest.json.');
    }

    if (!fs.existsSync(destinationDir)) {
      await fs.promises.mkdir(destinationDir, { recursive: true });
    }

    const manifest = this.generateManifest(overrides);
    const manifestPath = path.join(destinationDir, 'clone-manifest.json');
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    return manifestPath;
  }
}

module.exports = {
  NetworkDiscoveryEngine,
  SENSITIVE_KEY_PATTERN,
  SAFE_REQUEST_HEADERS,
  SAFE_RESPONSE_HEADERS
};
