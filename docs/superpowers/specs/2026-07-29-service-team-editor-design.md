# Service team editor — Tablero (A) + Planificador (C)

**Date:** 2026-07-29
**Status:** approved design, not yet planned
**Replaces:** `ServiceForm` (individual edits) and the preview half of `MonthGenerator`
(solver-driven planning)

---

## 1. Problem

Assigning people to a service happens in `ServiceForm`
([`app/components/admin/ServicesPanel.tsx:249`](../../../app/components/admin/ServicesPanel.tsx)),
rendered in a `size="sm"` sheet. Measured, not estimated:

| Layer | Constraint |
|---|---|
| Modal body | `overflow-y-auto` |
| Form element | `max-h-[70vh] overflow-y-auto` |
| Líderes picker | `max-h-36` → 144 px ≈ **4 rows** |
| BGVs picker | `max-h-36` |
| Coro picker | `max-h-36` |

**Five nested scroll regions in a small sheet.** With 16 `voz` members, each picker shows
4 of 16, and all three read from the *same* 16 people — the roster is scanned three times
through three keyholes.

Three facts the form withholds while a decision is being made:

- **Availability** — conflicts surface only at submit, as a panel that replaces the save buttons.
- **Existing assignment** — nothing indicates a person is already in another seat on this
  service. `DayCard` runs duplicate-detection downstream, which is evidence this happens.
- **Recent load** — no signal about who served last week.

And one defect the form has already caused: instrument names are a free-text `<input>`, so
production holds **seven spellings of five instruments** — `Drums`, `Drums ` (trailing
space), `Bass`, `BASS`, `Keys`, `EG`, `AG`.

### The structural problem

Two tools exist for one job, and neither can call the other. `MonthGenerator` is month-wide,
constraint-rich and all-or-nothing; `ServiceForm` is one service, manual and context-free.

---

## 2. What the solver can actually do

Verified in [`gcf/owt_solver_v2.py`](../../../gcf/owt_solver_v2.py) — both limits are load-bearing
for this design:

```python
ROLE_ORDER = ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"]   # :37
if not 3 <= config.weeks <= 6: raise ValueError(...)                       # :449
```

1. **Voices only.** No concept of instruments or FOH (zero matches for `bass`, `drums`,
   `keys`, `console` in the whole file). This is why "copiar instrumentos a otro día" exists:
   instruments have always been managed by hand.
2. **3–6 weeks.** A single service is not a valid input, so no per-service view can call it.

The solver's unit of work is therefore *3–6 weeks of voice assignments*. That maps onto a
month grid and never mapped onto a one-service modal.

---

## 3. Decisions

| # | Decision |
|---|---|
| D1 | **A · Tablero** replaces `ServiceForm` for creating/editing one service. |
| D2 | **C · Planificador** owns solver-driven planning, absorbing `MonthGenerator`'s preview. |
| D3 | The roster tag for "already in another seat on this service" reads **`Ya asignado`** — reusing the app's existing word (`13 asignados`, `Todavía no hay nadie asignado`, `assignedMemberRefsQuery`) rather than introducing a second vocabulary. |
| D4 | **Double duty:** `voz` + `instrumento` is allowed (Frank and Mkz do it today). Two seats in the *same* category is blocked — Lead+BGV, or two instruments. |
| D5 | A's assist is **ranked candidates**, computed locally. It does **not** call the solver. |
| D6 | Instrument and FOH seat names come from a **canonical list**, never free text. |

### Division of labour

| | A · Tablero | C · Planificador |
|---|---|---|
| Unit | one service | 3–6 weeks |
| Voices | manual + ranked candidates | **Auto** = the solver |
| Instruments / FOH | manual + ranked candidates | manual + copy across dates |

---

## 4. A · Tablero

Two panes, **one** scroll region (the roster). Replaces the sheet with a `wide` dialog.

