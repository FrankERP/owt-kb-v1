# ADR-0062: Proposal edits are new records, judged on the server, loaded through the chat

**Date:** 2026-10-21 · **Status:** Accepted

> **Numbering.** The next free number on `preview` when written. ADR numbers follow the order
> records reach `main`; renumber if another record lands first.

## Context

ADR-0061 shipped `solve_month` and `apply_schedule`: the connector plans a month on v3 and creates
it, but nothing in between can change a seat. Frank asked (2026-10-21) for a screen in the
conversation where he changes the proposal by hand, is warned when something breaks his rules,
and then loads it. Four constraints shaped the answer:

- A stored proposal's payload is digest-bound and immutable (`proposalDocument.ts`, D10), and
  `apply_schedule` relies on that: it needs no lease because nothing can change under it.
- The create route enforces no solver rule. Whatever reaches `apply_schedule` is created as is.
- Solver v3 cannot judge a hand-edited board: for a fixed service it clamps `>=`/`==` to the
  pinned availability, skips `mandatory_lead` and `unfilled`, and sizes rows to the pins
  (`gcf_v3/owt_v3/facts.py`, `instances.py`, `report.py`). Removing Ana from one of two Sunday
  Leads under `Sun.Lead == 2` reports nothing.
- The Claude app asks before a destructive tool runs, but only for calls the model makes; a call
  from inside an app's frame is not guaranteed that prompt.

Plan: `docs/superpowers/plans/2026-10-21-owt-mcp-proposal-editor.md` (critical slices S2/S3,
approved in review rounds 12 and 13; §8's amendments win over its body).

## Decision

- **The server judges every edit; the screen only shows (E1).** The card
  (`mcp-app/proposal-card/`, `useEditor.ts`) keeps a list of edits, never a board. Each gesture
  sends the whole list to the app-only `check_proposal_edits`; the server replays it from the stored
  proposal through the planner's own gate (`app/mcp/monthProposals/editorBoard.ts`, inputs from
  `columnRuleInputs`) and answers the board. C1–C3 refuse; a C4 (a per-seat rule) asks.
- **A revision is a new record (E2).** `save_proposal_edits` (app-only) and `revise_proposal` (the
  chat's) write `mcpProposal.<new handle>` with a v2 payload: the base's frozen entries, expiry,
  rules revision and months, fresh `creationRequestId`s, `waivers`, `baseline`, `checked`, `saveId`,
  and `lineage {parent, revision, root}`. The base gets `supersededBy` in the SAME transaction.
  `apply_schedule` refuses a superseded proposal naming its successor, unless that proposal already
  created a service (then it continues, `applySupersededContinuing`).
- **The month check is a checker of its own (E5).** `monthCheck.ts`/`monthCheckCore.ts` judge the
  board against the rules AS WRITTEN: count rules, presence, pairs, cadence, the named protections,
  Lead and empty seats, fair share. Eligibility comes from the proposal's frozen entries (A1); the
  fresh ledger feeds only `people` and fair share. A failed ledger read or builder refusal saves
  «sin revisar» (E7, A3). `fixtures/month-check/parity.json` is asserted by vitest and by
  `gcf_v3/tests` against `checker.py`, so the two cannot drift silently.
- **The screen is an MCP App (E8, E9).** One self-contained HTML document built by
  `mcp-app/build.mjs` and committed; a vitest guard rebuilds it and compares bytes.
- **«Cargar» goes through the chat (E10).** The card sends a message (`app.sendMessage`) naming the
  version and every waiver verbatim; Claude calls `apply_schedule`, so the permission prompt runs.
- **Forcing (Q1, decided by Frank 2026-10-21 00:14Z; A4).** «¿Asignar de todos modos?» stores a
  waiver for every per-seat rule (role or week exclusion, pair) the forced C4 named, even when it
  was already broken. `apply_schedule` refuses a proposal with waivers unless its `waivers` argument
  repeats each one exactly (`sameWaiverItems`, multiset after NFC; the sentence bound, the place and
  names as read today). Members cross the wire as tokens (HMAC of `MCP_OAUTH_SECRET` over the root
  handle and member id, `memberTokens.ts`), never as ids (A5).

### Q1's guarantee, stated exactly

What «Claude desde el chat nunca puede forzar» rests on:

1. **The host's:** `force` exists only on `save_proposal_edits`, which is app-only
   (`_meta.ui.visibility: ["app"]`). The Claude app hides app-only tools from the model. The server
   cannot tell who called, so in a client that ignores the visibility (one without MCP Apps support)
   the model could see `save_proposal_edits` and its `force`. `docs/MCP.md` says so.
2. **Ours:** every forced seat reaches production only with its rule in the arguments of the
   destructive `apply_schedule` call, which the Claude app shows when it asks permission. If Frank
   lets the app run `apply_schedule` without asking, the rule shows only in the chat.

What the prompt does NOT list: the MONTH rules (caps `<= >= ==`, presence, the protections, fair
share, empty seats) are warnings for everyone, from the screen or the chat; and a per-seat breach
nobody forced (the solver's own, kept in `baseline`, or one that appeared without an edit, e.g. a
rename since the solve). Both are listed on the screen and in the revise answer before «Cargar».
Frank was told: «Lo que tú fuerces aparece en el permiso al cargar; lo que el solver ya traía o lo
que cambió solo se muestra como aviso».

## Rejected

- **Mutating the proposal in place** (the pre-v3 design). It needed an apply lease
  (`proposal_busy`) and a second write path into a record apply trusts. New records keep the payload
  immutable, so apply's only changes are the superseded refusal, the waiver gate and naming the
  revision it applied.
- **Sending the edited board to solver v3 and reading its report** (rounds 1–4 of the plan). The
  solver answers «what is the best achievable», not «does this board meet the rules as written»
  (the clamping above). Porting its CP-SAT model would copy staging a check does not need.
- **Bundling the planner's gate into the screen, or letting the screen send a finished board.** A
  second judge drifts; a finished board lets any client, or the model, write an unjudged board into
  a record apply turns into services.
- **An Artifact page, or a link to `/admin`.** An Artifact cannot call our server with Frank's
  OAuth grant; `/admin` is what he is trying not to open.
- **«Cargar» calling `apply_schedule` from the frame.** It would skip the permission prompt that
  carries Q1's guarantee (2).
- **Refusing a hard-rule block outright from the screen** (Q1-B). Frank chose to force from the
  screen, as `/admin`'s «Forzar» does.

## Consequences

- **The accepted race (A6).** An apply of the base that loaded before a save commits finishes with
  the solver's seats, and the child's apply is then refused by D7 (c): Frank's edits are lost
  loudly, after he approved both calls. Nothing is built for it.
- Two revisions of one solve cannot both land one after another (the second finds the dates taken,
  `phase3Refusals`). Applied at the same moment, they fall into ADR-0061's accepted interleave:
  mixed, never duplicated.
- **Rollback:** after reverting this release, every record with a v2 payload or a `supersededBy`
  reads as no record. That fails closed: Frank re-solves the month.
- Rotating `MCP_OAUTH_SECRET` changes every member token: an open editor screen's pending edits
  are refused («Ese id no es de un miembro…») and dropped; closing and reopening the editor gives
  fresh tokens (`docs/SECRETS.md`).
- The card bundle grows (~614 000 characters; the guard caps it at 800 000).
