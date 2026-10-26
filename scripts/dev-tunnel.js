#!/usr/bin/env node

/**
 * Rebuilt Web Cloner — Dev + Tunnel Runner
 * Starts the cloner server and automatically initiates port forwarding in a single command.
 */

const { startServer } = require('../server');
const { tunnelService } = require('../src/tunnel/tunnel-service');

async function main() {
  const port = parseInt(process.env.PORT || '3000', 10);

  console.log('\n[DevTunnel] 1. Initializing Rebuilt Web Cloner server...');
  await startServer(port);

  console.log('[DevTunnel] 2. Initializing Live Port Forwarding Tunnel...');
  try {
    const result = await tunnelService.startTunnel({
      port,
      provider: 'localtunnel'
    });

    const publicUrl = result.url.replace(/\/$/, '');
    console.log('\n=============================================================');
    console.log('  🚀 SERVER & PUBLIC TUNNEL BOTH RUNNING CONCURRENTLY!        ');
    console.log('=============================================================');
    console.log(`  Local URL:        http://localhost:${port}`);
    console.log(`  Live Public URL:  ${publicUrl}`);
    console.log(`  Clones Base:      ${publicUrl}/clones/<clone-id>/`);
    console.log('=============================================================\n');
  } catch (err) {
    console.error('[DevTunnel] Warning: Could not auto-start tunnel:', err.message);
    console.log('[DevTunnel] Server is still accessible at http://localhost:' + port);
  }
}

main().catch((err) => {
  console.error('[DevTunnel] Fatal startup error:', err);
  process.exit(1);
});
