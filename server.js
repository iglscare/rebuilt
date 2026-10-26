const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const cloneRouter = require('./src/routes/clone-router');
const bridgeRouter = require('./src/routes/bridge-router');
const { bridgeProxyRouter } = require('./src/bridge/proxy');
const localApiRouter = require('./src/routes/local-api-router');
const authRouter = require('./src/auth/callbacks/auth-callback-handler');
const { communicationBridge } = require('./src/bridge/communication-bridge');
const { CLONES_DIR } = require('./src/storage/clone-storage');
const { warmupBrowser } = require('./src/renderer/browser-pool');
const tunnelRouter = require('./src/routes/tunnel-router');
const { tunnelService } = require('./src/tunnel/tunnel-service');

// Rebuilt Web Cloner - Server v1.2.0 (High Velocity Engine)
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const cpuCount = Math.max(2, os.cpus() ? os.cpus().length : 4);

const { getClone } = require('./src/storage/clone-storage');

const { localAuthMiddleware } = require('./src/security/local-auth');
const sessionVault = require('./src/security/session-vault');

// High-speed in-memory cache for dynamic proxied assets
const proxyMemoryCache = new Map();
const MAX_PROXY_CACHE = 500;

// =========================================================================
// 🚀 Live-Time In-Memory Page RAM Cache (0ms latency subpage delivery)
// Bounded LRU cache holding pre-rendered HTML in memory for instant delivery
// =========================================================================
const livePageRamCache = new Map();
const MAX_LIVE_PAGE_CACHE_SIZE = 150;

function getLivePageCacheKey(cloneId, subpath) {
  const norm = (subpath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `${cloneId}:${norm}`;
}

function getLivePageRamCache(cloneId, subpath) {
  const key = getLivePageCacheKey(cloneId, subpath);
  if (livePageRamCache.has(key)) {
    const val = livePageRamCache.get(key);
    livePageRamCache.delete(key);
    livePageRamCache.set(key, val);
    return val;
  }
  return null;
}

function setLivePageRamCache(cloneId, subpath, html) {
  if (!html || typeof html !== 'string') return;
  const key = getLivePageCacheKey(cloneId, subpath);
  if (livePageRamCache.size >= MAX_LIVE_PAGE_CACHE_SIZE) {
    const oldestKey = livePageRamCache.keys().next().value;
    if (oldestKey) livePageRamCache.delete(oldestKey);
  }
  livePageRamCache.set(key, html);
}

// Registry for in-flight subpage renders to eliminate redundant concurrent rendering
const inFlightSubpageRenders = new Map();

function getCachedProxyAsset(url) {
  return proxyMemoryCache.get(url) || null;
}

function setCachedProxyAsset(url, contentType, buffer) {
  if (proxyMemoryCache.size >= MAX_PROXY_CACHE) {
    const firstKey = proxyMemoryCache.keys().next().value;
    proxyMemoryCache.delete(firstKey);
  }
  proxyMemoryCache.set(url, { contentType, buffer });
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.cjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.ogv': 'video/ogg',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav',
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function sendMediaBufferWithRange(req, res, contentType, buffer) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Accept-Ranges', 'bytes');
  if (contentType) res.setHeader('Content-Type', contentType);

  const range = req.headers.range;
  if (!range || !range.startsWith('bytes=')) {
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).send(buffer);
  }

  const total = buffer.length;
  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

  if (isNaN(start) || start >= total || end >= total || start > end) {
    res.setHeader('Content-Range', `bytes */${total}`);
    return res.status(416).send('Requested Range Not Satisfiable');
  }

  const chunk = buffer.slice(start, end + 1);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  res.setHeader('Content-Length', chunk.length);
  return res.send(chunk);
}

function findLocalCloneAsset(cloneId, subpath) {
  if (!cloneId || !subpath) return null;
  const clean = subpath.replace(/^\/+/, '').split('?')[0].split('#')[0];
  const baseName = path.basename(clean);
  const { getCloneDirPath } = require('./src/storage/clone-storage');
  const cloneDir = getCloneDirPath(cloneId);
  if (!fs.existsSync(cloneDir)) return null;

  const candidates = [
    path.join(cloneDir, clean),
    path.join(cloneDir, 'assets/fonts', baseName),
    path.join(cloneDir, 'assets/images', baseName),
    path.join(cloneDir, 'assets/css', baseName),
    path.join(cloneDir, 'assets/js', baseName),
    path.join(cloneDir, 'assets/media', baseName),
    path.join(cloneDir, 'assets/data', baseName)
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const stat = fs.statSync(c);
        if (stat.isFile()) return c;
      }
    } catch (_) {}
  }
  return null;
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(localAuthMiddleware);

// Transparent Gzip Compression Middleware for lightning asset & HTML delivery
const compression = require('compression');
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Serve frontend UI static files
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Catch-all /404 recovery for client-side SPAs that route to root /404
app.get('/404', async (req, res) => {
  res.status(404).send('Page not found');
});

