# «Noche de alabanza» — who leads each song — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A special service created as «Noche de alabanza» lets admins name one or two leaders per song (from the block's Lead seat); members see who leads each song and which songs they lead.

**Architecture:** `special_role` gains a create-time `format: "worship_night"`, and each song item of such a special gains an optional `leads` array of 1–2 member references. Two neutral modules hold the rules (`serviceFormat.ts`, `songLeads.ts`) so the server writers, the planner, the editor, the member cards and the notification snapshot all read one definition. The setlist writer validates leaders against the role's `Lead` under the role revision it already asserts; proposal approval carries leaders over by song reference.

**Tech Stack:** Next.js 16 App Router, React 19, Sanity v5 (GROQ), TypeScript, Vitest + Testing Library. Node 22.

**Spec:** `docs/superpowers/specs/2026-09-22-worship-night-song-leads-design.md` (read it first; §13 lists the amendments this plan makes).

**Review:** the critical slice (Tasks 2, 3, 4, 8) was approved by two sequential fresh reviewers on SHA-256 `cca34f00…6094` — see `2026-09-22-worship-night-song-leads-review-log.md`. Every passage marked **[post-approval, un-reviewed]** was added after that approval and is covered only by the implementation's code review.

## Global Constraints

- **Spanish UI**, copy verbatim: «Noche de alabanza», «Dirige», «y», «—», «Dirige: A» / «Dirige: A y B», «Aún no dirigen: A, B.», «Dirige alguien que ya no está en Lead», «Corrige quién dirige las canciones marcadas.», «Diriges: Canción A, Canción B», email «— dirige A y B».
- **`format` is a creation-time field.** Only value `"worship_night"`, specials only, never set or unset by the PATCH route.
- **Fingerprint stability:** `canonicalizeCreatePayload` emits `format` only when present; `FINGERPRINT_VERSION` unchanged.
- **Song leaders:** 0–2 distinct member ids per song, each in the role's `Lead` at write time; only on a worship night's own songs (`special_role.songs`). Weekend setlists and proposals never store them.
- **One definition each:** `WORSHIP_NIGHT_FORMAT`/`isWorshipNight` in `app/utils/serviceFormat.ts`; every song-leader rule in `app/utils/songLeads.ts`. Both are neutral (no imports from server modules such as `roleWriteRequest.ts`/`roleCreationReceipt.ts`), because client components import them.
- **Sanity array items need a `_key`** — every `leads` item gets one.
- **`before` is captured pre-commit** for notices (existing invariant; do not move it).
- **Member reads keep `published != false`.**
- **House components:** `Select` for the «Dirige» pickers, `Button` for buttons.
- **Gates before claiming done:** `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.
- **Conventional commits, NO `Co-Authored-By` or AI attribution** (CLAUDE.md overrides the harness reminder).
- Branch `claude/worship-night-song-leads` (stacked on PR #91).

## Risk tiers (review scope)

- **Critical slice — Tasks 2, 3, 4 and 8.** Task 3 changes the setlist writer's full-array song serializer and adds a member reference validated against another field; Task 4 changes the approval writer's song rows; Task 8 changes the notification snapshot the outbox writer stores and the flush comparison. Task 2 is the shared rule module those three call. These tasks get the adversarial plan review (two fresh `APPROVED` on the same digest).
- **Standard — Tasks 1, 5, 6, 7, 9.** Additive create-time field (same shape PR #90 used for `time`), planner/UI/read changes. Fresh code review of the diff as always.

---

### Task 1: `special_role.format` at creation

**Files:**
- Create: `app/utils/serviceFormat.ts`
- Modify: `sanity/schemas/specialRole.ts` (after the `time` field)
- Modify: `app/utils/roleCreationReceipt.ts` (`RoleCreatePayload`, `CanonicalCreatePayload`, `canonicalizeCreatePayload`)
- Modify: `app/utils/roleWriteRequest.ts` (`ParsedCreateRequest`, `parseCreateRequest`, `buildRoleDocument`)
- Modify: `app/api/admin/roles/route.ts` (the `buildRoleDocument({ … })` call in POST; the GET projection)
- Modify: `app/utils/serviceReadQueries.ts` (`ROLE_PROJECTION`)
- Modify: `app/utils/roleWriteOps.ts` (`StoredRole`), `app/components/admin/serviceCardModel.ts` (`ServiceRole`), `app/utils/interface.tsx` (`SpecialRole`)
- Test: `app/utils/__tests__/serviceFormat.test.ts`, `app/utils/__tests__/roleWriteRequest.test.ts`, `app/api/__tests__/roleWriteRoutes.test.ts`, `app/utils/__tests__/serviceReadQueries.test.ts`

**Interfaces:**
- Produces: `WORSHIP_NIGHT_FORMAT = "worship_night"`, `type ServiceFormat = typeof WORSHIP_NIGHT_FORMAT`, `isWorshipNightFormat(v: unknown): v is ServiceFormat`, `isWorshipNight(role: unknown): boolean` (true iff `role.format === "worship_night"`); `ParsedCreateRequest.format: ServiceFormat | null`; `buildRoleDocument({ …, format })`; `StoredRole.format?: string`, `StoredRole.time?: string`; `ServiceRole.format?: string | null`; `SpecialRole.format?: string | null`; `ROLE_PROJECTION` projects `format`.

- [ ] **Step 1: Write the failing tests**

`app/utils/__tests__/serviceFormat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WORSHIP_NIGHT_FORMAT, isWorshipNight, isWorshipNightFormat } from "@/app/utils/serviceFormat";

