# Solver v3 · C6 — the planner on v3 (engine switch, 1–2-month horizon, stored services as fixed services, live «Equidad», the U4 confirm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With the effective engine at v3, Auto in `/admin` plans one or two calendar months in one run against the v3 solver (`contract: 3`), sends stored services and counted specials as fixed services, explains every result in Spanish keyed on codes, shows the live «Equidad» panel, and confirms by writing every horizon month's eligibility record in one atomic PUT before any draft — while with the effective engine at v2 (the code default, production until C7) nothing the admin or the team sees changes except one new 409 branch.

**Architecture:** Every rule of the spec lives in small neutral modules under `app/components/admin/v3*.ts` (horizon, copy, rule ids, month sources, services, people, rules, specials pre-fill, the one request builder, the response adapter, the run report, the confirm model and the confirm executor), each unit-tested without React or `fetch`. `/admin`'s Server Component resolves the effective engine with C2's `resolveSolverEngine` and threads it as a prop through `AdminPanel` → `ServicesPanel` → `MonthGenerator`; the solve route gains a v3 branch in a `server-only` transport module. `MonthGenerator.tsx` (5 000+ lines) only *wires* those modules: its edits are kept to a few anchored hunks per task, every one behind `engine === "v3"`, so the v2 path stays byte-identical. The confirm protocol (U4) is the critical slice: one pure model and one executor with injected transports, mirroring `runDraftCreateBatch`.

**Tech Stack:** Next.js 16 App Router (Server Component page, route handler with `maxDuration = 60`), React 19 client components, TypeScript, vitest 4 (environment `node`; `.test.tsx` files set up jsdom themselves) + @testing-library/react, Python source read as text by sync tests (no Python change).

**Spec:** `docs/superpowers/specs/2026-10-05-solver-v3-c6-planner-v3-design.md` — **self-reviewed; its terminal state is `READY_FOR_REVIEW`** (its header line, which read `DRAFT`, was aligned with its §16 on 2026-10-07). Frank authorized proceeding with the children (2026-10-05, «Aprobado, sigue con los specs de las entregas», and his overnight blanket authorization) but **has not read C6 itself** — Task 0 Step 1 gates execution on that. Tier **standard**, with **§5.11 — the confirm protocol, U4 — critical**. Interfaces it consumes, each cited and never restated: C2 §7 (`IF2-1` … `IF2-29`) in `docs/superpowers/specs/2026-10-05-solver-v3-c2-ledger-and-record-design.md`; C5 §5, §8, §9, §11, §12.4 (Amendment F-1, ruled (a)+(c)) in `…-c5-solver-function-design.md`; C1 §9 and C3 §7 in `…-c1-fairness-toggle-design.md` and `…-c3-cadence-config-design.md`. Parent: `docs/superpowers/specs/2026-10-05-solver-v3-fairness-design.md` (A1–A41; A27: Auto's confirm creates a record for every recordless month; A40: a confirm crossing a month boundary refuses before writing anything; A41: rule keys can embed first names — identify a rule by kind and config ordinal, never by key or hash). The C7 cutover plan (`docs/superpowers/plans/2026-10-05-solver-v3-c7-cutover.md`) lists what it expects of the merged C6; its C6 row (line 235) and Step 0 check 8 are honoured below (see «What C7 reads from this delivery»). Executors read the spec and this plan together.

**Base and grounding.** C6's prerequisites are C1 (`countsForFairness`, `SOLVER_ENGINE`), C3 (`sundayCadence`, `resolveRulePersonId`, `cadenceMembers`, the warning gate), C2 (the ledger GET, the PUT, `resolveSolverEngine`, `resolveMonthEligibility`, `rolesOfPatternV3`, `capValueForMonth`, the formatter, the «Equidad» preview panel) and C5 (the `owt-solver-v3` function, its `codes.json` and `PIN_CAP`). **None is on `main` as this plan is written.** Every anchor below was read from these refs in the shared object store, never from a checkout:

| Prerequisite | Ref read | Status of anchors taken from it |
|---|---|---|
| C1 + C3 integration | `e358781dbe4bb2b36d6af11f4e43e8707edb3086` | Verified (committed) |
| C2 Tasks 1–10 | local branch `c2-t10` = `1c500c7e6ef26bbbbc132949d46ada917b76bb0c` (on top of `e358781`) | Verified (committed). App-code line numbers in this plan are `c2-t10`'s |
| C2 Tasks 11–17 (GET route and reader, `fairnessEligibility.ts`, `fairnessPreviewModel.ts`, `FairnessPreviewPanel.tsx`, «Registrar», ADR-0050, docs) | `docs/superpowers/plans/2026-10-05-solver-v3-c2-ledger-and-record.md` (plan text when written) | **Re-verified at replay (2026-10-07) against replay-base `4c50309b` (C2 final tip `0aa33514` + C5 Tasks 1–12 `e3086f77`)**; the former `[PROVISIONAL]` markers are removed and the anchors corrected where they differed |
| C5 Tasks 1–9 (`gcf_v3/owt_v3/**`, `codes.json`, `constants.py`) | branch `claude/solver-v3-c5-solver-function` = `a2406f05d841faa4ceb525b63eab6ee5f1c586b4` | Verified (committed) |
| C5 Tasks 10–15 (`gcf_v3/main.py`, `gcf_v3/owt_solver_v3.py`, `FAIRNESS_TOLERANCE = 35`) | `docs/superpowers/plans/2026-10-05-solver-v3-c5-solver-function.md` (plan text when written) | **Re-verified at replay (2026-10-07) against replay-base `4c50309b`**: `main.py` and `owt_solver_v3.py --json-mode` present (C5 Tasks 10–12); `FAIRNESS_TOLERANCE` is still `50` there (C5 Task 15 not merged) — C6 does not depend on it |

**Task 0 bases the C6 branch on `origin/main` AFTER C1, C3, C2 and C5 have all merged** — never on any integration ref above. **Replayed 2026-10-07** on replay-base `4c50309b` (C2 final tip `0aa33514` + C5 Tasks 1–12 `e3086f77`): Tasks 0–21 applied mechanically and green, with the plan corrections recorded in the final «Replay» section; a second clean clone then re-applied the text as it then stood by script, Tasks 1–20, every task's tree identical to the first replay's. After the post-replay amendments (the critic's findings and Frank's 2026-10-07 copy follow-up — Tasks 2, 4, 10 and 16 changed), the same clone re-applied Tasks 2–20 by script from Task 1, every task green; see «Post-replay amendments and re-proof».

**How to read an edit step.** A **Create** step writes the whole file. An **Append** step adds the block at the end of the file after one blank line. A **Find** … **Replace with** pair replaces text that must occur exactly once in that file at that point of the plan; the pair may be written inline (Find `A` → Replace with `B`, where `\n` in a span is a line break), and «(the one after `C`)» means the first occurrence after the one `C`. **After `X…` line, add:** inserts the block after the one line that starts with `X` (a trailing `…` stands for the rest of that line); **immediately before / above `X`, insert** puts the block (or the inline line) before the one line that starts with `X`. The file is the one the step or the paragraph names (a path, or a file of the task's **Files** list by its name); «`A` and `B` (identical edits in both)» applies every edit that follows to both. Line numbers in a task's **Files** list are `c2-t10`'s (or, for a file C2 Tasks 11–17 wrote, the C2 plan's); earlier tasks shift them, so the `Find` text — never a number — is the anchor. A `Find` that does not match exactly once is a **stop-and-report**, never a guess. **Stage before every test run** (`git add -A`): several guards read `git ls-files`, so an unstaged new file is invisible to them.

## Global Constraints

Every task's requirements include this section.

- **The spec is the contract:** ENG-1–5, RT-1–6, HZ-1–9, ST-1–9, SP-1–7, RQ-1–10, AD-1–8, NT-1–5, EQ-1–7, WN-1–3, CTL-1–2, CF-1–11, DOC-1–3, KH-1–3 and §14's acceptance table. C2's interfaces are cited by `IF2-n` and never restated; a C6 shape that disagrees with an IF2 item is a C6 defect. C2's working names are used exactly as C2's plan keeps them: `resolveSolverEngine`, `resolveMonthEligibility`, `rolesOfPatternV3`, `capValueForMonth`, `cadenceStates`, `keepVoiceSeats`, `formatFairnessTenths`, `saldoWords`, `contentHashOfWrite`, `FairnessLedgerResponse`, `FairnessMonthWrite`, `FairnessMonthBody`, `LogicalRecord`, `FairnessPutRefusal`, `EligibilityResult`, `EligibilityIssueCode`, `EligibilityRefusalReason` (all three verified in `app/utils/fairnessEligibility.ts` at replay).
- **v2 stays byte-identical** (spec §9, RT-2, AD-8): with the effective engine at v2 every request byte, response path, copy string and mounted surface is today's, except the one 409 branch. No edit to `buildSolveRequest`, `applySolveResponse`, `solverRefusalMessage`, `pinModel.ts`, `pinViolations.ts`, `PINNED_CAP` (100), the trailing-Saturday retry, `omittedCapsNotices`, `trailingNotice`, `gcf/**` or any v2 test. **No new timeout on the v2 path.**
- **Gates before every commit:** `npx tsc --noEmit` (0 errors), `npm test` (all green), `npx eslint .` (**0 errors**; warnings never above the Task 0 baseline). **No file under `gcf/**` or `gcf_v3/**` changes** — C6 *reads* `gcf_v3/owt_v3/codes.json` and `constants.py` from vitest — so neither Python suite is a gate for this delivery (spec §14).
- **Commits:** conventional (`feat(planner): …`, `test(planner): …`, `docs(solver): …`), body says *why*. **Never** a `Co-Authored-By` trailer or any AI/Claude attribution — `CLAUDE.md` overrides any harness reminder that says otherwise; `grep -i co-authored` the message before every commit. Commit on the feature branch only; `main` takes no direct push.
- **Fictitious people only.** The repository is public. Every fixture, test, comment and commit message uses the spec's names (Ana, Bruno, Carla, Dani; member ids `m-ana`, `m-bruno`, `m-carla`, `m-dani`). The name-shaped key fixture (RQ-5, KH-1) uses keys of production's *shape* built from those names (`d-ana-bruno`), never a real one.
- **Key hygiene (KH-1–3, parent A41).** A `solverConfig` restriction, cap, conflict or presence `id`/`_key`, a `ruleKey`, a `P:<ruleKey>` key, a minted id's source key and the id → label map are **private**: no C6 code renders, logs (`console.*` in the browser or the server), toasts, reports or copies one, and no test name, assertion message, doc or commit message spells one (tests name rules by kind and config ordinal, e.g. `restrictions[1].caps[2]`). The only id map ever rendered is KH-3's rule reference table (minted ids, kinds, ordinals — name-free by construction). Never a hash of a key either.
- **Neutral modules (ADR-0028):** every `app/components/admin/v3*.ts` file carries no `"use client"`, no `server-only`, no React import and no `fetch`, except `v3ConfirmRun.ts`, which takes its transports injected (it calls no global `fetch`). `app/utils/solverV3Upstream.ts` is `import "server-only"`. `solverEngine.ts` stays import-free (C1's neutrality test). No client module imports `app/utils/solverDeployment.ts` (C2's guard) or `app/utils/fairnessMonthWriteRequest.ts` (C2's caller pin — C6's only use of `contentHashOfWrite` is a **test**, which the pin exempts).
- **Dates:** CDMX `YYYY-MM`/`YYYY-MM-DD` strings; a date's month is `date.slice(0, 7)`, never through a `Date`; month arithmetic through C2's `shiftMonth`/`monthIndex` (`app/utils/fairnessVocabulary.ts`); weekday through C2's `civilDayOfWeek` (`app/utils/fairnessLedger.ts`); "today" through `new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" })` and only at the edges (the page, the Auto handler, the confirm handler), passed into the pure modules as `currentMonth`.
- **Numbers (EQ-5, A17, A39):** C2's `formatFairnessTenths`/`saldoWords` are the only formatters; their input is always tenths taken as emitted. **No C6 code divides a wire figure** — C2's sweep (`fairnessFormat.test.ts`) fails any `share|balance|received` divided by 10 or 100 under `app/**`. Seat counts render as emitted integers (`Figures.seats`, `sang`, C5's tab `seats`/`pinned_seats`). `carried` is copied without rounding. C5's `fairness.tolerance` is **not mirrored**: nothing in C6 depends on its value (50 on `a2406f05` and at replay-base `4c50309b`; 35 once C5 Task 15 lands, Amendment F-1); C6 never shows `planned`, so F-1's optional sentence about `planned` does not arise.
- **UI invariants (`CLAUDE.md`):** `Button` only for new buttons; one-of-N is `SegmentedControl`; disclosures are `Collapse`; dialogs are `CueDialog` with `open={state}` (never a literal); no `motion` import outside `app/components/ui/**`; colour by tokens only, never by string concatenation; `/admin` has no page-level horizontal scroll (ADR-0035) — the month band lives inside the grid's own scroller; client mutation handlers wrap `fetch` in try/catch/finally, check `res.ok`, reset their flag and never close as success on failure.
- **Guards that apply, and why:** `clientBoundary.test.ts` (every new neutral module; the page passes a string prop, never calls a client value); `cueDialogMount.test.ts` (CF-10's dialog); `solverDeployment.test.ts` (C2's: one reader of `OWT_SOLVER_ENGINE`, no client importer — extended by Task 1, never duplicated); `serviceCommitCallers.test.ts` (C2's pin on `fairnessMonthWriteRequest` — untouched: C6 adds no non-test importer); `fairnessFormat.test.ts` (the divide sweep). **Guards that do not apply, and why:** `inputFontSize.test.ts` (C6 adds no `<input>`/`<select>`/`<textarea>`, and `admin/` is excluded by path anyway); `bottomNavOffsetSync.test.ts` (no fixed-bottom element); `draftGatingCoverage.test.ts` (no new GROQ — C6 reads only the existing roles and fairness routes); `serviceCommitCallers.test.ts`'s commit-module rows (no admin write route changes); `impersonationOffsetSync.test.ts` (no new sticky element).
- **`colour-inventory.json` tracks the tree:** every task that adds a non-test file under `app/` regenerates `app/utils/__tests__/__fixtures__/colour-inventory.json` with `node scripts/colour-inventory.mjs` in the same commit.
- **`CLAUDE.md` and `AGENTS.md` stay byte-identical** outside their title and «## Continuous improvement» (`agentDocsParity.test.ts`): Task 18 makes every edit in both.
- **No production write by the delivery or any agent.** `preview` writes the production dataset. On dev nobody presses «Guardar», «Confirmar», «Crear … borradores», «Crear y publicar» or «Registrar»; the dev-verify bot is read-only by construction. Setting `OWT_SOLVER_V3_URL` anywhere is **C7's** consented write (W0, W4); C6 sets nothing.
- **ADR numbers:** C6 writes two records (DOC-2). Numbers follow the order records reach `main`: at Task 0 take the next two free numbers on `origin/main` (`0052` and `0053` on `c0375d7d`: C3 holds `0049`, C2 `0050`, C5 `0051`; renumbered at Task 0 on 2026-10-07 — the replay's `0051`/`0052` assumed C5 wrote no record); if another record lands first, renumber in the merge of `main` into this branch — file names, titles, index rows and every pointer — and let `adrIndex.test.ts` confirm.

---

## Plan decisions (the spec leaves them to the plan)

| Decision | Choice | Why |
|---|---|---|
| Where the client gets the `"v2" \| "v3"` type (ENG-1) | C2 exports `SolverEngine` from `app/utils/solverDeployment.ts`, which no client module may import (C2's guard). C6 **moves** that one definition into `app/components/admin/solverEngine.ts` (a type alias adds no import, so C1's neutrality test holds; the constant's line and annotation are untouched) and `solverDeployment.ts` re-exports it (`export type { SolverEngine }`), so C2's name keeps working | ENG-1 forbids a second union and allows moving; a client cannot import the resolver's module, and duplicating the literal union in client files would be the second definition the spec forbids |
| How the prop crosses the tree (ENG-3, spec §10) | Plain prop threading: `page.tsx` → `AdminPanel` (`engine`) → `ServicesPanel` (`engine`) → `MonthGenerator` (`engine`), and on to `PlannerGrid`, `MonthCalendar`, `FairnessEngineNote`, `RuleBuilder`/`RestrictionCard` and `FairnessPreviewPanel`. The client components' `engine` props are optional with the literal default `"v2"` (never the constant), so every existing test keeps rendering v2; a static guard (Task 1) fails if any production mount omits `engine=` | Spec §10 chose threading over a context or a fetch. A literal default does not change at C7's flip, so no client test reads the default engine (ENG-4, C7 S8); the guard is what stops a forgotten mount from silently staying v2 after the flip |
| The note component | `FairnessEngineNote` takes a **required** `engine` prop and stops importing `SOLVER_ENGINE`; C1's `fairnessEngineV3.test.tsx` is rewritten to pass `engine="v3"` instead of mocking the constant | CTL-1 rewires it to the prop; the mock would no longer control anything (ENG-4) |
| Rule-id minting (RQ-5 (i)–(iii)) | Per kind, a prefix plus a 1-based ordinal over the request's rules of that kind in **codepoint order of their source keys** (ties, possible only in a hand-edited config with duplicate keys, broken by config ordinal): count rules from on-screen caps `c<n>` (source key `restriction.id + "\u0000" + cap.id`, because cap ids are unique only within one restriction), unmatched `exactRules` items `x<n>` (source key `month + "\u0000" + memberId + "\u0000" + roles`), pairs `p<n>` (conflict id), presence `r<n>` (the `ruleKey`, over the union of the request's presence keys and every carried `P:` key) | The spec's own suggestion; every id matches `[A-Za-z0-9_-]{1,64}`, none can equal `mandatory_lead`, the prefix keeps kinds apart, an ordinal carries no substring or digest of its key, and the same inputs give the same ids |
| The card labels behind the id → label map (§7) | Exactly what each card shows: a cap `"{person} · {capLabel(cap)}"` (`RestrictionCard`'s header + chip, `capLabel` from `plannerModel.ts`), a pair `"{personA} ≠ {personB} en {pattern}"` (`ConflictCard`), a presence rule `"{persons, comma-joined} en {pattern} c/sem"` (`PresenceCard`), a week exclusion `"{person} · sem.{n} {pattern}"` | «a rule id → the rule card's own label»; the admin can find what the line names |
| Where KH-3's table is readable | Inside NT-1's «Ver etapas» `Collapse`, as one `<pre data-v3-rule-table>` block: first line `request_id <id>`, then one tab-separated line per entry `wire id · kind · ordinal` (or `sin tarjeta …`); kept in the run's snapshot beside the frozen record bodies; never sent, logged or stored elsewhere | The spec's hint (KH-3); C7's 3d captures it per run «however the merged C6 exposes it» (AS8) |
| `request_id` and `seed` | Minted at press time by the Auto handler (`newCreationRequestId()` — ≤ 36 chars — and a `crypto.getRandomValues` 31-bit integer), passed **into** the pure builder | The builder stays pure and byte-reproducible in tests; the seed is kept with the plan, never shown (spec §12 default) |
| Planned service ids (RQ-3) | The create column's own id, verbatim (`create:sunday_role__2026-11-08`, `createColumnId` in `plannerModel.ts`) | Already unique per target, inside `[A-Za-z0-9:._-]` and ≤ 64; assignments map back to columns with no second table |
| ST-6 seat keeping at run time | C6 calls C2's `keepVoiceSeats` (IF2-11) on the stored services it sends, mapped to `LedgerService` with `countsForFairness: true` (so LG-2 never drops an uncounted weekend service, which RQ-3 still sends fixed) | C2 §7.4 says no C6 module reimplements LG-4 and the spec says «C6 defines no second rule»; calling IF2-11 is the only way to be sure the seat C6 sends is the one the ledger keeps. IF-C2 lists IF2-11 as «ST-6's test only» — **flagged for review**: the test still exists (Task 7) and now also guards the mapping; if the reviewer rules the runtime call out, the fallback is a local Lead → BGV → Choir first-seen pass tested against IF2-11 |
| ST-2 (a stored service and a planned column on one date) | **Tolerate both columns.** Stored columns keep their document `_id` as `columnId`, planned ones their `create:…` id; every cell is keyed by `columnId`; `cellsToDrafts` and the confirm read the planned columns only. Guard test: `MonthGenerator.v3Horizon.test.tsx` › «ST-2: a stored special and a planned Sunday on one date render two columns with separate cells, and the confirm posts only the Sunday». If that test cannot be made green at replay, switch to the refusal branch (the calendar refuses a Sunday whose date holds a stored special, with a stated reason) and record it | The spec allows either; columns are already id-keyed, and refusing would hide a real Sunday |
| A stored service whose translation is refused (`translateStoredRole` → `null`) in a horizon month | Treated as an incoherent read: Auto refuses with ST-1's line | Sending the month without it would drop its pins and shares silently |
| WN-1's one rendering | Keep C3's gate prop `showCadencePoolWarning` as the one rendering. `ServicesPanel` passes `showCadencePoolWarning={engine === "v3"}` (the engine half); `MonthGenerator` ANDs it with «some horizon month is not bound» and hands `SolverConfigPanel` a new optional `cadencePoolWarningMonths` (the unbound months' names), which renders as a heading suffix «— {Mes} / {Mes1} y {Mes2}» beside C3's unchanged heading; Auto's notices repeat each sentence prefixed with the same months | One rendering in the config step (C3's), C3's sentences unchanged, and C3's own gate test (prop `true`, no read yet ⇒ open) stays green unedited |
| NT-5 and the v3 run report | Under v3 `MonthGenerator` passes `diagnostics={null}` (so the v2 strip cannot render) and a new optional `PlannerGrid` slot `v3Report` (a `ReactNode`) renders `V3RunPanel` in the strip's place | The v2 strip's code is untouched |
| AD-6 «Reintentar» | `AutoState` gains an optional `retry?: () => void`; `PlannerGrid` renders a `Button` «Reintentar» beside `autoState.error` only when it is set | One optional field; v2 never sets it |
| ST-9's confirm sentence | `PlannerGrid` gains an optional `autoConfirmText` that replaces the v2 sentence when set (v3 only) | The v2 copy stays byte-identical |
| «Equidad» under v3 (EQ-1–EQ-7) | C2's `FairnessPreviewPanel` gains optional props `engine` (banner shown iff `"v2"`; default `"v2"`) and `plan` (the last v3 run of this horizon: C5's `fairness.people`, RQ-4's cadence states and the request's facts for §7.7's reasons). Under v3 the v2 history surfaces (`LeadPoolHistoryPanel`, `DerivedLeadPoolHistory`, the «Historial» block) are not mounted; the panel is mounted at the config step, the stored editor and the grid step | C2's panel is extended, never re-implemented (EQ-2); C7 Step 12 deletes the v2 surfaces later |
| The display copy of the ledger (§4 «Displayed state before a run») | Under v3 `MonthGenerator` keeps one display read of `GET /api/admin/fairness?month=<first>&horizon=<length>` per horizon change (abortable, failures ignored — every month then counts as not bound), feeding ST-8's banners, the read-only pools and WN-1's gate; every Auto still reads fresh (RQ-1) and the confirm's no-Auto path reads fresh (CF-2) | The spec separates «displayed state» from «what is solved and confirmed» |
| Auto orchestration | One neutral async function `runV3Auto` (`v3AutoRun.ts`) with injected transports and clock: pre-read refusals → fresh ledger read (20 s abort) → build → solve (58 s abort) → classify. `MonthGenerator` only applies its result | Makes RQ-1, HZ-7/HZ-9 placement, AD-2/AD-3 and the parser separation unit-testable without the 5 000-line component |
| Route-made v3 failures' HTTP status | `422` with `{ ok: false, transport_error: true, transport }`, as v2's route-made failures are today (`status: result.ok ? 200 : 422`) | The client classifies by `transport`; a bare Vercel `504` (no JSON) still reads as the timeout copy (AD-3, AD-6) |
| v3 local entry point's interpreter | The same `OWT_SOLVER_PYTHON` override and default path the v2 local path uses | One documented knob for local development; no new variable |
| CF-10's gaps — scope and exits | `v3Gaps` is session-wide and kept by month, never keyed by horizon: an attempt that reaches the drafts merges its per-month progress (a completed month leaves the list), an Auto clears nothing (it writes nothing), and a full success still closes as today. The dialog is ONE element rendered in both step branches (the config step is an early return); the grid «Cancelar», the config «Cancelar», Escape in either step and the discard banner's «Cerrar de todos modos» all ask through `v3HasGaps`. The confirm's report lines, by contrast, are keyed by horizon (shown only for their own horizon, like «Reintentar») | CF-10's trigger is «closing with gaps»: November's missing services exist whatever horizon is on screen, so naming them while December is shown is correct content, and keying or clearing them on a horizon change would let Volver → change month → «Cancelar» leave unprompted. The lines describe one confirm's progress and are meaningless without their «Reintentar» |
| CF-2's frozen entries — one slot per horizon | `v3EntriesRef` is a `Map` from horizon key to the entries the last v3 run of that horizon froze; another horizon's run never evicts them | CF-2: «if no v3 Auto ran for this horizon in this session» — a run of H2 does not undo the run of H1. A frozen `rev` that went stale meanwhile is refused by the writer (WR-15) with «vuelve a correr Auto», never written |

---

## File Structure

**Created — production (all under `app/`)**

| File | Responsibility | Spec rows |
|---|---|---|
| `app/utils/solverV3Upstream.ts` | `server-only`, loaded by the solve route on its v3 branch only (dynamic `import()`). Re-exports `isV3Body` from `v3Wire.ts`, calls `OWT_SOLVER_V3_URL` (or the local `gcf_v3/owt_solver_v3.py --json-mode` off Vercel) with a 55 s abort, and turns every upstream answer into one of: a verbatim v3 success, a coded v3 failure (422) or a route-made transport error; logs only engine, outcome, status, timing | RT-1, RT-3–RT-6, KH-2 |
| `app/components/admin/v3Wire.ts` | Neutral types of the `contract: 3` request and response as C6 builds and reads them, and `isV3Body` (the contract marker the route classifies every body with) | IF-C5, RT-1 |
| `app/components/admin/v3Horizon.ts` | Horizon months, date ownership, the CDMX current month, the past (HZ-7) and ceiling (HZ-9) refusal, selection retention on a horizon change | HZ-2, HZ-3, HZ-7, HZ-9, CF-1 |
| `app/components/admin/v3Copy.ts` | Every Spanish line of §7 keyed on codes, with each code's parameter list (for the registry sync), the month/date/list formatters, and the C6-own refusal lines | §7, NT-4, RQ-2, RQ-5, RQ-10, AD-3, CF-4 |
| `app/components/admin/v3RuleIds.ts` | Rule-id minting, the card-label map and KH-3's rule reference table | RQ-5, KH-1, KH-3 |
| `app/components/admin/v3MonthSources.ts` | Each horizon month's state (§4) and source (record or IF2-15 body), and per-service eligibility from it alone | RQ-2, ST-8, §4 |
| `app/components/admin/v3Services.ts` | The request's services (planned, stored, counted specials), stored seats as pins (through IF2-11), ST-5/ST-6 notices and `prior` | RQ-3, RQ-7, ST-4–ST-7 |
| `app/components/admin/v3People.ts` | RQ-4's cadence states (once per run), the people list, `carried` with `P:` keys rewritten, `exempt`, `dl_since`, `prev_dl_leads`, the horizon-wide disagreement refusal | RQ-4, EQ-4 |
| `app/components/admin/v3Rules.ts` | `==` rules from the month source, presence month-scoped, `<=`/`>=` caps through IF2-16/IF2-17, pairs, the IF2-17 refusals and the clamp/week notices | RQ-5 |
| `app/components/admin/v3Prefill.ts` | The pre-solve fill of planned counted specials: today's hard blocks + RQ-2 eligibility, the protection tiers and balance order, SP-7's notices | SP-1, SP-2, SP-6, SP-7, CTL-2 |
| `app/components/admin/v3SolveRequest.ts` | `buildV3SolveRequest` — the ONE pure builder (planner state, ledger GET, roles read, clock in; request, notices, refusals, snapshot out); `V3_PIN_CAP`, `V3_LIMITS` | RQ-1–RQ-10, ST-*, SP-*, NT-3, KH-1 |
| `app/components/admin/v3SolveResponse.ts` | The v3 adapter: classification, handshake, apply by service id, the retry rule | AD-1–AD-6 |
| `app/components/admin/v3RunReport.ts` | The run line, stage summary and detail, and every solver notice rendered from codes | NT-1, NT-2, NT-5 |
| `app/components/admin/v3AutoRun.ts` | `runV3Auto` — refusal order, the fresh 20 s ledger read, build, the 58 s solve, classification | RQ-1, HZ-7, HZ-9, WN-2, ST-1, AD-1–AD-3, SP-5 |
| `app/components/admin/V3RunPanel.tsx` | `"use client"`. NT-1's summary, «Ver etapas» (`Collapse`) and KH-3's table block | NT-1, KH-3 |
| `app/components/admin/v3Confirm.ts` | **[CRITICAL]** Frozen PUT entries per month state, the confirm guard, the PUT outcome classifier, draft grouping and §7.8's lines | CF-1–CF-4, CF-6, CF-8 |
| `app/components/admin/v3ConfirmRun.ts` | **[CRITICAL]** `runV3ConfirmAttempt` — one attempt: guard, one atomic PUT (until it succeeds), drafts month by month, per-month report, retry state | CF-1, CF-4–CF-7, CF-11 |
| `app/components/admin/V3IncompleteDialog.tsx` | `"use client"`. CF-10's «El plan quedó incompleto» `CueDialog` | CF-10 |
| `docs/adr/0052-the-planner-learns-the-solver-engine-from-the-server.md`, `docs/adr/0053-auto-plans-one-or-two-months-with-stored-services-fixed.md` | DOC-2's two records (numbers taken at Task 0) | DOC-2 |

**Created — tests**

`app/api/__tests__/solveRouteV3.test.ts`; `app/utils/__tests__/solverV3Upstream.test.ts`; `app/components/admin/__tests__/` — `engineProp.test.ts`, `engineWiring.test.tsx`, `v3Horizon.test.ts`, `v3Copy.test.ts`, `v3CodesSync.test.ts`, `v3PinCapSync.test.ts`, `v3RuleIds.test.ts`, `v3MonthSources.test.ts`, `v3Services.test.ts`, `v3People.test.ts`, `v3Rules.test.ts`, `v3Prefill.test.ts`, `v3SolveRequest.test.ts`, `v3KeyHygiene.test.ts`, `v3SolveResponse.test.ts`, `v3RunReport.test.ts`, `v3AutoRun.test.ts`, `MonthGenerator.v3Horizon.test.tsx`, `MonthGenerator.v3Auto.test.tsx`, `MonthGenerator.v3Equidad.test.tsx`, `v3Confirm.test.ts`, `v3ConfirmRun.test.ts`, `MonthGenerator.v3Confirm.test.tsx`, and the shared fixtures `v3Fixtures.ts` (fictitious members, a ledger body builder, a name-shaped config — not a test file).

**Modified**

| File | Change | Task |
|---|---|---|
| `app/components/admin/solverEngine.ts` | + `export type SolverEngine` (the constant's line untouched) | 1 |
| `app/utils/solverDeployment.ts` | `SolverEngine` re-exported from `solverEngine.ts` instead of declared | 1 |
| `app/(client)/admin/page.tsx` | resolves `engine` with `resolveSolverEngine(process.env)` and passes it | 1 |
| `AdminPanel.tsx`, `ServicesPanel.tsx` | `engine` prop threaded; `ServicesPanel`'s create mount also gets `storedSource` and `showCadencePoolWarning` | 1, 14 |
| `FairnessSwitch.tsx` | `FairnessEngineNote({ engine })`, no constant import | 1 |
| `PlannerGrid.tsx` | `engine`, `v3Report`, `monthBands`, `autoConfirmText` props; `AutoState.retry`; read-only check for create-mode stored columns; «Guardado» chip | 1, 14, 15, 16 |
| `MonthCalendar.tsx` | `engine` prop to the note | 1 |
| `MonthGenerator.tsx` | engine prop; CTL-1 wiring; horizon state and control; stacked calendars; «Guardado» columns; display ledger read; the v3 Auto branch; v3 history surfaces swapped for «Equidad»; banners; the v3 confirm | 1, 14, 15, 16, 19 |
| `FairnessPreviewPanel.tsx`, `fairnessPreviewModel.ts` | `engine` and `plan` props; the two plan columns; §7.7 reasons | 16 |
| `app/api/admin/solve/route.ts` | engine resolution, the 409, the v3 branch through `solverV3Upstream.ts`; v2 path unchanged | 2 |
| `app/components/admin/__tests__/fairnessEngineV3.test.tsx`, `fairnessSwitch.test.tsx` | the note takes its engine as a prop | 1 |
| `docs/SECRETS.md` | `OWT_SOLVER_V3_URL` entry (DOC-1) | 2 |
| `docs/adr/README.md`, `docs/API_REFERENCE.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `CLAUDE.md`, `AGENTS.md` | DOC-2, DOC-3 and the reusable-utils lines | 20 |
| `app/utils/__tests__/__fixtures__/colour-inventory.json` | regenerated whenever a task adds a non-test `app/` file | 2–19 |

**Deliberately untouched:** every v2 module and test named in Global Constraints; `gcf/**`, `gcf_v3/**`; C2's writer (`fairnessMonthWriteRequest.ts`, `fairnessMonthCommit.ts`, the PUT route), reader and resolver; C3's `sundayCadence.ts` and its copy; `LeadPoolHistoryPanel.tsx`, `leadPoolHistory.ts` (C7 deletes them); `app/mcp/**`; `draftGatingCoverage.test.ts`, `serviceCommitCallers.test.ts`, `protectedReadAudit.test.ts` lists.

---

## What C7 reads from this delivery

C7 (`docs/superpowers/plans/2026-10-05-solver-v3-c7-cutover.md`) consumes the merged C6 at its Step 0 check 8 and in its rehearsal; every expectation it states is met by a named task:

| C7 expectation (line) | Delivered by |
|---|---|
| Server-resolved engine passed as a render prop; no second `SOLVER_ENGINE` pin (C1-R11 is the one); annotation kept (235, 619-622) | Task 1 (no pin added; `engineProp.test.ts` asserts no client file reads the constant) |
| `409 { ok: false, error: "solver_version_mismatch", engine }`; JSON transport errors with `transport`; 55 s route / 58 s client; `not_configured` without the URL (235, 281, 692) | Tasks 2, 13 |
| «Planear: 1 mes · 2 meses»; HZ-7; the month band at phone width (235, 498, 593, 838) | Tasks 3, 14 |
| A bound month solved with its record and its pools read-only (235, 478-480) | Tasks 6, 16 |
| The real request builder from live planner state; `prior` from the roles read; every rule id minted, `P:` keys rewritten, the label map in memory only; the request is the browser-visible body of `POST /api/admin/solve` (235, 503-507, 540-566) | Tasks 5–11, 15 |
| The minted-id → config-ordinal map kept with the plan snapshot and capturable per run (AS8, 359-360, 506) | Tasks 5, 11, 15 (KH-3 table in «Ver etapas», headed by `request_id`) |
| A card-less presence line renders «regla de presencia registrada» (554) | Tasks 4, 5 |
| WN-1, WN-2 (incl. `cadence_and_exact`), WN-3 (235, 476-477) | Tasks 13, 16 |
| Confirm: records then drafts, a create for every recordless month (A27), a bound month `unchanged`, recorded-unbound replaced, A40 (78-80, 235, 347-365, 797-802) — **no CF-1 (iii) path** | Tasks 17–19 |
| «Equidad» tabs each from its own entry; «Tuvo», «Saldo», «En este plan», «Queda», «Los pines tomaron {n} lugares» as specified; banner gated to v2; v2 history surfaces unmounted, not deleted (235, 588-604) | Task 16 |
| CTL-1 gates C1's note and `CADENCE_V2_NOTE` to v2, and not the form-help sentence or `SLACK_V3_NOTE`; CTL-1's chip render tests are the ones C7 Step 5 rewrites (230-232, 455-461, 632-634) | Task 1 (`engineWiring.test.tsx` › «CTL-1 card chip …») |
| `OWT_SOLVER_V3_URL` SECRETS entry naming Preview and Production, source, how to change, blast radius, not needed in `.env.local`/CI/iOS, pointing at C7 W0 (124-125, 443-446, 690-693) | Task 2 |
| DOC-2's horizon ADR, which C7's amendments to ADR-0010 and ADR-0047 cite as «ADR-<horizon>» (649, 654); DOC-3 does not repeat C2's engine line (676) | Task 20 |
| Check 8's sub-check: which paths other than Auto's confirm write a record | Answered in Task 20's ADR: only Auto's v3 confirm (and C2's «Registrar»); stored-mode «Editar mes» writes no record |

C7's text cites «KH-1 as amended» where this plan delivers KH-3 (C6 spec S-18); that citation is C7's to correct, and KH-3 satisfies C7's weaker wording («however the merged C6 exposes it»).

---

## Task 0: Branch, entry gate and baseline

**Files:** none.

- [ ] **Step 1: Confirm C1, C3, C2 and C5 are on `main`** (spec §15: C6 depends on all four and never re-implements them)

```bash
git fetch origin
git ls-tree --name-only origin/main \
  app/components/admin/solverEngine.ts app/utils/countsForFairness.ts app/utils/sundayCadence.ts \
  app/utils/solverDeployment.ts app/utils/fairnessVocabulary.ts app/utils/fairnessLedger.ts \
  app/utils/fairnessFormat.ts app/utils/fairnessEligibility.ts app/utils/fairnessMonthWriteRequest.ts \
  app/api/admin/fairness/route.ts app/api/admin/fairness/months/route.ts \
  app/components/admin/FairnessPreviewPanel.tsx app/components/admin/fairnessPreviewModel.ts \
  gcf_v3/owt_v3/codes.json gcf_v3/owt_v3/constants.py gcf_v3/owt_solver_v3.py gcf_v3/main.py
git show origin/main:gcf_v3/owt_v3/constants.py | grep -x 'PIN_CAP = 250'
```

Expected: all seventeen paths listed and the `PIN_CAP = 250` line printed. If any is missing, **stop**: C6 is not implementable yet (ENG-1: C6 never creates a resolver; RQ-6: the pin cap mirrors C5's literal).

**Entry gate, also before Task 1:** Frank has read the C6 spec's §5.11 confirm protocol and §7 copy, or explicitly waived it. The spec is self-reviewed (`READY_FOR_REVIEW`) and Frank's 2026-10-05 authorization to proceed with the children did not include reading C6; record his read or his waiver (date and words) in the worklog. Without either, **stop** — no task of this plan runs.

- [ ] **Step 2: Branch from the current `main`**

```bash
git switch -c claude/solver-v3-c6-planner-v3 origin/main
git log -1 --oneline
```

If the coordinator runs this in a worktree (`CLAUDE.md`: only when two things must be in flight at once), use `EnterWorktree`, populate `node_modules` with `cp -Rc` from a checkout whose `package-lock.json` matches (never a fresh install), and symlink `.env.local` to the primary checkout's copy (`ln -s ../../../.env.local .env.local` from the worktree root) — never write one inside the worktree.

- [ ] **Step 3: Record the baseline**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -4 && npx eslint . 2>&1 | tail -1`
Expected: no `tsc` output; all tests pass (record files/tests); `✖ N problems (0 errors, N warnings)` — record N: it is the warning ceiling for the whole delivery.

- [ ] **Step 4: Re-verify the anchors from C2 Tasks 11–17 and C5 Tasks 10–15 (re-verified at replay 2026-10-07 against `4c50309b`) against the merged `main`** (those tasks were plan text when this plan was written; the replay base carried their final code, and `main` must still carry it)

```bash
git grep -n 'export function resolveMonthEligibility\|export type EligibilityIssueCode\|export type EligibilityRefusalReason\|export type EligibilityResult' origin/main -- app/utils/fairnessEligibility.ts
git grep -n 'export interface FairnessPreviewPanelProps\|export default function FairnessPreviewPanel\|COPY.banner\|export const FAIRNESS_ENDPOINT' origin/main -- app/components/admin/FairnessPreviewPanel.tsx
git grep -n 'export function tabRows\|export function cadenceLine\|export const COPY\|export const TABS\|export function motivo' origin/main -- app/components/admin/fairnessPreviewModel.ts
git grep -n '<FairnessPreviewPanel' origin/main -- app/components/admin/MonthGenerator.tsx
git grep -n 'export const dynamic\|fairness_unavailable' origin/main -- app/api/admin/fairness/route.ts
git grep -n -- '--json-mode' origin/main -- gcf_v3/owt_solver_v3.py
git grep -n 'resolveSolverEngine' origin/main -- app
```

Expected: every symbol found; two `<FairnessPreviewPanel` mounts in `MonthGenerator.tsx`; `resolveSolverEngine` imported by `fairnessMonthCommit.ts` and `app/api/admin/fairness/route.ts` only. A missing or renamed symbol is a **stop-and-report**: fix this plan's text that names it before Task 1 (see «Replay»).

- [ ] **Step 5: Take the ADR numbers**

Run: `ls docs/adr | grep -E '^[0-9]{4}-' | sort | tail -3`
Expected: the highest number on `main` (`0051` on `c0375d7d`: C3 `0049`, C2 `0050`, C5 `0051` — at replay-base it was `0050`, and the numbers below were renumbered from `0051`/`0052` on 2026-10-07). C6's two records take the next two numbers. **If they are not `0052` and `0053`, replace BOTH numbers everywhere before Task 1** (each as `NNNN`, `ADR-NNNN` and in file names): Global Constraints («ADR numbers»), the File Structure row for the two records, Task 20's **Files** list, Step 1 and Step 2 (file names and titles), Step 3's two index rows, the Coverage row ENG-5, and Self-review item 2. The «Replay» section's mentions are history and stay. `adrIndex.test.ts` (Task 20 Step 7) confirms the result.

---

## Task 1: The engine as a server-resolved prop, and the surfaces it gates (CTL-1) — [standard]

**Files:**
- Modify: `app/components/admin/solverEngine.ts:20`
- Modify: `app/utils/solverDeployment.ts:24-26`
- Modify: `app/(client)/admin/page.tsx:1-5,16-18,48`
- Modify: `app/components/admin/AdminPanel.tsx:52-62,226`
- Modify: `app/components/admin/ServicesPanel.tsx:194` and both `<MonthGenerator` mounts (`:984-1027`, `:1040-1062`)
- Modify: `app/components/admin/FairnessSwitch.tsx:13,58-66`
- Modify: `app/components/admin/PlannerGrid.tsx:271,640-641,1825`
- Modify: `app/components/admin/MonthCalendar.tsx:47-79,198-209,431`
- Modify: `app/components/admin/MonthGenerator.tsx` — `Props` (`:178-269`), the component's destructure (`:1991-1995`), `RestrictionCard` (`:630-691`), `RuleBuilder` (`:1146`), `SolverConfigPanel` (`:1787-1806`, its `<RuleBuilder` at `:1947-1953`), the `<SolverConfigPanel` mount (`:4493-4505`), `<MonthCalendar` (`:4430`), the composer note (`:4704`), `<PlannerGrid` (`:4928`)
- Modify (tests): `app/components/admin/__tests__/fairnessEngineV3.test.tsx`, `app/components/admin/__tests__/fairnessSwitch.test.tsx:75`
- Create: `app/components/admin/__tests__/engineProp.test.ts`, `app/components/admin/__tests__/engineWiring.test.tsx`

**Interfaces:**
- Consumes: C1 `SOLVER_ENGINE` (`app/components/admin/solverEngine.ts`), C2 `resolveSolverEngine(env): SolverEngine` (IF2-14, `app/utils/solverDeployment.ts`), C1 `FAIRNESS_ENGINE_NOTE`, C3 `CADENCE_V2_NOTE`, `SLACK_V3_NOTE`.
- Produces: `export type SolverEngine = "v2" | "v3"` from `app/components/admin/solverEngine.ts` (the ONE definition; `solverDeployment.ts` re-exports it). Props: `AdminPanel.engine?: SolverEngine`, `ServicesPanel({ engine?: SolverEngine })`, `MonthGenerator` `Props.engine?: SolverEngine`, `PlannerGridProps.engine?: SolverEngine`, `MonthCalendarProps.engine?: SolverEngine`, `FairnessEngineNote({ engine }: { engine: SolverEngine })` (required), `RuleBuilder`/`RestrictionCard`/`SolverConfigPanel` `engine?: SolverEngine` — every optional one defaults to the literal `"v2"`. Later tasks read `engine` inside `MonthGenerator`.

- [ ] **Step 1: Write the failing guard test** — `app/components/admin/__tests__/engineProp.test.ts`

```ts
// Solver v3 C6 ENG-3, ENG-4 — the effective engine is resolved on the SERVER and reaches the
// client only as a prop. Static guards over git-tracked, non-test sources (stage new files first).
// C2's `solverDeployment.test.ts` already pins «exactly one reader of OWT_SOLVER_ENGINE» and «no
// client module imports the resolver» (ENG-1); this file adds what C6 owns and does not repeat them.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = (): string[] =>
  execFileSync("git", ["ls-files", "app"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("/__tests__/") && !/\.test\.(ts|tsx)$/.test(f));

const read = (f: string) => readFileSync(f, "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const isClient = (src: string) => /^\s*(["'])use client\1/.test(stripComments(src));

/** Every opening tag `<Name …>` in `src`, braces balanced so `=>` inside a prop never ends it. */
function openingTags(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

describe("the engine prop (C6 ENG-3, ENG-4)", () => {
  it("no client module mentions SOLVER_ENGINE: every client branch reads the prop (ENG-4)", () => {
    const offenders = sources().filter((f) => {
      const src = read(f);
      return isClient(src) && /\bSOLVER_ENGINE\b/.test(stripComments(src));
    });
    expect(offenders).toEqual([]);
  });

  it("the resolver's module is imported only by the admin page, route handlers and server-only modules (ENG-3)", () => {
    const offenders = sources().filter((f) => {
      if (f === "app/utils/solverDeployment.ts") return false;
      const src = stripComments(read(f));
      if (!/from\s+["'][^"']*\/solverDeployment["']/.test(src)) return false;
      const server = f === "app/(client)/admin/page.tsx"
        || /^app\/api\/.+\/route\.ts$/.test(f)
        || /^\s*import\s+["']server-only["'];?\s*$/m.test(src);
      return !server;
    });
    expect(offenders).toEqual([]);
  });

  it("/admin resolves the engine at render and hands it to the panel", () => {
    const page = read("app/(client)/admin/page.tsx");
    expect(isClient(page)).toBe(false);
    expect(page).toMatch(/const engine = resolveSolverEngine\(process\.env\);/);
    expect(openingTags(page, "AdminPanel")).toHaveLength(1);
    expect(openingTags(page, "AdminPanel")[0]).toMatch(/\bengine=\{engine\}/);
  });

  it("every production mount of an engine-dependent component passes `engine=`", () => {
    const everywhere = ["ServicesPanel", "MonthGenerator", "FairnessEngineNote"];
    const inGenerator = ["PlannerGrid", "MonthCalendar", "SolverConfigPanel", "RuleBuilder", "RestrictionCard"];
    const missing: string[] = [];
    for (const f of sources().filter((s) => s.endsWith(".tsx"))) {
      const src = stripComments(read(f));
      const names = f === "app/components/admin/MonthGenerator.tsx" ? [...everywhere, ...inGenerator] : everywhere;
      for (const name of names) {
        for (const tag of openingTags(src, name)) {
          if (!/\bengine=/.test(tag)) missing.push(`${f}: <${name}>`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the failing render test** — `app/components/admin/__tests__/engineWiring.test.tsx`

```tsx
/** @vitest-environment jsdom */
// Solver v3 C6 CTL-1 — the surfaces C6 gates on its server-resolved prop: C1's note
// «Cuenta para equidad: aplica con el nuevo solver…» and C3's card-chip note
// (`CADENCE_V2_NOTE`), each shown only under v2. Not gated (C3 owns them, under both engines):
// the «Holgura» note (`SLACK_V3_NOTE`). C7's flip rewrites the «CTL-1 card chip» tests below.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import MonthCalendar from "../MonthCalendar";
import { FairnessEngineNote } from "../FairnessSwitch";
import { FAIRNESS_ENGINE_NOTE } from "../fairnessToggleModel";
import type { PersonRestriction, SolverConfig } from "../plannerModel";
import { AdminProviders } from "./providersHarness";
import { readyRules } from "./rulesHarness";
import { CADENCE_V2_NOTE, SLACK_V3_NOTE } from "@/app/utils/sundayCadence";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-03T18:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const members = [
  { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "support"] },
];
const CADENCE_AND_SLACK: PersonRestriction = {
  id: "r-ana", person: "Ana", excludedPatterns: [], fairness: "slack", fairnessSlack: 2,
  weekExclusions: [], caps: [], sundayCadence: "alternate",
};
const config: SolverConfig = {
  sundayLeads: [], saturdayLeads: [], support: [], restrictions: [CADENCE_AND_SLACK], conflicts: [], presence: [],
};

function renderGenerator(engine: "v2" | "v3") {
  return render(
    <MonthGenerator
      engine={engine}
      members={members}
      existingRoles={[]}
      onClose={vi.fn()}
      onCreated={vi.fn()}
      rules={readyRules(config)}
    />,
    { wrapper: AdminProviders },
  );
}
const card = () =>
  screen.getAllByTitle("Editar").map((b) => b.closest("div.rounded-lg") as HTMLElement)
    .find((e) => /Ana/.test(e.textContent ?? ""))!;

describe("C1's note follows the engine prop", () => {
  it("renders under v2 and nothing under v3", () => {
    const v2 = render(<FairnessEngineNote engine="v2" />);
    expect(v2.container.textContent).toBe(FAIRNESS_ENGINE_NOTE);
    cleanup();
    const v3 = render(<FairnessEngineNote engine="v3" />);
    expect(v3.container.textContent).toBe("");
  });

  it("the special composer shows it under v2 only", () => {
    for (const engine of ["v2", "v3"] as const) {
      const { container } = render(
        <MonthCalendar
          engine={engine}
          year={2026} month={8} selectedSundays={[]} selectedSaturdays={[]} specials={[]} existingRoles={[]}
          onToggleWeekend={vi.fn()} onAddSpecial={vi.fn()} onRemoveSpecial={vi.fn()}
        />,
      );
      fireEvent.click(container.querySelector('[data-date="2026-08-12"]')!);
      expect(screen.queryByText(FAIRNESS_ENGINE_NOTE) !== null).toBe(engine === "v2");
      cleanup();
    }
  });
});

describe("CTL-1 card chip: C3's `CADENCE_V2_NOTE` follows the engine prop", () => {
  it("v2: the chip is followed by its note", () => {
    renderGenerator("v2");
    const chip = within(card()).getByText("Mes por medio");
    expect(chip.nextElementSibling?.textContent).toBe(CADENCE_V2_NOTE);
  });

  it("v3: the chip stays and its note is gone", () => {
    renderGenerator("v3");
    expect(within(card()).getByText("Mes por medio")).toBeTruthy();
    expect(within(card()).queryByText(CADENCE_V2_NOTE)).toBeNull();
  });

  it("the «Holgura» note is C3's under both engines (not gated)", () => {
    for (const engine of ["v2", "v3"] as const) {
      renderGenerator(engine);
      expect(within(card()).getByText(`holgura 2 · ${SLACK_V3_NOTE}`)).toBeTruthy();
      cleanup();
    }
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `git add -A && npx vitest run app/components/admin/__tests__/engineProp.test.ts app/components/admin/__tests__/engineWiring.test.tsx`
Expected: FAIL — `engineProp` reports `FairnessSwitch.tsx` mentioning `SOLVER_ENGINE` and the page/mounts lacking `engine=`; `engineWiring` fails to type/render `engine` props and finds the note under v3.

- [ ] **Step 4: Move the union type into C1's module** — `app/components/admin/solverEngine.ts`

Find:
```ts
export const SOLVER_ENGINE: "v2" | "v3" = "v2";
```
Replace with:
```ts
/**
 * The engine as a VALUE the server resolves and threads as a prop (solver v3 C6 ENG-1). The ONE
 * definition of the union: `app/utils/solverDeployment.ts` re-exports it, and client modules import
 * it from here because they may not import the resolver's module. A type adds no import.
 */
export type SolverEngine = "v2" | "v3";

export const SOLVER_ENGINE: "v2" | "v3" = "v2";
```

`app/utils/solverDeployment.ts` — Find:
```ts
import { SOLVER_ENGINE } from "@/app/components/admin/solverEngine";
```
Replace with:
```ts
import { SOLVER_ENGINE, type SolverEngine } from "@/app/components/admin/solverEngine";
```
Find:
```ts
export type SolverEngine = "v2" | "v3";
```
Replace with:
```ts
// Moved to `solverEngine.ts` (C6 ENG-1: one definition, client-importable); re-exported so every
// existing importer of this module keeps the name.
export type { SolverEngine };
```

- [ ] **Step 5: Resolve on the server and thread the prop**

`app/(client)/admin/page.tsx` — Find:
```ts
import { resolveAdminTab } from "@/app/components/admin/adminTabs";
```
Replace with:
```ts
import { resolveAdminTab } from "@/app/components/admin/adminTabs";
import { resolveSolverEngine } from "@/app/utils/solverDeployment";
```
Find:
```ts
  const role = session.user.role as OWTRole;
```
Replace with:
```ts
  const role = session.user.role as OWTRole;
  // Solver v3 C6 ENG-3: the effective engine is THIS deployment's (C2 IF2-14 — the constant, or
  // the Preview-only override on the `preview` branch deployment and locally). Resolved here, on
  // the server, and handed down as a plain string: no client module may read the override.
  const engine = resolveSolverEngine(process.env);
```
Find:
```tsx
        <AdminPanel role={role} initialTab={initialTab} tabNamedInUrl={tabNamedInUrl} />
```
Replace with:
```tsx
        <AdminPanel role={role} initialTab={initialTab} tabNamedInUrl={tabNamedInUrl} engine={engine} />
```

`app/components/admin/AdminPanel.tsx` — Find:
```ts
import ServicesPanel from "./ServicesPanel";
```
Replace with:
```ts
import ServicesPanel from "./ServicesPanel";
import type { SolverEngine } from "./solverEngine";
```
Find:
```ts
  tabNamedInUrl = false,
}: {
  role?: OWTRole;
```
Replace with:
```ts
  tabNamedInUrl = false,
  engine = "v2",
}: {
  role?: OWTRole;
  /**
   * The effective solver engine, resolved by `/admin`'s Server Component (C6 ENG-3). The literal
   * default is for tests only; the page always passes it, and `engineProp.test.ts` fails a mount
   * that does not.
   */
  engine?: SolverEngine;
```
Find:
```tsx
              <ServicesPanel />
```
Replace with:
```tsx
              <ServicesPanel engine={engine} />
```

`app/components/admin/ServicesPanel.tsx` — Find:
```ts
export default function ServicesPanel() {
```
Replace with:
```ts
export default function ServicesPanel({ engine = "v2" }: { engine?: SolverEngine } = {}) {
```
The type import goes directly after the `./SetlistEditor` import: Find `import { SetlistEditor } from "./SetlistEditor";` → Replace with `import { SetlistEditor } from "./SetlistEditor";\nimport type { SolverEngine } from "./solverEngine";`. In the stored mount, Find:
```tsx
            mode="stored"
```
Replace with:
```tsx
            mode="stored"
            engine={engine}
```
In the create mount, Find:
```tsx
          <MonthGenerator
            members={members}
            existingRoles={roles}
```
Replace with:
```tsx
          <MonthGenerator
            engine={engine}
            members={members}
            existingRoles={roles}
```

- [ ] **Step 6: The note reads the prop** — `app/components/admin/FairnessSwitch.tsx`

Find:
```ts
import { SOLVER_ENGINE } from "./solverEngine";
```
Replace with:
```ts
import type { SolverEngine } from "./solverEngine";
```
Find:
```tsx
/** «Cuenta para equidad: aplica con el nuevo solver…» — once per surface, only while the engine is v2. */
export function FairnessEngineNote() {
  if (SOLVER_ENGINE !== "v2") return null;
```
Replace with:
```tsx
/**
 * «Cuenta para equidad: aplica con el nuevo solver…» — once per surface, only while the engine is
 * v2. The engine is the server-resolved prop (C6 CTL-1, ENG-4), never the constant.
 */
export function FairnessEngineNote({ engine }: { engine: SolverEngine }) {
  if (engine !== "v2") return null;
```

`app/components/admin/PlannerGrid.tsx` — the type import goes directly after the `./moveOccupant` import: Find `import { moveOccupant, type MoveOccupantEndpoint, type MoveOccupantSource } from "./moveOccupant";` → Replace with `import { moveOccupant, type MoveOccupantEndpoint, type MoveOccupantSource } from "./moveOccupant";\nimport type { SolverEngine } from "./solverEngine";`. Find:
```ts
  fairness?: { onChange: (columnId: string, next: boolean) => void; createInFlight: boolean };
```
Replace with:
```ts
  fairness?: { onChange: (columnId: string, next: boolean) => void; createInFlight: boolean };
  /** The server-resolved engine (C6 ENG-3); gates C1's note. Literal default for tests and the gallery only. */
  engine?: SolverEngine;
```
Find:
```ts
    fairness,
  } = props;
```
Replace with:
```ts
    fairness,
    engine = "v2",
  } = props;
```
Find:
```tsx
      {fairness && <FairnessEngineNote />}
```
Replace with:
```tsx
      {fairness && <FairnessEngineNote engine={engine} />}
```

`app/components/admin/MonthCalendar.tsx` — the type import goes directly after the `./FairnessSwitch` import: Find `import { FairnessEngineNote, FairnessSwitch } from "./FairnessSwitch";` → Replace with `import { FairnessEngineNote, FairnessSwitch } from "./FairnessSwitch";\nimport type { SolverEngine } from "./solverEngine";`. Find:
```ts
  onRemoveSpecial: (date: string) => void;
}
```
Replace with:
```ts
  onRemoveSpecial: (date: string) => void;
  /** The server-resolved engine (C6 ENG-3); gates C1's note in the special composer. */
  engine?: SolverEngine;
}
```
Find:
```ts
  onRemoveSpecial,
}: MonthCalendarProps) {
```
Replace with:
```ts
  onRemoveSpecial,
  engine = "v2",
}: MonthCalendarProps) {
```
Find:
```tsx
          <FairnessEngineNote />
```
Replace with:
```tsx
          <FairnessEngineNote engine={engine} />
```

- [ ] **Step 7: `MonthGenerator` takes the prop and forwards it**

The type import goes directly after the `./useDerivedSolverHistory` import: Find `import { useDerivedSolverHistory, type DerivedHistoryHandle } from "./useDerivedSolverHistory";` → Replace with `import { useDerivedSolverHistory, type DerivedHistoryHandle } from "./useDerivedSolverHistory";\nimport type { SolverEngine } from "./solverEngine";`. Find (end of `Props`; the comment's last line keeps it apart from `SolverConfigPanel`'s own `showCadencePoolWarning?: boolean;` field):
```ts
   * it closed for a record-bound month.
   */
  showCadencePoolWarning?: boolean;
}
```
Replace with:
```ts
   * it closed for a record-bound month.
   */
  showCadencePoolWarning?: boolean;
  /**
   * The effective solver engine, resolved by `/admin`'s Server Component and threaded through
   * `AdminPanel` → `ServicesPanel` (solver v3 C6 ENG-3). EVERY engine-dependent branch in this
   * file reads this prop, never `SOLVER_ENGINE` (ENG-4). Under `"v2"` nothing changes.
   */
  engine?: SolverEngine;
}
```
Find:
```ts
  showCadencePoolWarning = false,
}: Props) {
```
Replace with:
```ts
  showCadencePoolWarning = false,
  engine = "v2",
}: Props) {
```
`RestrictionCard` — Find:
```ts
function RestrictionCard({ r, onDelete, onEdit, nameIssue, exactOverlapRole }: {
  r: PersonRestriction;
```
Replace with:
```ts
function RestrictionCard({ r, onDelete, onEdit, nameIssue, exactOverlapRole, engine = "v2" }: {
  r: PersonRestriction;
  /** C6 CTL-1: C3's chip note shows only under v2. */
  engine?: SolverEngine;
```
Find:
```tsx
              <span className="font-body text-[10px] text-mono-500 self-center">{CADENCE_V2_NOTE}</span>
```
Replace with:
```tsx
              {engine === "v2" && (
                <span className="font-body text-[10px] text-mono-500 self-center">{CADENCE_V2_NOTE}</span>
              )}
```
`RuleBuilder` — Find:
```ts
function RuleBuilder({ config, onChange, members, source, cadenceNameIssues }: {
  config: SolverConfig;
```
Replace with:
```ts
function RuleBuilder({ config, onChange, members, source, cadenceNameIssues, engine = "v2" }: {
  config: SolverConfig;
  /** C6 CTL-1, forwarded to each `RestrictionCard`. */
  engine?: SolverEngine;
```
Find:
```tsx
          <RestrictionCard key={r.id} r={r}
```
Replace with:
```tsx
          <RestrictionCard key={r.id} r={r} engine={engine}
```
`SolverConfigPanel` — Find:
```ts
function SolverConfigPanel({ members, config, onChange, rules, history, onRemoveHistory, year, month, derived, showCadencePoolWarning = false, fairnessServices }: {
```
Replace with:
```ts
function SolverConfigPanel({ members, config, onChange, rules, history, onRemoveHistory, year, month, derived, showCadencePoolWarning = false, fairnessServices, engine = "v2" }: {
  /** C6 ENG-3: forwarded to the rule cards (CTL-1). */
  engine?: SolverEngine;
```
Find:
```tsx
        cadenceNameIssues={cadenceNameIssues}
      />
```
Replace with:
```tsx
        cadenceNameIssues={cadenceNameIssues}
        engine={engine}
      />
```
The mount — Find:
```tsx
          showCadencePoolWarning={showCadencePoolWarning}
          fairnessServices={existingRoles}
        />
```
Replace with:
```tsx
          showCadencePoolWarning={showCadencePoolWarning}
          fairnessServices={existingRoles}
          engine={engine}
        />
```
The calendar — Find:
```tsx
        createdTargets={createdTargets.current}
```
Replace with:
```tsx
        createdTargets={createdTargets.current}
        engine={engine}
```
The composer — Find:
```tsx
                <FairnessEngineNote />
```
Replace with:
```tsx
                <FairnessEngineNote engine={engine} />
```
The grid — Find:
```tsx
          fairness={{ onChange: handleFairnessChange, createInFlight: pushing || autoPending }}
```
Replace with:
```tsx
          fairness={{ onChange: handleFairnessChange, createInFlight: pushing || autoPending }}
          engine={engine}
```

- [ ] **Step 8: C1's tests pass the engine instead of mocking the constant**

`app/components/admin/__tests__/fairnessSwitch.test.tsx` — Find `render(<FairnessEngineNote />);` → Replace with `render(<FairnessEngineNote engine="v2" />);`.

`app/components/admin/__tests__/fairnessEngineV3.test.tsx` — the header comment's second sentence, the mock (its line goes; the blank lines around it stay), the describe's name, and `engine="v3"` on each render. Find:
```tsx
// engine is v2. Here the constant is mocked to "v3": every surface keeps its Switch
// and drops the note. (The v2 side is asserted beside each surface's own tests.)
```
Replace with:
```tsx
// engine is v2. Here the server-resolved engine prop is "v3" (C6 CTL-1): every surface keeps its Switch and drops the note. (The v2 side is asserted beside each surface's own tests.)
```
Find:
```tsx
vi.mock("../solverEngine", () => ({ SOLVER_ENGINE: "v3" }));

import MonthCalendar from "../MonthCalendar";
```
Replace with:
```tsx

import MonthCalendar from "../MonthCalendar";
```
Find `describe('the note under SOLVER_ENGINE "v3"', () => {` → Replace with `describe('the note under engine "v3" (the prop)', () => {`. Find `render(<FairnessEngineNote />)` → Replace with `render(<FairnessEngineNote engine="v3" />)`. Find `      <PlannerGrid\n        rows={buildRows()}` → Replace with `      <PlannerGrid\n        engine="v3"\n        rows={buildRows()}`. Find `      <MonthCalendar\n        year={2026}` → Replace with `      <MonthCalendar\n        engine="v3"\n        year={2026}`.

- [ ] **Step 9: Run the tests, the whole suite and the gates**

Run: `git add -A && npx vitest run app/components/admin/__tests__/engineProp.test.ts app/components/admin/__tests__/engineWiring.test.tsx app/components/admin/__tests__/fairnessEngineV3.test.tsx app/components/admin/__tests__/fairnessSwitch.test.tsx app/components/admin/__tests__/solverEngine.test.ts app/utils/__tests__/solverDeployment.test.ts`
Expected: PASS (C1's `solverEngine.test.ts` green and unedited — the pin of `"v2"` and its annotation stays C1's alone).

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 errors; every pre-existing test green (they render without `engine`, i.e. v2); warnings ≤ baseline.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(planner): resolve the solver engine on the server and gate C1/C3's v2 notes on it

The effective engine (C2's resolver: the constant, or the Preview-only override on the preview
branch and locally) is resolved by /admin's Server Component and threaded as a prop to the planner,
because a client cannot read the override and must never disagree with the server inside one
bundle. C1's «aplica con el nuevo solver» note and C3's card-chip note now follow that prop, so a
Preview with the override hides them while production keeps them. The union type moves into C1's
module, the one client-importable home, and the resolver's module re-exports it."
```

---

## Task 2: The solve route — engine check, 409, and the v3 transport; `OWT_SOLVER_V3_URL` documented — [standard, touches SECRETS]

**Files:**
- Create: `app/components/admin/v3Wire.ts`
- Create: `app/utils/solverV3Upstream.ts`
- Modify: `app/api/admin/solve/route.ts:1-4,173-189`
- Modify: `docs/SECRETS.md` (new section before `## Not yet documented`)
- Create (tests): `app/utils/__tests__/solverV3Upstream.test.ts`, `app/api/__tests__/solveRouteV3.test.ts`
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: C2 `resolveSolverEngine` (IF2-14); C5's request/response contract (C5 §5, §8; `contract: 3`, `engine: "v3"`, failure `{ ok: false, contract: 3, engine: "v3", code, params }` at 422/400/401/405/503/500); C5's local entry `python gcf_v3/owt_solver_v3.py --json-mode` (C5 §11.1; C5 Task 10, verified at replay).
- Produces: `v3Wire.ts` — `V3Role`, `V3_ROLES`, `V3ServiceKind`, `V3Service`, `V3Person`, `V3Rule`, `V3Pin`, `V3Prior`, `V3SolveRequest`, `V3Stage`, `V3TabFigures`, `V3FairnessPerson`, `V3Success`, `V3Failure`, `V3TransportReason`, `V3TransportError`, `V3VersionMismatch`, `isV3Body(body: unknown): boolean` (exact definitions below; every later task uses them). `solverV3Upstream.ts` — `V3_UPSTREAM_TIMEOUT_MS = 55_000`, `isV3Body` (re-exported from `v3Wire.ts`), `classifyUpstream(status: number, text: string): V3UpstreamResult`, `solveV3(body, env?, fetchImpl?, timeoutMs?): Promise<V3UpstreamResult>` with `V3UpstreamResult = { status: 200 | 422; text: string; outcome: string }`. Route: `409 { ok: false, error: "solver_version_mismatch", engine }`.

- [ ] **Step 1: Write the wire types** — Create `app/components/admin/v3Wire.ts`

```ts
// app/components/admin/v3Wire.ts
//
// The `contract: 3` wire as C6 builds and reads it (C5 §5 request, §8 response — C5's spec is the
// source; these are C6's typed view of it). NEUTRAL: types, two constants and the contract marker
// `isV3Body`, imported by the client modules, the request builder, the solve route and the
// server-only transport alike.
//
// Key hygiene (C6 KH-1, parent A41): a request's rule ids are MINTED by C6 (`v3RuleIds.ts`), never
// a config key; `P:<id>` keys in `carried` and `fairness.lines` carry minted ids too.

import type { LineKey, RoleKey, TabKey } from "@/app/utils/fairnessVocabulary";

export type V3Role = "Lead" | "BGV" | "Choir";
export const V3_ROLES: readonly V3Role[] = ["Lead", "BGV", "Choir"];

export type V3ServiceKind = "sunday" | "saturday" | "special";

/** C5 §5.2. `seats` only when not fixed; a non-fixed `saturday` sends no `Choir`. */
export interface V3Service {
  id: string;
  date: string;
  month: string;
  kind: V3ServiceKind;
  time?: string;
  fixed: boolean;
  counts: boolean;
  seats?: { Lead: number; BGV: number; Choir?: number };
}

/** C5 §5.3. `dl_since` and `prev_dl_leads` are always sent (C5's parser requires both). */
export interface V3Person {
  id: string;
  name: string;
  exempt: boolean;
  eligibility: Record<string, V3Role[]>;
  carried: Partial<Record<LineKey, number>>;
  cadence?: Record<string, "on" | "off" | "out">;
  dl_since: string | null;
  prev_dl_leads: number;
}

/** C5 §5.4. C6 never emits `consecutive` (today's UI has none — spec RQ-5). */
export type V3Rule =
  | { kind: "count"; id: string; person: string; roles: RoleKey[]; op: "==" | "<=" | ">="; month: string; value: number }
  | { kind: "pair"; id: string; persons: [string, string]; roles: RoleKey[]; month?: string }
  | { kind: "presence"; id: string; persons: string[]; roles: RoleKey[]; exclusive: boolean; month?: string };

/** C5 §5.5. */
export interface V3Pin {
  service: string;
  date: string;
  role: V3Role;
  person: string;
}

/** C5 §5.6 — built from the roles read, never from the ledger (spec RQ-7). */
export interface V3Prior {
  month: string;
  has_services: boolean;
  services: Array<{
    date: string;
    kind: V3ServiceKind;
    counts: boolean;
    seats: { Lead: string[]; BGV: string[]; Choir: string[] };
  }>;
}

/** C5 §5.1. No `budget` in production (spec RQ-8); no v2 field ever. */
export interface V3SolveRequest {
  contract: 3;
  seed: number;
  request_id: string;
  months: string[];
  services: V3Service[];
  people: V3Person[];
  rules: V3Rule[];
  pins: V3Pin[];
  prior: V3Prior;
}

export interface V3Stage {
  id: string;
  status: "proven" | "unproven" | "not_run";
  reason?: "budget" | "no_solution_in_limit" | "stopped_earlier";
  value: number;
  bound: number;
  limit: string;
  ms: number;
  det_milli: number;
}

/** One display tab of a person (C5 §8.2 `tabs`): hundredths, plus the integer seat counts (A39) and tenths. */
export interface V3TabFigures {
  carried: number;
  share: number;
  received: number;
  pinned: number;
  seats: number;
  pinned_seats: number;
  after: number;
  tenths: { share: number; after: number };
}

export interface V3FairnessPerson {
  person: string;
  floor: Array<{ month: string; planned: boolean; realised: boolean; seat: { service: string; role: V3Role } | null }>;
  lines: Partial<Record<LineKey, V3TabFigures & { planned: number; set_aside: number; in_stage: boolean; clamped: boolean }>>;
  tabs: Partial<Record<TabKey, V3TabFigures>>;
}

/** C5 §8.1. */
export interface V3Success {
  ok: true;
  contract: 3;
  engine: "v3";
  solver_version: string;
  build: string;
  request_id: string | null;
  seed: number;
  months: string[];
  reproducible: boolean;
  assignments: Record<string, Partial<Record<V3Role, string[]>>>;
  unfilled: Array<{ service: string; role: V3Role; count: number; reason: string }>;
  pins: { requested: number; honored: number };
  violations: Array<{
    code: string; rule: string; cause: string; person?: string; persons?: string[]; month?: string;
    service?: string; weekends?: string[]; observed?: number; limit?: number;
  }>;
  violation_ceiling: { value: number; proven: boolean };
  stages: V3Stage[];
  total_ms: number;
  fairness: { scale: number; tolerance: number; lines: string[]; people: V3FairnessPerson[] };
  cadence: Array<{ person: string; month: string; state: string; sundays: number; saturdays: number; met: boolean; compensation: string }>;
  missed: Array<{ code: string; person: string; month?: string; month1?: string; month2?: string; dates?: string[]; count?: number; cause: string }>;
  notices: Array<{ code: string; params: Record<string, unknown> }>;
}

/** C5 §8.3, as the route forwards it (always 422, spec RT-5). */
export interface V3Failure {
  ok: false;
  contract: 3;
  engine: "v3";
  code: string;
  params: Record<string, unknown>;
}

/** The route's own failures (spec RT-5): never a 500, never a solver code. */
export type V3TransportReason = "timeout" | "unreachable" | "http_status" | "not_json" | "not_configured" | "contract_echo";

export interface V3TransportError {
  ok: false;
  transport_error: true;
  transport: V3TransportReason;
}

/** spec RT-1 — the server's engine decided against the body's contract. */
export interface V3VersionMismatch {
  ok: false;
  error: "solver_version_mismatch";
  engine: "v2" | "v3";
}

/**
 * The v3 contract marker (C5 §5.1). It classifies; the SERVER's engine decides (RT-1). Lives here,
 * not in the server-only transport, so the solve route can classify every body without loading
 * that module on the v2 path.
 */
export function isV3Body(body: unknown): boolean {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    && (body as { contract?: unknown }).contract === 3;
}
```

- [ ] **Step 2: Write the failing transport test** — `app/utils/__tests__/solverV3Upstream.test.ts`

```ts
// Solver v3 C6 RT-3–RT-6 — the v3 transport: one classification for every upstream answer,
// a 55 s abort on both paths, the local entry point only off Vercel, nothing ever a 500.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn: (...a: unknown[]) => h.spawn(...a) }));

import { V3_UPSTREAM_TIMEOUT_MS, classifyUpstream, isV3Body, solveV3 } from "@/app/utils/solverV3Upstream";

const OK = JSON.stringify({ ok: true, contract: 3, engine: "v3", assignments: {} });
const coded = (code: string) => JSON.stringify({ ok: false, contract: 3, engine: "v3", code, params: {} });
const body = { contract: 3, seed: 1, months: ["2026-11"] };

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter; stdin: { write: (s: string) => void; end: () => void }; kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  h.spawn.mockReturnValue(child);
  return child;
}

beforeEach(() => h.spawn.mockReset());
afterEach(() => vi.useRealTimers());

describe("isV3Body (RT-1: the contract marker classifies; the engine decides)", () => {
  it("is true only for an object whose contract is 3", () => {
    expect(isV3Body(body)).toBe(true);
    expect(isV3Body({ contract: "3" })).toBe(false);
    expect(isV3Body({ weeks: 4, sunday_leads: ["Ana"] })).toBe(false);
    expect(isV3Body(null)).toBe(false);
    expect(isV3Body([{ contract: 3 }])).toBe(false);
  });
});

describe("classifyUpstream (RT-5, RT-6)", () => {
  it("a v3 success is forwarded verbatim with 200", () => {
    expect(classifyUpstream(200, OK)).toEqual({ status: 200, text: OK, outcome: "ok" });
  });

  it.each([422, 400, 401, 405, 503, 500])("a coded v3 failure at HTTP %i is forwarded verbatim as 422", (status) => {
    const text = coded(status === 401 ? "unauthorized" : status === 503 ? "misconfigured" : "invalid_request");
    expect(classifyUpstream(status, text)).toEqual({ status: 422, text, outcome: JSON.parse(text).code });
  });

  it("a non-2xx answer without a coded v3 body is http_status", () => {
    expect(JSON.parse(classifyUpstream(502, "<html>bad gateway</html>").text)).toEqual(
      { ok: false, transport_error: true, transport: "http_status" },
    );
  });

  it("a 2xx answer that is not JSON is not_json", () => {
    expect(JSON.parse(classifyUpstream(200, "Traceback").text).transport).toBe("not_json");
  });

  it("a 2xx JSON answer without contract 3 and engine v3 is contract_echo (e.g. a v2 function at the v3 URL)", () => {
    const v2 = JSON.stringify({ ok: true, schedule: {} });
    expect(classifyUpstream(200, v2)).toEqual({
      status: 422, text: JSON.stringify({ ok: false, transport_error: true, transport: "contract_echo" }), outcome: "contract_echo",
    });
  });
});

describe("solveV3 — remote (RT-3, RT-4)", () => {
  const env = { OWT_SOLVER_V3_URL: "https://v3.example/solve", OWT_SOLVER_API_KEY: "test-key", VERCEL_ENV: "preview" };

  it("posts the body with the X-Api-Key header and forwards the answer", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => OK }));
    const out = await solveV3(body, env, fetchImpl);
    expect(out).toEqual({ status: 200, text: OK, outcome: "ok" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://v3.example/solve");
    expect(init.headers["X-Api-Key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("a fetch that throws is unreachable", async () => {
    const out = await solveV3(body, env, vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(JSON.parse(out.text).transport).toBe("unreachable");
  });

  it("aborts at 55 s and answers the timeout transport", async () => {
    vi.useFakeTimers();
    expect(V3_UPSTREAM_TIMEOUT_MS).toBe(55_000);
    const fetchImpl = vi.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const pending = solveV3(body, env, fetchImpl as never);
    await vi.advanceTimersByTimeAsync(54_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.parse((await pending).text)).toEqual({ ok: false, transport_error: true, transport: "timeout" });
  });
});

describe("solveV3 — no URL (RT-3)", () => {
  it("on a Vercel deployment answers not_configured and never spawns", async () => {
    const out = await solveV3(body, { VERCEL_ENV: "preview" }, vi.fn());
    expect(JSON.parse(out.text).transport).toBe("not_configured");
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("off Vercel runs the local v3 entry point and classifies its stdout the same way", async () => {
    const child = fakeChild();
    const pending = solveV3(body, {}, vi.fn());
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());
    const [, args] = h.spawn.mock.calls[0] as [string, string[]];
    expect(args[0].endsWith("gcf_v3/owt_solver_v3.py")).toBe(true);
    expect(args[1]).toBe("--json-mode");
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(body));
    child.stdout.emit("data", Buffer.from(coded("timeout")));
    child.emit("close", 0);
    expect(await pending).toEqual({ status: 422, text: coded("timeout"), outcome: "timeout" });
  });

  it("the local path is killed at 55 s too", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const pending = solveV3(body, {}, vi.fn());
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(55_000);
    expect(JSON.parse((await pending).text).transport).toBe("timeout");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("a process that fails to start is unreachable; no output is not_json", async () => {
    const first = fakeChild();
    const a = solveV3(body, {}, vi.fn());
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(1));
    first.emit("error", new Error("ENOENT"));
    expect(JSON.parse((await a).text).transport).toBe("unreachable");
    const second = fakeChild();
    const b = solveV3(body, {}, vi.fn());
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(2));
    second.emit("close", 1);
    expect(JSON.parse((await b).text).transport).toBe("not_json");
  });
});
```

- [ ] **Step 3: Write the failing route test** — `app/api/__tests__/solveRouteV3.test.ts`

```ts
// Solver v3 C6 RT-1, RT-2, KH-2 — the solve route under each engine. The engine comes from C2's
// resolver: the constant ("v2"), or OWT_SOLVER_ENGINE with VERCEL_ENV unset (local), which is
// how these tests pick v3. Existing v2 behaviour stays pinned by `solveRoute.test.ts`, unedited.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ requireActiveManager: vi.fn(), spawn: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/authGuards", () => ({ requireActiveManager: () => h.requireActiveManager() }));
vi.mock("child_process", () => ({ spawn: (...a: unknown[]) => h.spawn(...a) }));

import { POST, maxDuration } from "@/app/api/admin/solve/route";

const V2_BODY = { weeks: 4, weekends_with_saturday: [5], sunday_leads: ["Ana"], saturday_leads: [], support: [], dsl_rules: [], history: [] };
// Name-shaped on purpose (KH-2): every identifier below must stay out of the route's logs.
const V3_BODY = {
  contract: 3, seed: 7, request_id: "req-ana-bruno", months: ["2026-11"],
  services: [{ id: "svc-ana-bruno", date: "2026-11-01", month: "2026-11", kind: "sunday", fixed: false, counts: true, seats: { Lead: 1, BGV: 1, Choir: 0 } }],
  people: [{ id: "m-ana", name: "Ana", exempt: false, eligibility: { "svc-ana-bruno": ["Lead"] }, carried: { "P:d-ana-bruno": 50 }, dl_since: null, prev_dl_leads: 0 }],
  rules: [{ kind: "presence", id: "d-ana-bruno", persons: ["m-ana"], roles: ["Sun.BGV"], exclusive: false, month: "2026-11" }],
  pins: [], prior: { month: "2026-10", has_services: false, services: [] },
};
const SECRETS = ["req-ana-bruno", "svc-ana-bruno", "m-ana", "Ana", "d-ana-bruno", "P:"];
const req = (b: unknown) => ({ json: async () => b }) as unknown as NextRequest;

let logs: string[];
beforeEach(() => {
  h.requireActiveManager.mockResolvedValue({ user: { role: "admin" } });
  h.spawn.mockReset();
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const asV3 = () => { vi.stubEnv("OWT_SOLVER_ENGINE", "v3"); vi.stubEnv("VERCEL_ENV", ""); };

describe("maxDuration (spec ceiling)", () => {
  it("stays 60 s — the v3 abort (55 s) fits inside it", () => expect(maxDuration).toBe(60));
});

describe("RT-1 — a body of the other contract is a 409 before anything else", () => {
  it("v3 body under v2: 409 with the engine, no upstream call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OWT_SOLVER_URL", "https://v2.example/solve");
    vi.stubEnv("OWT_SOLVER_V3_URL", "https://v3.example/solve");
    const res = await POST(req(V3_BODY));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "solver_version_mismatch", engine: "v2" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("v2 body under v3: 409 before v2's own validation (even with empty sunday_leads)", async () => {
    asV3();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(req({ ...V2_BODY, sunday_leads: [] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "solver_version_mismatch", engine: "v3" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("RT-2 — v2 under v2 is today's path", () => {
  it("forwards the received body upstream unchanged", async () => {
    vi.stubEnv("OWT_SOLVER_URL", "https://v2.example/solve");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, schedule: {} }) }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(req(V2_BODY));
    expect(res.status).toBe(200);
    const init = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1];
    expect(JSON.parse(init.body)).toEqual(V2_BODY);
  });
});

describe("RT-3 / RT-5 / RT-6 — v3 under v3", () => {
  beforeEach(asV3);

  it("forwards a success byte for byte", async () => {
    vi.stubEnv("OWT_SOLVER_V3_URL", "https://v3.example/solve");
    const text = JSON.stringify({ ok: true, contract: 3, engine: "v3", stages: [{ id: "balance_max:P:d-ana-bruno", status: "proven" }] });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => text })));
    const res = await POST(req(V3_BODY));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(text);
  });

  it("a 401 coded body arrives as 422 with its code", async () => {
    vi.stubEnv("OWT_SOLVER_V3_URL", "https://v3.example/solve");
    const text = JSON.stringify({ ok: false, contract: 3, engine: "v3", code: "unauthorized", params: {} });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => text })));
    const res = await POST(req(V3_BODY));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(JSON.parse(text));
  });

  it("on a deployment without the URL answers not_configured as JSON", async () => {
    vi.stubEnv("OWT_SOLVER_ENGINE", "v3");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "preview");
    vi.stubEnv("OWT_SOLVER_V3_URL", "");
    const res = await POST(req(V3_BODY));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, transport_error: true, transport: "not_configured" });
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe("KH-2 — the route logs no request content", () => {
  beforeEach(asV3);
  const answers: Array<[string, () => Promise<unknown>]> = [
    ["success", async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, contract: 3, engine: "v3", request_id: "req-ana-bruno", assignments: { "svc-ana-bruno": { Lead: ["m-ana"] } } }) })],
    ["coded failure", async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ ok: false, contract: 3, engine: "v3", code: "unknown_person", params: { field: "pins[0].person", person: "m-ana" } }) })],
    ["http_status", async () => ({ ok: false, status: 502, text: async () => "upstream m-ana" })],
    ["not_json", async () => ({ ok: true, status: 200, text: async () => "Ana" })],
    ["contract_echo", async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, person: "m-ana" }) })],
    ["unreachable", async () => { throw new Error("connect ECONNREFUSED svc-ana-bruno"); }],
  ];

  it.each(answers)("%s: one log line with engine, outcome, status and timing only", async (_name, answer) => {
    vi.stubEnv("OWT_SOLVER_V3_URL", "https://v3.example/solve");
    vi.stubGlobal("fetch", vi.fn(answer));
    await POST(req(V3_BODY));
    expect(logs).toHaveLength(1);
    for (const secret of SECRETS) expect(logs[0]).not.toContain(secret);
    expect(Object.keys(JSON.parse(logs[0])).sort()).toEqual(["engine", "ms", "outcome", "route", "status"]);
  });
});
```

- [ ] **Step 4: Run both to see them fail**

Run: `git add -A && npx vitest run app/utils/__tests__/solverV3Upstream.test.ts app/api/__tests__/solveRouteV3.test.ts`
Expected: FAIL — `Cannot find module '@/app/utils/solverV3Upstream'`, and the route answers v3 bodies through the v2 path.

- [ ] **Step 5: Write the transport** — Create `app/utils/solverV3Upstream.ts`

```ts
// app/utils/solverV3Upstream.ts
//
// The v3 half of `POST /api/admin/solve` (solver v3 C6 RT-3–RT-6, KH-2). Server-only: it reads
// `OWT_SOLVER_V3_URL`/`OWT_SOLVER_API_KEY` and may spawn the local entry point.
//
// ONE classification for every upstream answer (RT-5):
//   · `ok:false, contract:3, engine:"v3", code:string` — the solver's own coded failure, whatever
//     its HTTP status (C5 §8.3 uses 422, 400, 401, 405, 503, 500) → forwarded verbatim as 422;
//   · `ok:true, contract:3, engine:"v3"` → forwarded verbatim as 200 (RT-6: never rewritten);
//   · anything else → a route-made `{ ok:false, transport_error:true, transport }` as 422 — never a 500.
// The v3 call is aborted at 55 s on both paths (RT-4); `maxDuration` stays 60. v2 is untouched.

import "server-only";
import { spawn } from "child_process";
import path from "path";
import type { V3TransportError, V3TransportReason } from "@/app/components/admin/v3Wire";

export { isV3Body } from "@/app/components/admin/v3Wire";

export const V3_UPSTREAM_TIMEOUT_MS = 55_000;

export interface V3UpstreamResult {
  status: 200 | 422;
  /** The exact bytes to answer with. */
  text: string;
  /** For the route's one log line only: "ok", a transport reason, or the coded failure's code. */
  outcome: string;
}

type Env = Readonly<Record<string, string | undefined>>;
type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function transport(reason: V3TransportReason): V3UpstreamResult {
  const body: V3TransportError = { ok: false, transport_error: true, transport: reason };
  return { status: 422, text: JSON.stringify(body), outcome: reason };
}

function asRecord(json: unknown): Record<string, unknown> | null {
  return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
}

/** RT-5 — the one point of classification. Exported for its unit test. */
export function classifyUpstream(status: number, text: string): V3UpstreamResult {
  let json: unknown;
  let parsed = true;
  try { json = JSON.parse(text); } catch { parsed = false; }
  const o = parsed ? asRecord(json) : null;
  if (o && o.ok === false && o.contract === 3 && o.engine === "v3" && typeof o.code === "string") {
    return { status: 422, text, outcome: o.code };
  }
  if (status < 200 || status >= 300) return transport("http_status");
  if (!parsed) return transport("not_json");
  if (o && o.ok === true && o.contract === 3 && o.engine === "v3") return { status: 200, text, outcome: "ok" };
  return transport("contract_echo");
}

async function callRemote(url: string, body: unknown, env: Env, fetchImpl: FetchLike, timeoutMs: number): Promise<V3UpstreamResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiKey = env.OWT_SOLVER_API_KEY ?? "";
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "X-Api-Key": apiKey } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return classifyUpstream(res.status, await res.text());
  } catch {
    return transport(controller.signal.aborted ? "timeout" : "unreachable");
  } finally {
    clearTimeout(timer);
  }
}

/** C5 §11.1: one request on stdin, one response on stdout, exit 0 even for `ok:false`. */
function callLocal(body: unknown, env: Env, timeoutMs: number): Promise<V3UpstreamResult> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), "gcf_v3", "owt_solver_v3.py");
    const python = env.OWT_SOLVER_PYTHON
      ?? "/opt/homebrew/Caskroom/miniforge/base/envs/owt-roles/bin/python3";
    let settled = false;
    const done = (result: V3UpstreamResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(python, [scriptPath, "--json-mode"], { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(transport("timeout"));
    }, timeoutMs);
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    // Drained and discarded: the CLI's stderr is its own count-only log line (C5 §11.2); nothing
    // of it is read, logged or forwarded here (KH-2).
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      done(transport("unreachable"));
    });
    child.on("close", () => {
      clearTimeout(timer);
      const out = stdout.trim();
      done(out ? classifyUpstream(200, out) : transport("not_json"));
    });
    child.stdin.write(JSON.stringify(body));
    child.stdin.end();
  });
}

/**
 * RT-3: remote when `OWT_SOLVER_V3_URL` is set; otherwise the local entry point, but ONLY off Vercel
 * (`VERCEL_ENV` unset or empty); on a deployment without the URL, `not_configured` — never a spawn.
 */
export async function solveV3(
  body: unknown,
  env: Env = process.env,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs: number = V3_UPSTREAM_TIMEOUT_MS,
): Promise<V3UpstreamResult> {
  const url = env.OWT_SOLVER_V3_URL;
  if (url) return callRemote(url, body, env, fetchImpl, timeoutMs);
  if (!env.VERCEL_ENV) return callLocal(body, env, timeoutMs);
  return transport("not_configured");
}
```

- [ ] **Step 6: Wire the route** — `app/api/admin/solve/route.ts`

Find:
```ts
import { spawn } from "child_process";
import path from "path";
```
Replace with:
```ts
import { spawn } from "child_process";
import path from "path";
import { resolveSolverEngine } from "@/app/utils/solverDeployment";
import { isV3Body } from "@/app/components/admin/v3Wire";
```
Find:
```ts
  if (!body.sunday_leads?.length) {
```
Replace with:
```ts
  // Solver v3 C6 RT-1: after auth and the JSON parse, the SERVER's effective engine decides; the
  // body's contract only classifies it. A body of the other contract is refused before any other
  // validation and before any upstream call — the page was rendered under another engine.
  const engine = resolveSolverEngine(process.env);
  const v3Body = isV3Body(body);
  if (v3Body !== (engine === "v3")) {
    return NextResponse.json({ ok: false, error: "solver_version_mismatch", engine }, { status: 409 });
  }
  if (v3Body) {
    const started = Date.now();
    // The transport is `server-only` and loaded on the v3 branch alone: the v2 path never loads it,
    // so it stays byte-for-byte today's and `solveRoute.test.ts` runs unedited (no `server-only` mock).
    const { solveV3 } = await import("@/app/utils/solverV3Upstream");
    const result = await solveV3(body);
    // KH-2: engine, outcome class, status and timing — never a byte of the request or response.
    // A coded failure's `code` is a registry token; anything else is logged as "coded".
    const outcome = /^[a-z_]{1,40}$/.test(result.outcome) ? result.outcome : "coded";
    console.info(JSON.stringify({ route: "admin/solve", engine, outcome, status: result.status, ms: Date.now() - started }));
    return new NextResponse(result.text, { status: result.status, headers: { "Content-Type": "application/json" } });
  }

  if (!body.sunday_leads?.length) {
```

- [ ] **Step 7: Document `OWT_SOLVER_V3_URL`** — `docs/SECRETS.md` (DOC-1; never a value)

Find:
```markdown
## Not yet documented
```
Replace with:
```markdown
## `OWT_SOLVER_V3_URL` (solver v3 — the URL of the `owt-solver-v3` function)

**Needed in: Vercel Preview (first, for C7's rehearsal) and Vercel Production (before C7's flip
merges) — one Preview-wide value like `OWT_SOLVER_URL`, no branch-scoped pair, so
`verify/service-readiness` has it too. Not needed in:** `.env.local` (with it unset and
`VERCEL_ENV` unset, the route runs `python gcf_v3/owt_solver_v3.py --json-mode` locally — set it
locally only to call the deployed function), GitHub Actions, the iOS build. Not read by either Cloud
Function.

**Not a secret** — ordinary, non-sensitive config, like `OWT_SOLVER_URL`: added as `--type config`
(readable, never `Sensitive`); the function is protected by `OWT_SOLVER_API_KEY` (sent as
`X-Api-Key` on every v3 call too, C5-14), not by its URL.

**Purpose — what breaks without it.** `app/utils/solverV3Upstream.ts` (called by
`app/api/admin/solve/route.ts`) posts every `contract: 3` request here. While a deployment's
effective engine is `v2` (production until C7's flip) nothing reads it. Once the engine is `v3`
there — the `preview` branch with `OWT_SOLVER_ENGINE=v3`, or production after the flip — an
unset value makes every Auto answer «No se pudo usar el solver (not_configured)…» and nothing is
applied or written. A wrong value answers `unreachable`, `http_status`, `not_json` or — if it
points at the v2 function — `contract_echo`, each with its own copy; still nothing is applied.

**Where it comes from.** `URL="$(gcloud functions describe owt-solver-v3 --gen2
--region=us-central1 --format='value(serviceConfig.uri)')"` (C5 §11.5), then
`printf '%s' "$URL" | npx vercel env add OWT_SOLVER_V3_URL <preview|production> --type config` —
never typed into a file or a chat. C6 introduces the variable and sets it nowhere: setting it on
Preview is C7's consented write W0 (its Step 2a) and on Production W4 (its Step 6).

**Rotate / change.** `vercel env add` refuses an existing key, so a rotation is `rm` + `add` back
to back, then one redeploy: (1) read the current URL into `$URL` with the describe command above;
(2) for each environment that has it, `npx vercel env rm OWT_SOLVER_V3_URL <env> --yes` and
immediately `printf '%s' "$URL" | npx vercel env add OWT_SOLVER_V3_URL <env> --type config`;
(3) redeploy that environment once (the value binds at build time) and verify the alias and its
`githubCommitSha`; (4) run one Auto «1 mes» on dev without confirming. A URL changes only if the
function is re-created under another name or region.

**Blast radius.** Between the `rm` and the redeploy, the running deployment keeps the old value,
so nothing changes until the new build serves; a deployment whose engine is `v2` is unaffected
throughout. A build that starts between the `rm` and the `add` has no value, so v3 Auto there
answers `not_configured` until the next redeploy — hence the two commands back to back and one
redeploy after both. If the new value is wrong, v3 Auto on that deployment answers a transport
error until it is corrected — no record or draft is ever written by a failed solve.

**Status.** Introduced by C6; not set on any Vercel environment yet (C7 W0/W4 record the dates here).

---

## Not yet documented
```

- [ ] **Step 8: Run the tests and the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/utils/__tests__/solverV3Upstream.test.ts app/api/__tests__/solveRouteV3.test.ts app/api/__tests__/solveRoute.test.ts`
Expected: PASS — including every pre-existing `solveRoute.test.ts` case, unedited (RT-2).

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 errors; warnings ≤ baseline.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(solver): the solve route checks the engine and calls the v3 function under v3

A page rendered under one engine can post to a server that now runs the other, so the route
classifies the body by its contract marker and answers 409 solver_version_mismatch on a
mismatch before any other validation. Under v3 it calls OWT_SOLVER_V3_URL (or the local entry
point off Vercel) with a 55 s abort and one classification: the solver's coded failures are
forwarded as 422, successes verbatim, everything else a JSON transport error — never a 500 and
never a log line with request content. The v2 path is byte-for-byte today's. The new URL gets its
docs/SECRETS.md entry in the same change; C7 sets it."
```

---

## Task 3: The horizon model — months, date ownership, past and ceiling refusals — [standard]

**Files:**
- Create: `app/components/admin/v3Horizon.ts`
- Create (test): `app/components/admin/__tests__/v3Horizon.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: C2 `monthIndex`, `shiftMonth` (`app/utils/fairnessVocabulary.ts`), `civilDayOfWeek` (`app/utils/fairnessLedger.ts`, 0 = Sunday … 6 = Saturday).
- Produces: `type HorizonLength = 1 | 2`; `HORIZON_MONTHS_AHEAD = 12`; `horizonMonths(first: string, length: HorizonLength): string[]`; `monthOfDate(date: string): string`; `cdmxTodayIso(now: Date): string`; `cdmxCurrentMonth(now: Date): string`; `type HorizonRefusal = { kind: "past"; month: string } | { kind: "ceiling"; month: string; limit: string }`; `horizonRefusal(months: readonly string[], currentMonth: string): HorizonRefusal | null`; `weekendDatesOfMonth(month: string): { sundays: string[]; saturdays: string[] }`; `retainInHorizon<T extends { date: string } | string>(items: readonly T[], months: readonly string[]): T[]`; `monthsEntering(previous: readonly string[], next: readonly string[]): string[]`.

- [ ] **Step 1: Write the failing test** — `app/components/admin/__tests__/v3Horizon.test.ts`

```ts
// Solver v3 C6 HZ-2, HZ-3, HZ-7, HZ-9 — the horizon's months, which month owns a date, and the two
// refusals Auto (and the confirm) apply before any read. Pure; the clock is an input.
import { describe, expect, it } from "vitest";

import {
  HORIZON_MONTHS_AHEAD, cdmxCurrentMonth, cdmxTodayIso, horizonMonths, horizonRefusal, monthOfDate,
  monthsEntering, retainInHorizon, weekendDatesOfMonth,
} from "../v3Horizon";

describe("horizonMonths (HZ-2)", () => {
  it("is the first month, or the first two consecutive months — across a year end too", () => {
    expect(horizonMonths("2026-11", 1)).toEqual(["2026-11"]);
    expect(horizonMonths("2026-12", 2)).toEqual(["2026-12", "2027-01"]);
  });
});

describe("date ownership (HZ-3)", () => {
  it("a date belongs to its own calendar month, by string", () => {
    expect(monthOfDate("2026-10-31")).toBe("2026-10");
  });

  it("Oct+Nov 2026 offers Saturday 31 Oct once, under October", () => {
    const oct = weekendDatesOfMonth("2026-10");
    const nov = weekendDatesOfMonth("2026-11");
    expect(oct.saturdays).toContain("2026-10-31");
    expect(nov.saturdays).not.toContain("2026-10-31");
    expect([...oct.saturdays, ...nov.saturdays].filter((d) => d === "2026-10-31")).toHaveLength(1);
    expect(nov.sundays).toEqual(["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]);
  });

  it("February of a leap year has its 29th", () => {
    expect(weekendDatesOfMonth("2032-02").sundays).toContain("2032-02-29");
  });
});

describe("the CDMX clock", () => {
  it("reads today in America/Mexico_City, not UTC", () => {
    // 2026-11-01T03:00Z is still 31 Oct in CDMX (UTC−6).
    const now = new Date("2026-11-01T03:00:00.000Z");
    expect(cdmxTodayIso(now)).toBe("2026-10-31");
    expect(cdmxCurrentMonth(now)).toBe("2026-10");
  });
});

describe("horizonRefusal (HZ-7 past, HZ-9 ceiling)", () => {
  it("admits the current month and current + 12", () => {
    expect(HORIZON_MONTHS_AHEAD).toBe(12);
    expect(horizonRefusal(["2026-10"], "2026-10")).toBeNull();
    expect(horizonRefusal(["2027-10"], "2026-10")).toBeNull();
  });

  it("refuses a month before the current one", () => {
    expect(horizonRefusal(["2026-09", "2026-10"], "2026-10")).toEqual({ kind: "past", month: "2026-09" });
  });

  it("refuses current + 13, naming the month and the limit", () => {
    expect(horizonRefusal(["2027-11"], "2026-10")).toEqual({ kind: "ceiling", month: "2027-11", limit: "2027-10" });
  });

  it("refuses a 2-month horizon whose SECOND month alone crosses", () => {
    expect(horizonRefusal(horizonMonths("2027-10", 2), "2026-10")).toEqual({ kind: "ceiling", month: "2027-11", limit: "2027-10" });
  });
});

describe("selections across a horizon change (HZ-2)", () => {
  it("keeps only dates of months still in the horizon", () => {
    const sats = ["2026-11-07", "2026-12-05", "2027-01-02"];
    expect(retainInHorizon(sats, ["2026-12", "2027-01"])).toEqual(["2026-12-05", "2027-01-02"]);
    const specials = [{ date: "2026-11-12", name: "Bautizos" }, { date: "2026-12-10", name: "Posada" }];
    expect(retainInHorizon(specials, ["2026-12"])).toEqual([{ date: "2026-12-10", name: "Posada" }]);
  });

  it("names the months that enter (their Saturdays start selected, as a month change does today)", () => {
    expect(monthsEntering(["2026-11", "2026-12"], ["2026-12", "2027-01"])).toEqual(["2027-01"]);
    expect(monthsEntering(["2026-11"], ["2026-11", "2026-12"])).toEqual(["2026-12"]);
    expect(monthsEntering(["2026-11", "2026-12"], ["2026-11"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/v3Horizon.test.ts`
Expected: FAIL — `Cannot find module '../v3Horizon'`.

- [ ] **Step 3: Write the module** — Create `app/components/admin/v3Horizon.ts`

```ts
// app/components/admin/v3Horizon.ts
//
// Solver v3 C6 §5.3 — the horizon (1 or 2 consecutive calendar months a v3 run plans) and the two
// refusals Auto and the confirm apply before any read or write:
//   · HZ-7 / CF-1 (A24, A40): a month before the current CDMX month;
//   · HZ-9 / CF-1: a month after the current CDMX month + 12, the last month C2's WR-4 accepts.
// NEUTRAL and pure: dates are CDMX strings, months move by integer arithmetic, weekdays come from
// C2's civil-calendar formula — never through a `Date` on a service date. The clock is an input.

import { monthIndex, shiftMonth } from "@/app/utils/fairnessVocabulary";
import { civilDayOfWeek } from "@/app/utils/fairnessLedger";

export type HorizonLength = 1 | 2;

/** C2 WR-4: a record month is at most the current CDMX month + 12 (spec HZ-9). */
export const HORIZON_MONTHS_AHEAD = 12;

export function horizonMonths(first: string, length: HorizonLength): string[] {
  return length === 2 ? [first, shiftMonth(first, 1)] : [first];
}

/** HZ-3: a date's month is its own `YYYY-MM` prefix — never through a `Date`. */
export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

/** CLAUDE.md's server-today rule, usable on the client: the CDMX calendar date. */
export function cdmxTodayIso(now: Date): string {
  return now.toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
}

export function cdmxCurrentMonth(now: Date): string {
  return cdmxTodayIso(now).slice(0, 7);
}

export type HorizonRefusal =
  | { kind: "past"; month: string }
  | { kind: "ceiling"; month: string; limit: string };

/** The first offending month, past before ceiling; `null` when every month is admissible. */
export function horizonRefusal(months: readonly string[], currentMonth: string): HorizonRefusal | null {
  const past = months.find((m) => monthIndex(m) < monthIndex(currentMonth));
  if (past) return { kind: "past", month: past };
  const limit = shiftMonth(currentMonth, HORIZON_MONTHS_AHEAD);
  const beyond = months.find((m) => monthIndex(m) > monthIndex(limit));
  return beyond ? { kind: "ceiling", month: beyond, limit } : null;
}

function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/**
 * HZ-3: the calendar month's OWN Sundays and Saturdays. A month-end Saturday whose Sunday is in the
 * next month is its own month's service (ADR-0048) and is never offered by the next month.
 */
export function weekendDatesOfMonth(month: string): { sundays: string[]; saturdays: string[] } {
  const sundays: string[] = [];
  const saturdays: string[] = [];
  for (let d = 1; d <= daysInMonth(month); d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const dow = civilDayOfWeek(date);
    if (dow === 0) sundays.push(date);
    else if (dow === 6) saturdays.push(date);
  }
  return { sundays, saturdays };
}

/** HZ-2: a per-date selection keeps only the dates of months still in the horizon. */
export function retainInHorizon<T extends { date: string } | string>(items: readonly T[], months: readonly string[]): T[] {
  const keep = new Set(months);
  return items.filter((item) => keep.has(monthOfDate(typeof item === "string" ? item : item.date)));
}

/** HZ-2: the months a horizon change brings in (they start with today's per-month defaults). */
export function monthsEntering(previous: readonly string[], next: readonly string[]): string[] {
  const before = new Set(previous);
  return next.filter((m) => !before.has(m));
}
```

- [ ] **Step 4: Run it, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3Horizon.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(planner): the v3 horizon model — months, date ownership, past and ceiling refusals

A v3 run plans one or two calendar months. Which month owns a date, which months Auto may plan
(never a past month: those records are the reconstruction's; never beyond the current month + 12,
the last month the record writer accepts) and how per-date selections survive a horizon change are
pure functions over CDMX strings, so Auto and the confirm apply the same rules before any read."
```

---

## Task 4: The Spanish copy keyed on codes, the registry sync and the pin-cap mirror — [standard]

**Files:**
- Create: `app/components/admin/v3Copy.ts`
- Create (tests): `app/components/admin/__tests__/v3Copy.test.ts`, `app/components/admin/__tests__/v3CodesSync.test.ts`, `app/components/admin/__tests__/v3PinCapSync.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: `dayLabel(iso)` (`plannerModel.ts`, «8 nov»); `capValueForMonth` (IF2-17, `serviceRuleContext.ts`) as a **type** only; `FairnessPutRefusal` (IF2-6); `EligibilityRefusalReason`, `EligibilityIssueCode` (IF2-15's unions, `app/utils/fairnessEligibility.ts`); `V3TransportReason` (Task 2); C5's `gcf_v3/owt_v3/codes.json` and `gcf_v3/owt_v3/constants.py` (read as text by the sync tests).
- Produces (every later task renders through these and nothing else):
  - `interface V3Names { person(id: string): string; rule(id: string): string; service(id: string): string }`; `interface CodeCopy { params: readonly string[]; render(p: Readonly<Record<string, unknown>>, n: V3Names): string }`
  - formatters `monthName(ym)`, `monthNameCap(ym)`, `monthsList(months, capitalFirst?)`, `joinEs(items)`, `datesList(dates)`, `lineLabel(line, n)`
  - registry copy `V3_COPY_BY_GROUP: Record<V3CopyGroup, Record<string, CodeCopy>>` for the twelve shown groups, `V3_HIDDEN_GROUPS = ["limit", "violation_rule"]`; renderers `stageLabel(id, n)`, `stageStatusLabel(status)`, `missedLine(m, n)`, `noticeLine(code, params, n)`, `violationLine(v, n)`, `refusalLine(code, params)`, `unknownCodeLine(code)`; constants `V3_UNFILLED_MARKER`, `noPossibleLeadNotice(service)`, `V3_CEILING_UNPROVEN`, `V3_UNPROVEN_EXPLANATION`, `V3_NOT_RUN_TAIL`, `V3_STAGE_REASON_LINE`
  - `V3_ROUTE_COPY` (§7.6), `transportLine(reason)`
  - `V3_LINES` — every C6-own line (§7.3–§7.9 and the ST/SP/WN/HZ/RQ/NT rows), `V3_RESOLVER_REFUSAL` (typed on `EligibilityRefusalReason`), `V3_RESOLVER_ISSUE` (typed on `EligibilityIssueCode`), `V3_CAP_REFUSAL` (typed on IF2-17's `reason`), `V3_CONFIRM_REFUSAL` (typed on `FairnessPutRefusal`), `V3_PANEL_REASON` (§7.7), `V3_CADENCE_STATE`, `V3_COMPENSATION`
  - `V3_PIN_CAP = 250`

- [ ] **Step 1: Write the failing sync tests**

`app/components/admin/__tests__/v3CodesSync.test.ts`:
```ts
// Solver v3 C6 NT-4 — every code C5 can emit has Spanish copy here, every copy names only
// parameters its code declares, and no copy exists for a code C5 does not list. Reads C5's registry
// (`gcf_v3/owt_v3/codes.json`) as data. Two registry groups are never shown and are excluded BY NAME:
// `limit` (none/deterministic/wall) and `violation_rule` (the fixed token `mandatory_lead`, which is
// rendered from the `violation` code's own copy, never through the rule-label map).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { V3_COPY_BY_GROUP, V3_HIDDEN_GROUPS, unknownCodeLine } from "../v3Copy";

const registry = JSON.parse(
  readFileSync(path.join(process.cwd(), "gcf_v3", "owt_v3", "codes.json"), "utf8"),
) as { contract: number; groups: Record<string, Record<string, string[]>> };

describe("C5's code registry ↔ C6's copy (NT-4)", () => {
  it("is the contract-3 registry", () => expect(registry.contract).toBe(3));

  it("every registry group is either copied here or excluded by name", () => {
    const copied = Object.keys(V3_COPY_BY_GROUP).sort();
    const all = Object.keys(registry.groups).sort();
    expect([...copied, ...V3_HIDDEN_GROUPS].sort()).toEqual(all);
  });

  for (const [group, codes] of Object.entries(registry.groups)) {
    if ((V3_HIDDEN_GROUPS as readonly string[]).includes(group)) continue;
    it(`group «${group}»: the same codes, and copy names only declared parameters`, () => {
      const copy = V3_COPY_BY_GROUP[group as keyof typeof V3_COPY_BY_GROUP];
      expect(Object.keys(copy).sort()).toEqual(Object.keys(codes).sort());
      for (const [code, params] of Object.entries(codes)) {
        for (const used of copy[code].params) expect(params).toContain(used);
      }
    });
  }

  it("a code not in the registry still renders a line at runtime", () => {
    expect(unknownCodeLine("brand_new")).toBe("El solver informó algo que el planificador no reconoce (brand_new).");
  });
});
```

`app/components/admin/__tests__/v3PinCapSync.test.ts`:
```ts
// Solver v3 C6 RQ-6, U8 — the v3 pin cap is ONE TS constant equal to C5's literal `PIN_CAP = 250`,
// which C5 keeps exactly once under gcf_v3/owt_v3/ (its own test pins the "exactly once").
// Fails when either side changes alone. v2's PINNED_CAP (100) is unrelated and untouched.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { V3_PIN_CAP } from "../v3Copy";
import { PINNED_CAP } from "../pinModel";

const PKG = path.join(process.cwd(), "gcf_v3", "owt_v3");

describe("the v3 pin cap mirrors C5's literal", () => {
  it("equals the one `PIN_CAP = <n>` line in gcf_v3/owt_v3", () => {
    const hits = readdirSync(PKG)
      .filter((f) => f.endsWith(".py"))
      .flatMap((f) => readFileSync(path.join(PKG, f), "utf8").split("\n").filter((l) => /^PIN_CAP = \d+$/.test(l)));
    expect(hits).toHaveLength(1);
    expect(V3_PIN_CAP).toBe(Number(hits[0].split("=")[1]));
  });

  it("leaves v2's cap alone", () => expect(PINNED_CAP).toBe(100));
});
```

`app/components/admin/__tests__/v3Copy.test.ts`:
```ts
// Solver v3 C6 §7 — the formatters and a sample of every family of lines, with fictitious people.
import { describe, expect, it } from "vitest";

import {
  V3_CAP_REFUSAL, V3_CONFIRM_REFUSAL, V3_LINES, V3_RESOLVER_ISSUE, V3_RESOLVER_REFUSAL, V3_ROUTE_COPY,
  datesList, lineLabel, missedLine, monthName, monthNameCap, monthsList, noticeLine, refusalLine, stageLabel,
  transportLine, violationLine, type V3Names,
} from "../v3Copy";

const names: V3Names = {
  person: (id) => ({ "m-ana": "Ana", "m-bruno": "Bruno" })[id] ?? "alguien que ya no está en la lista",
  rule: (id) => ({ c1: "Ana · Sun.Lead <= 1", r1: "Ana, Bruno en Sun.BGV c/sem" })[id] ?? "regla de presencia registrada",
  service: (id) => ({ s1: "domingo 8 nov" })[id] ?? id,
};

describe("formatters", () => {
  it("months and lists", () => {
    expect(monthName("2026-11")).toBe("noviembre");
    expect(monthNameCap("2026-11")).toBe("Noviembre");
    expect(monthsList(["2026-11", "2026-12"])).toBe("noviembre y diciembre");
    expect(monthsList(["2026-11", "2026-12"], true)).toBe("Noviembre y diciembre");
  });

  it("dates: one month, across months, three or more", () => {
    expect(datesList(["2026-11-15", "2026-11-08"])).toBe("8 y 15 nov");
    expect(datesList(["2026-10-31", "2026-11-07"])).toBe("31 oct y 7 nov");
    expect(datesList(["2026-11-01", "2026-11-08", "2026-11-15"])).toBe("1, 8 y 15 nov");
  });

  it("lines, with a presence sub-line named by its card", () => {
    expect(lineLabel("DL", names)).toBe("Dom Lead");
    expect(lineLabel("SL", names)).toBe("Sáb Lead");
    expect(lineLabel("CORO", names)).toBe("Coro");
    expect(lineLabel("P:r1", names)).toBe("BGV (Ana, Bruno en Sun.BGV c/sem)");
  });
});

describe("registry-keyed lines (§7.1–§7.5)", () => {
  it("stages, including a templated balance stage on a presence line", () => {
    expect(stageLabel("sunday_cap", names)).toBe("Un domingo al mes");
    expect(stageLabel("balance_max:DL", names)).toBe("Equidad Dom Lead: el más pendiente");
    expect(stageLabel("balance_sq:P:r1", names)).toBe("Equidad BGV (Ana, Bruno en Sun.BGV c/sem): reparto");
  });

  it("a missed protection carries its cause as a suffix", () => {
    expect(missedLine({ code: "cadence_on_missed", person: "m-ana", month: "2026-11", cause: "unavailable" }, names))
      .toBe("Ana no dirigió domingo en noviembre, su mes de dirigir («Mes por medio») — no tenía fechas disponibles.");
    expect(missedLine({ code: "consecutive_sundays", person: "m-bruno", dates: ["2026-11-08", "2026-11-15"], cause: "pins" }, names))
      .toBe("Bruno dirige domingos seguidos: 8 y 15 nov — por lo que ya estaba puesto.");
  });

  it("notices and rule breaks name the rule by its card label", () => {
    expect(noticeLine("exact_clamped", { rule: "c1", person: "m-ana", month: "2026-11", value: 2, available: 1 }, names))
      .toBe("«Ana · Sun.Lead <= 1» pide 2 en noviembre, pero Ana solo está disponible 1: se ajustó a 1.");
    expect(violationLine({ code: "count", rule: "c1", cause: "forced", person: "m-ana", month: "2026-11", observed: 2, limit: 1 }, names))
      .toBe("No se cumplió «Ana · Sun.Lead <= 1» en noviembre: quedó en 2 (pide 1) — no había forma de cumplirla junto con las demás reglas.");
    expect(violationLine({ code: "mandatory_lead", rule: "mandatory_lead", cause: "pins", service: "s1" }, names))
      .toBe("El domingo 8 nov quedó sin líder aunque alguien podía dirigir — por lo que ya estaba puesto.");
  });

  it("refusals by code, an unknown code generically", () => {
    expect(refusalLine("timeout", { stage: "fill", seconds: 25 })).toBe(V3_ROUTE_COPY.timeout);
    expect(refusalLine("invalid_request", { field: "pins[3].role", detail: "role_not_in_service" }))
      .toBe("El solver rechazó la solicitud por un error del planificador (invalid_request: pins[3].role). No se aplicó nada.");
    expect(refusalLine("misconfigured", {})).toBe("No se pudo usar el solver (misconfigured). No se aplicó nada; avisa a quien administra la app.");
    expect(refusalLine("never_heard_of_it", {})).toBe("El solver informó algo que el planificador no reconoce (never_heard_of_it).");
  });
});

describe("route outcomes (§7.6): timeout and connection are distinct (A24)", () => {
  it("maps each transport reason to its family", () => {
    expect(transportLine("timeout")).toBe(V3_ROUTE_COPY.timeout);
    expect(transportLine("unreachable")).toBe(V3_ROUTE_COPY.connection);
    expect(transportLine("not_json")).toBe(V3_ROUTE_COPY.connection);
    expect(transportLine("not_configured")).toBe("No se pudo usar el solver (not_configured). No se aplicó nada; avisa a quien administra la app.");
    expect(V3_ROUTE_COPY.timeout).not.toBe(V3_ROUTE_COPY.connection);
  });
});

describe("C6's own lines", () => {
  it("resolver refusals and issues are keyed on IF2-15's unions (§7.9)", () => {
    expect(V3_RESOLVER_REFUSAL.ambiguous("Ana", "2026-11", null))
      .toBe("No se puede correr Auto: «Ana» en las reglas coincide con más de una persona. Corrige el nombre en la regla.");
    expect(V3_RESOLVER_REFUSAL.exact_count_range("Ana", "2026-11", null))
      .toBe("No se puede correr Auto: la regla fija de Ana no da un número entero de 0 a 31 lugares en noviembre. Corrígela.");
    expect(V3_RESOLVER_ISSUE.too_many_people).toBe("No se puede correr Auto: hay más de 100 personas de voz.");
  });

  it("IF2-17 refusals name the card, never the key (§7.3)", () => {
    expect(V3_CAP_REFUSAL.not_whole("Ana · Sun.Lead <= 1.5", ["2026-11", "2026-12"]))
      .toBe("No se puede correr Auto: «Ana · Sun.Lead <= 1.5» no da un número entero de lugares en noviembre y diciembre. Corrige su número.");
    expect(V3_CAP_REFUSAL.negative("Ana · Sun.Lead >= -1", ["2026-11"]))
      .toBe("No se puede correr Auto: «Ana · Sun.Lead >= -1» pide un número negativo de lugares. Corrige su número.");
  });

  it("the past and ceiling lines (HZ-7, HZ-9, CF-1)", () => {
    expect(V3_LINES.horizonPast).toBe("Auto no planea meses que ya pasaron. Crea esos servicios a mano.");
    expect(V3_LINES.horizonCeiling("2027-11", "2027-10"))
      .toBe("Auto no planea más de 12 meses adelante: Noviembre queda fuera. Elige un mes hasta octubre.");
  });

  it("confirm refusals are keyed on IF2-6 (§7.8)", () => {
    expect(V3_CONFIRM_REFUSAL.month_has_services("2026-11"))
      .toBe("Se guardaron servicios en noviembre mientras planeabas, así que su registro ya no se puede reemplazar. No se creó nada; vuelve a correr Auto.");
    expect(V3_CONFIRM_REFUSAL.engine_not_v3("2026-11")).toBe("El solver cambió de versión. Recarga la página; no se creó nada.");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run app/components/admin/__tests__/v3CodesSync.test.ts app/components/admin/__tests__/v3PinCapSync.test.ts app/components/admin/__tests__/v3Copy.test.ts`
Expected: FAIL — `Cannot find module '../v3Copy'`.

- [ ] **Step 3: Write the copy module** — Create `app/components/admin/v3Copy.ts`

```ts
// app/components/admin/v3Copy.ts
//
// Solver v3 C6 §7 — EVERY Spanish line the v3 planner shows, keyed on codes. Nothing else in C6
// writes copy. Registry groups (C5's `gcf_v3/owt_v3/codes.json`) are mirrored in
// `V3_COPY_BY_GROUP`, each entry declaring the parameters it reads, so `v3CodesSync.test.ts` can fail
// on a missing code, an extra code or an undeclared parameter (NT-4). C6-own lines (§7.3's own,
// §7.6–§7.9, and the ST/SP/WN/HZ/RQ/NT rows) live in `V3_LINES` and the typed maps below; the maps
// keyed on C2's unions make a new C2 code without copy a `tsc` error.
//
// Parameters are rendered by the caller's `V3Names`: a member id → alias or name, a rule id → its
// card's label (never the id, never a config key — KH-1), a service id → «domingo 8 nov».

import { dayLabel } from "./plannerModel";
import type { capValueForMonth } from "./serviceRuleContext";
import type { V3TransportReason } from "./v3Wire";
import type { FairnessPutRefusal } from "@/app/utils/fairnessVocabulary";
import type { EligibilityIssueCode, EligibilityRefusalReason } from "@/app/utils/fairnessEligibility";

// ─── Formatting ─────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

export function monthNameCap(month: string): string {
  const n = monthName(month);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function joinEs(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export function monthsList(months: readonly string[], capitalFirst = false): string {
  return joinEs(months.map((m, i) => (capitalFirst && i === 0 ? monthNameCap(m) : monthName(m))));
}

/** «8 y 15 nov»; across months «31 oct y 7 nov»; the month abbreviation after each month's last day. */
export function datesList(dates: readonly string[]): string {
  const sorted = [...dates].sort();
  const items = sorted.map((d, i) => {
    const [day, abbr] = dayLabel(d).split(" ");
    const lastOfMonth = i === sorted.length - 1 || sorted[i + 1].slice(0, 7) !== d.slice(0, 7);
    return lastOfMonth ? `${day} ${abbr}` : day;
  });
  return joinEs(items);
}

export interface V3Names {
  /** A member id → alias, else name; an unknown id → «alguien que ya no está en la lista». */
  person(id: string): string;
  /** A wire rule id → the card's label (`v3RuleIds.ts`); never the id itself. */
  rule(id: string): string;
  /** A service id → «domingo 8 nov» / «sábado 7 nov» / «{nombre} 12 nov». */
  service(id: string): string;
}

/** «Dom Lead», «Sáb Lead», «BGV», «Coro»; a presence sub-line «BGV ({regla})». */
export function lineLabel(line: string, n: Pick<V3Names, "rule">): string {
  if (line === "DL") return "Dom Lead";
  if (line === "SL") return "Sáb Lead";
  if (line === "BGV") return "BGV";
  if (line === "CORO") return "Coro";
  if (line.startsWith("P:")) return `BGV (${n.rule(line.slice(2))})`;
  return line;
}

type Params = Readonly<Record<string, unknown>>;
const s = (p: Params, k: string) => String(p[k] ?? "");
const list = (p: Params, k: string): string[] => (Array.isArray(p[k]) ? (p[k] as unknown[]).map(String) : []);

export interface CodeCopy {
  /** The parameters `render` reads — each must be declared by the code in C5's registry (NT-4). */
  params: readonly string[];
  render(p: Params, n: V3Names): string;
}
const fixed = (text: string): CodeCopy => ({ params: [], render: () => text });

/** A code C5 lists in no group — runtime only (NT-4): a line, never nothing. */
export function unknownCodeLine(code: string): string {
  return `El solver informó algo que el planificador no reconoce (${code}).`;
}

// ─── §7.1 Stages ────────────────────────────────────────────────────────────

const STAGE: Record<string, CodeCopy> = {
  rules: fixed("Reglas"),
  fill: fixed("Llenado"),
  cadence: fixed("Mes por medio"),
  compensation: fixed("Sábado de compensación"),
  voice_floor: fixed("Mínimo de voz"),
  dl_floor: fixed("Domingo cada dos meses"),
  sunday_cap: fixed("Un domingo al mes"),
  saturday_cap: fixed("Un sábado al mes"),
  no_consecutive: fixed("Domingos no seguidos"),
  "balance_max:{line}": { params: ["line"], render: (p, n) => `Equidad ${lineLabel(s(p, "line"), n)}: el más pendiente` },
  "balance_sq:{line}": { params: ["line"], render: (p, n) => `Equidad ${lineLabel(s(p, "line"), n)}: reparto` },
  tiebreak: fixed("Desempate"),
};
const STAGE_STATUS: Record<string, CodeCopy> = {
  proven: fixed("probado"),
  unproven: fixed("no probado"),
  not_run: fixed("no ejecutado"),
};
const STAGE_REASON: Record<string, CodeCopy> = {
  budget: fixed("Se acabó el tiempo antes de empezarla."),
  no_solution_in_limit: fixed("No encontró un plan dentro de su límite."),
  stopped_earlier: fixed("Una etapa anterior terminó la corrida."),
};
export const V3_UNPROVEN_EXPLANATION =
  "\"No probado\": el plan es válido, pero el solver no alcanzó a comprobar que fuera el mejor en esa etapa.";
export const V3_NOT_RUN_TAIL = "Las etapas no ejecutadas conservan el plan de la etapa anterior. Revísalo antes de crear.";
export const V3_STAGE_REASON_LINE = (reason: string): string =>
  STAGE_REASON[reason]?.render({}, NO_NAMES) ?? unknownCodeLine(reason);

export function stageLabel(id: string, n: V3Names): string {
  for (const tpl of ["balance_max", "balance_sq"] as const) {
    if (id.startsWith(`${tpl}:`)) return STAGE[`${tpl}:{line}`].render({ line: id.slice(tpl.length + 1) }, n);
  }
  return STAGE[id]?.render({}, n) ?? unknownCodeLine(id);
}

export function stageStatusLabel(status: string): string {
  return STAGE_STATUS[status]?.render({}, NO_NAMES) ?? unknownCodeLine(status);
}

// ─── §7.2 Missed protections ────────────────────────────────────────────────

const MISSED_CAUSE: Record<string, CodeCopy> = {
  unavailable: fixed("no tenía fechas disponibles"),
  pins: fixed("por lo que ya estaba puesto"),
  rule: fixed("una regla lo impedía"),
  capacity: fixed("no alcanzan los lugares (ver aviso de capacidad)"),
  higher_priority: fixed("cumplirlo rompía algo más importante"),
  not_proven: fixed("el solver no alcanzó a comprobar si había otra opción"),
};
const withCause = (base: string, p: Params) => {
  const cause = MISSED_CAUSE[s(p, "cause")];
  return cause ? `${base.replace(/\.$/, "")} — ${cause.render({}, NO_NAMES)}.` : base;
};
const MISSED: Record<string, CodeCopy> = {
  cadence_on_missed: { params: ["person", "month", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} no dirigió domingo en ${monthName(s(p, "month"))}, su mes de dirigir («Mes por medio»).`, p) },
  cadence_off_led: { params: ["person", "month", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} dirigió domingo en ${monthName(s(p, "month"))}, su mes sin domingo («Mes por medio»).`, p) },
  compensation_missed: { params: ["person", "month", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} no tiene su sábado de compensación en ${monthName(s(p, "month"))}.`, p) },
  voice_floor_missed: { params: ["person", "month", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} no canta en ningún servicio de ${monthName(s(p, "month"))}.`, p) },
  dl_floor_missed: { params: ["person", "month1", "month2", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} no dirige domingo ni en ${monthName(s(p, "month1"))} ni en ${monthName(s(p, "month2"))}.`, p) },
  sunday_cap_exceeded: { params: ["person", "month", "count", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} dirige ${s(p, "count")} domingos en ${monthName(s(p, "month"))}; lo normal es uno.`, p) },
  saturday_cap_exceeded: { params: ["person", "month", "count", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} dirige ${s(p, "count")} sábados en ${monthName(s(p, "month"))}; lo normal es uno.`, p) },
  consecutive_sundays: { params: ["person", "dates", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} dirige domingos seguidos: ${datesList(list(p, "dates"))}.`, p) },
};

export function missedLine(m: { code: string } & Record<string, unknown>, n: V3Names): string {
  return MISSED[m.code]?.render(m, n) ?? unknownCodeLine(m.code);
}

// ─── §7.3 Notices ───────────────────────────────────────────────────────────

const NOTICE: Record<string, CodeCopy> = {
  dl_capacity: {
    params: ["months", "seats", "people"],
    render: (p) => `Capacidad de Dom Lead en ${monthsList(list(p, "months"))}: ${s(p, "seats")} domingos para ${s(p, "people")} personas. No alcanza para que todas dirijan al menos un domingo cada dos meses.`,
  },
  exact_clamped: {
    params: ["rule", "person", "month", "value", "available"],
    render: (p, n) => `«${n.rule(s(p, "rule"))}» pide ${s(p, "value")} en ${monthName(s(p, "month"))}, pero ${n.person(s(p, "person"))} solo está disponible ${s(p, "available")}: se ajustó a ${s(p, "available")}.`,
  },
  min_clamped: {
    params: ["rule", "person", "month", "value", "available"],
    render: (p, n) => `«${n.rule(s(p, "rule"))}» pide al menos ${s(p, "value")} en ${monthName(s(p, "month"))}, pero ${n.person(s(p, "person"))} solo está disponible ${s(p, "available")}: se ajustó a ${s(p, "available")}.`,
  },
  presence_not_applicable: {
    params: ["rule", "service"],
    render: (p, n) => `«${n.rule(s(p, "rule"))}» no aplica el ${n.service(s(p, "service"))}: nadie de esa regla está disponible.`,
  },
};

export function noticeLine(code: string, params: Params, n: V3Names): string {
  return NOTICE[code]?.render(params, n) ?? unknownCodeLine(code);
}

// ─── §7.4 Unfilled seats and rule breaks ───────────────────────────────────

const UNFILLED: Record<string, CodeCopy> = {
  no_possible_lead: fixed("Nadie puede dirigir este servicio"),
  no_candidate: fixed("Sin candidatos disponibles: quienes podían ya tienen otro lugar en este servicio"),
  rules: fixed("Se dejó vacío: llenarlo rompía más reglas"),
  fill_not_proven: fixed("Se dejó vacío: el solver no alcanzó a llenarlo"),
};
export function V3_UNFILLED_MARKER(reason: string): string {
  return UNFILLED[reason]?.render({}, NO_NAMES) ?? unknownCodeLine(reason);
}
export const noPossibleLeadNotice = (service: string): string => `Nadie puede dirigir el ${service}: quedó sin líder.`;

const VIOLATION_CAUSE: Record<string, CodeCopy> = {
  pins: fixed(" — por lo que ya estaba puesto."),
  forced: fixed(" — no había forma de cumplirla junto con las demás reglas."),
};
const breakWithCause = (base: string, p: Params) =>
  `${base}${VIOLATION_CAUSE[s(p, "cause")]?.render({}, NO_NAMES) ?? "."}`;
const VIOLATION: Record<string, CodeCopy> = {
  mandatory_lead: { params: ["service", "cause"], render: (p, n) => breakWithCause(`El ${n.service(s(p, "service"))} quedó sin líder aunque alguien podía dirigir`, p) },
  count: { params: ["rule", "person", "month", "observed", "limit", "cause"], render: (p, n) => breakWithCause(`No se cumplió «${n.rule(s(p, "rule"))}» en ${monthName(s(p, "month"))}: quedó en ${s(p, "observed")} (pide ${s(p, "limit")})`, p) },
  pair: { params: ["rule", "service", "cause"], render: (p, n) => breakWithCause(`No se cumplió «${n.rule(s(p, "rule"))}» el ${n.service(s(p, "service"))}`, p) },
  presence: { params: ["rule", "service", "cause"], render: (p, n) => breakWithCause(`No se cumplió «${n.rule(s(p, "rule"))}» el ${n.service(s(p, "service"))}`, p) },
  consecutive: { params: ["rule", "person", "weekends", "cause"], render: (p, n) => breakWithCause(`No se cumplió «${n.rule(s(p, "rule"))}»: ${n.person(s(p, "person"))} quedó en fines de semana seguidos (${datesList(list(p, "weekends"))})`, p) },
};
export const V3_CEILING_UNPROVEN = "Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.";

/** A rule break. `mandatory_lead` is rendered from its own code by `{servicio}` — its `rule` is never looked up. */
export function violationLine(v: { code: string } & Record<string, unknown>, n: V3Names): string {
  return VIOLATION[v.code]?.render(v, n) ?? unknownCodeLine(v.code);
}

// ─── §7.5 Solver refusals ───────────────────────────────────────────────────

const plannerBug = (code: string): CodeCopy => ({
  params: ["field"],
  render: (p) => `El solver rechazó la solicitud por un error del planificador (${code}${p.field ? `: ${s(p, "field")}` : ""}). No se aplicó nada.`,
});
const adminFault = (code: string): CodeCopy => fixed(`No se pudo usar el solver (${code}). No se aplicó nada; avisa a quien administra la app.`);
const ERROR: Record<string, CodeCopy> = {
  timeout: fixed("El solver tardó demasiado. No se aplicó nada. Prueba con 1 mes o vuelve a intentar."),
  contract_mismatch: fixed("El solver no reconoce esta versión del planificador. Recarga la página; no se aplicó nada."),
  invalid_request: plannerBug("invalid_request"),
  unknown_person: plannerBug("unknown_person"),
  unknown_service: plannerBug("unknown_service"),
  pin_conflict: { params: [], render: () => "El solver rechazó la solicitud por un error del planificador (pin_conflict). No se aplicó nada." },
  invalid_json: { params: [], render: () => "El solver rechazó la solicitud por un error del planificador (invalid_json). No se aplicó nada." },
  too_many_pins: { params: ["count", "cap"], render: (p) => `El plan tiene ${s(p, "count")} lugares fijados y el solver acepta hasta ${s(p, "cap")}. Planea 1 mes o apaga «Solo llenar vacíos».` },
  unauthorized: adminFault("unauthorized"),
  misconfigured: adminFault("misconfigured"),
  method_not_allowed: adminFault("method_not_allowed"),
  internal_error: adminFault("internal_error"),
};

export function refusalLine(code: string, params: Params): string {
  return ERROR[code]?.render(params, NO_NAMES) ?? unknownCodeLine(code);
}

// ─── §7.7's registry groups (shown only through panel reasons) ──────────────

export const V3_CADENCE_STATE: Record<string, CodeCopy> = {
  on: fixed("le toca"),
  off: fixed("no dirige domingo"),
  out: fixed("no dirige domingo: no está en la lista de Dom Lead"),
};
export const V3_COMPENSATION: Record<string, CodeCopy> = {
  given: fixed("tiene su sábado de compensación"),
  missed: fixed("no tuvo su sábado de compensación"),
  not_applicable: fixed(""),
};

/** The groups of C5's registry C6 shows, each mirrored code for code (NT-4). */
export const V3_COPY_BY_GROUP = {
  error: ERROR,
  stage: STAGE,
  stage_status: STAGE_STATUS,
  stage_reason: STAGE_REASON,
  violation: VIOLATION,
  violation_cause: VIOLATION_CAUSE,
  unfilled_reason: UNFILLED,
  missed: MISSED,
  missed_cause: MISSED_CAUSE,
  notice: NOTICE,
  cadence_state: V3_CADENCE_STATE,
  compensation: V3_COMPENSATION,
} as const;
export type V3CopyGroup = keyof typeof V3_COPY_BY_GROUP;
/** Never shown, excluded from the sync BY NAME (NT-4). */
export const V3_HIDDEN_GROUPS = ["limit", "violation_rule"] as const;

// ─── §7.6 Route and client outcomes ─────────────────────────────────────────

export const V3_ROUTE_COPY = {
  versionMismatch: "El solver cambió de versión mientras planeabas. Recarga la página; no se aplicó nada.",
  timeout: "El solver tardó demasiado. No se aplicó nada. Prueba con 1 mes o vuelve a intentar.",
  connection: "No se pudo hablar con el solver. No se aplicó nada. Vuelve a intentar.",
  configuration: (motivo: string) => `No se pudo usar el solver (${motivo}). No se aplicó nada; avisa a quien administra la app.`,
  handshake: "El solver no respetó los lugares fijados; no se aplicó nada.",
  ledgerFailed: "No se pudo leer el saldo de equidad. Auto no corrió; vuelve a intentar.",
} as const;

/** `unknown_service` is the client's own configuration outcome: an assignment id the request did not send (AD-5). */
export function transportLine(reason: V3TransportReason | "unknown_service"): string {
  if (reason === "timeout") return V3_ROUTE_COPY.timeout;
  if (reason === "unreachable" || reason === "http_status" || reason === "not_json") return V3_ROUTE_COPY.connection;
  return V3_ROUTE_COPY.configuration(reason);
}

// ─── §7.9 Resolver refusals (C2 IF2-15) ─────────────────────────────────────

const AUTO = "No se puede correr Auto: ";

/**
 * One line per IF2-15 `refusals` item, keyed on ITS union: a reason C2 adds without copy fails
 * `tsc`. `exactLeadLabel` is the card label of the person's exact `Sun.Lead` rule when the caller
 * found one (only `cadence_and_exact` reads it).
 */
export const V3_RESOLVER_REFUSAL: Record<EligibilityRefusalReason, (person: string, month: string, exactLeadLabel: string | null) => string> = {
  unresolved: (p) => `${AUTO}«${p}» en las reglas no coincide con nadie. Corrige el nombre en la regla.`,
  ambiguous: (p) => `${AUTO}«${p}» en las reglas coincide con más de una persona. Corrige el nombre en la regla.`,
  no_tipo: (p) => `${AUTO}«${p}» en las reglas no tiene Tipo. Corrige el nombre en la regla.`,
  cadence_and_exact: (p, _m, label) => cadenceAndExactLine(p, label ?? "regla fija"),
  overlapping_exact: (p) => `${AUTO}${p} tiene dos números fijos para el mismo rol. Deja una sola regla.`,
  exact_count_range: (p, m) => `${AUTO}la regla fija de ${p} no da un número entero de 0 a 31 lugares en ${monthName(m)}. Corrígela.`,
  presence_member_not_listed: (p) => `${AUTO}${p} está en una regla de presencia pero no canta (su Tipo no incluye voz). Corrige la regla o su Tipo.`,
};

const PRESENCE_ISSUE = `${AUTO}una regla de presencia no se puede registrar (necesita de 2 a 12 personas de voz y al menos un rol; máximo 20 reglas). Revísala.`;
/** One line per IF2-15 `issues` item, keyed on ITS union. An issue's `ruleKey` is never rendered (KH-1). */
export const V3_RESOLVER_ISSUE: Record<EligibilityIssueCode, string> = {
  presence_members: PRESENCE_ISSUE,
  presence_roles: PRESENCE_ISSUE,
  presence_rule_id: PRESENCE_ISSUE,
  too_many_presence: PRESENCE_ISSUE,
  no_people: `${AUTO}no hay nadie con Tipo de voz en el equipo.`,
  too_many_people: `${AUTO}hay más de 100 personas de voz.`,
};

function cadenceAndExactLine(person: string, ruleLabel: string): string {
  return `${AUTO}${person} tiene «Mes por medio» y además un número fijo de Dom Lead («${ruleLabel}»). Quita una de las dos.`;
}

// ─── §7.3's own lines: IF2-17 refusals ──────────────────────────────────────

type CapRefusalReason = Extract<ReturnType<typeof capValueForMonth>, { ok: false }>["reason"];
/** Keyed on IF2-17's `reason` union: a reason C2 adds without copy fails `tsc` (RQ-5). */
export const V3_CAP_REFUSAL: Record<CapRefusalReason, (ruleLabel: string, months: readonly string[]) => string> = {
  not_whole: (rule, months) => `${AUTO}«${rule}» no da un número entero de lugares en ${monthsList(months)}. Corrige su número.`,
  negative: (rule) => `${AUTO}«${rule}» pide un número negativo de lugares. Corrige su número.`,
};

// ─── §7.8 Confirm ───────────────────────────────────────────────────────────

const conflictLine = (m: string) =>
  `Otro administrador registró o cambió la elegibilidad de ${monthName(m)} mientras planeabas. No se creó nada; vuelve a correr Auto.`;
const teamLine = () => "Cambió el equipo mientras planeabas (un miembro o su Tipo). No se creó nada; vuelve a correr Auto.";

/** Keyed on IF2-6's PUT union: every code the route can answer has a line, at compile time. */
export const V3_CONFIRM_REFUSAL: Record<FairnessPutRefusal, (month: string) => string> = {
  record_exists: conflictLine,
  stale_revision: conflictLine,
  record_missing: conflictLine,
  month_has_services: (m) => `Se guardaron servicios en ${monthName(m)} mientras planeabas, así que su registro ya no se puede reemplazar. No se creó nada; vuelve a correr Auto.`,
  past_month: (m) => `${monthNameCap(m)} ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto.`,
  engine_not_v3: () => "El solver cambió de versión. Recarga la página; no se creó nada.",
  member_unknown: teamLine,
  member_not_worship: teamLine,
  tipo_mismatch: teamLine,
};

// ─── §7.7 Panel reasons ─────────────────────────────────────────────────────

export const V3_PANEL_REASON = {
  cadenceOn: (month: string) => `Mes por medio: le toca en ${monthName(month)}.`,
  cadenceOff: (month: string) => `Mes por medio: no dirige domingo en ${monthName(month)}.`,
  compensation: (month: string) => `Sábado de compensación en ${monthName(month)}.`,
  unavailable: (dates: readonly string[]) => `No disponible ${datesList(dates)}: esas fechas no le cuentan.`,
  fixedRule: (ruleLabel: string) => `Su número lo fija «${ruleLabel}».`,
  pins: (n: number) => `Los pines tomaron ${n} lugares.`,
  exempt: "Exenta: fuera de Total y del mínimo de voz.",
} as const;

// ─── C6's own lines (§7.3, §7.6, §7.8 and the ST/SP/WN/HZ/RQ/NT rows) ───────

export const V3_LINES = {
  // HZ-7, HZ-9 (also CF-1's ceiling line, unchanged)
  horizonPast: "Auto no planea meses que ya pasaron. Crea esos servicios a mano.",
  horizonCeiling: (month: string, limit: string) =>
    `Auto no planea más de 12 meses adelante: ${monthNameCap(month)} queda fuera. Elige un mes hasta ${monthName(limit)}.`,
  // ST-1, ST-5, ST-6
  storedReadFailed: (months: readonly string[]) =>
    `No se pudieron leer los servicios guardados de ${monthsList(months)}. Auto no corrió; vuelve a intentar.`,
  storedEmptySeats: (n: number) =>
    `Los servicios guardados no se tocan: sus ${n} lugares de voz vacíos se quedan vacíos. Llénalos en «Editar mes».`,
  storedNonMember: (service: string) =>
    `${service.charAt(0).toUpperCase()}${service.slice(1)}: un lugar guardado es de alguien que ya no está en la lista; no se envió al solver.`,
  storedDoubleSeat: (person: string, service: string, role: string) =>
    `${person} está dos veces en el ${service} guardado; se envió solo como ${role} y su saldo cuenta solo ese lugar.`,
  // ST-8 banners
  allBound: (months: readonly string[]) =>
    `${monthsList(months, true)} ya tienen servicios guardados y elegibilidad registrada: se planea con esas listas, sus reglas fijas, de presencia y de semanas, y estas casillas no aplican.`,
  bound: (month: string, recordedOn: string) =>
    `${monthNameCap(month)} ya tiene servicios guardados y elegibilidad registrada (${recordedOn}): se planea con esa lista y sus reglas fijas, de presencia y de semanas; las casillas y esas reglas en pantalla no aplican a ${monthName(month)}. Como ya tiene servicios guardados, ese registro ya no se puede cambiar.`,
  recordedUnbound: (month: string, recordedOn: string) =>
    `${monthNameCap(month)} tiene elegibilidad registrada (${recordedOn}) pero ningún servicio guardado: se planea con las casillas en pantalla y, al crear, ese registro se reemplaza.`,
  anchoredUnrecorded: (month: string) =>
    `${monthNameCap(month)} ya tiene servicios guardados pero no tiene elegibilidad registrada: se planea con las casillas en pantalla y, al crear, se registra con ellas. Como ya tiene servicios guardados, ese registro ya no se podrá cambiar.`,
  // ST-9
  autoConfirm: (months: readonly string[]) =>
    `Esto reemplazará toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en ${monthsList(months)}. Los servicios guardados no se tocan.`,
  // SP-5, SP-6, SP-7
  prefillNotRun: "Los especiales que cuentan para equidad no se llenaron porque Auto no corrió.",
  prefillDone: "Los especiales que cuentan para equidad se llenaron primero (Lead y BGV, por saldo) y el solver acomodó los fines de semana alrededor de ellos.",
  secondTier: (person: string, service: string, motivo: string) =>
    `${person} dirige el ${service} aunque ${motivo}: nadie más podía dirigirlo.`,
  motivoCadence: "es su mes sin domingo («Mes por medio»)",
  motivoSundayCap: (month: string) => `ya dirige otro domingo en ${monthName(month)}`,
  motivoSaturdayCap: (month: string) => `ya dirige otro sábado en ${monthName(month)}`,
  motivoConsecutive: "dirige el domingo anterior o el siguiente",
  // RQ-4
  horizonDisagreement: (m1: string, m2: string, which: "Exenta" | "Mes por medio", person: string) =>
    `${monthNameCap(m1)} y ${monthName(m2)} tienen distinto «${which}» para ${person} (uno viene del registro). Planea 1 mes.`,
  // RQ-5
  relativeZero: (ruleLabel: string, month: string, sundays: number) =>
    `${ruleLabel} queda en 0 en ${monthName(month)} (tiene ${sundays} domingos).`,
  weekNotApplicable: (ruleLabel: string, month: string, week: number) =>
    `${ruleLabel} no aplica en ${monthName(month)}: ese mes no tiene semana ${week}.`,
  recordedExactLabel: (month: string) => `regla fija registrada de ${monthName(month)}`,
  recordedPresenceLabel: "regla de presencia registrada",
  // RQ-6
  pinCap: (n: number, max: number) =>
    `El plan tiene ${n} lugares fijados (guardados, especiales y del tablero) y el solver acepta hasta ${max}. Planea 1 mes o apaga «Solo llenar vacíos».`,
  boardNonMember: (seat: string) =>
    `No se puede usar «Solo llenar vacíos»: en ${seat} hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo.`,
  // RQ-10
  tooLarge: (what: "servicios" | "personas" | "reglas", n: number, max: number) =>
    `El plan es demasiado grande para el solver (${what}: ${n} de ${max}). Planea 1 mes.`,
  // WN-2
  cadenceName: (person: string, motivo: string) =>
    `No se puede correr Auto: «Mes por medio» de «${person}» no corresponde a una sola persona (${motivo}). Corrige el nombre en la regla.`,
  cadenceNameNone: "no coincide con nadie",
  cadenceNameMany: (n: number) => `coincide con ${n} personas`,
  cadenceAndExact: cadenceAndExactLine,
  // WN-3
  saturdayPool: "Con el nuevo solver, «Líderes Sábado» ya no aparta un líder para cada sábado: quien esté solo ahí dirige únicamente sábados.",
  // WN-1 month naming (beside C3's unchanged heading and sentences)
  monthsPrefix: (months: readonly string[]) => monthsList(months, true),
  // NT-1
  runLine: (months: readonly string[], services: number, stored: number) =>
    `Plan de ${months.length} ${months.length === 1 ? "mes" : "meses"}: ${monthsList(months)} · ${services} servicios (${stored} guardados, se respetan tal cual).`,
  allProven: "Todas las etapas quedaron probadas.",
  stageNotProven: (label: string, status: string) => `${label}: ${status}`,
  seeStages: "Ver etapas",
  ruleTableTitle: "Reglas enviadas (id, tipo, posición en la configuración)",
  // CF-6, CF-8, CF-10 and §7.8's other lines
  recordOtherFailure: "No se pudo registrar la elegibilidad. No se creó nada; pulsa «Reintentar».",
  pastAfterDrafts: (month: string) =>
    `${monthNameCap(month)} ya pasó mientras planeabas, así que no se creó nada más. Lo ya creado se queda; completa lo que falta en «Editar mes».`,
  monthComplete: (month: string, c: number, t: number) => `${monthNameCap(month)}: ${c} de ${t} creados.`,
  monthPartial: (month: string, c: number, t: number, f: number) => `${monthNameCap(month)}: ${c} de ${t} creados; ${f} fallaron.`,
  monthNotAttempted: (month: string, previous: string) =>
    `${monthNameCap(month)}: no se intentó porque ${monthName(previous)} quedó incompleto.`,
  retry: (n: number) => `Reintentar (${n} pendientes)`,
  twoMonthSummary: (m1: string, a: number, m2: string, b: number) =>
    `${monthNameCap(m1)}: ${a} · ${monthNameCap(m2)}: ${b}. Se crean como borradores; publícalos después.`,
  incompleteTitle: "El plan quedó incompleto",
  incompleteBody: (gaps: ReadonlyArray<{ month: string; missing: number }>) =>
    gaps.map((g) => `${monthNameCap(g.month)}: faltan ${g.missing} servicios.`).join(" ") +
    " Si sales, se quedan así; puedes completarlos en «Editar mes».",
  leave: "Salir así",
  stay: "Seguir aquí",
  draftConflict: "Alguien más cambió esas fechas: recarga y revisa.",
} as const;

/** C5's literal `PIN_CAP = 250` (gcf_v3/owt_v3/constants.py), mirrored once (RQ-6, `v3PinCapSync.test.ts`). */
export const V3_PIN_CAP = 250;

const NO_NAMES: V3Names = { person: (id) => id, rule: (id) => id, service: (id) => id };
```

- [ ] **Step 4: Run the three tests, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3CodesSync.test.ts app/components/admin/__tests__/v3PinCapSync.test.ts app/components/admin/__tests__/v3Copy.test.ts`
Expected: PASS. (`v3PinCapSync` also proves C5's `PIN_CAP = 250` line is present once.)
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(planner): the v3 planner's Spanish copy, keyed on C5's and C2's codes

Every line the v3 planner shows comes from one module keyed on codes: C5's registry groups are
mirrored code for code with the parameters each line reads, so a code the solver can emit without
copy — or copy naming a parameter the code does not declare — fails the sync test against
gcf_v3/owt_v3/codes.json, and the maps keyed on C2's refusal, issue and write-refusal unions fail
tsc when C2 adds a code. The v3 pin cap is one constant mirrored from C5's literal by a test."
```

---

## Task 5: Rule ids, card labels and the rule reference table (RQ-5 minting, KH-1, KH-3) — [standard]

**Files:**
- Create: `app/components/admin/v3RuleIds.ts`
- Create (test helper, not a test file): `app/components/admin/__tests__/v3Fixtures.ts`
- Create (test): `app/components/admin/__tests__/v3RuleIds.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: `capLabel`, `SolverConfig`, `PresenceRule`, `PersonRestriction`, `WeekExclusion` (`plannerModel.ts`); C2 `compareCodepoint`, `RoleKey`, `FairnessLedgerResponse` (`fairnessVocabulary.ts`).
- Produces: `type V3RuleKind = "count" | "pair" | "presence"`; `interface MintInput { caps: ReadonlyArray<{ ri: number; ci: number }>; exactUnmatched: ReadonlyArray<{ month: string; memberId: string; roles: readonly RoleKey[] }>; conflicts: readonly number[]; presenceKeys: readonly string[] }`; `interface MintedIds { cap(ri: number, ci: number): string; exact(month: string, memberId: string, roles: readonly RoleKey[]): string; pair(index: number): string; presence(ruleKey: string): string }`; `mintRuleIds(config: SolverConfig, input: MintInput): MintedIds`; labels `capCardLabel(config, ri, ci)`, `conflictCardLabel(config, index)`, `presenceCardLabel(rule)`, `weekExclusionLabel(restriction, exclusion)`; KH-3 `interface RuleRefEntry { wire: string; kind: V3RuleKind; ordinal: string }`, `capOrdinal(ri, ci)`, `conflictOrdinal(i)`, `presenceOrdinal(config, ruleKey): string | null`, `sinTarjetaPresence(ruleKey, ledger): string`, `sinTarjetaExact(month, memberId, roles): string`, `renderRuleRefTable(requestId, entries): string`. `v3Fixtures.ts` exports `ANA`, `BRUNO`, `CARLA`, `DANI`, `MEMBERS`, `cap`, `restriction`, `config`, `NAME_SHAPED`, `NAME_SHAPED_KEYS`.

- [ ] **Step 1: Write the shared fixtures** — Create `app/components/admin/__tests__/v3Fixtures.ts`

```ts
// app/components/admin/__tests__/v3Fixtures.ts
//
// Shared by the solver-v3 planner suites — NOT a test file (no `.test.` in the name). Fictitious
// people only (the repository is public). `NAME_SHAPED` has keys of production's SEED SHAPE
// (`d-<name>-<name>`, C6 spec §3) built from those fictitious names, for the key-hygiene tests:
// none of its keys may ever reach a request, a rendered line, a log or KH-3's table.
import type { PersonRestriction, RestrictionCap, SolverConfig } from "../plannerModel";

export const ANA = { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"] };
export const BRUNO = { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "sunday_lead"] };
export const CARLA = { _id: "m-carla", member_name: "Carla Soto", alias: "Carla", memberType: ["voz", "saturday_lead"] };
export const DANI = { _id: "m-dani", member_name: "Dani Vega", alias: "Dani", memberType: ["voz", "support"] };
export const MEMBERS = [ANA, BRUNO, CARLA, DANI];

export const cap = (
  id: string, pattern: string, op: RestrictionCap["op"], value: number, extra: Partial<RestrictionCap> = {},
): RestrictionCap => ({ id, pattern, op, value, relative: false, relOffset: 0, ...extra });

export const restriction = (id: string, person: string, extra: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 0, weekExclusions: [], caps: [], ...extra,
});

export const config = (extra: Partial<SolverConfig> = {}): SolverConfig => ({
  sundayLeads: [], saturdayLeads: [], support: [], restrictions: [], conflicts: [], presence: [], ...extra,
});

/** `restrictions[1].caps[2]`, `conflicts[0]` and `presence[0]` are all name-shaped. */
export const NAME_SHAPED: SolverConfig = config({
  sundayLeads: ["m-ana", "m-bruno"],
  saturdayLeads: ["m-carla"],
  support: ["m-dani"],
  restrictions: [
    restriction("d-ana", "Ana", { caps: [cap("d-ana-sun-lead", "Sun.Lead", "<=", 2)] }),
    restriction("d-bruno", "Bruno", {
      caps: [cap("d-bruno-a", "Sun.BGV", "<=", 3), cap("d-bruno-b", "Sat.BGV", ">=", 0), cap("d-bruno-dani", "Sun.Lead", "<=", 1)],
    }),
  ],
  conflicts: [{ id: "d-ana-bruno", personA: "Ana", personB: "Bruno", pattern: "*.*" }],
  presence: [{ id: "d-carla-dani", persons: ["Carla", "Dani"], pattern: "Sun.BGV" }],
});
export const NAME_SHAPED_KEYS = [
  "d-ana", "d-ana-sun-lead", "d-bruno", "d-bruno-a", "d-bruno-b", "d-bruno-dani", "d-ana-bruno", "d-carla-dani",
];
```

- [ ] **Step 2: Write the failing test** — `app/components/admin/__tests__/v3RuleIds.test.ts`

```ts
// Solver v3 C6 RQ-5 (i)–(iii), RQ-5 (a), KH-1, KH-3 — every wire rule id is MINTED: valid for C5,
// never `mandatory_lead`, unique across kinds, stable for one config, and carrying nothing of its
// source key. Rules are named here by kind and config ordinal, never by key.
import { describe, expect, it } from "vitest";

import {
  capCardLabel, capOrdinal, conflictCardLabel, conflictOrdinal, mintRuleIds, presenceCardLabel, presenceOrdinal,
  renderRuleRefTable, sinTarjetaExact, sinTarjetaPresence, weekExclusionLabel,
} from "../v3RuleIds";
import { NAME_SHAPED, NAME_SHAPED_KEYS, cap, config, restriction } from "./v3Fixtures";
import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";

const ALL = {
  caps: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }, { ri: 1, ci: 1 }, { ri: 1, ci: 2 }],
  exactUnmatched: [{ month: "2026-11", memberId: "m-ana", roles: ["Sun.Lead"] as const }],
  conflicts: [0],
  presenceKeys: ["d-carla-dani", "d-old-presence"],
};
const ID = /^[A-Za-z0-9_-]{1,64}$/;

describe("mintRuleIds", () => {
  it("every id matches C5's grammar, none is mandatory_lead, and all are distinct", () => {
    const ids = mintRuleIds(NAME_SHAPED, ALL);
    const all = [
      ...ALL.caps.map(({ ri, ci }) => ids.cap(ri, ci)),
      ids.exact("2026-11", "m-ana", ["Sun.Lead"]),
      ids.pair(0),
      ids.presence("d-carla-dani"),
      ids.presence("d-old-presence"),
    ];
    for (const id of all) {
      expect(id).toMatch(ID);
      expect(id).not.toBe("mandatory_lead");
      for (const key of NAME_SHAPED_KEYS) expect(id).not.toContain(key);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it("a cap key with a space or an accent, a cap and a conflict sharing a key, and a cap key equal to a presence ruleKey each get a distinct minted id", () => {
    const shared = config({
      restrictions: [restriction("r 1", "Ana", { caps: [cap("dí a", "Sun.Lead", "<=", 1), cap("same", "Sat.Lead", "<=", 1)] })],
      conflicts: [{ id: "same", personA: "Ana", personB: "Bruno", pattern: "*.*" }],
      presence: [{ id: "same", persons: ["Ana", "Bruno"], pattern: "Sun.BGV" }],
    });
    const ids = mintRuleIds(shared, { caps: [{ ri: 0, ci: 0 }, { ri: 0, ci: 1 }], exactUnmatched: [], conflicts: [0], presenceKeys: ["same"] });
    const minted = [ids.cap(0, 0), ids.cap(0, 1), ids.pair(0), ids.presence("same")];
    for (const id of minted) expect(id).toMatch(ID);
    expect(new Set(minted).size).toBe(4);
  });

  it("orders each kind by its source key in codepoint order (deterministic, ordinal-only ids)", () => {
    const two = config({ restrictions: [restriction("b", "Bruno", { caps: [cap("x", "Sun.Lead", "<=", 1)] }), restriction("a", "Ana", { caps: [cap("x", "Sun.Lead", "<=", 1)] })] });
    const ids = mintRuleIds(two, { caps: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }], exactUnmatched: [], conflicts: [], presenceKeys: [] });
    expect(ids.cap(1, 0)).toBe("c1");
    expect(ids.cap(0, 0)).toBe("c2");
  });

  it("two restrictions sharing an id (a hand-edited config) still get distinct ids, by config ordinal", () => {
    const dup = config({ restrictions: [restriction("dup", "Ana", { caps: [cap("c", "Sun.Lead", "<=", 1)] }), restriction("dup", "Bruno", { caps: [cap("c", "Sun.Lead", "<=", 1)] })] });
    const ids = mintRuleIds(dup, { caps: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }], exactUnmatched: [], conflicts: [], presenceKeys: [] });
    expect([ids.cap(0, 0), ids.cap(1, 0)]).toEqual(["c1", "c2"]);
  });

  it("the same config gives byte-identical ids on two runs (RQ-5 (ii))", () => {
    const a = mintRuleIds(NAME_SHAPED, ALL);
    const b = mintRuleIds(NAME_SHAPED, ALL);
    expect([a.cap(1, 2), a.pair(0), a.presence("d-carla-dani"), a.exact("2026-11", "m-ana", ["Sun.Lead"])])
      .toEqual([b.cap(1, 2), b.pair(0), b.presence("d-carla-dani"), b.exact("2026-11", "m-ana", ["Sun.Lead"])]);
  });

  it("a carried-only P: key gets an id from the same function (RQ-5 (a))", () => {
    const ids = mintRuleIds(NAME_SHAPED, ALL);
    expect(ids.presence("d-old-presence")).toMatch(/^r\d+$/);
  });
});

describe("card labels — what the admin can find on screen", () => {
  it("a cap reads like its card, a pair and a presence rule like theirs", () => {
    expect(capCardLabel(NAME_SHAPED, 1, 2)).toBe("Bruno · Sun.Lead <= 1");
    expect(conflictCardLabel(NAME_SHAPED, 0)).toBe("Ana ≠ Bruno en *.*");
    expect(presenceCardLabel(NAME_SHAPED.presence[0])).toBe("Carla, Dani en Sun.BGV c/sem");
    expect(weekExclusionLabel(restriction("r", "Ana"), { id: "w", week: 5, pattern: "Sat.*" })).toBe("Ana · sem.5 Sat.*");
  });
});

describe("KH-3 — the rule reference table (kind and config ordinal, never a key)", () => {
  const ledger = {
    people: [{ window: { "P:d-old-presence": { share: 0, received: 0, balance: 0, seats: 0, tenths: { share: 0, balance: 0 } } } }],
    horizon: [{ record: { presence: [{ ruleKey: "d-carla-dani" }] } }],
  } as unknown as FairnessLedgerResponse;

  it("spells ordinals, «sin tarjeta» with its GET index, and an unmatched exact item's own facts", () => {
    expect(capOrdinal(1, 2)).toBe("restrictions[1].caps[2]");
    expect(conflictOrdinal(0)).toBe("conflicts[0]");
    expect(presenceOrdinal(NAME_SHAPED, "d-carla-dani")).toBe("presence[0]");
    expect(presenceOrdinal(NAME_SHAPED, "d-old-presence")).toBeNull();
    // Distinct ruleKeys of the GET body in codepoint order: d-carla-dani, d-old-presence.
    expect(sinTarjetaPresence("d-old-presence", ledger)).toBe("sin tarjeta, posición 1 entre las reglas de presencia de la lectura");
    expect(sinTarjetaExact("2026-11", "m-ana", ["Sun.Lead", "Sat.Lead"])).toBe("sin tarjeta, 2026-11 m-ana Sun.Lead,Sat.Lead");
  });

  it("renders one copyable block headed by the request id, name-free for a name-shaped config", () => {
    const ids = mintRuleIds(NAME_SHAPED, ALL);
    const text = renderRuleRefTable("req-1", [
      { wire: ids.cap(1, 2), kind: "count", ordinal: capOrdinal(1, 2) },
      { wire: ids.pair(0), kind: "pair", ordinal: conflictOrdinal(0) },
      { wire: ids.presence("d-carla-dani"), kind: "presence", ordinal: presenceOrdinal(NAME_SHAPED, "d-carla-dani")! },
      { wire: `P:${ids.presence("d-old-presence")}`, kind: "presence", ordinal: sinTarjetaPresence("d-old-presence", ledger) },
    ]);
    expect(text.split("\n")[0]).toBe("request_id req-1");
    expect(text).toContain("\tcount\trestrictions[1].caps[2]");
    for (const key of [...NAME_SHAPED_KEYS, "d-old-presence"]) expect(text).not.toContain(key);
    for (const name of ["Ana", "Bruno", "Carla", "Dani"]) expect(text).not.toContain(name);
    expect(text).not.toMatch(/[0-9a-f]{16,}/);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/v3RuleIds.test.ts`
Expected: FAIL — `Cannot find module '../v3RuleIds'`.

- [ ] **Step 4: Write the module** — Create `app/components/admin/v3RuleIds.ts`

```ts
// app/components/admin/v3RuleIds.ts
//
// Solver v3 C6 RQ-5 «Rule ids — minted, never a key», KH-1 and KH-3.
//
// No config key and no `ruleKey` is ever sent as a rule id: config keys are normalised labels
// unique only within one array, and seed-era keys spell members' first names. Every id is a kind
// prefix + a 1-based ordinal over the request's rules of that kind, in codepoint order of their
// source keys (ties — possible only with duplicate keys in a hand-edited config — by config
// ordinal):
//   c<n>  an on-screen cap (any op; an `==` cap also names a matched `exactRules` item)
//   x<n>  an `exactRules` item with no matching on-screen `==` cap
//   p<n>  an on-screen pair (`conflicts[i]`)
//   r<n>  a presence `ruleKey` — over the request's presence rules AND every carried `P:` key
// (i) each matches `[A-Za-z0-9_-]{1,64}` and none is `mandatory_lead`; (ii) the same inputs give the
// same ids; (iii) an ordinal carries no substring or digest of its key.
//
// The id → label map and every source key stay in memory with the plan. KH-3's table maps each
// wire id to its KIND and CONFIG ORDINAL only — the one id map that may be shown (in «Ver etapas»).

import { capLabel, type PersonRestriction, type PresenceRule, type SolverConfig, type WeekExclusion } from "./plannerModel";
import { compareCodepoint, type FairnessLedgerResponse, type RoleKey } from "@/app/utils/fairnessVocabulary";

export type V3RuleKind = "count" | "pair" | "presence";

export interface MintInput {
  caps: ReadonlyArray<{ ri: number; ci: number }>;
  exactUnmatched: ReadonlyArray<{ month: string; memberId: string; roles: readonly RoleKey[] }>;
  conflicts: readonly number[];
  presenceKeys: readonly string[];
}

export interface MintedIds {
  cap(ri: number, ci: number): string;
  exact(month: string, memberId: string, roles: readonly RoleKey[]): string;
  pair(index: number): string;
  presence(ruleKey: string): string;
}

const exactKey = (month: string, memberId: string, roles: readonly RoleKey[]) => `${month}\u0000${memberId}\u0000${roles.join(",")}`;

/** Ordinals by (source key in codepoint order, then tie). Returns handle → minted id. */
function mint<H>(prefix: string, items: ReadonlyArray<{ handle: H; key: string; tie: number }>): Map<H, string> {
  const sorted = [...items].sort((a, b) => compareCodepoint(a.key, b.key) || a.tie - b.tie);
  return new Map(sorted.map((item, i) => [item.handle, `${prefix}${i + 1}`]));
}

function must(map: Map<string, string>, handle: string, what: string): string {
  const id = map.get(handle);
  if (id === undefined) throw new Error(`v3RuleIds: no minted id for this ${what}`);
  return id;
}

export function mintRuleIds(config: SolverConfig, input: MintInput): MintedIds {
  const caps = mint("c", input.caps.map(({ ri, ci }) => ({
    handle: `${ri}.${ci}`,
    key: `${config.restrictions[ri].id}\u0000${config.restrictions[ri].caps[ci].id}`,
    tie: ri * 10_000 + ci,
  })));
  const exactHandles = new Map<string, { handle: string; key: string; tie: number }>();
  input.exactUnmatched.forEach((x, i) => {
    const k = exactKey(x.month, x.memberId, x.roles);
    if (!exactHandles.has(k)) exactHandles.set(k, { handle: k, key: k, tie: i });
  });
  const exact = mint("x", [...exactHandles.values()]);
  const pairs = mint("p", input.conflicts.map((i) => ({ handle: String(i), key: config.conflicts[i].id, tie: i })));
  const presence = mint("r", [...new Set(input.presenceKeys)].map((k, i) => ({ handle: k, key: k, tie: i })));
  return {
    cap: (ri, ci) => must(caps, `${ri}.${ci}`, "cap"),
    exact: (month, memberId, roles) => must(exact, exactKey(month, memberId, roles), "exact rule"),
    pair: (index) => must(pairs, String(index), "pair"),
    presence: (ruleKey) => must(presence, ruleKey, "presence rule"),
  };
}

// ─── Card labels (the only way a rule id is rendered, §7) ───────────────────

export function capCardLabel(config: SolverConfig, ri: number, ci: number): string {
  const r = config.restrictions[ri];
  return `${r.person} · ${capLabel(r.caps[ci])}`;
}

export function conflictCardLabel(config: SolverConfig, index: number): string {
  const c = config.conflicts[index];
  return `${c.personA} ≠ ${c.personB} en ${c.pattern}`;
}

export function presenceCardLabel(rule: PresenceRule): string {
  return `${rule.persons.join(", ")} en ${rule.pattern} c/sem`;
}

export function weekExclusionLabel(r: PersonRestriction, we: WeekExclusion): string {
  return `${r.person} · sem.${we.week} ${we.pattern}`;
}

// ─── KH-3: the rule reference table ─────────────────────────────────────────

export interface RuleRefEntry {
  /** The wire id, or `P:` + id for a rewritten carried key. */
  wire: string;
  kind: V3RuleKind;
  /** `restrictions[i].caps[j]`, `conflicts[i]`, `presence[i]`, or a «sin tarjeta» reason. */
  ordinal: string;
}

export const capOrdinal = (ri: number, ci: number) => `restrictions[${ri}].caps[${ci}]`;
export const conflictOrdinal = (i: number) => `conflicts[${i}]`;

export function presenceOrdinal(config: SolverConfig, ruleKey: string): string | null {
  const i = config.presence.findIndex((p) => p.id === ruleKey);
  return i === -1 ? null : `presence[${i}]`;
}

/**
 * A presence id or carried-only `P:` key whose `ruleKey` has no on-screen card: its position, in
 * codepoint order, among the distinct `ruleKey`s of the run's GET body (its `window` `P:` keys and
 * every `horizon[].record.presence[].ruleKey`) — recomputable privately from a captured GET.
 */
export function sinTarjetaPresence(ruleKey: string, ledger: FairnessLedgerResponse): string {
  const keys = new Set<string>();
  for (const person of ledger.people) {
    for (const line of Object.keys(person.window ?? {})) if (line.startsWith("P:")) keys.add(line.slice(2));
  }
  for (const h of ledger.horizon) for (const p of h.record?.presence ?? []) keys.add(p.ruleKey);
  const index = [...keys].sort(compareCodepoint).indexOf(ruleKey);
  return `sin tarjeta, posición ${index} entre las reglas de presencia de la lectura`;
}

/** An `exactRules` item with no matching card: its own wire facts (month, member id, role set). */
export function sinTarjetaExact(month: string, memberId: string, roles: readonly RoleKey[]): string {
  return `sin tarjeta, ${month} ${memberId} ${roles.join(",")}`;
}

/** One copyable, name-free block headed by the run's `request_id`; tab-separated rows. */
export function renderRuleRefTable(requestId: string, entries: readonly RuleRefEntry[]): string {
  return [`request_id ${requestId}`, ...entries.map((e) => `${e.wire}\t${e.kind}\t${e.ordinal}`)].join("\n");
}
```

- [ ] **Step 5: Run it, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3RuleIds.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(planner): mint every v3 rule id, label rules by their cards, and keep an ordinal map

Production's seed-era rule keys spell members' first names, and C5 echoes rule ids in its report,
so no config key ever goes on the wire: every rule id is a kind prefix and an ordinal in codepoint
order of its source key — valid for C5, stable for one config, and revealing nothing. The planner
renders rules by their card labels, and each run keeps a name-free table of wire id, kind and
config ordinal so C7 can compare a captured request with the config without a key leaving memory."
```

---

## Task 6: Month states, month sources and per-service eligibility (§4, RQ-2, ST-8's data) — [standard]

**Files:**
- Create: `app/components/admin/v3MonthSources.ts`
- Modify (append): `app/components/admin/__tests__/v3Fixtures.ts`
- Create (test): `app/components/admin/__tests__/v3MonthSources.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: IF2-8 `FairnessLedgerResponse` (`horizon[].record`, `.storedServices`, `.recordBinds`), IF2-3 `LogicalRecord`, `FairnessMonthBody`, `RoleKey`, `Status` (`fairnessVocabulary.ts`); IF2-15 `resolveMonthEligibility`, `EligibilityMember`, `EligibilityResult` (`fairnessEligibility.ts`); `civilDayOfWeek`; Task 4's `V3_RESOLVER_REFUSAL`, `V3_RESOLVER_ISSUE`, `V3_ROUTE_COPY`; Task 2's `V3Role`, `V3ServiceKind`.
- Produces: `type MonthState = "bound" | "recorded_unbound" | "unrecorded" | "anchored_unrecorded"`; `interface MonthSource { month: string; state: MonthState; rev: string | null; recordedAt: string | null; body: FairnessMonthBody }` (deep-frozen); `monthStateOf(h): MonthState`; `displayedMonthStates(months, ledger | null): Map<string, MonthState>`; `bodyFromRecord(record: LogicalRecord): FairnessMonthBody`; `resolveMonthSources(input: { months: readonly string[]; ledger: FairnessLedgerResponse; config: SolverConfig; members: readonly EligibilityMember[]; exactLeadLabel: (person: string) => string | null }): { ok: true; sources: MonthSource[] } | { ok: false; lines: string[] }`; `dayClass(kind, date): "Sun" | "Sat"`; `roleKeyOf(cls, role): RoleKey`; `rolesOfService(kind, fixed): V3Role[]`; `serviceEligibility(source, memberId, service: { date: string; kind: V3ServiceKind; fixed: boolean }, liveUnavailable: readonly string[]): V3Role[]`. `v3Fixtures.ts` gains `ALL_IN`, `figures`, `ledgerPerson`, `record`, `ledgerResponse`.

- [ ] **Step 1: Extend the fixtures** — `app/components/admin/__tests__/v3Fixtures.ts`

After the file's `import type { PersonRestriction, RestrictionCap, SolverConfig } from "../plannerModel";` line, add:
```ts
import type {
  FairnessLedgerResponse, FairnessPerson, Figures, LogicalRecord, RoleKey, Status,
} from "@/app/utils/fairnessVocabulary";
```
Append:
```ts

// ─── C2 IF2-8 bodies (shapes are C2's; values fictitious) ────────────────────

export const ALL_IN: Record<RoleKey, Status> = {
  "Sun.Lead": "in", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in",
};

/** A `Figures` with explicit tenths — tests state display values, they never derive them. */
export const figures = (balance: number, seats = 0, tenths = { share: 0, balance: 0 }): Figures => ({
  share: balance + seats * 100, received: seats * 100, balance, seats, tenths,
});

export function ledgerPerson(memberId: string, name: string, over: Partial<FairnessPerson> = {}): FairnessPerson {
  return {
    memberId, name, exists: true, window: {}, cumulative: {}, tabs: { window: {}, cumulative: {} }, sang: 0,
    exempt: false, months: [], countedSundayLeads: [], firstRecordedIn: {}, ...over,
  };
}

export function record(month: string, people: LogicalRecord["people"], over: Partial<LogicalRecord> = {}): LogicalRecord {
  return {
    month, rev: `rev-${month}`, contentHash: "sha256:0", source: "auto", engine: "v3", environment: "local",
    recordedAt: `${month}-02T18:00:00.000Z`, people, presence: [], ...over,
  };
}

export function ledgerResponse(
  months: string[],
  opts: {
    currentMonth?: string;
    horizon?: Array<Partial<FairnessLedgerResponse["horizon"][number]>>;
    people?: FairnessPerson[];
  } = {},
): FairnessLedgerResponse {
  return {
    v: 1, engine: "v3", environment: "local", currentMonth: opts.currentMonth ?? "2026-10", target: months[0],
    window: [], recordsSince: null,
    horizon: months.map((month, i) => ({ month, record: null, storedServices: 0, recordBinds: false, ...(opts.horizon?.[i] ?? {}) })),
    people: opts.people ?? [],
    diagnostics: { duplicateTargets: [], notInRecordSeats: 0, unknownMembers: [] },
  };
}
```

- [ ] **Step 2: Write the failing test** — `app/components/admin/__tests__/v3MonthSources.test.ts`

```ts
// Solver v3 C6 §4, RQ-2, ST-8 — each horizon month's state comes from IF2-8 alone; a bound month is
// solved from its record, every other month from IF2-15 over the on-screen config and members AS-IS;
// per-service eligibility is derived from that one source.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EligibilityResult } from "@/app/utils/fairnessEligibility";

const h = vi.hoisted(() => ({ result: null as null | EligibilityResult }));
vi.mock("@/app/utils/fairnessEligibility", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/app/utils/fairnessEligibility")>();
  return { ...real, resolveMonthEligibility: (input: Parameters<typeof real.resolveMonthEligibility>[0]) => h.result ?? real.resolveMonthEligibility(input) };
});

import {
  bodyFromRecord, dayClass, displayedMonthStates, monthStateOf, resolveMonthSources, rolesOfService, serviceEligibility,
} from "../v3MonthSources";
import { ALL_IN, ANA, BRUNO, MEMBERS, cap, config, ledgerResponse, record, restriction } from "./v3Fixtures";

afterEach(() => { h.result = null; });

const anaRecord = record("2026-11", [{
  memberId: "m-ana", name: "Ana", roles: { ...ALL_IN, "Sat.Lead": "out" }, exactRules: [], exempt: false,
  blocks: [{ date: "2026-11-15", unavailable: true, excludedRoles: [] }, { date: "2026-11-08", unavailable: false, excludedRoles: ["Sun.Lead"] }],
}]);

describe("monthStateOf — §4's table, read from IF2-8 (never re-derived)", () => {
  it("bound / recorded, unbound / anchored, unrecorded / unrecorded", () => {
    expect(monthStateOf({ month: "2026-11", record: anaRecord, storedServices: 2, recordBinds: true })).toBe("bound");
    expect(monthStateOf({ month: "2026-11", record: anaRecord, storedServices: 0, recordBinds: false })).toBe("recorded_unbound");
    expect(monthStateOf({ month: "2026-11", record: null, storedServices: 3, recordBinds: false })).toBe("anchored_unrecorded");
    expect(monthStateOf({ month: "2026-11", record: null, storedServices: 0, recordBinds: false })).toBe("unrecorded");
  });

  it("a month whose only stored service is an uncounted special is not anchored (IF2-8 counts it out)", () => {
    // C2 IF2-24: freezing services are weekend services and COUNTED specials, so the GET reports 0.
    expect(monthStateOf({ month: "2026-12", record: null, storedServices: 0, recordBinds: false })).toBe("unrecorded");
  });

  it("before any read answers, every month is shown as not bound (banners and gates err toward showing)", () => {
    expect([...displayedMonthStates(["2026-11", "2026-12"], null).values()]).toEqual(["unrecorded", "unrecorded"]);
  });
});

describe("bodyFromRecord — a bound month's source", () => {
  it("is the record's people without names, and its presence as read", () => {
    const body = bodyFromRecord(anaRecord);
    expect(body.month).toBe("2026-11");
    expect(body.people[0]).not.toHaveProperty("name");
    expect(body.people[0].memberId).toBe("m-ana");
    expect(body.presence).toEqual([]);
  });
});

describe("resolveMonthSources (RQ-2, ST-8)", () => {
  const screen = config({ sundayLeads: ["m-ana", "m-bruno"], support: ["m-dani"] });

  it("a bound month ignores an on-screen pool change; a recorded, unbound month follows it and keeps the rev read", () => {
    const ledger = ledgerResponse(["2026-11", "2026-12"], {
      horizon: [
        { record: anaRecord, storedServices: 1, recordBinds: true },
        { record: record("2026-12", []), storedServices: 0, recordBinds: false },
      ],
    });
    const out = resolveMonthSources({ months: ["2026-11", "2026-12"], ledger, config: screen, members: MEMBERS, exactLeadLabel: () => null });
    if (!out.ok) throw new Error(out.lines.join("\n"));
    const [nov, dec] = out.sources;
    expect(nov.state).toBe("bound");
    expect(nov.body.people.map((p) => p.memberId)).toEqual(["m-ana"]);           // the record, not the screen
    expect(nov.rev).toBe("rev-2026-11");
    expect(dec.state).toBe("recorded_unbound");
    expect(dec.rev).toBe("rev-2026-12");
    expect(dec.body.people.some((p) => p.memberId === "m-bruno")).toBe(true);    // the screen's pools
  });

  it("the source is frozen: mutating the body the request and the record share throws", () => {
    const out = resolveMonthSources({ months: ["2026-11"], ledger: ledgerResponse(["2026-11"]), config: screen, members: MEMBERS, exactLeadLabel: () => null });
    if (!out.ok) throw new Error("expected ok");
    expect(() => { (out.sources[0].body.people as unknown[]).push({}); }).toThrow();
  });

  it.each([
    ["unresolved", "No se puede correr Auto: «Ana» en las reglas no coincide con nadie. Corrige el nombre en la regla."],
    ["ambiguous", "No se puede correr Auto: «Ana» en las reglas coincide con más de una persona. Corrige el nombre en la regla."],
    ["no_tipo", "No se puede correr Auto: «Ana» en las reglas no tiene Tipo. Corrige el nombre en la regla."],
    ["cadence_and_exact", "No se puede correr Auto: Ana tiene «Mes por medio» y además un número fijo de Dom Lead («Ana · Sun.Lead == 2»). Quita una de las dos."],
    ["overlapping_exact", "No se puede correr Auto: Ana tiene dos números fijos para el mismo rol. Deja una sola regla."],
    ["exact_count_range", "No se puede correr Auto: la regla fija de Ana no da un número entero de 0 a 31 lugares en noviembre. Corrígela."],
    ["presence_member_not_listed", "No se puede correr Auto: Ana está en una regla de presencia pero no canta (su Tipo no incluye voz). Corrige la regla o su Tipo."],
  ] as const)("a resolver refusal «%s» refuses with its §7.9 line", (reason, line) => {
    h.result = { ok: false, issues: [], refusals: [{ person: "Ana", reason }] };
    const out = resolveMonthSources({ months: ["2026-11"], ledger: ledgerResponse(["2026-11"]), config: screen, members: MEMBERS, exactLeadLabel: () => "Ana · Sun.Lead == 2" });
    expect(out).toEqual({ ok: false, lines: [line] });
  });

  it.each(["no_people", "too_many_people", "too_many_presence", "presence_rule_id", "presence_roles", "presence_members"] as const)(
    "a resolver issue «%s» refuses with its §7.9 line and never renders the issue's ruleKey",
    (code) => {
      h.result = { ok: false, issues: [{ code, ruleKey: "d-carla-dani" }], refusals: [] };
      const out = resolveMonthSources({ months: ["2026-11"], ledger: ledgerResponse(["2026-11"]), config: screen, members: MEMBERS, exactLeadLabel: () => null });
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.lines).toHaveLength(1);
        expect(out.lines[0]).toMatch(/^No se puede correr Auto: /);
        expect(out.lines[0]).not.toContain("d-carla-dani");
      }
    },
  );

  it("a super-admin roster with a kids-only namesake of a rule person is passed as-is and refuses nothing (C3 E25, RES-5)", () => {
    const kidsAna = { _id: "m-ana-kids", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz"], ministries: ["kids"] };
    const withCap = config({
      sundayLeads: ["m-ana", "m-bruno"],
      restrictions: [restriction("r-ana", "Ana", { caps: [cap("c-ana", "Sun.Lead", "==", 2)] })],
    });
    const out = resolveMonthSources({ months: ["2026-11"], ledger: ledgerResponse(["2026-11"]), config: withCap, members: [...MEMBERS, kidsAna], exactLeadLabel: () => null });
    if (!out.ok) throw new Error(out.lines.join("\n"));
    const ana = out.sources[0].body.people.find((p) => p.memberId === "m-ana");
    expect(ana?.exactRules).toEqual([{ roles: ["Sun.Lead"], count: 2 }]);
    expect(out.sources[0].body.people.some((p) => p.memberId === "m-ana-kids")).toBe(false);
  });
});

describe("per-service eligibility (RQ-2), from the month source alone", () => {
  const source = { month: "2026-11", state: "bound" as const, rev: "r", recordedAt: null, body: bodyFromRecord(anaRecord) };

  it("in or exact is eligible, out is not; the day class picks the role key", () => {
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-01", kind: "sunday", fixed: false }, [])).toEqual(["Lead", "BGV", "Choir"]);
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-07", kind: "saturday", fixed: false }, [])).toEqual(["BGV"]);
    expect(dayClass("special", "2026-11-22")).toBe("Sun");
    expect(dayClass("special", "2026-11-20")).toBe("Sat");
  });

  it("unavailable by the source's block or by live unavailableDates (F4)", () => {
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-15", kind: "sunday", fixed: false }, [])).toEqual([]);
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-22", kind: "sunday", fixed: false }, ["2026-11-22"])).toEqual([]);
  });

  it("a rule exclusion binds a weekend service only, never a special (A13)", () => {
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-08", kind: "sunday", fixed: false }, [])).toEqual(["BGV", "Choir"]);
    expect(serviceEligibility(source, "m-ana", { date: "2026-11-08", kind: "special", fixed: true }, [])).toContain("Lead");
  });

  it("a non-fixed Saturday has no Choir; a person absent from the source is eligible for nothing", () => {
    expect(rolesOfService("saturday", false)).toEqual(["Lead", "BGV"]);
    expect(rolesOfService("saturday", true)).toEqual(["Lead", "BGV", "Choir"]);
    expect(serviceEligibility(source, BRUNO._id, { date: "2026-11-01", kind: "sunday", fixed: false }, [])).toEqual([]);
    expect(ANA._id).toBe("m-ana");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/v3MonthSources.test.ts`
Expected: FAIL — `Cannot find module '../v3MonthSources'`.

- [ ] **Step 4: Write the module** — Create `app/components/admin/v3MonthSources.ts`

```ts
// app/components/admin/v3MonthSources.ts
//
// Solver v3 C6 §4 and RQ-2 — ONE derivation of eligibility per horizon month (parent A7):
//   · a BOUND month (IF2-8 `horizon[].recordBinds`, A6) is solved from its record — statuses, exact
//     rules, presence, date blocks, cadence and exempt flags; C6 takes `people` without `name`;
//   · every other month from the `body` of C2's resolver (IF2-15) over the on-screen config and the
//     planner's on-screen `members` AS-IS (any superset carrying `ministries`; C2 RES-5 filters).
// The same frozen source feeds the request (eligibility, rules, people) and the confirm's record
// body, so the two can never disagree; a resolver `ok:false` refuses Auto with §7.9's lines.
// C6 never runs C2's validator (RES-8) and never re-derives pools, Tipo or rule membership.

import { resolveMonthEligibility, type EligibilityMember } from "@/app/utils/fairnessEligibility";
import { civilDayOfWeek } from "@/app/utils/fairnessLedger";
import type { FairnessLedgerResponse, FairnessMonthBody, LogicalRecord, RoleKey } from "@/app/utils/fairnessVocabulary";
import type { SolverConfig } from "./plannerModel";
import { V3_RESOLVER_ISSUE, V3_RESOLVER_REFUSAL, V3_ROUTE_COPY } from "./v3Copy";
import type { V3Role, V3ServiceKind } from "./v3Wire";

export type MonthState = "bound" | "recorded_unbound" | "unrecorded" | "anchored_unrecorded";

export interface MonthSource {
  month: string;
  state: MonthState;
  /** The record's `rev` as read with this eligibility (C2 WR-15), or `null` when there is none. */
  rev: string | null;
  recordedAt: string | null;
  body: FairnessMonthBody;
}

type HorizonEntry = FairnessLedgerResponse["horizon"][number];

/** §4's state table, from IF2-8 alone: `recordBinds` is read, never re-derived (A6). */
export function monthStateOf(h: HorizonEntry): MonthState {
  if (h.record && h.recordBinds) return "bound";
  if (h.record) return "recorded_unbound";
  return h.storedServices > 0 ? "anchored_unrecorded" : "unrecorded";
}

/** §4 «Displayed state before a run»: the latest GET's states; none yet ⇒ every month not bound. */
export function displayedMonthStates(months: readonly string[], ledger: FairnessLedgerResponse | null): Map<string, MonthState> {
  return new Map(months.map((month) => {
    const h = ledger?.horizon.find((x) => x.month === month);
    return [month, h ? monthStateOf(h) : "unrecorded"];
  }));
}

/** IF2-3 → the body a bound month is solved with and confirmed as (CF-3): `name` removed, nothing else changed. */
export function bodyFromRecord(record: LogicalRecord): FairnessMonthBody {
  return {
    month: record.month,
    people: record.people.map((p) => ({
      memberId: p.memberId,
      roles: p.roles,
      exactRules: p.exactRules,
      ...(p.sundayCadence ? { sundayCadence: p.sundayCadence } : {}),
      exempt: p.exempt,
      blocks: p.blocks,
    })),
    presence: record.presence.map((r) => ({ ruleKey: r.ruleKey, roles: r.roles, members: r.members, exclusive: r.exclusive })),
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export function resolveMonthSources(input: {
  months: readonly string[];
  ledger: FairnessLedgerResponse;
  config: SolverConfig;
  members: readonly EligibilityMember[];
  /** The card label of a person's exact `Sun.Lead` rule, for `cadence_and_exact`'s line. */
  exactLeadLabel: (person: string) => string | null;
}): { ok: true; sources: MonthSource[] } | { ok: false; lines: string[] } {
  const sources: MonthSource[] = [];
  const lines: string[] = [];
  for (const month of input.months) {
    const h = input.ledger.horizon.find((x) => x.month === month);
    if (!h) {
      lines.push(V3_ROUTE_COPY.ledgerFailed);
      continue;
    }
    const state = monthStateOf(h);
    if (state === "bound" && h.record) {
      sources.push(deepFreeze({ month, state, rev: h.record.rev, recordedAt: h.record.recordedAt, body: bodyFromRecord(h.record) }));
      continue;
    }
    const resolved = resolveMonthEligibility({ month, config: input.config, members: [...input.members] });
    if (!resolved.ok) {
      for (const r of resolved.refusals) lines.push(V3_RESOLVER_REFUSAL[r.reason](r.person, month, input.exactLeadLabel(r.person)));
      for (const issue of resolved.issues) lines.push(V3_RESOLVER_ISSUE[issue.code]);
      continue;
    }
    sources.push(deepFreeze({
      month, state, rev: h.record?.rev ?? null, recordedAt: h.record?.recordedAt ?? null, body: structuredClone(resolved.body),
    }));
  }
  return lines.length > 0 ? { ok: false, lines: [...new Set(lines)] } : { ok: true, sources };
}

// ─── Per-service eligibility (RQ-2) ─────────────────────────────────────────

/** A13 / D14: a Sunday-dated service uses the `Sun.*` keys; any other day the `Sat.*` keys. */
export function dayClass(kind: V3ServiceKind, date: string): "Sun" | "Sat" {
  if (kind === "sunday") return "Sun";
  if (kind === "saturday") return "Sat";
  return civilDayOfWeek(date) === 0 ? "Sun" : "Sat";
}

export function roleKeyOf(cls: "Sun" | "Sat", role: V3Role): RoleKey {
  return `${cls}.${role}` as RoleKey;
}

/** C5 §5.2: a non-fixed `saturday` has no Choir; every fixed service carries all three. */
export function rolesOfService(kind: V3ServiceKind, fixed: boolean): V3Role[] {
  return kind === "saturday" && !fixed ? ["Lead", "BGV"] : ["Lead", "BGV", "Choir"];
}

/**
 * A role of service s is eligible for p iff p's status for s's role key is `in` or `exact`, p is
 * available on s's date (the source's `blocks[].unavailable` ∪ live `unavailableDates`, F4), and —
 * at a weekend service only — the key is not in that date's `blocks[].excludedRoles`.
 */
export function serviceEligibility(
  source: MonthSource,
  memberId: string,
  service: { date: string; kind: V3ServiceKind; fixed: boolean },
  liveUnavailable: readonly string[],
): V3Role[] {
  const person = source.body.people.find((p) => p.memberId === memberId);
  if (!person) return [];
  const block = person.blocks.find((b) => b.date === service.date);
  if (block?.unavailable || liveUnavailable.includes(service.date)) return [];
  const cls = dayClass(service.kind, service.date);
  const weekend = service.kind !== "special";
  return rolesOfService(service.kind, service.fixed).filter((role) => {
    const key = roleKeyOf(cls, role);
    const status = person.roles[key];
    if (status !== "in" && status !== "exact") return false;
    return !(weekend && block?.excludedRoles.includes(key));
  });
}
```

- [ ] **Step 5: Run it, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3MonthSources.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(planner): one eligibility source per v3 horizon month

A month whose record binds it (it has stored services) is solved with that record; every other
month with C2's resolver over the on-screen rules and roster as-is. The same frozen source feeds
the request's eligibility and, later, the confirm's record body, so what was solved is what gets
recorded. Resolver refusals stop Auto before the fetch with one Spanish line each, keyed on C2's
own unions; per-service eligibility comes from that source alone."
```

---

## Task 7: The request's services, stored seats as pins, and `prior` (RQ-3, RQ-7, ST-4–ST-7) — [standard]

**Files:**
- Create: `app/components/admin/v3Services.ts`
- Create (test): `app/components/admin/__tests__/v3Services.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: IF2-11 `keepVoiceSeats(services: LedgerService[])` and IF2-10 `LedgerService` (`fairnessLedger.ts`); C1 `countsForFairness(doc)`; `isServiceTime` (`serviceTime.ts`); `roleClassOf`, `shiftMonth` (`fairnessVocabulary.ts`); `dayLabel`; Task 3 `monthOfDate`; Task 4 `V3_LINES`; Task 2 `V3Service`, `V3Pin`, `V3Prior`, `V3ServiceKind`.
- Produces: `interface V3StoredRole { _id: string; _type: string; date: string; time?: string | null; service_name?: string | null; countsForFairness?: boolean; leads: ReadonlyArray<{ _id: string }>; bgvs: ReadonlyArray<{ _id: string }>; chorus: ReadonlyArray<{ _id: string }> }` (a structural subset of `ServiceRole`, the roles-read row); `interface PlannedColumn { columnId: string; date: string; type: "sunday_role" | "saturday_role" | "special_role"; serviceName?: string; time?: string; countsForFairness: boolean }`; `kindOfType(type: string): V3ServiceKind | null`; `serviceLabel(kind, date, name?): string`; `buildV3Services(input: { months; stored; planned; seats: { Lead: number; BGV: number; Choir: number }; memberIds: ReadonlySet<string>; nameOf: (id: string) => string }): BuiltServices` with `interface BuiltServices { services: V3Service[]; storedPins: V3Pin[]; storedServiceIds: Set<string>; plannedSpecialIds: string[]; labels: Map<string, string>; notices: string[] }`; `buildV3Prior(firstMonth: string, stored: readonly V3StoredRole[]): V3Prior`.

- [ ] **Step 1: Write the failing test** — `app/components/admin/__tests__/v3Services.test.ts`

```ts
// Solver v3 C6 RQ-3, RQ-7, ST-4–ST-7 — the request holds exactly the services that will exist;
// stored services and counted specials go FIXED with their kept seats as pins; `prior` comes from
// the roles read. Fictitious people; ids are opaque.
import { describe, expect, it } from "vitest";

import { keepVoiceSeats } from "@/app/utils/fairnessLedger";
import { buildV3Prior, buildV3Services, type PlannedColumn, type V3StoredRole } from "../v3Services";

const m = (id: string) => ({ _id: id });
const stored = (over: Partial<V3StoredRole> & Pick<V3StoredRole, "_id" | "_type" | "date">): V3StoredRole => ({
  leads: [], bgvs: [], chorus: [], ...over,
});
const SEATS = { Lead: 2, BGV: 3, Choir: 3 };
const MEMBERS = new Set(["m-ana", "m-bruno", "m-carla", "m-dani"]);
const nameOf = (id: string) => ({ "m-ana": "Ana", "m-bruno": "Bruno", "m-carla": "Carla", "m-dani": "Dani" })[id] ?? id;

const planned: PlannedColumn[] = [
  { columnId: "create:sunday_role__2026-11-08", date: "2026-11-08", type: "sunday_role", countsForFairness: true },
  { columnId: "create:saturday_role__2026-11-14", date: "2026-11-14", type: "saturday_role", countsForFairness: false },
  { columnId: "create:special_role__2026-11-20", date: "2026-11-20", type: "special_role", serviceName: "Bautizos", time: "19:00", countsForFairness: true },
  { columnId: "create:special_role__2026-11-27", date: "2026-11-27", type: "special_role", serviceName: "Ensayo", countsForFairness: false },
];

describe("buildV3Services (RQ-3)", () => {
  it("planned weekend columns are sent with their row targets; a non-fixed Saturday sends no Choir", () => {
    const out = buildV3Services({ months: ["2026-11"], stored: [], planned, seats: SEATS, memberIds: MEMBERS, nameOf });
    expect(out.services.find((s) => s.id === "create:sunday_role__2026-11-08")).toEqual({
      id: "create:sunday_role__2026-11-08", date: "2026-11-08", month: "2026-11", kind: "sunday", fixed: false, counts: true,
      seats: { Lead: 2, BGV: 3, Choir: 3 },
    });
    expect(out.services.find((s) => s.id === "create:saturday_role__2026-11-14")).toEqual({
      id: "create:saturday_role__2026-11-14", date: "2026-11-14", month: "2026-11", kind: "saturday", fixed: false, counts: false,
      seats: { Lead: 2, BGV: 3 },
    });
  });

  it("a planned COUNTED special is sent fixed (filled by the pre-fill); an uncounted one is never sent (SP-3, SP-4)", () => {
    const out = buildV3Services({ months: ["2026-11"], stored: [], planned, seats: SEATS, memberIds: MEMBERS, nameOf });
    expect(out.services.find((s) => s.id === "create:special_role__2026-11-20")).toEqual({
      id: "create:special_role__2026-11-20", date: "2026-11-20", month: "2026-11", kind: "special", time: "19:00", fixed: true, counts: true,
    });
    expect(out.plannedSpecialIds).toEqual(["create:special_role__2026-11-20"]);
    expect(out.services.some((s) => s.id === "create:special_role__2026-11-27")).toBe(false);
  });

  it("a stored id outside [A-Za-z0-9:._-] or longer than 64 is sent byte-identical, and its pins carry it", () => {
    const longId = `role.${"x".repeat(80)}`;
    const odd = "role:Ñandú@2026/11/01";
    const out = buildV3Services({
      months: ["2026-11"],
      stored: [
        stored({ _id: odd, _type: "sunday_role", date: "2026-11-01", leads: [m("m-ana")] }),
        stored({ _id: longId, _type: "sunday_role", date: "2026-11-15", leads: [m("m-bruno")] }),
      ],
      planned: [], seats: SEATS, memberIds: MEMBERS, nameOf,
    });
    expect(out.services.map((s) => s.id)).toEqual([odd, longId]);
    expect(out.storedPins).toEqual([
      { service: odd, date: "2026-11-01", role: "Lead", person: "m-ana" },
      { service: longId, date: "2026-11-15", role: "Lead", person: "m-bruno" },
    ]);
  });

  it("a stored special's time is sent only when isServiceTime holds", () => {
    const out = buildV3Services({
      months: ["2026-11"],
      stored: [
        stored({ _id: "sp-bad", _type: "special_role", date: "2026-11-11", time: "7pm", countsForFairness: true, service_name: "Vigilia" }),
        stored({ _id: "sp-ok", _type: "special_role", date: "2026-11-12", time: "19:00", countsForFairness: true, service_name: "Vigilia" }),
      ],
      planned: [], seats: SEATS, memberIds: MEMBERS, nameOf,
    });
    expect("time" in out.services.find((s) => s.id === "sp-bad")!).toBe(false);
    expect(out.services.find((s) => s.id === "sp-ok")!.time).toBe("19:00");
  });

  it("stored weekend services go fixed with their counted flag; a stored UNCOUNTED special is never sent (ST-4)", () => {
    const out = buildV3Services({
      months: ["2026-11"],
      stored: [
        stored({ _id: "sat-1", _type: "saturday_role", date: "2026-11-07", countsForFairness: false, chorus: [m("m-dani")] }),
        stored({ _id: "sp-uncounted", _type: "special_role", date: "2026-11-13", service_name: "Ensayo" }),
        stored({ _id: "sun-dec", _type: "sunday_role", date: "2026-12-06", leads: [m("m-ana")] }),
      ],
      planned: [], seats: SEATS, memberIds: MEMBERS, nameOf,
    });
    expect(out.services).toEqual([{ id: "sat-1", date: "2026-11-07", month: "2026-11", kind: "saturday", fixed: true, counts: false }]);
    expect(out.storedPins).toEqual([{ service: "sat-1", date: "2026-11-07", role: "Choir", person: "m-dani" }]);
    expect(out.storedServiceIds).toEqual(new Set(["sat-1"]));
  });

  it("ST-5: one notice for the stored services' empty voice seats", () => {
    const out = buildV3Services({
      months: ["2026-11"],
      stored: [stored({ _id: "sun-1", _type: "sunday_role", date: "2026-11-01", leads: [m("m-ana")], bgvs: [m("m-bruno"), m("m-carla")] })],
      planned: [], seats: SEATS, memberIds: MEMBERS, nameOf,
    });
    // Lead 1 of 2, BGV 2 of 3, Coro 0 of 3 → 1 + 1 + 3 = 5 empty voice seats.
    expect(out.notices).toContain("Los servicios guardados no se tocan: sus 5 lugares de voz vacíos se quedan vacíos. Llénalos en «Editar mes».");
  });

  it("ST-6: a non-member's stored seat is not sent, and a double seat is sent once, by Lead > BGV > Coro", () => {
    const out = buildV3Services({
      months: ["2026-11"],
      stored: [stored({
        _id: "sun-1", _type: "sunday_role", date: "2026-11-01",
        leads: [m("m-ana"), m("m-gone")], bgvs: [m("m-ana"), m("m-bruno")], chorus: [m("m-bruno")],
      })],
      planned: [], seats: SEATS, memberIds: MEMBERS, nameOf,
    });
    expect(out.storedPins).toEqual([
      { service: "sun-1", date: "2026-11-01", role: "Lead", person: "m-ana" },
      { service: "sun-1", date: "2026-11-01", role: "BGV", person: "m-bruno" },
    ]);
    expect(out.notices).toContain("Domingo 1 nov: un lugar guardado es de alguien que ya no está en la lista; no se envió al solver.");
    expect(out.notices).toContain("Ana está dos veces en el domingo 1 nov guardado; se envió solo como Lead y su saldo cuenta solo ese lugar.");
    expect(out.notices).toContain("Bruno está dos veces en el domingo 1 nov guardado; se envió solo como BGV y su saldo cuenta solo ese lugar.");
  });

  it("ST-6: for a counted stored service, the seat sent is the one C2 IF2-11 keeps", () => {
    const role = stored({ _id: "sun-1", _type: "sunday_role", date: "2026-11-01", countsForFairness: true, leads: [m("m-carla")], bgvs: [m("m-carla"), m("m-ana")], chorus: [m("m-ana")] });
    const out = buildV3Services({ months: ["2026-11"], stored: [role], planned: [], seats: SEATS, memberIds: MEMBERS, nameOf });
    const ledgerKept = keepVoiceSeats([{ _id: role._id, _type: "sunday_role", date: role.date, countsForFairness: true, Lead: ["m-carla"], BGVs: ["m-carla", "m-ana"], Chorus: ["m-ana"] }]).kept;
    const roleOf = (key: string) => key.split(".")[1];
    expect(out.storedPins.map((p) => `${p.person}:${p.role}`).sort())
      .toEqual(ledgerKept.map((k) => `${k.memberId}:${roleOf(k.roleKey)}`).sort());
  });

  it("ST-7: a target created earlier in the session is just another stored service — sent fixed, never re-planned", () => {
    const created = stored({ _id: "new-sun-08", _type: "sunday_role", date: "2026-11-08", leads: [m("m-ana")] });
    const out = buildV3Services({ months: ["2026-11"], stored: [created], planned: [], seats: SEATS, memberIds: MEMBERS, nameOf });
    expect(out.services).toEqual([{ id: "new-sun-08", date: "2026-11-08", month: "2026-11", kind: "sunday", fixed: true, counts: true }]);
  });

  it("labels each service for the copy: «domingo 8 nov», «sábado 14 nov», «Bautizos 20 nov»", () => {
    const out = buildV3Services({ months: ["2026-11"], stored: [], planned, seats: SEATS, memberIds: MEMBERS, nameOf });
    expect(out.labels.get("create:sunday_role__2026-11-08")).toBe("domingo 8 nov");
    expect(out.labels.get("create:saturday_role__2026-11-14")).toBe("sábado 14 nov");
    expect(out.labels.get("create:special_role__2026-11-20")).toBe("Bautizos 20 nov");
  });
});

describe("buildV3Prior (RQ-7)", () => {
  const roles: V3StoredRole[] = [
    stored({ _id: "oct-18", _type: "sunday_role", date: "2026-10-18", leads: [m("m-ana")] }),
    stored({ _id: "oct-25", _type: "sunday_role", date: "2026-10-25", leads: [m("m-bruno")], countsForFairness: false }),
    stored({ _id: "oct-31", _type: "saturday_role", date: "2026-10-31", leads: [m("m-carla")], bgvs: [m("m-dani")] }),
    stored({ _id: "oct-29-sp", _type: "special_role", date: "2026-10-29", countsForFairness: true, leads: [m("m-ana")] }),
    stored({ _id: "oct-30-sp", _type: "special_role", date: "2026-10-30", leads: [m("m-ana")] }),
    stored({ _id: "oct-24-a", _type: "saturday_role", date: "2026-10-24" }),
    stored({ _id: "oct-24-b", _type: "saturday_role", date: "2026-10-24" }),
  ];

  it("is the month before, with the stored services of the 14 days before the horizon (incl. the trailing Saturday)", () => {
    const prior = buildV3Prior("2026-11", roles);
    expect(prior.month).toBe("2026-10");
    expect(prior.has_services).toBe(true);
    expect(prior.services.map((s) => s.date)).toEqual(["2026-10-18", "2026-10-25", "2026-10-29", "2026-10-31"]);
    expect(prior.services[1]).toEqual({ date: "2026-10-25", kind: "sunday", counts: false, seats: { Lead: ["m-bruno"], BGV: [], Choir: [] } });
    expect(prior.services[3].seats).toEqual({ Lead: ["m-carla"], BGV: ["m-dani"], Choir: [] });
  });

  it("drops two stored documents of one weekend type on one date together (C2 LG-1), and never an uncounted special", () => {
    const prior = buildV3Prior("2026-11", roles);
    expect(prior.services.some((s) => s.date === "2026-10-24")).toBe(false);
    expect(prior.services.some((s) => s.date === "2026-10-30")).toBe(false);
  });

  it("has_services is false when the month before holds no weekend service and no counted special", () => {
    expect(buildV3Prior("2026-11", [stored({ _id: "sp", _type: "special_role", date: "2026-10-20" })]).has_services).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/v3Services.test.ts`
Expected: FAIL — `Cannot find module '../v3Services'`.

- [ ] **Step 3: Write the module** — Create `app/components/admin/v3Services.ts`

```ts
// app/components/admin/v3Services.ts
//
// Solver v3 C6 RQ-3, RQ-7, ST-4–ST-7 — the services a v3 request holds, and `prior`.
//
// Exactly the services that will exist: planned weekend columns that are neither skipped nor
// blocked (the caller passes only those), every stored weekend service of the horizon, and every
// counted special (planned or stored). Stored services and counted specials are FIXED: their seats
// are pins and the solver adds nothing. A stored service's id is its document `_id` VERBATIM; a
// planned one's is its create column's id. `time` is sent only when `isServiceTime` holds.
//
// One seat per person per service is C2's rule (LG-4), not C6's: the stored seats sent are exactly
// the ones C2's `keepVoiceSeats` (IF2-11) keeps, called with `countsForFairness: true` so its LG-2
// filter never drops an uncounted weekend service, which RQ-3 still sends fixed. Its LG-1 drop of a
// duplicated weekend target applies here and to `prior` alike.

import { keepVoiceSeats, type LedgerService } from "@/app/utils/fairnessLedger";
import { countsForFairness } from "@/app/utils/countsForFairness";
import { isServiceTime } from "@/app/utils/serviceTime";
import { compareCodepoint, roleClassOf, shiftMonth } from "@/app/utils/fairnessVocabulary";
import { dayLabel } from "./plannerModel";
import { monthOfDate } from "./v3Horizon";
import { V3_LINES } from "./v3Copy";
import type { V3Pin, V3Prior, V3Service, V3ServiceKind } from "./v3Wire";

/** A row of `GET /api/admin/roles` — a structural subset of `ServiceRole` (serviceCardModel.ts). */
export interface V3StoredRole {
  _id: string;
  _type: string;
  date: string;
  time?: string | null;
  service_name?: string | null;
  countsForFairness?: boolean;
  leads: ReadonlyArray<{ _id: string }>;
  bgvs: ReadonlyArray<{ _id: string }>;
  chorus: ReadonlyArray<{ _id: string }>;
}

export interface PlannedColumn {
  columnId: string;
  date: string;
  type: "sunday_role" | "saturday_role" | "special_role";
  serviceName?: string;
  time?: string;
  countsForFairness: boolean;
}

export interface BuiltServices {
  services: V3Service[];
  /** The kept seats of every fixed stored service (IF2-11), members only. */
  storedPins: V3Pin[];
  storedServiceIds: Set<string>;
  /** Planned counted specials, in date order — the pre-fill's targets (SP-1). */
  plannedSpecialIds: string[];
  /** service id → «domingo 8 nov» / «sábado 7 nov» / «{nombre} 12 nov». */
  labels: Map<string, string>;
  /** ST-5, ST-6. */
  notices: string[];
}

export function kindOfType(type: string): V3ServiceKind | null {
  if (type === "sunday_role") return "sunday";
  if (type === "saturday_role") return "saturday";
  if (type === "special_role") return "special";
  return null;
}

export function serviceLabel(kind: V3ServiceKind, date: string, name?: string | null): string {
  if (kind === "sunday") return `domingo ${dayLabel(date)}`;
  if (kind === "saturday") return `sábado ${dayLabel(date)}`;
  return `${name?.trim() || "especial"} ${dayLabel(date)}`;
}

const ROLE_ES: Record<"Lead" | "BGV" | "Choir", string> = { Lead: "Lead", BGV: "BGV", Choir: "Coro" };

const toLedger = (r: V3StoredRole): LedgerService => ({
  _id: r._id,
  _type: r._type as LedgerService["_type"],
  date: r.date,
  countsForFairness: true,
  Lead: r.leads.map((x) => x._id),
  BGVs: r.bgvs.map((x) => x._id),
  Chorus: r.chorus.map((x) => x._id),
});

const isWeekend = (r: V3StoredRole) => r._type === "sunday_role" || r._type === "saturday_role";
const isCountedSpecial = (r: V3StoredRole) => r._type === "special_role" && countsForFairness({ _type: r._type, countsForFairness: r.countsForFairness });
const byDateThenId = (a: { date: string; id: string }, b: { date: string; id: string }) =>
  compareCodepoint(a.date, b.date) || compareCodepoint(a.id, b.id);

export function buildV3Services(input: {
  months: readonly string[];
  stored: readonly V3StoredRole[];
  planned: readonly PlannedColumn[];
  seats: { Lead: number; BGV: number; Choir: number };
  memberIds: ReadonlySet<string>;
  nameOf: (id: string) => string;
}): BuiltServices {
  const inHorizon = new Set(input.months);
  const services: V3Service[] = [];
  const labels = new Map<string, string>();
  const notices: string[] = [];

  // ── Stored: every weekend service of the horizon, every counted special; uncounted specials never.
  const storedSent = input.stored.filter((r) => inHorizon.has(monthOfDate(r.date)) && (isWeekend(r) || isCountedSpecial(r)));
  const seatStep = keepVoiceSeats(storedSent.map(toLedger));
  const dropped = new Set(seatStep.duplicateTargets.flatMap((d) => d.roleIds));
  const storedServiceIds = new Set<string>();
  let emptyVoiceSeats = 0;
  for (const r of storedSent) {
    if (dropped.has(r._id)) continue;
    const kind = kindOfType(r._type)!;
    storedServiceIds.add(r._id);
    labels.set(r._id, serviceLabel(kind, r.date, r.service_name));
    services.push({
      id: r._id, date: r.date, month: monthOfDate(r.date), kind,
      ...(isServiceTime(r.time) ? { time: r.time } : {}),
      fixed: true,
      counts: countsForFairness({ _type: r._type, countsForFairness: r.countsForFairness }),
    });
    emptyVoiceSeats += Math.max(0, input.seats.Lead - r.leads.length) + Math.max(0, input.seats.BGV - r.bgvs.length);
    if (kind === "sunday") emptyVoiceSeats += Math.max(0, input.seats.Choir - r.chorus.length);
  }
  const storedPins: V3Pin[] = [];
  const nonMemberNoticed = new Set<string>();
  for (const seat of seatStep.kept) {
    if (dropped.has(seat.serviceId)) continue;
    if (!input.memberIds.has(seat.memberId)) {
      if (!nonMemberNoticed.has(seat.serviceId)) {
        nonMemberNoticed.add(seat.serviceId);
        notices.push(V3_LINES.storedNonMember(labels.get(seat.serviceId) ?? seat.serviceId));
      }
      continue;
    }
    storedPins.push({ service: seat.serviceId, date: seat.date, role: roleClassOf(seat.roleKey), person: seat.memberId });
  }
  const noticedDouble = new Set<string>();
  for (const second of seatStep.secondSeats) {
    const key = `${second.serviceId}|${second.memberId}`;
    if (noticedDouble.has(key) || dropped.has(second.serviceId) || !input.memberIds.has(second.memberId)) continue;
    noticedDouble.add(key);
    const kept = storedPins.find((p) => p.service === second.serviceId && p.person === second.memberId);
    if (kept) {
      notices.push(V3_LINES.storedDoubleSeat(input.nameOf(second.memberId), labels.get(second.serviceId) ?? second.serviceId, ROLE_ES[kept.role]));
    }
  }
  if (emptyVoiceSeats > 0) notices.unshift(V3_LINES.storedEmptySeats(emptyVoiceSeats));

  // ── Planned: weekend columns with their row targets; counted specials fixed; uncounted specials never.
  const plannedSpecialIds: string[] = [];
  for (const c of input.planned) {
    if (!inHorizon.has(monthOfDate(c.date))) continue;
    const kind = kindOfType(c.type)!;
    labels.set(c.columnId, serviceLabel(kind, c.date, c.serviceName));
    if (kind === "special") {
      if (!c.countsForFairness) continue;
      plannedSpecialIds.push(c.columnId);
      services.push({
        id: c.columnId, date: c.date, month: monthOfDate(c.date), kind,
        ...(isServiceTime(c.time) ? { time: c.time } : {}),
        fixed: true, counts: true,
      });
      continue;
    }
    services.push({
      id: c.columnId, date: c.date, month: monthOfDate(c.date), kind, fixed: false, counts: c.countsForFairness,
      seats: kind === "saturday"
        ? { Lead: input.seats.Lead, BGV: input.seats.BGV }
        : { Lead: input.seats.Lead, BGV: input.seats.BGV, Choir: input.seats.Choir },
    });
  }

  services.sort(byDateThenId);
  const ROLE_ORDER = { Lead: 0, BGV: 1, Choir: 2 } as const;
  storedPins.sort((a, b) =>
    byDateThenId({ date: a.date, id: a.service }, { date: b.date, id: b.service })
    || ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
    || compareCodepoint(a.person, b.person));
  plannedSpecialIds.sort((a, b) => compareCodepoint(a, b));
  return { services, storedPins, storedServiceIds, plannedSpecialIds, labels, notices };
}

/** CDMX date + n days, by UTC integer arithmetic (no local-time day flip). */
function addDaysIso(iso: string, days: number): string {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days);
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * RQ-7 (C5 §5.6), from the roles read — never the ledger: `month` = months[0] − 1; `has_services`
 * = that month holds a stored weekend service or a stored counted special; `services` = those
 * dated in [first day of months[0] − 14 days, first day of months[0]), seats in stored order.
 */
export function buildV3Prior(firstMonth: string, stored: readonly V3StoredRole[]): V3Prior {
  const month = shiftMonth(firstMonth, -1);
  const start = addDaysIso(`${firstMonth}-01`, -14);
  const end = `${firstMonth}-01`;
  const relevant = stored.filter((r) => isWeekend(r) || isCountedSpecial(r));
  const dropped = new Set(keepVoiceSeats(relevant.map(toLedger)).duplicateTargets.flatMap((d) => d.roleIds));
  const kept = relevant.filter((r) => !dropped.has(r._id));
  return {
    month,
    has_services: kept.some((r) => monthOfDate(r.date) === month),
    services: kept
      .filter((r) => r.date >= start && r.date < end)
      .sort((a, b) => compareCodepoint(a.date, b.date) || compareCodepoint(a._id, b._id))
      .map((r) => ({
        date: r.date,
        kind: kindOfType(r._type)!,
        counts: countsForFairness({ _type: r._type, countsForFairness: r.countsForFairness }),
        seats: { Lead: r.leads.map((x) => x._id), BGV: r.bgvs.map((x) => x._id), Choir: r.chorus.map((x) => x._id) },
      })),
  };
}
```

- [ ] **Step 4: Run it, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3Services.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(planner): the v3 request's services — planned, stored as fixed, counted specials — and prior

A v3 request carries exactly the services that will exist. Stored services of the horizon and
counted specials go fixed, their seats as pins, so the solver never touches them and an empty stored
seat creates no share. The seat sent for a stored service is the one C2's seat step keeps, called
directly so there is no second one-seat-per-service rule. Stored ids go verbatim, an invalid stored
time is omitted, and prior comes from the roles read with duplicated targets dropped together."
```

---

## Task 8: People and cadence (RQ-4; the values EQ-4 shows) — [standard]

**Files:**
- Create: `app/components/admin/v3People.ts`
- Create (test): `app/components/admin/__tests__/v3People.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: IF2-12 `cadenceStates`, `CadenceReason` (`fairnessLedger.ts`); IF2-8 `people[].window[line].balance`, `countedSundayLeads`, `firstRecordedIn` (`FairnessLedgerResponse`); IF2-1 `LineKey`, `monthIndex`, `compareCodepoint`; Task 6 `MonthSource`, `dayClass`; Task 4 `V3_LINES`; Task 2 `V3Person`, `V3Role`, `V3Service`.
- Produces: `flagDisagreementLines(input: { sources: readonly MonthSource[]; ids: Iterable<string>; nameOf: (id: string) => string }): string[]`; `interface RunCadenceEntry { month: string; state: "on" | "off"; reason: CadenceReason; wire: "on" | "off" | "out" }`; `type RunCadence = Map<string, RunCadenceEntry[]>` (by member id); `computeRunCadence(input: { months: readonly string[]; sources: readonly MonthSource[]; ledger: FairnessLedgerResponse; services: readonly V3Service[]; eligibility: ReadonlyMap<string, Record<string, V3Role[]>>; priorMonth: string }): RunCadence`; `buildV3People(input: { months; sources; ledger; members: ReadonlyArray<{ _id: string; member_name: string; alias?: string }>; eligibility; extraIds: ReadonlySet<string>; cadence: RunCadence; presenceId: (ruleKey: string) => string; priorMonth: string }): { ok: true; people: V3Person[] } | { ok: false; lines: string[] }`; `carriedPresenceKeys(ledger, ids): string[]` (every `P:` ruleKey the people sent carry — for minting).

- [ ] **Step 1: Write the failing test** — `app/components/admin/__tests__/v3People.test.ts`

```ts
// Solver v3 C6 RQ-4 — people, carried balances (P: keys rewritten to minted ids), exempt and the
// cadence setting from each month's SOURCE, and the cadence states computed ONCE per run from IF2-12.
import { describe, expect, it } from "vitest";

import { buildV3People, carriedPresenceKeys, computeRunCadence } from "../v3People";
import type { MonthSource } from "../v3MonthSources";
import type { V3Role, V3Service } from "../v3Wire";
import { ALL_IN, MEMBERS, figures, ledgerPerson, ledgerResponse } from "./v3Fixtures";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";

type Person = FairnessMonthBody["people"][number];
const p = (memberId: string, over: Partial<Person> = {}): Person => ({
  memberId, roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [], ...over,
});
const src = (month: string, people: Person[], state: MonthSource["state"] = "unrecorded"): MonthSource =>
  ({ month, state, rev: null, recordedAt: null, body: { month, people, presence: [] } });
const sunday = (id: string, date: string, counts = true): V3Service =>
  ({ id, date, month: date.slice(0, 7), kind: "sunday", fixed: false, counts, seats: { Lead: 2, BGV: 3, Choir: 3 } });
const NOV_SUNDAYS = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"].map((d, i) => sunday(`s${i}`, d));
const DEC_SUNDAYS = ["2026-12-06", "2026-12-13"].map((d, i) => sunday(`d${i}`, d));
const leadEverywhere = (ids: string[]) => new Map<string, Record<string, V3Role[]>>(
  ids.map((id) => [id, Object.fromEntries([...NOV_SUNDAYS, ...DEC_SUNDAYS].map((s) => [s.id, ["Lead", "BGV"] as V3Role[]]))]),
);
const out = (key: RoleKey): Record<RoleKey, Status> => ({ ...ALL_IN, [key]: "out" });

describe("computeRunCadence (RQ-4, IF2-12, A14) — once per run, mapped to the wire", () => {
  const base = { months: ["2026-11"], services: NOV_SUNDAYS, priorMonth: "2026-10" };

  it("on when eligible, available and she did not lead last month", () => {
    const run = computeRunCadence({ ...base, sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate" })])], ledger: ledgerResponse(["2026-11"]), eligibility: leadEverywhere(["m-ana"]) });
    expect(run.get("m-ana")).toEqual([{ month: "2026-11", state: "on", reason: "on", wire: "on" }]);
  });

  it("out of the Sunday pool → not_eligible → `out`", () => {
    const run = computeRunCadence({ ...base, sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate", roles: out("Sun.Lead") })])], ledger: ledgerResponse(["2026-11"]), eligibility: leadEverywhere(["m-ana"]) });
    expect(run.get("m-ana")?.[0]).toEqual({ month: "2026-11", state: "off", reason: "not_eligible", wire: "out" });
  });

  it("unavailable every Sunday, or rule-excluded from Sun.Lead on every available Sunday → `off` (A14)", () => {
    const noLead = new Map([["m-ana", Object.fromEntries(NOV_SUNDAYS.map((s) => [s.id, ["BGV"] as V3Role[]]))]]);
    const run = computeRunCadence({ ...base, sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate" })])], ledger: ledgerResponse(["2026-11"]), eligibility: noLead });
    expect(run.get("m-ana")?.[0]).toEqual({ month: "2026-11", state: "off", reason: "no_available_sunday", wire: "off" });
  });

  it("led a counted Sunday in the month before → `off`; a 2-month run assumes month 1 is led when it is on", () => {
    const ledLast = ledgerResponse(["2026-11", "2026-12"], { people: [ledgerPerson("m-ana", "Ana", { countedSundayLeads: ["2026-10-25"] })] });
    const two = { months: ["2026-11", "2026-12"], services: [...NOV_SUNDAYS, ...DEC_SUNDAYS], priorMonth: "2026-10" };
    const sources = [src("2026-11", [p("m-ana", { sundayCadence: "alternate" })]), src("2026-12", [p("m-ana", { sundayCadence: "alternate" })])];
    expect(computeRunCadence({ ...two, sources, ledger: ledLast, eligibility: leadEverywhere(["m-ana"]) }).get("m-ana")!.map((e) => e.wire)).toEqual(["off", "on"]);
    const fresh = computeRunCadence({ ...two, sources, ledger: ledgerResponse(["2026-11", "2026-12"]), eligibility: leadEverywhere(["m-ana"]) }).get("m-ana")!;
    expect(fresh.map((e) => [e.wire, e.reason])).toEqual([["on", "on"], ["off", "assumed_led_previous_month"]]);
  });

  it("a counted Sunday-dated special counts as a counted Sunday; an uncounted Sunday does not", () => {
    const services: V3Service[] = [
      { id: "sp", date: "2026-11-22", month: "2026-11", kind: "special", fixed: true, counts: true },
      sunday("s-un", "2026-11-01", false),
    ];
    const elig = new Map([["m-ana", { sp: ["Lead"] as V3Role[], "s-un": ["Lead"] as V3Role[] }]]);
    const run = computeRunCadence({ months: ["2026-11"], services, priorMonth: "2026-10", sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate" })])], ledger: ledgerResponse(["2026-11"]), eligibility: elig });
    expect(run.get("m-ana")?.[0].wire).toBe("on");
  });

  it("a bound month's record holds the cadence while the screen does not → the record's setting counts", () => {
    const run = computeRunCadence({ ...base, sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate" })], "bound")], ledger: ledgerResponse(["2026-11"]), eligibility: leadEverywhere(["m-ana"]) });
    expect(run.has("m-ana")).toBe(true);
  });
});

describe("buildV3People (RQ-4)", () => {
  const ids = (xs: string[]) => new Set(xs);
  const presenceId = (k: string) => ({ "d-carla-dani": "r1", "d-old": "r2" })[k]!;

  it("carried is IF2-8's window balance, unrounded, with every P: key rewritten to P: + the minted id", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(-87), BGV: figures(13), "P:d-carla-dani": figures(50), "P:d-old": figures(-25) } })] });
    const res = buildV3People({ months: ["2026-11"], sources: [src("2026-11", [p("m-ana")])], ledger, members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids([]), cadence: new Map(), presenceId, priorMonth: "2026-10" });
    if (!res.ok) throw new Error(res.lines.join());
    expect(res.people[0].carried).toEqual({ DL: -87, BGV: 13, "P:r1": 50, "P:r2": -25 });
    expect(JSON.stringify(res.people)).not.toContain("d-carla-dani");
    expect(carriedPresenceKeys(ledger, ["m-ana"])).toEqual(["d-carla-dani", "d-old"]);
  });

  it("people sent: anyone eligible at a request service, every pin holder and rule person — nobody else", () => {
    const res = buildV3People({ months: ["2026-11"], sources: [src("2026-11", [p("m-ana"), p("m-bruno"), p("m-carla")])], ledger: ledgerResponse(["2026-11"]), members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids(["m-dani"]), cadence: new Map(), presenceId, priorMonth: "2026-10" });
    if (!res.ok) throw new Error(res.lines.join());
    expect(res.people.map((x) => x.id)).toEqual(["m-ana", "m-dani"]);
    expect(res.people[0].name).toBe("Ana");
  });

  it("exempt and cadence come from each month's source; a person in one month only is `out` in the other", () => {
    const cadence = new Map([["m-ana", [
      { month: "2026-11", state: "on" as const, reason: "on" as const, wire: "on" as const },
      { month: "2026-12", state: "off" as const, reason: "not_eligible" as const, wire: "out" as const },
    ]]]);
    const res = buildV3People({ months: ["2026-11", "2026-12"], sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate", exempt: true })]), src("2026-12", [])], ledger: ledgerResponse(["2026-11", "2026-12"]), members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids([]), cadence, presenceId, priorMonth: "2026-10" });
    if (!res.ok) throw new Error(res.lines.join());
    expect(res.people[0].exempt).toBe(true);
    expect(res.people[0].cadence).toEqual({ "2026-11": "on", "2026-12": "out" });
  });

  it.each([
    ["Exenta", { exempt: true }, { exempt: false }],
    ["Mes por medio", { sundayCadence: "alternate" as const }, {}],
  ])("refuses a person whose two months disagree on «%s» (the standing behaviour, C5 declined S-3)", (which, nov, dec) => {
    const res = buildV3People({ months: ["2026-11", "2026-12"], sources: [src("2026-11", [p("m-ana", nov)], "bound"), src("2026-12", [p("m-ana", dec)])], ledger: ledgerResponse(["2026-11", "2026-12"]), members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids([]), cadence: new Map(), presenceId, priorMonth: "2026-10" });
    expect(res).toEqual({ ok: false, lines: [`Noviembre y diciembre tienen distinto «${which}» para Ana (uno viene del registro). Planea 1 mes.`] });
  });

  it("dl_since: firstRecordedIn before months[0]; else the first horizon month whose source marks Sun.Lead `in`; else null", () => {
    const run = (firstRecordedIn: Record<string, string>, roles: Record<RoleKey, Status>[]) => {
      const ledger = ledgerResponse(["2026-11", "2026-12"], { people: [ledgerPerson("m-ana", "Ana", { firstRecordedIn })] });
      const res = buildV3People({ months: ["2026-11", "2026-12"], sources: [src("2026-11", [p("m-ana", { roles: roles[0] })]), src("2026-12", [p("m-ana", { roles: roles[1] })])], ledger, members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids([]), cadence: new Map(), presenceId, priorMonth: "2026-10" });
      if (!res.ok) throw new Error(res.lines.join());
      return res.people[0].dl_since;
    };
    expect(run({ "Sun.Lead": "2026-08" }, [ALL_IN, ALL_IN])).toBe("2026-08");
    expect(run({ "Sun.Lead": "2026-11" }, [out("Sun.Lead"), ALL_IN])).toBe("2026-12");
    expect(run({}, [out("Sun.Lead"), out("Sun.Lead")])).toBeNull();
  });

  it("prev_dl_leads counts IF2-8 countedSundayLeads entries in the month before (a repeated date counts twice)", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { countedSundayLeads: ["2026-09-27", "2026-10-04", "2026-10-04"] })] });
    const res = buildV3People({ months: ["2026-11"], sources: [src("2026-11", [p("m-ana")])], ledger, members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids([]), cadence: new Map(), presenceId, priorMonth: "2026-10" });
    if (!res.ok) throw new Error(res.lines.join());
    expect(res.people[0].prev_dl_leads).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/v3People.test.ts`
Expected: FAIL — `Cannot find module '../v3People'`.

- [ ] **Step 3: Write the module** — Create `app/components/admin/v3People.ts`

```ts
// app/components/admin/v3People.ts
//
// Solver v3 C6 RQ-4 — the request's people.
//   · cadence states are computed ONCE per run, after the ledger read and before the specials
//     pre-fill (which reads them), from C2's `cadenceStates` (IF2-12) with:
//       ledCountedSundayPreviousMonth = an IF2-8 `countedSundayLeads` entry in `prior.month`;
//       eligible = `Sun.Lead` is `in` in that month's source;
//       availableCountedSundays = the request's counted Sunday-dated services of that month on which
//       she is eligible for Lead by RQ-2 (a rule-excluded Sunday is not one, A14);
//     and mapped to the wire: reason `not_eligible` → "out", otherwise the state (A14, C5-5). The SAME
//     values go on the wire and into the «Equidad» panel (EQ-4).
//   · carried = IF2-8 `people[].window[line].balance`, copied without rounding, every `P:<ruleKey>`
//     rewritten to `P:` + that ruleKey's minted id (RQ-5 (a)) — a carried-only key included.
//   · exempt and the cadence setting come from each month's source; a person in one month's source
//     only takes its flags (her cadence state in the other month is "out"); two months disagreeing
//     on «Exenta» or «Mes por medio» for one person refuse Auto (C5 declined a per-month form, S-3).
//   · dl_since and prev_dl_leads per A15.

import { cadenceStates, type CadenceReason } from "@/app/utils/fairnessLedger";
import { compareCodepoint, monthIndex, type FairnessLedgerResponse, type LineKey } from "@/app/utils/fairnessVocabulary";
import { dayClass, type MonthSource } from "./v3MonthSources";
import { V3_LINES } from "./v3Copy";
import type { V3Person, V3Role, V3Service } from "./v3Wire";

export interface RunCadenceEntry {
  month: string;
  state: "on" | "off";
  reason: CadenceReason;
  wire: "on" | "off" | "out";
}
export type RunCadence = Map<string, RunCadenceEntry[]>;

const listedIn = (source: MonthSource, id: string) => source.body.people.find((p) => p.memberId === id);

export function computeRunCadence(input: {
  months: readonly string[];
  sources: readonly MonthSource[];
  ledger: FairnessLedgerResponse;
  services: readonly V3Service[];
  eligibility: ReadonlyMap<string, Record<string, V3Role[]>>;
  priorMonth: string;
}): RunCadence {
  const ids = new Set(input.sources.flatMap((s) => s.body.people.filter((p) => p.sundayCadence === "alternate").map((p) => p.memberId)));
  const run: RunCadence = new Map();
  for (const id of [...ids].sort(compareCodepoint)) {
    const ledgerPerson = input.ledger.people.find((p) => p.memberId === id);
    const led = (ledgerPerson?.countedSundayLeads ?? []).some((d) => d.slice(0, 7) === input.priorMonth);
    const elig = input.eligibility.get(id) ?? {};
    const months = input.months.map((month) => {
      const source = input.sources.find((s) => s.month === month);
      const person = source ? listedIn(source, id) : undefined;
      return {
        month,
        eligible: person?.roles["Sun.Lead"] === "in",
        availableCountedSundays: input.services.filter((s) =>
          s.month === month && s.counts && dayClass(s.kind, s.date) === "Sun" && (elig[s.id] ?? []).includes("Lead")).length,
      };
    });
    run.set(id, cadenceStates({ ledCountedSundayPreviousMonth: led, months }).map((o) => ({
      month: o.month, state: o.state, reason: o.reason, wire: o.reason === "not_eligible" ? "out" : o.state,
    })));
  }
  return run;
}

/** Every `P:` ruleKey the given people carry in IF2-8 `window` — presence keys to mint (RQ-5 (a)). */
export function carriedPresenceKeys(ledger: FairnessLedgerResponse, ids: Iterable<string>): string[] {
  const want = new Set(ids);
  const keys = new Set<string>();
  for (const person of ledger.people) {
    if (!want.has(person.memberId)) continue;
    for (const line of Object.keys(person.window)) if (line.startsWith("P:")) keys.add(line.slice(2));
  }
  return [...keys].sort(compareCodepoint);
}

/**
 * RQ-4's horizon-wide refusal, exported so the builder can run it BEFORE the specials pre-fill
 * (SP-5: the pre-fill reads both flags): a person listed in two months' sources with a different
 * «Exenta» or «Mes por medio» in each.
 */
export function flagDisagreementLines(input: {
  sources: readonly MonthSource[];
  ids: Iterable<string>;
  nameOf: (id: string) => string;
}): string[] {
  const lines: string[] = [];
  for (const id of [...new Set(input.ids)].sort(compareCodepoint)) {
    const listings = input.sources.map((s) => ({ month: s.month, item: listedIn(s, id) })).filter((x) => x.item !== undefined);
    for (let i = 1; i < listings.length; i++) {
      const a = listings[0];
      const b = listings[i];
      if (a.item!.exempt !== b.item!.exempt) lines.push(V3_LINES.horizonDisagreement(a.month, b.month, "Exenta", input.nameOf(id)));
      if ((a.item!.sundayCadence ?? null) !== (b.item!.sundayCadence ?? null)) {
        lines.push(V3_LINES.horizonDisagreement(a.month, b.month, "Mes por medio", input.nameOf(id)));
      }
    }
  }
  return lines;
}

export function buildV3People(input: {
  months: readonly string[];
  sources: readonly MonthSource[];
  ledger: FairnessLedgerResponse;
  members: ReadonlyArray<{ _id: string; member_name: string; alias?: string }>;
  eligibility: ReadonlyMap<string, Record<string, V3Role[]>>;
  extraIds: ReadonlySet<string>;
  cadence: RunCadence;
  presenceId: (ruleKey: string) => string;
  priorMonth: string;
}): { ok: true; people: V3Person[] } | { ok: false; lines: string[] } {
  const ids = new Set<string>(input.extraIds);
  for (const [id, byService] of input.eligibility) if (Object.values(byService).some((roles) => roles.length > 0)) ids.add(id);
  const nameOf = (id: string) => {
    const m = input.members.find((x) => x._id === id);
    return m ? (m.alias?.trim() || m.member_name) : (input.ledger.people.find((p) => p.memberId === id)?.name || id);
  };
  const lines = flagDisagreementLines({ sources: input.sources, ids, nameOf });
  const people: V3Person[] = [];
  for (const id of [...ids].sort(compareCodepoint)) {
    const listings = input.sources.map((s) => ({ month: s.month, item: listedIn(s, id) })).filter((x) => x.item !== undefined);
    const ledgerPerson = input.ledger.people.find((p) => p.memberId === id);
    const carried: Partial<Record<LineKey, number>> = {};
    for (const [line, fig] of Object.entries(ledgerPerson?.window ?? {})) {
      if (!fig) continue;
      const key = (line.startsWith("P:") ? `P:${input.presenceId(line.slice(2))}` : line) as LineKey;
      carried[key] = fig.balance;
    }
    const firstDl = ledgerPerson?.firstRecordedIn["Sun.Lead"];
    const dlSince = firstDl !== undefined && monthIndex(firstDl) < monthIndex(input.months[0])
      ? firstDl
      : (input.months.find((m) => {
          const source = input.sources.find((s) => s.month === m);
          return source ? listedIn(source, id)?.roles["Sun.Lead"] === "in" : false;
        }) ?? null);
    const eligibility = Object.fromEntries(Object.entries(input.eligibility.get(id) ?? {}).filter(([, roles]) => roles.length > 0));
    const cadence = input.cadence.get(id);
    people.push({
      id,
      name: nameOf(id),
      exempt: listings[0]?.item?.exempt ?? false,
      eligibility,
      carried,
      ...(cadence ? { cadence: Object.fromEntries(cadence.map((e) => [e.month, e.wire])) } : {}),
      dl_since: dlSince,
      prev_dl_leads: (ledgerPerson?.countedSundayLeads ?? []).filter((d) => d.slice(0, 7) === input.priorMonth).length,
    });
  }
  return lines.length > 0 ? { ok: false, lines: [...new Set(lines)] } : { ok: true, people };
}
```

- [ ] **Step 4: Run it, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3People.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(planner): the v3 request's people — carried balances, cadence states, dl_since

Each person carries the ledger's window balance exactly as read, with every presence line key
rewritten to its minted id so no rule key reaches the wire. The «Mes por medio» states are computed
once per run from C2's X1 function over the request's own counted Sundays, and the same values go
on the wire, into the specials pre-fill and into the panel. A person whose two months disagree on
«Exenta» or «Mes por medio» stops Auto with «Planea 1 mes», since the solver carries one per person."
```

---

## Task 9: Rules from one source per month (RQ-5), their labels and the KH-3 entries — [standard]

**Files:**
- Create: `app/components/admin/v3Rules.ts`
- Create (test): `app/components/admin/__tests__/v3Rules.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: C3 `resolveRulePersonId`, `RosterMember` (`app/utils/sundayCadence.ts`); IF2-16 `rolesOfPatternV3` and `trailingSaturday` (`plannerModel.ts`); IF2-17 `capValueForMonth` and `completeSundaySpine` (`serviceRuleContext.ts`); `canonicalRoles`, `compareCodepoint`, `RoleKey`, `FairnessLedgerResponse`; Task 6 `MonthSource`; Task 5 `MintedIds`, card labels, ordinals, `RuleRefEntry`; Task 4 `V3_CAP_REFUSAL`, `V3_RESOLVER_REFUSAL`, `V3_LINES`; Task 2 `V3Rule`.
- Produces: `interface CollectedRules { caps: Array<{ ri: number; ci: number; person: string; roles: RoleKey[]; op: "<=" | ">="; values: Array<{ month: string; value: number }> }>; exact: Array<{ month: string; memberId: string; roles: RoleKey[]; count: number; card: { ri: number; ci: number } | null }>; presence: Array<{ month: string; ruleKey: string; persons: string[]; roles: RoleKey[]; exclusive: boolean }>; pairs: Array<{ index: number; persons: [string, string]; roles: RoleKey[] }> }`; `collectV3Rules(input: { months: readonly string[]; sources: readonly MonthSource[]; config: SolverConfig; members: readonly RosterMember[] }): { ok: true; rules: CollectedRules; notices: string[]; rulePersons: Set<string> } | { ok: false; lines: string[] }`; `mintInputOf(rules: CollectedRules, carriedKeys: readonly string[]): MintInput`; `emitV3Rules(rules, ids): V3Rule[]`; `ruleReferences(rules, ids, config, ledger, carriedKeys): { labels: Map<string, string>; table: RuleRefEntry[] }`.

- [ ] **Step 1: Write the failing test** — `app/components/admin/__tests__/v3Rules.test.ts`

```ts
// Solver v3 C6 RQ-5 — per month, `==` rules and presence from the month SOURCE, `<=`/`>=` caps and
// pairs from the screen through IF2-16/IF2-17 only, names through C3's exactly-one resolver, every
// id minted. Rules are named by card label in lines and by kind + ordinal in tests (KH-1).
import { afterEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({ roles: vi.fn(), value: vi.fn() }));
vi.mock("../plannerModel", async (importOriginal) => {
  const real = await importOriginal<typeof import("../plannerModel")>();
  spies.roles.mockImplementation(real.rolesOfPatternV3);
  return { ...real, rolesOfPatternV3: (p: string) => spies.roles(p) };
});
vi.mock("../serviceRuleContext", async (importOriginal) => {
  const real = await importOriginal<typeof import("../serviceRuleContext")>();
  spies.value.mockImplementation(real.capValueForMonth);
  return { ...real, capValueForMonth: (c: never, m: string) => spies.value(c, m) };
});

import { collectV3Rules, emitV3Rules, mintInputOf, ruleReferences } from "../v3Rules";
import { mintRuleIds } from "../v3RuleIds";
import type { MonthSource } from "../v3MonthSources";
import { ALL_IN, MEMBERS, NAME_SHAPED, cap, config, ledgerResponse, restriction } from "./v3Fixtures";
import type { FairnessMonthBody } from "@/app/utils/fairnessVocabulary";

afterEach(() => { spies.roles.mockClear(); spies.value.mockClear(); });

type Person = FairnessMonthBody["people"][number];
const person = (memberId: string, over: Partial<Person> = {}): Person =>
  ({ memberId, roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [], ...over });
const source = (month: string, over: Partial<FairnessMonthBody> = {}, state: MonthSource["state"] = "unrecorded"): MonthSource =>
  ({ month, state, rev: null, recordedAt: null, body: { month, people: [], presence: [], ...over } });

describe("caps from the screen (IF2-16, IF2-17)", () => {
  it("a relative cap resolves per month: a 5-Sunday and a 4-Sunday month", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("c", "Sun.BGV", "<=", 0, { relative: true, relOffset: 2 })] })] });
    const out = collectV3Rules({ months: ["2026-11", "2026-12"], sources: [source("2026-11"), source("2026-12")], config: cfg, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    expect(out.rules.caps[0].values).toEqual([{ month: "2026-11", value: 3 }, { month: "2026-12", value: 2 }]);
  });

  it("every roles list comes from IF2-16 and every <=/>= value from IF2-17 — never for an == cap", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("le", "Sun.*", "<=", 2), cap("eq", "Sun.Lead", "==", 2)] })] });
    const out = collectV3Rules({ months: ["2026-11"], sources: [source("2026-11")], config: cfg, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    expect(spies.roles).toHaveBeenCalledWith("Sun.*");
    expect(out.rules.caps[0].roles).toEqual(spies.roles.mock.results.find((r, i) => spies.roles.mock.calls[i][0] === "Sun.*")!.value);
    expect(spies.value.mock.calls.map(([c]) => (c as { op: string }).op)).toEqual(["<="]);
  });

  it.each([
    ["a fractional fixed value", cap("c", "Sun.Lead", "<=", 1.5), "no da un número entero de lugares en noviembre"],
    ["a fractional relOffset that is not clamped", cap("c", "Sun.Lead", "<=", 0, { relative: true, relOffset: 0.5 }), "no da un número entero de lugares en noviembre"],
    ["a non-finite value", cap("c", "Sun.Lead", ">=", Number.NaN), "no da un número entero de lugares en noviembre"],
    ["a fixed -1", cap("c", "Sun.Lead", ">=", -1), "pide un número negativo de lugares"],
  ])("IF2-17 ok:false (%s) refuses before the fetch, naming the card, never rounding", (_name, theCap, fragment) => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [theCap] })] });
    const out = collectV3Rules({ months: ["2026-11"], sources: [source("2026-11")], config: cfg, members: MEMBERS });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.lines).toHaveLength(1);
      expect(out.lines[0]).toMatch(/^No se puede correr Auto: «Ana · Sun\.Lead /);
      expect(out.lines[0]).toContain(fragment);
    }
  });

  it("a not_whole result in the SECOND month alone names only that month", () => {
    // Dec 2026 has 4 Sundays (4 − 4.5 clamps to 0, whole); Jan 2027 has 5 (5 − 4.5 = 0.5).
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("c", "Sun.BGV", "<=", 0, { relative: true, relOffset: 4.5 })] })] });
    const out = collectV3Rules({ months: ["2026-12", "2027-01"], sources: [source("2026-12"), source("2027-01")], config: cfg, members: MEMBERS });
    expect(out).toEqual({ ok: false, lines: ["No se puede correr Auto: «Ana · Sun.BGV <= sem−4.5» no da un número entero de lugares en enero. Corrige su número."] });
  });

  it("a relative cap clamped to 0 is sent as 0 and noticed", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("c", "Sun.BGV", "<=", 0, { relative: true, relOffset: 6 })] })] });
    const out = collectV3Rules({ months: ["2026-11"], sources: [source("2026-11")], config: cfg, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    expect(out.rules.caps[0].values).toEqual([{ month: "2026-11", value: 0 }]);
    expect(out.notices).toContain("Ana · Sun.BGV <= sem−6 queda en 0 en noviembre (tiene 5 domingos).");
  });

  it("an ambiguous name on a <= cap refuses — even when every horizon month is bound", () => {
    const twoAnas = [...MEMBERS, { _id: "m-ana-2", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz"] }];
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("c", "Sun.BGV", "<=", 2)] })] });
    const out = collectV3Rules({ months: ["2026-11"], sources: [source("2026-11", {}, "bound")], config: cfg, members: twoAnas });
    expect(out).toEqual({ ok: false, lines: ["No se puede correr Auto: «Ana» en las reglas coincide con más de una persona. Corrige el nombre en la regla."] });
  });
});

describe("== rules and presence from the month source", () => {
  it("a bound month sends its record's count, a recorded-unbound month the screen's (via the resolver body)", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("eq", "Sun.Lead", "==", 3)] })] });
    const bound = source("2026-11", { people: [person("m-ana", { exactRules: [{ roles: ["Sun.Lead"], count: 2 }] })] }, "bound");
    const fromScreen = source("2026-12", { people: [person("m-ana", { exactRules: [{ roles: ["Sun.Lead"], count: 3 }] })] }, "recorded_unbound");
    const out = collectV3Rules({ months: ["2026-11", "2026-12"], sources: [bound, fromScreen], config: cfg, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    expect(out.rules.exact.map((x) => [x.month, x.count, x.card])).toEqual([
      ["2026-11", 2, { ri: 0, ci: 0 }],
      ["2026-12", 3, { ri: 0, ci: 0 }],
    ]);
    expect(out.rules.caps).toEqual([]);
  });

  it("presence is month-scoped from each source: two months with different members are two objects, one id, no refusal", () => {
    const nov = source("2026-11", { presence: [{ ruleKey: "d-carla-dani", roles: ["Sun.BGV"], members: ["m-carla", "m-dani"], exclusive: false }] });
    const dec = source("2026-12", { presence: [{ ruleKey: "d-carla-dani", roles: ["Sun.BGV"], members: ["m-carla", "m-bruno"], exclusive: true }] });
    const out = collectV3Rules({ months: ["2026-11", "2026-12"], sources: [nov, dec], config: NAME_SHAPED, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    const ids = mintRuleIds(NAME_SHAPED, mintInputOf(out.rules, []));
    const presence = emitV3Rules(out.rules, ids).filter((r) => r.kind === "presence");
    expect(presence).toEqual([
      { kind: "presence", id: "r1", persons: ["m-carla", "m-dani"], roles: ["Sun.BGV"], exclusive: false, month: "2026-11" },
      { kind: "presence", id: "r1", persons: ["m-carla", "m-bruno"], roles: ["Sun.BGV"], exclusive: true, month: "2026-12" },
    ]);
  });

  it("pairs come from the screen once, horizon-wide (no month), names resolved exactly once", () => {
    const out = collectV3Rules({ months: ["2026-11", "2026-12"], sources: [source("2026-11"), source("2026-12")], config: NAME_SHAPED, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    const rules = emitV3Rules(out.rules, mintRuleIds(NAME_SHAPED, mintInputOf(out.rules, [])));
    const pairs = rules.filter((r) => r.kind === "pair");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({ kind: "pair", id: "p1", persons: ["m-ana", "m-bruno"], roles: ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"] });
    expect(rules.some((r) => r.id === "mandatory_lead")).toBe(false);
  });
});

describe("week exclusions (RQ-5): a month solved from the screen without that week is noticed, never refused", () => {
  it("week 5 in December 2026 (4 Sundays, no trailing Saturday) — and not in October (its 31st is week 5)", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { weekExclusions: [{ id: "w", week: 5, pattern: "Sat.*" }] })] });
    const dec = collectV3Rules({ months: ["2026-12"], sources: [source("2026-12")], config: cfg, members: MEMBERS });
    const oct = collectV3Rules({ months: ["2026-10"], sources: [source("2026-10")], config: cfg, members: MEMBERS });
    const bound = collectV3Rules({ months: ["2026-12"], sources: [source("2026-12", {}, "bound")], config: cfg, members: MEMBERS });
    expect(dec.ok && dec.notices).toEqual(["Ana · sem.5 Sat.* no aplica en diciembre: ese mes no tiene semana 5."]);
    expect(oct.ok && oct.notices).toEqual([]);
    expect(bound.ok && bound.notices).toEqual([]);
  });
});

describe("labels and KH-3 entries", () => {
  it("a matched exact item takes its card's label and ordinal; an unmatched one says «regla fija registrada» and its facts", () => {
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { caps: [cap("eq", "Sun.Lead", "==", 2)] })] });
    const nov = source("2026-11", { people: [
      person("m-ana", { exactRules: [{ roles: ["Sun.Lead"], count: 2 }] }),
      person("m-bruno", { exactRules: [{ roles: ["Sat.Lead"], count: 1 }] }),
    ] }, "bound");
    const out = collectV3Rules({ months: ["2026-11"], sources: [nov], config: cfg, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    const ids = mintRuleIds(cfg, mintInputOf(out.rules, []));
    const { labels, table } = ruleReferences(out.rules, ids, cfg, ledgerResponse(["2026-11"]), []);
    expect(labels.get("c1")).toBe("Ana · Sun.Lead == 2");
    expect(labels.get("x1")).toBe("regla fija registrada de noviembre");
    expect(table).toEqual([
      { wire: "c1", kind: "count", ordinal: "restrictions[0].caps[0]" },
      { wire: "x1", kind: "count", ordinal: "sin tarjeta, 2026-11 m-bruno Sat.Lead" },
    ]);
  });

  it("a presence id with no card, and a carried-only P: key, read «regla de presencia registrada» with their GET index", () => {
    const nov = source("2026-11", { presence: [{ ruleKey: "d-deleted", roles: ["Sun.BGV"], members: ["m-carla", "m-dani"], exclusive: false }] }, "bound");
    const out = collectV3Rules({ months: ["2026-11"], sources: [nov], config: NAME_SHAPED, members: MEMBERS });
    if (!out.ok) throw new Error(out.lines.join());
    const carried = ["d-carla-dani", "d-old"];
    const ids = mintRuleIds(NAME_SHAPED, mintInputOf(out.rules, carried));
    const ledger = ledgerResponse(["2026-11"]);
    const { labels, table } = ruleReferences(out.rules, ids, NAME_SHAPED, ledger, carried);
    expect(labels.get(ids.presence("d-deleted"))).toBe("regla de presencia registrada");
    expect(labels.get(ids.presence("d-carla-dani"))).toBe("Carla, Dani en Sun.BGV c/sem");
    expect(table.filter((e) => e.wire.startsWith("P:")).map((e) => e.wire).sort()).toEqual(
      [`P:${ids.presence("d-carla-dani")}`, `P:${ids.presence("d-old")}`].sort(),
    );
    expect(table.find((e) => e.wire === `P:${ids.presence("d-carla-dani")}`)?.ordinal).toBe("presence[0]");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/v3Rules.test.ts`
Expected: FAIL — `Cannot find module '../v3Rules'`.

- [ ] **Step 3: Write the module** — Create `app/components/admin/v3Rules.ts`

```ts
// app/components/admin/v3Rules.ts
//
// Solver v3 C6 RQ-5 — rules, per month, from one source:
//   · `==` count rules = the month source's `exactRules` (a bound month's record, otherwise IF2-15's
//     body); an on-screen `==` cap is never sent itself — it only lends its id and label to the
//     item covering the same person and canonical role set (RQ-5 (c));
//   · presence = the month source's `presence`, always MONTH-SCOPED (C5-16), one id per ruleKey;
//   · `<=`/`>=` caps and pairs come from the SCREEN for every month: roles only from IF2-16, values
//     only from IF2-17 per month (relative caps against the month's full Sunday count). IF2-17
//     `ok:false` refuses Auto before the fetch, one line per cap naming its card; nothing is rounded,
//     clamped, dropped or sent as 0 in its place. A relative cap that resolves to 0 is sent as 0 and
//     noticed. Every person resolves through C3's `resolveRulePersonId` — exactly one or Auto refuses;
//   · week exclusions and `!in` patterns reach the solver ONLY as eligibility (A15, C5-2); a week a
//     month solved from the screen does not have is noticed, never refused.
// A cap or pair whose pattern expands to [] constrains no role and is not sent (the form cannot
// produce one; only a hand-edited config can).

import { resolveRulePersonId, type RosterMember } from "@/app/utils/sundayCadence";
import { canonicalRoles, compareCodepoint, type FairnessLedgerResponse, type RoleKey } from "@/app/utils/fairnessVocabulary";
import { rolesOfPatternV3, trailingSaturday, type SolverConfig } from "./plannerModel";
import { capValueForMonth, completeSundaySpine } from "./serviceRuleContext";
import type { MonthSource } from "./v3MonthSources";
import { V3_CAP_REFUSAL, V3_LINES, V3_RESOLVER_REFUSAL } from "./v3Copy";
import {
  capCardLabel, capOrdinal, conflictCardLabel, conflictOrdinal, presenceCardLabel, presenceOrdinal,
  sinTarjetaExact, sinTarjetaPresence, weekExclusionLabel, type MintInput, type MintedIds, type RuleRefEntry,
} from "./v3RuleIds";
import type { V3Rule } from "./v3Wire";

export interface CollectedRules {
  caps: Array<{ ri: number; ci: number; person: string; roles: RoleKey[]; op: "<=" | ">="; values: Array<{ month: string; value: number }> }>;
  exact: Array<{ month: string; memberId: string; roles: RoleKey[]; count: number; card: { ri: number; ci: number } | null }>;
  presence: Array<{ month: string; ruleKey: string; persons: string[]; roles: RoleKey[]; exclusive: boolean }>;
  pairs: Array<{ index: number; persons: [string, string]; roles: RoleKey[] }>;
}

const sameRoles = (a: readonly RoleKey[], b: readonly RoleKey[]) => canonicalRoles(a).join(",") === canonicalRoles(b).join(",");

export function collectV3Rules(input: {
  months: readonly string[];
  sources: readonly MonthSource[];
  config: SolverConfig;
  members: readonly RosterMember[];
}): { ok: true; rules: CollectedRules; notices: string[]; rulePersons: Set<string> } | { ok: false; lines: string[] } {
  const { months, sources, config } = input;
  const roster = [...input.members];
  const lines: string[] = [];
  const notices: string[] = [];
  const rules: CollectedRules = { caps: [], exact: [], presence: [], pairs: [] };
  const resolve = (person: string): string | null => {
    const r = resolveRulePersonId(person, roster);
    if (r.ok) return r.id;
    lines.push(V3_RESOLVER_REFUSAL[r.reason](person, months[0], null));
    return null;
  };

  // `<=` / `>=` caps from the screen.
  config.restrictions.forEach((r, ri) => {
    r.caps.forEach((c, ci) => {
      if (c.op === "==") return;
      const roles = rolesOfPatternV3(c.pattern);
      if (roles.length === 0) return;
      const person = resolve(r.person);
      const values: Array<{ month: string; value: number }> = [];
      const notWhole: string[] = [];
      let negative = false;
      for (const month of months) {
        const v = capValueForMonth(c, month);
        if (!v.ok) {
          if (v.reason === "not_whole") notWhole.push(month);
          else negative = true;
          continue;
        }
        values.push({ month, value: v.count });
        if (c.relative && v.count === 0) notices.push(V3_LINES.relativeZero(capCardLabel(config, ri, ci), month, completeSundaySpine(month).length));
      }
      if (notWhole.length > 0) lines.push(V3_CAP_REFUSAL.not_whole(capCardLabel(config, ri, ci), notWhole));
      if (negative) lines.push(V3_CAP_REFUSAL.negative(capCardLabel(config, ri, ci), months));
      if (person !== null && notWhole.length === 0 && !negative) rules.caps.push({ ri, ci, person, roles, op: c.op, values });
    });
  });

  // `==` rules and presence from each month's source. An item takes the on-screen `==` cap with the
  // same person and canonical role set (by A38 at most one covers a role key), else its own id.
  const matchCard = (memberId: string, roles: readonly RoleKey[]): { ri: number; ci: number } | null => {
    for (let ri = 0; ri < config.restrictions.length; ri++) {
      const r = config.restrictions[ri];
      for (let ci = 0; ci < r.caps.length; ci++) {
        const c = r.caps[ci];
        if (c.op !== "==") continue;
        const who = resolveRulePersonId(r.person, roster);
        if (who.ok && who.id === memberId && sameRoles(rolesOfPatternV3(c.pattern), roles)) return { ri, ci };
      }
    }
    return null;
  };
  for (const source of sources) {
    for (const p of source.body.people) {
      for (const x of p.exactRules) {
        rules.exact.push({ month: source.month, memberId: p.memberId, roles: [...x.roles], count: x.count, card: matchCard(p.memberId, x.roles) });
      }
    }
    for (const r of source.body.presence) {
      rules.presence.push({ month: source.month, ruleKey: r.ruleKey, persons: [...r.members], roles: [...r.roles], exclusive: r.exclusive });
    }
  }

  // Pairs from the screen, horizon-wide.
  config.conflicts.forEach((c, index) => {
    const roles = rolesOfPatternV3(c.pattern);
    if (roles.length === 0) return;
    const a = resolve(c.personA);
    const b = resolve(c.personB);
    if (a !== null && b !== null && a !== b) rules.pairs.push({ index, persons: [a, b], roles });
  });

  // Week exclusions: noticed for every month solved from the screen that lacks the week.
  for (const source of sources) {
    if (source.state === "bound") continue;
    const spine = completeSundaySpine(source.month);
    const weeks = spine.length + (trailingSaturday(spine) ? 1 : 0);
    for (const r of config.restrictions) {
      for (const we of r.weekExclusions) {
        if (we.week > weeks) notices.push(V3_LINES.weekNotApplicable(weekExclusionLabel(r, we), source.month, we.week));
      }
    }
  }

  if (lines.length > 0) return { ok: false, lines: [...new Set(lines)] };
  const rulePersons = new Set<string>([
    ...rules.caps.map((c) => c.person),
    ...rules.exact.map((x) => x.memberId),
    ...rules.presence.flatMap((p) => p.persons),
    ...rules.pairs.flatMap((p) => p.persons),
  ]);
  return { ok: true, rules, notices, rulePersons };
}

export function mintInputOf(rules: CollectedRules, carriedKeys: readonly string[]): MintInput {
  return {
    caps: [
      ...rules.caps.map(({ ri, ci }) => ({ ri, ci })),
      ...rules.exact.flatMap((x) => (x.card ? [x.card] : [])),
    ].filter((c, i, all) => all.findIndex((d) => d.ri === c.ri && d.ci === c.ci) === i),
    exactUnmatched: rules.exact.filter((x) => x.card === null).map((x) => ({ month: x.month, memberId: x.memberId, roles: x.roles })),
    conflicts: rules.pairs.map((p) => p.index),
    presenceKeys: [...rules.presence.map((p) => p.ruleKey), ...carriedKeys],
  };
}

export function emitV3Rules(rules: CollectedRules, ids: MintedIds): V3Rule[] {
  const out: V3Rule[] = [];
  for (const c of rules.caps) {
    for (const { month, value } of c.values) {
      out.push({ kind: "count", id: ids.cap(c.ri, c.ci), person: c.person, roles: c.roles, op: c.op, month, value });
    }
  }
  for (const x of rules.exact) {
    out.push({
      kind: "count",
      id: x.card ? ids.cap(x.card.ri, x.card.ci) : ids.exact(x.month, x.memberId, x.roles),
      person: x.memberId, roles: x.roles, op: "==", month: x.month, value: x.count,
    });
  }
  for (const p of rules.presence) {
    out.push({ kind: "presence", id: ids.presence(p.ruleKey), persons: p.persons, roles: p.roles, exclusive: p.exclusive, month: p.month });
  }
  for (const p of rules.pairs) {
    out.push({ kind: "pair", id: ids.pair(p.index), persons: p.persons, roles: p.roles });
  }
  return out;
}

const KIND_ORDER: Record<string, number> = { c: 0, x: 1, p: 2, r: 3 };
const wireOrder = (wire: string) => {
  const bare = wire.startsWith("P:") ? wire.slice(2) : wire;
  return [KIND_ORDER[bare[0]] ?? 9, Number(bare.slice(1)), wire.startsWith("P:") ? 1 : 0] as const;
};

/** The in-memory id → card label map (§7) and KH-3's name-free table, one entry per wire id and `P:` key. */
export function ruleReferences(
  rules: CollectedRules, ids: MintedIds, config: SolverConfig, ledger: FairnessLedgerResponse, carriedKeys: readonly string[],
): { labels: Map<string, string>; table: RuleRefEntry[] } {
  const labels = new Map<string, string>();
  const table = new Map<string, RuleRefEntry>();
  const add = (wire: string, kind: RuleRefEntry["kind"], ordinal: string, label: string) => {
    if (!table.has(wire)) table.set(wire, { wire, kind, ordinal });
    const bare = wire.startsWith("P:") ? wire.slice(2) : wire;
    if (!labels.has(bare)) labels.set(bare, label);
  };
  for (const c of rules.caps) add(ids.cap(c.ri, c.ci), "count", capOrdinal(c.ri, c.ci), capCardLabel(config, c.ri, c.ci));
  for (const x of rules.exact) {
    if (x.card) add(ids.cap(x.card.ri, x.card.ci), "count", capOrdinal(x.card.ri, x.card.ci), capCardLabel(config, x.card.ri, x.card.ci));
    else add(ids.exact(x.month, x.memberId, x.roles), "count", sinTarjetaExact(x.month, x.memberId, x.roles), V3_LINES.recordedExactLabel(x.month));
  }
  for (const p of rules.pairs) add(ids.pair(p.index), "pair", conflictOrdinal(p.index), conflictCardLabel(config, p.index));
  const presenceOf = (ruleKey: string) => {
    const ordinal = presenceOrdinal(config, ruleKey);
    const card = config.presence.find((r) => r.id === ruleKey);
    return {
      ordinal: ordinal ?? sinTarjetaPresence(ruleKey, ledger),
      label: card ? presenceCardLabel(card) : V3_LINES.recordedPresenceLabel,
    };
  };
  for (const ruleKey of new Set(rules.presence.map((p) => p.ruleKey))) {
    const { ordinal, label } = presenceOf(ruleKey);
    add(ids.presence(ruleKey), "presence", ordinal, label);
  }
  for (const ruleKey of [...new Set(carriedKeys)].sort(compareCodepoint)) {
    const { ordinal, label } = presenceOf(ruleKey);
    add(`P:${ids.presence(ruleKey)}`, "presence", ordinal, label);
  }
  const entries = [...table.values()].sort((a, b) => {
    const [ka, na, pa] = wireOrder(a.wire);
    const [kb, nb, pb] = wireOrder(b.wire);
    return ka - kb || na - nb || pa - pb;
  });
  return { labels, table: entries };
}
```

- [ ] **Step 4: Run it, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3Rules.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(planner): v3 rules per month from one source, with minted ids and card labels

A bound month's fixed counts and presence rules are its record's; every month's maximums,
minimums and «no juntos» pairs are the screen's, expanded and resolved per month only by C2's two
neutral functions. A count that is not a whole number stops Auto with a line naming the rule's card
— never rounded or sent as 0 — and a relative maximum that lands on 0 is sent and said. Every name
must match exactly one member. Each run also gets its id → card label map and its name-free table."
```

---

## Task 10: The counted-specials pre-fill — hard blocks, protection tiers, balance order (SP-1, SP-2, SP-6, SP-7, CTL-2) — [standard]

**Files:**
- Create: `app/components/admin/v3Prefill.ts`
- Create (test): `app/components/admin/__tests__/v3Prefill.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: today's filler primitives, unchanged — `rankCandidates`, `RankMember` (`candidateRanking.ts`); `AUTO_FILL_ROW_IDS`, `withAutoCell` (`localFill.ts`); `assignedForColumn`, `cellsToParticipantRoles`, `hasTarget`, `seatDefForRow`, `GridCell`, `GridColumn`, `GridRow`, `SolverConfig` (`plannerModel.ts`); `ParticipantRole` (`app/utils/computeParticipation.ts`); C2 `ROLE_LINE`, `RoleKey`, `FairnessLedgerResponse`, `civilDayOfWeek`; Task 6 `MonthSource`; Task 8 `RunCadence`; Task 4 `V3_LINES`; Task 2 `V3Role`.
- Produces: `type Protection = "no_consecutive" | "saturday_cap" | "sunday_cap" | "cadence"`; `interface FixedLead { date: string; memberId: string; dl: boolean }` (a Lead seat fixed before the solve at a COUNTED service, or a `prior` counted Lead); `interface PrefillTarget { columnId: string; date: string; month: string; label: string }`; `prefillCountedSpecials(input: { targets: readonly PrefillTarget[]; columns: readonly GridColumn[]; rows: readonly GridRow[]; cells: readonly GridCell[]; members: readonly RankMember[]; savedWindow: readonly ParticipantRole[]; config: SolverConfig; eligibility: ReadonlyMap<string, Record<string, V3Role[]>>; sources: ReadonlyMap<string, MonthSource>; cadence: RunCadence; ledger: FairnessLedgerResponse; fixedLeads: readonly FixedLead[]; nameOf: (id: string) => string }): { cells: GridCell[]; placed: number; notices: string[] }`.

- [ ] **Step 1: Write the failing test** — `app/components/admin/__tests__/v3Prefill.test.ts`

```ts
// Solver v3 C6 SP-1, SP-2, SP-7, CTL-2 — planned COUNTED specials are filled before the request is
// built: today's hard blocks plus RQ-2's eligibility; for a Lead, candidates whose placement would
// itself miss a protection the solver can only report as `pins` go to a SECOND tier, used only when
// the first is empty; the first tier is the line's members most owed first, then today's load order.
import { describe, expect, it } from "vitest";

import { prefillCountedSpecials, type FixedLead, type PrefillTarget } from "../v3Prefill";
import type { MonthSource } from "../v3MonthSources";
import type { RunCadence } from "../v3People";
import type { V3Role } from "../v3Wire";
import { buildColumns, type GridCell, type GridRow } from "../plannerModel";
import { ALL_IN, ANA, BRUNO, CARLA, DANI, MEMBERS, config, figures, ledgerPerson, ledgerResponse, restriction } from "./v3Fixtures";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";

const SUN_SPECIAL = "create:special_role__2026-11-22";      // a Sunday-dated special → DL-mapped Lead
const FRI_SPECIAL = "create:special_role__2026-11-20";      // a Friday special → SL-mapped Lead
const ROWS: GridRow[] = [
  { id: "lead", label: "Lead", category: "voz", target: 1 },
  { id: "bgv", label: "BGV", category: "voz", target: 1 },
];
const COLUMNS = buildColumns({
  sundayDates: [], activeSatDates: [],
  specials: [{ date: "2026-11-22", name: "Vigilia", countsForFairness: true }, { date: "2026-11-20", name: "Bautizos", countsForFairness: true }],
});
const T = (columnId: string): PrefillTarget => ({ columnId, date: columnId.slice(-10), month: "2026-11", label: columnId === SUN_SPECIAL ? "Vigilia 22 nov" : "Bautizos 20 nov" });
type Person = FairnessMonthBody["people"][number];
const person = (memberId: string, over: Partial<Person> = {}): Person => ({ memberId, roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [], ...over });
const sourceOf = (people: Person[]): Map<string, MonthSource> =>
  new Map([["2026-11", { month: "2026-11", state: "unrecorded", rev: null, recordedAt: null, body: { month: "2026-11", people, presence: [] } }]]);
const everyoneEligible = (ids: string[]) => new Map<string, Record<string, V3Role[]>>(
  ids.map((id) => [id, { [SUN_SPECIAL]: ["Lead", "BGV"], [FRI_SPECIAL]: ["Lead", "BGV"] }]),
);
const leaders = [ANA, BRUNO, { ...CARLA, memberType: ["voz", "sunday_lead"] }];

function run(over: Partial<Parameters<typeof prefillCountedSpecials>[0]> = {}) {
  return prefillCountedSpecials({
    targets: [T(SUN_SPECIAL)],
    columns: COLUMNS, rows: ROWS, cells: [], members: leaders, savedWindow: [],
    config: config(),
    eligibility: everyoneEligible(leaders.map((m) => m._id)),
    sources: sourceOf(leaders.map((m) => person(m._id))),
    cadence: new Map(),
    ledger: ledgerResponse(["2026-11"]),
    fixedLeads: [],
    nameOf: (id) => MEMBERS.find((m) => m._id === id)?.alias ?? id,
    ...over,
  });
}
const lead = (cells: GridCell[], columnId = SUN_SPECIAL) =>
  cells.find((c) => c.columnId === columnId && c.rowId === "lead")?.occupants.map((o) => o.memberId) ?? [];

describe("SP-1 — today's hard blocks AND RQ-2's eligibility", () => {
  it("never places someone unavailable that day, already seated here, without a voice Tipo, or kept apart by a pair rule", () => {
    const out = run({
      members: [{ ...ANA, unavailableDates: ["2026-11-22"] }, BRUNO, { ...CARLA, memberType: ["voz", "sunday_lead"] }, { ...DANI, memberType: ["instrumento"] }],
      eligibility: everyoneEligible(["m-ana", "m-bruno", "m-carla", "m-dani"]),
      cells: [{ columnId: SUN_SPECIAL, rowId: "bgv", occupants: [{ memberId: "m-bruno" }], origin: "manual" }],
      config: config({ conflicts: [{ id: "x", personA: "Carla", personB: "Bruno", pattern: "*.*" }] }),
    });
    // Ana unavailable; Bruno holds BGV here (same category); Dani has no voice Tipo; Carla is kept apart from Bruno.
    // Both rows are passed: the hard blocks see a column's occupants only through the rows it is given.
    expect(lead(out.cells)).toEqual([]);
  });

  it("never places a candidate the screen admits but the month source (e.g. a bound record) does not", () => {
    const elig = everyoneEligible(["m-bruno", "m-carla"]);
    elig.set("m-ana", { [SUN_SPECIAL]: ["BGV"] });   // no Lead at this special by the record
    const out = run({ eligibility: elig, ledger: ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(500) } })] }) });
    expect(lead(out.cells)).not.toContain("m-ana");
  });

  it("is append-only: a hand-placed occupant stays and only missing seats are filled", () => {
    const out = run({ cells: [{ columnId: SUN_SPECIAL, rowId: "lead", occupants: [{ memberId: "m-carla" }], origin: "manual" }] });
    expect(lead(out.cells)).toEqual(["m-carla"]);
  });
});

describe("SP-2 — first tier: the line's members most owed first, then today's load order", () => {
  it("orders DL-line candidates by carried balance, each placement counting as a received seat", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [
      ledgerPerson("m-ana", "Ana", { window: { DL: figures(30) } }),
      ledgerPerson("m-bruno", "Bruno", { window: { DL: figures(120) } }),
    ] });
    const out = run({ ledger, targets: [T(SUN_SPECIAL)] });
    expect(lead(out.cells)).toEqual(["m-bruno"]);
  });

  it("a cadence member in her ON month ranks after every DL-line candidate, whatever the balances", () => {
    const cadence: RunCadence = new Map([["m-ana", [{ month: "2026-11", state: "on", reason: "on", wire: "on" }]]]);
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(900) } }), ledgerPerson("m-bruno", "Bruno", { window: { DL: figures(-50) } })] });
    const out = run({ cadence, ledger, members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]), sources: sourceOf([person("m-ana", { sundayCadence: "alternate" }), person("m-bruno")]) });
    expect(lead(out.cells)).toEqual(["m-bruno"]);
  });

  it("CTL-2: neither «Holgura» nor «Exenta» moves a counted special's ranking", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(80) } }), ledgerPerson("m-bruno", "Bruno", { window: { DL: figures(10) } })] });
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { fairness: "slack", fairnessSlack: 5 }), restriction("r-bruno", "Bruno", { fairness: "exempt" })] });
    expect(lead(run({ ledger, config: cfg }).cells)).toEqual(["m-ana"]);
  });

  it("BGV uses the first tier's order alone (no protection tiers)", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-carla", "Carla", { window: { BGV: figures(200) } })] });
    const out = run({ ledger, fixedLeads: [{ date: "2026-11-08", memberId: "m-carla", dl: true }] });
    expect(out.cells.find((c) => c.rowId === "bgv")?.occupants.map((o) => o.memberId)).toEqual(["m-carla"]);
  });
});

describe("SP-2 — the second tier, one case per protection, used only when the first tier is empty", () => {
  const status = (k: RoleKey, s: Status) => ({ ...ALL_IN, [k]: s });

  it("(a) a cadence member in her OFF month is not placed while a first-tier candidate exists", () => {
    const cadence: RunCadence = new Map([["m-ana", [{ month: "2026-11", state: "off", reason: "led_previous_month", wire: "off" }]]]);
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(900) } })] });
    expect(lead(run({ cadence, ledger }).cells)).not.toContain("m-ana");
  });

  it("(b) a stored Sunday Lead that month pushes a regular to the second tier; «exact» for Sun.Lead stays first", () => {
    // Bruno's fixed Sunday is not adjacent to the 22nd, so «exact» is the only thing that could matter for him.
    const fixed: FixedLead[] = [{ date: "2026-11-08", memberId: "m-ana", dl: true }, { date: "2026-11-01", memberId: "m-bruno", dl: true }];
    const sources = sourceOf([person("m-ana"), person("m-bruno", { roles: status("Sun.Lead", "exact") }), person("m-carla")]);
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(900) } })] });
    const out = run({ fixedLeads: fixed, sources, ledger, members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]) });
    expect(lead(out.cells)).toEqual(["m-bruno"]);
  });

  it("(b) two Sunday-dated counted specials in one month: the first placement pushes that person to the second tier for the second", () => {
    const second = "create:special_role__2026-11-29";
    const cols = buildColumns({ sundayDates: [], activeSatDates: [], specials: [{ date: "2026-11-22", name: "Vigilia", countsForFairness: true }, { date: "2026-11-29", name: "Vigilia", countsForFairness: true }] });
    const elig = new Map<string, Record<string, V3Role[]>>([["m-ana", { [SUN_SPECIAL]: ["Lead"], [second]: ["Lead"] }], ["m-bruno", { [SUN_SPECIAL]: ["Lead"], [second]: ["Lead"] }]]);
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(500) } })] });
    const out = run({ columns: cols, targets: [T(SUN_SPECIAL), { columnId: second, date: "2026-11-29", month: "2026-11", label: "Vigilia 29 nov" }], eligibility: elig, members: [ANA, BRUNO], ledger, rows: [ROWS[0]] });
    expect(lead(out.cells, SUN_SPECIAL)).toEqual(["m-ana"]);
    expect(lead(out.cells, second)).toEqual(["m-bruno"]);
  });

  it("(c) a Saturday-class special and a candidate holding a stored Saturday Lead that month", () => {
    const fixed: FixedLead[] = [{ date: "2026-11-07", memberId: "m-ana", dl: false }];
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { SL: figures(900) } })] });
    const out = run({ targets: [T(FRI_SPECIAL)], fixedLeads: fixed, ledger, members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]) });
    expect(lead(out.cells, FRI_SPECIAL)).toEqual(["m-bruno"]);
  });

  it("(d) a Sunday-dated special the Sunday after a `prior` Sunday Lead, and the Sunday before a fixed one", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(900) } })] });
    const after = run({ fixedLeads: [{ date: "2026-11-15", memberId: "m-ana", dl: true }], ledger, members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]) });
    expect(lead(after.cells)).toEqual(["m-bruno"]);
    const before = run({ fixedLeads: [{ date: "2026-11-29", memberId: "m-ana", dl: true }], ledger, members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]) });
    expect(lead(before.cells)).toEqual(["m-bruno"]);
  });

  it("only second-tier candidates: fill outranks protections — least important miss first, with SP-7's notice", () => {
    // Ana misses `cadence` (most important); Bruno misses `no_consecutive` (least) → Bruno. Bruno is «exact»
    // for Sun.Lead, so his fixed Sunday the 29th (same month) does not ALSO make him miss `sunday_cap`.
    const cadence: RunCadence = new Map([["m-ana", [{ month: "2026-11", state: "off", reason: "led_previous_month", wire: "off" }]]]);
    const sources = sourceOf([person("m-ana"), person("m-bruno", { roles: status("Sun.Lead", "exact") })]);
    const out = run({ cadence, sources, fixedLeads: [{ date: "2026-11-29", memberId: "m-bruno", dl: true }], members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]) });
    expect(lead(out.cells)).toEqual(["m-bruno"]);
    expect(out.notices).toContain("Bruno dirige el Vigilia 22 nov aunque dirige el domingo anterior o el siguiente: nadie más podía dirigirlo.");
  });

  it.each([
    ["cadence", { cadence: new Map([["m-ana", [{ month: "2026-11", state: "off" as const, reason: "led_previous_month" as const, wire: "off" as const }]]]) }, "es su mes sin domingo («Mes por medio»)"],
    ["sunday_cap", { fixedLeads: [{ date: "2026-11-01", memberId: "m-ana", dl: true }] }, "ya dirige otro domingo en noviembre"],
  ])("SP-7's motivo for %s", (_name, over, motivo) => {
    const out = run({ ...over, members: [ANA], eligibility: everyoneEligible(["m-ana"]) });
    expect(out.notices).toContain(`Ana dirige el Vigilia 22 nov aunque ${motivo}: nadie más podía dirigirlo.`);
  });

  it("SP-7's motivo for the Saturday cap", () => {
    const out = run({ targets: [T(FRI_SPECIAL)], fixedLeads: [{ date: "2026-11-07", memberId: "m-ana", dl: false }], members: [ANA], eligibility: everyoneEligible(["m-ana"]) });
    expect(out.notices).toContain("Ana dirige el Bautizos 20 nov aunque ya dirige otro sábado en noviembre: nadie más podía dirigirlo.");
  });
});

describe("SP-6 — the notice names the pre-fill whenever it placed anyone", () => {
  it("present after a placement, absent when nothing was placed", () => {
    expect(run().notices[0]).toBe("Los especiales que cuentan para equidad se llenaron primero (Lead y BGV, por saldo) y el solver acomodó los fines de semana alrededor de ellos.");
    expect(run({ members: [], eligibility: new Map() }).notices).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/v3Prefill.test.ts`
Expected: FAIL — `Cannot find module '../v3Prefill'`.

- [ ] **Step 3: Write the module** — Create `app/components/admin/v3Prefill.ts`

```ts
// app/components/admin/v3Prefill.ts
//
// Solver v3 C6 SP-1, SP-2, SP-6, SP-7 — under v3 every PLANNED COUNTED special is filled before the
// request is built, Lead and BGV only (Coro on a special stays manual), append-only, and then reaches
// the solver only as a fixed service (SP-3). Uncounted specials keep today's filler (SP-4, CTL-2).
//
// Hard blocks: everything today's filler blocks — `rankCandidates`' `eligible` verdict (Tipo, a seat
// already held in the same category at that service, availability, person exclusions and pairwise
// conflicts) and the in-cell exclusion — AND RQ-2's eligibility for that role at that service, so
// the pre-fill never pins someone the request calls ineligible.
//
// Order (SP-2, F12): for a LEAD, a candidate whose placement would by itself produce a protection
// miss the solver can only report with cause `pins` — judged against the seats fixed before the
// solve, `prior`, and this pass's earlier placements, over counted services only — is SECOND tier:
//   (a) a DL-mapped Lead for a cadence member whose state that month is `off`;
//   (b) a DL-mapped Lead for someone already holding one that month, unless `Sun.Lead` is exact;
//   (c) an SL-mapped Lead for someone already holding one that month, unless `Sat.Lead` is exact;
//   (d) a DL-mapped Lead on Sunday d for someone holding one on d − 7 or d + 7.
// First tier: those `in` for the seat's role key AND on its line, most owed first by the carried
// balance (each placement here counting as one received seat), then everyone else in today's load
// order. The second tier is used only when the first is empty, least important miss first
// (no_consecutive < saturday_cap < sunday_cap < cadence), and each such placement gets SP-7's notice.
// A cadence member has no DL line and is never ranked by a DL balance. BGV has no protection tiers.

import { civilDayOfWeek } from "@/app/utils/fairnessLedger";
import { ROLE_LINE, type FairnessLedgerResponse, type RoleKey } from "@/app/utils/fairnessVocabulary";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { rankCandidates, type RankMember, type RankedCandidate } from "./candidateRanking";
import { AUTO_FILL_ROW_IDS, withAutoCell } from "./localFill";
import {
  assignedForColumn, cellsToParticipantRoles, hasTarget, seatDefForRow,
  type GridCell, type GridColumn, type GridRow, type SolverConfig,
} from "./plannerModel";
import type { MonthSource } from "./v3MonthSources";
import type { RunCadence } from "./v3People";
import { V3_LINES } from "./v3Copy";
import type { V3Role } from "./v3Wire";

export type Protection = "no_consecutive" | "saturday_cap" | "sunday_cap" | "cadence";
const IMPORTANCE: Record<Protection, number> = { no_consecutive: 0, saturday_cap: 1, sunday_cap: 2, cadence: 3 };

export interface FixedLead { date: string; memberId: string; dl: boolean }
export interface PrefillTarget { columnId: string; date: string; month: string; label: string }

function addDaysIso(iso: string, days: number): string {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days);
  return new Date(t).toISOString().slice(0, 10);
}

function motivo(miss: Protection, month: string): string {
  if (miss === "cadence") return V3_LINES.motivoCadence;
  if (miss === "sunday_cap") return V3_LINES.motivoSundayCap(month);
  if (miss === "saturday_cap") return V3_LINES.motivoSaturdayCap(month);
  return V3_LINES.motivoConsecutive;
}

export function prefillCountedSpecials(input: {
  targets: readonly PrefillTarget[];
  columns: readonly GridColumn[];
  rows: readonly GridRow[];
  cells: readonly GridCell[];
  members: readonly RankMember[];
  savedWindow: readonly ParticipantRole[];
  config: SolverConfig;
  eligibility: ReadonlyMap<string, Record<string, V3Role[]>>;
  sources: ReadonlyMap<string, MonthSource>;
  cadence: RunCadence;
  ledger: FairnessLedgerResponse;
  fixedLeads: readonly FixedLead[];
  nameOf: (id: string) => string;
}): { cells: GridCell[]; placed: number; notices: string[] } {
  let working: GridCell[] = [...input.cells];
  const leads: FixedLead[] = [...input.fixedLeads];
  const received = new Map<string, number>();
  const notices: string[] = [];
  let placed = 0;
  const members = [...input.members];
  const columns = [...input.columns];
  const rows = [...input.rows];

  for (const target of input.targets) {
    const column = columns.find((c) => c.columnId === target.columnId);
    if (!column || column.type !== "special_role") continue;
    const dl = civilDayOfWeek(target.date) === 0;
    const source = input.sources.get(target.month);
    const listed = (id: string) => source?.body.people.find((p) => p.memberId === id);
    for (const row of rows) {
      if (!AUTO_FILL_ROW_IDS.includes(row.id) || !hasTarget(row, column)) continue;
      const role: V3Role = row.id === "lead" ? "Lead" : "BGV";
      const key = `${dl ? "Sun" : "Sat"}.${role}` as RoleKey;
      const line = ROLE_LINE[key];
      const seat = seatDefForRow(row);
      for (;;) {
        const current = working.find((c) => c.columnId === column.columnId && c.rowId === row.id)?.occupants.map((o) => o.memberId) ?? [];
        if (current.length >= (row.target ?? 0)) break;
        const ranked = rankCandidates({
          seat, date: column.date, members,
          windowRoles: [...input.savedWindow, ...cellsToParticipantRoles(working, columns, members)],
          assigned: assignedForColumn(working, rows, column.columnId),
          column, config: input.config,
        });
        const inCell = new Set(current);
        const admitted = ranked.filter((c) =>
          c.eligible && !inCell.has(c.id) && (input.eligibility.get(c.id)?.[column.columnId] ?? []).includes(role));
        if (admitted.length === 0) break;

        const onLine = (id: string) => listed(id)?.roles[key] === "in" && !(line === "DL" && listed(id)?.sundayCadence === "alternate");
        const balance = (id: string) =>
          (input.ledger.people.find((p) => p.memberId === id)?.window[line]?.balance ?? 0) - 100 * (received.get(`${id}|${line}`) ?? 0);
        const firstTierOrder = (xs: RankedCandidate[]) => [
          ...xs.filter((c) => onLine(c.id)).sort((a, b) => balance(b.id) - balance(a.id)),
          ...xs.filter((c) => !onLine(c.id)),
        ];

        let pick: RankedCandidate;
        let miss: Protection | null = null;
        if (role === "Lead") {
          const missesOf = (id: string): Protection[] => {
            const out: Protection[] = [];
            const exact = (k: RoleKey) => listed(id)?.roles[k] === "exact";
            const sameMonth = (l: FixedLead) => l.memberId === id && l.date.slice(0, 7) === target.month;
            if (dl && input.cadence.get(id)?.find((e) => e.month === target.month)?.wire === "off") out.push("cadence");
            if (dl && !exact("Sun.Lead") && leads.some((l) => l.dl && sameMonth(l))) out.push("sunday_cap");
            if (!dl && !exact("Sat.Lead") && leads.some((l) => !l.dl && sameMonth(l))) out.push("saturday_cap");
            const near = [addDaysIso(target.date, -7), addDaysIso(target.date, 7)];
            if (dl && leads.some((l) => l.dl && l.memberId === id && near.includes(l.date))) out.push("no_consecutive");
            return out;
          };
          const misses = new Map(admitted.map((c) => [c.id, missesOf(c.id)]));
          const worst = (c: RankedCandidate) => Math.max(-1, ...misses.get(c.id)!.map((m) => IMPORTANCE[m]));
          const first = admitted.filter((c) => misses.get(c.id)!.length === 0);
          if (first.length > 0) {
            pick = firstTierOrder(first)[0];
          } else {
            pick = firstTierOrder(admitted).sort((a, b) => worst(a) - worst(b))[0];
            miss = misses.get(pick.id)!.reduce((top, m) => (IMPORTANCE[m] > IMPORTANCE[top] ? m : top));
          }
        } else {
          pick = firstTierOrder(admitted)[0];
        }

        working = withAutoCell(working, column.columnId, row.id, [...current, pick.id]);
        received.set(`${pick.id}|${line}`, (received.get(`${pick.id}|${line}`) ?? 0) + 1);
        if (role === "Lead") leads.push({ date: target.date, memberId: pick.id, dl });
        placed += 1;
        if (miss) notices.push(V3_LINES.secondTier(input.nameOf(pick.id), target.label, motivo(miss, target.month)));
      }
    }
  }
  if (placed > 0) notices.unshift(V3_LINES.prefillDone);
  return { cells: working, placed, notices };
}
```

- [ ] **Step 4: Run it, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3Prefill.test.ts app/components/admin/__tests__/localFill.test.ts`
Expected: PASS (today's `localFill` suite unchanged — SP-4).
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(planner): fill counted specials before the v3 solve — protections first, then balance

A counted special reaches the v3 solver only as fixed seats, so the planner fills it first: today's
hard blocks plus the request's own eligibility, never someone the solver would set aside. Because
the solver cannot move a pinned special seat, a Lead placement that would by itself break «Mes por
medio», the one-Sunday or one-Saturday cap or the no-consecutive-Sundays protection is used only
when nobody else can lead, and is named. Otherwise the line's most-owed member leads first."
```

---

## Task 11: `buildV3SolveRequest` — the ONE pure builder (RQ-1–RQ-10 composed, pins, limits, notices order, snapshot, KH-1) — [standard]

**Files:**
- Create: `app/components/admin/v3SolveRequest.ts`
- Create (tests): `app/components/admin/__tests__/v3SolveRequest.test.ts`, `app/components/admin/__tests__/v3KeyHygiene.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: Tasks 3–10 (`horizonRefusal`, `V3_LINES`, `V3_PIN_CAP`, `monthsList`, `resolveMonthSources`, `serviceEligibility`, `dayClass`, `buildV3Services`, `buildV3Prior`, `computeRunCadence`, `flagDisagreementLines`, `buildV3People`, `carriedPresenceKeys`, `collectV3Rules`, `mintInputOf`, `emitV3Rules`, `ruleReferences`, `mintRuleIds`, `capCardLabel`, `prefillCountedSpecials`); C3 `cadenceMembers`, `cadenceOutsideSundayPool`, `resolveRulePersonId`, `CADENCE_OUTSIDE_SENTENCE`; `droppedPinNotices`, `seatLabel`, `DroppedPin`, `PinSeat` (`pinModel.ts`, read-only use); `rolesOfPatternV3`.
- Produces:
  - `V3_LIMITS = { services: 40, people: 100, rules: 500 }` (C5 §5.1)
  - `interface V3Member { _id: string; member_name: string; alias?: string; memberType?: string[]; instruments?: string[]; unavailableDates?: string[]; ministries?: unknown }`
  - `preReadRefusals(input: { months: readonly string[]; currentMonth: string; config: SolverConfig; members: readonly V3Member[] }): string[]` — HZ-7, HZ-9, WN-2 (incl. A11), in that order, before any read
  - `limitRefusals(counts: { services: number; people: number; rules: number }): string[]`
  - `interface V3BuildInput { months: string[]; currentMonth: string; ledger: FairnessLedgerResponse; config: SolverConfig; members: readonly V3Member[]; storedRoles: readonly V3StoredRole[]; planned: { columns: readonly GridColumn[]; cells: readonly GridCell[]; rows: readonly GridRow[] }; savedWindow: readonly ParticipantRole[]; fillEmpty: boolean; seed: number; requestId: string }` — `planned.columns` are the planned columns that WILL exist (not skipped, creatable, no stored target)
  - `interface V3Snapshot { requestId: string; months: string[]; sources: MonthSource[]; ruleTable: RuleRefEntry[] }`
  - `type V3BuildResult = { ok: true; request: V3SolveRequest; cells: GridCell[]; notices: string[]; snapshot: V3Snapshot; ruleLabels: ReadonlyMap<string, string>; serviceLabels: ReadonlyMap<string, string>; cadence: RunCadence; boardPinnedCellKeys: ReadonlySet<string>; storedServiceIds: ReadonlySet<string> } | { ok: false; lines: string[] }`
  - `buildV3SolveRequest(input: V3BuildInput): V3BuildResult` — pure and neutral: no React, no `fetch`, no clock (C7's rehearsal and the unit tests exercise this same function).

- [ ] **Step 1: Write the failing builder test** — `app/components/admin/__tests__/v3SolveRequest.test.ts`

```ts
// Solver v3 C6 RQ-1–RQ-10 composed: the request carries exactly C5's fields, one eligibility source
// per month shared with the record body, every pin (stored, special, board) under the v3 cap, the C5
// limits pre-flighted, C6's notices in a stable order — and never a v2 field or helper.
import { afterEach, describe, expect, it, vi } from "vitest";

const v2 = vi.hoisted(() => ({ buildSolveRequest: vi.fn(), omittedCapsNotices: vi.fn(), trailingNotice: vi.fn() }));
vi.mock("../plannerModel", async (importOriginal) => {
  const real = await importOriginal<typeof import("../plannerModel")>();
  v2.buildSolveRequest.mockImplementation(real.buildSolveRequest);
  v2.omittedCapsNotices.mockImplementation(real.omittedCapsNotices);
  v2.trailingNotice.mockImplementation(real.trailingNotice);
  return {
    ...real,
    buildSolveRequest: (...a: Parameters<typeof real.buildSolveRequest>) => v2.buildSolveRequest(...a),
    omittedCapsNotices: (...a: Parameters<typeof real.omittedCapsNotices>) => v2.omittedCapsNotices(...a),
    trailingNotice: (...a: Parameters<typeof real.trailingNotice>) => v2.trailingNotice(...a),
  };
});

import { V3_LIMITS, buildV3SolveRequest, limitRefusals, preReadRefusals, type V3BuildInput } from "../v3SolveRequest";
import { buildColumns, buildRows, type GridCell } from "../plannerModel";
import type { V3StoredRole } from "../v3Services";
import { ALL_IN, ANA, BRUNO, CARLA, DANI, MEMBERS, cap, config, ledgerResponse, record, restriction } from "./v3Fixtures";

afterEach(() => vi.clearAllMocks());

const NOV = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"];
const POOLS = config({ sundayLeads: ["m-ana", "m-bruno"], saturdayLeads: ["m-carla"], support: ["m-dani"] });
const base = (over: Partial<V3BuildInput> = {}): V3BuildInput => ({
  months: ["2026-11"], currentMonth: "2026-10",
  ledger: ledgerResponse(["2026-11"]),
  config: POOLS, members: MEMBERS, storedRoles: [],
  planned: { columns: buildColumns({ sundayDates: NOV, activeSatDates: [] }), cells: [], rows: buildRows() },
  savedWindow: [], fillEmpty: false, seed: 42, requestId: "req-test",
  ...over,
});
const ok = (input: V3BuildInput) => {
  const out = buildV3SolveRequest(input);
  if (!out.ok) throw new Error(out.lines.join("\n"));
  return out;
};

describe("RQ-8 / RQ-9 — the envelope, and v2 never reached", () => {
  it("carries contract 3, seed, request_id, months, and nothing of v2 (no budget either)", () => {
    const { request } = ok(base());
    expect(Object.keys(request).sort()).toEqual(["contract", "months", "people", "pins", "prior", "request_id", "rules", "seed", "services"]);
    expect(request).toMatchObject({ contract: 3, seed: 42, request_id: "req-test", months: ["2026-11"] });
    for (const v2Field of ["weeks", "dsl_rules", "history", "weekends_with_saturday", "budget"]) expect(request).not.toHaveProperty(v2Field);
  });

  it("never calls v2's builder, omitted-cap notices or trailing notice", () => {
    ok(base());
    expect(v2.buildSolveRequest).not.toHaveBeenCalled();
    expect(v2.omittedCapsNotices).not.toHaveBeenCalled();
    expect(v2.trailingNotice).not.toHaveBeenCalled();
  });
});

describe("RQ-2 — one value feeds the request and the record body", () => {
  it("eligibility follows the snapshot's source, which is frozen", () => {
    const out = ok(base());
    const source = out.snapshot.sources[0];
    const dani = out.request.people.find((p) => p.id === "m-dani")!;
    expect(source.body.people.find((p) => p.memberId === "m-dani")!.roles["Sun.Lead"]).toBe("out");
    expect(Object.values(dani.eligibility).every((roles) => !roles.includes("Lead"))).toBe(true);
    expect(() => { (source.body.people as unknown[]).length = 0; }).toThrow();
  });

  it("a bound month ignores an on-screen pool change", () => {
    const rec = record("2026-11", [{ memberId: "m-dani", name: "Dani", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }]);
    const ledger = ledgerResponse(["2026-11"], { horizon: [{ record: rec, storedServices: 1, recordBinds: true }] });
    const out = ok(base({ ledger }));
    const dani = out.request.people.find((p) => p.id === "m-dani")!;
    expect(Object.values(dani.eligibility).some((roles) => roles.includes("Lead"))).toBe(true);
    expect(out.request.people.some((p) => p.id === "m-ana")).toBe(false);
  });
});

describe("RQ-6 — pins", () => {
  const stored = (id: string, date: string, leads: string[]): V3StoredRole =>
    ({ _id: id, _type: "special_role", date, countsForFairness: true, leads: leads.map((x) => ({ _id: x })), bgvs: [], chorus: [] });

  it("«Solo llenar vacíos» pins the planned columns' occupied voice seats, one per person per service, with today's duplicate wording", () => {
    const col = "create:sunday_role__2026-11-08";
    const cells: GridCell[] = [
      { columnId: col, rowId: "lead", occupants: [{ memberId: "m-ana" }], origin: "manual" },
      { columnId: col, rowId: "bgv", occupants: [{ memberId: "m-ana" }, { memberId: "m-dani" }], origin: "manual" },
    ];
    const out = ok(base({ fillEmpty: true, planned: { columns: buildColumns({ sundayDates: NOV, activeSatDates: [] }), cells, rows: buildRows() } }));
    expect(out.request.pins).toEqual([
      { service: col, date: "2026-11-08", role: "Lead", person: "m-ana" },
      { service: col, date: "2026-11-08", role: "BGV", person: "m-dani" },
    ]);
    expect(out.notices.some((n) => n.startsWith("Ana estaba en dos lugares del domingo 8 nov; se fijó solo en"))).toBe(true);
    expect(out.boardPinnedCellKeys).toEqual(new Set([`${col}|lead`, `${col}|bgv`]));
  });

  it("without «Solo llenar vacíos» the board's seats are not pins", () => {
    const col = "create:sunday_role__2026-11-08";
    const cells: GridCell[] = [{ columnId: col, rowId: "lead", occupants: [{ memberId: "m-ana" }], origin: "manual" }];
    expect(ok(base({ planned: { columns: buildColumns({ sundayDates: NOV, activeSatDates: [] }), cells, rows: buildRows() } })).request.pins).toEqual([]);
  });

  it("a board seat held by someone no longer a member refuses with today's line", () => {
    const col = "create:sunday_role__2026-11-08";
    const cells: GridCell[] = [{ columnId: col, rowId: "lead", occupants: [{ memberId: "m-gone" }], origin: "manual" }];
    const out = buildV3SolveRequest(base({ fillEmpty: true, planned: { columns: buildColumns({ sundayDates: NOV, activeSatDates: [] }), cells, rows: buildRows() } }));
    expect(out).toEqual({ ok: false, lines: ["No se puede usar «Solo llenar vacíos»: en Lead del domingo 8 nov hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo."] });
  });

  it("refuses above the v3 pin cap before any fetch", () => {
    // 64 stored counted specials × 4 people each = 256 pins (the pin cap is checked before C5's limits).
    const specials = Array.from({ length: 64 }, (_, i) =>
      stored(`sp-${i}`, i < 56 ? `2026-11-${String((i % 28) + 1).padStart(2, "0")}` : `2026-12-0${(i % 8) + 1}`, [ANA, BRUNO, CARLA, DANI].map((m) => m._id)));
    const out = buildV3SolveRequest(base({ months: ["2026-11", "2026-12"], ledger: ledgerResponse(["2026-11", "2026-12"]), storedRoles: specials, planned: { columns: [], cells: [], rows: buildRows() } }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.lines[0]).toBe("El plan tiene 256 lugares fijados (guardados, especiales y del tablero) y el solver acepta hasta 250. Planea 1 mes o apaga «Solo llenar vacíos».");
  });
});

describe("RQ-10 — C5's limits are pre-flighted", () => {
  it("one line per limit crossed", () => {
    expect(V3_LIMITS).toEqual({ services: 40, people: 100, rules: 500 });
    expect(limitRefusals({ services: 41, people: 100, rules: 500 })).toEqual(["El plan es demasiado grande para el solver (servicios: 41 de 40). Planea 1 mes."]);
    expect(limitRefusals({ services: 40, people: 101, rules: 500 })).toEqual(["El plan es demasiado grande para el solver (personas: 101 de 100). Planea 1 mes."]);
    expect(limitRefusals({ services: 40, people: 100, rules: 501 })).toEqual(["El plan es demasiado grande para el solver (reglas: 501 de 500). Planea 1 mes."]);
  });

  it("the builder applies the services limit", () => {
    const fortyOne = Array.from({ length: 41 }, (_, i) => ({ _id: `sp-${i}`, _type: "special_role", date: `2026-${i < 30 ? "11" : "12"}-${String((i % 30) + 1).padStart(2, "0")}`, countsForFairness: true, leads: [], bgvs: [], chorus: [] }));
    const out = buildV3SolveRequest(base({ months: ["2026-11", "2026-12"], ledger: ledgerResponse(["2026-11", "2026-12"]), storedRoles: fortyOne, planned: { columns: [], cells: [], rows: buildRows() } }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.lines).toContain("El plan es demasiado grande para el solver (servicios: 41 de 40). Planea 1 mes.");
  });
});

describe("preReadRefusals — HZ-7, HZ-9, WN-2, before any read", () => {
  it("a past month, then the ceiling", () => {
    expect(preReadRefusals({ months: ["2026-09"], currentMonth: "2026-10", config: POOLS, members: MEMBERS })).toEqual(["Auto no planea meses que ya pasaron. Crea esos servicios a mano."]);
    expect(preReadRefusals({ months: ["2027-10", "2027-11"], currentMonth: "2026-10", config: POOLS, members: MEMBERS }))
      .toEqual(["Auto no planea más de 12 meses adelante: Noviembre queda fuera. Elige un mes hasta octubre."]);
  });

  it("a «Mes por medio» name that matches nobody, or two people", () => {
    const cfg = config({ restrictions: [restriction("r1", "Nadie", { sundayCadence: "alternate" })] });
    expect(preReadRefusals({ months: ["2026-11"], currentMonth: "2026-10", config: cfg, members: MEMBERS }))
      .toEqual(["No se puede correr Auto: «Mes por medio» de «Nadie» no corresponde a una sola persona (no coincide con nadie). Corrige el nombre en la regla."]);
  });

  it("cadence plus an exact Sun.Lead count (A11)", () => {
    const cfg = config({ restrictions: [restriction("r1", "Ana", { sundayCadence: "alternate", caps: [cap("c", "Sun.Lead", "==", 2)] })] });
    expect(preReadRefusals({ months: ["2026-11"], currentMonth: "2026-10", config: cfg, members: MEMBERS }))
      .toEqual(["No se puede correr Auto: Ana tiene «Mes por medio» y además un número fijo de Dom Lead («Ana · Sun.Lead == 2»). Quita una de las dos."]);
  });

  it("a super-admin roster with a kids-only namesake of a «Mes por medio» person refuses nothing (C3 E25)", () => {
    const kidsAna = { _id: "m-ana-kids", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz"], ministries: ["kids"] };
    const cfg = config({ restrictions: [restriction("r1", "Ana", { sundayCadence: "alternate" })] });
    expect(preReadRefusals({ months: ["2026-11"], currentMonth: "2026-10", config: cfg, members: [...MEMBERS, kidsAna] })).toEqual([]);
  });
});

describe("services, specials and the order of C6's notices (RQ-3, SP-5, NT-3)", () => {
  it("only the planned columns passed in are sent — a skipped or blocked column is the caller's to leave out", () => {
    const columns = buildColumns({ sundayDates: NOV.slice(0, 2), activeSatDates: [] });
    expect(ok(base({ planned: { columns, cells: [], rows: buildRows() } })).request.services.map((s) => s.date)).toEqual(NOV.slice(0, 2));
  });

  it("a counted special is pre-filled and sent fixed with its seats pinned; the pre-fill notice precedes nothing of the solver's", () => {
    const columns = buildColumns({ sundayDates: [], activeSatDates: [], specials: [{ date: "2026-11-22", name: "Vigilia", countsForFairness: true }] });
    const out = ok(base({ planned: { columns, cells: [], rows: buildRows() } }));
    const special = out.request.services.find((s) => s.kind === "special")!;
    expect(special.fixed).toBe(true);
    expect(out.request.pins.filter((p) => p.service === special.id).length).toBeGreaterThan(0);
    expect(out.notices).toContain("Los especiales que cuentan para equidad se llenaron primero (Lead y BGV, por saldo) y el solver acomodó los fines de semana alrededor de ellos.");
  });

  it("SP-5: a refusal adds the specials line when counted specials were waiting", () => {
    const columns = buildColumns({ sundayDates: [], activeSatDates: [], specials: [{ date: "2026-11-22", name: "Vigilia", countsForFairness: true }] });
    const cfg = config({ ...POOLS, restrictions: [restriction("r", "Ana", { caps: [cap("c", "Sun.Lead", "<=", 1.5)] })] });
    const out = buildV3SolveRequest(base({ config: cfg, planned: { columns, cells: [], rows: buildRows() } }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.lines[out.lines.length - 1]).toBe("Los especiales que cuentan para equidad no se llenaron porque Auto no corrió.");
  });

  it("NT-3: WN-3, then the stored-service notices, then the rule notices, then the pre-fill's, in that order", () => {
    const columns = buildColumns({ sundayDates: [], activeSatDates: [], specials: [{ date: "2026-11-22", name: "Vigilia", countsForFairness: true }] });
    const cfg = config({ ...POOLS, restrictions: [restriction("r", "Ana", { caps: [cap("c", "Sun.BGV", "<=", 0, { relative: true, relOffset: 6 })] })] });
    const storedRoles: V3StoredRole[] = [{ _id: "sun-1", _type: "sunday_role", date: "2026-11-01", leads: [{ _id: "m-ana" }], bgvs: [], chorus: [] }];
    const out = ok(base({ config: cfg, storedRoles, planned: { columns, cells: [], rows: buildRows() } }));
    const idx = (prefix: string) => out.notices.findIndex((n) => n.startsWith(prefix));
    expect(idx("Con el nuevo solver, «Líderes Sábado»")).toBeLessThan(idx("Los servicios guardados no se tocan"));
    expect(idx("Los servicios guardados no se tocan")).toBeLessThan(idx("Ana · Sun.BGV <= sem−6 queda en 0"));
    expect(idx("Ana · Sun.BGV <= sem−6 queda en 0")).toBeLessThan(idx("Los especiales que cuentan para equidad se llenaron"));
  });
});
```

- [ ] **Step 2: Write the failing key-hygiene test** — `app/components/admin/__tests__/v3KeyHygiene.test.ts`

```ts
// Solver v3 C6 KH-1, KH-3, RQ-5 — the name-shaped fixture (production's seed SHAPE, fictitious
// names) through the builder: the serialized request, every notice and refusal line, every console
// call and KH-3's table carry no config key or ruleKey; ids are byte-identical across two runs;
// KH-3's ordinals follow the config, and shift when an earlier restriction is deleted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildV3SolveRequest, type V3BuildInput } from "../v3SolveRequest";
import { renderRuleRefTable } from "../v3RuleIds";
import { buildColumns, buildRows } from "../plannerModel";
import { ALL_IN, MEMBERS, NAME_SHAPED, NAME_SHAPED_KEYS, cap, figures, ledgerPerson, ledgerResponse, record } from "./v3Fixtures";

// Sorts after "d-carla-dani" in codepoint order, so the card's rule mints r1 and this carried-only key r2.
const CARRIED_ONLY = "d-dani-old";
const SECRETS = [...NAME_SHAPED_KEYS, CARRIED_ONLY];
let consoleCalls: string[];
beforeEach(() => {
  consoleCalls = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { consoleCalls.push(a.map(String).join(" ")); });
  }
});
afterEach(() => vi.restoreAllMocks());

const presenceRecord = record("2026-11", [
  { memberId: "m-carla", name: "Carla", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] },
  { memberId: "m-dani", name: "Dani", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] },
  { memberId: "m-ana", name: "Ana", roles: { ...ALL_IN, "Sun.Lead": "exact" }, exactRules: [{ roles: ["Sun.Lead"], count: 1 }], exempt: false, blocks: [] },
], { presence: [{ ruleKey: "d-carla-dani", roles: ["Sun.BGV"], members: ["m-carla", "m-dani"], exclusive: false }] });

const input = (config = NAME_SHAPED): V3BuildInput => ({
  months: ["2026-11"], currentMonth: "2026-10",
  ledger: ledgerResponse(["2026-11"], {
    horizon: [{ record: presenceRecord, storedServices: 1, recordBinds: true }],
    people: [ledgerPerson("m-carla", "Carla", { window: { "P:d-carla-dani": figures(40), [`P:${CARRIED_ONLY}`]: figures(-10) } })],
  }),
  config, members: MEMBERS, storedRoles: [],
  planned: { columns: buildColumns({ sundayDates: ["2026-11-01", "2026-11-08"], activeSatDates: [] }), cells: [], rows: buildRows() },
  savedWindow: [], fillEmpty: false, seed: 9, requestId: "req-kh",
});

describe("key hygiene over a name-shaped config", () => {
  it("no config key or ruleKey in the request, the notices, the console or KH-3's table", () => {
    const out = buildV3SolveRequest(input());
    if (!out.ok) throw new Error(out.lines.join("\n"));
    const surfaces = [JSON.stringify(out.request), ...out.notices, ...consoleCalls, renderRuleRefTable(out.snapshot.requestId, out.snapshot.ruleTable)];
    for (const text of surfaces) for (const key of SECRETS) expect(text).not.toContain(key);
    expect(out.request.people.find((p) => p.id === "m-carla")!.carried).toEqual({ "P:r1": 40, "P:r2": -10 });
  });

  it("a refusal line names rules by their card label, never their key", () => {
    const broken = { ...NAME_SHAPED, restrictions: [{ ...NAME_SHAPED.restrictions[0], caps: [cap("d-ana-sun-lead", "Sun.Lead", "<=", 1.5)] }, NAME_SHAPED.restrictions[1]] };
    const out = buildV3SolveRequest(input(broken));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      for (const line of out.lines) for (const key of SECRETS) expect(line).not.toContain(key);
      expect(out.lines[0]).toContain("«Ana · Sun.Lead <= 1.5»");
    }
  });

  it("the same config gives a byte-identical request and table on two runs", () => {
    const a = buildV3SolveRequest(input());
    const b = buildV3SolveRequest(input());
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(JSON.stringify(a.request)).toBe(JSON.stringify(b.request));
    expect(a.snapshot.ruleTable).toEqual(b.snapshot.ruleTable);
  });

  it("KH-3: one entry per sent id and per rewritten P: key, each with its config ordinal", () => {
    const out = buildV3SolveRequest(input());
    if (!out.ok) throw new Error("expected ok");
    const byOrdinal = new Map(out.snapshot.ruleTable.map((e) => [e.ordinal, e]));
    expect(byOrdinal.get("restrictions[1].caps[2]")?.kind).toBe("count");
    expect(byOrdinal.get("conflicts[0]")?.kind).toBe("pair");
    expect(out.snapshot.ruleTable.filter((e) => e.ordinal === "presence[0]").map((e) => e.wire).sort()).toEqual(["P:r1", "r1"]);
    expect(out.snapshot.ruleTable.some((e) => e.wire === "P:r2" && e.ordinal.startsWith("sin tarjeta"))).toBe(true);
    expect(out.snapshot.ruleTable.some((e) => e.ordinal === "sin tarjeta, 2026-11 m-ana Sun.Lead")).toBe(true);
    const sent = new Set(out.request.rules.map((r) => r.id));
    for (const id of sent) expect(out.snapshot.ruleTable.some((e) => e.wire === id)).toBe(true);
  });

  it("deleting an earlier restriction shifts the next run's ordinals", () => {
    const shifted = { ...NAME_SHAPED, restrictions: [NAME_SHAPED.restrictions[1]] };
    const out = buildV3SolveRequest(input(shifted));
    if (!out.ok) throw new Error("expected ok");
    expect(out.snapshot.ruleTable.some((e) => e.ordinal === "restrictions[0].caps[2]")).toBe(true);
    expect(out.snapshot.ruleTable.some((e) => e.ordinal === "restrictions[1].caps[2]")).toBe(false);
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npx vitest run app/components/admin/__tests__/v3SolveRequest.test.ts app/components/admin/__tests__/v3KeyHygiene.test.ts`
Expected: FAIL — `Cannot find module '../v3SolveRequest'`.

- [ ] **Step 4: Write the builder** — Create `app/components/admin/v3SolveRequest.ts`

```ts
// app/components/admin/v3SolveRequest.ts
//
// Solver v3 C6 — `buildV3SolveRequest`, the ONE pure builder of the `contract: 3` request (spec §6
// «Provided by C6»). Planner state, the fresh ledger GET, the roles read and the clock (as
// `currentMonth`) in; the request, C6's own notices and refusals, and the run's snapshot out. No React,
// no `fetch`, no clock: its unit tests and C7's Preview rehearsal exercise this same code.
//
// Order (each stage refuses with Spanish lines and stops):
//   1. preReadRefusals — HZ-7, HZ-9, WN-2 (incl. A11); Auto runs these before any read too.
//   2. month sources (RQ-2) — record or IF2-15 body; resolver refusals (§7.9).
//   3. rules (RQ-5) — names exactly once, IF2-17 refusals.
//   4. services (RQ-3, ST-4–ST-7), eligibility (RQ-2), cadence once (RQ-4), the horizon-wide flag check.
//   5. counted-specials pre-fill (SP-1, SP-2) — reads the cadence states.
//   6. pins (RQ-6): stored, counted specials, the board under «Solo llenar vacíos»; the v3 cap.
//   7. people (RQ-4), minted rule ids (RQ-5), C5's limits (RQ-10).
// A refusal while counted specials were waiting adds SP-5's line: nothing of the pre-fill is applied.
// Never called on the v3 path: v2's builder, its omissions, `omittedCapsNotices`, `trailingNotice`.

import {
  CADENCE_OUTSIDE_SENTENCE, cadenceMembers, cadenceOutsideSundayPool, resolveRulePersonId,
} from "@/app/utils/sundayCadence";
import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { droppedPinNotices, seatLabel, type DroppedPin, type PinSeat } from "./pinModel";
import { rolesOfPatternV3, type GridCell, type GridColumn, type GridRow, type SolverConfig } from "./plannerModel";
import { horizonRefusal, monthOfDate } from "./v3Horizon";
import { V3_LINES, V3_PIN_CAP, monthsList } from "./v3Copy";
import { dayClass, resolveMonthSources, serviceEligibility, type MonthSource } from "./v3MonthSources";
import { buildV3Prior, buildV3Services, type PlannedColumn, type V3StoredRole } from "./v3Services";
import { buildV3People, carriedPresenceKeys, computeRunCadence, flagDisagreementLines, type RunCadence } from "./v3People";
import { collectV3Rules, emitV3Rules, mintInputOf, ruleReferences } from "./v3Rules";
import { capCardLabel, mintRuleIds, type RuleRefEntry } from "./v3RuleIds";
import { prefillCountedSpecials, type FixedLead } from "./v3Prefill";
import type { V3Pin, V3Role, V3Service, V3SolveRequest } from "./v3Wire";

/** C5 §5.1 — services 1–40, people 1–100 (shared with C2 WR-4), rules 0–500. */
export const V3_LIMITS = { services: 40, people: 100, rules: 500 } as const;

export interface V3Member {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  instruments?: string[];
  unavailableDates?: string[];
  ministries?: unknown;
}

export interface V3BuildInput {
  months: string[];
  currentMonth: string;
  ledger: FairnessLedgerResponse;
  config: SolverConfig;
  members: readonly V3Member[];
  storedRoles: readonly V3StoredRole[];
  planned: { columns: readonly GridColumn[]; cells: readonly GridCell[]; rows: readonly GridRow[] };
  savedWindow: readonly ParticipantRole[];
  fillEmpty: boolean;
  seed: number;
  requestId: string;
}

export interface V3Snapshot {
  requestId: string;
  months: string[];
  /** Each horizon month's source and state as of this run's ledger read — what CF-2 freezes. */
  sources: MonthSource[];
  /** KH-3 — wire id → kind and config ordinal, name-free. */
  ruleTable: RuleRefEntry[];
}

export type V3BuildResult =
  | {
      ok: true;
      request: V3SolveRequest;
      /** The board after the counted-specials pre-fill (only planned special cells change). */
      cells: GridCell[];
      notices: string[];
      snapshot: V3Snapshot;
      ruleLabels: ReadonlyMap<string, string>;
      serviceLabels: ReadonlyMap<string, string>;
      cadence: RunCadence;
      /** `${columnId}|${rowId}` of the planned weekend cells pinned under «Solo llenar vacíos». */
      boardPinnedCellKeys: ReadonlySet<string>;
      storedServiceIds: ReadonlySet<string>;
    }
  | { ok: false; lines: string[] };

const displayName = (m: V3Member) => m.alias?.trim() || m.member_name;
const VOICE_ROWS: ReadonlyArray<{ rowId: string; role: V3Role }> = [
  { rowId: "lead", role: "Lead" }, { rowId: "bgv", role: "BGV" }, { rowId: "coro", role: "Choir" },
];

/** HZ-7, HZ-9 and WN-2 — Auto refuses on any of these before any read. */
export function preReadRefusals(input: {
  months: readonly string[];
  currentMonth: string;
  config: SolverConfig;
  members: readonly V3Member[];
}): string[] {
  const horizon = horizonRefusal(input.months, input.currentMonth);
  if (horizon) return [horizon.kind === "past" ? V3_LINES.horizonPast : V3_LINES.horizonCeiling(horizon.month, horizon.limit)];
  const roster = [...input.members];
  const { ids, refusals } = cadenceMembers(input.config, roster);
  const lines = refusals.map((r) =>
    V3_LINES.cadenceName(r.person, r.reason === "unresolved" ? V3_LINES.cadenceNameNone : V3_LINES.cadenceNameMany(r.matches.length)));
  input.config.restrictions.forEach((r, ri) => {
    r.caps.forEach((c, ci) => {
      if (c.op !== "==" || !rolesOfPatternV3(c.pattern).includes("Sun.Lead")) return;
      const who = resolveRulePersonId(r.person, roster);
      if (!who.ok || !ids.includes(who.id)) return;
      const member = roster.find((m) => m._id === who.id)!;
      lines.push(V3_LINES.cadenceAndExact(displayName(member), capCardLabel(input.config, ri, ci)));
    });
  });
  return lines;
}

export function limitRefusals(counts: { services: number; people: number; rules: number }): string[] {
  const out: string[] = [];
  if (counts.services > V3_LIMITS.services) out.push(V3_LINES.tooLarge("servicios", counts.services, V3_LIMITS.services));
  if (counts.people > V3_LIMITS.people) out.push(V3_LINES.tooLarge("personas", counts.people, V3_LIMITS.people));
  if (counts.rules > V3_LIMITS.rules) out.push(V3_LINES.tooLarge("reglas", counts.rules, V3_LIMITS.rules));
  return out;
}

/** The voice occupants of one planned column as pins: one per person (Lead > BGV > Choir); duplicates reported. */
function pinsOfColumn(
  column: GridColumn, service: V3Service, cells: readonly GridCell[], memberIds: ReadonlySet<string>, nameOf: (id: string) => string,
): { pins: V3Pin[]; dropped: DroppedPin[]; nonMember: PinSeat | null; keys: string[] } {
  const pins: V3Pin[] = [];
  const dropped: DroppedPin[] = [];
  const keys: string[] = [];
  const seen = new Map<string, PinSeat>();
  for (const { rowId, role } of VOICE_ROWS) {
    if (role === "Choir" && service.kind === "saturday" && !service.fixed) continue;
    const cell = cells.find((c) => c.columnId === column.columnId && c.rowId === rowId);
    const occurrences = new Map<string, number>();
    for (const o of cell?.occupants ?? []) {
      const occurrence = occurrences.get(o.memberId) ?? 0;
      occurrences.set(o.memberId, occurrence + 1);
      const seat: PinSeat = { columnId: column.columnId, rowId, memberId: o.memberId, occurrence };
      if (!memberIds.has(o.memberId)) return { pins, dropped, nonMember: seat, keys };
      const kept = seen.get(o.memberId);
      if (kept) {
        dropped.push({ ...seat, person: nameOf(o.memberId), kept });
        continue;
      }
      seen.set(o.memberId, seat);
      pins.push({ service: service.id, date: service.date, role, person: o.memberId });
      if (!keys.includes(`${column.columnId}|${rowId}`)) keys.push(`${column.columnId}|${rowId}`);
    }
  }
  return { pins, dropped, nonMember: null, keys };
}

export function buildV3SolveRequest(input: V3BuildInput): V3BuildResult {
  const { months, config, ledger } = input;
  const members = [...input.members];
  const memberIds = new Set(members.map((m) => m._id));
  const nameOf = (id: string) => {
    const m = members.find((x) => x._id === id);
    return m ? displayName(m) : (ledger.people.find((p) => p.memberId === id)?.name || "alguien que ya no está en la lista");
  };
  const plannedColumns = input.planned.columns.filter((c) => months.includes(monthOfDate(c.date)));
  const specialsWaiting = plannedColumns.some((c) => c.type === "special_role" && c.countsForFairness);
  const refuse = (lines: string[]): V3BuildResult =>
    ({ ok: false, lines: specialsWaiting ? [...lines, V3_LINES.prefillNotRun] : lines });

  // 1. Before any read (Auto has already run these; repeated here so the builder stands alone).
  const pre = preReadRefusals({ months, currentMonth: input.currentMonth, config, members });
  if (pre.length > 0) return refuse(pre);

  // 2. One source per month (RQ-2).
  const exactLeadLabel = (person: string): string | null => {
    for (let ri = 0; ri < config.restrictions.length; ri++) {
      const r = config.restrictions[ri];
      if (r.person !== person) continue;
      const ci = r.caps.findIndex((c) => c.op === "==" && rolesOfPatternV3(c.pattern).includes("Sun.Lead"));
      if (ci !== -1) return capCardLabel(config, ri, ci);
    }
    return null;
  };
  const sourcesOut = resolveMonthSources({ months, ledger, config, members, exactLeadLabel });
  if (!sourcesOut.ok) return refuse(sourcesOut.lines);
  const sources = sourcesOut.sources;
  const sourceByMonth = new Map(sources.map((s) => [s.month, s]));

  // 3. Rules (RQ-5), before anything else is built from them.
  const collected = collectV3Rules({ months, sources, config, members });
  if (!collected.ok) return refuse(collected.lines);

  // 4. Services, eligibility, cadence, the horizon-wide flag check.
  const planned: PlannedColumn[] = plannedColumns.map((c) => ({
    columnId: c.columnId, date: c.date, type: c.type, serviceName: c.serviceName, time: c.time, countsForFairness: c.countsForFairness,
  }));
  const target = (rowId: string) => input.planned.rows.find((r) => r.id === rowId)?.target ?? 0;
  const built = buildV3Services({
    months, stored: input.storedRoles, planned, seats: { Lead: target("lead"), BGV: target("bgv"), Choir: target("coro") }, memberIds, nameOf,
  });
  const serviceById = new Map(built.services.map((s) => [s.id, s]));
  const liveUnavailable = new Map(members.map((m) => [m._id, m.unavailableDates ?? []]));
  const listedIds = new Set(sources.flatMap((s) => s.body.people.map((p) => p.memberId)));
  const eligibility = new Map<string, Record<string, V3Role[]>>();
  for (const id of listedIds) {
    const byService: Record<string, V3Role[]> = {};
    for (const svc of built.services) {
      const roles = serviceEligibility(sourceByMonth.get(svc.month)!, id, svc, liveUnavailable.get(id) ?? []);
      if (roles.length > 0) byService[svc.id] = roles;
    }
    eligibility.set(id, byService);
  }
  const prior = buildV3Prior(months[0], input.storedRoles);
  const disagreements = flagDisagreementLines({ sources, ids: listedIds, nameOf });
  if (disagreements.length > 0) return refuse(disagreements);
  const cadence = computeRunCadence({ months, sources, ledger, services: built.services, eligibility, priorMonth: prior.month });

  // 5. Board pins (RQ-6, ST-9) are fixed before the pre-fill, which judges protections against them.
  const boardPins: V3Pin[] = [];
  const dropped: DroppedPin[] = [];
  const boardPinnedCellKeys = new Set<string>();
  if (input.fillEmpty) {
    for (const column of plannedColumns) {
      const service = serviceById.get(column.columnId);
      if (!service || service.fixed) continue;
      const out = pinsOfColumn(column, service, input.planned.cells, memberIds, nameOf);
      if (out.nonMember) return refuse([V3_LINES.boardNonMember(seatLabel(out.nonMember, [...plannedColumns], [...input.planned.rows]))]);
      boardPins.push(...out.pins);
      dropped.push(...out.dropped);
      out.keys.forEach((k) => boardPinnedCellKeys.add(k));
    }
  }
  const leadOf = (pins: V3Pin[]): FixedLead[] => pins.flatMap((p) => {
    const svc = serviceById.get(p.service);
    return p.role === "Lead" && svc?.counts ? [{ date: p.date, memberId: p.person, dl: dayClass(svc.kind, p.date) === "Sun" }] : [];
  });
  const specialColumns = built.plannedSpecialIds.map((id) => plannedColumns.find((c) => c.columnId === id)!);
  const handPlacedSpecialLeads: FixedLead[] = specialColumns.flatMap((c) =>
    (input.planned.cells.find((x) => x.columnId === c.columnId && x.rowId === "lead")?.occupants ?? [])
      .map((o) => ({ date: c.date, memberId: o.memberId, dl: dayClass("special", c.date) === "Sun" })));
  const priorLeads: FixedLead[] = prior.services.filter((s) => s.counts).flatMap((s) =>
    s.seats.Lead.map((memberId) => ({ date: s.date, memberId, dl: dayClass(s.kind, s.date) === "Sun" })));

  // 6. The counted-specials pre-fill (SP-1, SP-2), then their pins.
  const prefill = prefillCountedSpecials({
    targets: specialColumns.map((c) => ({ columnId: c.columnId, date: c.date, month: monthOfDate(c.date), label: built.labels.get(c.columnId) ?? c.columnId })),
    columns: plannedColumns, rows: input.planned.rows, cells: input.planned.cells, members, savedWindow: input.savedWindow, config,
    eligibility, sources: sourceByMonth, cadence, ledger,
    fixedLeads: [...leadOf(built.storedPins), ...leadOf(boardPins), ...handPlacedSpecialLeads, ...priorLeads],
    nameOf,
  });
  const specialPins: V3Pin[] = [];
  for (const column of specialColumns) {
    const out = pinsOfColumn(column, serviceById.get(column.columnId)!, prefill.cells, memberIds, nameOf);
    if (out.nonMember) return refuse([V3_LINES.boardNonMember(seatLabel(out.nonMember, [...plannedColumns], [...input.planned.rows]))]);
    specialPins.push(...out.pins);
    dropped.push(...out.dropped);
  }
  const pins = [...built.storedPins, ...specialPins, ...boardPins];
  if (pins.length > V3_PIN_CAP) return refuse([V3_LINES.pinCap(pins.length, V3_PIN_CAP)]);

  // 7. People, minted ids, rules, limits.
  const extraIds = new Set<string>([...pins.map((p) => p.person), ...collected.rulePersons]);
  const sentIds = new Set<string>(extraIds);
  for (const [id, byService] of eligibility) if (Object.keys(byService).length > 0) sentIds.add(id);
  const carriedKeys = carriedPresenceKeys(ledger, sentIds);
  const ids = mintRuleIds(config, mintInputOf(collected.rules, carriedKeys));
  const peopleOut = buildV3People({
    months, sources, ledger, members, eligibility, extraIds, cadence, presenceId: (k) => ids.presence(k), priorMonth: prior.month,
  });
  if (!peopleOut.ok) return refuse(peopleOut.lines);
  const rules = emitV3Rules(collected.rules, ids);
  const limits = limitRefusals({ services: built.services.length, people: peopleOut.people.length, rules: rules.length });
  if (limits.length > 0) return refuse(limits);
  const { labels, table } = ruleReferences(collected.rules, ids, config, ledger, carriedKeys);

  // C6's own notices, in a stable order (NT-3): WN-1, WN-3, ST-5/ST-6, RQ-5, SP-6/SP-7, duplicate pins.
  const unbound = sources.filter((s) => s.state !== "bound").map((s) => s.month);
  const wn1 = unbound.length === 0 ? [] : cadenceOutsideSundayPool(config, members)
    .map((x) => `${monthsList(unbound, true)}: ${CADENCE_OUTSIDE_SENTENCE[x.reason](x.name)}`);
  const wn3 = config.saturdayLeads.length > 0 ? [V3_LINES.saturdayPool] : [];
  const notices = [
    ...wn1, ...wn3, ...built.notices, ...collected.notices, ...prefill.notices,
    ...droppedPinNotices({ dropped, columns: [...plannedColumns], rows: [...input.planned.rows], members }),
  ];

  const request: V3SolveRequest = {
    contract: 3,
    seed: input.seed,
    request_id: input.requestId,
    months: [...months],
    services: built.services,
    people: peopleOut.people,
    rules,
    pins,
    prior,
  };
  return {
    ok: true,
    request,
    cells: prefill.cells,
    notices,
    snapshot: { requestId: input.requestId, months: [...months], sources, ruleTable: table },
    ruleLabels: labels,
    serviceLabels: built.labels,
    cadence,
    boardPinnedCellKeys,
    storedServiceIds: built.storedServiceIds,
  };
}
```

- [ ] **Step 5: Run both tests, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3SolveRequest.test.ts app/components/admin/__tests__/v3KeyHygiene.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(planner): one pure builder for the v3 solve request

Planner state, the fresh ledger read, the roles read and the CDMX month go in; the contract-3
request, the planner's own notices and refusals, and the run's snapshot come out — no React, no
fetch, no clock — so the same code is unit-tested here and replayed by C7's Preview rehearsal. It
composes the per-month sources, rules, services, cadence, the specials pre-fill and every pin under
the shared cap, pre-flights C5's limits, and never touches a v2 helper. A name-shaped config proves
no rule key reaches the request, a line, the console or the ordinal table."
```

---

## Task 12: The v3 response adapter and the run report (AD-3–AD-6, NT-1, NT-2) — [standard]

**Files:**
- Create: `app/components/admin/v3SolveResponse.ts`, `app/components/admin/v3RunReport.ts`
- Create (tests): `app/components/admin/__tests__/v3SolveResponse.test.ts`, `app/components/admin/__tests__/v3RunReport.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: `reconcileOccupants`, `GridCell`, `GridRow` (`plannerModel.ts`); Task 4 `V3_ROUTE_COPY`, `transportLine`, `refusalLine`, `stageLabel`, `stageStatusLabel`, `missedLine`, `noticeLine`, `violationLine`, `noPossibleLeadNotice`, `V3_UNFILLED_MARKER`, `V3_CEILING_UNPROVEN`, `V3_UNPROVEN_EXPLANATION`, `V3_NOT_RUN_TAIL`, `V3_STAGE_REASON_LINE`, `V3_LINES`, `V3Names`; Task 2 wire types.
- Produces (`v3SolveResponse.ts`): `type V3Answer = { kind: "aborted" } | { kind: "threw" } | { kind: "http"; status: number; text: string }`; `type V3Outcome = { kind: "version_mismatch" } | { kind: "transport"; reason: V3TransportReason | "unknown_service" } | { kind: "refusal"; code: string; params: Record<string, unknown> } | { kind: "handshake_failed" } | { kind: "success"; response: V3Success }`; `classifyV3Answer(answer): V3Outcome`; `v3HandshakeHolds(response, pins): boolean`; `applyV3Assignments(input: { response: V3Success; request: V3SolveRequest; cells: readonly GridCell[]; rows: readonly GridRow[]; pinnedCellKeys: ReadonlySet<string> }): { ok: true; cells: GridCell[]; unfilled: Array<{ columnId: string; rowId: string; reason: string }> } | { ok: false }`; `v3RetryOffered(o: V3Outcome): boolean`; `v3OutcomeLine(o: Exclude<V3Outcome, { kind: "success" }>): string`.
- Produces (`v3RunReport.ts`): `v3Names(input: { members: ReadonlyArray<{ _id: string; member_name: string; alias?: string }>; serviceLabels: ReadonlyMap<string, string>; ruleLabels: ReadonlyMap<string, string> }): V3Names`; `interface V3RunReport { runLine: string; stageSummary: string[]; stageDetail: Array<{ label: string; status: string }>; solverNotices: string[] }`; `buildV3RunReport(input: { response: V3Success; request: V3SolveRequest; storedServiceIds: ReadonlySet<string>; names: V3Names }): V3RunReport`.

- [ ] **Step 1: Write the failing adapter test** — `app/components/admin/__tests__/v3SolveResponse.test.ts`

```ts
// Solver v3 C6 AD-3–AD-6 — classification in AD-3's order, the handshake, apply-by-service-id and
// the retry rule keyed on codes. Never «sin solución» on any v3 path.
import { describe, expect, it } from "vitest";

import { applyV3Assignments, classifyV3Answer, v3HandshakeHolds, v3OutcomeLine, v3RetryOffered, type V3Outcome } from "../v3SolveResponse";
import { buildRows, type GridCell } from "../plannerModel";
import type { V3Pin, V3SolveRequest, V3Success } from "../v3Wire";

const http = (status: number, body: unknown) => ({ kind: "http" as const, status, text: typeof body === "string" ? body : JSON.stringify(body) });
const success = (over: Partial<V3Success> = {}): V3Success => ({
  ok: true, contract: 3, engine: "v3", solver_version: "3.0.0", build: "t", request_id: "r", seed: 1, months: ["2026-11"],
  reproducible: true, assignments: {}, unfilled: [], pins: { requested: 0, honored: 0 }, violations: [],
  violation_ceiling: { value: 0, proven: true }, stages: [], total_ms: 1,
  fairness: { scale: 100, tolerance: 35, lines: [], people: [] }, cadence: [], missed: [], notices: [], ...over,
});

describe("classifyV3Answer (AD-3's order)", () => {
  it.each<[string, Parameters<typeof classifyV3Answer>[0], V3Outcome["kind"], string?]>([
    ["409 solver_version_mismatch", http(409, { ok: false, error: "solver_version_mismatch", engine: "v2" }), "version_mismatch"],
    ["a client abort", { kind: "aborted" }, "transport", "timeout"],
    ["a fetch that throws", { kind: "threw" }, "transport", "unreachable"],
    ["a bare 504 (no JSON)", http(504, "An error occurred"), "transport", "timeout"],
    ["a non-JSON 200", http(200, "<html>"), "transport", "not_json"],
    ["an unexpected status", http(500, { ok: false }), "transport", "http_status"],
    ["a route-made transport error", http(422, { ok: false, transport_error: true, transport: "not_configured" }), "transport", "not_configured"],
    ["an ok body without contract 3 (a v2 answer)", http(200, { ok: true, schedule: {} }), "transport", "contract_echo"],
    ["a coded refusal", http(422, { ok: false, contract: 3, engine: "v3", code: "timeout", params: { stage: "fill", seconds: 25 } }), "refusal"],
    ["a success", http(200, success()), "success"],
  ])("%s", (_name, answer, kind, reason) => {
    const out = classifyV3Answer(answer);
    expect(out.kind).toBe(kind);
    if (reason) expect(out).toMatchObject({ reason });
  });

  it("never reads as «sin solución»", () => {
    const outcomes: V3Outcome[] = [
      classifyV3Answer({ kind: "aborted" }), classifyV3Answer(http(500, "x")),
      classifyV3Answer(http(422, { ok: false, contract: 3, engine: "v3", code: "internal_error", params: {} })),
      { kind: "version_mismatch" }, { kind: "handshake_failed" },
    ];
    for (const o of outcomes) if (o.kind !== "success") expect(v3OutcomeLine(o)).not.toMatch(/no encontró solución/);
  });
});

describe("v3RetryOffered (AD-6)", () => {
  it.each<[string, V3Outcome, boolean]>([
    ["timeout code", { kind: "refusal", code: "timeout", params: {} }, true],
    ["client abort", { kind: "transport", reason: "timeout" }, true],
    ["unreachable", { kind: "transport", reason: "unreachable" }, true],
    ["http_status", { kind: "transport", reason: "http_status" }, true],
    ["not_json", { kind: "transport", reason: "not_json" }, true],
    ["not_configured", { kind: "transport", reason: "not_configured" }, false],
    ["contract_echo", { kind: "transport", reason: "contract_echo" }, false],
    ["an unknown assignments id", { kind: "transport", reason: "unknown_service" }, false],
    ["another refusal", { kind: "refusal", code: "invalid_request", params: {} }, false],
    ["a handshake failure", { kind: "handshake_failed" }, false],
    ["the version mismatch", { kind: "version_mismatch" }, false],
  ])("%s → %s", (_name, outcome, offered) => expect(v3RetryOffered(outcome)).toBe(offered));
});

describe("v3HandshakeHolds (AD-4)", () => {
  const pins: V3Pin[] = [
    { service: "sun-1", date: "2026-11-01", role: "Lead", person: "m-ana" },
    { service: "sun-1", date: "2026-11-01", role: "Lead", person: "m-ana" },
    { service: "sp-1", date: "2026-11-20", role: "BGV", person: "m-bruno" },
  ];
  const assignments = { "sun-1": { Lead: ["m-ana"] }, "sp-1": { BGV: ["m-bruno"] } };

  it("holds when the echo equals the pins sent and every pin sits in its service and role", () => {
    expect(v3HandshakeHolds(success({ assignments, pins: { requested: 2, honored: 2 } }), pins)).toBe(true);
  });

  it("fails on an echo that differs, or a pin missing from the assignment", () => {
    expect(v3HandshakeHolds(success({ assignments, pins: { requested: 2, honored: 1 } }), pins)).toBe(false);
    expect(v3HandshakeHolds(success({ assignments, pins: { requested: 3, honored: 3 } }), pins)).toBe(false);
    expect(v3HandshakeHolds(success({ assignments: { "sun-1": { Lead: ["m-ana"] } }, pins: { requested: 2, honored: 2 } }), pins)).toBe(false);
  });
});

describe("applyV3Assignments (AD-5)", () => {
  const planned = "create:sunday_role__2026-11-08";
  const request = {
    services: [
      { id: planned, date: "2026-11-08", month: "2026-11", kind: "sunday", fixed: false, counts: true, seats: { Lead: 2, BGV: 3, Choir: 3 } },
      { id: "role.Ñ/odd", date: "2026-11-01", month: "2026-11", kind: "sunday", fixed: true, counts: true },
    ],
  } as unknown as V3SolveRequest;
  const cells: GridCell[] = [
    { columnId: planned, rowId: "lead", occupants: [{ memberId: "m-ana" }], origin: "manual" },
    { columnId: "role.Ñ/odd", rowId: "lead", occupants: [{ memberId: "m-dani", itemKey: "k1" }], origin: "manual" },
  ];

  it("writes planned columns only, by service id; fixed services' cells stay byte-identical; a pinned cell keeps its origin", () => {
    const response = success({ assignments: { [planned]: { Lead: ["m-ana", "m-bruno"], BGV: ["m-carla"], Choir: [] }, "role.Ñ/odd": { Lead: ["m-dani"] } } });
    const out = applyV3Assignments({ response, request, cells, rows: buildRows(), pinnedCellKeys: new Set([`${planned}|lead`]) });
    if (!out.ok) throw new Error("expected ok");
    const at = (col: string, row: string) => out.cells.find((c) => c.columnId === col && c.rowId === row);
    expect(at(planned, "lead")).toMatchObject({ origin: "manual", occupants: [{ memberId: "m-ana" }, { memberId: "m-bruno" }] });
    expect(at(planned, "bgv")).toMatchObject({ origin: "auto", occupants: [{ memberId: "m-carla" }] });
    expect(at("role.Ñ/odd", "lead")).toEqual(cells[1]);
  });

  it("an assignment for a service the request did not send applies nothing", () => {
    const response = success({ assignments: { "not-sent": { Lead: ["m-ana"] } } });
    expect(applyV3Assignments({ response, request, cells, rows: buildRows(), pinnedCellKeys: new Set() })).toEqual({ ok: false });
  });

  it("unfilled entries become `count` markers with their reason's copy", () => {
    const response = success({ assignments: { [planned]: { Lead: [], BGV: [], Choir: [] } }, unfilled: [{ service: planned, role: "Lead", count: 2, reason: "no_possible_lead" }] });
    const out = applyV3Assignments({ response, request, cells, rows: buildRows(), pinnedCellKeys: new Set() });
    if (!out.ok) throw new Error("expected ok");
    expect(out.unfilled).toEqual([
      { columnId: planned, rowId: "lead", reason: "Nadie puede dirigir este servicio" },
      { columnId: planned, rowId: "lead", reason: "Nadie puede dirigir este servicio" },
    ]);
  });
});
```

- [ ] **Step 2: Write the failing report test** — `app/components/admin/__tests__/v3RunReport.test.ts`

```ts
// Solver v3 C6 NT-1, NT-2 — the run line, the stage summary (and «Ver etapas»'s detail), and every
// missed protection, notice, no-lead service and rule break, from codes only.
import { describe, expect, it } from "vitest";

import { buildV3RunReport, v3Names } from "../v3RunReport";
import type { V3SolveRequest, V3Stage, V3Success } from "../v3Wire";

const stage = (id: string, status: V3Stage["status"], reason?: V3Stage["reason"]): V3Stage =>
  ({ id, status, ...(reason ? { reason } : {}), value: 0, bound: 0, limit: "none", ms: 1, det_milli: 1 });
const names = v3Names({
  members: [{ _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana" }],
  serviceLabels: new Map([["sun-1", "domingo 1 nov"]]),
  ruleLabels: new Map([["c1", "Ana · Sun.Lead <= 1"]]),
});
const request = { months: ["2026-11", "2026-12"], services: new Array(9).fill({}) } as unknown as V3SolveRequest;
const response = (over: Partial<V3Success>): V3Success => ({
  ok: true, contract: 3, engine: "v3", solver_version: "3", build: "b", request_id: "r", seed: 1, months: ["2026-11", "2026-12"],
  reproducible: false, assignments: {}, unfilled: [], pins: { requested: 0, honored: 0 }, violations: [], violation_ceiling: { value: 0, proven: true },
  stages: [], total_ms: 1, fairness: { scale: 100, tolerance: 35, lines: [], people: [] }, cadence: [], missed: [], notices: [], ...over,
});

describe("NT-1 — the run line and the stage summary", () => {
  it("names the months and counts the stored services", () => {
    const report = buildV3RunReport({ response: response({ stages: [stage("rules", "proven")] }), request, storedServiceIds: new Set(["a", "b"]), names });
    expect(report.runLine).toBe("Plan de 2 meses: noviembre y diciembre · 9 servicios (2 guardados, se respetan tal cual).");
    expect(report.stageSummary).toEqual(["Todas las etapas quedaron probadas."]);
  });

  it("one line per stage not proven, then each explanation", () => {
    const stages = [stage("rules", "proven"), stage("balance_max:DL", "unproven"), stage("tiebreak", "not_run", "budget")];
    const report = buildV3RunReport({ response: response({ stages }), request, storedServiceIds: new Set(), names });
    expect(report.stageSummary).toEqual([
      "Equidad Dom Lead: el más pendiente: no probado",
      "Desempate: no ejecutado",
      "\"No probado\": el plan es válido, pero el solver no alcanzó a comprobar que fuera el mejor en esa etapa.",
      "Se acabó el tiempo antes de empezarla.",
      "Las etapas no ejecutadas conservan el plan de la etapa anterior. Revísalo antes de crear.",
    ]);
    expect(report.stageDetail).toEqual([
      { label: "Reglas", status: "probado" },
      { label: "Equidad Dom Lead: el más pendiente", status: "no probado" },
      { label: "Desempate", status: "no ejecutado" },
    ]);
  });
});

describe("NT-2 — the solver's own lines", () => {
  it("missed protections, notices, no-lead services and rule breaks, with the ceiling caveat when unproven", () => {
    const report = buildV3RunReport({
      response: response({
        missed: [{ code: "voice_floor_missed", person: "m-ana", month: "2026-11", cause: "capacity" }],
        notices: [{ code: "dl_capacity", params: { months: ["2026-11", "2026-12"], seats: 7, people: 9 } }],
        unfilled: [{ service: "sun-1", role: "Lead", count: 1, reason: "no_possible_lead" }],
        violations: [{ code: "count", rule: "c1", cause: "pins", person: "m-ana", month: "2026-11", observed: 2, limit: 1 }],
        violation_ceiling: { value: 1, proven: false },
      }),
      request, storedServiceIds: new Set(), names,
    });
    expect(report.solverNotices).toEqual([
      "Ana no canta en ningún servicio de noviembre — no alcanzan los lugares (ver aviso de capacidad).",
      "Capacidad de Dom Lead en noviembre y diciembre: 7 domingos para 9 personas. No alcanza para que todas dirijan al menos un domingo cada dos meses.",
      "Nadie puede dirigir el domingo 1 nov: quedó sin líder.",
      "No se cumplió «Ana · Sun.Lead <= 1» en noviembre: quedó en 2 (pide 1) — por lo que ya estaba puesto.",
      "Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.",
    ]);
  });

  it("an unknown code still renders a line", () => {
    const report = buildV3RunReport({ response: response({ notices: [{ code: "brand_new", params: {} }] }), request, storedServiceIds: new Set(), names });
    expect(report.solverNotices).toEqual(["El solver informó algo que el planificador no reconoce (brand_new)."]);
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npx vitest run app/components/admin/__tests__/v3SolveResponse.test.ts app/components/admin/__tests__/v3RunReport.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write the adapter** — Create `app/components/admin/v3SolveResponse.ts`

```ts
// app/components/admin/v3SolveResponse.ts
//
// Solver v3 C6 U8 / AD-1–AD-6 — the v3 adapter. v2's handshake, violation parser, unfilled mapper,
// `applySolveResponse`, `solverRefusalMessage` and the trailing retry never read a v3 body, and this
// module never reads a v2 one (the caller dispatches on the engine prop before reading the body).
//
// Classification, in AD-3's order: 409 `solver_version_mismatch` → reload; an abort, a throw, any
// non-JSON body, any status other than 200/422/409, or a body with `transport_error` → transport; an
// `ok` body without `contract: 3` and `engine: "v3"` → transport (`contract_echo`); a 422 coded
// failure → that code's copy; `ok: true` → the handshake (AD-4), then apply (AD-5).
// Retry (AD-6): offered exactly after the `timeout` code and a timeout or connection transport.

import { reconcileOccupants, type GridCell, type GridRow } from "./plannerModel";
import { V3_ROUTE_COPY, V3_UNFILLED_MARKER, refusalLine, transportLine } from "./v3Copy";
import type { V3Pin, V3Role, V3SolveRequest, V3Success, V3TransportReason } from "./v3Wire";

export type V3Answer = { kind: "aborted" } | { kind: "threw" } | { kind: "http"; status: number; text: string };

export type V3Outcome =
  | { kind: "version_mismatch" }
  | { kind: "transport"; reason: V3TransportReason | "unknown_service" }
  | { kind: "refusal"; code: string; params: Record<string, unknown> }
  | { kind: "handshake_failed" }
  | { kind: "success"; response: V3Success };

const TRANSPORT_REASONS: readonly string[] = ["timeout", "unreachable", "http_status", "not_json", "not_configured", "contract_echo"];

export function classifyV3Answer(answer: V3Answer): V3Outcome {
  if (answer.kind === "aborted") return { kind: "transport", reason: "timeout" };
  if (answer.kind === "threw") return { kind: "transport", reason: "unreachable" };
  let json: unknown;
  let parsed = true;
  try { json = JSON.parse(answer.text); } catch { parsed = false; }
  const o = parsed && typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (answer.status === 409 && o?.error === "solver_version_mismatch") return { kind: "version_mismatch" };
  if (!o) return { kind: "transport", reason: answer.status === 504 ? "timeout" : "not_json" };
  if (answer.status !== 200 && answer.status !== 422) return { kind: "transport", reason: answer.status === 504 ? "timeout" : "http_status" };
  if (o.transport_error === true) {
    const r = typeof o.transport === "string" && TRANSPORT_REASONS.includes(o.transport) ? (o.transport as V3TransportReason) : "http_status";
    return { kind: "transport", reason: r };
  }
  if (o.ok === true) {
    return o.contract === 3 && o.engine === "v3" ? { kind: "success", response: o as unknown as V3Success } : { kind: "transport", reason: "contract_echo" };
  }
  if (answer.status === 422 && o.ok === false && o.contract === 3 && o.engine === "v3" && typeof o.code === "string") {
    return { kind: "refusal", code: o.code, params: (typeof o.params === "object" && o.params !== null ? o.params : {}) as Record<string, unknown> };
  }
  return { kind: "transport", reason: "http_status" };
}

/** AD-6: a retry can heal a timeout or a connection fault — never a configuration fault or a refusal. */
export function v3RetryOffered(o: V3Outcome): boolean {
  if (o.kind === "refusal") return o.code === "timeout";
  if (o.kind === "transport") return o.reason === "timeout" || o.reason === "unreachable" || o.reason === "http_status" || o.reason === "not_json";
  return false;
}

export function v3OutcomeLine(o: Exclude<V3Outcome, { kind: "success" }>): string {
  if (o.kind === "version_mismatch") return V3_ROUTE_COPY.versionMismatch;
  if (o.kind === "handshake_failed") return V3_ROUTE_COPY.handshake;
  if (o.kind === "transport") return transportLine(o.reason);
  return refusalLine(o.code, o.params);
}

/** AD-4: the echo equals the (distinct) pins sent, and every pin sits under its service and role. */
export function v3HandshakeHolds(response: V3Success, pins: readonly V3Pin[]): boolean {
  const distinct = [...new Map(pins.map((p) => [`${p.service}\u0000${p.role}\u0000${p.person}`, p])).values()];
  if (response.pins?.requested !== distinct.length || response.pins?.honored !== distinct.length) return false;
  return distinct.every((p) => (response.assignments[p.service]?.[p.role] ?? []).includes(p.person));
}

const ROW_OF: Record<V3Role, string> = { Lead: "lead", BGV: "bgv", Choir: "coro" };

/**
 * AD-5: assignments map by service id to PLANNED (non-fixed) columns only; a board-pinned cell keeps
 * its origin, every other planned voice cell is replaced with `origin: "auto"`; a fixed service's
 * cells are never written. An assignment for an id the request did not send applies nothing.
 */
export function applyV3Assignments(input: {
  response: V3Success;
  request: V3SolveRequest;
  cells: readonly GridCell[];
  rows: readonly GridRow[];
  pinnedCellKeys: ReadonlySet<string>;
}): { ok: true; cells: GridCell[]; unfilled: Array<{ columnId: string; rowId: string; reason: string }> } | { ok: false } {
  const sent = new Map(input.request.services.map((s) => [s.id, s]));
  for (const id of Object.keys(input.response.assignments)) if (!sent.has(id)) return { ok: false };
  let cells = [...input.cells];
  for (const [id, byRole] of Object.entries(input.response.assignments)) {
    const service = sent.get(id)!;
    if (service.fixed) continue;
    for (const role of ["Lead", "BGV", "Choir"] as const) {
      const rowId = ROW_OF[role];
      if (!input.rows.some((r) => r.id === rowId)) continue;
      if (role === "Choir" && service.kind === "saturday") continue;
      const ids = byRole[role] ?? [];
      const at = cells.findIndex((c) => c.columnId === id && c.rowId === rowId);
      const pinned = input.pinnedCellKeys.has(`${id}|${rowId}`);
      const previous = at === -1 ? undefined : cells[at];
      const next: GridCell = {
        ...(previous ?? { columnId: id, rowId }),
        columnId: id,
        rowId,
        occupants: reconcileOccupants(previous?.occupants ?? [], ids),
        origin: pinned && previous ? previous.origin : "auto",
      };
      cells = at === -1 ? [...cells, next] : [...cells.slice(0, at), next, ...cells.slice(at + 1)];
    }
  }
  const unfilled = input.response.unfilled
    .filter((u) => sent.get(u.service)?.fixed === false)
    .flatMap((u) => Array.from({ length: u.count }, () => ({ columnId: u.service, rowId: ROW_OF[u.role], reason: V3_UNFILLED_MARKER(u.reason) })));
  return { ok: true, cells, unfilled };
}
```

- [ ] **Step 5: Write the report** — Create `app/components/admin/v3RunReport.ts`

```ts
// app/components/admin/v3RunReport.ts
//
// Solver v3 C6 NT-1, NT-2 — everything a v3 success says, rendered from codes through `v3Copy.ts`.
// C6's own notices (the builder's) precede these (NT-3); v2's «Sin optimizar», «Equidad relajada» and
// «Historial» lines never render on a v3 run (NT-5: the caller passes no v2 diagnostics).

import {
  V3_CEILING_UNPROVEN, V3_LINES, V3_NOT_RUN_TAIL, V3_STAGE_REASON_LINE, V3_UNPROVEN_EXPLANATION,
  missedLine, noPossibleLeadNotice, noticeLine, stageLabel, stageStatusLabel, violationLine, type V3Names,
} from "./v3Copy";
import type { V3SolveRequest, V3Success } from "./v3Wire";

export function v3Names(input: {
  members: ReadonlyArray<{ _id: string; member_name: string; alias?: string }>;
  serviceLabels: ReadonlyMap<string, string>;
  ruleLabels: ReadonlyMap<string, string>;
}): V3Names {
  return {
    person: (id) => {
      const m = input.members.find((x) => x._id === id);
      return m ? (m.alias?.trim() || m.member_name) : "alguien que ya no está en la lista";
    },
    rule: (id) => input.ruleLabels.get(id) ?? V3_LINES.recordedPresenceLabel,
    service: (id) => input.serviceLabels.get(id) ?? "servicio",
  };
}

export interface V3RunReport {
  runLine: string;
  stageSummary: string[];
  stageDetail: Array<{ label: string; status: string }>;
  solverNotices: string[];
}

export function buildV3RunReport(input: {
  response: V3Success;
  request: V3SolveRequest;
  storedServiceIds: ReadonlySet<string>;
  names: V3Names;
}): V3RunReport {
  const { response, names } = input;
  const runLine = V3_LINES.runLine(input.request.months, input.request.services.length, input.storedServiceIds.size);

  const notProven = response.stages.filter((s) => s.status !== "proven");
  const stageSummary: string[] = notProven.length === 0
    ? [V3_LINES.allProven]
    : notProven.map((s) => V3_LINES.stageNotProven(stageLabel(s.id, names), stageStatusLabel(s.status)));
  if (notProven.some((s) => s.status === "unproven")) stageSummary.push(V3_UNPROVEN_EXPLANATION);
  const reasons = [...new Set(notProven.filter((s) => s.status === "not_run" && s.reason).map((s) => s.reason!))];
  if (notProven.some((s) => s.status === "not_run")) {
    stageSummary.push(...reasons.map(V3_STAGE_REASON_LINE), V3_NOT_RUN_TAIL);
  }
  const stageDetail = response.stages.map((s) => ({ label: stageLabel(s.id, names), status: stageStatusLabel(s.status) }));

  const solverNotices = [
    ...response.missed.map((m) => missedLine(m, names)),
    ...response.notices.map((n) => noticeLine(n.code, n.params, names)),
    ...response.unfilled.filter((u) => u.reason === "no_possible_lead").map((u) => noPossibleLeadNotice(names.service(u.service))),
    ...response.violations.map((v) => violationLine(v, names)),
    ...(response.violations.length > 0 && !response.violation_ceiling.proven ? [V3_CEILING_UNPROVEN] : []),
  ];
  return { runLine, stageSummary, stageDetail, solverNotices };
}
```

- [ ] **Step 6: Run both, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3SolveResponse.test.ts app/components/admin/__tests__/v3RunReport.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(planner): the v3 response adapter and run report, keyed on codes

v3 answers get their own classifier, handshake, apply and retry rule, so a v3 body can never reach
a v2 parser: a version mismatch asks for a reload, a timeout and a connection fault each have their
own copy and a «Reintentar», a configuration fault does not, and nothing reads as «sin solución». A
success applies only if every pin came back, only to planned columns, by service id; the run
report states each stage's proof status and every missed protection, notice and rule break."
```

---

## Task 13: `runV3Auto` — refusal order, the fresh 20 s ledger read, the 58 s solve (RQ-1, HZ-7, HZ-9, WN-2, ST-1, AD-2, AD-3, SP-5) — [standard]

**Files:**
- Create: `app/components/admin/v3AutoRun.ts`
- Create (test): `app/components/admin/__tests__/v3AutoRun.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: Task 11 `V3BuildResult`; Task 12 `classifyV3Answer`, `v3HandshakeHolds`, `V3Outcome`, `V3Answer`; Task 4 `V3_LINES`, `V3_ROUTE_COPY`; C2 `FairnessLedgerResponse`.
- Produces: `V3_LEDGER_TIMEOUT_MS = 20_000`; `V3_CLIENT_SOLVE_TIMEOUT_MS = 58_000`; `interface V3AutoDeps { months: string[]; preRead: () => string[]; storedReady: () => boolean; specialsWaiting: boolean; readLedger: (signal: AbortSignal) => Promise<{ status: number; body: unknown }>; isCurrent: () => boolean; build: (ledger: FairnessLedgerResponse) => V3BuildResult; postSolve: (request: V3SolveRequest, signal: AbortSignal) => Promise<{ status: number; text: string }> }`; `type V3AutoResult = { kind: "refused"; lines: string[] } | { kind: "stale" } | { kind: "solved"; build: Extract<V3BuildResult, { ok: true }>; outcome: V3Outcome }`; `runV3Auto(deps: V3AutoDeps): Promise<V3AutoResult>`; `isLedgerBody(body: unknown, months: readonly string[]): body is FairnessLedgerResponse`.

- [ ] **Step 1: Write the failing test** — `app/components/admin/__tests__/v3AutoRun.test.ts`

```ts
// Solver v3 C6 — Auto's v3 orchestration, with injected transports and fake timers: what refuses
// before any read (HZ-7, HZ-9, WN-2, ST-1), the fresh ledger read bounded at 20 s (RQ-1), the build,
// the solve aborted by the client at 58 s (AD-2), and AD-3/AD-4's outcome.
import { afterEach, describe, expect, it, vi } from "vitest";

import { V3_CLIENT_SOLVE_TIMEOUT_MS, V3_LEDGER_TIMEOUT_MS, runV3Auto, type V3AutoDeps } from "../v3AutoRun";
import { preReadRefusals, type V3BuildResult } from "../v3SolveRequest";
import { MEMBERS, config, ledgerResponse } from "./v3Fixtures";

afterEach(() => vi.useRealTimers());

const builtOk = (pins: unknown[] = []) => ({
  ok: true, request: { contract: 3, pins, services: [], months: ["2026-11"] }, cells: [], notices: [], snapshot: { requestId: "r", months: ["2026-11"], sources: [], ruleTable: [] },
  ruleLabels: new Map(), serviceLabels: new Map(), cadence: new Map(), boardPinnedCellKeys: new Set(), storedServiceIds: new Set(),
}) as unknown as V3BuildResult;
const SUCCESS = JSON.stringify({ ok: true, contract: 3, engine: "v3", assignments: {}, pins: { requested: 0, honored: 0 }, unfilled: [], stages: [], violations: [], violation_ceiling: { value: 0, proven: true }, missed: [], notices: [], cadence: [], fairness: { scale: 100, tolerance: 35, lines: [], people: [] } });

function deps(over: Partial<V3AutoDeps> = {}): V3AutoDeps & { readLedger: ReturnType<typeof vi.fn>; postSolve: ReturnType<typeof vi.fn> } {
  return {
    months: ["2026-11"],
    preRead: () => [],
    storedReady: () => true,
    specialsWaiting: false,
    readLedger: vi.fn(async () => ({ status: 200, body: ledgerResponse(["2026-11"]) })),
    isCurrent: () => true,
    build: () => builtOk(),
    postSolve: vi.fn(async () => ({ status: 200, text: SUCCESS })),
    ...over,
  } as V3AutoDeps & { readLedger: ReturnType<typeof vi.fn>; postSolve: ReturnType<typeof vi.fn> };
}

describe("before any read", () => {
  it("HZ-7 / HZ-9 / WN-2 refuse with no GET and no solver fetch", async () => {
    for (const months of [["2026-09"], ["2027-11"], ["2027-10", "2027-11"]]) {
      const d = deps({ months, preRead: () => preReadRefusals({ months, currentMonth: "2026-10", config: config(), members: MEMBERS }) });
      const out = await runV3Auto(d);
      expect(out.kind).toBe("refused");
      expect(d.readLedger).not.toHaveBeenCalled();
      expect(d.postSolve).not.toHaveBeenCalled();
    }
  });

  it("ST-1: a stored read that is not ready or not coherent refuses, naming the months", async () => {
    const d = deps({ months: ["2026-11", "2026-12"], storedReady: () => false });
    expect(await runV3Auto(d)).toEqual({ kind: "refused", lines: ["No se pudieron leer los servicios guardados de noviembre y diciembre. Auto no corrió; vuelve a intentar."] });
    expect(d.readLedger).not.toHaveBeenCalled();
  });

  it("SP-5: a refusal before the pre-fill adds the counted-specials line", async () => {
    const out = await runV3Auto(deps({ storedReady: () => false, specialsWaiting: true }));
    expect(out.kind === "refused" && out.lines.at(-1)).toBe("Los especiales que cuentan para equidad no se llenaron porque Auto no corrió.");
  });
});

describe("RQ-1 — the ledger is read fresh, bounded at 20 s, and anything but a 200 IF2-8 body refuses", () => {
  const FAILED = "No se pudo leer el saldo de equidad. Auto no corrió; vuelve a intentar.";

  it.each([
    ["IF2-7's failure body", { status: 500, body: { error: "fairness_unavailable", message: "No se pudo leer el saldo de equidad." } }],
    ["a 403", { status: 403, body: { error: "Forbidden" } }],
    ["an unparseable body", { status: 200, body: null }],
    ["a 200 for another horizon", { status: 200, body: ledgerResponse(["2026-12"]) }],
  ])("%s refuses and sends nothing", async (_name, answer) => {
    const d = deps({ readLedger: vi.fn(async () => answer) });
    expect(await runV3Auto(d)).toEqual({ kind: "refused", lines: [FAILED] });
    expect(d.postSolve).not.toHaveBeenCalled();
  });

  it("a read that throws refuses", async () => {
    const d = deps({ readLedger: vi.fn(async () => { throw new TypeError("fetch failed"); }) });
    expect(await runV3Auto(d)).toEqual({ kind: "refused", lines: [FAILED] });
  });

  it("is aborted at 20 s", async () => {
    vi.useFakeTimers();
    expect(V3_LEDGER_TIMEOUT_MS).toBe(20_000);
    const readLedger = vi.fn((signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const pending = runV3Auto(deps({ readLedger }));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(readLedger.mock.calls[0][0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: "refused", lines: [FAILED] });
  });

  it("if the horizon changes during the read, nothing is solved", async () => {
    let current = true;
    const d = deps({ readLedger: vi.fn(async () => { current = false; return { status: 200, body: ledgerResponse(["2026-11"]) }; }), isCurrent: () => current });
    expect(await runV3Auto(d)).toEqual({ kind: "stale" });
    expect(d.postSolve).not.toHaveBeenCalled();
  });

  it("a build refusal is Auto's refusal; no solver fetch", async () => {
    const d = deps({ build: () => ({ ok: false, lines: ["No se puede correr Auto: «Ana» en las reglas no coincide con nadie. Corrige el nombre en la regla."] }) });
    expect(await runV3Auto(d)).toEqual({ kind: "refused", lines: ["No se puede correr Auto: «Ana» en las reglas no coincide con nadie. Corrige el nombre en la regla."] });
    expect(d.postSolve).not.toHaveBeenCalled();
  });
});

describe("the solve (AD-2, AD-3, AD-4)", () => {
  it("is aborted by the client at 58 s and reads as the timeout transport", async () => {
    vi.useFakeTimers();
    expect(V3_CLIENT_SOLVE_TIMEOUT_MS).toBe(58_000);
    const postSolve = vi.fn((_r: unknown, signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const pending = runV3Auto(deps({ postSolve }));
    await vi.advanceTimersByTimeAsync(0);          // flush the ledger read without moving the clock
    expect(postSolve).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(57_999);
    expect((postSolve.mock.calls[0][1] as AbortSignal).aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const out = await pending;
    expect(out.kind === "solved" && out.outcome).toEqual({ kind: "transport", reason: "timeout" });
  });

  it("a success whose pin echo differs is a handshake failure", async () => {
    const pins = [{ service: "s", date: "2026-11-01", role: "Lead", person: "m-ana" }];
    const out = await runV3Auto(deps({ build: () => builtOk(pins) }));
    expect(out.kind === "solved" && out.outcome).toEqual({ kind: "handshake_failed" });
  });

  it("a success is returned with its build", async () => {
    const out = await runV3Auto(deps());
    expect(out.kind === "solved" && out.outcome.kind).toBe("success");
  });

  it("a 409 version mismatch is its own outcome", async () => {
    const out = await runV3Auto(deps({ postSolve: vi.fn(async () => ({ status: 409, text: JSON.stringify({ ok: false, error: "solver_version_mismatch", engine: "v2" }) })) }));
    expect(out.kind === "solved" && out.outcome).toEqual({ kind: "version_mismatch" });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/v3AutoRun.test.ts`
Expected: FAIL — `Cannot find module '../v3AutoRun'`.

- [ ] **Step 3: Write the module** — Create `app/components/admin/v3AutoRun.ts`

```ts
// app/components/admin/v3AutoRun.ts
//
// Solver v3 C6 — one v3 Auto run, with its transports injected (the component passes `fetch`-based
// ones; tests pass fakes). The order is the spec's:
//   1. HZ-7, HZ-9, WN-2 (`preRead`) and ST-1 (`storedReady`) refuse BEFORE any read;
//   2. RQ-1: `GET /api/admin/fairness` read FRESH (never a display copy), aborted at 20 s; anything
//      but a 200 IF2-8 body for this horizon refuses, and nothing is sent with missing balances;
//      if the horizon changed during the read, nothing is solved;
//   3. the pure builder (its refusals are Auto's);
//   4. `POST /api/admin/solve`, aborted by the client at 58 s (the route answers first, at 55 s);
//   5. AD-3's classification and AD-4's handshake. The caller applies (AD-5) and fills uncounted
//      specials and instruments at every exit (AD-7).
// SP-5: a refusal before the pre-fill ran adds the counted-specials line when any were waiting (the
// builder adds it for its own refusals).

import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";
import { V3_LINES, V3_ROUTE_COPY } from "./v3Copy";
import { classifyV3Answer, v3HandshakeHolds, type V3Answer, type V3Outcome } from "./v3SolveResponse";
import type { V3BuildResult } from "./v3SolveRequest";
import type { V3SolveRequest } from "./v3Wire";

export const V3_LEDGER_TIMEOUT_MS = 20_000;
export const V3_CLIENT_SOLVE_TIMEOUT_MS = 58_000;

export interface V3AutoDeps {
  months: string[];
  preRead: () => string[];
  storedReady: () => boolean;
  specialsWaiting: boolean;
  readLedger: (signal: AbortSignal) => Promise<{ status: number; body: unknown }>;
  isCurrent: () => boolean;
  build: (ledger: FairnessLedgerResponse) => V3BuildResult;
  postSolve: (request: V3SolveRequest, signal: AbortSignal) => Promise<{ status: number; text: string }>;
}

export type V3AutoResult =
  | { kind: "refused"; lines: string[] }
  | { kind: "stale" }
  | { kind: "solved"; build: Extract<V3BuildResult, { ok: true }>; outcome: V3Outcome };

/** An IF2-8 200 body for exactly these horizon months. */
export function isLedgerBody(body: unknown, months: readonly string[]): body is FairnessLedgerResponse {
  if (typeof body !== "object" || body === null) return false;
  const o = body as Partial<FairnessLedgerResponse>;
  return o.v === 1 && Array.isArray(o.people) && Array.isArray(o.horizon)
    && o.horizon.length === months.length && o.horizon.every((h, i) => h?.month === months[i]);
}

async function bounded<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; aborted: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return { ok: true, value: await run(controller.signal) };
  } catch {
    return { ok: false, aborted: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

export async function runV3Auto(deps: V3AutoDeps): Promise<V3AutoResult> {
  const refused = (lines: string[]): V3AutoResult =>
    ({ kind: "refused", lines: deps.specialsWaiting ? [...lines, V3_LINES.prefillNotRun] : lines });

  const pre = deps.preRead();
  if (pre.length > 0) return refused(pre);
  if (!deps.storedReady()) return refused([V3_LINES.storedReadFailed(deps.months)]);

  const read = await bounded(V3_LEDGER_TIMEOUT_MS, deps.readLedger);
  if (!deps.isCurrent()) return { kind: "stale" };
  if (!read.ok || read.value.status !== 200 || !isLedgerBody(read.value.body, deps.months)) {
    return refused([V3_ROUTE_COPY.ledgerFailed]);
  }

  const built = deps.build(read.value.body);
  if (!built.ok) return { kind: "refused", lines: built.lines };

  const solved = await bounded(V3_CLIENT_SOLVE_TIMEOUT_MS, (signal) => deps.postSolve(built.request, signal));
  const answer: V3Answer = solved.ok
    ? { kind: "http", status: solved.value.status, text: solved.value.text }
    : solved.aborted ? { kind: "aborted" } : { kind: "threw" };
  let outcome = classifyV3Answer(answer);
  if (outcome.kind === "success" && !v3HandshakeHolds(outcome.response, built.request.pins)) outcome = { kind: "handshake_failed" };
  return { kind: "solved", build: built, outcome };
}
```

- [ ] **Step 4: Run it, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3AutoRun.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(planner): one v3 Auto run — refusals first, a fresh bounded ledger read, a bounded solve

A v3 Auto refuses a past or too-distant month, a «Mes por medio» name that is not one person and an
unreadable stored-service read before reading anything; then reads the fairness ledger fresh with a
20 s ceiling (any failure refuses — no solve with missing balances), builds, and posts with a 58 s
client abort so the route's 55 s answer arrives first. Transports are injected, so the order and the
timeouts are tested without the planner component."
```

---

## Task 14: The planner's v3 horizon — control, stacked calendars, month band, sidebar scope, «Guardado» columns (HZ-1–HZ-6, HZ-8, ST-1–ST-3) — [standard]

**Files:**
- Modify: `app/components/admin/v3Horizon.ts` (append `participationMonthsOf`), `app/components/admin/__tests__/v3Horizon.test.ts` (append)
- Modify: `app/components/admin/PlannerGrid.tsx` — props (`monthBands`), `ColumnHeader` (`guardado`), the picker guard, the grid block
- Modify: `app/components/admin/MonthGenerator.tsx` — horizon state, the month-change effect (`:2330-2347`), `sundayDatesFull` (`:2438`), `requestSaturdayWeeks`/`pinBoard` (`:2803-2833`), stored translations (`:2122-2131`), `columns` (`:2500-2506`), the config step (`:4410-4479`), `participationSaved` (`:2863-2866`), `participationRoles` (`:4380-4387`), the `<PlannerGrid` mount (`:4902-4993`)
- Modify: `app/components/admin/ServicesPanel.tsx` — the create mount (`:1040-1062`) gets `storedSource`
- Create (test helper, not a test file): `app/components/admin/__tests__/v3PlannerHarness.tsx`
- Create (test): `app/components/admin/__tests__/MonthGenerator.v3Horizon.test.tsx`
- Regenerate: `colour-inventory.json` only if a non-test `app/` file was added (none here)

**Interfaces:**
- Consumes: Task 3 `horizonMonths`, `monthsEntering`, `retainInHorizon`, `weekendDatesOfMonth`, `HorizonLength`; Task 4 `monthNameCap`, `monthsList`; `translateStoredRole`, `StoredGridTranslation` (`storedRoleReadModel.ts`); `normalizeServiceName` (`app/utils/normalizeLabel.ts`); `SegmentedControl`.
- Produces: `participationMonthsOf(horizon: readonly string[], choice: string): string[]`; `PlannerGridProps.monthBands?: ReadonlyArray<{ month: string; label: string; columnIds: readonly string[] }>`; inside `MonthGenerator`: `isV3`, `horizon: string[]`, `horizonLength`, `v3Stored: { ready: boolean; translations: StoredGridTranslation[] }`, `v3StoredIds: Set<string>`, `v3GridColumns: GridColumn[]`, `plannedCreateColumns` — read by Tasks 15, 16 and 19. `v3PlannerHarness.tsx` exports `storedRole`, `storedSourceOf`, `renderV3`, `routeFetch`.

- [ ] **Step 1: Append the sidebar-scope helper and its test**

`app/components/admin/v3Horizon.ts` — append:
```ts

/** HZ-6: which months the participation sidebar counts — one horizon month, or «Ambos». */
export function participationMonthsOf(horizon: readonly string[], choice: string): string[] {
  return horizon.includes(choice) ? [choice] : [...horizon];
}
```
`app/components/admin/__tests__/v3Horizon.test.ts` — the import list gains `participationMonthsOf`: Find `  monthsEntering, retainInHorizon, weekendDatesOfMonth,` → Replace with `  monthsEntering, participationMonthsOf, retainInHorizon, weekendDatesOfMonth,`, and append:
```ts

describe("participationMonthsOf (HZ-6)", () => {
  it("counts one month, or both («Ambos» and anything not in the horizon)", () => {
    expect(participationMonthsOf(["2026-11", "2026-12"], "2026-12")).toEqual(["2026-12"]);
    expect(participationMonthsOf(["2026-11", "2026-12"], "both")).toEqual(["2026-11", "2026-12"]);
    expect(participationMonthsOf(["2026-12"], "2026-11")).toEqual(["2026-12"]);
  });
});
```

- [ ] **Step 2: Write the test harness** — Create `app/components/admin/__tests__/v3PlannerHarness.tsx`

```tsx
// app/components/admin/__tests__/v3PlannerHarness.tsx
//
// Shared by the MonthGenerator v3 suites — NOT a test file. Renders the CREATE planner under the
// v3 engine prop with a coherent stored read (roles + integrity, the stored editor's own shape), and
// routes `fetch` by URL so each suite scripts only what it is about. Fictitious people only.
import { render } from "@testing-library/react";
import { vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import type { ServiceRole } from "../serviceCardModel";
import type { SolverConfig } from "../plannerModel";
import type { RoleDomainSummary, RoleTarget } from "@/app/utils/serviceReadSummary";
import { AdminProviders } from "./providersHarness";
import { readyRules } from "./rulesHarness";
import { MEMBERS } from "./v3Fixtures";

const person = (id: string, key: string) => ({ _id: id, _key: key, member_name: id });

export function storedRole(over: Partial<ServiceRole> & Pick<ServiceRole, "_id" | "_type" | "date">): ServiceRole {
  return { _rev: `rev-${over._id}`, published: false, leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over } as ServiceRole;
}
export const seat = (memberId: string, i = 0) => person(memberId, `${memberId}-k${i}`);

function targetFor(value: ServiceRole): RoleTarget {
  const isSpecial = value._type === "special_role";
  const refs = [...new Set([...value.leads, ...value.bgvs, ...value.chorus].map((x) => x._id))];
  return {
    targetKey: isSpecial ? value._id : `${value._type}:${value.date}`,
    type: value._type, canonicalCount: 1, canonicalIds: [value._id], canonicalState: "single", publicState: "single",
    memberVisibleCount: value.published === false ? 0 : 1, draftIds: [],
    records: [{ id: value._id, rev: value._rev, type: value._type, serviceDate: value.date, published: value.published !== false, assignedRefs: refs, members: [], danglingRefs: [] }],
    expectsLock: !isSpecial,
    lock: isSpecial ? null : { id: `roleTarget.${value._type}.${value.date}`, rev: `lock-${value._id}`, state: "claimed", roleId: value._id, generation: 1 },
    lockIssues: [],
  } as RoleTarget;
}

export function storedSourceOf(roles: ServiceRole[], status: "ready" | "loading" | "error" = "ready") {
  const integrity: RoleDomainSummary = { targets: roles.map(targetFor), recordIssues: [], lockIssues: [] } as RoleDomainSummary;
  return { roles, integrity, rolesStatus: status, integrityStatus: status, rolesGeneration: 1, integrityGeneration: 1, reload: vi.fn(async () => true) };
}

type Route = (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined;

/** `fetch` routed by URL: the first route that answers wins; anything unrouted throws (no silent calls). */
export function routeFetch(...routes: Route[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const route of routes) {
      const answer = route(url, init);
      if (answer) {
        const text = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
        return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => JSON.parse(text), text: async () => text };
      }
    }
    throw new Error(`unrouted fetch: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

export function renderV3(opts: {
  roles?: ServiceRole[];
  config?: SolverConfig;
  initialMonth?: string;
  storedStatus?: "ready" | "loading" | "error";
  engine?: "v2" | "v3";
  members?: typeof MEMBERS;
  onClose?: () => void;
} = {}) {
  const roles = opts.roles ?? [];
  return render(
    <AdminProviders>
      <MonthGenerator
        engine={opts.engine ?? "v3"}
        // WN-1's engine half, as ServicesPanel passes it (Task 16).
        showCadencePoolWarning={(opts.engine ?? "v3") === "v3"}
        members={opts.members ?? MEMBERS}
        existingRoles={roles}
        allRoles={roles}
        storedSource={storedSourceOf(roles, opts.storedStatus)}
        rules={readyRules(opts.config)}
        initialMonth={opts.initialMonth ?? "2026-11"}
        onClose={opts.onClose ?? vi.fn()}
        onCreated={vi.fn()}
      />
    </AdminProviders>,
  );
}
```

- [ ] **Step 3: Write the failing component test** — `app/components/admin/__tests__/MonthGenerator.v3Horizon.test.tsx`

```tsx
/** @vitest-environment jsdom */
// Solver v3 C6 HZ-1–HZ-6, ST-1–ST-3 — the create planner under the v3 engine prop: the horizon
// control, one calendar per month, the month band inside the grid's own scroller, the sidebar's
// scope, and read-only «Guardado» columns from the stored editor's own coherent read. Under v2 none
// of it exists.
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderV3, routeFetch, seat, storedRole } from "./v3PlannerHarness";
import { deselectAll } from "./plannerWiringHarness";
import { ledgerResponse } from "./v3Fixtures";
import { ruleContextForTarget } from "../serviceRuleContext";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:00:00.000Z"));
  routeFetch((url) => (url.startsWith("/api/admin/fairness?") ? { status: 200, body: ledgerResponse(["2026-11", "2026-12"]) } : undefined),
    (url) => (url.startsWith("/api/admin/solver-history?") ? { status: 500, body: {} } : undefined));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const planear = () => screen.queryByRole("radiogroup", { name: "Planear" });
const twoMonths = () => fireEvent.click(within(planear()!).getByRole("radio", { name: "2 meses" }));
const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

describe("HZ-1 — «Planear: 1 mes · 2 meses»", () => {
  it("exists under v3 (default «1 mes») and is absent under v2", () => {
    renderV3();
    expect(within(planear()!).getByRole("radio", { name: "1 mes" }).getAttribute("aria-checked")).toBe("true");
    cleanup();
    renderV3({ engine: "v2" });
    expect(planear()).toBeNull();
  });
});

describe("HZ-4 / HZ-3 / HZ-2 — one calendar per month; dates belong to their own month; selections follow the horizon", () => {
  it("2 meses stacks November and December; 1 mes shows November only", () => {
    const { container } = renderV3();
    expect(container.querySelector('[data-date="2026-12-06"]')).toBeNull();
    twoMonths();
    expect(container.querySelector('[data-date="2026-11-01"]')).not.toBeNull();
    expect(container.querySelector('[data-date="2026-12-06"]')).not.toBeNull();
  });

  it("October + November offers Saturday 31 Oct once, under October", () => {
    const { container } = renderV3({ initialMonth: "2026-10" });
    twoMonths();
    expect(container.querySelectorAll('[data-date="2026-10-31"]')).toHaveLength(1);
  });

  it("a deselected December Sunday is forgotten when December leaves the horizon", () => {
    const { container } = renderV3();
    twoMonths();
    fireEvent.click(container.querySelector('[data-date="2026-12-06"]')!);
    expect(container.querySelector('[data-date="2026-12-06"]')!.getAttribute("data-selected")).toBe("false");
    fireEvent.click(within(planear()!).getByRole("radio", { name: "1 mes" }));
    twoMonths();
    expect(container.querySelector('[data-date="2026-12-06"]')!.getAttribute("data-selected")).toBe("true");
  });
});

describe("HZ-5 / HZ-6 — the grid spans the horizon", () => {
  it("one grid with a band per month inside its own horizontal scroller", () => {
    const { container } = renderV3();
    twoMonths();
    preview();
    const scroller = container.querySelector("[data-planner-scroller]")!;
    expect([...scroller.querySelectorAll("[data-month-band]")].map((b) => b.textContent)).toEqual(["Noviembre", "Diciembre"]);
    expect(container.querySelector('[data-grid-column-id="create:sunday_role__2026-12-06"]')).not.toBeNull();
  });

  it("the sidebar says which months it counts and offers «Noviembre · Diciembre · Ambos» (default «Ambos»)", () => {
    renderV3();
    twoMonths();
    preview();
    const scope = screen.getByRole("radiogroup", { name: "Cuenta" });
    expect(within(scope).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Noviembre", "Diciembre", "Ambos"]);
    expect(within(scope).getByRole("radio", { name: "Ambos" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Noviembre y diciembre · guardados + borradores")).toBeTruthy();
  });
});

describe("HZ-8 — grid-side rules keep using each column's own month spine", () => {
  it("a December column's rule context is December's Sundays inside a November + December horizon", () => {
    expect(ruleContextForTarget("sunday_role", "2026-12-13")?.sundayDates).toEqual(["2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27"]);
    expect(ruleContextForTarget("sunday_role", "2026-11-08")?.sundayDates[0]).toBe("2026-11-01");
  });
});

describe("ST-1 / ST-2 / ST-3 — «Guardado» columns", () => {
  const sunday = storedRole({ _id: "role-nov-01", _type: "sunday_role", date: "2026-11-01", leads: [seat("m-ana")] });

  it("a stored service of the horizon appears read-only as «Guardado», and no planned column is built for its target", () => {
    const { container } = renderV3({ roles: [sunday] });
    preview();
    const header = container.querySelector('[data-grid-column-id="role-nov-01"]')!;
    expect(within(header as HTMLElement).getByText("Guardado")).toBeTruthy();
    expect(container.querySelector('[data-grid-column-id="create:sunday_role__2026-11-01"]')).toBeNull();
  });

  it("ST-2: a stored special and a planned Sunday on one date render two columns with separate cells, and the confirm posts only the Sunday", () => {
    const special = storedRole({ _id: "role-sp-08", _type: "special_role", date: "2026-11-08", service_name: "Vigilia", countsForFairness: true, leads: [seat("m-bruno")] });
    const { container } = renderV3({ roles: [special] });
    deselectAll(container, "saturday");
    fireEvent.click(container.querySelector('[data-date="2026-11-01"]')!);
    fireEvent.click(container.querySelector('[data-date="2026-11-15"]')!);
    fireEvent.click(container.querySelector('[data-date="2026-11-22"]')!);
    fireEvent.click(container.querySelector('[data-date="2026-11-29"]')!);
    preview();
    expect(container.querySelector('[data-grid-column-id="role-sp-08"]')).not.toBeNull();
    expect(container.querySelector('[data-grid-column-id="create:sunday_role__2026-11-08"]')).not.toBeNull();
    const lead = (col: string) => container.querySelector(`[data-row-id="lead"][data-column-id="${col}"]`)!;
    expect(lead("role-sp-08").textContent).toContain("Bruno");
    expect(lead("create:sunday_role__2026-11-08").textContent).not.toContain("Bruno");
    expect(screen.getByRole("button", { name: /^Crear 1 borrador/ })).toBeTruthy();
  });

  it("ST-3: a «Guardado» cell opens no picker", () => {
    const { container } = renderV3({ roles: [sunday] });
    preview();
    fireEvent.click(container.querySelector('[data-row-id="lead"][data-column-id="role-nov-01"]')!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("under v2 the create grid shows no stored column", () => {
    const { container } = renderV3({ roles: [sunday], engine: "v2" });
    preview();
    expect(container.querySelector('[data-grid-column-id="role-nov-01"]')).toBeNull();
  });
});
```

- [ ] **Step 4: Run them to see them fail**

Run: `git add -A && npx vitest run app/components/admin/__tests__/v3Horizon.test.ts app/components/admin/__tests__/MonthGenerator.v3Horizon.test.tsx`
Expected: FAIL — no «Planear» radiogroup, no bands, no «Guardado».

- [ ] **Step 5: `PlannerGrid` — the month band, the «Guardado» header, the picker guard**

Find:
```ts
  /** Named on the full-screen bar, where the page's own month header is gone. */
  monthLabel?: string;
```
Replace with:
```ts
  /** Named on the full-screen bar, where the page's own month header is gone. */
  monthLabel?: string;
  /**
   * Solver v3 C6 HZ-5: one band per horizon month above the column headers, INSIDE the grid's own
   * horizontal scroller (ADR-0035), with a visible boundary at the second month's first column.
   * Columns arrive in date order, so each band's columns are contiguous. Omitted under v2.
   */
  monthBands?: ReadonlyArray<{ month: string; label: string; columnIds: readonly string[] }>;
```
Find:
```ts
    monthLabel,
```
(in the destructure of `props`) Replace with:
```ts
    monthLabel,
    monthBands,
```
Find:
```tsx
        <div className={`${labelMinW} ${stickyLabel}`} />
        {columns.map((column) => (
          <ColumnHeader
```
Replace with:
```tsx
        {monthBands && (
          <>
            <div className={`${labelMinW} ${stickyLabel}`} />
            {monthBands.map((band, i) => band.columnIds.length > 0 && (
              <div
                key={band.month}
                data-month-band={band.month}
                style={{ gridColumn: `span ${band.columnIds.length}` }}
                className={`px-1 pb-1 font-label text-[11px] uppercase tracking-widest text-accent ${i > 0 ? "border-l-2 border-accent/40" : ""}`}
              >
                {band.label}
              </div>
            ))}
          </>
        )}
        <div className={`${labelMinW} ${stickyLabel}`} />
        {columns.map((column) => (
          <ColumnHeader
            guardado={mode === "create" && "admission" in column}
```
Find:
```tsx
              if (mode === "stored" && column && "admission" in column && column.admission === "readOnly") return;
```
Replace with:
```tsx
              // C6 ST-3: in create mode a stored column («Guardado», v3) is never edited.
              if (column && "admission" in column && (mode === "create" || column.admission === "readOnly")) return;
```
In `ColumnHeader`, Find:
```ts
  fairness,
}: {
  column: GridColumn;
```
Replace with:
```ts
  fairness,
  guardado = false,
}: {
  /** C6 ST-1: a stored service shown read-only in the v3 create grid — date, type, name and «Guardado» only. */
  guardado?: boolean;
  column: GridColumn;
```
Find:
```tsx
  return (
    <div data-grid-column-id={column.columnId} className={`${minWClass} space-y-1 px-1 ${skipped || blockCopy ? "opacity-40" : ""}`}>
```
Replace with:
```tsx
  if (guardado) {
    return (
      <div data-grid-column-id={column.columnId} className={`${minWClass} space-y-1 px-1`}>
        <div className="flex items-center gap-1.5">
          <span className="font-display text-base leading-none">{day}</span>
          <span className="font-label text-xs uppercase tracking-widest text-mono-500">{month}</span>
        </div>
        <span className="font-label text-xs uppercase tracking-widest text-mono-500">{typeLabel}</span>
        {column.serviceName && (
          <span className={`block font-body text-[11px] text-ink-muted/80 ${CARD_STYLE.longText}`}>{column.serviceName}</span>
        )}
        <span data-guardado="" className="inline-block rounded-full border border-accent/30 px-1.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-accent">
          Guardado
        </span>
      </div>
    );
  }
  return (
    <div data-grid-column-id={column.columnId} className={`${minWClass} space-y-1 px-1 ${skipped || blockCopy ? "opacity-40" : ""}`}>
```

- [ ] **Step 6: `MonthGenerator` — the horizon state and its effect**

The imports (`normalizeServiceName` from `@/app/utils/normalizeLabel` and `type StoredGridTranslation` from `./storedRoleReadModel` are already imported — neither is imported a second time). Find:
```ts
} from "./storedRoleReadModel";
```
Replace with:
```ts
} from "./storedRoleReadModel";
import { horizonMonths, monthsEntering, participationMonthsOf, retainInHorizon, weekendDatesOfMonth, type HorizonLength } from "./v3Horizon";
import { monthNameCap, monthsList } from "./v3Copy";
```

Module level — Find:
```ts
function getDates(year: number, month: number, day: 0 | 6): string[] {
```
Replace with:
```ts
/** C6 ST-2: a service's target — a weekend type and date, or a special's date and normalized name (ADR-0011). */
function v3TargetOf(c: Pick<GridColumn, "type" | "date" | "serviceName">): string {
  return c.type === "special_role" ? `special_role|${c.date}|${normalizeServiceName(c.serviceName) ?? ""}` : `${c.type}|${c.date}`;
}

function getDates(year: number, month: number, day: 0 | 6): string[] {
```
Find:
```ts
  const [specials, setSpecials] = useState<{ date: string; name: string; countsForFairness: boolean }[]>([]);
```
Replace with:
```ts
  const [specials, setSpecials] = useState<{ date: string; name: string; countsForFairness: boolean }[]>([]);
  // Solver v3 C6 HZ-1/HZ-2 — the horizon: 1 or 2 consecutive months under v3; under v2 (and in the
  // stored editor) exactly the selected month, so every v2 derivation below is unchanged.
  const isV3 = engine === "v3";
  const [horizonLength, setHorizonLength] = useState<HorizonLength>(1);
  const firstMonth = `${year}-${String(month).padStart(2, "0")}`;
  const horizon = useMemo(
    () => horizonMonths(firstMonth, isV3 && !storedMode ? horizonLength : 1),
    [firstMonth, isV3, storedMode, horizonLength],
  );
  const previousHorizon = useRef<string[]>([]);
  const [participationChoice, setParticipationChoice] = useState<string>("both");
```
Find:
```ts
  useEffect(() => {
    setActiveSatDates(getDates(year, month, 6));
    setDeselectedSundays([]);
    setSpecials([]);
    setCreateCountsEdits(new Map());
  }, [year, month]);
```
Replace with:
```ts
  useEffect(() => {
    if (isV3 && !storedMode) {
      // HZ-2: a month that leaves the horizon drops its selections; a month that enters starts as a
      // month change starts today (its Saturdays selected, every Sunday selected, no specials).
      const entering = monthsEntering(previousHorizon.current, horizon);
      previousHorizon.current = horizon;
      setActiveSatDates((prev) => [...retainInHorizon(prev, horizon), ...entering.flatMap((m) => weekendDatesOfMonth(m).saturdays)]);
      setDeselectedSundays((prev) => retainInHorizon(prev, horizon));
      setSpecials((prev) => retainInHorizon(prev, horizon));
      setCreateCountsEdits((prev) => new Map([...prev].filter(([columnId]) => horizon.includes(columnId.slice(-10, -3)))));
      return;
    }
    setActiveSatDates(getDates(year, month, 6));
    setDeselectedSundays([]);
    setSpecials([]);
    setCreateCountsEdits(new Map());
  }, [year, month, isV3, storedMode, horizon]);
```
Find:
```ts
  const sundayDatesFull = useMemo(() => getDates(year, month, 0), [year, month]);
```
Replace with:
```ts
  const sundayDatesFull = useMemo(
    // Under v3 the horizon's own Sundays, month by month (HZ-3); v2 reads only the selected month.
    () => (isV3 && !storedMode ? horizon.flatMap((m) => weekendDatesOfMonth(m).sundays) : getDates(year, month, 0)),
    [isV3, storedMode, horizon, year, month],
  );
```
Gate the two v2-only previews (RQ-9: v2's builder never runs on the v3 path). Find:
```ts
    if (storedMode || !solverConfig) return undefined;
    const built = buildSolveRequest({
```
Replace with:
```ts
    if (storedMode || !solverConfig || isV3) return undefined;
    const built = buildSolveRequest({
```
Find:
```ts
    if (storedMode || !fillEmptyOnly || !solverConfig) return undefined;
```
Replace with:
```ts
    if (storedMode || !fillEmptyOnly || !solverConfig || isV3) return undefined;
```
and each of those two memos' dependency arrays gains `isV3`: Find `  }, [storedMode, solverConfig, members, sundayDatesFull, activeSatDates, year, month]);` → Replace with `  }, [storedMode, solverConfig, members, sundayDatesFull, activeSatDates, year, month, isV3]);`; Find `  }, [storedMode, fillEmptyOnly, solverConfig, cells, columns, rows, members, sundayDatesFull, requestSaturdayWeeks]);` → Replace with `  }, [storedMode, fillEmptyOnly, solverConfig, cells, columns, rows, members, sundayDatesFull, requestSaturdayWeeks, isV3]);`.

- [ ] **Step 7: `MonthGenerator` — «Guardado» columns from the stored editor's coherent read**

Find:
```ts
  const storedTranslations = useMemo(() => {
```
Replace with:
```ts
  // Solver v3 C6 ST-1: under v3, every stored service of a horizon month, from the SAME full-roster
  // read and the SAME coherence verdict the stored editor uses, shown read-only («Guardado»). A read
  // that is not ready or not coherent, or a horizon role whose translation is refused, is not ready:
  // Auto refuses on it (Task 15).
  const v3Stored = useMemo((): { ready: boolean; translations: StoredGridTranslation[] } => {
    if (!isV3 || storedMode) return { ready: true, translations: [] };
    const ready = storedSource?.rolesStatus === "ready" && storedSource?.integrityStatus === "ready" && storedInventory.coherent;
    if (!ready) return { ready: false, translations: [] };
    const translated = storedInventory.roles
      .filter((o) => horizon.includes(o.role.date.slice(0, 7)))
      .map(translateStoredRole);
    if (translated.some((t) => t === null)) return { ready: false, translations: [] };
    return {
      ready: true,
      translations: (translated as StoredGridTranslation[]).map((t) => ({ ...t, column: { ...t.column, admission: "readOnly" as const } })),
    };
  }, [isV3, storedMode, storedSource?.rolesStatus, storedSource?.integrityStatus, storedInventory, horizon]);
  const v3StoredIds = useMemo(() => new Set(v3Stored.translations.map((t) => t.column.columnId)), [v3Stored]);
  const v3StoredTargets = useMemo(() => new Set(v3Stored.translations.map((t) => v3TargetOf(t.column))), [v3Stored]);
  const storedTranslations = useMemo(() => {
```
Find:
```ts
    : createColumns;
```
Replace with:
```ts
    : plannedCreateColumns;
  /** HZ-5, ST-1: what the v3 create grid shows — planned columns and the «Guardado» ones, by date. */
  const v3GridColumns: GridColumn[] = isV3 && !storedMode
    ? [...columns, ...v3Stored.translations.map((t) => t.column)]
        .sort((a, b) => a.date.localeCompare(b.date) || a.columnId.localeCompare(b.columnId))
    : columns;
  const v3StoredCells = v3Stored.translations.flatMap((t) => t.cells);
  const monthBands = isV3 && !storedMode && horizon.length === 2
    ? horizon.map((m) => ({ month: m, label: monthNameCap(m), columnIds: v3GridColumns.filter((c) => c.date.slice(0, 7) === m).map((c) => c.columnId) }))
    : undefined;
```
and immediately before `  const columns = storedMode`, insert:
```ts
  // ST-2: under v3 a planned column is never built for a target a stored service occupies; the
  // stored service shows as its own «Guardado» column instead, keyed by its document `_id`.
  const plannedCreateColumns = isV3 && !storedMode
    ? createColumns.filter((c) => !v3StoredTargets.has(v3TargetOf(c)))
    : createColumns;
```

- [ ] **Step 8: `MonthGenerator` — the config step (HZ-1, HZ-4)**

Find:
```tsx
          <YearInput className={inCls} value={year} onChange={setYear} />
        </div>
      </div>
```
Replace with:
```tsx
          <YearInput className={inCls} value={year} onChange={setYear} />
        </div>
      </div>

      {isV3 && (
        <SegmentedControl
          label="Planear"
          value={horizonLength === 2 ? "2" : "1"}
          onChange={(v) => setHorizonLength(v === "2" ? 2 : 1)}
          options={[{ value: "1", label: "1 mes" }, { value: "2", label: "2 meses" }]}
        />
      )}
```
Find:
```tsx
      <MonthCalendar
        key={`${year}-${month}`}
        year={year}
        month={month}
```
Replace with:
```tsx
      {/* HZ-4: one calendar per horizon month, stacked, each keyed by its month (v2: exactly one). */}
      {horizon.map((calendarMonth) => (
      <MonthCalendar
        key={calendarMonth}
        year={Number(calendarMonth.slice(0, 4))}
        month={Number(calendarMonth.slice(5, 7))}
```
Find (the calendar's closing, followed by the next comment):
```tsx
      />

      {/*
        D13: the `useSolver` toggle is retired
```
Replace with:
```tsx
      />
      ))}

      {/*
        D13: the `useSolver` toggle is retired
```

- [ ] **Step 9: `MonthGenerator` — the sidebar's scope (HZ-6) and the grid mount (HZ-5, ST-1, ST-3)**

Find:
```ts
  const participationSaved = useMemo(() => {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    return (allRoles ?? []).filter(r => r.date.slice(0, 7) === prefix);
  }, [allRoles, year, month]);
```
Replace with:
```ts
  // HZ-6: under v3 the sidebar counts the months the admin picks («Ambos» by default); v2: the month.
  const participationMonths = isV3 && !storedMode ? participationMonthsOf(horizon, participationChoice) : [firstMonth];
  const participationKey = participationMonths.join(",");
  const participationSaved = useMemo(() => {
    const months = participationKey.split(",");
    return (allRoles ?? []).filter(r => months.includes(r.date.slice(0, 7)));
  }, [allRoles, participationKey]);
```
Find:
```ts
    creatableColumns: storedMode ? columns : creatableColumns,
```
Replace with:
```ts
    creatableColumns: storedMode ? columns : creatableColumns.filter((c) => participationMonths.includes(c.date.slice(0, 7))),
```
In the `<PlannerGrid` mount — Find `          columns={columns}` → Replace with `          columns={v3GridColumns}`; Find `          cells={cells}` (the line right after it) → Replace with `          cells={isV3 && !storedMode ? [...cells, ...v3StoredCells] : cells}`; Find `          onCellsChange={handleCellsChange}` → Replace with:
```tsx
          // ST-3: a «Guardado» column's cells never enter the board's state.
          onCellsChange={(next) => handleCellsChange(isV3 ? next.filter((c) => !v3StoredIds.has(c.columnId)) : next)}
          monthBands={monthBands}
```
Find `          pinConflicts={pinBoard}` → Replace with `          pinConflicts={isV3 ? undefined : pinBoard}`.
Find:
```tsx
            <ParticipationSidebar
              roles={participationRoles}
```
Replace with:
```tsx
            <div className="space-y-2">
            {isV3 && !storedMode && horizon.length === 2 && (
              <SegmentedControl
                label="Cuenta"
                size="sm"
                value={horizon.includes(participationChoice) ? participationChoice : "both"}
                onChange={setParticipationChoice}
                options={[...horizon.map((m) => ({ value: m, label: monthNameCap(m) })), { value: "both", label: "Ambos" }]}
              />
            )}
            <ParticipationSidebar
              roles={participationRoles}
```
Find (the sidebar's month label in that same mount):
```tsx
              monthLabel={`${MONTHS[month - 1]} ${year} · guardados + borradores`}
            />
          }
```
Replace with:
```tsx
              monthLabel={isV3 && !storedMode
                ? `${monthsList(participationMonths, true)} · guardados + borradores`
                : `${MONTHS[month - 1]} ${year} · guardados + borradores`}
            />
            </div>
          }
```

- [ ] **Step 10: `ServicesPanel` — the create mount gets the stored read**

In the create mount, Find:
```tsx
            preflight={preflightTarget}
```
Replace with:
```tsx
            preflight={preflightTarget}
            // Solver v3 C6 ST-1: under v3 the create grid shows the horizon's stored services read-only,
            // from the same roles + integrity read (and coherence verdict) the stored editor uses.
            storedSource={{
              roles,
              integrity: summaries.roles,
              rolesStatus: sourceRecords.roles.status,
              integrityStatus: sourceRecords.roleTargets.status,
              rolesGeneration: sourceRecords.roles.generation,
              integrityGeneration: sourceRecords.roleTargets.generation,
              reload: async () => (await loadSources(["roles", "roleTargets"])).length === 0,
            }}
```

- [ ] **Step 11: Run the tests, the planner suites and the gates**

Run: `git add -A && npx vitest run app/components/admin/__tests__/v3Horizon.test.ts app/components/admin/__tests__/MonthGenerator.v3Horizon.test.tsx app/components/admin/__tests__/MonthGenerator.create.test.tsx app/components/admin/__tests__/MonthCalendar.test.tsx app/components/admin/__tests__/trailingSaturday.wiring.test.tsx app/components/admin/__tests__/MonthGenerator.stored.test.tsx`
Expected: PASS — the v2 suites unedited (the horizon is the selected month under v2; the stored editor ignores `isV3`).
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(planner): plan one or two months under v3, with stored services shown read-only

Under the v3 engine the planner offers «Planear: 1 mes · 2 meses»: one calendar per month, one
grid whose columns span the horizon with a month band inside its own scroller, and a sidebar that
says which months it counts. Stored services of the horizon appear as read-only «Guardado»
columns from the stored editor's own coherent read, keyed by document id, and no planned column
is built for a target they occupy. Under v2 the horizon is the selected month and nothing changes."
```

---

## Task 15: Auto under v3 in the planner — the run, its report, «Reintentar», and the one v2 409 branch (AD-1, AD-5–AD-8, NT-1–NT-5, SP-4, SP-5, RQ-9, KH-3's display) — [standard]

**Files:**
- Create: `app/components/admin/V3RunPanel.tsx`
- Modify: `app/components/admin/PlannerGrid.tsx` — `AutoState.retry`, props `v3Report`, `autoConfirmText`, `unfilled[].reason`; the error line, the confirm sentence, the diagnostics slot, the unfilled marker
- Modify: `app/components/admin/MonthGenerator.tsx` — `handleAuto` (`:4046-4086`), new `handleAutoV3`/`applyV3AutoResult` (before `handleAutoDerived`, `:4101`), `applySpecialFill` (`:3740-3797`), `runSolve`'s status chain (`:3929-3935`), `autoState` (`:4407`), the `<PlannerGrid` mount
- Modify (append): `app/components/admin/__tests__/v3PlannerHarness.tsx` (`echoV3`, `solveRoute`)
- Create (test): `app/components/admin/__tests__/MonthGenerator.v3Auto.test.tsx`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: Task 13 `runV3Auto`, `V3AutoResult`; Task 11 `buildV3SolveRequest`, `preReadRefusals`; Task 12 `applyV3Assignments`, `v3OutcomeLine`, `v3RetryOffered`, `buildV3RunReport`, `v3Names`, `V3RunReport`; Task 5 `renderRuleRefTable`; Task 4 `V3_ROUTE_COPY`, `V3_LINES`, `transportLine`; Task 3 `cdmxCurrentMonth`; Task 14's `isV3`, `horizon`, `v3Stored`, `columns`; `newCreationRequestId` (`monthDraftCreate.ts`).
- Produces: `AutoState.retry?: () => void`; `PlannerGridProps.v3Report?: ReactNode`, `PlannerGridProps.autoConfirmText?: string`, `PlannerGridProps.unfilled: { columnId: string; rowId: string; reason?: string }[]`; `V3RunPanel({ report, requestId, ruleTable }: { report: V3RunReport; requestId: string; ruleTable: string })`; inside `MonthGenerator`: `v3Run: { build; response; report; names; horizonKey } | null` (read by Tasks 16 and 19); `applySpecialFill(config, baseCells, solverUnfilled?, fillEmpty?, skipSpecialIds?)`.

- [ ] **Step 1: Extend the harness** — append to `app/components/admin/__tests__/v3PlannerHarness.tsx`

```tsx

import type { V3SolveRequest, V3Success } from "../v3Wire";

/** A v3 solver that seats every pin and, on each planned service, the first person eligible for Lead. */
export function echoV3(request: V3SolveRequest): V3Success {
  const assignments: V3Success["assignments"] = {};
  for (const s of request.services) {
    const pinned = request.pins.filter((p) => p.service === s.id);
    const byRole = { Lead: pinned.filter((p) => p.role === "Lead").map((p) => p.person), BGV: pinned.filter((p) => p.role === "BGV").map((p) => p.person), Choir: pinned.filter((p) => p.role === "Choir").map((p) => p.person) };
    if (!s.fixed && byRole.Lead.length === 0) {
      const lead = request.people.find((p) => (p.eligibility[s.id] ?? []).includes("Lead"));
      if (lead) byRole.Lead.push(lead.id);
    }
    assignments[s.id] = s.kind === "saturday" && !s.fixed ? { Lead: byRole.Lead, BGV: byRole.BGV } : byRole;
  }
  return {
    ok: true, contract: 3, engine: "v3", solver_version: "3.0.0", build: "test", request_id: request.request_id, seed: request.seed,
    months: request.months, reproducible: true, assignments, unfilled: [],
    pins: { requested: request.pins.length, honored: request.pins.length }, violations: [], violation_ceiling: { value: 0, proven: true },
    stages: [{ id: "rules", status: "proven", value: 0, bound: 0, limit: "none", ms: 1, det_milli: 1 }], total_ms: 5,
    fairness: { scale: 100, tolerance: 35, lines: [], people: [] }, cadence: [], missed: [], notices: [],
  };
}

/** A route for `POST /api/admin/solve` that records each v3 request and answers `respond(request, n)`. */
export function solveRoute(respond: (request: V3SolveRequest, n: number) => { status: number; body: unknown }) {
  const requests: V3SolveRequest[] = [];
  const route = (url: string, init?: RequestInit) => {
    if (url !== "/api/admin/solve") return undefined;
    const request = JSON.parse(String(init?.body ?? "{}")) as V3SolveRequest;
    requests.push(request);
    return respond(request, requests.length);
  };
  return { route, requests };
}
```

- [ ] **Step 2: Write the failing component test** — `app/components/admin/__tests__/MonthGenerator.v3Auto.test.tsx`

```tsx
/** @vitest-environment jsdom */
// Solver v3 C6 — Auto under the v3 engine prop, end to end through MonthGenerator with a routed
// fetch: the fresh ledger read, the contract-3 request, apply by service id, the run report and
// «Ver etapas» with KH-3's table; «Reintentar» exactly where AD-6 allows it; specials at every exit;
// v2's parsers never reached under v3 and v3's never under v2; and v2's one new 409 branch.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({ applySolveResponse: vi.fn(), solverRefusalMessage: vi.fn(), buildSolveRequest: vi.fn(), classifyV3Answer: vi.fn(), applyV3Assignments: vi.fn() }));
vi.mock("../plannerModel", async (importOriginal) => {
  const real = await importOriginal<typeof import("../plannerModel")>();
  spies.applySolveResponse.mockImplementation(real.applySolveResponse);
  spies.solverRefusalMessage.mockImplementation(real.solverRefusalMessage);
  spies.buildSolveRequest.mockImplementation(real.buildSolveRequest);
  return {
    ...real,
    applySolveResponse: (...a: Parameters<typeof real.applySolveResponse>) => spies.applySolveResponse(...a),
    solverRefusalMessage: (...a: Parameters<typeof real.solverRefusalMessage>) => spies.solverRefusalMessage(...a),
    buildSolveRequest: (...a: Parameters<typeof real.buildSolveRequest>) => spies.buildSolveRequest(...a),
  };
});
vi.mock("../v3SolveResponse", async (importOriginal) => {
  const real = await importOriginal<typeof import("../v3SolveResponse")>();
  spies.classifyV3Answer.mockImplementation(real.classifyV3Answer);
  spies.applyV3Assignments.mockImplementation(real.applyV3Assignments);
  return {
    ...real,
    classifyV3Answer: (...a: Parameters<typeof real.classifyV3Answer>) => spies.classifyV3Answer(...a),
    applyV3Assignments: (...a: Parameters<typeof real.applyV3Assignments>) => spies.applyV3Assignments(...a),
  };
});

import { echoV3, renderV3, routeFetch, seat, solveRoute, storedRole } from "./v3PlannerHarness";
import { deselectAll } from "./plannerWiringHarness";
import { NAME_SHAPED_KEYS, config, ledgerResponse } from "./v3Fixtures";
import { V3_ROUTE_COPY } from "../v3Copy";

const POOLS = config({ sundayLeads: ["m-ana", "m-bruno"], support: ["m-dani"] });
const ledgerRoute = (status = 200, body: unknown = ledgerResponse(["2026-11"])) =>
  (url: string) => (url.startsWith("/api/admin/fairness?") ? { status, body } : undefined);
const historyRoute = (url: string) => (url.startsWith("/api/admin/solver-history?") ? { status: 500, body: {} } : undefined);
const rolesRoute = (url: string, init?: RequestInit) => (url === "/api/admin/roles" && init?.method === "POST" ? { status: 201, body: {} } : undefined);

let consoleCalls: string[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:00:00.000Z"));
  consoleCalls = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { consoleCalls.push(a.map(String).join(" ")); });
  }
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
const runAuto = () => {
  fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
};

describe("a v3 run, end to end", () => {
  it("reads the ledger fresh, posts a contract-3 request, applies by service id and reports the run", async () => {
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const { calls } = routeFetch(ledgerRoute(), historyRoute, solve.route);
    const { container } = renderV3({ config: POOLS });
    deselectAll(container, "saturday");
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    const fairnessReads = calls.filter((c) => c.url.startsWith("/api/admin/fairness?"));
    expect(fairnessReads.at(-1)!.url).toBe("/api/admin/fairness?month=2026-11&horizon=1");
    expect(solve.requests[0]).toMatchObject({ contract: 3, months: ["2026-11"] });
    expect(solve.requests[0]).not.toHaveProperty("weeks");
    await waitFor(() => expect(container.querySelector('[data-row-id="lead"][data-column-id="create:sunday_role__2026-11-01"]')!.textContent).toContain("Ana"));
    expect(screen.getByText(/^Plan de 1 mes: noviembre · 5 servicios \(0 guardados/)).toBeTruthy();
    expect(screen.getByText("Todas las etapas quedaron probadas.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver etapas" }));
    expect(container.querySelector("[data-v3-rule-table]")!.textContent!.startsWith(`request_id ${solve.requests[0].request_id}`)).toBe(true);
    expect(spies.buildSolveRequest).not.toHaveBeenCalled();                 // RQ-9
    expect(spies.applySolveResponse).not.toHaveBeenCalled();                // AD-1
    expect(spies.solverRefusalMessage).not.toHaveBeenCalled();
    for (const v2Line of ["Sin optimizar", "Equidad relajada", "Historial"]) expect(screen.queryByText(new RegExp(v2Line))).toBeNull(); // NT-5
    for (const call of consoleCalls) for (const key of NAME_SHAPED_KEYS) expect(call).not.toContain(key);
  });

  it("ST-3: a «Guardado» column's cells are byte-identical after Auto", async () => {
    const stored = storedRole({ _id: "role-nov-08", _type: "sunday_role", date: "2026-11-08", leads: [seat("m-bruno")] });
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    routeFetch(ledgerRoute(), historyRoute, solve.route);
    const { container } = renderV3({ config: POOLS, roles: [stored] });
    preview();
    const before = container.querySelector('[data-row-id="lead"][data-column-id="role-nov-08"]')!.textContent;
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    expect(solve.requests[0].services.find((s) => s.id === "role-nov-08")).toMatchObject({ fixed: true });
    expect(solve.requests[0].pins).toContainEqual({ service: "role-nov-08", date: "2026-11-08", role: "Lead", person: "m-bruno" });
    await waitFor(() => expect(screen.getByText(/^Plan de 1 mes/)).toBeTruthy());
    expect(container.querySelector('[data-row-id="lead"][data-column-id="role-nov-08"]')!.textContent).toBe(before);
  });
});

describe("refusals before the fetch", () => {
  // Only what Auto itself fetches counts here (a display read of the ledger may have run on render).
  const fetchedAfter = (calls: Array<{ url: string }>, from: number) =>
    calls.slice(from).filter((c) => c.url === "/api/admin/solve" || c.url.startsWith("/api/admin/fairness?"));

  it("HZ-7: a past month refuses before any read", async () => {
    const { calls } = routeFetch(ledgerRoute(), historyRoute);
    renderV3({ config: POOLS, initialMonth: "2026-09" });
    preview();
    const from = calls.length;
    runAuto();
    await waitFor(() => expect(screen.getByText("Auto no planea meses que ya pasaron. Crea esos servicios a mano.")).toBeTruthy());
    expect(fetchedAfter(calls, from)).toEqual([]);
  });

  it("ST-1: a stored read that is not ready refuses before any read (SP-5's line is runV3Auto's, unit-tested)", async () => {
    const { calls } = routeFetch(ledgerRoute(), historyRoute);
    renderV3({ config: POOLS, storedStatus: "loading" });
    preview();
    const from = calls.length;
    runAuto();
    await waitFor(() => expect(screen.getByText(/^No se pudieron leer los servicios guardados de noviembre/)).toBeTruthy());
    expect(fetchedAfter(calls, from)).toEqual([]);
  });

  it("RQ-1: a failed ledger read refuses and sends no request", async () => {
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    routeFetch(ledgerRoute(500, { error: "fairness_unavailable", message: "No se pudo leer el saldo de equidad." }), historyRoute, solve.route);
    renderV3({ config: POOLS });
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.ledgerFailed)).toBeTruthy());
    expect(solve.requests).toHaveLength(0);
  });
});

describe("AD-3 / AD-6 — outcomes and «Reintentar»", () => {
  // Auto's «Reintentar» is the button PlannerGrid renders right after Auto's error line. Until
  // Task 16 hides v2's history surfaces under v3, the failed history read on the grid step offers
  // its own «Reintentar», so a page-wide query would find two.
  const autoRetryButton = (line: string) => {
    const next = screen.getByText(line).nextElementSibling;
    return next instanceof HTMLButtonElement && next.textContent === "Reintentar" ? next : null;
  };

  it("a timeout code shows the timeout copy and «Reintentar», which runs again", async () => {
    const solve = solveRoute((_r, n) => n === 1
      ? { status: 422, body: { ok: false, contract: 3, engine: "v3", code: "timeout", params: { stage: "fill", seconds: 25 } } }
      : { status: 200, body: echoV3(_r) });
    routeFetch(ledgerRoute(), historyRoute, solve.route);
    renderV3({ config: POOLS });
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.timeout)).toBeTruthy());
    await act(async () => { fireEvent.click(autoRetryButton(V3_ROUTE_COPY.timeout)!); });
    await waitFor(() => expect(solve.requests).toHaveLength(2));
  });

  it("a configuration transport offers no «Reintentar»", async () => {
    const solve = solveRoute(() => ({ status: 422, body: { ok: false, transport_error: true, transport: "not_configured" } }));
    routeFetch(ledgerRoute(), historyRoute, solve.route);
    renderV3({ config: POOLS });
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.configuration("not_configured"))).toBeTruthy());
    expect(autoRetryButton(V3_ROUTE_COPY.configuration("not_configured"))).toBeNull();
  });

  it("a v2-shaped answer under v3 is a configuration transport; v2's parsers are never called", async () => {
    const solve = solveRoute(() => ({ status: 200, body: { ok: true, schedule: {} } }));
    routeFetch(ledgerRoute(), historyRoute, solve.route);
    renderV3({ config: POOLS });
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.configuration("contract_echo"))).toBeTruthy());
    expect(spies.applySolveResponse).not.toHaveBeenCalled();
    expect(spies.solverRefusalMessage).not.toHaveBeenCalled();
  });
});

describe("SP-4 / AD-7 / SP-5 — specials at every exit; ST-9 — Auto's confirm sentence", () => {
  it("on a refusal an uncounted special is still filled by today's filler and a counted one is left as it is", async () => {
    routeFetch(historyRoute, ledgerRoute(500, { error: "fairness_unavailable" }));
    const { container } = renderV3({ config: POOLS });
    const addSpecial = (date: string, name: string, counted: boolean) => {
      fireEvent.click(container.querySelector(`[data-date="${date}"]`)!);
      fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: name } });
      if (counted) fireEvent.click(screen.getByRole("switch", { name: "Cuenta para equidad" }));
      fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    };
    addSpecial("2026-11-11", "Ensayo", false);
    addSpecial("2026-11-18", "Vigilia", true);
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.ledgerFailed)).toBeTruthy());
    expect(screen.getByText("Los especiales que cuentan para equidad no se llenaron porque Auto no corrió.")).toBeTruthy();
    const lead = (date: string) => container.querySelector(`[data-row-id="lead"][data-date="${date}"]`)!.textContent ?? "";
    expect(lead("2026-11-11")).toMatch(/Ana|Bruno|Dani/);
    expect(lead("2026-11-18")).not.toMatch(/Ana|Bruno|Dani/);
  });

  it("ST-9: the confirm sentence names the horizon's months and says stored services are not touched", () => {
    routeFetch(historyRoute);
    renderV3({ config: POOLS });
    preview();
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
    expect(screen.getByText("Esto reemplazará toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en noviembre. Los servicios guardados no se tocan.")).toBeTruthy();
  });
});

describe("under v2", () => {
  const v2SolveRoute = (status: number, body: unknown) => {
    const bodies: unknown[] = [];
    return { bodies, route: (url: string, init?: RequestInit) => {
      if (url !== "/api/admin/solve") return undefined;
      bodies.push(JSON.parse(String(init?.body)));
      return { status, body };
    } };
  };

  it("AD-8: a 409 shows the reload copy, never «sin solución», never the trailing retry; specials still fill", async () => {
    const solve = v2SolveRoute(409, { ok: false, error: "solver_version_mismatch", engine: "v3" });
    routeFetch(historyRoute, solve.route, rolesRoute);
    renderV3({ config: POOLS, engine: "v2", initialMonth: "2026-10" });
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.versionMismatch)).toBeTruthy());
    expect(solve.bodies).toHaveLength(1);
    expect(spies.classifyV3Answer).not.toHaveBeenCalled();                  // AD-1, the reverse
    expect(spies.applyV3Assignments).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `git add -A && npx vitest run app/components/admin/__tests__/MonthGenerator.v3Auto.test.tsx`
Expected: FAIL — Auto under v3 still posts a v2 request; no run report.

- [ ] **Step 4: Write the run panel** — Create `app/components/admin/V3RunPanel.tsx`

```tsx
"use client";

// Solver v3 C6 NT-1 and KH-3 — the run line, the stage summary, and «Ver etapas»: every stage with
// «probado» / «no probado» / «no ejecutado», then the run's rule reference table (wire id, kind,
// config ordinal — name-free by construction) as one copyable block headed by its `request_id`.
// The table is shown here and nowhere else; it is never sent, logged or stored.

import { useId, useState } from "react";
import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import { V3_LINES } from "./v3Copy";
import type { V3RunReport } from "./v3RunReport";

export default function V3RunPanel({ report, ruleTable }: { report: V3RunReport; requestId: string; ruleTable: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div data-v3-run="" className="space-y-1">
      <p className="font-body text-xs text-ink-muted">{report.runLine}</p>
      {report.stageSummary.map((line, i) => (
        <p key={i} className="font-body text-xs text-warning-strong">{line}</p>
      ))}
      <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {V3_LINES.seeStages}
      </Button>
      <Collapse open={open} id={id}>
        <ul className="space-y-0.5 pt-1">
          {report.stageDetail.map((s, i) => (
            <li key={i} className="font-body text-xs text-ink-muted">{s.label}: {s.status}</li>
          ))}
        </ul>
        <p className="pt-2 font-label text-[10px] uppercase tracking-widest text-mono-500">{V3_LINES.ruleTableTitle}</p>
        <pre data-v3-rule-table="" className="max-w-full overflow-x-auto rounded border border-accent/15 p-2 font-mono text-[11px] text-ink-muted">
          {ruleTable}
        </pre>
      </Collapse>
    </div>
  );
}
```

- [ ] **Step 5: `PlannerGrid` — retry, report slot, v3 confirm sentence, unfilled reasons**

(`Button` is already imported by `PlannerGrid`.) Find:
```ts
  notices?: string[];
  disabledReason: string | null;
}
```
Replace with:
```ts
  notices?: string[];
  disabledReason: string | null;
  /** Solver v3 C6 AD-6: «Reintentar» beside the error, only where a retry can heal it. v2 never sets it. */
  retry?: () => void;
}
```
Find:
```ts
  /** `mapUnfilledSeats` output. */
  unfilled: { columnId: string; rowId: string }[];
```
Replace with:
```ts
  /** `mapUnfilledSeats` output, or (v3) the adapter's markers with their reason's copy (AD-5). */
  unfilled: { columnId: string; rowId: string; reason?: string }[];
  /** Solver v3 C6 NT-1: the run panel, in place of v2's diagnostics strip (NT-5). */
  v3Report?: ReactNode;
  /** Solver v3 C6 ST-9: replaces the v2 confirm sentence when «Solo llenar vacíos» is off. */
  autoConfirmText?: string;
```
The `props` destructure gains `v3Report` and `autoConfirmText` after `monthBands`: Find `    monthBands,` → Replace with `    monthBands,\n    v3Report,\n    autoConfirmText,`.
Find:
```tsx
        {mode === "create" && autoState.error && <p className="font-body text-xs text-negative-fg">{autoState.error}</p>}
```
Replace with:
```tsx
        {mode === "create" && autoState.error && <p className="font-body text-xs text-negative-fg">{autoState.error}</p>}
        {mode === "create" && autoState.error && autoState.retry && (
          <Button variant="secondary" size="sm" onClick={autoState.retry}>Reintentar</Button>
        )}
```
Find:
```tsx
              : "Esto reemplazará toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en este mes. Las asignaciones manuales de instrumentos y FOH no se tocan."}
```
Replace with:
```tsx
              : (autoConfirmText ?? "Esto reemplazará toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en este mes. Las asignaciones manuales de instrumentos y FOH no se tocan.")}
```
Find:
```tsx
      {unresolvedNames.length > 0 && (
```
Replace with:
```tsx
      {mode === "create" && v3Report}

      {unresolvedNames.length > 0 && (
```
The unfilled reason, through to the cell. Find:
```ts
  const unfilledByKey = useMemo(() => {
```
Replace with:
```ts
  const unfilledReasonByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of unfilled) if (u.reason && !m.has(cellKey(u.columnId, u.rowId))) m.set(cellKey(u.columnId, u.rowId), u.reason);
    return m;
  }, [unfilled]);

  const unfilledByKey = useMemo(() => {
```
Find (the `RowGroup` mount):
```tsx
            unfilledByKey={unfilledByKey}
```
Replace with:
```tsx
            unfilledByKey={unfilledByKey}
            unfilledReasonByKey={unfilledReasonByKey}
```
In `RowGroup`'s destructure, Find `  unfilledByKey,` → Replace with `  unfilledByKey,\n  unfilledReasonByKey,`; in its props type, Find `  unfilledByKey: Set<string>;` → Replace with `  unfilledByKey: Set<string>;\n  unfilledReasonByKey?: ReadonlyMap<string, string>;`. In the `GridCellView` mount, Find:
```tsx
            unfilled={unfilledByKey.has(cellKey(column.columnId, row.id))}
```
Replace with:
```tsx
            unfilled={unfilledByKey.has(cellKey(column.columnId, row.id))}
            unfilledReason={unfilledReasonByKey?.get(cellKey(column.columnId, row.id)) ?? null}
```
In `GridCellView`'s destructure, Find `  unfilled,` (the one after `function GridCellView({`) → Replace with `  unfilled,\n  unfilledReason = null,`; in its props type, Find `  unfilled: boolean;` → Replace with `  unfilled: boolean;\n  unfilledReason?: string | null;`. Find:
```tsx
          <p className="font-label text-[9px] uppercase tracking-widest text-warning-strong">Sin cubrir</p>
        )}
```
Replace with:
```tsx
          <p className="font-label text-[9px] uppercase tracking-widest text-warning-strong">Sin cubrir</p>
        )}
        {unfilled && unfilledReason && (
          <p className={`font-body text-[9px] text-warning-strong ${CARD_STYLE.longText}`}>{unfilledReason}</p>
        )}
```

- [ ] **Step 6: `MonthGenerator` — the v3 run**

The imports — Task 14's `./v3Horizon` line gains `cdmxCurrentMonth`, its `./v3Copy` line gains `V3_LINES, V3_ROUTE_COPY, transportLine, type V3Names`, and seven imports follow them. Find:
```ts
import { horizonMonths, monthsEntering, participationMonthsOf, retainInHorizon, weekendDatesOfMonth, type HorizonLength } from "./v3Horizon";
import { monthNameCap, monthsList } from "./v3Copy";
```
Replace with:
```ts
import { cdmxCurrentMonth, horizonMonths, monthsEntering, participationMonthsOf, retainInHorizon, weekendDatesOfMonth, type HorizonLength } from "./v3Horizon";
import { monthNameCap, monthsList, V3_LINES, V3_ROUTE_COPY, transportLine, type V3Names } from "./v3Copy";
import { runV3Auto, type V3AutoResult } from "./v3AutoRun";
import { buildV3SolveRequest, preReadRefusals } from "./v3SolveRequest";
import { applyV3Assignments, v3OutcomeLine, v3RetryOffered } from "./v3SolveResponse";
import { buildV3RunReport, v3Names, type V3RunReport } from "./v3RunReport";
import { renderRuleRefTable } from "./v3RuleIds";
import V3RunPanel from "./V3RunPanel";
import type { V3Success } from "./v3Wire";
```

Find:
```ts
  const previousHorizon = useRef<string[]>([]);
```
Replace with:
```ts
  const previousHorizon = useRef<string[]>([]);
  // C6 RQ-1: a v3 Auto solves nothing if the horizon changed during its read.
  const horizonKeyRef = useRef("");
  useLayoutEffect(() => { horizonKeyRef.current = horizon.join(","); });
  // The last v3 run of THIS horizon (EQ-3/EQ-4 read it; a horizon change makes it stale).
  const [v3Run, setV3Run] = useState<{
    build: Extract<ReturnType<typeof buildV3SolveRequest>, { ok: true }>;
    response: V3Success;
    report: V3RunReport;
    names: V3Names;
    horizonKey: string;
  } | null>(null);
  const [autoRetry, setAutoRetry] = useState<(() => void) | null>(null);
```
`applySpecialFill` — Find:
```ts
    solverUnfilled?: { columnId: string; rowId: string }[],
    fillEmpty = false,
  ) {
```
Replace with:
```ts
    solverUnfilled?: { columnId: string; rowId: string; reason?: string }[],
    fillEmpty = false,
    // C6 SP-4/SP-5: under v3, counted specials are the pre-fill's (filled before the solve, or left
    // as they are on a refusal) — today's filler never touches them. v2 passes nothing.
    skipSpecialIds?: ReadonlySet<string>,
  ) {
```
Find:
```ts
    for (const column of columns) {
      if (column.type !== "special_role") continue;
```
Replace with:
```ts
    for (const column of columns) {
      if (column.type !== "special_role" || skipSpecialIds?.has(column.columnId)) continue;
```
`handleAuto` — Find:
```ts
    if (SOLVER_HISTORY_SOURCE === "derived") {
      await handleAutoDerived();
      return;
    }
```
Replace with:
```ts
    // Solver v3 C6 AD-1: dispatch on the server-resolved engine BEFORE anything is read or built;
    // under v3 no v2 builder, parser or retry is reachable.
    if (isV3) {
      await handleAutoV3(config);
      return;
    }
    if (SOLVER_HISTORY_SOURCE === "derived") {
      await handleAutoDerived();
      return;
    }
```
Find:
```ts
  async function handleAutoDerived() {
```
Replace with:
```ts
  /** C6 SP-4: the planned counted specials, which today's after-solve filler leaves to the pre-fill. */
  function countedSpecialIds(): Set<string> {
    return new Set(columns.filter((c) => c.type === "special_role" && c.countsForFairness).map((c) => c.columnId));
  }

  /** The planned columns that will exist: not skipped and creatable (RQ-3) — never a «Guardado» one. */
  function v3PlannedColumns(): GridColumn[] {
    return columns.filter((c) => {
      if (skippedColumnIds.has(c.columnId)) return false;
      const draft = draftByTarget.get(draftTargetKey(c.type, c.date));
      return !draft || isCreatable(draft);
    });
  }

  async function handleAutoV3(config: SolverConfig) {
    const requested = horizon.join(",");
    const months = [...horizon];
    setAutoPending(true);
    setAutoError(null);
    setAutoNotices([]);
    setAutoRetry(null);
    setDiagnostics(null);
    try {
      const currentMonth = cdmxCurrentMonth(new Date());
      const result = await runV3Auto({
        months,
        preRead: () => preReadRefusals({ months, currentMonth, config, members }),
        storedReady: () => v3Stored.ready,
        specialsWaiting: countedSpecialIds().size > 0,
        readLedger: async (signal) => {
          const res = await fetch(`/api/admin/fairness?month=${months[0]}&horizon=${months.length}`, { cache: "no-store", signal });
          return { status: res.status, body: await res.json().catch(() => null) };
        },
        isCurrent: () => horizonKeyRef.current === requested,
        build: (ledger) => buildV3SolveRequest({
          months, currentMonth, ledger, config, members,
          storedRoles: storedSource?.roles ?? [],
          planned: { columns: v3PlannedColumns(), cells, rows },
          savedWindow, fillEmpty: fillEmptyOnly,
          seed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147483648,
          requestId: newCreationRequestId(),
        }),
        postSolve: async (request, signal) => {
          const res = await fetch("/api/admin/solve", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal,
          });
          return { status: res.status, text: await res.text() };
        },
      });
      applyV3AutoResult(config, result, requested);
    } catch {
      setAutoError(V3_ROUTE_COPY.connection);
      applySpecialFill(config, cells, undefined, fillEmptyOnly, countedSpecialIds());
    } finally {
      setAutoPending(false);
    }
  }

  /** Every exit fills uncounted specials and instruments as today (AD-7); counted specials are the pre-fill's. */
  function applyV3AutoResult(config: SolverConfig, result: V3AutoResult, horizonKey: string) {
    const skip = countedSpecialIds();
    if (result.kind === "stale") {
      applySpecialFill(config, cells, undefined, fillEmptyOnly, skip);
      return;
    }
    if (result.kind === "refused") {
      setAutoError(result.lines[0]);
      setAutoNotices(result.lines.slice(1));
      setV3Run(null);
      applySpecialFill(config, cells, undefined, fillEmptyOnly, skip);
      return;
    }
    const { build, outcome } = result;
    if (outcome.kind !== "success") {
      setAutoError(v3OutcomeLine(outcome));
      if (v3RetryOffered(outcome)) setAutoRetry(() => () => { void handleAuto(); });
      setV3Run(null);
      applySpecialFill(config, cells, undefined, fillEmptyOnly, skip);
      return;
    }
    const applied = applyV3Assignments({ response: outcome.response, request: build.request, cells: build.cells, rows, pinnedCellKeys: build.boardPinnedCellKeys });
    if (!applied.ok) {
      setAutoError(transportLine("unknown_service"));
      setV3Run(null);
      applySpecialFill(config, cells, undefined, fillEmptyOnly, skip);
      return;
    }
    const names = v3Names({ members, serviceLabels: build.serviceLabels, ruleLabels: build.ruleLabels });
    const report = buildV3RunReport({ response: outcome.response, request: build.request, storedServiceIds: build.storedServiceIds, names });
    setAutoNotices([...build.notices, ...report.solverNotices]);              // NT-3: C6's own first
    setV3Run({ build, response: outcome.response, report, names, horizonKey });
    applySpecialFill(config, applied.cells, applied.unfilled, fillEmptyOnly, skip);
  }

  async function handleAutoDerived() {
```
AD-8 — in `runSolve`, Find:
```ts
      } else if (res.status === 422) {
        // The solver's refusal — its body carries the reason (`solverRefusalMessage`).
        response = await res.json().catch(() => null);
      }
```
Replace with:
```ts
      } else if (res.status === 422) {
        // The solver's refusal — its body carries the reason (`solverRefusalMessage`).
        response = await res.json().catch(() => null);
      } else if (res.status === 409) {
        // Solver v3 C6 AD-8 — the ONE v2 client change: the server's engine changed under this page.
        // Never «sin solución», never the trailing retry; the specials still fill.
        const mismatch = await res.json().catch(() => null);
        if (mismatch?.error === "solver_version_mismatch") {
          setAutoError(V3_ROUTE_COPY.versionMismatch);
          applySpecialFill(config, cells, undefined, prepared.fillEmpty);
          return;
        }
      }
```
`autoState` — Find:
```ts
  const autoState: AutoState = { pending: autoPending, error: autoError, notices: autoNotices, disabledReason: gateBlocked };
```
Replace with:
```ts
  const autoState: AutoState = {
    pending: autoPending, error: autoError, notices: autoNotices, disabledReason: gateBlocked,
    ...(isV3 && autoRetry ? { retry: autoRetry } : {}),
  };
  const v3RunCurrent = v3Run && v3Run.horizonKey === horizon.join(",") ? v3Run : null;
  // C6 ST-9: the confirm's count under v3 — the planned weekend columns' empty voice seats.
  const v3EmptyVoiceSeats = columns
    .filter((c) => c.type !== "special_role")
    .reduce((sum, c) => sum + rows.filter((r) => r.category === "voz" && r.target !== null && !(r.id === "coro" && c.type === "saturday_role"))
      .reduce((acc, r) => acc + Math.max(0, (r.target ?? 0) - (cells.find((x) => x.columnId === c.columnId && x.rowId === r.id)?.occupants.length ?? 0)), 0), 0);
```
The `<PlannerGrid` mount — Find `          diagnostics={diagnostics}` → Replace with:
```tsx
          diagnostics={isV3 ? null : diagnostics}
          v3Report={isV3 && v3RunCurrent ? (
            <V3RunPanel
              report={v3RunCurrent.report}
              requestId={v3RunCurrent.build.snapshot.requestId}
              ruleTable={renderRuleRefTable(v3RunCurrent.build.snapshot.requestId, v3RunCurrent.build.snapshot.ruleTable)}
            />
          ) : undefined}
          autoConfirmText={isV3 ? V3_LINES.autoConfirm(horizon) : undefined}
```
Find:
```tsx
            emptyVoiceSeats: emptyVoiceSeats({
              cells, columns, rows, sundayDates: sundayDatesFull, weekendsWithSaturday: requestSaturdayWeeks,
            }),
```
Replace with:
```tsx
            emptyVoiceSeats: isV3 ? v3EmptyVoiceSeats : emptyVoiceSeats({
              cells, columns, rows, sundayDates: sundayDatesFull, weekendsWithSaturday: requestSaturdayWeeks,
            }),
```

- [ ] **Step 7: Run the tests, the planner wiring suites and the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/MonthGenerator.v3Auto.test.tsx app/components/admin/__tests__/localFill.wiring.test.tsx app/components/admin/__tests__/fillEmpty.wiring.test.tsx app/components/admin/__tests__/trailingSaturday.wiring.test.tsx app/components/admin/__tests__/MonthGenerator.derivedHistory.test.tsx app/components/admin/__tests__/instrumentFill.wiring.test.tsx`
Expected: PASS — every v2 wiring suite unedited.
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors; warnings ≤ baseline.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(planner): Auto under v3 — fresh read, contract-3 solve, apply by id, a run report

Under the v3 engine prop Auto dispatches before reading anything: it refuses what must be refused
first, reads the fairness ledger fresh, builds the request with the one builder, posts it with its
own 58 s abort and reads the answer only through the v3 adapter. A success is applied by service id
to planned columns only and explained — the run line, each stage's proof status, and «Ver etapas»
with the run's name-free rule table — while timeouts and connection faults offer «Reintentar».
Under v2 the only change is that a 409 version mismatch asks for a reload instead of «sin solución»."
```

---

## Task 16: «Equidad» under v3, the month states on screen, and the warnings (EQ-1–EQ-7, ST-8, WN-1, WN-3) — [standard]

**Files:**
- Create: `app/components/admin/v3Equidad.ts`
- Modify: `app/components/admin/v3Copy.ts` (`V3_LINES` gains the two plan columns and EQ-7's lines)
- Modify (C2 Task 13/14 code, anchors verified at replay): `app/components/admin/fairnessPreviewModel.ts` (extract `x1LineText`), `app/components/admin/FairnessPreviewPanel.tsx` (`engine`, `plan`, plan columns, diagnostics)
- Modify: `app/components/admin/MonthGenerator.tsx` — the display read, banners, read-only pools (`MemberPool`, `SolverConfigPanel`), WN-1's months, WN-3's line, the v2 history surfaces gated, both `<FairnessPreviewPanel` mounts
- Modify: `app/components/admin/ServicesPanel.tsx` — the create mount passes `showCadencePoolWarning={engine === "v3"}`
- Modify: `app/components/admin/__tests__/engineProp.test.ts` (add `FairnessPreviewPanel` to the mounts that must pass `engine=`)
- Create (tests): `app/components/admin/__tests__/v3Equidad.test.ts`, `app/components/admin/__tests__/MonthGenerator.v3Equidad.test.tsx`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: C2 `FairnessPreviewPanel`, `tabRows`, `cadenceLine`, `COPY`; IF2-8 `diagnostics`, `countedSundayLeads`; IF2-13 `saldoWords`; Task 15's `v3Run` (its `response.fairness.people`, `build.cadence`, `build.request`, `names`); Task 6 `displayedMonthStates`, `MonthState`; Task 13 `isLedgerBody`; C3 `CADENCE_OUTSIDE_HEADING`, `CADENCE_OUTSIDE_SENTENCE` (unchanged).
- Produces: `x1LineText(month: string, reason: CadenceReason, ledDate: string | null): string` (C2's four X1 sentences, now exported); `interface EquidadPlan { people: ReadonlyMap<string, V3FairnessPerson>; reason(memberId: string, tab: TabKey): string }`; `buildEquidadPlan(input: { response: V3Success; request: V3SolveRequest; cadence: RunCadence; ledger: FairnessLedgerResponse | null; names: V3Names; members: ReadonlyArray<{ _id: string; unavailableDates?: string[] }> }): EquidadPlan`; `planCells(plan: EquidadPlan | null | undefined, memberId: string, tab: TabKey): { enEstePlan: string; queda: string }`; `ledgerDiagnosticsLines(d: FairnessLedgerResponse["diagnostics"]): string[]`; `FairnessPreviewPanelProps.engine?: SolverEngine`, `.plan?: EquidadPlan | null`.

- [ ] **Step 1: Write the failing model test** — `app/components/admin/__tests__/v3Equidad.test.ts`

```ts
// Solver v3 C6 EQ-3–EQ-5, EQ-7 — the plan columns come from each TAB's own entry (never its lines,
// never a division), «Queda» from `tenths.after` through C2's formatter, and each row's reason line
// from codes, with the cadence line taken from RQ-4's values.
import { describe, expect, it } from "vitest";

import { buildEquidadPlan, ledgerDiagnosticsLines, planCells } from "../v3Equidad";
import { v3Names } from "../v3RunReport";
import type { V3FairnessPerson, V3SolveRequest, V3Success, V3TabFigures } from "../v3Wire";
import type { RunCadence } from "../v3People";
import { ledgerPerson, ledgerResponse } from "./v3Fixtures";

const tab = (seats: number, pinnedSeats: number, afterTenths: number, received = seats * 100): V3TabFigures => ({
  carried: 0, share: 0, received, pinned: pinnedSeats * 100, seats, pinned_seats: pinnedSeats, after: 0, tenths: { share: 0, after: afterTenths },
});
const ana: V3FairnessPerson = {
  person: "m-ana", floor: [],
  lines: { BGV: { ...tab(1, 0, 4), planned: 0, set_aside: 0, in_stage: true, clamped: false }, "P:r1": { ...tab(1, 1, -6), planned: 0, set_aside: 0, in_stage: true, clamped: false } },
  tabs: { DL: tab(2, 1, 3), BGV: tab(2, 1, -2, 300), TOTAL: tab(4, 1, 1) },
};
const response = { fairness: { scale: 100, tolerance: 35, lines: [], people: [ana] }, cadence: [{ person: "m-ana", month: "2026-12", state: "off", sundays: 0, saturdays: 1, met: true, compensation: "given" }] } as unknown as V3Success;
const request = {
  months: ["2026-11", "2026-12"],
  services: [
    { id: "s1", date: "2026-11-08", month: "2026-11", kind: "sunday", fixed: false, counts: true },
    { id: "s2", date: "2026-11-15", month: "2026-11", kind: "sunday", fixed: false, counts: true },
  ],
  people: [{ id: "m-ana", name: "Ana", exempt: true, eligibility: {}, carried: {}, dl_since: null, prev_dl_leads: 0 }],
  rules: [{ kind: "count", id: "c1", person: "m-ana", roles: ["Sun.Lead"], op: "==", month: "2026-11", value: 2 }],
} as unknown as V3SolveRequest;
const names = v3Names({ members: [{ _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana" }], serviceLabels: new Map(), ruleLabels: new Map([["c1", "Ana · Sun.Lead == 2"]]) });
const cadence: RunCadence = new Map([["m-ana", [
  { month: "2026-11", state: "on", reason: "on", wire: "on" },
  { month: "2026-12", state: "off", reason: "assumed_led_previous_month", wire: "off" },
]]]);

describe("plan columns (EQ-3, EQ-5)", () => {
  const plan = buildEquidadPlan({ response, request, cadence, ledger: ledgerResponse(["2026-11", "2026-12"]), names, members: [{ _id: "m-ana", unavailableDates: ["2026-11-15"] }] });

  it("«En este plan» is the tab's integer `seats`, «Queda» its `tenths.after` in words — the folded BGV and Total included", () => {
    expect(planCells(plan, "m-ana", "DL")).toEqual({ enEstePlan: "2", queda: "le deben 0.3" });
    expect(planCells(plan, "m-ana", "BGV")).toEqual({ enEstePlan: "2", queda: "0.2 de más" });
    expect(planCells(plan, "m-ana", "TOTAL")).toEqual({ enEstePlan: "4", queda: "le deben 0.1" });
  });

  it("before any solve, or where the tab is absent (Total for an exempt person), the plan columns read «—»", () => {
    expect(planCells(null, "m-ana", "DL")).toEqual({ enEstePlan: "—", queda: "—" });
    expect(planCells(plan, "m-ana", "SL")).toEqual({ enEstePlan: "—", queda: "—" });
  });

  it("each row's reason line comes from codes; the DL cadence line is RQ-4's own state, one per month", () => {
    expect(plan.reason("m-ana", "DL")).toBe(
      "En nov le toca domingo (previsto). Mes por medio: no dirige domingo en diciembre. No disponible 15 nov: esas fechas no le cuentan. Su número lo fija «Ana · Sun.Lead == 2». Los pines tomaron 1 lugares.",
    );
    expect(plan.reason("m-ana", "SL")).toBe("Sábado de compensación en diciembre. No disponible 15 nov: esas fechas no le cuentan.");
    expect(plan.reason("m-ana", "TOTAL")).toContain("Exenta: fuera de Total y del mínimo de voz.");
  });
});

describe("the ledger's diagnostics (EQ-7)", () => {
  it("one line per diagnostic, none when clean", () => {
    expect(ledgerDiagnosticsLines(ledgerResponse(["2026-11"]).diagnostics)).toEqual([]);
    expect(ledgerDiagnosticsLines({ duplicateTargets: [{ type: "saturday_role", date: "2026-10-24", roleIds: ["a", "b"] }], notInRecordSeats: 2, unknownMembers: ["m-x"] })).toEqual([
      "Servicios duplicados en una fecha — no cuenta ninguno: sábado 24 oct",
      "Lugares de personas que no están en el registro de su mes — no cuentan: 2",
      "Miembros asignados sin ficha — no cuentan: 1",
    ]);
  });

  it("a ledger person's figures still render as emitted: «Tuvo» is Figures.seats, never received/100", () => {
    const p = ledgerPerson("m-ana", "Ana", { tabs: { window: { DL: { share: 250, received: 300, balance: -50, seats: 3, tenths: { share: 25, balance: -5 } } }, cumulative: {} } });
    expect(p.tabs.window.DL!.seats).toBe(3);
  });
});
```

- [ ] **Step 2: Write the failing component test** — `app/components/admin/__tests__/MonthGenerator.v3Equidad.test.tsx`

```tsx
/** @vitest-environment jsdom */
// Solver v3 C6 EQ-1, EQ-2, EQ-4, EQ-6, ST-8, WN-1, WN-3 — what the planner shows about fairness and
// month states under each engine: the v2 history surfaces under v2 only, C2's banner under v2 only,
// the cadence line from the run's own states, the plan's values in a person's phone card, the four
// month-state banners and read-only pools, C3's warning naming the months it applies to, and the
// Saturday-pool note.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { echoV3, renderV3, routeFetch, solveRoute } from "./v3PlannerHarness";
import { deselectAll } from "./plannerWiringHarness";
import { ALL_IN, config, ledgerPerson, ledgerResponse, record, restriction } from "./v3Fixtures";
import { CADENCE_OUTSIDE_HEADING, CADENCE_OUTSIDE_SENTENCE } from "@/app/utils/sundayCadence";
import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:00:00.000Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const historyRoute = (url: string) => (url.startsWith("/api/admin/solver-history?") ? { status: 500, body: {} } : undefined);
const ledgerRoute = (byQuery: (q: URLSearchParams) => FairnessLedgerResponse) => (url: string) =>
  url.startsWith("/api/admin/fairness?") ? { status: 200, body: byQuery(new URLSearchParams(url.split("?")[1])) } : undefined;
const months = (q: URLSearchParams) => (q.get("horizon") === "2" ? [q.get("month")!, "2026-12"] : [q.get("month")!]);
const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
const openEquidad = () => fireEvent.click(screen.getAllByRole("button", { name: "Equidad · vista previa" })[0]);

describe("EQ-1 / EQ-2 — which surfaces each engine mounts", () => {
  it("v2: the history surfaces and C2's «Vista previa» banner; v3: neither", async () => {
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q))));
    renderV3({ engine: "v2", config: config() });
    expect(screen.getByText(/^Historial — derivado de los servicios guardados/)).toBeTruthy();
    openEquidad();
    await waitFor(() => expect(screen.getByText("Vista previa: Auto todavía no usa este saldo")).toBeTruthy());
    cleanup();
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q))));
    renderV3({ engine: "v3", config: config() });
    expect(screen.queryByText(/^Historial — derivado de los servicios guardados/)).toBeNull();
    openEquidad();
    await waitFor(() => expect(screen.getByText("Le tocaba")).toBeTruthy());
    expect(screen.queryByText("Vista previa: Auto todavía no usa este saldo")).toBeNull();
    expect(screen.getAllByText("En este plan").length).toBeGreaterThan(0);
  });
});

describe("ST-8 — the four month states, on screen", () => {
  const rec = (m: string) => record(m, [{ memberId: "m-ana", name: "Ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }], { recordedAt: `${m}-02T18:00:00.000Z` });

  it("bound: its banner; every month bound: the pools are read-only with the all-bound banner", async () => {
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q), { horizon: months(q).map((m) => ({ record: rec(m), storedServices: 2, recordBinds: true })) })));
    renderV3({ config: config({ sundayLeads: ["m-ana"] }) });
    await waitFor(() => expect(screen.getByText(/^Noviembre ya tienen servicios guardados y elegibilidad registrada: se planea con esas listas/)).toBeTruthy());
    for (const box of screen.getAllByRole("checkbox", { name: "Ana" })) expect((box as HTMLInputElement).disabled).toBe(true);
  });

  it("a mixed 2-month horizon: one bound banner, one recorded-unbound banner, and editable pools", async () => {
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q), {
      horizon: [{ record: rec("2026-11"), storedServices: 1, recordBinds: true }, { record: rec("2026-12"), storedServices: 0, recordBinds: false }].slice(0, months(q).length),
    })));
    renderV3({ config: config({ sundayLeads: ["m-ana"] }) });
    fireEvent.click(screen.getByRole("radio", { name: "2 meses" }));
    await waitFor(() => expect(screen.getByText(/^Noviembre ya tiene servicios guardados y elegibilidad registrada \(2 nov\)/)).toBeTruthy());
    expect(screen.getByText(/^Diciembre tiene elegibilidad registrada \(2 dic\) pero ningún servicio guardado/)).toBeTruthy();
    for (const box of screen.getAllByRole("checkbox", { name: "Ana" })) expect((box as HTMLInputElement).disabled).toBe(false);
  });

  it("an anchored, unrecorded month says its record will be created with the screen and then frozen", async () => {
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q), { horizon: [{ record: null, storedServices: 3, recordBinds: false }] })));
    renderV3({ config: config() });
    await waitFor(() => expect(screen.getByText(/^Noviembre ya tiene servicios guardados pero no tiene elegibilidad registrada/)).toBeTruthy());
  });
});

describe("WN-1 / WN-3 — C3's warning names its months; the Saturday-pool note", () => {
  // Ana carries «Mes por medio» and the Sunday Tipo but is not ticked in «Líderes Domingo» → `not_ticked`.
  const cadenceOut = config({ restrictions: [restriction("r-ana", "Ana", { sundayCadence: "alternate" })] });

  it("no read yet: open, naming the horizon; under v2: closed", () => {
    routeFetch(historyRoute, () => undefined, (url) => (url.startsWith("/api/admin/fairness?") ? { status: 500, body: {} } : undefined));
    renderV3({ config: cadenceOut });
    expect(screen.getByText(`${CADENCE_OUTSIDE_HEADING} — Noviembre`)).toBeTruthy();
    expect(screen.getByText(CADENCE_OUTSIDE_SENTENCE.not_ticked("Ana"))).toBeTruthy();
    cleanup();
    routeFetch(historyRoute, (url) => (url.startsWith("/api/admin/fairness?") ? { status: 500, body: {} } : undefined));
    renderV3({ engine: "v2", config: cadenceOut });
    expect(screen.queryByText(new RegExp(CADENCE_OUTSIDE_HEADING))).toBeNull();
  });

  it("a 2-month horizon with one bound month names only the unbound one; every month bound closes it", async () => {
    const bound = record("2026-11", []);
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q), {
      horizon: [{ record: bound, storedServices: 1, recordBinds: true }, { record: null, storedServices: 0, recordBinds: false }].slice(0, months(q).length),
    })));
    renderV3({ config: cadenceOut });
    fireEvent.click(screen.getByRole("radio", { name: "2 meses" }));
    await waitFor(() => expect(screen.getByText(`${CADENCE_OUTSIDE_HEADING} — Diciembre`)).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: "1 mes" }));
    await waitFor(() => expect(screen.queryByText(new RegExp(CADENCE_OUTSIDE_HEADING))).toBeNull());
  });

  it("WN-3: a non-empty «Líderes Sábado» gets the note under v3 only", () => {
    routeFetch(historyRoute, (url) => (url.startsWith("/api/admin/fairness?") ? { status: 500, body: {} } : undefined));
    renderV3({ config: config({ saturdayLeads: ["m-carla"] }) });
    expect(screen.getByText("Con el nuevo solver, «Líderes Sábado» ya no aparta un líder para cada sábado: quien esté solo ahí dirige únicamente sábados.")).toBeTruthy();
    cleanup();
    routeFetch(historyRoute, (url) => (url.startsWith("/api/admin/fairness?") ? { status: 500, body: {} } : undefined));
    renderV3({ engine: "v2", config: config({ saturdayLeads: ["m-carla"] }) });
    expect(screen.queryByText(/ya no aparta un líder/)).toBeNull();
  });
});

describe("EQ-4 — the cadence line after a run is RQ-4's own value", () => {
  it("a Sunday the planner skipped is not a request service, so the run says «no dirige domingo» where the preview said «le toca»", async () => {
    const cfg = config({ sundayLeads: ["m-ana", "m-bruno"], restrictions: [restriction("r-ana", "Ana", { sundayCadence: "alternate" })] });
    const people = [ledgerPerson("m-ana", "Ana", { tabs: { window: { DL: { share: 0, received: 0, balance: 0, seats: 0, tenths: { share: 0, balance: 0 } } }, cumulative: {} } })];
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    routeFetch(historyRoute, solve.route, ledgerRoute((q) => ledgerResponse(months(q), { people })));
    const anaAway = { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"], unavailableDates: ["2026-11-08"] };
    const { container } = renderV3({ config: cfg, members: [anaAway, { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "sunday_lead"] }] as never });
    deselectAll(container, "saturday");
    for (const d of ["2026-11-01", "2026-11-15", "2026-11-22", "2026-11-29"]) fireEvent.click(container.querySelector(`[data-date="${d}"]`)!);
    preview();
    openEquidad();
    await waitFor(() => expect(screen.getAllByText(/En nov le toca domingo \(previsto\)\./).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    // Ana is eligible nowhere in this request (her one planned Sunday is a day off), so she is not
    // sent; RQ-4's state is computed for her anyway and is what the panel shows.
    await waitFor(() => expect(screen.getAllByText(/En nov no dirige domingo: ningún domingo disponible\./).length).toBeGreaterThan(0));
    expect(screen.queryAllByText(/En nov le toca domingo/)).toHaveLength(0);
  });
});
describe("EQ-6 — at phone width: one card per person, and the plan's values inside it", () => {
  // jsdom lays nothing out and the panel asks `matchMedia` nothing, so a 390 px viewport (stubbed
  // the way `participationAlongside.test.tsx` stubs a narrow one) renders the same DOM: what is
  // asserted is the split by class — the cards `md:hidden`, the table `hidden md:block` inside its
  // OWN `overflow-x-auto` box (no page-level horizontal scroll, ADR-0035) — and what Ana's card
  // SAYS, scoped to `[data-fairness-cards]`. The real phone look stays C7's.
  it("after a v3 run, Ana's card reads «En este plan 2 · Queda le deben 0.3»", async () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }));
    const dl = { carried: 0, share: 0, received: 200, pinned: 0, seats: 2, pinned_seats: 0, after: 0, tenths: { share: 0, after: 3 } };
    const solve = solveRoute((r) => ({
      status: 200,
      body: { ...echoV3(r), fairness: { scale: 100, tolerance: 35, lines: [], people: [{ person: "m-ana", floor: [], lines: {}, tabs: { DL: dl } }] } },
    }));
    const people = [ledgerPerson("m-ana", "Ana", { tabs: { window: { DL: { share: 0, received: 0, balance: 0, seats: 0, tenths: { share: 0, balance: 0 } } }, cumulative: {} } })];
    routeFetch(historyRoute, solve.route, ledgerRoute((q) => ledgerResponse(months(q), { people })));
    renderV3({ config: config({ sundayLeads: ["m-ana"] }) });
    preview();
    openEquidad();
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    const anaCards = () =>
      Array.from(document.querySelectorAll("[data-fairness-cards] > li")).filter((li) => li.querySelector("p")?.textContent === "Ana") as HTMLElement[];
    await waitFor(() => expect(anaCards().length).toBeGreaterThan(0));
    for (const card of anaCards()) expect(within(card).getByText("En este plan 2 · Queda le deben 0.3")).toBeTruthy();
    for (const list of Array.from(document.querySelectorAll("[data-fairness-cards]"))) expect(list.classList.contains("md:hidden")).toBe(true);
    for (const table of Array.from(document.querySelectorAll("[data-fairness-table]"))) {
      expect(["hidden", "md:block", "overflow-x-auto"].every((c) => table.classList.contains(c))).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `git add -A && npx vitest run app/components/admin/__tests__/v3Equidad.test.ts app/components/admin/__tests__/MonthGenerator.v3Equidad.test.tsx`
Expected: FAIL — `Cannot find module '../v3Equidad'`; the planner still mounts the v2 surfaces under v3.

- [ ] **Step 4: Extract C2's X1 sentences** — `app/components/admin/fairnessPreviewModel.ts`

Find:
```ts
  const mes = monthShort(input.month);
  switch (state.reason) {
    case "on":
      return `En ${mes} le toca domingo (previsto).`;
    case "led_previous_month":
      return `En ${mes} no dirige domingo: ya dirigió el ${dayMonth(led[led.length - 1])}.`;
    case "not_eligible":
      return `En ${mes} no dirige domingo: no está en la lista de Dom Lead.`;
    default:
      return `En ${mes} no dirige domingo: ningún domingo disponible.`;
  }
}
```
Replace with:
```ts
  return x1LineText(input.month, state.reason, led.length > 0 ? led[led.length - 1] : null);
}

/**
 * C2 §8's X1 sentences, keyed on the IF2-12 reason — exported (solver v3 C6 EQ-4) so the v3 panel
 * renders RQ-4's computed states through THIS copy and adds none of its own. `assumed_led_previous_month`
 * has no sentence of its own here (C6 renders §7.7's «Mes por medio: no dirige domingo en {mes}.» line
 * for it — sibling issue S-19).
 */
export function x1LineText(month: string, reason: CadenceReason, ledDate: string | null): string {
  const mes = monthShort(month);
  switch (reason) {
    case "on":
      return `En ${mes} le toca domingo (previsto).`;
    case "led_previous_month":
      return `En ${mes} no dirige domingo: ya dirigió el ${ledDate ? dayMonth(ledDate) : "—"}.`;
    case "not_eligible":
      return `En ${mes} no dirige domingo: no está en la lista de Dom Lead.`;
    default:
      return `En ${mes} no dirige domingo: ningún domingo disponible.`;
  }
}
```
The file's import from `@/app/utils/fairnessLedger` gains `type CadenceReason`: Find `import { cadenceStates } from "@/app/utils/fairnessLedger";` → Replace with `import { cadenceStates, type CadenceReason } from "@/app/utils/fairnessLedger";`.

- [ ] **Step 5: Add the plan columns' and EQ-7's copy** — `app/components/admin/v3Copy.ts`

Find:
```ts
  draftConflict: "Alguien más cambió esas fechas: recarga y revisa.",
} as const;
```
Replace with:
```ts
  draftConflict: "Alguien más cambió esas fechas: recarga y revisa.",
  // EQ-3 — the two plan columns (U5)
  colEnEstePlan: "En este plan",
  colQueda: "Queda",
  // EQ-7 — the ledger's diagnostics, in the derived history's own wording
  diagDuplicates: (list: string) => `Servicios duplicados en una fecha — no cuenta ninguno: ${list}`,
  diagNotInRecord: (n: number) => `Lugares de personas que no están en el registro de su mes — no cuentan: ${n}`,
  diagUnknownMembers: (n: number) => `Miembros asignados sin ficha — no cuentan: ${n}`,
} as const;
```

- [ ] **Step 6: Write the model** — Create `app/components/admin/v3Equidad.ts`

```ts
// app/components/admin/v3Equidad.ts
//
// Solver v3 C6 EQ-3–EQ-5, EQ-7 — what the «Equidad» panel adds under v3, from the last v3 run of
// this horizon. Every figure is ONE named field taken as emitted: «En este plan» = the tab's
// integer `seats` (A39), the pins reason = the tab's `pinned_seats`, «Queda» = the tab's
// `tenths.after` through C2's `saldoWords` (A32). Folds are the emitters' (C5's `tabs.BGV` and
// `tabs.TOTAL`); nothing here sums, divides, rounds or formats a number itself.
// The cadence line (EQ-4, X1) on the DL tab is RQ-4's own state per month through C2's X1 copy.

import { saldoWords } from "@/app/utils/fairnessFormat";
import type { FairnessLedgerResponse, RoleKey, TabKey } from "@/app/utils/fairnessVocabulary";
import { x1LineText } from "./fairnessPreviewModel";
import { V3_LINES, V3_PANEL_REASON, type V3Names } from "./v3Copy";
import type { RunCadence } from "./v3People";
import { serviceLabel } from "./v3Services";
import type { V3FairnessPerson, V3SolveRequest, V3Success } from "./v3Wire";

export interface EquidadPlan {
  people: ReadonlyMap<string, V3FairnessPerson>;
  reason(memberId: string, tab: TabKey): string;
}

const TAB_KEYS: Record<Exclude<TabKey, "TOTAL">, readonly RoleKey[]> = {
  DL: ["Sun.Lead"], SL: ["Sat.Lead"], BGV: ["Sun.BGV", "Sat.BGV"], CORO: ["Sun.Choir", "Sat.Choir"],
};

export function planCells(plan: EquidadPlan | null | undefined, memberId: string, tab: TabKey): { enEstePlan: string; queda: string } {
  const figures = plan?.people.get(memberId)?.tabs[tab];
  if (!figures) return { enEstePlan: "—", queda: "—" };
  return { enEstePlan: String(figures.seats), queda: saldoWords(figures.tenths.after) };
}

export function buildEquidadPlan(input: {
  response: V3Success;
  request: V3SolveRequest;
  cadence: RunCadence;
  ledger: FairnessLedgerResponse | null;
  names: V3Names;
  members: ReadonlyArray<{ _id: string; unavailableDates?: string[] }>;
}): EquidadPlan {
  const people = new Map(input.response.fairness.people.map((p) => [p.person, p]));
  const months = new Set(input.request.months);
  const serviceDates = new Set(input.request.services.map((s) => s.date));
  const reason = (memberId: string, tab: TabKey): string => {
    const parts: string[] = [];
    const states = input.cadence.get(memberId) ?? [];
    if (tab === "DL") {
      const prior = input.ledger?.people.find((p) => p.memberId === memberId)?.countedSundayLeads ?? [];
      for (const s of states) {
        if (s.reason === "assumed_led_previous_month") parts.push(V3_PANEL_REASON.cadenceOff(s.month));
        else parts.push(x1LineText(s.month, s.reason, prior.length > 0 ? prior[prior.length - 1] : null));
      }
    } else if (tab === "TOTAL") {
      for (const s of states) parts.push(s.state === "on" ? V3_PANEL_REASON.cadenceOn(s.month) : V3_PANEL_REASON.cadenceOff(s.month));
    }
    if (tab === "SL" || tab === "TOTAL") {
      for (const c of input.response.cadence) {
        if (c.person === memberId && c.compensation === "given") parts.push(V3_PANEL_REASON.compensation(c.month));
      }
    }
    const away = (input.members.find((m) => m._id === memberId)?.unavailableDates ?? [])
      .map((d) => d.slice(0, 10)).filter((d) => months.has(d.slice(0, 7)) && serviceDates.has(d)).sort();
    if (away.length > 0) parts.push(V3_PANEL_REASON.unavailable(away));
    if (tab !== "TOTAL") {
      const fixed = input.request.rules.find((r) =>
        r.kind === "count" && r.op === "==" && r.person === memberId && r.roles.some((k) => TAB_KEYS[tab].includes(k)));
      if (fixed) parts.push(V3_PANEL_REASON.fixedRule(input.names.rule(fixed.id)));
    }
    const pinned = people.get(memberId)?.tabs[tab]?.pinned_seats ?? 0;
    if (pinned > 0) parts.push(V3_PANEL_REASON.pins(pinned));
    if (tab === "TOTAL" && input.request.people.find((p) => p.id === memberId)?.exempt) parts.push(V3_PANEL_REASON.exempt);
    return parts.join(" ");
  };
  return { people, reason };
}

/** EQ-7: the ledger's own diagnostics where v2 showed the derived history's. */
export function ledgerDiagnosticsLines(d: FairnessLedgerResponse["diagnostics"]): string[] {
  const out: string[] = [];
  if (d.duplicateTargets.length > 0) {
    out.push(V3_LINES.diagDuplicates(d.duplicateTargets
      .map((t) => serviceLabel(t.type === "sunday_role" ? "sunday" : t.type === "saturday_role" ? "saturday" : "special", t.date)).join(", ")));
  }
  if (d.notInRecordSeats > 0) out.push(V3_LINES.diagNotInRecord(d.notInRecordSeats));
  if (d.unknownMembers.length > 0) out.push(V3_LINES.diagUnknownMembers(d.unknownMembers.length));
  return out;
}
```

- [ ] **Step 7: Extend C2's panel** — `app/components/admin/FairnessPreviewPanel.tsx`

The three imports go directly after the panel's `./plannerModel` import: Find `import type { SolverConfig } from "./plannerModel";` → Replace with `import type { SolverConfig } from "./plannerModel";\nimport type { SolverEngine } from "./solverEngine";\nimport { ledgerDiagnosticsLines, planCells, type EquidadPlan } from "./v3Equidad";\nimport { V3_LINES } from "./v3Copy";`.
Find:
```ts
  /** Whether the on-screen rules differ from the saved ones. */
  rulesDirty: boolean;
}
```
Replace with:
```ts
  /** Whether the on-screen rules differ from the saved ones. */
  rulesDirty: boolean;
  /**
   * The server-resolved engine (solver v3 C6 EQ-2). The banner shows exactly when it is "v2"; under
   * "v3" the two plan columns appear. Every mount passes it (`engineProp.test.ts`); the literal
   * default serves C2's own tests only.
   */
  engine?: SolverEngine;
  /** C6 EQ-3/EQ-4: the last v3 run of this horizon; `null` before any run (the plan columns read «—»). */
  plan?: EquidadPlan | null;
}
```
Find:
```tsx
function FiguresTable({ rows, total, sinceLabel }: { rows: PreviewRow[]; total: boolean; sinceLabel: string }) {
```
Replace with:
```tsx
function FiguresTable({ rows, total, sinceLabel, plan, tab }: {
  rows: PreviewRow[]; total: boolean; sinceLabel: string;
  /** C6: present (possibly `null`) only under v3 — then the two plan columns render. */
  plan?: EquidadPlan | null; tab: TabKey;
}) {
  const showPlan = plan !== undefined;
```
Find:
```tsx
              <th className="py-1 pr-3">{COPY.columns.desde(sinceLabel)}</th>
```
Replace with:
```tsx
              <th className="py-1 pr-3">{COPY.columns.desde(sinceLabel)}</th>
              {showPlan && <th className="py-1 pr-3">{V3_LINES.colEnEstePlan}</th>}
              {showPlan && <th className="py-1 pr-3">{V3_LINES.colQueda}</th>}
```
Find:
```tsx
                <td className="py-1 pr-3">{r.desde}</td>
```
Replace with:
```tsx
                <td className="py-1 pr-3">{r.desde}</td>
                {showPlan && <td className="py-1 pr-3 tabular-nums">{planCells(plan, r.memberId, tab).enEstePlan}</td>}
                {showPlan && <td className="py-1 pr-3">{planCells(plan, r.memberId, tab).queda}</td>}
```
Find:
```tsx
            <p className="text-mono-500">
              {COPY.columns.desde(sinceLabel)}: {r.desde}
            </p>
```
Replace with:
```tsx
            <p className="text-mono-500">
              {COPY.columns.desde(sinceLabel)}: {r.desde}
            </p>
            {showPlan && (
              <p className="text-mono-500">
                {V3_LINES.colEnEstePlan} {planCells(plan, r.memberId, tab).enEstePlan} · {V3_LINES.colQueda} {planCells(plan, r.memberId, tab).queda}
              </p>
            )}
```
Find:
```tsx
  const extraMotivo = (person: FairnessPerson) => {
    if (!data || tab !== "DL") return "";
```
Replace with:
```tsx
  const engine = props.engine ?? "v2";
  const extraMotivo = (person: FairnessPerson) => {
    // C6 EQ-4: after a v3 run of this horizon, the row's reason (cadence from RQ-4's values) is the run's.
    if (engine === "v3" && props.plan) return props.plan.reason(person.memberId, tab);
    if (!data || tab !== "DL") return "";
```
Find (the banner sits directly under the `Collapse`, outside the `{data && …}` block — so the diagnostics guard on `data`):
```tsx
        <p className="font-label text-[10px] uppercase tracking-widest text-warning-strong">{COPY.banner}</p>
```
Replace with:
```tsx
        {engine === "v2" && (
          <p className="font-label text-[10px] uppercase tracking-widest text-warning-strong">{COPY.banner}</p>
        )}
        {engine === "v3" && data && ledgerDiagnosticsLines(data.diagnostics).map((line) => (
          <p key={line} className="font-body text-xs text-warning-strong">{line}</p>
        ))}
```
Find (both `FiguresTable` uses):
```tsx
            <FiguresTable rows={rows} total={tab === "TOTAL"} sinceLabel={sinceLabel} />
```
Replace with:
```tsx
            <FiguresTable rows={rows} total={tab === "TOTAL"} sinceLabel={sinceLabel} tab={tab} {...(engine === "v3" ? { plan: props.plan ?? null } : {})} />
```
Find:
```tsx
                  <FiguresTable rows={out} total={tab === "TOTAL"} sinceLabel={sinceLabel} />
```
Replace with:
```tsx
                  <FiguresTable rows={out} total={tab === "TOTAL"} sinceLabel={sinceLabel} tab={tab} {...(engine === "v3" ? { plan: props.plan ?? null } : {})} />
```

- [ ] **Step 8: `MonthGenerator` — the display read, banners, read-only pools, warnings, surfaces**

The four imports go directly after Task 15's `./V3RunPanel` import (`dayLabel` is already imported from `./plannerModel`): Find `import V3RunPanel from "./V3RunPanel";` → Replace with `import V3RunPanel from "./V3RunPanel";\nimport { displayedMonthStates } from "./v3MonthSources";\nimport { isLedgerBody } from "./v3AutoRun";\nimport { buildEquidadPlan, type EquidadPlan } from "./v3Equidad";\nimport type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";`.

After Task 15's `const [autoRetry, setAutoRetry] = …` line, add:
```ts
  // §4 «Displayed state before a run»: one display read of the ledger per horizon change (v3 only).
  // Banners, the read-only pools and WN-1's gate read it; every Auto still reads fresh (RQ-1). A
  // failed or pending read shows every month as not bound, so banners and gates err toward showing.
  const [displayLedger, setDisplayLedger] = useState<{ key: string; body: FairnessLedgerResponse } | null>(null);
  const horizonKey = horizon.join(",");
  useEffect(() => {
    if (!isV3 || storedMode) return;
    const months = horizonKey.split(",");
    const controller = new AbortController();
    fetch(`/api/admin/fairness?month=${months[0]}&horizon=${months.length}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body: unknown = res.ok ? await res.json() : null;
        if (isLedgerBody(body, months)) setDisplayLedger({ key: horizonKey, body });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [isV3, storedMode, horizonKey]);
  const shownLedger = displayLedger && displayLedger.key === horizonKey ? displayLedger.body : null;
  const monthStates = displayedMonthStates(horizon, shownLedger);
  const unboundMonths = horizon.filter((m) => monthStates.get(m) !== "bound");
  const allBound = isV3 && !storedMode && unboundMonths.length === 0;
```
After Task 15's `const v3RunCurrent = …` line, add:
```ts
  const equidadPlan = isV3 && v3RunCurrent
    ? buildEquidadPlan({ response: v3RunCurrent.response, request: v3RunCurrent.build.request, cadence: v3RunCurrent.build.cadence, ledger: shownLedger, names: v3RunCurrent.names, members })
    : null;
  const recordedOn = (m: string) => {
    const at = shownLedger?.horizon.find((h) => h.month === m)?.record?.recordedAt;
    return at ? dayLabel(at.slice(0, 10)) : "";
  };
  // ST-8 banners (v3, create mode).
  const v3Banners: string[] = !isV3 || storedMode ? [] : allBound
    ? [V3_LINES.allBound(horizon)]
    : horizon.flatMap((m) => {
        const state = monthStates.get(m);
        if (state === "bound") return [V3_LINES.bound(m, recordedOn(m))];
        if (state === "recorded_unbound") return [V3_LINES.recordedUnbound(m, recordedOn(m))];
        if (state === "anchored_unrecorded") return [V3_LINES.anchoredUnrecorded(m)];
        return [];
      });
```
The config step — Find:
```tsx
      {solverConfig ? (
        <SolverConfigPanel
```
Replace with:
```tsx
      {v3Banners.map((line) => (
        <p key={line} data-v3-month-state="" className="font-body text-xs text-ink-muted bg-accent/5 rounded-lg px-3 py-2">{line}</p>
      ))}
      {isV3 && solverConfig && solverConfig.saturdayLeads.length > 0 && (
        <p className="font-body text-xs text-warning-strong bg-warning-fg/10 rounded-lg px-3 py-2">{V3_LINES.saturdayPool}</p>
      )}
      {solverConfig ? (
        <SolverConfigPanel
```
The same mount (C2's `fairnessServices` line sits between the two props) — Find:
```tsx
          showCadencePoolWarning={showCadencePoolWarning}
          fairnessServices={existingRoles}
          engine={engine}
        />
```
Replace with:
```tsx
          // WN-1: open exactly when the engine is v3 (the parent's half) AND some horizon month is not
          // bound; under v3 each line names the months it applies to (C3's sentences unchanged).
          showCadencePoolWarning={showCadencePoolWarning && unboundMonths.length > 0}
          cadencePoolWarningMonths={isV3 ? unboundMonths : undefined}
          poolsReadOnly={allBound}
          equidadPlan={equidadPlan}
          fairnessServices={existingRoles}
          engine={engine}
        />
```
`SolverConfigPanel` — Find:
```ts
  /** C6 ENG-3: forwarded to the rule cards (CTL-1). */
  engine?: SolverEngine;
```
Replace with:
```ts
  /** C6 ENG-3: forwarded to the rule cards (CTL-1). */
  engine?: SolverEngine;
  /** C6 WN-1: the horizon months the warning applies to (v3); named beside C3's heading. */
  cadencePoolWarningMonths?: string[];
  /** C6 ST-8: every horizon month is bound — the pool checkboxes are read-only. */
  poolsReadOnly?: boolean;
  /** C6 EQ-3/EQ-4: forwarded to the «Equidad» panel. */
  equidadPlan?: EquidadPlan | null;
```
In its destructure, Find `showCadencePoolWarning = false, fairnessServices, engine = "v2" }: {` → Replace with `showCadencePoolWarning = false, fairnessServices, engine = "v2", cadencePoolWarningMonths, poolsReadOnly = false, equidadPlan = null }: {`. Find:
```tsx
            {CADENCE_OUTSIDE_HEADING}
```
Replace with:
```tsx
            {CADENCE_OUTSIDE_HEADING}
            {cadencePoolWarningMonths && cadencePoolWarningMonths.length > 0 && ` — ${monthsList(cadencePoolWarningMonths, true)}`}
```
The three `<MemberPool` uses in `SolverConfigPanel` each gain `readOnly={poolsReadOnly}`: Find `          field="sundayLeads" label="Líderes Domingo"` → Replace with `          field="sundayLeads" label="Líderes Domingo" readOnly={poolsReadOnly}`; Find `          field="saturdayLeads" label="Líderes Sábado"` → Replace with `          field="saturdayLeads" label="Líderes Sábado" readOnly={poolsReadOnly}`; Find `          field="support" label="Soporte"` → Replace with `          field="support" label="Soporte" readOnly={poolsReadOnly}`. `MemberPool` — Find:
```ts
function MemberPool({ field, label, pool, config, onToggle, onSelectAll, search, onSearch }: {
  field: "sundayLeads" | "saturdayLeads" | "support";
```
Replace with:
```ts
function MemberPool({ field, label, pool, config, onToggle, onSelectAll, search, onSearch, readOnly = false }: {
  /** C6 ST-8: shown read-only when every horizon month is bound (its record decides). */
  readOnly?: boolean;
  field: "sundayLeads" | "saturdayLeads" | "support";
```
In its body, Find:
```tsx
          type="button" onClick={onSelectAll}
```
Replace with:
```tsx
          type="button" onClick={onSelectAll} disabled={readOnly}
```
and its `<Checkbox` gains `disabled={readOnly}` (Find `          <Checkbox\n            key={m._id}` → Replace with `          <Checkbox\n            disabled={readOnly}\n            key={m._id}`).

The v2 history surfaces under v2 only (EQ-1). In `SolverConfigPanel`, Find:
```tsx
      {derived ? (
        <DerivedLeadPoolHistory config={config} members={members} history={derived} year={year} month={month} />
      ) : (
```
Replace with:
```tsx
      {engine !== "v2" ? null : derived ? (
        <DerivedLeadPoolHistory config={config} members={members} history={derived} year={year} month={month} />
      ) : (
```
Find:
```tsx
      {derived ? <DerivedHistoryBlock history={derived} /> : history.length > 0 && (
```
Replace with:
```tsx
      {engine !== "v2" ? null : derived ? <DerivedHistoryBlock history={derived} /> : history.length > 0 && (
```
On the grid step, Find:
```tsx
      {solverConfig && (derivedMode ? (
```
Replace with:
```tsx
      {solverConfig && !isV3 && (derivedMode ? (
```
Both C2 panel mounts (anchors verified at replay against replay-base; re-check after Task 15) gain the engine and the plan — in `SolverConfigPanel`, Find:
```tsx
        rulesDirty={rulesDirtyOf(rules, config)}
      />
```
Replace with:
```tsx
        rulesDirty={rulesDirtyOf(rules, config)}
        engine={engine}
        plan={engine === "v3" ? equidadPlan : undefined}
      />
```
and on the grid step, Find:
```tsx
          rulesDirty={rulesDirtyOf(rules, solverConfig)}
        />
```
Replace with:
```tsx
          rulesDirty={rulesDirtyOf(rules, solverConfig)}
          engine={engine}
          plan={isV3 && !storedMode ? equidadPlan : undefined}
        />
```

`ServicesPanel` — in the create mount, Find `            engine={engine}\n            members={members}` → Replace with `            engine={engine}\n            showCadencePoolWarning={engine === "v3"}\n            members={members}`.

`engineProp.test.ts` — Find `const everywhere = ["ServicesPanel", "MonthGenerator", "FairnessEngineNote"];` → Replace with `const everywhere = ["ServicesPanel", "MonthGenerator", "FairnessEngineNote", "FairnessPreviewPanel"];`.

- [ ] **Step 9: Run the tests, C2's and C3's panel suites, and the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3Equidad.test.ts app/components/admin/__tests__/MonthGenerator.v3Equidad.test.tsx app/components/admin/__tests__/FairnessPreviewPanel.test.tsx app/components/admin/__tests__/fairnessPreviewModel.test.ts app/components/admin/__tests__/MonthGenerator.fairnessPreview.test.tsx app/components/admin/__tests__/MonthGenerator.cadenceWarning.test.tsx app/components/admin/__tests__/MonthGenerator.cadence.test.tsx app/components/admin/__tests__/engineProp.test.ts app/utils/__tests__/fairnessFormat.test.ts`
Expected: PASS — C2's panel suites and C3's warning suite unedited (the default engine is v2; C3's prop-`true` case still opens with no read).
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(planner): the live «Equidad» panel and the month states under v3

Under v3 the v2 history surfaces are not mounted (C7 deletes them later) and C2's preview panel
drops its «Vista previa» banner and gains «En este plan» and «Queda», each read from the tab's own
entry of the last run, plus a reason line per person whose cadence part is the run's own state.
The config step shows each horizon month's state — bound, recorded, anchored — with read-only pools
when every month is bound, C3's «Mes por medio» warning names the months it applies to, and a
non-empty «Líderes Sábado» gets its note. Under v2 nothing changes."
```

---

## The critical slice — Tasks 17, 18, 19 (spec §5.11, U4)

> **[CRITICAL] — review gate before execution.** Tasks 17–19 change when and in what order a
> production writer's records (C2's `PUT /api/admin/fairness/months`) and the service drafts are
> written, and own partial-failure recovery. Per `CLAUDE.md` «Adversarial plan review» and spec §15,
> **the text of these three tasks** (with spec §4's state table, §5.11 and C2 IF2-4–IF2-6 and IF2-19
> as the reviewer's evidence) **goes through `.agents/skills/adversarial-plan-review/SKILL.md` and
> needs two sequential fresh `APPROVED` verdicts on byte-identical text before any of them is
> executed**; the churn cap is binding (after two rounds with verified substantive blockers, stop and
> ask Frank). Record the risk tier and rationale, and commit the review log beside this plan as
> `2026-10-05-solver-v3-c6-planner-v3-review-log.md`. Tasks 0–16 and 20–21 are standard tier: spec
> review plus the fresh code review of the diff.

## Task 17: The confirm model — frozen entries per month state, the guard, the PUT verdict, §7.8's lines (CF-1–CF-4, CF-6, CF-8) — **[CRITICAL]**

**Files:**
- Create: `app/components/admin/v3Confirm.ts`
- Create (test): `app/components/admin/__tests__/v3Confirm.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: IF2-4 `FairnessMonthWrite`, `FairnessMonthsPut`; IF2-5 `FairnessMonthsPutOk` (200 `months[].outcome`) and the 409 `details.detail` / `details.months`; IF2-6 `FairnessPutRefusal`, `FAIRNESS_PUT_REFUSALS` (`fairnessVocabulary.ts`); Task 6 `MonthSource`, `MonthState`; Task 3 `horizonRefusal`; Task 4 `V3_CONFIRM_REFUSAL`, `V3_LINES`. Test only: IF2-19 `contentHashOfWrite`, `buildFairnessMonthDocument`, `parseStoredFairnessMonth`, and WR-3's `validateFairnessMonthWrite` (`fairnessMonthWriteRequest.ts` — **no runtime module of C6 imports it**; C2's caller pin exempts tests).
- Produces: `type ConfirmOutcome = "created" | "replaced" | "unchanged"`; `interface V3ConfirmEntry { month: string; state: MonthState; write: FairnessMonthWrite; expects: readonly ConfirmOutcome[] }` (deep-frozen); `freezeConfirmEntries(sources: readonly MonthSource[], source: "auto" | "manual"): V3ConfirmEntry[]`; `type V3ConfirmGuard = { kind: "past"; month: string } | { kind: "ceiling"; month: string; limit: string } | null`; `confirmGuard(months, currentMonth): V3ConfirmGuard`; `guardLine(guard: NonNullable<V3ConfirmGuard>, draftsCreatedThisConfirm: boolean): string`; `type PutAnswer = { kind: "threw" } | { kind: "http"; status: number; body: unknown }`; `type RecordVerdict = { ok: true } | { ok: false; kind: "refusal"; detail: FairnessPutRefusal; month: string } | { ok: false; kind: "other" }`; `classifyRecordPut(entries, answer): RecordVerdict`; `recordVerdictLine(v: Exclude<RecordVerdict, { ok: true }>): string`; `recordRetryOffered(v): boolean`; `draftsByMonth<T extends { date: string }>(drafts, months): Array<{ month: string; drafts: T[] }>`; `interface MonthProgress { month: string; total: number; created: number; failed: number; attempted: boolean; conflict: boolean }`; `monthReportLines(progress: readonly MonthProgress[]): string[]`; `twoMonthSummaryLine(groups): string`.

- [ ] **Step 1: Write the failing test** — `app/components/admin/__tests__/v3Confirm.test.ts`

```ts
// Solver v3 C6 §5.11 (CRITICAL) — the confirm's pure half: one frozen PUT entry per horizon month in
// the shape its state calls for (§4, CF-3, A27), the guard every attempt runs first (CF-1, A40, HZ-9),
// the verdict on the PUT's answer (CF-4) and §7.8's lines. Fictitious people only.
import { describe, expect, it } from "vitest";

import {
  classifyRecordPut, confirmGuard, draftsByMonth, freezeConfirmEntries, guardLine, monthReportLines,
  recordRetryOffered, recordVerdictLine, twoMonthSummaryLine, type V3ConfirmEntry,
} from "../v3Confirm";
import { bodyFromRecord, resolveMonthSources, type MonthSource } from "../v3MonthSources";
import { V3_LINES } from "../v3Copy";
import { FAIRNESS_PUT_REFUSALS, type FairnessMonthBody } from "@/app/utils/fairnessVocabulary";
import {
  buildFairnessMonthDocument, contentHashOfWrite, parseStoredFairnessMonth, validateFairnessMonthWrite,
} from "@/app/utils/fairnessMonthWriteRequest";
import { ALL_IN, MEMBERS, NAME_SHAPED_KEYS, config, ledgerResponse } from "./v3Fixtures";

const body = (month: string): FairnessMonthBody => ({
  month,
  people: [{ memberId: "m-ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }],
  presence: [],
});
const src = (month: string, state: MonthSource["state"], rev: string | null): MonthSource => ({ month, state, rev, recordedAt: null, body: body(month) });

describe("freezeConfirmEntries — one entry per horizon month, one shape per state (CF-1, CF-3, A27)", () => {
  const entries = freezeConfirmEntries([
    src("2026-11", "bound", "rev-nov"),
    src("2026-12", "recorded_unbound", "rev-dec"),
  ], "auto");
  const more = freezeConfirmEntries([src("2027-01", "unrecorded", null), src("2027-02", "anchored_unrecorded", null)], "manual");

  it("bound: the record's own content, its rev, source auto — expects `unchanged` only", () => {
    expect(entries[0]).toEqual({ month: "2026-11", state: "bound", write: { ...body("2026-11"), source: "auto", expectedRev: "rev-nov" }, expects: ["unchanged"] });
  });

  it("recorded, unbound: the frozen screen body under the record's rev — `replaced` or `unchanged`", () => {
    expect(entries[1].write).toMatchObject({ month: "2026-12", source: "auto", expectedRev: "rev-dec" });
    expect(entries[1].expects).toEqual(["replaced", "unchanged"]);
  });

  it("unrecorded AND anchored-unrecorded: a create with expectedRev null — `created` or `unchanged` (A27, no skip)", () => {
    for (const e of more) {
      expect(e.write).toMatchObject({ source: "manual", expectedRev: null });
      expect(e.expects).toEqual(["created", "unchanged"]);
    }
  });

  it("a bound month's entry is `auto` even on the no-Auto path (its hash excludes the stamp; it must answer `unchanged`)", () => {
    expect(freezeConfirmEntries([src("2026-11", "bound", "rev-nov")], "manual")[0].write.source).toBe("auto");
  });

  it("carries no name, key, hash or stamp beyond IF2-4's fields; frozen against mutation", () => {
    expect(Object.keys(entries[0].write).sort()).toEqual(["expectedRev", "month", "people", "presence", "source"]);
    expect(entries[0].write.people[0]).not.toHaveProperty("name");
    expect(() => { (entries as V3ConfirmEntry[])[0].write.people.length = 0; }).toThrow();
  });
});

describe("the round trip (CF-3, the test's only use of IF2-19)", () => {
  it("a GET logical record turned into a bound PUT entry hashes to the record's own contentHash", () => {
    const write = { month: "2026-11", people: [
      // An exact rule's roles must carry status `exact` (WR-3 `notExact`, and `exactUnlisted` the other way), or the last assertion fails.
      { memberId: "m-bruno", roles: { ...ALL_IN, "Sun.Lead": "exact" as const, "Sat.Lead": "out" as const }, exactRules: [{ roles: ["Sun.Lead" as const], count: 2 }], exempt: true, blocks: [{ date: "2026-11-15", unavailable: true, excludedRoles: [] }] },
      { memberId: "m-ana", roles: { ...ALL_IN }, exactRules: [], sundayCadence: "alternate" as const, exempt: false, blocks: [] },
    ], presence: [{ ruleKey: "r-ana-bruno", roles: ["Sun.BGV" as const], members: ["m-ana", "m-bruno"], exclusive: false }] };
    const doc = {
      ...buildFairnessMonthDocument({ body: write, source: "auto", engine: "v3", environment: "local", recordedAt: "2026-11-02T18:00:00.000Z", recordedBy: "m-ana", names: new Map([["m-ana", "Ana"], ["m-bruno", "Bruno"]]) }),
      _rev: "rev-1", _createdAt: "2026-11-02T18:00:00Z", _updatedAt: "2026-11-02T18:00:00Z",
    };
    const parsed = parseStoredFairnessMonth(doc);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const sources = resolveMonthSources({
      months: ["2026-11"], ledger: ledgerResponse(["2026-11"], { horizon: [{ record: parsed.record, storedServices: 1, recordBinds: true }] }),
      config: config(), members: MEMBERS, exactLeadLabel: () => null,
    });
    if (!sources.ok) throw new Error(sources.lines.join());
    const [entry] = freezeConfirmEntries(sources.sources, "auto");
    const { month, people, presence } = entry.write;
    expect(contentHashOfWrite(month, { month, people, presence })).toBe(parsed.record.contentHash);
    expect(bodyFromRecord(parsed.record).people.map((p) => p.memberId)).toEqual(parsed.record.people.map((p) => p.memberId));
    // …and WR-3 accepts the entry as the route would (strict fields, no name/_key/stamp): no 400.
    expect(validateFairnessMonthWrite(entry.write, "route", "2026-10")).toMatchObject({ ok: true });
  });
});

describe("confirmGuard — every attempt, before anything (CF-1, A40, HZ-9)", () => {
  it("a month that became past refuses; the line depends on whether this confirm already created drafts", () => {
    const guard = confirmGuard(["2026-10", "2026-11"], "2026-11");
    expect(guard).toEqual({ kind: "past", month: "2026-10" });
    expect(guardLine(guard!, false)).toBe("Octubre ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto.");
    expect(guardLine(guard!, true)).toBe("Octubre ya pasó mientras planeabas, así que no se creó nada más. Lo ya creado se queda; completa lo que falta en «Editar mes».");
  });

  it("a month past C2's ceiling refuses with HZ-9's line", () => {
    const guard = confirmGuard(["2027-11"], "2026-10");
    expect(guardLine(guard!, false)).toBe("Auto no planea más de 12 meses adelante: Noviembre queda fuera. Elige un mes hasta octubre.");
  });

  it("admits a horizon inside both bounds", () => expect(confirmGuard(["2026-11", "2026-12"], "2026-11")).toBeNull());
});

describe("classifyRecordPut (CF-4) — drafts only on a 200 whose every month has an expected outcome", () => {
  const entries = freezeConfirmEntries([src("2026-11", "bound", "r1"), src("2026-12", "recorded_unbound", "r2"), src("2027-01", "unrecorded", null)], "auto");
  const ok = (outcomes: string[]) => ({ kind: "http" as const, status: 200, body: { months: ["2026-11", "2026-12", "2027-01"].map((month, i) => ({ month, outcome: outcomes[i], rev: "x", contentHash: "sha256:x", recordedAt: "t" })) } });

  it("expected outcomes proceed", () => {
    expect(classifyRecordPut(entries, ok(["unchanged", "replaced", "created"]))).toEqual({ ok: true });
    expect(classifyRecordPut(entries, ok(["unchanged", "unchanged", "unchanged"]))).toEqual({ ok: true });
  });

  it("`replaced` for a bound month, `created` for a recorded one, or a missing month is «other failure»", () => {
    expect(classifyRecordPut(entries, ok(["replaced", "replaced", "created"]))).toEqual({ ok: false, kind: "other" });
    expect(classifyRecordPut(entries, ok(["unchanged", "created", "created"]))).toEqual({ ok: false, kind: "other" });
    expect(classifyRecordPut(entries, { kind: "http", status: 200, body: { months: [] } })).toEqual({ ok: false, kind: "other" });
  });

  it.each(FAIRNESS_PUT_REFUSALS.map((d) => [d]))("409 %s is a refusal naming the month, with no «Reintentar»", (detail) => {
    const answer = { kind: "http" as const, status: 409, body: { error: "stale_revision", message: "x", conflict: true, details: { detail, months: [{ month: "2026-11", verdict: "unchanged" }, { month: "2026-12", verdict: detail }] } } };
    const verdict = classifyRecordPut(entries, answer);
    expect(verdict).toEqual({ ok: false, kind: "refusal", detail, month: "2026-12" });
    expect(recordRetryOffered(verdict)).toBe(false);
    expect(recordVerdictLine(verdict as Exclude<typeof verdict, { ok: true }>).length).toBeGreaterThan(0);
  });

  it("engine_not_v3 before any read (no months) names the first month and asks for a reload", () => {
    const verdict = classifyRecordPut(entries, { kind: "http", status: 409, body: { error: "integrity_conflict", conflict: true, details: { detail: "engine_not_v3", months: [] } } });
    expect(verdict).toEqual({ ok: false, kind: "refusal", detail: "engine_not_v3", month: "2026-11" });
    expect(recordVerdictLine(verdict as Exclude<typeof verdict, { ok: true }>)).toBe("El solver cambió de versión. Recarga la página; no se creó nada.");
  });

  it.each([
    ["a 400", { kind: "http" as const, status: 400, body: { error: "invalid_request", details: { issues: [] } } }],
    ["a 500", { kind: "http" as const, status: 500, body: null }],
    ["an unparseable 409", { kind: "http" as const, status: 409, body: null }],
    ["a network error", { kind: "threw" as const }],
  ])("%s is «other failure» with «Reintentar»", (_name, answer) => {
    const verdict = classifyRecordPut(entries, answer);
    expect(verdict).toEqual({ ok: false, kind: "other" });
    expect(recordRetryOffered(verdict)).toBe(true);
    expect(recordVerdictLine({ ok: false, kind: "other" })).toBe("No se pudo registrar la elegibilidad. No se creó nada; pulsa «Reintentar».");
  });
});

describe("drafts and the per-month report (CF-5, CF-6, CF-8)", () => {
  it("groups drafts by horizon month, oldest first", () => {
    const drafts = [{ date: "2026-12-06", id: "d" }, { date: "2026-11-08", id: "b" }, { date: "2026-11-01", id: "a" }];
    expect(draftsByMonth(drafts, ["2026-11", "2026-12"])).toEqual([
      { month: "2026-11", drafts: [{ date: "2026-11-01", id: "a" }, { date: "2026-11-08", id: "b" }] },
      { month: "2026-12", drafts: [{ date: "2026-12-06", id: "d" }] },
    ]);
  });

  it("one line per month: complete, partial (with a 409's note), not attempted", () => {
    expect(monthReportLines([
      { month: "2026-11", total: 4, created: 3, failed: 1, attempted: true, conflict: true },
      { month: "2026-12", total: 5, created: 0, failed: 0, attempted: false, conflict: false },
    ])).toEqual([
      "Noviembre: 3 de 4 creados; 1 fallaron. Alguien más cambió esas fechas: recarga y revisa.",
      "Diciembre: no se intentó porque noviembre quedó incompleto.",
    ]);
    expect(monthReportLines([{ month: "2026-11", total: 4, created: 4, failed: 0, attempted: true, conflict: false }])).toEqual(["Noviembre: 4 de 4 creados."]);
  });

  it("the 2-month summary (CF-8)", () => {
    expect(twoMonthSummaryLine([{ month: "2026-11", drafts: [1, 2] }, { month: "2026-12", drafts: [1] }])).toBe(
      "Noviembre: 2 · Diciembre: 1. Se crean como borradores; publícalos después.",
    );
  });
});

describe("KH-1 on the confirm path — no line the confirm renders carries a rule key", () => {
  it("entries and answers that carry name-shaped keys still render lines with none of them", () => {
    const keyed: MonthSource = {
      ...src("2026-11", "recorded_unbound", "r1"),
      body: { ...body("2026-11"), presence: [{ ruleKey: "d-carla-dani", roles: ["Sun.BGV"], members: ["m-ana"], exclusive: false }] },
    };
    const entries = freezeConfirmEntries([keyed, src("2026-12", "unrecorded", null)], "auto");
    const leak = `${NAME_SHAPED_KEYS.join(" ")} P:d-carla-dani`;
    const lines: string[] = [];
    for (const detail of FAIRNESS_PUT_REFUSALS) {
      const v = classifyRecordPut(entries, { kind: "http", status: 409, body: { error: "stale_revision", message: leak, conflict: true, details: { detail, months: [{ month: "2026-11", verdict: detail, ruleKey: "d-carla-dani" }] } } });
      if (!v.ok) lines.push(recordVerdictLine(v));
    }
    const invalid = classifyRecordPut(entries, { kind: "http", status: 400, body: { error: "invalid_request", message: leak, details: { issues: [{ path: "presence[0].ruleKey", message: leak }] } } });
    if (!invalid.ok) lines.push(recordVerdictLine(invalid));
    lines.push(guardLine(confirmGuard(["2026-10", "2026-11"], "2026-11")!, false), guardLine(confirmGuard(["2026-10", "2026-11"], "2026-11")!, true));
    lines.push(guardLine(confirmGuard(["2027-11"], "2026-10")!, false));
    lines.push(...monthReportLines([
      { month: "2026-11", total: 2, created: 1, failed: 1, attempted: true, conflict: true },
      { month: "2026-12", total: 1, created: 0, failed: 0, attempted: false, conflict: false },
    ]));
    lines.push(twoMonthSummaryLine(draftsByMonth([{ date: "2026-11-08" }, { date: "2026-12-06" }], ["2026-11", "2026-12"])));
    lines.push(V3_LINES.incompleteBody([{ month: "2026-11", missing: 1 }]), V3_LINES.retry(2));
    expect(lines.length).toBe(FAIRNESS_PUT_REFUSALS.length + 9);
    for (const line of lines) for (const key of NAME_SHAPED_KEYS) expect(line).not.toContain(key);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/v3Confirm.test.ts`
Expected: FAIL — `Cannot find module '../v3Confirm'`.

- [ ] **Step 3: Write the model** — Create `app/components/admin/v3Confirm.ts`

```ts
// app/components/admin/v3Confirm.ts — solver v3 C6 §5.11 (CRITICAL), the pure half of the confirm.
//
// What a v3 confirm writes (CF-1): ONE record entry for EVERY horizon month, in the shape its
// snapshot state calls for (§4), then the drafts. The entries are frozen from the run's snapshot
// (CF-2) and never change across retries; the set is never shrunk.
//   · bound            → the record's own content (IF2-3 without names), its rev, source "auto";
//                        the content hash excludes every stamp, so the decision is `unchanged`.
//   · recorded, unbound→ the frozen screen body under the record's rev as read; `replaced`/`unchanged`.
//   · unrecorded, anchored or not (A27) → a CREATE, expectedRev null; `created`/`unchanged`.
// Every attempt first runs the guard (CF-1): a horizon month before the client's CDMX month (A40) or
// past C2's ceiling (HZ-9) refuses before anything is written, with no «Reintentar».
// The PUT's answer (CF-4) lets the drafts start only on a 200 whose every month has an outcome its
// shape expects; any refusal or unexpected outcome creates no draft. Copy is keyed on IF2-6's union.

import {
  FAIRNESS_PUT_REFUSALS, type FairnessMonthWrite, type FairnessPutRefusal,
} from "@/app/utils/fairnessVocabulary";
import { horizonRefusal } from "./v3Horizon";
import { V3_CONFIRM_REFUSAL, V3_LINES } from "./v3Copy";
import type { MonthSource, MonthState } from "./v3MonthSources";

export type ConfirmOutcome = "created" | "replaced" | "unchanged";

export interface V3ConfirmEntry {
  month: string;
  state: MonthState;
  write: FairnessMonthWrite;
  expects: readonly ConfirmOutcome[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** CF-2/CF-3: frozen once, from the snapshot's sources (or the no-Auto path's fresh read). */
export function freezeConfirmEntries(sources: readonly MonthSource[], source: "auto" | "manual"): V3ConfirmEntry[] {
  return sources.map((s) => {
    const body = structuredClone({ month: s.body.month, people: s.body.people, presence: s.body.presence });
    if (s.state === "bound") {
      return deepFreeze({ month: s.month, state: s.state, write: { ...body, source: "auto" as const, expectedRev: s.rev }, expects: ["unchanged"] as const });
    }
    if (s.state === "recorded_unbound") {
      return deepFreeze({ month: s.month, state: s.state, write: { ...body, source, expectedRev: s.rev }, expects: ["replaced", "unchanged"] as const });
    }
    return deepFreeze({ month: s.month, state: s.state, write: { ...body, source, expectedRev: null }, expects: ["created", "unchanged"] as const });
  });
}

export type V3ConfirmGuard = { kind: "past"; month: string } | { kind: "ceiling"; month: string; limit: string } | null;

/** CF-1: the same past/ceiling rule as Auto (HZ-7, HZ-9), on the client's clock at THIS attempt. */
export function confirmGuard(months: readonly string[], currentMonth: string): V3ConfirmGuard {
  return horizonRefusal(months, currentMonth);
}

export function guardLine(guard: NonNullable<V3ConfirmGuard>, draftsCreatedThisConfirm: boolean): string {
  if (guard.kind === "ceiling") return V3_LINES.horizonCeiling(guard.month, guard.limit);
  return draftsCreatedThisConfirm ? V3_LINES.pastAfterDrafts(guard.month) : V3_CONFIRM_REFUSAL.past_month(guard.month);
}

export type PutAnswer = { kind: "threw" } | { kind: "http"; status: number; body: unknown };

export type RecordVerdict =
  | { ok: true }
  | { ok: false; kind: "refusal"; detail: FairnessPutRefusal; month: string }
  | { ok: false; kind: "other" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function classifyRecordPut(entries: readonly V3ConfirmEntry[], answer: PutAnswer): RecordVerdict {
  if (answer.kind === "threw") return { ok: false, kind: "other" };
  const body = answer.body;
  if (answer.status === 200) {
    const months = isObject(body) && Array.isArray(body.months) ? body.months : null;
    if (!months) return { ok: false, kind: "other" };
    for (const entry of entries) {
      const got = months.find((m) => isObject(m) && m.month === entry.month);
      if (!isObject(got) || !(entry.expects as readonly unknown[]).includes(got.outcome)) return { ok: false, kind: "other" };
    }
    return { ok: true };
  }
  if (answer.status === 409 && isObject(body) && isObject(body.details)) {
    const detail = body.details.detail;
    if (typeof detail === "string" && (FAIRNESS_PUT_REFUSALS as readonly string[]).includes(detail)) {
      const verdicts = Array.isArray(body.details.months) ? body.details.months : [];
      const named = verdicts.find((m) => isObject(m) && m.verdict === detail);
      const month = isObject(named) && typeof named.month === "string" ? named.month : entries[0]?.month ?? "";
      return { ok: false, kind: "refusal", detail: detail as FairnessPutRefusal, month };
    }
  }
  return { ok: false, kind: "other" };
}

/** CF-4: a 400, a network error, a 5xx, an unparseable body or an unexpected outcome → «Reintentar»; a refusal never. */
export function recordRetryOffered(v: RecordVerdict): boolean {
  return !v.ok && v.kind === "other";
}

export function recordVerdictLine(v: Exclude<RecordVerdict, { ok: true }>): string {
  return v.kind === "other" ? V3_LINES.recordOtherFailure : V3_CONFIRM_REFUSAL[v.detail](v.month);
}

/** CF-5: drafts grouped by horizon month, oldest first within each. */
export function draftsByMonth<T extends { date: string }>(drafts: readonly T[], months: readonly string[]): Array<{ month: string; drafts: T[] }> {
  return months.map((month) => ({
    month,
    drafts: drafts.filter((d) => d.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

export interface MonthProgress {
  month: string;
  total: number;
  created: number;
  failed: number;
  attempted: boolean;
  /** A draft of this month was refused 409 (its target was taken meanwhile). */
  conflict: boolean;
}

/** CF-6, §7.8: one line per month. */
export function monthReportLines(progress: readonly MonthProgress[]): string[] {
  return progress.map((p, i) => {
    if (!p.attempted) return V3_LINES.monthNotAttempted(p.month, progress[i - 1]?.month ?? p.month);
    const line = p.created < p.total
      ? V3_LINES.monthPartial(p.month, p.created, p.total, p.failed)
      : V3_LINES.monthComplete(p.month, p.created, p.total);
    return p.conflict ? `${line} ${V3_LINES.draftConflict}` : line;
  });
}

/** CF-8: «{Mes1}: {a} · {Mes2}: {b}. Se crean como borradores; publícalos después.» */
export function twoMonthSummaryLine(groups: ReadonlyArray<{ month: string; drafts: readonly unknown[] }>): string {
  return V3_LINES.twoMonthSummary(groups[0].month, groups[0].drafts.length, groups[1].month, groups[1].drafts.length);
}
```

- [ ] **Step 4: Run it, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3Confirm.test.ts app/utils/__tests__/serviceCommitCallers.test.ts`
Expected: PASS — `serviceCommitCallers` unchanged and green (the test file's import of the write-request module is exempt; no runtime module imports it).
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(planner): the v3 confirm's pure model — frozen entries per month state, guard, verdict

A v3 confirm writes one eligibility record entry for every horizon month before any draft, in the
shape the month's state at the solve calls for: a bound month sends its record back unchanged, a
recorded month whose record no service froze is replaced under the revision read, and every month
without a record is created, anchored or not. The entries are frozen at the solve and never change
across retries. Every attempt first refuses a month that became past or lies beyond the writer's
ceiling, and the drafts start only when the PUT answered an expected outcome for every month. A
round-trip test proves a bound month's entry hashes to its stored record."
```

---

## Task 18: The confirm executor — one attempt: guard, one atomic PUT until it lands, drafts month by month, the retry state (CF-1, CF-4–CF-7, CF-11) — **[CRITICAL]**

**Files:**
- Create: `app/components/admin/v3ConfirmRun.ts`
- Create (test): `app/components/admin/__tests__/v3ConfirmRun.test.ts`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: Task 17 (`V3ConfirmEntry`, `confirmGuard`, `guardLine`, `classifyRecordPut`, `recordVerdictLine`, `recordRetryOffered`, `draftsByMonth`, `monthReportLines`, `MonthProgress`, `PutAnswer`); today's per-draft mechanism, unchanged — `runDraftCreateBatch`, `draftCreateBody`, `CreatableDraft`, `DraftPostOutcome` (`app/utils/monthDraftCreate.ts`); IF2-4 `FairnessMonthsPut`.
- Produces: `interface V3ConfirmState { recordsDone: boolean; createdLocalIds: ReadonlySet<string> }`; `INITIAL_V3_CONFIRM_STATE`; `type V3ConfirmResult = { kind: "refused_guard"; lines: string[]; state: V3ConfirmState; retry: false } | { kind: "record_failed"; lines: string[]; state: V3ConfirmState; retry: boolean } | { kind: "drafts"; complete: boolean; lines: string[]; state: V3ConfirmState; progress: MonthProgress[]; retry: boolean; createdNow: string[] }`; `runV3ConfirmAttempt(input: { entries: readonly V3ConfirmEntry[]; months: readonly string[]; drafts: readonly CreatableDraft[]; published: boolean; state: V3ConfirmState; currentMonth: string; putRecords: (body: FairnessMonthsPut) => Promise<{ status: number; body: unknown }>; postDraft: (body: ReturnType<typeof draftCreateBody>) => Promise<DraftPostOutcome> }): Promise<V3ConfirmResult>`; `pendingCount(drafts, state): number`; `progressFrom(drafts: readonly CreatableDraft[], months: readonly string[], created: ReadonlySet<string>): MonthProgress[]` (where a confirm's confirmed creations leave each month — read by the guard's report here and by Task 19's unreachable-throw branch).

- [ ] **Step 1: Write the failing test** — `app/components/admin/__tests__/v3ConfirmRun.test.ts`

```ts
// Solver v3 C6 §5.11 (CRITICAL) — one confirm attempt with injected transports: the guard on EVERY
// attempt (A40), the ONE atomic PUT before any draft (CF-4), drafts oldest first and month by month
// (CF-5), a per-month report with nothing deleted (CF-6), «Reintentar» resending only what is missing
// with byte-identical bodies (CF-7), and the client-mutation invariant (CF-11).
import { describe, expect, it, vi } from "vitest";

import { INITIAL_V3_CONFIRM_STATE, pendingCount, runV3ConfirmAttempt, type V3ConfirmState } from "../v3ConfirmRun";
import { freezeConfirmEntries } from "../v3Confirm";
import type { MonthSource } from "../v3MonthSources";
import type { CreatableDraft, DraftPostOutcome } from "@/app/utils/monthDraftCreate";
import type { FairnessMonthsPut } from "@/app/utils/fairnessVocabulary";
import { ALL_IN } from "./v3Fixtures";

const src = (month: string, state: MonthSource["state"], rev: string | null): MonthSource => ({
  month, state, rev, recordedAt: null,
  body: { month, people: [{ memberId: "m-ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }], presence: [] },
});
const ENTRIES = freezeConfirmEntries([src("2026-11", "recorded_unbound", "r-nov"), src("2026-12", "unrecorded", null)], "auto");
const draft = (localId: string, date: string): CreatableDraft => ({
  localId, creationRequestId: `req-${localId}`, _type: "sunday_role", date, countsForFairness: true,
  leads: ["m-ana"], bgvs: [], chorus: [], instruments: [], foh: [],
});
const DRAFTS = [draft("n2", "2026-11-08"), draft("d1", "2026-12-06"), draft("n1", "2026-11-01")];
const okPut = (outcomes = ["replaced", "created"]) => vi.fn(async (_body: FairnessMonthsPut) => ({
  status: 200, body: { months: ["2026-11", "2026-12"].map((month, i) => ({ month, outcome: outcomes[i], rev: "x", contentHash: "sha256:x", recordedAt: "t" })) },
}));

function attempt(over: Partial<Parameters<typeof runV3ConfirmAttempt>[0]> = {}) {
  const log: string[] = [];
  const putRecords = over.putRecords ?? okPut();
  const postDraft = over.postDraft ?? vi.fn(async (_body: { creationRequestId: string }): Promise<DraftPostOutcome> => ({ ok: true, status: 201 }));
  const tracedPut = vi.fn(async (body: FairnessMonthsPut) => { log.push("PUT"); return putRecords(body); });
  const tracedPost = vi.fn(async (body: { creationRequestId: string; date: string }) => { log.push(`POST ${body.date}`); return postDraft(body as never); });
  const run = runV3ConfirmAttempt({
    entries: ENTRIES, months: ["2026-11", "2026-12"], drafts: DRAFTS, published: false,
    state: INITIAL_V3_CONFIRM_STATE, currentMonth: "2026-10",
    ...over, putRecords: tracedPut, postDraft: tracedPost as never,
  });
  return { run, log, tracedPut, tracedPost };
}

describe("order (CF-4, CF-5)", () => {
  it("exactly one PUT carrying every month's frozen entry, then POSTs oldest first, month by month", async () => {
    const { run, log, tracedPut } = attempt();
    const out = await run;
    expect(log).toEqual(["PUT", "POST 2026-11-01", "POST 2026-11-08", "POST 2026-12-06"]);
    expect(tracedPut.mock.calls[0][0]).toEqual({ months: ENTRIES.map((e) => e.write) });
    expect(out).toMatchObject({ kind: "drafts", complete: true, lines: [], retry: false });
  });

  it("a recordless month that gets no draft from this confirm still gets its create entry (A27)", async () => {
    const { run, tracedPut } = attempt({ drafts: [draft("n1", "2026-11-01")] });
    await run;
    expect(tracedPut.mock.calls[0][0].months.map((m) => [m.month, m.expectedRev])).toEqual([["2026-11", "r-nov"], ["2026-12", null]]);
  });
});

describe("the record step (CF-4): any refusal or unexpected outcome creates no draft", () => {
  it.each([
    ["a refusal", vi.fn(async () => ({ status: 409, body: { error: "integrity_conflict", conflict: true, details: { detail: "month_has_services", months: [{ month: "2026-11", verdict: "month_has_services" }] } } })), false],
    ["an unexpected outcome", okPut(["created", "created"]), true],
    ["a network error", vi.fn(async () => { throw new TypeError("fetch failed"); }), true],
    ["a 500", vi.fn(async () => ({ status: 500, body: null })), true],
  ])("%s → zero POSTs, the record line, retry %s", async (_name, putRecords, retry) => {
    const { run, tracedPost } = attempt({ putRecords: putRecords as never });
    const out = await run;
    expect(tracedPost).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "record_failed", retry, state: { recordsDone: false } });
  });
});

describe("drafts (CF-5, CF-6)", () => {
  it("a failure in month 1 ⇒ zero POSTs for month 2, and one line per month", async () => {
    const postDraft = vi.fn(async (body: { creationRequestId: string }): Promise<DraftPostOutcome> =>
      body.creationRequestId === "req-n2" ? { ok: false, status: 500 } : { ok: true, status: 201 });
    const { run, log } = attempt({ postDraft: postDraft as never });
    const out = await run;
    expect(log).toEqual(["PUT", "POST 2026-11-01", "POST 2026-11-08"]);
    expect(out).toMatchObject({
      kind: "drafts", complete: false, retry: true,
      lines: ["Noviembre: 1 de 2 creados; 1 fallaron.", "Diciembre: no se intentó porque noviembre quedó incompleto."],
    });
  });

  it("a draft 409 adds today's note to its month's line; a thrown POST is a failure, never a creation (CF-11)", async () => {
    const postDraft = vi.fn(async (body: { creationRequestId: string }): Promise<DraftPostOutcome> => {
      if (body.creationRequestId === "req-n1") return { ok: false, status: 409, error: "stale_revision" };
      if (body.creationRequestId === "req-n2") throw new TypeError("network");
      return { ok: true, status: 201 };
    });
    const { run } = attempt({ postDraft: postDraft as never });
    const out = await run;
    if (out.kind !== "drafts") throw new Error(out.kind);
    expect(out.lines[0]).toBe("Noviembre: 0 de 2 creados; 2 fallaron. Alguien más cambió esas fechas: recarga y revisa.");
    expect([...out.state.createdLocalIds]).toEqual([]);
  });
});

describe("«Reintentar» resends only what is missing (CF-7)", () => {
  it("after a month-1 failure: no PUT again, only the missing draft with its same id, then month 2", async () => {
    const failOnce = vi.fn()
      .mockImplementationOnce(async () => ({ ok: true, status: 201 }))
      .mockImplementationOnce(async () => ({ ok: false, status: 500 }));
    const first = attempt({ postDraft: failOnce as never });
    const one = await first.run;
    if (one.kind !== "drafts") throw new Error(one.kind);
    expect(pendingCount(DRAFTS, one.state)).toBe(2);
    const second = attempt({ state: one.state });
    await second.run;
    expect(second.log).toEqual(["POST 2026-11-08", "POST 2026-12-06"]);
    expect(second.tracedPost.mock.calls[0][0]).toMatchObject({ creationRequestId: "req-n2" });
  });

  it("a month-2-only failure: the retry posts only month 2's missing draft", async () => {
    const post = vi.fn(async (body: { creationRequestId: string }): Promise<DraftPostOutcome> =>
      body.creationRequestId === "req-d1" ? { ok: false, status: 503 } : { ok: true, status: 201 });
    const one = await attempt({ postDraft: post as never }).run;
    if (one.kind !== "drafts") throw new Error(one.kind);
    const second = attempt({ state: one.state });
    await second.run;
    expect(second.log).toEqual(["POST 2026-12-06"]);
  });

  it.each([
    ["recorded-unbound (the pre-replace rev)", "recorded_unbound" as const, "r-nov"],
    ["unrecorded (expectedRev null)", "unrecorded" as const, null],
    ["bound", "bound" as const, "r-nov"],
  ])("a lost-response replay of a %s entry is byte-identical and answers `unchanged`", async (_name, state, rev) => {
    const entries = freezeConfirmEntries([src("2026-11", state, rev)], "auto");
    const bodies: string[] = [];
    const lost = vi.fn(async (body: FairnessMonthsPut) => { bodies.push(JSON.stringify(body)); throw new TypeError("lost response"); });
    const replay = vi.fn(async (body: FairnessMonthsPut) => {
      bodies.push(JSON.stringify(body));
      return { status: 200, body: { months: [{ month: "2026-11", outcome: "unchanged", rev: "x", contentHash: "sha256:x", recordedAt: "t" }] } };
    });
    const one = await attempt({ entries, months: ["2026-11"], drafts: [draft("n1", "2026-11-01")], putRecords: lost }).run;
    expect(one).toMatchObject({ kind: "record_failed", retry: true });
    const two = await attempt({ entries, months: ["2026-11"], drafts: [draft("n1", "2026-11-01")], putRecords: replay, state: one.state }).run;
    expect(two).toMatchObject({ kind: "drafts", complete: true });
    expect(bodies[0]).toBe(bodies[1]);
  });
});

describe("the guard runs on EVERY attempt (CF-1, A40, HZ-9)", () => {
  it("a first attempt across the month boundary writes nothing and offers no «Reintentar»", async () => {
    const { run, tracedPut, tracedPost } = attempt({ currentMonth: "2026-12" });
    const out = await run;
    expect(out).toEqual({ kind: "refused_guard", lines: ["Noviembre ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto."], state: INITIAL_V3_CONFIRM_STATE, retry: false });
    expect(tracedPut).not.toHaveBeenCalled();
    expect(tracedPost).not.toHaveBeenCalled();
  });

  it("a «Reintentar» after the boundary (records landed, month 1 partly drafted) refuses too, with the «nada más» line", async () => {
    const landed: V3ConfirmState = { recordsDone: true, createdLocalIds: new Set(["n1"]) };
    const { run, tracedPut, tracedPost } = attempt({ state: landed, currentMonth: "2026-12" });
    const out = await run;
    expect(tracedPut).not.toHaveBeenCalled();
    expect(tracedPost).not.toHaveBeenCalled();
    expect(out.kind).toBe("refused_guard");
    expect(out.lines[0]).toBe("Noviembre ya pasó mientras planeabas, así que no se creó nada más. Lo ya creado se queda; completa lo que falta en «Editar mes».");
    expect(out.lines).toContain("Noviembre: 1 de 2 creados; 1 fallaron.");
    expect(out.lines).toContain("Diciembre: no se intentó porque noviembre quedó incompleto.");
    expect(out.retry).toBe(false);
  });

  it("a «Reintentar» after the boundary when the records landed but EVERY draft failed: the «ningún servicio» line plus CF-6's per-month lines", async () => {
    const recordsOnly: V3ConfirmState = { recordsDone: true, createdLocalIds: new Set() };
    const { run, tracedPut, tracedPost } = attempt({ state: recordsOnly, currentMonth: "2026-12" });
    const out = await run;
    expect(tracedPut).not.toHaveBeenCalled();
    expect(tracedPost).not.toHaveBeenCalled();
    expect(out).toEqual({
      kind: "refused_guard",
      lines: [
        "Noviembre ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto.",
        "Noviembre: 0 de 2 creados; 2 fallaron.",
        "Diciembre: no se intentó porque noviembre quedó incompleto.",
      ],
      state: recordsOnly,
      retry: false,
    });
  });

  it("a month past the ceiling refuses before writing (HZ-9), the entry set unchanged", async () => {
    const { run, tracedPut } = attempt({ months: ["2027-11"], currentMonth: "2026-10" });
    const out = await run;
    expect(out.lines).toEqual(["Auto no planea más de 12 meses adelante: Noviembre queda fuera. Elige un mes hasta octubre."]);
    expect(tracedPut).not.toHaveBeenCalled();
  });
});

describe("publishing passes through for a 1-month confirm (CF-8)", () => {
  it("posts with published: true when asked", async () => {
    const seen: boolean[] = [];
    const post = vi.fn(async (body: { published: boolean }): Promise<DraftPostOutcome> => { seen.push(body.published); return { ok: true, status: 201 }; });
    await attempt({ published: true, postDraft: post as never }).run;
    expect(seen.every(Boolean)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/admin/__tests__/v3ConfirmRun.test.ts`
Expected: FAIL — `Cannot find module '../v3ConfirmRun'`.

- [ ] **Step 3: Write the executor** — Create `app/components/admin/v3ConfirmRun.ts`

```ts
// app/components/admin/v3ConfirmRun.ts — solver v3 C6 §5.11 (CRITICAL), ONE confirm attempt.
//
// Transports are injected (the component passes `fetch`-based ones; tests pass fakes); no global
// `fetch` is called here. Each attempt, in order:
//   1. the guard (CF-1, A40, HZ-9) on the client's CDMX month AT THIS ATTEMPT — a horizon month that
//      became past, or one past C2's ceiling, refuses before anything is written; no «Reintentar»;
//   2. the records (CF-4): every month's frozen entry in ONE `PUT /api/admin/fairness/months`
//      (all-or-nothing, C2 WR-9), resent byte-identical until it lands, never after (CF-7). A replay
//      of a PUT that did land answers `unchanged` by C2's decision order (WR-8 row 1);
//   3. the drafts (CF-5): oldest first, month by month, each with its stable `creationRequestId`
//      through today's `runDraftCreateBatch`; a month starts only if every creatable draft of the
//      earlier months was created;
//   4. the report (CF-6): one line per month; nothing is deleted or rewritten to compensate.
// Only confirmed successes enter `createdLocalIds` (today's invariant, CF-6).

import type { FairnessMonthsPut } from "@/app/utils/fairnessVocabulary";
import { runDraftCreateBatch, type CreatableDraft, type DraftPostOutcome, type draftCreateBody } from "@/app/utils/monthDraftCreate";
import {
  classifyRecordPut, confirmGuard, draftsByMonth, guardLine, monthReportLines, recordRetryOffered, recordVerdictLine,
  type MonthProgress, type PutAnswer, type V3ConfirmEntry,
} from "./v3Confirm";

export interface V3ConfirmState {
  /** The PUT landed (an expected outcome for every month) — it is never sent again in this confirm. */
  recordsDone: boolean;
  /** Drafts this confirm's attempts confirmed created (HTTP ok, replays included). */
  createdLocalIds: ReadonlySet<string>;
}

export const INITIAL_V3_CONFIRM_STATE: V3ConfirmState = Object.freeze({ recordsDone: false, createdLocalIds: new Set<string>() });

export type V3ConfirmResult =
  | { kind: "refused_guard"; lines: string[]; state: V3ConfirmState; retry: false }
  | { kind: "record_failed"; lines: string[]; state: V3ConfirmState; retry: boolean }
  | { kind: "drafts"; complete: boolean; lines: string[]; state: V3ConfirmState; progress: MonthProgress[]; retry: boolean; createdNow: string[] };

/** «Reintentar ({n} pendientes)»: the drafts not yet created. */
export function pendingCount(drafts: readonly CreatableDraft[], state: V3ConfirmState): number {
  return drafts.filter((d) => !state.createdLocalIds.has(d.localId)).length;
}

/** Where a confirm's CONFIRMED creations leave each month (unknown outcomes count as not created, today's rule): a month after an incomplete one was never attempted. */
export function progressFrom(drafts: readonly CreatableDraft[], months: readonly string[], created: ReadonlySet<string>): MonthProgress[] {
  let blocked = false;
  return draftsByMonth(drafts, months)
    .filter((g) => g.drafts.length > 0)
    .map((g) => {
      const done = g.drafts.filter((d) => created.has(d.localId)).length;
      const entry = { month: g.month, total: g.drafts.length, created: done, failed: blocked ? 0 : g.drafts.length - done, attempted: !blocked, conflict: false };
      if (done < g.drafts.length) blocked = true;
      return entry;
    });
}

export async function runV3ConfirmAttempt(input: {
  entries: readonly V3ConfirmEntry[];
  months: readonly string[];
  drafts: readonly CreatableDraft[];
  published: boolean;
  state: V3ConfirmState;
  currentMonth: string;
  putRecords: (body: FairnessMonthsPut) => Promise<{ status: number; body: unknown }>;
  postDraft: (body: ReturnType<typeof draftCreateBody>) => Promise<DraftPostOutcome>;
}): Promise<V3ConfirmResult> {
  // 1. The guard, every attempt (CF-1). The entry set is never shrunk to drop a past month. Once the
  //    records landed, CF-6's per-month lines follow the past line (spec §5.11 failure table) — also
  //    when every draft failed; the «nada más» variant is for a confirm that already created drafts.
  const guard = confirmGuard(input.months, input.currentMonth);
  if (guard) {
    const createdBefore = input.state.createdLocalIds.size > 0;
    return {
      kind: "refused_guard",
      lines: [guardLine(guard, createdBefore), ...(input.state.recordsDone ? monthReportLines(progressFrom(input.drafts, input.months, input.state.createdLocalIds)) : [])],
      state: input.state,
      retry: false,
    };
  }

  // 2. Records first, atomically, until they land (CF-4, CF-7).
  let state = input.state;
  if (!state.recordsDone) {
    let answer: PutAnswer;
    try {
      const res = await input.putRecords({ months: input.entries.map((e) => e.write) });
      answer = { kind: "http", status: res.status, body: res.body };
    } catch {
      answer = { kind: "threw" };
    }
    const verdict = classifyRecordPut(input.entries, answer);
    if (!verdict.ok) return { kind: "record_failed", lines: [recordVerdictLine(verdict)], state, retry: recordRetryOffered(verdict) };
    state = { ...state, recordsDone: true };
  }

  // 3. Drafts oldest first, month by month (CF-5).
  const created = new Set(state.createdLocalIds);
  const createdNow: string[] = [];
  const progress: MonthProgress[] = [];
  let blocked = false;
  for (const { month, drafts } of draftsByMonth(input.drafts, input.months)) {
    if (drafts.length === 0) continue;
    const pending = drafts.filter((d) => !created.has(d.localId));
    if (blocked) {
      progress.push({ month, total: drafts.length, created: drafts.length - pending.length, failed: 0, attempted: false, conflict: false });
      continue;
    }
    const batch = await runDraftCreateBatch({ drafts: pending, published: input.published, post: input.postDraft });
    for (const id of batch.createdLocalIds) {
      created.add(id);
      createdNow.push(id);
    }
    const done = drafts.filter((d) => created.has(d.localId)).length;
    progress.push({
      month, total: drafts.length, created: done, failed: batch.failed.length, attempted: true,
      conflict: batch.failed.some((f) => f.status === 409),
    });
    if (done < drafts.length) blocked = true;
  }
  state = { ...state, createdLocalIds: created };
  const complete = progress.every((p) => p.created === p.total);
  return { kind: "drafts", complete, lines: complete ? [] : monthReportLines(progress), state, progress, retry: !complete, createdNow };
}
```

- [ ] **Step 4: Run it, then the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/v3ConfirmRun.test.ts app/utils/__tests__/monthDraftCreate.test.ts`
Expected: PASS (today's batch suite unchanged).
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(planner): the v3 confirm executor — records first, atomically, then drafts by month

One confirm attempt refuses a horizon month that became past (or lies beyond the writer's ceiling)
before writing anything, on every attempt, «Reintentar» included. It then sends every month's frozen
record entry in one all-or-nothing PUT, again byte-identical until it lands and never after, and
only then posts the drafts oldest first with today's stable request ids, starting a month only when
every draft of the months before it exists. A failure leaves one line per month and deletes
nothing; a retry sends exactly what is still missing."
```

---

## Task 19: The confirm in the planner — frozen entries, the no-Auto path, footer, per-month history, the incomplete-plan dialog (CF-1–CF-11 wired) — **[CRITICAL]**

**Files:**
- Create: `app/components/admin/V3IncompleteDialog.tsx`
- Modify: `app/components/admin/MonthGenerator.tsx` — module-level `postDraftToRoles` (the existing inline POST, moved, unchanged); state for the frozen entries and the confirm; `applyV3AutoResult` freezes the entries; Task 15's `handleAutoV3` refuses to start while a confirm is in flight, and `confirmV3`, the v3 Crear buttons and «Reintentar» refuse while a v3 Auto is pending (the two-way lock); `handleConfirm` dispatches to `confirmV3` after today's re-checks (`:4188-4241`); the create footer (`:5154-5172`); the Escape handler (`:2597-2613`); the config step's early return (`:4410-4411`) and its «Cancelar» (`:4515`) — the incomplete-plan dialog is mounted in BOTH step branches, because the config step is an early return
- Create (test): `app/components/admin/__tests__/MonthGenerator.v3Confirm.test.tsx`
- Regenerate: `colour-inventory.json`

**Interfaces:**
- Consumes: Task 17 (`freezeConfirmEntries`, `confirmGuard`, `guardLine`, `draftsByMonth`, `twoMonthSummaryLine`, `monthReportLines`, `MonthProgress`, `V3ConfirmEntry`); Task 18 (`runV3ConfirmAttempt`, `progressFrom`, `INITIAL_V3_CONFIRM_STATE`, `V3ConfirmState`, `V3ConfirmResult`); Task 13 (`isLedgerBody`, `V3_LEDGER_TIMEOUT_MS`); Task 6 (`resolveMonthSources`); Task 15's `applyV3AutoResult`, `v3Run`; today's `historyEntryFromDrafts`, `appendLocalHistoryEntry`, `saveHistoryEntry`, `createdTargets`, `draftTargetKey`, `isCreatable`.
- Produces: `V3IncompleteDialog({ open, gaps, onLeave, onStay })`; inside `MonthGenerator`: `confirmV3(toCreateNow, publish)`, `freezeEntriesWithoutAuto(months)`, `afterV3Attempt(result, session, attemptDrafts)`, `mergeV3Gaps(progress)`, `reportV3(key, lines)`, the element `incompleteDialog` (rendered in both step branches), `v3HasGaps`; ref `v3EntriesRef: Map<horizonKey, V3ConfirmEntry[]>`; state `v3Confirm` (a `V3ConfirmSession`), `v3Report: { key; lines } | null` (shown only for its own horizon), `v3Gaps` (session-wide, by month — never keyed by horizon), `incompleteOpen`.

- [ ] **Step 1: Write the failing component test** — `app/components/admin/__tests__/MonthGenerator.v3Confirm.test.tsx`

```tsx
/** @vitest-environment jsdom */
// Solver v3 C6 §5.11 (CRITICAL), wired: after a v3 Auto the confirm sends ONE PUT with the entries
// frozen at the solve (the revision read then, never re-read), then the drafts; without an Auto it
// reads the ledger fresh first; a refusal creates nothing and keeps the dialog open; a 2-month confirm
// has no publish; one history entry per month; leaving with gaps asks first, from either step.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { echoV3, renderV3, routeFetch, solveRoute } from "./v3PlannerHarness";
import { deselectAll, selectSundayLead } from "./plannerWiringHarness";
import { ALL_IN, MEMBERS, config, ledgerResponse, record } from "./v3Fixtures";
import { resolveMonthSources } from "../v3MonthSources";
import type { FairnessLedgerResponse, FairnessMonthsPut } from "@/app/utils/fairnessVocabulary";

const POOLS = config({ sundayLeads: ["m-ana", "m-bruno"], support: ["m-dani"] });
const historyRoute = (url: string) => (url.startsWith("/api/admin/solver-history?") ? { status: 500, body: {} } : undefined);

function ledgerRouteSwitchable(initial: (months: string[]) => FairnessLedgerResponse) {
  let answer = initial;
  const reads: string[] = [];
  return {
    reads,
    set: (next: typeof initial) => { answer = next; },
    route: (url: string) => {
      if (!url.startsWith("/api/admin/fairness?")) return undefined;
      reads.push(url);
      const q = new URLSearchParams(url.split("?")[1]);
      const months = q.get("horizon") === "2" ? [q.get("month")!, "2026-12"] : [q.get("month")!];
      return { status: 200, body: answer(months) };
    },
  };
}
function putRoute(respond: (body: FairnessMonthsPut, n: number) => { status: number; body: unknown }) {
  const bodies: string[] = [];
  return {
    bodies,
    route: (url: string, init?: RequestInit) => {
      if (url !== "/api/admin/fairness/months" || init?.method !== "PUT") return undefined;
      bodies.push(String(init.body));
      return respond(JSON.parse(String(init.body)) as FairnessMonthsPut, bodies.length);
    },
  };
}
function postRoute(respond: (body: { creationRequestId: string; date: string; published: boolean }, n: number) => { status: number; body: unknown } = () => ({ status: 201, body: {} })) {
  const bodies: Array<{ creationRequestId: string; date: string; published: boolean }> = [];
  return {
    bodies,
    route: (url: string, init?: RequestInit) => {
      if (url !== "/api/admin/roles" || init?.method !== "POST") return undefined;
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      return respond(body, bodies.length);
    },
  };
}
const outcomes = (months: string[], outcome = "created") => ({
  status: 200, body: { months: months.map((month) => ({ month, outcome, rev: "new", contentHash: "sha256:x", recordedAt: "t" })) },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:00:00.000Z"));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const onlySundays = (container: HTMLElement, keep: string[]) => {
  deselectAll(container, "saturday");
  for (const el of Array.from(container.querySelectorAll('[data-day-kind="sunday"]'))) {
    const date = el.getAttribute("data-date")!;
    if (!keep.includes(date) && el.getAttribute("data-selected") === "true") fireEvent.click(el);
  }
};
const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
const runAuto = () => {
  fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
};
const createDrafts = () => fireEvent.click(screen.getByRole("button", { name: /^Crear \d+ borrador/ }));

describe("after a v3 Auto (CF-1–CF-5)", () => {
  it("ONE PUT with the entries frozen at the solve — the revision read then, not a re-read — then the POSTs by date", async () => {
    const recNov = record("2026-11", [{ memberId: "m-ana", name: "Ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }], { rev: "rev-at-auto" });
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m, { horizon: [{ record: recNov, storedServices: 0, recordBinds: false }] }));
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month), "replaced"));
    const post = postRoute();
    const { calls } = routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08", "2026-11-01"]);
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied, not just sent
    // Someone replaces the record meanwhile: the confirm must still assert the rev it SOLVED with (WR-15).
    ledger.set((m) => ledgerResponse(m, { horizon: [{ record: { ...recNov, rev: "rev-later" }, storedServices: 0, recordBinds: false }] }));
    const readsBefore = ledger.reads.length;
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(post.bodies).toHaveLength(2));
    expect(ledger.reads.length).toBe(readsBefore);                                   // no re-read before the PUT
    expect(put.bodies).toHaveLength(1);
    const sent = JSON.parse(put.bodies[0]) as FairnessMonthsPut;
    expect(sent.months).toHaveLength(1);
    expect(sent.months[0]).toMatchObject({ month: "2026-11", source: "auto", expectedRev: "rev-at-auto" });
    const order = calls.map((c) => c.url).filter((u) => u === "/api/admin/fairness/months" || u === "/api/admin/roles");
    expect(order).toEqual(["/api/admin/fairness/months", "/api/admin/roles", "/api/admin/roles"]);
    expect(post.bodies.map((b) => b.date)).toEqual(["2026-11-01", "2026-11-08"]);
  });

  it("CF-2: pools edited after Auto — the record sent is the SOLVED one, never a re-resolution of the screen", async () => {
    const recNov = record("2026-11", [{ memberId: "m-ana", name: "Ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }], { rev: "rev-at-auto" });
    const ledgerBody = (m: string[]) => ledgerResponse(m, { horizon: [{ record: recNov, storedServices: 0, recordBinds: false }] });
    const ledger = ledgerRouteSwitchable(ledgerBody);
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month), "replaced"));
    const post = postRoute();
    routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied, not just sent
    // Back to the config step (the board has a seat, so the discard banner asks), drop Bruno from
    // «Líderes Domingo», preview again — the board is rebuilt, the frozen record is not.
    fireEvent.click(screen.getByRole("button", { name: "← Volver" }));
    fireEvent.click(screen.getByRole("button", { name: "Volver de todos modos" }));
    selectSundayLead(container, "Bruno");
    preview();
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(post.bodies).toHaveLength(1));
    const brunoSunLead = (cfg: typeof POOLS) => {
      const sources = resolveMonthSources({ months: ["2026-11"], ledger: ledgerBody(["2026-11"]), config: cfg, members: MEMBERS, exactLeadLabel: () => null });
      if (!sources.ok) throw new Error(sources.lines.join());
      return sources.sources[0].body.people.find((p) => p.memberId === "m-bruno")?.roles["Sun.Lead"];
    };
    const solved = brunoSunLead(POOLS);
    const edited = brunoSunLead(config({ sundayLeads: ["m-ana"], support: ["m-dani"] }));
    expect(solved).not.toEqual(edited);                                                // the fixture discriminates
    const sent = (JSON.parse(put.bodies[0]) as FairnessMonthsPut).months[0];
    expect(sent).toMatchObject({ month: "2026-11", source: "auto", expectedRev: "rev-at-auto" });
    expect(sent.people.find((p) => p.memberId === "m-bruno")?.roles["Sun.Lead"]).toEqual(solved);
  });

  it("a record refusal creates NO draft, keeps the dialog open with its line, and offers no «Reintentar»", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute(() => ({ status: 409, body: { error: "stale_revision", message: "x", conflict: true, details: { detail: "record_exists", months: [{ month: "2026-11", verdict: "record_exists" }] } } }));
    const post = postRoute();
    const onClose = vi.fn();
    routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS, onClose });
    onlySundays(container, ["2026-11-08"]);
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied, not just sent
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("Otro administrador registró o cambió la elegibilidad de noviembre mientras planeabas. No se creó nada; vuelve a correr Auto.")).toBeTruthy());
    expect(post.bodies).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Reintentar \(/ })).toBeNull();
  });

  it("«other failure» offers «Reintentar (n pendientes)», whose PUT body is byte-identical (CF-7)", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute((b, n) => (n === 1 ? { status: 500, body: null } : outcomes(b.months.map((x) => x.month))));
    const post = postRoute();
    routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied, not just sent
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("No se pudo registrar la elegibilidad. No se creó nada; pulsa «Reintentar».")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reintentar (1 pendientes)" })); });
    await waitFor(() => expect(post.bodies).toHaveLength(1));
    expect(put.bodies[1]).toBe(put.bodies[0]);
  });

  it("CF-1: across the month boundary the confirm writes nothing and offers no «Reintentar»", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute();
    routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied, not just sent
    vi.setSystemTime(new Date("2026-12-01T12:00:00.000Z"));
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("Noviembre ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto.")).toBeTruthy());
    expect(put.bodies).toHaveLength(0);
    expect(post.bodies).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Reintentar \(/ })).toBeNull();
  });

  it("the lock's other half (CF-2, CF-7): while a v3 Auto is pending both Crear buttons are disabled and no PUT goes out", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute();
    const { mock } = routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    // Hold the solve open so the run stays pending; every other call goes straight to the routes.
    let release!: () => void;
    const solveGate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/solve") await solveGate;
      return mock(url, init);
    });
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText("Calculando...")).toBeTruthy());
    expect((screen.getByRole("button", { name: /^Crear \d+ borrador/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Crear y publicar" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { createDrafts(); });                                      // a click on the disabled button does nothing
    expect(put.bodies).toHaveLength(0);
    expect(post.bodies).toHaveLength(0);
    await act(async () => { release(); });
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(post.bodies).toHaveLength(1));
    expect(put.bodies).toHaveLength(1);
  });
});

describe("without a v3 Auto (CF-2's fresh read)", () => {
  it("reads the ledger fresh at the first confirm and sends the screen's body as `manual`", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute();
    routeFetch(historyRoute, ledger.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    const readsBefore = ledger.reads.length;
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(post.bodies).toHaveLength(1));
    expect(ledger.reads.length).toBe(readsBefore + 1);
    expect(JSON.parse(put.bodies[0]).months[0]).toMatchObject({ month: "2026-11", source: "manual", expectedRev: null });
  });

  it("a failed read creates nothing", async () => {
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute();
    routeFetch(historyRoute, (url) => (url.startsWith("/api/admin/fairness?") ? { status: 500, body: { error: "fairness_unavailable" } } : undefined), put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("No se pudo leer el saldo de equidad. Auto no corrió; vuelve a intentar.")).toBeTruthy());
    expect(put.bodies).toHaveLength(0);
    expect(post.bodies).toHaveLength(0);
  });

  it("HZ-9: a month past the ceiling refuses with nothing read or written", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    routeFetch(historyRoute, ledger.route, put.route, postRoute().route);
    const { container } = renderV3({ config: POOLS, initialMonth: "2027-11" });
    onlySundays(container, ["2027-11-07"]);
    preview();
    const readsBefore = ledger.reads.length;
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("Auto no planea más de 12 meses adelante: Noviembre queda fuera. Elige un mes hasta octubre.")).toBeTruthy());
    expect(ledger.reads.length).toBe(readsBefore);
    expect(put.bodies).toHaveLength(0);
  });
});

describe("CF-8, CF-9, CF-10", () => {
  it("a 2-month confirm has no «Crear y publicar» and says each month's count; a 1-month one keeps it", () => {
    routeFetch(historyRoute, ledgerRouteSwitchable((m) => ledgerResponse(m)).route);
    const { container } = renderV3({ config: POOLS });
    fireEvent.click(screen.getByRole("radio", { name: "2 meses" }));
    onlySundays(container, ["2026-11-08", "2026-12-06"]);
    preview();
    expect(screen.queryByRole("button", { name: "Crear y publicar" })).toBeNull();
    expect(screen.getByText("Noviembre: 1 · Diciembre: 1. Se crean como borradores; publícalos después.")).toBeTruthy();
    cleanup();
    routeFetch(historyRoute, ledgerRouteSwitchable((m) => ledgerResponse(m)).route);
    renderV3({ config: POOLS });
    preview();
    expect(screen.getByRole("button", { name: "Crear y publicar" })).toBeTruthy();
  });

  it("one history entry per month with a weekend draft created (two for a 2-month confirm)", async () => {
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute();
    routeFetch(historyRoute, ledgerRouteSwitchable((m) => ledgerResponse(m)).route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    fireEvent.click(screen.getByRole("radio", { name: "2 meses" }));
    onlySundays(container, ["2026-11-08", "2026-12-06"]);
    preview();
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(post.bodies).toHaveLength(2));
    const entries = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]") as Array<{ year: number; month: number }>;
    expect(entries.map((e) => [e.year, e.month]).sort()).toEqual([[2026, 11], [2026, 12]]);
  });

  async function partialFailure(onClose = vi.fn()) {
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute((_b, n) => (n === 1 ? { status: 201, body: {} } : { status: 500, body: { error: "x" } }));
    routeFetch(historyRoute, ledgerRouteSwitchable((m) => ledgerResponse(m)).route, put.route, post.route);
    const { container } = renderV3({ config: POOLS, onClose });
    onlySundays(container, ["2026-11-01", "2026-11-08"]);
    preview();
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("Noviembre: 1 de 2 creados; 1 fallaron.")).toBeTruthy());
    return { onClose, container };
  }
  const incomplete = () => screen.queryByRole("dialog", { name: "El plan quedó incompleto" });

  it("«Cancelar» after a partial failure asks «El plan quedó incompleto»; «Seguir aquí» stays, «Salir así» leaves", async () => {
    const { onClose } = await partialFailure();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(incomplete()).toBeTruthy();
    expect(screen.getByText(/Noviembre: faltan 1 servicios\. Si sales, se quedan así; puedes completarlos en «Editar mes»\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));
    await waitFor(() => expect(incomplete()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });                                   // Escape asks too
    expect(incomplete()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salir así" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the CONFIG step asks too: «← Volver» then «Cancelar», and Escape there, open the dialog — never an unprompted exit", async () => {
    const { onClose } = await partialFailure();
    fireEvent.click(screen.getByRole("button", { name: "← Volver" }));               // no seat on the board: no discard banner
    expect(screen.getByRole("button", { name: /Previsualizar/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(incomplete()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));
    await waitFor(() => expect(incomplete()).toBeNull());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(incomplete()).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));
    await waitFor(() => expect(incomplete()).toBeNull());
    // The provider lifts the app root's aria-hidden one frame after the last layer leaves; wait for it.
    await waitFor(() => expect(screen.getByRole("button", { name: /Previsualizar/ })).toBeTruthy());
    // Back on the grid the dialog is closed (no stale open state) and the gap is still there to ask about.
    preview();
    expect(incomplete()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(incomplete()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salir así" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run app/components/admin/__tests__/MonthGenerator.v3Confirm.test.tsx`
Expected: FAIL — the v3 confirm still posts drafts without a PUT.

- [ ] **Step 3: Write the dialog** — Create `app/components/admin/V3IncompleteDialog.tsx`

```tsx
"use client";

// Solver v3 C6 CF-10 — leaving the planner after a partial confirm failure asks first. `open` is a
// state prop, never a literal (cueDialogMount.test.ts); «Seguir aquí» and every dismissal keep the
// planner open, «Salir así» leaves the gaps for «Editar mes».

import Button from "@/app/components/ui/Button";
import CueDialog from "@/app/components/ui/CueDialog";
import { V3_LINES } from "./v3Copy";

export default function V3IncompleteDialog({ open, gaps, onLeave, onStay }: {
  open: boolean;
  gaps: ReadonlyArray<{ month: string; missing: number }>;
  onLeave: () => void;
  onStay: () => void;
}) {
  return (
    <CueDialog open={open} title={V3_LINES.incompleteTitle} onDismiss={() => onStay()} size="sm">
      <p className="font-body text-sm text-ink-muted">{V3_LINES.incompleteBody(gaps)}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onStay}>{V3_LINES.stay}</Button>
        <Button variant="danger" onClick={onLeave}>{V3_LINES.leave}</Button>
      </div>
    </CueDialog>
  );
}
```

- [ ] **Step 4: `MonthGenerator` — the shared POST, the state, the frozen entries**

The imports — Task 16's `./v3MonthSources` line gains `resolveMonthSources`; its `./v3AutoRun` line gains `V3_LEDGER_TIMEOUT_MS` (Task 16 already imports `isLedgerBody` — a second import of it would be a duplicate identifier), and the three new imports follow that line. Find `import { displayedMonthStates } from "./v3MonthSources";` → Replace with `import { displayedMonthStates, resolveMonthSources } from "./v3MonthSources";`. Find:
```ts
import { isLedgerBody } from "./v3AutoRun";
```
Replace with:
```ts
import { isLedgerBody, V3_LEDGER_TIMEOUT_MS } from "./v3AutoRun";
import { confirmGuard, draftsByMonth, freezeConfirmEntries, guardLine, monthReportLines, twoMonthSummaryLine, type MonthProgress, type V3ConfirmEntry } from "./v3Confirm";
import { INITIAL_V3_CONFIRM_STATE, progressFrom, runV3ConfirmAttempt, type V3ConfirmResult, type V3ConfirmState } from "./v3ConfirmRun";
import V3IncompleteDialog from "./V3IncompleteDialog";
```

Module level — Find:
```ts
function getDates(year: number, month: number, day: 0 | 6): string[] {
```
Replace with:
```ts
/** The draft create POST, shared by the v2 confirm (unchanged) and the v3 confirm (CF-5: today's mechanism). */
async function postDraftToRoles(body: unknown): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch("/api/admin/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let error: string | undefined;
  if (!res.ok) {
    try {
      error = (await res.json())?.error;
    } catch {
      error = undefined;
    }
  }
  return { ok: res.ok, status: res.status, error };
}

function getDates(year: number, month: number, day: 0 | 6): string[] {
```
In `handleConfirm`, Find:
```tsx
        post: async (body) => {
          const res = await fetch("/api/admin/roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          let error: string | undefined;
          if (!res.ok) {
            try {
              error = (await res.json())?.error;
            } catch {
              error = undefined;
            }
          }
          return { ok: res.ok, status: res.status, error };
        },
```
Replace with:
```tsx
        post: postDraftToRoles,
```
After Task 16's `const allBound = …` line, add:
```ts
  // C6 CF-2: the record entries frozen by the LAST v3 run of each horizon this session (a run of
  // another horizon never evicts them — «if no v3 Auto ran for this horizon in this session»), and the
  // confirm in progress (its frozen entries never change across retries; CF-7).
  const v3EntriesRef = useRef(new Map<string, V3ConfirmEntry[]>());
  type V3ConfirmSession = { key: string; entries: V3ConfirmEntry[]; state: V3ConfirmState; retry: boolean; publish: boolean };
  const [v3Confirm, setV3Confirm] = useState<V3ConfirmSession | null>(null);
  // The last attempt's lines, shown only while their own horizon is on screen (like «Reintentar»).
  const [v3Report, setV3Report] = useState<{ key: string; lines: string[] } | null>(null);
  // CF-10: the months this session's confirms left incomplete, by month, across horizons — those gaps
  // exist in the dataset whichever horizon is on screen, so a horizon change never clears them; only a
  // later attempt that completes a month removes it.
  const [v3Gaps, setV3Gaps] = useState<Array<{ month: string; missing: number }>>([]);
  const [incompleteOpen, setIncompleteOpen] = useState(false);
  const reportV3 = (key: string, lines: readonly string[]) => setV3Report(lines.length > 0 ? { key, lines: [...lines] } : null);
  function mergeV3Gaps(progress: readonly MonthProgress[]) {
    setV3Gaps((prev) => {
      const next = new Map(prev.map((g) => [g.month, g.missing] as const));
      for (const p of progress) {
        if (p.created < p.total) next.set(p.month, p.total - p.created);
        else next.delete(p.month);
      }
      return [...next].sort(([a], [b]) => a.localeCompare(b)).map(([month, missing]) => ({ month, missing }));
    });
  }
```
In Task 15's `applyV3AutoResult`, Find:
```ts
    const { build, outcome } = result;
    if (outcome.kind !== "success") {
```
Replace with:
```ts
    const { build, outcome } = result;
    // CF-2: the entries are frozen with the request, from this run's snapshot — whatever the solve says.
    // A run writes nothing, so the session's gaps (CF-10) stay as they are.
    v3EntriesRef.current.set(horizonKey, freezeConfirmEntries(build.snapshot.sources, "auto"));
    setV3Confirm(null);
    setV3Report(null);
    if (outcome.kind !== "success") {
```
In Task 15's `handleAutoV3`, Find:
```ts
  async function handleAutoV3(config: SolverConfig) {
    const requested = horizon.join(",");
```
Replace with:
```ts
  async function handleAutoV3(config: SolverConfig) {
    // C6 CF-2/CF-7: no run starts while a v3 confirm is in flight, and (the other half, in `confirmV3`
    // and on the v3 Crear buttons) no confirm starts while a run is pending. A run re-freezes the
    // entries and resets the confirm; a confirm overlapping it either way would re-install its old
    // session (`recordsDone: true`) over the new run, and the next confirm would post the new board
    // under the old record without a PUT. Each side's `finally` and its bookkeeping run in one tick, and
    // each refuses while the other's flag is up, so the two-way lock leaves no gap. (v2's `handleAuto`
    // path is untouched.)
    if (pushing) return;
    const requested = horizon.join(",");
```

- [ ] **Step 5: `MonthGenerator` — the v3 confirm**

In `handleConfirm`, Find:
```ts
    if (!toCreateNow.length) return;
    setPushing(true);
    setPushError(null);
    let result;
```
Replace with:
```ts
    if (!toCreateNow.length) return;
    // Solver v3 C6 §5.11: under v3 the confirm writes every horizon month's record first (one PUT),
    // then the drafts month by month — after the SAME gate, nameless-special and preflight re-checks
    // as today. v2 continues below, byte-identical.
    if (isV3) {
      await confirmV3(toCreateNow, publish);
      return;
    }
    setPushing(true);
    setPushError(null);
    let result;
```
The new code goes directly above `handleConfirm` (the block ends with that function's own first line). Find `  async function handleConfirm(publish: boolean) {` → Replace with:
```ts
  /**
   * CF-2's no-Auto path: a fresh read, bound months from their records, every other month from IF2-15.
   * Copy: §7.8 defines no confirm-side line for a failed read or a resolver refusal, so these reuse
   * Auto's (`V3_ROUTE_COPY.ledgerFailed`, «… Auto no corrió …»; the resolver's «No se puede correr
   * Auto: …»). Recorded as a spec gap for the C6 spec owner; the plan invents no line.
   */
  async function freezeEntriesWithoutAuto(months: string[]): Promise<{ ok: true; entries: V3ConfirmEntry[] } | { ok: false; lines: string[] }> {
    if (!solverConfig) return { ok: false, lines: [V3_ROUTE_COPY.ledgerFailed] };
    const controller = new AbortController();
    const ceiling = setTimeout(() => controller.abort(), V3_LEDGER_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/admin/fairness?month=${months[0]}&horizon=${months.length}`, { cache: "no-store", signal: controller.signal });
      const body: unknown = await res.json().catch(() => null);
      if (res.status !== 200 || !isLedgerBody(body, months)) return { ok: false, lines: [V3_ROUTE_COPY.ledgerFailed] };
      const sources = resolveMonthSources({ months, ledger: body, config: solverConfig, members, exactLeadLabel: () => null });
      if (!sources.ok) return { ok: false, lines: sources.lines };
      return { ok: true, entries: freezeConfirmEntries(sources.sources, "manual") };
    } catch {
      return { ok: false, lines: [V3_ROUTE_COPY.ledgerFailed] };
    } finally {
      clearTimeout(ceiling);
    }
  }

  /** §5.11 wired. Client-mutation invariant (CF-11): try/catch/finally, `res.ok` checked by the executor, the flag always reset, never closed as success on failure. */
  async function confirmV3(toCreateNow: DraftCard[], publish: boolean) {
    // The lock's other half (see `handleAutoV3`): never overlap a pending v3 Auto. The Crear buttons and
    // «Reintentar» are disabled on the same flag; this is the protocol-level refusal behind them.
    if (autoPending) return;
    const key = horizon.join(",");
    const months = [...horizon];
    setPushing(true);
    setPushError(null);
    setV3Report(null);
    // A session (and so its frozen entries, CF-2: the set never changes) outlives every refusal. After a
    // refusal that offers no «Reintentar» — a conflict, a past month — a later Crear resends the same
    // entries and repeats the refusal; only a new v3 Auto (which re-freezes and resets) or closing the
    // planner leaves it. That is the spec's own remedy («vuelve a correr Auto», §7.8), not a gap; on the
    // no-Auto path it means running Auto once.
    let current: V3ConfirmSession | null = v3Confirm && v3Confirm.key === key ? v3Confirm : null;
    let attemptDrafts: DraftCard[] = toCreateNow;
    let posted = 0;
    let result: V3ConfirmResult | null = null;
    try {
      const currentMonth = cdmxCurrentMonth(new Date());
      if (!current) {
        let entries = v3EntriesRef.current.get(key) ?? null;
        if (!entries) {
          // CF-1's placement holds on the no-Auto path too: the guard comes before the fresh read.
          const guard = confirmGuard(months, currentMonth);
          if (guard) { reportV3(key, [guardLine(guard, false)]); return; }
          const fresh = await freezeEntriesWithoutAuto(months);
          if (!fresh.ok) { reportV3(key, fresh.lines); return; }
          entries = fresh.entries;
        }
        current = { key, entries, state: INITIAL_V3_CONFIRM_STATE, retry: false, publish };
      }
      const session = current;
      // Totals stay stable across retries: this confirm's created drafts plus what is still to create.
      attemptDrafts = [...drafts.filter((d) => session.state.createdLocalIds.has(d.localId)), ...toCreateNow];
      result = await runV3ConfirmAttempt({
        entries: session.entries,
        months,
        drafts: attemptDrafts,
        published: publish && months.length === 1,                           // CF-8: never in a 2-month confirm
        state: session.state,
        currentMonth,
        putRecords: async (body) => {
          const res = await fetch("/api/admin/fairness/months", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
          return { status: res.status, body: await res.json().catch(() => null) };
        },
        postDraft: async (body) => {
          posted += 1;
          return postDraftToRoles(body);
        },
      });
    } catch {
      // Unreachable by construction — the read, the PUT and every POST are caught where they happen —
      // but never silent and never a false line. A resend is always safe (the PUT replays
      // byte-identical and answers `unchanged`, C2 WR-8 row 1; each draft keeps its creationRequestId),
      // so the confirm stays retryable with the state it had, and a line says «No se creó nada» only
      // when no draft of this confirm can exist.
      if (!current) {
        reportV3(key, [V3_ROUTE_COPY.ledgerFailed]);                        // only the fresh read precedes the session
      } else if (posted === 0 && current.state.createdLocalIds.size === 0) {
        setV3Confirm({ ...current, retry: true });
        reportV3(key, [V3_LINES.recordOtherFailure]);
      } else {
        // Unknown outcomes count as not created (today's rule); «Reintentar» replays them by request id.
        const progress = progressFrom(attemptDrafts, months, current.state.createdLocalIds);
        setV3Confirm({ ...current, retry: true });
        reportV3(key, monthReportLines(progress));
        mergeV3Gaps(progress);
      }
    } finally {
      setPushing(false);
    }
    // Today's order: the flag resets, then the bookkeeping (`handleConfirm` does the same).
    if (result && current) afterV3Attempt(result, current, toCreateNow);
  }

  function afterV3Attempt(result: V3ConfirmResult, session: V3ConfirmSession, attemptDrafts: DraftCard[]) {
    const createdNow = new Set(result.kind === "drafts" ? result.createdNow : []);
    // CF-6: only confirmed successes become `exists`, paired with the `createdTargets` growth (P3 invariant).
    if (createdNow.size > 0) {
      setDrafts((prev) => prev.map((d) => (createdNow.has(d.localId) ? { ...d, exists: true } : d)));
      for (const d of attemptDrafts) if (createdNow.has(d.localId)) createdTargets.current.add(draftTargetKey(d._type, d.date));
      // CF-9 (Q4): one history entry PER MONTH with a weekend draft created this session, built as today.
      for (const m of horizon) {
        const monthDrafts = drafts.filter((d) =>
          d._type !== "special_role" && d.date.slice(0, 7) === m &&
          (createdNow.has(d.localId) || createdTargets.current.has(draftTargetKey(d._type, d.date))));
        const entry = historyEntryFromDrafts(monthDrafts, members, Number(m.slice(0, 4)), Number(m.slice(5, 7)));
        if (!entry) continue;
        if (SOLVER_HISTORY_SOURCE === "derived") appendLocalHistoryEntry(entry);
        else saveHistoryEntry(entry.year, entry.month, entry.total_counts, entry.role_counts);
      }
    }
    // CF-10: once the records landed, every month still missing drafts is a gap, and a month this
    // attempt completed stops being one (a guard refusal or a record failure adds none: the first wrote
    // nothing new, the second nothing at all — the gaps an earlier attempt found are kept).
    if (result.kind === "drafts") {
      onCreated();
      mergeV3Gaps(result.progress);
    }
    if (result.kind === "drafts" && result.complete) {
      // Full success closes as today (CF-10, spec-literal), whatever an earlier horizon's attempt left.
      // Deliberately asymmetric with «Cancelar»/Escape, which ask while `v3Gaps` is non-empty: a gap in a
      // month outside this horizon (e.g. a 2-month confirm left November short, then December alone
      // completed) closes without the dialog. Those services stay as created and «Editar mes» completes
      // them; asking here would add a behaviour CF-10 does not name.
      setV3Confirm(null);
      onClose();
      return;
    }
    setV3Confirm({ ...session, state: result.state, retry: result.retry });
    reportV3(session.key, result.lines);
  }

  async function handleConfirm(publish: boolean) {
```

- [ ] **Step 6: `MonthGenerator` — the dialog in both step branches, the footer (CF-8, CF-7, CF-10), the config step's «Cancelar» and Escape (CF-10)**

The config step is an EARLY RETURN (`if (step === "config") return (…)`, `:4410`), so a dialog mounted only in the grid's JSX is absent there while the Escape effect and the config «Cancelar» can still ask for it. The dialog is therefore ONE element, built once before that return and rendered in both branches (only one branch is ever in the tree, so there is one dialog at a time), and every exit — the grid «Cancelar», the config «Cancelar», Escape in either step — asks through the same `v3HasGaps`. Under v2 the element is `null` and nothing in the v2 surface changes.

Find:
```tsx
  if (step === "config") return (
    <div className="space-y-5">
```
Replace with:
```tsx
  // C6 CF-10: one dialog element for both step branches (the config step returns early).
  const incompleteDialog = isV3 ? (
    <V3IncompleteDialog
      open={incompleteOpen}
      gaps={v3Gaps}
      onStay={() => setIncompleteOpen(false)}
      onLeave={() => { setIncompleteOpen(false); onClose(); }}
    />
  ) : null;
  const v3ShownLines = isV3 && v3Report && v3Report.key === horizon.join(",") ? v3Report.lines : [];

  if (step === "config") return (
    <div className="space-y-5">
      {incompleteDialog}
```
The config step's «Cancelar» — Find:
```tsx
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors">
          Cancelar
        </button>
```
Replace with:
```tsx
        <button type="button" onClick={() => { if (v3HasGaps) { setIncompleteOpen(true); return; } onClose(); }} className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors">
          Cancelar
        </button>
```
The grid step's footer — Find:
```tsx
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              if (storedTransportActive) return;
              if (closeWouldDiscard) { setPendingDiscard("close"); return; }
              onClose();
            }}
```
Replace with:
```tsx
      ) : (
        <>
        {isV3 && horizon.length === 2 && toCreate.length > 0 && (
          <p className="font-body text-xs text-ink-muted">{twoMonthSummaryLine(draftsByMonth(toCreate, horizon))}</p>
        )}
        {v3ShownLines.length > 0 && (
          <div data-v3-confirm-report="" className="space-y-1">
            {v3ShownLines.map((line) => <p key={line} className="font-body text-xs text-negative-fg">{line}</p>)}
            {v3Confirm?.retry && v3Confirm.key === horizon.join(",") && (
              <Button variant="secondary" size="sm" disabled={pushing || autoPending} onClick={() => { void handleConfirm(v3Confirm.publish); }}>
                {V3_LINES.retry(toCreate.length)}
              </Button>
            )}
          </div>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              if (storedTransportActive) return;
              if (v3HasGaps) { setIncompleteOpen(true); return; }
              if (closeWouldDiscard) { setPendingDiscard("close"); return; }
              onClose();
            }}
```
Find:
```tsx
          <button type="button" onClick={() => handleConfirm(false)} disabled={pushing || toCreate.length === 0 || !!gateBlocked} title={gateBlocked ?? undefined} className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
            {pushing ? "Creando..." : `Crear ${toCreate.length} borrador${toCreate.length !== 1 ? "es" : ""}`}
          </button>
          <button type="button" onClick={() => handleConfirm(true)} disabled={pushing || toCreate.length === 0 || !!gateBlocked} title={gateBlocked ?? undefined} className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
            Crear y publicar
          </button>
        </div>
      )}
```
Replace with:
```tsx
          {/* The lock's other half (`handleAutoV3`): no v3 confirm starts while a v3 Auto is pending. `isV3 &&` leaves v2's buttons behaving exactly as today. */}
          <button type="button" onClick={() => handleConfirm(false)} disabled={pushing || (isV3 && autoPending) || toCreate.length === 0 || !!gateBlocked} title={gateBlocked ?? undefined} className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
            {pushing ? "Creando..." : `Crear ${toCreate.length} borrador${toCreate.length !== 1 ? "es" : ""}`}
          </button>
          {/* CF-8: a 2-month confirm creates drafts only — the publish button is absent, not disabled. */}
          {!(isV3 && horizon.length === 2) && (
          <button type="button" onClick={() => handleConfirm(true)} disabled={pushing || (isV3 && autoPending) || toCreate.length === 0 || !!gateBlocked} title={gateBlocked ?? undefined} className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
            Crear y publicar
          </button>
          )}
        </div>
        </>
      )}
      {incompleteDialog}
```
(The fragment adds no element: under v2 — whose two v3 lines render nothing and whose `incompleteDialog` is `null` — the footer's DOM is today's; under v3 the lines sit in the grid's own vertical rhythm.)

The Escape handler (one effect above both branches, so it serves both steps) — Find:
```ts
      if (closeWouldDiscard) {
        setPendingDiscard("close");
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [clearPending, closeWouldDiscard, groupFillOpen, onClose, storedTransportActive]);
```
Replace with:
```ts
      // C6 CF-10: leaving with gaps after a partial v3 confirm asks first.
      if (v3HasGaps) {
        setIncompleteOpen(true);
        return;
      }
      if (closeWouldDiscard) {
        setPendingDiscard("close");
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [clearPending, closeWouldDiscard, groupFillOpen, onClose, storedTransportActive, v3HasGaps]);
```
and immediately above `  const closeWouldDiscard = storedMode`, insert `  const v3HasGaps = isV3 && v3Gaps.length > 0;` (Step 4 declared `v3Gaps` near the top of the component, before this line).

The discard banner's «Cerrar de todos modos» is the one remaining exit (a «Cerrar» banner raised before a confirm left gaps) — Find:
```ts
  function confirmPendingDiscard() {
    if (storedTransportActive) return;
    if (!storedMode && pendingDiscard === "back") goBackToConfig();
    else onClose();
  }
```
Replace with:
```ts
  function confirmPendingDiscard() {
    if (storedTransportActive) return;
    if (!storedMode && pendingDiscard === "back") goBackToConfig();
    // C6 CF-10: a close with gaps asks first, whichever control started it.
    else if (v3HasGaps) { setPendingDiscard(null); setIncompleteOpen(true); }
    else onClose();
  }
```

- [ ] **Step 7: Run the tests, today's confirm suites, the guards and the gates**

Run: `node scripts/colour-inventory.mjs && git add -A && npx vitest run app/components/admin/__tests__/MonthGenerator.v3Confirm.test.tsx app/components/admin/__tests__/MonthGenerator.v3Auto.test.tsx app/components/admin/__tests__/MonthGenerator.create.test.tsx app/components/admin/__tests__/MonthGenerator.derivedHistory.test.tsx app/utils/__tests__/cueDialogMount.test.ts app/utils/__tests__/clientBoundary.test.ts`
Expected: PASS — today's create/confirm suite unedited (v2), `cueDialogMount`'s `BASELINE` unchanged (`open={open}`, never a literal).
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors; warnings ≤ baseline.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(planner): the v3 confirm in the planner — records first, then drafts, nothing lost

Under v3 «Crear borradores» runs the confirm protocol after today's re-checks: the record entries
frozen at the solve (or read fresh at the first confirm when no v3 Auto ran) go in one PUT before any
draft, asserting the revision that was solved with; any refusal creates nothing and keeps the
planner open with its reason. Drafts follow month by month with their stable ids, «Reintentar»
sends only what is missing, a 2-month confirm creates drafts only, the browser history gets one
entry per month, and leaving with gaps asks first from either step, by any control. Auto waits
while a confirm is in flight. Under v2 the confirm is unchanged."
```

---

## Task 20: The documentation in the same delivery (DOC-2, DOC-3; DOC-1 landed in Task 2) — [standard; docs-audit material]

**Files:**
- Create: `docs/adr/0052-the-planner-learns-the-solver-engine-from-the-server.md` and `docs/adr/0053-auto-plans-one-or-two-months-with-stored-services-fixed.md` — `0052` is the first free number on `main` recorded at Task 0 Step 5 and `0053` the next one (numbers follow the order records reach `main`; if another record lands first, renumber in the merge of `main` and let `adrIndex.test.ts` confirm)
- Modify: `docs/adr/README.md` (two index rows), `docs/API_REFERENCE.md` (the solve route), `docs/agents/project-rules.md` (the long form), `CLAUDE.md` and `AGENTS.md` (identical index lines — `agentDocsParity.test.ts`), `docs/UTILITIES_AND_COMPONENTS.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Write the engine ADR** — Create `docs/adr/0052-the-planner-learns-the-solver-engine-from-the-server.md`

```markdown
# ADR-0052: The planner learns the solver engine from the server

**Date:** 2026-10-06 · **Status:** Accepted

## Context

Solver v3 runs beside v2 until a cutover that flips one code constant (`SOLVER_ENGINE`,
`app/components/admin/solverEngine.ts`, C1) by PR. Preview must be able to rehearse v3 before that
flip, so C2 added a Preview-only override (`OWT_SOLVER_ENGINE`) read by one pure resolver
(`resolveSolverEngine`, `app/utils/solverDeployment.ts`) that honours it only on the `preview`
branch deployment and locally. A client bundle cannot read that variable, and a planner that read
the constant directly would disagree with its own server on Preview — sending a v2 request to a
server answering v3, or the reverse.

## Decision

- `/admin`'s Server Component resolves the effective engine with C2's resolver at render and passes
  it as a plain string prop: `AdminPanel` → `ServicesPanel` → `MonthGenerator`, and on to the
  surfaces it gates (C1's «aplica con el nuevo solver» note, C3's card-chip note, C2's preview
  banner, C3's warning gate). Every engine-dependent client branch reads that prop; no client module
  reads `SOLVER_ENGINE` or imports the resolver (`engineProp.test.ts`, C2's `solverDeployment.test.ts`).
  The client props default to the literal `"v2"` for tests only; the guard fails a production mount
  that omits `engine=`.
- `POST /api/admin/solve` resolves the engine on every request and answers a body of the other
  contract (`contract: 3` or not) with `409 { ok: false, error: "solver_version_mismatch", engine }`
  before any other validation — the backstop for a page rendered before a deployment change. Under
  v2 that 409 is the client's one new branch («El solver cambió de versión… Recarga la página»).
- The `"v2" | "v3"` union lives in `solverEngine.ts` (a type adds no import); the resolver's module
  re-exports it.

## Rejected

- **The client fetching the engine** (an endpoint or the fairness GET's `engine`): adds a loading
  state to every planner open and a window where the planner renders under the wrong engine.
- **A `NEXT_PUBLIC_` variable**: baked into the bundle per build, so a Preview override would still
  need a rebuild and could never be refused for `verify/service-readiness`; and production would carry
  a variable its code must ignore.
- **Reading `SOLVER_ENGINE` in client components**: correct in production, wrong on a Preview with the
  override — the exact disagreement this record exists to prevent.

## Consequences

The prop is threaded through three components that did not need it before. A page left open across a
deployment change gets the 409 (or C2's `engine_not_v3` on a record PUT) instead of a mixed solve. C7
flips the constant (and C1's pin test) and touches no client code to do it; a client test that
changes with the constant is a defect (C7 S8).
```

- [ ] **Step 2: Write the horizon ADR** — Create `docs/adr/0053-auto-plans-one-or-two-months-with-stored-services-fixed.md`

```markdown
# ADR-0053: Auto plans one or two months, with stored services and counted specials as fixed services

**Date:** 2026-10-06 · **Status:** Accepted (behind `SOLVER_ENGINE`; production stays v2 until C7)

## Context

The team asked for Auto to respect seats already assigned, plan two months at once, and keep
fairness across months (solver v3, parent §7). v2 plans one month, ignores stored rosters in create
mode, never sends specials, and writes drafts only. v3's solver (C5) takes opaque service ids, fixed
services and pins, and the fairness ledger (C2) measures balances against a per-month eligibility
record that must exist for a month to count.

## Decision

Under the v3 engine (C6, `app/components/admin/v3*.ts`):

- **Horizon.** «Planear: 1 mes · 2 meses»; one grid across the horizon; Auto refuses a month before
  the current CDMX month and one beyond the current month + 12.
- **Services that will exist, and only those.** Planned columns (not skipped, creatable), every
  stored service of the horizon — sent FIXED, id = its document `_id` verbatim, its kept seats as pins
  (C2's `keepVoiceSeats`), empty stored seats left empty — and every counted special, filled by the
  planner first (protections, then balance) and then sent fixed. Uncounted specials and instruments
  keep today's after-solve filler. This is the amendment ADR-0010's Decision 1 will need at the flip.
- **One builder.** `buildV3SolveRequest` is pure (state, ledger read, roles read, clock in; request,
  notices, refusals, snapshot out); every rule id is minted, never a config key (production's seed
  keys spell first names), and each run keeps a name-free id → config-ordinal table.
- **Records first, atomically.** The confirm sends every horizon month's eligibility record in one
  PUT before any draft — a bound month's record back `unchanged`, a recorded-unbound month replaced
  under the revision read, a create for every month without a record, anchored or not (parent A27) —
  frozen at the solve; then drafts oldest first, month 2 only after month 1 is complete; a month that
  became past refuses before anything is written (A40). A 2-month confirm creates drafts only.
- **Only Auto's v3 confirm (and C2's «Registrar») writes a record.** The stored editor («Editar
  mes») writes none.

## Rejected

- **Re-planning stored services** (or filling their empty seats): overwrites what the team already
  sees and plans with; the spec makes them fixed.
- **Letting the solver fill counted specials**: C5 accepts a special only as a fixed service; the
  planner's pre-fill ranks by the same protections and balances, and a placement the solver can only
  report as a `pins` miss is used only when nobody else can lead.
- **One PUT per month, or drafts before records**: a refused month's eligibility differs from what
  was solved, so the plan is joint; records first means a refusal creates nothing.
- **Skipping the record of a month that already had stored services**: the month would drop out of
  the ledger while its services count (parent A27 removed that skip).

## Consequences

A record can outlive drafts that all failed (the confirm deletes nothing); the next Auto then sees
the month as recorded and replaces it, or — if it already had stored services — as bound. C7 amends
ADR-0010 and ADR-0047 at the flip (v3 has no solver weeks; the trailing Saturday is a dated service).
Deleting the v2 history surfaces is C7's, after the rollback window.
```

- [ ] **Step 3: Index the two records** — `docs/adr/README.md`

After the index's last ADR row — on `c0375d7d` C5's record (at the replay base it was C2's `ADR-0050` row), the `- [ADR-0051: The v3 solver is a second function …` line, add:
```markdown
- [ADR-0052: The planner learns the solver engine from the server](0052-the-planner-learns-the-solver-engine-from-the-server.md) — solver v3 C6. Why `/admin` resolves the effective engine (C2's resolver: the constant, or the Preview-only override) on the server and threads it as a prop to every engine-dependent surface, why the solve route answers a body of the other contract `409 solver_version_mismatch`, and why a client fetch, a `NEXT_PUBLIC_` variable or reading the constant in client code were rejected.
- [ADR-0053: Auto plans one or two months, with stored services and counted specials as fixed services](0053-auto-plans-one-or-two-months-with-stored-services-fixed.md) — solver v3 C6, behind the engine switch. The 1–2-month horizon, stored services sent fixed by document id, counted specials pre-filled then fixed, minted rule ids with a name-free ordinal table, and the confirm that writes every month's eligibility record in one PUT before any draft (A27, A40); what ADR-0010 and ADR-0047 will need amended at C7's flip.
```

- [ ] **Step 4: The solve route** — `docs/API_REFERENCE.md`

Find:
```markdown
  writes. See [SOLVER_AND_INFRA.md](SOLVER_AND_INFRA.md).
```
Replace with:
```markdown
  writes. See [SOLVER_AND_INFRA.md](SOLVER_AND_INFRA.md).
  **Engine (solver v3 C6).** After auth and the JSON parse the route resolves the deployment's
  effective engine (`resolveSolverEngine`); a body of the other contract (`contract: 3` under v2, or
  anything else under v3) answers `409 { ok: false, error: "solver_version_mismatch", engine }`
  before any other check. Under v3 a `contract: 3` body goes to `OWT_SOLVER_V3_URL` with `X-Api-Key`
  (or, off Vercel, `gcf_v3/owt_solver_v3.py --json-mode`), aborted at 55 s: a success is forwarded
  verbatim (200); the solver's coded failure (`ok: false, contract: 3, engine: "v3", code`) at any
  status is forwarded as 422; everything else is `{ ok: false, transport_error: true, transport }`
  (422) with `transport` ∈ `timeout`, `unreachable`, `http_status`, `not_json`, `not_configured`,
  `contract_echo` — never a 500, and the log line carries only engine, outcome, status and timing.
  The v2 path above is unchanged.
```

- [ ] **Step 5: the rules — long form in `docs/agents/project-rules.md`, index lines in `CLAUDE.md` and `AGENTS.md`** (DOC-3 — the engine resolver's line is C2's GU-4 and is not repeated). Since 2026-10-07 `CLAUDE.md`/`AGENTS.md` are the index (one or two lines per rule) and the long form lives under the same headings in `docs/agents/project-rules.md`; a rule changes in both (amended at Task 0 on `c0375d7d`, where the replay's `CLAUDE.md` anchors now live in the long-form file).

In `docs/agents/project-rules.md`, Find:
```markdown
- **Client mutation handlers** must wrap `fetch` in try/catch/finally, check
```
Replace with:
```markdown
- **Two solver parsers, never crossed (solver v3 C6, U8).** Every engine-dependent client branch reads
  the `engine` prop `/admin`'s Server Component resolves (`resolveSolverEngine`), never
  `SOLVER_ENGINE` (`engineProp.test.ts`). Auto dispatches on it BEFORE reading anything: a v3 answer
  goes only through `v3SolveResponse.ts` (classifier, handshake, apply by service id, retry keyed on
  codes) and a v2 answer only through v2's parsers, pin cap (100) and trailing retry —
  `MonthGenerator.v3Auto.test.tsx` spies on both sides. Under v2 the one client change is the 409
  `solver_version_mismatch` reload line. v3 copy lives only in `v3Copy.ts`, keyed on C5's
  `gcf_v3/owt_v3/codes.json` (`v3CodesSync.test.ts`); the v3 pin cap mirrors C5's `PIN_CAP`
  (`v3PinCapSync.test.ts`); no rule key or `ruleKey` ever reaches the v3 wire, a rendered line or a
  log — ids are minted (`v3RuleIds.ts`, `v3KeyHygiene.test.ts`).
- **Client mutation handlers** must wrap `fetch` in try/catch/finally, check
```
Find:
```markdown
Motion tokens are `--motion-*` /
```
Replace with:
```markdown
**Solver v3 planner (C6, behind the engine prop):** `buildV3SolveRequest` (`app/components/admin/v3SolveRequest.ts`
— the ONE v3 request builder, pure: planner state + ledger GET + roles read + CDMX month in; request, notices,
refusals and the run snapshot out; C7's rehearsal uses the same code), `runV3Auto` (`v3AutoRun.ts` — refusals
before any read, the fresh 20 s ledger read, the 58 s solve), `freezeConfirmEntries`/`runV3ConfirmAttempt`
(`v3Confirm.ts`/`v3ConfirmRun.ts` — the ONE v3 confirm: every month's record in one PUT, then drafts month by
month; critical, reviewed as such), `v3Copy.ts` (the ONLY v3 copy, keyed on codes), `prefillCountedSpecials`
(`v3Prefill.ts` — counted specials before the solve; uncounted ones keep `fillColumn`).
Motion tokens are `--motion-*` /
```

`CLAUDE.md` and `AGENTS.md` (identical edits in both) take the two index lines, each beside the long form's rule.

Before `- **Client mutation handlers** wrap`, insert:
```markdown
- **Two solver parsers, never crossed (solver v3 C6, U8):** client branches read the server-resolved
  `engine` prop, never `SOLVER_ENGINE`; a v3 answer goes only through `v3SolveResponse.ts`, a v2 one
  only through v2's parsers; v3 copy only in `v3Copy.ts`; no rule key on the wire, a line or a log.
```
Before `- Motion tokens are`, insert:
```markdown
- **Solver v3 planner (C6, behind the engine prop):** `buildV3SolveRequest` (the ONE v3 request
  builder), `runV3Auto`, `freezeConfirmEntries`/`runV3ConfirmAttempt` (the ONE v3 confirm —
  critical), `v3Copy.ts`, `prefillCountedSpecials`.
```

- [ ] **Step 6: The inventory** — `docs/UTILITIES_AND_COMPONENTS.md`

The `## app/components/` heading's figures are a recount of the files on the branch (`ls app/components/<dir>/*.tsx | wc -l` for each directory, `ls app/components/*.tsx | wc -l` for the top level), and it names C6's two additions — C6 adds `V3RunPanel.tsx` and `V3IncompleteDialog.tsx`, but the heading was already one admin file short at the replay base (C2's `FairnessPreviewPanel.tsx` was never counted: 25 admin / 108 total written, 26 / 109 on disk), so adding 2 to it would leave it wrong. On `c0375d7d` (C2's final tip already recounted the heading to 109 / 26 admin, counting `FairnessPreviewPanel`; at the replay base it read 108 / 25): Find ``## `app/components/` — inventory (109 `.tsx` files: 37 top-level + 26 admin + 7 kids + 27 ui + 9 song + 3 availability; recounted for solver v3 C2, which adds `FairnessPreviewPanel`)`` → Replace with ``## `app/components/` — inventory (111 `.tsx` files: 37 top-level + 28 admin + 7 kids + 27 ui + 9 song + 3 availability; recounted for solver v3 C6, which adds `V3RunPanel` and `V3IncompleteDialog`)``.

The entries go under the admin panels table, one blank line after its last row (the table ends there; the entries are a list under it), so the block opens with that blank line.

After the ``| `ParticipationSidebar` | …`` line, add:
```markdown

- **`V3RunPanel`** (solver v3 C6) — a v3 run's line, stage summary and «Ver etapas», with the run's name-free rule reference table (wire id · kind · config ordinal) headed by its `request_id`.
- **`V3IncompleteDialog`** (solver v3 C6) — CF-10's «El plan quedó incompleto» `CueDialog`, opened when leaving after a partial v3 confirm.
- **`v3*.ts` (solver v3 C6, neutral)** — `v3Wire` (the `contract: 3` types), `v3Horizon`, `v3Copy`, `v3RuleIds`, `v3MonthSources`, `v3Services`, `v3People`, `v3Rules`, `v3Prefill`, `v3SolveRequest`, `v3SolveResponse`, `v3RunReport`, `v3AutoRun`, `v3Equidad`, `v3Confirm`, `v3ConfirmRun`; and `app/utils/solverV3Upstream.ts` (`server-only`, the solve route's v3 transport).
```

- [ ] **Step 7: Run the doc guards and the gates**

Run: `git add -A && npx vitest run app/utils/__tests__/adrIndex.test.ts app/utils/__tests__/agentDocsParity.test.ts`
Expected: PASS (if `adrIndex` reports a number collision, renumber per the rule above).
Run: `npx tsc --noEmit && npm test && npx eslint .` — Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs(solver): the v3 planner's records — engine from the server, the 1–2-month horizon

Two ADRs for the behaviour C6 introduces (the server-resolved engine with the solve route's 409,
and the horizon with stored services and counted specials as fixed services and the records-first
confirm), the solve route's v3 contract in the API reference, the two-parsers rule and the v3
planner's reusable pieces in docs/agents/project-rules.md with their index lines in CLAUDE.md and
AGENTS.md, and the inventory. The engine resolver's own
line is C2's and is not repeated; ADR amendments are C7's at the flip."
```

---

## Task 21: Final verification (no commit) — coordinator

**Files:** none.

- [ ] **Step 1: The five gates on the final tree**

`BASE` below is the commit this branch was cut from: `origin/main` once C2 and C5 are on `main` (the normal case); on a replay cut from an integration of C2 and C5 that is not on `main`, that integration commit (`git rev-parse replay-base`) — against `origin/main` such a branch would show C2's and C5's own changes. Set it first: `BASE=origin/main` (or `BASE=$(git rev-parse replay-base)` on a replay).

Run: `npx tsc --noEmit && npm test && npx eslint . 2>&1 | tail -1`
Expected: 0 `tsc` errors; every test green; `0 errors` and warnings ≤ the Task 0 baseline. Python suites: `git diff --stat $BASE -- gcf gcf_v3` must print nothing — C6 changes no Python, so neither suite is a gate (spec §14).

- [ ] **Step 2: The static checks the spec names**

```bash
# ENG-1 (C2's guard) and ENG-4: one reader of the override; no client file mentions the constant.
npx vitest run app/utils/__tests__/solverDeployment.test.ts app/components/admin/__tests__/engineProp.test.ts
# C1-R11 unedited: the one pin of SOLVER_ENGINE === "v2".
git diff $BASE -- app/components/admin/__tests__/solverEngine.test.ts | wc -l          # expect 0
# KH-1: no console call in C6's new modules takes a request, response, config or key.
git grep -n "console\." -- app/components/admin/v3*.ts app/components/admin/V3*.tsx    # expect nothing
git grep -n "console\." -- app/utils/solverV3Upstream.ts                                # nothing (the route logs, counts only)
# The confirm's writer import: no runtime module of C6 imports the write-request module.
git grep -ln "fairnessMonthWriteRequest" -- app ':!app/**/__tests__/**'                # only C2's own server modules
# No AI attribution.
git log $BASE..HEAD --format=%B | grep -ci "co-authored" || true                        # expect 0
```

- [ ] **Step 3: The guards that apply** — `npx vitest run app/utils/__tests__/clientBoundary.test.ts app/utils/__tests__/cueDialogMount.test.ts app/utils/__tests__/serviceCommitCallers.test.ts app/utils/__tests__/protectedReadAudit.test.ts app/utils/__tests__/fairnessFormat.test.ts app/components/admin/__tests__/v3CodesSync.test.ts app/components/admin/__tests__/v3PinCapSync.test.ts` — all green, no list edited.

- [ ] **Step 4: Coverage against the spec** — walk the «Coverage» table below: every row's named test exists and passed in Step 1.

---

## Release

`CLAUDE.md`'s order, without exception: **implement → gates green → FRESH CODE REVIEW on the merge range → fix → RE-VERIFY THE FIX (scoped review of the fix range + gates on the final tree) → merge to `preview` → verify the dev alias → PR → `gates` → merge to `main` → verify the production alias.** The last worklog entry before the merge must be a verification, never a fix. The engine stays `v2` in production: flipping `SOLVER_ENGINE` is C7's and Frank's call, and setting `OWT_SOLVER_V3_URL` or `OWT_SOLVER_ENGINE` on any Vercel environment is C7's consented write (W0, Step 2, W4) — this release sets nothing.

- [ ] **R1 — Fresh code review of the diff.** Dispatch a fresh `code-reviewer` (strong model, high effort) on `origin/main...claude/solver-v3-c6-planner-v3`, carrying the docs-audit and worklog-completeness checklists (`finish-cycle`). Its brief names the critical files for extra scrutiny — `v3Confirm.ts`, `v3ConfirmRun.ts`, the `confirmV3`/`afterV3Attempt` hunks of `MonthGenerator.tsx` — and the invariants: v2 byte-identical (RT-2, AD-8), records before drafts, the guard on every attempt, entries frozen and never re-read, no key on the wire or in a log, no client read of `SOLVER_ENGINE`. Fix every finding on the branch; then a **scoped re-review of the fix range** and the five gates on the final tree.
- [ ] **R2 — Merge into `preview` and push** (`preview` takes direct pushes; CI runs there but does not block):
  ```bash
  git switch preview && git pull --ff-only origin preview
  git merge --no-ff claude/solver-v3-c6-planner-v3 -m "merge: solver v3 C6 (planner on v3, behind the engine) into preview"
  git push origin preview
  ```
- [ ] **R3 — Verify the dev alias, not the build.** One authoritative `get_deployment("dev-owt-backstage.vercel.app")` (Vercel MCP) or the `deploy-verifier` agent, retried ≥ 30 s apart a few times — never a hand-rolled watcher: `dev-owt-backstage.vercel.app` is in the deployment's `alias` and its `meta.githubCommitSha` equals `git rev-parse preview`. Before touching anything Vercel, check `.vercel/project.json` is `owt-backstage` / `prj_elS88VGezKpy18wizFN1ffoy8cJ5`.
- [ ] **R4 — The read-only look on dev.** Run `vercel env ls preview` (names only) first: with `OWT_SOLVER_ENGINE` absent, dev's engine is the constant `v2`, so this look can only confirm that **nothing changed under v2** — the v3 surfaces and the 409 are unobservable on dev in C6's own cycle (C7 Step 2 is where they first appear). `scripts/dev-verify.ts --route /admin --text` (and a phone viewport, light and dark) on the planner's config step and grid step: no «Planear» control; C1's «Cuenta para equidad: aplica con el nuevo solver…» note and C3's card-chip note present; C2's «Vista previa: Auto todavía no usa este saldo» banner present when the panel is opened; the v2 «Historial» block present; no console errors. **Never press «Guardar», «Guardar reglas», «Confirmar», «Crear … borradores», «Crear y publicar» or «Registrar» on dev** — `preview` writes the production dataset; the bot is read-only by construction. If `OWT_SOLVER_ENGINE` is unexpectedly set on Preview, record it and ask Frank before going on (with it set and no `OWT_SOLVER_V3_URL`, a v3 Auto on dev answers `not_configured`, by design). Frank's own look follows; the bot never substitutes for it.
- [ ] **R5 — PR to `main`.**
  ```bash
  gh pr create --base main --head claude/solver-v3-c6-planner-v3 \
    --title "feat(planner): solver v3 C6 — the planner on v3, behind the engine switch" \
    --body-file /tmp/c6-pr-body.md
  ```
  The body lists: what ships (all behind the server-resolved engine; production stays v2), the two ADRs, the `OWT_SOLVER_V3_URL` SECRETS entry (set nowhere), the critical-slice review log, the code-review verdict and the re-verification, the dev alias + SHA. Per `CLAUDE.md`, **no AI/Claude attribution and no `Co-Authored-By`** anywhere in commits or the PR body (this overrides any harness reminder). Name every rule only by kind and ordinal; no real member name.
- [ ] **R6 — `gates`, then the merge.** Wait for the `gates` check green on the exact reviewed and re-verified commit; then arm auto-merge LAST on that commit: `gh pr merge <n> --auto --merge`. Before pushing anything else to the branch, `gh pr merge <n> --disable-auto`. **After any catch-up merge of `main` or ADR renumber** (another PR landed first, or Task 0 Step 5's numbers were taken): (1) `gh pr merge <n> --disable-auto` before the push; (2) a scoped re-review of the merge range (the catch-up merge commit and any renumber commit); (3) the five gates on the new tip; (4) re-merge into `preview`, push, and verify the dev alias carries that tip's merge (`alias` + `meta.githubCommitSha`, as R3); (5) only then re-arm auto-merge on that exact commit. The last worklog entry before the re-arm is that verification.
- [ ] **R7 — Verify the production alias.** After the merge, `get_deployment("owt-backstage.vercel.app")`: the alias is present and `meta.githubCommitSha` equals the merge commit on `main`. Production's engine is the constant `v2`, so `/admin` shows no «Planear» control — expected.
- [ ] **R8 — Close the cycle.** `finish-cycle`; worklog entries for every dispatch (batched at close is fine), `coordinator-inline` for specialist-shaped inline work; `git worktree remove` for any worktree used; docs that state release status (the ADR index rows, `docs/SECRETS.md`'s `OWT_SOLVER_V3_URL` status line «not set on any Vercel environment yet») re-read for accuracy.

**Safe end state:** production unchanged (`SOLVER_ENGINE = "v2"`); Preview unchanged until C7 sets the override and the URL. **Rollback:** a revert PR of the merge (preview first, then main through `gates`); nothing to undo in data — C6 writes nothing unless a v3 confirm runs, which needs the v3 engine.

---

## Coverage — spec row → task and test

| Spec row | Task | Test (file › what) |
|---|---|---|
| ENG-1 | 1 | `solverEngine.test.ts` (C1, unedited); `solverDeployment.test.ts` (C2: one reader, no client importer); `engineProp.test.ts`; `clientBoundary.test.ts` |
| ENG-2 | — (C2's) | C2's resolver table tests, relied on unchanged |
| ENG-3 | 1, 14 | `engineProp.test.ts` (server-only importers; the page resolves and passes it); `MonthGenerator.v3Horizon.test.tsx` › HZ-1 (v3 controls iff the prop says v3) |
| ENG-4 | 1 | `engineProp.test.ts` › no client module mentions `SOLVER_ENGINE` |
| ENG-5 | 20 | ADR-0052 (C7 flips; no code here) |
| RT-1 | 2 | `solveRouteV3.test.ts` › RT-1 both directions, no upstream call |
| RT-2 | 2 | `solveRoute.test.ts` (unedited) + `solveRouteV3.test.ts` › forwarded body equals received |
| RT-3 | 2 | `solverV3Upstream.test.ts` › remote with `X-Api-Key`, local off Vercel, `not_configured` on Vercel; `solveRouteV3.test.ts` |
| RT-4 | 2 | `solverV3Upstream.test.ts` › 55 s abort, remote and local; `solveRouteV3.test.ts` › `maxDuration` 60 |
| RT-5 | 2 | `solverV3Upstream.test.ts` › each reason and each C5 failure status |
| RT-6 | 2 | `solveRouteV3.test.ts` › success byte for byte |
| HZ-1 | 14 | `MonthGenerator.v3Horizon.test.tsx` › HZ-1 |
| HZ-2 | 3, 14 | `v3Horizon.test.ts` (Dec→Jan, retention); `MonthGenerator.v3Horizon.test.tsx` › forgotten December selection |
| HZ-3 | 3, 14 | `v3Horizon.test.ts` › 31 Oct once; component › Oct+Nov |
| HZ-4 | 14 | component › stacked calendars |
| HZ-5 | 14 | component › bands inside `[data-planner-scroller]` (phone width: C7's look) |
| HZ-6 | 14 | `v3Horizon.test.ts` › `participationMonthsOf`; component › «Noviembre · Diciembre · Ambos» |
| HZ-7 | 3, 11, 13, 15 | `v3Horizon.test.ts`; `v3SolveRequest.test.ts` › `preReadRefusals`; `v3AutoRun.test.ts` › before any read; `MonthGenerator.v3Auto.test.tsx` › HZ-7 |
| HZ-8 | 14 | component › HZ-8 (each column's own spine) + existing grid-rule tests |
| HZ-9 | 3, 11, 13, 17, 18, 19 | `v3Horizon.test.ts` (+12 admitted, +13 refused, second month alone); `v3AutoRun.test.ts` (no GET, no fetch); `v3ConfirmRun.test.ts` › ceiling; `MonthGenerator.v3Confirm.test.tsx` › HZ-9 with no prior Auto |
| ST-1 | 14, 13, 15 | component › «Guardado»; `v3AutoRun.test.ts` › ST-1; `MonthGenerator.v3Auto.test.tsx` › ST-1 |
| ST-2 | 14 | `MonthGenerator.v3Horizon.test.tsx` › «ST-2: a stored special and a planned Sunday on one date …» (the named guard) |
| ST-3 | 14, 15 | component › no picker; `MonthGenerator.v3Auto.test.tsx` › byte-identical after Auto; ST-2 test › confirm count excludes the stored target |
| ST-4 | 7 | `v3Services.test.ts` › weekend fixed with counts, uncounted special never |
| ST-5 | 7, 11 | `v3Services.test.ts` › ST-5; `v3SolveRequest.test.ts` › NT-3 order |
| ST-6 | 7 | `v3Services.test.ts` › non-member, double seat, equality with IF2-11 |
| ST-7 | 7 | `v3Services.test.ts` › ST-7 (component-level re-Auto after a partial confirm: see gaps) |
| ST-8 | 6, 9, 11, 16 | `v3MonthSources.test.ts` (states, bound vs recorded, uncounted-special-only); `v3Rules.test.ts` (record count vs screen count); `v3SolveRequest.test.ts` › bound month ignores pools; `MonthGenerator.v3Equidad.test.tsx` › banners, read-only pools, mixed horizon, anchored |
| ST-9 | 11, 15 | `v3SolveRequest.test.ts` › pins with/without the switch; `MonthGenerator.v3Auto.test.tsx` › ST-9 sentence |
| SP-1 | 10 | `v3Prefill.test.ts` › hard blocks, record-ineligible candidate, append-only |
| SP-2 | 10 | `v3Prefill.test.ts` › balance order, cadence-on after DL line, (a), (b) ×2, (c), (d) ×2, least-important miss |
| SP-3 | 7, 11 | `v3Services.test.ts` › counted special fixed; `v3SolveRequest.test.ts` › pinned special |
| SP-4 | 15 | `MonthGenerator.v3Auto.test.tsx` › uncounted special filled on a refusal; `localFill.test.ts` unedited |
| SP-5 | 11, 13, 15 | `v3SolveRequest.test.ts` › SP-5; `v3AutoRun.test.ts` › SP-5; component › counted special left as is |
| SP-6 | 10, 11 | `v3Prefill.test.ts` › SP-6; `v3SolveRequest.test.ts` |
| SP-7 | 10 | `v3Prefill.test.ts` › each motivo |
| RQ-1 | 13, 15 | `v3AutoRun.test.ts` › failure bodies, throw, 20 s abort, stale horizon; component › fresh read URL, failed read |
| RQ-2 | 6, 11 | `v3MonthSources.test.ts` (one source, frozen, each refusal/issue, kids-only namesake); `v3SolveRequest.test.ts` › one value |
| RQ-3 | 7, 11 | `v3Services.test.ts` (ids verbatim, `time`); `v3SolveRequest.test.ts` |
| RQ-4 | 8 | `v3People.test.ts` (out/off cases, bound cadence, disagreement, carried rewrite, dl_since, prev_dl_leads) |
| RQ-5 | 5, 9, 11 | `v3RuleIds.test.ts`; `v3Rules.test.ts` (4/5 Sundays, IF2-16/17 spies, each `ok:false`, clamp to 0, month-scoped presence, labels); `v3KeyHygiene.test.ts` (name-shaped fixture, byte-identical ids) |
| RQ-6 | 4, 11 | `v3PinCapSync.test.ts`; `v3SolveRequest.test.ts` › board pins, duplicate wording, non-member, cap |
| RQ-7 | 7 | `v3Services.test.ts` › prior (trailing Saturday, duplicate target) |
| RQ-8 | 11 | `v3SolveRequest.test.ts` › envelope, no v2 fields, no budget |
| RQ-9 | 11, 14, 15 | `v3SolveRequest.test.ts` › v2 helpers never called; component › `buildSolveRequest` never called under v3 |
| RQ-10 | 11 | `v3SolveRequest.test.ts` › each limit; services limit through the builder; cadence + exact via `preReadRefusals` |
| AD-1 | 15 | `MonthGenerator.v3Auto.test.tsx` › v2 parsers never called under v3; v3 adapter never called under v2 |
| AD-2 | 13 | `v3AutoRun.test.ts` › 58 s |
| AD-3 | 12 | `v3SolveResponse.test.ts` › every branch; never «sin solución» |
| AD-4 | 12, 13 | `v3SolveResponse.test.ts` › handshake; `v3AutoRun.test.ts` › handshake failure |
| AD-5 | 12 | `v3SolveResponse.test.ts` › planned only, fixed untouched, pinned origin, unknown id, unfilled markers |
| AD-6 | 12, 15 | `v3SolveResponse.test.ts` › per outcome; component › «Reintentar» runs again / absent for configuration |
| AD-7 | 15 | component › specials at every exit |
| AD-8 | 15 | component › v2 409 reload line, one POST |
| NT-1 | 12, 15 | `v3RunReport.test.ts` › run line, summary, detail; component › «Ver etapas» |
| NT-2 | 12 | `v3RunReport.test.ts` › missed, notices, no-lead, breaks, ceiling caveat |
| NT-3 | 11, 15 | `v3SolveRequest.test.ts` › order; `applyV3AutoResult` puts C6's first |
| NT-4 | 4, 12 | `v3CodesSync.test.ts`; runtime fallback in `v3Copy.test.ts` and `v3RunReport.test.ts` |
| NT-5 | 15 | component › no «Sin optimizar» / «Equidad relajada» / «Historial» |
| EQ-1 | 16 | `MonthGenerator.v3Equidad.test.tsx` › surfaces per engine |
| EQ-2 | 16 | same › banner under v2 only |
| EQ-3 | 16 | `v3Equidad.test.ts` › plan columns from the tab, «—» before a solve / absent tab |
| EQ-4 | 16 | `v3Equidad.test.ts` › reasons; component › RQ-4's line after the run, UI-5's before |
| EQ-5 | 16 | `v3Equidad.test.ts`; C2's `fairnessFormat.test.ts` divide sweep |
| EQ-6 | 16 | `MonthGenerator.v3Equidad.test.tsx` › EQ-6: at a stubbed 390 px viewport, after a v3 run, Ana's card inside `[data-fairness-cards]` reads «En este plan 2 · Queda le deben 0.3»; the cards are `md:hidden` and the table sits in its own `hidden md:block overflow-x-auto` box (no page-level scroll); C2's panel card tests for the rest. The real phone look is C7's (see gaps) |
| EQ-7 | 16 | `v3Equidad.test.ts` › diagnostics lines |
| WN-1 | 16 | component › no read yet (open, both/one month), one bound month, all bound, v2 closed; C3's sentences verbatim |
| WN-2 | 11 | `v3SolveRequest.test.ts` › name refusal, cadence + exact, kids-only namesake |
| WN-3 | 11, 16 | `v3SolveRequest.test.ts` › NT-3 order includes it; component › config note per engine |
| CTL-1 | 1, 16 | `engineWiring.test.tsx` (C1 note, `CADENCE_V2_NOTE` chip, «Holgura» ungated); `MonthGenerator.v3Equidad.test.tsx` (C2 banner) |
| CTL-2 | 10 | `v3Prefill.test.ts` › «Holgura»/«Exenta» do not move counted specials; `localFill.test.ts` unedited |
| CF-1 | 17, 18, 19 | `v3Confirm.test.ts` (entries per month, guard lines); `v3ConfirmRun.test.ts` (A27 create without draft; boundary first attempt and retry); component › boundary |
| CF-2 | 17, 19 | `v3Confirm.test.ts` › frozen; component › rev read at Auto asserted, no re-read; pools edited after Auto (Volver → pool → Previsualizar), the PUT carries the solved body; no-Auto fresh read (`manual`); failed read writes nothing |
| CF-3 | 17 | `v3Confirm.test.ts` › three shapes (+ anchored), round-trip hash |
| CF-4 | 17, 18, 19 | `v3Confirm.test.ts` › each `details.detail`, unexpected outcomes; `v3ConfirmRun.test.ts` › zero POSTs; component › refusal keeps open |
| CF-5 | 17, 18 | `v3Confirm.test.ts` › grouping; `v3ConfirmRun.test.ts` › month-1 failure ⇒ no month-2 POST |
| CF-6 | 17, 18, 19 | `monthReportLines`; `v3ConfirmRun.test.ts`; component › per-month line |
| CF-7 | 18, 19 | `v3ConfirmRun.test.ts` › resend only missing, replay per shape, month-2-only; component › byte-identical PUT on «Reintentar (n pendientes)» |
| CF-8 | 17, 19 | `twoMonthSummaryLine`; component › no publish at 2, kept at 1; `v3ConfirmRun.test.ts` › published passes through |
| CF-9 | 19 | `MonthGenerator.v3Confirm.test.tsx` › one history entry per month with a weekend draft created (two for a 2-month confirm). «None for a specials-only month» is **declined, not asserted** (review round 1): the v3 history filter is today's P1 second lock (`d._type !== "special_role"`) copied verbatim, proven today by the create suite under v2; adding it needs the create suite's special-composer helpers lifted into `v3PlannerHarness.tsx` (see Coverage gaps) |
| CF-10 | 19 | component › «El plan quedó incompleto» from the grid «Cancelar» and Escape, «Seguir aquí» stays, «Salir así» leaves; from the config step after «← Volver» («Cancelar» and Escape), and no stale open dialog on the next «Previsualizar» |
| CF-11 | 18, 19 | `v3ConfirmRun.test.ts` › the record step (CF-4) › «a network error → zero POSTs, the record line, retry true» (a thrown PUT); `v3ConfirmRun.test.ts` › drafts › «a draft 409 adds today's note …; a thrown POST is a failure, never a creation (CF-11)»; `MonthGenerator.v3Confirm.test.tsx` › ««other failure» offers «Reintentar (n pendientes)», whose PUT body is byte-identical (CF-7)» (a 500 on the PUT: the failure line shows instead of a success, the pending flag is reset — «Reintentar» is clickable — and the retry lands) |
| DOC-1 | 2 | `docs/SECRETS.md` entry (review) |
| DOC-2 | 20 | two ADRs + index (`adrIndex.test.ts`) |
| DOC-3 | 20 | `CLAUDE.md`/`AGENTS.md` line (`agentDocsParity.test.ts`) |
| KH-1 | 5, 11, 15, 17, 21 | `v3KeyHygiene.test.ts`; `MonthGenerator.v3Auto.test.tsx` › console calls; `v3Confirm.test.ts` › KH-1 on the confirm path (every confirm line, fed keyed entries and keyed 409/400 bodies); Task 21 grep |
| KH-2 | 2 | `solveRouteV3.test.ts` › KH-2 per outcome |
| KH-3 | 5, 9, 11, 15 | `v3RuleIds.test.ts`; `v3Rules.test.ts`; `v3KeyHygiene.test.ts` › one entry per id and `P:` key, ordinals, «sin tarjeta», shifted ordinals; component › table under «Ver etapas» headed by `request_id` |
| §7 copy | 4 (+16 for EQ-3/EQ-7 lines) | `v3Copy.test.ts`, `v3CodesSync.test.ts` |
| §14 «Parent §16» | — (C7) | Preview, engine v3, two real months solved (not confirmed) |

**Coverage gaps (stated, not hidden):** EQ-6 is asserted at a stubbed 390 px viewport (Task 16 Step 2 › EQ-6, added after the replay): Ana's card's plan values inside `[data-fairness-cards]` and the class split that keeps the table in its own scroller. jsdom lays nothing out and the panel consults no `matchMedia`, so the test proves the DOM a phone gets, not pixels; the spec row's «`Collapse` for the detail» is met by the panel's own disclosure (C2's card renders its detail lines inline) — flagged for the reviewer. ST-7's component path (a partial confirm, then Auto again, the created target sent fixed) depends on `ServicesPanel` reloading the roles after `onCreated`, which the MonthGenerator harness does not do; it is proven at unit level (`v3Services.test.ts` › ST-7). CF-9's «none for a specials-only month» stays **declined** (review round 1) and is not asserted at component level: the v3 confirm's history filter is today's P1 second lock (`d._type !== "special_role"`) copied verbatim, and today's create suite proves that lock under v2; a v3 component test would need that suite's non-exported special-composer helpers under Task 14's stacked calendars — lifting them into `v3PlannerHarness.tsx` and adding a specials-only 2-month confirm that asserts no history entry for that month is what would add it. HZ-5's and EQ-6's real phone checks are C7's look. EQ-7's three diagnostic lines are C6-own copy the spec's §7 does not enumerate (they reuse the derived history's wording) — flagged for the reviewer.

## Sibling issues found while planning (C6 edits no sibling text)

| ID | Child | Issue | C6 meanwhile |
|---|---|---|---|
| S-19 | C2 | C2 §8's X1 copy has no sentence for IF2-12's `assumed_led_previous_month` (month 2 of a run); C2's `cadenceLine` falls through to «no dirige domingo: ningún domingo disponible», which would be false there | C6 renders §7.7's «Mes por medio: no dirige domingo en {mes}.» for that month and no X1 sentence (Task 16; copy amended 2026-10-07) |
| S-20 | C5 | `invalid_request`'s `detail` tokens are not listed in `codes.json` (only its parameter names), so C6 cannot key copy on them | C6 renders the generic planner-bug line with `field` only (§7.5) |
| S-21 | C2 / spec | IF-C2 lists IF2-11 as «ST-6's test only», while C2 §7.4 forbids a C6 reimplementation of LG-4; this plan calls `keepVoiceSeats` at run time (Plan decisions) | For the reviewer to rule; the fallback is a local first-seen pass tested against IF2-11 |
| S-22 | C2 | Frank, 2026-10-07: «Mes por medio» governs Sunday lead only, so a cadence line must not read as resting from everything. C2 §8's X1 sentences said «En {mes} descansa: …» (`led_previous_month`, `not_eligible`, the default) | applied on C2's branch 2026-10-07: C2 §8's X1 now reads «En {mes} no dirige domingo: …»; C6 renders C2's X1 sentences unchanged through `x1LineText` (Task 16) and rewords only its own copy (§7.2, §7.7, SP-7's motivo) |
| S-18 | C7 | (open in the spec) C7 cites «KH-1 as amended» for the ordinal map that KH-3 delivers | KH-3 is delivered as the spec states; the table's format is in Plan decisions |

---

## Self-review (writing-plans checklist)

1. **Spec coverage.** Every row of §5 (ENG, RT, HZ, ST, SP, RQ, AD, NT, EQ, WN, CTL, CF, DOC, KH) and §14's acceptance table maps to a task and a named test above; the gaps are listed with their reason.
2. **Placeholder scan.** No «TBD»/«TODO»/«similar to Task N». The only deferred values are the two ADR numbers (`0052`, `0053`), fixed at Task 0 Step 5 by the repository's numbering rule. The anchors from C2 Tasks 11–17 and C5 Tasks 10–15 were re-verified at replay (2026-10-07, against `4c50309b`) and are re-checked against the merged `main` at Task 0 Step 4.
3. **Type consistency.** Names cross-checked across tasks: `MonthSource`/`MonthState` (6) → 8, 9, 10, 11, 17; `RunCadence` (8) → 10, 11, 16; `CollectedRules`/`mintInputOf`/`emitV3Rules`/`ruleReferences` (9) → 11; `MintedIds`/`RuleRefEntry`/`renderRuleRefTable` (5) → 9, 11, 15; `V3BuildResult`/`V3Snapshot` (11) → 13, 15, 19; `V3Outcome` (12) → 13, 15; `V3ConfirmEntry`/`MonthProgress` (17) → 18, 19; `V3ConfirmState`/`runV3ConfirmAttempt`/`progressFrom` (18) → 19; `EquidadPlan` (16) → `FairnessPreviewPanel`; `flagDisagreementLines` (8) → 11.

## Execution handoff

Recommended: **superpowers:subagent-driven-development** — a fresh implementer per task, review between tasks, the coordinator owning integration and the worklog. Order: Task 0; Tasks 1–16; **stop for the critical-slice adversarial review of Tasks 17–19's text** (two fresh `APPROVED` on byte-identical text, review log committed); Tasks 17–21; Release. Model routing: pure-module tasks (3–13, 17–18) can go to a strong model at moderate effort with the task text as the whole brief; the `MonthGenerator` wiring tasks (14–16, 19) and the critical slice's code review need the strongest model at high effort.

---

## Replay

**Replayed 2026-10-07** in a throwaway clone (`/private/tmp/claude-501/c6-replay/repo`, outside every checkout; nothing pushed, no Sanity write, no secret read or set) on **replay-base `4c50309b3080a7b0f1246d414a77892486fb4833`** = C2's final tip `0aa33514` (C1 + C3 + C2) merged with C5 Tasks 1–12 `e3086f77`. Every Create / Append / Find→Replace block was applied by script from this text; every «run it to see it fail» failed for its stated reason; each task's gates were run (full vitest as `npx vitest run --maxWorkers=3` on a memory-constrained machine) and each task committed and tagged `task-N` in the clone. Where a step did not apply or went red, this text was corrected, the clone reset to the previous task's tag, and the task re-run from the corrected text. Final clone HEAD: `10e36642` (branch `claude/solver-v3-c6-planner-v3`).

**Gate counts per task** (tsc errors · vitest files / tests · eslint errors / warnings; baseline 0 · 468 / 8644 · 0 / 81; Python: gcf_v3 175 OK, gcf 105 OK (1 skipped) at the base — no task touched `gcf/**` or `gcf_v3/**`, so neither was a gate):

| Task | Gates | Task | Gates |
|---|---|---|---|
| 0 | baseline (above) | 11 | 0 · 484 / 8838 · 0 / 81 |
| 1 | 0 · 470 / 8653 · 0 / 81 | 12 | 0 · 486 / 8869 · 0 / 81 |
| 2 | 0 · 472 / 8684 · 0 / 81 | 13 | 0 · 487 / 8884 · 0 / 81 |
| 3 | 0 · 473 / 8695 · 0 / 81 | 14 | 0 · 488 / 8896 · 0 / 80 (one `set-state-in-effect` warning gone with the rewritten month-change effect) |
| 4 | 0 · 476 / 8724 · 0 / 81 | 15 | 0 · 489 / 8907 · 0 / 80 |
| 5 | 0 · 477 / 8733 · 0 / 81 | 16 | 0 · 491 / 8920 · 0 / 80 |
| 6 | 0 · 478 / 8757 · 0 / 81 | 17 [CRITICAL] | 0 · 492 / 8949 · 0 / 80 |
| 7 | 0 · 479 / 8770 · 0 / 81 | 18 [CRITICAL] | 0 · 493 / 8967 · 0 / 80 |
| 8 | 0 · 480 / 8783 · 0 / 81 | 19 [CRITICAL] | 0 · 494 / 8980 · 0 / 80 |
| 9 | 0 · 481 / 8798 · 0 / 81 | 20 | 0 · 494 / 8980 · 0 / 80 |
| 10 | 0 · 482 / 8815 · 0 / 81 | 21 (final tree, no commit) | 0 · 494 / 8980 · 0 / 80; Step 2 static checks and Step 3 guards green; all 34 test files the Coverage table names exist |

**Corrections made to this text at replay** (grouped; none changes behaviour the spec fixes):

- *Header, Global Constraints, File Structure (Task 0):* `[PROVISIONAL]` markers removed after re-verifying every C2 Tasks 11–17 / C5 Tasks 10–15 symbol against the replay base; `FAIRNESS_TOLERANCE` is still `50` there (C6 does not depend on it); ADR numbers `00NN`/`00NM` → `0051`/`0052` everywhere, File-Structure ADR names aligned with Task 20's.
- *Anchors that moved under C2's final tip:* Task 1 Step 7 (the «end of `Props`» Find matched twice → starts at the doc comment's last line; `SolverConfigPanel`'s signature and mount carry C2's `fairnessServices`); Task 16 Step 7 (the `{COPY.banner}` Find re-indented, outside `{data && …}`, so the diagnostics line guards `data &&`); Task 16 Step 8 (both `<FairnessPreviewPanel` mounts' indentation and two-line form; the `SolverConfigPanel` mount and destructure carry `fairnessServices`).
- *Imports:* Task 2 (`isV3Body` moves to `v3Wire.ts`, re-exported by the transport; the route imports the `server-only` transport with `await import(...)` inside the v3 branch only, so the unedited `solveRoute.test.ts` still loads; File Structure rows updated); Task 14 Step 6 and Task 19 Step 4 (import sentences that would have imported `normalizeServiceName` / `isLedgerBody` a second time → explicit Find/Replace pairs adding only the new names).
- *Tests that were wrong, module unchanged:* Task 10 Step 1 (SP-1 passes both rows so the same-category block can fire; SP-2 makes Bruno «exact» for Sun.Lead so his only miss is `no_consecutive`); Task 15 Step 2 (Auto's «Reintentar» queried beside Auto's error line — the v2 history panel's own retry is still on the page until Task 16); Task 19 Step 1 (the config-step dialog test waits for `CueDialogProvider` to lift the app root's `aria-hidden` one frame after the dialog closes — a flake found by Task 21's full run).
- *Docs and verification:* Task 20 Step 6 (the inventory heading is recounted — it was one admin file short at the base — and the three entries go after the admin table, one blank line between); Task 21 Steps 1–2 (`$BASE` instead of `origin/main`, which on a replay is not the base).
- **Tasks 17–19 (critical slice):** Tasks 17 and 18 unchanged. Task 19 changed four times, none behaviourally — at the first replay the Step 4 import instruction (two Find/Replace pairs) and the Step 1 test's wait for the provider's frame; at the second-clone proof (below) the Step 4 imports as one inline and one block Find/Replace, and Step 5's «Before `  async function handleConfirm(publish: boolean) {`, insert:» (whose block ends with that very line, so a literal insert duplicated it) as a Find/Replace of that line with the same block. Per item 5 below, Tasks 17–19 go back through the adversarial review on this text.

**Second-clone proof (2026-10-07).** A second fresh clone (`/private/tmp/claude-501/c6-replay/repo2`: 0aa33514 merged with e3086f77, tree identical to replay-base; `node_modules` cloned with `cp -Rc`; the first clone's `task-N` tags fetched) re-applied Tasks 1–20 by script (`tools2/apply2.py`, whose docstring is the grammar: the forms «How to read an edit step» lists, nothing else; any other edit-like prose is reported, never guessed). A dry pass (each task applied on the first clone's `task-(N-1)` and diffed against its `task-N`) found where the text did not determine the tree; the text was corrected, then the real pass ran 1 → 20 in one go: every Find exactly once, every «see it fail» red for its stated reason, every «see it pass» green, gates on every task, each task committed. **All 20 trees IDENTICAL to the first replay's, all 20 commit messages identical, gate counts equal to the table above at every task** (no flake, no re-run) — for the text as it then stood; the post-replay amendments below changed Tasks 2, 4, 10 and 16 on purpose. Corrections, all format-only (each reproduces the first replay's bytes):

- *Header:* «How to read an edit step» names the inline Find → Replace, «(the one after …)», `After … line, add:`, `immediately before / above … insert`, how the file is named, and «identical edits in both».
- *Imports with no stated position* («add … beside the file's other `./` imports», «Add imports: …», «add … to the import list», «extend …») → inline or block Find/Replace anchored on the import they follow: Task 1 Steps 5–7, Task 14 Step 1, Task 15 Step 6, Task 16 Steps 4, 7 and 8, Task 19 Step 4.
- *Prose edits* → explicit pairs: Task 1 Step 8 (`fairnessEngineV3.test.tsx`), Task 14 Step 6 (`isV3` in two dependency arrays), Task 15 Step 5 (`Button` already imported; the `props` destructure), Task 16 Step 8 («and likewise for …» → three `<MemberPool` pairs).
- *Positions:* Task 6 Step 1 and Task 20 Steps 3 and 6 → `After … line, add:` (Task 20 Step 6's block opens with the blank line that separates it from the table); Task 19 Step 5 → Find/Replace (above).

**Post-replay amendments and re-proof (2026-10-07).** After the second-clone proof, the critic's findings and Frank's copy follow-up changed this text:

- *Header and spec status:* the header now states the spec's true status — self-reviewed, terminal state `READY_FOR_REVIEW` (the spec's header line, which read `DRAFT`, was aligned with its §16 with a dated note), Frank's authorization to proceed with the children, and that he has not read C6 itself. Task 0 Step 1 gains the entry gate «Frank has read the C6 spec's §5.11 confirm protocol and §7 copy, or explicitly waived it» before Task 1.
- *Stale `[PROVISIONAL]` descriptions removed:* «How to read an edit step», Task 0 Step 4 (now «re-verify the anchors from C2 Tasks 11–17 and C5 Tasks 10–15 (re-verified at replay 2026-10-07 against `4c50309b`) against the merged `main`») and its stop rule, Task 16 Step 9's expectation, Self-review item 2, Procedure item 3.
- *Task 0 Step 5:* if the next two free ADR numbers are not `0051`/`0052`, both are replaced everywhere (the places are listed there).
- *Task 2 Step 7 (`docs/SECRETS.md`, `OWT_SOLVER_V3_URL`):* the value is set with `printf '%s' "$URL" | npx vercel env add OWT_SOLVER_V3_URL <preview|production> --type config` and removed with `npx vercel env rm OWT_SOLVER_V3_URL <env> --yes` (the sibling entries' style); it is stated as non-sensitive config; a rotation is `rm` + `add` back to back, then one redeploy, and the blast radius names the build that could start between the two.
- *Copy (Frank, 2026-10-07: «Mes por medio» governs Sunday lead only — BGV/Coro and the voice floor are untouched):* Task 4's `v3Copy.ts` — `cadence_off_led` «…, su mes sin domingo («Mes por medio»).», `V3_CADENCE_STATE.off` «no dirige domingo», `.out` «no dirige domingo: no está en la lista de Dom Lead», `V3_PANEL_REASON.cadenceOff` «Mes por medio: no dirige domingo en {mes}.», `V3_LINES.motivoCadence` «es su mes sin domingo («Mes por medio»)»; the tests that assert them: Task 10 Step 1 (SP-7's motivo table) and Task 16 Step 1 (the DL reason line); the `x1LineText` doc comment (Task 16 Step 4) and sibling row S-19 quote the new line. Keys and behaviour unchanged. C2's own X1 sentences («En {mes} no dirige domingo: …» since C2's amendment of 2026-10-07, extracted verbatim by Task 16 Step 4) are C2's copy — sibling row S-22 (applied on C2's branch 2026-10-07). The spec's §7.2 and §7.7 carry the dated amendment.
- *EQ-6 (Task 16 Step 2):* a new component test — at a stubbed 390 px viewport (`innerWidth` and a narrow `matchMedia`, as `participationAlongside.test.tsx` stubs one), after a v3 run, Ana's card inside `[data-fairness-cards]` reads «En este plan 2 · Queda le deben 0.3»; the cards are `md:hidden` and the table sits in its own `hidden md:block overflow-x-auto` box. It sits in Step 2's component file, not Step 1's model file, because it renders (Step 1 is `node`-environment and renders nothing). A mutation check (expecting «En este plan 3») failed as it should. Coverage row and gaps paragraph updated.
- *CF-9's «none for a specials-only month» stays declined* (review round 1). What proves it today: the v3 confirm's history filter is today's P1 second lock (`d._type !== "special_role"`) copied verbatim, and today's create suite proves that lock under v2. What would add it: lifting the create suite's special-composer helpers into `v3PlannerHarness.tsx` and a specials-only 2-month confirm asserting no history entry for that month. Coverage row and gaps paragraph say so.
- *Coverage CF-11* now cites tests, not code (`v3ConfirmRun.test.ts` › the record step › a network error; the drafts thrown-POST case; `MonthGenerator.v3Confirm.test.tsx` › «other failure» offers «Reintentar (n pendientes)»).
- *Release R6:* after any catch-up merge of `main` or ADR renumber — disable auto-merge, scoped re-review of the merge range, the five gates on the new tip, preview re-merge with the dev alias + SHA verified, then re-arm on that exact commit.
- *Procedure item 4's confirmations, made at replay:* `EligibilityRefusalReason`, `EligibilityIssueCode` and `EligibilityResult` by Task 0 Step 4's grep, and `EligibilityMember` present in `app/utils/fairnessEligibility.ts` at the base (grep); `historyEntryFromDrafts`'s key format (year/month) by Task 19's history test; `CueDialog`'s accessible name from `title` by Task 19's dialog query («El plan quedó incompleto»); the composer's labels by Task 15's specials test; `buildFairnessMonthDocument`'s output parsing by Task 17's round-trip test — all green at the first replay, the second-clone proof and the re-proof below.

**Re-proof.** The changed text touches Tasks 2, 4, 10 and 16 (code, tests or Find/Replace text), so the second clone was reset to Task 1 (`r2-task-1`, tree identical to `task-1`) and Tasks 2–20 re-applied by script from the amended text (`tools2/apply3.py` — `apply2.py` with tags `r3-task-N` and the tree comparison against the first replay made advisory, since four tasks now change on purpose). Every Find matched once, every «see it fail» failed for its stated reason (Task 16: the model file fails to load with `Cannot find module '../v3Equidad'` and all 9 component tests fail, the new EQ-6 test among them), every «see it pass» passed, gates green at every task, every commit message identical to the first replay's, no `Co-Authored` line, no `gcf/**`/`gcf_v3/**` change; the parsed op list of Tasks 1–20 after the final edits to this text (292 ops) equals the one that ran. Final HEAD `547b1ca9`; `git diff --stat task-20 r3-task-20` = 6 files, exactly the amended ones (`docs/SECRETS.md`, `v3Copy.ts`, `v3Prefill.test.ts`, `v3Equidad.test.ts`, `MonthGenerator.v3Equidad.test.tsx`, `fairnessPreviewModel.ts`'s comment). Task 21 Step 3's seven guards plus solverDeployment and engineProp on the final tree (clientBoundary, cueDialogMount, serviceCommitCallers, protectedReadAudit, fairnessFormat, v3CodesSync, v3PinCapSync, solverDeployment, engineProp): 9 files / 109 tests passed; all 34 test files the Coverage table names exist.

| Task | see it pass (files / tests) | Gates: tsc · vitest files / tests · eslint errors / warnings |
|---|---|---|
| 2 | 3 / 40 | 0 · 472 / 8684 · 0 / 81 |
| 3 | 1 / 11 | 0 · 473 / 8695 · 0 / 81 |
| 4 | 3 / 29 | 0 · 476 / 8724 · 0 / 81 |
| 5 | 1 / 9 | 0 · 477 / 8733 · 0 / 81 |
| 6 | 1 / 24 | 0 · 478 / 8757 · 0 / 81 |
| 7 | 1 / 13 | 0 · 479 / 8770 · 0 / 81 |
| 8 | 1 / 13 | 0 · 480 / 8783 · 0 / 81 |
| 9 | 1 / 15 | 0 · 481 / 8798 · 0 / 81 |
| 10 | 2 / 56 | 0 · 482 / 8815 · 0 / 81 |
| 11 | 2 / 23 | 0 · 484 / 8838 · 0 / 81 |
| 12 | 2 / 31 | 0 · 486 / 8869 · 0 / 81 |
| 13 | 1 / 15 | 0 · 487 / 8884 · 0 / 81 |
| 14 | 6 / 195 | 0 · 488 / 8896 · 0 / 80 |
| 15 | 6 / 80 | 0 · 489 / 8907 · 0 / 80 |
| 16 | 9 / 76 | 0 · 491 / **8921** · 0 / 80 |
| 17 [CRITICAL] | 2 / 36 | 0 · 492 / **8950** · 0 / 80 |
| 18 [CRITICAL] | 2 / 33 | 0 · 493 / **8968** · 0 / 80 |
| 19 [CRITICAL] | 6 / 122 | 0 · 494 / **8981** · 0 / 80 |
| 20 | 2 / 5 | 0 · 494 / **8981** · 0 / 80 |

Tasks 2–15 equal the first replay's counts; from Task 16 on every full run has one more test (the EQ-6 test), so the final tree is **0 · 494 / 8981 · 0 / 80** (the table above and Task 21's row are the first replay's, 8980). **Tasks 17–19 (critical slice): no change from these amendments** — not one line of their text changed; their own files (`v3Confirm.ts`, `v3ConfirmRun.ts`, `V3IncompleteDialog.tsx`, their three test files, and Task 19's `MonthGenerator.tsx` hunks) are byte-identical to the first replay's `task-19`, and their trees differ from it only by the files inherited from Tasks 2, 4, 10 and 16.

**Next:** the real execution follows the procedure below once C1, C3, C2 and C5 are on `main`; Tasks 17–19 first go back through the adversarial review (item 5).

**Procedure for the real execution** (unchanged in substance):

1. **When:** after C1, C3, C2 and C5 have all merged to `main` (Task 0 Step 1 is the entry gate).
2. **Where:** a throwaway clone built from that `origin/main` under the scratchpad (outside every checkout), never an existing worktree.
3. **How:** task by task, each ending with the five gates green and a commit; Task 0 Step 3 records the baseline counts (files/tests/warnings) and Step 4 re-checks the C2 Tasks 11–17 / C5 Tasks 10–15 symbols against the merged `main`.
4. **Fixing the plan:** a `Find` that does not match exactly once, a renamed C2/C5 symbol, a test that cannot go red for the stated reason, or a fixture whose expectation is wrong is a **stop-and-fix of this plan's text** (never a silent local adjustment): edit the task, re-run it from a fresh state, and record the change in a short «Replay log» appended here. In particular confirm at replay: C2's final names for `EligibilityRefusalReason`/`EligibilityIssueCode`/`EligibilityMember`; the exact text of C2's `FairnessPreviewPanel`/`fairnessPreviewModel` blocks Task 16 edits and of the two `<FairnessPreviewPanel` mounts Task 16 extends; `historyEntryFromDrafts`'s key format (Task 19's history test asserts year/month only); `CueDialog`'s accessible name from `title` (Task 19's dialog query); the composer's labels (Task 15's specials test); and that `buildFairnessMonthDocument`'s output parses (Task 17's round trip — a failing round trip is a C2 finding, fixed in C2's module, never worked around here).
5. **If Tasks 17–19 change** during replay, their text goes back through the adversarial review (two fresh `APPROVED` on byte-identical text) before execution continues past them.
6. **Proof of mechanical applicability:** once green end to end, re-apply the plan's own text to a second fresh clone of the same `origin/main`; every anchor must match exactly once at its point in the plan and each task's tree must come out identical to the executed one (the C2 plan's method).

**Real execution log (2026-10-07).** Base `origin/main` `c0375d7d` (C1, C3, C2, C5 and C4 merged); a throwaway clone under the scratchpad, `node_modules` cloned with `cp -Rc` from a complete checkout. Baseline: tsc 0 · 480 files / 8839 tests · eslint 0 errors / 81 warnings. The text was applied by script (`apply4.py` = `apply3.py` retargeted at that clone, no comparison with the replay's tags), Tasks 1–20, each with its red check, targeted pass, the five-gate run and its commit. Three stop-and-fixes of this text, none in Tasks 17–19:
- *Task 0 Step 5:* C5 wrote `ADR-0051`, so C6's records are `0052`/`0053`; Task 20 Step 3's index anchor follows C5's row (825605f3).
- *Task 20 Step 5:* since 2026-10-07 `CLAUDE.md`/`AGENTS.md` are an index and the long form is `docs/agents/project-rules.md`, where the replay's two anchors now live; the two edits go there and one index line each goes into `CLAUDE.md`/`AGENTS.md`.
- *Task 20 Step 6:* C2's final tip had already recounted the components inventory heading (109 / 26 admin); the Find takes that heading, the replacement (111 / 28 admin) is unchanged.
Final tree: tsc 0 · 506 / 9176 · eslint 0 / 80; Task 21 Steps 2–3 green; Step 4: all 34 test files the Coverage table names exist once and passed. The text from «The critical slice» to Task 19's end is byte-identical to the approved text (review log 8bc0fb47; approved digest `1579b20c…`). Branch `claude/solver-v3-c6-planner-v3` (Tasks 1–20 plus a commit carrying the C6 spec's 2026-10-07 amendments to `main`).
