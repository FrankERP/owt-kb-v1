# OWT MCP — admin parity, phase 3, slice S4: Oasis Kids from the chat (spec)

**Status:** standard tier (parent plan §0: S2 and S4 are standard work: self-reviewed, then the
merge-range code review). Scope approved by Frank 2026-10-27 19:12Z («Sí, con Kids ahora»: build Kids
now on today's Kids model, parent D12). Self-reviewed 2026-10-27.
**Requirement (Frank, 2026-10-21 15:48Z, verbatim):** «Quiero poder hacer todo lo que hago en la
página como admin, pero desde el chat». Phase 3 row: Kids — «Ver y editar parejas, disponibilidad,
generar y guardar meses».

## 1. What Frank gets

1. «¿Cómo va Kids en noviembre?» → `get_kids_month {month}`: the pairs (name, room, active, the two
   volunteers), every Sunday's seats (pair names, drafts and published marked), and the volunteers'
   absences that month.
2. «Genera noviembre» → `generate_kids_month {month, seed?}`: what «Generar mes» proposes (read-only,
   the same `planKidsMonth` over the same inputs), its warnings (a volunteer also serving worship that
   day) and unfillable seats, and `seed`/`fingerprint` for «otra opción».
3. «Guárdalo como borrador» / «Publica el domingo 9» → `save_kids_sundays {sundays: [{date, seats,
   published?}]}`: one Sunday at a time through the planner's own writer, seats by pair NAME (or id).
4. «Crea la pareja Ana y Luis en Chiquitos», «Retira a Ana y Luis» → `save_kids_pair`.
5. «Ana no puede el 16» → `set_kids_absences {member, add?, remove?, notes?}`.

Nobody is notified by any Kids write (as `/kids/admin`). Every write description tells Claude to show
exactly what will be saved and wait for the person's word in this conversation.

## 2. Evidence (this branch, 2026-10-27)

- Routes, all behind `requireMinistryManager("kids")` (the MCP bearer is a super-admin, who spans
  both ministries): `GET/PUT /api/kids/schedules` (one Sunday per PUT, deterministic id
  `kidsSchedule-<date>`, `createIfNotExists` then set/unset, NO revision guard, a pair holds one seat,
  room seats take their own room's active pairs); `POST /api/kids/generate` (read-only planner);
  `GET/POST /api/kids/pairs`, `PATCH /api/kids/pairs/[id]` (`_type` guard; name, room, two members,
  `active`); `GET /api/kids/members`; `PATCH /api/kids/members/[id]/availability` (`_rev` REQUIRED,
  `ifRevisionId`; `unavailableDates` + `unavailabilityNotes` written whole).
- `unavailableDates` is the SAME field worship availability uses (a member in both ministries has
  one list); the route's `_rev` rule exists because `/me` writes it too.
- Draft gating (ADR-0022): every `kidsSchedule` read under `app/**` filters `published == true`
  except the planner's draft editors (`draftGatingCoverage.test.ts`, `KIDS_MAY_SEE_DRAFTS`, keyed by
  file: `api/kids/schedules/route.ts`; `KIDS_LABELS_MAY_SEE_DRAFTS`: the planner page's `schedules`).
- No Kids month has ever been saved in production (checked 2026-10-20).

## 3. Decisions

| # | Decision | Why |
|---|----------|-----|
| K1 | Extract the writers into `app/utils/kidsCommit.ts` (`CommitOutcome`): `saveKidsSunday(raw)`, `createKidsPair(raw)`, `patchKidsPair(id, raw)`, `setKidsAvailability(id, raw)`, moved verbatim; the routes keep the ministry guard and JSON parsing; route tests pass unchanged. The generator's input read and call move to `loadKidsPlanInputs(month)` + the existing `planKidsMonth`, shared by the route and the tool. | ADR-0043: one writer per rule (one seat per pair, room seats, retired pairs, the `_rev` rule). |
| K2 | The month's draft-seeing read moves into ONE module, `app/utils/kidsScheduleReads.ts` (`kidsMonthSchedulesQuery`), used by the schedules GET and the MCP read; `KIDS_MAY_SEE_DRAFTS` is re-keyed from the route file to that module (ADR-0022 amended in the same change). | A third file reading drafts would need its own exemption; one module keeps the exemption one entry and names every consumer. |
| K3 | Seats and pairs by NAME on the wire (resolved server-side against the pairs read in the same call; an unknown or ambiguous name is refused with the list), ids accepted too. Volunteers by name or id as `get_member_availability` does, restricted to Kids members. | The chat speaks names; resolving on the server keeps the writer's id contract. |
| K4 | `save_kids_sundays` writes Sundays one at a time through `saveKidsSunday`, each a whole Sunday (as the planner: an omitted seat is cleared — the description and the answer say so), max 6 per call; a refusal stops the call and reports which Sundays were saved before it (no rollback, as the planner). `published` is passed only when the person asked to publish or unpublish. | Parity with the planner's PUT; a month is at most five Sundays. |
| K5 | `set_kids_absences` edits by PARTS: it reads the member's fresh `_rev` and lists, applies `add`/`remove` dates (and per-date notes), and writes through `setKidsAvailability` with that `_rev`; a 409 answers «cambió mientras tanto; vuelve a intentarlo». The answer reminds that the same list is the member's worship availability. | The list is shared with `/me` and worship; a whole-list write from the chat would erase dates it never saw. |
| K6 | `save_kids_pair {pair?, name?, room?, members?, active?}`: no `pair` creates (name, room and two volunteers required), with `pair` patches only the given fields; retiring is `active: false`. | Parity with the roster form. |
| K7 | Annotations: the two reads `{readOnlyHint: true, openWorldHint: false}`; the three writes I14's destructive set. Writes run in `runWriteTool`/`callDomain`; their unknown-outcome copy points at `get_kids_month`. Actor: the bearer must be present (`principalOf`), else refused before any read; Kids writes record no author, as the routes. | As every phase 3 write. |
| K8 | Pins and docs: `serviceCommitCallers.test.ts` (`kidsCommit`: the four routes and the tools), `DELIVERY_CAPABLE_IMPORTS` (so every handler of those route files is wrapped in `withVerificationRunContext`), the protected-read audit (the pair PATCH's `_type` guard moves with it), the tool pins (smoke, `mcpRoute.test.ts`, handshake), `docs/MCP.md`, CLAUDE.md / AGENTS.md / `project-rules.md`, `docs/KIDS*` if present. | The pins exist so a new caller of a production writer is a reviewed change. |

## 4. Out of scope

The multi-ministry generic model (the 2026-10-26 multi-ministry plan); deleting pairs (no screen does);
notifications (Kids sends none today).

## 5. Proof

Tests: route tests unchanged; commit tests; tool tests over fakes (name resolution, ambiguous names,
a whole-Sunday save clearing an omitted seat, absences by parts under `_rev`, a 409, no principal).
Live, with Frank, in production: generate a far month (read-only), save ONE far Sunday as a draft
(members never see drafts), then clear it; create a test pair and retire it.