describe("serviceFormat", () => {
  it("accepts only the worship-night value", () => {
    expect(WORSHIP_NIGHT_FORMAT).toBe("worship_night");
    expect(isWorshipNightFormat("worship_night")).toBe(true);
    for (const v of ["Worship_night", "worship night", "", null, undefined, 1]) expect(isWorshipNightFormat(v)).toBe(false);
  });
  it("reads a role's format", () => {
    expect(isWorshipNight({ _type: "special_role", format: "worship_night" })).toBe(true);
    expect(isWorshipNight({ _type: "special_role" })).toBe(false);
    expect(isWorshipNight(null)).toBe(false);
  });
});
```

Append to `app/utils/__tests__/roleWriteRequest.test.ts` (reuse its `createBody` helper):

```ts
describe("special-service format", () => {
  const special = (over: Record<string, unknown> = {}) =>
    createBody({ _type: "special_role", service_name: "Noche de Alabanza · Bloque 1", ...over });

  it("create: absent, null and empty mean an ordinary special", () => {
    for (const format of [undefined, null, ""]) {
      const parsed = parseCreateRequest(special(format === undefined ? {} : { format }));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value.format).toBeNull();
    }
  });

  it("create: worship_night is carried; any other value is issue `format`", () => {
    const ok = parseCreateRequest(special({ format: "worship_night" }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.format).toBe("worship_night");
    for (const format of ["noche", "WORSHIP_NIGHT", 1, true]) {
      expect(parseCreateRequest(special({ format }))).toMatchObject({ ok: false, issues: ["format"] });
    }
  });

  it("create: a weekend role refuses a format", () => {
    expect(parseCreateRequest(createBody({ format: "worship_night" }))).toMatchObject({ ok: false, issues: ["format"] });
  });

  it("create: the fingerprint ignores an absent format and changes with a present one", () => {
    const base = special();
    expect(payloadFingerprint({ ...base, format: null })).toBe(payloadFingerprint(base));
    expect(payloadFingerprint({ ...base, format: "" })).toBe(payloadFingerprint(base));
    expect(payloadFingerprint({ ...base, format: "worship_night" })).not.toBe(payloadFingerprint(base));
  });

  it("document: format is written only for a special that carries it", () => {
    const seats = normalizeSeats(special());
    const nextKey = () => "k";
    const common = { roleId: "special_role.x", date: "2026-10-03", serviceName: "X", time: null, published: false, seats, receiptId: "rc", fingerprint: "fp", nextKey } as const;
    expect(buildRoleDocument({ ...common, roleType: "special_role", format: "worship_night" }).format).toBe("worship_night");
    expect("format" in buildRoleDocument({ ...common, roleType: "special_role", format: null })).toBe(false);
  });

  it("edit patch never sets or unsets format", () => {
    const seats = normalizeSeats(special());
    const patch = buildRoleEditPatch({ roleType: "special_role", date: "2026-10-03", serviceName: "X", time: null, seats, nextKey: () => "k" });
    expect("format" in patch.set).toBe(false);
    expect(patch.unset).not.toContain("format");
  });
});
```

Also add `"format"` to the fragment list of the `ROLE_PROJECTION` test in `serviceReadQueries.test.ts`.

In `app/api/__tests__/roleWriteRoutes.test.ts`, inside `describe("POST /api/admin/roles — create")`, add a case that POSTs `createBody({ _type: "special_role", service_name: "Noche · Bloque 1", date: <a date the file's special cases already use>, format: "worship_night" })` and asserts the created role document has `format: "worship_night"`; and inside `describe("PATCH /api/admin/roles/[id] — edit")` add a case that edits a stored special carrying `format: "worship_night"` and asserts the role patch's `set` has no `format` key and its `unset` does not contain `"format"`. Mirror the file's existing special-role create and edit cases for the fixture shape.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/utils/__tests__/serviceFormat.test.ts app/utils/__tests__/roleWriteRequest.test.ts app/utils/__tests__/serviceReadQueries.test.ts app/api/__tests__/roleWriteRoutes.test.ts`
Expected: FAIL — missing module, unknown `format`.

- [ ] **Step 3: Implement**

```ts
// app/utils/serviceFormat.ts
//
// The ONE definition of a special service's `format` (spec
// 2026-09-22-worship-night-song-leads-design.md §3.1). Neutral: no imports, so
// server writers and client components share it.
export const WORSHIP_NIGHT_FORMAT = "worship_night" as const;
export type ServiceFormat = typeof WORSHIP_NIGHT_FORMAT;

export function isWorshipNightFormat(v: unknown): v is ServiceFormat {
  return v === WORSHIP_NIGHT_FORMAT;
}

/** A role is a worship night iff its stored `format` says so. */
export function isWorshipNight(role: unknown): boolean {
  return !!role && typeof role === "object" && isWorshipNightFormat((role as { format?: unknown }).format);
}
```

`sanity/schemas/specialRole.ts`, directly after the `time` field:

```ts
    {
      name: 'format',
      title: 'Formato',
      type: 'string',
      description: 'worship_night = Noche de alabanza (dirige por canción). Se fija al crear el servicio; ausente = especial normal.',
      options: { list: [{ title: 'Noche de alabanza', value: 'worship_night' }] },
    },
```

`roleCreationReceipt.ts`: add `format?: unknown;` to `RoleCreatePayload` after `time`; add to `CanonicalCreatePayload` after `time?`:

```ts
  /**
   * Present ONLY for a worship night. Omitted otherwise so every existing
   * fingerprint stays byte-identical (the same rule as `time`).
   */
  format?: ServiceFormat;
```

In `canonicalizeCreatePayload`, directly after the `time` block:

```ts
  // `format` is optional, specials-only, set once at creation. Absent/null/""
  // is an ordinary special; the only accepted value is "worship_night"; a
  // weekend role refuses one rather than dropping it.
  const rawFormat = doc.format;
  const hasFormat = rawFormat !== undefined && rawFormat !== null && rawFormat !== "";
  const format = hasFormat && isWorshipNightFormat(rawFormat) ? rawFormat : null;
  if (hasFormat && !format) issues.push("format");
  if (format && roleType !== "special_role") issues.push("format");
```

and in the returned `canonical`, after the `time` spread: `...(format && roleType === "special_role" ? { format } : {}),`. Import `isWorshipNightFormat, type ServiceFormat` from `./serviceFormat`.

`roleWriteRequest.ts`: `ParsedCreateRequest` gains `format: ServiceFormat | null;`; `parseCreateRequest`'s value gains `format: canonical.format ?? null,`; `buildRoleDocument`'s input gains `format: ServiceFormat | null;` and, after the `time` spread, `...(input.roleType === "special_role" && input.format ? { format: input.format } : {}),`. `buildRoleEditPatch` is NOT changed.

`app/api/admin/roles/route.ts`: pass `format: request.format,` next to `time: request.time,` in the POST's `buildRoleDocument` call; add `format` to the GET projection after `time`.

`serviceReadQueries.ts`: `ROLE_PROJECTION`'s first line becomes `_id, _rev, _type, published, week, date, service_name, time, format,`.

Types: `StoredRole` (`roleWriteOps.ts`) gains `time?: string; format?: string;`; `ServiceRole` gains `format?: string | null;`; `SpecialRole` gains `format?: string | null;`.

- [ ] **Step 4: Pin the time-less, format-less fingerprint**

In the new `describe("special-service format")`, add a test that computes `payloadFingerprint(special())` once, prints it, and pins it with `toBe("<hex>")`, comment `// Pinned 2026-09-22: adding format must not move a format-less fingerprint.`

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run app/utils/__tests__/serviceFormat.test.ts app/utils/__tests__/roleWriteRequest.test.ts app/utils/__tests__/serviceReadQueries.test.ts app/api/__tests__/roleWriteRoutes.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add app/utils/serviceFormat.ts sanity/schemas/specialRole.ts app/utils/roleCreationReceipt.ts app/utils/roleWriteRequest.ts app/api/admin/roles/route.ts app/utils/serviceReadQueries.ts app/utils/roleWriteOps.ts app/components/admin/serviceCardModel.ts app/utils/interface.tsx app/utils/__tests__/serviceFormat.test.ts app/utils/__tests__/roleWriteRequest.test.ts app/utils/__tests__/serviceReadQueries.test.ts app/api/__tests__/roleWriteRoutes.test.ts
git commit -m "feat(special): a create-time format marks a special as «Noche de alabanza»"
```

---

### Task 2: `songLeads.ts` — the one set of song-leader rules (critical slice)

**Files:**
- Create: `app/utils/songLeads.ts`
- Modify: `app/utils/serviceReadQueries.ts` (`SONGS_FRAGMENT`)
- Test: `app/utils/__tests__/songLeads.test.ts`, `app/utils/__tests__/serviceReadQueries.test.ts`

**Interfaces:**
- Consumes: `isWorshipNight` (Task 1).
- Produces:
  - `SONG_LEADS_MAX = 2`
  - `leadSeatIds(lead: unknown): Set<string>` — `_ref`s of a role's `Lead` reference items.
  - `songItemLeadIds(item: unknown): string[]` — the stored `leads[]._ref`s of one song item, order kept, duplicates and blanks dropped; absent/`null` → `[]`.
  - `validateSongLeads(rows: readonly { leadIds: readonly string[] }[], target: { worshipNight: boolean; leadIds: ReadonlySet<string> }): { ok: true } | { ok: false; issues: string[] }` — issue `songs[i].leadIds` for every row with leaders when the target is not a worship night or a leader is not in `target.leadIds`.
  - `carryOverSongLeads<T extends { songId: string }>(rows: readonly T[], liveSongs: unknown, leadIds: ReadonlySet<string>): (T & { leadIds: string[] })[]`
  - `unassignedLeads<M extends { id: string }>(roster: readonly M[], rows: readonly { leadIds: readonly string[] }[]): M[]`
  - `leadRosterOf(value: unknown): { id: string; name: string }[]` — from a projected `Lead[]->{ _id, member_name, alias }`, name = alias || member_name, unresolved entries dropped.
  - `formatLeadNames(leads: readonly ({ member_name?: string; alias?: string } | null)[] | null | undefined): string` — «A» or «A y B» (alias preferred), `""` when none; nullish entries (a dereference that did not resolve) are skipped. **[post-approval, un-reviewed]**
  - `sortedLeadIds(value: unknown): string[]` — the ONE normalizer for snapshot leader ids: a list of non-empty strings, de-duplicated and sorted; anything else `[]`. Used by both `songRowsFrom` and `normalizeSnapshotRows` (Task 8). **[post-approval, un-reviewed]**
  - `SONGS_FRAGMENT` projects `leads[]{ _key, _type, _ref }` on every song item.

- [ ] **Step 1: Write the failing tests**

```ts
// app/utils/__tests__/songLeads.test.ts
import { describe, expect, it } from "vitest";
import {
  SONG_LEADS_MAX,
  carryOverSongLeads,
  formatLeadNames,
  leadRosterOf,
  leadSeatIds,
  songItemLeadIds,
  sortedLeadIds,
  unassignedLeads,
  validateSongLeads,
} from "@/app/utils/songLeads";

const ref = (key: string, id: string) => ({ _key: key, _type: "reference", _ref: id });
const item = (songId: string, leads?: unknown) => ({ _key: `k-${songId}`, play_key: "G", song: { _type: "reference", _ref: songId }, ...(leads === undefined ? {} : { leads }) });

describe("leadSeatIds / songItemLeadIds", () => {
  it("reads reference ids and ignores junk", () => {
    expect([...leadSeatIds([ref("a", "m1"), ref("b", "m2"), { _ref: "" }, null, "x"])]).toEqual(["m1", "m2"]);
    expect([...leadSeatIds(undefined)]).toEqual([]);
  });
  it("reads a song item's leaders, null and absent as none", () => {
    expect(songItemLeadIds(item("s1", [ref("x", "m1"), ref("y", "m2"), ref("z", "m1")]))).toEqual(["m1", "m2"]);
    expect(songItemLeadIds(item("s1", null))).toEqual([]);
    expect(songItemLeadIds(item("s1"))).toEqual([]);
    expect(SONG_LEADS_MAX).toBe(2);
  });
});

describe("validateSongLeads", () => {
  const lead = new Set(["m1", "m2"]);
  it("accepts leaders from Lead on a worship night, and rows without leaders anywhere", () => {
    expect(validateSongLeads([{ leadIds: ["m1"] }, { leadIds: [] }, { leadIds: ["m1", "m2"] }], { worshipNight: true, leadIds: lead })).toEqual({ ok: true });
    expect(validateSongLeads([{ leadIds: [] }], { worshipNight: false, leadIds: new Set() })).toEqual({ ok: true });
  });
  it("refuses leaders on a target that is not a worship night", () => {
    expect(validateSongLeads([{ leadIds: [] }, { leadIds: ["m1"] }], { worshipNight: false, leadIds: lead })).toEqual({ ok: false, issues: ["songs[1].leadIds"] });
  });
  it("refuses a leader who is not in Lead", () => {
    expect(validateSongLeads([{ leadIds: ["m1", "m9"] }], { worshipNight: true, leadIds: lead })).toEqual({ ok: false, issues: ["songs[0].leadIds"] });
  });
});

describe("carryOverSongLeads", () => {
  const lead = new Set(["m1", "m2"]);
  const rows = (...ids: string[]) => ids.map((songId) => ({ songId, playKey: "G", medleyTag: null }));

  it("keeps each song's leaders by song reference and drops leaders no longer in Lead", () => {
    const live = [item("s1", [ref("a", "m1")]), item("s3", [ref("b", "m2"), ref("c", "m7")])];
    expect(carryOverSongLeads(rows("s3", "s1", "s2"), live, lead).map((r) => r.leadIds)).toEqual([["m2"], ["m1"], []]);
  });

  it("matches repeated songs in order, each live item used once", () => {
    const live = [item("s1", [ref("a", "m1")]), item("s1", [ref("b", "m2")])];
    expect(carryOverSongLeads(rows("s1", "s1", "s1"), live, lead).map((r) => r.leadIds)).toEqual([["m1"], ["m2"], []]);
  });

  it("gives nothing when the live songs are absent or malformed", () => {
    expect(carryOverSongLeads(rows("s1"), null, lead)[0].leadIds).toEqual([]);
    expect(carryOverSongLeads(rows("s1"), "x", lead)[0].leadIds).toEqual([]);
  });

  it("never carries more than two leaders", () => {
    const live = [item("s1", [ref("a", "m1"), ref("b", "m2"), ref("c", "m3")])];
    expect(carryOverSongLeads(rows("s1"), live, new Set(["m1", "m2", "m3"]))[0].leadIds).toEqual(["m1", "m2"]);
  });
});

describe("editor and display helpers", () => {
  it("lists the Lead members with no song yet", () => {
    const roster = [{ id: "m1", name: "Ana" }, { id: "m2", name: "Beto" }, { id: "m3", name: "Caro" }];
    expect(unassignedLeads(roster, [{ leadIds: ["m2"] }, { leadIds: [] }])).toEqual([roster[0], roster[2]]);
  });
  it("builds the roster from a projected Lead, alias first, unresolved dropped", () => {
    expect(leadRosterOf([{ _id: "m1", member_name: "Ana López", alias: "Ani" }, null, { _id: "m2", member_name: "Beto" }, { member_name: "sin id" }, { _id: "m3" }]))
      .toEqual([{ id: "m1", name: "Ani" }, { id: "m2", name: "Beto" }, { id: "m3", name: "Sin nombre" }]);
    expect(leadRosterOf(undefined)).toEqual([]);
  });
  it("formats one or two names", () => {
    expect(formatLeadNames([{ member_name: "Ana", alias: "Ani" }])).toBe("Ani");
    expect(formatLeadNames([{ member_name: "Ana" }, { member_name: "Beto" }])).toBe("Ana y Beto");
    expect(formatLeadNames(null)).toBe("");
    // [post-approval, un-reviewed] An unresolved dereference projects as null.
    expect(formatLeadNames([null, { member_name: "Beto" }])).toBe("Beto");
  });
  it("normalizes snapshot leader ids in one place [post-approval, un-reviewed]", () => {
    expect(sortedLeadIds(["m2", "m1", "m2", "", 3])).toEqual(["m1", "m2"]);
    expect(sortedLeadIds(null)).toEqual([]);
    expect(sortedLeadIds("m1")).toEqual([]);
  });
});
```

In `serviceReadQueries.test.ts`, add `"leads[]"` to the fragments asserted for `ROLE_PROJECTION`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/utils/__tests__/songLeads.test.ts app/utils/__tests__/serviceReadQueries.test.ts`
Expected: FAIL — module missing; `leads[]` not in the projection.

- [ ] **Step 3: Implement**

```ts
// app/utils/songLeads.ts
//
// The ONE set of rules for who leads each song of a «Noche de alabanza» (spec
// 2026-09-22-worship-night-song-leads-design.md §3.2–§8). Neutral: no imports
// from server modules, because the setlist editor and the member cards import
// it too. The server writers (setlist PUT, proposal approval) and the
// notification snapshot call these functions; nothing re-implements them.

export const SONG_LEADS_MAX = 2;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Member ids in a role's `Lead` seat (reference items `{ _ref }`). */
export function leadSeatIds(lead: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(lead)) return out;
  for (const entry of lead) if (isObj(entry) && nonEmptyString(entry._ref)) out.add(entry._ref);
  return out;
}

/** Stored leader ids of one song item; absent or `null` (GROQ's projection of an absent field) is none. */
export function songItemLeadIds(item: unknown): string[] {
  if (!isObj(item) || !Array.isArray(item.leads)) return [];
  const out: string[] = [];
  for (const entry of item.leads) {
    if (isObj(entry) && nonEmptyString(entry._ref) && !out.includes(entry._ref)) out.push(entry._ref);
  }
  return out;
}

export function validateSongLeads(
  rows: readonly { leadIds: readonly string[] }[],
  target: { worshipNight: boolean; leadIds: ReadonlySet<string> },
): { ok: true } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  rows.forEach((row, index) => {
    if (!row.leadIds.length) return;
    if (!target.worshipNight || row.leadIds.some((id) => !target.leadIds.has(id))) {
      issues.push(`songs[${index}].leadIds`);
    }
  });
  return issues.length ? { ok: false, issues } : { ok: true };
}

/**
 * Approval rewrites the live setlist from the proposal's rows, which carry no
 * leaders. Each new row takes the leaders of the first not-yet-used live item
 * with the same song reference, keeping only those still in `leadIds` (the
 * role's Lead), at most two. A song new to the list gets none.
 */
export function carryOverSongLeads<T extends { songId: string }>(
  rows: readonly T[],
  liveSongs: unknown,
  leadIds: ReadonlySet<string>,
): (T & { leadIds: string[] })[] {
  const live = Array.isArray(liveSongs) ? liveSongs : [];
  const used = new Set<number>();
  return rows.map((row) => {
    const index = live.findIndex(
      (entry, i) => !used.has(i) && isObj(entry) && isObj(entry.song) && entry.song._ref === row.songId,
    );
    if (index === -1) return { ...row, leadIds: [] };
    used.add(index);
    const ids = songItemLeadIds(live[index]).filter((id) => leadIds.has(id)).slice(0, SONG_LEADS_MAX);
    return { ...row, leadIds: ids };
  });
}

/** «Aún no dirigen»: roster members who lead no row yet, roster order kept. */
export function unassignedLeads<M extends { id: string }>(
  roster: readonly M[],
  rows: readonly { leadIds: readonly string[] }[],
): M[] {
  const assigned = new Set(rows.flatMap((row) => row.leadIds));
  return roster.filter((m) => !assigned.has(m.id));
}

/** The editor's roster from a projected `Lead[]->{ _id, member_name, alias }`. */
export function leadRosterOf(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { id: string; name: string }[] = [];
  for (const entry of value) {
    if (!isObj(entry) || !nonEmptyString(entry._id)) continue;
    // A Lead member with neither alias nor name is still a valid leader — the
    // server accepts them — so they stay pickable. [post-approval, un-reviewed]
    const name = nonEmptyString(entry.alias) ? entry.alias : nonEmptyString(entry.member_name) ? entry.member_name : "Sin nombre";
    if (!out.some((m) => m.id === entry._id)) out.push({ id: entry._id, name });
  }
  return out;
}

/** «A» or «A y B» for a song's leaders (alias preferred); "" when none. */
export function formatLeadNames(
  leads: readonly ({ member_name?: string; alias?: string } | null)[] | null | undefined,
): string {
  return (leads ?? [])
    .map((m) => (m ? m.alias || m.member_name || "" : "").trim())
    .filter(Boolean)
    .slice(0, SONG_LEADS_MAX)
    .join(" y ");
}

/**
 * The ONE normalizer for leader ids in a notification snapshot — queue side
 * (`songRowsFrom`) and flush side (`normalizeSnapshotRows`) must agree byte for
 * byte, so neither re-implements it. [post-approval, un-reviewed]
 */
export function sortedLeadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].sort();
}
```

`serviceReadQueries.ts`: `SONGS_FRAGMENT` becomes
`songs[]{ _key, play_key, medley_tag, song{ _type, _ref }, leads[]{ _key, _type, _ref } }`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/utils/__tests__/songLeads.test.ts app/utils/__tests__/serviceReadQueries.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/songLeads.ts app/utils/serviceReadQueries.ts app/utils/__tests__/songLeads.test.ts app/utils/__tests__/serviceReadQueries.test.ts
git commit -m "feat(setlist): songLeads — the one set of rules for who leads each song"
```

---

### Task 3: The setlist writer accepts and validates `leadIds` (critical slice)

**Files:**
- Modify: `app/utils/setlistWriteRequest.ts` (`NormalizedSongRow`, `parseSongRows`, `songDocs`)
- Modify: `app/utils/proposalWriteRequest.ts` (`parseProposalSaveRequest`)
- Modify: `app/api/admin/setlists/route.ts` (`putHandler`)
- Modify: `app/api/admin/proposals/[id]/route.ts` (one line, so it still compiles — behaviour unchanged)
- Modify: `sanity/schemas/specialRole.ts` (the inline `setlist_song` object type gains `leads`)
- Test: `app/utils/__tests__/setlistWriteRequest.test.ts`, `app/utils/__tests__/proposalWriteRequest.test.ts`, `app/api/__tests__/setlistWriteRoute.test.ts`

**Interfaces:**
- Consumes: `SONG_LEADS_MAX`, `validateSongLeads`, `leadSeatIds` (Task 2); `isWorshipNight` (Task 1); `StoredRole.format` (Task 1).
- Produces: `NormalizedSongRow.leadIds: string[]` (always present, `[]` when none); stored `setlist_song` items carry `leads: { _key, _type: "reference", _ref }[]` only when the row has leaders; `proposal_song` items never do; the PUT refuses any row with leaders unless the target is a worship night and every leader is in its `Lead`.

- [ ] **Step 1: Write the failing tests**

Append to `app/utils/__tests__/setlistWriteRequest.test.ts` (its `key()` helper is a `k1, k2, …` counter):

```ts
describe("song leaders on rows", () => {
  const row = (over: Record<string, unknown> = {}) => ({ songId: "song-1", play_key: "G", ...over });

  it("parses absent, null and [] as no leaders", () => {
    for (const leadIds of [undefined, null, []]) {
      const parsed = parseSongRows([row(leadIds === undefined ? {} : { leadIds })]);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value[0].leadIds).toEqual([]);
    }
  });

  it("parses one or two distinct canonical ids", () => {
    const parsed = parseSongRows([row({ leadIds: ["mem-1", "mem-2"] })]);
    expect(parsed.ok && parsed.value[0].leadIds).toEqual(["mem-1", "mem-2"]);
  });

  it("refuses three ids, a duplicate, a non-canonical id or a non-array", () => {
    for (const leadIds of [["a", "b", "c"], ["mem-1", "mem-1"], ["drafts.mem-1"], [""], "mem-1", [1]]) {
      expect(parseSongRows([row(), row({ leadIds })])).toMatchObject({ ok: false, issues: ["songs[1].leadIds"] });
    }
  });

  it("writes leads on setlist items only when present, each with a _key", () => {
    const next = key();
    const docs = buildSetlistSongDocs(
      [{ songId: "song-1", playKey: "G", medleyTag: null, leadIds: ["mem-1", "mem-2"] }, { songId: "song-2", playKey: "", medleyTag: null, leadIds: [] }],
      next,
    );
    expect(docs[0].leads).toEqual([
      { _key: expect.any(String), _type: "reference", _ref: "mem-1" },
      { _key: expect.any(String), _type: "reference", _ref: "mem-2" },
    ]);
    expect(new Set([docs[0]._key, ...(docs[0].leads as { _key: string }[]).map((l) => l._key)]).size).toBe(3);
    expect("leads" in docs[1]).toBe(false);
  });

  it("never writes leads on proposal items", () => {
    const docs = buildProposalSongDocs([{ songId: "song-1", playKey: "G", medleyTag: null, leadIds: ["mem-1"] }], key());
    expect("leads" in docs[0]).toBe(false);
  });
});
```

Update every existing `toEqual` in this file and in `proposalWriteRequest.test.ts` that spells a parsed `NormalizedSongRow` literal (`{ songId, playKey, medleyTag }`) to include `leadIds: []`, and add `leadIds: []` to every existing row literal passed to `buildSetlistSongDocs`/`buildProposalSongDocs` in `setlistWriteRequest.test.ts` (three call sites today, in the «stored song documents» and «setlist target identity» blocks) — `tsc` flags them once the field is required. **[post-approval, un-reviewed]**

Append to `app/utils/__tests__/proposalWriteRequest.test.ts`, inside `describe("parseProposalSaveRequest")`, a case that builds the file's valid base body with `songs: [{ songId: "song-1", play_key: "G", leadIds: ["mem-1"] }]` and asserts `{ ok: false, issues: ["songs[0].leadIds"] }`.

Append to `app/api/__tests__/setlistWriteRoute.test.ts`, inside `describe("PUT /api/admin/setlists — special service")`:

```ts
  describe("song leaders", () => {
    const night = (over: Record<string, unknown> = {}) =>
      specialRole({ format: "worship_night", Lead: [ref("c1", "mem-1"), ref("c2", "mem-2")], ...over });

    it("stores leaders from Lead on a worship night, under the role revision", async () => {
      store.roles.push(night());
      const res = await PUT(req(specialBody({ songs: [{ songId: "song-1", play_key: "G", leadIds: ["mem-2", "mem-1"] }, { songId: "song-2", play_key: "A" }] })));
      expect(res.status).toBe(200);
      const op = patches(committedTransactions()[0])[0];
      expect(op).toMatchObject({ id: "role-sp", rev: "role-rev-sp" });
      const songs = op.set.songs as Record<string, unknown>[];
      expect((songs[0].leads as { _ref: string }[]).map((l) => l._ref)).toEqual(["mem-2", "mem-1"]);
      expect("leads" in songs[1]).toBe(false);
    });

    it("refuses a leader who is not in Lead", async () => {
      store.roles.push(night());
      const res = await PUT(req(specialBody({ songs: [{ songId: "song-1", play_key: "G", leadIds: ["mem-9"] }] })));
      expect(res.status).toBe(400);
      expect((await res.json()).details).toMatchObject({ issues: ["songs[0].leadIds"] });
      expect(transactions).toHaveLength(0);
    });

    it("refuses leaders on an ordinary special", async () => {
      store.roles.push(specialRole());
      const res = await PUT(req(specialBody({ songs: [{ songId: "song-1", play_key: "G", leadIds: ["mem-1"] }] })));
      expect(res.status).toBe(400);
      expect(transactions).toHaveLength(0);
    });

    it("refuses leaders on a weekend setlist", async () => {
      seedWeekendService();
      const res = await PUT(req(body({ songs: [{ songId: "song-1", play_key: "G", leadIds: ["mem-1"] }] })));
      expect(res.status).toBe(400);
      expect(transactions).toHaveLength(0);
    });

    it("a seat change racing the save fails it as stale, storing nothing", async () => {
      store.roles.push(night());
      commitOutcomes.push(conflictError());
      const res = await PUT(req(specialBody({ songs: [{ songId: "song-1", play_key: "G", leadIds: ["mem-1"] }] })));
      expect(res.status).toBe(409);
      expect(committedTransactions()).toHaveLength(0);
    });
  });
```

(`seedWeekendService`, `ref`, `conflictError`, `commitOutcomes`, `committedTransactions` are the file's existing helpers; if `seedWeekendService` needs arguments or `commitOutcomes` is consumed differently, follow the file's own weekend and conflict cases.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/utils/__tests__/setlistWriteRequest.test.ts app/utils/__tests__/proposalWriteRequest.test.ts app/api/__tests__/setlistWriteRoute.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the parser and serializer**

`setlistWriteRequest.ts`:

```ts
export interface NormalizedSongRow {
  songId: string;
  playKey: string;
  medleyTag: string | null;
  /** 0–2 distinct member ids; `[]` when none. Only a worship night's songs may carry any (route-checked). */
  leadIds: string[];
}

/** `null`/absent/[] → []; else 1–SONG_LEADS_MAX distinct canonical ids, or null (refused). */
function parseLeadIds(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > SONG_LEADS_MAX) return null;
  const out: string[] = [];
  for (const id of value) {
    if (!isCanonicalDocumentId(id) || out.includes(id)) return null;
    out.push(id);
  }
  return out;
}
```

In `parseSongRows`, after the medley checks: `const leadIds = parseLeadIds(raw.leadIds); if (!leadIds) return fail([`songs[${index}].leadIds`]);` and push `{ songId: raw.songId, playKey, medleyTag, leadIds }`.

`songDocs` becomes:

```ts
  return rows.map((row) => {
    const itemKey = nextKey();
    return {
      _type: itemType,
      _key: itemKey,
      ...(row.playKey ? { play_key: row.playKey } : {}),
      ...(row.medleyTag ? { medley_tag: row.medleyTag } : {}),
      song: { _type: "reference", _ref: row.songId },
      // Leaders exist only on a special's own setlist items, never on a
      // proposal. Each reference item carries its own `_key` (Sanity rule).
      ...(itemType === "setlist_song" && row.leadIds.length
        ? { leads: row.leadIds.map((id) => ({ _key: nextKey(), _type: "reference", _ref: id })) }
        : {}),
    };
  });
