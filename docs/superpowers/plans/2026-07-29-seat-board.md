# A · Tablero (seat board) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the nested-scroll `ServiceForm` sheet with a two-pane seat board that shows the whole roster at once, carrying availability, existing assignment and recent load on every row.

**Architecture:** Two pure modules hold every decision (`seatModel` — canonical seat names and categories; `candidateRanking` — ordering and blocking). One client component (`SeatBoard`) renders what they return and decides nothing. `ServicesPanel` swaps `ServiceForm` for `SeatBoard` behind the same `onSubmit` payload, so no API, readiness, gating or publish code changes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind, vitest (node env; `@vitest-environment jsdom` + `@testing-library/react` for component tests), Sanity v5.

**Source spec:** [`docs/superpowers/specs/2026-07-29-service-team-editor-design.md`](../specs/2026-07-29-service-team-editor-design.md)

## Global Constraints

- Done gate for every task: `npx tsc --noEmit`, `npm test`, and `npx eslint .` with **0 errors** (warnings are a deliberate backlog).
- Spanish UI copy. The tag for "already in another seat on this service" is exactly **`Ya asignado`** — never "sentado".
- Double duty (spec D4): `voz` + `instrumento` is **allowed**; two seats in the same category is **blocked**.
- Seat names come from a canonical list; free-text entry is not reintroduced (spec D6).
- `SeatBoard` never calls the solver (spec D5). Ranking is a local pure sort.
- Dates render at local noon: `new Date(iso.slice(0,10) + "T12:00:00")`. Never bare `new Date(iso)`.
- Sanity array-of-object writes need a `_key` per item.
- Conventional commits; body explains the *why*. **Never** add AI/Claude attribution or `Co-Authored-By` trailers.
- Work on a branch; do not commit straight to `main`.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/normalize-instrument-names.mjs` | **Create.** One-off: collapse the 7 production spellings to 5 canonical names. Dry-run default, `--apply` guarded. |
| `app/components/admin/seatModel.ts` | **Create.** Canonical seat definitions, seat categories, `normalizeSeatName`. Pure, no React. |
| `app/components/admin/candidateRanking.ts` | **Create.** `rankCandidates` — ordering, availability, already-assigned, blocking. Pure, no React. |
| `app/components/admin/SeatBoard.tsx` | **Create.** Two-pane editor. Renders what the two pure modules return. |
| `app/utils/computeParticipation.ts` | **Modify.** Export the existing private `weekKey` as `serviceWeekKey` so the load strip reuses the Sat→Sun week rule instead of reimplementing it. |
| `app/components/admin/ServicesPanel.tsx` | **Modify.** Render `SeatBoard` in a `wide` modal instead of `ServiceForm`; delete `ServiceForm`, `MemberMultiSelect`, `SlotEditor`. |
| `docs/UTILITIES_AND_COMPONENTS.md` | **Modify.** Register the new modules. |

Tests live beside their subject: `app/components/admin/__tests__/seatModel.test.ts`, `candidateRanking.test.ts`, `SeatBoard.test.tsx`.

---

### Task 1: Normalise instrument names in production data

The canonical picklist inherits the mess unless this lands first (spec §8.1). Production holds `Drums`, `Drums ` (trailing space), `Bass`, `BASS`, `Keys`, `EG`, `AG` — 7 spellings of 5 instruments.

**Files:**
- Create: `scripts/normalize-instrument-names.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: clean `instruments[].instrument` values in Sanity. No code imports this.

- [ ] **Step 1: Write the script**

```javascript
// scripts/normalize-instrument-names.mjs
//
// One-off: collapse instrument-name spellings on role documents to a single
// canonical form. Production accumulated 7 spellings of 5 instruments because
// `SlotEditor` used a free-text input; the seat picklist replacing it must not
// inherit them.
//
//   node --env-file=.env.local scripts/normalize-instrument-names.mjs
//   node --env-file=.env.local scripts/normalize-instrument-names.mjs --apply
//
// Dry-run prints every change and writes nothing. `--apply` is required to write.
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  token: process.env.SANITY_API_WRITE_TOKEN,
  apiVersion: "2024-01-01",
  useCdn: false,
});

// Canonical spelling keyed by its lowercase, whitespace-collapsed form.
const CANONICAL = new Map([
  ["bass", "Bass"],
  ["keys", "Keys"],
  ["drums", "Drums"],
  ["eg", "EG"],
  ["ag", "AG"],
]);

const canonicalise = (raw) => {
  const key = String(raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return CANONICAL.get(key) ?? String(raw ?? "").trim().replace(/\s+/g, " ");
};

const roles = await client.fetch(
  `*[_type in ["sunday_role","saturday_role","special_role"] && defined(instruments)]{_id, _rev, instruments}`
);

let changed = 0;
for (const role of roles) {
  const patches = [];
  (role.instruments ?? []).forEach((slot, i) => {
    const next = canonicalise(slot?.instrument);
    if (next !== slot?.instrument) {
      patches.push({ i, from: slot?.instrument, to: next });
    }
  });
  if (patches.length === 0) continue;
  changed += patches.length;
  for (const p of patches) {
    console.log(`${role._id}  instruments[${p.i}]  ${JSON.stringify(p.from)} -> ${JSON.stringify(p.to)}`);
  }
  if (APPLY) {
    let tx = client.patch(role._id);
    for (const p of patches) tx = tx.set({ [`instruments[${p.i}].instrument`]: p.to });
    await tx.commit();
  }
}

console.log(`\n${changed} slot(s) ${APPLY ? "updated" : "would change"} across ${roles.length} role(s).`);
if (!changed) console.log("Nothing to do.");
else if (!APPLY) console.log("Dry run. Re-run with --apply to write.");
```

