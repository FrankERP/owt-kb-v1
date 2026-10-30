# Multi-ministry — phase 3, Jóvenes: who sees and who writes a ministry event (plan)

**Status:** DRAFT, under adversarial plan review. ADR-0075. Parent: the plan doc's tab «Fase 3: Jóvenes
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
admin assistant (neither reads nor writes `ministryEvent` — §6 pins that); the `.ics` feed
(ADR-0057's route keeps serving worship only); Kids moving onto `ministryEvent`; worship (never
migrated); an engine; Studio editing of events.

## 2. Evidence (today, `main` 8a61f9f4 plus PR #216's branch)

- **The dataset is publicly readable.** An untokened
  `GET https://<project>.api.sanity.io/v2024-01-01/data/query/production?query=count(*[_type=="teamMembers"])`
  answered `59` on 2026-10-29. So a filter applied by the app protects nothing for a document whose
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
kind: "saturday" | "group" | "joint"   display and editor routing ONLY; never read for access
date: "YYYY-MM-DD"                     local-noon rendering (CLAUDE.md invariant)
time?: "HH:mm"   arrival?: "HH:mm"     display only, `isServiceTime`
title?: string
seats: [{ _key, role: "encargado" | "apoyo" | "comparte", member: weak ref teamMembers }]
program: [{ _key, label: string, member?: weak ref teamMembers, note?: string }]
notes?: string
published: boolean                     written on every create; read as `published == true`
```

- **D1. Private by id.** The dotted id makes the document unreadable without a token at the
  dataset itself, so the app's filter is the only way in. Rejected: an undotted id plus an app
  filter — §2 shows the dataset answers anyone.
- **D2. Audience is explicit and read closed.** A member sees an event only when `audience.kind ==
  "ministry"` or one of `audience.groups` is one of their groups. An event whose `audience` is
  absent, malformed, or names no valid group matches neither arm and is visible to no member
  (admins still see it, to repair it). Rejected: «absent = whole ministry», which is the fail-open
  direction; worship's «absent = visible» exists only because worship predates the field.
- **D3. `kind` never decides access.** The commit module derives the allowed `kind` from the
  audience (ministry ⇔ saturday; one group ⇔ group; two or more ⇔ joint) and refuses a mismatch, so
  the two cannot disagree, but no reader or writer authorizes on `kind`.
- **D4. Weak references.** Removing a pastor (`/api/admin/members/[id]` DELETE, Studio) must never
  fail because an old event names them; a dangling seat reads as «Sin asignar».

## 4. The read contract — `app/utils/ministryEventReads.ts` (server-only, the ONLY reader)

- **R1. One query builder.** Every read of `ministryEvent` under `app/**` goes through
  `readMinistryEvents(access, { ministry, from, to, mode })`. `mode: "member"` (pages a pastor sees)
  or `"editor"` (Planear Jóvenes). The GROQ always carries
  `_type == "ministryEvent" && _id in path("ministryEvent.*") && ministry == $ministry && date >= $from && date <= $to`.
  The id-prefix arm means a document created outside the commit module with an undotted id (public)
  is never served by the app either.
- **R2. Member arm.** `mode: "member"` adds `published == true && (audience.kind == "ministry" ||
  count(audience.groups[@ in $groups]) > 0)` with `$groups = groupsIn(access, ministry)` filtered
  through `isGroupId`. A non-member (`levelIn` null, not super-admin) gets no query at all: the
  function returns `[]` without I/O. A member with no groups sees only `audience.kind == "ministry"`
  events (`$groups = []` makes the second arm false).
- **R3. Editor arm.** `mode: "editor"` requires `isMinistryManager(access, ministry)` (admin level
  or super-admin) → every event of the ministry, published or not; a `leader` in editor mode gets
  exactly the member arm plus unpublished events whose audience is `groups` and every group in it is
  one they lead (`levelIn == "leader"` ⇒ their `groupsIn`). Anyone else in editor mode gets `[]`.
- **R4. Token first.** Before any query: no `SANITY_API_READ_TOKEN` ⇒ throw
  `MinistryEventReadUnavailable` (the page renders an error state, never «no events»). Client:
  `operationalClient` (published perspective, no CDN).
- **R5. Fresh enough.** Reads use the cached snapshot (≤ 30 s, like every guard): a pastor moved out
  of a group may see that group's events for up to 30 s. Writes do not accept that window (W1).
- **R6. Never shared across people.** Every page or route that renders the result is dynamic
  (it reads the session); no `unstable_cache` or ISR segment may hold the output, and a page that
  renders it carries no `revalidate` export (inert on a session-reading page, but misleading: PR D
  removes `/schedule`'s `revalidate = 60` when it adds Jóvenes there), and `$groups` is a query PARAMETER, so even Next's fetch cache keys on it. A post-filter
  in TypeScript over a wider read is forbidden (R1's GROQ is the boundary).
- **R7. «Mine» by id.** A seat or program line is the reader's when `member._ref == $me`, decided in
  the projection; names are never compared.

## 5. The write contract — `app/utils/ministryEventCommit.ts` (the ONLY writer)

Routes `POST /api/ministries/[ministry]/events`, `PATCH` and `DELETE /api/ministries/[ministry]/events/[id]`,
and `PATCH /api/ministries/[ministry]/events/[id]/program` authorize the session (active member) and
delegate; nothing else writes the type (§6 guard).

- **W1. Fresh access.** The commit module reads the actor's access with a NEW uncached read
  (`accessFromDoc` over a `serverClient` fetch), not `getMemberAccess`, so a demotion or a group
  change takes effect on the next write, not up to 30 s later.
- **W2. One stored revision decides and is written.** PATCH, program PATCH and DELETE read the
  stored event (token, published perspective), authorize against THAT document, and write with
  `ifRevisionId` of the revision read; a 409 answers «Alguien más cambió este evento; recarga.». The
  client's `_rev` is not trusted for authorization, only compared.
- **W3. Who may write what.**

  | Actor | Create / edit / delete / publish | Program lines |
  |---|---|---|
  | super-admin, Jóvenes admin | any event of the ministry | any |
  | Jóvenes leader | an event whose audience is `groups` and EVERY group, stored and new, is one they lead | those events |
  | Encargado or apoyo of THIS event (by the stored `seats`) who may READ it now (W3a) | nothing | this event only |
  | anyone else | nothing | nothing |

- **W3a. A seat never outlives the right to read.** A seat holder's program write is allowed only
  when, by the FRESH access of W1, the actor is active and the stored event passes R2's member
  predicate for them: a member of the ministry, `published == true`, and the audience is the
  ministry or overlaps their CURRENT groups. So a pastor moved to another group, a person removed
  from Jóvenes, or a seat on an unpublished event is refused (403 «Ya no tienes acceso a este
  evento.»), whatever the stored seats say. The seat is a reason to WRITE, never a reason to READ.
- **W3b. What a write answers.** Every write answers `{ ok, id, rev }` and nothing of the event's
  content; the screen re-reads through R1. So no write path can serve an event its actor could not
  read.
  An edit is judged against both the stored and the requested audience, so a leader can neither
  move an event out of a group they do not lead nor into one. A leader cannot create or change a
  `ministry` audience (the Saturday roster is admins').
- **W4. Program PATCH writes only `program`.** The server builds `set({ program })` from validated
  input; `date`, `audience`, `kind`, `seats`, `notes`, `published` are untouched whatever the body
  says. Each line: `label` 1–60 chars, optional `member` (must be a Jóvenes member), optional `note`
  ≤ 300 chars, a minted `_key`; at most 20 lines.
- **W5. Validation.** `ministry` ∈ `LEVELED_MINISTRY_IDS`; audience groups via `isGroupId`, no
  duplicates, 1–3; `kind` matches the audience (D3); `date` valid; times `isServiceTime`; every
  seat/program member is a member of the ministry (fresh read) and, for a `groups` audience, of at
  least one of its groups; seats ≤ 6; `_key` minted per item; `published` boolean.
- **W6. Ids.** Create mints `ministryEvent.<uuid>` (never accepts an id) and writes with
  `create` (an id collision is an error, never an overwrite). **Idempotent create:** the client
  sends a create token (a v4 UUID it minted when the form opened) and the id is
  `ministryEvent.<token>`, validated as a UUID; a retry or double tap hits the same id, and a
  collision answers 409 `already_created`, which the client treats as success. A token never
  overwrites (create, not createOrReplace), so a client choosing an id can at worst be refused; delete is one transaction of an
  `ifRevisionId` patch then `delete`, the fairness executor's guarded delete
  (`app/utils/fairnessMonthWriteRequest.ts:1145`).
- **W7. Cache.** Every write calls `revalidateMinistryViews(ministry)` (new, in `revalidate.ts`:
  `/jovenes`, `/jovenes/admin`, `/schedule`), though those pages are dynamic — the call keeps a
  later static page from going stale silently.
- **W9. Close the generic delete.** `DELETE /api/content/posts/[id]` today deletes ANY document id
  for a worship admin, with no type check (`app/api/content/posts/[id]/route.ts:41-43`); that is a
  writer outside W3 for every private type, `ministryEvent` included. PR C makes it refuse anything
  whose stored `_type` is not `post` (read first, then a guarded delete), with a test.
- **W8. Outcome.** `CommitOutcome` like `kidsCommit.ts`; refusals are named strings; the route sends
  `body`/`status` verbatim; client handlers follow the try/catch/finally + `res.ok` invariant.

## 6. Guards (tests that keep the contract true)

- **G1. Read coverage** (`ministryEventCoverage.test.ts`): every file under `app/**` that names
  `"ministryEvent"` is one of: `ministryEventReads.ts`, `ministryEventCommit.ts`, the schema, the
  Studio protection list, tests. Any other file fails the build. MCP (`app/mcp/**`) and the admin
  chat are therefore covered by construction.
- **G1b. Protected-read audit.** `ministryEvent` joins `PROTECTED_TYPES` in
  `app/utils/protectedReadAudit.ts` (as the dotted single-writer `fairnessMonth` did), so generic
  `_id` reads are caught too, not only the type literal G1 scans for.
- **G2. Query shape** (unit): the member query contains the id-prefix arm, `published == true` and
  the audience arm; `$groups` is a parameter, never interpolated; a non-member returns `[]` with no
  fetch; no token throws.
- **G3. Isolation matrix** (unit, fetch mocked by a tiny in-memory GROQ-free evaluator of the same
  predicate, plus the real GROQ string asserted): for an Otro Nivel pastor, an Emprendedores-only
  event, an unpublished event, an audience-less event and an undotted-id event are never returned;
  the ministry event and an Otro Nivel + Emprendedores joint event are.
- **G4. Write matrix** (unit, Sanity mocked): each row of W3's table, both directions of a leader's
  audience move, the program PATCH ignoring every non-`program` field, a stale revision → 409, a
  demoted actor (fresh read says `member`) refused even when the cached snapshot says `leader`; W3a's
  three refusals (seat holder moved to another group, removed from Jóvenes, seated on an unpublished
  event); every write's answer carries no event content (W3b); a duplicate create token → 409
  `already_created` and one document.
- **G5. Studio.** `ministryEvent` joins `PROTECTED_STUDIO_TYPES` (read-only inspection, no create,
  no actions); `studioProtection.test.ts` covers it.
- **G6. Live proof on dev before production** (`preview` writes the real dataset, so with Frank's
  consent): one event per audience created through the route, then an untokened dataset query for
  `*[_type == "ministryEvent"]` answers `[]`, and a tokened one answers them; the test events are
  deleted through the route afterwards.

## 7. Delivery

1. PR A — docs: this plan, its review log, ADR (ministry events: private by id, audience read
   closed, three writers). Standard.
2. PR B — read side: schema + Studio protection, `ministryEventReads.ts`, G1–G3, G5, `/jovenes`
   (pastors' list of upcoming events; each event's sheet carries the program editor for its
   encargado/apoyo, reading in member mode, since a plain member's editor-mode read is `[]`), behind
   a rollout state PR B ADDS to the registry (`hidden → superAdmin → admins → all`; it does not exist
   today), the Jóvenes nav section, and `docs/DATA_MODEL.md`'s entry for the type and its dotted id.
   **Critical** — this plan's R-section.
3. PR C — write side: `ministryEventCommit.ts`, the four routes, G4, Planear Jóvenes (Saturday
   roster table, program lines for the encargado/apoyo, «Copiar para WhatsApp»). **Critical** — this
   plan's W-section. G6 before its production merge.
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
- **Leaders and joint events.** A leader of one group cannot create or edit a joint event that
  includes a group they do not lead (W3); an admin does. Frank's answer 2 covered a group's own
  calendar and the Saturday roster, not joint events, so this is put to him as a decision; until he
  answers, the narrower rule stands (it can only be widened later, never leak).
- **A Sanity project member** (Frank) can read every event in `/studio`'s inspection pane; that is
  the super-admin's own access.
