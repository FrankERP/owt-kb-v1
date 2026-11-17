# Jóvenes: the Saturday's fixed program, «Mi parte», and assignment emails

Status: plan, 2026-11-17. Extends `2026-10-30-jovenes-events-access.md` (ADR-0081) and
`2026-11-10-jovenes-place-and-names.md`. Branch `claude/project-thread-2inktb`, from `main` 5804fb05.
A parallel thread (`claude/project-thread-jn7uj2`) redesigns the Jóvenes navigation (`/jovenes` as
«Inicio», a new `/jovenes/calendario`) and the phone layout of «Planear»; file ownership is agreed
in §9.

## 1. The requirement (Frank, 2026-11-17, verbatim, the part this plan owns)

> Me gustaría que les lleguen correos de asignación a las personas que se les asigna algún rol en
> la reunión.
> Me gustaría que también carguen información al respecto de su participación, por ejemplo, la
> persona que comparte carga información sobre su tema.
> La persona que tiene la dinámica 1, pone una breve descripción de su dinámica (de unos 300
> caracteres máximo. El de la oración igual, etc.
>
> La reunión siempre tiene la misma estructura: Alabanza (Estaría bueno que jalaras el set de la
> parte de alabanza para que ellos supieran cuales son las canciones), Oración (Una persona
> encargada y en una nota tiene que poner si quiere música de un track o que toque alguien de la
> alabanza. No especifica quién toque, solo dice que pide alguien. Eso se me notifica a mí y yo me
> encargo de eso), Dinámica 1 y Dinámica 2 (Suele tener 2 servidores/pastores responsables, ellos
> son los que tienen que poner una breve descripción y también si ocuparán el apoyo de algún joven
> del grupo, tienen que poner su nombre), Plática (Tiene un responsable, a veces 2 y tienen que
> poner la descripción de su tema y una nota sobe si quieren música de track al final de su prédica
> o si quieren que se toque una canción con el grupo de alabanza)

Today (verified 2026-11-17 on `main` and on the production dataset):

- a meeting has `seats` (`encargado`, `apoyo`, `comparte`; a member or a typed name) and a free
  `program` (lines of `label`, one `member`, a `note` of at most 300 characters);
- the program is written whole by `updateMinistryEventProgram` (an admin, or the encargado/apoyo of
  a whole-ministry meeting, W3a/W4) and by `updateMinistryEvent`; nobody else writes a line;
- no ministry-event write sends anything (`ministryEventCommit.ts` returns `{ ok, id, rev }`);
- production holds 15 `ministryEvent` documents, 5 of them whole-ministry, and **none has a program
  line** (query of 2026-11-17), so no stored line needs migrating;
- the Saturday worship setlist is a `saturdarSongs` document keyed by `week` (the Saturday's date),
  shown to worship members only when that date's `saturday_role` is `published != false`
  (`publishedSetlist`, `app/utils/draftGating.ts`).

## 2. Decisions (mine, told to Frank on 2026-11-17; he may change any)

- **D1. Where parts live — ONE rule, the one M2, M2a, M4, U1, U2, U3 and the emails all use.** A
  part is a stored program line that carries `part`, and it may be stored on ANY meeting. Only what
  the screens OFFER differs by meeting:
  - **the Saturday meeting** (`kind == "saturday"`, the only meaning of `hasFixedProgram`) always
    SHOWS the five steps — Alabanza, Oración, Dinámica 1, Dinámica 2, Plática — stored or not, and
    its program editor always offers Oración and the two dinámicas;
  - **any other meeting** shows and edits exactly the part lines it HOLDS: no empty step, no
    Alabanza. One thing is offered there too: Plática's form, to a member who holds a `comparte`
    seat (the «Te toca» email asks whoever shares for their topic on every whole-ministry meeting,
    so the form must exist where its link lands).
  Every screen and the program editor round-trip EVERY stored part line whatever the kind, and the
  writer itself keeps what a responsable filled on a kept part line (M2a). So a meeting whose kind
  leaves `saturday` — an admin moves it to a Friday and `meetingKind` stores `ministry` — keeps its
  part lines, shows them, and loses nothing on the next program save.
- **D2. Plática's people are the `comparte` seats**, never stored a second time on a line. The
  roster editor gains an optional second «Comparte».
- **D3. Who assigns is unchanged:** seats by whoever may edit the meeting (W3), program people by
  them and by the encargado/apoyo (W3a). New: each responsable writes the INFO of their own part.
- **D4. Assignment emails only for a whole-ministry meeting** (`audience.kind == "ministry"`), only
  while it is published and not past, only to the people the write newly assigns (all of them when
  it is published or re-dated). A group's classes and group meetings send nothing: «Nuevo libro»
  creates up to 60 classes in a row, and the sender is a free Gmail account (~500 recipients/day).
- **D5. A music request** (Oración or Plática set to «alguien de alabanza») emails the super-admin
  (Frank), and so does its withdrawal.
- **D6. Alabanza is not a stored line:** it is that date's published Saturday setlist, titles and
  keys only. Premise, to confirm with Frank on dev: the worship team's Saturday service
  (`saturday_role` / `saturdarSongs` of that `week`) IS the Jóvenes meeting's worship; he asked for
  «el set de la parte de alabanza» without naming another source.
- **Two narrowings, to tell Frank with the screenshots.** A dinámica holds at most two people and
  only people with an account (anyone else fits in «Jóvenes que apoyan»). A typed-name «comparte»
  gets no email and cannot fill the Plática; an admin or the encargado fills it for them (U3).

## 3. Non-goals

- No change to who READS a meeting (R1–R3) or to W1–W3a, W6, W9; no MCP writer; no push.
- No email for a removal, a delete, a group meeting or a class; no reminder email («aún no llenas
  tu parte»); no debounce or digest (a write sends at most one email per newly assigned person).
  Accepted and recorded in the ADR: switching track ↔ alabanza mails Frank each time; unpublish
  then publish announces everyone again and re-says a standing request; publishing a month of
  Saturdays is one email per Saturday per person (23 pastors bound all of it). A delete of a
  meeting with a standing music request says nothing: its link would open nothing, and
  unpublishing it first does send the withdrawal.
- No migration: no stored document is rewritten.

## 4. The writer slice (CRITICAL: `ministryEventCommit.ts`'s payload, a new write right, and a
notification audience)

### M0. `app/utils/ministryParts.ts`: the one definition of a part

Neutral module (no server or client import), imported by the writer, the reader and the screens.

| `id` | label | people on the line | `music` | `helpers` |
|---|---|---|---|---|
| `oracion` | Oración | 1 | yes | no |
| `dinamica1` | Dinámica 1 | 2 | no | yes |
| `dinamica2` | Dinámica 2 | 2 | no | yes |
| `platica` | Plática | 0 (its people are the `comparte` seats, D2) | yes | no |

`PART_MUSIC = ["track", "alabanza"]`. `PART_LIMITS.helpers = 120`; a part's description is the
line's existing `note` (`LIMITS.note = 300`, Frank's «unos 300 caracteres máximo»).
`partSpec(id)` returns the row or `null` by OWN key (a stored `"constructor"` is no part).

