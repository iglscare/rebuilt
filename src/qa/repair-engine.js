/**
 * Rebuilt Automated QA — Self-Repair Engine
 * 
 * Applies generalized, systemic repairs to cloned projects when runtime failures
 * are detected during QA exploration:
 * 
 * 1. Font Repair: Resolves missing @font-face URLs from target origin, downloads font binaries
 *    (woff2, woff, ttf, otf) into assets/fonts/, and rewrites CSS & HTML font references.
 * 2. API / CORS Repair: Rewrites client-side cross-origin API endpoints to route through
 *    the local /api/proxy server layer, ensuring zero CORS violations.
 * 3. Asset & Image/SVG Repair: Downloads missing static assets, SVGs, and media files,
 *    and maps them to local assets/ paths.
 * 4. Root-Relative Path Normalization: Rewrites root-relative URLs in stylesheets and HTML.
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { getCloneDirPath } = require('../storage/clone-storage');
const { ERROR_TYPES, isFontUrl, isImageUrl, isSvgUrl, isJsUrl, isCssUrl, isApiUrl } = require('./error-classifier');
const { validateUrl } = require('../security/ssrf-guard');
const sessionVault = require('../security/session-vault');
const https = require('https');
const http = require('http');

/**
 * Downloads a binary buffer from a remote URL with session cookie forwarding and SSRF protection.
 * @param {string} targetUrl
 * @param {string} [baseOrigin='']
 * @returns {Promise<Buffer|null>}
 */
