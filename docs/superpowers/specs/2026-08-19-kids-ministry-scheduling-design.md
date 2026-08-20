# Kids ministry scheduling — design spec

**Date:** 2026-08-19
**Status:** Approved design (brainstorm 2026-08-19), pending review per workflow tier
**Author:** Frank + Claude

## 1. Context and goal

The Oasis Kids team asked for the same kind of automated monthly scheduling the
worship team has. Their rules (captured verbatim from Kids leadership,
2026-08-19):

- Every Sunday needs **4 assignments**, each held by a **pair** (pareja):
  **Enseñanza**, **Reunión General Chiquitos**, **Reunión General Medianos**,
  **Reunión General Grandes**.
- Each age room has a **fixed roster of 4 pairs**; only that room's pairs may
  cover that room.
- **Enseñanza draws from all pairs** (currently 12), regardless of room.
- A pair cannot hold two roles the same Sunday.
- Rotation should be fair (each room's pairs cycle ~monthly; Enseñanza cycles
  across the full pool).

Strategic decision behind this design: Backstage grows toward a
multi-ministry Planning-Center-style app **incrementally** — Kids ships as its
own vertical slice, sharing only the primitives every ministry needs
identically (members, availability, ministry-scoped auth). Generic
"ministry scheduling" schemas are **deliberately not built now**; they get
extracted when a **third** ministry arrives and two real examples exist.
This decision is recorded as **ADR-0019** (write it in the same delivery).

## 2. Non-goals

- **No assignment emails for Kids yet.** Deferred until the app-wide outbox
  work lands. The outbox is already ministry-agnostic; wiring Kids in later is
  additive. This spec must not touch notification code.
- **No OR-Tools / GCF solver.** The rotation is solved with pure in-app
  functions (§7). The GCF remains worship-only.
- **No migration of worship documents.** `sunday_role`/`saturday_role`/
  `special_role`, setlists, songs, proposals are untouched.
- **No generic ministry schemas.** `kidsPair`/`kidsSchedule` are
  Kids-specific by design (see ADR-0019).
- **No Saturday scheduling for Kids.** Sundays only, per their rules.

## 3. Ministry registry

`app/ministries.ts` — a typed code-level registry:

```ts
export const MINISTRIES = {
  worship: { id: "worship", name: "Alabanza" },
  kids: { id: "kids", name: "Oasis Kids" },
} as const;
export type MinistryId = keyof typeof MINISTRIES;
```

Adding a ministry is a code change (honest: every new ministry needs its own
rules and UI anyway). Worship is the implicit legacy ministry — existing
documents carry no ministry field and never will until generalization day.

## 4. Data model

All new writes go through API routes (never client-direct), carry `_key` on
every array item, and follow the timezone invariant (`date` fields are Sanity
`date` strings `YYYY-MM-DD`, rendered pinned to local noon).

### 4.1 `teamMembers` additions (existing schema, two new fields)

- `ministries: string[]` — which ministries this member belongs to.
  **Absent field means `["worship"]`** — no migration of existing docs.
  Kids-only people get ordinary member docs (same SSO login) with
  `ministries: ["kids"]`.
- `managesMinistries: string[]` — ministry-scoped management rights (§5).
  Absent means none.

Existing fields reused as-is: `unavailableDates` (ISO dates) and
`unavailabilityNotes`, set from `/me` — now honored by both ministries.

### 4.2 `kidsPair` (new document type)

- `name: string` — display name, e.g. "Linnette y Vale".
- `members: reference[]` — exactly 2 refs to `teamMembers` (validated), each
  item with `_key`.
- `room: "chiquitos" | "medianos" | "grandes"` — the pair's home room.
- `active: boolean` (default `true`) — retired pairs stay for history but
  leave all eligibility pools.

Pairs are edited by Kids managers in the app (§8), not in Studio.

### 4.3 `kidsSchedule` (new document type, one per Sunday)

- `date: date` — the Sunday (`YYYY-MM-DD`), unique per document
  (deterministic `_id`: `kidsSchedule-<date>` so a re-generate updates rather
  than duplicates, and concurrent creates cannot fork).
