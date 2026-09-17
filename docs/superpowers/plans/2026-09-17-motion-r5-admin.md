# R5 — Control Room → flatten (`/admin`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin page stops being a box in a box in a box. The outer frame, the shell, the tab-bar box and the per-tab panel surfaces go; the page is the workspace and cards are the only boxes. Desktop gets a left rail (icons + labels, the active marker slides vertically) with the integrity state as a lit dot; the phone keeps an underline tab strip. Servicios becomes a horizontal snap board on desktop. The kill switch moves into a confirmed row menu (decision O). Every panel adopts the primitives (Button, Skeleton, NumberRoll, Menu, AnimatedList). The five non-default tabs and the month generator load on demand. Spec §12.5, §17 correction to Finding 4, Part I §5.8 (M7a), decisions J, N, O; the desktop `Select` popover deferred from Part VIII.

**Architecture:** `AdminPanel` keeps its one reducer and the `?tab=` contract (`adminTabs.ts` stays neutral, `adminTabUrl.test.tsx` stays green) but renders ONE tree: a rail/strip plus a keyed body that fades in on tab change. The integrity fetch is lifted out of `IntegrityQueuePanel` into a hook owned by `AdminPanel`, so the rail dot and the panel read one state. No admin file imports `motion` (`motionImportBoundary` pins `PlannerGrid` as forbidden; everything composes `Presence`/`Collapse`/`SlidingIndicator`/`AnimatedList`). **M7b is untouched:** `PlannerGrid`, `MonthGenerator`, `SetlistEditor` change only where a comment names the shell, plus the dynamic import boundary around `MonthGenerator`.

