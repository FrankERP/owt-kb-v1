# Leads can hand in the pastor's message with their proposal — design

**Date:** 2026-11-12 · **Status:** approved (critical-tier review, see the log) and implemented · **Thread:** «Corregir el mensaje del pastor del 15 de noviembre»
**Governs:** ADR-0065 (service messages) — amended by a new ADR-0088 (below).

## Requirement (Frank, verbatim)

> Cuando crean las propuestas, a los líderes les aparece la opción para agregar el mensaje del pastor?
> Yo como admin cómo lo puedo hacer?
> Ahorita subieron el del 15 de noviembre, pero pusieron el mensaje de gómez como mensaje para el equipo

Chosen option (decision card, 2026-11-12 03:05Z): **«Campo para líderes en la propuesta»** — "La propuesta gana
su propio campo «Mensaje del pastor». Al aprobarla pasa al mensaje del pastor del servicio, solo si está vacío."

**Already answered and done outside this plan** (2026-11-12, with Frank's go-ahead): leads had no such field;
an admin sets it in /admin → Servicios → ⋮ «Mensajes a los líderes» (or «Mensajes» on a DayCard) → «Mensaje del
pastor», or from the chat (`set_pastor_message`). The 15 November service was fixed with the EXISTING tools:
Gómez's text set as the pastor's message (`set_pastor_message`), the proposal approved
(`review_setlist_proposal`), the duplicated team note cleared (`set_team_message`). Nothing below is needed for
that service; its text was in `team_notes`, which this plan does not reinterpret.

## Why

The pastor's message reaches the LEADS (WhatsApp, via the youth pastor), not the admins. The proposal editor
(`app/(client)/me/propose/[roleId]/ProposalEditor.tsx`) offers leads two text fields, «Mensaje para el equipo»
and «Notas privadas para revisión»; the service's «Mensaje del pastor» (`serviceThread.<roleId>.pastor_message`,
ADR-0065 amendment 2026-10-24) is only shown to them read-only. With no place for it, leads paste it into
«Mensaje para el equipo» — 2026-10-24 and again 2026-11-15 (Lucía, Marianne). Each time an admin must move it by
hand («Mover a mensaje del pastor», which only works after approval).

## Design

### 1. Data — `setlistProposal.pastor_message` (string, optional)

- New `text` field on `sanity/schemas/setlistProposal.ts`, title «Mensaje del pastor», description «Lo que el
  pastor compartió para este servicio. Al aprobar la propuesta pasa al mensaje del pastor del servicio si está
  vacío.» Absent = none. Plain string, like `team_notes` (not the `{body, at, author}` object of the service field:
  the proposal holds a draft, the service field holds the published one).

### 2. The lead's writer — `POST /api/me/proposals`

- `parseProposalSaveRequest` (`app/utils/proposalWriteRequest.ts`) accepts an optional `pastorMessage: string`,
  same rules as `teamNotes`: non-string → `invalid_request` `["pastorMessage"]`; length > `PROPOSAL_NOTES_MAX`
  (4000, also the service field's cap in `serviceMessageEdit.ts`) → `["notes_length"]`; absent → `""`.
- The route (`app/api/me/proposals/route.ts`) writes `pastor_message: request.pastorMessage` beside
  `team_notes` in BOTH branches (the `ifRevisionId` patch and the `create`). Nothing else in the transaction
  changes; the same `observed`/`_rev` guard covers it, and the existing refusal of a write onto an approved
  proposal applies.
- **The editor's read must carry it** — otherwise the unconditional set blanks it on every save:
  `getSharedProposal` (`app/(client)/me/propose/[roleId]/page.tsx`, a hand-written GROQ query, NOT
  `PROPOSAL_PROJECTION`) adds `pastor_message`, and the editor's hand-written `Proposal` prop type gains
  `pastor_message?: string`. Guard: a test that renders `ProposalEditor` from a stored proposal carrying
  `pastor_message` and asserts the POST body of a save sends it back unchanged, plus a test that pins
  `pastor_message` in `getSharedProposal`'s query text (the same pattern the repo uses for other hand-written
  projections).
