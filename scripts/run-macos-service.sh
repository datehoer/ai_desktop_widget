#!/usr/bin/env bash
set -u

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  printf '[%s] [runner] %s\n' "$(timestamp)" "$*"
}

NODE_BIN="${CODEX_WIDGET_NODE_BIN:-}"
SERVER_JS="${CODEX_WIDGET_SERVER_JS:-}"
PROJECT_ROOT="${CODEX_WIDGET_PROJECT_ROOT:-}"
PROXY_URL="${CODEX_WIDGET_PROXY_URL:-}"

if [[ -z "$NODE_BIN" || -z "$SERVER_JS" || -z "$PROJECT_ROOT" ]]; then
  log "missing CODEX_WIDGET_NODE_BIN, CODEX_WIDGET_SERVER_JS, or CODEX_WIDGET_PROJECT_ROOT"
  exit 64
fi

# LaunchAgents can run before an external volume has finished mounting after login.
# Keep this small launcher on the system volume, then wait here instead of asking
# launchd to resolve the external WorkingDirectory before the process can start.
attempt=0
while [[ ! -x "$NODE_BIN" || ! -r "$SERVER_JS" || ! -d "$PROJECT_ROOT" ]]; do
  if (( attempt % 12 == 0 )); then
    log "waiting for project volume and Node.js"
  fi
  attempt=$((attempt + 1))
  sleep 5
done

# The local proxy is normally started by a login item too. Waiting for it avoids
# burning the first App Server initialization attempt during login startup.
if [[ "$PROXY_URL" =~ ^https?://([^/:]+):([0-9]+)(/.*)?$ ]]; then
  proxy_host="${BASH_REMATCH[1]}"
  proxy_port="${BASH_REMATCH[2]}"
  attempt=0
  while ! /usr/bin/nc -z "$proxy_host" "$proxy_port" >/dev/null 2>&1; do
    if (( attempt % 12 == 0 )); then
      log "waiting for proxy at ${proxy_host}:${proxy_port}"
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
fi

cd "$PROJECT_ROOT" || exit 1
log "starting Codex Usage Bridge"
exec "$NODE_BIN" "$SERVER_JS"
