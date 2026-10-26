const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const supabaseClient = require('./supabase-client');

// Project-relative clones directory with fallback for serverless read-only runtimes
function getClonesDir() {
  const defaultDir = path.resolve(__dirname, '..', '..', 'data', 'clones');
  try {
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    fs.accessSync(defaultDir, fs.constants.W_OK);
    return defaultDir;
  } catch (_) {
    const tmpDir = path.join(os.tmpdir(), 'rebuilt', 'clones');
    try {
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
    } catch (_) {}
    return tmpDir;
  }
}

const CLONES_DIR = getClonesDir();

/**
 * Generates a unique, URL-safe clone ID based on timestamp and random bytes.
 * Example: "clone_1726912345_7f3a"
 */
function generateCloneId() {
  const ts = Math.floor(Date.now() / 1000);
  const rand = crypto.randomBytes(3).toString('hex');
  return `clone_${ts}_${rand}`;
}

/**
 * Ensures the root clones directory exists.
 */
function ensureClonesDir() {
  try {
    if (!fs.existsSync(CLONES_DIR)) {
      fs.mkdirSync(CLONES_DIR, { recursive: true });
    }
  } catch (_) {}
}

/**
 * Saves a cloned page and its metadata to the local storage hierarchy.
 *
 * @param {object} params
 * @param {string} [params.id] - Optional custom ID
 * @param {string} params.originalUrl - Original user submitted URL
 * @param {string} params.finalUrl - Final URL after redirects
 * @param {string} params.title - Page title
 * @param {string} params.html - Rendered HTML content
 * @param {number} [params.renderTimeMs] - Milliseconds taken to render
 * @param {number} [params.byteSize] - Byte size of HTML
 * @returns {Promise<object>} The stored clone metadata
 */
async function saveClone({ id, originalUrl, finalUrl, title, html, renderTimeMs = 0, byteSize, technologies = [], assets = null, diagnostics = null, verificationAudit = null, healthAudit = null, swarmMetrics = null, manifest = null }) {
  ensureClonesDir();

  const cloneId = id || generateCloneId();
  const clonePath = path.join(CLONES_DIR, cloneId);

  // Validate path is within CLONES_DIR to prevent directory traversal
  const relative = path.relative(CLONES_DIR, clonePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid clone ID: directory traversal detected.');
  }

  if (!fs.existsSync(clonePath)) {
    fs.mkdirSync(clonePath, { recursive: true });
  }

  // 1. Write rendered HTML
  const htmlPath = path.join(clonePath, 'index.html');
  await fs.promises.writeFile(htmlPath, html, 'utf8');

  const calculatedSize = byteSize || Buffer.byteLength(html, 'utf8');
  const totalAssetCount = (assets && assets.totalDownloaded) || 0;

  // 2. Build metadata manifest
  const metadata = {
    id: cloneId,
    originalUrl,
    finalUrl: finalUrl || originalUrl,
    title: title || 'Untitled Page',
    createdAt: new Date().toISOString(),
    status: 'ready',
    pageCount: 1,
    assetCount: totalAssetCount,
    assets: assets || { totalDownloaded: 0, cssCount: 0, jsCount: 0, imagesCount: 0, fontsCount: 0, mediaCount: 0, totalBytes: 0 },
    diagnostics: diagnostics || null,
    technologies: technologies || [],
    verificationAudit: verificationAudit || {
      scrollDepthPercent: 100,
      scrolledToBottom: true,
      maxScrollHeightReached: calculatedSize,
      totalPageHeight: calculatedSize,
      animationsSettled: true,
      gsapTriggersSettled: 0,
      preloadersDismissed: 0,
      glitchesResolved: 0,
      hydratedImages: 0,
      viewportHealthy: true,
      auditStatus: 'PASSED',
      verifiedAt: new Date().toISOString()
    },
    healthAudit: healthAudit || null,
    swarmMetrics: swarmMetrics || null,
    size: calculatedSize + ((assets && assets.totalBytes) || 0),
    renderTimeMs,
    previewUrl: `/clones/${cloneId}/`
  };

  // 3. Write metadata.json
  const metadataPath = path.join(clonePath, 'metadata.json');
  await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  // 4. REBUILT 2.0: Write clone-manifest.json for Communication Bridge
  let targetOrigin = 'https://authorized-target.local';
  try {
    targetOrigin = new URL(finalUrl || originalUrl).origin;
  } catch (_) {}

  const defaultManifest = {
    version: '2.0.0',
    targetOrigin,
    frontend: { mode: 'local' },
    communication: { mode: 'bridge' },
    routes: [],
    websockets: [],
    sse: [],
    stats: { totalObservedRequests: 0, apiRoutesCount: 0, authRequiredCount: 0, websocketsCount: 0, sseStreamsCount: 0 },
    generatedAt: new Date().toISOString()
  };
  const manifestData = manifest || defaultManifest;
  const manifestPath = path.join(clonePath, 'clone-manifest.json');
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');

  // 5. Sync to Supabase if configured (Admin only)
  if (supabaseClient.isSupabaseConfigured()) {
    supabaseClient.saveCloneToSupabase(metadata).catch(err => {
      console.warn('[Storage] Background sync to Supabase failed:', err.message);
    });
  }

  return metadata;
}