- An old client (a tab opened before the deploy; the page is server-rendered) does not send the field and writes
  `""` — the same accepted risk `team_notes` already has.

### 3. The approval — copy into the service, post-commit, only into an empty field

**Where:** `commitApproval` in `app/utils/proposalReviewCommit.ts`, AFTER `tx.commit()` succeeds, beside
`notifyProposalReview` / `queueSetlistNotice`. The approval transaction itself is **unchanged** (proposal +
setlist + lock + receipt); the fingerprint (`canonicalizeApprovalInput`) is **unchanged**.

**Which text:** the proposal the approval just committed — `plan.doc.pastor_message`, read by the planner's
existing `loadCanonicalProposal` through the shared `PROPOSAL_PROJECTION` (`app/utils/serviceReadQueries.ts`),
which gains the field. The approval asserts that proposal's `_rev`, so the text copied is exactly the text of
the revision the admin reviewed. Never re-read live.

**What:** a new writer in `app/utils/serviceThreadCommit.ts`:

```ts
adoptProposalPastorMessage(roleId: string, raw: string, actorId: string | null)
  : Promise<"copied" | "same" | "kept_existing" | "none" | "failed">
```

- The body is normalised exactly as `setPastorMessage` stores it (`fieldText`, `serviceMessageEdit.ts`: trimmed,
  ≤ `PROPOSAL_NOTES_MAX`). Empty → `"none"`, no read, no write.
- Reads `serviceThread.<roleId>` `{ _id, _rev, pastor_message }` (operational client, as `setPastorMessage`).
- Stored body equal to the new body → `"same"`, no write.
- Stored body non-empty and different → `"kept_existing"`, no write. **Never overwrites** — that is the «solo si
  está vacío» of the chosen option. The writer cannot tell an admin's message from this proposal's own earlier
  copy (reopen → the lead corrects it → re-approve), so it treats both alike; §4 and §5 make that case VISIBLE
  on both sides instead of silent, and give the admin a one-tap replace.
- Otherwise writes `{ _type: "pastor_message", body, at: now, author: actorId? }` under
  `patch(threadId).ifRevisionId(_rev)`, or `create` when there is no thread (same shape `setPastorMessage`
  creates: `role_id` plain string, `messages: []`). Never `createIfNotExists`, never a write without a revision
  assertion — so a concurrent admin save is never overwritten.
- On a revision/creation conflict: ONE re-read and re-decide (usually a chat append moved `_rev` but not the
  field). A second conflict, or any other error → `"failed"`, logged, never thrown: the approval already
  committed and must not become a 500.
- **No notification.** The leads wrote it; the team is told by the approval's own setlist notice and sees it on
  the DayCard. (`setPastorMessage`'s «appears on a published service → mail the leads» rule does NOT apply to
  this path, deliberately; see §4 for the one path that does mail.)
- `author` = the approving admin (`reviewerId`), the person who put it on the service — the field's meaning in
  `setPastorMessage` too.
- `revalidateServiceViews()` after `"copied"`.

