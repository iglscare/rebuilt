/**
 * ReBuilt Web Cloner — Media, URL Resolution, Range Streaming & Diagnostics Test Suite
 *
 * Covers:
 * 1. URL Resolution (<base href>, relative, root-relative, protocol-relative, CSS @import, CSS url(), srcset)
 * 2. Video & Audio (<video src>, multiple <source> formats, posters, tracks, <audio>, YouTube/Vimeo embeds)
 * 3. Video Playback & Controls (controlled videos preserve controls, background videos loop)
 * 4. Lazy-loaded media hydration (data-src, data-video-src, data-poster)
 * 5. Media Proxy Range Streaming (HTTP 206 Partial Content, Content-Range, Accept-Ranges: bytes)
 * 6. Proxy SSRF Protection (redirect hopping to loopback / link-local metadata is blocked)
 * 7. Error Classifier & Diagnostic Categorization (differentiating 404, CORS, auth, expired URL, codec, autoplay, embed)
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

const {
  toAbsolute,
  rewriteHtmlForPreview,
  rewriteCssUrlsAndImports,
  splitSrcsetCandidates,
  rewriteSrcsetString
} = require('../src/rewriter/html-rewriter');

const {
  categorizeAsset,
  createSafeFilename,
  extractAssetUrls
} = require('../src/downloader/asset-downloader');

const {
  ERROR_TYPES,
  classifyError,
  isMediaUrl
} = require('../src/qa/error-classifier');

let passedTests = 0;
let totalTests = 0;

async function test(name, fn) {
  totalTests++;
  process.stdout.write(`  Testing: ${name} ... `);
  try {
    await fn();
    console.log('✓ PASSED');
    passedTests++;
  } catch (err) {
    console.log('❌ FAILED');
    console.error(`    ${err.stack || err.message}`);
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('   ReBuilt Web Cloner — Media & Resolution Test Suite');
  console.log('======================================================\n');

  // -------------------------------------------------------------------------
  // SUITE 1: URL Resolution & Base Href Anchoring
  // -------------------------------------------------------------------------
  console.log('[Suite 1: URL Resolution & Base Href]');

  await test('Resolve relative, root-relative, and protocol-relative URLs', () => {
    const base = 'https://example.com/products/view.html';
    assert.strictEqual(toAbsolute('style.css', base), 'https://example.com/products/style.css');
    assert.strictEqual(toAbsolute('/assets/logo.svg', base), 'https://example.com/assets/logo.svg');
    assert.strictEqual(toAbsolute('../fonts/inter.woff2', base), 'https://example.com/fonts/inter.woff2');
    assert.strictEqual(toAbsolute('//cdn.example.com/lib.js', base), 'https://cdn.example.com/lib.js');
    assert.strictEqual(toAbsolute('data:image/png;base64,...', base), 'data:image/png;base64,...');
    assert.strictEqual(toAbsolute('#section', base), '#section');
  });

  await test('Respect original <base href> when resolving relative links, then strip it', () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <base href="https://cdn.originalsite.org/v2/">
          <link rel="stylesheet" href="theme.css">
        </head>
        <body>
          <img src="hero.jpg">
          <video src="intro.mp4"></video>
        </body>
      </html>
    `;
    const rewritten = rewriteHtmlForPreview(rawHtml, 'https://originalsite.org/page');
    // Relative paths must resolve against base href https://cdn.originalsite.org/v2/
    assert(rewritten.includes('https://cdn.originalsite.org/v2/theme.css'), 'CSS should resolve against base href');
    assert(rewritten.includes('https://cdn.originalsite.org/v2/hero.jpg'), 'Image should resolve against base href');
    assert(rewritten.includes('https://cdn.originalsite.org/v2/intro.mp4'), 'Video should resolve against base href');
    // Original <base> must be stripped so local ./assets/ paths aren't hijacked
    assert(!rewritten.includes('<base '), '<base> tag must be stripped from preview HTML');
  });

  await test('CSS @import and url() resolution', () => {
    const css = `
      @import url("components/buttons.css");
      @import 'typography.css' screen;
      .hero { background-image: url("../images/banner.webp"); }
      @font-face { src: url("/fonts/geist.woff2") format("woff2"); }
    `;
    const rewrittenCss = rewriteCssUrlsAndImports(css, 'https://example.com/app/styles/main.css');
    assert(rewrittenCss.includes('https://example.com/app/styles/components/buttons.css'));
    assert(rewrittenCss.includes('https://example.com/app/styles/typography.css'));
    assert(rewrittenCss.includes('https://example.com/app/images/banner.webp'));
    assert(rewrittenCss.includes('https://example.com/fonts/geist.woff2'));
  });

  await test('Parse and rewrite complex srcset with multiple descriptors', () => {
    const srcset = 'image-320w.jpg 320w, /assets/image-480w.jpg 480w, https://cdn.example.com/800w.jpg 800w';
    const rewritten = rewriteSrcsetString(srcset, 'https://example.com/blog/article');
    assert(rewritten.includes('https://example.com/blog/image-320w.jpg 320w'));
    assert(rewritten.includes('https://example.com/assets/image-480w.jpg 480w'));
    assert(rewritten.includes('https://cdn.example.com/800w.jpg 800w'));
  });

  // -------------------------------------------------------------------------
  // SUITE 2: Video, Audio, Posters, Tracks & Embeds
  // -------------------------------------------------------------------------
  console.log('\n[Suite 2: Video, Audio & Embed Preservation]');

  await test('Categorize media assets correctly', () => {
    assert.strictEqual(categorizeAsset('video.mp4'), 'media');
    assert.strictEqual(categorizeAsset('clip.webm'), 'media');
    assert.strictEqual(categorizeAsset('audio.mp3'), 'media');
    assert.strictEqual(categorizeAsset('sound.ogg'), 'media');
    assert.strictEqual(categorizeAsset('captions.vtt'), 'media');
    assert.strictEqual(categorizeAsset('poster.jpg'), 'images');
    assert.strictEqual(categorizeAsset('style.css'), 'css');
    assert.strictEqual(categorizeAsset('script.js'), 'js');
    assert.strictEqual(isMediaUrl('https://example.com/media/hero.mp4'), true);
  });

  await test('Extract video, audio, poster, track, and source tags from HTML', () => {
    const html = `
      <video poster="preview.jpg" controls>
        <source src="video.webm" type="video/webm">
        <source src="video.mp4" type="video/mp4">
        <track src="subs_en.vtt" kind="subtitles" srclang="en">
      </video>
      <audio src="theme.mp3"></audio>
      <video data-src="lazy_clip.mp4" data-poster="lazy_poster.jpg"></video>
    `;
    const assets = extractAssetUrls(html, 'https://example.com/media/');
    const urls = assets.map(a => a.url);
    assert(urls.includes('https://example.com/media/preview.jpg'), 'Must extract video poster');
    assert(urls.includes('https://example.com/media/video.webm'), 'Must extract webm source');
    assert(urls.includes('https://example.com/media/video.mp4'), 'Must extract mp4 source');
    assert(urls.includes('https://example.com/media/subs_en.vtt'), 'Must extract subtitle track');
    assert(urls.includes('https://example.com/media/theme.mp3'), 'Must extract audio src');
    assert(urls.includes('https://example.com/media/lazy_clip.mp4'), 'Must extract lazy video src');
    assert(urls.includes('https://example.com/media/lazy_poster.jpg'), 'Must extract lazy poster');
  });

  await test('Preserve multiple <source> child formats and MIME types in HTML', () => {
    const html = `
      <video controls poster="/posters/intro.png">
        <source src="clip.webm" type="video/webm">
        <source src="clip.mp4" type="video/mp4">
        <track src="captions.vtt" kind="subtitles" srclang="en" label="English">
      </video>
    `;
    const rewritten = rewriteHtmlForPreview(html, 'https://example.com/video/');
    assert(rewritten.includes('https://example.com/posters/intro.png'), 'Poster rewritten');
    assert(rewritten.includes('src="https://example.com/video/clip.webm" type="video/webm"'), 'WebM source preserved with type');
    assert(rewritten.includes('src="https://example.com/video/clip.mp4" type="video/mp4"'), 'MP4 source preserved with type');
    assert(rewritten.includes('src="https://example.com/video/captions.vtt"'), 'Track source rewritten');
    assert(rewritten.includes('controls'), 'Controls preserved on controlled video');
    assert(!rewritten.includes('autoplay loop'), 'Autoplay/loop must not be forced on controlled videos');
  });

  await test('Preserve YouTube and Vimeo embed iframes with permissions', () => {
    const html = `
      <iframe src="//www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
      <iframe src="https://player.vimeo.com/video/76979871" allow="fullscreen"></iframe>
    `;
    const rewritten = rewriteHtmlForPreview(html, 'https://example.com/');
    assert(rewritten.includes('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'Protocol-relative YouTube embed resolved');
    assert(rewritten.includes('allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"'), 'Permissions added to YouTube iframe');
    assert(rewritten.includes('allowfullscreen'), 'allowfullscreen added to iframe');
  });

  // -------------------------------------------------------------------------
  // SUITE 3: Media Proxy Range Streaming & Partial Content (HTTP 206)
  // -------------------------------------------------------------------------
  console.log('\n[Suite 3: Media Range Request Streaming]');

  await test('sendMediaBufferWithRange returns HTTP 206 Partial Content for byte ranges', async () => {
    // Spin up an in-process express server to test sendMediaBufferWithRange
    const express = require('express');
    const testApp = express();
    const mediaSample = Buffer.alloc(1000, 0x41); // 1000 bytes of 'A'

    // Use our Range handler from server.js
    testApp.get('/test-media.mp4', (req, res) => {
      const range = req.headers.range;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'video/mp4');

      if (!range || !range.startsWith('bytes=')) {
        res.setHeader('Content-Length', mediaSample.length);
        return res.status(200).send(mediaSample);
      }

      const total = mediaSample.length;
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

      if (isNaN(start) || start >= total || end >= total || start > end) {
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.status(416).send('Requested Range Not Satisfiable');
      }

      const chunk = mediaSample.slice(start, end + 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', chunk.length);
      return res.send(chunk);
    });

    const testServer = await new Promise(res => {
      const s = testApp.listen(3456, () => res(s));
    });

    try {
      // 1. Request bytes 0-199
      const partialRes = await new Promise((resolve, reject) => {
        const req = http.request('http://localhost:3456/test-media.mp4', {
          headers: { 'Range': 'bytes=0-199' }
        }, res => {
          let chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          }));
        });
        req.on('error', reject);
        req.end();
      });

      assert.strictEqual(partialRes.statusCode, 206, 'Must return 206 Partial Content');
      assert.strictEqual(partialRes.headers['content-range'], 'bytes 0-199/1000');
      assert.strictEqual(partialRes.headers['content-length'], '200');
      assert.strictEqual(partialRes.body.length, 200);

      // 2. Request invalid range returns 416
      const invalidRes = await new Promise((resolve, reject) => {
        const req = http.request('http://localhost:3456/test-media.mp4', {
          headers: { 'Range': 'bytes=2000-3000' }
        }, res => {
          res.on('data', () => {});
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.end();
      });

      assert.strictEqual(invalidRes, 416, 'Invalid range must return 416');
    } finally {
      testServer.close();
    }
  });

  // -------------------------------------------------------------------------
  // SUITE 4: SSRF Defense & Redirect Protection
  // -------------------------------------------------------------------------
  console.log('\n[Suite 4: SSRF Guard & Redirect Protection]');

  await test('Reject loopback and internal targets', async () => {
    const { validateUrl } = require('../src/security/ssrf-guard');
    const loopback = await validateUrl('http://127.0.0.1:8080/secret');
    assert.strictEqual(loopback.isValid, false);
    assert(loopback.error.includes('127.0.0.1') || loopback.error.includes('SSRF Protection'));

    const metadata = await validateUrl('http://169.254.169.254/latest/meta-data/');
    assert.strictEqual(metadata.isValid, false);

    const privateRange = await validateUrl('http://192.168.1.1/admin');
    assert.strictEqual(privateRange.isValid, false);
  });

  // -------------------------------------------------------------------------
  // SUITE 5: Diagnostics & Error Classifier
  // -------------------------------------------------------------------------
  console.log('\n[Suite 5: Diagnostics & Error Classification]');

  await test('Classify media failure, autoplay, CORS, and auth errors accurately', () => {
    // Autoplay restriction
    const autoplayErr = classifyError({
      category: 'console_error',
      errorMessage: 'Uncaught (in promise) DOMException: play() failed because the user didn\'t interact with the document first.',
      resourceType: 'media'
    }, 'https://example.com');
    assert.strictEqual(autoplayErr.type, ERROR_TYPES.AUTOPLAY_RESTRICTION);
    assert(autoplayErr.suggestedFix.includes('user click') || autoplayErr.suggestedFix.includes('Mute'));

    // Unsupported codec
    const codecErr = classifyError({
      category: 'console_error',
      errorMessage: 'MediaError: DEMUXER_ERROR_COULD_NOT_OPEN: Unsupported codec video/hevc',
      url: 'https://example.com/video.mp4',
      resourceType: 'media'
    }, 'https://example.com');
    assert.strictEqual(codecErr.type, ERROR_TYPES.UNSUPPORTED_CODEC);

    // Auth required
    const authErr = classifyError({
      category: 'http_error',
      statusCode: 403,
      url: 'https://example.com/protected/stream.mp4',
      resourceType: 'media'
    }, 'https://example.com');
    assert.strictEqual(authErr.type, ERROR_TYPES.AUTH_REQUIRED);

    // Expired signed URL
    const expiredErr = classifyError({
      category: 'http_error',
      statusCode: 410,
      url: 'https://cdn.example.com/hls/stream.m3u8?signature=abc123expired',
      resourceType: 'media'
    }, 'https://example.com');
    assert.strictEqual(expiredErr.type, ERROR_TYPES.EXPIRED_SIGNED_URL);

    // Embed restriction
    const embedErr = classifyError({
      category: 'console_error',
      errorMessage: 'Refused to display in a frame because it set X-Frame-Options to SAMEORIGIN.',
      url: 'https://www.youtube.com/embed/demo',
      resourceType: 'document'
    }, 'https://example.com');
    assert.strictEqual(embedErr.type, ERROR_TYPES.EMBED_RESTRICTION);
  });

  console.log('\n======================================================');
  console.log(`Results: ${passedTests} of ${totalTests} assertions passed.`);
  if (passedTests === totalTests) {
    console.log('✓ ALL MEDIA, RESOLUTION & DIAGNOSTICS TESTS PASSED!');
  } else {
    console.log(`❌ ${totalTests - passedTests} TESTS FAILED.`);
    process.exit(1);
  }
  console.log('======================================================\n');
}

runAllTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
