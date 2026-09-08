# Motion M0b-1 — Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every overlay in the app one motion contract — dialogs that animate in and out and can be dragged closed on the phone, one toast stack, one anchored menu, one disclosure — and migrate the three hand-rolled dialog shells, seven hand-rolled toasts, three menus and four disclosures onto them.

**Architecture:** Four primitives under `app/components/ui/` (`CueDialog` upgraded in place, `Toast`, `Menu`, `Collapse`) built on `motion/react` and `motion/react-m` behind the existing `MotionProvider`. The feature chunk switches from `domAnimation` to `domMax` (layout projection is what M0b-2's sliding indicators need; measured here against the 40 kB async line from spec Part VI). `CueDialog`'s closing phase is internal: registration with `CueDialogProvider` is keyed on "mounted" (open or exiting), so focus restores and `inert` lifts only after the exit completes and the provider is untouched. The toast viewport portals to a sibling of the dialog root so it escapes the app root's `inert`.

**Tech Stack:** Next.js 16, React 19, Tailwind 3.4, `motion` 13.2 (`AnimatePresence`, `m.*`, `useMotionValue`, `animate`), vitest + @testing-library/react (jsdom per file, `installMotionTestEnv()`), Node 22.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` — Part I §4 (primitives table), §5.0 shell rows, §19.4 overlays, Part VI (rules inherited from M0a, cap ruling R). Inventory the plan argues from: the M0b surface inventory of 2026-09-08 16:34 (quoted where it binds).

## Global Constraints

- Browser floor **iOS 15 / Safari 15** (ADR-0030): no `@starting-style`, `:has()`, scroll-driven animations, `AbortSignal.timeout`, `findLast`, `structuredClone`; pointer events are fine (Safari 13+).
- Only `transform` and `opacity` animate. **Exception:** `Collapse` animates `height` between `0` and `"auto"` through `motion`'s measured path, on user-triggered disclosures only (spec §2.2).
- `motion/*` imports only under `app/components/ui/**` and `app/utils/motion*` (`motionImportBoundary.test.ts`). Hosts come from `motion/react-m` (named exports).
- Every `m.*` element renders its `initial` values until the async feature chunk arrives: **no `appear`/mount-time animation above the fold**; every primitive here is opened by a user action, so this holds by construction.
- The feature loader has no rejection handling (vendor). `Toast`, `Menu` and `Collapse` must be USABLE with features never arriving: `Collapse` and `Menu` render their open state through `initial={false}` (no hidden start), and `Toast`'s content is visible at `initial` opacity 1 with only the exit animated. `CueDialog` likewise renders open at `initial={false}`.
- A Server Component may never CALL a value from a `"use client"` module (ADR-0028). All four primitives are `"use client"`; they are rendered as JSX only.
- New colour in a rule body is a composed token at every `--warning-glow` touch point; never bump the `tokenLayer` pin. Every `brand.css` edit regenerates `app/utils/__tests__/__fixtures__/colour-inventory.json` in the same commit; so does every new non-test file under `app/**` (`filesScanned`).
- `rawMotionLiterals.test.ts` pins `transition-all` 13 / `duration-N` 12 outside `ui/` with equality: a task that removes a site LOWERS the pin in the same commit.
- Dismiss reasons: `DismissReason = "escape" | "backdrop" | "drag"` after Task 3; consumers that switch on the reason must handle `"drag"` like `"backdrop"`.
- `dialogSemantics.test.ts` requires every file with a clickable `bg-scrim inset-0` element to carry dialog semantics and focus management, and requires ≥4 such files to exist; Task 4 lowers that floor honestly when three shells disappear.
- Conventional commits; no AI attribution or `Co-Authored-By`. Gates before done: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors).
- Bundle: first-load cap +25 kB gz (unchanged; nothing here adds first-load JS beyond primitive code); **async motion-feature chunk ≤ 40 kB gz** (Part VI ruling R), measured in Task 1 with the method `docs/MOTION.md` records.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `app/components/ui/motionFeatures.ts` | now exports `domMax` | 1 |
| `docs/MOTION.md` | bundle ledger row for the `domMax` chunk; primitives table | 1, 10 |
| `app/components/ui/Button.tsx` + test | `forwardRef` | 2 |
| `app/components/ui/CueDialog.tsx` + `__tests__/CueDialog.test.tsx` | enter/exit, sheet drag, `"drag"` reason, `Cue` eyebrow removed, mounted-keyed registration | 3 |
| `app/utils/motionPresets.ts` | `SHEET_DISMISS` thresholds | 3 |
| `app/components/kids/SeatPicker.tsx`, `app/components/admin/SongFormModal.tsx`, `app/(client)/me/propose/[roleId]/ProposalEditor.tsx`, `app/utils/__tests__/dialogSemantics.test.ts` | three shells onto `CueDialog`; floor lowered | 4 |
| `app/components/ui/Toast.tsx` + `__tests__/Toast.test.tsx`; `app/utils/Provider.tsx` | `ToastProvider`, `useToast`, viewport | 5 |
| `EditSongButton.tsx`, `ProfilePanel.tsx`, `admin/ServicesPanel.tsx`, `admin/AdminPanel.tsx`, `admin/ProposalsPanel.tsx`, `admin/ContentPanel.tsx`, `ProposalEditor.tsx` | seven fixed toasts → `useToast` | 6 |
| `app/components/ui/Menu.tsx` + `__tests__/Menu.test.tsx` | anchored menu with roving focus | 7 |
| `NavMenu.tsx`, `admin/ServiceReadinessCard.tsx`, `PracticePlaylistButton.tsx` | three menus → `Menu` | 8 |
| `app/components/ui/Collapse.tsx` + `__tests__/Collapse.test.tsx`; `admin/IntegrityQueuePanel.tsx`, `admin/ActivityPanel.tsx`, `admin/ServicesPanel.tsx`, `AvailabilityCalendar.tsx` | disclosure primitive + four sites | 9 |
| `app/(gallery)/theme-gallery/[theme]/GalleryMotion.tsx` + layout; `app/utils/__tests__/labelBudget.test.ts`; docs | gallery motion features + skip; label budget; inventories | 10 |

---

### Task 1: Feature chunk → `domMax`, measured

**Files:**
- Modify: `app/components/ui/motionFeatures.ts`
- Modify: `docs/MOTION.md` (Bundle section)

**Interfaces:** `m.*` elements may now use `layout`, `layoutId`, `drag` props app-wide (still only under `ui/`).

- [ ] **Step 1: Switch the export**

Replace the file's content with:

```ts
// The one place motion's feature set is chosen (ADR-0031). `domMax` = domAnimation +
// layout projection + drag: layout is what M0b-2's sliding indicators (`layoutId`) need;
// drag is included because the two are one bundle in motion 13 (there is no public
// `layout`-only set). Loaded as an async chunk by MotionProvider; measured in
// docs/MOTION.md against the 40 kB gz line from the spec's Part VI.
export { domMax as default } from "motion/react";
```

- [ ] **Step 2: Measure the chunk**

Run `npx next build` here, then apply the A/B method `docs/MOTION.md` describes (the chunk unique to the build that is unreferenced by any route's client-reference manifest and contains motion-dom feature signatures — for `domMax` also `HTMLProjectionNode`/`MeasureLayout`). Record its gzip -9 size. Also re-measure first-load for `/` and `/admin`; they must not move by more than 0.5 kB (the chunk is async).

Expected: chunk ≤ 40 kB gz. **If it exceeds 40 kB, stop and report** — the ruling then is "SlidingIndicator as a measured CSS transform, keep `domAnimation`"; do not proceed on your own judgment.

- [ ] **Step 3: Record it**

In `docs/MOTION.md`'s bundle table add a row `After M0b-1 (domMax async chunk)` with the measured kB, and update the sentence about `domMax` ("not measured here") to the measured number.

- [ ] **Step 4: Gates and commit**

Run: `npx vitest run app/utils/__tests__/motionImportBoundary.test.ts app/components/ui/__tests__/Presence.test.tsx && npx tsc --noEmit`
Expected: PASS.

```bash
git add app/components/ui/motionFeatures.ts docs/MOTION.md
git commit -m "perf(motion): the async feature chunk becomes domMax, measured

Layout projection is what the sliding indicators need; drag comes with it.
Async, so first-load does not move; the chunk is recorded against the 40 kB line."
```

---

### Task 2: `Button` forwards its ref

**Files:**
- Modify: `app/components/ui/Button.tsx`
- Modify: `app/components/ui/__tests__/Button.test.tsx`

**Interfaces:** `Button` accepts `ref` (a `HTMLButtonElement` on the button branch, `HTMLAnchorElement` on the link branch). `Menu` (Task 7) uses it as a trigger.

- [ ] **Step 1: Write the failing test**

Append to `Button.test.tsx`:

```tsx
import { createRef } from "react";

it("forwards a ref to the underlying button", () => {
  const ref = createRef<HTMLButtonElement>();
  render(<Button ref={ref}>Abrir</Button>);
  expect(ref.current?.tagName).toBe("BUTTON");
});

it("forwards a ref to the underlying link", () => {
  const ref = createRef<HTMLAnchorElement>();
  render(<Button ref={ref} href="/">Inicio</Button>);
  expect(ref.current?.tagName).toBe("A");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/ui/__tests__/Button.test.tsx`
Expected: FAIL — `ref.current` is null (React 19 passes `ref` as a prop to function components, but Button does not attach it).

- [ ] **Step 3: Attach the ref**

React 19 delivers `ref` as an ordinary prop. In `Button.tsx`, add `ref?: React.Ref<HTMLButtonElement>` to the button-branch props type and `ref?: React.Ref<HTMLAnchorElement>` to the link-branch type, destructure `ref` in both branches, and pass `ref={ref}` to `<button>` and to `<Link>` respectively. No `forwardRef` wrapper is needed on React 19; add a one-line comment saying so.

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run app/components/ui/__tests__/Button.test.tsx && npx tsc --noEmit && npx eslint app/components/ui/Button.tsx`
Expected: PASS.

```bash
git add app/components/ui/Button.tsx app/components/ui/__tests__/Button.test.tsx
git commit -m "feat(motion): Button forwards its ref

Menu anchors to its trigger and focus-restore sites need the element."
```

---

### Task 3: `CueDialog` animates in and out, and the sheet drags closed

**Files:**
- Modify: `app/components/ui/CueDialog.tsx`
- Modify: `app/utils/motionPresets.ts`
- Modify: `app/components/ui/__tests__/CueDialog.test.tsx`

**Interfaces:**
- Props unchanged plus `DismissReason` gains `"drag"`. Consumers: `grep -rn 'reason ===\|reason !==\|case "backdrop"\|case "escape"' app --include=*.tsx` — every hit must treat `"drag"` like `"backdrop"` (the implementer edits each hit in this task; there are expected to be few).
- Produces from `motionPresets.ts`: `SHEET_DISMISS = { distance: 80, velocity: 0.5 }` (px, px/ms).
- Behaviour: while `open` the layer is mounted with `initial={false}` (renders at rest even before features load); on `open→false` the backdrop fades out over `EXIT_MS` and the shell exits (card: scale 0.98 + fade; sheet: y 24 px + fade) and ONLY THEN the layer unregisters (focus restore, `inert` lift, scroll unlock). Enter: card scale 0.96→1 + fade over `MS.slow`; sheet: y from 100 % with `SPRINGS.sheet` — both only when a dialog opens after mount (`AnimatePresence initial={false}` on first paint is irrelevant because dialogs are never open at page load).
- Sheet drag: on phones (`mode="sheet"`, `sm:hidden` handle area PLUS the header) pointer-down starts a drag; the shell follows the pointer downward only (`y = max(0, dy)`); release with `dy > 80` or velocity `> 0.5 px/ms` calls `onDismiss("drag")`; otherwise springs back with `SPRINGS.sheet`. Pointer capture on the handle element; touch-action `none` on the handle so the page does not scroll under it.

- [ ] **Step 1: Write the failing tests**

Append to `CueDialog.test.tsx` (the file already sets `offsetParent` and uses `Harness`; add `installMotionTestEnv()` from `./motionTestSetup` at the top and wrap `Harness`'s tree in `<MotionProvider>` from `../MotionProvider`):

```tsx
it("keeps the dialog mounted until the exit completes, then restores focus to the opener", async () => {
  const { rerender } = render(<Harness open={false} />);
  screen.getByTestId("trigger").focus();
  rerender(<Harness open />);
  expect(document.querySelector("[data-cue-layer]")).not.toBeNull();
  rerender(<Harness open={false} />);
  // Exit is in flight: still mounted, still registered (app root still inert).
  expect(document.querySelector("[data-cue-layer]")).not.toBeNull();
  await waitFor(() => expect(document.querySelector("[data-cue-layer]")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("trigger")));
  expect(document.body.style.overflow).toBe("");
});

it("renders no Cue eyebrow above the title", () => {
  render(<Harness open />);
  expect(screen.queryByText("Cue")).toBeNull();
  expect(screen.getByRole("heading", { name: "Editar canción" })).toBeTruthy();
});

it("dismisses a sheet with reason drag when the handle is dragged past the threshold", () => {
  const onDismiss = vi.fn();
  render(
    <MotionProvider>
      <CueDialogProvider>
        <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}>
          <button>Ok</button>
        </CueDialog>
      </CueDialogProvider>
    </MotionProvider>,
  );
  const handle = document.querySelector<HTMLElement>("[data-cue-handle]")!;
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 200 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 200 });
  expect(onDismiss).toHaveBeenCalledWith("drag");
});

it("springs a sheet back when the drag is short and slow", () => {
  const onDismiss = vi.fn();
  render(
    <MotionProvider>
      <CueDialogProvider>
        <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}>
          <button>Ok</button>
        </CueDialog>
      </CueDialogProvider>
    </MotionProvider>,
  );
  const handle = document.querySelector<HTMLElement>("[data-cue-handle]")!;
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 120 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 120 });
  expect(onDismiss).not.toHaveBeenCalled();
});
```

jsdom has no `setPointerCapture`; the implementation guards `if (typeof el.setPointerCapture === "function")`. Velocity in the test is computed from `performance.now()` deltas; a 100 px move in one tick reads as fast, so the threshold test passes on distance alone (100 > 80).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run app/components/ui/__tests__/CueDialog.test.tsx`
Expected: the four new cases FAIL (layer unmounts synchronously; the eyebrow exists; no `[data-cue-handle]`).

- [ ] **Step 3: Presets**

Append to `app/utils/motionPresets.ts`:

```ts
/** Sheet drag-to-dismiss (spec §19.4): past this travel OR faster than this, the sheet closes. */
export const SHEET_DISMISS = { distance: 80, velocity: 0.5 } as const; // px, px/ms
```

- [ ] **Step 4: Rewrite the render half of `CueDialog`**

Keep everything above the `sizeClass` memo as is, with three changes: (a) `type DismissReason = "escape" | "backdrop" | "drag";` (b) the registration effect is keyed on `mounted` instead of `open`:

```tsx
// Mounted = open OR exiting. Registration (focus capture, inert on the app root,
// scroll lock) lives for the whole presence, so focus restores and inert lifts
// AFTER the exit animation, not at its start. This is the "closing state" spec §4
// asked for, held here rather than in the provider — the provider only ever sees
// register/unregister.
const [exiting, setExiting] = useState(false);
const mounted = open || exiting;
useEffect(() => {
  if (open) setExiting(true);
}, [open]);
useEffect(() => {
  if (!mounted) return;
  openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return registerLayer({ id, opener: openerRef.current, restoreFocusRef, fallbackRef: fallbackFocusRef, shellRef });
}, [fallbackFocusRef, id, mounted, registerLayer, restoreFocusRef]);
```

(`exiting` becomes true the moment the dialog opens and is cleared by `onExitComplete`; while `open` is true it is redundant, which is the point — `mounted` cannot flicker.) The keydown/focus effect stays keyed on `open && top` so a dialog mid-exit neither traps Tab nor handles Escape. (c) the backdrop click guard becomes `top && open`.

Replace `if (!open || !portalNode) return null;` and the `createPortal(...)` block with:

```tsx
if (!portalNode) return null;

return createPortal(
  <AnimatePresence initial={false} onExitComplete={() => setExiting(false)}>
    {open && (
      <div
        key="layer"
        data-cue-layer={id}
        aria-hidden={isLowerLayer ? "true" : undefined}
        inert={isLowerLayer ? true : undefined}
        className="fixed inset-0 z-[90] flex items-start justify-center px-4 py-4 sm:items-center"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <m.button
          data-cue-backdrop=""
          type="button"
          aria-label="Cerrar"
          tabIndex={-1}
          onClick={() => top && open && onDismiss("backdrop")}
          className="absolute inset-0 cursor-default bg-scrim/[0.68] backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: MS.base / 1000, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }}
        />
        <m.div
          ref={shellRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={!title ? label : undefined}
          tabIndex={-1}
          style={{ y: sheetY }}
          initial={mode === "sheet" ? { y: "100%", opacity: 1 } : { scale: 0.96, opacity: 0 }}
          animate={
            mode === "sheet"
              ? { y: 0, opacity: 1, transition: SPRINGS.sheet }
              : { scale: 1, opacity: 1, transition: { duration: MS.slow / 1000, ease: EASE_OUT } }
          }
          exit={
            mode === "sheet"
              ? { y: 24, opacity: 0, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }
              : { scale: 0.98, opacity: 0, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }
          }
          className={`brand-facet-panel brand-surface relative z-10 flex w-full ${sizeClass} flex-col overflow-hidden border-accent/25 shadow-2xl focus:outline-none ${
            mode === "sheet"
              ? "mt-auto max-h-[92svh] rounded-t-2xl sm:mt-0 sm:max-h-[min(86svh,52rem)] sm:rounded-2xl"
              : "max-h-[min(92svh,54rem)] rounded-2xl"
          }`}
        >
          {mode === "sheet" && (
            <div
              data-cue-handle=""
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerUp}
              className="flex cursor-grab touch-none justify-center pb-1 pt-3 active:cursor-grabbing sm:hidden"
            >
              <span className="h-1.5 w-12 rounded-full bg-accent/25" />
            </div>
          )}
          {title && (
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-accent/10 bg-surface-raised/35 px-5 py-5 sm:px-6">
              <h2 id={titleId} className="min-w-0 font-display text-2xl leading-tight text-ink">
                {title}
              </h2>
              <Button
                variant="icon"
                onClick={() => onDismiss("escape")}
                aria-label={label ? `Cerrar ${label}` : "Cerrar diálogo"}
              >
                <CloseIcon />
              </Button>
            </div>
          )}
          <SatelliteContext.Provider value={satelliteRegistry}>{children}</SatelliteContext.Provider>
        </m.div>
      </div>
    )}
  </AnimatePresence>,
  portalNode,
);
```

Add these imports and the drag handlers above the return (after `sizeClass`):

```tsx
import { AnimatePresence, animate, useMotionValue } from "motion/react";
import * as m from "motion/react-m";
import Button from "./Button";
import { EASE_IN, EASE_OUT, EXIT_MS, MS, SHEET_DISMISS, SPRINGS } from "@/app/utils/motionPresets";
```

```tsx
// Sheet drag-to-dismiss (spec §19.4). Pointer events by hand — no `drag` prop —
// because the gesture is one-axis, downward only, with its own thresholds, and
// because a `drag` element fights the sheet's own scroll region. Touch-action:none
// lives on the HANDLE so the sheet body still scrolls.
const sheetY = useMotionValue(0);
const dragRef = useRef<{ startY: number; startT: number; lastY: number; lastT: number } | null>(null);

const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
  if (mode !== "sheet" || !e.isPrimary) return;
  dragRef.current = { startY: e.clientY, startT: performance.now(), lastY: e.clientY, lastT: performance.now() };
  if (typeof e.currentTarget.setPointerCapture === "function") e.currentTarget.setPointerCapture(e.pointerId);
};
const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
  const d = dragRef.current;
  if (!d) return;
  d.lastY = e.clientY;
  d.lastT = performance.now();
  sheetY.set(Math.max(0, e.clientY - d.startY));
};
const onHandlePointerUp = () => {
  const d = dragRef.current;
  if (!d) return;
  dragRef.current = null;
  const travel = Math.max(0, d.lastY - d.startY);
  const dt = Math.max(1, d.lastT - d.startT);
  const velocity = travel / dt;
  if (travel > SHEET_DISMISS.distance || velocity > SHEET_DISMISS.velocity) {
    onDismiss("drag");
    return;
  }
  animate(sheetY, 0, SPRINGS.sheet);
};
```

Notes for the implementer: `m.button`/`m.div` accept `ref` and the `style={{ y }}` motion value; `initial={false}` on `AnimatePresence` means the FIRST render of an already-open dialog does not animate, which is exactly the "renders open before features arrive" rule — but a dialog opened after mount animates, because `open` toggling adds a NEW child to `AnimatePresence`. With `MotionGlobalConfig.skipAnimations` in tests, exit still routes through `onExitComplete` (via `waitFor`).

- [ ] **Step 5: Update consumers of `DismissReason`**

Run the grep from Interfaces; for each site that branches on the reason, make `"drag"` follow the `"backdrop"` branch. Record each file:line in the report.

- [ ] **Step 6: Run tests, gates, inventory**

Run: `node scripts/colour-inventory.mjs && npx vitest run app/components/ui/__tests__/CueDialog.test.tsx app/utils/__tests__/dialogSemantics.test.ts app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/rawMotionLiterals.test.ts && npx tsc --noEmit && npx eslint app/components/ui`
Expected: PASS. (`dialogSemantics` still sees `trapTabTarget` in this file.) If `rawMotionLiterals` moves because the close button's inline `transition-colors` string is gone — it does not count `transition-colors`, only `transition-all` and `duration-N` — nothing to lower.

- [ ] **Step 7: Commit**

```bash
git add app/components/ui/CueDialog.tsx app/utils/motionPresets.ts app/components/ui/__tests__/CueDialog.test.tsx app/utils/__tests__/__fixtures__/colour-inventory.json <consumer files from Step 5>
git commit -m "feat(motion): CueDialog animates in and out, and a sheet drags closed

