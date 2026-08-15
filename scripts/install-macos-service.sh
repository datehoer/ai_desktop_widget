#!/usr/bin/env bash
set -euo pipefail

LABEL="com.datehoer.codex-usage-widget"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/$LABEL.plist.template"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/CodexUsageWidget"
SUPPORT_DIR="$HOME/Library/Application Support/CodexUsageWidget"
RUNNER_SOURCE="$SCRIPT_DIR/run-macos-service.sh"
RUNNER_SCRIPT="$SUPPORT_DIR/run-macos-service.sh"
PROXY_URL="${CODEX_WIDGET_PROXY:-http://127.0.0.1:7890}"
NODE_BIN="${CODEX_WIDGET_NODE_BIN:-$(command -v node || true)}"
CODEX_BIN="${CODEX_WIDGET_CODEX_BIN:-$(command -v codex || true)}"

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Node.js executable not found. Run 'nvm use' first or set CODEX_WIDGET_NODE_BIN." >&2
  exit 1
fi
if [[ -z "$CODEX_BIN" || ! -x "$CODEX_BIN" ]]; then
  echo "Codex executable not found. Set CODEX_WIDGET_CODEX_BIN to its absolute path." >&2
  exit 1
fi
for value in "$PROJECT_ROOT" "$NODE_BIN" "$CODEX_BIN" "$PROXY_URL" "$HOME"; do
  if [[ "$value" == *'&'* || "$value" == *'<'* || "$value" == *'>'* || "$value" == *'|'* ]]; then
    echo "Unsupported XML or template character in service value: $value" >&2
    exit 1
  fi
done

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$SUPPORT_DIR"
install -m 0755 "$RUNNER_SOURCE" "$RUNNER_SCRIPT"
TEMP_PLIST="$(mktemp)"
trap 'rm -f "$TEMP_PLIST"' EXIT

SERVICE_PATH="$(dirname "$NODE_BIN"):$(dirname "$CODEX_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
sed \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__RUNNER_SCRIPT__|$RUNNER_SCRIPT|g" \
  -e "s|__SERVER_JS__|$PROJECT_ROOT/bridge/src/server.js|g" \
  -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
  -e "s|__SERVICE_PATH__|$SERVICE_PATH|g" \
  -e "s|__USER_HOME__|$HOME|g" \
  -e "s|__CODEX_BIN__|$CODEX_BIN|g" \
  -e "s|__PROXY_URL__|$PROXY_URL|g" \
  -e "s|__STDOUT_LOG__|$LOG_DIR/bridge.log|g" \
  -e "s|__STDERR_LOG__|$LOG_DIR/bridge.error.log|g" \
  "$TEMPLATE" > "$TEMP_PLIST"

plutil -lint "$TEMP_PLIST" >/dev/null

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true

LISTENER_PID="$(lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null | head -1 || true)"
if [[ -n "$LISTENER_PID" ]]; then
  LISTENER_COMMAND="$(ps -p "$LISTENER_PID" -o command= 2>/dev/null || true)"
  if [[ "$LISTENER_COMMAND" == *"bridge/src/server.js"* ]]; then
    kill "$LISTENER_PID"
    for _ in {1..20}; do
      kill -0 "$LISTENER_PID" 2>/dev/null || break
      sleep 0.1
    done
  else
    echo "Port 8787 is occupied by another process: $LISTENER_COMMAND" >&2
    exit 1
  fi
fi

install -m 0644 "$TEMP_PLIST" "$PLIST_PATH"
launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
launchctl enable "$DOMAIN/$LABEL"

echo "Installed $LABEL"
echo "Proxy: $PROXY_URL"
echo "Logs: $LOG_DIR"
