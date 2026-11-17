# Planear Jóvenes shows «No disponible» — who sees a pastor's unavailable days

**Date:** 2026-11-17 · **Branch:** `claude/project-thread-jn7uj2` · **Base:** `main` 1a2d5e9f plus
this branch (PR #249) · **Status:** plan under review; nothing in §4–§6 is implemented.

## 1. Requirement (Frank, 2026-11-17, his words)

> «los pastores de jóvenes también deben poder registrar su disponibilidad»

A pastor can already save their days at `/me/disponibilidad` (ministry-neutral page,
`PATCH /api/me/availability`; commit 2d917c96 added the way in from Jóvenes and their meetings as
dots). Registering a day is only useful if whoever builds the roster learns of it. Today nothing in
Planear Jóvenes reads `unavailableDates`. This slice makes Planear SAY that a person marked a day,
without blocking the pick.

**Audience, pending Frank's answer to a decision card** (asked 2026-11-17 18:25Z, default below
until he answers):

- **Default (recommended): Jóvenes admins, and a leader for the members of the groups they lead.**
  The leader arm is the FIRST non-manager audience for anyone's availability (the worship and Kids
  reads of §2 are manager-gated). What it gives a leader: the future marked days (never the note)
  of every member of a group they lead, co-leaders and Jóvenes admins in that group included.
- «Solo admins de Jóvenes»: delete the leader arm of §3 R2 (`awayVisibleTo` returns `isManager`).
  A strict narrowing; nothing else in this plan changes.
- «Nadie por ahora»: this slice is not released.

## 2. What exists (verified against the tree)

- `teamMembers.unavailableDates: string[]` (`YYYY-MM-DD`) and `unavailabilityNotes: {date, note}[]`
  are ONE calendar per person, shared by every ministry. Written only by the member
  (`app/api/me/availability/route.ts`) and by a Kids manager (`app/utils/kidsCommit.ts`).
- Managers of the other two ministries already read them for their own people: the worship planner
  (`app/components/admin/AvailabilityPanel.tsx`, dates AND notes) and the Kids planner
  (`app/(client)/kids/admin/page.tsx` lines 62–63, dates and notes).
- `app/utils/jovenesPeople.ts` — `readJovenesPeople(): JovenesPerson[]` (`{id, name, groups}`), one
  GROQ over Jóvenes' members with app access, `groups` through `groupsIn(accessFromDoc(row))`.
  Callers: `/jovenes` and `/jovenes/calendario` (only when the reader may edit a program:
  an admin, or the encargado/apoyo of a whole-ministry meeting — a plain pastor can be one),
  `/jovenes/reunion/[token]`, and `/jovenes/admin`.
- `/jovenes/admin` (`app/(client)/jovenes/admin/page.tsx`) is reached only by a Jóvenes admin
  (`isMinistryManager`, super-admin included) or a leader of at least one group
  (`ledGroupsIn(access,"jovenes").length > 0`); everyone else is redirected. It builds
  `viewer: PlannerViewer = { me, isManager, led }` from the same `getMemberAccess` snapshot (30 s
  cache) its reads use.
- Who PICKS people there: `SaturdayPlanner` seats (admins only, `canEdit = isManager`, all
  Jóvenes people), `ProgramEditor` on a Saturday card (same), `GroupClasses`' responsable
  (`members = people.filter(p => p.groups.includes(group))`, for a group in
  `plannableGroups(JOVENES_GROUPS, viewer)`: every group for an admin, the led groups for a leader).
  So a non-admin leader only ever picks among the members of a group they lead.
- The picker is `app/components/jovenes/PersonSelect.tsx` (a native `Select`), used by all three.

## 3. The contract (the part this review is for)

**R1 — Dates only.** A note (`unavailabilityNotes`) is never read by this slice: not projected,
not sent, not shown. Only days `>= today` (CDMX) are projected.

**R0 — What this contract is and is not.** It decides what the APP sends and shows. It is not a
confidentiality boundary on the field: `teamMembers` has undotted ids in a dataset the repo records
as public (ADR-0057, ADR-0081 Context), so `unavailableDates` and `unavailabilityNotes` answer an
untokened query today and stay so until the member-PII work (DEF-A-16) closes that. Nothing here
makes that worse, and nothing here should be read as fixing it.

