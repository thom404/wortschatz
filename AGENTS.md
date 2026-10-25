# wortschatz

## Autonomous issue agent

Adding the `agent-run` label to a fully specified issue starts
`.github/workflows/issue-agent.yml`, which runs the headless OpenCode agent
`.opencode/agent/issue-implementer.md`. `ready-for-agent` is a marker only: it
records that the issue is specified and starts nothing. The workflow shows
`agent-running` while a run is in flight and clears it when the run ends. A run
whose issue still has open same-repo blockers (GitHub's native dependencies) is
skipped before the agent starts: it removes `agent-run`, comments the blocking
issues, and asks the reader to add `agent-run` again once they close. Otherwise
the agent edits the working tree only; the workflow commits, pushes
`feature/<n>-<slug>`, and opens a pull request that says `Closes #<n>`. The
agent never merges or closes anything, and a failed run comments the failure and
applies `ready-for-human`. See
[ADR-0006](docs/adr/0006-autonomous-issue-agent.md).
Secret setup is in [`docs/OPERATOR-STEPS.md`](docs/OPERATOR-STEPS.md) §8:
`OPENCODE_API_KEY` and a fine-grained `AGENT_GITHUB_TOKEN` (contents,
pull-request, and issue write).

## German UI copy

All user-facing strings are German and hardcoded inline. Write new copy in the
recorded voice and follow the preferred/avoided terms in
[`docs/ux-copy.md`](docs/ux-copy.md); the decision is
[ADR-0007](docs/adr/0007-german-ui-copy-voice.md).

## Visual regression tests

Vitest + happy-dom stays the fast behavior layer (`npm test`). A separate
Playwright layer renders the production client in Chromium and compares
full-page screenshots against committed baselines; it never runs as part of
`npm test`, the Docker build or the issue agent. See
[ADR-0020](docs/adr/0020-browser-visual-regression-seam.md).

- `npm run test:visual` — build and serve the production client, then run the
  66-row screenshot matrix, six ARIA snapshots and five flow tests.
- `npm run test:visual:update` — accept intended visual changes. Run this only
  for a deliberate UI change and review the changed PNGs in the pull request;
  never run it just to make a red job green.
- Baselines live in `e2e/__screenshots__/` (PNG) and `e2e/__aria__/` (YAML) and
  are committed. Update and verify them inside the pinned container so local
  and CI pixels match:

  ```sh
  docker run --rm --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$PWD":/work -w /work \
    mcr.microsoft.com/playwright:v1.64.1-noble \
    bash -lc 'npm ci && npm run test:visual:update'
  ```

  Use `npm run test:visual` in the same image to verify without updating. The
  image tag must match `@playwright/test` in `package.json`.

- The suite freezes the page clock, pins `de-DE` / `Europe/Berlin` and
  `reducedMotion`, disables animations, uses no masks, and fails on any network
  request outside the preview origin. A flaky screenshot is a fixture or app
  defect: fix it at the source rather than adding a retry or mask.
- The `visual` CI job is additive and required; workflow files are human-owned
  (ADR-0006 §5), so adding it is a human step.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `thom404/wortschatz`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Worktree sessions

`docs/agents/worktrees.md` has the create, dependency, check and cleanup recipe.
