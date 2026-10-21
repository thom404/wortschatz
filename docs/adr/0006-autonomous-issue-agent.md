# ADR-0006: Autonomous issue agent triggered by `agent-run`

- Status: Accepted
- Date: 2026-10-17
- Amended: 2026-10-21 (#59) — workflow-file exclusion is human-only
- Ticket: [#60](https://github.com/thom404/wortschatz/issues/60)
  (spec: autonomous issue agent for `ready-for-agent` issues), implemented by
  [#61](https://github.com/thom404/wortschatz/issues/61)–[#66](https://github.com/thom404/wortschatz/issues/66);
  the manual trigger that split the command from the marker landed in
  [#91](https://github.com/thom404/wortschatz/issues/91)/[#92](https://github.com/thom404/wortschatz/issues/92)
- Depends on: [ADR-0004](0004-branch-protection-main.md) (main is PR-only; the
  required `checks` status must report on every pull request)
- Workflow: [`.github/workflows/issue-agent.yml`](../../.github/workflows/issue-agent.yml)
- Agent contract: [`.opencode/agent/issue-implementer.md`](../../.opencode/agent/issue-implementer.md)
- Operator doc: [`docs/OPERATOR-STEPS.md`](../OPERATOR-STEPS.md) §8

## Context

The maintainer writes a specification for an issue and then writes the code by
hand. For an issue that is already fully specified, that second step is slow and
repetitive. The wanted shape is: add the trigger label, let an agent implement
it, then review the result as an ordinary pull request. The trigger is explicit
and separate from the issue's triage state, so marking an issue as specified can
never start a run by accident.

The obvious tool, the official OpenCode GitHub action, does not fit this repo:

- it starts on comment events, not on the `issues` event, so a label cannot
  start it;
- it always creates its own branch name;
- it cannot apply the label lifecycle the maintainer needs;
- a pull request opened with the workflow's `GITHUB_TOKEN` does not start the
  `CI` workflow, so the required `checks` status (ADR-0004) would never report
  and the pull request could never merge.

`main` is protected by a repository ruleset (ADR-0004): the only path to `main`
is a green pull request, with zero approvals required. The automation must not
weaken that: it may propose, never merge or close.

## Decision

**A GitHub Actions workflow runs a headless OpenCode agent that edits the
working tree; the workflow — never the agent — commits, pushes, and opens the
pull request.**

1. **Trigger and label lifecycle.** The workflow triggers on the `issues`
   event, action `labeled`, only for the label `agent-run`, and on
   `workflow_dispatch` with an issue number. The three labels split command from
   state:

   - `agent-run` is the **command**. A human adds it by hand; it is the only
     label that starts a run. A run removes it as it starts, so a second
     `agent-run` is an explicit retry and the label always means "a run is
     requested".
   - `ready-for-agent` is the **marker**. It records that the issue is fully
     specified and safe for an agent to pick up, and it starts nothing. People
     and tools may add it freely.
   - `agent-running` is the **status marker**. The run adds it while the agent
     works and an always-run cleanup removes it when the run ends, on success
     and on failure. It is information only and gates nothing.

   For a label event, a job condition admits only issues whose
   `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR`, so an outsider
   cannot inject work; a manual dispatch is run by a collaborator by definition.
   A concurrency group keyed by the issue number serialises runs without
   cancelling one in progress, so a second run queues.

2. **Preflight skip guard.** Before `npm ci` and before the agent, the workflow
   runs one skip guard with three checks in order: an existing target branch
   (`git/matching-refs`), an open pull request whose body or title references
   the issue, and open blockers. The first match wins and produces a single
   comment; the step writes its skip flag and exits successfully, so a skipped
   run installs nothing, starts no agent, and creates no branch or pull request.
   An issue is blocked when GitHub's native dependencies report one or more
   **open, same-repo** blockers (`issue_dependencies_summary.blocked_by > 0`);
   the blocker check lists them from the native dependency endpoint and comments
   `Skipping: blocked by #a, #b.` plus a note to add `agent-run` again once the
   blockers close. Closed blockers do not count, and a reopened blocker counts
   again. A blocker skip removes `agent-run` and leaves `ready-for-agent` on the
   issue, so re-adding `agent-run` — or a manual dispatch — is the retry. The
   guard fails closed: if the dependency lookup fails, or it reports blockers it
   cannot list, the step fails rather than proceeding, and the failure lifecycle
   (item 10) applies `ready-for-human`. (The blocker gate landed in
   [#78](https://github.com/thom404/wortschatz/issues/78).)
3. **Agent invocation and contract.** The workflow runs the OpenCode CLI in
   headless mode (`opencode run`) with the project-scoped agent
   `issue-implementer` on `opencode-go/deepseek-v4.1-flash`. The agent
   definition is the versioned behaviour contract: role, repository
   conventions, the glossary/ADR rule, the denied write paths, and the stop
   conditions. The workflow prompt carries only the per-run task. The agent
   edits files only; it never commits, pushes, merges, or closes.
4. **Agent permissions.** Explicit allow for `read`, `edit`, `glob`, `grep`,
   `list`, `bash`, and `webfetch`; deny for `question`, `task`, `skill`, and
   `external_directory`. The `bash` deny-list blocks `git push`, `gh pr
create`, `gh pr merge`, `gh issue close`, `git reset --hard`, and `rm -rf`;
   `gh issue edit` and `gh issue comment` stay available for the spec gate.
   The run does not use the CLI's auto-approve flag — `ask` cannot be answered
   in CI, so every permission is `allow` or `deny`.
5. **Write guardrails.** The agent may edit application code, tests,
   documentation, `GLOSSARY.md`, ADRs, package metadata, and the lockfile. It
   must not edit CI workflow files (`.github/workflows/**`), deployment files
   (`deploy/**`), compose files (`compose*.yaml`), the container file
   (`Dockerfile`), or environment files (`.env*`). The guardrail lives in the
   agent contract and keeps supply-chain-relevant files out of reach.
6. **Spec gate.** If the issue has no testable acceptance criterion, the agent
   comments what is missing, applies `needs-info`, removes `ready-for-agent`,
   and stops with no file changes. The workflow treats a clean working tree
   with `needs-info` present as a successful no-op; a clean tree without
   `needs-info` is a failure.
7. **Verification.** After the agent edits and before any commit, the workflow
   runs `npm run lint`, `npm run typecheck`, and `npm test` on the pinned Node
   version (22, from `package.json`/`ci.yml`). Any failure fails the run; no
   branch or pull request is produced.
8. **Pull request.** On success the workflow creates `feature/<n>-<slug>`
   (slug = the issue title in kebab case, at most five words) from the default
   branch, commits, pushes, and opens a pull request against the default branch
   whose body contains `Closes #<n>`. It comments the pull request link on the
   issue. It never merges or closes anything, and it never force-pushes.
9. **Identity.** The push, the pull-request creation, and the issue comments
   use a fine-grained personal access token stored as `AGENT_GITHUB_TOKEN`
   (contents, pull-request, and issue write). This identity is what starts the
   `CI` workflow on the pull request so the required `checks` status reports,
   as ADR-0004 requires. The model provider uses `OPENCODE_API_KEY`. Neither
   value is stored in the repository; both are set by hand in the repository
   settings.
10. **Failure lifecycle.** If any step fails — verification, agent error,
    push, or pull-request creation — a final always-on-failure step comments
    the failure on the issue, removes `agent-run`, `agent-running`, and
    `ready-for-agent`, and applies `ready-for-human`. The issue stays open and no
    pull request is left behind.
11. **Resource limits.** The job has a 45-minute timeout; the agent definition
    has an 80-step limit. This bounds a runaway loop.
12. **Test seam.** The feature adds one seam at the workflow boundary: a label
    event (or a manual dispatch) and its observable GitHub effects (label
    changes, comments, branch, pull request, and the CI result). The blocker
    skip joins the existing skip-guard seam rather than adding a seam of its
    own: it is exercised the same manual way at the boundary as the existing
    "work already exists" check, and an unblocked run reuses the existing
    `CI / checks` job as the code-verification seam; no second verification
    path and no new application seam are introduced.

## Consequences

- A fully specified issue can go from an explicit `agent-run` to a reviewable
  pull request without the maintainer writing the implementation, while review,
  the branch protection of `main`, and the required `checks` status stay exactly
  as ADR-0004 defines them. The agent proposes; the maintainer merges.
- The workflow only runs from the default branch for `issues` events, so the
  change must merge before an `agent-run` label event can start it; the manual
  trigger from the feature branch smoke-tests it first.
- Two new secrets must be created by hand once: `OPENCODE_API_KEY` and
  `AGENT_GITHUB_TOKEN` (fine-grained, contents + pull-request + issue write,
  scoped to this repository). The workflow cannot create them. See
  `docs/OPERATOR-STEPS.md` §8.
- Two operational labels must exist before the trigger works: `agent-run` (the
  command) and `agent-running` (the status marker). They are created once by
  hand in the repository settings.
- The trigger is a command, so marking an issue as specified can never start a
  run by accident: `ready-for-agent` records state and `agent-run` starts work.
  The label lifecycle is deterministic — a run removes `agent-run` and adds
  `agent-running` as it starts, the always-run cleanup removes `agent-running`,
  and a failure also removes `ready-for-agent` and adds `ready-for-human` — so
  an issue never stays looking ready for an agent after a failed run.
- A blocker skip is retried by hand: GitHub fires no event on the dependent
  issue when a blocker closes, and no automatic re-trigger or scheduled sweep
  is added — deliberately deferred (#78). After unblocking, the maintainer
  re-adds `agent-run` or dispatches the workflow by hand.
- The blast radius of the agent is bounded by the contract and the
  permissions, but a determined prompt could still edit any in-scope file. The
  guardrails and the PAT scope are the limit; the token can push and comment
  but cannot change repository settings.
- The agent consumes the maintainer's OpenCode Go plan. The step limit and the
  job timeout bound the cost per run.

## Suppressed alternatives

- **The official OpenCode GitHub action**: rejected — comment-only trigger,
  its own branch naming, no label lifecycle, and a `GITHUB_TOKEN` pull request
  that cannot start the required `checks` status (ADR-0004). See Context.
- **`GITHUB_TOKEN` for push and pull-request creation**: rejected — a pull
  request opened with the workflow token does not start `CI`, so the required
  `checks` status would never report and the pull request could never merge.
  The PAT identity is the mechanism that makes the required status appear.
- **Letting the agent commit, push, and open the pull request itself**:
  rejected — the workflow must be the only writer of git history and the only
  creator of pull requests, so the agent can be denied those abilities
  outright.
- **Auto-merge or auto-close**: rejected — the maintainer keeps the final
  decision; `Closes #<n>` lets the issue follow the merged pull request.
- **Adding a second verification path beside `CI / checks`**: rejected — the
  existing `checks` job already runs lint, typecheck, and tests on every pull
  request; a second path could drift.
- **Running the workflow on comment events**: rejected — the wanted trigger is
  an explicit label a human adds (`agent-run`), while the triage state
  (`ready-for-agent`) is a marker that starts nothing; a comment is a different
  interaction.
- **Triggering on the `ready-for-agent` marker**: rejected — it conflates the
  state "this ticket is specified" with the command "start a run now", so
  marking a ticket could start a run before its blocker links exist; the two
  are split into `ready-for-agent` (marker) and `agent-run` (command).

## Amendment (#59, 2026-10-21): workflow-file exclusion is human-only

§5 excludes CI workflow files (`.github/workflows/**`) from the agent's scope.
The consequence is explicit: an issue whose deliverable is itself a workflow
file cannot be implemented by the Issue agent. The agent applies the spec gate
(`needs-info`, stop) and a human implements it. [#59](https://github.com/thom404/wortschatz/issues/59)
— the auto-triage label workflow, [ADR-0019](0019-auto-triage-label-on-issue-open.md)
— is the first such issue and was implemented by hand. No automatic path for
workflow changes is added; the exclusion stays a hard boundary.
