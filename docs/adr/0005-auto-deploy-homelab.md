# ADR-0005: Pull-based homelab auto-deploy (server polls GHCR)

- Status: Accepted
- Date: 2026-10-16
- Ticket: [#29](https://github.com/thom404/wortschatz/issues/29)
  (auto-deploy to homelab on merge to main)
- Depends on: [#27](https://github.com/thom404/wortschatz/issues/27)
  (merge-built image lands in GHCR), [ADR-0004](0004-branch-protection-main.md)
  (main is PR-only; every deployable commit arrives via merge)
- Operator doc: [`docs/OPERATOR-STEPS.md`](../OPERATOR-STEPS.md) §7
- On-server pieces: [`deploy/`](../../deploy/)

## Context

Until #29, deploys were manual: the operator edited the server-side compose
pin to a fresh `sha-<full-sha>`, copied the file up, refreshed (per #32/#33).
Every merge to `main` already publishes
`ghcr.io/thom404/wortschatz:sha-<full-merge-sha>` plus `:latest`
(#27), so the artifact for the exact merge commit always exists before
anything could deploy it. The server is a stateless consumer (`compose.yaml`:
`PORT=3000`, no volume, Traefik labels, `reverse-proxy` external network) and
never builds.

#29's original text prescribed the _push_ direction: the CI workflow SSHes
into the homelab and drives `docker compose pull` over the wire. When
confronted with the threat model — a deploy-scope private key stored as an
Actions secret, CI reaching the private network on every merge — the owner
chose **not** to open inbound SSH to GitHub's runner IP ranges and picked the
pull direction instead. The build-side of the flow is unchanged; only who
initiates the deploy differs.

## Decision

**The server deploys itself; CI never connects to it.**

1. **Identity in the artifact.** The `Image` workflow (unchanged apart from
   its build job) bakes `github.sha` into the image two ways at build time:
   with verified `WORDAMENT_GIT_SHA` (Dockerfile `ARG GIT_SHA` →
   `ENV`, surfaced by `GET /healthz`, test at the `/healthz` seam in
   `packages/server/tests/static.test.ts`) and with
   `org.opencontainers.image.revision` (docker/metadata-action sets it to the
   merge commit automatically). The running container can be asked
   "exactly which commit built you" from any vantage point, publicly, via
   `$SERVICE_URL/healthz`.
2. **Change probe without pulling** (the poller's tick): `docker manifest
inspect ghcr.io/thom404/wortschatz:latest` — anonymous, no layer transfer —
   compared against the digest in `~/.local/state/wortschatz/latest-digest`.
   Unavailable manifest (rate limit, offline) is a _soft skip_ (exit 0), not
   a deploy failure: the next timer tick retries.
3. **Deploy on change**: pull `latest`; read the `revision` label; `sed` the
   one `image:` line in the server's `compose.yaml` to
   `ghcr.io/thom404/wortschatz:sha-<revision>` (indentation preserved); then
   the standard refresh (`docker compose pull` + `docker compose up -d`).
4. **Verify, then record; else roll back.** `GET $SERVICE_URL/healthz` must
   answer HTTP 200 with `\"sha\":\"<revision>\"` within `VERIFY_TIMEOUT`
   (default 60 s). Success writes the digest marker; failure restores the
   previous pin from a backup (`old_pin` captured pre-sed), re-pulls it and
   re-`up -d`s — `up -d` only ever happens after a successful `pull`, so a
   half-landed image never gets started — and exits non-zero so the systemd
   unit surfaces in `systemctl is-failed`/journal. A skipped-verify digest is
   deliberately not archived: the next tick keeps trying until the newest
   image succeeds or a genuinely newer one replaces it.
5. **Scheduling**: `deploy/wortschatz-update.timer` — 15-min cadence
   (`OnUnitActiveSec`), `OnBootSec=5min`, `Persistent=true` for offline
   catch-up; the service unit (`Type=oneshot`, `TimeoutStartSec=300`) is the
   single caller of `deploy/wortschatz-update.sh` (installed at
   `/usr/local/bin/wortschatz-update`).

## Consequences

- The server's exposure shrinks: no inbound reachability for CI, no Actions
  secrets at all for deployment (the #26/CI `checks` gate still defends
  `main`; nothing on the server needs an SSH key or a write-anything token).
  The only credential that can ever matter is a read-only GHCR login — and
  even that is unnecessary while the image is public (ADR-0004); the wizard
  walk and the `.github/run-deploy-wizard.sh` scaffolding of the first
  draft were dropped accordingly.
- Deploys are eventually consistent with merges (≤ poll interval + build
  time), not synchronous. Merges that need to be live _now_ (feed-hotfix
  style) can run `systemctl start wortschatz-update` or `gh workflow run
Image`–rebuild and wait one tick.
- Rollback is unchanged in operator terms (re-pin to an old `sha-` tag +
  standard refresh), but now has a first line of defence: the updater itself
  rolls back a failed deployment within the tick; the pin is restored to the
  exact last-good line.
- The poller trusts labels it pulls: an image whose `revision` label cannot
  be read is treated as an error, and a fully falsified label would still be
  caught by the /healthz cross-check (which reads what runs, not what's in
  the manifest).
- A failed deploy loops quietly: every tick re-pins, re-up-lets and re-verifies
  the same digest until the registry carries a fixed/updated image. Bad
  pushes visible as repeating `journalctl -u wortschatz-update` entries.

## Suppressed alternatives

- **CI-SSH push (the #29 text-as-written)**: rejected by owner decision — an
  Actions-stored private deploy key that can reach the private network on
  every merge was judged a net-negative against the polling equivalent.
- **`watchtower`-style generic updater container**: rejected — labels-only
  awareness; no compose-line re-pin/marker semantics; the /healthz end-to-end
  check and pinned-sha rollback policy are particular to this flow.
- **Digest mode pinning (`@sha256:…`)**: rejected — rollback UX and
  greppability must keep `sha-<commit>` tags as the compose pin; the digest
  comparison lives in the poller state file purely as a change marker.
- **Health-only trigger (`curl` before/after without digest marker)**:
  rejected — would naively redeploy the same image on every tick; the digest
  compare is the change detector, /healthz is the correctness gate.
- **A Python/Node write tool in the updater stack**: rejected — the house
  updater must run anywhere docker exists (bash + coreutils + curl already
  on alpine/debian hosts); a second runtime adds an upgrade surface.