Registration is keyed on mounted (open or exiting), so focus restores and inert
lifts after the exit, with no provider change. Sheets spring in and follow a
downward drag on the handle; past 80 px or 0.5 px/ms they dismiss with reason
drag. The Cue eyebrow goes (label budget); the close control is the Button."
```

---

### Task 4: Three hand-rolled shells become `CueDialog`s

**Files:**
- Modify: `app/components/kids/SeatPicker.tsx` (lines 1-70 — the shell; keep the body from `<div className="flex-1 space-y-2 overflow-y-auto …">` down unchanged)
- Modify: `app/components/admin/SongFormModal.tsx:88-127` (`Modal`)
- Modify: `app/(client)/me/propose/[roleId]/ProposalEditor.tsx:932-975` (confirm dialog)
- Modify: `app/utils/__tests__/dialogSemantics.test.ts:108`

**Interfaces:** public props of `SeatPicker`, `Modal` and `ProposalEditor` unchanged.

- [ ] **Step 1: SeatPicker**

Replace the Escape effect, `useFocusTrap` and the outer two elements with a `CueDialog`: the file becomes

```tsx
"use client";

import CueDialog from "@/app/components/ui/CueDialog";
import type { SeatView } from "@/app/utils/kidsPlannerView";
import { blockLabel, loadLabel, overlapLabel } from "./kidsPlannerLabels";

