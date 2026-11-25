# ADR-0089: A Jóvenes meeting has fixed parts, each filled by its responsable, and it emails only the people it assigns

**Date:** 2026-11-17 · **Status:** Accepted

> **Numbering.** `preview` holds an unmerged solver-operations record that was also numbered 0089
> there. Records are numbered in the order they reach `main` (`adrIndex.test.ts` wants them
> consecutive), so this one takes 0089 and that one is renumbered on `preview` when this merges in.
> The plan and its review log were written while this was «ADR-0090»; they mean this record.

## Context

Frank, 2026-11-17: «La reunión siempre tiene la misma estructura: Alabanza […], Oración […],
Dinámica 1 y Dinámica 2 […], Plática». He asked for three things: an assignment email to whoever
gets a role, a place where each responsable loads their own information (a dinámica's description
«de unos 300 caracteres máximo», the youths who help, the talk's topic, and for Oración and Plática
whether they want a track or the worship team: «No especifica quién toque, solo dice que pide
alguien. Eso se me notifica a mí»), and Alabanza's setlist shown on the meeting.

Until now a meeting had seats (`encargado`, `apoyo`, `comparte`) and free program lines that only
an admin or the encargado could write (ADR-0081, W3a), and no write sent anything. Email is the
only channel that reaches people (push: 0 of 36) and it leaves through a free Gmail account
(~500 recipients a day, shared with worship's mail, ADR-0054). Production held 15 meetings and not
one program line (query of 2026-11-17), so nothing needed migrating. Plan:
`docs/superpowers/plans/2026-11-17-jovenes-meeting-parts.md` (critical tier; review log beside it).

## Decision

- **A part is a program line that carries `part`** (`oracion`, `dinamica1`, `dinamica2`,
  `platica`). `app/utils/ministryParts.ts` is the ONE table: label, how many people the line holds
  (1, 2, 2, 0), and whether it takes `music` (`track` | `alabanza`) and `helpers`. A line gains
  `part`, `member2`, `music`, `helpers`; its description is the existing `note` (300). The stored
  label is the table's, at most one line per part, and the writer's `parseProgram` refuses the rest.
- **Who assigns writes people; who is assigned writes the content.** Once a part line exists, the
  program PATCH (and the meeting PATCH) decide its PEOPLE, its place and whether it stays, and
  write its stored `note`, `music` and `helpers` back untouched, whatever the body says
  (`keepFilledParts`). A body that names a stored part line's `_key` without that same `part` is
  refused (400), so a tab still running the code from before this release can never turn a part
  into a free line and drop what its responsable wrote.
- **Plática's people are the `comparte` seats**, never stored a second time on its line.
- **Only the Saturday meeting always shows the five steps** (`hasFixedProgram`); any other meeting
  shows just the parts it holds. A part line is storable on any meeting, so one is never stored and
  invisible, but nothing offers it off a Saturday except Plática to whoever shares.
- **Alabanza is never stored.** It is that date's worship setlist, read by
  `app/utils/jovenesWorshipSet.ts`: titles and keys only, only when that Saturday's role is
  published and neither document is duplicated. It is the one place a Jóvenes pastor sees worship
  data.
- **«Mi parte» is a new write, W10** (`updateMinistryEventPart`, `PATCH …/events/[token]/parts/[part]`).
  Who assigns is unchanged; the part's responsable may now write ITS `note`, `music` and `helpers`
  and nothing else, while they can still READ the meeting as a member (so never a draft, never
  after leaving Jóvenes or the group). The write rebuilds `program` from the stored array with one
  change, under the stored revision. Screen: `/jovenes/reunion/[token]`.
- **Emails: computed by the writer, sent after the response.** `ministryEventNotices.ts` compares
  the row read BEFORE the commit with what the write stores. Only a meeting for all of Jóvenes,
  published and not past, announces: the people the write ADDS (everyone on it when the write
  publishes it or moves its date), never the actor. `ministryEventNotify.ts` narrows that list
  (active Jóvenes member, has an email, allowlist, «Asignaciones» on) and sends «Te toca» with a
  link to the meeting. A request for the worship team, its withdrawal (naming who had asked, even
  when the write removed them with the line), and a request on a re-dated meeting go to the
  super-admins who are people (today, Frank), under «Propuestas».
- **The way in never depends on an email.** Under a part that is the reader's, every place that
  draws the meeting (`MeetingBody`: `/jovenes`, the Calendario's sheet, the planner) links to its
  page; off a Saturday, whoever shares sees a Plática step to fill before its line exists. The
  page offers a form exactly where W10 would accept it: every part to whoever edits the program,
  one's own only on a published meeting.

## Rejected

- **New seats (`oracion`, `dinamica1`…) instead of program lines.** Seats are written only by
  whoever edits the meeting; the encargado, who assigns prayer and dynamics, writes only the program
  (W3a). Seats would have meant widening W3a or taking that job from the encargado.
- **Letting a responsable save through the program PATCH.** That route replaces the whole array:
  a responsable could then rename, reorder or reassign every line. W10 reads three fields.
- **The worship outbox for these emails.** Its sweep is tuned for worship's volume and coalescing
  (`docs/NOTIFICATIONS.md`); a meeting sends at most nine emails, once, and needs no queue.
- **Emailing for group meetings and classes.** «Nuevo libro» creates up to 60 classes in a row;
  each would mail its encargado.
- **A «ya no te toca» email, and a withdrawal when a meeting is deleted.** Out of scope: the link
  of a deleted meeting opens nothing, and unpublishing it does send the withdrawal.
- **Copying the setlist onto the meeting.** It would go stale the moment worship changes a song.
- **Naming the musician in the request.** Frank: the responsable only asks; he decides who plays.

## Consequences

- No debounce and no throttle: switching track ↔ alabanza mails Frank each time, from any
  responsable of that part; taking someone off a part and
  putting them back is a new assignment and mails them again; unpublish then publish announces
  everyone again; publishing a month of Saturdays is one email per Saturday per person. Bounded by
  23 pastors and trusted writers, accepted.
- A dinámica holds at most two people, and only people with an account; anyone else fits in
  «Jóvenes que apoyan». A typed-name «comparte» gets no email and cannot fill the Plática; an
  admin or the encargado fills it for them — on any meeting, because a `comparte` seat with a
  typed name is enough for the meeting's page to offer them the Plática form (`partViews`).
- **A reassigned part keeps what the previous person wrote.** Moving Oración from A to B leaves
  A's description and a standing «alguien de alabanza» under B's name until B edits them, and the
  move mails Frank nothing. Chosen over clearing the three fields when the people change: the
  assigning write would then delete text (a swap made by mistake and undone would lose it) and
  would owe Frank a withdrawal for a request nobody withdrew. B's «Te toca» lands on the form
  with that content in it.
- **The emails are best-effort and sent once.** A send that fails (a Gmail throttle, a timeout) is
  logged and never retried, and a later edit of the note is silent, so the music request can be
  lost; the «Pide alabanza» chip on the meeting is what remains. Accepted against a queue: a retry
  is a second email to the people the first try did reach.
- **Silent on purpose:** a change of `time`, `arrival` or `place` on an announced meeting mails
  nobody (only a new date does). **Wrong but accepted:** changing a published whole-ministry
  meeting to a groups audience stops it announcing, so a standing request is reported to Frank as
  «Ya no piden música» although the line still stores it.
- People already assigned on a published future meeting when this ships were never «added» by a
  write, so they get no email unless the meeting is unpublished and published again.
- Rolling back: the old reader shows a part as a plain line with its first person; the old program
  editor DROPS `part`, `member2`, `music` and `helpers` on its next save of that meeting (the
  description survives). `preview` writes production data while production runs the code before
  this, so rehearse on a throwaway meeting and delete it.
- The setlist read rests on one premise: the worship team's Saturday service of a date IS that
  day's Jóvenes meeting's worship. If a Saturday ever has a different set for Jóvenes, the step
  must stop reading `saturdarSongs`.
- Undoing the member-read clause of W10 lets a seat outlive the right to read, which W3a forbids.

## Addendum, 2026-11-17: reminders two weeks and one week ahead

Frank, the day this shipped: «También debes de mandar correos de recordatorio 2 semanas antes y
una semana antes de cada reunión de jóvenes para que vayan llenando las cosas que tienen
asignadas».

**Decision.** `sendMinistryEventReminders` (`app/utils/ministryEventReminder.ts`) runs every day
inside the daily cron (`/api/cron/service-reminders`, 19:00–19:59 CDMX), before the sweep. It
reads the meetings dated EXACTLY 14 and 7 days ahead and writes one email per person per meeting:

- to whoever answers for a part that still lacks something — `partGaps`
  (`jovenesPartView.ts`), the same rule the cards use for «pendiente»: a dinámica's description,
  Plática's topic and its music, Oración's music (its note is optional). The email names only what
  is missing and links the meeting's page;
- to whoever holds the `encargado` seat of a Saturday meeting when Oración or a dinámica still has
  nobody. Frank did not ask for this one; it is there because a part nobody holds has nobody to
  remind, and the encargado is who assigns those. Plática is left out: its people are seats, which
  the encargado does not write.

The meetings are the ones «Te toca» announces (for all of Jóvenes, published), read by
`readAnnouncedMeetings` — the reader's one query with no person behind it, whose filter is what
EVERY member reads, so it cannot return a group's meeting or a draft. The people pass the same
narrowing as «Te toca» (`assignedAddress`: an active member of Jóvenes, an email, the allowlist,
«Nuevas asignaciones» on).

**Rejected.**

- **Reminding everyone on the meeting.** Frank's reason is «para que vayan llenando»: someone who
  filled their part has nothing to do, and an email that asks for nothing teaches people to
  ignore the next one. It is also the cheaper side of a 500-a-day sender.
- **A window instead of an exact day** («between 14 and 8 days ahead, if not reminded yet»). It
  would survive a day the cron missed, but it needs a stored «already reminded» mark per person
  and meeting — a second writer of the meeting, or a new document type — for two emails. The same
  trade ADR-0080 made; the cost is below.
- **Another hour.** The plan has one Vercel cron a day (ADR-0080). 19:00 on a Saturday is during
  or right after that day's meeting, which is when the people who serve in two weeks are together.
- **Telling the encargado which parts are unfilled.** Their holders are told themselves; the
  encargado hears only of what is theirs to do.
- **A switch of its own.** A reminder is about one's assignment, so it rides «Nuevas
  asignaciones», whose hint now says so.

**Consequences.**

- A meeting published fewer than 14 (or 7) days ahead skips the reminder it is already past, and
  a day the cron does not run is a reminder nobody gets: there is no catch-up. A duplicated cron
  event sends a reminder twice (ADR-0080).
- Someone assigned at 17:00 on a reminder day gets «Te toca» and, two hours later, the reminder.
- A typed-name «comparte» is never written to; when a guest shares alone, nobody is reminded of
  the Plática (an admin or the encargado fills it, as before).
- The step is told what the route already spent and starts no wave of sends once one more send
  timeout would pass `REMINDER_STEP_DEADLINE_MS` (35 s of the route's 60, so the liveness alarm
  that follows keeps a send timeout for its own email); what it leaves is logged
  (`ministry_reminder_skipped`) and lost. The sweep's deadline is derated by both reminder steps
  together, and skipped under ADR-0080's rule.
- `readAnnouncedMeetings` asks nobody's access, so it has one importer by name
  (`ministryEventCoverage.test.ts`): a page that called it would show Jóvenes' meetings to
  someone outside Jóvenes.
- Vercel runs crons on Production only: on `preview` the step runs only when someone calls the
  route by hand with the secret, and then mails the one redirect address.


## Addendum, 2026-11-25: a group's classes tell their holders

Frank: «Puedes hacer que […] los pastores de Otro Nivel reciban notificaciones por correo sobre
sus clases y cambios en el rol? Por ejemplo ahorita voy a hacer un cambio de que este domingo
Marianne vuelve a dar el capítulo 6 del libro y se recorre lo demás».

Until now a class («Clases del grupo», a one-group meeting with a `lesson`) announced nothing, on
purpose: «Nuevo libro» creates up to 60 in a row, and «Te toca» is about whole-ministry meetings.

**Decision.**

- **A change.** The writer computes, from the rows it read BEFORE its commit and what it stores,
  which holders (the member ids in a class's seats) a write changed: a class given to them, taken
  away, or moved (date, hour, place, title, roster) — `classNotices` (`ministryLessonNotices.ts`,
  pure). Create, edit, delete, «Recorrer» and «Cambiar con…» all compute it and return it as
  `effects.classNotices`; the five routes send it in `after()` through `sendClassNotices`. Only an
  ANNOUNCED class counts: published, a real class (not «No hubo clase»), today or later. ONE email
  per person per write, listing every class of theirs it touched: a «Recorrer» of ten classes is
  at most one email per responsable. Never the actor, never a typed name («Todos»).
- **«Nuevo libro» is quiet.** Its creates send `announce: false`; each holder hears from the
  reminders instead of one email per class. The flag can only make a create quieter.
- **A reminder.** The daily cron's Jóvenes step also reminds whoever gives a class dated EXACTLY 7
  and 2 days ahead (a Sunday class: the Sunday before and the Friday), with the class's notes.
- **The audience narrows at send time** like «Te toca» (`assignedAddress`) and, because a class is
  ONE group's, also to people who are, read now, in that group: whoever left hears nothing.

**How the reminder reads, and why not like the meeting reminder.** `readAnnouncedMeetings` reads
only whole-ministry meetings, on purpose: with no person behind it, what every member reads is the
widest it may be (ADR-0081). A class is one group's, so widening that read — or adding a second
no-person read by group — would be the first query that returns a group's meetings to nobody in
particular. Instead the step reads Jóvenes' people and asks `readMinistryEvents` FOR EACH ONE,
with their own access, in member mode, over the two reminded days: a reminder can only name a
class its recipient already reads, and no query shape is added. The cost is one small read per
person who may be written to (~25 a day, six at a time), inside the step's existing deadline.

**Rejected.**

- **One email per class on «Recorrer»** — a ten-class shift would mail the same person five times.
- **Announcing «Nuevo libro» class by class** (up to 60 emails) or with a summary (a third email
  type and an end-of-book call from the client, for an event that happens a few times a year).
- **A per-group switch.** Only Otro Nivel has classes today; a group without a roster sends
  nothing, and a holder can turn the emails off with «Nuevas asignaciones» like every other
  assignment email.
- **Telling the whole group.** The 500-a-day sender, and Frank asked for «sus clases».

**Consequences.**

- A class that moves from one person to another tells both; a swap tells both, once each.
- A change made in the 7 or 2 days before a class is followed by the reminder too, if one falls
  after it; a duplicated cron event sends the reminder twice; no catch-up (as above).
- A class's notes and title are typed text: they appear in the body, escaped, never in a subject.
- Vercel runs crons on Production only: on `preview` the reminders run only by hand. The change
  emails do run on `preview`, to the one redirect address.