### M1. The program line gains four optional fields

`ministryEventProgramLine`: `part` (string), `member2` (weak reference to `teamMembers`), `music`
(string), `helpers` (string). They are nested under `program`, which `PROTECTED_FIELDS` already
lists, so no generic top-level name is added to the audit. The schema type stays hidden and
read-only in the Studio.

### M2. `parseProgram` (create, PATCH and program PATCH all use it)

Per item, after today's checks (`_key`, `note` ≤ 300):

- **Free line** (`part` absent or `null`; anything else that is not a string — a number, an
  object — ⇒ 400 `invalid_program`): today's rules (a non-empty `label` ≤ 60, an optional
  `member`). A non-null `member2`, `music` or `helpers` ⇒ 400 `invalid_program`.
- **Part line** (`part` is a string): not an id of M0 ⇒ 400 `invalid_program`. The body's `label`
  is ignored and the STORED label is M0's (so a rollback, the WhatsApp copy and any older reader
  still show «Oración»).
  - `member`, `member2`: each `optionalMember`. The same id twice ⇒ 400. More distinct people than
    the part's «people» ⇒ 400 (so any person on `platica` ⇒ 400, two on `oracion` ⇒ 400). A lone
    `member2` is stored as `member`.
  - `music`: absent, `null` or `""` ⇒ none; else it must be in `PART_MUSIC` AND the part must take
    music, otherwise 400.
  - `helpers`: `optionalLine` ≤ 120; non-null only on a part that takes helpers, otherwise 400.
