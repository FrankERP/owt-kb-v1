# Kids Scheduling P2 — Kids Vertical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Oasis Kids scheduling vertical: pair roster, per-Sunday schedules, deterministic rotation with fairness and warnings, `/kids` member view, `/kids/admin` planner, availability override.

**Architecture:** Two Kids-specific Sanity types (`kidsPair`, `kidsSchedule` with deterministic `_id` per Sunday); pure rotation functions in `app/utils/kidsRotation.ts`; `/api/kids/*` route handlers guarded by `requireMinistryManager("kids")` (from P1); member view reads `published != false` server-side with `requireMinistryMember("kids")`.

**Tech Stack:** Next.js 16 App Router, Sanity (`serverClient`/`writeClient`/`operationalClient`), vitest, Tailwind + existing token system, `useTransientValue` for toasts.

**Spec:** `docs/superpowers/specs/2026-08-19-kids-ministry-scheduling-design.md` (§1–2, §4, §6–9)

**RISK TIER: STANDARD** — no adversarial plan review (retiered 2026-08-19). Pipeline: this plan → implement → gates → fresh code review of the diff. **Depends on P1** (`2026-08-19-kids-scheduling-p1-ministry-auth.md`): guards and `ministries` fields must exist first. P1+P2 merge to `main` together.

## Global Constraints

