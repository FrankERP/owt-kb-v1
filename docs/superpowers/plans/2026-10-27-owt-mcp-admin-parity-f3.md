# OWT MCP — admin parity, phase 3: proposals, messages, songs (and Kids) from the chat (plan)

**Status:** APPROVED IN SCOPE by Frank 2026-10-27 19:12Z («Sí, con Kids ahora»: Q1 = Kids NOW, Q2 = yes);
nothing built. The critical slice S1 is detailed and reviewed in
`2026-10-27-owt-mcp-admin-parity-f3a-proposal-review.md`; S3 (song save) gets its own slice plan before 3b.
Frank's summary (Spanish): Claude Doc https://claude.ai/artifact/SYwRUWHqFjXpkGLwppwm92.
**Requirement (Frank, 2026-10-21 15:48Z, verbatim):** «Quiero poder hacer todo lo que hago en la
página como admin, pero desde el chat». Phase 3 of the Claude Doc «Todo el admin desde el chat»:
«Contestar y aprobar propuestas, editar canciones, y la rotación de Kids». Table rows: Propuestas
«Responder en la conversación, aprobar o rechazar»; Canciones «Crear y editar (letra, acordes,
etiquetas, autores)»; Kids «Ver y editar parejas, disponibilidad, generar y guardar meses». Frank,
2026-10-27 18:58Z: «Empieza».
**Builds on:** phase 1 (ADR-0066: the chat writes through `/admin`'s own commit modules, check then
save) and phase 2 (ADR-0072: the chat shows the exact list and waits for Frank's word; the host's
permission prompt is not relied on — observed 2026-10-27).
**Risk tier: mixed, per slice.** Two slices own a critical contract and get the adversarial plan
review (one reviewer at a time, churn cap, a committed review log): **S1** the proposal decision
(a production writer that rewrites a LIVE setlist and queues the team's setlist email) and **S3**
the song save (a full-array serializer: `body`, `chords`, `tags`, `authors` are written whole).
S2 (messages) and S4 (Kids) are standard work: self-reviewed, then the merge-range review.

---

## 1. What Frank gets

1. **Proposals.** «¿Qué propuestas hay?» already works (`list_proposals`). New: «Aprueba la del
   domingo 9» — Claude shows the songs and keys it is about to publish, waits for Frank's word, and
   approves through `/admin`'s own writer: the setlist goes live, the lead gets «Propuesta
   aprobada», and the team gets the same setlist email `/admin` queues. «Pídele cambios: …» sends
   the proposal back with that note (`/admin`'s «Solicitar cambios»), and «Reábrela» reopens an
   approved one. There is no separate «rechazar» in `/admin`; «Solicitar cambios» is it, and the
   chat mirrors `/admin` rather than inventing a status.
2. **Messages** (added since the inventory: ADR-0065, PR #165/#196). Read a service's whole
   conversation; write to its leads; set, edit or clear the «Mensaje del pastor»; edit the
   «Mensaje para el equipo» of a published setlist; edit or delete Frank's own messages. Every
   message is shown to Frank word for word before it is sent.
3. **Songs.** «Crea la canción X de Y en Sol, 72 bpm, con esta letra», «En Way Maker cambia "…"
   por "…"», «Ponle la etiqueta Navidad», «Agrega el acorde en La». Claude first checks the edit
   (read-only: a before/after of only what changes), then saves exactly that edit.
4. **Kids** (only if Frank picks it, Q1): see the pairs, the volunteers' absences and a month;
   generate a month (read-only, as `/kids/admin`), save it as drafts, publish a Sunday; create,
   edit or retire a pair; record a volunteer's absences.

What does not change: `/admin` and `/kids/admin` (their routes keep their rules; they only start
calling the extracted modules), and the in-app assistant (read-only, ADR-0060). Song and member
DELETES stay in phase 4.

## 2. Evidence (today, `origin/main` 3d60bac2)

- **Proposal decisions.** `PATCH /api/admin/proposals/[id]` (602 lines, NOT a commit module):
  `{action: approve|request_changes|reopen|reconcile_target, rev, adminNotes?}`; `rev` must be the
  revision the admin REVIEWED (never a fresh one). Approve: canonical proposal load, target drift
  refusal, source status (`pending|changes_requested`), `contentState === "ready"`, the shared
  proposal group, then ONE transaction (proposal + live setlist + weekend lock heartbeat + approval
  receipt), a worship night carries song leaders over (`carryOverSongLeads`). Post-commit:
  `notifyProposalReview` (push to lead + contributors), `queueSetlistNotice` (the debounced setlist
  email), `revalidateProposalApproval`. A replay with a verified receipt is a no-write success.
  `request_changes`/`reopen` append the note to `messages` inside the same revision-asserting
  transaction and push the lead.
- **Proposal messages.** `POST /api/admin/proposals/[id]/messages` («Propuestas»): open thread only,
  cap `PROPOSAL_MESSAGES_MAX`, append without `ifRevisionId`, push «Nuevo mensaje» to the lead.
  The chat does not use it (D5).
- **Service thread** (`app/api/admin/service-threads/[roleId]/…`): `GET messages` (service thread
  + the proposal's thread + team note target), `POST messages`, `PATCH/DELETE messages/[key]`
  (author only; the POST writes here «even when a proposal exists», and every reader shows both
  threads together), `PUT pastor-message` (`observed` stamp; push+email to leads only when a message
  APPEARS on a published service), `PUT team-notes` (`observed {id, rev}` of the live setlist).
- **Songs.** `POST /api/content/posts`, `PATCH /api/content/posts/[id]`: no `ifRevisionId`
  (last writer wins); `lyrics` text → `textToBody` replaces the whole `body`; `chords` replaces
  the whole chart array (`normalizeChordCharts`); `tagIds`/`authorIds` replace whole arrays;
  `authors` POST and `tags` POST are idempotent by slug. `revalidateSongViews()`. No notifications.
  `get_song` today returns the lyrics STATE, not the text, so the chat cannot quote a passage yet.
- **Kids.** `GET/PUT /api/kids/schedules` (one Sunday per PUT, deterministic id, no revision
  guard), `POST /api/kids/generate` (read-only planner), `GET/POST /api/kids/pairs`,
  `PATCH /api/kids/pairs/[id]`, `GET /api/kids/members`, `PATCH …/members/[id]/availability`
  (`_rev` mandatory). No notifications. 12 pairs, 0 months ever saved (memory, 2026-10-20).
- **Who.** The connector is super-admin only (`app/api/mcp/route.ts` step 6); super-admin spans
  both ministries, so the Kids gate (`requireMinistryManager("kids")`) is satisfied.
- **The pin.** `serviceCommitCallers.test.ts` lists every caller of every `*Commit.ts`; CLAUDE.md
  says MCP writes go ONLY through commit modules. So every write below needs one.

## 3. Decisions, and why

| # | Decision | Rejected alternative | Why |
|---|----------|----------------------|-----|
| D1 | Extract each writer into a commit module (`proposalReviewCommit`, `serviceThreadCommit`, `songSaveCommit`, and `kidsCommit` if Q1) and make the route call it. | MCP tools that call the routes over HTTP, or a second copy of the rules. | ADR-0043: one code path is how refusals, notifications and cache stay identical. An HTTP self-call loses the session and doubles the time budget. |
| D2 | `review_setlist_proposal {proposalId, rev, action, note?}` takes the `rev` that `list_proposals` showed. | The tool reads the current revision itself. | `/admin`'s contract: a decision must name the content that was reviewed. A fresh rev would approve songs Frank never saw. |
| D3 | Before approving or sending anything, Claude shows it and waits for Frank's word (tool description + a model-only line). No check token for approvals. | A check/save token like phase 2. | Phase 2 showed the host prompt is unreliable; Frank accepted «show, then wait». The `rev` already binds the decision to what was shown; a token would add nothing for a single document. |
| D4 | No «rechazar» status; «pedir cambios» and «reabrir» exactly as `/admin`. `reconcile_target` (integrity repair) is not exposed. | A new `rejected` status. | Parity, not a new workflow; a new status touches every reader. |
| D5 | Messages always go to the service thread, through the service card's writer (`POST service-threads/[roleId]/messages`), proposal or not. | Reply in the proposal's own thread, as «Propuestas» does. | The route already writes there «even when a proposal exists: one writer and one notification», and every reader (the card's dialog, the proposal card, the lead's editor) shows both threads together. One writer for the chat is one audience to verify. |
| D6 | Songs: check then save. `check_song_edits` answers a before/after of only the changed parts plus a token over (song id, `_rev`, edit list); `save_song_edits` repeats the same list and token and writes under `ifRevisionId`. | One-shot `edit_song` that writes immediately. | A whole-field rewrite is how lyrics get garbled; the before/after is Frank's chance to see it, and `ifRevisionId` stops overwriting an edit made in `/admin` meanwhile (the route today has no guard). |
| D7 | Lyrics and charts are edited by passage: `{replace: old, with: new}` (old must occur exactly once), or the whole text only when creating or when Frank asks to replace all of it. One chart per key; the server rebuilds the array from the fresh document and keeps every other chart. | The chat sends whole arrays. | A chat that sends one chart would delete the others (the full-array write). This is the S3 contract. |
| D8 | Tags and authors by name; an unknown author is created (idempotent by slug, as `/admin`); an unknown TAG is refused with the list of existing tags. | Create tags freely. | Authors are open-ended; tags are a small curated filter set in the library. |
| D9 | `get_song` gains the lyrics text and chart contents behind `{full: true}`. | A new read tool. | The chat must quote the passage it replaces. |
| D10 | Release in parts: 3a proposals + messages, 3b songs, 3c Kids (if Q1). Each its own PR, preview, prod and live proof. | One release. | Smaller reviews, and what works ships without waiting. |
| D11 | Tool names say «setlist» (`review_setlist_proposal`), never bare «proposal». | Reuse «proposal». | `revise_proposal` already means a solver month proposal; the model must not mix them. |
| D12 | Kids: build now on today's Kids model (Frank, Q1, against the recommendation to wait). | Wait for the multi-ministry generic model. | Frank's call 2026-10-27 19:12Z. The tools call `kidsCommit` only, so a later move to the generic model changes that module and its readers, not the chat contract. |

## 4. Tasks (per release)

**3a — proposals and messages**
1. Extract `proposalReviewCommit.ts` from the PATCH (approve + request_changes + reopen +
   reconcile_target), the route keeps auth and parsing; behaviour byte-identical (existing route
   tests stay green unchanged).
2. Extract `serviceThreadCommit.ts` (messages POST/PATCH/DELETE,
   pastor PUT, team-notes PUT).
3. Tools: `review_setlist_proposal`, `get_service_conversation` (read), `send_service_message`,
   `edit_service_message`, `delete_service_message`, `set_pastor_message`, `set_team_message`.
   Deferred notices as in `/admin` (`after()`), SSE buffered as today.
4. Pins: `serviceCommitCallers.test.ts`, the protected-write audit, the tool list digest.
5. Tests: each tool's refusals (stale rev, closed thread, full thread, not author, wrong status),
   the notification audience equals the route's, the revision named is the one asserted.

**3b — songs**
6. Extract `songSaveCommit.ts` (create + patch); add the `ifRevisionId` path the chat uses (the
   route keeps last-writer-wins until Frank wants otherwise).
7. Pure `applySongEdits(doc, edits)` (passages, per-key charts, tags, authors) with its own tests:
   one passage occurrence, unknown tag, other charts kept, `_key` per item.
8. Tools: `check_song_edits`, `save_song_edits`, `create_song`; `get_song {full}`.

**3c — Kids (Q1: now):** `kidsCommit.ts` + reads and writes listed in §1.4.

## 5. Questions for Frank

- **Q1. Kids: now or with the multi-ministry work?** Frank: NOW (19:12Z).
- **Q2. The plan as a whole**, messages included: Frank: yes (19:12Z).

## 6. Release and proof

Each part: gates → one merge-range review (the critical slice's adversarial review happens on the
plan before coding) → preview, dev alias → PR to main, `gates` → prod alias. Live proof on a
throwaway service and a throwaway song: approve a test proposal, request changes, send/edit/delete
a message, set and clear a pastor message; create a test song, edit a passage, add a chart, check
the other chart survived; then remove the throwaway data from `/admin`.

## 7. Docs in the same delivery

`docs/MCP.md` (tools, count, notifications table), one ADR for phase 3 (number taken at merge),
CLAUDE.md / AGENTS.md / `project-rules.md` (the write-path list), `docs/NOTIFICATIONS.md`.

## 8. Out of scope

Song and member deletes, rules, members (phase 4). `reconcile_target`. Uploading files (audio,
PDFs, photos). Kids in 3 if Q1 says later.
