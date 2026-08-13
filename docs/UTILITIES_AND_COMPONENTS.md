# Utilities, Context & Components

### `themeColour(rgbVar, alpha?)` — `app/utils/themeColour.ts`

Builds a complete CSS colour from a token's RGB triplet: `themeColour("--accent-rgb", 0.2)`
→ `rgb(var(--accent-rgb) / 0.2)`.

**It deliberately cannot return a fragment.** Before Child B, components built colours by
concatenating a two-hex-digit alpha onto a bare hex — `` `${accentHex}55` ``. A token cannot
survive that: `rgb(var(--accent-rgb) / 0.2)55` is not a valid `<color>`, so the browser drops
the entire declaration silently, with nothing in the console. That was live at 24 call sites
across four files.

**Not for SVG presentation attributes.** `var()` is not substituted inside `fill=`/`stroke=`.
Set `color` on an ancestor and inherit `currentColor` instead.


The shared logic layer. **Before writing new logic, check here — these helpers are the
single source of truth for their concern, and several encode invariants you'd otherwise get
wrong.** Utils live in [`app/utils/`](../app/utils/); **most** have a matching test in
`app/utils/__tests__/` (a few — `authGuards`, `revalidate`, `native`, `firebaseAdmin`,
`interface`, `Provider` — do not).

---

## `app/utils/` — reusable helpers

### Search & text
- **`normalizeText(s)`** ([normalizeText.ts](../app/utils/normalizeText.ts)) — accent- and
  case-insensitive folding (NFD → strip combining diacritics → lowercase). `"Adoración"` →
  `"adoracion"`. Does **not** strip punctuation/whitespace. Use for all Spanish search matching.
