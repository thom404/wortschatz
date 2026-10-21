# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                                               |
| -------------------------- | -------------------- | --------------------------------------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue                               |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information                              |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent (marker only; starts nothing) |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation                                         |
| `wontfix`                  | `wontfix`            | Will not be actioned                                                  |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.

## Entering the machine

A newly opened issue enters at `needs-triage` automatically: the `Triage label`
workflow (`.github/workflows/triage-label.yml`) applies the label on the
`opened` action, using the default `GITHUB_TOKEN` with `issues: write` and no
new secret. It skips an issue that already carries a `wayfinder:*` label
(planning artifacts, not triage items) and an issue opened by a bot, and it
does nothing on `reopened` or `transferred`, so those keep their current state.
It performs no other transition, and applying `needs-triage` starts no CI — the
Issue agent still fires only on `agent-run`. The decision is
[ADR-0019](../adr/0019-auto-triage-label-on-issue-open.md).

## Operational labels

Two labels sit outside the five triage roles and drive the Issue agent
(ADR-0006). They are operational, not triage states:

| Label           | Meaning                                                                           |
| --------------- | --------------------------------------------------------------------------------- |
| `agent-run`     | Added by hand to start the Issue agent on this issue; removed when the run starts |
| `agent-running` | Status marker: the Issue agent is running on this issue right now                 |

`ready-for-agent` is the state ("this ticket is specified"); `agent-run` is the
command that starts a run. Adding `ready-for-agent` starts nothing.
