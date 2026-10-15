# ADR-0004: Branch protection for `main`

- Status: Accepted
- Date: 2026-10-15
- Ticket: [#28](https://github.com/thom404/wordament-clone-german/issues/28)
  (protect main: PR-only, required checks, admins included)
- Depends on: [#26](https://github.com/thom404/wordament-clone-german/issues/26)
  (CI workflow — the required check must exist first)

## Context

Merges landed on `main` via PRs by convention only (#30, #31, #33), but the
branch was unprotected: a direct push (force or not) bypassed review and CI.
The single committer is the repo owner, so owner enforcement is the point, not
an edge case. CI (#26) runs lint, typecheck and tests as job `checks` in
workflow `CI` (the check-run name is `checks`) on every PR and push to `main`.

## Decision

`main` is protected through the classic branch-protection REST API
(`PUT /repos/thom404/wordament-clone-german/branches/main/protection`, applied
via `gh api`, repo admin token):

1. **Required status check `checks` (strict).** The CI job from #26 must be
   green before a PR can merge; strict keeps the head branch up to date before
   merging.
2. **Admins included.** `enforce_admins: true` — direct pushes by the owner are
   rejected like anyone else's.
3. **PR required, zero approvals.** `required_pull_request_reviews` requires a
   pull request but demands no review: one committer means an approval is a
   meaningless self-review.
4. **No force pushes, no deletions** on `main`.

Rulesets were available but the classic endpoint is sufficient and inspectable
with the same `gh api` tooling.

## Consequences

- The only path to `main` is a green pull request: `CI / checks` must pass, and
  the `Image` workflow continues to build & push the GHCR image after merge.
- The owner cannot hotfix on `main`; emergency changes still go through a
  feature branch + PR (which the owner can merge immediately).
- Keeping the check in sync with the workflow job name (`checks`) is manual:
  renaming the job in `ci.yml` requires re-pointing the required context.
- The deploy flow (`OPERATOR-STEPS.md`, #32/#33) is unaffected — the server
  pulls the image; nobody pushes to `main` from the host.

## Suppressed alternatives

- **No required approvals** (as above): rejected requiring ≥1 approval — it
  would demand a second human reviewer the repo does not have.
- **Ruleset instead of classic protection**: rejected — no additional fit;
  classic is already scoped to the branch and simpler to audit.
- **Bypass list for the owner**: rejected — owner enforcement is the intent of
  #28; a bypass list would revert it.
- **Requiring `build-and-push` as well**: rejected — that workflow only runs on
  `main` itself (post-merge), not on PR head branches, so it can never be a
  merge gate.
