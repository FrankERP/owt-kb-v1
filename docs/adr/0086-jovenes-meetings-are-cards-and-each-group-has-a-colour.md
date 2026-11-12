# ADR-0086: Jóvenes meetings are cards, and each group has a colour of its own

**Date:** 2026-11-12 · **Status:** Accepted, amended by ADR-0088 (worship services are cards too; the lit pass has a second site)

## Context

ADR-0070 took the frames off the app: a page is a title, a lede and hairline rows, and Jóvenes
adopted that on 2026-11-10. It works for worship because Inicio shows ONE weekend and a sheet per
day. `/jovenes` and Planear Jóvenes show something else: every meeting of the coming weeks, for
five groups, one under another. As hairline rows that is eight to fifteen blocks of the same grey
text with nothing between them but a 1 px line. Frank's verdict on the result (2026-11-11): «Las
secciones no se distinguen claramente… simplemente parece una tabla con texto», and he asked for
visual information, «no solo texto», and good animations.

Two things were missing, and neither is a matter of spacing:

- **An edge per meeting.** A row list has no objects in it. With many siblings the eye needs a
  boundary to count them by.
- **A way to see WHOSE meeting it is.** The audience was a word in a muted line («Otro Nivel ·
  Invencibles»). With five groups and shared meetings, that is the first question a pastor asks of
  the list, and the app had no colour left to answer it with: cyan is action and navigation, green
  is «tú», amber is Saturday and warnings, violet is specials, rose is the musical key.

## Decision

**The Jóvenes screens draw a meeting as a card**, on `.brand-surface` (the opaque card ground the
app already has), and nothing else changes surface: Inicio, the Calendario, Servicios and every
worship page stay ADR-0070's sheets.

- **The date is a calendar leaf** (`DateTile`): weekday band, day number in the display face,
  month. Eight meetings read as eight days before a word is read. It is a `<time>` whose full date
  is spoken; the three drawn parts are hidden from a screen reader.
- **Five categorical base roles, one per group** — `--group-otro-nivel-rgb`,
  `--group-invencibles-rgb`, `--group-emprendedores-rgb`, `--group-adrenalin-rgb`,
  `--group-guerreras-rgb` (`brand.css` in both themes, `tailwind.config.ts`). Base roles are 73 now
  (68 + 5). `app/utils/jovenesGroupStyle.ts` is the ONE place that turns a group id into classes
  (`groupTone`, `audienceBadges`, `audienceTone`, `audienceRail`), with every class spelled whole
  because Tailwind reads the file as text. A meeting for all of Jóvenes uses the accent; an id the
  registry does not know is neutral.
- **A group's colour is identity, never state and never access.** It tints the audience chip, the
  card's left rail (one segment per group of a shared meeting), the leaf's weekday band and the
  planner's month map. «Publicada» stays green, «Borrador» amber, «tú» green. Which meetings a
  person sees is still `readMinistryEvents`' alone (ADR-0081); the list's filter only hides what
  the reader was already given.
- **Colour is never the only signal**: every group chip carries a two-letter monogram (ON, IN, EM,
  AD, GU — `groupMonogram`) beside the name.
- **People are faces**: the profile photo, or initials in a circle when there is none
  (`PersonAvatar`, the house `initialsOf`; photos since 2026-11-12, see the addendum), a green ring
  on the reader's own, a dashed empty circle for a seat with nobody. The program is a numbered
  timeline. Both live in `JovenesMeetingBody`, which is still the one body of `/jovenes` and of the
  Calendario's `JovenesDayCard`.
- **The next meeting is the featured card**: open, larger from `md`, with its countdown, and lit
  once — it is the single site of `.brand-lit-card[data-lit]`, the border pass that lost its site
  when the worship hero lost its frame. The later meetings fold to a summary (faces, «Programa · N
  partes», «Nota») and open on a tap through `Collapse`; they sit under month labels, and from four
  meetings up a filter row («Todas», «Me toca», one pill per audience) reflows them with
  `AnimatedList`.
- **Planear Jóvenes** keeps its two sections, now headed by `SectionHead` (an icon tile and a
  display title) and drawn as the same cards, with `MonthMap` beside them from `lg`: a small month
  grid with a dot per meeting in its audience's colour, hollow while it is a draft.
- **Motion** uses what exists: the route reveal's stagger on each card, `Collapse` for the fold,
  `AnimatedList` for the filter, the lit pass once, and one new Tailwind animation, `rail-draw`
  (`transform` only, ends on `none`), that draws a card's rail after the card rises.

## Rejected

- **Keeping the hairline rows and adding space or bigger dates.** That was the 2026-11-10 pass; the
  complaint is about it. Space separates two or three blocks, not twelve.
- **Reusing the six `chart-*` hues for groups.** They mean worship seat categories (Lead, BGV,
  Coro…) on the participation chart, there are six for other reasons, and `chart-foh` is a grey.
  A Jóvenes admin who is also a worship admin would see «Lead blue» on a youth group.
