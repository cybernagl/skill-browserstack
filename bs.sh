#!/usr/bin/env bash
# bs.sh - BrowserStack helper. Dependencies: curl, jq, node.
set -euo pipefail

SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
API="https://api.browserstack.com/automate"
CACHE="$HOME/.cache/browserstack"
PROJECT_DIR=${BS_PROJECT_DIR:-$PWD}
TUNNEL_BIN="$CACHE/BrowserStackLocal"

die() { echo "bs: $*" >&2; exit 1; }

creds() {
  if [[ -n "${BROWSERSTACK_USERNAME:-}" && -n "${BROWSERSTACK_ACCESS_KEY:-}" ]]; then
    BS_USER=$BROWSERSTACK_USERNAME BS_KEY=$BROWSERSTACK_ACCESS_KEY BS_AUTH_SOURCE=env
    return
  fi
  local f="$HOME/.config/browserstack/credentials"
  if [[ -f $f ]]; then
    BS_USER=$(sed -n 's/^username=//p' "$f")
    BS_KEY=$(sed -n 's/^access_key=//p' "$f")
    BS_AUTH_SOURCE=file
    [[ -n $BS_USER && -n $BS_KEY ]] && return
  fi
  die "no credentials: set BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY, or write $f (lines: username=..., access_key=..., chmod 600)"
}

# api METHOD URL [CURL_ARGS...] -> body on stdout, dies on HTTP error
api() {
  local method=$1 url=$2; shift 2
  local out code
  out=$(curl -sS -u "$BS_USER:$BS_KEY" -X "$method" "$url" "$@" -w $'\n%{http_code}')
  code=${out##*$'\n'}; out=${out%$'\n'*}
  [[ "$code" == 2* ]] || { echo "bs: HTTP $code from $method $url: $out" >&2; return 22; }
  printf '%s' "$out"
}

bootstrap() { [[ -d "$SKILL_DIR/node_modules" ]] || npm ci --prefix "$SKILL_DIR" --silent; }

cmd_auth_source() { creds; echo "$BS_AUTH_SOURCE"; }

cmd_auth_check() {
  creds
  api GET "$API/plan.json" | jq -r '"plan ok: \(.parallel_sessions_max_allowed) parallels (\(.parallel_sessions_running) running)"'
}

cmd_resolve() {
  creds; bootstrap
  BROWSERSTACK_USERNAME=$BS_USER BROWSERSTACK_ACCESS_KEY=$BS_KEY \
    node "$SKILL_DIR/lib/cli-resolve.mjs" "$PROJECT_DIR" "$@"
}

cmd_check() {
  creds; bootstrap
  local rc=0
  BROWSERSTACK_USERNAME=$BS_USER BROWSERSTACK_ACCESS_KEY=$BS_KEY \
    node "$SKILL_DIR/lib/cli-check.mjs" "$PROJECT_DIR" "$@" || rc=$?
  if [[ $rc -eq 3 ]]; then           # runner asked for the tunnel
    tunnel_ensure "${BS_TUNNEL_ID:-$(basename "$PROJECT_DIR")}"
    BROWSERSTACK_USERNAME=$BS_USER BROWSERSTACK_ACCESS_KEY=$BS_KEY BS_TUNNEL_READY=1 \
      node "$SKILL_DIR/lib/cli-check.mjs" "$PROJECT_DIR" "$@"
  else
    return $rc
  fi
}

cmd_shots() { creds; bootstrap; BROWSERSTACK_USERNAME=$BS_USER BROWSERSTACK_ACCESS_KEY=$BS_KEY node "$SKILL_DIR/lib/cli-shots.mjs" "$PROJECT_DIR" "$@"; }

cmd_app() { creds; bootstrap; BROWSERSTACK_USERNAME=$BS_USER BROWSERSTACK_ACCESS_KEY=$BS_KEY node "$SKILL_DIR/lib/cli-app.mjs" "$PROJECT_DIR" "$@"; }

tunnel_download() {
  [[ -z "${BS_TUNNEL_NO_DOWNLOAD:-}" ]] || die "BrowserStackLocal binary missing at $TUNNEL_BIN and download disabled"
  local os arch
  case "$(uname -s)" in Darwin) os=darwin; arch=x64 ;; Linux) os=linux ;; *) die "unsupported OS" ;; esac
  # BrowserStackLocal ships only darwin-x64; Apple Silicon Macs run it via Rosetta
  [[ "$os" != linux ]] || case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64) arch=x64 ;; *) die "unsupported arch" ;; esac
  mkdir -p "$CACHE"
  echo "downloading BrowserStackLocal ($os-$arch)..." >&2
  curl -sSL "https://www.browserstack.com/browserstack-local/BrowserStackLocal-$os-$arch.zip" -o "$CACHE/bsl.zip"
  unzip -oq "$CACHE/bsl.zip" -d "$CACHE" && rm "$CACHE/bsl.zip"
  chmod +x "$TUNNEL_BIN"
}

