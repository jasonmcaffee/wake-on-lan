#!/usr/bin/env node
import dns from 'node:dns/promises';
import { loadClientConfig, clientConfigPath } from '../src/utils/config.js';
import { sendMagicPackets } from '../src/utils/magicPacket.js';
import { createAgentClient } from '../src/services/agentClient.js';
import { wakeAgent } from '../src/services/wakeService.js';

const USAGE = `wol - wake a sleeping Mac and hand it work

Usage:
  wol wake                         wake the agent's Mac and wait until its API answers
  wol status                       is the agent awake? (does not wake it)
  wol jobs                         list the named jobs the agent allows, and recent runs
  wol run <job> [--no-follow]      wake, start a named job, stream its log, exit with its exit code
  wol exec "<command>" [--cwd d]   same, for an arbitrary command (agent must allow it)
  wol logs <id>                    stream a run's log until it finishes
  wol cancel <id>                  cancel a run
  wol keep-awake <seconds>         wake and hold the Mac awake for N seconds
  wol magic                        only broadcast magic packets

Options (override ${clientConfigPath()} / env WOL_HOST WOL_PORT WOL_TOKEN):
  --host <name|ip>  --fallback-ip <ip>  --port <n>  --token <t>  --mac <aa:bb:..,..>  --broadcast <addr,..>  --timeout <s>`;

/**
 * Splits argv into positional args and `--flag value` / `--flag` options.
 * @param argv - process arguments after the script
 */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i++; }
  }
  return { positional, flags };
}

/**
 * Wakes the agent, printing progress to stderr so stdout stays clean for job output.
 * @param config - client config
 * @param client - agent client
 */
async function ensureAwake(config, client) {
  const result = await wakeAgent(config, client, (msg) => console.error(`[wol] ${msg}`));
  console.error(result.alreadyAwake ? `[wol] ${config.host} is awake` : `[wol] ${config.host} woke after ${result.seconds}s`);
}

/**
 * Streams a run's log to stdout until it finishes, returning the final record.
 * @param client - agent client
 * @param id - job id
 */
async function followJob(client, id) {
  let offset = 0;
  for (;;) {
    const chunk = await client.readLog(id, offset);
    if (chunk.text) process.stdout.write(chunk.text);
    offset = chunk.nextOffset;
    if (chunk.status && chunk.status !== 'running') {
      const tail = await client.readLog(id, offset);
      if (tail.text) process.stdout.write(tail.text);
      return client.getJob(id);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * Starts a run, then either streams it or prints its id.
 * @param client - agent client
 * @param body - `{ job }` or `{ command, cwd }`
 * @param follow - stream the log and wait
 */
async function startAndMaybeFollow(client, body, follow) {
  const record = await client.startJob(body);
  console.error(`[wol] started ${record.name} as ${record.id}`);
  if (!follow) { console.log(JSON.stringify(record, null, 2)); return 0; }
  const final = await followJob(client, record.id);
  console.error(`[wol] ${final.name} ${final.status} (exit ${final.exitCode})`);
  return final.status === 'succeeded' ? 0 : final.exitCode || 1;
}

/**
 * Runs one CLI command and returns the process exit code.
 * @param command - sub-command
 * @param args - positional args after the sub-command
 * @param flags - parsed flags
 */
async function runCommand(command, args, flags) {
  const config = loadClientConfig(flags);
  if (command === 'magic') {
    const sent = await sendMagicPackets(config.macs, config.broadcasts);
    console.log(`sent ${sent} magic packet(s) to ${config.macs.join(', ') || '(no macs configured)'}`);
    return 0;
  }
  if (!config.host) throw new Error(`No host. Pass --host or set "host" in ${clientConfigPath()}.`);
  config.host = await resolveHost(config.host, config.fallbackIp);
  const client = createAgentClient(config);
  if (command === 'status') { console.log((await client.isHealthy()) ? JSON.stringify(await client.health()) : 'asleep or unreachable'); return 0; }
  await ensureAwake(config, client);
  if (command === 'wake') return 0;
  if (command === 'jobs') { console.log(JSON.stringify(await client.listJobs(), null, 2)); return 0; }
  if (command === 'run') return startAndMaybeFollow(client, { job: requireArg(args[0], 'job name') }, !flags['no-follow']);
  if (command === 'exec') return startAndMaybeFollow(client, { command: requireArg(args[0], 'command'), cwd: flags.cwd }, !flags['no-follow']);
  if (command === 'logs') { const final = await followJob(client, requireArg(args[0], 'job id')); return final.status === 'succeeded' ? 0 : 1; }
  if (command === 'cancel') { console.log(JSON.stringify(await client.cancelJob(requireArg(args[0], 'job id')))); return 0; }
  if (command === 'keep-awake') { console.log(JSON.stringify(await client.keepAwake(Number(requireArg(args[0], 'seconds'))))); return 0; }
  throw new Error(`Unknown command "${command}"\n\n${USAGE}`);
}

/**
 * Returns `host` when it resolves, otherwise `fallbackIp` (when configured) so clients without mDNS still work.
 * @param host - configured host name or IP
 * @param fallbackIp - IP to use when the name cannot be resolved
 */
async function resolveHost(host, fallbackIp) {
  if (!fallbackIp) return host;
  try {
    await dns.lookup(host);
    return host;
  } catch {
    console.error(`[wol] could not resolve ${host}, using fallback ${fallbackIp}`);
    return fallbackIp;
  }
}

/**
 * Throws a usage error when a required positional argument is missing.
 * @param value - argument value
 * @param what - argument name for the message
 */
function requireArg(value, what) {
  if (!value) throw new Error(`Missing ${what}.\n\n${USAGE}`);
  return value;
}

/**
 * CLI entry point.
 */
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...args] = positional;
  if (!command || flags.help) { console.log(USAGE); return; }
  try {
    process.exitCode = await runCommand(command, args, flags);
  } catch (err) {
    console.error(`[wol] ${err.message}`);
    process.exitCode = 2;
  }
}

main();