- [ ] **Step 2: Run the dry run and read every line**

```bash
node --env-file=.env.local scripts/normalize-instrument-names.mjs
```

Expected: a list of `… "Drums " -> "Drums"` and `… "BASS" -> "Bass"` lines, then `N slot(s) would change`, then `Dry run. Re-run with --apply to write.` **No document is written.**

- [ ] **Step 3: Get explicit consent, then apply**

Production Sanity writes need the user's explicit go-ahead. Show them the dry-run output and ask. Only after they agree:

```bash
node --env-file=.env.local scripts/normalize-instrument-names.mjs --apply
```

Expected: the same lines, then `N slot(s) updated`.

- [ ] **Step 4: Verify the spellings collapsed**

```bash
node --env-file=.env.local scripts/normalize-instrument-names.mjs
```

Expected: `0 slot(s) would change` and `Nothing to do.`

- [ ] **Step 5: Commit**

```bash
git add scripts/normalize-instrument-names.mjs
git commit -m "chore(data): collapse instrument-name spellings to a canonical set

SlotEditor's free-text input let 7 spellings of 5 instruments accumulate
(Drums, 'Drums ', Bass, BASS, Keys, EG, AG). The seat picklist that
replaces it reads its canonical list from this data, so the spellings are
normalised before it ships rather than inherited."
```

---

### Task 2: `seatModel` — canonical seats and categories

**Files:**
- Create: `app/components/admin/seatModel.ts`
- Test: `app/components/admin/__tests__/seatModel.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SeatCategory = "voz" | "instrumento" | "foh"`
  - `interface SeatDef { id: string; label: string; category: SeatCategory; max: number | null; memberType: string }`
  - `const VOICE_SEATS: SeatDef[]`
  - `const DEFAULT_INSTRUMENT_SEATS: string[]`, `const DEFAULT_FOH_SEATS: string[]`
  - `function normalizeSeatName(raw: unknown): string`
  - `function instrumentSeatDef(label: string): SeatDef`, `function fohSeatDef(label: string): SeatDef`

- [ ] **Step 1: Write the failing test**

```typescript
// app/components/admin/__tests__/seatModel.test.ts
//
// The seat vocabulary is a closed list with one spelling per seat. Free text is
// what produced 7 spellings of 5 instruments in production; these tests are the
// gate that keeps a second spelling from ever being created.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_FOH_SEATS,
  DEFAULT_INSTRUMENT_SEATS,
  VOICE_SEATS,
  fohSeatDef,
  instrumentSeatDef,
  normalizeSeatName,
} from "../seatModel";

describe("normalizeSeatName", () => {
  it("collapses every production spelling onto one canonical form", () => {
    expect(normalizeSeatName("Drums ")).toBe("Drums");
    expect(normalizeSeatName("BASS")).toBe("Bass");
    expect(normalizeSeatName("bass")).toBe("Bass");
    expect(normalizeSeatName("  eg ")).toBe("EG");
    expect(normalizeSeatName("Keys")).toBe("Keys");
  });

  it("trims and collapses whitespace in an unknown seat, keeping the admin's casing", () => {
    // A new seat is allowed; a second SPELLING of an existing one is not.
    expect(normalizeSeatName("  Violín   Eléctrico ")).toBe("Violín Eléctrico");
  });

  it("returns an empty string for junk input instead of throwing", () => {
    expect(normalizeSeatName(undefined)).toBe("");
    expect(normalizeSeatName(null)).toBe("");
    expect(normalizeSeatName("   ")).toBe("");
  });
});

describe("seat definitions", () => {
  it("gives the three voice seats the voz pool and no hard cap", () => {
    expect(VOICE_SEATS.map((s) => s.id)).toEqual(["lead", "bgv", "coro"]);
    for (const seat of VOICE_SEATS) {
      expect(seat.category).toBe("voz");
      expect(seat.memberType).toBe("voz");
      // Unbounded pending the soft maximum (spec §12 open item).
      expect(seat.max).toBeNull();
    }
  });

  it("makes an instrument seat single-occupant and instrumento-only", () => {
    const bass = instrumentSeatDef("BASS");
    expect(bass).toMatchObject({ label: "Bass", category: "instrumento", max: 1, memberType: "instrumento" });
    expect(bass.id).toBe("instrumento:Bass");
  });

  it("makes a FOH seat single-occupant and foh-only", () => {
    expect(fohSeatDef("Console")).toMatchObject({
      id: "foh:Console", label: "Console", category: "foh", max: 1, memberType: "foh",
    });
  });

  it("seeds the picklists from what production actually uses", () => {
    expect(DEFAULT_INSTRUMENT_SEATS).toEqual(["Bass", "Keys", "Drums", "EG", "AG"]);
    expect(DEFAULT_FOH_SEATS).toEqual(["Console"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/seatModel.test.ts`
Expected: FAIL — `Failed to resolve import "../seatModel"`.

- [ ] **Step 3: Write the implementation**

