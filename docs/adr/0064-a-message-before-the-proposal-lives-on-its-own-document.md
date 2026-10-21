# ADR-0064: A message before the proposal lives on its own document

**Date:** 2026-10-21 · **Status:** Accepted

## Context

The private lead ↔ admin conversation lives in `setlistProposal.messages[]`, so it
exists only once a lead has saved a proposal. Frank: «Como admin no puedo iniciar un
chat o poner el mensaje que compartió el pastor sobre un set del que aún no han
generado propuesta». The pastor's message (the sermon theme, a song he asked for) is
what the leads need BEFORE they choose songs — exactly when there is no proposal to
write into.

## Decision

A second, small document holds the conversation until the proposal exists:
`serviceThread.<roleId>` (`app/utils/serviceThread.ts`, `sanity/schemas/serviceThread.ts`).

- **Keyed by the role id**, like the proposal (`setlistProposal.<roleId>`), so a service
  whose date moves keeps its thread. Dotted, so an untokened read never serves it.
- **One writer:** `POST /api/admin/service-threads/[roleId]/messages` — admin and
  super-admin, `isThreadOpen` enforced, `createIfNotExists` + `setIfMissing` + `append`
  in one transaction with no revision assertion (two admins posting at once both land).
  Messages are the same `proposal_message` items `buildProposalMessage` mints.
- **Readers concatenate, nothing copies.** The admin card (`GET /api/admin/proposals`,
  `earlier_messages`) and the lead's editor (`/me/propose/[roleId]`) render this thread
  in front of the proposal's own; `ProposalThread` orders the whole list by `at`. Before
  the proposal exists the lead reads it with no composer and answers through «Notas
  privadas para revisión», which becomes the first message of the proposal's thread.
- **Where the admin writes:** Propuestas → «Mensaje antes de la propuesta», a lazy
  picker of upcoming services with no proposal (`servicesWithoutProposalQuery`, drafts
  included — an admin may write before the month is published).
- **Notification:** a push to the service's Leads (never the author), and none while
  the service is unpublished — its leads cannot open the page yet. No email, the same
  as an admin message on a proposal (ADR-0025: free Gmail, no fan-out).
- `service_ref` is a **weak** reference.

## Rejected

- **Create the proposal early, empty, to hold the message.** Smallest diff, and wrong:
  `roleDependencies` blocks deleting or moving a role that has ANY proposal (every
  status), so a chat message would block «Limpiar mes» and a date move; readiness
  would read the empty draft as «Revisar propuesta»; and the lead's first save would
  meet an existing document it did not create (no `lead`, a 409 on an open editor).
- **Copy the messages into the proposal when the lead creates it.** It would put a
  second document's revision into the lead's guarded create transaction (A2 §6) — or
  lose a message posted between the read and the commit. Concatenating at read time
  has neither problem and costs one sub-query per read.
- **Store it on the role document.** Every role writer asserts the role's `_rev`; a
  chat append would 409 the planner and the setlist editor under whoever is editing.
- **A strong `service_ref`.** Sanity refuses to delete a document with incoming strong
  references, so a message would make its service undeletable.

## Consequences

- Deleting a role leaves its `serviceThread` behind, unreferenced and unread. Harmless;
  nothing lists them except the Studio's read-only pane.
- Leads cannot post before the proposal exists — they answer when they save. A lead
  composer on this document would need its own writer and the admin push; add it only
  if that turns out to be wanted.
- The message `kind` is `admin_change_request`, the only admin kind the enum offers,
  as on the proposal's own admin messages; `pastor_note` stays reserved.