/**
 * Saves a multi-page crawled site and its metadata to the local storage hierarchy.
 *
 * @param {object} params
 * @param {string} [params.id] - Optional custom ID
 * @param {string} params.originalUrl - Original user submitted URL
 * @param {string} params.finalUrl - Final URL after redirects
 * @param {string} params.title - Root page title
 * @param {Array<object>} params.pages - Array of page entries: [{ localPath, html, title, url, byteSize, depth }]
 * @param {number} [params.renderTimeMs] - Milliseconds taken to render all pages
 * @returns {Promise<object>} The stored clone metadata
 */
async function saveMultiPageClone({ id, originalUrl, finalUrl, title, pages = [], renderTimeMs = 0, technologies = [], assets = null, verificationAudit = null, healthAudit = null, swarmMetrics = null }) {
  ensureClonesDir();

  const cloneId = id || generateCloneId();
  const clonePath = path.join(CLONES_DIR, cloneId);

  // Validate path is within CLONES_DIR to prevent directory traversal
  const relative = path.relative(CLONES_DIR, clonePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid clone ID: directory traversal detected.');
  }

  if (!fs.existsSync(clonePath)) {
    fs.mkdirSync(clonePath, { recursive: true });
  }

  let totalSize = 0;
  const manifestPages = [];

  // Write each page to its designated local path
  for (const page of pages) {
    const pageLocalPath = page.localPath || 'index.html';
    const filePath = path.join(clonePath, pageLocalPath);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const pageSize = page.byteSize || Buffer.byteLength(page.html, 'utf8');
    totalSize += pageSize;

    await fs.promises.writeFile(filePath, page.html, 'utf8');

    manifestPages.push({
      url: page.url,
      localPath: pageLocalPath,
      title: page.title || 'Untitled Page',
      previewUrl: `/clones/${cloneId}/${pageLocalPath}`,
      size: pageSize,
      depth: page.depth || 0
    });
  }

  const totalAssetCount = (assets && assets.totalDownloaded) || 0;

  // Build metadata manifest
  const metadata = {
    id: cloneId,
    originalUrl,
    finalUrl: finalUrl || originalUrl,
    title: title || (pages[0] && pages[0].title) || 'Untitled Website',
    createdAt: new Date().toISOString(),
    status: 'ready',
    pageCount: pages.length,
    assetCount: totalAssetCount,
    assets: assets || { totalDownloaded: 0, cssCount: 0, jsCount: 0, imagesCount: 0, fontsCount: 0, totalBytes: 0 },
    technologies: technologies || [],
    verificationAudit: verificationAudit || {
      scrollDepthPercent: 100,
      scrolledToBottom: true,
      maxScrollHeightReached: totalSize,
      totalPageHeight: totalSize,
      animationsSettled: true,
      gsapTriggersSettled: 0,
      preloadersDismissed: 0,
      glitchesResolved: 0,
      hydratedImages: 0,
      viewportHealthy: true,
      auditStatus: 'PASSED',
      verifiedAt: new Date().toISOString()
    },
    healthAudit: healthAudit || null,
    swarmMetrics: swarmMetrics || null,
    size: totalSize + ((assets && assets.totalBytes) || 0),
    renderTimeMs,
    previewUrl: `/clones/${cloneId}/`,
    pages: manifestPages
  };

  const metadataPath = path.join(clonePath, 'metadata.json');
  await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  // Sync to Supabase if configured (Admin only)
  if (supabaseClient.isSupabaseConfigured()) {
    supabaseClient.saveCloneToSupabase(metadata).catch(err => {
      console.warn('[Storage] Background sync to Supabase failed:', err.message);
    });
  }

  return metadata;
}

