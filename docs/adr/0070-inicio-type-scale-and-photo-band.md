# ADR-0070: Inicio is set on one type scale, with small caps on section titles only, over a team photo

**Date:** 2026-10-23 · **Status:** Accepted

## Context

After the surfaces-and-colour pass (PR #158), the Inicio redesign (#164), thirteen member-screen
items (#172–#182) and seven admin blocks (#184–#190), Frank's verdict on dev was «Se ve mejor, pero
aún no siento que se vea como si hubieran invertido millones de dólares en el diseño». Those passes
were hygiene — consistent primitives, fewer colours, house buttons — and hygiene is invisible.

What was missing is measurable on the old Inicio: a 30 px heading over a page where almost everything
else sat between 10 and 14 px, and tracked 10 px uppercase labels in about fifteen places on one
screen («HOLA, FRANK», «SETLIST», «VOCES · 8», «LEAD», «TONO», the tab bar…). When every label is a
small cap, none of them leads, and the eye has nothing to land on. The frames compounded it: the hero
sat in a lit card, with a bordered setlist panel inside it, with bordered seat panels inside that.

The reference mock «Inicio de millones» (Design canvas, 2026-10-23) put the same content in two
typographic variants on the same layout, phone and desktop. Frank chose B.

## Decision

Inicio (`app/(client)/page.tsx`) and the hero's `DayCard hero` are set on ONE scale, in the SAME three
faces (Advent Pro display, Urbanist body, Jura labels — the font family was never on the table):

- **The greeting is the page's title**, in the display face at 52 px on a phone and 88 px from `md`
  («Te toca el **domingo**»), «Hola, Frank» and the line under it in 17 px body. The line carries the
  seat, the weekend's standing hour and the distance («Eléctrica · 11:00 · en 2 días · 4 canciones»,
  `homeGreeting`), so the card's own countdown pill is gone from the hero. The greeting names the
  member's OWN next service, which is not always the hero (a Sunday Lead, on a week whose next
  service is Saturday), so the sheet keeps ONE identity line in muted body — «Sábado · 24 oct ·
  18:00» — above «Ensayar».
