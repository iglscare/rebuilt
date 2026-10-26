/**
 * Rebuilt Web Cloner — Tech-Guided Reverse Engineering & Multi-Page Discovery
 * Discovers published page routes via sitemaps, robots.txt, Next.js build manifests, and WordPress APIs.
 */

const http = require('http');
const https = require('https');
const { validateUrl } = require('../security/ssrf-guard');
const { normalizeUrl, isCrawlablePage } = require('./url-utils');

/**
 * Safely fetches text content from a URL with timeout and SSRF guard.
 * @param {string} targetUrl
 * @param {number} [timeoutMs=3500]
 * @returns {Promise<string|null>}
 */
async function safeFetchText(targetUrl, timeoutMs = 3500) {
  try {
    const valid = await validateUrl(targetUrl);
    if (!valid.isValid) return null;

    return await new Promise((resolve) => {
      const client = targetUrl.startsWith('https:') ? https : http;
      const req = client.get(
        targetUrl,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xml,text/xml,application/json,*/*'
          },
          timeout: timeoutMs
        },
        (res) => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 400)) {
            return resolve(null);
          }
          let data = '';
          res.setEncoding('utf8');
          res.on('data', chunk => {
            data += chunk;
            if (data.length > 2 * 1024 * 1024) { // 2MB max for sitemaps
              req.destroy();
              resolve(data);
            }
          });
          res.on('end', () => resolve(data));
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
 * Discovers sitemap URLs from robots.txt content
 * @param {string} origin
 * @returns {Promise<string[]>}
 */
async function discoverSitemapsFromRobots(origin) {
  const robotsUrl = `${origin}/robots.txt`;
  const robotsTxt = await safeFetchText(robotsUrl);
  if (!robotsTxt) return [];

  const sitemaps = [];
  const lines = robotsTxt.split('\n');
  for (const line of lines) {
    const match = line.match(/^Sitemap:\s*(https?:\/\/[^\s#]+)/i);
    if (match && match[1]) {
      sitemaps.push(match[1].trim());
    }
  }
  return sitemaps;
}

/**
 * Parses XML sitemap content and extracts all <loc> page URLs
 * @param {string} xmlContent
 * @param {string} baseOrigin
 * @returns {string[]}
 */
function parseSitemapLocs(xmlContent, baseOrigin) {
  if (!xmlContent || typeof xmlContent !== 'string') return [];
  const urls = [];
  const locRegex = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xmlContent)) !== null) {
    const url = match[1].trim();
    if (isCrawlablePage(url, baseOrigin)) {
      urls.push(normalizeUrl(url));
    }
  }
  return urls;
}

/**
 * Discovers routes from Next.js manifests if detected
 * @param {string} origin
 * @param {string} html
 * @returns {Promise<string[]>}
 */
async function discoverNextJsRoutes(origin, html) {
  const routes = [];
  try {
    // Check for build manifest script URL
    const manifestMatch = html.match(/_next\/static\/([^/]+)\/_buildManifest\.js/i);
    if (manifestMatch) {
      const buildId = manifestMatch[1];
      const manifestUrl = `${origin}/_next/static/${buildId}/_buildManifest.js`;
      const manifestJs = await safeFetchText(manifestUrl);
      if (manifestJs) {
        // Look for string routes in sortedPages array: e.g. "/about", "/contact", "/pricing"
        const routeMatches = [...manifestJs.matchAll(/["'](\/[a-zA-Z0-9_/-]*)["']/g)];
        routeMatches.forEach((m) => {
          const path = m[1];
          if (
            path &&
            !path.startsWith('/_') &&
            !path.includes('[') &&
            !path.includes(']') &&
            path !== '/404' &&
            path !== '/500'
          ) {
            const fullUrl = `${origin}${path}`;
            if (isCrawlablePage(fullUrl, origin)) {
              routes.push(normalizeUrl(fullUrl));
            }
          }
        });
      }
    }
  } catch (_) {}
  return routes;
}

/**
 * Discovers pages via WordPress REST API if detected
 * @param {string} origin
 * @returns {Promise<string[]>}
 */
async function discoverWordPressRoutes(origin) {
  const routes = [];
  try {
    const apiUrl = `${origin}/wp-json/wp/v2/pages?per_page=50&_fields=link`;
    const jsonStr = await safeFetchText(apiUrl);
    if (jsonStr && jsonStr.startsWith('[')) {
      const items = JSON.parse(jsonStr);
      if (Array.isArray(items)) {
        items.forEach((item) => {
          if (item && item.link && isCrawlablePage(item.link, origin)) {
            routes.push(normalizeUrl(item.link));
          }
        });
      }
    }
  } catch (_) {}
  return routes;
}

/**
 * Master reverse engineering discovery pipeline
 * Probes sitemaps, framework manifests, and CMS APIs to collect all discoverable routes.
 *
 * @param {string} startUrl - Initial seed URL
 * @param {object} options
 * @param {string} [options.html] - Rendered HTML of root page
 * @param {Array} [options.technologies] - Detected technologies from profiler
 * @returns {Promise<string[]>} Array of discovered subpage URLs
 */
async function reverseEngineerRoutes(startUrl, { html = '', technologies = [] } = {}) {
  const discovered = new Set();
  let baseOrigin;
  try {
    baseOrigin = new URL(startUrl).origin;
  } catch (_) {
    return [];
  }

  const techNames = technologies.map(t => (t.name || '').toLowerCase());

  // 1. Robots.txt & Sitemap Discovery
  try {
    const sitemapUrls = await discoverSitemapsFromRobots(baseOrigin);
    // Add default sitemap locations if none in robots.txt
    if (sitemapUrls.length === 0) {
      sitemapUrls.push(`${baseOrigin}/sitemap.xml`, `${baseOrigin}/sitemap_index.xml`);
    }

    for (const sitemapUrl of sitemapUrls.slice(0, 3)) {
      const xml = await safeFetchText(sitemapUrl);
      if (xml && (xml.includes('<urlset') || xml.includes('<sitemapindex') || xml.includes('<loc>'))) {
        const pageUrls = parseSitemapLocs(xml, baseOrigin);
        pageUrls.forEach(u => discovered.add(u));
      }
    }
  } catch (_) {}

  // 2. Next.js Manifest Discovery
  if (techNames.some(t => t.includes('next'))) {
    const nextRoutes = await discoverNextJsRoutes(baseOrigin, html);
    nextRoutes.forEach(u => discovered.add(u));
  }

  // 3. WordPress REST API Discovery
  if (techNames.some(t => t.includes('wordpress'))) {
    const wpRoutes = await discoverWordPressRoutes(baseOrigin);
    wpRoutes.forEach(u => discovered.add(u));
  }

  return Array.from(discovered);
}

module.exports = {
  reverseEngineerRoutes,
  discoverSitemapsFromRobots,
  parseSitemapLocs,
  safeFetchText
};
