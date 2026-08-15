#!/usr/bin/env bash
set -euo pipefail

LABEL="com.datehoer.codex-usage-widget"
DOMAIN="gui/$(id -u)"
LOG_DIR="$HOME/Library/Logs/CodexUsageWidget"

launchctl print "$DOMAIN/$LABEL" | sed -n '1,45p'
echo

for _ in {1..10}; do
  if STATUS="$(curl --noproxy '*' --max-time 10 --fail --silent http://127.0.0.1:8787/api/status)"; then
    printf '%s\n' "$STATUS"
    exit 0
  fi
  sleep 1
done

echo "Bridge is running but no Codex status snapshot became ready." >&2
curl --noproxy '*' --max-time 5 --silent --show-error http://127.0.0.1:8787/healthz >&2 || true
echo >&2
echo "Recent startup log:" >&2
tail -n 12 "$LOG_DIR/bridge.log" >&2 2>/dev/null || true
echo "Recent error log:" >&2
tail -n 12 "$LOG_DIR/bridge.error.log" >&2 2>/dev/null || true
exit 1
