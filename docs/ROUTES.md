# Routes & Rendering — App Router pages

The app uses **three route groups**, each with its own root `<html>`/`<body>` layout:
- **`app/(client)/`** — the member-facing app.
- **`app/(admin)/`** — only the embedded Sanity Studio.
- **`app/(gallery)/`** — the theme gallery, a **public** (ADR-0017) review surface for the light-mode
  migration. Its root layout sits **at** the `[theme]` dynamic segment rather than at the
  group root, which is unusual and deliberate — see [ADR-0015](adr/0015-gallery-root-layout.md).

Route groups in parentheses **do not** contribute to the URL. There is no top-level
`app/layout.tsx` or `app/page.tsx`; each group supplies its own root layout. Access control is
enforced at **two layers**: the `proxy.ts` middleware (must be logged in, except the public
allow-list — auth pages, cron, the A3 identity route and the theme gallery; Studio needs admin+)
and per-page guards (`requireActiveSession` / `requireActiveManager`).

---

## Layouts

- **`app/(client)/layout.tsx`** (server) — root `<html lang="es">` for the whole member app.
  Loads Google fonts (Advent Pro / Urbanist / Jura), exports `metadata` (title, PWA manifest,
  icons, Apple web-app config) and `viewport` (`viewportFit: "cover"`, themeColor `#010b17`).
  Wraps children in [`<Provider>`](../app/utils/Provider.tsx) (SessionProvider → ThemeProvider
  system-default, `enableSystem` → `ThemeBootstrap` → PlayerProvider) and mounts persistent chrome: `ImpersonationBanner`,
  `ActivityPing`, `NativeAuthBootstrap`, `TextScaleBootstrap`, `AudioPlayer`, `SongSheet`, `BottomNav`.
  `BottomNav` is mounted on every `(client)` route for signed-in members (hidden ≥ `lg`, and on
  `/auth*`/`/studio*`); see "Safe area and the tab bar" in [MOBILE.md](MOBILE.md).
- **`app/(admin)/layout.tsx`** (server) — separate root used only for Studio (Orbitron font,
  `CmsNavbar`, its own metadata). Studio does **not** inherit the client chrome.

No nested sub-tree layouts beyond these group roots. The `(gallery)` root layout is the one
exception to "at the group root": it must receive the `[theme]` param, and Next passes a
layout only the params from the root segment down to that layout.

---

## Page routes

Legend: **S** = server component (async unless noted; e.g. the Studio page is synchronous),
**C** = client component.

