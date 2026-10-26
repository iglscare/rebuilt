/**
 * Rebuilt Dashboard Bridge Client SDK
 * Establishes real-time SSE & bi-directional communication bridge with backend cloner engine.
 */

class RebuiltBridgeClient {
  constructor(options = {}) {
    this.options = Object.assign({
      endpoint: '/api/bridge/events',
      messageEndpoint: '/api/bridge/message',
      reconnectIntervalMs: 2500,
      maxReconnectIntervalMs: 15000,
      autoConnect: true
    }, options);

    this.eventSource = null;
    this.isConnected = false;
    this.clientId = null;
    this.listeners = new Map();
    this.reconnectTimer = null;
    this.currentBackoff = this.options.reconnectIntervalMs;
    this.activityLog = [];
    this.maxActivity = 100;

    if (this.options.autoConnect) {
      this.connect();
    }

    this.setupWindowMessageBridge();
  }

  /**
   * Connects to the SSE event stream.
   */
  connect() {
    if (this.eventSource) {
      try { this.eventSource.close(); } catch (_) {}
    }

    const url = new URL(this.options.endpoint, window.location.origin);
    url.searchParams.set('type', 'dashboard');
    url.searchParams.set('_t', Date.now());

    this.eventSource = new EventSource(url.toString());

    this.eventSource.onopen = () => {
      this.isConnected = true;
      this.currentBackoff = this.options.reconnectIntervalMs;
      this.emit('bridge:status', { connected: true, status: 'connected' });
      this.logActivity('system', '⚡ Communication Bridge connected to backend engine');
    };

    this.eventSource.onerror = (err) => {
      this.isConnected = false;
      this.emit('bridge:status', { connected: false, status: 'reconnecting' });
      this.logActivity('warn', '⚠️ Communication Bridge disconnected. Reconnecting...');

      try { this.eventSource.close(); } catch (_) {}
      this.eventSource = null;

      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.currentBackoff = Math.min(this.currentBackoff * 1.5, this.options.maxReconnectIntervalMs);
          this.connect();
        }, this.currentBackoff);
      }
    };

    // Generic message handler
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleIncomingEvent('message', data);
      } catch (_) {}
    };

    // Listen for core bridge events
    const coreEvents = [
      'bridge:connected',
      'clone:started',
      'clone:step',
      'clone:ready',
      'clone:error',
      'swarm:started',
      'swarm:preloading',
      'swarm:target_ready',
      'swarm:completed',
      'proxy:request',
      'preview:interaction',
      'qa:audit',
      'qa:repair'
    ];

    coreEvents.forEach((evtName) => {
      this.eventSource.addEventListener(evtName, (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleIncomingEvent(evtName, data);
        } catch (err) {
          console.warn(`[BridgeClient] Failed to parse event ${evtName}:`, err);
        }
      });
    });
  }

  /**
   * Internal dispatcher for incoming events.
   */
  handleIncomingEvent(eventName, data) {
    if (eventName === 'bridge:connected') {
      this.clientId = data.clientId;
    }

    this.logActivity(eventName, data);
    this.emit(eventName, data);
    this.emit('*', { event: eventName, data });
  }

  /**
   * Registers an event callback.
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Unregisters an event callback.
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  /**
   * Emits an event to registered local listeners.
   */
  emit(event, ...args) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(...args);
        } catch (err) {
          console.error(`[BridgeClient] Listener error on ${event}:`, err);
        }
      }
    }
  }

  /**
   * Sends a message to the backend communication bridge.
   * 
   * @param {string} action 
   * @param {object} payload 
   * @returns {Promise<object>}
   */
  async send(action, payload = {}) {
    const body = {
      action,
      payload,
      clientId: this.clientId,
      timestamp: Date.now()
    };

    try {
      const res = await fetch(this.options.messageEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return await res.json();
    } catch (err) {
      console.warn(`[BridgeClient] Message dispatch failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Sets up cross-window postMessage bridge for preview iframes.
   */
  setupWindowMessageBridge() {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'rebuilt_bridge_message') {
        this.logActivity('iframe:interaction', data);
        this.emit('iframe:message', data);

        // Forward to backend bridge if relevant
        if (data.action === 'request_preload') {
          this.send('request_preload', data.payload);
        }
      }
    });
  }

  /**
   * Logs activity for visual telemetry stream.
   */
  logActivity(type, data) {
    const entry = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      time: new Date().toLocaleTimeString(),
      type,
      data
    };

    this.activityLog.push(entry);
    if (this.activityLog.length > this.maxActivity) {
      this.activityLog.shift();
    }

    this.emit('activity', entry);
  }
}

// Attach globally
window.RebuiltBridgeClient = RebuiltBridgeClient;
