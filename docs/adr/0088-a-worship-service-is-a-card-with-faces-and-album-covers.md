# ADR-0088: A worship service is a card, with faces and album covers

**Date:** 2026-11-12 · **Status:** Accepted · **Amends:** ADR-0070 (the frameless sheet), ADR-0059 (where the day's colour may sit), ADR-0086 (the lit card's one site)

## Context

ADR-0070 (2026-10-23) took every frame off the member's worship screens: Inicio became a title, a
lede and a run sheet on the page; the other services, the Calendario's agenda and `/me` became
hairline rows. ADR-0086 kept that for worship when it gave Jóvenes cards, on the argument that
worship shows ONE thing per screen.

Frank, the day he approved the Jóvenes cards (2026-11-12): «Me gustaría un rediseño también para
la parte de la alabanza. Creo que el problema de que es puro texto también aplica ahí y se ve un
poco plano el diseño al intentar hacerlo simple. Me gustaría hacer uso de más diseño visual con
elementos, gráficos y animaciones».

Looking at the screens with that in mind, the argument of ADR-0086 did not hold:

- **Inicio is not one thing.** It is the next service and one to three more under «Después», each
  a line of grey text between two hairlines. `/me` is the same list for one person, and the
  agenda is every service of two months as rows that spell the whole team out («Lead Liu, Jakey ·
  Keys Mimí · Drums Tony · EG Frank · EG Pato · AG Vega · 5 canciones»).
- **Everything was a word.** The date, the seat, who leads, what is played. The app already had
  faces and did not show them on these screens: 31 of 45 members have a photo (measured on
  production, 2026-11-12). Songs had no picture at all.
- **Mid-week the next service has a team and no songs** (the weekend's roles are published before
  its setlists). The frameless sheet then opened straight on «Equipo», a list of names.

## Decision

**A worship service is one object with an edge**, drawn with the pieces ADR-0086 made for a
meeting, on the three screens a member sees services on. No read or write path changes: the song
schema gains one optional image (`post.albumArt`) and the three service reads project its URL
(`cover`).

- **The next service is a framed card** (`DayCard` with `hero`, on `.brand-surface`): the date as a
  calendar leaf (`DateTile`, large), the day as an uppercase display title, the clock, the
  countdown and «Tú · EG» as chips, the one «Ensayar el setlist», then the sheet's body. `framed`
  is `hero && identity`: a host that already names the service (the Calendario's day sheet on a
  day with one service, an open «Después» card) gets the body alone, with no second frame. The
  one exception is a day with two or more services: the day sheet draws each as a whole framed
  card, head included, because the clock in the head is what tells two same-day sets apart.
  Whatever the host, an open body still says «Diriges: …» to the member who leads a song and
  gives an admin «Mensajes»; only «Ensayar el setlist» is the hero's alone.
- **Every other service is a folded card** (`DayCardDisclosure`; `AgendaView`'s rows): leaf, title,
  clock, chips, and `ServiceFacts` — who leads as faces beside their names, the set as its songs'
  pictures beside the count, or «Setlist pendiente» — said only of a service still to come (a
  past one with no songs stored has nothing pending), and in the row's `aria-label` too. The
  whole team is one tap away; the agenda's full sentence stays in the row's `aria-label`.
- **People are photos** (`app/components/service/Face.tsx`, `FaceStack`): the circle
  `TeamSections` already drew, lifted out. A closed section shows its people overlapped; on the
  card a band or booth face wears its seat's glyph (`SeatIcon`: microphone, keys, drum, guitar,
  sliders), and each section header has its glyph on a tile.
- **Songs have a picture: their album's cover** (`SongCover`, `app/utils/songCover.ts`). It is
  stored on the song (`albumArt`, a Sanity image; `SONG_COVER_GROQ` projects its URL and
  `songCoverUrl` sizes it to a 160 px square and always asks for a JPEG, `fm=jpg` — the Studio
  field takes whatever an editor drags in, and a WebP or AVIF does not decode in the iOS app's
  web view, the rule `avatarSrc` follows), with the song's
  place in the set on its corner. A song without one gets a neutral tile, never a stand-in. An
  editor replaces a cover in the Studio. A medley is a tinted panel labelled «Medley · N canciones
  seguidas» instead of a spine and a «+».
- **The day's colour is the rail and the leaf's band, nothing else** (`SERVICE_TONE`,
  `app/utils/serviceToneStyle.ts`: Saturday amber, Sunday cyan, a special the info blue — the hues
  `TONE_RAIL` already had, spelled as the `AudienceTone` a `DateTile` reads). This widens
  ADR-0059's «only on its rail» by one small part, the leaf's weekday band, and keeps its reason:
  the head's wash is neutral ink, never the hue. Keys stay ink (ADR-0071), «tú» stays the one
  green, cyan stays on what can be pressed.
- **Motion uses what exists**: the route reveal's stagger per card, `rail-draw` on each rail,
  `Collapse` for the fold (the facts close as the body opens), `scale-in` staggered on faces and
  covers, `NumberRoll` on the countdown. **The lit pass gets a second site**: Inicio's next
  service (`<DayCard … lit />`, one host, `app/(client)/page.tsx`). It is never a second lit card
  on one screen: the other site is `/jovenes`. `litCard.test.ts` pins both sites and the one host.
- **Inicio's greeting keeps the title and gives its facts to the card** when the member's own next
  service IS the card under it (`greetingService`): «Te toca el sábado» above a card that says
  «EG · 18:00 · en 3 días» in chips no longer says it twice.
