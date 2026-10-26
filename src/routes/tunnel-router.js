const express = require('express');
const { tunnelService } = require('../tunnel/tunnel-service');

const router = express.Router();

/**
 * GET /api/tunnel/status
 * Returns the current port forwarding tunnel status.
 */
router.get('/status', (req, res) => {
  const status = tunnelService.getStatus();
  res.json(status);
});

/**
 * POST /api/tunnel/start
 * Starts a new port forwarding tunnel.
 */
router.post('/start', async (req, res) => {
  const { provider = 'localtunnel', port, subdomain } = req.body || {};
  try {
    const result = await tunnelService.startTunnel({
      provider,
      port: port ? parseInt(port, 10) : undefined,
      subdomain
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err.message,
      code: 'TUNNEL_START_ERROR'
    });
  }
});

/**
 * POST /api/tunnel/stop
 * Terminates the active port forwarding tunnel.
 */
router.post('/stop', async (req, res) => {
  try {
    const result = await tunnelService.stopTunnel();
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err.message,
      code: 'TUNNEL_STOP_ERROR'
    });
  }
});

/**
 * GET /api/tunnel/clone-link/:id
 * Resolves the shareable live link for a specific clone.
 */
router.get('/clone-link/:id', (req, res) => {
  const cloneId = req.params.id;
  const status = tunnelService.getStatus();
  const liveUrl = tunnelService.getLiveCloneUrl(cloneId, req);
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const currentHostUrl = `${proto}://${host}/clones/${cloneId}/`;

  res.json({
    cloneId,
    liveUrl: status.active ? liveUrl : currentHostUrl,
    publicTunnelUrl: status.url ? `${status.url.replace(/\/$/, '')}/clones/${cloneId}/` : null,
    tunnelActive: status.active,
    provider: status.provider
  });
});

module.exports = router;
