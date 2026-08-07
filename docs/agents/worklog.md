# Agent worklog

Every subagent dispatch in this repository is recorded in `.agents/log/worklog.jsonl`.
The log is the evidence base for the `hr-officer` review that closes each
implementation cycle: without it, HR can only audit agent definitions, not whether
the agents actually did their jobs.

## The file

- Path: `.agents/log/worklog.jsonl` — git-tracked, one JSON object per line.
- **Append-only.** Nothing rewrites, reorders, or truncates it, including `hr-officer`.
- `.gitattributes` marks it `merge=union` so concurrent branch appends merge without
  conflict. Never resolve a worklog conflict by dropping lines.

## Schema

```json
{"ts":"2026-08-06T23:06-06:00","cycle":"feat/hr-officer-worklog","agent":"code-reviewer","platform":"claude","task":"review the trailer rollout diff","outcome":"findings","summary":"2 findings, top: docs-auditor brief missed the trailer","artifacts":["~/.claude/agents/docs-auditor.md"]}
```

| Field | Required | Written by | Notes |
|---|---|---|---|
| `ts` | yes | coordinator | ISO-8601 with local offset (America/Mexico_City, `-06:00`) |
| `cycle` | yes | coordinator | Branch name, or a short label when no branch fits |
| `agent` | yes | agent trailer | Agent name, or `coordinator-inline` |
| `platform` | yes | coordinator | `claude` or `codex` |
| `task` | yes | agent trailer | One line: what it was asked to do |
| `outcome` | yes | agent trailer | `ok` \| `findings` \| `approved` \| `changes_required` \| `failed` \| `no_result` |
| `summary` | yes | agent trailer | One line: what came back |
| `artifacts` | no | coordinator | Paths, commits, or docs the dispatch touched or produced |

## Who writes it

**The coordinator appends every line.** Five of the seven agents are read-only and
physically cannot write files — so agents *report* their entry and the coordinator
*records* it. Each agent brief ends with:

> End your report with a single line `WORKLOG: {"agent":…,"task":…,"outcome":…,"summary":…}`
> so the coordinator can append it to the repository's agent worklog.

(`skeptical-reviewer` places its trailer *after* the mandatory verdict block, since
its contract requires the verdict structure to close the review body.)

The coordinator stamps `ts`, `cycle`, `platform`, and `artifacts`, then appends.

Two entries agents cannot report for themselves, and the coordinator must write:

- **`no_result`** — a dispatch that crashed, was skipped, or returned nothing. A dead
  agent cannot log its own death; an unlogged failure looks like a dispatch that never
  happened.
- **`coordinator-inline`** — substantial specialist-shaped work the coordinator did
  itself instead of dispatching (a review, an exploration, a verification run). This is
  the recruiting signal: recurring inline work with no owner is how `hr-officer` spots
  a role the roster is missing. Do not omit these to keep the log tidy.

A missing or malformed line is an `hr-officer` finding, never a runtime error. Nothing
in the app reads this file.

## The HR gate

At the end of an implementation cycle — after the post-phase code review, before the
completion report — dispatch `hr-officer`. It reviews entries since its own last log
entry and returns `STAFF REVIEW` / `FINDINGS` / `PROPOSALS`.

The gate is **advisory**: HR findings never block a delivery, and HR proposes roster
changes (new agents, retirements, merges) as drafts for the user to approve. It never
creates or edits agent definitions, and never edits this log.

See also: `.agents/skills/adversarial-plan-review/SKILL.md` for the review workflow
whose rounds also land here.
