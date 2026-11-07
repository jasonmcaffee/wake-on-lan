import { spawn } from 'node:child_process';

/**
 * Creates a keep-awake lease manager backed by macOS `caffeinate`.
 *
 * A network wake (sleep proxy / magic packet) usually lands the Mac in *dark wake*, where `PreventUserIdleSystemSleep`
 * (`caffeinate -i`) is ignored. So whenever a lease starts from idle we first declare user activity (`caffeinate -u`),
 * which promotes dark wake to a full wake, and every assertion also takes `-s` (PreventSystemSleep, honoured on AC).
 *
 * `extend(seconds)` keeps the Mac awake for at least that long; `holdWhile(pid)` keeps it awake until a process exits.
 * On non-macOS platforms every call is a no-op.
 * @param caffeinatePath - path to caffeinate (overridable for tests)
 */
export function createKeepAwake(caffeinatePath = '/usr/bin/caffeinate') {
  const enabled = process.platform === 'darwin';
  const state = { leaseProc: null, leaseUntil: 0 };

  /**
   * Holds a timed assertion, replacing the current one only if the new lease ends meaningfully later.
   * @param seconds - minimum seconds to stay awake from now
   */
  function extend(seconds) {
    if (!enabled || seconds <= 0) return;
    const until = Date.now() + seconds * 1000;
    if (state.leaseProc && until - state.leaseUntil < 5000) return;
    if (!state.leaseProc) promoteToFullWake();
    const previous = state.leaseProc;
    const proc = spawnCaffeinate(caffeinatePath, ['-i', '-s', '-t', String(seconds)]);
    state.leaseProc = proc;
    state.leaseUntil = until;
    proc.on('exit', () => { if (state.leaseProc === proc) state.leaseProc = null; });
    if (previous) previous.kill();
  }

  /**
   * Declares user activity for a few seconds so a dark wake becomes a full wake (turns the display on briefly).
   */
  function promoteToFullWake() {
    spawnCaffeinate(caffeinatePath, ['-u', '-t', '5']);
  }

  /**
   * Prevents idle, disk and system sleep until the process with `pid` exits.
   * @param pid - process to wait on
   */
  function holdWhile(pid) {
    if (!enabled) return null;
    return spawnCaffeinate(caffeinatePath, ['-i', '-s', '-m', '-w', String(pid)]);
  }

  /**
   * Releases the timed lease (used on shutdown).
   */
  function release() {
    if (state.leaseProc) state.leaseProc.kill();
    state.leaseProc = null;
  }

  return { extend, holdWhile, release };
}

/**
 * Spawns a caffeinate process with no stdio attached.
 * @param caffeinatePath - caffeinate binary
 * @param args - caffeinate flags
 */
function spawnCaffeinate(caffeinatePath, args) {
  const proc = spawn(caffeinatePath, args, { stdio: 'ignore' });
  proc.on('error', (err) => console.warn(`[wol-agent] caffeinate failed: ${err.message}`));
  return proc;
}