| URL | File | Type | Access | Rendering | Description |
|-----|------|------|--------|-----------|-------------|
| `/theme-gallery/[theme]/[fixture]` | `(gallery)/theme-gallery/[theme]/[fixture]/page.tsx` | S | **Public** (ADR-0017) | SSG (14 static) | Theme gallery. `[theme]` ∈ `dark\|light`, `[fixture]` ∈ `swatches\|dialog\|planner\|kids-planner\|controls\|song\|nav`; `dynamicParams=false` 404s anything else. Renders real components from hardcoded fixtures — no session read, no fetch. Review surface for the light-mode migration, and since R6 the **visual-regression baseline** every fixture is captured from (`npm run test:vr`, `e2e/theme-gallery/`). The `nav` fixture hosts `BottomNavBar`, the tab bar's presentational half, with its «Más» sheet open — never `BottomNav`, which reads the session a public prerendered route cannot have (ADR-0017). `#motion` on any gallery URL strips `data-motion="off"` for that hard load, which is how `motion-on.spec.ts` watches a dialog actually enter. |
| `/` | `(client)/page.tsx` | S | Worship | **Dynamic, per member** (`requireWorshipPage`, ADR-0020) | Home. Opens on the member's own line («Hola, Frank / Te toca el sábado …», `homeGreeting`), then this weekend's Sat/Sun/special services: the next one in full, the rest as summary rows. Never make it static: the greeting, the open team sections and the «tú» marks are per viewer. |
| `/schedule` | `(client)/schedule/page.tsx` | S | Worship | ISR 60s | Upcoming services. Agenda (one row per service) is the default view, `Mes` the month grid; `?m=YYYY-MM` browses one month per header-arrow press, still fetching a `WINDOW_MONTHS`-wide window (default: rolling today → +95 days). |
| `/biblioteca` | `(client)/biblioteca/page.tsx` | S | Worship | ISR 60s fetch, dynamic by `searchParams` | The song library (R1): one fetch (catalogue + tags + authors), A–Z index with a search console, letter rail and a filter drawer (Tipo, tema, artista, tonalidad). `?q=`/`?tag=`/`?author=` seed initial state; the index mirrors its own state back into the URL without a round-trip. |
| `/posts/[slug]` | `(client)/posts/[slug]/page.tsx` | S | Worship | **SSG** 3600s + `generateStaticParams` | Song practice surface: lyrics/chords with a transposer, tap tempo, lyrics autoscroll, audio, tutorials, references, play history. `notFound()` for unknown slugs. Hero order since design pass E (2026-10-22): title, author, the pills, then the tags as quiet text links (they led the hero as boxed chips above the title). |
| `/me` | `(client)/me/page.tsx` | S | Member | ISR 60s | "Mi semana" (R3 F3): the identity header (next service + seat + countdown, or the next Kids Sunday), upcoming assignments and proposal CTAs, the Kids block, and ONE link line to `/me/disponibilidad` carrying the count of upcoming marked dates. No calendar and no settings — both are their own pages now. |
| `/me/disponibilidad` | `(client)/me/disponibilidad/page.tsx` | S | Member (**ministry-neutral**) | ISR 60s | The availability calendar, alone (R3 F3): `MyAvailabilityPanel` with the month grid always open, «Seleccionar fechas», «Repetir…» and the per-day note. A kids-only volunteer reaches it. |
| `/me/ajustes` | `(client)/me/ajustes/page.tsx` | S | Member (**ministry-neutral**) | dynamic (session read; `revalidate = 60` is inert) — per-member signed calendar URLs depend on it | Ajustes, alone (R3 F3): the one `SettingsCard` — Tema, Tamaño de texto, Perfil, Calendario (the member's signed calendar-feed links, ADR-0057; worship members only). Reached from the avatar menu («Ajustes») and from `ThemeAnnouncement` on `/me` (`#tema`). |
| `/me/propose/[roleId]` | `(client)/me/propose/[roleId]/page.tsx` | S | **Lead-only** | dynamic (`revalidate=0`) | Setlist proposal editor for a service the user Leads. |
| `/admin` | `(client)/admin/page.tsx` | S | **Manager** | dynamic | Control Room; data fetched client-side from `/api/admin/*`. `?tab=` opens a specific tab, filtered by role. **No shell — the page is the workspace** (R5, [ADR-0035](adr/0035-the-admin-shell-is-gone.md)): one section nav (`AdminRail` — a vertical rail at `lg+` the member can collapse to icons (per browser; the planner's forced collapse wins), the underline strip below, the Servicios item carrying the integrity dot), one keyed body that fades in on a tab change, no panel boxes, and **no page-level horizontal scroll** — the planner grid and the availability matrix are the only horizontal scrollers, each in its own `overflow-x-auto` box. Servicios (one column of compact cards the page scrolls vertically, beside a sticky Participaciones — [ADR-0044](adr/0044-the-servicios-board-scrolls-vertically.md), amended 2026-10-22) and the integrity queue load eagerly; the other five tabs and `MonthGenerator` load on demand as their own `next/dynamic` chunks, which is why `/admin`'s first load fell from 358.6 to 150.8 kB gz (R5 Task 6, see [MOTION.md](MOTION.md)). |
| `/auth/signin` | `(client)/auth/signin/page.tsx` | C | Public | — | Google SSO (web + native) + email/password. |
| `/auth/not-a-member` | `(client)/auth/not-a-member/page.tsx` | C | Public | — | For authenticated Google users not in `teamMembers`. |
| `/studio`, `/studio/*` | `(admin)/studio/[[...tool]]/page.tsx` | S | **admin+** | `force-static` | Embedded Sanity Studio (`NextStudio`). |

**Access column.** `proxy.ts` requires an authenticated session for everything except the
auth pages, the cron routes, the A3 identity route, the theme gallery (ADR-0017) and static
assets. "Public" therefore means "no page-level guard": the two `/auth/*` pages are reachable
signed-out by design, and **the theme gallery is the one route the anonymous internet can
open**, deliberately, because it is prerendered and reads nothing. "Worship" means the page
calls `requireWorshipPage()` on top of the session (ministry-scoped, see the enforcement table).

### Dynamic segments
- `posts/[slug]` → `post.slug.current` (has `generateStaticParams()`).
- `me/propose/[roleId]` → a role doc `_id` where the current user is in `Lead[]`; else `notFound()`.
- `studio/[[...tool]]` → optional catch-all for Studio's internal router.

### Redirects
`next.config.mjs`'s `redirects()` (R1, spec §12.2, decision H): the tag and author pages folded
into the library, permanent (308) so bookmarks and the old nav keep working.

| Source | Destination |
|--------|-------------|
| `/tag` | `/biblioteca` |
| `/tag/:slug` | `/biblioteca?tag=:slug` |
| `/author` | `/biblioteca` |
| `/author/:slug` | `/biblioteca?author=:slug` |

### Access-control enforcement (page level)
| Route | Guard |
|-------|-------|
| `/`, `/schedule`, `/posts/[slug]`, `/biblioteca` | `requireWorshipPage()` → ministry-scoped, redirects a kids-only member |
| `/me` | `requireActiveSession()` → redirect `/auth/signin?callbackUrl=/me` |
| `/me/disponibilidad`, `/me/ajustes` | `requireActiveSession()` → redirect with that route's own `callbackUrl`. Ministry-neutral by design: neither gates on a ministry. (`/me/ajustes` reads one only to decide its «Calendario» block — `loadCalendarFeedState`; the page renders for every active member.) |
| `/me/propose/[roleId]` | `requireWorshipPage()` + GROQ requires user in `Lead[]`, else `notFound()` |
| `/admin` | `requireActiveManager()` → `redirect("/")` |
| `/studio/*` | `proxy.ts` role check (admin/super-admin) + Sanity Studio's own auth |

---

## Data fetching per page (high level)

- **`/`** — a combined weekend query pulling `featuredSongs`/`saturdarSongs`/`sunday_role`/
  `saturday_role`/`special_role`; applies `publishedSetlist()`.
- **`/schedule`** — combined query over role + setlist docs across a date window derived from
  `?m=` via `scheduleMonths.ts`.
- **`/biblioteca`** — one combined query: the catalogue (former home `POSTS_QUERY`, plus author
  refs), tags with counts (former `/tag` query) and authors with counts (former `/author`
  query). Filtering is client-side, so one cached fetch serves every `?q=`/`?tag=`/`?author=`.
- **`/me`** — `requireActiveSession()`, then the member read (`serverClient`: `_id`,
  `member_name`, `alias`, `memberType`, `unavailableDates`, `photoUrl`) and, for a worship
  member only, the assignments + shared proposals (`operationalClient`/`serverClient`); uses
  `describeContributors`.
- **`/me/disponibilidad`** — `requireActiveSession()`, then `Promise.all` of
  `MEMBER_AVAILABILITY_QUERY` (`serverClient` — `_rev` is the save precondition) and
  `SERVICE_DATES_QUERY` over `horizon()` (`operationalClient`). Both in
  `(client)/me/queries.ts`, a neutral module the three `/me` pages share.
- **`/me/ajustes`** — `requireActiveSession()`, then one `MEMBER_PROFILE_QUERY` read
  (`serverClient`) — the fields `ProfilePanel` edits — and `loadCalendarFeedState` (the member's
  `calendarFeed.<id>` generation, tokened, to sign the «Calendario» links; nothing secret reaches
  the client but the member's own URLs).
- **`/posts/[slug]`** — full `post` projection + last-3 past plays (bounded `week < today`).
- **`/admin`** — only `requireActiveManager()`; panels fetch client-side.

Two clients: `client` (CDN read, `useCdn:false`) for cacheable page data; `serverClient` (read
token) for private/fresh data.

---

## Notable components per page

`Navbar` carries `CueStrip` (the next-service cue, fetched client-side from `/api/cue` — see
[API_REFERENCE.md](API_REFERENCE.md)) on every route except `/` and `/me`, which pass `cue={false}`
because their own headers already show the countdown.

- **`/`** — `Navbar`, `DayCard` (the next service, `layout="wide"` + `hero`; its countdown pill carries the start time and «Mensaje para el equipo» folds to three lines since design pass D, 2026-10-22), `DayCardDisclosure` (every other service, collapsed to one line).
- **`/schedule`** — `Navbar`, `CalendarView` (composition only: `ScheduleHeader`, `DayStrip`, the
  Agenda|Mes `SegmentedControl`, `AgendaView` or the month grid, the day sheet `CueDialog`).
- **`/biblioteca`** — `Navbar`, `LibraryIndex`.
- **`/me`** — `Navbar`, `MeHeader` (the identity header: name, Tipo chips, and the one
  countdown line), `DayCard` (the next service, `hero`, no `isNext` — the header already
  carries the countdown), `DayCardDisclosure` (every other service, collapsed), each lead
  service's proposal CTA (a house `Button`), and «Tu cuenta» (`account/AccountList`, 2026-10-22):
  Disponibilidad with its count, the one-shot `.ics` download (`account/DownloadCalendarRow`,
  worship only), Calendario (`/me/ajustes#calendario`) and Ajustes. `MeHeader` carries no
  «Editar perfil» since F3 — the list and the avatar menu are the ways into settings.
- **`/me/disponibilidad`** — `Navbar`, `availability/MyAvailabilityPanel` (the month
  `AvailabilityGrid` always open; no weekend pills, no Desde/Hasta fields).
- **`/me/ajustes`** — `Navbar`, `SettingsCard` (one card holding `ThemeControl`,
  `TextSizeControl`, `ProfilePanel` `bare` and `CalendarFeedPanel` — no longer separate cards;
  since design pass D the calendar block is one «Todos / Solo los míos» switch over one row of
  links, «¿Cómo funciona?» folded, and a link to `/me#tu-cuenta` for the one-shot `.ics`).
  Both anchors other pages link to (`#calendario` here, `#tu-cuenta` on `/me`) carry the
  navbar-clearing `UNDER_NAVBAR_SCROLL_MT` (`app/utils/navbarHeight.ts`, beside `NAVBAR_H_CLASS`;
  `LibraryIndex` composes its sticky offset from it too).
- **`/me/propose/[roleId]`** — `Navbar`, `ProposalEditor` (co-located client component). Since the member design pass (2026-10-22, item 12) every control in it is the house `Button`, keys are shown through `formatKey` («B♭») and stored as typed, and «Agregar canción» opens a `CueDialog` sheet that lists the catalogue and stays open after an add (the added row reads «En lista»).
- **`/posts/[slug]`** — `Navbar`, `TransposeProvider` (the page's one transposition seat),
  `SongHeroPills` (`KeyDial` + the 12-key drawer, `TempoPill`), `SectionNav` (whose
  `practice` prop renders `PracticeCluster` once the hero scrolls away), `LyricsAutoscroll`,
  `ChordChart`, `SongAudioSection`, `EditSongButton`, `PortableText`.
- **`/admin`** — `Navbar`, an `h1`, `AdminPanel` composing the `app/components/admin/*` panels inside `brand-admin-frame` (kept only as the planner's `:has(.planner-wide)` hook — the bordered `.brand-admin-shell` is gone, ADR-0035).
- **Always mounted (client layout)** — `ImpersonationBanner`, `ActivityPing`, `AudioPlayer`,
  `SongSheet`, `NativeAuthBootstrap`, `TextScaleBootstrap`, `BottomNav`.

See [UTILITIES_AND_COMPONENTS.md](UTILITIES_AND_COMPONENTS.md) for the full component inventory.

---

## Special files

- `(client)/loading.tsx` — home run-sheet skeleton: the wide hero card plus two collapsed lines (group-level suspense).
- `(client)/error.tsx` (C) — branded Spanish error boundary with retry.
- `(client)/me/loading.tsx`, `(client)/me/disponibilidad/loading.tsx`,
  `(client)/me/ajustes/loading.tsx`, `(client)/schedule/loading.tsx`,
  `(client)/posts/[slug]/loading.tsx`, `(client)/biblioteca/loading.tsx` — per-route skeletons.
- `(client)/posts/not-found.tsx` — "Canción no encontrada."
- `(client)/not-found.tsx` — "Página no encontrada": the fallback for every other `notFound()` in the `(client)` group
  (`/me/propose/[roleId]`); `(gallery)` has none.
- No `error.tsx`/`not-found.tsx` in the `(admin)` group.

---

## ISR / dynamic settings (exact)

| File | Setting |
|------|---------|
| `/`, `/schedule`, `/biblioteca`, `/me`, `/me/disponibilidad`, `/me/ajustes` | `export const revalidate = 60` |
| `/posts/[slug]` | `revalidate = 3600` + `generateStaticParams()` |
| `/me/propose/[roleId]` | `revalidate = 0` (always dynamic) |
| `/studio/[[...tool]]` | `export const dynamic = 'force-static'` |
| `/admin`, `/auth/*` | none (implicitly dynamic / client) |

**Reminder:** mutations that change data behind these ISR pages must call the matching
`revalidate*` helper — see [ARCHITECTURE.md §5](ARCHITECTURE.md#5-rendering--caching-model).