/** (keep the existing doc comment) */
export function SeatPicker({ seatView, seatLabel, dateLabel, monthLoad, assignedName, onChoose, onClose }: { /* unchanged */ }) {
  const nextUpId = seatView.options.find((option) => option.block === null)?.pairId ?? null;
  return (
    <CueDialog open mode="sheet" size="sm" label={`${seatLabel} — ${dateLabel}`} onDismiss={onClose}
      title={
        <span className="block">
          <span className="block font-display text-base uppercase tracking-wide text-ink">{seatLabel}</span>
          <span className="block font-label text-[11px] uppercase tracking-widest text-mono-500">{dateLabel}</span>
        </span>
      }
    >
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* existing body, unchanged from `{seatView.unfillableReason && …}` to the end of the list */}
      </div>
    </CueDialog>
  );
}
```

`SeatPicker` is only ever rendered while open (its parent conditionally renders it), so `open` is the constant `true`; the exit animation therefore does not play for this consumer — acceptable in M0b-1 and recorded in the report (the kids planner phase, M8, keeps it mounted and toggles `open`). The `useFocusTrap` import goes; `CueDialog` traps.

- [ ] **Step 2: SongFormModal's `Modal`**

Replace the `Modal` function body with:

```tsx
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode; zClass?: string }) {
  return (
    <CueDialog open title={title} label={title} size="md" onDismiss={onClose}>
      <div className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-6">{children}</div>
    </CueDialog>
  );
}
```

`zClass` stays in the type (callers pass it) but is ignored — `CueDialog` owns `z-[90]`; add a one-line comment. Remove the `useEffect`/`useFocusTrap` imports if now unused.

- [ ] **Step 3: ProposalEditor's confirm dialog**

Replace the `{confirmSubmit && (<div className="fixed inset-0 z-50 …">…</div>)}` block with:

```tsx
<CueDialog open={confirmSubmit} title="Enviar propuesta" size="sm" onDismiss={() => setConfirmSubmit(false)}>
  <div className="space-y-5 p-6">
    <p className="font-body text-sm text-mono-400">
      Vas a enviar {songs.length} canción{songs.length !== 1 ? "es" : ""} para {serviceLabel}. El admin recibirá tu propuesta para revisión.
    </p>
    <ul className="space-y-1 rounded-xl border border-accent/10 bg-accent-deep/10 p-3">
      {songs.map((s, i) => (
        <li key={s.songId} className="flex items-center gap-2">
          <span className="w-4 text-right font-label text-[11px] tabular-nums text-mono-600">{i + 1}</span>
          <span className="flex-1 truncate font-body text-sm">{s.title}</span>
          <span className="shrink-0 font-label text-xs text-accent">{s.play_key}</span>
        </li>
      ))}
    </ul>
    <div className="flex gap-3">
      <Button className="flex-1" onClick={() => setConfirmSubmit(false)}>Cancelar</Button>
      <Button className="flex-1" variant="primary" disabled={saving} onClick={() => { setConfirmSubmit(false); save("pending"); }}>
        Confirmar
      </Button>
    </div>
  </div>