```

Import `SONG_LEADS_MAX` from `./songLeads`.

`proposalWriteRequest.ts`, in `parseProposalSaveRequest` right after `if (!songs.ok) return songs;`:

```ts
  // Proposals never carry per-song leaders (spec §3.2): refuse rather than drop.
  const withLeads = songs.value.findIndex((row) => row.leadIds.length > 0);
  if (withLeads !== -1) return fail([`songs[${withLeads}].leadIds`]);
```

- [ ] **Step 4: Implement the route check**

In `putHandler` (`app/api/admin/setlists/route.ts`), declare before the `if (request.setlistType)` branch:

```ts
  /** What this target allows for per-song leaders (spec §4.1). A weekend setlist allows none. */
  let leadTarget: { worshipNight: boolean; leadIds: ReadonlySet<string> } = {
    worshipNight: false,
    leadIds: new Set(),
  };
```

In the special branch, right after `subject = { … };`:

```ts
    // Checked against the role THIS request loaded; the patch below asserts
    // that same `_rev`, so a Lead change landing in between fails the write.
    leadTarget = {
      worshipNight: isWorshipNight(target.target.role),
      leadIds: leadSeatIds(target.target.role.Lead),
    };
```

Directly AFTER the observed-target comparison (the `const mismatch = compareObservedTarget(observed, server); if (mismatch) { … }` block) and before the transaction is built:

```ts
  // After the observed-target check on purpose: when the editor's view is
  // stale (a Lead change moved the role _rev), the admin gets the 409 reload
  // path, not a 400 that a retry cannot clear.
  const leadCheck = validateSongLeads(request.songs, leadTarget);
  if (!leadCheck.ok) {
    return reject(serviceError("invalid_request", { details: { issues: leadCheck.issues } }));
  }
