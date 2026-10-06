# Month-grid service editing

> **Current state (2026-08-05):** released from `main` at merge commit
> `fee03d8` and available in production at
> [owt-backstage.vercel.app](https://owt-backstage.vercel.app). The tested
> feature tree remains on `feat/month-grid-editing` and `preview`.
>
> **Drag and pick-then-place (2026-08-06):** the "Move interactions" section
> below documents `feat/grid-drag-and-drop` (T1–T7,
> `docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md`), **released from
> `main` at merge commit `47416b9`** and verified serving both
> [owt-backstage.vercel.app](https://owt-backstage.vercel.app) (production)
> and dev-owt-backstage.vercel.app (`preview` at `0f1eb4c`) the same night.
> Two release checks remain open, per ADR-0012: a real-Safari pass on the C4
> prompt in full screen, and iPadOS long-press drag behavior.

This is the current-state reference for editing stored service teams through
the month grid. Detailed mutation-test evidence lives in the
[implementation log](superpowers/plans/2026-08-03-month-grid-editing-implementation-log.md);
the parent/child plans and review ledger preserve the design history.

## User-visible result

The existing three-part month-planning layout is now the sole free-form editor
for stored service rosters:

- **Editar mes** opens the selected month against stored services.
- A service card's roster edit action opens the same grid focused on that role.
- **Nuevo** opens a one-service composer. It creates one empty unpublished
  service and never invokes the solver or fills a roster automatically — that
  holds for the one-service composer; the toolbar's **«Llenar especiales…»**
  (below) is the explicit exception.
- **«Llenar especiales…»** (stored mode toolbar, spec
  `2026-09-22-camp-group-fill-design.md`) opens an inline picker listing every
  approved special of the month — all ticked by default, published ones
  marked **«· publicado»**. **«Llenar vacíos»** fills the ticked group's empty
  Lead/BGV and instrument seats locally (`groupFill.ts`): load and fairness
  count only appearances inside the ticked group — no weekends, no 56-day
  window — pins (existing occupants) are kept, and only empty seats are
  filled. Nothing is written until **«Guardar»**, and the solver is never
  called. Known limitation: on an OLD special whose instrument row uses a
  non-standard label (e.g. `Piano`), the fill can still seat the standard row
  of the same instrument (`Keys`) — review before «Guardar».
- The Servicios panel's month pills always offer the current month plus the
  next two, even when a month has no service yet, so an empty upcoming month
  (a camp weekend, say) can be opened and given its first service without
  generating the whole month with the solver first (`monthPills.ts`).
- Existing services support assignment changes, same- and cross-month date
  moves, and special-service name changes. Service type remains immutable.
- The grid supports whole-team swaps and complete section swaps across two
  services: Líderes, BGV, Coro, Instrumentos, or FOH.
- The former `SeatBoard`/card-swap editor and rendered **Tablero** copy are
  retired, and as of 2026-08-06 their source and tests are deleted
  (`SeatBoard.tsx`, `ParticipationRail.tsx`, `enforceableConfig`). See the
  dated note at the end of `docs/adr/0010-specials-fill-locally-not-in-the-solver.md`.
- Card-owned delete, copy-instruments, publish/unpublish, setlist, proposal, and
  integrity workflows remain in `ServicesPanel`.
- **Limpiar mes** (stored editor footer, since 2026-09-01) deletes the month's
  stored services so the admin can run **Generar mes** again after corrections.
  Drafts (`published === false`) by default; published services are an explicit
  checkbox opt-in because each queues a «ya no participas» notice. There is no
  bulk route: the editor calls the existing `DELETE /api/admin/roles/[id]` once
  per service, in date order, with the observed `_rev`, so every server guard
  (revision, weekend token, receipt, dependency refusal) applies unchanged. A
  refused delete (a setlist or proposal on that date) does not stop the rest.
  The editor always closes afterwards; `ServicesPanel` reloads sources and shows
  a toast on a clean sweep or a persistent per-service failure report otherwise.
  Gated by `deleteService`, and disabled while a save, swap, or create is
  still unconfirmed (the observed revisions may be stale, or a landed create may
  not be listed yet). Pure selection and summary
  wording: `clearMonthModel.ts`; rejection wording shared with the card flows:
  `serviceMutationErrors.ts`.
- **The Saturday after the last Sunday is Auto's** (create mode;
  [ADR-0048](adr/0048-the-saturday-after-the-last-sunday-belongs-to-its-calendar-month.md)).
  Some months end on a Saturday whose Sunday is in the next month, such as Sat 31 Oct 2026. That
  Saturday's column is a column Auto writes, as solver week `weeks + 1` of its own month. It is
  preselected like every Saturday.
  - If no lead can take it, Auto still solves the Sundays. A lead cannot when they are
    unavailable, when a rule excludes them, or when their rule has no Saturday left. For
    example, Andy has `Sat.* == 1` and is the only lead who can take the 24th. Auto leaves the
    31st to be filled by hand and says so under Auto: «El sábado 31 oct no se mandó al solver:
    ningún líder puede dirigirlo (no disponibles, excluidos o sin sábados libres en su regla).
    Llénalo a mano.»
  - If the solver refuses the month with the 31st in it, Auto solves it once more without it,
    still showing «Calculando...», and the Sundays are filled. It says so under Auto: «El
    sábado 31 oct no se mandó al solver: con él, el mes no tenía solución. Llénalo a mano.» If
    the second solve is refused too, Auto shows that refusal as usual. A failure to reach the
    solver is never retried (rulings Q19 and Q20).
  - A withheld 31st is not pinned by «Solo llenar vacíos» and is not counted in its confirm.
    After a retry, the confirm still counts it: the preview shows what the next Auto sends
    first.
  - Rule checks on that column judge it as that week, over its own month's Sundays, in both
    create and stored mode. That covers the picker, the warnings on seated members, and drag and
    pick-then-place. So a «Sem 5» rule applies to it.
  - No column is labelled «Fuera del alcance de Auto» any more, and the confirm has no clause
    about Saturdays Auto cannot reach.
  - Saturday minimums that cannot be met are named under Auto before the 31st line, one line per
    reason.
- **«Solo llenar vacíos»** (create mode, next to Auto; off by default, never remembered) makes
  Auto keep everything already on the board: occupied voice seats go to the solver as fixed,
  empty ones are filled around them, instruments are completed without moving anyone, FOH is
  untouched. While Auto runs with the switch on, the grid is read-only; the switch itself and
  every «Borrar» are disabled while Auto is pending, switch on or off. Seats that contradict
  something are named on the chip. A person who marked the day unavailable, or is outside the
  solver's groups for that seat, is still fixed there and the seat wins (E3). A person already
  seated elsewhere in the same service is named as left out of that seat, not fixed: Auto keeps
  them in one seat only (Lead before BGV before Coro). Auto's confirm states how many empty
  voice seats it will fill, and what the solver had to give up is listed under Auto.
- **«Borrar»** (create mode, next to Auto and in each column header) clears Voces, Instrumentos
  or both, for one service or the whole month. FOH is never cleared in bulk. A service clear
  applies at once with «Deshacer» — the toast names what was cleared and where («Voces ·
  domingo 1 mar: se borraron 2 asignaciones.») — and the undo is withdrawn once Auto runs, when
  the month or year changes, and when the step changes. A month clear asks first, with a live
  count and an approximate count of hand-placed seats, and writes nothing until «Crear N
  borradores». A month clear leaves a special service's Coro and instruments alone, because
  nothing refills them in create mode («Los especiales conservan su Coro e instrumentos.»); a
  service clear on a special still clears them. In full screen only the per-column «Borrar»
  menus appear (the month clear, like Auto, is not on the full-screen bar), and «Deshacer»
  still works there because the toast stack is exempt from the grid's inert sweep.

Services with integrity defects stay visible as **Solo lectura** instead of
disappearing or being normalized into apparently valid editable columns.

## Delivery phases

| Phase | Delivered contract |
|---|---|
| P1 | Role-ID columns, keyed occupants, whole-inventory admission, exact stored labels, and per-target Sunday rule context. |
| P2 | Canonical submitted-member validation, truthful bootstrap outcomes, special-identity coordination, Studio protection, schema, ADR, and writer tests. |
| P3 | One empty unpublished service per logical request with stable idempotency identity and exact readback verification. |
| P4 | Explicit full-roster save, no-op suppression, date/name editing, cross-month moves, frozen attempts, and conservative reconciliation. |
| P5 | Topology-safe whole-team and stored-item-key seat swaps with all-role intended-state reconciliation; the later section-swap correction replaces the individual-seat UI. |
| P6 | Servicios entry-point migration, focus restoration, operation-specific gates, and legacy editor retirement. |

## Stored-grid model and admission

Dates are calendar/rule context, not stored-column identity. Every stored
service column uses its Sanity role `_id` as `columnId`, preserving distinct
services that legitimately share a date. An occupant carries `memberId` and,
when stored, its original Sanity array item `_key`.

`ServicesPanel` owns and independently tracks two observations:

1. `/api/admin/roles` supplies the dereferenced UI roster.
2. `/api/admin/service-integrity/roles` supplies raw identity, revision, draft,
   dangling-reference, assignment, topology, and lock evidence.

No stored role is mutable unless the complete inventories form an exact
ID/revision/type/date/publication bijection and its all-five-field assignment
set matches. Untyped issues, raw drafts, missing/extra peers, revision races,
target collisions, hidden Saturday Chorus data, and unsafe lock states make
the context read-only.

Instrument and FOH rows retain exact case/accent-sensitive write labels.
Values such as `Bass`/`bass` or `Console`/`console` cannot collapse during an
unrelated edit.

## Create and save contracts

Create submits one empty service with `published: false` and a stable
`creationRequestId`. An uncertain outcome freezes that exact request; the UI
may replay or verify it but cannot mint a new identity and silently duplicate a
service. Success requires exact role/request identity, type, date, normalized
special name, five empty assignment arrays, and `published === false`.

Stored changes remain local until **Guardar cambios**. The serializer emits a
role-ID-targeted, complete five-array PATCH for Lead, BGVs, Chorus,
instruments, and FOH. Every untouched occupant, `_key`, and stored label must
survive. Semantic no-ops emit no PATCH and no notification work.

**«Cuenta para equidad» (solver v3 C1).** Every create column, every stored column, the
calendar's special composer and «+ Nuevo servicio» carry the house `Switch`
(`FairnessSwitch`). Create columns enter at the type default — Domingo and Sábado on, a
special at the composer's choice, off by default. A header edit is held per column while
the column stays selected — across the config and grid steps, «Omitir» and Auto, which
never changes it — and dropped when the date is deselected or the special removed. A
column blocked from creation shows no switch. Stored columns read the `GET` row's
effective value and edit it through the header overlay, beside Fecha/Nombre/Hora (gated
by `readOnly` and the mutation lock, never by the date-move block); every stored PATCH
carries the column's effective value and the semantic snapshot includes it, so a
toggle-only change is one dirty service and reconciles like any other edit. «+ Nuevo
servicio»'s switch follows the Tipo until touched, is part of the attempt identity, and a
create verifies only when the reload shows the requested value. **Past months:** a service
whose stored or edited date falls before the current CDMX month has its switch disabled,
with «Mes pasado: ya no se cambia.» as its accessible description, and shows and sends
its stored value (stored) or the type default (create). The rule is evaluated at render
and again when each body is built; it is client-side only — neither route refuses on the
month (C1-D7). While the engine is v2 each surface shows once: «Cuenta para equidad:
aplica con el nuevo solver. Hoy Auto no lo usa.»

Date moves use the separate `changeServiceDate` capability. A cross-month move
keeps the source role-ID column, loads the destination target's complete Sunday
spine, and reconciles by role ID outside the displayed-month filter. Invalid
local changes, including blank special names, count as unsaved work, disable
save, and participate in the close warning.

## Move interactions: drag and pick-then-place

Two ways to relocate one already-seated occupant to a different cell, before
Guardar: dragging the occupant's chip (desktop, HTML5 `draggable` — `dragstart`
never fires from a touch), or a keyboard/touch pick-then-place — "Marcar para
mover" on a focusable chip (Enter/Space) or on the picker-row anchor, the
touch route — then activating a target cell. Every occupant has a chip,
including the ones past a row's target, which are tinted amber and named
«(por encima del objetivo)» rather than folded into a `+N`
([ADR-0045](adr/0045-every-grid-occupant-gets-a-named-chip.md)). Both
compose the same move primitive (`moveOccupant.ts`) through the same gate
(`moveGate.ts`), so they can never diverge on what is allowed. See
[ADR 0012](adr/0012-grid-drag-excludes-swap-touch-and-auto-scroll.md) for what
this deliberately excludes — swap by drag, touch drag, edge auto-scroll — and
why pick-then-place, not a lifted chip, is what serves touch.

