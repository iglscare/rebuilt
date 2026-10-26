# Rebuilt — Automated Website Cloner & Interactive Bridge

**Rebuilt** is an advanced website cloning and offline mirroring engine powered by Playwright and Express. It faithfully captures modern, dynamic Single-Page Applications (SPAs) and complex web pages, inlines and rewrites assets, and provides an integrated communication bridge with tunnel support.

---

## ⚡ Features

- **High Velocity Cloning Engine**: Captures DOM, CSS, media, fonts, and scripts using headless Playwright with browser pooling.
- **Dynamic Asset Rewriter**: Intelligent link and resource rewriting for seamless offline operation.
- **Communication Bridge & Proxy**: Built-in bridge system for interactive frontend integration.
- **Tunneling Support**: Easy public tunneling with LocalTunnel, Cloudflare, and SSH providers.
- **Session Vault & Local Security**: Encrypted session management and local auth middleware.
- **Supabase Integration**: Optional cloud persistence and schema management.

---

## 🚀 Quick Start

### 1. Installation

```bash
npm install
npx playwright install chromium
```

### 2. Configure Environment

Copy `.env.example` to `.env` and adjust settings as needed:

```bash
cp .env.example .env
```

### 3. Start the Server

```bash
# Production start
npm start

# Development mode with live reload
npm run dev
```

Visit `http://localhost:3000` to open the Rebuilt dashboard.

---

## 🛠️ Testing & Scripts

```bash
# Foundation test
npm run test

# Media cloning test
npm run test:media

# Bridge integration tests
npm run test:bridge
npm run test:bridge-controlled

# Public tunnel
npm run tunnel
```

---

## 📄 License

MIT
