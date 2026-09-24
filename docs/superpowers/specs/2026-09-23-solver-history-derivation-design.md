# Spec: the solver's fairness history, derived on the server

## Status

**APPROVED** (digest `a6958d85…`; see the review log) — **risk tier CRITICAL**: it changes what the month solver, a production
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
| **R4** | **Window.** The history for a target month is exactly **the three calendar months before it**, one entry per month, oldest first — an entry with empty counts when a month has no weekend services. The target month and every later month are never counted | The solver uses three entries weighted by position; calendar alignment makes "most recent" mean the latest month, and fixes defects (c) and (d) | Solving November yields August, September, October in that order, whatever was written or solved before; solving January yields October, November, December of the previous year. Because three entries are always present, the solver's `history_runs_used` always reads 3 and the lead-pool panel's «Sin historial guardado» note can no longer fire — their copy changes with the cutover to say which months are empty, as does the «Historial» header's «últimas N ejecuciones usadas», since the entries become months rather than runs |
| **R5** | **Month assignment.** A service belongs to the calendar month of its own date — taken from the stored `YYYY-MM-DD` string (`week` for weekend roles), never through a `Date` object — which is its `America/Mexico_City` calendar date | Matches the planner; participation's week key would move month-end Saturdays | A 31 October Saturday counts in October |
| **R6** | **Counting rules unchanged** from `historyEntryFromDrafts`: the role keys, Saturday Chorus ignored, instruments and FOH never, `total_counts` as the sum, zero-seat members omitted, the entry shape and key format as today | The solver and its tests stay untouched | The equivalence test (R12) passes |
| **R7** | **Identity.** Members are keyed by their **current** `member_name`. A seat referencing a member who no longer exists is dropped and **reported** in the derivation's diagnostics, as are two members sharing a name, and **duplicate weekend targets** (two documents of one type on one date — an integrity state the read model already recognises), which are reported and **counted by neither copy** — the read model already treats such a target as ambiguous and counts neither (`serviceReadSelect.ts:19`), and the derivation must stay a deterministic function of the documents. After cutover the planner shows these diagnostics beside the history, not only on request. No ministry filter applies (the solver's pool is not a member-listing read — spec v2 I5) | The solver matches by name | A renamed member's past seats count under the new name; a dangling reference is reported, never counted |
| **R8** | **One source (H4).** A single pure derivation function in a neutral module (ADR-0028) turns role documents into entries; one **server-callable builder** (the read plus the derivation) produces the entries; the admin planner reaches it through one admin read route, guarded like `solver-config` (manager; content-editor refused), and P4's `solve_month` calls **the builder directly** — the MCP authenticates with a bearer token, not a session, so it cannot use the route | Two derivations would drift | No other path feeds a solve (the browser's `localStorage` write continues only as R15's rollback target) |
| **R9** | **Read compliance.** The read counts unpublished services, so its query is a **new** builder in `serviceReadQueries.ts` (the exempt home spec v2 I2 names, callable from P4) — never an operator script that reads Sanity, which would need an `OPERATOR_TOOLING_ALLOWLIST` entry; it adds no `MAY_SEE_DRAFTS` entry, runs on `operationalClient`, and changes no existing export of a writer-imported module | Spec v2 I1, I2; the roadmap's additive-only rule | `protectedReadAudit.test.ts` and `draftGatingCoverage.test.ts` pass unchanged in their lists |
| **R10** | **No write.** The derivation stores nothing; the history is derived on each request | Nothing to drift, nothing to migrate | No writer is added |
| **R11** | **Diff gate (H3).** Before any cutover, a read-only comparison of the derived history against Frank's exported production history, per month × member × role key, over the **union** of the export's months and the derived months in the windows compared. Every difference receives exactly one verdict from the evidence table below — **explained**, **unverified**, or **bug** — and a class is admitted only when its evidence holds; a label alone admits nothing. **Any `bug`, and any difference no class admits, blocks the cutover; the `unverified` total blocks it unless Frank accepts that total explicitly.** The same report runs the solve for at least one recent month with each history, the seed pinned and each side run twice (a time-limited search is not repeatable even with a fixed seed), and records `objective_skipped` for every run; where both sides skip the objective, the report says the difference is **not fairness-driven** — the two runs per side are the noise baseline that shows how far a seeded, time-limited search wanders on its own | Differences are expected by design; an unexplained one — or one explained only by a label — is a bug | A written report, kept **outside the repository** (it holds member names), that Frank reads |
| **R12** | **Equivalence for the untouched case.** For a month created by the planner and never edited, whose three prior months are likewise untouched and non-empty, the derived entry equals what `historyEntryFromDrafts` wrote | Proves the counting rules survived the change of source | A unit test whose documents are built with the create route's own `buildRoleDocument` from the same drafts — hand-built mirror documents would make it circular |
| **R13** | **Export procedure.** Frank exports his history from the **production origin** in the browser profile he plans in (DevTools: `copy(localStorage.getItem("owt_solver_history_v2"))`), per profile if he uses more than one, and from the iOS shell's own store if he has ever planned there; the export never enters git | The history is per origin and per profile | The procedure is written in the P2 plan and run by Frank |
| **R14** | **Cutover (H4) — Frank's decision.** After R11 is explained, Frank decides. On cutover the planner's solve, the `LeadPoolHistoryPanel` and the «Historial» display all read the derived history; the chips become **read-only** (deleting a derived month would mean nothing) — which removes Frank's manual month exclusion, so it is part of what he decides at cutover; `localStorage` is no longer read | The browser and the connector must never solve against different histories | No solve request is built from `localStorage`; a solve always carries the history derived **for its own target month, at solve time** — never a copy cached before an edit to a prior month in the same session — a test switches the month while the history is loading and then solves |
| **R15** | **Clean rollback.** Until the cutover is proven, the planner **keeps writing** `localStorage` as today, building each write from `localStorage`'s own contents — never from the in-memory history, which after cutover holds derived entries and would quietly replace the rollback target; rollback is a switch back to reading it. The switch is **deployment-wide**, never per browser — a per-browser switch would bring back the two-admins gap — and if it is an environment variable it gets a `docs/SECRETS.md` entry in the same change. `historyEntryFromDrafts` stays until the dual-write ends, and R12's equivalence test goes with it. The dual-write stops in a separate, later change once one real month has been solved and created on the derived history without rollback. After P4 ships, rolling back also withdraws `solve_month` | H4; the roadmap's P2 rollback | The P2 plan names the switch and the stop point |
| **R16** | **ADR (H2).** A new ADR amending ADR-0010, written before the diff runs: it ratifies the specials exclusion, records decision 1 (stored state) and decision 2 (prior-month drafts count), and records that the history is shared rather than per-browser, and records R11's `unverified` verdict as a stated narrowing of H3. ADR-0010's status becomes "Accepted, amended by ADR-NNNN"; `docs/DATA_MODEL.md` and the per-browser test change with the cutover | The reasoning is not obvious from code | The ADR is merged **before** the diff runs |
| **R17** | **Known limitation recorded.** The ADR and P2's review log record that the history influences the schedule only when the objective is not skipped (ADR-0038), and that fixing the ceiling is separate follow-on work **[D-2026-09-23]** | Otherwise P2 looks like a fairness fix it is not | Both say so; the approved roadmap is not edited for it |