</CueDialog>
```

Import `CueDialog` and `Button` from `@/app/components/ui/…`; remove `confirmRef`/`confirmTitleId` and their `useFocusTrap`/`useId` uses if nothing else references them. This dialog toggles `open`, so it animates both ways.

- [ ] **Step 4: Lower the overlay floor honestly**

In `dialogSemantics.test.ts:108` the floor `toBeGreaterThanOrEqual(4)` counted CueDialog, SeatPicker, SongFormModal, ProposalEditor (+ BottomNav exempt). After this task the scan finds CueDialog and BottomNav. Change to `toBeGreaterThanOrEqual(2)` with a comment: "2 as of M0b-1: CueDialog and the exempt BottomNav. Three hand-rolled shells migrated onto CueDialog on 2026-09-08; a new hand-rolled overlay raises this by one and must carry the semantics."

- [ ] **Step 5: Tests that pin these components**

Run: `npx vitest run app/components/kids app/components/admin/__tests__/SongFormModal* app/components/__tests__/proposal* app/utils/__tests__/dialogSemantics.test.ts 2>&1 | tail -30` — then the full gate `npx tsc --noEmit && npm test && npx eslint .`. Any kids/proposal test that asserted the old shell's classes or `getByRole("dialog")` name must be updated to the CueDialog structure (name comes from `label`/`title`); list each change in the report.

- [ ] **Step 6: Inventory and commit**

`node scripts/colour-inventory.mjs` (three files lost colour literals) and, because `rawMotionLiterals` counts `transition-all`/`duration-N` only, check whether the removed shells carried any (`git diff` for `transition-all`/`duration-`) and lower `BASELINE` accordingly in the same commit.

```bash
git add -A app/components/kids/SeatPicker.tsx app/components/admin/SongFormModal.tsx "app/(client)/me/propose/[roleId]/ProposalEditor.tsx" app/utils/__tests__/dialogSemantics.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json app/utils/__tests__/rawMotionLiterals.test.ts <updated tests>
git commit -m "refactor(motion): SeatPicker, SongFormModal and the proposal confirm are CueDialogs

Three hand-rolled shells, three focus traps and three Escape handlers become one
primitive with motion. The dialog-semantics floor drops to the two files that remain."
```

---

### Task 5: `Toast`, `ToastProvider`, `useToast`

**Files:**
- Create: `app/components/ui/Toast.tsx`
- Create: `app/components/ui/__tests__/Toast.test.tsx`
- Modify: `app/utils/Provider.tsx` (mount `ToastProvider` inside `MotionProvider`)

**Interfaces:**
- `useToast(): { toast: (opts: ToastOptions) => string; dismiss: (id: string) => void }`
- `ToastOptions = { message: string; tone?: "ok" | "error" | "info"; duration?: number; hold?: boolean; action?: { label: string; onClick: () => void } }` — default duration 3000 ms; `hold: true` means no timer (the `useTransientValue` `hold` semantic); a new toast with the same `message` replaces the previous one's timer (matches `show`'s restart).
- Viewport: portalled to a `[data-toast-root]` node appended to `document.body` (a sibling of the dialog root, so it is never `inert`), `fixed inset-x-0 z-[95] flex flex-col items-center gap-2 px-4`, bottom offset `calc(1.5rem + env(safe-area-inset-bottom) + var(--bottom-nav-h, 0px))`; `--bottom-nav-h` is declared in `brand.css :root` as `0px` (M1 publishes the measured value). Items: `role="status"` (`ok`/`info`) or `role="alert"` (`error`), `aria-live` matching; enter `rise` via `initial={false}`-free `AnimatePresence` (toasts are always created after mount and never above the fold, so `initial` animation is fine here), exit `fade`; max 3 visible (oldest dismissed).
- Styling: `rounded-xl border px-5 py-3 font-label text-xs uppercase tracking-widest shadow-xl bg-surface-raised-alt` with tone borders `border-accent/30` (ok/info) and `border-negative-border/60` (error); the action renders a `Button variant="ghost" size="sm"`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import { ToastProvider, useToast } from "../Toast";

installMotionTestEnv();
afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.useRealTimers(); });
beforeEach(() => vi.useFakeTimers());

function Trigger({ opts }: { opts: Parameters<ReturnType<typeof useToast>["toast"]>[0] }) {
  const { toast } = useToast();
  return <button onClick={() => toast(opts)}>go</button>;
}
const wrap = (ui: React.ReactNode) => render(<MotionProvider><ToastProvider>{ui}</ToastProvider></MotionProvider>);

describe("Toast", () => {
  it("shows a status toast and removes it after its duration", async () => {
    wrap(<Trigger opts={{ message: "Guardado" }} />);
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByRole("status")).toHaveTextContent?.("Guardado") ?? expect(screen.getByRole("status").textContent).toContain("Guardado");
    act(() => { vi.advanceTimersByTime(3000); });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("an error toast is an alert", () => {
    wrap(<Trigger opts={{ message: "Error al guardar", tone: "error" }} />);
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByRole("alert").textContent).toContain("Error al guardar");
  });

  it("hold keeps the toast until dismissed", () => {
    wrap(<Trigger opts={{ message: "Verifica", hold: true }} />);
    fireEvent.click(screen.getByText("go"));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(screen.getByRole("status").textContent).toContain("Verifica");
  });

  it("renders an action and runs it", () => {
    const onClick = vi.fn();
    wrap(<Trigger opts={{ message: "Cambios sin verificar", hold: true, action: { label: "Recargar", onClick } }} />);
    fireEvent.click(screen.getByText("go"));
    fireEvent.click(screen.getByRole("button", { name: "Recargar" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("portals outside the app root so it stays usable while a dialog inerts the page", () => {
    wrap(<Trigger opts={{ message: "Hola" }} />);
    fireEvent.click(screen.getByText("go"));
    const root = document.querySelector("[data-toast-root]");
    expect(root).not.toBeNull();
    expect(root!.querySelector("[role=status]")).not.toBeNull();
    expect(root!.closest("[data-cue-app-root]")).toBeNull();
  });

  it("caps the stack at three, dropping the oldest", () => {
    wrap(<Trigger opts={{ message: "Uno", hold: true }} />);
    // one trigger, four clicks: same message replaces its own timer, so use distinct messages via a second harness
    fireEvent.click(screen.getByText("go"));
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
```

