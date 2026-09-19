#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTH_PORT="${RR_AUTH_PORT:-18890}"
MCP_PORT="${RR_MCP_PORT:-18887}"
AUTH_HOST="${RR_AUTH_HOST:-auth.localtest.me}"
MCP_HOST="${RR_MCP_HOST:-remote.localtest.me}"
AUTH_ISSUER="https://${AUTH_HOST}"
MCP_RESOURCE="https://${MCP_HOST}"
TMP_DIR="$(mktemp -d)"
AUTH_PID=""
MCP_PID=""

cleanup() {
  if [[ -n "$MCP_PID" ]]; then kill "$MCP_PID" 2>/dev/null || true; fi
  if [[ -n "$AUTH_PID" ]]; then kill "$AUTH_PID" 2>/dev/null || true; fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

COOKIE_KEYS="$(
  node -e 'const c=require("node:crypto"); process.stdout.write(c.randomBytes(32).toString("base64url")+","+c.randomBytes(32).toString("base64url"))'
)"

cd "$ROOT"

env   PORT="$AUTH_PORT"   AUTH_ISSUER="$AUTH_ISSUER"   MCP_RESOURCE="$MCP_RESOURCE"   AUTH_DATABASE_PATH="$TMP_DIR/auth.sqlite"   AUTH_JWKS_PATH="$TMP_DIR/jwks.json"   AUTH_COOKIE_KEYS="$COOKIE_KEYS"   AUTH_ALLOW_REGISTRATION=true   node apps/auth/dist/index.js >"$TMP_DIR/auth.log" 2>&1 &
AUTH_PID=$!

AUTH_READY=false
for _ in $(seq 1 40); do
  if curl -fsS       -H "Host: $AUTH_HOST"       -H "X-Forwarded-Proto: https"       "http://127.0.0.1:$AUTH_PORT/healthz" >/dev/null 2>&1; then
    AUTH_READY=true
    break
  fi
  sleep 0.25
done

if [[ "$AUTH_READY" != true ]] || ! kill -0 "$AUTH_PID" 2>/dev/null; then
  cat "$TMP_DIR/auth.log" >&2
  exit 1
fi

env   PORT="$MCP_PORT"   PUBLIC_BASE_URL="$MCP_RESOURCE"   DATABASE_PATH="$TMP_DIR/relay.sqlite"   AUTH_ISSUER="$AUTH_ISSUER"   AUTH_AUDIENCE="$MCP_RESOURCE"   AUTH_JWKS_URL="http://127.0.0.1:$AUTH_PORT/jwks"   AUTH_REQUIRED_SCOPE=remote:use   node apps/server/dist/index.js >"$TMP_DIR/server.log" 2>&1 &
MCP_PID=$!

MCP_READY=false
for _ in $(seq 1 40); do
  if curl -fsS       -H "Host: $MCP_HOST"       "http://127.0.0.1:$MCP_PORT/healthz" >/dev/null 2>&1; then
    MCP_READY=true
    break
  fi
  sleep 0.25
done

if [[ "$MCP_READY" != true ]] || ! kill -0 "$MCP_PID" 2>/dev/null; then
  cat "$TMP_DIR/server.log" >&2
  exit 1
fi

RR_AUTH_HOST="$AUTH_HOST" RR_AUTH_PORT="$AUTH_PORT" RR_MCP_HOST="$MCP_HOST" RR_MCP_PORT="$MCP_PORT" RR_AUTH_ISSUER="$AUTH_ISSUER" RR_MCP_RESOURCE="$MCP_RESOURCE" python3 scripts/oauth-e2e-smoke.py

if grep -Eqi 'server_error|Unhandled|uncaught' "$TMP_DIR/auth.log" "$TMP_DIR/server.log"; then
  echo "Unexpected server error detected during OAuth E2E" >&2
  cat "$TMP_DIR/auth.log" >&2
  cat "$TMP_DIR/server.log" >&2
  exit 1
fi
