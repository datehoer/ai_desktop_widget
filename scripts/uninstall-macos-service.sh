#!/usr/bin/env bash
set -euo pipefail

LABEL="com.datehoer.codex-usage-widget"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER_SCRIPT="$HOME/Library/Application Support/CodexUsageWidget/run-macos-service.sh"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"
rm -f "$RUNNER_SCRIPT"
rmdir "$HOME/Library/Application Support/CodexUsageWidget" >/dev/null 2>&1 || true
echo "Uninstalled $LABEL"
echo "Existing logs were kept in $HOME/Library/Logs/CodexUsageWidget"
