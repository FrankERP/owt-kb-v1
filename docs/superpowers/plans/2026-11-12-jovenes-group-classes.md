# Jóvenes: each group plans its own classes («Clases del grupo»)

Status: plan, 2026-11-12. Extends `2026-10-30-jovenes-events-access.md` (ADR-0081, W1–W9) and
`2026-11-10-jovenes-place-and-names.md`. Branch `claude/project-thread-u70fsq`, from `main`
`2ee15003`. Only §3 (the writer slice) owns a critical contract; §4 (the screen) consumes it.

## 1. The requirement (Frank, verbatim)

2026-11-12 03:14Z, on opening Jóvenes to the 23 pastors:

> Aún no lo abras a todos, falta la sección para poder planear el calendario individual de cada
> ministerio
> Hoy en día tenemos algo así para Otro Nivel e invencibles: <Google Sheet>

The sheet's two «Rol Clases» tabs (one per book): one class per Sunday, grouped by month, columns
«Título de la Clase» (Cap 1…, or blank), «Libro o Corazón» (Libro / Corazón / «No hubo clase»),
Fecha, Responsable (a pastor, or «Todos»), Hecho (checkbox), Notas (e.g. «Cierre libro»,
«Semana Santa y se quedaron adentro. SE RECORRE TODO EL ROL»).

2026-11-12 03:22Z, his answers to the plan's questions (the plan doc
https://claude.ai/artifact/Ls1ug3xq4i1V2iAssmYZzt), verbatim:

> 1.- Cada uno tiene clases aparte
> 2.- No entendí, pero cuando alguien cambia de clase con alguien, cambian de día y de capítulo de
> libro también.
> Si una clase se cancela un domingo, se recorre para el siguiente domingo y todo el calendario se
> recorre
> 3.- Tienen eventos más espaciados, a veces son viernes, a veces sábados, a veces domingos o
> incluso puede ser entre semana
> 4.- Es un mensaje que no está basado en el libro, si no en lo que Dios haya hablado a tu corazón
> en la semana/s previa/s
> 5.- Sí, cárgalo
> 6.- La de ON e Invencibles es en Oasis Tepepan a las 11:40 más o menos

Readings taken from those answers:

- **A class belongs to ONE group** (answer 1).
- **«Cambiar con…» (swap):** two people who trade classes trade the day and the chapter — i.e. the
  classes stay where they are and their RESPONSABLES trade places (answer 2, first sentence).
- **«Recorrer» (shift):** a cancelled class moves to the next week and every later class of the
  same roster moves with it, each keeping its responsable (answer 2, second sentence; the sheet
  keeps the cancelled date as a «No hubo clase» row).
- Any date is allowed (answer 3); the planner merely proposes a Sunday, 11:40 and «Oasis Tepepan»
  for Otro Nivel and Invencibles (answer 6).

## 2. Non-goals

- No change to who READS a meeting (R1–R8) and no new kind of writer: W1–W3a stand.
- No MCP writer, no notification, no calendar-feed change.
- No change to the Saturday roster or to joint meetings.
- Responsables still write nothing (Frank was told «solo líderes y admins marcan Hecho»).

## 3. The writer slice (critical: `ministryEventCommit.ts`'s payload plus two multi-document writes)

### L0. The stored shape

A class is a `ministryEvent` that carries an optional `lesson` object:

```
lesson: {
  _type: "ministryEventLesson",
  series: string,   // the roster («El Caos Dentro de Mi»): one line, trimmed, 1–80 chars
  track: "libro" | "corazon" | "sin_clase",
  done: boolean,
}
```

**L0 invariant (what the new code WRITES):** a `lesson` is written only onto an event whose
resulting audience is `{ kind: "groups", groups: [g] }` — exactly one group. Old code (production
while this is on `preview`, or after a rollback) never writes `lesson` but could retarget a stored
class to 2–3 groups through its PATCH, leaving a `lesson` on a joint event. So every reader of
`lesson` (the list, the shift and swap sets) treats a `lesson` on anything but a one-group audience
as ABSENT, and an edit of such an event is not refused for it (L2).

Why one object and not three flat fields: `series`, `track` and `done` are generic names that the
protected-read audit would have to list (G1b below) and that other types could use; one distinctive
name (`lesson`, used by no schema today — `grep -rnw lesson app sanity scripts` finds only
comments) keeps the audit exact, and the three values only make sense together.

### L1. Parsing (pure, step 1 of W2's order)