```

`sanity/schemas/specialRole.ts`, inside the `songs` array's inline `setlist_song` object, after the `medley_tag` field (so Studio does not report an unknown field on a worship night's songs; the document stays read-only):

```ts
            {
              name: 'leads',
              title: 'Dirige',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'teamMembers' }] }],
              validation: (rule: { max: (n: number) => unknown }) => rule.max(2),
              description: 'Solo en una Noche de alabanza: 1 o 2 personas de Lead. Lo escribe el editor de setlist.',
            },
```

Imports: `isWorshipNight` from `@/app/utils/serviceFormat`; `leadSeatIds, validateSongLeads` from `@/app/utils/songLeads`.

- [ ] **Step 5: Run the tests**

**Keep the approval route compiling.** `NormalizedSongRow.leadIds` is now required, and `approve()` in `app/api/admin/proposals/[id]/route.ts` passes `storedProposalSongRows(...)` rows (no `leadIds`) to `buildSetlistSongDocs`. Change that one call to
`const songs = buildSetlistSongDocs(songRows.map((row) => ({ ...row, leadIds: [] })), nextKey);`
— behaviour identical to today (no leaders written); Task 4 replaces it.

Run: `npx vitest run app/utils/__tests__/setlistWriteRequest.test.ts app/utils/__tests__/proposalWriteRequest.test.ts app/api/__tests__/setlistWriteRoute.test.ts app/api/__tests__/proposalWriteRoutes.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add app/utils/setlistWriteRequest.ts app/utils/proposalWriteRequest.ts "app/api/admin/setlists/route.ts" "app/api/admin/proposals/[id]/route.ts" sanity/schemas/specialRole.ts app/utils/__tests__/setlistWriteRequest.test.ts app/utils/__tests__/proposalWriteRequest.test.ts app/api/__tests__/setlistWriteRoute.test.ts
git commit -m "feat(setlist): a worship night's songs carry up to two leaders from Lead

