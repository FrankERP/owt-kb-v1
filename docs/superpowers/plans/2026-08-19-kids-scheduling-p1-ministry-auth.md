# Kids Scheduling P1 — Ministry Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ministry membership + ministry-scoped management on `teamMembers`, enforced by new server-side guards, with two-way worship/kids isolation (only `super-admin` spans both).

**Architecture:** A code-level ministry registry (`app/ministries.ts`); two new array fields on `teamMembers` (absent = worship, no migration); the existing 30s-TTL `getMemberAccess` snapshot extended to carry them; the JWT/session carrying them too (free — `auth.ts` already calls `getMemberAccess` on every token refresh) so client nav can filter by ministry; two new guards in `authGuards.ts` beside the existing ones; super-admin-only editing via the existing members routes, touched-field-only so an unrelated edit cannot silently wipe a privilege; worship member pages/APIs gated on worship membership.

**Tech Stack:** Next.js 16 App Router (server components + route handlers), NextAuth v4 session (`session.user.role`, `session.user.sanityId`), Sanity via `serverClient`/`writeClient`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-kids-ministry-scheduling-design.md` (§3, §5, §5.1)

**RISK TIER: CRITICAL by the ladder, LOWERED TO STANDARD by Frank's explicit decision on 2026-08-19** — one fresh cold `APPROVED` instead of two on byte-identical text.

This is a **judgment call against the ladder, not a derivation from it**, and it is recorded here so no later reader mistakes it for a rule: the artifact does change an auth/trust boundary, which the ladder classifies as critical. The decision was taken after three substantive review rounds (blockers 3 → 2 → 1, every one of them in the admin UI or page gating, none in the guards or schema), on the reasoning that the loop had extracted its value and the remaining bar is better spent on the post-implementation review of the actual diff. The churn-cap escalation and this re-tier are both in the worklog for `feat/kids-scheduling`.

P2 (`2026-08-19-kids-scheduling-p2-kids-vertical.md`) is standard by the ladder and needs no plan review.

## Global Constraints

- Spanish-language UI copy; dark and light themes.
- Gates before done: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.
- **The storage contract for `ministries`, in one line each — the two cases are NOT the same and conflating them fails open:**
  - **Absent** ⇒ read as `["worship"]`. This is the legacy rule that makes the change migration-free: every member predating Kids is a worship member.
  - **Explicitly empty (`[]`)** ⇒ **rejected at every write boundary, never stored.** A read that meets one anyway still yields `["worship"]` (defence in depth), but no writer may create that state. Storing `[]` would mean "belongs to nothing" while *reading* as full worship access — the UI would show zero ticked boxes for someone holding the entire catalog.
  - Every read goes through `normalizeMinistries`; every write goes through the shared validator. Neither rule is restated anywhere else.
- Plain `admin`/`content-editor` are worship-scoped; they get NOTHING in kids. Only `super-admin` spans ministries.
- `managesMinistries` grants management of the named ministry only; it does not imply membership.
- Guards compose with `isMemberActive`/`disabled` (never bypass them).
- Never add AI attribution to commits; conventional commits.

---

### Task 1: Ministry registry

**Files:**
- Create: `app/ministries.ts`
- Test: `app/utils/__tests__/ministries.test.ts`

**Interfaces:**
- Produces, **all five in this task** (Task 1's test asserts each): `MINISTRIES` const, `MinistryId` type (`"worship" | "kids"`), `ALL_MINISTRY_IDS: MinistryId[]`, `isMinistryId(x: unknown): x is MinistryId`, `normalizeMinistries(v: unknown): MinistryId[]` (the one READ rule), `MANAGEABLE_MINISTRY_IDS: MinistryId[]`, and `validateMinistryWrite(field, value): string | null` (the one WRITE rule).

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/ministries.test.ts
import { describe, it, expect } from "vitest";
import { MINISTRIES, ALL_MINISTRY_IDS, isMinistryId, normalizeMinistries, validateMinistryWrite } from "@/app/ministries";

describe("ministry registry", () => {
  it("registers worship and kids with Spanish display names", () => {
    expect(MINISTRIES.worship).toEqual({ id: "worship", name: "Alabanza" });
    expect(MINISTRIES.kids).toEqual({ id: "kids", name: "Oasis Kids" });
    expect(ALL_MINISTRY_IDS).toEqual(["worship", "kids"]);
  });
  it("narrows ids", () => {
    expect(isMinistryId("kids")).toBe(true);
    expect(isMinistryId("worship")).toBe(true);
    expect(isMinistryId("youth")).toBe(false);
    expect(isMinistryId(undefined)).toBe(false);
  });
  it("normalizes stored values — the ONE rule every reader shares", () => {
    expect(normalizeMinistries(undefined)).toEqual(["worship"]);   // legacy member
    expect(normalizeMinistries([])).toEqual(["worship"]);          // emptied array
    expect(normalizeMinistries(["kids"])).toEqual(["kids"]);
    expect(normalizeMinistries(["worship", "kids"])).toEqual(["worship", "kids"]);
    expect(normalizeMinistries("worship")).toEqual(["worship"]);   // non-array junk
    expect(normalizeMinistries(["toString"])).toEqual(["worship"]); // unknown ids dropped
  });
  it("REJECTS prototype keys — an `in` check would accept all of these", () => {
    // `"constructor" in MINISTRIES` is true. This function validates an auth
    // field; a member stored as a member of `toString` belongs to nothing.
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(isMinistryId(key), `${key} must not validate`).toBe(false);
    }
  });
  it("rejects an explicitly empty ministries array at the write boundary", () => {
    // `[].every(isMinistryId)` is vacuously true, so a naive validator accepts
    // it and normalizeMinistries reads it back as full worship access.
    expect(validateMinistryWrite("ministries", [])).toBe("Elige al menos un ministerio.");
    expect(validateMinistryWrite("ministries", ["kids"])).toBeNull();
    expect(validateMinistryWrite("ministries", ["youth"])).toBe("Invalid ministry");
    expect(validateMinistryWrite("ministries", "kids")).toBe("Invalid ministry");
    // "manages nothing" is a real state — the only way to revoke management.
    expect(validateMinistryWrite("managesMinistries", [])).toBeNull();
    expect(validateMinistryWrite("managesMinistries", ["worship"])).toBe("Invalid ministry");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run app/utils/__tests__/ministries.test.ts` — module not found)

- [ ] **Step 3: Implement**

