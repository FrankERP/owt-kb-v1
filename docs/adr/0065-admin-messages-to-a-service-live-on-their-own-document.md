# ADR-0065: Admin messages to a service live on their own document

**Date:** 2026-10-21 · **Status:** Accepted · **Amended:** 2026-10-24 (editing, and the pastor's message as one field)

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
- **The pastor's message** (superseded 2026-10-24, see the amendment below): «Es el mensaje del pastor» in the composer sent
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

## Amendment 2026-10-24: edit after publishing; the pastor's message is one field

Frank: «poder editar los mensajes una vez que ya están publicados. Por ejemplo, un
miembro del equipo puso en "Mensaje para el equipo" el que en realidad es el mensaje del
pastor y me gustaría cambiarlo pero no puedo hacerlo desde la página, tendría que hacerlo
desde Sanity Studio». Then, on «¿Quién ve el mensaje del pastor de cada servicio?»: «Todo
el equipo en la DayCard» (the email still goes to the leads only).

`ServiceMessagesDialog` now has three parts, each with its own writer:

> Since 2026-10-27 the writers below live in `app/utils/serviceThreadCommit.ts`; the routes call it,
> and so do the MCP conversation tools ([ADR-0073](0073-a-services-messages-are-written-from-the-chat-through-the-service-thread-writer.md)).

- **Mensaje del pastor — ONE per service, a field, not a chat message.**
  `serviceThread.<roleId>.pastor_message` `{ body, author, at, edited_at }`, written by
  `PUT /api/admin/service-threads/[roleId]/pastor-message` (set, edit, or clear with an
  empty body). The client sends the stamp it saw (`edited_at ?? at`, or null); a
  different stored stamp is a 409, and the write asserts the thread `_rev` the route
  read (`create` when no thread exists, so a concurrent first message is told, not
  overwritten). The client observes the STAMP, not the `_rev`, so a chat message
  appended meanwhile does not make the admin redo an edit that conflicts with nothing.
  **Notifies the leads only when it appears on an EMPTY field of a published service** —
  an edit or a clear sends nothing, so fixing a typo never mails anyone again. Exactly
  that, no more: «Quitar» then «Agregar» mails again (a new message), and one set while
  the service is unpublished mails nobody, then or at publish (the same rule as the chat;
  the leads read it on the DayCard and in their editor). The DayCard shows it
  to the whole team (Inicio, Mi perfil, Calendario: `pastorMessageBodyOf`), above
  «Mensaje para el equipo», and the lead's proposal editor pins it at the top.
  The chat composer lost «Es el mensaje del pastor»; `pastor_note` messages already
  posted keep their label.
- **Mensaje para el equipo — editable after publishing.** `PUT …/team-notes` writes ONLY
  the live setlist's `team_notes`: it resolves the target exactly as the setlist PUT does
  (`loadWeekendSetlistTarget` / `loadSpecialSetlistTarget`, fail closed on duplicates and
  raw drafts), compares the target the dialog loaded (`GET …/messages` → `teamNotes`),
  writes under that `_rev` and heartbeats the weekend lock in the same transaction. It
  returns the new revision (the transaction id) so the dialog can save again; an
  unchanged text writes nothing and returns the observed target as it was. No setlist
  ⇒ 409 `no_setlist`. A later proposal approval still overwrites the note with the
  proposal's own — the dialog says so.
  **«Mover a mensaje del pastor»** is two client calls, pastor's message FIRST, then an
  empty team note: if the second fails, the text is in both places and the admin is told
  to clear it by hand — nothing is lost. Offered only while there is no pastor's message
  (moving onto one would overwrite it).
- **Conversación con los líderes — an admin edits or deletes only their OWN messages on
  the service thread.** `PATCH|DELETE …/messages/[key]` checks the stored `author._ref`
  against the caller (403 `not_author`), then writes the one path
  `messages[_key=="<key>"]` with no `ifRevisionId` (the author of a stored message never
  changes, and asserting the thread `_rev` would refuse an edit whenever anyone
  appended). An edit stamps `edited_at` («editado»); neither notifies. Only while the
  conversation is open (`isThreadOpen`, as the POST): a past service's messages are its
  record.
- **The dialog reads afresh on every opening**, and each draft (and the move) carries
  the stamp or target it was STARTED on, never the one on screen at save time — so a
  newer save another admin made always answers 409, never a silent overwrite. Closing a
  DayCard's dialog after a save refreshes the page, so the card shows the new text.

### Rejected (amendment)

- **Keep the pastor's message as a marked chat message and make chat messages
  editable.** Several «pastor» messages per service, scattered in a conversation, with
  no single one to put on the DayCard — and every correction would read as a new
  message.
- **Store the pastor's message on the role.** Same reason as the thread itself: every
  role writer asserts the role `_rev`.
- **Edit the team note through the setlist PUT.** It replaces the whole song list and
  notifies the team («Ya están las canciones»); a note fix must do neither.
- **Re-notify on every pastor's-message edit.** A typo fix would mail the leads again;
  the DayCard always shows the current text.
- **One transaction for the move.** The pastor's message lives on `serviceThread`, the
  note on the setlist or the role: a multi-document transaction over a guarded setlist
  writer is a critical contract (CLAUDE.md §Review policy) for a two-step move whose
  worst failure is a duplicate the admin can see and clear.
- **Editing lead messages, or the proposal's own messages, from the dialog.** The
  proposal thread belongs to the lead ↔ admin conversation and its writers; an admin
  rewriting what a lead said is not something Frank asked for.
