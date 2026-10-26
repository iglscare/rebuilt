/**
 * Rebuilt Automated QA — Error Classifier
 * 
 * Classifies raw network failures, HTTP status codes, console errors,
 * page exceptions, and DOM interaction failures into 14 structured error types:
 * 
 * 1.  MISSING_ASSET
 * 2.  MISSING_FONT
 * 3.  BROKEN_CSS
 * 4.  BROKEN_JS
 * 5.  BROKEN_ROUTE
 * 6.  BROKEN_IMAGE
 * 7.  BROKEN_SVG
 * 8.  API_FAILURE
 * 9.  CORS_FAILURE
 * 10. PROXY_FAILURE
 * 11. REDIRECT_FAILURE
 * 12. RUNTIME_EXCEPTION
 * 13. NAVIGATION_FAILURE
 * 14. RESOURCE_TIMEOUT
 */

const ERROR_TYPES = {
  MISSING_ASSET: 'MISSING_ASSET',
  MISSING_FONT: 'MISSING_FONT',
  BROKEN_CSS: 'BROKEN_CSS',
  BROKEN_JS: 'BROKEN_JS',
  BROKEN_ROUTE: 'BROKEN_ROUTE',
  BROKEN_IMAGE: 'BROKEN_IMAGE',
  BROKEN_SVG: 'BROKEN_SVG',
  BROKEN_MEDIA: 'BROKEN_MEDIA',
  UNSUPPORTED_CODEC: 'UNSUPPORTED_CODEC',
  AUTOPLAY_RESTRICTION: 'AUTOPLAY_RESTRICTION',
  EMBED_RESTRICTION: 'EMBED_RESTRICTION',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  EXPIRED_SIGNED_URL: 'EXPIRED_SIGNED_URL',
  API_FAILURE: 'API_FAILURE',
  CORS_FAILURE: 'CORS_FAILURE',
  PROXY_FAILURE: 'PROXY_FAILURE',
  REDIRECT_FAILURE: 'REDIRECT_FAILURE',
  RUNTIME_EXCEPTION: 'RUNTIME_EXCEPTION',
  NAVIGATION_FAILURE: 'NAVIGATION_FAILURE',
  RESOURCE_TIMEOUT: 'RESOURCE_TIMEOUT'
};

/**
 * Determines whether a URL or path represents audio/video media.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isMediaUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const clean = urlStr.split('?')[0].split('#')[0].toLowerCase();
  return /\.(mp4|webm|ogv|mov|m4v|mp3|wav|ogg|aac|flac|m4a|vtt|srt)(\?.*)?$/i.test(clean) ||
         clean.includes('/media/') ||
         clean.includes('/video/') ||
         clean.includes('/audio/');
}

/**
 * Determines whether a URL or path represents a web font.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isFontUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const clean = urlStr.split('?')[0].split('#')[0].toLowerCase();
  return /\.(woff2?|ttf|otf|eot)(\?.*)?$/i.test(clean) ||
         clean.includes('/fonts/') ||
         clean.includes('/font/') ||
         clean.includes('font-face');
}

/**
 * Determines whether a URL or path represents an image.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isImageUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const clean = urlStr.split('?')[0].split('#')[0].toLowerCase();
  return /\.(png|jpe?g|webp|avif|gif|ico|bmp|tiff)$/i.test(clean);
}

/**
 * Determines whether a URL or path represents an SVG asset.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isSvgUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const clean = urlStr.split('?')[0].split('#')[0].toLowerCase();
  return clean.endsWith('.svg') || clean.includes('/svg/');
}

/**
 * Determines whether a URL represents a CSS stylesheet.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isCssUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const clean = urlStr.split('?')[0].split('#')[0].toLowerCase();
  return clean.endsWith('.css') || clean.includes('/css/');
}

/**
 * Determines whether a URL represents a JavaScript script or module.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isJsUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const clean = urlStr.split('?')[0].split('#')[0].toLowerCase();
  return /\.(js|mjs|cjs)(\?.*)?$/i.test(clean) || clean.includes('/js/') || clean.includes('/chunks/');
}

/**
 * Determines whether a URL represents an API, GraphQL, or dynamic data endpoint.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isApiUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const clean = urlStr.toLowerCase();
  return clean.includes('/api/') ||
         clean.includes('/v1/') ||
         clean.includes('/v2/') ||
         clean.includes('/v3/') ||
         clean.includes('/v4/') ||
         clean.includes('/v5/') ||
         clean.includes('/v6/') ||
         clean.includes('graphql') ||
         clean.includes('/shop/mcm/') ||
         clean.includes('product-price') ||
         clean.includes('/pricing') ||
         clean.includes('query=') ||
         clean.includes('/_next/data/');
}

function isTrackerUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return /(?:b\/ss|omni|trkkr|telemetry|analytics|beacon|echo\.png|fxpmdp|mdp\/echo|flockler|webevents|event-collector|metrics|log-event|stats|pixel|doubleclick|google-analytics|googletagmanager|clarity\.ms|segment\.io|sentry\.io|datadoghq|hotjar|mixpanel|amplitude|newrelic|braze|intercom|snowplow|usercentrics)/i.test(urlStr);
}

/**
 * Converts a captured raw event into a structured QA error object.
 * 
 * @param {object} rawEvent
 * @param {string} rawEvent.category - 'requestfailed' | 'http_error' | 'console_error' | 'page_error' | 'interaction_error'
 * @param {string} [rawEvent.url] - URL associated with the event
 * @param {number} [rawEvent.statusCode] - HTTP status code if available
 * @param {string} [rawEvent.errorMessage] - Raw error message
 * @param {string} [rawEvent.page] - Page route where the error occurred
 * @param {string} [rawEvent.selector] - Interactive selector if triggered by user action
 * @param {string} [rawEvent.resourceType] - Playwright resource type ('image', 'font', 'stylesheet', etc.)
 * @param {string} targetOrigin - The original target origin of the cloned website (e.g. 'https://www.apple.com')
 * @returns {object|null} Structured error record
 */
