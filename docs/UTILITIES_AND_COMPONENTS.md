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
`app/utils/__tests__/` (a few — `revalidate`, `native`, `firebaseAdmin`,
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
  admins + co-leads and email to admins. The admin email includes the proposed setlist (same
  table as "Setlist listo", no Mov. column) and lead notes when present; push stays one-line.
  Every step swallowed so a notify never fails the write.
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
- **`songSections(post, historyCount)`** ([songSections.ts](../app/utils/songSections.ts)) —
  which of the five sections a song page paints (audio / tutoriales / referencia / letra /
  historial), in page order. One list decides three things: whether `SectionNav` renders
  (more than one), which `<section>`s render, and whether the "aún no tiene contenido" state
  does (none). **Count lengths, never truthiness** — `post.body` is an array, so `!![]` is
  true, and `[]` is exactly what clearing the "Letra" field stores.

### Dates & schedule
- **`daysUntil(dateStr, now?)`**, **`formatCountdown(days)`** ([daysUntil.ts](../app/utils/daysUntil.ts))
  — the service countdown, in a neutral module with no imports/hooks so a Server Component may
  call it. `daysUntil` pins "today" to America/Mexico_City (`toLocaleDateString("sv", …)`), not
  the runtime's local date — Vercel is UTC, so reading the bare local date would misreport the
  team's evening as still a day away. `formatCountdown` reads a negative diff as "Hace N días"
  rather than "En -N días". Consumers: `NextServiceHero`, `DayCard`'s header pill, `DayCardDisclosure`'s collapsed line.
- **`nextWeekends(todayIso, count)`**, **`weekendLabel(weekend)`** ([weekends.ts](../app/utils/weekends.ts))
  — the ten rows `WeekendList` offers (R3), also neutral and CDMX-pinned (local noon, never a bare
  `new Date(iso)`). `nextWeekends` counts the CURRENT weekend while its Sunday is still ahead, so a
  member opening `/me` on the Saturday or Sunday they are living through still sees that row first
  rather than the one after it. `weekendLabel` renders one line — «12 – 13 sep», or «31 oct – 1 nov»
  when the two days cross a month.

### Library (R1)
- **`libraryIndex.ts`** ([libraryIndex.ts](../app/utils/libraryIndex.ts)) — pure `/biblioteca`
  logic, neutral (no React) so the Server Component page and the client index share one truth:
  `parseLibraryParams`/`serializeLibraryParams` (the `?q=`/`?tag=`/`?author=`/`?key=` URL
  contract), `searchPosts` (≤2 chars → accent-folded substring with a per-word artist-prefix
  narrowing, prefix-first; 3+ chars → Fuse, prefix-first — the former `SongSearchList`
  algorithm, moved here with that one narrowing), `artistOf` (the legacy `author` string
  plus every `authors[].name`, joined — the ONE flat field both branches search, since Fuse's
  `getFn` reads only `path[0]` and a nested `authors.name` key would read nothing),
  `applyLibraryFilters` (query first when
  present since it carries a relevance order, filters first and A–Z last otherwise),
  `groupByLetter`, `libraryKeys`, `TIPO_SLUGS`.
- **`scheduleMonths.ts`** — pure `YYYY-MM` month arithmetic (leaf module, no clock/React/Sanity):
  `parseMonthParam`, `addMonths`, `monthBounds`, `monthLabel`, `windowMonths`, `windowBounds`,
  `monthRangeLabel`, `scheduleHref`, `MONTH_NAMES_ES`, `WINDOW_MONTHS=3`. Reads via `Date.UTC` for
  TZ stability.
- **`agenda.ts`** ([agenda.ts](../app/utils/agenda.ts)) — pure `/schedule` logic (R2, neutral, no
  React): **`findDuplicates(names)`** (moved here from `DayCard`, which still imports it) is the
  ONE same-section-repeat check, so `DayCard`'s ⚠ marks and the agenda's conflict count can never
  disagree; **`serviceConflicts(entry)`** sums it over voces/instrumentos/foh separately (a person
  seated in two different sections is not a conflict, only a repeat within one), with
  **`conflictLabel(n)`** as the one "N conflicto"/"N conflictos" plural rule the row's chip and its
  `aria-label` both read. `serviceTone`, `summarizeService`, `agendaRows` (ordering + month breaks
  + the summary/conflict fields, sorted Sábado → Domingo → especial within a date) back
  `AgendaView`; `mondayOf`/`addDays`/`weekStripDays`/`monthStripDays` are the day-strip's UTC date
  arithmetic (`monthStripDays` is unused by any component since the strip became week-only, but
  keeps its tests). **`myNameFromSession(user)`** (F1) is the ONE reader of `session.user.alias`/
  `.name` — `DayCard` calls it too, so the two surfaces can never disagree on who "you" is;
  **`mySeats(entry, myName)`** returns the seat labels a member holds in one service, in
  `DayCard`'s own order (Lead, BGVs, Coro, each instrument, each FOH seat) — it backs `AgendaView`'s
  `Tú · Lead, Keys` pill and `weekStripDays`/`monthStripDays`'s optional `myName` argument, which
  flags `StripDay.mine` for `DayStrip`'s «you» dot.
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
- **`parseProposalMessageRequest`**, **`buildProposalMessage`**, **`isLeadNote`**,
  **`LEAD_NOTE_MESSAGES`**, `PROPOSAL_MESSAGE_KINDS`, `PROPOSAL_MESSAGES_MAX`
  ([proposalMessageWrite.ts](../app/utils/proposalMessageWrite.ts)) — the thread's write side, pure.
  `isLeadNote` and the `LEAD_NOTE_MESSAGES` GROQ fragment are the SAME predicate on the two sides
  of the debounced email, cross-pinned by executing the fragment against the function
  (`__tests__/leadNoteProjection.test.ts`) — do not add a third copy.
- **`THREAD_MESSAGES`**, **`THREAD_AFTER_APPEND_QUERY`**
  ([proposalMessageRead.ts](../app/utils/proposalMessageRead.ts)) — the thread as the surfaces read
  it, with author names joined. `author` is optional: two migrated `admin_notes` have nobody to
  attribute them to.
- **`isThreadOpen({serviceDate})`** ([proposalThread.ts](../app/utils/proposalThread.ts)) — the
  conversation closes when the SERVICE passes, not on approval. Enforced server-side in both
  message routes; a hidden composer is not a guard. The transition is deliberately exempt.
- **`PROPOSAL_NOTES_MAX`** ([proposalNotesLimit.ts](../app/utils/proposalNotesLimit.ts)) — 4000
  chars per message. A leaf so both the client and the pure write path can read it.

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
- **`paintsDayCard(card)`** ([paintsDayCard.ts](../app/utils/paintsDayCard.ts)) — whether a
  `DayCard` will render anything or return `null`. `DayCard` guards on it and the home
  page asks it before choosing between the "Esta semana" grid and an empty state, so the
  two can never disagree. Every key is required, so a call site that forgets one fails to
  compile. **It lives in `utils/`, not in `DayCard.tsx`, and must stay there:**
  `DayCard.tsx` is `"use client"` and the home page is a Server Component, so importing
  the predicate from the component hands back a client reference rather than the
  function. That took `/` down in production on 2026-09-02 — see
  [ADR-0028](adr/0028-shared-predicates-live-outside-client-modules.md).

### Unsaved-work fingerprints
Two editors warn before discarding work, and each compares a stable fingerprint of the
state a save actually persists against the last saved one.
- **`snapshot(dates, notes)`** ([useAvailability.ts](../app/components/availability/useAvailability.ts))
  — feeds `dirty`, the "Cambios sin guardar" marker and the `beforeunload` guard. It lives in
  the hook that owns the availability edits and the revision-guarded save, not in the views
  that draw them: `MyAvailabilityPanel` calls `useAvailability` ONCE and passes that state to
  `WeekendList` and to `AvailabilityGrid`, which keeps only its paging.
- **`proposalSnapshot(songs, teamNotes, leadNotes, proposalId)`**
  ([ProposalEditor.tsx](../app/\(client\)/me/propose/[roleId]/ProposalEditor.tsx)) — the same
  job for the setlist proposal editor. Takes the proposal id because `lead_notes` is only
  sent while no proposal document exists, so it must leave the fingerprint at exactly the
  moment it leaves the payload.

### Popover placement
- **`popoverPosition(rect, viewportW, viewportH)`**
  ([NotePopover.tsx](../app/components/availability/NotePopover.tsx)) — placement for the
  availability note popover, pure so the flip and the clamps are testable (jsdom reports
  every rect as zero). The popover recomputes from its anchor (a weekend toggle's «Razón»
  button or a grid day) on scroll; it must NOT close on scroll, because the mobile keyboard
  fires scroll and resize.

### Mobile / accessibility
- **`native.ts`** — `isNativeApp()`, `nativeGoogleSilentIdToken()` (cold-start silent re-auth
  only if already logged in), `nativeGoogleIdToken()` (interactive).
- **`textZoom.ts`** — text-scale presets (`auto`/1.0/1.2/1.4/1.6), `getStoredMode`/`setStoredMode`
  (localStorage), `applyScale` (native `@capacitor/text-zoom` or web `-webkit-text-size-adjust`).
- **`useTransientValue.ts`** — `[value, show, reset, hold] = useTransientValue(idle, ms)`. A
  value that reverts to `idle` after `ms`: every toast and the availability calendar's
  "Guardado ✓". **Use it instead of `setTimeout(() => setToast(null), …)`** — eight sites had
  hand-rolled that and all eight leaked the timer, so a second toast inside the window
  inherited the first one's clock. The costly pair is success-then-error: the error is the
  message that flashes and disappears, and the toast is often the only signal a mutation
  failed. A ninth, `MonthGenerator`'s swap toast, was not ONLY that pattern — it mixes transient
  and persistent messages through one slot, and briefly lost its persistent ones to a blanket
  conversion (caught in review).
  - `reset` returns to idle now and cancels the timer, for invalidation that is not time-based.
  - `hold` shows a value that must PERSIST until something replaces it, cancelling any pending
    timer. Reach for it when dismissing the message would destroy information — a report that a
    write landed but could not be verified, or a recovery control rendered inside the message.
  - NOTE: all three callbacks are `useCallback`s, not `useState` setters — ESLint cannot assume
    they are stable, so name them in an effect's dependency array.
- **`focusTrap.ts`** (`trapTabTarget` pure tab math) + **`useFocusTrap.ts`** (retired
  2026-09-09 — no production consumer since M0b-1; kept because `app/utils/__tests__/
  dialogSemantics.test.ts` accepts `useFocusTrap` or `trapTabTarget` as proof of focus
  management). **Any overlay with a dismissable scrim must be focus-managed** — use
  `CueDialog`; a bespoke overlay may call `trapTabTarget` directly. A clickable full-bleed
  `bg-scrim` means content is stacked over a still-interactive page, so the overlay also
  needs `role="dialog"`, `aria-modal`, a name, and Escape. `dialogSemantics.test.ts`
  enumerates every overlay drawn with a clickable `bg-scrim` and fails on one that skips
  this (per file, and keyed to that token — see its header for what it cannot see);
  `NOT_A_DIALOG` there holds the justified exemptions (none today — `BottomNav`'s sheet
  became a `CueDialog` in M1 and its exemption went with it).

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
rows don't all re-render on every provider render. Consumers: `AudioPlayer`, `DayCard`,
`SongSheet`, `LibraryRow`, `SongAudioSection`.

---

## `app/components/` — inventory (65 files: 32 top-level + 20 admin + 7 kids + 6 ui)

Legend: **[C]** client, **[S]** server.

### Songs (browse / play / sheet)
| Component | Purpose |
|-----------|---------|
| `SongSheet` [C] | Full lyrics + chords overlay (PortableText, focus-trapped, play-history) — driven by `PlayerContext`. |
| `ChordChart` [C] | ChordPro parser/renderer. Exports **`transposeChord(chord, semitones)`** + capo suggestions. Tested. |
| `SongAudioSection` [C] | A song's audio tracks, wired to the player. |
| `AudioPlayer` [C] | Global bottom audio bar (scrub/time). |
| `PracticePlaylistButton` [C] | Opens a YouTube playlist for a setlist (`musica`/`letras`). `variant?: "inline" \| "hero"` is chrome only — the menu, popup reservation and failure states are shared; `inline` is the accent pill on the Setlist rail, `hero` is the run sheet's one primary action (the house `Button`, label "Ensayar"). |

### Library (`/biblioteca`, R1 — pure logic in `libraryIndex.ts`, above)
| Component | Purpose |
|-----------|---------|
| `LibraryIndex` [C] | The `/biblioteca` client index: search console, A–Z sections of `LibraryRow`s via `AnimatedList`, the `LibraryLetterRail` after the sections, and `LibraryFilters`. Owns the ONE `IntersectionObserver` over the `h2#letra-*` headings that tells the rail which letter is in view (band from 64 px to 30 % of the viewport; the last heading above it wins when none intersects), and mirrors its own filter state into the URL with `history.replaceState` (never the router — a `router.replace` would re-run the Server Component's fetch on every keystroke); replaced `SongSearchList`/`PostComponent`. |
| `LibraryLetterRail` [C] | The A–Z rail as an iOS-style **index bar** (F3): `active` (from the index's observer) is accent + `font-semibold` + `aria-current`, and a pointer drag SCRUBS — the letter under the finger by arithmetic on the rail's box, `behavior: "auto"` while moving and `"smooth"` on a plain tap, `haptic("selection")` per letter, `touch-none`, and a `data-scrubbing` pill for the finger to hold. Plain `<button>`s by the recorded row exemption. |
| `LibraryRow` [C] | One song row: key · title/artist · BPM · tags. A plain `<button>` in an `<li>`, not the `Button` primitive — the recorded row exemption (`DayCard`'s setlist rows precedent): the row IS the affordance. Memoized (~140 rows). |
| `LibraryFilters` [C] | The filter drawer (`CueDialog` sheet): Tipo as three `SegmentedControl` tiles plus a «Todos» clear tile, then **searchable** chip clouds for Temas (multi-select) and Artista (single-select, the twelve busiest shown before a query, `Select` retired in F3) — both sized by `postCount`, both pinning a selected chip to the front when it does not match the query. Tonalidad keeps its `Select`. Replaced `AuthorSearchList`/`TagSearchList`. |

### Services / setlists (member-facing)
| Component | Purpose |
|-----------|---------|
| `DayCard` [C] | **The core service card / R1 run-sheet card** — day · date header, countdown pill, setlist (medley-grouped via `buildRuns`) + all five seats; embeds `SetlistEditor` for admins + `PracticePlaylistButton`. `layout?: "card" \| "wide"` — `wide` puts setlist and team side by side from `lg` (only when both a setlist AND a team are present); `hero?: boolean` makes the card the page's one primary action, `PracticePlaylistButton variant="hero"` ("Ensayar") in the header, dropping the inline pill from the Setlist rail so the affordance never repeats. Its ⚠ duplicate-seat marks read `findDuplicates` from `app/utils/agenda.ts` (R2 — moved out of this file so the schedule agenda's conflict count can never disagree with the card's own marks). |
| `DayCardDisclosure` [C] | A non-next service on `/`, collapsed to one line (day · date · countdown) that opens a `Collapse` onto its `DayCard`. |
| `NextServiceHero` [C] | Countdown badge ("Hoy"/"Mañana"/"En N días"). Imports `daysUntil`/`formatCountdown` from `app/utils/daysUntil.ts`. |
| `ScheduleHeader` [C] | **The `/schedule` month header (R2)** — `‹ MES AÑO ›` icon-button arrows (`Button variant="icon"` with `href`, so paging is a `?m=` navigation carried by the route reveal, one month per press) around a truncating `h2` that is now the route's own heading; below it, a jump-to-any-month `DateField` (no `onStep` — the arrows already own "Mes anterior"/"Mes siguiente") plus a «Hoy» reset while browsing. The rolling (default) view adds a «Próximos» sublabel under the month. |
| `DayStrip` [C] | **The `/schedule` WEEK strip (R2)** — seven cells (`grid-cols-7`), every day of the visible week rendered but only service days pressable; opens on today's week (or the anchor month's first day's week, `mondayOf(anchorMonth + "-01")`, when today falls outside that month). A `SwipeStrip` drag pages the week client-side (`onWeekChange` scrolls the agenda to it); the header's arrows page the month instead — two axes, two gestures. Today's dot pulses once on reveal. Cells share the month grid's tone classes so the two views can't disagree about what a colour means. **F1:** an optional `myName` prop (from `CalendarView`'s `myNameFromSession`) flags a seated, lit day with a second positive dot under the number (`StripDay.mine`). |
| `AgendaView` [C] | **The `/schedule` agenda (R2, default view)** — service days only, one row each, under a month divider: day · short date, an upcoming-only countdown pill, who leads and how many songs, `⚠ N conflicto(s)`. All ordering/summary/conflict arithmetic lives in `app/utils/agenda.ts`'s `agendaRows`; a special service names itself in the row (Sábado/Domingo don't). Rows open the same day `CueDialog` sheet as the month grid. **F1:** its own `useSession` (same pattern as `DayCard`) plus `mySeats` pill a `Tú · Lead, Keys` badge and glow the tone rail on a row where the signed-in member is seated; `aria-label` gains `, te toca: Lead, Keys`. |
| `CalendarView` [C] | **The `/schedule` host, composition only (R2)** — `ScheduleHeader`, `DayStrip`, an Agenda\|Mes `SegmentedControl` (agenda default), then `AgendaView` or the three-month grid (Mexico_City "today" highlight, unchanged), and the shared day-sheet `CueDialog`. The mode switch is a plain keyed `Presence` fade (no stacked panels — neither view has a fixed height), `appear` only after the reader actually flips the control so first paint renders at rest. The retired «Lista» mode (full `DayCard`s stacked per weekend) is gone; the agenda replaces it. **F1:** derives `myName` once via `myNameFromSession(session?.user)` and passes it to `DayStrip`. |
| `availability/MyAvailabilityPanel` [C] | **`/me`'s availability host (R3)** — renamed off `AvailabilityPanel` in fix round 1, which shared its name with the unrelated admin `AvailabilityPanel` below (different directory, different job): calls `useAvailability` once and renders `WeekendList`, the shared «Repetir…» recurring panel, «Guardar» (`busy`/`busyLabel`; success is a `useToast` "Guardado ✓", not an inline flash), the dirty/error/held-conflict notices, the `AvailabilityGrid` behind a «Ver calendario» `Collapse`, and the one `NotePopover` both surfaces open. «Quitar serie» calls `closeNote()` before dropping the recurring pattern, so a popover pinned to a date the series just removed cannot outlive it. |
| `WeekendList` [C] | **`/me`'s default availability surface (R3)** — the next ten weekends from `nextWeekends(todayIso, 10)`, each a «12 – 13 sep» row with `SÁB`/`DOM` `Button variant="pill" tone="availability" size="lg"` toggles (`aria-pressed` = «no puedo»; the 44 px touch target also applies to the «Razón» ghost) and a service dot on a day in `serviceDates`. A day already in the past renders `disabled` — it is not a toggle. Toggling fires `haptic("selection")`. |
| `AvailabilityGrid` [C] | **The twelve-month grid (R3)**, moved to `app/components/availability/AvailabilityGrid.tsx` in fix round 1 (was `app/components/AvailabilityCalendar.tsx`) — a controlled view (`state`, `serviceDates`, `openNote`, `closeNote`, `noteIso`) behind `/me`'s «Ver calendario» disclosure, for what ten weekend rows cannot say. Owns paging only. |
| `NotePopover` [C] | **The «Razón» note editor (R3)** — one non-modal positioned field per panel (never a `CueDialog`: nothing underneath goes inert), owned by `MyAvailabilityPanel` so `useAvailability`'s `onAdopt` can close it in the same update a conflict adopts the server's dates. Exports `popoverPosition` and `fmtDayLabel`. |
| `AddToCalendarButton` [C] | Downloads `.ics` of the member's assignments. |
| `ChainLinkIcon` [S] | Medley-link row icon. |

### Members / profile / navigation
| Component | Purpose |
|-----------|---------|
| `ProfilePanel` [C] | Member self-profile (alias, photo, password, notif prefs); focus-trapped. |
| `ImpersonationBanner` [C] | Banner + "stop impersonating" when `session.user.isImpersonating`. |
| `ActivityPing` [C] | "Last seen" ping, ≤ once / 30 min. |
| `Navbar` [S] | Top navbar shell; deliberately **non-async** (session resolved client-side) so pages stay ISR-renderable. |
| `NavMenu` [C] | Account menu (Mi perfil, Tema, Cerrar sesión) + notification badge (the badge pops in on `Presence appear variant="scale"`). |
| `BottomNav` [C] | Mobile bottom tab bar — three worship tabs (Inicio · Calendario · Biblioteca) or the kids set; «Más» only when Kids / Planear Kids / Admin apply; hidden when fewer than two items; «Más» is a `CueDialog` sheet. Publishes its measured height as `--bottom-nav-h` + a `has-bottom-nav` class on `<html>` while on screen; hidden ≥ `lg` and on `/auth*`/`/studio*`. |
| `NavLinks` [C] | Desktop nav link row, rendered in the navbar's centred title block at `lg`+ (the title itself goes `lg:hidden` there); one shared `SlidingIndicator` underline. |
| `SectionNav` [C] | In-page section anchors. |
| `CmsNavbar` [S], `icons.tsx` [S] | Studio navbar / SVG icons. (`Header` [S], the old page-header component with a `/tag` link, was deleted in R1 — zero importers since `Navbar` replaced it.) |
| `SignOutButton` [C] | Sign out. Clears the theme mirror first — see `themePref.ts`. (`ThemeSwitch` was deleted in `33c6e15`; the theme picker is now `ui/ThemeControl.tsx` at `/me`.) |
| `NativeAuthBootstrap` [C] | Native cold-start silent Google re-auth. |
| `TextScaleBootstrap` [C] / `TextSizeControl` [C] | Apply stored text scale / segmented size control. |

### Motion primitives (`app/components/ui/`, see [MOTION.md](MOTION.md))
| Component | Purpose |
|-----------|---------|
| `MotionProvider` [C] | Loads `motion`'s DOM features (`domMax`) as an async chunk after hydration (not inline); `reducedMotion="user"`. |
| `Presence` [C] | Mount/unmount with an exit animation; variants `fade` `rise` `scale` `sheet` `drop`. `sheet` enters on `SPRINGS.sheet` (every other variant, and every exit, stays on the ordinary duration/ease). `onEntered?: () => void` fires once the enter animation completes — never on an already-shown mount without `appear`. |
| `Skeleton` / `SkeletonGroup` [N] | Shimmer placeholders; one `aria-busy` status region per loading surface. |
| `Button` [N] | The house button: six variants, three sizes, press physics, primary sheen, `busy`, `href`. The `pill` variant takes a `tone` (`"accent"` default, `"availability"` — WeekendList's weekend toggles; pressed text is `soft`, not `strong`, to clear 4.5:1 in light). |
| `revealProps()` (`app/utils/reveal.ts`) [N] | CSS route reveal; `app/(client)/template.tsx` replays it per navigation. |
| `CueDialog` [C] | The ONE dialog shell — never a hand-rolled `fixed inset-0` scrim. `mode="modal"` \| `"sheet"` (a sheet is only a sheet below 640px); drag-to-dismiss from the sheet's head (handle + title bar — on a phone it is the only visible close control, the × is `sr-only` there; 150 px of travel or a 0.5 px/ms flick — `SHEET_DISMISS`); `onDismiss(reason)` where `reason` is `"escape" \| "backdrop" \| "drag"`. Traps focus, stacks layers, supports a portalled focus "satellite". Always render `<CueDialog open={x}>`, never `{x && <CueDialog open>}` — see `cueDialogMount.test.ts`. |
| `Toast` / `useToast` [C] | The ONE fixed toast stack. `toast({ message, tone?, duration?, hold?, action? })`; `hold` persists until `dismiss(id)`. `useTransientValue` stays for an inline flash next to the control that produced it. |
| `Menu` / `MenuItem` / `MenuSeparator` / `MenuHeader` [C] | The ONE anchored dropdown. `role="menu"`, roving focus, merges the trigger's own ref. Inside a `CueDialog` the menu owns Escape (first Escape closes the menu, the second the dialog) — M0b-2. |
| `Collapse` [C] | The ONE disclosure. Real height animation (the one exception to transform/opacity-only); children stay mounted while closed, `inert` + `aria-hidden`. |
| `SegmentedControl` [C] | The ONE segmented control — `role="radiogroup"`, arrow keys move the selection with wrap, the checked option is the sole tab stop; `value={null}` means nothing chosen yet. One `layoutId` thumb. Sizes `sm`/`md`; tones `outline`/`filled`; `badge`/`busy` per option. Never `aria-pressed` toggles for a one-of-N choice. |
| `SlidingIndicator` / `useActiveIntoView` [C] | The active marker for tab bars (admin `TabBar`, `SectionNav`, `BottomNav`). Semantics stay on the items (`aria-current`); the hook scrolls the active item into view. |
| `Switch` [C] | The ONE switch — `role="switch"`, `aria-checked`, a `<button>`; knob springs with `initial={false}`; haptic on flip. Sizes `sm`/`md`. |
| `Checkbox` [N] | The ONE checkbox — native input stays (`sr-only peer`) and does the work; the box is drawn, the mark scales in. `tone="negative"` for the kill switch. `align?: "center" \| "start"` (default `center`; `start` for a two-line label) is a prop, not a `className` — a same-property utility passed through `className` cannot beat one the primitive already sets, since stylesheet order (not specificity) decides which of two same-specificity classes wins. |
| `Select` [N] | The ONE select — native `<select>` under tokenised chrome plus a drawn chevron. Sizes `sm`/`md`/`lg` (`lg` = `md` plus a 44 px minimum height on the element itself). `label` + `id`, or `aria-label`. |
| `DateField` [N] | The ONE date/month input — native under tokenised chrome; `kind="month"` with `onStep` draws the prev/next month buttons. |
| `NumberRoll` [C] | A value that changes in place: old rises out, new rises in, one grid cell. `initial={false}`. |
| `SwipeStrip` [C] | The ONE drag-with-snap host (R2) — `<SwipeStrip onSwipe={(dir: -1 \| 1) => void} threshold={64}>`; `/schedule`'s `DayStrip` is its one consumer, paging the visible week. `drag="x"` locked to the horizontal axis, pinned at the origin with elastic give and a spring snap-back; `touch-action: pan-y` keeps vertical page scroll alive, which is also why wrapped content must fit the width rather than scroll horizontally inside it. The exported `swipeDirection(offsetX, velocityX, threshold?)` is the pure decision, tested directly since jsdom can't drive `motion`'s drag gesture. |
| `haptic()` (`app/utils/haptics.ts`) [N] | Native-only haptic feedback; no-op on web; fire-and-forget, never awaited in a handler. |
| `GalleryMotion` (`app/(gallery)/theme-gallery/[theme]/`) [C] | The theme gallery's own `LazyMotion` — the gallery mounts no `Provider`/`MotionProvider`, so this wrapper loads `domMax` synchronously and honours `data-motion="off"` so a baseline capture is deterministic. |

See [MOTION.md](MOTION.md) for the full primitive reference, the load-failure
behaviour of each, and the guards that pin them.

[N] = neutral module (no `"use client"`, no hooks) — renderable from either side (ADR-0028).

### Admin panels (`app/components/admin/`, all [C])
| Component | Purpose |
|-----------|---------|
| `AdminPanel` | Root admin shell: tabs + member management (Fuse.js search, add/edit modal, role-gated). |
| `ServicesPanel` | Service-readiness cards plus card-owned delete/copy/publish/setlist/proposal flows. Owns the canonical roles/integrity source bundle and opens `MonthGenerator` for **Editar mes**, card roster edits, and **Nuevo**. The editor replaces the tab with a full-width panel rather than a dialog. |
| `seatModel` | Canonical seat names and categories; one spelling per seat. Pure. |
| `candidateRanking` | Seat candidates ordered by availability, existing assignment and recent load. Pure; never calls the solver. |
| `plannerModel` | Pure month-grid rows/columns/cells plus create-solver translations (`buildSolveRequest`/`applySolveResponse`) and participant/draft projections. Stored columns use role-ID `columnId` and keyed occupants; stored admission/translation lives in `storedRoleReadModel`. Owns Saturday↔week adjacency (never position) and the Sunday-only Coro row. |
| `PlannerGrid` | Renders the month grid `plannerModel` computes — dates across and seats down. Applicable admitted cells are editable; integrity-defective stored columns stay visible and read-only. An occupant whose «Tipo» no longer fits the seat is tinted amber and named under the cell, and the picker gives them a removal-only row — `rankCandidates` filters them out, so that row is their only exit (ADR-0029). `MonthGenerator` owns `cells`/`counts` and mutations. Owns the **three-column workspace**: Participaciones (216px), grid, and candidate picker (240px while a cell is active). The chart width is a content floor derived from `ParticipationSidebar`. **Pantalla completa** manages focus, traps Tab, locks body scroll, `inert`s the rest of `<body>`, applies safe-area padding, and portals to `document.body` for Safari. The grid scrolls horizontally rather than squeezing its `minmax(150px, 1fr)` date columns; row labels remain sticky. Its `planner-wide` root lets `app/brand.css` lift the admin frame cap through `:has()`. |
| `MonthGenerator` | Owns create-planning and stored editing in the shared three-part `PlannerGrid`. Create mode retains solver preview/Auto and fairness history. Stored mode owns create-one, explicit full-roster save, date/name edits, team/seat swaps, frozen attempts, and roles/integrity readback reconciliation. |
| `SetlistEditor` | Inline setlist builder (reorder/remove, play-key, medley via `normalizeMedleyTags`). |
| `SongFormModal` | Song create/edit form. Exports `SongForm`, `blankForm`, `songToForm`, `buildPayload`. Its own `Modal` wrapper was removed in M0b-1 — dead export, no JSX caller (`AdminPanel`/`ServicesPanel` each own a local `Modal`); every caller mounts `SongForm` inside its own `CueDialog`. Charts are edited via `ChordChartsFields` ([ADR-0018](adr/0018-lyrics-and-charts-are-independent.md)). |
| `ContentPanel` | Song-library CRUD (via `SongForm`). |
| `ProposalsPanel` | Admin review of lead proposals (approve / request changes / reopen). Order and date window come from `proposalListView.ts`: buckets stay `pending → changes_requested → approved → draft`, `approved` reads newest-first (archive) and every other status soonest-first (queue); `approved`/`draft` older than the current month are hidden behind `Ver N meses más`, while `pending`/`changes_requested` are never windowed out. A handoff to an older proposal widens the window before the card is scrolled to, as does approving a past-dated one (the card would otherwise vanish under the admin). Widening jumps to the newest hidden row rather than a blind +3 months, so every press reveals something. **The window is client-side only:** `GET /api/admin/proposals` still returns the entire history with its full song joins, so the payload is unbounded and only the render is windowed — server-side windowing was deliberately deferred out of Release 1. |
| `ProposalThread` | The private lead ↔ admin conversation on a proposal, shared by the lead editor and the admin card. **Renders unconditionally** — it replaced blocks gated on `lead_notes` being present and on `changes_requested`, and inheriting either condition would hide the thread on a `pending` proposal, which is where the conversation happens. Four rules that look cosmetic and are not: the author label is keyed on `author_role`, never on a missing name (two migrated messages have no author, and falling back to "Admin" would misattribute an author-less lead note); timestamps convert the ISO datetime to a local calendar day *first* and compare day strings, never elapsed hours; the composer closes when the **service** passes, not on approval, and both routes enforce that server-side because a hidden composer is not a guard; and the composer clears **only on success**, since the channel's whole promise is that nothing written is lost. Posting patches one record in place — never `load()`, which unmounts every card and wipes in-progress change-request notes. |
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

`EditSongButton` [C] (top-level) — inline "edit song" affordance on song pages; role-gated.
Shares `songToForm` / chart helpers with `SongFormModal`. Lyrics and charts are independent
([ADR-0018](adr/0018-lyrics-and-charts-are-independent.md)).

---

## Tests

**219 test files / 4,579 tests** (185 under `app/` + 25 under `scripts/` + 9 harness unit
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
