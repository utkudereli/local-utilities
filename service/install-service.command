#!/bin/bash
# Installs the background server as a macOS LaunchAgent (auto-starts at login).
# Portable: the WorkingDirectory is filled in from wherever this repo actually lives.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root (parent of service/)
SRC="$DIR/service/local-utilities.plist"
PLIST="$HOME/Library/LaunchAgents/local-utilities.plist"
mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__WORKDIR__|$DIR|g" "$SRC" > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
sleep 1
echo "Installed. Local Utilities now runs in the background at http://127.0.0.1:8765"
echo "Serving: $DIR"
echo "Status:"; launchctl list | grep local-utilities || echo "  (not listed — check /tmp/local-utilities.err)"