**Tech Stack:** Next.js 16 App Router (`next/dynamic`), React 19, Tailwind 3.4, `motion` under `ui/**` only, vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` §5.8 (line ~244), §12.5 (~477), §16 Finding 4 (~580), §17 (~599), §18/decision N (~604), §19.3 rows 655/676/677/680, decision J (759), decision O (736/764), Part VIII deferrals (~921). Part XV (R5) is written in Task 8.

**Survey facts the plan relies on (2026-09-16):** the TabBar already uses `SlidingIndicator` (M1); "Más acciones" is already a `Menu`; `ParticipationSidebar` already uses `SegmentedControl` + `NumberRoll`; the kill switch is already the `Checkbox` primitive (Finding 1's line is stale — only the confirm remains); `SongFormModal` is already inside `ContentPanel`'s `CueDialog` (§5.8's line is stale); `.brand-admin-shell` is `overflow: hidden` on BOTH axes and is named as a premise in three places — `brand.css:~953` (why full-bleed was rejected), `PlannerGrid.tsx:~2223` (why full-screen portals to `document.body`), `MonthGenerator.tsx:~2014` (the hand-centring that already mitigates Finding 4); `participationAlongside.test.tsx` pins the three `:has(.planner-wide)` CSS rules AND their comment text; `labelBudget.test.ts` pins `Backstage operations` and `Acceso autorizado` at 1 each (equality — lower to 0 in the same commit); `cueDialogMount.test.ts` baseline 10 (AdminPanel's and ServicesPanel's local `Modal`s are two of the sites); `rawMotionLiterals` baseline `transitionAll: 7` (AdminPanel member row and `ServiceReadinessCard` are two); nothing under `admin/**` is `next/dynamic` — every tab plus `MonthGenerator` (3.9k lines) and `PlannerGrid` (3.1k) is in `/admin`'s first load (358.6 kB gz); `inputFontSize.test.ts` excludes `admin/` by path.

## Global Constraints

- Gates in ONE `&&` chain with the commit (Node 22: `export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH`): `node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint .` (0 errors) then the commit. Every task runs the full suite. **No AI attribution / `Co-Authored-By` trailer.**
- `motion` only under `app/components/ui/**`. A Server Component never CALLS a client-module value (ADR-0028) — `app/(client)/admin/page.tsx` keeps calling only `resolveAdminTab` from the neutral `adminTabs.ts`.
- Only `transform`/`opacity` animate; durations from tokens; no new raw `duration-N`/`transition-all` (baseline ratchets DOWN in the tasks that retire sites, never up). Reduced motion needs no new query.
- `Button` for every button, `Skeleton` for every placeholder, `Menu` for every anchored dropdown, `CueDialog` with `open={x}` for every dialog (baseline ratchets down), `Presence`/`AnimatedList` for animated conditionals/lists, `NumberRoll` for values that change in place, `SegmentedControl` for one-of-N, `Select`/`DateField`/`Checkbox` for native controls. 44 px targets on phone; admin inputs get `text-[16px] sm:text-…` even though the guard excludes `admin/`.
- **ADR-0012 holds:** no auto-scroll during a planner drag; `plannerGridDrag.test.tsx` hooks untouched. The planner full-screen portal stays (correct regardless of the shell).
- **No page-level horizontal scroll** at 390 px or 1440 px: the planner grid, the Servicios board and the availability matrix are the only horizontal scrollers, each in its own `overflow-x-auto` box. Verified with dev-verify (`document.documentElement.scrollWidth <= clientWidth` is what the reviewer checks by reasoning; the coordinator checks it on dev).
- Ministry/role gating unchanged: `visibleAdminTabs(role)` still decides the rail's items; the members tab stays super-admin-only.
- Docs current in the same task; conventional commits with a body that says why.

## Rulings

1. **The shell goes, the frame stays as a hook.** `.brand-admin-shell` (and its `::before`, its `:has(.planner-wide)` padding rule) is deleted; the `brand-admin-frame` div stays because `:has(.planner-wide)` widening hangs on it. The `brand.css` comment that rejected full-bleed "because the shell is overflow: hidden" is rewritten; `participationAlongside.test.tsx`'s pinned strings move with it in the same commit. `PlannerGrid`'s portal comment and `MonthGenerator`'s hand-centring comment are re-worded to name `[data-route-main]` as the nearest clipping/scrolling ancestor; the code stays. An ADR (0035) records why the shell is gone and why explicit scrollers are the rule. Cost if wrong: a Safari full-screen clip we already guard against by portalling.
2. **Tab change = the incoming body fades in (`animate-fade-in`, keyed remount)**, no outgoing panel kept absolutely positioned (§5.8's wording): the panels are thousands of lines and only the active one is mounted today; doubling the DOM for 200 ms buys nothing a member notices. Same ruling as R4's chart crossfade.
3. **Rail on desktop (`lg:`), underline strip below.** The rail is 200 px, icon + label per tab, `SlidingIndicator variant="pill"` behind the active item (it slides vertically because the items stack); when `.planner-wide` is present the rail collapses to icons only (56 px) so the ≥1280 arithmetic in the planner comment still holds with the new number (the implementer re-derives and re-pins it). Below `lg` the strip is today's TabBar minus its bordered box: underline indicator, scrolls horizontally, active scrolls into view.
4. **Integrity dot = the queue's tone, lifted.** `useIntegrityQueue()` (new, in `admin/useIntegrityQueue.ts`, client) owns the three fetches `IntegrityQueuePanel` does today and returns `{ queue, tone, reload, resolve }`; `AdminPanel` calls it once, passes `queue` to the panel and `tone` to the rail. The rail's Servicios item carries a dot: none when clean, a dim `?` when unknown, the count when there are issues (three states, never two — `unknown` must not read clean). The panel's `Collapse` starts closed when the tone is clean ("expands only when it has something to say") and open otherwise.
5. **Servicios board on desktop only (`lg:`):** `flex snap-x snap-mandatory overflow-x-auto gap-4` with `snap-start shrink-0 w-[380px]` cards, scroll-padding so a card lands flush; the phone keeps the vertical list. The `ParticipationSidebar` split stays. Cards reveal with `revealProps(i)` (capped stagger; legal in a client module).
6. **One `Menu` per member row (decision O widened):** «Acciones» (`Button variant="icon"`, ⋯) opens Editar · Contraseña · Deshabilitar acceso / Habilitar acceso (super-admin only, `danger`) · Eliminar (`danger`). Deshabilitar opens a confirm `CueDialog` («¿Deshabilitar el acceso de {alias}?», body: what it does — the member can no longer sign in, nothing else changes — `Button variant="danger"` «Deshabilitar» / «Cancelar»); the same `PATCH …/disable` write. The hover-action buttons and the kill-switch `Checkbox` sub-block go. Touch gets the same menu; nothing depends on hover.
7. **Load on demand:** `next/dynamic` (with `{ ssr: false, loading: () => <PanelSkeleton /> }`) for `ProposalsPanel`, `AvailabilityPanel`, `ActivityPanel`, `ContentPanel`, the members body (extracted to `MembersPanel.tsx` — it lives inline in `AdminPanel` today), and for `MonthGenerator` inside `ServicesPanel` (it mounts only when «Generar mes» opens). `ServicesPanel` stays static (the default tab). `IntegrityQueuePanel` stays static (its data feeds the rail).
8. **Desktop `Select` popover (Part VIII deferral, assigned to the Control Room):** `ui/Select` keeps the native `<select>` as the control on coarse pointers; on `(hover: hover) and (pointer: fine)` the trigger opens a `Menu` of the options (roving focus, Enter/Space selects, first-letter jump), the native element stays in the DOM `sr-only` for forms/labels. Consumers unchanged. Behind a `popover` prop defaulting to true so any consumer that misbehaves can opt out.
9. **`NavLinks` flags unified (Part IX deferral):** Calendario and Biblioteca show for every worship member on every page; `Navbar`'s `tags`/`schedule` props are removed from every call site (they were passed inconsistently — the row changed shape on `/kids`). Kids-only members keep their kids links; nothing else about `NavLinks` changes.
10. **M7b stays out** except comments (ruling 1) and the dynamic-import boundary (ruling 7). `SetlistEditor`'s two `transition-all` and its three literal `open`s stay for M7b; the baselines are lowered only by the sites R5 retires.
11. **Label budget:** `Backstage operations` and `Acceso autorizado` → 0 (decision N). The page keeps `h1 Control Room` alone (the navbar title already says it on phones); the subtitle goes.
12. **Deferred, on purpose:** a `control-room` theme-gallery fixture (the flatten is verified on dev with shots; R6 owns the gallery); `AvailabilityPanel` date-chip `Menu` (edit/clear) — the panel is read-only today; planner-cell motion (M7b).

---

### Task 1: Flatten — page, shell CSS, one AdminPanel tree, labels, NavLinks flags, ADR

**Files:**
- Modify: `app/(client)/admin/page.tsx`, `app/components/admin/AdminPanel.tsx` (the six early returns → one tree; `TabBar` rendered once; body keyed by tab with `animate-fade-in`; per-tab `brand-surface` wrappers removed), `app/brand.css` (delete `.brand-admin-shell`, its `::before`, `.brand-admin-tabs`; rewrite the planner-wide comment and drop the shell padding rule; keep `[data-route-main]:has(.planner-wide)` and `.brand-admin-frame:has(.planner-wide)`), `app/components/admin/__tests__/participationAlongside.test.tsx` (re-pin the CSS strings + comment), `app/utils/__tests__/labelBudget.test.ts` (`"Backstage operations": 0, "Acceso autorizado": 0`), `app/components/admin/MonthGenerator.tsx` (comment only, ~2014-2040), `app/components/admin/PlannerGrid.tsx` (comment only, ~2223-2233), `app/components/Navbar.tsx` + `app/components/NavLinks.tsx` (drop `tags`/`schedule`), every `<Navbar … tags schedule>` call site (home, schedule, posts, biblioteca, me ×4, admin — remove the two props), `docs/adr/0037-the-admin-shell-is-gone.md`, `docs/adr/README.md` index, `docs/MOTION.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `docs/ROUTES.md`
- Test: `app/components/admin/__tests__/adminShell.test.tsx` (new)

**Interfaces:**
- `page.tsx` renders `<Navbar title="Control Room" />` then `<div className="brand-admin-frame mx-auto max-w-7xl px-6 pb-20 pt-8"><h1 className="font-display text-3xl font-semibold text-ink md:text-4xl">Control Room</h1><AdminPanel role initialTab tabNamedInUrl /></div>` — no eyebrow, no subtitle, no status pill, no shell div.
- `AdminPanel` renders `<div className="mt-6 lg:grid lg:grid-cols-[200px_1fr] lg:gap-8"> <TabBar … /> <div key={tab} className="brand-admin-workspace min-w-0 animate-fade-in"> {body} </div> </div>` — Task 2 turns `TabBar` into the rail/strip; in this task it is today's `TabBar` without the `.brand-admin-tabs` box (plain `flex gap-1` with the underline `SlidingIndicator`).
- `NavLinks({})` — no props; `inWorship` alone gates Calendario/Biblioteca.
- `brand.css`: the `:has(.planner-wide)` rules keep `[data-route-main]` and `.brand-admin-frame` (with `padding-inline: 0.75rem`); the new comment states the arithmetic without the shell (`216 + 982 + 240 = 1438` at ≥1280 — the implementer measures the real numbers from the existing comment and re-derives).

- [ ] **Step 1: Failing tests.** `adminShell.test.tsx` (jsdom): rendering the page's markup (`AdminPanel` with a mocked session/role) yields exactly ONE `[role="tablist"]`-or-TabBar and no element with class `brand-admin-shell`/`brand-admin-tabs`/`brand-surface` between the tab bar and the panel; `labelBudget` expects 0/0; `participationAlongside` pins the rewritten comment; a `brandCss` scan test (or the same file) asserts `.brand-admin-shell` no longer exists in `brand.css`. NavLinks test (find the existing one — `navLinks*.test.tsx`): Calendario/Biblioteca render for a worship member with no props.
- [ ] **Step 2: Run, watch them fail. Step 3: Implement.** Keep `?tab=` behaviour byte-identical (`adminTabUrl.test.tsx`). Write ADR-0037 (bar: "looks arbitrary later" — why the shell is gone, why explicit scrollers only, why the portal/hand-centring stay). Update MOTION.md (a "Control Room (R5)" section opens here), UTILITIES (AdminPanel row), ROUTES (`/admin` row).
- [ ] **Step 4: Gates; commit** — `feat(admin): the Control Room is the page — shell, frame chrome and panel boxes removed`

---

### Task 2: Rail + strip, integrity dot lifted

**Files:**
- Create: `app/components/admin/AdminRail.tsx`, `app/components/admin/useIntegrityQueue.ts`, `app/components/admin/__tests__/adminRail.test.tsx`, `app/components/admin/__tests__/useIntegrityQueue.test.tsx`
- Modify: `app/components/admin/AdminPanel.tsx` (replace `TabBar`/`TabItem` with `AdminRail`; call `useIntegrityQueue()` once; pass `queue`/`reload`/`resolve` to `IntegrityQueuePanel` and `tone` to the rail), `app/components/admin/IntegrityQueuePanel.tsx` (props in, no own fetch; `Collapse` default open = tone !== "clean"), `app/components/admin/__tests__/serviceIntegrityQueue.test.ts` + any panel test that mocked its fetches (move the mocks to the hook), `app/brand.css` (`.brand-admin-frame:has(.planner-wide) .brand-admin-rail { width: 56px }` + label hiding), `participationAlongside.test.tsx` (if the rail width enters the pinned arithmetic), docs rows

**Interfaces:**
```tsx
// AdminRail (client)
export default function AdminRail({ tabs, active, onChange, integrityTone }: {
  tabs: ReadonlyArray<{ id: AdminTab; label: string; icon: React.ReactNode }>;
  active: AdminTab; onChange: (id: AdminTab) => void;
  integrityTone: "clean" | "unknown" | "issues"; integrityCount?: number;
}): JSX.Element;
// ≥ lg: <nav aria-label="Secciones" className="brand-admin-rail sticky top-[calc(6rem+env(safe-area-inset-top))] flex flex-col gap-1"> one Button-like <button aria-current="page"> per tab with an icon (inline SVG, 20 px) + label; the active one hosts <SlidingIndicator id="admin-rail" variant="pill" />; the Servicios item carries <span data-integrity={tone}> — nothing when clean, «?» dim when unknown, the count in `negative-fg` when issues.
// < lg: the underline strip (today's TabBar body): overflow-x-auto, useActiveIntoView, SlidingIndicator variant="underline", the same dot after the label.
// One component, two layouts via `hidden lg:flex` / `lg:hidden` — the SlidingIndicator id differs per layout so the projection never jumps between them.

// useIntegrityQueue (client hook) — the three fetches + derivation that live in IntegrityQueuePanel today, verbatim, plus:
export function useIntegrityQueue(): { queue: IntegrityQueue; tone: "clean" | "unknown" | "issues"; reload: () => void; resolve: (outcome: ResolveOutcome) => void; loading: boolean };
```

- [ ] **Step 1: Failing tests.** `adminRail.test.tsx`: renders one item per tab with `aria-current` on the active; clicking calls `onChange`; the Servicios dot is absent when clean, «?» when unknown, «3» when issues (assert `data-integrity`). `useIntegrityQueue.test.tsx`: derives the same `queue`/`tone` the panel's tests expect (port the panel's fetch mocks). `IntegrityQueuePanel` tests: rendering with `queue` prop; collapsed when clean, open otherwise. `adminTabUrl.test.tsx` unchanged and green.
- [ ] **Step 2–4:** implement; docs; gates; commit — `feat(admin): a left rail on desktop with the integrity state as a lit dot`

---

### Task 3: Members — row menu, confirmed kill switch, primitives

**Files:**
- Create: `app/components/admin/MembersPanel.tsx` (the members body extracted from `AdminPanel.tsx` — controls, list, modals; `AdminPanel` renders `<MembersPanel role … />`), `app/components/admin/__tests__/membersPanelMenu.test.tsx`
- Modify: `app/components/admin/AdminPanel.tsx`, `app/components/admin/__tests__/memberListMinistryScope.test.tsx` + `MemberForm.test.tsx` (imports), `app/utils/__tests__/cueDialogMount.test.ts` (10 → 9: the local `Modal` becomes `open={x}`), `app/utils/__tests__/rawMotionLiterals.test.ts` (`transitionAll` 7 → 6), docs rows

**Interfaces:** ruling 6. `MemberRow` gets `<Menu label="Acciones de {alias}" trigger={<Button variant="icon" size="lg" aria-label=…>⋯</Button>} align="end">` with `MenuItem`s: Editar (`onSelect` → edit modal), Contraseña, then for super-admin `MenuSeparator` + (disabled ? «Habilitar acceso» : «Deshabilitar acceso») `danger`, Eliminar `danger`. Confirm dialog: `<CueDialog open={confirmDisable !== null} title="Deshabilitar acceso" mode="modal" size="sm">` body per ruling 6; on confirm → the existing `handleDisableAccess(member, true)`; «Habilitar» needs no confirm. The `Sin acceso` chip stays. The row's `transition-all` → `transition-[background-color,box-shadow] duration-base ease-out-brand`. Loading → `<Skeleton>` rows ×6. The delete modal's two raw buttons → `Button variant="danger"` / `variant="ghost"`. Search input → `text-[16px] sm:text-sm`.

- [ ] **Step 1: Failing tests.** `membersPanelMenu.test.tsx`: opening a row's menu lists Editar/Contraseña (member role) and additionally Deshabilitar/Eliminar for super-admin; choosing Deshabilitar opens the confirm; confirming PATCHes `/api/admin/members/:id/disable` with `{ disabled: true }` once; cancelling PATCHes nothing; no `Checkbox` with the kill-switch label remains; no hover-only action buttons.
- [ ] **Step 2–4:** implement; docs; gates; commit — `feat(admin): member rows get one menu; the kill switch asks first`

---

### Task 4: Servicios — snap board, primitives, reveal

**Files:**
- Modify: `app/components/admin/ServicesPanel.tsx` (board classes at the cards grid ~1249; month pills → `Button variant="pill" size="sm" aria-pressed` keeping multi-select; «Roles previos» trigger → `Button variant="ghost"`; toolbar + three retries + banners' raw buttons → `Button`; loading → `Skeleton`; local `Modal` → `open={x}`; cards `{...revealProps(i)}`), `app/components/admin/ServicePrimaryAction.tsx` (→ `Button variant="primary" size="md" aria-busy` keeping `data-action-kind/-rule/-route` and `CARD_STYLE.primaryAction`), `app/components/admin/ServiceReadinessCard.tsx` (`transition-all` → tokenised list), `app/utils/__tests__/cueDialogMount.test.ts` (9 → 8), `rawMotionLiterals.test.ts` (6 → 5), `app/components/admin/__tests__/ServiceReadinessCard.test.tsx` + `serviceCardModel.test.ts` (data attrs still asserted), `servicesPanelInFlight.test.ts` (Buttons still `disabled` while submitting), docs rows

**Interfaces:** the cards container becomes `<div className="grid min-w-0 grid-cols-1 gap-4 lg:flex lg:snap-x lg:snap-mandatory lg:overflow-x-auto lg:scroll-px-6 lg:pb-4"> … <article className="… lg:w-[380px] lg:shrink-0 lg:snap-start">`. A `lg:` scroll-fade at the board's right edge (the strip's gradient pattern). Keyboard: the board is a normal scroll container (arrow keys after focus).

- [ ] **Step 1: Failing tests.** `servicesBoard.test.tsx` (new): the cards container carries the snap classes and each card `snap-start`; month pills expose `aria-pressed` and stay multi-select (pressing two keeps both); `ServicePrimaryAction` renders a `Button` with the three data attributes; loading renders `Skeleton`s.
- [ ] **Step 2–4:** implement; docs; gates; commit — `feat(admin): Servicios is a snap board on desktop; every control is a primitive`

---

### Task 5: Actividad · Disponibilidad · Contenido · Propuestas · Integridad polish

**Files:**
- Modify: `ActivityPanel.tsx` (stats → `NumberRoll`; loading → `Skeleton`; error → `Button` retry), `AvailabilityPanel.tsx` (loading → `Skeleton`; sticky first column gets `data-scrolled` from an IntersectionObserver sentinel at the table's left edge → `shadow-[8px_0_12px_-8px_rgb(var(--elevation-rgb)/0.35)]` via a class toggle, opacity-only transition), `ContentPanel.tsx` (row actions `opacity-100 sm:opacity-0 sm:group-hover:opacity-100`, sized `size="sm"` on touch; loading → `Skeleton`; its two literal-`open` `CueDialog`s → `open={x}`: baseline 8 → 6), `ProposalsPanel.tsx` (loading → `Skeleton`), `IntegrityQueuePanel.tsx` (entries → `AnimatedList` so a resolved entry exits), tests: `activityPanelFailure`, `availabilityPanelFailure`, `songFormRowIdentity`, `proposalsPanel*` still green + one new case each for the Skeleton and the `AnimatedList` exit; docs rows

- [ ] **Step 1: Failing tests** (per panel, one or two cases). **Step 2–4:** implement; docs; gates; commit — `feat(admin): the remaining panels adopt Skeleton, NumberRoll, AnimatedList and touch-visible actions`

---

### Task 6: Load on demand

**Files:**
- Create: `app/components/admin/PanelSkeleton.tsx`, `app/components/admin/__tests__/adminDynamic.test.ts` (source scan: the five panels + `MonthGenerator` are imported through `next/dynamic` and nothing else imports them statically under `app/**` except their tests)
- Modify: `app/components/admin/AdminPanel.tsx` (`const ProposalsPanel = dynamic(() => import("./ProposalsPanel"), { ssr: false, loading: PanelSkeleton })` ×5), `app/components/admin/ServicesPanel.tsx` (`MonthGenerator` dynamic), `docs/MOTION.md` bundle section (method note: the async chunks are now real and measurable per tab)

- [ ] **Step 1: Failing test** (the source scan). **Step 2–3:** implement; the coordinator measures `/admin` before/after (expect a large drop). **Step 4: Gates; commit** — `perf(admin): the five secondary tabs and the month generator load on demand`

---

### Task 7: Desktop `Select` popover (ui primitive)

**Files:**
- Modify: `app/components/ui/Select.tsx`, `app/components/ui/__tests__/Select.test.tsx`, `docs/MOTION.md` (`Select` row), `docs/UTILITIES_AND_COMPONENTS.md`
- Create: `app/components/ui/__tests__/selectPopover.test.tsx`

**Interfaces:** ruling 8. `Select` gains `popover?: boolean` (default `true`). Detection: `window.matchMedia("(hover: hover) and (pointer: fine)")` read once on mount (state; SSR renders native). Fine-pointer render: the native `<select>` stays mounted but `sr-only` (still labelled, still the form value, still receives `onChange`); a `Button variant="secondary"`-styled trigger shows the selected label + chevron and opens `Menu` (`align="start"`) whose items mirror the `<option>`s (children are parsed: `React.Children` over `option` elements — value/label/disabled), selecting calls `onChange` with a synthetic event shape the consumers already handle (they read `e.target.value` — build `{ target: { value } }` typed as the consumer expects; check the four consumers' handlers). First-letter jump: `Menu`'s roving focus + a keydown that moves focus to the next item whose label starts with the key. Coarse pointer: unchanged native path.

- [ ] **Step 1: Failing tests.** `selectPopover.test.tsx`: with `matchMedia` mocked fine-pointer, the trigger opens a menu with one item per option, choosing one fires `onChange` with the value and closes; with coarse pointer no menu renders; `popover={false}` forces native; the native select stays in the DOM and labelled. Existing `Select.test.tsx` green (it exercises the native path — mock coarse).
- [ ] **Step 2–4:** implement; docs; gates; commit — `feat(ui): Select opens a house popover on desktop; the native picker stays on touch`

---

### Task 8: Docs, spec Part XV, bundle, shots

**Files:** `docs/MOTION.md` ("Control Room (R5)" section final pass + bundle rows), `docs/UTILITIES_AND_COMPONENTS.md` (admin rows: `AdminRail`, `MembersPanel`, `useIntegrityQueue`, `PanelSkeleton`; stale `ParticipationSidebar` "select" wording), `docs/ROUTES.md`, `CLAUDE.md` + `AGENTS.md` reusable utils (`AdminRail`, `useIntegrityQueue` — "the ONLY integrity fetch; the panel and the rail read it", `PanelSkeleton`, `Select` popover note) byte-identical, spec Part XV (Part XIII/XIV shape: header, shipped, rulings with reasons, review trail, open notes for Frank, bundle, release placeholders), shots `admin-before-1440.png` / `admin-after-1440.png` (services), `admin-before-phone.png` / `admin-after-phone.png`, `r5-admin-members-menu.png`, `r5-admin-rail-planner-wide.png` under the shots folder (coordinator supplies).

- [ ] **Step 1–2:** write; gates; commit — `docs(motion): R5 Control Room — Part XV, MOTION.md, utilities`

---

## Self-review

- **Spec coverage.** §12.5: no outer frame (T1), rail + phone strip (T2), snap board (T4), integrity dot in the rail (T2), planner/generator unchanged (ruling 10). §17 Finding 4 (T1 + constraint). §5.8: status dot → removed by decision N (T1); TabBar crossfade → ruling 2 (T1); members search/filter + row press + modals (T3); ServicesPanel pills/Collapse/Skeleton/Button/reveal/NumberRoll (T4; NumberRoll already there); ReadinessCard transitions + Menu + Button (T4); MonthGenerator/PlannerGrid/SetlistEditor → M7b (ruling 10); SongFormModal → already done; Activity/Integrity Collapse + Presence exit (T5); AvailabilityPanel shadow edge (T5); ContentPanel touch actions (T5). Decision O (T3). Decision N labels (T1). Part VIII deferrals: desktop Select popover (T7), kill-switch confirm (T3), month pills stay multi-select (T4), Part IX NavLinks flags (T1). Bundle (T6).
- **Placeholders.** None: every task names files, interfaces, tests and the commit.
- **Type consistency.** `AdminTab` from `adminTabs.ts`; `IntegrityQueue`/tone strings shared by `useIntegrityQueue`, `AdminRail` and `IntegrityQueuePanel`; `PanelSkeleton` used by T6's `loading`.
