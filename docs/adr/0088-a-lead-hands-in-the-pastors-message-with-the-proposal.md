# ADR-0088: A lead hands in the pastor's message with the proposal; approval copies it into an empty field

**Date:** 2026-11-12 · **Status:** Accepted · Amends [ADR-0065](0065-admin-messages-to-a-service-live-on-their-own-document.md)

## Context

The pastor's message reaches the LEADS (WhatsApp, from the youth pastor), not the admins. ADR-0065 gave a
service ONE «Mensaje del pastor» (`serviceThread.<roleId>.pastor_message`), written only by admins; the
proposal editor showed it to leads read-only and offered them two fields, «Mensaje para el equipo» and «Notas
privadas para revisión». With no place for it, leads pasted the pastor's message into «Mensaje para el equipo»
— on 2026-10-24 and again for 2026-11-15. Frank: «Cuando crean las propuestas, a los líderes les aparece la
opción para agregar el mensaje del pastor? … pusieron el mensaje de gómez como mensaje para el equipo». Offered
four options, he chose «Campo para líderes en la propuesta … Al aprobarla pasa al mensaje del pastor del
servicio, solo si está vacío».

Plan and its critical-tier review: `docs/superpowers/specs/2026-11-12-lead-pastor-message-design.md` (+ `-review-log.md`).

## Decision

- **`setlistProposal.pastor_message`** (text, optional) — the lead's draft. Written by `POST /api/me/proposals`
  beside `team_notes`, under the same observed-revision guard; **absent from the request = unchanged** (`""`
  clears), so a client that predates the field never blanks it. The editor's own read (`getSharedProposal`)
  carries it, because the editor re-sends it on every save.
- **Approval copies it, after the commit, only into an EMPTY service field:**
  `adoptProposalPastorMessage` (`app/utils/serviceThreadCommit.ts`), called by `commitApproval`
  (`app/utils/proposalReviewCommit.ts`) after `tx.commit()`. It reads the thread, writes under its `_rev` (or
  `create`s it), re-reads once on a conflict, never overwrites a non-empty message (`same` /
  `kept_existing`), never notifies, never throws (`failed`). The text is `plan.doc`'s — the revision the admin
  reviewed and the approval asserted. The outcome rides the approve response `body` (/admin toasts
  `copied`/`kept_existing`/`failed`) and the MCP answer; the MCP check says beforehand what it would do,
  through a peek-only thread read that never refuses.
- **The admin adopts by hand** from «Mensajes» (`ServiceMessagesDialog`): a submitted (non-draft) proposal's
  text that differs from the service's is offered under «Los líderes mandaron este mensaje del pastor con su
  propuesta» with «Usar como mensaje del pastor», through the EXISTING `PUT …/pastor-message` (observed = the
  message on screen; replacing one asks first). Its notification is that writer's rule: it mails the leads only
  when the message APPEARS on an empty field of a published service.
- **The lead's editor** shows «Mensaje del pastor (opcional)» above «Mensaje para el equipo» while the service
  has none («Lo verá todo el equipo … cuando se apruebe»); when the service already has one, only if the
  proposal already holds text, and then it says «este no lo reemplaza».

## Rejected

- **The lead writes the service's field directly.** Leads would publish to a field the whole team sees on the
  DayCard before any review, through a second writer with its own notification rule. Frank chose «al aprobarla».
- **Copy inside the approval transaction.** A third document in the approval's transaction, and a chat append
  (it moves the thread `_rev`) would 409 the whole approval. Post-commit, the worst case is a message the admin
  sees and adopts with one tap.
- **Replace a message that came from this same proposal** (recorded provenance). It would fix reopen → correct →
  re-approve automatically, but it is more than «solo si está vacío»; the visible `kept_existing` plus «Usar»
  covers it.
- **No copy; readers fall back to the approved proposal.** Every reader (DayCards, the lead reminder email, the
  MCP, the dialog) would need the fallback, and clearing would need a tombstone.
- **A checkbox at approval** («el mensaje para el equipo es el del pastor»). Offered; Frank chose the lead field.
- **Copy on a replayed approval.** A replay means the first request committed; copying then could resurrect a
  message an admin cleared after it.

## Consequences

- Accepted edges: a crash between the commit and the copy, then a retried approval (a replay), copies nothing
  and toasts «Sin cambios» — only the dialog's «Usar» surfaces it. Re-approving after a reopen refills a field
  an admin cleared, when the proposal still carries text. «Usar» keeps offering a differing lead text after an
  admin deliberately edited the service's. The editor hides the field when the service has a message and the
  proposal none (a narrowing of Frank's option, told to him).
- The copy sends nothing; «Usar» onto an empty published service mails the leads their own text (an admin's
  publish, the same as pasting it by hand).
- `serviceThreadCommit.ts` gains a caller, `proposalReviewCommit.ts` (`serviceCommitCallers.test.ts`).
- Undoing it: drop the copy call and the field's UI; stored `pastor_message` values on proposals are inert.
