/**
 * Shared JSDoc type definitions. Nothing here runs; it documents the shapes passed between layers.
 */

/**
 * A named, pre-approved job the agent is allowed to run.
 * @typedef {Object} JobDefinition
 * @property {string} command - shell command, run with the user's login shell (`zsh -lc`)
 * @property {string} [cwd] - working directory; `~` is expanded
 * @property {string} [description] - shown by `wol jobs`
 */

/**
 * Agent configuration, read from ~/.config/wol-agent/config.json.
 * @typedef {Object} AgentConfig
 * @property {number} port - TCP port the HTTP API listens on (also advertised over Bonjour)
 * @property {string} host - interface to bind, `0.0.0.0` for the LAN
 * @property {string} token - shared secret clients must send as `Authorization: Bearer <token>`
 * @property {boolean} allowArbitraryCommands - when false only `jobs` may be run
 * @property {Record<string, JobDefinition>} jobs - named jobs
 * @property {number} keepAwakeSeconds - how long any request keeps the Mac awake (bridges dark wake -> job start)
 * @property {string} dataDir - where job logs are written
 * @property {boolean} advertiseBonjour - register `_wol-agent._tcp` so the Bonjour Sleep Proxy wakes us on connect
 */

/**
 * Client configuration, read from ~/.config/wol/config.json or flags.
 * @typedef {Object} ClientConfig
 * @property {string} host - agent host name or IP, e.g. `Jasons-MacBook-Pro-2.local`
 * @property {string} fallbackIp - IP used when `host` does not resolve (e.g. a Linux client without mDNS)
 * @property {number} port - agent port
 * @property {string} token - shared secret
 * @property {string[]} macs - MAC addresses to send magic packets to
 * @property {string[]} broadcasts - broadcast addresses for magic packets
 * @property {number} wakeTimeoutSeconds - how long to keep trying to wake
 */

/**
 * State of a job run.
 * @typedef {'running'|'succeeded'|'failed'|'cancelled'} JobStatus
 */

/**
 * A job run tracked by the agent.
 * @typedef {Object} JobRecord
 * @property {string} id
 * @property {string} name - job name, or `adhoc` for arbitrary commands
 * @property {string} command
 * @property {string} cwd
 * @property {JobStatus} status
 * @property {number|null} exitCode
 * @property {number|null} pid
 * @property {string} logPath
 * @property {string} startedAt - ISO timestamp
 * @property {string|null} finishedAt - ISO timestamp
 */

export {};
