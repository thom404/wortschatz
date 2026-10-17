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

## Operational labels

Two labels sit outside the five triage roles and drive the Issue agent
(ADR-0006). They are operational, not triage states:

| Label           | Meaning                                                                           |
| --------------- | --------------------------------------------------------------------------------- |
| `agent-run`     | Added by hand to start the Issue agent on this issue; removed when the run starts |
| `agent-running` | Status marker: the Issue agent is running on this issue right now                 |

`ready-for-agent` is the state ("this ticket is specified"); `agent-run` is the
command that starts a run. Adding `ready-for-agent` starts nothing.
