/**
 * REBUILT — Communication Bridge: Manifest Manager
 * 
 * Manages clone-manifest.json and discovery-driven configuration:
 * 1. Resolves targetOrigin, allowedOrigins, routes, and modes
 * 2. Supports Modes:
 *    - SNAPSHOT: No backend communication (static only)
 *    - LIVE_BRIDGE: Live communication with authorized original backend
 *    - HYBRID: Static cloned assets + live backend communication
 * 3. Generates or extends manifest from Playwright network discovery data
 * 4. Strictly redacts sensitive credentials and query parameters
 */

const fs = require('fs');
const path = require('path');
const { getCloneManifest } = require('../storage/clone-storage');
const { RouteMap } = require('./route-map');

const MODES = {
  SNAPSHOT: 'SNAPSHOT',
  LIVE_BRIDGE: 'LIVE_BRIDGE',
  HYBRID: 'HYBRID'
};

class ManifestManager {
  /**
   * Loads and normalizes a clone manifest.
   * 
   * @param {string} cloneId 
   * @param {object} [inMemoryManifest] - Optional in-memory override
   * @returns {Promise<object>}
   */
  static async load(cloneId, inMemoryManifest = null) {
    let raw = inMemoryManifest;
    if (!raw && cloneId) {
      try {
        raw = await getCloneManifest(cloneId);
      } catch (_) {
        raw = null;
      }
    }

    if (!raw) {
      return null;
    }

    return this.normalize(raw);
  }

  /**
   * Normalizes a raw manifest object into standard structure.
   * 
   * @param {object} manifest 
   * @returns {object}
   */
  static normalize(manifest = {}) {
    let mode = (manifest.mode || (manifest.communication && manifest.communication.mode) || MODES.HYBRID).toUpperCase();
    if (mode === 'BRIDGE') mode = MODES.LIVE_BRIDGE;
    if (!MODES[mode]) mode = MODES.HYBRID;

    const targetOrigin = manifest.targetOrigin || '';
    const allowedOrigins = Array.isArray(manifest.allowedOrigins)
      ? manifest.allowedOrigins
      : (targetOrigin ? [targetOrigin] : []);

    const routes = RouteMap.normalizeRoutes(manifest.routes);

    return {
      version: manifest.version || '2.0.0',
      targetOrigin,
      allowedOrigins,
      mode,
      routes,
      rawRoutes: manifest.routes || {},
      websockets: manifest.websockets || [],
      sse: manifest.sse || [],
      stats: manifest.stats || {},
      generatedAt: manifest.generatedAt || new Date().toISOString()
    };
  }

  /**
   * Generates a manifest from Playwright network discovery entries.
   * 
   * @param {object} params
   * @param {string} params.targetOrigin - Base origin
   * @param {Array<object>} params.discoveryEntries - Network discovery logs from Playwright
   * @param {string} [params.mode='HYBRID']
   * @returns {object} Generated manifest
   */
  static generateFromDiscovery({ targetOrigin, discoveryEntries = [], mode = MODES.HYBRID }) {
    const origin = (targetOrigin || '').replace(/\/+$/, '');
    const routesMap = {};
    const allowedOriginsSet = new Set();
    if (origin) allowedOriginsSet.add(origin);

    for (const entry of discoveryEntries) {
      if (!entry || !entry.url) continue;

      try {
        const parsed = new URL(entry.url);
        // Exclude common non-API static asset types
        const isStaticAsset = /\.(png|jpg|jpeg|gif|svg|webp|avif|ico|css|woff2?|ttf|otf|mp4|webm)$/i.test(parsed.pathname);
        if (isStaticAsset) continue;

        const isApiCandidate = parsed.pathname.includes('/api/') ||
          parsed.pathname.includes('/graphql') ||
          parsed.pathname.includes('/v1/') ||
          parsed.pathname.includes('/v2/') ||
          entry.resourceType === 'fetch' ||
          entry.resourceType === 'xhr' ||
          (entry.contentType && entry.contentType.includes('application/json'));

        if (!isApiCandidate) continue;

        allowedOriginsSet.add(parsed.origin);

        const method = (entry.method || 'GET').toUpperCase();
        const routeKey = parsed.pathname;

        if (!routesMap[routeKey]) {
          routesMap[routeKey] = {
            target: parsed.pathname,
            methods: [method],
            requiresAuth: Boolean(entry.requiresAuth || /auth|login|token|account/i.test(parsed.pathname)),
            contentType: entry.contentType || 'application/json'
          };
        } else {
          if (!routesMap[routeKey].methods.includes(method)) {
            routesMap[routeKey].methods.push(method);
          }
        }
      } catch (_) {}
    }

    return {
      version: '2.0.0',
      targetOrigin: origin,
      allowedOrigins: Array.from(allowedOriginsSet),
      mode,
      routes: routesMap,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  ManifestManager,
  MODES
};
