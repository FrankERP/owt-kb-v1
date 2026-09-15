# «Solo llenar vacíos» — the switch, the clears and the notices — design spec (client half)

**Date:** 2026-09-15 · **Status:** split out of `2026-09-10-solver-fill-empty-only-design.md`
after eleven adversarial review rounds · **Risk tier:** **standard**

Standard, derived from the ladder. This half is a client/UI consumer of an already-specified
solver contract: it adds a switch, a menu, some notices and a toast, and it changes how
`applySolveResponse` rebuilds a cell. It owns no production writer, no serializer, no auth or
ACL boundary, no schema migration, no concurrency protocol and no irreversible remote action.
Nothing in it reads or writes a stored role document — create mode only, E7 — so no published
service can be touched **by construction rather than by a check**.

Per CLAUDE.md's retier: standard work runs **spec → Frank's review → implement → gates → fresh
code review of the diff**, and spends its budget on the diff review rather than on adversarial
plan rounds. That is a deliberate call made on this artifact's own evidence — see §0.

## 0. Why this file exists, and why it is standard

The original spec carried the solver contract and the whole admin UI in one critical-tier
artifact. Eleven review rounds later:

- **Rounds 10 and 11 found nothing in the solver mechanism** — both reviewers patched a copy of
  `owt_solver_v2.py`, executed it, and confirmed every headline property.
- **Round 11's three blockers were all in this half**, and all three were the same shape: a
  promise the spec made that the code would not keep. A label saying «se va a respetar tu
  decisión» while the switch defaults to off; «volver a correr Auto es el deshacer» where no
  undo exists; a marker-dropping pass whose natural reading destroys the short-staffing signal.
  Every one was found by reading the spec against the client code — which is exactly what the
  **diff review** does, against real code, with fewer ways to be wrong.
- **Round 10 found a defect introduced by round 9's own fix** — the churn signature CLAUDE.md
  records for the 15- and 19-round loops.

So this half carries the eleven rounds' findings **already applied**, and goes to implementation
and a diff review rather than to more plan rounds. The critical contract it consumes is reviewed
separately in `2026-09-15-solver-pinned-assignments-design.md`.

**Ordering: the solver half must be deployed before this one sends a single pin.** §7's version
handshake is what makes the window between the two deploys safe, and it is the reason that
handshake is in this file rather than the solver's: the refusal is client behaviour.

## 1. The brief

Frank, during delivery 1's brainstorm: «me gustaría tener una opción para que el solver llene
únicamente los espacios vacíos, en vez de sobre escribir todo». Today «Generar mes» rewrites
every solvable voice row on every weekend column, so a manual correction survives exactly until
the next Auto. He also asked for a delete control with a menu offering every level of
granularity.

He asked for it to work on already-created draft services too; that half is deferred to its own
delivery (§11).

## 2. What the repo says today

Every row verified against the tree at `ae792034`, which is unchanged in `gcf/` and
`plannerModel.ts` at the commit this spec sits on.

| Fact | Where |
|---|---|
| Availability is **not** a block in the picker — it is a `+10` sort penalty, so an admin can and does seat an unavailable member | `candidateRanking.ts:211`, `:246` |
| The picker DOES block the same person twice in one service, same category | `candidateRanking.ts:196-204` |
| `applySolveResponse` REPLACES a solvable cell — it rebuilds `occupants` with no merge and stamps `origin: "auto"` | `plannerModel.ts:925-936` |
| `mapUnfilledSeats` maps an unfilled entry by role and week, never by slot index | `:958-986` |
| Auto is create-mode only | `PlannerGrid.tsx:1997` |
| The Auto confirmation says it will replace every voice assignment the solver can resolve | `PlannerGrid.tsx:2035-2040` |
| Member-declared availability is **not** rendered on a cell — `blockingReasons` reads admin-authored `weekExclusions`, a different thing; the only availability signal is a transient drag toast | `ruleEnforcement.ts:372-383`, `PlannerGrid.tsx:2861-2891`, `:1177-1186` |
| The rules panel cannot author a `!consecutive` clause — `restrictionToDs` never emits one | `plannerModel.ts:572-599` |
| Create mode derives `drafts` inside `handleCellsChange`; a cell change that bypasses it renders one thing and posts another | `MonthGenerator.tsx:2467-2487` |
| `Menu`, `CueDialog`, `Button`, `Switch` exist as house primitives | `app/components/ui/` |
| `weekForColumn` maps a weekend column to the solver's 1-based week; a special returns `null` | `plannerModel.ts:845-858` |


