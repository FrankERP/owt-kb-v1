# Design — Participation sidebar in the Servicios panel

Date: 2026-06-30
Status: Approved (pending adversarial review)

## Summary

A read-only left sidebar in the admin Servicios panel that shows, per team member,
how many times and in what roles they serve over the **currently filtered** period.
It recomputes live from the panel's existing `roles` state, so it updates as the
admin creates/edits/publishes/swaps services. Goal: at-a-glance load balancing.

## Metrics (per member)

Computed over the **visible** (month-filtered) services. Two unit families:

- **Voz appearances** — counted **per service**:
  - `sunLead` (Sunday Lead), `satLead` (Saturday Lead)
  - `sunBGV` (Sunday BGV), `satBGV` (Saturday BGV)
  - `coro` (Sunday Choir; Saturday has no choir)
  - **`total` = sunLead + satLead + sunBGV + satBGV + coro** (the prominent number).
- **Weeks** — counted **per week** (a Saturday + Sunday of the same week count once):
  - `instrWeeks` — distinct weeks the member plays an instrument
  - `fohWeeks` — distinct weeks the member is on FOH (sonido)

**Week key (verified against live data):** a Saturday service and its Sunday do NOT
share a date — the Saturday is stored one day BEFORE its Sunday (e.g. Sun
`2026-07-26` / Sat `2026-07-25`; Sun `2026-07-12` / Sat `2026-07-11`). So to group a
weekend, normalize each Saturday to its Sunday:
`weekKey(role) = role._type === "saturday_role" ? plusOneDay(role.date) : role.date`.
"Distinct weeks" for instruments/FOH = the count of distinct `weekKey` among the
member's instrument/FOH assignments. (A member playing instruments on BOTH the Sat
and the Sun of one weekend → both map to the same Sunday `weekKey` → counts as 1.)
`plusOneDay` parses `YYYY-MM-DD` at noon to avoid DST/timezone drift, like the
existing `subtractDay` helper.

**Scope decision — `special_role` excluded (v1):** the metrics are Sunday/Saturday
by definition and special services are irregular one-offs. The sidebar aggregates
`sunday_role` + `saturday_role` only. (Flag for review: include specials in `total`
+ weeks if desired — a small follow-up. Default: exclude.)

## Core logic (pure, unit-tested)

```
computeParticipation(roles, members) -> MemberParticipation[]
```

- `MemberParticipation = { id, name, sunLead, satLead, sunBGV, satBGV, coro, total, instrWeeks, fohWeeks }`
- Iterate `roles` (skip `special_role`). For each member id found in `leads`/`bgvs`/
  `chorus`, increment the matching Sun/Sat column. For `instruments[].person` /
  `foh[].person`, add **`weekKey(role)`** (Saturday normalized to its Sunday — see
  above) to that member's instrument/FOH week-set.
- `total` = the five voz columns. `instrWeeks`/`fohWeeks` = week-set sizes.
- `name` = `alias || member_name` (the existing `dn()` convention).
- Return only members with any participation (`total>0 || instrWeeks>0 || fohWeeks>0`),
  sorted by `total` desc (UI can re-sort). Members with zero are omitted (a small
  "N sin participación" footnote may note how many were hidden).
- Pure: no I/O, no React. Lives in `app/utils/computeParticipation.ts`.

Tests (vitest): Sun vs Sat column routing; `total` = sum of voz columns; instrument
played on the Saturday (`2026-07-25`) AND the Sunday (`2026-07-26`) of ONE weekend
counts as `instrWeeks: 1` — the saturday normalizes to its sunday weekKey (the key
dedup, and the case the audit got wrong); instruments on two *different* weekends = 2;
`special_role` ignored; zero-participation member omitted; sorted by total desc.

## UI

New component `app/components/admin/ParticipationSidebar.tsx`:
- Props: `roles: ServiceRole[]` (the panel's already-filtered `visible` list),
  `members: MemberOption[]`, `monthLabel: string` (header context, e.g. "Julio 2026"
  or "Próximos").
- Calls `computeParticipation(roles, members)` inside a `useMemo`.
- Header: "Participaciones" + the month label + a small sort `<select>` (Total
  default; or by a single role column). A color legend (Líder/BGV/Coro/Instr/FOH).
- One row per member: name; the **`total`** as the prominent number; a horizontal
  **segmented bar** (length ∝ total, segments colored by the voz mix
  Líder/BGV/Coro) for at-a-glance magnitude + mix; the exact counts line
  `L {sunLead}·{satLead}  B {sunBGV}·{satBGV}  C {coro}`; and **separate badges**
  `Instr {instrWeeks} sem · FOH {fohWeeks} sem` (kept out of the voz total/bar since
  they're a different unit).
- Read-only — no mutations, no API calls. Admin-only by virtue of living in the
  admin panel.

Wiring in `ServicesPanel.tsx`:
- Wrap the preview content so the cards grid and the sidebar sit side-by-side on
  large screens: an outer `lg:grid-cols-[320px_1fr] gap-6` (sidebar first =
  left). Below `lg`, single column with the sidebar collapsing above the cards
  (or a simple toggle) — must not break the existing responsive card grid.
- Pass the existing `visible` filtered roles + `members` + a derived month label.
- Theme: match the panel's cyan/blue styling; role colors Líder=blue, BGV=teal,
  Coro=purple, Instr=amber, FOH=gray.

## Testing

- Vitest for `computeParticipation` (the cases above).
- Manual: open Servicios, change the month filter → sidebar totals follow; create/
  publish/swap a service → counts update live; verify an instrumentalist on Sat+Sun
  of one week shows `Instr 1 sem`; verify sort options.

## Non-goals
- Editing/assigning from the sidebar (read-only).
- Historical/all-time totals (follows the current filter only; the solver already
  has its own history mechanism).
- Counting `special_role` (v1; see scope decision).
- Fairness scoring / recommendations (just the raw counts).
- Mobile-specific redesign beyond collapsing the column.

## Risks / mitigations
- **Week-dedup correctness for instruments/FOH** — the one subtle rule. Saturday is
  stored one day before its Sunday (verified in live data), so the helper normalizes
  Saturday → its Sunday `weekKey` before deduping. Covered by a dedicated unit test
  (instrument on Sat `2026-07-25` + Sun `2026-07-26` = `instrWeeks: 1`).
- **Layout regressing the existing card grid** — the change is an outer grid wrapper;
  verify the cards' responsive `grid-cols` still works inside the right column.
- **Data shape drift** — `computeParticipation` reads only `_type`, `date`, and the
  member-id arrays/refs; mirror the `ServiceRole` shape exactly.
