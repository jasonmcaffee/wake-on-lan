import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 7777;

/**
 * Expands a leading `~` to the user's home directory.
 * @param p - path that may start with `~`
 */
export function expandHome(p) {
  if (!p) return p;
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * Reads a JSON file, returning `fallback` when it does not exist.
 * @param filePath - JSON file
 * @param fallback - value used when the file is missing
 */
export function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Default location of the agent's config file (overridable with WOL_AGENT_CONFIG).
 */
export function agentConfigPath() {
  return process.env.WOL_AGENT_CONFIG || path.join(os.homedir(), '.config', 'wol-agent', 'config.json');
}

/**
 * Default location of the client's config file (overridable with WOL_CONFIG).
 */
export function clientConfigPath() {
  return process.env.WOL_CONFIG || path.join(os.homedir(), '.config', 'wol', 'config.json');
}

/**
 * Loads the agent config, filling defaults. Refuses to start without a token so the API is never open.
 * @param filePath - config file to read
 * @returns {import('../models/types.js').AgentConfig}
 */
export function loadAgentConfig(filePath = agentConfigPath()) {
  const raw = readJson(filePath);
  const config = {
    port: Number(process.env.WOL_AGENT_PORT || raw.port || DEFAULT_PORT),
    host: raw.host || '0.0.0.0',
    token: process.env.WOL_TOKEN || raw.token || '',
    allowArbitraryCommands: Boolean(raw.allowArbitraryCommands),
    jobs: raw.jobs || {},
    keepAwakeSeconds: Number(raw.keepAwakeSeconds || 300),
    dataDir: expandHome(raw.dataDir || '~/.wol-agent'),
    advertiseBonjour: raw.advertiseBonjour !== false,
  };
  if (!config.token) throw new Error(`No token configured. Set "token" in ${filePath} or WOL_TOKEN (run scripts/setup-mac.sh).`);
  return config;
}

/**
 * Loads the client config and overlays CLI flags (flags win).
 * @param flags - parsed CLI flags (host, port, token, mac, broadcast, timeout)
 * @param filePath - config file to read
 * @returns {import('../models/types.js').ClientConfig}
 */
export function loadClientConfig(flags = {}, filePath = clientConfigPath()) {
  const raw = readJson(filePath);
  return {
    host: flags.host || process.env.WOL_HOST || raw.host || '',
    fallbackIp: flags['fallback-ip'] || raw.fallbackIp || '',
    port: Number(flags.port || process.env.WOL_PORT || raw.port || DEFAULT_PORT),
    token: flags.token || process.env.WOL_TOKEN || raw.token || '',
    macs: toList(flags.mac) || raw.macs || [],
    broadcasts: toList(flags.broadcast) || raw.broadcasts || ['255.255.255.255'],
    wakeTimeoutSeconds: Number(flags.timeout || raw.wakeTimeoutSeconds || 90),
  };
}

/**
 * Turns a comma separated flag value into a list, or undefined when absent.
 * @param value - flag value
 */
function toList(value) {
  if (!value) return undefined;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}