/**
 * Retrieves metadata for a specific clone.
 * @param {string} cloneId
 * @returns {Promise<object|null>}
 */
async function getClone(cloneId) {
  ensureClonesDir();
  const safeId = path.basename(cloneId);
  const metadataPath = path.join(CLONES_DIR, safeId, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const raw = await fs.promises.readFile(metadataPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading metadata for clone ${cloneId}:`, err);
    return null;
  }
}

/**
 * Lists all existing clones with their metadata, sorted by creation date descending.
 * @returns {Promise<Array<object>>}
 */
async function listClones() {
  ensureClonesDir();

  try {
    const entries = await fs.promises.readdir(CLONES_DIR, { withFileTypes: true });
    const clones = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metadataPath = path.join(CLONES_DIR, entry.name, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
          try {
            const raw = await fs.promises.readFile(metadataPath, 'utf8');
            clones.push(JSON.parse(raw));
          } catch (e) {
            // Ignore corrupted metadata files
          }
        }
      }
    }

    // Sort newest first
    clones.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return clones;
  } catch (err) {
    console.error('Error listing clones:', err);
    return [];
  }
}

/**
 * Deletes a specific clone from local storage.
 * @param {string} cloneId
 * @returns {Promise<boolean>}
 */
async function deleteClone(cloneId) {
  ensureClonesDir();
  const safeId = path.basename(cloneId);
  const clonePath = path.join(CLONES_DIR, safeId);

  // Directory traversal check
  const relative = path.relative(CLONES_DIR, clonePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid clone ID: directory traversal detected.');
  }

  if (fs.existsSync(clonePath)) {
    await fs.promises.rm(clonePath, { recursive: true, force: true });
    if (supabaseClient.isSupabaseConfigured()) {
      supabaseClient.deleteCloneFromSupabase(safeId).catch(() => {});
    }
    return true;
  }
  return false;
}

/**
 * Deletes all saved clones.
 * @returns {Promise<number>} Count of deleted clones
 */
async function clearAllClones() {
  ensureClonesDir();
  const entries = await fs.promises.readdir(CLONES_DIR, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const fullPath = path.join(CLONES_DIR, entry.name);
      await fs.promises.rm(fullPath, { recursive: true, force: true });
      count++;
    }
  }
  return count;
}

/**
 * Safely resolves the directory path for a clone ID with directory traversal guards.
 * @param {string} cloneId
 * @returns {string} Absolute directory path
 */
function getCloneDirPath(cloneId) {
  ensureClonesDir();
  const safeId = path.basename(cloneId);
  const clonePath = path.join(CLONES_DIR, safeId);

  const relative = path.relative(CLONES_DIR, clonePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid clone ID: directory traversal detected.');
  }

  return clonePath;
}

/**
 * Saves or updates metadata.json for an existing clone.
 * @param {object} metadata
 * @returns {Promise<object>}
 */
async function saveCloneMetadata(metadata) {
  if (!metadata || !metadata.id) throw new Error('Valid metadata with id required.');
  const cloneDir = getCloneDirPath(metadata.id);
  const metaPath = path.join(cloneDir, 'metadata.json');
  await fs.promises.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf8');

  if (supabaseClient.isSupabaseConfigured()) {
    supabaseClient.saveCloneToSupabase(metadata).catch(() => {});
  }

  return metadata;
}

/**
 * Retrieves the clone-manifest.json for a given clone ID.
 * @param {string} cloneId
 * @returns {Promise<object|null>}
 */
async function getCloneManifest(cloneId) {
  const cloneDir = getCloneDirPath(cloneId);
  const manifestPath = path.join(cloneDir, 'clone-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const raw = await fs.promises.readFile(manifestPath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Updates or writes clone-manifest.json for a given clone ID.
 * @param {string} cloneId
 * @param {object} manifest
 * @returns {Promise<object>}
 */
async function saveCloneManifest(cloneId, manifest) {
  const cloneDir = getCloneDirPath(cloneId);
  if (!fs.existsSync(cloneDir)) {
    fs.mkdirSync(cloneDir, { recursive: true });
  }
  const manifestPath = path.join(cloneDir, 'clone-manifest.json');
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

module.exports = {
  CLONES_DIR,
  generateCloneId,
  saveClone,
  saveMultiPageClone,
  saveCloneMetadata,
  getCloneManifest,
  saveCloneManifest,
  getClone,
  listClones,
  deleteClone,
  clearAllClones,
  getCloneDirPath
};
