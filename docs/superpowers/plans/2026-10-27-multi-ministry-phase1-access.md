# Multi-ministry — phase 1, PRs 2 and 3: the access model (plan)

**Status:** PLANNED 2026-10-27; in adversarial review (log: `2026-10-27-multi-ministry-phase1-access-review-log.md`). ADR-0075. Parent plan:
`2026-10-27-multi-ministry-phase1.md`. Approval of this plan is not authorization to implement.
**Requirement (Frank, verbatim):** 2026-10-26 20:26Z «Puedes ayudarme a planear cómo convertiríamos
esto en una app que pueda servirle a varios ministerios sin agregar ruido entre sí? Algo como planning
center por ejemplo». 2026-10-27 18:44Z, on the three youth groups: «No me gustaría que los pastores de
Emprendedores vean el calendario de los de Otro Nivel y viceversa». 18:57Z: admins of Jóvenes are
«Noemí, Goma y Gaby» with Frank «siempre como super admin en todos los ministerios»; leaders «Otro
Nivel: Jakey y Andy, Emprendedores: Noemí y Hugo, Invencibles: Jakey y Andy». 23:15Z: «Cómo crees que
podemos manejarlo para no romper nada de la app?».
**Risk tier: critical**, derived from the ladder: this changes an auth/ACL boundary (the ministry
guards every Kids route and every worship page call) and a production writer of permissions (the
members POST/PATCH). The whole plan is that slice.

---

## 1. Goal and non-goals

**Goal.** The app can store and read, for each person, which ministries they belong to (now including
`jovenes`), their level in a leveled ministry (`member` / `leader` / `admin`) and their groups, through
ONE read function; Frank (super-admin) can write it from Miembros. **Every existing person's access is
unchanged**, proven by an equivalence test against the current guard code.

