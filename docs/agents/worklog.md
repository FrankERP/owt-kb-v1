# Agent worklog

Every subagent dispatch in this repository is recorded in `.agents/log/worklog.jsonl`.
The log is the evidence base for the `hr-officer` review that closes each
implementation cycle: without it, HR can only audit agent definitions, not whether
the agents actually did their jobs.

## The file

- Path: `.agents/log/worklog.jsonl` — local-only, one JSON object per line. Gitignored;
  never committed or pushed.
- **Append-only.** Nothing rewrites, reorders, or truncates it, including `hr-officer`.

## Schema

```json
{"ts":"2026-08-06T23:06-06:00","cycle":"feat/hr-officer-worklog","agent":"code-reviewer","platform":"claude","task":"review the trailer rollout diff","outcome":"findings","summary":"2 findings, top: docs-auditor brief missed the trailer","artifacts":["~/.claude/agents/docs-auditor.md"]}
```

| Field | Required | Written by | Notes |
|---|---|---|---|
| `ts` | yes | coordinator | ISO-8601 with local offset (America/Mexico_City, `-06:00`). Fresh clock read at append, or the entry's own commit — never a leftover stamp. |
| `cycle` | yes | coordinator | Branch name, or a short label when no branch fits |
| `agent` | yes | agent trailer | Agent name, or `coordinator-inline` |
| `platform` | yes | coordinator | `claude` or `codex` or `cursor`. Cursor Task dispatches on 2026-08-13 were a true value the two-platform enum rejected. |
| `task` | yes | agent trailer | One line: what it was asked to do |
| `outcome` | yes | agent trailer | `ok` \| `findings` \| `approved` \| `changes_required` \| `failed` \| `no_result` |
| `summary` | yes | agent trailer | One line: what came back |
| `artifacts` | no | coordinator | Paths, commits, or docs the dispatch touched or produced |
| `tokens` | no | coordinator | `subagent_tokens` from the dispatch result's usage block, when available |
| `duration_ms` | no | coordinator | `duration_ms` from the same usage block (added 2026-08-11; earlier entries lack both) |
| `corrects` | no | coordinator | 1-based line number of the entry being corrected (see Correcting a line) |
| `field` | no | coordinator | Field name on that line |
| `corrected_value` | no | coordinator | Replacement value |

## Who writes it

**The coordinator appends every line.** Five of the seven agents are read-only and
physically cannot write files — so agents *report* their entry and the coordinator
*records* it. Each agent brief ends with:

> End your report with a single line `WORKLOG: {"agent":…,"task":…,"outcome":…,"summary":…}`
> so the coordinator can append it to the repository's agent worklog.

(`skeptical-reviewer` places its trailer *after* the mandatory verdict block, since
its contract requires the verdict structure to close the review body.)

The coordinator stamps `ts`, `cycle`, `platform`, and `artifacts` — plus `tokens`
and `duration_ms` from the dispatch result's usage block when the platform reports
them — then appends.

Two entries agents cannot report for themselves, and the coordinator must write:

- **`no_result`** — a dispatch that crashed, was skipped, or returned nothing. A dead
  agent cannot log its own death; an unlogged failure looks like a dispatch that never
  happened.
- **`coordinator-inline`** — substantial specialist-shaped work the coordinator did
  itself instead of dispatching (a review, an exploration, a verification run). This is
  the recruiting signal: recurring inline work with no owner is how `hr-officer` spots
  a role the roster is missing. Do not omit these to keep the log tidy.

**The entry is appended locally when the work happens.** Never stage or push this file.
The old "ships in the same commit" rule is how the log landed on the remote; it is
retired. Append immediately so "I'll log it at the end" cannot skip a dispatch.

**Incidents and firefights count as cycles.** Nobody logs mid-fire, and nobody is
expected to — backfill the entries once the fire is out and dispatch `hr-officer` over
the incident window like any other cycle. Incident work runs with the least scrutiny,
which makes it the cycle most worth closing properly. The 2026-08-07 SMTP incident (an
afternoon of production commits, zero entries) is the case this rule exists for.

### Backfilling, when it cannot be avoided

Backfill is a repair, not a workflow, and it is the origin of **every** defect this
file has ever carried. Three constraints, each earned:

- **Mark it: `"backfilled": true`.** A missing `tokens`/`duration_ms` already hints at
  it; the flag says it.
- **Derive `ts` from an artifact — the commit the dispatch produced, or the commit that
  closes its findings — never from recollection**, and record which in
  `"ts_derived_from"`. On 2026-08-12 four backfilled reviews were timestamped from
  memory and *three landed before the commits they reviewed*: a review at 16:40 of an
  implementation committed at 17:48. The log asserted an impossibility.
- **Grep for the same `(agent, cycle, task)` before appending.** All seven duplicate
  entries this file has ever held came from a backfill re-recording a dispatch that was
  already logged — twice by the same coordinator inside one day.

Out-of-order timestamps remain fine; the file is append-only and `hr-officer` reads it
in file order. What is not fine is a timestamp that could not have happened.

That last sentence is not a backfill-only rule. Every entry's `ts` is a fresh clock
read at the moment of the append, or the commit that recorded the entry — never a
leftover stamp from earlier in the same run. Line 141 shipped with its work
(b699195, committed 2026-08-13T07:26:22-06:00) carrying `2026-08-12T22:59:00-06:00`:
the session date rolled over mid-run. The backfill constraint above would not have
caught it, because the entry was live.

**One line per dispatch, including each review round.** Collapsing "rounds 1–5" into a
single entry undercounts volume by four and makes per-round verdicts unauditable from
the log — which is the one place they are supposed to be auditable.

An entry's `outcome` reflects the agent's own verdict, not the cycle's mood: a report
carrying any Important finding logs as `findings`, never `ok`.

A missing or malformed line is an `hr-officer` finding, never a runtime error. Nothing
in the app reads this file.

### Correcting a line

A wrong field has no in-place repair. The two precedents were rewriting the file
(which violates append-only) and leaving it wrong. Corrections are appended, never
edited. The correcting entry carries `corrects` (the 1-based line number), `field`,
and `corrected_value`, alongside the normal entry fields. `hr-officer` reads the file
in order, so a later correction supersedes an earlier value. Line 141 is the case:
its `ts` is 8h27m before the artifact it cites, and the line itself is unchanged.

## The HR gate

At the end of an implementation cycle — after the post-phase code review, before the
completion report — dispatch `hr-officer`. It reviews entries since its own last log
entry **in file order** (not timestamp order — backfilled entries carry older
timestamps but land later in the file) and returns `STAFF REVIEW` / `FINDINGS` /
`PROPOSALS`.

The gate is **advisory**: HR findings never block a delivery, and HR proposes roster
changes (new agents, retirements, merges) as drafts for the user to approve. It never
creates or edits agent definitions, and never edits this log.

See also: `.agents/skills/adversarial-plan-review/SKILL.md` for the review workflow
whose rounds also land here.
