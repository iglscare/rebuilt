/**
 * REBUILT — Communication Bridge: Route Map
 * 
 * Maps incoming client requests to upstream target routes:
 * 1. Supports object format: { "/api/login": { target: "/api/login", methods: ["POST"] } }
 * 2. Supports array format: [ { path: "/api/courses", method: "GET" } ]
 * 3. Handles exact paths, parameterized routes (:id, [id]), and wildcards (/*)
 * 4. Normalizes paths and HTTP methods
 */

class RouteMap {
  /**
   * Normalizes manifest routes into a uniform list of route definitions.
   * 
   * @param {object|Array} routesConfig - Manifest routes (object or array)
   * @returns {Array<object>} Uniform route objects
   */
  static normalizeRoutes(routesConfig) {
    if (!routesConfig) return [];

    if (Array.isArray(routesConfig)) {
      return routesConfig.map(r => ({
        path: r.path || '/',
        target: r.target || r.path || '/',
        methods: r.methods ? r.methods.map(m => m.toUpperCase()) : (r.method ? [r.method.toUpperCase()] : ['ALL']),
        requiresAuth: Boolean(r.requiresAuth),
        contentType: r.contentType || 'application/json',
        mode: r.mode || 'proxy'
      }));
    }

    if (typeof routesConfig === 'object') {
      const list = [];
      for (const [routePath, routeDef] of Object.entries(routesConfig)) {
        if (!routeDef) continue;
        const target = typeof routeDef === 'string' ? routeDef : (routeDef.target || routePath);
        const rawMethods = typeof routeDef === 'object'
          ? (routeDef.methods || (routeDef.method ? [routeDef.method] : ['ALL']))
          : ['ALL'];
        const methods = Array.isArray(rawMethods) ? rawMethods.map(m => m.toUpperCase()) : [String(rawMethods).toUpperCase()];

        list.push({
          path: routePath,
          target,
          methods,
          requiresAuth: Boolean(typeof routeDef === 'object' ? routeDef.requiresAuth : false),
          contentType: (typeof routeDef === 'object' && routeDef.contentType) || 'application/json',
          mode: (typeof routeDef === 'object' && routeDef.mode) || 'proxy'
        });
      }
      return list;
    }

    return [];
  }

  /**
   * Converts route path with parameter tokens (:id or [id] or *) into a RegExp.
   * 
   * @param {string} routePath 
   * @returns {RegExp|null}
   */
  static pathToRegex(routePath) {
    if (!routePath.includes(':') && !routePath.includes('[') && !routePath.includes('*')) {
      return null;
    }
    const escaped = routePath
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([a-zA-Z0-9_]+)/g, '([^\\/]+)')
      .replace(/\\\[([a-zA-Z0-9_]+)\\\]/g, '([^\\/]+)')
      .replace(/\\\*/g, '(.*)');
    return new RegExp(`^${escaped}$`, 'i');
  }

  /**
   * Matches a request method and path against the manifest routes.
   * 
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} reqPath - Requested path (e.g. /api/user or /api/courses/42)
   * @param {object|Array} routesConfig - Manifest routes
   * @returns {object|null} Matched route details or null
   */
  static match(method, reqPath, routesConfig) {
    const normMethod = (method || 'GET').toUpperCase();
    const cleanPath = reqPath.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    const routes = this.normalizeRoutes(routesConfig);

    for (const route of routes) {
      const methodAllowed = route.methods.includes(normMethod) || route.methods.includes('ALL');
      if (!methodAllowed) continue;

      const routePath = (route.path || '').replace(/\/+$/, '') || '/';

      // 1. Exact path match
      if (cleanPath === routePath) {
        return {
          ...route,
          matchedPath: cleanPath,
          targetPath: route.target || cleanPath,
          isExact: true
        };
      }

      // 2. Parameterized regex match (/api/courses/:id -> /api/courses/42)
      const regex = this.pathToRegex(routePath);
      if (regex && regex.test(cleanPath)) {
        return {
          ...route,
          matchedPath: cleanPath,
          targetPath: cleanPath, // Target mirrors matched subpath
          isExact: false,
          isParameterized: true
        };
      }

      // 3. Sub-path wildcard match (e.g. /api/*)
      if (routePath.endsWith('/*')) {
        const prefix = routePath.slice(0, -2);
        if (cleanPath.startsWith(prefix)) {
          return {
            ...route,
            matchedPath: cleanPath,
            targetPath: cleanPath,
            isExact: false,
            isWildcard: true
          };
        }
      }
    }

    return null;
  }

  /**
   * Resolves the full target URL by combining target origin, mapped path, and query string.
   * 
   * @param {string} targetOrigin - Base authorized origin (e.g. https://target.example)
   * @param {string} mappedPath - Upstream path (e.g. /api/user)
   * @param {string|object} [query] - Query parameters
   * @returns {string} Full resolved upstream URL
   */
  static resolveTargetUrl(targetOrigin, mappedPath, query = '') {
    const origin = targetOrigin.replace(/\/+$/, '');
    const cleanPath = mappedPath.startsWith('/') ? mappedPath : '/' + mappedPath;
    let url = origin + cleanPath;

    if (query) {
      if (typeof query === 'string') {
        const cleanQuery = query.startsWith('?') ? query.slice(1) : query;
        if (cleanQuery) url += '?' + cleanQuery;
      } else if (typeof query === 'object' && Object.keys(query).length > 0) {
        const qs = new URLSearchParams(query).toString();
        if (qs) url += '?' + qs;
      }
    }

    return url;
  }
}

module.exports = {
  RouteMap
};