function classifyError(rawEvent, targetOrigin) {
  const {
    category,
    url = '',
    statusCode = null,
    errorMessage = '',
    page = '/',
    selector = null,
    resourceType = 'unknown'
  } = rawEvent;

  const msg = (errorMessage || '').toLowerCase();
  let urlStr = url || '';
  if (!urlStr && errorMessage) {
    const urlMatch = errorMessage.match(/https?:\/\/[^\s'"><)]+/i) || errorMessage.match(/at ['"]([^'"]+)['"]/i);
    if (urlMatch) {
      urlStr = urlMatch[1] || urlMatch[0];
    }
  }
  const urlLower = urlStr.toLowerCase();

  // Filter out third-party telemetry/analytics beacons (non-functional trackers)
  if (isTrackerUrl(urlStr) || (msg.includes('connection_refused') && (msg.includes('/b/ss') || urlLower.includes('/b/ss')))) {
    return null;
  }

  // Filter out normal media stream aborts when buffering or switching sources
  if (msg.includes('err_aborted') && resourceType === 'media') {
    return null;
  }

  // Filter out harmless third-party informational console warnings
  if (category === 'console_error' && (
    msg.includes('turnstile') ||
    msg.includes('devtools') ||
    msg.includes('content-security-policy') ||
    msg.includes('source map') ||
    msg.includes('deprecated')
  )) {
    return null;
  }

  // 1. Identify CORS failures
  const isCors = msg.includes('cors') ||
                 msg.includes('cross-origin') ||
                 msg.includes('access-control-allow-origin') ||
                 msg.includes('denied by cross-origin');

  if (isCors) {
    let effectiveResource = resourceType;
    if (effectiveResource === 'unknown' || !effectiveResource) {
      if (msg.includes('to script at') || isJsUrl(urlLower)) effectiveResource = 'script';
      else if (msg.includes('to stylesheet at') || isCssUrl(urlLower)) effectiveResource = 'stylesheet';
      else if (isFontUrl(urlLower)) effectiveResource = 'font';
      else if (isImageUrl(urlLower)) effectiveResource = 'image';
      else effectiveResource = 'fetch';
    }

    return {
      type: ERROR_TYPES.CORS_FAILURE,
      url: urlStr,
      sourceUrl: urlStr.startsWith('http') ? urlStr : (targetOrigin ? new URL(urlStr, targetOrigin).toString() : urlStr),
      localUrl: urlStr,
      statusCode: statusCode || 0,
      resourceType: effectiveResource,
      page,
      selector,
      errorMessage,
      probableCause: 'Browser blocked cross-origin request from localhost to remote origin. Needs server-side proxying.'
    };
  }

  // 2. Identify Proxy failures
  if (urlLower.includes('/api/proxy') && (statusCode >= 500 || msg.includes('proxy fetch failed'))) {
    return {
      type: ERROR_TYPES.PROXY_FAILURE,
      url: urlStr,
      sourceUrl: urlStr,
      localUrl: urlStr,
      statusCode: statusCode || 500,
      resourceType: resourceType || 'fetch',
      page,
      selector,
      errorMessage,
      probableCause: 'Local proxy server failed to fetch or timed out against the target resource.'
    };
  }

  // 3. Identify Timeouts & Aborts
  if (msg.includes('err_connection_timed_out') || msg.includes('timed out') || msg.includes('resource_timeout')) {
    return {
      type: ERROR_TYPES.RESOURCE_TIMEOUT,
      url: urlStr,
      sourceUrl: urlStr,
      localUrl: urlStr,
      statusCode: statusCode || 504,
      resourceType,
      page,
      selector,
      errorMessage,
      probableCause: 'Resource request exceeded timeout threshold without server response.'
    };
  }

  // 4. Identify Font failures
  if (resourceType === 'font' || isFontUrl(urlLower) || msg.includes('.woff') || msg.includes('.ttf')) {
    return {
      type: ERROR_TYPES.MISSING_FONT,
      url: urlStr,
      sourceUrl: urlStr.startsWith('http') && !urlStr.includes('localhost')
        ? urlStr
        : (targetOrigin ? new URL(urlStr.replace(/^https?:\/\/[^\/]+/, ''), targetOrigin).toString() : urlStr),
      localUrl: urlStr,
      statusCode: statusCode || 404,
      resourceType: 'font',
      page,
      selector,
      errorMessage: errorMessage || `Font resource failed with HTTP ${statusCode || 'unknown'}`,
      probableCause: 'Font file was not cloned locally or CSS path reference was not rewritten correctly.'
    };
  }

  // 5. Identify SVG failures
  if (isSvgUrl(urlLower) || (resourceType === 'image' && urlLower.includes('.svg'))) {
    return {
      type: ERROR_TYPES.BROKEN_SVG,
      url: urlStr,
      sourceUrl: urlStr.startsWith('http') && !urlStr.includes('localhost')
        ? urlStr
        : (targetOrigin ? new URL(urlStr.replace(/^https?:\/\/[^\/]+/, ''), targetOrigin).toString() : urlStr),
      localUrl: urlStr,
      statusCode: statusCode || 404,
      resourceType: 'image',
      page,
      selector,
      errorMessage: errorMessage || `SVG resource failed with HTTP ${statusCode || 'unknown'}`,
      probableCause: 'SVG file or vector symbol reference was not captured or path is unresolved.'
    };
  }

  // 5.5 Identify Autoplay Restrictions
  if (msg.includes('notallowederror') || msg.includes("play() failed because the user didn't interact") || msg.includes('autoplay')) {
    return {
      type: ERROR_TYPES.AUTOPLAY_RESTRICTION,
      url: urlStr,
      sourceUrl: urlStr,
      localUrl: urlStr,
      statusCode: null,
      resourceType: 'media',
      page,
      selector,
      errorMessage: errorMessage || 'Browser autoplay policy prevented unmuted media from playing automatically.',
      probableCause: 'Browser blocked audio playback without user gesture.',
      suggestedFix: 'Mute video or require explicit user click before playback.'
    };
  }

  // 5.6 Identify Embed Restrictions (YouTube, Vimeo, etc.)
  if (urlLower.includes('youtube.com') || urlLower.includes('vimeo.com') || msg.includes('frame-ancestors') || (msg.includes('x-frame-options') && resourceType === 'document')) {
    return {
      type: ERROR_TYPES.EMBED_RESTRICTION,
      url: urlStr,
      sourceUrl: urlStr,
      localUrl: urlStr,
      statusCode: statusCode || 403,
      resourceType: 'embed',
      page,
      selector,
      errorMessage: errorMessage || 'Third-party embed player restricted domain framing.',
      probableCause: 'External provider restricts embedding outside registered domain or iframe sandbox.',
      suggestedFix: 'Preserve authorized iframe embed attributes (allow="autoplay; fullscreen") or view in original player.'
    };
  }

  // 5.7 Identify Media failures (video/audio, codecs, auth, expired URLs)
  if (resourceType === 'media' || isMediaUrl(urlLower)) {
    if (statusCode === 401 || statusCode === 403) {
      return {
        type: ERROR_TYPES.AUTH_REQUIRED,
        url: urlStr,
        sourceUrl: urlStr.startsWith('http') ? urlStr : (targetOrigin ? new URL(urlStr, targetOrigin).toString() : urlStr),
        localUrl: urlStr,
        statusCode,
        resourceType: 'media',
        page,
        selector,
        errorMessage: errorMessage || `Media server rejected request with HTTP ${statusCode}`,
        probableCause: 'Media resource requires authentication or protected session.',
        suggestedFix: 'Provide authorized cookies or credentials to session vault.'
      };
    }

    if (urlLower.includes('signature=') || urlLower.includes('token=') || msg.includes('expired') || statusCode === 410) {
      return {
        type: ERROR_TYPES.EXPIRED_SIGNED_URL,
        url: urlStr,
        sourceUrl: urlStr.startsWith('http') ? urlStr : (targetOrigin ? new URL(urlStr, targetOrigin).toString() : urlStr),
        localUrl: urlStr,
        statusCode: statusCode || 410,
        resourceType: 'media',
        page,
        selector,
        errorMessage: errorMessage || 'Signed media streaming URL has expired.',
        probableCause: 'Upstream CDN signed URL expired after page capture.',
        suggestedFix: 'Re-fetch fresh streaming token via proxy.'
      };
    }

    if (msg.includes('demuxer') || msg.includes('codec') || msg.includes('format') || msg.includes('notsupportederror')) {
      return {
        type: ERROR_TYPES.UNSUPPORTED_CODEC,
        url: urlStr,
        sourceUrl: urlStr.startsWith('http') ? urlStr : (targetOrigin ? new URL(urlStr, targetOrigin).toString() : urlStr),
        localUrl: urlStr,
        statusCode: statusCode || 0,
        resourceType: 'media',
        page,
        selector,
        errorMessage: errorMessage || 'Video/audio codec or container format unsupported by browser.',
        probableCause: 'Browser does not natively support the encoded video/audio format.',
        suggestedFix: 'Provide fallback source in MP4 (H.264/AAC) or WebM format.'
      };
    }

    return {
      type: ERROR_TYPES.BROKEN_MEDIA,
      url: urlStr,
      sourceUrl: urlStr.startsWith('http') ? urlStr : (targetOrigin ? new URL(urlStr, targetOrigin).toString() : urlStr),
      localUrl: urlStr,
      statusCode: statusCode || 404,
      resourceType: 'media',
      page,
      selector,
      errorMessage: errorMessage || `Media resource failed with HTTP ${statusCode || 'unknown'}`,
      probableCause: 'Media file was not mirrored locally and upstream stream failed.',
      suggestedFix: 'Ensure media proxy Range request streaming is active.'
    };
  }

  // 6. Identify Image failures
  if (resourceType === 'image' || isImageUrl(urlLower)) {
    return {
      type: ERROR_TYPES.BROKEN_IMAGE,
      url: urlStr,
      sourceUrl: urlStr.startsWith('http') && !urlStr.includes('localhost')
        ? urlStr
        : (targetOrigin ? new URL(urlStr.replace(/^https?:\/\/[^\/]+/, ''), targetOrigin).toString() : urlStr),
      localUrl: urlStr,
      statusCode: statusCode || 404,
      resourceType: 'image',
      page,
      selector,
      errorMessage: errorMessage || `Image resource failed with HTTP ${statusCode || 'unknown'}`,
      probableCause: 'Image asset was not downloaded or srcset attribute contains invalid relative links.'
    };
  }

  // 7. Identify CSS failures
  if (resourceType === 'stylesheet' || isCssUrl(urlLower)) {
    return {
      type: ERROR_TYPES.BROKEN_CSS,
      url: urlStr,
      sourceUrl: urlStr.startsWith('http') && !urlStr.includes('localhost')
        ? urlStr
        : (targetOrigin ? new URL(urlStr.replace(/^https?:\/\/[^\/]+/, ''), targetOrigin).toString() : urlStr),
      localUrl: urlStr,
      statusCode: statusCode || 404,
      resourceType: 'stylesheet',
      page,
      selector,
      errorMessage: errorMessage || `Stylesheet failed to load with HTTP ${statusCode || 'unknown'}`,
      probableCause: 'CSS file missing from assets/css/ or link rel="stylesheet" path is broken.'
    };
  }

  // 8. Identify JS failures
  if (resourceType === 'script' || isJsUrl(urlLower)) {
    return {
      type: ERROR_TYPES.BROKEN_JS,
      url: urlStr,
      sourceUrl: urlStr.startsWith('http') && !urlStr.includes('localhost')
        ? urlStr
        : (targetOrigin ? new URL(urlStr.replace(/^https?:\/\/[^\/]+/, ''), targetOrigin).toString() : urlStr),
      localUrl: urlStr,
      statusCode: statusCode || 404,
      resourceType: 'script',
      page,
      selector,
      errorMessage: errorMessage || `Script file failed to load with HTTP ${statusCode || 'unknown'}`,
      probableCause: 'JavaScript chunk or module missing from assets/js/.'
    };
  }

  // 9. Identify API / XHR / Fetch failures
  if (['fetch', 'xhr'].includes(resourceType) || isApiUrl(urlLower)) {
    return {
      type: ERROR_TYPES.API_FAILURE,
      url: urlStr,
      sourceUrl: urlStr.startsWith('http') && !urlStr.includes('localhost')
        ? urlStr
        : (targetOrigin ? new URL(urlStr.replace(/^https?:\/\/[^\/]+/, ''), targetOrigin).toString() : urlStr),
      localUrl: urlStr,
      statusCode: statusCode || 500,
      resourceType: resourceType || 'fetch',
      page,
      selector,
      errorMessage: errorMessage || `API request failed with HTTP ${statusCode || 'unknown'}`,
      probableCause: 'Dynamic API endpoint returned error or needs server proxy routing.'
    };
  }

  // 10. Identify Navigation / Route failures
  if (category === 'navigation_error' || (resourceType === 'document' && statusCode >= 400)) {
    // Distinguish between localhost navigation timeouts (on-demand rendering delay — not fixable by repair engine)
    // vs actual HTTP 404/403 route failures on the target origin
    const isLocalhostUrl = urlStr.includes('localhost') || urlStr.includes('127.0.0.1');
    const isTimeout = msg.includes('timeout') || msg.includes('timed out') || msg.includes('navigation');

    if (isLocalhostUrl && isTimeout) {
      // On-demand subpage rendering timeout — classify as NAVIGATION_FAILURE (informational, no self-repair)
      return {
        type: ERROR_TYPES.NAVIGATION_FAILURE,
        url: urlStr,
        sourceUrl: urlStr,
        localUrl: urlStr,
        statusCode: 504,
        resourceType: 'document',
        page,
        selector,
        errorMessage: errorMessage || 'On-demand subpage rendering timed out. Page may still render on retry.',
        probableCause: 'Playwright rendering of on-demand subpage exceeded timeout budget. Not a permanent failure.'
      };
    }

    return {
      type: ERROR_TYPES.BROKEN_ROUTE,
      url: urlStr,
      sourceUrl: urlStr.startsWith('http') && !urlStr.includes('localhost')
        ? urlStr
        : (targetOrigin ? new URL(urlStr.replace(/^https?:\/\/[^\/]+/, ''), targetOrigin).toString() : urlStr),
      localUrl: urlStr,
      statusCode: statusCode || 404,
      resourceType: 'document',
      page,
      selector,
      errorMessage: errorMessage || `Route returned HTTP ${statusCode || 404}`,
      probableCause: 'Internal subpage was not cloned during crawl or cross-page link is broken.'
    };
  }

  // 11. Identify Unhandled Runtime Exceptions
  if (category === 'page_error' || (category === 'console_error' && !urlStr)) {
    return {
      type: ERROR_TYPES.RUNTIME_EXCEPTION,
      url: urlStr || page,
      sourceUrl: page,
      localUrl: page,
      statusCode: null,
      resourceType: 'runtime',
      page,
      selector,
      errorMessage: errorMessage || 'Unhandled JavaScript runtime exception thrown on page.',
      probableCause: 'Client-side script crashed due to undefined variable, hydration failure, or missing DOM element.'
    };
  }

  // 12. Generic Missing Asset fallback
  if (statusCode >= 400 || category === 'requestfailed') {
    return {
      type: ERROR_TYPES.MISSING_ASSET,
      url: urlStr,
      sourceUrl: urlStr.startsWith('http') && !urlStr.includes('localhost')
        ? urlStr
        : (targetOrigin ? new URL(urlStr.replace(/^https?:\/\/[^\/]+/, ''), targetOrigin).toString() : urlStr),
      localUrl: urlStr,
      statusCode: statusCode || 404,
      resourceType,
      page,
      selector,
      errorMessage: errorMessage || `Asset failed with status ${statusCode || 'failed'}`,
      probableCause: 'Subresource failed to load from local storage or remote fallback.'
    };
  }

  return null;
}

/**
 * Deduplicates and aggregates classified errors.
 * @param {Array<object>} errorList
 * @returns {Array<object>} Deduplicated error objects with occurrence counts
 */
function aggregateErrors(errorList) {
  const map = new Map();

  for (const err of errorList) {
    if (!err) continue;
    // Key by error type + cleaned URL or message
    const key = `${err.type}:${(err.url || err.errorMessage).split('?')[0]}`;
    if (!map.has(key)) {
      map.set(key, { ...err, count: 1 });
    } else {
      map.get(key).count++;
    }
  }

  return Array.from(map.values());
}

module.exports = {
  ERROR_TYPES,
  classifyError,
  aggregateErrors,
  isMediaUrl,
  isFontUrl,
  isImageUrl,
  isSvgUrl,
  isCssUrl,
  isJsUrl,
  isApiUrl
};
