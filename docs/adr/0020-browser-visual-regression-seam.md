# ADR-0020: Browser/visual regression seam for the whole UI

- Status: Accepted
- Date: 2026-10-21
- Ticket: [#156](https://github.com/thom404/wortschatz/issues/156)
  (browser/visual regression test seam for the whole UI)
- Related: [ADR-0002](0002-game-screen-layout-and-skins.md) (responsive layout
  and skins), [ADR-0006](0006-autonomous-issue-agent.md) (agent gates and the
  workflow-file exclusion), [ADR-0009](0009-play-time-deltas-in-place.md) and
  [ADR-0013](0013-live-regions-beside-templates.md) (live regions)
- Supersedes the manual visual check described in
  [#154](https://github.com/thom404/wortschatz/issues/154) once that fix lands

## Context

Vitest plus happy-dom is the fast behavior layer: it mounts the real app,
drives the connection boundary and asserts DOM contracts, live-region updates
and wire frames. It has no layout engine, so it cannot see CSS overflow,
wrapping, spacing, fonts, skin tokens or the responsive arrangement. Every
visual regression was found by a human after deploy.

#154 is the triggering example: an intermission standings chip overflows the
**Punkte** panel at narrow widths. No automated test could catch it, and there
was no repeatable, reviewable way to prove that every screen renders correctly
at phone and desktop widths in both skins.

## Decision

1. **Tool and layering.** Playwright Test is a root dev dependency with a
   dedicated root-level `e2e/` project. The Vitest suite remains the fast layer
   and is not replaced; `npm test` never downloads a browser.
2. **Production build.** The Playwright `webServer` builds the workspace, then
   serves the production client with `vite preview` on
   `127.0.0.1:4173`, `--strictPort`. Screenshots therefore exercise the bundle
   that ships, not the dev server.
3. **State injection.** The suite intercepts the app's existing WebSocket
   boundary with `page.routeWebSocket("**/ws")` and replays wire fixtures. No
   test-only hook, route or global exists in production code, and no real
   server process runs.
4. **Shared fixtures.** The DOM-free message builders live in
   `packages/client/tests/fixtures.ts`; the happy-dom harness re-exports them,
   so existing imports keep working and Vitest and Playwright script one set of
   wire shapes.
5. **Browser matrix.** Chromium only, `deviceScaleFactor: 1`. Cross-browser
   pixel baselines are out of scope.
6. **Viewports and skins.** Three viewports — 360×640, 390×844 and 1280×800 —
   and both Standard and Arcade for every scenario. Skin state uses the app's
   stored choice, never a test path.
7. **Curated matrix.** Sixty-six full-page screenshots: 36 canonical (6 screens
   × 2 skins × 3 viewports), 10 outcome (5 states × 2 skins × 390), and 20
   targeted (10 states × 2 skins × 360). The targeted rows include the #154
   long-name standings chip, low timer, error notice, spectator, both flat
   reveal sortings, a full lobby, a local home error, a deep-link invitation
   and a lobby guest.
8. **Determinism.** The page clock is frozen before navigation and deadlines
   derive from it; the low-timer row uses fixed time + 15 s. Screenshots run
   with `animations: "disabled"`, `caret: "hide"`, `locale: "de-DE"`,
   `timezoneId: "Europe/Berlin"` and `reducedMotion: "reduce"`. Fixtures are
   fixed, the QR code derives from the fixture room code, and there are no
   masks. A network guard fails a test on any request outside the preview
   origin.
9. **Comparison.** `threshold: 0.2`, `maxDiffPixels: 0`, `retries: 0`, and
   `forbidOnly` in CI. Flakiness is fixed at the source, never retried away.
10. **Baselines.** PNGs are committed under `e2e/__screenshots__/`; ARIA
    snapshots under `e2e/__aria__/`. Baselines are updated only with
    `npm run test:visual:update` inside the pinned Playwright container
    (`mcr.microsoft.com/playwright:v1.64.1-noble`, matching the package
    version), so local and CI pixels come from the same image. `npm run
test:visual` runs the suite.
11. **CI.** A separate `visual` job runs on pull requests after `npm ci`, in
    the same pinned container, uploads actual/expected/diff images on failure,
    and is a required PR check. It is additive: the existing `checks` job and
    `npm test` are unchanged, so the Docker build and the issue agent stay
    browser-free. Workflow files are human-owned (ADR-0006 §5), so the job
    itself is applied by a human.
12. **Semantics and flows.** Six ARIA snapshots (one per canonical screen, not
    per skin or viewport) cover roles, names and reading order. Five flow tests
    assert wire frames without screenshots: create room → lobby, deep-link
    join, skin switch survives reload, drag → `submit-word`, and intermission →
    `start-round`.
13. **#154 ordering.** The targeted overflow scenario is written now. While
    #154 is open it is `test.fixme` with a reference to the issue, so CI never
    baselines the broken layout. The fix removes the marker and commits the
    passing baseline.

## Rejected alternatives

- **Replacing the happy-dom suite with browser tests.** Rejected — it would
  make fast feedback slow and force the Docker build and issue agent to
  download browsers.
- **A third-party visual review service.** Rejected — baselines committed in
  the repository are reviewable in the pull request and need no external
  dependency.
- **Token or pixel-ratio tolerance and retries.** Rejected — a flaky screenshot
  is a defect in the fixture or the app, not something a retry should hide.
- **Masks for dynamic regions.** Rejected — a mask hides exactly the
  regressions the seam exists to catch. A frozen clock and fixed fixtures make
  masking unnecessary.
- **WebKit/Firefox pixel baselines.** Deferred — behavior smoke across engines
  is a later concern; the layout seam is Chromium-first.
- **Test-only boot hooks or a fake server in the app.** Rejected — the existing
  WebSocket boundary is the highest seam and keeps the production bundle
  clean.

## Consequences

- CSS and layout regressions in every screen, skin and curated state become
  visible in the pull request before deploy.
- A visual change now includes reviewing and committing PNG diffs, deliberately,
  through the container-pinned update command.
- The repository grows by the baseline images; the suite's runtime and the CI
  minutes grow separately from `npm test`.
- A fix for #154 enables its two targeted rows and commits their baselines.
- Extending the matrix is a later ticket; the curated 66 rows are intentionally
  not a full cross-product.