**Non-goals (phase 3 or later):** any Jóvenes page, route, document type, notice or nav entry; group
guards on routes (no group-scoped document exists yet); the session/JWT copy of `ministryRoles`;
moving worship (`role`) or Kids (`managesMinistries`) into `ministryRoles`; `requireActiveManager`
(worship's admin gate, 35 files) — untouched.

## 2. Evidence (today, `main` 93ed813e)

- `app/ministries.ts`: `MINISTRIES = { worship, kids }`; `isMinistryId` is array membership (prototype
  keys documented); `normalizeMinistries(v)`: known ids kept, empty/absent → `["worship"]`;
  `MANAGEABLE_MINISTRY_IDS = ["kids"]`; `validateMinistryWrite` rejects a stored `[]` for `ministries`.
- `app/utils/memberAccess.ts` `getMemberAccess(id)`: 30 s TTL cache, `serverClient` (no CDN), projects
  `{ _id, disabled, role, ministries, managesMinistries }`, returns `{active, role, ministries
  (normalized), managesMinistries (filtered by isMinistryId)}`; a missing doc → no ministries.
- `app/utils/authGuards.ts`: `requireMinistryMember(m)` = active session AND (`access.role ===
  "super-admin"` OR `access.ministries.includes(m)`); `requireMinistryManager(m)` = active AND
  (super-admin OR `access.managesMinistries.includes(m)`). Callers: every `/api/kids/*` route,
  `kidsCommit.ts`, `kidsScheduleReads.ts`, `/kids` and `/kids/admin`, `worshipPageGate.ts`, and worship
  member routes (`/api/me/*`, `/api/song/[id]`, `/api/audio/...`, `/api/practice-playlist`,
  `/api/rehearsal-queue`, `/api/notifications/count`). `app/(client)/kids/page.tsx:84` open-codes
  `access.role === "super-admin" || access.managesMinistries.includes("kids")`.
- `worshipPageGate.ts`: a non-worship member is redirected to `/kids` if Kids, else `/me` (terminates
  for any third ministry).
- Members API: `POST /api/admin/members` and `PATCH /api/admin/members/[id]` are super-admin only
  (checked on `session.user.role`); both run `validateMinistryWrite` on each present field; PATCH is
  touched-field (`!== undefined`). `adminMembersQuery` (`serviceReadQueries.ts:640`) projects the form's
  fields. The form (`MembersPanel.tsx`) always sends `role`, and `ministries`/`managesMinistries` only
  when touched (always on create), seeding `ministries` through `normalizeMinistries`.
- Readers that treat an unknown ministry id as junk under TODAY's code: `normalizeMinistries`
  (drops it, so `["jovenes"]` → `[]` → `["worship"]`). The GROQ audience (`WORSHIP_AUDIENCE_GROQ_FILTER`)
  does not: `["jovenes"]` is not worship there. The calendar feed
  (`app/api/calendar/[memberId]/[generation]/[token]/route.ts:97`) uses `normalizeMinistries`.
- Studio: `sanity/schemas/worshipTeam.ts` `ministries` offers worship and kids; `managesMinistries`
  offers kids.

## 3. Design

### 3.1 Registry (`app/ministries.ts`)

- `MINISTRIES.jovenes = { id: "jovenes", name: "Jóvenes", groups: [{ id: "otro-nivel", name: "Otro
  Nivel" }, { id: "invencibles", name: "Invencibles" }, { id: "emprendedores", name: "Emprendedores" }] }`;
  worship and kids get `groups: []`.
- `LEVELED_MINISTRY_IDS: MinistryId[] = ["jovenes"]` — ministries whose level and groups live in
  `ministryRoles`. Worship's level stays `role`; Kids' admin stays `managesMinistries`.
- `MINISTRY_LEVELS = ["member", "leader", "admin"] as const`.
- `isGroupId(ministry, x)`: array membership in that ministry's `groups` ids (never `in`).
- `MANAGEABLE_MINISTRY_IDS` stays `["kids"]`: Jóvenes management is a level, not `managesMinistries`.
- **`ASSIGNABLE_MINISTRY_IDS`** — the ministries a write may store and the form may offer. PR 2:
  `["worship", "kids"]`; PR 3 adds `"jovenes"`. Registering `jovenes` in `MINISTRIES` (PR 2) makes it
  READABLE, never writable: `validateMinistryWrite("ministries", …)`, the form's ministry pills,
  `MINISTRY_SCOPES` and its counts in `MembersPanel.tsx`, and the Studio `ministries` options all read
  `ASSIGNABLE_MINISTRY_IDS`, not `ALL_MINISTRY_IDS`. Without this, PR 2 alone would let the form, the
  routes and the Studio store `["jovenes"]` while §4.1 says only PR 3 may. `ALL_MINISTRY_IDS` stays the
  read-side list (`normalizeMinistries`, `isMinistryId`).

### 3.2 Storage (`teamMembers.ministryRoles`)

Array of objects `{ _key, ministry, level, groups: string[] }`, `_key` = the ministry id (unique per
person, stable, and addressable by `ministryRoles[_key=="jovenes"]`). Studio: the field is shown
`readOnly` (one writer: the members API); `ministries` gains the `jovenes` option in PR 3 (with
`ASSIGNABLE_MINISTRY_IDS`), not in PR 2. Additive only.

### 3.3 Read: one function

`getMemberAccess` projects `ministryRoles` and hands the fetched document to a new pure
`accessFromDoc(doc)` (in `memberAccess.ts`), which does ALL of today's normalization (active,
`normalizeMinistries`, the `managesMinistries` filter) plus the new field; `getMemberAccess` keeps only
the fetch and the cache. The equivalence test (§5) runs raw documents through `accessFromDoc`, so it
also catches a forgotten projection or roles computed from un-normalized `ministries`. `auth.ts`'s
impersonation copy of `ministries` is not touched (phase 1 puts nothing new in the session).
`accessFromDoc` returns `ministryRoles: MinistryRole[]` produced by the pure
`normalizeMinistryRoles(raw, ministries)` (new, in `app/ministries.ts`):

1. Not an array → `[]`. Each item must be an object with `ministry` in `LEVELED_MINISTRY_IDS`
   (via `isMinistryId` + list membership) **and in the normalized `ministries`**; otherwise dropped.
   A leveled ministry the person is not a member of grants nothing.
2. `level` not in `MINISTRY_LEVELS` → the item is dropped (fail closed: plain membership, no level).
3. `groups`: non-array → `[]`; entries kept only if `isGroupId(ministry, g)`; de-duplicated.
4. Two items for the same ministry → **both dropped** (fail closed to plain membership).

A new pure module `app/utils/ministryAccess.ts` answers from that snapshot:

- `isMinistryMember(a, m)` = `a.role === "super-admin" || a.ministries.includes(m)` — the current
  guard, verbatim.