**Reported:** `ProposalReviewEffects` gains `pastorMessage: <outcome> | null` (`null` on every non-approve path
and on a replay), AND the approve response `body` carries `pastorMessage` (the /admin route returns only `body`,
`app/api/admin/proposals/[id]/route.ts`). `ProposalsPanel.handleAction` reads it: `"kept_existing"` → toast
«Aprobada. El servicio ya tenía otro mensaje del pastor; no se cambió (revísalo en Mensajes)»; `"failed"` →
«Aprobada, pero no se pudo pasar el mensaje del pastor. Pásalo desde Mensajes.»; anything else → the existing
toast. The MCP `review_setlist_proposal` answer reports all five in Spanish. The check
(`check_setlist_proposal_review`) states, from its peek, what approval WOULD do («pasa al servicio» / «ya está» /
«el servicio ya tiene otro; no se cambia»); its `line` is NOT changed (the post-commit outcome is not part of
the reviewed decision, and the line contract stays the approval's).

**Replay** (`plan.kind === "replay"`): does NOT copy. The first request committed; its copy ran or failed then,
and §4 covers a failure. Copying on replay could resurrect a message an admin cleared after the first approval.

### 4. The admin's view and one-tap adopt

- `serviceConversationQuery` (`app/utils/serviceReadQueries.ts`) adds `pastor_message` to its `proposal`
  projection; `GET /api/admin/proposals` projects it too.
- `ServiceMessagesDialog`, «Mensaje del pastor» section: when the proposal's status is NOT `draft` and its
  (trimmed) text is non-empty and DIFFERENT from the service's, it shows the text under «Los líderes mandaron
  este mensaje del pastor con su propuesta» with **«Usar como mensaje del pastor»**. It calls the EXISTING
  `PUT …/pastor-message` with `observed` = the stamp of the service message the dialog loaded (null when
  empty) — so it is refused if another admin changed it meanwhile. When the service already has one the button
  asks first («¿Reemplazar el mensaje del pastor actual?»). Covers: a pending proposal (publish before
  approving), a `"failed"` copy, and the reopen/correction case of §3.
- Notification of that button = `setPastorMessage`'s existing rule: mails the leads only when it APPEARS on an
  empty field of a published service; a replace sends nothing. So an adopt onto an empty published service mails
  the leads their own text — accepted and documented in `docs/NOTIFICATIONS.md` (it is an admin's publish, the
  same as pasting it by hand today).
- `ProposalsPanel` (/admin → Propuestas card) shows «Mensaje del pastor» above «Mensaje para el equipo» when the
  proposal has one.
- MCP: `list_proposals` (`proposalPresenter.ts`) carries `pastorMessage`; `get_service_messages` returns
  `proposal.pastorMessage`. Description changes move `TOOL_LIST_VERSIONS` (ADR-0069), as any description change.

### 5. The lead's editor

- New textarea **«Mensaje del pastor (opcional)»** ABOVE «Mensaje para el equipo», placeholder «Si el pastor
  compartió un mensaje para este servicio, pégalo aquí.» 16 px on a phone (`inputFontSize.test.ts`).
- **Service has NO pastor's message:** field shown, help «Lo verá todo el equipo en la tarjeta del servicio cuando
  se apruebe la propuesta.»
- **Service HAS one** (pinned at the top, as today): the field is shown only if the proposal already holds text
  (never hidden from its author), and its help says the truth: «El servicio ya tiene mensaje del pastor (arriba);
  este no lo reemplaza. Si cambió, avísale a un admin.» If the proposal holds no text, no field.
- «Mensaje para el equipo» help gains: «Para el mensaje del pastor usa el campo de arriba.» (only when the field
  is shown).
- Approved: read-only, only if non-empty. `proposalSnapshot` (dirty check) includes it; the POST body sends it.

## Rejected

- **The lead writes the service's `pastor_message` directly.** Leads would publish to a field the whole team
  sees, before any review, through a second writer with its own notification rule. Frank chose «al aprobarla».
- **Copy inside the approval transaction.** A three-document transaction over the guarded setlist writer, and an
  unrelated chat append (moving the thread `_rev`) would 409 the whole approval.
- **Replace the service's message when it came from this same proposal** (recorded provenance). Would fix the
  reopen/correction case automatically but goes beyond «solo si está vacío»; the visible warning plus the
  one-tap «Usar» covers it. Revisit if Frank asks.
- **No copy; readers fall back to the approved proposal's field.** Every reader (DayCard ×3 pages, lead reminder
  email, MCP, dialog) would need the fallback, and clearing would need a tombstone.