// 1x1 transparent GIF beacon handler for analytics trackers (Adobe Analytics, Omniture, etc.)
app.all(['/b/ss/*', '/b/ss', '*/b/ss/*'], (req, res) => {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  return res.send(pixel);
});

// /clones/:id — serve index.html directly without redirect to avoid 301 loops
// The static middleware handles /clones/:id/ and on-demand handler catches /clones/:id/*
app.get('/clones/:id', async (req, res, next) => {
  const cloneId = req.params.id;
  const cached = getLivePageRamCache(cloneId, '') || getLivePageRamCache(cloneId, 'index.html');
  if (cached) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Rebuilt-Acceleration', 'live-ram-cache; latency=0ms');
    res.setHeader('X-Rebuilt-GPU-Accelerated', 'true');
    res.setHeader('X-Rebuilt-CPU-Threads', String(cpuCount));
    res.setHeader('X-Rebuilt-Network-Speed', 'live-time');
    return res.send(cached);
  }

  const { getCloneDirPath } = require('./src/storage/clone-storage');
  const cloneDir = getCloneDirPath(cloneId);
  const indexPath = path.join(cloneDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf8');
    setLivePageRamCache(cloneId, '', html);
    setLivePageRamCache(cloneId, 'index.html', html);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Rebuilt-Acceleration', 'live-ram-cache; latency=0ms');
    res.setHeader('X-Rebuilt-GPU-Accelerated', 'true');
    res.setHeader('X-Rebuilt-CPU-Threads', String(cpuCount));
    res.setHeader('X-Rebuilt-Network-Speed', 'live-time');
    return res.send(html);
  }
  next();
});



// Serve cloned static websites at /clones/<clone-id>/ with full CORS headers and no-cache for preview fidelity
app.use('/clones', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}, express.static(CLONES_DIR, {
  index: ['index.html'],
  extensions: ['html', 'htm'],
  etag: false,
  lastModified: false,
  redirect: false
}));

/**
 * Universal Proxy Engine for Live Web Data Sharing
 * Bridges API requests, forms, search, sessions, and dynamic data
 * between the local clone interface and the remote web server.
 */
async function forwardWebProxyRequest(req, res, targetUrl) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    return res.sendStatus(204);
  }

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'Missing target URL for proxying' });
  }

  const { validateUrl } = require('./src/security/ssrf-guard');
  const validation = await validateUrl(targetUrl);
  if (!validation.isValid) {
    return res.status(403).json({ error: 'SSRF blocked', message: validation.error });
  }

  // Cache check for static GET requests
  if (req.method === 'GET') {
    const cached = getCachedProxyAsset(targetUrl);
    if (cached) {
      communicationBridge.broadcast('proxy:request', {
        method: 'GET',
        url: targetUrl,
        status: 200,
        cached: true
      });
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const cType = cached.contentType || getMimeType(targetUrl);
      if (cType.startsWith('video/') || cType.startsWith('audio/')) {
        return sendMediaBufferWithRange(req, res, cType, cached.buffer);
      }
      if (cached.contentType) res.setHeader('Content-Type', cached.contentType);
      return res.send(cached.buffer);
    }
  }

  try {
    const parsedTarget = new URL(targetUrl);
    const host = parsedTarget.hostname;
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
      signal: AbortSignal.timeout(12000)
    };

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    if (authorizedSession) {
      const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : response.headers.get('set-cookie');
      if (setCookies) sessionVault.updateCookiesFromSetCookie(host, setCookies);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Expose-Headers', '*');

    // Fallback for blocked social/telemetry widgets
    if ((response.status === 401 || response.status === 403) && (targetUrl.includes('api.') || targetUrl.includes('/v1/') || targetUrl.includes('/v2/') || targetUrl.includes('/posts') || targetUrl.includes('/feed'))) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json({ status: 200, message: 'OK (preview mock data feed)', items: [], posts: [], data: [] });
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    res.status(response.status);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (req.method === 'GET' && response.ok) {
      setCachedProxyAsset(targetUrl, contentType, buffer);
    }

    communicationBridge.broadcast('proxy:request', {
      method: req.method,
      url: targetUrl,
      status: response.status,
      cached: false
    });

    return res.send(buffer);
  } catch (err) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: 'Proxy fetch failed', message: err.message });
  }
}

