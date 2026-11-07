#!/usr/bin/env node
import { loadAgentConfig, agentConfigPath } from '../src/utils/config.js';
import { createKeepAwake } from '../src/utils/keepAwake.js';
import { createJobRepository } from '../src/repositories/jobRepository.js';
import { createJobService } from '../src/services/jobService.js';
import { createAgentServer } from '../src/services/agentServer.js';
import { advertiseAgent } from '../src/services/bonjourService.js';

/**
 * Entry point for the agent that runs on the Mac to be woken: wires config -> repository -> services -> HTTP server,
 * advertises the port over Bonjour so the sleep proxy can wake us, and shuts down cleanly on SIGTERM/SIGINT.
 */
function main() {
  const config = loadAgentConfig();
  const keepAwake = createKeepAwake();
  const repository = createJobRepository(config.dataDir);
  const jobService = createJobService(config, repository, keepAwake);
  const server = createAgentServer(config, jobService, keepAwake);
  const bonjour = { stop() {} };

  server.listen(config.port, config.host, () => {
    console.log(`[wol-agent] listening on ${config.host}:${config.port} (config ${agentConfigPath()}), jobs: ${Object.keys(config.jobs).join(', ') || 'none'}`);
    if (config.advertiseBonjour) Object.assign(bonjour, advertiseAgent(config.port));
  });

  const shutdown = () => {
    console.log('[wol-agent] shutting down');
    bonjour.stop();
    keepAwake.release();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
