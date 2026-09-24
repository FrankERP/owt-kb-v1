# Spec: the solver's fairness history, derived on the server

## Status

`DRAFT` — **risk tier CRITICAL**: it changes what the month solver, a production
writer's input, is told about the past. **Authorizes nothing.**

Child **P2** of [`2026-09-22-owt-mcp-roadmap.md`](../plans/2026-09-22-owt-mcp-roadmap.md)
(requirements H1–H4). It has no MCP dependency and changes the admin planner on its own.

## Original request

> "haz el plan de P0 y la spec de P2" — Frank, 2026-09-23.

Three decisions Frank made on 2026-09-23, each after its cost was stated:

1. **What counts as "served" is what is stored at the end**, after swaps and edits —
   not what the planner created.
2. **Services still in draft count, for months before the one being solved.** Months
   equal to or after it never count.
3. **P2 proceeds as scoped, with the objective-ceiling problem recorded as follow-on
   work** (see Evidence, row 1) — not fixed here.

## Outcome

- **Primary outcome:** one server-side derivation produces the solver's fairness history
  from Sanity role documents. The admin planner and, later, the MCP connector's
  `solve_month` both use it, so every admin and every surface solve against the same
  history.
- **Operator:** Frank (and any admin who uses «Generar mes»).
- **Problem today:** the history lives in each browser's `localStorage` as
  `owt_solver_history_v2`. Two admins, or two devices, solve against different histories
  (ADR-0010's named, out-of-scope gap), and the stored history is wrong in several ways
  the evidence below lists.
- **Success measure:** the derived history is diffed against Frank's exported production
  history with **every** difference explained; Frank decides the cutover; after it, no
  solve reads `localStorage`.

## Evidence

| Fact | Source | Planning implication |
|---|---|---|
| **The history only feeds the solver's objective, and the objective is skipped in most real months.** `build_history_offsets` weights the last three entries `[3, 6, 10]` (oldest → newest) into `ov_total`/`ov_r`, which appear only in objective terms; hard fairness limits use the current month alone. ADR-0038: one history entry pushes a four-week, every-Saturday month past CP-SAT's ceiling, two push the default shape — those months run **unoptimised** with `objective_skipped: true` | `gcf/owt_solver_v2.py:84,492-527,870,918,1052-1093`; `docs/adr/0038-*.md:59-66,120-127` | In steady state the history changes nothing about the schedule today. P2's value is one source of truth and parity for the connector; the diff must record `objective_skipped` for every case. Fixing the ceiling is follow-on work (decision 3) |
| A more complete history makes skipping **more** likely, because larger offsets grow the objective's limits | `gcf/owt_solver_v2.py:858-859,908-909,1043-1046` | The diff must show whether derived history changes how often the objective is skipped |
| Entry shape: `{ key: "YYYY-M" (not zero-padded), year, month, total_counts: {name: n}, role_counts: {name: {roleKey: n}} }`; the solve request carries only `{ total_counts, role_counts }` per entry | `app/components/admin/plannerModel.ts:294-300,828-831`; `app/api/admin/solve/route.ts:17-20` | The derivation produces this exact shape — the solver does not change |
| Counting today (`historyEntryFromDrafts`): Sunday `Lead`/`BGVs`/`Chorus` → `Sun.Lead`/`Sun.BGV`/`Sun.Choir`; Saturday `Lead`/`BGVs` → `Sat.Lead`/`Sat.BGV`, **Saturday Chorus ignored**; specials count nothing; instruments and FOH never; `total_counts` = the sum of that person's role counts; zero-seat people omitted | `plannerModel.ts:1205-1212,1238-1240,1254-1282` | Counting rules are kept exactly; only the *source* and the *time* change |
| People are keyed by `member_name`; the solver matches history by name and silently drops names not in the request | `plannerModel.ts:581-583`; `gcf/owt_solver_v2.py:501,519-525` | Keep name keys; use each member's **current** name, so renamed members stop losing their history |
| **Defects of today's history.** (a) It is written only on a create-mode confirm, from the drafts that dialog session created — confirming the rest of a month in a later session **replaces** the whole month's entry. (b) Later swaps and stored-mode edits are never reflected. (c) `historyForRequest` excludes only the month being solved, so **future months can feed the solver**. (d) Eviction keeps the six most recently *written* entries, not the six latest months. (e) Entries written before 2026-07-30 recorded the raw solver response, including zero rows. (f) A «Historial» chip can delete any entry with no confirmation | `MonthGenerator.tsx:1516-1537,1700,1885-1909,3343-3348`; `plannerModel.ts:626-630`; commit `618097e1` | Decision 1 (stored state) fixes (a), (b) and (e); calendar windows fix (c) and (d); the chips become read-only |
| Role documents: weekend services store their date in `week`, specials in `date`; seats are references `Lead[]`, `BGVs[]`, `Chorus[]`; `published` may be absent on older documents; Sanity `drafts.*` overlays are excluded by the published perspective | `roleWriteRequest.ts:177-179`; `sanity/schemas/sunRole.ts:32-37,45-129`; `satRole.ts:118`; `sanity/lib/operationalClient.ts:16-23` | The derivation reads canonical documents only; the app's draft state is the `published: false` field |
| No month- or date-range role query exists; the admin roles GET returns every role, unpublished included, and drops references to deleted members | `app/utils/serviceReadQueries.ts:64-69,168-181`; `app/api/admin/roles/route.ts:64-81` | A new, additive read is needed |
| Draft gating exempts only `api/admin/**` and `utils/serviceReadQueries.ts`; `serviceReadQueries.ts` is imported by production writers | `app/utils/__tests__/draftGatingCoverage.test.ts:96-104`; grep | Counting drafts means the read lives in one of those two places, and any change to `serviceReadQueries.ts` is additive only |
| `computeParticipation` assigns a Saturday to the following Sunday's week, so a month-end Saturday can land in the next month; the browser uses the service's own calendar month | `app/utils/computeParticipation.ts:40-43`; `MonthGenerator.tsx:316-326` | The derivation assigns by the service's own date in Mexico City, not by participation's week key |
| Reading through `operationalClient` needs no audit registration; admin read routes use `requireActiveManager` and refuse content-editors (`solver-config`'s `gate()`) | `app/utils/protectedReadAudit.ts:73`; `app/api/admin/solver-config/route.ts:58-64` | The derived-history route follows the same guard |
| History is also read by `LeadPoolHistoryPanel` (previous month's leads) | `app/components/admin/leadPoolHistory.ts:88-99`; `MonthGenerator.tsx:1493,3774` | It switches to the derived source at cutover too |
| The stored history is per origin and per browser profile; the iOS shell has its own; the export contains full member names, and this repository is public | `MonthGenerator.tsx:1885-1888`; `capacitor.config.ts:28` | The export for the diff is taken from the production origin in Frank's planning browser and never committed |
| Documents and a test pin today's per-browser behaviour | `docs/adr/0010-*.md:119-122`; `docs/DATA_MODEL.md:331-332`; `app/components/admin/__tests__/solverConfigSource.test.ts:304-313` | They change with the cutover |

## Requirements

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| **R1** | **Source.** The history is derived from canonical `sunday_role` and `saturday_role` documents. `special_role` is never counted | ADR-0010 Decision 3 keeps specials out of the solver's history on purpose (H1) | A special in the window changes nothing in the derived entry |
| **R2** | **Stored state.** Each seat counts the member **stored in it at derivation time** — after every swap, edit and stored-mode change **[D-2026-09-23]** | What happened, not what was first proposed | A month created by the planner, then swapped, derives the post-swap counts |
| **R3** | **Drafts.** A service in a counted month counts whether published or not; a missing `published` field is irrelevant **[D-2026-09-23]** | A month planned but not yet published is still assigned duty the next month must weigh | An all-draft prior month counts in full |
| **R4** | **Window.** The history for a target month is exactly **the three calendar months before it**, one entry per month, oldest first — an entry with empty counts when a month has no weekend services. The target month and every later month are never counted | The solver uses three entries weighted by position; calendar alignment makes "most recent" mean the latest month, and fixes defects (c) and (d) | Solving November yields August, September, October in that order, whatever was written or solved before |
| **R5** | **Month assignment.** A service belongs to the calendar month of its own date (`week` for weekend roles) in `America/Mexico_City` | Matches the planner; participation's week key would move month-end Saturdays | A 31 October Saturday counts in October |
| **R6** | **Counting rules unchanged** from `historyEntryFromDrafts`: the role keys, Saturday Chorus ignored, instruments and FOH never, `total_counts` as the sum, zero-seat members omitted, the entry shape and key format as today | The solver and its tests stay untouched | The equivalence test (R12) passes |
| **R7** | **Identity.** Members are keyed by their **current** `member_name`. A seat referencing a member who no longer exists is dropped and **reported** in the derivation's diagnostics, as are two members sharing a name. No ministry filter applies (the solver's pool is not a member-listing read — spec v2 I5) | The solver matches by name | A renamed member's past seats count under the new name; a dangling reference is reported, never counted |
| **R8** | **One source (H4).** A single pure derivation function in a neutral module (ADR-0028) turns role documents into entries; one server read feeds it; one admin read route exposes it, guarded like `solver-config` (manager; content-editor refused). The admin planner and, later, `solve_month` both use that route's result | Two derivations would drift | No other code path produces a history |
| **R9** | **Read compliance.** The read counts unpublished services, so it lives under `api/admin/**` or as a **new** builder in `serviceReadQueries.ts`; it adds no `MAY_SEE_DRAFTS` entry, runs on `operationalClient`, and changes no existing export of a writer-imported module | Spec v2 I1, I2; the roadmap's additive-only rule | `protectedReadAudit.test.ts` and `draftGatingCoverage.test.ts` pass unchanged in their lists |
| **R10** | **No write.** The derivation stores nothing; the history is derived on each request | Nothing to drift, nothing to migrate | No writer is added |
| **R11** | **Diff gate (H3).** Before any cutover, a read-only comparison of the derived history against Frank's exported production history, per month × member × role key, with **every difference classified**: stored-vs-created (swaps, edits), months never created in create mode, a partial-month overwrite, a pre-2026-07-30 raw-response entry, a rename or unknown id, a special, a future month, a month outside the calendar window. **Any unclassified difference blocks the cutover.** The same comparison runs the solve for at least one recent month with each history and records `objective_skipped` and the schedule difference for both | Differences are expected by design; unexplained ones are bugs | A written report, kept **outside the repository** (it holds member names), that Frank reads |
| **R12** | **Equivalence for the untouched case.** For a month created by the planner and never edited, whose three prior months are likewise untouched and non-empty, the derived entry equals what `historyEntryFromDrafts` wrote | Proves the counting rules survived the change of source | A unit test on constructed documents |
| **R13** | **Export procedure.** Frank exports his history from the **production origin** in the browser profile he plans in (DevTools: `copy(localStorage.getItem("owt_solver_history_v2"))`), per profile if he uses more than one; the export never enters git | The history is per origin and per profile | The procedure is written in the P2 plan and run by Frank |
| **R14** | **Cutover (H4) — Frank's decision.** After R11 is explained, Frank decides. On cutover the planner's solve, the `LeadPoolHistoryPanel` and the «Historial» display all read the derived history; the chips become **read-only** (deleting a derived month would mean nothing); `localStorage` is no longer read | The browser and the connector must never solve against different histories | No solve request is built from `localStorage` |
| **R15** | **Clean rollback.** Until the cutover is proven, the planner **keeps writing** `localStorage` as today; rollback is a switch back to reading it. The dual-write stops in a separate, later change once one real month has been solved and created on the derived history without rollback. After P4 ships, rolling back also withdraws `solve_month` | H4; the roadmap's P2 rollback | The P2 plan names the switch and the stop point |
| **R16** | **ADR (H2).** A new ADR amending ADR-0010, written before the diff runs: it ratifies the specials exclusion, records decision 1 (stored state) and decision 2 (prior-month drafts count), and records that the history is shared rather than per-browser. ADR-0010's status becomes "Accepted, amended by ADR-NNNN"; `docs/DATA_MODEL.md` and the per-browser test change with the cutover | The reasoning is not obvious from code | The ADR merges no later than the diff |
| **R17** | **Known limitation recorded.** The ADR and the roadmap record that the history influences the schedule only when the objective is not skipped (ADR-0038), and that fixing the ceiling is separate follow-on work **[D-2026-09-23]** | Otherwise P2 looks like a fairness fix it is not | Both documents say so |

## Scope

### In scope

- The derivation function, the server read, the admin read route.
- The diff tooling and report, the export procedure, the ADR.
- The planner's cutover (solve, lead-pool panel, read-only chips) behind Frank's decision,
  with the dual-write kept until the stop point.

### Non-goals

- **The objective ceiling** (ADR-0038's follow-on). Decision 3.
- Changing the decay weights, the three-entry window the solver uses, or which roles
  count (instruments, FOH, Saturday Chorus).
- Kids. Specials in the solver.
- Storing a history anywhere.
- Anything in the MCP connector — P4 consumes this later.

## Behavior and invariants

- **Required:** the derived history for a target month is a pure function of the role
  documents stored for the three prior calendar months and the current member names.
- **Preserved:** the solver, its request shape, its counting rules and its tests; the
  planner's behaviour until Frank's cutover; every guard list (audit registries, draft
  exemptions) unchanged in content.
- **Security:** the route is admin-only (content-editor refused, as the solve and the
  rule set are); it reads through `operationalClient`; the export and the diff report hold
  personal data and never enter the public repository.
- **Timezone:** month membership by `America/Mexico_City` calendar date, never UTC.
- **Failure:** if the derived history cannot be read, the planner reports it and does not
  solve with an empty history silently — the same "absent vs failed" distinction ADR-0010
  draws for the rule set. An empty history because the window genuinely has no services is
  valid and is shown as such.

## Dependencies and constraints

- Additive-only changes to writer-imported modules (roadmap P2 row).
- Solver untouched; `gcf/**` untouched.
- The P2 plan (standard tier) follows this spec; the ADR is part of it.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| What counts | Stored state at derivation time | What happened; fixes three defects of today's history | Differs from today's history; the diff must explain it | Frank, 2026-09-23 |
| Drafts | Prior-month drafts count; target and later months never | A planned month is assigned duty; future months must never leak in | A month planned but later abandoned counts until its services are deleted | Frank, 2026-09-23 |
| Objective ceiling | Out of P2; recorded as follow-on | Keeps one behaviour change per delivery | History stays mostly inert until the follow-on ships | Frank, 2026-09-23 |
| Window | Three calendar months, empty entries allowed | The solver weights by position; calendar alignment makes recency mean the latest month | An empty month takes one of the three slots | this spec |
| Names | Current `member_name` | The solver keys by name; current names survive renames | Two members with one name merge in the solver — reported, not fixed here | this spec |
| Chips | Read-only after cutover | A derived month cannot be meaningfully deleted | Frank loses the ability to exclude a month by hand | this spec |

## Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| Frank's planning history lives on the production origin in one browser profile | The diff compares against the wrong history | Frank confirms which profile he plans in when exporting | Export each profile; diff each |
| The window's months have role documents (documents exist from June 2026) | Older windows are empty | The diff report shows it | Expected; empty entries are valid |
| The solve route can be called read-only for the R11 comparison | The objective comparison cannot run | P2 plan | Run the solver locally (`gcf/owt_solver_v2.py --json-mode`), which the solve route already supports |

## Open questions

None blocking.

## Acceptance and verification

| Requirement | Acceptance evidence | Verification method |
|---|---|---|
| R1, R5, R6, R7 | Derived entries on constructed documents | Unit tests of the pure function |
| R2, R3, R4 | Swapped month, all-draft month, calendar window with an empty month and a future month present | Unit tests |
| R8, R9, R10 | One route, guarded; lists unchanged | Route tests; the two guard suites |
| R11, R13 | The classified diff report, including `objective_skipped` per case | Frank reads it before deciding |
| R12 | Equality with `historyEntryFromDrafts` | Unit test |
| R14, R15 | Cutover switch and rollback | Tests of both read paths; the stop point named in the plan |
| R16, R17 | ADR merged; roadmap note | Code review |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
