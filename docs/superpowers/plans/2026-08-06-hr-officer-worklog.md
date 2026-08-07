# Implementation Plan: hr-officer agent + agent worklog convention

## Original request

> I want this to be an agent (and if possible named something after HR) and integrate it somehow into the workflow, maybe since we should be keeping a log of reviews and implementations (every agent should log its work). HR agent can check if they are doing their job correctly and if we need to recruit (create) a new agent after every implementation cycle or something like that.

## Status and contract

- Document status: Draft
- Accepted spec or requirement source: design approved in conversation 2026-08-06 (decisions table below); no separate spec — requirements are small and fully decided.
- Primary outcome: every subagent dispatch is logged to a per-repo worklog, and a read-only `hr-officer` agent reviews the log and roster at the end of each implementation cycle, proposing (never making) roster changes.
- Preconditions: the seven-agent roster as of 2026-08-06 (`~/.claude/agents/*.md` mirrored in `~/.codex/agents/*.toml`); `.agents/skills/adversarial-plan-review/reviewer-brief.md` is the canonical skeptical-reviewer brief.
- Safe ending state: all files in place, both platforms' definitions parse, worklog seeded; nothing depends on the log existing, so absence of entries is never an error.

## Risk tier

**Standard.** Rationale: no production/server writer, no mutation trust boundary, no auth/security/ACL/secret change, no schema/data migration, no irreversible remote action. Everything is documentation, local agent definitions, and an append-only tracked text file; full rollback is `git revert` plus deleting two machine-local files.

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| 5 of 7 agents are read-only (Codex `sandbox_mode = "read-only"`; Claude briefs say "do not edit files") | `~/.codex/agents/*.toml`, `~/.claude/agents/*.md` | Agents cannot write logs; the coordinator must append every entry |
| Codex coordinator runs workspace-write sandbox | Codex config | Worklog must live inside the repo, not under `~/` |
| Reviewer brief is canonical with two mirrors; drifted once already (Codex toml lacked the VERIFIED ledger until 2026-08-06) | sync notes in all three copies | HR's definition-health check is a proven need, not speculation; trailer edits to skeptical-reviewer go through the brief |
| Brief gained two additions not yet mirrored: "You are read-only" clause, silent-narrowing scope finding | `reviewer-brief.md:12,28` | Fold the pending sync into this delivery |
| `docs/agents/*.md` is the established home for agent-facing conventions | `docs/agents/issue-tracker.md`, CLAUDE.md "Agent skills" | Full worklog convention goes in `docs/agents/worklog.md`; CLAUDE.md links it |
| `.agents/log/` does not exist | `ls` 2026-08-06 | Created in this delivery with a seed entry |
| New agent definitions register at session start | `deploy-verifier`/`docs-auditor` appeared in the agent list only after creation, in a later turn | Post-implementation verification (dispatching `hr-officer`) needs a fresh session |
| Repo TZ invariant is America/Mexico_City | CLAUDE.md invariants | Worklog `ts` uses ISO-8601 with the local UTC offset |

## Scope

### In scope

1. Worklog convention: schema doc at `docs/agents/worklog.md`; tracked append-only `.agents/log/worklog.jsonl` with a seed entry; coordinator-appends rule including `coordinator-inline` entries and `no_result` for crashed dispatches.
2. `WORKLOG:` trailer rule appended to all seven agent briefs on both platforms (skeptical-reviewer via the canonical brief, then propagated to its two mirrors).
3. Pending reviewer-brief sync: propagate the read-only clause and silent-narrowing finding to both skeptical-reviewer mirrors.
4. New global `hr-officer` agent (`~/.claude/agents/hr-officer.md` + `~/.codex/agents/hr-officer.toml`): read-only; four checks (log discipline, contract compliance, definition health, workforce planning); propose-only; short-circuit clean pass; structured STAFF REVIEW / FINDINGS / PROPOSALS output.
5. CLAUDE.md "Agent skills" section: worklog convention pointer + advisory end-of-cycle HR gate.

### Non-goals

- No hooks, scripts, or validators (convention-only was an explicit decision; HR flags malformed lines instead).
- No `/improve` ladder changes.
- No authority for `hr-officer` to create, edit, or retire agents or rewrite the log.
- No backfill of historical work into the log.
- No blocking gate: HR review failure or findings never block a delivery.

### Preserved invariants

- Read-only agents stay read-only; the trailer is output text, not a write.
- `reviewer-brief.md` remains canonical; mirrors updated in the same change (sync rule of 2026-08-06).
- Worklog is append-only; nothing (including HR) rewrites or truncates it.
- Roster changes remain user-approved (global CLAUDE.md subagent conventions).

## Affected boundaries