The setlist PUT parses leadIds per row and stores them as keyed references on
the special's own song items. A row with leaders is refused unless the target
is a worship night and every leader is in the Lead the request loaded; the
patch asserts that role's _rev, so a racing seat change fails the write.
Proposals refuse leadIds instead of dropping them."
```

---

### Task 4: Proposal approval carries leaders over (critical slice)

**Files:**
- Modify: `app/api/admin/proposals/[id]/route.ts` (`approve`)
- Test: `app/api/__tests__/proposalWriteRoutes.test.ts`

**Interfaces:**
- Consumes: `carryOverSongLeads`, `leadSeatIds` (Task 2); `isWorshipNight` (Task 1); `NormalizedSongRow.leadIds` (Task 3).
- Produces: approval of a worship-night special writes each new song with the leaders of the first unused live song with the same reference, filtered to the role's current Lead; every other approval writes songs with no leaders. The approval fingerprint (`approvalInputFingerprint`) is unchanged — it hashes `songId`/`playKey`/`medleyTag` only.

- [ ] **Step 1: Write the failing tests**

Inside `describe("PATCH /api/admin/proposals/[id] — approval")`, after "publishes a special service onto its own role document":

```ts
  describe("song leaders on a worship night", () => {
    const liveSong = (key: string, songId: string, leads: string[]) => ({
      _key: key, play_key: "D", song: { _type: "reference", _ref: songId },
      ...(leads.length ? { leads: leads.map((id, i) => ref(`${key}-${i}`, id)) } : {}),
    });
    const specialProposal = (songs: string[]) => proposal({
      _id: "setlistProposal.role-sp",
      service_type: "special",
      service_ref: "role-sp",
      service_date: "2026-08-20",
      songs: songs.map((id, i) => ({ _key: `p${i}`, play_key: "D", song: { _type: "reference", _ref: id } })),
    });
    const approvedSongs = () =>
      patches(committedTransactions()[0]).find((o) => o.id === "role-sp")!.set.songs as Record<string, unknown>[];
    const leadRefs = (s: Record<string, unknown>) => ((s.leads as { _ref: string }[] | undefined) ?? []).map((l) => l._ref);

    it("keeps leaders by song and drops those no longer in Lead", async () => {
      store.roles.push(specialRole({
        format: "worship_night",
        Lead: [ref("c1", "mem-1"), ref("c2", "mem-2")],
        songs: [liveSong("l1", "song-1", ["mem-1"]), liveSong("l2", "song-3", ["mem-2", "mem-7"])],
      }));
      store.proposals.push(specialProposal(["song-3", "song-1", "song-2"]));
      const res = await patchAdmin("setlistProposal.role-sp", { action: "approve", rev: "prop-rev-1" });
      expect(res.status).toBe(200);
      expect(approvedSongs().map(leadRefs)).toEqual([["mem-2"], ["mem-1"], []]);
      expect(approvedSongs().every((s) => typeof s._key === "string")).toBe(true);
    });

    it("an ordinary special's approval writes no leaders", async () => {
      store.roles.push(specialRole({ songs: [liveSong("l1", "song-1", ["mem-1"])] }));
      store.proposals.push(specialProposal(["song-1"]));
      const res = await patchAdmin("setlistProposal.role-sp", { action: "approve", rev: "prop-rev-1" });
      expect(res.status).toBe(200);
      expect(approvedSongs().map(leadRefs)).toEqual([[]]);
    });

    it("a lost-response retry stays a no-write success (fingerprint ignores leaders)", async () => {
      store.roles.push(specialRole({ format: "worship_night", Lead: [ref("c1", "mem-1")], songs: [liveSong("l1", "song-1", ["mem-1"])] }));
      store.proposals.push(specialProposal(["song-1"]));
      expect((await patchAdmin("setlistProposal.role-sp", { action: "approve", rev: "prop-rev-1" })).status).toBe(200);
      const writes = committedTransactions().length;
      const stored = store.proposals.find((p) => p._id === "setlistProposal.role-sp")!;
      const retry = await patchAdmin("setlistProposal.role-sp", { action: "approve", rev: String(stored._rev) });
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ idempotent: true });
      expect(committedTransactions()).toHaveLength(writes);
    });
  });
```

(If the store does not apply committed patches back — check `applyToStore` usage in this file — mirror the file's existing idempotent-retry approval case for how the stored proposal reaches `status: "approved"`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/api/__tests__/proposalWriteRoutes.test.ts -t "worship night"`
Expected: FAIL — the first case gets no leaders carried.

- [ ] **Step 3: Implement**

In `approve`, replace the line Task 3 left before the `if (special)` — `const songs = buildSetlistSongDocs(songRows.map((row) => ({ ...row, leadIds: [] })), nextKey);` — with a declaration `let songs: Record<string, unknown>[];`. In the special branch, right after `const roleRev = specialRole._rev;`:

```ts
    // Approval rewrites the whole song list from the proposal, which carries no
    // leaders. On a worship night, carry each song's leaders over from the live
    // list by song reference, filtered to the Lead this request loaded — the
    // patch below asserts that same revision (spec §4.2).
    songs = buildSetlistSongDocs(
      isWorshipNight(specialRole)
        ? carryOverSongLeads(songRows, specialRole.songs, leadSeatIds(specialRole.Lead))
        : songRows.map((row) => ({ ...row, leadIds: [] })),
      nextKey,
    );
```

In the weekend branch, before `if (observed.state === "single")`:

```ts
    songs = buildSetlistSongDocs(songRows.map((row) => ({ ...row, leadIds: [] })), nextKey);
```

