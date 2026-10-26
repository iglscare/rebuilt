/**
 * Rebuilt Web Cloner — Full Source Code Asset Downloader
 * Downloads stylesheets, scripts, images, and fonts into clean local directories
 * and rewrites HTML references to relative local paths for complete offline independence.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const { validateUrl } = require('../security/ssrf-guard');
const { splitSrcsetCandidates } = require('../rewriter/html-rewriter');
const sessionVault = require('../security/session-vault');

const cpuCount = Math.max(2, os.cpus() ? os.cpus().length : 4);
const DYNAMIC_DOWNLOAD_CONCURRENCY = Math.max(32, cpuCount * 8);

const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25MB limit per asset file (allows rich videos, audio, webp)

// High-performance persistent HTTP/HTTPS Keep-Alive connection pooling with socket multiplexing
const keepAliveHttpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 128,
  maxFreeSockets: 64,
  freeSocketTimeout: 30000,
  timeout: 15000
});

const keepAliveHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 128,
  maxFreeSockets: 64,
  freeSocketTimeout: 30000,
  timeout: 15000
});

// Fast in-memory asset cache (LRU bounded) to prevent redundant remote fetches
const assetMemoryCache = new Map();
const MAX_MEMORY_CACHE_ITEMS = 600;

/**
 * Strips wrapping quotes and HTML entities from a URL string
 */
