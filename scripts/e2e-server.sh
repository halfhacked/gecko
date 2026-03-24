#!/usr/bin/env bash
# scripts/e2e-server.sh — Start/stop E2E dev server with port conflict detection.
#
# Usage:
#   scripts/e2e-server.sh start <port>   # Start server, save PID
#   scripts/e2e-server.sh stop            # Kill saved PID
#
# D1 test isolation: The server is started with CF_D1_DATABASE_ID_TEST pointing
# to the gecko-test D1 instance. This ensures E2E tests never touch production data.
#
# The script stores the server PID in /tmp/gecko-e2e-server.pid.

set -euo pipefail

PID_FILE="/tmp/gecko-e2e-server.pid"
HEALTH_TIMEOUT=30  # seconds

# D1 test database ID — gecko-test instance (isolated from production)
CF_D1_DATABASE_ID_TEST="bbe41479-5eeb-4598-abc5-12ccebcb9465"

start_server() {
  local port="${1:?Usage: e2e-server.sh start <port>}"

  # Kill any stale process on target port
  local stale_pid
  stale_pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$stale_pid" ]; then
    echo "[e2e-server] Port $port occupied by PID $stale_pid — killing..."
    kill "$stale_pid" 2>/dev/null || true
    sleep 1
  fi

  # Start E2E dev server in background with test DB isolation
  echo "[e2e-server] Starting dev server on port $port (test DB: $CF_D1_DATABASE_ID_TEST)..."
  cd apps/web-dashboard
  E2E_SKIP_AUTH=true CF_D1_DATABASE_ID_TEST="$CF_D1_DATABASE_ID_TEST" bun run vinext dev --port "$port" &>/dev/null &
  local pid=$!
  cd ../..
  echo "$pid" > "$PID_FILE"

  # Health-check loop
  local elapsed=0
  while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    if curl -sf "http://localhost:$port/api/live" >/dev/null 2>&1; then
      echo "[e2e-server] Server ready on port $port (PID $pid)"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "[e2e-server] ERROR: Server did not start within ${HEALTH_TIMEOUT}s"
  stop_server
  exit 1
}

stop_server() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo "[e2e-server] Stopping server (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      # Wait for graceful shutdown
      local i=0
      while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 5 ]; do
        sleep 1
        i=$((i + 1))
      done
      # Force kill if still alive
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$PID_FILE"
    echo "[e2e-server] Server stopped."
  else
    echo "[e2e-server] No PID file found — nothing to stop."
  fi
}

case "${1:-}" in
  start) start_server "${2:-}" ;;
  stop)  stop_server ;;
  *)     echo "Usage: e2e-server.sh {start <port>|stop}" && exit 1 ;;
esac