| Component, file, or system | Current responsibility | Planned responsibility |
|---|---|---|
| `.agents/log/worklog.jsonl` (new, tracked) | — | Append-only dispatch record; written only by coordinators |
| `docs/agents/worklog.md` (new, tracked) | — | Full schema + rules; linked from CLAUDE.md |
| `~/.claude/agents/*.md` ×7, `~/.codex/agents/*.toml` ×7 (machine-local) | Agent charters | + one WORKLOG-trailer sentence each |
| `~/.claude/agents/hr-officer.md`, `~/.codex/agents/hr-officer.toml` (new, machine-local) | — | HR charter |
| `.agents/skills/adversarial-plan-review/reviewer-brief.md` | Canonical skeptical brief | + trailer sentence; source for mirror sync |
| `CLAUDE.md` | Project conventions | + worklog/HR paragraph under "Agent skills" |

## Worklog schema (contract)

One JSON object per line:

```json
{"ts":"2026-08-06T23:06-06:00","cycle":"<branch or label>","agent":"<agent name | coordinator-inline>","platform":"claude|codex","task":"<one line>","outcome":"ok|findings|approved|changes_required|failed|no_result","summary":"<one line>","artifacts":["<path or sha>"]}
```

- `ts`, `cycle`, `platform`, `artifacts` stamped by the coordinator; `agent`, `task`, `outcome`, `summary` from the agent's `WORKLOG:` trailer (or reconstructed by the coordinator for `no_result`/`coordinator-inline`).
- `artifacts` optional; all other fields required.

Trailer sentence appended to every agent brief:

> End your report with a single line `WORKLOG: {"agent":"<name>","task":"<one line>","outcome":"<ok|findings|approved|changes_required|failed>","summary":"<one line>"}` so the coordinator can append it to the repository's agent worklog.

## Ordered changes

### 1. Worklog convention + seed

- Purpose: give HR its evidence base and coordinators their rule.
- Components: `docs/agents/worklog.md` (new), `.agents/log/worklog.jsonl` (new), `CLAUDE.md`.
- Change: write the convention doc (schema above, coordinator-appends rule, `coordinator-inline` and `no_result` rules, append-only invariant); seed the log with one genesis entry logging this delivery; add `.gitattributes` with `.agents/log/worklog.jsonl merge=union` so concurrent branch appends union instead of conflicting; add a short paragraph under "Agent skills" linking the doc and stating the advisory end-of-cycle HR gate, mirrored identically in CLAUDE.md and the repo-root AGENTS.md.
- Failure and recovery behavior: none at runtime — the log is inert data; a missing or malformed line is an HR finding, never an error.
- Verification: `python3 -c "import json;[json.loads(l) for l in open('.agents/log/worklog.jsonl')]"` exits 0; doc links resolve.
- State after this step: convention exists and is self-consistent; no agent references it yet — safe.

### 2. Trailer rule in all agent briefs + pending brief sync

- Purpose: make every agent emit loggable output; clear the outstanding mirror drift.
- Components: `reviewer-brief.md`; `~/.claude/agents/{codebase-explorer,implementation-worker,test-verifier,code-reviewer,skeptical-reviewer,docs-auditor,deploy-verifier}.md`; the seven matching `~/.codex/agents/*.toml`.
- Change: append the trailer sentence to each brief. For skeptical-reviewer, whose contract mandates ending with the verdict structure, the trailer sentence instead reads "after your verdict block, add one final line `WORKLOG: …`" so the two "end with" instructions cannot conflict. Add it to the canonical brief, then regenerate both mirrors from the brief — which also propagates the read-only clause and the silent-narrowing scope finding.
- Failure and recovery behavior: an agent that forgets the trailer degrades to a coordinator-reconstructed entry; HR flags recurrence.
- Verification: `grep -l "WORKLOG:"` matches all 15 files (17 after step 3 adds the two hr-officer files); TOML parse check on all seven `.toml`; diff skeptical mirrors against the brief for material parity.
- State after this step: agents describe the trailer; nothing consumes it yet — safe.

### 3. hr-officer agent (both platforms)

- Purpose: the reviewer of record for roster health.
- Components: `~/.claude/agents/hr-officer.md` (new), `~/.codex/agents/hr-officer.toml` (new).
- Change: charter with — read-only tools (Read/Grep/Glob/Bash; Codex `sandbox_mode = "read-only"`); scope = entries since the last `hr-officer` log entry; the four checks in order (log discipline → contract compliance → definition health → workforce planning); short-circuit (≤2 clean entries → one-line clean pass); output contract `STAFF REVIEW` / `FINDINGS` (severity-ordered, file:line evidence) / `PROPOSALS` (hire proposals as complete draft charters, retirement/merge flags); explicit propose-only clause (never edits definitions, briefs, or the log); its own WORKLOG trailer; `model: inherit`, no effort pin (per-dispatch choice per global conventions); color cyan is taken — use pink; nicknames "HR", "People Ops", "The Department".
- Failure and recovery behavior: HR is advisory — a failed or absent HR run is logged `no_result` and never blocks the cycle.
- Verification: TOML parses; frontmatter fields match roster conventions; next-session agent list includes `hr-officer`.
- State after this step: full system in place — safe.