- **A checkbox at approval.** Offered; Frank chose the lead field.

## Tests (vitest)

- `proposalWriteRequest`: `pastorMessage` accepted / absent / non-string / over cap.
- `/api/me/proposals` route: written in patch and create.
- Editor round-trip: stored `pastor_message` → save → POST body carries it; `getSharedProposal` query pins the
  field. Visibility: no service message → field + «Lo verá…»; service message + proposal text → field + «no lo
  reemplaza»; service message + no text → no field.
- `adoptProposalPastorMessage`: empty; same; kept_existing; create when no thread; patch under `_rev`; trimmed;
  one conflict → re-read → copied; two conflicts → failed; other error → failed (not thrown); never notifies.
- `proposalReviewCommit`: approve calls it with the committed doc's text and reports it in effects AND body;
  transitions and replay never call it; `"failed"` still 200.
- `ProposalsPanel`: toasts for kept_existing / failed.
- Dialog: «Usar» shown only for non-draft, non-empty, different text; observed = loaded stamp; confirm when
  replacing.
- `serviceCommitCallers.test.ts`: `app/utils/proposalReviewCommit.ts` added to `serviceThreadCommit`'s pinned
  importers; `protectedReadAudit.ts` descriptions for both modules updated.

## Docs

ADR-0088 «A lead hands in the pastor's message with the proposal» (links ADR-0065; ADR-0065 gets a pointer);
`docs/NOTIFICATIONS.md` (the copy sends nothing; «Usar» follows the PUT's rule); `docs/DATA_MODEL.md` (new field);
`docs/MCP.md` where it lists these tools' answers. CLAUDE.md's write-paths line unchanged (no new route; the copy
is a post-commit step of the existing proposals PATCH; «Usar» uses the existing PUT).

## Release

implement → gates → one code review → preview (dev) → Frank looks → PR to main → prod alias. No data migration:
existing proposals have no field (absent = none).

## Post-approval changes (UN-REVIEWED — after the approved digest `11a21641…285c8`)

Adopted from the approving reviewers' non-blocking notes; none changes the approval transaction or the copy's
"empty field only, under a revision assertion, never thrown" contract:

1. **Absent = unchanged** on the lead POST: `pastor_message` is set only when the request carries the
   `pastorMessage` key (`""` still clears). An old client cannot blank it.
2. `fieldText` is exported from `serviceMessageEdit.ts` and used by the copy (one normalisation). The `"same"`
   comparison also folds `\r\n` → `\n`. `serviceThreadId(roleId)` null → `"failed"`.
3. Failed-copy log line: a fixed tag plus the error, never the body.
4. `"copied"` gets its own toast and MCP line («…y el mensaje del pastor quedó en el servicio»).
5. MCP: `list_proposals` does NOT carry the field (its presenter's A7 contract reports `messages[]` only); the
   text is reported by `get_service_messages` (`proposal.pastorMessage`) and by `check_setlist_proposal_review`,
   which shows it in full and what approval would do, through a PEEK-ONLY thread read in the planner (like
   `peekLiveTeamNotes`; a failed read reports «no se pudo leer» and never refuses the check). `CONFIRM_RULE`
   lists the pastor's message among what to show before a yes. The `line` is unchanged.
6. Approved editor: the read-only proposal field is hidden when it equals the service's message (no double).
7. Docs: CLAUDE.md and `docs/agents/project-rules.md` list `proposalReviewCommit.ts` among
   `serviceThreadCommit.ts`'s callers; `setPastorMessage`'s docstring and ADR-0065 get a pointer to ADR-0088.
   ADR-0088 names the accepted edges: a crash between commit and copy is surfaced only by the dialog's «Usar»;
   re-approval after reopen refills a field an admin cleared; «Usar» keeps offering a differing lead text after
   an admin's deliberate edit; the editor hides the field when the service already has a message and the
   proposal has none (a narrowing of Frank's option, told to him).