### R11 — the diff gate's evidence

**Where the evidence comes from.** Every item below is read through the same compliant
path as the derivation: role documents through the canonical projection, which already
carries `creationReceiptId` and `creationFingerprint` (`app/utils/serviceReadQueries.ts:19`),
and creation receipts through a new additive builder in the same file, all on
`operationalClient`. The builder exposes them as **diagnostics** beside the entries, and
**computes every fingerprint comparison itself, on the server** — match or mismatch, under
`published` true and false — because the fingerprint code is server-only
(`app/utils/roleCreationReceipt.ts`) and a second implementation in a browser would drift.
The admin route returns the diagnostics on request; the comparison consumes them with
Frank's export and never reads Sanity itself.

**The fingerprint comparison has a positive control.** A round-trip test — create payload → stored document → payload rebuilt from the stored fields → fingerprint — must reproduce the stamped value, and the report states the match rate. Without it, a rebuild defect would read every document as changed and quietly turn every would-be `bug` into `unverified`.

**What a fingerprint can and cannot prove.** `creationFingerprint` hashes the whole create
payload — voices, instruments, FOH, date, name and publication state
(`roleCreationReceipt.ts:195-225`). A document whose recomputed fingerprint matches has
**stored seats equal to what was created**. A mismatch proves only that *something*
changed, not that the voice seats did.

**The verdict is decided in this order; the first rule that applies wins, and within a rule the first arm that applies wins.** Every
difference gets exactly one verdict: **explained**, **unverified**, or **bug**.

1. **A duplicate weekend target in the window** (two documents of one type on one date)
   gets the verdict **bug** and so **blocks the cutover** until it is resolved. R7 counts neither copy, so every difference
   around it would otherwise be unattributable.
2. **Month-level** — the month is on one side only:
   - the export entry's `(year, month)` is ≥ the target's, compared as numbers — never the
     unpadded key as a string ("2026-10" sorts before "2026-9") → *future*, **explained**;
   - the month is not one of the three before the target → *outside the window*, **explained**;
   - an in-window month is absent from an export holding six entries → *evicted or deleted*,
     **unverified** (a full export cannot tell eviction from a chip removal);
   - an in-window month is present in another export Frank supplied → *another browser or profile*, **explained**;
   - an in-window month is absent from an export holding fewer than six, while the derived
     side has documents → *deleted by hand or never written*, **unverified** (absence alone
     cannot tell a chip removal from a write that failed).
3. **Entry-level** — the export's entry for the month:
   - holds **zero-count rows** → *pre-2026-07-30 raw-response entry*, **explained** for the
     whole month. Zero rows are the signature: entries written since commit `618097e1` come
     from `historyEntryFromDrafts`, which only ever counts upward and never writes a zero
     (`plannerModel.ts:1254-1282`), while earlier entries copied the solver's rows, zeros
     included. A name merely absent from the month's seats is **not** evidence — swaps and
     deletions produce it too, and rule 4 classifies those;
   - carries a key that is a raw `_id`, or no current member's name while a current name on
     the derived side carries exactly its counts → *rename or unknown id*, **explained** for
     that key. The remaining comparison uses current names.