function cleanUrlQuotes(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/^(&quot;|&#34;|&apos;|&#39;|["'\\])+/g, '')
    .replace(/(&quot;|&#34;|&apos;|&#39;|["'\\])+$/g, '')
    .trim();
}

/**
 * Categorizes an asset URL by its file extension or content hint
 * @param {string} urlStr
 * @returns {'css' | 'js' | 'images' | 'fonts' | 'media' | 'data' | 'other'}
 */
function categorizeAsset(urlStr) {
  const clean = urlStr.split('?')[0].split('#')[0].toLowerCase();
  if (clean.endsWith('.css')) return 'css';
  if (clean.endsWith('.js') || clean.endsWith('.mjs') || clean.endsWith('.cjs')) return 'js';
  if (/\.(png|jpe?g|webp|avif|gif|svg|ico|bmp|tiff)$/i.test(clean)) return 'images';
  if (/\.(woff2?|ttf|otf|eot)$/i.test(clean)) return 'fonts';
  if (/\.(mp4|webm|ogv|mov|m4v|mp3|ogg|wav|flac|aac|m3u8|ts|mpd|m4s|m4a|vtt|srt)$/i.test(clean)) return 'media';
  if (/\.(json|xml|csv)$/i.test(clean)) return 'data';
  return 'other';
}

/**
 * Standard MIME type resolver for assets and media
 * @param {string} filePathOrUrl
 * @returns {string} MIME type
 */
function getMimeType(filePathOrUrl) {
  if (!filePathOrUrl || typeof filePathOrUrl !== 'string') return 'application/octet-stream';
  const clean = filePathOrUrl.split('?')[0].split('#')[0].toLowerCase();
  const ext = path.extname(clean);
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
    '.bmp': 'image/bmp',
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
    '.flac': 'audio/flac',
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t',
    '.mpd': 'application/dash+xml',
    '.m4s': 'video/iso.segment',
    '.vtt': 'text/vtt',
    '.srt': 'text/plain',
    '.xml': 'application/xml; charset=utf-8'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Extracts a clean, safe original filename from an asset URL (preserving extension and base for ES module imports)
 * @param {string} assetUrl
 * @returns {string} Clean filename
 */
function getCleanFilename(assetUrl) {
  try {
    const parsed = new URL(assetUrl);
    let baseName = path.basename(parsed.pathname) || '';
    baseName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return baseName;
  } catch (_) {
    return '';
  }
}

/**
 * Creates a unique, safe local filename with a content/URL hash
 * @param {string} assetUrl
 * @param {'css' | 'js' | 'images' | 'fonts' | 'media' | 'data' | 'other'} category
 * @returns {string} Safe filename
 */
function createSafeFilename(assetUrl, category) {
  try {
    const parsed = new URL(assetUrl);
    const pathname = parsed.pathname;
    let baseName = path.basename(pathname) || 'asset';

    // Strip querystrings and special chars
    baseName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Ensure proper extension
    const ext = path.extname(baseName);
    const shortHash = crypto.createHash('md5').update(assetUrl).digest('hex').slice(0, 8);

    if (!ext) {
      const defaultExt = {
        css: '.css',
        js: '.js',
        images: '.png',
        fonts: '.woff2',
        media: '.mp4',
        data: '.json',
        other: '.bin'
      }[category] || '.bin';
      return `${baseName.slice(0, 30)}_${shortHash}${defaultExt}`;
    }

    const nameWithoutExt = path.basename(baseName, ext).slice(0, 30);
    return `${nameWithoutExt}_${shortHash}${ext}`;
  } catch (_) {
    const hash = crypto.createHash('md5').update(assetUrl).digest('hex').slice(0, 10);
    return `asset_${hash}`;
  }
}

/**
 * Safely downloads a binary buffer from an HTTP/HTTPS URL
 * @param {string} targetUrl
 * @param {number} [timeoutMs=10000]
 * @param {string} [refererUrl='']
 * @returns {Promise<Buffer|null>}
 */
async function downloadBuffer(targetUrl, timeoutMs = 8000, refererUrl = '') {
  try {
    if (assetMemoryCache.has(targetUrl)) {
      return assetMemoryCache.get(targetUrl);
    }

    const valid = await validateUrl(targetUrl);
    if (!valid.isValid) return null;

    return await new Promise((resolve) => {
      const isHttps = targetUrl.startsWith('https:');
      const client = isHttps ? https : http;
      const agent = isHttps ? keepAliveHttpsAgent : keepAliveHttpAgent;

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,text/css,*/*;q=0.8',
        'Connection': 'keep-alive'
      };
      if (refererUrl) {
        try {
          headers['Referer'] = new URL(refererUrl).origin + '/';
        } catch (_) {}
      }

      let host = '';
      try {
        host = new URL(targetUrl).hostname;
        const session = sessionVault.getSession(host);
        if (session) {
          if (session.cookies) headers['Cookie'] = session.cookies;
          if (session.headers) Object.assign(headers, session.headers);
        }
      } catch (_) {}

      const req = client.get(
        targetUrl,
        {
          headers,
          agent,
          timeout: timeoutMs
        },
        (res) => {
          // Synchronize updated cookies if target issues Set-Cookie
          if (res.headers && res.headers['set-cookie'] && host) {
            sessionVault.updateCookiesFromSetCookie(host, res.headers['set-cookie']);
          }

          // Follow one redirect if 301/302
          if (res.statusCode && (res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, targetUrl).toString();
            return resolve(downloadBuffer(redirectUrl, timeoutMs, refererUrl));
          }

          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 400)) {
            return resolve(null);
          }

          const chunks = [];
          let byteCount = 0;

          res.on('data', chunk => {
            byteCount += chunk.length;
            if (byteCount > MAX_ASSET_BYTES) {
              req.destroy();
              return resolve(null);
            }
            chunks.push(chunk);
          });

          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (buffer.length <= 5 * 1024 * 1024) {
              if (assetMemoryCache.size >= MAX_MEMORY_CACHE_ITEMS) {
                const firstKey = assetMemoryCache.keys().next().value;
                assetMemoryCache.delete(firstKey);
              }
              assetMemoryCache.set(targetUrl, buffer);
            }
            resolve(buffer);
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.on('error', () => resolve(null));
    });
  } catch (_) {
    return null;
  }
}

/**
 * Concurrency worker queue helper
 */
async function runWithConcurrency(items, limit, workerFn) {
  const results = [];
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => workerFn(item));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

/**
 * Extracts all downloadable asset URLs from HTML (including media, SVG, preload, and dynamic data attrs)
 * @param {string} html
 * @param {string} baseOrigin
 * @returns {Array<{ url: string, category: 'css' | 'js' | 'images' | 'fonts' | 'media' | 'data' | 'other' }>}
 */
function extractAssetUrls(html, baseOrigin) {
  const assetMap = new Map();

  function addAsset(rawUrl, defaultCategory) {
    if (!rawUrl || typeof rawUrl !== 'string') return;
    const trimmed = cleanUrlQuotes(rawUrl);
    if (
      !trimmed ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('javascript:') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('tel:')
    ) {
      return;
    }

    let absoluteUrl;
    try {
      absoluteUrl = new URL(trimmed, baseOrigin).toString();
    } catch (_) {
      return;
    }

    if (!absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://')) {
      return;
    }

    if (/usercentrics|uc-block|onetrust|cookiebot/i.test(absoluteUrl)) {
      return;
    }

    const category = defaultCategory || categorizeAsset(absoluteUrl);
    if (!assetMap.has(absoluteUrl)) {
      assetMap.set(absoluteUrl, { url: absoluteUrl, category });
    }
  }

  // 1. Stylesheets, preloads, modulepreloads, and favicons
  const linkMatches = [...html.matchAll(/<link[^>]+(?:href=["']([^"']+)["'][^>]*|[^>]*href=["']([^"']+)["'])/gi)];
  linkMatches.forEach(m => {
    const fullTag = m[0];
    const href = m[1] || m[2];
    if (!href) return;
    if (/rel=["'](?:stylesheet|preload|modulepreload|prefetch|icon|shortcut icon|apple-touch-icon)/i.test(fullTag)) {
      if (/as=["']style["']|rel=["']stylesheet["']/i.test(fullTag)) addAsset(href, 'css');
      else if (/as=["']script["']|rel=["']modulepreload["']/i.test(fullTag)) addAsset(href, 'js');
      else if (/as=["']font["']/i.test(fullTag)) addAsset(href, 'fonts');
      else if (/as=["']image["']|rel=["'](?:icon|shortcut icon|apple-touch-icon)/i.test(fullTag)) addAsset(href, 'images');
      else if (/as=["']video["']|as=["']media["']/i.test(fullTag)) addAsset(href, 'media');
      else addAsset(href);
    }
  });

  // 2. Scripts
  const scriptMatches = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)];
  scriptMatches.forEach(m => addAsset(m[1], 'js'));

  // 3. Images (src and srcset, including lazy srcset)
  const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
  imgMatches.forEach(m => addAsset(m[1], 'images'));

  const srcsetMatches = [...html.matchAll(/(?:srcset|data-srcset|data-lazy-srcset)=["']([^"']+)["']/gi)];
  srcsetMatches.forEach(m => {
    const candidates = splitSrcsetCandidates(m[1]);
    candidates.forEach(c => {
      if (c.url) addAsset(c.url, 'images');
    });
  });

  // 4. Video, Audio, Track, and Media Sources (including lazy attributes)
  const mediaMatches = [...html.matchAll(/<(?:video|audio|source|track)[^>]+(?:src=["']([^"']+)["']|poster=["']([^"']+)["']|data-src=["']([^"']+)["']|data-poster=["']([^"']+)["']|data-video-src=["']([^"']+)["'])/gi)];
  mediaMatches.forEach(m => {
    const src = m[1] || m[3] || m[5];
    const poster = m[2] || m[4];
    if (src) addAsset(src, 'media');
    if (poster) addAsset(poster, 'images');
  });

  // 5. SVG <image> and <use> elements
  const svgMediaMatches = [...html.matchAll(/<(?:image|use)[^>]+(?:href|xlink:href)=["']([^"']+)["']/gi)];
  svgMediaMatches.forEach(m => addAsset(m[1], 'images'));

  // 6. Input type="image"
  const inputImgMatches = [...html.matchAll(/<input[^>]+type=["']image["'][^>]+src=["']([^"']+)["']/gi)];
  inputImgMatches.forEach(m => addAsset(m[1], 'images'));

  // 7. Dynamic data attributes (lazy media, backgrounds)
  const dataAttrMatches = [...html.matchAll(/(?:data-src|data-lazy-src|data-original|data-bg|data-background|data-hi-res-src|data-full-src|data-image|data-url)=["']([^"']+)["']/gi)];
  dataAttrMatches.forEach(m => addAsset(m[1]));

  // 8. CSS url(...) backgrounds and fonts
  const cssUrlMatches = [...html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)];
  cssUrlMatches.forEach(m => {
    const raw = cleanUrlQuotes(m[1]);
    const cat = categorizeAsset(raw);
    addAsset(raw, cat === 'other' ? 'images' : cat);
  });

  return Array.from(assetMap.values());
}

/**
 * Recursively resolves and downloads all url(...) assets inside downloaded CSS files
 * in parallel and rewrites the CSS files to point to relative local paths (e.g. ../fonts/, ../images/).
 */
async function resolveAndRewriteCssAssets(cssDir, fontsDir, imagesDir, baseOrigin, relativePrefix, urlToLocalMap, networkAssets, recordAssetFn = null) {
  if (!fs.existsSync(cssDir)) return;
  const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));

  for (const cssFile of cssFiles) {
    const cssPath = path.join(cssDir, cssFile);
    let cssText = '';
    try {
      cssText = fs.readFileSync(cssPath, 'utf8');
    } catch (_) {
      continue;
    }

    const cssUrlRegex = /url\(\s*(['"]?)([^"')]+)\1\s*\)/gi;
    let modified = false;

    // Collect all unique raw URLs in this CSS file
    const uniqueRawMap = new Map();
    let match;
    while ((match = cssUrlRegex.exec(cssText)) !== null) {
      const raw = cleanUrlQuotes(match[2]);
      if (raw && !raw.startsWith('data:') && !raw.startsWith('blob:') && !raw.startsWith('#')) {
        if (!uniqueRawMap.has(raw)) {
          try {
            const abs = new URL(raw, baseOrigin).toString();
            if (abs.startsWith('http://') || abs.startsWith('https://')) {
              uniqueRawMap.set(raw, abs);
            }
          } catch (_) {}
        }
      }
    }

    // Parallel high-throughput fetch across unique CSS asset URLs (accelerated multi-worker concurrency)
    const itemsToFetch = Array.from(uniqueRawMap.entries());
    await runWithConcurrency(itemsToFetch, DYNAMIC_DOWNLOAD_CONCURRENCY, async ([raw, absoluteUrl]) => {
      const cat = categorizeAsset(absoluteUrl);
      const isFont = cat === 'fonts' || /\.(woff2?|ttf|otf|eot)/i.test(absoluteUrl);
      const targetDir = isFont ? fontsDir : imagesDir;
      const targetCategory = isFont ? 'fonts' : 'images';
      const safeName = createSafeFilename(absoluteUrl, targetCategory);
      const cleanName = getCleanFilename(absoluteUrl);
      const filePath = path.join(targetDir, safeName);

      // Check if already in networkAssets (exact or clean url)
      let buffer = null;
      if (networkAssets) {
        if (networkAssets.has(absoluteUrl)) {
          buffer = networkAssets.get(absoluteUrl).buffer;
        } else {
          const cleanUrl = absoluteUrl.split('?')[0].split('#')[0];
          if (networkAssets.has(cleanUrl)) {
            buffer = networkAssets.get(cleanUrl).buffer;
          }
        }
      }

      if (!fs.existsSync(filePath)) {
        if (!buffer) {
          buffer = await downloadBuffer(absoluteUrl, 8000, baseOrigin);
        }
        if (buffer && buffer.length > 0) {
          try {
            await fs.promises.writeFile(filePath, buffer);
            if (cleanName && cleanName !== safeName) {
              const cleanPath = path.join(targetDir, cleanName);
              if (!fs.existsSync(cleanPath)) {
                await fs.promises.writeFile(cleanPath, buffer).catch(() => {});
              }
            }
          } catch (_) {}
          const localRel = `${relativePrefix}${targetCategory}/${safeName}`;
          urlToLocalMap.set(absoluteUrl, localRel);
          if (typeof recordAssetFn === 'function') {
            recordAssetFn({
              originalUrl: absoluteUrl,
              localPath: localRel,
              category: targetCategory,
              mimeType: getMimeType(absoluteUrl),
              size: buffer.length,
              status: 'downloaded'
            });
          }
        } else if (typeof recordAssetFn === 'function') {
          recordAssetFn({
            originalUrl: absoluteUrl,
            localPath: '',
            category: targetCategory,
            mimeType: getMimeType(absoluteUrl),
            size: 0,
            status: 'failed',
            failureReason: 'CSS asset remote fetch returned null or timed out'
          });
        }
      }
    });

    // Rewrite all occurrences in cssText
    for (const [raw, absoluteUrl] of uniqueRawMap.entries()) {
      const cat = categorizeAsset(absoluteUrl);
      const isFont = cat === 'fonts' || /\.(woff2?|ttf|otf|eot)/i.test(absoluteUrl);
      const targetCategory = isFont ? 'fonts' : 'images';
      const safeName = createSafeFilename(absoluteUrl, targetCategory);
      const filePath = path.join(isFont ? fontsDir : imagesDir, safeName);
      const relativeFromCss = `../${targetCategory}/${safeName}`;

      if (fs.existsSync(filePath)) {
        const escapedRaw = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const replaceRegex = new RegExp(`url\\(\\s*['"]?${escapedRaw}['"]?\\s*\\)`, 'g');
        cssText = cssText.replace(replaceRegex, `url("${relativeFromCss}")`);
        modified = true;
      }
    }

    if (modified) {
      try {
        fs.writeFileSync(cssPath, cssText, 'utf8');
      } catch (_) {}
    }
  }
}

/**
 * Downloads all assets for a clone and writes them into <cloneDir>/assets/
 * Rewrites the HTML content so all asset references point to relative local paths.
 * Generates and updates <cloneDir>/resource-manifest.json for resilient runtime lookups.
 *
 * @param {object} params
 * @param {string} params.cloneDir - Destination directory for the clone
 * @param {string} params.html - Rendered HTML content
 * @param {string} params.baseOrigin - Website origin
 * @param {number} [params.depth=0] - Page depth (0 for root index.html, 1 for subpages)
 * @param {Map} [params.networkAssets=null] - Pre-captured network responses from Playwright
 * @returns {Promise<{ rewrittenHtml: string, metrics: object, manifest: object }>}
 */
async function downloadAndRewriteAssets({ cloneDir, html, baseOrigin, depth = 0, networkAssets = null }) {
  const assetsDir = path.join(cloneDir, 'assets');
  const cssDir = path.join(assetsDir, 'css');
  const jsDir = path.join(assetsDir, 'js');
  const imagesDir = path.join(assetsDir, 'images');
  const fontsDir = path.join(assetsDir, 'fonts');
  const mediaDir = path.join(assetsDir, 'media');
  const dataDir = path.join(assetsDir, 'data');

  [cssDir, jsDir, imagesDir, fontsDir, mediaDir, dataDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  const relativePrefix = depth > 0 ? '../'.repeat(depth) + 'assets/' : './assets/';
  const urlToLocalMap = new Map();

  let downloadedBytes = 0;
  const metrics = {
    totalDownloaded: 0,
    cssCount: 0,
    jsCount: 0,
    imagesCount: 0,
    fontsCount: 0,
    mediaCount: 0,
    dataCount: 0,
    totalBytes: 0,
    failedAssets: []
  };

  // Prepare and synchronize resource-manifest.json in cloneDir
  const manifestPath = path.join(cloneDir, 'resource-manifest.json');
  let manifestData = {
    version: '2.0',
    generatedAt: new Date().toISOString(),
    baseOrigin,
    totalAssets: 0,
    downloadedCount: 0,
    failedCount: 0,
    totalBytes: 0,
    assets: [],
    lookupByLocalPath: {},
    lookupByOriginalUrl: {}
  };

  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (existing && typeof existing === 'object') {
        manifestData = {
          ...manifestData,
          ...existing,
          lookupByLocalPath: existing.lookupByLocalPath || {},
          lookupByOriginalUrl: existing.lookupByOriginalUrl || {},
          assets: Array.isArray(existing.assets) ? existing.assets : []
        };
      }
    } catch (_) {}
  }

  const recordAssetManifest = ({ originalUrl, localPath = '', category = 'other', mimeType = '', size = 0, status = 'downloaded', failureReason = null }) => {
    if (!originalUrl) return;
    const normLocal = localPath ? localPath.replace(/^\.\//, '').replace(/^(\.\.\/)+/, '') : '';
    const record = {
      originalUrl,
      localPath: normLocal,
      category,
      mimeType: mimeType || getMimeType(originalUrl),
      size: size || 0,
      status,
      failureReason,
      timestamp: new Date().toISOString()
    };

    if (normLocal) {
      manifestData.lookupByLocalPath[normLocal] = record;
      const baseName = path.basename(normLocal);
      manifestData.lookupByLocalPath[baseName] = record;
      const cleanSub = normLocal.replace(/^assets\//, '');
      manifestData.lookupByLocalPath[cleanSub] = record;
    }
    manifestData.lookupByOriginalUrl[originalUrl] = record;
    const cleanOrig = originalUrl.split('?')[0].split('#')[0];
    if (cleanOrig !== originalUrl) {
      manifestData.lookupByOriginalUrl[cleanOrig] = record;
    }

    const existingIdx = manifestData.assets.findIndex(a => a.originalUrl === originalUrl || (normLocal && a.localPath === normLocal));
    if (existingIdx >= 0) {
      manifestData.assets[existingIdx] = record;
    } else {
      manifestData.assets.push(record);
    }

    if (status === 'failed') {
      metrics.failedAssets.push(record);
    }
  };

  const writeAssetFile = (targetDir, category, url, buffer) => {
    if (!buffer || buffer.length === 0) return;
    const safeName = createSafeFilename(url, category);
    const cleanName = getCleanFilename(url);
    const filePath = path.join(targetDir, safeName);
    const localRelativePath = `${relativePrefix}${category === 'other' ? 'images' : category}/${safeName}`;

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer);
      downloadedBytes += buffer.length;
      metrics.totalDownloaded++;
      if (category === 'css') metrics.cssCount++;
      else if (category === 'js') metrics.jsCount++;
      else if (category === 'fonts') metrics.fontsCount++;
      else if (category === 'media') metrics.mediaCount++;
      else if (category === 'data') metrics.dataCount++;
      else metrics.imagesCount++;
    }

    // Preserve original clean filename for ES module chunks and direct relative imports
    if (cleanName && cleanName !== safeName) {
      const cleanPath = path.join(targetDir, cleanName);
      if (!fs.existsSync(cleanPath)) {
        try { fs.writeFileSync(cleanPath, buffer); } catch (_) {}
      }
    }

    urlToLocalMap.set(url, localRelativePath);
    recordAssetManifest({
      originalUrl: url,
      localPath: localRelativePath,
      category,
      mimeType: getMimeType(url),
      size: buffer.length,
      status: 'downloaded'
    });
  };

  // 1. Ingest all pre-captured dynamic network assets from the live Playwright session
  if (networkAssets && networkAssets.size > 0) {
    for (const [netUrl, assetData] of networkAssets.entries()) {
      let cat = categorizeAsset(netUrl);
      if (cat === 'other') {
        if (assetData.type === 'script') cat = 'js';
        else if (assetData.type === 'stylesheet') cat = 'css';
        else if (assetData.type === 'image') cat = 'images';
        else if (assetData.type === 'font') cat = 'fonts';
        else if (assetData.type === 'media') cat = 'media';
        else if (assetData.type === 'xhr' || assetData.type === 'fetch') cat = 'data';
      }

      const targetDir = {
        css: cssDir,
        js: jsDir,
        images: imagesDir,
        fonts: fontsDir,
        media: mediaDir,
        data: dataDir
      }[cat] || imagesDir;

      writeAssetFile(targetDir, cat, netUrl, assetData.buffer);
    }
  }

  // 2. Extract and download remaining assets declared in HTML with high concurrency (accelerated multi-worker concurrency)
  const assets = extractAssetUrls(html, baseOrigin);

  await runWithConcurrency(assets, DYNAMIC_DOWNLOAD_CONCURRENCY, async (asset) => {
    if (urlToLocalMap.has(asset.url)) return;

    const targetDir = {
      css: cssDir,
      js: jsDir,
      images: imagesDir,
      fonts: fontsDir,
      media: mediaDir,
      data: dataDir
    }[asset.category] || imagesDir;

    // Check pre-captured networkAssets (exact or query-stripped)
    let buffer = null;
    if (networkAssets) {
      if (networkAssets.has(asset.url)) {
        buffer = networkAssets.get(asset.url).buffer;
      } else {
        const cleanUrl = asset.url.split('?')[0].split('#')[0];
        if (networkAssets.has(cleanUrl)) {
          buffer = networkAssets.get(cleanUrl).buffer;
        }
      }
    }

    if (!buffer) {
      buffer = await downloadBuffer(asset.url, 8000, baseOrigin);
    }

    if (buffer) {
      writeAssetFile(targetDir, asset.category, asset.url, buffer);
    } else {
      recordAssetManifest({
        originalUrl: asset.url,
        localPath: '',
        category: asset.category,
        mimeType: getMimeType(asset.url),
        size: 0,
        status: 'failed',
        failureReason: 'Download returned null or non-200'
      });
    }
  });

  // 3. Recursively extract and resolve assets inside downloaded CSS files
  await resolveAndRewriteCssAssets(cssDir, fontsDir, imagesDir, baseOrigin, relativePrefix, urlToLocalMap, networkAssets, recordAssetManifest);

  metrics.totalBytes = downloadedBytes;

  // 4. Rewrite URLs in HTML
  // Strip remote <base href> tags to ensure local ./assets/ paths resolve locally
  let rewritten = html.replace(/<base[^>]*>\s*/gi, '');

  for (const [remoteUrl, localPath] of urlToLocalMap.entries()) {
    // Replace exact occurrences inside quotes or url()
    const escaped = remoteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(["'])${escaped}(["'])`, 'g');
    rewritten = rewritten.replace(regex, `$1${localPath}$2`);

    const urlRegex = new RegExp(`url\\(\\s*["']?${escaped}["']?\\s*\\)`, 'g');
    rewritten = rewritten.replace(urlRegex, `url("${localPath}")`);
  }

  // Rewrite all srcset attributes with downloaded local paths
  rewritten = rewritten.replace(/(srcset=["'])([^"']+)(["'])/gi, (m, p1, srcsetValue, p2) => {
    const candidates = splitSrcsetCandidates(srcsetValue);
    if (!candidates.length) return m;
    const newCandidates = candidates.map(c => {
      let local = urlToLocalMap.get(c.url);
      if (!local) {
        try {
          const abs = new URL(c.url, baseOrigin).toString();
          local = urlToLocalMap.get(abs);
        } catch (_) {}
      }
      return `${local || c.url}${c.descriptor}`;
    });
    return `${p1}${newCandidates.join(', ')}${p2}`;
  });

  // Guarantee fallback in <picture> elements:
  // If the <img> inside a <picture> has been rewritten to a local asset,
  // ensure any <source> tags without valid local assets do not override and break the image.
  rewritten = rewritten.replace(/<picture[^>]*>([\s\S]*?)<\/picture>/gi, (match, inner) => {
    const imgMatch = inner.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (!imgMatch) return match;
    const localSrc = imgMatch[1];
    if (localSrc.startsWith(relativePrefix)) {
      const hasRemoteSource = /<source[^>]+srcset=["']https?:/i.test(inner);
      if (hasRemoteSource) {
        const cleanImg = imgMatch[0].replace(/srcset=["'][^"']+["']/gi, '');
        return cleanImg;
      }
    }
    return match;
  });

  // Persist updated resource-manifest.json to clone directory
  manifestData.totalAssets = manifestData.assets.length;
  manifestData.downloadedCount = manifestData.assets.filter(a => a.status === 'downloaded').length;
  manifestData.failedCount = manifestData.assets.filter(a => a.status === 'failed').length;
  manifestData.totalBytes = downloadedBytes;
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');
  } catch (_) {}

  return {
    rewrittenHtml: rewritten,
    metrics,
    manifest: manifestData
  };
}

module.exports = {
  downloadAndRewriteAssets,
  extractAssetUrls,
  categorizeAsset,
  createSafeFilename,
  getCleanFilename,
  downloadBuffer,
  getMimeType,
  DYNAMIC_DOWNLOAD_CONCURRENCY,
  keepAliveHttpAgent,
  keepAliveHttpsAgent
};
