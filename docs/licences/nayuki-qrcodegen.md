# Licence note: `nayuki/QR-Code-generator` (QR encoder)

The client's QR encoder is vendored from **`nayuki/QR-Code-generator`**, so the
app stays a zero-runtime-dependency SPA (no npm package is added for it).

- **Source:** <https://github.com/nayuki/QR-Code-generator>
- **File:** `typescript-javascript/qrcodegen.ts`
- **Pinned commit:** `8329a7108fc22be3e1eec0a9f9318978579e3621`
- **SHA-256 (upstream file):** `1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c`
- **Size:** 990 lines, 41,022 bytes, UTF-8, LF
- **Licence:** **MIT** — Copyright (c) Project Nayuki

MIT permits use, copying, modification and distribution provided the copyright
notice and permission notice travel with the copies. The full upstream licence
header is kept verbatim at the top of the vendored file,
[`packages/client/src/vendor/qrcodegen.ts`](../../packages/client/src/vendor/qrcodegen.ts),
which is the copy that ships.

## What was changed on vendoring

The encoder body is upstream, with no change to its logic. Only the module
wrapper and formatting differ:

- the leading `"use strict";` pragma was dropped (the file is an ES module);
- the top-level `namespace qrcodegen` and its two augmenting namespaces
  (`qrcodegen.QrCode`, `qrcodegen.QrSegment`) are declared `export`, so the
  library is consumable as an ES module;
- a `// @ts-nocheck` header excludes this third-party file from the repo's
  strict compiler options;
- the file is run through the repo's Prettier config (whitespace, quotes and
  line wrapping only).

No error-correction, masking or table was re-implemented. The app-facing wrapper
is [`packages/client/src/qr.ts`](../../packages/client/src/qr.ts).

## Updating

To bump the encoder: choose a new upstream commit, update the pinned commit and
SHA-256 here, re-vendor `qrcodegen.ts` keeping the upstream licence header, and
re-run the golden test in
[`packages/client/tests/qr.test.ts`](../../packages/client/tests/qr.test.ts).
The golden matrix is expected to change when the encoder changes; decode it
again before trusting the new values.

See [ADR-0008](../adr/0008-lobby-qr-invite.md) for the decision.
