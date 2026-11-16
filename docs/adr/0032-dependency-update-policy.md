# ADR-0032: Dependency update policy

- Status: Accepted
- Date: 2026-11-16
- Ticket: [#297](https://github.com/thom404/wortschatz/issues/297)
  (spec: dependency updater — Dependabot with weekly grouped pull requests)
- Related: [ADR-0004](0004-branch-protection-main.md) (the pull-request-only
  path to `main`), [ADR-0006](0006-autonomous-issue-agent.md) (the human-owned
  workflow boundary), [ADR-0020](0020-browser-visual-regression-seam.md) (the
  Playwright container and the **Screenshot baselines**)
- Configuration: [`.github/dependabot.yml`](../../.github/dependabot.yml)
- Operator doc: [`docs/OPERATOR-STEPS.md`](../OPERATOR-STEPS.md) §10

## Context

Every package, workflow action and container tag moved only when a maintainer
remembered to look. The drift was already visible: `typescript` was four majors
behind, `vitest` three, `vite` three and `@playwright/test` one minor. Nothing
surfaced a security advisory until an accident did.

The exact `@playwright/test` pin makes ordinary neglect worse. It is mirrored
by hand in the manifest, the CI container image and the AGENTS.md recipe, and
nothing checked that the three agreed. A bump that touched one of them could
run a browser from a different release than the **Screenshot baselines** were
written against.

The repository is also not a good fit for the obvious default. The `visual`
job gates 116 screenshot baselines, and the **Issue agent** writes pull requests
of its own. Auto-merging every green bot pull request would put an unreviewed
pixel change on `main`.

## Decision

Use **Dependabot version updates**, configured in the repository at
`.github/dependabot.yml` — the only path Dependabot reads.

1. **Three update entries.** npm at the repository root (one entry is enough
   for every workspace manifest and the single root lockfile; per-workspace
   entries would contend over that lockfile), GitHub Actions at the repository
   root, and Docker at the repository root for the base image. All three run
   weekly, on Monday at 06:00 `Europe/Berlin`.
2. **Grouping.** Each ecosystem has one group for minor and patch updates.
   Major updates are deliberately not in a group, so they arrive alone and get
   their own review. The npm group excludes `@playwright/test`, so a browser
   bump is always a solo pull request.
3. **Cooldown.** npm waits seven days by default and fourteen for majors;
   GitHub Actions waits three days; Docker waits seven days. Security-update
   pull requests are exempt from the schedule and the cooldown by GitHub's own
   design, so a CVE is not queued behind housekeeping.
4. **Pull-request shape.** Label `dependencies`, assignee `thom404`, and open
   pull-request limits of 5 (npm), 3 (Actions) and 2 (Docker). Dependabot's
   default prose title (`Bump <package> from <old> to <new>`) and its default
   `versioning-strategy: increase` are kept, so `git log` reads like the rest
   of the history. There is no `target-branch`; the bot's default branch names
   are kept.
5. **Actions stay on floating major tags** (`@v7`). Nothing needs bumping until
   a new major exists, which is exactly the event worth reviewing. SHA pinning
   is out: it is a Renovate-shaped workflow and a repository-wide pin change.
6. **Node majors are manual.** Docker `node` semver-majors are ignored. The
   entry still maintains patch tags and digests.
7. **One automated guard.** A Vitest test in `packages/shared/tests/` reads the
   exact `@playwright/test` pin, the container image in the CI workflow and the
   recipe in AGENTS.md, extracts the version from each and asserts they are
   equal. It extends no Vitest include and adds no CI job; it rides the
   existing `npm test`. If any source stops naming a version, it fails rather
   than passing silently.
8. **Human-only setup.** Enabling Dependabot alerts and automated security
   fixes, and creating the `dependencies` label if it does not exist, are
   settings operations outside the **Issue agent**'s token (contents,
   pull-requests and issues only). They are written into OPERATOR-STEPS.
9. **No workflow changes and no auto-merge in this ticket.** Workflow files
   remain human-owned (ADR-0006 §5). The merge boundary stays where it is
   today: every bot pull request is reviewed and merged by a human.

## Why not Renovate

Renovate needs a third-party app installation and a second owned workflow,
while Dependabot is a first-party service configured by one repository file.
Renovate's real advantages here — SHA pinning and regex managers — are
explicitly deferred rather than needed. The smaller surface also keeps the
change inside the human-owned workflow boundary: no workflow file is edited.

## Grouping and cadence

| Ecosystem      | Group                     | Majors         | Cooldown    | Open PRs |
| -------------- | ------------------------- | -------------- | ----------- | -------- |
| npm            | `npm-minor-and-patch`     | solo           | 7 / 14 days | 5        |
| GitHub Actions | `actions-minor-and-patch` | solo           | 3 days      | 3        |
| Docker         | `docker-minor-and-patch`  | `node` ignored | 7 days      | 2        |

A normal week costs one review per ecosystem. Majors stay separate so one can
be closed or postponed without disturbing the routine group. The cooldown is
what makes a fixed weekly window meaningful: without it the bot mostly reports
whatever shipped in the last hour, including a compromised or broken same-day
publish.

## Playwright lockstep

A browser bump is always solo and follows this ordered checklist:

1. Bump the exact `@playwright/test` pin and install it.
2. Update the `visual` job's CI container image to the matching
   `mcr.microsoft.com/playwright:v<version>-noble` tag.
3. Update the recipe in AGENTS.md and the version mentions in ADR-0020.
4. Regenerate the **Screenshot baselines** with `npm run test:visual:update`
   **inside the new pinned image**, so local and CI pixels come from the same
   browser.
5. Review every changed PNG and merge only with both the `checks` and `visual`
   jobs green.

The coherence test fails the bot's Playwright pull request until steps 1–3
agree, so the pull request itself is the reminder.

## Node majors are manual

The Docker entry ignores `node` semver-majors. A Node jump touches the engine
range in the root manifest, the CI Node version, both Dockerfile stages and a
local image build; it needs a deliberate branch rather than a bot proposal.
The entry still maintains patch tags and digests.

## Deliberately deferred

- **Branch-protection changes and selective auto-merge.** This ticket leaves
  the existing merge boundary (ADR-0004) untouched and enables no auto-merge.
  A follow-up issue owns the required-check set and the merge boundary, because
  it governs the **Issue agent**'s pull requests as much as the bot's; until
  then every bot pull request is a human review.
- **Renovate, SHA-pinned actions and any third-party updater app.**
- **An `npm audit` gate in CI.**
- **Tightening `engines.node`.** Vitest 5 will demand a narrower range when its
  major pull request lands; that is that pull request's problem.
- **Dockerfile `npm install` versus `npm ci`, digest pinning of the base image,
  and a pull-request-time Docker build.** The image workflow builds on `main`
  only, and that stays.
- **Refreshing the vendored skills.** `skills-lock.json` keeps one owner:
  `npx skills update`.
- **Performing the pending dependency bumps themselves.** The bot pull requests
  do that.

## Consequences

- Stale packages, actions and container tags surface weekly without a manual
  sweep, and advisories surface outside the cadence.
- Routine weeks cost one grouped review per ecosystem; majors and every
  Playwright bump stay isolated.
- A browser bump cannot go green while the manifest, CI image and AGENTS.md
  recipe disagree.
- `main` still only moves through a reviewed pull request; no automation gains
  merge rights.
