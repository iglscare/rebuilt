/**
 * Rebuilt Web Cloner — URL Utilities
 * Handles normalization, local filesystem mapping, and crawlability checks.
 */

const { URL } = require('url');

const EXCLUDED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.avif', '.ico',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav',
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.exe', '.dmg', '.iso', '.apk', '.bin'
]);

/**
 * Strips URL fragments, trailing slashes, and tracking query params.
 * @param {string} rawUrl
 * @returns {string} Normalized URL
 */
function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';

    // Strip common tracking and analytics query parameters
    const paramsToDelete = [];
    u.searchParams.forEach((_, key) => {
      const lower = key.toLowerCase();
      if (
        lower.startsWith('utm_') ||
        lower === 'fbclid' ||
        lower === 'gclid' ||
        lower === 'msclkid' ||
        lower === 'ref' ||
        lower === 'source' ||
        lower === '_ga'
      ) {
        paramsToDelete.push(key);
      }
    });
    paramsToDelete.forEach(p => u.searchParams.delete(p));

    let normalized = u.toString();
    if (normalized.endsWith('/') && u.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch (_) {
    return rawUrl;
  }
}

/**
 * Maps a target URL to a safe relative filesystem path within a clone directory.
 * @param {string} targetUrl
 * @param {string} [baseUrl]
 * @returns {string} Relative path (e.g. "index.html", "about/index.html")
 */
function urlToLocalPath(targetUrl, baseUrl) {
  try {
    const u = new URL(targetUrl, baseUrl);
    let pathname = decodeURIComponent(u.pathname);

    // Root path maps to index.html
    if (pathname === '' || pathname === '/') {
      return 'index.html';
    }

    // Strip leading slash
    if (pathname.startsWith('/')) {
      pathname = pathname.slice(1);
    }

    // Strip trailing slash
    if (pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // Sanitize path segments to prevent directory traversal
    const segments = pathname
      .split('/')
      .map(seg => seg.replace(/[^a-zA-Z0-9._-]/g, '_'))
      .filter(Boolean);

    if (segments.length === 0) {
      return 'index.html';
    }

    const lastSegment = segments[segments.length - 1];
    if (lastSegment.includes('.')) {
      return segments.join('/');
    }

    // Directory without extension -> save as <directory>/index.html
    return `${segments.join('/')}/index.html`;
  } catch (_) {
    return 'index.html';
  }
}

/**
 * Validates if a discovered URL is crawlable and strictly same-origin.
 * @param {string} urlStr
 * @param {string} baseOrigin
 * @returns {boolean}
 */
function isCrawlablePage(urlStr, baseOrigin) {
  try {
    const u = new URL(urlStr);
    if (u.origin !== baseOrigin) {
      return false;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return false;
    }
    const pathname = u.pathname.toLowerCase();
    for (const ext of EXCLUDED_EXTENSIONS) {
      if (pathname.endsWith(ext)) {
        return false;
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  EXCLUDED_EXTENSIONS,
  normalizeUrl,
  urlToLocalPath,
  isCrawlablePage
};