tunnel_id_arg() {  # parse optional --id, default to project basename
  TUNNEL_ID=$(basename "$PROJECT_DIR")
  if [[ "${1:-}" == "--id" ]]; then
    [[ $# -ge 2 ]] || die "usage: --id requires a value"
    TUNNEL_ID=$2
  fi
}

tunnel_running() { pgrep -f -- "BrowserStackLocal.*--local-identifier $TUNNEL_ID( |$)" >/dev/null; }

# Starts the daemon with the access key kept off argv (never visible in `ps`):
# the BrowserStackLocal binary has no env var for the key, so it goes into a
# config-file YAML written under $CACHE with mode 600 and removed right
# after. The daemon prints a JSON status line on start (observed on stderr,
# despite the binary calling it a "daemon" response); that line, and the
# binary's own browserstack.err, are both captured under $CACHE instead of
# the CWD. A start that doesn't report state "connected" dies loudly with
# the captured message rather than silently leaving the tunnel down.
tunnel_ensure() {
  TUNNEL_ID=$1
  tunnel_running && return
  [[ -x "$TUNNEL_BIN" ]] || tunnel_download
  mkdir -p "$CACHE"
  local cfg="$CACHE/local-$TUNNEL_ID.yml" out="$CACHE/tunnel-start-$TUNNEL_ID.json" state
  ( umask 077; printf "key: '%s'\n" "${BS_KEY//\'/\'\'}" > "$cfg" )
  BROWSERSTACK_ERR_FILE="$CACHE/browserstack.err" "$TUNNEL_BIN" \
    --config-file "$cfg" --daemon start --local-identifier "$TUNNEL_ID" \
    --log-file "$CACHE/browserstack.log" >"$out" 2>&1
  rm -f "$cfg"
  state=$(jq -r '.state // empty' "$out" 2>/dev/null)
  [[ "$state" == "connected" ]] || die "tunnel $TUNNEL_ID failed to start: $(cat "$out")"
  echo "tunnel $TUNNEL_ID started" >&2
}

cmd_tunnel() {
  creds
  local action=${1:?usage: bs.sh tunnel start|stop|status [--id IDENT]}; shift
  tunnel_id_arg "$@"
  case $action in
    start)  tunnel_ensure "$TUNNEL_ID"; echo "tunnel $TUNNEL_ID running" ;;
    stop)   [[ -x "$TUNNEL_BIN" ]] && "$TUNNEL_BIN" --daemon stop --local-identifier "$TUNNEL_ID" >/dev/null || true
            echo "tunnel $TUNNEL_ID stopped" ;;
    status) if tunnel_running; then echo "tunnel $TUNNEL_ID running"; else echo "tunnel $TUNNEL_ID not running"; fi ;;
    *) die "unknown tunnel action: $action" ;;
  esac
}

usage() {
  cat <<'USAGE'
bs.sh - check apps and websites on declared platforms via BrowserStack

  bs.sh auth-check                                             verify credentials and show plan limits
  bs.sh auth-source                                            where credentials come from (env|file)
  bs.sh resolve [--json]                                       manifest -> concrete target matrix
  bs.sh tunnel start|stop|status [--id I]                      local tunnel for localhost targets
  bs.sh check [SCRIPT.mjs] [--url U] [--local] [--parallel N]  pass/fail matrix
  bs.sh shots [URL] [--out DIR]                                render sweep across the matrix
  bs.sh app ios|android [--fresh]                              launch smoke on declared devices
USAGE
}

case "${1:-}" in
  auth-source) shift; cmd_auth_source "$@" ;;
  auth-check)  shift; cmd_auth_check "$@" ;;
  resolve)     shift; cmd_resolve "$@" ;;
  tunnel)      shift; cmd_tunnel "$@" ;;
  check)       shift; cmd_check "$@" ;;
  shots)       shift; cmd_shots "$@" ;;
  app)         shift; cmd_app "$@" ;;
  *) usage; exit 1 ;;
esac