- Spanish UI copy, both themes, colour via tokens/`themeColour` only (no string-built colours).
- Dates are Sanity `date` strings `YYYY-MM-DD`; render pinned to local noon; server "today" via `toLocaleDateString("sv", { timeZone: "America/Mexico_City" })`.
- Arrays of objects carry `_key` per item (`kidsPair.members` refs).
- Member-facing reads filter `published != false`.
- Mutation routes call `revalidateKidsViews()` (Task 3).
- Client mutation handlers: try/catch/finally, check `res.ok`, reset loading, never close-as-success on failure; auto-dismissing feedback via `useTransientValue`.
- Kids rules (spec §1): 4 seats per Sunday — `ensenanza` (pool: all active pairs), `chiquitos`/`medianos`/`grandes` (pool: that room's active pairs); a pair holds max one seat per Sunday; pair unavailable if either member is; fairness = least-recently-served per seat category; unfillable seats stay empty with a diagnostic; worship overlap warns, never blocks.
- Gates before done: `npx tsc --noEmit`, `npm test`, `npx eslint .` 0 errors.

---

### Task 1: `kidsPair` and `kidsSchedule` schemas

**Files:**
- Create: `sanity/schemas/kidsPair.ts`, `sanity/schemas/kidsSchedule.ts`
- Modify: `sanity/schema.ts` (import both, append to `types`)

**Interfaces:**
- Produces: document types `kidsPair` (`name: string`, `members: reference[]` ×2 with `_key`, `room: "chiquitos"|"medianos"|"grandes"`, `active: boolean` default true) and `kidsSchedule` (`date: date`, seat references `ensenanza`/`chiquitos`/`medianos`/`grandes` → `kidsPair`, `published: boolean` default false). `kidsSchedule._id` convention: `kidsSchedule-<YYYY-MM-DD>` (enforced by the write route, Task 5).

- [ ] **Step 1: Implement `kidsPair`**

```ts
// sanity/schemas/kidsPair.ts
import { defineType } from "sanity";

/**
 * Oasis Kids scheduling unit: a fixed PAIR of people bound to one age room.
 * Written by the app (/api/kids/pairs), not authored in Studio — same posture
 * as the worship coordination types. Rooms and rules: spec
 * docs/superpowers/specs/2026-08-19-kids-ministry-scheduling-design.md §1, §4.2.
 */
export const kidsPair = defineType({
  name: "kidsPair",
  title: "Kids — Pareja",
  type: "document",
  fields: [
    { name: "name", title: "Nombre", type: "string", validation: (r: any) => r.required() },
    {
      name: "members",
      title: "Integrantes",
      type: "array",
      of: [{ type: "reference", to: [{ type: "teamMembers" }] }],
      validation: (r: any) => r.required().length(2),
    },
    {
      name: "room",
      title: "Sala",
      type: "string",
      options: {
        list: [
          { title: "Reunión General Chiquitos", value: "chiquitos" },
          { title: "Reunión General Medianos", value: "medianos" },
          { title: "Reunión General Grandes", value: "grandes" },
        ],
        layout: "radio",
      },
      validation: (r: any) => r.required(),
    },
    {
      name: "active",
      title: "Activa",
      type: "boolean",
      initialValue: true,
      description: "Las parejas retiradas conservan su historial pero salen de todas las rotaciones.",
    },
  ],
  preview: { select: { title: "name", subtitle: "room" } },
});
```

- [ ] **Step 2: Implement `kidsSchedule`**

```ts
// sanity/schemas/kidsSchedule.ts
import { defineType } from "sanity";

const pairRef = (name: string, title: string) => ({
  name,
  title,
  type: "reference" as const,
  to: [{ type: "kidsPair" as const }],
});

/**
 * One document per Sunday, at the DETERMINISTIC id `kidsSchedule-<YYYY-MM-DD>`
 * (minted by /api/kids/schedules): a regenerate updates in place and two
 * concurrent saves cannot fork the same Sunday. Draft until published —
 * member-facing reads filter `published != false` (repo convention).
 * A seat may be empty: unfillable weeks stay honest (spec §7.6).
 */
export const kidsSchedule = defineType({
  name: "kidsSchedule",
  title: "Kids — Rol del domingo",
  type: "document",
  fields: [
    { name: "date", title: "Domingo", type: "date", validation: (r: any) => r.required() },
    pairRef("ensenanza", "Enseñanza"),
    pairRef("chiquitos", "RG Chiquitos"),
    pairRef("medianos", "RG Medianos"),
    pairRef("grandes", "RG Grandes"),
    { name: "published", title: "Publicado", type: "boolean", initialValue: false },
  ],
  preview: { select: { title: "date" } },
});
```

- [ ] **Step 3: Register both** in `sanity/schema.ts` (`import { kidsPair } from './schemas/kidsPair';` etc., append to the `types` array).
- [ ] **Step 4: Gates** — `npx tsc --noEmit && npm test`.
- [ ] **Step 5: Commit** — `feat(kids): kidsPair + kidsSchedule schema types`. Schema deploy happens with P1 Task 2's deploy, in one Studio deploy after release.

---

### Task 2: Shared Kids domain types

**Files:**
- Create: `app/utils/kidsTypes.ts`

**Interfaces:**
- Produces (imported by Tasks 3–7):

```ts
// app/utils/kidsTypes.ts
export type KidsRoom = "chiquitos" | "medianos" | "grandes";
export type KidsSeat = "ensenanza" | KidsRoom;
export const KIDS_ROOMS: KidsRoom[] = ["chiquitos", "medianos", "grandes"];
export const KIDS_SEATS: KidsSeat[] = ["ensenanza", "chiquitos", "medianos", "grandes"];
export const KIDS_SEAT_LABELS: Record<KidsSeat, string> = {
  ensenanza: "Enseñanza",
  chiquitos: "RG Chiquitos",
  medianos: "RG Medianos",
  grandes: "RG Grandes",
};

export interface RotationPair {
  id: string;                 // kidsPair._id
  name: string;
  room: KidsRoom;
  memberIds: [string, string];
}

/** One Sunday's assignment: pair id per seat; a missing key = empty seat. */
export interface KidsAssignment {
  date: string;                              // YYYY-MM-DD
  seats: Partial<Record<KidsSeat, string>>;  // seat -> kidsPair._id
}

export interface RotationWarning {
  date: string;
  seat: KidsSeat;
  pairId: string;
  memberId: string;
  kind: "worship-overlap";
}

export interface RotationDiagnostic {
  date: string;
  seat: KidsSeat;
  kind: "unfillable";
  reason: string; // Spanish, shown verbatim in the planner
}

export interface RotationInput {
  sundays: string[];                          // ascending YYYY-MM-DD
  pairs: RotationPair[];                      // ACTIVE pairs only
  unavailable: Record<string, string[]>;      // memberId -> ISO dates
  history: KidsAssignment[];                  // prior assignments, ascending by date
  worshipAssignments?: Record<string, string[]>; // date -> memberIds serving worship
}

export interface RotationResult {
  proposal: KidsAssignment[];
  warnings: RotationWarning[];
  diagnostics: RotationDiagnostic[];
}
```

- [ ] **Step 1: Create the file exactly as above.** No test (pure declarations); Task 3's tests exercise it.
- [ ] **Step 2: Commit** — `feat(kids): shared kids domain types`

---

### Task 3: Rotation engine (pure, deterministic)

**Files:**
- Create: `app/utils/kidsRotation.ts`
- Test: `app/utils/__tests__/kidsRotation.test.ts`

**Interfaces:**
- Consumes: everything in `kidsTypes.ts`.
- Produces: `planKidsMonth(input: RotationInput): RotationResult` and helper `pairUnavailable(pair: RotationPair, date: string, unavailable: Record<string, string[]>): boolean` (also used by the planner UI to grey out dropdown options).

**Algorithm (implement exactly):** Seed `lastServed: Map<category, Map<pairId, date>>` from `history` in array order, where category is `"ensenanza"` for the ensenanza seat and `room:<room>` for room seats. For each Sunday ascending, fill seats in the fixed order `ensenanza, chiquitos, medianos, grandes`:
1. Pool: ensenanza → all pairs; room seat → pairs of that room.
2. Filter out pairs already seated this Sunday and pairs unavailable (either member's `unavailable` list contains the date).
3. Sort by `lastServed[category].get(pairId) ?? "0000-00-00"` ascending, tie-break by `id` ascending (deterministic).
4. Pick the first; record in the assignment, update `lastServed`. Empty pool → leave the seat unset and push a diagnostic with a Spanish reason (`"Sin parejas disponibles para <label> el <date>"`).
5. After picking, if `worshipAssignments?.[date]` contains either member id, push a `worship-overlap` warning per overlapping member.

Filling `ensenanza` first is deliberate: the teaching pair comes out of its room's pool for that Sunday, and the room seat falls to the room's next pair.

- [ ] **Step 1: Write the failing tests**

```ts
// app/utils/__tests__/kidsRotation.test.ts
import { describe, it, expect } from "vitest";
import { planKidsMonth, pairUnavailable } from "../kidsRotation";
import type { RotationInput, RotationPair } from "../kidsTypes";

const P = (id: string, room: RotationPair["room"], a: string, b: string): RotationPair =>
  ({ id, name: id, room, memberIds: [a, b] });

// 12 pairs, 4 per room, mirroring the real roster shape
const pairs: RotationPair[] = [
  P("c1", "chiquitos", "m1", "m2"), P("c2", "chiquitos", "m3", "m4"),
  P("c3", "chiquitos", "m5", "m6"), P("c4", "chiquitos", "m7", "m8"),
  P("d1", "medianos", "m9", "m10"), P("d2", "medianos", "m11", "m12"),
  P("d3", "medianos", "m13", "m14"), P("d4", "medianos", "m15", "m16"),
  P("g1", "grandes", "m17", "m18"), P("g2", "grandes", "m19", "m20"),
  P("g3", "grandes", "m21", "m22"), P("g4", "grandes", "m23", "m24"),
];
const sundays = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"];
const base: RotationInput = { sundays, pairs, unavailable: {}, history: [] };

describe("planKidsMonth", () => {
  it("fills all four seats every Sunday from the correct pools", () => {
    const r = planKidsMonth(base);
    expect(r.proposal).toHaveLength(4);
    for (const a of r.proposal) {
      expect(Object.keys(a.seats).sort()).toEqual(["chiquitos", "ensenanza", "grandes", "medianos"]);
      const room = (s: "chiquitos" | "medianos" | "grandes") =>
        pairs.find(p => p.id === a.seats[s])!.room;
      expect(room("chiquitos")).toBe("chiquitos");
      expect(room("medianos")).toBe("medianos");
      expect(room("grandes")).toBe("grandes");
    }
    expect(r.diagnostics).toEqual([]);
  });

  it("never seats a pair twice on one Sunday", () => {
    const r = planKidsMonth(base);
    for (const a of r.proposal) {
      const ids = Object.values(a.seats);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("is deterministic: same input, same output", () => {
    expect(planKidsMonth(base)).toEqual(planKidsMonth(base));
  });

  it("rotates rooms least-recently-served across a month", () => {
    const r = planKidsMonth(base);
    const chiq = r.proposal.map(a => a.seats.chiquitos);
    // 4 pairs, 4 Sundays, ensenanza steals at most one per week → no repeats needed
    expect(new Set(chiq).size).toBe(4);
  });

  it("a pair is unavailable when EITHER member is", () => {
    expect(pairUnavailable(pairs[0], "2026-09-06", { m2: ["2026-09-06"] })).toBe(true);
    expect(pairUnavailable(pairs[0], "2026-09-06", { m2: ["2026-09-13"] })).toBe(false);
    const r = planKidsMonth({ ...base, unavailable: { m2: ["2026-09-06"] } });
    expect(Object.values(r.proposal[0].seats)).not.toContain("c1");
  });

  it("respects history: the pair that served most recently goes last", () => {
    const history = [{ date: "2026-08-30", seats: { chiquitos: "c1" } }];
    const r = planKidsMonth({ ...base, history });
    expect(r.proposal[0].seats.chiquitos).not.toBe("c1");
  });

  it("ensenanza cycles the full pool without repeating in 4 weeks", () => {
    const r = planKidsMonth(base);
    const ens = r.proposal.map(a => a.seats.ensenanza);
    expect(new Set(ens).size).toBe(4);
  });

  it("leaves an unfillable seat empty with a diagnostic, never mis-seats", () => {
    const allChiqOut = { m1: sundays, m3: sundays, m5: sundays, m7: sundays };
    const r = planKidsMonth({ ...base, unavailable: allChiqOut });
    const d = r.diagnostics.filter(x => x.seat === "chiquitos");
    expect(d.length).toBeGreaterThan(0);
    for (const a of r.proposal) {
      if (a.seats.chiquitos) expect(pairs.find(p => p.id === a.seats.chiquitos)!.room).toBe("chiquitos");
    }
  });

  it("warns (never blocks) on worship overlap", () => {
    const r = planKidsMonth({ ...base, worshipAssignments: { "2026-09-06": ["m1", "m2"] } });
    const first = r.proposal[0];
    expect(Object.keys(first.seats)).toHaveLength(4); // still fully seated
    if (Object.values(first.seats).includes("c1")) {
      expect(r.warnings.some(w => w.date === "2026-09-06" && w.pairId === "c1")).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)
- [ ] **Step 3: Implement `app/utils/kidsRotation.ts`** per the algorithm block above (~80 lines; no `Date` arithmetic — dates are compared as ISO strings, which sort correctly).
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `feat(kids): deterministic rotation engine with fairness, availability, diagnostics`

---

### Task 4: `revalidateKidsViews`

**Files:**
- Modify: `app/utils/revalidate.ts`

- [ ] **Step 1: Add, following the two existing exports' pattern:**

```ts
export function revalidateKidsViews() {
  revalidatePath("/kids");
  revalidatePath("/kids/admin");
  revalidatePath("/me");
}
```

- [ ] **Step 2: Gates, then commit** — `feat(kids): revalidateKidsViews util`

---

### Task 5: `/api/kids/*` routes

**Files:**
- Create: `app/api/kids/pairs/route.ts` (GET list, POST create), `app/api/kids/pairs/[id]/route.ts` (PATCH name/room/members/active), `app/api/kids/schedules/route.ts` (GET month, PUT upsert one Sunday), `app/api/kids/generate/route.ts` (POST — compute proposal, no writes), `app/api/kids/members/route.ts` (GET kids members), `app/api/kids/members/[id]/availability/route.ts` (PATCH override)
- Test: `app/api/__tests__/kidsRoutes.test.ts` (follow the repo's existing route-test mocking pattern in `app/api/__tests__/`)

**Interfaces:**
- Consumes: `requireMinistryManager("kids")` (P1), `planKidsMonth`, `revalidateKidsViews`, `writeClient`/`serverClient` from `@/sanity/lib/serverClient`, `assignedMemberRefsQuery` from `app/utils/notifyTargets.ts`.
- Produces (planner UI consumes):
  - `GET /api/kids/pairs` → `RotationPair & { active: boolean }[]`
  - `POST /api/kids/pairs` body `{ name, room, memberIds: [string, string] }`
  - `PATCH /api/kids/pairs/[id]` body: any subset of the same + `active`
  - `GET /api/kids/schedules?month=YYYY-MM` → `{ date, seats, published }[]`
  - `PUT /api/kids/schedules` body `{ date, seats: Partial<Record<KidsSeat, string>>, published?: boolean }`
  - `POST /api/kids/generate` body `{ month: "YYYY-MM" }` → `RotationResult`
  - `GET /api/kids/members` → `{ _id, member_name, alias, unavailableDates }[]` of members whose normalized `ministries` includes `"kids"`. GROQ filters `*[_type == "teamMembers" && "kids" in ministries]` — safe without a coalesce **because** absent/empty normalizes to worship-only, never to kids, so no member the helper would exclude can match. Where TypeScript re-checks membership, call P1's `normalizeMinistries`; do not restate the rule.

**Every handler starts with:**

```ts
const session = await requireMinistryManager("kids");
if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

- [ ] **Step 1: Failing tests** — per route: 403 without kids management; pairs POST writes `members` refs **each with `_key` = the member `_ref`**; schedules PUT mints `_id` as `` `kidsSchedule-${date}` `` and uses `createIfNotExists` + `patch.set` (upsert, never duplicate); PUT validates `date` against `/^\d{4}-\d{2}-\d{2}$/` and seat pair-ids exist and match the seat's room (reject cross-room seating server-side, 400); availability PATCH 404s when the target member's `ministries` does not include `"kids"`; mutating handlers call `revalidateKidsViews`.
- [ ] **Step 2: Implement.** Key fragments:

Pairs write (POST):

```ts
await writeClient.create({
  _type: "kidsPair",
  name: body.name,
  room: body.room,
  active: true,
  members: body.memberIds.map((id: string) => ({
    _type: "reference", _ref: id, _key: id,
  })),
});
revalidateKidsViews();
```

Schedule upsert (PUT):

```ts
const _id = `kidsSchedule-${body.date}`;
await writeClient.createIfNotExists({ _id, _type: "kidsSchedule", date: body.date, published: false });
const seatPatch: Record<string, unknown> = {};
const seatUnset: string[] = [];
for (const seat of KIDS_SEATS) {
  const pairId = body.seats[seat];
  if (pairId) seatPatch[seat] = { _type: "reference", _ref: pairId };
  else seatUnset.push(seat);
}
if (body.published !== undefined) seatPatch.published = body.published;
await writeClient.patch(_id).set(seatPatch).unset(seatUnset).commit();
revalidateKidsViews();
```

Generate (POST) — read-only compose: fetch active pairs, fetch kids members' `unavailableDates`, fetch prior `kidsSchedule` docs (last 16 weeks, ascending), fetch the month's worship assignments via `assignedMemberRefsQuery()` per service date, then `return NextResponse.json(planKidsMonth(input))`. Sundays of the month are computed with the UTC-noon technique already used in `app/(client)/page.tsx`'s weekend helpers.

Availability override (PATCH) — clone the validation/set logic of `app/api/me/availability/route.ts` (ISO regex filter, notes keyed by date) but: guard is `requireMinistryManager("kids")`, target id comes from the route param, and before writing:

```ts
const target = await serverClient.fetch(
  `*[_type == "teamMembers" && _id == $id][0]{ _id, ministries }`, { id }
);
// normalizeMinistries is P1's SHARED rule (app/ministries.ts) — never re-derive
// "absent means worship" here; a fourth open-coded copy is how the admin form
// came to disagree with storage.
if (!target || !normalizeMinistries(target.ministries).includes("kids")) {
  return NextResponse.json({ error: "Not a kids member" }, { status: 404 });
}
```

- [ ] **Step 3: Run tests — PASS; all three gates.**
- [ ] **Step 4: Commit** — `feat(kids): /api/kids routes (pairs, schedules, generate, availability override)`

---

### Task 6: `/kids/admin` planner page

**Files:**
- Create: `app/(client)/kids/admin/page.tsx` (server component: guard + initial data), `app/components/kids/KidsPlanner.tsx` (client), `app/components/kids/PairRoster.tsx` (client), `app/components/kids/KidsAvailabilityPanel.tsx` (client)

**Interfaces:**
- Consumes: Task 5 routes, `KIDS_SEAT_LABELS`, `pairUnavailable`, `useTransientValue`.

- [ ] **Step 1: Page guard** (server component):

```ts
const session = await requireMinistryManager("kids");
if (!session) redirect("/");
```

Fetch initial pairs + current-month schedules server-side (via `serverClient`) and pass as props.

- [ ] **Step 2: `KidsPlanner`** — month picker (default: current month in America/Mexico_City); grid of Sundays × the 4 seats using `KIDS_SEAT_LABELS`; **"Generar mes"** → `POST /api/kids/generate`, render proposal with warnings (worship overlap, amber) and diagnostics (unfillable, red) inline; per-seat `<select>` of that seat's eligible pairs (room pool for room seats, all for enseñanza; unavailable pairs disabled via `pairUnavailable`); **"Guardar borradores"** → one `PUT /api/kids/schedules` per Sunday; **"Publicar"** toggle per Sunday (PUT with `published: true`). Every mutation follows the client-handler invariant; toasts via `useTransientValue`.
- [ ] **Step 3: `PairRoster`** — list pairs grouped by room; create (name + two member selects fed by `GET /api/kids/members` — never `GET /api/admin/members`, which is worship-admin-gated); edit room; retire (`active: false`) with confirmation.
- [ ] **Step 4: `KidsAvailabilityPanel`** — per kids member, a month-calendar date multi-select writing through `PATCH /api/kids/members/[id]/availability` (self-serve `/me` stays untouched).
- [ ] **Step 5: Gates; commit** — `feat(kids): /kids/admin planner, pair roster, availability override UI`

---

### Task 7: `/kids` member view + landing

**Files:**
- Create: `app/(client)/kids/page.tsx`
- Modify: `app/(client)/me/page.tsx` (add the member's upcoming Kids assignments section when their ministries include kids)

(Nav filtering is **not** here — it belongs to P1 Task 3b, which puts `ministries` on the session and gates every menu item, worship and kids alike, in one place.)

**Interfaces:**
- Consumes: `requireMinistryMember("kids")`, `requireActiveSession`, `getMemberAccess`, published-filtered GROQ.

- [ ] **Step 1: `/kids` page** (server component). **Split the two failure cases, exactly as P1's `requireWorshipPage` does** — this is the other half of the same contract, and getting it wrong is what turns a disabled member's visit into an infinite `/` ⇄ `/kids` redirect loop:

```ts
const session = await requireActiveSession();
if (!session) redirect("/auth/signin?callbackUrl=/kids");
const kids = await requireMinistryMember("kids");
if (!kids) redirect("/");
```

A member with no active session (disabled, deleted, or tokenless) goes to sign-in and never to `/`, whose own gate would send them back here.

Query (published only, next 8 Sundays from local today):

```groq
*[_type == "kidsSchedule" && published == true && date >= $today] | order(date asc) [0...8] {
  date, published,
  "ensenanza": ensenanza->{ _id, name, "memberIds": members[]._ref },
  "chiquitos": chiquitos->{ _id, name, "memberIds": members[]._ref },
  "medianos":  medianos->{ _id, name, "memberIds": members[]._ref },
  "grandes":   grandes->{ _id, name, "memberIds": members[]._ref }
}
```

Render the schedule table (dates at local noon per the timezone invariant), highlighting rows where the signed-in member's `sanityId` appears in any seat's `memberIds` ("Te toca — <seat label>"). If the member also manages kids, show a link to `/kids/admin`.

Note the read filter uses `published == true` (stricter than `published != false`): `kidsSchedule` is a NEW type whose every document carries the field from birth, so the absent-field leniency the worship types need does not apply.

- [ ] **Step 2: `/me` addition** — server-side: `getMemberAccess(sanityId)`; if `ministries` includes `"kids"`, fetch the member's next published kids assignments (same query + a client-side filter on `memberIds`) and render a "Mis roles en Oasis Kids" card linking to `/kids`. Worship-only members see nothing new.
- [ ] **Step 3: Landing + loop regression test** — P1's worship-page gates redirect kids-only members to `/kids`. Add a test asserting (a) an active kids member reaching `/kids` is never redirected, and (b) a **disabled** member reaching `/kids` goes to `/auth/signin`, not `/` — the pair of assertions that proves the `/` ⇄ `/kids` loop cannot form from either side.
- [ ] **Step 4: Gates; commit** — `feat(kids): member-facing /kids view and /me kids card`

---

### Task 8: Docs + ADR

**Files:**
- Create: `docs/adr/0019-generalize-at-the-third-ministry.md` (follow `docs/adr/TEMPLATE.md`)
- Create: `docs/adr/0020-ministry-isolation-gates-per-page.md` (follow the same template)
- Modify: `CLAUDE.md` + `AGENTS.md` (parity!): add `/kids` + ministry guards to the auth section one-liners; `CONTEXT.md` if it indexes routes.

**⚠ The ADR numbers are already referenced in shipped code.** `app/ministries.ts:5` (P1 Task 1, commit `478f1df6`) says "see ADR-0019", and P1's Task 6 Step 7 amends ADR-0007 to point at ADR-0020. Both numbers are therefore **fixed, not suggestions** — if `docs/adr/` has meanwhile taken 0019 or 0020 for something else, do not silently renumber: update every referencing site in the same commit, or the repo ships dangling pointers. Verify with `grep -rn "ADR-001[89]\|ADR-0020" app/ docs/ sanity/` before writing.

- [ ] **Step 1: ADR-0019** — Decision: Kids ships as a Kids-specific vertical (`kidsPair`/`kidsSchedule`, own rotation) instead of generic ministry-scheduling schemas; generalization is deferred until a THIRD ministry exists so the abstraction is extracted from two real examples, not speculated from one. Alternatives rejected: generic schemas now (wrong-abstraction risk, migration cost with n=1 exemplars), separate app (roster/maintenance split). Consequences: a third ministry pays an extraction cost; until then Kids code stays boring and greppable. Link the ADR from `app/ministries.ts` (comment already references it) and from the spec.
- [ ] **Step 1b: ADR-0020 — why isolation is gated per page, not in middleware.** P1 turns seven ISR pages dynamic, including the app's hottest ones, and that cost needs a recorded reason or the next reader will "fix" it. Decision: gate in each page via `requireWorshipPage`. Rejected alternative: `proxy.ts` middleware gating, which was genuinely available once the JWT carries `ministries` at the same 30s freshness the guards use, and would have preserved ISR. Rejected because the middleware reads token claims refreshed on NextAuth's schedule rather than the per-request member snapshot the guards use, and because a matcher list is a second place for route coverage to drift — the repo already carries a byte-identical-matcher guard (`app/utils/routeMatcher.ts` + `routeMatcher.test.ts`) for exactly that reason. Consequence: `revalidate` on those seven pages no longer means what it says; note it in the ADR so nobody reads the surviving exports as live.

- [ ] **Step 2: CLAUDE.md/AGENTS.md** — in `## Auth`, add: ministry guards (`requireMinistryMember`/`requireMinistryManager`), the two-way isolation rule, and the storage contract in both halves (**absent** `ministries` ⇒ worship; **explicitly empty** ⇒ rejected at every write boundary, never stored). Keep the parity test green (`app/utils/__tests__/agentDocsParity.test.ts`).
- [ ] **Step 3: Gates; commit** — `docs(kids): ADR-0019 + auth section updates`

---

### Verification (whole delivery, P1+P2)

1. All three gates on the final tree.
2. Fresh code review of the merge range (carries docs-audit + worklog checklists per the 2026-08-19 workflow).
3. Browser pass on preview (spec §9): kids manager sees `/kids/admin`, blocked from `/admin`; worship `admin` blocked from `/kids/admin` and `/api/kids/*`; kids-only member blocked from worship pages by direct URL and lands on `/kids`; worship member sees no kids nav; super-admin reaches both; generate → override → publish → member view round-trip. **Preview writes real data and can email the real team** — keep test docs unpublished and delete them after.
4. Deploy per convention: branch → main (local) → merge into `preview`, push, verify dev alias moved → push `main`, verify prod alias.
5. Studio schema deploy (Task 1 + P1 Task 2 fields) after release; verify fields visible.