## 3. Decisions

Of the eight decisions Frank approved on 2026-09-10, these five are this half's. E4, E5 and E8
(the fixed-variable mechanism, client-side conflict computation and the honoured-pins proof) are
recorded in the solver spec; E3 is shared and appears in both, because the pin-wins rule is a
solver behaviour and the notice is a client one.

- **E1 — What the switch preserves: everything on the board, instruments included.** With
  «Solo llenar vacíos» on, every occupied voice cell on a weekend column is pinned regardless
  of how it got there — a human pick or a previous Auto — and the instrument filler is told
  to keep its own previous picks as well. Frank chose this over "preserve only manual picks",
  and confirmed the instrument half on 2026-09-12. The consequence is deliberate: re-running
  Auto on a full month does nothing until something is cleared. Clearing is the re-roll.

  The instrument half is not free, and an earlier draft of this spec left it out while
  claiming it was already handled. `fillInstruments` runs at **every** exit of `handleAuto`,
  inside `applySpecialFill` (`MonthGenerator.tsx:2984-2986`), and it opens by calling
  `vacateAutoInstrumentCells` (`instrumentFill.ts:119`), which empties every weekend
  instrument cell whose `origin === "auto"` (`:85-90`). Only `origin: "manual"` picks survive
  it. So without this decision, pressing Auto twice with the switch on would leave the voices
  untouched and re-roll the drums and the keys — and §5's dialog would be promising to fill
  only the empty seats while doing exactly that. `fillInstruments` therefore takes the switch
  as an input and skips the vacate when it is on, which is the one-line version of "preserve
  everything on the board".

- **E2 — The switch is OFF by default.** Auto behaves exactly as it does today until the
  admin turns it on.

- **E3 — When a pin contradicts a rule, the pin wins, and the conflict is shown.** A
  non-blocking amber notice, never a refusal. Frank: «gana el pin, pero sigue mostrando el
  aviso acerca del conflicto, no es algo que bloquea». One collision is *guaranteed*, not
  hypothetical: availability compiles to a hard `!in week n` rule while the picker lets an
  admin seat that same person anyway.

- **E6 — One «Borrar» button with a menu**, at two scopes across the categories Auto and the
  instrument filler can rebuild. FOH is never cleared in bulk: nothing refills it, so
  clearing it is guaranteed rework.

- **E7 — Auto and the clears stay where Auto already lives: create mode.** This delivery
  does not move that gate, and nothing in it reads or writes a stored role document, so no
  published service can be touched by construction rather than by a check.

## 4. Conflicts: named on the board, never blocking

Computed on the client when the person is seated, except the last, which the solver reports.
Five cases; a sixth was dropped in review and is kept in the table struck through, so nobody
re-adds it:

| Case | Copy | Who renders it |
|---|---|---|
| The person marked that date unavailable | ⚠ Nombre: marcó que no puede este día — **+ «se va a respetar tu decisión» only while the switch is on** | **New.** Nothing renders this today — see below. |
| A hard rule separates them from someone else in that service | ⚠ Nombre y Otro: una regla los separa — same conditional clause | The existing violation marker, `ruleViolationsForColumn` |
| They are not in the pool that role draws from | ⚠ Nombre: no está en el pool de Lead — same conditional clause | **New** |
| ~~More people are pinned in the row than it has seats~~ | — | **Dropped.** the solver spec's §5.1 grows the row, so nothing is lost and there is no conflict to name; the grid already paints the over-target `+N` amber for that cell (`hasTarget`, `plannerModel.ts:391-395`). Two ambers for one fact is worse than one. |
| The same person is pinned twice in one service | ⚠ Nombre está fijado dos veces en este servicio — solo se respeta el primero | **New**, and §4 says why it should be unreachable |
| A rule had to be set aside to honour the pins | ⚠ Se dejó de aplicar una regla en la semana 3 para respetar lo que fijaste: «any_of(Hugo, Jakey) on Sun.BGV each_week» — the week phrase is omitted for a month-scoped count rule | **New**, and it is **reported by the solver**, not guessed by the client — one line per entry in `pin_violations` (§5.2) |

