# Utilities, Context & Components

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
  utils/components; there is no single dateUtils module — see [ARCHITECTURE §10](ARCHITECTURE.md#10-timezone--dates).

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
  focus hook).

### Types & providers
- **`interface.tsx`** — shared domain TS interfaces (no runtime): `Post`, `Tag`, `Author`,
  `TeamMember`, `SundayRole`/`SaturdayRole`/`SpecialRole`, `SetlistProposal`, etc.
- **`Provider.tsx`** — client root provider: `SessionProvider` → `ThemeProvider` (dark default,
  `enableSystem={false}`) → `PlayerProvider`.

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
| `ThemeSwitch` [C], `SignOutButton` [C] | Theme toggle / sign out. |
| `NativeAuthBootstrap` [C] | Native cold-start silent Google re-auth. |
| `TextScaleBootstrap` [C] / `TextSizeControl` [C] | Apply stored text scale / segmented size control. |

### Admin panels (`app/components/admin/`, all [C])
| Component | Purpose |
|-----------|---------|
| `AdminPanel` | Root admin shell: tabs + member management (Fuse.js search, add/edit modal, role-gated). |
| `ServicesPanel` | Per-week roster editor (assign seats, medley-aware setlist). Embeds `ParticipationSidebar` + `MonthGenerator`. (~79 KB, the biggest surface.) |
| `MonthGenerator` | Auto-scheduler UI — sends `SolveRequest` to `/api/admin/solve`, previews draft `DayCard`s (`draftToDayCardProps`), summarizes short-staffing (`summarizeUnfilledSeats`). |
| `SetlistEditor` | Inline setlist builder (reorder/remove, play-key, medley via `normalizeMedleyTags`). |
| `SongFormModal` | Song create/edit form + reusable `Modal`. Exports `Modal`, `SongForm`, `blankForm`, `songToForm`, `buildPayload`. |
| `ContentPanel` | Song-library CRUD (via `SongForm`). |
| `ProposalsPanel` | Admin review of lead proposals (approve / request changes / reopen). |
| `AvailabilityPanel` | Team availability vs. scheduled services. |
| `ActivityPanel` | Member activity / last-login ("Hoy"/"Ayer" calendar-day labels). |
| `ParticipationSidebar` | Participation bar chart (`computeParticipation`); Voces/Instrumentos toggle. |

`EditSongButton` [C] (top-level) — inline "edit song" affordance on song pages; role-gated; uses
`bodyToLyrics`. Subject to the **multi-chord-chart collapse landmine**.

---

## Tests

32 test files (27 under `app/` + 5 under `scripts/`). Vitest (`environment: "node"`) covers
`app/**/*.test.{ts,tsx,mjs}` and `scripts/**`. Highlights: `notifyTargets` (all five seats), `medley`, `computeParticipation`,
`unfilledSeats`, `assignmentEmail`, `push`, `memberAccess` (TTL), `googleIdToken`, `draftGating`,
`publishTransitions`, `lyrics` round-trip, `ics`, `scheduleMonths`, `routeMatcher` (login-gate
bypass), `focusTrap`/`useFocusTrap` (jsdom), plus `daysUntil` and `transposeChord` in
`app/components/__tests__/`. A `.test.tsx` needing a DOM sets up jsdom itself (the default env is
`node`). Run with `npm test`.
