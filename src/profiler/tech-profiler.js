/**
 * Rebuilt Web Cloner — Wappalyzer-Style Technology Profiler
 * Identifies CMS, frameworks, JavaScript animation engines, UI libraries, CDNs, and hosting infrastructure.
 */

const TECH_DEFINITIONS = [
  // CMS & Site Builders
  {
    name: 'Webflow',
    category: 'CMS / Site Builder',
    icon: 'webflow',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasWebflow ||
        /data-wf-page|data-wf-site|data-wf-domain/i.test(html) ||
        scripts.some(s => /webflow\.[a-z0-9]+\.js|website-files\.com/i.test(s)) ||
        /generator["']?\s*content=["']?Webflow/i.test(html)
      );
    }
  },
  {
    name: 'WordPress',
    category: 'CMS / Blog Engine',
    icon: 'wordpress',
    matches: ({ html, windowGlobals, scripts, links }) => {
      return (
        windowGlobals.hasWordpress ||
        /wp-content|wp-includes|wp-json/i.test(html) ||
        scripts.some(s => /wp-content|wp-includes/i.test(s)) ||
        links.some(l => /wp-content|wp-json|api\.w\.org/i.test(l)) ||
        /generator["']?\s*content=["']?WordPress/i.test(html)
      );
    }
  },
  {
    name: 'Shopify',
    category: 'Ecommerce Platform',
    icon: 'shopify',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasShopify ||
        /cdn\.shopify\.com|Shopify\.theme/i.test(html) ||
        scripts.some(s => /cdn\.shopify\.com/i.test(s))
      );
    }
  },
  {
    name: 'Wix',
    category: 'CMS / Site Builder',
    icon: 'wix',
    matches: ({ html, scripts }) => {
      return (
        /wix\.com|wix-warmup-data|wix-code/i.test(html) ||
        scripts.some(s => /static\.parastorage\.com|wix-code/i.test(s))
      );
    }
  },
  {
    name: 'Squarespace',
    category: 'CMS / Site Builder',
    icon: 'squarespace',
    matches: ({ html, scripts }) => {
      return (
        /squarespace\.com|static1\.squarespace\.com/i.test(html) ||
        scripts.some(s => /squarespace\.com/i.test(s))
      );
    }
  },

  // JavaScript Frameworks & Runtimes
  {
    name: 'Next.js',
    category: 'JavaScript Framework',
    icon: 'nextjs',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasNext ||
        /__NEXT_DATA__|div id="__next"|_next\/static/i.test(html) ||
        scripts.some(s => /_next\/static/i.test(s))
      );
    }
  },
  {
    name: 'Nuxt.js',
    category: 'JavaScript Framework',
    icon: 'nuxtjs',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasNuxt ||
        /__NUXT__|div id="__nuxt"|_nuxt\//i.test(html) ||
        scripts.some(s => /_nuxt\//i.test(s))
      );
    }
  },
  {
    name: 'React',
    category: 'UI Framework',
    icon: 'react',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasReact ||
        /data-reactroot|data-reactid|_reactListening/i.test(html) ||
        scripts.some(s => /react(-dom)?(\.production|\.development)?\.js/i.test(s))
      );
    }
  },
  {
    name: 'Vue.js',
    category: 'UI Framework',
    icon: 'vue',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasVue ||
        /data-v-[a-f0-9]{6,8}/i.test(html) ||
        scripts.some(s => /vue(\.runtime)?(\.min)?\.js/i.test(s))
      );
    }
  },
  {
    name: 'Gatsby',
    category: 'Static Site Generator',
    icon: 'gatsby',
    matches: ({ html, scripts }) => {
      return (
        /div id="___gatsby"|data-gatsby/i.test(html) ||
        scripts.some(s => /gatsby/i.test(s))
      );
    }
  },
  {
    name: 'jQuery',
    category: 'JavaScript Library',
    icon: 'jquery',
    matches: ({ windowGlobals, scripts }) => {
      return (
        windowGlobals.hasJQuery ||
        scripts.some(s => /jquery(-[0-9.]+)?(\.min)?\.js/i.test(s))
      );
    }
  },

  // Animation & Graphics Engines
  {
    name: 'GSAP (GreenSock)',
    category: 'Animation Library',
    icon: 'gsap',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasGsap ||
        scripts.some(s => /gsap(\.min)?\.js/i.test(s)) ||
        /data-scroll-section|data-scroll-container/i.test(html)
      );
    }
  },
  {
    name: 'GSAP ScrollTrigger',
    category: 'Animation Plugin',
    icon: 'gsap',
    matches: ({ windowGlobals, scripts }) => {
      return (
        windowGlobals.hasScrollTrigger ||
        scripts.some(s => /ScrollTrigger(\.min)?\.js/i.test(s))
      );
    }
  },
  {
    name: 'Lenis Smooth Scroll',
    category: 'Scroll Library',
    icon: 'lenis',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasLenis ||
        /html\.lenis|data-lenis/i.test(html) ||
        scripts.some(s => /lenis(\.min)?\.js/i.test(s))
      );
    }
  },
  {
    name: 'Three.js',
    category: '3D Graphics Engine',
    icon: 'threejs',
    matches: ({ windowGlobals, scripts }) => {
      return (
        windowGlobals.hasThree ||
        scripts.some(s => /three(\.module)?(\.min)?\.js/i.test(s))
      );
    }
  },
  {
    name: 'Barba.js',
    category: 'Page Transition Engine',
    icon: 'barba',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasBarba ||
        /data-barba="wrapper"|data-barba="container"/i.test(html) ||
        scripts.some(s => /barba(\.core)?/i.test(s))
      );
    }
  },
  {
    name: 'Lottie Animations',
    category: 'Vector Animation',
    icon: 'lottie',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasLottie ||
        /lottie-player|data-animation-type="lottie"/i.test(html) ||
        scripts.some(s => /lottie(-web)?/i.test(s))
      );
    }
  },
  {
    name: 'Globe.gl',
    category: '3D Visualization',
    icon: 'globe',
    matches: ({ windowGlobals, scripts }) => {
      return (
        windowGlobals.hasGlobe ||
        scripts.some(s => /globe\.gl/i.test(s))
      );
    }
  },
  {
    name: 'Locomotive Scroll',
    category: 'Scroll Library',
    icon: 'locomotive',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasLocomotive ||
        /data-scroll-container|has-scroll-smooth/i.test(html) ||
        scripts.some(s => /locomotive-scroll/i.test(s))
      );
    }
  },
  {
    name: 'Swiper',
    category: 'Slider / Carousel',
    icon: 'swiper',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasSwiper ||
        /swiper-container|swiper-slide|swiper-wrapper/i.test(html) ||
        scripts.some(s => /swiper(-bundle)?(\.min)?\.js/i.test(s))
      );
    }
  },

  // CSS Frameworks & Typography
  {
    name: 'Tailwind CSS',
    category: 'CSS Framework',
    icon: 'tailwind',
    matches: ({ html, links }) => {
      return (
        links.some(l => /tailwind/i.test(l)) ||
        /class="[^"]*(?:flex|grid|hidden|relative|absolute)\s+(?:items-center|justify-between|p-[0-9]|m-[0-9]|text-[a-z0-9]+|bg-[a-z0-9]+)[^"]*"/i.test(html)
      );
    }
  },
  {
    name: 'Bootstrap',
    category: 'CSS Framework',
    icon: 'bootstrap',
    matches: ({ html, links, scripts }) => {
      return (
        links.some(l => /bootstrap(\.min)?\.css/i.test(l)) ||
        scripts.some(s => /bootstrap(\.bundle)?(\.min)?\.js/i.test(s)) ||
        /class="[^"]*(?:container|row|col-[a-z0-9]+|btn-(?:primary|secondary))[^"]*"/i.test(html)
      );
    }
  },
  {
    name: 'Google Fonts',
    category: 'Web Fonts',
    icon: 'google',
    matches: ({ html, links }) => {
      return (
        /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(html) ||
        links.some(l => /fonts\.googleapis\.com/i.test(l))
      );
    }
  },
  {
    name: 'Adobe Fonts (Typekit)',
    category: 'Web Fonts',
    icon: 'adobe',
    matches: ({ html, links, scripts }) => {
      return (
        /use\.typekit\.net/i.test(html) ||
        links.some(l => /use\.typekit\.net/i.test(l)) ||
        scripts.some(s => /use\.typekit\.net/i.test(s))
      );
    }
  },
  {
    name: 'Font Awesome',
    category: 'Icon Library',
    icon: 'fontawesome',
    matches: ({ html, links }) => {
      return (
        links.some(l => /font-awesome|fontawesome/i.test(l)) ||
        /class="[^"]*fa[srbld]?\s+fa-[a-z0-9-]+[^"]*"/i.test(html)
      );
    }
  },

  // Cloud & CDN Infrastructure
  {
    name: 'Vercel',
    category: 'Hosting / PaaS',
    icon: 'vercel',
    matches: ({ html, headers, scripts }) => {
      const serverHeader = headers['server'] || headers['x-vercel-id'] || '';
      return (
        /vercel/i.test(serverHeader) ||
        Boolean(headers['x-vercel-id']) ||
        /assets\.vercel\.com|_vercel/i.test(html) ||
        scripts.some(s => /_vercel/i.test(s))
      );
    }
  },
  {
    name: 'Cloudflare',
    category: 'CDN / Security',
    icon: 'cloudflare',
    matches: ({ headers, html, scripts }) => {
      const serverHeader = headers['server'] || '';
      return (
        /cloudflare/i.test(serverHeader) ||
        Boolean(headers['cf-ray']) ||
        scripts.some(s => /cdnjs\.cloudflare\.com|challenges\.cloudflare\.com/i.test(s))
      );
    }
  },
  {
    name: 'Amazon CloudFront',
    category: 'CDN',
    icon: 'aws',
    matches: ({ headers, html, scripts }) => {
      const serverHeader = headers['server'] || headers['via'] || '';
      return (
        /cloudfront/i.test(serverHeader) ||
        Boolean(headers['x-amz-cf-id']) ||
        /cloudfront\.net/i.test(html) ||
        scripts.some(s => /cloudfront\.net/i.test(s))
      );
    }
  },

  // Analytics & Tracking
  {
    name: 'Google Analytics',
    category: 'Analytics',
    icon: 'google-analytics',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasGoogleAnalytics ||
        /googletagmanager\.com|google-analytics\.com/i.test(html) ||
        scripts.some(s => /googletagmanager\.com\/gtm\.js|gtag\/js/i.test(s))
      );
    }
  },
  {
    name: 'Meta Pixel (Facebook)',
    category: 'Analytics / Ads',
    icon: 'meta',
    matches: ({ html, windowGlobals, scripts }) => {
      return (
        windowGlobals.hasMetaPixel ||
        /connect\.facebook\.net\/[a-z_]+\/fbevents\.js/i.test(html) ||
        scripts.some(s => /connect\.facebook\.net/i.test(s))
      );
    }
  }
];