**The guarantee clause is conditional, and getting that wrong would be the worst bug in this
delivery.** «Se va a respetar tu decisión» is only true while «Solo llenar vacíos» is on — and
E2 makes the switch **off by default**. With it off, `applySolveResponse` replaces the cell
wholesale (`plannerModel.ts:929-936`) and the Auto dialog says so itself («Esto reemplazará
toda asignación de voz…», `PlannerGrid.tsx:2035-2040`). A notice that promises otherwise would
let an admin seat an unavailable member, read that their decision is safe, press Auto, and
watch the person vanish — **on the default path, from a signal this delivery invents.** §5's
own words: "A label that promised more than it does is a defect this repo keeps recording."

So each notice splits in two. The **fact** renders unconditionally — «marcó que no puede este
día», «una regla los separa», «no está en el pool de Lead» — because it is true either way and
it is what the requirement asked for. The **guarantee clause** is appended only when the switch
is on. §9 asserts both renderings of the same cell.

That makes the conflict notices a **fourth consumer of the switch state**, alongside the three
§5 names. The switch is therefore owned by `MonthGenerator` and threaded to `PlannerGrid` as a
prop, not held locally — §5 says the same thing for the other reason.

**The availability notice is genuinely new, and it is the one the requirement named.** It
does not exist today in any form: `blockingReasons` reads `PersonRestriction.weekExclusions`,
which are admin-authored rules (`ruleEnforcement.ts:372-383`), while member-declared
availability lives in `member.unavailableDates` and only becomes a DSL string inside
`buildSolveRequest` (`plannerModel.ts:796-806`). The two never meet, and the cell card
renders no availability line at all (`PlannerGrid.tsx:2861-2891`). Assuming the existing
amber covered it would have shipped E3's *guaranteed* collision silent.

**The notice names the week when there is one.** Per-week families (presence, pair,
consecutive, and the two builtins) carry it in the entry; a DSL count rule is month-scoped and
carries none, so its copy omits the phrase rather than inventing a week. «En la semana 3» is
what stops an admin reading a one-week waiver as a month-long repeal — the distinction the solver spec's §5.2
exists to preserve.

**A second form, for when no pin caused it.** `soft = bool(pin_set)` is model-wide, so with
one pin anywhere a month that today fails on an unsatisfiable authored rule instead comes back
with that rule in `pin_violations` — and «para respetar lo que fijaste» would blame a pin that
caused nothing. When the relaxed constraint's instance contains **no pin at all**, the copy is
«No se pudo aplicar esta regla en la semana 3», with no mention of pinning. The client can tell
the two apart: it sent the pins, and the entry carries its week.

**The rule-set-aside notice is the solver's, and that is the point.** An earlier draft had
the client predict which rule a pin would clash with, from the rules it could see. It cannot
see enough — a pair rule and a count cap are model constraints, and three review rounds each
found another case the prediction missed (the solver spec §5.2). Now the solver reports what it actually
relaxed and the client renders that list verbatim. A rule form added later needs no client
change to be named correctly — **provided it is built on a violation boolean**, and that
qualifier is the completeness boundary. A pin also sets aside `!in <pattern>` forbidden-role
rules and pool membership by *granting candidacy* (the solver spec §5.1), and scopes off `!in week N` for its
own row (§5.2 there); none of those produce a `pin_violations` entry. Nothing is lost today — the
existing `blockingReasons` markers cover both (`ruleEnforcement.ts:346-412`) — but a future
rule enforced by filtering candidates rather than by a constraint stays silent unless it is
given a boolean too.

**No notice for the two built-in requirements.** The dedicated-Saturday-lead anchor and the
mandatory lead are built into the solver rather than authored, so there is no rule to name in
the copy. **And the solver cannot name them the way an authored rule names itself:** it works
in 1-based week indices and has no calendar at all (`build_slots:547-562`), so it can produce
no «13 sep». They therefore reach `pin_violations` as machine markers — `builtin:mandatory_lead:W3:Sun`,
`builtin:sat_anchor:W3` — which the client is the only thing that can turn into a date, and
which §4 renders as «Se dejó abierto el lugar de líder del 13 sep» rather than as a rule name.

**That is a new date-formatting site, so it takes the house rule.** Week index → the Sunday (or
Saturday) date from `sundayDatesFull` → a label parsed at local noon,
`new Date(iso.slice(0,10) + "T12:00:00")`, never a bare `new Date(iso)`. CLAUDE.md's timezone
invariant, and it is named here because the marker format invites a fresh parse.
**A marker whose week has no column on screen** — the admin deselected that Sunday — renders
with the week number instead of a date («la semana 3»), because there is no column to name and
inventing a date the admin cannot see is worse than the ordinal.