- Two lines with the same `part` ⇒ 400 `invalid_program`.

`LineIn` becomes `{ key, label, part, member, member2, note, music, helpers }`; `lineDoc` writes
each optional field only when non-null. `LIMITS.lines` (20) and `LIMITS.seats` (6) are unchanged;
`LIMITS.note` is `PART_LIMITS.note` (one number, 300).

### M2a. A kept part line keeps what its responsable filled (both program writers)

`updateMinistryEventProgram` and `updateMinistryEvent` (when the body carries `program`) apply this
to the parsed lines against the STORED program, in the same place as the people check (after the
404, the 403 and the 409, so a stale tab still answers 409 first):

- An incoming line whose `_key` names a stored line that carries a valid `part` is a **kept part
  line**. Its `part` must be that same id; a different one, or none, ⇒ 400 `invalid_program`. So a
  body built by code that does not know parts (a tab loaded before the deploy sends
  `_key, label, member, note`) can never turn a part into a free line.
- On a kept part line the stored `note`, `music` and `helpers` are written back — each only if it
  still passes M2 for that part, otherwise dropped — and the body's values for those three are
  ignored. W10 is the only writer of those fields once the line exists. The body still decides the
  line's people (`member`, `member2`), which lines remain, and their order.
- Any other part line (no `_key`, a `_key` that names no stored line, or one that names a stored
  FREE line) is new: `note`, `music` and `helpers` come from the body, validated as M2.
- A stored part line the body leaves out is removed with what it held: that is the edit. If it
  carried a standing request on a live meeting, M5 says the withdrawal.

### M3. People (W5) with two slots

`storedItems` also reads `member2`. A line's ADDED people are those of its people who are on
neither slot of the stored line with the same `_key`; only added people go to `peopleFit`
(unchanged: an active member of the ministry and, for a groups audience, of one of its groups). So
swapping the two slots of a kept line re-validates nobody, and an old line naming someone who left
stays editable. Seats are reconciled exactly as today.

### M4. W10 — «Mi parte»: `updateMinistryEventPart(actorId, ministry, token, part, raw)`

Route: `PATCH /api/ministries/[ministry]/events/[token]/parts/[part]`, behind the same session
check and `eventRouteGate` as the other four. One order of refusals, W2's:

1. **Shape, no I/O.** An unknown ministry, a token the writer could not have minted, or a `part`
   that is not an id of M0 ⇒ 404 `notFound`. Body not an object ⇒ 400 `invalid_body`; no `_rev` ⇒
   400 `rev_required`. Only `note`, `music` and `helpers` are read: `note` `optionalText` ≤ 300;
   `music` as M2 for this part; `helpers` as M2 for this part; a bad one ⇒ 400 `invalid_part`
   (new code). None of the three KEYS present ⇒ 400 `nothing_to_update`.
2. **Fresh actor** (W1): inactive ⇒ 403.
3. **The stored event** (`readStored`): missing, or unreadable to the actor in both modes ⇒ 404.
4. **Who may** ⇒ else 403 `partForbidden` («No puedes editar esta parte.»):
   - whoever may edit the meeting (`canWriteStored`), or holds the program right
     (`seatGrantsProgram`, W3a), exactly as for the program PATCH; or
   - **the part's responsable, while they may still READ the meeting as a member**
     (`mayRead(…, "member")`, so never a draft, never after leaving Jóvenes or the group — the same
     «a seat is a reason to write, never to read» as W3a): for `platica`, a stored `comparte` seat
     whose `member` is the actor; for the others, the FIRST stored line whose `part` is this one
     names the actor as `member` or `member2`. A typed name is never a person and grants nothing.
5. **Revision:** `stored._rev !== _rev` ⇒ 409 `stale`.
6. **The write**, under `ifRevisionId(_rev)`, sets ONLY `program`, rebuilt from the stored raw
   items passed through untouched except the target:
   - the target is the first stored item whose `part` is this one; on it, each of `note`, `music`,
     `helpers` whose KEY is in the body is set, or removed when `null`; every other field of that
     item (its `_key`, `_type`, `label`, `part`, `member`, `member2`) and every other item is the
     stored object itself;
   - no such item: when every sent value is `null` there is nothing to store and the answer is
     `ok` with the current revision and no write; otherwise a new part line (fresh `_key`, M0's
     label, no people) is appended — refused with 400 `invalid_program` when the stored program
     already has `LIMITS.lines` items.
   The revision check makes the pass-through exact: the array written is the array read plus one
   change, so this write can never drop or reorder another person's line.