**R2 — Audience, decided on the server, per person.** One pure function in a new neutral module
`app/utils/jovenesAway.ts`, taking the reader's ACCESS snapshot (never a caller-built object) and
deriving management and leadership inside:

```ts
type Access = Pick<MemberAccess, "role" | "ministries" | "managesMinistries" | "ministryRoles">;
/** May this reader see that this person marked days? Admin: every Jóvenes member. Leader: only a
 *  member of a group they lead. Anyone else: nobody. */
export function awayVisibleTo(reader: Access, person: { groups: readonly string[] }): boolean {
  if (isMinistryManager(reader, "jovenes")) return true;
  const led = ledGroupsIn(reader, "jovenes");
  return person.groups.some((g) => led.includes(g));
}
```

`person.groups` is `groupsIn(accessFromDoc(row), "jovenes")` — the same normalized answer the
pickers already use; `ledGroupsIn` is the same answer the event writer counts.
A leader therefore sees exactly the people they can assign to a class of a group they lead, and
nobody else's days, including people they share a group with but do not lead.

**R3 — One read, opt-in, planner page only.** `readJovenesPeople` gains an optional argument:

```ts
export type JovenesPerson = { id: string; name: string; groups: string[]; away?: string[] };
export async function readJovenesPeople(opts?: { awayFor: Access; today: string }): Promise<JovenesPerson[]>
```

- Without `opts` the GROQ is today's string, byte for byte: no availability field is projected, so
  `/jovenes`, `/jovenes/calendario` and `/jovenes/reunion/[token]` cannot receive a date even by
  mistake.
- With `opts` the people query runs UNCHANGED (same string, same filter and order, so the list is
  identical with or without `opts`). The ids of the people `awayVisibleTo(opts.awayFor, person)`
  accepts are computed in TypeScript, and a SECOND query reads the days of those ids only:
  `*[_type == "teamMembers" && _id in $ids]{ _id, "away": unavailableDates[@ >= $today] }`
  (skipped when no id is visible). The server never loads the days of a person the reader may
  not see. The mapper sets `away` only when the result is an array with at least one well-formed
  `YYYY-MM-DD` string `>= today` (an absent field projects `null`; a malformed string can pass the
  GROQ comparison, so the shape is checked again in TypeScript). For everyone else the key is
  ABSENT (not `[]`), so «not visible to you» and «marked nothing» look the same to the client.
- The only caller that passes `opts` is `/jovenes/admin`, with the `access` snapshot its gate
  used and CDMX today.
  Guard: a source scan test (`jovenesAwayCoverage.test.ts`, in the style of
  `ministryEventCoverage.test.ts`) over non-test files: (a) under `app/**` the token `awayFor`
  appears only in `app/utils/jovenesPeople.ts` and `app/(client)/jovenes/admin/page.tsx`;
  (b) the tokens `unavailableDates` and `unavailabilityNotes` appear in NO file under
  `app/(client)/jovenes/**`, `app/components/jovenes/**`, `app/api/ministries/**`, nor in any
  `app/utils/jovenes*.ts` other than `jovenesPeople.ts`, which may name `unavailableDates` only.

Why the group rule stays in TypeScript: membership of a group is defined by
`normalizeMinistryRoles` (a level counts only for a ministry named in `ministries`, `leaderOf ⊆
groups`, ADR-0085), and a GROQ copy would be a second definition. The price of reading only the
visible ids is one more round trip to Europe on the planner page, paid by planners only.

**R4 — It informs, it never refuses.** No writer changes. `ministryEventCommit.ts` does not read
availability; a planner may still assign a person who marked the day (they may have agreed to
come). No email, no notification, nothing stored.

**R5 — One calendar, said plainly, to the person too.** The days are the person's, not the
ministry's: a Jóvenes planner learns that a pastor who also serves in Alabanza is out on a date,
whichever ministry they had in mind when marking it, including days stored before this slice. The
worship and Kids MANAGERS already see their own people's days; a Jóvenes leader is new (§1). So
`/me/disponibilidad` says it to a Jóvenes member (the page already knows `inJovenes`), one line
under the lede: «Quien arma el rol de Jóvenes ve estos días, sin tu nota.» Only the date crosses.