Every proposed move is judged in order. **P1–P3** are preconditions: the
mutation lock, whether the serializer will accept both touched columns
(`moveGate.ts`'s `canTouchColumn`), and — create mode only — whether the
target column will actually be created. Failing any precondition means the
move is not evaluated at all. **C1–C4** are then judged: **C1** (already
seated at the target), **C2** (a data error) and **C3** (wrong member type)
all **refuse** and are never forceable. **C4** (a rule violation) is the only
constraint that **prompts** — `PlannerGrid.tsx`'s "Forzar el movimiento"
dialog, offering "Mover de todos modos" or "Desistir"; forcing records the
waived rule at the target seat only, never the source. Unavailability is not a
fifth constraint: it renders as a non-blocking note at the drop, the same sort
penalty the picker already applies.

All four constraints are judged against ONE list: the target column's
occupancy with the source removal applied, and the dragged member **not yet
placed** at the target seat (`moveGate.ts`'s `assignedAfterSourceRemoval`).
This is deliberately **pre-placement, not post-move** — judging post-move
state would let the self-exemption in `ruleEnforcement.ts:351` (a member is
exempt from a rule at the seat they already occupy) swallow every constraint,
and C4's prompt could never fire. `moveGate.ts` and `moveOccupant.ts` can be
read directly against both claims.

**DD10 — a move removes exactly one copy**, never every copy of a member
duplicated in one cell (a state the section-swap route can create). Dropping
the member id wholesale would silently delete a second assignment nobody
asked to move; `moveOccupant.ts`'s `dropOneOccurrence` is where the one-copy
rule is enforced.

A move is local state until **Guardar cambios**, exactly like any other cell
edit — by itself it produces no PATCH and no notification. See "Mutation
outcomes and recovery" below for what happens when a cross-service move's save
fails on only one side: T6's save loop is sequential and continues past a
known failure, so a cross-service move whose source PATCH commits and target
PATCH is rejected notifies the member of a removal with no matching addition,
and it does so **for published (or grandfathered) services only** — draft
edits stay silent (`app/api/admin/roles/[id]/route.ts:396-398`). The exposure
predates the drag (the pre-drag two-edit workflow carried it too); the drag
makes it feel like one atomic gesture where two edits made both steps
visible. See ADR-0012.

## Swap contracts

Whole-team swaps are allowed only when both services are Saturday or both are
non-Saturday, preventing hidden Chorus data from entering Saturday. Section
swaps exchange exactly one complete stored array between two services. Empty or
differently sized arrays are supported, and stored order, `_key`, item type,
member references, and instrument/FOH labels travel unchanged. Shared sections
may cross service classes; Coro refuses any pair containing Saturday.

Both operations require a globally clean grid. The client freezes the exact
post-swap semantic state for every involved role. Section swaps additionally
freeze ordered item-key/member/label fingerprints, so an equal member set with
the wrong keys, order, or labels cannot be falsely verified. One mutation lock
covers transport and reconciliation across grid edits, create/save, whole-team,
and section actions; a second action cannot overwrite pending intent.
Close and Escape are blocked while a stored request is in flight, including
when a discard confirmation was already open before the request began. Empty
custom row additions also count as unresolved work, so neither a swap nor an
unrelated source reload can erase a row the administrator was preparing to
fill.

## Mutation outcomes and recovery

POST, PATCH, and swap routes can commit before notification/cache work returns.
Transport loss, malformed or untyped responses, 5xx, and bootstrap-unknown are
therefore unknown outcomes—not proof that no write occurred.

| Outcome | Client behavior |
|---|---|
| Allowlisted typed pre-write refusal with its exact expected HTTP status | Retain the edit as refused and permit correction/review. |
| `bootstrap_completed_reload` | Adopt maintenance metadata only; preserve business intent for an explicit reviewed retry. |
| Unknown outcome | Keep frozen bytes/snapshots, block another write, reload, and reconcile. |
| Readback equals frozen intent | Adopt the canonical revision and clear that pending intent. |
| Readback differs after a known/possible commit | Report superseded/conflict and retain local intent plus remote observation. Never auto-retry from a new revision. |

Mixed batches reconcile per role: applied roles become clean while
maintenance-only, rejected, or unknown roles retain the correct intent and
truthful status.

## Server hardening

- POST and PATCH validate every submitted member reference against canonical
  published members before coordination, bootstrap, or business writes.
- Protected writers expose maintenance commits truthfully; later refusals cannot
  hide revision-advancing bootstrap work.
- Special create and identity-changing PATCH share a deterministic,
  revision-guarded coordinator, giving same-target races one winner.
- Special occupancy is authoritative in the writer, including roster-only edits.
- The coordinator is registered in Sanity, hidden/protected from routine Studio
  mutation, audited, and recorded in
  [ADR 0011](adr/0011-serialize-special-identities-globally.md).

## Capability and accessibility behavior

Create, team edit, date move, and swap use operation-specific source-readiness
capabilities. Entering through one workflow cannot authorize another with
weaker evidence. Read-only columns cannot open pickers, edit headers, or
participate in row copy.

Closing the full-width editor restores focus to the remounted opener:
**Nuevo**, toolbar **Editar mes**, or the originating card's **Editar equipo**,
with a toolbar fallback if the card is no longer visible.

## Primary code ownership

- `MonthGenerator.tsx`: create/save/swap orchestration, frozen attempts, readback.
- `PlannerGrid.tsx`: role-ID columns, headers, picker and read-only behavior.
- `ServicesPanel.tsx`: sources, capabilities, entry points, focus restoration.
- `storedRoleReadModel.ts`: inventory admission and lossless translation.
- `plannerSaveModel.ts`: full serializer and semantic reconciliation.
- `serviceRuleContext.ts`: per-target rule context (`ruleContextForTarget`). A Sunday is its own
  week. Any other Saturday takes the week of the Sunday after it, in that Sunday's month. The
  trailing Saturday (`trailingSaturday`) is week `weeks + 1` of its own month, over its own
  month's spine, with `owningSunday: null`.
- `roleWriteOps.ts` and role routes: canonical members, bootstrap, topology.
- `specialIdentityCoordinator.ts`: serialized special identity.
- `moveGate.ts`: pre-placement move judgement (P1–P3, C1–C4) shared by drag
  and pick-then-place.
- `moveOccupant.ts`: the one move primitive both mechanisms call.

## Verification, review, and delivery

Final repository gates, re-run on 2026-08-06 after the grid drag-and-drop
delivery (T1–T7, `docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md`)
added drag, pick-then-place, `moveGate`/`moveOccupant`, and this ADR:

- `npm test`: **140 files, 3228 tests passed**. (135/3134 immediately before
  this delivery, below; the file/test count grew with the move gate, move
  primitive, drag, and pick-then-place coverage — see the implementation and
  review-log docs under `docs/superpowers/plans/` for the phase-by-phase
  detail.)
- `npx tsc --noEmit`: passed.
- `npx eslint .`: **0 errors**, 90 accepted backlog warnings (same backlog as
  before this delivery — no new warnings).

Prior gates, re-run on 2026-08-06 after the Tablero retirement (`50dd868`)
deleted `SeatBoard.test.tsx` and trimmed six other test files:

- `npm test`: **135 files, 3134 tests passed**. (134/3131 after that deletion;
  135/3134 once `scripts/__tests__/vendoredSkillDigest.test.ts` was added. It was
  135/3191 on 2026-08-05, before the deletion — the file count coinciding again is
  a coincidence, not a no-op.)
- `npx tsc --noEmit`: passed.
- `npx eslint .`: **0 errors**, 90 accepted backlog warnings.
- `git diff --check`: passed.

The final bounded code review found five real defects, all corrected: separate
date-move gating, conservative non-2xx swap classification, complete create
intent comparison, stable opener focus restoration, and exclusion of read-only
columns from row copy.

| Date | Commit/deployment | Result |
|---|---|---|
| 2026-08-05 | `6914c6d` | Repository and Claude review policy made risk-tiered and token-efficient. |
| 2026-08-05 | `3e0ab97` | Complete implementation committed and pushed on `feat/month-grid-editing`. |
| 2026-08-05 | `4d7165b` | Feature merged and pushed to `preview`. |
| 2026-08-05 | `dpl_77qBCC7VCkAdhp87u51q8BN9vmyf` | Vercel `READY`; canonical `owt-backstage`; stable preview alias attached. |
| 2026-08-05 | `8346a88` | Legacy roles without `published` admitted without a Sanity migration. |
| 2026-08-05 | `ed77adb` | Complete section swaps and final reconciliation protections committed and pushed. |
| 2026-08-05 | `39d955c` | Corrected feature tree merged and pushed to `preview`. |
| 2026-08-05 | `fee03d8` | Exact tested feature tree merged and pushed to `main`. |
| 2026-08-05 | `dpl_9PcfDGNvjtWzYt38FCZ69BJy6zJH` | Production deployment `READY`; `owt-backstage.vercel.app` attached without alias errors. |

The stable preview returned HTTP 200 with the expected app sign-in shell.
`/admin` remains behind Vercel Deployment Protection and app authentication.
Authenticated mutation flows were not exercised live; route/component tests
cover them. The build completed with one non-blocking Turbopack NFT tracing
warning. The later production deployment built exact `main` commit `fee03d8`
in canonical project `owt-backstage`, reached `READY`, and attached the
production alias without errors.

## Non-actions and residual release checks

- No production Sanity content write, migration, or PR was performed.
- The Git/Vercel production release did not exercise a live authenticated
  roster mutation. Monitor the first operator use and retain the documented
  Sanity revision-history recovery procedure for real edits and swaps.
- Intentionally absent: single-service solver/local auto-fill, service-type
  conversion, and automatic retry from a fresh revision.