(The last case is intentionally minimal; the implementer may extend it with a harness that emits distinct messages.) Replace the `toHaveTextContent?.` line with the plain `textContent` assertion — there is no jest-dom.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/ui/__tests__/Toast.test.tsx`
Expected: FAIL — `../Toast` not found.

- [ ] **Step 3: Write `Toast.tsx`**

```tsx
"use client";

// One toast stack for the app (spec §4, §19.4). Replaces the hand-rolled
// `fixed bottom-6` divs and keeps useTransientValue's two semantics: a new toast
// restarts the clock, and `hold` persists until something dismisses it.
//
// The viewport portals to its own node beside the dialog root, so a toast raised
// from inside a dialog is visible and readable while the app root is inert.
// z-[95] sits above dialogs (z-[90]) on purpose: "Guardado" after a dialog save
// must be seen. No `appear`-style trap here — toasts are only ever created after
// mount, and their exit is what needs motion.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import Button from "./Button";
import { EASE_IN, EASE_OUT, EXIT_MS, MS } from "@/app/utils/motionPresets";

export type ToastTone = "ok" | "error" | "info";
export type ToastOptions = {
  message: string;
  tone?: ToastTone;
  duration?: number;
  hold?: boolean;
  action?: { label: string; onClick: () => void };
};
type ToastRecord = ToastOptions & { id: string; tone: ToastTone };

const MAX_VISIBLE = 3;
const DEFAULT_MS = 3000;

const ToastContext = createContext<{ toast: (o: ToastOptions) => string; dismiss: (id: string) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastRecord[]>([]);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  useEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("data-toast-root", "");
    document.body.appendChild(el);
    setNode(el);
    return () => {
      el.remove();
      setNode(null);
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback((o: ToastOptions) => {
    const id = `toast-${++seq.current}`;
    const record: ToastRecord = { ...o, id, tone: o.tone ?? "ok" };
    setItems((prev) => {
      // Same message again: replace it (restart the clock), like useTransientValue's show.
      const kept = prev.filter((x) => x.message !== o.message);
      const next = [...kept, record];
      return next.slice(Math.max(0, next.length - MAX_VISIBLE));
    });
    if (!o.hold) {
      timers.current.set(id, setTimeout(() => dismiss(id), o.duration ?? DEFAULT_MS));
    }
    return id;
  }, [dismiss]);

  // Clear timers of toasts that left the list without dismiss() (replaced or evicted).
  useEffect(() => {
    const live = new Set(items.map((x) => x.id));
    for (const [id, t] of timers.current) if (!live.has(id)) { clearTimeout(t); timers.current.delete(id); }
  }, [items]);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {node && createPortal(<ToastViewport items={items} onDismiss={dismiss} />, node)}
    </ToastContext.Provider>
  );
}

