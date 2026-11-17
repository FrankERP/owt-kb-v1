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
