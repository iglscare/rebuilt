/**
 * REBUILT 2.0 — Communication Bridge: Response Normalizer
 * 
 * Sanitizes and normalizes responses from the authorized target server:
 * 1. Preserves safe Content-Type, Content-Length, and caching headers
 * 2. Strips Set-Cookie and sensitive server fingerprinting headers
 * 3. Enforces response payload size limits
 * 4. Adds appropriate localhost CORS headers for seamless local frontend communication
 * 5. Supports JSON, text, HTML fragments, and binary buffers
 */

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024; // 20MB limit

const SAFE_FORWARD_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'etag',
  'last-modified',
  'expires',
  'pragma',
  'date',
  'vary'
]);

class ResponseNormalizer {
  /**
   * Sanitizes upstream headers before returning them to the local frontend.
   *
   * @param {object|Headers} headers
   * @returns {object} Clean headers
   */
  static sanitizeHeaders(headers) {
    const clean = {};
    const entries = typeof headers.entries === 'function'
      ? Array.from(headers.entries())
      : Object.entries(headers);

    for (const [key, value] of entries) {
      const lower = key.toLowerCase();
      // Strips Set-Cookie, server fingerprinting, and security headers that break localhost
      if (lower === 'set-cookie' || lower === 'server' || lower === 'x-powered-by') {
        continue;
      }
      if (lower.startsWith('content-security-policy') || lower === 'x-frame-options') {
        // Drop CSP that would block localhost origin
        continue;
      }
      if (SAFE_FORWARD_RESPONSE_HEADERS.has(lower)) {
        clean[lower] = value;
      }
    }

    // Add permissive CORS headers for the local frontend
    clean['access-control-allow-origin'] = '*';
    clean['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
    clean['access-control-allow-headers'] = '*';
    clean['x-rebuilt-bridge'] = 'active';

    return clean;
  }

  /**
   * Normalizes response body content based on Content-Type.
   *
   * @param {Buffer} buffer
   * @param {string} contentType
   * @returns {{ data: any, isBinary: boolean, byteLength: number }}
   */
  static normalizeBody(buffer, contentType = '') {
    if (!buffer || buffer.length === 0) {
      return { data: '', isBinary: false, byteLength: 0 };
    }

    const byteLength = buffer.length;
    if (byteLength > MAX_RESPONSE_BYTES) {
      throw new Error(`Target response exceeds 20MB limit (${(byteLength / (1024 * 1024)).toFixed(1)}MB).`);
    }

    const lowerType = (contentType || '').toLowerCase();

    // JSON response
    if (lowerType.includes('application/json') || lowerType.includes('+json')) {
      try {
        const text = buffer.toString('utf8');
        return { data: JSON.parse(text), isBinary: false, byteLength };
      } catch (_) {
        return { data: buffer.toString('utf8'), isBinary: false, byteLength };
      }
    }

    // Text / HTML / XML
    if (lowerType.includes('text/') || lowerType.includes('application/xml') || lowerType.includes('application/javascript')) {
      return { data: buffer.toString('utf8'), isBinary: false, byteLength };
    }

    // Binary response (images, fonts, octet-stream, audio, video)
    return { data: buffer, isBinary: true, byteLength };
  }
}

module.exports = {
  ResponseNormalizer,
  MAX_RESPONSE_BYTES,
  SAFE_FORWARD_RESPONSE_HEADERS
};