function ToastViewport({ items, onDismiss }: { items: ToastRecord[]; onDismiss: (id: string) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[95] flex flex-col items-center gap-2 px-4"
      style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom) + var(--bottom-nav-h, 0px))" }}
    >
      <AnimatePresence>
        {items.map((t) => (
          <m.div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            aria-live={t.tone === "error" ? "assertive" : "polite"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: MS.base / 1000, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border bg-surface-raised-alt px-5 py-3 font-label text-xs uppercase tracking-widest text-ink shadow-xl ${
              t.tone === "error" ? "border-negative-border/60" : "border-accent/30"
            }`}
          >
            <span className="min-w-0">{t.message}</span>
            {t.action && (
              <Button variant="ghost" size="sm" onClick={() => { t.action?.onClick(); onDismiss(t.id); }}>
                {t.action.label}
              </Button>
            )}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

Declare `--bottom-nav-h: 0px;` in `app/brand.css` `:root` (non-colour; comment: "published by BottomNav in M1; 0 until then") and regenerate the inventory.

- [ ] **Step 4: Mount the provider**

In `app/utils/Provider.tsx`: `import { ToastProvider } from "@/app/components/ui/Toast"` and wrap: `<MotionProvider><ToastProvider>{children}</ToastProvider></MotionProvider>`.

- [ ] **Step 5: Run, gates, commit**

Run: `node scripts/colour-inventory.mjs && npx vitest run app/components/ui/__tests__/Toast.test.tsx app/utils/__tests__/themeWiring.test.ts app/utils/__tests__/brandCss.test.ts app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/motionImportBoundary.test.ts && npx tsc --noEmit && npx eslint app/components/ui app/utils/Provider.tsx`
Expected: PASS.

```bash
git add app/components/ui/Toast.tsx app/components/ui/__tests__/Toast.test.tsx app/utils/Provider.tsx app/brand.css app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): one toast stack — useToast, a portalled viewport, hold and actions

Keeps useTransientValue's two semantics (restart on repeat, hold until replaced),
sits above dialogs and outside the inert app root, and animates its exit."
```

---

### Task 6: Seven fixed toasts become `useToast`

**Files (site → what it renders today, from the inventory):**
- `app/components/EditSongButton.tsx:83` (`useTransientValue<string|null>`, 3000) and `:427-431` (fixed, `z-[95]`)
- `app/components/ProfilePanel.tsx:80,114` (`{msg, ok}`, 3500; `showToast(msg, ok=true)`) and `:364-372` (`z-[60]`, role by `ok`)
- `app/components/admin/ServicesPanel.tsx:167` (`string|null`, ~25 call sites) and `:1256-1260`
- `app/components/admin/AdminPanel.tsx:733` and `:1283-1287`
- `app/components/admin/ProposalsPanel.tsx:411,424` (`{msg, ok}`) and `:793-801`
- `app/components/admin/ContentPanel.tsx:52` and `:271-275`
- `app/(client)/me/propose/[roleId]/ProposalEditor.tsx:156,319` (`{msg, ok}`) and `:981-993` (fixed top-20)

NOT in this task (inline by design, later phases): MonthGenerator's held swap block with its embedded button, the Kids inline statuses, AvailabilityCalendar's saved flash and conflict line, ProposalThread's inline error.

- [ ] **Step 1: Per site**

For each file: replace the `useTransientValue` toast state with `const { toast } = useToast();` (import from `@/app/components/ui/Toast`); replace every `showToast(x)`/`setToast(x)` call with `toast({ message: x })` — for `{msg, ok}` shapes `toast({ message: msg, tone: ok ? "ok" : "error" })`; delete the fixed JSX block. Keep `useTransientValue` imported only where the file still uses it for something else (ProfilePanel's `saved` flash, if any). Preserve the exact Spanish messages.

ProfilePanel's `role="alert"` for errors is now `tone: "error"`. ProposalEditor's top-positioned toast moves to the bottom stack (spec §5.7).

- [ ] **Step 2: Tests that pinned the old DOM**

Run: `npx vitest run app/components app/\(client\) 2>&1 | tail -40`. Tests asserting the old `fixed bottom-6` element or `getByRole("status")` text now find the toast in the viewport ONLY if the component under test is wrapped in `ToastProvider` (and `MotionProvider`). Where a test renders one of these seven components bare, wrap it; list each in the report.

- [ ] **Step 3: Lower the raw-motion baseline if any removed block carried `transition-all`/`duration-N`**, regenerate the colour inventory, run the full gate, and commit:

```bash
git commit -am "refactor(motion): seven hand-rolled toasts become useToast

EditSongButton, ProfilePanel, ServicesPanel, AdminPanel, ProposalsPanel,
ContentPanel and the proposal editor now share one stack, one z-index and one
exit animation."
```

(Use explicit `git add` paths rather than `-am` if untracked test wrappers were added.)

---

### Task 7: `Menu`

**Files:**
- Create: `app/components/ui/Menu.tsx`
- Create: `app/components/ui/__tests__/Menu.test.tsx`

**Interfaces:**
- `<Menu label="Más acciones" trigger={<Button variant="icon" aria-label="Más acciones">…</Button>} align="end" | "start" onOpenChange?>` — clones the trigger with `ref`, `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, `onClick` (toggle), `onKeyDown` (ArrowDown opens and focuses the first item; Escape closes).
- Children: `<MenuItem onSelect icon? danger? disabled? href?>label</MenuItem>` (renders `role="menuitem"` on a `button` or `next/link`), `<MenuSeparator />`, `<MenuHeader>` (non-interactive, `role="presentation"`).
- Panel: `role="menu" aria-label={label}` in a `relative` wrapper, `absolute top-full mt-2 z-50 min-w-[13rem] rounded-xl border border-surface-accent-20 bg-surface-raised-alt shadow-2xl overflow-hidden`, `right-0` for `align="end"`; opens with `scale 0.96→1` + fade from the trigger corner (`transform-origin` top-right/left) over `MS.base`, exits over `EXIT_MS`; `initial={false}` is NOT used (menus open after mount).
- Keyboard: ArrowDown/ArrowUp move focus with wrap, Home/End, Escape closes and refocuses the trigger (`preventDefault` + `stopPropagation` — PracticePlaylistButton's test requires that Escape inside the menu does not reach outer handlers), Tab closes. Outside `pointerdown` closes. Selecting an item closes then calls `onSelect`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import Button from "../Button";
import Menu, { MenuItem, MenuSeparator } from "../Menu";

installMotionTestEnv();
afterEach(cleanup);

function Harness({ onSelect = vi.fn() }: { onSelect?: (v: string) => void }) {
  return (
    <MotionProvider>
      <Menu label="Más acciones" trigger={<Button aria-label="Más acciones">⋮</Button>} align="end">
        <MenuItem onSelect={() => onSelect("copiar")}>Copiar</MenuItem>
        <MenuItem onSelect={() => onSelect("publicar")}>Publicar</MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={() => onSelect("eliminar")}>Eliminar</MenuItem>
      </Menu>
    </MotionProvider>
  );
}

describe("Menu", () => {
  it("is closed by default with the trigger wired for a menu", () => {
    render(<Harness />);
    const t = screen.getByRole("button", { name: "Más acciones" });
    expect(t.getAttribute("aria-haspopup")).toBe("menu");
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on click, lists items, selects and closes", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    const menu = screen.getByRole("menu", { name: "Más acciones" });
    expect(menu.getAttribute("id")).toBe(screen.getByRole("button", { name: "Más acciones" }).getAttribute("aria-controls"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Publicar" }));
    expect(onSelect).toHaveBeenCalledWith("publicar");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("ArrowDown on the trigger opens and focuses the first item; arrows wrap; Escape closes and refocuses", async () => {
    render(<Harness />);
    const t = screen.getByRole("button", { name: "Más acciones" });
    t.focus();
    fireEvent.keyDown(t, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copiar" })));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Eliminar" }));
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    document.removeEventListener("keydown", outer);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(t);
  });

  it("closes on an outside pointerdown", async () => {
    render(<div><Harness /><button>fuera</button></div>);
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    fireEvent.pointerDown(screen.getByText("fuera"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("a danger item carries the negative tone class", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    expect(screen.getByRole("menuitem", { name: "Eliminar" }).className).toContain("text-negative-fg");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/ui/__tests__/Menu.test.tsx` — FAIL, `../Menu` not found.

- [ ] **Step 3: Write `Menu.tsx`**

```tsx
"use client";

// Anchored menu (spec §4, §19.4). Replaces three hand-rolled dropdowns. Real menu
// semantics — role=menu, roving focus with arrows, Escape back to the trigger —
// which is why the avatar dropdown, which deliberately avoided role=menu while it
// had no arrow navigation, can carry it now.
//
// Positioning is `absolute` inside a `relative` wrapper: every consumer today
// anchors its menu to the trigger's corner, and a portal would break the inert
// contract of dialogs (a menu inside a dialog must stay inside its layer).

import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ReactElement } from "react";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { EASE_IN, EASE_OUT, EXIT_MS, MS } from "@/app/utils/motionPresets";

const MenuCtx = createContext<{ close: (refocus: boolean) => void } | null>(null);

type TriggerProps = {
  ref: React.Ref<HTMLButtonElement>;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string;
  onClick: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

export default function Menu({
  label,
  trigger,
  align = "end",
  children,
  onOpenChange,
}: {
  label: string;
  trigger: ReactElement<Partial<TriggerProps> & { onClick?: (e: React.MouseEvent) => void; onKeyDown?: (e: React.KeyboardEvent) => void }>;
  align?: "start" | "end";
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const [open, setOpenState] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const setOpen = useCallback((next: boolean) => { setOpenState(next); onOpenChange?.(next); }, [onOpenChange]);
  const close = useCallback((refocus: boolean) => { setOpen(false); if (refocus) triggerRef.current?.focus(); }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false); };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, close]);

  const items = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!open || !focusFirst) return;
    items()[0]?.focus();
    setFocusFirst(false);
  }, [open, focusFirst]);

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Tab") { close(false); }
  };

  const triggerEl = cloneElement(trigger, {
    ref: triggerRef,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": id,
    onClick: (e: React.MouseEvent) => { trigger.props.onClick?.(e); if (!e.defaultPrevented) setOpen(!open); },
    onKeyDown: (e: React.KeyboardEvent) => {
      trigger.props.onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setFocusFirst(true); }
      if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(true); }
    },
  } as Partial<TriggerProps>);

  return (
    <div ref={rootRef} className="relative inline-block">
      {triggerEl}
      <AnimatePresence>
        {open && (
          <MenuCtx.Provider value={{ close }}>
            <m.div
              ref={panelRef}
              id={id}
              role="menu"
              aria-label={label}
              onKeyDown={onPanelKeyDown}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: MS.base / 1000, ease: EASE_OUT } }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }}
              style={{ transformOrigin: align === "end" ? "top right" : "top left" }}
              className={`absolute top-full z-50 mt-2 min-w-[13rem] overflow-hidden rounded-xl border border-surface-accent-20 bg-surface-raised-alt py-1 shadow-2xl ${align === "end" ? "right-0" : "left-0"}`}
            >
              {children}
            </m.div>
          </MenuCtx.Provider>
        )}
      </AnimatePresence>
    </div>
  );
}

const ITEM =
  "flex w-full items-center gap-3 px-4 py-2.5 text-left font-label text-xs uppercase tracking-widest transition-colors duration-fast " +
  "text-mono-500 hover:bg-accent/10 hover:text-accent focus:outline-none focus-visible:bg-accent/10 focus-visible:text-accent aria-disabled:opacity-40 aria-disabled:pointer-events-none";

export function MenuItem({ onSelect, href, icon, danger = false, disabled = false, children }: {
  onSelect?: () => void; href?: string; icon?: React.ReactNode; danger?: boolean; disabled?: boolean; children: React.ReactNode;
}) {
  const ctx = useContext(MenuCtx);
  const cls = `${ITEM} ${danger ? "text-negative-fg hover:text-negative-fg" : ""}`;
  const pick = () => { if (disabled) return; ctx?.close(false); onSelect?.(); };
  if (href) return <Link role="menuitem" href={href} className={cls} aria-disabled={disabled || undefined} onClick={() => ctx?.close(false)} tabIndex={-1}>{icon}{children}</Link>;
  return <button type="button" role="menuitem" className={cls} aria-disabled={disabled || undefined} onClick={pick} tabIndex={-1}>{icon}{children}</button>;
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-edge-accent-subtle" />;
}

export function MenuHeader({ children }: { children: React.ReactNode }) {
  return <div role="presentation" className="border-b border-edge-accent-subtle px-4 py-3">{children}</div>;
}
```

`tabIndex={-1}` on items is the roving pattern: the trigger is the tab stop, arrows move inside. `Children` and `isValidElement` imports are unused — drop them.

- [ ] **Step 4: Run, gates, inventory, commit**

Run: `node scripts/colour-inventory.mjs && npx vitest run app/components/ui/__tests__/Menu.test.tsx app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/lightContrast.test.ts app/utils/__tests__/motionImportBoundary.test.ts && npx tsc --noEmit && npx eslint app/components/ui`

```bash
git add app/components/ui/Menu.tsx app/components/ui/__tests__/Menu.test.tsx app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): Menu — an anchored menu with roving focus and an exit

