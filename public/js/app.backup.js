document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const cloneForm = document.getElementById('clone-form');
  const brandLogoMark = document.getElementById('brand-logo-mark');
  const urlInput = document.getElementById('url-input');
  const btnClear = document.getElementById('btn-clear');
  const btnClone = document.getElementById('btn-clone');
  const btnText = btnClone.querySelector('.btn-text');
  const spinner = btnClone.querySelector('.spinner');

  const stepper = document.getElementById('pipeline-stepper');
  const stepSsrf = document.getElementById('step-ssrf');
  const stepBrowser = document.getElementById('step-browser');
  const stepRender = document.getElementById('step-render');
  const stepStorage = document.getElementById('step-storage');

  const errorCard = document.getElementById('error-card');
  const errorTitle = document.getElementById('error-title');
  const errorMessage = document.getElementById('error-message');

  const resultCard = document.getElementById('result-card');
  const resTitle = document.getElementById('res-title');
  const resUrl = document.getElementById('res-url');
  const resTime = document.getElementById('res-time');
  const resSize = document.getElementById('res-size');
  const resId = document.getElementById('res-id');
  const btnOpenPreview = document.getElementById('btn-open-preview');
  const btnDownloadSource = document.getElementById('btn-download-source');
  const btnToggleFrame = document.getElementById('btn-toggle-frame');
  const previewFrameContainer = document.getElementById('preview-frame-container');
  const previewIframe = document.getElementById('preview-iframe');
  const frameUrlLabel = document.getElementById('frame-url-label');

  // Tunnel & Live Link UI Elements
  const tunnelStatusPill = document.getElementById('tunnel-status-pill');
  const tunnelStatusDot = document.getElementById('tunnel-status-dot');
  const tunnelStatusText = document.getElementById('tunnel-status-text');
  const tunnelModal = document.getElementById('tunnel-modal');
  const tunnelModalBackdrop = document.getElementById('tunnel-modal-backdrop');
  const btnCloseTunnelModal = document.getElementById('btn-close-tunnel-modal');
  const tscStatusBadge = document.getElementById('tsc-status-badge');
  const tscProviderLabel = document.getElementById('tsc-provider-label');
  const tscUrlBox = document.getElementById('tsc-url-box');
  const tscPublicUrl = document.getElementById('tsc-public-url');
  const btnCopyTunnelBase = document.getElementById('btn-copy-tunnel-base');
  const btnToggleTunnel = document.getElementById('btn-toggle-tunnel');
  const btnCopyLiveLink = document.getElementById('btn-copy-live-link');
  const btnCopyLiveLinkText = document.getElementById('btn-copy-live-link-text');
  const rowLiveUrl = document.getElementById('row-live-url');
  const resLiveUrl = document.getElementById('res-live-url');
  const btnQuickCopyLive = document.getElementById('btn-quick-copy-live');

  let currentTunnelStatus = { active: false, url: null, provider: null };
  let currentCloneData = null;

  const resPagesCount = document.getElementById('res-pages-count');
  const resAssetsCount = document.getElementById('res-assets-count');
  const resAuditSection = document.getElementById('res-audit-section');
  const auditStatusBadge = document.getElementById('audit-status-badge');
  const auditScrollVal = document.getElementById('audit-scroll-val');
  const auditAnimVal = document.getElementById('audit-anim-val');
  const auditPreloadersVal = document.getElementById('audit-preloaders-val');
  const auditGlitchesVal = document.getElementById('audit-glitches-val');
  const resTechSection = document.getElementById('res-tech-section');
  const resTechList = document.getElementById('res-tech-list');
  const techBadge = document.getElementById('tech-badge');
  const resSubpagesSection = document.getElementById('res-subpages-section');
  const resSubpagesList = document.getElementById('res-subpages-list');
  const subpagesBadge = document.getElementById('subpages-badge');
  const badgeClonedLabel = document.getElementById('badge-cloned-label');

  const historyList = document.getElementById('history-list');
  const btnRefreshHistory = document.getElementById('btn-refresh-history');

  // Initialize Rebuilt Communication Bridge Client
  const bridge = new RebuiltBridgeClient();

  // Bridge Monitor Elements
  const bridgePill = document.getElementById('bridge-status-pill');
  const bridgeText = document.getElementById('bridge-status-text');
  const bridgeTerminal = document.getElementById('bridge-terminal');
  const bridgePacketCount = document.getElementById('bridge-packet-count');
  const btnClearBridge = document.getElementById('btn-clear-bridge');
  const btnToggleBridge = document.getElementById('btn-toggle-bridge');

  let packetCounter = 0;

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  bridge.on('bridge:status', (s) => {
    if (bridgePill && bridgeText) {
      if (s.connected) {
        bridgePill.className = 'bridge-status-pill';
        bridgeText.textContent = 'Bridge Active';
      } else {
        bridgePill.className = 'bridge-status-pill reconnecting';
        bridgeText.textContent = 'Reconnecting...';
      }
    }
  });

  bridge.on('activity', (entry) => {
    packetCounter++;
    if (bridgePacketCount) {
      bridgePacketCount.textContent = `${packetCounter} event${packetCounter === 1 ? '' : 's'}`;
    }

    if (!bridgeTerminal) return;

    let tagClass = 'system';
    let tagLabel = '[SYSTEM]';
    let messageText = '';

    if (entry.type.startsWith('clone:')) {
      tagClass = 'clone';
      tagLabel = '[CLONE]';
      if (entry.type === 'clone:step') {
        messageText = `${entry.data.step.toUpperCase()}: ${entry.data.label}`;
      } else if (entry.type === 'clone:started') {
        messageText = `Target locked: ${entry.data.url}`;
      } else if (entry.type === 'clone:ready') {
        messageText = `Clone ready: "${entry.data.title}" (${entry.data.cloneId})`;
      } else if (entry.type === 'clone:error') {
        tagClass = 'warn';
        tagLabel = '[ERROR]';
        messageText = `Failure: ${entry.data.error}`;
      }
    } else if (entry.type.startsWith('swarm:')) {
      tagClass = 'swarm';
      tagLabel = '[SWARM]';
      if (entry.type === 'swarm:started') {
        messageText = `Discovered ${entry.data.totalTargets} interactive targets for background preloading`;
      } else if (entry.type === 'swarm:preloading') {
        messageText = `Preloading ${entry.data.type} target: "${entry.data.path}" (${entry.data.progress})`;
      } else if (entry.type === 'swarm:target_ready') {
        messageText = `Preloaded "${entry.data.path}" [${entry.data.preloadedCount}/${entry.data.totalTargets}]`;
      } else if (entry.type === 'swarm:completed') {
        messageText = `Completed! ${entry.data.preloadedCount} targets ready in ${entry.data.totalTime}s`;
      }
    } else if (entry.type === 'proxy:request') {
      tagClass = 'proxy';
      tagLabel = '[PROXY]';
      const cacheTag = entry.data.cached ? '(Cached ⚡)' : `(HTTP ${entry.data.status})`;
      messageText = `${entry.data.method} ${entry.data.url} ${cacheTag}`;
    } else if (entry.type === 'preview:interaction' || entry.type.includes('iframe:')) {
      tagClass = 'preview';
      tagLabel = '[PREVIEW]';
      messageText = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data);
    } else {
      messageText = typeof entry.data === 'string' ? entry.data : (entry.data.message || JSON.stringify(entry.data));
    }

    const line = document.createElement('div');
    line.className = `bridge-log-line ${tagClass}`;
    line.innerHTML = `
      <span class="log-time">${entry.time}</span>
      <span class="log-tag">${tagLabel}</span>
      <span class="log-msg">${escapeHtml(messageText)}</span>
    `;

    bridgeTerminal.appendChild(line);
    while (bridgeTerminal.children.length > 80) {
      bridgeTerminal.removeChild(bridgeTerminal.firstChild);
    }
    bridgeTerminal.scrollTop = bridgeTerminal.scrollHeight;
  });

  // Bridge real-time stepper hook
  bridge.on('clone:step', (data) => {
    const stepMap = {
      'ssrf': stepSsrf,
      'browser': stepBrowser,
      'render': stepRender,
      'storage': stepStorage
    };
    const el = stepMap[data.step];
    if (el) {
      setStepState(el, data.status, data.label);
    }
  });

  if (btnClearBridge && bridgeTerminal) {
    btnClearBridge.addEventListener('click', () => {
      bridgeTerminal.innerHTML = '';
      packetCounter = 0;
      if (bridgePacketCount) bridgePacketCount.textContent = '0 events';
    });
  }

  if (btnToggleBridge && bridgeTerminal) {
    btnToggleBridge.addEventListener('click', () => {
      const isCollapsed = bridgeTerminal.classList.toggle('collapsed');
      btnToggleBridge.textContent = isCollapsed ? 'Expand' : 'Collapse';
    });
  }

  // Crawl Mode State
  let currentMaxDepth = 0;
  let currentMaxPages = 1;
  const crawlModeGroup = document.getElementById('crawl-mode-group');
  const crawlModeHint = document.getElementById('crawl-mode-hint');

  const crawlModeHints = {
    '0': 'Single Page (Fastest, 1 URL)',
    '1': 'Standard DFS (Depth 1, up to 5 subpages)',
    '2': 'Deep DFS (Depth 2, up to 12 subpages)'
  };

  if (crawlModeGroup) {
    crawlModeGroup.addEventListener('click', (e) => {
      const chip = e.target.closest('.mode-chip');
      if (!chip) return;
      crawlModeGroup.querySelectorAll('.mode-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentMaxDepth = parseInt(chip.getAttribute('data-depth') || '0', 10);
      currentMaxPages = parseInt(chip.getAttribute('data-pages') || '1', 10);
      if (crawlModeHint) {
        crawlModeHint.textContent = crawlModeHints[String(currentMaxDepth)] || 'Custom';
      }
    });
  }

  // Show/hide clear button on input
  urlInput.addEventListener('input', () => {
    btnClear.style.display = urlInput.value ? 'block' : 'none';
  });

  btnClear.addEventListener('click', () => {
    urlInput.value = '';
    btnClear.style.display = 'none';
    urlInput.focus();
  });

  // Sample Chips
  document.querySelectorAll('.sample-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      urlInput.value = chip.getAttribute('data-url');
      btnClear.style.display = 'block';
      urlInput.focus();
    });
  });

  // Toggle In-App Frame
  btnToggleFrame.addEventListener('click', () => {
    const isHidden = previewFrameContainer.style.display === 'none';
    previewFrameContainer.style.display = isHidden ? 'block' : 'none';
    btnToggleFrame.classList.toggle('active', isHidden);
  });

  // Live URL Web Bridge Handler
  const btnBridgeUrl = document.getElementById('btn-bridge-url');
  if (btnBridgeUrl) {
    btnBridgeUrl.addEventListener('click', async () => {
      const rawUrl = urlInput.value.trim();
      if (!rawUrl) {
        urlInput.focus();
        return;
      }

      errorCard.style.display = 'none';
      btnBridgeUrl.disabled = true;
      const originalText = btnBridgeUrl.innerHTML;
      btnBridgeUrl.innerHTML = `<span>⚡ Bridging...</span>`;

      bridge.logActivity('system', `⚡ Initializing Live URL Web Bridge session for: ${rawUrl}`);

      try {
        const response = await fetch('/api/bridge/url/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawUrl })
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to establish URL Web Bridge session.');
        }

        bridge.logActivity('clone', `✓ URL Web Bridge established (${data.session.id})`);

        previewFrameContainer.style.display = 'block';
        previewIframe.src = data.bridgeUrl;
        frameUrlLabel.textContent = `${window.location.origin}${data.bridgeUrl} ➔ ${data.session.targetUrl}`;

        previewFrameContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        errorCard.style.display = 'flex';
        errorTitle.textContent = 'URL Web Bridge Failed';
        errorMessage.textContent = err.message;
        bridge.logActivity('warn', `URL Web Bridge failed: ${err.message}`);
      } finally {
        btnBridgeUrl.disabled = false;
        btnBridgeUrl.innerHTML = originalText;
      }
    });
  }

  // Format Bytes helper
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Update stepper state
  function setStepState(stepEl, state, labelText) {
    stepEl.classList.remove('active', 'completed');
    const statusEl = stepEl.querySelector('.step-status');

    if (state === 'active') {
      stepEl.classList.add('active');
      statusEl.textContent = labelText || 'In Progress...';
    } else if (state === 'completed') {
      stepEl.classList.add('completed');
      statusEl.textContent = labelText || 'Done ✓';
    } else {
      statusEl.textContent = labelText || 'Pending';
    }
  }

  function resetStepper() {
    [stepSsrf, stepBrowser, stepRender, stepStorage].forEach((step) => {
      setStepState(step, 'pending', 'Pending');
    });
  }

  // Handle Form Submit
  cloneForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawUrl = urlInput.value.trim();
    if (!rawUrl) return;

    // Reset UI state
    errorCard.style.display = 'none';
    resultCard.style.display = 'none';
    if (resSubpagesSection) resSubpagesSection.style.display = 'none';
    if (resSubpagesList) resSubpagesList.innerHTML = '';
    if (resTechSection) resTechSection.style.display = 'none';
    if (resTechList) resTechList.innerHTML = '';
    previewFrameContainer.style.display = 'none';
    resetStepper();
    stepper.style.display = 'block';

    // Lock Form
    btnClone.disabled = true;
    urlInput.disabled = true;
    btnText.textContent = currentMaxDepth > 0 ? 'Crawling DFS...' : 'Cloning...';
    spinner.style.display = 'inline-block';
    if (brandLogoMark) brandLogoMark.classList.add('is-syncing');

    // Initialize first step while communication bridge coordinates pipeline
    setStepState(stepSsrf, 'active', 'Auditing URL security...');

    try {
      const response = await fetch('/api/web-cloner/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: rawUrl,
          maxDepth: currentMaxDepth,
          maxPages: currentMaxPages
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to clone website.');
      }

      // Mark all steps completed
      setStepState(stepSsrf, 'completed', 'Verified ✓');
      setStepState(stepBrowser, 'completed', 'Launched ✓');
      setStepState(stepRender, 'completed', 'Rendered ✓');
      setStepState(stepStorage, 'completed', 'Saved ✓');

      // Populate Result Card
      resTitle.textContent = data.title || 'Untitled Page';
      resUrl.textContent = data.originalUrl;
      resUrl.href = data.originalUrl;
      resTime.textContent = (data.renderTimeMs / 1000).toFixed(2) + 's';
      resSize.textContent = formatBytes(data.size);
      resId.textContent = data.id;

      const pages = Array.isArray(data.pages) && data.pages.length > 0 ? data.pages : [{
        url: data.originalUrl,
        localPath: 'index.html',
        title: data.title || 'Home Page',
        depth: 0,
        status: 'rendered'
      }];

      const pageCount = pages.length;
      if (resPagesCount) {
        resPagesCount.textContent = `${pageCount} Page${pageCount > 1 ? 's' : ''}`;
      }

      // Populate Asset Count
      const assetCount = data.assetCount || (data.assets ? data.assets.totalDownloaded : 0);
      if (resAssetsCount) {
        resAssetsCount.textContent = `${assetCount} File${assetCount === 1 ? '' : 's'}`;
      }

      // Populate Pre-Preview Verification Audit
      const audit = data.verificationAudit;
      if (resAuditSection) {
        if (audit) {
          if (auditStatusBadge) {
            const isPassed = audit.auditStatus === 'PASSED';
            auditStatusBadge.textContent = isPassed ? 'PASSED ✓' : 'VERIFIED (ADVISORY)';
            auditStatusBadge.className = isPassed ? 'audit-status-badge badge-pass' : 'audit-status-badge badge-warn';
          }
          if (auditScrollVal) {
            auditScrollVal.textContent = `${audit.scrollDepthPercent || 100}% Traversal`;
          }
          if (auditAnimVal) {
            const gsapText = audit.gsapTriggersSettled ? ` (${audit.gsapTriggersSettled} GSAP)` : '';
            auditAnimVal.textContent = `Settled & Primed${gsapText}`;
          }
          if (auditPreloadersVal) {
            auditPreloadersVal.textContent = `${audit.preloadersDismissed || 0} Cleared`;
          }
          if (auditGlitchesVal) {
            auditGlitchesVal.textContent = audit.glitchesResolved > 0 ? `${audit.glitchesResolved} Fixed` : 'Zero Locks';
          }
          resAuditSection.style.display = 'block';
        } else {
          resAuditSection.style.display = 'none';
        }
      }

      // Populate Technologies (Wappalyzer)
      const technologies = Array.isArray(data.technologies) ? data.technologies : [];
      if (resTechSection && resTechList) {
        if (technologies.length > 0) {
          if (techBadge) techBadge.textContent = `${technologies.length} Identified`;
          resTechList.innerHTML = technologies.map((t) => {
            return `
              <div class="tech-chip">
                <span class="tech-chip-name">${escapeHtml(t.name)}</span>
                <span class="tech-chip-cat">${escapeHtml(t.category)}</span>
              </div>
            `;
          }).join('');
          resTechSection.style.display = 'block';
        } else {
          resTechSection.style.display = 'none';
        }
      }

      if (badgeClonedLabel) {
        badgeClonedLabel.textContent = pageCount > 1 
          ? `Multi-page mirror (${pageCount} pages)` 
          : 'Local clone created';
      }

      // Render subpages list if multiple pages crawled
      if (resSubpagesSection && resSubpagesList) {
        if (pageCount > 1) {
          if (subpagesBadge) subpagesBadge.textContent = `${pageCount} Pages Crawled`;
          resSubpagesList.innerHTML = pages.map((page) => {
            const pagePreviewUrl = `/clones/${data.id}/${page.localPath}`;
            return `
              <div class="subpage-item">
                <div class="subpage-info">
                  <div class="subpage-line-1">
                    <span class="subpage-depth-badge">Depth ${page.depth ?? 0}</span>
                    <span class="subpage-title" title="${escapeHtml(page.title || page.localPath)}">${escapeHtml(page.title || page.localPath)}</span>
                  </div>
                  <div class="subpage-line-2">
                    <span class="subpage-path">${escapeHtml(page.localPath)}</span>
                    <span class="subpage-url" title="${escapeHtml(page.url)}">${escapeHtml(page.url)}</span>
                  </div>
                </div>
                <a href="${pagePreviewUrl}" target="_blank" class="subpage-preview-link" title="Open ${escapeHtml(page.localPath)} in new tab">
                  <span>Preview</span> &rarr;
                </a>
              </div>
            `;
          }).join('');
          resSubpagesSection.style.display = 'block';
        } else {
          resSubpagesSection.style.display = 'none';
        }
      }

      currentCloneData = data;
      btnOpenPreview.href = data.previewUrl;
      if (btnDownloadSource) {
        btnDownloadSource.href = `/api/web-cloner/clones/${data.id}/download`;
        btnDownloadSource.download = `${(data.title || 'clone').replace(/[^a-zA-Z0-9_-]/g, '_')}-${data.id}.zip`;
      }
      previewIframe.src = data.previewUrl;
      frameUrlLabel.textContent = window.location.origin + data.previewUrl;

      // Update Live Shareable Link
      updateLiveLinkDisplay(data);

      resultCard.style.display = 'block';

      // Poll background preload swarm progress live
      const pollInterval = setInterval(async () => {
        try {
          const stRes = await fetch(`/api/web-cloner/clones/${data.id}/preload-status`);
          if (!stRes.ok) return;
          const statusData = await stRes.json();
          if (statusData && statusData.preloadedCount > 0) {
            const totalReady = statusData.preloadedCount + 1;
            if (resPagesCount) {
              resPagesCount.textContent = `${totalReady} Pages Preloaded ⚡`;
            }
            if (resSubpagesSection && resSubpagesList && statusData.preloadedPages && statusData.preloadedPages.length > 0) {
              if (subpagesBadge) {
                subpagesBadge.textContent = statusData.completed 
                  ? `${totalReady} Pages Preloaded ✓` 
                  : `Preloading Buttons & Links (${statusData.preloadedCount}/${statusData.totalTargets})...`;
              }
              resSubpagesList.innerHTML = statusData.preloadedPages.map(p => {
                const pagePreviewUrl = `/clones/${data.id}/${p}`;
                return `
                  <div class="subpage-item">
                    <div class="subpage-info">
                      <div class="subpage-line-1">
                        <span class="subpage-depth-badge" style="background: rgba(34, 197, 94, 0.15); color: #22c55e;">⚡ Preloaded</span>
                        <span class="subpage-title">${escapeHtml(p)}</span>
                      </div>
                      <div class="subpage-line-2">
                        <span class="subpage-path">/clones/${data.id}/${escapeHtml(p)}</span>
                      </div>
                    </div>
                    <a href="${pagePreviewUrl}" target="_blank" class="subpage-preview-link">
                      <span>Preview</span> &rarr;
                    </a>
                  </div>
                `;
              }).join('');
              resSubpagesSection.style.display = 'block';
            }
          }
          if (statusData && statusData.completed) {
            clearInterval(pollInterval);
          }
        } catch (_) {}
      }, 2000);
      setTimeout(() => clearInterval(pollInterval), 90000);

      // Refresh recent clones
      loadClonesHistory();
    } catch (err) {
      clearTimeout(timer1);
      clearTimeout(timer2);

      errorTitle.textContent = 'Cloning Request Failed';
      errorMessage.textContent = err.message || 'An unexpected error occurred.';
      errorCard.style.display = 'flex';
    } finally {
      btnClone.disabled = false;
      urlInput.disabled = false;
      btnText.textContent = 'Clone Website';
      spinner.style.display = 'none';
      if (brandLogoMark) brandLogoMark.classList.remove('is-syncing');
    }
  });

  // Fetch & Render Clones History
  async function loadClonesHistory() {
    try {
      const res = await fetch('/api/web-cloner/clones');
      const data = await res.json();
      const clones = data.clones || [];

      if (clones.length === 0) {
        historyList.innerHTML = `
          <div class="history-empty">
            <img src="/img/logo.png" alt="" class="history-empty-watermark" width="48" height="48" />
            <p>No clones saved yet. Enter a URL above to create your first clone.</p>
          </div>
        `;
        return;
      }

      historyList.innerHTML = clones.map((clone) => {
        const timeAgo = new Date(clone.createdAt).toLocaleString();
        const pCount = clone.pageCount || (Array.isArray(clone.pages) ? clone.pages.length : 1);
        const pBadge = pCount > 1 ? ` &bull; <span class="h-card-pages">${pCount} pages</span>` : '';
        return `
          <div class="history-card" id="card-${escapeHtml(clone.id)}">
            <div>
              <div class="h-card-title" title="${escapeHtml(clone.title || 'Untitled')}">${escapeHtml(clone.title || 'Untitled')}</div>
              <div class="h-card-url" title="${escapeHtml(clone.originalUrl)}">${escapeHtml(clone.originalUrl)}</div>
            </div>
            <div class="h-card-meta">
              <span>${formatBytes(clone.size)} &bull; ${timeAgo}${pBadge}</span>
              <div class="h-card-actions">
                <a href="${clone.previewUrl}" target="_blank" class="h-card-btn" title="Open clone in new tab">
                  <span>Preview</span> &rarr;
                </a>
                <button type="button" class="h-card-btn btn-copy-live" data-id="${escapeHtml(clone.id)}" title="Copy live shareable link for external users">
                  <span>Share</span> 🔗
                </button>
                <a href="/api/web-cloner/clones/${escapeHtml(clone.id)}/download" class="btn-download-card" title="Download source code (.zip)" download="${escapeHtml((clone.title || 'clone').replace(/[^a-zA-Z0-9_-]/g, '_'))}-${escapeHtml(clone.id)}.zip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </a>
                <button type="button" class="btn-delete-card" data-id="${escapeHtml(clone.id)}" title="Delete clone">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  // Delete Individual Clone Handler
  historyList.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.btn-delete-card');
    if (!deleteBtn) return;

    const cloneId = deleteBtn.getAttribute('data-id');
    if (!cloneId) return;

    deleteBtn.disabled = true;
    deleteBtn.style.opacity = '0.5';

    try {
      const res = await fetch(`/api/web-cloner/clones/${cloneId}`, { method: 'DELETE' });
      if (res.ok) {
        loadClonesHistory();
      } else {
        const err = await res.json();
        alert('Failed to delete clone: ' + (err.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Delete request failed:', err);
    }
  });

  // Clear All Clones Handler
  const btnClearHistory = document.getElementById('btn-clear-history');
  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to delete all saved clone history?')) {
        return;
      }
      try {
        const res = await fetch('/api/web-cloner/clones', { method: 'DELETE' });
        if (res.ok) {
          loadClonesHistory();
        }
      } catch (err) {
        console.error('Failed to clear history:', err);
      }
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Tunnel & Live Link Logic
  function getCloneLiveUrl(cloneId) {
    if (currentTunnelStatus.active && currentTunnelStatus.url) {
      return `${currentTunnelStatus.url.replace(/\/$/, '')}/clones/${cloneId}/`;
    }
    return `${window.location.origin}/clones/${cloneId}/`;
  }

  function updateLiveLinkDisplay(data) {
    if (!data || !data.id) return;
    const liveUrl = data.publicPreviewUrl || getCloneLiveUrl(data.id);
    if (resLiveUrl && rowLiveUrl) {
      resLiveUrl.href = liveUrl;
      resLiveUrl.textContent = liveUrl;
      rowLiveUrl.style.display = 'flex';
    }
  }

  function copyTextToClipboard(text, btnElement, successText = 'Copied! ✓') {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      if (!btnElement) return;
      const originalText = btnElement.innerText || btnElement.textContent;
      btnElement.classList.add('copied');
      if (btnElement.tagName === 'BUTTON') {
        const span = btnElement.querySelector('span');
        if (span) span.textContent = successText;
        else btnElement.textContent = successText;
      }
      setTimeout(() => {
        btnElement.classList.remove('copied');
        if (btnElement.tagName === 'BUTTON') {
          const span = btnElement.querySelector('span');
          if (span) span.textContent = originalText;
          else btnElement.textContent = originalText;
        }
      }, 2500);
    }).catch(err => {
      console.warn('Clipboard write failed:', err);
      prompt('Copy this live link:', text);
    });
  }

  // Live Share Link button in result card
  if (btnCopyLiveLink) {
    btnCopyLiveLink.addEventListener('click', () => {
      if (!currentCloneData) return;
      const urlToCopy = currentCloneData.publicPreviewUrl || getCloneLiveUrl(currentCloneData.id);
      copyTextToClipboard(urlToCopy, btnCopyLiveLink, 'Live Link Copied! 🚀');
    });
  }

  if (btnQuickCopyLive) {
    btnQuickCopyLive.addEventListener('click', () => {
      if (!currentCloneData) return;
      const urlToCopy = currentCloneData.publicPreviewUrl || getCloneLiveUrl(currentCloneData.id);
      copyTextToClipboard(urlToCopy, btnQuickCopyLive, 'Copied! ✓');
    });
  }

  // History card click handler for copy live link
  historyList.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.btn-copy-live');
    if (!copyBtn) return;
    const cloneId = copyBtn.getAttribute('data-id');
    if (!cloneId) return;
    const liveUrl = getCloneLiveUrl(cloneId);
    copyTextToClipboard(liveUrl, copyBtn, 'Copied! ✓');
  });

  // Tunnel status & modal handlers
  function updateTunnelUI(status) {
    currentTunnelStatus = status;
    if (status.active && status.url) {
      tunnelStatusPill.classList.add('active');
      tunnelStatusText.textContent = 'Tunnel: Live';
      tscStatusBadge.textContent = 'LIVE ONLINE';
      tscStatusBadge.className = 'tsc-badge online';
      tscProviderLabel.textContent = status.provider || 'localtunnel';
      tscPublicUrl.value = status.url;
      tscUrlBox.style.display = 'block';
      btnToggleTunnel.textContent = 'Stop Public Tunnel';
      btnToggleTunnel.className = 'btn-danger';
    } else {
      tunnelStatusPill.classList.remove('active');
      tunnelStatusText.textContent = 'Tunnel: Offline';
      tscStatusBadge.textContent = 'OFFLINE';
      tscStatusBadge.className = 'tsc-badge offline';
      tscProviderLabel.textContent = 'localtunnel / cloudflared / ssh';
      tscUrlBox.style.display = 'none';
      btnToggleTunnel.textContent = 'Start Public Tunnel';
      btnToggleTunnel.className = 'btn-primary';
    }

    // Refresh live link display if a clone is currently shown
    if (currentCloneData) {
      updateLiveLinkDisplay(currentCloneData);
    }
  }

  async function checkTunnelStatus() {
    try {
      const res = await fetch('/api/tunnel/status');
      if (res.ok) {
        const status = await res.json();
        updateTunnelUI(status);
      }
    } catch (_) {}
  }

  if (tunnelStatusPill) {
    tunnelStatusPill.addEventListener('click', () => {
      tunnelModal.style.display = 'flex';
      checkTunnelStatus();
    });
  }

  if (btnCloseTunnelModal) {
    btnCloseTunnelModal.addEventListener('click', () => {
      tunnelModal.style.display = 'none';
    });
  }

  if (tunnelModalBackdrop) {
    tunnelModalBackdrop.addEventListener('click', () => {
      tunnelModal.style.display = 'none';
    });
  }

  if (btnCopyTunnelBase) {
    btnCopyTunnelBase.addEventListener('click', () => {
      if (currentTunnelStatus.url) {
        copyTextToClipboard(currentTunnelStatus.url, btnCopyTunnelBase, 'Copied! ✓');
      }
    });
  }

  if (btnToggleTunnel) {
    btnToggleTunnel.addEventListener('click', async () => {
      const isStarting = !currentTunnelStatus.active;
      btnToggleTunnel.disabled = true;
      btnToggleTunnel.textContent = isStarting ? 'Starting Tunnel...' : 'Stopping Tunnel...';

      try {
        const endpoint = isStarting ? '/api/tunnel/start' : '/api/tunnel/stop';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'localtunnel' })
        });
        const data = await res.json();
        if (res.ok) {
          checkTunnelStatus();
        } else {
          alert('Tunnel error: ' + (data.error || 'Failed to update tunnel.'));
        }
      } catch (err) {
        alert('Network error communicating with tunnel service: ' + err.message);
      } finally {
        btnToggleTunnel.disabled = false;
      }
    });
  }

  // Hook into bridge events for real-time tunnel state
  if (window.__REBUILT_BRIDGE__ && typeof window.__REBUILT_BRIDGE__.on === 'function') {
    window.__REBUILT_BRIDGE__.on('tunnel:connected', (data) => {
      updateTunnelUI({ active: true, url: data.url, provider: data.provider });
    });
    window.__REBUILT_BRIDGE__.on('tunnel:disconnected', () => {
      updateTunnelUI({ active: false, url: null });
    });
  }

  // Check initial tunnel state
  checkTunnelStatus();

  btnRefreshHistory.addEventListener('click', loadClonesHistory);

  // Initial load
  loadClonesHistory();
});
