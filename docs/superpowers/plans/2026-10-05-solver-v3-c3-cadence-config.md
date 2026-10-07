# Solver v3 · C3 — «Mes por medio» in the rule set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin can mark a person's Sunday lead as «Mes por medio» in «Configuración del Solver» → «Reglas»; the setting is stored in the shared `solverConfig` document, no writer can drop it silently, it resolves to exactly one worship member for C2/C6, and v2 is inert to it.

**Architecture:** One optional restriction field (`sundayCadence?: "alternate"`) validated, serialized and read by the one existing parser/serializer/reader (`app/utils/solverConfigWriteRequest.ts`), which also gains the parent-A38 check (`exactCapOverlaps`) and the config version (`SOLVER_CONFIG_VERSION = 2`) that the whole-document POST enforces before it reads or writes anything. v2 sees a `v2View` of the config inside `solverPools` and the first-match `isExcludedFromLead`. A new neutral module (`app/utils/sundayCadence.ts`) is the exactly-one name resolver, the cadence-members function and the «not in Líderes Domingo» predicate, each applying the worship filter itself. The rule form gains a «Domingo» `SegmentedControl` whose data path survives a UI-only rollback; cards gain the chip, the name chips and the A38 mark; the panel gains the warning behind a closed-by-default input C6 opens.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client components, Sanity v5 schema objects, TypeScript, vitest + @testing-library/react (jsdom per file), `tsx` for the seed script.

**Spec:** `docs/superpowers/specs/2026-10-05-solver-v3-c3-cadence-config-design.md` — APPROVED at critical tier by two sequential fresh reviewers on SHA-256 `755f4749aa951454d847073756675b85d861e61620f221823fef3e6dc4730706` (re-hashed 2026-10-06: unchanged). Its review log, `docs/superpowers/specs/2026-10-05-solver-v3-c3-cadence-config-design-review-log.md`, routes twelve open items (10–21) to this plan; each has a disposition in «Review-log items» below. Parent: `docs/superpowers/specs/2026-10-05-solver-v3-fairness-design.md` (amendments A1, A6–A11, A14, A22, A26, A28, A29, A31, A34, A35, A38, A41). Siblings that consume C3 (read-only here): C2 (IF2-15, RES-5/RES-7, WR-4), C4, C6 (IF-C3, WN-1/WN-2, CTL-1), C7 (its C3 row). The spec is the contract; this plan never changes it. Executors read both.

**Grounding.** Every path, anchor and line number below was read on `origin/main` **`20fd3367`** (2026-10-06, C0 merged). `git diff --stat 3dbc189b 20fd3367 -- app sanity scripts docs/DATA_MODEL.md` touches no file C3 edits (only C0's CI files and `CueDialogProvider`), so the spec's line citations hold; `CLAUDE.md`/`AGENTS.md` changed (C0's gate wording) and the anchor used here is unchanged. The whole plan was executed once in a scratch clone of `20fd3367` before it was written, and the plan's own text was then re-applied mechanically to a second fresh clone (every Create / Append / Find→Replace matched its anchor exactly once, or the stated number of times), ending byte-identical to the executed tree. Baseline on `20fd3367`: `npx tsc --noEmit` 0 errors; `npm test` 428 files / 7843 tests; `npx eslint .` 0 errors, **81 warnings**. After Task 13: 438 files / 7966 tests, `tsc` 0, eslint 0 errors and 81 warnings. If `origin/main` has moved when you start, re-run each `Find` anchor before editing; a missing anchor is a stop-and-report, never a guess.

**How to read an edit step.** A **Create** step writes the whole file. An **Append** step adds the block at the end of the file, after one blank line. A **Find** … **Replace with** pair replaces text that occurs exactly once in that file at that point of the plan. A **Replace every** … **with** pair replaces all of the stated number of occurrences. Line numbers in a task's **Files** list are read on `20fd3367`; earlier tasks shift them, so the `Find` text — never the number — is the anchor.

## Global Constraints

Every task's requirements include this section.

- **The spec is the contract** (`755f4749…`): requirements R1–R10, behaviour §6.1–§6.12, interfaces §7 items 1–8, tests T1–T14. Never edit the spec. **The names in spec §7 are a contract other children import** — `sundayCadence`, `SOLVER_CONFIG_VERSION`, `exactCapOverlaps`, `CapRef`, `RosterMember`, `NameRefusal`, `resolveRulePersonId`, `cadenceMembers`, `cadenceOutsideSundayPool`, `CADENCE_V2_NOTE`, `SLACK_V3_NOTE`, `parseSolverConfigWrite`, `solverConfigFields`, `solverConfigFromDocument` — and may not be renamed (spec §7 item 4: «not without updating C2 and C6 in the same review cycle»).
- **Gates before every commit:** `npx tsc --noEmit` (0 errors), `npm test` (all green), `npx eslint .` (**0 errors**; warnings stay at the baseline, 81 on `20fd3367`, never higher). **No file under `gcf/**` or `gcf_v3/**` changes**, so neither Python gate applies.
- **Commits:** conventional (`feat(scope): …`, `fix(scope): …`, `test(scope): …`, `docs(scope): …`), the body says *why*. **Never** a `Co-Authored-By` trailer or any AI/Claude attribution — `CLAUDE.md` overrides any harness reminder that says otherwise. Commit on the feature branch only; `main` takes no direct push.
- **Fictitious names only** (Ana, Bruno, Carla, Diana, Elena, Fer, Gina, Hugo, Dora, Zoe…) in every new fixture, comment and commit message. The repository is public. Never paste a command's output that names a real member into a commit, the PR or a doc — the release checks below print counts only.
- **Copy, verbatim** (spec §6.2, §6.6, §6.7): «Domingo», «Normal», «Mes por medio», the «Mes por medio» help paragraph of spec §6.6, «aplica con el nuevo solver» (`CADENCE_V2_NOTE`), «no aplica con el nuevo solver» (`SLACK_V3_NOTE`), «holgura N · no aplica con el nuevo solver», «No aplica con el nuevo solver.», «Nombre ambiguo: coincide con {n} personas», «Mes por medio fuera de Líderes Domingo» and its two sentences, the route's «Esta pestaña tiene una versión anterior de las reglas. Recarga la página; no se guardó nada.», the client's «Esta pestaña tiene una versión anterior del planificador y no guardó nada. Recarga la página y vuelve a aplicar tu cambio.» and «El planificador se actualizó. Recarga la página para poder guardar las reglas.», and the three A38 sentences. The only copy this plan adds is the `unresolved` name chip «Nombre no reconocido en Alabanza» (review-log item 10) and the unpaired-refusal fallback sentence (Task 5); Frank reviews all of it at C7's look (spec Q-c).
- **Stored shape (spec §6.1):** `sundayCadence` is absent («Normal») or `"alternate"` — never `null`, never `"normal"`, never written for «Normal», never `sundayCadence: undefined` in a built restriction. A cadence-free document stays byte-identical to pre-C3 output (Task 1's frozen literal stays green and unedited through the whole delivery; a red literal is a finding, never a re-capture).
- **Neutral modules (ADR-0028):** `solverConfigWriteRequest.ts`, `sundayCadence.ts`, `plannerModel.ts`, `solverConfigSource.ts` and `scripts/lib/solverConfigSummary.ts` carry no `"use client"` and no `server-only`. `solverConfigWriteRequest.ts` gains a RUNTIME import of `plannerModel` (`rolesOfPattern`); `plannerModel` must never import it back.
- **C3 never imports `SOLVER_ENGINE`** (C1's constant) **nor C2's resolver**, and never reads an effective engine (spec §5 non-goals). Engine-dependent rendering is C6's: the warning sits behind `showCadencePoolWarning` (default `false`); `CADENCE_V2_NOTE` renders unconditionally in its own span.
- **UI invariants (CLAUDE.md):** «Domingo» is the house `SegmentedControl` (every one-of-N choice — never `aria-pressed` toggles, never a bare `<input type="radio">`); no new `<input>`/`<select>` (the 16 px rule is not engaged; `admin/` is excluded from `inputFontSize.test.ts` anyway); no new `CueDialog`, toast or `Menu`; client mutation handlers keep their try/catch/finally, `res.ok` checks and loading flags (`useSolverConfig.save` gains a field, not a flow); the four `SolverConfigSource` states stay four (`ready` gains `configVersion`).
- **v2 stays v2:** first-match name resolution (`resolveToMemberName`), every v2 suite (`plannerModel`, `solverPools`, `ruleEnforcement`, `localFill`, `pinViolations`, `saturdayFloors`, `trailingSaturday`, `leadPoolHistory`, `pinModel`, `patternRolesSync`) passes **unmodified**. The one change to what the v2 writer accepts is A38's exact-count refusal.
- **No production Sanity write** by the delivery or by any agent — including a «Guardar reglas» on dev: **`preview` writes the production dataset** (`CLAUDE.md` «Vercel safety»; spec E18). The release's read-only checks print counts only.
- **No new secret or environment variable**; `docs/SECRETS.md` is untouched (spec §12).
- **`colour-inventory.json` tracks the tree:** `colourInventory.test.ts` compares `summary.filesScanned`, so the task that adds a non-test file under `app/` (Task 8, `sundayCadence.ts`) regenerates `app/utils/__tests__/__fixtures__/colour-inventory.json` with `node scripts/colour-inventory.mjs` and commits it.
- **`CLAUDE.md` and `AGENTS.md` stay byte-identical** outside their title and «## Continuous improvement» (`agentDocsParity.test.ts`): every `CLAUDE.md` edit is made in `AGENTS.md` too (Task 13).
- **ADR number:** `0049` is the next free number on `main` today. ADR numbers follow the order records reach `main`: if another record lands first (C2 also writes one), renumber in the merge of `main` into this branch — file name, title, index row and every pointer — and let `adrIndex.test.ts` confirm.
- **Never name the existing one-off rule-name repair script in `scripts/` by its file name** in any new text (its name carries a real member's name); refer to it as «the rule-name repair script» (spec E15).

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `app/utils/sundayCadence.ts` | Neutral. `RosterMember`, `NameRefusal`, `CadenceOutsideReason`; `resolveRulePersonId` (exactly one worship member), `cadenceMembers` (union of «Mes por medio» ids + refusals), `cadenceOutsideSundayPool` (the §6.7 predicate); copy `CADENCE_V2_NOTE`, `SLACK_V3_NOTE`, `CADENCE_OUTSIDE_HEADING`, `CADENCE_OUTSIDE_SENTENCE`. Spec §7 items 4–5. |
| `scripts/lib/solverConfigSummary.ts` | Pure: the seed script's summary lines — rules by kind and ordinal, «Mes por medio» shown, no key and no person text (parent A41). |
| `docs/adr/0049-mes-por-medio-is-a-restriction-setting-behind-a-version-guard.md` | C3's ADR (parent A31; spec §12). |
| `app/utils/__tests__/solverConfigSchema.test.ts` | Studio field (§6.10). |
| `app/utils/__tests__/solverConfigVersion.test.ts` | T7 tripwire: key sets per level, accepted values per enumerated field, per version. |
| `app/utils/__tests__/sundayCadence.test.ts` | T9, T10 (predicate), copy. |
| `app/components/admin/__tests__/cadenceV2Inert.test.ts` | T8: every v2 answer equal for `C` and `v2View(C)`. |
| `app/components/admin/__tests__/MonthGenerator.configVersion.test.tsx` | T6 on screen: save disabled on another version; refusal without «Recargar reglas». |
| `app/components/admin/__tests__/MonthGenerator.cadence.test.tsx` | T11: edit-path tests that survive the UI-only rollback, control tests, chip, Holgura notes. |
| `app/components/admin/__tests__/MonthGenerator.cadenceWarning.test.tsx` | T10 panel + T11 name chips (unfiltered roster, kids-only namesakes). |
| `app/components/admin/__tests__/MonthGenerator.exactOverlap.test.tsx` | T14 UI: form row message + `canAdd`, stored pair marked, removal unblocks. |
| `scripts/__tests__/solverConfigSummary.test.ts` | T12 summary lines; A41 leak guard. |
| `scripts/__tests__/seedSolverConfig.test.ts` | T12 through the real script under `tsx`: A38 and cadence refusals before any read; print guard. |

**Modified (production)**

| File | Change |
|---|---|
| `app/components/admin/plannerModel.ts` | `PersonRestriction.sundayCadence?`; `v2View`; `solverPools` reads `v2View(input)`. |
| `app/utils/solverConfigWriteRequest.ts` | Runtime import of `rolesOfPattern`; exported `FAIRNESS_VALUES`/`CAP_OPS`/`SUNDAY_CADENCE_VALUES`; `SOLVER_CONFIG_VERSION = 2`; `sundayCadence` validated, stored, read; `CapRef`, `ExactCapOverlap`, `exactCapOverlaps`; parser refuses `:exact_overlap`. |
| `sanity/schemas/solverConfig.ts` | `solverRestriction.sundayCadence` (inspection only). |
| `app/components/admin/solverConfigSource.ts` | `ready.configVersion`; `isOutdatedSource`; `saveFailure(status, body, sent?)` maps `configVersion` and `:exact_overlap`; copy: `SAVE_OUTDATED_TAB_MESSAGE`, `PLANNER_UPDATED_MESSAGE`, `EXACT_ROLE_LABEL`, `exactOverlapFormMessage`, `exactOverlapCardMessage`, `exactOverlapRefusalMessage`. |
| `app/components/admin/useSolverConfig.ts` | Sends `configVersion`; passes the sent config to `saveFailure`. |
| `app/api/admin/solver-config/route.ts` | The version guard (after auth and JSON, before `rev`, parse and read); `configVersion` on GET (absent too) and the POST echo. |
| `app/components/admin/leadPoolHistory.ts` | `isExcludedFromLead` reads `v2View(config)`. |
| `app/components/admin/MonthGenerator.tsx` | `MemberOption.ministries?`; save bar disabled on another version; «Domingo» control + data path + `canAdd`; card chip, Holgura notes, name chips, A38 card mark; form A38 row check (`siblings` prop); `RuleBuilder.cadenceNameIssues`; `SolverConfigPanel`/`Props` `showCadencePoolWarning`. |
| `app/components/admin/serviceCardModel.ts` | `MemberOption.ministries?: unknown` (type widening only). |
| `scripts/seed-solver-config.ts` | Summaries through `solverConfigSummaryLines`; header notes. |

**Modified (tests, fixtures, docs)** — `app/utils/__tests__/solverConfigWriteRequest.test.ts`, `app/api/__tests__/solverConfigRoute.test.ts`, `app/components/admin/__tests__/solverConfigSource.test.ts`, `app/components/admin/__tests__/useSolverConfig.test.tsx`, `app/components/admin/__tests__/rulesHarness.ts`, `app/utils/__tests__/__fixtures__/colour-inventory.json`; `docs/DATA_MODEL.md`, `docs/API_REFERENCE.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `docs/adr/README.md`, `CLAUDE.md`, `AGENTS.md`.

**Deliberately untouched:** `app/components/admin/solverConfigDefaults.ts` (spec §6.9), `app/utils/studioProtection.ts` and its test (spec §6.10, T13), `app/api/admin/members/[id]/route.ts` (its pool-array patch is a targeted writer, spec E15), everything under `app/mcp/**` and `app/api/mcp/**` (spec E16), `gcf/**`, `gcf_v3/**`, `docs/SECRETS.md`.

## Review-log items routed to this plan

| # | Item | Disposition |
|---|---|---|
| 10 | §6.6 says an unresolved cadence name is «already reported by the existing banner» — false for a super-admin whose only match is a kids-only member (v2's first match resolves her) | Task 10 adds a card chip for `unresolved` too, «Nombre no reconocido en Alabanza», computed by `resolveRulePersonId` over the unfiltered roster (the existing banner is on the grid step, not on the rule cards). Test: `MonthGenerator.cadenceWarning.test.tsx`. |
| 11 | T8 narrower than §6.4; `isExcludedFromLead` first-match shadowing | Task 7 compares `solverPools`' whole return object (`requestMemberIds` as an ordered array), `buildSolveRequest` with and without `withholdTrailing`, `pinConflicts`, `evaluate`, `ruleViolationsForColumn`, `fairnessByMemberId`, `priorMonthLeadVisibility` (both roles) and `pinViolationNotices`; `isExcludedFromLead` reads `v2View`, with a corpus case that would shadow it. |
| 12 | §11 rule 6 is process-only | Release step 7 and the ADR's Consequences state it; release note to Frank. |
| 13 | Client runs `exactCapOverlaps` on raw state, server after `normalizeLabel` | `exactCapOverlaps` normalises person and pattern through `normalizeLabel` itself (Task 3), so both see the same pairs for any body; test «normalises the way the parser does…». |
| 14 | `{rol}` «as the cap chips name it» — chips show patterns | `EXACT_ROLE_LABEL` names the five role keys as the form's pattern list names the single-role patterns (Dom Lead, Sáb Lead, Dom BGV, Sáb BGV, Dom Coro); pinned in Task 5. |
| 15 | Seed's new runtime `@/` import of `plannerModel` | Task 12 runs the real script under `tsx` (`seedSolverConfig.test.ts`), proving the import resolves; it refuses before any client exists. |
| 16 | Guard order vs. auth | Task 6: `gate()` → JSON → object → `configVersion` → `rev` → parse → read; test «still answers 403, not 400, to a non-manager». |
| 17 | `exact_overlap` indices | Task 3 runs `exactCapOverlaps` only after the parser's `if (issues.length) return`; test «only runs once every item parsed». |
| 18 | Other live pre-C3 writers (older immutable deployment URLs, `verify/service-readiness`) | ADR-0049 Consequences; Release step 7. |
| 19 | A pre-C3 tab sees «El servidor rechazó las reglas…» with no reload hint | Release note to Frank: reload open admin tabs after the production merge. |
| 20 | `not_ticked` copy may overstate under v3 | Copy shipped as the spec writes it; Frank's wording review at C7 (spec Q-c). |
| 21 | Key hygiene (parent A41) in the seed's summary/diff | Task 12: rules printed by kind and ordinal, never by key or person text (`scripts/lib/solverConfigSummary.ts`), with a leak test. |

---

## Task 0: Branch

**Files:** none.

- [ ] **Step 1: Branch from the current `main`**

```bash
git fetch origin
git switch -c claude/solver-v3-c3-cadence-config origin/main
git log -1 --oneline
```

Expected: the branch points at `origin/main` (`20fd3367` or later). If the coordinator runs this in a worktree (`CLAUDE.md`: only when two things must be in flight at once), use `EnterWorktree`, populate `node_modules` with `cp -Rc` from a checkout whose `package-lock.json` matches (never a fresh install), and symlink `.env.local` to the primary checkout's copy (`ln -s ../../../.env.local .env.local` from the worktree root) — never write one inside the worktree.

C3 has no prerequisite child (parent §11). If a sibling has reached `main` first, re-run every anchor before editing. The known shared files, all in different declarations or sections from C3's: C1 edits `plannerModel.ts` (`GridColumn`, `DraftCard`), `serviceCardModel.ts` (`ServiceRole`), other parts of `MonthGenerator.tsx`, `docs/DATA_MODEL.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `CLAUDE.md`/`AGENTS.md`, and regenerates `colour-inventory.json` (regenerate it again in Task 8 on top of theirs); C2 writes an ADR (take the next free number, Global Constraints). A missing anchor is a stop-and-report, never a guess.

- [ ] **Step 2: Record the baseline**

Run: `npx tsc --noEmit && npx eslint . 2>&1 | tail -1`
Expected: no `tsc` output; `✖ 81 problems (0 errors, 81 warnings)` on `20fd3367` (if `main` has moved, record the new count — it is the ceiling for the whole delivery).

---

## Task 1: Step zero — freeze the pre-C3 serializer output

Spec §6.1 and T2: «A document written by C3 code for a config with no cadence is byte-identical to what pre-C3 code writes for the same config.» The delivery's first commit pins that as a literal **computed on the unchanged code**; it stays green and unedited through every later task.

**Files:**
- Modify: `app/utils/__tests__/solverConfigWriteRequest.test.ts` (append)

**Interfaces:**
- Consumes: `parseSolverConfigWrite`, `solverConfigFields` (already imported by the file); `SolverConfig` (already imported).
- Produces: the module-scope constants `FROZEN_CONFIG: SolverConfig` and `FROZEN_FIELDS_JSON: string` in this test file. Tasks 2 and 3 append tests to the same file that read `FROZEN_CONFIG`.

- [ ] **Step 1: Append the frozen literal**

**Append** to `app/utils/__tests__/solverConfigWriteRequest.test.ts`:

```ts
// ─── Solver v3 C3 · step zero — the pre-C3 serializer, frozen ────────────────
//
// Written and asserted on the UNCHANGED serializer, before any C3 code lands
// (C3 §6.1, T2): a document C3 writes for a config with no «Mes por medio» must
// be byte-identical to what the pre-C3 code writes for the same config. A red
// literal here is a finding about the change, never a value to re-capture.
const FROZEN_CONFIG: SolverConfig = {
  sundayLeads: ["m-ana", "m-carla"],
  saturdayLeads: ["m-bruno"],
  support: ["m-diana"],
  restrictions: [
    {
      id: "r-ana", person: "Ana", excludedPatterns: ["Sat.*"], fairness: "exempt", fairnessSlack: 1,
      weekExclusions: [{ id: "w-1", week: 2, pattern: "*.*" }],
      caps: [{ id: "c-1", pattern: "Sun.Lead", op: "==", value: 2, relative: false, relOffset: 0 }],
    },
    { id: "r-bruno", person: "Bruno", excludedPatterns: [], fairness: "slack", fairnessSlack: 2, weekExclusions: [], caps: [] },
  ],
  conflicts: [{ id: "x-1", personA: "Ana", personB: "Bruno", pattern: "*.Lead" }],
  presence: [{ id: "p-1", persons: ["Carla", "Diana"], pattern: "Sun.BGV" }],
};

const FROZEN_FIELDS_JSON =
  '{"sundayLeads":["m-ana","m-carla"],"saturdayLeads":["m-bruno"],"support":["m-diana"],' +
  '"restrictions":[{"_type":"solverRestriction","_key":"r-ana","id":"r-ana","person":"Ana",' +
  '"excludedPatterns":["Sat.*"],"fairness":"exempt","fairnessSlack":1,' +
  '"weekExclusions":[{"_type":"solverWeekExclusion","_key":"w-1","id":"w-1","week":2,"pattern":"*.*"}],' +
  '"caps":[{"_type":"solverCap","_key":"c-1","id":"c-1","pattern":"Sun.Lead","op":"==","value":2,"relative":false,"relOffset":0}]},' +
  '{"_type":"solverRestriction","_key":"r-bruno","id":"r-bruno","person":"Bruno","excludedPatterns":[],' +
  '"fairness":"slack","fairnessSlack":2,"weekExclusions":[],"caps":[]}],' +
  '"conflicts":[{"_type":"solverConflict","_key":"x-1","id":"x-1","personA":"Ana","personB":"Bruno","pattern":"*.Lead"}],' +
  '"presence":[{"_type":"solverPresence","_key":"p-1","id":"p-1","persons":["Carla","Diana"],"pattern":"Sun.BGV"}]}';

describe("C3 step zero — a cadence-free config serializes byte-identically to pre-C3", () => {
  it("solverConfigFields matches the frozen pre-C3 JSON, key order included", () => {
    expect(JSON.stringify(solverConfigFields(FROZEN_CONFIG))).toBe(FROZEN_FIELDS_JSON);
  });

  it("the parser's stored fields for the same body are the same bytes", () => {
    const parsed = parseSolverConfigWrite(FROZEN_CONFIG);
    if (!parsed.ok) throw new Error(parsed.issues.join(", "));
    expect(JSON.stringify(parsed.value.fields)).toBe(FROZEN_FIELDS_JSON);
  });
});
```

- [ ] **Step 2: Run it on the unchanged code**

Run: `npx vitest run app/utils/__tests__/solverConfigWriteRequest.test.ts`
Expected: PASS (27 tests). It must pass **before** any C3 code exists — that is what makes it a freeze. If it fails, the literal was mistyped: fix the literal against the unchanged serializer, never the serializer.

- [ ] **Step 3: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add app/utils/__tests__/solverConfigWriteRequest.test.ts
git commit -m "test(solver-config): freeze the pre-C3 serializer output" -m "C3 step zero (spec §6.1, T2): a document C3 writes for a config with no «Mes por medio» must be byte-identical to what the pre-C3 serializer writes. The literal is asserted on the unchanged code so every later change is measured against it."
```

---

## Task 2: The stored field — type, parser, serializer, reader, Studio

Spec R1, §6.1–§6.3, §6.10; T1, T2, T3. Absent = «Normal», `"alternate"` = «Mes por medio», anything else refused at `restrictions[i].sundayCadence`; the serializer writes no key for «Normal»; the reader is total and defensive like `fairness`.

**Files:**
- Modify: `app/components/admin/plannerModel.ts:264-272` (`PersonRestriction`)
- Modify: `app/utils/solverConfigWriteRequest.ts:56-57` (constants), `:153-228` (parser's restriction builder), `:271-318` (`solverConfigFields`), `:351-399` (`solverConfigFromDocument`)
- Modify: `sanity/schemas/solverConfig.ts:85-136` (`solverRestriction` fields)
- Test: `app/utils/__tests__/solverConfigWriteRequest.test.ts` (append)
- Test: `app/utils/__tests__/solverConfigSchema.test.ts` (create)

**Interfaces:**
- Consumes: `FROZEN_CONFIG` (Task 1).
- Produces: `PersonRestriction.sundayCadence?: "alternate"` (spec §7 item 2); `export const FAIRNESS_VALUES`, `export const CAP_OPS`, `export const SUNDAY_CADENCE_VALUES = ["alternate"] as const` from `app/utils/solverConfigWriteRequest.ts` (Task 4's tripwire pins them). The stored field `solverConfig.restrictions[].sundayCadence?: "alternate"` (spec §7 item 1).

- [ ] **Step 1: Write the failing tests**

**Append** to `app/utils/__tests__/solverConfigWriteRequest.test.ts`:

```ts
// ─── Solver v3 C3 · «Mes por medio» (`sundayCadence`) — T1, T2, T3 ───────────
//
// Absent = «Normal», `"alternate"` = «Mes por medio», and nothing else is ever
// stored (C3 §6.1–§6.3). «Normal» is never a key: a document without the
// cadence stays byte-identical to what pre-C3 code writes (step zero above).
function cadenceBody(sundayCadence: unknown, withKey = true) {
  const restriction: Record<string, unknown> = {
    id: "r-ana", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1,
    weekExclusions: [], caps: [],
  };
  if (withKey) restriction.sundayCadence = sundayCadence;
  return { sundayLeads: [], saturdayLeads: [], support: [], restrictions: [restriction], conflicts: [], presence: [] };
}

describe("parseSolverConfigWrite — `sundayCadence` (C3 T1)", () => {
  it("absent ⇒ «Normal»: no key in the canonical config and none in the stored fields", () => {
    const parsed = parseSolverConfigWrite(cadenceBody(undefined, false));
    if (!parsed.ok) throw new Error(parsed.issues.join(", "));
    expect(parsed.value.config.restrictions[0]).not.toHaveProperty("sundayCadence");
    const stored = (parsed.value.fields.restrictions as Record<string, unknown>[])[0];
    expect(stored).not.toHaveProperty("sundayCadence");
  });

  it('`"alternate"` is kept in the config and stored', () => {
    const parsed = parseSolverConfigWrite(cadenceBody("alternate"));
    if (!parsed.ok) throw new Error(parsed.issues.join(", "));
    expect(parsed.value.config.restrictions[0].sundayCadence).toBe("alternate");
    const stored = (parsed.value.fields.restrictions as Record<string, unknown>[])[0];
    expect(stored.sundayCadence).toBe("alternate");
  });

  it("a restriction carrying ONLY the cadence is a valid rule (no clause needed)", () => {
    const parsed = parseSolverConfigWrite(cadenceBody("alternate"));
    expect(parsed.ok).toBe(true);
  });

  for (const bad of ["normal", "Alternate", true, null, 1, "", "alternate "]) {
    it(`refuses ${JSON.stringify(bad)} at restrictions[0].sundayCadence, writing nothing`, () => {
      const parsed = parseSolverConfigWrite(cadenceBody(bad));
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.issues).toEqual(["restrictions[0].sundayCadence"]);
    });
  }
});

describe("solverConfigFields — `sundayCadence` (C3 T2)", () => {
  it("emits no `sundayCadence` key for a «Normal» restriction", () => {
    const fields = solverConfigFields(FROZEN_CONFIG);
    for (const r of fields.restrictions as Record<string, unknown>[]) {
      expect(r).not.toHaveProperty("sundayCadence");
    }
  });

  it('emits `sundayCadence: "alternate"` after `caps`, and only on the restriction that carries it', () => {
    const config: SolverConfig = {
      ...FROZEN_CONFIG,
      restrictions: [{ ...FROZEN_CONFIG.restrictions[0], sundayCadence: "alternate" }, FROZEN_CONFIG.restrictions[1]],
    };
    const [ana, bruno] = solverConfigFields(config).restrictions as Record<string, unknown>[];
    expect(Object.keys(ana).slice(-2)).toEqual(["caps", "sundayCadence"]);
    expect(ana.sundayCadence).toBe("alternate");
    expect(bruno).not.toHaveProperty("sundayCadence");
  });
});

describe("solverConfigFromDocument — `sundayCadence` (C3 T3)", () => {
  const stored = (sundayCadence: unknown) => ({
    restrictions: [{ _key: "r-ana", id: "r-ana", person: "Ana", fairness: "none", sundayCadence }],
  });

  it('reads `"alternate"` back as «Mes por medio»', () => {
    expect(solverConfigFromDocument(stored("alternate")).restrictions[0].sundayCadence).toBe("alternate");
  });

  it("reads any other stored value as «Normal» — total and defensive, like `fairness`", () => {
    for (const v of ["normal", "biweekly", null, true, 1, undefined]) {
      expect(solverConfigFromDocument(stored(v)).restrictions[0], JSON.stringify(v)).not.toHaveProperty("sundayCadence");
    }
  });

  it("write → read keeps the field and every id", () => {
    const config: SolverConfig = {
      ...FROZEN_CONFIG,
      restrictions: [{ ...FROZEN_CONFIG.restrictions[0], sundayCadence: "alternate" }, FROZEN_CONFIG.restrictions[1]],
    };
    const parsed = parseSolverConfigWrite(config);
    if (!parsed.ok) throw new Error(parsed.issues.join(", "));
    const back = solverConfigFromDocument({ _id: SOLVER_CONFIG_DOC_ID, ...parsed.value.fields });
    expect(back).toEqual(config);
    expect(back.restrictions[0].sundayCadence).toBe("alternate");
    expect(back.restrictions[1]).not.toHaveProperty("sundayCadence");
  });
});
```

**Create** `app/utils/__tests__/solverConfigSchema.test.ts`:

```ts
// Solver v3 C3 §6.10 — the Studio declares `sundayCadence` on `solverRestriction`
// for inspection only: a string titled «Domingo», one listed value «Mes por medio»
// = `alternate`, described «Interno: vacío = Normal». The type stays hidden and
// read-only; the Content Lake is schemaless, so nothing at runtime depends on it.
import { describe, expect, it } from "vitest";

import { solverConfig } from "@/sanity/schemas/solverConfig";

interface Field {
  name: string;
  title?: string;
  type: string;
  description?: string;
  options?: { list?: Array<{ title: string; value: string }> };
  of?: Array<{ name?: string; fields?: Field[] }>;
}

describe("solverConfig schema — «Mes por medio» (C3 §6.10)", () => {
  it("declares `sundayCadence` on `solverRestriction` with its one listed value", () => {
    expect(solverConfig.hidden).toBe(true);
    expect(solverConfig.readOnly).toBe(true);
    const restrictions = (solverConfig.fields as unknown as Field[]).find((f) => f.name === "restrictions");
    const restriction = restrictions?.of?.find((o) => o.name === "solverRestriction");
    const field = restriction?.fields?.find((f) => f.name === "sundayCadence");
    expect(field).toEqual({
      name: "sundayCadence",
      title: "Domingo",
      type: "string",
      description: "Interno: vacío = Normal",
      options: { list: [{ title: "Mes por medio", value: "alternate" }] },
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/utils/__tests__/solverConfigWriteRequest.test.ts app/utils/__tests__/solverConfigSchema.test.ts`
Expected: FAIL — 12 tests: «`"alternate"` is kept…» (`expected undefined to be 'alternate'`), the seven «refuses …» cases (`expected true to be false`), «emits `sundayCadence: "alternate"` after `caps`…», «reads `"alternate"` back…», «write → read keeps the field…» and the schema test (`expected undefined to deeply equal { name: 'sundayCadence', … }`). The «absent ⇒ Normal», «no key for Normal» and «any other stored value reads as Normal» tests already pass.

- [ ] **Step 3: The type**

**Find** in `app/components/admin/plannerModel.ts`:

```ts
  weekExclusions: WeekExclusion[];
  caps: RestrictionCap[];
}

export interface ConflictRule {
```

**Replace with:**

```ts
  weekExclusions: WeekExclusion[];
  caps: RestrictionCap[];
  /**
   * «Domingo: Mes por medio» (solver v3 C3). Present ONLY for «Mes por medio»;
   * absent means «Normal», and «Normal» is never stored. Inert under v2: see
   * `v2View`. The setting only — the cadence STATE is never stored (C2).
   */
  sundayCadence?: "alternate";
}

export interface ConflictRule {
```

- [ ] **Step 4: The accepted values, exported**

**Find** in `app/utils/solverConfigWriteRequest.ts`:

```ts
const FAIRNESS_VALUES = ["none", "exempt", "slack"] as const;
const CAP_OPS = ["<=", ">=", "=="] as const;
```

**Replace with:**

```ts
/**
 * The accepted values of the three enumerated fields. Exported for the version
 * tripwire (`solverConfigVersion.test.ts`), which pins them: a value an older
 * client would read as something else is a document-shape change and bumps
 * `SOLVER_CONFIG_VERSION` in the same change (C3 §6.2).
 */
export const FAIRNESS_VALUES = ["none", "exempt", "slack"] as const;
export const CAP_OPS = ["<=", ">=", "=="] as const;
/** «Mes por medio». Absence is «Normal»; «Normal» is never a stored value (C3 §6.1). */
export const SUNDAY_CADENCE_VALUES = ["alternate"] as const;
```

- [ ] **Step 5: The parser validates and keeps it**

**Find** in `app/utils/solverConfigWriteRequest.ts`:

```ts
      const slack = finiteNumber(item.fairnessSlack) ?? 1;
```

**Replace with:**

```ts
      // C3 §6.2: absent ⇒ «Normal» (no key anywhere); `"alternate"` ⇒ kept;
      // anything else — `null`, `"normal"`, a different case — is refused, like
      // every value the UI cannot produce.
      const cadence = item.sundayCadence;
      if (cadence !== undefined && !(SUNDAY_CADENCE_VALUES as readonly unknown[]).includes(cadence)) {
        issues.push(`${itemPath}.sundayCadence`);
        return null;
      }
      const slack = finiteNumber(item.fairnessSlack) ?? 1;
```

**Find** in `app/utils/solverConfigWriteRequest.ts`:

```ts
        weekExclusions,
        caps,
      };
    },
  );

  const conflicts = mapItems<ConflictRule>
```

**Replace with:**

```ts
        weekExclusions,
        caps,
        ...(cadence === "alternate" ? { sundayCadence: "alternate" as const } : {}),
      };
    },
  );

  const conflicts = mapItems<ConflictRule>
