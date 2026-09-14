# R3 F3 — Split `/me` into three pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/me` answers "who am I and when do I serve"; `/me/disponibilidad` is the calendar alone; `/me/ajustes` holds Tema, Tamaño de texto and Perfil. The weekend pills and the Desde/Hasta fields go — the calendar (tap for one day, «Seleccionar fechas» for a range, «Repetir…» for a pattern) is the one way to mark availability.

**Architecture:** Two new Server Component routes under `app/(client)/me/`, each with its own `loading.tsx`, sharing the member/service-date GROQ through a neutral `app/(client)/me/queries.ts`. `/me` keeps its header, hero and Kids block and gains one link line to the calendar. `MyAvailabilityPanel` loses the weekend list; `AvailabilityGrid` loses the date fields. The avatar menu points at `/me/ajustes`; «Editar perfil» leaves the header.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind, vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` Part XII, subsection F3 (to be written in Task 3). Frank (2026-09-12): "too many buttons that select the unavailable dates … remove the pills with the calendar … the /me page does too many things now — settings, hero cards, unavailable dates, edit profile". Rulings taken with his «go»: keep «Seleccionar fechas» on the calendar page (it still scrolls vertically); drop «Editar perfil» from the header (settings are one tap away in the avatar menu).

## Global Constraints

- Gates in ONE `&&` chain with the commit (Node 22: `export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH`): `node scripts/colour-inventory.mjs && npx tsc --noEmit && npx vitest run && npx eslint .` (0 errors) then the commit. Every task runs the full suite.
- **The availability save contract is untouched**: `useAvailability.ts` and `app/api/me/availability` unchanged; `_rev` still flows from the page that renders the calendar into `initialRev`.
- **Gating byte-identical in spirit**: every new page starts with `const session = await requireActiveSession(); if (!session) redirect("/auth/signin?callbackUrl=<its path>")`. A kids-only member reaches `/me/disponibilidad` and `/me/ajustes` (both are ministry-neutral) and still sees no worship surface anywhere. `proxy.ts` already covers `/me/*` (no matcher change).
- Server Components never CALL a client-module value (ADR-0028; `clientBoundary.test.ts`); `queries.ts` is neutral (no imports from client modules).
- `#tema`/`#tema-h` keep existing (inside `SettingsCard` on `/me/ajustes`); `ThemeAnnouncement`'s anchor becomes `/me/ajustes#tema`; `themePrefModule.test.ts` line ~236 (`href="#tema"`) is updated to the new href honestly.
- `Button` for every button; `Presence` for animated conditionals; `revealProps` indices contiguous from 0 on each page; no `appear` above the fold.
- Spanish UI; conventional commits; **no AI attribution or Co-Authored-By trailers**; docs current in the same task.

---

### Task 1: `/me/disponibilidad` — the calendar alone; pills and date fields retired

**Files:**
- Create: `app/(client)/me/queries.ts`, `app/(client)/me/disponibilidad/page.tsx`, `app/(client)/me/disponibilidad/loading.tsx`, `app/(client)/me/disponibilidad/__tests__/disponibilidadPage.test.tsx`
- Modify: `app/(client)/me/page.tsx`, `app/(client)/me/loading.tsx`, `app/(client)/me/__tests__/mePage.test.tsx`, `app/components/availability/MyAvailabilityPanel.tsx`, `app/components/availability/AvailabilityGrid.tsx`, `app/components/availability/__tests__/myAvailabilityPanel.test.tsx`, `app/components/availability/__tests__/availabilityGridDrag.test.tsx`, `app/components/__tests__/availabilityCalendarConflict.test.tsx` (re-point only if it rendered the weekend list), `app/components/ui/Button.tsx` (drop the `availability` pill tone ONLY if no consumer remains — grep; `lightContrast.test.ts` composite block goes with it), `app/utils/__tests__/lightContrast.test.ts`
- Delete: `app/components/availability/WeekendList.tsx`, `app/components/availability/__tests__/weekendList.test.tsx`, `app/utils/weekends.ts`, `app/utils/__tests__/weekends.test.ts`

**Interfaces:**
- Produces `app/(client)/me/queries.ts` (neutral): `export const MEMBER_AVAILABILITY_QUERY` = the `teamMembers` projection `{ _id, _rev, member_name, alias, unavailableDates, unavailabilityNotes }`; `export const SERVICE_DATES_QUERY` = the three-type week/date union from `page.tsx` (verbatim); `export function horizon(): { today: string; limit: string }` — CDMX `today` and `today + 365 d`, exactly the existing expressions (keep the `react-hooks/purity` eslint-disable comments beside the `Date.now()` calls).
- `MyAvailabilityPanel` props unchanged (`initialRev`, `initialDates`, `initialNotes`, `serviceDates`); it renders «Repetir…» + «Guardar» + notices + the grid ALWAYS OPEN (no «Ver calendario» disclosure — the page is the calendar) + the note popover. `WeekendList` import removed.
- `AvailabilityGrid`: the «Rango por fechas» `Collapse`, its `DateField`s, `applySpan`, `canApplyRange` and their state are removed; «Seleccionar fechas» ⇄ «Listo» stays; everything else unchanged.

**Behaviour:**
- `/me/disponibilidad/page.tsx` (Server Component, `export const revalidate = 60`): session guard (`callbackUrl=/me/disponibilidad`); `Promise.all` of the member (`serverClient`, `MEMBER_AVAILABILITY_QUERY`) and the service dates (`operationalClient`, `SERVICE_DATES_QUERY`, `horizon()`); renders `Navbar`, then `<div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-8">`: `h1` «Disponibilidad» (`font-display text-2xl uppercase tracking-wide`, `revealProps(0)`) with the eyebrow «Marca los días en que no puedes · el viernes es ensayo» under it; a «← Mi semana» `Button variant="ghost" size="sm" href="/me"` above the `h1`; then `MyAvailabilityPanel` (`revealProps(1)`) or, when the member read is null, the existing «No pudimos cargar tu perfil» section (copy trimmed to availability: «Tus días no disponibles no están disponibles ahora mismo. …»).
- `loading.tsx`: `SkeletonGroup label="Cargando tu disponibilidad"` — navbar skeleton, a heading bar, three month-tile blocks.
- `/me/page.tsx`: the member projection drops `_rev`, `unavailabilityNotes`, `notifPrefs`, `photoUrl`, `hasPassword`, `role`, `email` but KEEPS `unavailableDates` (for the count) — the `_rev` comment block goes with it; the `serviceDates` read and `calendarServiceDates` go; `MyAvailabilityPanel`/`SettingsCard`/`ThemeAnnouncement` imports go (ThemeAnnouncement moves in Task 2 — leave it in place for THIS task, Task 2 removes it). After the Kids block, a link line at `revealProps(3)`: `<Link href="/me/disponibilidad" className="...">` rendering «Disponibilidad» + a `font-label` count «N fechas marcadas» / «Sin fechas marcadas», where `N = (member?.unavailableDates ?? []).filter(d => d >= today).length` (0 → «Sin fechas marcadas»; 1 → «1 fecha marcada»); chevron `›`. Styled as a full-width row (`flex items-center justify-between rounded-xl border border-accent/15 px-4 py-3 hover:border-accent/40`). The null-member arm keeps the error section at `revealProps(3)` (copy: «Tu disponibilidad y tus ajustes no están disponibles ahora mismo. …») and no link. `SettingsCard` stays at `revealProps(4)` for this task (Task 2 moves it).
- `/me/loading.tsx`: remove the ten-row block; add one row-skeleton for the link line.
- `MeHeader`: unchanged in this task (Task 2 removes «Editar perfil»).

- [ ] **Step 1: Failing tests** — `disponibilidadPage.test.tsx` (mirror `mePage.test.tsx`'s mocks: `requireActiveSession`, `getMemberAccess`, `serverClient`/`operationalClient` fetch, `next/navigation` `redirect`): (a) unauthenticated → `redirect("/auth/signin?callbackUrl=/me/disponibilidad")`; (b) a KIDS-ONLY member renders the calendar (`Seleccionar fechas` button present) — no worship copy; (c) the member read returns null → «No pudimos cargar» and no `Seleccionar fechas`; (d) the service dates read is called with `today`/`limit`. `mePage.test.tsx`: replace "keeps the profile and availability panels for a kids-only member" with "keeps the availability link and the settings card for a kids-only member" (link `href="/me/disponibilidad"`, count text); add "counts only upcoming unavailable dates" (fixture `unavailableDates: ["2020-01-01", "<today+2>", "<today+9>"]` → «2 fechas marcadas»); every other case unchanged except the removed weekend-row expectations. `myAvailabilityPanel.test.tsx`: drop the weekend/range cases; assert the grid renders open (no «Ver calendario» button; `Seleccionar fechas` present) and «Repetir…» still toggles. `availabilityGridDrag.test.tsx`: remove the «Rango por fechas» cases if any; keep the drag cases.
- [ ] **Step 2: Run them, watch them fail.**
- [ ] **Step 3: Implement** per Behaviour; delete the four files; grep for `WeekendList`, `nextWeekends`, `weekendLabel`, `tone="availability"`, `Rango por fechas`, `availability-range` across `app/**` — zero hits (except the `Button` tone if a consumer remains — say which).
- [ ] **Step 4: Gates; commit** — `feat(me): the calendar is the one availability surface, on its own page`

---

### Task 2: `/me/ajustes` — settings on their own page; the header and menu point there

**Files:**
- Create: `app/(client)/me/ajustes/page.tsx`, `app/(client)/me/ajustes/loading.tsx`, `app/(client)/me/ajustes/__tests__/ajustesPage.test.tsx`
- Modify: `app/(client)/me/page.tsx`, `app/(client)/me/loading.tsx`, `app/(client)/me/__tests__/mePage.test.tsx`, `app/(client)/me/queries.ts` (add `MEMBER_PROFILE_QUERY`), `app/components/MeHeader.tsx`, `app/components/__tests__/meHeader.test.tsx`, `app/components/NavMenu.tsx`, `app/components/__tests__/navMenu.test.tsx`, `app/components/ui/ThemeAnnouncement.tsx`, `app/utils/__tests__/themePrefModule.test.ts`, `app/components/SettingsCard.tsx` (header comment only), `app/components/__tests__/settingsCard.test.tsx` (if it asserts the `#ajustes` anchor is a link target from the header — re-word)

**Interfaces:**
- `queries.ts` gains `export const MEMBER_PROFILE_QUERY` = the projection `ProfilePanel`'s `MemberProfile` needs: `{ _id, _rev, member_name, alias, email, role, notifPrefs, "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl), "hasPassword": defined(passwordHash) && passwordHash != "" }` (verbatim from today's `/me` projection minus availability/memberType).
- `MeHeader` loses the `Editar perfil` button and nothing else (its `Props` unchanged).
- `NavMenu`: «Mi perfil» → `href="/me/ajustes"`; «Tema» → `href="/me/ajustes#tema"`.
- `ThemeAnnouncement`: the anchor `href="/me/ajustes#tema"`; it now renders on `/me/ajustes` too? NO — it stays on `/me` only (the banner is the invitation; the settings page is the destination).

**Behaviour:**
- `/me/ajustes/page.tsx` (Server Component, `revalidate = 60`): session guard (`callbackUrl=/me/ajustes`); one `serverClient` read with `MEMBER_PROFILE_QUERY`; renders `Navbar`, `<div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-8">`: «← Mi semana» ghost link, `h1` «Ajustes» (`revealProps(0)`), then `<SettingsCard member={member} {...revealProps(1)} />` (null member → `SettingsCard member={null}` plus the existing «No pudimos cargar tu perfil» section above it, copy trimmed to the profile).
- `loading.tsx`: `SkeletonGroup label="Cargando tus ajustes"` — navbar, heading bar, one tall card.
- `/me/page.tsx`: `SettingsCard` and its import go; the null-member arm keeps only the error section; `revealProps` end at 3; `ThemeAnnouncement` stays on `/me` (import stays). The member projection drops the profile fields Task 1 left (`role`, `email`, `notifPrefs`, `photoUrl`, `hasPassword`) — final projection: `{ _id, member_name, alias, memberType, unavailableDates, "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl) }` (the header shows the photo). Keep the `photoUrl` line.
- `/me/loading.tsx`: remove the settings-card skeleton.

- [ ] **Step 1: Failing tests** — `ajustesPage.test.tsx`: (a) unauthenticated redirect with `callbackUrl=/me/ajustes`; (b) a kids-only member gets the card with `#tema`, «Tamaño de texto» and «Perfil»; (c) null member → error section + card without «Perfil». `mePage.test.tsx`: no `#ajustes` on `/me`; the announcement's link is `/me/ajustes#tema`. `meHeader.test.tsx`: no «Editar perfil». `navMenu.test.tsx`: the two hrefs. `themePrefModule.test.ts` ~236: `href="/me/ajustes#tema"`.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.** Grep `#ajustes` across `app/**` — only `SettingsCard` and its test remain.
- [ ] **Step 4: Gates; commit** — `feat(me): settings live at /me/ajustes; the header and the avatar menu point there`

---

### Task 3: Docs + delivery

**Files:**
- Modify: `docs/ROUTES.md` (two new rows in the route table + auth table + composition list + `revalidate` row; `/me` row re-worded), `docs/MOTION.md` ("Me (R3)" → "F3 (2026-09-12): three pages" bullet; the F1 weekend bullets marked retired; the F2 bullet's "date fields moved into the grid" marked retired), `docs/UTILITIES_AND_COMPONENTS.md` (rows: `MyAvailabilityPanel`, `AvailabilityGrid`, `MeHeader`, `SettingsCard`, `queries.ts`; `WeekendList`/`weekends.ts` rows retired; `useAvailability` paragraph), `CLAUDE.md` + `AGENTS.md` (remove the `nextWeekends`/`weekendLabel` entry; keep identical), spec Part XII "### F3 — three pages (2026-09-12)" (Frank's words verbatim; the rulings: one surface to mark availability; the split by question; «Seleccionar fechas» kept; «Editar perfil» dropped; the §12.4 "one page" ruling reversed and why; "**Bundle:** measured at release."; "**Release:** pending.").
- [ ] Gates; commit — `docs(motion): R3 F3 — /me split into Mi semana, Disponibilidad, Ajustes`
- [ ] Delivery (coordinator): bundle A/B for `/me`, `/me/disponibilidad`, `/me/ajustes`; whole-F3 review (fable, three checklists) → fix → re-verify; preview push; alias; dev-verify captures (the three pages, phone + 1440; calendar with `--click "Seleccionar fechas"`); `me-after.png` refreshed; PR #65 comment; STOP for Frank's look.