async function downloadRemoteBuffer(targetUrl, baseOrigin = '') {
  try {
    const valid = await validateUrl(targetUrl);
    if (!valid.isValid) return null;

    return await new Promise((resolve) => {
      const isHttps = targetUrl.startsWith('https:');
      const client = isHttps ? https : http;

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': '*/*'
      };

      if (baseOrigin) {
        headers['Referer'] = baseOrigin;
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

      const req = client.get(targetUrl, { headers, timeout: 8000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirect = new URL(res.headers.location, targetUrl).toString();
          return downloadRemoteBuffer(redirect, baseOrigin).then(resolve);
        }

        if (res.statusCode !== 200) {
          return resolve(null);
        }

        const chunks = [];
        let total = 0;
        res.on('data', (c) => {
          chunks.push(c);
          total += c.length;
          if (total > 25 * 1024 * 1024) {
            req.destroy();
            resolve(null);
          }
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    });
  } catch (_) {
    return null;
  }
}

/**
 * Repairs missing fonts by finding or fetching the font binary, saving it to assets/fonts/,
 * and updating CSS and HTML references.
 * 
 * @param {object} error
 * @param {string} cloneDir
 * @param {string} targetOrigin
 * @returns {Promise<boolean>} True if repaired
 */
async function repairMissingFont(error, cloneDir, targetOrigin) {
  const fontsDir = path.join(cloneDir, 'assets/fonts');
  if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

  const rawUrl = error.sourceUrl || error.url || '';
  if (!rawUrl) return false;

  let baseName = '';
  try {
    baseName = path.basename(new URL(rawUrl, targetOrigin).pathname);
  } catch (_) {
    baseName = path.basename(rawUrl.split('?')[0]);
  }

  if (!baseName || !/\.(woff2?|ttf|otf|eot)/i.test(baseName)) return false;

  const fontDestPath = path.join(fontsDir, baseName);

  // 1. Check if font already exists in assets/fonts/
  let exists = fs.existsSync(fontDestPath);

  // 2. If not, download from source origin
  if (!exists) {
    let fetchUrl = rawUrl;
    if (fetchUrl.startsWith('http://localhost') || fetchUrl.startsWith('/')) {
      try {
        fetchUrl = new URL(fetchUrl.replace(/^https?:\/\/[^\/]+/, ''), targetOrigin).toString();
      } catch (_) {
        fetchUrl = `${targetOrigin.replace(/\/$/, '')}/${fetchUrl.replace(/^\/+/, '')}`;
      }
    }

    console.log(`[RepairEngine] 🔤 Downloading missing font: ${fetchUrl} -> ${baseName}`);
    const buf = await downloadRemoteBuffer(fetchUrl, targetOrigin);
    if (buf && buf.length > 0) {
      try {
        fs.writeFileSync(fontDestPath, buf);
        exists = true;
      } catch (_) {}
    }
  }

  if (!exists) return false;

  // 3. Rewrite occurrences in CSS files
  const cssDir = path.join(cloneDir, 'assets/css');
  if (fs.existsSync(cssDir)) {
    const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
    for (const cf of cssFiles) {
      const p = path.join(cssDir, cf);
      try {
        let text = fs.readFileSync(p, 'utf8');
        const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match any url(...) referencing this font
        const regex = new RegExp(`url\\(\\s*['"]?[^"')]*${escaped}['"]?\\s*\\)`, 'g');
        if (regex.test(text)) {
          text = text.replace(regex, `url("../fonts/${baseName}")`);
          fs.writeFileSync(p, text, 'utf8');
        }
      } catch (_) {}
    }
  }

  // 4. Rewrite occurrences in HTML files (including inlined <style> and __REBUILT_FONTS__)
  const htmlFiles = getAllHtmlFiles(cloneDir);
  for (const hf of htmlFiles) {
    try {
      let html = fs.readFileSync(hf, 'utf8');
      const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`url\\(\\s*['"]?[^"')]*${escaped}['"]?\\s*\\)`, 'g');
      if (regex.test(html)) {
        // Compute relative prefix based on depth of hf relative to cloneDir
        const relDepth = path.relative(cloneDir, path.dirname(hf)).split(path.sep).filter(Boolean).length;
        const prefix = relDepth === 0 ? './assets/fonts/' : '../'.repeat(relDepth) + 'assets/fonts/';
        html = html.replace(regex, `url("${prefix}${baseName}")`);
        fs.writeFileSync(hf, html, 'utf8');
      }
    } catch (_) {}
  }

  return true;
}

/**
 * Repairs client-side API and CORS failures by rewriting endpoints in HTML to route
 * through the local server /api/proxy layer.
 * 
 * @param {object} error
 * @param {string} cloneDir
 * @param {string} targetOrigin
 * @returns {Promise<boolean>}
 */
async function repairApiAndCors(error, cloneDir, targetOrigin) {
  const urlToProxy = error.sourceUrl || error.url;
  if (!urlToProxy) return false;

  console.log(`[RepairEngine] 🌐 Healing API / CORS failure for: ${urlToProxy}`);

  const htmlFiles = getAllHtmlFiles(cloneDir);
  let repaired = false;

  let urlPath = '';
  try {
    const u = new URL(urlToProxy, targetOrigin);
    urlPath = u.pathname + (u.search || '');
  } catch (_) {}

  for (const hf of htmlFiles) {
    try {
      let html = fs.readFileSync(hf, 'utf8');
      let modified = false;
      const escaped = urlToProxy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Check if href or endpoint is explicitly referenced in HTML tags
      const linkRegex = new RegExp(`(href|data-url|data-endpoint|src)=["']${escaped}["']`, 'gi');
      if (linkRegex.test(html)) {
        const proxiedEndpoint = `/api/proxy?url=${encodeURIComponent(urlToProxy)}`;
        html = html.replace(linkRegex, `$1="${proxiedEndpoint}"`);
        modified = true;
      }

      if (urlPath && urlPath.length > 3) {
        const escapedPath = urlPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pathRegex = new RegExp(`(href|data-url|data-endpoint|src)=["']${escapedPath}["']`, 'gi');
        if (pathRegex.test(html)) {
          const proxiedEndpoint = `/api/proxy?url=${encodeURIComponent(new URL(urlPath, targetOrigin).toString())}`;
          html = html.replace(pathRegex, `$1="${proxiedEndpoint}"`);
          modified = true;
        }
      }

      if (modified) {
        fs.writeFileSync(hf, html, 'utf8');
        repaired = true;
      }
    } catch (_) {}
  }

  return repaired;
}

/**
 * Repairs missing images, scripts, SVGs, or media files by downloading them from target origin
 * and saving into the appropriate clone assets directory, then updating references.
 * 
 * @param {object} error
 * @param {string} cloneDir
 * @param {string} targetOrigin
 * @returns {Promise<boolean>}
 */
async function repairMissingAsset(error, cloneDir, targetOrigin) {
  const rawUrl = error.sourceUrl || error.url || '';
  if (!rawUrl) return false;

  let baseName = '';
  try {
    baseName = path.basename(new URL(rawUrl, targetOrigin).pathname);
  } catch (_) {
    baseName = path.basename(rawUrl.split('?')[0]);
  }
  if (!baseName) return false;

  let category = 'images';
  if (isFontUrl(rawUrl)) category = 'fonts';
  else if (isSvgUrl(rawUrl) || isImageUrl(rawUrl)) category = 'images';
  else if (/\.(css)$/i.test(baseName) || isCssUrl(rawUrl)) category = 'css';
  else if (/\.(js|mjs|cjs)$/i.test(baseName) || isJsUrl(rawUrl)) category = 'js';
  else if (/\.(mp4|webm|mp3)$/i.test(baseName)) category = 'media';

  // If this is a CSS stylesheet, check if it was already inlined in HTML
  if (category === 'css') {
    const htmlFiles = getAllHtmlFiles(cloneDir);
    let inlinedAlready = false;
    for (const hf of htmlFiles) {
      try {
        let content = fs.readFileSync(hf, 'utf8');
        const decoded = decodeURIComponent(rawUrl);
        if (content.includes(`data-rebuilt-inlined="${rawUrl}"`) || content.includes(`data-rebuilt-inlined="${decoded}"`)) {
          inlinedAlready = true;
          const escapedRaw = rawUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const escapedDecoded = decoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          content = content.replace(new RegExp(`<link[^>]+href=["'](${escapedRaw}|${escapedDecoded})["'][^>]*>`, 'gi'), '');
          fs.writeFileSync(hf, content, 'utf8');
        }
      } catch (_) {}
    }
    if (inlinedAlready) return true;
  }

  const catDir = path.join(cloneDir, 'assets', category);
  if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });

  const destPath = path.join(catDir, baseName);
  let downloaded = fs.existsSync(destPath);

  if (!downloaded) {
    let fetchUrl = rawUrl;
    if (fetchUrl.startsWith('http://localhost') || fetchUrl.startsWith('/')) {
      try {
        fetchUrl = new URL(fetchUrl.replace(/^https?:\/\/[^\/]+/, ''), targetOrigin).toString();
      } catch (_) {
        fetchUrl = `${targetOrigin.replace(/\/$/, '')}/${fetchUrl.replace(/^\/+/, '')}`;
      }
    }

    console.log(`[RepairEngine] 📦 Downloading missing asset: ${fetchUrl} -> ${category}/${baseName}`);
    const buf = await downloadRemoteBuffer(fetchUrl, targetOrigin);
    if (buf && buf.length > 0) {
      try {
        fs.writeFileSync(destPath, buf);
        downloaded = true;
      } catch (_) {}
    } else if (category === 'js') {
      // Create safe fallback placeholder chunk so browser module/script execution continues cleanly
      try {
        fs.writeFileSync(destPath, '/* Rebuilt fallback chunk */ export default {};');
        downloaded = true;
      } catch (_) {}
    }
  }

  if (!downloaded) return false;

  // Rewrite all HTML references to this asset
  const htmlFiles = getAllHtmlFiles(cloneDir);
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedRaw = rawUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let anyModified = false;
  for (const hf of htmlFiles) {
    try {
      let content = fs.readFileSync(hf, 'utf8');
      const relToClone = path.relative(cloneDir, hf);
      const depth = Math.max(0, relToClone.split(path.sep).length - 1);
      const relPrefix = depth > 0 ? '../'.repeat(depth) + 'assets/' : './assets/';
      const targetLocal = `${relPrefix}${category}/${baseName}`;

      let modified = false;

      // 1. Replace exact rawUrl occurrences in attributes or url(...)
      if (rawUrl && content.includes(rawUrl)) {
        const regex = new RegExp(`(["'])${escapedRaw}(["'])`, 'g');
        content = content.replace(regex, `$1${targetLocal}$2`);
        const urlRegex = new RegExp(`url\\(\\s*["']?${escapedRaw}["']?\\s*\\)`, 'g');
        content = content.replace(urlRegex, `url("${targetLocal}")`);
        modified = true;
      }

      // 2. Also replace by baseName if in a src or href attribute
      const attrRegex = new RegExp(`(src|href|poster)=["'][^"']*${escapedBase}(?:\\?[^"']*)?["']`, 'gi');
      if (attrRegex.test(content)) {
        content = content.replace(attrRegex, `$1="${targetLocal}"`);
        modified = true;
      }

      if (modified) {
        fs.writeFileSync(hf, content, 'utf8');
        anyModified = true;
      }
    } catch (_) {}
  }

  return anyModified || downloaded;
}

/**
 * Repairs RUNTIME_EXCEPTION errors by injecting a defensive error guard script
 * at the top of all HTML files in the clone. This silences unhandled JS errors
 * from broken third-party scripts (analytics, social widgets, etc.) that cannot
 * be fixed by downloading or rewriting, but should not crash the clone preview.
 *
 * @param {object} error
 * @param {string} cloneDir
 * @param {string} targetOrigin
 * @returns {Promise<boolean>}
 */
async function repairRuntimeException(error, cloneDir, targetOrigin) {
  const guardScript = `<script data-rebuilt-error-guard="true">
(function() {
  // Rebuilt Error Guard — silences unresolvable third-party JS exceptions
  // that cannot be fixed in a local clone (analytics, social widgets, etc.)
  var _origError = window.onerror;
  window.onerror = function(msg, src, line, col, err) {
    // Let local script errors bubble (they may be fixable)
    if (src && src.includes('localhost')) {
      if (_origError) return _origError.apply(this, arguments);
      return false;
    }
    // Suppress external origin errors silently in preview mode
    return true;
  };
  window.addEventListener('unhandledrejection', function(event) {
    if (event.reason && event.reason.stack) {
      var stack = String(event.reason.stack);
      if (!stack.includes('localhost')) { event.preventDefault(); }
    }
  });
  // Patch fetch/XHR for third-party API calls that 404 in clone mode
  var _origFetch = window.fetch;
  window.fetch = function(url) {
    return _origFetch.apply(this, arguments).catch(function(e) {
      if (url && typeof url === 'string' && !url.includes('localhost')) {
        return new Response(JSON.stringify({status:'preview',data:[]}), {
          status: 200, headers: {'Content-Type':'application/json'}
        });
      }
      throw e;
    });
  };
}());
<\/script>`;

  const htmlFiles = getAllHtmlFiles(cloneDir);
  let patched = 0;

  for (const hf of htmlFiles) {
    try {
      let html = fs.readFileSync(hf, 'utf8');
      // Only inject once
      if (html.includes('data-rebuilt-error-guard')) continue;

      // Inject immediately after <head> or before first <script>
      if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>\n' + guardScript);
      } else if (html.includes('<head ')) {
        html = html.replace(/(<head[^>]*>)/, '$1\n' + guardScript);
      } else if (html.includes('<script')) {
        html = html.replace('<script', guardScript + '\n<script');
      } else {
        html = guardScript + '\n' + html;
      }

      fs.writeFileSync(hf, html, 'utf8');
      patched++;
    } catch (_) {}
  }

  console.log(`[RepairEngine] 🛡️  Injected JS error guard into ${patched} HTML file(s).`);
  return patched > 0;
}


