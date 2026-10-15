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

Then:

```sh
docker compose pull
docker compose up -d
```

`docker compose pull` fetches the pinned `sha-<full-sha>` image straight from
GHCR — the same fully verified artifact CI built on a merge to main
(#27) — with no build step on the host. `:latest` stays reserved for casual
pulls and is never pinned in production.

That `pull` + `up -d` pair is the standard refresh used below.

New release: bump the pin by replacing the `sha-<full-sha>` tag in
`compose.yaml` with the sha of the merge commit you want, copy the file up
again, and re-run the standard refresh (GHCR keeps old `sha-` tags, so the
previous sha remains pullable).

Rollback: change the one `image:` line back to a previous sha tag and run
the standard refresh again.

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
