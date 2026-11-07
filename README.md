# wake-on-lan

Wake a sleeping Mac over the LAN and hand it work, e.g. "build Unluminous", from another machine (such as one
running Claude Code). It uses no dependencies and only needs Node ≥ 18. The design is in [tasks/wake-on-lan-tdd.md](tasks/wake-on-lan-tdd.md).

## How it works
- **`wol-agent`** runs on the Mac as a LaunchAgent. It serves a small authenticated HTTP API on port 7777, runs named jobs,
  and advertises itself over Bonjour (`_wol-agent._tcp`). When the Mac sleeps, the LAN's Bonjour Sleep Proxy (an Apple TV or
  HomePod) takes over that port. A connection attempt to the port makes the proxy wake the Mac.
- **`wol`** runs on the other machine. It sends magic packets, probes the port (which triggers the sleep proxy), waits until the agent
  answers, starts the job and streams its log.
- While a job runs, the agent holds `caffeinate` assertions that also work in dark wake, so the Mac cannot fall back asleep
  mid-build. When the job ends, normal sleep resumes.

## Set up the Mac to be woken
```sh
./scripts/setup-mac.sh          # config + LaunchAgent; prints the client config to copy
./scripts/setup-mac.sh --power  # also runs: sudo pmset -c womp 1 tcpkeepalive 1 autorestart 1
```
Requirements:
- The Mac must be **on AC power**.
- A Bonjour Sleep Proxy (Apple TV or HomePod) must be on the LAN.
- In System Settings ▸ Wi-Fi ▸ Details, set **Private Wi-Fi Address** to *Fixed* or *Off* for this network.

Jobs live in `~/.config/wol-agent/config.json`:
```json
"jobs": {
  "build-unluminous": { "cwd": "~/Documents/dev/unluminous", "command": "git pull --ff-only && cargo build --release" }
}
```
Jobs run in your login shell (`zsh -lc`), so cargo, nvm and brew are on PATH. Arbitrary commands are refused unless
`"allowArbitraryCommands": true`. Logs are written to `~/.wol-agent/` (`agent.log`, `logs/<id>.log`, `jobs.jsonl`).
To remove the agent, run `./scripts/uninstall-mac.sh`.

## Use it from another machine
Clone the repo, then save the config that `setup-mac.sh` printed as `~/.config/wol/config.json`:
```sh
node bin/wol.js status                    # awake? (never wakes)
node bin/wol.js wake                      # wake and wait for the agent
node bin/wol.js run build-unluminous      # wake, build, stream log, exit with the build's exit code
node bin/wol.js run build-unluminous --no-follow   # start it and print the run id
node bin/wol.js logs <id> | cancel <id>
node bin/wol.js keep-awake 3600           # hold the Mac awake for an hour
```
Flags `--host --fallback-ip --port --token --mac --broadcast --timeout` and the env vars `WOL_HOST`, `WOL_PORT` and `WOL_TOKEN`
override the config file.

## Troubleshooting
- `pmset -g log | grep -E "Wake from|DarkWake" | tail` shows why the Mac woke.
- `pmset -g assertions` shows what is keeping it awake.
- `dns-sd -B _sleep-proxy._udp` lists the sleep proxies; `dns-sd -B _wol-agent._tcp` should list the agent.
- If wake is unreliable on your network, run `sudo pmset -c sleep 0` (display still sleeps; the Mac never sleeps).

## Tests
`npm test` runs integration tests. They start the real agent and drive it with the real CLI, including a simulated wake.

## Board
The board on ai.jasonmcaffee.com reached this Mac (task-2532 end to end test).
