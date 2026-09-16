# R4 — Song page → «Práctica» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/posts/[slug]` into a practice surface: the hero key becomes the transposer, the BPM pill taps a visual tempo, the Letra section gains an autoscroll, a sticky practice cluster (title · key · BPM · play) appears when the hero scrolls away, the audio cards get a play/pause morph and an equaliser on the playing track, and the whole page joins the route reveal — spec §12.7 (decision K) plus Part I §5.3.

**Architecture:** The page stays a Server Component. One client provider (`TransposeProvider`) owns the page's single transposition state; the hero pills, the sticky bar and `ChordChart` read it through context (`ChordChart` falls back to local state when rendered alone). Tempo and autoscroll are CSS-clocked and rAF-clocked respectively — no timers, no library. Pure maths live in neutral utils (`app/utils/transpose.ts`, `app/utils/practice.ts`) so the Server Component and the tests can call them (ADR-0028). No new `motion` importer outside `app/components/ui/**`.

**Tech Stack:** Next.js 16 App Router, React 19, `motion` (only under `app/components/ui/**`), Tailwind 3.4, vitest + RTL, `haptic()`.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` §5.3, §12.7, §19.5 (song hero row), §14 row "R4 Song", decision K; Part VIII's deferral note ("the 12-key transposer strip → Song page, decision K"). Part XIV (R4) is written in Task 8.

**Data reality (measured 2026-09-16 on the production dataset, read-only):** 142 songs carry `key` and `bpm`, 127 carry `body` (lyrics), 120 carry a reference link, 6 carry tutorials, **0 carry `chords` (inline chart) and 0 carry `audioTracks`.** So the transposer and the equaliser are capabilities the editors can light up (the song form writes both fields) but no production song exercises today; the tempo pill, the autoscroll, the practice cluster and the reveal apply to nearly every song. Task 3 adds a theme-gallery fixture with a sample ChordPro chart and a sample track so the transposer and the equaliser are visually verifiable on dev without writing to the dataset.

## Global Constraints

- Gates in ONE `&&` chain with the commit (Node 22: `export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH`): `node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint .` (0 errors) then the commit. Every task runs the full suite. **No AI attribution / `Co-Authored-By` trailer on any commit** — the coordinator greps before every push.
- `motion` is importable only under `app/components/ui/**` (`motionImportBoundary.test.ts`). A Server Component never CALLS a value imported from a `"use client"` module (ADR-0028; `clientBoundary.test.ts`) — `revealProps`, `transpose.ts`, `practice.ts`, `songSections` are neutral and may be called; every component below is rendered as JSX only.
- Only `transform` and `opacity` animate (spec §2.2). Durations from tokens: no raw `duration-N` / `transition-all` outside `ui/**` (`rawMotionLiterals.test.ts`, baseline `transitionAll: 7, rawDuration: 0` — never raise it). New keyframes go in `tailwind.config.ts` `keyframes`/`animation` (like `rise`) or `brand.css`, clocked on `--motion-*` / `--ease-*`.
- Reduced motion collapses every animation to one frame through the global `brand.css` rule; nothing here adds its own `@media (prefers-reduced-motion)` query, and every animated state must still READ correctly when frozen (a pressed tempo pill still looks pressed; a playing track still says «Reproduciendo»).
- `Button` for every button that is not a house control's own element (the key dial carries the house class `brand-key-dial`, like `SegmentedControl`'s radios carry theirs — ruling 8 below). `Presence` for every animated conditional. `NumberRoll` for every value that changes in place. Spanish UI. 44 px hit targets on phone (`size="lg"` or `min-h-[44px]`).
- No new `position: fixed` element (the sticky bar is `sticky`, as today). Nothing wraps the page in a transformed ancestor (`reveal.test.ts`). `[data-reveal]` hosts never contain a `fixed` descendant.
- Every seat of transposition state is the provider's: `ChordChart`'s own state is the fallback for a `ChordChart` rendered without a provider (tests, future consumers), never a second live copy on the song page.
- Docs current in the same task; conventional commits with a body that says why.

## Rulings (recorded here so the implementers do not re-litigate them)

1. **The sticky practice cluster lives in the page's own sticky section bar, not in `Navbar`.** §12.7 says "replacing the navbar title slot"; on the phone the navbar's centre is already the song title + cue strip, and on desktop it is the app's navigation links. Taking the desktop centre would remove navigation from the page; taking the phone centre would repeat the title. The bar that already belongs to the song page (`SectionNav`, sticky under the navbar) gains a right-hand cluster that fades in when the hero leaves the viewport. Cost if wrong: the cluster sits ~5 rem lower than the spec pictured.
2. **`ChordChart`'s 12-key strip becomes a ± pair with a `NumberRoll` readout** (§5.3's wording), and the hero dial's 12-key `SegmentedControl` is the full picker (§12.7). Two 12-key pickers on one page is the "too many buttons" smell R3 F3 removed. §12.7's "buttons remain for keyboard users" is satisfied by the ± pair (keyboard-reachable) and by the dial itself (a button + a radiogroup).
3. **The reveal stagger uses the house 40 ms step** (`[data-reveal]`'s `--reveal-i` clock), not §5.3's 30 ms — one clock for every route.
4. **No FAB.** The page keeps `EditSongButton` inline top-right (its comment says why: no float over the lyrics). §5.3's FAB bullet does not apply; the inline trigger gets the press twin like every button.
5. **The chart's transpose crossfade is a CSS `fade-in` on a keyed remount** (`animate-fade-in`, `--motion-fast`), not a `motion` crossfade — `ChordChart` stays outside the import boundary and no exiting copy of the chart overlaps the entering one.
6. **Autoscroll model:** a lyric line is 8 beats (two bars of 4/4), so a section of `L` lines at `bpm` lasts `L × 8 × 60 / bpm` seconds and the speed is `sectionHeight / thatDuration` px/s, clamped to [8, 160] px/s; a song without BPM uses 80. Touching (`touchstart` / `pointerdown` with a non-mouse pointer / `wheel`) pauses; lifting resumes from wherever the finger left the page; reaching the section's end stops and releases the control. The page's own scroll is what moves — `window.scrollTo`, never a transform.
7. **Tap tempo is a CSS animation clocked by a custom property**, `--tempo-period: calc(60000ms / bpm)` set from JS as `${60000 / bpm}ms`; no `setInterval`. A second tap or unmount stops it. `haptic("light")` on the toggle only — a haptic per beat is a metronome app, not a pill.
8. **The key dial is a `<button className="brand-key-dial …">`**, the house chrome the hero already paints, carrying the press twin and the focus ring inline (the same spelling `SegmentedControl` uses on its radios). `Button` has no dial variant and adding one for a single site is the wrong trade.
9. **Deferred, on purpose:** §19.5's "history row press opens the day sheet" (there is no day sheet; the schedule agenda owns that surface — R5/R6 decide); the lyric-section rail eyebrows and the tutorial poster facade (§20 assigns both to R6).
10. **The `SectionNav` bar still renders only when `sections.length > 1`** (unchanged); a one-section song has no practice cluster. Rare (most songs carry letra + historial) and cheap to revisit after Frank's look.

---

### Task 1: Pure maths — `app/utils/transpose.ts` and `app/utils/practice.ts`

**Files:**
- Create: `app/utils/transpose.ts`, `app/utils/__tests__/transpose.test.ts`, `app/utils/practice.ts`, `app/utils/__tests__/practice.test.ts`
- Modify: `app/components/ChordChart.tsx` (import the maths from the util; delete the local copies; keep `export { transposeChord }` re-exported so `app/components/__tests__/transposeChord.test.ts` keeps its import — then move that test file's import to the util and delete the re-export), `docs/UTILITIES_AND_COMPONENTS.md` (two rows under utils)

**Interfaces (produces):**

```ts
// app/utils/transpose.ts — neutral, no "use client", no imports.
export const DISPLAY_NOTES = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"] as const;
export type Note = (typeof DISPLAY_NOTES)[number];
export const NOTE_INDEX: Record<string, number>;            // as in ChordChart today (enharmonics)
export function rootIndex(key: string): number;              // -1 when unparsable
export function noteAt(index: number): Note;                 // wraps mod 12, negative-safe
export function semitonesBetween(fromKey: string, toKey: string): number; // 0..11, 0 when either is unparsable
export function transposeKey(key: string, semitones: number): string;     // "Gm" → "Am"; unparsable → key
export function transposeChord(chord: string, semitones: number): string; // moved verbatim (slash chords)
export function capoSuggestion(soundingIdx: number): { fret: number; shapeKey: Note } | null; // moved verbatim
export const CHORD_RE = /\[[^\]]+\]/;
export function isChordPro(content: string): boolean;        // CHORD_RE.test(content)
```

```ts
// app/utils/practice.ts — neutral.
export const DEFAULT_BPM = 80;
export const BEATS_PER_LINE = 8;
export const AUTOSCROLL_MIN = 8;   // px/s
export const AUTOSCROLL_MAX = 160; // px/s
/** Period of one beat, ms — the tempo pill's `--tempo-period`. Falsy/≤0 bpm → DEFAULT_BPM. */
export function tempoPeriodMs(bpm: number | null | undefined): number;   // 60000 / bpm
/** Autoscroll speed in px/s for a section `heightPx` tall with `lines` lyric lines at `bpm`. */
export function autoscrollPxPerSecond(heightPx: number, lines: number, bpm: number | null | undefined): number;
/** Lines a lyrics body / ChordPro chart will paint — counts non-blank, non-heading lines. */
export function countLyricLines(text: string): number;
```

- [ ] **Step 1: Failing tests.** `transpose.test.ts`: `rootIndex("Gb") === 6`, `rootIndex("H") === -1`; `noteAt(-1) === "B"`, `noteAt(12) === "C"`; `semitonesBetween("G","A") === 2`, `("A","G") === 10`, `("?","G") === 0`; `transposeKey("Gm", 2) === "Am"`, `transposeKey("Db", 1) === "D"`, `transposeKey("", 3) === ""`; `capoSuggestion(rootIndex("Ab"))` → `{fret:1, shapeKey:"G"}`; `capoSuggestion(-1) === null`; `isChordPro("[G]Santo") === true`, `isChordPro("Santo") === false`. Move every case from `app/components/__tests__/transposeChord.test.ts` into this file (same assertions) and delete the old file. `practice.test.ts`: `tempoPeriodMs(120) === 500`, `tempoPeriodMs(0) === 750`, `tempoPeriodMs(undefined) === 750`; `autoscrollPxPerSecond(2400, 30, 120)` → `2400 / (30×8×60/120) = 20`; clamps to 8 and 160; `countLyricLines("# Coro\nSanto\n\n[G]Digno")` → 2.
- [ ] **Step 2: Run, watch them fail** (`npx vitest run app/utils/__tests__/transpose.test.ts app/utils/__tests__/practice.test.ts`).
- [ ] **Step 3: Implement** both utils; make `ChordChart.tsx` import `DISPLAY_NOTES, rootIndex, transposeChord, capoSuggestion, CHORD_RE` from `@/app/utils/transpose` and delete its local copies (`transposeToken`, `NOTE_INDEX`, `OPEN_KEY_IDX` move too). Behaviour of `ChordChart` is unchanged in this task (the a11y test still passes as-is).
- [ ] **Step 4: Gates; commit** — `refactor(song): lift transposition and practice maths into neutral utils`

---

### Task 2: `ChordChart` — controlled transposition, ± pair with `NumberRoll`, keyed fade on transpose

**Files:**
- Create: `app/components/song/TransposeProvider.tsx`, `app/components/song/__tests__/transposeProvider.test.tsx`, `app/components/__tests__/chordChartTranspose.test.tsx`
- Modify: `app/components/ChordChart.tsx`, `app/components/__tests__/ChordChart.accessibility.test.tsx` (the radios test still holds; add the ± names), `tailwind.config.ts` (`keyframes["fade-in"]`, `animation["fade-in"]`), `docs/UTILITIES_AND_COMPONENTS.md`

**Interfaces:**

```tsx
// app/components/song/TransposeProvider.tsx  ("use client")
export interface TransposeState {
  /** The song's own key as written on the document (`post.key`), or null. */
  nativeKey: string | null;
  semitones: number;                 // 0..11
  setSemitones: (n: number) => void; // wraps mod 12
  /** nativeKey shifted by `semitones`; null when nativeKey is null. */
  soundingKey: string | null;
}
export const TransposeContext: React.Context<TransposeState | null>;
export function TransposeProvider({ nativeKey, children }: { nativeKey: string | null; children: React.ReactNode }): JSX.Element;
/** null when rendered outside a provider — `ChordChart` uses this to fall back to local state. */
export function useTransposeOptional(): TransposeState | null;
```

```ts
// tailwind.config.ts additions
keyframes: { "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } } }
animation: { "fade-in": "fade-in var(--motion-fast) var(--ease-out) both" }
```

`ChordChart` changes:
- Reads `useTransposeOptional()`. When present, `semitones` / `setSemitones` come from it; otherwise from the existing `useState`. The `defaultKey` seed logic stays for the local case only.
- The 12-button strip is replaced by a row: `<Button variant="icon" size="lg" aria-label="Bajar medio tono" onClick={() => set(semitones - 1)}>−</Button>`, the readout `<span className="brand-key-dial px-3 font-display text-sm" aria-live="polite"><NumberRoll value={soundingChartKey} /></span>` (where `soundingChartKey = transposeKey(current.key, semitones)`), `<Button variant="icon" size="lg" aria-label="Subir medio tono">+</Button>`, and, when `semitones !== 0`, `<Button variant="pill" size="sm" onClick={() => set(0)}>Original</Button>` inside a `<Presence show={semitones !== 0} variant="fade" as="div">`. Minus/plus glyphs are inline SVGs (a 12 px line and a plus), not text.
- Chart-tab change still resets to 0 (through the provider when present).
- The rendered chart container gets `key={`${activeIdx}-${semitones}`}` and `className="… animate-fade-in"`. Nothing else about the rendering changes.
- The capo pill and the `Switch` stay as they are.

- [ ] **Step 1: Failing tests.** `transposeProvider.test.tsx`: `setSemitones(13)` reads back 1; `setSemitones(-1)` reads back 11; `soundingKey` for `nativeKey:"G"` + 2 is `"A"`; `nativeKey:null` → `soundingKey === null`; `useTransposeOptional()` outside a provider returns null. `chordChartTranspose.test.tsx` (jsdom): renders `<ChordChart charts={[{key:"G",content:"[G]Santo [D]Dios"}]} />`; clicking «Subir medio tono» makes the chord read `Ab`; the readout reads `Ab`; «Original» appears and clicking it restores `G`; the chart container's `className` contains `animate-fade-in` and its `key` changes (assert a fresh DOM node: keep a reference to the container before the click and expect `container.isConnected === false` after). Second test: inside `<TransposeProvider nativeKey="G">`, a sibling that calls `setSemitones(2)` makes the chart read `A` (state is shared, not local). Third: the a11y test's radios still work unchanged.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.** Keep the file's parser and renderer untouched apart from the `key`/class on the container.
- [ ] **Step 4: Gates; commit** — `feat(song): ChordChart transposes from one shared seat with a ± pair and a rolling readout`

---

### Task 3: The hero pills — key dial transposer, tap-tempo pill; theme-gallery fixture

**Files:**
- Create: `app/components/song/SongHeroPills.tsx`, `app/components/song/KeyDial.tsx`, `app/components/song/TempoPill.tsx`, `app/components/song/__tests__/keyDial.test.tsx`, `app/components/song/__tests__/tempoPill.test.tsx`, `app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/SongPracticeFixture.tsx`
- Modify: `app/(client)/posts/[slug]/page.tsx` (hero: wrap everything below `<Navbar>` in `<TransposeProvider nativeKey={post.key ?? null}>`; give the hero `<div id="song-hero" className="brand-song-hero">`; replace the pill row with `<SongHeroPills keyLabel={post.key ?? null} bpm={post.bpm ?? null} timeSig={post.timeSig ?? null} transposable={transposable} />` where `transposable = (post.chords ?? []).some(c => isChordPro(c.content))`), `app/brand.css` (`.brand-tempo-pill` ring + `@keyframes brand-tempo-pulse`), `app/(gallery)/theme-gallery/[theme]/[fixture]/page.tsx` (register `"song"`), `docs/THEME_GALLERY.md` or wherever the fixture list is documented (grep `KidsPlannerFixture` in docs and follow), `docs/UTILITIES_AND_COMPONENTS.md`

**Interfaces:**

```tsx
// SongHeroPills ("use client") — the whole pill row + the transposer drawer under it.
export default function SongHeroPills(props: {
  keyLabel: string | null; bpm: number | null; timeSig: string | null;
  /** true only when the song carries a ChordPro chart — otherwise the key is a static badge. */
  transposable: boolean;
}): JSX.Element;
// Renders: <div className="flex flex-wrap justify-center gap-2.5"> [KeyDial | static key span] [TempoPill | nothing] [timeSig span] </div>
//          then, when transposable: <Collapse open={open} id="song-transposer" className="pt-4">
//             <SegmentedControl size="sm" label="Transponer a" value={soundingKey} onChange={(k) => setSemitones(semitonesBetween(nativeKey, k))}
//                options={DISPLAY_NOTES.map(n => ({ value: n, label: n, ariaLabel: n === nativeKey ? `${n} (original)` : n }))} className="justify-center" />
//          </Collapse>

// KeyDial ("use client")
export default function KeyDial(props: { open: boolean; onToggle: () => void; controls: string }): JSX.Element;
// <button type="button" aria-expanded={open} aria-controls={controls} aria-label={`Tonalidad ${soundingKey}. Transponer`}
//   className="brand-key-dial px-3 font-display text-sm min-h-[44px] select-none transition-[transform,box-shadow] duration-fast ease-out-brand active:translate-y-px active:scale-[0.985] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base data-[open=true]:shadow-[0_0_0_2px_rgb(var(--accent-rgb)/0.35)]"
//   data-open={open}>  <NumberRoll value={soundingKey} />  <ChevronIcon (rotates 180° when open via transition-transform duration-fast) /> </button>
// Reads soundingKey from useTransposeOptional() (falls back to the label passed by SongHeroPills when null).

// TempoPill ("use client")
export default function TempoPill(props: { bpm: number }): JSX.Element;
// <button type="button" aria-pressed={active} aria-label={active ? `Detener tempo, ${bpm} BPM` : `Marcar tempo, ${bpm} BPM`}
//   className="brand-tempo-pill brand-search-console relative flex h-[2.4rem] min-h-[44px] items-center px-3 font-label text-[11px] uppercase tracking-widest text-ink-dim transition-[color,transform] duration-fast ease-out-brand active:translate-y-px active:scale-[0.985] aria-pressed:text-accent focus:outline-none focus-visible:ring-2 …"
//   style={{ "--tempo-period": `${tempoPeriodMs(bpm)}ms` } as React.CSSProperties} data-active={active}>
//   {bpm} BPM </button>
// onClick: setActive(a => !a); void haptic("light").
```

```css
/* brand.css — the tempo ring: a pseudo-element that scales and fades once per beat.
   Only transform/opacity; the period is the pill's own custom property (R4, spec §12.7). */
.brand-tempo-pill::after {
  content: ""; position: absolute; inset: -2px; border-radius: inherit; pointer-events: none;
  border: 1px solid rgb(var(--accent-rgb) / 0.6); opacity: 0; transform: scale(1);
}
.brand-tempo-pill[data-active="true"]::after {
  animation: brand-tempo-pulse var(--tempo-period, 750ms) var(--ease-out) infinite;
}
@keyframes brand-tempo-pulse {
  0%   { opacity: 0.85; transform: scale(1); }
  60%  { opacity: 0;    transform: scale(1.28); }
  100% { opacity: 0;    transform: scale(1.28); }
}
```

The gallery fixture `SongPracticeFixture` renders, inside a `TransposeProvider nativeKey="G"`: the hero block (a copy of the page's hero markup with a fixed title «Canción de muestra», tags, `SongHeroPills keyLabel="G" bpm={120} timeSig="4/4" transposable`), then a `ChordChart` with one sample ChordPro chart (8 lines, a `# Coro` heading), then a `SongAudioSection` with two sample tracks whose `audioFileURL` is a data-URL silent WAV (the gallery has no network). Register `"song"` in the fixture list the way the others are registered; it is what dev-verify will screenshot for the transposer.

- [ ] **Step 1: Failing tests.** `keyDial.test.tsx`: inside a provider with `nativeKey:"G"`, the dial reads `G`, `aria-expanded` is false; after `setSemitones(2)` it reads `A`. `tempoPill.test.tsx`: renders «120 BPM», `aria-pressed="false"`, no `data-active`; click → `aria-pressed="true"`, `data-active="true"`, `style` carries `--tempo-period: 500ms`; second click → false; unmount is clean (no timers: assert `vi.getTimerCount() === 0` under fake timers). `SongHeroPills`: with `transposable:false` no `radiogroup` renders and the key is a `span`; with `transposable:true` clicking the dial opens the drawer (`aria-expanded="true"`, the radiogroup «Transponer a» is reachable) and choosing `A` sets the provider to 2.
- [ ] **Step 2: Run, watch them fail.** **Step 3: Implement**, including the page wiring and the fixture.
- [ ] **Step 4: Gates; commit** — `feat(song): the hero key is the transposer and the BPM pill taps a tempo`

---

### Task 4: The sticky practice cluster (`SectionNav`)

**Files:**
- Create: `app/components/song/PracticeCluster.tsx`, `app/components/__tests__/sectionNavPractice.test.tsx`
- Modify: `app/components/SectionNav.tsx`, `app/(client)/posts/[slug]/page.tsx` (`<SectionNav sections={sections} practice={{ title: post.title, bpm: post.bpm ?? null, track: firstTrack }} />` where `firstTrack` is the first `audioTracks` entry with a URL mapped to an `AudioTrack` — `{ url, title, tone, songTitle, songSlug }` — or `null`), `docs/UTILITIES_AND_COMPONENTS.md`

**Interfaces:**

```tsx
// SectionNav gains:
export interface PracticeInfo { title: string; bpm: number | null; track: AudioTrack | null }
export default function SectionNav({ sections, practice }: { sections: Section[]; practice?: PracticeInfo }): JSX.Element;
// Observes `#song-hero` with one IntersectionObserver (threshold 0): `heroGone = !entry.isIntersecting`.
// Layout: the links row keeps its scroll box; a right-hand slot is ALWAYS rendered
//   (<div className="ml-auto flex shrink-0 items-center gap-2 pl-3 min-h-[44px]">) so the bar's height never changes;
//   inside it: <Presence show={heroGone && !!practice} variant="fade" as="div" className="flex items-center gap-2"> <PracticeCluster {...practice} /> </Presence>

// PracticeCluster ("use client")
export default function PracticeCluster({ title, bpm, track }: PracticeInfo): JSX.Element;
// <span className="hidden lg:block max-w-[24ch] truncate font-display text-sm text-ink">{title}</span>
// {soundingKey && <span className="brand-key-dial h-8 min-w-[2rem] px-2 font-display text-xs"><NumberRoll value={soundingKey} /></span>}   // from useTransposeOptional()
// {bpm && <span className="font-label text-[10px] uppercase tracking-widest text-ink-dim">{bpm} BPM</span>}
// {track && <Button variant="icon" size="lg" aria-label={playing ? `Pausar ${track.title}` : `Reproducir ${track.title}`} onClick={…}> play/pause glyph </Button>}
//   where `const { player, playTrack, togglePlay } = usePlayer(); const isCurrent = player.track?.url === track.url; const playing = isCurrent && player.isPlaying;`
//   onClick: isCurrent ? togglePlay() : playTrack(track).
```

- [ ] **Step 1: Failing tests** (jsdom, mock `IntersectionObserver` with a controllable callback; wrap in `PlayerProvider` and `TransposeProvider nativeKey="G"`): the cluster is absent while the hero intersects; after the observer reports `isIntersecting: false` the cluster renders title (desktop class present), `G`, «120 BPM» and «Reproducir Guía»; clicking play calls `playTrack` with the track (mock `usePlayer` or spy on the provider's `HTMLMediaElement.prototype.play`); with `practice` undefined nothing renders in the slot but the slot node exists (height reserved); the existing section links still get `aria-current`.
- [ ] **Step 2: Run, watch them fail.** **Step 3: Implement.** The bar's link row must stay scrollable and the slot must not shrink below its content (`shrink-0`); on a 390 px viewport with five links the links scroll behind the slot.
- [ ] **Step 4: Gates; commit** — `feat(song): a practice cluster rides the section bar once the hero scrolls away`

---

### Task 5: Audio — play/pause morph and the equaliser on the playing track

**Files:**
- Create: `app/components/ui/Equalizer.tsx`, `app/components/ui/PlayPauseGlyph.tsx`, `app/components/ui/__tests__/equalizer.test.tsx`
- Modify: `app/components/SongAudioSection.tsx`, `app/components/AudioTransport.tsx`, `app/components/song/PracticeCluster.tsx` (use `PlayPauseGlyph`), `app/brand.css` (`@keyframes brand-eq` + `.brand-eq-bar`), `app/components/__tests__/SongAudioSection.test.tsx` (add the equaliser case), `docs/MOTION.md` primitives table (two rows)

**Interfaces:**

```tsx
// PlayPauseGlyph ("use client", under ui/ — it uses Presence)
export default function PlayPauseGlyph({ playing, size = 12 }: { playing: boolean; size?: number }): JSX.Element;
// <span className="relative inline-grid" style={{ width: size, height: size }} aria-hidden>
//   <Presence show={!playing} variant="scale" as="div" className="[grid-area:1/1]"> <PlaySvg/> </Presence>
//   <Presence show={playing}  variant="scale" as="div" className="[grid-area:1/1]"> <PauseSvg/> </Presence>
// </span>

// Equalizer ("use client")
export default function Equalizer({ playing, className = "" }: { playing: boolean; className?: string }): JSX.Element;
// Three bars: <span className="inline-flex h-3 items-end gap-[2px]" aria-hidden data-playing={playing}>
//   <span className="brand-eq-bar w-[3px] rounded-sm bg-accent" style={{ animationDelay: "0ms" }} /> ×3 with delays 0 / 150 / 300 ms
// </span>
// CSS: .brand-eq-bar { height: 100%; transform-origin: bottom; transform: scaleY(0.3); }
//      [data-playing="true"] .brand-eq-bar { animation: brand-eq 900ms var(--ease-in-out) infinite alternate; }
//      @keyframes brand-eq { from { transform: scaleY(0.25) } to { transform: scaleY(1) } }
// The bars are static at 0.3 when not playing; they only ANIMATE while `playing` — the one ambient animation in the app, and it stops with the audio (spec §5.3).
```

`SongAudioSection`: the play button uses `<PlayPauseGlyph playing={isCurrent && player.isPlaying} />` in place of `PlayIcon`; the card's title row gains `<Equalizer playing={isCurrent && player.isPlaying} className="ml-auto" />` (rendered always so the row does not shift; inert when idle). `AudioTransport`: its play/pause button uses `PlayPauseGlyph` (`size={18}`); the icons it drops are deleted. The accessible names do not change (the existing tests pin them).

- [ ] **Step 1: Failing tests.** `equalizer.test.tsx`: `data-playing` follows the prop; three bars render. `SongAudioSection.test.tsx`: the playing card's equaliser has `data-playing="true"`, the other card's is `"false"`. `audioTransport.test.tsx` still passes (names unchanged).
- [ ] **Step 2: Run, watch them fail.** **Step 3: Implement.** **Step 4: Gates; commit** — `feat(song): play/pause morphs and the playing track carries an equaliser`

---

### Task 6: Reveal, press twins, and the navbar-height sync for `loading.tsx`

**Files:**
- Create: `app/utils/navbarHeight.ts`, `app/utils/__tests__/navbarHeightSync.test.ts`
- Modify: `app/(client)/posts/[slug]/page.tsx`, `app/(client)/posts/[slug]/loading.tsx`, `app/components/Navbar.tsx`, `app/components/ui/Skeleton.tsx` (`NavbarSkeleton`), `app/components/EditSongButton.tsx` (inline variant only: add `active:translate-y-px active:scale-[0.985] transition-[color,transform] duration-fast ease-out-brand` if absent — read it first; if it already renders a `Button`, nothing to do), `docs/MOTION.md`

**Interfaces:**

```ts
// app/utils/navbarHeight.ts — neutral. The ONE spelling of the top bar's height;
// Navbar and NavbarSkeleton both import it so loading.tsx never hard-codes it (spec §5.3).
export const NAVBAR_H_CLASS = "h-20 lg:h-24";
```

Page changes (Server Component; `revealProps` is neutral):
- Hero: tag chips wrapper `{...revealProps(0)}`; each chip gains `active:scale-[0.985] transition-[color,border-color,transform] duration-fast ease-out-brand` (replace its `transition-colors`); `<h1 {...revealProps(1)}>`; the author block `{...revealProps(2)}`; the pills (`SongHeroPills`'s wrapper is client — pass `revealIndex={3}` and let it spread `revealProps(3)` on its own root; `revealProps` is a neutral import, legal in a client module too).
- Tutoriales: each card `{...revealProps(i)}`. Referencia: each card gains `active:scale-[0.985] active:translate-y-px transition-[color,transform,box-shadow] duration-fast ease-out-brand`. Historial: each card `{...revealProps(i)}`.
- `loading.tsx`: the hero placeholder uses `brand-song-hero` (parity with the page) and keeps `NavbarSkeleton` first; `NavbarSkeleton` and `Navbar` both read `NAVBAR_H_CLASS`.

- [ ] **Step 1: Failing test.** `navbarHeightSync.test.ts`: reads `Navbar.tsx` and `Skeleton.tsx` sources and asserts both import `NAVBAR_H_CLASS` from `@/app/utils/navbarHeight` and neither contains the literal `h-20 lg:h-24`; asserts `navbarHeight.ts` exports the constant as a string of two Tailwind height utilities. Extend `loadingSkeletons.test.ts` only if it needs the new hero class (it should not).
- [ ] **Step 2: Run, watch it fail.** **Step 3: Implement.** Check `rawMotionLiterals` stays at baseline (the `transition-[…]` spellings with `duration-fast` are tokenised; a `duration-\d+` is not).
- [ ] **Step 4: Gates; commit** — `feat(song): the song page joins the route reveal; the navbar height has one spelling`

---

### Task 7: Autoscroll on the Letra section

**Files:**
- Create: `app/components/song/LyricsAutoscroll.tsx`, `app/components/song/__tests__/lyricsAutoscroll.test.tsx`
- Modify: `app/(client)/posts/[slug]/page.tsx` (`SectionHeader` gains `action?: ReactNode` rendered `ml-auto`; the Letra header passes `<LyricsAutoscroll targetId="letra" bpm={post.bpm ?? null} lines={lyricLines} />` where `lyricLines = hasInlineChords ? countLyricLines(post.chords![0].content) : countLyricLines(lyricsPlainText)` — for PortableText use `post.body.length` blocks as the line count, documented as an approximation), `docs/UTILITIES_AND_COMPONENTS.md`, `docs/MOTION.md`

**Interfaces:**

```tsx
// LyricsAutoscroll ("use client")
export default function LyricsAutoscroll({ targetId, bpm, lines }: { targetId: string; bpm: number | null; lines: number }): JSX.Element;
// <Button variant="pill" size="sm" aria-pressed={running} onClick={toggle}>{running ? "Detener" : "Autoscroll"}</Button>
// Model (ruling 6): on start, measure `const el = document.getElementById(targetId)`; `speed = autoscrollPxPerSecond(el.offsetHeight, lines, bpm)`;
//   rAF loop: `y += speed * dt/1000; window.scrollTo(0, y)` (y seeded from window.scrollY; dt from timestamps, clamped ≤ 50 ms so a background tab does not leap);
//   stop when `el.getBoundingClientRect().bottom <= window.innerHeight` (section end) → running=false;
//   pause on `touchstart` / `pointerdown` (pointerType !== "mouse") / `wheel` on window; resume on `touchend` / `pointerup` (reseed y from window.scrollY);
//   cleanup on unmount and on toggle-off (cancelAnimationFrame + remove listeners). void haptic("light") on toggle.
// Exposes nothing else. `useTransposeOptional()` is not read here.
```

- [ ] **Step 1: Failing tests** (jsdom; stub `requestAnimationFrame` to a controllable queue and `window.scrollTo` to a spy; give the target element an `offsetHeight` of 2400 and a mocked `getBoundingClientRect`): starting scrolls by `speed × dt` on the next frame; a `touchstart` stops further `scrollTo` calls until `touchend`; reaching the section end flips `aria-pressed` back to false and stops calling rAF; unmount cancels the frame (`cancelAnimationFrame` spy); `bpm: null` uses `DEFAULT_BPM`.
- [ ] **Step 2: Run, watch them fail.** **Step 3: Implement.** **Step 4: Gates; commit** — `feat(song): the Letra section scrolls itself at the song's tempo`

---

### Task 8: Docs, spec Part XIV, bundle, shots

**Files:**
- Modify: `docs/MOTION.md` (new "Song (R4)" section under "Where the walk's findings landed", bundle rows), `docs/UTILITIES_AND_COMPONENTS.md` (final pass), `docs/ROUTES.md` (`/posts/[slug]` components column), `CLAUDE.md` + `AGENTS.md` reusable-utils paragraph (`TransposeProvider`/`useTransposeOptional` — "the ONLY transposition seat on the song page"; `transpose.ts`; `practice.ts`; `Equalizer`; `PlayPauseGlyph`; `NAVBAR_H_CLASS`), `docs/superpowers/specs/2026-09-08-premium-motion-design.md` (Part XIV — R4, in Part XIII's shape: Shipped · Rulings with reasons · Review trail · Open notes for Frank's look · Bundle · Release placeholders), shots under `docs/superpowers/specs/2026-09-08-premium-motion-shots/` (`song-before.png`, `song-after.png` phone; `song-after-1440.png`; `r4-gallery-song-transposer.png` from `/theme-gallery/dark/song` with the drawer open; `r4-song-practice-cluster.png` scrolled past the hero)

- [ ] **Step 1:** Write every doc change; the coordinator supplies the bundle numbers (A/B git-archive cold builds) and the shot paths.
- [ ] **Step 2: Gates; commit** — `docs(motion): R4 song page — Part XIV, MOTION.md, utilities`

---

## Self-review (done while writing)

- **Spec coverage.** §12.7: mini-header → Task 4 (ruling 1); key dial transposer → Tasks 2–3; tap tempo → Task 3; autoscroll → Task 7. §5.3: hero reveal + chip press → Task 6; EditSongButton press → Task 6 (FAB: ruling 4); SectionNav → already `SlidingIndicator` (M1); audio morph + equaliser → Task 5; tutoriales reveal → Task 6; referencia press → Task 6; ChordChart tabs/Switch → already; ± with NumberRoll + crossfade → Task 2; historial reveal → Task 6; loading navbar height → Task 6. §19.5 song hero row → Tasks 3 and 6. Deferred items are named in ruling 9.
- **Placeholders.** None: every component has its markup shape, every test its assertions, every util its signature and cases.
- **Type consistency.** `TransposeState` (Task 2) is what `KeyDial`, `SongHeroPills`, `PracticeCluster` and `ChordChart` read; `AudioTrack` comes from `PlayerContext` and is what Task 4's `PracticeInfo.track` carries and `PracticeCluster` hands to `playTrack`; `autoscrollPxPerSecond`/`countLyricLines`/`tempoPeriodMs` (Task 1) are the names Tasks 3 and 7 call; `NAVBAR_H_CLASS` (Task 6) is used by both importers the guard names.
