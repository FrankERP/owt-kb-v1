# R7 — App-wide conveniences — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four §12.8 app-wide pieces that every remake deferred: the navbar **cue strip** (next service countdown under the title on every route but home and Mi semana), the **blackout** on sign-out, phone **pull-to-refresh**, and **long-press quick actions** on song rows and service rows. (§12.8's fifth item, the eyebrow removal, shipped in R1.)

**Architecture:** Four independent client pieces under `app/components/ui/**` plus one API route. Nothing here changes a writer, a schema or the save contracts. The cue strip is fetched client-side (like the notification badge) so `Navbar` stays a plain, statically renderable component. The pull-to-refresh indicator is a separate `fixed` element — the page content is never translated, so no ancestor becomes a containing block (the trap ADR-0031 / `CueDialog.tsx` document). Long-press is a hook on the row plus one shared sheet (`CueDialog mode="sheet"`).

**Tech Stack:** Next.js 16 App Router, React 19, `motion` (only under `app/components/ui/**`), Tailwind, vitest + RTL, `haptic()`.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` §12.8 (cue strip, blackout, pull-to-refresh, long-press), decision L, §14 row "R7 App-wide", and the Part IX–XII deferral notes. Part XIII (R7) is written in Task 5.

## Global Constraints

- Gates in ONE `&&` chain with the commit (Node 22: `export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH`): `node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint .` (0 errors) then the commit. Every task runs the full suite. **No AI attribution / `Co-Authored-By` trailer on any commit** (grep before every push).
- `motion` is importable only under `app/components/ui/**` (`motionImportBoundary` guard). A Server Component never CALLS a client-module value (ADR-0028; `clientBoundary.test.ts`).
- **No transformed wrapper around `<main>` or the page** — `reveal.test.ts` guards `template.tsx`; the pull indicator is a sibling `fixed` element, never a translate on the content.
- Every new `fixed` element that sits at the bottom joins `bottomNavOffsetSync.test.ts`; top-anchored ones (the pull rail, the blackout overlay) do not.
- Ministry isolation: the cue strip shows a WORSHIP service only to worship members (`published != false`) and the next KIDS Sunday (`published == true`) to kids-only members; a member of both sees the earlier of the two. Reads use `operationalClient`; the route gates with `requireActiveSession` + `getMemberAccess` (see `app/(client)/me/page.tsx` for the ministry resolution).
- Timezone: CDMX `today` (`toLocaleDateString("sv", { timeZone: "America/Mexico_City" })`), labels via `daysUntil`/`formatCountdown` (the ONLY countdown), dates at local noon.
- `Button` for every button (`CueDialog` sheets included); `Presence` for animated conditionals; Spanish UI; reduced motion collapses everything (`MotionConfig reducedMotion="user"` + the `brand.css` rule) — no new `@media` query of our own except where the spec below says so.
- Docs current in the same task; conventional commits.

---

### Task 1: Cue strip — `GET /api/cue` + `CueStrip` in the navbar

**Files:**
- Create: `app/api/cue/route.ts`, `app/api/__tests__/cueRoute.test.ts`, `app/components/ui/CueStrip.tsx`, `app/components/ui/__tests__/cueStrip.test.tsx`, `app/utils/cue.ts`, `app/utils/__tests__/cue.test.ts`
- Modify: `app/components/Navbar.tsx`, `app/(client)/page.tsx` (`<Navbar … cue={false} />`), `app/(client)/me/page.tsx` (`cue={false}`), `app/utils/__tests__/draftGatingCoverage.test.ts` (only if the guard needs the new route registered — read it first), `docs/ROUTES.md` (API table row)

**Interfaces:**
- `app/utils/cue.ts` (neutral): `export interface Cue { dateKey: string; kind: "worship" | "kids"; day: "Sábado" | "Domingo" | string }`; `export function cueLabel(cue: Cue, today: string): string` → `"DOM 13 · EN 5 DÍAS"` — the day abbreviation from the date (`SÁB`/`DOM`/`VIE`… via `toLocaleDateString("es-MX",{weekday:"short"})` upper-cased, 3 letters, no trailing dot) + `· ` + `formatCountdown(daysUntil(dateKey))` upper-cased; a special (weekday) service uses its weekday abbreviation the same way. `export function pickCue(worshipNext: string | null, kidsNext: string | null): Cue | null` → the earlier date wins; ties → worship.
- `GET /api/cue` → `{ cue: Cue | null }`; 401 when no session (the client treats non-ok as "no strip"). Worship next date = the min of `sunday_role.week`, `saturday_role.week`, `special_role.date` `>= $today && published != false` (one GROQ, like `SERVICE_DATES_QUERY` but `| order(...)[0]` per type or a `math::min`-free approach: fetch the three `[0]`s and take the min in JS). Kids next = `kidsSchedule` `published == true && date >= $today | order(date asc)[0].date`. Ministry gating per the constraint above. `Cache-Control: private, max-age=60`.
- `CueStrip` (client): fetches `/api/cue` once per mount with a 60 s `sessionStorage` cache (`owt_cue`, same shape as `NavMenu`'s `useNotifCount`), renders `<p className="font-label text-[10px] lg:text-[11px] uppercase tracking-[0.22em] text-ink-dim">` inside `Presence show={!!label} variant="fade"` (no `appear` — it is above the fold), `aria-live="off"`; hides when `usePathname()` is `/` or `/me` (both already carry the countdown). Props: none. Uses `useSession` only to skip the fetch when unauthenticated.
- `Navbar` gains `cue?: boolean` (default `true`) and renders `<CueStrip />` under the title block on phones (inside the `lg:hidden` column) AND under `NavLinks` on desktop (a second line in the centred column, `hidden lg:block`). `Navbar` stays a plain sync component (its header comment says why; keep it true).

- [ ] **Step 1: Failing tests** — `cue.test.ts`: `cueLabel({dateKey:"2026-09-13",kind:"worship"}, "2026-09-08")` → `"DOM 13 · EN 5 DÍAS"`; today → `"DOM 13 · HOY"`; a Saturday → `"SÁB 12 · MAÑANA"` (check `formatCountdown`'s exact strings first and use them verbatim); `pickCue` earlier-wins and tie → worship. `cueRoute.test.ts` (mock `requireActiveSession`, `getMemberAccess`, `operationalClient.fetch`): 401 unauthenticated; worship-only member never queries `kidsSchedule` (assert the GROQ strings called); kids-only never queries the worship types; both → `pickCue`; every worship GROQ carries `published != false`, the kids one `published == true`. `cueStrip.test.tsx`: renders the label from a mocked fetch; renders nothing on `/` and `/me`; a non-ok response renders nothing; the sessionStorage cache short-circuits the fetch.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.** Check `draftGatingCoverage.test.ts` and `protectedReadAudit.ts` (service-readiness) — a new API read may need registering; do what those guards require and say so in the report.
- [ ] **Step 4: Gates; commit** — `feat(shell): the navbar carries the next service as a cue strip`

---

### Task 2: Blackout on sign-out

**Files:**
- Create: `app/components/ui/Blackout.tsx`, `app/components/ui/__tests__/blackout.test.tsx`
- Modify: `app/components/NavMenu.tsx`, `app/components/SignOutButton.tsx`, `app/(client)/auth/not-a-member/page.tsx`, `app/components/__tests__/navMenu.test.tsx` (sign-out case, if any), `app/utils/themePref.ts` comment if it names the call order

**Interfaces:**
- `export async function blackout(): Promise<void>` (client module): appends a `div` (`position: fixed; inset: 0; z-index: 100; background: rgb(var(--surface-base-rgb)); opacity: 0; pointer-events: none; transition: opacity var(--motion-slow) var(--ease-in)`) to `document.body`, forces a frame, sets `opacity: 1`, resolves on `transitionend` or after 400 ms (whichever first); under `prefers-reduced-motion: reduce` it sets opacity 1 and resolves immediately. Idempotent: a second call while one is live returns the same promise. The overlay is never removed — the redirect replaces the document; if `signOut` throws, the caller removes it via the returned handle: make the export `blackout(): { done: Promise<void>; cancel(): void }`.
- Call order everywhere: `clearThemeMirror(); const b = blackout(); await b.done; signOut({ callbackUrl: "/auth/signin" })` — with a `try { … } catch { b.cancel(); }` so a failed `signOut` never leaves a black page.

- [ ] **Step 1: Failing tests** — `blackout.test.tsx` (jsdom, fake timers): appends one overlay with `opacity: 0` then `1`; resolves after the fallback timer; second call returns the same handle; `cancel()` removes it; reduced-motion (mock `matchMedia`) resolves synchronously-ish (no timer). NavMenu test: «Cerrar sesión» calls `blackout` before `signOut` (mock both; assert order).
- [ ] **Step 2: Run, watch them fail.** **Step 3: Implement.** **Step 4: Gates; commit** — `feat(shell): the page blacks out before sign-out`

---

### Task 3: Pull-to-refresh (phone)

**Files:**
- Create: `app/components/ui/PullToRefresh.tsx`, `app/components/ui/pullModel.ts`, `app/components/ui/__tests__/pullModel.test.ts`, `app/components/ui/__tests__/pullToRefresh.test.tsx`
- Modify: `app/(client)/layout.tsx` (mount `<PullToRefresh />` as a SIBLING before `<main>`, never a wrapper), `app/brand.css` (`html.has-bottom-nav body { overscroll-behavior-y: contain; }` so Chrome Android's native pull does not double up), `app/utils/__tests__/reveal.test.ts` (only to confirm `template.tsx` is untouched — no change expected)

**Interfaces:**
- `pullModel.ts` (neutral): `THRESHOLD = 72`, `MAX = 120`; `pullProgress(dy: number): number` (0…1, `min(dy, MAX) / THRESHOLD` clamped to 1); `shouldRefresh(dy: number): boolean` (`dy >= THRESHOLD`); `railHeight(dy: number): number` (`min(dy, MAX) * 0.5`, the rail grows at half the finger's travel — "resistance").
- `PullToRefresh` (client): active only when `document.documentElement.classList.contains("has-bottom-nav")` (the phone tab bar's published class — the same signal the bar uses) AND `matchMedia("(pointer: coarse)")`. Listens on `window`: `touchstart` records `startY` only when `window.scrollY === 0`; `touchmove` (registered with `{ passive: false }`) computes `dy = clientY − startY`; when `dy > 8 && window.scrollY === 0` it calls `preventDefault()` and sets the rail's height/opacity from the model; `touchend`: if `shouldRefresh(dy)` → `haptic("medium")`, `setRefreshing(true)`, `startTransition(() => router.refresh())`; the rail shows the lit beam sweep while `isPending`, then collapses; otherwise the rail collapses (`transition: height var(--motion-base) var(--ease-out)`). The rail: `fixed left-0 right-0` at `top: calc(env(safe-area-inset-top) + var(--navbar-h, 5rem))`? — NO: read how the navbar publishes its height; if it does not, anchor the rail at `top-0` under the safe-area inset and keep it 2–4 px tall so it reads as a light bar at the very top; `z-[60]`, `pointer-events-none`, `bg-accent` with the `.brand-lit-card`-style beam while refreshing (reuse the `--lit-beam` token; read `app/brand.css` for `.brand-lit-card`). `aria-hidden`. Reduced motion: no beam, a plain bar.
- Never translates `<main>`; never active while a `CueDialog` is open (`document.documentElement` carries a class or the dialog root has `[data-open]` — read `CueDialogProvider.tsx`/`CueDialogStatus.tsx` for the published signal and use it; say which in the report).

- [ ] **Step 1: Failing tests** — `pullModel.test.ts` (all three functions, edges 0/8/72/120/300). `pullToRefresh.test.tsx` (jsdom; stub `matchMedia` coarse, set the `has-bottom-nav` class, mock `next/navigation` `useRouter().refresh`, mock `haptic`): a `touchstart` at `scrollY 0` + `touchmove` +80 → rail height > 0 and `preventDefault` called; `touchend` → `refresh` called once and `haptic("medium")`; +40 → no refresh; `scrollY 50` → inert; without the class → no listeners (assert `addEventListener` not called for `touchmove`).
- [ ] **Step 2: Run, watch them fail.** **Step 3: Implement.** **Step 4: Gates; commit** — `feat(shell): pull to refresh on the phone`

---

### Task 4: Long-press quick actions

**Files:**
- Create: `app/components/ui/useLongPress.ts`, `app/components/ui/__tests__/useLongPress.test.tsx`, `app/components/ui/QuickActions.tsx`, `app/components/ui/__tests__/quickActions.test.tsx`
- Modify: `app/components/LibraryRow.tsx`, `app/components/DayCardDisclosure.tsx`, `app/components/DayCard.tsx` (only the setlist song rows if the plan below says so — read `DayCard.tsx` first: its setlist rows are `SongRow`-like buttons; give them the same song actions), their tests (`libraryRow` / `dayCardDisclosure` — find the existing files), `docs/UTILITIES_AND_COMPONENTS.md`

**Interfaces:**
- `useLongPress(onLongPress: () => void, opts?: { ms?: number; move?: number })` → `{ onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu, style }` to spread on the row. `ms = 450`, `move = 8` px. A timer starts on a primary `pointerdown`; cancelled by up/cancel/leave, by a move beyond `move` px, or by a `scroll` event on `window` (touch scroll must never fire it). When it fires: `haptic("medium")`, `onLongPress()`, and the NEXT `click` on the element is swallowed once (a `suppressClickRef`, cleared on the following `pointerdown`) so the row does not also open. `onContextMenu`: `preventDefault()` and, for a MOUSE (`e.button === 2` / `pointerType === "mouse"`), fire `onLongPress()` — desktop right-click opens the same sheet. `style` = `{ WebkitTouchCallout: "none", userSelect: "none", WebkitUserSelect: "none" }`.
- `QuickActions` (client): `<QuickActions open={x} onClose title subtitle? actions={[{ label, onSelect, href?, tone?: "default" | "danger", icon? }]} />` → `CueDialog mode="sheet"` whose body is a `Button variant="ghost" size="lg"` per action, full width, left-aligned, plus a «Cancelar» ghost at the end. Must render `<CueDialog open={open}>` directly (the `cueDialogMount` guard).
- Consumers:
  - `LibraryRow`: long-press → actions «Abrir» (opens the sheet as the tap does), «Practicar» (calls the player's existing practice entry — read `usePlayer()`/`PlayerContext` for the right call; if none exists, drop this action), «Copiar enlace» (`navigator.clipboard.writeText(location.origin + "/posts/" + slug)` → `toast({ message: "Enlace copiado" })`). Title = song title, subtitle = author.
  - `DayCardDisclosure` (the collapsed service row on `/` and `/me`): long-press → «Ver en calendario» (`router.push("/schedule")` — the agenda is the default view), «Añadir a mi calendario» (downloads the `.ics` for THIS service via `buildICS([event])` — read `AddToCalendarButton` and `app/utils/ics.ts` for the `ICSEvent` shape; the row needs the event's fields: date, day, title). Title = «DOM 13 SEP» style (reuse the row's own `shortDate`).
- The sheet state lives in the row (one `QuickActions` per row is fine — it renders nothing while closed; `CueDialog` handles that).

- [ ] **Step 1: Failing tests** — `useLongPress.test.tsx` (fake timers): fires after 450 ms of a still primary pointer; not on a 300 ms press; cancelled by a 10 px move; cancelled by a `scroll` event; the click after a fired press is swallowed once; right-click (`pointerType:"mouse"`, `contextmenu`) fires and prevents default; a touch `contextmenu` is prevented but does not double-fire. `quickActions.test.tsx`: renders the actions as `Button`s inside a `CueDialog` sheet, `onSelect` then closes, «Cancelar» closes. Row tests: long-press on a `LibraryRow` opens a sheet titled with the song; «Copiar enlace» writes the URL (mock clipboard) and toasts; on `DayCardDisclosure` the sheet has the two actions and «Ver en calendario» pushes `/schedule`.
- [ ] **Step 2: Run, watch them fail.** **Step 3: Implement.** **Step 4: Gates; commit** — `feat(rows): long-press quick actions on song rows and service rows`

---

### Task 5: Docs

- `docs/MOTION.md`: "### App-wide (R7)" section after "### Me (R3)" (cue strip: client fetch keeps `Navbar` static, hidden on `/` and `/me`, ministry-gated at the API; blackout: a body overlay, cancellable, reduced-motion instant; pull-to-refresh: window touch listeners, `preventDefault` only past 8 px at `scrollY 0`, the rail is a sibling `fixed` element — why the content is never translated; the `has-bottom-nav` + coarse-pointer gate; `overscroll-behavior-y: contain`; long-press: 450 ms / 8 px / scroll-cancel / click-swallow, right-click on desktop, `QuickActions` = `CueDialog` sheet); primitives table rows for `CueStrip`, `Blackout`, `PullToRefresh`, `useLongPress`, `QuickActions`; the Bundle table placeholder row "R7 tip — measured at release".
- `docs/UTILITIES_AND_COMPONENTS.md` rows; `docs/ROUTES.md` (`/api/cue`); `CLAUDE.md` + `AGENTS.md` reusable utils (`useLongPress` — the ONLY long-press; `QuickActions` — the ONLY quick-action sheet; `blackout()`; keep the two files identical); spec **Part XIII — R7 (2026-09-13)** with rulings: cue fetched client-side (why); hidden on `/` and `/me`; both-ministry precedence; blackout cancellable; pull-to-refresh phone-only via `has-bottom-nav` + coarse pointer, no content translate, `overscroll-behavior` containment; long-press timings and the desktop right-click; the actions chosen per row (and what was NOT added — no destructive actions in a sheet); "**Bundle:** measured at release."; "**Release:** pending."
- [ ] Gates; commit — `docs(motion): R7 — app-wide cue strip, blackout, pull-to-refresh, long-press`

---

### Task 6: Delivery (coordinator)

- [ ] Bundle A/B (git-archive cold builds, worktree `node_modules`): main vs tip on `/`, `/schedule`, `/biblioteca`, `/me`, `/admin`.
- [ ] Whole-branch review (fable, three checklists) → fix → re-verify.
- [ ] Preview push → alias + SHA → dev-verify captures (cue strip on `/schedule` and `/biblioteca` phone + 1440; a long-press sheet via `--touch` is not scriptable — capture the sheet by `--click` on a row only if the hook exposes a test affordance; otherwise Frank's finger); shots under `docs/superpowers/specs/2026-09-08-premium-motion-shots/r7-*.png`; PR → STOP for Frank's look.