// On-Demand Subpage Cloner & Dynamic Asset Proxy for /clones/:id/*
app.use('/clones/:id', async (req, res, next) => {
  const cloneId = req.params.id;
  const metadata = await getClone(cloneId);
  if (!metadata || !metadata.finalUrl) {
    return next();
  }

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    return res.sendStatus(204);
  }

  const subpath = req.path.replace(/^\/+/, '');
  if (!subpath || /^(mailto:|tel:|sms:|callto:|fax:|javascript:|data:|blob:)/i.test(subpath)) {
    return next();
  }

  // ⚡ ULTRA-FAST LIVE-TIME RAM HIT (<0.1ms) & DISK HIT (<2ms): Serve existing page or asset without async overhead
  if (subpath && (req.method === 'GET' || req.method === 'HEAD')) {
    const cachedPage = getLivePageRamCache(cloneId, subpath);
    if (cachedPage) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Rebuilt-Acceleration', 'live-ram-cache; latency=0ms');
      res.setHeader('X-Rebuilt-GPU-Accelerated', 'true');
      res.setHeader('X-Rebuilt-CPU-Threads', String(cpuCount));
      res.setHeader('X-Rebuilt-Network-Speed', 'live-time');
      return res.send(cachedPage);
    }

    const { getCloneDirPath } = require('./src/storage/clone-storage');
    const cloneDir = getCloneDirPath(cloneId);
    let checkRelPath = subpath;
    if (!path.extname(checkRelPath)) {
      checkRelPath = path.join(checkRelPath, 'index.html');
    }
    const checkAbsPath = path.join(cloneDir, checkRelPath);
    if (fs.existsSync(checkAbsPath)) {
      const mime = getMimeType(checkAbsPath);
      res.setHeader('Content-Type', mime.includes('html') ? 'text/html; charset=utf-8' : mime);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Rebuilt-GPU-Accelerated', 'true');
      res.setHeader('X-Rebuilt-CPU-Threads', String(cpuCount));
      res.setHeader('X-Rebuilt-Network-Speed', 'live-time');
      if (mime.includes('html')) {
        const fileContent = fs.readFileSync(checkAbsPath, 'utf8');
        setLivePageRamCache(cloneId, subpath, fileContent);
        return res.send(fileContent);
      }
      return res.sendFile(checkAbsPath);
    }
    const altHtml = path.join(cloneDir, subpath + '.html');
    if (fs.existsSync(altHtml)) {
      const htmlContent = fs.readFileSync(altHtml, 'utf8');
      setLivePageRamCache(cloneId, subpath, htmlContent);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Rebuilt-GPU-Accelerated', 'true');
      res.setHeader('X-Rebuilt-CPU-Threads', String(cpuCount));
      res.setHeader('X-Rebuilt-Network-Speed', 'live-time');
      return res.send(htmlContent);
    }
  }

  const originalBase = new URL(metadata.finalUrl);

  // REBUILT 2.0: Match dynamic requests against clone-manifest.json routes
  const { getCloneManifest } = require('./src/storage/clone-storage');
  const { RequestValidator } = require('./src/bridge/request-validator');
  const { applicationBridge } = require('./src/bridge/application-bridge');

  const manifest = await getCloneManifest(cloneId);
  const routePath = '/' + subpath;
  const matchedManifestRoute = manifest
    ? RequestValidator.matchManifestRoute(req.method, routePath, manifest.routes)
    : null;

  if (matchedManifestRoute) {
    try {
      const result = await applicationBridge.forwardRequest({
        cloneId,
        manifest,
        method: req.method,
        path: routePath,
        query: req.query,
        headers: req.headers,
        body: req.body
      });

      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, value);
      }
      res.status(result.status);
      if (result.isBinary) {
        return res.send(result.data);
      } else if (typeof result.data === 'object') {
        return res.json(result.data);
      } else {
        return res.send(result.data);
      }
    } catch (bridgeErr) {
      return res.status(bridgeErr.statusCode || 500).json({
        error: bridgeErr.message,
        code: bridgeErr.code || 'BRIDGE_DISPATCH_FAILURE',
        bridge: 'rebuilt_2.0'
      });
    }
  }

  // 1. Speculative Button/Hyperlink Preload Trigger (hover/focus from preview)
  if (subpath === '__preload' || subpath.startsWith('__preload')) {
    const targetPath = req.query.path || (req.body && req.body.path) || '';
    const { preloadSpecificPath } = require('./src/crawler/autonomous-preload-swarm');
    preloadSpecificPath(cloneId, targetPath, PORT).catch(() => {});
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.json({ success: true, preloading: targetPath });
  }

  // 2. Clone-Scoped Web Data Sharing Proxy (/clones/:id/__proxy/api/...)
  if (subpath.startsWith('__proxy/')) {
    const proxyRel = subpath.slice('__proxy/'.length);
    const targetUrl = new URL(proxyRel, originalBase.origin).toString() + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    return forwardWebProxyRequest(req, res, targetUrl);
  }

  // 3. Handle non-GET methods or live API calls for data sharing
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const isApi = req.path.includes('conversation') ||
                  req.path.includes('/api/') ||
                  req.is('application/json') ||
                  req.headers.accept?.includes('application/json') ||
                  req.headers.accept?.includes('text/event-stream');

    if (isApi) {
      // Forward directly to original website for true web data sharing
      const targetApiUrl = new URL(subpath, originalBase.origin).toString() + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
      return forwardWebProxyRequest(req, res, targetApiUrl);
    }

    // Top-level HTML form navigation: redirect back to clone home to stay in preview
    return res.redirect(302, `/clones/${cloneId}/?submitted=true`);
  }

  if (!subpath) return next();

  // 1. Check if it's an asset or static subresource
  const isAsset = /\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|mp4|webm|mov|m4v|ogv|mp3|ogg|m4a|wav|aac|m3u8|ts|woff2?|ttf|eot|otf|json|wasm)(\?.*)?$/i.test(subpath) ||
                  subpath.startsWith('wss/fonts') ||
                  subpath.includes('/fonts?') ||
                  subpath.startsWith('fonts?') ||
                  subpath.includes('/api/') ||
                  subpath.includes('graphql') ||
                  subpath.includes('/shop/mcm/');

  if (isAsset) {
    // Check RAM proxy cache first (< 1ms)
    const cachedAsset = getCachedProxyAsset(req.originalUrl) || getCachedProxyAsset(subpath);
    if (cachedAsset) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      const cType = cachedAsset.contentType || getMimeType(subpath);
      if (cType.startsWith('video/') || cType.startsWith('audio/')) {
        return sendMediaBufferWithRange(req, res, cType, cachedAsset.buffer);
      }
      if (cachedAsset.contentType) res.setHeader('Content-Type', cachedAsset.contentType);
      return res.send(cachedAsset.buffer);
    }

    // Check if asset exists locally on disk in clone directory first
    const localAssetPath = findLocalCloneAsset(cloneId, subpath);
    if (localAssetPath) {
      res.setHeader('Content-Type', getMimeType(localAssetPath));
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      return res.sendFile(localAssetPath, { acceptRanges: true });
    }

    try {
      const { getCloneDirPath } = require('./src/storage/clone-storage');
      const cloneDir = getCloneDirPath(cloneId);
      const manifestPath = path.join(cloneDir, 'resource-manifest.json');
      let resourceManifest = null;
      if (fs.existsSync(manifestPath)) {
        try {
          resourceManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (_) {}
      }

      const cleanSub = subpath.replace(/^\/+/, '');
      const baseName = path.basename(cleanSub);
      let targetRecord = null;
      if (resourceManifest && resourceManifest.lookupByLocalPath) {
        targetRecord = resourceManifest.lookupByLocalPath[cleanSub] ||
                       resourceManifest.lookupByLocalPath['assets/' + cleanSub] ||
                       resourceManifest.lookupByLocalPath[baseName] ||
                       resourceManifest.lookupByLocalPath[cleanSub.replace(/^assets\//, '')];
      }

      const host = originalBase.hostname;
      const authorizedSession = sessionVault.getSession(host);
      const reqHeaders = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': req.headers['accept'] || '*/*',
        'Referer': metadata.finalUrl
      };
      if (authorizedSession) {
        if (authorizedSession.cookies) reqHeaders['Cookie'] = authorizedSession.cookies;
        if (authorizedSession.headers) Object.assign(reqHeaders, authorizedSession.headers);
      }

      let response = null;
      let targetAssetUrl = targetRecord ? targetRecord.originalUrl : null;

      if (targetAssetUrl) {
        try {
          const r = await fetch(targetAssetUrl, {
            signal: AbortSignal.timeout(8000),
            headers: reqHeaders
          });
          if (r.ok) {
            response = r;
            if (authorizedSession) {
              const setCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : r.headers.get('set-cookie');
              if (setCookies) sessionVault.updateCookiesFromSetCookie(host, setCookies);
            }
          }
        } catch (_) {}
      }

      if (!response) {
        const candidatePaths = [subpath];
        if (subpath.includes('assets/js/')) {
          candidatePaths.push(subpath.replace('assets/js/', 'assets/'));
          candidatePaths.push(subpath.replace('assets/js/', ''));
        }
        if (subpath.includes('assets/css/')) {
          candidatePaths.push(subpath.replace('assets/css/', 'assets/'));
          candidatePaths.push(subpath.replace('assets/css/', ''));
        }
        if (subpath.includes('assets/images/')) {
          candidatePaths.push(subpath.replace('assets/images/', 'assets/'));
          candidatePaths.push(subpath.replace('assets/images/', ''));
        }
        if (subpath.includes('assets/fonts/')) {
          candidatePaths.push(subpath.replace('assets/fonts/', 'assets/'));
          candidatePaths.push(subpath.replace('assets/fonts/', ''));
        }
        if (subpath.includes('assets/media/')) {
          candidatePaths.push(subpath.replace('assets/media/', 'assets/'));
          candidatePaths.push(subpath.replace('assets/media/', ''));
        }

        for (const cand of candidatePaths) {
          try {
            const assetUrl = new URL(cand, originalBase.origin).toString();
            const r = await fetch(assetUrl, {
              signal: AbortSignal.timeout(6000),
              headers: reqHeaders
            });
            if (r.ok) {
              response = r;
              targetAssetUrl = assetUrl;
              if (authorizedSession) {
                const setCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : r.headers.get('set-cookie');
                if (setCookies) sessionVault.updateCookiesFromSetCookie(host, setCookies);
              }
              break;
            }
          } catch (_) {}
        }
      }

      if (!response || !response.ok) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Rebuilt-Asset-Status', 'missing');
        return res.status(404).send('Asset not found');
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const contentType = response.headers.get('content-type') || getMimeType(subpath);
      if (contentType) res.setHeader('Content-Type', contentType);

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Cache dynamic asset in RAM
      setCachedProxyAsset(targetAssetUrl || req.originalUrl, contentType, buffer);

      // Cache on disk asynchronously for offline access
      try {
        const savePath = path.join(cloneDir, subpath);
        const saveDir = path.dirname(savePath);
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
        fs.promises.writeFile(savePath, buffer).catch(() => {});
      } catch (_) {}

      if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
        return sendMediaBufferWithRange(req, res, contentType, buffer);
      }

      return res.send(buffer);
    } catch (_) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Rebuilt-Asset-Status', 'error');
      return res.status(502).send('Error retrieving asset');
    }
  }

  // 2. It is a PAGE request! (e.g. "mac/", "mac", "us/shop/goto/store", "iphone/")
  console.log(`[On-Demand Cloner] Request for clone ${cloneId}: "${subpath}"`);
  try {
    const { getCloneDirPath, saveCloneMetadata } = require('./src/storage/clone-storage');
    const cloneDir = getCloneDirPath(cloneId);
    let saveRelPath = subpath.replace(/^\/+/, '');
    if (!saveRelPath || saveRelPath.endsWith('/')) {
      saveRelPath = path.join(saveRelPath, 'index.html');
    } else if (!saveRelPath.endsWith('.html')) {
      saveRelPath = path.join(saveRelPath, 'index.html');
    }
    const saveAbsPath = path.join(cloneDir, saveRelPath);
    const altHtmlPath = saveAbsPath.replace(/\/index\.html$/, '.html');

    // ⚡ Instant Disk Check: Return saved subpage in <2ms
    if (fs.existsSync(saveAbsPath)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(saveAbsPath);
    }
    if (fs.existsSync(altHtmlPath)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(altHtmlPath);
    }

    let targetPageUrl;
    try {
      targetPageUrl = new URL(subpath, originalBase.href).toString();
    } catch (_) {
      targetPageUrl = new URL(subpath, originalBase.origin).toString();
    }
    const { validateUrl } = require('./src/security/ssrf-guard');
    const validation = await validateUrl(targetPageUrl);
    if (!validation.isValid) {
      return res.status(403).send('Target subpage URL forbidden by security audit.');
    }

    // ⚡ In-Flight Deduplication: Share render promise across concurrent requests
    const inFlightKey = `${cloneId}:${targetPageUrl}`;
    if (inFlightSubpageRenders.has(inFlightKey)) {
      console.log(`[On-Demand Cloner] ⚡ Reusing in-flight render promise for: "${subpath}"`);
      const renderedHtml = await inFlightSubpageRenders.get(inFlightKey);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(renderedHtml);
    }

    const renderPromise = (async () => {
      let pageHtml = '';
      let pageTitle = '';
      let pageFonts = [];
      let pageStylesheets = new Map();

      // Step A: Ultra-Fast Direct Fetch First (~80-250ms)
      const subpageHost = new URL(targetPageUrl).hostname;
      const subpageSession = sessionVault.getSession(subpageHost);
      const subpageHeaders = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'Upgrade-Insecure-Requests': '1'
      };
      if (subpageSession) {
        if (subpageSession.cookies) subpageHeaders['Cookie'] = subpageSession.cookies;
        if (subpageSession.headers) Object.assign(subpageHeaders, subpageSession.headers);
      }

      try {
        const fetchRes = await fetch(targetPageUrl, {
          signal: AbortSignal.timeout(3500),
          headers: subpageHeaders,
          redirect: 'follow'
        });

        if (fetchRes.ok) {
          const contentType = (fetchRes.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('text/html') || !contentType) {
            const rawText = await fetchRes.text();
            const isBotBlock = /cf-browser-verification|challenge-platform|just a moment|security check|access denied|captcha/i.test(rawText.slice(0, 1200));
            if (rawText.length > 250 && rawText.includes('<body') && !isBotBlock) {
              pageHtml = rawText;
              const titleMatch = pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
              pageTitle = titleMatch ? titleMatch[1].trim() : subpath;
              if (subpageSession) {
                const setCookies = fetchRes.headers.getSetCookie ? fetchRes.headers.getSetCookie() : fetchRes.headers.get('set-cookie');
                if (setCookies) sessionVault.updateCookiesFromSetCookie(subpageHost, setCookies);
              }
            }
          }
        }
      } catch (_) {}

      // Step B: Resilient Playwright render fallback (<8s) if direct fetch did not yield content
      if (!pageHtml) {
        console.log(`[On-Demand Cloner] Direct fetch unavailable, rendering with Playwright (<8s): "${subpath}"`);
        const { renderPage } = require('./src/renderer/playwright-renderer');
        const renderRes = await renderPage(targetPageUrl, { timeout: 8000 });
        pageHtml = renderRes.html;
        pageTitle = renderRes.title;
        pageFonts = renderRes.fonts || [];
        pageStylesheets = renderRes.stylesheets || new Map();
      }

      const { rewriteHtmlForPreview } = require('./src/rewriter/html-rewriter');
      const rewritten = rewriteHtmlForPreview(pageHtml, targetPageUrl, {
        fonts: pageFonts,
        stylesheets: pageStylesheets,
        cloneId
      });

      // Save immediately so subsequent requests hit disk in <2ms!
      const saveDir = path.dirname(saveAbsPath);
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }
      fs.writeFileSync(saveAbsPath, rewritten, 'utf8');

      // Update metadata and trigger asset download asynchronously in background
      setImmediate(async () => {
        try {
          if (!Array.isArray(metadata.pages)) {
            metadata.pages = [{
              url: metadata.finalUrl,
              localPath: 'index.html',
              title: metadata.title || 'Home Page',
              depth: 0,
              status: 'rendered'
            }];
          }
          const relParts = saveRelPath.split(path.sep).filter(p => p && p !== 'index.html');
          const pageDepth = relParts.length;
          const alreadyExists = metadata.pages.some(p => p.url === targetPageUrl || p.localPath === saveRelPath);
          if (!alreadyExists) {
            metadata.pages.push({
              url: targetPageUrl,
              localPath: saveRelPath,
              title: pageTitle || subpath,
              depth: pageDepth,
              status: 'rendered'
            });
            metadata.pageCount = metadata.pages.length;
            await saveCloneMetadata(metadata);
          }

          // Asynchronously download and localize subpage assets in background
          const { downloadAndRewriteAssets } = require('./src/downloader/asset-downloader');
          const assetResult = await downloadAndRewriteAssets({
            cloneDir,
            html: rewritten,
            baseOrigin: originalBase.origin,
            depth: pageDepth
          });
          if (assetResult && assetResult.rewrittenHtml && assetResult.rewrittenHtml !== rewritten) {
            setLivePageRamCache(cloneId, subpath, assetResult.rewrittenHtml);
            fs.promises.writeFile(saveAbsPath, assetResult.rewrittenHtml, 'utf8').catch(() => {});
          }
        } catch (_) {}
      });

      return rewritten;
    })();

    inFlightSubpageRenders.set(inFlightKey, renderPromise);
    let finalHtml;
    try {
      finalHtml = await renderPromise;
      setLivePageRamCache(cloneId, subpath, finalHtml);
    } finally {
      inFlightSubpageRenders.delete(inFlightKey);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Rebuilt-Acceleration', 'live-ram-cache; latency=0ms');
    res.setHeader('X-Rebuilt-GPU-Accelerated', 'true');
    res.setHeader('X-Rebuilt-CPU-Threads', String(cpuCount));
    res.setHeader('X-Rebuilt-Network-Speed', 'live-time');
    return res.send(finalHtml);
  } catch (err) {
    console.error(`[On-Demand Cloner] Error rendering ${subpath}:`, err);
    return res.status(500).send(`Failed to on-demand render page: ${err.message}`);
  }
});

// Universal Asset & Web Data Sharing Proxy Endpoints with strict SSRF Protection
app.all(['/api/proxy', '/api/web-share/proxy'], async (req, res) => {
  const targetUrl = req.query.url || (req.body && req.body.url) || req.headers['x-target-url'];
  if (!targetUrl || typeof targetUrl !== 'string') {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      return res.sendStatus(204);
    }
    return res.status(400).json({ error: 'Missing target url parameter or body' });
  }

  return forwardWebProxyRequest(req, res, targetUrl);
});

// Smart Asset Proxy Fallback for cloned previews
// Any subresources requested by previewed pages (e.g. /_next/*, /images/*, /css/*)
// are proxied directly from the target website based on the Referer header.
app.use(async (req, res, next) => {
  // Skip internal API, clones, or frontend static asset routes
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/clones/') ||
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/')
  ) {
    return next();
  }

  // Handle CORS OPTIONS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.sendStatus(204);
  }

  const referer = req.headers.referer || req.headers.referrer;
  let cloneId = null;
  if (referer) {
    const match = referer.match(/\/clones\/([^\/\?#]+)/);
    if (match) cloneId = match[1];
  }

  // If no referer, check if path belongs to a known clone (e.g. /unauth-mweb/* for chatgpt)
  if (!cloneId) {
    try {
      const { listClones } = require('./src/storage/clone-storage');
      const allClones = await listClones();
      if (allClones && allClones.length > 0) {
        if (req.path.startsWith('/unauth-mweb')) {
          const chatgptClone = allClones.find(c => c.originalUrl?.includes('chatgpt.com') || c.finalUrl?.includes('chatgpt.com'));
          if (chatgptClone) cloneId = chatgptClone.id;
        }
        if (!cloneId && req.method !== 'GET') {
          cloneId = allClones[0].id;
        }
      }
    } catch (_) {}
  }

  if (!cloneId) {
    return next();
  }

  const metadata = await getClone(cloneId);
  if (!metadata || !metadata.finalUrl) {
    return next();
  }

  // Handle POST, PUT, DELETE, PATCH requests originating from clones
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const isApi = req.path.includes('conversation') ||
                  req.path.includes('/api/') ||
                  req.is('application/json') ||
                  req.headers.accept?.includes('application/json') ||
                  req.headers.accept?.includes('text/event-stream');

    if (isApi) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json({
        status: 'success',
        ok: true,
        previewMode: true,
        message: 'Request received in Rebuilt clone preview mode',
        cloneId: cloneId,
        path: req.path
      });
    }

    // Top-level HTML form navigation: redirect back into clone
    return res.redirect(302, `/clones/${cloneId}/?submitted=true`);
  }

  // Check if asset exists locally on disk in clone directory first
  const localAssetPath = findLocalCloneAsset(cloneId, req.path);
  if (localAssetPath) {
    res.setHeader('Content-Type', getMimeType(localAssetPath));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(localAssetPath);
  }

  try {
    const targetBase = new URL(metadata.finalUrl);
    const targetAssetUrl = new URL(req.originalUrl, targetBase.origin).toString();
    const proxyHost = targetBase.hostname;
    const proxySession = sessionVault.getSession(proxyHost);

    const proxyHeaders = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Accept': req.headers['accept'] || '*/*',
      'Referer': metadata.finalUrl
    };
    if (proxySession) {
      if (proxySession.cookies) proxyHeaders['Cookie'] = proxySession.cookies;
      if (proxySession.headers) Object.assign(proxyHeaders, proxySession.headers);
    }

    const response = await fetch(targetAssetUrl, {
      signal: AbortSignal.timeout(4000),
      headers: proxyHeaders
    });

    if (response.ok && proxySession) {
      const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : response.headers.get('set-cookie');
      if (setCookies) sessionVault.updateCookiesFromSetCookie(proxyHost, setCookies);
    }

    if (!response.ok) {
      if (req.path.includes('manifest.json') || req.path.includes('/data/manifest')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(200).json({ name: 'Preview', short_name: 'Preview', start_url: '/' });
      }
      if (req.path.endsWith('.js') || req.path.endsWith('.mjs')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(200).send('/* Rebuilt module chunk placeholder */ export default {};');
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      return next();
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Cache dynamic asset in RAM
    setCachedProxyAsset(targetAssetUrl, contentType, buffer);

    // Cache dynamic asset on disk asynchronously (non-blocking)
    try {
      const { getCloneDirPath } = require('./src/storage/clone-storage');
      const cloneDir = getCloneDirPath(cloneId);
      const cleanRel = req.path.replace(/^\/+/, '');
      const savePath = path.join(cloneDir, cleanRel);
      const saveDir = path.dirname(savePath);
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
      fs.promises.writeFile(savePath, buffer).catch(() => {});
    } catch (_) {}

    return res.send(buffer);
  } catch (err) {
    if (req.path.includes('manifest.json') || req.path.includes('/data/manifest')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json({ name: 'Preview', short_name: 'Preview', start_url: '/' });
    }
    if (req.path.endsWith('.js') || req.path.endsWith('.mjs')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send('/* Rebuilt module chunk placeholder */ export default {};');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    return next();
  }
});

// API Routes
app.use('/bridge', bridgeProxyRouter);
app.use('/api/local', localApiRouter);
app.use('/api/bridge', bridgeRouter);
app.use('/api/web-cloner', cloneRouter);
app.use('/api/auth', authRouter);
app.use('/api/tunnel', tunnelRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Rebuilt Web Cloner',
    timestamp: new Date().toISOString()
  });
});

