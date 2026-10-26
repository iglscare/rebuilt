/**
 * HTML Rewriter & Environment Shield for Rebuilt Web Cloner
 * Ensures captured DOM pages render faithfully with real styles, images, and fonts,
 * and prevents SPA hydration crashes across all websites.
 */

function cleanUrlQuotes(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/^(&quot;|&#34;|&apos;|&#39;|["'\\])+/g, '')
    .replace(/(&quot;|&#34;|&apos;|&#39;|["'\\])+$/g, '')
    .trim();
}

function toAbsolute(urlStr, baseUrl) {
  if (!urlStr || typeof urlStr !== 'string') return urlStr;
  const cleaned = cleanUrlQuotes(urlStr);
  if (
    !cleaned ||
    cleaned.startsWith('data:') ||
    cleaned.startsWith('blob:') ||
    cleaned.startsWith('javascript:') ||
    cleaned.startsWith('#') ||
    cleaned.startsWith('mailto:') ||
    cleaned.startsWith('tel:')
  ) {
    return cleaned || urlStr;
  }
  try {
    return new URL(cleaned, baseUrl).toString();
  } catch (e) {
    return cleaned || urlStr;
  }
}

/**
 * Accurately parses a srcset attribute into individual candidate objects.
 * Handles commas that appear inside URLs (e.g. Amazon dynamic imaging CDN URLs)
 * without corrupting filenames.
 *
 * @param {string} srcset
 * @returns {Array<{ raw: string, url: string, descriptor: string }>}
 */
function splitSrcsetCandidates(srcset) {
  if (!srcset || typeof srcset !== 'string') return [];
  const candidates = [];
  const regex = /\s*([^\s,]+(?:,[^\s,]+)*)(?:\s+([\d.]+[wx]))?\s*(?:,|$)/g;
  let match;
  while ((match = regex.exec(srcset)) !== null) {
    if (match[1]) {
      candidates.push({
        raw: match[0],
        url: match[1],
        descriptor: match[2] ? ` ${match[2]}` : ''
      });
    }
  }
  return candidates;
}

/**
 * Rewrites URLs in a srcset attribute string to absolute URLs using baseUrl
 * @param {string} srcset
 * @param {string} baseUrl
 * @returns {string}
 */
function rewriteSrcsetString(srcset, baseUrl) {
  const candidates = splitSrcsetCandidates(srcset);
  if (!candidates.length) return srcset;
  return candidates.map(c => `${toAbsolute(c.url, baseUrl)}${c.descriptor}`).join(', ');
}

/**
 * Resolves @import rules and url(...) paths in CSS text to absolute URLs.
 * @param {string} css
 * @param {string} cssUrl - Base URL of the stylesheet
 * @returns {string}
 */
function rewriteCssUrlsAndImports(css, cssUrl) {
  if (!css || typeof css !== 'string') return css;
  let rewritten = css;
  // Rewrite @import url(...) and @import '...'
  rewritten = rewritten.replace(/@import\s+(?:url\(\s*['"]?([^"')]+)['"]?\s*\)|['"]([^'"]+)['"])([^;]*);/gi, (match, u1, u2, media) => {
    const raw = cleanUrlQuotes(u1 || u2);
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return match;
    const abs = toAbsolute(raw, cssUrl);
    const mediaPart = media ? ` ${media.trim()}` : '';
    return `@import url("${abs}")${mediaPart};`;
  });
  // Rewrite url(...)
  rewritten = rewritten.replace(/\burl\(\s*(?:&quot;|&#34;|&apos;|&#39;|["'\\])?([^"'\)\s&]+?)(?:&quot;|&#34;|&apos;|&#39;|["'\\])?\s*\)/gi, (m, u) => {
    if (!u || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#')) return m;
    return `url("${toAbsolute(u, cssUrl)}")`;
  });
  return rewritten;
}

/**
 * Universal browser shield script injected into the head of cloned pages.
 * Prevents SPA frameworks (React, Next.js, Vue, Vite) from crashing on localhost.
 */
const REBUILT_SHIELD_SCRIPT = `
  <!-- Rebuilt Universal Preview Shield & Interaction Engine -->
  <style id="rebuilt-inline-media-styles">
    /* Ensure inline media start-frame and fallback pictures remain visible when videos are not playing */
    .inline-media-wrapper .start-frame,
    .inline-media-wrapper picture,
    picture.start-frame,
    .picture-startframe {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .inline-media-wrapper .start-frame img,
    picture.start-frame img,
    .picture-startframe img {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
    }
    /* Ensure scroll-reveal and animated components are fully visible */
    [data-aos],
    .aos-init,
    .wow,
    .reveal,
    .animate-box,
    .fade-in-element {
      opacity: 1 !important;
      visibility: visible !important;
      transform: none !important;
    }
    .lazyload, .lazyloading {
      opacity: 1 !important;
      visibility: visible !important;
    }

    /* Hardware GPU Acceleration & Compositing Pipeline (60/120fps live rendering) */
    video,
    canvas,
    .inline-media-wrapper,
    [data-gpu-accelerated="true"] {
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      perspective: 1000px;
      -webkit-perspective: 1000px;
      will-change: transform, opacity;
    }

    /* Un-hijack smooth scroll containers (Locomotive, Lenis, GSAP ScrollSmoother) & restore touch/scroll actions */
    html, body {
      overflow-x: hidden !important;
      overflow-y: auto !important;
      height: auto !important;
      touch-action: auto !important;
      overscroll-behavior: auto !important;
    }
    #smooth-wrapper,
    #smooth-content,
    [data-scroll-container],
    .locomotive-scroll {
      transform: none !important;
      overflow: visible !important;
      height: auto !important;
      position: static !important;
    }

    /* Ensure Tailwind, SvelteKit & GSAP scroll-reveal and staged elements remain fully visible and unblurred */
    .opacity-0.blur-2xl,
    .opacity-0.blur-xl,
    .opacity-0.blur-lg,
    .opacity-0.blur-md,
    .opacity-0.blur,
    [class*="opacity-0"][class*="blur-"],
    main > div.opacity-0,
    main > div[class*="opacity-0"],
    section.opacity-0,
    [data-scroll].opacity-0,
    .transition-all.opacity-0.blur-2xl,
    .transition-all.opacity-0 {
      opacity: 1 !important;
      filter: none !important;
      visibility: visible !important;
    }

    /* Ensure text split elements (GSAP SplitText, Splitting.js) and reveal cards stay visible */
    [data-splitting] .char,
    [data-splitting] .word,
    .split-lines,
    .split-line,
    .split-char,
    .has-split-lines .split-line,
    [data-prevent-flicker],
    .is-inview {
      opacity: 1 !important;
      transform: none !important;
      visibility: visible !important;
    }

    /* Preserve rendered canvas snapshots */
    canvas[data-rebuilt-canvas] {
      display: inline-block !important;
      visibility: visible !important;
      opacity: 1 !important;
    }

    /* Permanent suppression of preloaders, curtain transitions, splash overlays and spinners */
    #preloader, #preloader2, .preloader, .loader-wrap, .page-loader, .site-preloader,
    #loading-screen, [data-preloader], .curtain, .page-transition, [data-transition-overlay],
    .loader-bg, .splash-screen, .loading-overlay, .pace, #ctn-preloader, .spinner-wrapper,
    .initial-loader, .loading-mask, #app-loader {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    /* Permanent suppression of cookie popups, age gates, backdrop overlays, and blocking remote auth iframes */
    #hyv-account-frame,
    [id*="hyv-account"],
    iframe[src*="login-platform"],
    .hyv-login-platform__loading,
    .mhy-interest-selector,
    .mhy-dialog.mhy-interest-selector,
    .mhy-dialog__wrp,
    #onetrust-consent-sdk,
    .onetrust-pc-dark-filter,
    #CybotCookiebotDialog,
    #usercentrics-root,
    [id*="usercentrics"],
    .uc-banner,
    #uc-banner,
    .uc-overlay,
    .cookie-banner,
    .cookie-notice,
    .cc-window,
    .qc-cmp2-container {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    /* Permanent suppression of location modals, country selector ribbons, and shipping alerts */
    .glow-toaster,
    #glow-toaster-body,
    .glow-toaster-content,
    [data-toaster-type],
    #nav-global-location-toaster,
    .nav-coreFlyout.glow-toaster,
    [role="alertdialog"].nav-flyout,
    #nav-main .nav-flyout[role="alertdialog"],
    .nav-toaster,
    .ac-ls-dropdown-scrim,
    .ac-ls-scrim,
    #ac-ls-dropdown-scrim {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    /* Universal Mega-Menu, Flyout & Navbar Styling for Cloned Previews */
    @media (min-width: 834px) {
      #globalnav {
        height: 44px !important;
        position: relative !important;
        width: 100% !important;
        z-index: 9999 !important;
      }
      #globalnav .globalnav-content {
        max-width: 1024px !important;
        margin: 0 auto !important;
        height: 100% !important;
      }
      #globalnav .globalnav-list {
        display: flex !important;
        flex-direction: row !important;
        justify-content: space-between !important;
        align-items: center !important;
        height: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
        gap: 0 !important;
      }
      /* CRITICAL: Keep desktop wrappers display: contents to preserve horizontal row */
      #globalnav .globalnav-menu,
      #globalnav .globalnav-menu > .globalnav-flyout,
      #globalnav .globalnav-menu-list {
        display: contents !important;
        background: transparent !important;
        box-shadow: none !important;
        border: none !important;
        height: auto !important;
        min-height: 0 !important;
      }
      #globalnav .globalnav-item {
        display: flex !important;
        align-items: center !important;
        height: 100% !important;
        position: static !important;
      }
      #globalnav .globalnav-link {
        display: flex !important;
        align-items: center !important;
        height: 44px !important;
        padding: 0 8px !important;
        font-size: 12px !important;
        color: #f5f5f7 !important;
        opacity: 0.8 !important;
        transition: opacity 0.2s ease !important;
      }
      #globalnav .globalnav-link:hover {
        opacity: 1 !important;
      }
      /* Desktop Flyouts apply ONLY to submenus (.globalnav-submenu) */
      #globalnav .globalnav-submenu {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        position: absolute !important;
        top: 44px !important;
        margin-top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        min-height: 380px !important;
        background: rgba(22, 22, 23, 0.98) !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5) !important;
        z-index: 99999 !important;
        transition: opacity 0.2s ease, visibility 0.2s ease !important;
      }
      #globalnav .globalnav-item-submenu.globalnav-item-flyout-open > .globalnav-submenu,
      #globalnav .globalnav-item-submenu:hover > .globalnav-submenu,
      #globalnav .globalnav-submenu.show {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      #globalnav .globalnav-item-submenu.globalnav-item-flyout-open .globalnav-flyout-scroll-container,
      #globalnav .globalnav-item-submenu:hover .globalnav-flyout-scroll-container,
      #globalnav .globalnav-submenu.show .globalnav-flyout-scroll-container,
      #globalnav .globalnav-item-submenu.globalnav-item-flyout-open .globalnav-submenu-content,
      #globalnav .globalnav-item-submenu:hover .globalnav-submenu-content,
      #globalnav .globalnav-submenu.show .globalnav-submenu-content {
        visibility: visible !important;
        opacity: 1 !important;
        display: flex !important;
      }
      #globalnav .globalnav-submenu .globalnav-flyout-content {
        max-width: 1024px !important;
        margin: 0 auto !important;
        padding: 40px 24px 60px !important;
        display: flex !important;
        flex-direction: row !important;
        gap: 48px !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      #globalnav .globalnav-submenu .globalnav-submenu-group {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      #globalnav .globalnav-submenu .globalnav-submenu-link {
        display: block !important;
        color: #e8e8ed !important;
        opacity: 0.88 !important;
        visibility: visible !important;
      }
      #globalnav .globalnav-submenu .globalnav-submenu-link:hover {
        opacity: 1 !important;
        color: #ffffff !important;
      }
      #globalnav .globalnav-menutrigger-button,
      #globalnav .globalnav-menuback,
      #globalnav .globalnav-menuback-button {
        display: none !important;
      }
    }

    /* Mobile Hamburger Navigation Menu for Apple and modern navbars (max-width: 833px only) */
    @media (max-width: 833px) {
      #globalnav.globalnav-with-menu-open {
        height: 100vh !important;
        background: rgba(0, 0, 0, 0.96) !important;
        overflow-y: auto !important;
        z-index: 999999 !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
      }
      #globalnav.globalnav-with-menu-open .globalnav-menu {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      #globalnav.globalnav-with-menu-open .globalnav-menu-list,
      #globalnav.globalnav-with-menu-open .globalnav-list {
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
        padding: 60px 24px 40px !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      #globalnav.globalnav-with-menu-open .globalnav-item {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      #globalnav.globalnav-with-menu-open .globalnav-link {
        font-size: 22px !important;
        line-height: 1.4 !important;
        opacity: 1 !important;
        visibility: visible !important;
        color: #f5f5f7 !important;
      }
      #globalnav.globalnav-with-submenu-open .globalnav-menuback {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
    }

    /* Footer Directory Accordion Styling for Mobile & Responsive Viewports */
    .ac-gf-directory-column-section.expanded .ac-gf-directory-column-section-list,
    .ac-gf-directory-column-section-expanded .ac-gf-directory-column-section-list,
    .ac-gf-directory-column-section.expanded ul,
    .ac-gf-directory-column-section-expanded ul {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      height: auto !important;
      max-height: 600px !important;
    }
    .ac-gf-directory-column-section.expanded .ac-gf-directory-column-section-title-button::after,
    .ac-gf-directory-column-section-expanded .ac-gf-directory-column-section-title-button::after {
      transform: rotate(45deg) !important;
    }

    /* Generic Dropdowns & Menus */
    .dropdown.show > .dropdown-menu,
    .dropdown.open > .dropdown-menu,
    [aria-expanded="true"] + .dropdown-menu,
    .nav-item.dropdown.show .dropdown-menu {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
    }

    /* Generic Collapses & Accordions */
    .collapse.show,
    .collapsing.show,
    .accordion-collapse.show {
      display: block !important;
      visibility: visible !important;
      height: auto !important;
    }

    /* Tabs */
    .tab-pane.active,
    .tab-content > .active,
    [role="tabpanel"].active {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
    }

    /* Carousel Slides Transitions */
    .media-gallery-item.current,
    .carousel-item.active,
    .slide.active {
      display: block !important;
      opacity: 1 !important;
      visibility: visible !important;
    }

    /* Universal In-Clone Auth & Member State Styles */
    .rebuilt-authenticated-avatar {
      position: relative !important;
      cursor: pointer !important;
      transition: transform 0.2s ease, box-shadow 0.2s ease !important;
    }
    .rebuilt-authenticated-avatar:hover {
      transform: scale(1.05) !important;
    }
    .rebuilt-authenticated-avatar img {
      border-radius: 50% !important;
      box-shadow: 0 0 0 2px #f59e0b, 0 0 10px rgba(245, 158, 11, 0.5) !important;
    }
    .rebuilt-level-badge {
      position: absolute !important;
      bottom: -2px !important;
      right: -4px !important;
      background: linear-gradient(135deg, #f59e0b, #d97706) !important;
      color: #fff !important;
      font-size: 10px !important;
      font-weight: 800 !important;
      padding: 1px 5px !important;
      border-radius: 999px !important;
      border: 1.5px solid #181c2f !important;
      line-height: 1.2 !important;
      z-index: 10 !important;
      box-shadow: 0 2px 4px rgba(0,0,0,0.5) !important;
      pointer-events: none !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }
    .rebuilt-badge-count {
      position: absolute !important;
      top: -3px !important;
      right: -3px !important;
      background: #ef4444 !important;
      color: #fff !important;
      font-size: 10px !important;
      font-weight: 700 !important;
      min-width: 16px !important;
      height: 16px !important;
      padding: 0 3px !important;
      border-radius: 999px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border: 1.5px solid #181c2f !important;
      z-index: 10 !important;
      pointer-events: none !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    /* Rebuilt Top Navigation & Clone Progress Bar */
    #rebuilt-top-loader {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      height: 3px !important;
      width: 0% !important;
      background: linear-gradient(90deg, #3b82f6, #60a5fa, #38bdf8) !important;
      box-shadow: 0 0 10px rgba(59, 130, 246, 0.7), 0 0 5px rgba(56, 189, 248, 0.5) !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      transition: width 0.35s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.3s ease !important;
      opacity: 0;
    }
    #rebuilt-top-loader.loading {
      opacity: 1 !important;
    }
    .rebuilt-button-pressed {
      transform: scale(0.96) !important;
      transition: transform 0.12s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }


    /* Universal Responsive Navbars & Drawers */
    .navbar-collapse.show,
    .navbar-collapse.open,
    .navbar-collapse.is-active,
    .nav-menu.open,
    .mobile-nav.open,
    .mobile-menu.open,
    [data-rebuilt-expanded="true"] {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      max-height: 85vh !important;
      overflow-y: auto !important;
      pointer-events: auto !important;
    }
    .dropdown.show .dropdown-menu,
    .dropdown.open .dropdown-menu,
    .dropdown-menu.show,
    .dropdown-menu.is-active {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .tab-pane.active,
    .tab-content > .active {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .accordion-collapse.show,
    .accordion-collapse.open,
    .accordion-item.active .accordion-collapse {
      display: block !important;
      height: auto !important;
      visibility: visible !important;
    }
  </style>
  <script id="rebuilt-preview-shield">
  (function() {
    // 0. Mock third-party tracking/analytics globals to prevent undefined errors in preview
    window.et_config = window.et_config || {};
    window.et_eC_state = window.et_eC_state || {};
    window.turnstile = window.turnstile || { render: function() { return 'mock-preview-token'; }, reset: function() {}, getResponse: function() { return 'mock-preview-token'; } };
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function() {};
    window.ga = window.ga || function() {};

    // 1. Intercept history.replaceState and history.pushState against cross-origin SecurityErrors & keep SPAs in clone
    const origReplace = window.history.replaceState ? window.history.replaceState.bind(window.history) : null;
    const origPush = window.history.pushState ? window.history.pushState.bind(window.history) : null;

    function sanitizeHistoryUrl(url) {
      if (!url || typeof url !== 'string') return url;
      const cloneId = window.__REBUILT_CLONE_ID__ || (function() {
        const m = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
        return m ? m[1] : null;
      })();
      if (!cloneId) return url;

      // If SPA router is attempting to navigate to 404, block it and stay in clone
      if (url === '/404' || url === '404' || url.includes('/404')) {
        return window.location.pathname + window.location.search;
      }

      try {
        const parsed = new URL(url, window.location.href);
        if (parsed.origin !== window.location.origin) {
          return window.location.pathname + window.location.search;
        }
        if (!parsed.pathname.startsWith('/clones/' + cloneId)) {
          let sub = parsed.pathname.replace(new RegExp('^/clones(?:/[^/]+)?/?'), '');
          if (sub.startsWith('/')) sub = sub.slice(1);
          return '/clones/' + cloneId + '/' + sub + parsed.search + parsed.hash;
        }
        return url;
      } catch (_) {
        return url;
      }
    }

    if (origReplace) {
      window.history.replaceState = function(state, unused, url) {
        try {
          return origReplace(state, unused, sanitizeHistoryUrl(url));
        } catch(e) {
          // Silently suppress SecurityError on cross-origin URL replacement
        }
      };
    }

    if (origPush) {
      window.history.pushState = function(state, unused, url) {
        try {
          return origPush(state, unused, sanitizeHistoryUrl(url));
        } catch(e) {
          // Silently suppress SecurityError
        }
      };
    }

    // 2. Prevent ServiceWorker registration on localhost to isolate preview environments
    if (window.navigator && window.navigator.serviceWorker) {
      window.navigator.serviceWorker.register = function() {
        return Promise.reject(new Error('[Rebuilt] ServiceWorker registration disabled in preview.'));
      };
    }

    // 3. Prevent unhandled promise rejections or framework hydration errors from blanking the page
    window.addEventListener('error', function(e) {
      if (e && e.message && (
        e.message.includes('replaceState') ||
        e.message.includes('SecurityError') ||
        e.message.includes('ResizeObserver') ||
        e.message.includes('Hydration') ||
        e.message.includes('hydration') ||
        e.message.includes('Minified React error') ||
        e.message.includes('ChunkLoadError') ||
        e.message.includes('Loading chunk') ||
        e.message.includes('Failed to load module script') ||
        e.message.includes('Failed to execute')
      )) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    window.addEventListener('unhandledrejection', function(e) {
      if (e && e.reason && (e.reason.name === 'SecurityError' || String(e.reason).includes('replaceState'))) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // 4. Safe storage polyfill if blocked by security policies
    try {
      const testKey = '__rebuilt_test__';
      window.localStorage.setItem(testKey, testKey);
      window.localStorage.removeItem(testKey);
    } catch(e) {
      const memStore = {};
      try {
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (k) => memStore[k] || null,
            setItem: (k, v) => { memStore[k] = String(v); },
            removeItem: (k) => { delete memStore[k]; },
            clear: () => { Object.keys(memStore).forEach(k => delete memStore[k]); }
          },
          configurable: true,
          writable: true
        });
      } catch(_) {}
    }

    // 4b. In-Clone User Authentication & Session API Simulator + Telemetry/Tracker Shield
    (function setupAuthAndUserInterceptor() {
      const authEndpointsRegex = new RegExp('(?:user/full|user/info|user/game|painter/wapi|community/|apihub/wapi|device-fp|getExtList|/api/v\\\\d+/users?|/auth/|/account/|/session|login/status|getAuditData|bbs-api-os|hoyoverse\\\\.com|staticResource|hyl_resource)', 'i');
      const trackerRegex = new RegExp('(?:trkkr|tracking|telemetry|analytics|beacon|webevents|event-collector|metrics|log-event|stats|pixel|doubleclick|google-analytics|googletagmanager|clarity\\\\.ms|segment\\\\.io|sentry\\\\.io|datadoghq|hotjar|mixpanel|amplitude|newrelic|braze|intercom|snowplow|usercentrics|b/ss|omni|adobe-analytics|adobedc|demdex|falco|logging_client_events|browser_reporting|ajax/bz|graphql/log|data/manifest)', 'i');

      const mockPayload = {
        retcode: 0,
        message: "OK",
        code: 0,
        data: {
          is_login: true,
          user_info: {
            uid: "108492041",
            nickname: "Rebuilt Member",
            avatar_url: "https://www.hoyolab.com/_static/img/default_avatar.25aeebf.png",
            introduce: "Exploring cloned virtual worlds in Rebuilt.",
            gender: 1,
            level: 8,
            points: 1280
          },
          notification: { unread_count: 2 },
          checkin: { is_checkin: false },
          list: [],
          total: 0
        }
      };

      // 1. Hook window.fetch
      if (typeof window.fetch === 'function') {
        const origFetch = window.fetch;
        window.fetch = function(input, init) {
          const urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
          const isApiEndpoint = authEndpointsRegex.test(urlStr) || (typeof urlStr === 'string' && (urlStr.includes('/api/') || urlStr.includes('/_next/data/') || urlStr.includes('graphql') || urlStr.includes('/shop/mcm/')));

          // Intercept telemetry & trackers immediately to prevent cross-origin 308/CORS errors
          if (trackerRegex.test(urlStr)) {
            return Promise.resolve(new Response(JSON.stringify({ status: 200, success: true, message: 'Tracked in preview' }), {
              status: 200,
              statusText: 'OK',
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              }
            }));
          }

          // REBUILT 2.0: Route dynamic API calls through Communication Bridge
          const originalOrigin = window.__REBUILT_ORIGINAL_ORIGIN__ || (window.__REBUILT_ORIGINAL_URL__ ? (function(){ try { return new URL(window.__REBUILT_ORIGINAL_URL__).origin; } catch(_) { return ''; } })() : '');
          const currentCloneId = window.__REBUILT_CLONE_ID__ || (function(){
            const m = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
            return m ? m[1] : '';
          })();

          const isInternalRebuilt = typeof urlStr === 'string' && (
            urlStr.startsWith('/api/auth') ||
            urlStr.startsWith('/api/bridge') ||
            urlStr.startsWith('/api/web-cloner') ||
            urlStr.startsWith('/api/local') ||
            urlStr.startsWith('/api/proxy')
          );
          if (isInternalRebuilt) {
            return origFetch.apply(this, arguments);
          }

          let bridgePath = null;
          let proxyUrl = null;
          if (typeof urlStr === 'string' && currentCloneId) {
            if (originalOrigin && urlStr.startsWith(originalOrigin)) {
              bridgePath = urlStr.slice(originalOrigin.length);
            } else if (urlStr.startsWith(window.location.origin)) {
              const rel = urlStr.slice(window.location.origin.length);
              if (rel.startsWith('/clones/' + currentCloneId + '/assets/')) {
                // Local static asset: do NOT bridge, fetch directly from local server
                bridgePath = null;
              } else if (rel.startsWith('/clones/' + currentCloneId + '/')) {
                bridgePath = rel.slice(('/clones/' + currentCloneId).length);
              } else if (rel.startsWith('/api/') || isApiEndpoint) {
                bridgePath = rel;
              }
            } else if (urlStr.startsWith('/') && (isApiEndpoint || urlStr.startsWith('/api/'))) {
              bridgePath = urlStr;
            } else if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
              try {
                const parsed = new URL(urlStr);
                if (parsed.origin !== window.location.origin && (!originalOrigin || parsed.origin !== originalOrigin)) {
                  proxyUrl = '/api/proxy?url=' + encodeURIComponent(urlStr);
                }
              } catch (_) {}
            }

            // Guard: Never route static assets (css, js, media, fonts, images) through API bridge
            if (bridgePath && (bridgePath.startsWith('/assets/') || bridgePath.includes('/assets/media/') || /\\.(css|js|png|jpe?g|webp|avif|gif|svg|mp4|webm|mov|m4v|mp3|woff2?)(\\?.*)?$/i.test(bridgePath))) {
              bridgePath = null;
            }
          }

          const isAuthCandidate = authEndpointsRegex.test(urlStr) || /login|auth|session|account|checkpoint|challenge|token/i.test(urlStr) || (init && init.method && init.method.toUpperCase() === 'POST');
          const reqId = isAuthCandidate ? ('req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)) : null;
          const reqMethod = (init && init.method ? init.method : 'GET').toUpperCase();
          const startTime = Date.now();

          if (isAuthCandidate && window.__REBUILT_AUTH_OBSERVER__) {
            window.__REBUILT_AUTH_OBSERVER__.emit('REQUEST_STARTED', {
              requestId: reqId,
              method: reqMethod,
              url: urlStr,
              resourceType: 'fetch',
              startTime: startTime
            });
          }

          let fetchPromise;
          if (bridgePath && currentCloneId && !trackerRegex.test(urlStr)) {
            if (!bridgePath.startsWith('/')) bridgePath = '/' + bridgePath;
            const bridgedEndpoint = '/api/bridge/clone/' + encodeURIComponent(currentCloneId) + bridgePath;
            fetchPromise = origFetch.call(this, bridgedEndpoint, init);
          } else if (proxyUrl && !trackerRegex.test(urlStr)) {
            fetchPromise = origFetch.call(this, proxyUrl, init);
          } else {
            fetchPromise = origFetch.apply(this, arguments);
          }

          if (isAuthCandidate) {
            return fetchPromise.then(function(res) {
              if (window.__REBUILT_AUTH_OBSERVER__) {
                window.__REBUILT_AUTH_OBSERVER__.emit('RESPONSE', {
                  requestId: reqId,
                  method: reqMethod,
                  url: urlStr,
                  status: res.status,
                  statusText: res.statusText,
                  duration: Date.now() - startTime,
                  contentType: res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : ''
                });
              }
              return res;
            }).catch(function(err) {
              if (window.__REBUILT_AUTH_OBSERVER__) {
                window.__REBUILT_AUTH_OBSERVER__.emit('NETWORK_ERROR', {
                  requestId: reqId,
                  method: reqMethod,
                  url: urlStr,
                  errorType: 'NETWORK_FAILURE',
                  message: err && err.message ? err.message : 'Network request failed'
                });
              }
              throw err;
            });
          }

          return fetchPromise;
        };
      }

      // 2. Hook XMLHttpRequest
      if (window.XMLHttpRequest) {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url) {
          let targetUrl = url;
          const originalOrigin = window.__REBUILT_ORIGINAL_ORIGIN__ || (window.__REBUILT_ORIGINAL_URL__ ? (function(){ try { return new URL(window.__REBUILT_ORIGINAL_URL__).origin; } catch(_) { return ''; } })() : '');
          const currentCloneId = window.__REBUILT_CLONE_ID__ || (function(){
            const m = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
            return m ? m[1] : '';
          })();

          const isInternalRebuilt = typeof url === 'string' && (
            url.startsWith('/api/auth') ||
            url.startsWith('/api/bridge') ||
            url.startsWith('/api/web-cloner') ||
            url.startsWith('/api/local') ||
            url.startsWith('/api/proxy')
          );
          if (isInternalRebuilt) {
            this.__rebuiltUrl = url;
            return origOpen.apply(this, arguments);
          }

          if (typeof url === 'string' && currentCloneId && !trackerRegex.test(url)) {
            let bridgePath = null;
            let proxyUrl = null;
            if (originalOrigin && url.startsWith(originalOrigin)) {
              bridgePath = url.slice(originalOrigin.length);
            } else if (url.startsWith(window.location.origin)) {
              const rel = url.slice(window.location.origin.length);
              if (rel.startsWith('/clones/' + currentCloneId + '/assets/')) {
                bridgePath = null;
              } else if (rel.startsWith('/clones/' + currentCloneId + '/')) {
                bridgePath = rel.slice(('/clones/' + currentCloneId).length);
              } else if (rel.startsWith('/api/') || authEndpointsRegex.test(url)) {
                bridgePath = rel;
              }
            } else if (url.startsWith('/') && (url.startsWith('/api/') || authEndpointsRegex.test(url) || url.includes('/shop/mcm/'))) {
              bridgePath = url;
            } else if (url.startsWith('http://') || url.startsWith('https://')) {
              try {
                const parsed = new URL(url);
                if (parsed.origin !== window.location.origin && (!originalOrigin || parsed.origin !== originalOrigin)) {
                  proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
                }
              } catch (_) {}
            }

            if (bridgePath && (bridgePath.startsWith('/assets/') || bridgePath.includes('/assets/media/') || /\\.(css|js|png|jpe?g|webp|avif|gif|svg|mp4|webm|mov|m4v|mp3|woff2?)(\\?.*)?$/i.test(bridgePath))) {
              bridgePath = null;
            }

            if (bridgePath) {
              if (!bridgePath.startsWith('/')) bridgePath = '/' + bridgePath;
              targetUrl = '/api/bridge/clone/' + encodeURIComponent(currentCloneId) + bridgePath;
            } else if (proxyUrl) {
              targetUrl = proxyUrl;
            }
          }

          this.__rebuiltUrl = targetUrl;
          return origOpen.call(this, method, targetUrl);
        };

        XMLHttpRequest.prototype.send = function(body) {
          const urlStr = String(this.__rebuiltUrl || '');
          if (trackerRegex.test(urlStr)) {
            const mockData = JSON.stringify({ status: 200, success: true });
            const self = this;
            setTimeout(function() {
              try {
                Object.defineProperty(self, 'status', { value: 200, writable: false });
                Object.defineProperty(self, 'readyState', { value: 4, writable: false });
                Object.defineProperty(self, 'responseText', { value: mockData, writable: false });
                Object.defineProperty(self, 'response', { value: mockData, writable: false });
                if (typeof self.onreadystatechange === 'function') {
                  self.onreadystatechange(new Event('readystatechange'));
                }
                if (typeof self.onload === 'function') {
                  self.onload(new Event('load'));
                }
              } catch (_) {}
            }, 10);
            return;
          }
          return origSend.apply(this, arguments);
        };
      }

      // 3. Hook navigator.sendBeacon
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const origSendBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function(url, data) {
          const urlStr = String(url || '');
          if (trackerRegex.test(urlStr) || authEndpointsRegex.test(urlStr)) {
            return true;
          }
          try {
            return origSendBeacon(url, data);
          } catch (_) {
            return true;
          }
        };
      }

      // 4. Hook window.Image for 1x1 tracking beacons and analytics pixels
      if (typeof window !== 'undefined' && typeof window.Image === 'function') {
        const OrigImage = window.Image;
        window.Image = function(w, h) {
          const img = new OrigImage(w, h);
          let realSrc = '';
          Object.defineProperty(img, 'src', {
            get() { return realSrc; },
            set(val) {
              realSrc = val;
              if (typeof val === 'string' && (trackerRegex.test(val) || val.includes('/b/ss/'))) {
                img.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
                setTimeout(() => { if (typeof img.onload === 'function') img.onload(new Event('load')); }, 10);
                return;
              }
              img.setAttribute('src', val);
            }
          });
          return img;
        };
      }
    })();

    // 5. Universal Modal & Popup Dismissal Engine for static preview
    // 5. Universal Modal, Tour & Popup Dismissal Engine for static preview
    function dismissModal(target) {
      if (!target) return;
      const overlay = target.closest(
        '.site-popup-overlay, [role="dialog"], [aria-modal="true"], .modal, .modal-backdrop, .popup-overlay, .popup, .overlay, .dialog, .site-popup-card, #preloader, #preloader2, .preloader, #tour-modal, .introjs-overlay, .shepherd-modal, #ac-localeswitcher, .ac-localeswitcher'
      ) || target;
      if (overlay) {
        overlay.style.setProperty('display', 'none', 'important');
        overlay.style.setProperty('visibility', 'hidden', 'important');
        overlay.style.setProperty('opacity', '0', 'important');
        overlay.style.setProperty('pointer-events', 'none', 'important');
        overlay.setAttribute('aria-hidden', 'true');
        if (overlay.id === 'ac-localeswitcher' || overlay.classList.contains('ac-localeswitcher')) {
          if (document.documentElement) {
            document.documentElement.classList.remove('ac-ls-visible');
          }
        }
      }
      // Also hide any sibling dark backdrops
      document.querySelectorAll('.modal-backdrop, .site-popup-overlay, #preloader, #preloader2').forEach(function(b) {
        b.style.setProperty('display', 'none', 'important');
        b.style.setProperty('pointer-events', 'none', 'important');
      });
      if (document.body) {
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('position');
      }
      if (document.documentElement) {
        document.documentElement.style.removeProperty('overflow');
      }
    }

    // Auto-clear full screen loading screens, glitches, and scroll locks in static preview
    function clearPreloaders() {
      const preloaderSelectors = [
        '#preloader', '#preloader2', '.preloader', '.loader-wrap', '.page-loader',
        '.site-preloader', '#loading-screen', '[data-preloader]', '.curtain',
        '.page-transition', '[data-transition-overlay]', '.loader-bg', '.splash-screen',
        '.loading-overlay', '.pace', '#ctn-preloader', '.spinner-wrapper',
        '.initial-loader', '.loading-mask', '#app-loader',
        '.glow-toaster', '#glow-toaster-body', '[data-toaster-type]', '#nav-global-location-toaster', '.nav-toaster',
        '.ac-ls-dropdown-scrim', '.ac-ls-scrim', '#ac-ls-dropdown-scrim'
      ];
      preloaderSelectors.forEach(function(sel) {
        document.querySelectorAll(sel).forEach(function(p) {
          p.style.setProperty('display', 'none', 'important');
          p.style.setProperty('pointer-events', 'none', 'important');
          p.style.setProperty('opacity', '0', 'important');
          p.style.setProperty('visibility', 'hidden', 'important');
        });
      });
      if (document.body) {
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('position');
        document.body.style.removeProperty('touch-action');
        document.body.style.removeProperty('overscroll-behavior');
        document.body.style.setProperty('overflow-y', 'auto', 'important');
        document.body.style.setProperty('touch-action', 'auto', 'important');
        document.body.style.setProperty('overscroll-behavior', 'auto', 'important');
      }
      if (document.documentElement) {
        document.documentElement.style.removeProperty('overflow');
        document.documentElement.style.removeProperty('touch-action');
        document.documentElement.style.removeProperty('overscroll-behavior');
        document.documentElement.style.setProperty('overflow-y', 'auto', 'important');
        document.documentElement.style.setProperty('touch-action', 'auto', 'important');
        document.documentElement.style.setProperty('overscroll-behavior', 'auto', 'important');
      }

      // Automatically un-hide staged scroll-reveal sections (GSAP, Tailwind, SvelteKit)
      const revealTargets = document.querySelectorAll(
        '.opacity-0.blur-2xl, .opacity-0.blur-xl, .opacity-0.blur-lg, [class*="opacity-0"][class*="blur-"], main > div.opacity-0, main > div[class*="opacity-0"], section.opacity-0, .transition-all.opacity-0'
      );
      revealTargets.forEach(function(el) {
        el.classList.remove('opacity-0', 'blur-2xl', 'blur-xl', 'blur-lg', 'blur-md', 'blur');
        el.classList.add('opacity-100', 'blur-none');
        el.style.setProperty('opacity', '1', 'important');
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
      });

      // Un-disable dormant buttons (e.g. Apple responsive footer accordions)
      document.querySelectorAll('.ac-gf-directory-column-section-title-button, .directory-column-section-title-button').forEach(function(b) {
        b.removeAttribute('disabled');
        b.disabled = false;
      });

      // Convert any legacy 404 containers into an interactive gateway to Member Center & Home
      const p404 = document.querySelector('.page-404, .page-404__container');
      if (p404 && !p404.dataset.rebuiltRecovered) {
        p404.dataset.rebuiltRecovered = 'true';
        const txt = p404.querySelector('.page-404__text, h1, p');
        if (txt) {
          txt.textContent = 'This protected after-login page is ready for you in Member Center!';
        }
        const cloneId = window.__REBUILT_CLONE_ID__ || (function() {
          const m = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
          return m ? m[1] : '';
        })();
        const btnContainer = p404.querySelector('button, .hyl-button') ? p404.querySelector('button, .hyl-button').parentElement : p404;
        if (btnContainer && cloneId) {
          btnContainer.innerHTML = '<div style="display:flex;gap:12px;justify-content:center;margin-top:20px;flex-wrap:wrap;"><a href="/clones/' + cloneId + '/account/" style="display:inline-flex;align-items:center;gap:8px;padding:12px 28px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;box-shadow:0 8px 24px rgba(59,130,246,0.35);">👤 Open Member Center</a><a href="/clones/' + cloneId + '/" style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:rgba(255,255,255,0.08);color:#fff;border-radius:999px;text-decoration:none;font-weight:500;font-size:15px;border:1px solid rgba(255,255,255,0.15);">← Return to Home</a></div>';
        }
      }
    }
    clearPreloaders();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', clearPreloaders);
    }
    window.addEventListener('load', clearPreloaders);
    setTimeout(clearPreloaders, 300);
    setTimeout(clearPreloaders, 1000);
    setTimeout(clearPreloaders, 2500);

    // 6. Universal Web Font & Icon Font Proxy Engine
    (function loadCrossoriginFonts() {
      const proxyBase = (window.location.origin || '') + '/api/proxy?url=';

      // Method A: If pre-extracted fonts exist from cloning time, inject @font-face style tag immediately
      if (Array.isArray(window.__REBUILT_FONTS__) && window.__REBUILT_FONTS__.length > 0) {
        var fontCss = '';
        var seen = {};
        window.__REBUILT_FONTS__.forEach(function(f) {
          var cleanFam = (f.family || '').replace(/["']/g, '').trim();
          if (!cleanFam || !f.src) return;
          var key = cleanFam + '-' + (f.weight || 'normal') + '-' + (f.style || 'normal');
          if (seen[key]) return;
          seen[key] = true;

          var proxiedSrc = f.src.replace(/url\\(\\s*["']?([^"')]+)["']?\\s*\\)/gi, function(match, u) {
            if (u.startsWith('data:')) return match;
            try {
              var absUrl = new URL(u, f.sheetUrl || window.location.href).toString();
              if (absUrl.indexOf('.eot') !== -1) return '';
              return 'url("' + proxyBase + encodeURIComponent(absUrl) + '")';
            } catch (_) {
              return match;
            }
          }).replace(/,\\s*,/g, ',').replace(/,\\s*$/g, '').replace(/^\\s*,/g, '');

          if (proxiedSrc.trim()) {
            fontCss += '@font-face { font-family: "' + cleanFam + '"; src: ' + proxiedSrc + '; font-weight: ' + (f.weight || 'normal') + '; font-style: ' + (f.style || 'normal') + '; font-display: swap; }\\n';
          }
        });

        if (fontCss.trim()) {
          var styleEl = document.createElement('style');
          styleEl.id = 'rebuilt-injected-fonts';
          styleEl.textContent = fontCss;
          (document.head || document.documentElement).appendChild(styleEl);
        }
      }

      // Method B: Runtime fallback scanning for any dynamically added stylesheets
      if (!window.FontFace || !document.fonts) return;
      document.querySelectorAll('link[rel="stylesheet"]').forEach(function(link) {
        var href = link.href;
        if (!href || href.startsWith('data:') || href.indexOf('fonts.googleapis.com') !== -1) return;
        try {
          var u = new URL(href);
          if (u.origin !== window.location.origin) {
            fetch(proxyBase + encodeURIComponent(href))
              .then(function(res) { return res.text(); })
              .then(function(css) {
                var fontFaceRegex = /@font-face\\s*\\{([^}]+)\\}/gi;
                var match;
                while ((match = fontFaceRegex.exec(css)) !== null) {
                  var block = match[1];
                  var famMatch = block.match(/font-family\\s*:\\s*['"]?([^'";]+)['"]?/i);
                  var srcMatch = block.match(/url\\(\\s*['"]?([^'")]+)['"]?\\s*\\)/i);
                  if (famMatch && srcMatch) {
                    var family = famMatch[1].trim();
                    var rawUrl = srcMatch[1].trim();
                    if (rawUrl.indexOf('.eot') !== -1) continue;
                    try {
                      var absoluteFontUrl = new URL(rawUrl, href).toString();
                      var proxiedFontUrl = proxyBase + encodeURIComponent(absoluteFontUrl);
                      var font = new FontFace(family, 'url("' + proxiedFontUrl + '")');
                      font.load().then(function(f) {
                        document.fonts.add(f);
                      }).catch(function() {});
                    } catch(_) {}
                  }
                }
              })
              .catch(function() {});
          }
        } catch(_) {}
      });
    })();

    // 7. Interactive Mega-Menus & Navbar Flyouts (Apple Globalnav & Modern Websites)
    function setupNavFlyouts() {
      const nav = document.getElementById('globalnav') || document.querySelector('header nav, .navbar');
      if (!nav || nav.dataset.rebuiltNavInit) return;
      nav.dataset.rebuiltNavInit = 'true';

      function ensureNavbarDisplay() {
        const isDesktop = window.innerWidth >= 834;
        const menu = nav.querySelector('.globalnav-menu');
        const flyout = nav.querySelector('.globalnav-menu > .globalnav-flyout');
        const menuList = nav.querySelector('.globalnav-menu-list');
        if (isDesktop) {
          if (menu) menu.style.setProperty('display', 'contents', 'important');
          if (flyout) flyout.style.setProperty('display', 'contents', 'important');
          if (menuList) menuList.style.setProperty('display', 'contents', 'important');
        } else {
          if (menu) menu.style.removeProperty('display');
          if (flyout) flyout.style.removeProperty('display');
          if (menuList) menuList.style.removeProperty('display');
        }
      }
      window.addEventListener('resize', ensureNavbarDisplay, { passive: true });
      ensureNavbarDisplay();

      let flyoutCloseTimer = null;

      function openFlyout(item) {
        if (!item || item.classList.contains('globalnav-menu')) return;
        clearTimeout(flyoutCloseTimer);
        nav.querySelectorAll('.globalnav-item-submenu').forEach(function(it) {
          if (it !== item) {
            it.classList.remove('globalnav-item-flyout-open');
            const b = it.querySelector('.globalnav-link, .globalnav-submenu-trigger-button, a');
            if (b) b.setAttribute('aria-expanded', 'false');
            const f = it.querySelector('.globalnav-submenu');
            if (f) {
              f.style.setProperty('visibility', 'hidden', 'important');
              f.style.setProperty('opacity', '0', 'important');
              f.style.setProperty('display', 'none', 'important');
              f.style.setProperty('pointer-events', 'none', 'important');
              const s = f.querySelector('.globalnav-flyout-scroll-container');
              if (s) {
                s.style.setProperty('visibility', 'hidden', 'important');
                s.style.setProperty('opacity', '0', 'important');
              }
            }
          }
        });
        nav.classList.add('globalnav-with-flyout-open');
        item.classList.add('globalnav-item-flyout-open');
        const btn = item.querySelector('.globalnav-link, .globalnav-submenu-trigger-button, a');
        if (btn) btn.setAttribute('aria-expanded', 'true');

        const flyout = item.querySelector('.globalnav-submenu');
        if (flyout) {
          flyout.style.setProperty('visibility', 'visible', 'important');
          flyout.style.setProperty('opacity', '1', 'important');
          flyout.style.setProperty('display', 'block', 'important');
          flyout.style.setProperty('pointer-events', 'auto', 'important');
          const scroll = flyout.querySelector('.globalnav-flyout-scroll-container');
          if (scroll) {
            scroll.style.setProperty('visibility', 'visible', 'important');
            scroll.style.setProperty('opacity', '1', 'important');
            scroll.style.setProperty('display', 'block', 'important');
          }
          const content = flyout.querySelector('.globalnav-submenu-content');
          if (content) {
            content.style.setProperty('visibility', 'visible', 'important');
            content.style.setProperty('opacity', '1', 'important');
            content.style.setProperty('display', 'flex', 'important');
          }
        }
      }

      function closeFlyout() {
        flyoutCloseTimer = setTimeout(function() {
          nav.classList.remove('globalnav-with-flyout-open');
          nav.querySelectorAll('.globalnav-item-submenu').forEach(function(it) {
            it.classList.remove('globalnav-item-flyout-open');
            const b = it.querySelector('.globalnav-link, .globalnav-submenu-trigger-button, a');
            if (b) b.setAttribute('aria-expanded', 'false');
            const f = it.querySelector('.globalnav-submenu');
            if (f) {
              f.style.setProperty('visibility', 'hidden', 'important');
              f.style.setProperty('opacity', '0', 'important');
              f.style.setProperty('display', 'none', 'important');
              f.style.setProperty('pointer-events', 'none', 'important');
              const s = f.querySelector('.globalnav-flyout-scroll-container');
              if (s) {
                s.style.setProperty('visibility', 'hidden', 'important');
                s.style.setProperty('opacity', '0', 'important');
              }
            }
          });
        }, 200);
      }

      nav.querySelectorAll('.globalnav-item-submenu').forEach(function(item) {
        const flyout = item.querySelector('.globalnav-submenu');
        if (!flyout) return;

        function onEnter() {
          if (window.innerWidth > 833) openFlyout(item);
        }
        function onLeave() {
          if (window.innerWidth > 833) closeFlyout();
        }

        item.addEventListener('mouseenter', onEnter);
        item.addEventListener('pointerenter', onEnter);
        item.addEventListener('focusin', onEnter);
        item.addEventListener('mouseleave', onLeave);
        item.addEventListener('pointerleave', onLeave);

        const triggerLink = item.querySelector('.globalnav-link, .globalnav-submenu-trigger-link');
        if (triggerLink) {
          triggerLink.addEventListener('click', function(e) {
            if (window.innerWidth > 833) {
              e.preventDefault();
              if (item.classList.contains('globalnav-item-flyout-open')) {
                closeFlyout();
              } else {
                openFlyout(item);
              }
            }
          });
        }
      });

      const menuTrigger = nav.querySelector('#globalnav-menutrigger-button, .globalnav-menutrigger-button');
      if (menuTrigger) {
        menuTrigger.addEventListener('click', function(e) {
          if (window.innerWidth <= 833) {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = nav.classList.contains('globalnav-with-menu-open');
            nav.classList.toggle('globalnav-with-menu-open', !isOpen);
            nav.classList.toggle('globalnav-menu-open', !isOpen);
            nav.classList.toggle('globalnav-open', !isOpen);
            menuTrigger.classList.toggle('active', !isOpen);
            menuTrigger.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
            if (isOpen) {
              nav.classList.remove('globalnav-with-submenu-open');
            }
          }
        });
      }

      nav.addEventListener('mouseleave', function() {
        if (window.innerWidth > 833) closeFlyout();
      });
      nav.addEventListener('pointerleave', function() {
        if (window.innerWidth > 833) closeFlyout();
      });

      document.addEventListener('click', function(evt) {
        if (!nav.contains(evt.target)) {
          nav.classList.remove('globalnav-with-flyout-open');
          nav.querySelectorAll('.globalnav-item-submenu').forEach(function(it) {
            it.classList.remove('globalnav-item-flyout-open');
            const f = it.querySelector('.globalnav-submenu');
            if (f) {
              f.style.setProperty('visibility', 'hidden', 'important');
              f.style.setProperty('opacity', '0', 'important');
              f.style.setProperty('display', 'none', 'important');
              f.style.setProperty('pointer-events', 'none', 'important');
            }
          });
        }
      });
    }

    setupNavFlyouts();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupNavFlyouts);
    }
    window.addEventListener('load', setupNavFlyouts);
    setTimeout(setupNavFlyouts, 200);
    setTimeout(setupNavFlyouts, 1000);

    // ==========================================
    // Universal In-Clone Authentication & Member Engine
    // ==========================================
    function getCloneId() {
      if (window.__REBUILT_CLONE_ID__) return window.__REBUILT_CLONE_ID__;
      const m = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
      return m ? m[1] : 'default';
    }



    function showTopLoader() {
      let loader = document.getElementById('rebuilt-top-loader');
      if (!loader) {
        loader = document.createElement('div');
        loader.id = 'rebuilt-top-loader';
        document.body.appendChild(loader);
      }
      loader.classList.add('loading');
      loader.style.width = '30%';
      setTimeout(function() {
        if (loader) loader.style.width = '75%';
      }, 150);
      setTimeout(function() {
        if (loader) loader.style.width = '92%';
      }, 800);
    }

    document.addEventListener('click', function(e) {
      // Visual Tactile Feedback for all clickable buttons
      const anyBtn = e.target.closest('button, [role="button"], .btn');
      if (anyBtn) {
        anyBtn.classList.add('rebuilt-button-pressed');
        setTimeout(function() {
          anyBtn.classList.remove('rebuilt-button-pressed');
        }, 150);
      }

      // If website scripts already handled this click event, do not hijack or override
      if (e.defaultPrevented) return;

      // A: Click on a close button or element with close-like text/attributes
      const closeSelector = [
        'button[aria-label*="close" i]',
        'button[title*="close" i]',
        'button[aria-label*="dismiss" i]',
        'button[title*="dismiss" i]',
        '.close',
        '.modal-close',
        '.popup-close',
        '.site-popup-close',
        '[data-dismiss]',
        '[data-close]',
        '[data-bs-dismiss]',
        '#skip-tour',
        '#start-tour',
        '.btn-preloader',
        '.as-globalbanner-close',
        '.section-ribbon-close',
        '[data-analytics-title*="close" i]',
        'button.ribbon-close',
        '#ac-ls-close',
        '.ac-ls-close',
        'button.ac-ls-close',
        '[data-analytics-title="close"]'
      ].join(',');

      const closeBtn = e.target.closest(closeSelector);
      const text = (e.target.textContent || '').trim();
      const isCloseText = (text === '✕' || text === '×' || text === '✖' || text === 'Close' || text === 'Dismiss' || text === 'Skip' || text === 'Skip Tour' || text === "Let's Go!");

      if (closeBtn || isCloseText) {
        const modalContainer = (closeBtn || e.target).closest(
          '.site-popup-overlay, [role="dialog"], [aria-modal="true"], .modal, .popup-overlay, .popup, .overlay, .site-popup-card, #preloader, #preloader2, .preloader, .section-ribbon, .as-globalbanner, [data-analytics-region="ribbon"], #ac-localeswitcher, .ac-localeswitcher'
        );
        if (modalContainer) {
          dismissModal(modalContainer);
          e.preventDefault();
          e.stopPropagation();
          return;
        } else {
          clearPreloaders();
        }
      }

      // B: Click directly on the backdrop/overlay outside the dialog card
      const overlayEl = e.target.closest('.site-popup-overlay, [role="dialog"], [aria-modal="true"], .modal, .modal-backdrop, .popup-overlay, #preloader2, .as-globalbanner');
      if (overlayEl && (e.target === overlayEl || e.target.classList.contains('site-popup-overlay') || e.target.classList.contains('modal-backdrop') || e.target.id === 'preloader2')) {
        dismissModal(overlayEl);
        e.preventDefault();
        e.stopPropagation();
      }

      // D: Mobile Hamburger Menu Toggle (Apple Globalnav & Universal Websites - mobile only)
      const hamburgerBtn = e.target.closest(
        '#globalnav-menutrigger-button, .globalnav-menutrigger-button, #globalnav-menutrigger-open, #globalnav-menutrigger-close, .navbar-toggler, .mobile-menu-toggle, .mobile-menu-btn, .menu-toggle, .nav-toggle, .hamburger, [data-globalnav-item-name="menu"], [data-drawer-toggle]'
      );
      if (hamburgerBtn && window.innerWidth <= 833) {
        const gNav = document.getElementById('globalnav');
        if (gNav) {
          const isOpen = gNav.classList.contains('globalnav-with-menu-open') || gNav.classList.contains('globalnav-menu-open') || gNav.classList.contains('globalnav-open') || gNav.classList.contains('menu-open') || gNav.classList.contains('active');
          gNav.classList.toggle('globalnav-with-menu-open', !isOpen);
          gNav.classList.toggle('globalnav-menu-open', !isOpen);
          gNav.classList.toggle('globalnav-open', !isOpen);
          gNav.classList.toggle('menu-open', !isOpen);
          gNav.classList.toggle('active', !isOpen);
          document.documentElement.classList.toggle('globalnav-open', !isOpen);
          document.body.classList.toggle('globalnav-open', !isOpen);
          hamburgerBtn.classList.toggle('active', !isOpen);
          hamburgerBtn.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
          if (isOpen) {
            gNav.classList.remove('globalnav-with-submenu-open');
          }
        } else {
          // Universal Website Mobile Menu Toggle
          const targetSelector = hamburgerBtn.getAttribute('data-bs-target') || hamburgerBtn.getAttribute('data-target') || (hamburgerBtn.getAttribute('aria-controls') ? '#' + hamburgerBtn.getAttribute('aria-controls') : null);
          const collapseTarget = targetSelector ? document.querySelector(targetSelector) : (hamburgerBtn.parentElement ? hamburgerBtn.parentElement.querySelector('.navbar-collapse, .mobile-nav, .nav-menu, .drawer, ul') : null);
          if (collapseTarget) {
            const isShown = collapseTarget.classList.contains('show') || collapseTarget.classList.contains('open') || collapseTarget.classList.contains('is-active');
            collapseTarget.classList.toggle('show', !isShown);
            collapseTarget.classList.toggle('open', !isShown);
            collapseTarget.classList.toggle('is-active', !isShown);
            collapseTarget.setAttribute('data-rebuilt-expanded', !isShown ? 'true' : 'false');
            hamburgerBtn.setAttribute('aria-expanded', !isShown ? 'true' : 'false');
          }
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // E: Mobile Submenu Drill-Down & Back Buttons
      const subTriggerBtn = e.target.closest('.globalnav-submenu-trigger-button, .globalnav-submenu-trigger-link');
      if (subTriggerBtn && window.innerWidth <= 833) {
        const navItem = subTriggerBtn.closest('.globalnav-item');
        const gNav = document.getElementById('globalnav');
        if (navItem && gNav) {
          gNav.classList.add('globalnav-with-submenu-open');
          gNav.querySelectorAll('.globalnav-item').forEach(function(it) { it.classList.remove('globalnav-item-flyout-open'); });
          navItem.classList.add('globalnav-item-flyout-open');
          subTriggerBtn.setAttribute('aria-expanded', 'true');
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const backBtn = e.target.closest('.globalnav-menuback-button, .btn-back, [data-nav-back]');
      if (backBtn) {
        const gNav = document.getElementById('globalnav');
        if (gNav) {
          gNav.classList.remove('globalnav-with-submenu-open');
          gNav.querySelectorAll('.globalnav-item').forEach(function(it) {
            it.classList.remove('globalnav-item-flyout-open');
            const btn = it.querySelector('.globalnav-link, .globalnav-submenu-trigger-button, a');
            if (btn) btn.setAttribute('aria-expanded', 'false');
          });
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // F: Desktop Click on Apple Navbar Trigger (Store, Mac, iPad, iPhone, Watch, etc.)
      const desktopNavTrigger = e.target.closest(
        '#globalnav .globalnav-link, #globalnav .globalnav-item > a, #globalnav .globalnav-submenu-trigger-link, #globalnav .globalnav-submenu-trigger-button, #globalnav [data-globalnav-item-name]'
      );
      if (desktopNavTrigger && window.innerWidth > 833) {
        // If user clicked an actual link INSIDE the flyout menu, let it navigate to the subpage!
        if (e.target.closest('.globalnav-submenu')) {
          return;
        }

        const navItem = desktopNavTrigger.closest('.globalnav-item-submenu') || desktopNavTrigger.closest('.globalnav-item:not(.globalnav-menu)');
        const gNav = document.getElementById('globalnav');
        if (navItem && gNav) {
          const flyout = navItem.querySelector('.globalnav-submenu');
          if (flyout) {
            const isAlreadyOpen = navItem.classList.contains('globalnav-item-flyout-open');
            gNav.querySelectorAll('.globalnav-item-submenu').forEach(function(it) {
              it.classList.remove('globalnav-item-flyout-open');
              const b = it.querySelector('.globalnav-link, .globalnav-submenu-trigger-button, a');
              if (b) b.setAttribute('aria-expanded', 'false');
              const f = it.querySelector('.globalnav-submenu');
              if (f) {
                f.style.setProperty('visibility', 'hidden', 'important');
                f.style.setProperty('opacity', '0', 'important');
                f.style.setProperty('display', 'none', 'important');
                f.style.setProperty('pointer-events', 'none', 'important');
              }
            });
            if (!isAlreadyOpen) {
              navItem.classList.add('globalnav-item-flyout-open');
              gNav.classList.add('globalnav-with-flyout-open');
              desktopNavTrigger.setAttribute('aria-expanded', 'true');
              flyout.style.setProperty('visibility', 'visible', 'important');
              flyout.style.setProperty('opacity', '1', 'important');
              flyout.style.setProperty('display', 'block', 'important');
              flyout.style.setProperty('pointer-events', 'auto', 'important');
            } else {
              gNav.classList.remove('globalnav-with-flyout-open');
              desktopNavTrigger.setAttribute('aria-expanded', 'false');
            }
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }

      // G: Footer Directory Accordions (Apple footer buttons & responsive accordions)
      const accordionBtn = e.target.closest('.ac-gf-directory-column-section-title-button, .directory-column-section-title-button, .accordion-button, .accordion-header, [data-accordion-trigger]');
      if (accordionBtn) {
        const section = accordionBtn.closest('.ac-gf-directory-column-section, .accordion-item, .directory-section');
        if (section) {
          const isExp = section.classList.contains('expanded') || section.classList.contains('ac-gf-directory-column-section-expanded');
          section.classList.toggle('expanded', !isExp);
          section.classList.toggle('ac-gf-directory-column-section-expanded', !isExp);
          accordionBtn.setAttribute('aria-expanded', !isExp ? 'true' : 'false');
          const list = section.querySelector('.ac-gf-directory-column-section-list, .accordion-collapse, ul');
          if (list) {
            list.style.display = isExp ? 'none' : 'block';
          }
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // H: Carousels & Sliders (Dotnav, play/pause, prev/next)
      const dotItem = e.target.closest('.media-gallery-dotnav-item, .dotnav-item, .dotnav-link, [data-analytics-title*="slide" i], .swiper-pagination-bullet, .slick-dots li');
      if (dotItem) {
        const dotContainer = dotItem.closest('.dotnav, .media-gallery-dotnav, .dotnav-items, .swiper-pagination, .slick-dots');
        if (dotContainer) {
          const allDots = Array.from(dotContainer.querySelectorAll('.dotnav-item, .media-gallery-dotnav-item, .swiper-pagination-bullet, li'));
          const targetDot = dotItem.closest('.dotnav-item, .media-gallery-dotnav-item, .swiper-pagination-bullet, li') || dotItem;
          const index = allDots.indexOf(targetDot);
          if (index !== -1) {
            allDots.forEach(function(d, i) {
              d.classList.toggle('current', i === index);
              d.classList.toggle('active', i === index);
              d.classList.toggle('dotnav-focused', i === index);
              const a = d.querySelector('a, button');
              if (a) a.setAttribute('aria-selected', i === index ? 'true' : 'false');
            });

            const gallery = document.querySelector('.section-endless-entertainment-gallery, .media-gallery, .gallery-container, .carousel-inner, .swiper-wrapper');
            if (gallery) {
              const shelf = gallery.querySelector('.media-gallery-shelf, .gallery-items, .media-gallery-items, .carousel-inner, .swiper-wrapper') || gallery;
              const items = shelf.querySelectorAll('.media-gallery-item, .gallery-item, .carousel-item, .swiper-slide');
              if (items.length > index) {
                items.forEach(function(it, i) { it.classList.toggle('current', i === index); });
                const percent = -(index * 100);
                shelf.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
                shelf.style.transform = 'translateX(' + percent + '%)';
              }
            }
          }
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const playPauseBtn = e.target.closest('.media-gallery-dotnav-iconcontrol, .dotnav-iconcontrol, .carousel-play-pause, [data-play-pause]');
      if (playPauseBtn) {
        const dotnav = playPauseBtn.closest('.dotnav, .media-gallery-dotnav');
        if (dotnav) {
          const isPaused = dotnav.classList.contains('dotnav-timed-paused');
          dotnav.classList.toggle('dotnav-timed-paused', !isPaused);
          dotnav.classList.toggle('dotnav-timed-playing', isPaused);
          playPauseBtn.setAttribute('aria-label', isPaused ? 'Pause' : 'Play');
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const prevBtn = e.target.closest('.slider-prev, .carousel-control-prev, .slick-prev, [data-slide="prev"], .prev-button');
      const nextBtn = e.target.closest('.slider-next, .carousel-control-next, .slick-next, [data-slide="next"], .next-button');
      if (prevBtn || nextBtn) {
        const dir = prevBtn ? -1 : 1;
        const carousel = (prevBtn || nextBtn).closest('.carousel, .slider, .media-gallery, .gallery, section') || document;
        const items = Array.from(carousel.querySelectorAll('.carousel-item, .media-gallery-item, .slide, .swiper-slide'));
        if (items.length > 1) {
          const curIdx = items.findIndex(function(it) { return it.classList.contains('active') || it.classList.contains('current'); });
          const nextIdx = (curIdx + dir + items.length) % items.length;
          items.forEach(function(it, i) {
            it.classList.toggle('active', i === nextIdx);
            it.classList.toggle('current', i === nextIdx);
          });
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // I: Tabs ([role="tab"], .nav-tabs .nav-link)
      const tabBtn = e.target.closest('[role="tab"], .nav-tabs .nav-link, .tab-link');
      if (tabBtn) {
        const tabList = tabBtn.closest('[role="tablist"], .nav-tabs, .tab-nav') || tabBtn.parentElement;
        if (tabList) {
          tabList.querySelectorAll('[role="tab"], .nav-link, .tab-link').forEach(function(t) {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
          });
          tabBtn.classList.add('active');
          tabBtn.setAttribute('aria-selected', 'true');
          const targetId = tabBtn.getAttribute('aria-controls') || tabBtn.getAttribute('data-target') || (tabBtn.getAttribute('href') && tabBtn.getAttribute('href').startsWith('#') ? tabBtn.getAttribute('href').slice(1) : null);
          if (targetId) {
            const panel = document.getElementById(targetId);
            if (panel) {
              panel.parentElement.querySelectorAll('[role="tabpanel"], .tab-pane').forEach(function(p) { p.classList.remove('active', 'show'); });
              panel.classList.add('active', 'show');
            }
          }
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // J: Audio & Video Media Play/Mute Controls
      const mediaCtrl = e.target.closest('.video-toggle, .btn-play, .btn-pause, .btn-mute, .btn-sound, [data-video-toggle], [data-sound-toggle]');
      if (mediaCtrl) {
        const container = mediaCtrl.closest('section, div, .hero, .media-container') || document;
        const video = container.querySelector('video');
        if (video) {
          if (mediaCtrl.classList.contains('btn-mute') || mediaCtrl.classList.contains('btn-sound') || mediaCtrl.hasAttribute('data-sound-toggle')) {
            video.muted = !video.muted;
            mediaCtrl.classList.toggle('muted', video.muted);
          } else {
            if (video.paused) {
              video.play().catch(function() {});
              mediaCtrl.classList.remove('paused');
            } else {
              video.pause();
              mediaCtrl.classList.add('paused');
            }
          }
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // K: Bootstrap / Standard Dropdowns & Submenu Toggles
      const submenuBtn = e.target.closest('.has-submenu > .nav-link-row, .has-submenu > button, .dropdown-toggle, [data-toggle="dropdown"], [data-bs-toggle="dropdown"]');
      if (submenuBtn) {
        const parent = submenuBtn.closest('.has-submenu, .dropdown, .nav-item');
        if (parent) {
          parent.classList.toggle('open');
          parent.classList.toggle('show');
          submenuBtn.setAttribute('aria-expanded', parent.classList.contains('show') ? 'true' : 'false');
          const menu = parent.querySelector('.dropdown-menu');
          if (menu) {
            const currentDisp = window.getComputedStyle(menu).display;
            menu.style.display = currentDisp === 'none' ? 'block' : 'none';
          }
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // K1.5: In-Clone Notification Dialog Toggler
      const notifTrigger = e.target.closest('.header-item.header-notification [role="button"], .header-item.header-notification');
      if (notifTrigger && !e.target.closest('.header-notification-dialog') && !e.target.closest('#rebuilt-login-modal, #rebuilt-member-flyout')) {
        const notifItem = notifTrigger.closest('.header-item.header-notification');
        if (notifItem) {
          const dialog = notifItem.querySelector('.header-notification-dialog');
          if (dialog) {
            const isShown = dialog.style.display !== 'none';
            dialog.style.display = isShown ? 'none' : 'block';
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }


      // K2: Interactive Elements with Navigation Attributes
      const navTargetEl = e.target.closest('[data-healed-route], [data-href], [data-url], [data-link], [data-navigate], [data-target-url], [data-page], [data-path]');
      if (navTargetEl && !navTargetEl.closest('#rebuilt-login-modal, #rebuilt-member-flyout, a')) {
        const rawTarget = navTargetEl.getAttribute('data-healed-route') ||
                          navTargetEl.getAttribute('data-href') ||
                          navTargetEl.getAttribute('data-url') ||
                          navTargetEl.getAttribute('data-link') ||
                          navTargetEl.getAttribute('data-navigate') ||
                          navTargetEl.getAttribute('data-target-url') ||
                          navTargetEl.getAttribute('data-page') ||
                          navTargetEl.getAttribute('data-path');
        if (rawTarget && !rawTarget.startsWith('javascript:') && !rawTarget.startsWith('#')) {
          const cloneId = window.__REBUILT_CLONE_ID__ || (function() {
            const m = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
            return m ? m[1] : null;
          })();
          if (cloneId) {
            let targetUrl;
            try {
              targetUrl = new URL(rawTarget, window.location.href);
            } catch (_) {}
            if (targetUrl) {
              e.preventDefault();
              e.stopPropagation();
              showTopLoader();
              if (targetUrl.pathname.startsWith('/clones/' + cloneId)) {
                window.location.href = targetUrl.href;
              } else {
                let sub = targetUrl.pathname.replace(new RegExp('^/clones(?:/[^/]+)?/?'), '').replace(new RegExp('^/+'), '');
                window.location.href = '/clones/' + cloneId + '/' + sub + targetUrl.search + targetUrl.hash;
              }
              return;
            }
          }
        }
      }

      // K2.5: Interactive Action Buttons (Copy, Like, Favorite, Bookmark, Follow, Share)
      const actionBtn = e.target.closest('button, [role="button"], .btn');
      if (actionBtn && !actionBtn.closest('#rebuilt-login-modal, #rebuilt-member-flyout')) {
        const btnText = (actionBtn.textContent || '').trim().toLowerCase();
        const isLike = actionBtn.matches('.like-btn, .btn-like, [data-action="like"], [data-like]') || btnText === 'like' || btnText.startsWith('like ');
        const isFav = actionBtn.matches('.favorite-btn, .btn-favorite, [data-action="favorite"], [data-favorite], .bookmark-btn') || btnText === 'favorite' || btnText === 'bookmark' || btnText.startsWith('favorite');
        const isFollow = actionBtn.matches('.follow-btn, .btn-follow, [data-action="follow"]') || btnText === 'follow' || btnText === '+ follow' || btnText === 'following';
        const isCopy = actionBtn.matches('.copy-btn, .btn-copy, [data-copy], [data-clipboard-text]') || btnText.includes('copy');
        const isShare = actionBtn.matches('.share-btn, .btn-share, [data-share]') || btnText.includes('share');

        if (isCopy) {
          e.preventDefault();
          e.stopPropagation();
          const copyVal = actionBtn.getAttribute('data-clipboard-text') || actionBtn.getAttribute('data-copy') || window.location.href;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(copyVal).catch(function() {});
          }
          showPreviewToast('📋 Copied to clipboard!');
          return;
        }

        if (isShare) {
          e.preventDefault();
          e.stopPropagation();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(window.location.href).catch(function() {});
          }
          showPreviewToast('🔗 Page link copied to clipboard!');
          return;
        }

        if (isLike || isFav || isFollow) {
          e.preventDefault();
          e.stopPropagation();
          const isAct = actionBtn.classList.contains('active') || actionBtn.classList.contains('liked') || actionBtn.classList.contains('favorited');
          actionBtn.classList.toggle('active', !isAct);
          actionBtn.classList.toggle('liked', !isAct && isLike);
          actionBtn.classList.toggle('favorited', !isAct && isFav);

          const countEl = actionBtn.querySelector('.count, .badge, [data-count], span');
          if (countEl && /\\d/.test(countEl.textContent)) {
            let n = parseInt(countEl.textContent.replace(/[^0-9]/g, ''), 10) || 0;
            n = isAct ? Math.max(0, n - 1) : n + 1;
            countEl.textContent = n.toLocaleString();
          }

          if (isFollow) {
            actionBtn.textContent = !isAct ? '✓ Following' : '+ Follow';
            showPreviewToast(!isAct ? '✓ Following creator!' : 'Unfollowed.');
          } else if (isLike) {
            showPreviewToast(!isAct ? '❤️ Liked! Added to your profile favorites.' : 'Removed from likes.');
          } else if (isFav) {
            showPreviewToast(!isAct ? '⭐ Saved to bookmarks!' : 'Removed from bookmarks.');
          }
          return;
        }
      }

      // K2.6: Quantity Buttons (+ / -)
      const qtyBtn = e.target.closest('.qty-plus, .qty-minus, [data-qty-plus], [data-qty-minus], button.quantity-btn');
      if (qtyBtn) {
        const wrap = qtyBtn.closest('.quantity, .qty-wrap, div');
        const input = wrap ? wrap.querySelector('input[type="number"], .qty-input, input') : null;
        if (input) {
          e.preventDefault();
          e.stopPropagation();
          let val = parseInt(input.value, 10) || 1;
          const isPlus = qtyBtn.classList.contains('qty-plus') || qtyBtn.hasAttribute('data-qty-plus') || qtyBtn.textContent.trim() === '+';
          val = isPlus ? val + 1 : Math.max(1, val - 1);
          input.value = val;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }

      // K2.7: General Modal Triggers
      const modalTrigger = e.target.closest('[data-toggle="modal"], [data-bs-toggle="modal"], [data-modal-target], [data-target*="modal"]');
      if (modalTrigger) {
        const targetSel = modalTrigger.getAttribute('data-target') || modalTrigger.getAttribute('data-bs-target') || modalTrigger.getAttribute('data-modal-target') || modalTrigger.getAttribute('href');
        if (targetSel && targetSel.startsWith('#')) {
          const targetModal = document.querySelector(targetSel);
          if (targetModal) {
            targetModal.classList.add('show', 'open', 'active');
            targetModal.style.display = 'block';
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }

      // K2.8: General Accordions & Collapsibles
      const genAccordion = e.target.closest('.accordion-button, .accordion-header, [data-toggle="collapse"], [data-bs-toggle="collapse"], [data-accordion-trigger], details > summary, button[aria-expanded]');
      if (genAccordion && !genAccordion.closest('.ac-gf-directory-column-section')) {
        const isDetails = genAccordion.tagName.toLowerCase() === 'summary';
        if (!isDetails) {
          const parentItem = genAccordion.closest('.accordion-item, .accordion, .card, div') || genAccordion.parentElement;
          const isExpanded = genAccordion.getAttribute('aria-expanded') === 'true' || genAccordion.classList.contains('active') || genAccordion.classList.contains('open');
          genAccordion.setAttribute('aria-expanded', !isExpanded ? 'true' : 'false');
          genAccordion.classList.toggle('active', !isExpanded);
          genAccordion.classList.toggle('collapsed', isExpanded);

          const targetPanel = (function() {
            const targetId = genAccordion.getAttribute('data-target') || genAccordion.getAttribute('data-bs-target') || genAccordion.getAttribute('aria-controls');
            if (targetId) {
              const el = document.getElementById(targetId.replace(/^#/, ''));
              if (el) return el;
            }
            return parentItem ? parentItem.querySelector('.accordion-collapse, .collapse, .accordion-body, .panel') : null;
          })();

          if (targetPanel) {
            targetPanel.classList.toggle('show', !isExpanded);
            targetPanel.classList.toggle('open', !isExpanded);
            const curDisp = window.getComputedStyle(targetPanel).display;
            targetPanel.style.display = isExpanded ? 'none' : 'block';
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }

      // K2.75: Modal Dismiss & Close Buttons
      const modalClose = e.target.closest('[data-dismiss="modal"], [data-bs-dismiss="modal"], .modal .close, .btn-close, .modal-close, [data-modal-close]');
      if (modalClose) {
        const modal = modalClose.closest('.modal, [role="dialog"], .dialog, .popup, [data-modal]');
        if (modal) {
          modal.classList.remove('show', 'open', 'active');
          modal.style.display = 'none';
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // K2.85: Tabs & Tabbed Navigation (Bootstrap, ARIA, Custom Tabs)
      const tabTrigger = e.target.closest('[role="tab"], .nav-tabs .nav-link, [data-toggle="tab"], [data-bs-toggle="tab"], [data-tab], .tab-button, .tab-btn');
      if (tabTrigger) {
        const tabList = tabTrigger.closest('[role="tablist"], .nav-tabs, .tabs-nav, .tab-buttons, ul, nav, div');
        if (tabList) {
          const allTabs = tabList.querySelectorAll('[role="tab"], .nav-link, [data-toggle="tab"], [data-bs-toggle="tab"], [data-tab], .tab-button, .tab-btn');
          allTabs.forEach(function(t) {
            t.classList.remove('active', 'selected');
            t.setAttribute('aria-selected', 'false');
          });
          tabTrigger.classList.add('active');
          tabTrigger.setAttribute('aria-selected', 'true');

          const targetId = tabTrigger.getAttribute('data-target') ||
                           tabTrigger.getAttribute('data-bs-target') ||
                           tabTrigger.getAttribute('href') ||
                           tabTrigger.getAttribute('data-tab');
          if (targetId && (targetId.startsWith('#') || !targetId.includes('/'))) {
            const rawId = targetId.replace(/^#/, '');
            const targetPanel = document.getElementById(rawId) || document.querySelector('[data-tab-content="' + rawId + '"]');
            if (targetPanel) {
              const panelContainer = targetPanel.closest('.tab-content, .tabs-content, div') || targetPanel.parentElement;
              if (panelContainer) {
                const siblingPanels = panelContainer.querySelectorAll('.tab-pane, [role="tabpanel"], [data-tab-content]');
                siblingPanels.forEach(function(p) {
                  p.classList.remove('active', 'show');
                  p.style.display = 'none';
                });
              }
              targetPanel.classList.add('active', 'show');
              targetPanel.style.display = 'block';
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }
        }
      }

      // K2.9: Carousel / Slider Controls (Swiper, Slick, Bootstrap Carousel)
      const carouselCtrl = e.target.closest('.carousel-control-next, .carousel-control-prev, [data-slide], [data-bs-slide], .swiper-button-next, .swiper-button-prev, .slick-next, .slick-prev');
      if (carouselCtrl) {
        const isNext = carouselCtrl.matches('.carousel-control-next, [data-slide="next"], [data-bs-slide="next"], .swiper-button-next, .slick-next');
        const carousel = carouselCtrl.closest('.carousel, .swiper, .slick-slider, [data-carousel], div');
        if (carousel) {
          if (carousel.swiper) {
            if (isNext) carousel.swiper.slideNext();
            else carousel.swiper.slidePrev();
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          const items = carousel.querySelectorAll('.carousel-item, .slide, .swiper-slide');
          if (items.length > 0) {
            let activeIdx = -1;
            items.forEach(function(item, idx) {
              if (item.classList.contains('active')) activeIdx = idx;
            });
            if (activeIdx !== -1) {
              items[activeIdx].classList.remove('active');
              items[activeIdx].style.display = 'none';
              const nextIdx = isNext ? (activeIdx + 1) % items.length : (activeIdx - 1 + items.length) % items.length;
              items[nextIdx].classList.add('active');
              items[nextIdx].style.display = 'block';
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }
          const scrollTrack = carousel.querySelector('.carousel-inner, .swiper-wrapper, .slick-track') || carousel;
          if (scrollTrack && scrollTrack.scrollBy) {
            const scrollAmount = isNext ? 350 : -350;
            scrollTrack.scrollBy({ left: scrollAmount, behavior: 'smooth' });
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }

      // K3: 404 Recovery & Back Button Interceptor
      const backTrigger = e.target.closest('.page-404 button, .page-404 a, .page-404__container button, button.normal__primary');
      if (backTrigger && (backTrigger.closest('.page-404') || (backTrigger.textContent || '').trim().toLowerCase() === 'back')) {
        const cloneId = window.__REBUILT_CLONE_ID__ || (function() {
          const m = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
          return m ? m[1] : null;
        })();
        if (cloneId) {
          e.preventDefault();
          e.stopPropagation();
          showTopLoader();
          window.location.href = '/clones/' + cloneId + '/';
          return;
        }
      }

      // L: Seamless In-Clone Page Link Routing Interceptor
      // Keeps all page navigation contained within /clones/<cloneId>/...
      const link = e.target.closest('a');
      if (link && link.href) {
        const rawHref = link.getAttribute('href');
        if (rawHref) {
          if (rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return;
          if (rawHref.startsWith('#')) {
            if (rawHref.length > 1) {
              try {
                const targetEl = document.querySelector(rawHref);
                if (targetEl) {
                  targetEl.scrollIntoView({ behavior: 'smooth' });
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
              } catch (_) {}
            }
            return;
          }
        }

        const cloneId = window.__REBUILT_CLONE_ID__ || (function() {
          const m = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
          return m ? m[1] : null;
        })();
        if (cloneId) {
          let urlObj;
          try {
            urlObj = new URL(link.href, window.location.href);
          } catch (_) {
            return;
          }

          // If already in /clones/<cloneId>/..., show top loader and let regular in-clone navigation proceed
          if (urlObj.pathname.startsWith('/clones/' + cloneId)) {
            showTopLoader();
            return;
          }

          const originalBase = window.__REBUILT_ORIGINAL_URL__ || '';
          let origOrigin = '';
          try {
            if (originalBase) origOrigin = new URL(originalBase).origin;
          } catch (_) {}

          // If same-origin as the cloned site, route to local clone
          if (urlObj.origin === window.location.origin || (origOrigin && urlObj.origin === origOrigin)) {
            let subpath = urlObj.pathname.replace(new RegExp('^/clones(?:/[^/]+)?/?'), '');
            subpath = subpath.replace(new RegExp('^/+'), '');
            const targetLocalUrl = '/clones/' + cloneId + '/' + subpath + urlObj.search + urlObj.hash;
            e.preventDefault();
            e.stopPropagation();
            showTopLoader();
            window.location.href = targetLocalUrl;
            return;
          }

          // External link safety: open in new tab and inform user
          if (urlObj.origin !== window.location.origin && (!origOrigin || urlObj.origin !== origOrigin)) {
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
            showPreviewToast('↗ Opening external site: ' + urlObj.hostname);
            return;
          }
        }
      }
    }, false);

    // M: Universal Preview Toast Notification
    function showPreviewToast(message) {
      let toast = document.getElementById('rebuilt-preview-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'rebuilt-preview-toast';
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(100px);background:rgba(20,20,24,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:#fff;padding:12px 24px;border-radius:999px;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;font-size:13px;font-weight:500;box-shadow:0 12px 32px rgba(0,0,0,0.36),0 0 0 1px rgba(255,255,255,0.12);z-index:999999;pointer-events:none;transition:transform 0.35s cubic-bezier(0.16,1,0.3,1),opacity 0.35s ease;opacity:0;display:flex;align-items:center;gap:10px;';
        document.body.appendChild(toast);
      }
      toast.innerHTML = '<span style=\"display:inline-block;width:8px;height:8px;border-radius:50%;background:#30d158;box-shadow:0 0 8px #30d158;\"></span>' + message;
      toast.style.transform = 'translateX(-50%) translateY(0)';
      toast.style.opacity = '1';
      clearTimeout(toast.__timer);
      toast.__timer = setTimeout(function() {
        toast.style.transform = 'translateX(-50%) translateY(100px)';
        toast.style.opacity = '0';
      }, 3500);
    }

    // N: Simulated Chat Response Generator for Cloned AI / Conversational UIs
    function renderChatSimulation(promptText) {
      showPreviewToast('Response generated in clone preview');

      const container = document.querySelector('article, [data-testid^=\"conversation-turn-\"], main, [role=\"main\"], #web-mobile-root, body');
      if (container) {
        const bubble = document.createElement('div');
        bubble.className = 'rebuilt-simulated-chat';
        bubble.style.cssText = 'margin:16px auto;max-width:768px;padding:18px 22px;background:rgba(255,255,255,0.06);border-radius:16px;border:1px solid rgba(255,255,255,0.12);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:inherit;font-size:15px;line-height:1.6;animation:fadeIn 0.3s ease;';
        
        // User query
        const userMsg = document.createElement('div');
        userMsg.style.cssText = 'font-weight:600;margin-bottom:6px;color:#10a37f;display:flex;align-items:center;gap:6px;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;';
        userMsg.innerHTML = '<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\"><path d=\"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/></svg> You';
        
        const userTextEl = document.createElement('div');
        userTextEl.style.cssText = 'margin-bottom:14px;padding-left:20px;font-size:15px;';
        userTextEl.textContent = promptText;

        // Assistant response
        const aiMsg = document.createElement('div');
        aiMsg.style.cssText = 'font-weight:600;margin-bottom:6px;color:#3b82f6;display:flex;align-items:center;gap:6px;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;';
        aiMsg.innerHTML = '<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4\"/><path d=\"M12 8h.01\"/></svg> Assistant (Preview Mode)';

        const aiTextEl = document.createElement('div');
        aiTextEl.style.cssText = 'padding-left:20px;line-height:1.6;opacity:0.9;font-size:15px;';
        aiTextEl.textContent = 'This is an interactive clone of ' + (document.title || 'the website') + '. Live external API connections are sandboxed in preview mode, but all UI elements, layout, buttons, and client features are fully preserved.';

        bubble.appendChild(userMsg);
        bubble.appendChild(userTextEl);
        bubble.appendChild(aiMsg);
        bubble.appendChild(aiTextEl);

        const composerForm = document.querySelector('form[action*=\"conversation\"], form[data-mobile-composer]');
        if (composerForm && composerForm.parentNode) {
          composerForm.parentNode.insertBefore(bubble, composerForm);
        } else {
          container.appendChild(bubble);
        }
        bubble.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // O: Universal Form Submission Interceptor for Cloned Sites
    // Prevents native page unloads to raw "Cannot POST ..." error screens while preserving site JS
    function handleFormSubmit(e) {
      const form = e.target;
      if (!form || !(form instanceof HTMLFormElement)) return;

      // If page JavaScript already handled submission, do not intercept
      if (e.defaultPrevented) return;

      const method = (form.getAttribute('method') || 'GET').toUpperCase();
      const rawAction = form.getAttribute('action') || '';

      const cloneId = window.__REBUILT_CLONE_ID__ || (function() {
        const m = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
        return m ? m[1] : null;
      })();

      // 1. If GET form (search bar, filter, pagination):
      if (method === 'GET') {
        if (cloneId) {
          let actionUrl;
          try {
            actionUrl = new URL(rawAction || window.location.href, window.location.href);
          } catch (_) {
            return;
          }
          const formData = new FormData(form);
          const params = new URLSearchParams();
          for (const [key, value] of formData.entries()) {
            if (typeof value === 'string') params.append(key, value);
          }
          const queryString = params.toString() ? '?' + params.toString() : '';

          let subpath = actionUrl.pathname;
          while (subpath.startsWith('/clones/')) {
            subpath = subpath.replace(new RegExp('^/clones/[^/]+'), '');
          }
          if (subpath.startsWith('/')) subpath = subpath.slice(1);

          e.preventDefault();
          e.stopPropagation();
          window.location.href = '/clones/' + cloneId + '/' + subpath + queryString;
          return;
        }
      }

      // 2. If POST form (login, conversation composer, contact, newsletter):
      e.preventDefault();
      e.stopPropagation();

      const isLoginForm = !!form.querySelector('input[type="password"], input[name*="pass" i], input[autocomplete*="password" i]') ||
                          /login|signin|auth/i.test(rawAction) ||
                          /login|signin|auth/i.test(form.id || '') ||
                          /login|signin|auth/i.test(form.className || '');

      if (isLoginForm) {
        if (window.__REBUILT_AUTH_OBSERVER__) {
          window.__REBUILT_AUTH_OBSERVER__.emit('LOGIN_ACTION', {
            formAction: rawAction,
            method,
            timestamp: Date.now()
          });
        }
        showPreviewToast('🔐 Login submitted (Interactive preview mode)');
        return;
      }

      const promptInput = form.querySelector(
        'textarea, input[type=\"text\"]:not([name=\"conversationState\"]):not([type=\"hidden\"]), [data-mobile-composer-prompt], [contenteditable=\"true\"]'
      );
      const promptText = promptInput ? (promptInput.value || promptInput.innerText || '').trim() : '';

      const isChatForm = form.matches('form[data-mobile-composer], [data-conversation-stream-protocol], form[action*=\"conversation\"]') ||
                         !!form.querySelector('[data-composer-submit], [data-mobile-composer-prompt], input[name=\"conversationState\"]');

      if (isChatForm && promptText) {
        if (promptInput.value !== undefined) promptInput.value = '';
        if (promptInput.innerText) promptInput.innerText = '';
        promptInput.style.height = 'auto';

        renderChatSimulation(promptText);
        return;
      }

      // Generic form submission feedback
      showPreviewToast('Form submission received (Simulated in clone preview)');
    }

    document.addEventListener('submit', handleFormSubmit, false);

    // Also wrap programmatic form.submit()
    try {
      const origSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function() {
        const event = new CustomEvent('submit', { bubbles: true, cancelable: true });
        const notCancelled = this.dispatchEvent(event);
        if (notCancelled) {
          origSubmit.call(this);
        }
      };
    } catch (_) {}

    // Escape key closes open dialogs and flyouts
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        closeLoginModal();
        const flyout = document.getElementById('rebuilt-member-flyout');
        if (flyout && flyout.parentNode) flyout.parentNode.removeChild(flyout);

        const dialogs = document.querySelectorAll(
          '.site-popup-overlay, [role="dialog"], [aria-modal="true"], .modal, .popup-overlay, .popup, #preloader2, .header-notification-dialog'
        );
        dialogs.forEach(function(d) { dismissModal(d); });

        const nav = document.getElementById('globalnav');
        if (nav) {
          nav.classList.remove('globalnav-with-flyout-open', 'globalnav-with-menu-open', 'globalnav-with-submenu-open');
          nav.querySelectorAll('.globalnav-item').forEach(function(it) {
            it.classList.remove('globalnav-item-flyout-open');
          });
        }
      }
    }, true);

    // Auto-detect ?login=success in URL
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('login') === 'success') {
        const cId = getCloneId();
        setAuthState(cId, { nickname: 'Rebuilt Member' });
        const cleanUrl = window.location.pathname + window.location.hash;
        if (window.history && window.history.replaceState) {
          origReplace ? origReplace(null, document.title, cleanUrl) : window.history.replaceState(null, document.title, cleanUrl);
        }
        setTimeout(function() {
          showPreviewToast('🎉 Welcome back, Rebuilt Member! Logged in successfully.');
        }, 300);
      }
    } catch (_) {}

    // Initial auth & header state application
    const initCloneId = getCloneId();
    function cleanupRemoteAccountFrames() {
      const frames = document.querySelectorAll('#hyv-account-frame, [id*="hyv-account"], iframe[src*="login-platform"], .mhy-interest-selector, .mhy-dialog.mhy-interest-selector');
      frames.forEach(function(f) {
        if (f.parentNode) f.parentNode.removeChild(f);
      });
    }
    cleanupRemoteAccountFrames();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cleanupRemoteAccountFrames);
    }
    setTimeout(cleanupRemoteAccountFrames, 500);
    setTimeout(cleanupRemoteAccountFrames, 1500);
  })();

  // =========================================================================
  // Rebuilt Instant Preloader & Button/Hyperlink Speculative Navigator
  // When user hovers, touches, or focuses ANY button or link,
  // the target page is proactively pre-rendered & cached so clicking is instantaneous!
  // =========================================================================
  (function setupInstantPreloader() {
    var preloadedUrls = new Set();
    function getCloneId() {
      if (window.__REBUILT_CLONE_ID__) return window.__REBUILT_CLONE_ID__;
      var m = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
      return m ? m[1] : '';
    }

    function extractTarget(elem) {
      if (!elem || typeof elem.closest !== 'function') return null;
      var targetEl = elem.closest('a[href], button[data-href], button[data-url], [data-nav-url], [data-href], [data-url], [role="button"]');
      if (!targetEl) return null;

      var rawHref = targetEl.getAttribute('href') || targetEl.getAttribute('data-href') || targetEl.getAttribute('data-url') || targetEl.getAttribute('data-nav-url');
      if (!rawHref || typeof rawHref !== 'string') return null;
      var href = rawHref.trim();
      if (!href || /^(#|javascript:|mailto:|tel:|sms:|callto:|fax:|data:|blob:)/i.test(href)) return null;

      var cId = getCloneId();
      var prefix = '/clones/' + cId + '/';
      var subpath = '';

      if (href.startsWith(prefix)) {
        subpath = href.slice(prefix.length);
      } else if (href.startsWith('/clones/')) {
        return null;
      } else if (href.startsWith('http://') || href.startsWith('https://')) {
        var orig = window.__REBUILT_ORIGINAL_ORIGIN__ || '';
        if (orig && href.startsWith(orig)) {
          subpath = href.slice(orig.length).replace(new RegExp('^/+'), '');
        } else {
          return null;
        }
      } else if (href.startsWith('/') && !href.startsWith('//')) {
        subpath = href.replace(new RegExp('^/+'), '');
      } else if (!href.startsWith('//')) {
        subpath = href;
      }

      subpath = subpath.split('?')[0].split('#')[0].replace(new RegExp('/+$'), '').trim();
      if (!subpath || /^(#|javascript:|mailto:|tel:|sms:|callto:|fax:|data:|blob:)/i.test(subpath)) return null;
      if (/\\.(css|js|png|jpe?g|gif|svg|webp|ico|mp4|webm|woff2?|ttf|eot|otf|json)$/i.test(subpath)) return null;
      return subpath;
    }

    function preloadSubpath(subpath) {
      if (!subpath || preloadedUrls.has(subpath)) return;
      preloadedUrls.add(subpath);

      var cId = getCloneId();
      if (!cId) return;

      // 1. High-priority prewarm notification to server
      var preloadPing = '/clones/' + encodeURIComponent(cId) + '/__preload?path=' + encodeURIComponent(subpath);
      // 2. Speculatively prefetch the subpage
      var targetPageUrl = '/clones/' + encodeURIComponent(cId) + '/' + subpath;

      // 3. Dynamic Native Browser Speculative Network Acceleration (Native C++ prefetch & preconnect)
      try {
        if (document.head) {
          var prefetchLink = document.createElement('link');
          prefetchLink.rel = 'prefetch';
          prefetchLink.href = targetPageUrl;
          prefetchLink.as = 'document';
          document.head.appendChild(prefetchLink);

          var prerenderLink = document.createElement('link');
          prerenderLink.rel = 'prerender';
          prerenderLink.href = targetPageUrl;
          document.head.appendChild(prerenderLink);
        }
      } catch (_) {}

      if (typeof window.fetch === 'function') {
        fetch(preloadPing, { priority: 'high' }).catch(function(){});
        fetch(targetPageUrl, { priority: 'low' }).catch(function(){});
      }
    }

    // Speculative hover, touchstart, pointerenter on any button or hyperlink
    document.addEventListener('pointerenter', function(e) {
      var sub = extractTarget(e.target);
      if (sub) preloadSubpath(sub);
    }, { passive: true, capture: true });

    document.addEventListener('touchstart', function(e) {
      var sub = extractTarget(e.target);
      if (sub) preloadSubpath(sub);
    }, { passive: true, capture: true });

    document.addEventListener('focusin', function(e) {
      var sub = extractTarget(e.target);
      if (sub) preloadSubpath(sub);
    }, { passive: true, capture: true });

    // Viewport IntersectionObserver to quietly pre-warm visible links
    if ('IntersectionObserver' in window) {
      var linkObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            var sub = extractTarget(entry.target);
            if (sub) preloadSubpath(sub);
            linkObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: '250px' });

      function observeAllClickables() {
        var els = document.querySelectorAll('a[href], button[data-href], button[data-url], [role="button"]');
        for (var i = 0; i < els.length; i++) {
          linkObserver.observe(els[i]);
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeAllClickables);
      } else {
        observeAllClickables();
      }
    }

    // Handle form submissions for interactive web data sharing
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      var action = form.getAttribute('action') || '';
      var method = (form.getAttribute('method') || 'GET').toUpperCase();
      var originalOrigin = window.__REBUILT_ORIGINAL_ORIGIN__ || '';

      if (action.startsWith('http://') || action.startsWith('https://') || action.includes('/api/') || action.includes('/search')) {
        var targetActionUrl = action;
        if (action.startsWith('/') && originalOrigin) {
          targetActionUrl = originalOrigin + action;
        }
        if (targetActionUrl.startsWith('http://') || targetActionUrl.startsWith('https://')) {
          e.preventDefault();
          var formData = new FormData(form);
          var searchParams = new URLSearchParams();
          formData.forEach(function(val, key) { searchParams.append(key, val); });

          if (method === 'GET') {
            var fullUrl = targetActionUrl + (targetActionUrl.includes('?') ? '&' : '?') + searchParams.toString();
            window.location.href = '/api/proxy?url=' + encodeURIComponent(fullUrl);
          } else {
            fetch('/api/proxy?url=' + encodeURIComponent(targetActionUrl), {
              method: method,
              body: searchParams
            }).then(function(r) { return r.text(); }).then(function() {
              if (typeof showPreviewToast === 'function') {
                showPreviewToast('Form data shared with live web server!');
              }
            }).catch(function() {
              if (typeof showPreviewToast === 'function') {
                showPreviewToast('Form processed in preview mode.');
              }
            });
          }
        }
      }
    });

    // ==========================================
    // REBUILT BIDIRECTIONAL COMMUNICATION BRIDGE
    // ==========================================
    (function setupRebuiltCommunicationBridge() {
      if (window.__REBUILT_BRIDGE__) return;

      var cloneMatch = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
      var cloneId = cloneMatch ? cloneMatch[1] : '';

      var bridge = {
        cloneId: cloneId,
        connected: true,
        send: function(action, payload) {
          var msg = {
            action: action,
            payload: payload || {},
            cloneId: cloneId,
            url: window.location.href,
            timestamp: Date.now()
          };

          // 1. Post to parent window (if embedded in preview iframe)
          if (window.parent && window.parent !== window) {
            try {
              window.parent.postMessage({ type: 'rebuilt_bridge_message', action: action, payload: payload, cloneId: cloneId }, '*');
            } catch (_) {}
          }

          // 2. Relay to backend communication bridge
          try {
            fetch('/api/bridge/message', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg),
              keepalive: true
            }).catch(function() {});
          } catch (_) {}
        },
        requestPreload: function(path) {
          if (!path) return;
          this.send('request_preload', { path: path });
        }
      };

      window.__REBUILT_BRIDGE__ = bridge;

      // Speculative on-hover preloading
      document.addEventListener('mouseover', function(e) {
        var target = e.target && e.target.closest ? e.target.closest('a, button, [role="button"]') : null;
        if (!target) return;
        var href = target.getAttribute('href') || target.getAttribute('data-href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
          bridge.requestPreload(href);
        }
      }, { passive: true });

      // Signal page_view interaction on load
      bridge.send('interaction_event', {
        type: 'page_view',
        title: document.title,
        url: window.location.href
      });
    })();

    // ========================================================
    // REBUILT PHASE 1: AUTHENTICATION FLOW OBSERVER & PANEL
    // ========================================================
    (function setupAuthFlowObserver() {
      if (window.__REBUILT_AUTH_OBSERVER__) return;

      var cloneMatch = window.location.pathname.match(new RegExp('/clones/([^/?#]+)'));
      var cloneId = window.__REBUILT_CLONE_ID__ || (cloneMatch ? cloneMatch[1] : '');
      if (!cloneId) return;

      function emitAuthEvent(eventType, payload) {
        try {
          fetch('/api/auth/diagnostic/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cloneId: cloneId, eventType: eventType, payload: payload || {} }),
            keepalive: true
          }).catch(function() {});
        } catch (_) {}
      }

      var observer = {
        cloneId: cloneId,
        emit: emitAuthEvent,
        formDetected: false,
        activeRequest: null
      };
      window.__REBUILT_AUTH_OBSERVER__ = observer;

      // 1. DOM & APPLICATION STATE INSPECTORS
      function getAuthElements() {
        var passwordInput = document.querySelector('input[type="password"]');
        var usernameInput = document.querySelector('input[type="text"], input[type="email"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[autocomplete*="username"]');
        var form = passwordInput ? passwordInput.closest('form') : (usernameInput ? usernameInput.closest('form') : null);

        var submitBtn = null;
        if (form) {
          submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button[name*="login" i], [role="button"][data-testid*="login"], button');
        }
        if (!submitBtn) {
          submitBtn = document.querySelector('button[type="submit"], input[type="submit"], button[name*="login" i], [role="button"][data-testid*="login"], [role="button"][data-testid*="submit"]');
        }

        return {
          usernameInput: usernameInput,
          passwordInput: passwordInput,
          pwInput: passwordInput,
          submitBtn: submitBtn,
          form: form
        };
      }

      function inspectFrameworkState(el) {
        if (!el) return { detected: false, type: 'none', appValuePresent: false, appValueLength: 0, isSynced: true };
        var reactKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'); });
        var propsKey = Object.keys(el).find(function(k) { return k.startsWith('__reactProps$'); });

        if (reactKey || propsKey) {
          var props = propsKey ? el[propsKey] : null;
          var fiber = reactKey ? el[reactKey] : null;
          var propVal = props && typeof props.value !== 'undefined' ? props.value : null;

          var fiberVal = null;
          if (fiber) {
            if (fiber.memoizedProps && typeof fiber.memoizedProps.value !== 'undefined') {
              fiberVal = fiber.memoizedProps.value;
            } else if (fiber.return && fiber.return.memoizedState) {
              var curr = fiber.return.memoizedState;
              while (curr) {
                if (typeof curr.memoizedState === 'string' && curr.memoizedState.length > 0) {
                  fiberVal = curr.memoizedState;
                  break;
                }
                curr = curr.next;
              }
            }
          }

          var trackerVal = null;
          if (el._valueTracker && typeof el._valueTracker.getValue === 'function') {
            trackerVal = el._valueTracker.getValue();
          }

          var appVal = propVal !== null ? propVal : (fiberVal !== null ? fiberVal : trackerVal);
          var domLen = (el.value || '').length;

          if (appVal !== null && typeof appVal !== 'undefined') {
            var sVal = String(appVal);
            var isSynced = (domLen === 0 && sVal.length === 0) || (domLen > 0 && sVal.length > 0);
            return {
              detected: true,
              type: 'react',
              appValuePresent: sVal.length > 0,
              appValueLength: sVal.length,
              isSynced: isSynced,
              details: 'React value length: ' + sVal.length + ' vs DOM length: ' + domLen
            };
          }

          var hasChangeHandler = Boolean(props && props.onChange);
          return {
            detected: true,
            type: 'react',
            appValuePresent: domLen > 0,
            appValueLength: domLen,
            isSynced: !hasChangeHandler || domLen === 0,
            details: 'React component found' + (hasChangeHandler ? ' (controlled onChange)' : ' (uncontrolled)')
          };
        }

        if (el.__vnode) {
          var vVal = el.__vnode.props ? el.__vnode.props.value : null;
          var vDomLen = (el.value || '').length;
          return {
            detected: true,
            type: 'vue',
            appValuePresent: Boolean(vVal),
            appValueLength: vVal ? String(vVal).length : 0,
            isSynced: vVal ? String(vVal).length === vDomLen : vDomLen === 0,
            details: 'Vue vnode detected'
          };
        }

        return {
          detected: false,
          type: 'none',
          appValuePresent: Boolean(el.value),
          appValueLength: (el.value || '').length,
          isSynced: true,
          details: 'Standard HTML DOM'
        };
      }

      function inspectInputElement(el) {
        if (!el) return null;
        var aria = {};
        for (var i = 0; i < el.attributes.length; i++) {
          var a = el.attributes[i];
          if (a.name.startsWith('aria-')) aria[a.name] = a.value;
        }

        var val = el.value || '';
        var valLen = val.length;
        var isValid = true;
        var vMsg = '';
        var validityFlags = {};

        try {
          isValid = el.checkValidity();
          vMsg = el.validationMessage || '';
          if (el.validity) {
            validityFlags = {
              valid: el.validity.valid,
              valueMissing: el.validity.valueMissing,
              tooShort: el.validity.tooShort,
              tooLong: el.validity.tooLong,
              patternMismatch: el.validity.patternMismatch,
              typeMismatch: el.validity.typeMismatch,
              customError: el.validity.customError
            };
          }
        } catch (_) {}

        var fw = inspectFrameworkState(el);

        return {
          tag: el.tagName,
          type: el.getAttribute('type') || el.type || 'text',
          name: el.getAttribute('name') || el.name || '',
          id: el.id || '',
          autocomplete: el.getAttribute('autocomplete') || '',
          required: Boolean(el.required || el.hasAttribute('required')),
          disabled: Boolean(el.disabled || el.hasAttribute('disabled')),
          readOnly: Boolean(el.readOnly || el.hasAttribute('readonly')),
          ariaAttributes: aria,
          valuePresent: valLen > 0,
          valueLength: valLen,
          valid: isValid,
          validity: validityFlags,
          validationMessage: vMsg,
          frameworkState: fw
        };
      }

      function inspectButtonElement(btn) {
        if (!btn) return null;
        var hasDisAttr = btn.hasAttribute('disabled');
        var isDis = Boolean(btn.disabled || hasDisAttr);
        var ariaDis = btn.getAttribute('aria-disabled');
        var isAriaDis = ariaDis === 'true';

        var closestForm = btn.closest('form');
        var formObj = closestForm ? {
          id: closestForm.id || '',
          action: closestForm.getAttribute('action') || '',
          method: (closestForm.getAttribute('method') || 'POST').toUpperCase()
        } : null;

        var hasClick = typeof btn.onclick === 'function' || Boolean(btn.getAttribute('onclick'));
        var propsKey = Object.keys(btn).find(function(k) { return k.startsWith('__reactProps$'); });
        var reactDisProp = null;
        if (propsKey && btn[propsKey]) {
          if (typeof btn[propsKey].onClick === 'function') hasClick = true;
          if (typeof btn[propsKey].disabled !== 'undefined') reactDisProp = Boolean(btn[propsKey].disabled);
        }

        return {
          tag: btn.tagName,
          type: btn.getAttribute('type') || btn.type || 'button',
          disabled: isDis,
          hasDisabledAttr: hasDisAttr,
          ariaDisabled: ariaDis,
          isAriaDisabled: isAriaDis,
          className: btn.className || '',
          formAssociation: btn.getAttribute('form') || null,
          closestForm: formObj,
          hasClickHandler: hasClick,
          reactPropsDisabled: reactDisProp
        };
      }

      function calculateDisableReason(btnData, uData, pData, fValid, fMsg) {
        if (!btnData) return 'NO_BUTTON_FOUND';
        var isBtnDisabled = btnData.disabled || btnData.isAriaDisabled || (btnData.reactPropsDisabled === true);
        if (!isBtnDisabled) return 'BUTTON_NOT_DISABLED';

        if (!uData || !uData.valuePresent) {
          return 'USERNAME_EMPTY: Username field has no value';
        }

        if (!pData || !pData.valuePresent) {
          return 'PASSWORD_EMPTY: Password field has no value';
        }

        if (uData.frameworkState && uData.frameworkState.detected && uData.frameworkState.isSynced === false) {
          return 'STATE_SYNCHRONIZATION_FAILURE: Username DOM has ' + uData.valueLength + ' chars, but application state is EMPTY';
        }
        if (pData.frameworkState && pData.frameworkState.detected && pData.frameworkState.isSynced === false) {
          return 'STATE_SYNCHRONIZATION_FAILURE: Password DOM has ' + pData.valueLength + ' chars, but application state is EMPTY';
        }

        if (pData.valueLength < 6) {
          return 'PASSWORD_TOO_SHORT: Password length is ' + pData.valueLength + ', target requires minimum 6 characters';
        }

        if (uData && !uData.valid) {
          return 'HTML5_VALIDATION_FAILED: Username is invalid (' + (uData.validationMessage || 'constraint mismatch') + ')';
        }
        if (pData && !pData.valid) {
          return 'HTML5_VALIDATION_FAILED: Password is invalid (' + (pData.validationMessage || 'constraint mismatch') + ')';
        }
        if (fValid === false) {
          return 'HTML5_VALIDATION_FAILED: Form checkValidity() is false (' + (fMsg || 'form constraint mismatch') + ')';
        }

        if (btnData.reactPropsDisabled === true) {
          return 'FRAMEWORK_CONDITION_EVALUATED_FALSE: React disabled prop is explicitly true';
        }

        return 'DISABLE_REASON: UNKNOWN';
      }

      // Run deep inspection and broadcast to server & UI
      function runFullInspection() {
        var els = getAuthElements();
        if (!els.pwInput && !els.usernameInput) return null;

        var uData = inspectInputElement(els.usernameInput);
        var pData = inspectInputElement(els.passwordInput);
        var bData = inspectButtonElement(els.submitBtn);

        var fValid = true;
        var fMsg = '';
        if (els.form) {
          try {
            fValid = els.form.checkValidity();
            fMsg = els.form.validationMessage || '';
          } catch (_) {}
        }

        var dReason = calculateDisableReason(bData, uData, pData, fValid, fMsg);

        var inspectionData = {
          inputs: {
            username: uData,
            password: pData
          },
          button: bData,
          validation: {
            formCheckValidity: fValid,
            usernameValid: uData ? uData.valid : true,
            passwordValid: pData ? pData.valid : true,
            formValid: fValid && (uData ? uData.valid : true) && (pData ? pData.valid : true),
            reasons: fMsg ? [fMsg] : []
          },
          stateSync: {
            usernameSynced: uData && uData.frameworkState ? uData.frameworkState.isSynced !== false : true,
            passwordSynced: pData && pData.frameworkState ? pData.frameworkState.isSynced !== false : true,
            overallSynced: (uData && uData.frameworkState ? uData.frameworkState.isSynced !== false : true) && (pData && pData.frameworkState ? pData.frameworkState.isSynced !== false : true)
          },
          buttonDisabled: bData ? bData.disabled : false,
          disableReason: dReason
        };

        observer.formDetected = true;
        emitAuthEvent('FORM_INSPECTION', inspectionData);
        return inspectionData;
      }

      // 2. INPUT EVENT TRACING
      var tracedInputs = new WeakSet();
      function traceInputEvents(inputEl, fieldName) {
        if (!inputEl || tracedInputs.has(inputEl)) return;
        tracedInputs.add(inputEl);

        ['focus', 'input', 'change', 'blur', 'keydown', 'keyup'].forEach(function(evName) {
          inputEl.addEventListener(evName, function(e) {
            emitAuthEvent('INPUT_EVENT_TRACE', {
              field: fieldName,
              event: evName,
              timestamp: Date.now(),
              valuePresent: Boolean(inputEl.value),
              valueLength: (inputEl.value || '').length,
              isTrusted: Boolean(e.isTrusted)
            });
            setTimeout(runFullInspection, 50);
          }, { passive: true });
        });
      }

      function attachTracers() {
        var els = getAuthElements();
        if (els.usernameInput) traceInputEvents(els.usernameInput, 'username');
        if (els.passwordInput) traceInputEvents(els.passwordInput, 'password');

        if (els.submitBtn && 'MutationObserver' in window) {
          try {
            var mo = new MutationObserver(function() {
              setTimeout(runFullInspection, 50);
            });
            mo.observe(els.submitBtn, { attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'class'] });
          } catch (_) {}
        }
      }

      // Initial execution
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          runFullInspection();
          attachTracers();
        });
      } else {
        runFullInspection();
        attachTracers();
      }
      setTimeout(runFullInspection, 800);
      setTimeout(runFullInspection, 2500);

      // 3. LOGIN ACTION & CLICK DETECTION (INCLUDING DISABLED BUTTON CLICKS)
      document.addEventListener('pointerdown', function(e) {
        var els = getAuthElements();
        var btn = els.submitBtn;
        if (!btn) return;
        var rect = btn.getBoundingClientRect();
        var isWithin = (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        );
        var targetIsBtn = (e.target === btn || (btn.contains && btn.contains(e.target)));
        if (targetIsBtn || isWithin) {
          var isDis = Boolean(btn.disabled || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true');
          emitAuthEvent('BUTTON_CLICK_ATTEMPT', {
            buttonTag: btn.tagName ? btn.tagName.toLowerCase() : 'button',
            buttonDisabled: isDis,
            isAriaDisabled: btn.getAttribute('aria-disabled') === 'true',
            hasDisabledAttr: btn.hasAttribute('disabled'),
            hasClickHandler: typeof btn.onclick === 'function' || Boolean(btn.getAttribute('onclick')),
            blockedByDisabledState: isDis,
            clientX: e.clientX,
            clientY: e.clientY
          });
          if (isDis) {
            emitAuthEvent('CLICK_BLOCKED_BY_DISABLED_STATE', {
              reason: 'CLICK_BLOCKED_BY_DISABLED_STATE: Login button has disabled attribute or aria-disabled=true'
            });
          }
          setTimeout(runFullInspection, 50);
        }
      }, true);

      document.addEventListener('submit', function(e) {
        var form = e.target;
        var hasPw = form && form.querySelector ? form.querySelector('input[type="password"]') : null;
        if (hasPw) {
          emitAuthEvent('FORM_SUBMIT_ATTEMPT', {
            formId: form.id || null,
            submitFired: true
          });
          emitAuthEvent('LOGIN_ACTION', {
            trigger: 'form_submit',
            formId: form.id || null,
            submitterType: 'form'
          });
          setTimeout(runFullInspection, 50);
        }
      }, true);

      document.addEventListener('click', function(e) {
        var btn = e.target && e.target.closest ? e.target.closest('button, [role="button"], input[type="submit"]') : null;
        if (!btn) return;
        var text = (btn.innerText || btn.value || '').toLowerCase();
        var isLoginBtn = (text.indexOf('login') !== -1 || text.indexOf('log in') !== -1 || text.indexOf('sign in') !== -1 || text.indexOf('signin') !== -1 || text.indexOf('submit') !== -1 || text.indexOf('continue') !== -1);
        var inAuthForm = btn.closest('form') && btn.closest('form').querySelector('input[type="password"]');
        if (isLoginBtn || inAuthForm) {
          emitAuthEvent('BUTTON_CLICK_ATTEMPT', {
            buttonTag: btn.tagName ? btn.tagName.toLowerCase() : 'button',
            buttonDisabled: false,
            isAriaDisabled: false,
            hasDisabledAttr: false,
            hasClickHandler: typeof btn.onclick === 'function' || Boolean(btn.getAttribute('onclick')),
            blockedByDisabledState: false
          });
          emitAuthEvent('LOGIN_ACTION', {
            trigger: 'button_click',
            submitterType: btn.tagName ? btn.tagName.toLowerCase() : 'button'
          });
          setTimeout(runFullInspection, 50);
        }
      }, true);

      // 4. SESSION DETECTION
      var currentPath = window.location.pathname;
      function checkSessionState() {
        var logoutBtn = document.querySelector('a[href*="logout" i], button[data-testid*="logout" i], [aria-label*="log out" i], a[href*="signout" i]');
        var dashboardEl = document.querySelector('[data-testid*="dashboard" i], .dashboard, #dashboard, .feed, [role="feed"]');
        var pwStillPresent = Boolean(document.querySelector('input[type="password"]'));

        if (logoutBtn || (dashboardEl && !pwStillPresent)) {
          emitAuthEvent('SESSION_STATE_CHANGE', {
            previousRoute: currentPath,
            currentRoute: window.location.pathname,
            formDisappeared: !pwStillPresent,
            dashboardVisible: Boolean(dashboardEl),
            logoutControlFound: Boolean(logoutBtn),
            authenticatedState: true,
            observableIndicators: [
              logoutBtn ? 'logout_control_visible' : null,
              dashboardEl ? 'dashboard_container_visible' : null,
              !pwStillPresent ? 'login_form_disappeared' : null
            ].filter(Boolean)
          });
        }
      }
      window.addEventListener('popstate', checkSessionState);
      window.addEventListener('hashchange', checkSessionState);
      setTimeout(checkSessionState, 2000);

      // 5. EMBEDDED LIVE AUTH DIAGNOSTICS UI (STEP 10 DEVELOPER PANEL: AUTH TRACE)
      function injectDiagnosticPanel() {
        if (document.getElementById('rebuilt-auth-diagnostic-panel')) return;
        var panel = document.createElement('div');
        panel.id = 'rebuilt-auth-diagnostic-panel';
        panel.innerHTML = [
          '<style>',
          '#rebuilt-auth-diagnostic-panel { position: fixed; bottom: 16px; right: 16px; z-index: 2147483647; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: #f1f5f9; max-width: 440px; line-height: 1.4; }',
          '.rad-badge { background: #090d16; border: 1px solid #334155; border-radius: 8px; padding: 8px 12px; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 8px; font-weight: 600; }',
          '.rad-badge:hover { border-color: #38bdf8; background: #1e293b; }',
          '.rad-card { display: none; background: #090d16; border: 1px solid #1e293b; border-radius: 10px; padding: 14px; box-shadow: 0 12px 36px rgba(0,0,0,0.7); margin-bottom: 8px; max-height: 520px; overflow-y: auto; }',
          '.rad-card.open { display: block; }',
          '.rad-head { font-size: 12px; font-weight: 800; color: #38bdf8; letter-spacing: 0.05em; display: flex; justify-content: space-between; margin-bottom: 8px; }',
          '.rad-section-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 10px; margin-bottom: 4px; border-bottom: 1px solid #1e293b; padding-bottom: 2px; }',
          '.rad-row { display: flex; justify-content: space-between; padding: 2px 0; }',
          '.rad-pass { color: #34d399; font-weight: bold; }',
          '.rad-fail { color: #f87171; font-weight: bold; }',
          '.rad-pend { color: #64748b; font-weight: bold; }',
          '.rad-alert-box { margin-top: 10px; padding: 8px 10px; border-radius: 6px; background: #0f172a; border-left: 3px solid #f59e0b; }',
          '.rad-alert-title { font-weight: 800; font-size: 11px; color: #fbbf24; }',
          '.rad-alert-desc { font-size: 11px; color: #cbd5e1; margin-top: 2px; word-break: break-word; }',
          '.rad-tabs { display: flex; gap: 4px; margin-top: 10px; border-bottom: 1px solid #1e293b; padding-bottom: 6px; }',
          '.rad-tab-btn { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; font-size: 10px; padding: 3px 8px; border-radius: 4px; cursor: pointer; }',
          '.rad-tab-btn.active { background: #38bdf8; color: #090d16; font-weight: bold; }',
          '.rad-detail-view { margin-top: 6px; font-size: 10px; background: #050811; border: 1px solid #1e293b; border-radius: 4px; padding: 8px; max-height: 140px; overflow-y: auto; color: #94a3b8; font-family: ui-monospace, monospace; white-space: pre-wrap; }',
          '.rad-btn-row { margin-top: 10px; display: flex; gap: 6px; }',
          '.rad-btn { flex: 1; padding: 6px; font-size: 10px; font-weight: 700; border-radius: 4px; border: 1px solid #334155; background: #1e293b; color: #f8fafc; cursor: pointer; text-align: center; }',
          '.rad-btn:hover { background: #334155; }',
          '.rad-btn-secondary { background: #0f172a; border-color: #334155; color: #38bdf8; }',
          '</style>',
          '<div class="rad-card" id="radCard">',
          '  <div class="rad-head"><span>AUTH TRACE</span><span style="cursor:pointer;" id="radClose">✕</span></div>',
          '  <div class="rad-section-title">LIVE EXECUTION TRACE</div>',
          '  <div id="radPipelineTrace" style="margin: 4px 0; line-height: 1.5;">',
          '    <div class="rad-row"><span><span id="stDom" class="rad-pend">[ ]</span> DOM values detected</span><span id="dtDom" style="color:#94a3b8; font-size:10px;">-</span></div>',
          '    <div class="rad-row"><span><span id="stApp" class="rad-pend">[ ]</span> Application state detected</span><span id="dtApp" style="color:#94a3b8; font-size:10px;">-</span></div>',
          '    <div class="rad-row"><span><span id="stVal" class="rad-pend">[ ]</span> Form validation</span><span id="dtVal" style="color:#94a3b8; font-size:10px;">-</span></div>',
          '    <div class="rad-row"><span><span id="stBtn" class="rad-pend">[ ]</span> Login button</span><span id="dtBtn" style="color:#94a3b8; font-size:10px;">-</span></div>',
          '    <div class="rad-row"><span><span id="stClk" class="rad-pend">[ ]</span> Click</span><span id="dtClk" style="color:#94a3b8; font-size:10px;">-</span></div>',
          '    <div class="rad-row"><span><span id="stSub" class="rad-pend">[ ]</span> Submit</span><span id="dtSub" style="color:#94a3b8; font-size:10px;">-</span></div>',
          '    <div class="rad-row"><span><span id="stNet" class="rad-pend">[ ]</span> Network</span><span id="dtNet" style="color:#94a3b8; font-size:10px;">-</span></div>',
          '    <div class="rad-row"><span><span id="stBrg" class="rad-pend">[ ]</span> Bridge</span><span id="dtBrg" style="color:#94a3b8; font-size:10px;">-</span></div>',
          '    <div class="rad-row"><span><span id="stTgt" class="rad-pend">[ ]</span> Target</span><span id="dtTgt" style="color:#94a3b8; font-size:10px;">-</span></div>',
          '    <div class="rad-row"><span><span id="stSes" class="rad-pend">[ ]</span> Session</span><span id="dtSes" style="color:#94a3b8; font-size:10px;">-</span></div>',
          '  </div>',
          '  <div class="rad-alert-box" id="radAlertBox">',
          '    <div class="rad-alert-title">FIRST FAILURE: <span id="radFirstFailure" style="color:#fbbf24;">NONE</span></div>',
          '    <div class="rad-alert-desc" style="margin-top:4px;"><strong>REASON:</strong> <span id="radFirstReason">Analyzing form inputs...</span></div>',
          '  </div>',
          '  <div class="rad-tabs">',
          '    <button class="rad-tab-btn active" id="tabTrace">Trace</button>',
          '    <button class="rad-tab-btn" id="tabInputs">Inputs</button>',
          '    <button class="rad-tab-btn" id="tabButton">Button</button>',
          '    <button class="rad-tab-btn" id="tabEvents">Events</button>',
          '    <button class="rad-tab-btn" id="tabCompare">Typing Test</button>',
          '  </div>',
          '  <div class="rad-detail-view" id="radDetailContent">Inspecting login flow...</div>',
          '  <div class="rad-btn-row">',
          '    <button class="rad-btn rad-btn-secondary" id="radTestTyping">Test Manual Typing</button>',
          '    <button class="rad-btn rad-btn-secondary" id="radTestAutofill">Test Autofill</button>',
          '  </div>',
          '  <div class="rad-btn-row">',
          '    <button class="rad-btn" id="radRefresh">Inspect Now</button>',
          '    <button class="rad-btn" id="radReset">Reset Test</button>',
          '  </div>',
          '</div>',
          '<div class="rad-badge" id="radBadge">',
          '  <span style="color:#38bdf8;">⚡</span>',
          '  <span>AUTH TRACE</span>',
          '  <span id="radBadgeStatus" style="font-size:10px; background:#1e293b; padding:2px 6px; border-radius:4px; margin-left:auto;">INSPECTING</span>',
          '</div>'
        ].join('');

        document.body.appendChild(panel);

        var card = document.getElementById('radCard');
        var badge = document.getElementById('radBadge');
        var close = document.getElementById('radClose');
        var refreshBtn = document.getElementById('radRefresh');
        var resetBtn = document.getElementById('radReset');
        var testTypingBtn = document.getElementById('radTestTyping');
        var testAutofillBtn = document.getElementById('radTestAutofill');

        var tabTrace = document.getElementById('tabTrace');
        var tabInputs = document.getElementById('tabInputs');
        var tabButton = document.getElementById('tabButton');
        var tabEvents = document.getElementById('tabEvents');
        var tabCompare = document.getElementById('tabCompare');
        var detailView = document.getElementById('radDetailContent');

        var activeTab = 'trace';
        var latestDiagnosticData = null;

        function setActiveTab(tab) {
          activeTab = tab;
          [tabTrace, tabInputs, tabButton, tabEvents, tabCompare].forEach(function(t) { if (t) t.classList.remove('active'); });
          if (tab === 'trace' && tabTrace) tabTrace.classList.add('active');
          if (tab === 'inputs' && tabInputs) tabInputs.classList.add('active');
          if (tab === 'button' && tabButton) tabButton.classList.add('active');
          if (tab === 'events' && tabEvents) tabEvents.classList.add('active');
          if (tab === 'compare' && tabCompare) tabCompare.classList.add('active');
          renderDetailView();
        }

        if (tabTrace) tabTrace.addEventListener('click', function() { setActiveTab('trace'); });
        if (tabInputs) tabInputs.addEventListener('click', function() { setActiveTab('inputs'); });
        if (tabButton) tabButton.addEventListener('click', function() { setActiveTab('button'); });
        if (tabEvents) tabEvents.addEventListener('click', function() { setActiveTab('events'); });
        if (tabCompare) tabCompare.addEventListener('click', function() { setActiveTab('compare'); });

        badge.addEventListener('click', function() {
          card.classList.toggle('open');
          if (card.classList.contains('open')) updateDiagnosticUI();
        });
        close.addEventListener('click', function() { card.classList.remove('open'); });

        function setCheck(id, pass) {
          var el = document.getElementById(id);
          if (!el) return;
          el.innerText = pass ? '✓' : '✕';
          el.className = pass ? 'rad-pass' : 'rad-fail';
        }

        function renderDetailView() {
          if (!latestDiagnosticData) {
            detailView.innerText = 'No diagnostic data captured yet.';
            return;
          }
          var insp = latestDiagnosticData.inspection;

          if (activeTab === 'trace') {
            if (latestDiagnosticData.panelReadout) {
              detailView.innerText = latestDiagnosticData.panelReadout;
            } else {
              detailView.innerText = 'First Failure: ' + (latestDiagnosticData.firstFailure || 'NONE') + '\\nReason: ' + (latestDiagnosticData.firstFailureReason || latestDiagnosticData.reason || 'None');
            }
          } else if (activeTab === 'inputs') {
            if (!insp || !insp.inputs) {
              detailView.innerText = 'No inputs detected.';
              return;
            }
            var u = insp.inputs.username;
            var p = insp.inputs.password;
            var lines = [];
            if (u) {
              lines.push('[USERNAME INPUT]');
              lines.push('  tag=' + u.tag + ' type=' + u.type + ' name=' + u.name + ' id=' + u.id);
              lines.push('  required=' + u.required + ' disabled=' + u.disabled + ' readonly=' + u.readOnly);
              lines.push('  DOM valuePresent=' + u.valuePresent + ' (len: ' + u.valueLength + ')');
              lines.push('  valid=' + u.valid + (u.validationMessage ? ' (' + u.validationMessage + ')' : ''));
              if (u.frameworkState && u.frameworkState.detected) {
                lines.push('  Framework (' + u.frameworkState.type + '): appValuePresent=' + u.frameworkState.appValuePresent + ' (len: ' + u.frameworkState.appValueLength + ') synced=' + u.frameworkState.isSynced);
              }
            }
            if (p) {
              lines.push('');
              lines.push('[PASSWORD INPUT]');
              lines.push('  tag=' + p.tag + ' type=' + p.type + ' name=' + p.name + ' id=' + p.id);
              lines.push('  required=' + p.required + ' disabled=' + p.disabled + ' readonly=' + p.readOnly);
              lines.push('  DOM valuePresent=' + p.valuePresent + ' (len: ' + p.valueLength + ')');
              lines.push('  valid=' + p.valid + (p.validationMessage ? ' (' + p.validationMessage + ')' : ''));
              if (p.frameworkState && p.frameworkState.detected) {
                lines.push('  Framework (' + p.frameworkState.type + '): appValuePresent=' + p.frameworkState.appValuePresent + ' (len: ' + p.frameworkState.appValueLength + ') synced=' + p.frameworkState.isSynced);
              }
            }
            detailView.innerText = lines.join('\\n');
          } else if (activeTab === 'button') {
            if (!insp || !insp.button) {
              detailView.innerText = 'No login button detected.';
              return;
            }
            var b = insp.button;
            var bLines = [];
            bLines.push('[LOGIN BUTTON]');
            bLines.push('  tag=' + b.tag + ' type=' + b.type);
            bLines.push('  disabled=' + b.disabled + ' (hasDisabledAttr=' + b.hasDisabledAttr + ')');
            bLines.push('  aria-disabled=' + b.ariaDisabled + ' (isAriaDisabled=' + b.isAriaDisabled + ')');
            bLines.push('  class="' + b.className + '"');
            bLines.push('  closestForm=' + (b.closestForm ? (b.closestForm.id || b.closestForm.action || 'form') : 'none'));
            bLines.push('  hasClickHandler=' + b.hasClickHandler);
            bLines.push('  reactPropsDisabled=' + b.reactPropsDisabled);
            bLines.push('');
            bLines.push('[DETECTED DISABLE REASON]');
            bLines.push('  ' + (insp.disableReason || 'none'));
            detailView.innerText = bLines.join('\\n');
          } else if (activeTab === 'events') {
            var evts = latestDiagnosticData.inputEvents || [];
            if (evts.length === 0) {
              detailView.innerText = 'No input events recorded yet. Focus or type in fields.';
              return;
            }
            detailView.innerText = evts.map(function(ev) {
              var d = new Date(ev.timestamp);
              var tStr = d.toTimeString().split(' ')[0];
              return tStr + ' ' + ev.field.toUpperCase() + ' ' + ev.event.toUpperCase() + ' (len: ' + ev.valueLength + ', trusted: ' + ev.isTrusted + ')';
            }).join('\\n');
          } else if (activeTab === 'compare') {
            var tt = latestDiagnosticData.typingTest;
            if (!tt) {
              detailView.innerText = 'Click "Test Manual Typing" or "Test Autofill" below to run the comparison.';
              return;
            }
            var cLines = [];
            cLines.push('MANUAL INPUT:');
            cLines.push('  DOM value:      ' + (tt.manual.domValue ? '✓' : '✕'));
            cLines.push('  App state:      ' + (tt.manual.appState ? '✓' : '✕'));
            cLines.push('  Form valid:     ' + (tt.manual.formValid ? '✓' : '✕'));
            cLines.push('  Button enabled: ' + (tt.manual.buttonEnabled ? '✓' : '✕'));
            cLines.push('');
            cLines.push('AUTOFILL:');
            cLines.push('  DOM value:      ' + (tt.autofill.domValue ? '✓' : '✕'));
            cLines.push('  App state:      ' + (tt.autofill.appState ? '✓' : '✕'));
            cLines.push('  Form valid:     ' + (tt.autofill.formValid ? '✓' : '✕'));
            cLines.push('  Button enabled: ' + (tt.autofill.buttonEnabled ? '✓' : '✕'));
            cLines.push('');
            cLines.push('SUMMARY:');
            cLines.push('  ' + tt.comparisonSummary);
            detailView.innerText = cLines.join('\\n');
          }
        }

        function updateDiagnosticUI() {
          runFullInspection();
          fetch('/api/auth/diagnostic/' + encodeURIComponent(cloneId))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (!data) return;
              latestDiagnosticData = data;

              function updatePipelineStage(stId, dtId, stage) {
                var stEl = document.getElementById(stId);
                var dtEl = document.getElementById(dtId);
                if (!stEl) return;
                var status = stage ? stage.status : '-';
                if (status === '✓') {
                  stEl.innerText = '[✓]';
                  stEl.className = 'rad-pass';
                } else if (status === '✕') {
                  stEl.innerText = '[✕]';
                  stEl.className = 'rad-fail';
                } else {
                  stEl.innerText = '[ ]';
                  stEl.className = 'rad-pend';
                }
                if (dtEl && stage && stage.details) {
                  dtEl.innerText = stage.details;
                }
              }

              var p = data.pipeline || {};
              updatePipelineStage('stDom', 'dtDom', p.dom);
              updatePipelineStage('stApp', 'dtApp', p.appState);
              updatePipelineStage('stVal', 'dtVal', p.validation);
              updatePipelineStage('stBtn', 'dtBtn', p.button);
              updatePipelineStage('stClk', 'dtClk', p.click);
              updatePipelineStage('stSub', 'dtSub', p.submit);
              updatePipelineStage('stNet', 'dtNet', p.network);
              updatePipelineStage('stBrg', 'dtBrg', p.bridge);
              updatePipelineStage('stTgt', 'dtTgt', p.target);
              updatePipelineStage('stSes', 'dtSes', p.session);

              var ffEl = document.getElementById('radFirstFailure');
              var frEl = document.getElementById('radFirstReason');
              var badgeStatus = document.getElementById('radBadgeStatus');

              if (ffEl) ffEl.innerText = data.firstFailure || 'NONE';
              if (frEl) frEl.innerText = data.firstFailureReason || data.reason || 'Analyzing form inputs...';

              if (badgeStatus) {
                if (data.firstFailure && data.firstFailure !== 'NONE') {
                  badgeStatus.innerText = data.firstFailure;
                  badgeStatus.style.background = '#dc2626';
                } else {
                  badgeStatus.innerText = 'READY';
                  badgeStatus.style.background = '#059669';
                }
              }

              renderDetailView();
            }).catch(function() {});
        }

        // Test manual typing simulation
        testTypingBtn.addEventListener('click', function() {
          var els = getAuthElements();
          if (!els.usernameInput || !els.passwordInput) return;

          // Dispatch simulated manual keystrokes with React valueTracker bypass
          function simulateType(inputEl, str) {
            var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (nativeSetter && nativeSetter.set) {
              nativeSetter.set.call(inputEl, str);
            } else {
              inputEl.value = str;
            }
            if (inputEl._valueTracker) inputEl._valueTracker.setValue('__prev__');
            inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          }

          simulateType(els.usernameInput, 'test_user');
          simulateType(els.passwordInput, 'ValidPassword123');

          setTimeout(function() {
            var insp = runFullInspection();
            var bDisabled = insp ? insp.buttonDisabled : true;
            emitAuthEvent('TEST_MANUAL_TYPING', {
              manual: { domValue: true, appState: true, formValid: true, buttonEnabled: !bDisabled },
              autofill: { domValue: true, appState: false, formValid: false, buttonEnabled: false },
              comparisonSummary: bDisabled ? 'Manual typing did not enable button (check minlength/validation).' : 'Manual typing successfully synchronized state and enabled the button.'
            });
            setActiveTab('compare');
            updateDiagnosticUI();
          }, 300);
        });

        // Test autofill simulation
        testAutofillBtn.addEventListener('click', function() {
          var els = getAuthElements();
          if (!els.usernameInput || !els.passwordInput) return;

          // Simulates browser autofill: sets property without full trusted React input sequence
          els.usernameInput.value = 'test_user';
          els.passwordInput.value = 'ValidPassword123';
          els.passwordInput.focus();

          setTimeout(function() {
            var insp = runFullInspection();
            var bDisabled = insp ? insp.buttonDisabled : true;
            emitAuthEvent('TEST_MANUAL_TYPING', {
              manual: { domValue: true, appState: true, formValid: true, buttonEnabled: true },
              autofill: { domValue: true, appState: !bDisabled, formValid: !bDisabled, buttonEnabled: !bDisabled },
              comparisonSummary: 'Autofill population observed with button disabled: ' + (bDisabled ? 'CONFIRMED' : 'NO')
            });
            setActiveTab('compare');
            updateDiagnosticUI();
          }, 300);
        });

        refreshBtn.addEventListener('click', updateDiagnosticUI);
        resetBtn.addEventListener('click', function() {
          fetch('/api/auth/diagnostic/' + encodeURIComponent(cloneId) + '/reset', { method: 'POST' })
            .then(function() { updateDiagnosticUI(); })
            .catch(function() {});
        });

        setInterval(function() {
          if (card.classList.contains('open')) updateDiagnosticUI();
        }, 2000);
      }

      if (document.body) {
        injectDiagnosticPanel();
      } else {
        document.addEventListener('DOMContentLoaded', injectDiagnosticPanel);
      }
    })();

    // =========================================================================
    // 5. HIGH-FIDELITY VIDEO, MEDIA & ANIMATION HYDRATION ENGINE
    // =========================================================================
    (function setupMediaAndAnimationHydrator() {
      function hydrateVideos() {
        const videos = document.querySelectorAll('video');
        videos.forEach(function(v) {
          try {
            const isControlled = v.hasAttribute('controls') || v.dataset.interactive === 'true' || v.classList.contains('interactive-video');
            v.setAttribute('playsinline', '');
            v.setAttribute('webkit-playsinline', '');
            v.setAttribute('preload', 'auto');
            v.setAttribute('data-gpu-accelerated', 'true');
            if (!v.getAttribute('crossorigin')) {
              v.setAttribute('crossorigin', 'anonymous');
            }

            // 1. Enforce browser autoplay policy requirements ONLY on ambient background videos
            if (!isControlled) {
              v.setAttribute('autoplay', '');
              v.setAttribute('muted', '');
              v.setAttribute('loop', '');
              v.muted = true;
              v.defaultMuted = true;
            }

            // 2. Resolve missing src from data attributes or child sources
            if (!v.src || v.src.startsWith('blob:') || v.src.startsWith('data:')) {
              const lazySrc = v.getAttribute('data-src') ||
                              v.getAttribute('data-video-src') ||
                              v.getAttribute('data-lazy-src') ||
                              v.getAttribute('data-media-src') ||
                              v.getAttribute('data-url');
              if (lazySrc) {
                v.src = lazySrc;
              } else {
                const srcEl = v.querySelector('source[src]');
                if (srcEl && srcEl.src) {
                  v.src = srcEl.src;
                }
              }
            }

            // 3. Resilient Error Handling & Live Proxy Fallback
            v.addEventListener('error', function() {
              if (window.__REBUILT_ORIGINAL_ORIGIN__ && v.src && !v.dataset.retriedProxy) {
                v.dataset.retriedProxy = 'true';
                var orig = window.__REBUILT_ORIGINAL_ORIGIN__;
                var currentSrc = v.src;
                var match = currentSrc.match(new RegExp('/clones/[^/]+/(.*)$'));
                if (match && match[1]) {
                  v.src = orig.replace(new RegExp('/+$'), '') + '/' + match[1].replace(new RegExp('^/+'), '');
                  v.load();
                  if (!isControlled) v.play().catch(function() {});
                  return;
                }
              }
              if (v.poster) {
                v.style.backgroundImage = 'url("' + v.poster + '")';
                v.style.backgroundSize = 'cover';
                v.style.backgroundPosition = 'center';
              }
            });

            // 4. Fallback: If video src still missing but poster exists, show poster
            if (v.poster && (!v.src || v.error)) {
              v.style.backgroundImage = 'url("' + v.poster + '")';
              v.style.backgroundSize = 'cover';
              v.style.backgroundPosition = 'center';
            }

            // 5. When video starts playing, fade out start-frame poster so actual video is visible
            v.addEventListener('playing', function() {
              const wrapper = v.closest('.inline-media-wrapper, .media-wrapper, .video-container, .hero-media, div');
              if (wrapper) {
                const poster = wrapper.querySelector('.start-frame, picture.start-frame, .picture-startframe');
                if (poster) {
                  poster.style.opacity = '0';
                  poster.style.pointerEvents = 'none';
                  poster.style.transition = 'opacity 0.4s ease';
                }
              }
            });

            // 6. Interactive Scrubber Sync (Apple-style presentation canvas / scrubbers)
            v.addEventListener('seeked', function() {
              window.dispatchEvent(new CustomEvent('rebuilt:video-seeked', { detail: { video: v, time: v.currentTime } }));
            });

            // 7. Prime playback for ambient background videos only
            if (!isControlled) {
              const playPromise = v.play();
              if (playPromise !== undefined) {
                playPromise.catch(function() {
                  const onInteract = function() {
                    v.play().catch(function() {});
                    window.removeEventListener('click', onInteract);
                    window.removeEventListener('touchstart', onInteract);
                    window.removeEventListener('scroll', onInteract);
                  };
                  window.addEventListener('click', onInteract, { once: true, passive: true });
                  window.addEventListener('touchstart', onInteract, { once: true, passive: true });
                  window.addEventListener('scroll', onInteract, { once: true, passive: true });
                });
              }
            }
          } catch (_) {}
        });

        // Also hydrate child sources in picture/video
        document.querySelectorAll('source').forEach(function(s) {
          try {
            const lazy = s.getAttribute('data-src') || s.getAttribute('data-lazy-src') || s.getAttribute('data-srcset');
            if (lazy && !s.src && !s.srcset) {
              if (s.parentElement && s.parentElement.tagName === 'VIDEO') {
                s.src = lazy;
              } else {
                s.srcset = lazy;
              }
            }
          } catch (_) {}
        });

        // Ensure background video wrapper elements are visible initially
        document.querySelectorAll(
          '.inline-media-wrapper picture, .inline-media-wrapper .start-frame, .picture-startframe, .video-poster-img, .video-bg, [data-video-bg], .video-background, .bg-video, .hero-video'
        ).forEach(function(el) {
          el.style.display = 'block';
          el.style.visibility = 'visible';
          el.style.opacity = '1';
        });
      }

      function hydrateAnimations() {
        // 1. Kickstart ScrollTrigger, IntersectionObserver, and AOS animations
        // Dispatch synthetic scroll and resize events so elements in/near viewport trigger entrance
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));

        // 2. Unpause and advance GSAP timelines if present
        try {
          if (window.gsap && window.gsap.globalTimeline && window.gsap.globalTimeline.paused()) {
            window.gsap.globalTimeline.play();
          }
          if (window.ScrollTrigger && typeof window.ScrollTrigger.refresh === 'function') {
            window.ScrollTrigger.refresh();
          }
        } catch (_) {}

        // 3. Unfreeze CSS keyframes and transitions for reveal elements
        const animStyle = document.createElement('style');
        animStyle.id = 'rebuilt-anim-unfreeze';
        animStyle.textContent = \`
          [data-aos] {
            opacity: 1 !important;
            transform: none !important;
            transition-property: opacity, transform !important;
          }
          .wow {
            visibility: visible !important;
          }
          .split-lines, .split-line, .split-char, .char, .word, .line {
            opacity: 1 !important;
            visibility: visible !important;
          }
        \`;
        if (document.head && !document.getElementById('rebuilt-anim-unfreeze')) {
          document.head.appendChild(animStyle);
        }

        // 4. Re-check requestAnimationFrame loop health
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(function() {});
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          hydrateVideos();
          hydrateAnimations();
        });
      } else {
        hydrateVideos();
        hydrateAnimations();
      }

      window.addEventListener('load', function() {
        hydrateVideos();
        hydrateAnimations();
        setTimeout(function() {
          hydrateVideos();
          hydrateAnimations();
        }, 500);
      });
    })();
  })();
  </script>
`;

/**
 * Priority override styles injected right before </head> to guarantee cascade dominance
 * over any external or inlined stylesheets loaded earlier in the page.
 */
const REBUILT_PRIORITY_STYLES = `
  <!-- Rebuilt Priority Override Stylesheet (Guaranteed Cascade Dominance) -->
  <style id="rebuilt-priority-overrides">
    /* Universal Real Apple Globalnav Styling & Layout Preservation */
    @media (min-width: 834px) {
      html body #globalnav {
        position: relative !important;
        height: 44px !important;
        max-height: 44px !important;
        width: 100% !important;
        z-index: 9999 !important;
        background: rgba(22, 22, 23, 0.8) !important;
        backdrop-filter: saturate(180%) blur(20px) !important;
        -webkit-backdrop-filter: saturate(180%) blur(20px) !important;
      }
      html.ac-ls-visible body #globalnav {
        top: var(--r-localeswitcher-height, 0px) !important;
      }
      html body #globalnav .globalnav-content {
        max-width: 1024px !important;
        width: 100% !important;
        margin: 0 auto !important;
        height: 100% !important;
        padding: 0 22px !important;
        box-sizing: border-box !important;
      }
      html body #globalnav .globalnav-list {
        display: flex !important;
        flex-direction: row !important;
        justify-content: space-between !important;
        align-items: center !important;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        list-style: none !important;
      }
      /* CRITICAL: display: contents enables all 14 items to participate directly in space-between flex */
      html body #globalnav .globalnav-menu,
      html body #globalnav .globalnav-menu > .globalnav-flyout,
      html body #globalnav .globalnav-menu-list {
        display: contents !important;
        flex-direction: row !important;
        width: auto !important;
        height: auto !important;
        position: static !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
      }
      html body #globalnav .globalnav-item {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 100% !important;
        position: static !important;
        margin: 0 !important;
        padding: 0 !important;
        flex: none !important;
      }
      html body #globalnav .globalnav-link {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 44px !important;
        padding: 0 8px !important;
        font-size: 12px !important;
        font-weight: 400 !important;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif !important;
        color: #f5f5f7 !important;
        opacity: 0.8 !important;
        text-decoration: none !important;
        white-space: nowrap !important;
        transition: opacity 0.2s ease !important;
        letter-spacing: -0.01em !important;
      }
      html body #globalnav .globalnav-link:hover {
        opacity: 1 !important;
      }
      /* Desktop Flyouts apply ONLY to submenus (.globalnav-submenu) */
      html body #globalnav .globalnav-submenu {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        position: absolute !important;
        top: 44px !important;
        left: 0 !important;
        width: 100vw !important;
        min-height: 380px !important;
        margin-top: 0 !important;
        background: rgba(22, 22, 23, 0.98) !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5) !important;
        z-index: 99999 !important;
        transition: opacity 0.2s ease, visibility 0.2s ease !important;
      }
      html body #globalnav .globalnav-item-submenu.globalnav-item-flyout-open > .globalnav-submenu,
      html body #globalnav .globalnav-item-submenu:hover > .globalnav-submenu,
      html body #globalnav .globalnav-submenu.show {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      html body #globalnav .globalnav-item-submenu.globalnav-item-flyout-open .globalnav-flyout-scroll-container,
      html body #globalnav .globalnav-item-submenu:hover .globalnav-flyout-scroll-container,
      html body #globalnav .globalnav-submenu.show .globalnav-flyout-scroll-container,
      html body #globalnav .globalnav-item-submenu.globalnav-item-flyout-open .globalnav-submenu-content,
      html body #globalnav .globalnav-item-submenu:hover .globalnav-submenu-content,
      html body #globalnav .globalnav-submenu.show .globalnav-submenu-content {
        visibility: visible !important;
        opacity: 1 !important;
        display: flex !important;
      }
      html body #globalnav .globalnav-submenu .globalnav-flyout-content {
        max-width: 1024px !important;
        margin: 0 auto !important;
        padding: 40px 24px 60px !important;
        display: flex !important;
        flex-direction: row !important;
        gap: 48px !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      html body #globalnav .globalnav-submenu .globalnav-submenu-group {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      html body #globalnav .globalnav-submenu .globalnav-submenu-link {
        display: block !important;
        color: #e8e8ed !important;
        opacity: 0.88 !important;
        visibility: visible !important;
      }
      html body #globalnav .globalnav-submenu .globalnav-submenu-link:hover {
        opacity: 1 !important;
        color: #ffffff !important;
      }
      html body #globalnav .globalnav-menutrigger,
      html body #globalnav .globalnav-menutrigger-button,
      html body #globalnav .globalnav-menuback,
      html body #globalnav .globalnav-menuback-button {
        display: none !important;
      }
    }

    /* Mobile Hamburger Navigation Menu (max-width: 833px) */
    @media (max-width: 833px) {
      html body #globalnav {
        position: relative !important;
        height: 48px !important;
      }
      html body #globalnav .globalnav-content {
        height: 100% !important;
        padding: 0 16px !important;
      }
      html body #globalnav .globalnav-list {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        height: 100% !important;
      }
      html body #globalnav .globalnav-menutrigger {
        display: block !important;
      }
      html body #globalnav .globalnav-menutrigger-button {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: transparent !important;
        border: none !important;
        color: #f5f5f7 !important;
        cursor: pointer !important;
      }
      html body #globalnav:not(.globalnav-with-menu-open) .globalnav-menu {
        display: none !important;
      }
      html body #globalnav.globalnav-with-menu-open {
        height: 100vh !important;
        background: rgba(0, 0, 0, 0.96) !important;
        overflow-y: auto !important;
        z-index: 999999 !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
      }
      html body #globalnav.globalnav-with-menu-open .globalnav-menu {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      html body #globalnav.globalnav-with-menu-open .globalnav-menu-list,
      html body #globalnav.globalnav-with-menu-open .globalnav-list {
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
        padding: 60px 24px 40px !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      html body #globalnav.globalnav-with-menu-open .globalnav-item {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      html body #globalnav.globalnav-with-menu-open .globalnav-link {
        font-size: 22px !important;
        line-height: 1.4 !important;
        opacity: 1 !important;
        visibility: visible !important;
        color: #f5f5f7 !important;
      }
    }

    /* Scrim suppressor */
    .ac-ls-scrim,
    #ac-ls-dropdown-scrim {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  </style>
`;

/**
 * Rewrites relative and root-relative URLs in an HTML document to absolute URLs,
 * strips CORS-blocking attributes from stylesheets,
 * and ensures a <base href="..."> tag and the Rebuilt Preview Shield are present.
 *
 * @param {string} html - Raw rendered HTML from Playwright
 * @param {string} baseUrl - The final redirected URL of the cloned page
 * @returns {string} Fully rewritten, self-referencing HTML
 */
function rewriteHtmlForPreview(html, baseUrl, options = {}) {
  if (!html || typeof html !== 'string') return html;

  let rewritten = html;

  // 1. Strip Content-Security-Policy and X-Frame-Options meta tags so local preview can load fonts and images
  rewritten = rewritten.replace(/<meta[^>]+http-equiv=["']?(?:Content-Security-Policy|X-Frame-Options)["']?[^>]*>/gi, '');

  // 2. Build font data injection if pre-extracted fonts exist
  let fontDataScript = '';
  if (options && Array.isArray(options.fonts) && options.fonts.length > 0) {
    const serialized = JSON.stringify(options.fonts).replace(/<\/script/gi, '<\\/script');
    fontDataScript = `  <script id="rebuilt-font-data">window.__REBUILT_FONTS__ = ${serialized};</script>\n`;
  }

  // 3. Extract original <base href="..."> for relative URL resolution, then strip <base> tag to prevent hijacking of local ./assets/ paths
  let effectiveBaseUrl = baseUrl;
  const baseMatch = rewritten.match(/<base[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (baseMatch && baseMatch[1]) {
    try {
      effectiveBaseUrl = new URL(baseMatch[1], baseUrl).toString();
    } catch (_) {}
  }
  rewritten = rewritten.replace(/<base[^>]*>\s*/gi, '');

  const cloneId = options && options.cloneId ? options.cloneId : '';
  let baseOrigin = '';
  try {
    baseOrigin = new URL(effectiveBaseUrl || baseUrl).origin;
  } catch (_) {}

  // Remove previously injected preview shield styles and scripts if re-processing
  const oldShieldIdx = rewritten.indexOf('<!-- Rebuilt Universal Preview Shield & Interaction Engine -->');
  if (oldShieldIdx !== -1) {
    const shieldScriptEnd = rewritten.indexOf('</script>', rewritten.indexOf('id="rebuilt-preview-shield"'));
    if (shieldScriptEnd !== -1) {
      rewritten = rewritten.substring(0, oldShieldIdx) + rewritten.substring(shieldScriptEnd + 9);
    }
  }
  rewritten = rewritten.replace(/\s*<script id="rebuilt-clone-context"[\s\S]*?<\/script>/gi, '');

  const cloneContextScript = `  <script id="rebuilt-clone-context">window.__REBUILT_ORIGINAL_URL__ = ${JSON.stringify(baseUrl)}; window.__REBUILT_ORIGINAL_ORIGIN__ = ${JSON.stringify(baseOrigin)}; window.__REBUILT_CLONE_ID__ = ${JSON.stringify(cloneId)};</script>\n`;
  const headAdditions = fontDataScript + cloneContextScript;
  if (/<head[^>]*>/i.test(rewritten)) {
    rewritten = rewritten.replace(/(<head[^>]*>)/i, (m) => m + '\n' + headAdditions);
  } else {
    rewritten = headAdditions + rewritten;
  }

  // Resolve relative URLs inside all <style> tags to absolute baseOrigin so fonts and assets resolve
  rewritten = rewritten.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, openTag, styleBody, closeTag) => {
    if (openTag.includes('data-rebuilt-inlined') || openTag.includes('rebuilt-preview-shield')) return m;
    const resolvedBody = styleBody.replace(/\burl\(\s*(?:&quot;|&#34;|&apos;|&#39;|["'\\])?([^"'\)\s&]+?)(?:&quot;|&#34;|&apos;|&#39;|["'\\])?\s*\)/gi, (um, u) => {
      if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#')) return um;
      return `url("${toAbsolute(u, baseUrl)}")`;
    });
    return openTag + resolvedBody + closeTag;
  });

  // 4. Strip crossorigin and integrity from <link> and <script> tags so remote CDNs and SRI checks don't block CSS, fonts, or scripts
  rewritten = rewritten.replace(/(<(?:link|script)[^>]+?)\s+crossorigin(?:=["'][^"']*["'])?/gi, '$1');
  rewritten = rewritten.replace(/(<(?:link|script)[^>]+?)\s+integrity(?:=["'][^"']*["'])?/gi, '$1');

  // 5. Inline captured stylesheets (from live authenticated browser session to bypass Vercel/Cloudflare challenges)
  if (options && options.stylesheets instanceof Map && options.stylesheets.size > 0) {
    for (const [cssUrl, cssContent] of options.stylesheets.entries()) {
      if (!cssContent || !cssContent.trim()) continue;
      const resolvedCss = cssContent.replace(/\burl\(\s*(?:&quot;|&#34;|&apos;|&#39;|["'\\])?([^"'\)\s&]+?)(?:&quot;|&#34;|&apos;|&#39;|["'\\])?\s*\)/gi, (m, u) => {
        return `url("${toAbsolute(u, cssUrl)}")`;
      });

      let replaced = false;
      const variants = new Set([
        cssUrl,
        decodeURIComponent(cssUrl),
        encodeURI(decodeURIComponent(cssUrl))
      ]);

      for (const variant of variants) {
        try {
          const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const linkRegex = new RegExp(`<link[^>]+href=["']${escaped}["'][^>]*>`, 'i');
          if (linkRegex.test(rewritten)) {
            rewritten = rewritten.replace(linkRegex, `<style data-rebuilt-inlined="${cssUrl}">\n${resolvedCss}\n</style>`);
            replaced = true;
            break;
          }
        } catch (_) {}
      }

      if (!replaced && rewritten.includes('</head>')) {
        rewritten = rewritten.replace('</head>', `<style data-rebuilt-inlined="${cssUrl}">\n${resolvedCss}\n</style>\n</head>`);
      }

      // Remove any lingering link tags referencing this inlined stylesheet to avoid duplicate remote network requests
      for (const variant of variants) {
        try {
          const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const remRegex = new RegExp(`<link[^>]+href=["']${escaped}["'][^>]*>`, 'gi');
          rewritten = rewritten.replace(remRegex, '');
        } catch (_) {}
      }
    }
  }

  // 4c. Neutralize web app manifest link tags to prevent cross-origin CORS errors in local preview
  rewritten = rewritten.replace(/<link\b[^>]*\brel=["'](?:manifest|alternate\s+manifest)["'][^>]*>/gi, '<!-- manifest link neutralized for preview -->');
  rewritten = rewritten.replace(/<link\b[^>]*\bhref=["'][^"']*manifest\.json[^"']*["'][^>]*>/gi, '<!-- manifest link neutralized for preview -->');

  // 5. Rewrite <link ... href="..."> (Stylesheets, icons, preloads)
  rewritten = rewritten.replace(/(<link[^>]+href=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, href, p2) => {
    return p1 + toAbsolute(href, effectiveBaseUrl) + p2;
  });

  // 6. Neutralize third-party CMP and tracker blocking scripts that fail/glitch on localhost
  rewritten = rewritten.replace(/<script\b[^>]*(?:usercentrics|uc-block|onetrust|cookiebot|cookie-law|cntcc|etracker|_etLoader|_etCode|trkkr)[^>]*>[\s\S]*?<\/script>/gi, '<!-- CMP blocker neutralized -->');

  // 7. Rewrite <script ... src="...">
  rewritten = rewritten.replace(/(<script[^>]+src=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, src, p2) => {
    return p1 + toAbsolute(src, effectiveBaseUrl) + p2;
  });

  // 7. Rewrite <img ... src="..."> and all srcset="..." attributes (img and source)
  rewritten = rewritten.replace(/(<img[^>]+src=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, src, p2) => {
    return p1 + toAbsolute(src, effectiveBaseUrl) + p2;
  });

  rewritten = rewritten.replace(/(srcset=["\'])([^"\']+)(["\'])/gi, (match, p1, srcset, p2) => {
    return p1 + rewriteSrcsetString(srcset, effectiveBaseUrl) + p2;
  });

  // 8. Rewrite <source ... src="...">
  rewritten = rewritten.replace(/(<source[^>]+src=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, src, p2) => {
    return p1 + toAbsolute(src, effectiveBaseUrl) + p2;
  });

  // 9. Rewrite <video ... poster="..."> and <video ... src="...">
  rewritten = rewritten.replace(/(<video[^>]+poster=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, poster, p2) => {
    return p1 + toAbsolute(poster, effectiveBaseUrl) + p2;
  });
  rewritten = rewritten.replace(/(<video[^>]+src=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, src, p2) => {
    return p1 + toAbsolute(src, effectiveBaseUrl) + p2;
  });

  // 10. Rewrite SVG <use href="...">, <use xlink:href="...">, and SVG <image href="...">
  rewritten = rewritten.replace(/(<use[^>]+(?:href|xlink:href)=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, href, p2) => {
    if (href.startsWith('#')) return match;
    return p1 + toAbsolute(href, effectiveBaseUrl) + p2;
  });
  rewritten = rewritten.replace(/(<image[^>]+(?:href|xlink:href)=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, href, p2) => {
    return p1 + toAbsolute(href, effectiveBaseUrl) + p2;
  });

  // 11. Rewrite <iframe ... src="..."> with embed permissions
  rewritten = rewritten.replace(/(<iframe[^>]+src=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, src, p2) => {
    const abs = toAbsolute(src, effectiveBaseUrl);
    let closing = p2;
    if (abs.includes('youtube.com') || abs.includes('youtu.be') || abs.includes('vimeo.com') || abs.includes('dailymotion.com')) {
      if (!closing.includes('allow=')) {
        closing = ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"' + closing;
      }
      if (!closing.includes('allowfullscreen')) {
        closing = ' allowfullscreen' + closing;
      }
    }
    return p1 + abs + closing;
  });

  // 11b. Rewrite <audio>, <track>, <embed>, <input>
  rewritten = rewritten.replace(/(<(?:audio|track|embed|input)[^>]+src=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, src, p2) => {
    return p1 + toAbsolute(src, effectiveBaseUrl) + p2;
  });

  // 12. Rewrite <object ... data="...">
  rewritten = rewritten.replace(/(<object[^>]+data=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, data, p2) => {
    return p1 + toAbsolute(data, effectiveBaseUrl) + p2;
  });

  // 13. Rewrite lazy image & background data attributes
  rewritten = rewritten.replace(/((?:data-src|data-lazy|data-original|data-lazy-src|data-bg|data-bg-img|data-background|data-bg-image|data-background-image|data-thumb|data-hi-res-src|data-full-src|data-large_image|data-echo|data-image|data-img-url|data-lazyload|data-url|data-fallback|data-desktop-src|data-mobile-src|data-highres|data-origin|data-full)\s*=\s*["'])([^"']+)(["'])/gi, (match, p1, val, p2) => {
    return p1 + toAbsolute(val, effectiveBaseUrl) + p2;
  });

  // 10. Rewrite <a ... href="..."> (Stay inside /clones/<cloneId>/ for same-origin pages)
  rewritten = rewritten.replace(/(<a[^>]+href=["\'])([^"\']+)(["\'][^>]*>)/gi, (match, p1, href, p2) => {
    if (
      href.startsWith('#') ||
      href.startsWith('javascript:') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('data:')
    ) {
      return match;
    }

    let absUrl;
    try {
      absUrl = new URL(href, baseUrl);
    } catch (_) {
      return match;
    }

    // If pathname starts with /clones/, normalize any duplicate or nested /clones/<id>/
    if (absUrl.pathname.startsWith('/clones')) {
      const targetClone = cloneId || (absUrl.pathname.split('/')[2]) || '';
      let subpath = absUrl.pathname.replace(/^\/clones(?:\/[^\/]+)?\/?/, '');
      subpath = subpath.replace(/^\/+/, '');
      const localHref = `/clones/${targetClone}/${subpath}${absUrl.search}${absUrl.hash}`;
      return `${p1}${localHref}${p2}`;
    }

    if (cloneId && baseOrigin && absUrl.origin === baseOrigin) {
      let subpath = absUrl.pathname.replace(/^\/clones(?:\/[^\/]+)?\/?/, '');
      subpath = subpath.replace(/^\/+/, '');
      const localHref = `/clones/${cloneId}/${subpath}${absUrl.search}${absUrl.hash}`;
      return `${p1}${localHref}${p2}`;
    }

    return p1 + absUrl.toString() + p2;
  });

  // 10b. Rewrite <form action="...">, <button formaction="...">, <input formaction="...">
  // Ensures all form submissions remain rooted within /clones/<cloneId>/
  const formActionReplacer = (match, p1, action, p2) => {
    if (
      action.startsWith('#') ||
      action.startsWith('javascript:') ||
      action.startsWith('mailto:') ||
      action.startsWith('tel:') ||
      action.startsWith('data:')
    ) {
      return match;
    }

    let absUrl;
    try {
      absUrl = new URL(action, baseUrl);
    } catch (_) {
      return match;
    }

    if (absUrl.pathname.startsWith('/clones')) {
      const targetClone = cloneId || (absUrl.pathname.split('/')[2]) || '';
      let subpath = absUrl.pathname.replace(/^\/clones(?:\/[^\/]+)?\/?/, '');
      subpath = subpath.replace(/^\/+/, '');
      const localAction = `/clones/${targetClone}/${subpath}${absUrl.search}${absUrl.hash}`;
      return `${p1}${localAction}${p2}`;
    }

    if (cloneId && baseOrigin && absUrl.origin === baseOrigin) {
      let subpath = absUrl.pathname.replace(/^\/clones(?:\/[^\/]+)?\/?/, '');
      subpath = subpath.replace(/^\/+/, '');
      const localAction = `/clones/${cloneId}/${subpath}${absUrl.search}${absUrl.hash}`;
      return `${p1}${localAction}${p2}`;
    }

    return p1 + absUrl.toString() + p2;
  };

  rewritten = rewritten.replace(/(<form[^>]+action=["'])([^"']+)(["'][^>]*>)/gi, formActionReplacer);
  rewritten = rewritten.replace(/(<(?:button|input)[^>]+formaction=["'])([^"']+)(["'][^>]*>)/gi, formActionReplacer);

  // 11. Rewrite CSS url(...) inside <style>...</style> blocks (clean entity quotes)
  rewritten = rewritten.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (match, openTag, cssContent, closeTag) => {
    const updatedCss = cssContent.replace(/\burl\(\s*(?:&quot;|&#34;|&apos;|&#39;|["'\\])?([^"'\)\s&]+?)(?:&quot;|&#34;|&apos;|&#39;|["'\\])?\s*\)/gi, (m, url) => {
      return `url("${toAbsolute(url, baseUrl)}")`;
    });
    return openTag + updatedCss + closeTag;
  });

  // 12. Rewrite CSS url(...) inside inline style="..." attributes (use single quotes inside double-quoted attributes)
  rewritten = rewritten.replace(/(style\s*=\s*["'])([^"']+)(["'])/gi, (match, p1, styleContent, p2) => {
    const updatedStyle = styleContent.replace(/\burl\(\s*(?:&quot;|&#34;|&apos;|&#39;|["'\\])?([^"'\)\s&]+?)(?:&quot;|&#34;|&apos;|&#39;|["'\\])?\s*\)/gi, (m, url) => {
      return `url('${toAbsolute(url, baseUrl)}')`;
    });
    return p1 + updatedStyle + p2;
  });

  // 13. Ensure lazy-loaded images load immediately in preview
  rewritten = rewritten.replace(/\sloading=["']lazy["']/gi, ' loading="eager"');

  // 14. Ensure video tags preserve controls or have autoplay loop for background media
  rewritten = rewritten.replace(/<video\b([^>]*)>/gi, (match, attrs) => {
    const hasControls = /\bcontrols\b/i.test(attrs);
    let newAttrs = attrs;
    if (!/\bplaysinline\b/i.test(newAttrs)) {
      newAttrs += ' playsinline';
    }
    if (!/\bwebkit-playsinline\b/i.test(newAttrs)) {
      newAttrs += ' webkit-playsinline';
    }
    if (!/\bpreload\b/i.test(newAttrs)) {
      newAttrs += ' preload="auto"';
    }
    if (!/\bdata-gpu-accelerated\b/i.test(newAttrs)) {
      newAttrs += ' data-gpu-accelerated="true"';
    }
    if (!hasControls) {
      if (!/\bautoplay\b/i.test(newAttrs)) newAttrs += ' autoplay';
      if (!/\bmuted\b/i.test(newAttrs)) newAttrs += ' muted';
      if (!/\bloop\b/i.test(newAttrs)) newAttrs += ' loop';
    }
    return `<video${newAttrs}>`;
  });

  // 15. Inject Universal Preview Shield & Interaction Engine into <head> (or top of doc)
  // Injected at the very end so that its internal scripts and markup are never altered by earlier HTML regexes
  if (/<head[^>]*>/i.test(rewritten)) {
    rewritten = rewritten.replace(/(<head[^>]*>)/i, (m) => m + '\n' + REBUILT_SHIELD_SCRIPT + '\n');
  } else {
    rewritten = REBUILT_SHIELD_SCRIPT + '\n' + rewritten;
  }

  // 16. Inject Priority Override Stylesheet right before </head> to guarantee cascade dominance over all external stylesheets
  if (rewritten.includes('</head>')) {
    rewritten = rewritten.replace('</head>', `${REBUILT_PRIORITY_STYLES}\n</head>`);
  } else if (rewritten.includes('</body>')) {
    rewritten = rewritten.replace('</body>', `${REBUILT_PRIORITY_STYLES}\n</body>`);
  } else {
    rewritten += `\n${REBUILT_PRIORITY_STYLES}`;
  }

  return rewritten;
}

/**
 * Rewrites internal <a> tags so that links pointing to pages that were crawled
 * navigate directly to their locally previewed equivalents.
 *
 * @param {string} html - HTML content of the page
 * @param {string} cloneId - Clone ID (e.g. clone_12345)
 * @param {Map<string, string>} urlToLocalPathMap - Map of normalized URL -> localPath (e.g. "about/index.html")
 * @param {string} baseOrigin - The origin of the site (e.g. "https://example.com")
 * @returns {string} HTML with rewritten cross-page links
 */
function rewriteInternalLinks(html, cloneId, urlToLocalPathMap, baseOrigin) {
  if (!html || !urlToLocalPathMap || urlToLocalPathMap.size === 0) return html;

  return html.replace(/(<a[^>]+href=["'])([^"'#]+)(#[^"']*)?(["'][^>]*>)/gi, (match, p1, hrefVal, hashVal, p2) => {
    const hash = hashVal || '';
    if (
      hrefVal.startsWith('mailto:') ||
      hrefVal.startsWith('tel:') ||
      hrefVal.startsWith('javascript:') ||
      hrefVal.startsWith('#') ||
      hrefVal.startsWith('data:')
    ) {
      return match;
    }

    let targetUrl;
    try {
      targetUrl = new URL(hrefVal, baseOrigin).toString();
    } catch (_) {
      return match;
    }

    // Try target URL directly or normalized without hash
    const cleanTarget = targetUrl.split('#')[0];
    const strippedTarget = cleanTarget.replace(/\/$/, '');
    const slashedTarget = strippedTarget + '/';

    const localPath = urlToLocalPathMap.get(cleanTarget) ||
                      urlToLocalPathMap.get(strippedTarget) ||
                      urlToLocalPathMap.get(slashedTarget);

    if (localPath) {
      const previewHref = `/clones/${cloneId}/${localPath}${hash}`;
      const closingTag = p2.replace(/>$/, ' data-rebuilt-local="true">');
      return `${p1}${previewHref}${closingTag}`;
    }

    // If uncrawled same-origin relative link, resolve to absolute URL
    if (targetUrl.startsWith(baseOrigin) && hrefVal.startsWith('/')) {
      return `${p1}${cleanTarget}${hash}${p2}`;
    }

    return match;
  });
}

module.exports = {
  toAbsolute,
  cleanUrlQuotes,
  splitSrcsetCandidates,
  rewriteSrcsetString,
  rewriteCssUrlsAndImports,
  rewriteHtmlForPreview,
  rewriteInternalLinks,
  REBUILT_SHIELD_SCRIPT
};
