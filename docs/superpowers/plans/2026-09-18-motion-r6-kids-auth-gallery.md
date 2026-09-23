# R6 — Kids, auth, errors, gallery (+ the song-page deferrals) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The last product surfaces adopt the primitives and the motion rules: the Kids member page and the Kids planner (Buttons, `useToast`, `Skeleton`, `DateField`, a controlled `SeatPicker`, the shared drop-target pattern, a landing pop, name crossfades, `AnimatedList`/`Presence` on the roster), the sign-in and the three fallback pages (reveal stagger, `Button`, a `rise`ing alert, a busy submit), the two song-page items R4 deferred (lyric section eyebrows at a 62 ch measure with dim repeat markers; click-to-load tutorial posters), and the theme gallery becomes a real visual-regression baseline (a `nav` fixture, the `controls` gaps closed, a Playwright spec with committed baselines, a motion-on spec for the fixed-ancestor trap, a `test:vr` script).

**Architecture:** Nothing under `kids/`, `auth/`, `error.tsx`, `not-found.tsx` or a gallery fixture imports `motion` (`motionImportBoundary`). Every effect the spec asks for is reached through a `ui/**` primitive (`Presence`, `AnimatedList`, `Skeleton`, `Button`, `CueDialog`, `DateField`) or through CSS (`revealProps`, `animate-rise`, `animate-fade-in`, a new `animate-pop`). Server Components (`/kids`, `not-found`) spread `revealProps` and render the neutral `Button`. Toasts go through the ONE `ToastProvider` already mounted in `app/utils/Provider.tsx`; the three inline `useTransientValue` flashes in the kids components go away (the dirty banners stay — they are state, not flashes). The VR harness stays read-only and opt-in (ADR-0014/0017); baselines are committed PNGs captured on darwin against a local `next start`.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 3.4, `motion` under `ui/**` only, vitest + RTL, Playwright 1.62 (`playwright.vr.config.ts`, chromium already installed).

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` §5.9 (line ~259), §5.10 (~269), §5.11 (~274), §19.5 rows "Lyrics block"/"Tutorial embeds" (~710), decision P (~738), §20 "R6" line (~728), Part XIV ruling 9 (~1754, the deferral). Part XVI (R6) is written in Task 9.

**Survey facts the plan relies on (2026-09-18, `r6-recon.md`):** `SeatPicker` is ALREADY a `CueDialog mode="sheet"` — only its literal `open` remains (one of the 6 `cueDialogMount` sites; baseline → 5). `ToastProvider`, `MotionProvider`, `CueDialogProvider` reach every `(client)` route including `/auth/*`, `error.tsx`, `not-found.tsx`. `revealProps` (`app/utils/reveal.ts`) is neutral and server-callable. There is NO CSS `pop` keyframe (only `rise`/`fade-in`/`scale-in`/`shimmer`); `SPRINGS.pop`/`settle` are JS-only. `rawMotionLiterals` is 5/0 with no kids/auth site. `inputFontSize` excludes `kids/` by path but NOT `auth/signin` (its inputs already carry `text-[16px] sm:text-sm`). `tokenLayer` pins 62 `rgb(var(--role-rgb) / a)` occurrences in `brand.css` — a new rule of that shape raises the pin. `themeGallery.test.ts:134` pins the six-fixture tuple verbatim and `:144-196` asserts every fixture is hermetic (no `useSession`/`next-auth`/`fetch`/Sanity/env). `BottomNav` reads `useSession` + `usePathname`, so it cannot be hosted as-is. `e2e/theme-gallery/` holds only a README; `playwright.vr.config.ts` has no snapshot settings and no `test:vr` script exists. `kidsPlanner.test.tsx` queries by ACCESSIBLE NAME and pins `min-h-[56px]` on seat rows. The tutorial iframe uses `tutorial.url` verbatim; `extractYouTubeId` lives in `app/utils/practiceVideo.ts`; `next.config.ts` `images.remotePatterns` has no `i.ytimg.com`. `labelBudget` pins `"títulos"` as a bare substring at 0.

## Global Constraints

- Gates in ONE `&&` chain with the commit (Node 22: `export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH`): `node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint .` (0 errors) then `git add <files> && git commit`. Every task runs the full suite. **No AI attribution / `Co-Authored-By` trailer.** Never pipe a gate through `| tail`/`| head`.
- `motion` only under `app/components/ui/**` (+ `GalleryMotion.tsx`). A Server Component never CALLS a `"use client"` export (ADR-0028).
- Only `transform`/`opacity` animate; durations from tokens; no new `transition-all`/`duration-N` outside `ui/` (baseline 5/0 — never up).
- `Button` for every action button (`size="lg"` = the 44 px touch target on a phone), `Skeleton` for every placeholder, `useToast` for every flash, `CueDialog open={x}` for every dialog, `Presence`/`AnimatedList` for animated conditionals/lists, `DateField` for every month input, `revealProps` for route reveal. A full-width LIST ROW whose body is multi-line content (a seat row, a picker option) stays a semantic `<button>` with `transition-colors` — `Button` has no row variant and a row is not a button (ruling 4).
- Spanish copy; no new eyebrow labels (decision N); never the substring «títulos».
- `published == true` on every `kidsSchedule` read (ADR-0022) — R6 touches no read.
- Docs current in the same task; conventional commits with a body that says why.

## Rulings

1. **`pop` is CSS.** A `pop` keyframe (`scale(0.92)`→`scale(1.04)`→`none`, opacity 0→1) joins `tailwind.config.ts` beside `rise`, on `--motion-slow` with `--ease-out`, `both`. The «Te toca» pill and a chip that just landed use `animate-pop`; the JS `SPRINGS.pop` stays for `ui/**`. Cost if wrong: a spring-shaped curve is not a spring — accepted, a 320 ms CSS overshoot reads the same at pill size.
2. **Drag on the kids board stays HTML5 drag (ADR-0012)**; the "lift" is the source chip at `opacity-30` + `scale-95`, the landing is `animate-pop` on the chip whose cell just changed (keyed by `${date}-${seat}-${pairId}`), and the existing dashed valid-target highlight is kept and named as the shared pattern in MOTION.md. No landing beam: a beam on a 20 px chip is noise. Cost: none a member notices.
3. **Toasts:** `useToast` replaces the three inline `useTransientValue` flashes (KidsPlanner, PairRoster, KidsAvailabilityPanel); `hold: true` carries the 409 conflict message that must persist. The «Cambios sin guardar» banners stay inline. Tests wrap in `ToastProvider` and assert on the toast text (still `role="status"` — the primitive's viewport carries it).
4. **Rows are not buttons.** Seat rows (`KidsSundayCards`), picker options (`SeatPicker`), the «Quitar» row and the board cells keep their `<button>` element and class strings (44/56 px floors pinned by tests). Every OTHER button (month arrows, Generar/Otra opción/Guardar, Publicar/Despublicar, Crear pareja, Retirar/Reactivar/Confirmar/Cancelar, Guardar disponibilidad, Planear Kids, sign-in Google/submit, the four fallback-page actions) becomes `Button`.
5. **Month navigation = `DateField kind="month"` with `onStep`** in `KidsPlanner` and `KidsAvailabilityPanel` (the primitive draws the arrow pair, `aria-label="Mes anterior"/"Mes siguiente"` — the test names survive). The month body remounts keyed by month with `animate-rise` (§5.2's "slide" is a rise here, as R5 ruled for tabs). `ScheduleHeader`'s no-`onStep` ruling is its own (its arrows page by href).
6. **`SeatPicker` is controlled** (`open` prop; mounted always; `KidsPlanner` keeps the last `picking` in a ref so the sheet's exit still has content). `cueDialogMount` 6 → 5.
7. **PairRoster:** rows through `AnimatedList` (reflow on create/retire); the inline retire confirm inside `Presence variant="rise"`; no CueDialog — retiring is reversible (it says so), unlike revoking access (decision O).
8. **Sign-in stagger** uses `revealProps` indices: lockup 0, panel 3 (= 120 ms), Google 4, email 5, password 6, submit 7. The beam (`.brand-stage-hero::before`) stays. The error alert is `Presence variant="rise"`. Submit: `Button variant="primary" size="lg" busy={loading} busyLabel="Entrando…"`. Inputs keep `text-[16px] sm:text-sm`.
9. **Lyrics:** single column at a `max-w-[62ch]` measure (the `sm:columns-2` split goes — a 62 ch measure does not fit two columns and the spec centres ONE block); `h1–h4` lyric headings render as rail eyebrows (`font-label text-[11px] uppercase tracking-[0.24em] text-accent/80`, first with no top margin); `//` repeat markers become a dim glyph (`<span className="text-ink-dim/70" aria-label="repetir">//</span>`) in BOTH renderers through one neutral helper `dimRepeatMarkers` in `app/utils/lyricMarkers.tsx`. The chart's `# Section` labels adopt the same eyebrow class.
10. **Tutorial poster** = new `app/components/song/TutorialPoster.tsx` (client): `extractYouTubeId(url)`; with an id it renders a `next/image` poster (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`, `fill`, `sizes`) under a centred `Button variant="primary" size="lg"` «Reproducir»; on press the iframe (`https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0`) mounts inside `Presence variant="fade"`; with NO id it renders today's raw iframe unchanged. `next.config.ts` gains the `i.ytimg.com` remote pattern.
11. **Gallery `nav` fixture** hosts `SectionNav` (already hermetic) and a `BottomNavBar` — the presentational half split out of `BottomNav` (props: `tabs`, `activeHref`, `moreRows`, `moreOpen`, `onMore`, `onNavigate`); `BottomNav` keeps the session/pathname/measurement logic and renders `BottomNavBar`. The fixture opens the «Más» sheet on mount. `bottomNavOffsetSync.test.ts` and `BottomNav` tests keep passing because the DOM is unchanged.
12. **`controls` fixture** adds a `Skeleton`/`SkeletonGroup` row, a `Menu` captured OPEN (the fixture clicks its own trigger in an effect; `Menu` gains no prop), `pill tone="availability"`, `icon tone="danger"`, and `size="sm"` primary/secondary.
13. **VR policy:** `playwright.vr.config.ts` gains `snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{platform}/{arg}{ext}"`, `expect.toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" }`, two projects (`desktop` 1280×900, `phone` 390×844 mobile emulation). `e2e/theme-gallery/gallery.spec.ts` captures every theme × fixture on both projects (`fullPage` for `swatches`/`controls`/`song`/`kids-planner`/`nav`, viewport for `dialog`/`planner`) and asserts the README's three paint facts. `e2e/theme-gallery/motion-on.spec.ts` loads `/theme-gallery/dark/dialog#motion`: `GalleryMotion` strips `data-motion` in a layout effect when the hash is `#motion` and leaves `skipAnimations` false; the spec captures t=0 (dialog attached) and t=end (`document.getAnimations()` all finished) as ATTACHMENTS (not compared) and asserts no ancestor of `[role="dialog"]` has a computed `transform` other than `none` and the panel's rect sits inside the viewport. Baselines are committed under `e2e/theme-gallery/__screenshots__/` (darwin only; CI does not run VR — ADR-0014). `npm run test:vr` = `playwright test -c playwright.vr.config.ts`; the two env vars are documented in `docs/DEV_VERIFY.md` (they are public config, not secrets).
14. **Deferred, on purpose:** kids `loading.tsx` (the admin page is one round trip and the member page is fast; `loadingSkeletons` list untouched); planner-cell motion (M7b); a `kids` `hover` state in VR (a still frame cannot show hover); the R4 "history row press opens the day sheet" (there is still no day sheet — R7 shipped no sheet; parked again, recorded in Part XVI).

---

### Task 1: Kids planner — controls, toasts, skeleton, month field, controlled SeatPicker

**Files:**
- Modify: `app/components/kids/KidsPlanner.tsx` (toolbar `:575-635`, toast `:653-664`, skeleton `:666-674`, picker mount `:690-703`)
- Modify: `app/components/kids/SeatPicker.tsx` (`:41-47` → controlled `open`)
- Modify: `app/utils/__tests__/cueDialogMount.test.ts` (`BASELINE` 6 → 5, dated note)
- Modify: `app/components/kids/__tests__/kidsPlanner.test.tsx` (wrap in `ToastProvider`; toast assertions)
- Test: `app/components/kids/__tests__/kidsPlanner.test.tsx`

**Interfaces:**
- Consumes: `Button` (`app/components/ui/Button.tsx`: `variant`, `size`, `busy`, `busyLabel`), `useToast` (`app/components/ui/Toast.tsx`: `toast({ message, tone, hold })`), `Skeleton`/`SkeletonGroup` (`app/components/ui/Skeleton.tsx`), `DateField` (`app/components/ui/DateField.tsx`: `kind="month"`, `value`, `onChange`, `onStep`, `aria-label`).
- Produces: `SeatPicker` prop `open: boolean` (replaces mount-conditional rendering); `KidsPlanner` keeps `boardProps` unchanged for Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `kidsPlanner.test.tsx` (inside the existing `describe("KidsPlanner")`, using its existing `renderPlanner()` helper — read the file first; if the helper renders without a provider, change it to `render(<ToastProvider>{ui}</ToastProvider>)` once, for every test):

```tsx
it("reports a saved month through the toast stack, not an inline paragraph", async () => {
  // arrange as the existing "picker assignment marks dirty" test does, then save
  // (mock fetch → PUT ok); the message lands in the shared toast viewport
  expect(await screen.findByText("Borradores guardados.")).toBeInTheDocument();
  expect(document.querySelector("[data-toast-root]")).not.toBeNull();
});

it("keeps the seat picker mounted and closed when nothing is being picked", () => {
  renderPlanner();
  const dialog = document.querySelector('[role="dialog"][aria-label*="—"]');
  // CueDialog renders its shell only while open — a closed controlled dialog is absent
  // from the a11y tree but the KidsPlanner tree carries no conditional around it:
  expect(dialog).toBeNull();
});

it("shows Skeleton placeholders while a month loads", async () => {
  // click «Mes siguiente» with a fetch mock that never resolves
  expect(screen.getByRole("status", { name: /cargando/i })).toHaveAttribute("aria-busy", "true");
  expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0);
});
```

Use the real message strings from `KidsPlanner.tsx` `:524` (`showToast({ kind: "ok", text: … })`) — copy them verbatim into the assertions.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run app/components/kids/__tests__/kidsPlanner.test.tsx`
Expected: the three new `it`s FAIL (no `[data-toast-root]`, `.animate-pulse` present, `useToast` throws outside a provider once the component changes).

- [ ] **Step 3: Implement**

`KidsPlanner.tsx`:
- Replace `const [toast, showToast] = useTransientValue<Toast>(null, 5000);` with `const { toast } = useToast();` and each `showToast({ kind, text })` with `toast({ message: text, tone: kind })` (`kind: "ok" | "error"` maps 1:1 to `ToastTone`). Delete the `Toast` type and the inline `{toast && (<p role="status" …>)}` block. Remove the `useTransientValue` import.
- Toolbar:
```tsx
<div className="flex items-center gap-2">
  <DateField
    kind="month"
    aria-label="Mes"
    value={month}
    disabled={busy}
    onChange={(e) => { if (e.target.value) void loadMonth(e.target.value); }}
    onStep={(d) => void loadMonth(shiftMonth(month, d))}
  />
</div>
<div className="flex flex-wrap items-center gap-2">
  <Button variant="secondary" size="lg" onClick={() => generate("fresh")} disabled={busy} busy={generating} busyLabel="Generando…">Generar mes</Button>
  {option > 0 && <Button variant="ghost" size="lg" onClick={() => generate("alternative")} disabled={busy}>Otra opción</Button>}
  {option > 0 && <span className="font-label text-[11px] uppercase tracking-widest text-ink-muted">Opción {option}</span>}
  <Button variant="primary" size="lg" onClick={saveDrafts} disabled={busy || !dirty} busy={saving} busyLabel="Guardando…">Guardar borradores</Button>
</div>
```
  (`DateField`'s `onStep` buttons are `variant="icon"` with `aria-label="Mes anterior"`/`"Mes siguiente"` — the existing tests keep finding them. If `DateField` renders `size="md"` icon buttons, pass nothing: the field is a desk control; the arrows are ≥ 36 px and the phone planner's primary input is the seat row, not the month arrow.)
- Skeleton:
```tsx
{loadingMonth ? (
  <SkeletonGroup label="Cargando el mes" className="space-y-3">
    {[0, 1, 2, 3].map((i) => <Skeleton key={i} rounded="lg" className="h-32 w-full" />)}
  </SkeletonGroup>
) : …}
```
- Month body keyed remount: wrap the `<KidsRotationBoard …/><KidsSundayCards …/>` fragment in `<div key={month} className="animate-rise space-y-5">`.
- Controlled picker: add `const lastPick = useRef<typeof picking>(null); if (picking) lastPick.current = picking;` and render ALWAYS:
```tsx
<SeatPicker
  open={picking !== null && pickingView !== null}
  seatView={pickingView ?? (lastPick.current ? seatOf(lastPick.current.date, lastPick.current.seat) : EMPTY_SEAT_VIEW)}
  seatLabel={KIDS_SEAT_LABELS[(picking ?? lastPick.current)?.seat ?? "ensenanza"]}
  dateLabel={formatSunday((picking ?? lastPick.current)?.date ?? "")}
  …
/>
```
  where `EMPTY_SEAT_VIEW: SeatView = { assignedPairId: null, options: [], unfillableReason: null }` (check `SeatView` in `app/utils/kidsPlannerView.ts` for the exact field set and match it). Guard `formatSunday("")` — if it throws on an empty string, pass `"—"` instead.

`SeatPicker.tsx`: add `open: boolean` to the props and render `<CueDialog open={open} …>`. The gallery's `app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/KidsPlannerFixture.tsx` also hosts `SeatPicker` — pass `open` there (`true`, it is captured open) or `tsc` fails.

`cueDialogMount.test.ts`: `const BASELINE = 5;` with a comment line `// 6 → 5 (2026-09-18, R6 Task 1): SeatPicker is controlled — KidsPlanner keeps it mounted.`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/components/kids app/utils/__tests__/cueDialogMount.test.ts`
Expected: PASS (adjust any existing `it` that asserted on the inline `<p role="status">` — the text is now in the toast viewport; `findByText` still finds it).

- [ ] **Step 5: Gates and commit**

```bash
export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH && node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint . && git add app/components/kids/KidsPlanner.tsx app/components/kids/SeatPicker.tsx app/components/kids/__tests__/kidsPlanner.test.tsx app/utils/__tests__/cueDialogMount.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json && git commit -m "feat(kids): the planner's controls are Buttons, its flashes are toasts, its month is a DateField and the seat picker is controlled"
```
(body: why — one toast stack app-wide, the 5 s inline clock lost failures; `cueDialogMount` 6 → 5.)

---

### Task 2: Kids board and cards — drop target, landing pop, crossfade, publish Buttons

**Files:**
- Modify: `tailwind.config.ts` (`keyframes.pop`, `animation.pop`)
- Modify: `app/components/kids/KidsRotationBoard.tsx` (publish toggle `:145-157`; cell class `:191-197`; chip key)
- Modify: `app/components/kids/KidsSundayCards.tsx` (publish toggle `:54-66`; chip wrapper key)
- Modify: `app/components/kids/PairChip.tsx` (`dragging` lift; new `landed?: boolean`)
- Modify: `app/components/kids/SeatPicker.tsx` (no class changes to rows; nothing else)
- Test: `app/components/kids/__tests__/kidsPlanner.test.tsx`, `app/utils/__tests__/tailwindMotion.test.ts` (new)

**Interfaces:**
- Consumes: `KidsBoardProps` (`kidsBoardProps.ts`), `Button`, `animate-pop` (this task).
- Produces: `PairChip` prop `landed?: boolean` → `animate-pop`; the class string `border-accent/40 border-dashed bg-surface-accent-faint` is the shared "valid drop target" and is documented (Task 9).

- [ ] **Step 1: Write the failing tests**

`app/utils/__tests__/tailwindMotion.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import config from "../../../tailwind.config";
describe("tailwind motion utilities", () => {
  it("declares pop on the slow token with an overshoot and a none end state", () => {
    const kf = (config.theme?.extend?.keyframes as Record<string, Record<string, Record<string, string>>>).pop;
    expect(kf["0%"].transform).toContain("scale(0.92)");
    expect(kf["60%"].transform).toContain("scale(1.04)");
    expect(kf["100%"].transform).toBe("none");
    expect((config.theme?.extend?.animation as Record<string, string>).pop).toBe("pop var(--motion-slow) var(--ease-out) both");
  });
});
```
Append to `kidsPlanner.test.tsx`:
```tsx
it("pops the chip that just landed and crossfades a changed seat name", async () => {
  // pick a pair for a seat via the picker (existing flow), then:
  const chip = await screen.findByText(/<the picked placeholder name>/, { selector: ".animate-pop *" });
  expect(chip).toBeInTheDocument();
});
```
(Use the names the existing tests already pick; the selector asserts the `animate-pop` wrapper exists around the landed chip.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run app/utils/__tests__/tailwindMotion.test.ts app/components/kids`
Expected: FAIL — `pop` undefined; no `.animate-pop`.

- [ ] **Step 3: Implement**

`tailwind.config.ts` `keyframes`:
```ts
pop: {
  "0%": { opacity: "0", transform: "scale(0.92)" },
  "60%": { opacity: "1", transform: "scale(1.04)" },
  "100%": { opacity: "1", transform: "none" },
},
```
`animation`: `pop: "pop var(--motion-slow) var(--ease-out) both",`.

`PairChip.tsx`: add `landed?: boolean` (default false); the chip `<span>` gets `${landed ? "animate-pop" : ""}` and the lift becomes `${dragging ? "opacity-30 scale-95" : ""}` (transform+opacity only). Keep `transition-colors` absent on the chip (it has none today).

`KidsRotationBoard.tsx`: track the last landing — `const [landed, setLanded] = useState<string | null>(null);` set in the drop handler to `cellKey(date, seat)` and cleared by `onAnimationEnd` on that cell's chip wrapper. Render the chip as `<span key={`${assignedId}`} className="block"><PairChip … landed={landed === cellKey(date, seat)} /></span>` — the `key` on the wrapper remounts the chip when the pair changes (crossfade: add `animate-fade-in` on the wrapper). Publish toggle → `<Button variant="secondary" size="sm" onClick={…} disabled={…} busy={sunday.publishing} busyLabel="…" title={…}>{sunday.published ? "Despublicar" : "Publicar"}</Button>` (keep `busyLabel="…"` — the current literal; the column is 36 px tall on purpose).

`KidsSundayCards.tsx`: publish toggle → `<Button variant="secondary" size="lg" …busy={sunday.publishing} busyLabel="…">`; the chip inside the seat row gets `<span key={assignedId} className="block animate-fade-in"><PairChip …/></span>` (the name crossfades on change — §5.9 `fade` 120 ms = `--motion-fast`, which `animate-fade-in` already uses).

Board cells: keep the class string; the dashed valid-target line is unchanged. Add a one-line comment above it: `// The shared valid-drop-target pattern (MOTION.md → Kids): dashed accent/40 while a drag is live and this cell can take it; solid + bg-accent/10 while hovered.`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/utils/__tests__/tailwindMotion.test.ts app/components/kids`
Expected: PASS. Existing publish-toggle assertions query by name («Publicar»/«Despublicar») — unchanged.

- [ ] **Step 5: Gates and commit**

```bash
export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH && node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint . && git add tailwind.config.ts app/components/kids/KidsRotationBoard.tsx app/components/kids/KidsSundayCards.tsx app/components/kids/PairChip.tsx app/utils/__tests__/tailwindMotion.test.ts app/components/kids/__tests__/kidsPlanner.test.tsx app/utils/__tests__/__fixtures__/colour-inventory.json && git commit -m "feat(kids): a landed chip pops, a changed seat crossfades, publish toggles are Buttons"
```

---

### Task 3: PairRoster and KidsAvailabilityPanel — primitives, AnimatedList, Presence, DateField

**Files:**
- Modify: `app/components/kids/PairRoster.tsx` (toast `:107-118`; «Crear pareja» `:179-186`; list `:206-296`; confirm `:269-295`)
- Modify: `app/components/kids/KidsAvailabilityPanel.tsx` (save `:204-211`; toast `:214-225`; month nav `:233-254`; cells `:272-285`)
- Create: `app/components/kids/__tests__/pairRoster.test.tsx`, `app/components/kids/__tests__/kidsAvailabilityPanel.test.tsx`

**Interfaces:**
- Consumes: `AnimatedList` (`items: { key, node }[]`, `as`, `className`, `itemClassName`), `Presence` (`show`, `variant`), `Button`, `useToast` (`hold`), `DateField kind="month"` + `onStep`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

`pairRoster.test.tsx` (mock `fetch`; `initialMembers` with two placeholder members, `initialPairs` with one active pair):
```tsx
it("lists pairs through AnimatedList and shows the retire confirm inside Presence", async () => {
  render(<ToastProvider><PairRoster initialPairs={pairs} initialMembers={members} /></ToastProvider>);
  await userEvent.click(screen.getByRole("button", { name: "Retirar" }));
  expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  expect(await screen.findByText("Pareja retirada.")).toBeInTheDocument(); // in the toast viewport
});
it("creates through a primary Button that reads Creando… while busy", …);
```
`kidsAvailabilityPanel.test.tsx`:
```tsx
it("holds the 409 conflict message until something replaces it", async () => {
  // fetch mock: PUT → 409 with the conflict body the component expects (read save() :136-171)
  …
  expect(await screen.findByText(/alguien más/)).toBeInTheDocument(); // the persisted message (copy its real text)
});
it("steps the month with the DateField arrows", async () => {
  await userEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
  // the visible month label advances (use MONTHS_ES from the component's own export or the rendered text)
});
it("marks a day through a pill Button with aria-pressed", async () => {
  const day = screen.getAllByRole("button", { pressed: false })[0];
  await userEvent.click(day);
  expect(day).toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run app/components/kids`
Expected: FAIL (no `ToastProvider` consumer yet; `pressed` query finds hand-rolled buttons — write the assertion so it fails today: e.g. assert the day button's class contains `rounded-full`, which only `Button variant="pill"` sets).

- [ ] **Step 3: Implement**

`PairRoster.tsx`: `useToast` as in Task 1; «Crear pareja» → `<Button variant="primary" size="lg" onClick={createPair} disabled={!canCreate} busy={creating} busyLabel="Creando…">Crear pareja</Button>`; the room list becomes
```tsx
<AnimatedList
  as="ul"
  className="space-y-2"
  items={roomPairs.map((pair) => ({ key: pair.id, node: <PairRow … /> }))}
/>
```
(extract the `<li>` body into a local `PairRow` function component in the same file; `AnimatedList` renders the `<li>` itself — the body is the row's inner `div`s). Retirar → `<Button variant="danger" size="lg">`, Reactivar → `<Button variant="secondary" size="lg">`, the confirm block → `<Presence show={confirmRetire === pair.id} variant="rise" className="space-y-2 rounded-lg border border-warning-fg/30 bg-warning-fg/10 px-3 py-2">…</Presence>` with Confirmar → `<Button variant="primary" size="lg" busy={busyPair === pair.id} busyLabel="Retirando…">Confirmar</Button>` and Cancelar → `<Button variant="ghost" size="lg">`.

`KidsAvailabilityPanel.tsx`: `const { toast } = useToast();` — `showToast(x)` → `toast({ message: x.text, tone: x.kind })`, `holdToast(x)` → `toast({ message: x.text, tone: x.kind, hold: true })`. Save → `<Button variant="primary" size="lg" onClick={save} disabled={saving || !dirty} busy={saving} busyLabel="Guardando…">{dirty ? "Guardar •" : "Guardar"}</Button>`. Month nav → `<DateField kind="month" aria-label="Mes" value={`${cursor.year}-${String(cursor.month).padStart(2, "0")}`} onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); if (y && m) setCursor({ year: y, month: m }); }} onStep={(d) => setCursor((c) => shiftYearMonth(c.year, c.month, d))} />` replacing the two arrows AND the `<span>` label. Day cells → `<Button variant="pill" tone="availability" size="sm" active={marked} disabled={saving} onClick={() => toggleDate(date)} className="min-h-[44px] w-full justify-center sm:min-h-0">{dayNumber}</Button>` (the `active` prop sets `aria-pressed`; `className` here adds sizing only — no padding/radius/colour override).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/components/kids`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

```bash
export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH && node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint . && git add app/components/kids/PairRoster.tsx app/components/kids/KidsAvailabilityPanel.tsx app/components/kids/__tests__/pairRoster.test.tsx app/components/kids/__tests__/kidsAvailabilityPanel.test.tsx app/utils/__tests__/__fixtures__/colour-inventory.json && git commit -m "feat(kids): the roster reflows through AnimatedList, its confirm rises, availability marks with pills and steps with a DateField"
```

---

### Task 4: `/kids` member page and `/kids/admin` — reveal stagger, «Te toca» pop, Buttons

**Files:**
- Modify: `app/(client)/kids/page.tsx` (heading `:108-121`; empty state; cards `:129-173`)
- Modify: `app/(client)/kids/admin/page.tsx` (three `<section>`s `:152-187`)
- Test: `app/(client)/kids/__tests__/kidsPage.test.tsx`

**Interfaces:**
- Consumes: `revealProps` (`app/utils/reveal.ts`, neutral), `Button` (neutral, `href` form), `animate-pop` (Task 2).
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

Append to `kidsPage.test.tsx` (its render section already mounts the page with a stubbed session and rows):
```tsx
it("reveals the heading and each Sunday in order and pops the Te toca pill", async () => {
  const { container } = await renderKidsPage(/* member seated on the first Sunday */);
  const revealed = container.querySelectorAll("[data-reveal]");
  expect(revealed.length).toBeGreaterThanOrEqual(2);
  expect((revealed[1] as HTMLElement).style.getPropertyValue("--reveal-i")).toBe("1");
  expect(screen.getByText(/Te toca/).className).toContain("animate-pop");
});
it("links to the planner through a Button", async () => {
  await renderKidsPage(/* managesKids */);
  expect(screen.getByRole("link", { name: /Planear Kids/ }).className).toContain("rounded-");
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run app/\(client\)/kids`
Expected: FAIL.

- [ ] **Step 3: Implement**

`page.tsx`: `import { revealProps } from "@/app/utils/reveal"; import Button from "@/app/components/ui/Button";` — heading row `<div className="flex flex-wrap items-center justify-between gap-3" {...revealProps(0)}>`; «Planear Kids» → `<Button variant="secondary" size="lg" href="/kids/admin">Planear Kids <svg …/></Button>`; each `<article key={day} {...revealProps(1 + i)} …>` (map with index); the «Te toca» `<span>` gets `animate-pop` appended; the empty state gets `{...revealProps(1)}`.

`admin/page.tsx`: each `<section … {...revealProps(i)}>` for i = 0,1,2 (the sections are server-rendered wrappers; the client panels inside are untouched).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/\(client\)/kids`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

```bash
export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH && node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint . && git add "app/(client)/kids/page.tsx" "app/(client)/kids/admin/page.tsx" "app/(client)/kids/__tests__/kidsPage.test.tsx" app/utils/__tests__/__fixtures__/colour-inventory.json && git commit -m "feat(kids): Sundays reveal in order, the Te toca pill pops once, the planner link is a Button"
```

---

### Task 5: Sign-in, not-a-member, error, not-found ×2

**Files:**
- Modify: `app/(client)/auth/signin/page.tsx` (`:57-143`)
- Modify: `app/(client)/auth/not-a-member/page.tsx`
- Modify: `app/(client)/error.tsx`
- Modify: `app/(client)/not-found.tsx`, `app/(client)/posts/not-found.tsx`
- Create: `app/(client)/auth/__tests__/signin.test.tsx`, `app/(client)/__tests__/fallbackPages.test.tsx`

**Interfaces:**
- Consumes: `revealProps`, `Button` (`href` form on the server pages; `busy`/`busyLabel` on the client form), `Presence variant="rise"`.
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

`signin.test.tsx` (mock `next-auth/react` `signIn` and `next/navigation` `useSearchParams` as other client tests do — grep `vi.mock("next/navigation"` for the house pattern; render inside `ToastProvider`/`MotionProvider` only if the component needs them — `Presence` needs the `MotionProvider`'s `LazyMotion`? Check `Presence.test.tsx` for how it is rendered under test and copy that wrapper):
```tsx
it("staggers lockup, panel, Google, fields and submit in that order", () => {
  const { container } = renderSignIn();
  const idx = [...container.querySelectorAll("[data-reveal]")].map((el) => (el as HTMLElement).style.getPropertyValue("--reveal-i"));
  expect(idx).toEqual(["0", "3", "4", "5", "6", "7"]);
});
it("rises the alert in and reads Entrando… while submitting", async () => {
  signInMock.mockResolvedValueOnce({ error: "CredentialsSignin" });
  …type email/password, click «Iniciar sesión»…
  expect(await screen.findByRole("alert")).toHaveTextContent("Email o contraseña incorrectos.");
});
it("keeps 16px inputs on a phone", () => { expect(screen.getByLabelText("Correo electrónico").className).toMatch(/text-\[16px\]/); });
```
`fallbackPages.test.tsx`: render `NotAMemberPage`, `Error` (with a dummy error + reset), `PageNotFound`, the posts `NotFound`; assert each has a `[data-reveal]` root and its primary action is a `Button` (class contains `rounded-` and, for links, `href="/"`).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run "app/(client)/auth" "app/(client)/__tests__/fallbackPages.test.tsx"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`signin/page.tsx`: import `revealProps`, `Button`, `Presence`. Lockup div `{...revealProps(0)}`; the `<section className="brand-facet-panel …">` `{...revealProps(3)}`; error → `<Presence show={!!errorMsg} variant="rise" as="div"><p role="alert" className="mb-4 …">{errorMsg}</p></Presence>` (keep `role="alert"` on the `<p>`); Google → `<div {...revealProps(4)}><Button variant="secondary" size="lg" className="w-full gap-3" onClick={handleGoogle} disabled={loading}><GoogleIcon />Continuar con Google</Button></div>`; the two inputs wrapped `<div {...revealProps(5)}>` / `<div {...revealProps(6)}>` (classes unchanged, `text-[16px] sm:text-sm` stays); submit → `<div {...revealProps(7)}><Button type="submit" variant="primary" size="lg" className="w-full" busy={loading} busyLabel="Entrando…" disabled={loading}>Iniciar sesión</Button></div>`. Check `Button` forwards `type="submit"` (it spreads `...rest` onto the `<button>`; if it forces `type="button"`, add a `type?: "button" | "submit"` prop to `Common` in this task).

`not-a-member/page.tsx`: root card `<div className="w-full max-w-sm text-center space-y-6" {...revealProps(0)}>`; the sign-out `<button>` → `<Button variant="primary" size="lg" onClick={…same async body…}>Cerrar sesión e intentar con otra cuenta</Button>`.

`error.tsx`: wrap the inner stack in `{...revealProps(0)}`; its two `Button`s are already primitives (leave them).

`not-found.tsx` and `posts/not-found.tsx`: `{...revealProps(0)}` on the root; the `<Link>` → `<Button variant="primary" size="lg" href="/">Ir al inicio</Button>` and drop the `next/link` import.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run "app/(client)/auth" "app/(client)/__tests__/fallbackPages.test.tsx" app/utils/__tests__/inputFontSize.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

```bash
export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH && node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint . && git add "app/(client)/auth" "app/(client)/error.tsx" "app/(client)/not-found.tsx" "app/(client)/posts/not-found.tsx" "app/(client)/__tests__/fallbackPages.test.tsx" app/components/ui/Button.tsx app/utils/__tests__/__fixtures__/colour-inventory.json && git commit -m "feat(auth): sign-in staggers in behind the beam, its alert rises, its actions are Buttons; the fallback pages reveal"
```

---

### Task 6: Song page — lyric eyebrows at a 62 ch measure, dim repeat markers, tutorial posters

**Files:**
- Create: `app/utils/lyricMarkers.tsx` (neutral), `app/components/song/TutorialPoster.tsx` (client)
- Modify: `app/(client)/posts/[slug]/page.tsx` (tutorials `:307-341`; lyrics `:384-392`; `myPortableTextComponents` `:465-481`)
- Modify: `app/components/ChordChart.tsx` (`:175-183` eyebrow class; plain-line branch uses `dimRepeatMarkers`)
- Modify: `next.config.ts` (`images.remotePatterns` + `{ protocol: "https", hostname: "i.ytimg.com" }`)
- Modify: `app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/SongPracticeFixture.tsx` (add one `TutorialPoster` with a fixed id and one lyric block with a `//` marker — hermetic: no fetch; the poster `next/image` is a static URL)
- Test: `app/utils/__tests__/lyricMarkers.test.tsx`, `app/components/song/__tests__/TutorialPoster.test.tsx`

**Interfaces:**
- Consumes: `extractYouTubeId` (`app/utils/practiceVideo.ts`), `Presence`, `Button`, `revealProps`.
- Produces: `dimRepeatMarkers(node: React.ReactNode): React.ReactNode` — walks strings (and arrays/fragments of them), splits on `//`, returns the same text with each marker as `<span className="text-ink-dim/70" aria-label="repetir">//</span>`; `LYRIC_EYEBROW = "font-label text-[11px] uppercase tracking-[0.24em] text-accent/80"` exported from the same module. `TutorialPoster({ url, title }: { url: string; title?: string | null })`.

- [ ] **Step 1: Write the failing tests**

`lyricMarkers.test.tsx`:
```tsx
it("dims every // marker and leaves the words alone", () => {
  render(<p>{dimRepeatMarkers("Santo, santo // es el Señor //")}</p>);
  expect(screen.getAllByLabelText("repetir")).toHaveLength(2);
  expect(screen.getByText(/Santo, santo/)).toBeInTheDocument();
});
it("passes non-string nodes through untouched", () => { const el = <em key="x">x</em>; expect(dimRepeatMarkers(el)).toBe(el); });
```
`TutorialPoster.test.tsx`:
```tsx
it("renders a poster and mounts the iframe only on press", async () => {
  render(<TutorialPoster url="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Tutorial" />);
  expect(document.querySelector("iframe")).toBeNull();
  expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("dQw4w9WgXcQ"));
  await userEvent.click(screen.getByRole("button", { name: "Reproducir Tutorial" }));
  expect(document.querySelector("iframe")?.getAttribute("src")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1");
});
it("falls back to the raw iframe when the url is not YouTube", () => {
  render(<TutorialPoster url="https://player.vimeo.com/video/1" title="V" />);
  expect(document.querySelector("iframe")?.getAttribute("src")).toBe("https://player.vimeo.com/video/1");
});
```
(`next/image` under jsdom: other tests already render it — copy their `vi.mock("next/image", …)` if present, else it renders an `<img>` with a `/_next/image?url=…` src, which the `stringContaining` assertion still matches.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run app/utils/__tests__/lyricMarkers.test.tsx app/components/song/__tests__/TutorialPoster.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`app/utils/lyricMarkers.tsx` (no `"use client"`, imports only `react` types):
```tsx
import { Children, Fragment, isValidElement, type ReactNode } from "react";
export const LYRIC_EYEBROW = "font-label text-[11px] uppercase tracking-[0.24em] text-accent/80";
const MARK = "//";
export function dimRepeatMarkers(node: ReactNode): ReactNode {
  if (typeof node === "string") {
    if (!node.includes(MARK)) return node;
    const parts = node.split(MARK);
    return parts.flatMap((part, i) =>
      i === 0 ? [part] : [<span key={`m${i}`} className="text-ink-dim/70" aria-label="repetir">{MARK}</span>, part],
    );
  }
  if (Array.isArray(node)) return Children.map(node, dimRepeatMarkers);
  if (isValidElement(node) && node.type === Fragment) return node; // keep simple: fragments pass through
  return node;
}
```
`page.tsx` lyrics wrapper: `className="prose prose-sm sm:prose dark:prose-invert prose-p:leading-relaxed prose-p:!mt-0 prose-p:!mb-0 max-w-[62ch] mx-auto"` (drop `columns-*`, `gap-10`, `max-w-4xl`, the heading utilities); `myPortableTextComponents.block`: `h1/h2/h3/h4: ({ children }) => <p className={`${LYRIC_EYEBROW} !mt-6 !mb-1 first:!mt-0 break-after-avoid`}>{children}</p>` and `normal: ({ children }) => <p>{dimRepeatMarkers(children)}</p>`. Keep `break-inside-avoid` on the group divs (harmless in one column).
`ChordChart.tsx`: the `# ` label `<p>` uses `LYRIC_EYEBROW` + `mt-5 mb-1 first:mt-0`; the plain-line `<p>` renders `{dimRepeatMarkers(line)}`.
`TutorialPoster.tsx`:
```tsx
"use client";
import { useState } from "react";
import Image from "next/image";
import Button from "@/app/components/ui/Button";
import Presence from "@/app/components/ui/Presence";
import { extractYouTubeId } from "@/app/utils/practiceVideo";
const IFRAME_ALLOW = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
export default function TutorialPoster({ url, title }: { url: string; title?: string | null }) {
  const [playing, setPlaying] = useState(false);
  const id = extractYouTubeId(url);
  const name = title?.trim() || "el tutorial";
  if (!id) return <iframe src={url} width="100%" height="100%" className="border-0" title={title ?? undefined} allow={IFRAME_ALLOW} referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />;
  return (
    <div className="relative h-full w-full">
      {!playing && (
        <>
          <Image src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-scrim/20">
            <Button variant="primary" size="lg" aria-label={`Reproducir ${name}`} onClick={() => setPlaying(true)}>▶ Reproducir</Button>
          </div>
        </>
      )}
      <Presence show={playing} variant="fade" className="absolute inset-0">
        <iframe src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`} width="100%" height="100%" className="border-0" title={title ?? undefined} allow={IFRAME_ALLOW} referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
      </Presence>
    </div>
  );
}
```
(`bg-scrim/20` — check `scrim` exists as a token in `tailwind.config.ts`; the dialog backdrop uses `bg-scrim/[0.68]`, so it does. The `▶` glyph is fine; do not add an eyebrow.)
`page.tsx` tutorials: replace the `<iframe …/>` inside `<div className="aspect-video">` with `<TutorialPoster url={tutorial.url} title={tutorial.title} />` (server page renders a client component as JSX — legal).
`next.config.ts`: add the `i.ytimg.com` pattern.
`SongPracticeFixture.tsx`: add a `TutorialPoster` (`url="https://www.youtube.com/embed/dQw4w9WgXcQ"`, inside an `aspect-video` box) and a lyric `<p>` with `dimRepeatMarkers("Coro // otra vez //")` under a `LYRIC_EYEBROW` label — the gallery's `song` fixture is where the eyebrow and the dim glyph are verified in both themes.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/utils/__tests__/lyricMarkers.test.tsx app/components/song app/utils/__tests__/themeGallery.test.ts app/utils/__tests__/clientBoundary.test.ts`
Expected: PASS (the fixture stays hermetic: the poster's `next/image` is a static URL, no fetch in source).

- [ ] **Step 5: Gates and commit**

```bash
export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH && node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint . && git add app/utils/lyricMarkers.tsx app/utils/__tests__/lyricMarkers.test.tsx app/components/song/TutorialPoster.tsx app/components/song/__tests__/TutorialPoster.test.tsx "app/(client)/posts/[slug]/page.tsx" app/components/ChordChart.tsx next.config.ts "app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/SongPracticeFixture.tsx" app/utils/__tests__/__fixtures__/colour-inventory.json && git commit -m "feat(song): lyric sections read as rail eyebrows at a 62ch measure, repeats dim, tutorials load on press (decision P)"
```

---

### Task 7: Gallery — `BottomNavBar` split, `nav` fixture, `controls` gaps

**Files:**
- Create: `app/components/BottomNavBar.tsx` (presentational, `"use client"`)
- Modify: `app/components/BottomNav.tsx` (renders `BottomNavBar`; keeps session/pathname/measure logic; `barRef` forwarded)
- Create: `app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/NavFixture.tsx`
- Modify: `app/(gallery)/theme-gallery/[theme]/[fixture]/page.tsx` (`FIXTURES` + render branch), `fixtures/ControlsFixture.tsx`
- Modify: `app/utils/__tests__/themeGallery.test.ts:134-137` (tuple string → seven fixtures)
- Test: `app/components/__tests__/BottomNav.test.tsx` (existing — must stay green), `app/utils/__tests__/themeGallery.test.ts`

**Interfaces:**
- Produces: `BottomNavBar({ tabs, activeHref, moreRows, moreOpen, onMore, onNavigate, barRef }: { tabs: Tab[]; activeHref: string; moreRows: MoreRow[]; moreOpen: boolean; onMore: (open: boolean) => void; onNavigate?: () => void; barRef?: React.Ref<HTMLElement> })` where `Tab = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean }` and `MoreRow = { href: string; label: string; icon: React.ReactNode }` (move the `Tab` type and the seven icon functions into `BottomNavBar.tsx`; export the icons). Renders exactly today's `<nav>` + the «Más» `CueDialog` (`open={moreOpen}`), nothing else.
- Consumes: `Menu`/`MenuItem` (the `controls` open menu), `Skeleton`/`SkeletonGroup`, `SectionNav` (`app/components/SectionNav.tsx` — read its props: `sections`, and the R4 `practice` cluster prop; pass 4 placeholder sections and no practice info).

- [ ] **Step 1: Write the failing tests**

`themeGallery.test.ts:134-137`: change the expected string to `'["swatches", "dialog", "planner", "kids-planner", "controls", "song", "nav"] as const'` and the test name to "seven fixtures". Add to the same file:
```ts
it("the nav fixture hosts the presentational bar, never BottomNav itself", () => {
  const src = read("app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/NavFixture.tsx");
  expect(src).toMatch(/from "@\/app\/components\/BottomNavBar"/);
  expect(src).not.toMatch(/BottomNav"/);
});
```
(the hermetic sweep at `:144-196` already covers `useSession`/`fetch`.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run app/utils/__tests__/themeGallery.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`BottomNavBar.tsx`: `"use client"`; imports `Link`, `SlidingIndicator`, `CueDialog`, `haptic`; the body is `BottomNav.tsx:117-171` verbatim with `tabs`/`moreRows`/`moreOpen`/`pathname→activeHref` from props, `setMoreOpen(x)` → `onMore(x)`, `onClick` on tabs → `{ void haptic("selection"); onMore(false); onNavigate?.(); }`. `ref={barRef}` on the `<nav>`.
`BottomNav.tsx`: keeps lines 30-115 (session, tabs, moreRows, hidden, the measurement effect) and returns `<BottomNavBar tabs={tabs} activeHref={pathname} moreRows={moreRows} moreOpen={moreOpen} onMore={setMoreOpen} barRef={barRef} />`. Delete the moved icon functions (import from `BottomNavBar`). The `Tab.match` stays: `BottomNavBar` computes `active = tab.match(activeHref)`.
`NavFixture.tsx`:
```tsx
"use client";
// Nav fixture (spec §5.11): the phone tab bar with its «Más» sheet OPEN, and the song
// page's section nav. Hermetic: props only — BottomNavBar is the presentational half
// (BottomNav itself reads the session and is never hosted here).
import { useState } from "react";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import BottomNavBar, { HomeIcon, CalendarIcon, MusicIcon, KidsIcon, AdminIcon } from "@/app/components/BottomNavBar";
import SectionNav from "@/app/components/SectionNav";
export function NavFixture() {
  const [moreOpen, setMoreOpen] = useState(true);
  return (
    <CueDialogProvider>
      <div data-gallery-surface="nav" className="space-y-10 pb-24">
        <SectionNav sections={[{ id: "audio", label: "Audio" }, { id: "letra", label: "Letra" }, { id: "historial", label: "Historial" }]} />
        <p className="text-sm opacity-80">La barra inferior está fija abajo con su hoja «Más» abierta.</p>
        <BottomNavBar
          tabs={[
            { href: "/", label: "Inicio", icon: <HomeIcon />, match: (p) => p === "/" },
            { href: "/schedule", label: "Calendario", icon: <CalendarIcon />, match: (p) => p.startsWith("/schedule") },
            { href: "/biblioteca", label: "Biblioteca", icon: <MusicIcon />, match: (p) => p.startsWith("/biblioteca") },
          ]}
          activeHref="/schedule"
          moreRows={[{ href: "/kids", label: "Kids", icon: <KidsIcon /> }, { href: "/admin", label: "Admin", icon: <AdminIcon /> }]}
          moreOpen={moreOpen}
          onMore={setMoreOpen}
        />
      </div>
    </CueDialogProvider>
  );
}
```
(Match `SectionNav`'s real prop names — read the component; if it requires a `practice` prop, pass `null`/omit per its type. The bar is `lg:hidden`, so the desktop project captures only the section nav — expected and documented.)
`page.tsx`: add `"nav"` to `FIXTURES` and `{fixture === "nav" && <NavFixture />}`.
`ControlsFixture.tsx`: import `Menu, { MenuItem }`, `Skeleton, { SkeletonGroup }`; add to Botones: `<Button variant="pill" tone="availability" active>Disponible</Button>`, `<Button variant="icon" tone="danger" aria-label="Eliminar">×</Button>`, `<Button variant="primary" size="sm">Pequeño</Button>`, `<Button variant="secondary" size="sm">Pequeño</Button>`; new rows:
```tsx
<Row title="Esqueleto">
  <SkeletonGroup label="Cargando" className="w-full space-y-2">
    <Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-3/4" /><Skeleton rounded="lg" className="h-16 w-full" />
  </SkeletonGroup>
</Row>
<Row title="Menú">
  <OpenMenu />
</Row>
```
with
```tsx
function OpenMenu() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.click(); }, []);
  return (
    <Menu label="Acciones" trigger={<Button ref={ref} variant="secondary">Acciones ▾</Button>}>
      <MenuItem onSelect={() => {}}>Editar</MenuItem>
      <MenuItem selected onSelect={() => {}}>Ver como</MenuItem>
      <MenuItem danger onSelect={() => {}}>Eliminar</MenuItem>
    </Menu>
  );
}
```
(`Menu` merges the trigger's own `ref` — CLAUDE.md; if `Button` does not forward refs, wrap the trigger in a plain `<button className={buttonClass("secondary","md")} ref={ref}>`.) Give the fixture root `pb-64` so the open panel (portalled, fixed, below the trigger) has room in the capture.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/utils/__tests__/themeGallery.test.ts app/components/__tests__ app/utils/__tests__/bottomNavOffsetSync.test.ts app/utils/__tests__/motionImportBoundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

```bash
export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH && node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint . && git add app/components/BottomNavBar.tsx app/components/BottomNav.tsx "app/(gallery)/theme-gallery" app/utils/__tests__/themeGallery.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json && git commit -m "feat(gallery): a nav fixture with the Más sheet open, and the controls fixture shows Skeleton, an open Menu and the missing tones"
```

---

### Task 8: VR harness — spec, snapshot policy, motion-on spec, baselines, `test:vr`

**Files:**
- Modify: `playwright.vr.config.ts` (projects, snapshot settings)
- Create: `e2e/theme-gallery/gallery.spec.ts`, `e2e/theme-gallery/motion-on.spec.ts`, `e2e/theme-gallery/__screenshots__/**` (captured)
- Modify: `app/(gallery)/theme-gallery/[theme]/GalleryMotion.tsx` (`#motion` hash)
- Modify: `package.json` (`"test:vr": "playwright test -c playwright.vr.config.ts"`), `e2e/theme-gallery/README.md` (how to run, policy), `docs/DEV_VERIFY.md` (a «Galería (VR)» section: the two env vars, darwin-only baselines), `docs/CI.md` (one line: VR is not in CI, ADR-0014)
- Test: `app/utils/__tests__/themeGallery.test.ts` (source assertion for the hash branch), `app/utils/__tests__/vrConfig.test.ts` (new: config exports two projects and the snapshot template; read via `fs`, no import — the module throws without env)

**Interfaces:**
- Consumes: Task 7's seven fixtures.
- Produces: `npm run test:vr` (needs `THEME_GALLERY_VR_ENABLED=true THEME_GALLERY_VR_BASE_URL=http://localhost:3000`).

- [ ] **Step 1: Write the failing tests**

`vrConfig.test.ts`:
```ts
const src = fs.readFileSync("playwright.vr.config.ts", "utf8");
it("names two projects and a platform-scoped snapshot template", () => {
  expect(src).toContain('name: "desktop"'); expect(src).toContain('name: "phone"');
  expect(src).toContain("{platform}"); expect(src).toContain("maxDiffPixelRatio");
});
```
`themeGallery.test.ts`: `it("GalleryMotion keeps animations only under the #motion hash", () => { expect(read("…GalleryMotion.tsx")).toMatch(/location\.hash === "#motion"/); })`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run app/utils/__tests__/vrConfig.test.ts app/utils/__tests__/themeGallery.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`GalleryMotion.tsx`:
```tsx
useLayoutEffect(() => {
  const root = document.documentElement;
  // `#motion` opts one page into real animation so a spec can capture the sheet's
  // enter at t=0 and t=end; every other gallery page stays a final frame.
  if (window.location.hash === "#motion") root.removeAttribute("data-motion");
  MotionGlobalConfig.skipAnimations = root.dataset.motion === "off";
}, []);
```
(`useLayoutEffect` so the attribute is gone before the first paint of the children's enter animations — children's effects run first, but `Presence`/`CueDialog` animate from the NEXT frame, so the parent's layout effect lands in time. If the t=0 capture shows a finished frame, switch the removal to an inline `<script>` in `layout.tsx` — record which in the README.)

`playwright.vr.config.ts` (keep the refusal):
```ts
export default defineConfig({
  testDir: "./e2e/theme-gallery",
  testMatch: /.*\.spec\.ts/,
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{platform}/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" } },
  use: { baseURL: BASE_URL, screenshot: "only-on-failure", colorScheme: "dark" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  workers: 1, retries: 0, reporter: [["list"]],
});
```
`gallery.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
const THEMES = ["dark", "light"] as const;
const FIXTURES = ["swatches", "dialog", "planner", "kids-planner", "controls", "song", "nav"] as const;
const FULL_PAGE = new Set(["swatches", "controls", "song", "kids-planner", "nav"]);
for (const theme of THEMES) for (const fixture of FIXTURES) {
  test(`${theme}/${fixture}`, async ({ page }) => {
    await page.goto(`/theme-gallery/${theme}/${fixture}`);
    await expect(page.locator(`main[data-gallery-fixture="${fixture}"]`)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${theme}-${fixture}.png`, { fullPage: FULL_PAGE.has(fixture) });
  });
}
test("swatches: the swatch surface is unobscured by any fixed body child", async ({ page }) => {
  await page.goto("/theme-gallery/dark/swatches");
  const covered = await page.evaluate(() => {
    const s = document.querySelector("[data-gallery-surface]")!.getBoundingClientRect();
    const top = document.elementFromPoint(s.left + 8, s.top + 8);
    return !document.querySelector("[data-gallery-surface]")!.contains(top);
  });
  expect(covered).toBe(false);
});
test("dialog: the dialog layer is the topmost painted body child", async ({ page }) => {
  await page.goto("/theme-gallery/dark/dialog");
  const topIsDialog = await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!el?.closest('[role="dialog"]');
  });
  expect(topIsDialog).toBe(true);
});
test("planner: the full-screen overlay is the topmost painted body child", async ({ page }) => {
  await page.goto("/theme-gallery/dark/planner");
  const top = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, 24)?.closest("[data-planner-fullscreen], [role=\"dialog\"]") !== null);
  expect(top).toBe(true);
});
```
(Read `PlannerFixture`/`PlannerGrid` for the full-screen host's attribute or role and use the real selector.)
`motion-on.spec.ts`:
```ts
test("the sheet's enter never runs under a transformed ancestor", async ({ page }, testInfo) => {
  await page.goto("/theme-gallery/dark/dialog#motion");
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: "attached" });
  await testInfo.attach("t0", { body: await page.screenshot(), contentType: "image/png" });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await testInfo.attach("tEnd", { body: await page.screenshot(), contentType: "image/png" });
  const facts = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')!;
    let el = d.parentElement; const transformed: string[] = [];
    while (el && el !== document.documentElement) { if (getComputedStyle(el).transform !== "none") transformed.push(el.tagName); el = el.parentElement; }
    const r = d.getBoundingClientRect();
    return { transformed, inside: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth };
  });
  expect(facts.transformed).toEqual([]);
  expect(facts.inside).toBe(true);
});
```
`package.json`: `"test:vr": "playwright test -c playwright.vr.config.ts"`.
Capture baselines: `npm run build && (npx next start -p 3000 &)`, then `THEME_GALLERY_VR_ENABLED=true THEME_GALLERY_VR_BASE_URL=http://localhost:3000 npm run test:vr -- --update-snapshots`, then run WITHOUT `--update-snapshots` and confirm every test passes; stop the server (`kill %1` / `pkill -f "next start"`). Check the PNG total (`du -sh e2e/theme-gallery/__screenshots__`); if it exceeds ~12 MB, drop `fullPage` on `controls` and re-capture. Commit the PNGs.
README + `docs/DEV_VERIFY.md` + `docs/CI.md`: how to run (the three commands), the darwin-only note, the policy numbers, the `#motion` hash.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/utils/__tests__/vrConfig.test.ts app/utils/__tests__/themeGallery.test.ts` and the VR run above (all green, second pass no diffs).
Expected: PASS; `npm run test:vr` lists 2×7 + 3 + 1 = 18 tests × 2 projects passing (the `phone` project runs every test too).

- [ ] **Step 5: Gates and commit**

```bash
export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH && node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint . && git add playwright.vr.config.ts e2e/theme-gallery "app/(gallery)/theme-gallery/[theme]/GalleryMotion.tsx" package.json docs/DEV_VERIFY.md docs/CI.md app/utils/__tests__/vrConfig.test.ts app/utils/__tests__/themeGallery.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json && git commit -m "test(gallery): the theme gallery is a visual-regression baseline — two projects, committed snapshots, a motion-on spec for the fixed-ancestor trap"
```

---

### Task 9: Docs, spec Part XVI, MOTION.md, bundle, shots

**Files:**
- Modify: `docs/superpowers/specs/2026-09-08-premium-motion-design.md` (append Part XVI — R6: scope, rulings 1–14, guard moves, parked residuals, review trail, `**Release:** … <pending>` line)
- Modify: `docs/MOTION.md` (a «Kids, auth, fallbacks (R6)» section: the shared drop-target pattern, `animate-pop`, the `#motion` hash, the VR policy; the bundle table gains an R6 row)
- Modify: `docs/UTILITIES_AND_COMPONENTS.md` (`TutorialPoster`, `BottomNavBar`, `lyricMarkers`, `NavFixture`, guard rows: `cueDialogMount` 5, `tailwindMotion`, `vrConfig`)
- Modify: `CLAUDE.md`, `AGENTS.md` (Reusable utils: `TutorialPoster`, `dimRepeatMarkers`/`LYRIC_EYEBROW`, `BottomNavBar`; invariant line: gallery fixtures host presentational halves only)
- Modify: `docs/ROUTES.md` (`/theme-gallery/[theme]/nav`)
- Add: `docs/superpowers/specs/2026-09-08-premium-motion-shots/r6-*.png` (before/after from dev after the preview push: `/kids` phone, `/kids/admin` 1440, `/auth/signin` phone light, `/posts/<slug>` tutorials 1440) — the coordinator captures these with dev-verify after the preview merge; this task writes the doc references and the implementer leaves the paths as `<pending shot>` markers the coordinator fills.

- [ ] **Step 1: Bundle A/B** — coordinator runs the git-archive cold builds (`$SP/measure-bundle.mjs`, `static/chunks/*` only) on `main` and the branch tip; write the row.
- [ ] **Step 2: Write the docs** as listed; every count/guard number matches the tree (`npx vitest run` output for the test count).
- [ ] **Step 3: Gates and commit**

```bash
export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH && node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint . && git add docs CLAUDE.md AGENTS.md && git commit -m "docs(motion): R6 — kids, auth, fallbacks, song deferrals and the VR gallery recorded (Part XVI)"
```

## Self-review

- **Spec coverage:** §5.9 — cards stagger (T4), «Te toca» pop (T1 ruling/T2 keyframe/T4), KidsPlanner month nav + Buttons `aria-busy` + Toast + Skeleton (T1), board dashed target + chip lift + landing (T2, beam ruled out), SeatPicker on CueDialog (already; controlled in T1), cards seat press/crossfade (T2), PairRoster rise/Presence (T3 via AnimatedList + Presence), Availability Buttons + Toast (T3). §5.10 — sign-in stagger/alert/busy (T5), the three fallbacks (T5, plus `posts/not-found`). §5.11 — `data-motion="off"` (exists), `controls` gaps + `nav` (T7), motion-on spec (T8). §20 R6 line — eyebrows + poster (T6). Deferrals: `loading.tsx`, day sheet, beam (rulings 2, 14).
- **Placeholder scan:** every test block names the real strings or says where to copy them from; no "TBD".
- **Type consistency:** `SeatPicker.open` (T1) is the only new prop consumed later (T7's KidsPlannerFixture hosts `SeatPicker` — it must pass `open` — add `open` there in T1, since the fixture is in the same tree and `tsc` is a gate). `PairChip.landed` (T2) is optional. `BottomNavBar` props (T7) are consumed only by T7. `LYRIC_EYEBROW`/`dimRepeatMarkers` (T6) are consumed by T6 and T9 docs.
