# Kids Scheduling P1 — Ministry Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ministry membership + ministry-scoped management on `teamMembers`, enforced by new server-side guards, with two-way worship/kids isolation (only `super-admin` spans both).

**Architecture:** A code-level ministry registry (`app/ministries.ts`); two new array fields on `teamMembers` (absent = worship, no migration); the existing 30s-TTL `getMemberAccess` snapshot extended to carry them; two new guards in `authGuards.ts` beside the existing ones; super-admin-only editing via the existing members PATCH route; worship member pages/APIs gated on worship membership.

**Tech Stack:** Next.js 16 App Router (server components + route handlers), NextAuth v4 session (`session.user.role`, `session.user.sanityId`), Sanity via `serverClient`/`writeClient`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-kids-ministry-scheduling-design.md` (§3, §5, §5.1)

**RISK TIER: CRITICAL** — auth/trust boundary. This plan requires adversarial plan review (two sequential fresh `APPROVED` on byte-identical text) **before implementation**. P2 (`2026-08-19-kids-scheduling-p2-kids-vertical.md`) is standard and does not.

## Global Constraints

- Spanish-language UI copy; dark and light themes.
- Gates before done: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.
- Absent or empty `ministries` ⇒ `["worship"]` (legacy members keep exactly today's access; **no migration**).
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
- Produces: `MINISTRIES` const, `MinistryId` type (`"worship" | "kids"`), `isMinistryId(x: unknown): x is MinistryId`, `ALL_MINISTRY_IDS: MinistryId[]`.

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/ministries.test.ts
import { describe, it, expect } from "vitest";
import { MINISTRIES, ALL_MINISTRY_IDS, isMinistryId } from "@/app/ministries";

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

export function isMinistryId(x: unknown): x is MinistryId {
  return typeof x === "string" && x in MINISTRIES;
}
```

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

- [ ] **Step 1: Write failing tests** (extend the existing describe block; reuse its mock helper for `serverClient.fetch`)

```ts
it("normalizes absent/empty ministries to worship (legacy)", async () => {
  mockFetchOnce({ _id: "m1", disabled: false, role: "member" }); // no ministry fields
  expect((await getMemberAccess("m1")).ministries).toEqual(["worship"]);
  __clearMemberAccessCache();
  mockFetchOnce({ _id: "m1", disabled: false, role: "member", ministries: [] });
  expect((await getMemberAccess("m1")).ministries).toEqual(["worship"]);
});

it("passes stored ministries and managesMinistries through", async () => {
  mockFetchOnce({ _id: "m2", disabled: false, role: "member", ministries: ["kids"], managesMinistries: ["kids"] });
  const a = await getMemberAccess("m2");
  expect(a.ministries).toEqual(["kids"]);
  expect(a.managesMinistries).toEqual(["kids"]);
});

it("defaults managesMinistries to empty", async () => {
  mockFetchOnce({ _id: "m3", disabled: false, role: "admin" });
  expect((await getMemberAccess("m3")).managesMinistries).toEqual([]);
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

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

Normalization, immediately after the fetch:

```ts
const ministries =
  doc?.ministries && doc.ministries.length > 0 ? doc.ministries : ["worship"];
const managesMinistries = doc?.managesMinistries ?? [];
```

Return them from `getMemberAccess` and store in the cache entry. Do not change `isMemberActive`, the TTL, or the cache key.

- [ ] **Step 4: Run full memberAccess tests — expect PASS**
- [ ] **Step 5: Commit** — `feat(auth): member snapshot carries ministries + managesMinistries`

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
- Modify: `app/api/admin/members/[id]/route.ts` (PATCH allowlist — route is already super-admin-only for PATCH)
- Modify: `app/components/admin/AdminPanel.tsx` (Miembros section, ~line 684: add two checkbox groups to the member editor, sent flat in the existing PATCH body)
- Test: extend the route's existing test file if present; otherwise `app/api/__tests__/membersMinistries.test.ts` following the repo's route-test pattern.

**Interfaces:**
- Consumes: `ALL_MINISTRY_IDS`, `isMinistryId` (Task 1).
- Produces: PATCH accepts `ministries?: string[]`, `managesMinistries?: string[]`; invalid ids → 400.

- [ ] **Step 1: Failing test** — PATCH body `{ ministries: ["kids", "youth"] }` → 400 `"Invalid ministry"`; `{ ministries: ["kids"], managesMinistries: ["kids"] }` from a super-admin session → patch object contains both arrays verbatim; same body from an `admin` session → 403 (already enforced — assert it stays).

- [ ] **Step 2: Implement route change** — beside the existing `VALID_ROLES` validation:

```ts
import { isMinistryId } from "@/app/ministries";

