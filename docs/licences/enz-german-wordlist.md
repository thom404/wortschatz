# Licence note: `enz/german-wordlist` (word list)

The game's German word list is vendored from **`enz/german-wordlist`**.

- **Source:** <https://github.com/enz/german-wordlist>
- **File:** `words`
- **Pinned commit:** `1071d87d9535b57b80ec076c699f2578a28ee9dc`
- **SHA-256 (`words`):** `20095928ca70974fb5d86e44f10181cee16e2831b0d4b1a4ddd12c261aebc5e9`
- **Size:** 8,644,058 bytes, 685,829 entries, UTF-8, LF, one word per line
- **Licence:** **CC0-1.0 Universal** (public-domain dedication)

CC0 imposes **no conditions**: no attribution, no ShareAlike, no source-offer. We still
ship the upstream `COPYING` file alongside the vendored list as a matter of record and
courtesy, and we verify the pinned SHA-256 during the Docker build so the licensed
artifact is the one we intended.

The upstream `blacklist` file is a maintenance aid for the list authors (words excluded
from future candidates); it is **not** applied at runtime and is not vendored.

## Updating

To bump the list: choose a new upstream commit, update the pinned SHA-256 here and in
the build assertion, re-vendor `words` + `COPYING`, and rebuild the DAWG. The upstream
list is a plain one-word-per-line file, so there is nothing else to regenerate.

See [ADR-0001](../adr/0001-word-list-source-and-packaging.md) for the full decision.