An authored rule's entry is its `source` string and the client renders it verbatim; a builtin's
is a marker the client localises. That split is the whole reason `pin_violations` carries
strings with a prefix rather than free text, and §9 asserts a client that meets an
**unknown** `builtin:` marker renders a generic line instead of the raw token. Setting either aside is silent — with one exception that carries the signal anyway:
a lead seat skipped under the solver spec's §5.2 is reported through `unfilled_seats` and renders as «Sin
cubrir» on the cell, which is the planner's existing language for a seat nobody filled.
Inventing a name for a rule the admin cannot see or edit would be worse than the silence.

**No consecutive-rule notice.** The rules panel cannot author a `!consecutive` clause
(`restrictionToDs`, `plannerModel.ts:572-599`), so a notice for it would be unreachable code
describing a rule no admin can create. the solver spec's §5.2 still makes the constraint soft, because the DSL
parser accepts the form and a hand-edited document could carry one — and if one ever does,
the solver names it in `pin_violations` without any client change.

Where an existing marker already renders the fact, these notices **are** that marker; only
the four marked "New" add a line of their own.


## 5. The switch and the «Borrar» menu

**The switch.** A `Switch` labelled «Solo llenar vacíos» beside the Auto button, off by
default, explained in one line: «Auto respeta lo que ya está puesto y solo llena los lugares
vacíos.» Component state, not persisted — a per-run choice.

**The menu.** One `Button` labelled «Borrar» opening a `Menu`, with a live count on every
item so the admin sees what they are about to lose:

- **Este servicio** — Voces · Instrumentos · Voces e instrumentos
- **Todo el mes** — Voces del mes · **Instrumentos del mes** · Voces e instrumentos del mes

The month scope mirrors the service scope item for item. An earlier draft dropped
«Instrumentos del mes» for no reason anyone could state, which is exactly the asymmetry «cada
nivel de granularidad» rules out. **FOH is the one thing no item clears, at either scope** —
E6, and the menu says so rather than leaving a reader to find the gap.

The same menu appears in each column's header with the scope fixed to that service. Only the
month-level items confirm, through `CueDialog`, naming the count, saying FOH is preserved,
saying nothing is written until «Crear N borradores», and separately counting how many of
the discarded seats were placed by hand — a figure that is **approximate in both directions,
and the dialog's wording must not promise otherwise**. It over-reports because the solver spec's §5.3 keeps a
cell's `origin` when it holds any pinned occupant, so the solver's own picks inside a cell the
admin started count as hand-placed. It also **under-reports**: `withAutoCell` stamps
`origin: "auto"` on a cell a human partly filled (`localFill.ts:211-221`, and its own comment
says so), so a special's Lead seat the admin seeded and the filler then topped up reads as
zero hand-placed. The count is a hint about scale, not a guarantee, and the copy says
«aproximadamente» rather than asserting a number. **A service-level clear is immediate, and «volver a correr Auto» is NOT the undo.** An earlier
draft said it was. It is not: `applySolveResponse` rebuilds `occupants` from the solver's answer
with no memory of what the cell held (`plannerModel.ts:929-936`), and with the switch on a
cleared cell contributes no pins, so it comes back filled with whoever the solver picks — not
with the people the admin had placed. There is no undo stack anywhere in the planner. One menu
click would therefore destroy a whole service's hand-placed voice **and instrument** picks
irrecoverably, which is the exact loss E1 exists to prevent.

So the service scope gets a real affordance rather than a dialog: the clear raises a `useToast`
with its documented `action` («Deshacer») holding the previous `cells` array, which restores it
verbatim. That array is already in hand at the call site — `handleAuto` passes the same value
as `previousCells` (`MonthGenerator.tsx:3072`) — so this is a closure, not new bookkeeping. A
toast is the right weight here: a confirmation dialog on every single-service clear would make
the common action tedious, and the month scope already confirms because it cannot be shrugged
off. §9 asserts the restore returns the exact prior array.

