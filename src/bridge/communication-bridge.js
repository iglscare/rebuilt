/**
 * Rebuilt Communication Bridge
 * 
 * High-velocity bidirectional event & message bridge connecting:
 * 1. Backend Cloner & Crawler Pipeline (SSRF, Playwright, Swarm, Storage, QA)
 * 2. Client Dashboard UI (Real-time live progress, telemetry, stats)
 * 3. Cloned Preview Webviews (In-page navigation, live proxy bridging, button preloading)
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class CommunicationBridge extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);

    // Active client connections: clientId -> { id, res, req, cloneId, connectedAt, type }
    this.clients = new Map();

    // Event history ring buffer for quick client catch-up
    this.historyBuffer = [];
    this.maxHistory = 50;

    // Bridge metrics
    this.metrics = {
      totalConnected: 0,
      currentConnected: 0,
      messagesSent: 0,
      messagesReceived: 0,
      startedAt: Date.now(),
      eventsByType: {}
    };

    // Keepalive heartbeat timer (every 15s)
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 15000);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Generates a unique client ID.
   */
  generateClientId() {
    return 'client_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  }

  /**
   * Handles incoming SSE connection from client (Dashboard or Cloned Page).
   * 
   * @param {import('express').Request} req 
   * @param {import('express').Response} res 
   */
  subscribe(req, res) {
    const clientId = this.generateClientId();
    const cloneId = req.query.cloneId || null;
    const clientType = req.query.type || 'dashboard'; // 'dashboard' | 'preview' | 'agent'

    // Set standard SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform, no-store',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
      'X-Accel-Buffering': 'no'
    });

    if (res.flushHeaders) {
      res.flushHeaders();
    }

    const clientMeta = {
      id: clientId,
      res,
      req,
      cloneId,
      type: clientType,
      ip: req.ip || req.socket.remoteAddress,
      connectedAt: Date.now()
    };

    this.clients.set(clientId, clientMeta);
    this.metrics.totalConnected++;
    this.metrics.currentConnected = this.clients.size;

    console.log(`[Bridge] 🔌 Client connected: ${clientId} (type: ${clientType}, active: ${this.clients.size})`);

    // Handle client disconnect
    req.on('close', () => {
      this.clients.delete(clientId);
      this.metrics.currentConnected = this.clients.size;
      console.log(`[Bridge] 🔌 Client disconnected: ${clientId} (remaining: ${this.clients.size})`);
      this.emit('client:disconnected', { clientId, type: clientType, cloneId });
    });

    // Send immediate handshake acknowledgement with recent history
    this.sendToClient(clientId, 'bridge:connected', {
      clientId,
      serverTime: Date.now(),
      status: 'active',
      activeClients: this.clients.size,
      recentEvents: this.historyBuffer.slice(-10)
    });

    this.emit('client:connected', { clientId, type: clientType, cloneId });

    return clientId;
  }

  /**
   * Formats an SSE message.
   */
  formatSSE(event, data) {
    const payload = typeof data === 'object' ? JSON.stringify(data) : String(data);
    return `event: ${event}\ndata: ${payload}\n\n`;
  }

  /**
   * Sends an event to a single client.
   */
  sendToClient(clientId, event, data) {
    const client = this.clients.get(clientId);
    if (!client || !client.res || client.res.writableEnded) return false;

    try {
      client.res.write(this.formatSSE(event, data));
      this.metrics.messagesSent++;
      return true;
    } catch (err) {
      console.warn(`[Bridge] Error writing to client ${clientId}:`, err.message);
      this.clients.delete(clientId);
      return false;
    }
  }

  /**
   * Broadcasts an event to all connected clients or filtered by criteria.
   * 
   * @param {string} event - Event name (e.g. 'clone:step', 'swarm:preloaded')
   * @param {object} data - Event payload
   * @param {object} [filter] - Optional filter e.g. { cloneId, type }
   */
  broadcast(event, data = {}, filter = {}) {
    const enrichedData = {
      ...data,
      _timestamp: Date.now(),
      _event: event
    };

    // Store in ring buffer
    this.historyBuffer.push({ event, data: enrichedData, timestamp: Date.now() });
    if (this.historyBuffer.length > this.maxHistory) {
      this.historyBuffer.shift();
    }

    // Track metrics
    this.metrics.messagesSent++;
    this.metrics.eventsByType[event] = (this.metrics.eventsByType[event] || 0) + 1;

    // Also emit locally for internal Node services
    this.emit(event, enrichedData);
    this.emit('*', { event, data: enrichedData });

    const formatted = this.formatSSE(event, enrichedData);
    let sentCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      if (!client.res || client.res.writableEnded) {
        this.clients.delete(clientId);
        continue;
      }

      // Filter by cloneId if specified and client is locked to a specific clone
      if (filter.cloneId && client.cloneId && client.cloneId !== filter.cloneId) {
        continue;
      }

      // Filter by clientType if specified
      if (filter.type && client.type !== filter.type) {
        continue;
      }

      try {
        client.res.write(formatted);
        sentCount++;
      } catch (err) {
        console.warn(`[Bridge] Broadcast delivery failed for ${clientId}:`, err.message);
        this.clients.delete(clientId);
      }
    }

    return sentCount;
  }

  /**
   * Processes a message received from a client over HTTP/REST bridge.
   * 
   * @param {object} message - { action, payload, clientId, cloneId }
   * @param {object} [senderInfo]
   * @returns {object} Response
   */
  handleClientMessage(message, senderInfo = {}) {
    if (!message || typeof message !== 'object') {
      return { success: false, error: 'Invalid message object' };
    }

    this.metrics.messagesReceived++;
    const { action, payload = {}, clientId, cloneId } = message;

    // Log message for debugging
    console.log(`[Bridge] 📨 Message received: "${action}" from ${clientId || senderInfo.ip || 'anonymous'}`);

    // Update client cloneId association if specified
    if (clientId && cloneId && this.clients.has(clientId)) {
      this.clients.get(clientId).cloneId = cloneId;
    }

    // Process known actions
    switch (action) {
      case 'ping':
        return {
          success: true,
          action: 'pong',
          serverTime: Date.now(),
          clientSentAt: payload.timestamp || null
        };

      case 'subscribe_clone':
        if (clientId && this.clients.has(clientId)) {
          this.clients.get(clientId).cloneId = payload.cloneId;
        }
        return { success: true, subscribed: payload.cloneId };

      case 'request_preload': {
        // Cloned page is requesting background preload of a target path or link
        const targetPath = payload.path;
        const targetCloneId = cloneId || payload.cloneId;
        if (targetCloneId && targetPath) {
          this.emit('bridge:request_preload', {
            cloneId: targetCloneId,
            path: targetPath,
            sender: clientId
          });
        }
        return { success: true, status: 'preload_queued', path: targetPath };
      }

      case 'interaction_event':
        // Telemetry from cloned page (e.g. button clicked, form input, navigation)
        this.broadcast('preview:interaction', {
          cloneId: cloneId || payload.cloneId,
          type: payload.type,
          element: payload.element,
          url: payload.url,
          timestamp: Date.now()
        }, { type: 'dashboard' });
        return { success: true, logged: true };

      case 'client_telemetry':
        this.emit('bridge:telemetry', { sender: clientId, payload });
        return { success: true };

      case 'user_request': {
        // Direct bridge command execution for client apps
        const userAction = payload.action;
        const targetUrl = payload.url;
        this.broadcast('bridge:user_request_queued', {
          action: userAction,
          url: targetUrl,
          clientId
        });
        return {
          success: true,
          status: 'queued',
          action: userAction,
          message: `User request for "${userAction}" queued for fulfillment.`
        };
      }

      default:
        // Generic action dispatch
        this.emit(`action:${action}`, { action, payload, clientId, cloneId, senderInfo });
        this.broadcast(`client:${action}`, { action, payload, clientId, cloneId });
        return { success: true, acknowledged: action };
    }
  }

  /**
   * Sends heartbeat keepalive comment to all active clients.
   */
  sendHeartbeat() {
    if (this.clients.size === 0) return;

    const keepalivePacket = `:keepalive ${Date.now()}\n\n`;
    for (const [clientId, client] of this.clients.entries()) {
      if (!client.res || client.res.writableEnded) {
        this.clients.delete(clientId);
        continue;
      }
      try {
        client.res.write(keepalivePacket);
      } catch (_) {
        this.clients.delete(clientId);
      }
    }
    this.metrics.currentConnected = this.clients.size;
  }

  /**
   * Retrieves status and metrics of the communication bridge.
   */
  getStatus() {
    return {
      status: 'active',
      uptimeSeconds: Math.floor((Date.now() - this.metrics.startedAt) / 1000),
      connectedClients: this.clients.size,
      clientTypes: Array.from(this.clients.values()).reduce((acc, c) => {
        acc[c.type] = (acc[c.type] || 0) + 1;
        return acc;
      }, {}),
      messagesSent: this.metrics.messagesSent,
      messagesReceived: this.metrics.messagesReceived,
      recentEventsCount: this.historyBuffer.length,
      eventsByType: this.metrics.eventsByType
    };
  }

  /**
   * Closes all connections and stops heartbeat.
   */
  destroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    for (const [, client] of this.clients.entries()) {
      try {
        client.res.end();
      } catch (_) {}
    }
    this.clients.clear();
    this.removeAllListeners();
  }
}

// Export singleton instance
const communicationBridge = new CommunicationBridge();
module.exports = {
  communicationBridge,
  CommunicationBridge
};
