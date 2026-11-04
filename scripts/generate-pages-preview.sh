#!/usr/bin/env bash
set -euo pipefail

phase=${PREVIEW_PHASE:?PREVIEW_PHASE must be review or cleanup}
case "$phase" in
  review)
    marker=${LANE_MARKER:-}
    if [[ -z "${marker//[[:space:]]/}" ]]; then
      echo 'review phase requires a nonempty LANE_MARKER' >&2
      exit 1
    fi
    export LANE_MARKER="$marker"
    ;;
  cleanup)
    unset LANE_MARKER
    ;;
  *)
    echo 'PREVIEW_PHASE must be review or cleanup' >&2
    exit 1
    ;;
esac

repo=$(cd "$(dirname "$0")/.." && pwd)
site=${1:?usage: generate-pages-preview.sh OUTPUT_DIR}
temp=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/rig-pages.XXXXXX")
port=${PREVIEW_PORT:-18787}
server_pid=

cleanup() {
  if [[ -n "$server_pid" ]]; then
    pkill -TERM -P "$server_pid" 2>/dev/null || true
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$temp"
}
trap cleanup EXIT

mkdir -p "$site"
cp "$repo/rig.json" "$temp/rig.json"
ln -s "$repo/runs" "$temp/runs"
(
  cd "$temp"
  PORT="$port" "$repo/node_modules/.bin/tsx" --tsconfig "$repo/tsconfig.json" "$repo/src/server.ts" >"$temp/rig.log" 2>&1
) &
server_pid=$!

url="http://127.0.0.1:$port/digest/2026-10-28"
ready=false
for attempt in $(seq 1 30); do
  status=$(curl --silent --show-error "$url" --output "$site/index.html" --write-out '%{http_code}' 2>/dev/null || true)
  if [[ "$status" == 200 ]]; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'rig did not become ready within 30 seconds' >&2
  exit 1
fi

if ! grep -q 'digest · 2026-10-28' "$site/index.html" || \
   [[ $(grep -o '<tbody>' "$site/index.html" | wc -l | tr -d ' ') != 1 ]] || \
   [[ $(grep -o '<tr>' "$site/index.html" | wc -l | tr -d ' ') != 6 ]] || \
   ! grep -q '1 invalid line skipped' "$site/index.html"; then
  echo 'generated page does not match the 2026-10-28 fixture (expected 5 jobs and 1 bad line)' >&2
  exit 1
fi

if grep -Eiq '<script|<link|<(img|iframe|source|video|audio|object|embed)|src=|href=.*https?://|url\(' "$site/index.html"; then
  echo 'generated page contains a script or external resource' >&2
  exit 1
fi

if [[ "$phase" == review ]]; then
  if ! grep -Fq -- "$LANE_MARKER" "$site/index.html"; then
    echo 'review page is missing the configured lane marker' >&2
    exit 1
  fi
else
  if [[ $(grep -o 'class="marker"' "$site/index.html" | wc -l | tr -d ' ') != 1 ]] || \
     ! grep -q 'class="marker">no marker set</span>' "$site/index.html"; then
    echo 'cleanup page does not show the expected no-marker banner' >&2
    exit 1
  fi
fi
