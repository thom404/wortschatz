# ADR-0019: Auto-label newly opened issues with `needs-triage`

- Status: Accepted
- Date: 2026-10-21
- Ticket: [#59](https://github.com/thom404/wortschatz/issues/59)
  (auto label manual created issues with needs-triage via gh workflow)
- Workflow: [`.github/workflows/triage-label.yml`](../../.github/workflows/triage-label.yml)
- Related: [ADR-0006](0006-autonomous-issue-agent.md) (workflow-file exclusion
  and the default-token rationale), [`docs/agents/triage-labels.md`](../agents/triage-labels.md)

## Context

Issues are created by hand, from the GitHub UI or `gh issue create`, and nothing
applied a label on creation. `needs-triage` was added by hand after the fact, so
an unlabelled issue was invisible to the triage flow until someone noticed it.
`docs/agents/triage-labels.md` already defines `needs-triage` as the entry state
of the triage machine, so this automates an existing rule rather than inventing
one.

## Decision

1. **Trigger.** The `issues` event, action `opened` only. A `reopened` or
   `transferred` issue keeps its current triage state; the workflow is not
   subscribed to those actions.
2. **Guards.** The job is skipped when the issue already carries a
   `wayfinder:*` label (a planning artifact, not a triage item) or when the
   event sender is a bot. The label check is
   `!contains(join(github.event.issue.labels.*.name, ','), 'wayfinder:')` — a
   substring test, because GitHub Actions expressions cannot filter an array by
   prefix; no real label collides. The sender check is
   `github.event.sender.type != 'Bot'`.
3. **Label write.** `gh issue edit <n> --add-label needs-triage`, with no
   `|| true`, so a failed write fails the run. `GH_REPO` is set from
   `github.repository` so `gh` resolves the repository without a checkout.
4. **Token.** The default `GITHUB_TOKEN` with `permissions: issues: write`, and
   no personal access token. Unlike the Issue agent (ADR-0006), labelling an
   issue starts no CI, so the "a PAT is needed for the required `checks` status"
   rationale does not apply.
5. **One transition only.** The workflow adds `needs-triage` and nothing else:
   no removal, no other triage state, no category label. Adding `needs-triage`
   starts nothing — the Issue agent still fires only on `agent-run` (ADR-0006).
6. **Documentation.** The behaviour is recorded in
   `docs/agents/triage-labels.md`, beside the label vocabulary it automates.
7. **Seam.** The workflow boundary: an `opened` event and its observable label
   effect, exercised the same manual way as the Issue agent's boundary
   (ADR-0006 §12). No application seam is introduced.

## Rejected alternatives

- **Labelling on `reopened` or `transferred`.** Rejected — those keep their
  current triage state; re-entering the machine is not the same as entering it.
- **A personal access token (`AGENT_GITHUB_TOKEN`).** Rejected — labelling
  starts no CI, so the ADR-0006 reason for a PAT does not apply; the default
  token with `issues: write` is enough and adds no secret.
- **Exact-name matching for the five known `wayfinder:*` labels.** Rejected — a
  substring test catches a future `wayfinder:*` label without editing the
  workflow.
- **A third-party labelling action or `actions/github-script`.** Rejected — the
  GitHub CLI is preinstalled on the runner and the repo already drives `gh` in
  its workflows.

## Consequences

- A newly opened human-authored issue enters triage at `needs-triage` with no
  manual step.
- The workflow only adds `needs-triage`; it never removes labels and performs no
  other transition, so it cannot move an issue out of a state a human set.
- Because its deliverable is a file under `.github/workflows/**`, an issue like
  #59 cannot be implemented by the Issue agent (ADR-0006 §5); such issues are
  human-only.
- The workflow runs from the default branch, so it takes effect only after
  merge.