/**
 * Profiles technologies used on a webpage based on DOM, window globals, scripts, and headers.
 *
 * @param {object} params
 * @param {string} params.html - Rendered HTML content
 * @param {object} [params.windowGlobals] - Live window globals detected in Playwright
 * @param {object} [params.headers] - HTTP response headers
 * @param {string[]} [params.scripts] - Extracted <script src> URLs
 * @param {string[]} [params.links] - Extracted <link rel="stylesheet"> URLs
 * @returns {Array<{ name: string, category: string, icon: string }>} Detected technologies
 */
function profileTechnologies({
  html = '',
  windowGlobals = {},
  headers = {},
  scripts = [],
  links = []
}) {
  const detected = [];
  const seen = new Set();

  // Extract scripts if not passed
  const extractedScripts = scripts.length > 0
    ? scripts
    : [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);

  // Extract stylesheet links if not passed
  const extractedLinks = links.length > 0
    ? links
    : [...html.matchAll(/<link[^>]+(?:rel=["'](?:stylesheet|preload)["'][^>]+href=["']([^"']+)["']|href=["']([^"']+)["'][^>]+rel=["'](?:stylesheet|preload)["'])/gi)]
        .map(m => m[1] || m[2])
        .filter(Boolean);

  const context = {
    html,
    windowGlobals,
    headers: headers || {},
    scripts: extractedScripts,
    links: extractedLinks
  };

  for (const tech of TECH_DEFINITIONS) {
    try {
      if (tech.matches(context) && !seen.has(tech.name)) {
        seen.add(tech.name);
        detected.push({
          name: tech.name,
          category: tech.category,
          icon: tech.icon
        });
      }
    } catch (_) {
      // Gracefully ignore regex or matching errors
    }
  }

  return detected;
}

module.exports = {
  profileTechnologies,
  TECH_DEFINITIONS
};
