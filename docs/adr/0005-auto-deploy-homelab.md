# ADR-0005: Auto-deploy pull-and-restart on merge to main

- Status: Accepted
- Date: 2026-10-16
- Ticket: [#29](https://github.com/thom404/wortschatz/issues/29)
  (auto-deploy to homelab on merge to main)
- Depends on: [#27](https://github.com/thom404/wortschatz/issues/27)
  (merge-built image lands in GHCR), [ADR-0004](0004-branch-protection-main.md)
  (main is PR-only; every deployable commit arrives via merge)
- Operator doc: [`docs/OPERATOR-STEPS.md`](../OPERATOR-STEPS.md)
  (§3 compose staging, §7 provisioning wizard)

## Context

Until #29, deploys were manual: the operator edited the server-side compose
pin to a fresh `sha-<full-sha>`, copied the file up, refreshed (per #32/#33).
Every merge to `main` already publishes
`ghcr.io/thom404/wortschatz:sha-<full-merge-sha>` plus `:latest`
(#27/ADR-0002-era `Image` workflow), so the artifact for the exact merge
commit always exists before anything could deploy it. The server is a
stateless consumer (`compose.yaml`: `PORT=3000`, no volume, Traefik labels,
`reverse-proxy` external network); under #25 it does not build; the deploy
host never holds registry credentials beyond — today, actually zero — since
ADR-0004 made the image public and anonymous GHCR pulls work.

Missing piece: bridging the green merge to the running container without a
human edit + `docker compose pull`.

## Decision

1. **Same workflow, two jobs.** The `Image` workflow (`.github/workflows/image.yml`)
   gains a `deploy` job (`needs: build-and-push`), so deploy only ever runs
   for an image that was just built and pushed by the immediately preceding
   job of the same run. There is no second workflow-boundary to drift; a red
   build can never deploy.
2. **Re-pin inside the server.** The deploy job SSHes in (BatchMode, key from
   the `SSH_PRIVATE_KEY` secret, GitHub `SSH_KNOWN_HOSTS` as `known_hosts`,
   host/user via `SSH_HOST`/`SSH_USER` secrets) and `sed`s the one `image:`
   line in the server's `~/Docker/production/wordament/compose.yaml` to
   `ghcr.io/thom404/wortschatz:sha-<merge-sha>` — accepting every old
   `sha-`-pinned spelling — then `docker compose pull` and `up -d`.
   Pre-composed state (`.env`, labels, networks) stays untouched; the repo
   never writes production state.
3. **Verification is the acceptance gate #29 asks for:** from the runner,
   `GET $SERVICE_URL/healthz` must return HTTP 200 with JSON
   `{"ok":true,"sha":"<merge-sha>"}` — the sha is baked into the image at its
   build (`ARG GIT_SHA` → `ENV WORDAMENT_GIT_SHA`, test through the
   `/healthz` seam in `packages/server/tests/static.test.ts`). Retried on a
   ~60 s budget across container restart; a mismatch fails the job red, so
   the criterion"running container == image built by this commit" is checked
   on every deploy.
4. **Secrets are repo-scoped only.** `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`,
   `SSH_HOST`, `SSH_USER` live exclusively as Actions secrets — provisioned
   by `.github/run-deploy-wizard.sh` (wizard walk; values never into `.env`
   or git). A missing secret fails the deploy step with an error naming the
   wizard procedure; pushes to `main` after the secrets land deploy
   automatically — no further human step.
5. **Serialization.** `concurrency: production-image, cancel-in-progress:
false` inside the `Image` workflow — fast-follow merges cannot run two
   SSH loops onto one server; the newest merge queues last and lands newest.

## Consequences

- The operator flows never change: the deep `compose.yaml` server-side is
  still the only truth for the running container, and rollback remains
  "re-pin to an old `sha-` tag + standard refresh" (auto-deploy accepts old
  spelling and re-pins forward at the next merge).
- A red deploy leaves the last-known-good container running: `up -d` runs
  only after `pull` returns zero, so partial pulls never reach a restart.
- SSH deployment ties the CI runner to the homelab's addressability: the
  server must stay reachable from GitHub's runner (public DNS or forwarded
  port). If the homelab ever blocks inbound SSH, the deploy job needs a
  pull-based fallback (e.g. self-hosted runner) — untouched here.
- `/healthz` is now versioned: any monitoring can identify the exact build
  servicing a request. The old "ok" text response is gone (documented in
  tests; content-type JSON).
- `workflow_dispatch` on `Image` is a manual redeploy knob: it rebuilds
  `latest` at the current `main` sha and re-runs the pull-and-restart pinned
  to that sha.

## Suppressed alternatives

- **`workflow_run`-triggered deploy workflow**: rejected — a second workflow
  for the deploy requires a `build-and-push` conclusion filter, adds a
  secret / token context transition and a second repo-bind failure point;
  `needs:` within one workflow expresses the ordering directly.
- **Push the repo's `compose.yaml` up on deploy**: rejected — copying over
  would let CI overwrite server-state labels/Traefik wiring mid-deploy; the
  one-line pin re-write is the smallest delta that updates exactly what
  changed (the image).
- **Digest pulls (`@sha256:…`)**: rejected for now — the repo's
  established convention is stellar `sha-<commit>` tags (rollback UX, log
  greppability); digest pinning adds mutation layer mapping for no operator
  benefit — the tag is produced by CI for exactly that commit.
- **Deploy tooling over SSH (Ansible, deploy scripts) on the runner**:
  rejected — a single `ssh … bash -s --` heredoc keeps the dependency surface
  at `openssh-client` (already on ubuntu-latest) instead of inventing a
  serialisation another tool must maintain.
- **`cancel-in-progress: true`** for fast merges: rejected — a cancelled
  run mid-`docker push` could publish a half-landed layer set; queueing
  preserves every completed build.
- **A `deploy` secret "server client" `SERVICE_URL`, git sha from compose
  `.env`**: rejected — the sha must live in the artifact, not in the
  deployment envelope, so any environment reports the same value from the
  same image; `ARG GIT_SHA` puts identity inside the image itself.
