# Operator steps: exposing wordament.phanthom.cc

Reproducible steps to put the game live behind the homelab Traefik, per #25.
The compose file in this repo (`compose.yaml`) already carries the final
timetagger-pattern labels; `compose.local.yaml` stays the untouched localhost
harness.

## 1. File provider: the `chain-wordament` chain

Add to the Traefik file provider's `middlewares-chains.yml` (shared homelab
config, not part of this app's compose):

```yaml
http:
  chains:
    chain-wordament:
      middlewares:
        - middlewares-rate-limit
        - middlewares-https-redirectscheme
        - middlewares-secure-headers
        - middlewares-compress
```

Notes:

- `middlewares-rate-limit` is avg 100 / burst 50; if the shared homelab's
  existing declaration differs from that, update it for this chain.
- `tls=true` plus an explicit `traefik.http.routers.wordament-rtr.tls.certresolver=dns-cloudflare`
  — the entrypoint's default certresolver alone does not trigger ACME issuance
  for a new domain on Traefik 3.7 (the resolver only scans HostSNI rules); the
  explicit label is what made the `wordament.phanthom.cc` certificate issue.
- No chain-level CSP: the app serves its own minimal
  `Content-Security-Policy` on its static responses (#24).
- No `ddns-allowlist` anywhere in the chain — remote players (colleagues on
  other networks) must be able to join. #11 decided this.

## 2. Per-host TLS entrypoint line (Traefik start command)

Add the per-host TLS entry for the `https` entrypoint to the Traefik
container's start command, so HTTP/2 connection coalescing (421s) and
`sniStrict` never surprise you:

```text
--entrypoints.https.http.tls.domains[32].main=wordament.${DOMAIN}
```

The `domains[32]` index must be the next free slot in the operator's list.
This work is in the shared Traefik container — it cannot live in this app's
compose file. Mark in Traefik's start command where the line is placed and
bump the index following the existing operator convention.

## 3. Deploy the compose file

```sh
mkdir -p ~/Docker/production/wordament
cp compose.yaml ~/Docker/production/wordament/
cd ~/Docker/production/wordament
```

The compose file needs an `.env` in that directory (same convention as the
other homelab services) providing:

- `DOMAIN=phanthom.cc`

The compose file carries no `build:`: production never builds on the deploy
host. `compose.yaml` pins a pulled image reference to an exact
`sha-<full-sha>` tag from the CI publish flow (#27):

```yaml
image: ghcr.io/thom404/wortschatz:sha-<full-sha>
```

Then run the standard refresh:

```sh
docker compose pull
docker compose up -d
```

`docker compose pull` fetches the pinned `sha-<full-sha>` image straight from
GHCR — the same fully verified artifact CI built on a merge to main
(#27) — with no build step on the host. `:latest` stays reserved for casual
pulls and is never pinned in production.

That `pull` + `up -d` pair is the standard refresh used below.

Since #29, the _bump of the pin itself is automated_: every merge to `main`
publishes `sha-<full-merge-sha>` under `ghcr.io/thom404/wortschatz` (#27) and
the workflow re-pins the server-side `compose.yaml` to exactly that sha,
pulls, restarts and verifies the public `/healthz` answers with the same sha
(§7). Rollback is unchanged: change the one `image:` line back to a previous
sha tag (old sha tags stay pullable) and re-run the standard refresh — the
next auto-deploy then re-pins to the newest sha again.

The container is stateless (PORT env, no volume); no backup or homepage
labels apply.

## 4. Reload Traefik

```sh
docker restart traefik
```

(or the homelab's usual reload mechanism) so it re-reads the file provider
with the new chain and entrypoint line.

## 5. DNS

No change needed: the wildcard CNAME already covers `wordament.phanthom.cc`
and the apex A record is kept current by ddclient (#9, #11).

## 6. Verify the deep link live

Open `https://wordament.phanthom.cc/r/<code>` from a browser on an external
network. Expected: TLS padlock, no 421/no HTTP→HTTPS hiccup, and the client
lands in the join screen pre-filled with the room code. Repeat once from
the LAN to confirm the `middlewares-rate-limit`
does not throttle normal play.

## 7. Auto-deploy on merge to main (#29)

Every merge to `main` now: builds the image from that exact commit, pushes
`ghcr.io/thom404/wortschatz:sha-<full-merge-sha>` (+ `:latest`) to GHCR,
then SSHes into this server, re-pins the `image:` line in the server's
`compose.yaml` to that same sha, `docker compose pull` + `up -d`, and
verifies `https://wordament.phanthom.cc/healthz` answers HTTP 200 with
`{"ok":true,"sha":"<merge-sha>"}` (the sha is baked into the image as
`WORDAMENT_GIT_SHA`). When that final check fails, the workflow run is red —
the last-green sha keeps running (`up -d` replaced it only if the pull and
restart succeeded).

The server's role stays pull-and-restart only: no build step, no compose
write-back into the repo; the server's GHCR access is at most a read-only
login (since the repo went public in ADR-0004, pulls actually work
anonymously — login is optional but keeps the flow identical for private
binding changes later).

Retrigger a deploy without a new merge: run the `Image` workflow via
workflow_dispatch — it rebuilds `latest` at the current `main` sha and
redeploys that sha.

### Provisioning the deploy credentials (one-time, wizard)

The workflow needs four repo **secrets** — `SSH_HOST` (host or
`host:port`), `SSH_USER`, `SSH_PRIVATE_KEY` (ed25519, no passphrase), and
`SSH_KNOWN_HOSTS` (the `ssh-keyscan` output for that host) — plus an
optional **variable** `DEPLOY_DIR` (defaults to
`~/Docker/production/wordament`) and optional `SERVICE_URL` (defaults to
`https://wordament.phanthom.cc`). Provision and execute:

```sh
bash .github/run-deploy-wizard.sh
```

It walks through: key generation → appending the public key to the server's
`authorized_keys` → `docker login ghcr.io` server-side (read-only PAT) →
`ssh-keyscan` → `gh secret set`/`gh variable set` (never echoing values).
Nothing committed; the private key lives only as an Actions secret.
