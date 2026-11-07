#!/bin/zsh
# Installs wol-agent on the Mac that should be woken and handed work.
#   - writes ~/.config/wol-agent/config.json (random token, example build-unluminous job) if it does not exist
#   - installs and (re)starts a LaunchAgent so the agent runs whenever you are logged in
#   - with --power, applies the recommended pmset settings (asks for sudo)
#   - prints the client config to copy to the machines that will send work
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.wol.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CONFIG_DIR="$HOME/.config/wol-agent"
CONFIG="$CONFIG_DIR/config.json"
DATA_DIR="$HOME/.wol-agent"
NODE_BIN="$(command -v node)"
PORT="${WOL_AGENT_PORT:-7777}"

# Writes a default agent config with a fresh random token, unless one already exists.
write_config() {
  mkdir -p "$CONFIG_DIR" "$DATA_DIR"
  if [[ -f "$CONFIG" ]]; then
    echo "• keeping existing $CONFIG"
    return
  fi
  local token
  token="$(openssl rand -hex 24)"
  cat > "$CONFIG" <<EOF
{
  "port": $PORT,
  "host": "0.0.0.0",
  "token": "$token",
  "allowArbitraryCommands": false,
  "keepAwakeSeconds": 300,
  "advertiseBonjour": true,
  "jobs": {
    "build-unluminous": {
      "description": "Release build of Unluminous",
      "cwd": "~/Documents/dev/unluminous",
      "command": "git pull --ff-only && cargo build --release"
    },
    "uptime": { "description": "Smoke test", "command": "uptime && pmset -g assertions | grep -E 'caffeinate|PreventSystemSleep'" }
  }
}
EOF
  chmod 600 "$CONFIG"
  echo "• wrote $CONFIG (token generated, mode 600)"
}

# Writes the LaunchAgent plist and (re)loads it into the user's GUI session.
install_launch_agent() {
  mkdir -p "$HOME/Library/LaunchAgents"
  sed -e "s#__NODE__#$NODE_BIN#g" -e "s#__REPO__#$REPO_DIR#g" -e "s#__DATA__#$DATA_DIR#g" -e "s#__PATH__#$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin#g" \
    "$REPO_DIR/launchd/com.wol.agent.plist.template" > "$PLIST"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "• installed LaunchAgent $PLIST (logs: $DATA_DIR/agent.log)"
}

# Applies the power settings remote wake depends on (AC power only; battery wake is unsupported on laptops).
apply_power_settings() {
  echo "• applying: sudo pmset -c womp 1 tcpkeepalive 1 autorestart 1"
  sudo pmset -c womp 1 tcpkeepalive 1 autorestart 1
}

# Prints current power/network facts and the client config for other machines.
print_summary() {
  local iface ip bcast cur_mac hw_mac token
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  bcast="$(ifconfig "$iface" | awk '/broadcast/{print $6}')"
  cur_mac="$(ifconfig "$iface" | awk '/ether/{print $2}')"
  hw_mac="$(networksetup -getmacaddress "$iface" 2>/dev/null | awk '{print $3}')"
  token="$(node -e "console.log(require('$CONFIG').token)")"
  echo
  echo "Power: $(pmset -g | grep -E '^ (womp|tcpkeepalive|sleep) ' | tr -s ' ' | paste -sd',' -)"
  echo "Bonjour sleep proxies on this LAN:"
  ( dns-sd -B _sleep-proxy._udp local. & local p=$!; sleep 3; kill $p ) 2>/dev/null | awk 'NR>4{ $1=$2=$3=$4=$5=$6=""; print "   " $0 }'
  if [[ "$cur_mac" != "$hw_mac" ]]; then
    echo "⚠ $iface is using a private Wi-Fi address ($cur_mac, hardware $hw_mac). Set 'Private Wi-Fi Address' to Fixed or Off"
    echo "  for this network (System Settings > Wi-Fi > Details) so magic packets keep targeting the right MAC."
  fi
  echo
  echo "Client config — save as ~/.config/wol/config.json on the machines that send work:"
  cat <<EOF
{
  "host": "$(scutil --get LocalHostName).local",
  "port": $PORT,
  "token": "$token",
  "macs": ["$cur_mac"$( [[ "$cur_mac" != "$hw_mac" ]] && echo ", \"$hw_mac\"" )],
  "broadcasts": ["$bcast", "255.255.255.255"],
  "fallbackIp": "$ip",
  "wakeTimeoutSeconds": 90
}
EOF
}

write_config
install_launch_agent
[[ "${1:-}" == "--power" ]] && apply_power_settings
sleep 1
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null && echo "• agent is answering on port $PORT" || echo "⚠ agent not answering yet; check $DATA_DIR/agent.log"
print_summary
