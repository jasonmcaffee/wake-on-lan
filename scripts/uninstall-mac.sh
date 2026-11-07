#!/bin/zsh
# Stops and removes the wol-agent LaunchAgent. Leaves ~/.config/wol-agent and ~/.wol-agent (config, token, logs) in place.
set -euo pipefail
LABEL="com.wol.agent"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "removed $LABEL. Config and logs kept in ~/.config/wol-agent and ~/.wol-agent"