for (const field of ["ministries", "managesMinistries"] as const) {
  const v = body[field];
  if (v !== undefined) {
    if (!Array.isArray(v) || !v.every(isMinistryId)) {
      return NextResponse.json({ error: "Invalid ministry" }, { status: 400 });
    }
    patch[field] = v;
  }
}
```

- [ ] **Step 3: Implement UI** — in the Miembros editor, two labelled checkbox rows ("Ministerios", "Administra ministerios") rendering `ALL_MINISTRY_IDS` / `["kids"]` with the member's current values; include both arrays in the existing flat PATCH body. Follow the section's existing input styling and its client-mutation invariant (try/catch/finally, `res.ok`, loading reset).
- [ ] **Step 4: Gates** — `npx tsc --noEmit && npm test && npx eslint .`
- [ ] **Step 5: Commit** — `feat(admin): super-admin edits member ministries + managesMinistries`

---

### Task 6: Worship page isolation

**Files:**
- Modify: `app/(client)/page.tsx`, `app/(client)/schedule/page.tsx`, `app/(client)/tag/[slug]/page.tsx`, `app/(client)/author/[slug]/page.tsx`, `app/(client)/posts/[slug]/page.tsx`
- (Untouched: `app/(client)/me/**` — ministry-neutral; `app/(client)/admin/page.tsx` — already worship-scoped via `requireActiveManager`; `/studio` — super-admin surface, existing protection.)

**Interfaces:**
- Consumes: `requireMinistryMember("worship")` (Task 4).
- Produces: kids-only members are redirected to `/kids` from every worship page (the `/kids` route lands in P2; until P2 merges the redirect target 404s, which is why **P1 and P2 merge to `main` together** — see Merge note at the end).

- [ ] **Step 1: Add the gate to each listed page** — at the top of the (async, server) page component:

```ts
import { requireMinistryMember } from "@/app/utils/authGuards";
import { redirect } from "next/navigation";
// inside the component, before any data fetch:
const worship = await requireMinistryMember("worship");
if (!worship) redirect("/kids");
```

The global login gate (`proxy.ts` matcher) already guarantees a session exists on these routes, so a `null` here means "active member, not worship" — redirecting to `/kids` (not signin) is correct. Keep each page's existing rendering untouched below the gate.

- [ ] **Step 2: Worship member APIs** — add the same gate returning 403 to the route handlers under `app/api/song/`, `app/api/content/`, `app/api/practice-playlist/`, `app/api/me/proposals/`, `app/api/me/songs/` (worship-content endpoints; the ministry-neutral `app/api/me/{route.ts,availability,notif-prefs,password,photo,push-token,theme}` stay as they are):

```ts
const worship = await requireMinistryMember("worship");
if (!worship) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

Where a handler already calls `requireActiveSession`, replace that call (the new guard subsumes it). Where it calls `requireActiveManager`, leave it alone — manager routes are worship-scoped already.

- [ ] **Step 3: Verify coverage** — `grep -rn "requireActiveSession" app/api/` and confirm every remaining call is on a deliberately ministry-neutral route; list them in the commit body.
- [ ] **Step 4: Gates** — all three.
- [ ] **Step 5: Commit** — `feat(auth): worship pages and member APIs require worship membership`

---

### Merge note

P1 alone leaves `/kids` redirects pointing at a route that does not exist yet. **Do not merge P1 to `main` on its own** — P1 and P2 ship in one merge (single release, one code review over the combined range). Implementation order is P1 then P2 on the same feature branch (`feat/kids-scheduling`).

### Verification (whole plan)

- `npx tsc --noEmit` clean; `npm test` green (including the new matrix tests); `npx eslint .` 0 errors.
- The Task 4 matrix is the auth contract: any change to guard behavior must fail one of those tests first.