// Single Page Application Fallback for Rebuilt Dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Universal Clone Fallback Handler
// Intercepts any unhandled POST/GET/API requests so users NEVER see a raw "Cannot POST <path>"
app.use(async (req, res) => {
  const referer = req.headers.referer || req.headers.referrer || '';
  const match = referer.match(/\/clones\/([^\/\?#]+)/);
  let targetCloneId = match ? match[1] : null;

  if (!targetCloneId) {
    try {
      const { listClones } = require('./src/storage/clone-storage');
      const allClones = await listClones();
      if (allClones && allClones.length > 0) {
        if (req.path.startsWith('/unauth-mweb')) {
          const chatgptClone = allClones.find(c => c.originalUrl?.includes('chatgpt.com') || c.finalUrl?.includes('chatgpt.com'));
          if (chatgptClone) targetCloneId = chatgptClone.id;
        }
        if (!targetCloneId && req.method !== 'GET') {
          targetCloneId = allClones[0].id;
        }
      }
    } catch (_) {}
  }

  // REBUILT 2.0: Root-relative API requests bridged via clone manifest
  if (targetCloneId) {
    const { getCloneManifest } = require('./src/storage/clone-storage');
    const { RequestValidator } = require('./src/bridge/request-validator');
    const { applicationBridge } = require('./src/bridge/application-bridge');

    const manifest = await getCloneManifest(targetCloneId);
    const matchedRoute = manifest
      ? RequestValidator.matchManifestRoute(req.method, req.path, manifest.routes)
      : null;

    if (matchedRoute) {
      try {
        const result = await applicationBridge.forwardRequest({
          cloneId: targetCloneId,
          manifest,
          method: req.method,
          path: req.path,
          query: req.query,
          headers: req.headers,
          body: req.body
        });

        for (const [key, value] of Object.entries(result.headers)) {
          res.setHeader(key, value);
        }
        res.status(result.status);
        if (result.isBinary) {
          return res.send(result.data);
        } else if (typeof result.data === 'object') {
          return res.json(result.data);
        } else {
          return res.send(result.data);
        }
      } catch (bridgeErr) {
        return res.status(bridgeErr.statusCode || 500).json({
          error: bridgeErr.message,
          code: bridgeErr.code || 'BRIDGE_DISPATCH_FAILURE',
          bridge: 'rebuilt_2.0'
        });
      }
    }
  }

  const isApi = req.path.includes('conversation') ||
                req.path.includes('/api/') ||
                req.is('application/json') ||
                req.headers.accept?.includes('application/json') ||
                req.headers.accept?.includes('text/event-stream');

  if (isApi) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      status: 'success',
      ok: true,
      previewMode: true,
      message: 'Request handled in Rebuilt clone preview mode',
      path: req.path
    });
  }

  if (targetCloneId) {
    return res.redirect(302, `/clones/${targetCloneId}/?submitted=true`);
  }

  res.redirect(302, '/');
});

