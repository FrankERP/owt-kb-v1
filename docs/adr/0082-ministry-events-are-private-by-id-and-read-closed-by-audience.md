# ADR-0082: Ministry events are private by id, read closed by audience, and written by one module

**Date:** 2026-11-05 · **Status:** Accepted

Implements [ADR-0075](0075-ministries-share-one-app-and-a-youth-group-is-a-security-boundary.md)
Decision 2 for Jóvenes. Plan (critical, adversarially reviewed and approved three times as Frank's
answers arrived): `docs/superpowers/plans/2026-10-30-jovenes-events-access.md`, with its review log.

## Context

Jóvenes needs its Saturday roster, each group's own calendar and joint meetings in the app, and Frank
asked that the groups not see each other's: «No me gustaría que los pastores de Emprendedores vean el
calendario de los de Otro Nivel y viceversa». Two facts decide how:

- **The Sanity dataset answers anyone.** An untokened query counted 37 `teamMembers` (2026-10-31), so
  a filter in the app protects nothing for a document anyone can query directly. Sanity serves no
  document whose `_id` contains a dot to an untokened read (the `fairnessMonth` precedent, ADR-0050).
- **Three different actors write one document.** An admin writes the Saturday roster, a group's
  leader writes the group's events, and the Saturday's «encargado» adds program lines («quién da la
  oración, quién hace una dinámica»; Frank, 2026-10-30).

## Decision

- **One type, `ministryEvent`, with a dotted id** (`ministryEvent.<uuid>`), so it is unreadable
  without a token. `ministry: "jovenes"`, an explicit `audience` (`{kind: "ministry"}` for the
  Saturday and other whole-ministry meetings, or `{kind: "groups", groups}`), `seats`, `program`,
  `published`, and `createdBy` written once at create time.
- **One reader, `app/utils/ministryEventReads.ts`.** Every query carries the id prefix, the ministry
  and, for a member, `published == true` and the audience overlap with the reader's groups as a query
  parameter. An absent or malformed audience matches no member (closed, not «whole ministry»). The
  reader throws without the read token. `mayRead` is the same rule in TypeScript, held equal to the
  GROQ by a `groq-js` matrix.
- **One writer, `app/utils/ministryEventCommit.ts`**, on a FRESH (uncached) read of the actor's
  access, against the stored revision under `ifRevisionId`:
  - a Jóvenes admin or the super-admin writes any event;
  - a leader writes a one-group event of a group they lead, and creates a joint event that includes
    one of their groups (Frank, 2026-11-04: «Un líder de alguno de esos grupos»);
  - a joint event is edited, published or deleted only by its `createdBy` (while they still lead one
    of its groups) and the admins (Frank, 2026-11-04: «Solo quien la creó y los admins»);
  - the encargado or apoyo of a whole-ministry meeting writes only its `program`, and only while
    they may still read it.
  An event the actor cannot read answers 404, never 403; writes answer no content.
- **The writers that ignore types are closed** (`DELETE /api/content/posts/[id]`, and the
  super-admin member routes pinned to `teamMembers`), so nothing else can write the type.

## Rejected

- **An undotted id plus a filter in the app.** The dataset answers anyone; the filter would hide the
  calendar only from people who use the app.
- **«Absent audience = whole ministry».** The fail-open direction; worship's «absent = visible»
  exists only because worship predates the field.
- **Authorizing the encargado from the stored seats alone.** A pastor moved out of Jóvenes would keep
  writing an event they can no longer read; the seat is a reason to write, never to read.
- **Testing isolation with a hand-written evaluator.** It would test a twin of the query, not the
  query. Note that `groq-js` itself diverges from Content Lake on `path()` (it does not escape the
  `.`), so the prefix arm is tested on ids both engines agree on and probed live on dev.
- **Any leader of the included groups edits a joint event.** Frank chose the creator and the admins.

## Consequences

- Group membership stays public (`teamMembers` is undotted) until DEF-A-16 moves member data behind a
  token; the calendar itself does not.
- Reads trail a group change by up to 30 s (the cached access snapshot); writes do not.
- Anyone with a Sanity project account reads every event in Studio and Vision; who holds one is
  checked before the rollout reaches everyone.
- A joint event whose creator stops leading its groups, or is deleted, belongs to the admins.
- Do not «simplify» the reader into a wider read plus a TypeScript filter, drop the id prefix arm, or
  copy the Kids writer (it stores no `_weak` references and authorizes no audience).