- **`slugifyAuthor(name)`** ([slugifyAuthor.mjs](../app/utils/slugifyAuthor.mjs)) — `.mjs`,
  shared with build scripts. Diacritic-strip + lowercase + slugify (non-alnum → `-`), cap 96.
  **Distinct from `normalizeText`** (that one doesn't slugify).

### Notifications & targeting
- **`assignedMemberRefsQuery(roleFilter)`**, **`addedAssignees(prev, next)`**,
  **`setlistRecipientIds(members, assignedIds)`**, **`tomorrowDateStr(tz, now?)`**
  ([notifyTargets.ts](../app/utils/notifyTargets.ts)) — the notification targeting layer.
  `assignedMemberRefsQuery` builds the GROQ covering all **five seats** (unique member ids);
  `roleFilter` is a **trusted code-owned** predicate — never pass user input. `setlistRecipientIds`
  treats an unset `setlist` pref as `"all"` (opted-in).
- **`sendPush(memberIds, category, payload)`** ([push.ts](../app/utils/push.ts)) — FCM multicast,
  filtered by per-category `notifPrefs`, **self-healing** (prunes dead tokens). Never throws.
  Categories: `assignments`/`setlist`/`proposals`/`reminders`.
- **`sendEmail({to, subject, html})`** ([email.ts](../app/utils/email.ts)) — low-level transport:
  SMTP (preferred, pooled single connection) or Resend fallback. **No-ops if neither is
  configured** (feature stays inert). `EMAIL_FROM` required.
- **assignment emails** ([assignmentEmail.ts](../app/utils/assignmentEmail.ts)) —
  `getAllowlist`/`isEmailAllowed` (default `"*"` = whole team), `wantsEmail` (opt-out: only
  explicit `false` = no), `buildAssignmentEmail`/`buildBatchAssignmentEmail` (Spanish HTML;
  batch collapses N services into one email), `sendAssignmentEmails`/`sendAssignmentEmailsBatch`,
  `appBaseUrl` (NEXTAUTH_URL → Vercel var → localhost). All best-effort. Honors `EMAIL_REDIRECT_TO`.
- **`notifyProposalSubmitted(...)`**, **`buildProposalEmail(...)`**
  ([proposalNotify.ts](../app/utils/proposalNotify.ts)) — on proposal submit, fans out push to
  admins + co-leads and email to admins. Every step swallowed so a notify never fails the write.
- **`firebaseAdmin.getMessaging()`** ([firebaseAdmin.ts](../app/utils/firebaseAdmin.ts)) — lazy
  singleton FCM init from `FIREBASE_SERVICE_ACCOUNT`.

### Caching
- **`revalidateServiceViews()`**, **`revalidateSongViews()`** ([revalidate.ts](../app/utils/revalidate.ts))
  — call after mutations or ISR pages stay stale. See [ARCHITECTURE §5](ARCHITECTURE.md#5-rendering--caching-model).

### Setlists & participation
- **`buildRuns(items)`**, **`normalizeMedleyTags(items, newTag)`** ([medley.ts](../app/utils/medley.ts))
  — medley grouping (positional/adjacency-based). Re-normalize after any reorder/remove.
- **`computeParticipation(roles)`** ([computeParticipation.ts](../app/utils/computeParticipation.ts))
  — per-member tally. Vocals counted per occurrence (Sun/Sat split); instruments/FOH counted as
  distinct **weeks** (Saturday normalized to the following Sunday). **Skips `special_role`.**
- **`summarizeUnfilledSeats(seats)`** ([unfilledSeats.ts](../app/utils/unfilledSeats.ts)) — parses
  solver `unfilled_seats` strings ("W2 Sunday Sun.Choir #2") into Spanish short-staffing labels,
  sorted by degradation severity (Lead → BGV → Choir).

### Dates & schedule
- **`scheduleMonths.ts`** — pure `YYYY-MM` month arithmetic (leaf module, no clock/React/Sanity):
  `parseMonthParam`, `addMonths`, `monthBounds`, `monthLabel`, `windowMonths`, `windowBounds`,
  `monthRangeLabel`, `scheduleHref`, `MONTH_NAMES_ES`, `WINDOW_MONTHS=3`. Reads via `Date.UTC` for
  TZ stability.
- **`ics.buildICS(events, calName?)`** ([ics.ts](../app/utils/ics.ts)) — minimal all-day `.ics`
  builder. **Timezone convention** (local-noon rendering, Mexico_City) is applied inline across
  utils/components; there is no single dateUtils module — see [ARCHITECTURE §10](ARCHITECTURE.md#11-timezone--dates).

### Content conversion
- **`textToBody(text)`**, **`bodyToLyrics(body)`**, **`groupBySections(blocks)`**
  ([lyrics.ts](../app/utils/lyrics.ts)) — plain-text ⇄ Portable Text (`# ` → h3, `**bold**`,
  `*italic*`, blank line → stanza break). Used by the song form and SongSheet.
- **`pickPracticeVideoUrl(song, mode)`**, **`extractYouTubeId(url)`** ([practiceVideo.ts](../app/utils/practiceVideo.ts))
  — practice-playlist video selection; robust 11-char YouTube id extraction.

### Proposals
- **`mergeContributor(existing, editorId, newKey)`**, **`describeContributors(contributors, myId)`**
  ([proposalContributors.ts](../app/utils/proposalContributors.ts)) — preserve contributor `_key`s
  + append the current editor once; "con Ana, Beto" label.

### Auth & access (also see [AUTH_AND_SECURITY.md](AUTH_AND_SECURITY.md))
- **`getMemberAccess(sanityId)`**, **`isMemberActive(sanityId)`** ([memberAccess.ts](../app/utils/memberAccess.ts))
  — 30s-TTL live access/role snapshot.
- **`requireActiveSession()`**, **`requireActiveManager()`** ([authGuards.ts](../app/utils/authGuards.ts)).
- **`verifyGoogleIdToken(idToken)`** ([googleIdToken.ts](../app/utils/googleIdToken.ts)) — native
  SSO token verification.
- **`MIDDLEWARE_MATCHER`**, **`middlewareRuns(pathname)`** ([routeMatcher.ts](../app/utils/routeMatcher.ts))
  — the tested mirror of the `proxy.ts` matcher (keep in sync).

### Gating
- **`publishedSetlist(role, setlist)`** ([draftGating.ts](../app/utils/draftGating.ts)) — returns
  the setlist only if the (published-filtered) role exists (prevents draft song-list leaks).
- **`computePublishTransitions(current, target)`** ([publishTransitions.ts](../app/utils/publishTransitions.ts))
  — `{ toPatch, toNotify }`; only `false → published` notifies.
- **`draftToDayCardProps`** ([draftToDayCardProps.ts](../app/utils/draftToDayCardProps.ts)) — maps
  a solver-generated draft service into `DayCard` props for preview.

### Mobile / accessibility
- **`native.ts`** — `isNativeApp()`, `nativeGoogleSilentIdToken()` (cold-start silent re-auth
  only if already logged in), `nativeGoogleIdToken()` (interactive).
- **`textZoom.ts`** — text-scale presets (`auto`/1.0/1.2/1.4/1.6), `getStoredMode`/`setStoredMode`
  (localStorage), `applyScale` (native `@capacitor/text-zoom` or web `-webkit-text-size-adjust`).
- **`focusTrap.ts`** (`trapTabTarget` pure tab math) + **`useFocusTrap.ts`** (WAI-ARIA dialog
  focus hook). **Any overlay with a dismissable scrim must use it** — a clickable full-bleed
  `bg-scrim` means content is stacked over a still-interactive page, so the overlay also needs
  `role="dialog"`, `aria-modal`, a name, and Escape. `dialogSemantics.test.ts` enumerates every
  such overlay and fails on one that skips this; `NOT_A_DIALOG` there holds the justified
  exemptions (today: `BottomNav`'s sheet, which uses `inert` instead). `CueDialog` uses the
  `trapTabTarget` primitive directly rather than the hook, because it also traps portalled
  satellite nodes.

### Colour inventory & token guards (light-mode migration, Child A1)
- **`scripts/colour-inventory.mjs`** — emits every colour decision in `app/**` (plus
  `tailwind.config.ts`, a named out-of-glob input) as stable, sorted JSON, each row
  dispositioned to the child that owns it: `B`, `C`, `D`, `keep` or `exempt`. Run
  `node scripts/colour-inventory.mjs`; `--stdout` prints without writing. **Importing the
  module is pure** — side effects run only when it is the entry point, because the guard
  imports it and an import that wrote the artifact would make the comparison vacuous.
  **This output supersedes every hand-count in the planning documents.**
- **`scripts/lib/strip-comments.mjs`** — blanks comments while preserving byte offsets, so a
  colour named in prose is never counted. Takes `{ syntax: "js" | "css" }`: `//` is a comment
  in JS/TS and is **not** one in CSS, where blanking to end-of-line would corrupt any
  `url(https://…)`. `protectedReadAudit.ts` re-exports it, so there is one implementation.
- **`__tests__/colourInventory.test.ts`** — fails when a live scan diverges from the committed
  artifact. Keyed on file + normalised utility + value, **never line numbers**, so an
  unrelated commit that shifts a line leaves it green by design. Also proves the scanner
  detects each category against a synthetic source.
- **`__tests__/brandCss.test.ts`** — structural guard for the token file. (a) every colour
  `var()` referenced across `app/**` + `tailwind.config.ts` is declared **in `brand.css`
  only** — `tailwind.config.ts` declares zero custom properties, so treating it as a
  declaration source would make the guard permanently green. (b) theme parity, **dormant**
  until `.light` declares its first custom property in Child D. Note `brand.css` is outside
  *lint* but not ungated: `admin/__tests__/participationAlongside.test.tsx` also pins it.

### Types & providers
- **`interface.tsx`** — shared domain TS interfaces (no runtime): `Post`, `Tag`, `Author`,
  `TeamMember`, `SundayRole`/`SaturdayRole`/`SpecialRole`, `SetlistProposal`, etc.
- **`Provider.tsx`** — client root provider: `SessionProvider` → `ThemeProvider`
  (`defaultTheme="system"`, `enableSystem={true}`) → **`ThemeBootstrap`**
  → `PlayerProvider` → `CueDialogProvider`.
  **`defaultTheme="system"` and `enableSystem={true}` are ONE change, in both directions.**
  With `enableSystem` false, next-themes resolves nothing for a `"system"` theme: it strips
  `light`/`dark` and adds a literal `system` class, leaving no theme class at all and no
  error. The default also exists in **three** places that cannot share a constant —
  here, `ThemeBootstrap`'s unset-with-a-mirror repair, and `THEME_MIGRATION_SCRIPT`'s
  `catch` — and `themeWiring.test.ts` asserts all three as a set.
- **`ThemeBootstrap.tsx`** — reads the member's `themePref` from `GET /api/me`, calls
  `setTheme` with it, and exposes the **literal** value (never the resolved theme) to
  `ThemeControl` via context. Wraps `children` rather than rendering beside them, because the
  control sits several layers below `Provider` and props cannot reach it. Skips the fetch
  entirely while impersonating, and gates on `useSession().status === "authenticated"`.
  Also swaps `<meta name="theme-color">` on the resolved theme, null-guarded because
  `(admin)/layout.tsx` exports no `viewport`.
- **`themePref.ts`** — the fetch/validate helper, `clearThemeMirror()`, and
  `THEME_MIGRATION_SCRIPT`. **Carries no `"use client"`** (both root layouts import the script
  constant as Server Components) and wraps every `localStorage` access, because
  `clearThemeMirror()` runs inside four sign-out `onClick` handlers where a throw would abort
  the handler before `signOut()`.

- **`ui/ThemeControl.tsx`** — the `/me` theme picker. **Three states:** Oscuro, Claro, and
  *never chosen* (neither button pressed) — an unset `themePref` is Child F's cohort signal
  and no route can restore it, so the control must not write on mount. Binds to the literal
  `themePref` from `ThemeBootstrap`'s context, never to `resolvedTheme` (which is `"dark"` for
  an explicit-Dark member and an unset one alike). **PATCHes first and paints only on
  `res.ok`** — an optimistic paint whose write failed would strand the member in a theme they
  never persisted, with no later load able to correct it. Hidden while impersonating.

**Two PWA remnants, recorded together.** `appleWebApp.statusBarStyle` stays
`black-translucent`: it is what makes the WebView extend under the iOS status bar, and every
light-appropriate value is non-translucent, so swapping it would collapse
`env(safe-area-inset-top)` and move `Navbar`/`CueDialog`/`PlannerGrid` on every toggle —
geometry, not colour. And `manifest.webmanifest`'s `theme_color` is read at install time and
cannot follow a runtime theme. **So an installed iOS PWA keeps dark chrome in light mode.**
Both are fixed by the iOS work, not by a colour change.

**Three client-side storage keys**, none a secret, all persistent state worth not
"cleaning up": **`theme`** is next-themes' own mirror — a paint cache, not the source of
truth (`themePref` on the member document is), cleared at sign-out so a shared device does
not show one member's theme to the next; and **`owt-theme-migrated`** is the one-time flag for
the legacy-mirror reconciliation that runs before the seed in both root layouts; and
**`owt-theme-announced`** is Child F's per-device dismissal flag for the `/me` banner, which
writes nothing to Sanity and fails soft toward showing the banner again.

---

## `app/context/` — the single global context

**`PlayerContext.tsx`** ([PlayerContext.tsx](../app/context/PlayerContext.tsx)) — exposed via
`PlayerProvider` + `usePlayer()` (throws outside the provider). Holds two feature areas:
- **Audio player** — one shared `HTMLAudioElement`; `player: {track, isPlaying}` +
  `playTrack`/`togglePlay`/`closePlayer`/`seek`/`getAudio`.
- **Song sheet overlay** — `sheet`/`sheetLoading`/`sheetError`/`sheetPlayKey` +
  `openSheet(songId, playKey?)` (fetches `/api/song/{id}`) / `closeSheet`.

**Performance note:** the value is `useMemo`'d over state + stable callbacks so the ~140 song
cards don't all re-render on every provider render. Consumers: `AudioPlayer`, `DayCard`,
`SongSheet`, `PostComponent`, `SongAudioSection`.

---

## `app/components/` — inventory (41 files: 31 top-level + 10 admin panels)

Legend: **[C]** client, **[S]** server.

### Songs (browse / play / sheet)
| Component | Purpose |
|-----------|---------|
| `PostComponent` [C] | Single song card in the grid (memoized; renders ~140×). |
| `SongSearchList` [C] | Searchable song grid (`normalizeText`). |
| `SongSheet` [C] | Full lyrics + chords overlay (PortableText, focus-trapped, play-history) — driven by `PlayerContext`. |
| `ChordChart` [C] | ChordPro parser/renderer. Exports **`transposeChord(chord, semitones)`** + capo suggestions. Tested. |
| `SongAudioSection` [C] | A song's audio tracks, wired to the player. |
| `AudioPlayer` [C] | Global bottom audio bar (scrub/time). |
| `PracticePlaylistButton` [C] | Opens a YouTube playlist for a setlist (`musica`/`letras`). |
| `AuthorSearchList` / `TagSearchList` [C] | Author / tag indexes with search. |

### Services / setlists (member-facing)
| Component | Purpose |
|-----------|---------|
| `DayCard` [C] | **The core service card** — setlist (medley-grouped via `buildRuns`) + all five seats; embeds `SetlistEditor` for admins + `PracticePlaylistButton`. |
| `NextServiceHero` [C] | Countdown badge ("Hoy"/"Mañana"/"En N días"). Exports **`daysUntil(dateStr, now?)`** (local-noon day diff). Tested. |
| `CalendarView` [C] | Schedule calendar grid; Mexico_City "today" highlight. |
| `AvailabilityCalendar` [C] | Member self-service unavailability picker. |
| `AddToCalendarButton` [C] | Downloads `.ics` of the member's assignments. |
| `ChainLinkIcon` [S] | Medley-link row icon. |

### Members / profile / navigation
| Component | Purpose |
|-----------|---------|
| `ProfilePanel` [C] | Member self-profile (alias, photo, password, notif prefs); focus-trapped. |
| `ImpersonationBanner` [C] | Banner + "stop impersonating" when `session.user.isImpersonating`. |
| `ActivityPing` [C] | "Last seen" ping, ≤ once / 30 min. |
| `Navbar` [S] | Top navbar shell; deliberately **non-async** (session resolved client-side) so pages stay ISR-renderable. |
| `NavMenu` [C] | Nav menu + notification badge. |
| `BottomNav` [C] | Mobile bottom tab bar. |
| `SectionNav` [C] | In-page section anchors. |
| `Header` [S], `CmsNavbar` [S], `icons.tsx` [S] | Page header / Studio navbar / SVG icons. |
| `SignOutButton` [C] | Sign out. Clears the theme mirror first — see `themePref.ts`. (`ThemeSwitch` was deleted in `33c6e15`; the theme picker is now `ui/ThemeControl.tsx` at `/me`.) |
| `NativeAuthBootstrap` [C] | Native cold-start silent Google re-auth. |
| `TextScaleBootstrap` [C] / `TextSizeControl` [C] | Apply stored text scale / segmented size control. |

### Admin panels (`app/components/admin/`, all [C])
| Component | Purpose |
|-----------|---------|
| `AdminPanel` | Root admin shell: tabs + member management (Fuse.js search, add/edit modal, role-gated). |
| `ServicesPanel` | Service-readiness cards plus card-owned delete/copy/publish/setlist/proposal flows. Owns the canonical roles/integrity source bundle and opens `MonthGenerator` for **Editar mes**, card roster edits, and **Nuevo**. The editor replaces the tab with a full-width panel rather than a dialog. |
| `seatModel` | Canonical seat names and categories; one spelling per seat. Pure. |
| `candidateRanking` | Seat candidates ordered by availability, existing assignment and recent load. Pure; never calls the solver. |
| `plannerModel` | Pure month-grid rows/columns/cells plus create-solver translations (`buildSolveRequest`/`applySolveResponse`) and participant/draft projections. Stored columns use role-ID `columnId` and keyed occupants; stored admission/translation lives in `storedRoleReadModel`. Owns Saturday↔week adjacency (never position) and the Sunday-only Coro row. |
| `PlannerGrid` | Renders the month grid `plannerModel` computes — dates across and seats down. Applicable admitted cells are editable; integrity-defective stored columns stay visible and read-only. `MonthGenerator` owns `cells`/`counts` and mutations. Owns the **three-column workspace**: Participaciones (216px), grid, and candidate picker (240px while a cell is active). The chart width is a content floor derived from `ParticipationSidebar`. **Pantalla completa** manages focus, traps Tab, locks body scroll, `inert`s the rest of `<body>`, applies safe-area padding, and portals to `document.body` for Safari. The grid scrolls horizontally rather than squeezing its `minmax(150px, 1fr)` date columns; row labels remain sticky. Its `planner-wide` root lets `app/brand.css` lift the admin frame cap through `:has()`. |
| `MonthGenerator` | Owns create-planning and stored editing in the shared three-part `PlannerGrid`. Create mode retains solver preview/Auto and fairness history. Stored mode owns create-one, explicit full-roster save, date/name edits, team/seat swaps, frozen attempts, and roles/integrity readback reconciliation. |
| `SetlistEditor` | Inline setlist builder (reorder/remove, play-key, medley via `normalizeMedleyTags`). |
| `SongFormModal` | Song create/edit form + reusable `Modal`. Exports `Modal`, `SongForm`, `blankForm`, `songToForm`, `buildPayload`. |
| `ContentPanel` | Song-library CRUD (via `SongForm`). |
| `ProposalsPanel` | Admin review of lead proposals (approve / request changes / reopen). |
| `AvailabilityPanel` | Team availability vs. scheduled services. |
| `ActivityPanel` | Member activity / last-login ("Hoy"/"Ayer" calendar-day labels). |
| `ParticipationSidebar` | Participation bar chart (`computeParticipation`); Voces/Instrumentos toggle. Header is a stacked block with a `w-full` select — beside the title the select's longest option ("Instrumentos") overflowed the 216px chart column onto the grid. |

#### Service-readiness card layer

Rendered inside `ServicesPanel`. These decide **nothing** — every decision is made by the pure
modules beside them. See [`SERVICE_READINESS_UI.md`](SERVICE_READINESS_UI.md).

| Component | Purpose |
|-----------|---------|
| `ServiceReadinessCard` | One service card; maps over `CARD_SECTIONS` (the constant *is* the render order). |
| `ReadinessBadge` | One icon + text + tone chip. Colour is never the only carrier of meaning. |
| `ServiceIssueList` | Blocking-issue lines, truncated to 4 + "y N problema(s) más". |
| `ServicePrimaryAction` | The single primary-action button; emits `data-action-kind`/`-rule`. |
| `IntegrityQueuePanel` | Standalone "Integridad de datos" panel; fetches the three service-integrity routes itself. |

Their pure counterparts, also in `app/components/admin/`: `serviceReadiness.ts` (the dimensions,
the 15-rule ladder, per-control gating), `serviceCardModel.ts` (card assembly + Spanish copy),
`serviceIntegrityQueue.ts`, `serviceSourceState.ts`, `publishSelection.ts`, `proposalHandoff.ts`,
`applyRefreshedRole.ts`, and the `serviceHandoffContext.tsx` context.

`EditSongButton` [C] (top-level) — inline "edit song" affordance on song pages; role-gated; uses
`bodyToLyrics`. Subject to the **multi-chord-chart collapse landmine**.

---

## Tests

**153 test files / 3,721 tests** (129 under `app/` + 15 under `scripts/` + 9 harness unit
tests under `e2e/service-readiness/__tests__/`).
Separately, **11 Playwright specs** under `e2e/service-readiness/` run only against the isolated
verification deployment and are **not** part of `npm test` — see
[`VERIFICATION_HARNESS.md`](VERIFICATION_HARNESS.md). Vitest (`environment: "node"`) covers
`app/**/*.test.{ts,tsx,mjs}` and `scripts/**`. Highlights: `notifyTargets` (all five seats), `medley`, `computeParticipation`,
`unfilledSeats`, `assignmentEmail`, `push`, `memberAccess` (TTL), `googleIdToken`, `draftGating`,
`publishTransitions`, `lyrics` round-trip, `ics`, `scheduleMonths`, `routeMatcher` (login-gate
bypass), `focusTrap`/`useFocusTrap` (jsdom), plus `daysUntil` and `transposeChord` in
`app/components/__tests__/`. A `.test.tsx` needing a DOM sets up jsdom itself (the default env is
`node`). Run with `npm test`.
