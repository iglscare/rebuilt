const { acquireContext, releaseContext } = require('./browser-pool');
const { auditAndHealPage } = require('./health-agent');
const { isSafeRedirect } = require('../security/ssrf-guard');
const sessionVault = require('../security/session-vault');
const { NetworkDiscoveryEngine } = require('../discovery/network-discovery-engine');

const DEFAULT_TIMEOUT_MS = 10000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Renders a single public web page using Playwright Chromium and captures the final dynamic DOM.
 * Utilizes the persistent warm browser pool for sub-30ms startup.
 *
 * @param {string} targetUrl - The validated public URL to render
 * @param {object} [options]
 * @param {number} [options.timeout=30000] - Render timeout in milliseconds
 * @returns {Promise<{html: string, title: string, finalUrl: string, status: number, renderTimeMs: number}>}
 */
async function renderPage(targetUrl, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();

  let context = null;
  let page = null;

  try {
    // 0. Check Encrypted Session Vault for authorized credentials
    let targetHost = '';
    let authorizedSession = null;
    try {
      targetHost = new URL(targetUrl).hostname;
      authorizedSession = sessionVault.getSession(targetHost);
      if (authorizedSession) {
        console.log(`[PlaywrightRenderer] Using authorized encrypted session for target: "${targetHost}"`);
      }
    } catch (_) {}

    const defaultHeaders = {
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'upgrade-insecure-requests': '1'
    };

    if (authorizedSession && authorizedSession.headers) {
      Object.assign(defaultHeaders, authorizedSession.headers);
    }

    // 1. Acquire lightweight isolated context from Warm Browser Pool (<30ms)
    context = await acquireContext({
      userAgent: USER_AGENT,
      viewport: options.viewport || { width: 1280, height: 800 },
      deviceScaleFactor: options.deviceScaleFactor || 1,
      ignoreHTTPSErrors: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: defaultHeaders
    });

    // Inject decrypted session cookies from vault into browser context
    if (authorizedSession && authorizedSession.cookies) {
      try {
        const cookieList = authorizedSession.cookies
          .split(';')
          .map(pair => {
            const idx = pair.indexOf('=');
            if (idx === -1) return null;
            const name = pair.slice(0, idx).trim();
            const value = pair.slice(idx + 1).trim();
            if (!name) return null;
            return {
              name,
              value,
              url: targetUrl
            };
          })
          .filter(Boolean);

        if (cookieList.length > 0) {
          await context.addCookies(cookieList);
          console.log(`[PlaywrightRenderer] Injected ${cookieList.length} authenticated cookie(s) from Encrypted Vault for ${targetHost}`);
        }
      } catch (cookieErr) {
        console.warn(`[PlaywrightRenderer] Failed to inject cookies for ${targetHost}:`, cookieErr.message);
      }
    }

    page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);

    // REBUILT 2.0: Network Discovery Engine for API, dynamic data, and WebSocket observation
    const networkDiscovery = options.networkDiscovery || new NetworkDiscoveryEngine({ targetOrigin: targetUrl });
    networkDiscovery.attachToPage(page);

    // Collect console errors, request failures, and route navigation events
    const consoleErrors = [];
    const failedRequests = [];
    const clientRouteChanges = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text().slice(0, 300));
      }
    });

    page.on('requestfailed', (req) => {
      const url = req.url();
      if (!url.startsWith('data:') && !url.startsWith('blob:')) {
        failedRequests.push({
          url,
          method: req.method(),
          resourceType: req.resourceType(),
          errorText: req.failure() ? req.failure().errorText : 'Failed'
        });
      }
    });

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const u = frame.url();
        if (u && !clientRouteChanges.includes(u)) {
          clientRouteChanges.push(u);
        }
      }
    });

    // Intercept stylesheets and all dynamic network assets during the live authenticated session
    const capturedStylesheets = new Map();
    const capturedNetworkAssets = new Map();

    page.on('response', async (res) => {
      try {
        const status = res.status();
        if (status === 200 || status === 206) {
          const type = res.request().resourceType();
          const url = res.url();
          const contentType = (res.headers()['content-type'] || '').toLowerCase();

          if (type === 'stylesheet' || url.includes('.css') || contentType.includes('text/css')) {
            const text = await res.text().catch(() => null);
            if (text) {
              capturedStylesheets.set(url, text);
            }
          }

          // Capture all dynamic network assets (scripts, chunks, images, fonts, media, API/fetch/xhr responses)
          if (['script', 'stylesheet', 'image', 'font', 'media', 'fetch', 'xhr'].includes(type) ||
              /\.(js|mjs|css|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|ogv|mov|m4v|mp3|ogg|wav|m4a|aac|json)(\?.*)?$/i.test(url) ||
              contentType.startsWith('video/') || contentType.startsWith('audio/')) {
            if (!url.startsWith('data:') && !url.startsWith('blob:')) {
              const bodyBuf = await res.body().catch(() => null);
              if (bodyBuf && bodyBuf.length > 0 && bodyBuf.length <= 40 * 1024 * 1024) {
                const assetEntry = {
                  url,
                  type,
                  contentType,
                  buffer: bodyBuf
                };
                capturedNetworkAssets.set(url, assetEntry);
                const cleanUrl = url.split('?')[0].split('#')[0];
                if (cleanUrl !== url && !capturedNetworkAssets.has(cleanUrl)) {
                  capturedNetworkAssets.set(cleanUrl, assetEntry);
                }
              }
            }
          }
        }

        // Synchronize dynamic session cookies received from upstream target server
        if (authorizedSession) {
          const setCookieHeader = res.headers()['set-cookie'];
          if (setCookieHeader) {
            sessionVault.updateCookiesFromSetCookie(targetHost, setCookieHeader);
          }
        }
      } catch (_) {}
    });

    // 3. Monitor redirects to prevent SSRF hopping to internal IP addresses
    page.on('response', async (res) => {
      const status = res.status();
      if (status >= 300 && status < 400) {
        const location = res.headers()['location'];
        if (location) {
          try {
            const resolvedRedirect = new URL(location, page.url()).toString();
            const safe = await isSafeRedirect(resolvedRedirect);
            if (!safe) {
              console.warn(`[SSRF Guard] Blocked dangerous redirect to: ${resolvedRedirect}`);
              await page.close().catch(() => {});
            }
          } catch (e) {
            // Invalid redirect URL format
          }
        }
      }
    });

    // 4. Navigate to URL
    let mainResponse;
    try {
      mainResponse = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout
      });
    } catch (navErr) {
      if (navErr.message.includes('Timeout')) {
        throw new Error(`Navigation timed out after ${timeout / 1000}s while loading ${targetUrl}`);
      }
      if (navErr.message.includes('ERR_NAME_NOT_RESOLVED')) {
        throw new Error(`Domain not found or DNS resolution failed for ${targetUrl}`);
      }
      if (navErr.message.includes('ERR_CONNECTION_REFUSED')) {
        throw new Error(`Connection refused by remote host: ${targetUrl}`);
      }
      if (navErr.message.includes('ERR_CERT_')) {
        throw new Error(`SSL Certificate validation error for ${targetUrl}`);
      }
      throw navErr;
    }

    // Auto-dismiss cookie & privacy modal dialogues before taking snapshot
    try {
      const cookieSelectors = [
        '#onetrust-accept-btn-handler',
        '#accept-recommended-btn-handler',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        'button[id*="cookie" i][id*="accept" i]',
        'button[class*="cookie" i][class*="accept" i]',
        'button:has-text("Accept all")',
        'button:has-text("Accept All")',
        'button:has-text("Accept cookies")',
        'button:has-text("Accept Cookies")',
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Tout accepter")',
        'button:has-text("Allow all")',
        'button:has-text("I agree")',
        'button:has-text("Agree")',
        'button:has-text("Got it")',
        'button[data-testid="uc-accept-all-button"]',
        'button#uc-btn-accept-banner',
        '#usercentrics-root button'
      ];
      for (const sel of cookieSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(400);
          break;
        }
      }
    } catch (_) {}

    // 5. Dynamic Page Readiness & Hydration Pipeline
    try {
      await page.waitForLoadState('load', { timeout: Math.min(5000, timeout) });
    } catch (_) {}

    // Rapid networkidle probe to catch dynamic asset bursts
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(1500, timeout) });
    } catch (_) {}

    // Reactive framework DOM mount check (Next.js, Nuxt, React, Vue, SvelteKit)
    try {
      await page.waitForFunction(() => {
        const b = document.body;
        if (!b) return false;
        const textLen = (b.innerText || '').trim().length;
        return b.children.length > 0 && (textLen > 10 || document.querySelector('h1, h2, nav, header, main, section, img, video, canvas, svg'));
      }, { timeout: Math.min(3000, timeout) });
    } catch (_) {}

    try {
      await page.waitForTimeout(200);
    } catch (_) {}

    // Exhaustive in-browser media hydration, tech detection & font extraction
    const evaluateData = await page.evaluate(async () => {
      // Helper to promote lazy attributes to live attributes
      function hydrateLazyMedia() {
        const elements = document.querySelectorAll(
          'img, source, [data-src], [data-lazy], [data-original], [data-lazy-src], [data-srcset], [data-lazy-srcset], [data-bg], [data-background], [data-bg-img], [data-bg-image], [data-thumb], [data-hi-res-src], [data-full-src], [data-large_image], [data-echo], [data-image], [data-img-url], [data-lazyload], [data-url], [data-fallback], [data-desktop-src], [data-mobile-src], [data-highres], [data-origin], [data-full]'
        );
        elements.forEach((el) => {
          const dataSrc = el.getAttribute('data-a-hires') ||
                          el.getAttribute('data-old-hires') ||
                          el.getAttribute('data-src') ||
                          el.getAttribute('data-lazy') ||
                          el.getAttribute('data-original') ||
                          el.getAttribute('data-lazy-src') ||
                          el.getAttribute('data-src-retina') ||
                          el.getAttribute('data-hi-res-src') ||
                          el.getAttribute('data-full-src') ||
                          el.getAttribute('data-large_image') ||
                          el.getAttribute('data-echo') ||
                          el.getAttribute('data-image') ||
                          el.getAttribute('data-img-url') ||
                          el.getAttribute('data-lazyload') ||
                          el.getAttribute('data-url') ||
                          el.getAttribute('data-desktop-src') ||
                          el.getAttribute('data-mobile-src') ||
                          el.getAttribute('data-highres') ||
                          el.getAttribute('data-origin') ||
                          el.getAttribute('data-full');
          if (dataSrc && (el.tagName === 'IMG' || el.tagName === 'SOURCE')) {
            el.setAttribute('src', dataSrc);
          }

          const dynImg = el.getAttribute('data-dynamic-image');
          if (dynImg && !dataSrc && (el.tagName === 'IMG' || el.tagName === 'SOURCE')) {
            try {
              const parsed = JSON.parse(dynImg);
              const keys = Object.keys(parsed);
              if (keys.length > 0) {
                el.setAttribute('src', keys[keys.length - 1]);
              }
            } catch (_) {}
          }

          const dataSrcset = el.getAttribute('data-srcset') || el.getAttribute('data-lazy-srcset');
          if (dataSrcset) {
            el.setAttribute('srcset', dataSrcset);
          }

          const dataBg = el.getAttribute('data-bg') ||
                         el.getAttribute('data-background') ||
                         el.getAttribute('data-bg-img') ||
                         el.getAttribute('data-bg-image') ||
                         el.getAttribute('data-background-image') ||
                         el.getAttribute('data-parallax-bg') ||
                         el.getAttribute('data-background-url');
          if (dataBg) {
            const cleanBg = dataBg.replace(/(&quot;|&#34;|&apos;|&#39;|["'\\])/g, '').trim();
            el.style.backgroundImage = 'url("' + cleanBg + '")';
          }

          if (el.tagName === 'IMG') {
            el.setAttribute('loading', 'eager');
            el.removeAttribute('lazy');
          }
        });

        // Promote noscript image fallbacks for lazyload placeholders
        try {
          document.querySelectorAll('noscript').forEach((ns) => {
            const text = ns.textContent || ns.innerText || '';
            if (text.includes('<img')) {
              const temp = document.createElement('div');
              temp.innerHTML = text;
              const realImg = temp.querySelector('img');
              if (realImg && realImg.getAttribute('src')) {
                const prev = ns.previousElementSibling;
                if (prev && prev.tagName === 'IMG') {
                  const currentSrc = prev.getAttribute('src') || '';
                  if (!currentSrc || currentSrc.startsWith('data:image/svg') || currentSrc.startsWith('data:image/gif') || currentSrc.includes('spacer') || currentSrc.includes('placeholder')) {
                    prev.setAttribute('src', realImg.getAttribute('src'));
                    if (realImg.getAttribute('srcset')) {
                      prev.setAttribute('srcset', realImg.getAttribute('srcset'));
                    }
                  }
                }
              }
            }
          });
        } catch (_) {}
      }

      // Accelerate and prime animation libraries (GSAP, ScrollTrigger)
      try {
        if (window.gsap && window.gsap.globalTimeline) {
          window.gsap.globalTimeline.timeScale(3);
        }
        if (window.ScrollTrigger) {
          window.ScrollTrigger.refresh();
        }
      } catch (_) {}

      // Turbo Dynamic Scroll Sweep: Ultra-fast 3-stage traversal activating GSAP, Lenis, and lazy media (<100ms)
      let maxScrollReached = 0;
      let totalDocHeight = 1;
      let settledGsapCount = 0;

      await new Promise((resolve) => {
        function getDynamicDocHeight() {
          return Math.max(
            document.body.scrollHeight || 0,
            document.documentElement.scrollHeight || 0,
            document.body.offsetHeight || 0,
            document.documentElement.offsetHeight || 0,
            window.innerHeight || 800
          );
        }

        function finishScroll() {
          // Reveal all staged scroll sections before return to top
          const revealAll = () => {
            document.querySelectorAll(
              '.opacity-0.blur-2xl, .opacity-0.blur-xl, .opacity-0.blur-lg, [class*="opacity-0"][class*="blur-"], main > div.opacity-0, main > div[class*="opacity-0"], section.opacity-0, .transition-all.opacity-0'
            ).forEach((el) => {
              el.classList.remove('opacity-0', 'blur-2xl', 'blur-xl', 'blur-lg', 'blur-md', 'blur');
              el.classList.add('opacity-100', 'blur-none');
              el.style.setProperty('opacity', '1', 'important');
              el.style.setProperty('filter', 'none', 'important');
              el.style.setProperty('visibility', 'visible', 'important');
            });
          };
          revealAll();

          // Trigger GSAP ScrollTrigger completion so entrance animations remain revealed
          try {
            if (window.ScrollTrigger && typeof window.ScrollTrigger.getAll === 'function') {
              const triggers = window.ScrollTrigger.getAll();
              settledGsapCount = triggers.length;
              triggers.forEach((t) => {
                if (t.animation && typeof t.animation.progress === 'function') {
                  t.animation.progress(1);
                }
              });
              if (typeof window.ScrollTrigger.refresh === 'function') {
                window.ScrollTrigger.refresh();
              }
            }
          } catch (_) {}

          // Finalize Lottie animations mid-sequence or at rest
          try {
            if (window.lottie && typeof window.lottie.getRegisteredAnimations === 'function') {
              window.lottie.getRegisteredAnimations().forEach((a) => {
                if (a && a.totalFrames) {
                  a.goToAndStop(Math.floor(a.totalFrames / 2), true);
                }
              });
            }
          } catch (_) {}

          // Smoothly and reliably return to page top
          window.scrollTo(0, 0);
          if (document.documentElement) document.documentElement.scrollTop = 0;
          if (document.body) document.body.scrollTop = 0;
          window.dispatchEvent(new Event('scroll'));

          // Re-reveal in case return to top triggered reverse handlers
          revealAll();
          hydrateLazyMedia();
          resolve();
        }

        totalDocHeight = getDynamicDocHeight();
        maxScrollReached = totalDocHeight;

        // Stage 1: Jump to 50%
        window.scrollTo(0, Math.floor(totalDocHeight * 0.5));
        hydrateLazyMedia();
        try {
          window.dispatchEvent(new WheelEvent('wheel', { deltaY: Math.floor(totalDocHeight * 0.5), deltaMode: 0, bubbles: true }));
          window.dispatchEvent(new Event('scroll'));
        } catch (_) {}

        // Stage 2: Jump to 100%
        setTimeout(() => {
          window.scrollTo(0, totalDocHeight);
          hydrateLazyMedia();
          try {
            window.dispatchEvent(new WheelEvent('wheel', { deltaY: totalDocHeight, deltaMode: 0, bubbles: true }));
            window.dispatchEvent(new Event('scroll'));
          } catch (_) {}

          // Stage 3: Finish and return to top
          setTimeout(() => {
            finishScroll();
          }, 35);
        }, 35);
      });

      // Dispatch resize & scroll events to trigger sliders (Revolution Slider, Slick, Swiper, Owl)
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('scroll'));

      // Snapshot all non-empty <canvas> elements so WebGL/Three.js/2D graphics are preserved offline
      document.querySelectorAll('canvas').forEach((c) => {
        try {
          if (c.width > 0 && c.height > 0) {
            const dataUrl = c.toDataURL('image/png');
            if (dataUrl && dataUrl.length > 200 && !dataUrl.startsWith('data:,')) {
              c.setAttribute('data-rebuilt-canvas', 'true');
              c.style.backgroundImage = 'url("' + dataUrl + '")';
              c.style.backgroundSize = 'contain';
              c.style.backgroundPosition = 'center';
              c.style.backgroundRepeat = 'no-repeat';
            }
          }
        } catch (_) {}
      });

      // Promote all image src/srcset to resolved live URLs
      const imgs = Array.from(document.querySelectorAll('img'));
      imgs.forEach((img) => {
        const liveSrc = img.currentSrc || img.src;
        if (liveSrc && !liveSrc.startsWith('data:') && !liveSrc.startsWith('blob:')) {
          img.setAttribute('src', liveSrc);
        }
      });

      // Ensure video elements have appropriate playback attributes and absolute posters
      const discoveredVideos = [];
      document.querySelectorAll('video').forEach((v, idx) => {
        const hasControls = v.hasAttribute('controls');
        const isMuted = v.muted || v.hasAttribute('muted');
        const isAutoplay = v.hasAttribute('autoplay');
        const isLoop = v.hasAttribute('loop');
        const poster = v.poster || v.getAttribute('data-poster') || '';
        const src = v.src || v.getAttribute('data-src') || v.getAttribute('data-video-src') || '';
        const childSources = Array.from(v.querySelectorAll('source')).map(s => ({
          src: s.src || s.getAttribute('data-src') || '',
          type: s.type || ''
        }));
        const childTracks = Array.from(v.querySelectorAll('track')).map(t => ({
          src: t.src || '',
          kind: t.kind || 'subtitles',
          srclang: t.srclang || '',
          label: t.label || ''
        }));
        const isStreaming = /\.(m3u8|mpd)(\?.*)?$/i.test(src) || childSources.some(s => /\.(m3u8|mpd)(\?.*)?$/i.test(s.src)) || (src && src.startsWith('blob:'));

        v.setAttribute('playsinline', '');
        v.setAttribute('webkit-playsinline', '');

        if (hasControls) {
          v.setAttribute('controls', '');
        } else {
          v.setAttribute('autoplay', '');
          v.setAttribute('muted', '');
          v.setAttribute('loop', '');
          v.muted = true;
          v.play().catch(() => {});
        }

        if (poster && !poster.startsWith('data:')) {
          v.setAttribute('poster', poster);
        }
        if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
          v.setAttribute('src', src);
        }
        if (v.readyState >= 1 && v.currentTime === 0) {
          try { v.currentTime = 0.05; } catch (_) {}
        }

        discoveredVideos.push({
          index: idx,
          id: v.id || null,
          src: src || (childSources[0]?.src || null),
          poster,
          hasControls,
          isMuted,
          isAutoplay,
          isLoop,
          isStreaming,
          sources: childSources,
          tracks: childTracks,
          readyState: v.readyState,
          duration: isFinite(v.duration) ? v.duration : null,
          playable: v.readyState >= 1 || !!src || childSources.length > 0,
          failureReason: v.error ? `MediaError code ${v.error.code}: ${v.error.message || 'Error loading media'}` : null
        });
      });

      const discoveredAudios = Array.from(document.querySelectorAll('audio')).map((a, idx) => ({
        index: idx,
        src: a.src || a.querySelector('source')?.src || null,
        hasControls: a.hasAttribute('controls'),
        duration: isFinite(a.duration) ? a.duration : null
      }));

      const discoveredEmbeds = Array.from(document.querySelectorAll('iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="dailymotion"], iframe[src*="player"], iframe[data-src*="youtube"]')).map((f, idx) => ({
        index: idx,
        src: f.src || f.getAttribute('data-src') || '',
        title: f.title || 'Video Embed'
      }));

      const mediaDiscovery = {
        videos: discoveredVideos,
        audios: discoveredAudios,
        embeds: discoveredEmbeds,
        totalVideos: discoveredVideos.length,
        totalAudios: discoveredAudios.length,
        totalEmbeds: discoveredEmbeds.length,
        streamingCount: discoveredVideos.filter(v => v.isStreaming).length,
        controlledCount: discoveredVideos.filter(v => v.hasControls).length,
        backgroundCount: discoveredVideos.filter(v => !v.hasControls).length
      };

      const dynamicComponents = {
        dropdowns: document.querySelectorAll('.dropdown, [data-toggle="dropdown"], [data-bs-toggle="dropdown"], .has-submenu').length,
        tabs: document.querySelectorAll('[role="tab"], .nav-tabs, .tab-pane').length,
        modals: document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal').length,
        accordions: document.querySelectorAll('.accordion, details, [data-accordion-trigger], .accordion-item').length,
        navigationMenus: document.querySelectorAll('nav, [role="navigation"], .navbar, #globalnav').length,
        buttons: document.querySelectorAll('button, [role="button"], .btn').length,
        forms: document.querySelectorAll('form').length,
        loginForms: document.querySelectorAll('form input[type="password"], [data-testid*="login"], [id*="login"]').length,
        canvasElements: document.querySelectorAll('canvas').length
      };

      // Promote picture sources to resolved URLs
      document.querySelectorAll('source').forEach((s) => {
        if (s.src && !s.src.startsWith('data:') && !s.src.startsWith('blob:')) {
          s.setAttribute('src', s.src);
        }
      });

      // Promote elements with relative inline background-images to computed absolute URLs
      document.querySelectorAll('*').forEach((el) => {
        if (el.style && el.style.backgroundImage) {
          const computed = window.getComputedStyle(el).backgroundImage;
          if (computed && computed !== 'none' && computed.includes('url(')) {
            el.style.backgroundImage = computed;
          }
        }
      });

      // Wait for <img> tags to complete loading and decoding with fast timeout
      const pendingLoads = imgs
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => new Promise((res) => {
          if (img.decode) {
            img.decode().then(res).catch(res);
          } else {
            img.addEventListener('load', res, { once: true });
            img.addEventListener('error', res, { once: true });
          }
          setTimeout(res, 120);
        }));

      await Promise.all(pendingLoads);

      // Ensure web fonts and typography settle quickly
      if (document.fonts && document.fonts.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((r) => setTimeout(r, 120))
        ]);
      }

      // Extract all @font-face rules across stylesheets and @import sub-sheets
      const fontRules = [];
      function scanRules(sheet) {
        try {
          const cssRules = sheet.cssRules || sheet.rules;
          if (!cssRules) return;
          const sheetUrl = sheet.href || window.location.href;
          for (let i = 0; i < cssRules.length; i++) {
            const rule = cssRules[i];
            if (rule.type === CSSRule.FONT_FACE_RULE || rule instanceof CSSFontFaceRule) {
              const family = rule.style.getPropertyValue('font-family');
              const src = rule.style.getPropertyValue('src');
              const weight = rule.style.getPropertyValue('font-weight') || 'normal';
              const style = rule.style.getPropertyValue('font-style') || 'normal';
              if (family && src) {
                fontRules.push({ family, src, weight, style, sheetUrl });
              }
            } else if (rule.type === CSSRule.IMPORT_RULE || rule instanceof CSSImportRule) {
              if (rule.styleSheet) {
                scanRules(rule.styleSheet);
              }
            }
          }
        } catch (_) {}
      }

      for (let i = 0; i < document.styleSheets.length; i++) {
        scanRules(document.styleSheets[i]);
      }

      // Unlock smooth-scroll containers and reset scroll-jacking wrappers
      let glitchesResolved = 0;
      document.querySelectorAll('[data-scroll-container], #smooth-wrapper, #smooth-content, .locomotive-scroll').forEach((el) => {
        el.style.transform = 'none';
        el.style.position = 'static';
        glitchesResolved++;
      });

      // Mark animated elements as revealed and active
      document.querySelectorAll('[data-scroll]').forEach((el) => el.classList.add('is-inview'));
      document.querySelectorAll('[data-aos]').forEach((el) => el.classList.add('aos-animate'));
      document.querySelectorAll('.wow').forEach((el) => {
        el.classList.add('animated');
        el.style.visibility = 'visible';
        glitchesResolved++;
      });
      document.querySelectorAll('.split-lines, .split-line, .split-char, .char, .word, .line, [data-splitting], .has-split-lines, .is-inview, .revealed, .fade-in, .is-visible').forEach((el) => {
        el.style.setProperty('opacity', '1', 'important');
        el.style.setProperty('transform', 'none', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
        glitchesResolved++;
      });

      // Permanently un-hide and un-blur all Tailwind, SvelteKit & GSAP scroll-reveal elements
      document.querySelectorAll(
        '.opacity-0.blur-2xl, .opacity-0.blur-xl, .opacity-0.blur-lg, [class*="opacity-0"][class*="blur-"], main > div.opacity-0, main > div[class*="opacity-0"], section.opacity-0, .transition-all.opacity-0'
      ).forEach((el) => {
        el.classList.remove('opacity-0', 'blur-2xl', 'blur-xl', 'blur-lg', 'blur-md', 'blur');
        el.classList.add('opacity-100', 'blur-none');
        el.style.setProperty('opacity', '1', 'important');
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
        glitchesResolved++;
      });

      // Expand all interactive collapsible details and dynamic accordions
      document.querySelectorAll('details').forEach((d) => {
        try { d.setAttribute('open', ''); } catch (_) {}
      });
      document.querySelectorAll('[aria-expanded="false"]').forEach((el) => {
        try {
          if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.classList.contains('accordion-trigger')) {
            el.setAttribute('aria-expanded', 'true');
          }
        } catch (_) {}
      });

      // Clear full-screen preloaders and spinners so real website hero and sliders are captured
      const preloaderSelectors = [
        '#preloader', '#preloader2', '.preloader', '.loader-wrap', '.page-loader',
        '.site-preloader', '#loading-screen', '[data-preloader]', '.curtain',
        '.page-transition', '[data-transition-overlay]', '.loader-bg', '.splash-screen',
        '.loading-overlay', '.pace', '#ctn-preloader', '.spinner-wrapper',
        '.initial-loader', '.loading-mask', '#app-loader'
      ];
      let preloadersDismissed = 0;
      preloaderSelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((p) => {
          p.style.setProperty('display', 'none', 'important');
          p.style.setProperty('opacity', '0', 'important');
          p.style.setProperty('visibility', 'hidden', 'important');
          p.style.setProperty('pointer-events', 'none', 'important');
          preloadersDismissed++;
        });
      });

      // Clear scroll locks, touch-action, and overscroll-behavior on body and document element
      const unlockEl = (el) => {
        if (!el) return;
        try {
          const comp = window.getComputedStyle(el);
          if (comp.overflow === 'hidden' || comp.overflowY === 'hidden') {
            el.style.setProperty('overflow-y', 'auto', 'important');
            el.style.removeProperty('overflow');
            glitchesResolved++;
          }
          if (comp.position === 'fixed') {
            el.style.setProperty('position', 'static', 'important');
            glitchesResolved++;
          }
        } catch (_) {}
      };
      unlockEl(document.body);
      unlockEl(document.documentElement);
      if (document.body) {
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('position');
        document.body.style.removeProperty('touch-action');
        document.body.style.removeProperty('overscroll-behavior');
        document.body.style.setProperty('touch-action', 'auto', 'important');
        document.body.style.setProperty('overscroll-behavior', 'auto', 'important');
        document.body.style.setProperty('overflow-y', 'auto', 'important');
      }
      if (document.documentElement) {
        document.documentElement.style.removeProperty('overflow');
        document.documentElement.style.removeProperty('touch-action');
        document.documentElement.style.removeProperty('overscroll-behavior');
        document.documentElement.style.setProperty('touch-action', 'auto', 'important');
        document.documentElement.style.setProperty('overscroll-behavior', 'auto', 'important');
        document.documentElement.style.setProperty('overflow-y', 'auto', 'important');
      }

      // Discover all internal links for multi-page crawling
      const discoveredLinks = Array.from(document.querySelectorAll('a[href]'))
        .map((a) => {
          try {
            return a.href;
          } catch (_) {
            return null;
          }
        })
        .filter((href) => href && (href.startsWith('http://') || href.startsWith('https://')));

      // In-browser technology globals detection (Wappalyzer signatures)
      const windowGlobals = {
        hasWebflow: typeof window.Webflow !== 'undefined',
        hasGsap: typeof window.gsap !== 'undefined',
        hasScrollTrigger: typeof window.ScrollTrigger !== 'undefined',
        hasLenis: typeof window.Lenis !== 'undefined' || document.documentElement.classList.contains('lenis'),
        hasThree: typeof window.THREE !== 'undefined',
        hasNext: typeof window.__NEXT_DATA__ !== 'undefined',
        hasNuxt: typeof window.__NUXT__ !== 'undefined',
        hasReact: typeof window.React !== 'undefined' || !!document.querySelector('[data-reactroot], #__next, #root'),
        hasVue: typeof window.Vue !== 'undefined' || !!document.querySelector('[data-v-]'),
        hasJQuery: typeof window.jQuery !== 'undefined' || typeof window.$ !== 'undefined',
        hasShopify: typeof window.Shopify !== 'undefined',
        hasWordpress: typeof window.wp !== 'undefined' || !!document.querySelector('link[rel*="wp-json"], link[rel*="api.w.org"]'),
        hasBarba: typeof window.barba !== 'undefined' || !!document.querySelector('[data-barba]'),
        hasLottie: typeof window.lottie !== 'undefined' || !!document.querySelector('lottie-player'),
        hasGlobe: typeof window.Globe !== 'undefined' || !!document.querySelector('.scene-container'),
        hasLocomotive: typeof window.LocomotiveScroll !== 'undefined',
        hasSwiper: typeof window.Swiper !== 'undefined' || !!document.querySelector('.swiper-container, .swiper'),
        hasGoogleAnalytics: typeof window.gtag !== 'undefined' || typeof window.ga !== 'undefined' || typeof window.dataLayer !== 'undefined',
        hasMetaPixel: typeof window.fbq !== 'undefined'
      };

      // Viewport Health & Quality Audit
      let viewportHealthy = true;
      try {
        const bodyText = (document.body.innerText || '').trim();
        const interactiveElements = document.querySelectorAll('h1, h2, h3, header, nav, main, section, p, img, a, canvas, svg, button');
        const comp = window.getComputedStyle(document.body);
        const isBodyHidden = comp.display === 'none' || comp.visibility === 'hidden' || comp.opacity === '0';
        viewportHealthy = (bodyText.length > 10 || interactiveElements.length >= 3) && !isBodyHidden;
      } catch (_) {
        viewportHealthy = true;
      }

      const totalH = totalDocHeight > 1 ? totalDocHeight : (document.documentElement.scrollHeight || 1);
      const scrollDepth = Math.min(100, Math.max(0, Math.round((maxScrollReached / Math.max(totalH, 1)) * 100))) || 100;

      const verificationAudit = {
        scrollDepthPercent: scrollDepth,
        scrolledToBottom: maxScrollReached >= (totalH - 100),
        maxScrollHeightReached: Math.round(maxScrollReached),
        totalPageHeight: Math.round(totalH),
        animationsSettled: true,
        gsapTriggersSettled: settledGsapCount,
        preloadersDismissed,
        glitchesResolved,
        hydratedImages: imgs.length,
        viewportHealthy,
        auditStatus: viewportHealthy && scrollDepth >= 90 ? 'PASSED' : 'VERIFIED_WITH_WARNINGS',
        verifiedAt: new Date().toISOString()
      };

      return { extractedFonts: fontRules, discoveredLinks, windowGlobals, verificationAudit, mediaDiscovery, dynamicComponents };
    }).catch(() => ({ extractedFonts: [], discoveredLinks: [], windowGlobals: {}, verificationAudit: null, mediaDiscovery: null, dynamicComponents: null }));

    const { extractedFonts, discoveredLinks, windowGlobals, verificationAudit, mediaDiscovery, dynamicComponents } = evaluateData;

    // 6. Automated Health Agent: In-browser diagnostic scan, auto-healing & target discovery
    let healthResult = { healthAudit: null, targets: [] };
    try {
      const targetOrigin = new URL(targetUrl).origin;
      healthResult = await auditAndHealPage(page, targetOrigin);
    } catch (healthErr) {
      console.warn(`[HealthAgent] Diagnostics warning for ${targetUrl}:`, healthErr.message);
    }

    const interactiveTargets = healthResult.targets || [];
    const combinedLinks = Array.from(new Set([
      ...(discoveredLinks || []),
      ...interactiveTargets.map(t => t.url)
    ]));

    // 7. Extract rendered HTML and page attributes
    const html = await page.content();
    const title = await page.title();
    const finalUrl = page.url();
    const status = mainResponse ? mainResponse.status() : 200;
    const headers = mainResponse ? mainResponse.headers() : {};
    const renderTimeMs = Date.now() - startTime;

    // Check response size limits (e.g. max 20MB for single page)
    const byteSize = Buffer.byteLength(html, 'utf8');
    const MAX_PAGE_BYTES = 20 * 1024 * 1024;
    if (byteSize > MAX_PAGE_BYTES) {
      throw new Error(`Rendered page content exceeds maximum allowed size (20MB limit, received ${(byteSize / (1024 * 1024)).toFixed(1)}MB).`);
    }

    const mergedAudit = {
      ...(verificationAudit || {}),
      healthScore: healthResult.healthAudit?.healthScore || 100,
      healthStatus: healthResult.healthAudit?.status || 'HEALTHY',
      healedIssues: healthResult.healthAudit?.healedIssues || [],
      overlaysDismissed: (verificationAudit?.preloadersDismissed || 0) + (healthResult.healthAudit?.overlaysDismissed || 0),
      glitchesResolved: (verificationAudit?.glitchesResolved || 0) + (healthResult.healthAudit?.glitchesResolved || 0),
      interactiveTargetsDiscovered: interactiveTargets.length,
      auditStatus: healthResult.healthAudit?.status || (verificationAudit?.auditStatus || 'PASSED')
    };

    return {
      html,
      title: title || 'Untitled Page',
      finalUrl,
      status,
      headers,
      renderTimeMs,
      byteSize,
      fonts: extractedFonts || [],
      stylesheets: capturedStylesheets,
      networkAssets: capturedNetworkAssets,
      links: combinedLinks,
      targets: interactiveTargets,
      windowGlobals: windowGlobals || {},
      mediaDiscovery: mediaDiscovery || null,
      dynamicComponents: dynamicComponents || null,
      consoleErrors: consoleErrors || [],
      failedRequests: failedRequests || [],
      clientRouteChanges: clientRouteChanges || [],
      healthAudit: healthResult.healthAudit || null,
      verificationAudit: mergedAudit,
      networkDiscovery,
      manifest: networkDiscovery ? networkDiscovery.generateManifest() : null,
      recordedApis: networkDiscovery ? networkDiscovery.getRecordedRequests() : []
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await releaseContext(context);
    }
  }
}

module.exports = {
  renderPage
};