role=menu, arrows with wrap, Escape back to the trigger, outside-press to close,
scale-from-corner in and a fade out."
```

---

### Task 8: Three menus become `Menu`

**Files:**
- Modify: `app/components/NavMenu.tsx` (the `open` state, outside-click effect, `MenuItem`, and the `{open && <nav …>}` block, lines ~40-70 and 138-186)
- Modify: `app/components/admin/ServiceReadinessCard.tsx:231-291`
- Modify: `app/components/PracticePlaylistButton.tsx:95-165`

- [ ] **Step 1: NavMenu**

Delete the local `MenuItem`, `open` state, `ref`, and the mousedown/keydown effect. Render:

```tsx
<Menu label="Menú de cuenta" align="end" trigger={
  <button
    type="button"
    className="relative flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base group"
    aria-label={notifCount > 0 ? `Menú de usuario, ${notifCount} ${notifCount === 1 ? "notificación" : "notificaciones"}` : "Menú de usuario"}
  >
    {/* existing avatar/initials/badge markup unchanged */}
  </button>
}>
  <MenuHeader>{/* existing identity block: image + firstName, or firstName */}</MenuHeader>
  <MenuItem href="/me">Mi perfil</MenuItem>
  {showSchedule && inWorship && <MenuItem href="/schedule">Calendario</MenuItem>}
  {showTags && inWorship && <MenuItem href="/tag">#Tags</MenuItem>}
  {inKids && <MenuItem href="/kids">Oasis Kids</MenuItem>}
  {managesKids && <MenuItem href="/kids/admin">Planear Kids</MenuItem>}
  {isAdmin && <MenuItem href="/admin">Admin</MenuItem>}
  <MenuSeparator />
  <MenuItem onSelect={() => { clearThemeMirror(); signOut({ callbackUrl: "/" }); }}>Cerrar sesión</MenuItem>
</Menu>
```

Keep every existing comment about ministry gating beside the items it explains; delete the "not a menu widget" comment and replace it with one line: "A real menu now: Menu supplies arrow-key navigation, so role=menu is honest."

- [ ] **Step 2: ServiceReadinessCard**

Replace the `menuTriggerRef` button + `{menuOpen && (<> … </>)}` block with a `Menu` whose trigger is the existing kebab `<button>` (minus `onClick`/`aria-*`, which Menu supplies) and whose items are the three existing `MenuItem`s re-expressed with `Menu`'s `MenuItem` (`icon`, `danger`, `disabled={!gate.ok}` — read how the local `MenuItem` used `gate` and map it: if the gate blocks, render the item `disabled` with the gate's reason in `title`). Delete `menuOpen` state and the local `MenuItem` if unused elsewhere. Keep the `CARD_STYLE.menuTrigger` class on the trigger.

- [ ] **Step 3: PracticePlaylistButton**

Replace `open`, `rootRef`, `closeDisclosure`, `onDisclosureKeyDown`, the disclosure `<div>`, and the trigger's `aria-controls/aria-expanded` with a `Menu` around the existing trigger button (keep `aria-disabled`, `guardPending` in `onClick` — Menu respects `e.preventDefault()` from the trigger's own handler, so `guardPending` must call `event.preventDefault()` when pending; check it does, add it if not). Items: `<MenuItem onSelect={() => void go("musica")}>🎵 Música <span …>referencia musical</span></MenuItem>` and the Letras twin. Run its test: `npx vitest run app/components/__tests__/PracticePlaylistButton.test.tsx` — it pins `aria-expanded` toggling, the item names, Escape not reaching outer handlers, and `aria-disabled` on the pending trigger; adapt selectors that looked for the old disclosure `id` to `role="menu"`.

- [ ] **Step 4: Baseline, inventory, gate, commit**

NavMenu's two `transition-all` go: lower `rawMotionLiterals` `BASELINE.transitionAll` by the number removed (measure with the test's own equality failure). `node scripts/colour-inventory.mjs`. Full gate.

```bash
git commit -m "refactor(motion): the avatar menu, the service kebab and Practicar are Menus

One anchored menu with arrow keys and an exit replaces three dropdowns."
```

---

### Task 9: `Collapse` and four disclosures

**Files:**
- Create: `app/components/ui/Collapse.tsx` + `__tests__/Collapse.test.tsx`
- Modify: `app/components/admin/IntegrityQueuePanel.tsx:207-218, 272, 325-339`; `app/components/admin/ActivityPanel.tsx:161-163, 201, 209`; `app/components/admin/ServicesPanel.tsx:1108-1122`; `app/components/AvailabilityCalendar.tsx:340-350, 368-405`

**Interfaces:** `<Collapse open id? className?>children</Collapse>` — children stay MOUNTED; height animates `0 ↔ "auto"` over `MS.slow`/`EASE_OUT` (opening) and `EXIT_MS`/`EASE_IN` (closing) with `overflow: hidden`; when closed the wrapper is `inert` and `aria-hidden` (after the close animation) so focus cannot land inside; `initial={false}` so an open disclosure renders open before features load. The toggle button stays the consumer's, with `aria-expanded` and `aria-controls={id}`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import Collapse from "../Collapse";

installMotionTestEnv();
afterEach(cleanup);
const wrap = (open: boolean) => render(<MotionProvider><Collapse open={open} id="c"><button>dentro</button></Collapse></MotionProvider>);

describe("Collapse", () => {
  it("keeps children mounted while closed, but inert and hidden from AT", () => {
    wrap(false);
    const box = document.getElementById("c")!;
    expect(box.querySelector("button")).not.toBeNull();
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect((box as HTMLElement & { inert: boolean }).inert).toBe(true);
  });
  it("is open, reachable and not hidden when open", () => {
    wrap(true);
    const box = document.getElementById("c")!;
    expect(box.getAttribute("aria-hidden")).toBeNull();
    expect((box as HTMLElement & { inert: boolean }).inert).toBe(false);
    expect(screen.getByRole("button", { name: "dentro" })).toBeTruthy();
  });
  it("flips both attributes when toggled", async () => {
    const { rerender } = wrap(false);
    rerender(<MotionProvider><Collapse open id="c"><button>dentro</button></Collapse></MotionProvider>);
    await waitFor(() => expect(document.getElementById("c")!.getAttribute("aria-hidden")).toBeNull());
    rerender(<MotionProvider><Collapse open={false} id="c"><button>dentro</button></Collapse></MotionProvider>);
    await waitFor(() => expect(document.getElementById("c")!.getAttribute("aria-hidden")).toBe("true"));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run app/components/ui/__tests__/Collapse.test.tsx`.

- [ ] **Step 3: Write `Collapse.tsx`**

```tsx
"use client";

// Expand/collapse with motion (spec §4). The ONE place height animates: motion
// measures `auto` and tweens it, on user-triggered disclosures only (spec §2.2).
// Children stay mounted — IntegrityQueuePanel focuses an entry right after
// opening and relies on the node existing — and a closed Collapse is inert +
// aria-hidden so nothing inside is reachable. `initial={false}` means a disclosure
// that is open at first paint renders open before the feature chunk arrives.

import { useEffect, useState } from "react";
import * as m from "motion/react-m";
import { EASE_IN, EASE_OUT, EXIT_MS, MS } from "@/app/utils/motionPresets";

export default function Collapse({ open, id, className = "", children }: { open: boolean; id?: string; className?: string; children: React.ReactNode }) {
  // Attributes flip AFTER the close animation (so content fades while still
  // readable) and BEFORE the open animation (so it is reachable at once).
  const [hidden, setHidden] = useState(!open);
  useEffect(() => { if (open) setHidden(false); }, [open]);
  return (
    <m.div
      id={id}
      aria-hidden={hidden ? "true" : undefined}
      inert={hidden ? true : undefined}
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
      transition={open ? { duration: MS.slow / 1000, ease: EASE_OUT } : { duration: EXIT_MS / 1000, ease: EASE_IN }}
      onAnimationComplete={() => { if (!open) setHidden(true); }}
      style={{ overflow: "hidden" }}
      className={className}
    >
      {children}
    </m.div>
  );
}
```

Under `skipAnimations`, `onAnimationComplete` still fires (motion resolves instantly); the third test's `waitFor` covers it. If it does not fire in jsdom, fall back to a `useEffect` that sets `hidden` when `open` becomes false after `EXIT_MS` via `setTimeout` — say which in the report.

- [ ] **Step 4: Adopt at four sites**

- IntegrityQueuePanel: the body `<div id="integrity-queue-body" hidden={!open}>` becomes `<Collapse id="integrity-queue-body" open={open}>`; each entry's `hidden={!expanded}` block likewise (give each an id `integrity-entry-<key>` and set `aria-controls` on its toggle). The chevron keeps its `rotate` class but switches `transition-transform` to `transition-transform duration-base`.
- ActivityPanel: the `{expanded === m._id && <div …>}` becomes `<Collapse open={expanded === m._id} id={`activity-${m._id}`}>`; the row button gains `aria-expanded={expanded === m._id}` and `aria-controls`.
- ServicesPanel "Roles previos": `{showPastMonths && …}` becomes `<Collapse open={showPastMonths} id="services-past-months">`; the toggle gains `aria-expanded`/`aria-controls`.
- AvailabilityCalendar "Repetir…": the block at 368-405 wraps in `<Collapse open={recurOpen} id="availability-recur">`; the button already has `aria-expanded` — add `aria-controls`.

- [ ] **Step 5: Tests, gate, inventory, commit**

Run the panels' tests (`npx vitest run app/components/admin app/components/__tests__/availability*`), fix any that asserted the old conditional render (an element now exists while closed — tests must check `aria-hidden`/visibility rather than absence), then the full gate; `node scripts/colour-inventory.mjs`.

```bash
git commit -m "feat(motion): Collapse — height animates on four disclosures, content stays mounted

Integrity queue, activity rows, Roles previos and Repetir open and close with
motion; closed content is inert and hidden from assistive tech."
```

---

### Task 10: Gallery motion, label budget, docs

**Files:**
- Create: `app/(gallery)/theme-gallery/[theme]/GalleryMotion.tsx`; modify the gallery layout to wrap `{children}` in it
- Create: `app/utils/__tests__/labelBudget.test.ts`
- Modify: `docs/MOTION.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `CLAUDE.md` + `AGENTS.md` (parity), `docs/superpowers/specs/2026-09-08-premium-motion-design.md` (a Part VII line: M0b-1 shipped)

- [ ] **Step 1: GalleryMotion**

```tsx
"use client";
// The gallery mounts no Provider (themeGallery.test.ts pins that), so its fixtures
// had no motion features: an m.* element would sit at its initial values forever.
// This wrapper loads the features synchronously (a baseline capture must not race
// a chunk) and, under data-motion="off", skips animations so every frame is final.
import { LazyMotion, MotionGlobalConfig, domMax } from "motion/react";
import { useEffect } from "react";

export default function GalleryMotion({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    MotionGlobalConfig.skipAnimations = document.documentElement.dataset.motion === "off";
  }, []);
  return <LazyMotion features={domMax} strict>{children}</LazyMotion>;
}
```

This file imports `motion` outside `ui/` — extend `isAllowedMotionImporter` in `motionImportBoundary.test.ts` to allow exactly `app/(gallery)/theme-gallery/[theme]/GalleryMotion.tsx` with a comment naming why, and add a fire-proof that a sibling fixture file is still refused. `themeGallery.test.ts` pins that the layout does not import `Provider` — it may import this component; run the test.

- [ ] **Step 2: Label budget test**

```ts
// app/utils/__tests__/labelBudget.test.ts
// Spec §18 (decision N): one eyebrow per surface. Pins the six named labels at
// their audited counts and ratchets DOWN; a phase that removes one lowers its
// number in the same commit. Equality, so the pin cannot go stale.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BUDGET: Record<string, number> = {
  ">Cue<": 0,                 // removed in M0b-1 (CueDialog)
  ">Servicio<": 1,            // DayCard header — goes in R1
  "Índice musical": 1,        // SongSearchList — goes in R1
  "títulos": 1,               // home library count — goes in R1
  "Backstage operations": 1,  // /admin eyebrow — goes in R5
  "Acceso autorizado": 1,     // /admin pill — goes in R5
};

