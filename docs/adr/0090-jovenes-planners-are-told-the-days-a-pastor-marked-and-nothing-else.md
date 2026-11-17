# ADR-0090: Jóvenes planners are told the days a pastor marked, and nothing else

**Date:** 2026-11-17 · **Status:** Accepted (the leader arm awaits Frank's answer before production)

## Context

Frank, 2026-11-17: «los pastores de jóvenes también deben poder registrar su disponibilidad». They
could already: `/me/disponibilidad` is ministry-neutral and its save takes any member. But a day
nobody building the roster learns of is a day registered for nothing, and Planear Jóvenes read no
availability at all.

`unavailableDates` and `unavailabilityNotes` are ONE calendar per person, shared by every ministry
(ADR-0075). Until now only a ministry's MANAGERS read other people's: worship's admins in `/admin`,
Kids' managers in `/kids/admin`, dates and notes both. In Jóvenes the people who build a roster are
not only admins: a leader plans the classes of the groups they lead (ADR-0085).

## Decision

Planear Jóvenes (`/jovenes/admin`) shows «no disponible» for a person on a meeting's day. It
informs and never refuses.

- **Who is told** — `awayVisibleTo` (`app/utils/jovenesAway.ts`), on the access snapshot the page's
  gate read: a Jóvenes admin, every Jóvenes member; a leader, only the members of a group they
  LEAD (`ledGroupsIn`), which is exactly who they can assign; anyone else and anyone inactive,
  nobody.
- **What crosses** — the date. Never the note, which is not projected by this read at all. Only
  days from today to a year out.
- **How** — `readJovenesPeople({ awayFor, today })` (`app/utils/jovenesPeople.ts`). Bare, the
  function is what it was: one query with no availability field, so the three member pages that
  call it (`/jovenes`, `/jovenes/calendario`, `/jovenes/reunion/[token]`) cannot receive a day.
  With the option, the same people query runs, the visible ids are computed in TypeScript, and a
  second query reads the days of those ids only. `away` is set only on a person with at least one
  real day; for everyone else the key is absent, so «not told» and «marked nothing» look alike.
  Guard: `jovenesAwayCoverage.test.ts` (only the read and the planner page name `awayFor`; no file
  of the Jóvenes tree names the fields but the read, dates only).
- **Where it shows** — `PersonSelect` given the meeting's `date` («Ana · no disponible» in the
  list, «No disponible ese día.» once picked); `AwayNote` on a Saturday card for an admin and on a
  class row. Never in «Copiar para WhatsApp».
- **The person is told** — `/me/disponibilidad` says «Quien planea en Jóvenes ve estos días, sin
  tu nota.» to a Jóvenes member.

Plan and review log: `docs/superpowers/plans/2026-11-17-jovenes-away-in-planner.md` (two fresh
approvals on one digest) and its `-review-log.md`, which lists what was decided after approval.

## Rejected

- **A second availability calendar under `/jovenes`.** Two calendars are two writers racing into
  two fields with one meaning; `useAvailability` is the only client writer on purpose.
- **Showing the note.** It is free text written for other eyes («cita médica»). The planner needs
  the day, not the reason.
- **Every pastor sees everyone's days** (on the cards of `/jovenes`). Most pastors assign nobody;
  for them it is exposure without use. The same reason keeps the line off a leader's read-only
  Saturday cards.
- **Refusing the assignment on the server.** A marked day is a statement, not a lock; worship's
  planner does not refuse either, and the person may have agreed to come.
- **One query with every member's days, filtered afterwards.** The server would load days the
  reader may not see. Reading the visible ids only costs one round trip to Europe.
- **The group rule in GROQ.** Membership of a group has one definition, `normalizeMinistryRoles`
  (ADR-0085); a GROQ copy would be a second.
- **Saying who marked it** («Marcó este día…»). A Kids manager can record a day for a volunteer
  (`kidsCommit.ts`), so the sentence would sometimes be false.

## Consequences

- This decides what the APP sends and shows. It is not a confidentiality boundary on the field:
  `teamMembers` is undotted in a public dataset until DEF-A-16 (ADR-0057, ADR-0081).
- A leader is the first non-manager who sees anyone's availability, and the days shown first were
  marked before this existed (on 2026-11-17, four people, all in Alabanza and Jóvenes). Frank was
  asked who the audience should be; until he answers, the leader arm does not go to production
  (PR #249 carries it as an open blocker, and no auto-merge is armed on it). If he chooses admins
  only, `awayVisibleTo` ends at the manager check (`return isMinistryManager(…)`), the leader
  cases of `jovenesAway.test.ts` and `jovenesPeople.test.ts` flip to «nobody», and the sentences
  that name the leader here, in CLAUDE.md/AGENTS.md §Auth and in `docs/ROUTES.md` are reworded.
  No read, component or stored field changes.
- One calendar: a pastor who blocks a day with Alabanza in mind reads «no disponible» in Jóvenes
  too. There is no «out for one ministry only».
- In the program editor outside Planear (`/jovenes`, the Calendario, a meeting's page) nobody gets
  marks, an admin included: there «no mark» does not mean «available». Widening that to a
  meeting's encargado is a new audience decision, not a prop.
- «Cambiar con…», «Recorrer» and «Nuevo libro» show no mark in their previews; the card's line
  says it after the save.
- Undoing the bare/opt-in split (projecting `away` in the one query) sends every pastor's days to
  any pastor who is a meeting's encargado. `jovenesPeople.test.ts` fails first (its bare case
  refuses any `unavailab…` token in the one query); the source scan would not, since that file may
  name the dates.
