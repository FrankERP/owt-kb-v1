# Jóvenes meetings: any date, «Lugar», and names without an account

Status: plan, 2026-11-10. Extends `2026-10-30-jovenes-events-access.md` (ADR-0081). Branch
`claude/project-thread-uqw2lr`, built on top of the visual pass (`claude/project-thread-51u1xq`,
PR #234), which must reach `main` first.

## 1. The requirement (Frank, 2026-11-10, verbatim)

> Que se puedan crear en cualquier fecha
> Por qué no pusiste bien la información del estudio de daniel?
> Claramente dice que Ana comparte
> También hay que agregar una nueva columna que diga "Lugar" o "Ubicación" y ahi debe decir Oasis
> Tlalpan o Fam Varela en la posada por ejemplo

Context: his roster (an image) has the columns Encargado · Fecha · Quién comparte · Notas, and the
rows include «EMPRENDEDORES | Viernes 20 de Noviembre | Ana | Estudio "Daniel" - Oasis Tlalpan
8:00 pm» and «Goma | sábado 28 | N/A | Gotcha». Today:

- a seat (`encargado`, `apoyo`, `comparte`) holds only a Jóvenes member with an account
  (`peopleFit`, `ministryEventCommit.ts`), so «Ana» (no account) and «Emprendedores» (a group, as
  the hosts) could only go into Notas;
- the planner offers «Crear» only on a Saturday row (`SaturdayPlanner.tsx`), although the writer
  already accepts any date for a whole-ministry meeting and the table already lists a non-Saturday
  whole-ministry meeting (`saturdayRows`, `jovenesPlannerModel.ts`);
- there is no place field.

Frank also decided (2026-11-10 04:01Z): a meeting a group hosts is still for ALL pastors, so these
stay `audience: { kind: "ministry" }`; nothing here touches who reads a meeting.

## 2. Non-goals

- No change to who reads or who writes (R1–R3, W1–W3a, W9 stand as they are).
- Program lines keep members only (not asked for).
- No MCP writer, no notification.

## 3. The writer slice (critical: it changes `ministryEventCommit.ts`'s payload)

### P1. `place`, a display text

- Body: `place` is an optional ONE-LINE text, trimmed, at most `LIMITS.place = 120` characters;
  absent, `null` or blank ⇒ `null`; not a string, too long, or holding a line break ⇒ 400
  `invalid_place` (a new `EVENT_ERROR` code). Parsed in `parseEdit` like `title` (`optionalText`)
  plus the line-break refusal (a new `optionalLine` helper), because the WhatsApp copy is one line
  per field.
- Create: stored only when non-null (as `title`, `notes`). PATCH: `place` joins `EDITABLE` and the
  set/unset loop (`["date", "time", "arrival", "title", "notes", "place", "published"]`), so
  `null` unsets it and absent leaves it.
- The program route reads only `program` (W4) and never touches `place`.
- Schema: `{ name: "place", title: "Ubicación", type: "string" }` on `ministryEvent` (the Studio
  type is hidden and read-only; no Studio deploy is needed for the app to store it, and the field
  is declared so the Studio shows it). The seat object's titles change from «Lugares»/«Lugar» to
  «Asientos»/«Asiento» (and `seatRoleLabel`'s fallback from «Lugar» to «Asiento»), so «Lugar» means
  only the place.
- G1b: `place` exists on no other type, so it joins `PROTECTED_FIELDS`
  (`app/utils/protectedReadAudit.ts`), as the base contract's rule asks.
- Reader: `place` joins `PROJECTION`; `MinistryEventView.place: string | null` (via `str`).
- Access: none. It is read by whoever may read the event, like `title`.

### P2. A seat may hold a typed name instead of a member

- Body: each seat may carry `name`, an optional one-line text (`optionalLine`), trimmed, at most
  `LIMITS.name = 60`. A seat with BOTH a `member` and a non-null `name` ⇒ 400 `invalid_seats`; a
  `name` that is not a string, too long or holding a line break ⇒ 400 `invalid_seats`. A seat with neither stays allowed (an empty seat, as today).
  `SeatIn` becomes `{ key, role, member, name }`.
- Stored: `seatDoc` writes `name` (a plain string) when present, and no `member`. Schema: the
  `ministryEventSeat` object gains `{ name: "name", title: "Nombre (sin cuenta)", type: "string" }`.
- People (W5): a typed name is NOT a person. `reconcile` keeps deciding `added` from `member` only,
  so a name is never sent to `peopleFit` and never validated against the members list. A seat
  whose key, member (null) and role match the stored one is "kept" as today; its name is written
  from the body either way (arrays are written whole, W2a).
- Program right (W3a): unchanged. `seatGrantsProgram` matches `refOf(s.member) === actor.id`; a
  named seat has no member, so it grants nothing.
- «Mine»: unchanged; decided by `member._ref == $me` in the reader. A named seat is never «Tú».
- Reader: the SEAT projection (seats only; program lines keep `PERSON`) becomes
  `{ _key, role, "memberId": member._ref, "name": coalesce(member->{ "n": coalesce(alias, member_name) }.n, name), "mine": member._ref == $me }`.
  A seat with a member shows the member's live name; a named seat shows its text; a seat whose
  member was deleted (weak, D4) and that has no text still reads `null` («Sin asignar»). The view
  type is unchanged (`memberId: null` + `name` = a typed name).
- Escaping: the text is rendered as React text and copied as plain WhatsApp text; no HTML path.

### P3. What the writer does NOT change

- `resolveKind` (D3): a whole-ministry meeting is `saturday` or `ministry`, the REQUESTED one.
  The client picks it (P5); the writer already accepts either on any date (verified: the 20 Nov
  meeting was created with `kind: "ministry"` on a Friday, 2026-11-10 17:4xZ).
- W6 (create token), W2/W2a (revision), the 404/403 order, W9.

### Compatibility (accepted)

- A page loaded before the deploy reads a named seat as a pick with no member, and the old
  `saturdayBody` SKIPS a pick with no member, so saving that meeting from the stale page DROPS the
  named seat (the PATCH writes `seats` whole). Only Frank (super-admin) can open
  the planner (`rolloutAllows("jovenesEvents")` = `superAdmin`), the window is one stale tab, and
  the loss is one typed word he can retype. Accepted, said aloud.
- Old stored seats have no `name`; they read exactly as before.

## 4. Guards (tests)

- `ministryEventCommit.test.ts`: `place` on create (stored, trimmed; blank ⇒ absent; 121 chars or a
  line break ⇒ 400 `invalid_place`); PATCH sets, unsets with `null`, leaves when absent. Seats: `name` stored
  without `member`; `member` + `name` ⇒ 400; 61 chars ⇒ 400; a named seat never reaches `peopleFit`
  (no member read when only names are added); a named encargado gets no program right (403).
- `ministryEventReads.test.ts` (groq-js): a named seat reads `name` = its text, `memberId` null,
  `mine` false; a member seat still reads the member's alias; `place` reads back.
- The coverage guards (`ministryEventCoverage.test.ts`, `serviceCommitCallers.test.ts`) unchanged;
  `protectedReadAudit`'s own test still passes with `place` added.
- `jovenesPlannerModel.test.ts` (pure, the client payload): P5's kind (a Saturday keeps the form's
  kind, another weekday sends `ministry`, a stored `ministry` stays `ministry`); P7's bodies (a pick
  sends `{ role, member }` or `{ role, name }`, never both; a blank typed name sends no seat; an
  `extra` member seat whose VIEW name is the member's live name still sends exactly
  `{ _key, role, member }`; an `extra` typed seat sends `{ _key, role, name }`); `place` in
  `saturdayBody` and `groupEventBody` (null when cleared); the «Lugar: …» line in `whatsappRoster`;
  `jovenesDayEntry` carries `place`.
