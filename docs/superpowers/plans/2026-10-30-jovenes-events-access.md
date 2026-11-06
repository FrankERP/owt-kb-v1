# Multi-ministry — phase 3, Jóvenes: who sees and who writes a ministry event (plan)

**Status:** APPROVED 2026-11-05 with Frank's two joint-event answers (critical tier; two fresh
approvals on digest `c4faa023…b98d`), then amended with those reviewers' non-blocking items, which no
reviewer has seen. Every approval (digests `cf407de9…d254`, `c2d703b2…7ad9`, `c4faa023…b98d`) and
every post-approval item is in `2026-10-30-jovenes-events-access-review-log.md`. ADR-0075. Parent: the plan doc's tab «Fase 3: Jóvenes
primero» (https://claude.ai/artifact/F1qn13J9ud8P3Urh6aF6th). Approval of this plan is not
authorization to implement.

**Requirement (Frank, verbatim).**
- 2026-10-27 18:44Z: «No me gustaría que los pastores de Emprendedores vean el calendario de los de
  Otro Nivel y viceversa».
- 2026-10-27 (plan doc answers): the Saturday roster has Encargado (+ apoyo), Fecha, Quién comparte,
  Notas; «¿Orar y dinámicas van en el rol? Sí, y las definen el Encargado y el Apoyo de cada sábado».
- 2026-10-30 00:00Z: «Quiero que dejemos en pausa lo de kids, me interesa más sacar lo de jóvenes».
- 2026-10-30 01:37Z, answering the phase-3 questions: «1.- Sí es de los 3» (the Saturday meeting is
  all three groups); «2.- Es correcto [each group's leader edits that group's calendar, only admins
  the Saturday roster], pero recuerda que quien sea asignado como "encargado" de la reunión del
  sábado puede agregar quién da la oración, quién hace una dinámica, etc»; «3.- Sip, es la misma
  Gaby»; «4.- Lo reuno y te lo paso» (the pastors' list for a bulk account load).
- 2026-11-04 21:51Z, on the card «¿Quién puede crear una junta compartida entre dos o tres grupos?»,
  Frank chose «Un líder de alguno de esos grupos» (over «un líder de todos esos grupos» and «solo los
  admins»).
- 2026-11-04 23:52Z, on the card «¿Quién puede editar o borrar una junta compartida ya creada?», Frank
  chose «Solo quien la creó y los admins» (over «cualquier líder de esos grupos» and «solo los
  admins»).

**Risk tier: critical**, derived from the ladder: the plan creates an ACL boundary (a group may not
read another group's events) and a production writer with a mutation trust boundary (three
different actors may write different parts of the same document). Everything else in phase 3 —
the screens, «Copiar para WhatsApp», the Calendario option, the bulk account script — consumes this
contract and is standard work reviewed in its diff. This plan is only that slice.

---

## 1. Goal and non-goals

**Goal.** One stored type, `ministryEvent`, holds Jóvenes' Saturday meetings, each group's weekday
events and joint events. ONE read module decides what a person may see; ONE commit module decides
what a person may write; both decide on the server, from the person's stored access, never from
the screen. A pastor of Otro Nivel can never receive, by any route the app serves, an event whose
audience is only Emprendedores.

**Non-goals (later, or never in this slice):** email or push notices; the MCP connector and the
admin assistant (neither names the type nor imports its read or commit module — G1 and G1c pin that); the `.ics` feed
(ADR-0057's route keeps serving worship only); Kids moving onto `ministryEvent`; worship (never
migrated); an engine; Studio editing of events.

## 2. Evidence (today, `main` 8a61f9f4 plus PR #216's branch)

- **The dataset is publicly readable.** An untokened
  `GET https://<project>.api.sanity.io/v2024-01-01/data/query/production?query=count(*[_type=="teamMembers"])`
  answered `59` on 2026-10-29 (`37` on 2026-10-31, after the seeded Kids roster was removed). So a filter applied by the app protects nothing for a document whose
  id is undotted: anyone can query it directly. Sanity serves no document whose `_id` contains a dot
  to an untokened read; ADR-0050 §"The id is dotted" and `docs/DATA_MODEL.md` (fairnessMonth,
  adminChatUsage, loginEvent, calendarFeed) rely on that, and record the consequence: an untokened
  read of a dotted id answers «no record» with no error, so every reader must check the token first.
  Checked 2026-10-30 untokened: `count(*[_type=="fairnessMonth"])` = 0 although the November and
  December 2026 records exist (dotted), while `count(*[_type=="loginEvent"])` = 326 (the old undotted
  ones DEF-A-16 C5 still has to delete).
- **Access snapshot.** `app/utils/memberAccess.ts` `getMemberAccess(id)` (30 s TTL cache,
  `serverClient`) → `{active, role, ministries, managesMinistries, ministryRoles}` via the pure
  `accessFromDoc`. `app/utils/ministryAccess.ts`: `isMinistryMember` (super-admin or in
  `ministries`), `isMinistryManager` (super-admin, or for a leveled ministry level `admin`),
  `levelIn` (`null` for a non-member, `"member"` when no entry), `groupsIn` (`[]` for a non-member).
  `app/ministries.ts`: `MINISTRIES.jovenes.groups` = `otro-nivel`, `invencibles`, `emprendedores`;
  `isGroupId(ministry, x)` is array membership; `LEVELED_MINISTRY_IDS = ["jovenes"]`;
  `normalizeMinistryRoles` keeps an entry only for a ministry named in `ministries`.
- **Guards.** `app/utils/authGuards.ts` `requireMinistryMember` / `requireMinistryManager` read the
  cached snapshot.
- **Clients.** `sanity/lib/operationalClient.ts`: `perspective: "published"`, `useCdn: false`, token
  optional. `sanity/lib/serverClient.ts`: `serverClient` (read token), `writeClient` (write token).
- **Studio.** `app/utils/studioProtection.ts` `PROTECTED_STUDIO_TYPES` + `sanity.config.ts`
  (`document.actions`, `newDocumentOptions`) + `readOnly: true` on the schema make a type
  non-creatable and non-editable in `/studio`; `studioProtection.test.ts` asserts it.
- **Precedent writer.** `app/utils/kidsCommit.ts` (`CommitOutcome`, named refusals, `ifRevisionId`,
  `_key` per item, `revalidateKidsViews`). `/api/kids/*` routes authorize then delegate.
- **Coverage-guard precedent.** `app/utils/__tests__/draftGatingCoverage.test.ts` scans `app/**`
  GROQ groups that select a type and fails on any that lacks the filter.

## 3. The stored shape

```
_type: "ministryEvent"
_id: "ministryEvent.<uuid>"            minted by the commit module, never by a client
ministry: "jovenes"                    an id in LEVELED_MINISTRY_IDS
audience: { kind: "ministry" }         the Saturday meeting (all three groups)
        | { kind: "groups", groups: string[] }   one group, or a joint event (2–3 groups)
kind: "saturday" | "ministry" | "group" | "joint"   display and editor routing ONLY; never read for access
date: "YYYY-MM-DD"                     local-noon rendering (CLAUDE.md invariant)
time?: "HH:mm"   arrival?: "HH:mm"     display only, `isServiceTime`
title?: string
seats: [{ _key, role: "encargado" | "apoyo" | "comparte", member: weak ref teamMembers }]
program: [{ _key, label: string, member?: weak ref teamMembers, note?: string }]
notes?: string
published: boolean                     written on every create; read as `published == true`
createdBy: weak ref teamMembers        the actor of the create (W1's fresh id); written once by the
                                       create, never by any later write, never taken from a body
```

- **D1. Private by id.** The dotted id makes the document unreadable without a token at the
  dataset itself, so the app's filter is the only way in. Rejected: an undotted id plus an app
  filter — §2 shows the dataset answers anyone.
- **D2. Audience is explicit and read closed.** A member sees an event only when `audience.kind ==
  "ministry"`, or `audience.kind == "groups"` and one of `audience.groups` is one of their groups. An event whose `audience` is
  absent, malformed (an unknown `kind` included, whatever its `groups`), or names no valid group matches neither arm and is visible to no member
  (admins still see it, to repair it). Rejected: «absent = whole ministry», which is the fail-open
  direction; worship's «absent = visible» exists only because worship predates the field.
- **D3. `kind` never decides access.** The commit module derives the allowed `kind` from the
  audience (a ministry audience ⇔ `saturday`, or `ministry` for another whole-ministry meeting such
  as the quarterly pastors' board; one group ⇔ `group`; two or more ⇔ `joint`) and refuses a mismatch, so
  the two cannot disagree, but no reader or writer authorizes on `kind`.
- **D4. Weak references, stored as weak.** Removing a pastor (`/api/admin/members/[id]` DELETE,
  which answers 409 on a referential-integrity error) must never fail because an old event names
  them; a dangling seat reads as «Sin asignar». Sanity enforces integrity from the STORED reference,
  not the schema, so the commit module writes `{ _type: "reference", _ref, _weak: true }` on every
  seat and program member and on `createdBy` (the Kids precedent writes no `_weak` and must not be
  copied), and G4 asserts it. A dangling `createdBy` (creator deleted) leaves the joint event to the
  admins.

## 4. The read contract — `app/utils/ministryEventReads.ts` (server-only, the ONLY reader)

- **R1. One query builder.** Every read of `ministryEvent` under `app/**` goes through
  `readMinistryEvents(access, { me, ministry, from, to, mode })`, where `me` is the session's
  effective member id (R7; `MemberAccess` carries no id). `mode: "member"` (pages a pastor sees)
  or `"editor"` (Planear Jóvenes). The GROQ always carries
  `_type == "ministryEvent" && _id in path("ministryEvent.*") && ministry == $ministry && date >= $from && date <= $to`.
  The id-prefix arm means a document created outside the commit module with an undotted id (public)
  is never served by the app either.
- **R2. Member arm.** An inactive access (`access.active === false`) returns `[]` with no I/O, so
  the module is safe without its page's guard. `mode: "member"` adds `published == true && (audience.kind == "ministry" ||
  (audience.kind == "groups" && count(audience.groups[@ in $groups]) > 0))` with `$groups = groupsIn(access, ministry)` filtered
  through `isGroupId`. A non-member (`levelIn` null, not super-admin) gets no query at all: the
  function returns `[]` without I/O. A member with no groups sees only `audience.kind == "ministry"`
  events (`$groups = []` makes the second arm false).
- **R3. Editor arm.** `mode: "editor"` requires `isMinistryManager(access, ministry)` (admin level
  or super-admin) → every event of the ministry, published or not; a `leader` in editor mode gets
  exactly the member arm plus unpublished events whose audience is `groups` and AT LEAST ONE group
  in it is one they lead (`levelIn == "leader"` ⇒ `$led = groupsIn`) — every draft that includes
  one of their groups, whether or not W3 lets them write it (a joint draft another leader created is
  shown read-only, since it will reach their group when published): the GROQ is
  `(<member arm>) || (published != true && audience.kind == "groups" && count(audience.groups[@ in $led]) > 0)`.
  So a draft joint event of Otro Nivel and Emprendedores is visible in editor mode to the leaders of
  either group, and to no plain pastor of either until it is published; an unpublished event of
  Emprendedores alone stays invisible to a leader of Otro Nivel.
  Anyone else in editor mode gets `[]`.
- **R8. One definition of «may read».** `ministryEventReads.ts` also exports the pure TypeScript
  `mayRead(access, event, mode)` that W3a and any other server decision call. It is the same
  predicate as the GROQ's access arms (id prefix, ministry, published, audience; the `from`/`to`
  window is a page range, not access, and is not part of it), and G3 holds the two equal on every
  case of its matrix.
- **R4. Token first.** Before any query: no `SANITY_API_READ_TOKEN` ⇒ throw
  `MinistryEventReadUnavailable` (the page renders an error state, never «no events»). Client:
  `operationalClient` (published perspective, no CDN).
- **R5. Fresh enough.** Reads use the cached snapshot (≤ 30 s, like every guard): a pastor moved out
  of a group may see that group's events for up to 30 s. Writes do not accept that window (W1).
- **R6. Never shared across people.** Every page or route that renders the result is dynamic
  (it reads the session); no `unstable_cache` or ISR segment may hold the output, and a page that
  renders it carries no `revalidate` export (inert on a session-reading page, but misleading: PR D
  removes `/schedule`'s `revalidate = 60` when it adds Jóvenes there), and `$groups` is a query
  PARAMETER, so even Next's fetch cache keys on it. G1 enforces the first two (no `unstable_cache`,
  no `revalidate` export in a file that calls `readMinistryEvents`). A post-filter
  in TypeScript over a wider read is forbidden (R1's GROQ is the boundary).
- **R7. «Mine» by id.** A seat or program line is the reader's when `member._ref == $me`, decided in
  the projection; names are never compared.

## 5. The write contract — `app/utils/ministryEventCommit.ts` (the ONLY writer)

Routes `POST /api/ministries/[ministry]/events`, `PATCH` and `DELETE /api/ministries/[ministry]/events/[id]`,
and `PATCH /api/ministries/[ministry]/events/[id]/program` authorize the session (active member) and
delegate; nothing else writes the type: G1 confines who names it, G1c pins who imports the
commit module, and W9 closes the writers that take any id without checking its type.

- **W1. Fresh access.** The commit module reads the actor's access with a NEW uncached read
  (`accessFromDoc` over a `serverClient` fetch, through a new uncached export of
  `app/utils/memberAccess.ts` — e.g. `fetchMemberAccessFresh(id)` — that reuses its private
  `ACCESS_PROJECTION`, so the two reads cannot drift), not `getMemberAccess`, so a demotion or a group
  change takes effect on the next write, not up to 30 s later. Any actor whose fresh read says
  `active === false` (or finds no document) is refused before anything else, whatever their role
  — `isMinistryManager` itself ignores `active`. The actor is the session's EFFECTIVE id, as in every
  guard: a super-admin impersonating a pastor writes with that pastor's rights, which is what
  impersonation is for (it is super-admin-only, `auth.ts`).
- **W2. One stored revision decides and is written.** Like R4, the commit module throws
  `MinistryEventReadUnavailable` before its first stored read when `SANITY_API_READ_TOKEN` is
  missing (an untokened read of a dotted id answers null, which would otherwise surface as a
  misleading 404). PATCH, program PATCH and DELETE read the
  stored event (token, published perspective), authorize against THAT document, and write with
  `ifRevisionId` of the revision read; a 409 answers «Alguien más cambió este evento; recarga.». The
  client's `_rev` is not trusted for authorization, only compared. The stored read carries R1's
  identity filters — `_type == "ministryEvent" && _id in path("ministryEvent.*") && ministry ==
  $ministry && _id == $id` — and a missing, foreign-type or other-ministry id answers 404 «Ese
  evento no existe.», never 403, so a refusal never confirms that a document exists (the
  `kidsCommit.ts` precedent). An admin's «any event of the ministry» is safe only through that filter.
  An event the actor may read in neither mode (`mayRead(freshAccess, stored, "editor")` and
  `mayRead(freshAccess, stored, "member")` both false) answers the same 404, so a leader probing
  another group's event ids learns nothing. **Precedence, once for every write:** the body's shape
  (a missing `_rev` is a 400, which depends on no document), W1's inactive refusal, then this 404,
  then W3/W3a's authorization, then W2a's revision compare (409). So the 403s and the 409 happen only
  on events the actor CAN read and never reveal anything new.
- **W2a. The client's revision is required.** Every PATCH and DELETE body carries `_rev`; missing ⇒
  400 `rev_required`, different from the stored one ⇒ 409 (as `kidsCommit.ts` refuses a missing
  `_rev`). Arrays are written whole, and the encargado and the apoyo may edit the same program, so a
  write never lands on a revision its author did not see.
- **W3. Who may write what.**

  | Actor | Create / edit / delete / publish | Program lines |
  |---|---|---|
  | super-admin, Jóvenes admin | any event of the ministry | any |
  | Jóvenes leader | CREATE: a `groups` event holding AT LEAST ONE group they lead. EDIT / DELETE / PUBLISH a one-group event: they lead that group. EDIT / DELETE / PUBLISH a joint event (2–3 groups stored): they are its `createdBy` AND lead at least one of its stored groups. Every edit: the requested audience also holds a group they lead | the events they may edit |
  | Encargado or apoyo of THIS event (by the stored `seats`) who may READ it now (W3a), on an event whose audience is the ministry | nothing | this event only |
  | anyone else | nothing | nothing |

  The leader rule (Frank, 2026-11-04, two answers): any leader of one of the groups may CREATE a
  joint event; once it exists, only its creator and the admins may edit, publish or delete it. The
  stored audience decides which rule applies: a one-group event belongs to that group, and any
  leader of it may write it (answer 2 of 2026-10-30); a joint event belongs to its creator, read from
  the STORED `createdBy` and compared with W1's fresh actor id, and the creator must still lead one
  of its groups (a creator who stopped leading leaves it to the admins). Every create or edit also
  needs a group the actor leads in the requested audience. So a leader of Otro Nivel may create a
  joint event with Emprendedores and later edit it, publish it, add or remove groups or delete it;
  the Emprendedores leaders see it (R3) but answer 403 on any write; and nobody but an admin can turn
  it into an Emprendedores-only event, because the creator must keep a group they lead. A leader
  who adds a group to their group's one-group event creates a joint event in effect; `createdBy`
  stays whoever created the event (never rewritten), so from then on it is that person's and the
  admins'. A leader cannot create or change a `ministry` audience (the Saturday roster is admins').

- **W3a. A seat never outlives the right to read.** A seat holder's program write is allowed only
  when, by the FRESH access of W1, the actor is active and the stored event passes R2's member
  predicate for them: a member of the ministry, `published == true`, and the audience is the
  ministry or overlaps their CURRENT groups — that is, `mayRead(freshAccess, storedEvent, "member")`
  (R8), never a second copy of the rule. So a person removed from Jóvenes, or a seat on an
  unpublished event, is refused whatever the stored seats say — and since such an event is one the
  actor reads in neither mode, the refusal is W2's 404, by the precedence there. (A pastor moved to
  another group keeps the right: the seat right exists only on ministry-audience events, which every
  member reads.) A readable event on which the actor holds no encargado/apoyo seat, or whose
  audience is `groups`, answers 403 «No puedes editar el programa de este evento.». The seat is a
  reason to WRITE, never a reason to READ.
- **W3b. What a write answers.** Every write answers `{ ok, id, rev }` and nothing of the event's
  content; the screen re-reads through R1. So no write path can serve an event its actor could not
  read.
- **W4. Program PATCH writes only `program`.** The server builds `set({ program })` from validated
  input; `date`, `audience`, `kind`, `seats`, `notes`, `published`, `createdBy` are untouched whatever the body
  says. Each line: `label` 1–60 chars, optional `member` (must be a Jóvenes member), optional `note`
  ≤ 300 chars; at most 20 lines. **Keys:** a line whose `_key` matches a stored line keeps that
  key; any other line (no key, or a key the stored event does not hold) gets a freshly minted one.
  The client never chooses a new key.
- **W5. Validation.** People are validated only where the write ADDS or CHANGES them: a stored seat
  or program line kept as it was passes even if its person has since left the ministry or been
  deleted, so an old event never becomes uneditable. «Kept as it was» means: the item's `_key`
  matches a stored item and its `member._ref` is the stored one (for a seat, its `role` too); anything
  else is an addition or a change and is validated. `ministry` ∈ `LEVELED_MINISTRY_IDS`; audience groups via `isGroupId`, no
  duplicates, 1–3; a `ministry` audience carries no `groups` field (refused otherwise, so D2's
  «malformed» stays a write-time refusal too); a request carrying the same `_key` on two items is refused (400
  `duplicate_key`); `kind` matches the audience (D3); `date` valid; times `isServiceTime`; every
  seat/program member is a member of the ministry (fresh read) and, for a `groups` audience, of at
  least one of its groups; seats ≤ 6; keys as in W4 (seats too); `published` boolean.
- **W6. Ids.** Create never accepts an id from the client; it builds `ministryEvent.<token>` and
  writes with `create` (an id collision is an error, never an overwrite). **Idempotent create:** the
  client sends a create token (a v4 UUID it minted when the form opened), validated as a UUID and
  lowercased before use, so one UUID in two cases cannot mint two ids; a retry or double tap hits the same id. A
  collision answers 409 `already_created` only when the actor may read the existing document (R8,
  either mode); otherwise it answers W2's 404. (A free token answers success, so a collision is
  still distinguishable in principle; the ids are client-minted v4 UUIDs never shown to a
  non-reader, and a probe leaves a document behind, so this is accepted.) On 409 the client does not
  close as success: it re-opens the stored event, so edits made after a lost answer are not dropped
  silently. A token never
  overwrites (create, not createOrReplace), so a client choosing an id can at worst be refused; delete is one transaction of an
  `ifRevisionId` patch then `delete`, the fairness executor's guarded delete
  (`app/utils/fairnessMonthWriteRequest.ts:1145`).
- **W7. Cache.** Every write calls `revalidateMinistryViews(ministry)` (new, in `revalidate.ts`:
  `/jovenes`, `/jovenes/admin`, `/schedule`), though those pages are dynamic — the call keeps a
  later static page from going stale silently.
- **W8. Outcome.** `CommitOutcome` like `kidsCommit.ts`; refusals are named strings; the route sends
  `body`/`status` verbatim; client handlers follow the try/catch/finally + `res.ok` invariant.
- **W9. Close the generic delete.** `DELETE /api/content/posts/[id]` today deletes ANY document id
  for a worship admin, with no type check (`app/api/content/posts/[id]/route.ts:42-43`); that is a
  writer outside W3 for every private type, `ministryEvent` included. PR C makes it refuse anything
  whose stored `_type` is not `post` (read first, then a guarded delete), with a test. The same PR
  pins `app/api/admin/members/[id]/route.ts` to `teamMembers`: its DELETE (`:218`) deletes any id,
  and its PATCH (`:172`) patches any id when the body carries neither `role` nor `ministries` (the
  type-pinned read at `:141-145` runs only then). Both are super-admin-only, so no boundary is
  crossed, but they would write an event outside the commit module, its revision guard and its
  revalidation; after the pin a non-`teamMembers` id answers 404. The two other super-admin routes
  that patch a client-supplied id get the same pin: `app/api/admin/members/[id]/photo/route.ts:69-77`
  (`profilePhoto`) and `app/api/admin/set-password/route.ts:25-28` (`passwordHash` from
  `sanityMemberId`).

## 6. Guards (tests that keep the contract true)

- **G1. Read coverage** (`ministryEventCoverage.test.ts`): it scans `app/**` and `sanity/**`. A
  file NAMES the type when, outside its import specifiers, it contains the token `\bministryEvent\b`
  in any quote style or template string, or any exported identifier of the two modules that carries
  the type (e.g. a `MINISTRY_EVENT_TYPE` constant) — so a read through an imported constant is caught
  too. Only these may name it: `ministryEventReads.ts`, `ministryEventCommit.ts`, the schema
  (`sanity/schemas/`) and the schema index that imports it (`sanity/schema.ts`), the Studio protection list, `protectedReadAudit.ts`, `revalidate.ts`, tests.
  Importing `readMinistryEvents` is allowed anywhere, but such a file may contain neither
  `unstable_cache`, `"use cache"`, `cacheLife` nor an `export const revalidate` (R6). The check
  reaches only files that import the reader directly; a wrapper module that a page caches is out of
  its reach, which is accepted (no such cache exists under `app/**` today, and a page that reads the
  session is dynamic anyway). The rollout registry keys its entry by a feature name
  (`"jovenesEvents"`), never the type name, so it stays outside this list. MCP (`app/mcp/**`) and the admin chat are
  therefore covered by construction.
- **G1c. Callers** (`ministryEventCallers.test.ts`, the `serviceCommitCallers.test.ts` pattern):
  only the three route files of §5 (four handlers) import `ministryEventCommit.ts`, and nothing
  under `app/mcp/**` or the admin chat (`app/api/admin/chat/**`, `adminChat*`) imports either
  module.
- **G1b. Protected-read audit.** `ministryEvent` joins `PROTECTED_TYPES` in
  `app/utils/protectedReadAudit.ts` (as the dotted single-writer `fairnessMonth` did), its write
  sites are registered there, and its fields that no other type uses join the generic-read signal
  (`PROTECTED_FIELDS` excludes shared names, `protectedReadAudit.ts:38-43`): `audience` and `program`
  if a grep at implementation still finds them on no other type; never `seats`, which is Kids
  vocabulary. So a `*[_id == $id]{ audience, program }` read elsewhere is flagged too. The audit judges the
  client, not the person: authorization stays G1 + R1.
- **G2. Query shape** (unit): the member query contains the id-prefix arm, `published == true` and
  the audience arm; `$groups` is a parameter, never interpolated; a non-member returns `[]` with no
  fetch; no token throws.
- **G3. Isolation matrix, on the real engine.** The test captures the query and params
  `readMinistryEvents` builds (member arm, admin editor arm, leader editor arm) and runs them with
  `groq-js` `evaluate(parse(query), { dataset, params })` — the repo's precedent,
  `app/api/__tests__/adminMemberVisibility.test.ts` — over one fixture matrix: people (pastor of
  Otro Nivel, of Emprendedores, of two groups, with no groups, leader of one group, leader of two,
  a leader of Otro Nivel against a draft joint Otro Nivel + Emprendedores event and a draft
  Emprendedores-only event,
  admin, super-admin, inactive, worship-only) × events (ministry, each single group, each joint
  pair, unpublished, no audience, `groups` absent or empty, `groups` as a string (`"otro-nivel"`,
  so a substring match in `mayRead` fails), unknown group, unknown `audience.kind`
  with valid `groups`, a `ministry` audience carrying `groups`, an id not starting with
  `ministryEvent`, `drafts.` id, other ministry). It asserts the expected visibility table, and that `mayRead` (R8) answers the
  same for every pair. No hand-written evaluator. **groq-js diverges from Content Lake on `path()`:**
  groq-js 1.30.2 joins segments with an unescaped `.` (`node_modules/groq-js/dist/_chunks-es/shared.mjs:4-9`),
  so it calls `"ministryEvent-f" in path("ministryEvent.*")` true where Content Lake answers false.
  The matrix therefore tests the prefix arm only with ids groq-js and Content Lake agree on (no
  `ministryEvent` followed by a non-dot); `mayRead` implements the real rule (a literal
  `ministryEvent.` prefix, one segment after it) and a separate unit test pins it on
  `ministryEvent-f`; G6 probes the real engine.
- **G4. Write matrix** (unit, Sanity mocked): each row of W3's table; for a leader of Otro Nivel:
  create a joint event with Emprendedores (allowed, `createdBy` = the actor's fresh id whatever the
  body says), then edit, publish, add Invencibles to and delete their own joint event (allowed),
  remove Otro Nivel from it leaving Emprendedores alone (403); a leader of Emprendedores on that
  event: edit, publish, delete (403, readable); a joint event an admin created, written by any
  leader (403); the creator after being demoted or moved out of every stored group (403 while they
  still read it, 404 otherwise); a dangling `createdBy` (only admins write); a body or PATCH carrying
  `createdBy` never changes the stored one; a second leader of Otro Nivel editing a one-group Otro
  Nivel event someone else created (allowed) and adding Emprendedores to it (allowed; `createdBy`
  unchanged, after which that leader answers 403); create an Emprendedores-only event (refused),
  any write to an Emprendedores-only event (404, as a missing id), a create whose
  token collides with an event the actor cannot read (404, not 409); the program PATCH ignoring every non-`program` field, a stale revision → 409, a
  demoted actor (fresh read says `member`) refused even when the cached snapshot says `leader` (403
  on an event they still read, 404 on a draft); for seat holders: removed from Jóvenes → 404, seated
  on an unpublished Saturday → 404, moved to another group → still allowed on a Saturday, a seat on a
  group event they read → 403, a readable event without a seat → 403; every write's answer carries no event content
  (W3b); a duplicate create token → 409 `already_created` and one document; missing `_rev` → 400;
  an unreadable event with a stale `_rev` → 404, not 409; a duplicated `_key` → 400;
  every stored member reference has `_weak: true`; an event keeping a seat — and a program line —
  of a departed person still accepts an edit, and the kept items keep their stored `_key`; an actor
  whose fresh read says inactive is refused in every row; a foreign-type, other-ministry or missing
  id answers 404 on each route.
- **G5. Studio.** `ministryEvent` joins `PROTECTED_STUDIO_TYPES` and `PROTECTED_STUDIO_TITLES`
  (read-only inspection, no create, no actions), with the internal-types/fields decision that file
  asks of every protected type; `studioProtection.test.ts` covers it.
- **G6. Live proof on dev before production** (`preview` writes the real dataset, so with Frank's
  consent): one event per audience created through the route as `published: false` with the rollout
  state at `superAdmin`, so no pastor can see them (at `hidden` the write routes answer 404, so
  nothing could be created — corrected 2026-11-06 when G6 ran), then an untokened dataset query for
  `*[_type == "ministryEvent"]` answers `[]`, and a tokened one answers them; a tokened
  `"ministryEvent-f" in path("ministryEvent.*")` answers false (the groq-js divergence of G3); the
  test events are deleted through the route afterwards. «Hidden» must hold on the SERVER: the
  rollout state gates `/jovenes` and Planear Jóvenes in their server components and the four write
  routes, not only the nav, since R3 shows group drafts to that group's leaders.

## 7. Delivery

1. PR A — docs: this plan, its review log, ADR (ministry events: private by id, audience read
   closed, three writers), and an amendment to ADR-0075 Decision 4 («Kids moves onto the generic
   model first»), which this plan reverses: Jóvenes goes first, Kids stays paused. Standard. The
   branch is rebased on `main` first (the plan's line numbers are at 8a61f9f4; on 57bdf591 the
   members route moved +10 lines).
2. PR B — read side: schema + Studio protection, `ministryEventReads.ts`, G1–G3, G5, `/jovenes`
   (pastors' list of upcoming events; each event's sheet carries the program editor for its
   encargado/apoyo, reading in member mode, since a plain member's editor-mode read is `[]`; that
   editor stays hidden until PR C ships its route), a new rollout registry with this type's state
   (`hidden → superAdmin → admins → all`; none exists today), the Jóvenes nav section, and
   `docs/DATA_MODEL.md`'s entry for the type and its dotted id. After PR A's rebase, re-check W7's
   path list (`main` changed `revalidateKidsViews`) and G1b's field-name grep (`main` added
   `availabilityConflict`).
   **Critical** — this plan's R-section.
3. PR C — write side: `ministryEventCommit.ts`, the four routes, G4, Planear Jóvenes (Saturday
   roster table, program lines for the encargado/apoyo, «Copiar para WhatsApp»). **Critical** — this
   plan's W-section. G6 before its production merge. Its routes are wrapped in
   `withVerificationRunContext` (`srVerificationRunContext.test.ts` scans every route that imports a
   `*Commit` module). Frank answered the gate question on 2026-11-04 (creator and admins); this
   plan carries that answer, so PR C has no open gate.
4. PR D — group calendars, joint events, «Jóvenes» in the Calendario filter (reads through R1).
   `/schedule` is worship-gated today (`requireWorshipPage`), so PR D also decides how a
   Jóvenes-only pastor reaches the Calendario; that is a page gate, outside this contract.
5. PR E — the bulk account script (dry run, `--apply`, Frank's consent), when Frank sends the list.

Each PR: release order of CLAUDE.md (dev alias verified, `gates`, one fresh code review per merge
range).

## 8. Known limits (accepted, said aloud)

- **Who is in which group is public.** `teamMembers` is an undotted public type, so a pastor's
  `ministryRoles` (level and groups) is readable from the dataset. That reveals membership, not the
  calendar this plan protects. Moving member PII behind a token is the DEF-A-16 stream, not this one.
- **Reads trail a group change by up to 30 s** (R5); writes do not (W1).
- **A leader writes into a joint event's other groups.** By Frank's choices (2026-11-04), a leader
  of one group can create a joint event that also shows in another group's calendar, and then edit
  or delete it alone with the admins; the other groups' leaders see it but cannot change it. That
  is a write into another group's calendar, accepted on purpose; it is never a READ of another
  group's events (R3 shows a leader only events that include a group they lead), and the creator
  must keep one of their own groups in it, so it can never pose as another group's own event.
- **A joint event outlives its creator's role.** If the creator stops leading every group in it,
  or is deleted, only the admins can change it; the editor shows «Creada por …» (or «Creada por
  alguien que ya no está») so the other leaders know whom to ask. «Quien la creó» is read as whoever
  created the event: a leader who turns their group's one-group event into a joint one does not
  become its owner, so if someone else created that event, the widening leader loses the right to
  change it. Both narrowings were told to Frank in plain words (2026-11-05).
- **Sanity project accounts read everything.** `/studio` lets worship `admin` through `proxy.ts`,
  and any Sanity project account reads every event in Studio and its Vision tool, `readOnly` or not.
  Who holds one is checked in sanity.io/manage before the rollout reaches `all` (believed: Frank
  only); a token in a non-Frank hand would cross the boundary by design.
- **The encargado's program right is narrower than «any event»:** only on whole-ministry meetings
  (the Saturday roster and the like), as Frank said «de cada sábado»; group events have no such
  right until he asks. A Saturday kept as a draft is invisible to its encargado (member mode never
  serves an unpublished event), so they add lines only once an admin publishes it; the admins'
  roster editor says so beside the «Publicar» control.
- **A joint event can keep a seat from a group it no longer includes.** When an edit narrows a
  joint event, a kept seat or program line (W5) whose person is in none of the remaining groups
  stays stored; no read leaks (that person no longer sees the event), and the editor marks the seat
  «Ya no está en los grupos de esta junta» so a leader can clear it.
