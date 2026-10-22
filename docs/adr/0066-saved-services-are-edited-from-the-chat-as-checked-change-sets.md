# ADR-0066: Saved services are edited from the chat as checked change sets, written one service at a time

**Date:** 2026-10-21 · **Status:** Accepted

> **Numbering.** Written as 0064 and renumbered to 0066 on 2026-10-21: PR #166 (now ADR-0064) and
> PR #165 (now ADR-0065) reached `main` first. ADR numbers follow the order records reach `main`.

## Context

Frank asked (2026-10-21 15:48Z): «Quiero poder hacer todo lo que hago en la página como admin, pero
desde el chat». Phase 1 is the saved services: change who serves, a special's name and time,
«Cuenta para equidad», create a service, copy instruments. Four facts shaped it:

- `/admin`'s PATCH route enforces no solver rule; the grid does, in the browser. A chat edit that
  only went through the route would skip every rule the grid checks.
- The Claude app asks before a destructive tool runs, and shows its arguments. Tokens and MACs are
  unreadable; sentences are not.
- A month's edit can touch several services (someone leaves one and enters another), and Sanity
  offers no transaction the route's lock, receipt and notice coordination could join across them.
- A Vercel function has 60 s. One PATCH with its notices queued inline takes ~1–3 s.

Plan: `docs/superpowers/plans/2026-10-21-owt-mcp-admin-parity-f1.md` (S2 approved in review rounds
5 and 6; Frank chose «Fase 1 primero», «Tarjeta y chat», «Parchar y seguir»).

## Decision

- **One writer per action (F1).** The PATCH and copy-instruments routes' bodies moved verbatim into
  `roleEditCommit.ts` and `copyInstrumentsCommit.ts`; the routes and the MCP call the same code.
  `create_service` calls `roleCreateCommit.ts`. Eight write paths in all
  (`serviceCommitCallers.test.ts`).
- **The judge is the proposal editor's (F2).** The stored month becomes a board through the grid's
  own stored-mode reader (`storedMonthBoard.ts`); edits replay through the planner's gates in STORED
  mode (`editorBoard.ts`), and each changed service's target is judged as a diff against its stored
  state (`storedJudge.ts`, `judgeTarget`): removals, then each addition through the pick judge
  (C1–C3 refuse, a C4 is collected), then a whole-board safety net before and after. The save runs
  the same judge again on a fresh read.
- **Stateless change sets (F3).** A check answers, per changed service, `{service, baseRev, target,
  diff, mac, unit, lines, waivers?}` — the full target state, never ops, never a `lockRev`. The save reads
  the month fresh and sorts first: equal to the target → «ya estaba»; `_rev` ≠ `baseRev` →
  «cambió» (refuses the WHOLE call before any write); else «por guardar». Groups (someone leaves one
  changed service and enters another, transitively) are derived by the server, never sent; a group
  of more than 6 is refused. Writes go one service at a time, a group's back to back, each awaited
  with its notices queued inline. A repeat of the same call finishes what an interruption left.
- **The save unit is signed (review finding 1).** Each change carries `unit`: the services that must
  be saved in the same call — its group, or a piece of at most 6 of a larger one, in the server's
  order (`saveUnits`). The MAC covers it, and the save refuses a call that names a unit without
  every service in it (`unit_incomplete`). Without it, one side of a move sent alone would land
  while the other side waits, and the server could not tell: groups are derived from the changes
  in the call, so a half sent alone looks like a complete single.
- **The prompt shows what will happen (F4).** `lines` are compared to the server's own rendering
  as an NFC multiset; a mismatch refuses before any write. A copy's lines name EVERY instrument seat
  of the result (`copyLines`), not only who changes.
- **Only the card forces (F5).** A new per-seat finding needs a waiver token (HMAC of
  `MCP_OAUTH_SECRET` under `mcp-service-waiver|`, bound to the service and its `baseRev`) minted by
  the app-only `check_service_edits_app` when a forced edit covers it. Findings the stored service
  already had are the baseline: warnings, never refusals; forcing one again mints nothing but its
  line, marked «ya estaba rota antes de este cambio», still reaches the prompt.
- **Month-scoped member tokens (F6)** over `mcp-member-token|month|YYYY-MM|<id>`; the change set's
  MAC is `mcp-service-change|` over the canonical JSON of `{service, baseRev, target, diff}`.
- **«Cuenta para equidad» in a past CDMX month is refused on the server (F7)**; the planner's Switch
  is client-only. **No delete (F8).**