- `lesson` absent ⇒ untouched. `null` ⇒ unset (PATCH) / not written (create).
- Otherwise it must be a plain object whose keys are exactly a subset of
  `{series, track, done, _type}` with `series`, `track`, `done` all present: `series` through
  `optionalLine(·, LIMITS.series = 80)` and non-null; `track` ∈ `LESSON_TRACKS`; `done` boolean;
  `_type`, if present, equal to `"ministryEventLesson"` (so a client may echo what it read).
  Anything else ⇒ 400 `invalid_lesson` (new `EVENT_ERROR` code).
- The writer always stores `{ _type: "ministryEventLesson", series, track, done }` it built itself.

### L2. Create and PATCH

- `lesson` joins `EDITABLE`, the create document (only when non-null) and the PATCH set/unset loop.
- **When the body carries a non-null `lesson`**, the RESULTING audience (the requested one, else the
  stored one, as `resulting` today) must be one group, else 400 `invalid_lesson`. This check runs
  after W2's 404 and W3's 403 (it depends on the stored audience), before the 409.
- When the body carries no `lesson` and the RESULTING audience is not one group, the PATCH also
  UNSETS `lesson` (added to `unset` when the stored row has one). So the new writer never leaves a
  `lesson` on a joint or whole-ministry event, and a lesson can never revive in another group's
  roster if the event is later moved back to one group. An event whose stored `lesson` violates L0
  (only old code can leave one) stays editable — nothing is refused for it — and the readers ignore
  its `lesson`.
- `lesson: null` with a one-group audience unsets it (a class becomes an ordinary meeting).
- Who may write a `lesson`: exactly who may write the event (W3). «Hecho» is a PATCH
  `{ lesson: {…, done}, _rev }`. A responsable who leads nothing is refused like any other edit.
- `STORED_QUERY`'s projection adds `date`, `time`, `place`, `lesson` (needed by L3/L4). It keeps its
  identity filters (W2) unchanged.

### L3. «Recorrer» — `POST /api/ministries/[ministry]/events/[token]/shift`

Body: `{ _rev: string, token: uuid, ids: string[] }`. `[token]` names the ANCHOR (the class that
did not happen); `token` is the client's create token for the «No hubo clase» marker (W6: minted
once when the confirmation opens, lowercased); `ids` is the list of event ids the confirmation
showed as moving (anchor included).

