import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { expandHome } from '../utils/config.js';

/**
 * Creates the job service: resolves a request to a command, runs it in the user's login shell, writes its output
 * to a log file and holds a `caffeinate` assertion for as long as it runs so the Mac cannot fall back asleep mid-build.
 * @param config - agent config (jobs, allowArbitraryCommands)
 * @param repository - job repository
 * @param keepAwake - keep-awake manager
 */
export function createJobService(config, repository, keepAwake) {
  const children = new Map();

  /**
   * Starts a job from an API request body `{ job }` or `{ command, cwd }`.
   * Throws an error with `status` 400/403/404 when the request is not allowed.
   * @param request - parsed request body
   */
  function start(request) {
    const { name, command, cwd } = resolveRequest(config, request);
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const logPath = repository.logPathFor(id);
    const record = repository.insert({ id, name, command, cwd, status: 'running', exitCode: null, pid: null, logPath, startedAt: new Date().toISOString(), finishedAt: null });
    const child = spawnJob(command, cwd, logPath);
    record.pid = child.pid ?? null;
    children.set(id, child);
    if (child.pid) keepAwake.holdWhile(child.pid);
    console.log(`[wol-agent] job ${id} (${name}) started pid=${child.pid}: ${command}`);
    child.on('error', (err) => finish(id, null, `spawn error: ${err.message}`));
    child.on('close', (code, signal) => finish(id, code, signal ? `signal ${signal}` : null));
    return record;
  }

  /**
   * Marks a job finished and records its outcome.
   * @param id - job id
   * @param code - exit code (null when killed or failed to spawn)
   * @param note - extra detail appended to the log
   */
  function finish(id, code, note) {
    const record = repository.get(id);
    if (!record || record.finishedAt) return;
    children.delete(id);
    const status = record.status === 'cancelled' ? 'cancelled' : code === 0 ? 'succeeded' : 'failed';
    if (note) fs.appendFileSync(record.logPath, `\n[wol-agent] ${note}\n`);
    repository.update(id, { status, exitCode: code, finishedAt: new Date().toISOString() });
    console.log(`[wol-agent] job ${id} ${status} exit=${code}`);
  }

  /**
   * Cancels a running job by signalling its process group.
   * @param id - job id
   */
  function cancel(id) {
    const record = repository.get(id);
    const child = children.get(id);
    if (!record || !child) return record;
    record.status = 'cancelled';
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    return record;
  }

  return { start, cancel, get: repository.get, list: repository.list, readLog: repository.readLog };
}

/**
 * Turns a request into the command to run, enforcing the named-job allowlist.
 * @param config - agent config
 * @param request - `{ job }` or `{ command, cwd }`
 */
export function resolveRequest(config, request = {}) {
  if (request.job) {
    const def = config.jobs[request.job];
    if (!def) throw httpError(404, `Unknown job "${request.job}". Known: ${Object.keys(config.jobs).join(', ') || 'none'}`);
    return { name: request.job, command: def.command, cwd: resolveCwd(def.cwd) };
  }
  if (request.command) {
    if (!config.allowArbitraryCommands) throw httpError(403, 'Arbitrary commands are disabled (allowArbitraryCommands=false); use a named job.');
    return { name: 'adhoc', command: String(request.command), cwd: resolveCwd(request.cwd) };
  }
  throw httpError(400, 'Body must contain "job" or "command".');
}

/**
 * Expands and validates a working directory, defaulting to the home directory.
 * @param cwd - requested directory
 */
function resolveCwd(cwd) {
  const dir = expandHome(cwd || '~');
  if (!fs.existsSync(dir)) throw httpError(400, `Working directory does not exist: ${dir}`);
  return dir;
}

/**
 * Spawns a command in the user's login shell (so PATH has cargo, nvm, brew...) with output going to `logPath`.
 * The child gets its own process group so cancel can kill the whole tree.
 * @param command - shell command
 * @param cwd - working directory
 * @param logPath - log file for stdout and stderr
 */
function spawnJob(command, cwd, logPath) {
  const out = fs.openSync(logPath, 'a');
  const shell = process.env.SHELL || '/bin/zsh';
  const child = spawn(shell, ['-lc', command], { cwd, env: { ...process.env, HOME: os.homedir() }, stdio: ['ignore', out, out], detached: true });
  fs.closeSync(out);
  return child;
}

/**
 * Creates an Error carrying an HTTP status.
 * @param status - HTTP status code
 * @param message - error message
 */
export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
