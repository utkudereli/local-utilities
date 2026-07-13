#!/bin/bash
# Stops and removes the background server LaunchAgent.
PLIST="$HOME/Library/LaunchAgents/local-utilities.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Stopped and removed the Local Utilities background service."
