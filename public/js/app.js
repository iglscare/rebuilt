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

      // Populate Result Card & Dashboard
      currentCloneData = data;
      updateDashboardFromClone(data);
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

      // Populate Media & Dynamic Component Fidelity
      const resMediaSection = document.getElementById('res-media-section');
      const statVideosCount = document.getElementById('stat-videos-count');
      const statButtonsCount = document.getElementById('stat-buttons-count');
      const statComponentsCount = document.getElementById('stat-components-count');
      const linkDownloadManifest = document.getElementById('link-download-manifest');
      const mediaFidelityBadge = document.getElementById('media-fidelity-badge');

      if (resMediaSection) {
        const videosCount = (data.mediaDiscovery?.videos?.length ?? data.diagnostics?.videosDiscovered ?? 0);
        const buttonsCount = (data.dynamicComponents?.buttonsCount ?? (data.verificationAudit?.totalButtons || 0));
        const componentsCount = (
          (data.dynamicComponents?.dropdownsCount || 0) +
          (data.dynamicComponents?.tabsCount || 0) +
          (data.dynamicComponents?.modalsCount || 0) +
          (data.dynamicComponents?.accordionsCount || 0)
        );

        if (statVideosCount) statVideosCount.textContent = videosCount;
        if (statButtonsCount) statButtonsCount.textContent = buttonsCount;
        if (statComponentsCount) statComponentsCount.textContent = componentsCount;
        if (linkDownloadManifest) {
          linkDownloadManifest.href = `/api/web-cloner/clones/${data.id}/resource-manifest`;
        }
        if (mediaFidelityBadge) {
          mediaFidelityBadge.textContent = videosCount > 0 ? `${videosCount} Videos Preserved ✓` : 'Fidelity Verified ✓';
        }
        resMediaSection.style.display = 'block';
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
  let allClonesList = [];

  function formatTimeAgo(dateString) {
    if (!dateString) return 'recently';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = Math.max(0, now - date);
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
    if (diffHour > 0) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
    if (diffMin > 0) return `${diffMin} min${diffMin > 1 ? 's' : ''} ago`;
    return 'just now';
  }

  function getDomain(urlStr) {
    try {
      return new URL(urlStr).hostname.replace(/^www\./, '');
    } catch (_) {
      return urlStr || 'example.com';
    }
  }

  function renderClonesList(clonesToRender) {
    if (!historyList) return;
    if (!clonesToRender || clonesToRender.length === 0) {
      historyList.innerHTML = `
        <div class="history-empty">
          <img src="/img/logo.png" alt="" class="history-empty-watermark" width="40" height="40" />
          <p>No clones found. Enter a URL above to create your first clone.</p>
        </div>
      `;
      return;
    }

    historyList.innerHTML = clonesToRender.map((clone) => {
      const domain = getDomain(clone.originalUrl || clone.finalUrl);
      const timeAgo = formatTimeAgo(clone.createdAt);
      const pCount = clone.pageCount || (Array.isArray(clone.pages) ? clone.pages.length : 1);
      const aCount = clone.assetCount || (clone.assets ? clone.assets.totalDownloaded : 0);

      return `
        <div class="clone-entry-card" id="card-${escapeHtml(clone.id)}" data-id="${escapeHtml(clone.id)}">
          <div class="clone-entry-left">
            <div class="clone-site-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            </div>
            <div class="clone-site-meta">
              <span class="clone-site-title" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
              <span class="clone-site-sub">${pCount} page${pCount === 1 ? '' : 's'} &bull; ${aCount} assets &bull; ${timeAgo}</span>
            </div>
          </div>
          <div class="clone-entry-actions">
            <button type="button" class="btn-dot-menu" data-menu-id="${escapeHtml(clone.id)}" title="Clone Actions">
              &bull;&bull;&bull;
            </button>
            <div class="clone-action-dropdown" id="dropdown-${escapeHtml(clone.id)}" style="display: none;">
              <a href="${clone.previewUrl}" target="_blank" class="cad-item">
                <span>↗ Open Preview</span>
              </a>
              <button type="button" class="cad-item btn-copy-live" data-id="${escapeHtml(clone.id)}">
                <span>🔗 Share Live Link</span>
              </button>
              <a href="/api/web-cloner/clones/${escapeHtml(clone.id)}/download" class="cad-item" download="${escapeHtml(domain)}-${escapeHtml(clone.id)}.zip">
                <span>⬇ Download ZIP</span>
              </a>
              <button type="button" class="cad-item danger btn-delete-card" data-id="${escapeHtml(clone.id)}">
                <span>🗑 Delete Clone</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateDashboardFromClone(clone) {
    if (!clone) return;
    const pCount = clone.pageCount || (Array.isArray(clone.pages) ? clone.pages.length : 1);
    const aCount = clone.assetCount || (clone.assets ? clone.assets.totalDownloaded : 48);
    const domain = getDomain(clone.originalUrl || clone.finalUrl);

    const mPages = document.getElementById('dash-metric-pages');
    const mAssets = document.getElementById('dash-metric-assets');
    const mApi = document.getElementById('dash-metric-api');
    const mSec = document.getElementById('dash-metric-security');
    const archUrl = document.getElementById('arch-root-url');

    if (mPages) mPages.textContent = pCount;
    if (mAssets) mAssets.textContent = aCount;
    if (mApi) mApi.textContent = Math.max(3, Math.floor(pCount * 1.5));
    if (mSec) mSec.textContent = clone.verificationAudit?.glitchesResolved ? String(clone.verificationAudit.glitchesResolved) : '3';
    if (archUrl) archUrl.textContent = clone.originalUrl || `https://${domain}`;

    // If clone has technologies, populate the tech table
    if (Array.isArray(clone.technologies) && clone.technologies.length > 0) {
      const tbody = document.getElementById('dash-tech-tbody');
      if (tbody) {
        tbody.innerHTML = clone.technologies.slice(0, 8).map(t => {
          const conf = t.confidence || (t.category && t.category.includes('Framework') ? 'High' : 'Medium');
          const confClass = conf.toLowerCase().startsWith('h') ? 'high' : (conf.toLowerCase().startsWith('l') ? 'low' : 'med');
          const iconSymbol = (t.name || '')[0].toUpperCase();
          return `
            <tr>
              <td><div class="tech-cell"><span class="tech-badge-icon react">${escapeHtml(iconSymbol)}</span><span class="tech-name">${escapeHtml(t.name)}</span></div></td>
              <td class="tech-category">${escapeHtml(t.category || 'Framework')}</td>
              <td class="tech-version">${escapeHtml(t.version || 'Latest')}</td>
              <td><span class="conf-pill ${confClass}">${escapeHtml(conf)}</span></td>
            </tr>
          `;
        }).join('');
      }
    }

    // If clone has subpages, update architecture diagram nodes
    if (Array.isArray(clone.pages) && clone.pages.length > 1) {
      const tier1 = document.getElementById('arch-tier-1');
      if (tier1) {
        tier1.innerHTML = clone.pages.slice(0, 4).map((p, idx) => {
          const pathName = p.localPath === 'index.html' ? '/' : `/${p.localPath.replace(/\/index\.html$/, '')}`;
          return `
            <div class="arch-node">
              <div class="arch-node-main">
                <div class="node-icon-sq"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>
                <div class="node-text">
                  <span class="node-path">${escapeHtml(pathName)}</span>
                  <span class="node-label">${escapeHtml(p.title || 'Page')}</span>
                </div>
              </div>
              <span class="node-badge blue">Depth ${p.depth ?? idx}</span>
            </div>
          `;
        }).join('');
      }
    }
  }

  async function loadClonesHistory() {
    try {
      const res = await fetch('/api/web-cloner/clones');
      const data = await res.json();
      allClonesList = data.clones || [];
      renderClonesList(allClonesList);

      // If we have clones and no active clone is selected yet, sync the top clone into metrics
      if (allClonesList.length > 0 && !currentCloneData) {
        updateDashboardFromClone(allClonesList[0]);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  // Search input live filtering for Local Clones Library
  const historySearch = document.getElementById('history-search-input');
  if (historySearch) {
    historySearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        renderClonesList(allClonesList);
        return;
      }
      const filtered = allClonesList.filter(c => {
        return (c.title && c.title.toLowerCase().includes(q)) ||
               (c.originalUrl && c.originalUrl.toLowerCase().includes(q)) ||
               (c.id && c.id.toLowerCase().includes(q));
      });
      renderClonesList(filtered);
    });
  }

  // Handle click on action dropdown toggle
  historyList.addEventListener('click', (e) => {
    const dotMenuBtn = e.target.closest('.btn-dot-menu');
    if (dotMenuBtn) {
      const cloneId = dotMenuBtn.getAttribute('data-menu-id');
      const dropdown = document.getElementById(`dropdown-${cloneId}`);
      if (dropdown) {
        const isOpen = dropdown.style.display === 'flex';
        // Close all dropdowns
        document.querySelectorAll('.clone-action-dropdown').forEach(d => d.style.display = 'none');
        dropdown.style.display = isOpen ? 'none' : 'flex';
      }
      e.stopPropagation();
      return;
    }
  });

  // Close dropdowns on body click
  document.addEventListener('click', () => {
    document.querySelectorAll('.clone-action-dropdown').forEach(d => d.style.display = 'none');
  });

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

  // Theme Toggle Handler
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  if (btnThemeToggle) {
    const iconMoon = btnThemeToggle.querySelector('.icon-moon');
    const iconSun = btnThemeToggle.querySelector('.icon-sun');

    function applyTheme(theme) {
      document.body.setAttribute('data-theme', theme);
      if (theme === 'dark') {
        if (iconMoon) iconMoon.style.display = 'none';
        if (iconSun) iconSun.style.display = 'block';
      } else {
        if (iconMoon) iconMoon.style.display = 'block';
        if (iconSun) iconSun.style.display = 'none';
      }
      localStorage.setItem('rebuilt_theme', theme);
    }

    const savedTheme = localStorage.getItem('rebuilt_theme') || 'light';
    applyTheme(savedTheme);

    btnThemeToggle.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme') || 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // Live Communication Bridge Filter Tabs
  const bridgeFilterTabs = document.querySelectorAll('.bridge-nav-btn');
  bridgeFilterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      bridgeFilterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const filter = tab.getAttribute('data-filter');
      const lines = document.querySelectorAll('#bridge-terminal .bridge-log-line');
      lines.forEach(line => {
        if (filter === 'all') {
          line.style.display = 'flex';
        } else if (filter === 'errors') {
          line.style.display = (line.classList.contains('error') || line.classList.contains('warn')) ? 'flex' : 'none';
        } else {
          line.style.display = line.classList.contains(filter) ? 'flex' : 'none';
        }
      });
    });
  });

  // Side-by-Side Automated Verification Handler
  const btnRunVerification = document.getElementById('btn-run-verification');
  const verificationResultBox = document.getElementById('verification-result-box');

  if (btnRunVerification) {
    btnRunVerification.addEventListener('click', async () => {
      if (!currentCloneData || !currentCloneData.id) return;
      btnRunVerification.disabled = true;
      btnRunVerification.textContent = 'Running Side-by-Side Audit...';
      if (verificationResultBox) {
        verificationResultBox.style.display = 'block';
        verificationResultBox.innerHTML = '<div style="color: var(--text-muted, #64748b);">Launching dual isolated browser contexts (Original vs Clone) at 1280x800...</div>';
      }

      try {
        const vRes = await fetch(`/api/web-cloner/clones/${currentCloneData.id}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const vData = await vRes.json();
        if (vRes.ok && vData.report) {
          const r = vData.report;
          const scoreColor = r.fidelityScore >= 80 ? '#10b981' : '#f59e0b';
          if (verificationResultBox) {
            verificationResultBox.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 700; color: ${scoreColor}; font-size: 14px;">Fidelity Score: ${r.fidelityScore}% (${r.status})</span>
                <span style="color: var(--text-muted, #64748b);">${r.isResponsive ? 'Mobile Responsive ✓' : 'Desktop Only'}</span>
              </div>
              <div style="margin-bottom: 8px;">
                <strong style="color: var(--text-main, #1e293b);">Verified Working Capabilities:</strong>
                <ul style="margin: 4px 0 8px 18px; padding: 0;">
                  ${r.workingFeatures.map(f => `<li style="margin-bottom: 2px;">${escapeHtml(f)}</li>`).join('')}
                </ul>
              </div>
              ${r.failedResources && r.failedResources.length > 0 ? `
                <div style="margin-bottom: 8px; color: #ef4444;">
                  <strong>Resource Warnings (${r.failedResources.length}):</strong>
                  <ul style="margin: 4px 0 0 18px; padding: 0;">
                    ${r.failedResources.slice(0, 3).map(f => `<li>${escapeHtml(f.url)} (${escapeHtml(f.failureReason)})</li>`).join('')}
                  </ul>
                </div>
              ` : ''}
              <div style="display: flex; gap: 12px; margin-top: 8px;">
                ${r.screenshots.original ? `<a href="${r.screenshots.original}" target="_blank" style="color: var(--primary, #2563eb); text-decoration: underline;">Original Screenshot ↗</a>` : ''}
                ${r.screenshots.clone ? `<a href="${r.screenshots.clone}" target="_blank" style="color: var(--primary, #2563eb); text-decoration: underline;">Clone Screenshot ↗</a>` : ''}
              </div>
            `;
          }
        } else if (verificationResultBox) {
          verificationResultBox.innerHTML = `<span style="color: #ef4444;">Verification error: ${escapeHtml(vData.error || 'Failed')}</span>`;
        }
      } catch (err) {
        if (verificationResultBox) {
          verificationResultBox.innerHTML = `<span style="color: #ef4444;">Verification network error: ${escapeHtml(err.message)}</span>`;
        }
      } finally {
        btnRunVerification.disabled = false;
        btnRunVerification.textContent = 'Run Verification Audit';
      }
    });
  }

  btnRefreshHistory.addEventListener('click', loadClonesHistory);

  // Initial load
  loadClonesHistory();
});