function tsx(): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(path.join(REPO_ROOT, d), { withFileTypes: true })) {
    const rel = path.join(d, e.name); if (rel.includes("__tests__")) continue;
    if (e.isDirectory()) walk(rel); else if (rel.endsWith(".tsx")) out.push(rel); } };
  walk("app"); return out;
}

describe("label budget", () => {
  const files = tsx().map((f) => readFileSync(path.join(REPO_ROOT, f), "utf8"));
  it.each(Object.entries(BUDGET))("%s appears exactly %i times", (needle, n) => {
    const count = files.reduce((acc, src) => acc + src.split(needle).length - 1, 0);
    expect(count).toBe(n);
  });
});
```

Run it once to calibrate: if a needle's real count differs from the table, fix the TABLE to the measured number (and say so) — the value of the test is the ratchet, not the guess.

- [ ] **Step 3: Docs**

`docs/MOTION.md`: primitives table gains `CueDialog` (motion, drag, `"drag"` reason, mounted-keyed registration), `Toast`/`useToast`, `Menu`/`MenuItem`/`MenuSeparator`/`MenuHeader`, `Collapse`; bundle row from Task 1; rule 4 updated (the gallery now has `GalleryMotion`); a "Load-failure behaviour" paragraph: Toast content is visible at `initial` opacity 1, Menu/Collapse render open at `initial={false}`, CueDialog renders open — only exits depend on features. `docs/UTILITIES_AND_COMPONENTS.md` motion table rows. `CLAUDE.md` reusable utils: `useToast` (every fixed toast; `useTransientValue` stays for inline flashes), `Menu` (every anchored dropdown), `Collapse` (every disclosure), `CueDialog` (every dialog — no hand-rolled `fixed inset-0` shell); mirror to `AGENTS.md`. Spec: append `# Part VII — M0b-1 shipped` with the commit range and the measured chunk.

- [ ] **Step 4: Gates, commit**

`npx tsc --noEmit && npm test && npx eslint .` — 0 errors.

```bash
git commit -m "docs(motion): M0b-1 — gallery motion, the label budget, and the overlay primitives documented"
```

---

### Task 11: Delivery

Same ladder as M0a Task 11: merge into `preview`, push, `deploy-verifier` (alias + SHA), `scripts/dev-verify.ts` captures of `/`, `/schedule` (open the day sheet: `--click "domingo, 13 de septiembre"`), `/admin?tab=services` (open a card menu: `--click "Más acciones"`), `/me` phone; fresh whole-branch code review on the most capable model carrying the docs-audit and worklog checklists; one fix wave; scoped re-review; PR to `main`; Frank's look; production alias verified after the merge. Worklog batch at close.

---

## Self-review

**Spec coverage (M0b-1 scope):** CueDialog motion + drag + closing ✔ (T3), hand-rolled shells → CueDialog ✔ (T4), Toast ✔ (T5–6), Menu ✔ (T7–8), Collapse ✔ (T9), gallery fixture motion ✔ (T10; the `controls` FIXTURE itself is M0b-2 with the controls), label budget ✔ (T10), Button forwardRef ✔ (T2), feature chunk measured ✔ (T1). Deferred to M0b-2: SegmentedControl, SlidingIndicator, Switch, Checkbox, Select, DateField, NumberRoll, haptics, `controls` fixture. Deferred to route phases: AvailabilityCalendar's note popover (a positioned form, not a menu — M5), MonthGenerator's held swap block (M7b), Kids inline statuses (M8), "Agregar canción" (not a disclosure).

**Placeholders:** none; every step carries its code or its exact edit.

**Type consistency:** `DismissReason` = `"escape" | "backdrop" | "drag"` (T3, T4 consumers); `SHEET_DISMISS` (T3); `useToast().toast(opts)` / `ToastOptions` (T5, T6); `Menu` props `label/trigger/align/onOpenChange`, `MenuItem` props `onSelect/href/icon/danger/disabled` (T7, T8); `Collapse` props `open/id/className` (T9); `EASE_IN/EASE_OUT/EXIT_MS/MS/SPRINGS` from `motionPresets` (all).
