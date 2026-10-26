/**
 * Rebuilt URL Web Bridge
 * 
 * Creates a seamless bidirectional communication and live proxy bridge
 * between any remote web URL and the local Rebuilt web ecosystem.
 * 
 * Features:
 * 1. SSRF & Security isolation on all target URLs
 * 2. Full HTTP verb support (GET, POST, PUT, DELETE, OPTIONS)
 * 3. Dynamic HTML & CSS rewriting so sub-navigation and assets stay within the bridge
 * 4. Automatic injection of window.__REBUILT_BRIDGE__ client into bridged pages
 * 5. Real-time telemetry broadcasting to the communication bridge & dashboard
 * 6. Authorized session & cookie persistence via sessionVault
 */

const { URL } = require('url');
const crypto = require('crypto');
const { validateUrl } = require('../security/ssrf-guard');
const sessionVault = require('../security/session-vault');
const { communicationBridge } = require('./communication-bridge');

class UrlWebBridge {
  constructor() {
    // Active bridged URL sessions: sessionId -> { id, targetUrl, origin, createdAt, requestCount, lastActive }
    this.sessions = new Map();
    // Cache for static assets fetched via the URL bridge
    this.assetCache = new Map();
    this.maxCacheEntries = 300;
  }

  /**
   * Generates a unique bridge session ID.
   */
  generateSessionId() {
    return 'ubridge_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  }

  /**
   * Creates or registers a new URL Web Bridge session.
   * 
   * @param {string} targetUrl 
   * @param {object} [options] 
   * @returns {Promise<object>}
   */
  async createSession(targetUrl, options = {}) {
    if (!targetUrl || typeof targetUrl !== 'string') {
      throw new Error('A valid target URL is required.');
    }

    const validation = await validateUrl(targetUrl);
    if (!validation.isValid) {
      throw new Error(`Target URL security check failed: ${validation.error}`);
    }

    const sanitizedUrl = validation.sanitizedUrl;
    const parsed = new URL(sanitizedUrl);
    const sessionId = this.generateSessionId();

    const session = {
      id: sessionId,
      targetUrl: sanitizedUrl,
      origin: parsed.origin,
      host: parsed.hostname,
      createdAt: Date.now(),
      requestCount: 0,
      lastActive: Date.now(),
      options: options || {}
    };

    this.sessions.set(sessionId, session);

    communicationBridge.broadcast('bridge:url_session_created', {
      sessionId,
      targetUrl: sanitizedUrl,
      origin: parsed.origin
    });

    return session;
  }

  /**
   * Gets an active session by ID.
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Lists all active URL bridge sessions.
   */
  listSessions() {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      targetUrl: s.targetUrl,
      origin: s.origin,
      createdAt: s.createdAt,
      requestCount: s.requestCount,
      lastActive: s.lastActive
    }));
  }

  /**
   * Builds the local bridge proxy URL for any destination URL.
   * 
   * @param {string} destinationUrl 
   * @param {string} [sessionId] 
   * @returns {string}
   */
  buildBridgeUrl(destinationUrl, sessionId = null) {
    const encoded = encodeURIComponent(destinationUrl);
    let url = `/api/bridge/url?url=${encoded}`;
    if (sessionId) {
      url += `&session=${sessionId}`;
    }
    return url;
  }

  /**
   * Handles incoming HTTP requests to bridge a live web URL.
   * 
   * @param {import('express').Request} req 
   * @param {import('express').Response} res 
   * @param {string} rawTargetUrl 
   */
  async handleBridgeRequest(req, res, rawTargetUrl) {
    const startTime = Date.now();

    // Handle OPTIONS Preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      return res.sendStatus(204);
    }

    if (!rawTargetUrl) {
      return res.status(400).json({ error: 'Missing target "url" parameter for web bridge' });
    }

    // Validate URL security & SSRF
    const validation = await validateUrl(rawTargetUrl);
    if (!validation.isValid) {
      communicationBridge.broadcast('bridge:url_error', {
        url: rawTargetUrl,
        error: validation.error,
        code: 'SSRF_BLOCKED'
      });
      return res.status(403).json({ error: 'SSRF Blocked', message: validation.error });
    }

    const targetUrl = validation.sanitizedUrl;
    const targetParsed = new URL(targetUrl);
    const host = targetParsed.hostname;
    const sessionId = req.query.session || null;

    if (sessionId && this.sessions.has(sessionId)) {
      const sess = this.sessions.get(sessionId);
      sess.requestCount++;
      sess.lastActive = Date.now();
    }

    // Broadcast request inception over communication bridge
    communicationBridge.broadcast('bridge:url_request', {
      method: req.method,
      url: targetUrl,
      host,
      sessionId,
      clientIp: req.ip
    });

    // Check cache for GET static assets
    if (req.method === 'GET' && this.assetCache.has(targetUrl)) {
      const cached = this.assetCache.get(targetUrl);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Rebuilt-Bridge-Cache', 'HIT');

      communicationBridge.broadcast('bridge:url_response', {
        method: req.method,
        url: targetUrl,
        status: 200,
        cached: true,
        durationMs: Date.now() - startTime
      });

      return res.send(cached.buffer);
    }

    try {
      const authorizedSession = sessionVault.getSession(host);
      const forwardHeaders = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': req.headers['accept'] || '*/*',
        'Referer': targetUrl
      };

      if (authorizedSession) {
        if (authorizedSession.cookies) forwardHeaders['Cookie'] = authorizedSession.cookies;
        if (authorizedSession.headers) Object.assign(forwardHeaders, authorizedSession.headers);
      }

      if (req.headers['content-type']) {
        forwardHeaders['Content-Type'] = req.headers['content-type'];
      }

      const fetchOptions = {
        method: req.method,
        headers: forwardHeaders,
        signal: AbortSignal.timeout(18000)
      };

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body) {
        fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      }

      const response = await fetch(targetUrl, fetchOptions);

      if (authorizedSession) {
        const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : response.headers.get('set-cookie');
        if (setCookies) sessionVault.updateCookiesFromSetCookie(host, setCookies);
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const isHtml = contentType.includes('text/html');
      const isCss = contentType.includes('text/css');

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Content-Type', contentType);
      res.status(response.status);

      if (isHtml) {
        // Rewrite HTML so navigation and subresources route through the URL Web Bridge
        const rawHtml = await response.text();
        const rewrittenHtml = this.rewriteHtmlForWebBridge(rawHtml, targetUrl, sessionId);

        communicationBridge.broadcast('bridge:url_response', {
          method: req.method,
          url: targetUrl,
          status: response.status,
          type: 'html',
          bytes: Buffer.byteLength(rewrittenHtml, 'utf8'),
          durationMs: Date.now() - startTime
        });

        return res.send(rewrittenHtml);
      } else if (isCss) {
        // Rewrite CSS url(...) references
        const rawCss = await response.text();
        const rewrittenCss = this.rewriteCssForWebBridge(rawCss, targetUrl, sessionId);

        communicationBridge.broadcast('bridge:url_response', {
          method: req.method,
          url: targetUrl,
          status: response.status,
          type: 'css',
          bytes: Buffer.byteLength(rewrittenCss, 'utf8'),
          durationMs: Date.now() - startTime
        });

        return res.send(rewrittenCss);
      } else {
        // Binary or stream asset (images, fonts, audio, video, json)
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (req.method === 'GET' && response.ok && buffer.length < 5 * 1024 * 1024) {
          if (this.assetCache.size >= this.maxCacheEntries) {
            const firstKey = this.assetCache.keys().next().value;
            this.assetCache.delete(firstKey);
          }
          this.assetCache.set(targetUrl, { contentType, buffer });
        }

        communicationBridge.broadcast('bridge:url_response', {
          method: req.method,
          url: targetUrl,
          status: response.status,
          type: 'binary',
          bytes: buffer.length,
          durationMs: Date.now() - startTime
        });

        return res.send(buffer);
      }
    } catch (err) {
      console.error(`[UrlWebBridge] Error fetching ${targetUrl}:`, err.message);
      communicationBridge.broadcast('bridge:url_error', {
        url: targetUrl,
        error: err.message,
        durationMs: Date.now() - startTime
      });
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(502).json({
        error: 'URL Web Bridge Fetch Failure',
        targetUrl,
        message: err.message
      });
    }
  }

  /**
   * Rewrites HTML content so that all links, forms, and scripts route through the URL Web Bridge,
   * and injects the client-side communication bridge.
   * 
   * @param {string} html 
   * @param {string} baseUrl 
   * @param {string} [sessionId] 
   * @returns {string}
   */
  rewriteHtmlForWebBridge(html, baseUrl, sessionId) {
    if (!html || typeof html !== 'string') return html;

    const baseOrigin = new URL(baseUrl).origin;

    // Helper to rewrite any URL to bridge format
    const toBridgeUrl = (raw) => {
      if (!raw || typeof raw !== 'string') return raw;
      const clean = raw.trim();
      if (!clean || /^(javascript:|mailto:|tel:|data:|blob:|#)/i.test(clean)) return clean;
      try {
        const abs = new URL(clean, baseUrl).toString();
        return this.buildBridgeUrl(abs, sessionId);
      } catch (_) {
        return clean;
      }
    };

    let rewritten = html;

    // 1. Rewrite <a href="...">
    rewritten = rewritten.replace(/(<a\b[^>]*\bhref=["'])([^"']+)(["'][^>]*>)/gi, (m, p1, href, p2) => {
      return `${p1}${toBridgeUrl(href)}${p2}`;
    });

    // 2. Rewrite <form action="...">
    rewritten = rewritten.replace(/(<form\b[^>]*\baction=["'])([^"']+)(["'][^>]*>)/gi, (m, p1, action, p2) => {
      return `${p1}${toBridgeUrl(action)}${p2}`;
    });

    // 3. Rewrite <img src="..." and <script src="..."> and <link href="...">
    rewritten = rewritten.replace(/(<(?:img|script|source)\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (m, p1, src, p2) => {
      return `${p1}${toBridgeUrl(src)}${p2}`;
    });

    rewritten = rewritten.replace(/(<link\b[^>]*\bhref=["'])([^"']+)(["'][^>]*>)/gi, (m, p1, href, p2) => {
      return `${p1}${toBridgeUrl(href)}${p2}`;
    });

    // 4. Inject In-Page Communication Bridge Script
    const bridgeScript = `
    <!-- Rebuilt Live URL Web Bridge Client -->
    <script id="rebuilt-url-web-bridge">
    (function() {
      if (window.__REBUILT_URL_BRIDGE__) return;

      var currentTargetUrl = ${JSON.stringify(baseUrl)};
      var sessionId = ${JSON.stringify(sessionId || '')};

      var bridge = {
        targetUrl: currentTargetUrl,
        sessionId: sessionId,
        send: function(action, payload) {
          var msg = {
            action: action,
            payload: payload || {},
            url: window.location.href,
            targetUrl: currentTargetUrl,
            sessionId: sessionId,
            timestamp: Date.now()
          };

          if (window.parent && window.parent !== window) {
            try {
              window.parent.postMessage({ type: 'rebuilt_bridge_message', ...msg }, '*');
            } catch (_) {}
          }

          try {
            fetch('/api/bridge/message', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg),
              keepalive: true
            }).catch(function() {});
          } catch (_) {}
        }
      };

      window.__REBUILT_URL_BRIDGE__ = bridge;

      // Intercept and bridge unhandled fetch calls
      var originalFetch = window.fetch;
      if (originalFetch) {
        window.fetch = function(input, init) {
          var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
          if (url && !url.startsWith('/api/bridge/url') && !url.startsWith('data:') && !url.startsWith('blob:')) {
            try {
              var abs = new URL(url, currentTargetUrl).toString();
              var bridged = '/api/bridge/url?url=' + encodeURIComponent(abs) + (sessionId ? '&session=' + encodeURIComponent(sessionId) : '');
              if (typeof input === 'string') {
                input = bridged;
              } else if (input && input.url) {
                input = new Request(bridged, init);
              }
            } catch (_) {}
          }
          return originalFetch.call(this, input, init);
        };
      }

      // Signal live bridge page connected
      window.addEventListener('DOMContentLoaded', function() {
        bridge.send('url_bridge_ready', {
          title: document.title,
          url: currentTargetUrl
        });
      });
    })();
    </script>
    `;

    if (/<head[^>]*>/i.test(rewritten)) {
      rewritten = rewritten.replace(/(<head[^>]*>)/i, `$1\n${bridgeScript}\n`);
    } else {
      rewritten = `${bridgeScript}\n${rewritten}`;
    }

    return rewritten;
  }

  /**
   * Rewrites CSS url(...) references.
   */
  rewriteCssForWebBridge(css, baseUrl, sessionId) {
    if (!css || typeof css !== 'string') return css;
    return css.replace(/\burl\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, url) => {
      const clean = url.trim();
      if (!clean || /^(data:|blob:|#)/i.test(clean)) return m;
      try {
        const abs = new URL(clean, baseUrl).toString();
        return `url("${this.buildBridgeUrl(abs, sessionId)}")`;
      } catch (_) {
        return m;
      }
    });
  }
}

const urlWebBridge = new UrlWebBridge();
module.exports = {
  urlWebBridge,
  UrlWebBridge
};
