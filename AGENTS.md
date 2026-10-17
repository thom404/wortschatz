# wortschatz

## Autonomous issue agent

Applying the `ready-for-agent` label to a fully specified issue starts
`.github/workflows/issue-agent.yml`, which runs the headless OpenCode agent
`.opencode/agent/issue-implementer.md`. The agent edits the working tree only;
the workflow commits, pushes `feature/<n>-<slug>`, and opens a pull request that
says `Closes #<n>`. The agent never merges or closes anything, and a failed run
comments the failure and applies `ready-for-human`. See
[ADR-0006](docs/adr/0006-autonomous-issue-agent.md). Secret setup is in
[`docs/OPERATOR-STEPS.md`](docs/OPERATOR-STEPS.md) §8: `OPENCODE_API_KEY` and a
fine-grained `AGENT_GITHUB_TOKEN` (contents, pull-request, and issue write).

## German UI copy

All user-facing strings are German and hardcoded inline. Write new copy in the
recorded voice and follow the preferred/avoided terms in
[`docs/ux-copy.md`](docs/ux-copy.md); the decision is
[ADR-0007](docs/adr/0007-german-ui-copy-voice.md).

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `thom404/wortschatz`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
