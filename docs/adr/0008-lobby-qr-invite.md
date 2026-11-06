# ADR-0008: Lobby invite QR code, client-rendered from a vendored encoder

- Status: Accepted
- Date: 2026-10-17
- Ticket: [#48](https://github.com/thom404/wortschatz/issues/48) (serve the room
  URL as a QR code for mobile-friendly access)

## Context

The lobby already showed the joinable deep link `location.origin + "/r/<CODE>"`
as plain text, but a phone user had to type it. Scanning a QR code with the
camera is the natural mobile entry point.

Constraints shaping the decision:

- The client is a zero-runtime-dependency SPA — only `@wortschatz/shared`,
  bundled by Vite. Adding a QR npm package would break that property for one
  screen.
- The app has a user-facing **skin** system (ADR-0002): every visual value is a
  CSS custom-property token, and no component hard-codes a colour. A QR code,
  however, only scans reliably with sufficient contrast; a themed dark-on-light
  or low-contrast arcade palette would risk an unscannable code.
- Writing QR error correction from scratch is out of scope and a known source
  of subtle bugs.

## Decision

1. **The QR is client-rendered, in the lobby only.** No server endpoint, route
   or additional HTTP request; the lobby markup gains an `Einladen` card with
   the code and keeps the existing plain-text link as the no-camera fallback.
2. **The encoder is vendored, not depended on.** A proven, permissively
   licensed library (Nayuki's `QR-Code-generator`, MIT) is vendored under
   `packages/client/src/vendor/qrcodegen.ts` and exposed through one app-facing
   module, `packages/client/src/qr.ts`, that maps a string in byte mode to a
   boolean module matrix (and the SVG derived from it). The app's runtime
   dependency set is unchanged. The licence and attribution are recorded in
   [`docs/licences/nayuki-qrcodegen.md`](../licences/nayuki-qrcodegen.md).
3. **One source of truth for the payload.** The QR and the text link render the
   same absolute deep link, `location.origin + "/r/" + <CODE>` with the code
   uppercased, computed once per render, so the two can never disagree.
4. **The QR core is exempt from the skin tokens.** Its colours are literals —
   dark modules on a light card with the standard 4-module quiet zone — and the
   SVG references no `var(...)`. The surrounding panel and label may still use
   tokens. This is the one deliberate, documented exception to ADR-0002's
   token-only rule, justified by scannability.
5. **The decision is locked by tests.** A DOM-free golden test pins the encoder's
   module matrix for a fixed URL; a mount test asserts the lobby renders the QR
   element and that its encoded payload equals the text deep link beside it.

## Consequences

- A phone can join a room by camera, while a desktop or camera-less client
  still joins from the text link.
- The component vocabulary and skin uniformity (ADR-0002) hold everywhere except
  the QR core, which is deliberately fixed-contrast and identical under every
  skin.
- The vendored encoder is a maintenance surface: bumping it means updating the
  pin and SHA-256 in the licence note and regenerating the golden matrix.
- The dependency-free client property is preserved.

## Suppressed alternatives

- **Add a QR npm package.** Rejected: it would end the zero-runtime-dependency
  client for a single screen, when a permissively licensed encoder can be
  vendored and attributed.
- **A server-side QR endpoint or route.** Rejected: the payload is already
  client-known (`location.origin`), so a round trip and a new route buy nothing.
- **Theme the QR with skin tokens.** Rejected: a themed QR can lose contrast
  and stop scanning; scannability is a correctness requirement, not a style.
- **Write the encoder (including Reed–Solomon ECC) from scratch.** Rejected:
  needless risk for a solved, standardised problem.

## Amendment (#245, 2026-11-06): plain-text invite link with a copy control

The invite text used to render inside `<code>`. A browser copying that gives a
rich HTML clipboard flavour alongside the plain text — monospace inline styling
and a `<wbr>` — so pasting into a markup-aware input could turn the link into
code or split it. There was also no one-press copy path.

6. **Styled plain text, not code and not an anchor.** The invite link renders as
   body-font text in `--accent`, with no underline. It has no `<code>` and no
   `<wbr>`; `overflow-wrap: anywhere` wraps it on a narrow phone. The
   `#join-link` id and its exact `textContent` remain the one value shared with
   the QR payload.
7. **A copy control writes the same value as plain text.** An icon-only
   secondary control (ADR-0022) beside the link calls
   `navigator.clipboard.writeText(deepLink)` directly, so only a `text/plain`
   flavour is written. Its German name and tooltip are `Link kopieren`; after a
   successful write it shows a check and `Link kopiert.` for two seconds, and a
   visually hidden polite `role="status"` announces the same phrase.
8. **A fallback keeps the link copyable.** When the Clipboard API is missing,
   denied or rejects, the client selects the visible text and tries
   `document.execCommand("copy")`. If both paths fail, the floating error slot
   says `Der Link konnte nicht kopiert werden. Markiere ihn und kopiere ihn von Hand.`
   The visible text stays selectable throughout.