**Specials are in «Todo el mes», and their un-refillable rows are not.** E6's principle is
that clearing what nothing refills is guaranteed rework, and two rows on a special column meet
that description: its **Coro**, which `fillColumn` never touches (`AUTO_FILL_ROW_IDS = ["lead",
"bgv"]`, `localFill.ts:79`), and **every instrument cell**, since `fillInstruments` iterates
weekend columns only (`instrumentFill.ts:117`). So a month-level clear empties a special's Lead
and BGV — which the local filler does rebuild — and leaves its Coro, instruments and FOH alone.
Stated rather than left to the reader, because «Todo el mes» reads like "everything" and E6
already committed to not clearing what will not come back.

No item is called «Todo», because none of them clears everything: FOH always survives (E6).
A label that promised more than it does is a defect this repo keeps recording.

**A clear routes through `handleCellsChange`.** Create mode derives `drafts` there
(`MonthGenerator.tsx:2467-2487`); a clear that called `setCells` directly would empty the
grid while «Crear N borradores» still posted the people just removed. The same pass drops any `unfilled` marker on a cell that **just went from occupied to empty** —
which would otherwise outlive the seat it described —
and that is **new behaviour in a shared handler**: `handleCellsChange` does not touch
`unfilled` today, and every manual edit routes through it. Dropping a marker whose cell was
just emptied is right for every caller, not only for the clears, so it ships here rather
than in a separate delivery — but it is called out because the blast radius is wider than
the feature that motivates it, and §9 covers the manual-edit path as well as the clear.

**Keyed on the TRANSITION, never on the state, and the difference is the whole signal.**
`handleCellsChange` receives the entire `next` array (`MonthGenerator.tsx:2466`), so the
natural-looking implementation — "drop the markers of every empty cell in `next`" — is wrong in
a way nothing would catch: a seat that was **never** filled because nobody was available also
reads as empty, so the first unrelated manual edit anywhere in the grid would wipe every
short-staffing marker and zero «Lugares sin cubrir (faltó gente)» (`PlannerGrid.tsx:2096`). The
pass therefore diffs `next` against `cells`, which the handler already holds, and drops a marker
only where a cell **had** occupants and now has none. §9 carries the discriminating assertion:
a legitimately unfilled cell keeps its markers across an unrelated manual edit in another
column.

**And it makes the displayed count fall as empty seats rise, which is intended.** `unfilled`
is one entry per missing SLOT, so a Coro cell holding one of three carries two markers.
Emptying that cell by hand drops both, and «Lugares sin cubrir (faltó gente)»
(`PlannerGrid.tsx:2096`) counts down while three seats are now empty. That is correct for
what the label says — those seats are empty because a human emptied them, not because
nobody was available — but it looks like a bug to anyone reading the number alone, so §9
asserts it deliberately rather than leaving it to be "fixed" later.

**Skipped columns are pinned like any other.** Auto deliberately ignores `skippedColumnIds`
(`MonthGenerator.tsx:2940-2945`); cells sitting on a skipped column are still occupied, so
the switch pins them. Intended, and stated because the alternative reading is just as
plausible.

**The switch state lives in `MonthGenerator`, not in `PlannerGrid`.** The control renders
beside the Auto button (`PlannerGrid.tsx:1996-2000`), but all three consumers are in the
parent — `buildSolveRequest`, §7's handshake, and the `fillInstruments` call inside
`applySpecialFill`. So the state is owned by `MonthGenerator` and passed down with its setter,
rather than held locally and threaded back. Stated because the natural place to put a `Switch`
is next to the button it modifies, and one consumer left reading a stale local copy silently
unfreezes the instruments — the E1 half with no visible symptom until someone diffs two Autos.

**Both sentences of the Auto confirmation change, not just the voice one.** The dialog also
says «Las asignaciones manuales de instrumentos y FOH no se tocan» (`PlannerGrid.tsx:2033-2038`),
which under the switch understates the guarantee: no instrument assignment is touched, manual
or not (E1). With the switch off that sentence stays exactly as it is.

**The Auto confirmation copy changes with the switch.** Today it reads «Esto reemplazará
toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en este mes»
(`PlannerGrid.tsx:2035-2040`), which becomes false the moment the switch is on. With it on
the dialog says Auto will fill only the empty seats, and names how many.

**Naming.** Not «Limpiar mes», which already means deleting stored services from Sanity
(`clearMonthModel.ts`). «Borrar» here empties seats on the board and writes nothing by
itself.


## 6. Where Auto and the clears are available

