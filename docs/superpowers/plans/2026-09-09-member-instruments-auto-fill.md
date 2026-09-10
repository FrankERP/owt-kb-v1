# Declared Instruments + Automatic Instrument Fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each `instrumento` member declares the instruments they play; «Generar mes» then fills every empty instrument seat with a declared, available player, balancing each person's instrument seats within the month (max difference 1) and alternating players across services.

**Architecture:** A new optional `instruments: string[]` field on `teamMembers` (closed to the existing seat vocabulary), read by `rankCandidates` as an `undeclared` flag. A pure client-side filler (`instrumentFill.ts`, sibling of `localFill.ts`) runs inside `applySpecialFill` on every exit of `handleAuto`, seats only empty `instrumento:` cells through `rankCandidates`, and reports what it could not seat through the existing `unfilled` channel. A one-off, dry-run-first script derives the initial declarations from role history. The CP-SAT solver is not touched.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Sanity v5 (`next-sanity`), vitest (+ jsdom + Testing Library for wiring tests), Node 22 `.mjs` scripts.

**Spec:** `docs/superpowers/specs/2026-09-09-member-instruments-auto-fill-design.md` (adversarial review APPROVED on digest `d4a0fe34…`, round 4; §12 lists un-reviewed post-approval items, all included below). Review log beside it.

## Global Constraints

- Spanish-language UI; every user-facing string in this plan is final copy.
- Gates before "done": `npx tsc --noEmit`, `npm test` (vitest), `npx eslint .` with **0 errors**.
- Instrument vocabulary is `DEFAULT_INSTRUMENT_SEATS = ["Bass", "Keys", "Drums", "EG", "AG"]` (`app/components/admin/seatModel.ts:35`). "Known" = membership in that list after `normalizeSeatName`. Custom planner rows are outside it: never filled, never warned about.
- Storage contract (D6): absent or `[]` `instruments` = "declares nothing". The filler never seats such a member; the manual picker still lists them, sorted after declared candidates, never blocked.
- Fairness (D2, confirmed by Frank 2026-09-09 14:42 CST): per SERVICE, in-month only, **per-member total across instrument rows** — not per instrument.
- Origin rule: only cells with `cell.origin === "auto"` on `instrumento:` rows of weekend columns are vacated before a fill; every human path stamps `"manual"`.
- The filler never re-implements eligibility: the pool is `rankCandidates(...)` re-run per placement, filtered on `eligible && !undeclared`.
- Never add AI/Claude attribution or `Co-Authored-By` trailers to commits. Conventional commits (`feat(scope): …`), body explains the why.
- Production Sanity writes (the backfill `--apply`) need Frank's explicit consent on the dry-run output. Diagnosing ≠ consent.
- Sanity array-of-object writes need a `_key` per item (not exercised here: `instruments` on `teamMembers` is an array of strings; role seat `_key`s are minted by the existing create path).
- No new secret or env var; nothing to add to `docs/SECRETS.md`.
- Work on this branch (`claude/solver-auto-fill-pianos-drums-7c9bd0`); merge order `preview` first, then PR to `main`.

---

## File map

| File | Responsibility |
|---|---|
| `sanity/schemas/instrumentSeats.ts` (new) | The Studio option list for member instruments; imports nothing. |
| `sanity/schemas/worshipTeam.ts` | `instruments` field, hidden unless Tipo has `instrumento`. |
| `app/components/admin/seatModel.ts` | `isKnownInstrument(label)`, `occupantDeclaresInstrument(member, label)`. |
| `app/components/admin/candidateRanking.ts` | `RankMember.instruments?`, `RankedCandidate.undeclared`, sort key, comment amendment. |
| `app/components/admin/serviceCardModel.ts` | `MemberOption.instruments?`. |
| `app/api/admin/members/route.ts`, `app/api/admin/members/[id]/route.ts` | Accept/validate `instruments`; GET projects it. |
| `app/components/admin/AdminPanel.tsx` | `Member.instruments?`, `MemberFormData.instruments?`, «Instrumentos» grid (touched-field), create/edit handlers, list chips. |
| `app/components/admin/instrumentFill.ts` (new) | `fillInstruments(input)` and `renderableUnfilled(unfilled, cells)` — pure. |
| `app/components/admin/localFill.ts` | Export `withAutoCell` (reused, unchanged). |
| `app/components/admin/MonthGenerator.tsx` | Run the filler inside `applySpecialFill`; failure-exit filter drops `instrumento:` entries. |
| `app/components/admin/PlannerGrid.tsx` | «Sin declarar» chip in the picker; second amber line on instrument cells; scoped emptiness gate for markers and count. |
| `scripts/lib/memberInstruments.mjs` (new) | Pure grouping/normalization for the backfill. |
| `scripts/backfill-member-instruments.mjs` (new) | Dry-run-first, `--apply`, backup, `setIfMissing` + `ifRevisionId`. |
| `docs/DATA_MODEL.md`, `docs/SOLVER_AND_INFRA.md`, `docs/adr/0029-…md` | Field contract, filler section, script catalog, ADR refinement paragraph. |

---

### Task 1: Seat-model predicates and the Studio vocabulary

**Files:**
- Create: `sanity/schemas/instrumentSeats.ts`
- Modify: `sanity/schemas/worshipTeam.ts:161-178` (add the field after `memberType`)
- Modify: `app/components/admin/seatModel.ts` (append two functions)
- Test: `app/components/admin/__tests__/seatModel.test.ts`

**Interfaces:**
- Produces: `isKnownInstrument(label: unknown): boolean` — true iff `normalizeSeatName(label)` is in `DEFAULT_INSTRUMENT_SEATS`.
- Produces: `occupantDeclaresInstrument(member: { memberType?: string[]; instruments?: string[] } | undefined, label: string): boolean` — `memberType ∋ "instrumento" ∧ instruments ∋ normalizeSeatName(label)`.
- Produces: `INSTRUMENT_SEAT_OPTIONS: readonly string[]` from `sanity/schemas/instrumentSeats.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `app/components/admin/__tests__/seatModel.test.ts` (add `isKnownInstrument`, `occupantDeclaresInstrument` to the existing import from `../seatModel`, and `import { INSTRUMENT_SEAT_OPTIONS } from "@/sanity/schemas/instrumentSeats";`):

```ts
describe("isKnownInstrument", () => {
  it("accepts every default seat in any spelling normalizeSeatName collapses", () => {
    for (const s of DEFAULT_INSTRUMENT_SEATS) expect(isKnownInstrument(s)).toBe(true);
    expect(isKnownInstrument(" drums ")).toBe(true);
    expect(isKnownInstrument("KEYS")).toBe(true);
  });
  it("rejects FOH seats and free text — normalizeSeatName alone is not the test", () => {
    // `console` canonicalizes to `Console`, which is a FOH seat, not an instrument.
    expect(isKnownInstrument("console")).toBe(false);
    expect(isKnownInstrument("Piano")).toBe(false);
    expect(isKnownInstrument("")).toBe(false);
    expect(isKnownInstrument(undefined)).toBe(false);
  });
});

describe("occupantDeclaresInstrument", () => {
  it("needs BOTH the instrumento Tipo and the label", () => {
    expect(occupantDeclaresInstrument({ memberType: ["instrumento"], instruments: ["Keys"] }, "Keys")).toBe(true);
    expect(occupantDeclaresInstrument({ memberType: ["instrumento"], instruments: ["Keys"] }, "keys")).toBe(true);
    // Leftover declaration on a member whose Tipo was cleared declares nothing.
    expect(occupantDeclaresInstrument({ memberType: [], instruments: ["Keys"] }, "Keys")).toBe(false);
    expect(occupantDeclaresInstrument({ memberType: ["instrumento"], instruments: [] }, "Keys")).toBe(false);
    expect(occupantDeclaresInstrument({ memberType: ["instrumento"] }, "Keys")).toBe(false);
    expect(occupantDeclaresInstrument(undefined, "Keys")).toBe(false);
  });
});