7. `revalidateMinistryViews`, then `{ ok, id, rev }` and the notices of M5 (a part write changes no
   person, so only a music change can produce one).

W10 never writes `seats`, people on a line, a label, `published` or any other field, whatever the
body says.

**Scope, deliberately wider than W3a (D1).** The responsable arm has no audience or kind condition:
a part line on a group's meeting is filled by the member it names, and a member `comparte` of any
meeting they read may create its Plática line. No group boundary moves — the arm needs
`mayRead(…, "member")` on that very meeting — and such a line shows as itself wherever it is (U1).
Only whole-ministry meetings announce anything (M5), so a request for the worship team on a
group's meeting is stored and mails nobody; no screen offers it there.

### M5. Notices: computed by the writer, pre-commit `before`, sent after the response

`app/utils/ministryEventNotices.ts` (pure, neutral): `meetingNotices(before, after, { actorId, today })`.

- A **snapshot** is `{ ministryWide, published, date, seats: [{ role, member, name }], lines: [{ key, part, label, members, music, note }] }`
  (`name`: a seat's typed name, used only to say who asks for music).
  `before` is built from the row `readStored` returned at step 3 — the state the write replaces,
  guaranteed by `ifRevisionId` — or `null` for a create. `after` is built from what the write
  stores (the stored fields overlaid with the edit). Nothing is re-read after the commit.
- `live(s)`: `s.ministryWide && s.published === true && s.date >= today` (`today` = the CDMX
  calendar day, `toLocaleDateString("sv", { timeZone: "America/Mexico_City" })`).
- **Assigned.** `after` not live ⇒ nobody. Else the pairs (member, role) of `after` — a seat's
  `seat:<role>`, a part line's `part:<id>`, a free line's `line:<_key>` — that are not in `before`;
  ALL of them when `before` is `null`, was not live, or had another date (`moved` is then true when
  it was live). The actor is removed. Grouped per member: one email per person per write.
- **Music.** For `oracion` and `platica`: `asks(s)` = `s` is live and that part's line has
  `music == "alabanza"`. One entry `{ part, asks: asks(after) }` when `asks(before) !== asks(after)`,
  and also when the request STANDS on a meeting whose date moved (`asks(after)` and `moved`):
  whoever arranges the musician needs the new day. A note edited under a standing request is
  silent (the email already links to the meeting).
- A delete, the shift and the swap produce no notice (§3).

Every mutating writer but those three returns `effects.notices` (`null` when there is nothing to
say) together with the meeting's display fields (`id`, `date`, `time`, `arrival`, `place`, `title`,
`kind`) and, for a music entry, the part's note and its responsables' ids or typed names, all taken
from `after`. `STORED_QUERY` and `StoredRow` gain `arrival` and `title` for that: a program PATCH
and a part PATCH build `after` from the stored row, and today's query reads neither.

The four routes (create, PATCH, program PATCH, part PATCH) call
`after(() => sendMinistryEventNotices(effects.notices))` (`app/utils/ministryEventNotify.ts`,
server-only). It is best-effort and never throws; a failed send is logged and never fails or
repeats the write. The routes stay wrapped in `withVerificationRunContext`, and every send goes
through `sendEmail`, so the delivery firewall (`deliveryFirewall.ts`) still stands in front.
The sends of one write run in PARALLEL (`Promise.allSettled`; ADR-0080 rejected serial sends, each
may take the 20 s `SEND_TIMEOUT_MS`) and are bounded by M6's count. The four routes export
`maxDuration = 60`, as every other route that sends from `after()` does, and
`ministryEventNotify` joins `DELIVERY_CAPABLE_IMPORTS`.

### M6. The audience (the part a wrong line of code turns into mail to the wrong people)