Create mode only, which is where Auto already lives (`PlannerGrid.tsx:1997`). Both act on grid
state alone: a create-mode column has no stored document behind it, so nothing in this delivery
can reach a service the team has already seen. Nothing reaches Sanity until the existing «Crear
N borradores» runs, unchanged.

**That safety rests on a RENDER GATE, and it could be got wrong.** `handleCellsChange` runs
`setTouchedStoredRoleIds(...)` *and* `setCells(next)` **before** its stored-mode early return
(`MonthGenerator.tsx:2467-2483`). So a «Borrar» control rendered without a `mode === "create"`
guard would not be inert in stored mode — it would stage emptied seats on real service
documents and mark their roles touched for the next Save. The switch is the same shape. §9
therefore asserts that neither the switch nor the «Borrar» menu renders in stored mode, rather
than trusting a property that is only true because of where the controls are placed.


## 7. The version handshake

`solve_from_dict` reads with `data.get(...)`, so a solver that predates this change accepts
a request carrying `pinned` and **ignores it silently**, returning a full roster that
overwrites the very seats the switch promised to keep. The solver and the app deploy through
different pipelines from the same merge — Cloud Build for `gcf/`, Vercel for the app — so
this state exists in the window between them, and again on any rollback of one but not the
other.

`SolveResponse` gains `pinned_honored?: number`, the count of pin constraints the solver
added — **counted after the solver's own dedup and refusals**, so the client's post-dedup pin
count (the solver spec §4) and this number are the same by definition rather than by two independent dedup
implementations happening to agree. When the switch is on and pins were sent, the client **refuses to apply the voice
roster** unless both hold:

1. `pinned_honored` equals the number of pins sent, and
2. every pin appears in the returned roster for its own week and role.

The second check is free — the client already holds the response — and is strictly stronger
than the count, which cannot distinguish "honoured mine" from "honoured that many".

**With the switch on and ZERO pins sent** — an empty board — there is nothing to honour and
the handshake does not run. An old solver's response has no `pinned_honored` at all, and
`undefined === 0` is false, so a naive equality check would refuse the first Auto of every
month. The condition is "pins were sent AND a check fails"; §9 asserts the empty-board case
explicitly.

On failure it reports «El solver no respetó los lugares fijados; no se aplicó nada». Refusing is
correct here even though §4 never blocks: §4 is about the admin's own contradictions, this is
about a solver that did not do what it was asked.

**The refusal is an exit of `handleAuto` and obeys that function's contract.** Every exit
calls `applySpecialFill` exactly once, which owns `setCells`/`setUnfilled`/`setDrafts` and
runs the specials and instrument fillers (`MonthGenerator.tsx:2954-2999`). The refusal exit
does the same: the solver's voice roster is discarded, the local fillers still run, the error
line carries the message. "Nothing is applied" means the voice roster, not the setters.

**Local development cannot exercise this.** `callLocalSolver` spawns the repo's own
`gcf/owt_solver_v2.py` (`app/api/admin/solve/route.ts:69-108`), which always understands
`pinned`. The refusal path is provable only by the unit test in §9, and that is where it is
required.


## 8. Error handling

- **The pin path needs its own refusal — there is nothing to reuse.** An earlier draft said
  `buildSolveRequest` "already refuses a request naming an unresolvable person"; it does not.
  It *injects* unresolvable DSL names into `support` (`plannerModel.ts:747-768`) and refuses
  only a member with no Tipo, while `memberIdToName` falls back to the raw `_id` (`:569`). A pin
  whose occupant id resolves to no member would therefore travel as an `_id`-shaped name the
  solver has never heard of. The pin path refuses, naming the cell.
- **No solver error text reaches the admin today, and this delivery does not change that.** The
  route answers `422` (`app/api/admin/solve/route.ts:138`) and `handleAuto` parses the body only
  when `res.ok` (`MonthGenerator.tsx:3058-3065`), so `response` is `null` and the admin sees the
  generic «El solver no encontró solución.» Every `ValueError` the solver spec adds is a fast,
  cheap failure rather than a better message — stated so nobody writes copy that depends on it.
  Making `handleAuto` read `error` on the 422 path is a worthwhile separate change and is not
  in this scope.
- The client-mutation invariant is unchanged: the Auto fetch keeps its try/catch/finally, its
  `res.ok` check and its loading-flag reset.
- A clear never fails: it is local state. The service-scope undo toast restores the previous
  `cells` array from a closure, so it cannot fail either.

