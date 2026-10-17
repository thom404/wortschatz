# ADR-0004: Branch protection for `main`

- Status: Accepted
- Date: 2026-10-16
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

## Consequences

- The only path to `main` is a green pull request: `CI / checks` must pass,
  and the `Image` workflow continues to build & push the GHCR image after
  merge. Direct pushes to `main` are rejected with the rule list in the
  remote error.
- The owner cannot hotfix on `main`; emergency changes still go through a
  feature branch + PR (which the owner can merge immediately).
- The required check is bound to the check-run name `checks` by hand:
  renaming the job in `ci.yml` requires re-pointing the ruleset.
- Rename side-effects handled: git remote, `package.json`/lock root name,
  `compose.yaml` + `OPERATOR-STEPS.md` GHCR path (`ghcr.io/thom404/wortschatz`),
  issue links in the ADRs, issue-tracker pointers in `AGENTS.md`, and the npm
  workspace scope `@wordament/*` → `@wortschatz/*` (issue
  [#37](https://github.com/thom404/wortschatz/issues/37)). Not renamed,
  deliberately: the deployment domain `wordament.phanthom.cc`
  (operator-level change, issue
  [#38](https://github.com/thom404/wortschatz/issues/38)) — a tracked
  follow-up for this ticket's TM-hygiene goal.
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
