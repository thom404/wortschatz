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

Then:

```sh
docker compose up -d
```

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
