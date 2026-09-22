# Same-day special services with a time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let several `special_role` documents share one date, each with an optional `HH:mm` time, so the camp's six worship sets each get their own ordered card and setlist.

**Architecture:** One document per set (already allowed by the data layer and by the admin grid's stored mode). This delivery adds an optional `time` string end to end — schema, projections, write parser and fingerprint, stored-mode editor and composer, member cards — and sorts same-day specials by it. The month CREATE flow is untouched except for one refusal message.

**Tech Stack:** Next.js 16 App Router, React 19, Sanity v5 (GROQ), TypeScript, Vitest + Testing Library (jsdom). Node 22.

**Spec:** `docs/superpowers/specs/2026-09-22-same-day-specials-design.md` — read it first; §4 «Amendment» explains why the planner's create flow is NOT re-keyed.

## Global Constraints

- **Spanish UI.** Every new label/copy is Spanish: «Hora», «HH:mm».
- **`time` is `"HH:mm"` 24-hour zero-padded**, validated ONLY by `isServiceTime` in `app/utils/serviceTime.ts`. Never a second regex.
- **`time` is display/sort only.** Never combine it with `date` into a `Date`; never derive "past/future" from it. `date` stays `YYYY-MM-DD`.
- **`time` is never part of a special's identity** (`special_role:<date>:<name>` stays as is). Never touch `specialIdentityCoordinator`, `roleTargetLock`, `loadTargetOccupancy`, or `draftTargetKey`/`buildColumns`/E3.
- **Fingerprint stability:** `canonicalizeCreatePayload` emits `time` only when present. `FINGERPRINT_VERSION` is not bumped.
- **Form controls are 16 px on a phone** (`text-[16px] sm:text-…`); `ui/DateField` carries it. Never a bare `<input type="time">` under `app/**`.
- **Member-facing special reads keep `published != false`.**
- **Before claiming done:** `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.
- **Conventional commits, no AI attribution / `Co-Authored-By` trailers** (CLAUDE.md overrides the harness reminder).
- Work on branch `claude/campamento-sets-app-d5466d` in this worktree.

---

### Task 1: `serviceTime` util

**Files:**
- Create: `app/utils/serviceTime.ts`
- Test: `app/utils/__tests__/serviceTime.test.ts`

**Interfaces:**
- Produces: `isServiceTime(v: unknown): v is string`, `compareServiceTime(a?: string | null, b?: string | null): number` (absent sorts last), `SERVICE_TIME_RE`.

- [x] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/serviceTime.test.ts
import { describe, expect, it } from "vitest";
import { compareServiceTime, isServiceTime } from "@/app/utils/serviceTime";

describe("isServiceTime", () => {
  it("accepts zero-padded 24-hour HH:mm", () => {
    for (const v of ["00:00", "09:00", "12:30", "18:45", "23:59"]) expect(isServiceTime(v)).toBe(true);
  });
  it("rejects everything that is not exactly HH:mm", () => {
    for (const v of ["9:00", "24:00", "18:60", "18:45:00", " 18:45", "", null, undefined, 1845, "18h45"]) {
      expect(isServiceTime(v)).toBe(false);
    }
  });
});

describe("compareServiceTime", () => {
  it("orders by clock time and puts an absent time last", () => {
    const sorted = ["18:30", undefined, "09:00", null, "12:30"].sort(compareServiceTime);
    expect(sorted).toEqual(["09:00", "12:30", "18:30", undefined, null]);
  });
  it("is 0 for equal inputs, including two absent ones", () => {
    expect(compareServiceTime("09:00", "09:00")).toBe(0);
    expect(compareServiceTime(null, undefined)).toBe(0);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/utils/__tests__/serviceTime.test.ts`
Expected: FAIL — cannot resolve `@/app/utils/serviceTime`.

- [x] **Step 3: Implement**

```ts
// app/utils/serviceTime.ts
/**
 * The ONE validator and comparator for a special service's `time` — a display
 * and sort string ("HH:mm", 24-hour, zero-padded, America/Mexico_City by
 * convention). It is NEVER combined with the service `date` into a `Date`:
 * the CDMX invariant lives on the date alone, and nothing in the app asks
 * "is this set over" from the clock time.
 *
 * Neutral module (no React, no client-only imports) so Server Components and
 * the write path share it.
 */
export const SERVICE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isServiceTime(v: unknown): v is string {
  return typeof v === "string" && SERVICE_TIME_RE.test(v);
}

/** Ascending by clock time; an absent time sorts AFTER every present one. */
export function compareServiceTime(a?: string | null, b?: string | null): number {
  const aa = isServiceTime(a) ? a : null;
  const bb = isServiceTime(b) ? b : null;
  if (aa === bb) return 0;
  if (aa === null) return 1;
  if (bb === null) return -1;
  return aa < bb ? -1 : 1;
}
```

- [x] **Step 4: Run the test**

Run: `npx vitest run app/utils/__tests__/serviceTime.test.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
git add app/utils/serviceTime.ts app/utils/__tests__/serviceTime.test.ts
git commit -m "feat(utils): serviceTime — the one HH:mm validator and comparator for special-service times"
```

---

### Task 2: Schema, projections and types

**Files:**
- Modify: `sanity/schemas/specialRole.ts` (after the `service_name` field, ~line 50)
- Modify: `app/utils/serviceReadQueries.ts:17` (`ROLE_PROJECTION`)
- Modify: `app/api/admin/roles/route.ts:65-67` (GET projection + order)
- Modify: `app/utils/interface.tsx:125` (`SpecialRole`)
- Modify: `app/components/admin/serviceCardModel.ts:119` (`ServiceRole`)
- Test: `app/utils/__tests__/serviceReadQueries.test.ts:20`

**Interfaces:**
- Produces: `SpecialRole.time?: string | null`, `ServiceRole.time?: string | null`; `ROLE_PROJECTION` and the roles GET project `time`.

- [x] **Step 1: Extend the projection test**

In `app/utils/__tests__/serviceReadQueries.test.ts`, change the fragment list in the test «role projection covers all five seat paths and identity/date fields» to include `"service_name"` and `"time"`:

```ts
    for (const frag of ["_id", "_rev", "_type", "week", "date", "service_name", "time", "Lead[]", "BGVs[]", "Chorus[]", "instruments[]", "foh_team[]", "person"]) {
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/utils/__tests__/serviceReadQueries.test.ts`
Expected: FAIL on `"time"`.

- [x] **Step 3: Schema field**

In `sanity/schemas/specialRole.ts`, directly after the `service_name` field object:

```ts
    {
      name: 'time',
      title: 'Hora',
      type: 'string',
      description: 'HH:mm, hora local (America/Mexico_City). Opcional. Ordena los sets de un mismo día; nunca cambia la fecha.',
      validation: (rule: { regex: (re: RegExp, opts: { name: string; invert: boolean }) => unknown }) =>
        rule.regex(/^([01]\d|2[0-3]):[0-5]\d$/, { name: 'HH:mm', invert: false }),
    },
```

(The document is `readOnly: true` in Studio; the validation is documentation for the Studio reader and a guard for any future write path.)

- [x] **Step 4: Projections**

`app/utils/serviceReadQueries.ts:18` — change the first line of `ROLE_PROJECTION` to:

```ts
  _id, _rev, _type, published, week, date, service_name, time,
```

`app/api/admin/roles/route.ts:65-67` — change the query head to:

```ts
    *[_type in ["sunday_role", "saturday_role", "special_role"]]
    | order(coalesce(week, date) asc, time asc) {
      _id, _rev, _type, service_name, time,
```

- [x] **Step 5: Types**

`app/utils/interface.tsx` — in `SpecialRole`, after `service_name: string;`:

```ts
  /** "HH:mm" (see `app/utils/serviceTime.ts`); absent on every special that predates it. */
  time?: string | null;
```

`app/components/admin/serviceCardModel.ts` — in `ServiceRole`, after `service_name?: string;`:

```ts
  /** Specials only — "HH:mm" or absent. Display/sort only, never identity. */
  time?: string | null;
```

- [x] **Step 6: Run tests and typecheck**

Run: `npx vitest run app/utils/__tests__/serviceReadQueries.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [x] **Step 7: Commit**

```bash
git add sanity/schemas/specialRole.ts app/utils/serviceReadQueries.ts app/api/admin/roles/route.ts app/utils/interface.tsx app/components/admin/serviceCardModel.ts app/utils/__tests__/serviceReadQueries.test.ts
git commit -m "feat(special): optional time on special_role — schema, projections, admin roles order"
```

---

### Task 3: Write path — parse, build, fingerprint, PATCH set/unset

**Files:**
- Modify: `app/utils/roleCreationReceipt.ts:35-45` (`RoleCreatePayload`), `:52-70` (`CanonicalCreatePayload`), `:121-167` (`canonicalizeCreatePayload`)
- Modify: `app/utils/roleWriteRequest.ts:201-245` (`buildRoleDocument`, `buildRoleEditPatch`), `:249-262` (`ParsedCreateRequest`), `:275-310` (`parseCreateRequest`), `:314-345` (`ParsedEditRequest`, `parseEditRequest`)
- Modify: `app/api/admin/roles/route.ts` (the `buildRoleDocument({ … })` call — grep it) and `app/api/admin/roles/[id]/route.ts:157-165, 272-282`
- Test: `app/utils/__tests__/roleWriteRequest.test.ts`, `app/utils/__tests__/roleCreationReceipt.test.ts`

**Interfaces:**
- Consumes: `isServiceTime` (Task 1).
- Produces: `ParsedCreateRequest.time: string | null`, `ParsedEditRequest.time: string | null`, `buildRoleEditPatch(...)` now returns `{ set: Record<string, unknown>; unset: string[] }`, `CanonicalCreatePayload.time?: string`.

- [x] **Step 1: Write the failing tests**

Append to `app/utils/__tests__/roleWriteRequest.test.ts`:

```ts
describe("special-service time", () => {
  const special = (over: Record<string, unknown> = {}) =>
    createBody({ _type: "special_role", service_name: "Campamento · Alabanza", ...over });

  it("create: absent, null and empty mean no time", () => {
    for (const time of [undefined, null, ""]) {
      const parsed = parseCreateRequest(special(time === undefined ? {} : { time }));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value.time).toBeNull();
    }
  });

  it("create: a valid HH:mm is carried; anything else is issue `time`", () => {
    const ok = parseCreateRequest(special({ time: "18:45" }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.time).toBe("18:45");
    for (const time of ["9:00", "24:00", "18:60", 1845]) {
      expect(parseCreateRequest(special({ time }))).toMatchObject({ ok: false, issues: ["time"] });
    }
  });

  it("create: a weekend role refuses a time instead of silently dropping it", () => {
    expect(parseCreateRequest(createBody({ time: "09:00" }))).toMatchObject({ ok: false, issues: ["time"] });
  });

  it("create: the fingerprint ignores an absent time and changes with a present one", () => {
    const base = special();
    expect(payloadFingerprint({ ...base, time: null })).toBe(payloadFingerprint(base));
    expect(payloadFingerprint({ ...base, time: "" })).toBe(payloadFingerprint(base));
    expect(payloadFingerprint({ ...base, time: "09:00" })).not.toBe(payloadFingerprint(base));
  });

  it("edit: parses time like create and does not know the stored type", () => {
    const ok = parseEditRequest({ rev: "r1", date: "2026-10-03", _type: "special_role", service_name: "X", time: "12:30" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.time).toBe("12:30");
    expect(parseEditRequest({ rev: "r1", date: "2026-10-03", time: "12:3" })).toMatchObject({ ok: false, issues: ["time"] });
    const none = parseEditRequest({ rev: "r1", date: "2026-10-03" });
    if (none.ok) expect(none.value.time).toBeNull();
  });

  it("document and patch: time is written only when present, and unset when absent", () => {
    const seats = normalizeSeats(special());
    const nextKey = () => "k";
    const withTime = buildRoleDocument({ roleId: "special_role.x", roleType: "special_role", date: "2026-10-03", serviceName: "X", time: "09:00", published: false, seats, receiptId: "rc", fingerprint: "fp", nextKey });
    expect(withTime.time).toBe("09:00");
    const without = buildRoleDocument({ roleId: "special_role.x", roleType: "special_role", date: "2026-10-03", serviceName: "X", time: null, published: false, seats, receiptId: "rc", fingerprint: "fp", nextKey });
    expect("time" in without).toBe(false);

    const patchWith = buildRoleEditPatch({ roleType: "special_role", date: "2026-10-03", serviceName: "X", time: "09:00", seats, nextKey });
    expect(patchWith.set.time).toBe("09:00");
    expect(patchWith.unset).toEqual([]);
    const patchWithout = buildRoleEditPatch({ roleType: "special_role", date: "2026-10-03", serviceName: "X", time: null, seats, nextKey });
    expect("time" in patchWithout.set).toBe(false);
    expect(patchWithout.unset).toEqual(["time"]);
    const weekend = buildRoleEditPatch({ roleType: "sunday_role", date: "2026-10-04", serviceName: null, time: null, seats, nextKey });
    expect(weekend.unset).toEqual([]);
  });
});
```

Then fix every EXISTING call of `buildRoleEditPatch(...)` in that test file that reads the return as a flat object: they now read `.set` (grep `buildRoleEditPatch(` in the test; each `expect(patch.week)` / `expect(patch.service_name)` becomes `expect(patch.set.week)` etc.).

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run app/utils/__tests__/roleWriteRequest.test.ts`
Expected: FAIL — `time` undefined on parsed values, `buildRoleEditPatch` has no `set`.

- [x] **Step 3: Canonical payload**

`app/utils/roleCreationReceipt.ts`:

In `RoleCreatePayload` add `time?: unknown;` after `service_name?: unknown;`.

In `CanonicalCreatePayload` add, after `serviceName: string | null;`:

```ts
  /**
   * Present ONLY when the request carried a valid time. Omitted otherwise so
   * the fingerprint of every time-less payload is byte-identical to what it
   * was before the field existed (an in-flight retry across the deploy still
   * matches its receipt). Never `null` here — that would change every hash.
   */
  time?: string;
```

In `canonicalizeCreatePayload`, after the `serviceName` block (line ~137) add:

```ts
  // `time` is optional and specials-only. Absent/null/"" is "no time"; any
  // other value must be HH:mm; a weekend role refuses one outright rather than
  // dropping it — the fingerprint must describe what gets written.
  const rawTime = doc.time;
  const hasTime = rawTime !== undefined && rawTime !== null && rawTime !== "";
  const time = hasTime && isServiceTime(rawTime) ? rawTime : null;
  if (hasTime && !time) issues.push("time");
  if (time && roleType !== "special_role") issues.push("time");
```

and in the returned `canonical` object, after `serviceName,`:

```ts
      ...(time && roleType === "special_role" ? { time } : {}),
```

Add `import { isServiceTime } from "./serviceTime";` at the top.

- [x] **Step 4: Parser and builders**

`app/utils/roleWriteRequest.ts`:

`ParsedCreateRequest`: add `time: string | null;` after `serviceName`. In `parseCreateRequest`'s returned value add `time: canonical.time ?? null,` after `serviceName: canonical.serviceName,`.

`ParsedEditRequest`: add `time: string | null;` after `serviceName`. In `parseEditRequest`, before the `return`:

```ts
  const rawTime = body.time;
  const hasTime = rawTime !== undefined && rawTime !== null && rawTime !== "";
  if (hasTime && !isServiceTime(rawTime)) return fail(["time"]);
```

and in the returned value add `time: hasTime ? (rawTime as string) : null,`.

`buildRoleDocument`: add `time: string | null;` to the input type and, after the `service_name` spread:

```ts
    ...(input.roleType === "special_role" && input.time ? { time: input.time } : {}),
```

`buildRoleEditPatch` becomes:

```ts
export function buildRoleEditPatch(input: {
  roleType: RoleType;
  date: string;
  serviceName: string | null;
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
    // Clearing the field in the editor must really clear it; a weekend role
    // never stored one, so it has nothing to unset.
    unset: special && !input.time ? ["time"] : [],
  };
}
```

Add `import { isServiceTime } from "./serviceTime";`.

- [x] **Step 5: Routes**

`app/api/admin/roles/route.ts`: find the `buildRoleDocument({` call and add `time: request.time,` next to `serviceName: request.serviceName,`.

`app/api/admin/roles/[id]/route.ts`: after the `service_name` integrity check (~line 165) add:

```ts
  if (roleType !== "special_role" && request.time) {
    return reject(serviceError("invalid_request", { details: { issues: ["time"] } }));
  }
```

Change lines 272–282 to:

```ts
  const editPatch = buildRoleEditPatch({
    roleType,
    date: newDate,
    serviceName: request.serviceName,
    time: request.time,
    seats: request.seats,
    nextKey,
  });

  let tx = writeClient
    .transaction()
    .patch(role._id, (p) => {
      const patched = p.ifRevisionId(role._rev).set(editPatch.set);
      return editPatch.unset.length ? patched.unset(editPatch.unset) : patched;
    });
```

Grep the rest of that route for `setPayload` (it is referenced again for the notice/after block) and replace each with `editPatch.set`.

- [x] **Step 6: Run tests + typecheck**

Run: `npx vitest run app/utils/__tests__/roleWriteRequest.test.ts app/utils/__tests__/roleCreationReceipt.test.ts app/utils/__tests__/monthDraftCreate.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean (the `[id]` route and any other `buildRoleEditPatch` reader now use `.set`).

- [x] **Step 7: Commit**

```bash
git add app/utils/roleCreationReceipt.ts app/utils/roleWriteRequest.ts app/api/admin/roles/route.ts "app/api/admin/roles/[id]/route.ts" app/utils/__tests__/roleWriteRequest.test.ts
git commit -m "feat(roles): accept an optional HH:mm time on special_role writes

Validated by the one serviceTime validator, refused on weekend types, written
only when present and unset when cleared. The canonical create payload carries
time only when present so every time-less fingerprint is unchanged."
```

---

### Task 4: Stored grid model and save serializer

**Files:**
- Modify: `app/components/admin/plannerModel.ts:134-149` (`GridColumn`)
- Modify: `app/components/admin/storedRoleReadModel.ts:110-123` (`translateStoredRole`), `:176-190` (`parseRole`)
- Modify: `app/components/admin/plannerSaveModel.ts:5-27, 76-82, 119-140` (`RoleSemanticSnapshot`, `StoredRolePatchBody`, `serializeStoredColumn`, `semanticSnapshot`)
- Test: `app/components/admin/__tests__/plannerSaveModel.test.ts`, `app/components/admin/__tests__/storedRoleReadModel.test.ts`

**Interfaces:**
- Produces: `GridColumn.time?: string`, `StoredRolePatchBody.time?: string`, `RoleSemanticSnapshot.time: string | null`, serialization reason `"invalid_special_time"`.

- [x] **Step 1: Failing tests**

Append to `app/components/admin/__tests__/plannerSaveModel.test.ts` (reuse the file's `rows` and `cells` fixtures; build a special column from the existing `column`):

```ts
describe("special-service time", () => {
  const specialCells: GridCell[] = cells.map((cell) => ({ ...cell, columnId: "special-1" }));
  const special: StoredGridColumn = { ...column, columnId: "special-1", roleId: "special-1", type: "special_role", serviceName: "Campamento · Alabanza" };

  it("emits the time in the PATCH body and the snapshot, and its absence as null", () => {
    const timed = serializeStoredColumn({ ...special, time: "09:00" }, rows, specialCells);
    expect(timed.ok).toBe(true);
    if (timed.ok) {
      expect(timed.body.time).toBe("09:00");
      expect(timed.snapshot.time).toBe("09:00");
    }
    const untimed = serializeStoredColumn(special, rows, specialCells);
    expect(untimed.ok).toBe(true);
    if (untimed.ok) {
      expect("time" in untimed.body).toBe(false);
      expect(untimed.snapshot.time).toBeNull();
    }
  });

  it("a changed time is a semantic change", () => {
    const a = serializeStoredColumn({ ...special, time: "09:00" }, rows, specialCells);
    const b = serializeStoredColumn({ ...special, time: "12:30" }, rows, specialCells);
    expect(a.ok && b.ok && sameRoleSemantics(a.snapshot, b.snapshot)).toBe(false);
  });

  it("refuses a malformed time instead of sending it", () => {
    const bad = serializeStoredColumn({ ...special, time: "9:00" }, rows, specialCells);
    expect(bad).toMatchObject({ ok: false, reasons: ["invalid_special_time"] });
  });

  it("a weekend column never carries a time", () => {
    const weekend = serializeStoredColumn({ ...column, time: "09:00" }, rows, cells);
    expect(weekend.ok).toBe(true);
    if (weekend.ok) {
      expect("time" in weekend.body).toBe(false);
      expect(weekend.snapshot.time).toBeNull();
    }
  });
});
```

Append to `app/components/admin/__tests__/storedRoleReadModel.test.ts` (inside the file, using its `role`/`target`/`summary` helpers — read the file's `summary` helper name first and mirror the existing «readOnly» test's shape):

```ts
describe("special-service time", () => {
  it("translateStoredRole carries a special's time onto its column", () => {
    const special = role({ _id: "special-1", _type: "special_role", service_name: "Campamento · Alabanza", time: "18:45" });
    const specialTarget = target({ type: "special_role", targetKey: "special-1", records: [{ ...target().records[0]!, type: "special_role", targetKey: "special-1" }] });
    const joined = joinStoredRoleInventory([special], summary([specialTarget]));
    expect(joined.coherent).toBe(true);
    expect(translateStoredRole(joined.roles[0]!)?.column).toMatchObject({ serviceName: "Campamento · Alabanza", time: "18:45" });
  });

  it("parseRole refuses a malformed time on a special", () => {
    const special = role({ _id: "special-1", _type: "special_role", service_name: "X", time: "9:00" });
    const specialTarget = target({ type: "special_role", targetKey: "special-1", records: [{ ...target().records[0]!, type: "special_role", targetKey: "special-1" }] });
    expect(joinStoredRoleInventory([special], summary([specialTarget])).coherent).toBe(false);
  });
});
```

If the `target`/`summary` shape for a special needs different fields (check the existing «special» cases in that test file with `grep -n special_role`), copy the shape those tests use.

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run app/components/admin/__tests__/plannerSaveModel.test.ts app/components/admin/__tests__/storedRoleReadModel.test.ts`
Expected: FAIL (no `time` on body/snapshot/column).

- [x] **Step 3: Model**

`app/components/admin/plannerModel.ts` — in `GridColumn`, after `serviceName?: string;`:

```ts
  /**
   * SPECIALS ONLY — the set's "HH:mm" (`app/utils/serviceTime.ts`). Display and
   * order only: NOT identity (E19 — a special's identity is `date + name`), not
   * part of any collision key, and never set on a weekend column.
   */
  time?: string;
```

`app/components/admin/storedRoleReadModel.ts`:

In `parseRole`, after the `service_name` check:

```ts
  if (value._type === "special_role" && value.time != null && value.time !== "" && !isServiceTime(value.time)) return null;
```

In `translateStoredRole`'s `column` literal, after the `serviceName` spread:

```ts
    ...(role._type === "special_role" && isServiceTime(role.time) ? { time: role.time } : {}),
```

Add `import { isServiceTime } from "@/app/utils/serviceTime";`.

- [x] **Step 4: Serializer**

`app/components/admin/plannerSaveModel.ts`:

`RoleSemanticSnapshot`: add `time: string | null;` after `serviceName`.
`StoredRolePatchBody`: add `time?: string;` after `service_name?: string;`.

In `serializeStoredColumn`, after the `invalid_special_name` check:

```ts
  if (column.type === "special_role" && column.time != null && column.time !== "" && !isServiceTime(column.time)) {
    reasons.add("invalid_special_time");
  }
```

In the `body` literal, after the `service_name` spread:

```ts
    ...(column.type === "special_role" && isServiceTime(column.time) ? { time: column.time } : {}),
```

In `semanticSnapshot`, after `serviceName: …,`:

```ts
    time: body._type === "special_role" && isServiceTime(body.time) ? body.time : null,
```

Add `import { isServiceTime } from "@/app/utils/serviceTime";`.

- [x] **Step 5: Run tests + typecheck**

Run: `npx vitest run app/components/admin && npx tsc --noEmit`
Expected: PASS. If any existing snapshot fixture in `plannerSaveModel.test.ts` is compared with `toEqual` against a literal `RoleSemanticSnapshot`, add `time: null` to that literal.

- [x] **Step 6: Commit**

```bash
git add app/components/admin/plannerModel.ts app/components/admin/storedRoleReadModel.ts app/components/admin/plannerSaveModel.ts app/components/admin/__tests__/plannerSaveModel.test.ts app/components/admin/__tests__/storedRoleReadModel.test.ts
git commit -m "feat(admin): stored grid carries a special's time through the column, the PATCH body and the semantic snapshot"
```

---

### Task 5: Admin UI — `DateField kind="time"`, stored header, composer, calendar copy

**Files:**
- Modify: `app/components/ui/DateField.tsx:27` (`kind` union)
- Modify: `app/components/admin/PlannerGrid.tsx:231, 2307, 2360-2373` (header prop type + «Hora» field)
- Modify: `app/components/admin/MonthGenerator.tsx:1773` (`storedHeaderEdits` type), `:1779` (composer state), `:1782` (`createAttempt` ref type — only if it names the target shape), `:2494` (`handleStoredHeaderChange` signature), `:2574-2612` (`handleCreateOne`), `:3524-3529` (composer «Nombre» → add «Hora»), `:1963-1970` (`storedSectionServiceOptions` label)
- Modify: `app/utils/monthDraftCreate.ts:24-40, 56-73` (`CreatableDraft.time?`, `draftCreateBody`)
- Modify: `app/components/admin/MonthCalendar.tsx:164-167` (rule 4 copy)
- Test: `app/components/ui/__tests__/DateField.test.tsx`, `app/components/admin/__tests__/PlannerGrid.test.tsx`, `app/components/admin/__tests__/MonthCalendar.test.tsx:240`, `app/utils/__tests__/monthDraftCreate.test.ts`

**Interfaces:**
- Consumes: `GridColumn.time` (Task 4), `isServiceTime` (Task 1).
- Produces: `onStoredHeaderChange(columnId, { date?, serviceName?, time? })`; `draftCreateBody` emits `time` for specials when present.

- [x] **Step 1: Failing tests**

`app/components/ui/__tests__/DateField.test.tsx` — add:

```ts
  it("time kind is the native time input", () => {
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => e.target.value);
    render(<DateField kind="time" id="t" label="Hora" value="09:00" onChange={onChange} />);
    const input = screen.getByLabelText("Hora") as HTMLInputElement;
    expect(input.type).toBe("time");
    fireEvent.change(input, { target: { value: "18:45" } });
    expect(onChange).toHaveReturnedWith("18:45");
  });
```

`app/components/admin/__tests__/PlannerGrid.test.tsx` — inside `describe("PlannerGrid — row management")`, add a test. First read how `baseProps` builds `columns` (grep `columns:` in the file's `baseProps`) and pass a special stored column the same way the existing stored tests do:

```ts
  it("a stored special column edits its time through onStoredHeaderChange", () => {
    const onStoredHeaderChange = vi.fn();
    render(
      <PlannerGrid
        {...baseProps({
          mode: "stored",
          columns: [{ columnId: "special-1", roleId: "special-1", rev: "r", type: "special_role", date: "2026-10-03", serviceName: "Campamento · Alabanza", time: "09:00", published: false, admission: "approved" }],
          cells: [],
          onStoredHeaderChange,
        })}
      />,
    );
    const hora = screen.getByLabelText("Hora") as HTMLInputElement;
    expect(hora.type).toBe("time");
    expect(hora.value).toBe("09:00");
    fireEvent.change(hora, { target: { value: "12:30" } });
    expect(onStoredHeaderChange).toHaveBeenCalledWith("special-1", { time: "12:30" });
  });
```

(If `baseProps` does not accept `columns`, look at how `MonthGenerator.stored.test.tsx` or the existing stored tests in `PlannerGrid.test.tsx` seed a special column and mirror that; the assertion stays the same.)

`app/components/admin/__tests__/MonthCalendar.test.tsx:240` — change the expected text to the new copy:

```ts
    expect(screen.getByText(/ya tiene un servicio especial guardado: «Bautizos». Para agregar otro set ese día usa «\+ Nuevo servicio»/)).toBeTruthy();
```

`app/utils/__tests__/monthDraftCreate.test.ts` — add:

```ts
  it("draftCreateBody emits time for a special only when present", () => {
    const base = { localId: "l", creationRequestId: "req-abc-0001", _type: "special_role" as const, date: "2026-10-03", service_name: "X", leads: [], bgvs: [], chorus: [], instruments: [], foh: [] };
    expect(draftCreateBody({ ...base, time: "09:00" }, false)).toMatchObject({ time: "09:00" });
    expect("time" in draftCreateBody(base, false)).toBe(false);
    expect("time" in draftCreateBody({ ...base, _type: "sunday_role", time: "09:00" }, false)).toBe(false);
  });
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run app/components/ui/__tests__/DateField.test.tsx app/components/admin/__tests__/PlannerGrid.test.tsx app/components/admin/__tests__/MonthCalendar.test.tsx app/utils/__tests__/monthDraftCreate.test.ts`
Expected: FAIL on the four new/changed cases.

- [x] **Step 3: `DateField`**

`app/components/ui/DateField.tsx:27` — `kind: "date" | "month" | "time";`. Update the header comment's first line to «The ONE date/month/time field». Nothing else changes (`type={kind}` already forwards it).

- [x] **Step 4: `draftCreateBody`**

`app/utils/monthDraftCreate.ts` — in `CreatableDraft`, after `service_name?: string;`:

```ts
  /** SPECIALS ONLY, optional. "HH:mm" — emitted only when present (see `draftCreateBody`). */
  time?: string;
```

In `draftCreateBody`, after the `service_name` spread:

```ts
    ...(draft._type === "special_role" && draft.time ? { time: draft.time } : {}),
```

- [x] **Step 5: Stored header**

`app/components/admin/PlannerGrid.tsx` — both `onStoredHeaderChange` prop types (lines 231 and 2307) become:

```ts
  onStoredHeaderChange?: (columnId: string, patch: { date?: string; serviceName?: string; time?: string }) => void;
```

At line 2373, directly after the «Nombre» `</label>` and still inside `{column.type === "special_role" && ( … )}`, add — so the fragment now holds the name label and the time field:

```tsx
              <DateField
                kind="time"
                size="sm"
                id={`col-time-${column.columnId}`}
                label="Hora"
                value={column.time ?? ""}
                disabled={readOnly || mutationLocked}
                onChange={(event) => onStoredHeaderChange?.(column.columnId, { time: event.target.value })}
              />
```

Wrap the two in a `<>…</>` fragment if the conditional currently returns a single `<label>`.

- [x] **Step 6: `MonthGenerator`**

- Line 1773: `useState<Map<string, { date?: string; serviceName?: string; time?: string }>>(new Map())`.
- Line 2494 `handleStoredHeaderChange(columnId: string, patch: { date?: string; serviceName?: string; time?: string })`.
- Composer state, after line 1779: `const [createTime, setCreateTime] = useState("");`
- In `handleCreateOne`, after `normalizedName`:

```ts
    const createTimeValue = createType === "special_role" && createTime ? createTime : null;
    if (createTimeValue && !isServiceTime(createTimeValue)) {
      setSaveNotice("La hora debe ser HH:mm.");
      return;
    }
```

  change `const target = { type: createType, date: createDate, name: normalizedName };` to `const target = { type: createType, date: createDate, name: normalizedName, time: createTimeValue };` — if `createAttempt`'s ref type (line 1782) spells the target shape, add `time: string | null` there too — and in the `draftCreateBody({ … })` call add `...(createTimeValue ? { time: createTimeValue } : {}),` after the `service_name` spread.
- Composer JSX (line ~3524): replace the `{createType === "special_role" ? ( <label>…Nombre…</label> ) : <div />}` block with:

```tsx
              {createType === "special_role" ? (
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <label className="space-y-1 font-label text-[10px] uppercase tracking-widest text-mono-500">
                    Nombre
                    <input value={createName} disabled={storedMutationLocked} onChange={(event) => setCreateName(event.target.value)} className={inCls} placeholder="Nombre del servicio" />
                  </label>
                  <DateField
                    kind="time"
                    id="mg-create-time"
                    label="Hora"
                    value={createTime}
                    disabled={storedMutationLocked}
                    onChange={(event) => setCreateTime(event.target.value)}
                  />
                </div>
              ) : <div />}
```

- `storedSectionServiceOptions` label (line ~1967): `label: \`${fmtDate(column.date)} · ${SERVICE_LABEL[column.type]}${column.type === "special_role" ? \` · ${column.serviceName}${column.time ? \` · ${column.time}\` : ""}\` : ""}\`,`
- Add `import { isServiceTime } from "@/app/utils/serviceTime";`.
- Wherever the composer resets `createName` after a successful create (grep `setCreateName("")`), also `setCreateTime("")`.

- [x] **Step 7: `MonthCalendar` copy**

`app/components/admin/MonthCalendar.tsx:166` becomes:

```ts
    return `El ${longDate(date)} ya tiene un servicio especial guardado${name ? `: «${name}»` : ""}. Para agregar otro set ese día usa «+ Nuevo servicio» en los servicios guardados.`;
```

Update the doc comment above `refuseSpecialOn` (rule 4) with one sentence: «A second set on a stored date is created from stored mode's composer, which is name-aware; this flow drafts one special per date on purpose (E19).»

- [x] **Step 8: Run tests + gates**

Run: `npx vitest run app/components/ui app/components/admin app/utils/__tests__/monthDraftCreate.test.ts && npx tsc --noEmit && npx eslint app/components/admin app/components/ui app/utils`
Expected: PASS, tsc clean, 0 eslint errors. `inputFontSize.test.ts` must still pass (the composer's `DateField` uses the default `md` size, 16 px on a phone).

- [x] **Step 9: Commit**

```bash
git add app/components/ui/DateField.tsx app/components/admin/PlannerGrid.tsx app/components/admin/MonthGenerator.tsx app/components/admin/MonthCalendar.tsx app/utils/monthDraftCreate.ts app/components/ui/__tests__/DateField.test.tsx app/components/admin/__tests__/PlannerGrid.test.tsx app/components/admin/__tests__/MonthCalendar.test.tsx app/utils/__tests__/monthDraftCreate.test.ts
git commit -m "feat(admin): set and edit a special's time in stored mode; calendar points a second same-day set at «+ Nuevo servicio»"
```

---

### Task 6: Member UI — ordered same-day cards with a time

**Files:**
- Modify: `app/components/DayCard.tsx:21-30` (`DayCardProps.time`), `:198` (header)
- Modify: `app/components/CalendarView.tsx:47-57` (`ActiveDay.time`) and the place it builds `DayCardProps` from an `ActiveDay` (grep `day={` or `{...entry}` in that file)
- Modify: `app/(client)/page.tsx:59-70` (query), `:151-166` (props)
- Modify: `app/(client)/schedule/page.tsx:46-55` (query), `:148-166` (push)
- Modify: `app/(client)/me/page.tsx:184-186` (query), `:300-306` (sort), `:312-323` (`cardProps`)
- Test: `app/components/__tests__/dayCard.test.tsx`

**Interfaces:**
- Consumes: `compareServiceTime` (Task 1), `SpecialRole.time` (Task 2).
- Produces: `DayCardProps.time?: string | null`, `ActiveDay.time?: string | null`.

- [x] **Step 1: Failing test**

Add to `app/components/__tests__/dayCard.test.tsx`, inside `describe("DayCard")`:

```ts
  it("shows the set's time after the date, and nothing when there is none", () => {
    mount({ day: "Campamento · Alabanza", time: "18:45" });
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/Campamento · Alabanza\s*·\s*13\s*sep\s*·\s*18:45/i);
    cleanup();
    mount({ day: "Campamento · Alabanza" });
    expect(screen.getByRole("heading", { level: 3 }).textContent).not.toMatch(/\d\d:\d\d/);
  });
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run app/components/__tests__/dayCard.test.tsx`
Expected: FAIL (no time in the heading).

- [x] **Step 3: `DayCard`**

In `DayCardProps`, after `date?: string;`:

```ts
  /** "HH:mm" for a same-day set; rendered after the date. Display only. */
  time?: string | null;
```

Destructure `time` where `day`/`date` are destructured, then change line 198 to:

```tsx
                {day}{shortDate && <span className={`${t.accentMuted} font-normal`}> · {shortDate}</span>}{time && <span className={`${t.accentMuted} font-normal tabular-nums`}> · {time}</span>}
```

- [x] **Step 4: Queries and props**

`app/(client)/page.tsx:59` — the specials query becomes `… && published != false] | order(date asc, time asc) {` and its projection adds `time,` next to `service_name`. In the specials `.map` (line ~156) add `time: sp.time ?? null,` after `date: sp.date,`.

`app/(client)/schedule/page.tsx:46` — same `order(date asc, time asc)` and `time` in the projection. In the `push` for specials add `time: sp.time ?? null,` after `date: dateStr,`. In `app/components/CalendarView.tsx` add `time?: string | null;` to `ActiveDay` and pass it to the `DayCard` it renders (`time={entry.time}` next to `day={entry.day}` — grep the one render site).

`app/(client)/me/page.tsx:184` — `order(date asc, time asc)` and add `time,` to the projection after `service_name`. Add `time?: string | null` to the local `RoleDoc` type (grep `type RoleDoc`). Change the sort at line ~306 to:

```ts
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || compareServiceTime(a.doc.time, b.doc.time));
```

and in `cardProps` add `time: doc.time ?? null,` after `date: dateKey,`. Import `compareServiceTime` from `@/app/utils/serviceTime`.

- [x] **Step 5: Run tests + gates**

Run: `npx vitest run app/components/__tests__ app/utils/__tests__/draftGatingCoverage.test.ts && npx tsc --noEmit && npx eslint "app/(client)" app/components`
Expected: PASS, tsc clean, 0 errors. `draftGatingCoverage.test.ts` still sees `published != false` on the three edited reads.

- [x] **Step 6: Commit**

```bash
git add app/components/DayCard.tsx app/components/CalendarView.tsx "app/(client)/page.tsx" "app/(client)/schedule/page.tsx" "app/(client)/me/page.tsx" app/components/__tests__/dayCard.test.tsx
git commit -m "feat(home,schedule,me): same-day specials ordered by time, with the time on the card"
```

---

### Task 7: Docs and full gates

**Files:**
- Modify: `CLAUDE.md` (invariants list, after the «Five member-referencing seats» bullet at line ~172)
- Modify: `docs/NOTIFICATIONS.md` («## Landmines», line ~645)
- Modify: `docs/superpowers/specs/2026-09-22-same-day-specials-design.md` (status line)

- [x] **Step 1: `CLAUDE.md` invariant**

Add after the five-seats bullet:

```markdown
- **A special's `time` (`"HH:mm"`) is display and sort only — never identity.** Identity
  stays `date + normalized service_name` (ADR-0011); two sets on one day need different
  names. `isServiceTime`/`compareServiceTime` (`app/utils/serviceTime.ts`) are the ONLY
  validator and comparator, and `time` is never combined with `date` into a `Date`.
  **Same-day sets are created in `/admin` stored mode («+ Nuevo servicio»)**, which keys
  specials by `_id`/`date|name`; the month CREATE flow drafts one special per date on
  purpose (E19 in `plannerModel.ts`) — do not re-key it.
```

- [x] **Step 2: `docs/NOTIFICATIONS.md` landmine**

Add a bullet under «## Landmines»:

```markdown
- **Same-day special sets notify per document.** Six camp sets are six `special_role`
  documents; a member seated in five Saturday sets gets up to five assignment notices
  (debounced per the outbox rules) and five reminders. Grouping them is not built.
```

- [x] **Step 3: Spec status**

Change the spec's `**Status:**` to «implemented on branch `claude/campamento-sets-app-d5466d`; not released».

- [x] **Step 4: Full gates**

Run:

```bash
npx tsc --noEmit && npm test && npx eslint .
```

Expected: tsc clean, every test green, eslint 0 errors.

- [x] **Step 5: Commit**

```bash
git add CLAUDE.md docs/NOTIFICATIONS.md docs/superpowers/specs/2026-09-22-same-day-specials-design.md
git commit -m "docs: special time invariant, same-day sets notify per document"
```

---

## After the tasks (coordinator, not a task)

Per CLAUDE.md: fresh code review of the merge range → fix → re-verify the fix → merge into `preview`, push, verify the dev alias (`dev-owt-backstage.vercel.app` in `alias`, `meta.githubCommitSha` = pushed commit) → look at `/admin` October stored mode: create two specials on 2026-10-03 with times, confirm home orders them → PR to `main`, wait for `gates` → merge → verify the production alias. Then Frank creates the six sets.