4. **Document-level** — only inside a month the export holds as an ordinary create-mode entry:
   - a document with no receipt (which also means no fingerprint — the two have always been
     written together, since 2026-07-24), or whose receipt's fingerprint equals the fingerprint of an
     **empty-seat** payload for its target (stored mode's «+ Nuevo servicio») → *created
     outside create mode*, **explained**: the browser never recorded it;
   - a document whose receipt predates the latest create session for that month, where the
     export entry equals exactly the counts of the latest session's documents and **all** of
     those documents are unchanged → *partial-month overwrite*, **explained**; if a
     latest-session document has since changed, the earlier-session documents are
     **unverified** instead (the session boundary is the receipt `createdAt` grouping the P2
     plan pins);
   - a document whose fingerprint mismatches → *changed since creation*, **unverified**;
   - a `role_deleted` receipt whose target date is in the month → *deleted since creation*,
     **unverified** (its seats cannot be recovered);
   - a receipt whose target date is in the month while its role's current date is not →
     *moved out of the month*, **unverified**.
**Attribution is per cell.** Differences are counted per month × member × role key, and a document-level class explains only the counts that document actually contributes: when the derived count is higher, only documents that seat that member in that role can explain it; when the export's is higher, only a changed, deleted or moved document of the matching type in that month can. Whatever remains in the cell falls to rule 5.

5. **Residual.** A difference still unaccounted for after rules 1–4 — including one on a
   document that is unchanged, recorded in this export's session, and not explained above
   — is a **bug**. A difference traced to a special's seats is a **bug** (neither side counts
   specials).

**This narrows H3, and says so.** The roadmap's H3 asks for *every* difference explained.
The fingerprint cannot prove what changed inside an edited document, and deleted or moved
documents leave nothing to test, so R11 adds an **unverified** verdict that Frank accepts
or rejects as a total, by class. The ADR (R16) records this departure.

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

- Additive-only changes to writer-imported modules (roadmap P2 row) — including `plannerModel.ts`, which `app/utils/solverConfigWriteRequest.ts` imports; if P1 is in flight at the same time, whichever lands second rebases onto the other's changes to `serviceReadQueries.ts`.
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
| H3 narrowing | An `unverified` verdict Frank accepts or rejects as a total, by class | A fingerprint cannot prove what changed inside an edited document; deleted and moved documents leave nothing to test | Not every difference is individually proven | **Frank, at the diff** — approving this spec is not approving the narrowing |
| Chips | Read-only after cutover | A derived month cannot be meaningfully deleted | Frank loses the ability to exclude a month by hand | Frank, at cutover (R14) |

## Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| Frank's planning history lives on the production origin in one browser profile | The diff compares against the wrong history | Frank confirms which profile he plans in when exporting | Export each profile; diff each |
| The window's months have role documents (documents exist from June 2026) | Older windows are empty | The diff report shows it | Expected; empty entries are valid |
| The solve route can be called read-only for the R11 comparison | The objective comparison cannot run | P2 plan | Run the solver locally (`gcf/owt_solver_v2.py --json-mode`), which the solve route already supports |
| Production role documents in the compared windows mostly carry `creationFingerprint` (stamped since the guarded create route: committed 2026-07-24, deployed 2026-07-27 — the rules test whether a receipt exists, not its date) | More differences land in `unverified` | The diff report counts them | Frank accepts or rejects the `unverified` remainder explicitly (R11) |

## Open questions

None blocking.

## Acceptance and verification

| Requirement | Acceptance evidence | Verification method |
|---|---|---|
| R1, R5, R6, R7 | Derived entries on constructed documents | Unit tests of the pure function |
| R2, R3, R4 | Swapped month, all-draft month, calendar window with an empty month and a future month present | Unit tests |
| R8, R9, R10 | One route, guarded; lists unchanged | Route tests; the two guard suites |
| R11, R13 | The classified diff report — every difference with its verdict and the evidence that admitted it, the `unverified` total by class, `objective_skipped` for every run (seed pinned, each side twice) | Frank reads it before deciding; the diff consumes the builder's output or runs in Frank's browser, never a new Sanity-reading script |
| R12 | Equality with `historyEntryFromDrafts` | Unit test |
| R14, R15 | Cutover switch and rollback | Tests of both read paths; the stop point named in the plan |
| R16, R17 | ADR merged before the diff; the known limitation in the ADR and P2's review log | Code review |

## Terminal state

**APPROVED** at critical tier — two sequential fresh `APPROVED` verdicts on
byte-identical digest `a6958d85…`. Changes made after that approval are listed,
un-reviewed, in [`2026-09-23-solver-history-derivation-design-review-log.md`](2026-09-23-solver-history-derivation-design-review-log.md). Approval is not authorization to implement.
