import { sendMagicPackets } from '../utils/magicPacket.js';

const ROUND_SECONDS = 10;

/**
 * Wakes the agent's Mac and resolves once its API answers.
 * Each round it (1) broadcasts magic packets to every configured MAC and (2) probes the agent's TCP port; the probe's
 * SYN is what makes a Bonjour Sleep Proxy wake a sleeping Mac. Rounds repeat until healthy or the timeout passes.
 * @param config - client config (macs, broadcasts, wakeTimeoutSeconds)
 * @param client - agent client
 * @param log - progress logger
 * @returns {Promise<{alreadyAwake: boolean, seconds: number}>}
 */
export async function wakeAgent(config, client, log = () => {}) {
  const startedAt = Date.now();
  if (await client.isHealthy(1500)) return { alreadyAwake: true, seconds: 0 };
  const deadline = startedAt + config.wakeTimeoutSeconds * 1000;
  let round = 0;
  while (Date.now() < deadline) {
    round++;
    const sent = config.macs.length ? await sendMagicPackets(config.macs, config.broadcasts) : 0;
    log(`wake round ${round}: sent ${sent} magic packet(s), probing ${config.host}:${config.port}`);
    if (await pollHealthy(client, Math.min(ROUND_SECONDS * 1000, deadline - Date.now()))) {
      return { alreadyAwake: false, seconds: Math.round((Date.now() - startedAt) / 1000) };
    }
  }
  throw new Error(`${config.host}:${config.port} did not wake within ${config.wakeTimeoutSeconds}s`);
}

/**
 * Probes /health repeatedly for up to `windowMs`, resolving true as soon as it answers.
 * @param client - agent client
 * @param windowMs - how long to keep probing
 */
async function pollHealthy(client, windowMs) {
  const until = Date.now() + windowMs;
  while (Date.now() < until) {
    const probeStart = Date.now();
    if (await client.isHealthy(2000)) return true;
    const elapsed = Date.now() - probeStart;
    if (elapsed < 1000) await new Promise((r) => setTimeout(r, 1000 - elapsed));
  }
  return false;
}
