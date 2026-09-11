#!/usr/bin/env bash
# bs.sh - BrowserStack helper. Dependencies: curl, jq, node.
set -euo pipefail

SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
API="https://api.browserstack.com/automate"
CACHE="$HOME/.cache/browserstack"

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

usage() {
  cat <<'USAGE'
bs.sh - check apps and websites on declared platforms via BrowserStack

  bs.sh auth-check                 verify credentials and show plan limits
  bs.sh auth-source                where credentials come from (env|file)
USAGE
}

case "${1:-}" in
  auth-source) shift; cmd_auth_source "$@" ;;
  auth-check)  shift; cmd_auth_check "$@" ;;
  *) usage; exit 1 ;;
esac