```ts
// app/ministries.ts
/**
 * Code-level ministry registry. Adding a ministry is a code change on
 * purpose: every new ministry brings its own rules and UI anyway.
 * Generic per-ministry schemas are deliberately deferred until a THIRD
 * ministry exists — see ADR-0019.
 */
export const MINISTRIES = {
  worship: { id: "worship", name: "Alabanza" },
  kids: { id: "kids", name: "Oasis Kids" },
} as const;

export type MinistryId = keyof typeof MINISTRIES;

export const ALL_MINISTRY_IDS = Object.keys(MINISTRIES) as MinistryId[];

/**
 * Membership test, NOT `x in MINISTRIES`. The `in` operator walks the prototype
 * chain, so `"constructor"`, `"toString"` and `"__proto__"` all pass it —
 * verified: `node -e '...' ` prints true for all three. This function validates
 * an AUTH field, and a member stored with `ministries: ["toString"]` belongs to
 * no ministry at all, which strands them in a redirect bounce with no
 * self-service recovery. Array membership has no prototype hole.
 */
export function isMinistryId(x: unknown): x is MinistryId {
  return typeof x === "string" && (ALL_MINISTRY_IDS as string[]).includes(x);
}

/**
 * THE one definition of "which ministries does this stored value mean".
 *
 * Absent or empty ⇒ `["worship"]`: every member predating the kids feature is a
 * worship member, which is what makes this a no-migration change. Non-array or
 * junk entries are dropped (a bare string would otherwise satisfy
 * `"worshipkids".includes("worship")`).
 *
 * EVERY reader goes through this — the member snapshot, the admin form's
 * checkbox seed, and any GROQ-side filter's TypeScript counterpart. Open-coding
 * the rule per call site is how the admin form came to display "no ministries"
 * for a worship member, one save away from revoking their access.
 */
export function normalizeMinistries(v: unknown): MinistryId[] {
  const known = Array.isArray(v) ? v.filter(isMinistryId) : [];
  return known.length > 0 ? known : ["worship"];
}

/** Ministries a member can be granted management of. Worship management lives
 *  in the legacy admin/content-editor roles, and NO guard reads a "worship"
 *  entry here — storing one would be a lie in the data. */
export const MANAGEABLE_MINISTRY_IDS: MinistryId[] = ["kids"];

/**
 * Validates a ministry array arriving at a WRITE boundary. Returns an error
 * string, or null when the value may be stored. Both member routes call it, so
 * POST and PATCH cannot drift apart.
 *
 * An explicitly EMPTY `ministries` array is rejected, and that is the whole
 * point of this function. `[].every(isMinistryId)` is vacuously `true`, so a
 * naive check accepts it; `normalizeMinistries` then reads `[]` back as
 * `["worship"]`. The net effect of unticking every box on a Kids volunteer —
 * the natural gesture for "take them out of Kids" — would be to hand them the
 * entire worship catalog while the form shows nothing ticked. Absent means
 * worship because of history; empty must never be stored at all.
 *
 * `managesMinistries: []` stays legal: "manages nothing" is a real, safe state
 * and the only way to revoke management.
 */
export function validateMinistryWrite(
  field: "ministries" | "managesMinistries",
  value: unknown,
): string | null {
  if (!Array.isArray(value)) return "Invalid ministry";
  const allowed = field === "ministries" ? ALL_MINISTRY_IDS : MANAGEABLE_MINISTRY_IDS;
  if (!value.every((m): m is MinistryId => allowed.includes(m as MinistryId))) return "Invalid ministry";
  if (field === "ministries" && value.length === 0) return "Elige al menos un ministerio.";
  return null;
}
```

Declaration order matters: `ALL_MINISTRY_IDS` → `isMinistryId` → `normalizeMinistries` → `MANAGEABLE_MINISTRY_IDS` → `validateMinistryWrite`. **All five exports land in this task**, because Task 1's own test file asserts every one of them — a validator defined later would leave this task's "expect PASS" gate unpassable, and the tempting fix at a red gate is to delete the assertions that cover the plan's central data-safety rule.

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit** — `feat(auth): ministry registry (worship, kids)`

---

### Task 2: `teamMembers` schema fields

**Files:**
- Modify: `sanity/schemas/worshipTeam.ts` (append two fields to `fields` array, after the `disabled` field)

**Interfaces:**
- Produces: document fields `ministries?: string[]`, `managesMinistries?: string[]` on `teamMembers`.

- [ ] **Step 1: Add the fields**

```ts
{
  name: "ministries",
  title: "Ministerios (membresía)",
  type: "array",
  of: [{ type: "string" }],
  options: {
    list: [
      { title: "Alabanza", value: "worship" },
      { title: "Oasis Kids", value: "kids" },
    ],
  },
  description:
    "Ministerios a los que pertenece este miembro. VACÍO o ausente = solo Alabanza (comportamiento legado; NO rellenar en masa).",
},
{
  name: "managesMinistries",
  title: "Administra ministerios",
  type: "array",
  of: [{ type: "string" }],
  options: {
    list: [{ title: "Oasis Kids", value: "kids" }],
  },
  description:
    "Otorga administración del ministerio nombrado (p. ej. planear el rol de Kids). NO implica membresía ni acceso de Alabanza. Solo super-admin edita este campo.",
},
```

Note: `worship` is deliberately NOT offered in `managesMinistries` — worship management stays with the legacy `admin`/`content-editor` roles; offering it would create a second worship-admin path no guard reads.

- [ ] **Step 2: Gates** — `npx tsc --noEmit && npm test` (arrays of strings need no `_key`; the `_key` invariant applies to arrays of objects).
- [ ] **Step 3: Commit** — `feat(auth): ministries + managesMinistries fields on teamMembers`
- [ ] **Step 4: Deploy schema** — after merge reaches production, run the repo's Studio schema deploy (`sanity:deploy-schema` skill / `npx sanity schema deploy`) so Studio shows the fields. Record in the delivery report.

---

### Task 3: Extend the `getMemberAccess` snapshot

**Files:**
- Modify: `app/utils/memberAccess.ts`
- Test: `app/utils/__tests__/memberAccess.test.ts` (extend, following its existing `vi.mock("@/sanity/lib/serverClient")` pattern)

**Interfaces:**
- Consumes: `MinistryId` normalization contract (absent/empty ⇒ `["worship"]`).
- Produces: `getMemberAccess(sanityId)` now returns `{ active, role, ministries: string[], managesMinistries: string[] }`, same 30s TTL, same cache; `isMemberActive` unchanged.

- [ ] **Step 1: Update the FOUR existing exact-shape assertions first.** `app/utils/__tests__/memberAccess.test.ts` asserts `toEqual({ active, role })` at lines 44, 56, 61 and 73; growing the return value breaks all four. Add the two new keys to each expected object (e.g. line 44 becomes `toEqual({ active: true, role: "admin", ministries: ["worship"], managesMinistries: [] })`). Do this in the same edit as Step 2 so the suite is never left red for a reason unrelated to the new behavior.

