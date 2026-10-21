# ADR-0064: Admin messages to a service live on their own document

**Date:** 2026-10-21 · **Status:** Accepted

## Context

The private lead ↔ admin conversation lives in `setlistProposal.messages[]`, so it
exists only once a lead has saved a proposal. Frank: «Como admin no puedo iniciar un
chat o poner el mensaje que compartió el pastor sobre un set del que aún no han
generado propuesta». The pastor's message (the sermon theme, a song he asked for) is
what the leads need BEFORE they choose songs — exactly when there is no proposal to
write into. Then: «preferiría que fuera algo que puedo seleccionar desde la tarjeta del
servicio … También debo de poder cargar el mensaje que mandó el Pastor».

## Decision

A second, small document holds what admins write about a service:
`serviceThread.<roleId>` (`app/utils/serviceThread.ts`, `sanity/schemas/serviceThread.ts`).

- **Keyed by the role id**, like the proposal (`setlistProposal.<roleId>`), so a service
  whose date moves keeps its thread. Dotted, so an untokened read never serves it.
- **Where the admin writes: the service card.** «Mensajes a los líderes» in the «Más
  acciones» menu of a Servicios card in /admin (`ServiceReadinessCard`), and «Mensajes»
  on a DayCard for a worship admin. Both open `ServiceMessagesDialog`, which reads the
  whole conversation when it opens (`GET …/messages`, `serviceConversationQuery`): the
  service's leads, this thread and, once it exists, the proposal's own thread.
  Upcoming services only (`isThreadOpen`), drafts included — an admin may write before
  the month is published.
- **One writer, with or without a proposal:**
  `POST /api/admin/service-threads/[roleId]/messages` — admin and super-admin,
  `isThreadOpen` enforced, `createIfNotExists` + `setIfMissing` + `append` in one
  transaction with no revision assertion (two admins posting at once both land).
  Messages are the same `proposal_message` items `buildProposalMessage` mints. The
  dialog always writes here, even after the leads created a proposal: one place for the
  card's messages, one notification rule, and the proposal's readers show it anyway.
  (The proposal card in Propuestas keeps its own composer, which writes to the proposal.)
- **The pastor's message:** «Es el mensaje del pastor» in the composer sends
  `{ pastor: true }`; the message's `kind` is `pastor_note` (reserved in the enum for
  this), its `author` stays the admin who pasted it. The thread labels it «Mensaje del
  pastor · vía Frank»; the push and the email say «Mensaje del pastor». Pasted as text,
  not uploaded: the message arrives as WhatsApp text, and text is what the leads read
  in the editor and the email.
- **Readers concatenate, nothing copies.** The proposal card (`GET /api/admin/proposals`,
  `earlier_messages`) and the lead's editor (`/me/propose/[roleId]`) render this thread
  with the proposal's own; `ProposalThread` orders the whole list by `at`. Before the
  proposal exists the lead reads it with no composer and answers through «Notas
  privadas para revisión», which becomes the first message of the proposal's thread.
- **Notification:** a push AND an email to the service's Leads (never the author),
  `serviceThreadNotify.ts`; nothing while the service is unpublished — its leads cannot
  open the page yet. This differs from an admin message on a proposal (push only) by
  Frank's decision (2026-10-21): few members have push on, so push alone reached almost
  nobody, and this is the message the leads need before choosing songs. The email goes
  to the Lead seat only (one or two people), so it stays far inside the Gmail account's
  daily limit (ADR-0025); `emailProposals`, the allowlist and `EMAIL_REDIRECT_TO` apply.
- The role is recorded as a plain string, `role_id` — **never a reference**, not even a
  weak one (see Rejected).

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
- **A reference to the role, strong or weak.** Sanity refuses to delete a document with
  incoming strong references; and GROQ's `references()` matches WEAK ones too, which
  `roleDependencies` (`documentsReferencingRoleQuery`) reports as a dependency — so
  either kind would block «Limpiar mes», a role delete and a date move. Found in the
  code review: the first version used a weak reference.
- **A list of services without a proposal in Propuestas.** The first version; Frank
  preferred starting from the service card he is already looking at, and the list only
  covered services with no proposal.
- **The dialog posting to the proposal once one exists.** Two writers behind one button,
  with two notification rules (the proposal's admin message pushes only), chosen by a
  race with the lead's first save. The service thread is read on the proposal anyway.

## Consequences

- Deleting a role leaves its `serviceThread` behind, unread. Harmless; nothing lists
  them except the Studio's read-only pane.
- No ministry check on the routes, like the proposal routes beside them
  (FrankERP/owt-kb-v1#8).
- Leads cannot post on this document — before a proposal they answer when they save,
  after it in the proposal's thread. A lead composer here would need its own writer and
  the admin push; add it only if that turns out to be wanted.
- An admin message from the card emails the leads; the same text written in the
  proposal card's composer only pushes. Deliberate (the card is where a new topic
  starts), and named in `docs/NOTIFICATIONS.md`.