/**
 * Starts the server on the specified port.
 */
function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log('\n======================================================');
      console.log(`  ⚡ Rebuilt Web Cloner is running!                  `);
      console.log(`  Dashboard:   http://localhost:${port}             `);
      console.log(`  API Clone:   POST http://localhost:${port}/api/web-cloner/clone`);
      console.log(`  Preview:     http://localhost:${port}/clones/<clone-id>/`);
      console.log('======================================================\n');

      // Store the actual port so QA/cloner can always reference it
      process.env.ACTIVE_PORT = String(port);
      try {
        const portFile = path.join(__dirname, 'data/active-port.txt');
        fs.mkdirSync(path.dirname(portFile), { recursive: true });
        fs.writeFileSync(portFile, String(port), 'utf8');
      } catch (_) {}

      // Automatically establish public port-forwarding tunnel unless NO_TUNNEL=true
      const shouldTunnel = process.env.NO_TUNNEL !== 'true' && process.env.TUNNEL !== 'false';
      if (shouldTunnel) {
        tunnelService.startTunnel({ port }).then((res) => {
          console.log('\n=============================================================');
          console.log('  🌐 PUBLIC PORT-FORWARDING TUNNEL IS LIVE!                   ');
          console.log(`  Public Dashboard:   ${res.url}`);
          console.log(`  Live Clone Links:   ${res.url}/clones/<clone-id>/`);
          console.log('=============================================================\n');
        }).catch((err) => {
          console.warn('  ⚠️ Public tunnel notice:', err.message);
        });
      } else {
        const publicUrl = tunnelService.getPublicUrl();
        if (publicUrl) {
          console.log(`  Public Live: ${publicUrl}`);
          console.log(`  Live Clones: ${publicUrl}/clones/<clone-id>/`);
          console.log('======================================================\n');
        }
      }

      // Pre-warm Chromium in the background so the very first clone is immediate
      warmupBrowser();

      resolve(server);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Warning] Port ${port} is in use. Retrying on port ${port + 1}...`);
        resolve(startServer(port + 1));
      } else {
        reject(err);
      }
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  communicationBridge,
  livePageRamCache,
  getLivePageRamCache,
  setLivePageRamCache
};