- [ ] **Step 2: Write failing tests** (append to the existing `describe("getMemberAccess")` block; the file's mock is `fetchMock` — `fetchMock.mockResolvedValueOnce(...)` — declared at the top and reset in `beforeEach` alongside `__clearMemberAccessCache()`)

```ts
it("normalizes absent ministries to worship (legacy members keep today's access)", async () => {
  fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: false, role: "member" });
  expect((await getMemberAccess("m1")).ministries).toEqual(["worship"]);
});

it("normalizes an EMPTY ministries array to worship too", async () => {
  fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: false, role: "member", ministries: [] });
  expect((await getMemberAccess("m1")).ministries).toEqual(["worship"]);
});

it("passes stored ministries and managesMinistries through", async () => {
  fetchMock.mockResolvedValueOnce({
    _id: "m2", disabled: false, role: "member",
    ministries: ["kids"], managesMinistries: ["kids"],
  });
  const a = await getMemberAccess("m2");
  expect(a.ministries).toEqual(["kids"]);
  expect(a.managesMinistries).toEqual(["kids"]);
});

it("defaults managesMinistries to empty", async () => {
  fetchMock.mockResolvedValueOnce({ _id: "m3", disabled: false, role: "admin" });
  expect((await getMemberAccess("m3")).managesMinistries).toEqual([]);
});
```

- [ ] **Step 3: Run — expect FAIL** (new assertions fail; the four updated ones fail until Step 4 lands)
- [ ] **Step 4: Implement**

```ts
type Entry = {
  active: boolean;
  role: string | null;
  ministries: string[];
  managesMinistries: string[];
  expires: number;
};
```

Query becomes:

```ts
`*[_type == "teamMembers" && _id == $id][0]{ _id, disabled, role, ministries, managesMinistries }`
```

Normalization, immediately after the fetch. It is **fail-closed for a member who does not exist** and defensive about the field's type — this value feeds two auth guards, and a string written by some future script would otherwise satisfy `"worshipkids".includes("worship")`:

```ts
import { normalizeMinistries, isMinistryId } from "@/app/ministries";

// A missing/deleted member gets NO ministries: `active:false` already blocks both
// guards, and [] is the shape that stays safe if that ever changes. An existing
// member goes through the SHARED normalizer — the same function the admin form
// seeds from, so storage and UI can never disagree about what absent means.
const ministries = doc ? normalizeMinistries(doc.ministries) : [];
const managesMinistries = doc && Array.isArray(doc.managesMinistries)
  ? doc.managesMinistries.filter(isMinistryId)
  : [];
```

The same `[]` pair applies on the `if (!sanityId)` early return at the top of the function — extend its returned object rather than leaving the new keys undefined.

Tests must also cover the **cache-hit** path: a second `getMemberAccess` call within the TTL returns the same `ministries`/`managesMinistries`, not just the same `active`/`role`. `tsc` forces *something* onto that return path, not the right thing — add the assertion to the existing "shares the 30s cache" test.

Return them from `getMemberAccess` and store in the cache entry. Do not change `isMemberActive`, the TTL, or the cache key.

- [ ] **Step 5: Run full memberAccess tests — expect PASS (all, including the four updated ones)**
- [ ] **Step 6: Commit** — `feat(auth): member snapshot carries ministries + managesMinistries`

---

### Task 3b: Carry ministries into the JWT and session

**Files:**
- Modify: `auth.ts` (jwt callback ~line 239 where `eff`/`real` are already resolved; session callback ~line 258)
- Modify: `types/next-auth.d.ts` (add to `Session["user"]` and `JWT`)
- Test: extend `app/utils/__tests__/authGuards.test.ts` is NOT the place; add assertions to whatever `auth.ts` test exists, or skip tests here and rely on Task 6's page-level tests plus the browser gate. State the choice in the commit body.

**Interfaces:**
- Consumes: `getMemberAccess` (Task 3) — already called in the jwt callback for the revocation/role refresh, so this adds **zero** extra Sanity fetches.
- Produces: `session.user.ministries: string[]` and `session.user.managesMinistries: string[]`, live within the same 30s TTL as the role refresh. Client components (nav) can now filter by ministry; **server-side guards still never trust the session for authorization** — they re-read `getMemberAccess`. The session copy is for RENDERING only.

- [ ] **Step 1: Types** — in `types/next-auth.d.ts`, add `ministries: string[]` and `managesMinistries: string[]` to the `Session["user"]` shape and `ministries?: string[]`, `managesMinistries?: string[]` to `JWT`.
- [ ] **Step 2: jwt callback** — where `eff` is already in hand:

```ts
if (eff) {
  token.role = (eff.role ?? "member") as OWTRole;
  token.ministries = eff.ministries;
  token.managesMinistries = eff.managesMinistries;
}
```

`auth.ts:253` is currently a **brace-less single-statement `if`** (`if (eff) token.role = …`); convert it to a block before adding the two assignments. Keeping them inside that `if` is what makes impersonation work — the effective identity's ministries are what the UI must reflect.

Add a comment at the assignment site noting that `auth.ts:197` returns the token early on `trigger === "update"`, so for exactly one request after starting or stopping impersonation `token.ministries` can lag `token.sanityId`. That is tolerable **only** because this copy is render-only — every server-side authorization decision re-reads `getMemberAccess`. If anything ever authorizes off the session copy, this staleness becomes a privilege bug.

- [ ] **Step 3: session callback** — beside the existing assignments:

```ts
session.user.ministries        = token.ministries ?? ["worship"];
session.user.managesMinistries = token.managesMinistries ?? [];
```

The `?? ["worship"]` mirrors the storage-level normalization so a token minted before this deploy behaves as a worship member rather than a member of nothing.

- [ ] **Step 4: Nav filtering** — in `app/components/NavMenu.tsx`, gate the worship links on ministry, and add the Kids links:

```tsx
const ministries = user?.ministries ?? ["worship"];
const isSuper = user?.role === "super-admin";
const inWorship = isSuper || ministries.includes("worship");
const inKids = isSuper || ministries.includes("kids");
const managesKids = isSuper || (user?.managesMinistries ?? []).includes("kids");
```

Then: `{showSchedule && inWorship && <MenuItem href="/schedule">Calendario</MenuItem>}`, `{showTags && inWorship && <MenuItem href="/tag">#Tags</MenuItem>}`, `{isAdmin && <MenuItem href="/admin">Admin</MenuItem>}`, plus `{inKids && <MenuItem href="/kids">Oasis Kids</MenuItem>}` and `{managesKids && <MenuItem href="/kids/admin">Planear Kids</MenuItem>}`. `/me` stays unconditional — it is ministry-neutral.

`/admin` is deliberately gated on `isAdmin` **alone**, with no `inWorship` clause: the three manager roles are worship-scoped by definition (`requireActiveManager` is role-only), so an `&& inWorship` would either be dead code or imply a non-worship admin the page's own guard would then have to check. Nav is not enforcement — keep it agreeing with the page guard rather than inventing a second rule.

This is spec §5.1's **nav layer**; the page and API layers follow in Task 6. Nav filtering is cosmetic — never the enforcement — but without it a dual-ministry member has no route to `/kids` and a kids-only member sees worship links that bounce.

- [ ] **Step 5: Gates; commit** — `feat(auth): session carries ministries; nav filters by ministry`

---

### Task 4: Ministry guards

**Files:**
- Modify: `app/utils/authGuards.ts`
- Test: `app/utils/__tests__/authGuards.test.ts` (create; mock `next-auth`'s `getServerSession` and `./memberAccess`)

**Interfaces:**
- Consumes: `getMemberAccess` from Task 3, `MinistryId` from Task 1.
- Produces:
  - `requireMinistryMember(ministry: MinistryId): Promise<ActiveSession>` — active session AND (`role === "super-admin"` OR `ministries` includes ministry).
  - `requireMinistryManager(ministry: MinistryId): Promise<ActiveSession>` — active session AND (`role === "super-admin"` OR `managesMinistries` includes ministry). **Plain `admin` does NOT pass.**

- [ ] **Step 1: Write the failing test — the full matrix**

```ts
// app/utils/__tests__/authGuards.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/auth", () => ({ authOptions: {} }));
const getMemberAccess = vi.fn();
vi.mock("../memberAccess", () => ({
  isMemberActive: async (id: string) => (await getMemberAccess(id)).active,
  getMemberAccess: (...a: unknown[]) => getMemberAccess(...a),
}));

import { requireMinistryMember, requireMinistryManager } from "../authGuards";

function sessionFor(role: string) {
  return { user: { role, sanityId: "m1", email: "x@y.z" } };
}
function accessOf(p: Partial<{ active: boolean; role: string | null; ministries: string[]; managesMinistries: string[] }>) {
  getMemberAccess.mockResolvedValue({
    active: true, role: "member", ministries: ["worship"], managesMinistries: [], ...p,
  });
}
beforeEach(() => { getServerSession.mockReset(); getMemberAccess.mockReset(); });

describe("requireMinistryManager", () => {
  it("passes super-admin for any ministry", async () => {
    getServerSession.mockResolvedValue(sessionFor("super-admin"));
    accessOf({ role: "super-admin" });
    expect(await requireMinistryManager("kids")).not.toBeNull();
    expect(await requireMinistryManager("worship")).not.toBeNull();
  });
  it("REJECTS plain admin for kids (two-way isolation)", async () => {
    getServerSession.mockResolvedValue(sessionFor("admin"));
    accessOf({ role: "admin" });
    expect(await requireMinistryManager("kids")).toBeNull();
  });
  it("passes a member whose managesMinistries names the ministry", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({ managesMinistries: ["kids"], ministries: ["kids"] });
    expect(await requireMinistryManager("kids")).not.toBeNull();
  });
  it("rejects a kids manager for worship", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({ managesMinistries: ["kids"], ministries: ["kids"] });
    expect(await requireMinistryManager("worship")).toBeNull();
  });
  it("rejects disabled members even with managesMinistries", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({ active: false, managesMinistries: ["kids"] });
    expect(await requireMinistryManager("kids")).toBeNull();
  });
  it("rejects no session", async () => {
    getServerSession.mockResolvedValue(null);
    expect(await requireMinistryManager("kids")).toBeNull();
  });
});

describe("requireMinistryMember", () => {
  it("legacy member (normalized worship) passes worship, not kids", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({});
    expect(await requireMinistryMember("worship")).not.toBeNull();
    expect(await requireMinistryMember("kids")).toBeNull();
  });
  it("kids-only member passes kids, not worship — worship admin role does not rescue", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({ ministries: ["kids"] });
    expect(await requireMinistryMember("kids")).not.toBeNull();
    expect(await requireMinistryMember("worship")).toBeNull();
  });
  it("dual-ministry member passes both", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({ ministries: ["worship", "kids"] });
    expect(await requireMinistryMember("worship")).not.toBeNull();
    expect(await requireMinistryMember("kids")).not.toBeNull();
  });
  it("super-admin passes both regardless of ministries", async () => {
    getServerSession.mockResolvedValue(sessionFor("super-admin"));
    accessOf({ role: "super-admin", ministries: ["worship"] });
    expect(await requireMinistryMember("kids")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (exports missing)
- [ ] **Step 3: Implement** (append to `app/utils/authGuards.ts`)

```ts
import { getMemberAccess } from "./memberAccess";
import type { MinistryId } from "@/app/ministries";

/**
 * Active session AND ministry MEMBERSHIP (or super-admin). Two-way isolation:
 * worship admin/content-editor roles grant nothing here — only membership or
 * super-admin. Absent/empty `ministries` normalizes to ["worship"] upstream.
 */
export async function requireMinistryMember(ministry: MinistryId): Promise<ActiveSession> {
  const session = await requireActiveSession();
  const sanityId = session?.user?.sanityId;
  if (!session || !sanityId) return null;
  const access = await getMemberAccess(sanityId);
  if (access.role === "super-admin") return session;
  return access.ministries.includes(ministry) ? session : null;
}

/**
 * Active session AND ministry MANAGEMENT (or super-admin). Plain `admin` does
 * NOT pass for a ministry it does not manage (Frank, 2026-08-19): a worship
 * admin has no kids access. Management does not imply membership.
 */
export async function requireMinistryManager(ministry: MinistryId): Promise<ActiveSession> {
  const session = await requireActiveSession();
  const sanityId = session?.user?.sanityId;
  if (!session || !sanityId) return null;
  const access = await getMemberAccess(sanityId);
  if (access.role === "super-admin") return session;
  return access.managesMinistries.includes(ministry) ? session : null;
}
```

Note both call `requireActiveSession()` first, so `disabled`/kill-switch and impersonation (effective `sanityId`) behavior compose exactly as for the existing guards. The role read comes from `getMemberAccess` (live, 30s TTL), not the JWT, mirroring the repo's stale-JWT-role posture.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `feat(auth): requireMinistryMember / requireMinistryManager guards`

---

### Task 5: Super-admin editing of the two fields

**Files:**
- Modify: `app/api/admin/members/route.ts` (GET projection **and** POST body destructure)
- Modify: `app/api/admin/members/[id]/route.ts` (PATCH allowlist — route is already super-admin-only for PATCH)
- Modify: `app/components/admin/AdminPanel.tsx` (`Member` interface ~line 28, `MemberFormData` ~line 40, **`handleAdd` destructure `:533` / POST body `:537`**, `handleEdit` from `:548` — it forwards via `...rest`, so new keys flow automatically — `MemberForm` state + `onSubmit` ~line 240-252, Miembros editor ~line 684). Treat every line number as approximate and confirm by reading.
- Test: `app/api/__tests__/membersMinistries.test.ts` following the repo's route-test pattern.

**Interfaces:**
- Consumes: `ALL_MINISTRY_IDS`, `isMinistryId` (Task 1).
- Produces: GET projects `ministries`/`managesMinistries`; POST accepts them at creation; PATCH accepts them **only when present in the body** (absent ⇒ leave stored value alone); invalid ids → 400.

**⚠ The failure this task exists to avoid.** `MemberForm`'s `onSubmit` sends `member_name, alias, email, role, memberType` **unconditionally** (`AdminPanel.tsx:248-252`), and `handleEdit` forwards them flat to PATCH (`:553-560`). If the two new arrays were sent the same way while `GET` never projected them, the form would initialise them to `[]` and every unrelated edit — fixing a typo in an alias — would PATCH `ministries: []` and `managesMinistries: []`, silently granting a kids-only member full worship access and revoking a Kids leader's management. **This is a known, documented failure class in this very file**: the email-preference block at `AdminPanel.tsx:242-247` says "submitting all five every time would silently revert an opt-out the moment an admin fixes an unrelated typo in the name" and defends with the `touchedPrefFields` set at `:224`. Both new fields MUST follow `touchedPrefFields`, **not** the `memberType` pattern.

- [ ] **Step 1: Failing tests**
  - PATCH `{ ministries: ["kids", "youth"] }` → 400 `"Invalid ministry"`.
  - PATCH `{ managesMinistries: ["worship"] }` → 400 (only `kids` is a manageable ministry — no guard reads a worship entry, so storing one would be a lie in the data).
  - PATCH `{ ministries: ["kids"], managesMinistries: ["kids"] }` from a super-admin → patch contains both verbatim.
  - **PATCH `{ member_name: "Nuevo nombre" }` (no ministry keys) → the commit patch contains NEITHER key** — the regression test for the wipe described above.
  - Same bodies from an `admin` session → 403 (already enforced; assert it stays).
  - GET response includes both fields.

- [ ] **Step 2: Route changes**

`GET` projection in `app/api/admin/members/route.ts` — **edit line 21 only**, appending two names to it. Do not replace the projection block: lines 22-24 carry `unavailableDates`, `unavailabilityNotes`, `hasPassword` and `photoUrl`, and dropping them would break the Disponibilidad and Miembros panels.

```
_id, member_name, alias, email, role, memberType, notifPrefs, ministries, managesMinistries,
```

`POST` in the same file — add to the destructure and to the created document, so a Kids volunteer is created kids-only rather than existing as a worship member until a follow-up PATCH:

```ts
const { member_name, alias, email, role, memberType, ministries, managesMinistries } = await req.json() as {
  member_name?: string; alias?: string; email?: string; role?: string;
  memberType?: string[]; ministries?: string[]; managesMinistries?: string[];
};
```

Validate both with the helper below and include them in the create payload only when supplied.

`PATCH` in `app/api/admin/members/[id]/route.ts` — beside the existing `VALID_ROLES` validation. Note the guard is `body.X !== undefined`, so an absent key leaves the stored value untouched:

Add `ministries?: string[]` and `managesMinistries?: string[]` to the route's inline body type (`app/api/admin/members/[id]/route.ts:24-39`) or `tsc` rejects the reads below.

**Wiring only — `validateMinistryWrite` and `MANAGEABLE_MINISTRY_IDS` already exist from Task 1.** Do not redefine them here.

Placement matters: the loop below reads `patch`, which is declared at `[id]/route.ts:48`, and it must land **between `:48` and the `Nothing to update` check at `:65`**. Putting it after `:65` would 400 a ministries-only PATCH as an empty update.

```ts
// app/api/admin/members/[id]/route.ts — and the same two blocks in POST
import { validateMinistryWrite } from "@/app/ministries";

for (const field of ["ministries", "managesMinistries"] as const) {
  if (body[field] === undefined) continue;          // absent ⇒ leave stored value alone
  const error = validateMinistryWrite(field, body[field]);
  if (error) return NextResponse.json({ error }, { status: 400 });
  patch[field] = body[field];
}
```

- [ ] **Step 3: UI — types and seeding.** Add `ministries?: string[]` and `managesMinistries?: string[]` to both the `Member` interface (`:28-38`) and `MemberFormData` (`:40`).

  **Seed through `normalizeMinistries` — never the raw stored value:**

```ts
const [ministries, setMinistries] = useState<string[]>(normalizeMinistries(initial?.ministries));
const [managesMinistries, setManagesMinistries] = useState<string[]>(initial?.managesMinistries ?? []);
```

  ⚠ **Why this is not `initial?.ministries ?? []`.** By this plan's own no-migration rule the field is **absent on every existing member**, and `initial` is `modal.member` from `GET /api/admin/members`, which returns it verbatim (`AdminPanel.tsx:911`). Seeding raw would render *both boxes unticked* for a worship singer who is fully a worship member. The super-admin's intended workflow from spec §5.1 — open a singer, tick "Oasis Kids", save — would then submit `ministries: ["kids"]` and silently revoke that member's access to `/`, `/schedule`, `/tag`, `/author`, `/posts/*` and `/api/me/songs`. That is the wipe class this task's ⚠ block exists to prevent, reached through a different door: not an untouched field clobbered, but a **touched field whose displayed baseline was a lie**. Normalizing the seed makes the checkbox state mean what storage means, so ticking Kids submits `["worship", "kids"]`.

  `managesMinistries` seeds raw because absent genuinely means "manages nothing" — there is no legacy value to infer.

  Tests: opening the editor on a member with **no** stored `ministries` renders `worship` ticked; ticking `kids` there submits `["worship", "kids"]`, never `["kids"]`.

- [ ] **Step 4: UI — touched-only submission.** Add a `touchedMinistryFields` set beside `touchedPrefFields` (`:224`), add each field name on change, and in `onSubmit` spread only the touched ones — exactly the shape the email-prefs block already uses:

```ts
const touchedMinistries: Partial<Pick<MemberFormData, "ministries" | "managesMinistries">> = {};
if (touchedMinistryFields.has("ministries")) touchedMinistries.ministries = ministries;
if (touchedMinistryFields.has("managesMinistries")) touchedMinistries.managesMinistries = managesMinistries;
onSubmit({
  member_name: name, alias, email, role, memberType,
  ...(initial && touchedPrefFields.size > 0 ? { emailPrefs: touchedEmailPrefs } : {}),
  ...touchedMinistries,
});
```

On CREATE (`initial` undefined) sending the arrays unconditionally is fine and desirable — there is no stored value to clobber.

- [ ] **Step 4b: Carry the fields through `handleAdd` — the form does NOT call the API.** `MemberForm.onSubmit` hands its data to `handleAdd`/`handleEdit`, and `handleAdd` (`AdminPanel.tsx:533-537`) destructures a **fixed five-field list** and POSTs only those:

```ts
const { member_name, alias, email, role, memberType } = data;
body: JSON.stringify({ member_name, alias, email, role, memberType }),
```

Without editing this, Step 2's POST change is dead code: a Kids volunteer created through the UI is stored with no `ministries`, normalizes to `["worship"]`, and has the full song catalog, schedule, tags and authors until someone remembers a second edit — precisely the state the requirement forbids, with no signal to the admin. Add both fields to the destructure and the POST body, and verify `handleEdit` (`:548-560`) forwards them too.

- [ ] **Step 4c: Require at least one ministry on BOTH create and edit.** Block submission in `MemberForm` whenever zero ministries are ticked — not only when creating (Spanish message: `"Elige al menos un ministerio."`). The server rejects it too (Step 2's `validateMinistryWrite`); this is the friendly half of the same rule, and the server half is the enforcement.

  Two distinct failures this closes, one in each direction:
  - **Create:** an admin who ticks only "Administra ministerios: Kids" would otherwise mint a Kids manager who is also a full worship member — contradicting spec §5.1's "Kids manager → worship surfaces: none".
  - **Edit:** unticking "Oasis Kids" on a Kids-only volunteer — the natural gesture for "remove them from Kids" — would otherwise submit `[]`, which reads back as `["worship"]` and silently grants `/`, `/schedule`, `/tag`, `/author`, `/posts/*` and the whole catalog via `/api/me/songs`. To actually remove someone from a ministry the admin must say which ministry remains.

  The create default is already `["worship"]` — Step 3's `normalizeMinistries(initial?.ministries)` returns it for the `initial === undefined` case too, which is why both modes share the helper rather than each carrying its own default.

  Tests: create with every box unticked is rejected client-side; **edit** with every box unticked is rejected client-side; and `PATCH { ministries: [] }` returns 400 (the server-side twin — a form fix alone is not a trust boundary).

- [ ] **Step 5: UI — the controls.** Two labelled checkbox rows in the Miembros editor: "Ministerios" over `ALL_MINISTRY_IDS` (labels from `MINISTRIES[id].name`) and "Administra ministerios" over `["kids"]` only. Follow the section's existing input styling and the client-mutation invariant (try/catch/finally, `res.ok`, loading reset).
- [ ] **Step 6: Gates** — `npx tsc --noEmit && npm test && npx eslint .`
- [ ] **Step 7: Commit** — `feat(admin): super-admin edits member ministries (touched-field-only)`

---

### Task 6: Worship page isolation

**Files:**
- Modify — **seven** worship pages: `app/(client)/page.tsx`, `app/(client)/schedule/page.tsx`, `app/(client)/tag/page.tsx`, `app/(client)/tag/[slug]/page.tsx`, `app/(client)/author/page.tsx`, `app/(client)/author/[slug]/page.tsx`, `app/(client)/posts/[slug]/page.tsx`
- Create: `app/utils/worshipPageGate.ts` (one shared gate, so seven copies cannot drift)
- (Untouched: `app/(client)/me/**` — ministry-neutral, and its nav links are ministry-filtered in Task 3b; `app/(client)/admin/page.tsx` — already worship-scoped via `requireActiveManager`; `app/(client)/auth/**` — pre-session; `/studio` — **admin AND super-admin** (`proxy.ts:15-19`, not super-admin-only), and note that `teamMembers` is **not** in `PROTECTED_STUDIO_TYPES` (`app/utils/studioProtection.ts:45-58`), so Task 2's two fields are Studio-editable by anyone with Sanity project write access. That is a second write path around spec §5's "editing `managesMinistries` is super-admin only". It is **not a regression** — `role` itself already has exactly this property — but it is a real limit on the guarantee, and Studio access is Sanity project membership rather than an app role. Record it; adding `teamMembers` to the protected set is a separate decision with its own blast radius.)

**Interfaces:**
- Consumes: `requireActiveSession`, `requireMinistryMember("worship")` (Task 4).
- Produces: `requireWorshipPage(callbackPath: string): Promise<void>` — redirects and never returns for a non-worship visitor.
- Kids-only members are redirected to `/kids` (the route lands in P2; **P1 and P2 merge to `main` together** — see Merge note).

**⚠ Two hazards this task must not reproduce.**
1. **`/tag` and `/author` INDEX pages exist**, not just their `[slug]` children, and both are worship-catalog surfaces (`tag/page.tsx` lists every tag with song counts; `author/page.tsx` lists every author). Gating only the `[slug]` routes leaves the catalog reachable — and `/me` renders `<Navbar … tags />`, so before Task 3b's nav filtering a kids-only member is one click from it.
2. **The login middleware proves only that a token exists** — `proxy.ts:26` is `authorized: ({ token }) => !!token`. The `disabled`/deleted kill switch lives downstream in `isMemberActive`. So `requireMinistryMember("worship")` returns `null` for a *disabled* member too, and sending that member to `/kids` — whose own gate redirects back — is an infinite loop that replaces today's clean bounce to sign-in. **The two cases must be split.**

- [ ] **Step 1: Write the shared gate**

```ts
// app/utils/worshipPageGate.ts
import { redirect } from "next/navigation";
import { requireActiveSession, requireMinistryMember } from "./authGuards";

/**
 * Page gate for worship-only surfaces. Splits the two ways a visitor can fail:
 *
 *  - NO ACTIVE SESSION (no token, or a `disabled`/deleted member still holding a
 *    live cookie — the middleware only proves a token EXISTS, `proxy.ts:26`):
 *    bounce to sign-in, exactly as `/me` already does. Sending this member to
 *    `/kids` instead would ping-pong against that route's own gate forever.
 *  - ACTIVE, BUT NOT A WORSHIP MEMBER: send to the Kids home.
 */
export async function requireWorshipPage(callbackPath: string): Promise<void> {
  const session = await requireActiveSession();
  if (!session) redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackPath)}`);
  const worship = await requireMinistryMember("worship");
  if (worship) return;
  // Send them to a ministry they ACTUALLY belong to. Redirecting every
  // non-worship visitor to /kids unconditionally would be correct only under an
  // unstated invariant — "every active member is in worship or kids" — which
  // neither the schema nor a future third ministry guarantees. A member of
  // NEITHER would bounce /kids -> / -> /kids forever, locked out with no
  // self-service recovery. /me is ministry-neutral and gated only on an active
  // session, so it always terminates.
  const access = await getMemberAccess(session.user.sanityId);
  redirect(access.ministries.includes("kids") ? "/kids" : "/me");
}
```

`getMemberAccess` is imported from `./memberAccess`; the call is free — it is the same 30s-TTL entry `requireMinistryMember` just read.

- [ ] **Step 2: Test the split** — `app/utils/__tests__/worshipPageGate.test.ts`, mocking `next/navigation`'s `redirect` and **three** collaborators (`requireActiveSession`, `requireMinistryMember`, and `getMemberAccess`, which resolves the redirect target):
  - no active session → redirect target starts with `/auth/signin`, **never** `/kids`;
  - **disabled member** (active session null, even though a token exists) → sign-in, not `/kids` — the anti-loop regression test;
  - active kids-only member → `/kids`;
  - **active member of NO known ministry** → `/me`, never `/kids` — the second anti-loop test, because `/kids` would send them back here. Mock `getMemberAccess` to return `ministries: []` **directly**; do not try to reach it through a document. With the write boundary rejecting `[]` and `normalizeMinistries` mapping unknown ids back to `["worship"]`, this state is unreachable through any current path — the branch is deliberate defence in depth against a future third ministry or a hand-edited document, and the test documents that intent;
  - active worship member → no redirect called.

- [ ] **Step 3: Apply to all seven pages** — first line of each async server component, before any data fetch, with that page's own path as the callback (e.g. `await requireWorshipPage("/tag")`). Keep the rendering below untouched.

- [ ] **Step 4: Note the rendering-mode change in each page's diff.** All seven currently render statically/ISR (`page.tsx` `revalidate = 60`, `posts/[slug]` `revalidate = 3600` **plus `generateStaticParams`**). `getServerSession` reads `cookies()`, so each becomes dynamic and its `revalidate` stops meaning what it meant. This is the accepted cost of server-side isolation — the requirement is that a typed URL is blocked, which a static page cannot do. `next.config.mjs` sets no `dynamicIO`/PPR, so this is a mode change, not a build failure. Say so in the commit body; do not silently drop the `revalidate` exports.

- [ ] **Step 5: Worship member APIs** — add to `app/api/song/**` and `app/api/practice-playlist/**` (member-session worship endpoints):

```ts
const worship = await requireMinistryMember("worship");
if (!worship) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

Replace an existing `requireActiveSession` call with it (the new guard subsumes that check). **Do not touch `app/api/content/**`** — all of its handlers gate on `requireActiveManager`, which is already worship-scoped; adding a membership check there would be a no-op at best. `app/api/me/{route.ts,availability,notif-prefs,password,photo,push-token,theme}` stay ministry-neutral by design.

**Two more routes need the gate — both exist, both sit behind a bare `requireActiveSession`, and both return worship content:**
- `app/api/me/songs/route.ts` — returns the **entire song catalog** (title, author, key, slug). This is the single largest worship read a kids-only member could otherwise still make, and no UI change hides it from a typed URL.
- `app/api/notifications/count/route.ts` — returns worship proposal counts.

- `app/api/me/proposals/route.ts` — **it exists** (GET `:49`, POST `:87`); gate both. Its POST already authorizes on `canonicalLeadRefs(role).includes(leadId)`, so this is defence in depth rather than the only check — gate it anyway.

**Existing route tests will break — expect it, don't debug it from scratch.** `app/api/__tests__/songRoute.test.ts:10-12` mocks `@/app/utils/authGuards` with a factory exporting only `requireActiveSession`; once `app/api/song/[id]/route.ts` calls `requireMinistryMember`, the mock returns `undefined` and the suite fails. Add the new export to that factory in the same commit. Check the other 15 files in `app/api/__tests__/` for the same pattern.

`app/api/activity/ping/route.ts` is **ministry-neutral by design** (it writes `lastSeen` only) — name it in the Step 6 enumeration so its absence from the gate list is a recorded decision rather than an oversight.

- [ ] **Step 6: Verify coverage by enumeration, not grep.** A `grep` for `requireActiveSession` cannot find a page that never had a session call — which is exactly how `/tag` and `/author` hid. Instead run `find "app/(client)" -name "page.tsx"` (12 results) and `find app/api -name "route.ts"` (43 results) and, in the commit body, list **every** result with one word each: `gated` or `neutral (why)`. A path absent from that list is an unreviewed hole.

  Name these explicitly rather than covering them with a wildcard:
  - `app/(client)/me/propose/[roleId]/page.tsx` — a worship setlist-proposal surface living inside the "`me/**` is neutral" exclusion. It is closed today only because its GROQ requires `$leadId in Lead[]._ref` and it `notFound()`s otherwise. That is defence in depth, not a gate; decide explicitly whether to add `requireWorshipPage` and record the choice.
  - `app/api/me/songs/route.ts`, `app/api/notifications/count/route.ts`, `app/api/me/proposals/route.ts` — gated in Step 5.
  - `app/components/BottomNav.tsx` (hardcoded `/schedule` + `/tag` tabs) and `app/components/Header.tsx` (`/tag` link) carry **unfiltered worship links but are mounted nowhere** — verified by grep across the tree, and `docs/superpowers/plans/2026-07-16-backstage-cue-system-dependencies.md:124` records BottomNav as deliberately unmounted. Not a hole today; they would ship ungated if revived, so name them here rather than leaving the next person to rediscover it.

- [ ] **Step 6c: Filter Kids-only members out of worship admin reads** (Frank's decision, 2026-08-19: this *does* count as "kids stuff").

  `GET /api/admin/members` (`route.ts:19-26`) and `app/api/admin/login-events/route.ts:17` both fetch `*[_type == "teamMembers"]` unfiltered.

  **The rule is role-dependent, and getting it backwards locks the roster:**
  - `admin` / `content-editor` → worship members only.
  - `super-admin` → **everyone, unfiltered**. They are the only role that can edit `ministries` (Task 5), so filtering their view would make a Kids-only member uneditable and unrecoverable through the UI.

  GROQ, mirroring the storage contract (absent ⇒ worship, so the `!defined` arm is required — a bare `"worship" in ministries` would hide every legacy member):

```groq
*[_type == "teamMembers" && ($all || !defined(ministries) || count(ministries) == 0 || "worship" in ministries)]
```

  with `$all = session.user.role === "super-admin"`. Apply the same predicate to both routes.

  Tests: an `admin` GET omits a `ministries: ["kids"]` member; an `admin` GET **includes** a member with no `ministries` field (the legacy case — this is the assertion that catches a filter written against the wrong default); a `super-admin` GET returns both; the same pair for login-events.

- [ ] **Step 6b: Acknowledged, deliberately-unfixed bleeds** (record in the commit body so a later reader does not read silence as oversight): A worship admin therefore sees Kids *people*, though no Kids scheduling. The solver is unaffected (its pools filter on `memberType`, `MonthGenerator.tsx:1329-1331`). Fixing it means ministry-filtering an admin read used by several worship panels — out of scope here; raise it if Frank considers member visibility part of "kids stuff".
  - `Navbar.tsx:22` links the brand lockup to `/` for everyone, so a kids-only member's most obvious click is a redirect bounce to `/kids`. Harmless with the loop-proof gate; fix it in P2's UI pass if it grates.
  - `/me`'s third query fetches every worship service date unfiltered (`app/(client)/me/page.tsx:170-176`) and feeds `AvailabilityCalendar`, so a kids-only member's availability calendar shows worship service dates. Cosmetic — the member's own assignments are `memberFilter`-scoped and render "Sin servicios asignados" — but it is worship information on a neutral page. P2 decides whether the calendar becomes ministry-aware.
  - **Worship setlist PUSH notifications reach Kids-only volunteers.** `notifySetlistSaved` (`app/utils/serviceMutationSideEffects.ts:671`) fetches every `teamMembers` document, and `setlistRecipientIds` treats an unset preference as `"all"` (`app/utils/notifyTargets.ts:40`). No page or API gate covers the push path. **Exposure is nil today** — the native apps are unshipped (CLAUDE.md landmines) — and spec §2 forbids touching notification code in this delivery, so this is recorded, not fixed. It must be resolved before the mobile app ships, or a Kids volunteer's phone will buzz about worship setlists. There is no equivalent all-members *email* audience (verified: every email path is id- or role-filtered).

- [ ] **Step 7: Amend ADR-0007 — it currently forbids this exact change.**

  `docs/adr/0007-client-side-auth-keeps-pages-static.md` is **Accepted** (`docs/adr/README.md:50`) and its Consequences say verbatim: *"Don't 'harden' it by moving the gate server-side — that would undo this ADR and make the page dynamic again"*, naming `app/api/song/[id]/route.ts`'s `requireActiveSession()` as the real gate — the very call Step 5 replaces. `docs/adr/README.md:20` lists 0007 under "code that looks like a bug but isn't". Ship Task 6 without touching it and the repository carries a live, Accepted instruction to revert the isolation gates; here reverting is not a performance regression, it deletes the enforcement. This repo has already blocked a plan for the same trade (`docs/superpowers/specs/2026-08-07-light-mode-member-first-scope-review-log.md:155`, "despite ADR-0007 forbidding exactly this"), and CLAUDE.md requires stale statements removed in the same delivery.

  Amend, do not delete:
  - Status → `Accepted, amended by ADR-0020 (2026-08-19)`; update the status cell in `docs/adr/README.md`.
  - Add an **Amendment** section: ministry isolation is a *security* requirement, not a hardening preference. A statically-rendered page cannot refuse a typed URL, so the seven pages listed in ADR-0020 now gate server-side and are dynamic by design. The performance trade 0007 made is knowingly reversed **for those seven pages only**.
  - State what **still holds**: `Navbar` stays a plain non-async component, and session state (now including `ministries`) still resolves client-side in `NavMenu` — Task 3b follows 0007's pattern rather than breaking it. `EditSongButton`'s `useSession()` check remains cosmetic, with `app/api/song/[id]/route.ts` still the real gate (now `requireMinistryMember`).

- [ ] **Step 8: Gates** — all three.
- [ ] **Step 9: Commit** — `feat(auth): worship pages and member APIs require worship membership`

---

### Merge note

P1 alone leaves `/kids` redirects pointing at a route that does not exist yet. **Do not merge P1 to `main` on its own** — P1 and P2 ship in one merge (single release, one code review over the combined range). Implementation order is P1 then P2 on the same feature branch (`feat/kids-scheduling`).

### Verification (whole plan)

- `npx tsc --noEmit` clean; `npm test` green (including the new matrix tests); `npx eslint .` 0 errors.
- The Task 4 matrix is the auth contract: any change to guard behavior must fail one of those tests first.
- **Three isolation regressions must have named tests**, because each one shipped as a defect in an earlier draft of this plan:
  1. a disabled member never lands in a `/` ⇄ `/kids` redirect loop (Task 6 Step 2);
  2. a PATCH carrying no ministry keys leaves both stored arrays untouched (Task 5 Step 1);
  3. every `page.tsx` under `app/(client)` is enumerated as gated or deliberately neutral (Task 6 Step 6) — the check that finds a page nobody remembered, which a grep for an absent symbol cannot.
- Spec §5.1's three layers each have an owner: **nav** = Task 3b, **pages** = Task 6, **APIs** = Task 6 Step 5 (+ P2's `/api/kids/*` guards). Nav is cosmetic; the page and API layers are the enforcement.
- **Run `npx next build` before the merge and read the ROUTE LEGEND, not the exit code.** A passing build proves nothing here: the enforcement claim of Task 6 is that these pages render per-request, and a page that still prerenders would serve cached HTML straight past the gate — a silent auth hole of exactly the shape this repo keeps paying for. Confirm all seven appear as `ƒ (Dynamic)` in the build output and paste that fragment into the commit body. `/me` already proves `revalidate` + `getServerSession` builds fine, so failure is unlikely; a page still marked `○ (Static)` is the finding to look for.
- **The per-page-vs-middleware decision is recorded in ADR-0020**, written in P2 Task 8 Step 1b. (It is a separate ADR from 0019, which covers the kids-vertical-vs-generic-schemas choice — one ADR cannot carry both, and the dynamic-rendering cost must not ship unexplained.)