- **`/me`'s «Tu cuenta» rows carry a glyph on a tile** (`AccountRowBody`'s `icon`), and «Después»
  there is the same card stack as Inicio's.

## Rejected

- **Keeping the sheet and adding icons to the text.** That is decoration on a list; the complaint
  is that services are not objects. An icon beside «Lead Liu, Jakey · Keys Mimí…» is still that
  sentence.
- **The Jóvenes `PersonAvatar` for worship faces.** It is initials only by design: a meeting's
  people reach the page through one security-bounded reader that carries no photos (ADR-0081,
  ADR-0086 «Rejected»). Worship's reads already carry `photos`, and a photo needs `onError`
  state, which would make `PersonAvatar` a client component for a screen that has no use for it.
- **The still of the song's YouTube video as its picture.** It was the first version, because it
  needed no data: 126 of 148 songs carry a link and `i.ytimg.com` was already an allowed host.
  Frank on the screenshots (2026-11-12): «Me gustaría más bien poner la imagen del álbum de la
  canción». A still is a 16:9 frame with the lyric video's title painted on it; cropped square it
  reads as a clipping, and an album's cover is the picture people already know the song by.
- **The video still as a fallback for a song with no cover.** A set would be half covers and half
  clippings, which is the look that was just rejected. One neutral tile is quieter than a second
  style of picture.
- **Storing a link to the cover on a music service's CDN** instead of the image. The link can rot
  without anyone noticing, the host would have to be allowed in `next.config.mjs`, and nobody
  could fix a wrong cover without knowing where the next URL comes from. A Sanity image is
  replaced by dragging another one onto the field.
- **Overlapped song pictures** (a stack, like the faces). Three busy covers on top of each other
  read as a smudge; side by side at 28 px they read as a set. Built, looked at, replaced.
- **The day's hue as a wash behind the card's head.** Built and looked at: behind a Saturday it is
  a beige band in light and a brown one in dark — the «warning» reading ADR-0059 removed.
- **Lighting every card, or the folded ones on hover.** One pass on one card is what makes the eye
  land on «next»; a list of passes is noise (ADR-0086's own rule for its list).
- **Moving `DateTile` and friends to `app/components/ui/` in this change.** They are generic now
  that two ministries draw with them, but the Jóvenes change that created them was landing on
  `main` the same day; moving files under an open PR buys a conflict for no behaviour. It is a
  follow-up, and `app/components/service/` holds only what worship added.
- **Redrawing Biblioteca and the song page in the same pass.** Different screens with a different
  problem (a 148-row index, a reader); proposed to Frank as a second part.

## Consequences

- ADR-0070's type scale, small-caps rule and greeting stand; its «no frame» does not, on the three
  screens above. `/admin`, Servicios and the planner are untouched (`MonthGenerator`'s preview
  still renders the plain `DayCard`, which keeps its old header).
- The plain (non-`sheet`) `DayCard` no longer has a two-column `wide` rendering: its only `wide`
  caller was the hero, which is a sheet. `layout="wide"` now means the framed card's body.
- A song's cover is DATA someone has to supply, and its source is **MultiTracks first**. The
  first load (2026-11-12, 03:29Z) matched the catalog against Deezer's public search: 138 of 148
  songs. Frank, the same day, on seeing them: «si puedes hacer que la fuente principal de las
  imágenes sea multitracks.com, estaría mejor». In practice MultiTracks lists the Spanish release of a
  translated song, where Deezer's search had answered with the English album for many. The list is now all 148 songs: 127 take the
  cover MultiTracks shows for their album (82 images, 568 px, the largest it serves; the app draws
  them at 160 px), the Spanish release when there is one; the 21 MultiTracks does not carry
  (Conquistando Fronteras, Caminodevida, most of En Espíritu y En Verdad, a few carols) keep the
  Deezer cover. Every image is a Sanity image asset, and the song → asset links are written by
  `scripts/set-album-art.mjs` from `scripts/data/album-art-2026-11-12.json` (dry-run by default,
  `--apply` with Frank's consent). The loader gives a cover to a song that has none and CHANGES
  one only when the row names the exact asset the song has now (`replaces`, the cover the first
  load wrote): a cover an editor chose in the Studio is never replaced
  (`scripts/lib/album-art-plan.mjs`, pinned by its test). It is a script and not a connector patch
  because the connector validates against the deployed schema, which does not know `albumArt`
  until this change's schema is deployed. A song with no cover draws the neutral tile. A new song has no cover until an
  editor uploads one in the Studio; the app's own song form does not offer the field yet. An image that fails to load falls back to the neutral tile
  (`onError`); the picture is `alt=""` decoration and nothing else on the row depends on it.
- `songSaveCommit` writes a song by `set`/`unset` of the fields it edits, so a save from the app
  or the chat keeps `albumArt`. A future writer that replaces the whole document would drop it.
- A folded card no longer says who plays what in words; that is one tap away. If that proves to
  be what people opened the agenda for, the change is in `ServiceFacts` alone, which all three
  screens share.
- The weekend's standing hour now shows on a folded card (18:00, 11:00), by the feed's one rule
  (`serviceStartTime`); before, only a special carried its clock there.
- Undoing the second `data-lit` site means removing `lit` from Inicio's hero and the site from
  `litCard.test.ts`, not editing the guard to pass.