- `eventWrite.test.ts`: `invalid_place` has its words; `invalid_seats` too.
- ProgramEditor: a test that its person picker offers no typed-name option (P7).

## 5. The UI slice (standard; consumes P1–P2)

- P4. **Planear Jóvenes: «Nueva reunión»** button beside «Copiar para WhatsApp» (admins only),
  opening the same editor with a **Fecha** field (`DateField kind="date"`), default today (CDMX,
  computed by the server page as today) when in the shown month, else the month's first Saturday.
  The editor gets Fecha for edits too (a moved meeting is a PATCH of `date`). Row «Crear» stays and
  prefills its date. A save whose date falls in ANOTHER month navigates to that month
  (`/jovenes/admin?mes=YYYY-MM`) instead of a bare refresh, and the toast names the date, so the
  meeting never seems to vanish (and nobody presses «Crear» again for a duplicate).
- P5. **Kind from the date** (client, `saturdayBody`): a Saturday date keeps the form's kind
  (`saturday` for new, the stored one for an edit); any other weekday sends `ministry`. So a Friday
  meeting is never called «Sábado de Jóvenes».
- P6. The editor gets **Qué** (title, ≤80) and **Lugar** (place, ≤120) text fields.
- P7. **Names without an account, in the SEATS only:** `PersonSelect` gains an OPT-IN typed mode
  (props `typedName` + `onTypedName`), passed only by the seat pickers of the Saturday editor. With
  it, the select gets a last option «Escribir un nombre…»; picking it shows a one-line text input
  (≤60) under the select. Its sentinel value never reaches `member`. `ProgramEditor` does not pass
  the props, so program lines keep members only (§2; `programBody` would drop a typed name with a
  200). The client rule for the view's overloaded `name` (a member's live name, or a typed text):
  typed text = `memberId === null ? name : null`, for picks AND `extra`. So a member seat never
  opens in typed mode. `SeatPick` becomes `{ key, member, name }`; `saturdayBody` sends
  `{ role, member }` or `{ role, name }`, never both, and skips a seat with neither. `extra` seats
  send `{ _key, role, member }` or `{ _key, role, name }` by the same rule. A short hint under the
  typed field says it is for someone without an account (no «Tú», no program right).
