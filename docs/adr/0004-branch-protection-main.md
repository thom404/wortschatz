# ADR-0004: Branch protection for `main`

- Status: Accepted
- Date: 2026-10-16
- Amended: 2026-11-17 (#315) — selective Dependabot auto-merge
- Ticket: [#28](https://github.com/thom404/wortschatz/issues/28)
  (protect main: PR-only, required checks, admins included)
- Depends on: [#26](https://github.com/thom404/wortschatz/issues/26)
  (CI workflow — the required check must exist first)

## Context

Merges landed on `main` via PRs by convention only (#30, #31, #33), but the
branch was unprotected: a direct push (force or not) bypassed review and CI.
The single committer is the repo owner, so owner enforcement is the point, not
an edge case. CI (#26) runs lint, typecheck and tests as job `checks` in
workflow `CI` (the check-run name is `checks`) on every PR and push to `main`.

The repo was private at the start of #28, which changes the plan landscape:
classic branch protection and repository rulesets are **free only for public
repositories** — on a private repo both are gated behind GitHub Pro/Team
(both API attempts returned 403 “Upgrade to GitHub Pro or make this repository
public”). Going public was a deliberate trade-off: the word list is CC0
(`docs/licences/`), the code is self-authored, and the deployment already
exposed the product publicly; the repo was made public and renamed from
`wordament-clone-german` to **`wortschatz`** (“vocabulary”, the German
“word treasure”) to shed the unburdened trademark load of the old name.

## Decision

`main` is protected by a **repository ruleset** ("Protect main", ruleset id
`25199874`, target `branch`, enforcement `active`, applied via the rules REST
API through `gh api`), scoped with a ref-include of `~DEFAULT_BRANCH`:

1. **Required status check `checks` (strict).** The CI job from #26 must be
   green before a PR can merge; strict requires the head branch to be tested
   against the latest base.
2. **Admins included.** `bypass_actors: []` — no bypass entry for the
   RepositoryAdmin role, so the owner's direct pushes are rejected like
   anyone else's (`current_user_can_bypass: never`).
3. **PR required, zero approvals.** The `pull_request` rule demands a pull
   request but `required_approving_review_count: 0` and no last-push
   approval: one committer means an approval would be a meaningless
   self-review.
4. **No force pushes (`non_fast_forward`), no deletions (`deletion`)** on
   `main`.

Rulesets were chosen over the classic protection endpoint both for API
compatibility and because a ruleset is inspectable at
`github.com/thom404/wortschatz/rules/25199874`.

## Amendment: selective Dependabot auto-merge (2026-11-17, #315)

The ruleset itself is unchanged: `main` still requires `checks` and `visual`
(strict), a pull request, and zero approvals, with admins included. What
changes is who may arm a merge. A GitHub Actions workflow
([`.github/workflows/dependabot-auto-merge.yml`](../../.github/workflows/dependabot-auto-merge.yml))
turns on **native auto-merge** for a Dependabot pull request that satisfies
every condition below. It never merges the pull request itself and is
deliberately not a required check.

Eligible only when all hold:

1. the author is `dependabot[bot]` and the head branch belongs to this
   repository;
2. the target is the default branch;
3. every update in the pull request is a patch or minor (the highest update type
   decides, so one major disqualifies a group);
4. the ecosystem is npm or GitHub Actions;
5. for npm, **every** dependency is `direct:development`; Actions have no
   development split and are in scope as CI-only dependencies;
6. no dependency is `@playwright/test`;
7. every commit on the branch is authored by `dependabot[bot]`.

Never auto-merged: npm production dependencies (`ws` today) and any group that
contains one, indirect npm dependencies, majors, Playwright, Docker (the image
is built only on `main`, so a pull request cannot exercise it), and security
updates that are majors. A human commit on a bot branch — a Playwright baseline
regeneration, a fix, a rebase — makes it ineligible; if it was already armed,
the workflow disarms it. A group merges as a unit, so one ineligible member
keeps the whole group on the human path.

Mechanism and posture:

- The workflow runs on `pull_request_target`, gated on the bot author and the
  repository, and never checks out pull-request code. It reads the branch and
  its commits through the API.
- `dependabot/fetch-metadata` is pinned to a commit SHA because it gains merge
  authority on the repository's behalf. Its own commit verification is
  disabled: the explicit whole-branch check above is stricter and keeps a
  non-eligible pull request green instead of failing the metadata step.
- Arming uses the workflow `GITHUB_TOKEN` (`contents: write`,
  `pull-requests: write`) and `gh pr merge --auto --squash`. There is no PAT and
  no new secret. The repository setting **Allow auto-merge** must stay enabled.
- If it cannot arm, the job fails red in the Actions tab and the pull request
  waits. Non-eligible pull requests end green and unarmed, with no comment or
  label.
- A human holds a pull request by disabling auto-merge on it.
- The `require_extra_approval_for_unattributed_changes` rule is expected not to
  block Dependabot's attributed commits; the first eligible pull request proves
  it. If it does block, the ruleset is adjusted rather than the workflow.

Attribution: a merge completed from auto-merge enabled with `GITHUB_TOKEN` is
attributed to `github-actions[bot]`, so GitHub suppresses the `push`-triggered
`Image` workflow. A dev-only dependency merge therefore leaves the production
image — and the poller's deploy — at the previous commit, which is the intended
outcome for a change that is pruned from the image. The next human-merged change
rebuilds and deploys. The post-merge `CI` run on `main` is skipped for the same
reason; the pull request already exercised the same tree through the required
checks.

## Consequences

- The only path to `main` is a green pull request: `CI / checks` and `visual`
  must pass, and the `Image` workflow continues to build & push the GHCR image
  after a human merge. A selective Dependabot auto-merge (amendment above) is
  the one merge a human does not press; the required checks still gate it.
  Direct pushes to `main` are rejected with the rule list in the remote error.
- The owner cannot hotfix on `main`; emergency changes still go through a
  feature branch + PR (which the owner can merge immediately).
- The required check is bound to the check-run name `checks` by hand:
  renaming the job in `ci.yml` requires re-pointing the ruleset.
- Rename side-effects handled: git remote, `package.json`/lock root name,
  `compose.yaml` + `OPERATOR-STEPS.md` GHCR path (`ghcr.io/thom404/wortschatz`),
  issue links in the ADRs, issue-tracker pointers in `AGENTS.md`. Not renamed
  at the time, deliberately: the npm workspace scope `@wordament/*` (touching
  every import, issue [#37](https://github.com/thom404/wortschatz/issues/37))
  and the
  deployment domain (operator-level change, issue
  [#38](https://github.com/thom404/wortschatz/issues/38)) — both tracked
  follow-ups for this ticket's TM-hygiene goal. Follow-up
  [#37](https://github.com/thom404/wortschatz/issues/37) has since renamed the
  workspace scope, container user/group and deployment-internal env vars to
  `wortschatz`; follow-up #44 has since renamed the repo-side deployment
  domain references to `wortschatz.phanthom.cc`, while the operator cutover
  (DNS, shared Traefik config, cert issuance, redirect) remains in #38.
- **Reproducing the ruleset from this repo alone** (⚠ the ruleset lives on
  GitHub's side and is not version-controlled; this command recreates it —
  check-run name `checks` matches the job in `.github/workflows/ci.yml`):

  ```sh
  gh api -X POST repos/thom404/wortschatz/rulesets --input - <<'JSON'
  {
    "name": "Protect main", "target": "branch", "enforcement": "active",
    "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
    "bypass_actors": [],
    "rules": [
      { "type": "deletion" }, { "type": "non_fast_forward" },
      { "type": "required_status_checks", "parameters": {
          "required_status_checks": [{ "context": "checks" }],
          "strict_required_status_checks_policy": true } },
      { "type": "pull_request", "parameters": {
          "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false,
          "require_last_push_approval": false, "required_approving_review_count": 0,
          "require_extra_approval_for_unattributed_changes": true,
          "required_review_thread_resolution": false,
          "allowed_merge_methods": ["merge", "squash", "rebase"],
          "dismissal_restriction": { "enabled": false } } }
    ]
  }
  JSON
  ```

- The ruleset is the source of truth; this ADR documents it.

## Suppressed alternatives

- **Classic branch-protection endpoint on a private repo**: rejected — the
  API returns 403 without a paid plan, which is what surfaced the public/
  private fork in the plan.
- **Pay for GitHub Pro to stay private**: rejected for #28 — the protection
  benefit is minor next to the subscription cost, and the public-repo route
  was acceptable for TM reasons explained above.
- **Staying private without protection**: rejected — it is what the ticket
  was filed to fix.
- **No required approvals** (as configured): rejected requiring ≥1 approval —
  it would demand a second human reviewer the repo does not have.
- **Bypass list for the owner**: rejected — owner enforcement is the intent
  of #28; a bypass actor would revert it.
- **Requiring the `Image` workflow as a check too**: rejected — that workflow
  only runs on `main` itself (post-merge), not on PR head branches, so it can
  never be a merge gate.
- **Keeping the name `wordament-clone-german` while going public**: rejected —
  public exposure plus a live deployment at a `wordament.*` domain is exactly
  where a Microsoft trademark starts to matter; “wortschatz” keeps the
  meaning without leaning on the Wordament name.
