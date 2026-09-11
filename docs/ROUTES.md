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
| `/theme-gallery/[theme]/[fixture]` | `(gallery)/theme-gallery/[theme]/[fixture]/page.tsx` | S | **Public** (ADR-0017) | SSG (6 static) | Theme gallery. `[theme]` ∈ `dark\|light`, `[fixture]` ∈ `swatches\|dialog\|planner`; `dynamicParams=false` 404s anything else. Renders real components from hardcoded fixtures — no session read, no fetch. Review surface for the light-mode migration. |
| `/` | `(client)/page.tsx` | S | Worship | ISR 60s | Home "Esta semana." This weekend's Sat/Sun/special services. |
| `/schedule` | `(client)/schedule/page.tsx` | S | Worship | ISR 60s | Upcoming services. Agenda (one row per service) is the default view, `Mes` the month grid; `?m=YYYY-MM` browses one month per header-arrow press, still fetching a `WINDOW_MONTHS`-wide window (default: rolling today → +95 days). |
| `/biblioteca` | `(client)/biblioteca/page.tsx` | S | Worship | ISR 60s fetch, dynamic by `searchParams` | The song library (R1): one fetch (catalogue + tags + authors), A–Z index with a search console, letter rail and a filter drawer (Tipo, tema, artista, tonalidad). `?q=`/`?tag=`/`?author=` seed initial state; the index mirrors its own state back into the URL without a round-trip. |
| `/posts/[slug]` | `(client)/posts/[slug]/page.tsx` | S | Worship | **SSG** 3600s + `generateStaticParams` | Song detail: lyrics/chords, audio, tutorials, references, play history. `notFound()` for unknown slugs. |
| `/me` | `(client)/me/page.tsx` | S | Member | ISR 60s | "Mi perfil": upcoming assignments, proposal CTAs, availability, profile settings. |
| `/me/propose/[roleId]` | `(client)/me/propose/[roleId]/page.tsx` | S | **Lead-only** | dynamic (`revalidate=0`) | Setlist proposal editor for a service the user Leads. |
| `/admin` | `(client)/admin/page.tsx` | S | **Manager** | dynamic | Admin dashboard shell; data fetched client-side from `/api/admin/*`. `?tab=` opens a specific tab, filtered by role. |
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
- **`/me`** — `requireActiveSession()`, then `Promise.all` of member profile (`serverClient`),
  the member's assignments (`client`), shared proposals per led service (`serverClient`), and
  service dates; uses `describeContributors`.
- **`/posts/[slug]`** — full `post` projection + last-3 past plays (bounded `week < today`).
- **`/admin`** — only `requireActiveManager()`; panels fetch client-side.

Two clients: `client` (CDN read, `useCdn:false`) for cacheable page data; `serverClient` (read
token) for private/fresh data.

---

## Notable components per page

- **`/`** — `Navbar`, `DayCard` (the next service, `layout="wide"` + `hero`), `DayCardDisclosure` (every other service, collapsed to one line).
- **`/schedule`** — `Navbar`, `CalendarView` (composition only: `ScheduleHeader`, `DayStrip`, the
  Agenda|Mes `SegmentedControl`, `AgendaView` or the month grid, the day sheet `CueDialog`).
- **`/biblioteca`** — `Navbar`, `LibraryIndex`.
- **`/me`** — `Navbar`, `NextServiceHero`, `DayCard`, `AddToCalendarButton`,
  `AvailabilityCalendar`, `ProfilePanel`, `TextSizeControl`.
- **`/me/propose/[roleId]`** — `Navbar`, `ProposalEditor` (co-located client component).
- **`/posts/[slug]`** — `Navbar`, `SectionNav`, `ChordChart`, `SongAudioSection`,
  `EditSongButton`, `PortableText`.
- **`/admin`** — `Navbar`, `AdminPanel` composing the `app/components/admin/*` panels.
- **Always mounted (client layout)** — `ImpersonationBanner`, `ActivityPing`, `AudioPlayer`,
  `SongSheet`, `NativeAuthBootstrap`, `TextScaleBootstrap`, `BottomNav`.

See [UTILITIES_AND_COMPONENTS.md](UTILITIES_AND_COMPONENTS.md) for the full component inventory.

---

## Special files

- `(client)/loading.tsx` — home run-sheet skeleton: the wide hero card plus two collapsed lines (group-level suspense).
- `(client)/error.tsx` (C) — branded Spanish error boundary with retry.
- `(client)/me/loading.tsx`, `(client)/schedule/loading.tsx`,
  `(client)/posts/[slug]/loading.tsx`, `(client)/biblioteca/loading.tsx` — per-route skeletons.
- `(client)/posts/not-found.tsx` — "Canción no encontrada."
- `(client)/not-found.tsx` — "Página no encontrada": the fallback for every other `notFound()` in the `(client)` group
  (`/me/propose/[roleId]`); `(gallery)` has none.
- No `error.tsx`/`not-found.tsx` in the `(admin)` group.

---

## ISR / dynamic settings (exact)

| File | Setting |
|------|---------|
| `/`, `/schedule`, `/biblioteca`, `/me` | `export const revalidate = 60` |
| `/posts/[slug]` | `revalidate = 3600` + `generateStaticParams()` |
| `/me/propose/[roleId]` | `revalidate = 0` (always dynamic) |
| `/studio/[[...tool]]` | `export const dynamic = 'force-static'` |
| `/admin`, `/auth/*` | none (implicitly dynamic / client) |

**Reminder:** mutations that change data behind these ISR pages must call the matching
`revalidate*` helper — see [ARCHITECTURE.md §5](ARCHITECTURE.md#5-rendering--caching-model).
