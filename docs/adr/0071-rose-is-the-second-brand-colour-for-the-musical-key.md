# ADR-0071: Rose is the second brand colour, and it means the musical key

**Date:** 2026-10-24 · **Status:** Accepted

## Context

The «Inicio de millones» system (ADR-0070) took the colour out of the screens it reached: one
cyan accent for navigation, state and action, everything else ink on the dark ground. The
Biblioteca mock built that way lost the three accents the live page had (cyan index letters,
the cyan key chip, tag chips on a tinted ground) and Frank's reaction, 2026-10-24 01:00Z, was
«casi todo blanco y negro, faltan los acentos de color». Painting more things cyan was not the
answer: «no quisiera desperdiciar el cyan, pero tampoco monocromático» (01:05Z). The app
needed a second hue, and a second hue without a rule reads as an accident the moment it
appears on one screen and not the next.

Every other hue in `brand.css` already means something: amber is Saturday's rail and the
warnings, violet the special services and the info states, green and red positive and negative,
orange availability, yellow recency. A warm gold was mocked first; next to Saturday's amber
rail on a day card it made the whole card read warm, and the day stopped owning its colour.

## Decision

- **One new base role, `--key-fg-rgb`** — rose `227 155 198` (#E39BC6) in dark, `163 63 117`
  (#A33F75, 5.6:1 on the light page) in light; Tailwind `key-fg` (`text-key-fg`). Registered in
  `tokenLayer.test.ts` and measured by `lightContrast.test.ts`.
- **Its ONE job is the musical key, wherever the song is the protagonist:** the library row's
  key glyph (`LibraryRow`), the song page's key pill (`SongHeroPills`, `KeyDial`) and history
  pills, the song sheet's key pill and history pills (`SongSheet`), and `.brand-key-dial`
  (`ChordChart`, `PracticeCluster`). Never a state, an alert, a button, a link or «tú».
- **Inside a day card the key stays ink** (`DayCard`'s `SongRow`): the card's day already owns
  its colour through the 3 px rail (ADR-0059, ADR-0067), and rose beside amber or violet would
  compete with it. The key is rose where there is no day on screen.
- Frank chose the rose over gold from a swatch and a Biblioteca board (01:17Z: «Me gusta el
  rosa, podemos irlo integrando poco a poco»). The rollout is gradual by screen, but the rule
  above applies in full from the first screen.

## Rejected

- **More cyan.** Variant B of the mock painted every key cyan: twenty cyan glyphs a screen turn
  the accent into wallpaper, and a cyan key beside the rail's active letter and the tab bar's
  active tab — both «you are here» — says nothing.
- **Gold (#E3C58B).** Premium against navy, but the same family as the Saturday amber and the
  warning amber; on a Saturday card the keys and the rail blurred into one warm object.
- **Rose everywhere, day cards included.** More consistent on paper; in practice the second
  colour would meet the day colour on every service card, which is exactly where a reader asks
  «what does this colour mean?».

## Consequences

- A new hue in the palette means a new token in BOTH theme blocks (`brandCss.test.ts` pins the
  parity count at 100) and a light value chosen for contrast, not by inverting the dark one.
- `.brand-key-dial` no longer uses the accent, so `tokenLayer.test.ts`'s rule-body pin moves
  37 → 33; the key chip in `ChordChart` and `PracticeCluster` turns rose with no code change.
- Any future surface that shows a key must choose: rose when the song is the subject, ink when
  the day is. Adding rose to anything that is not a key reopens this record.