- **Deriving a colour from the group id (a hash into a palette).** The colour would move when a
  group is renamed or added, two groups could collide, and neither theme's contrast could be
  tested. Five named tokens are measured in `lightContrast.test.ts`, on the page and on their own
  wash, in both themes.
- **Storing the colour on the group in `ministries.ts` or Sanity.** A stored colour is a value the
  token layer cannot theme (it needs a dark and a light value) and Tailwind cannot see.
- **Photos on the avatars** (rejected in the first pass, REVERSED 2026-11-12, see the addendum).
  Member photos exist, but a meeting's people reach the page only through `readMinistryEvents`'
  projection, the security boundary of ADR-0081, and the first pass did not touch that reader for
  what it took to be decoration.
- **Cards everywhere** (undoing ADR-0070). The sheets are right where a screen holds one thing.
  This ADR is scoped to the two Jóvenes screens, and the Calendario's day sheet keeps its sheet.
- **A real calendar grid as the main view of `/jovenes`.** On a phone a month grid shows dots, not
  who preaches; the list answers the question pastors open the page with. The grid is the planner's
  side map, where the question is «how full is the month».

## Consequences

- A sixth group needs: an id in `ministries.ts`, two token values in `brand.css`, a key in
  `tailwind.config.ts`, a row in `GROUP_TONE`, and its entries in the role lists
  (`tokenLayer.test.ts`, `lightContrast.test.ts`, `scripts/colour-inventory.mjs`).
  `jovenesGroupStyle.test.ts` fails until the tone and the tokens exist; until then the group
  renders neutral, never broken.
- The five hues were chosen by the implementer (blue, violet, teal, orange, fuchsia: far from each
  other, and away from the accent's cyan, the «tú» green, the warning amber and the key's rose).
  If the groups have colours of their own, changing them is ten values in `brand.css`; the
  contrast guard says whether they hold.
- The lit pass has exactly one site again (`litCard.test.ts`). A second one needs an ADR.
- `JovenesMeetingBody` changed for the Calendario's day sheet too (faces, numbered program). That
  is on purpose: one body, so the two screens cannot word or colour a seat differently.
- No read or write changed in the first pass: `ministryEventReads.ts`, `ministryEventCommit.ts`, the
  four event routes and `jovenesPlannerModel.ts` were untouched. The 2026-11-12 addendum then added
  one field (`photo`) to the reader's people; the writers are still untouched.
- Undoing this means going back to rows that Frank rejected; `jovenesPage.test.tsx`,
  `meetingCard.test.tsx` and `monthMap.test.tsx` describe the cards.

## Addendum — the faces are the profile's photos (2026-11-12)

Frank, on seeing the cards: «te faltan las fotos de perfil que ya hay en la sección de alabanza. El
perfil debe ser global, incluyendo la foto y el alias». A pastor who serves in Alabanza already has
a photo there; a circle with «JA» beside it read as a different, emptier account.

- **One profile per person.** The alias was already the name Jóvenes shows (`coalesce(alias,
  member_name)`). The photo now comes from the same two fields every worship surface reads
  (`coalesce(profilePhoto.asset->url, googlePhotoUrl)`), through the seat's own member reference in
  `readMinistryEvents` (ADR-0081's addendum says why that widens nothing). `/me` and `/me/ajustes`
  were already ministry-neutral (`requireActiveSession`), so a Jóvenes-only pastor changes both
  there; the reader's own seat with no photo links to it («+ foto»), as the worship team block does.
- **The photo is a background over the initials, not an `<img>`.** `PersonAvatar` stays neutral (no
  hooks) because the server-rendered day sheet draws it, so it cannot hear `onError` the way
  `TeamSections`' avatar does, and a failed `<img>` paints the browser's broken-image glyph
  (measured in Chromium, with an empty `alt` too). A background that fails paints nothing and the
  initials underneath remain, before hydration as well. The URL goes through `avatarSrc` (a small
  JPEG from Sanity; WebP does not decode in the iOS WKWebView).
- **Rejected: drawing these faces with the worship avatar (`TeamSections`' own).** That one is a
  client component keyed by display name through a `photos` map; Jóvenes knows its people by member
  id from the query, and a name-keyed map would give two pastors called «Ana» one face. So
  `PersonAvatar` stays a second, hook-free avatar, sharing `initialsOf` and `avatarSrc` with it.
- **The face lets a tap through (`pointer-events-none`) and paints only an `https:` URL.** The photo
  needs a positioned box, and a positioned box paints above the fold button's stretched hit area
  over a card's head: without it a tap on a face in a folded card did nothing (review, measured in
  Chromium). The URL is written into a server-rendered `style`, so every character that could end
  the CSS string is escaped, control characters included (a form feed is a CSS newline).
- A typed seat name («Ana», no account) has no profile, so it keeps initials.
