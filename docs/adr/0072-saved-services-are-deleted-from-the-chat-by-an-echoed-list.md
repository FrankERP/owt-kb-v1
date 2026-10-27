# ADR-0072: Saved services are deleted from the chat by an echoed, checked list, through /admin's own writer

**Date:** 2026-10-24 · **Status:** Accepted

> **Numbering.** 0072 because this record reached `main` first; PR #177's solver-ops record, which
> held 0072 on `preview`, becomes 0073 there (ADR numbers follow the order records reach `main`).

## Context

Phase 2 of Frank's «Quiero poder hacer todo lo que hago en la página como admin, pero desde el chat»
(2026-10-21): delete a service or clear a month. The Claude Doc promised «primero el chat te muestra
exactamente qué se va a borrar. El borrado solo pasa si la llamada repite esa lista tal cual […]. Así
la lista aparece en el permiso que te pide Claude.» Four facts shaped it:

- A delete cannot be undone from the app. The project is on Sanity's Free plan, whose document
  history keeps 3 days (sanity.io/docs/history-experience), so Studio can restore a document for 3
  days and no longer.
- The only human gate on a destructive tool is the Claude app's permission prompt, which shows the
  call's arguments. An HMAC is unreadable; a sentence per service is not. «Siempre permitir» removes
  the prompt for every later call.
- `/admin`'s DELETE route already owns every guard: dependencies refuse (never cascade), the weekend
  lock is vacated or bootstrapped, the creation receipt retired, `beforeSeats` captured pre-commit
  for «Ya no participas». Its logic lived in the route handler.
- A Vercel function has 60 s; Next holds `after()` until the response closes (phase 1, ADR-0066).

Plan: `docs/superpowers/plans/2026-10-24-owt-mcp-admin-parity-f2-deletes.md` (adversarial review
rounds 5 and 6; Frank chose «También desde la tarjeta» and «Solo de hoy en adelante»).

## Decision

- **One writer.** The DELETE route's body after authorization moved verbatim into
  `app/utils/roleDeleteCommit.ts` (`deleteRole`); the route (the default, `notices: "deferred"`) and the MCP
  (`notices: "inline"`, `queueRoleNoticesNow` awaited) call it. Nine admin write paths
  (`serviceCommitCallers.test.ts`); a route-vs-commit parity test pins identical transactions.
- **Preview, then the echoed list.** `check_service_deletes` (read-only) answers one line per
  deletable service (`deleteLines.ts` `deleteLine`: «domingo 8 nov · publicado: se avisa a hasta 9
  personas», «… · especial», «… · borrador»), the services it keeps and why, and a token: HMAC of
  `MCP_OAUTH_SECRET` under `mcp-delete-list|` over the month and the canonical JSON of the whole list
  (`changeSetTokens.ts` `deleteListToken`). `delete_services` takes `{month, deletes: [{service,
  baseRev, line}], token}`; a subset, an added service or any edit fails the token. N is the notice
  builder's own audience (`seatAssignees(normalizeStoredSeats(role))`), so the number and the people
  told are one set; «hasta» because a member who turned the email off is dropped at flush.
- **Both tools render from one read**, the writer's own canonical query through strict readers that
  throw on a non-array answer (`roleWriteOps.ts` `loadRolesForDelete`), so a malformed read is «no
  pude leer el mes», never «ya no existe».
- **Sort first; any doubt refuses the whole call before any delete.** Gone → «ya no existe»;
  `_rev` ≠ `baseRev`, a line that no longer renders the same, a past service, an ambiguous or
  out-of-month id → nothing is deleted.
- **Drafts by default** (`include: "drafts"`, as «Limpiar mes»'s tick); published only with
  `include: "all"` or by id. A draft is `published === false` only.
- **Past services stay in `/admin`** (Frank, Q2): a service before today in CDMX is never
  deletable from the chat or the card — it would rewrite the fairness balances (ADR-0055) and
  history.
- **One delete at a time**, in date order, under phase 1's 45 s hard stop and 30 s start cut-off;
  each outcome classified (`classifyDeleteOutcome`): proven pre-write refusals → «no se borró» and
  the run goes on; `not_found` and `stale_revision` get a strict re-read; contention with the `_rev`
  unchanged → «repite la misma llamada UNA vez»; a moved service or `bootstrap_completed_reload` →
  «revisa de nuevo», which wins over «repite»; anything unknown → «sin confirmar» and the run stops.
  A failed inline notice names the people in the answer (never a log): a repeat answers «ya no
  existe» and could never tell them.
- **The card deletes too** (Frank, Q1), through the app-only twin `delete_services_app` — the same
  function, its own log label — behind the card's confirmation, with the ADR-0066 addendum's card
  rules (below). `check_service_deletes` has no card `resourceUri`; the card calls the same
  model-visible check, so check logs cannot tell card from chat.

## Rejected

- **Delete by date or «todo el mes» in one call.** The prompt would show «noviembre», not what goes;
  the doc promised the list.
- **Lines without a token.** The model could drop a line between preview and call and the prompt
  would still look right; the token binds the call to the one preview.
- **`/admin`'s «skip the stale one, delete the rest».** A service that changed since the preview may
  now be published or staffed differently; deleting it would not be what the prompt showed.
- **One transaction for the month.** The route deletes one role per transaction with its own lock
  and receipt; a bulk transaction would be a second writer.
- **Telling every refusal to repeat.** A bootstrap that keeps failing answers `stale_revision` with
  the `_rev` unchanged; only contention is offered a repeat, once.
- **Mirroring «Limpiar mes»'s unresolved-write guard.** It guards a client's cached revisions; the
  chat reads fresh and asserts each `_rev`.

## Consequences

- What the server cannot enforce is that Frank READ the prompt. The tool description, `docs/MCP.md`
  and the check's answer say: never «Siempre permitir» for `delete_services`. Live, 2026-10-27: the
  first chat delete ran with NO prompt although `delete_services` was set to «Necesita aprobación»
  in claude.ai, so the prompt this decision leans on is not reliable. The chat showed the list and
  waited for Frank's «bórralas»; Frank accepted that as the confirmation and rejected making chat
  deletes card-only (the card's own «Sí, borrar» is the one confirmation that depends on neither
  the host nor the model). `docs/MCP.md` records it.
- A legacy weekend service with no lock takes two rounds (the first delete bootstraps the lock and
  answers «revisa de nuevo»).
- A wrong delete is recovered by planning the service again or restoring it from Studio's history
  within 3 days; a restored role comes back without its lock and receipt (`/admin` bootstraps the
  lock on its next save), and its people are still told «Ya no participas» (debounced, already queued).
- Rotating `MCP_OAUTH_SECRET` invalidates every pending preview (`docs/SECRETS.md`).
- The card twin rests on the host hiding app-only tools from the model (ADR-0062 Q1 (1)), as
  `save_service_edits_app` does.
- A token does not expire and is not bound to who asked: an old check's arguments stay valid while
  every `_rev` is unchanged and no service has passed. Deliberate — the `_rev` binding already makes
  the list mean what the prompt shows, and only a super-admin principal reaches the tool.
- A line over the save's 200 characters (a special's name has no cap) is kept with «su nombre es
  demasiado largo», so one long name cannot block the month's other deletes.
- `deleteRole`'s dependency and receipt reads are the route's own, non-strict (`run`/`runRaw` turn a
  malformed answer into `[]`); the chat inherits that from `/admin` unchanged. Making them strict is a
  change to `/admin`'s writer too, left for its own delivery.