- **Assignment email («Te toca»)**: exactly the member ids of M5's «assigned». At send time one
  read of those ids and of the partners and responsables the emails name (`teamMembers`: `email`, `notifPrefs`, name, access fields) drops anyone who is
  not an ACTIVE member of Jóvenes, has no email, is outside `getAllowlist()`, or opted out
  (`wantsNotification(prefs, "assigned")`, the one preference resolver). Never a group, never the
  ministry, never a typed name. `EMAIL_REDIRECT_TO` is honoured exactly as `proposalNotify.ts`
  does (`to` replaced, the real address in the subject).
- **Music email**: a second read, only when there is a music entry — `teamMembers` with `role == "super-admin"`, `disabled != true`, excluding the
  system accounts (`service-account-*`, `member-dev-verify`), minus the actor; allowlist and
  `wantsNotification(prefs, "proposals")` (the «a request needs you» switch). Today that is one
  person (query of 2026-11-17: Frank and `service-account-claude` hold the role).
- A write sends at most (people on the meeting) + 1 emails: 6 seats + 20 lines × 2 is the hard
  bound, 9 the real one (encargado, apoyo, two comparte, oración, two dinámicas of two).

### M7. What the writer does NOT change

W1–W3a, W6 (create token), W9, the 404/403/409 order of the four existing writes, the lesson rules,
«Recorrer» and «Cambiar con…» (they never touch `program`). W4 stands: the program route reads only
`program`. The program right (W3 or W3a) now also decides a part line's PEOPLE through the program
PATCH, as it already decided every line's label, person and note; a part's `note`, `music` and
`helpers` are changed only through W10 once the line exists (M2a), where that same right fills any
part (M4 step 4).

### Compatibility and rollback (accepted, said aloud)