```

- [ ] **Step 6: The serializer writes it only for «Mes por medio»**

**Find** in `app/utils/solverConfigWriteRequest.ts`:

```ts
        relOffset: c.relOffset,
      })),
    })),
    conflicts: config.conflicts.map((c) => ({
```

**Replace with:**

```ts
        relOffset: c.relOffset,
      })),
      // «Normal» writes NO key, so a cadence-free document stays byte-identical
      // to what pre-C3 code writes (C3 §6.1; pinned by the step-zero literal).
      ...(r.sundayCadence === "alternate" ? { sundayCadence: "alternate" } : {}),
    })),
    conflicts: config.conflicts.map((c) => ({
```

- [ ] **Step 7: The reader**

**Find** in `app/utils/solverConfigWriteRequest.ts`:

```ts
          : [];
      }),
    });
  }

  const conflicts: ConflictRule[] = [];
```

**Replace with:**

```ts
          : [];
      }),
      // Total and defensive, like `fairness`: only `"alternate"` reads as «Mes
      // por medio»; a value a FUTURE version writes reads as «Normal» here — and
      // that version's bump refuses this one's saves, so it is never erased.
      ...(item.sundayCadence === "alternate" ? { sundayCadence: "alternate" as const } : {}),
    });
  }

  const conflicts: ConflictRule[] = [];
```

- [ ] **Step 8: The Studio field (inspection only)**

**Find** in `sanity/schemas/solverConfig.ts`:

```ts
                    { name: "relOffset", title: "Desplazamiento relativo", type: "number" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
```

**Replace with:**

```ts
                    { name: "relOffset", title: "Desplazamiento relativo", type: "number" },
                  ],
                },
              ],
            },
            {
              // Solver v3 C3 §6.10: «Mes por medio». Inspection only — absent
              // means «Normal» and is never stored as a value.
              name: "sundayCadence",
              title: "Domingo",
              type: "string",
              description: "Interno: vacío = Normal",
              options: { list: [{ title: "Mes por medio", value: "alternate" }] },
            },
          ],
        },
      ],
    },
```

The type stays `hidden: true`, `readOnly: true` and in both protection lists; `studioProtection.ts` is not edited (its `solverConfig` field list is top-level and unchanged).

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run app/utils/__tests__/solverConfigWriteRequest.test.ts app/utils/__tests__/solverConfigSchema.test.ts app/utils/__tests__/studioProtection.test.ts`
Expected: PASS (77 tests), the step-zero literal included.

- [ ] **Step 10: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add app/components/admin/plannerModel.ts app/utils/solverConfigWriteRequest.ts sanity/schemas/solverConfig.ts app/utils/__tests__/solverConfigWriteRequest.test.ts app/utils/__tests__/solverConfigSchema.test.ts
git commit -m "feat(solver-config): store «Mes por medio» as an optional sundayCadence" -m "Solver v3 C3 §6.1–§6.3: absent means «Normal» and is never written, so every existing document stays byte-identical and no migration exists; \"alternate\" is kept; anything else is refused at its issue path, like every value the UI cannot produce. The reader is total: an unknown value reads as «Normal». The Studio declares the field for inspection only."
```

---

## Task 3: One exact count per person per role — `exactCapOverlaps` and the parser's refusal

Parent A38; spec R10, §6.2 «One exact count per person per role», §7 item 3; T14 (parser part). Review-log items 13 and 17.

**Files:**
- Modify: `app/utils/solverConfigWriteRequest.ts:37-45` (imports), `:250` (after the parser's early return), before `solverConfigFields` (`:271`)
- Test: `app/utils/__tests__/solverConfigWriteRequest.test.ts` (imports + append)

**Interfaces:**
- Consumes: `rolesOfPattern(pattern: string): SolverRole[]` (`app/components/admin/plannerModel.ts:637`, the five v2 keys in `ROLE_ORDER`); `normalizeLabel` (`app/utils/normalizeLabel.ts:31`).
- Produces (spec §7 item 3, exact):
  - `export type CapRef = { restriction: number; cap: number }`
  - `export interface ExactCapOverlap { first: CapRef; later: CapRef; person: string; roles: string[] }`
  - `export function exactCapOverlaps(config: Pick<SolverConfig, "restrictions">): ExactCapOverlap[]` — pairs ordered by `later`, then `first`; `person` = the earlier restriction's text as written; `roles` = the intersection in `rolesOfPattern`'s order. Person and pattern are normalised with `normalizeLabel` (then the person lower-cased) before comparing, so a raw on-screen config and the parsed body give the same pairs.
  - The parser refuses each distinct `later` once with `restrictions[i].caps[j]:exact_overlap` (HTTP 400 `invalid_request` at the route, like every parser issue). Tasks 5, 11 and the seed (Task 12) rely on this exact suffix.

- [ ] **Step 1: Write the failing tests**

**Find** in `app/utils/__tests__/solverConfigWriteRequest.test.ts`:

```ts
import {
  SOLVER_CONFIG_DOC_ID,
  buildSolverConfigDocument,
  parseSolverConfigWrite,
  solverConfigFields,
  solverConfigFromDocument,
} from "../solverConfigWriteRequest";
import type { SolverConfig } from "@/app/components/admin/plannerModel";
```

**Replace with:**

```ts
import {
  SOLVER_CONFIG_DOC_ID,
  buildSolverConfigDocument,
  exactCapOverlaps,
  parseSolverConfigWrite,
  solverConfigFields,
  solverConfigFromDocument,
} from "../solverConfigWriteRequest";
import { DEFAULT_SOLVER_CONFIG } from "@/app/components/admin/solverConfigDefaults";
import type { PersonRestriction, RestrictionCap, SolverConfig } from "@/app/components/admin/plannerModel";
```

**Append** to `app/utils/__tests__/solverConfigWriteRequest.test.ts`:

```ts
// ─── Solver v3 C3 · one exact count per person per role (parent A38) — T14 ────
//
// Two `==` caps that cover a common role (`rolesOfPattern`, the five v2 keys) for
// one `person` text are refused at save — within one restriction and across
// restrictions whose `person` is equal case-insensitively after trimming. The
// issue names the LATER cap of each pair, once, with the `:exact_overlap` suffix.
let capSeq = 0;
const cap = (pattern: string, op: RestrictionCap["op"], value = 1, extra: Partial<RestrictionCap> = {}): RestrictionCap => ({
  id: `c-${++capSeq}`, pattern, op, value, relative: false, relOffset: 0, ...extra,
});
const rule = (id: string, person: string, caps: RestrictionCap[]): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps,
});
const withRules = (...restrictions: PersonRestriction[]): SolverConfig => ({
  sundayLeads: [], saturdayLeads: [], support: [], restrictions, conflicts: [], presence: [],
});
const refusedAt = (config: SolverConfig): string[] => {
  const parsed = parseSolverConfigWrite(config);
  return parsed.ok ? [] : parsed.issues;
};

