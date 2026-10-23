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
  `homeGreeting`), so the card's own countdown pill is gone from the hero.
- **Small caps on section titles only** — `SHEET_TITLE` (`DayCard.tsx`): 12 px Jura, tracked, muted,
  over «Setlist», «Equipo» and «Después». Everything else on the page is sentence-case body type:
  the team's «Voces · 8» at 17 px semibold, a Voces group as «Lead · 2» in muted body, the setlist's
  artist on its own line, the key as a hairline pill. The card titles elsewhere in the app keep their
  uppercase (Frank's standing rule).
- **Hairlines instead of frames.** The hero is a run SHEET on the page: no lit card, no panel, no
  tone rail, no header of its own; the setlist and the «Después» rows are hairline-divided rows. The
  other surfaces that render `DayCard` (the calendar, the disclosure's open state, admin previews)
  are untouched: `hero`/`sheet` is a prop, the card is the default.
- **A team photo behind the greeting** — the signature. ONE Studio document, `homeSettings`
  (`sanity/schemas/homeSettings.ts`: `heroPhoto` with hotspot, `heroAlt`), read as
  `*[_type == "homeSettings"][0]`; `heroPhotoSrc`/`heroPhotoPosition` (`app/utils/homeHero.ts`) cap
  it at 1800 px as JPEG (never WebP — the iOS WKWebView rule the avatars follow) and turn the
  hotspot into `object-position`, so the crop keeps the faces on a tall phone band and a wide desktop
  one. A bottom scrim in the page's own ground colour keeps the words readable. Without the document,
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
- Undoing it means re-adding the eyebrows and frames the mock removed; the tests above will say so.