describe("the Studio option list", () => {
  it("is exactly the seat vocabulary, so a member can only ever declare a seat that exists", () => {
    expect([...INSTRUMENT_SEAT_OPTIONS]).toEqual(DEFAULT_INSTRUMENT_SEATS);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/seatModel.test.ts`
Expected: FAIL — `isKnownInstrument` is not exported; module `@/sanity/schemas/instrumentSeats` not found.

- [ ] **Step 3: Create the option-list module**

`sanity/schemas/instrumentSeats.ts`:

```ts
// The Studio option list for `teamMembers.instruments`.
//
// Deliberately a module with NO imports: `sanity/schemas/*` never imports from
// `app/`, and `seatModel.test.ts` imports this constant to assert it equals
// `DEFAULT_INSTRUMENT_SEATS` (`app/components/admin/seatModel.ts`) — the two
// vocabularies must not drift, and a test is what holds them together.
export const INSTRUMENT_SEAT_OPTIONS = ["Bass", "Keys", "Drums", "EG", "AG"] as const;
```

- [ ] **Step 4: Add the field to the member schema**

In `sanity/schemas/worshipTeam.ts`, add `import { INSTRUMENT_SEAT_OPTIONS } from "./instrumentSeats";` at the top, and insert this field object directly after the `memberType` field (after line 178's closing `},`):

```ts
    {
      name: "instruments",
      title: "Instrumentos",
      type: "array",
      of: [{ type: "string" }],
      options: {
        list: INSTRUMENT_SEAT_OPTIONS.map((value) => ({ title: value, value })),
        layout: "grid",
      },
      hidden: ({ document }) =>
        !((document?.memberType as string[] | undefined) ?? []).includes("instrumento"),
      description:
        "Qué instrumentos toca. Solo se lee para plazas de instrumento; vacío = no se asigna en automático.",
    },
```

- [ ] **Step 5: Add the two predicates to `seatModel.ts`**

Append to `app/components/admin/seatModel.ts`:

```ts
/**
 * Whether a label names an instrument seat a MEMBER may declare. Membership in
 * `DEFAULT_INSTRUMENT_SEATS` after normalization — NOT `normalizeSeatName`
 * alone, which also canonicalizes `console` → `Console`, a FOH seat. The
 * member-side vocabulary is closed (a typo here would silently make a member
 * unschedulable); the service-side one stays open to growth.
 */
export function isKnownInstrument(label: unknown): boolean {
  const name = normalizeSeatName(label);
  return name !== "" && DEFAULT_INSTRUMENT_SEATS.includes(name);
}

/**
 * Does this member DECLARE this instrument? Both halves are required: the
 * `instrumento` Tipo (ADR-0029's only eligibility axis) AND the label in
 * `instruments`. A leftover declaration on a member whose Tipo was cleared
 * declares nothing — `instruments` is a refinement of the Tipo, never a second
 * axis. Absent or empty `instruments` is "declares nothing" (spec D6).
 *
 * Read in exactly two places besides the backfill script: `rankCandidates`
 * (the `undeclared` flag) and `PlannerGrid`'s declaration warning.
 */
export function occupantDeclaresInstrument(
  member: { memberType?: string[]; instruments?: string[] } | undefined,
  label: string,
): boolean {
  if (!member) return false;
  if (!(member.memberType ?? []).includes("instrumento")) return false;
  const name = normalizeSeatName(label);
  return (member.instruments ?? []).some((i) => normalizeSeatName(i) === name);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/seatModel.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add sanity/schemas/instrumentSeats.ts sanity/schemas/worshipTeam.ts app/components/admin/seatModel.ts app/components/admin/__tests__/seatModel.test.ts
git commit -m "feat(members): declared instruments — schema field and seat-model predicates

A member of Tipo instrumento can declare which seats they play. The
Studio list is a no-import constant so a test can hold it equal to
DEFAULT_INSTRUMENT_SEATS. Absent or empty means declares nothing (D6)."
```

---

### Task 2: `rankCandidates` learns the declaration

**Files:**
- Modify: `app/components/admin/candidateRanking.ts:22-28` (`RankMember`), `:36-68` (`RankedCandidate`), `:186-236` (map + sort + comment)
- Modify: `app/components/admin/serviceCardModel.ts:96-102` (`MemberOption`)
- Test: `app/components/admin/__tests__/candidateRanking.test.ts`

**Interfaces:**
- Consumes: `occupantDeclaresInstrument` (Task 1).
- Produces: `RankMember.instruments?: string[]`; `MemberOption.instruments?: string[]`; `RankedCandidate.undeclared: boolean` (always `false` for `voz`/`foh` seats; NOT folded into `eligible`); sort order for `instrumento` seats: declared before undeclared, inside each existing rank bucket.

- [ ] **Step 1: Write the failing tests**

Append to `app/components/admin/__tests__/candidateRanking.test.ts` (the file already defines `m`, `MEMBERS`, `BASS`, `DATE`; add `const KEYS = instrumentSeatDef("Keys");` near `BASS`):

```ts
describe("declared instruments (spec §7)", () => {
  const players: RankMember[] = [
    { _id: "k1", member_name: "Zoe", memberType: ["instrumento"], instruments: ["Keys"] },
    { _id: "k2", member_name: "Ana", memberType: ["instrumento"], instruments: ["Drums"] },
    { _id: "k3", member_name: "Beto", memberType: ["instrumento"] }, // declares nothing
  ];

  it("flags a member who does not declare the seat's instrument, and still lists them", () => {
    const ranked = rankCandidates({ seat: KEYS, date: DATE, members: players, windowRoles: [], assigned: [] });
    const byId = new Map(ranked.map((c) => [c.id, c]));
    expect(byId.get("k1")?.undeclared).toBe(false);
    expect(byId.get("k2")?.undeclared).toBe(true);
    expect(byId.get("k3")?.undeclared).toBe(true);
    // Never a block (D6): a human may override.
    expect(byId.get("k2")?.blockedReason).toBeNull();
    expect(byId.get("k2")?.eligible).toBe(true);
  });

  it("sorts declared candidates first — a sort penalty like availability, inside the same bucket", () => {
    const ids = rankCandidates({ seat: KEYS, date: DATE, members: players, windowRoles: [], assigned: [] })
      .map((c) => c.id);
    // Zoe declares Keys and sorts before Ana and Beto despite the later name.
    expect(ids[0]).toBe("k1");
    expect(ids.slice(1)).toEqual(["k2", "k3"]);
  });

  it("is always false for voice and FOH seats", () => {
    const all = rankCandidates({ seat: LEAD, date: DATE, members: MEMBERS, windowRoles: [], assigned: [] });
    expect(all.every((c) => c.undeclared === false)).toBe(true);
  });

  it("still BLOCKS a second instrument seat on the same service (same-category rule is untouched)", () => {
    const assigned: AssignedSeat[] = [{ seatId: "instrumento:Drums", category: "instrumento", memberId: "k1" }];
    const zoe = rankCandidates({ seat: KEYS, date: DATE, members: players, windowRoles: [], assigned })
      .find((c) => c.id === "k1");
    expect(zoe?.blockedReason).toBe("Ya asignado en Drums");
    expect(zoe?.eligible).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/candidateRanking.test.ts`
Expected: FAIL — `undeclared` is `undefined`; sort order assertion fails.

- [ ] **Step 3: Extend the types**

In `app/components/admin/candidateRanking.ts`, `RankMember` (line 22):

```ts
export interface RankMember {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  /** Declared instrument seats (spec D6): absent or empty = declares nothing. */
  instruments?: string[];
  unavailableDates?: string[];
}
```

In `RankedCandidate` (after `eligible`, before `load`):

```ts
  /**
   * `instrumento` seats only: the member does not declare this seat's
   * instrument (`occupantDeclaresInstrument`). A SORT penalty like
   * `available`, never a block (D6) — and deliberately NOT folded into
   * `eligible`: the picker must keep listing undeclared members so a human can
   * override, while the instrument filler filters on this flag explicitly.
   * Always `false` for voice and FOH seats.
   */
  undeclared: boolean;
```

In `app/components/admin/serviceCardModel.ts`, `MemberOption` (after `memberType?`):

```ts
  /** Declared instrument seats; absent or empty = declares nothing (spec D6). */
  instruments?: string[];
```

- [ ] **Step 4: Compute the flag and add the sort key**

In `rankCandidates`, add the import `occupantDeclaresInstrument` from `./seatModel` (the file already imports `SeatCategory`/`SeatDef` types from there). Inside the `.map((m) => { ... })`, after `const available = ...`:

```ts
      const undeclared =
        seat.category === "instrumento" && !occupantDeclaresInstrument(m, seat.label);
```

and add `undeclared,` to the returned object (after `eligible`).

Replace the sort comment block and `rank` (lines 216-235) with:

```ts
  // THE SORT IS DELIBERATELY UNCHANGED (P7b) in two respects, and changed in ONE:
  //
  //  • No fairness term. The user settled this: "I don't want them necessarily
  //    buried, just not pushed up top always, if it's just visual then it
  //    doesn't matter." Ordering here is visual, so the smallest correct change
  //    is none. The filler's `effectiveLoad` (Task 7) is the only place exempt
  //    and slack members move, and it never touches `load`, which is rendered.
  //  • `ruleBlockedReason` is NOT a sort key. A rule-blocked candidate keeps its
  //    load-ordered position and renders disabled with the rule named — E6
  //    accepts that the people a rule protects sit at the top of every list;
  //    that is precisely WHY the rule has to be hard rather than a nudge.
  //  • `undeclared` IS a sort key (spec 2026-09-09 §7): on an instrument seat a
  //    member who does not declare the instrument sorts after those who do,
  //    with the same weight as unavailability. A penalty, never a block — the
  //    row stays selectable so a human can override (D6).
  const rank = (c: RankedCandidate) =>
    (c.blockedReason ? 100 : 0) + (c.available ? 0 : 10) + (c.undeclared ? 10 : 0) + (c.alreadyAssigned ? 1 : 0);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/candidateRanking.test.ts app/components/admin/__tests__/localFill.test.ts`
Expected: PASS (localFill's voice-only fixtures are unaffected: `undeclared` is `false` for `voz`).

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors (every `RankedCandidate` literal in tests must include `undeclared`; grep `app/components/admin/__tests__` for object literals typed as `RankedCandidate` and add `undeclared: false` where tsc complains).

```bash
git add app/components/admin/candidateRanking.ts app/components/admin/serviceCardModel.ts app/components/admin/__tests__/candidateRanking.test.ts
git commit -m "feat(planner): rankCandidates flags undeclared instrument players

A sort penalty with availability's weight, never a block, and not folded
into eligible: the picker keeps listing them for a human override, the
instrument filler filters on the flag explicitly."
```

---

### Task 3: Member routes accept, validate and project `instruments`

**Files:**
- Modify: `app/api/admin/members/[id]/route.ts:34-67` (body type, validation, patch)
- Modify: `app/api/admin/members/route.ts:22-30` (GET projection), `:47-85` (POST)
- Test: `app/api/__tests__/memberInstruments.test.ts` (new)

**Interfaces:**
- Consumes: `isKnownInstrument`, `normalizeSeatName` (Task 1).
- Produces: PATCH/POST accept `instruments?: string[]`; absent ⇒ untouched; `[]` ⇒ stored as `[]`; unknown name ⇒ `400 { error: "Instrumento no reconocido: <name>" }`; values normalized and de-duplicated. GET projects `instruments`.

- [ ] **Step 1: Write the failing tests**

`app/api/__tests__/memberInstruments.test.ts` — copy the mock block verbatim from `app/api/__tests__/membersMinistries.test.ts:15-79` (the `vi.hoisted` object, the four `vi.mock` calls, the `GET`/`POST`/`PATCH` imports, `req`, `patchSet`, `params`, `beforeEach`), then:

```ts
describe("PATCH /api/admin/members/[id] — instruments", () => {
  it("leaves the stored value alone when the body never mentions the field", async () => {
    const res = await PATCH(req({ alias: "A" }), { params });
    expect(res.status).toBe(200);
    expect("instruments" in patchSet()).toBe(false);
  });

  it("normalizes spelling and drops duplicates", async () => {
    const res = await PATCH(req({ instruments: [" keys", "Keys", "DRUMS"] }), { params });
    expect(res.status).toBe(200);
    expect(patchSet().instruments).toEqual(["Keys", "Drums"]);
  });

  it("stores an explicit empty array — 'declares nothing' is a legitimate value (D6)", async () => {
    const res = await PATCH(req({ instruments: [] }), { params });
    expect(res.status).toBe(200);
    expect(patchSet().instruments).toEqual([]);
  });

  it("rejects a name outside the seat vocabulary, naming it", async () => {
    const res = await PATCH(req({ instruments: ["Keys", "Piano"] }), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Instrumento no reconocido: Piano" });
    expect(h.sets).toHaveLength(0);
  });

  it("rejects a FOH seat even though normalizeSeatName knows it", async () => {
    const res = await PATCH(req({ instruments: ["console"] }), { params });
    expect(res.status).toBe(400);
  });

  it("rejects a non-array", async () => {
    const res = await PATCH(req({ instruments: "Keys" }), { params });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/members — instruments", () => {
  const base = { member_name: "Nuevo Músico", email: "n@example.com" };

  it("creates without the field when the body omits it", async () => {
    await POST(req(base));
    const doc = h.create.mock.calls[0][0] as Record<string, unknown>;
    expect("instruments" in doc).toBe(false);
  });

  it("creates with the normalized list when sent", async () => {
    await POST(req({ ...base, instruments: ["drums"] }));
    const doc = h.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.instruments).toEqual(["Drums"]);
  });

  it("rejects an unknown name", async () => {
    const res = await POST(req({ ...base, instruments: ["Guitarra"] }));
    expect(res.status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/members — projection", () => {
  it("selects instruments alongside memberType", async () => {
    await GET();
    const query = h.operationalFetch.mock.calls[0][0] as string;
    expect(query).toMatch(/memberType,[\s\S]*instruments/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/api/__tests__/memberInstruments.test.ts`
Expected: FAIL — `instruments` never reaches the patch; unknown names return 200; GET query lacks the field.

- [ ] **Step 3: Add a shared validator to `seatModel.ts`**

Append to `app/components/admin/seatModel.ts` (both routes import it; the module has no `"use client"`, so a route may import it — ADR-0028):

```ts
/**
 * The member-side write boundary's one predicate: normalize, de-duplicate,
 * and refuse anything outside `DEFAULT_INSTRUMENT_SEATS`. Shared by POST and
 * PATCH so create and edit cannot drift, and mirrored by the backfill script
 * (`scripts/lib/memberInstruments.mjs`, which cannot import TS).
 */
export function parseMemberInstruments(
  raw: unknown,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Instrumentos debe ser una lista." };
  const out: string[] = [];
  for (const item of raw) {
    const name = normalizeSeatName(item);
    if (!isKnownInstrument(name)) {
      return { ok: false, error: `Instrumento no reconocido: ${String(item ?? "").trim()}` };
    }
    if (!out.includes(name)) out.push(name);
  }
  return { ok: true, value: out };
}
```

- [ ] **Step 4: Wire PATCH**

In `app/api/admin/members/[id]/route.ts`: add `instruments?: string[];` to the `body` type after `memberType?: string[];`; add `import { parseMemberInstruments } from "@/app/components/admin/seatModel";`. After the `memberType` line (line 67) and BEFORE the ministries loop, insert:

```ts
  // Declared instruments (spec 2026-09-09 §4.2). `!== undefined` guard like
  // `ministries`: an absent field is untouched, so the form's touched-field
  // discipline holds and the backfill's "no stored field" predicate stays true.
  // `[]` IS stored — "declares nothing" is a legitimate value (D6).
  if (body.instruments !== undefined) {
    const parsed = parseMemberInstruments(body.instruments);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    patch.instruments = parsed.value;
  }
```

- [ ] **Step 5: Wire POST and GET**

In `app/api/admin/members/route.ts`: add `import { parseMemberInstruments } from "@/app/components/admin/seatModel";`; add `instruments?: string[];` to the POST body type and to the destructuring. After the ministries loop, insert:

```ts
  let instruments: string[] | undefined;
  if (body.instruments !== undefined) {
    const parsed = parseMemberInstruments(body.instruments);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    instruments = parsed.value;
  }
```

(Remove `instruments` from the destructuring line if you declared it there — one binding only.) In the `writeClient.create({...})` call, after `memberType: memberType ?? [],`:

```ts
    ...(instruments !== undefined ? { instruments } : {}),
```

In GET's projection, change `_id, member_name, alias, email, role, memberType, notifPrefs,` to `_id, member_name, alias, email, role, memberType, instruments, notifPrefs,`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run app/api/__tests__/memberInstruments.test.ts app/api/__tests__/membersMinistries.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc --noEmit`

```bash
git add app/api/admin/members/route.ts "app/api/admin/members/[id]/route.ts" app/components/admin/seatModel.ts app/api/__tests__/memberInstruments.test.ts
git commit -m "feat(api): member routes accept and project declared instruments

Closed to DEFAULT_INSTRUMENT_SEATS after normalization; absent leaves
the stored value alone, [] is stored. One parser for POST and PATCH."
```

---

### Task 4: Admin member form and list

**Files:**
- Modify: `app/components/admin/AdminPanel.tsx:37-76` (types), `:299-440` (form state + grid), `:831-870` (handlers), `:1198-1202` (chips)
- Test: `app/components/admin/__tests__/MemberForm.test.tsx`

**Interfaces:**
- Consumes: `DEFAULT_INSTRUMENT_SEATS` (`seatModel.ts`).
- Produces: `MemberFormData.instruments?: string[]` — present on EDIT only when the grid was touched; present on CREATE only when touched AND non-empty. `Member.instruments?: string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `app/components/admin/__tests__/MemberForm.test.tsx`:

```ts
describe("MemberForm — declared instruments", () => {
  const instrumentalist = { ...baseMember, memberType: ["instrumento"], instruments: ["Keys"] };

  it("hides the Instrumentos grid unless Tipo includes instrumento", () => {
    const { queryByRole } = render(
      <MemberForm initial={baseMember} onSubmit={() => {}} onClose={() => {}} loading={false} />,
    );
    expect(queryByRole("button", { name: "Keys" })).toBeNull();
  });

  it("shows the grid with the stored declaration ticked", () => {
    const { getByRole } = render(
      <MemberForm initial={instrumentalist} onSubmit={() => {}} onClose={() => {}} loading={false} />,
    );
    expect(getByRole("button", { name: "Keys" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: "Drums" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("omits instruments from an edit that never touched the grid", () => {
    const onSubmit = vi.fn();
    const { getByPlaceholderText, getByRole } = render(
      <MemberForm initial={instrumentalist} onSubmit={onSubmit} onClose={() => {}} loading={false} />,
    );
    fireEvent.change(getByPlaceholderText("Nombre completo"), { target: { value: "Ana T." } });
    fireEvent.click(getByRole("button", { name: "Guardar" }));
    expect("instruments" in onSubmit.mock.calls[0][0]).toBe(false);
  });

  it("sends the full list when a chip is toggled on edit", () => {
    const onSubmit = vi.fn();
    const { getByRole } = render(
      <MemberForm initial={instrumentalist} onSubmit={onSubmit} onClose={() => {}} loading={false} />,
    );
    fireEvent.click(getByRole("button", { name: "Drums" }));
    fireEvent.click(getByRole("button", { name: "Guardar" }));
    expect(onSubmit.mock.calls[0][0].instruments).toEqual(["Keys", "Drums"]);
  });

  it("keeps the local declaration when instrumento is unticked and re-ticked", () => {
    const onSubmit = vi.fn();
    const { getByRole } = render(
      <MemberForm initial={instrumentalist} onSubmit={onSubmit} onClose={() => {}} loading={false} />,
    );
    fireEvent.click(getByRole("button", { name: "Instrumento" }));
    fireEvent.click(getByRole("button", { name: "Instrumento" }));
    expect(getByRole("button", { name: "Keys" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("on CREATE, omits instruments unless touched and non-empty", () => {
    const onSubmit = vi.fn();
    const { getByPlaceholderText, getByRole } = render(
      <MemberForm onSubmit={onSubmit} onClose={() => {}} loading={false} />,
    );
    fireEvent.change(getByPlaceholderText("Nombre completo"), { target: { value: "Nuevo" } });
    fireEvent.change(getByPlaceholderText("correo@ejemplo.com"), { target: { value: "n@x.com" } });
    fireEvent.click(getByRole("button", { name: "Instrumento" }));
    fireEvent.click(getByRole("button", { name: "Guardar" }));
    expect("instruments" in onSubmit.mock.calls[0][0]).toBe(false);

    fireEvent.click(getByRole("button", { name: "Bass" }));
    fireEvent.click(getByRole("button", { name: "Guardar" }));
    expect(onSubmit.mock.calls[1][0].instruments).toEqual(["Bass"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/MemberForm.test.tsx`
Expected: FAIL — no «Keys» button; `instruments` never submitted.

- [ ] **Step 3: Types and form state**

In `AdminPanel.tsx`, add to `interface Member` after `memberType?: string[];`:

```ts
  /** Declared instrument seats; absent or empty = declares nothing (spec D6). */
  instruments?: string[];
```

Add to `interface MemberFormData` after `memberType: string[];`:

```ts
  /**
   * Present on EDIT only when the admin touched the Instrumentos grid, and on
   * CREATE only when touched and non-empty — the same touched-field discipline
   * as `ministries`, so editing an email never writes `[]` over an untouched
   * field and a new member is not frozen at `[]` for the backfill (spec §4.4).
   */
  instruments?: string[];
```

Add `import { DEFAULT_INSTRUMENT_SEATS } from "./seatModel";` (check the file's existing imports; `seatModel` has no `"use client"` and is already imported by planner client modules).

In `MemberForm`, after the `memberType` state:

```ts
  // Kept even while `instrumento` is unticked, so re-ticking restores it.
  const [instruments, setInstruments] = useState<string[]>(initial?.instruments ?? []);
  const [touchedInstruments, setTouchedInstruments] = useState(false);
  const toggleInstrument = (value: string) => {
    setInstruments(prev => prev.includes(value) ? prev.filter(i => i !== value) : [...prev, value]);
    setTouchedInstruments(true);
  };
```

In the `onSubmit` call, add after `...touchedMinistries,`:

```ts
          ...(touchedInstruments && (initial || instruments.length > 0) ? { instruments } : {}),
```

- [ ] **Step 4: Render the grid**

Directly after the Tipo `<div className="space-y-2">…</div>` block, insert:

```tsx
      {memberType.includes("instrumento") && (
        <div className="space-y-2">
          <label className="font-label text-xs uppercase tracking-widest text-mono-500">Instrumentos</label>
          <div className="flex gap-2">
            {DEFAULT_INSTRUMENT_SEATS.map((value) => {
              const active = instruments.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleInstrument(value)}
                  className={`flex-1 py-2 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${
                    active
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-accent/20 text-mono-500 hover:border-accent/50"
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
          <p className="font-body text-[11px] text-mono-500">
            Vacío = no se asigna en automático; el planner lo sigue listando como «sin declarar».
          </p>
        </div>
      )}
```

Also add `aria-pressed={active}` to the existing Tipo buttons (line ~416) so the test's `Instrumento` toggle is a real toggle button; no behaviour change.

- [ ] **Step 5: Handlers and chips**

In `handleAdd`, change the destructuring and body to:

```ts
      const { member_name, alias, email, role, memberType, ministries, managesMinistries, instruments } = data;
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_name, alias, email, role, memberType, ministries, managesMinistries,
          ...(instruments !== undefined ? { instruments } : {}),
        }),
      });
```

`handleEdit` already spreads `...rest`, which carries `instruments` only when present — no change.

In the list chips (line ~1198), after the `memberType` map, add:

```tsx
                  {(m.instruments ?? []).map(i => (
                    <span key={`instr-${i}`} className="font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-mono-500/10 text-mono-400 border border-mono-500/20">
                      {i}
                    </span>
                  ))}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/MemberForm.test.tsx app/components/admin/__tests__/`
Expected: PASS.

- [ ] **Step 7: Gates and commit**

Run: `npx tsc --noEmit && npx eslint app/components/admin/AdminPanel.tsx`

```bash
git add app/components/admin/AdminPanel.tsx app/components/admin/__tests__/MemberForm.test.tsx
git commit -m "feat(admin): Instrumentos grid on the member form, chips on the list

Touched-field discipline like ministries: an untouched edit sends
nothing; a create sends the list only when touched and non-empty."
```

---

### Task 5: The filler — `instrumentFill.ts`

**Files:**
- Create: `app/components/admin/instrumentFill.ts`
- Modify: `app/components/admin/localFill.ts:205` (`export` `withAutoCell`)
- Test: `app/components/admin/__tests__/instrumentFill.test.ts` (new)

**Interfaces:**
- Consumes: `rankCandidates`, `RankMember`, `RankedCandidate` (Task 2); `withAutoCell` (localFill); `assignedForColumn`, `cellsToParticipantRoles`, `rowAppliesTo`, `seatDefForRow`, `GridCell`, `GridColumn`, `GridRow`, `SolverConfig` (plannerModel); `isKnownInstrument` (Task 1).
- Produces:

```ts
export const INSTRUMENT_ROW_PREFIX = "instrumento:";
export interface FillInstrumentsInput {
  columns: GridColumn[]; rows: GridRow[]; cells: GridCell[]; members: RankMember[];
  savedWindow: ParticipantRole[]; config?: SolverConfig;
}
export interface FillInstrumentsResult { cells: GridCell[]; unfilled: { columnId: string; rowId: string }[] }
export function fillInstruments(input: FillInstrumentsInput): FillInstrumentsResult;
export function isInstrumentRowId(rowId: string): boolean;
/** `unfilled` minus instrument entries whose cell now has an occupant (render-time gate, §6.3). */
export function renderableUnfilled(unfilled: { columnId: string; rowId: string }[], cells: GridCell[]): { columnId: string; rowId: string }[];
```

- [ ] **Step 1: Write the failing tests**

`app/components/admin/__tests__/instrumentFill.test.ts`:

```ts
// app/components/admin/__tests__/instrumentFill.test.ts
//
// The instrument filler (spec 2026-09-09 §6). Per-MEMBER total balance inside
// the month, per service, alternation on ties, empty seats only, and
// idempotence on its own output — the property round 2 of the review found
// missing when the vacate ran inside the column loop.
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import { buildRows, createColumnId, type GridCell, type GridColumn } from "../plannerModel";
import { fillInstruments, renderableUnfilled, isInstrumentRowId } from "../instrumentFill";

// March 2026: five Sundays, 1st..29th.
const SUNDAYS = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"];
const col = (date: string, type: GridColumn["type"] = "sunday_role"): GridColumn =>
  ({ columnId: createColumnId(type, date), date, type });
const COLS = SUNDAYS.map((d) => col(d));
const ROWS = buildRows();
const KEYS = "instrumento:Keys";
const DRUMS = "instrumento:Drums";

const p = (id: string, name: string, instruments: string[], unavailable: string[] = []): RankMember =>
  ({ _id: id, member_name: name, memberType: ["instrumento"], instruments, unavailableDates: unavailable });

const cell = (columnId: string, rowId: string, ids: string[], origin: GridCell["origin"] = "manual"): GridCell =>
  ({ columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin });

function run(members: RankMember[], cells: GridCell[] = [], columns = COLS) {
  return fillInstruments({ columns, rows: ROWS, cells, members, savedWindow: [] });
}
const occupantsOf = (cells: GridCell[], columnId: string, rowId: string) =>
  cells.find((c) => c.columnId === columnId && c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];
const roster = (cells: GridCell[], rowId: string) => COLS.map((c) => occupantsOf(cells, c.columnId, rowId).join(","));
const countFor = (cells: GridCell[], id: string) =>
  cells.filter((c) => isInstrumentRowId(c.rowId)).flatMap((c) => c.occupants).filter((o) => o.memberId === id).length;

describe("fillInstruments — balance and alternation", () => {
  it("two drummers over five Sundays end within one of each other, alternating", () => {
    const out = run([p("a", "Ana", ["Drums"]), p("b", "Beto", ["Drums"])]);
    expect(roster(out.cells, DRUMS)).toEqual(["a", "b", "a", "b", "a"]);
    expect(Math.abs(countFor(out.cells, "a") - countFor(out.cells, "b"))).toBeLessThanOrEqual(1);
    expect(out.unfilled).toEqual([]);
  });

  it("three keys players: fewest-first, then alternation, then name", () => {
    const out = run([p("c", "Carla", ["Keys"]), p("a", "Ana", ["Keys"]), p("b", "Beto", ["Keys"])]);
    expect(roster(out.cells, KEYS)).toEqual(["a", "b", "c", "a", "b"]);
  });

  it("skips an unavailable player and breaks the bound only there", () => {
    const out = run([p("a", "Ana", ["Drums"], SUNDAYS.slice(2)), p("b", "Beto", ["Drums"])]);
    expect(roster(out.cells, DRUMS)).toEqual(["a", "b", "b", "b", "b"]);
  });

  it("counts a manual occupant and never replaces it", () => {
    const manual = cell(COLS[0].columnId, DRUMS, ["b"]);
    const out = run([p("a", "Ana", ["Drums"]), p("b", "Beto", ["Drums"])], [manual]);
    expect(occupantsOf(out.cells, COLS[0].columnId, DRUMS)).toEqual(["b"]);
    expect(out.cells.find((c) => c.columnId === COLS[0].columnId && c.rowId === DRUMS)).toBe(manual);
    // Beto already holds one, so Ana takes Sunday 2, then they alternate.
    expect(roster(out.cells, DRUMS)).toEqual(["b", "a", "b", "a", "b"]);
  });

  it("leaves a two-drummer cell alone (not empty, not touched)", () => {
    const two = cell(COLS[0].columnId, DRUMS, ["x", "y"]);
    const out = run([p("a", "Ana", ["Drums"])], [two]);
    expect(occupantsOf(out.cells, COLS[0].columnId, DRUMS)).toEqual(["x", "y"]);
  });

  it("a voice seat on the same column does NOT exclude (D4)", () => {
    const lead = cell(COLS[0].columnId, "lead", ["a"]);
    const out = run([{ ...p("a", "Ana", ["Keys"]), memberType: ["voz", "instrumento"] }], [lead]);
    expect(occupantsOf(out.cells, COLS[0].columnId, KEYS)).toEqual(["a"]);
  });

  it("never seats one member on two instrument rows of one column (same-category block)", () => {
    // X declares both; Y drums; Z keys. Drums is the thinner pool.
    const out = run([p("x", "Xavi", ["Keys", "Drums"]), p("y", "Yola", ["Drums"]), p("z", "Zoe", ["Keys"])]);
    for (const c of COLS) {
      const k = occupantsOf(out.cells, c.columnId, KEYS);
      const d = occupantsOf(out.cells, c.columnId, DRUMS);
      expect(k.filter((id) => d.includes(id))).toEqual([]);
    }
  });

  it("a two-instrument member goes to the thinner row, and totals balance as PEOPLE (spec §6.2 trace)", () => {
    const out = run([
      p("x", "Xavi", ["Keys", "Drums"]), p("y", "Yola", ["Drums"]),
      p("z", "Zoe", ["Keys"]), p("w", "Wendy", ["Keys"]),
    ]);
    expect(roster(out.cells, DRUMS)).toEqual(["x", "y", "x", "y", "x"]);
    expect(countFor(out.cells, "x")).toBe(3);
    expect(countFor(out.cells, "y")).toBe(2);
    // Keys never reaches Xavi: on the Sundays Xavi is free, Wendy or Zoe hold fewer seats.
    expect(roster(out.cells, KEYS).some((s) => s === "x")).toBe(false);
    const keysTotals = [countFor(out.cells, "z"), countFor(out.cells, "w")].sort();
    expect(keysTotals).toEqual([2, 3]);
  });
});

describe("fillInstruments — scope and markers", () => {
  it("skips a row nobody declares, with NO marker", () => {
    const out = run([p("a", "Ana", ["Drums"])]);
    expect(out.cells.some((c) => c.rowId === KEYS)).toBe(false);
    expect(out.unfilled.filter((u) => u.rowId === KEYS)).toEqual([]);
  });

  it("a leftover declaration on a member without the Tipo is not a declarer", () => {
    const out = run([{ ...p("a", "Ana", ["Drums"]), memberType: [] }]);
    expect(out.cells).toEqual([]);
    expect(out.unfilled).toEqual([]);
  });

  it("reports one unfilled entry per empty seat on a row that HAS declarers", () => {
    const out = run([p("a", "Ana", ["Keys"], SUNDAYS)]);
    expect(out.unfilled).toEqual(COLS.map((c) => ({ columnId: c.columnId, rowId: KEYS })));
    expect(out.cells).toEqual([]);
  });

  it("never fills a special column", () => {
    const special = col("2026-03-18", "special_role");
    const out = run([p("a", "Ana", ["Keys"])], [], [...COLS, special]);
    expect(out.cells.some((c) => c.columnId === special.columnId)).toBe(false);
    expect(out.unfilled.some((u) => u.columnId === special.columnId)).toBe(false);
  });

  it("fills Saturdays too, counting per service", () => {
    const sat = col("2026-03-07", "saturday_role");
    const out = run([p("a", "Ana", ["Drums"]), p("b", "Beto", ["Drums"])], [], [COLS[0], sat, COLS[1]]);
    // Sun 1 → Ana; Sat 7 → Beto (fewest); Sun 8 → Ana.
    expect(occupantsOf(out.cells, COLS[0].columnId, DRUMS)).toEqual(["a"]);
    expect(occupantsOf(out.cells, sat.columnId, DRUMS)).toEqual(["b"]);
    expect(occupantsOf(out.cells, COLS[1].columnId, DRUMS)).toEqual(["a"]);
  });

  it("stamps its picks origin auto and preserves untouched cells by reference", () => {
    const foh = cell(COLS[0].columnId, "foh:Console", ["s"]);
    const out = run([p("a", "Ana", ["Keys"])], [foh]);
    expect(out.cells).toContain(foh);
    expect(out.cells.find((c) => c.rowId === KEYS)?.origin).toBe("auto");
  });
});

describe("fillInstruments — re-run semantics", () => {
  it("is idempotent on its own output (the review's case: one drummer away three of five Sundays)", () => {
    const members = [p("a", "Ana", ["Drums"], SUNDAYS.slice(2)), p("b", "Beto", ["Drums"])];
    const first = run(members);
    const second = run(members, first.cells);
    expect(roster(second.cells, DRUMS)).toEqual(roster(first.cells, DRUMS));
    expect(second.unfilled).toEqual(first.unfilled);
  });

  it("vacates every auto pick before counting — stale picks in later columns do not steer earlier ones", () => {
    // Previous run left Beto on Sundays 2..5 (auto). A fresh run must produce
    // the same roster it would from an empty grid: a,b,a,b,a.
    const stale = COLS.slice(1).map((c) => cell(c.columnId, DRUMS, ["b"], "auto"));
    const out = run([p("a", "Ana", ["Drums"]), p("b", "Beto", ["Drums"])], stale);
    expect(roster(out.cells, DRUMS)).toEqual(["a", "b", "a", "b", "a"]);
  });

  it("re-rolls its own picks but keeps a manual one", () => {
    const stale = cell(COLS[0].columnId, DRUMS, ["b"], "auto");
    const manual = cell(COLS[1].columnId, DRUMS, ["b"], "manual");
    const out = run([p("a", "Ana", ["Drums"]), p("b", "Beto", ["Drums"])], [stale, manual]);
    expect(occupantsOf(out.cells, COLS[1].columnId, DRUMS)).toEqual(["b"]);
    expect(occupantsOf(out.cells, COLS[0].columnId, DRUMS)).toEqual(["a"]);
  });
});

describe("renderableUnfilled", () => {
  it("drops an instrument entry whose cell now has an occupant, keeps everything else", () => {
    const u = [
      { columnId: COLS[0].columnId, rowId: KEYS },
      { columnId: COLS[1].columnId, rowId: KEYS },
      { columnId: COLS[0].columnId, rowId: "coro" },
      { columnId: COLS[0].columnId, rowId: "coro" },
    ];
    const cells = [cell(COLS[0].columnId, KEYS, ["a"]), cell(COLS[0].columnId, "coro", ["z"])];
    expect(renderableUnfilled(u, cells)).toEqual([u[1], u[2], u[3]]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/instrumentFill.test.ts`
Expected: FAIL — module `../instrumentFill` not found.

- [ ] **Step 3: Export `withAutoCell` from `localFill.ts`**

Change line 205 `function withAutoCell(` to `export function withAutoCell(`. No other change.

- [ ] **Step 4: Write the filler**

`app/components/admin/instrumentFill.ts`:

```ts
// app/components/admin/instrumentFill.ts
//
// The greedy filler for INSTRUMENT seats on weekend columns (spec
// 2026-09-09-member-instruments-auto-fill-design.md §6). Sibling of
// `localFill.ts`, and like it NOT the solver — never describe it as one in the
// UI. CP-SAT knows five voice roles and nothing else (D5); instruments were
// manual until this module.
//
// What it guarantees (§6.2): per-MEMBER total balance inside the month, per
// service. At every placement the eligible declarer holding the fewest
// instrument seats this month is chosen, so nobody is passed over by someone
// who already holds strictly more. When every player of an instrument declares
// only that instrument, that IS the per-instrument "difference ≤ 1" Frank
// asked for; a two-instrument member is balanced as a person, and their count
// on any ONE instrument may lag — confirmed as the intended reading.
//
// The two traps the review found, and where each is closed:
//  1. Eligibility is NEVER re-implemented here. The pool is `rankCandidates`
//     re-run per placement against `working`, filtered on `eligible` and
//     `!undeclared`. That single call is what enforces Tipo, availability, and
//     the same-category rule (a member already on another `instrumento:` row of
//     this column is `blockedReason`, exactly the C2 refusal the picker and
//     `moveGate` apply to a human). Round 1 of the review caught a version that
//     forked this and seated one person on Keys and Drums the same day.
//  2. Vacate happens ONCE, before any counting. A previous Auto's `origin:
//     "auto"` instrument cells are emptied in one pass over the whole grid, so
//     `working` never holds a pick this run has not made. Round 2 caught a
//     version that vacated inside the column loop: stale picks in later columns
//     counted as seats held while earlier columns were filled, and the same
//     inputs produced two different rosters.

import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { rankCandidates, type RankedCandidate, type RankMember } from "./candidateRanking";
import { withAutoCell } from "./localFill";
import {
  assignedForColumn,
  cellsToParticipantRoles,
  rowAppliesTo,
  seatDefForRow,
  type GridCell,
  type GridColumn,
  type GridRow,
  type SolverConfig,
} from "./plannerModel";
import { isKnownInstrument } from "./seatModel";

export const INSTRUMENT_ROW_PREFIX = "instrumento:";

export function isInstrumentRowId(rowId: string): boolean {
  return rowId.startsWith(INSTRUMENT_ROW_PREFIX);
}

export interface FillInstrumentsInput {
  /** The whole grid, every column type; specials are skipped, never filled. */
  columns: GridColumn[];
  rows: GridRow[];
  /** Post-solve, post-special-fill cells. */
  cells: GridCell[];
  members: RankMember[];
  /** `rankCandidates` needs it; the ORDER below ignores it (D2: in-month only). */
  savedWindow: ParticipantRole[];
  /** `rankCandidates` needs it for rule blocks; no rule form names an instrument. */
  config?: SolverConfig;
}

export interface FillInstrumentsResult {
  /** The whole grid, merged — every cell this did not touch survives by reference. */
  cells: GridCell[];
  /** ONE ENTRY PER SEAT left empty on a row that HAS declarers. */
  unfilled: { columnId: string; rowId: string }[];
}

type Seat = { columnId: string; rowId: string };

const isWeekend = (c: GridColumn) => c.type === "sunday_role" || c.type === "saturday_role";

/** Step 0 — every auto instrument cell on a weekend column, emptied, in one pass. */
function vacateAutoInstrumentCells(cells: GridCell[], weekendIds: Set<string>): GridCell[] {
  return cells.map((c) =>
    weekendIds.has(c.columnId) && isInstrumentRowId(c.rowId) && c.origin === "auto"
      ? { ...c, occupants: [], origin: "empty" as const }
      : c,
  );
}

/** Instrument seats held per member over the whole grid, all instrument rows, every column. */
function seatCounts(cells: GridCell[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cells) {
    if (!isInstrumentRowId(c.rowId)) continue;
    for (const o of c.occupants) out.set(o.memberId, (out.get(o.memberId) ?? 0) + 1);
  }
  return out;
}

/** Members holding ANY instrument row on the given column. */
function instrumentalistsOn(cells: GridCell[], columnId: string): Set<string> {
  const out = new Set<string>();
  for (const c of cells) {
    if (c.columnId !== columnId || !isInstrumentRowId(c.rowId)) continue;
    for (const o of c.occupants) out.add(o.memberId);
  }
  return out;
}

export function fillInstruments(input: FillInstrumentsInput): FillInstrumentsResult {
  const { columns, rows, members, savedWindow, config } = input;
  const unfilled: Seat[] = [];

  const weekend = columns.filter(isWeekend).sort((a, b) => a.date.localeCompare(b.date));
  const weekendIds = new Set(weekend.map((c) => c.columnId));
  let working = vacateAutoInstrumentCells(input.cells, weekendIds);

  // Rows the filler may touch: instrument rows inside the member vocabulary.
  // A custom planner row («Nuevo instrumento») is outside it — nobody can
  // declare it, so it is never filled and never produces a marker (D1).
  const instrumentRows = rows.filter((r) => isInstrumentRowId(r.id) && isKnownInstrument(r.label));

  let previousColumnId: string | null = null;
  for (const column of weekend) {
    // Declarer count per row, through `rankCandidates` (never a direct read of
    // `instruments`): Tipo filter applied, `undeclared` computed. Rows with
    // zero declarers are skipped; the rest go thinnest pool first, then `rows`
    // order, so equal pools resolve deterministically.
    const candidateRows = instrumentRows
      .filter((row) => rowAppliesTo(row, column))
      .map((row, index) => ({
        row,
        index,
        declarers: rankCandidates({
          seat: seatDefForRow(row), date: column.date, members, windowRoles: [], assigned: [],
        }).filter((c) => !c.undeclared).length,
      }))
      .filter((x) => x.declarers > 0)
      .sort((a, b) => a.declarers - b.declarers || a.index - b.index);

    for (const { row } of candidateRows) {
      const existing = working.find((c) => c.columnId === column.columnId && c.rowId === row.id);
      if (existing && existing.occupants.length > 0) continue; // not empty — never touched

      // Re-ranked against `working`, the state as of THIS placement.
      const windowRoles = [...savedWindow, ...cellsToParticipantRoles(working, columns, members)];
      const assigned = assignedForColumn(working, rows, column.columnId);
      const pool = rankCandidates({
        seat: seatDefForRow(row), date: column.date, members, windowRoles, assigned, column, config,
      }).filter((c) => c.eligible && !c.undeclared);

      if (pool.length === 0) {
        unfilled.push({ columnId: column.columnId, rowId: row.id });
        continue;
      }

      const counts = seatCounts(working);
      const playedPrevious = previousColumnId ? instrumentalistsOn(working, previousColumnId) : new Set<string>();
      const pick = orderForFill(pool, counts, playedPrevious)[0];
      working = withAutoCell(working, column.columnId, row.id, [pick.id]);
    }
    previousColumnId = column.columnId;
  }

  return { cells: working, unfilled };
}

/**
 * The filler's ordering key (§6.2 step 3): fewest instrument seats this month
 * (per member, all rows), then did NOT play on the immediately previous weekend
 * column (the alternation), then `member_name` in Spanish collation. Decorated
 * with the incoming index so ties are broken explicitly, never by trusting the
 * engine's sort.
 */
export function orderForFill(
  pool: RankedCandidate[],
  counts: Map<string, number>,
  playedPrevious: Set<string>,
): RankedCandidate[] {
  return pool
    .map((c, i) => ({ c, i, count: counts.get(c.id) ?? 0, prev: playedPrevious.has(c.id) ? 1 : 0 }))
    .sort((a, b) => a.count - b.count || a.prev - b.prev || a.c.name.localeCompare(b.c.name, "es") || a.i - b.i)
    .map((x) => x.c);
}

/**
 * The render-time gate (§6.3), SCOPED to instrument rows: an instrument entry
 * whose cell now has an occupant (a human filled it after Auto) is dropped.
 * Voice and special entries are one per missing SLOT — a Coro with one of three
 * seated has two entries and a non-empty cell — so they pass through untouched.
 * The `unfilled` STATE and its merge rules are not modified; only what renders.
 */
export function renderableUnfilled(unfilled: Seat[], cells: GridCell[]): Seat[] {
  const occupied = new Set(
    cells.filter((c) => isInstrumentRowId(c.rowId) && c.occupants.length > 0).map((c) => `${c.columnId}|${c.rowId}`),
  );
  return unfilled.filter((u) => !(isInstrumentRowId(u.rowId) && occupied.has(`${u.columnId}|${u.rowId}`)));
}
```

Note on `rankCandidates` and `name`: `RankedCandidate.name` is `displayName(m)` (alias or member_name). The spec says `member_name`; the fixtures above have no alias, so both agree. Keep `c.name` — it is what the picker shows and what an admin would expect the tie-break to follow.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run app/components/admin/__tests__/instrumentFill.test.ts`
Expected: PASS. If the "three keys players" or "§6.2 trace" case disagrees on a tie, trace by hand against the ordering key before changing the expectation: the ordering is the contract, the fixture is the check.

- [ ] **Step 6: Run the neighbours, type-check, commit**

Run: `npx vitest run app/components/admin/__tests__/localFill.test.ts app/components/admin/__tests__/candidateRanking.test.ts && npx tsc --noEmit`

```bash
git add app/components/admin/instrumentFill.ts app/components/admin/localFill.ts app/components/admin/__tests__/instrumentFill.test.ts
git commit -m "feat(planner): pure instrument filler with per-member in-month balance

Vacates its own previous picks once, before any counting; seats empty
instrument cells through rankCandidates per placement; one unfilled
entry per empty seat on rows that have declarers."
```

---

### Task 6: Wire the filler into «Generar mes»

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx:25` (import), `:2919-2951` (`applySpecialFill`), `:2875-2918` (comment)
- Test: `app/components/admin/__tests__/instrumentFill.wiring.test.tsx` (new)

**Interfaces:**
- Consumes: `fillInstruments`, `isInstrumentRowId` (Task 5).
- Produces: instrument seats filled on every `handleAuto` exit; the failure-exit `unfilled` filter drops previous entries on special columns OR on `instrumento:` rows.

- [ ] **Step 1: Write the failing wiring test**

`app/components/admin/__tests__/instrumentFill.wiring.test.tsx` — copy from `localFill.wiring.test.tsx` lines 1-160 the header, `Gen`, `afterEach`/`beforeEach`, fixtures (`m`, `ANA`, `LUCIA`, `NIZA`, `BETO`), DOM helpers (`setMonthYear`, `deselectAll`, `selectSundayLead`, `preview`, `runAuto`, `cellAt`, `stubFetch`). Then:

```ts
/** Declared players. Zoe is away every Sunday of March 2026, so Keys stays empty. */
const SUNDAYS = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"];
const RODRI = { ...m("rodri", "Rodrigo Lara Peña", "Rodri", ["instrumento"]), instruments: ["Drums"] };
const PACO = { ...m("paco", "Francisco Ibarra", "Paco", ["instrumento"]), instruments: ["Drums"] };
const ZOE = { ...m("zoe", "Zoraida Peña Lima", "Zoe", ["instrumento"]), instruments: ["Keys"], unavailableDates: SUNDAYS };

const refusal = () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: false, error: "El solver no encontró solución." }),
});

describe("Auto fills instrument seats on every exit", () => {
  function setup(solve: () => unknown) {
    const { fetchMock } = stubFetch(solve);
    const view = render(
      <Gen members={[ANA, LUCIA, NIZA, BETO, RODRI, PACO, ZOE]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(view.container, 3, 2026);
    deselectAll(view.container, "saturday");
    selectSundayLead(view.container, "Ana");
    preview();
    return { ...view, fetchMock };
  }

  it("seats the drummers alternating even when the solver refuses the month", async () => {
    const { container } = setup(refusal);
    runAuto();
    await waitFor(() => expect(cellAt(container, "instrumento:Drums", SUNDAYS[0]).textContent).toContain("Paco"));
    expect(cellAt(container, "instrumento:Drums", SUNDAYS[1]).textContent).toContain("Rodri");
    expect(cellAt(container, "instrumento:Drums", SUNDAYS[2]).textContent).toContain("Paco");
  });

  it("reports the empty Keys seats once, and does not double-count them when Auto runs twice", async () => {
    const { container } = setup(refusal);
    runAuto();
    // Five Keys seats empty (Zoe away). The solver's own unfilled is absent on refusal.
    await waitFor(() => expect(screen.getByText("Lugares sin cubrir (faltó gente): 5")).toBeTruthy());
    expect(cellAt(container, "instrumento:Keys", SUNDAYS[0]).textContent).toContain("Sin cubrir");
    runAuto();
    await waitFor(() => expect(screen.getByText("Lugares sin cubrir (faltó gente): 5")).toBeTruthy());
  });

  it("does not mark a row nobody declares", async () => {
    const { container } = setup(refusal);
    runAuto();
    await waitFor(() => expect(screen.getByText("Lugares sin cubrir (faltó gente): 5")).toBeTruthy());
    expect(cellAt(container, "instrumento:Bass", SUNDAYS[0]).textContent).not.toContain("Sin cubrir");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/components/admin/__tests__/instrumentFill.wiring.test.tsx`
Expected: FAIL — no drummer seated; count is 0 (or the previous voice behaviour).

- [ ] **Step 3: Wire `applySpecialFill`**

In `MonthGenerator.tsx`, add `import { fillInstruments, isInstrumentRowId } from "./instrumentFill";` after line 25. Replace the body of `applySpecialFill` from `setCells(next);` to the end of the function with:

```ts
    // Instrument seats (spec 2026-09-09 §6.3): after the specials, before the
    // three setters, on the accumulated cells — so it runs on EVERY exit exactly
    // as the specials do, and there is still one owner of the setters.
    const instr = fillInstruments({ columns, rows, cells: next, members, savedWindow, config });
    next = instr.cells;
    filled.push(...instr.unfilled);

    setCells(next);
    // On a non-success exit the previous run's entries survive EXCEPT the ones a
    // local filler owns — special columns, and now every `instrumento:` row on
    // any column. Instrument entries sit on WEEKEND columns, so without the
    // second clause every solver refusal (D15's normal failure) would re-append
    // the same empty seats and «Lugares sin cubrir» would grow each time.
    setUnfilled(prev => [
      ...(solverUnfilled ?? prev.filter(u => !specialColumnIds.has(u.columnId) && !isInstrumentRowId(u.rowId))),
      ...filled,
    ]);
    setDrafts(prev => cellsToDrafts(next, columns, skippedColumnIds, prev, existingRoles));
  }
```

Update the function's leading comment (around line 2875-2918) with one sentence: "Also the instrument filler (`instrumentFill.ts`), for the same reason and at the same place."

- [ ] **Step 4: Run the wiring tests**

Run: `npx vitest run app/components/admin/__tests__/instrumentFill.wiring.test.tsx app/components/admin/__tests__/localFill.wiring.test.tsx app/components/admin/__tests__/MonthGenerator.create.test.tsx`
Expected: PASS. The existing suites have no member with `instruments`, so every instrument row has zero declarers and their counts are unchanged.

- [ ] **Step 5: Gates and commit**

Run: `npx tsc --noEmit && npx eslint app/components/admin/MonthGenerator.tsx`

```bash
git add app/components/admin/MonthGenerator.tsx app/components/admin/__tests__/instrumentFill.wiring.test.tsx
git commit -m "feat(planner): Generar mes fills instrument seats on every exit

Runs inside applySpecialFill so the three setters keep one owner; the
failure-exit unfilled filter now also drops instrumento: rows, or a
solver refusal would re-append the same empty seats every time."
```

---

### Task 7: Planner surfaces — «sin declarar», the second amber line, the scoped gate

**Files:**
- Modify: `app/components/admin/PlannerGrid.tsx:117-123` (imports), `:624-627` (add `instrumentUndeclared` beside `seatMismatch`), `:2066-2070` (count), `:2398-2420` (props threading), `:2485-2500` (row loop), `:2525-2580` (`GridCellView` props), `:2706` (chip aria), `:2844-2851` (amber lines + marker), `:2941-2955` (`CandidateRow` chips)
- Test: `app/components/admin/__tests__/PlannerGrid.test.tsx`

**Interfaces:**
- Consumes: `occupantDeclaresInstrument`, `DEFAULT_INSTRUMENT_SEATS` (Task 1); `RankedCandidate.undeclared` (Task 2); `renderableUnfilled` (Task 5).
- Produces: picker row chip «Sin declarar»; cell line «⚠ Nombre: no declara Keys — revísalo en Miembros»; aria suffix «(instrumento no declarado)»; count and per-cell marker gated for instrument rows.

- [ ] **Step 1: Write the failing tests**

Read `app/components/admin/__tests__/PlannerGrid.test.tsx:1-80` for `renderGrid`/overrides and reuse them. Append:

```tsx
describe("declared instruments on the planner (spec §7, §6.3)", () => {
  const KEYS_ROW = "instrumento:Keys";
  const keysPlayer = { _id: "k1", member_name: "Zoe Keys", memberType: ["instrumento"], instruments: ["Keys"] };
  const drummer = { _id: "d1", member_name: "Ana Drums", memberType: ["instrumento"], instruments: ["Drums"] };

  it("labels an undeclared candidate «Sin declarar» in its own element and sorts it after declared ones", () => {
    const { container } = renderGrid({ members: [drummer, keysPlayer] });
    // Open the Keys picker on the first column.
    fireEvent.click(container.querySelector(`[data-row-id="${KEYS_ROW}"]`)!);
    const rows = screen.getAllByRole("button", { name: /Keys|Drums/ });
    expect(rows[0].textContent).toContain("Zoe Keys");
    const ana = rows.find((r) => r.textContent?.includes("Ana Drums"))!;
    expect(within(ana).getByText("Sin declarar")).toBeTruthy();
    expect(within(ana).getByText("Ana Drums")).toBeTruthy(); // name is its own text node
  });

  it("warns on an instrument cell whose occupant does not declare the instrument, naming it", () => {
    const { container } = renderGrid({
      members: [drummer],
      cells: [{ columnId: FIRST_COLUMN_ID, rowId: KEYS_ROW, occupants: [{ memberId: "d1" }], origin: "manual" }],
    });
    const cell = container.querySelector(`[data-row-id="${KEYS_ROW}"]`)!;
    expect(cell.textContent).toContain("Ana Drums: no declara Keys — revísalo en Miembros");
    expect(cell.textContent).not.toContain("su Tipo ya no incluye");
  });

  it("does not warn on a custom instrument row outside the vocabulary", () => {
    const { container } = renderGrid({
      members: [drummer],
      rows: [...buildRows(), { id: "instrumento:Piano", label: "Piano", category: "instrumento", target: 1 }],
      cells: [{ columnId: FIRST_COLUMN_ID, rowId: "instrumento:Piano", occupants: [{ memberId: "d1" }], origin: "manual" }],
    });
    expect(container.querySelector(`[data-row-id="instrumento:Piano"]`)!.textContent).not.toContain("no declara");
  });

  it("drops an instrument «Sin cubrir» once a human fills the cell, and keeps a partial Coro's two", () => {
    const unfilled = [
      { columnId: FIRST_COLUMN_ID, rowId: KEYS_ROW },
      { columnId: FIRST_COLUMN_ID, rowId: "coro" },
      { columnId: FIRST_COLUMN_ID, rowId: "coro" },
    ];
    const { container, rerender } = renderGrid({ members: [keysPlayer], unfilled });
    expect(screen.getByText("Lugares sin cubrir (faltó gente): 3")).toBeTruthy();
    rerenderGrid(rerender, {
      members: [keysPlayer],
      unfilled,
      cells: [
        { columnId: FIRST_COLUMN_ID, rowId: KEYS_ROW, occupants: [{ memberId: "k1" }], origin: "manual" },
        { columnId: FIRST_COLUMN_ID, rowId: "coro", occupants: [{ memberId: "k1" }], origin: "manual" },
      ],
    });
    expect(screen.getByText("Lugares sin cubrir (faltó gente): 2")).toBeTruthy();
    expect(container.querySelector(`[data-row-id="${KEYS_ROW}"]`)!.textContent).not.toContain("Sin cubrir");
    expect(container.querySelector(`[data-row-id="coro"]`)!.textContent).toContain("Sin cubrir");
  });
});
```

Adapt `renderGrid`, `rerenderGrid`, `FIRST_COLUMN_ID` to the helpers that file actually exposes (read them first; if there is no rerender helper, render twice with `cleanup()` between).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/components/admin/__tests__/PlannerGrid.test.tsx -t "declared instruments"`
Expected: FAIL.

- [ ] **Step 3: Predicates and the count**

In `PlannerGrid.tsx` imports (line 117-123) add `DEFAULT_INSTRUMENT_SEATS, occupantDeclaresInstrument,` to the `./seatModel` import, and add `import { renderableUnfilled } from "./instrumentFill";`.

After `seatMismatch` (line 627) add:

```ts
  /**
   * Seated on an instrument row whose label the occupant does not DECLARE
   * (spec §7). A second question beside `seatMismatch`, with its own line, so a
   * reader can tell a stale Tipo from a missing declaration. Custom rows
   * outside the vocabulary never warn: nobody can declare them, and a warning
   * naming a remedy the member form cannot perform is the ADR-0029 defect class.
   */
  const instrumentUndeclared = (id: string, row: GridRow) => {
    if (row.category !== "instrumento" || !DEFAULT_INSTRUMENT_SEATS.includes(row.label)) return false;
    const found = membersById.get(id);
    return !!found && !occupantDeclaresInstrument(found, row.label);
  };
```

Replace the count block (lines 2068-2072) with:

```tsx
      {renderableUnfilled(unfilled, cells).length > 0 && (
        <p className="font-body text-xs text-warning-strong">
          Lugares sin cubrir (faltó gente): {renderableUnfilled(unfilled, cells).length}
        </p>
      )}
```

(Or compute `const visibleUnfilled = useMemo(() => renderableUnfilled(unfilled, cells), [unfilled, cells]);` beside `unfilledByKey` at line 646 and use it in both places; build `unfilledByKey` from `visibleUnfilled` instead of `unfilled` — then the per-cell marker is gated by construction and no change is needed in the row loop.)

- [ ] **Step 4: Thread `undeclared` to the cell view**

Follow `seatMismatch` through the props: where the row-loop component receives `seatMismatch` (lines 2398, 2420), add `instrumentUndeclared: (memberId: string, row: GridRow) => boolean;` and pass it from the grid (line 1681). In the row loop (line 2487) add `const undeclared = memberIds.filter((id) => instrumentUndeclared(id, row));` and pass `undeclared={undeclared}` to `GridCellView`. In `GridCellView` props add `/** Occupants of an instrument cell who do not declare its instrument. */ undeclared: string[];` and `const undeclaredSet = new Set(undeclared);` beside `mismatchedSet`.

At the chip aria (line ~2745) extend: `${tipoMismatch ? " (Tipo no permitido)" : ""}${undeclaredSet.has(id) ? " (instrumento no declarado)" : ""}`.

After the `mismatched.map(...)` block (line ~2849) add:

```tsx
        {/* Seated, but does not DECLARE this instrument (spec §7). Its own line,
            separate from the Tipo one: two questions, two answers. */}
        {undeclared.map((id) => (
          <p key={`instr-${id}`} className={`font-body text-[9px] text-warning-strong ${CARD_STYLE.longText}`}>
            ⚠ {memberName(id)}: no declara {row.label} — revísalo en Miembros
          </p>
        ))}
```

- [ ] **Step 5: The picker chip**

In `CandidateRow` (line ~2943), inside the chips `<div className="flex shrink-0 items-center gap-1.5">`, after the `No disp.` chip add:

```tsx
          {candidate.undeclared && (
            <span className="rounded-full border border-warning-fg/40 bg-warning-fg/10 px-1.5 py-0.5 font-label text-[10px] uppercase tracking-wide text-warning-strong">
              Sin declarar
            </span>
          )}
```

The name stays in its own `<span>` (line 2941) — four tests select members via `getByText("Beto")`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run app/components/admin/__tests__/PlannerGrid.test.tsx app/components/admin/__tests__/plannerGridDrag.test.tsx app/components/admin/__tests__/plannerGridPickPlace.test.tsx app/components/admin/__tests__/MonthGenerator.create.test.tsx`
Expected: PASS.

- [ ] **Step 7: Gates and commit**

Run: `npx tsc --noEmit && npx eslint app/components/admin/PlannerGrid.tsx`

```bash
git add app/components/admin/PlannerGrid.tsx app/components/admin/__tests__/PlannerGrid.test.tsx
git commit -m "feat(planner): declaration warning, Sin declarar chip, scoped unfilled gate

Instrument markers stop rendering once a human fills the cell; voice
markers are per slot and untouched."
```

---

### Task 8: Backfill script

**Files:**
- Create: `scripts/lib/memberInstruments.mjs`
- Create: `scripts/lib/__tests__/memberInstruments.test.mjs`
- Create: `scripts/backfill-member-instruments.mjs`

**Interfaces:**
- Produces (lib): `INSTRUMENT_SEATS`, `normalizeSeatName(raw)`, `proposeInstruments(members, roles)` → `{ proposals: [{ id, name, proposed: string[], evidence: Record<string, number>, stored: string[] | undefined, action: "write" | "skip-stored" | "skip-no-history" }], noTipo: [{ id, name, seen: string[] }], unrecognised: [{ label, count }] }`.

- [ ] **Step 1: Write the failing lib tests**

`scripts/lib/__tests__/memberInstruments.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { INSTRUMENT_SEATS, normalizeSeatName, proposeInstruments } from "../memberInstruments.mjs";

const member = (id, name, memberType, instruments) => ({ _id: id, member_name: name, memberType, instruments });
const role = (seats) => ({ instruments: seats.map(([instrument, ref]) => ({ instrument, person: ref ? { _ref: ref } : null })) });

describe("normalizeSeatName (mirror of seatModel.ts)", () => {
  it("collapses case and whitespace onto the canonical five", () => {
    expect(normalizeSeatName(" keys")).toBe("Keys");
    expect(normalizeSeatName("DRUMS")).toBe("Drums");
    expect(normalizeSeatName("eg")).toBe("EG");
    expect(normalizeSeatName("Piano")).toBe("Piano"); // unknown keeps its casing
  });
  it("mirrors DEFAULT_INSTRUMENT_SEATS", () => {
    expect(INSTRUMENT_SEATS).toEqual(["Bass", "Keys", "Drums", "EG", "AG"]);
  });
});

describe("proposeInstruments", () => {
  const members = [
    member("a", "Ana", ["instrumento"], undefined),
    member("b", "Beto", ["instrumento"], ["Keys"]),
    member("c", "Carla", ["instrumento"], undefined),
    member("d", "Dora", ["voz"], undefined),
  ];
  const roles = [
    role([["keys", "a"], ["Drums", "a"], ["Piano", "a"]]),
    role([["Keys", "b"], ["Bass", "d"]]),
    role([["Drums", "a"], [" drums ", null]]),
  ];

  it("groups by person, normalizes, counts evidence, and restricts to the closed list", () => {
    const { proposals } = proposeInstruments(members, roles);
    const ana = proposals.find((p) => p.id === "a");
    expect(ana.proposed).toEqual(["Keys", "Drums"]);
    expect(ana.evidence).toEqual({ Keys: 1, Drums: 2 });
    expect(ana.action).toBe("write");
  });

  it("never touches a member with a stored value", () => {
    const { proposals } = proposeInstruments(members, roles);
    expect(proposals.find((p) => p.id === "b").action).toBe("skip-stored");
  });

  it("skips a Tipo-instrumento member with no history rather than writing []", () => {
    const { proposals } = proposeInstruments(members, roles);
    expect(proposals.find((p) => p.id === "c").action).toBe("skip-no-history");
  });

  it("lists members who held seats without the Tipo separately, and unknown labels", () => {
    const { noTipo, unrecognised } = proposeInstruments(members, roles);
    expect(noTipo).toEqual([{ id: "d", name: "Dora", seen: ["Bass"] }]);
    expect(unrecognised).toEqual([{ label: "Piano", count: 1 }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/lib/__tests__/memberInstruments.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the lib**

`scripts/lib/memberInstruments.mjs`:

```js
// Pure half of scripts/backfill-member-instruments.mjs (spec 2026-09-09 §5).
// A .mjs script cannot import the TS seat model, so the vocabulary and the
// normalizer are MIRRORED here; scripts/lib/__tests__/memberInstruments.test.mjs
// pins them to app/components/admin/seatModel.ts.

export const INSTRUMENT_SEATS = ["Bass", "Keys", "Drums", "EG", "AG"];

const CANONICAL = new Map([
  ["bass", "Bass"], ["keys", "Keys"], ["drums", "Drums"], ["eg", "EG"], ["ag", "AG"], ["console", "Console"],
]);

export function normalizeSeatName(raw) {
  const trimmed = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return CANONICAL.get(trimmed.toLowerCase()) ?? trimmed;
}

/**
 * members: [{ _id, member_name, memberType?, instruments? }]
 * roles:   [{ instruments?: [{ instrument, person?: { _ref } | null }] }]
 */
export function proposeInstruments(members, roles) {
  const evidenceById = new Map(); // id -> Map(label -> count)
  const unknownCounts = new Map();
  for (const r of roles) {
    for (const slot of r.instruments ?? []) {
      const ref = slot?.person?._ref;
      if (!ref) continue;
      const label = normalizeSeatName(slot.instrument);
      if (!label) continue;
      if (!INSTRUMENT_SEATS.includes(label)) {
        unknownCounts.set(label, (unknownCounts.get(label) ?? 0) + 1);
        continue;
      }
      let m = evidenceById.get(ref);
      if (!m) evidenceById.set(ref, (m = new Map()));
      m.set(label, (m.get(label) ?? 0) + 1);
    }
  }

  const proposals = [];
  const noTipo = [];
  for (const member of members) {
    const evidence = evidenceById.get(member._id);
    const seen = evidence ? INSTRUMENT_SEATS.filter((s) => evidence.has(s)) : [];
    const hasTipo = (member.memberType ?? []).includes("instrumento");
    if (!hasTipo) {
      if (seen.length) noTipo.push({ id: member._id, name: member.member_name, seen });
      continue;
    }
    const stored = Array.isArray(member.instruments) ? member.instruments : undefined;
    const action = stored !== undefined ? "skip-stored" : seen.length === 0 ? "skip-no-history" : "write";
    proposals.push({
      id: member._id,
      name: member.member_name,
      proposed: seen,
      evidence: Object.fromEntries(seen.map((s) => [s, evidence.get(s)])),
      stored,
      action,
    });
  }
  const unrecognised = [...unknownCounts].map(([label, count]) => ({ label, count }));
  return { proposals, noTipo, unrecognised };
}
```

- [ ] **Step 4: Run the lib tests**

Run: `npx vitest run scripts/lib/__tests__/memberInstruments.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the script**

`scripts/backfill-member-instruments.mjs`:

```js
// One-off: derive each instrumentalist's declared instruments from the seats
// they have actually held (spec 2026-09-09-member-instruments-auto-fill §5).
//
// Safety: dry-run by default. `--apply` needs Frank's explicit consent on the
// dry-run output. Writes ONLY to members with Tipo `instrumento` and NO stored
// `instruments` field (setIfMissing — never overwrites, not even `[]`), each
// patch revision-guarded, every touched document backed up first. Only names
// in the closed vocabulary are written; anything else is listed for a human.
//
//   node --env-file=.env.local scripts/backfill-member-instruments.mjs
//   node --env-file=.env.local scripts/backfill-member-instruments.mjs --apply
import { createClient } from "next-sanity";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { proposeInstruments } from "./lib/memberInstruments.mjs";

const KNOWN_FLAGS = new Set(["--apply"]);
const argv = process.argv.slice(2);
for (const a of argv) {
  if (!KNOWN_FLAGS.has(a)) {
    console.error(`Unknown flag "${a}". Refusing — a typo must never read as a dry run.`);
    process.exit(1);
  }
}
const apply = argv.includes("--apply");
const BACKUP_DIR = process.env.SR_BACKFILL_BACKUP_DIR || ".backfill-backups";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-07-23";
const readToken = process.env.SANITY_API_READ_TOKEN;
const writeToken = process.env.SANITY_WRITE_TOKEN;
if (!projectId || !dataset) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_DATASET.");
  process.exit(1);
}

const reader = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "published", token: readToken });

console.log(`backfill-member-instruments`);
console.log(`  project: ${projectId}\n  dataset: ${dataset}`);
console.log(`  mode:    ${apply ? "APPLY (will write)" : "DRY-RUN (no write)"}\n`);

const members = await reader.fetch(`*[_type == "teamMembers"]{ _id, _rev, member_name, memberType, instruments }`);
const roles = await reader.fetch(
  `*[_type in ["sunday_role","saturday_role","special_role"]]{ instruments[]{ instrument, person } }`,
);
const { proposals, noTipo, unrecognised } = proposeInstruments(members, roles);

const writes = proposals.filter((p) => p.action === "write");
console.log(`  Miembros con Tipo instrumento: ${proposals.length}`);
for (const p of proposals) {
  const ev = Object.entries(p.evidence).map(([k, v]) => `${k}×${v}`).join(", ") || "—";
  const tag = p.action === "write" ? "+" : "=";
  const why = p.action === "skip-stored" ? `ya tiene [${p.stored.join(", ")}] — no se toca`
    : p.action === "skip-no-history" ? "sin historial — no se escribe" : `escribe [${p.proposed.join(", ")}]`;
  console.log(`  ${tag} ${p.name} (${p.id}): ${why}   evidencia: ${ev}`);
}
if (noTipo.length) {
  console.log(`\n  Tocaron pero NO tienen Tipo instrumento (no se escribe; corrige el Tipo primero si aplica):`);
  for (const n of noTipo) console.log(`    · ${n.name}: ${n.seen.join(", ")}`);
}
if (unrecognised.length) {
  console.log(`\n  Etiquetas NO reconocidas en el historial (no se escriben; mapea a mano):`);
  for (const u of unrecognised) console.log(`    · "${u.label}" ×${u.count}`);
}

if (!writes.length) { console.log(`\nNothing to write.`); process.exit(0); }
if (!apply) {
  console.log(`\nDRY-RUN complete — no write was made. ${writes.length} member(s) would be patched.`);
  console.log(`Re-run with --apply (requires explicit consent) to write.`);
  process.exit(0);
}
if (!writeToken) { console.error("\nSANITY_WRITE_TOKEN is not set — cannot write."); process.exit(1); }

mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(BACKUP_DIR, `${stamp}-member-instruments.json`);
writeFileSync(backupPath, JSON.stringify(members.filter((m) => writes.some((w) => w.id === m._id)), null, 2));
console.log(`\n  backup:  ${writes.length} document(s) -> ${backupPath}`);

const writer = createClient({ projectId, dataset, apiVersion, useCdn: false, token: writeToken });
let tx = writer.transaction();
for (const w of writes) {
  const rev = members.find((m) => m._id === w.id)._rev;
  tx = tx.patch(w.id, (patch) => patch.ifRevisionId(rev).setIfMissing({ instruments: w.proposed }));
}
try {
  await tx.commit();
} catch (err) {
  console.error(`\n  COMMIT FAILED: ${err.message}\n  Nothing was written (the transaction is atomic). Re-run the dry run to refetch revisions.`);
  process.exit(1);
}
const after = await reader.fetch(`*[_id in $ids]{ _id, member_name, instruments }`, { ids: writes.map((w) => w.id) });
console.log(`\n  Written:`);
for (const a of after) console.log(`    ✓ ${a.member_name}: [${(a.instruments ?? []).join(", ")}]`);
```

- [ ] **Step 6: Dry-run against production (read-only) and commit the script**

Run: `node --env-file=.env.local scripts/backfill-member-instruments.mjs`
Expected: a table, `DRY-RUN complete — no write was made.` Paste the output into the PR description. **Do not run `--apply`**; that is Frank's call after reading the table (spec §5 sequencing: before the preview push).

```bash
git add scripts/lib/memberInstruments.mjs scripts/lib/__tests__/memberInstruments.test.mjs scripts/backfill-member-instruments.mjs
git commit -m "feat(scripts): backfill member instruments from seat history (dry-run first)

setIfMissing + ifRevisionId per member, backup before writing, closed
vocabulary only; members with no history are skipped, not written []."
```

---

### Task 9: Documentation and gates

**Files:**
- Modify: `docs/DATA_MODEL.md:80` (row after `memberType`)
- Modify: `docs/SOLVER_AND_INFRA.md` (new subsection after the local-filler material in §1 or §6; `### History / backfill` at :242; `### scripts/lib/` at :260)
- Modify: `docs/adr/0029-tipo-is-the-only-worship-eligibility-axis.md` (append a section)

- [ ] **Step 1: `docs/DATA_MODEL.md`**

After the `memberType` row (line 80) add:

```md
| `instruments` | array of string | Declared instrument seats, closed to `DEFAULT_INSTRUMENT_SEATS` (`Bass`, `Keys`, `Drums`, `EG`, `AG`). **Absent or `[]` = declares nothing**: the instrument filler never seats them; the planner still lists them «sin declarar». A refinement of the `instrumento` Tipo, not a second axis (ADR-0029). Hidden in Studio unless Tipo has `instrumento`. Seeded once from seat history by `scripts/backfill-member-instruments.mjs`. |
```

- [ ] **Step 2: `docs/SOLVER_AND_INFRA.md`**

Under §1, after the solver invariants (find the paragraph mentioning `localFill.ts` or ADR-0010; if none, add after `### Invocation from Next.js`), add:

```md
### Instrument seats are filled locally, not by the solver
`app/components/admin/instrumentFill.ts` runs inside «Generar mes» on every exit (like the
specials filler, `localFill.ts`). It seats only EMPTY `instrumento:` cells on weekend columns,
through `rankCandidates` per placement (Tipo, availability, same-category block), among
members who DECLARE the instrument (`teamMembers.instruments`). Ordering: fewest instrument
seats this month **per member, all instruments** → did not play the previous weekend
service → name. Guarantee: per-member total balance in the month; for instruments whose
players declare only that instrument this is the «difference ≤ 1» rule. A two-instrument
member is balanced as a person, not per instrument (confirmed 2026-09-09). Its own previous
`origin: "auto"` picks are vacated once, before counting; manual picks are never touched.
Rows nobody declares are skipped with no marker; custom planner rows are outside the
vocabulary and never filled. Spec: `docs/superpowers/specs/2026-09-09-member-instruments-auto-fill-design.md`.
```

Under `### History / backfill` (line 242) add:

```md
- `backfill-member-instruments.mjs` — one-shot, dry-run by default, `--apply` with consent:
  derives `teamMembers.instruments` from held `instruments[]` seats. `setIfMissing` +
  `ifRevisionId`, backup to `.backfill-backups/`, closed vocabulary only. Ran once on
  production on <date> (fill in after the apply).
```

Under `### scripts/lib/` add `memberInstruments.mjs` to the list with "(pure grouping/normalization for the instruments backfill; mirrors `seatModel.ts`'s vocabulary, pinned by test)".

- [ ] **Step 3: ADR-0029 refinement paragraph**

Append to `docs/adr/0029-tipo-is-the-only-worship-eligibility-axis.md`:

```md
## Refinements (2026-09-09)

**`teamMembers.instruments` narrows the `instrumento` Tipo for instrument seats only.** It
is not a second eligibility axis: a member with no `instrumento` Tipo is eligible for
nothing regardless of the field, and a member with the Tipo but no declaration is still
LISTED by the picker (sorted after declared players, flagged «sin declarar», never blocked)
— only the automatic filler refuses to seat them. It is read in exactly three places:
`rankCandidates` (the `undeclared` flag, which the filler also uses for its per-row declarer
count), `occupantDeclaresInstrument` (the planner's second amber line), and the backfill
script. Adding a fourth reader means restating the rule, which is how the retirement axis
drifted. Spec: `docs/superpowers/specs/2026-09-09-member-instruments-auto-fill-design.md`.
```

- [ ] **Step 4: Run the three gates on the final tree**

```bash
npx tsc --noEmit && npm test && npx eslint .
```

Expected: tsc clean; vitest all green (record the count); eslint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add docs/DATA_MODEL.md docs/SOLVER_AND_INFRA.md docs/adr/0029-tipo-is-the-only-worship-eligibility-axis.md
git commit -m "docs: declared instruments field, local instrument filler, backfill script"
```

---

### Task 10: Studio schema deploy and release (coordinator, after the fresh code review)

Not a subagent task. After Tasks 1-9 and the **fresh code review of the merge range** (CLAUDE.md order: implement → gates → code review → fix → re-verify → merge):

1. Deploy the Studio schema: `npx sanity schema deploy` (verify with `npx sanity schema list` that `teamMembers` shows `instruments`).
2. Show Frank the dry-run table from Task 8 step 6; on his explicit consent run `node --env-file=.env.local scripts/backfill-member-instruments.mjs --apply`; fill the date into `docs/SOLVER_AND_INFRA.md`.
3. Merge into `preview`, push, verify the dev alias by `alias` + `githubCommitSha` (deploy-verifier), human-eyes on the member form and a generated month.
4. PR to `main`, wait for `gates`, merge, verify the production alias the same way.
5. Worklog entries for every dispatch; `finish-cycle`.

---

## Self-review

**Spec coverage.** §4.1 schema → Task 1. §4.2 write boundary → Task 3. §4.3 reads (`members/route.ts` GET, `RankMember`, `MemberOption`) → Tasks 2, 3. §4.4 form, create/edit, chips → Task 4. §5 backfill (lib, script, closed list, skip-no-history, backup, `setIfMissing`/`ifRevisionId`, sequencing) → Tasks 8, 10. §6.1-6.2 filler (vacate-first, thinnest-first then rows order, `rankCandidates` per placement, `eligible && !undeclared`, ordering, one marker per empty seat with declarers, zero-declarer skip, custom rows) → Task 5. §6.3 insertion, failure filter, scoped render gate → Tasks 6, 7. §7 `undeclared` flag/sort/comment, «Sin declarar» chip in its own element, second amber line + aria, custom rows silent, `moveGate` unchanged → Tasks 2, 7. §8 errors (400 copy, form error line via existing `setModalError`) → Tasks 3, 4. §9 tests → each task; the §6.2 four-player trace and the partial-Coro marker are explicit cases. §10 docs → Task 9. §11 out of scope honoured. §12 post-approval items: create-path omission (Task 4), known-name predicate (Tasks 1, 3), declarer count via `rankCandidates` (Task 5), origin promotion corollary (comment in Task 5's `withAutoCell` reuse — localFill's existing comment already states a cell with a manual pick receiving an auto one becomes auto; the reverse promotion is `withUpdatedCell`'s, unchanged), «sin declarar» own element (Task 7), citations (n/a to code).

**Placeholder scan.** One deliberate blank: the backfill run date in Task 9 step 2, filled at Task 10 step 2. No "TBD"/"add validation" steps.

**Type consistency.** `undeclared: boolean` on `RankedCandidate` (Task 2) is what Tasks 5 and 7 read. `fillInstruments`/`renderableUnfilled`/`isInstrumentRowId` names match between Task 5 (definition), Task 6 and Task 7 (use). `parseMemberInstruments` is defined in Task 3 and used only there. `occupantDeclaresInstrument(member, label)` and `isKnownInstrument(label)` match between Tasks 1, 2, 5, 7. `withAutoCell(cells, columnId, rowId, memberIds)` signature is localFill's existing one. `MemberFormData.instruments?` (Task 4) flows to `handleAdd` (Task 4) and the POST body (Task 3).