- No stored line has a `part` today, so nothing changes shape on deploy. A page loaded BEFORE the
  deploy sends free lines only; if someone has since saved a part line the revision moved and that
  stale save answers 409, and a tab that loaded the meeting AFTER a part line existed but still
  runs the old code answers 400 (M2a: its body carries no `part` on that line's `_key`). Neither
  writes anything.
- Rolling this release back: the old reader ignores the new fields (a part line shows as a free
  line called «Oración» with its first person), and the old program editor DROPS `part`, `member2`,
  `music` and `helpers` on the next save of that meeting. The descriptions (`note`) survive.

## 5. The reader slice (no filter changes)

- `PROJECTION`'s program gains `part`, `music`, `helpers` and the second person read exactly as the
  first (`"member2Id": member2._ref`, name, photo, `"mine2": member2._ref == $me`).
  `MinistryEventLine` gains `part: PartId | null` (through `partSpec`), `music`, `helpers`,
  `second: MinistryEventPerson | null`. `BASE`, the two arms, `mayRead` and the parameters are
  untouched, so nobody reads a meeting or a person they did not already read.
- Each person of a line carries their own `mine` (`mine`, and `second.mine`); a PART is the
  reader's when either is them (`partViews`, U1).

## 6. Alabanza's setlist for a Saturday meeting (a deliberate read across ministries)

`app/utils/jovenesWorshipSet.ts` (server-only): `readSaturdaySets(dates)` reads, with
`operationalClient`, the `saturdarSongs` whose `week` is one of the dates and the `saturday_role`s
whose `week` is one of them with `published != false`, and returns per date the songs' `title` and `play_key`
ONLY — and only when the date has exactly one published role and exactly one setlist
(`publishedSetlist`; an ambiguous duplicate shows nothing, as the worship home does). The callers
pass only the dates of `kind == "saturday"` meetings the reader already holds. No team, no notes,
no links (a Jóvenes-only pastor cannot open a song page).

This is the one place a Jóvenes pastor sees worship data; Frank asked for it, and song titles are
what the congregation hears that Saturday. Recorded in the ADR (§8).

**Who calls it, in THIS PR:** the three pages that draw a Saturday meeting — `/jovenes/page.tsx`,
`/schedule/page.tsx` (the Calendario's day sheet) and the new meeting page — each with one call
for the dates of the `kind == "saturday"` meetings it already read, handing the result to
`jovenesDayEntry(event, songs)`. `songs` has three states so a page that did not read never lies:
a list ⇒ the songs; `null` (read, nothing published) ⇒ «Setlist por definir»; `undefined` (not
read) ⇒ the Alabanza step with no line under it.

## 7. The UI slice (standard; consumes §4–§6)

- **U1. The program as shown** (`MeetingBody`, through `jovenesDayEntry` and the new neutral
  `jovenesPartView.ts`), by D1's rule: on a Saturday meeting five numbered steps — Alabanza (§6),
  Oración, Dinámica 1, Dinámica 2, Plática — each with its people (up to two faces), its
  description, «Apoyan: …» and a music chip («Track» / «Pide alabanza»), an unassigned part reading
  «Sin asignar»; on any other meeting only the part lines it holds, drawn the same way; then the
  free lines, as today. The step keeps today's fields (`key`, `label`, `name`, `photo`, `mine`,
  `note`) and gains `part`, `people`, `music`, `helpers`, `songs`, `pending`, so code that reads
  the old shape keeps working. **The in-app entrance to «Mi parte»:** under a part that is the
  reader's, the step links to the meeting's page («Llenar mi parte →», or «Editar mi parte →» once
  filled). `MeetingBody` is what `/jovenes`, the Calendario's sheet and the planner's cards all
  render, so the entrance exists wherever a pastor sees their part, mailed or not.
- **U2. `ProgramEditor`**, by D1's rule: a «Partes» block with one row per part line the meeting
  holds — plus, on a Saturday, Oración and the two dinámicas even when not stored — where one picks
  WHO (one person, two for a dinámica; Plática shows «quién comparte» read-only), then «Otros
  momentos» (today's free lines). The form state carries `part`, `member2`, `note`, `music` and
  `helpers` of EVERY stored part line whatever the meeting's kind, and its body sends them back;
  what a responsable filled is shown read-only («Ya llenó: …»). M2a makes the server keep those
  three fields even if a client did not. A part row with nobody and nothing filled is not sent.
  **The entrance for whoever fills a part for somebody else** (an admin, the encargado, the topic
  of a typed-name «comparte»): the editor's sheet links to the meeting's page.
- **U3. The meeting's page, `/jovenes/reunion/[token]`** (new; where the email and both entrances
  land): the same guards as `/jovenes` (session, rollout, Jóvenes member), ONE read through
  `readMinistryEvents` from 30 days back with no upper bound (a page range, not access; a link to a
  meeting planned far ahead must open) — in `editor` mode for someone who plans (a manager, or a
  leader of some group: that arm contains the member arm, so they see no less, plus the drafts
  they already read in the planner), in `member` mode for everyone else — and the meeting picked by
  id; not found ⇒ 404. It shows the meeting and, for each part of `partViews` the reader may write
  (their own; every part for whoever has the program right), the «Mi parte» form (description with
  a 300 counter; for a dinámica «Jóvenes que apoyan»; for Oración and Plática the two music
  options). Form controls are 16 px on a phone; one column; the save follows the client mutation
  rules (try/catch/finally, `res.ok`; on a 409 the text stays, the page refreshes, and the person
  saves again against the newer revision).
- **U4. Second «Comparte»** in the Saturday editor (`saturdayForm`/`saturdayBody`: the first two
  `comparte` seats become picks; the rest still ride in `extra`).
- **U5. Emails** (`app/utils/ministryEventEmail.ts`, pure builders on `emailShell`'s light palette):
  «Te toca» (roles, date, time, arrival, place, what to fill per role, «Llenar mi parte →» to U3)
  and «Piden música de alabanza» / «Ya no piden música de alabanza» (who, which part, the note).
- **U6.** «Copiar para WhatsApp» lists the assigned parts under each Saturday.

## 8. Guards (tests) and docs

- `ministryParts.test.ts`: the table, own-key lookup, limits.
- `ministryEventParts.test.ts` (a new file on `ministryEventCommit.test.ts`'s groq-js harness, as
  the lessons' tests are): M2's refusals one by one (unknown
  part, duplicate part, person on `platica`, two on `oracion`, the same person twice, music on a
  dinámica, helpers on `oracion`, new fields on a free line); the stored label is M0's; M3 (a slot
  swap validates nobody; an added second person who is not in Jóvenes ⇒ 400). M2a: a kind-`ministry`
  meeting holding part lines, saved with the program editor's body, is byte-identical on `part`,
  `note`, `music` and `helpers` and answers no music notice; the same save with those three fields
  changed or missing in the body stores the stored ones; a body with no `part` on a kept part
  line's `_key` ⇒ 400 and nothing is written; removing a line with a standing request answers the
  withdrawal. W10's whole matrix:
  404 for an unreadable or draft meeting, and for a responsable who left Jóvenes (they read it in
  neither mode: step 3 answers before step 4, as W3a's existing test asserts); 403 for a member who
  is not the responsable, for a typed `comparte`, and for the responsable of a joint DRAFT they
  read only as a leader (the member-read clause); a part line on a group's meeting is filled by its
  responsable and announces nothing; the responsable of each part writes; the
  `comparte` holder creates the Plática line; an encargado and an admin write any part; 409 on a
  moved revision; the other lines and seats are byte-identical after the write; a part write never
  changes a person, a label or `published`; all-`null` with no line writes nothing.
- `ministryEventNotices.test.ts`: publish announces everyone but the actor; an edit announces only
  the new pairs; a re-date announces all with `moved`; a draft, a past date and a groups audience
  announce nobody; music asked, withdrawn, unpublished, and said again on a re-dated meeting.
- `ministryEventNotify.test.ts`: the audience of M6 line by line (inactive, not in Jóvenes, no
  email, allowlist, opt-out, redirect, system accounts, the actor), and that it never throws.
- `ministryEventReads.test.ts` (groq-js): the new projection fields; `mine` through either slot.
- `jovenesWorshipSet.test.ts` (groq-js): a draft role hides the setlist; a duplicate shows nothing;
  only `title` and `key` come back.
- The coverage guards stay green: `ministryEventCoverage.test.ts` (the new modules do not name the
  type; the new page imports the reader and caches nothing), `serviceCommitCallers.test.ts` (the
  new route joins the writer's callers), `draftGatingCoverage.test.ts`, `protectedReadAudit`.
- Component tests for U1–U4 (the form model round-trips every part field on a non-Saturday
  meeting); `eventWrite.test.ts` gains the words of `invalid_part`; the two builders join
  `emailTemplateGallery.test.ts` (no content in a subject line; `note`, `helpers` and typed names
  escaped); `ministryEventNotify` joins `DELIVERY_CAPABLE_IMPORTS`; the routes' «the writer sends
  nothing» comments are rewritten.
- Docs in the same delivery: ADR-0090 (the fixed program, «Mi parte», the emails and the setlist
  read; rejected alternatives), an ADR-0081 addendum (W10), `docs/NOTIFICATIONS.md` (a «Jóvenes»
  section), `CLAUDE.md` + `docs/agents/project-rules.md`, `DATA_MODEL.md`, `API_REFERENCE.md`,
  `ROUTES`/`UTILITIES` where they list the planner.

## 9. Shared files with the navigation thread (agreed 2026-11-17)

Mine: the writer, the reader, the schema, the event routes, `ProgramEditor`, `MeetingBody`'s
program, `jovenesDayEntry`, the Saturday editor's form (U4), the new modules and the new page.
Theirs: `/jovenes/page.tsx`, `/jovenes/admin/page.tsx`, the navigation, `MeetingList`,
`MeetingCard`, the planner cards' layout, and a new `jovenesMeetings.ts` that builds the list
items. This PR stands on its own: it adds the setlist read to `/jovenes/page.tsx` and
`/schedule/page.tsx` (one call and one argument each, §6; told to the other thread on 2026-11-17),
and both entrances to «Mi parte» live in files this plan owns (U1, U2). This branch starts from
`main`; whichever branch reaches `preview` second resolves the conflicts, and the setlist call
moves into `jovenesMeetings.ts` then.

## 10. Delivery

One PR: gates (`tsc`, `vitest`, `eslint`), one merge-range code review, `preview` and the dev alias
check, screenshots, then Frank's EXPLICIT word before the PR to `main` merges.

Rehearsing on dev WRITES THE PRODUCTION DATASET while production still runs the old code: check
`vercel env ls preview` for `EMAIL_REDIRECT_TO` first (it is what keeps dev's mail to one address);
rehearse on a throwaway meeting dated beyond the list's horizon and delete it afterwards, never on
a meeting a pastor relies on — the old program editor in production drops `part`, `member2`,
`music` and `helpers` on a save, and anyone assigned during a rehearsal is already in `before`
once production ships, so they would never be mailed.