```
┌───────────────────────────────┬──────────────────────┐
│ Domingo 9 ago                 │ Voces · 16  → Lead   │
│                               │ ┌──────────────────┐ │
│ VOCES                         │ │ Buscar...        │ │
│ [Lead │ Frank × Marianne ×]   │ ├──────────────────┤ │
│ [BGV  │ Gaby × Jakey × +BGV]  │ │ Andy      ▮▯▯▮ 2 │ │  ← the one
│ [Coro │ Lali ♡ × +Coro]       │ │ Gaby      ▯▮▮▯ 2 │ │    scroll
│                               │ │ Liu  no disp.    │ │
│ INSTRUMENTOS                  │ │ Frank ya asignado│ │
│ [Bass │ Mkz ×] [Keys │ +]     │ └──────────────────┘ │
│ [Drums│ Samo ×] [EG │ Frank ×]│                      │
│ FOH                           │                      │
│ [Console │ +]                 │                      │
└───────────────────────────────┴──────────────────────┘
```

**Interaction.** Click a seat to target it (the roster switches to that seat's eligible pool
and its header names the target). Click a person to seat them; click again to remove. Click
the `×` on a chip to clear that seat.

**Every roster row carries three signals**, so the decision is informed before it is made:

- `no disp.` — the member marked this date unavailable. Still selectable (an admin may
  knowingly override), but never silent.
- `ya asignado` — already in another seat on this service. Informational for a legal
  cross-category pick (D4); **blocking**, with the reason, for a same-category one.
- **Load strip** — the last 4 service weeks as four cells, plus a count. This is the
  fairness signal the current form has no room for.

**Ranked order (D5).** The roster sorts by: available that date → not already assigned →
lowest recent load → name. No Cloud Run call; it is a pure sort over data the panel already
holds. Presented as suggestions; it never auto-fills without a click.

### Seat model (D6)

Seats become a declared list per service type instead of arbitrary free-text rows:

- Voices: `Lead`, `BGV`, `Coro` (multi-occupant, with a soft max).
- Instruments: `Bass`, `Keys`, `Drums`, `EG`, `AG` (one occupant each).
- FOH: `Console`.

The list is **extensible** — an admin can add a seat name — but entry is a picklist with
`trim` + case normalisation, so `Drums ` and `BASS` can no longer be created. The canonical
list is seeded from the distinct values already in production.

---

## 5. C · Planificador

One grid: dates across, seats down. Replaces `MonthGenerator`'s draft-card preview; the
config step (pools + the `Reglas` rule builder) is **kept as-is** and feeds it.

```
              dom 2    sáb 8    dom 9    sáb 15   dom 16
  LEAD        Frank ●  Tay      Marianne●Pau E    Hugo
  BGV         Andy     Vale     Jakey    Rachel   Marianne
  CORO        Hugo     Gaby     Niza     Andy     Lali ♡ ●
  ─────────── solver boundary ──────────────────────────
  BASS        Benji    Sofi     Mkz ●    Sofi     Benji
  KEYS        Fanta    Mimí     Benji    Mimí     Fanta
  CONSOLE     Armando  Becca    Armando  Becca    Tay
```

- Any cell is editable by hand. A hand-set cell is **pinned** (`●`) and the solver may not
  move it.
- **Auto** runs the solver over the **voice rows only**, for the 3–6 week window on screen,
  honouring pinned cells. This is the existing `/api/admin/solve` contract unchanged.
- Instrument and FOH rows are filled by hand, with the same ranked candidates as A, plus
  **copy across dates** — the grid-native replacement for today's "copiar instrumentos a
  otro día".
- The grid must **state plainly that Auto covers voices only.** Silently leaving instrument
  rows empty after pressing Auto would read as a solver failure.

---

## 6. Shared modules

New work goes in new files. `ServicesPanel.tsx` is already 2061 lines and
`MonthGenerator.tsx` 1707; neither should absorb this.

| Module | Purpose | Depends on |
|---|---|---|
| `seatModel.ts` | Canonical seat list per service type; category of a seat; `trim`/case normalisation. Pure. | — |
| `candidateRanking.ts` | `rankCandidates({ seat, date, members, roles, assigned })` → ordered rows carrying `available`, `alreadyAssigned`, `load`, and `blockedReason`. Pure. | `computeParticipation`, `seatModel` |
| `SeatBoard.tsx` | A's two-pane editor. Renders what the two pure modules return. | above |
| `PlannerGrid.tsx` | C's grid + Auto. | `seatModel`, `candidateRanking`, `/api/admin/solve` |

