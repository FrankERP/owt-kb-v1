# Solver v3 · C1 — «Cuenta para equidad» (`countsForFairness`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `sunday_role`, `saturday_role` and `special_role` document can say whether it counts toward fairness: the admin sets it when creating a service and changes it when editing the month, the value is stored, read through one rule, and inert until the v3 engine serves Auto.

**Architecture:** One neutral read-rule module (`app/utils/countsForFairness.ts`: GROQ fragment, TS twin, type default) is the only spelling of the rule. The two protected role writers accept and validate the field (create fingerprints it only off the type default; PATCH sets it only when sent and suppresses notices for a toggle-only edit). `GET /api/admin/roles` projects the effective value; `ROLE_PROJECTION` never carries it. The planner carries the effective value on every grid column and draft, through the PATCH body and semantic snapshot, under a client-side past-month rule evaluated at render and again at body build; one `FairnessSwitch` component serves all four surfaces, with a once-per-surface note gated on a new `SOLVER_ENGINE` constant.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client components, Sanity v5 schema objects, TypeScript, vitest + @testing-library/react (jsdom per file), `groq-js` for evaluating GROQ in tests.

**Spec:** `docs/superpowers/specs/2026-10-05-solver-v3-c1-fairness-toggle-design.md` (APPROVED at critical tier by two fresh reviewers on sha256 `cd519cf479df9b3e3c423c2b974c991132c3f58af6b33205329180795ee4c87b`). Parent: `docs/superpowers/specs/2026-10-05-solver-v3-fairness-design.md` (L1, U7, A1, A13, A25, A27, A31). The spec is the contract; this plan never changes it. Executors read both.

**Grounding.** Every file path, anchor and line number below was read on `origin/main` **`4759a214`** (2026-10-05). The whole plan was executed once in a scratch copy of that tree before it was written: after Task 14 the scratch tree passed `npx tsc --noEmit` (0 errors), `npm test` (437 files, 7954 passed, 1 skipped) and `npx eslint .` (0 errors, 81 warnings — exactly the `origin/main` baseline). The step-zero literals in Task 1 were computed on the unchanged code. If `origin/main` has moved when you start, re-run each `Find`/anchor before editing; a missing anchor is a stop-and-report, never a guess.

## Global Constraints

Every task's requirements include this section.

