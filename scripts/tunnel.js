#!/usr/bin/env node

/**
 * Rebuilt Web Cloner — CLI Port Forwarding Utility
 * Exposes the local Rebuilt server to the public internet via localtunnel,
 * Cloudflare Tunnel, or SSH remote forwarding.
 *
 * Usage:
 *   node scripts/tunnel.js [--port=3000] [--provider=localtunnel|cloudflared|ssh] [--subdomain=custom]
 */

const { tunnelService } = require('../src/tunnel/tunnel-service');

// Parse CLI flags
const args = process.argv.slice(2);
let port = null;
let provider = 'localtunnel';
let subdomain = null;

for (const arg of args) {
  if (arg.startsWith('--port=')) {
    port = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--provider=')) {
    provider = arg.split('=')[1].toLowerCase();
  } else if (arg.startsWith('--subdomain=')) {
    subdomain = arg.split('=')[1];
  }
}

async function main() {
  const targetPort = port || tunnelService.detectActivePort();

  console.log('\n=============================================================');
  console.log('  🌐 REBUILT — Live Port Forwarding & Tunnel Service         ');
  console.log('=============================================================');
  console.log(`  Local Port:   ${targetPort}`);
  console.log(`  Provider:     ${provider}`);
  if (subdomain) {
    console.log(`  Subdomain:    ${subdomain}`);
  }
  console.log('  Status:       Establishing public tunnel...\n');

  try {
    const result = await tunnelService.startTunnel({
      port: targetPort,
      provider,
      subdomain
    });

    const publicUrl = result.url.replace(/\/$/, '');

    console.log('=============================================================');
    console.log('  🚀 PUBLIC TUNNEL ACTIVE & LIVE!                             ');
    console.log('=============================================================');
    console.log(`  Public Dashboard:   ${publicUrl}`);
    console.log(`  Live Clone Links:   ${publicUrl}/clones/<clone-id>/`);
    console.log(`  Local Server:       http://localhost:${targetPort}`);
    console.log('-------------------------------------------------------------');
    console.log('  💡 Share the Live Clone Link with external users/testers!');
    console.log('  Press Ctrl+C to close and terminate the public tunnel.');
    console.log('=============================================================\n');

    // Keep process alive and handle termination
    const shutdown = async () => {
      console.log('\n[Tunnel] Closing public tunnel...');
      await tunnelService.stopTunnel();
      console.log('[Tunnel] Disconnected cleanly. Goodbye!\n');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep event loop active
    setInterval(() => {}, 1000 * 60 * 60);

  } catch (err) {
    console.error(`\n❌ Failed to establish port forwarding: ${err.message}`);
    console.error('\nTips:');
    console.error('  • Ensure local server is running ("npm run dev" or "npm start")');
    console.error('  • For Cloudflare: brew install cloudflared');
    console.error('  • Or try: node scripts/tunnel.js --provider=ssh');
    process.exit(1);
  }
}

main();
