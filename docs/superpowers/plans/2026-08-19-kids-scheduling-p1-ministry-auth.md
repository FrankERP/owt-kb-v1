# Kids Scheduling P1 — Ministry Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ministry membership + ministry-scoped management on `teamMembers`, enforced by new server-side guards, with two-way worship/kids isolation (only `super-admin` spans both).

**Architecture:** A code-level ministry registry (`app/ministries.ts`); two new array fields on `teamMembers` (absent = worship, no migration); the existing 30s-TTL `getMemberAccess` snapshot extended to carry them; the JWT/session carrying them too (free — `auth.ts` already calls `getMemberAccess` on every token refresh) so client nav can filter by ministry; two new guards in `authGuards.ts` beside the existing ones; super-admin-only editing via the existing members routes, touched-field-only so an unrelated edit cannot silently wipe a privilege; worship member pages/APIs gated on worship membership.

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

Normalization, immediately after the fetch:

```ts
const ministries =
  doc?.ministries && doc.ministries.length > 0 ? doc.ministries : ["worship"];
const managesMinistries = doc?.managesMinistries ?? [];
```

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

Place it inside the existing `if (eff)` block so impersonation keeps working: the effective identity's ministries are what the UI must reflect.

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

Then: `{showSchedule && inWorship && <MenuItem href="/schedule">Calendario</MenuItem>}`, `{showTags && inWorship && <MenuItem href="/tag">#Tags</MenuItem>}`, `{isAdmin && inWorship && <MenuItem href="/admin">Admin</MenuItem>}`, plus `{inKids && <MenuItem href="/kids">Oasis Kids</MenuItem>}` and `{managesKids && <MenuItem href="/kids/admin">Planear Kids</MenuItem>}`. `/me` stays unconditional — it is ministry-neutral.

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
- Modify: `app/components/admin/AdminPanel.tsx` (`Member` interface ~line 28, `MemberFormData` ~line 40, `MemberForm` state + `onSubmit` ~line 240-252, Miembros editor ~line 684)
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

`GET` projection in `app/api/admin/members/route.ts` — add both fields to the existing projection:

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

```ts
import { isMinistryId } from "@/app/ministries";

const MANAGEABLE = ["kids"] as const; // worship management lives in the legacy roles

if (body.ministries !== undefined) {
  if (!Array.isArray(body.ministries) || !body.ministries.every(isMinistryId)) {
    return NextResponse.json({ error: "Invalid ministry" }, { status: 400 });
  }
  patch.ministries = body.ministries;
}
if (body.managesMinistries !== undefined) {
  if (!Array.isArray(body.managesMinistries) ||
      !body.managesMinistries.every((m: unknown) => MANAGEABLE.includes(m as never))) {
    return NextResponse.json({ error: "Invalid ministry" }, { status: 400 });
  }
  patch.managesMinistries = body.managesMinistries;
}
```

- [ ] **Step 3: UI — types and seeding.** Add `ministries?: string[]` and `managesMinistries?: string[]` to both the `Member` interface (`:28-38`) and `MemberFormData` (`:40`). Seed form state from the fetched member: `useState<string[]>(initial?.ministries ?? [])` and likewise for `managesMinistries`.

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

- [ ] **Step 5: UI — the controls.** Two labelled checkbox rows in the Miembros editor: "Ministerios" over `ALL_MINISTRY_IDS` (labels from `MINISTRIES[id].name`) and "Administra ministerios" over `["kids"]` only. Follow the section's existing input styling and the client-mutation invariant (try/catch/finally, `res.ok`, loading reset).
- [ ] **Step 6: Gates** — `npx tsc --noEmit && npm test && npx eslint .`
- [ ] **Step 7: Commit** — `feat(admin): super-admin edits member ministries (touched-field-only)`

---

### Task 6: Worship page isolation

**Files:**
- Modify — **seven** worship pages: `app/(client)/page.tsx`, `app/(client)/schedule/page.tsx`, `app/(client)/tag/page.tsx`, `app/(client)/tag/[slug]/page.tsx`, `app/(client)/author/page.tsx`, `app/(client)/author/[slug]/page.tsx`, `app/(client)/posts/[slug]/page.tsx`
- Create: `app/utils/worshipPageGate.ts` (one shared gate, so seven copies cannot drift)
- (Untouched: `app/(client)/me/**` — ministry-neutral, and its nav links are ministry-filtered in Task 3b; `app/(client)/admin/page.tsx` — already worship-scoped via `requireActiveManager`; `/studio` — super-admin surface with its own protection; `app/(client)/auth/**` — pre-session.)

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
  if (!worship) redirect("/kids");
}
```

- [ ] **Step 2: Test the split** — `app/utils/__tests__/worshipPageGate.test.ts`, mocking `next/navigation`'s `redirect` and the two guards:
  - no active session → redirect target starts with `/auth/signin`, **never** `/kids`;
  - **disabled member** (active session null, even though a token exists) → sign-in, not `/kids` — the anti-loop regression test;
  - active kids-only member → `/kids`;
  - active worship member → no redirect called.

- [ ] **Step 3: Apply to all seven pages** — first line of each async server component, before any data fetch, with that page's own path as the callback (e.g. `await requireWorshipPage("/tag")`). Keep the rendering below untouched.

- [ ] **Step 4: Note the rendering-mode change in each page's diff.** All seven currently render statically/ISR (`page.tsx` `revalidate = 60`, `posts/[slug]` `revalidate = 3600` **plus `generateStaticParams`**). `getServerSession` reads `cookies()`, so each becomes dynamic and its `revalidate` stops meaning what it meant. This is the accepted cost of server-side isolation — the requirement is that a typed URL is blocked, which a static page cannot do. `next.config.mjs` sets no `dynamicIO`/PPR, so this is a mode change, not a build failure. Say so in the commit body; do not silently drop the `revalidate` exports.

- [ ] **Step 5: Worship member APIs** — add to `app/api/song/**` and `app/api/practice-playlist/**` (member-session worship endpoints):

```ts
const worship = await requireMinistryMember("worship");
if (!worship) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

Replace an existing `requireActiveSession` call with it (the new guard subsumes that check). **Do not touch `app/api/content/**`** — all of its handlers gate on `requireActiveManager`, which is already worship-scoped; adding a membership check there would be a no-op at best. `app/api/me/{route.ts,availability,notif-prefs,password,photo,push-token,theme}` stay ministry-neutral by design. `app/api/me/proposals` and `app/api/me/songs`: gate only if they exist and use a member session — verify in Step 6 and record the finding.

- [ ] **Step 6: Verify coverage by enumeration, not grep.** A `grep` for `requireActiveSession` cannot find a page that never had a session call — which is exactly how `/tag` and `/author` hid. Instead run `find "app/(client)" -name "page.tsx"` and, in the commit body, list **every** result with one word each: `gated` or `neutral (why)`. Do the same for `find app/api -name "route.ts"`. A page absent from that list is an unreviewed hole.

- [ ] **Step 7: Gates** — all three.
- [ ] **Step 8: Commit** — `feat(auth): worship pages and member APIs require worship membership`

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