- P8. **Lugar column** in the table (between Quién comparte and Notas; on a phone «Lugar …» in the
  running text), in «Copiar para WhatsApp» («Lugar: …»), in the meeting body shown by the Calendario
  sheet and `/jovenes` (`JovenesDayEntry.place`, a line under the seats), and in the group calendar's
  list and editor (`groupEventForm`/`groupEventBody` gain `place`).
- P9. Docs: ADR-0081 addendum (place, typed seat names, any-date create; and, said aloud, a group
  typed as Encargado gives its leaders no program right: W3a matches a member, so such a meeting's
  program is the admins'), ROUTES/UTILITIES where they describe the planner, CONTEXT if it defines
  the roster columns. `eventWrite.ts`'s `CODE_WORDS` gains `invalid_place` («El lugar es demasiado
  largo o tiene saltos de línea.») and `invalid_seats` («Revisa los nombres: uno por lugar, de una
  línea.»).

## 6. Delivery

One PR after PR #234: gates, one merge-range code review, preview (dev, Frank's look), main. Then,
with Frank's signed-in Chrome and his go-ahead on exactly these before → after values (production
writes, CLAUDE.md), fix the meetings already created (first confirming 20 Nov's stored time is
20:00, since the roster's «8:00 pm» lived in its notes; 28 Nov's Encargado Goma is already set): 20 Nov title «Estudio
"Daniel"», Lugar «Oasis Tlalpan», Encargado «Emprendedores», Quién comparte «Ana», notes cleared;
28 Nov title «Gotcha»; 5 Dec title «Posada Emprendedores», Lugar «Casa Fam Varela», Encargado
«Emprendedores»; 12 Dec title «Posada general de fin de año»; 14 Nov unchanged.

## 7. Post-approval notes (UN-REVIEWED; approval covers digest 69d8d319 only)

Adopted from the reviewers' non-blocking notes while building:

- The Saturday editor refuses an empty or malformed Fecha before sending («Elige la fecha.»), the
  sheet's header renders only for a valid date (`dayTitle("")` throws), and `invalid_date` gets
  words in `CODE_WORDS`.
- `optionalLine` refuses `\r`, `\n`, U+2028 and U+2029.
- `invalid_seats` reads «Revisa a las personas: un nombre corto, de una línea, por casilla.» (no
  «lugar», which now means the place).
- An `extra` seat with neither member nor typed name is skipped, like a pick.
- Rollback, said aloud: reverting this release hides typed seat names (they read «Sin asignar»)
  and the old editor DROPS them on the next save of that meeting; `place` survives (old bodies
  never send it). The stale-tab window is any super-admin, not only Frank.
- Docs also touched: `docs/DATA_MODEL.md`, `docs/API_REFERENCE.md` (the body shape), and
  `INTERNAL_STUDIO_FIELDS.ministryEvent` (`studioProtection.ts`) gains `place`.
- Tests live where the existing ones are: the program editor's «no typed option» and
  `writeMessage`'s words in the existing component/eventWrite tests; `jovenesEventView.test.ts`'s
  fallback expectation moves from «Lugar» to «Asiento».
- P5 kind drift accepted: a `saturday` meeting moved to a weekday is saved as `ministry` and stays
  `ministry` if moved back (display only, D3).