- Four seats, each a single `reference` to `kidsPair`:
  `ensenanza`, `chiquitos`, `medianos`, `grandes` (field names unaccented).
  A seat may be empty (unfillable weeks stay honest — §7).
- `published: boolean` — **draft by default**; member-facing reads filter
  `published != false`, same convention as services.

### 4.4 Cache

Mutation routes call `revalidatePath` for the Kids views (`/kids`, `/me`, and
any member-facing schedule page) — add a `revalidateKidsViews` util in
`app/utils/revalidate.ts` beside the existing ones.

## 5. Auth: ministry-scoped management and two-way isolation

**Isolation ruling (Frank, 2026-08-19): ministries are mutually invisible.
Kids-only people see no worship surfaces; worship admins see no Kids
surfaces. Only `super-admin` spans both.**

New server-side guard in the same family as `requireActiveManager`:

```ts
requireMinistryManager(ministry: MinistryId)
```

Passes for `super-admin`, or any active member whose `managesMinistries`
includes the ministry. **Plain `admin` does NOT pass for ministries it
doesn't manage** — a worship admin has no Kids access. The legacy roles
(`admin`, `content-editor`) are worship-scoped: existing worship surfaces
keep their current `requireActiveManager` gates unchanged, and those gates
grant nothing in Kids. Built generic from day one — this is the one piece
every future ministry needs identically.

- All `/api/kids/*` mutation routes use `requireMinistryManager("kids")`.
- The existing `isMemberActive` 30s-TTL gate and `disabled` kill switch apply
  unchanged (the new guard composes with them, not around them).
- Kids leaders get app role `member` + `managesMinistries: ["kids"]` — they
  run Kids scheduling and **cannot** touch setlists, songs, worship roles, or
  member app-role fields.
- Editing `managesMinistries` itself is **super-admin only** (neither a
  ministry manager nor a worship admin may mint or alter Kids managers).
- Studio protection (`studioProtection.ts`) posture for the new types follows
  the existing pattern: app is the writer, Studio is not the editing surface.

### 5.1 Member-facing visibility

Membership (`ministries`) gates what a logged-in member can *see*, enforced
server-side at three layers — nav rendering, page guards, and API/read
guards — so a direct URL is blocked, not merely unlinked:

| Who | Worship surfaces | Kids surfaces |
|---|---|---|
| Kids-only member (`ministries: ["kids"]`) | none | own schedule + availability |
| Worship member (absent field ⇒ `["worship"]`) | unchanged | none |
| Member in both ministries | member views | member views |
| Kids manager (`managesMinistries: ["kids"]`) | none (unless also a worship member) | full Kids admin |
| `admin` / `content-editor` | unchanged | none |
| `super-admin` | everything | everything |

- Worship member pages (songs, setlists, services, participation) require
  `ministries` to include `worship`. Because an absent field means
  `["worship"]`, every existing member keeps exactly today's access — no
  migration, no regression.
- A Kids-only member's landing page is the Kids member view, not the worship
  home.
- Management rights do not imply membership: a Kids manager who also sings
  needs `ministries: ["worship", "kids"]` like anyone else.

## 6. Availability: self-serve + admin override

- **Self-serve:** members (worship and Kids alike) keep setting
  `unavailableDates` from `/me`. No change.
- **Admin override:** Kids managers can edit `unavailableDates` /
  `unavailabilityNotes` **for members whose `ministries` includes `kids`**,
  from the Kids admin surface — because some Kids volunteers may never log
  in. The route enforces the ministry-membership check server-side; a Kids
  manager cannot edit a worship-only member's availability.
- The override writes the same fields the member writes — one source of
  truth, no parallel availability store.

## 7. Rotation logic — pure functions, deterministic, tested

`app/utils/kidsRotation.ts`. Inputs: the month's Sundays, active pairs (with
room), per-member unavailable dates, prior `kidsSchedule` history (for
fairness), and the month's worship assignments (for warnings only). Output: a
proposed schedule per Sunday plus structured diagnostics.

Rules, in order of force:

1. **Eligibility (hard):** room seats draw from that room's pairs; Enseñanza
   draws from all active pairs.
