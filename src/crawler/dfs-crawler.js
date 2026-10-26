const { crawlSiteSwarm } = require('./swarm-crawler');
const {
  EXCLUDED_EXTENSIONS,
  normalizeUrl,
  urlToLocalPath,
  isCrawlablePage
} = require('./url-utils');

/**
 * Executes a crawl starting at startUrl using the Exponential Self-Replicating Swarm Crawler.
 *
 * @param {string} startUrl - Initial validated target URL
 * @param {object} [options]
 * @param {number} [options.maxDepth=1] - Maximum link depth (0 = root only)
 * @param {number} [options.maxPages=8] - Maximum total pages to crawl
 * @param {number} [options.pageTimeout=20000] - Timeout per page in ms
 * @param {function} [options.onProgress] - Progress callback
 * @returns {Promise<{ pages: Array<object>, durationMs: number }>}
 */
async function crawlSiteDFS(startUrl, options = {}) {
  return await crawlSiteSwarm(startUrl, options);
}

module.exports = {
  normalizeUrl,
  urlToLocalPath,
  isCrawlablePage,
  crawlSiteDFS,
  crawlSiteSwarm
};