- **The spec is the contract** — requirement IDs `C1-R1…R14`, decisions `C1-D1…D7`, §5–§11, §15. Never edit the spec.
- **Four gates before any commit:** `npx tsc --noEmit` (0 errors), `npm test` (all green), `npx eslint .` (**0 errors**; the warning backlog stays at the baseline — 81 on `4759a214` — never higher). The Python gate does not apply: **no file under `gcf/**` changes**.
- **Commits:** conventional (`feat(scope): …`, `test(scope): …`, `docs(scope): …`), the body says *why*. **Never** a `Co-Authored-By` trailer or any AI/Claude attribution (CLAUDE.md overrides any harness reminder that says otherwise). Commit on the feature branch only; `main` takes no direct push.
- **Fictitious names only** in every fixture and example («Ana», «Beto», `m-ana`…). This repository is public.
- **Copy, verbatim (spec §9 «Copy»):** «Cuenta para equidad»; «Cuenta para equidad: aplica con el nuevo solver. Hoy Auto no lo usa.»; «Mes pasado: ya no se cambia.»; «Si cuenta, su Lead suma como Dom Lead en domingo y como Sáb Lead en otro día; BGV y Coro suman igual.»; Studio description «Vacío = valor del tipo: domingo y sábado sí, especial no. Solo lo usa el nuevo solver.»
- **One read rule:** the fragment is exactly `coalesce(countsForFairness, _type != "special_role")`, a **plain quoted string** (never a template literal — `draftGatingCoverage.test.ts` scans backtick literals), living only in `app/utils/countsForFairness.ts` with its twin and default. No other file under `app/**` or `sanity/**` spells the fragment; no Studio `initialValue`.
- **`FINGERPRINT_VERSION` stays `1`.** The canonical create payload gains `countsForFairness` only when it differs from the type default. The frozen pre-C1 literals of Task 1 (and the two already pinned in `roleWriteRequest.test.ts`: `0dc48431…`, `2d4971bb…`) must stay green; a red literal is a finding, never a re-capture.
- **`ROLE_PROJECTION` stays byte-identical** (C1-D1); the field is read through the `GET /api/admin/roles` projection and C2's own queries only.
- **Never touched (C1-R7):** any `*Commit.ts`, `publishVerdict.ts`, `publishReadyBundle.ts`, anything under `app/mcp/**`, `computeParticipation.ts`, `ParticipationSidebar.tsx`, the production modules `app/utils/solverHistory.ts` / `solverHistoryRead.ts` / `solverHistoryEvidence.ts`, `gcf/**`. Their mirror/parity/caller-pin tests stay green **unedited**: `serviceSnapshotMirror`, `serviceSnapshotParity`, `serviceCommitCallers`, `draftGatingCoverage`, `mcpProtectedTypeLiterals`, `clientBoundary`; `protectedReadAudit` changes only the two `reason` strings of §11 (no entry added or removed). *Reading note:* the test fixtures `app/utils/__tests__/solverHistoryEvidence.test.ts` and `solverHistoryEquivalence.test.ts` gain the new **required** fixture field and the new `buildRoleDocument` argument — no assertion in them changes — because §7's «R11 positive control» row requires that round trip to carry the default explicitly, and `tsc` refuses the fixtures otherwise.
- **Neutral modules (ADR-0028):** `countsForFairness.ts` and `solverEngine.ts` have no `"use client"` and **no imports**; `fairnessToggleModel.ts` has no `"use client"`. A Server Component never calls a value from a `"use client"` module (`clientBoundary.test.ts`).
- **UI invariants (spec §6.7):** the house `Switch` only (never a bare checkbox input); no `CueDialog` or toast changes; no page-level horizontal scroll on `/admin` (ADR-0035 — the header switch lives inside the grid's own scroller); `Button`/`Menu` usage unchanged; client mutation handlers keep their try/catch/finally, `res.ok` checks and loading flags (they gain a field, not a flow). No new `<input>`/`<select>`, so the 16 px rule is not engaged.
- **Timezone:** «today» is `serviceTodayIso()` (CDMX, `app/components/admin/serviceReadiness.ts:996`); «past» compares `YYYY-MM` prefixes; never a bare `new Date(iso)` on a service date. Component tests pin the clock with `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)` (only `Date` is faked, so `waitFor` keeps working) and restore with `vi.useRealTimers()`; model tests pass `todayIso` explicitly.
- **The past-month rule is client-side only (C1-D7):** no route refuses on the month. Do not add a server check.
- **No environment variable, no `docs/SECRETS.md` entry, no new ADR** (C1-D6). ADR-0010 gets a dated forward note only — its status line and decision texts do not change.
- **No production Sanity writes** by the delivery. **`preview` writes the production dataset** (CLAUDE.md «Vercel safety»): a toggle flipped on dev is a real value on a real service — inert under v2, but real for C2's ledger later. Do not flip toggles on dev except as Frank's own look.
- **`colour-inventory.json` tracks the tree:** `app/utils/__tests__/colourInventory.test.ts` compares `summary.filesScanned`, so every task that adds a non-test file under `app/` regenerates the artifact with `node scripts/colour-inventory.mjs` and commits it (Tasks 2, 7, 8).
- **`CLAUDE.md` and `AGENTS.md` stay byte-identical** outside their title and «## Continuous improvement» section (`agentDocsParity.test.ts`): every `CLAUDE.md` edit is made in `AGENTS.md` too (Task 14).

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `app/utils/countsForFairness.ts` | THE read rule: `COUNTS_FOR_FAIRNESS_GROQ`, `countsForFairnessDefault`, `countsForFairness` (twin), `FairnessRoleType`. Neutral, import-free. Consumed by C2. |
| `app/components/admin/solverEngine.ts` | `export const SOLVER_ENGINE: "v2" \| "v3" = "v2"` and nothing else (parent A1). |
| `app/components/admin/fairnessToggleModel.ts` | The four copy strings; the past-month rule (`isPastServiceMonth`); effective-value helpers for create (`effectiveCreateCounts`, `applyCreateCountsEdits`, `withoutCountsEdit`) and stored (`isStoredColumnPast`, `effectiveStoredCounts`) columns and for either (`isFairnessColumnPast`, `effectiveColumnCounts`); the grid Switch label. Neutral, pure. |
| `app/components/admin/FairnessSwitch.tsx` | `"use client"`: `FairnessSwitch` (house `Switch` + label + help line + past-month reason as `aria-describedby`) and `FairnessEngineNote` (the v2 note). |
| `app/utils/__tests__/countsForFairness.test.ts` | `groq-js` sync of fragment/twin/default over 12 documents; plain-string and single-spelling guards. |
| `app/utils/__tests__/countsForFairnessSchema.test.ts` | Studio field on the three types (C1-R1). |
| `app/utils/__tests__/countsForFairnessEvidence.test.ts` | R11 positive control with the field on every body; the §10 known limit pinned. |
| `app/components/admin/__tests__/solverEngine.test.ts` | Pins `"v2"`, its annotation, neutrality (C1-R11). |
| `app/components/admin/__tests__/fairnessToggleModel.test.ts` | Copy, past-month rule, effective values. |
| `app/components/admin/__tests__/fairnessSwitch.test.tsx` | The control and the v2 note. |
| `app/components/admin/__tests__/fairnessInertV2.test.ts` | v2 inertness (C1-R12). |
| `app/components/admin/__tests__/plannerGridFairness.test.tsx` | Both grid header modes, past state, note once. |
| `app/components/admin/__tests__/fairnessEngineV3.test.tsx` | Note absent under a mocked `"v3"`. |
| `app/components/admin/__tests__/MonthGenerator.fairness.test.tsx` | Real-grid integration: stored save, past month («Roles previos»), month boundary, «+ Nuevo servicio», create bodies, held edits across Omitir/Auto/Volver. |

**Modified (production)**

| File | Change |
|---|---|
| `sanity/schemas/sunRole.ts`, `satRole.ts`, `specialRole.ts` | `countsForFairness` boolean field after `published`; no `initialValue`. |
| `app/utils/roleCreationReceipt.ts` | Validate the field; canonical key only off-default. |
| `app/utils/roleWriteRequest.ts` | `ParsedCreateRequest.countsForFairness`; `buildRoleDocument` stores it; `ParsedEditRequest.countsForFairness?`; `buildRoleEditPatch` sets it only when present. |
| `app/api/admin/roles/route.ts` | Create passes the value; `GET` projects `"countsForFairness": ${COUNTS_FOR_FAIRNESS_GROQ}`. |
| `app/api/admin/roles/[id]/route.ts` | Passes the value to the patch; skips notices when `isNoticeNeutralEdit`. |
| `app/utils/serviceMutationSideEffects.ts` | `isNoticeNeutralEdit` (pure predicate). |
| `app/utils/outboxClassify.ts` | `export` on the existing `sameSet` (the flush's comparison, reused). |
| `app/utils/protectedReadAudit.ts` | POST and PATCH `reason` strings mention the field. |
| `app/components/admin/serviceCardModel.ts` | `ServiceRole.countsForFairness?: boolean`. |
| `app/components/admin/plannerModel.ts` | `GridColumn.countsForFairness`, `DraftCard.countsForFairness`; `buildColumns` defaults; `cellsToDrafts` copies. |
| `app/utils/monthDraftCreate.ts` | `CreatableDraft.countsForFairness`; `draftCreateBody(…, todayIso?)` sends the effective value. |
| `app/components/admin/storedRoleReadModel.ts` | `StoredGridColumn.storedFairness`; `translateStoredRole` reads the row through the twin. |
| `app/components/admin/plannerSaveModel.ts` | Body and snapshot carry the value; `serializeStoredColumn(…, todayIso?)` applies §6.0. |
| `app/components/ui/Switch.tsx` | Forwards `aria-describedby`. |
| `app/components/admin/PlannerGrid.tsx` | `StoredHeaderPatch`; optional `fairness` prop; header switches; note once. |
| `app/components/admin/MonthCalendar.tsx` | Composer switch; `onAddSpecial(date, name, countsForFairness)`. |
| `app/components/admin/MonthGenerator.tsx` | Held create edits, stored overlay, «+ Nuevo servicio» switch/identity/verification/reset, wiring. |

**Modified (tests, fixtures, docs)** — listed in each task. Docs: `docs/DATA_MODEL.md`, `docs/API_REFERENCE.md`, `docs/NOTIFICATIONS.md`, `docs/MONTH_GRID_EDITING.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `docs/adr/0010-specials-fill-locally-not-in-the-solver.md`, `CLAUDE.md`, `AGENTS.md`.

---

## Task 0: Branch

**Files:** none.

- [ ] **Step 1: Branch from the current `main`**

C0 (`claude/solver-v3-c0-ci-split`) is not on `origin/main` as of `4759a214`. If it has merged by the time you start, `origin/main` already contains it; either way branch from `origin/main`:

```bash
git fetch origin
git switch -c claude/solver-v3-c1-fairness-toggle origin/main
git log -1 --oneline
```

If the coordinator runs this in a worktree (CLAUDE.md: only when two things must be in flight at once), use `EnterWorktree`, populate `node_modules` with `cp -Rc` from a lockfile-matching checkout (never a fresh install), and symlink `.env.local` to the primary checkout's copy — never write one inside the worktree.

---

## Task 1: Step zero — freeze the fingerprints and `ROLE_PROJECTION` on the unchanged code

Spec §7 «Step zero»: the delivery's first commit adds literal fingerprints and a literal of `ROLE_PROJECTION`, asserted on the unchanged code. They stay green through the whole delivery.

**Files:**
- Modify: `app/utils/__tests__/roleCreationReceipt.test.ts` (append)
- Modify: `app/utils/__tests__/serviceReadQueries.test.ts` (append)

**Interfaces:**
- Consumes: `payloadFingerprint`, `RoleCreatePayload` (`app/utils/roleCreationReceipt.ts`, already imported by the test file); `ROLE_PROJECTION` (`app/utils/serviceReadQueries.ts:17-26`, already imported).
- Produces: the module-scope constant `FROZEN` in `roleCreationReceipt.test.ts` — `Record<string, { payload: RoleCreatePayload; fingerprint: string }>` with keys `sundayFilledPublished`, `sundayDatetimeDate`, `saturdayEmptyDraft`, `saturdayNoSeatKeys`, `specialPlainEmptyDraft`, `specialTimeEmptyDraft`, `specialFormatEmptyDraft`, `specialTimeFormatFilledPublished`. Task 4 appends tests to the same file that read `FROZEN.sundayFilledPublished`, `FROZEN.saturdayEmptyDraft` and `FROZEN.specialPlainEmptyDraft`.

- [ ] **Step 1: Append the frozen fingerprints**

Append to the end of `app/utils/__tests__/roleCreationReceipt.test.ts`:

```ts

// ─── Step zero (solver v3 C1 §7) — captured on the unchanged code ────────────
//
// Computed with `payloadFingerprint` BEFORE `countsForFairness` existed (origin/main
// 4759a214, 2026-10-05). They stay green through C1 and everything after it: a red
// literal is a finding — a retry sent by a tab loaded before the change would stop
// replaying its receipt — never a value to re-capture.
const FROZEN = {
  sundayFilledPublished: {
    payload: {
      _type: "sunday_role", date: "2026-07-05", published: true,
      leads: ["m-ana", "m-beto"], bgvs: ["m-caro"], chorus: ["m-dani"],
      instruments: [{ instrument: "Guitarra", personId: "m-eli" }, { instrument: "Bajo", personId: "m-fer" }],
      foh: [{ role: "Sonido", personId: "m-gabo" }],
    },
    fingerprint: "4753d40e4948396aac0a70055c9fa9283ebd28db9646af35c9a262acf597eab5",
  },
  sundayDatetimeDate: {
    payload: {
      _type: "sunday_role", date: "2026-07-05T12:00:00Z", published: true,
      leads: ["m-ana", "m-beto"], bgvs: ["m-caro"], chorus: ["m-dani"],
      instruments: [{ instrument: "Guitarra", personId: "m-eli" }, { instrument: "Bajo", personId: "m-fer" }],
      foh: [{ role: "Sonido", personId: "m-gabo" }],
    },
    fingerprint: "4753d40e4948396aac0a70055c9fa9283ebd28db9646af35c9a262acf597eab5",
  },
  saturdayEmptyDraft: {
    payload: { _type: "saturday_role", date: "2026-07-04", published: false, leads: [], bgvs: [], chorus: [], instruments: [], foh: [] },
    fingerprint: "1c2d9d3715313ebda773e4cf444677e196d73bf9fb8e82e4b089af212700629f",
  },
  saturdayNoSeatKeys: {
    payload: { _type: "saturday_role", date: "2026-07-11" },
    fingerprint: "db75df926b3729d18426728d2cdca5baa9d17362bb6e7c5b0e8289dd9d9bee64",
  },
  specialPlainEmptyDraft: {
    payload: { _type: "special_role", date: "2026-04-03", service_name: "Viernes Santo", published: false, leads: [], bgvs: [], chorus: [], instruments: [], foh: [] },
    fingerprint: "26424c6356af86a9710da4b44dbd221404e33308c0989b42fc493ed9d1f0055f",
  },
  specialTimeEmptyDraft: {
    payload: { _type: "special_role", date: "2026-04-03", service_name: "Viernes Santo", time: "09:00", published: false, leads: [], bgvs: [], chorus: [], instruments: [], foh: [] },
    fingerprint: "f392af30ca7c9cb7d6fbe6077aa6864a301a6a700691b362f1f1b0d1f2e4c3ee",
  },
  specialFormatEmptyDraft: {
    payload: { _type: "special_role", date: "2026-04-04", service_name: "Noche", format: "worship_night", published: false, leads: [], bgvs: [], chorus: [], instruments: [], foh: [] },
    fingerprint: "c7950d2ddfedc3ce3d8adafd0e77592a87106b316c5b8b4f0f681dd726c7f3cc",
  },
  specialTimeFormatFilledPublished: {
    payload: {
      _type: "special_role", date: "2026-04-04", service_name: "Noche · Bloque 1", time: "19:30", format: "worship_night", published: true,
      leads: ["m-ana"], bgvs: ["m-beto"], chorus: ["m-caro"],
      instruments: [{ instrument: "Piano", personId: "m-dani" }],
      foh: [{ role: "Audio", personId: "m-eli" }],
    },
    fingerprint: "adfd6ca403ee1e4b3ff19bf349b73e42c43a0c6d254ba9cd7376077de0fc6179",
  },
} satisfies Record<string, { payload: RoleCreatePayload; fingerprint: string }>;

describe("payloadFingerprint — frozen pre-C1 literals (solver v3 C1 step zero)", () => {
  it.each(Object.entries(FROZEN))("%s hashes to its frozen literal", (_label, row) => {
    expect(payloadFingerprint(row.payload)).toBe(row.fingerprint);
  });
});
```

- [ ] **Step 2: Append the frozen `ROLE_PROJECTION`**

Append to the end of `app/utils/__tests__/serviceReadQueries.test.ts`:

```ts

describe("ROLE_PROJECTION — frozen (solver v3 C1 step zero)", () => {
  it("is byte-identical to its pre-C1 text: countsForFairness never rides the shared projection", () => {
    expect(ROLE_PROJECTION).toBe([
      "{",
      "  _id, _rev, _type, published, week, date, service_name, time, format,",
      "  creationReceiptId, creationFingerprint,",
      "  Lead[]{ _key, _type, _ref },",
      "  BGVs[]{ _key, _type, _ref },",
      "  Chorus[]{ _key, _type, _ref },",
      "  instruments[]{ _key, _type, instrument, person{ _type, _ref } },",
      "  foh_team[]{ _key, _type, role, person{ _type, _ref } },",
      "  songs[]{ _key, play_key, medley_tag, song{ _type, _ref }, leads[]{ _key, _type, _ref } }",
      "}",
    ].join("\n"));
    expect(ROLE_PROJECTION).not.toContain("countsForFairness");
  });
});
```

- [ ] **Step 3: Run the two files — they PASS on the unchanged code (they are characterization tests)**

Run: `npx vitest run app/utils/__tests__/roleCreationReceipt.test.ts app/utils/__tests__/serviceReadQueries.test.ts`
Expected: PASS (57 tests). If any literal fails here, the tree is not `4759a214`-equivalent for these modules: stop and report.

- [ ] **Step 4: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: no tsc output; vitest all green; eslint `0 errors`.

- [ ] **Step 5: Commit**

```bash
git add app/utils/__tests__/roleCreationReceipt.test.ts app/utils/__tests__/serviceReadQueries.test.ts
git commit -m "test(roles): freeze create fingerprints and ROLE_PROJECTION before countsForFairness" \
  -m "Solver v3 C1 step zero. The create fingerprint must stay byte-identical for every payload that omits the new field or sends its type default, or a retry from a tab loaded before the change stops replaying its receipt. Captured on the unchanged code so a red literal is a finding, never a re-capture."
```

---

## Task 2: The read rule — `app/utils/countsForFairness.ts`

C1-R2, §5.2: one GROQ fragment, one TS twin, one default, in one neutral module.

**Files:**
- Create: `app/utils/countsForFairness.ts`
- Test: `app/utils/__tests__/countsForFairness.test.ts` (create)
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Produces (spec §9, exact): `export type FairnessRoleType = "sunday_role" | "saturday_role" | "special_role"`; `export const COUNTS_FOR_FAIRNESS_GROQ = 'coalesce(countsForFairness, _type != "special_role")'`; `export function countsForFairnessDefault(roleType: FairnessRoleType): boolean`; `export function countsForFairness(doc: { _type: string; countsForFairness?: boolean | null }): boolean`.

- [ ] **Step 1: Write the failing test**

Create `app/utils/__tests__/countsForFairness.test.ts`:

```ts
// Solver v3 C1-R2 — ONE read rule for «Cuenta para equidad»: the GROQ fragment, its
// TypeScript twin and the type default must agree on every stored state of every
// role type, and nothing else may spell the fragment.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, parse } from "groq-js";
import { describe, expect, it } from "vitest";

import {
  COUNTS_FOR_FAIRNESS_GROQ,
  countsForFairness,
  countsForFairnessDefault,
  type FairnessRoleType,
} from "@/app/utils/countsForFairness";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TYPES: FairnessRoleType[] = ["sunday_role", "saturday_role", "special_role"];
const STORED: (boolean | null | undefined)[] = [undefined, null, true, false];

interface Doc {
  _id: string;
  _type: FairnessRoleType;
  countsForFairness?: boolean | null;
}

/** The 12 documents of the spec's domain: {absent, null, true, false} x the three role types. */
function domain(): Doc[] {
  const docs: Doc[] = [];
  for (const type of TYPES) {
    for (const stored of STORED) {
      const doc: Doc = { _id: `${type}.${String(stored)}`, _type: type };
      if (stored !== undefined) doc.countsForFairness = stored;
      docs.push(doc);
    }
  }
  return docs;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("countsForFairness — one read rule (solver v3 C1-R2)", () => {
  it("spells the fragment exactly", () => {
    expect(COUNTS_FOR_FAIRNESS_GROQ).toBe('coalesce(countsForFairness, _type != "special_role")');
  });

  it("defaults weekend services to counted and specials to not counted", () => {
    expect(countsForFairnessDefault("sunday_role")).toBe(true);
    expect(countsForFairnessDefault("saturday_role")).toBe(true);
    expect(countsForFairnessDefault("special_role")).toBe(false);
  });

  it("the GROQ fragment, the twin and the default agree on all 12 documents", async () => {
    const dataset = domain();
    expect(dataset).toHaveLength(12);
    const query = `*[_type in ["sunday_role", "saturday_role", "special_role"]]{ _id, "counts": ${COUNTS_FOR_FAIRNESS_GROQ} }`;
    const rows = (await (await evaluate(parse(query), { dataset })).get()) as { _id: string; counts: boolean }[];
    const fragment = new Map(rows.map((row) => [row._id, row.counts]));
    expect(fragment.size).toBe(12);
    for (const doc of dataset) {
      const twin = countsForFairness(doc);
      const expected =
        typeof doc.countsForFairness === "boolean" ? doc.countsForFairness : countsForFairnessDefault(doc._type);
      expect(twin, doc._id).toBe(expected);
      expect(fragment.get(doc._id), doc._id).toBe(twin);
    }
  });

  it("keeps the fragment a plain quoted string in a neutral, import-free module", () => {
    const src = readFileSync(path.join(REPO_ROOT, "app/utils/countsForFairness.ts"), "utf8");
    expect(src).toContain(`'coalesce(countsForFairness, _type != "special_role")'`);
    expect(src).not.toMatch(/`[^`]*coalesce\(countsForFairness/);
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  it("is the only source file under app/ and sanity/ that spells the fragment", () => {
    const spelling = [...sourceFiles(path.join(REPO_ROOT, "app")), ...sourceFiles(path.join(REPO_ROOT, "sanity"))]
      .filter((file) => readFileSync(file, "utf8").includes("coalesce(countsForFairness"))
      .map((file) => path.relative(REPO_ROOT, file));
    expect(spelling).toEqual(["app/utils/countsForFairness.ts"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/utils/__tests__/countsForFairness.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/utils/countsForFairness"`.

- [ ] **Step 3: Create the module**

Create `app/utils/countsForFairness.ts`:

```ts
// app/utils/countsForFairness.ts
//
// THE read rule for a role document's «Cuenta para equidad» (solver v3 C1, parent L1):
// one GROQ fragment, one TypeScript twin, one type default. No other file spells the
// fragment or the default. Under v2 nothing computes with it; C2's ledger is the
// first reader, and the GET /api/admin/roles row is the planner's.
//
// NEUTRAL (ADR-0028): no "use client", no server-only import, no Sanity client and no
// imports at all, so route handlers, the server-only receipt module, C2's ledger and
// client components can all import it. It runs no query, so the protected-read audit
// yields no site for it.
//
// The fragment is a PLAIN quoted string on purpose, never a template literal:
// draftGatingCoverage.test.ts reads every template literal outside __tests__ that
// names a role type, and this module sits outside its exempt prefixes. A query that
// embeds the fragment interpolates the constant into its own literal.

export type FairnessRoleType = "sunday_role" | "saturday_role" | "special_role";

/** The GROQ read rule: the stored flag, else the type default (weekends count, specials do not). */
export const COUNTS_FOR_FAIRNESS_GROQ = 'coalesce(countsForFairness, _type != "special_role")';

/** The type default (parent D14): Sunday and Saturday services count, specials do not. */
export function countsForFairnessDefault(roleType: FairnessRoleType): boolean {
  return roleType !== "special_role";
}

/**
 * The TypeScript twin of COUNTS_FOR_FAIRNESS_GROQ: the stored value when it is a
 * boolean, the type default when it is absent or null. Agrees with the fragment on
 * every (absent | null | true | false) x role type pair — countsForFairness.test.ts
 * evaluates both with groq-js.
 */
export function countsForFairness(doc: { _type: string; countsForFairness?: boolean | null }): boolean {
  if (typeof doc.countsForFairness === "boolean") return doc.countsForFairness;
  return doc._type !== "special_role";
}
```

- [ ] **Step 4: Regenerate the colour inventory (a new file under `app/` changes `filesScanned`)**

Run: `node scripts/colour-inventory.mjs`
Expected: `colour-inventory: 317 literal rows, 22 compositing classes, 11 pairs → app/utils/__tests__/__fixtures__/colour-inventory.json`

- [ ] **Step 5: Run the new test and the guards it must not disturb**

Run: `npx vitest run app/utils/__tests__/countsForFairness.test.ts app/utils/__tests__/draftGatingCoverage.test.ts app/utils/__tests__/protectedReadAudit.test.ts app/utils/__tests__/clientBoundary.test.ts app/utils/__tests__/colourInventory.test.ts`
Expected: PASS (no edit to the guards' tables).

- [ ] **Step 6: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all tests green; eslint 0 errors.

- [ ] **Step 7: Commit**

```bash
git add app/utils/countsForFairness.ts app/utils/__tests__/countsForFairness.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(fairness): one read rule for countsForFairness" \
  -m "Solver v3 C1 §5.2: the GROQ fragment, its TypeScript twin and the type default live in one neutral, import-free module that route handlers, the receipt module, C2's ledger and client components can all import. The fragment is a plain string so draftGatingCoverage's template-literal scan never sees it; a groq-js test proves fragment, twin and default agree on all twelve stored states."
```

---

## Task 3: The Studio field on the three role schemas

C1-R1, §5.1 «Studio»: a visible boolean «Cuenta para equidad», read-only with its document, no `initialValue`, not an internal field.

**Files:**
- Modify: `sanity/schemas/sunRole.ts:31-37`, `sanity/schemas/satRole.ts:31-37`, `sanity/schemas/specialRole.ts:31-37`
- Test: `app/utils/__tests__/countsForFairnessSchema.test.ts` (create)

**Interfaces:**
- Consumes: `sundayRole` (`sanity/schemas/sunRole.ts`), `saturdayRole` (`satRole.ts`), `specialRole` (`specialRole.ts`), `isInternalStudioField(type, field)` (`app/utils/studioProtection.ts`).
- Produces: the stored field's Studio declaration. No code imports it.

- [ ] **Step 1: Write the failing test**

Create `app/utils/__tests__/countsForFairnessSchema.test.ts`:

```ts
// Solver v3 C1-R1 — the three role types declare «Cuenta para equidad»: a visible
// boolean, read-only with its document, with no Studio default (the default has one
// spelling, app/utils/countsForFairness.ts, which sanity/ cannot import).
import { describe, expect, it } from "vitest";

import { saturdayRole } from "@/sanity/schemas/satRole";
import { specialRole } from "@/sanity/schemas/specialRole";
import { sundayRole } from "@/sanity/schemas/sunRole";
import { isInternalStudioField } from "@/app/utils/studioProtection";

interface Field {
  name: string;
  title?: string;
  type: string;
  hidden?: unknown;
  initialValue?: unknown;
  description?: string;
}

const SCHEMAS = [
  ["sunday_role", sundayRole],
  ["saturday_role", saturdayRole],
  ["special_role", specialRole],
] as const;

describe("countsForFairness in the Studio (solver v3 C1-R1)", () => {
  it.each(SCHEMAS)("%s declares a visible boolean «Cuenta para equidad» and stays read-only", (typeName, schema) => {
    expect(schema.name).toBe(typeName);
    expect(schema.readOnly).toBe(true);
    const field = (schema.fields as unknown as Field[]).find((f) => f.name === "countsForFairness");
    expect(field, `${typeName}.countsForFairness`).toBeTruthy();
    expect(field?.type).toBe("boolean");
    expect(field?.title).toBe("Cuenta para equidad");
    expect(field?.hidden).toBeUndefined();
    expect("initialValue" in (field ?? {})).toBe(false);
    expect(field?.description).toBe(
      "Vacío = valor del tipo: domingo y sábado sí, especial no. Solo lo usa el nuevo solver.",
    );
    expect(isInternalStudioField(typeName, "countsForFairness")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/utils/__tests__/countsForFairnessSchema.test.ts`
Expected: FAIL — `sunday_role.countsForFairness: expected undefined to be truthy` (×3).

- [ ] **Step 3: Add the field to each schema**

In **each** of `sanity/schemas/sunRole.ts`, `sanity/schemas/satRole.ts` and `sanity/schemas/specialRole.ts`, find this block (identical in all three, exactly once per file):

```ts
    {
      name: "published",
      title: "Publicado",
      type: "boolean",
      initialValue: true,
      description: "Si está apagado, el servicio es un borrador visible solo para admins.",
    },
```

and replace it with:

```ts
    {
      name: "published",
      title: "Publicado",
      type: "boolean",
      initialValue: true,
      description: "Si está apagado, el servicio es un borrador visible solo para admins.",
    },
    // «Cuenta para equidad» (solver v3 C1). Visible and read-only like `published` —
    // the whole document is readOnly. NO `initialValue`: the Studio cannot create these
    // documents, and the default has ONE spelling, app/utils/countsForFairness.ts,
    // which sanity/ cannot import. The description is copy, not a second spelling.
    {
      name: "countsForFairness",
      title: "Cuenta para equidad",
      type: "boolean",
      description: "Vacío = valor del tipo: domingo y sábado sí, especial no. Solo lo usa el nuevo solver.",
    },
```

Do **not** add the field to `INTERNAL_STUDIO_FIELDS` (`app/utils/studioProtection.ts`).

- [ ] **Step 4: Run the schema test and the Studio guards**

Run: `npx vitest run app/utils/__tests__/countsForFairnessSchema.test.ts app/utils/__tests__/studioProtection.test.ts app/utils/__tests__/serviceTimeSchemaSync.test.ts app/utils/__tests__/countsForFairness.test.ts`
Expected: PASS (44 tests).

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors (the three schema files carry pre-existing `no-explicit-any` warnings only).

- [ ] **Step 6: Commit**

```bash
git add sanity/schemas/sunRole.ts sanity/schemas/satRole.ts sanity/schemas/specialRole.ts app/utils/__tests__/countsForFairnessSchema.test.ts
git commit -m "feat(schema): «Cuenta para equidad» on the three role types" \
  -m "Solver v3 C1-R1. A visible boolean, read-only with its document like published. No initialValue: the Studio cannot create role documents, and a Studio default would be a second spelling of the rule that only app/utils/countsForFairness.ts may hold."
```

---

## Task 4: Create — validate, fingerprint off-default only, store the effective boolean

C1-R3, C1-R4, C1-D3, C1-D4, §5.3. The `harness mirror` row of §7.

**Files:**
- Modify: `app/utils/roleCreationReceipt.ts` (imports `:21-26`; `RoleCreatePayload` `:37-49`; `CanonicalCreatePayload` `:56-80`; issue doc `:84`; `canonicalizeCreatePayload` `:137-203`)
- Modify: `app/utils/roleWriteRequest.ts` (imports `:18-31`; `buildRoleDocument` `:203-230`; `ParsedCreateRequest` `:260-275`; `parseCreateRequest` `:283-318`)
- Modify: `app/api/admin/roles/route.ts:224-236` (the `buildRoleDocument` call)
- Modify: `app/utils/protectedReadAudit.ts:179-184` (POST `reason`)
- Modify (fixtures for the new required argument): `app/utils/__tests__/roleWriteRequest.test.ts`, `app/utils/__tests__/solverHistoryEvidence.test.ts:83-95`, `app/utils/__tests__/solverHistoryEquivalence.test.ts:84-96`
- Test: `app/utils/__tests__/roleCreationReceipt.test.ts` (append), `app/utils/__tests__/roleWriteRequest.test.ts` (append), `app/api/__tests__/roleWriteRoutes.test.ts` (insert), `scripts/lib/__tests__/sr-verification.test.mjs` (rows + one test)

**Interfaces:**
- Consumes: `countsForFairnessDefault` (Task 2); `FROZEN` (Task 1).
- Produces:
  - `RoleCreatePayload.countsForFairness?: unknown`
  - `CanonicalCreatePayload.countsForFairness?: boolean` — present only off the type default
  - issue tag `"countsForFairness"` from `canonicalizeCreatePayload` (so `parseCreateRequest` fails with `{ ok: false, issues: ["countsForFairness"] }` and the route answers `400 invalid_request`)
  - `ParsedCreateRequest.countsForFairness: boolean` (the request's value, else the type default)
  - `buildRoleDocument(input: { …; countsForFairness: boolean; … })` — **required**; the document always carries `countsForFairness`

- [ ] **Step 1: Write the failing receipt tests**

Append to the end of `app/utils/__tests__/roleCreationReceipt.test.ts` (after Task 1's block):

```ts

describe("countsForFairness in the create fingerprint (solver v3 C1-R4, §5.3.2)", () => {
  const sunday = FROZEN.sundayFilledPublished;
  const saturday = FROZEN.saturdayEmptyDraft;
  const special = FROZEN.specialPlainEmptyDraft;

  it("hashes the type default sent explicitly exactly like the frozen pre-C1 literal", () => {
    expect(payloadFingerprint({ ...sunday.payload, countsForFairness: true })).toBe(sunday.fingerprint);
    expect(payloadFingerprint({ ...saturday.payload, countsForFairness: true })).toBe(saturday.fingerprint);
    expect(payloadFingerprint({ ...special.payload, countsForFairness: false })).toBe(special.fingerprint);
  });

  it("leaves the key out of the canonical value at the default", () => {
    expect("countsForFairness" in canonicalizeCreatePayload({ ...sunday.payload, countsForFairness: true }).canonical).toBe(false);
    expect("countsForFairness" in canonicalizeCreatePayload({ ...special.payload, countsForFairness: false }).canonical).toBe(false);
  });

  it("changes the hash for an off-default value and keeps the version at 1", () => {
    const off = canonicalizeCreatePayload({ ...sunday.payload, countsForFairness: false });
    expect(off.valid).toBe(true);
    expect(off.canonical.v).toBe(1);
    expect(off.canonical.countsForFairness).toBe(false);
    expect(payloadFingerprint({ ...sunday.payload, countsForFairness: false })).not.toBe(sunday.fingerprint);

    const on = canonicalizeCreatePayload({ ...special.payload, countsForFairness: true });
    expect(on.valid).toBe(true);
    expect(on.canonical.countsForFairness).toBe(true);
    expect(payloadFingerprint({ ...special.payload, countsForFairness: true })).not.toBe(special.fingerprint);
  });

  it.each([
    ["null", null],
    ['the string "true"', "true"],
    ["the number 1", 1],
    ["an object", {}],
  ])("refuses %s as issue countsForFairness, deterministically and without throwing", (_label, value) => {
    const result = canonicalizeCreatePayload({ ...sunday.payload, countsForFairness: value });
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("countsForFairness");
    expect("countsForFairness" in result.canonical).toBe(false);
    expect(payloadFingerprint({ ...sunday.payload, countsForFairness: value })).toBe(
      payloadFingerprint({ ...sunday.payload, countsForFairness: value }),
    );
  });

  it("leaves the key out when the role type or the date is invalid (the payload is refused anyway)", () => {
    expect("countsForFairness" in canonicalizeCreatePayload({ ...sunday.payload, _type: "post", countsForFairness: false }).canonical).toBe(false);
    expect("countsForFairness" in canonicalizeCreatePayload({ ...sunday.payload, date: "2026-02-30", countsForFairness: false }).canonical).toBe(false);
  });

  it("refuses no pre-C1 payload: every frozen row still canonicalizes valid", () => {
    for (const [label, row] of Object.entries(FROZEN)) {
      expect(canonicalizeCreatePayload(row.payload).valid, label).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Write the failing parser/builder tests**

Append to the end of `app/utils/__tests__/roleWriteRequest.test.ts`:

```ts

describe("countsForFairness on create (solver v3 C1-R3)", () => {
  it.each([
    ["sunday_role", {}, true],
    ["saturday_role", {}, true],
    ["special_role", { service_name: "Vigilia" }, false],
  ] as const)("an absent value on %s parses to the type default", (type, extra, expected) => {
    const parsed = parseCreateRequest(createBody({ _type: type, ...extra }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.countsForFairness).toBe(expected);
  });

  it.each([true, false])("an explicit %s parses through unchanged", (value) => {
    const parsed = parseCreateRequest(createBody({ countsForFairness: value }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.countsForFairness).toBe(value);
  });

  it.each([null, "true", 1])("refuses %s with the single issue countsForFairness", (value) => {
    expect(parseCreateRequest(createBody({ countsForFairness: value }))).toEqual({
      ok: false,
      issues: ["countsForFairness"],
    });
  });

  it("stores the explicit effective boolean on the document (C1-D4)", () => {
    for (const value of [true, false]) {
      const doc = buildRoleDocument({
        roleId: "role-9",
        roleType: "sunday_role",
        date: "2026-08-09",
        serviceName: null,
        time: null,
        format: null,
        published: false,
        countsForFairness: value,
        seats: normalizeSeats(createBody()),
        receiptId: "roleCreate.abc",
        fingerprint: "fp",
        nextKey: () => "k",
      });
      expect(doc.countsForFairness).toBe(value);
    }
  });
});
```

- [ ] **Step 3: Write the failing route tests**

In `app/api/__tests__/roleWriteRoutes.test.ts`, find (exactly once):

```ts
describe("PATCH /api/admin/roles/[id] — edit", () => {
```

and replace it with:

```ts
describe("POST /api/admin/roles — countsForFairness (solver v3 C1 §5.3)", () => {
  function createdRole(type: string): Record<string, unknown> {
    const op = committedTransactions()[0]?.ops.find((o) => o.kind === "create" && o.doc._type === type);
    if (!op || op.kind !== "create") throw new Error(`no created ${type}`);
    return op.doc;
  }

  it.each([
    ["sunday_role", {}, true],
    ["saturday_role", { date: "2026-08-08" }, true],
    ["special_role", { service_name: "Bautizos" }, false],
  ] as const)("stores the type default on a %s whose body omits the field", async (type, extra, expected) => {
    const res = await createPOST(req(createBody({ _type: type, ...extra, creationRequestId: `req-cff-${type}` })));
    expect(res.status).toBe(201);
    expect(createdRole(type).countsForFairness).toBe(expected);
  });

  it.each([true, false])("stores an explicit %s", async (value) => {
    const res = await createPOST(req(createBody({ countsForFairness: value, creationRequestId: `req-cff-explicit-${value}` })));
    expect(res.status).toBe(201);
    expect(createdRole("sunday_role").countsForFairness).toBe(value);
  });

  it.each([
    ["null", null],
    ['the string "true"', "true"],
    ["the number 1", 1],
  ])("refuses %s with 400 before any read, writing no receipt, role or lock", async (_label, value) => {
    const res = await createPOST(req(createBody({ countsForFairness: value })));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request", details: { issues: ["countsForFairness"] } });
    expect(operationalFetch).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("replays a receipt written for the same off-default value, with no writes", async () => {
    store.receipts.push(receipt({ fingerprint: payloadFingerprint(createBody({ countsForFairness: false })) }));
    store.roles.push(role({ countsForFairness: false }));
    const res = await createPOST(req(createBody({ countsForFairness: false })));
    expect(res.status).toBe(200);
    expect((await res.json()).replay).toBe(true);
    expect(transactions).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("replays a pre-C1 receipt for a retry that now sends the type default explicitly", async () => {
    store.receipts.push(receipt());
    store.roles.push(role());
    const res = await createPOST(req(createBody({ countsForFairness: true })));
    expect(res.status).toBe(200);
    expect((await res.json()).replay).toBe(true);
    expect(transactions).toHaveLength(0);
  });

  it("refuses the same request id with the toggle flipped as idempotency_mismatch — never a silent replay", async () => {
    store.receipts.push(receipt({ fingerprint: payloadFingerprint(createBody({ countsForFairness: false })) }));
    store.roles.push(role({ countsForFairness: false }));
    for (const flipped of [createBody(), createBody({ countsForFairness: true })]) {
      const res = await createPOST(req(flipped));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("idempotency_mismatch");
    }
    expect(transactions).toHaveLength(0);
  });

  it("pushes and queues exactly as a toggle-less create does", async () => {
    await createPOST(req(createBody({ published: true, countsForFairness: false })));
    await drainAfter();
    expect(sendPushMock).toHaveBeenCalledWith(["mem-1", "mem-2"], "assignments", expect.anything());
    expect(queuedMemberIds()).toEqual(["mem-1", "mem-2"]);
  });
});

describe("PATCH /api/admin/roles/[id] — edit", () => {
```

- [ ] **Step 4: Add the harness-mirror parity rows**

In `scripts/lib/__tests__/sr-verification.test.mjs`, find:

```js
    { _type: "sunday_role", date: "2026-08-02", service_name: "stray" }, // weekend roles ignore service_name
  ];
```

and replace it with:

```js
    { _type: "sunday_role", date: "2026-08-02", service_name: "stray" }, // weekend roles ignore service_name
    // Solver v3 C1: the type default sent explicitly — weekend `true`, special `false` —
    // enters neither canonical value, so both copies hash it like an absent field.
    // The mirror does not model an OFF-default value, as it does not model time/format.
    { _type: "sunday_role", date: "2026-08-02", countsForFairness: true },
    { _type: "saturday_role", date: "2026-08-01", countsForFairness: true },
    { _type: "special_role", date: "2026-09-12", service_name: "Vigilia", countsForFairness: false },
  ];
```

Then find:

```js
  it("distinguishes payloads the real helper distinguishes", () => {
```

and replace it with:

```js
  it("hashes a default-valued countsForFairness like an absent one, in both copies (C1 §5.3.2)", () => {
    const pairs = [
      [{ _type: "sunday_role", date: "2026-08-02" }, { _type: "sunday_role", date: "2026-08-02", countsForFairness: true }],
      [
        { _type: "special_role", date: "2026-09-12", service_name: "Vigilia" },
        { _type: "special_role", date: "2026-09-12", service_name: "Vigilia", countsForFairness: false },
      ],
    ];
    for (const [absent, explicit] of pairs) {
      expect(payloadFingerprint(explicit)).toBe(payloadFingerprint(absent));
      expect(mirrorPayloadFingerprint(explicit)).toBe(mirrorPayloadFingerprint(absent));
    }
  });

  it("distinguishes payloads the real helper distinguishes", () => {
```

`scripts/lib/sr-verification.mjs` itself does not change.

- [ ] **Step 5: Run the new tests to verify they fail**

Run: `npx vitest run app/utils/__tests__/roleCreationReceipt.test.ts app/utils/__tests__/roleWriteRequest.test.ts app/api/__tests__/roleWriteRoutes.test.ts`
Expected: FAIL — e.g. `expected true to be false` on «refuses null…», `expected undefined to be true` on «an absent value on sunday_role parses to the type default», and `expected 201 to be 400`.

- [ ] **Step 6: Implement in `roleCreationReceipt.ts`**

In `app/utils/roleCreationReceipt.ts`:

Find:
```ts
import { ROLE_TYPES, type RoleType } from "@/app/utils/serviceReadModel";
```
Replace with:
```ts
import { ROLE_TYPES, type RoleType } from "@/app/utils/serviceReadModel";
import { countsForFairnessDefault } from "./countsForFairness";
```

Find:
```ts
  format?: unknown;
  published?: unknown;
  leads?: unknown;
```
Replace with:
```ts
  format?: unknown;
  /** Solver v3 C1 «Cuenta para equidad»: absent, `true` or `false` — anything else is an issue. */
  countsForFairness?: unknown;
  published?: unknown;
  leads?: unknown;
```

Find:
```ts
  format?: ServiceFormat;
  published: boolean;
  leads: string[];
```
Replace with:
```ts
  format?: ServiceFormat;
  /**
   * Present ONLY when the request's value differs from its type's default — a
   * weekend `false`, a special `true` (solver v3 C1 §5.3.2). Omitted otherwise, so
   * every payload without the field, and every payload carrying its type's default
   * explicitly, hashes byte-identically to before the field existed: a receipt
   * written before C1 still replays a retry from an old tab, and
   * `FINGERPRINT_VERSION` stays 1.
   */
  countsForFairness?: boolean;
  published: boolean;
  leads: string[];
```

Find:
```ts
  /** Issue tags: payload | role_type | date | service_name. */
```
Replace with:
```ts
  /** Issue tags: payload | role_type | date | service_name | time | format | countsForFairness. */
```

Find:
```ts
  if (format && roleType !== "special_role") issues.push("format");
```
Replace with:
```ts
  if (format && roleType !== "special_role") issues.push("format");

  // `countsForFairness` is optional on every role type: absent means the type
  // default; `true`/`false` is the admin's choice; anything else — `null` included —
  // is refused rather than read as "default" (C1-D3). It enters the canonical value
  // only when it differs from the default, and only for a valid type and date.
  const rawCounts = doc.countsForFairness;
  if (rawCounts !== undefined && typeof rawCounts !== "boolean") issues.push("countsForFairness");
  const offDefaultCounts =
    roleType && date && typeof rawCounts === "boolean" && rawCounts !== countsForFairnessDefault(roleType)
      ? rawCounts
      : null;
```

Find:
```ts
      ...(format && roleType === "special_role" ? { format } : {}),
      // Effective publication default: only an exact boolean `true` publishes,
```
Replace with:
```ts
      ...(format && roleType === "special_role" ? { format } : {}),
      ...(offDefaultCounts !== null ? { countsForFairness: offDefaultCounts } : {}),
      // Effective publication default: only an exact boolean `true` publishes,
```

Do **not** change `FINGERPRINT_VERSION`.

- [ ] **Step 7: Implement in `roleWriteRequest.ts`**

In `app/utils/roleWriteRequest.ts`:

Find:
```ts
import type { ServiceFormat } from "./serviceFormat";
```
Replace with:
```ts
import type { ServiceFormat } from "./serviceFormat";
import { countsForFairnessDefault } from "./countsForFairness";
```

Find (the `buildRoleDocument` input type):
```ts
  format: ServiceFormat | null;
  published: boolean;
  seats: NormalizedSeats;
  receiptId: string;
  fingerprint: string;
  nextKey: KeyFactory;
}): { _id: string; _type: RoleType } & Record<string, unknown> {
```
Replace with:
```ts
  format: ServiceFormat | null;
  published: boolean;
  /** The EFFECTIVE «Cuenta para equidad»: always stored explicitly (C1-D4). */
  countsForFairness: boolean;
  seats: NormalizedSeats;
  receiptId: string;
  fingerprint: string;
  nextKey: KeyFactory;
}): { _id: string; _type: RoleType } & Record<string, unknown> {
```

Find:
```ts
    published: input.published,
    // Forward link to the idempotency tombstone. The receipt's own `roleId`
```
Replace with:
```ts
    published: input.published,
    countsForFairness: input.countsForFairness,
    // Forward link to the idempotency tombstone. The receipt's own `roleId`
```

Find (the `ParsedCreateRequest` interface):
```ts
  format: ServiceFormat | null;
  published: boolean;
  seats: NormalizedSeats;
  /** Deterministic weekend lock id; null for a special service. */
```
Replace with:
```ts
  format: ServiceFormat | null;
  published: boolean;
  /** The request's «Cuenta para equidad», else the type default (C1-D4). */
  countsForFairness: boolean;
  seats: NormalizedSeats;
  /** Deterministic weekend lock id; null for a special service. */
```

Find (in `parseCreateRequest`):
```ts
      published: canonical.published,
      seats: normalizeSeats(payload),
```
Replace with:
```ts
      published: canonical.published,
      countsForFairness:
        typeof payload.countsForFairness === "boolean"
          ? payload.countsForFairness
          : countsForFairnessDefault(roleType),
      seats: normalizeSeats(payload),
```

(`canonicalizeCreatePayload` already refused any non-boolean, so the parser never reaches this line with one.)

- [ ] **Step 8: Pass the value in the create route**

In `app/api/admin/roles/route.ts`, find:
```ts
    published: request.published,
    seats: request.seats,
    receiptId: request.receiptId,
```
Replace with:
```ts
    published: request.published,
    countsForFairness: request.countsForFairness,
    seats: request.seats,
    receiptId: request.receiptId,
```

- [ ] **Step 9: Update the POST reason in the protected-read audit (spec §11)**

In `app/utils/protectedReadAudit.ts`, find:
```ts
      "guarded role create: one transaction creates the deterministic roleCreationReceipt, the role, and the claimed/reclaimed weekend roleTargetLock (A2 §2)",
```
Replace with:
```ts
      "guarded role create: one transaction creates the deterministic roleCreationReceipt, the role, and the claimed/reclaimed weekend roleTargetLock (A2 §2); the role always stores the effective countsForFairness boolean, and the fingerprint carries it only off the type default (solver v3 C1)",
```

- [ ] **Step 10: Give the existing `buildRoleDocument` callers the new required argument**

`tsc` now refuses every existing call that omits `countsForFairness`. Fix exactly these (fixture-only; no assertion changes):

In `app/utils/__tests__/roleWriteRequest.test.ts`, find:
```ts
      format: null,
      published: true,
      seats: normalizeSeats(createBody()),
      receiptId: "roleCreate.abc",
```
Replace with:
```ts
      format: null,
      published: true,
      countsForFairness: true,
      seats: normalizeSeats(createBody()),
      receiptId: "roleCreate.abc",
```

In the same file, replace **both** occurrences (replace-all) of:
```ts
format: null, published: false, seats, receiptId: "rc"
```
with:
```ts
format: null, published: false, countsForFairness: false, seats, receiptId: "rc"
```

and find (once):
```ts
time: null, published: false, seats, receiptId: "rc", fingerprint: "fp", nextKey } as const;
```
Replace with:
```ts
time: null, published: false, countsForFairness: false, seats, receiptId: "rc", fingerprint: "fp", nextKey } as const;
```

In **both** `app/utils/__tests__/solverHistoryEvidence.test.ts` and `app/utils/__tests__/solverHistoryEquivalence.test.ts`, find (once per file):
```ts
    published: v.published,
    seats: v.seats,
```
Replace with:
```ts
    published: v.published,
    countsForFairness: v.countsForFairness,
    seats: v.seats,
```

(These two files keep mirroring the create route's own path, which now passes the parsed value.)

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npx vitest run app/utils/__tests__/roleCreationReceipt.test.ts app/utils/__tests__/roleWriteRequest.test.ts app/api/__tests__/roleWriteRoutes.test.ts scripts/lib/__tests__/sr-verification.test.mjs app/utils/__tests__/solverHistoryEvidence.test.ts app/utils/__tests__/solverHistoryEquivalence.test.ts app/utils/__tests__/protectedReadAudit.test.ts`
Expected: PASS (390 tests). The frozen literals of Task 1 and the two pinned in `roleWriteRequest.test.ts` stay green.

- [ ] **Step 12: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors.

- [ ] **Step 13: Commit**

```bash
git add app/utils/roleCreationReceipt.ts app/utils/roleWriteRequest.ts app/api/admin/roles/route.ts app/utils/protectedReadAudit.ts \
  app/utils/__tests__/roleCreationReceipt.test.ts app/utils/__tests__/roleWriteRequest.test.ts app/api/__tests__/roleWriteRoutes.test.ts \
  scripts/lib/__tests__/sr-verification.test.mjs app/utils/__tests__/solverHistoryEvidence.test.ts app/utils/__tests__/solverHistoryEquivalence.test.ts
git commit -m "feat(roles): create accepts countsForFairness and fingerprints it only off-default" \
  -m "Solver v3 C1 §5.3. The create writer validates the field (anything but a boolean, null included, is 400 before any read), stores the effective boolean on every new document, and adds it to the canonical payload only when it differs from the type default, so every pre-C1 receipt still replays and FINGERPRINT_VERSION stays 1. A retry with the toggle flipped is 409 idempotency_mismatch, never a silent replay of the first value."
```

---

## Task 5: Edit — absent is unchanged, a boolean is set, a toggle-only PATCH queues nothing

C1-R5, C1-R6, C1-D2, C1-D3, §5.4.

**Files:**
- Modify: `app/utils/roleWriteRequest.ts` (`buildRoleEditPatch` `:236-256`; `ParsedEditRequest` `:322-333`; `parseEditRequest` `:335-362`)
- Modify: `app/utils/outboxClassify.ts:44-48` (`sameSet` gains `export` and a doc comment)
- Modify: `app/utils/serviceMutationSideEffects.ts` (imports after `:110`; new function before the «ONE deferred fan-out» doc comment)
- Modify: `app/api/admin/roles/[id]/route.ts` (import `:7-12`; `buildRoleEditPatch` call `:282-289`; side effects `:409-435`)
- Modify: `app/utils/protectedReadAudit.ts:186-191` (PATCH `reason`)
- Test: `app/utils/__tests__/roleWriteRequest.test.ts` (append), `app/utils/__tests__/serviceMutationSideEffects.test.ts` (import + append), `app/api/__tests__/roleWriteRoutes.test.ts` (insert inside the PATCH describe)

**Interfaces:**
- Consumes: `rolesForMember` (already imported by `serviceMutationSideEffects.ts` from `./assignmentEmail`), `seatAssignees`/`NormalizedSeats` (already imported from `./roleWriteRequest`), `normalizeServiceName` (`app/utils/normalizeLabel.ts:43`), `isServiceTime` (`app/utils/serviceTime.ts:20`).
- Produces:
  - `ParsedEditRequest.countsForFairness?: boolean` — present only when the body carries a boolean
  - `buildRoleEditPatch(input: { …; countsForFairness?: boolean; … })` — `set.countsForFairness` only when a boolean; never in `unset`
  - `export const sameSet: (a: string[], b: string[]) => boolean` from `outboxClassify.ts`
  - `export function isNoticeNeutralEdit(input: { carriesCountsForFairness: boolean; roleType: ServiceType; storedDate: string; requestedDate: string; storedServiceName: unknown; requestedServiceName: string | null; storedTime: unknown; requestedTime: string | null; before: NormalizedSeats; after: NormalizedSeats }): boolean` from `serviceMutationSideEffects.ts`

- [ ] **Step 1: Write the failing parser/patch tests**

Append to the end of `app/utils/__tests__/roleWriteRequest.test.ts`:

```ts

describe("countsForFairness on edit (solver v3 C1-R5, §5.4)", () => {
  const edit = (over: Record<string, unknown> = {}) =>
    parseEditRequest({ rev: "r1", date: "2026-08-09", _type: "sunday_role", leads: ["m1"], ...over });

  it("absent stays absent in the parsed request", () => {
    const parsed = edit();
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect("countsForFairness" in parsed.value).toBe(false);
  });

  it.each([true, false])("an explicit %s is carried", (value) => {
    const parsed = edit({ countsForFairness: value });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.countsForFairness).toBe(value);
  });

  it.each([null, "false", 0])("refuses %s with the single issue countsForFairness", (value) => {
    expect(edit({ countsForFairness: value })).toEqual({ ok: false, issues: ["countsForFairness"] });
  });

  it("the patch for an absent value has the key in neither set nor unset — never the time precedent", () => {
    for (const roleType of ["sunday_role", "saturday_role", "special_role"] as const) {
      const patch = buildRoleEditPatch({
        roleType,
        date: "2026-08-09",
        serviceName: roleType === "special_role" ? "Vigilia" : null,
        time: null,
        seats: normalizeSeats(createBody()),
        nextKey: () => "k",
      });
      expect("countsForFairness" in patch.set, roleType).toBe(false);
      expect(patch.unset, roleType).not.toContain("countsForFairness");
    }
  });

  it("the patch for a boolean sets it on every role type", () => {
    for (const roleType of ["sunday_role", "saturday_role", "special_role"] as const) {
      for (const value of [true, false]) {
        const patch = buildRoleEditPatch({
          roleType,
          date: "2026-08-09",
          serviceName: roleType === "special_role" ? "Vigilia" : null,
          time: null,
          countsForFairness: value,
          seats: normalizeSeats(createBody()),
          nextKey: () => "k",
        });
        expect(patch.set.countsForFairness, `${roleType}:${value}`).toBe(value);
        expect(patch.unset).not.toContain("countsForFairness");
      }
    }
  });
});
```

- [ ] **Step 2: Write the failing predicate tests**

In `app/utils/__tests__/serviceMutationSideEffects.test.ts`, find (in the import from `@/app/utils/serviceMutationSideEffects`):
```ts
  derateClock,
  opportunisticSweepOptions,
```
Replace with:
```ts
  derateClock,
  isNoticeNeutralEdit,
  opportunisticSweepOptions,
```

Then append to the end of the same file:

```ts

describe("isNoticeNeutralEdit — the toggle-only PATCH (solver v3 C1 §5.4.4)", () => {
  const seats = (over: Partial<NormalizedSeats> = {}): NormalizedSeats => ({
    leads: ["m-ana"],
    bgvs: ["m-beto"],
    chorus: [],
    instruments: [{ instrument: "Bajo", personId: "m-caro" }],
    foh: [],
    ...over,
  });
  const weekend = {
    carriesCountsForFairness: true,
    roleType: "sunday_role" as const,
    storedDate: "2026-11-01",
    requestedDate: "2026-11-01",
    storedServiceName: undefined,
    requestedServiceName: null,
    storedTime: undefined,
    requestedTime: null,
    before: seats(),
    after: seats(),
  };
  const special = {
    ...weekend,
    roleType: "special_role" as const,
    storedServiceName: "Vigilia",
    requestedServiceName: "Vigilia",
    storedTime: "19:00",
    requestedTime: "19:00",
  };

  it("is true when the request carries the field and nothing reportable changed", () => {
    expect(isNoticeNeutralEdit(weekend)).toBe(true);
    expect(isNoticeNeutralEdit(special)).toBe(true);
  });

  it("is false for every request WITHOUT the field, a pure no-op included (C1-D2)", () => {
    expect(isNoticeNeutralEdit({ ...weekend, carriesCountsForFairness: false })).toBe(false);
  });

  it("is false on a date move", () => {
    expect(isNoticeNeutralEdit({ ...weekend, requestedDate: "2026-11-08" })).toBe(false);
  });

  it("ignores a pure reorder: every member keeps the same set of labels", () => {
    expect(isNoticeNeutralEdit({
      ...weekend,
      before: seats({ leads: ["m-ana", "m-dani"] }),
      after: seats({ leads: ["m-dani", "m-ana"] }),
    })).toBe(true);
  });

  it.each([
    ["a member moved between seats", seats({ leads: [], bgvs: ["m-beto", "m-ana"] })],
    ["a member added", seats({ chorus: ["m-dani"] })],
    ["a member removed", seats({ bgvs: [] })],
    ["an instrument relabelled for the same person", seats({ instruments: [{ instrument: "Guitarra", personId: "m-caro" }] })],
  ])("is false when %s", (_label, after) => {
    expect(isNoticeNeutralEdit({ ...weekend, after })).toBe(false);
  });

  it("for a special, is false on a rename or a retime, and true across whitespace-only name noise", () => {
    expect(isNoticeNeutralEdit({ ...special, requestedServiceName: "Vigilia de oración" })).toBe(false);
    expect(isNoticeNeutralEdit({ ...special, requestedTime: "20:00" })).toBe(false);
    expect(isNoticeNeutralEdit({ ...special, requestedTime: null })).toBe(false);
    expect(isNoticeNeutralEdit({ ...special, storedServiceName: "  Vigilia " })).toBe(true);
  });

  it("ignores name and time on a weekend role, which stores neither", () => {
    expect(isNoticeNeutralEdit({ ...weekend, storedServiceName: "stray", storedTime: "09:00" })).toBe(true);
  });
});
```

- [ ] **Step 3: Write the failing route tests**

In `app/api/__tests__/roleWriteRoutes.test.ts`, find (exactly once — the end of the PATCH describe, before the Delete banner):

```ts
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });
});

// ── Delete ──
```

and replace it with (the banner line continues unchanged after `// ── Delete ──`):

```ts
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  describe("countsForFairness (solver v3 C1 §5.4)", () => {
    interface Surface {
      type: string;
      seed: () => void;
      id: string;
      body: (over?: Record<string, unknown>) => Record<string, unknown>;
    }
    const SURFACES: Surface[] = [
      {
        type: "sunday_role",
        seed: () => { store.roles.push(role()); store.locks.push(lock()); },
        id: "role-1",
        body: (over = {}) => editBody(over),
      },
      {
        type: "saturday_role",
        seed: () => {
          store.roles.push(role({ _type: "saturday_role", week: "2026-08-08" }));
          store.locks.push(lock({
            _id: "roleTarget.saturday_role.2026-08-08",
            targetKey: "saturday_role:2026-08-08",
            roleType: "saturday_role",
            date: "2026-08-08",
          }));
        },
        id: "role-1",
        body: (over = {}) => editBody({ _type: "saturday_role", date: "2026-08-08", ...over }),
      },
      {
        type: "special_role",
        seed: () => { store.roles.push(specialRole()); store.coordinators.push(coordinator()); },
        id: "role-sp",
        body: (over = {}) => specialEditBody(over),
      },
    ];

    function rolePatchOf(id: string): PatchOp {
      const op = committedTransactions()[0]?.ops.find((o): o is PatchOp => o.kind === "patch" && o.id === id);
      if (!op) throw new Error(`no committed patch for ${id}`);
      return op;
    }

    it.each(SURFACES)("$type: a body without the field puts the key in neither set nor unset", async ({ seed, id, body }) => {
      seed();
      const res = await rolePATCH(req(body()), ctx(id));
      expect(res.status).toBe(200);
      expect("countsForFairness" in rolePatchOf(id).set).toBe(false);
      expect(rolePatchOf(id).unset).not.toContain("countsForFairness");
    });

    it.each(SURFACES.flatMap((surface) => [true, false].map((value) => ({ ...surface, value }))))(
      "$type: an explicit $value is set in the same revision-asserted patch",
      async ({ seed, id, body, value }) => {
        seed();
        const res = await rolePATCH(req(body({ countsForFairness: value })), ctx(id));
        expect(res.status).toBe(200);
        expect(rolePatchOf(id)).toMatchObject({ rev: "rev-1", set: { countsForFairness: value } });
        expect(rolePatchOf(id).unset).not.toContain("countsForFairness");
      },
    );

    it.each([
      ["null", null],
      ['the string "false"', "false"],
      ["the number 0", 0],
    ])("refuses %s with 400 before any read", async (_label, value) => {
      store.roles.push(role());
      store.locks.push(lock());
      const res = await rolePATCH(req(editBody({ countsForFairness: value })), ctx("role-1"));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request", details: { issues: ["countsForFairness"] } });
      expect(operationalFetch).not.toHaveBeenCalled();
      expect(transactions).toHaveLength(0);
    });

    it("a toggle-only PATCH of a published role queues no notice and sends no push, but still revalidates", async () => {
      store.roles.push(role({ published: true }));
      store.locks.push(lock());
      const res = await rolePATCH(req(editBody({ leads: ["mem-1"], countsForFairness: false })), ctx("role-1"));
      expect(res.status).toBe(200);
      expect(committedTransactions()).toHaveLength(1);
      expect(afterCallbacks).toHaveLength(0);
      await drainAfter();
      expect(outboxUpserts()).toHaveLength(0);
      expect(sendPushMock).not.toHaveBeenCalled();
      expect(revalidateServiceViewsMock).toHaveBeenCalled();
    });

    it("a toggle-only PATCH of a published special with the same name and time queues nothing", async () => {
      store.roles.push(specialRole({ published: true }));
      store.coordinators.push(coordinator());
      const res = await rolePATCH(req(specialEditBody({ leads: ["mem-1"], countsForFairness: true })), ctx("role-sp"));
      expect(res.status).toBe(200);
      expect(afterCallbacks).toHaveLength(0);
      expect(revalidateServiceViewsMock).toHaveBeenCalled();
    });

    it("a toggle plus a seat change queues the union and pushes the added member, exactly as today", async () => {
      store.roles.push(role({ published: true }));
      store.locks.push(lock());
      await rolePATCH(req(editBody({ leads: ["mem-5"], countsForFairness: false })), ctx("role-1"));
      await drainAfter();
      expect(queuedMemberIds().sort()).toEqual(["mem-1", "mem-5"]);
      expect(sendPushMock).toHaveBeenCalledWith(["mem-5"], "assignments", expect.anything());
    });

    it("a toggle on a special that is also renamed queues as today", async () => {
      store.roles.push(specialRole({ published: true }));
      store.coordinators.push(coordinator());
      await rolePATCH(
        req(specialEditBody({ leads: ["mem-1"], service_name: "Bautizos de noche", countsForFairness: true })),
        ctx("role-sp"),
      );
      await drainAfter();
      expect(queuedMemberIds()).toEqual(["mem-1"]);
    });

    it("a toggle on a special that is also retimed queues as today", async () => {
      store.roles.push(specialRole({ published: true, time: "09:00" }));
      store.coordinators.push(coordinator());
      await rolePATCH(req(specialEditBody({ leads: ["mem-1"], time: "10:00", countsForFairness: true })), ctx("role-sp"));
      await drainAfter();
      expect(queuedMemberIds()).toEqual(["mem-1"]);
    });

    it("a request WITHOUT the field that changes nothing still queues exactly as today (C1-D2)", async () => {
      store.roles.push(role({ published: true }));
      store.locks.push(lock());
      await rolePATCH(req(editBody({ leads: ["mem-1"] })), ctx("role-1"));
      await drainAfter();
      expect(queuedMemberIds()).toEqual(["mem-1"]);
    });
  });
});

// ── Delete ──
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run app/utils/__tests__/roleWriteRequest.test.ts app/utils/__tests__/serviceMutationSideEffects.test.ts app/api/__tests__/roleWriteRoutes.test.ts`
Expected: FAIL — `isNoticeNeutralEdit is not a function`; «an explicit true is carried» (`expected undefined to be true`); «refuses null…» (`expected 200 to be 400`); «a toggle-only PATCH … queues no notice» (`expected [ …(2) ] to have a length of 0`).

- [ ] **Step 5: Implement the parser and the patch builder**

In `app/utils/roleWriteRequest.ts`:

Find:
```ts
  time: string | null;
  seats: NormalizedSeats;
  nextKey: KeyFactory;
}): { set: Record<string, unknown>; unset: string[] } {
  const special = input.roleType === "special_role";
  return {
    set: {
      [roleDateField(input.roleType)]: input.date,
      ...(special ? { service_name: input.serviceName ?? "" } : {}),
      ...(special && input.time ? { time: input.time } : {}),
      ...seatFields(input.seats, input.nextKey),
    },
```
Replace with:
```ts
  time: string | null;
  /** Solver v3 C1 §5.4: set when present; when absent the key is in neither `set` nor `unset`. */
  countsForFairness?: boolean;
  seats: NormalizedSeats;
  nextKey: KeyFactory;
}): { set: Record<string, unknown>; unset: string[] } {
  const special = input.roleType === "special_role";
  return {
    set: {
      [roleDateField(input.roleType)]: input.date,
      ...(special ? { service_name: input.serviceName ?? "" } : {}),
      ...(special && input.time ? { time: input.time } : {}),
      ...(typeof input.countsForFairness === "boolean" ? { countsForFairness: input.countsForFairness } : {}),
      ...seatFields(input.seats, input.nextKey),
    },
```

(The `unset` line stays exactly as it is: it never names `countsForFairness`.)

Find:
```ts
  /** Only for cross-checking against the STORED type — never used to convert. */
  requestedType: RoleType | null;
  seats: NormalizedSeats;
}
```
Replace with:
```ts
  /** Only for cross-checking against the STORED type — never used to convert. */
  requestedType: RoleType | null;
  /**
   * Solver v3 C1 §5.4: present ONLY when the body carries a boolean. Absent means
   * "leave the stored value untouched" — deliberately NOT the `time` precedent,
   * where an absent value clears the field.
   */
  countsForFairness?: boolean;
  seats: NormalizedSeats;
}
```

Find:
```ts
  if (hasTime && !isServiceTime(rawTime)) return fail(["time"]);
  return {
    ok: true,
    value: {
      rev: body.rev,
      lockRev: isRevisionString(body.lockRev) ? body.lockRev : null,
      date,
      serviceName: normalizeLabel(body.service_name),
      time: hasTime ? (rawTime as string) : null,
      requestedType,
      seats: normalizeSeats(body),
    },
  };
```
Replace with:
```ts
  if (hasTime && !isServiceTime(rawTime)) return fail(["time"]);
  // `countsForFairness`: absent leaves the stored value untouched; a boolean sets
  // it; anything else — `null` included — is refused here, before any read (C1-D3).
  const rawCounts = body.countsForFairness;
  if (rawCounts !== undefined && typeof rawCounts !== "boolean") return fail(["countsForFairness"]);
  return {
    ok: true,
    value: {
      rev: body.rev,
      lockRev: isRevisionString(body.lockRev) ? body.lockRev : null,
      date,
      serviceName: normalizeLabel(body.service_name),
      time: hasTime ? (rawTime as string) : null,
      requestedType,
      ...(typeof rawCounts === "boolean" ? { countsForFairness: rawCounts } : {}),
      seats: normalizeSeats(body),
    },
  };
```

- [ ] **Step 6: Export the flush's set comparison**

In `app/utils/outboxClassify.ts`, find:
```ts
const sameSet = (a: string[], b: string[]) => {
```
Replace with:
```ts
/**
 * Two label lists name the same SET (duplicates and order ignored). The flush's
 * per-member comparison — and, through `isNoticeNeutralEdit`, the toggle-only
 * PATCH's (solver v3 C1 §5.4.4), so the two can never disagree about "no change".
 */
export const sameSet = (a: string[], b: string[]) => {
```

- [ ] **Step 7: Add the predicate to the shared side-effects module**

In `app/utils/serviceMutationSideEffects.ts`, find:
```ts
import { normalizeStoredSeats, seatAssignees, type NormalizedSeats } from "./roleWriteRequest";
```
Replace with:
```ts
import { normalizeStoredSeats, seatAssignees, type NormalizedSeats } from "./roleWriteRequest";
import { sameSet } from "./outboxClassify";
import { normalizeServiceName } from "./normalizeLabel";
import { isServiceTime } from "./serviceTime";
```

Then find:
```ts
/**
 * ONE deferred fan-out for a whole committed batch: a push per destination role,
```
Replace with:
```ts
/**
 * Solver v3 C1 §5.4.4 — a PATCH that CARRIES `countsForFairness` and changes
 * nothing a notice could report queues no outbox notice and sends no push.
 *
 * "Nothing a notice could report" is the flush's own definition: the date does
 * not move; for a special, the normalized name and the time are unchanged (the
 * email names a special by both, `emailServiceLabel.ts`); and every member in the
 * union of stored and requested assignees holds the same SET of seat labels —
 * `rolesForMember` compared with the flush's `sameSet` (`outboxClassify.ts`).
 *
 * A request WITHOUT the field always answers false, so every client that predates
 * the field — a no-op save included — queues exactly as before (C1-D2). Whether
 * the stored toggle actually differs is irrelevant here, so the route needs no
 * read of it and `ROLE_PROJECTION` stays unchanged.
 */
export function isNoticeNeutralEdit(input: {
  carriesCountsForFairness: boolean;
  roleType: ServiceType;
  storedDate: string;
  requestedDate: string;
  storedServiceName: unknown;
  requestedServiceName: string | null;
  storedTime: unknown;
  requestedTime: string | null;
  before: NormalizedSeats;
  after: NormalizedSeats;
}): boolean {
  if (!input.carriesCountsForFairness) return false;
  if (input.storedDate !== input.requestedDate) return false;
  if (input.roleType === "special_role") {
    if (normalizeServiceName(input.storedServiceName) !== normalizeServiceName(input.requestedServiceName)) {
      return false;
    }
    const storedTime = isServiceTime(input.storedTime) ? input.storedTime : null;
    if (storedTime !== input.requestedTime) return false;
  }
  const members = new Set([...seatAssignees(input.before), ...seatAssignees(input.after)]);
  for (const memberId of members) {
    if (!sameSet(rolesForMember(memberId, input.before), rolesForMember(memberId, input.after))) return false;
  }
  return true;
}

/**
 * ONE deferred fan-out for a whole committed batch: a push per destination role,
```

- [ ] **Step 8: Wire the PATCH route**

In `app/api/admin/roles/[id]/route.ts`, find:
```ts
import {
  notifyRoleAssignments,
  queueRoleNotices,
  revalidateRoleMutation,
  roleUpdateNotice,
} from "@/app/utils/serviceMutationSideEffects";
```
Replace with:
```ts
import {
  isNoticeNeutralEdit,
  notifyRoleAssignments,
  queueRoleNotices,
  revalidateRoleMutation,
  roleUpdateNotice,
} from "@/app/utils/serviceMutationSideEffects";
```

Find:
```ts
    time: request.time,
    seats: request.seats,
    nextKey,
  });
```
Replace with:
```ts
    time: request.time,
    countsForFairness: request.countsForFairness,
    seats: request.seats,
    nextKey,
  });
```

Find:
```ts
  // ── Post-commit side effects (§7), all through the one shared module ───────
  // Recipients derive from committed server state across all five seat paths:
  // the previously stored assignees versus the seats just written. A draft edit
  // stays silent; published or grandfathered notifies only the newly added.
  notifyRoleAssignments([
    roleUpdateNotice({
      published: role.published,
      beforeAssignees: validateRole(role).assignedRefs,
      after: request.seats,
      type: roleType,
      date: newDate,
    }),
  ]);
  // The debounced email (§2): one notice per member in the UNION of before- and
  // after-assignees, so a member REMOVED by this edit is finally covered. On a
  // date move the snapshot stays valid — only the label moved — and the flush
  // re-dates from live state.
  queueRoleNotices({
    roleId: role._id,
    roleType,
    serviceDate: newDate,
    published: role.published,
    beforeSeats,
    afterSeats: request.seats,
  });

  revalidateRoleMutation();
```
Replace with:
```ts
  // ── Post-commit side effects (§7), all through the one shared module ───────
  // Solver v3 C1 §5.4.4: a PATCH that carries `countsForFairness` and changes
  // nothing a notice could report queues no notice and sends no push. A PATCH
  // without the field always takes the branch below, exactly as before.
  const noticeNeutral = isNoticeNeutralEdit({
    carriesCountsForFairness: request.countsForFairness !== undefined,
    roleType,
    storedDate: oldDate,
    requestedDate: newDate,
    storedServiceName: role.service_name,
    requestedServiceName: request.serviceName,
    storedTime: role.time,
    requestedTime: request.time,
    before: beforeSeats,
    after: request.seats,
  });
  if (!noticeNeutral) {
    // Recipients derive from committed server state across all five seat paths:
    // the previously stored assignees versus the seats just written. A draft edit
    // stays silent; published or grandfathered notifies only the newly added.
    notifyRoleAssignments([
      roleUpdateNotice({
        published: role.published,
        beforeAssignees: validateRole(role).assignedRefs,
        after: request.seats,
        type: roleType,
        date: newDate,
      }),
    ]);
    // The debounced email (§2): one notice per member in the UNION of before- and
    // after-assignees, so a member REMOVED by this edit is finally covered. On a
    // date move the snapshot stays valid — only the label moved — and the flush
    // re-dates from live state.
    queueRoleNotices({
      roleId: role._id,
      roleType,
      serviceDate: newDate,
      published: role.published,
      beforeSeats,
      afterSeats: request.seats,
    });
  }

  // Revalidation runs in every case, the toggle-only PATCH included.
  revalidateRoleMutation();
```

Nothing else in the route changes: the `_rev` assertion, lock heartbeat/move, coordinator, dependency refusal, legacy bootstrap and the refreshed response are untouched. The route never reads the stored toggle.

- [ ] **Step 9: Update the PATCH reason in the protected-read audit (spec §11)**

In `app/utils/protectedReadAudit.ts`, find:
```ts
      "guarded role edit: revision-asserted assignment/date patch that also vacates the old and claims the new weekend roleTargetLock on a permitted date move (A2 §2)",
```
Replace with:
```ts
      "guarded role edit: revision-asserted assignment/date patch that also vacates the old and claims the new weekend roleTargetLock on a permitted date move (A2 §2); sets countsForFairness only when the body carries it and never unsets it, and a PATCH that carries it and changes nothing a notice could report queues no notice (solver v3 C1)",
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run app/utils/__tests__/roleWriteRequest.test.ts app/api/__tests__/roleWriteRoutes.test.ts app/utils/__tests__/serviceMutationSideEffects.test.ts app/utils/__tests__/outboxClassify.test.ts app/utils/__tests__/protectedReadAudit.test.ts`
Expected: PASS (351 tests).

- [ ] **Step 11: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors.

- [ ] **Step 12: Commit**

```bash
git add app/utils/roleWriteRequest.ts app/utils/outboxClassify.ts app/utils/serviceMutationSideEffects.ts "app/api/admin/roles/[id]/route.ts" app/utils/protectedReadAudit.ts \
  app/utils/__tests__/roleWriteRequest.test.ts app/utils/__tests__/serviceMutationSideEffects.test.ts app/api/__tests__/roleWriteRoutes.test.ts
git commit -m "feat(roles): PATCH sets countsForFairness only when sent; toggle-only edits queue nothing" \
  -m "Solver v3 C1 §5.4. An absent field leaves the stored value untouched — never the time precedent, so a tab loaded before C1 cannot reset it — and anything but a boolean is refused before any read. A PATCH that carries the field and changes nothing a notice could report (same date, same special name and time, every member's seat labels unchanged) queues no outbox notice and sends no push, so a routine toggle save never re-debounces a pending notice about a real change. A PATCH without the field queues exactly as before. The comparison is the flush's own sameSet over rolesForMember."
```

---

## Task 6: `GET /api/admin/roles` returns the effective value

C1-R8, §5.6. `ROLE_PROJECTION` stays byte-identical (Task 1's literal).

**Files:**
- Modify: `app/api/admin/roles/route.ts` (import after `:41`; projection `:64-81`)
- Modify: `app/components/admin/serviceCardModel.ts:119-137` (`ServiceRole`)
- Test: `app/api/__tests__/roleWriteRoutes.test.ts` (imports; the «GET /api/admin/roles — stored editor projection» describe at `:459-469`)

**Interfaces:**
- Consumes: `COUNTS_FOR_FAIRNESS_GROQ` (Task 2).
- Produces: each `GET /api/admin/roles` row carries `countsForFairness: boolean` (spec §9 «GET row»); `ServiceRole.countsForFairness?: boolean` (optional: a row from an older server, during a rollback, carries none — every reader goes through the twin `countsForFairness(row)`).

- [ ] **Step 1: Write the failing tests**

In `app/api/__tests__/roleWriteRoutes.test.ts`, find:
```ts
import { WORSHIP_MEMBER_GROQ_FILTER } from "@/app/ministries";
```
Replace with:
```ts
import { WORSHIP_MEMBER_GROQ_FILTER } from "@/app/ministries";
import { evaluate, parse } from "groq-js";
import { COUNTS_FOR_FAIRNESS_GROQ } from "@/app/utils/countsForFairness";
```

Then find:
```ts
    const query = operationalFetch.mock.calls[0][0] as string;
    expect(query).toContain('"published": coalesce(published, true)');
  });
});
```
Replace with:
```ts
    const query = operationalFetch.mock.calls[0][0] as string;
    expect(query).toContain('"published": coalesce(published, true)');
  });

  it("projects the effective countsForFairness through the one read rule (solver v3 C1-R8)", async () => {
    operationalFetch.mockResolvedValueOnce([]);
    expect((await rolesGET()).status).toBe(200);
    const query = operationalFetch.mock.calls[0][0] as string;
    expect(query).toContain(`"countsForFairness": ${COUNTS_FOR_FAIRNESS_GROQ}`);
  });

  it("reads a legacy weekend row as counted and a legacy special as not counted", async () => {
    operationalFetch.mockResolvedValueOnce([]);
    await rolesGET();
    const query = operationalFetch.mock.calls[0][0] as string;
    const dataset = [
      { _id: "sun-legacy", _type: "sunday_role", week: "2026-11-01" },
      { _id: "sat-legacy", _type: "saturday_role", week: "2026-11-07" },
      { _id: "sp-legacy", _type: "special_role", date: "2026-11-11", service_name: "Vigilia" },
      { _id: "sun-off", _type: "sunday_role", week: "2026-11-08", countsForFairness: false },
      { _id: "sp-on", _type: "special_role", date: "2026-11-12", service_name: "Retiro", countsForFairness: true },
    ];
    const rows = (await (await evaluate(parse(query), { dataset })).get()) as { _id: string; countsForFairness: boolean }[];
    expect(Object.fromEntries(rows.map((row) => [row._id, row.countsForFairness]))).toEqual({
      "sun-legacy": true,
      "sat-legacy": true,
      "sp-legacy": false,
      "sun-off": false,
      "sp-on": true,
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/api/__tests__/roleWriteRoutes.test.ts -t "countsForFairness|legacy weekend row"`
Expected: FAIL — the query does not contain `"countsForFairness": coalesce(countsForFairness, _type != "special_role")`, and every row's `countsForFairness` is `undefined`.

- [ ] **Step 3: Add the projection line**

In `app/api/admin/roles/route.ts`, find:
```ts
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
```
Replace with:
```ts
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { COUNTS_FOR_FAIRNESS_GROQ } from "@/app/utils/countsForFairness";
```

Find:
```ts
      "published": coalesce(published, true),
      "date": coalesce(week, date),
```
Replace with:
```ts
      "published": coalesce(published, true),
      "countsForFairness": ${COUNTS_FOR_FAIRNESS_GROQ},
      "date": coalesce(week, date),
```

The admin/super-admin gate and every other projected field are unchanged. (`api/admin` is a `MAY_SEE_DRAFTS` prefix in `draftGatingCoverage.test.ts`; the query keeps its `*[` filter and stays a protected-literal read through `operationalClient`.)

- [ ] **Step 4: Type the row field**

In `app/components/admin/serviceCardModel.ts`, find:
```ts
  format?: string | null;
  published?: boolean;
  leads: MemberOption[];
```
Replace with:
```ts
  format?: string | null;
  published?: boolean;
  /**
   * The effective «Cuenta para equidad» (solver v3 C1 §5.6). GET /api/admin/roles
   * projects it through COUNTS_FOR_FAIRNESS_GROQ, so a row from this server always
   * carries a boolean; it is optional because a row from an older server (a rollback)
   * carries none — read it through `countsForFairness(row)`, never directly.
   */
  countsForFairness?: boolean;
  leads: MemberOption[];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run app/api/__tests__/roleWriteRoutes.test.ts app/utils/__tests__/protectedReadAudit.test.ts app/utils/__tests__/draftGatingCoverage.test.ts app/utils/__tests__/countsForFairness.test.ts`
Expected: PASS (182 tests). `countsForFairness.test.ts`'s single-spelling guard stays green: the route interpolates the constant, it does not spell the fragment.

- [ ] **Step 6: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/roles/route.ts app/components/admin/serviceCardModel.ts app/api/__tests__/roleWriteRoutes.test.ts
git commit -m "feat(roles): GET /api/admin/roles returns the effective countsForFairness" \
  -m "Solver v3 C1-R8, §5.6. The planner's stored source learns each service's value from this route only, read through the one GROQ fragment so a legacy weekend row reads counted and a legacy special does not. ROLE_PROJECTION stays byte-identical, keeping the readiness loader, the MCP snapshot and v2's history unchanged (C1-D1)."
```

---

## Task 7: The engine constant — `app/components/admin/solverEngine.ts`

C1-R11, parent A1, spec §6.6 «The engine module».

**Files:**
- Create: `app/components/admin/solverEngine.ts`
- Test: `app/components/admin/__tests__/solverEngine.test.ts` (create)
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Produces (spec §9, exact): `export const SOLVER_ENGINE: "v2" | "v3" = "v2"` — and nothing else. C2 adds its resolver beside it; C6 wires the server-resolved engine; C7 flips the value and this test's assertion.

- [ ] **Step 1: Write the failing test**

Create `app/components/admin/__tests__/solverEngine.test.ts`:

```ts
// Pins the solver-engine constant's shipped value and its annotation (solver v3
// C1-R11, parent A1). C7 flips the value to "v3" at cutover and changes THIS
// assertion in the same change. C2 and C6 may add exports beside the constant:
// nothing here asserts about other exports.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SOLVER_ENGINE } from "../solverEngine";

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "solverEngine.ts"),
  "utf8",
);

describe("SOLVER_ENGINE", () => {
  it('ships "v2" — the cutover flips this constant, and this assertion, in the same change', () => {
    expect(SOLVER_ENGINE).toBe("v2");
  });

  it('is annotated with the whole "v2" | "v3" union, so a consumer\'s "v3" branch type-checks', () => {
    expect(SRC).toMatch(/export const SOLVER_ENGINE: "v2" \| "v3" = "v2";/);
  });

  it('is neutral: no "use client" directive and no imports (ADR-0028)', () => {
    expect(SRC).not.toMatch(/^\s*["']use client["']/m);
    expect(SRC).not.toMatch(/^\s*import\s/m);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/solverEngine.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '…/app/components/admin/solverEngine.ts'`.

- [ ] **Step 3: Create the module**

Create `app/components/admin/solverEngine.ts`:

```ts
// app/components/admin/solverEngine.ts
//
// THE solver-engine constant (solver v3, parent amendment A1). C1 creates it with
// the value "v2" and nothing else. C2 adds the effective-engine resolver and its
// Preview-only override beside it, C6 wires the server-resolved engine into the
// planner, and C7 flips this value to "v3" at cutover. Until C6, the planner's
// «aplica con el nuevo solver» note reads this constant directly.
//
// A CODE CONSTANT, not an environment variable: one value in every bundle, so no
// docs/SECRETS.md entry.
//
// NEUTRAL (ADR-0028): no "use client" and no imports. Tests pick an engine with
// vi.mock("../solverEngine", ...).
//
// The explicit annotation is load-bearing, exactly as in solverHistorySource.ts:
// without it the constant's type is the literal "v2", and every comparison against
// "v3" in a consumer becomes a TS2367 "no overlap" error instead of the branch it
// is meant to be.

export const SOLVER_ENGINE: "v2" | "v3" = "v2";
```

- [ ] **Step 4: Regenerate the colour inventory**

Run: `node scripts/colour-inventory.mjs`
Expected: `colour-inventory: 317 literal rows, 22 compositing classes, 11 pairs → …`

- [ ] **Step 5: Run the test and the boundary guard**

Run: `npx vitest run app/components/admin/__tests__/solverEngine.test.ts app/utils/__tests__/clientBoundary.test.ts app/utils/__tests__/colourInventory.test.ts`
Expected: PASS.

- [ ] **Step 6: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors.

- [ ] **Step 7: Commit**

```bash
git add app/components/admin/solverEngine.ts app/components/admin/__tests__/solverEngine.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(solver): SOLVER_ENGINE constant for the v3 cutover" \
  -m "Solver v3 parent A1: C1 owns the engine constant only, value v2, typed with the whole v2 | v3 union so every consumer's v3 branch type-checks. C2 adds the resolver beside it, C6 wires the server-resolved engine and C7 flips the value together with this pin. Neutral and import-free, like solverHistorySource.ts."
```

---

## Task 8: The control — `Switch` description, `fairnessToggleModel.ts`, `FairnessSwitch.tsx`

Spec §6.0 «Copy» (the Switch's accessible description), §6.6 (the note), §9 «Copy». This task builds the one control and the pure month rule; Tasks 9–13 put them on the four surfaces.

**Files:**
- Modify: `app/components/ui/Switch.tsx:21-45`
- Test: `app/components/ui/__tests__/Switch.test.tsx` (one case)
- Create: `app/components/admin/fairnessToggleModel.ts`
- Create: `app/components/admin/FairnessSwitch.tsx`
- Test: `app/components/admin/__tests__/fairnessToggleModel.test.ts` (create), `app/components/admin/__tests__/fairnessSwitch.test.tsx` (create)
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: `countsForFairnessDefault`, `FairnessRoleType` (Task 2); `serviceTodayIso(now?: Date): string` (`app/components/admin/serviceReadiness.ts:996`); `SOLVER_ENGINE` (Task 7).
- Produces:
  - `Switch` accepts `"aria-describedby"?: string` and forwards it.
  - `fairnessToggleModel.ts`: `FAIRNESS_LABEL`, `FAIRNESS_ENGINE_NOTE`, `FAIRNESS_PAST_REASON`, `FAIRNESS_SPECIAL_HELP` (strings); `isPastServiceMonth(date: string, todayIso?: string): boolean`; `effectiveCreateCounts(type: FairnessRoleType, date: string, chosen: boolean, todayIso?: string): boolean`; `fairnessSwitchLabel(target: { date: string; serviceName?: string }): string`.
  - `FairnessSwitch.tsx`: `FairnessSwitch(props: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; past: boolean; ariaLabel: string; help?: string })` and `FairnessEngineNote()`.

- [ ] **Step 1: Write the failing tests**

In `app/components/ui/__tests__/Switch.test.tsx`, find:
```tsx
  it("renders the knob at its resting position without waiting for the feature chunk", () => {
```
Replace with:
```tsx
  it("forwards an accessible description to the button", () => {
    render(
      <MotionProvider>
        <p id="why">Mes pasado: ya no se cambia.</p>
        <Switch aria-label="Cuenta" aria-describedby="why" checked={false} disabled onChange={() => {}} />
      </MotionProvider>,
    );
    expect(screen.getByRole("switch", { name: "Cuenta" }).getAttribute("aria-describedby")).toBe("why");
  });

  it("renders the knob at its resting position without waiting for the feature chunk", () => {
```

Create `app/components/admin/__tests__/fairnessToggleModel.test.ts`:

```ts
// Solver v3 C1 §6.0/§6.1 — the past-month rule and the effective values every
// surface and every request body go through. `todayIso` is passed explicitly, so
// each case sits on a known side of a month boundary.
import { describe, expect, it } from "vitest";

import {
  FAIRNESS_ENGINE_NOTE,
  FAIRNESS_LABEL,
  FAIRNESS_PAST_REASON,
  FAIRNESS_SPECIAL_HELP,
  effectiveCreateCounts,
  fairnessSwitchLabel,
  isPastServiceMonth,
} from "../fairnessToggleModel";

describe("the copy (solver v3 C1 §9 «Copy»)", () => {
  it("is exactly the spec's", () => {
    expect(FAIRNESS_LABEL).toBe("Cuenta para equidad");
    expect(FAIRNESS_ENGINE_NOTE).toBe("Cuenta para equidad: aplica con el nuevo solver. Hoy Auto no lo usa.");
    expect(FAIRNESS_PAST_REASON).toBe("Mes pasado: ya no se cambia.");
    expect(FAIRNESS_SPECIAL_HELP).toBe(
      "Si cuenta, su Lead suma como Dom Lead en domingo y como Sáb Lead en otro día; BGV y Coro suman igual.",
    );
  });
});

describe("isPastServiceMonth (§6.0)", () => {
  it("is false for the current month and later, true for any earlier month", () => {
    expect(isPastServiceMonth("2026-10-01", "2026-10-31")).toBe(false);
    expect(isPastServiceMonth("2026-11-15", "2026-10-31")).toBe(false);
    expect(isPastServiceMonth("2026-09-30", "2026-10-01")).toBe(true);
    expect(isPastServiceMonth("2025-12-31", "2026-01-01")).toBe(true);
  });

  it("flips at the month boundary for the same date", () => {
    expect(isPastServiceMonth("2026-10-25", "2026-10-31")).toBe(false);
    expect(isPastServiceMonth("2026-10-25", "2026-11-01")).toBe(true);
  });

  it("accepts a datetime prefix and answers false for a malformed date", () => {
    expect(isPastServiceMonth("2026-09-06T12:00:00Z", "2026-10-01")).toBe(true);
    expect(isPastServiceMonth("", "2026-10-01")).toBe(false);
    expect(isPastServiceMonth("nope", "2026-10-01")).toBe(false);
  });
});

describe("effectiveCreateCounts (§6.0, §6.1)", () => {
  it("is the admin's choice outside a past month", () => {
    expect(effectiveCreateCounts("sunday_role", "2026-11-01", false, "2026-10-31")).toBe(false);
    expect(effectiveCreateCounts("special_role", "2026-11-11", true, "2026-10-31")).toBe(true);
  });

  it("is the type default in a past month, whatever was chosen", () => {
    expect(effectiveCreateCounts("sunday_role", "2026-09-06", false, "2026-10-01")).toBe(true);
    expect(effectiveCreateCounts("saturday_role", "2026-09-05", false, "2026-10-01")).toBe(true);
    expect(effectiveCreateCounts("special_role", "2026-09-09", true, "2026-10-01")).toBe(false);
  });
});

describe("fairnessSwitchLabel", () => {
  it("names the column by date, and by date and name for a special", () => {
    expect(fairnessSwitchLabel({ date: "2026-11-01" })).toBe("Cuenta para equidad 2026-11-01");
    expect(fairnessSwitchLabel({ date: "2026-11-11", serviceName: "Vigilia" })).toBe(
      "Cuenta para equidad 2026-11-11 · Vigilia",
    );
  });
});
```

Create `app/components/admin/__tests__/fairnessSwitch.test.tsx`:

```tsx
/** @vitest-environment jsdom */
// Solver v3 C1 §6 — the one «Cuenta para equidad» control and its v2 note. The
// engine constant ships "v2" here; `fairnessEngineV3.test.tsx` mocks it to "v3".
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MotionProvider } from "../../ui/MotionProvider";
import { installMotionTestEnv } from "../../ui/__tests__/motionTestSetup";
import { FairnessEngineNote, FairnessSwitch } from "../FairnessSwitch";
import {
  FAIRNESS_ENGINE_NOTE,
  FAIRNESS_PAST_REASON,
  FAIRNESS_SPECIAL_HELP,
} from "../fairnessToggleModel";

installMotionTestEnv();
afterEach(cleanup);

function describedText(el: HTMLElement): string | null {
  const id = el.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
}

describe("FairnessSwitch", () => {
  it("is a named house switch that reports the flipped value", () => {
    const onChange = vi.fn();
    render(
      <MotionProvider>
        <FairnessSwitch checked onChange={onChange} past={false} ariaLabel="Cuenta para equidad 2026-11-01" />
      </MotionProvider>,
    );
    const sw = screen.getByRole("switch", { name: "Cuenta para equidad 2026-11-01" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.getAttribute("aria-describedby")).toBeNull();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("in a past month is disabled and names the reason as its accessible description", () => {
    const onChange = vi.fn();
    render(
      <MotionProvider>
        <FairnessSwitch checked={false} onChange={onChange} past ariaLabel="Cuenta para equidad" />
      </MotionProvider>,
    );
    const sw = screen.getByRole("switch", { name: "Cuenta para equidad" }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(describedText(sw)).toBe(FAIRNESS_PAST_REASON);
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is disabled by its caller without a reason line when the month is not past", () => {
    render(
      <MotionProvider>
        <FairnessSwitch checked onChange={() => {}} disabled past={false} ariaLabel="Cuenta para equidad" />
      </MotionProvider>,
    );
    expect((screen.getByRole("switch", { name: "Cuenta para equidad" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(FAIRNESS_PAST_REASON)).toBeNull();
  });

  it("shows the help line it is given", () => {
    render(
      <MotionProvider>
        <FairnessSwitch checked={false} onChange={() => {}} past={false} ariaLabel="Cuenta para equidad" help={FAIRNESS_SPECIAL_HELP} />
      </MotionProvider>,
    );
    expect(screen.getByText(FAIRNESS_SPECIAL_HELP)).toBeTruthy();
  });
});

describe("FairnessEngineNote", () => {
  it('shows the note while the engine is "v2"', () => {
    render(<FairnessEngineNote />);
    expect(screen.getByText(FAIRNESS_ENGINE_NOTE)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/components/ui/__tests__/Switch.test.tsx app/components/admin/__tests__/fairnessToggleModel.test.ts app/components/admin/__tests__/fairnessSwitch.test.tsx`
Expected: FAIL — `expected null to be 'why'` (Switch), and `Failed to resolve import "../fairnessToggleModel"` / `"../FairnessSwitch"`.

- [ ] **Step 3: Forward `aria-describedby` from the house `Switch`**

In `app/components/ui/Switch.tsx`, find:
```tsx
  /** Exactly one of these names the switch. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  disabled?: boolean;
```
Replace with:
```tsx
  /** Exactly one of these names the switch. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Optional: the id of a visible line that explains the switch — e.g. why it is disabled. */
  "aria-describedby"?: string;
  disabled?: boolean;
```

Find:
```tsx
      aria-labelledby={aria["aria-labelledby"]}
      disabled={disabled}
```
Replace with:
```tsx
      aria-labelledby={aria["aria-labelledby"]}
      aria-describedby={aria["aria-describedby"]}
      disabled={disabled}
```

- [ ] **Step 4: Create the pure model**

Create `app/components/admin/fairnessToggleModel.ts`:

```ts
// app/components/admin/fairnessToggleModel.ts
//
// «Cuenta para equidad» on the planner's surfaces (solver v3 C1 §6): the copy, the
// past-month rule (§6.0) and the effective-value helpers that every surface and
// every request body go through. Pure and NEUTRAL (no "use client"), so the save
// model, the draft-create body and the components share one definition.
//
// The read rule itself is NOT here: app/utils/countsForFairness.ts is the one
// definition of the GROQ fragment, its twin and the type default.
//
// «Past» (§6.0, C1-D7): a service whose month is before the current CDMX month,
// serviceTodayIso().slice(0, 7) — the split ServicesPanel already uses for «Roles
// previos». It is evaluated when a surface renders AND again when a request body is
// built, never cached across a save, so every helper takes `todayIso` with a default
// of "now". The rule is client-side only: neither roles route refuses on the month.

import { countsForFairnessDefault, type FairnessRoleType } from "@/app/utils/countsForFairness";
import { serviceTodayIso } from "./serviceReadiness";

export const FAIRNESS_LABEL = "Cuenta para equidad";
/** Shown once per surface while the engine is v2 (parent U7). C6 CTL-1 rewires its condition. */
export const FAIRNESS_ENGINE_NOTE = "Cuenta para equidad: aplica con el nuevo solver. Hoy Auto no lo usa.";
export const FAIRNESS_PAST_REASON = "Mes pasado: ya no se cambia.";
export const FAIRNESS_SPECIAL_HELP =
  "Si cuenta, su Lead suma como Dom Lead en domingo y como Sáb Lead en otro día; BGV y Coro suman igual.";

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * True when `date` (YYYY-MM-DD, a datetime prefix allowed) falls in a month before
 * the current CDMX month. A malformed date is not a month at all and answers false:
 * no surface can send a body for one (the composer refuses it, the server refuses
 * the PATCH), and a stored column also checks its stored date.
 */
export function isPastServiceMonth(date: string, todayIso: string = serviceTodayIso()): boolean {
  if (!DAY_RE.test(date)) return false;
  return date.slice(0, 7) < todayIso.slice(0, 7);
}

/**
 * A create target's effective value (§6.0, §6.1): the admin's choice — unless the
 * date falls in a past month, where it is the type default whatever was chosen.
 */
export function effectiveCreateCounts(
  type: FairnessRoleType,
  date: string,
  chosen: boolean,
  todayIso: string = serviceTodayIso(),
): boolean {
  return isPastServiceMonth(date, todayIso) ? countsForFairnessDefault(type) : chosen;
}

/** The grid Switch's accessible name: it identifies the column the way «Omitir» does. */
export function fairnessSwitchLabel(target: { date: string; serviceName?: string }): string {
  return target.serviceName
    ? `${FAIRNESS_LABEL} ${target.date} · ${target.serviceName}`
    : `${FAIRNESS_LABEL} ${target.date}`;
}
```

- [ ] **Step 5: Create the control**

Create `app/components/admin/FairnessSwitch.tsx`:

```tsx
"use client";

// «Cuenta para equidad» (solver v3 C1 §6): the house Switch, its visible label, an
// optional help line, and — for a service of a past month — the reason line that is
// the Switch's accessible description (§6.0). ONE component for the four surfaces
// (the grid's create and stored headers, the calendar's special composer and «+ Nuevo
// servicio»), so the copy and the a11y wiring cannot drift between them.
// `FairnessEngineNote` is the once-per-surface «aplica con el nuevo solver» note (U7).

import { useId } from "react";
import Switch from "@/app/components/ui/Switch";
import { FAIRNESS_ENGINE_NOTE, FAIRNESS_LABEL, FAIRNESS_PAST_REASON } from "./fairnessToggleModel";
import { SOLVER_ENGINE } from "./solverEngine";

export function FairnessSwitch({
  checked,
  onChange,
  disabled = false,
  past,
  ariaLabel,
  help,
}: {
  /** The EFFECTIVE value — the caller has already applied §6.0. */
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** §6.0: a service of a past month — the Switch is disabled and says why. */
  past: boolean;
  ariaLabel: string;
  help?: string;
}) {
  const reasonId = useId();
  return (
    <div className="space-y-1" data-fairness-switch="">
      <span className="inline-flex items-center gap-2">
        <Switch
          size="sm"
          checked={checked}
          onChange={onChange}
          disabled={disabled || past}
          aria-label={ariaLabel}
          aria-describedby={past ? reasonId : undefined}
        />
        <span aria-hidden="true" className="font-label text-[10px] uppercase tracking-widest text-mono-500">
          {FAIRNESS_LABEL}
        </span>
      </span>
      {help && <p className="font-body text-[11px] text-mono-500">{help}</p>}
      {past && (
        <p id={reasonId} className="font-body text-[10px] text-warning-strong">
          {FAIRNESS_PAST_REASON}
        </p>
      )}
    </div>
  );
}

/** «Cuenta para equidad: aplica con el nuevo solver…» — once per surface, only while the engine is v2. */
export function FairnessEngineNote() {
  if (SOLVER_ENGINE !== "v2") return null;
  return (
    <p data-fairness-engine-note="" className="font-body text-[11px] text-mono-500">
      {FAIRNESS_ENGINE_NOTE}
    </p>
  );
}
```

- [ ] **Step 6: Regenerate the colour inventory**

Run: `node scripts/colour-inventory.mjs`
Expected: `colour-inventory: 317 literal rows, 22 compositing classes, 11 pairs → …` (only `filesScanned` moves; the new classes are tokens).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run app/components/ui/__tests__/Switch.test.tsx app/components/admin/__tests__/fairnessToggleModel.test.ts app/components/admin/__tests__/fairnessSwitch.test.tsx app/utils/__tests__/clientBoundary.test.ts app/utils/__tests__/colourInventory.test.ts`
Expected: PASS.

- [ ] **Step 8: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors.

- [ ] **Step 9: Commit**

```bash
git add app/components/ui/Switch.tsx app/components/ui/__tests__/Switch.test.tsx \
  app/components/admin/fairnessToggleModel.ts app/components/admin/FairnessSwitch.tsx \
  app/components/admin/__tests__/fairnessToggleModel.test.ts app/components/admin/__tests__/fairnessSwitch.test.tsx \
  app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(ui): FairnessSwitch, the v2 note, and the past-month rule" \
  -m "Solver v3 C1 §6.0, §6.6. One control for the four surfaces, so the copy and the accessible description cannot drift: the house Switch now forwards aria-describedby, which carries «Mes pasado: ya no se cambia.» on a service of a past CDMX month. The month rule and the create-side effective value live in a neutral module every surface and every request body will share; the note reads SOLVER_ENGINE until C6 rewires it."
```

---

## Task 9: Create-side model — columns and drafts carry the value; the body sends it

C1-R9 (create half), C1-R12, C1-R14 (create half), §6.1 create mode, §7 rows «Draft create», «Planner model», «R11 positive control».

**Files:**
- Modify: `app/components/admin/plannerModel.ts` (imports `:52`; `GridColumn` `:137-158`; `DraftCard` `:195-228`; `buildColumns` `:429-469`; `cellsToDrafts` push `:1806-1819`)
- Modify: `app/utils/monthDraftCreate.ts` (imports `:14`; `CreatableDraft` `:26-51`; `draftCreateBody` `:65-84`)
- Modify: `app/components/admin/storedRoleReadModel.ts` (imports `:4`; `translateStoredRole` `:111-127`)
- Modify: `app/components/admin/fairnessToggleModel.ts` (append create helpers)
- Modify: `app/components/admin/MonthGenerator.tsx` (imports `:14`; «+ Nuevo servicio»'s inline draft `:3090-3104` — interim value, replaced in Task 13)
- Fixtures (tsc requires the new field): `app/components/admin/__tests__/PlannerGrid.test.tsx`, `groupFill.test.ts`, `instrumentFill.test.ts`, `localFill.test.ts`, `moveGate.test.ts`, `plannerGridDrag.test.tsx`, `plannerGridPickPlace.test.tsx`, `plannerModel.test.ts`, `plannerSaveModel.test.ts`; `app/utils/__tests__/monthDraftCreate.test.ts`, `solverHistoryEquivalence.test.ts`, `solverHistoryEvidence.test.ts`
- Expectations that legitimately change: `plannerModel.test.ts` (four `buildColumns` goldens), `MonthGenerator.stored.test.tsx` (the «+ Nuevo servicio» POST body)
- Test: `app/components/admin/__tests__/plannerModel.test.ts` (append), `app/utils/__tests__/monthDraftCreate.test.ts` (append), `app/components/admin/__tests__/fairnessToggleModel.test.ts` (append), `app/components/admin/__tests__/fairnessInertV2.test.ts` (create), `app/utils/__tests__/countsForFairnessEvidence.test.ts` (create)

**Interfaces:**
- Consumes: `countsForFairnessDefault`, `countsForFairness` (Task 2); `effectiveCreateCounts`, `isPastServiceMonth` (Task 8); `ServiceRole.countsForFairness?` (Task 6); `buildRoleDocument(…countsForFairness…)`, `ParsedCreateRequest.countsForFairness` (Task 4).
- Produces (spec §9 «Client types»):
  - `GridColumn.countsForFairness: boolean` — the column's EFFECTIVE value, both modes (`StoredGridColumn` inherits)
  - `DraftCard.countsForFairness: boolean`, `CreatableDraft.countsForFairness: boolean`
  - `buildColumns({ …, specials?: { date: string; name: string; countsForFairness?: boolean }[] })` — weekend columns at `countsForFairnessDefault`, a special at its composer choice else the special default
  - `draftCreateBody(draft: CreatableDraft, published: boolean, todayIso?: string)` — body always carries `countsForFairness: effectiveCreateCounts(draft._type, draft.date, draft.countsForFairness, todayIso)`
  - `fairnessToggleModel.ts` adds `applyCreateCountsEdits(columns: readonly GridColumn[], edits: ReadonlyMap<string, boolean>, todayIso?: string): GridColumn[]` and `withoutCountsEdit(edits: Map<string, boolean>, columnId: string): Map<string, boolean>` (returns the same map when nothing is dropped)

- [ ] **Step 1: Write the failing tests**

Append to the end of `app/components/admin/__tests__/plannerModel.test.ts`:

```ts

describe("countsForFairness on create columns and drafts (solver v3 C1 §6.1)", () => {
  it("weekend columns enter counted; a special at the composer's choice, else not counted", () => {
    const cols = buildColumns({
      sundayDates: ["2026-11-01"],
      activeSatDates: ["2026-11-07"],
      specials: [
        { date: "2026-11-11", name: "Vigilia" },
        { date: "2026-11-12", name: "Retiro", countsForFairness: true },
      ],
    });
    expect(cols.map((c) => [c.date, c.countsForFairness])).toEqual([
      ["2026-11-01", true],
      ["2026-11-07", true],
      ["2026-11-11", false],
      ["2026-11-12", true],
    ]);
  });

  it("each draft carries its column's value", () => {
    const cols = buildColumns({ sundayDates: ["2026-11-01", "2026-11-08"], activeSatDates: [] });
    const edited = cols.map((c) => (c.date === "2026-11-08" ? { ...c, countsForFairness: false } : c));
    const drafts = cellsToDraftsModel([], edited, new Set(), [], []);
    expect(drafts.map((d) => [d.date, d.countsForFairness])).toEqual([
      ["2026-11-01", true],
      ["2026-11-08", false],
    ]);
  });
});
```

Append to the end of `app/utils/__tests__/monthDraftCreate.test.ts`:

```ts

describe("draftCreateBody — countsForFairness (solver v3 C1 §6.1, §6.0)", () => {
  // `draft()` is dated 2026-08-09: August 2026 is current on "2026-08-31" and past on "2026-09-01".
  it("sends the draft's own value", () => {
    expect(draftCreateBody(draft({ countsForFairness: false }), false, "2026-08-31").countsForFairness).toBe(false);
    expect(
      draftCreateBody(draft({ _type: "special_role", service_name: "Vigilia", countsForFairness: true }), false, "2026-08-31")
        .countsForFairness,
    ).toBe(true);
  });

  it("sends the type default for a draft of a past month, whatever the draft holds", () => {
    expect(draftCreateBody(draft({ countsForFairness: false }), false, "2026-09-01").countsForFairness).toBe(true);
    expect(
      draftCreateBody(draft({ _type: "special_role", service_name: "Vigilia", countsForFairness: true }), false, "2026-09-01")
        .countsForFairness,
    ).toBe(false);
  });

  it("the batch posts every draft's value and keeps its request id", async () => {
    const bodies: { creationRequestId: string; countsForFairness: boolean }[] = [];
    await runDraftCreateBatch({
      drafts: [
        draft({ localId: "on", creationRequestId: "req-draft-on-0001", date: "2099-01-04", countsForFairness: true }),
        draft({ localId: "off", creationRequestId: "req-draft-off-0001", date: "2099-01-11", countsForFairness: false }),
      ],
      published: false,
      post: async (body) => {
        bodies.push(body);
        return { ok: true } satisfies DraftPostOutcome;
      },
    });
    expect(bodies.map((b) => [b.creationRequestId, b.countsForFairness])).toEqual([
      ["req-draft-on-0001", true],
      ["req-draft-off-0001", false],
    ]);
  });
});
```

In `app/components/admin/__tests__/fairnessToggleModel.test.ts`, find:
```ts
  effectiveCreateCounts,
  fairnessSwitchLabel,
  isPastServiceMonth,
} from "../fairnessToggleModel";
```
Replace with:
```ts
  applyCreateCountsEdits,
  effectiveCreateCounts,
  fairnessSwitchLabel,
  isPastServiceMonth,
  withoutCountsEdit,
} from "../fairnessToggleModel";
import { buildColumns } from "../plannerModel";
```

and append to its end:

```ts

describe("applyCreateCountsEdits (§6.1)", () => {
  const cols = buildColumns({
    sundayDates: ["2026-11-01"],
    activeSatDates: [],
    specials: [{ date: "2026-11-11", name: "Vigilia", countsForFairness: true }],
  });

  it("overlays the admin's edit by columnId and keeps every other field", () => {
    const out = applyCreateCountsEdits(cols, new Map([[cols[0].columnId, false]]), "2026-11-02");
    expect(out.map((c) => c.countsForFairness)).toEqual([false, true]);
    expect(out.map(({ countsForFairness: _counts, ...rest }) => rest)).toEqual(
      cols.map(({ countsForFairness: _counts, ...rest }) => rest),
    );
  });

  it("is idempotent over its own output", () => {
    const edits = new Map([[cols[0].columnId, false]]);
    const once = applyCreateCountsEdits(cols, edits, "2026-11-02");
    expect(applyCreateCountsEdits(once, edits, "2026-11-02")).toEqual(once);
  });

  it("in a past month every column takes its type default — the composer's choice and the edit do not apply", () => {
    const out = applyCreateCountsEdits(cols, new Map([[cols[0].columnId, false]]), "2026-12-01");
    expect(out.map((c) => c.countsForFairness)).toEqual([true, false]);
  });
});

describe("withoutCountsEdit (§6.1)", () => {
  it("drops one column's edit and keeps the others", () => {
    const edits = new Map([["a", false], ["b", true]]);
    expect([...withoutCountsEdit(edits, "a")]).toEqual([["b", true]]);
    expect([...edits]).toEqual([["a", false], ["b", true]]);
  });

  it("returns the same map when there is nothing to drop", () => {
    const edits = new Map([["a", false]]);
    expect(withoutCountsEdit(edits, "z")).toBe(edits);
  });
});
```

Create `app/components/admin/__tests__/fairnessInertV2.test.ts`:

```ts
// Solver v3 C1-R12 — v2 is inert to «Cuenta para equidad». The v2 solve request
// takes no columns at all, and the local fairness-history entry is a function of
// the drafts' seats and types only: flipping every toggle changes neither.
import { describe, expect, expectTypeOf, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import { applyCreateCountsEdits } from "../fairnessToggleModel";
import {
  buildColumns,
  buildSolveRequest,
  cellsToDrafts,
  historyEntryFromDrafts,
  type GridCell,
  type GridColumn,
  type SolverConfig,
} from "../plannerModel";

const TODAY = "2026-11-02"; // November 2026 is the current month: no column below is past.
const SUNDAYS = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"];
const SATURDAYS = ["2026-11-07", "2026-11-14"];
const MEMBERS: RankMember[] = [
  { _id: "m-ana", member_name: "Ana", memberType: ["voz"] },
  { _id: "m-beto", member_name: "Beto", memberType: ["voz"] },
  { _id: "m-caro", member_name: "Caro", memberType: ["voz"] },
];
const CONFIG: SolverConfig = {
  sundayLeads: ["m-ana"],
  saturdayLeads: ["m-beto"],
  support: ["m-caro"],
  restrictions: [],
  conflicts: [],
  presence: [],
};

function columnsWithEvery(value: boolean): GridColumn[] {
  const base = buildColumns({
    sundayDates: SUNDAYS,
    activeSatDates: SATURDAYS,
    specials: [{ date: "2026-11-11", name: "Vigilia" }],
  });
  return applyCreateCountsEdits(base, new Map(base.map((c) => [c.columnId, value])), TODAY);
}

function cellsFor(columns: GridColumn[]): GridCell[] {
  return columns.flatMap((column): GridCell[] => [
    { columnId: column.columnId, rowId: "lead", occupants: [{ memberId: "m-ana" }], origin: "manual" },
    { columnId: column.columnId, rowId: "bgv", occupants: [{ memberId: "m-beto" }], origin: "manual" },
    {
      columnId: column.columnId,
      rowId: "coro",
      occupants: column.type === "saturday_role" ? [] : [{ memberId: "m-caro" }],
      origin: "manual",
    },
  ]);
}

describe("v2 is inert to countsForFairness (solver v3 C1-R12)", () => {
  it("the two column sets really differ: every toggle on versus every toggle off", () => {
    expect(columnsWithEvery(true).every((c) => c.countsForFairness)).toBe(true);
    expect(columnsWithEvery(false).every((c) => !c.countsForFairness)).toBe(true);
  });

  it("historyEntryFromDrafts is identical with every toggle on and every toggle off", () => {
    const on = columnsWithEvery(true);
    const off = columnsWithEvery(false);
    const draftsOn = cellsToDrafts(cellsFor(on), on, new Set(), [], []);
    const draftsOff = cellsToDrafts(cellsFor(off), off, new Set(), [], []);
    expect(draftsOn.map((d) => d.countsForFairness)).not.toEqual(draftsOff.map((d) => d.countsForFairness));
    expect(historyEntryFromDrafts(draftsOn, MEMBERS, 2026, 11)).toEqual(
      historyEntryFromDrafts(draftsOff, MEMBERS, 2026, 11),
    );
  });

  it("buildSolveRequest takes no columns, so no toggle can reach the v2 request", () => {
    expectTypeOf<Parameters<typeof buildSolveRequest>[0]>().not.toHaveProperty("columns");
    const input = {
      config: CONFIG,
      members: MEMBERS,
      sundayDates: SUNDAYS,
      activeSatDates: SATURDAYS,
      historyEntries: [],
      year: 2026,
      month: 11,
    };
    expect(buildSolveRequest(input)).toEqual(buildSolveRequest(input));
  });
});
```

Create `app/utils/__tests__/countsForFairnessEvidence.test.ts`:

```ts
// Solver v3 C1 §7 «R11 positive control». Since C1 every create body carries
// `countsForFairness` (draftCreateBody), at the type default for a default draft.
// R11's evidence rebuilds a create payload from a ROLE_PROJECTION row, which does
// NOT carry the field (C1-D1) — so the rebuild must still reproduce the creation
// fingerprint and read the document as unchanged. That holds only because the
// fingerprint omits a default-valued toggle (§5.3.2). The off-default case is the
// known limit the spec states (§10), pinned here so it stays a stated one.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { draftCreateBody, type CreatableDraft } from "@/app/utils/monthDraftCreate";
import { buildCreationReceipt, payloadFingerprint } from "@/app/utils/roleCreationReceipt";
import { buildRoleDocument, parseCreateRequest } from "@/app/utils/roleWriteRequest";
import { ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION, ROLE_PROJECTION } from "@/app/utils/serviceReadQueries";
import { indexMembersById, type SolverHistoryMember } from "@/app/utils/solverHistory";
import { documentEvidence, storedRoleCreatePayload } from "@/app/utils/solverHistoryEvidence";

import { projectRow } from "./__fixtures__/roleProjectionReader";

// Fake names only: this repository is public.
const MEMBERS: SolverHistoryMember[] = [
  { _id: "m-ana", member_name: "Ana Prueba" },
  { _id: "m-beto", member_name: "Beto Ensayo" },
];
const CTX = { membersById: indexMembersById(MEMBERS), duplicateTarget: false };
const TODAY = "2026-09-01"; // September 2026 is current: every draft below keeps its own value.

function draft(type: "sunday_role" | "saturday_role", date: string, countsForFairness: boolean): CreatableDraft {
  return {
    localId: `local-${date}`,
    creationRequestId: `req-c1-evidence-${date}`,
    _type: type,
    date,
    countsForFairness,
    leads: ["m-ana"],
    bgvs: ["m-beto"],
    chorus: [],
    instruments: [],
    foh: [],
  };
}

let keySeq = 0;

/** The create route's own path, then the loader's projection — as `solverHistoryEvidence.test.ts` does. */
function createThroughRoute(d: CreatableDraft) {
  const body = draftCreateBody(d, false, TODAY);
  const parsed = parseCreateRequest(body);
  if (!parsed.ok) throw new Error(`fixture ${d.localId} failed to parse: ${parsed.issues.join(", ")}`);
  const v = parsed.value;
  const roleId = `role-${d.localId}`;
  const receipt = buildCreationReceipt({ requestId: v.requestId, payload: body, roleId, now: "2026-09-01T12:00:00.000Z" });
  if (!receipt) throw new Error(`fixture ${d.localId} built no receipt`);
  const doc = buildRoleDocument({
    roleId,
    roleType: v.roleType,
    date: v.date,
    serviceName: v.serviceName,
    time: v.time,
    format: v.format,
    published: v.published,
    countsForFairness: v.countsForFairness,
    seats: v.seats,
    receiptId: v.receiptId,
    fingerprint: v.fingerprint,
    nextKey: () => `key-${++keySeq}`,
  });
  return {
    body,
    doc,
    fingerprint: v.fingerprint,
    row: projectRow({ ...doc, _rev: `rev-${d.localId}` }, ROLE_PROJECTION) as Record<string, unknown>,
    receipt: projectRow(
      { ...receipt, _rev: `rev-receipt-${d.localId}` },
      ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION,
    ) as Record<string, unknown>,
  };
}

describe("R11 positive control with countsForFairness on every create body (solver v3 C1 §7)", () => {
  it.each([
    ["sunday_role", "2026-09-06"],
    ["saturday_role", "2026-09-12"],
  ] as const)("%s: the body carries the default explicitly, the document stores it, and the evidence still reads unchanged", (type, date) => {
    const created = createThroughRoute(draft(type, date, true));
    expect(created.body.countsForFairness).toBe(true);
    expect(created.doc.countsForFairness).toBe(true);
    // ROLE_PROJECTION stays toggle-blind (C1-D1)…
    expect("countsForFairness" in created.row).toBe(false);
    // …and the rebuild still reproduces the creation fingerprint.
    expect(payloadFingerprint(storedRoleCreatePayload(created.row, false))).toBe(created.fingerprint);
    expect(documentEvidence(created.row, [created.receipt], CTX)?.unchangedAs).toBe("draft");
  });

  it("a weekend role created OFF reads as changed since creation — the known limit of §10, stated", () => {
    const created = createThroughRoute(draft("sunday_role", "2026-09-13", false));
    expect(created.body.countsForFairness).toBe(false);
    expect(payloadFingerprint(storedRoleCreatePayload(created.row, false))).not.toBe(created.fingerprint);
    expect(documentEvidence(created.row, [created.receipt], CTX)?.unchangedAs).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/plannerModel.test.ts app/utils/__tests__/monthDraftCreate.test.ts app/components/admin/__tests__/fairnessToggleModel.test.ts app/components/admin/__tests__/fairnessInertV2.test.ts app/utils/__tests__/countsForFairnessEvidence.test.ts`
Expected: FAIL — `applyCreateCountsEdits is not a function`; `expected [ [ '2026-11-01', undefined ], … ] to deeply equal [ [ '2026-11-01', true ], … ]`; `expected undefined to be false` (draft body).

- [ ] **Step 3: Grid columns and drafts carry the value**

In `app/components/admin/plannerModel.ts`, find:
```ts
import { WORSHIP_NIGHT_FORMAT, type ServiceFormat } from "@/app/utils/serviceFormat";
```
Replace with:
```ts
import { WORSHIP_NIGHT_FORMAT, type ServiceFormat } from "@/app/utils/serviceFormat";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
```

Find:
```ts
  /** SPECIALS ONLY — "worship_night" for a «Noche de alabanza». Never identity. */
  format?: ServiceFormat;
}
```
Replace with:
```ts
  /** SPECIALS ONLY — "worship_night" for a «Noche de alabanza». Never identity. */
  format?: ServiceFormat;
  /**
   * «Cuenta para equidad» (solver v3 C1 §6.1) — the column's EFFECTIVE value, after
   * the past-month rule (§6.0), in both modes. Create mode: the type default, a
   * special's composer choice, or the admin's header edit (`applyCreateCountsEdits`).
   * Stored mode: the GET row's value, overlaid by the header edit. Inert under v2:
   * nothing in this module computes with it — `buildSolveRequest` takes no columns.
   */
  countsForFairness: boolean;
}
```

Find (in `DraftCard`):
```ts
  isExisting: boolean;
  skipped: boolean;
  leads: string[];
```
Replace with:
```ts
  isExisting: boolean;
  skipped: boolean;
  /** Its column's effective «Cuenta para equidad»; `draftCreateBody` sends it (C1 §6.1). */
  countsForFairness: boolean;
  leads: string[];
```

Find:
```ts
  /** Weekday specials (E2), each with the `service_name` it will be created under. */
  specials?: { date: string; name: string }[];
}): GridColumn[] {
```
Replace with:
```ts
  /**
   * Weekday specials (E2), each with the `service_name` it will be created under and
   * the composer's «Cuenta para equidad» choice — the column's initial value (C1 §6.3).
   */
  specials?: { date: string; name: string; countsForFairness?: boolean }[];
}): GridColumn[] {
```

Find:
```ts
  for (const d of sundayDates) push({ columnId: createColumnId("sunday_role", d), date: d, type: "sunday_role" });
  for (const d of activeSatDates) push({ columnId: createColumnId("saturday_role", d), date: d, type: "saturday_role" });
  for (const s of specials) {
    push({ columnId: createColumnId("special_role", s.date), date: s.date, type: "special_role", serviceName: s.name });
  }
```
Replace with:
```ts
  // C1 §6.1: every column enters at its type default; a special at the composer's choice.
  for (const d of sundayDates) {
    push({ columnId: createColumnId("sunday_role", d), date: d, type: "sunday_role", countsForFairness: countsForFairnessDefault("sunday_role") });
  }
  for (const d of activeSatDates) {
    push({ columnId: createColumnId("saturday_role", d), date: d, type: "saturday_role", countsForFairness: countsForFairnessDefault("saturday_role") });
  }
  for (const s of specials) {
    push({
      columnId: createColumnId("special_role", s.date),
      date: s.date,
      type: "special_role",
      serviceName: s.name,
      countsForFairness: s.countsForFairness ?? countsForFairnessDefault("special_role"),
    });
  }
```

Find (in `cellsToDrafts`):
```ts
      exists,
      isExisting,
      skipped,
      leads,
```
Replace with:
```ts
      exists,
      isExisting,
      skipped,
      countsForFairness: column.countsForFairness,
      leads,
```

- [ ] **Step 4: The create body sends the effective value**

In `app/utils/monthDraftCreate.ts`, find:
```ts
import type { ServiceFormat } from "./serviceFormat";
```
Replace with:
```ts
import type { ServiceFormat } from "./serviceFormat";
import { effectiveCreateCounts } from "@/app/components/admin/fairnessToggleModel";
```

Find:
```ts
  format?: ServiceFormat;
  leads: string[];
  bgvs: string[];
  chorus: string[];
  instruments: DraftInstrumentSlot[];
  foh: DraftFohSlot[];
}
```
Replace with:
```ts
  format?: ServiceFormat;
  /**
   * «Cuenta para equidad» (solver v3 C1 §6.1) — the draft's column value. The body
   * re-applies the past-month rule when it is built (`draftCreateBody`).
   */
  countsForFairness: boolean;
  leads: string[];
  bgvs: string[];
  chorus: string[];
  instruments: DraftInstrumentSlot[];
  foh: DraftFohSlot[];
}
```

Find:
```ts
/** The exact POST body for one draft. Blank slots are dropped, order preserved. */
export function draftCreateBody(draft: CreatableDraft, published: boolean) {
```
Replace with:
```ts
/**
 * The exact POST body for one draft. Blank slots are dropped, order preserved.
 *
 * `countsForFairness` is always sent (solver v3 C1 §6.1), decided HERE against
 * `todayIso` (default: now, in CDMX) rather than trusted from the draft: a draft of a
 * past month sends its type default whatever it holds (§6.0), so a tab left open
 * across a month boundary cannot send a value its month no longer allows — and a
 * past-dated create always hashes as the omit-at-default fingerprint.
 */
export function draftCreateBody(draft: CreatableDraft, published: boolean, todayIso?: string) {
```

Find:
```ts
    ...(draft._type === "special_role" && draft.format ? { format: draft.format } : {}),
    leads: draft.leads,
```
Replace with:
```ts
    ...(draft._type === "special_role" && draft.format ? { format: draft.format } : {}),
    countsForFairness: effectiveCreateCounts(draft._type, draft.date, draft.countsForFairness, todayIso),
    leads: draft.leads,
```

(`runDraftCreateBatch` is unchanged: it calls `draftCreateBody(draft, published)`, i.e. "now".)

- [ ] **Step 5: Stored columns read the GET row's value through the twin**

In `app/components/admin/storedRoleReadModel.ts`, find:
```ts
import { isWorshipNightFormat } from "@/app/utils/serviceFormat";
```
Replace with:
```ts
import { isWorshipNightFormat } from "@/app/utils/serviceFormat";
import { countsForFairness as readCountsForFairness } from "@/app/utils/countsForFairness";
```

Find:
```ts
    published: role.published !== false,
    admission: observation.admission,
```
Replace with:
```ts
    published: role.published !== false,
    admission: observation.admission,
    // C1 §6.1: the GET row's effective value; a row from an older server has none
    // and reads as its type default through the one twin.
    countsForFairness: readCountsForFairness({ _type: role._type, countsForFairness: role.countsForFairness }),
```

- [ ] **Step 6: Add the create helpers to the model**

In `app/components/admin/fairnessToggleModel.ts`, find:
```ts
import { countsForFairnessDefault, type FairnessRoleType } from "@/app/utils/countsForFairness";
import { serviceTodayIso } from "./serviceReadiness";
```
Replace with:
```ts
import { countsForFairnessDefault, type FairnessRoleType } from "@/app/utils/countsForFairness";
import type { GridColumn } from "./plannerModel";
import { serviceTodayIso } from "./serviceReadiness";
```

and append to the end of the file:

```ts

/**
 * Create mode (§6.1): the admin's header edits, by `columnId`, over the columns
 * `buildColumns` made — each column's EFFECTIVE value, the past-month rule applied.
 * Idempotent: applying it to columns it already produced changes nothing.
 */
export function applyCreateCountsEdits(
  columns: readonly GridColumn[],
  edits: ReadonlyMap<string, boolean>,
  todayIso: string = serviceTodayIso(),
): GridColumn[] {
  return columns.map((column) => ({
    ...column,
    countsForFairness: effectiveCreateCounts(
      column.type,
      column.date,
      edits.get(column.columnId) ?? column.countsForFairness,
      todayIso,
    ),
  }));
}

/**
 * Drop one column's held edit (§6.1: deselecting the weekend date or removing the
 * special discards its value). Returns the SAME map when there is nothing to drop,
 * so a state update with it re-renders nothing.
 */
export function withoutCountsEdit(edits: Map<string, boolean>, columnId: string): Map<string, boolean> {
  if (!edits.has(columnId)) return edits;
  const next = new Map(edits);
  next.delete(columnId);
  return next;
}
```

(`plannerModel.ts` imports `monthDraftCreate.ts`, which now imports this module, which imports `plannerModel.ts` **as a type only** — erased at runtime, so there is no import cycle.)

- [ ] **Step 7: Keep «+ Nuevo servicio» compiling with today's behaviour (interim)**

In `app/components/admin/MonthGenerator.tsx`, find:
```ts
import { WORSHIP_NIGHT_FORMAT, type ServiceFormat } from "@/app/utils/serviceFormat";
```
Replace with:
```ts
import { WORSHIP_NIGHT_FORMAT, type ServiceFormat } from "@/app/utils/serviceFormat";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
```

Find (inside `handleCreateOne`'s `draftCreateBody({ … })` literal):
```ts
      ...(createFormat ? { format: createFormat } : {}),
      leads: [],
```
Replace with:
```ts
      ...(createFormat ? { format: createFormat } : {}),
      // Task 13 replaces this with the composer's effective value; until then the
      // type default keeps today's behaviour exactly.
      countsForFairness: countsForFairnessDefault(createType),
      leads: [],
```

- [ ] **Step 8: Give every test fixture the new required field**

`npx tsc --noEmit` now lists exactly the fixtures below. Apply each Find → Replace (fixture-only; these change no assertion):

`app/components/admin/__tests__/PlannerGrid.test.tsx` — find:
```tsx
      { columnId: "role-a", date: "2026-08-12", type: "special_role", serviceName: "Vigilia" },
      { columnId: "role-b", date: "2026-08-12", type: "special_role", serviceName: "Retiro" },
```
replace with:
```tsx
      { columnId: "role-a", date: "2026-08-12", type: "special_role", serviceName: "Vigilia", countsForFairness: false },
      { columnId: "role-b", date: "2026-08-12", type: "special_role", serviceName: "Retiro", countsForFairness: false },
```
and replace **both** occurrences (replace-all) of:
```tsx
          columns: [{ columnId: "special-1", date: "2026-10-03", type: "special_role", serviceName: "Campamento · Alabanza", time: "09:00" }],
```
with:
```tsx
          columns: [{ columnId: "special-1", date: "2026-10-03", type: "special_role", serviceName: "Campamento · Alabanza", time: "09:00", countsForFairness: false }],
```

`app/components/admin/__tests__/groupFill.test.ts` — find:
```ts
  ({ columnId: id, date, type: "special_role", serviceName: `Set ${id}`, ...(time ? { time } : {}) });
const SUNDAY: GridColumn = { columnId: "sun", date: "2026-10-04", type: "sunday_role" };
```
replace with:
```ts
  ({ columnId: id, date, type: "special_role", serviceName: `Set ${id}`, countsForFairness: false, ...(time ? { time } : {}) });
const SUNDAY: GridColumn = { columnId: "sun", date: "2026-10-04", type: "sunday_role", countsForFairness: true };
```

`app/components/admin/__tests__/instrumentFill.test.ts` — find:
```ts
import { buildRows, createColumnId, type GridCell, type GridColumn } from "../plannerModel";
```
replace with:
```ts
import { buildRows, createColumnId, type GridCell, type GridColumn } from "../plannerModel";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
```
and find:
```ts
  ({ columnId: createColumnId(type, date), date, type });
```
replace with:
```ts
  ({ columnId: createColumnId(type, date), date, type, countsForFairness: countsForFairnessDefault(type) });
```

`app/components/admin/__tests__/localFill.test.ts` — find:
```ts
  type: "special_role",
  serviceName: "Vigilia",
};
const SUNDAY: GridColumn = {
  columnId: createColumnId("sunday_role", "2026-03-15"),
  date: "2026-03-15",
  type: "sunday_role",
};
```
replace with:
```ts
  type: "special_role",
  serviceName: "Vigilia",
  countsForFairness: false,
};
const SUNDAY: GridColumn = {
  columnId: createColumnId("sunday_role", "2026-03-15"),
  date: "2026-03-15",
  type: "sunday_role",
  countsForFairness: true,
};
```
and find:
```ts
      type: "special_role",
      serviceName: "Bautizos",
    };
```
replace with:
```ts
      type: "special_role",
      serviceName: "Bautizos",
      countsForFairness: false,
    };
```

`app/components/admin/__tests__/moveGate.test.ts` — find:
```ts
const COL_1: GridColumn = { columnId: "col-1", date: "2026-09-06", type: "sunday_role" };
const COL_2: GridColumn = { columnId: "col-2", date: "2026-09-13", type: "sunday_role" };
```
replace with:
```ts
const COL_1: GridColumn = { columnId: "col-1", date: "2026-09-06", type: "sunday_role", countsForFairness: true };
const COL_2: GridColumn = { columnId: "col-2", date: "2026-09-13", type: "sunday_role", countsForFairness: true };
```
and find:
```ts
    const saturday: GridColumn = { columnId: "col-sat", date: "2026-09-12", type: "saturday_role" };
```
replace with:
```ts
    const saturday: GridColumn = { columnId: "col-sat", date: "2026-09-12", type: "saturday_role", countsForFairness: true };
```

`app/components/admin/__tests__/plannerGridDrag.test.tsx` **and** `app/components/admin/__tests__/plannerGridPickPlace.test.tsx` — in each, find:
```tsx
const COL_A: GridColumn = { columnId: "col-1", date: "2026-09-06", type: "sunday_role" };
const COL_B: GridColumn = { columnId: "col-2", date: "2026-09-13", type: "sunday_role" };
```
replace with:
```tsx
const COL_A: GridColumn = { columnId: "col-1", date: "2026-09-06", type: "sunday_role", countsForFairness: true };
const COL_B: GridColumn = { columnId: "col-2", date: "2026-09-13", type: "sunday_role", countsForFairness: true };
```

`app/components/admin/__tests__/plannerSaveModel.test.ts` — find:
```ts
  date: "2026-02-01",
  published: false,
  admission: "approved",
};
```
replace with:
```ts
  date: "2026-02-01",
  published: false,
  admission: "approved",
  countsForFairness: true,
};
```

`app/components/admin/__tests__/plannerModel.test.ts` — the suite's own column shape takes the field as optional and `normalizeColumns` fills it the way `buildColumns` would. Find:
```ts
import { computeParticipation } from "@/app/utils/computeParticipation";
```
replace with:
```ts
import { computeParticipation } from "@/app/utils/computeParticipation";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
```
find:
```ts
type GridColumn = Omit<ModelGridColumn, "columnId"> & { columnId?: string };
```
replace with:
```ts
// `columnId` and `countsForFairness` are optional in the suite's own column shape;
// `normalizeColumns` fills them the way `buildColumns` would.
type GridColumn = Omit<ModelGridColumn, "columnId" | "countsForFairness"> & {
  columnId?: string;
  countsForFairness?: boolean;
};
```
find:
```ts
    columnId: column.columnId ?? createColumnId(column.type, column.date),
  }));
```
replace with:
```ts
    columnId: column.columnId ?? createColumnId(column.type, column.date),
    countsForFairness: column.countsForFairness ?? countsForFairnessDefault(column.type),
  }));
```
find:
```ts
      { columnId: "role-a", date: "2026-02-11", type: "special_role", serviceName: "Vigilia" },
      { columnId: "role-b", date: "2026-02-11", type: "special_role", serviceName: "Retiro" },
```
replace with:
```ts
      { columnId: "role-a", date: "2026-02-11", type: "special_role", serviceName: "Vigilia", countsForFairness: false },
      { columnId: "role-b", date: "2026-02-11", type: "special_role", serviceName: "Retiro", countsForFairness: false },
```
find:
```ts
      [{ columnId: "role-a", date: "2026-03-04", type: "special_role", serviceName: "Vigilia" }],
```
replace with:
```ts
      [{ columnId: "role-a", date: "2026-03-04", type: "special_role", serviceName: "Vigilia", countsForFairness: false }],
```
find:
```ts
        { columnId: "same", date: "2026-02-01", type: "sunday_role" },
        { columnId: "same", date: "2026-02-08", type: "sunday_role" },
```
replace with:
```ts
        { columnId: "same", date: "2026-02-01", type: "sunday_role", countsForFairness: true },
        { columnId: "same", date: "2026-02-08", type: "sunday_role", countsForFairness: true },
```
find:
```ts
        [{ columnId: "known", date: "2026-02-01", type: "sunday_role" }],
```
replace with:
```ts
        [{ columnId: "known", date: "2026-02-01", type: "sunday_role", countsForFairness: true }],
```
find (the `previous: DraftCard[]` literal in «preserves the complete create draft boundary»):
```ts
      date: "2026-02-01",
      exists: false,
      isExisting: false,
      skipped: false,
      leads: [],
      bgvs: [],
      chorus: [],
      instruments: [],
      foh: [],
    }];
```
replace with:
```ts
      date: "2026-02-01",
      exists: false,
      isExisting: false,
      skipped: false,
      countsForFairness: true,
      leads: [],
      bgvs: [],
      chorus: [],
      instruments: [],
      foh: [],
    }];
```
find (the `draft` helper in «historyEntryFromDrafts»):
```ts
    _type: "sunday_role",
    date: "2026-02-01",
    exists: false,
    isExisting: false,
    skipped: false,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...overrides,
  });
```
replace with:
```ts
    _type: "sunday_role",
    date: "2026-02-01",
    exists: false,
    isExisting: false,
    skipped: false,
    countsForFairness: true,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...overrides,
  });
```
find (the `specialDraft` literal):
```ts
    service_name: "Vigilia",
    exists: false,
    isExisting: false,
    skipped: false,
    leads: ["m1"],
```
replace with:
```ts
    service_name: "Vigilia",
    exists: false,
    isExisting: false,
    skipped: false,
    countsForFairness: false,
    leads: ["m1"],
```

`app/utils/__tests__/monthDraftCreate.test.ts` — find:
```ts
import { isValidCreationRequestId } from "@/app/utils/roleWriteRequest";
```
replace with:
```ts
import { isValidCreationRequestId } from "@/app/utils/roleWriteRequest";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
```
find:
```ts
    _type: "sunday_role",
    date: "2026-08-09",
    leads: ["mem-1"],
```
replace with:
```ts
    _type: "sunday_role",
    date: "2026-08-09",
    countsForFairness: countsForFairnessDefault(over._type ?? "sunday_role"),
    leads: ["mem-1"],
```
and replace **both** occurrences (replace-all) of:
```ts
date: "2026-10-03", service_name: "X", leads: [], bgvs: [], chorus: [], instruments: [], foh: [] };
```
with:
```ts
date: "2026-10-03", service_name: "X", countsForFairness: false, leads: [], bgvs: [], chorus: [], instruments: [], foh: [] };
```

`app/utils/__tests__/solverHistoryEquivalence.test.ts` — find:
```ts
import { draftCreateBody } from "@/app/utils/monthDraftCreate";
```
replace with:
```ts
import { draftCreateBody } from "@/app/utils/monthDraftCreate";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
```
find:
```ts
    exists: false,
    isExisting: false,
    skipped: false,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...over,
  };
```
replace with:
```ts
    exists: false,
    isExisting: false,
    skipped: false,
    countsForFairness: countsForFairnessDefault(over._type),
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...over,
  };
```

`app/utils/__tests__/solverHistoryEvidence.test.ts` — find:
```ts
import { draftCreateBody, type CreatableDraft } from "@/app/utils/monthDraftCreate";
```
replace with:
```ts
import { draftCreateBody, type CreatableDraft } from "@/app/utils/monthDraftCreate";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
```
find:
```ts
    creationRequestId: `req-evidence-${String(seq).padStart(4, "0")}`,
    leads: [],
```
replace with:
```ts
    creationRequestId: `req-evidence-${String(seq).padStart(4, "0")}`,
    countsForFairness: countsForFairnessDefault(over._type),
    leads: [],
```

(With the fixture at the type default, `solverHistoryEvidence.test.ts`'s existing round trip now sends the default explicitly through `draftCreateBody` and still reads `unchangedAs` — spec §7 «R11 positive control»; `countsForFairnessEvidence.test.ts` asserts it outright.)

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 9: Update the expectations that legitimately change**

Every create column and draft now carries the field, and every create body sends it.

`app/components/admin/__tests__/plannerModel.test.ts` — four `buildColumns` goldens (the fifth failure in that describe, «drops the SECOND of two specials…», is a cascade of an un-restored `console.warn` spy and turns green with these):

find:
```ts
    expect(cols).toEqual([
      { columnId: createColumnId("sunday_role", "2026-02-08"), date: "2026-02-08", type: "sunday_role" },
    ]);
```
replace with:
```ts
    expect(cols).toEqual([
      { columnId: createColumnId("sunday_role", "2026-02-08"), date: "2026-02-08", type: "sunday_role", countsForFairness: true },
    ]);
```
find:
```ts
    expect(cols).toEqual([
      { columnId: createColumnId("saturday_role", "2026-02-07"), date: "2026-02-07", type: "saturday_role" },
    ]);
```
replace with:
```ts
    expect(cols).toEqual([
      { columnId: createColumnId("saturday_role", "2026-02-07"), date: "2026-02-07", type: "saturday_role", countsForFairness: true },
    ]);
```
find:
```ts
      { columnId: createColumnId("special_role", "2026-02-07"), date: "2026-02-07", type: "special_role", serviceName: "Vigilia" },
      { columnId: createColumnId("sunday_role", "2026-02-08"), date: "2026-02-08", type: "sunday_role" },
    ]);
```
replace with:
```ts
      { columnId: createColumnId("special_role", "2026-02-07"), date: "2026-02-07", type: "special_role", serviceName: "Vigilia", countsForFairness: false },
      { columnId: createColumnId("sunday_role", "2026-02-08"), date: "2026-02-08", type: "sunday_role", countsForFairness: true },
    ]);
```
find:
```ts
      { columnId: createColumnId("sunday_role", "2026-02-01"), date: "2026-02-01", type: "sunday_role" },
      { columnId: createColumnId("saturday_role", "2026-02-07"), date: "2026-02-07", type: "saturday_role" },
      { columnId: createColumnId("sunday_role", "2026-02-08"), date: "2026-02-08", type: "sunday_role" },
      { columnId: createColumnId("saturday_role", "2026-02-14"), date: "2026-02-14", type: "saturday_role" },
      { columnId: createColumnId("sunday_role", "2026-02-15"), date: "2026-02-15", type: "sunday_role" },
      { columnId: createColumnId("saturday_role", "2026-02-21"), date: "2026-02-21", type: "saturday_role" },
      { columnId: createColumnId("sunday_role", "2026-02-22"), date: "2026-02-22", type: "sunday_role" },
      { columnId: createColumnId("saturday_role", "2026-02-28"), date: "2026-02-28", type: "saturday_role" },
```
replace with:
```ts
      { columnId: createColumnId("sunday_role", "2026-02-01"), date: "2026-02-01", type: "sunday_role", countsForFairness: true },
      { columnId: createColumnId("saturday_role", "2026-02-07"), date: "2026-02-07", type: "saturday_role", countsForFairness: true },
      { columnId: createColumnId("sunday_role", "2026-02-08"), date: "2026-02-08", type: "sunday_role", countsForFairness: true },
      { columnId: createColumnId("saturday_role", "2026-02-14"), date: "2026-02-14", type: "saturday_role", countsForFairness: true },
      { columnId: createColumnId("sunday_role", "2026-02-15"), date: "2026-02-15", type: "sunday_role", countsForFairness: true },
      { columnId: createColumnId("saturday_role", "2026-02-21"), date: "2026-02-21", type: "saturday_role", countsForFairness: true },
      { columnId: createColumnId("sunday_role", "2026-02-22"), date: "2026-02-22", type: "sunday_role", countsForFairness: true },
      { columnId: createColumnId("saturday_role", "2026-02-28"), date: "2026-02-28", type: "saturday_role", countsForFairness: true },
```

`app/components/admin/__tests__/MonthGenerator.stored.test.tsx` (test «creates one empty unpublished role and reuses its request ID after an unknown result») — find:
```tsx
      chorus: [],
      instruments: [],
      foh: [],
      published: false,
    });
    expect(bodies[1].creationRequestId).toBe(bodies[0].creationRequestId);
```
replace with:
```tsx
      chorus: [],
      instruments: [],
      foh: [],
      published: false,
      // Solver v3 C1: every create body carries the effective value — here the
      // Domingo default.
      countsForFairness: true,
    });
    expect(bodies[1].creationRequestId).toBe(bodies[0].creationRequestId);
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin app/utils app/api`
Expected: PASS (all; the five new describes included).

- [ ] **Step 11: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors (the `_counts` names in `fairnessToggleModel.test.ts` match the repo's `^_` unused-var pattern).

- [ ] **Step 12: Commit**

```bash
git add app/components/admin/plannerModel.ts app/utils/monthDraftCreate.ts app/components/admin/storedRoleReadModel.ts \
  app/components/admin/fairnessToggleModel.ts app/components/admin/MonthGenerator.tsx \
  app/components/admin/__tests__/PlannerGrid.test.tsx app/components/admin/__tests__/groupFill.test.ts \
  app/components/admin/__tests__/instrumentFill.test.ts app/components/admin/__tests__/localFill.test.ts \
  app/components/admin/__tests__/moveGate.test.ts app/components/admin/__tests__/plannerGridDrag.test.tsx \
  app/components/admin/__tests__/plannerGridPickPlace.test.tsx app/components/admin/__tests__/plannerModel.test.ts \
  app/components/admin/__tests__/plannerSaveModel.test.ts app/components/admin/__tests__/MonthGenerator.stored.test.tsx \
  app/components/admin/__tests__/fairnessToggleModel.test.ts app/components/admin/__tests__/fairnessInertV2.test.ts \
  app/utils/__tests__/monthDraftCreate.test.ts app/utils/__tests__/solverHistoryEquivalence.test.ts \
  app/utils/__tests__/solverHistoryEvidence.test.ts app/utils/__tests__/countsForFairnessEvidence.test.ts
git commit -m "feat(planner): create columns and drafts carry countsForFairness" \
  -m "Solver v3 C1 §6.1. Every grid column and draft carries its effective value — weekend columns at the type default, a special at the composer's choice — and every create body sends it, decided again when the body is built so a past-month draft always sends its type default (§6.0) and hashes as the omit-at-default fingerprint. v2 stays inert: buildSolveRequest takes no columns and historyEntryFromDrafts reads seats only, both pinned. «+ Nuevo servicio» sends the type default until Task 13 wires its switch."
```

---

## Task 10: Stored-side model — the PATCH body and the snapshot carry the value under §6.0

C1-R9 (stored half), C1-R14 (stored half), C1-D5, §6.1 stored mode, §7 rows «Save model» and «Read model».

**Files:**
- Modify: `app/components/admin/storedRoleReadModel.ts` (`StoredGridColumn` `:34-40`; `translateStoredRole` `:111-127`)
- Modify: `app/components/admin/fairnessToggleModel.ts` (imports; append stored helpers)
- Modify: `app/components/admin/plannerSaveModel.ts` (imports `:3`; `RoleSemanticSnapshot` `:6-16`; `StoredRolePatchBody` `:18-30`; `serializeStoredColumn` `:61-136`; `semanticSnapshot` `:138-156`)
- Fixtures: `app/components/admin/__tests__/moveGate.test.ts` (`storedColumn` `:675-677`), `plannerGridDrag.test.tsx` (`storedGrid` `:770-777`), `plannerSaveModel.test.ts` (`column`, `body()`)
- Expectations that legitimately change (C1-D5): `app/api/__tests__/roleWriteRoutes.test.ts` («preserves the complete production-shaped role…», `serialized.body` toEqual), `app/components/admin/__tests__/MonthGenerator.stored.test.tsx` («enables explicit save…» PATCH body), `app/components/admin/__tests__/MonthGenerator.storedMove.test.tsx` («PATCHes exactly the two services…», both bodies)
- Test: `app/components/admin/__tests__/plannerSaveModel.test.ts` (append), `storedRoleReadModel.test.ts` (append), `fairnessToggleModel.test.ts` (imports + append)

**Interfaces:**
- Consumes: `isPastServiceMonth`, `effectiveCreateCounts` (Task 8); `GridColumn.countsForFairness` (Task 9).
- Produces:
  - `StoredGridColumn.storedFairness: { date: string; countsForFairness: boolean }` — the GET row's date and value, frozen at translation; never overlaid by a header edit. C1-internal (not part of spec §9).
  - `StoredRolePatchBody.countsForFairness: boolean`, `RoleSemanticSnapshot.countsForFairness: boolean` (spec §9)
  - `serializeStoredColumn(column, rows, cells, todayIso?: string)` — body carries `effectiveStoredCounts(column, todayIso)`
  - `fairnessToggleModel.ts` adds `isStoredColumnPast(column: Pick<StoredGridColumn, "date" | "storedFairness">, todayIso?: string): boolean`, `effectiveStoredCounts(column: Pick<StoredGridColumn, "date" | "countsForFairness" | "storedFairness">, todayIso?: string): boolean`, `isFairnessColumnPast(column: GridColumn, todayIso?: string): boolean`, `effectiveColumnCounts(column: GridColumn, todayIso?: string): boolean`

- [ ] **Step 1: Write the failing tests**

Append to the end of `app/components/admin/__tests__/plannerSaveModel.test.ts`:

```ts

describe("countsForFairness in the stored save model (solver v3 C1 §6.1, §6.0)", () => {
  // `column` is dated 2026-02-01 and stored counted. On "2026-02-15" February is the
  // current month; on "2026-03-10" it is past.
  const CURRENT = "2026-02-15";
  const LATER = "2026-03-10";
  const at = (over: Partial<StoredGridColumn>): StoredGridColumn => ({ ...column, ...over });

  function serialized(col: StoredGridColumn, todayIso: string) {
    const result = serializeStoredColumn(col, rows, cells, todayIso);
    if (!result.ok) throw new Error(result.reasons.join(","));
    return result;
  }

  it("the PATCH body and the semantic snapshot always carry the column's value (C1-D5)", () => {
    const result = serialized(column, CURRENT);
    expect(result.body.countsForFairness).toBe(true);
    expect(result.snapshot.countsForFairness).toBe(true);
  });

  it("a toggle-only change is dirty", () => {
    const baseline = serialized(column, CURRENT);
    const toggled = serialized(at({ countsForFairness: false }), CURRENT);
    expect(toggled.body.countsForFairness).toBe(false);
    expect(toggled.body.leads).toEqual(baseline.body.leads);
    expect(sameRoleSemantics(baseline.snapshot, toggled.snapshot)).toBe(false);
  });

  it("reconciles a toggle-only save: applied, unknownConflict, committedThenSuperseded", () => {
    const intended = serialized(at({ countsForFairness: false }), CURRENT);
    const old = serialized(column, CURRENT);
    const attempt = freezeSaveAttempt("attempt-1", at({ countsForFairness: false }), intended);
    expect(reconcileSaveAttempt({
      attempt,
      transport: { kind: "unknown" },
      observed: { rev: "rev-2", snapshot: intended.snapshot },
    }).kind).toBe("applied");
    expect(reconcileSaveAttempt({
      attempt,
      transport: { kind: "unknown" },
      observed: { rev: "rev-1", snapshot: old.snapshot },
    }).kind).toBe("unknownConflict");
    expect(reconcileSaveAttempt({
      attempt,
      transport: { kind: "knownCommitted" },
      observed: { rev: "rev-3", snapshot: old.snapshot },
    }).kind).toBe("committedThenSuperseded");
  });

  it("a column whose stored date is past carries its stored value whatever edit it holds, and is not dirty from it", () => {
    const baseline = serialized(column, LATER);
    const held = serialized(at({ countsForFairness: false }), LATER);
    expect(held.body.countsForFairness).toBe(true);
    expect(sameRoleSemantics(baseline.snapshot, held.snapshot)).toBe(true);
  });

  it("an edited date moved into a past month makes the column past too", () => {
    const marchStored = at({
      date: "2026-02-22",
      countsForFairness: false,
      storedFairness: { date: "2026-03-01", countsForFairness: true },
    });
    const result = serialized(marchStored, LATER);
    expect(result.body.date).toBe("2026-02-22");
    expect(result.body.countsForFairness).toBe(true);
  });

  it("the same held edit is sent before a month boundary and not after it", () => {
    const held = at({ countsForFairness: false });
    expect(serialized(held, "2026-02-28").body.countsForFairness).toBe(false);
    expect(serialized(held, "2026-03-01").body.countsForFairness).toBe(true);
  });
});
```

Append to the end of `app/components/admin/__tests__/storedRoleReadModel.test.ts`:

```ts

describe("countsForFairness on the stored column (solver v3 C1 §6.1)", () => {
  const specialTarget = (): RoleTarget => target({
    targetKey: "special_role:special-1",
    type: "special_role",
    canonicalIds: ["special-1"],
    records: [{ ...target().records[0]!, id: "special-1", rev: "rev-1", type: "special_role" }],
    expectsLock: false,
    lock: null,
  });

  function weekendColumn(over: Record<string, unknown>) {
    const joined = joinStoredRoleInventory([role(over)], summary());
    expect(joined.coherent).toBe(true);
    return translateStoredRole(joined.roles[0]!)!.column;
  }

  function specialColumn(over: Record<string, unknown>) {
    const special = role({ _id: "special-1", _type: "special_role", service_name: "Vigilia", ...over });
    const joined = joinStoredRoleInventory([special], summary([specialTarget()]));
    expect(joined.coherent).toBe(true);
    return translateStoredRole(joined.roles[0]!)!.column;
  }

  it("carries the GET row's value, and freezes it with the stored date", () => {
    expect(weekendColumn({ countsForFairness: false })).toMatchObject({
      countsForFairness: false,
      storedFairness: { date: "2026-02-01", countsForFairness: false },
    });
    expect(specialColumn({ countsForFairness: true })).toMatchObject({
      countsForFairness: true,
      storedFairness: { date: "2026-02-01", countsForFairness: true },
    });
  });

  it("reads a row without the field (an older server) as its type default", () => {
    expect(weekendColumn({}).countsForFairness).toBe(true);
    expect(specialColumn({}).countsForFairness).toBe(false);
  });
});
```

In `app/components/admin/__tests__/fairnessToggleModel.test.ts`, find:
```ts
  applyCreateCountsEdits,
  effectiveCreateCounts,
  fairnessSwitchLabel,
  isPastServiceMonth,
  withoutCountsEdit,
} from "../fairnessToggleModel";
import { buildColumns } from "../plannerModel";
```
Replace with:
```ts
  applyCreateCountsEdits,
  effectiveColumnCounts,
  effectiveCreateCounts,
  effectiveStoredCounts,
  fairnessSwitchLabel,
  isFairnessColumnPast,
  isPastServiceMonth,
  isStoredColumnPast,
  withoutCountsEdit,
} from "../fairnessToggleModel";
import { buildColumns } from "../plannerModel";
import type { StoredGridColumn } from "../storedRoleReadModel";
```

and append to its end:

```ts

describe("stored columns (§6.0)", () => {
  // Stored counted on 2026-10-04; the admin has an edit holding it off.
  const held: StoredGridColumn = {
    columnId: "role-1",
    roleId: "role-1",
    rev: "rev-1",
    type: "sunday_role",
    date: "2026-10-04",
    published: false,
    admission: "approved",
    countsForFairness: false,
    storedFairness: { date: "2026-10-04", countsForFairness: true },
  };

  it("outside a past month the edit is the effective value", () => {
    expect(isStoredColumnPast(held, "2026-10-20")).toBe(false);
    expect(effectiveStoredCounts(held, "2026-10-20")).toBe(false);
    expect(effectiveColumnCounts(held, "2026-10-20")).toBe(false);
  });

  it("past by its stored date: the stored value wins", () => {
    expect(isStoredColumnPast(held, "2026-11-02")).toBe(true);
    expect(effectiveStoredCounts(held, "2026-11-02")).toBe(true);
    expect(isFairnessColumnPast(held, "2026-11-02")).toBe(true);
  });

  it("past by its EDITED date alone: the stored value still wins", () => {
    const movedBack: StoredGridColumn = { ...held, date: "2026-09-27" };
    expect(isStoredColumnPast(movedBack, "2026-10-20")).toBe(true);
    expect(effectiveStoredCounts(movedBack, "2026-10-20")).toBe(true);
  });

  it("a create column is past by its own date and shows the type default there", () => {
    const [sunday] = buildColumns({ sundayDates: ["2026-10-04"], activeSatDates: [] });
    const off = { ...sunday, countsForFairness: false };
    expect(isFairnessColumnPast(off, "2026-10-20")).toBe(false);
    expect(effectiveColumnCounts(off, "2026-10-20")).toBe(false);
    expect(isFairnessColumnPast(off, "2026-11-02")).toBe(true);
    expect(effectiveColumnCounts(off, "2026-11-02")).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/plannerSaveModel.test.ts app/components/admin/__tests__/storedRoleReadModel.test.ts app/components/admin/__tests__/fairnessToggleModel.test.ts`
Expected: FAIL — `isStoredColumnPast is not a function`; `expected undefined to be true` (body); `storedFairness` missing from `toMatchObject`.

- [ ] **Step 3: Freeze the stored state on the column**

In `app/components/admin/storedRoleReadModel.ts`, find:
```ts
export interface StoredGridColumn extends GridColumn {
  roleId: string;
  rev: string;
  lockRev?: string;
  published: boolean;
  admission: StoredRoleAdmission;
}
```
Replace with:
```ts
export interface StoredGridColumn extends GridColumn {
  roleId: string;
  rev: string;
  lockRev?: string;
  published: boolean;
  admission: StoredRoleAdmission;
  /**
   * What the GET row said, frozen at translation (solver v3 C1 §6.0): the stored
   * date and the stored «Cuenta para equidad». The header-edit overlay replaces
   * `date` and `countsForFairness`, never this, so the past-month rule can see the
   * stored AND the edited month and fall back to the stored value. C1-internal —
   * not part of the §9 client-type interface.
   */
  storedFairness: { date: string; countsForFairness: boolean };
}
```

Find:
```ts
  const { role } = observation;
  const column: StoredGridColumn = {
```
Replace with:
```ts
  const { role } = observation;
  const storedCounts = readCountsForFairness({ _type: role._type, countsForFairness: role.countsForFairness });
  const column: StoredGridColumn = {
```

Find (the lines Task 9 added):
```ts
    // C1 §6.1: the GET row's effective value; a row from an older server has none
    // and reads as its type default through the one twin.
    countsForFairness: readCountsForFairness({ _type: role._type, countsForFairness: role.countsForFairness }),
```
Replace with:
```ts
    // C1 §6.1: the GET row's effective value; a row from an older server has none
    // and reads as its type default through the one twin.
    countsForFairness: storedCounts,
    storedFairness: { date: role.date, countsForFairness: storedCounts },
```

- [ ] **Step 4: Add the stored helpers to the model**

In `app/components/admin/fairnessToggleModel.ts`, find:
```ts
import type { GridColumn } from "./plannerModel";
import { serviceTodayIso } from "./serviceReadiness";
```
Replace with:
```ts
import type { GridColumn } from "./plannerModel";
import { serviceTodayIso } from "./serviceReadiness";
import type { StoredGridColumn } from "./storedRoleReadModel";
```

and append to the end of the file:

```ts

/** A stored column is past when its stored date OR its edited date falls in a past month (§6.0). */
export function isStoredColumnPast(
  column: Pick<StoredGridColumn, "date" | "storedFairness">,
  todayIso: string = serviceTodayIso(),
): boolean {
  return isPastServiceMonth(column.storedFairness.date, todayIso) || isPastServiceMonth(column.date, todayIso);
}

/**
 * A stored column's effective value (§6.0, §6.1): its STORED value while it is past
 * — so a held toggle edit neither makes it dirty nor reaches the server — else the
 * column's (possibly edited) value.
 */
export function effectiveStoredCounts(
  column: Pick<StoredGridColumn, "date" | "countsForFairness" | "storedFairness">,
  todayIso: string = serviceTodayIso(),
): boolean {
  return isStoredColumnPast(column, todayIso) ? column.storedFairness.countsForFairness : column.countsForFairness;
}

function isStoredColumn(column: GridColumn): column is StoredGridColumn {
  return "storedFairness" in column;
}

/** Whether a grid column's Switch is in the past-month state, in either mode (§6.0). */
export function isFairnessColumnPast(column: GridColumn, todayIso: string = serviceTodayIso()): boolean {
  return isStoredColumn(column) ? isStoredColumnPast(column, todayIso) : isPastServiceMonth(column.date, todayIso);
}

/** The value a grid column's Switch shows, in either mode — always the effective one (§6.0). */
export function effectiveColumnCounts(column: GridColumn, todayIso: string = serviceTodayIso()): boolean {
  return isStoredColumn(column)
    ? effectiveStoredCounts(column, todayIso)
    : effectiveCreateCounts(column.type, column.date, column.countsForFairness, todayIso);
}
```

- [ ] **Step 5: The body and the snapshot carry the value**

In `app/components/admin/plannerSaveModel.ts`, find:
```ts
import type { GridCell } from "./plannerModel";
```
Replace with:
```ts
import type { GridCell } from "./plannerModel";
import { effectiveStoredCounts } from "./fairnessToggleModel";
```

Find (in `RoleSemanticSnapshot`):
```ts
  serviceName: string | null;
  time: string | null;
  leads: string[];
```
Replace with:
```ts
  serviceName: string | null;
  time: string | null;
  /** «Cuenta para equidad» — part of the semantics, so a toggle-only change is dirty (C1 §6.1). */
  countsForFairness: boolean;
  leads: string[];
```

Find (in `StoredRolePatchBody`):
```ts
  service_name?: string;
  time?: string;
  leads: string[];
```
Replace with:
```ts
  service_name?: string;
  time?: string;
  /** Always sent — the column's effective value (C1-D5); the `_rev` assertion makes a stale one a 409. */
  countsForFairness: boolean;
  leads: string[];
```

Find:
```ts
/** Complete full-array PATCH serializer. It never emits only dirty rows. */
export function serializeStoredColumn(
  column: StoredGridColumn,
  rows: readonly StoredGridRow[],
  cells: readonly GridCell[],
): StoredColumnSerialization {
```
Replace with:
```ts
/**
 * Complete full-array PATCH serializer. It never emits only dirty rows.
 *
 * `countsForFairness` is the column's EFFECTIVE value, decided here against
 * `todayIso` (default: now, in CDMX) — solver v3 C1 §6.0: a column whose stored or
 * edited date is in a past month sends its stored value whatever toggle edit it
 * holds, so the dirty check, the reconciliation and the body all agree.
 */
export function serializeStoredColumn(
  column: StoredGridColumn,
  rows: readonly StoredGridRow[],
  cells: readonly GridCell[],
  todayIso?: string,
): StoredColumnSerialization {
```

Find:
```ts
    ...(column.type === "special_role" && isServiceTime(column.time) ? { time: column.time } : {}),
    leads,
```
Replace with:
```ts
    ...(column.type === "special_role" && isServiceTime(column.time) ? { time: column.time } : {}),
    countsForFairness: effectiveStoredCounts(column, todayIso),
    leads,
```

Find (in `semanticSnapshot`):
```ts
    time: body._type === "special_role" && isServiceTime(body.time) ? body.time : null,
    leads: sortedStrings(body.leads),
```
Replace with:
```ts
    time: body._type === "special_role" && isServiceTime(body.time) ? body.time : null,
    countsForFairness: body.countsForFairness,
    leads: sortedStrings(body.leads),
```

The existing callers of `serializeStoredColumn` (`MonthGenerator.tsx`, `PlannerGrid.tsx`, `moveGate.ts`) keep compiling unchanged: `todayIso` is optional and defaults to now.

- [ ] **Step 6: Fixtures for `storedFairness`**

`app/components/admin/__tests__/moveGate.test.ts` — find:
```ts
  return { ...column, roleId: column.columnId, rev: "rev-1", published: true, admission };
```
replace with:
```ts
  return {
    ...column,
    roleId: column.columnId,
    rev: "rev-1",
    published: true,
    admission,
    storedFairness: { date: column.date, countsForFairness: column.countsForFairness },
  };
```

`app/components/admin/__tests__/plannerGridDrag.test.tsx` — find:
```tsx
    published: true,
    admission: opts.readOnlyColumnId === column.columnId ? "readOnly" : "approved",
  }));
```
replace with:
```tsx
    published: true,
    admission: opts.readOnlyColumnId === column.columnId ? "readOnly" : "approved",
    storedFairness: { date: column.date, countsForFairness: column.countsForFairness },
  }));
```

`app/components/admin/__tests__/plannerSaveModel.test.ts` — find:
```ts
  admission: "approved",
  countsForFairness: true,
};
```
replace with:
```ts
  admission: "approved",
  countsForFairness: true,
  storedFairness: { date: "2026-02-01", countsForFairness: true },
};
```
and find (in the `body()` helper):
```ts
    rev: "rev-1",
    _type: "sunday_role",
    date: "2026-02-01",
    leads: ["m1", "m2"],
```
replace with:
```ts
    rev: "rev-1",
    _type: "sunday_role",
    date: "2026-02-01",
    countsForFairness: true,
    leads: ["m1", "m2"],
```

- [ ] **Step 7: Update the exact stored-body expectations (C1-D5: every stored-mode body carries the value)**

`app/api/__tests__/roleWriteRoutes.test.ts` («preserves the complete production-shaped role through grid edit and the real PATCH transaction») — find:
```ts
    expect(serialized.body).toEqual({
      rev: "rev-1",
      lockRev: "lock-rev-1",
      _type: "sunday_role",
      date: "2026-08-09",
```
replace with:
```ts
    expect(serialized.body).toEqual({
      rev: "rev-1",
      lockRev: "lock-rev-1",
      _type: "sunday_role",
      date: "2026-08-09",
      // Solver v3 C1-D5: every stored-mode body carries the effective value — a row
      // without the field reads as its type default.
      countsForFairness: true,
```

`app/components/admin/__tests__/MonthGenerator.storedMove.test.tsx` («PATCHes exactly the two services the drag touched, and nothing else») — find:
```tsx
    expect(calls[0]!.body).toEqual({
      rev: "rev-a",
      lockRev: "lock-role-a",
      _type: "sunday_role",
      date: "2026-02-01",
```
replace with:
```tsx
    expect(calls[0]!.body).toEqual({
      rev: "rev-a",
      lockRev: "lock-role-a",
      _type: "sunday_role",
      date: "2026-02-01",
      countsForFairness: true,
```
and find:
```tsx
    expect(calls[1]!.body).toEqual({
      rev: "rev-b",
      lockRev: "lock-role-b",
      _type: "sunday_role",
      date: "2026-02-08",
```
replace with:
```tsx
    expect(calls[1]!.body).toEqual({
      rev: "rev-b",
      lockRev: "lock-role-b",
      _type: "sunday_role",
      date: "2026-02-08",
      countsForFairness: true,
```

`app/components/admin/__tests__/MonthGenerator.stored.test.tsx` («enables explicit save after one cell changes and PATCHes complete five-field arrays») — find:
```tsx
    expect(JSON.parse(String(init?.body))).toEqual({
      _type: "sunday_role",
      bgvs: ["bgv-a"],
      chorus: ["chorus-a"],
      date: "2026-02-01",
```
replace with:
```tsx
    expect(JSON.parse(String(init?.body))).toEqual({
      _type: "sunday_role",
      bgvs: ["bgv-a"],
      chorus: ["chorus-a"],
      // Solver v3 C1-D5: the stored value rides every stored-mode PATCH.
      countsForFairness: true,
      date: "2026-02-01",
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin app/utils app/api`
Expected: PASS.

- [ ] **Step 9: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors.

- [ ] **Step 10: Commit**

```bash
git add app/components/admin/storedRoleReadModel.ts app/components/admin/fairnessToggleModel.ts app/components/admin/plannerSaveModel.ts \
  app/components/admin/__tests__/moveGate.test.ts app/components/admin/__tests__/plannerGridDrag.test.tsx \
  app/components/admin/__tests__/plannerSaveModel.test.ts app/components/admin/__tests__/storedRoleReadModel.test.ts \
  app/components/admin/__tests__/fairnessToggleModel.test.ts app/api/__tests__/roleWriteRoutes.test.ts \
  app/components/admin/__tests__/MonthGenerator.storedMove.test.tsx app/components/admin/__tests__/MonthGenerator.stored.test.tsx
git commit -m "feat(planner): stored saves carry countsForFairness under the past-month rule" \
  -m "Solver v3 C1 §6.1, C1-D5. Every stored-mode PATCH body and semantic snapshot carry the column's effective value, so a toggle-only change is dirty and an unknown-outcome save reconciles from the reload instead of reading applied. The column keeps the GET row's date and value frozen beside the header overlay; while the stored or edited date is in a past month the stored value wins, decided again when the body is built, so a held edit is never sent once its month has passed."
```

---

## Task 11: The grid headers — create and stored switches, the note once

C1-R10 (grid half), C1-R14 (grid half), §6.2, §6.4, §6.6, §6.0 «Copy». After this task `PlannerGrid` can render the switches; nothing passes the prop yet (Task 13 wires it), so the app is unchanged and the theme-gallery fixture (which never passes it) stays byte-identical.

**Files:**
- Modify: `app/components/admin/PlannerGrid.tsx` (import `:136`; `PlannerGridProps` `:203-256`; destructuring `:594-625`; `ColumnHeader` call `:1741-1753`; `centre` `:1805-1807`; `ColumnHeader` `:2406-2560`)
- Test: `app/components/admin/__tests__/plannerGridFairness.test.tsx` (create)

**Interfaces:**
- Consumes: `FairnessSwitch`, `FairnessEngineNote` (Task 8); `effectiveColumnCounts`, `isFairnessColumnPast` (Task 10); `fairnessSwitchLabel` (Task 8); `serviceTodayIso` (`serviceReadiness.ts:996`); `StoredGridColumn.storedFairness` (Task 10).
- Produces:
  - `export type StoredHeaderPatch = { date?: string; serviceName?: string; time?: string; countsForFairness?: boolean }` from `PlannerGrid.tsx` (Task 13 imports it)
  - `PlannerGridProps.onStoredHeaderChange?: (columnId: string, patch: StoredHeaderPatch) => void`
  - `PlannerGridProps.fairness?: { onChange: (columnId: string, next: boolean) => void; createInFlight: boolean }` — omitted ⇒ no switch and no note

- [ ] **Step 1: Write the failing test**

Create `app/components/admin/__tests__/plannerGridFairness.test.tsx`:

```tsx
/** @vitest-environment jsdom */
// Solver v3 C1 §6.2, §6.4, §6.0, §6.6 — «Cuenta para equidad» on the grid's column
// headers, both modes. The clock is pinned (only `Date` is faked, so `waitFor` and
// timers stay real): August 2026 is "now", July 2026 is a past month.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlannerGrid, { type PlannerGridProps } from "../PlannerGrid";
import { FAIRNESS_ENGINE_NOTE, FAIRNESS_PAST_REASON } from "../fairnessToggleModel";
import { buildColumns, buildRows, type GridColumn } from "../plannerModel";
import type { StoredGridColumn } from "../storedRoleReadModel";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-15T18:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ROWS = buildRows();
// Saturday 8, Sunday 9 and a Wednesday special on the 12th — all in August.
const CREATE = buildColumns({
  sundayDates: ["2026-08-09"],
  activeSatDates: ["2026-08-08"],
  specials: [{ date: "2026-08-12", name: "Vigilia" }],
});
const SUNDAY_ID = CREATE.find((c) => c.date === "2026-08-09")!.columnId;

function props(over: Partial<PlannerGridProps> = {}): PlannerGridProps {
  return {
    rows: ROWS,
    columns: CREATE,
    cells: [],
    members: [],
    savedWindow: [],
    preflightFor: () => null,
    createBlockFor: () => null,
    canReceive: () => true,
    skipped: new Set(),
    unresolvedNames: [],
    unfilled: [],
    onCellsChange: vi.fn(),
    onRowsChange: vi.fn(),
    onToggleSkip: vi.fn(),
    onAuto: vi.fn(),
    autoState: { pending: false, error: null, disabledReason: null },
    diagnostics: null,
    fairness: { onChange: vi.fn(), createInFlight: false },
    ...over,
  };
}

function stored(column: Pick<GridColumn, "columnId" | "date" | "type" | "countsForFairness"> & Partial<StoredGridColumn>): StoredGridColumn {
  return {
    roleId: column.columnId,
    rev: "rev-1",
    published: false,
    admission: "approved",
    storedFairness: { date: column.date, countsForFairness: column.countsForFairness },
    ...column,
  };
}

const sw = (name: string) => screen.getByRole("switch", { name }) as HTMLButtonElement;
const describedText = (el: HTMLElement) => {
  const id = el.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
};

describe("create-mode headers (§6.2)", () => {
  it("every creatable column shows the switch at its type default, named by its column like «Omitir»", () => {
    render(<PlannerGrid {...props()} />);
    expect(sw("Cuenta para equidad 2026-08-08").getAttribute("aria-checked")).toBe("true");
    expect(sw("Cuenta para equidad 2026-08-09").getAttribute("aria-checked")).toBe("true");
    expect(sw("Cuenta para equidad 2026-08-12 · Vigilia").getAttribute("aria-checked")).toBe("false");
    expect(sw("Cuenta para equidad 2026-08-09").getAttribute("aria-describedby")).toBeNull();
  });

  it("reports the column id and the flipped value", () => {
    const onChange = vi.fn();
    render(<PlannerGrid {...props({ fairness: { onChange, createInFlight: false } })} />);
    fireEvent.click(sw("Cuenta para equidad 2026-08-09"));
    expect(onChange).toHaveBeenCalledWith(SUNDAY_ID, false);
  });

  it.each(["existing", "created"] as const)("is not shown on a column blocked from creation (%s)", (block) => {
    render(<PlannerGrid {...props({ createBlockFor: (c) => (c.date === "2026-08-09" ? block : null) })} />);
    expect(screen.queryByRole("switch", { name: "Cuenta para equidad 2026-08-09" })).toBeNull();
    expect(sw("Cuenta para equidad 2026-08-08")).toBeTruthy();
  });

  it("stays enabled on a skipped column — skipping is reversible and keeps the value", () => {
    render(<PlannerGrid {...props({ skipped: new Set([SUNDAY_ID]) })} />);
    expect(sw("Cuenta para equidad 2026-08-09").disabled).toBe(false);
  });

  it("is disabled while a create batch is in flight", () => {
    render(<PlannerGrid {...props({ fairness: { onChange: vi.fn(), createInFlight: true } })} />);
    expect(sw("Cuenta para equidad 2026-08-09").disabled).toBe(true);
  });

  it("on a column of a past month: disabled at the type default, with the reason as its description", () => {
    const july = buildColumns({
      sundayDates: ["2026-07-26"],
      activeSatDates: [],
      specials: [{ date: "2026-07-15", name: "Retiro", countsForFairness: true }],
    });
    render(<PlannerGrid {...props({ columns: july })} />);
    const special = sw("Cuenta para equidad 2026-07-15 · Retiro");
    expect(special.disabled).toBe(true);
    expect(special.getAttribute("aria-checked")).toBe("false");
    expect(describedText(special)).toBe(FAIRNESS_PAST_REASON);
    expect(sw("Cuenta para equidad 2026-07-26").getAttribute("aria-checked")).toBe("true");
  });
});

describe("stored-mode headers (§6.4)", () => {
  const SUN = stored({ columnId: "role-sun", date: "2026-08-09", type: "sunday_role", countsForFairness: true });
  const SP = stored({ columnId: "role-sp", date: "2026-08-12", type: "special_role", serviceName: "Vigilia", countsForFairness: false });

  it("every stored column carries the switch at its stored value", () => {
    render(<PlannerGrid {...props({ mode: "stored", columns: [SUN, SP] })} />);
    expect(sw("Cuenta para equidad 2026-08-09").getAttribute("aria-checked")).toBe("true");
    expect(sw("Cuenta para equidad 2026-08-12 · Vigilia").getAttribute("aria-checked")).toBe("false");
  });

  it("is disabled by readOnly and by the mutation lock, never by the date-move block", () => {
    const { unmount } = render(
      <PlannerGrid {...props({ mode: "stored", columns: [stored({ ...SUN, admission: "readOnly" })] })} />,
    );
    expect(sw("Cuenta para equidad 2026-08-09").disabled).toBe(true);
    unmount();
    const locked = render(<PlannerGrid {...props({ mode: "stored", columns: [SUN], mutationLocked: true })} />);
    expect(sw("Cuenta para equidad 2026-08-09").disabled).toBe(true);
    locked.unmount();
    render(<PlannerGrid {...props({ mode: "stored", columns: [SUN], storedDateBlockedReason: "No se puede mover la fecha." })} />);
    expect(sw("Cuenta para equidad 2026-08-09").disabled).toBe(false);
  });

  it("a past stored column shows its STORED value, disabled, with the reason — whatever edit it holds", () => {
    const julyHeld = stored({
      columnId: "role-jul",
      date: "2026-07-26",
      type: "sunday_role",
      countsForFairness: false,
      storedFairness: { date: "2026-07-26", countsForFairness: true },
    });
    render(<PlannerGrid {...props({ mode: "stored", columns: [julyHeld] })} />);
    const toggle = sw("Cuenta para equidad 2026-07-26");
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(describedText(toggle)).toBe(FAIRNESS_PAST_REASON);
  });

  it("an edited date moved into a past month disables it too", () => {
    const movedBack = { ...SUN, date: "2026-07-26" };
    render(<PlannerGrid {...props({ mode: "stored", columns: [movedBack] })} />);
    expect(sw("Cuenta para equidad 2026-07-26").disabled).toBe(true);
  });
});

describe("the v2 note (§6.6)", () => {
  it("shows once per grid, not per column, in both modes", () => {
    const { unmount } = render(<PlannerGrid {...props()} />);
    expect(screen.getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);
    unmount();
    render(
      <PlannerGrid
        {...props({
          mode: "stored",
          columns: [stored({ columnId: "role-sun", date: "2026-08-09", type: "sunday_role", countsForFairness: true })],
        })}
      />,
    );
    expect(screen.getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);
  });

  it("without the fairness prop there is no switch and no note (the gallery fixture's case)", () => {
    render(<PlannerGrid {...props({ fairness: undefined })} />);
    expect(screen.queryAllByRole("switch", { name: /^Cuenta para equidad/ })).toHaveLength(0);
    expect(screen.queryByText(FAIRNESS_ENGINE_NOTE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/plannerGridFairness.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "switch" and name "Cuenta para equidad 2026-08-08"` (and `tsc` reports `'fairness' does not exist in type 'PlannerGridProps'`).

- [ ] **Step 3: Imports, the patch type and the prop**

In `app/components/admin/PlannerGrid.tsx`, find:
```tsx
import type { TargetPreflight } from "./serviceReadiness";
```
Replace with:
```tsx
import { serviceTodayIso, type TargetPreflight } from "./serviceReadiness";
import { FairnessEngineNote, FairnessSwitch } from "./FairnessSwitch";
import { effectiveColumnCounts, fairnessSwitchLabel, isFairnessColumnPast } from "./fairnessToggleModel";
```

Find:
```tsx
export interface PlannerGridProps {
  mode?: "create" | "stored";
```
Replace with:
```tsx
/** A stored column's header edit: Fecha, Nombre, Hora and «Cuenta para equidad» (solver v3 C1 §6.4). */
export type StoredHeaderPatch = { date?: string; serviceName?: string; time?: string; countsForFairness?: boolean };

export interface PlannerGridProps {
  mode?: "create" | "stored";
```

Find:
```tsx
  onToggleSkip: (columnId: string) => void;
  onStoredHeaderChange?: (columnId: string, patch: { date?: string; serviceName?: string; time?: string }) => void;
  storedDateBlockedReason?: string | null;
```
Replace with:
```tsx
  onToggleSkip: (columnId: string) => void;
  onStoredHeaderChange?: (columnId: string, patch: StoredHeaderPatch) => void;
  /**
   * «Cuenta para equidad» (solver v3 C1 §6.2, §6.4). Omitted ⇒ no switch and no
   * note — the theme-gallery fixture and every test that predates C1. `onChange` gets
   * the column id: in create mode `MonthGenerator` holds the value per column, in
   * stored mode it rides the header overlay. `createInFlight` disables the create
   * headers' switch while a create batch posts; a stored header gates on
   * `readOnly`/`mutationLocked` like Fecha, Nombre and Hora — never on the date-move
   * block. Either mode disables it on a past month (§6.0).
   */
  fairness?: { onChange: (columnId: string, next: boolean) => void; createInFlight: boolean };
  storedDateBlockedReason?: string | null;
```

Find:
```tsx
    pinConflicts,
    clear,
  } = props;
```
Replace with:
```tsx
    pinConflicts,
    clear,
    fairness,
  } = props;
```

- [ ] **Step 4: Pass it to every header, and render the note once above the grid**

Find:
```tsx
            onStoredHeaderChange={onStoredHeaderChange}
            storedDateBlockedReason={storedDateBlockedReason}
            mutationLocked={mutationLocked}
            minWClass={cellMinW}
            clear={clear}
          />
```
Replace with:
```tsx
            onStoredHeaderChange={onStoredHeaderChange}
            storedDateBlockedReason={storedDateBlockedReason}
            mutationLocked={mutationLocked}
            minWClass={cellMinW}
            clear={clear}
            fairness={fairness}
          />
```

Find:
```tsx
  const centre = (
    <div className="min-w-0 flex-1 space-y-4 xl:order-2">
      {gridBlock}
```
Replace with:
```tsx
  const centre = (
    <div className="min-w-0 flex-1 space-y-4 xl:order-2">
      {/* C1 §6.6: once per grid, never per column; above the grid, so it never moves a cell mid-drag. */}
      {fairness && <FairnessEngineNote />}
      {gridBlock}
```

(`centre` renders in both modes and in full screen; the note sits outside the horizontal scroller, the switches inside it — no page-level horizontal scroll, ADR-0035.)

- [ ] **Step 5: The header renders the switch**

Find (the end of `ColumnHeader`'s destructuring):
```tsx
  minWClass,
  clear,
}: {
  column: GridColumn;
```
Replace with:
```tsx
  minWClass,
  clear,
  fairness,
}: {
  column: GridColumn;
```

Find (in `ColumnHeader`'s prop types):
```tsx
  onStoredHeaderChange?: (columnId: string, patch: { date?: string; serviceName?: string; time?: string }) => void;
  storedDateBlockedReason?: string | null;
  mutationLocked: boolean;
```
Replace with:
```tsx
  onStoredHeaderChange?: (columnId: string, patch: StoredHeaderPatch) => void;
  storedDateBlockedReason?: string | null;
  mutationLocked: boolean;
```

Find:
```tsx
  /** «Borrar» for THIS service (create mode only). */
  clear?: PlannerGridProps["clear"];
}) {
  const date = new Date(column.date.slice(0, 10) + "T12:00:00");
```
Replace with:
```tsx
  /** «Borrar» for THIS service (create mode only). */
  clear?: PlannerGridProps["clear"];
  /** «Cuenta para equidad» (solver v3 C1); omitted ⇒ no switch. */
  fairness?: PlannerGridProps["fairness"];
}) {
  const date = new Date(column.date.slice(0, 10) + "T12:00:00");
  // §6.0 — evaluated on every render, against CDMX "today".
  const todayIso = serviceTodayIso();
```

Find (the end of the stored block — Fecha/Nombre/Hora):
```tsx
                onChange={(event) => onStoredHeaderChange?.(column.columnId, { time: event.target.value })}
              />
            </>
          )}
        </div>
      )}
```
Replace with:
```tsx
                onChange={(event) => onStoredHeaderChange?.(column.columnId, { time: event.target.value })}
              />
            </>
          )}
          {fairness && (
            <FairnessSwitch
              checked={effectiveColumnCounts(column, todayIso)}
              onChange={(next) => fairness.onChange(column.columnId, next)}
              disabled={readOnly || mutationLocked}
              past={isFairnessColumnPast(column, todayIso)}
              ariaLabel={fairnessSwitchLabel(column)}
            />
          )}
        </div>
      )}
```

Find (the create-mode «Omitir» checkbox):
```tsx
          aria-label={`Omitir ${column.date}`}
        >
          Omitir
        </Checkbox>
      )}
```
Replace with:
```tsx
          aria-label={`Omitir ${column.date}`}
        >
          Omitir
        </Checkbox>
      )}
      {/* C1 §6.2: not on a column blocked from creation — its value is stored and edited in stored mode. */}
      {!stored && fairness && blockCopy === null && (
        <FairnessSwitch
          checked={effectiveColumnCounts(column, todayIso)}
          onChange={(next) => fairness.onChange(column.columnId, next)}
          disabled={fairness.createInFlight}
          past={isFairnessColumnPast(column, todayIso)}
          ariaLabel={fairnessSwitchLabel(column)}
        />
      )}
```

The create switch is not gated by `skipped` (skipping is reversible and keeps the value) and the stored switch is not gated by `storedDateBlockedReason` (it concerns the date only).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/plannerGridFairness.test.tsx app/components/admin`
Expected: PASS (every admin suite: `MonthGenerator` does not pass the prop yet).

- [ ] **Step 7: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors.

- [ ] **Step 8: Commit**

```bash
git add app/components/admin/PlannerGrid.tsx app/components/admin/__tests__/plannerGridFairness.test.tsx
git commit -m "feat(planner): «Cuenta para equidad» on every grid column header" \
  -m "Solver v3 C1 §6.2, §6.4. Behind an optional fairness prop, so the public gallery fixture and every earlier test render exactly as before: each creatable create column and every stored column gets the switch, named by its column like «Omitir», showing the effective value. Create headers hide it on a column blocked from creation and disable it while a batch posts; stored headers gate like Fecha/Nombre/Hora but never on the date-move block. A past-month column is disabled with its reason as the accessible description, and the v2 note shows once per grid."
```

---

## Task 12: The special composer (month calendar), and the note's v3 absence

C1-R10/R14 (composer half), §6.3, §6.6 (v3 branch).

**Files:**
- Modify: `app/components/admin/MonthCalendar.tsx` (imports `:5-6`; `onAddSpecial` prop `:65`; state `:198-200`; `openComposer` `:241-245`; `submitSpecial` `:271-293`; composer JSX `:395-425`)
- Modify: `app/components/admin/MonthGenerator.tsx` (`specials` state `:1824`; `onAddSpecial` `:4187`)
- Test: `app/components/admin/__tests__/MonthCalendar.test.tsx` (four assertions + three describes), `app/components/admin/__tests__/fairnessEngineV3.test.tsx` (create)

**Interfaces:**
- Consumes: `FairnessSwitch`, `FairnessEngineNote`, `FAIRNESS_LABEL`, `FAIRNESS_SPECIAL_HELP`, `effectiveCreateCounts`, `isPastServiceMonth` (Task 8); `buildColumns`' `specials[].countsForFairness` (Task 9); `PlannerGrid`'s `fairness` prop (Task 11).
- Produces: `MonthCalendarProps.onAddSpecial: (date: string, name: string, countsForFairness: boolean) => void`; `MonthGenerator`'s `specials` state is `{ date: string; name: string; countsForFairness: boolean }[]` and feeds `buildColumns` (the special column's initial value).

- [ ] **Step 1: Write the failing tests**

In `app/components/admin/__tests__/MonthCalendar.test.tsx`, find:
```tsx
import type { SolverConfigController } from "../solverConfigSource";
```
Replace with:
```tsx
import type { SolverConfigController } from "../solverConfigSource";
import {
  FAIRNESS_ENGINE_NOTE,
  FAIRNESS_PAST_REASON,
  FAIRNESS_SPECIAL_HELP,
} from "../fairnessToggleModel";
```

Find:
```tsx
    expect(onAddSpecial).toHaveBeenCalledWith(WEDNESDAY, "Bautizos");
```
Replace with:
```tsx
    // The third argument is the composer's «Cuenta para equidad» (solver v3 C1 §6.3):
    // off by default, and this test never touches it.
    expect(onAddSpecial).toHaveBeenCalledWith(WEDNESDAY, "Bautizos", false);
```

Replace **all three** occurrences (replace-all) of:
```tsx
    expect(onAddSpecial).toHaveBeenCalledWith("2026-08-15", "Boda");
```
with:
```tsx
    expect(onAddSpecial).toHaveBeenCalledWith("2026-08-15", "Boda", false);
```

Append to the end of the file:

```tsx

describe("MonthCalendar — «Cuenta para equidad» in the special composer (solver v3 C1 §6.3)", () => {
  // Only `Date` is faked: August 2026 is the current month.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-03T18:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const toggle = () => screen.getByRole("switch", { name: "Cuenta para equidad" }) as HTMLButtonElement;

  it("starts off, carries the choice to onAddSpecial, and starts off again on the next open", () => {
    const { container, onAddSpecial } = renderCalendar();
    fireEvent.click(cell(container, WEDNESDAY));
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(toggle().disabled).toBe(false);
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: "Bautizos" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onAddSpecial).toHaveBeenCalledWith(WEDNESDAY, "Bautizos", true);

    fireEvent.click(cell(container, "2026-08-13"));
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });

  it("«Cancelar» drops the choice", () => {
    const { container } = renderCalendar();
    fireEvent.click(cell(container, WEDNESDAY));
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(cell(container, WEDNESDAY));
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });

  it("shows the special help line and the v2 note once", () => {
    const { container } = renderCalendar();
    fireEvent.click(cell(container, WEDNESDAY));
    expect(screen.getAllByText(FAIRNESS_SPECIAL_HELP)).toHaveLength(1);
    expect(screen.getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);
  });
});

describe("MonthCalendar — the composer in a past month (solver v3 C1 §6.0)", () => {
  // September 2026 is "now": the calendar's August is a past month.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T18:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("is disabled at off with the reason as its description, and «Agregar» sends off", () => {
    const { container, onAddSpecial } = renderCalendar();
    fireEvent.click(cell(container, WEDNESDAY));
    const sw = screen.getByRole("switch", { name: "Cuenta para equidad" }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(document.getElementById(sw.getAttribute("aria-describedby")!)?.textContent).toBe(FAIRNESS_PAST_REASON);
    fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: "Bautizos" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onAddSpecial).toHaveBeenCalledWith(WEDNESDAY, "Bautizos", false);
  });
});

describe("MonthGenerator + calendar — the composer's choice reaches the special's create body (C1 §6.3)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-03T18:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("a special composed ON is created counted; the Sundays keep their default", async () => {
    const calls: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      if (url !== "/api/admin/roles") throw new Error(`unexpected fetch to ${url}`);
      calls.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, status: 200, json: async () => ({}) };
    });
    stubFetchWithHistory(fetchMock);

    const { container } = render(<Gen members={[]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    setMonthYear(container, 8, 2026);
    deselectAll(container, "saturday");
    fireEvent.click(cell(container, WEDNESDAY));
    fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: "Bautizos" } });
    fireEvent.click(screen.getByRole("switch", { name: "Cuenta para equidad" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Crear \d+ borrador/ }));

    await waitFor(() => expect(calls).toHaveLength(6));
    const byDate = Object.fromEntries(calls.map((body) => [body.date, body.countsForFairness]));
    expect(byDate[WEDNESDAY]).toBe(true);
    for (const sunday of AUG_SUNDAYS) expect(byDate[sunday]).toBe(true);
  });
});
```

Create `app/components/admin/__tests__/fairnessEngineV3.test.tsx`:

```tsx
/** @vitest-environment jsdom */
// Solver v3 C1-R11, parent U7 — «aplica con el nuevo solver» shows exactly while the
// engine is v2. Here the constant is mocked to "v3": every surface keeps its Switch
// and drops the note. (The v2 side is asserted beside each surface's own tests.)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../solverEngine", () => ({ SOLVER_ENGINE: "v3" }));

import MonthCalendar from "../MonthCalendar";
import PlannerGrid from "../PlannerGrid";
import { FairnessEngineNote } from "../FairnessSwitch";
import { FAIRNESS_ENGINE_NOTE } from "../fairnessToggleModel";
import { buildColumns, buildRows } from "../plannerModel";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-03T18:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the note under SOLVER_ENGINE "v3"', () => {
  it("the note component renders nothing", () => {
    const { container } = render(<FairnessEngineNote />);
    expect(container.textContent).toBe("");
  });

  it("the grid keeps its switches and drops the note", () => {
    render(
      <PlannerGrid
        rows={buildRows()}
        columns={buildColumns({ sundayDates: ["2026-08-09"], activeSatDates: [] })}
        cells={[]}
        members={[]}
        savedWindow={[]}
        preflightFor={() => null}
        createBlockFor={() => null}
        canReceive={() => true}
        skipped={new Set()}
        unresolvedNames={[]}
        unfilled={[]}
        onCellsChange={vi.fn()}
        onRowsChange={vi.fn()}
        onToggleSkip={vi.fn()}
        onAuto={vi.fn()}
        autoState={{ pending: false, error: null, disabledReason: null }}
        diagnostics={null}
        fairness={{ onChange: vi.fn(), createInFlight: false }}
      />,
    );
    expect(screen.getByRole("switch", { name: "Cuenta para equidad 2026-08-09" })).toBeTruthy();
    expect(screen.queryByText(FAIRNESS_ENGINE_NOTE)).toBeNull();
  });

  it("the special composer keeps its switch and drops the note", () => {
    const { container } = render(
      <MonthCalendar
        year={2026}
        month={8}
        selectedSundays={[]}
        selectedSaturdays={[]}
        specials={[]}
        existingRoles={[]}
        onToggleWeekend={vi.fn()}
        onAddSpecial={vi.fn()}
        onRemoveSpecial={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('[data-date="2026-08-12"]')!);
    expect(screen.getByRole("switch", { name: "Cuenta para equidad" })).toBeTruthy();
    expect(screen.queryByText(FAIRNESS_ENGINE_NOTE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/MonthCalendar.test.tsx app/components/admin/__tests__/fairnessEngineV3.test.tsx`
Expected: FAIL — `expected "spy" to be called with arguments: [ '2026-08-12', 'Bautizos', false ]` (it is called with two), and `Unable to find an accessible element with the role "switch" and name "Cuenta para equidad"` in the composer.

- [ ] **Step 3: The composer switch**

In `app/components/admin/MonthCalendar.tsx`, find:
```tsx
import { draftTargetKey } from "./plannerModel";
import Select from "@/app/components/ui/Select";
```
Replace with:
```tsx
import { draftTargetKey } from "./plannerModel";
import Select from "@/app/components/ui/Select";
import { FairnessEngineNote, FairnessSwitch } from "./FairnessSwitch";
import {
  FAIRNESS_LABEL,
  FAIRNESS_SPECIAL_HELP,
  effectiveCreateCounts,
  isPastServiceMonth,
} from "./fairnessToggleModel";
```

Find:
```tsx
  onAddSpecial: (date: string, name: string) => void;
```
Replace with:
```tsx
  /**
   * `countsForFairness` is the composer's «Cuenta para equidad» (solver v3 C1 §6.3) —
   * off by default each time the composer opens, the type default in a past month —
   * and becomes the special column's initial value.
   */
  onAddSpecial: (date: string, name: string, countsForFairness: boolean) => void;
```

Find:
```tsx
  const [draftName, setDraftName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
```
Replace with:
```tsx
  const [draftName, setDraftName] = useState("");
  const [draftCounts, setDraftCounts] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
```

Find:
```tsx
  function openComposer(date: string) {
    setNotice(null);
    setDraftName("");
    setComposerDate(date);
  }
```
Replace with:
```tsx
  function openComposer(date: string) {
    setNotice(null);
    setDraftName("");
    setDraftCounts(false);
    setComposerDate(date);
  }
```

Find:
```tsx
    onAddSpecial(openDate, name);
    setComposerDate(null);
    setDraftName("");
    setNotice(null);
  }
```
Replace with:
```tsx
    // §6.0: decided now — in a past month the special's type default, whatever was chosen.
    onAddSpecial(openDate, name, effectiveCreateCounts("special_role", openDate, draftCounts));
    setComposerDate(null);
    setDraftName("");
    setDraftCounts(false);
    setNotice(null);
  }
```

Find (the end of the name input, before the buttons):
```tsx
            className="min-h-[44px] w-full px-3 py-2 rounded-lg border border-accent/20 bg-transparent font-body text-sm focus:outline-none focus:border-accent transition-colors"
          />
          <div className="flex gap-2">
```
Replace with:
```tsx
            className="min-h-[44px] w-full px-3 py-2 rounded-lg border border-accent/20 bg-transparent font-body text-sm focus:outline-none focus:border-accent transition-colors"
          />
          <FairnessSwitch
            checked={effectiveCreateCounts("special_role", openDate, draftCounts)}
            onChange={setDraftCounts}
            past={isPastServiceMonth(openDate)}
            ariaLabel={FAIRNESS_LABEL}
            help={FAIRNESS_SPECIAL_HELP}
          />
          <FairnessEngineNote />
          <div className="flex gap-2">
```

Find (the composer's «Cancelar»):
```tsx
              onClick={() => {
                setComposerDate(null);
                setDraftName("");
                setNotice(null);
              }}
```
Replace with:
```tsx
              onClick={() => {
                setComposerDate(null);
                setDraftName("");
                setDraftCounts(false);
                setNotice(null);
              }}
```

- [ ] **Step 4: The composer's choice reaches the special's column**

In `app/components/admin/MonthGenerator.tsx`, find:
```tsx
  const [specials, setSpecials] = useState<{ date: string; name: string }[]>([]);
```
Replace with:
```tsx
  const [specials, setSpecials] = useState<{ date: string; name: string; countsForFairness: boolean }[]>([]);
```

Find:
```tsx
        onAddSpecial={(date, name) => setSpecials(prev => [...prev.filter(s => s.date !== date), { date, name }])}
```
Replace with:
```tsx
        onAddSpecial={(date, name, countsForFairness) =>
          setSpecials(prev => [...prev.filter(s => s.date !== date), { date, name, countsForFairness }])}
```

(`buildColumns` already turns `specials[].countsForFairness` into the column's initial value — Task 9.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/MonthCalendar.test.tsx app/components/admin/__tests__/fairnessEngineV3.test.tsx app/components/admin`
Expected: PASS.

- [ ] **Step 6: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors.

- [ ] **Step 7: Commit**

```bash
git add app/components/admin/MonthCalendar.tsx app/components/admin/MonthGenerator.tsx \
  app/components/admin/__tests__/MonthCalendar.test.tsx app/components/admin/__tests__/fairnessEngineV3.test.tsx
git commit -m "feat(planner): the special composer sets a special's countsForFairness" \
  -m "Solver v3 C1 §6.3. The calendar's special composer gets the switch, off each time it opens, with the help line on how a counted special's Lead maps to Dom or Sáb Lead; in a past month it is disabled at off with its reason. The choice becomes the special column's initial value and so its create body. Under a mocked v3 engine every surface keeps its switch and drops the note."
```

---

## Task 13: Wire `MonthGenerator` — held create edits, the stored overlay, «+ Nuevo servicio»

C1-R9, C1-R10, C1-R14 (every surface end to end), §6.1, §6.2, §6.4, §6.5, §6.0 at render and at body build.

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx` (imports `:14-17`; state after `:1824`, `:2069`, `:2077`; month reset `:2121-2126`; `createAttempt` ref `:2081-2086`; `createColumns`/`columns` `:2262-2273`; create verification `:2518-2541`; `handleStoredHeaderChange` `:2986`; new `handleFairnessChange` before `handleRowsChange` `:3001`; `handleCreateOne` `:3084-3104`; calendar handlers `:4171-4188`; `<PlannerGrid>` `:4609-4610`; composer JSX `:4372-4395`)
- Test: `app/components/admin/__tests__/MonthGenerator.fairness.test.tsx` (create)

**Interfaces:**
- Consumes: `StoredHeaderPatch` (Task 11); `applyCreateCountsEdits`, `withoutCountsEdit`, `effectiveStoredCounts`, `effectiveCreateCounts`, `isPastServiceMonth`, `FAIRNESS_LABEL`, `FAIRNESS_SPECIAL_HELP` (Tasks 8–10); `FairnessSwitch`, `FairnessEngineNote` (Task 8); `countsForFairness` twin, `countsForFairnessDefault` (Task 2); `serviceTodayIso`.
- Produces: no new exports. Behaviour: grid headers get `fairness={{ onChange: handleFairnessChange, createInFlight: pushing }}`; create edits live in `createCountsEdits: Map<columnId, boolean>`; stored edits ride `storedHeaderEdits` as `{ countsForFairness }`; «+ Nuevo servicio» has its own switch whose effective value is part of `createAttempt.current.target` and of the verification.

- [ ] **Step 1: Write the failing integration test**

Create `app/components/admin/__tests__/MonthGenerator.fairness.test.tsx`:

```tsx
/** @vitest-environment jsdom */
// Solver v3 C1 §6 — «Cuenta para equidad» wired through MonthGenerator, with the REAL
// PlannerGrid and MonthCalendar (no mocks), in both modes and in «+ Nuevo servicio».
//
// The clock is pinned with `vi.useFakeTimers({ toFake: ["Date"] })`: only `Date` is
// faked, so `waitFor` and every timer stay real. Unless a case moves it, "now" is
// 2026-02-15 in CDMX — February 2026 is the current month, January 2026 is past.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
import {
  FAIRNESS_ENGINE_NOTE,
  FAIRNESS_PAST_REASON,
  FAIRNESS_SPECIAL_HELP,
} from "../fairnessToggleModel";
import type { RoleDomainSummary, RoleTarget } from "@/app/utils/serviceReadSummary";
import type { ServiceRole } from "../serviceCardModel";
import { stubFetchWithHistory } from "./derivedHistoryHarness";
import { AdminProviders } from "./providersHarness";
import { readyRules } from "./rulesHarness";

const FEB_15 = new Date("2026-02-15T18:00:00.000Z");

let uuid = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FEB_15);
  localStorage.clear();
  uuid = 0;
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `req-fairness-${++uuid}`) });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── Shared helpers ──────────────────────────────────────────────────────────

const sw = (name: string) => screen.getByRole("switch", { name }) as HTMLButtonElement;
const describedText = (el: HTMLElement) => {
  const id = el.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
};

function response(status = 200, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// ─── Stored-mode harness (the storedMove pattern: real grid, coherent integrity) ──

const MEMBERS = ["ana", "beto"].map((id) => ({ _id: id, member_name: id }));

function member(id: string, key: string) {
  return { _id: id, _key: key, member_name: id };
}

function role(overrides: Partial<ServiceRole> & Pick<ServiceRole, "_id" | "_rev" | "date">): ServiceRole {
  return {
    _type: "sunday_role",
    published: false,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...overrides,
  };
}

function targetFor(value: ServiceRole): RoleTarget {
  const isSpecial = value._type === "special_role";
  return {
    targetKey: isSpecial ? value._id : `${value._type}:${value.date}`,
    type: value._type,
    canonicalCount: 1,
    canonicalIds: [value._id],
    canonicalState: "single",
    publicState: "single",
    memberVisibleCount: value.published === false ? 0 : 1,
    draftIds: [],
    records: [{
      id: value._id,
      rev: value._rev,
      type: value._type,
      serviceDate: value.date,
      published: value.published !== false,
      assignedRefs: [...new Set(value.leads.map((item) => item._id))],
      members: [],
      danglingRefs: [],
    }],
    expectsLock: !isSpecial,
    lock: isSpecial ? null : {
      id: `roleTarget.${value._type}.${value.date}`,
      rev: `lock-${value._id}`,
      state: "claimed",
      roleId: value._id,
      generation: 1,
    },
    lockIssues: [],
  };
}

function source(roles: ServiceRole[], generation = 1) {
  const integrity: RoleDomainSummary = { targets: roles.map(targetFor), recordIssues: [], lockIssues: [] };
  return {
    roles,
    integrity,
    rolesStatus: "ready" as const,
    integrityStatus: "ready" as const,
    rolesGeneration: generation,
    integrityGeneration: generation,
    reload: vi.fn(async () => true),
  };
}

function renderStored(roles: ServiceRole[], options: { initialMonth?: string; openComposerInitially?: boolean } = {}) {
  const onCreated = vi.fn();
  const base = {
    mode: "stored" as const,
    members: MEMBERS,
    initialMonth: options.initialMonth ?? "2026-02",
    openComposerInitially: options.openComposerInitially,
    rules: readyRules(),
    onClose: vi.fn(),
    onCreated,
  };
  const first = source(roles);
  const view = render(
    <MonthGenerator {...base} existingRoles={roles} allRoles={roles} storedSource={first} />,
    { wrapper: AdminProviders },
  );
  return {
    ...view,
    onCreated,
    storedSource: first,
    /** Re-render with the same state — the clock may have moved in between. */
    rerenderSame: () =>
      view.rerender(<MonthGenerator {...base} existingRoles={roles} allRoles={roles} storedSource={first} />),
    /** A reload that answers with new server state, exactly as production does. */
    reloadWith: (next: ServiceRole[], generation: number) =>
      view.rerender(
        <MonthGenerator {...base} existingRoles={next} allRoles={next} storedSource={source(next, generation)} />,
      ),
  };
}

const SUN_FEB_01 = role({ _id: "role-sun", _rev: "rev-sun", date: "2026-02-01", leads: [member("ana", "k-ana")] });
const SAT_FEB_07_OFF = role({ _id: "role-sat", _rev: "rev-sat", _type: "saturday_role", date: "2026-02-07", countsForFairness: false });
const SP_FEB_11 = role({ _id: "role-sp", _rev: "rev-sp", _type: "special_role", date: "2026-02-11", service_name: "Vigilia" });

// ─── Stored mode (§6.4) ──────────────────────────────────────────────────────

describe("stored mode — the header switch (C1 §6.4, §6.1)", () => {
  it("shows each row's value; a row without the field reads as its type default", () => {
    stubFetchWithHistory(vi.fn());
    renderStored([SUN_FEB_01, SAT_FEB_07_OFF, SP_FEB_11]);
    expect(sw("Cuenta para equidad 2026-02-01").getAttribute("aria-checked")).toBe("true");
    expect(sw("Cuenta para equidad 2026-02-07").getAttribute("aria-checked")).toBe("false");
    expect(sw("Cuenta para equidad 2026-02-11 · Vigilia").getAttribute("aria-checked")).toBe("false");
    expect(screen.getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);
  });

  it("a toggle-only change is one dirty service, and its PATCH carries the new value and the unchanged roster", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response(200));
    stubFetchWithHistory(fetchMock);
    renderStored([SUN_FEB_01]);

    fireEvent.click(sw("Cuenta para equidad 2026-02-01"));
    expect(sw("Cuenta para equidad 2026-02-01").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Guardar 1 servicio" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/roles/role-sun");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      rev: "rev-sun",
      date: "2026-02-01",
      countsForFairness: false,
      leads: ["ana"],
    });
  });

  it("toggling back to the stored value leaves nothing to save", () => {
    stubFetchWithHistory(vi.fn());
    renderStored([SUN_FEB_01]);
    fireEvent.click(sw("Cuenta para equidad 2026-02-01"));
    fireEvent.click(sw("Cuenta para equidad 2026-02-01"));
    expect((screen.getByRole("button", { name: "Guardar 0 servicios" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a past month, opened as «Roles previos» → «Editar mes» opens it: every switch disabled at its stored value, with the reason", () => {
    stubFetchWithHistory(vi.fn());
    // ServicesPanel's «Editar mes» mounts exactly this: mode "stored", initialMonth = the past month.
    renderStored(
      [
        role({ _id: "role-jan", _rev: "rev-jan", date: "2026-01-04", countsForFairness: false }),
        role({ _id: "role-jan-sp", _rev: "rev-jan-sp", _type: "special_role", date: "2026-01-14", service_name: "Retiro", countsForFairness: true }),
      ],
      { initialMonth: "2026-01" },
    );
    const sunday = sw("Cuenta para equidad 2026-01-04");
    const special = sw("Cuenta para equidad 2026-01-14 · Retiro");
    for (const toggle of [sunday, special]) {
      expect(toggle.disabled).toBe(true);
      expect(describedText(toggle)).toBe(FAIRNESS_PAST_REASON);
    }
    expect(sunday.getAttribute("aria-checked")).toBe("false");
    expect(special.getAttribute("aria-checked")).toBe("true");
  });

  it("a held edit is offered before the month boundary and gone after it", () => {
    vi.setSystemTime(new Date("2026-02-28T18:00:00.000Z"));
    stubFetchWithHistory(vi.fn());
    const { rerenderSame } = renderStored([SUN_FEB_01]);
    fireEvent.click(sw("Cuenta para equidad 2026-02-01"));
    expect(screen.getByRole("button", { name: "Guardar 1 servicio" })).toBeTruthy();

    vi.setSystemTime(new Date("2026-03-01T18:00:00.000Z"));
    rerenderSame();
    const toggle = sw("Cuenta para equidad 2026-02-01");
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(describedText(toggle)).toBe(FAIRNESS_PAST_REASON);
    expect((screen.getByRole("button", { name: "Guardar 0 servicios" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ─── «+ Nuevo servicio» (§6.5) ───────────────────────────────────────────────

describe("«+ Nuevo servicio» — the composer switch (C1 §6.5)", () => {
  const composerSwitch = () => sw("Cuenta para equidad");
  const composer = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-fairness-composer]")!;

  it("follows the Tipo until touched, keeps the admin's value after, and «Cancelar» resets it", () => {
    stubFetchWithHistory(vi.fn());
    const { container } = renderStored([], { openComposerInitially: true });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("true"); // Domingo
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "special_role" } });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("false");
    expect(within(composer(container)).getByText(FAIRNESS_SPECIAL_HELP)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "worship_night" } });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "saturday_role" } });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("true");
    expect(within(composer(container)).getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);

    fireEvent.click(composerSwitch()); // touched: off
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "sunday_role" } });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo servicio" }));
    expect(composerSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("keys the creation request on the value: the same value retries the same id, a flipped one mints a new one", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return response(400, { error: "invalid_request" });
    });
    stubFetchWithHistory(fetchMock);
    renderStored([], { openComposerInitially: true });

    const create = () => screen.getByRole("button", { name: "Crear vacío" }) as HTMLButtonElement;
    fireEvent.click(create());
    await waitFor(() => expect(bodies).toHaveLength(1));
    await waitFor(() => expect(create().disabled).toBe(false));
    fireEvent.click(create());
    await waitFor(() => expect(bodies).toHaveLength(2));
    await waitFor(() => expect(composerSwitch().disabled).toBe(false));
    fireEvent.click(composerSwitch());
    fireEvent.click(create());
    await waitFor(() => expect(bodies).toHaveLength(3));

    expect(bodies.map((body) => body.countsForFairness)).toEqual([true, true, false]);
    expect(bodies[1].creationRequestId).toBe(bodies[0].creationRequestId);
    expect(bodies[2].creationRequestId).not.toBe(bodies[0].creationRequestId);
  });

  it("verifies a create only when the reload shows the requested value", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { creationRequestId: string };
      return response(201, { _id: "role-new", creationRequestId: body.creationRequestId });
    });
    stubFetchWithHistory(fetchMock);
    const { onCreated, storedSource, reloadWith } = renderStored([], { openComposerInitially: true });

    fireEvent.click(composerSwitch()); // Domingo, created OFF
    fireEvent.click(screen.getByRole("button", { name: "Crear vacío" }));
    await waitFor(() => expect(storedSource.reload).toHaveBeenCalled());

    const created = role({ _id: "role-new", _rev: "rev-new", date: "2026-02-01", countsForFairness: true });
    reloadWith([created], 2);
    await waitFor(() => expect(screen.getByRole("button", { name: "Verificando…" })).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();

    reloadWith([{ ...created, _rev: "rev-new-2", countsForFairness: false }], 3);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("in a past month: disabled at the Tipo's default with the reason, and the body carries that default", async () => {
    vi.setSystemTime(new Date("2026-03-10T18:00:00.000Z"));
    const bodies: Record<string, unknown>[] = [];
    stubFetchWithHistory(vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return response(400, { error: "invalid_request" });
    }));
    renderStored([], { openComposerInitially: true });

    expect(composerSwitch().disabled).toBe(true);
    expect(composerSwitch().getAttribute("aria-checked")).toBe("true");
    expect(describedText(composerSwitch())).toBe(FAIRNESS_PAST_REASON);
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "special_role" } });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByPlaceholderText("Nombre del servicio"), { target: { value: "Vigilia" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear vacío" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ _type: "special_role", countsForFairness: false });
  });
});

// ─── Create mode (§6.1, §6.2) ────────────────────────────────────────────────

function Gen(props: Omit<React.ComponentProps<typeof MonthGenerator>, "rules">) {
  return (
    <AdminProviders>
      <MonthGenerator {...props} rules={readyRules()} />
    </AdminProviders>
  );
}

function setMonthYear(container: HTMLElement, month: number, year: number) {
  fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: String(month) } });
  fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: String(year) } });
}

function deselectAll(container: HTMLElement, kind: "sunday" | "saturday") {
  const dates = Array.from(container.querySelectorAll(`[data-day-kind="${kind}"]`)).map((el) => el.getAttribute("data-date"));
  for (const date of dates) {
    const cell = container.querySelector(`[data-date="${date}"]`);
    if (cell?.getAttribute("data-selected") === "true") fireEvent.click(cell);
  }
}

/** Records every create body; answers the history read and anything else with a 200. */
function stubCreates() {
  const bodies: Record<string, unknown>[] = [];
  stubFetchWithHistory(vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/roles") bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return response(200);
  }));
  return bodies;
}

describe("create mode — columns, drafts and bodies (C1 §6.1, §6.2)", () => {
  it("columns enter at their defaults; a header edit and the composer's choice reach the create bodies", async () => {
    const bodies = stubCreates();
    const { container } = render(<Gen members={[]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    setMonthYear(container, 2, 2026);
    deselectAll(container, "saturday");
    fireEvent.click(container.querySelector('[data-date="2026-02-11"]')!);
    fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: "Vigilia" } });
    fireEvent.click(sw("Cuenta para equidad"));
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    expect(sw("Cuenta para equidad 2026-02-01").getAttribute("aria-checked")).toBe("true");
    expect(sw("Cuenta para equidad 2026-02-11 · Vigilia").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw("Cuenta para equidad 2026-02-08"));
    expect(screen.getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /^Crear \d+ borrador/ }));
    await waitFor(() => expect(bodies).toHaveLength(5));
    expect(Object.fromEntries(bodies.map((body) => [body.date, body.countsForFairness]))).toEqual({
      "2026-02-01": true,
      "2026-02-08": false,
      "2026-02-11": true,
      "2026-02-15": true,
      "2026-02-22": true,
    });
  });

  it("holds a header edit across «Omitir», Auto and «← Volver»; deselecting the date discards it", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/solve") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            schedule: { "1": { Sunday: { Lead: ["Ana"], BGV: [], Choir: [] } } },
            total_counts: { Ana: 1 },
            role_counts: { Ana: { "Sun.Lead": 1 } },
            unfilled_seats: [],
          }),
        };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    stubFetchWithHistory(fetchMock);
    const members = [{ _id: "lead-1", member_name: "Ana", memberType: ["voz", "sunday_lead"] }];
    const { container } = render(<Gen members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Ana"));
    setMonthYear(container, 2, 2026);
    deselectAll(container, "saturday");
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    fireEvent.click(sw("Cuenta para equidad 2026-02-08"));

    fireEvent.click(screen.getByLabelText("Omitir 2026-02-08"));
    expect(sw("Cuenta para equidad 2026-02-08").getAttribute("aria-checked")).toBe("false");
    expect(sw("Cuenta para equidad 2026-02-08").disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Omitir 2026-02-08"));

    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/solve", expect.anything()));
    await waitFor(() => expect(container.querySelector('[data-row-id="lead"][data-date="2026-02-01"] [data-occupant]')).toBeTruthy());
    expect(sw("Cuenta para equidad 2026-02-08").getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    fireEvent.click(screen.getByRole("button", { name: /Volver de todos modos/ }));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    expect(sw("Cuenta para equidad 2026-02-08").getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    fireEvent.click(container.querySelector('[data-date="2026-02-08"]')!); // deselect
    fireEvent.click(container.querySelector('[data-date="2026-02-08"]')!); // select again
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    expect(sw("Cuenta para equidad 2026-02-08").getAttribute("aria-checked")).toBe("true");
  });

  it("a past month's create columns are disabled at the type default, and the bodies carry it", async () => {
    vi.setSystemTime(new Date("2026-03-10T18:00:00.000Z"));
    const bodies = stubCreates();
    const { container } = render(<Gen members={[]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    setMonthYear(container, 2, 2026);
    deselectAll(container, "saturday");
    fireEvent.click(container.querySelector('[data-date="2026-02-11"]')!);
    fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: "Vigilia" } });
    expect(sw("Cuenta para equidad").disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    const sunday = sw("Cuenta para equidad 2026-02-08");
    expect(sunday.disabled).toBe(true);
    expect(sunday.getAttribute("aria-checked")).toBe("true");
    expect(describedText(sunday)).toBe(FAIRNESS_PAST_REASON);
    expect(sw("Cuenta para equidad 2026-02-11 · Vigilia").getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /^Crear \d+ borrador/ }));
    await waitFor(() => expect(bodies).toHaveLength(5));
    for (const body of bodies) {
      expect(body.countsForFairness, String(body.date)).toBe(
        countsForFairnessDefault(body._type as "sunday_role" | "special_role"),
      );
    }
  });
});
```

The «Roles previos» case renders `MonthGenerator` exactly as `ServicesPanel` mounts it for «Editar mes» on a past month (`ServicesPanel.tsx:977-1000`: `mode="stored"`, `initialMonth={monthEditor.month}`); C1 changes nothing on that path but the Switch, so the planner-level render is the test of record (see the coverage table).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/MonthGenerator.fairness.test.tsx`
Expected: FAIL — no `switch` named «Cuenta para equidad 2026-02-01» (the grid gets no `fairness` prop yet) and none named «Cuenta para equidad» in «+ Nuevo servicio».

- [ ] **Step 3: Imports**

In `app/components/admin/MonthGenerator.tsx`, find:
```tsx
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
import { creatableTargets, type TargetPreflight } from "./serviceReadiness";
import PlannerGrid, { type AutoState, type SolveDiagnostics } from "./PlannerGrid";
```
Replace with:
```tsx
import { countsForFairness as readCountsForFairness, countsForFairnessDefault } from "@/app/utils/countsForFairness";
import { creatableTargets, serviceTodayIso, type TargetPreflight } from "./serviceReadiness";
import PlannerGrid, { type AutoState, type SolveDiagnostics, type StoredHeaderPatch } from "./PlannerGrid";
import { FairnessEngineNote, FairnessSwitch } from "./FairnessSwitch";
import {
  FAIRNESS_LABEL,
  FAIRNESS_SPECIAL_HELP,
  applyCreateCountsEdits,
  effectiveCreateCounts,
  effectiveStoredCounts,
  isPastServiceMonth,
  withoutCountsEdit,
} from "./fairnessToggleModel";
```

- [ ] **Step 4: State — create edits, stored overlay type, composer switch, attempt identity**

Find:
```tsx
  const [specials, setSpecials] = useState<{ date: string; name: string; countsForFairness: boolean }[]>([]);
```
Replace with:
```tsx
  const [specials, setSpecials] = useState<{ date: string; name: string; countsForFairness: boolean }[]>([]);
  /**
   * «Cuenta para equidad» edits on create-mode columns (solver v3 C1 §6.1), by
   * `columnId`. Held for as long as the column stays in the selection — across the
   * config and grid steps, an «Omitir» and any number of Auto runs (Auto never
   * touches it). Deselecting the weekend date or removing the special drops its
   * entry, so re-adding starts from the default (or the composer's choice); a month
   * change clears it with the other picks.
   */
  const [createCountsEdits, setCreateCountsEdits] = useState<Map<string, boolean>>(new Map());
```

Find:
```tsx
    setDeselectedSundays([]);
    setSpecials([]);
  }, [year, month]);
```
Replace with:
```tsx
    setDeselectedSundays([]);
    setSpecials([]);
    setCreateCountsEdits(new Map());
  }, [year, month]);
```

Find:
```tsx
  const [storedHeaderEdits, setStoredHeaderEdits] = useState<Map<string, { date?: string; serviceName?: string; time?: string }>>(new Map());
```
Replace with:
```tsx
  const [storedHeaderEdits, setStoredHeaderEdits] = useState<Map<string, StoredHeaderPatch>>(new Map());
```

Find:
```tsx
  const [createWorshipNight, setCreateWorshipNight] = useState(false);
```
Replace with:
```tsx
  const [createWorshipNight, setCreateWorshipNight] = useState(false);
  // «+ Nuevo servicio»'s «Cuenta para equidad» (C1 §6.5): follows the Tipo until touched.
  const [createCountsTouched, setCreateCountsTouched] = useState(false);
  const [createCountsChoice, setCreateCountsChoice] = useState(false);
```

Find:
```tsx
    target: { type: ServiceType; date: string; name: string | null; time: string | null; format: ServiceFormat | null };
```
Replace with:
```tsx
    target: {
      type: ServiceType;
      date: string;
      name: string | null;
      time: string | null;
      format: ServiceFormat | null;
      /** The effective «Cuenta para equidad» — part of the attempt identity (C1 §6.5). */
      countsForFairness: boolean;
    };
```

- [ ] **Step 5: Columns carry the effective value in both modes; the composer's value**

Find:
```tsx
  // D9's EXPLICIT column set — never inferred from `sundayDatesFull`.
  const createColumns = useMemo(
    () => buildColumns({ sundayDates: selectedSundays, activeSatDates, specials }),
    [selectedSundays, activeSatDates, specials],
  );
  const columns = storedMode
    ? storedTranslations.map((entry) => ({
        ...entry.column,
        ...(storedHeaderEdits.get(entry.column.roleId) ?? {}),
      }))
    : createColumns;
```
Replace with:
```tsx
  // C1 §6.0 — "today" in CDMX, read on every render; the memo below is keyed on it, so
  // the past-month rule is re-evaluated whenever the day changes, and again when a
  // body is built (`draftCreateBody`, `serializeStoredColumn`).
  const todayIso = serviceTodayIso();
  // D9's EXPLICIT column set — never inferred from `sundayDatesFull`. Each column
  // carries its EFFECTIVE «Cuenta para equidad» (C1 §6.1).
  const createColumns = useMemo(
    () => applyCreateCountsEdits(
      buildColumns({ sundayDates: selectedSundays, activeSatDates, specials }),
      createCountsEdits,
      todayIso,
    ),
    [selectedSundays, activeSatDates, specials, createCountsEdits, todayIso],
  );
  const columns = storedMode
    ? storedTranslations.map((entry) => {
        const edited: StoredGridColumn = { ...entry.column, ...(storedHeaderEdits.get(entry.column.roleId) ?? {}) };
        // C1 §6.0: while past, the stored value — a held toggle edit is neither shown nor sent.
        return { ...edited, countsForFairness: effectiveStoredCounts(edited, todayIso) };
      })
    : createColumns;
  /**
   * «+ Nuevo servicio»'s effective «Cuenta para equidad» (C1 §6.5): the Tipo's
   * default until the admin touches the Switch, then the admin's value until the
   * composer resets; the Tipo's default while the date is in a past month (§6.0).
   */
  const composerCounts = (today: string) =>
    effectiveCreateCounts(
      createType,
      createDate,
      createCountsTouched ? createCountsChoice : countsForFairnessDefault(createType),
      today,
    );
```

(The stored `baselineByRole` snapshots and every reload snapshot come from `serializeStoredColumn` on unedited translations, so their value is the stored one; the dirty check, `frozenSwapExpectation` and the save reconciliation need no change — they serialize the `columns` above.)

- [ ] **Step 6: A create verifies only with the requested value, and resets the switch**

Find:
```tsx
      && role.foh.length === 0,
    );
    if (!admittedEmpty) return;
    createAttempt.current = null;
    setCreateAttemptStatus(null);
    setComposerOpen(false);
    setCreateName("");
    setCreateTime("");
    setCreateWorshipNight(false);
```
Replace with:
```tsx
      && role.foh.length === 0
      // C1 §6.5: verified only with the requested «Cuenta para equidad» too.
      && readCountsForFairness({ _type: role._type, countsForFairness: role.countsForFairness })
        === attempt.target.countsForFairness,
    );
    if (!admittedEmpty) return;
    createAttempt.current = null;
    setCreateAttemptStatus(null);
    setComposerOpen(false);
    setCreateName("");
    setCreateTime("");
    setCreateWorshipNight(false);
    setCreateCountsTouched(false);
    setCreateCountsChoice(false);
```

- [ ] **Step 7: Header edits — stored overlay and create edits**

Find:
```tsx
  function handleStoredHeaderChange(columnId: string, patch: { date?: string; serviceName?: string; time?: string }) {
```
Replace with:
```tsx
  function handleStoredHeaderChange(columnId: string, patch: StoredHeaderPatch) {
```

(Its body is unchanged: it refuses only a *date* patch while `storedDateBlocked`, so the switch is not gated by the date-move block, and it marks the role touched.)

Find:
```tsx
  function handleRowsChange(next: GridRow[]) {
```
Replace with:
```tsx
  /**
   * «Cuenta para equidad» from a grid header (C1 §6.2, §6.4). Stored mode rides the
   * header overlay like Fecha/Nombre/Hora; create mode holds the edit per column and
   * re-derives the drafts from the columns it now produces.
   */
  function handleFairnessChange(columnId: string, next: boolean) {
    if (storedMode) {
      handleStoredHeaderChange(columnId, { countsForFairness: next });
      return;
    }
    if (pushing) return;
    const nextEdits = new Map(createCountsEdits).set(columnId, next);
    setCreateCountsEdits(nextEdits);
    const nextColumns = applyCreateCountsEdits(createColumns, nextEdits);
    setDrafts((prev) => cellsToDrafts(cells, nextColumns, skippedColumnIds, prev, existingRoles));
  }

  function handleRowsChange(next: GridRow[]) {
```

- [ ] **Step 8: «+ Nuevo servicio» sends the effective value and keys the attempt on it**

Find:
```tsx
    const createFormat = createType === "special_role" && createWorshipNight ? WORSHIP_NIGHT_FORMAT : null;
    const target = { type: createType, date: createDate, name: normalizedName, time: createTimeValue, format: createFormat };
```
Replace with:
```tsx
    const createFormat = createType === "special_role" && createWorshipNight ? WORSHIP_NIGHT_FORMAT : null;
    // C1 §6.5/§6.0: decided NOW — a tab left open across a month boundary cannot send
    // a value its month no longer allows — and part of the attempt identity.
    const createCounts = composerCounts(serviceTodayIso());
    const target = {
      type: createType,
      date: createDate,
      name: normalizedName,
      time: createTimeValue,
      format: createFormat,
      countsForFairness: createCounts,
    };
```

Find (the interim line from Task 9):
```tsx
      // Task 13 replaces this with the composer's effective value; until then the
      // type default keeps today's behaviour exactly.
      countsForFairness: countsForFairnessDefault(createType),
```
Replace with:
```tsx
      countsForFairness: createCounts,
```

(`payloadKey = JSON.stringify(target)` already exists below `target`: a different effective value is a different payload key, so a new creation request id — §6.5. The handler's try/catch/finally, `res.ok` handling and `creatingOne` flag are unchanged.)

- [ ] **Step 9: Calendar handlers drop a column's held edit when it leaves the selection**

Find:
```tsx
            setActiveSatDates(prev =>
              prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date],
            );
          }
        }}
        onAddSpecial={(date, name, countsForFairness) =>
          setSpecials(prev => [...prev.filter(s => s.date !== date), { date, name, countsForFairness }])}
        onRemoveSpecial={date => setSpecials(prev => prev.filter(s => s.date !== date))}
```
Replace with:
```tsx
            setActiveSatDates(prev =>
              prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date],
            );
          }
          // C1 §6.1: a date that leaves (or re-enters) the selection starts from its default.
          setCreateCountsEdits(prev =>
            withoutCountsEdit(prev, createColumnId(dow === 0 ? "sunday_role" : "saturday_role", date)),
          );
        }}
        onAddSpecial={(date, name, countsForFairness) => {
          setSpecials(prev => [...prev.filter(s => s.date !== date), { date, name, countsForFairness }]);
          // C1 §6.1: a (re-)added special starts from the composer's choice.
          setCreateCountsEdits(prev => withoutCountsEdit(prev, createColumnId("special_role", date)));
        }}
        onRemoveSpecial={date => {
          setSpecials(prev => prev.filter(s => s.date !== date));
          setCreateCountsEdits(prev => withoutCountsEdit(prev, createColumnId("special_role", date)));
        }}
```

(`createColumnId` is already imported from `./plannerModel`. «Omitir» does not touch the map — a skipped column keeps its value.)

- [ ] **Step 10: Give the grid the prop**

Find:
```tsx
          onStoredHeaderChange={handleStoredHeaderChange}
          storedDateBlockedReason={storedDateBlocked}
```
Replace with:
```tsx
          onStoredHeaderChange={handleStoredHeaderChange}
          fairness={{ onChange: handleFairnessChange, createInFlight: pushing }}
          storedDateBlockedReason={storedDateBlocked}
```

- [ ] **Step 11: The «+ Nuevo servicio» switch, its reset on «Cancelar», and its note**

Find (the composer's «Cancelar» button opening tag):
```tsx
                <button type="button" onClick={() => setComposerOpen(false)} disabled={creatingOne || createAttemptStatus !== null} className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest disabled:opacity-50">
```
Replace with:
```tsx
                <button
                  type="button"
                  onClick={() => {
                    setComposerOpen(false);
                    // C1 §6.5: «Cancelar» resets the switch to follow the Tipo again.
                    setCreateCountsTouched(false);
                    setCreateCountsChoice(false);
                  }}
                  disabled={creatingOne || createAttemptStatus !== null}
                  className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest disabled:opacity-50"
                >
```

Find:
```tsx
                {createAttemptStatus && (
                  <button type="button" onClick={() => void storedSource?.reload()} className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest text-accent">
                    Recargar
                  </button>
                )}
              </div>
            </div>
          )}
```
Replace with:
```tsx
                {createAttemptStatus && (
                  <button type="button" onClick={() => void storedSource?.reload()} className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest text-accent">
                    Recargar
                  </button>
                )}
              </div>
              {/* C1 §6.5: disabled with the other composer controls; the note once per composer. */}
              <div className="space-y-1 md:col-span-4" data-fairness-composer="">
                <FairnessSwitch
                  checked={composerCounts(todayIso)}
                  onChange={(next) => {
                    setCreateCountsTouched(true);
                    setCreateCountsChoice(next);
                  }}
                  disabled={storedMutationLocked}
                  past={isPastServiceMonth(createDate, todayIso)}
                  ariaLabel={FAIRNESS_LABEL}
                  help={createType === "special_role" ? FAIRNESS_SPECIAL_HELP : undefined}
                />
                <FairnessEngineNote />
              </div>
            </div>
          )}
```

(`storedMutationLocked` includes an unresolved create attempt, so the switch cannot change under a pending request.)

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/MonthGenerator.fairness.test.tsx app/components/admin`
Expected: PASS — the new suite (12 tests) and every existing admin suite (the stored suite's mocked `PlannerGrid` ignores the new prop).

- [ ] **Step 13: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 tsc errors; all green; eslint 0 errors, and `MonthGenerator.tsx` / `PlannerGrid.tsx` / `MonthCalendar.tsx` at their `origin/main` warning count (5 between them).

- [ ] **Step 14: Commit**

```bash
git add app/components/admin/MonthGenerator.tsx app/components/admin/__tests__/MonthGenerator.fairness.test.tsx
git commit -m "feat(planner): wire countsForFairness through MonthGenerator and «+ Nuevo servicio»" \
  -m "Solver v3 C1 §6.1, §6.4, §6.5. Create-mode header edits are held per column across steps, «Omitir» and Auto, and dropped when the date or special leaves the selection; stored edits ride the header overlay, so a toggle-only change is one dirty service. «+ Nuevo servicio» gets its own switch that follows the Tipo until touched, keys the creation request on the effective value and verifies a create only when the reload shows it. Every surface applies the past-month rule at render and again when the body is built."
```