Imports: `isWorshipNight` from `@/app/utils/serviceFormat`; `carryOverSongLeads, leadSeatIds` from `@/app/utils/songLeads`. Nothing else in `approve` changes (`approval.songs` stays `songRows`, so the fingerprint is unchanged).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/api/__tests__/proposalWriteRoutes.test.ts app/api/__tests__/setlistWriteRoute.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/proposals/[id]/route.ts" app/api/__tests__/proposalWriteRoutes.test.ts
git commit -m "feat(proposals): approving onto a worship night keeps each song's leaders"
```

---

### Task 5: Planner — «Noche de alabanza» in stored mode

**Files:**
- Modify: `app/components/admin/plannerModel.ts` (`GridColumn`, `hasTarget`)
- Modify: `app/components/admin/storedRoleReadModel.ts` (`translateStoredRole`)
- Modify: `app/utils/monthDraftCreate.ts` (`CreatableDraft`, `draftCreateBody`)
- Modify: `app/components/admin/MonthGenerator.tsx` (composer: state, Select, `handleCreateOne`, the `createAttempt` target type)
- Modify: `app/components/admin/PlannerGrid.tsx` (column header `typeLabel`)
- Test: `app/components/admin/__tests__/plannerModel.test.ts`, `app/components/admin/__tests__/storedRoleReadModel.test.ts`, `app/components/admin/__tests__/groupFill.test.ts`, `app/utils/__tests__/monthDraftCreate.test.ts`, `app/components/admin/__tests__/MonthGenerator.stored.test.tsx`

**Interfaces:**
- Consumes: `WORSHIP_NIGHT_FORMAT`, `isWorshipNightFormat`, `ServiceFormat` (Task 1); `ServiceRole.format` (Task 1).
- Produces: `GridColumn.format?: ServiceFormat`; `hasTarget(row, column: Pick<GridColumn, "type" | "format">)` returns `false` for the `lead` row on a worship night; `CreatableDraft.format?: ServiceFormat`.

- [ ] **Step 1: Write the failing tests**

- `plannerModel.test.ts`: `hasTarget` of the `lead` row is `true` on `{ type: "special_role" }` and `false` on `{ type: "special_role", format: "worship_night" }`; the `bgv` row stays `true` on both.
- `storedRoleReadModel.test.ts`: `translateStoredRole` copies `format: "worship_night"` onto a special's column and drops any other value (mirror the file's special fixtures).
- `groupFill.test.ts`: a worship-night column (`{ ...special("s1", "2026-10-03", "20:45"), format: "worship_night" }`) with `TEN` members comes back with an EMPTY `lead` cell and three `bgv` occupants.
- `monthDraftCreate.test.ts`: `draftCreateBody` emits `format: "worship_night"` for a special draft carrying it, never for a weekend draft, and omits the key when absent.
- `MonthGenerator.stored.test.tsx`: in the composer (`renderStored([role()], { openComposerInitially: true })`), choosing «Noche de alabanza» in the «Tipo» select, typing a name and pressing «Crear vacío» POSTs `_type: "special_role"` with `format: "worship_night"` (assert the fetch body); choosing «Especial» POSTs no `format`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/components/admin/__tests__/plannerModel.test.ts app/components/admin/__tests__/storedRoleReadModel.test.ts app/components/admin/__tests__/groupFill.test.ts app/utils/__tests__/monthDraftCreate.test.ts app/components/admin/__tests__/MonthGenerator.stored.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `GridColumn` gains, after `time?`: `/** SPECIALS ONLY — "worship_night" for a «Noche de alabanza». Never identity. */ format?: ServiceFormat;`
- `hasTarget`: signature `column: Pick<GridColumn, "type" | "format">`; first line after the `rowAppliesTo` check: `if (row.id === "lead" && column.format === WORSHIP_NIGHT_FORMAT) return false;` with a comment: a worship night's Lead holds every song leader of the block, so it has no target and no «+N»; `fillColumn` skips rows without a target, which is how the group fill leaves Lead to the admin (spec §5).
- `translateStoredRole`: after the `time` spread, `...(role._type === "special_role" && isWorshipNightFormat(role.format) ? { format: role.format } : {}),`.
- `CreatableDraft` gains `format?: ServiceFormat;`; `draftCreateBody` adds `...(draft._type === "special_role" && draft.format ? { format: draft.format } : {}),`.
- `MonthGenerator` composer: add `const [createWorshipNight, setCreateWorshipNight] = useState(false);`. The «Tipo» `Select` value becomes `createType === "special_role" && createWorshipNight ? "worship_night" : createType`; its `onChange` becomes
  `(event) => { const v = event.target.value; if (v === "worship_night") { setCreateType("special_role"); setCreateWorshipNight(true); } else { setCreateType(v as ServiceType); setCreateWorshipNight(false); } }`; add `<option value="worship_night">Noche de alabanza</option>` after «Especial». In `handleCreateOne`: `const createFormat = createType === "special_role" && createWorshipNight ? WORSHIP_NIGHT_FORMAT : null;`, add `format: createFormat` to `target` (and to the `createAttempt` ref's target type), and `...(createFormat ? { format: createFormat } : {}),` to the `draftCreateBody` call. Reset `setCreateWorshipNight(false)` wherever `setCreateName("")` resets the composer.
- `PlannerGrid` column header: `const typeLabel = column.format === WORSHIP_NIGHT_FORMAT ? "Noche de alabanza" : SERVICE_LABEL[column.type];`

- [ ] **Step 4: Run tests + gates**

Run: `npx vitest run app/components/admin app/utils/__tests__/monthDraftCreate.test.ts && npx tsc --noEmit && npx eslint app/components/admin app/utils`
Expected: PASS, 0 eslint errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/plannerModel.ts app/components/admin/storedRoleReadModel.ts app/utils/monthDraftCreate.ts app/components/admin/MonthGenerator.tsx app/components/admin/PlannerGrid.tsx app/components/admin/__tests__/plannerModel.test.ts app/components/admin/__tests__/storedRoleReadModel.test.ts app/components/admin/__tests__/groupFill.test.ts app/utils/__tests__/monthDraftCreate.test.ts app/components/admin/__tests__/MonthGenerator.stored.test.tsx
git commit -m "feat(admin): create «Noche de alabanza» sets; Lead has no cap and the fill leaves it to admins"
```

---

### Task 6: Setlist editor — «Dirige» per song

**Files:**
- Modify: `app/utils/serviceReadQueries.ts` (`EDITOR_SETLIST_SONGS_PROJECTION`, `editorSpecialRoleQuery`)
- Modify: `app/api/admin/setlists/route.ts` (`EditorSetlistDoc`, GET special branch response)
- Modify: `app/components/admin/SetlistEditor.tsx`
- Test: `app/api/__tests__/setlistsRoute.test.ts`, `app/components/admin/__tests__/SetlistEditor.test.tsx` (new)

**Interfaces:**
- Consumes: `leadRosterOf`, `unassignedLeads`, `WORSHIP_NIGHT_FORMAT` (Tasks 1–2); the PUT's `leadIds` (Task 3).
- Produces: GET `/api/admin/setlists?type=special&…` adds `format: string | null` and `leadRoster: { id: string; name: string }[]`; every returned song row carries `leadIds: string[] | null`.

- [ ] **Step 1: Write the failing tests**