### 4. Commit and verify

- Purpose: repo gates + first live run.
- Change: commit repo files (`docs/agents/worklog.md`, `.agents/log/worklog.jsonl`, `.gitattributes`, `reviewer-brief.md`, `CLAUDE.md`, `AGENTS.md`, this plan) as `feat(agents): hr-officer + agent worklog convention` on the working branch; run `npx tsc --noEmit`, `npm test`, `npx eslint .` (formality — no app code changes, but the gates are unconditional). In a fresh session: dispatch `hr-officer` once against the seeded log and confirm a sane clean-pass or genuine findings; log that dispatch.
- Failure and recovery behavior: gate failure → fix or revert the commit; nothing external depends on these files.
- Verification: three gates pass; HR's first report is well-formed per its output contract.
- State after this step: delivered.

## Data and failure safety

- Identity and source of truth: `reviewer-brief.md` canonical for the skeptical brief; each agent's `.md`/`.toml` pair kept byte-equivalent in body; the worklog is the sole dispatch record and is append-only.
- Migration and compatibility: none — new files only; existing agent briefs gain one sentence.
- Partial failure and retry behavior: a half-done trailer rollout is harmless (unlogged agents are an HR finding); re-running any step is idempotent by inspection before write.
- Concurrency, conflicts, and idempotency: single-writer (one coordinator per session); concurrent branch appends to the JSONL union cleanly via the `merge=union` gitattribute set in step 1 (git's default driver would otherwise surface a visible EOF conflict).
- Data preservation and rollback: repo changes revert with git; machine-local agent files roll back by deleting `hr-officer.*` and stripping the trailer sentence (each addition is a single greppable sentence).

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Log parses | python JSONL parse loop over `.agents/log/worklog.jsonl` | Malformed seed/entries |
| All briefs carry trailer | `grep -l "WORKLOG:"` across 15 brief files | Missed agent |
| Codex definitions valid | `tomllib` parse over `~/.codex/agents/*.toml` | Broken TOML |
| Skeptical mirrors in sync | manual diff of material sections vs brief | Reintroduced drift |
| hr-officer dispatchable + contract-conformant | fresh-session dispatch against seeded log | Charter unusable in practice |
| Repo gates | `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors) | Collateral breakage |

## Rollout, observability, and rollback

- Release sequence and gates: single commit on the working branch; merges to `main` with routine work. No deploy — nothing ships to Vercel behavior.
- Signals proving success: worklog accrues entries in subsequent cycles; HR's per-cycle reports reference real entries.
- Stop conditions: HR reports are noise (manufactured findings) or logging overhead exceeds value → drop the gate line from CLAUDE.md, keep the log.
- Rollback: revert the commit; delete the two `hr-officer` files; strip trailer sentences (single grep).
- Restoration verification: agent list next session lacks `hr-officer`; gates still pass.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| HR authority | Propose-only | Keeps roster deliberate; matches global no-duplicate-agents rule | Adoption needs one human step | Frank (2026-08-06) |
| Log home | Tracked `.agents/log/worklog.jsonl` | Survives clones; HR reads in-context; Codex sandbox can write it | Commit noise per cycle | Frank (2026-08-06) |
| Cadence | End of each cycle, advisory | Freshest recruiting signal; short-circuit keeps small cycles cheap | One dispatch per cycle | Frank (2026-08-06) |
| Name | `hr-officer` | Requested HR naming; unambiguous | — | Frank (2026-08-06) |
| Mechanism | Convention-only | Cross-platform, zero moving parts, self-healing via HR | Coordinator can forget (HR flags it) | Frank (2026-08-06) |
| Log writer | Coordinator appends | 5/7 agents physically cannot write | Trailer parsing is informal | plan |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| Codex auto-registers new `.toml` agents | HR unavailable on Codex side | First Codex session after delivery | Check Codex agent registry docs/config |
| Coordinators (Claude + Codex) follow CLAUDE.md/AGENTS.md logging rule | Sparse log starves HR | First HR review | Strengthen wording; consider hook (out of scope now) |
| One coordinator per repo at a time | Interleaved appends | Ongoing | JSONL union-merge makes this benign |

## Open questions

None blocking. (Resolved: the AGENTS.md mirror question — the repo-root `AGENTS.md` carries the same "Agent skills" section as CLAUDE.md; step 1 mirrors the paragraph there.)

## Handoff

- Prerequisites supplied to later plans: none — self-contained.
- Outputs promised to later plans: worklog convention reusable by any future automation (validator, hooks) if ever justified.
- Adversarial review order: single plan, one round (standard risk).
- Implementation authorization: **not granted by this plan**

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
