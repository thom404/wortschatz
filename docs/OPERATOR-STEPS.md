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

Since #29 (ADR-0005), the _bump of the pin itself is automated_ by the
pull-based updater (§7): every merge to `main` publishes
`sha-<full-merge-sha>` under `ghcr.io/thom404/wortschatz` (#27) and the
poller re-pins this server-side `compose.yaml` to exactly that sha, pulls,
restarts and verifies the public `/healthz` answers with the same sha. This
repo's `compose.yaml` stays the deployment mold; the pin state on the server
moves with it. Manual pre-emptive pin bumps still work (per the §3 flow) and
the next poller tick re-pins over them.

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

## 7. Auto-deploy: pull-based poller on the server (#29, ADR-0005)

Deploys are now self-driven by the server. CI (the `Image` workflow) builds
the image from each merge to `main` and pushes it to GHCR — it never contacts
this box (no SSH key, no reachability, no Actions secrets for deploy; the
repo went public in ADR-0004 so pulls work anonymously). A small poller runs
on the host:

- every 15 minutes (`Persistent=true` so it catches up after offline spells):
  `docker manifest inspect ghcr.io/thom404/wortschatz:latest` (cheap, no
  layer transfer) is compared against the digest marker in
  `~/.local/state/wortschatz/latest-digest`;
- on a fresh digest: pull `latest`, read the image's own
  `org.opencontainers.image.revision` label (set by CI to the exact merge
  commit), re-pin this server's `compose.yaml` `image:` line to
  `sha-<merge-sha>`, then the standard refresh (`docker compose pull` +
  `up -d`);
- verify `https://wordament.phanthom.cc/healthz` answers 200 with
  `{"ok":true,"sha":"<merge-sha>"}` — the same sha as the deploy;
- on pull/restart/verify failure: restore the previous pin, roll the
  container back, and leave the systemd unit failed for you to see — the
  last-good container keeps running.

### One-time install (root, on the server)

```sh
# from a checkout of this repo (or curl from raw.githubusercontent):
cp deploy/wortschatz-update.sh /usr/local/bin/wortschatz-update
chmod +x /usr/local/bin/wortschatz-update
cp deploy/wortschatz-update.service deploy/wortschatz-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wortschatz-update.timer
systemctl list-timers wortschatz-update.timer
```

The first tick deploys whatever `latest` is in GHCR (the digest marker starts
empty and falls through "digest changed"). Defaults live in the script:
`COMPOSE_DIR=~/Docker/production/wordament`,
`SERVICE_URL=https://wordament.phanthom.cc`,
`VERIFY_TIMEOUT=60`; override any of them via a drop-in
(`systemctl edit wortschatz-update` → `[Service] Environment=…`) without
touching the script.

### Operating an existing install

- Trigger out-of-band: `systemctl start wortschatz-update.service`
  (redeploy whatever `latest` carries right now). CI-side trigger: `gh
workflow run Image --repo thom404/wortschatz` — it rebuilds `latest` at the
  current `main` sha and the next tick deploys it.
- Watch: `journalctl -u wortschatz-update -f` (deploy history: every pin
  change, every verify, every rollback is logged).
- Health identity: `curl -fsS https://wordament.phanthom.cc/healthz` reports
  the exact build live behind the URL; the updater only records success when
  that answer matches the image it just pinned.
- Manual rollback (§3): re-pin the `image:` line to any previous
  `sha-<full-sha>` and run the standard refresh — but note the next
  successful poller tick re-pins forward to the newest digest again; to keep
  an older version in place, stop the timer until you're ready.