```typescript
// app/components/admin/seatModel.ts
//
// The seat vocabulary for a service, as data rather than free text.
//
// `SlotEditor` used a free-text <input> for the instrument name, which let 7
// spellings of 5 instruments accumulate in production. Every seat name now passes
// through `normalizeSeatName`, so a known seat has exactly one spelling and a NEW
// seat is still possible — the list is closed against duplicates, not against growth.

export type SeatCategory = "voz" | "instrumento" | "foh";

export interface SeatDef {
  /** Stable identity for React keys and assignment lookups. */
  id: string;
  /** Canonical Spanish/English label as stored and rendered. */
  label: string;
  category: SeatCategory;
  /** Maximum occupants; `null` = unbounded. */
  max: number | null;
  /** `memberType` a person must carry to be eligible for this seat. */
  memberType: string;
}

/**
 * The three voice seats. `max` is null pending the soft maximum the design left
 * open — an invented cap would silently block a legitimately large Coro.
 */
export const VOICE_SEATS: SeatDef[] = [
  { id: "lead", label: "Lead", category: "voz", max: null, memberType: "voz" },
  { id: "bgv", label: "BGV", category: "voz", max: null, memberType: "voz" },
  { id: "coro", label: "Coro", category: "voz", max: null, memberType: "voz" },
];

/** Seeded from the distinct values present in production after normalisation. */
export const DEFAULT_INSTRUMENT_SEATS = ["Bass", "Keys", "Drums", "EG", "AG"];
export const DEFAULT_FOH_SEATS = ["Console"];

/** Canonical spelling keyed by its lowercase, whitespace-collapsed form. */
const CANONICAL = new Map<string, string>([
  ["bass", "Bass"],
  ["keys", "Keys"],
  ["drums", "Drums"],
  ["eg", "EG"],
  ["ag", "AG"],
  ["console", "Console"],
]);

/**
 * One spelling per seat. A known seat maps to its canonical form regardless of
 * case or stray whitespace; an unknown one is trimmed and whitespace-collapsed
 * but keeps the admin's casing, so a genuinely new seat is not mangled.
 */
export function normalizeSeatName(raw: unknown): string {
  const trimmed = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return CANONICAL.get(trimmed.toLowerCase()) ?? trimmed;
}

export function instrumentSeatDef(label: string): SeatDef {
  const name = normalizeSeatName(label);
  return { id: `instrumento:${name}`, label: name, category: "instrumento", max: 1, memberType: "instrumento" };
}

export function fohSeatDef(label: string): SeatDef {
  const name = normalizeSeatName(label);
  return { id: `foh:${name}`, label: name, category: "foh", max: 1, memberType: "foh" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/components/admin/__tests__/seatModel.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Run the full gate**

```bash
npx tsc --noEmit && npm test && npx eslint .
```

Expected: tsc silent, all tests pass, eslint `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add app/components/admin/seatModel.ts app/components/admin/__tests__/seatModel.test.ts
git commit -m "feat(admin): add the canonical seat model

Seat names become data with one spelling each, replacing the free-text
instrument field that let 7 spellings of 5 instruments into production.
A new seat is still possible — the list is closed against duplicates, not
against growth.

Voice seats carry no maximum: the soft cap is an open question in the
design, and an invented number would silently block a large Coro."
```

---

### Task 3: `candidateRanking` — ordering, availability and the double-duty rule

**Files:**
- Modify: `app/utils/computeParticipation.ts` (export `weekKey` as `serviceWeekKey`)
- Create: `app/components/admin/candidateRanking.ts`
- Test: `app/components/admin/__tests__/candidateRanking.test.ts`

**Interfaces:**
- Consumes: `SeatDef`, `SeatCategory` (Task 2); `computeParticipation`, `ParticipantRole`, `serviceWeekKey` (existing util).
- Produces:
  - `interface RankMember { _id: string; member_name: string; alias?: string; memberType?: string[]; unavailableDates?: string[] }`
  - `interface AssignedSeat { seatId: string; category: SeatCategory; memberId: string }`
  - `interface RankedCandidate { id: string; name: string; available: boolean; alreadyAssigned: boolean; blockedReason: string | null; load: number; recent: boolean[] }`
  - `function rankCandidates(input: { seat: SeatDef; date: string; members: RankMember[]; windowRoles: ParticipantRole[]; assigned: AssignedSeat[]; weeks?: number }): RankedCandidate[]`

- [ ] **Step 1: Export the week key from the existing util**

In `app/utils/computeParticipation.ts`, the week rule (a Saturday counts toward the following Sunday's week) is currently private:

```typescript
const weekKey = (r: ParticipantRole) => (r._type === "saturday_role" ? plusOneDay(r.date) : r.date);
```

Replace that line with:

```typescript
/**
 * The week a service belongs to: a Saturday counts toward the FOLLOWING Sunday,
 * so a weekend is one week. Exported because the seat board's load strip must
 * group by the same rule — a second implementation would drift.
 */
export const serviceWeekKey = (r: ParticipantRole) =>
  r._type === "saturday_role" ? plusOneDay(r.date) : r.date;

const weekKey = serviceWeekKey;
```

- [ ] **Step 2: Write the failing test**

```typescript
// app/components/admin/__tests__/candidateRanking.test.ts
//
// The three signals the old form withheld until after save — availability,
// existing assignment, recent load — plus the one rule that must BLOCK rather
// than inform: the same person twice in one category.
import { describe, expect, it } from "vitest";

import { instrumentSeatDef, VOICE_SEATS } from "../seatModel";
import { rankCandidates, type AssignedSeat, type RankMember } from "../candidateRanking";
import type { ParticipantRole } from "@/app/utils/computeParticipation";

const LEAD = VOICE_SEATS[0];
const BGV = VOICE_SEATS[1];
const BASS = instrumentSeatDef("Bass");
const DATE = "2026-08-09";

const m = (id: string, name: string, types: string[], unavailable: string[] = []): RankMember =>
  ({ _id: id, member_name: name, memberType: types, unavailableDates: unavailable });

