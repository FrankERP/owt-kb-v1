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
  `ActivityPing`, `NativeAuthBootstrap`, `TextScaleBootstrap`, `AudioPlayer`, `SongSheet`.
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
| `/` | `(client)/page.tsx` | S | Public* | ISR 60s | Home "Esta semana." This weekend's Sat/Sun/special services + full searchable song list. |
| `/schedule` | `(client)/schedule/page.tsx` | S | Public* | ISR 60s | Upcoming services calendar; `?m=YYYY-MM` month browse. |
| `/author` | `(client)/author/page.tsx` | S | Public* | ISR 60s | Artist index with per-author counts. |
| `/author/[slug]` | `(client)/author/[slug]/page.tsx` | S | Public* | ISR 60s | Songs by one author (`generateMetadata` sets title). `notFound()` for unknown slugs. |
| `/tag` | `(client)/tag/page.tsx` | S | Public* | ISR 60s | Tag index with counts. |
| `/tag/[slug]` | `(client)/tag/[slug]/page.tsx` | S | Public* | ISR 60s | Songs filtered by tag. `notFound()` for unknown slugs. |
| `/posts/[slug]` | `(client)/posts/[slug]/page.tsx` | S | Public* | **SSG** 3600s + `generateStaticParams` | Song detail: lyrics/chords, audio, tutorials, references, play history. `notFound()` for unknown slugs. |
| `/me` | `(client)/me/page.tsx` | S | Member | ISR 60s | "Mi perfil": upcoming assignments, proposal CTAs, availability, profile settings. |
| `/me/propose/[roleId]` | `(client)/me/propose/[roleId]/page.tsx` | S | **Lead-only** | dynamic (`revalidate=0`) | Setlist proposal editor for a service the user Leads. |
| `/admin` | `(client)/admin/page.tsx` | S | **Manager** | dynamic | Admin dashboard shell; data fetched client-side from `/api/admin/*`. |
| `/auth/signin` | `(client)/auth/signin/page.tsx` | C | Public | — | Google SSO (web + native) + email/password. |
| `/auth/not-a-member` | `(client)/auth/not-a-member/page.tsx` | C | Public | — | For authenticated Google users not in `teamMembers`. |
| `/studio`, `/studio/*` | `(admin)/studio/[[...tool]]/page.tsx` | S | **admin+** | `force-static` | Embedded Sanity Studio (`NextStudio`). |

\* **"Public"** means no page-level guard, **but** `proxy.ts` still requires an authenticated
session for everything except the auth pages, the cron routes, the A3 identity route, the theme
gallery (ADR-0017) and static assets — so in practice these pages are visible to any
logged-in team member. **The theme gallery is the one exception**: it is reachable by the
anonymous internet, deliberately, because it is prerendered and reads nothing.

### Dynamic segments
- `posts/[slug]` → `post.slug.current` (has `generateStaticParams()`).
- `author/[slug]` → `author.slug.current`; `tag/[slug]` → `tag.slug.current`.
- `me/propose/[roleId]` → a role doc `_id` where the current user is in `Lead[]`; else `notFound()`.
- `studio/[[...tool]]` → optional catch-all for Studio's internal router.

### Access-control enforcement (page level)
| Route | Guard |
|-------|-------|
| `/me` | `requireActiveSession()` → redirect `/auth/signin?callbackUrl=/me` |
| `/me/propose/[roleId]` | `requireActiveSession()` + GROQ requires user in `Lead[]`, else `notFound()` |
| `/admin` | `requireActiveManager()` → `redirect("/")` |
| `/studio/*` | `proxy.ts` role check (admin/super-admin) + Sanity Studio's own auth |

---

## Data fetching per page (high level)

- **`/`** — `POSTS_QUERY` (all songs) + a combined weekend query pulling `featuredSongs`/
  `saturdarSongs`/`sunday_role`/`saturday_role`/`special_role`; applies `publishedSetlist()`.
- **`/schedule`** — combined query over role + setlist docs across a date window derived from
  `?m=` via `scheduleMonths.ts`.
- **`/me`** — `requireActiveSession()`, then `Promise.all` of member profile (`serverClient`),
  the member's assignments (`client`), shared proposals per led service (`serverClient`), and
  service dates; uses `describeContributors`.
- **`/posts/[slug]`** — full `post` projection + last-3 past plays (bounded `week < today`).
- **`/author`,`/tag` indexes** — grouped queries with per-item `postCount` + distinct total.
- **`/admin`** — only `requireActiveManager()`; panels fetch client-side.

Two clients: `client` (CDN read, `useCdn:false`) for cacheable page data; `serverClient` (read
token) for private/fresh data.

---

## Notable components per page

- **`/`** — `Navbar`, `DayCard`, `SongSearchList`.
- **`/schedule`** — `Navbar`, `CalendarView`.
- **`/me`** — `Navbar`, `NextServiceHero`, `DayCard`, `AddToCalendarButton`,
  `AvailabilityCalendar`, `ProfilePanel`, `TextSizeControl`.
- **`/me/propose/[roleId]`** — `Navbar`, `ProposalEditor` (co-located client component).
- **`/posts/[slug]`** — `Navbar`, `SectionNav`, `ChordChart`, `SongAudioSection`,
  `EditSongButton`, `PortableText`.
- **`/admin`** — `Navbar`, `AdminPanel` composing the `app/components/admin/*` panels.
- **Always mounted (client layout)** — `ImpersonationBanner`, `ActivityPing`, `AudioPlayer`,
  `SongSheet`, `NativeAuthBootstrap`, `TextScaleBootstrap`.

See [UTILITIES_AND_COMPONENTS.md](UTILITIES_AND_COMPONENTS.md) for the full component inventory.

---

## Special files

- `(client)/loading.tsx` — home DayCard skeleton (group-level suspense).
- `(client)/error.tsx` (C) — branded Spanish error boundary with retry.
- `(client)/me/loading.tsx`, `(client)/schedule/loading.tsx`,
  `(client)/posts/[slug]/loading.tsx` — per-route skeletons.
- `(client)/posts/not-found.tsx` — "Canción no encontrada."
- `(client)/not-found.tsx` — "Página no encontrada": the group-level fallback for
  every other `notFound()` (`/author/[slug]`, `/tag/[slug]`, `/me/propose/[roleId]`).
- No `error.tsx`/`not-found.tsx` in the `(admin)` group.

---

## ISR / dynamic settings (exact)

| File | Setting |
|------|---------|
| `/`, `/schedule`, `/author`, `/author/[slug]`, `/tag`, `/tag/[slug]`, `/me` | `export const revalidate = 60` |
| `/posts/[slug]` | `revalidate = 3600` + `generateStaticParams()` |
| `/me/propose/[roleId]` | `revalidate = 0` (always dynamic) |
| `/studio/[[...tool]]` | `export const dynamic = 'force-static'` |
| `/admin`, `/auth/*` | none (implicitly dynamic / client) |

**Reminder:** mutations that change data behind these ISR pages must call the matching
`revalidate*` helper — see [ARCHITECTURE.md §5](ARCHITECTURE.md#5-rendering--caching-model).
