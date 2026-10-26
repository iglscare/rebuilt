/**
 * Universal Authenticated Member Dashboard & User Center Generator
 * For Rebuilt Web Cloner
 *
 * Generates a high-fidelity, interactive member dashboard matching the cloned
 * website's aesthetic, providing working after-login pages (Profile, Notifications,
 * Daily Check-In, Posts, Account Settings) with zero CORS or 404 errors.
 */

function generateAuthDashboardHtml(options = {}) {
  const {
    title = 'HoYoLAB - Player Community',
    baseUrl = 'https://www.hoyolab.com/',
    cloneId = '',
    theme = 'dark',
    username = 'Rebuilt Member',
    uid = '108492041',
    level = 8,
    activeTab = 'posts'
  } = options;

  const homeUrl = cloneId ? `/clones/${cloneId}/` : '/';

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" style="margin: 0; padding: 0; background: #0c0f1d; color: #f5f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Member Center</title>
  <script id="rebuilt-clone-context">window.__REBUILT_ORIGINAL_URL__ = "${baseUrl}"; window.__REBUILT_CLONE_ID__ = "${cloneId}";</script>
  
  <style>
    :root {
      --bg-base: #0c0f1d;
      --bg-card: rgba(24, 28, 47, 0.85);
      --bg-card-hover: rgba(33, 38, 64, 0.95);
      --border-color: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(59, 130, 246, 0.4);
      --accent: #3b82f6;
      --accent-glow: rgba(59, 130, 246, 0.25);
      --text-main: #f5f6f9;
      --text-muted: #94a3b8;
      --gold: #f59e0b;
      --green: #10b981;
      --radius-sm: 8px;
      --radius-md: 14px;
      --radius-lg: 20px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-base);
      color: var(--text-main);
      min-height: 100vh;
      overflow-x: hidden;
      overflow-y: auto !important;
      display: flex;
      flex-direction: column;
    }

    /* Top Navigation Bar */
    .rebuilt-nav {
      position: sticky;
      top: 0;
      z-index: 1000;
      height: 64px;
      background: rgba(12, 15, 29, 0.92);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 32px;
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 14px;
      text-decoration: none;
      color: var(--text-main);
    }

    .nav-brand-logo {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
      color: #fff;
      box-shadow: 0 4px 14px var(--accent-glow);
    }

    .nav-brand-name {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.2px;
      background: linear-gradient(135deg, #ffffff 60%, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .nav-menu {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .nav-link {
      padding: 8px 16px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      border-radius: var(--radius-sm);
      transition: all 0.2s ease;
    }

    .nav-link:hover, .nav-link.active {
      color: #fff;
      background: rgba(255, 255, 255, 0.06);
    }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .nav-back-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 18px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s ease;
    }

    .nav-back-btn:hover {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.2);
      transform: translateY(-1px);
    }

    .nav-avatar-btn {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 12px 4px 4px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      border-radius: 999px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .nav-avatar-btn:hover {
      background: rgba(255, 255, 255, 0.09);
      border-color: var(--border-hover);
    }

    .nav-avatar-img {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #1e233d;
      border: 2px solid var(--accent);
      object-fit: cover;
    }

    .nav-avatar-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
    }

    .nav-avatar-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--gold);
      color: #000;
    }

    /* Main Container */
    .rebuilt-main {
      flex: 1;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
      padding: 24px 20px 60px;
    }

    /* Hero Profile Banner */
    .profile-hero {
      position: relative;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      overflow: hidden;
      margin-bottom: 24px;
      backdrop-filter: blur(16px);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
    }

    .hero-banner-cover {
      height: 180px;
      background: linear-gradient(135deg, #1e1b4b 0%, #1e293b 50%, #0f172a 100%);
      position: relative;
      overflow: hidden;
    }

    .hero-banner-cover::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 20% 40%, rgba(99, 102, 241, 0.4) 0%, transparent 60%),
                  radial-gradient(circle at 80% 60%, rgba(59, 130, 246, 0.4) 0%, transparent 60%);
    }

    .hero-banner-badge {
      position: absolute;
      top: 16px;
      right: 20px;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      font-size: 12px;
      font-weight: 500;
      color: #38bdf8;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .hero-body {
      padding: 0 32px 28px;
      position: relative;
    }

    .hero-avatar-row {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      margin-top: -50px;
      margin-bottom: 18px;
      flex-wrap: wrap;
      gap: 16px;
    }

    .avatar-wrapper {
      position: relative;
      width: 104px;
      height: 104px;
      border-radius: 50%;
      background: var(--bg-base);
      padding: 4px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }

    .avatar-img {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
      background: #1e233d;
      border: 2px solid rgba(255, 255, 255, 0.15);
    }

    .avatar-level-tag {
      position: absolute;
      bottom: 2px;
      right: 2px;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #000;
      font-size: 11px;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 999px;
      border: 2px solid var(--bg-base);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    }

    .hero-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: var(--radius-sm);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .btn-primary {
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: #fff;
      box-shadow: 0 4px 14px var(--accent-glow);
    }

    .btn-primary:hover {
      background: linear-gradient(135deg, #60a5fa, #3b82f6);
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-main);
      border: 1px solid var(--border-color);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .hero-info-name-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 6px;
    }

    .hero-name {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
    }

    .verified-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #60a5fa;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
    }

    .hero-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .uid-tag {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      transition: all 0.2s;
    }

    .uid-tag:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    .hero-bio {
      font-size: 14px;
      color: #cbd5e1;
      max-width: 680px;
      line-height: 1.5;
    }

    /* Stats Grid */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 18px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.2s ease;
    }

    .stat-card:hover {
      border-color: var(--border-hover);
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
    }

    .stat-label {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
    }

    .stat-icon {
      width: 42px;
      height: 42px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .icon-blue { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
    .icon-green { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .icon-gold { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .icon-purple { background: rgba(139, 92, 246, 0.15); color: #a78bfa; }

    /* Tabs Bar */
    .tabs-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 24px;
      padding-bottom: 4px;
      overflow-x: auto;
    }

    .tab-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      background: transparent;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .tab-item:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.05);
    }

    .tab-item.active {
      color: #fff;
      background: rgba(59, 130, 246, 0.16);
      border-bottom: 2px solid var(--accent);
    }

    /* Content Panels */
    .tab-panel {
      display: none;
      animation: fadeIn 0.3s ease;
    }

    .tab-panel.active {
      display: block;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Posts List */
    .posts-grid {
      display: grid;
      gap: 16px;
    }

    .post-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 22px;
      transition: all 0.2s ease;
    }

    .post-card:hover {
      border-color: var(--border-hover);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    }

    .post-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .post-category {
      font-size: 12px;
      font-weight: 600;
      color: #60a5fa;
      background: rgba(59, 130, 246, 0.12);
      padding: 3px 10px;
      border-radius: 999px;
    }

    .post-time {
      font-size: 12px;
      color: var(--text-muted);
    }

    .post-title {
      font-size: 17px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 8px;
      line-height: 1.4;
    }

    .post-snippet {
      font-size: 14px;
      color: #cbd5e1;
      line-height: 1.6;
      margin-bottom: 16px;
    }

    .post-footer {
      display: flex;
      align-items: center;
      gap: 20px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .post-action {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: color 0.15s ease;
      background: none;
      border: none;
      color: inherit;
      font-size: inherit;
    }

    .post-action:hover, .post-action.liked {
      color: #ef4444;
    }

    /* Check-In Calendar */
    .checkin-container {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 28px;
    }

    .checkin-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }

    .checkin-title {
      font-size: 20px;
      font-weight: 700;
      color: #fff;
    }

    .checkin-days-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }

    .day-reward-card {
      background: rgba(12, 15, 29, 0.6);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 16px 12px;
      text-align: center;
      transition: all 0.2s ease;
      position: relative;
    }

    .day-reward-card.claimed {
      border-color: rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.08);
    }

    .day-reward-card.today {
      border-color: var(--accent);
      box-shadow: 0 0 16px var(--accent-glow);
    }

    .reward-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }

    .reward-amount {
      font-size: 14px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 4px;
    }

    .reward-day {
      font-size: 11px;
      color: var(--text-muted);
    }

    .reward-claimed-stamp {
      position: absolute;
      top: 6px;
      right: 6px;
      font-size: 10px;
      font-weight: 700;
      color: #10b981;
      background: rgba(16, 185, 129, 0.2);
      padding: 2px 6px;
      border-radius: 999px;
    }

    /* Notification Feed */
    .notif-list {
      display: grid;
      gap: 12px;
    }

    .notif-item {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 18px 20px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
      transition: all 0.2s ease;
    }

    .notif-item.unread {
      border-left: 4px solid var(--accent);
      background: rgba(30, 36, 60, 0.85);
    }

    .notif-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }

    .notif-title {
      font-size: 15px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 4px;
    }

    .notif-body {
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.5;
    }

    .notif-time {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 6px;
    }

    /* Settings Panel */
    .settings-group {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 24px;
      margin-bottom: 20px;
    }

    .settings-title {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 18px;
    }

    .settings-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .settings-row:last-child {
      border-bottom: none;
    }

    .settings-label {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }

    .settings-desc {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .toggle-switch {
      position: relative;
      width: 46px;
      height: 24px;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background-color: rgba(255, 255, 255, 0.15);
      transition: 0.3s;
      border-radius: 24px;
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: 0.3s;
      border-radius: 50%;
    }

    input:checked + .slider {
      background-color: var(--accent);
    }

    input:checked + .slider:before {
      transform: translateX(22px);
    }

    /* Toast Notification */
    .rebuilt-toast {
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: rgba(20, 24, 40, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(16px);
      color: #fff;
      padding: 12px 26px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: none;
    }

    .rebuilt-toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .rebuilt-nav { padding: 0 16px; }
      .nav-menu { display: none; }
      .hero-body { padding: 0 16px 20px; }
      .hero-avatar-row { margin-top: -40px; }
      .avatar-wrapper { width: 80px; height: 80px; }
    }
  </style>
</head>
<body>

  <!-- Top Navigation Header -->
  <header class="rebuilt-nav">
    <a href="${homeUrl}" class="nav-brand">
      <div class="nav-brand-logo">H</div>
      <span class="nav-brand-name">HoYoLAB</span>
    </a>

    <nav class="nav-menu">
      <a href="${homeUrl}" class="nav-link">Home</a>
      <a href="${homeUrl}" class="nav-link">Circles</a>
      <a href="${homeUrl}" class="nav-link">Tavern</a>
      <a href="${homeUrl}" class="nav-link">Guides</a>
      <a href="javascript:void(0)" class="nav-link active">Member Center</a>
    </nav>

    <div class="nav-actions">
      <a href="${homeUrl}" class="nav-back-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back to Site
      </a>

      <div class="nav-avatar-btn" id="avatarMenuBtn" onclick="switchTab('settings')">
        <img src="https://www.hoyolab.com/_static/img/default_avatar.25aeebf.png" class="nav-avatar-img" alt="Avatar">
        <span class="nav-avatar-name" id="navUsername">${username}</span>
        <span class="nav-avatar-badge">Lv.${level}</span>
      </div>
    </div>
  </header>

  <!-- Main User Center Content -->
  <main class="rebuilt-main">

    <!-- Profile Hero Card -->
    <section class="profile-hero">
      <div class="hero-banner-cover">
        <div class="hero-banner-badge">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#38bdf8;box-shadow:0 0 8px #38bdf8;"></span>
          Clone Preview Session Active
        </div>
      </div>

      <div class="hero-body">
        <div class="hero-avatar-row">
          <div class="avatar-wrapper">
            <img src="https://www.hoyolab.com/_static/img/default_avatar.25aeebf.png" class="avatar-img" id="heroAvatarImg" alt="Avatar">
            <div class="avatar-level-tag">Lv.${level}</div>
          </div>

          <div class="hero-actions">
            <button class="btn-action btn-secondary" onclick="editProfile()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit Profile
            </button>
            <button class="btn-action btn-primary" onclick="createPost()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Create Post
            </button>
          </div>
        </div>

        <div class="hero-info-name-row">
          <h1 class="hero-name" id="heroUsername">${username}</h1>
          <span class="verified-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            Verified Traveler
          </span>
        </div>

        <div class="hero-meta">
          <span class="uid-tag" onclick="copyUid()" title="Click to copy UID">
            UID: <strong id="uidDisplay">${uid}</strong>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </span>
          <span>IP Region: Earth</span>
          <span>Registered: September 2026</span>
        </div>

        <p class="hero-bio" id="heroBio">🌟 Exploring cloned virtual worlds. Rebuilt Member since 2026.</p>
      </div>
    </section>

    <!-- Stats Ribbon -->
    <section class="stats-row">
      <div class="stat-card">
        <div>
          <div class="stat-label">Posts</div>
          <div class="stat-value" id="statsPosts">24</div>
        </div>
        <div class="stat-icon icon-blue">📝</div>
      </div>

      <div class="stat-card">
        <div>
          <div class="stat-label">Following</div>
          <div class="stat-value">142</div>
        </div>
        <div class="stat-icon icon-green">👥</div>
      </div>

      <div class="stat-card">
        <div>
          <div class="stat-label">Followers</div>
          <div class="stat-value">1,280</div>
        </div>
        <div class="stat-icon icon-gold">⭐</div>
      </div>

      <div class="stat-card">
        <div>
          <div class="stat-label">Likes Received</div>
          <div class="stat-value" id="statsLikes">8,920</div>
        </div>
        <div class="stat-icon icon-purple">❤️</div>
      </div>
    </section>

    <!-- Navigation Tabs -->
    <nav class="tabs-bar">
      <button class="tab-item ${activeTab === 'posts' ? 'active' : ''}" onclick="switchTab('posts')">
        <span>📝</span> My Posts
      </button>
      <button class="tab-item ${activeTab === 'favorites' ? 'active' : ''}" onclick="switchTab('favorites')">
        <span>⭐</span> Favorites
      </button>
      <button class="tab-item ${activeTab === 'checkin' ? 'active' : ''}" onclick="switchTab('checkin')">
        <span>📅</span> Daily Check-In
      </button>
      <button class="tab-item ${activeTab === 'notifications' ? 'active' : ''}" onclick="switchTab('notifications')">
        <span>🔔</span> Notifications <span style="background: #ef4444; color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 999px;">2</span>
      </button>
      <button class="tab-item ${activeTab === 'settings' ? 'active' : ''}" onclick="switchTab('settings')">
        <span>⚙️</span> Account Settings
      </button>
    </nav>

    <!-- TAB 1: Posts Panel -->
    <div id="panel-posts" class="tab-panel ${activeTab === 'posts' ? 'active' : ''}">
      <div class="posts-grid" id="postsListContainer">
        <article class="post-card">
          <div class="post-header">
            <span class="post-category">Honkai: Star Rail</span>
            <span class="post-time">2 hours ago</span>
          </div>
          <h2 class="post-title">Complete Simulated Universe Path Resonance & Curio Optimization Guide</h2>
          <p class="post-snippet">Detailed walkthrough breaking down blessing synergies, speed thresholds, and recommended curio choices to maximize weekly planar ornament farming efficiency.</p>
          <div class="post-footer">
            <button class="post-action" onclick="toggleLike(this, 342)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span>342</span>
            </button>
            <div class="post-action">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>58</span>
            </div>
            <div class="post-action">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              <span>Share</span>
            </div>
          </div>
        </article>

        <article class="post-card">
          <div class="post-header">
            <span class="post-category">Genshin Impact</span>
            <span class="post-time">Yesterday</span>
          </div>
          <h2 class="post-title">Natlan Exploration Route & Hidden Chest Locations with Map Pin Markers</h2>
          <p class="post-snippet">Found all 45 hidden pyro oculus locations and sacred flame mechanism puzzles across the latest expansion region. Bookmarked pins included below.</p>
          <div class="post-footer">
            <button class="post-action" onclick="toggleLike(this, 819)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span>819</span>
            </button>
            <div class="post-action">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>124</span>
            </div>
            <div class="post-action">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              <span>Share</span>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- TAB 2: Favorites Panel -->
    <div id="panel-favorites" class="tab-panel ${activeTab === 'favorites' ? 'active' : ''}">
      <div class="posts-grid">
        <article class="post-card">
          <div class="post-header">
            <span class="post-category">Zenless Zone Zero</span>
            <span class="post-time">Bookmarked 3 days ago</span>
          </div>
          <h2 class="post-title">Hollow Zero W-Engine Synergy Matrix & Disk Drive Best-in-Slot Builds</h2>
          <p class="post-snippet">Optimal anomaly attribute rotations and energy regen scaling for Ellen Joe, Zhu Yuan, and Jane Doe.</p>
          <div class="post-footer">
            <button class="post-action" onclick="toggleLike(this, 1420)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span>1,420</span>
            </button>
            <div class="post-action">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>210</span>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- TAB 3: Daily Check-In Panel -->
    <div id="panel-checkin" class="tab-panel ${activeTab === 'checkin' ? 'active' : ''}">
      <div class="checkin-container">
        <div class="checkin-header">
          <div>
            <h2 class="checkin-title">Daily Community Check-In</h2>
            <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Check in daily to claim in-game resources, Primogems, Stellar Jades, and Polychromes!</p>
          </div>
          <button class="btn-action btn-primary" id="claimCheckinBtn" onclick="claimDailyReward()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
            <span id="claimBtnText">Claim Today's Reward</span>
          </button>
        </div>

        <div class="checkin-days-grid">
          <div class="day-reward-card claimed">
            <span class="reward-claimed-stamp">✓ Done</span>
            <div class="reward-icon">💎</div>
            <div class="reward-amount">x20 Primogems</div>
            <div class="reward-day">Day 1</div>
          </div>
          <div class="day-reward-card claimed">
            <span class="reward-claimed-stamp">✓ Done</span>
            <div class="reward-icon">📜</div>
            <div class="reward-amount">x3 Hero's Wit</div>
            <div class="reward-day">Day 2</div>
          </div>
          <div class="day-reward-card today" id="day3Card">
            <div class="reward-icon">💎</div>
            <div class="reward-amount">x20 Stellar Jades</div>
            <div class="reward-day">Day 3 (Today)</div>
          </div>
          <div class="day-reward-card">
            <div class="reward-icon">🪙</div>
            <div class="reward-amount">x10,000 Mora</div>
            <div class="reward-day">Day 4</div>
          </div>
          <div class="day-reward-card">
            <div class="reward-icon">🗡️</div>
            <div class="reward-amount">x5 Mystic Ore</div>
            <div class="reward-day">Day 5</div>
          </div>
          <div class="day-reward-card">
            <div class="reward-icon">💎</div>
            <div class="reward-amount">x30 Polychromes</div>
            <div class="reward-day">Day 6</div>
          </div>
          <div class="day-reward-card">
            <div class="reward-icon">🎁</div>
            <div class="reward-amount">x60 Primogems</div>
            <div class="reward-day">Day 7 (Grand)</div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 4: Notifications Panel -->
    <div id="panel-notifications" class="tab-panel ${activeTab === 'notifications' ? 'active' : ''}">
      <div class="notif-list">
        <div class="notif-item unread">
          <div class="notif-icon">🎉</div>
          <div>
            <div class="notif-title">Welcome to your Authenticated Member Center!</div>
            <div class="notif-body">Your account is fully synchronized with the cloned preview environment. All member features, check-ins, posts, and profile management are now active.</div>
            <div class="notif-time">Just now</div>
          </div>
        </div>

        <div class="notif-item unread">
          <div class="notif-icon">🛡️</div>
          <div>
            <div class="notif-title">Security & Sandbox Verification Passed</div>
            <div class="notif-body">CORS-isolated API routes have been established. Client-side state transitions will no longer trigger 404 redirections.</div>
            <div class="notif-time">10 minutes ago</div>
          </div>
        </div>

        <div class="notif-item">
          <div class="notif-icon">⭐</div>
          <div>
            <div class="notif-title">Paimon commented on your post</div>
            <div class="notif-body">"Paimon thinks that Natlan guide was the best one ever written! Let's go grab some Sweet Madame!"</div>
            <div class="notif-time">1 day ago</div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 5: Account Settings Panel -->
    <div id="panel-settings" class="tab-panel ${activeTab === 'settings' ? 'active' : ''}">
      <div class="settings-group">
        <h3 class="settings-title">Profile Preferences</h3>
        <div class="settings-row">
          <div>
            <div class="settings-label">Public Profile Visibility</div>
            <div class="settings-desc">Allow community members to view your character showcases and posts</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" checked onchange="showToast('Profile visibility updated')">
            <span class="slider"></span>
          </label>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-label">In-Game Battle Chronicle Sync</div>
            <div class="settings-desc">Real-time stats from Genshin Impact, Honkai: Star Rail & ZZZ</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" checked onchange="showToast('Battle Chronicle sync active')">
            <span class="slider"></span>
          </label>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-label">Push Notifications</div>
            <div class="settings-desc">Receive notifications for game event reminders and daily check-ins</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" checked onchange="showToast('Notification settings saved')">
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div class="settings-group">
        <h3 class="settings-title">Session & Actions</h3>
        <div class="settings-row">
          <div>
            <div class="settings-label">Active Session</div>
            <div class="settings-desc">UID ${uid} (Local Rebuilt Session)</div>
          </div>
          <button class="btn-action btn-secondary" onclick="toggleSessionLogout()" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">
            Log Out / Switch Account
          </button>
        </div>
      </div>
    </div>

  </main>

  <!-- Interactive Toast Notification -->
  <div id="rebuiltToast" class="rebuilt-toast">
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981;"></span>
    <span id="toastMessage">Action completed</span>
  </div>

  <script>
    // Tab Switching
    function switchTab(tabName) {
      document.querySelectorAll('.tab-item').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });

      const targetBtn = Array.from(document.querySelectorAll('.tab-item')).find(function(b) {
        return b.getAttribute('onclick') && b.getAttribute('onclick').includes(tabName);
      });
      if (targetBtn) targetBtn.classList.add('active');

      const targetPanel = document.getElementById('panel-' + tabName);
      if (targetPanel) targetPanel.classList.add('active');
    }

    // Interactive Toast Helper
    let toastTimer = null;
    function showToast(msg) {
      const toast = document.getElementById('rebuiltToast');
      const text = document.getElementById('toastMessage');
      if (!toast || !text) return;
      text.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function() {
        toast.classList.remove('show');
      }, 3000);
    }

    // UID Copy
    function copyUid() {
      const uid = document.getElementById('uidDisplay').textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(uid).then(function() {
          showToast('✓ Copied UID: ' + uid);
        }).catch(function() {
          showToast('✓ UID: ' + uid);
        });
      } else {
        showToast('✓ UID: ' + uid);
      }
    }

    // Like Button Toggle
    function toggleLike(btn, baseCount) {
      const isLiked = btn.classList.toggle('liked');
      const span = btn.querySelector('span');
      if (span) {
        span.textContent = isLiked ? (baseCount + 1) : baseCount;
      }
      showToast(isLiked ? '❤️ Liked post!' : 'Unliked post');
    }

    // Daily Reward Claim
    let claimed = false;
    function claimDailyReward() {
      if (claimed) {
        showToast('You have already claimed today\\'s reward!');
        return;
      }
      claimed = true;
      const btn = document.getElementById('claimCheckinBtn');
      const txt = document.getElementById('claimBtnText');
      const card = document.getElementById('day3Card');
      if (txt) txt.textContent = 'Claimed ✓';
      if (btn) {
        btn.style.background = '#10b981';
        btn.disabled = true;
      }
      if (card) {
        card.classList.remove('today');
        card.classList.add('claimed');
        const stamp = document.createElement('span');
        stamp.className = 'reward-claimed-stamp';
        stamp.textContent = '✓ Done';
        card.appendChild(stamp);
      }
      showToast('🎉 Claimed 20 Stellar Jades & 500 Rebuilt EXP!');
    }

    // Edit Profile Modal
    function editProfile() {
      const currentName = document.getElementById('heroUsername').textContent;
      const newName = prompt('Enter your member nickname:', currentName);
      if (newName && newName.trim()) {
        const trimmed = newName.trim();
        document.getElementById('heroUsername').textContent = trimmed;
        document.getElementById('navUsername').textContent = trimmed;
        try {
          localStorage.setItem('rebuilt_custom_username', trimmed);
        } catch(_) {}
        showToast('✓ Nickname updated to: ' + trimmed);
      }
    }

    // Create Post Modal
    function createPost() {
      const postTitle = prompt('Enter post title:');
      if (!postTitle || !postTitle.trim()) return;

      const postContent = prompt('Enter post content:');
      if (!postContent || !postContent.trim()) return;

      const container = document.getElementById('postsListContainer');
      if (container) {
        const article = document.createElement('article');
        article.className = 'post-card';
        article.innerHTML = \`
          <div class="post-header">
            <span class="post-category">General Discussion</span>
            <span class="post-time">Just now</span>
          </div>
          <h2 class="post-title">\${postTitle.trim()}</h2>
          <p class="post-snippet">\${postContent.trim()}</p>
          <div class="post-footer">
            <button class="post-action liked" onclick="toggleLike(this, 1)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span>1</span>
            </button>
            <div class="post-action">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>0</span>
            </div>
          </div>
        \`;
        container.insertBefore(article, container.firstChild);
        const statsPosts = document.getElementById('statsPosts');
        if (statsPosts) {
          statsPosts.textContent = parseInt(statsPosts.textContent || '24', 10) + 1;
        }
        showToast('✓ Post published to clone community!');
        switchTab('posts');
      }
    }

    // Toggle Logout
    function toggleSessionLogout() {
      const confirmLog = confirm('Are you sure you want to log out and switch to visitor mode?');
      if (confirmLog) {
        try {
          localStorage.removeItem('rebuilt_auth_state_${cloneId}');
          localStorage.removeItem('rebuilt_custom_username');
        } catch (_) {}
        showToast('Logged out of clone session. Redirecting...');
        setTimeout(function() {
          window.location.href = '${homeUrl}';
        }, 800);
      }
    }

    // Check URL query param for initial active tab, e.g. ?tab=notifications
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      if (tabParam) switchTab(tabParam);

      const savedName = localStorage.getItem('rebuilt_custom_username');
      if (savedName) {
        document.getElementById('heroUsername').textContent = savedName;
        document.getElementById('navUsername').textContent = savedName;
      }
    } catch(_) {}
  </script>
</body>
</html>`;
}

function generateLoginPageHtml(options = {}) {
  const {
    title = 'HoYoLAB - Player Community',
    baseUrl = 'https://www.hoyolab.com/',
    cloneId = '',
    theme = 'dark'
  } = options;

  const homeUrl = cloneId ? `/clones/${cloneId}/` : '/';

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" style="margin: 0; padding: 0; background: #0c0f1d; color: #f5f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Account Login</title>
  <script id="rebuilt-clone-context">window.__REBUILT_ORIGINAL_URL__ = "${baseUrl}"; window.__REBUILT_CLONE_ID__ = "${cloneId}";</script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 20%, #1e1b4b 0%, #0c0f1d 70%);
      color: #f5f6f9;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .login-card {
      width: 100%;
      max-width: 440px;
      background: rgba(24, 28, 47, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 36px 32px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      text-align: center;
    }
    .brand-logo {
      width: 52px;
      height: 52px;
      margin: 0 auto 16px;
      border-radius: 14px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 800;
      color: #fff;
      box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
    }
    .login-title {
      font-size: 22px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 6px;
    }
    .login-subtitle {
      font-size: 13px;
      color: #94a3b8;
      margin-bottom: 28px;
      line-height: 1.5;
    }
    .form-group {
      text-align: left;
      margin-bottom: 18px;
    }
    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 6px;
    }
    .form-input {
      width: 100%;
      padding: 12px 16px;
      border-radius: 10px;
      background: rgba(12, 15, 29, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #fff;
      font-size: 14px;
      transition: all 0.2s ease;
      outline: none;
    }
    .form-input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
    }
    .btn-submit {
      width: 100%;
      padding: 13px 20px;
      border-radius: 10px;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(59, 130, 246, 0.35);
      transition: all 0.2s ease;
      margin-top: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn-submit:hover {
      background: linear-gradient(135deg, #60a5fa, #3b82f6);
      transform: translateY(-1px);
    }
    .btn-quick {
      width: 100%;
      padding: 11px 20px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      border: 1px solid rgba(255, 255, 255, 0.14);
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 10px;
    }
    .btn-quick:hover {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.24);
    }
    .back-link {
      display: inline-block;
      margin-top: 24px;
      color: #94a3b8;
      text-decoration: none;
      font-size: 13px;
      transition: color 0.2s ease;
    }
    .back-link:hover {
      color: #fff;
    }
    .sandbox-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 20px;
      font-size: 11px;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid rgba(56, 189, 248, 0.2);
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="brand-logo">H</div>
    <h1 class="login-title">Account Login</h1>
    <p class="login-subtitle">Sign in to sync your in-game stats, daily check-in rewards & community showcase</p>

    <form onsubmit="handleLogin(event)">
      <div class="form-group">
        <label class="form-label">Email or Account ID</label>
        <input type="text" id="loginUsername" class="form-input" value="traveler@rebuilt.local" required autocomplete="username">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input type="password" id="loginPassword" class="form-input" value="••••••••••••" required autocomplete="current-password">
      </div>
      <button type="submit" class="btn-submit" id="loginBtn">
        <span>Log In</span>
      </button>
      <button type="button" class="btn-quick" onclick="quickLogin()">
        ⚡ 1-Click Instant Login
      </button>
    </form>

    <div class="sandbox-tag">
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#38bdf8;"></span>
      Clone Preview Mode • Local Authentication
    </div>

    <div>
      <a href="${homeUrl}" class="back-link">← Return to Website Home</a>
    </div>
  </div>

  <script>
    function executeLogin(name) {
      const btn = document.getElementById('loginBtn');
      if (btn) {
        btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;"></span> Logging in...';
        btn.disabled = true;
      }
      try {
        const authData = {
          is_login: true,
          nickname: name || 'Rebuilt Member',
          uid: '108492041',
          level: 8,
          timestamp: Date.now()
        };
        localStorage.setItem('rebuilt_auth_state_${cloneId}', JSON.stringify(authData));
        localStorage.setItem('rebuilt_custom_username', authData.nickname);
      } catch(_) {}

      setTimeout(function() {
        window.location.href = '${homeUrl}?login=success';
      }, 500);
    }

    function handleLogin(e) {
      e.preventDefault();
      const val = document.getElementById('loginUsername').value || 'Rebuilt Member';
      executeLogin(val.split('@')[0]);
    }

    function quickLogin() {
      executeLogin('Rebuilt Traveler');
    }
  </script>
</body>
</html>`;
}

module.exports = {
  generateAuthDashboardHtml,
  generateLoginPageHtml
};
