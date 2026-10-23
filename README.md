# Wortschatz

![A running round on the desktop: a 4×4 board with digram tiles, the standings chip
and the round timer](e2e/__screenshots__/game-digram-standard-1280x800.png)

A real-time multiplayer word-hunt game in German, in the style of Microsoft
Wordament: every player gets the same generated 4×4 board at the same time, has
two minutes to drag out as many valid words as possible, and the host paces the
rounds with a shared reveal in between. All in-game text is German; rooms hold
up to 8 players, with no accounts and nothing to install beyond Node.

Play the live instance at <https://wortschatz.phanthom.cc> — a self-hosted
homelab deployment without an uptime promise. This repository holds the game
itself: the client, the authoritative server, the vendored word list and the
tests that keep them honest.

## How to play

- **Get into a room.** Create one from the home screen or join with a short room
  code, deep link or QR invite ([ADR-0008](docs/adr/0008-lobby-qr-invite.md)).
  Rooms hold at most 8 players; a room code is enough — no registration.
- **The host paces the game.** Each round is a fresh board and a 2-minute clock,
  owned by the server. Between rounds the host holds the intermission open for
  as long as they like ([ADR-0016](docs/adr/0016-host-paced-intermission.md)).
- **Build words by dragging.** Start anywhere, then step to adjacent tiles in 8
  directions and never reuse a tile within a word. At least 3 letters per word.
- **Sixteen tiles, one special.** Every board is 15 single letters plus exactly
  one special tile: a digram (`sch`), a prefix (`un-`), a suffix (`-ung`) or an
  either/or tile with two spellings (`e/ä`)
  ([ADR-0003](docs/adr/0003-board-generation-and-tile-inventory.md)).
- **Score is Scrabble arithmetic.** A word is worth the sum of the German
  Scrabble values of its letters, so the number in a tile's corner always agrees
  with the scoreboard ([ADR-0002](docs/adr/0002-game-screen-layout-and-skins.md)).
- **The list decides.** A word counts if the vendored German word list has it —
  `ä/ö/ü/ß` match as real characters, and a reviewed exclusion list keeps proper
  nouns and abbreviations out ([ADR-0001](docs/adr/0001-word-list-source-and-packaging.md)).
- **Every round ends in a reveal.** The intermission shows every word placeable
  on the board, linked to Wiktionary
  ([ADR-0017](docs/adr/0017-wiktionary-links-in-the-reveal.md)), plus the
  session standings. Rounds continue until the host closes the room.
- **Losing the page loses nothing.** A reconnect reclaims your seat and score
  without an account; a departed host is replaced mid-game.

## Running wortschatz locally

You need Node.js 22 or newer. The server is a single stateless process; the
dictionary index is built once on your machine and never committed.

```sh
npm install
npm run build && npm run build-dawg   # build client, server and dictionary
npm start                             # http://localhost:3000
```

Prefer Docker? The local compose harness builds and runs the same image the
deployment uses (the image build runs the typecheck and the full test suite as
quality gates):

```sh
docker compose -f compose.local.yaml up --build
```

## What lives where

| Path              | Contents                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/client` | The web client: TypeScript, no framework, Vite build.                                                      |
| `packages/server` | The authoritative game server: WebSocket protocol, rooms, board generation and the DAWG-backed dictionary. |
| `packages/shared` | Types and rules both sides rely on, such as the wire protocol.                                             |
| `e2e`             | The browser visual-regression layer and its committed screenshot baselines.                                |
| `words`           | The vendored German word list, pinned and checksum-verified.                                               |

## Development

```sh
npm test          # fast behavior tests: Vitest in happy-dom
npm run lint      # prettier --check
```

The visual suite `npm run test:visual` is separate: it renders the production
client in Chromium and compares full-page screenshots against committed
baselines. Update baselines only for a deliberate UI change, inside the pinned
Playwright container, and review the changed PNGs in the pull request —
[ADR-0020](docs/adr/0020-browser-visual-regression-seam.md) explains the seam.

## Self-hosting

The server is stateless (one `PORT`, no volumes) and the built image is published
to GHCR, pinned by commit SHA. A minimal compose file is included; the full
deployment walk — Traefik chain, TLS, the auto-deploy timer — lives in
[`docs/OPERATOR-STEPS.md`](docs/OPERATOR-STEPS.md), with the decision in
[ADR-0005](docs/adr/0005-auto-deploy-homelab.md).

## Documentation

| Read                                                        | When                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`GLOSSARY.md`](GLOSSARY.md)                                | Always, before asking what a term means: every term in code, docs and tickets is defined here.    |
| [`docs/adr/`](docs/adr/)                                    | When you want to know why the architecture is the way it is — one decision per ADR, all numbered. |
| [`docs/OPERATOR-STEPS.md`](docs/OPERATOR-STEPS.md)          | When deploying or operating the live instance.                                                    |
| [`docs/ux-copy.md`](docs/ux-copy.md)                        | When writing or editing in-game text: the voice and preferred German wording.                     |
| [`docs/word-list-curation.md`](docs/word-list-curation.md)  | When touching the word list or its exclusion list.                                                |
| [`AGENTS.md`](AGENTS.md) and [`docs/agents/`](docs/agents/) | The repository conventions for humans and agents: issue tracker, triage labels, docs layout.      |

## Contributing

Issues and pull requests are welcome. `main` is branch-protected and reviewed
([ADR-0004](docs/adr/0004-branch-protection-main.md)). There is also an
autonomous issue agent: a fully specified issue labelled `agent-run` starts a
headless agent that implements it on a `feature/<n>-<slug>` branch and opens a
pull request saying `Closes #<n>`; humans always review and merge, the agent
never does ([ADR-0006](docs/adr/0006-autonomous-issue-agent.md)).

## Licences

Two different licences apply, and they are easy to confuse at first glance:

- **The code** (client, server, shared, e2e) is released under the
  [MIT licence](LICENSE), © Thomas Abel.
- **The German word list** `words` is vendored from
  [`enz/german-wordlist`](https://github.com/enz/german-wordlist), pinned to an
  exact commit and licensed **CC0-1.0**: no conditions at all. The `COPYING`
  file at the repository root is the upstream's CC0 text, shipped alongside the
  vendored list as a matter of record and courtesy — it does not cover the
  code.