Order (W2's precedence, extended):

1. **Shape (400, no I/O):** `[token]` a UUID (else 404 as today); body an object; `_rev` a
   non-empty string (`rev_required`); `token` a v4 UUID (`invalid_token`); `ids` an array of 1–60
   distinct strings each matching `^ministryEvent\.[0-9a-f-]{36}$` (`invalid_shift`).
2. `assertToken()`; **actor** fresh (W1) — inactive ⇒ 403.
3. **Anchor** = `readStored(id)`; missing or unreadable in both modes ⇒ 404.
4. `canWriteStored(actor, anchor)` ⇒ else 403 `forbidden` (the same 404 → 403 → stored-dependent
   400 → 409 order as L2).
5. **Anchor is a live class:** its audience is one group `g` (`isGroupId`), it carries a valid
   `lesson` (L0 reading) with `track ≠ "sin_clase"` and `done === false` ⇒ else 400 `invalid_shift`.
   (A done class happened; a «sin clase» row is not a class that can be cancelled.)
6. `anchor._rev !== _rev` ⇒ 409 `stale`.
7. **The set**, ONE fresh read through `operationalClient` with W2's identity filters:

   ```
   *[_type == "ministryEvent" && _id in path("ministryEvent.*") && ministry == $ministry
     && audience.kind == "groups" && count(audience.groups) == 1 && audience.groups[0] == $group
     && lesson.series == $series && date >= $date]
     { _id, _rev, _type, ministry, audience, published, date, lesson, "createdBy": createdBy._ref }
   ```

   re-checked in TypeScript per row (L0 shape valid, same `series` byte for byte, same single
   group, ISO `date ≥ anchor.date`) — a row failing the TS check is dropped, never moved. More than
   60 rows ⇒ 400 `invalid_shift` (a roster is ≤ ~52 Sundays). The anchor must be in the set, with
   the `_rev` the client sent (else 409 `stale`: it moved between step 3 and this read). The set
   has NO upper date bound, and neither has the screen's read of the roster (§4), so the two always
   describe the same rows. The set is the roster's CLASSES only: rows with `track == "sin_clase"`
   are read (as GAPS, below) but never moved, never in `ids`, never patched — a «No hubo clase»
   row records that a DATE had no class (a camp, Semana Santa, a cancelled Sunday), so it stays
   tied to its date.
8. **The set must equal `ids`** (as sets) ⇒ else 409 `shift_changed` «El rol cambió mientras lo
   veías; recarga.» So a class added, removed or re-dated by someone else since the screen loaded
   is never moved blind (the echoed-list pattern of ADR-0072).
9. **Nothing done moves:** any row with `lesson.done === true` ⇒ 409 `shift_done` «Hay clases
   marcadas como hechas después de esta fecha; quítales la palomita o muévelas a mano.»
10. `canWriteStored(actor, row)` for every row (uniform for a one-group set, checked anyway) ⇒ 403.
11. **One transaction** (all or nothing):
    - for every class row: `patch(row._id).ifRevisionId(row._rev).set({ date: next(row.date) })`,
      where `next(d)` = `plusDays(d, 7)`, then `+7` again while the result is a GAP date — the dates
      of the roster's «sin clase» rows dated after the anchor plus the anchor's own date (the new
      marker). So a class never lands on a date that is known to have no class, the order of the
      classes is kept (each hops the same gaps), and on a weekly roster every class takes the next
      free Sunday. Each gap row's `_rev` is also asserted in the transaction (a no-op
      `patch(gap).ifRevisionId(rev).set({ ministry })`, the guarded-delete idiom), so a gap
      removed or re-dated after the read fails the whole write (409) instead of being hopped over
      blind. The set read's 60-row cap counts classes and gaps together.
    - `create` the marker `ministryEvent.<token>`: `ministry`, `audience {groups:[g]}`,
      `kind: "group"`, `date: anchor.date`, `title: "No hubo clase"`, NO time and NO place,
      `lesson {series, track: "sin_clase", done: false}`, `seats: []`, `program: []`,
      **`published: false`**, `createdBy: weakRef(actor.id)`. Unpublished, it is read only in the
      planner (admins, the group's leaders — R3's draft arm), never on `/jovenes` or the Calendario,
      under new code and old code alike; its title names it in the planner and in Studio. So a
      cancelled Sunday never looks like a meeting that is still on.
    - Any revision mismatch ⇒ the whole transaction fails ⇒ 409 `stale`. An existing marker id
      (`sanityConflictKind` = `already_exists`, which today's `revisionConflict()` would rethrow) is
      ALSO mapped to 409 `stale` explicitly (a retry after a lost answer finds the anchor's revision
      moved and reloads; nothing doubles). Any other error rethrows.
12. `revalidateMinistryViews(ministry)`; answer `{ ok, id: anchorId, rev: null, moved: n }` (W3b:
    no content).

`plusDays(iso, 7)`: arithmetic on `Date.UTC(y, m-1, d + 7)` → `YYYY-MM-DD`, never local time.

Why +7 days and not «the next slot of the roster»: Frank's words are «se recorre para el siguiente
domingo»; on a weekly roster the two are the same, and +7 needs no rule for the last class. A
sparse roster (answer 3) edits dates by hand; the confirmation says «una semana».

### L4. «Cambiar con…» — `POST /api/ministries/[ministry]/events/[token]/swap`

Body: `{ _rev: string, with: { token: uuid, _rev: string } }`.

1. Shape (400): both tokens UUIDs (the URL's else 404), different (`invalid_swap`), both `_rev`s
   non-empty.
2. `assertToken()`; actor fresh (W1).
3. Both stored; either missing or unreadable ⇒ 404 (the same body for both, so the refusal does
   not say which).
4. `canWriteStored` on both ⇒ else 403.
5. Both are classes (valid `lesson` by L0) of the SAME single group, neither `done` and neither
   `track == "sin_clase"` ⇒ else 400 `invalid_swap` (a held class is history; a «no class» row has
   no responsable to trade).
6. Either `_rev` differs ⇒ 409 `stale`.
7. Each side's stored `seats` re-built as written seats: a stored seat must have a `_key`
   (`KEY`), a `role` in `SEAT_ROLES`, and at most one of a member ref (`MEMBER_ID`) or a `name`
   (one line, ≤ 60) — any other stored seat ⇒ 400 `invalid_swap` («edita esta clase primero»),
   never silently dropped.
8. Every member the swap MOVES (the member refs of both sides, as a set) must pass `peopleFit` for
   the group's audience (W5: a seat moved to another class is a change) ⇒ else 400
   `invalid_member`.
9. One transaction: `patch(A).ifRevisionId(revA).set({ seats: seatsOf(B) })` and
   `patch(B).ifRevisionId(revB).set({ seats: seatsOf(A) })`. Each array keeps its `_key`s (unique
   within it, so unique on the new document). Conflict ⇒ 409 `stale`.
10. Revalidate; `{ ok, id: A, rev: null }`.

Only `seats` move — ALL of each class's seats (apoyo and comparte too, though the class screen
shows only the encargado): title, track, date, notes stay — «cambian de día y de capítulo» is the
two people trading places on the roster.

### L5. Routes

Two new route files, each like `program/route.ts`: `requireActiveSession` (401), then
`eventRouteGate` (404 until the rollout reaches the person), `readJson`, delegate, send
`body`/`status` verbatim, wrapped in `withVerificationRunContext`. They join
`serviceCommitCallers.test.ts`'s `ministryEventCommit` list; nothing else imports the module.

### L6. Reader, schema, guards

- `ministryEventReads.ts` PROJECTION adds `lesson`; `MinistryEventView.lesson:
  { series, track, done } | null`, null unless the stored object is L0-valid (series a non-blank
  string, track in the enum, done boolean) AND the audience is one group. Access is untouched (the
  reader's filter does not mention `lesson`).
- `sanity/schemas/ministryEvent.ts`: `lesson` object field (hidden, read-only type as today).
- G1b: `lesson` joins `PROTECTED_FIELDS` (`protectedReadAudit.ts`).
- The shift's set read is a second query SHAPE inside the writer (the writer already holds
  `STORED_QUERY`; `ministryEventCoverage.test.ts` allows the file). It is sanctioned by name in the
  ADR-0081 addendum and in CLAUDE.md's «A Jóvenes group is a security boundary» line: W2's identity
  filters, one group the actor may WRITE (checked before the read), and its rows are never
  returned to the client.
- **One definition of a valid lesson.** `isValidLesson(raw)` and `lessonOf(audience, raw)` (a
  neutral pure module, `app/utils/ministryLesson.ts`) are used by the writer's parser, the shift's
  re-check and the reader's normalization alike, so the reader and the writer can never disagree
  about which rows belong to a roster (a disagreement would be a permanent 409 `shift_changed`).
- Member surfaces: a PUBLISHED class with `track == "sin_clase"` (a leader may publish one by hand)
  shows on `/jovenes` and the Calendario with its title («No hubo clase», which the screen fills
  when the track is chosen and the title is blank) — never as an untitled «Reunión de grupo».
- Tests (vitest, mocked clients as `ministryEventCommit.test.ts` does): L1 parse matrix; L2
  one-group check with a requested and a stored audience, dormant-lesson PATCH allowed; L3 every
  numbered refusal, the set query's params, the TS re-check dropping a two-group row and a
  different-series row, `ids` mismatch, done row, cap, transaction contents (patches with each
  row's rev, +7 across a month and a year end, marker fields), conflict ⇒ 409; L4 refusals, the
  rebuilt seats, `peopleFit` on moved members, the two-patch transaction; reader projection and
  normalization.

### L7. Mixed versions and rollback

- `preview` writes the production dataset while `main` runs old code. Old reader: ignores
  `lesson` (fixed projection) — a class shows as an ordinary group meeting with its title
  («Cap 5»); a «No hubo clase» marker is unpublished and never reaches a member view (L3). Old PATCH: never names
  `lesson`, so it neither writes nor drops it; it may move a class to 2–3 groups (dormant lesson,
  L0). Old DELETE removes a class like any meeting. Nothing old can misread a class as wider access:
  access never reads `lesson`.
- Rollback of this PR: classes become plain group meetings (title, date, responsable, notes all
  still show); «Hecho»/track/series become invisible but stay stored; re-releasing shows them again.
  No data migration either way.

## 4. The screen (standard; consumes §3)

In Planear Jóvenes, a third section «Clases del grupo» (ADR-0086 card language, uppercase card
titles, no font change):

- **People for the responsable pickers:** today the page passes `people` only to managers
  (`admin/page.tsx`, `isManager ? readJovenesPeople() : []`) and `readJovenesPeople` carries no
  groups. It gains each person's Jóvenes `groups` (from `ministryRoles` through the existing
  normalization; group membership is already public, base plan §8) and the page passes it to
  leaders too. The class pickers offer the chosen group's members plus a typed name («Todos»);
  W5's `peopleFit` stays the real check.
- **«Calendario de grupos» no longer lists classes:** `groupEvents()` drops events with a valid
  lesson, so the old editor (which knows nothing of `lesson`) can never retarget a class and unset
  its lesson by accident; classes are edited only in «Clases del grupo».
- Group pills in each group's colour: a leader sees the groups `ledGroupsIn` gives them, an admin
  all five. The section reads nothing new: one more `readMinistryEvents` call in editor mode (the
  same query shape) with `from` = the first day of the month 12 months before the viewed one and
  `to = "9999-12-31"` — NO upper bound, like the shift's set (L3 step 7) — filtered in the page by
  `lesson != null` and the chosen group. Every class of a roster dated on or after any visible
  anchor is therefore on the screen, so the `ids` the confirmation sends equal the server's set
  and «N de M hechas» counts the whole future roster.
- A roster picker when the group has more than one `series`; the roster header shows «N de M
  hechas».
- One compact card per class: `DateTile`, title («Cap 5»), a track chip (Libro / Corazón /
  No hubo clase — «Corazón» carries Frank's description as help), the responsable's face and name
  (or the typed «Todos»), a «Hecho» `Checkbox` that PATCHes `lesson.done` immediately, notes.
  Past classes fold under «Anteriores».
- «Nuevo libro» (a `CueDialog`): roster name, first chapter number, how many chapters, first date,
  every N days (7 by default), time and place (11:40 / «Oasis Tepepan» proposed for Otro Nivel and
  Invencibles), responsables in rotation (members of the group, or typed names like «Todos»),
  published or draft; at most 60 classes (the shift's cap). It previews the rows, then POSTs them
  ONE AT A TIME with tokens minted when the preview was built. After the first POST the inputs and
  tokens are FROZEN (the form is read-only; only «Reintentar» and «Cerrar» remain), so a retry
  completes what is missing and never duplicates (W6). Here a 409 `already_created` means «that row
  exists», counted as done — a deliberate departure from W6's single-meeting rule (re-open the
  stored event), because each token names one generated row and the dialog re-reads the page when
  it closes. A partial failure says how many were created and keeps the dialog open.
- «Nueva clase»: one class on any date (a «Corazón» Sunday inserted between chapters, a sparse
  group's next meeting), with the roster picked from the group's rosters or typed.
- Edit a class: date, time, place, title, track, responsable, notes, published. The class editor
  has no group picker (a class is one group's; moving it to another group is delete and create).
- «Recorrer» on a class's menu: a confirmation listing the classes that move («Se moverán 6 clases
  una semana; el 15 de noviembre queda como No hubo clase»), sending their ids (L3). It warns when
  a moved class lands on a date that already holds another meeting of the group (e.g. the next
  book), without refusing.
- «Cambiar con…»: pick another class of the same roster; confirmation names both people and dates.
- Handlers follow the client-mutation invariant (try/catch/finally, `res.ok`, never close as
  success on failure; 409 ⇒ refresh and say so).

## 5. Loading «El Caos Dentro de Mi» (Frank: «Sí, cárgalo»)

Only `ministryEventCommit.ts` may write the type, so no script writes it. After production, the
remaining classes (Cap 5–10, 15 Nov–20 Dec 2026, responsables Rebe, Rachel, Jacob, Frank, Marianne,
Todos; «Cierre libro» on Cap 10) are created through «Nuevo libro» in Frank's signed-in session —
by Frank, or by Remote Control on his Mac with his go-ahead — once he says which group the roster
belongs to. Cap 1–4 (done) are optional history.

## 6. Delivery

One PR: §3 + §4 + ADR-0081 addendum + docs. Release order per CLAUDE.md; production only on
Frank's explicit word after he has looked on dev (`/jovenes` is 404 for the dev-verify bot).

## 7. Known limits (accepted)

- «Recorrer» moves by 7-day hops (over «No hubo clase» dates) and only the anchor's roster; a
  sparse roster edits dates by hand. It has no undo: the confirmation says so, and putting it back
  is editing dates by hand. A class CREATED in the roster between the set read and the commit is
  not moved (no revision to assert on a document that did not exist; the ADR-0072 gap, accepted).
- A roster with more than 60 rows (classes and gaps) from the anchor on cannot be shifted (400).
- «Recorrer» on a past class is allowed on purpose: the sheet records cancellations after the
  Sunday («Semana Santa y se quedaron adentro. SE RECORRE TODO EL ROL»).
- A roster is identified by its exact `series` text within a group; renaming a roster is an edit
  per class (not asked for).
- A class can hold at most 6 seats like any meeting; the class screen uses `encargado` only.