**R6 — Freshness.** The audience is judged on the `getMemberAccess` snapshot (30 s), like every
read of this page (`readMinistryEvents(access, …)`). A leader narrowed a moment ago may see their
former group's days for up to 30 s. Accepted: same window as the meetings themselves.

## 4. Screen

- `PersonSelect` takes an optional `date`. With a date, an option whose person has it in `away`
  reads «Ana · no disponible», and when the SELECTED person has it, a line under the select reads
  «No disponible ese día.» in the availability colour (`text-availability-soft`). The copy never
  says who marked it: a Kids manager can record a day for a volunteer (`kidsCommit.ts`).
  Without `date`, or for people with no `away`, it renders exactly as today.
- `SaturdayPlanner` passes the form's date to its seat pickers; `GroupClasses` passes the class
  form's date to the responsable picker; `ProgramEditor` passes `event.date`. «Nuevo libro»'s
  rotation pickers pass no date (one person maps to many Sundays).
- Cards, only where the reader can act on them: a Saturday card for an admin (`canEdit`) and a
  class row (always a group the reader plans) whose assigned member has the meeting's date in
  `away` show one line «Ana: no disponible ese día» (availability colour), so a day marked AFTER
  the roster was built is seen without opening each editor. A leader's read-only Saturday cards
  show nothing.
- **Stated limit.** `ProgramEditor` on `/jovenes`, `/jovenes/calendario` and
  `/jovenes/reunion/[token]` receives people without `away` (R3) and shows nothing new — for an
  admin as well, and for the encargado or apoyo of a whole-ministry meeting (who can be a plain
  pastor and does assign the parts there). In those editors «no mark» does NOT mean «available»;
  the marks live in Planear. Widening them to the encargado is a separate audience decision.

## 5. Tests

- `jovenesAway.test.ts`: `awayVisibleTo` matrix — admin and super-admin see all; a leader sees a
  member of a led group, not a member of a group they are in but do not lead, not a person with no
  groups; a `leader` with an empty `leaderOf` and a plain member see nobody.
- `jovenesPeople.test.ts`: without `opts` exactly one query runs, with no `unavailable` token, and
  no person has `away`; with `opts` the first query is that same string, the second never contains
  `unavailabilityNotes`, carries `$today` and ONLY the visible ids (none → no second query), a
  non-visible person has NO `away` key, an absent field (`null`) and an empty array yield no key,
  a visible one keeps only well-formed dates `>= today`.
- `jovenesAwayCoverage.test.ts` (R3 guard).
- The planner page test: the page passes the `access` its gate read and CDMX today.
- `disponibilidadPage.test.tsx`: the R5 line for a Jóvenes member the rollout reaches, absent
  for anyone else.
- `personSelect.test.tsx`: option suffix and the line, only with `date`; nothing without.
- Card lines in `saturdayPlanner` / `groupClasses` tests.

## 6. Release

Gates → one code review of the range → merge into `preview`, verify the dev alias → Frank looks on
dev. Production only with Frank's explicit word, as for the rest of PR #249. Rollback: revert the
commit; nothing is stored, no schema changes.

## 7. Rejected

- **A second availability calendar per ministry.** Two writers into two fields with one meaning;
  `useAvailability` is the only client writer on purpose.
- **Showing the note.** It is free text written for the worship admins («cita médica»); the
  planner needs the day, not the reason.
- **Any pastor sees everyone's days** (on the cards of `/jovenes`). Most pastors assign nobody;
  for them the days would be exposure without use. The encargado/apoyo exception is the stated
  limit of §4.
- **Refusing the assignment on the server.** A marked day is a statement, not a lock; the worship
  planner does not refuse either.
- **The group rule in GROQ.** A second copy of the group-membership rule (R3).
- **One query with every member's days, filtered after.** The server would load days the reader
  may not see; reading the visible ids only costs one round trip.