- `isMinistryManager(a, m)` = super-admin → true; `m` leveled → `isMinistryMember` (without the
  super-admin arm) AND its entry's `level === "admin"`; otherwise `a.managesMinistries.includes(m)` —
  the current guard, verbatim, for worship and kids.
- `levelIn(a, m)` and `groupsIn(a, m)` for leveled ministries (`"member"` and `[]` when a member has
  no entry). Not called by any route in phase 1; phase 3's group guards build on them.

`requireMinistryMember` / `requireMinistryManager` keep their signatures and return the same values,
now computed by `isMinistryMember` / `isMinistryManager`. `kids/page.tsx:84` calls
`isMinistryManager(access, "kids")` instead of open-coding it.

### 3.4 Write: members POST and PATCH

Both accept an optional `ministryRoles`, validated by `validateMinistryRolesWrite(value, ministries)`
in `app/ministries.ts` (same function for both routes, as `validateMinistryWrite` is today):

- array; each item an object with exactly `ministry`, `level`, `groups`; `ministry` leveled;
  `level` in `MINISTRY_LEVELS`; `groups` an array of `isGroupId(ministry, g)`, no duplicates;
  at most one item per ministry; a `leader` has at least one group.
- **`ministries` must be present in the SAME request and include every item's ministry**, explicitly.
  This closes the trap in §6.1: no request can store a Jóvenes level for someone whose stored
  `ministries` might be absent (= worship).
- The route stores items with `_key = ministry`.

Plus two route rules:

- **Dropping a leveled ministry clears its level.** When a request's `ministries` omits a leveled
  ministry and the request carries no `ministryRoles`, the route also `unset`s
  `ministryRoles[_key=="<id>"]` for each leveled ministry not in it, in the same patch. (Read already
  ignores such entries; this keeps a stale level from reviving if the ministry is re-added.)
- **A worship role needs worship.** Judged on the RESULTING state whenever a request carries `role`
  or `ministries`: resulting role = `body.role` if present, else the stored role; resulting
  ministries = `normalizeMinistries(body.ministries)` if present, else the stored one normalized (PATCH
  reads both with `serverClient`; POST has no stored state). If the request CHANGES the role or the
  ministries (a value differing from the stored one; on POST, always) and the result is a role other
  than `member` or `super-admin` without `"worship"`, the route answers 400 «Un rol de Alabanza (admin
  o editor) requiere ser de Alabanza». A role-only PATCH is therefore caught too. A request that
  re-sends an unchanged role and unchanged ministries is NOT refused (the form always sends `role`, so
  refusing it would lock an already-inconsistent person out of every other edit). Why it exists:
  `requireActiveManager` reads `role` alone, so a Jóvenes admin given role `admin` by mistake would
  become a worship admin. PR 3's description carries a read-only count of members whose stored role is
  `admin`/`content-editor` and whose normalized ministries lack worship (expected 0). When a PATCH
  judged the rule on the stored state, its patch carries `ifRevisionId` = the `_rev` it read, and a
  mismatch answers 409 «Alguien más cambió a esta persona; recarga» (no silent read-then-write on a
  permission writer).
- **The Studio is a second writer of `role` and `ministries`** (`worshipTeam.ts`), so the API rule alone
  does not close risk 3. PR 3 adds a Studio validation on `role`: `admin`/`content-editor` without
  `"worship"` in `ministries` (absent counts as worship) is an error that blocks publishing. A Studio
  edit that removes `jovenes` from `ministries` leaves `ministryRoles` in place; the read ignores it
  (§3.3 rule 1), and re-adding `jovenes` from the Studio would revive the old level. Accepted and
  documented: the Studio is a super-admin tool, and the Miembros form (which clears the level) is the
  supported path.
- **`set` and `unset` never touch the same path in one patch**: the unset of the rule above runs only
  when the body carries no `ministryRoles`; when it does, the route `set`s the whole array instead.

The form: when `ministries` includes `jovenes`, a «Jóvenes» block shows a level control (Miembro /
Líder / Admin, the `SegmentedControl` primitive) and the three groups as pills (`Button variant="pill"`).
Touching the block, or touching `ministries`, makes the submit carry both `ministries` and
`ministryRoles` (create: always). The form seeds the block from the stored items and strips `_key`
before sending (the validator accepts exactly `ministry`, `level`, `groups`), pinned by a form test.
The role `Select` label becomes «Rol en Alabanza». `adminMembersQuery`
gains `ministryRoles` only through a conditional projection arm, `$all => { ministryRoles }` (`$all` is
bound true only for the super-admin), so a worship admin's member list never carries it. Super-admin
only, as today.