- `setlistsRoute.test.ts` (special contract): a special fixture with `format: "worship_night"`, a projected `leadRoster: [{ _id: "mem-1", member_name: "Ana" }]` and a song row carrying `leadIds: ["mem-1"]` returns `format: "worship_night"`, `leadRoster: [{ id: "mem-1", name: "Ana" }]` and the row's `leadIds`. A weekend GET's body has no `format` or `leadRoster` keys. (Fixtures come from the file's `specialReads` helper; the store returns what the projection would, so seed `leadRoster`/`leadIds` directly on the fixture.)
- `SetlistEditor.test.tsx` (new, jsdom): stub `fetch` so the GET returns `{ targetState: "single", contentState: "ready", observed: { state: "single", id: "role-sp", rev: "r1" }, setlistId: "role-sp", recentSongs: {}, format: "worship_night", leadRoster: [{ id: "m1", name: "Ana" }, { id: "m2", name: "Beto" }], songs: [{ _key: "k1", play_key: "G", songRef: "s1", song: { _id: "s1", title: "Canción 1", author: "A", key: "G", slug: "c1" }, leadIds: ["m1"] }, { _key: "k2", play_key: "A", songRef: "s2", song: { _id: "s2", title: "Canción 2", author: "B", key: "A", slug: "c2" }, leadIds: null }] }` and `/api/content/tags` returns `[]`. Assert: each row shows a «Dirige» select whose options are «—», «Ana», «Beto»; «Aún no dirigen: Beto.» is shown; choosing «Beto» on row 2 hides that line; pressing save sends `songs[1].leadIds: ["m2"]` and `songs[0].leadIds: ["m1"]`. A second test: a row whose `leadIds` contains `"m9"` (not in the roster) shows «Dirige alguien que ya no está en Lead», save is disabled and «Corrige quién dirige las canciones marcadas.» is shown. A third test: an ordinary special (`format: null`) shows no «Dirige» control and the PUT body carries no `leadIds`. Mount with the providers `SetlistEditor` needs (read its imports; `ToastProvider`/`CueDialogProvider` if used).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/api/__tests__/setlistsRoute.test.ts app/components/admin/__tests__/SetlistEditor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the read**

- `EDITOR_SETLIST_SONGS_PROJECTION`: add `"leadIds": leads[]._ref,` after `medley_tag,`.
- `editorSpecialRoleQuery`: projection `{ _id, _rev, _type, date, format, "leadRoster": Lead[]->{ _id, member_name, alias }, ${EDITOR_SETLIST_SONGS_PROJECTION} }`.
- `EditorSetlistDoc` gains `format?: string; leadRoster?: unknown;`.
- GET special branch: replace the final `return NextResponse.json(buildSetlistRead(records, draftIds, recentSongs));` with:

```ts
    const read = buildSetlistRead(records, draftIds, recentSongs);
    // A special also tells the editor whether it is a worship night and who is
    // in its Lead — the only people a song may name as leader (spec §6).
    return NextResponse.json(
      type === "special" && specialRole
        ? { ...read, format: specialRole.format ?? null, leadRoster: leadRosterOf(specialRole.leadRoster) }
        : read,
    );
```

- [ ] **Step 4: Implement the editor**

In `SetlistEditor.tsx`:
- `SetlistEntry` gains `leadIds: string[];`. State: `const [worshipNight, setWorshipNight] = useState(false); const [roster, setRoster] = useState<{ id: string; name: string }[]>([]);`.
- On load: read `format` and `leadRoster` from the decision's read body; `setWorshipNight(body.format === WORSHIP_NIGHT_FORMAT)`, `setRoster(Array.isArray(body.leadRoster) ? body.leadRoster : [])`; map rows with `leadIds: Array.isArray(s.leadIds) ? s.leadIds.filter((id) => typeof id === "string") : []`. New entries added from search start with `leadIds: []`.
- Derived: `const rosterIds = new Set(roster.map((m) => m.id)); const staleRows = worshipNight ? entries.filter((e) => e.leadIds.some((id) => !rosterIds.has(id))) : []; const waiting = worshipNight ? unassignedLeads(roster, entries) : [];`
- Row (only when `worshipNight`): below the title/author block, two `Select`s (`size="sm"`), labels «Dirige» and «y»:
  - first: value `e.leadIds[0] ?? ""`, options `<option value="">—</option>` plus the roster; onChange sets `leadIds` to `[v, …rest]` or `[]` when «—»;
  - second: disabled until the first is set; options «—» plus the roster minus the first; value `e.leadIds[1] ?? ""`.
  - when the row is stale, a line `<p className="font-body text-[11px] text-warning-strong">Dirige alguien que ya no está en Lead</p>`.
- Under the list, when `worshipNight && waiting.length`: `<p className="font-body text-xs text-mono-400">Aún no dirigen: {waiting.map((m) => m.name).join(", ")}.</p>`
- Save: disabled when `staleRows.length > 0`, with `<p className="font-body text-xs text-warning-strong">Corrige quién dirige las canciones marcadas.</p>`; the body's `songs` map adds `...(worshipNight ? { leadIds: e.leadIds } : {})`.
- **[post-approval, un-reviewed]** A 400 whose `details.issues` contains any `songs[…].leadIds` means Lead changed while the editor was open on a set with no saved songs yet (that case has no revision to go stale). Show «Cambió quién está en Lead mientras editabas. Recarga el setlist.» with the editor's existing reload action, instead of the generic save error. Test it in `SetlistEditor.test.tsx`.

- [ ] **Step 5: Run tests + gates**

Run: `npx vitest run app/api/__tests__/setlistsRoute.test.ts app/components/admin/__tests__/SetlistEditor.test.tsx && npx tsc --noEmit && npx eslint app/components/admin app/api app/utils`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/utils/serviceReadQueries.ts app/api/admin/setlists/route.ts app/components/admin/SetlistEditor.tsx app/api/__tests__/setlistsRoute.test.ts app/components/admin/__tests__/SetlistEditor.test.tsx
git commit -m "feat(setlist-editor): pick who leads each song of a worship night"
```

---

### Task 7: What members see

**Files:**
- Modify: `app/utils/interface.tsx` (`SetlistSong`)
- Modify: `app/(client)/page.tsx`, `app/(client)/schedule/page.tsx`, `app/(client)/me/page.tsx` (the SPECIALS' `songs[]` projections only; `/me` also `myLeadSongs`, `RoleDoc`, `cardProps`)
- Modify: `app/components/DayCard.tsx` (`DayCardProps.myLeadSongs`, header line, `SongRow`)
- Test: `app/components/__tests__/dayCard.test.tsx`, `app/utils/__tests__/draftGatingCoverage.test.ts` (must keep passing)

**Interfaces:**
- Consumes: `formatLeadNames` (Task 2).
- Produces: `SetlistSong.leads?: Array<{ member_name: string; alias?: string }> | null`; `DayCardProps.myLeadSongs?: string[]`.

- [ ] **Step 1: Write the failing tests**

In `dayCard.test.tsx` (helpers `song(id, extra?)`, `mount(props?)`):

```tsx
  it("shows who leads a song under its title, and nothing when nobody does", () => {
    mount({ setlist: { week: "2026-09-13", songs: [
      song("s1", { leads: [{ member_name: "Ana López", alias: "Ani" }, { member_name: "Beto" }] }),
      song("s2"),
    ] } });
    expect(screen.getByText("Dirige: Ani y Beto")).toBeTruthy();
    expect(screen.getAllByText(/^Dirige:/)).toHaveLength(1);
  });

  it("tells the member which songs they lead", () => {
    mount({ myLeadSongs: ["Canción A", "Canción B"] });
    expect(screen.getByText("Diriges: Canción A, Canción B")).toBeTruthy();
    cleanup();
    mount();
    expect(screen.queryByText(/^Diriges:/)).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/components/__tests__/dayCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `SetlistSong` gains `/** A worship night's leaders for this song (Lead members). */ leads?: Array<{ member_name: string; alias?: string }> | null;`
- Specials' song projections — home (`page.tsx` `specials` block), `/schedule` (`specials` block), `/me` (the special's inline `songs[]`) — add `"leads": leads[]->{ member_name, alias }` to each. Weekend projections are unchanged. Every edited block keeps `published != false`.
- `/me` specials block: add `"myLeadSongs": songs[$id in leads[]._ref]{ "title": song->title }`; `RoleDoc` gains `myLeadSongs?: { title?: string }[] | null`; `cardProps` gains `myLeadSongs: (doc.myLeadSongs ?? []).map((s) => s.title).filter((t): t is string => !!t)`.
- `DayCard`: `DayCardProps` gains `/** Titles of the songs the viewing member leads (worship nights). */ myLeadSongs?: string[];`. Directly under the header `<h3>` block render `{myLeadSongs && myLeadSongs.length > 0 && <p className="mt-1 font-label text-xs text-accent">Diriges: {myLeadSongs.join(", ")}</p>}`.
- `SongRow`: wrap the existing title/author `div` (`flex-1 min-w-0 flex items-baseline gap-1.5`) in `<div className="flex-1 min-w-0">`, move `flex-1` off the inner div, and after it add `{formatLeadNames(song.leads) && <span className="block truncate font-label text-[11px] text-mono-500">Dirige: {formatLeadNames(song.leads)}</span>}` (compute once in a const).

- [ ] **Step 4: Run tests + gates**

Run: `npx vitest run app/components/__tests__ app/utils/__tests__/draftGatingCoverage.test.ts && npx tsc --noEmit && npx eslint "app/(client)" app/components`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/interface.tsx "app/(client)/page.tsx" "app/(client)/schedule/page.tsx" "app/(client)/me/page.tsx" app/components/DayCard.tsx app/components/__tests__/dayCard.test.tsx
git commit -m "feat(home,schedule,me): members see who leads each song and which songs they lead"
```

---

### Task 8: Notifications — a leader change is a setlist change (critical slice)

**Files:**
- Modify: `app/utils/outboxNotice.ts` (`OutboxSongRow`, `songRowsFrom`)
- Modify: `app/utils/outboxClassify.ts` (`sameSongs`)
- Modify: `sanity/schemas/notificationOutbox.ts` (`outboxSongRow`)
- Modify: `app/utils/setlistDiff.ts` (`TableRow`, `buildSetlistTable`)
- Modify: `app/utils/notificationEmail.ts` (`songCell`, `songRow`, `medleyGroup`, `renderSetlistTable`, `setlistSection`, `renderLine`, `buildGroupedEmail`)
- Modify: `app/utils/outboxSweep.ts` (`normalizeSnapshotRows` keeps `leads`; a best-effort leader-names read next to the titles read; pass the names to `buildGroupedEmail`)
- Test: `app/utils/__tests__/outboxNotice.test.ts`, `app/utils/__tests__/notificationEmail.test.ts`, the `outboxClassify` tests (find the file that covers `classifySetlist`; create `app/utils/__tests__/outboxClassify.test.ts` if none), `app/utils/__tests__/outboxSweep.test.ts` (three new cases)

**Interfaces:**
- Consumes: `songItemLeadIds` (Task 2); stored `leads` on special song items (Task 3).
- Produces: `OutboxSongRow.leads?: string[]` — sorted member ids, present only when non-empty (so every existing snapshot and every leaderless setlist compares exactly as before); `TableRow.leads?: string[]`; `buildGroupedEmail(o, titles, leaders?: Map<string, string>)`; `renderSetlistTable(rows, titles, showMovement, leaders?: Map<string, string>)`.

- [ ] **Step 1: Write the failing tests**

- `outboxNotice.test.ts` (`songRowsFrom`): items with `leads: [ref(m2), ref(m1)]` produce a row with `leads: ["m1", "m2"]`; items with `leads: null`, `[]` or absent produce a row with NO `leads` key; a medley run keeps each item's own leads.
- `outboxClassify` tests: `classifySetlist` with identical `before`/`after` rows except `leads` returns a `setlistChanged` line; with rows where one side has no `leads` key and the other `leads: []`-equivalent (absent) returns `null`; an in-flight `before` snapshot without `leads` against an `after` without leaders returns `null`.
- `notificationEmail.test.ts` (`buildGroupedEmail`): a `setlistChanged` line whose `songs` row carries `leads: ["m1", "m2"]`, rendered with `leaders = new Map([["m1", "Ani"], ["m2", "Beto"]])`, contains `— dirige Ani y Beto`; an unknown id is omitted; a name containing `<b>` is escaped; with no `leaders` argument the HTML is byte-identical to today's for the same line.
- `outboxSweep.test.ts` — the end-to-end guard that the STORED snapshot keeps its leaders. Use the file's `setlistNotice`, `roleDoc`, `storedSong`, `snapshotRow`, `members` helpers; a special-role notice is `setlistNotice({ roleType: "special_role", roleId: "r9", subjectKey: "r9", serviceDate: "2026-08-08", … })` with `world.roles = { r9: roleDoc({ _id: "r9", _type: "special_role", date: "2026-08-08", week: undefined, format: "worship_night", songs: [...] }) }` (live songs carry `leads: [{ _key: "x", _ref: "m1" }]`) and `world.recipients = { r9: team }`:
  1. **Nothing changed, leaders present → no email.** Snapshot row `{ ...snapshotRow("song1"), leads: ["m1"] }`, live song `song1` with leader `m1` → `sendEmailMock` not called, the notice consumed.
  2. **Leader changed → one «El setlist cambió» per participant.** Snapshot leads `["m1"]`, live leader `m2` → emails sent, subject contains «El setlist cambió», the HTML contains «— dirige» and the name of `m2`.
  3. **All leaders cleared → emails sent.** Snapshot leads `["m1"]`, live song without `leads` → emails sent.
  4. **Leader-name read fails → the email still goes, without names.** Make the `teamMembers` read throw only for the leader-names query (route on a fragment unique to `LEADER_NAMES_QUERY`), keep the recipients' `MEMBERS_QUERY` working → emails sent, no «— dirige», nothing marked failed.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/utils/__tests__/outboxNotice.test.ts app/utils/__tests__/notificationEmail.test.ts app/utils/__tests__/outboxClassify.test.ts app/utils/__tests__/outboxSweep.test.ts`
Expected: FAIL (case 1 of the sweep emails today, because the stored snapshot loses its leaders).

- [ ] **Step 3: Implement the snapshot and the comparison**

`outboxNotice.ts`:

```ts
export interface OutboxSongRow {
  _key: string;
  ref: string;
  key: string;
  /** Index of the contiguous medley run, or null for a standalone song. */
  group: number | null;
  /** A worship night's leaders, sorted ids; ABSENT when none, so snapshots taken before leaders existed compare unchanged. */
  leads?: string[];
}
```

In `songRowsFrom`, the item map adds `leads: sortedLeadIds(songItemLeadIds(s))`, and both `rows.push(...)` calls add `...(song.leads.length ? { leads: song.leads } : {})`. **[post-approval, un-reviewed: `sortedLeadIds` replaces the inline sort]**

`outboxClassify.ts`:

```ts
const leadsKey = (r: OutboxSongRow) => (r.leads ?? []).join(",");
const sameSongs = (a: OutboxSongRow[], b: OutboxSongRow[]) =>
  a.length === b.length &&
  a.every((r, n) => r.ref === b[n].ref && r.key === b[n].key && r.group === b[n].group && leadsKey(r) === leadsKey(b[n]));
```

`outboxSweep.ts` `normalizeSnapshotRows` — the flush-side reader of the STORED `beforeSongs` — must keep `leads`, or the stored side always compares leaderless against a live side that has them:

```ts
function normalizeSnapshotRows(rows: unknown): OutboxSongRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isObj).map((r, i) => {
    // Sorted and de-duplicated exactly like `songRowsFrom`, and ABSENT when
    // empty, so a snapshot stored before leaders existed compares unchanged.
    const leads = sortedLeadIds(r.leads); // [post-approval, un-reviewed: shared normalizer]
    return {
      _key: typeof r._key === "string" ? r._key : `s${i}`,
      ref: typeof r.ref === "string" ? r.ref : "",
      key: typeof r.key === "string" ? r.key : "",
      group: typeof r.group === "number" ? r.group : null,
      ...(leads.length ? { leads } : {}),
    };
  });
}
```

`notificationOutbox.ts` `outboxSongRow` fields gain `{ name: "leads", title: "Leads", type: "array", of: [{ type: "string" }], description: "Worship-night song leaders (member ids, sorted). Absent when none." }`.

**[post-approval, un-reviewed]** `app/utils/__tests__/notificationOutboxSchema.test.ts` pins the row's fields as exactly `["group", "key", "ref"]`. Update that expectation deliberately to `["group", "key", "leads", "ref"]` and keep its comment's intent (a raw `medley_tag` field must still fail it).

- [ ] **Step 4: Implement the email**

- `setlistDiff.ts`: `TableRow` gains `leads?: string[];`; the `after.map` row adds `...(r.leads?.length ? { leads: r.leads } : {})`; departed (`gone`) rows carry none.
- `notificationEmail.ts`: `songCell(title, gone, leaderText = "")` appends `leaderText ? ` <span style="color:${C.muted}">— dirige ${escapeHtml(leaderText)}</span>` : ""` inside the non-gone branch only. `songRow(row, titles, showMovement, spine, leaders)` computes `const leaderText = (row.leads ?? []).map((id) => leaders.get(id)).filter((n): n is string => !!n).join(" y ");` and passes it. Thread `leaders: Map<string, string>` through `medleyGroup`, `renderSetlistTable(rows, titles, showMovement, leaders = new Map())`, `setlistSection`, `renderLine`, and `buildGroupedEmail(o, titles, leaders = new Map())`.
- `outboxSweep.ts`: after the titles block, collect `const leaderIds = unique([...grouped.values()].flat().flatMap((l) => (l.songs ?? []).flatMap((s) => s.leads ?? [])));` (the same `grouped` map and `unique` helper the titles block uses); when non-empty, fetch `LEADER_NAMES_QUERY = *[_type == "teamMembers" && _id in $ids && defined(member_name)]{ _id, alias, member_name }` into `const leaders = new Map<string, string>()` (name = alias || member_name); pass `leaders` as the third argument of `buildGroupedEmail`. This read happens in the same read stage as the titles, before `sendStartedAt` (the budget clock). It is **best-effort**: wrap it in `try/catch`; on failure log `notify_sweep_leader_names_failed` with the error and continue with an empty map — the emails render without names, and no notice or recipient is failed for it.

- [ ] **Step 5: Run tests + gates**

Run: `npx vitest run app/utils/__tests__/outboxNotice.test.ts app/utils/__tests__/notificationEmail.test.ts app/utils/__tests__/outboxClassify.test.ts app/utils/__tests__/outboxSweep.test.ts app/utils/__tests__/notificationOutboxSchema.test.ts app/utils/__tests__/setlistDiff.test.ts && npx tsc --noEmit`
Expected: PASS. (`setlistDiff.test.ts` may not exist; drop it from the command if so.)

- [ ] **Step 6: Commit**

```bash
git add app/utils/outboxNotice.ts app/utils/outboxClassify.ts sanity/schemas/notificationOutbox.ts app/utils/setlistDiff.ts app/utils/notificationEmail.ts app/utils/outboxSweep.ts app/utils/__tests__/outboxNotice.test.ts app/utils/__tests__/notificationEmail.test.ts app/utils/__tests__/outboxClassify.test.ts app/utils/__tests__/outboxSweep.test.ts app/utils/__tests__/notificationOutboxSchema.test.ts
git commit -m "feat(notify): a change of song leader is a setlist change, and the email names the leaders"
```

---

### Task 9: Docs, decision record and full gates

**Files:**
- Create: `docs/adr/0036-worship-night-is-a-special-format.md`
- Modify: `docs/adr/README.md` (index line)
- Modify: `CLAUDE.md` and `AGENTS.md` (byte-identical: invariant + reusable utils)
- Modify: `docs/NOTIFICATIONS.md` (the setlist snapshot row now carries `leads`)
- Modify: `docs/superpowers/specs/2026-09-22-worship-night-song-leads-design.md` (status)

- [ ] **Step 1: ADR**

`docs/adr/0036-worship-night-is-a-special-format.md` following `docs/adr/TEMPLATE.md`: **Decision** — «Noche de alabanza» is `special_role.format = "worship_night"`, set once at creation, not a fourth role type. **Rejected** — a `worship_night` document type (every reader of the three role types would need a fourth branch, and specials' time, group fill, identity and notices would be lost); leaders on every special (UI noise on ordinary vigils). **Consequences** — per-song leaders live only on worship nights' own song items; the writers validate them against `Lead` under the role revision; the format cannot be changed after creation (delete and recreate an empty service); `leads` are strong references, so a member who still leads a song cannot be deleted in Studio (the same as a seat reference) — clear the song first. **[post-approval, un-reviewed: strong-reference note]** Link it from `app/utils/serviceFormat.ts`'s header comment and add its line to `docs/adr/README.md`.

- [ ] **Step 2: CLAUDE.md + AGENTS.md**

Invariants, after the special `time` bullet:

```markdown
- **A «Noche de alabanza» is `special_role.format = "worship_night"`, set once at creation** —
  never a fourth role type (ADR-0036); the PATCH route never sets or unsets it. Its songs may
  name one or two leaders (`songs[].leads`, keyed references) who must be in the set's Lead when
  written: the setlist PUT refuses anything else under the role `_rev` it asserts, approval
  carries leaders over by song reference, proposals and weekend setlists never carry them.
  `serviceFormat.ts` and `songLeads.ts` are the ONLY definitions of these rules.
```

Reusable utils, after the `upcomingMonthPills` entry:

```markdown
`isWorshipNight`/`WORSHIP_NIGHT_FORMAT` (`app/utils/serviceFormat.ts` — the ONE format
definition, neutral), `songLeads.ts` (`app/utils/` — `leadSeatIds`/`songItemLeadIds`/
`validateSongLeads`/`carryOverSongLeads`/`unassignedLeads`/`leadRosterOf`/`formatLeadNames`;
neutral, shared by the setlist and approval writers, the editor, the cards and the outbox
snapshot),
```

- [ ] **Step 3: NOTIFICATIONS.md and spec status**

Add to `docs/NOTIFICATIONS.md` where the setlist snapshot rows are described: rows may carry `leads` (sorted member ids, absent when none); a leader-only change is a setlist change; the email names the leaders, resolved in the sweep's read stage before the budget clock. Set the spec's `**Status:**` to «implemented on branch `claude/worship-night-song-leads`; not released».

- [ ] **Step 4: Full gates**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: tsc clean; all tests green (regenerate `colour-inventory.json` with `node scripts/colour-inventory.mjs` if only `filesScanned` moved); 0 eslint errors.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0036-worship-night-is-a-special-format.md docs/adr/README.md CLAUDE.md AGENTS.md docs/NOTIFICATIONS.md docs/superpowers/specs/2026-09-22-worship-night-song-leads-design.md app/utils/serviceFormat.ts app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "docs: «Noche de alabanza» — ADR-0036, invariants, notifications, spec status"
```

---

## After the tasks (coordinator)

Fresh whole-branch code review with docs audit (base = `claude/camp-group-fill` head) → one fix wave → scoped re-review → gates on the final tree → merge into `preview`, verify the dev alias → PR stacked after #91. The Studio schema changes (`specialRole.format`, `notificationOutbox` `leads`) need no data migration; a Studio schema deploy is optional (Studio is read-only for these types).
