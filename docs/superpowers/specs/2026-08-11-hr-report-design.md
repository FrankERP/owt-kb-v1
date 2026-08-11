# Design: /hr-report — the agent workforce performance report

Approved in conversation 2026-08-11. Risk tier: **standard** (machine-local skill,
optional doc-schema fields, charter paragraph, generated HTML reports; no production
writer, no code paths; fully reversible) — one cold approval required.

## Purpose

A periodic, graphic performance report over the agent worklog: dispatch and outcome
statistics, cost (tokens) and time once available, cycle activity, honest
underperformance, and evidence-cited awards (Agent of the Week/Month). Fun on
purpose; useful because every number is computed and every judgment is cited.

## Decisions (user, 2026-08-11)

| Decision | Choice |
|---|---|
| Worklog schema | Extend with optional `tokens` + `duration_ms`, coordinator-stamped from the dispatch result's usage block; historical entries untouched, charts show a "no data" era |
| Output | One themed HTML page: published as private artifact AND committed to `docs/agents/reports/<date>-<period>.html` |
| Invocation | `/hr-report [period]` — `week` (default), `month`, `quarter`, `all`, `since <date>`; on-demand only |
| Architecture | Script computes (deterministic, never hallucinated) · hr-officer judges (awards, PIP, assessment) · coordinator renders/publishes/commits |

## Components

1. **Schema extension** — `docs/agents/worklog.md` field table gains `tokens` (int,
   optional) and `duration_ms` (int, optional), stamped by the coordinator; one
   clause added to the global CLAUDE.md / Codex AGENTS.md worklog paragraphs so
   coordinators everywhere start stamping.

2. **`hr-report` skill** — canonical `~/.agents/skills/hr-report/SKILL.md` +
   `agents/openai.yaml`, symlinked into `~/.claude/skills/`. Steps:
   a. Resolve period → window (calendar arithmetic in repo timezone; window filters
      entries by `ts`; a cycle belongs to the window if any of its entries do).
   b. Compute stats with the skill's embedded python (reads JSONL, emits stats JSON):
      per-agent dispatches/outcomes/tokens/duration, per-cycle table, totals,
      coverage note for entries lacking token data.
   c. Dispatch `hr-officer` in **report mode** with the stats JSON and window.
   d. Render one self-contained, theme-aware HTML page (inline SVG charts; load the
      `dataviz` skill first **if available** — it is a feature-gated Claude built-in
      and absent on Codex, so degrade gracefully; no external assets):
      dispatches-per-agent bar, outcome-mix donut, cycle timeline, token/time charts
      when data exists, award cards, PIP section, HR's retrospective paragraph.
   e. Publish as artifact; write the identical file to
      `docs/agents/reports/<YYYY-MM-DD>-<period>.html`; commit **per the host
      repo's branching convention** (this repo: on a branch, merged periodically —
      never routine commits straight to main); log the dispatch (with
      tokens/duration — the new fields' first use).

3. **hr-officer report mode** — short charter addition (both platforms): when
   dispatched with a stats JSON for a performance report, use the provided numbers
   verbatim (never recompute). Report mode **bypasses the ≤2-entry short-circuit
   and the "since last hr-officer entry" window rule** — the window is supplied by
   the skill and may legitimately be small or overlap prior reviews. Return:
   STAFF REVIEW (per-agent, one line),
   AWARDS — headline *Agent of the {Week|Month|Quarter}* scaled to period (for
   `all` / `since <date>` windows HR coins the headline title itself), plus at
   most three commendations, each with an evidence citation (suggested menu:
   "Catch of the Period" for the finding that saved the most downstream pain,
   "Cold Read" for the best fresh-context judgment, "Iron Desk" for sustained
   workload, "Clean Hands" for an audit streak with zero misses, "First Ascent"
   for a capability proven live; HR may coin its own) — PIP (underperformance,
   played straight: plain, kind, tied to the existing retire/re-open trigger
   vocabulary; empty if nothing qualifies — never invented), and a one-paragraph
   retrospective. No award without a citation; no PIP entry without log evidence.

## Failure honesty

- No worklog in the repo → the report says so; definition-health-only mini report.
- hr-officer dispatch fails → stats-only report, marked as such; `no_result` logged.
- Missing token/duration data → shown as "not recorded before 2026-08-11", never
  interpolated.
- **Schema-invalid but parseable entries are always counted, never skipped**: missing
  `cycle` → a visible "(no cycle)" bucket; missing `platform` → "unknown"; outcomes
  outside the documented enum reported verbatim in an "other" slice; `ts` parsed as
  ISO-8601 with any offset (including `Z`) and bucketed in the repo timezone. Each
  deviation class gets a visible count in the report — deviations are hr-officer
  findings, never runtime errors (worklog.md), and dropping them would erase real
  work from the window. (Live log today: 4 entries lack `cycle`, 12 lack `platform`,
  4 carry `outcome:"success"`, 12 use `Z` timestamps — all counted.)
- Only unparseable lines are skipped, with a visible count, never repaired.
- No artifact-publishing mechanism (e.g. Codex) → the committed copy IS the report.
- Timezone for bucketing comes from the host repo's worklog convention doc, not a
  hardcoded zone.

## Non-goals

- No scheduling (on-demand only). No formula awards. No worklog rewriting. No
  repo-code dependency — the skill is self-contained and portable to any repo with
  a worklog.

## Verification

Inaugural report over `all` generated immediately after implementation: stats match
hand-checked counts; artifact renders in both themes; committed copy identical;
hr-officer's awards each carry a real citation; cycle closed with `finish-cycle`.
