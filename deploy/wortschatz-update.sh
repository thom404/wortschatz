#!/usr/bin/env bash
# wortschatz pull-based auto-deploy (ADR-0005).
#
# The homelab server polls GHCR for a fresh image of the last merged commit,
# re-pins the compose image line to that commit's sha, rolls the container,
# and verifies via the public /healthz that the running build answers with
# the exact same sha; a failed roll automatically restores the previous pin
# (last-known-good container back up) and exits non-zero for the systemd
# timer to surface. No inbound reachability from CI, no server credentials
# beyond docker's anonymous GHCR pulls (image is public per ADR-0004).
#
# Install + unit files: deploy/ (walk: docs/OPERATOR-STEPS.md §7).
# Env overrides: IMAGE, COMPOSE_DIR, SERVICE_URL, STATE_DIR, VERIFY_TIMEOUT.

set -uo pipefail

REPO="${REPO:-thom404/wortschatz}"
IMAGE="${IMAGE:-ghcr.io/${REPO}}"
COMPOSE_DIR="${COMPOSE_DIR:-$HOME/Docker/production/wordament}"
SERVICE_URL="${SERVICE_URL:-https://wordament.phanthom.cc}"
STATE_DIR="${STATE_DIR:-$HOME/.local/state/wortschatz}"
VERIFY_TIMEOUT="${VERIFY_TIMEOUT:-60}"

log() { printf '[wortschatz-update] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }
now() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }

command -v docker >/dev/null 2>&1 || die "docker not found"
cd "$COMPOSE_DIR" 2>/dev/null || die "compose dir missing: $COMPOSE_DIR"
[ -f compose.yaml ] || die "compose.yaml missing in $PWD"
mkdir -p "$STATE_DIR" || die "cannot create state dir: $STATE_DIR"
DIGEST_FILE="$STATE_DIR/latest-digest"

# Cheap change probe: manifest of :latest without pulling layers. Digest
# stays stable while the tag is untouched and changes on every new push.
remote_digest=$(docker manifest inspect "$IMAGE:latest" 2>/dev/null \
  | grep -oE 'sha256:[0-9a-f]{64}' | head -n1 || true)
if [ -z "$remote_digest" ]; then
  log "$(now) manifest unavailable (network/GHCR hiccup); skipping this run"
  exit 0 # soft skip: not a deploy failure, the next timer tick retries
fi
prev_digest=$(cat "$DIGEST_FILE" 2>/dev/null || true)
if [ "$remote_digest" = "$prev_digest" ]; then
  exit 0 # silent no-op between polls
fi
log "$(now) digest changed: ${prev_digest:-none} -> ${remote_digest}"

# Identity comes from the image itself, not the caller's environment.
docker pull --quiet "$IMAGE:latest" 2>/dev/null \
  || die "pull of $IMAGE:latest failed"
revision=$(docker image inspect --format \
  '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "$IMAGE:latest" 2>/dev/null)
if [ ${#revision} -ne 40 ]; then
  die "org.opencontainers.image.revision missing/garbled on $IMAGE:latest (image not built by CI?)"
fi

# Previous pin recorded first; rollback returns to it. The pin shape is a
# repo convention (owner/<repo>:sha-<40hex> on an `image:` line), fixed
# regardless of the IMAGE override: overridable stations (private GHCR
# namespaces, alternate dir) only move the *target*, never the search shape.
PIN_GLOB='ghcr\.io/thom404/[^:]+:sha-[0-9a-f]{40}'
old_pin=$(grep -oE "$PIN_GLOB" compose.yaml | head -n1 || true)
log "$(now) previous pin: ${old_pin:-none}"

# Atomic rewrite: mutate a temp copy, verify it looks took-shape, then mv.
write_pin() {
  local target="$1" tmp
  tmp=$(mktemp) || die "mktemp failed"
  if sed -E "s#^([[:space:]]*)image: ${PIN_GLOB}#\1image: ${target}#" compose.yaml > "$tmp" \
    && grep -qF "image: ${target}" "$tmp"; then
    mv "$tmp" compose.yaml
  else
    rm -f "$tmp"
    die "compose re-pin to '${target}' did not take shape"
  fi
}

pin_new()   { write_pin "${IMAGE}:sha-${revision}"; }
restore_old(){ write_pin "${old_pin}"; }

rollback() {
  log "$(now) DEPLOY FAILED — rolling back (previous pin: ${old_pin:-none})"
  if [ -n "$old_pin" ]; then
    if ! restore_old; then
      log "$(now) WARN: could not restore the previous pin by rewrite; manual §3 pin-copy resumes last-good."
    elif ! docker compose pull --quiet 2>/dev/null; then
      log "$(now) WARN: last-good pin restored but its pull failed — the container may still serve an older or swapped layer."
    elif ! docker compose up -d 2>/dev/null; then
      log "$(now) WARN: last-good pin's up failed — container state unclear."
    else
      log "$(now) rollback finished; serving last-good pin: ${old_pin}"
    fi
  else
    log "$(now) no previous pin to restore — the failing sha stays unless nothing was started; manual declutter via OPERATOR-STEPS §3."
  fi
  exit 1
}

if [ "$old_pin" = "${IMAGE}:sha-${revision}" ]; then
  # The digest moved (workflow re-run of the same commit): refresh only.
  log "$(now) already pinned at ${revision}; refreshing layers only"
  docker compose pull --quiet 2>/dev/null || rollback
  docker compose up -d 2>/dev/null || rollback
else
  pin_new
  docker compose pull --quiet 2>/dev/null \
    || { log "$(now) compose pull failed"; rollback; }
  docker compose up -d 2>/dev/null \
    || { log "$(now) compose up failed"; rollback; }
fi

remaining=$VERIFY_TIMEOUT
body=""
verify_deployed() {
  while [ "$remaining" -gt 0 ]; do
    body=$(curl -fsS --max-time 10 "$SERVICE_URL/healthz" 2>/dev/null || true)
    if echo "$body" | grep -qF "\"sha\":\"${revision}\""; then
      return 0
    fi
    sleep 2
    remaining=$(( remaining - 2 ))
  done
  return 1
}

if verify_deployed; then
  printf '%s\n' "$remote_digest" > "$DIGEST_FILE"
  log "$(now) deployed ${revision} (digest ${remote_digest}); /healthz confirms"
  log "$(now) done"
  exit 0
fi

log "$(now) /healthz did not confirm ${revision} within ${VERIFY_TIMEOUT}s; last answer: ${body:-none}"
rollback