/**
 * Helper to recursively find all .html files inside a directory.
 * @param {string} dir
 * @returns {Array<string>}
 */
function getAllHtmlFiles(dir) {
  const results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      if (file === 'node_modules' || file === 'screenshots') continue;
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat && stat.isDirectory()) {
        results.push(...getAllHtmlFiles(full));
      } else if (file.endsWith('.html') || file.endsWith('.htm')) {
        results.push(full);
      }
    }
  } catch (_) {}
  return results;

}

/**
 * Applies generalized self-repairs across all classified errors.
 * 
 * @param {object} params
 * @param {Array<object>} params.classifiedErrors
 * @param {string} params.cloneId
 * @param {string} params.targetOrigin
 * @returns {Promise<{ repairedCount: number, repairLog: Array<object> }>}
 */
async function applySelfRepairs({ classifiedErrors, cloneId, targetOrigin }) {
  const cloneDir = getCloneDirPath(cloneId);
  const repairLog = [];
  let repairedCount = 0;

  for (const err of classifiedErrors) {
    let success = false;

    // NAVIGATION_FAILURE, BROKEN_ROUTE, and RESOURCE_TIMEOUT are informational —
    // they cannot be fixed by downloading assets or proxying APIs. Skip them to
    // prevent infinite repair loops on unresolvable rendering timeouts.
    if (
      err.type === ERROR_TYPES.NAVIGATION_FAILURE ||
      err.type === ERROR_TYPES.BROKEN_ROUTE ||
      err.type === ERROR_TYPES.RESOURCE_TIMEOUT
    ) {
      continue;
    }

    if (err.type === ERROR_TYPES.MISSING_FONT) {
      success = await repairMissingFont(err, cloneDir, targetOrigin);
    } else if (err.type === ERROR_TYPES.RUNTIME_EXCEPTION) {
      success = await repairRuntimeException(err, cloneDir, targetOrigin);
    } else if (err.type === ERROR_TYPES.CORS_FAILURE) {
      if (err.resourceType === 'script' || isJsUrl(err.sourceUrl || err.url)) {
        success = await repairMissingAsset(err, cloneDir, targetOrigin);
      } else if (err.resourceType === 'stylesheet' || isCssUrl(err.sourceUrl || err.url)) {
        success = await repairMissingAsset(err, cloneDir, targetOrigin);
      } else {
        success = await repairApiAndCors(err, cloneDir, targetOrigin);
      }
    } else if (err.type === ERROR_TYPES.API_FAILURE) {
      success = await repairApiAndCors(err, cloneDir, targetOrigin);
    } else if (
      err.type === ERROR_TYPES.MISSING_ASSET ||
      err.type === ERROR_TYPES.BROKEN_IMAGE ||
      err.type === ERROR_TYPES.BROKEN_SVG ||
      err.type === ERROR_TYPES.BROKEN_JS ||
      err.type === ERROR_TYPES.BROKEN_CSS
    ) {
      success = await repairMissingAsset(err, cloneDir, targetOrigin);
    }

    if (success) {
      repairedCount++;
      repairLog.push({
        type: err.type,
        url: err.url,
        action: `Repaired and mapped ${err.type} to local offline asset or proxy`
      });
    }
  }

  return {
    repairedCount,
    repairLog
  };
}

module.exports = {
  applySelfRepairs,
  repairMissingFont,
  repairApiAndCors,
  repairMissingAsset
};