`candidateRanking` reuses **`computeParticipation`** for load — it already returns
`sunLead / satLead / sunBGV / satBGV / coro / instrWeeks / fohWeeks` per member. Feed it a
windowed slice of roles; add no new counting logic.

Both surfaces submit through the **existing** role write endpoints. No API changes, and the
readiness model, capability gates and publish flow are untouched.

---

## 7. Invariants to preserve

- **Five member-referencing seats** on role docs: `Lead[]`, `BGVs[]`, `Chorus[]`,
  `instruments[].person`, `foh_team[].person`. Both surfaces must write all five; reuse
  `assignedMemberRefsQuery` for any "who serves" read.
- **`_key` per array-of-object item** on every Sanity write.
- **Timezone**: render dates at local noon (`iso.slice(0,10)+"T12:00:00"`), never bare
  `new Date(iso)`.
- **`saturdarSongs`** stays misspelled.
- Mutating routes call the matching `revalidate*` util.
- Client mutation handlers wrap `fetch` in try/catch/finally, check `res.ok`, reset the
  loading flag, and never close-as-success on failure.
- Capability gating (`gates.editTeam` etc.) applies to every control on both surfaces,
  exactly as the card and form do today.

---

## 8. Data prerequisites

Two live data issues, independent of this work but affecting it:

1. **Seven spellings of five instruments.** A one-off normalisation script
   (`scripts/`, dry-run first, `--apply` guarded) before the picklist ships, or the canonical
   list inherits the mess.
2. **Eight members have no `memberType`** — `Claude`, `Goma`, `Milo`, `Nestor`, `Pato`,
   `Rex`, `Yadhyra`, `Ro Eguiarte`. They appear in **no** picker today and will appear in no
   seat pool tomorrow. Needs a decision per row: real member (assign a type) or test row
   (delete). Not a code change.

---

## 9. Out of scope

- Extending the solver to `weeks=1` (rejected: D5 covers the need without touching a
  working solver).
- Teaching the solver about instruments or FOH.
- Panel B (popover editing on the month card). Viable later for one-off swaps; it was
  rejected as the primary because the popover covers the very card whose context it exists
  to preserve.
- Any change to the setlist editor, proposals, or notifications.

---

## 10. Testing

Pure modules carry the logic, so the important cases are node-environment table tests:

- `seatModel`: normalisation collapses `Drums `/`BASS`; category lookup; unknown seat name.
- `candidateRanking`: unavailable sorts last but stays selectable; `ya asignado` is
  informational across categories and blocking within one (D4); load ordering; a member with
  no `memberType` never enters a pool.
- Grid/board components: assert they render what the pure modules return and gate every
  control — no decision logic of their own.
- Existing suites must stay green: `ServicesPanel` flows, readiness, publish selection.

Done gate is the project's: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.

---

## 11. Sequencing

**Two implementation plans, not one.** A and C are independently shippable and A is the
prerequisite:

1. **Plan 1 — A · Tablero.** Builds `seatModel` + `candidateRanking` (the pure modules C also
   needs) and `SeatBoard`, retires `ServiceForm`. Self-contained: no API change, no solver
   involvement. Ships value on its own.
2. **Plan 2 — C · Planificador.** Builds `PlannerGrid` on those two modules and moves the
   solver into it, retiring `MonthGenerator`'s preview. Larger, touches a working solver.

Doing A first means the shared modules get proven against a small surface before the grid
depends on them, and `MonthGenerator` keeps working untouched in the meantime.

The instrument normalisation script (§8.1) must land **before** Plan 1's picklist.

---

## 12. Open items

- Soft maximum per voice seat (how many BGVs before the board warns) — needs a number from
  Frank.
- Whether C's window follows the month picker or is a free 3–6 week range.