2. **Availability (hard):** a pair is unavailable on a date if **either**
   member has that date in `unavailableDates`.
3. **No double-booking (hard):** a pair holds at most one seat per Sunday.
4. **Fairness (soft, deterministic):** least-recently-served wins, tracked
   **per seat category** (a pair's Enseñanza turns and room turns are separate
   clocks). Ties break deterministically (older last-served first, then
   `_id`) so identical inputs always produce identical output — the property
   the tests assert.
5. **Cross-ministry overlap (warn, never block):** if a proposed pair member
   is already assigned on the worship roles that date (via
   `assignedMemberRefsQuery` — all five seats), emit a warning diagnostic the
   UI surfaces. Frank's ruling: "better if we could avoid, not world-ending."
6. **Honest degradation:** if a seat has no eligible available pair, leave it
   empty and say so in diagnostics — never silently seat an ineligible pair
   (same philosophy as the worship solver's honest diagnostic).

Unit tests cover: each hard rule, fairness rotation over a multi-month
sequence, determinism (same input twice → same output), the
either-member-unavailable rule, the unfillable-seat diagnostic, and the
overlap warning.

## 8. UI (Spanish, both themes)

- **`/kids` admin planner** (gated by `requireMinistryManager("kids")` via
  the server session; nav link visible only to those who pass):
  - Month grid: Sundays × 4 seats. "Generar mes" runs the rotation and shows
    the proposal with warnings/diagnostics; per-seat manual override
    (dropdown of eligible pairs, ineligible ones not offered); save as
    drafts; publish per Sunday or per month.
  - Pair roster management: create/edit/retire pairs, assign room.
  - Availability override per Kids member (§6).
  - Reuses the planner-grid *patterns* and `useTransientValue` for every
    toast/flash — not the worship components themselves.
- **Member-facing:** Kids assignments appear in the member's upcoming-
  services view ("mi rol"), reading only `published != false` schedules.
  Visibility follows the §5.1 matrix: a Kids-only member lands on the Kids
  member view and every worship surface is server-side blocked for them;
  a dual-ministry member sees both; worship-only members see no Kids UI.
- All client mutation handlers follow the invariant: try/catch/finally,
  check `res.ok`, reset loading, never close-as-success on failure.

## 9. Verification

- Gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors).
- New unit tests: rotation (§7), `requireMinistryManager` (role matrix ×
  ministry matrix, disabled member, non-member), availability-override
  scoping, member-facing read filters (`published != false` present in every
  Kids member-facing query).
- Browser verification on preview: Kids manager sees `/kids` and cannot
  reach worship admin; **worship `admin` gets blocked from `/kids` and its
  APIs**; **Kids-only member gets blocked from worship pages by direct URL**,
  lands on the Kids member view, and sees no worship nav; worship member
  does not see Kids nav; super-admin reaches both; generate → override →
  publish → member view round-trip.
- Deploy per convention: feature branch → main (local merge, gates green) →
  preview push → **verify dev alias moved** → main push → verify prod alias.

## 10. Risk tier (under the 2026-08-19 retiered workflow)

- **Critical — adversarial plan review required:** the auth slice only
  (`requireMinistryManager`, `managesMinistries`, and the `/api/kids/*`
  mutation routes' guard wiring) — it changes an auth/mutation trust
  boundary. Review that slice's implementation plan, not this whole spec.
- **Standard — no adversarial plan review:** everything else (schemas,
  rotation pure functions, planner UI, member-facing views, availability
  override UI). Pipeline: this spec (user-reviewed) → implement → gates →
  fresh code review of the diff.

## 11. Invariants checklist (CLAUDE.md)

- Timezone/date handling: §4.3, §7 — all dates `YYYY-MM-DD`, local-noon render.
- `_key` on array items: §4 writes.
- `published != false` on member-facing reads: §4.3, §8.
- Cache revalidation on mutation: §4.4.
- Client mutation handler discipline: §8.
- `saturdarSongs` / worship schemas: untouched (§2).
- Five-seat worship queries: only *read* for warnings via
  `assignedMemberRefsQuery` (§7.5) — never modified.
- Secrets: none introduced; no `docs/SECRETS.md` change expected.
