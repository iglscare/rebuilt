/**
 * REBUILT — Communication Bridge: Response Handler
 * 
 * Processes upstream target responses for return to the cloned frontend:
 * 1. Sanitizes headers using BridgeSecurity
 * 2. Formats proper CORS headers for the Rebuilt local origin
 * 3. Normalizes payload (JSON, text, HTML, binary)
 * 4. Protects against excessive response payload sizes
 * 5. Handles upstream redirects safely
 */

const { BridgeSecurity, MAX_RESPONSE_BYTES } = require('./security');

class BridgeResponseHandler {
  /**
   * Normalizes response body buffer according to Content-Type.
   * 
   * @param {Buffer} buffer 
   * @param {string} [contentType=''] 
   * @returns {{ data: any, isBinary: boolean, byteLength: number }}
   */
  static normalizeBody(buffer, contentType = '') {
    if (!buffer || buffer.length === 0) {
      return { data: '', isBinary: false, byteLength: 0 };
    }

    const byteLength = buffer.length;
    if (byteLength > MAX_RESPONSE_BYTES) {
      const err = new Error(`Target response exceeds 20MB limit (${(byteLength / 1024 / 1024).toFixed(1)}MB).`);
      err.code = 'RESPONSE_PAYLOAD_TOO_LARGE';
      throw err;
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

    // Text / HTML / XML / JavaScript
    if (lowerType.includes('text/') || lowerType.includes('application/xml') || lowerType.includes('application/javascript')) {
      return { data: buffer.toString('utf8'), isBinary: false, byteLength };
    }

    // Binary (Images, fonts, media, application/octet-stream)
    return { data: buffer, isBinary: true, byteLength };
  }

  /**
   * Prepares complete response packet for client transmission.
   * 
   * @param {object} params
   * @param {number} params.status - Upstream HTTP status code
   * @param {object|Headers} params.headers - Upstream headers
   * @param {Buffer} params.buffer - Response buffer
   * @param {string} [params.clientOrigin] - Origin of the requesting client
   * @param {number} [params.durationMs=0]
   * @returns {{ status: number, headers: object, data: any, isBinary: boolean, durationMs: number }}
   */
  static processResponse({ status, headers = {}, buffer, clientOrigin = '', durationMs = 0 }) {
    const sanitizedHeaders = BridgeSecurity.sanitizeResponseHeaders(headers, clientOrigin);
    const contentType = sanitizedHeaders['content-type'] || '';
    const { data, isBinary, byteLength } = this.normalizeBody(buffer, contentType);

    return {
      status,
      headers: sanitizedHeaders,
      data,
      isBinary,
      byteLength,
      durationMs
    };
  }
}

module.exports = {
  BridgeResponseHandler
};