- **The arguments travel in the text (found in the live proof, 2026-10-22).** The Claude app hands
  the model only the TEXT of a tool answer; `structuredContent` goes to the card. The first release
  put the change sets only in `structuredContent`, so the model could check but never save. The
  model-visible check now ends its text with one line, `Argumentos para save_service_edits (pásalos
  tal cual): {month, changes}` (or `copy_instruments`'s `{month, from, to, lines}`); the card's twin
  leaves it out and the card hides it. Any future tool whose output the model must pass on puts it in
  the text, as `solve_month` does with its handle.
- **The card never writes.** Its saved-month mode (`useStoredEditor.tsx`) hands the checked change
  sets to the chat; Claude calls `save_service_edits`, so the Claude app asks first.
- **`create_service`** is idempotent by construction: `creationRequestId` = a hash of the payload
  and a generation; a receipt retired by a later delete moves to the next generation (bounded at 5).

### Where the build differs from the plan

- **No per-request client (T2.5 item 4).** Every write and re-read races the call's hard stop
  (`SAVE_HARD_STOP_MS`, 45 s), and no group starts after `SAVE_START_CUTOFF_MS` (30 s). The commit's
  loaders read through the module clients the protected-read audit pins; a second client threaded
  through them would fork that audit. The race bounds the CALL; a request that loses it may still
  land in the background, which is exactly «sin confirmar» and the repeat answers «ya estaba».
  That late write, and the notices it queues inline, are kept running past the answer with
  `after()` (`keepWriteAlive`, review finding 2); otherwise the platform could freeze the function
  between the commit and its notice upsert, and a saved change would reach no one.
- **A re-forced baseline finding (A4)** carries its line in the prompt but no token, as above.
- **«Dónde quedó cada quien»** after a group stopped half-written is computed over the whole month
  board with the written targets applied, so a person who also serves elsewhere is named there too.
- **`copy_instruments` takes no waivers.** The solver's per-seat rules bind voice rows only
  (`ruleEnforcement.ts`: the pattern map lists voice row ids), so a copy of instruments cannot break
  one; if a finding appears anyway the copy is refused (fail closed), never forced. The judge still
  refuses a person without the instrument's Tipo, which `/admin`'s copy does not check.
- **A repeat cannot finish a half-written move onto a custom instrument or FOH row** whose last
  holder the written half removed (review finding 7, accepted): rows beyond the defaults come only
  from labels present in the month (`buildStoredGridRows`), so the fresh board has no such row and
  the remaining service answers `unknown_row`. It refuses (never writes a wrong row); the admin
  finishes that one seat in `/admin`. Keeping the rows the check saw would mean trusting the check's
  board over a fresh read, which the stateless design rejects.
- **A replayed create is matched against the call (review finding 3).** A receipt keeps pointing
  at its role after `/admin` renames or moves it; if the role no longer has the date, name, time
  and format asked for, the call moves to the next generation and creates the one asked for,
  instead of answering «ya estaba» about a service that is not there.
- **Header edits (name, time, «Cuenta para equidad») are chat-only** in the card's first version;
  the card edits seats.

## Rejected

- **Replaying ops («pon a Ana») against current state at save.** Not idempotent: a retry after a
  partial save would place Ana on a seat she already holds. Target state + `baseRev` is `/admin`'s
  own model (`freezeSaveAttempt`, `reconcileSaveAttempt`).
- **A stored change-set record** (like `mcpProposal`): a record type and a lifecycle for a list that
  lives minutes.
- **`/admin`'s «skip the stale one and continue».** Lets one side of a move land while the other is
  stale. Here any «cambió» refuses everything, and a group stops when half of it is written.
- **One transaction for every service.** Offered to Frank (16:37Z); he chose to keep the per-service
  save and patch its failure cases. The route's lock, receipt and notice coordination is per role.
- **Letting the model force** through the model-visible check. ADR-0062's «Claude desde el chat
  nunca puede forzar» would no longer hold.

## Consequences

- A group of more than 6 services, or a call over 31 services, is saved in parts; the card splits
  it and says that a failed part leaves the others saved.
- Rotating `MCP_OAUTH_SECRET` mid-edit invalidates every pending change set, waiver and month token:
  the next save answers «revisa de nuevo» (`docs/SECRETS.md`).
- The guarantee that the model cannot force rests on the host hiding app-only tools, as in
  ADR-0062: a client without MCP Apps support may show `check_service_edits_app` and its `force`.
- Undoing F1 (a second writer) or F4 (lines compared) re-opens the gap this record closes: a chat
  edit that skips the grid's rules, or a permission prompt that does not say what will happen.