## 4. Release order (the part that breaks things if skipped)

0. **Before PR 2 merges**, a read-only count proves the one intended divergence of §5 touches nobody
   today: `count(*[_type=="teamMembers" && count(ministries[!(@ in ["worship","kids"])]) > 0])` and the
   same for `managesMinistries[!(@ in ["kids"])]`, both expected 0, recorded in PR 2's description. A
   non-zero count stops PR 2 until Frank decides what those members are.
1. **PR 2 reaches PRODUCTION before PR 3 is merged into `preview`.** `preview` writes the real
   dataset. Under code older than PR 2, a stored `["jovenes"]` reads as worship (§2). So no
   deployment may be able to write `jovenes` while production cannot read it.
2. **PR 2 is never reverted while any member holds `"jovenes"`.** Before a revert, count
   `count(*[_type=="teamMembers" && "jovenes" in ministries])` (read-only); if not zero, take
   `jovenes` off those members first (a write in production: dry run, then Frank's consent).
   Until PR 3, nothing can write `"jovenes"` at all (`ASSIGNABLE_MINISTRY_IDS`, §3.1), so this count is
   0 by construction while only PR 2 is out.
3. **No dev check writes data in phase 1.** The dev checks of PRs 2 and 3 sign in as the Verificador bot
   AS SEEDED (`scripts/lib/dev-verify/seedDoc.ts`: role `admin`, `["worship"]`, manages kids) and prove
   only that its worship and Kids screens are unchanged; `scripts/dev-verify.ts` cannot write (it aborts
   any non-GET, `docs/DEV_VERIFY.md` «Why it cannot write»). The bot is NOT turned into a Jóvenes-only
   member: that would be a write to the dataset production reads, needing a dry run and Frank's consent,
   and the obvious shape (only `ministries: ["jovenes"]`) is a Jóvenes-only worship ADMIN, which the
   worship-role rule forbids and whose `/admin` still opens (role-gated). Jóvenes-only isolation is
   proven in phase 1 by the tests of §5 (guards, `requireWorshipPage`, the audience string, the calendar
   route). A live Jóvenes-only check waits for phase 3, through a dedicated second bot seeded by a guarded
   `scripts/` one-off (dry run, then `--apply` after Frank's consent; state `role: "member"`,
   `ministries: ["jovenes"]`, `managesMinistries: []`), when there are Jóvenes screens to look at.
4. The first real Jóvenes registrations are Frank's, from production Miembros, after PR 3 is in
   production: the admins and the group leaders only. The rest of the pastors come in phase 3, when
   there is a Jóvenes screen for them to land on.

## 5. Tests

- **Equivalence (the gate):** `ministryAccess.equivalence.test.ts` keeps a verbatim copy of today's
  two guard predicates as the oracle and runs both over the product of: role ∈ {super-admin, admin,
  content-editor, member, null, "weird"} × raw `ministries` ∈ {absent, `[]`, `["worship"]`,
  `["kids"]`, `["worship","kids"]`, `["worship","jovenes"]`, `["jovenes"]`, `["toString"]`, `"worship"`,
  `[null]`, `["kids","constructor"]`} ×
  raw `managesMinistries` ∈ {absent, `[]`, `["kids"]`, `["worship"]`, `["__proto__"]`} × raw
  `ministryRoles` ∈ {absent, a valid jovenes admin, junk}, for m ∈ {worship, kids}. Every pair must
  agree. The oracle normalizes with a verbatim copy of today's `normalizeMinistries`. Rows whose
  `ministries` contain `jovenes` (`["worship","jovenes"]` agrees; `["jovenes"]` alone does NOT: today's
  code reads it as worship) are asserted separately as the ONE intended divergence: under the new code
  a Jóvenes-only member is not a worship member.
- `normalizeMinistryRoles`: each rule of §3.3 by itself; duplicates; prototype strings as ministry,
  level and group.
- `validateMinistryRolesWrite`: each rule of §3.4, including «ministries absent from the request».
- **PR 2, write side closed:** with PR 2 alone, POST and PATCH both reject `ministries: ["jovenes"]`
  and `["worship","jovenes"]` (400), the form offers no Jóvenes pill and no Jóvenes scope, and the
  Studio options are worship and kids (schema sync against `ASSIGNABLE_MINISTRY_IDS`).
- Members routes (`membersMinistries.test.ts`, PR 3): create and edit with `ministryRoles`; `_key`; the
  unset path when `ministries` drops `jovenes`; no patch both sets and unsets `ministryRoles`; the
  worship-role rule: body role, stored role, a role-only PATCH (`{role:"admin"}` on a stored
  `["jovenes"]` → 400), a ministries-only PATCH (`["jovenes"]` on a stored admin → 400), an unchanged
  role and ministries re-sent on an already-inconsistent person → saves, super-admin passes; a PATCH
  without the new fields behaves exactly as today.
- A Jóvenes-only member (`ministries: ["jovenes"]`): fails `requireMinistryMember("worship")`, is
  redirected by `requireWorshipPage` to `/me`, is outside `WORSHIP_AUDIENCE_GROQ_FILTER` (string
  check), and the calendar route answers 404.
- Schema sync: `ministries` options and the `ministryRoles` lists in `worshipTeam.ts` match the
  registry (a new `ministrySchemaSync.test.ts`).
- Existing suites green: `authGuards.test.ts`, `memberAccess.test.ts`,
  `impersonationMinistries.test.ts`, `memberListMinistryScope.test.tsx`,
  `adminMemberVisibility.test.ts` unchanged. `ministries.test.ts` changes on purpose in its first test
  (lines 6–8): the `toEqual` of `MINISTRIES.worship` and `MINISTRIES.kids` gain `groups: []`,
  `ALL_MINISTRY_IDS` becomes the three ids, and a new assertion pins `ASSIGNABLE_MINISTRY_IDS` to
  `["worship","kids"]` in PR 2 (three in PR 3). `memberAccess.test.ts` gains `accessFromDoc` cases.
- PR 3: the Studio `role` validation (§3.4) as a pure function, tested; the 409 on a stale `_rev`.

## 6. Risks and how each is closed

1. **Absent `ministries` = worship.** A Jóvenes-only pastor stored without an explicit `ministries`
   would be a worship member. Closed by §3.4 (ministries required with ministryRoles), §3.3 rule 1 and
   §4.1.
2. **Old code reading new data** (preview vs production, or a revert). Closed by §4.1–4.2.
3. **A Jóvenes admin made a worship admin** through `role`. Closed by the worship-role rule (§3.4) in
   the API and its Studio validation.
4. **Prototype strings** in ministry, level or group. Closed by list membership everywhere (§3.1).
5. **Duplicate or malformed `ministryRoles`.** Fail closed to plain membership (§3.3).
6. **Registering a ministry makes it writable.** Every write and offer site reads
   `ASSIGNABLE_MINISTRY_IDS`, which gains `jovenes` only in PR 3 (§3.1), pinned by tests (§5).
7. **Known noise, left for phase 3:** a worship admin's member list still includes someone with
   `["worship","jovenes"]`, with the raw `ministries` projected, so a worship admin can see that a
   worship member is also in Jóvenes (not their level or groups). Phase 3's «sin ruido» list scoping
   handles it.
8. **Session copy.** Unchanged in phase 1: no `ministryRoles` in the JWT, so impersonation has
   nothing new to copy; every decision still re-reads `getMemberAccess`.

## 7. Delivery

PR 2: registry (with `ASSIGNABLE_MINISTRY_IDS` = worship, kids, and every write/offer site moved onto
it), `normalizeMinistryRoles`, `ministryAccess.ts`, `getMemberAccess`, the two guards, `kids/page.tsx`,
Studio field (readOnly), tests of §5 except PR 3's routes and form.
PR 3: `jovenes` into `ASSIGNABLE_MINISTRY_IDS` and the Studio `ministries` option,
`validateMinistryRolesWrite`, both routes, `adminMembersQuery`, the form, route and form tests.
Each: the five CI gates, one fresh code review before `main`, a scoped re-review if a fix closes a HIGH
finding. CLAUDE.md's invariants gain the two rules of §6.1 and §4.2 in PR 2, and the docs
(`UTILITIES_AND_COMPONENTS.md`, `docs/agents/project-rules.md`) the new functions.