const MEMBERS: RankMember[] = [
  m("m1", "Frank", ["voz", "instrumento"]),
  m("m2", "Gaby", ["voz"]),
  m("m3", "Liu", ["voz"], [DATE]),
  m("m4", "Samo", ["instrumento"]),
  m("m5", "Nestor", []), // no memberType: eligible for nothing
];

const role = (over: Partial<ParticipantRole> = {}): ParticipantRole => ({
  _type: "sunday_role", date: "2026-08-02",
  leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over,
});

describe("rankCandidates", () => {
  it("admits only members carrying the seat's memberType", () => {
    const ids = rankCandidates({ seat: LEAD, date: DATE, members: MEMBERS, windowRoles: [], assigned: [] })
      .map((c) => c.id);
    expect(ids).toContain("m1");
    expect(ids).toContain("m2");
    expect(ids).not.toContain("m4"); // instrumento only
    expect(ids).not.toContain("m5"); // no memberType at all
  });

  it("marks the date's unavailable members without removing them", () => {
    const liu = rankCandidates({ seat: LEAD, date: DATE, members: MEMBERS, windowRoles: [], assigned: [] })
      .find((c) => c.id === "m3");
    // Still selectable: an admin may knowingly override. Never silent.
    expect(liu).toMatchObject({ available: false, blockedReason: null });
  });

  it("BLOCKS a second seat in the same category and says why", () => {
    const assigned: AssignedSeat[] = [{ seatId: "lead", category: "voz", memberId: "m1" }];
    const frank = rankCandidates({ seat: BGV, date: DATE, members: MEMBERS, windowRoles: [], assigned })
      .find((c) => c.id === "m1");
    expect(frank?.alreadyAssigned).toBe(true);
    expect(frank?.blockedReason).toBe("Ya asignado en Lead");
  });

  it("ALLOWS voz + instrumento and only informs", () => {
    // Frank leads and plays EG on real services; the board must not fight that.
    const assigned: AssignedSeat[] = [{ seatId: "lead", category: "voz", memberId: "m1" }];
    const frank = rankCandidates({ seat: BASS, date: DATE, members: MEMBERS, windowRoles: [], assigned })
      .find((c) => c.id === "m1");
    expect(frank).toMatchObject({ alreadyAssigned: true, blockedReason: null });
  });

  it("counts load and builds the strip on the same week rule as participation", () => {
    const windowRoles = [
      role({ date: "2026-07-19", leads: [{ _id: "m2" }] }),
      role({ date: "2026-08-02", leads: [{ _id: "m2" }] }),
      // A Saturday counts toward the FOLLOWING Sunday: same week as 2026-08-02.
      role({ _type: "saturday_role", date: "2026-08-01", bgvs: [{ _id: "m2" }] }),
    ];
    const gaby = rankCandidates({
      seat: LEAD, date: DATE, members: MEMBERS, windowRoles, assigned: [], weeks: 4,
    }).find((c) => c.id === "m2");
    expect(gaby?.load).toBe(3);
    expect(gaby?.recent).toHaveLength(4);
    expect(gaby?.recent.filter(Boolean).length).toBeGreaterThan(0);
  });

  it("orders available and unblocked first, then by lowest load, then by name", () => {
    const windowRoles = [
      role({ date: "2026-08-02", leads: [{ _id: "m2" }] }),
      role({ date: "2026-07-26", leads: [{ _id: "m2" }] }),
    ];
    const assigned: AssignedSeat[] = [{ seatId: "lead", category: "voz", memberId: "m1" }];
    const order = rankCandidates({ seat: BGV, date: DATE, members: MEMBERS, windowRoles, assigned })
      .map((c) => c.id);
    // m2 free with load 2 → first. m3 unavailable → after. m1 blocked → last.
    expect(order).toEqual(["m2", "m3", "m1"]);
  });

  it("returns an empty list rather than throwing on empty input", () => {
    expect(rankCandidates({ seat: LEAD, date: DATE, members: [], windowRoles: [], assigned: [] })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/candidateRanking.test.ts`
Expected: FAIL — `Failed to resolve import "../candidateRanking"`.

- [ ] **Step 4: Write the implementation**

```typescript
// app/components/admin/candidateRanking.ts
//
// Who should fill this seat, in order, with the three signals the old form
// withheld until after save: availability on the date, whether the person is
// already assigned on this service, and how much they have served recently.
//
// This is NOT the solver. `gcf/owt_solver_v2.py` handles five VOICE role types
// only and requires 3-6 weeks, so a single service is not a valid input to it
// (design D5). This is a pure sort over data the panel already holds — instant,
// no Cloud Run call, and it works for instruments and FOH, which the solver
// cannot express at all.

import {
  computeParticipation,
  serviceWeekKey,
  type ParticipantRole,
} from "@/app/utils/computeParticipation";
import type { SeatCategory, SeatDef } from "./seatModel";

export interface RankMember {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  unavailableDates?: string[];
}

/** A seat already occupied on the service being edited. */
export interface AssignedSeat {
  seatId: string;
  category: SeatCategory;
  memberId: string;
}

export interface RankedCandidate {
  id: string;
  name: string;
  /** False when the member marked this date unavailable. Still selectable. */
  available: boolean;
  /** True when the member holds another seat on this service. */
  alreadyAssigned: boolean;
  /** Non-null = may NOT be selected, with the Spanish reason. */
  blockedReason: string | null;
  /** Services in the window, on the participation week rule. */
  load: number;
  /** One cell per week, oldest first. */
  recent: boolean[];
}

const displayName = (m: RankMember) => m.alias?.trim() || m.member_name;

/** Every member id serving in this role, across all five seat paths. */
function servingIds(role: ParticipantRole): string[] {
  return [
    ...(role.leads ?? []).map((p) => p._id),
    ...(role.bgvs ?? []).map((p) => p._id),
    ...(role.chorus ?? []).map((p) => p._id),
    ...(role.instruments ?? []).filter((s) => s.person).map((s) => s.person!._id),
    ...(role.foh ?? []).filter((s) => s.person).map((s) => s.person!._id),
  ];
}

export function rankCandidates(input: {
  seat: SeatDef;
  date: string;
  members: RankMember[];
  windowRoles: ParticipantRole[];
  assigned: AssignedSeat[];
  weeks?: number;
}): RankedCandidate[] {
  const { seat, date, members, windowRoles, assigned } = input;
  const weeks = input.weeks ?? 4;

  // Load comes from the shipped counter so the week rule (Saturday counts toward
  // the following Sunday) cannot drift between this and the participation sidebar.
  const loadById = new Map(computeParticipation(windowRoles).map((p) => [p.id, p.total]));

  // The most recent `weeks` week-keys present in the window, oldest first.
  const weekKeys = [...new Set(windowRoles.map(serviceWeekKey))].sort().slice(-weeks);
  const servedInWeek = new Map<string, Set<string>>();
  for (const role of windowRoles) {
    const key = serviceWeekKey(role);
    let set = servedInWeek.get(key);
    if (!set) servedInWeek.set(key, (set = new Set()));
    for (const id of servingIds(role)) set.add(id);
  }

  const seatById = new Map(assigned.map((a) => [a.memberId, a]));

  const rows: RankedCandidate[] = (members ?? [])
    .filter((m) => (m.memberType ?? []).includes(seat.memberType))
    .map((m) => {
      const held = seatById.get(m._id);
      // D4: same category is a real conflict (nobody sings Lead and BGV at once);
      // voz + instrumento is what Frank and Mkz actually do, so it only informs.
      const blockedReason =
        held && held.category === seat.category && held.seatId !== seat.id
          ? `Ya asignado en ${labelOfSeatId(held.seatId)}`
          : null;
      const strip = weekKeys.map((k) => servedInWeek.get(k)?.has(m._id) ?? false);
      // Pad on the left so every strip is the same width regardless of history.
      const recent = [...Array(Math.max(0, weeks - strip.length)).fill(false), ...strip];
      return {
        id: m._id,
        name: displayName(m),
        available: !(m.unavailableDates ?? []).includes(date),
        alreadyAssigned: !!held && held.seatId !== seat.id,
        blockedReason,
        load: loadById.get(m._id) ?? 0,
        recent,
      };
    });

  const rank = (c: RankedCandidate) =>
    (c.blockedReason ? 100 : 0) + (c.available ? 0 : 10) + (c.alreadyAssigned ? 1 : 0);

  return rows.sort(
    (a, b) => rank(a) - rank(b) || a.load - b.load || a.name.localeCompare(b.name, "es"),
  );
}

/** `lead` -> `Lead`, `instrumento:Bass` -> `Bass`. */
function labelOfSeatId(seatId: string): string {
  const tail = seatId.includes(":") ? seatId.slice(seatId.indexOf(":") + 1) : seatId;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/components/admin/__tests__/candidateRanking.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Run the full gate**

```bash
npx tsc --noEmit && npm test && npx eslint .
```

Expected: tsc silent, all tests pass (including the existing `computeParticipation` suite, which the export must not disturb), eslint `0 errors`.

- [ ] **Step 7: Commit**

```bash
git add app/utils/computeParticipation.ts app/components/admin/candidateRanking.ts app/components/admin/__tests__/candidateRanking.test.ts
git commit -m "feat(admin): rank seat candidates by availability, assignment and load

The old form withheld all three signals until after save: a conflict
appeared as a blocking panel, nothing flagged a person already assigned
elsewhere on the service, and recent load was invisible. This computes them
up front as a pure sort.

Deliberately not the solver: owt_solver_v2 handles five voice role types
and needs 3-6 weeks, so one service is not a valid input to it, and it has
no concept of instruments or FOH. A local sort covers all three categories
instantly and with no Cloud Run call.

Same-category double booking blocks with a reason; voz + instrumento only
informs, because Frank and Mkz really do lead and play on one service.

Load reuses computeParticipation rather than recounting, and its week rule
is now exported so the strip groups weekends identically."
```

---

### Task 4: `SeatBoard` — the two-pane editor

**Files:**
- Create: `app/components/admin/SeatBoard.tsx`
- Test: `app/components/admin/__tests__/SeatBoard.test.tsx`

**Interfaces:**
- Consumes: `VOICE_SEATS`, `DEFAULT_INSTRUMENT_SEATS`, `DEFAULT_FOH_SEATS`, `instrumentSeatDef`, `fohSeatDef`, `normalizeSeatName`, `SeatDef` (Task 2); `rankCandidates`, `RankMember`, `AssignedSeat`, `RankedCandidate` (Task 3).
- Produces: `default function SeatBoard(props: SeatBoardProps)` where

```typescript
export interface SeatBoardProps {
  initial?: ServiceRole;
  members: RankMember[];
  /** Recent roles, for the load strip. */
  windowRoles: ParticipantRole[];
  onSubmit: (data: unknown) => void;
  onClose: () => void;
  loading: boolean;
  dateLockedReason?: string | null;
  submitBlockedReason?: string | null;
}
```

The `onSubmit` payload is byte-identical to `ServiceForm`'s, so `handleAdd`/`handleEdit` need no change:
`{ _type, date, service_name, leads: string[], bgvs: string[], chorus: string[], instruments: {instrument, personId}[], foh: {role, personId}[], published? }`

- [ ] **Step 1: Write the failing test**

```typescript
/** @vitest-environment jsdom */
// The board's whole reason for existing is that the roster is visible and honest.
// These pin the three things the old sheet could not do: show the entire pool at
// once, mark unavailability and existing assignment before the save, and refuse a
// same-category double booking.
import { fireEvent, render, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SeatBoard from "../SeatBoard";

afterEach(() => cleanup());

const members = [
  { _id: "m1", member_name: "Frank", memberType: ["voz", "instrumento"] },
  { _id: "m2", member_name: "Gaby", memberType: ["voz"] },
  { _id: "m3", member_name: "Liu", memberType: ["voz"], unavailableDates: ["2026-08-09"] },
  { _id: "m4", member_name: "Samo", memberType: ["instrumento"] },
];

const base = {
  members,
  windowRoles: [],
  onSubmit: vi.fn(),
  onClose: vi.fn(),
  loading: false,
};

describe("SeatBoard", () => {
  it("shows the whole eligible pool at once, not a 4-row window", () => {
    render(<SeatBoard {...base} />);
    // All three voz members are in the document simultaneously.
    expect(screen.getByText("Frank")).toBeTruthy();
    expect(screen.getByText("Gaby")).toBeTruthy();
    expect(screen.getByText("Liu")).toBeTruthy();
  });

  it("marks an unavailable member before anything is saved", () => {
    render(<SeatBoard {...base} initial={{ _type: "sunday_role", date: "2026-08-09" } as never} />);
    expect(screen.getByText(/no disp/i)).toBeTruthy();
  });

  it("seats a person into the targeted seat on click", () => {
    render(<SeatBoard {...base} />);
    fireEvent.click(screen.getByText("Gaby"));
    // The chip for the seated person appears in the seat pane.
    expect(screen.getAllByText("Gaby").length).toBeGreaterThan(1);
  });

  it("uses «Ya asignado», never «sentado»", () => {
    const { container } = render(<SeatBoard {...base} />);
    fireEvent.click(screen.getByText("Frank"));
    expect(container.textContent?.toLowerCase()).not.toContain("sentad");
  });

  it("submits the same payload shape the API already accepts", () => {
    const onSubmit = vi.fn();
    render(<SeatBoard {...base} onSubmit={onSubmit} initial={{ _type: "sunday_role", date: "2026-08-09" } as never} />);
    fireEvent.click(screen.getByText("Gaby"));
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({ _type: "sunday_role", date: "2026-08-09", leads: ["m2"] });
    expect(Array.isArray(payload.instruments)).toBe(true);
    expect(Array.isArray(payload.foh)).toBe(true);
  });

  it("disables save while a submit block is in force, and shows the reason", () => {
    render(<SeatBoard {...base} submitBlockedReason="Datos incompletos." />);
    const save = screen.getByRole("button", { name: /guardar|crear/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("Datos incompletos.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/SeatBoard.test.tsx`
Expected: FAIL — `Failed to resolve import "../SeatBoard"`.

- [ ] **Step 3: Confirm the DOM test deps are present**

```bash
node -e "require.resolve('@testing-library/react'); console.log('ok')"
```

Expected: `ok`. If it throws, install first: `npm i -D @testing-library/react jsdom` (`MemberForm.test.tsx` already relies on both, so it should resolve).

- [ ] **Step 4: Write the implementation**

Build `SeatBoard.tsx` as a client component with this structure. It decides nothing — every ordering and blocking judgement comes from `rankCandidates`.

```tsx
"use client";

// The service team editor: seats left, the WHOLE eligible roster right, one
// scroll region between them.
//
// It replaces a sheet that stacked five nested scrollers and showed 4 of 16
// voices three times over. Nothing here ranks or blocks on its own — the seat
// vocabulary comes from `seatModel` and the ordering, availability, existing
// assignment and load all come from `rankCandidates`, so both are table-tested
// without a DOM.

import { useMemo, useState } from "react";

import {
  DEFAULT_FOH_SEATS,
  DEFAULT_INSTRUMENT_SEATS,
  VOICE_SEATS,
  fohSeatDef,
  instrumentSeatDef,
  type SeatDef,
} from "./seatModel";
import { rankCandidates, type AssignedSeat, type RankMember } from "./candidateRanking";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import type { ServiceRole } from "./serviceCardModel";

export interface SeatBoardProps {
  initial?: ServiceRole;
  members: RankMember[];
  windowRoles: ParticipantRole[];
  onSubmit: (data: unknown) => void;
  onClose: () => void;
  loading: boolean;
  dateLockedReason?: string | null;
  submitBlockedReason?: string | null;
}

export default function SeatBoard(props: SeatBoardProps) {
  const { initial, members, windowRoles, loading } = props;

  const [type, setType] = useState(initial?._type ?? "sunday_role");
  const [date, setDate] = useState(initial?.date?.slice(0, 10) ?? "");
  const [serviceName, setServiceName] = useState(initial?.service_name ?? "");

  // occupancy: seatId -> memberId[]
  const [occupancy, setOccupancy] = useState<Record<string, string[]>>(() =>
    seedOccupancy(initial),
  );
  const [instrumentSeats, setInstrumentSeats] = useState<string[]>(() =>
    seedSeatNames(initial?.instruments?.map((s) => s.instrument), DEFAULT_INSTRUMENT_SEATS),
  );
  const [fohSeats, setFohSeats] = useState<string[]>(() =>
    seedSeatNames(initial?.foh?.map((s) => s.role), DEFAULT_FOH_SEATS),
  );

  const seats: SeatDef[] = useMemo(
    () => [
      ...VOICE_SEATS,
      ...instrumentSeats.map(instrumentSeatDef),
      ...fohSeats.map(fohSeatDef),
    ],
    [instrumentSeats, fohSeats],
  );

  const [targetId, setTargetId] = useState(VOICE_SEATS[0].id);
  const target = seats.find((s) => s.id === targetId) ?? seats[0];

  const assigned: AssignedSeat[] = useMemo(
    () =>
      seats.flatMap((seat) =>
        (occupancy[seat.id] ?? []).map((memberId) => ({
          seatId: seat.id,
          category: seat.category,
          memberId,
        })),
      ),
    [seats, occupancy],
  );

  const candidates = useMemo(
    () => rankCandidates({ seat: target, date, members, windowRoles, assigned }),
    [target, date, members, windowRoles, assigned],
  );

  function toggle(memberId: string) {
    const current = occupancy[target.id] ?? [];
    const blocked = candidates.find((c) => c.id === memberId)?.blockedReason;
    if (blocked && !current.includes(memberId)) return; // refuse a same-category double
    const next = current.includes(memberId)
      ? current.filter((x) => x !== memberId)
      : target.max !== null && current.length >= target.max
        ? [...current.slice(1), memberId] // single-occupant seats replace
        : [...current, memberId];
    setOccupancy({ ...occupancy, [target.id]: next });
  }

  function buildData(published?: boolean) {
    const base = {
      _type: type,
      date,
      service_name: serviceName,
      leads: occupancy["lead"] ?? [],
      bgvs: occupancy["bgv"] ?? [],
      chorus: occupancy["coro"] ?? [],
      instruments: instrumentSeats.flatMap((label) => {
        const def = instrumentSeatDef(label);
        return (occupancy[def.id] ?? []).map((personId) => ({ instrument: def.label, personId }));
      }),
      foh: fohSeats.flatMap((label) => {
        const def = fohSeatDef(label);
        return (occupancy[def.id] ?? []).map((personId) => ({ role: def.label, personId }));
      }),
    };
    return !initial && published !== undefined ? { ...base, published } : base;
  }

  // ... render: header (tipo/fecha/nombre), left seat pane, right roster pane,
  // sticky footer with Cancelar + (Crear / Crear y publicar) or Guardar.
  // Every button carries `disabled={loading || !!props.submitBlockedReason}` and
  // `title={props.submitBlockedReason ?? undefined}`.
}

/** Existing assignments -> seatId -> memberId[]. */
function seedOccupancy(initial?: ServiceRole): Record<string, string[]> {
  if (!initial) return {};
  const out: Record<string, string[]> = {
    lead: (initial.leads ?? []).map((m) => m._id),
    bgv: (initial.bgvs ?? []).map((m) => m._id),
    coro: (initial.chorus ?? []).map((m) => m._id),
  };
  for (const slot of initial.instruments ?? []) {
    if (!slot.person) continue;
    const def = instrumentSeatDef(slot.instrument);
    out[def.id] = [...(out[def.id] ?? []), slot.person._id];
  }
  for (const slot of initial.foh ?? []) {
    if (!slot.person) continue;
    const def = fohSeatDef(slot.role);
    out[def.id] = [...(out[def.id] ?? []), slot.person._id];
  }
  return out;
}

/** The service's own seat names, normalised, unioned with the defaults. */
function seedSeatNames(existing: (string | undefined)[] | undefined, defaults: string[]): string[] {
  const names = (existing ?? []).map((n) => instrumentSeatDef(n ?? "").label).filter(Boolean);
  return [...new Set([...defaults, ...names])];
}
```

Render requirements for the JSX (all asserted by Step 1's tests):

- Roster rows render the member's display name as text, an `available === false` badge reading `No disp.`, an `alreadyAssigned` badge reading exactly `Ya asignado`, the four-cell load strip, and the load count.
- A row with `blockedReason` renders `aria-disabled="true"`, `title={blockedReason}`, and ignores clicks.
- The roster list is the **only** element with `overflow-y-auto`. The seat pane must not scroll.
- Seat chips carry a `×` control clearing that occupant.
- Footer buttons: `Cancelar`; on create `Crear` and `Crear y publicar`; on edit `Guardar`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/components/admin/__tests__/SeatBoard.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 6: Run the full gate**

```bash
npx tsc --noEmit && npm test && npx eslint .
```

Expected: tsc silent, all pass, eslint `0 errors`.

- [ ] **Step 7: Commit**

```bash
git add app/components/admin/SeatBoard.tsx app/components/admin/__tests__/SeatBoard.test.tsx
git commit -m "feat(admin): add the seat board editor

Seats on the left, the whole eligible roster on the right, one scroll
region between them — against a sheet that nested five and showed 4 of 16
voices three separate times.

The component decides nothing: seat names come from seatModel and every
ordering, availability, assignment and load judgement from rankCandidates,
so the logic stays table-testable without a DOM.

The submit payload is byte-identical to ServiceForm's, so the existing
create and edit handlers are untouched."
```

---

### Task 5: Render `SeatBoard` in the panel and retire `ServiceForm`

**Files:**
- Modify: `app/components/admin/ServicesPanel.tsx` (modal render ~1693–1705; delete `MemberMultiSelect` 167–203, `SlotEditor` 207–245, `ServiceForm` 249–410, and the now-unused `InstrumentSlot`/`FohSlot` at 93–94)
- Modify: `docs/UTILITIES_AND_COMPONENTS.md`

**Interfaces:**
- Consumes: `SeatBoard` (Task 4).
- Produces: nothing new.

- [ ] **Step 1: Swap the two modal call sites**

Both modals become `wide` — the board is two-pane and cannot work in the `sm` sheet. Replace the `add` case:

```tsx
{editModal?.type === "add" && (
  <Modal title="Nuevo servicio" wide onClose={closeEditModal} status={editError}>
    <SeatBoard members={members} windowRoles={roles} onSubmit={handleAdd}
      onClose={closeEditModal} loading={submitting}
      submitBlockedReason={createGate.reason} />
  </Modal>
)}
```

and the `edit` case:

```tsx
{editModal?.type === "edit" && (
  <Modal title="Editar servicio" wide onClose={closeEditModal} status={editError ?? staleModes.edit?.message}>
    <SeatBoard initial={editModal.role} members={members} windowRoles={roles}
      onSubmit={handleEdit} onClose={closeEditModal} loading={submitting}
      dateLockedReason={gate("changeServiceDate").reason}
      submitBlockedReason={staleModes.edit?.message ?? cardGates.editTeam.reason} />
    {/* keep the existing staleModes.edit retry button below, unchanged */}
```

Add the import beside the other admin components:

```tsx
import SeatBoard from "./SeatBoard";
```

- [ ] **Step 2: Verify the swap compiles and nothing else broke**

```bash
npx tsc --noEmit && npm test
```

Expected: tsc silent; all tests pass. `ServiceForm` is now unreferenced but still present, so eslint may warn — that is expected until Step 3.

- [ ] **Step 3: Delete the dead components**

Remove from `ServicesPanel.tsx`, in this order (later line numbers first so earlier ones do not shift):
1. `ServiceForm` (was 249–410)
2. `SlotEditor` (was 207–245)
3. `MemberMultiSelect` (was 167–203)
4. `interface InstrumentSlot` and `interface FohSlot` (was 93–94)

Then check nothing else referenced them:

```bash
grep -n "ServiceForm\|MemberMultiSelect\|SlotEditor\|InstrumentSlot\|FohSlot" app/components/admin/ServicesPanel.tsx
```

Expected: no output.

- [ ] **Step 4: Update the component docs**

In `docs/UTILITIES_AND_COMPONENTS.md`, in the admin components table, remove any `ServiceForm` row and add:

```markdown
| `SeatBoard` | The service team editor: seats + full roster, one scroll region. Decides nothing — see `seatModel` / `candidateRanking`. |
| `seatModel` | Canonical seat names and categories; one spelling per seat. Pure. |
| `candidateRanking` | Seat candidates ordered by availability, existing assignment and recent load. Pure; never calls the solver. |
```

- [ ] **Step 5: Run the full gate**

```bash
npx tsc --noEmit && npm test && npx eslint .
```

Expected: tsc silent, all tests pass, eslint `0 errors`.

- [ ] **Step 6: Verify in the browser**

`/admin` requires a login the agent cannot perform. Either ask the user to open the Servicios tab and click **Nuevo servicio** and **Editar equipo**, or mount `SeatBoard` in a temporary page under `app/(client)/auth/` (that prefix is excluded from the `proxy.ts` matcher, so it renders without a session) and screenshot it.

**Delete any temporary page before committing.** `app/(client)/auth/` also holds the real `signin` and `not-a-member` pages — remove only the exact directory that was added.

Confirm: the roster shows every eligible member with no inner scrollbar; an unavailable member is badged; a same-category double is refused with its reason; save produces the same result as before.

- [ ] **Step 7: Commit**

```bash
git add app/components/admin/ServicesPanel.tsx docs/UTILITIES_AND_COMPONENTS.md
git commit -m "feat(admin): use the seat board for create and edit, drop ServiceForm

Both service modals render SeatBoard in a wide dialog. ServiceForm,
MemberMultiSelect and SlotEditor are deleted with it — together they were
the five nested scroll regions, the 4-of-16 roster window and the free-text
instrument field.

The submit payload is unchanged, so handleAdd, handleEdit, the capability
gates, the stale-snapshot guard and the publish flow are all untouched."
```

---

## Self-Review

**Spec coverage.** §4 Tablero → Tasks 2–5. §4 seat model / D6 → Tasks 1–2. §5 Planificador → out of scope (Plan 2). §6 shared modules → Tasks 2–4, including the `computeParticipation` reuse. §7 invariants → global constraints + Task 5 (payload unchanged, so the five seat paths, `_key` handling and `revalidate*` stay in the untouched route code). §8.1 instrument spellings → Task 1. §8.2 members with no `memberType` → **not a code task**; `candidateRanking` correctly excludes them (asserted in Task 3 Step 2) and the roster decision stays with the user. §10 testing → each task's test step.

**Placeholders.** The one deliberate ellipsis is Task 4 Step 4's JSX body, which is specified immediately after as an explicit bulleted contract and fully asserted by Step 1's tests.

**Type consistency.** `SeatDef`, `SeatCategory`, `RankMember`, `AssignedSeat`, `RankedCandidate` and `rankCandidates` keep one signature from Task 2 through Task 5. `serviceWeekKey` is exported in Task 3 Step 1 before Step 4 imports it. `instrumentSeatDef` / `fohSeatDef` produce the `instrumento:Bass` / `foh:Console` id form that `labelOfSeatId` parses and `seedOccupancy` rebuilds.

**Open item carried forward.** `SeatDef.max` is `null` for voice seats pending the soft maximum (spec §12). Single-occupant instrument and FOH seats are unaffected.
