/**
 * Rebuilt Web Cloner — Port Forwarding & Tunnel Service
 * Manages live public URLs (via localtunnel, Cloudflare Tunnel, or SSH remote forwarding)
 * so users can share and test live cloned websites externally over the internet.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { communicationBridge } = require('../bridge/communication-bridge');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const TUNNEL_URL_FILE = path.join(DATA_DIR, 'tunnel-url.txt');
const TUNNEL_INFO_FILE = path.join(DATA_DIR, 'tunnel-info.json');
const ACTIVE_PORT_FILE = path.join(DATA_DIR, 'active-port.txt');

class TunnelService {
  constructor() {
    this.activeTunnel = null; // reference to localtunnel instance or child process
    this.currentUrl = null;
    this.provider = null;
    this.port = null;
    this.startedAt = null;

    // Load any persisted state on init
    this.loadPersistedState();
  }

  loadPersistedState() {
    try {
      if (fs.existsSync(TUNNEL_URL_FILE)) {
        const savedUrl = fs.readFileSync(TUNNEL_URL_FILE, 'utf8').trim();
        if (savedUrl && savedUrl.startsWith('http')) {
          this.currentUrl = savedUrl;
        }
      }
      if (fs.existsSync(TUNNEL_INFO_FILE)) {
        const info = JSON.parse(fs.readFileSync(TUNNEL_INFO_FILE, 'utf8'));
        if (info.url) this.currentUrl = info.url;
        if (info.provider) this.provider = info.provider;
        if (info.port) this.port = info.port;
      }
    } catch (_) {}
  }

  persistState() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (this.currentUrl) {
        fs.writeFileSync(TUNNEL_URL_FILE, this.currentUrl, 'utf8');
        fs.writeFileSync(
          TUNNEL_INFO_FILE,
          JSON.stringify(
            {
              url: this.currentUrl,
              provider: this.provider,
              port: this.port,
              startedAt: this.startedAt
            },
            null,
            2
          ),
          'utf8'
        );
      } else {
        if (fs.existsSync(TUNNEL_URL_FILE)) fs.unlinkSync(TUNNEL_URL_FILE);
        if (fs.existsSync(TUNNEL_INFO_FILE)) fs.unlinkSync(TUNNEL_INFO_FILE);
      }
    } catch (_) {}
  }

  detectActivePort() {
    if (this.port) return this.port;
    if (process.env.ACTIVE_PORT) return parseInt(process.env.ACTIVE_PORT, 10);
    if (process.env.PORT) return parseInt(process.env.PORT, 10);

    try {
      if (fs.existsSync(ACTIVE_PORT_FILE)) {
        const p = parseInt(fs.readFileSync(ACTIVE_PORT_FILE, 'utf8').trim(), 10);
        if (!isNaN(p) && p > 0) return p;
      }
    } catch (_) {}

    return 3000;
  }

  /**
   * Starts a public tunnel.
   * @param {object} options
   * @param {number} [options.port] - Local port to expose (defaults to active port or 3000)
   * @param {string} [options.provider='localtunnel'] - 'localtunnel' | 'cloudflared' | 'ssh'
   * @param {string} [options.subdomain] - Custom subdomain (supported by localtunnel)
   */
  async startTunnel({ port, provider = 'localtunnel', subdomain = null } = {}) {
    if (this.currentUrl && this.activeTunnel) {
      return {
        active: true,
        url: this.currentUrl,
        provider: this.provider,
        port: this.port,
        message: 'Tunnel is already active.'
      };
    }

    const targetPort = port || this.detectActivePort();
    this.port = targetPort;
    this.provider = provider;
    this.startedAt = new Date().toISOString();

    if (provider === 'localtunnel') {
      return await this._startLocaltunnel(targetPort, subdomain);
    } else if (provider === 'cloudflared') {
      return await this._startCloudflared(targetPort);
    } else if (provider === 'ssh') {
      return await this._startSshTunnel(targetPort);
    } else {
      throw new Error(`Unsupported tunnel provider: "${provider}". Choose 'localtunnel', 'cloudflared', or 'ssh'.`);
    }
  }

  async _startLocaltunnel(port, subdomain) {
    const localtunnel = require('localtunnel');
    try {
      const opts = { port };
      if (subdomain) opts.subdomain = subdomain;

      const tunnel = await localtunnel(opts);
      this.activeTunnel = tunnel;
      this.currentUrl = tunnel.url;
      this.provider = 'localtunnel';
      this.persistState();

      tunnel.on('close', () => {
        this._handleTunnelClosed();
      });

      tunnel.on('error', (err) => {
        console.error('[TunnelService] Localtunnel error:', err.message);
        this._handleTunnelClosed();
      });

      communicationBridge.broadcast('tunnel:connected', {
        url: this.currentUrl,
        provider: 'localtunnel',
        port: this.port
      });

      return {
        active: true,
        url: this.currentUrl,
        provider: 'localtunnel',
        port: this.port
      };
    } catch (err) {
      this._handleTunnelClosed();
      throw new Error(`Failed to start localtunnel: ${err.message}`);
    }
  }

  async _startCloudflared(port) {
    return new Promise((resolve, reject) => {
      const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`]);
      let resolved = false;

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        // Look for trycloudflare.com link
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          this.activeTunnel = proc;
          this.currentUrl = match[0];
          this.provider = 'cloudflared';
          this.persistState();

          communicationBridge.broadcast('tunnel:connected', {
            url: this.currentUrl,
            provider: 'cloudflared',
            port: this.port
          });

          resolve({
            active: true,
            url: this.currentUrl,
            provider: 'cloudflared',
            port: this.port
          });
        }
      });

      proc.on('close', () => {
        this._handleTunnelClosed();
        if (!resolved) {
          reject(new Error('Cloudflared process closed unexpectedly. Ensure "cloudflared" is installed via "brew install cloudflared".'));
        }
      });

      proc.on('error', (err) => {
        this._handleTunnelClosed();
        if (!resolved) {
          reject(new Error(`Failed to spawn cloudflared: ${err.message}. Ensure "cloudflared" is installed.`));
        }
      });

      setTimeout(() => {
        if (!resolved) {
          proc.kill();
          reject(new Error('Cloudflared connection timed out after 15 seconds.'));
        }
      }, 15000);
    });
  }

  async _startSshTunnel(port) {
    return new Promise((resolve, reject) => {
      // Connect to localhost.run
      const proc = spawn('ssh', [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ServerAliveInterval=30',
        '-R', `80:localhost:${port}`,
        'nokey@localhost.run'
      ]);
      let resolved = false;

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.lhr\.life/);
        if (match && !resolved) {
          resolved = true;
          this.activeTunnel = proc;
          this.currentUrl = match[0];
          this.provider = 'ssh (localhost.run)';
          this.persistState();

          communicationBridge.broadcast('tunnel:connected', {
            url: this.currentUrl,
            provider: this.provider,
            port: this.port
          });

          resolve({
            active: true,
            url: this.currentUrl,
            provider: this.provider,
            port: this.port
          });
        }
      });

      proc.on('close', () => {
        this._handleTunnelClosed();
        if (!resolved) {
          reject(new Error('SSH tunnel closed unexpectedly.'));
        }
      });

      proc.on('error', (err) => {
        this._handleTunnelClosed();
        if (!resolved) {
          reject(new Error(`SSH tunnel spawn error: ${err.message}`));
        }
      });

      setTimeout(() => {
        if (!resolved) {
          proc.kill();
          reject(new Error('SSH tunnel timed out after 15 seconds.'));
        }
      }, 15000);
    });
  }

  async stopTunnel() {
    if (this.activeTunnel) {
      if (typeof this.activeTunnel.close === 'function') {
        this.activeTunnel.close();
      } else if (typeof this.activeTunnel.kill === 'function') {
        this.activeTunnel.kill();
      }
    }

    this._handleTunnelClosed();
    return {
      active: false,
      message: 'Tunnel disconnected successfully.'
    };
  }

  _handleTunnelClosed() {
    this.activeTunnel = null;
    this.currentUrl = null;
    this.provider = null;
    this.persistState();

    communicationBridge.broadcast('tunnel:disconnected', {
      active: false
    });
  }

  getStatus() {
    return {
      active: Boolean(this.currentUrl),
      url: this.currentUrl,
      provider: this.provider,
      port: this.port || this.detectActivePort(),
      startedAt: this.startedAt
    };
  }

  getPublicUrl() {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
    if (this.currentUrl) return this.currentUrl.replace(/\/$/, '');
    return null;
  }

  /**
   * Builds the live shareable URL for a given clone ID.
   * If a public tunnel is active, returns the full public URL.
   * Otherwise falls back to localhost or relative path.
   * 
   * @param {string} cloneId
   * @param {object} [req] - Optional Express request for header inspection
   * @returns {string} Fully qualified or path-based URL
   */
  getLiveCloneUrl(cloneId, req = null) {
    const publicBase = this.getPublicUrl();
    if (publicBase) {
      return `${publicBase}/clones/${cloneId}/`;
    }

    if (req) {
      const host = req.get('x-forwarded-host') || req.get('host');
      const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
      if (host) {
        return `${proto}://${host}/clones/${cloneId}/`;
      }
    }

    const port = this.detectActivePort();
    return `http://localhost:${port}/clones/${cloneId}/`;
  }
}

const tunnelService = new TunnelService();

module.exports = {
  TunnelService,
  tunnelService
};
