import { spawn } from 'node:child_process';
import os from 'node:os';

export const SERVICE_TYPE = '_wol-agent._tcp';

/**
 * Registers the agent with mDNSResponder via `dns-sd -R` for as long as the returned handle lives.
 * This is what makes remote wake work: when the Mac sleeps, mDNSResponder hands its registered services to a
 * Bonjour Sleep Proxy (Apple TV / HomePod / AirPort) on the LAN, and a TCP SYN to this port makes the proxy wake us.
 * Restarts dns-sd if it dies. No-op off macOS.
 * @param port - TCP port to advertise
 * @param name - service instance name
 */
export function advertiseAgent(port, name = `wol-agent on ${os.hostname().replace(/\.local$/, '')}`) {
  if (process.platform !== 'darwin') return { stop() {} };
  const state = { proc: null, stopped: false };

  /**
   * Spawns dns-sd and schedules a restart when it exits unexpectedly.
   */
  function register() {
    state.proc = spawn('/usr/bin/dns-sd', ['-R', name, SERVICE_TYPE, 'local', String(port), 'path=/health'], { stdio: 'ignore' });
    state.proc.on('error', (err) => console.warn(`[wol-agent] dns-sd failed: ${err.message}`));
    state.proc.on('exit', () => { if (!state.stopped) setTimeout(register, 5000); });
    console.log(`[wol-agent] advertising "${name}" ${SERVICE_TYPE} on port ${port}`);
  }

  register();
  return {
    /** Unregisters the service. */
    stop() {
      state.stopped = true;
      if (state.proc) state.proc.kill();
    },
  };
}