describe("exactCapOverlaps + the parser — one exact count per role (C3 T14)", () => {
  it("refuses two `==` caps on one restriction covering Sun.Lead, at the later cap", () => {
    const config = withRules(rule("r-ana", "Ana", [cap("Sun.Lead", "==", 2), cap("Sun.*", "==", 3)]));
    expect(exactCapOverlaps(config)).toEqual([
      { first: { restriction: 0, cap: 0 }, later: { restriction: 0, cap: 1 }, person: "Ana", roles: ["Sun.Lead"] },
    ]);
    expect(refusedAt(config)).toEqual(["restrictions[0].caps[1]:exact_overlap"]);
  });

  it("three mutually overlapping caps report each later cap once", () => {
    const config = withRules(rule("r-ana", "Ana", [cap("Sun.Lead", "=="), cap("*.Lead", "=="), cap("*.*", "==")]));
    expect(exactCapOverlaps(config).map((o) => [o.first.cap, o.later.cap])).toEqual([[0, 1], [0, 2], [1, 2]]);
    expect(refusedAt(config)).toEqual([
      "restrictions[0].caps[1]:exact_overlap",
      "restrictions[0].caps[2]:exact_overlap",
    ]);
  });

  it("looks ACROSS restrictions whose person differs only in case and surrounding spaces", () => {
    const config = withRules(
      rule("r-1", "Ana", [cap("Sun.Lead", "==", 2)]),
      rule("r-2", "Bruno", [cap("Sun.Lead", "==", 1)]),
      rule("r-3", "  aNA ", [cap("*.Lead", "==", 1)]),
    );
    expect(exactCapOverlaps(config)).toEqual([
      { first: { restriction: 0, cap: 0 }, later: { restriction: 2, cap: 0 }, person: "Ana", roles: ["Sun.Lead"] },
    ]);
    expect(refusedAt(config)).toEqual(["restrictions[2].caps[0]:exact_overlap"]);
  });

  it("`Sat.* == 1` with `*.Lead == 1` is refused on Sat.Lead", () => {
    const config = withRules(rule("r-ana", "Ana", [cap("Sat.*", "=="), cap("*.Lead", "==")]));
    expect(exactCapOverlaps(config)[0].roles).toEqual(["Sat.Lead"]);
    expect(refusedAt(config)).toEqual(["restrictions[0].caps[1]:exact_overlap"]);
  });

  it("the value plays no part: equal values, and relative values, are still refused", () => {
    expect(refusedAt(withRules(rule("r", "Ana", [cap("Sun.BGV", "==", 2), cap("Sun.BGV", "==", 2)])))).toEqual([
      "restrictions[0].caps[1]:exact_overlap",
    ]);
    expect(refusedAt(withRules(rule("r", "Ana", [
      cap("Sat.BGV", "==", 0, { relative: true, relOffset: 2 }),
      cap("Sat.*", "==", 0, { relative: true, relOffset: 9 }),
    ])))).toEqual(["restrictions[0].caps[1]:exact_overlap"]);
  });

  it("`==` beside `>=` or `<=` on the same role is accepted, as today", () => {
    const config = withRules(rule("r", "Ana", [cap("Sun.Lead", "==", 2), cap("Sun.Lead", ">=", 1), cap("Sun.*", "<=", 3)]));
    expect(exactCapOverlaps(config)).toEqual([]);
    expect(parseSolverConfigWrite(config).ok).toBe(true);
  });

  it("two DIFFERENT person texts (a name and an alias of one member) pass the save — C2 judges by id", () => {
    const config = withRules(
      rule("r-1", "Ana", [cap("Sun.Lead", "==", 2)]),
      rule("r-2", "Ana Karen Villalobos", [cap("Sun.Lead", "==", 1)]),
    );
    expect(exactCapOverlaps(config)).toEqual([]);
    expect(parseSolverConfigWrite(config).ok).toBe(true);
  });

  it("`Sat.* ==` with `*.Choir ==` passes: the five-key map has no Sat.Choir (the documented gap)", () => {
    const config = withRules(rule("r", "Ana", [cap("Sat.*", "=="), cap("*.Choir", "==")]));
    expect(exactCapOverlaps(config)).toEqual([]);
    expect(parseSolverConfigWrite(config).ok).toBe(true);
  });

  it("only runs once every item parsed, so its indices are the body's own", () => {
    // A bad cap on restriction 0 is refused by itself; the overlap on
    // restriction 1 is not reported in the same answer (review item 17).
    const config = withRules(
      rule("r-1", "Bruno", [{ ...cap("Sun.BGV", "<="), op: "!=" as RestrictionCap["op"] }]),
      rule("r-2", "Ana", [cap("Sun.Lead", "=="), cap("Sun.Lead", "==")]),
    );
    expect(refusedAt(config)).toEqual(["restrictions[0].caps[0].op"]);
  });

  it("normalises the way the parser does, so client and route agree on a raw body", () => {
    // Inner whitespace and NFC are `normalizeLabel`'s; case and trim are the
    // rule-name criterion's (`rulePersonNamesMember`).
    const config = withRules(
      rule("r-1", "Ana  Karen", [cap(" Sun.Lead ", "==")]),
      rule("r-2", "ana karen", [cap("Sun.Lead", "==")]),
    );
    expect(exactCapOverlaps(config)).toHaveLength(1);
    expect(refusedAt(config)).toEqual(["restrictions[1].caps[0]:exact_overlap"]);
  });

  it("no existing fixture of this file and not DEFAULT_SOLVER_CONFIG overlaps", () => {
    for (const c of [fullConfig(), FROZEN_CONFIG, DEFAULT_SOLVER_CONFIG]) {
      expect(exactCapOverlaps(c)).toEqual([]);
      expect(parseSolverConfigWrite(c).ok).toBe(true);
    }
  });

  it("DEFAULT_SOLVER_CONFIG is unchanged by C3: no restriction carries the cadence (§6.9)", () => {
    expect(DEFAULT_SOLVER_CONFIG.restrictions.filter((r) => r.sundayCadence !== undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/utils/__tests__/solverConfigWriteRequest.test.ts`
Expected: FAIL — 10 tests: every test that calls `exactCapOverlaps` throws `TypeError: … exactCapOverlaps is not a function` («`==` beside `>=` or `<=`…», «two DIFFERENT person texts…» and «`Sat.* ==` with `*.Choir ==`…» fail only on that), and «the value plays no part…» fails on `expected [] to deeply equal [ 'restrictions[0].caps[1]:exact_overlap' ]`. Two pass already: «only runs once every item parsed…» (a bad `op` is refused today) and «DEFAULT_SOLVER_CONFIG is unchanged by C3…» (spec §6.9: the defaults do not change).

- [ ] **Step 3: Import `rolesOfPattern` at runtime**

**Find** in `app/utils/solverConfigWriteRequest.ts`:

```ts
import { normalizeLabel } from "./normalizeLabel";
import type {
  ConflictRule,
  PersonRestriction,
  PresenceRule,
  RestrictionCap,
  SolverConfig,
  WeekExclusion,
} from "@/app/components/admin/plannerModel";
```

**Replace with:**

```ts
import { normalizeLabel } from "./normalizeLabel";
// A RUNTIME import since C3: `rolesOfPattern` is the ONE solver-synced pattern →
// role map (`patternRolesSync.test.ts`). `plannerModel` is neutral — no
// "use client", no `server-only` — and does not import this module, so the
// route, the seed script (`npx tsx`) and the client all load it.
import {
  rolesOfPattern,
  type ConflictRule,
  type PersonRestriction,
  type PresenceRule,
  type RestrictionCap,
  type SolverConfig,
  type WeekExclusion,
} from "@/app/components/admin/plannerModel";
```

- [ ] **Step 4: The parser refuses an overlap — only after every item parsed**

**Find** in `app/utils/solverConfigWriteRequest.ts`:

```ts
  if (issues.length) return { ok: false, issues };

  const config: SolverConfig = {
```

**Replace with:**

```ts
  if (issues.length) return { ok: false, issues };

  // Parent A38: one exact count per person per role. Run ONLY after the early
  // return above: every refused item pushes an issue there, so past this line no
  // item was dropped and `restrictions[i].caps[j]` are the BODY's own indices —
  // the ones the client maps the refusal back through.
  const overlapIssues: string[] = [];
  for (const o of exactCapOverlaps({ restrictions })) {
    const path = `restrictions[${o.later.restriction}].caps[${o.later.cap}]:exact_overlap`;
    if (!overlapIssues.includes(path)) overlapIssues.push(path);
  }
  if (overlapIssues.length) return { ok: false, issues: overlapIssues };

  const config: SolverConfig = {
```

- [ ] **Step 5: `exactCapOverlaps`**

**Find** in `app/utils/solverConfigWriteRequest.ts`:

```ts
/**
 * The document fields for a validated config, every array-of-object item
```

**Replace with:**

```ts
/** A cap's position in a config, in document order (C3 §7 item 3). */
export type CapRef = { restriction: number; cap: number };

/** Two `==` caps that fix a common role for one person (parent A38). */
export interface ExactCapOverlap {
  /** The earlier cap of the pair, in document order. */
  first: CapRef;
  /** The later cap — the one the parser's issue names. */
  later: CapRef;
  /** The earlier restriction's `person`, as written. */
  person: string;
  /** The common role keys, in `rolesOfPattern`'s order. */
  roles: string[];
}

/**
 * Every pair of `==` caps whose `rolesOfPattern` sets intersect — on one
 * restriction, or on two whose `person` texts are equal case-insensitively after
 * trimming (the rule-name criterion, `rulePersonNamesMember`). Pairs are ordered
 * by their later cap, then their earlier one. Value, `relative` and `relOffset`
 * play no part, and `<=`/`>=` caps never pair.
 *
 * Shared by the parser (which refuses each `later` once), the rule form, the
 * panel and the client's refusal mapping, so the form's check and the route's
 * refusal cannot disagree. Person and pattern go through `normalizeLabel` first
 * — the parser stores them that way — so a raw on-screen config and the parsed
 * body give the same pairs.
 *
 * Sees `person` TEXT only: two spellings of one member, and an overlap on
 * `Sat.Choir` alone (not one of the five keys), are C2's to refuse by member id
 * at build time (C3 §6.2).
 */
export function exactCapOverlaps(config: Pick<SolverConfig, "restrictions">): ExactCapOverlap[] {
  const exact: Array<{ ref: CapRef; key: string; person: string; roles: string[] }> = [];
  (config.restrictions ?? []).forEach((r, ri) => {
    const name = normalizeLabel(r.person);
    if (name === null) return;
    (r.caps ?? []).forEach((c, ci) => {
      if (c.op !== "==") return;
      const roles: string[] = rolesOfPattern(normalizeLabel(c.pattern) ?? "");
      if (roles.length === 0) return;
      exact.push({ ref: { restriction: ri, cap: ci }, key: name.toLowerCase(), person: r.person, roles });
    });
  });
  const out: ExactCapOverlap[] = [];
  for (let j = 1; j < exact.length; j++) {
    for (let i = 0; i < j; i++) {
      if (exact[i].key !== exact[j].key) continue;
      const roles = exact[i].roles.filter((role) => exact[j].roles.includes(role));
      if (roles.length) out.push({ first: exact[i].ref, later: exact[j].ref, person: exact[i].person, roles });
    }
  }
  return out;
}

/**
 * The document fields for a validated config, every array-of-object item
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run app/utils/__tests__/solverConfigWriteRequest.test.ts app/api/__tests__/solverConfigRoute.test.ts app/components/admin/__tests__/patternRolesSync.test.ts`
Expected: PASS (the existing route tests are unaffected: none of their bodies holds two `==` caps).

- [ ] **Step 7: Prove the seed script still loads the parser under `tsx`**

The parser now imports `plannerModel` at runtime through the `@/` alias (review-log item 15). Task 12 pins this as a test; check it now by hand:

```bash
printf '%s' '{"restrictions":[{"id":"r-1","person":"Ana","caps":[{"id":"c-1","pattern":"Sun.Lead","op":"==","value":2},{"id":"c-2","pattern":"Sun.*","op":"==","value":1}]}]}' > "${TMPDIR:-/tmp}/c3-overlap.json"
SANITY_WRITE_TOKEN=dummy npx tsx scripts/seed-solver-config.ts "${TMPDIR:-/tmp}/c3-overlap.json"; echo "exit $?"
```

Expected: `The capture is not a valid rule set. Nothing was written.`, `  · restrictions[0].caps[1]:exact_overlap`, `exit 1` — and no `Target:` line (no client was built, nothing was read).

- [ ] **Step 8: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add app/utils/solverConfigWriteRequest.ts app/utils/__tests__/solverConfigWriteRequest.test.ts
git commit -m "feat(solver-config): refuse two exact counts for one role of one person" -m "Parent A38, C3 §6.2: two == caps whose rolesOfPattern roles intersect, on one restriction or on two whose person text matches case-insensitively after trimming, are refused at the later cap with :exact_overlap. The check runs only after every item parsed, so its indices are the body's own. exactCapOverlaps normalises like the parser, so the form, the panel and the client's refusal mapping see the pairs the route refuses. Two spellings of one member and an overlap on Sat.Choir alone are C2's to refuse by member id at build time."
```

---

## Task 4: `SOLVER_CONFIG_VERSION` and its shape tripwire

Spec §6.2 «The guard» and «The bump rule», §7 item 3; T7. The constant lands before anything uses it, so the client (Task 5) and the route (Task 6) share one definition.

**Files:**
- Modify: `app/utils/solverConfigWriteRequest.ts:53-54` (after `SOLVER_CONFIG_TYPE`)
- Test: `app/utils/__tests__/solverConfigVersion.test.ts` (create)

**Interfaces:**
- Consumes: `FAIRNESS_VALUES`, `CAP_OPS`, `SUNDAY_CADENCE_VALUES` (Task 2); `parseSolverConfigWrite`, `solverConfigFields`.
- Produces: `export const SOLVER_CONFIG_VERSION = 2` in `app/utils/solverConfigWriteRequest.ts` (spec §7 item 3). Tasks 5, 6 and 13 import it by this name.

- [ ] **Step 1: Write the failing tripwire**

**Create** `app/utils/__tests__/solverConfigVersion.test.ts`:

```ts
// Solver v3 C3 §6.2 — the config version tripwire (T7).
//
// `POST /api/admin/solver-config` replaces the WHOLE document, and the reader
// keeps only the fields it knows. So a tab whose bundle predates a field — or an
// allowed VALUE — reads it away and its next «Guardar reglas» erases it for
// everyone. The route refuses any body whose `configVersion` is not
// `SOLVER_CONFIG_VERSION`; this file is what makes "bump it when the shape
// changes" a red test instead of a memory.
//
// THE RULE: never edit an existing entry of `SHAPES`. A change that adds a key
// at any level, or an accepted value to an enumerated field, adds a NEW entry
// under the next number and bumps `SOLVER_CONFIG_VERSION` in the same commit.
// Free-text fields (`person`, pattern labels) are read back verbatim by every
// version and are not enumerated.
import { describe, expect, it } from "vitest";

import {
  CAP_OPS,
  FAIRNESS_VALUES,
  SOLVER_CONFIG_VERSION,
  SUNDAY_CADENCE_VALUES,
  parseSolverConfigWrite,
  solverConfigFields,
} from "../solverConfigWriteRequest";
import type { SolverConfig } from "@/app/components/admin/plannerModel";

const SHAPES: Record<number, {
  keys: Record<"document" | "restriction" | "weekExclusion" | "cap" | "conflict" | "presence", string[]>;
  values: Record<"sundayCadence" | "fairness" | "capOp", string[]>;
}> = {
  2: {
    keys: {
      document: ["conflicts", "presence", "restrictions", "saturdayLeads", "sundayLeads", "support"],
      restriction: [
        "_key", "_type", "caps", "excludedPatterns", "fairness", "fairnessSlack", "id", "person",
        "sundayCadence", "weekExclusions",
      ],
      weekExclusion: ["_key", "_type", "id", "pattern", "week"],
      cap: ["_key", "_type", "id", "op", "pattern", "relOffset", "relative", "value"],
      conflict: ["_key", "_type", "id", "pattern", "personA", "personB"],
      presence: ["_key", "_type", "id", "pattern", "persons"],
    },
    values: {
      sundayCadence: ["alternate"],
      fairness: ["exempt", "none", "slack"],
      capOp: ["<=", "==", ">="],
    },
  },
};

/** A config carrying every optional field the type has, so every key is emitted. */
const EVERYTHING: SolverConfig = {
  sundayLeads: ["m-ana"],
  saturdayLeads: ["m-bruno"],
  support: ["m-carla"],
  restrictions: [{
    id: "r-1", person: "Ana", excludedPatterns: ["Sat.*"], fairness: "slack", fairnessSlack: 2,
    weekExclusions: [{ id: "w-1", week: 1, pattern: "*.*" }],
    caps: [{ id: "c-1", pattern: "Sun.BGV", op: "<=", value: 1, relative: true, relOffset: 2 }],
    sundayCadence: "alternate",
  }],
  conflicts: [{ id: "x-1", personA: "Ana", personB: "Bruno", pattern: "*.Lead" }],
  presence: [{ id: "p-1", persons: ["Bruno", "Carla"], pattern: "Sun.BGV" }],
};

const sortedKeys = (o: unknown) => Object.keys(o as Record<string, unknown>).sort();

function liveKeys() {
  const f = solverConfigFields(EVERYTHING);
  const r = (f.restrictions as Record<string, unknown>[])[0];
  return {
    document: sortedKeys(f),
    restriction: sortedKeys(r),
    weekExclusion: sortedKeys((r.weekExclusions as unknown[])[0]),
    cap: sortedKeys((r.caps as unknown[])[0]),
    conflict: sortedKeys((f.conflicts as unknown[])[0]),
    presence: sortedKeys((f.presence as unknown[])[0]),
  };
}

/** What the PARSER accepts, probed — not read off the constants it might bypass. */
function accepted(universe: unknown[], body: (v: unknown) => unknown): string[] {
  return universe.filter((v) => parseSolverConfigWrite(body(v)).ok).map(String).sort();
}
const withRestriction = (patch: Record<string, unknown>) => ({
  restrictions: [{ id: "r-1", person: "Ana", ...patch }],
});

describe("SOLVER_CONFIG_VERSION tripwire (C3 §6.2, T7)", () => {
  it("is the newest pinned shape", () => {
    expect(Math.max(...Object.keys(SHAPES).map(Number))).toBe(SOLVER_CONFIG_VERSION);
    expect(SOLVER_CONFIG_VERSION).toBe(2);
  });

  it("pins the exact key set `solverConfigFields` emits at every level", () => {
    expect(liveKeys()).toEqual(SHAPES[SOLVER_CONFIG_VERSION].keys);
  });

  it("pins the accepted values of every enumerated field — the constants AND the parser", () => {
    const pinned = SHAPES[SOLVER_CONFIG_VERSION].values;
    expect([...SUNDAY_CADENCE_VALUES].sort()).toEqual(pinned.sundayCadence);
    expect([...FAIRNESS_VALUES].sort()).toEqual(pinned.fairness);
    expect([...CAP_OPS].sort()).toEqual(pinned.capOp);

    expect(accepted(
      ["alternate", "normal", "Alternate", "none", "monthly", "every_other", "", null, true, 1],
      (v) => withRestriction({ sundayCadence: v }),
    )).toEqual(pinned.sundayCadence);
    expect(accepted(
      ["none", "exempt", "slack", "Exempt", "always", "median", ""],
      (v) => withRestriction({ fairness: v }),
    )).toEqual(pinned.fairness);
    expect(accepted(
      ["<=", ">=", "==", "!=", "<", ">", "=", "==="],
      (v) => withRestriction({ caps: [{ id: "c-1", pattern: "Sun.BGV", op: v, value: 1 }] }),
    )).toEqual(pinned.capOp);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/utils/__tests__/solverConfigVersion.test.ts`
Expected: FAIL — `expected 2 to be undefined` (the newest pinned shape against a missing constant) and `TypeError: Cannot read properties of undefined (reading 'keys')` / `(reading 'values')`.

- [ ] **Step 3: The constant**

**Find** in `app/utils/solverConfigWriteRequest.ts`:

```ts
/** The stored `_type`. Same string as the id; they are independent choices. */
export const SOLVER_CONFIG_TYPE = "solverConfig";
```

**Replace with:**

```ts
/** The stored `_type`. Same string as the id; they are independent choices. */
export const SOLVER_CONFIG_TYPE = "solverConfig";

/**
 * The document shape this bundle understands (solver v3 C3 §6.2). Every body a
 * pre-C3 client sends is version 1 (it carries none). The rules POST refuses any
 * other value BEFORE it reads or writes anything, because the leniency below
 * ("unknown extra fields are dropped") is exactly how an OLDER tab erases a
 * field it cannot see: its reader drops it, and its whole-document save writes
 * the result.
 *
 * **The bump rule.** A change that adds a field, OR an allowed value, that an
 * older client would drop or rewrite bumps this in the same change.
 * `solverConfigVersion.test.ts` pins the key set at every level and the accepted
 * values of `sundayCadence`, `fairness` and cap `op` for each version.
 */
export const SOLVER_CONFIG_VERSION = 2;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run app/utils/__tests__/solverConfigVersion.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add app/utils/solverConfigWriteRequest.ts app/utils/__tests__/solverConfigVersion.test.ts
git commit -m "feat(solver-config): SOLVER_CONFIG_VERSION and its shape tripwire" -m "C3 §6.2: the rules POST replaces the whole document and the reader keeps only the fields it knows, so a client that predates a field or an allowed value erases it on its next save. Version 2 names the shape with sundayCadence. The tripwire pins, per version, the key set solverConfigFields emits at every level and the values the parser accepts for sundayCadence, fairness and cap op, so a shape change without a bump fails the suite."
```

---

## Task 5: The client sends the version, reads the echo, and names both refusals

Spec §6.2 («The current client …», «A stored overlap is not a dead end» — the refusal mapping), §6.3; T6. Landed **before** the route's guard (Task 6), so no commit in between has a client that the route would refuse: the pre-C3 route ignores the extra `configVersion` key.

**Files:**
- Modify: `app/components/admin/solverConfigSource.ts:33-43` (imports, `SolverConfigSource`), `:72-73` (copy), `:88-98` (`sourceFromGet`), `:104-111` (`saveFailure`)
- Modify: `app/components/admin/useSolverConfig.ts:38`, `:85-88`
- Modify: `app/components/admin/MonthGenerator.tsx:64-69` (import), `:1322-1406` (`SolverConfigSaveBar`)
- Modify: `app/components/admin/__tests__/rulesHarness.ts:13-30` (`readyRules`)
- Test: `app/components/admin/__tests__/solverConfigSource.test.ts` (imports + append)
- Test: `app/components/admin/__tests__/useSolverConfig.test.tsx` (imports, one expectation, append)
- Test: `app/components/admin/__tests__/MonthGenerator.configVersion.test.tsx` (create)

**Interfaces:**
- Consumes: `SOLVER_CONFIG_VERSION` (Task 4); `exactCapOverlaps` (Task 3); `capLabel(cap: RestrictionCap): string` (`plannerModel.ts:661`).
- Produces (all in `app/components/admin/solverConfigSource.ts`):
  - `SolverConfigSource`'s `ready` variant becomes `{ status: "ready"; rev: string; config: SolverConfig; configVersion: number }` — the version the server echoed; an echo without a numeric one reads as `1`.
  - `export function isOutdatedSource(source: SolverConfigSource): boolean` — `ready` and `configVersion !== SOLVER_CONFIG_VERSION`.
  - `export function saveFailure(status: number, body: unknown, sent?: SolverConfig): { message: string; stale: boolean }` — `invalid_request` with `details.issues` containing `"configVersion"` ⇒ `SAVE_OUTDATED_TAB_MESSAGE`; containing a `restrictions[i].caps[j]:exact_overlap` path ⇒ `exactOverlapRefusalMessage(...)` naming the pair from `exactCapOverlaps(sent)`; both `stale: false`.
  - Copy: `SAVE_OUTDATED_TAB_MESSAGE`, `PLANNER_UPDATED_MESSAGE`, `EXACT_ROLE_LABEL: Readonly<Record<string, string>>`, `exactOverlapFormMessage({ role, person, rule }): string`, `exactOverlapCardMessage(role: string): string`, `exactOverlapRefusalMessage({ role, person, rule }): string`. Task 11 renders the form and card messages.
  - `readyRules(config?, { rev?, save?, configVersion? })` in `rulesHarness.ts` — `configVersion` defaults to `SOLVER_CONFIG_VERSION`, so the ~65 existing renders keep a tab that may save.
- The save bar disables «Guardar reglas» (title and visible notice `PLANNER_UPDATED_MESSAGE`) while `isOutdatedSource(rules.source)`.

- [ ] **Step 1: Point the harness at the version**

**Find** in `app/components/admin/__tests__/rulesHarness.ts`:

```ts
import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { READ_FAILED_MESSAGE, type SolverConfigController } from "../solverConfigSource";
import type { SolverConfig } from "../plannerModel";
```

**Replace with:**

```ts
import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { READ_FAILED_MESSAGE, type SolverConfigController } from "../solverConfigSource";
import type { SolverConfig } from "../plannerModel";
import { SOLVER_CONFIG_VERSION } from "@/app/utils/solverConfigWriteRequest";
```

**Find** in `app/components/admin/__tests__/rulesHarness.ts`:

```ts
/** The document exists — the production state. */
export function readyRules(
  config: SolverConfig = DEFAULT_SOLVER_CONFIG,
  opts: { rev?: string; save?: SolverConfigController["save"] } = {},
): RulesHarness {
  const save = vi.fn(opts.save ?? (async () => ({ ok: true as const })));
  return {
    source: { status: "ready", rev: opts.rev ?? "rev-1", config },
```

**Replace with:**

```ts
/**
 * The document exists — the production state. `configVersion` is the version the
 * server echoed (C3 §6.2); it defaults to this bundle's, i.e. a tab that may save.
 */
export function readyRules(
  config: SolverConfig = DEFAULT_SOLVER_CONFIG,
  opts: { rev?: string; save?: SolverConfigController["save"]; configVersion?: number } = {},
): RulesHarness {
  const save = vi.fn(opts.save ?? (async () => ({ ok: true as const })));
  return {
    source: {
      status: "ready",
      rev: opts.rev ?? "rev-1",
      config,
      configVersion: opts.configVersion ?? SOLVER_CONFIG_VERSION,
    },
```

- [ ] **Step 2: Write the failing source tests**

**Find** in `app/components/admin/__tests__/solverConfigSource.test.ts`:

```ts
import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { SOLVER_HISTORY_SOURCE } from "../solverHistorySource";
import {
  READ_FAILED_MESSAGE,
  SAVE_ABSENT_MESSAGE,
  SAVE_FORBIDDEN_MESSAGE,
  SAVE_REJECTED_MESSAGE,
  SAVE_STALE_MESSAGE,
  editableConfig,
  sameSolverConfig,
  saveFailure,
  sourceFromGet,
  type SolverConfigSource,
} from "../solverConfigSource";
import type { SolverConfig } from "../plannerModel";
```

**Replace with:**

```ts
import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { SOLVER_HISTORY_SOURCE } from "../solverHistorySource";
import {
  EXACT_ROLE_LABEL,
  PLANNER_UPDATED_MESSAGE,
  READ_FAILED_MESSAGE,
  SAVE_ABSENT_MESSAGE,
  SAVE_FORBIDDEN_MESSAGE,
  SAVE_OUTDATED_TAB_MESSAGE,
  SAVE_REJECTED_MESSAGE,
  SAVE_STALE_MESSAGE,
  editableConfig,
  exactOverlapCardMessage,
  exactOverlapFormMessage,
  isOutdatedSource,
  sameSolverConfig,
  saveFailure,
  sourceFromGet,
  type SolverConfigSource,
} from "../solverConfigSource";
import type { PersonRestriction, SolverConfig } from "../plannerModel";
import { SOLVER_CONFIG_VERSION } from "@/app/utils/solverConfigWriteRequest";
```

**Append** to `app/components/admin/__tests__/solverConfigSource.test.ts`:

```ts
// ─── Solver v3 C3 · the config version and the A38 refusal, client side (T6) ──
describe("sourceFromGet — the server's config version (C3 §6.2)", () => {
  it("a `ready` source carries the version the server echoed", () => {
    const source = sourceFromGet(true, { ...STORED, configVersion: SOLVER_CONFIG_VERSION });
    expect(source).toMatchObject({ status: "ready", configVersion: SOLVER_CONFIG_VERSION });
    expect(isOutdatedSource(source)).toBe(false);
  });

  it("an echo with another version — or none, which reads as 1 — is outdated", () => {
    for (const configVersion of [undefined, 1, 3, "2", null]) {
      const source = sourceFromGet(true, { ...STORED, configVersion });
      expect(source.status).toBe("ready");
      expect(isOutdatedSource(source), JSON.stringify(configVersion)).toBe(true);
    }
    expect(sourceFromGet(true, STORED)).toMatchObject({ configVersion: 1 });
  });

  it("only a `ready` source can be outdated", () => {
    expect(isOutdatedSource({ status: "loading" })).toBe(false);
    expect(isOutdatedSource({ status: "error", message: "x" })).toBe(false);
    expect(isOutdatedSource(sourceFromGet(true, { present: false }))).toBe(false);
  });

  it("says why saving is off, in one sentence", () => {
    expect(PLANNER_UPDATED_MESSAGE).toBe("El planificador se actualizó. Recarga la página para poder guardar las reglas.");
  });
});

describe("saveFailure — the version refusal and the exact-count refusal (C3 T6)", () => {
  const anaCaps = (person2: string): SolverConfig => ({
    sundayLeads: [], saturdayLeads: [], support: [], conflicts: [], presence: [],
    restrictions: [
      { id: "r-1", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [],
        caps: [{ id: "c-1", pattern: "Sun.*", op: "==", value: 2, relative: false, relOffset: 0 }] },
      { id: "r-2", person: person2, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [],
        caps: [{ id: "c-2", pattern: "*.Lead", op: "==", value: 1, relative: false, relOffset: 0 }] },
    ] as PersonRestriction[],
  });
  const refusal = (issues: string[]) => ({ error: "invalid_request", conflict: false, details: { issues } });

  it("maps the version refusal to the outdated-tab message, with no reload offer", () => {
    expect(saveFailure(400, { ...refusal(["configVersion"]), details: { issues: ["configVersion"], expected: 2, received: null } }))
      .toEqual({ message: SAVE_OUTDATED_TAB_MESSAGE, stale: false });
    expect(SAVE_OUTDATED_TAB_MESSAGE).toBe(
      "Esta pestaña tiene una versión anterior del planificador y no guardó nada. Recarga la página y vuelve a aplicar tu cambio.",
    );
  });

  it("names the pair of an `:exact_overlap` refusal from the config it SENT", () => {
    expect(saveFailure(400, refusal(["restrictions[1].caps[0]:exact_overlap"]), anaCaps("ana "))).toEqual({
      message: "Hay dos números fijos para Dom Lead de Ana («Sun.* == 2»). Quita uno y guarda de nuevo; no se guardó nada.",
      stale: false,
    });
  });

  it("a bare `restrictions[i].caps[j]` (a non-object cap) is NOT an overlap — the plain rejection", () => {
    expect(saveFailure(400, refusal(["restrictions[1].caps[0]"]), anaCaps("Ana"))).toEqual({
      message: SAVE_REJECTED_MESSAGE,
      stale: false,
    });
  });

  it("an overlap refusal it cannot pair still never reads as the bare rejection", () => {
    const got = saveFailure(400, refusal(["restrictions[1].caps[0]:exact_overlap"]), anaCaps("Bruno"));
    expect(got.stale).toBe(false);
    expect(got.message).not.toBe(SAVE_REJECTED_MESSAGE);
    expect(got.message).toMatch(/números fijos/);
  });
});

describe("the A38 copy (C3 §6.2)", () => {
  it("names a role the way the form's pattern list names it", () => {
    expect(EXACT_ROLE_LABEL).toEqual({
      "Sun.Lead": "Dom Lead", "Sat.Lead": "Sáb Lead", "Sun.BGV": "Dom BGV", "Sat.BGV": "Sáb BGV", "Sun.Choir": "Dom Coro",
    });
  });

  it("has one wording per surface", () => {
    expect(exactOverlapFormMessage({ role: "Sat.Lead", person: "Ana", rule: "Sat.* == 1" })).toBe(
      "Ya hay un número fijo para Sáb Lead de Ana («Sat.* == 1»). Quita uno de los dos.",
    );
    expect(exactOverlapCardMessage("Sun.Choir")).toBe("Dos números fijos para Dom Coro: quita uno para poder guardar.");
  });
});
```

- [ ] **Step 3: Write the failing hook tests**

**Find** in `app/components/admin/__tests__/useSolverConfig.test.tsx`:

```ts
import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { SAVE_STALE_MESSAGE, SOLVER_CONFIG_ENDPOINT } from "../solverConfigSource";
import { useSolverConfig } from "../useSolverConfig";
```

**Replace with:**

```ts
import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { SAVE_OUTDATED_TAB_MESSAGE, SAVE_STALE_MESSAGE, SOLVER_CONFIG_ENDPOINT } from "../solverConfigSource";
import { useSolverConfig } from "../useSolverConfig";
import { SOLVER_CONFIG_VERSION } from "@/app/utils/solverConfigWriteRequest";
```

**Find** in `app/components/admin/__tests__/useSolverConfig.test.tsx`:

```ts
        : ok({ present: true, rev: "rev-1", config: DEFAULT_SOLVER_CONFIG }),
    );
    const { result } = renderHook(() => useSolverConfig());
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    return { result, fetchMock };
  }

  it("POSTs `{ rev, config }` and adopts the rev the server hands back", async () => {
    const edited = { ...DEFAULT_SOLVER_CONFIG, sundayLeads: ["frank"] };
    const { result, fetchMock } = await readyHook(() =>
      ok({ present: true, rev: "rev-2", config: edited }),
    );
    await act(async () => {
      expect(await result.current.save(edited, "rev-1")).toEqual({ ok: true });
    });
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ rev: "rev-1", config: edited });
```

**Replace with:**

```ts
        : ok({ present: true, rev: "rev-1", config: DEFAULT_SOLVER_CONFIG, configVersion: SOLVER_CONFIG_VERSION }),
    );
    const { result } = renderHook(() => useSolverConfig());
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    return { result, fetchMock };
  }

  it("POSTs `{ rev, config, configVersion }` and adopts the rev the server hands back", async () => {
    const edited = { ...DEFAULT_SOLVER_CONFIG, sundayLeads: ["frank"] };
    const { result, fetchMock } = await readyHook(() =>
      ok({ present: true, rev: "rev-2", config: edited, configVersion: SOLVER_CONFIG_VERSION }),
    );
    await act(async () => {
      expect(await result.current.save(edited, "rev-1")).toEqual({ ok: true });
    });
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    // C3 §6.2: the version rides on EVERY save; the route refuses a body without it.
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ rev: "rev-1", config: edited, configVersion: 2 });
```

**Append** to `app/components/admin/__tests__/useSolverConfig.test.tsx`:

```ts
describe("useSolverConfig — the config version (C3 §6.2, T6)", () => {
  it("maps the route's version refusal to the outdated-tab message, and leaves the state alone", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? {
            ok: false,
            status: 400,
            json: async () => ({
              error: "invalid_request", conflict: false,
              details: { issues: ["configVersion"], expected: 2, received: 1 },
            }),
          }
        : ok({ present: true, rev: "rev-1", config: DEFAULT_SOLVER_CONFIG, configVersion: SOLVER_CONFIG_VERSION }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useSolverConfig());
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.save(DEFAULT_SOLVER_CONFIG, "rev-1");
    });
    expect(outcome).toEqual({ ok: false, message: SAVE_OUTDATED_TAB_MESSAGE, stale: false });
    expect(result.current.source).toMatchObject({ status: "ready", rev: "rev-1", configVersion: 2 });
  });

  it("an echo from a server speaking another version lands as an outdated `ready` source", async () => {
    stubFetch(() => ok({ present: true, rev: "rev-1", config: DEFAULT_SOLVER_CONFIG }));
    const { result } = renderHook(() => useSolverConfig());
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    expect(result.current.source).toMatchObject({ configVersion: 1 });
  });
});
```

- [ ] **Step 4: Write the failing panel tests**

**Create** `app/components/admin/__tests__/MonthGenerator.configVersion.test.tsx`:

```tsx
/** @vitest-environment jsdom */
// Solver v3 C3 §6.2 — the rule panel and the config version (T6).
//
// A tab whose server speaks another config version cannot save the rules.
// Reached in C3's own release only in tests (a C3 bundle always meets a C3
// server); it is what makes the NEXT bump, or a rollback, humane: the admin is
// told to reload instead of having a save refused after the fact. And when the
// route does refuse a save for its version, the message says so and offers no
// «Recargar reglas» — a re-read through this bundle cannot fix it.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules, type RulesHarness } from "./rulesHarness";
import { AdminProviders } from "./providersHarness";
import { PLANNER_UPDATED_MESSAGE, SAVE_OUTDATED_TAB_MESSAGE } from "../solverConfigSource";

afterEach(cleanup);

const members = [{ _id: "m-ana", member_name: "Ana", memberType: ["voz", "sunday_lead"] }];
const saveButton = () => screen.getByRole("button", { name: /Guardar reglas|Guardando|Guardado/ });

function renderWith(rules: RulesHarness) {
  render(
    <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} rules={rules} />,
    { wrapper: AdminProviders },
  );
  return rules;
}

describe("«Guardar reglas» and the config version (C3 T6)", () => {
  it("is disabled, says why, and posts nothing when the server speaks another version", () => {
    const rules = renderWith(readyRules(undefined, { configVersion: 1 }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ana" }));
    const button = saveButton() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(PLANNER_UPDATED_MESSAGE);
    expect(screen.getByText(PLANNER_UPDATED_MESSAGE)).toBeTruthy();
    fireEvent.click(button);
    expect(rules.save).not.toHaveBeenCalled();
  });

  it("works as before when the versions match", () => {
    renderWith(readyRules());
    fireEvent.click(screen.getByRole("checkbox", { name: "Ana" }));
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(PLANNER_UPDATED_MESSAGE)).toBeNull();
  });

  it("shows the route's version refusal and offers NO «Recargar reglas»", async () => {
    renderWith(readyRules(undefined, {
      save: async () => ({ ok: false, message: SAVE_OUTDATED_TAB_MESSAGE, stale: false }),
    }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ana" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText(SAVE_OUTDATED_TAB_MESSAGE).getAttribute("role")).toBe("alert"));
    expect(screen.queryByRole("button", { name: "Recargar reglas" })).toBeNull();
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/solverConfigSource.test.ts app/components/admin/__tests__/useSolverConfig.test.tsx app/components/admin/__tests__/MonthGenerator.configVersion.test.tsx`
Expected: FAIL — 15 tests (28 pass): `TypeError: isOutdatedSource is not a function` and missing copy constants in the source suite; the POST body lacks `configVersion` (`expected { rev: 'rev-1', config: … } to deeply equal { …, configVersion: 2 }`); the refusal maps to `SAVE_REJECTED_MESSAGE`; the panel's button is enabled under version 1.

- [ ] **Step 6: The source — state, predicate, copy, refusal mapping**

**Find** in `app/components/admin/solverConfigSource.ts`:

```ts
import { DEFAULT_SOLVER_CONFIG } from "./solverConfigDefaults";
import type { SolverConfig } from "./plannerModel";
import { solverConfigFromDocument } from "@/app/utils/solverConfigWriteRequest";

export const SOLVER_CONFIG_ENDPOINT = "/api/admin/solver-config";

export type SolverConfigSource =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "absent"; config: SolverConfig }
  | { status: "ready"; rev: string; config: SolverConfig };
```

**Replace with:**

```ts
import { DEFAULT_SOLVER_CONFIG } from "./solverConfigDefaults";
import { capLabel, type SolverConfig } from "./plannerModel";
import {
  SOLVER_CONFIG_VERSION,
  exactCapOverlaps,
  solverConfigFromDocument,
} from "@/app/utils/solverConfigWriteRequest";

export const SOLVER_CONFIG_ENDPOINT = "/api/admin/solver-config";

export type SolverConfigSource =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "absent"; config: SolverConfig }
  /**
   * `configVersion` is the document shape the SERVER said it speaks (C3 §6.2) —
   * a GET or POST echo without one reads as 1, the pre-C3 shape. When it differs
   * from this bundle's `SOLVER_CONFIG_VERSION` the panel refuses to save
   * (`isOutdatedSource`): this bundle would drop or rewrite what it cannot read.
   */
  | { status: "ready"; rev: string; config: SolverConfig; configVersion: number };
```

**Find** in `app/components/admin/solverConfigSource.ts`:

```ts
export const SAVE_REJECTED_MESSAGE = "El servidor rechazó las reglas y no guardó nada.";
export const SAVE_FAILED_MESSAGE = "No se pudieron guardar las reglas.";
```

**Replace with:**

```ts
export const SAVE_REJECTED_MESSAGE = "El servidor rechazó las reglas y no guardó nada.";
export const SAVE_FAILED_MESSAGE = "No se pudieron guardar las reglas.";
/** The route refused this tab's version (C3 §6.2). No reload button: reloading the PAGE is the fix. */
export const SAVE_OUTDATED_TAB_MESSAGE =
  "Esta pestaña tiene una versión anterior del planificador y no guardó nada. Recarga la página y vuelve a aplicar tu cambio.";
/** The server echoed another version: saving is off until the page is reloaded (C3 §6.2). */
export const PLANNER_UPDATED_MESSAGE =
  "El planificador se actualizó. Recarga la página para poder guardar las reglas.";

// ─── One exact count per person per role (parent A38), in Spanish ─────────────
//
// `{rol}` names a role key the way the rule form's pattern list names the
// single-role patterns (`MonthGenerator`'s `PATTERNS`); `{regla}` is the other
// cap's `capLabel`, the text its chip shows.

/** The five role keys `rolesOfPattern` answers with, as the admin reads them. */
export const EXACT_ROLE_LABEL: Readonly<Record<string, string>> = {
  "Sun.Lead": "Dom Lead",
  "Sat.Lead": "Sáb Lead",
  "Sun.BGV": "Dom BGV",
  "Sat.BGV": "Sáb BGV",
  "Sun.Choir": "Dom Coro",
};
const roleLabel = (role: string) => EXACT_ROLE_LABEL[role] ?? role;

/** Under a cap row of the rule form that would make a second exact count. */
export function exactOverlapFormMessage(input: { role: string; person: string; rule: string }): string {
  return `Ya hay un número fijo para ${roleLabel(input.role)} de ${input.person} («${input.rule}»). Quita uno de los dos.`;
}

/** On each card of a pair already stored (saved before C3). */
export function exactOverlapCardMessage(role: string): string {
  return `Dos números fijos para ${roleLabel(role)}: quita uno para poder guardar.`;
}

/** The route refused the save at `restrictions[i].caps[j]:exact_overlap`. */
export function exactOverlapRefusalMessage(input: { role: string; person: string; rule: string }): string {
  return `Hay dos números fijos para ${roleLabel(input.role)} de ${input.person} («${input.rule}»). Quita uno y guarda de nuevo; no se guardó nada.`;
}

/** Only for a refusal the client cannot pair: a body this panel did not build. */
const EXACT_OVERLAP_UNPAIRED_MESSAGE =
  "Hay dos números fijos para un mismo rol de una persona. Quita uno y guarda de nuevo; no se guardó nada.";

const EXACT_OVERLAP_ISSUE = /^restrictions\[(\d+)\]\.caps\[(\d+)\]:exact_overlap$/;
```

**Find** in `app/components/admin/solverConfigSource.ts`:

```ts
  if (rev === null) return { status: "error", message: READ_FAILED_MESSAGE };
  // Normalised through the SAME reader the route uses, because this payload
  // crossed a wire and a partially-`undefined` config white-screens the config
  // step's own first render (`MemberPool`, `RuleBuilder` iterate it raw).
  return { status: "ready", rev, config: solverConfigFromDocument(body.config) };
}
```

**Replace with:**

```ts
  if (rev === null) return { status: "error", message: READ_FAILED_MESSAGE };
  // Normalised through the SAME reader the route uses, because this payload
  // crossed a wire and a partially-`undefined` config white-screens the config
  // step's own first render (`MemberPool`, `RuleBuilder` iterate it raw).
  return {
    status: "ready",
    rev,
    config: solverConfigFromDocument(body.config),
    // No version, or not a number, is the pre-C3 server: version 1.
    configVersion: typeof body.configVersion === "number" ? body.configVersion : 1,
  };
}

/** A `ready` source whose server speaks another config version — saving is off (C3 §6.2). */
export function isOutdatedSource(source: SolverConfigSource): boolean {
  return source.status === "ready" && source.configVersion !== SOLVER_CONFIG_VERSION;
}

/** The pair the route refused, named from the config this tab SENT (C3 §6.2). */
function exactOverlapRefusal(sent: SolverConfig | undefined, restriction: number, cap: number): string {
  const pairs = sent ? exactCapOverlaps(sent) : [];
  const pair = pairs.find((p) => p.later.restriction === restriction && p.later.cap === cap) ?? pairs[0];
  const firstCap = pair && sent?.restrictions[pair.first.restriction]?.caps[pair.first.cap];
  if (!pair || !firstCap) return EXACT_OVERLAP_UNPAIRED_MESSAGE;
  return exactOverlapRefusalMessage({ role: pair.roles[0], person: pair.person, rule: capLabel(firstCap) });
}
```

**Find** in `app/components/admin/solverConfigSource.ts`:

```ts
/**
 * Why a POST failed, in the admin's language — branching on the machine code
 * (`serviceMutation.ts`), never on the prose.
 */
export function saveFailure(status: number, body: unknown): { message: string; stale: boolean } {
  const code = isObj(body) && typeof body.error === "string" ? body.error : "";
  if (code === "stale_revision") return { message: SAVE_STALE_MESSAGE, stale: true };
  if (code === "not_found") return { message: SAVE_ABSENT_MESSAGE, stale: false };
  if (code === "invalid_request") return { message: SAVE_REJECTED_MESSAGE, stale: false };
```

**Replace with:**

```ts
/**
 * Why a POST failed, in the admin's language — branching on the machine code
 * (`serviceMutation.ts`), never on the prose.
 *
 * `sent` is the config the POST carried: an `:exact_overlap` refusal is named
 * by running `exactCapOverlaps` over it (C3 §6.2) — the same function the route
 * ran, so the pair it names is the pair the route refused.
 */
export function saveFailure(
  status: number,
  body: unknown,
  sent?: SolverConfig,
): { message: string; stale: boolean } {
  const code = isObj(body) && typeof body.error === "string" ? body.error : "";
  if (code === "stale_revision") return { message: SAVE_STALE_MESSAGE, stale: true };
  if (code === "not_found") return { message: SAVE_ABSENT_MESSAGE, stale: false };
  if (code === "invalid_request") {
    const details = isObj(body) && isObj(body.details) ? body.details : {};
    const issues = Array.isArray(details.issues)
      ? details.issues.filter((i): i is string => typeof i === "string")
      : [];
    // `stale: false` on both: «Recargar reglas» would re-read through this same
    // bundle, which can never produce a body the route accepts.
    if (issues.includes("configVersion")) return { message: SAVE_OUTDATED_TAB_MESSAGE, stale: false };
    for (const issue of issues) {
      const m = EXACT_OVERLAP_ISSUE.exec(issue);
      if (m) return { message: exactOverlapRefusal(sent, Number(m[1]), Number(m[2])), stale: false };
    }
    return { message: SAVE_REJECTED_MESSAGE, stale: false };
  }
```

- [ ] **Step 7: The hook sends the version and the config it sent**

**Find** in `app/components/admin/useSolverConfig.ts`:

```ts
import type { SolverConfig } from "./plannerModel";
```

**Replace with:**

```ts
import type { SolverConfig } from "./plannerModel";
import { SOLVER_CONFIG_VERSION } from "@/app/utils/solverConfigWriteRequest";
```

**Find** in `app/components/admin/useSolverConfig.ts`:

```ts
          body: JSON.stringify({ rev, config }),
        });
        const body = await readJson(res);
        if (!res.ok) return { ok: false, ...saveFailure(res.status, body) };
```

**Replace with:**

```ts
          // `configVersion` on EVERY save (C3 §6.2): the route refuses a body
          // whose version is not its own, before it reads or writes anything.
          body: JSON.stringify({ rev, config, configVersion: SOLVER_CONFIG_VERSION }),
        });
        const body = await readJson(res);
        if (!res.ok) return { ok: false, ...saveFailure(res.status, body, config) };
```

- [ ] **Step 8: The save bar refuses to save on another version**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
import {
  editableConfig,
  sameSolverConfig,
  type SolverConfigController,
  type SolverConfigSource,
} from "./solverConfigSource";
```

**Replace with:**

```tsx
import {
  PLANNER_UPDATED_MESSAGE,
  editableConfig,
  isOutdatedSource,
  sameSolverConfig,
  type SolverConfigController,
  type SolverConfigSource,
} from "./solverConfigSource";
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
  const rev = source.status === "ready" ? source.rev : null;
  const savedConfig = editableConfig(source);
```

**Replace with:**

```tsx
  const rev = source.status === "ready" ? source.rev : null;
  // C3 §6.2: the server speaks another config version. This bundle would drop
  // or rewrite what it cannot read, so it does not save at all until reloaded.
  const outdated = isOutdatedSource(source);
  const savedConfig = editableConfig(source);
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
  const onSave = async () => {
    if (rev === null) return;
```

**Replace with:**

```tsx
  const onSave = async () => {
    if (rev === null || outdated) return;
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
      {error && (
        <p role="alert" className="font-body text-[11px] text-negative-fg mr-auto">
          {error.message}
        </p>
      )}
```

**Replace with:**

```tsx
    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
      {outdated && (
        <p role="status" className="font-body text-[11px] text-warning-strong mr-auto">
          {PLANNER_UPDATED_MESSAGE}
        </p>
      )}
      {error && (
        <p role="alert" className="font-body text-[11px] text-negative-fg mr-auto">
          {error.message}
        </p>
      )}
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
        disabled={rev === null || !dirty || saving}
```

**Replace with:**

```tsx
        disabled={rev === null || !dirty || saving || outdated}
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
        title={
          source.status === "absent"
            ? "Todavía no hay reglas compartidas en el servidor; solo el script de siembra puede crearlas."
            : source.status === "error"
              ? "No se pudieron cargar las reglas compartidas; no se puede guardar hasta que vuelvan a cargar."
              : source.status === "loading"
                ? "Cargando las reglas compartidas…"
                : dirty
                  ? "Guardar estas reglas para todos los administradores"
                  : undefined
        }
```

**Replace with:**

```tsx
        title={
          outdated
            ? PLANNER_UPDATED_MESSAGE
            : source.status === "absent"
              ? "Todavía no hay reglas compartidas en el servidor; solo el script de siembra puede crearlas."
              : source.status === "error"
                ? "No se pudieron cargar las reglas compartidas; no se puede guardar hasta que vuelvan a cargar."
                : source.status === "loading"
                  ? "Cargando las reglas compartidas…"
                  : dirty
                    ? "Guardar estas reglas para todos los administradores"
                    : undefined
        }
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/solverConfigSource.test.ts app/components/admin/__tests__/useSolverConfig.test.tsx app/components/admin/__tests__/MonthGenerator.configVersion.test.tsx`
Expected: PASS (43 tests).

- [ ] **Step 10: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green (the ~65 `readyRules` renders still save: the harness defaults to this bundle's version), warnings at the baseline.

```bash
git add app/components/admin/solverConfigSource.ts app/components/admin/useSolverConfig.ts app/components/admin/MonthGenerator.tsx app/components/admin/__tests__/rulesHarness.ts app/components/admin/__tests__/solverConfigSource.test.ts app/components/admin/__tests__/useSolverConfig.test.tsx app/components/admin/__tests__/MonthGenerator.configVersion.test.tsx
git commit -m "feat(solver-config): send the config version and name the A38 refusal client-side" -m "C3 §6.2: every save carries configVersion; a GET or POST echo with another version, or none, disables «Guardar reglas» with a reload notice, because this bundle would drop what it cannot read. The route's version refusal maps to the outdated-tab message and an :exact_overlap refusal names the pair from the config the tab sent — both stale: false, since «Recargar reglas» re-reads through the same bundle and cannot fix either. Lands before the route's guard, which the pre-C3 route never sees."
```

---

## Task 6: The route refuses another config version before it reads or writes

Spec §6.2 «The guard», §6.12 (first row); T4, T5 (and T14 at the route). Review-log item 16: the guard sits after `gate()` and the JSON parse, before `rev`, the parser and `loadStored`.

**Files:**
- Modify: `app/api/admin/solver-config/route.ts:8-12` (imports), `:25-42` (header), `:92-103` (`GET`), `:105-110` (doc comment), `:121-125` (after the object check), `:183-188` (echo)
- Test: `app/api/__tests__/solverConfigRoute.test.ts` (imports, every existing body, one expectation, append)

**Interfaces:**
- Consumes: `SOLVER_CONFIG_VERSION` (Task 4); the parser's `:exact_overlap` and `sundayCadence` issues (Tasks 2–3); `serviceError(code, { message, details })` (`app/utils/serviceMutation.ts`).
- Produces (spec §7 item 3, exact): POST body `{ rev: string; config: SolverConfig; configVersion: number }`; GET and POST-success body `{ present: boolean; rev: string | null; config: SolverConfig | null; configVersion: number }` (the absent GET included); refusal HTTP 400 `{ error: "invalid_request", conflict: false, message: "Esta pestaña tiene una versión anterior de las reglas. Recarga la página; no se guardó nada.", details: { issues: ["configVersion"], expected: 2, received } }` with `received` the body's value, `null` when absent.
- Unchanged: auth (manager, content-editor excluded), create-never, the `_rev` check and `ifRevisionId`, `sanityConflictKind`, `updatedAt`/`updatedBy`.

- [ ] **Step 1: Every existing body carries the current version**

**Find** in `app/api/__tests__/solverConfigRoute.test.ts`:

```ts
import { GET, POST } from "@/app/api/admin/solver-config/route";
```

**Replace with:**

```ts
import { GET, POST } from "@/app/api/admin/solver-config/route";
import { SOLVER_CONFIG_VERSION } from "@/app/utils/solverConfigWriteRequest";
```

**Replace every** occurrence in `app/api/__tests__/solverConfigRoute.test.ts` (13 occurrences):

```ts
req({
```

**with:**

```ts
req({ configVersion: SOLVER_CONFIG_VERSION,
```

(Every existing `req({` is followed by a space, so `req({ rev: "rev-1", …` becomes `req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", …`. This is every POST in the file, the auth tests' included: spec T4 — «all existing route tests, bodies gaining `configVersion`». Do it before Step 2's append, which must not be touched.)

**Find** in `app/api/__tests__/solverConfigRoute.test.ts`:

```ts
    expect(res.status).toBe(200);
    expect(body).toEqual({ present: false, rev: null, config: null });
```

**Replace with:**

```ts
    expect(res.status).toBe(200);
    expect(body).toEqual({ present: false, rev: null, config: null, configVersion: SOLVER_CONFIG_VERSION });
```

- [ ] **Step 2: Write the failing guard tests**

**Append** to `app/api/__tests__/solverConfigRoute.test.ts`:

```ts
// ─── Solver v3 C3 · the config version guard (§6.2) — T4, T5 ──────────────────
//
// The POST is a whole-document serializer and the reader keeps only the fields
// it knows, so a tab whose bundle predates a field reads it away and its next
// save erases it for everyone. The route therefore refuses any body whose
// `configVersion` is not exactly its own — after auth, before it reads the
// stored document or parses the config.
const OUTDATED_TAB =
  "Esta pestaña tiene una versión anterior de las reglas. Recarga la página; no se guardó nada.";

describe("POST — the config version guard (C3 T4)", () => {
  const cases: [string, Record<string, unknown>, unknown][] = [
    ["absent", {}, null],
    ["null", { configVersion: null }, null],
    ['the string "2"', { configVersion: "2" }, "2"],
    ["1 (a pre-C3 shape)", { configVersion: 1 }, 1],
    ["3 (a newer shape)", { configVersion: 3 }, 3],
  ];
  for (const [label, version, received] of cases) {
    it(`refuses a configVersion that is ${label}, reading and writing nothing`, async () => {
      const res = await POST(req({ rev: "rev-1", config: config(), ...version }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "invalid_request",
        conflict: false,
        message: OUTDATED_TAB,
        details: { issues: ["configVersion"], expected: SOLVER_CONFIG_VERSION, received },
      });
      expect(h.fetch).not.toHaveBeenCalled();
      expect(h.patchedIds).toEqual([]);
      expect(h.commit).not.toHaveBeenCalled();
    });
  }

  it("still answers 403, not 400, to a non-manager with no version (auth comes first)", async () => {
    h.requireActiveManager.mockResolvedValue(null);
    expect((await POST(req({ rev: "rev-1", config: config() }))).status).toBe(403);
  });

  it("checks the version before `rev`: a body missing both names the version", async () => {
    const res = await POST(req({ config: config() }));
    expect((await res.json()).details.issues).toEqual(["configVersion"]);
  });

  it("with the current version behaves as before, and its echo carries the version", async () => {
    const res = await POST(req({ rev: "rev-1", config: config(), configVersion: SOLVER_CONFIG_VERSION }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ present: true, configVersion: SOLVER_CONFIG_VERSION });
    expect(h.revisions).toEqual(["rev-1"]);
  });

  it("the GET carries the version", async () => {
    expect(await (await GET()).json()).toMatchObject({ present: true, rev: "rev-1", configVersion: SOLVER_CONFIG_VERSION });
  });
});

describe("POST — «Mes por medio» survives every path (C3 T5)", () => {
  const cadenceRestriction = {
    id: "r-ana", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1,
    weekExclusions: [], caps: [], sundayCadence: "alternate",
  };
  const STORED_WITH_CADENCE = {
    ...STORED,
    restrictions: [...config().restrictions, { _type: "solverRestriction", _key: "r-ana", ...cadenceRestriction }],
  };

  it("refuses a body exactly as a pre-C3 tab sends it, leaving the stored «Mes por medio» alone", async () => {
    h.fetch.mockResolvedValue(STORED_WITH_CADENCE);
    // `{ rev, config }`, the restriction without the field — what a pre-C3
    // bundle's reader turned the stored document into.
    const { sundayCadence: _dropped, ...withoutField } = cadenceRestriction;
    void _dropped;
    const preC3Body = { rev: "rev-1", config: config({ restrictions: [...config().restrictions, withoutField] }) };
    const res = await POST({ json: async () => preC3Body } as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toEqual(["configVersion"]);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.sets).toEqual([]);
  });

  it("the GET reads it, and a current tab's save writes it back", async () => {
    h.fetch.mockResolvedValue(STORED_WITH_CADENCE);
    const got = await (await GET()).json();
    expect(got.config.restrictions[1]).toMatchObject({ id: "r-ana", sundayCadence: "alternate" });

    await POST(req({ rev: "rev-1", config: got.config, configVersion: SOLVER_CONFIG_VERSION }));
    const written = (h.sets[0].restrictions as Record<string, unknown>[])[1];
    expect(written).toMatchObject({ _key: "r-ana", sundayCadence: "alternate" });
    expect((h.sets[0].restrictions as Record<string, unknown>[])[0]).not.toHaveProperty("sundayCadence");
  });

  it("refuses an invalid cadence value at its issue path, writing nothing", async () => {
    const res = await POST(req({
      rev: "rev-1",
      configVersion: SOLVER_CONFIG_VERSION,
      config: config({ restrictions: [{ ...cadenceRestriction, sundayCadence: "normal" }] }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toEqual(["restrictions[0].sundayCadence"]);
    expect(h.patchedIds).toEqual([]);
  });
});

describe("POST — one exact count per person per role (C3 T14, parent A38)", () => {
  it("refuses two `==` caps covering Sun.Lead for one person, naming the later cap, writing nothing", async () => {
    const res = await POST(req({
      rev: "rev-1",
      configVersion: SOLVER_CONFIG_VERSION,
      config: config({
        restrictions: [{
          id: "r-ana", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [],
          caps: [
            { id: "c-1", pattern: "Sun.Lead", op: "==", value: 2, relative: false, relOffset: 0 },
            { id: "c-2", pattern: "*.Lead", op: "==", value: 1, relative: false, relOffset: 0 },
          ],
        }],
      }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "invalid_request", conflict: false });
    expect(body.details.issues).toEqual(["restrictions[0].caps[1]:exact_overlap"]);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.patchedIds).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run app/api/__tests__/solverConfigRoute.test.ts`
Expected: FAIL — 10 tests: the five version cases (`expected 200 to be 400` — the pre-guard route writes), «checks the version before `rev`…» (`expected [ 'rev' ] to deeply equal [ 'configVersion' ]`), the echo and GET tests (no `configVersion`), the absent-GET expectation, and «refuses a body exactly as a pre-C3 tab sends it…» (`expected 200 to be 400`). The A38 route test and the cadence round-trip already pass (Tasks 2–3).

- [ ] **Step 4: The guard, the echoes, the header**

**Find** in `app/api/admin/solver-config/route.ts`:

```ts
import {
  SOLVER_CONFIG_DOC_ID,
  parseSolverConfigWrite,
  solverConfigFromDocument,
} from "@/app/utils/solverConfigWriteRequest";
```

**Replace with:**

```ts
import {
  SOLVER_CONFIG_DOC_ID,
  SOLVER_CONFIG_VERSION,
  parseSolverConfigWrite,
  solverConfigFromDocument,
} from "@/app/utils/solverConfigWriteRequest";
```

**Find** in `app/api/admin/solver-config/route.ts`:

```ts
 * ─── The two things this route deliberately CANNOT do ────────────────────────
```

**Replace with:**

```ts
 * ─── The three things this route deliberately CANNOT do ──────────────────────
```

**Find** in `app/api/admin/solver-config/route.ts`:

```ts
 * 2. **It can never accept a stale `_rev`.**
```

**Replace with:**

```ts
 * 2. **It can never accept a body from a client that reads another document
 *    shape** (solver v3 C3 §6.2). This POST replaces the WHOLE document and the
 *    reader keeps only the fields it knows, so a tab whose bundle predates a
 *    field — «Mes por medio» was the first — reads it away and its next save,
 *    about any rule, erases it for everyone. Every body carries
 *    `configVersion`; anything but exactly `SOLVER_CONFIG_VERSION` is a 400
 *    `invalid_request` before anything is read or written. `invalid_request`,
 *    not `stale_revision`: an old tab renders the latter as «Recargar reglas»,
 *    whose re-read goes through that tab's own field-dropping reader and can
 *    never produce a body this route accepts.
 *
 * 3. **It can never accept a stale `_rev`.**
```

**Find** in `app/api/admin/solver-config/route.ts`:

```ts
  const doc = await loadStored();
  if (!doc) return NextResponse.json({ present: false, rev: null, config: null });
  return NextResponse.json({
    present: true,
    rev: typeof doc._rev === "string" ? doc._rev : null,
    config: solverConfigFromDocument(doc),
  });
}
```

**Replace with:**

```ts
  const doc = await loadStored();
  // `configVersion` on every answer, absent included: a client that speaks
  // another version disables its own save on reading it (C3 §6.2).
  if (!doc) {
    return NextResponse.json({ present: false, rev: null, config: null, configVersion: SOLVER_CONFIG_VERSION });
  }
  return NextResponse.json({
    present: true,
    rev: typeof doc._rev === "string" ? doc._rev : null,
    config: solverConfigFromDocument(doc),
    configVersion: SOLVER_CONFIG_VERSION,
  });
}
```

**Find** in `app/api/admin/solver-config/route.ts`:

```ts
 * Replace the rule set. Body: `{ rev, config }` — `config` is a `SolverConfig`
```

**Replace with:**

```ts
 * Replace the rule set. Body: `{ rev, config, configVersion }` — `config` is a `SolverConfig`
```

**Find** in `app/api/admin/solver-config/route.ts`:

```ts
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return reject(serviceError("invalid_request", { details: { issues: ["body"] } }));
  }

  const rev = (body as Record<string, unknown>).rev;
```

**Replace with:**

```ts
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return reject(serviceError("invalid_request", { details: { issues: ["body"] } }));
  }

  // The version guard (C3 §6.2) — after auth and the JSON parse, before `rev`,
  // the parser and the read: an outdated body is refused with nothing read.
  const configVersion = (body as Record<string, unknown>).configVersion;
  if (configVersion !== SOLVER_CONFIG_VERSION) {
    return reject(
      serviceError("invalid_request", {
        message: "Esta pestaña tiene una versión anterior de las reglas. Recarga la página; no se guardó nada.",
        details: {
          issues: ["configVersion"],
          expected: SOLVER_CONFIG_VERSION,
          received: configVersion === undefined ? null : configVersion,
        },
      }),
    );
  }

  const rev = (body as Record<string, unknown>).rev;
```

**Find** in `app/api/admin/solver-config/route.ts`:

```ts
  const after = await loadStored();
  return NextResponse.json({
    present: true,
    rev: after && typeof after._rev === "string" ? after._rev : null,
    config: parsed.value.config,
  });
```

**Replace with:**

```ts
  const after = await loadStored();
  return NextResponse.json({
    present: true,
    rev: after && typeof after._rev === "string" ? after._rev : null,
    config: parsed.value.config,
    configVersion: SOLVER_CONFIG_VERSION,
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run app/api/__tests__/solverConfigRoute.test.ts`
Expected: PASS (31 tests).

- [ ] **Step 6: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add app/api/admin/solver-config/route.ts app/api/__tests__/solverConfigRoute.test.ts
git commit -m "feat(solver-config): refuse a rules save from another config version" -m "C3 §6.2: the POST replaces the whole document, so a tab whose bundle predates a field erases it on its next save. The route now refuses any configVersion but its own with 400 invalid_request, after auth and before it reads or parses anything — invalid_request because a pre-C3 tab renders it honestly with no dead-end reload, where stale_revision would loop through its field-dropping reader. GET (absent included) and the POST echo carry the version."
```

---

## Task 7: v2 is inert to the setting — `v2View`

Spec R3, §6.4 (parent A8, A34); T8. Review-log item 11. `solverPools` reads the `person` of **every** restriction (E9), so a cadence-only card would inject an unpooled member into v2's `support` and make a member with no Tipo refuse the month; and `isExcludedFromLead` is a first-match `.find` a cadence-only card could shadow. Both read `v2View(config)`. Every other v2 reader reads clause fields only (E10) and is left alone; the corpus asserts all of them anyway.

**Files:**
- Modify: `app/components/admin/plannerModel.ts:274-279` (after `ConflictRule`), `:858-859` (`solverPools`)
- Modify: `app/components/admin/leadPoolHistory.ts:7-12` (import), `:37` (`isExcludedFromLead`)
- Test: `app/components/admin/__tests__/cadenceV2Inert.test.ts` (create)

**Interfaces:**
- Consumes: `PersonRestriction.sundayCadence` (Task 2).
- Produces: `export function v2View<C extends Pick<SolverConfig, "restrictions">>(config: C): C` in `app/components/admin/plannerModel.ts` — `sundayCadence` removed from every restriction, and every restriction removed that carried it and, without it, has no `excludedPatterns`, no `weekExclusions`, no `caps` and `fairness === "none"`; a restriction that never carried it is never removed; the input is not mutated. Spec §7 item 7's guarantee rests on it (C4, C6, C7 rely on «saving «Mes por medio» changes nothing v2 does»).

- [ ] **Step 1: Write the failing corpus**

**Create** `app/components/admin/__tests__/cadenceV2Inert.test.ts`:

```ts
// Solver v3 C3 §6.4 (parent A8, A34) — v2 is inert to «Mes por medio» (T8).
//
// For a config `C`, `v2View(C)` is `C` with `sundayCadence` removed from every
// restriction and every restriction removed that CARRIED it and, without it, has
// no clause (no excluded pattern, no week exclusion, no cap, fairness "none") —
// exactly what the pre-C3 form could not have produced. The invariant: every v2
// answer for `C` deep-equals the answer for `v2View(C)`. Removing only the field
// is not enough, because `solverPools` reads the `person` of EVERY restriction:
// a cadence-only card would inject an unpooled member into `support` and make a
// member with no Tipo refuse the month (E9). The one deliberate difference —
// `unresolvedRuleNames` also reports a cadence-only name that matches nobody —
// is asserted at the end.
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import {
  buildColumns,
  buildRows,
  buildSolveRequest,
  createColumnId,
  solverPools,
  v2View,
  type GridCell,
  type PersonRestriction,
  type SolverConfig,
  type SolverHistoryEntry,
} from "../plannerModel";
import { collectPins, pinConflicts, type Pin } from "../pinModel";
import { evaluate, ruleViolationsForColumn, unresolvedRuleNames } from "../ruleEnforcement";
import { fairnessByMemberId } from "../localFill";
import { priorMonthLeadVisibility } from "../leadPoolHistory";
import { pinViolationNotices } from "../pinViolations";

const SUNDAYS = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];
const SATURDAYS = ["2026-10-10", "2026-10-31"]; // the 31st is the trailing Saturday (week 5)

const m = (id: string, name: string, alias: string, memberType: string[], extra: Partial<RankMember> = {}): RankMember =>
  ({ _id: id, member_name: name, alias, memberType, ...extra } as RankMember);
const ANA = m("m-ana", "Ana Ruiz", "Ana", ["voz", "sunday_lead"], { unavailableDates: ["2026-10-11"] });
const BRUNO = m("m-bruno", "Bruno Díaz", "Bruno", ["voz", "saturday_lead"]);
const CARLA = m("m-carla", "Carla Soto", "Carla", ["voz", "sunday_lead", "saturday_lead"]);
const DIANA = m("m-diana", "Diana Paz", "Diana", []); // no Tipo: not schedulable (ADR-0029)
const ELENA = m("m-elena", "Elena Mora", "Elena", ["voz", "support"], { unavailableDates: ["2026-10-17"] }); // in no pool
const FER = m("m-fer", "Fernando Gil", "Fer", ["voz", "support"]);
const MEMBERS = [ANA, BRUNO, CARLA, DIANA, ELENA, FER];

const rule = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...patch,
});
const cadenceOnly = (id: string, person: string) => rule(id, person, { sundayCadence: "alternate" });

const BASE: SolverConfig = {
  sundayLeads: ["m-ana", "m-carla"],
  saturdayLeads: ["m-bruno", "m-carla"],
  support: ["m-fer"],
  restrictions: [
    rule("r-bruno", "Bruno", { caps: [{ id: "c-b", pattern: "Sat.*", op: "<=", value: 2, relative: false, relOffset: 0 }] }),
    rule("r-fer", "Fer", { weekExclusions: [{ id: "w-f", week: 2, pattern: "*.*" }], fairness: "exempt" }),
  ],
  conflicts: [{ id: "x-1", personA: "Ana", personB: "Carla", pattern: "*.Lead" }],
  presence: [{ id: "p-1", persons: ["Ana", "Fer"], pattern: "Sun.BGV" }],
};
const withRules = (...extra: PersonRestriction[]): SolverConfig => ({ ...BASE, restrictions: [...BASE.restrictions, ...extra] });

const CORPUS: [string, SolverConfig][] = [
  ["the cadence on a clause-bearing restriction",
    withRules(rule("r-ana", "Ana", { excludedPatterns: ["Sat.*"], fairness: "exempt", sundayCadence: "alternate" }))],
  ["a cadence-only restriction for a pooled member", withRules(cadenceOnly("r-carla", "Carla"))],
  ["a cadence-only restriction for an unpooled member (pinned to a BGV seat below)", withRules(cadenceOnly("r-elena", "Elena"))],
  ["a cadence-only restriction for a member with no Tipo", withRules(cadenceOnly("r-diana", "Diana"))],
  ["a cadence-only restriction whose name matches nobody", withRules(cadenceOnly("r-zoe", "Zoe"))],
  ["a clause-less «Holgura 0» restriction that never carried it, beside a cadence-only one",
    withRules(rule("r-fer0", "Fer", { fairness: "slack", fairnessSlack: 0 }), cadenceOnly("r-carla", "Carla"))],
  ["a cadence-only card ahead of an exclusion card with the same person text (first-match readers)",
    withRules(cadenceOnly("r-1", "m-carla"), rule("r-2", "m-carla", { excludedPatterns: ["Sun.Lead"] }))],
];

const ROWS = buildRows();
const VOICE_ROWS = ROWS.filter((r) => ["lead", "bgv", "coro"].includes(r.id));
const COLUMNS = buildColumns({ sundayDates: SUNDAYS, activeSatDates: SATURDAYS });
const SUN1 = createColumnId("sunday_role", "2026-10-04");
const SAT2 = createColumnId("saturday_role", "2026-10-10");
const cell = (columnId: string, rowId: string, ids: string[]): GridCell => ({
  columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin: "manual",
});
// Elena pinned to a Sunday BGV seat: under v2 she is in no pool, so the pin
// board must flag her `outsidePool` for `C` exactly as for `v2View(C)`.
const CELLS = [cell(SUN1, "lead", ["m-ana"]), cell(SUN1, "bgv", ["m-elena", "m-carla"]), cell(SAT2, "lead", ["m-bruno"])];
const HISTORY: SolverHistoryEntry[] = [
  { key: "2026-9", year: 2026, month: 9, total_counts: { "Ana Ruiz": 2 }, role_counts: { "Ana Ruiz": { "Sun.Lead": 2 } } },
];
const PINS: Pin[] = [{ week: 1, role: "Sun.BGV", person: "Elena Mora" }];
const VIOLATIONS = ["Bruno Díaz: Sat.* <= 2", "W1 Sun: Ana Ruiz !with Carla Soto on *.Lead", "W1: any_of(Ana Ruiz,Fernando Gil) on Sun.BGV each_week"];

/** Every v2 answer this spec's invariant names, for one config. */
function v2Answers(config: SolverConfig) {
  const pools = solverPools(config, MEMBERS);
  const request = (withholdTrailing: boolean) => buildSolveRequest({
    config, members: MEMBERS, sundayDates: SUNDAYS, activeSatDates: SATURDAYS,
    historyEntries: HISTORY, year: 2026, month: 10, withholdTrailing,
  });
  const collected = collectPins({ cells: CELLS, columns: COLUMNS, rows: ROWS, members: MEMBERS, sundayDates: SUNDAYS });
  const assignedFor = (columnId: string) => CELLS
    .filter((c) => c.columnId === columnId)
    .flatMap((c) => c.occupants.map((o) => ({ seatId: c.rowId, category: "voz" as const, memberId: o.memberId })));
  return {
    pools: { ...pools, requestMemberIds: [...pools.requestMemberIds] },
    request: request(false),
    requestWithheld: request(true),
    pinConflicts: [...pinConflicts({
      collected, columns: COLUMNS, members: MEMBERS,
      pools: { sundayLeads: pools.sundayLeadNames, saturdayLeads: pools.saturdayLeadNames, support: [...pools.supportNames, ...pools.extraSupport] },
    })],
    verdicts: COLUMNS.flatMap((column) => VOICE_ROWS.flatMap((row) => MEMBERS.map((member) =>
      evaluate({ member, row, column, sundayDates: SUNDAYS, assigned: assignedFor(column.columnId), members: MEMBERS, config })))),
    seatedViolations: COLUMNS.map((column) => [...ruleViolationsForColumn({
      column, rows: ROWS, assigned: assignedFor(column.columnId), members: MEMBERS, sundayDates: SUNDAYS, config,
    })]),
    fairness: [...fairnessByMemberId(config, MEMBERS)],
    leadVisibility: (["Sun.Lead", "Sat.Lead"] as const).map((role) =>
      priorMonthLeadVisibility({ config, members: MEMBERS, history: HISTORY, year: 2026, month: 10, role })),
    pinNotices: pinViolationNotices({ violations: VIOLATIONS, ceilingProven: true, config, members: MEMBERS, pins: PINS, sundayDates: SUNDAYS }),
  };
}

describe("v2View (C3 §6.4)", () => {
  it("removes the field everywhere and the restrictions that carried ONLY the cadence", () => {
    const config = withRules(
      rule("r-ana", "Ana", { excludedPatterns: ["Sat.*"], sundayCadence: "alternate" }),
      cadenceOnly("r-carla", "Carla"),
      rule("r-gabi", "Gabi", { fairness: "slack", fairnessSlack: 0, sundayCadence: "alternate" }),
    );
    expect(v2View(config).restrictions.map((r) => r.id)).toEqual(["r-bruno", "r-fer", "r-ana", "r-gabi"]);
    for (const r of v2View(config).restrictions) expect(r).not.toHaveProperty("sundayCadence");
  });

  it("never removes a restriction that did not carry the cadence, clause-less or not", () => {
    const config = withRules(rule("r-fer0", "Fer", { fairness: "slack", fairnessSlack: 0 }), rule("r-empty", "Ana"));
    expect(v2View(config)).toEqual(config);
  });

  it("does not mutate its input", () => {
    const config = withRules(cadenceOnly("r-carla", "Carla"));
    const before = JSON.stringify(config);
    v2View(config);
    expect(JSON.stringify(config)).toBe(before);
  });
});

describe("every v2 answer is the same for C and v2View(C) (C3 T8)", () => {
  for (const [label, config] of CORPUS) {
    it(label, () => {
      expect(v2Answers(config)).toEqual(v2Answers(v2View(config)));
    });
  }

  it("the corpus is not vacuous: each case moves something a field-strip alone would leave", () => {
    // Stripping only the field leaves a clause-less restriction that still
    // reaches `solverPools`. Pinned so the corpus keeps exercising E9.
    const strip = (c: SolverConfig): SolverConfig => ({
      ...c, restrictions: c.restrictions.map(({ sundayCadence: _drop, ...r }) => { void _drop; return r; }),
    });
    const unpooled = CORPUS[2][1];
    expect(solverPools(strip(unpooled), MEMBERS).extraSupport).toContain("Elena Mora");
    expect(solverPools(unpooled, MEMBERS).extraSupport).not.toContain("Elena Mora");
    const noTipo = CORPUS[3][1];
    expect(solverPools(strip(noTipo), MEMBERS).dslBlockedByTipo).toEqual(["Diana"]);
    expect(solverPools(noTipo, MEMBERS).dslBlockedByTipo).toEqual([]);
  });

  it("the one deliberate difference: an unresolvable cadence-only name is still reported", () => {
    const zoe = CORPUS[4][1];
    expect(unresolvedRuleNames(zoe, MEMBERS)).toContain("Zoe");
    expect(unresolvedRuleNames(v2View(zoe), MEMBERS)).not.toContain("Zoe");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/cadenceV2Inert.test.ts`
Expected: FAIL — `TypeError: v2View is not a function` on every test but «the corpus is not vacuous», which fails on `expected [ 'Elena Mora' ] to not include 'Elena Mora'` (today a cadence-only card injects her into `support`).

- [ ] **Step 3: Define `v2View`**

**Find** in `app/components/admin/plannerModel.ts`:

```ts
export interface ConflictRule {
  id: string;
  personA: string;
  personB: string;
  pattern: string;
}
```

**Replace with:**

```ts
export interface ConflictRule {
  id: string;
  personA: string;
  personB: string;
  pattern: string;
}

/**
 * The config v2 sees (solver v3 C3 §6.4; parent A8, A34): `sundayCadence` removed
 * from every restriction, and every restriction removed that CARRIED it and,
 * without it, has no clause — no excluded pattern, no week exclusion, no cap and
 * `fairness === "none"` — exactly what the pre-C3 form could not have produced. A
 * restriction that never carried the cadence is never removed, clause-less or not
 * (a «Holgura 0» one stays, as today).
 *
 * Applied where v2 reads restriction PERSONS rather than clauses — `solverPools`
 * (both its callers: `buildSolveRequest` and the pin board) and the first-match
 * `isExcludedFromLead` — so a cadence-only card never injects its person into
 * `support`, never makes a member with no Tipo refuse the month, and never
 * shadows another card. `cadenceV2Inert.test.ts` asserts every v2 answer equal
 * for `C` and `v2View(C)`.
 */
export function v2View<C extends Pick<SolverConfig, "restrictions">>(config: C): C {
  return {
    ...config,
    restrictions: config.restrictions.flatMap((r) => {
      if (r.sundayCadence === undefined) return [r];
      const { sundayCadence: _cadence, ...rest } = r;
      void _cadence;
      const clauseless =
        rest.excludedPatterns.length === 0 &&
        rest.weekExclusions.length === 0 &&
        rest.caps.length === 0 &&
        rest.fairness === "none";
      return clauseless ? [] : [rest];
    }),
  };
}
```

- [ ] **Step 4: Run it — the corpus must now fail on E9, not on a missing function**

Run: `npx vitest run app/components/admin/__tests__/cadenceV2Inert.test.ts`
Expected: FAIL — exactly 5 tests: the unpooled member, the member with no Tipo, the name matching nobody, the first-match case, and «the corpus is not vacuous». The 3 `v2View` unit tests and the other corpus cases pass. This step is the proof that the corpus sees the defect the next step fixes.

- [ ] **Step 5: Apply it where v2 reads restriction persons**

**Find** in `app/components/admin/plannerModel.ts`:

```ts
export function solverPools(config: SolverConfig, members: RankMember[]): SolverPools {
  const idToName = (id: string) => memberIdToName(id, members);
```

**Replace with:**

```ts
export function solverPools(input: SolverConfig, members: RankMember[]): SolverPools {
  // C3 §6.4: v2 reads every restriction's PERSON below, so a «Mes por medio»
  // card with no clause would inject an unpooled member into `support` and
  // make a member with no Tipo refuse the month. v2 sees `v2View`, here, so
  // both callers — `buildSolveRequest` and the pin board — get one answer.
  const config = v2View(input);
  const idToName = (id: string) => memberIdToName(id, members);
```

**Find** in `app/components/admin/leadPoolHistory.ts`:

```ts
import {
  memberFitsPool,
  memberIdToName,
  type SolverConfig,
  type SolverHistoryEntry,
} from "./plannerModel";
```

**Replace with:**

```ts
import {
  memberFitsPool,
  memberIdToName,
  v2View,
  type SolverConfig,
  type SolverHistoryEntry,
} from "./plannerModel";
```

**Find** in `app/components/admin/leadPoolHistory.ts`:

```ts
  const restriction = config.restrictions.find((r) => r.person === memberId);
```

**Replace with:**

```ts
  // First match wins here, so a «Mes por medio» card with no clause must not be
  // the one found ahead of a real exclusion (C3 §6.4): v2 reads `v2View`.
  const restriction = v2View(config).restrictions.find((r) => r.person === memberId);
```

`buildSolveRequest`'s other readers (`saturdayAccess`, `trailingVerdict`, `saturdayFloorOmissions`, `allRulesToDs`) keep iterating the original config: a cadence-only restriction has no clause for them to read, and `capKey` indices are internal to one call and never leave it, which the corpus's deep-equal on the whole result confirms.

- [ ] **Step 6: Run the corpus and every v2 suite**

Run: `npx vitest run app/components/admin/__tests__/cadenceV2Inert.test.ts app/components/admin/__tests__/plannerModel.test.ts app/components/admin/__tests__/solverPools.test.ts app/components/admin/__tests__/ruleEnforcement.test.ts app/components/admin/__tests__/localFill.test.ts app/components/admin/__tests__/pinViolations.test.ts app/components/admin/__tests__/saturdayFloors.test.ts app/components/admin/__tests__/trailingSaturday.test.ts app/components/admin/__tests__/leadPoolHistory.test.ts app/components/admin/__tests__/pinModel.test.ts`
Expected: PASS — the corpus (12 tests) and every existing v2 suite, **none of which this task edits**.

- [ ] **Step 7: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add app/components/admin/plannerModel.ts app/components/admin/leadPoolHistory.ts app/components/admin/__tests__/cadenceV2Inert.test.ts
git commit -m "fix(planner): keep v2 inert to «Mes por medio» through v2View" -m "Parent A8/A34, C3 §6.4: solverPools takes the person of every restriction, so a cadence-only card would inject an unpooled member into v2's support and make a member with no Tipo refuse the month; isExcludedFromLead's first match could find it ahead of a real exclusion. Both now read v2View — the config without sundayCadence and without the restrictions that carried only it. The corpus asserts solverPools, the whole solve request, the pin board, the grid verdicts, fairness, the lead-pool panel and the pin-violation copy equal for a config and its v2 view; the existing v2 suites pass unedited."
```

---

## Task 8: The resolver — `app/utils/sundayCadence.ts`

Spec R4, R6, §6.5, §6.7, §7 items 4–5 (E25); T9, T10 (predicate). A neutral module, so C2's eligibility resolver (and through it C4's script and C7's rehearsal), this panel and C6's planner import the same code. All three functions drop non-worship members **themselves** (`normalizeMinistries`); callers pass members with `ministries` as read.

**Files:**
- Create: `app/utils/sundayCadence.ts`
- Modify: `app/components/admin/MonthGenerator.tsx:129-137` (`MemberOption`), `app/components/admin/serviceCardModel.ts:96-110` (`MemberOption`) — a type widening only
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`
- Test: `app/utils/__tests__/sundayCadence.test.ts` (create)

**Interfaces:**
- Consumes: `normalizeMinistries(v: unknown): MinistryId[]` (`app/ministries.ts:41`); `rulePersonNamesMember`, `displayMemberName` (`app/utils/memberRuleNames.ts:13`, `:37`); `MEMBER_TYPE_LABEL` (`app/utils/memberTypes.ts`); `memberFitsPool(member, "sundayLeads")` (`plannerModel.ts:813`); `PersonRestriction.sundayCadence` (Task 2).
- Produces (spec §7 items 4–5, exact names and shapes):
  - `export type RosterMember = { _id: string; member_name: string; alias?: string; memberType?: string[]; ministries?: unknown }`
  - `export type NameRefusal = { person: string; reason: "unresolved" | "ambiguous"; matches: string[] }`
  - `export type CadenceOutsideReason = "not_ticked" | "no_sunday_lead_tipo"`
  - `export function resolveRulePersonId(person: string, roster: RosterMember[]): { ok: true; id: string } | { ok: false; reason: "unresolved" | "ambiguous"; matches: string[] }` — `matches` unique and sorted.
  - `export function cadenceMembers(config: Pick<SolverConfig, "restrictions">, roster: RosterMember[]): { ids: string[]; refusals: NameRefusal[] }` — ids unique and sorted; one refusal per distinct `person` text.
  - `export function cadenceOutsideSundayPool(config: Pick<SolverConfig, "restrictions" | "sundayLeads">, roster: RosterMember[]): Array<{ id: string; name: string; reason: CadenceOutsideReason }>` — resolved cadence members with a non-empty Tipo only, in id order.
  - `export const CADENCE_V2_NOTE = "aplica con el nuevo solver"`, `export const SLACK_V3_NOTE = "no aplica con el nuevo solver"`, `export const CADENCE_OUTSIDE_HEADING = "Mes por medio fuera de Líderes Domingo"`, `export const CADENCE_OUTSIDE_SENTENCE: Readonly<Record<CadenceOutsideReason, (name: string) => string>>` (the two §6.7 sentences). Tasks 9–10 render them; C6 gates exactly these.
  - `MemberOption.ministries?: unknown` on both planner member types, so the planner's `members` reach these functions with the field intact (E25).

- [ ] **Step 1: Write the failing tests**

**Create** `app/utils/__tests__/sundayCadence.test.ts`:

```ts
// Solver v3 C3 §6.5, §6.7, §7 items 4–5 — the exactly-one name resolver, the
// cadence members, and the «Mes por medio fuera de Líderes Domingo» predicate
// (T9, T10).
//
// The roster is the UNFILTERED worship roster: no `voz`, pool or Tipo filter
// (any of them can hide a true namesake), but the resolver drops every member
// whose ministries exclude worship ITSELF — the planner's `members` is
// worship-only for a worship admin and everyone for a super-admin (E25), and one
// config must resolve the same for both.
import { describe, expect, it } from "vitest";

import {
  CADENCE_OUTSIDE_HEADING,
  CADENCE_OUTSIDE_SENTENCE,
  CADENCE_V2_NOTE,
  SLACK_V3_NOTE,
  cadenceMembers,
  cadenceOutsideSundayPool,
  resolveRulePersonId,
  type RosterMember,
} from "../sundayCadence";
import { rulePersonNamesMember } from "../memberRuleNames";
import type { PersonRestriction, SolverConfig } from "@/app/components/admin/plannerModel";

const member = (_id: string, member_name: string, extra: Partial<RosterMember> = {}): RosterMember => ({
  _id, member_name, memberType: ["voz", "sunday_lead"], ...extra,
});
const ANA = member("m-ana", "Ana Ruiz", { alias: "Ana" });
const BRUNO = member("m-bruno", "Bruno Díaz", { alias: "Bruno" });
const CARLA = member("m-carla", "Carla Soto");
const WORSHIP = [ANA, BRUNO, CARLA];
const KIDS_ANA = member("m-kids-ana", "Ana Pérez", { alias: "Ana", ministries: ["kids"] });
const KIDS_ONLY = member("m-kids-dora", "Dora León", { ministries: ["kids"] });

const rule = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...patch,
});
const cadence = (id: string, person: string) => rule(id, person, { sundayCadence: "alternate" });
const config = (restrictions: PersonRestriction[], sundayLeads: string[] = []): Pick<SolverConfig, "restrictions" | "sundayLeads"> => ({
  restrictions, sundayLeads,
});

describe("resolveRulePersonId — exactly one (C3 T9)", () => {
  it("one match ⇒ its id; by member_name or by alias", () => {
    expect(resolveRulePersonId("Ana", WORSHIP)).toEqual({ ok: true, id: "m-ana" });
    expect(resolveRulePersonId("Carla Soto", WORSHIP)).toEqual({ ok: true, id: "m-carla" });
  });

  it("no match ⇒ `unresolved`, with no matches", () => {
    expect(resolveRulePersonId("Zoe", WORSHIP)).toEqual({ ok: false, reason: "unresolved", matches: [] });
  });

  it("a member_name equal to another's alias ⇒ `ambiguous` with both ids, sorted", () => {
    const roster = [...WORSHIP, member("m-ana2", "Ana")];
    expect(resolveRulePersonId("Ana", roster)).toEqual({ ok: false, reason: "ambiguous", matches: ["m-ana", "m-ana2"] });
  });

  it("two equal aliases ⇒ `ambiguous`", () => {
    const roster = [...WORSHIP, member("m-bruno2", "Bruno Gil", { alias: "Bruno" })];
    expect(resolveRulePersonId("bruno", roster)).toEqual({ ok: false, reason: "ambiguous", matches: ["m-bruno", "m-bruno2"] });
  });

  it("case and trim behave exactly as `rulePersonNamesMember`", () => {
    for (const text of ["ana", "  ANA ", "Ana Ruiz", " ana ruiz", "An a", ""]) {
      const expected = WORSHIP.filter((m) => rulePersonNamesMember(text, m)).map((m) => m._id);
      const got = resolveRulePersonId(text, WORSHIP);
      expect(got.ok ? [got.id] : got.matches, JSON.stringify(text)).toEqual(expected);
    }
  });

  it("applies NO `voz`, pool or Tipo filter: a namesake without Tipo still makes the name ambiguous", () => {
    const roster = [...WORSHIP, member("m-ana3", "Ana Gómez", { alias: "Ana", memberType: [] })];
    expect(resolveRulePersonId("Ana", roster)).toMatchObject({ ok: false, reason: "ambiguous" });
  });
});

describe("the worship filter is applied inside (C3 T9, E25)", () => {
  it("a worship member plus a kids-only namesake ⇒ the worship id, not `ambiguous`", () => {
    expect(resolveRulePersonId("Ana", [...WORSHIP, KIDS_ANA])).toEqual({ ok: true, id: "m-ana" });
  });

  it("a name matching only a kids-only member ⇒ `unresolved`", () => {
    expect(resolveRulePersonId("Dora León", [...WORSHIP, KIDS_ONLY])).toEqual({ ok: false, reason: "unresolved", matches: [] });
  });

  it("`ministries` absent, `[]` and `[\"worship\",\"kids\"]` are all worship", () => {
    for (const ministries of [undefined, [], ["worship", "kids"]]) {
      expect(resolveRulePersonId("Ana", [member("m-ana", "Ana Ruiz", { alias: "Ana", ministries })]))
        .toEqual({ ok: true, id: "m-ana" });
    }
  });

  it("one config gives one answer for a worship admin's roster and a super-admin's", () => {
    const c = config([cadence("r-1", "Ana"), cadence("r-2", "Dora León"), cadence("r-3", "Bruno")]);
    const worshipAdmin = WORSHIP;
    const superAdmin = [...WORSHIP, KIDS_ANA, KIDS_ONLY];
    expect(cadenceMembers(c, superAdmin)).toEqual(cadenceMembers(c, worshipAdmin));
    expect(cadenceOutsideSundayPool(c, superAdmin)).toEqual(cadenceOutsideSundayPool(c, worshipAdmin));
    expect(resolveRulePersonId("Ana", superAdmin)).toEqual(resolveRulePersonId("Ana", worshipAdmin));
  });
});

describe("cadenceMembers (C3 T9)", () => {
  it("is the union over every «Mes por medio» restriction, each id once, sorted", () => {
    const c = config([
      cadence("r-1", "Carla Soto"),
      cadence("r-2", "Ana"),
      cadence("r-3", "ana ruiz"), // another spelling of Ana
      rule("r-4", "Bruno"), // «Normal»: not a cadence member
    ]);
    expect(cadenceMembers(c, WORSHIP)).toEqual({ ids: ["m-ana", "m-carla"], refusals: [] });
  });

  it("names every refused person text once, never guessing", () => {
    const roster = [...WORSHIP, member("m-bruno2", "Bruno Gil", { alias: "Bruno" })];
    const c = config([cadence("r-1", "Zoe"), cadence("r-2", "Bruno"), cadence("r-3", "Zoe"), cadence("r-4", "Ana")]);
    expect(cadenceMembers(c, roster)).toEqual({
      ids: ["m-ana"],
      refusals: [
        { person: "Zoe", reason: "unresolved", matches: [] },
        { person: "Bruno", reason: "ambiguous", matches: ["m-bruno", "m-bruno2"] },
      ],
    });
  });
});

describe("cadenceOutsideSundayPool (C3 T10)", () => {
  const NO_VOZ = member("m-eva", "Eva Luna", { memberType: ["sunday_lead"] });
  const SUPPORT = member("m-fer", "Fernando Gil", { alias: "Fer", memberType: ["voz", "support"] });
  const NO_TIPO = member("m-gina", "Gina Ortiz", { memberType: [] });
  const NO_TIPO_FIELD: RosterMember = { _id: "m-hugo", member_name: "Hugo Vela" };
  const ROSTER = [...WORSHIP, NO_VOZ, SUPPORT, NO_TIPO, NO_TIPO_FIELD];

  it("`not_ticked`: fits the Sunday pool by Tipo but is not in «Líderes Domingo»", () => {
    expect(cadenceOutsideSundayPool(config([cadence("r", "Ana")], ["m-carla"]), ROSTER)).toEqual([
      { id: "m-ana", name: "Ana", reason: "not_ticked" },
    ]);
  });

  it("ticked with a fitting Tipo ⇒ absent", () => {
    expect(cadenceOutsideSundayPool(config([cadence("r", "Ana")], ["m-ana"]), ROSTER)).toEqual([]);
  });

  it("`no_sunday_lead_tipo`: a Tipo without «Líder Domingo», ticked or not", () => {
    for (const ticks of [[], ["m-fer"]]) {
      expect(cadenceOutsideSundayPool(config([cadence("r", "Fer")], ticks), ROSTER)).toEqual([
        { id: "m-fer", name: "Fer", reason: "no_sunday_lead_tipo" },
      ]);
    }
  });

  it("«Líder Domingo» without «Voz», even ticked ⇒ `no_sunday_lead_tipo`", () => {
    expect(cadenceOutsideSundayPool(config([cadence("r", "Eva Luna")], ["m-eva"]), ROSTER)).toEqual([
      { id: "m-eva", name: "Eva Luna", reason: "no_sunday_lead_tipo" },
    ]);
  });

  it("a member with no Tipo — `[]` or absent — is never listed, ticked or not (C2 refuses her build)", () => {
    for (const ticks of [[], ["m-gina", "m-hugo"]]) {
      expect(cadenceOutsideSundayPool(config([cadence("r-1", "Gina Ortiz"), cadence("r-2", "Hugo Vela")], ticks), ROSTER)).toEqual([]);
    }
  });

  it("refused names are not listed (they have their own surfaces)", () => {
    const roster = [...ROSTER, member("m-ana2", "Ana")];
    expect(cadenceOutsideSundayPool(config([cadence("r-1", "Ana"), cadence("r-2", "Zoe")]), roster)).toEqual([]);
  });

  it("a name matching only a kids-only member is absent", () => {
    expect(cadenceOutsideSundayPool(config([cadence("r", "Dora León")]), [...ROSTER, KIDS_ONLY])).toEqual([]);
  });

  it("lists in id order", () => {
    const got = cadenceOutsideSundayPool(config([cadence("r-1", "Fer"), cadence("r-2", "Carla Soto"), cadence("r-3", "Ana")]), ROSTER);
    expect(got.map((x) => x.id)).toEqual(["m-ana", "m-carla", "m-fer"]);
  });
});

describe("the copy C6 gates (C3 §7 item 5)", () => {
  it("has one wording", () => {
    expect(CADENCE_V2_NOTE).toBe("aplica con el nuevo solver");
    expect(SLACK_V3_NOTE).toBe("no aplica con el nuevo solver");
    expect(CADENCE_OUTSIDE_HEADING).toBe("Mes por medio fuera de Líderes Domingo");
    expect(CADENCE_OUTSIDE_SENTENCE.not_ticked("Ana")).toBe(
      "Ana no está en Líderes Domingo: descansa este mes, sin domingo y sin sábado de compensación.",
    );
    expect(CADENCE_OUTSIDE_SENTENCE.no_sunday_lead_tipo("Fer")).toBe(
      "Fer no tiene «Voz» y «Líder Domingo» a la vez en su Tipo: descansa este mes, sin domingo y sin sábado de compensación.",
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/utils/__tests__/sundayCadence.test.ts`
Expected: FAIL — `Error: Cannot find module '../sundayCadence'`.

- [ ] **Step 3: Write the module**

**Create** `app/utils/sundayCadence.ts`:

```ts
// app/utils/sundayCadence.ts
//
// «Domingo: Mes por medio» — who it names, exactly (solver v3 C3 §6.5–§6.7,
// §7 items 4–5). Neutral on purpose (ADR-0028): no "use client", no
// `server-only`, no I/O, so C2's eligibility resolver, the rule panel and C6's
// planner — and, through C2, C4's script and C7's rehearsal — import the same
// code. The names below are a contract C2, C4, C6 and C7 restate; never rename
// one without them.
//
// ─── Exactly one ─────────────────────────────────────────────────────────────
//
// v2 resolves a rule name to its FIRST match (`resolveToMemberName`) and keeps
// doing so (parent A7, A35). Wherever v3 resolves a rule name it uses
// `resolveRulePersonId` instead: the same matching criterion
// (`rulePersonNamesMember` — case-insensitive, trimmed, `member_name` or
// `alias`) plus one condition, exactly one match. Zero is `unresolved`, two or
// more `ambiguous`; neither is ever guessed.
//
// ─── Over which roster ───────────────────────────────────────────────────────
//
// The UNFILTERED worship roster: no `voz`, pool or Tipo filter, because each
// can hide a true namesake and turn an ambiguous name into a resolved one. But
// every function here drops non-worship members ITSELF (`normalizeMinistries`,
// the one reader of the storage contract): the planner's `members` is
// worship-only for a worship admin and everyone, kids-only included, for a
// super-admin (C3 E25), and one config must resolve the same for both. Callers
// pass members with their stored `ministries` as read — a list stripped of the
// field would read as all-worship (absent = worship).

import { normalizeMinistries } from "@/app/ministries";
import { displayMemberName, rulePersonNamesMember } from "./memberRuleNames";
import { MEMBER_TYPE_LABEL } from "./memberTypes";
import { memberFitsPool, type SolverConfig } from "@/app/components/admin/plannerModel";

/** A roster member as read. `ministries` is the stored value; absent or empty means worship. */
export type RosterMember = {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  ministries?: unknown;
};

/** Why a name does not name exactly one worship member. */
export type NameRefusal = { person: string; reason: "unresolved" | "ambiguous"; matches: string[] };

export type CadenceOutsideReason = "not_ticked" | "no_sunday_lead_tipo";

const worshipOnly = (roster: RosterMember[]) =>
  roster.filter((m) => normalizeMinistries(m.ministries).includes("worship"));

/**
 * The one member a rule name names, or why not. `matches` holds the matching
 * ids, unique and sorted (empty for `unresolved`).
 */
export function resolveRulePersonId(
  person: string,
  roster: RosterMember[],
):
  | { ok: true; id: string }
  | { ok: false; reason: "unresolved" | "ambiguous"; matches: string[] } {
  const matches = [
    ...new Set(
      worshipOnly(roster)
        // `member_name` is not required by the Studio schema: absent never matches.
        .filter((m) => rulePersonNamesMember(person, { member_name: m.member_name ?? "", alias: m.alias }))
        .map((m) => m._id),
    ),
  ].sort();
  if (matches.length === 1) return { ok: true, id: matches[0] };
  return { ok: false, reason: matches.length === 0 ? "unresolved" : "ambiguous", matches };
}

/**
 * The members every «Mes por medio» restriction names — the union, each id once,
 * sorted — and one refusal per distinct `person` text that does not name exactly
 * one worship member. The consumer decides what a refusal blocks (C2 refuses
 * the whole v3 build; C6 refuses Auto); a save never does (C3 §6.5).
 */
export function cadenceMembers(
  config: Pick<SolverConfig, "restrictions">,
  roster: RosterMember[],
): { ids: string[]; refusals: NameRefusal[] } {
  const ids = new Set<string>();
  const refusals: NameRefusal[] = [];
  for (const r of config.restrictions) {
    if (r.sundayCadence !== "alternate") continue;
    const resolved = resolveRulePersonId(r.person, roster);
    if (resolved.ok) ids.add(resolved.id);
    else if (!refusals.some((x) => x.person === r.person)) {
      refusals.push({ person: r.person, reason: resolved.reason, matches: resolved.matches });
    }
  }
  return { ids: [...ids].sort(), refusals };
}

/**
 * Resolved cadence members WITH a Tipo who are outside the effective Sunday pool
 * (C3 §6.7), in id order:
 * - `not_ticked` — fits «Líderes Domingo» by Tipo (`memberFitsPool`: `voz` AND
 *   `sunday_lead`) but is not ticked there;
 * - `no_sunday_lead_tipo` — has a Tipo that does not fit it, ticked or not: a
 *   stale tick does not put her in the effective pool.
 * A member with no Tipo is never listed: C2's resolver refuses the whole v3
 * build for her (`no_tipo`) and C6 names her before any solve. Refused names are
 * not listed either; they have their own surfaces.
 *
 * Rendered only under v3, behind the panel's explicit gate (C3 §7 item 6): under
 * v2 the cadence members sit in «Líderes Sábado» by design, and ticking them into
 * «Líderes Domingo» would change v2.
 */
export function cadenceOutsideSundayPool(
  config: Pick<SolverConfig, "restrictions" | "sundayLeads">,
  roster: RosterMember[],
): Array<{ id: string; name: string; reason: CadenceOutsideReason }> {
  const byId = new Map(worshipOnly(roster).map((m) => [m._id, m]));
  const out: Array<{ id: string; name: string; reason: CadenceOutsideReason }> = [];
  for (const id of cadenceMembers(config, roster).ids) {
    const m = byId.get(id);
    if (!m || (m.memberType ?? []).length === 0) continue;
    const name = displayMemberName(m);
    if (!memberFitsPool(m, "sundayLeads")) out.push({ id, name, reason: "no_sunday_lead_tipo" });
    else if (!config.sundayLeads.includes(id)) out.push({ id, name, reason: "not_ticked" });
  }
  return out;
}

// ─── Copy (C3 §6.6–§6.7, §7 item 5) ──────────────────────────────────────────
//
// Exported so C6 gates exactly these strings and every test asserts one wording.

/** Beside the «Mes por medio» chip. Rendered unconditionally by C3; C6 hides it under v3 (CTL-1). */
export const CADENCE_V2_NOTE = "aplica con el nuevo solver";

/** Beside «holgura N» — true under both engines (parent A10, Q2). */
export const SLACK_V3_NOTE = "no aplica con el nuevo solver";

/** The warning's heading. */
export const CADENCE_OUTSIDE_HEADING = "Mes por medio fuera de Líderes Domingo";

/** The warning's two sentences, by reason. Both describe parent A14's `out` state. */
export const CADENCE_OUTSIDE_SENTENCE: Readonly<Record<CadenceOutsideReason, (name: string) => string>> = {
  not_ticked: (name) =>
    `${name} no está en Líderes Domingo: descansa este mes, sin domingo y sin sábado de compensación.`,
  no_sunday_lead_tipo: (name) =>
    `${name} no tiene «${MEMBER_TYPE_LABEL.voz}» y «${MEMBER_TYPE_LABEL.sunday_lead}» a la vez en su Tipo: ` +
    "descansa este mes, sin domingo y sin sábado de compensación.",
};
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run app/utils/__tests__/sundayCadence.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 5: Stop the planner's member types erasing `ministries`**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
  /** Declared instrument seats; absent or empty = declares nothing (spec D6). */
  instruments?: string[];
  unavailableDates?: string[];
}

const dn = (m: MemberOption)
```

**Replace with:**

```tsx
  /** Declared instrument seats; absent or empty = declares nothing (spec D6). */
  instruments?: string[];
  unavailableDates?: string[];
  /**
   * The stored value as `/api/admin/members` projects it (absent or empty =
   * worship). Typed so it reaches `sundayCadence.ts` intact: its resolver drops
   * non-worship members itself, and a super-admin's roster includes them (C3 E25).
   */
  ministries?: unknown;
}

const dn = (m: MemberOption)
```

**Find** in `app/components/admin/serviceCardModel.ts`:

```ts
  unavailableDates?: string[];
  unavailabilityNotes?: { date: string; note: string }[];
  /**
   * Stable stored `_key` of the seat
```

**Replace with:**

```ts
  unavailableDates?: string[];
  unavailabilityNotes?: { date: string; note: string }[];
  /**
   * The stored value as `/api/admin/members` projects it (absent or empty =
   * worship); carried so the planner hands it to `sundayCadence.ts` intact (C3 E25).
   */
  ministries?: unknown;
  /**
   * Stable stored `_key` of the seat
```

The members route already projects `ministries` (`app/api/admin/members/route.ts:24`) and `ServicesPanel` passes the objects through unfiltered (`ServicesPanel.tsx:435`, `:990`, `:1041`), so no runtime change is needed: the type stops erasing the field. Task 10's test declares its members with the component's prop type, so `tsc` refuses `ministries` if either widening is lost.

- [ ] **Step 6: Regenerate the colour inventory (a new file under `app/`)**

Run: `node scripts/colour-inventory.mjs`
Expected: `colour-inventory: 317 literal rows, 22 compositing classes, 11 pairs → app/utils/__tests__/__fixtures__/colour-inventory.json`, and `git diff --stat` shows the fixture changed (`filesScanned` 413 → 414 on a `20fd3367` base; some `line` values move with `MonthGenerator.tsx`). Without it `colourInventory.test.ts` fails on `filesScanned`.

- [ ] **Step 7: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add app/utils/sundayCadence.ts app/utils/__tests__/sundayCadence.test.ts app/components/admin/MonthGenerator.tsx app/components/admin/serviceCardModel.ts app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(solver): resolve rule names to exactly one worship member" -m "C3 §6.5–§6.7: resolveRulePersonId, cadenceMembers and cadenceOutsideSundayPool in a neutral module C2, C6 and the rule panel share. Exactly one match or a named refusal (unresolved, ambiguous), never a guess; over the unfiltered roster, because a voz, pool or Tipo filter can hide a true namesake — minus non-worship members, which the functions drop themselves because the planner's roster includes kids-only members for a super-admin. The planner's member types carry ministries so it reaches them intact. v2 keeps its first-match resolution."
```

---

## Task 9: «Domingo: Normal / Mes por medio» — the form, the card, the «Holgura» notes

Spec R5, R7, §6.3 (settles to «Guardado»), §6.6, §6.8, §11 (the form's data path survives the UI-only rollback); T11. The control is a `SegmentedControl` (one-of-N). **The data path is not the control:** `sundayCadence` is form state seeded from `initialValues` and spread into `onAdd`, and `canAdd` accepts it alone — so the rollback can delete the control's JSX and keep both.

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx:3` (React import), `:62` (imports), `:570-607` (`RestrictionCard`), `:646-676` (`PersonRestrictionForm` state, `canAdd`, `handleAdd`), `:748-755` (Holgura help, then the new «Domingo» block)
- Test: `app/components/admin/__tests__/MonthGenerator.cadence.test.tsx` (create)

**Interfaces:**
- Consumes: `CADENCE_V2_NOTE`, `SLACK_V3_NOTE` (Task 8); `SegmentedControl` (`app/components/ui/SegmentedControl.tsx`: `labelledBy`, `value`, `onChange`, `options`, `size`; renders `role="radiogroup"` with `role="radio"` options); `readyRules` (Task 5).
- Produces: in `PersonRestrictionForm`, the state `sundayCadence: PersonRestriction["sundayCadence"]` and `canAdd = !!person && (… || sundayCadence === "alternate")`; `onAdd` spreads `{ sundayCadence }` only for `"alternate"`. Task 11 extends the same `canAdd`. `RestrictionCard` renders the chip «Mes por medio» and, in its own sibling span, `CADENCE_V2_NOTE` (C6 hides that span under v3); the Holgura chip reads `holgura N · ${SLACK_V3_NOTE}`.

- [ ] **Step 1: Write the failing tests**

**Create** `app/components/admin/__tests__/MonthGenerator.cadence.test.tsx`:

```tsx
/** @vitest-environment jsdom */
// Solver v3 C3 §6.6 and §6.8 — «Domingo: Normal / Mes por medio» in the rule
// form, its chip on the card, and the «Holgura» notes (T11).
//
// Two kinds of test live here and the difference is load-bearing (C3 §11):
//
//   · CONTROL tests select something in the «Domingo» control. They go away
//     with the UI-only rollback, which removes the control.
//   · EDIT-PATH tests never touch the control: they open a stored restriction,
//     save the form, and assert the restriction came back unchanged. They are
//     what keeps the field alive after that rollback — the form builds its
//     result from its own state (`PersonRestrictionForm`'s `onAdd`), so a form
//     that stopped carrying `sundayCadence` would write the restriction without
//     it on the first edit, and the version guard would not stop it. They must
//     pass UNMODIFIED on the rollback; editing them is a full revert.
//
// Every edit-path test proves the round trip twice: the save bar settles on
// «Guardado» (content-equal, `sameSolverConfig`), and the payload «Guardar
// reglas» posts — after an unrelated pool tick makes it dirty — carries the
// restriction deep-equal to the one opened.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules, type RulesHarness } from "./rulesHarness";
import { AdminProviders } from "./providersHarness";
import { CADENCE_V2_NOTE, SLACK_V3_NOTE } from "@/app/utils/sundayCadence";
import type { PersonRestriction, SolverConfig } from "../plannerModel";

afterEach(cleanup);

const members = [
  { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "support"] },
];

const EVERY_FIELD: PersonRestriction = {
  id: "r-ana", person: "Ana",
  excludedPatterns: ["Sat.*"],
  fairness: "slack", fairnessSlack: 2,
  weekExclusions: [{ id: "w-1", week: 3, pattern: "*.*" }],
  caps: [{ id: "c-1", pattern: "Sun.BGV", op: "<=", value: 0, relative: true, relOffset: 2 }],
  sundayCadence: "alternate",
};
const CADENCE_ONLY: PersonRestriction = {
  id: "r-ana", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1,
  weekExclusions: [], caps: [], sundayCadence: "alternate",
};
const NORMAL: PersonRestriction = {
  id: "r-bruno", person: "Bruno", excludedPatterns: ["Sun.Lead"], fairness: "none", fairnessSlack: 1,
  weekExclusions: [], caps: [],
};
const configWith = (...restrictions: PersonRestriction[]): SolverConfig => ({
  sundayLeads: [], saturdayLeads: [], support: [], restrictions, conflicts: [], presence: [],
});

function renderGen(config: SolverConfig, rules: RulesHarness = readyRules(config)) {
  const view = render(
    <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} rules={rules} />,
    { wrapper: AdminProviders },
  );
  return { ...view, rules };
}

const card = (text: RegExp) => {
  const el = screen.getAllByTitle("Editar")
    .map((b) => b.closest("div.rounded-lg") as HTMLElement)
    .find((e) => text.test(e.textContent ?? ""));
  if (!el) throw new Error(`no rule card matching ${text}`);
  return el;
};
const openEditor = (text: RegExp) => fireEvent.click(within(card(text)).getByTitle("Editar"));
const saveBar = () => screen.getByRole("button", { name: /Guardar reglas|Guardando|Guardado/ });
const domingo = () => screen.getByRole("radiogroup", { name: "Domingo" });

/** Make the document dirty WITHOUT touching any rule, then post it. */
async function postAfterPoolTick(rules: RulesHarness): Promise<SolverConfig> {
  fireEvent.click(screen.getByRole("checkbox", { name: "Ana" }));
  fireEvent.click(saveBar());
  await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(1));
  return rules.save.mock.calls[0][0] as SolverConfig;
}

describe("edit path — survives the UI-only rollback unmodified (C3 §11, T11)", () => {
  it("a restriction carrying every field the type has comes back deep-equal", async () => {
    const { rules } = renderGen(configWith(EVERY_FIELD));
    openEditor(/Ana/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(saveBar().textContent).toMatch(/Guardado/);
    const saved = await postAfterPoolTick(rules);
    expect(saved.restrictions).toEqual([EVERY_FIELD]);
  });

  it("a cadence-only restriction can be saved from its editor, and keeps the field", async () => {
    const { rules } = renderGen(configWith(CADENCE_ONLY));
    openEditor(/Ana/);
    const save = screen.getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(saveBar().textContent).toMatch(/Guardado/);
    const saved = await postAfterPoolTick(rules);
    expect(saved.restrictions).toEqual([CADENCE_ONLY]);
  });

  it("«Normal» leaves no key", async () => {
    const { rules } = renderGen(configWith(NORMAL));
    openEditor(/Bruno/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const saved = await postAfterPoolTick(rules);
    expect(saved.restrictions[0]).not.toHaveProperty("sundayCadence");
    expect(saved.restrictions).toEqual([NORMAL]);
  });
});

describe("the «Domingo» control (C3 §6.6, T11 — removed with the control on the UI-only rollback)", () => {
  it("offers Normal / Mes por medio, «Normal» for a new restriction", () => {
    renderGen(configWith());
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    const group = domingo();
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Normal", "Mes por medio"]);
    expect(within(group).getByRole("radio", { name: "Normal" }).getAttribute("aria-checked")).toBe("true");
  });

  it("«Mes por medio» alone makes a new restriction addable, explains itself, and saves the field", async () => {
    const { rules, container } = renderGen(configWith());
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    const add = () => screen.getByRole("button", { name: "Agregar restricción" }) as HTMLButtonElement;
    expect(add().disabled).toBe(true);

    fireEvent.click(within(domingo()).getByRole("radio", { name: "Mes por medio" }));
    expect(add().disabled).toBe(false);
    expect(screen.getByText(/Si el mes anterior no dirigió domingo, está en Líderes Domingo y puede al menos un domingo/)).toBeTruthy();
    expect(screen.getByText(/Aplica con el nuevo solver; el solver actual no lo usa\./)).toBeTruthy();

    fireEvent.click(add());
    expect(container.textContent).toContain("Mes por medio");
    fireEvent.click(saveBar());
    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(1));
    const saved = rules.save.mock.calls[0][0] as SolverConfig;
    expect(saved.restrictions).toHaveLength(1);
    expect(saved.restrictions[0]).toMatchObject({
      person: "Ana", sundayCadence: "alternate", excludedPatterns: [], weekExclusions: [], caps: [], fairness: "none",
    });
  });

  it("is initialised from the edited restriction", () => {
    renderGen(configWith(CADENCE_ONLY));
    openEditor(/Ana/);
    expect(within(domingo()).getByRole("radio", { name: "Mes por medio" }).getAttribute("aria-checked")).toBe("true");
  });

  it("toggling on and back off settles to «Guardado»", () => {
    renderGen(configWith(NORMAL));
    openEditor(/Bruno/);
    fireEvent.click(within(domingo()).getByRole("radio", { name: "Mes por medio" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(saveBar().textContent).toMatch(/Guardar reglas/);

    openEditor(/Bruno/);
    fireEvent.click(within(domingo()).getByRole("radio", { name: "Normal" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(saveBar().textContent).toMatch(/Guardado/);
  });
});

describe("the card and the «Holgura» notes (C3 §6.6, §6.8, T11)", () => {
  it("shows «Mes por medio» followed by its note", () => {
    renderGen(configWith(CADENCE_ONLY));
    const chip = within(card(/Ana/)).getByText("Mes por medio");
    expect(chip.nextElementSibling?.textContent).toBe(CADENCE_V2_NOTE);
  });

  it("shows no cadence chip on a «Normal» card", () => {
    renderGen(configWith(NORMAL));
    expect(within(card(/Bruno/)).queryByText("Mes por medio")).toBeNull();
  });

  it("the Holgura chip says it does not apply to the new solver", () => {
    renderGen(configWith(EVERY_FIELD));
    expect(within(card(/Ana/)).getByText(`holgura 2 · ${SLACK_V3_NOTE}`)).toBeTruthy();
  });

  it("the Holgura help gains «No aplica con el nuevo solver.» and keeps its specials sentence", () => {
    renderGen(configWith(EVERY_FIELD));
    openEditor(/Ana/);
    const help = screen.getByText(/puede alejarse hasta 2 servicios de la del resto/);
    expect(help.textContent).toContain("No aplica con el nuevo solver.");
    expect(help.textContent).toContain("Al llenar especiales cuenta como si llevara 2 más.");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/MonthGenerator.cadence.test.tsx`
Expected: FAIL — 9 tests: the two edit-path tests carrying the cadence (the form drops `sundayCadence`, so the bar reads «Guardar reglas», not «Guardado», and the cadence-only editor's «Guardar cambios» is disabled), every control test (`Unable to find role="radiogroup" and name "Domingo"`), the chip, and both Holgura notes. ««Normal» leaves no key» and «shows no cadence chip on a «Normal» card» already pass.

- [ ] **Step 3: Imports**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
```

**Replace with:**

```tsx
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
import Select from "@/app/components/ui/Select";
```

**Replace with:**

```tsx
import Select from "@/app/components/ui/Select";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import { CADENCE_V2_NOTE, SLACK_V3_NOTE } from "@/app/utils/sundayCadence";
```

- [ ] **Step 4: The card — the chip, its note, and the Holgura note**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
          {r.fairness === "slack" && (
            <span className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-recency-fg/15 text-recency-strong border border-recency-fg/30">
              holgura {r.fairnessSlack}
            </span>
          )}
        </div>
```

**Replace with:**

```tsx
          {r.fairness === "slack" && (
            <span className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-recency-fg/15 text-recency-strong border border-recency-fg/30">
              {`holgura ${r.fairnessSlack} · ${SLACK_V3_NOTE}`}
            </span>
          )}
          {/* C3 §6.6: the note is its own span so C6 can hide it under v3 (CTL-1). */}
          {r.sundayCadence === "alternate" && (
            <>
              <span className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">
                Mes por medio
              </span>
              <span className="font-body text-[10px] text-mono-500 self-center">{CADENCE_V2_NOTE}</span>
            </>
          )}
        </div>
```

- [ ] **Step 5: The form's data path — state, `canAdd`, `onAdd`**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
  const [caps,     setCaps]     = useState<PersonRestriction["caps"]>(initialValues?.caps ?? []);

  const toggleExcl = (pat: string) =>
    setExcl(e => e.includes(pat) ? e.filter(x => x !== pat) : [...e, pat]);

  const canAdd = !!person && (excl.length > 0 || weekEx.length > 0 || caps.length > 0 || fairness !== "none");
```

**Replace with:**

```tsx
  const [caps,     setCaps]     = useState<PersonRestriction["caps"]>(initialValues?.caps ?? []);
  // «Domingo» (solver v3 C3 §6.6). Seeded from the edited restriction and carried
  // to `onAdd` whether or not the control below is rendered: the UI-only
  // rollback removes the CONTROL, never this data path (C3 §11).
  const [sundayCadence, setSundayCadence] = useState<PersonRestriction["sundayCadence"]>(initialValues?.sundayCadence);
  const cadenceLabelId = useId();

  const toggleExcl = (pat: string) =>
    setExcl(e => e.includes(pat) ? e.filter(x => x !== pat) : [...e, pat]);

  // A restriction may carry «Mes por medio» alone (C3 §6.6).
  const canAdd = !!person && (excl.length > 0 || weekEx.length > 0 || caps.length > 0 || fairness !== "none" || sundayCadence === "alternate");
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
    onAdd({ id: initialValues?.id ?? uid(), person, excludedPatterns: excl, fairness, fairnessSlack: slack, weekExclusions: weekEx, caps });
  };
```

**Replace with:**

```tsx
    onAdd({
      id: initialValues?.id ?? uid(), person, excludedPatterns: excl, fairness, fairnessSlack: slack, weekExclusions: weekEx, caps,
      // «Normal» is NO key — never `sundayCadence: undefined` (C3 §6.1).
      ...(sundayCadence === "alternate" ? { sundayCadence } : {}),
    });
  };
```

- [ ] **Step 6: The Holgura sentence and the «Domingo» control**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
            {slack >= 1
              ? `En Auto de fin de semana su carga total del mes puede alejarse hasta ${slack} servicio${slack === 1 ? "" : "s"} de la del resto. Al llenar especiales cuenta como si llevara ${slack} más.`
              : "Con 0 no tiene efecto: escribe un número del 1 al 5."}
          </p>
        )}
      </div>
```

**Replace with:**

```tsx
            {slack >= 1
              ? `En Auto de fin de semana su carga total del mes puede alejarse hasta ${slack} servicio${slack === 1 ? "" : "s"} de la del resto. No aplica con el nuevo solver. Al llenar especiales cuenta como si llevara ${slack} más.`
              : "Con 0 no tiene efecto: escribe un número del 1 al 5."}
          </p>
        )}
      </div>

      {/* «Domingo» — solver v3 C3 §6.6. A one-of-N choice, so `SegmentedControl`. */}
      <div>
        <p id={cadenceLabelId} className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1">Domingo</p>
        <SegmentedControl
          labelledBy={cadenceLabelId}
          size="sm"
          value={sundayCadence === "alternate" ? "alternate" : "normal"}
          onChange={v => setSundayCadence(v === "alternate" ? "alternate" : undefined)}
          options={[
            { value: "normal", label: "Normal" },
            { value: "alternate", label: "Mes por medio" },
          ]}
        />
        {sundayCadence === "alternate" && (
          <p className="font-body text-[11px] text-mono-500 mt-1">
            Si el mes anterior no dirigió domingo, está en Líderes Domingo y puede al menos un domingo, ese mes
            le toca uno; en otro caso descansa y, si no dirige domingo, de preferencia dirige un sábado. Fuera
            de Líderes Domingo no le toca ni domingo ni sábado de compensación. Aplica con el nuevo solver; el
            solver actual no lo usa.
          </p>
        )}
      </div>
```

The sentence sits between the weekend-solver sentence and the specials sentence, so «No aplica con el nuevo solver.» reads about the solver only; the specials filler keeps Exenta/Holgura under v3 (parent A10; spec §6.8). The «Mes por medio» help paragraph's closing sentence «Aplica con el nuevo solver; el solver actual no lo usa.» is inline text, not `CADENCE_V2_NOTE` (whose only use is the card chip): C6 does not gate it, and C7's flip PR deletes it and updates the control test that asserts it (C7 plan Step 5, its S8 rule).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/MonthGenerator.cadence.test.tsx app/components/admin/__tests__/MonthGenerator.ruleEdit.test.tsx`
Expected: PASS (20 tests) — the existing rule-edit suite unedited.

- [ ] **Step 8: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add app/components/admin/MonthGenerator.tsx app/components/admin/__tests__/MonthGenerator.cadence.test.tsx
git commit -m "feat(planner): «Domingo: Normal / Mes por medio» in the rule form" -m "C3 §6.6: a SegmentedControl below «Equidad»; a restriction may carry «Mes por medio» alone; the card shows the chip and, in its own span, «aplica con el nuevo solver» for C6 to gate. The cadence is form state seeded from the edited restriction and carried to onAdd whether or not the control renders, so the UI-only rollback can remove the control without the first edit of a cadence card erasing the field. «Holgura» says it does not apply to the new solver; its specials sentence stays."
```

---

## Task 10: The name chips and the gated «fuera de Líderes Domingo» warning

Spec R4/R6, §6.5–§6.7, §7 item 6; T10 (panel), T11 (chips). Review-log item 10. The chips resolve over the panel's `members` — the planner's **unfiltered** roster — never over the `voz` list `RuleBuilder` offers as names (E13, `MonthGenerator.tsx:1751`); the resolver drops non-worship members itself, so a super-admin and a worship admin see the same chips (E25). The warning sits behind `showCadencePoolWarning`, default `false`; C3 never opens it.

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx` — the `sundayCadence` import (Task 9's line), `Props` (`:146-228`), `RestrictionCard` (`:570`), `RuleBuilder` (`:1004-1018`, `:1121-1123`), `SolverConfigPanel` (`:1618-1635`, before `:1736`, `:1748-1753`), `MonthGenerator`'s parameters (`:1791-1794`) and its `<SolverConfigPanel>` (`:4204-4214`)
- Test: `app/components/admin/__tests__/MonthGenerator.cadenceWarning.test.tsx` (create)

**Interfaces:**
- Consumes: `resolveRulePersonId`, `cadenceOutsideSundayPool`, `CADENCE_OUTSIDE_HEADING`, `CADENCE_OUTSIDE_SENTENCE` (Task 8); `RestrictionCard`, `RuleBuilder`, `SolverConfigPanel` (Task 9's state of the file).
- Produces:
  - `MonthGenerator`'s `Props.showCadencePoolWarning?: boolean` (default `false`) threaded to `SolverConfigPanel` — **the warning's gate of spec §7 item 6**. C6 passes its server-resolved `effectiveEngine === "v3"` (never `SOLVER_ENGINE`) and keeps it closed for a record-bound month (C6 WN-1).
  - Module-private `type CadenceNameIssue = { reason: "unresolved" | "ambiguous"; n: number }` and `cadenceNameChip(issue): string` — «Nombre ambiguo: coincide con {n} personas» / «Nombre no reconocido en Alabanza».
  - `RuleBuilder` takes `cadenceNameIssues: ReadonlyMap<string, CadenceNameIssue>` (restriction id → issue), computed by `SolverConfigPanel`; `RestrictionCard` takes `nameIssue?: CadenceNameIssue` and renders it only on a «Mes por medio» card. Task 11 adds one more prop to each.

- [ ] **Step 1: Write the failing tests**

**Create** `app/components/admin/__tests__/MonthGenerator.cadenceWarning.test.tsx`:

```tsx
/** @vitest-environment jsdom */
// Solver v3 C3 §6.6–§6.7 — the name chips on a «Mes por medio» card and the
// «Mes por medio fuera de Líderes Domingo» warning (T10, T11).
//
// The chips read the planner's UNFILTERED roster — never `RuleBuilder`'s
// `voz`-filtered person list (E13) — through `resolveRulePersonId`, which drops
// non-worship members itself, so a super-admin (whose roster includes kids-only
// members, E25) sees the same chips a worship admin does. The warning renders
// only behind an explicit input that defaults to CLOSED: under v2 the cadence
// members sit in «Líderes Sábado» by design, and the warning would invite the
// one action that changes v2. C6 opens it under v3.
import type { ComponentProps } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules } from "./rulesHarness";
import { AdminProviders } from "./providersHarness";
import { CADENCE_OUTSIDE_HEADING, CADENCE_OUTSIDE_SENTENCE } from "@/app/utils/sundayCadence";
import type { PersonRestriction, SolverConfig } from "../plannerModel";

afterEach(cleanup);

type Members = ComponentProps<typeof MonthGenerator>["members"];

// Annotated, so `tsc` refuses `ministries` unless the planner's member type
// carries it (C3 §5: the type stops erasing the field at the resolver's door).
const WORSHIP: Members = [
  { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "support"], ministries: ["worship"] },
  { _id: "m-carla", member_name: "Carla Soto", alias: "Carla", memberType: ["voz", "sunday_lead"], ministries: [] },
];
const KIDS_ANA: Members[number] = { _id: "m-kids-ana", member_name: "Ana Pérez", alias: "Ana", ministries: ["kids"] };
const KIDS_DORA: Members[number] = { _id: "m-kids-dora", member_name: "Dora León", ministries: ["kids"] };

const rule = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...patch,
});
const cadence = (id: string, person: string) => rule(id, person, { sundayCadence: "alternate" });
const configWith = (restrictions: PersonRestriction[], sundayLeads: string[] = []): SolverConfig => ({
  sundayLeads, saturdayLeads: [], support: [], restrictions, conflicts: [], presence: [],
});

function renderGen(config: SolverConfig, members: Members, extra: Partial<ComponentProps<typeof MonthGenerator>> = {}) {
  return render(
    <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} rules={readyRules(config)} {...extra} />,
    { wrapper: AdminProviders },
  );
}
const card = (text: RegExp) => {
  const el = screen.getAllByTitle("Editar")
    .map((b) => b.closest("div.rounded-lg") as HTMLElement)
    .find((e) => text.test(e.textContent ?? ""));
  if (!el) throw new Error(`no rule card matching ${text}`);
  return el;
};

describe("the name chips on a «Mes por medio» card (C3 §6.6, T11)", () => {
  it("«Nombre ambiguo» when the name matches two worship members", () => {
    const twoAnas: Members = [...WORSHIP, { _id: "m-ana2", member_name: "Ana", memberType: ["voz"] }];
    renderGen(configWith([cadence("r-1", "Ana")]), twoAnas);
    expect(within(card(/Ana/)).getByText("Nombre ambiguo: coincide con 2 personas")).toBeTruthy();
  });

  it("counts the unfiltered roster: a namesake with no `voz` still counts", () => {
    const twoAnas: Members = [...WORSHIP, { _id: "m-ana2", member_name: "Ana", memberType: [] }];
    renderGen(configWith([cadence("r-1", "Ana")]), twoAnas);
    expect(within(card(/Ana/)).getByText("Nombre ambiguo: coincide con 2 personas")).toBeTruthy();
  });

  it("no chip for a name shared only with a kids-only member — whoever is viewing", () => {
    renderGen(configWith([cadence("r-1", "Ana")]), [...WORSHIP, KIDS_ANA]); // a super-admin's roster
    expect(within(card(/Ana/)).queryByText(/Nombre ambiguo/)).toBeNull();
    expect(within(card(/Ana/)).queryByText(/Nombre no reconocido/)).toBeNull();
  });

  it("«Nombre no reconocido en Alabanza» when only a kids-only member matches (v2's first-match banner resolves her)", () => {
    renderGen(configWith([cadence("r-1", "Dora León")]), [...WORSHIP, KIDS_DORA]);
    expect(within(card(/Dora/)).getByText("Nombre no reconocido en Alabanza")).toBeTruthy();
  });

  it("no chip on a «Normal» card, even with an ambiguous name (v2's first match is untouched)", () => {
    const twoAnas: Members = [...WORSHIP, { _id: "m-ana2", member_name: "Ana", memberType: ["voz"] }];
    renderGen(configWith([rule("r-1", "Ana", { excludedPatterns: ["Sat.*"] })]), twoAnas);
    expect(within(card(/Ana/)).queryByText(/Nombre ambiguo/)).toBeNull();
  });
});

describe("«Mes por medio fuera de Líderes Domingo» (C3 §6.7, T10)", () => {
  const config = configWith([cadence("r-1", "Ana"), cadence("r-2", "Bruno"), cadence("r-3", "Carla")], ["m-carla"]);

  it("renders nothing while its gate is closed — the default", () => {
    renderGen(config, WORSHIP);
    expect(screen.queryByText(CADENCE_OUTSIDE_HEADING)).toBeNull();
    expect(screen.queryByText(/descansa este mes/)).toBeNull();
  });

  it("lists each resolved cadence member outside the Sunday pool when the gate is open", () => {
    renderGen(config, WORSHIP, { showCadencePoolWarning: true });
    expect(screen.getByText(CADENCE_OUTSIDE_HEADING)).toBeTruthy();
    expect(screen.getByText(CADENCE_OUTSIDE_SENTENCE.not_ticked("Ana"))).toBeTruthy();
    expect(screen.getByText(CADENCE_OUTSIDE_SENTENCE.no_sunday_lead_tipo("Bruno"))).toBeTruthy();
    expect(screen.queryByText(/^Carla /)).toBeNull(); // ticked, with a fitting Tipo
  });

  it("renders nothing, open or not, when nobody is outside", () => {
    renderGen(configWith([cadence("r-3", "Carla")], ["m-carla"]), WORSHIP, { showCadencePoolWarning: true });
    expect(screen.queryByText(CADENCE_OUTSIDE_HEADING)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/MonthGenerator.cadenceWarning.test.tsx; npx tsc --noEmit`
Expected: FAIL — 4 tests (the two «Nombre ambiguo» chips, «Nombre no reconocido en Alabanza», and the open-gate warning); `tsc` reports `'showCadencePoolWarning' does not exist in type 'Partial<Props>'`. The kids-only, «Normal» card and closed-gate tests already pass.

- [ ] **Step 3: Imports and the gate prop**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
import { CADENCE_V2_NOTE, SLACK_V3_NOTE } from "@/app/utils/sundayCadence";
```

**Replace with:**

```tsx
import {
  CADENCE_OUTSIDE_HEADING,
  CADENCE_OUTSIDE_SENTENCE,
  CADENCE_V2_NOTE,
  SLACK_V3_NOTE,
  cadenceOutsideSundayPool,
  resolveRulePersonId,
} from "@/app/utils/sundayCadence";
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
    rolesGeneration: number;
    integrityGeneration: number;
    reload: () => Promise<boolean>;
  };
}
```

**Replace with:**

```tsx
    rolesGeneration: number;
    integrityGeneration: number;
    reload: () => Promise<boolean>;
  };
  /**
   * The gate of the «Mes por medio fuera de Líderes Domingo» warning (solver v3
   * C3 §6.7, §7 item 6). Defaults to CLOSED and C3 never opens it: under v2 the
   * cadence members sit in «Líderes Sábado» by design, and the warning would
   * invite the one action that changes v2. C6 passes its server-resolved
   * effective engine (`=== "v3"`, never the `SOLVER_ENGINE` constant) and keeps
   * it closed for a record-bound month.
   */
  showCadencePoolWarning?: boolean;
}
```

- [ ] **Step 4: The card's name chip**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
function RestrictionCard({ r, onDelete, onEdit }: { r: PersonRestriction; onDelete: () => void; onEdit: () => void }) {
```

**Replace with:**

```tsx
/**
 * Why a «Mes por medio» card's name does not name exactly one worship member
 * (C3 §6.5–§6.6) — over the planner's UNFILTERED roster, never the form's
 * `voz`-filtered list. `n` is the number of matches.
 */
type CadenceNameIssue = { reason: "unresolved" | "ambiguous"; n: number };

/**
 * The chip for a `CadenceNameIssue`. Shown under both engines: it is about the
 * data, not behaviour. The `unresolved` chip is the plan's addition (C3 review
 * item 10): v2's first-match banner resolves a name that only a kids-only member
 * carries in a super-admin's roster, so without it that name would be silent here.
 */
function cadenceNameChip(issue: CadenceNameIssue): string {
  return issue.reason === "ambiguous"
    ? `Nombre ambiguo: coincide con ${issue.n} personas`
    : "Nombre no reconocido en Alabanza";
}

function RestrictionCard({ r, onDelete, onEdit, nameIssue }: {
  r: PersonRestriction;
  onDelete: () => void;
  onEdit: () => void;
  nameIssue?: CadenceNameIssue;
}) {
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
              <span className="font-body text-[10px] text-mono-500 self-center">{CADENCE_V2_NOTE}</span>
            </>
          )}
        </div>
```

**Replace with:**

```tsx
              <span className="font-body text-[10px] text-mono-500 self-center">{CADENCE_V2_NOTE}</span>
            </>
          )}
          {r.sundayCadence === "alternate" && nameIssue && (
            <span className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-warning-strong/10 text-warning-strong border border-warning-strong/30">
              {cadenceNameChip(nameIssue)}
            </span>
          )}
        </div>
```

- [ ] **Step 5: `RuleBuilder` carries the issues it is handed**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
function RuleBuilder({ config, onChange, members, source }: {
  config: SolverConfig;
  onChange: (c: SolverConfig) => void;
  members: MemberOption[];
```

**Replace with:**

```tsx
function RuleBuilder({ config, onChange, members, source, cadenceNameIssues }: {
  config: SolverConfig;
  onChange: (c: SolverConfig) => void;
  /** The PERSONA dropdown's list — `voz` members. Never what a name is resolved against. */
  members: MemberOption[];
  /** Restriction id → its «Mes por medio» name issue, resolved over the unfiltered roster by the panel. */
  cadenceNameIssues: ReadonlyMap<string, CadenceNameIssue>;
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
          <RestrictionCard key={r.id} r={r}
            onDelete={() => rmRestriction(r.id)}
```

**Replace with:**

```tsx
          <RestrictionCard key={r.id} r={r}
            nameIssue={cadenceNameIssues.get(r.id)}
            onDelete={() => rmRestriction(r.id)}
```

- [ ] **Step 6: `SolverConfigPanel` resolves over the unfiltered roster, and renders the gated warning**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
function SolverConfigPanel({ members, config, onChange, rules, history, onRemoveHistory, year, month, derived }: {
```

**Replace with:**

```tsx
function SolverConfigPanel({ members, config, onChange, rules, history, onRemoveHistory, year, month, derived, showCadencePoolWarning = false }: {
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
  derived?: DerivedHistoryHandle;
}) {
  const [searches, setSearches] = useState<Record<string, string>>({});
```

**Replace with:**

```tsx
  derived?: DerivedHistoryHandle;
  /** C3 §7 item 6 — see `Props.showCadencePoolWarning`. Closed unless C6 opens it. */
  showCadencePoolWarning?: boolean;
}) {
  const [searches, setSearches] = useState<Record<string, string>>({});

  // C3 §6.5–§6.6: a «Mes por medio» name must name exactly one WORSHIP member,
  // judged over `members` as the panel received it — the unfiltered roster —
  // and never over the `voz` list `RuleBuilder` offers as names (E13). The
  // resolver drops non-worship members itself (E25).
  const cadenceNameIssues = new Map<string, CadenceNameIssue>();
  for (const r of config.restrictions) {
    if (r.sundayCadence !== "alternate") continue;
    const resolved = resolveRulePersonId(r.person, members);
    if (!resolved.ok) cadenceNameIssues.set(r.id, { reason: resolved.reason, n: resolved.matches.length });
  }
  // C3 §6.7: computed only behind the gate, so a closed gate costs nothing.
  const cadenceOutside = showCadencePoolWarning ? cadenceOutsideSundayPool(config, members) : [];
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
      {derived ? (
        <DerivedLeadPoolHistory config={config} members={members} history={derived} year={year} month={month} />
```

**Replace with:**

```tsx
      {cadenceOutside.length > 0 && (
        <div className="rounded-lg border border-warning-strong/30 bg-warning-strong/10 px-3 py-2 space-y-1">
          <p className="font-label text-[10px] uppercase tracking-widest text-warning-strong">
            {CADENCE_OUTSIDE_HEADING}
          </p>
          <ul className="space-y-1">
            {cadenceOutside.map(x => (
              <li key={x.id} className="font-body text-xs text-mono-400">
                {CADENCE_OUTSIDE_SENTENCE[x.reason](x.name)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {derived ? (
        <DerivedLeadPoolHistory config={config} members={members} history={derived} year={year} month={month} />
```

The banner reuses the stale-tick banner's style (E14), sits right below it, and carries no action — ticking a cadence member into «Líderes Domingo» is C7's flip step, never a button here.

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
        members={members.filter(m => m.memberType?.includes("voz"))}
        source={rules.source}
      />
```

**Replace with:**

```tsx
        members={members.filter(m => m.memberType?.includes("voz"))}
        source={rules.source}
        cadenceNameIssues={cadenceNameIssues}
      />
```

- [ ] **Step 7: Thread the gate from `MonthGenerator`**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
  initialMonth, focusRoleId, openComposerInitially = false, storedSource, storedCapabilities, onCleared,
}: Props) {
```

**Replace with:**

```tsx
  initialMonth, focusRoleId, openComposerInitially = false, storedSource, storedCapabilities, onCleared,
  showCadencePoolWarning = false,
}: Props) {
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
          derived={derivedMode ? derivedHistory : undefined}
        />
      ) : (
        <SolverConfigUnavailable source={rules.source} onReload={rules.reload} />
```

**Replace with:**

```tsx
          derived={derivedMode ? derivedHistory : undefined}
          showCadencePoolWarning={showCadencePoolWarning}
        />
      ) : (
        <SolverConfigUnavailable source={rules.source} onReload={rules.reload} />
```

`ServicesPanel` passes nothing, so the gate stays closed on every deployment until C6 wires it.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/MonthGenerator.cadenceWarning.test.tsx app/components/admin/__tests__/MonthGenerator.cadence.test.tsx && npx tsc --noEmit`
Expected: PASS (19 tests); no `tsc` output.

- [ ] **Step 9: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add app/components/admin/MonthGenerator.tsx app/components/admin/__tests__/MonthGenerator.cadenceWarning.test.tsx
git commit -m "feat(planner): name chips on «Mes por medio» cards and the gated pool warning" -m "C3 §6.5–§6.7: a «Mes por medio» card whose name matches two worship members says so, resolved over the planner's unfiltered roster — never the voz list the form offers — with kids-only members dropped by the resolver, so every viewer sees the same chip. A name only a kids-only member carries gets «Nombre no reconocido en Alabanza» (review item 10: v2's first-match banner resolves her). The «fuera de Líderes Domingo» warning ships behind showCadencePoolWarning, closed by default: under v2 it would invite the one action that changes v2. C6 opens it under v3."
```

---

## Task 11: The rule form does not produce a second exact count, and a stored pair is not a dead end

Spec R10, §6.2 («The form does not produce it», «A stored overlap is not a dead end»), §6.12 (two rows); T14 (UI part). The form and the panel run the same `exactCapOverlaps` the parser runs (Task 3), so they cannot disagree with the route.

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx` — the React and `solverConfigSource`/`plannerModel` imports, `RestrictionCard` (Task 10's signature), `PersonRestrictionForm` (signature, Task 9's `canAdd`, the cap rows `:810-869`), `RuleBuilder` (`:1041-1042`, `:1094-1098`, `:1118-1119`, the card's props)
- Test: `app/components/admin/__tests__/MonthGenerator.exactOverlap.test.tsx` (create)

**Interfaces:**
- Consumes: `exactCapOverlaps` (Task 3); `capLabel` (`plannerModel.ts:661`); `exactOverlapFormMessage`, `exactOverlapCardMessage` (Task 5); Task 10's `RestrictionCard` and `RuleBuilder`.
- Produces: `PersonRestrictionForm` takes `siblings: PersonRestriction[]` — every other restriction of the on-screen config, in order (the add form: all of them; the edit form: all but the edited one). A cap row whose `==` covers a role another `==` cap already fixes (same card, or a card with the same `person` text) shows `exactOverlapFormMessage({ role, person, rule })` and makes `canAdd` false. `RestrictionCard` takes `exactOverlapRole?: string` and shows `exactOverlapCardMessage(role)`; `RuleBuilder` computes it for both cards of every pair on screen.

- [ ] **Step 1: Write the failing tests**

**Create** `app/components/admin/__tests__/MonthGenerator.exactOverlap.test.tsx`:

```tsx
/** @vitest-environment jsdom */
// Parent A38 in the rule UI (solver v3 C3 §6.2, T14): a person has at most one
// exact (`==`) count per role key. The route refuses a body with two; the form
// does not produce one; and a pair saved before C3 is not a dead end — the panel
// marks both cards, and removing either cap lets the next save through. Form,
// panel and route all run `exactCapOverlaps`, so they cannot disagree.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules, type RulesHarness } from "./rulesHarness";
import { AdminProviders } from "./providersHarness";
import { exactOverlapCardMessage, exactOverlapFormMessage } from "../solverConfigSource";
import { exactCapOverlaps } from "@/app/utils/solverConfigWriteRequest";
import type { PersonRestriction, RestrictionCap, SolverConfig } from "../plannerModel";

afterEach(cleanup);

const members = [
  { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "support"] },
];
const cap = (id: string, pattern: string, op: RestrictionCap["op"], value = 1): RestrictionCap => ({
  id, pattern, op, value, relative: false, relOffset: 0,
});
const rule = (id: string, person: string, caps: RestrictionCap[]): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps,
});
const configWith = (...restrictions: PersonRestriction[]): SolverConfig => ({
  sundayLeads: [], saturdayLeads: [], support: [], restrictions, conflicts: [], presence: [],
});

function renderGen(config: SolverConfig, rules: RulesHarness = readyRules(config)) {
  render(
    <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} rules={rules} />,
    { wrapper: AdminProviders },
  );
  return rules;
}
const cards = () => screen.getAllByTitle("Editar").map((b) => b.closest("div.rounded-lg") as HTMLElement);
const openEditor = (index: number) => fireEvent.click(within(cards()[index]).getByTitle("Editar"));
const saveBar = () => screen.getByRole("button", { name: /Guardar reglas|Guardando|Guardado/ });
const operators = () => screen.getAllByLabelText("Operador") as HTMLSelectElement[];
const patterns = () => screen.getAllByLabelText("Patrón") as HTMLSelectElement[];

describe("the form does not produce a second exact count (C3 T14)", () => {
  it("flags a cap row that repeats an exact count on the same card, and blocks «Agregar»", () => {
    renderGen(configWith());
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    fireEvent.change(operators()[0], { target: { value: "==" } });
    fireEvent.change(patterns()[0], { target: { value: "Sun.Lead" } });
    const add = screen.getByRole("button", { name: "Agregar restricción" }) as HTMLButtonElement;
    expect(add.disabled).toBe(false); // `Sun.Lead == 2` beside `Sun.* <= 2`: fine

    fireEvent.change(operators()[1], { target: { value: "==" } }); // `Sun.* == 2` now fixes Sun.Lead too
    expect(screen.getByText(exactOverlapFormMessage({ role: "Sun.Lead", person: "Ana", rule: "Sun.Lead == 2" }))).toBeTruthy();
    expect(add.disabled).toBe(true);

    fireEvent.change(operators()[1], { target: { value: ">=" } });
    expect(screen.queryByText(/Ya hay un número fijo/)).toBeNull();
    expect(add.disabled).toBe(false);
  });

  it("looks across cards with the same person text", () => {
    renderGen(configWith(rule("r-1", "ana", [cap("c-1", "*.Lead", "==")])));
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    fireEvent.change(operators()[0], { target: { value: "==" } }); // `Sun.* == 2` vs the other card's `*.Lead == 1`
    expect(screen.getByText(exactOverlapFormMessage({ role: "Sun.Lead", person: "Ana", rule: "*.Lead == 1" }))).toBeTruthy();
    expect((screen.getByRole("button", { name: "Agregar restricción" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not look at another person's card", () => {
    renderGen(configWith(rule("r-1", "Bruno", [cap("c-1", "*.Lead", "==")])));
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    fireEvent.change(operators()[0], { target: { value: "==" } });
    expect(screen.queryByText(/Ya hay un número fijo/)).toBeNull();
  });
});

describe("a pair stored before C3 is not a dead end (C3 T14)", () => {
  const STORED_PAIR = configWith(
    rule("r-1", "Ana", [cap("c-1", "Sun.*", "==", 2)]),
    rule("r-2", "Bruno", [cap("c-2", "Sun.Lead", "==", 1)]),
    // A second clause, so the card is still a rule once its cap is removed.
    { ...rule("r-3", "Ana", [cap("c-3", "*.Lead", "==", 1)]), excludedPatterns: ["Sat.BGV"] },
  );

  it("marks both cards of the pair, and only those", () => {
    renderGen(STORED_PAIR);
    const message = exactOverlapCardMessage("Sun.Lead");
    expect(within(cards()[0]).getByText(message)).toBeTruthy();
    expect(within(cards()[1]).queryByText(message)).toBeNull();
    expect(within(cards()[2]).getByText(message)).toBeTruthy();
  });

  it("removing either cap clears the marks and lets the save through", async () => {
    const rules = renderGen(STORED_PAIR);
    openEditor(2);
    // The open form flags its own cap row too, and cannot be saved while it does.
    expect(screen.getByText(exactOverlapFormMessage({ role: "Sun.Lead", person: "Ana", rule: "Sun.* == 2" }))).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement).disabled).toBe(true);
    const form = screen.getByRole("button", { name: "Guardar cambios" }).closest("div.rounded-lg") as HTMLElement;
    const capRow = (within(form).getByLabelText("Operador") as HTMLElement).closest("div.flex") as HTMLElement;
    fireEvent.click(within(capRow).getByRole("button", { name: "×" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(screen.queryByText(exactOverlapCardMessage("Sun.Lead"))).toBeNull();

    fireEvent.click(saveBar());
    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(1));
    expect(exactCapOverlaps(rules.save.mock.calls[0][0] as SolverConfig)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/MonthGenerator.exactOverlap.test.tsx`
Expected: FAIL — 4 tests (no message under the cap row and «Agregar restricción» stays enabled; no card mark; the stored-pair editor's «Guardar cambios» is not disabled). «does not look at another person's card» already passes.

- [ ] **Step 3: Imports**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
```

**Replace with:**

```tsx
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
import {
  PLANNER_UPDATED_MESSAGE,
  editableConfig,
  isOutdatedSource,
```

**Replace with:**

```tsx
import {
  PLANNER_UPDATED_MESSAGE,
  editableConfig,
  exactOverlapCardMessage,
  exactOverlapFormMessage,
  isOutdatedSource,
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
import {
  buildColumns,
  buildRows,
  buildSolveRequest,
  applySolveResponse,
```

**Replace with:**

```tsx
import { exactCapOverlaps } from "@/app/utils/solverConfigWriteRequest";
import {
  buildColumns,
  buildRows,
  buildSolveRequest,
  applySolveResponse,
  capLabel,
```

- [ ] **Step 4: The card's mark**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
function RestrictionCard({ r, onDelete, onEdit, nameIssue }: {
  r: PersonRestriction;
  onDelete: () => void;
  onEdit: () => void;
  nameIssue?: CadenceNameIssue;
}) {
```

**Replace with:**

```tsx
function RestrictionCard({ r, onDelete, onEdit, nameIssue, exactOverlapRole }: {
  r: PersonRestriction;
  onDelete: () => void;
  onEdit: () => void;
  nameIssue?: CadenceNameIssue;
  /** Parent A38: the first role this card fixes twice with another card or itself — a pair saved before C3. */
  exactOverlapRole?: string;
}) {
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
          {r.sundayCadence === "alternate" && nameIssue && (
            <span className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-warning-strong/10 text-warning-strong border border-warning-strong/30">
              {cadenceNameChip(nameIssue)}
            </span>
          )}
        </div>
```

**Replace with:**

```tsx
          {r.sundayCadence === "alternate" && nameIssue && (
            <span className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-warning-strong/10 text-warning-strong border border-warning-strong/30">
              {cadenceNameChip(nameIssue)}
            </span>
          )}
        </div>
        {exactOverlapRole && (
          <p className="font-body text-[11px] text-negative-fg">{exactOverlapCardMessage(exactOverlapRole)}</p>
        )}
```

- [ ] **Step 5: The form checks its caps against its siblings**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
function PersonRestrictionForm({ members, onAdd, onCancel, initialValues }: {
  members: MemberOption[];
  onAdd: (r: PersonRestriction) => void;
  onCancel: () => void;
  initialValues?: PersonRestriction;
}) {
```

**Replace with:**

```tsx
function PersonRestrictionForm({ members, onAdd, onCancel, initialValues, siblings }: {
  members: MemberOption[];
  onAdd: (r: PersonRestriction) => void;
  onCancel: () => void;
  initialValues?: PersonRestriction;
  /**
   * Every OTHER restriction of the on-screen config, in order — what parent
   * A38's check compares this card's `==` caps against (same `person` text).
   */
  siblings: PersonRestriction[];
}) {
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
  // A restriction may carry «Mes por medio» alone (C3 §6.6).
  const canAdd = !!person && (excl.length > 0 || weekEx.length > 0 || caps.length > 0 || fairness !== "none" || sundayCadence === "alternate");
```

**Replace with:**

```tsx
  // Parent A38 (C3 §6.2): a cap row whose `==` covers a role another `==` cap
  // already fixes — on this card or on a card with the same `person` text — is
  // flagged, and the form cannot be saved while one remains. The draft goes LAST,
  // so every pair touching it has its `later` here.
  const capOverlapMessage = new Map<string, string>();
  for (const o of exactCapOverlaps({
    restrictions: [...siblings, { id: "", person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps }],
  })) {
    if (o.later.restriction !== siblings.length) continue;
    const flagged = caps[o.later.cap];
    const other = o.first.restriction === siblings.length ? caps[o.first.cap] : siblings[o.first.restriction].caps[o.first.cap];
    if (!flagged || !other || capOverlapMessage.has(flagged.id)) continue;
    capOverlapMessage.set(flagged.id, exactOverlapFormMessage({ role: o.roles[0], person, rule: capLabel(other) }));
  }

  // A restriction may carry «Mes por medio» alone (C3 §6.6).
  const canAdd = !!person && capOverlapMessage.size === 0 && (excl.length > 0 || weekEx.length > 0 || caps.length > 0 || fairness !== "none" || sundayCadence === "alternate");
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
            <div key={cap.id} className="flex flex-wrap gap-1.5 items-center">
              <Select
                size="sm"
                aria-label="Patrón"
                className="flex-1 min-w-[140px] max-w-[220px]"
                value={cap.pattern}
```

**Replace with:**

```tsx
            <Fragment key={cap.id}>
            <div className="flex flex-wrap gap-1.5 items-center">
              <Select
                size="sm"
                aria-label="Patrón"
                className="flex-1 min-w-[140px] max-w-[220px]"
                value={cap.pattern}
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
              <button type="button" onClick={() => setCaps(cs => cs.filter(x => x.id !== cap.id))} className="text-mono-600 hover:text-negative-fg text-sm flex-none">×</button>
            </div>
          ))}
```

**Replace with:**

```tsx
              <button type="button" onClick={() => setCaps(cs => cs.filter(x => x.id !== cap.id))} className="text-mono-600 hover:text-negative-fg text-sm flex-none">×</button>
            </div>
            {capOverlapMessage.has(cap.id) && (
              <p className="font-label text-[10px] text-negative-fg">{capOverlapMessage.get(cap.id)}</p>
            )}
            </Fragment>
          ))}
```

- [ ] **Step 6: `RuleBuilder` hands the form its siblings and marks stored pairs**

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
  const total = config.restrictions.length + config.conflicts.length + config.presence.length;
  const isFormOpen = !!adding || !!editingId;
```

**Replace with:**

```tsx
  const total = config.restrictions.length + config.conflicts.length + config.presence.length;
  const isFormOpen = !!adding || !!editingId;

  // Parent A38 on the on-screen config: a pair saved before C3 marks both of its
  // cards, and the route refuses every save while it stands (C3 §6.2).
  const exactOverlapRole = new Map<string, string>();
  for (const o of exactCapOverlaps(config)) {
    for (const ref of [o.first, o.later]) {
      const id = config.restrictions[ref.restriction]?.id;
      if (id !== undefined && !exactOverlapRole.has(id)) exactOverlapRole.set(id, o.roles[0]);
    }
  }
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
        <PersonRestrictionForm
          members={members}
          onAdd={r => { onChange({ ...config, restrictions: [...config.restrictions, r] }); setAdding(null); }}
```

**Replace with:**

```tsx
        <PersonRestrictionForm
          members={members}
          siblings={config.restrictions}
          onAdd={r => { onChange({ ...config, restrictions: [...config.restrictions, r] }); setAdding(null); }}
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
          <PersonRestrictionForm key={r.id} members={members} initialValues={r}
            onAdd={saveRestriction} onCancel={cancelEdit} />
```

**Replace with:**

```tsx
          <PersonRestrictionForm key={r.id} members={members} initialValues={r}
            siblings={config.restrictions.filter(x => x.id !== r.id)}
            onAdd={saveRestriction} onCancel={cancelEdit} />
```

**Find** in `app/components/admin/MonthGenerator.tsx`:

```tsx
            nameIssue={cadenceNameIssues.get(r.id)}
```

**Replace with:**

```tsx
            nameIssue={cadenceNameIssues.get(r.id)}
            exactOverlapRole={exactOverlapRole.get(r.id)}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/MonthGenerator.exactOverlap.test.tsx app/components/admin/__tests__/MonthGenerator.cadence.test.tsx app/components/admin/__tests__/MonthGenerator.ruleEdit.test.tsx`
Expected: PASS (25 tests).

- [ ] **Step 8: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add app/components/admin/MonthGenerator.tsx app/components/admin/__tests__/MonthGenerator.exactOverlap.test.tsx
git commit -m "feat(planner): the rule form and cards refuse a second exact count" -m "Parent A38, C3 §6.2: a cap row whose == covers a role another == cap already fixes for the same person text — on the card or on a sibling card — names the other rule and blocks the form; a pair saved before C3 marks both cards, so the refusal the route gives every save is never a dead end. Form, panel and route run the same exactCapOverlaps."
```

---

## Task 12: The seed script — «Mes por medio» visible, rules by ordinal not key

Spec R8, §6.9; T12. Parent A41 (review-log item 21): the summary and the REFUSING diff printed each rule's raw id (seed-era ids embed first names) and person text. They now print each rule by kind and 1-based ordinal — the order the rule panel lists it — with its clauses and «Mes por medio». The capture's parse goes through the same parser as the route (A38 and the cadence included) and refuses before any Sanity client exists. Review-log item 15: running the real script under `tsx` proves the parser's new runtime `@/` import resolves.

**Files:**
- Create: `scripts/lib/solverConfigSummary.ts`
- Modify: `scripts/seed-solver-config.ts:71-74` (header), `:81-86` (imports), `:99-119` (`summarize`)
- Test: `scripts/__tests__/solverConfigSummary.test.ts` (create), `scripts/__tests__/seedSolverConfig.test.ts` (create)

**Interfaces:**
- Consumes: `SolverConfig` (type only); `parseSolverConfigWrite` (Tasks 2–3).
- Produces: `export function solverConfigSummaryLines(label: string, c: SolverConfig): string[]` — `label`, a pools line, then `restricción N · <clauses> [· Mes por medio]`, `conflicto N · !with on <pattern>`, `presencia N · any_of(<k> personas) on <pattern>`; no rule id, no person text.

- [ ] **Step 1: Write the failing tests**

**Create** `scripts/__tests__/solverConfigSummary.test.ts`:

```ts
// The seed script's dry-run summary and REFUSING diff (solver v3 C3 §6.9, T12).
//
// Two properties. «Mes por medio» is visible, so a difference in cadence shows up
// in the output a human reviews. And the output names no rule by its raw key
// and no person by name (parent A41): seed-era ids embed first names, and script
// stdout is an output that can leave a private file. Rules are identified by
// kind and 1-based ordinal — the order the rule panel lists them in.
import { describe, expect, it } from "vitest";

import { solverConfigSummaryLines } from "../lib/solverConfigSummary";
import type { SolverConfig } from "@/app/components/admin/plannerModel";

// Name-shaped keys on purpose: production's seed-era ids look like this.
const CONFIG: SolverConfig = {
  sundayLeads: ["m-ana"],
  saturdayLeads: ["m-bruno", "m-carla"],
  support: [],
  restrictions: [
    {
      id: "d-ana", person: "Ana", excludedPatterns: ["Sat.*"], fairness: "exempt", fairnessSlack: 1,
      weekExclusions: [{ id: "d-ana-w", week: 2, pattern: "*.*" }],
      caps: [{ id: "d-ana-c", pattern: "Sun.Lead", op: "<=", value: 0, relative: true, relOffset: 2 }],
      sundayCadence: "alternate",
    },
    { id: "d-bruno", person: "Bruno", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [] },
  ],
  conflicts: [{ id: "d-ana-bruno", personA: "Ana", personB: "Bruno", pattern: "*.Lead" }],
  presence: [{ id: "d-bruno-carla", persons: ["Bruno", "Carla"], pattern: "Sun.BGV" }],
};

describe("solverConfigSummaryLines (C3 T12)", () => {
  it("prints every rule by kind and ordinal, with «Mes por medio» where it is set", () => {
    expect(solverConfigSummaryLines("Would create:", CONFIG)).toEqual([
      "Would create:",
      "  pools: 1 dom · 2 sáb · 0 apoyo",
      "  restricción 1 · !in Sat.* · !in week 2 *.* · Sun.Lead <= 0 (rel 2) · fairness:exempt · Mes por medio",
      "  restricción 2 · (sin cláusulas)",
      "  conflicto 1 · !with on *.Lead",
      "  presencia 1 · any_of(2 personas) on Sun.BGV",
    ]);
  });

  it("never prints a raw key or a person's name (parent A41)", () => {
    const text = solverConfigSummaryLines("x", CONFIG).join("\n");
    for (const secret of ["d-ana", "d-bruno", "Ana", "Bruno", "Carla", "m-ana"]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
```

**Create** `scripts/__tests__/seedSolverConfig.test.ts`:

```ts
// `scripts/seed-solver-config.ts` run as a process (solver v3 C3 §6.9, T12).
//
// The capture goes through the SAME parser as the route, so a capture holding
// two `==` caps on one role for one person text (parent A38), or an invalid
// cadence, is refused with its issue path — before any Sanity client exists,
// so nothing is read and nothing is written. Running the real script under
// `tsx` also proves `tsx` resolves the parser's runtime `@/` import of
// `plannerModel` (`rolesOfPattern`), which the seed did not need before C3.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SCRIPT = path.join(REPO_ROOT, "scripts", "seed-solver-config.ts");

let work: string;
beforeEach(() => { work = mkdtempSync(path.join(tmpdir(), "seed-solver-config-")); });
afterEach(() => rmSync(work, { recursive: true, force: true }));

function runSeed(capture: unknown) {
  const file = path.join(work, "capture.json");
  writeFileSync(file, JSON.stringify(capture));
  // A dummy token: the script checks it is set before parsing, and the parse
  // refusal returns before a client is ever constructed with it.
  return spawnSync(TSX, [SCRIPT, file], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, SANITY_WRITE_TOKEN: "dummy-not-a-token" },
    timeout: 60_000,
  });
}

const restriction = (patch: Record<string, unknown>) => ({
  id: "r-1", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...patch,
});

describe("seed-solver-config — refusals before any read (C3 T12)", () => {
  it("refuses a capture with two exact counts for one role of one person, naming the later cap", () => {
    const result = runSeed({
      restrictions: [restriction({
        caps: [
          { id: "c-1", pattern: "Sun.Lead", op: "==", value: 2 },
          { id: "c-2", pattern: "Sun.*", op: "==", value: 1 },
        ],
      })],
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing was written.");
    expect(result.stderr).toContain("restrictions[0].caps[1]:exact_overlap");
    expect(result.stdout).not.toContain("Target:"); // printed only once a client is about to read
  }, 60_000);

  it("refuses a capture with an invalid «Domingo» value", () => {
    const result = runSeed({ restrictions: [restriction({ sundayCadence: "normal" })] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("restrictions[0].sundayCadence");
    expect(result.stdout).not.toContain("Target:");
  }, 60_000);
});

describe("seed-solver-config — what it prints (C3 §6.9, parent A41)", () => {
  it("every summary — dry run and both halves of the REFUSING diff — goes through solverConfigSummaryLines", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain('import { solverConfigSummaryLines } from "./lib/solverConfigSummary";');
    expect(src.match(/summarize\("/g) ?? []).toHaveLength(3);
    // No rule key and no person text is interpolated anywhere in the script.
    for (const leak of ["${r.id}", "${r.person}", "${x.id}", "${x.personA}", "${p.id}", "persons.join"]) {
      expect(src, leak).not.toContain(leak);
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run scripts/__tests__/solverConfigSummary.test.ts scripts/__tests__/seedSolverConfig.test.ts`
Expected: FAIL — `Error: Cannot find module '../lib/solverConfigSummary'`, and «every summary … goes through solverConfigSummaryLines» (the script still interpolates `${r.id}` and `${r.person}`). The two process tests **already pass**: they pin, through the real script under `tsx`, what Tasks 2–3 built.

- [ ] **Step 3: The summary module**

**Create** `scripts/lib/solverConfigSummary.ts`:

```ts
// scripts/lib/solverConfigSummary.ts
//
// What `scripts/seed-solver-config.ts` prints for a rule set — its dry-run
// summary and both halves of its REFUSING diff. Pure, so it is tested directly
// (`scripts/__tests__/solverConfigSummary.test.ts`).
//
// **Rules by kind and ordinal, never by key or name** (solver v3 parent A41).
// `solverConfig`'s seed-era ids embed members' first names, and a script's
// stdout is an output that can leave a private file; the 1-based ordinal is
// the order the rule panel lists each kind in, which is what a reviewer matches
// against. Clauses and «Mes por medio» are printed (C3 §6.9), so a difference
// in either is visible in the diff a human reads.
import type { SolverConfig } from "../../app/components/admin/plannerModel";

export function solverConfigSummaryLines(label: string, c: SolverConfig): string[] {
  const lines = [label, `  pools: ${c.sundayLeads.length} dom · ${c.saturdayLeads.length} sáb · ${c.support.length} apoyo`];
  c.restrictions.forEach((r, i) => {
    const bits = [
      r.excludedPatterns.length ? `!in ${r.excludedPatterns.join(",")}` : "",
      r.weekExclusions.map((w) => `!in week ${w.week} ${w.pattern}`).join(" "),
      r.caps.map((cap) => `${cap.pattern} ${cap.op} ${cap.value}${cap.relative ? ` (rel ${cap.relOffset})` : ""}`).join(" "),
      r.fairness !== "none" ? `fairness:${r.fairness}` : "",
      r.sundayCadence === "alternate" ? "Mes por medio" : "",
    ].filter(Boolean);
    lines.push(`  restricción ${i + 1} · ${bits.join(" · ") || "(sin cláusulas)"}`);
  });
  c.conflicts.forEach((x, i) => lines.push(`  conflicto ${i + 1} · !with on ${x.pattern}`));
  c.presence.forEach((p, i) => lines.push(`  presencia ${i + 1} · any_of(${p.persons.length} personas) on ${p.pattern}`));
  return lines;
}
```

- [ ] **Step 4: The script prints through it**

**Find** in `scripts/seed-solver-config.ts`:

```ts
 * The `_key` minting and every validation rule come from
 * `app/utils/solverConfigWriteRequest.ts` — the SAME module the admin route
 * uses, so the seeded document and every later save cannot drift.
 */
```

**Replace with:**

```ts
 * The `_key` minting and every validation rule come from
 * `app/utils/solverConfigWriteRequest.ts` — the SAME module the admin route
 * uses, so the seeded document and every later save cannot drift. That includes
 * «Mes por medio» (`sundayCadence`) and the one-exact-count-per-role refusal
 * (solver v3 C3, parent A38). It is not subject to the route's config version
 * guard: it has no request envelope and only ever creates.
 *
 * ─── What it prints ──────────────────────────────────────────────────────────
 *
 * Rules by kind and ordinal, never by stored key or person name
 * (`scripts/lib/solverConfigSummary.ts`, solver v3 parent A41): seed-era ids
 * embed first names. The capture file and the Studio hold the names.
 */
```

**Find** in `scripts/seed-solver-config.ts`:

```ts
import {
  SOLVER_CONFIG_DOC_ID,
  buildSolverConfigDocument,
  parseSolverConfigWrite,
  solverConfigFromDocument,
} from "../app/utils/solverConfigWriteRequest";
```

**Replace with:**

```ts
import {
  SOLVER_CONFIG_DOC_ID,
  buildSolverConfigDocument,
  parseSolverConfigWrite,
  solverConfigFromDocument,
} from "../app/utils/solverConfigWriteRequest";
import { solverConfigSummaryLines } from "./lib/solverConfigSummary";
```

**Find** in `scripts/seed-solver-config.ts`:

```ts
function summarize(label: string, c: ReturnType<typeof solverConfigFromDocument>) {
  console.log(`\n${label}`);
  console.log(
    `  pools: ${c.sundayLeads.length} dom · ${c.saturdayLeads.length} sáb · ${c.support.length} apoyo`,
  );
  for (const r of c.restrictions) {
    const bits = [
      r.excludedPatterns.length ? `!in ${r.excludedPatterns.join(",")}` : "",
      r.weekExclusions.map((w) => `!in week ${w.week} ${w.pattern}`).join(" "),
      r.caps.map((cap) => `${cap.pattern} ${cap.op} ${cap.value}${cap.relative ? ` (rel ${cap.relOffset})` : ""}`).join(" "),
      r.fairness !== "none" ? `fairness:${r.fairness}` : "",
    ].filter(Boolean);
    console.log(`  restriction ${r.id} · ${r.person} · ${bits.join(" · ") || "(sin cláusulas)"}`);
  }
  for (const x of c.conflicts) {
    console.log(`  conflict    ${x.id} · ${x.personA} !with ${x.personB} on ${x.pattern}`);
  }
  for (const p of c.presence) {
    console.log(`  presence    ${p.id} · any_of(${p.persons.join(", ")}) on ${p.pattern}`);
  }
}
```

**Replace with:**

```ts
function summarize(label: string, c: ReturnType<typeof solverConfigFromDocument>) {
  console.log("");
  for (const line of solverConfigSummaryLines(label, c)) console.log(line);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run scripts/__tests__/solverConfigSummary.test.ts scripts/__tests__/seedSolverConfig.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6 (optional, read-only): the REFUSING diff against the real document**

Only where `.env.local` is the primary checkout's (symlinked in a worktree). The document exists, so the script reads it (a production **read**), prints both summaries and refuses — it never writes; do **not** pass `--apply`. Use a fictitious capture:

```bash
printf '%s' '{"sundayLeads":[],"saturdayLeads":[],"support":[],"restrictions":[{"id":"r-1","person":"Ana","excludedPatterns":[],"fairness":"none","fairnessSlack":1,"weekExclusions":[],"caps":[],"sundayCadence":"alternate"}],"conflicts":[],"presence":[]}' > "${TMPDIR:-/tmp}/c3-cadence.json"
npx tsx --env-file=.env.local scripts/seed-solver-config.ts "${TMPDIR:-/tmp}/c3-cadence.json"; echo "exit $?"
```

Expected: `Target: project … · dry run (writes nothing)`, `REFUSING: solverConfig already exists …`, a `STORED (already in Sanity):` summary of the live rules by kind and ordinal (no names, no ids — that is this task's point), a `CAPTURE (this file):` summary whose only rule line is `  restricción 1 · Mes por medio`, and `exit 2`. Still paste nothing from it into a public place: the clauses describe the real team's rules.

- [ ] **Step 7: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add scripts/lib/solverConfigSummary.ts scripts/seed-solver-config.ts scripts/__tests__/solverConfigSummary.test.ts scripts/__tests__/seedSolverConfig.test.ts
git commit -m "feat(seed): print «Mes por medio», and rules by ordinal not key" -m "C3 §6.9: the seed's dry-run summary and REFUSING diff show «Mes por medio», so a difference in cadence is visible to the human who reads them. Parent A41: they no longer print raw rule ids, which embed first names in seed-era data, or person text — each rule is named by kind and ordinal, the order the rule panel lists it. A capture with two exact counts on one role, or an invalid cadence, is refused by the shared parser before any client exists; a test runs the real script under tsx to prove it."
```

---

## Task 13: Documentation and the ADR, in the same delivery

Spec R9, §12; T13; parent A31 (C3 writes its own ADR; amendments to existing ADRs are C7's). `CLAUDE.md`'s «Keep documentation current» also covers the API reference (the POST body changed) and the utilities index (new reusable functions).

**Files:**
- Create: `docs/adr/0049-mes-por-medio-is-a-restriction-setting-behind-a-version-guard.md`
- Modify: `docs/adr/README.md` (index row after ADR-0048), `docs/DATA_MODEL.md:361-364` and `:431`, `docs/API_REFERENCE.md:457-463`, `docs/UTILITIES_AND_COMPONENTS.md:203`, `CLAUDE.md:215`, `AGENTS.md:215`
- Test: none new — `adrIndex.test.ts` and `agentDocsParity.test.ts` guard the index and the parity; the code review's docs-audit checklist guards the claims (Release step 1).

**Interfaces:** none (prose). The ADR's file name is the pointer the other docs use; if the number changes at merge (Global Constraints), every pointer changes with it.

- [ ] **Step 1: The ADR**

**Create** `docs/adr/0049-mes-por-medio-is-a-restriction-setting-behind-a-version-guard.md`:

```md
# ADR-0049: «Mes por medio» is a rule setting, and the rules POST refuses another config version

**Date:** 2026-10-06 · **Status:** Accepted

> **Numbering.** ADR numbers follow the order records reach `main`; this is the next free
> number on `main` when written, and is renumbered in the merge of `main` if another record
> lands first (`adrIndex.test.ts` keeps the index honest). Solver v3, child C3 (parent ruling
> A31: the child that introduces the behaviour writes its ADR). Spec:
> `docs/superpowers/specs/2026-10-05-solver-v3-c3-cadence-config-design.md`.

## Context

Some members lead Sundays every other month. Until v3 the only way to express it was ticking and
unticking them in the pool checkboxes by hand (ADR-0046), which records nothing. v3 needs the
setting stored, resolvable to one member, and inert under v2 until the flip.

The document it lives in is the hard part. `POST /api/admin/solver-config` replaces the WHOLE
`solverConfig` document, and its parser deliberately drops unknown fields («refusing to save
because the client is newer helps nobody»). The client normalises every read through the same
reader, which keeps only the fields it knows, and the rule form rebuilds a restriction from its
own state. So a tab whose bundle predates a field reads it away, and its next «Guardar reglas» —
about any rule — erases it for every admin. Preview writes the same document as production, and
`preview` deploys first, so during every release the older route is a live writer of a document
the newer one may have extended.

## Decision

- **A restriction setting, keyed by name, storing no state.** `solverConfig.restrictions[].sundayCadence`
  is absent («Normal») or `"alternate"` («Mes por medio») — never `null`, never `"normal"`. It is
  keyed by the restriction's `person` like every rule, not stored on `teamMembers` (ADR-0029: Tipo
  is the only eligibility axis; the cadence shapes a share, it never makes anyone eligible). The
  cadence STATE is never stored; C2 recomputes it.
- **Refuse, never merge: a config version.** `SOLVER_CONFIG_VERSION` (2) in
  `app/utils/solverConfigWriteRequest.ts`. Every save carries `configVersion`; the route refuses
  anything else with `400 invalid_request` (`details.issues: ["configVersion"]`) after auth and
  before it reads or parses anything, and every GET and POST echo carries the version, so a
  client meeting another one disables its own save. A field **or an allowed value** an older
  client would drop or rewrite bumps it in the same change; `solverConfigVersion.test.ts` pins
  the key set at every level and the accepted values of `sundayCadence`, `fairness` and cap `op`.
- **One exact count per person per role (parent A38), checked at save by `person` TEXT.**
  `exactCapOverlaps` refuses two `==` caps whose `rolesOfPattern` roles intersect, within one
  restriction or across restrictions whose `person` matches case-insensitively after trimming.
  The route holds no roster, so two spellings of one member, and an overlap on `Sat.Choir` alone
  (not one of the five v2 keys), are refused at v3 build time by C2, by member id.
- **Every other writer of rule values goes through the parser and serializer.** A writer that
  sets or restores a restriction, cap, week exclusion, conflict, presence or cadence value reads
  through `solverConfigFromDocument`, changes only its paths, runs `parseSolverConfigWrite`, and
  writes only what `solverConfigFields` produced, under `ifRevisionId`. This supersedes the two
  one-off scripts of 2026-09-29 and 2026-10-01 (kept in the private log repository), which
  appended caps and whole restrictions with no parser — a repeat would bypass the A38 check and
  the field's validation. The member DELETE's pool-array patch and the rule-name repair script's
  single-`person` patch stay as they are.
- **The resolver filters by ministry itself.** `app/utils/sundayCadence.ts` resolves a rule name
  to exactly one member over the unfiltered roster minus non-worship members
  (`normalizeMinistries`), because the planner's `members` includes kids-only members for a
  super-admin and not for a worship admin; one config gives one answer for both.
- **v2 is inert.** `v2View` removes the field and every restriction that carried only it, and is
  applied inside `solverPools` and the first-match `isExcludedFromLead`;
  `cadenceV2Inert.test.ts` asserts every v2 answer equal for a config and its v2 view.

## Rejected

- **Merging on the server** the fields a body lacks: indistinguishable from a deliberate
  «Normal», which is also absence.
- **Requiring the field on every restriction**: guards this one field; a version guards the next.
- **`stale_revision` as the refusal**: an old tab renders it as «Recargar reglas», whose re-read
  goes through that tab's own field-dropping reader and can never produce an accepted body. A
  new conflict code would print «(error 409)».
- **A roster read on save** to judge A38 by member id: a read on a critical writer, and still
  unsound after a rename. **A second, six-key pattern map** in C3: two expansions that can drift;
  C2 owns the six-key expansion.
- **A caller-side ministry filter**: every consumer would have to remember it, and a forgotten
  one shows false «Nombre ambiguo» chips and v3 refusals for a super-admin only.

## Consequences

- **Rollback is UI-only once C2 ships.** Removing the «Domingo» control, the chips and the warning
  keeps the type, parser, serializer, reader, resolver, the guard (still 2), the A38 check — and
  the form's data path: `PersonRestrictionForm` still carries `sundayCadence` from
  `initialValues` to `onAdd`, or the first edit of a cadence card would erase it while the guard
  waved the body through. A full revert exists only before C2 ships, after listing every stored
  setting; a Vercel Instant Rollback or promote of production (or of `dev-owt-backstage`) to a
  deployment older than C3 IS that full revert.
- **Any pre-C3 deployment is a live writer of the shared document**: not only production during
  the release window, but older immutable deployment URLs and the `verify/service-readiness`
  deployment. No «Mes por medio» is saved anywhere until the production alias serves C3, and a
  tab loaded before the release sees «El servidor rechazó las reglas y no guardó nada.» on its
  next save (its old bundle cannot say more) — reload open admin tabs after the release.
- **A pair of exact counts saved before C3 blocks every save** until one cap is removed; the
  panel marks both cards so it is never a dead end.
```

**Find** in `docs/adr/README.md`:

```md
a 31st filled by hand, never the month
```

**Replace with:**

```md
a 31st filled by hand, never the month
- [ADR-0049: «Mes por medio» is a rule setting, and the rules POST refuses another config version](0049-mes-por-medio-is-a-restriction-setting-behind-a-version-guard.md) — solver v3 C3. Why the cadence is a `solverConfig` restriction setting keyed by name (not a `teamMembers` field, ADR-0029) with no stored state, why a whole-document save is protected by a refuse-not-merge `SOLVER_CONFIG_VERSION` (and why `invalid_request`, not `stale_revision`), why the one-exact-count check (parent A38) judges `person` text at save and member id at v3 build, why the resolver applies the worship filter itself, and the rule that every other writer of rule values goes through the parser and serializer — superseding two one-off scripts that appended caps with none. Rollback is UI-only once C2 ships, and keeps the form's data path
```

- [ ] **Step 2: `docs/DATA_MODEL.md`**

**Find** in `docs/DATA_MODEL.md`:

```md
Every array-of-object item carries a `_key` **equal to the rule's own `id`** — the `id` the UI's
`uid()` already assigned, not a second identifier. Minting happens in
[`app/utils/solverConfigWriteRequest.ts`](../app/utils/solverConfigWriteRequest.ts), which both the
route and the seed script go through so the two cannot drift.
```

**Replace with:**

```md
Every array-of-object item carries a `_key` **equal to the rule's own `id`** — the `id` the UI's
`uid()` already assigned, not a second identifier. Minting happens in
[`app/utils/solverConfigWriteRequest.ts`](../app/utils/solverConfigWriteRequest.ts), which both the
route and the seed script go through so the two cannot drift.

**«Mes por medio» (`restrictions[].sundayCadence`, solver v3 C3).** Absent means «Normal»;
`"alternate"` means «Mes por medio»; nothing else is ever stored — never `null`, never `"normal"`,
so a document with no cadence is byte-identical to what pre-C3 code wrote, and no migration exists.
It is the setting only, keyed by the restriction's `person` like every rule; the cadence STATE is
never stored. v2 ignores it: `v2View` (`plannerModel.ts`) removes it, and every restriction that
carried only it, wherever v2 reads restriction persons. It resolves to a member id only through
`app/utils/sundayCadence.ts` (exactly one worship member, or a named refusal).

**The config version guard.** The POST replaces the whole document and the reader keeps only the
fields it knows, so a client that predates a field would read it away and erase it on its next
save. Every save therefore carries `configVersion`, and the route refuses anything but exactly
`SOLVER_CONFIG_VERSION` (2) with `400 invalid_request` before it reads or parses anything; GET and
POST echo the version. **Bump rule:** a change that adds a field, or an allowed value, that an
older client would drop or rewrite bumps `SOLVER_CONFIG_VERSION` in the same change —
`solverConfigVersion.test.ts` pins the key set at every level and the accepted values of
`sundayCadence`, `fairness` and cap `op`.

**One exact count per person per role (parent A38).** A save holding two `==` caps whose roles
(`rolesOfPattern`) intersect, for one `person` text (case-insensitive, trimmed) — on one
restriction or across two — is refused at the later cap
(`restrictions[i].caps[j]:exact_overlap`), by `exactCapOverlaps`, which the rule form and panel
also run. Two spellings of one member are refused by v3's build, by member id (C2).

**Any other writer of rule values** reads through `solverConfigFromDocument`, changes only its
paths, runs `parseSolverConfigWrite` and writes only what `solverConfigFields` produced, under
`ifRevisionId` (and with `configVersion` if it POSTs) — never an `insert`/`append` of caps or
restrictions around the parser. The member DELETE's pool-array patch and the rule-name repair
script's single-`person` patch are the only targeted writers. See
[ADR-0049](adr/0049-mes-por-medio-is-a-restriction-setting-behind-a-version-guard.md).
```

**Find** in `docs/DATA_MODEL.md`:

```md
| `solverRestriction` | `{ id, person, excludedPatterns[], fairness, fairnessSlack, weekExclusions[], caps[] }` | `solverConfig.restrictions` |
```

**Replace with:**

```md
| `solverRestriction` | `{ id, person, excludedPatterns[], fairness, fairnessSlack, weekExclusions[], caps[], sundayCadence? }` — `sundayCadence` is `"alternate"` («Mes por medio») or absent («Normal») | `solverConfig.restrictions` |
```

- [ ] **Step 3: `docs/API_REFERENCE.md`**

**Find** in `docs/API_REFERENCE.md`:

```md
- **`GET /api/admin/solver-config`** — the shared planner rule set (`_id: solverConfig`).
  Returns `{ present, rev, config }`.
```

**Replace with:**

```md
- **`GET /api/admin/solver-config`** — the shared planner rule set (`_id: solverConfig`).
  Returns `{ present, rev, config, configVersion }` — `configVersion` is the document shape this
  deployment speaks (`SOLVER_CONFIG_VERSION`); a client that speaks another disables its save.
```

**Find** in `docs/API_REFERENCE.md`:

```md
- **`POST /api/admin/solver-config`** — replace the rule set. Body `{ rev, config }`.
```

**Replace with:**

```md
- **`POST /api/admin/solver-config`** — replace the rule set. Body `{ rev, config, configVersion }`.
  **A `configVersion` that is not exactly `SOLVER_CONFIG_VERSION`** (absent, `null`, a string, an
  older or newer number) is `400 invalid_request` with `details: { issues: ["configVersion"],
  expected, received }`, checked after auth and before anything is read or parsed — a client that
  predates a field would otherwise erase it (ADR-0049). A config holding two `==` caps that fix a
  common role for one `person` text is `400 invalid_request` at
  `restrictions[i].caps[j]:exact_overlap` (the later cap; parent A38). Success echoes
  `{ present, rev, config, configVersion }`.
```

- [ ] **Step 4: `docs/UTILITIES_AND_COMPONENTS.md`**

**Find** in `docs/UTILITIES_AND_COMPONENTS.md`:

```md
### Dates & schedule
```

**Replace with:**

```md
### Solver rule set — «Mes por medio» and exact counts (solver v3 C3, ADR-0049)
- **`SOLVER_CONFIG_VERSION`, `exactCapOverlaps(config)`, `SUNDAY_CADENCE_VALUES`/`FAIRNESS_VALUES`/`CAP_OPS`**
  ([solverConfigWriteRequest.ts](../app/utils/solverConfigWriteRequest.ts), neutral) — the rules
  POST refuses any other `configVersion`; `exactCapOverlaps` is the ONE check that a person has at
  most one `==` count per role key, run by the parser, the rule form, the panel and the client's
  refusal mapping. `parseSolverConfigWrite`/`solverConfigFields`/`solverConfigFromDocument` are the
  only way any writer sets or restores a rule value.
- **`resolveRulePersonId`, `cadenceMembers`, `cadenceOutsideSundayPool`, `RosterMember`**
  ([sundayCadence.ts](../app/utils/sundayCadence.ts), neutral) — exactly one worship member per
  rule name or a named refusal (`unresolved`/`ambiguous`), over the unfiltered roster minus
  non-worship members (the functions apply `normalizeMinistries` themselves). v2 keeps its
  first-match `resolveToMemberName`. Copy: `CADENCE_V2_NOTE`, `SLACK_V3_NOTE`,
  `CADENCE_OUTSIDE_HEADING`, `CADENCE_OUTSIDE_SENTENCE`.
- **`v2View(config)`** ([plannerModel.ts](../app/components/admin/plannerModel.ts)) — the config
  v2 sees: `sundayCadence` stripped and cadence-only restrictions removed; applied in
  `solverPools` and `isExcludedFromLead`. `cadenceV2Inert.test.ts` is the guard.

### Dates & schedule
```

- [ ] **Step 5: `CLAUDE.md` and `AGENTS.md` — one invariant, byte-identical in both**

**Find** in `CLAUDE.md`:

```md
- **Sanity array-of-object writes need a `_key` per item.**
```

**Replace with:**

```md
- **Sanity array-of-object writes need a `_key` per item.**
- **`solverConfig` saves carry `SOLVER_CONFIG_VERSION`, and nothing writes a rule value around
  its parser.** The rules POST replaces the whole document and refuses any body whose
  `configVersion` is not exactly `SOLVER_CONFIG_VERSION`
  (`app/utils/solverConfigWriteRequest.ts`), because an older client reads away a field it does
  not know and its next save erases it for everyone. A field **or an allowed value** an older
  client would drop or rewrite bumps the version in the same change; `solverConfigVersion.test.ts`
  is the tripwire. Any other writer that sets or restores a rule value goes through
  `solverConfigFromDocument` → `parseSolverConfigWrite` → `solverConfigFields` under
  `ifRevisionId` — never again an `insert`/`append` of caps or restrictions as the two private
  one-off scripts of 2026-09-29/10-01 did (the member DELETE's pool-array patch and the rule-name
  repair script's single-`person` patch are the only targeted writers). A rule person has at most
  one `==` count per role key: refused at save by `exactCapOverlaps` (by `person` text) and at v3
  build by C2 (by member id). ADR-0049.
```

**Find** in `AGENTS.md`:

```md
- **Sanity array-of-object writes need a `_key` per item.**
```

**Replace with:**

```md
- **Sanity array-of-object writes need a `_key` per item.**
- **`solverConfig` saves carry `SOLVER_CONFIG_VERSION`, and nothing writes a rule value around
  its parser.** The rules POST replaces the whole document and refuses any body whose
  `configVersion` is not exactly `SOLVER_CONFIG_VERSION`
  (`app/utils/solverConfigWriteRequest.ts`), because an older client reads away a field it does
  not know and its next save erases it for everyone. A field **or an allowed value** an older
  client would drop or rewrite bumps the version in the same change; `solverConfigVersion.test.ts`
  is the tripwire. Any other writer that sets or restores a rule value goes through
  `solverConfigFromDocument` → `parseSolverConfigWrite` → `solverConfigFields` under
  `ifRevisionId` — never again an `insert`/`append` of caps or restrictions as the two private
  one-off scripts of 2026-09-29/10-01 did (the member DELETE's pool-array patch and the rule-name
  repair script's single-`person` patch are the only targeted writers). A rule person has at most
  one `==` count per role key: refused at save by `exactCapOverlaps` (by `person` text) and at v3
  build by C2 (by member id). ADR-0049.
```

- [ ] **Step 6: Run the doc guards**

Run: `npx vitest run app/utils/__tests__/adrIndex.test.ts app/utils/__tests__/agentDocsParity.test.ts app/utils/__tests__/studioProtection.test.ts`
Expected: PASS (`adrIndex` 4, `agentDocsParity` 1, `studioProtection` unchanged and green).

- [ ] **Step 7: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .` — expected: 0 errors, all green, warnings at the baseline.

```bash
git add docs/adr/0049-mes-por-medio-is-a-restriction-setting-behind-a-version-guard.md docs/adr/README.md docs/DATA_MODEL.md docs/API_REFERENCE.md docs/UTILITIES_AND_COMPONENTS.md CLAUDE.md AGENTS.md
git commit -m "docs(solver-config): «Mes por medio», the config version guard and ADR-0049" -m "C3 §12 and parent A31: the data model gains sundayCadence, the version guard and its bump rule, the one-exact-count rule and the rule that every other writer of rule values goes through the parser and serializer; the API reference gains configVersion and both refusals; the utilities index gains the resolver and v2View; CLAUDE.md and AGENTS.md gain one invariant. ADR-0049 records the rejected alternatives — a server-side merge, stale_revision, a roster read on save, a caller-side ministry filter — and the rollback rules."
```

---

## Task 14: Verify the delivery against the spec before any push

Spec §6.11 («Preserved»), §13 (the gates row), §9 A2/A3. Nothing is committed here unless a check fails and is fixed (then: fix → gates → its own commit, and re-run this whole task).

**Files:** none (read-only checks).

- [ ] **Step 1: The gates on the final tree**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: no `tsc` output; every test green (438 files / 7966 tests on a `20fd3367` base); `✖ 81 problems (0 errors, 81 warnings)` — the baseline, never more. `gcf/**` and `gcf_v3/**` are untouched (Step 2), so neither Python gate applies.

- [ ] **Step 2: Nothing that must not move moved**

Run:
```bash
git diff --name-only origin/main...HEAD | grep -E '^(gcf|gcf_v3)/|^app/mcp/|^app/api/mcp/|solverConfigDefaults\.ts$|studioProtection|^docs/SECRETS\.md$|^app/api/admin/members/'
```
Expected: **no output** (spec §6.9 defaults, §6.10 protection lists, E15 targeted writers, E16 MCP, §12 SECRETS).

Run: `git diff origin/main...HEAD | grep -E '^\+' | grep -E 'SOLVER_ENGINE|solverEngine' | grep -vE '^\+\s*(\*|//)'`
Expected: **no output** — C3 never imports or reads the engine (spec §5); the one added mention is the `showCadencePoolWarning` doc comment, which the last filter drops.

Run: `git grep -n "solverConfigWriteRequest" -- app/components/admin/plannerModel.ts; grep -lE '^"use client"|^import "server-only"' app/utils/sundayCadence.ts app/utils/solverConfigWriteRequest.ts app/components/admin/plannerModel.ts app/components/admin/solverConfigSource.ts scripts/lib/solverConfigSummary.ts`
Expected: **no output** — no import cycle; all five modules neutral.

- [ ] **Step 3: Spec §9 A2 and A3 — no other whole-document writer, no MCP reader**

Run: `git grep -n -E "solverConfig|SOLVER_CONFIG_DOC_ID" -- app scripts sanity | grep -E "\.set\(|createOrReplace|\.patch\(|\.create\(|insert\(|append\("`
Expected: exactly two lines — `app/api/admin/members/[id]/route.ts` (the member DELETE's pool-array patch) and `app/api/admin/solver-config/route.ts` (the guarded whole-document writer). Anything else is a new writer of rule values: stop and route it through spec §7 item 8 before release.

Run: `git grep -n -E "solverConfig|SOLVER_CONFIG|restrictions" -- app/mcp app/api/mcp`
Expected: **no output** (A3).

- [ ] **Step 4: The rollback-surviving tests are on the edit path**

Run: `awk '/describe\("edit path/,/^}\);/' app/components/admin/__tests__/MonthGenerator.cadence.test.tsx | grep -c "domingo()"`
Expected: `0` — no test the UI-only rollback must keep (spec §11) touches the «Domingo» control.

- [ ] **Step 5: The frozen literal and the existing suites were not edited**

Run: `npx vitest run app/utils/__tests__/solverConfigWriteRequest.test.ts -t "step zero"` — expected: PASS (2 tests).

Run: `git diff origin/main...HEAD -- app/utils/__tests__/solverConfigWriteRequest.test.ts | grep '^-[^-]'`
Expected: one line, `-import type { SolverConfig } from "@/app/components/admin/plannerModel";` (Task 3's import widening) — nothing else in the file was removed or rewritten.

Run: `git diff --name-only origin/main...HEAD -- app/components/admin/__tests__ | sort`
Expected: only `MonthGenerator.{cadence,cadenceWarning,configVersion,exactOverlap}.test.tsx`, `cadenceV2Inert.test.ts`, `rulesHarness.ts`, `solverConfigSource.test.ts`, `useSolverConfig.test.tsx` — no v2 suite (spec T8).

Run: `git log --format=%B origin/main..HEAD | grep -ci 'co-authored-by'`
Expected: `0`.

- [ ] **Step 6: Report**

Record for the code review: `git log --oneline origin/main..HEAD` (13 commits, Tasks 1–13), the gate summary, and Steps 2–5's outputs.

---

## Release

Branch `claude/solver-v3-c3-cadence-config` (Task 0). The order is spec §11's and `CLAUDE.md`'s, and is not shortened:

    implement (Tasks 1–14) → gates green → FRESH CODE REVIEW of origin/main...HEAD → fix
    → RE-VERIFY THE FIX (scoped review of the fix range + gates on the final tree)
    → merge into preview, push preview → verify the dev alias → look on dev WITHOUT saving
    → record §9 A1 and A6 → PR to main → `gates` green → arm auto-merge on the verified commit
    → verify the production alias → release notes to Frank

Spec §11 puts the review before `preview` (dev writes the production document, E18). The brief's «preview → PR → gates → review → re-verify → merge» is satisfied too: the review precedes every merge to `main`, and any commit made after it goes through `preview` and a scoped re-review before auto-merge is armed.

1. **Fresh code review** — run the `finish-cycle` skill. Its code-review dispatch reviews `origin/main...HEAD` against the spec at **critical** tier (a whole-document writer, its serializer, its validator), and carries the docs-audit (spec §12) and worklog-completeness checklists. Every fix gets its own commit, then a scoped re-review of the fix range and the gates on the final tree; the last worklog entry before any merge is a verification, never a fix.
2. **`preview` first.** Verify `.vercel/project.json` names `owt-backstage` / `prj_elS88VGezKpy18wizFN1ffoy8cJ5` before any Vercel command. Then:
   ```bash
   git switch preview && git pull --ff-only origin preview
   git merge --no-ff claude/solver-v3-c3-cadence-config
   git push origin preview
   ```
   Verify with one authoritative `get_deployment("dev-owt-backstage.vercel.app")` (Vercel MCP, team `frank-rochas-projects`) or the `deploy-verifier` agent, retried ≥30 s apart: `dev-owt-backstage.vercel.app` is in `alias` and `meta.githubCommitSha` equals the pushed `preview` commit. Never a hand-rolled watcher; never `--wait` on the alias.
3. **Look on dev WITHOUT saving** (spec §11 step 4). In `/admin` → «Servicios» → «📅 Generar mes» → «Configuración del Solver» → «Reglas»: open a person card, select «Mes por medio», read the help text, «Guardar cambios», see the chip «Mes por medio» + «aplica con el nuevo solver» and the «holgura N · no aplica con el nuevo solver» chip on a Holgura card; then **discard** — reload the page, never «Guardar reglas»: **a save on dev writes the production document** while production still runs the pre-C3 route (E18). Frank's look; agents may observe dev read-only with `scripts/dev-verify.ts` once `docs/DEV_VERIFY.md`'s «Verified runs» are recorded — it never replaces Frank's look and never saves.
4. **Record spec §9 A1 and A6 in the PR body** (both before the merge):
   - **A1 — Vercel Skew Protection is off.** One `get_project` read of `prj_elS88VGezKpy18wizFN1ffoy8cJ5` (team `frank-rochas-projects`), or Vercel → Project → Settings → Advanced: record whether Skew Protection is enabled (`skewProtectionMaxAge` absent or 0 ⇒ off; spec A1 expects it off). If it is ON, keep release rule 7a below until the skew window has expired, and add that to ADR-0049 before merging.
   - **A6 — no stored pair of exact counts.** A production **read** (counts only, no names), from a checkout whose `.env.local` is the primary's:
     ```bash
     npx tsx --env-file=.env.local -e '
     const { createClient } = require("@sanity/client");
     const { SOLVER_CONFIG_DOC_ID, exactCapOverlaps, solverConfigFromDocument } = require("./app/utils/solverConfigWriteRequest");
     (async () => {
       const client = createClient({
         projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "ebb8vcnk",
         dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
         apiVersion: "2024-01-01", token: process.env.SANITY_API_READ_TOKEN, useCdn: false, perspective: "published",
       });
       const config = solverConfigFromDocument(await client.fetch("*[_id == $id][0]", { id: SOLVER_CONFIG_DOC_ID }));
       console.log(`exact-count overlaps: ${exactCapOverlaps(config).length} · cadence restrictions: ${config.restrictions.filter((r) => r.sundayCadence === "alternate").length}`);
     })().catch((e) => { console.error(String(e)); process.exitCode = 1; });'
     ```
     Expected: `exact-count overlaps: 0 · cadence restrictions: 0` (E24). (The invocation — `--env-file` with `-e`, and `require` through the `@/` alias — was exercised against a stub env file and a stub document when this plan was written; only the network read was not.) If overlaps > 0, tell Frank before merging: after release every «Guardar reglas» is refused, naming the pair, until he removes one cap of each pair in the UI (spec A6). No agent edits the rules.
5. **PR to `main`** from `claude/solver-v3-c3-cadence-config` (body: spec link and digest, the coverage table below, gate results, review outcome, A1 and A6 readings; no AI attribution). Wait for `gates`. Arm auto-merge **last**, on the exact commit that was reviewed, re-verified and seen on dev: `gh pr merge <n> --auto --merge`. Before pushing anything else to the branch (a review fix, a catch-up merge of `main` — e.g. to renumber the ADR), `gh pr merge <n> --disable-auto` first, and re-arm only once that commit is re-verified and seen on dev too.
6. **After the merge** — verify the production alias the same way (`owt-backstage.vercel.app` in `alias`, `meta.githubCommitSha` = the merge commit) on the next turn; nothing wakes the coordinator on merge. Then record the release (merge SHA, date) in the worklog and the solver v3 program notes, remove the worktree if one was used (`git worktree remove`; `git worktree prune` at the next cycle open), and append every dispatch's `WORKLOG:` line to `.agents/log/worklog.jsonl`.
7. **Release notes to Frank** (review-log items 12, 18, 19; parent A26):
   a. **No «Mes por medio» is saved on any deployment until step 6's verification passed.** Until then production runs the pre-C3 route, which has no guard and erases the field on its next save of any rule. The rule is enforced by process only.
   b. **Every pre-C3 deployment is a live writer of the same document** — older immutable deployment URLs and the `verify/service-readiness` deployment included. Never save rules from one.
   c. **Reload every open admin tab after the merge.** A tab loaded before it is refused with «El servidor rechazó las reglas y no guardó nada.» — its old bundle cannot say «reload» — and its edits are not written.
   d. Setting «Mes por medio» for the real cadence members is Frank's action in the UI, when he chooses after 7a — before C4's dry run, which needs it (parent A22; C4 A2), and independent of C7's flip step (moving the pools, removing a cadence member's exact `Sun.Lead` rule or `Sun.Lead` exclusion — parent A28). No agent performs either.
   e. The copy (help text, chips, the two warning sentences, «Nombre no reconocido en Alabanza») is his to reword at C7's look (spec Q-c, review-log item 20).
8. **Not part of this delivery:** a hosted Studio schema deploy (optional; the embedded Studio ships the field with the app, and the Content Lake is schemaless — spec §6.10); any production Sanity write; C7's flip.
9. **Rollback** (spec §11, parent A26):
   - **Preferred — UI-only.** Remove the «Domingo» `SegmentedControl` and its help paragraph, the «Mes por medio» chip and its note, the name chips and the gated warning. **Keep** the type, parser, serializer, reader, resolver, `v2View`, the guard (`SOLVER_CONFIG_VERSION` stays 2), the A38 check with its form and refusal copy, and the form's data path (`sundayCadence` state seeded from `initialValues`, spread into `onAdd`, accepted by `canAdd`). `MonthGenerator.cadence.test.tsx`'s «edit path» describe, `solverConfigVersion.test.ts` (T7), `cadenceV2Inert.test.ts` (T8) and the T14 tests must pass **unmodified**; a rollback that edits or removes them is a full revert.
   - **Full revert** only before C2 merges, and only after listing every stored setting (the A6 command prints the count; Frank keeps the list). A Vercel Instant Rollback or promote of production — or of `dev-owt-backstage` — to a deployment older than C3 **is** a full revert, with the same conditions.

---

## Coverage — spec row → task

| Spec row | Where it is implemented and proven |
|---|---|
| **R1** `sundayCadence: "alternate"` only; «Normal» never stored | Task 2 (T1 parser, T2 serializer, T3 reader; schema); Task 1 (frozen pre-C3 bytes) |
| **R2** Every whole-document path preserves it; an older client is refused before any read or write | Task 6 (T4, T5 route); Task 5 (T6 client sends, maps, disables); Task 4 (T7 tripwire); Task 9 (the form carries it — edit-path tests) |
| **R3** v2 inert (whole request and grid verdicts) | Task 7 (T8 corpus; every existing v2 suite unedited, Task 14 Step 5) |
| **R4** Exactly-one resolver; same function for every v3 rule name | Task 8 (T9) — consumed by C2 RES-7 / C6 RQ-5 |
| **R5** «Domingo» control, card chip, cadence-only restriction, preserved on edit | Task 9 (T11) |
| **R6** «not in Líderes Domingo» predicate + copy, rendered only behind the gate | Task 8 (T10 predicate), Task 10 (T10 panel, gate default closed, `showCadencePoolWarning` for C6) |
| **R7** «Holgura» unchanged under v2; «no aplica con el nuevo solver» | Task 9 (chip and help-text tests); v2 suites unedited |
| **R8** Seed and defaults | Task 12 (T12); Task 3 («DEFAULT_SOLVER_CONFIG is unchanged…»); `solverConfigDefaults.ts` untouched (Task 14 Step 2) |
| **R9** Docs and ADR in the same delivery | Task 13; Release step 1's docs-audit checklist |
| **R10** One `==` count per role key: parser refuses, form does not produce, client names the refusal | Task 3 (T14 parser), Task 6 (route), Task 5 (client mapping, T6), Task 11 (T14 UI) |
| §6.1 Stored shape; byte-identical; no migration; `_key` unchanged | Tasks 1, 2 |
| §6.2 Guard: body, order (after auth, before read/parse), 400 shape and message, echoes, client mapping + disable, bump rule | Tasks 4, 5, 6 |
| §6.2 Field validation | Task 2 |
| §6.2 A38: covering by `rolesOfPattern`, `==` only, value ignored, same `person` text within/across, later cap once, `:exact_overlap`, shared predicate, form, stored pair, refusal copy, not a bump | Tasks 3, 5, 6, 11 |
| §6.3 Reader total; round trip; `sameSolverConfig` settles | Task 2 (T3); Task 9 («toggling on and back off settles to «Guardado»») |
| §6.4 `v2View`; `solverPools` (both callers), `buildSolveRequest`, `pinConflicts`, grid verdicts, fairness, pin copy, lead visibility, Saturday helpers; the one deliberate difference | Task 7 |
| §6.5 Exactly one; unfiltered worship roster; filter inside; union sorted | Task 8 |
| §6.6 Form, `canAdd`, edit preserves, card chip + note, Holgura chip + help, ambiguity chip, engine-neutral copy | Tasks 9, 10 |
| §6.7 Predicate, no-Tipo excluded, `voz`-less listed, copy, gate closed by default | Tasks 8, 10 |
| §6.8 Holgura | Task 9 |
| §6.9 Seed through the parser; summary/diff show «Mes por medio»; overlap refused; defaults unchanged | Tasks 3, 12 |
| §6.10 Studio | Task 2 |
| §6.11 Preserved (`_key`, create-never, `_rev`, four source states, Tipo, first match, MCP, `gcf/**`) | Existing route/source tests green; Task 14 Steps 2–3 |
| §6.12 Failure rows | Pre-C3 tab: Task 6 (T5) + release note 7c · C3 tab after a revert: Task 5 (disable on version 1) · invalid value: Tasks 2, 6 · unresolved/ambiguous: Tasks 8, 10 · «Mes por medio» + exact `Sun.Lead`: saved, no warning (C6 WN-2) — nothing to build · pair in a body: Tasks 3, 6 · pair stored: Task 11 · two spellings: Task 3 («two DIFFERENT person texts… pass the save») · no Tipo: Task 8 · lost race: existing route test |
| §7 item 1 Stored field | Task 2 |
| §7 item 2 Type | Task 2 |
| §7 item 3 Version guard shapes; `CapRef`, `exactCapOverlaps` | Tasks 3, 4, 6 |
| §7 item 4 Resolver shapes and the inside worship filter | Task 8 |
| §7 item 5 Copy constants | Task 8 (exported, tested); Tasks 9, 10 (rendered) |
| §7 item 6 The warning's gate | Task 10 (`showCadencePoolWarning` on `MonthGenerator` and `SolverConfigPanel`, default `false`) |
| §7 item 7 v2-view guarantee | Task 7 |
| §7 item 8 Parser/serializer for any other writer | Task 13 (`CLAUDE.md`, ADR-0049, DATA_MODEL); Task 14 Step 3 (A2 re-grep) |
| §9 A1 Skew Protection | Release step 4 |
| §9 A2 No other whole-document writer | Task 14 Step 3 |
| §9 A3 No MCP reader | Task 14 Steps 2–3 |
| §9 A4 Rosters carry `ministries`, supersets | Task 8 (type widening; T9 «one answer for both viewers»); Task 10 (annotated member fixtures make `tsc` refuse a lost widening) |
| §9 A5 Cadence names unique | C7's rehearsal (not this delivery) |
| §9 A6 No stored overlap | Release step 4 (count-only read) |
| §11 Release, safe end state, rollback | Release steps 1–9 |
| §12 Docs (DATA_MODEL, CLAUDE.md, ADR; SECRETS untouched) | Task 13 (+ API_REFERENCE, UTILITIES per `CLAUDE.md`'s «keep docs current»); Task 14 Step 2 |
| §13 T1 · T2 · T3 | Task 2 (T2 also Task 1) |
| §13 T4 · T5 | Task 6 |
| §13 T6 | Task 5 (source, hook, panel) |
| §13 T7 | Task 4 |
| §13 T8 | Task 7 |
| §13 T9 | Task 8 |
| §13 T10 | Tasks 8 (predicate), 10 (panel, gate) |
| §13 T11 | Tasks 9 (control, edit path, chip, Holgura, «Guardado»), 10 (ambiguity chip, kids-only namesake) |
| §13 T12 | Task 12 (+ Task 3's defaults pin) |
| §13 T13 | Task 13; `studioProtection.test.ts` unedited (Task 14 Step 2) |
| §13 T14 | Tasks 3 (parser), 6 (route), 11 (form, panel, removal unblocks) |
| §13 Gates | Every task's last step; Task 14 Step 1 |

**Coverage gaps:** none against the spec. Two things the spec assigns elsewhere are deliberately absent: §9 A5 (C7 runs `cadenceMembers` on the real roster) and C6's gating of `CADENCE_V2_NOTE`/the warning (C6 CTL-1, WN-1 — C3 ships the constant in its own span and the closed gate).

## Self-review (writing-plans checklist)

- **Spec coverage:** every R1–R10, §6.1–§6.12, §7 item 1–8, §9 A1–A6, §11, §12 and T1–T14 row maps to a task above. Every review-log item routed to the plan (10–21) has a disposition («Review-log items routed to this plan»).
- **Placeholders:** none. Every code step carries the exact code (new files in full, appended blocks in full, every edit as an exact `Find`/`Replace with` pair); every run step names its command and its expected result; the release's read-only checks are spelled out as commands that print counts only.
- **Type consistency:** `sundayCadence?: "alternate"`, `SUNDAY_CADENCE_VALUES`, `FAIRNESS_VALUES`, `CAP_OPS`, `SOLVER_CONFIG_VERSION`, `CapRef`, `ExactCapOverlap`, `exactCapOverlaps`, `v2View`, `RosterMember`, `NameRefusal`, `CadenceOutsideReason`, `resolveRulePersonId`, `cadenceMembers`, `cadenceOutsideSundayPool`, `CADENCE_V2_NOTE`, `SLACK_V3_NOTE`, `CADENCE_OUTSIDE_HEADING`, `CADENCE_OUTSIDE_SENTENCE`, `isOutdatedSource`, `saveFailure(status, body, sent?)`, `SAVE_OUTDATED_TAB_MESSAGE`, `PLANNER_UPDATED_MESSAGE`, `EXACT_ROLE_LABEL`, `exactOverlapFormMessage`, `exactOverlapCardMessage`, `exactOverlapRefusalMessage`, `readyRules(…, { configVersion })`, `showCadencePoolWarning`, `CadenceNameIssue`, `cadenceNameIssues`, `nameIssue`, `exactOverlapRole`, `siblings` and `solverConfigSummaryLines` keep one spelling and one signature from the task that produces them to every task that consumes them; the spec §7 names are exactly the spec's.
- **Executed:** the implementation was built once in a scratch clone of `20fd3367`; then the plan's own text was applied mechanically, task by task, to a second fresh clone — every `Create`/`Append`/`Find`→`Replace` matched exactly once (or the stated 13 times), each task ended with `tsc` clean and the full suite green, and the final tree was byte-identical to the scratch build and passed all three gates with the eslint warning count equal to the baseline.

## Execution handoff

Execute with **superpowers:subagent-driven-development**: a fresh implementer per task, each task's review before the next, the coordinator integrating and running Task 14 and the Release. Route by risk: Tasks 3, 5, 6 and 7 change the validator, the client of, and the guard on a whole-document production writer, and v2's solve request — give them the strongest configuration and a careful review; Tasks 8–11 are UI and a pure module with full test code — standard; Tasks 1, 4, 12 and 13 are mechanical. Task 0 and the Release stay with the coordinator (they touch shared branches and production aliases). Every dispatch reports a `WORKLOG:` trailer; the coordinator appends them (batched at cycle close is fine).