- **Small caps on section titles only** — `SHEET_TITLE` (`app/utils/homeHero.ts`, a neutral module:
  the page is a Server Component and reads it as a string, ADR-0028): 12 px Jura, tracked, muted,
  over «Setlist», «Equipo» and «Después». Everything else on the page is sentence-case body type:
  the team's «Voces · 8» at 17 px semibold, a Voces group as «Lead · 2» in muted body, the setlist's
  artist on its own line, the key as a hairline pill. The card titles elsewhere in the app keep their
  uppercase (Frank's standing rule).
- **Hairlines instead of frames.** The hero is a run SHEET on the page: no lit card, no panel, no
  tone rail, no header of its own; the setlist and the «Después» rows are hairline-divided rows. The
  other surfaces that render `DayCard` (the calendar, the disclosure's open state, admin previews)
  are untouched: `hero`/`sheet` is a prop, the card is the default. A «Después» row opens onto the
  sheet rendering too (`DayCard sheet`): the row names the service, so the open card draws no header.
- **A team photo behind the greeting** — the signature. ONE Studio document, `homeSettings`
  (`sanity/schemas/homeSettings.ts`: `heroPhoto` with hotspot and crop, `heroAlt`), with the FIXED
  id `homeSettings` (a singleton pane in `sanity/structure.ts`, kept out of the global «Create»
  menu), read as `*[_id == "homeSettings"][0]` through the published perspective;
  `heroPhotoSrc`/`heroPhotoPosition` (`app/utils/homeHero.ts`) cap it at 1800 px, ALWAYS as JPEG
  (never WebP — the iOS WKWebView rule the avatars follow; a photo under a scrim has no use for
  transparency), apply the Studio crop as a `rect` and re-express the hotspot (stored against the
  uncropped image) as `object-position` inside it, so the crop keeps the faces on a tall phone band
  and a wide desktop one. A bottom scrim in the page's own ground colour keeps the words readable. Without the document,
  or without a photo, the band is the greeting on the plain page — the photo is never a blocker.

The ratchet that keeps the scale honest is the tests: `dayCard.test.tsx` (hero draws no `h3` and no
pill; «Equipo» is the small-caps title, «Banda» is 17 px sentence case; a sheet row's shape),
`dayCardDisclosure.test.tsx` (`sheet` drops the chrome and the rail), `homeGreeting.test.ts`
(the hour), `homeHero.test.ts`.

## Rejected

- **Changing the font family** (Inter, Geist, a serif display). Frank vetoed it on 2026-10-20 and
  again, implicitly, on 2026-10-23: variant A and B of the mock share the three faces on purpose,
  so the comparison isolates scale, case and frames. The faces were never the problem.
- **Variant A** — the current typography on the new layout (10 px eyebrows, 30 px heading, nested
  cards). Shown side by side so the choice was his, not ours; he chose B.
- **Lowercasing every card title in the app.** The rule is Inicio's, screen by screen from here;
  the uppercase CARD titles stay until Frank says otherwise, and this ADR is not a licence to sweep.
- **A per-service photo** («la foto del equipo del 25 de octubre»). A photo of that Sunday's team
  cannot exist before that Sunday. The band is the team's photo, changed in the Studio when there is
  a better one.
- **A static file under `public/`** for the photo. A PR per photo; the Studio is where an admin
  already edits content, and the hotspot tool is what makes one photo work on both bands.

## Consequences

- The page's largest paint is now an image (`priority`, `sizes="100vw"`, ≤ 1800 px JPEG); without a
  photo nothing is fetched. The `homeSettings` document has to be created once in `/studio` — until
  then the band is text only, which is the designed fallback, not a bug.
- Inicio and the rest of the app now differ in scale. That is the point — the system propagates
  one screen at a time, each with Frank's look on dev — but anyone restyling `DayCard` must check
  both renderings (`hero` and card), and `TeamSections` both label styles (`sheet`).
- The lit card's beam pass (spec §23, `docs/MOTION.md` beam site 5) has no site: a border pass
  needs a border. Its CSS and `--lit-beam` stay in `brand.css` (removing the token would move the
  pinned composed-token count for nothing), and `litCard.test.ts` now asserts that NOTHING sets
  `data-lit` — a framed surface may adopt it again on purpose, never by accident.
- **Canción took the system second (2026-10-23, same thread, branch `claude/project-thread-bkhhgz`):**
  the page's title IS the song's name in the display face (`splitSongTitle` moves a trailing
  «(Original Title)» to the authors' line), the key / BPM / compás pills share one 48 px ring in the
  body face (`KeyDial`, `SongHeroPills`, `TempoPill` `md` — the sheet's `.brand-key-dial` badge and
  the `sm` pill are unchanged), sections are `SHEET_TITLE` headings over hairline rows (`Referencia`,
  `Historial`, the mixes), the lyric wrapper is 17 px body with no `prose`, and the loaded mix row is
  the ONE row that differs: a filled `cta` control, «Tono · BPM · 1:42 / 4:36» from the `<audio>`
  (`formatClock`), and its seek control under the name — the `Waveform` when the mix has peaks, a
  `SeekBar` when it does not (the full-band mix). The play control is `Button`'s new `round` /
  `roundCta` pair (a fixed 44 px circle, so no caller overrides `SIZE.lg` padding from `className`);
  the seek maths is shared (`seekFractionAt` / `seekStep`). Without a lyric the page drops its
  two-column grid and stacks one readable column; `loading.tsx` and the gallery's song fixture
  mirror the new hero, and `.brand-song-hero` (the painted band) is deleted from `brand.css`
  (`tokenLayer.test.ts` 42 → 37 occurrences). Tests: `keyDial`, `tempoPill`, `rehearsalPlayer`,
  `seekBar`, `songTitle`, `formatClock`, `lyricMarkers` (the gallery fixture mirrors the new wrapper).
- **Biblioteca and the song sheet took it third (2026-10-24, same thread):** «Biblioteca» is the
  page's display-face title over one count line, the search is a hairline line beside a round
  «Filtros» pill, the letter headings are the display face in the accent (an index, not a label),
  the rows are hairlines with the key glyph on the left, and the drawer's primary says «Ver N
  canciones». The sheet mirrors the song page's hero (key / BPM / compás rings under CueDialog's
  own title), `SHEET_TITLE` sections over hairline rows («Ensayo», «Audio», «Acordes», «Últimas
  veces tocada») and «Ver la página completa» as its last row. This pass also brought the second
  brand colour: Frank saw the neutral mock as «casi todo blanco y negro» and chose rose for the
  musical key (ADR-0071) — the library row's glyph, the song page's and the sheet's key pills,
  `.brand-key-dial`. Tests: `libraryIndex`, `libraryRow`, `libraryFilters`, `songSheet`,
  `tokenLayer` (37 → 33), `brandCss` (99 → 100), `lightContrast`.
- **Calendario (PR #199) and Disponibilidad / Ajustes / Mi perfil (PR #200) followed on 2026-10-25/26**
  (same thread; the calendar's own decisions are ADR-0067).
- **The Control Room took it on 2026-10-27 (same thread, PR A of the Admin pass):** the TAB is the
  page's title — every panel's `h1` is `PAGE_TITLE` and its count line the new `PAGE_LEDE` (17 px
  body, `app/utils/homeHero.ts`) — and «Control Room» becomes the rail's `SHEET_TITLE` (a small
  label over the strip below `lg`), with sentence-case rail items at 15 px. Servicios: the month
  multi-select is text tabs (`MonthTab` / `formatMonthTab`) instead of pills, the integrity panel's
  clean shape is one 14 px line behind a green dot, the cards keep their uppercase title (Frank's
  standing rule) but say their state as a dot + word instead of a chip, print instruments as running
  text instead of chips, and show a REVIEW action as a small amber flag in the icon cluster
  (`ServiceReviewFlag`) — Frank rejected the big «Revisar datos» button on an incomplete draft («un
  pequeño ícono en alguna esquina»). Participaciones stays the desktop board's first column, unboxed
  (`BOARD_BASE`): he asked why the mock had dropped it. `ReadinessBadge` is deleted. Generar mes,
  Editar mes and Editar servicio are untouched; Propuestas, Miembros and Disponibilidad as hairline
  rows are PR B. Tests: `servicesBoard`, `ServiceReadinessCard`, `participationAlongside`,
  `useIntegrityQueue`, `adminPanelsPolish`, `serviceCardModel`, `servicesOverview`.
- **PR B of the Admin pass (2026-10-27, same thread): Propuestas, Miembros and Disponibilidad as hairline
  rows.** A proposal is a row with the day in the display face, «Domingo 1 de noviembre» at 17 px and
  «Propuesta de Gaby · 4 canciones · Pendiente» at 14 px, folding its setlist, message, thread and actions
  under a chevron (what needs review opens on arrival, history stays folded); Miembros is letter sections
  (the letter in the display face, muted) over rows of photo, alias, «Voz · Líder Dom» and the role as a
  muted word («Sin acceso» in red), its Tipo / Rol / Orden filters in a «Filtros» sheet behind the
  round pill Biblioteca uses, the search a hairline; Disponibilidad says its verdict in the lede («Sin
  conflictos» green) and lists conflicts and upcoming unavailability as rows with the dates as one
  Spanish run («20, 21 y 22 de noviembre», `adminRowCopy.ts`). The availability matrix, Generar mes, Editar
  mes and Editar servicio are untouched. Tests: `adminRowCopy`, `groupMembersByLetter`,
  `proposalsPanelHandoff`, `proposalsPanelThread`, `membersPanelMenu`, `availabilityPanelFailure`.
- **Phase 6 of the Admin pass (2026-10-29, same thread, mock approved «Se ve bien»): Canciones and
  Actividad, the two tabs PR A/B left.** The «Contenido» tab is named after its page, «Canciones»
  (the tab IS the page title): «Agregar» primary, a `SearchLine` beside the «Filtros» pill (Tags /
  Artista in the Biblioteca sheet), and the catalog as hairline rows under a display-face letter —
  title, artist and tags as one quiet line, the key in the display face and the KEY colour
  (ADR-0071: here the song is the protagonist), one menu per row instead of two icon buttons; the
  tag chips, the note icon and the row frames are gone, the song sheets untouched. Actividad: the
  three stat tiles become the lede («21 activos esta semana · 28 este mes · 4 sin entrar»), a new
  Todos / Activos / Inactivos filter (finding who has not come in meant reading 34 rows), and one
  hairline row per person with their photo, the state as dot + word, and the open row's history
  with the provider as a word instead of a coloured badge. The letter rule is ONE function now,
  `groupRowsByLetter` (`app/utils/libraryIndex.ts`), read by Biblioteca, Miembros and Canciones.
  Tests: `adminPanelsPolish`, `activityPanelFailure`, `libraryIndex`.
- **The house controls went sentence case (2026-10-27, same thread, Frank: «cambialos»).** `Button` and
  `SegmentedControl` were label-styled — Jura, uppercase, `tracking-widest` — and every screen of this
  pass overrode them (`normal-case tracking-normal font-body` on a dozen pills) because the mocks set
  every action in the body face at 600. That is the base now: body face, semibold, sentence case, sizes
  up with the case on the theme's own steps (11/13/13 px → xs 13 / sm 15 / sm 15 for `Button`, 11/13 →
  xs/sm for the control) and `leading-tight` so no adopter's row grew. The ~40 bare `<button>`s that
  mirrored the old face (dialog footers, rule-form links, the song FAB, the banner's «Salir») carry
  the same three utilities, so nothing shouts beside a house control. Small caps stay where they are
  LABELS — `SHEET_TITLE`, field labels, `Menu` rows, toasts — and the CARD titles keep their uppercase
  (the standing rule above is untouched: it was about titles, not actions). Guards: `Button.test.tsx`
  and `SegmentedControl.test.tsx` refuse `uppercase`/`font-label` on the base. The theme-gallery VR
  baselines are stale until recaptured on a Mac (`e2e/theme-gallery/README.md`).
- Undoing it means re-adding the eyebrows and frames the mock removed; the tests above will say so.