## 9. Testing

**Client.** `buildSolveRequest` gains the grid inputs it needs — `cells`, `columns` and
`rows` — and derives each pin's week from `weekForColumn(column, sundayDatesFull)`, the
**full** month spine and never the admin's selection, which is the E21 hazard
`applySolveResponse` and `mapUnfilledSeats` both document at length. **A weekend column whose
`weekForColumn` returns `null` contributes no pins** — an unaddressable Saturday
(`computeUnaddressableDates`, `MonthGenerator.tsx:2183`) is a weekend column, so the
special-column filter does not catch it, and a pin with a null week would reach the solver's
range check as a `ValueError` that fails the whole month over a column nobody can fill anyway.
Asserted, because the filter that looks sufficient is not. It emits one pin **per occupant**
of each voice cell on a weekend column when the switch is on — a Coro cell holding three
people emits three pins, matching the solver spec's §4 one-per-person-per-role-per-week contract — none when
the switch is off, and none from a special column; it deduplicates by person-and-service and
reports the duplicate. The four new conflict notices render — the
availability one especially, since nothing renders it today — and none disables Auto or save.
The §7 refusal discards the voice roster, still runs the local fillers, and shows the
message. **A cell holding a pinned occupant keeps its `origin`, its `overrides` and its
`overrideReasons`** — the discriminating case is a waived pair rule: waive «Frank !with Gaby»
on a weekend Lead cell, run Auto with the switch on, and assert the marker still reads «regla
anulada» (`overridden: true`) rather than turning red, and that the partner does not flag
either. Assert too that a waiver for someone the solver did NOT return is pruned, and that a
cleared cell keeps no waivers at all. The clears route through
`handleCellsChange`, empty exactly the rows their item names, never FOH, and drop the stale
`unfilled` markers — asserted for a manual edit too, not only for a clear, since the handler
is shared, **and keyed on the transition**: a cell with markers that was already empty keeps
them across an unrelated manual edit in another column — the assertion that separates the
transition reading from the state reading, and the only thing standing between «Lugares sin
cubrir» and being silently zeroed. The service-level clear raises a toast whose «Deshacer»
restores the exact prior `cells` array. Each conflict notice renders its **fact** with the
switch off and its fact **plus** «se va a respetar tu decisión» with the switch on — asserted
on the same cell, both ways, since the default is off. The new marker-dropping pass sits
**after** `handleCellsChange`'s stored-mode early
return (`MonthGenerator.tsx:2480-2483`) — create mode only, matching D-scope — and a test
covers a stored-mode call to prove the handler is untouched there. «Todo el mes» counts every
column of the preview, specials included, per §5.

**Instruments are frozen by the switch (E1).** With the switch on, two consecutive Autos
leave every `origin: "auto"` instrument cell byte-identical; with it off, the second Auto
re-rolls them exactly as it does today. This is the guard for the one-line vacate gate, and
it is the assertion that would have caught the claim the combined spec's §14 used to make.

**Gates.** `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors. The python gate that
the solver half adds is already green on `main` by the time this half merges — that is the
ordering §0 requires, not an extra step here.

**Then the fresh code review of the diff**, which is the layer this half is deliberately
spending its budget on. CLAUDE.md's order: implement → gates green → fresh code review on the
merge range → fix → re-verify the fix → merge.

## 10. Documentation in the same delivery

`docs/MONTH_GRID_EDITING.md` — the switch, the menu, the confirmation copy, the undo toast, and
the rule that a pinned cell keeps its waivers. No new secret or env var, so `docs/SECRETS.md` is
untouched; `docs/SOLVER_AND_INFRA.md` and `docs/CI.md` are the solver half's.

## 11. Out of scope

**The solver contract** — the `pinned` field, the fixed-variable mechanism, the soft-relaxation
objective, `pin_violations`, `pinned_honored`, the CI python gate and the solver's rollout — is
`2026-09-15-solver-pinned-assignments-design.md`.

**Auto and the clears on already-created draft services**, deferred to their own delivery: it
needs a stored-mode request builder (the weeks and Saturdays a stored month actually has, not
the create-mode calendar state), a column mapping in both directions (stored columns are keyed
by the Sanity `_id` at `storedRoleReadModel.ts:113` while `mapUnfilledSeats` emits a `create:`
prefix), and a decision about what a clear means on a service the team has already seen.
