# Backstage Cue System — Audited Dependency Matrix

**Audit basis:** current repository on `codex/backstage-cue-system-plan`, 2026-07-16. This is the migration boundary source of truth. Re-run the searches at implementation time if `main` moves.

## 1. Shared consumer matrix

| Shared surface | Active consumers | Interaction | Owning slice | Atomic rule |
|---|---|---|---:|---|
| `Navbar` + `NavMenu` | `/`, `/tag`, `/tag/[slug]`, `/author`, `/author/[slug]`, `/posts/[slug]`, `/schedule`, `/me`, proposal, `/admin` | Sticky shell + disclosure | 1 | Change together; preserve session, notification cache, role links, and alias context. |
| Catalog rows/search | Home/catalog, tag detail, author detail | Nonmodal search/index | 1 | Preserve Fuse behavior, ordering, accent folding, and crawlable links. |
| `AudioPlayer` | Global client layout sibling of `SongSheet` (`layout.tsx:70-71`) | Fixed global transport | 2A | Freeze shared transport and preserve player state. Global close restores the captured connected audio origin or the programmatic route-main fallback with no scroll; 2B may supply its in-dialog fallback. Do not raise it above an `aria-modal` layer. |
| `PlayerContext` | All catalog/DayCard sheet openings plus global audio transports | Global async sheet/audio owner | 2A | Own request generation/abort and observable audio readiness so stale requests cannot reopen/overwrite sheets and transports attach after `Audio` exists. Keep its public caller contract stable for 2B. |
| `ChordChart` | Direct song page and legacy/migrated SongSheet | Shared interactive content | 2A | Add shared naming/state only and frame it externally on the direct page; preserve shared structure/classes/output through 2B and test legacy SongSheet regression. |
| `SongAudioSection` | Direct song page | Repeated track controls | 2A | Preserve playback/download behavior; index accessible action names so duplicate track titles remain distinguishable. |
| `PracticePlaylistButton` | Every DayCard consumer: home, Calendar list/dialog, `/me`, MonthGenerator | Nonmodal disclosure | 2A | Self-contain the semantic/focus change. A handled Escape stops propagation so legacy Calendar remains open; parent/modal migration waits for 2B. |
| `SongSheet` | Global mount; opened by `PostComponent` and every `DayCard` song | Modal with history child | 2B | Migrate with Calendar parent and history child; keep its header close button mounted as explicit focus fallback across loading/song/transport replacement. No intermediate 2B preview. |
| `DayCard` | Home (`page.tsx:115,129,141`), `/schedule` (`CalendarView.tsx:262,275,287,321`), `/me` (`me/page.tsx:350`), MonthGenerator (`MonthGenerator.tsx:1530`) | Card; opens SongSheet and SetlistEditor | 2B | Review every consumer, including 390px/max-text and MonthGenerator’s `max-h-[50vh]` frame. `roleId` presence, not display name, is authoritative for special type/theme. |
| `NextServiceHero` | `/me` (`me/page.tsx:324`) | Wrapper around `DayCard` | 2B | Preserve prop pass-through and Mexico City countdown logic. |
| `CalendarView` | `/schedule` only | Calendar/list + day-detail modal | 2B | Migrate with SongSheet and DayCard chains; preserve browse state and local “today.” Group by `roleId` identity before display label so same-label specials cannot overwrite weekly slots. |
| `SetlistEditor` | Parent 1: `DayCard`; parent 2: ServicesPanel setlist dialog | Editor with create-song child | 2B | Both parent paths must be provider-managed before its child migrates. Failed initial load must never become an editable empty setlist. |
| `SongFormModal.Modal` | SetlistEditor create-song; ContentPanel add/edit/delete | Shared legacy modal wrapper | 2B → 3 | Slice 2B stops SetlistEditor using it but does not redefine/delete it. Slice 3 migrates ContentPanel, then deletes it after a zero-consumer search. |
| `SongFormModal.SongForm` | SetlistEditor and ContentPanel | Shared form inside dialogs | 3 | Slice 2B leaves markup/behavior unchanged. Slice 3 restyles/hardens it atomically and retests both consumers. |
| `SongFormModal.buildPayload` | SetlistEditor and ContentPanel | Pure serializer | 2B | Characterize before movement; preserve deliberate one-chart behavior. |
| `EditSongButton` | Direct song page only | Independent editor modal and separate payload builder | 2A | Do not confuse its form/payload with shared `SongForm`. |
| `ProfilePanel` | `/me` | Card + right-drawer modal | 3 | Preserve all handlers, file input, focus restoration, and mounted/inert closed state. |
| `AvailabilityCalendar` | `/me` | Calendar + nonmodal note popover | 3 | Keep nonmodal; add originating-trigger focus restoration without changing batch-save/dirty behavior. |
| `ProposalEditor` | `/me/propose/[roleId]` | Form + confirmation modal + anchored popovers | 3 | Only confirmation becomes modal; key/search overlays remain nonmodal. Preserve 409 behavior. |
| `AdminPanel` | `/admin` | Tabbed shell + local member modals | 3 | Preserve role-visible tabs and server enforcement. Its local `Modal` is unrelated to `SongFormModal.Modal`. |
| `ServicesPanel` | `/admin` services tab | Local modal wrapper, setlist child, generator, swaps, confirmations | 2B → 3 | Slice 2B migrates only the setlist host, guards it against every legacy overlay, and gives initial/background loading explicit retryable failure states while preserving the last keyed grid and focus target. Slice 3 migrates remaining dialogs and mutations. |
| `ContentPanel` | `/admin` content tab | Shared SongForm modals + sibling toast | 3 | Migrate with shared SongForm hardening; failures stay inside active dialog. |
| Remaining admin panels | `/admin` proposals, availability, activity | Nonmodal workspaces | 3 | Visual migration only; no invented business-logic refactor. |

## 2. Active overlay graph

### Song-detail chain

```text
PostComponent or DayCard
└─ global SongSheet
   └─ history SetlistPopover

CalendarView day dialog
└─ DayCard
   └─ global SongSheet
      └─ history SetlistPopover
```

Current hazards:

- `CalendarView.tsx:90-94` and `SongSheet.tsx:55-63` both listen globally for Escape.
- Both Calendar and SongSheet keep capturing document focus traps active.
- SongSheet directly writes `body.style.overflow`.
- AudioPlayer is below the backdrop; full seek/close controls otherwise become unavailable.

Required integration sequence: Calendar → SongSheet → history. Each Escape closes exactly one layer; focus returns one level; body remains locked until the final close; background scroll position never moves.

### Setlist-editing chain

```text
CalendarView day dialog
└─ DayCard editor
   └─ SetlistEditor
      └─ create-song dialog

ServicesPanel setlist dialog
└─ SetlistEditor
   └─ create-song dialog
```

Required rule: 2A leaves this entire graph legacy. No provider-managed child may deploy under a legacy parent. Slice 2B migrates SongSheet/history, Calendar, DayCard editor, ServicesPanel’s setlist host, and SetlistEditor’s create-song child before its first preview. Until Slice 3 migrates other ServicesPanel overlays, bidirectional state guards prevent coexistence without discarding the already-open form.

### Independent Slice 3 overlays

- Profile drawer.
- Proposal submit confirmation.
- AdminPanel member add/edit/password/delete.
- Remaining ServicesPanel add/edit/delete/swap/generator/confirmation dialogs.
- ContentPanel add/edit/delete.

### Nonmodal overlays

- NavMenu disclosure.
- PracticePlaylistButton disclosure.
- ServicesPanel card-actions disclosure.
- Availability note popover.
- Proposal key picker and song search.

These do not use `aria-modal` or background inerting. They use ordinary controls and normal Tab order, close on Escape/outside click/selection as appropriate, and restore trigger focus. A child disclosure consumes its handled Escape so a legacy modal parent cannot close in the same event.

## 3. Existing infrastructure hazards

- Shared brand selectors currently own layout-critical properties across Slice 1, 2A, 2B, and 3 consumers. Slice 1 may add tokens/selectors but cannot remove those fallbacks. Each owning slice first adds equivalent JSX geometry to its consumers; Slice 3’s final audit removes the legacy CSS properties only after a repository-wide caller search and full visual regression pass.
- No current `createPortal` use exists.
- `useFocusTrap` is used by SongSheet, CalendarView, ProfilePanel, and `SongFormModal.Modal`; it installs a capturing document listener.
- SongSheet and ProfilePanel independently assign/reset body overflow without stack ownership.
- Calendar content is scrollable, while descendants render fixed overlays inline and can inherit stacking/clipping constraints.
- ImpersonationBanner currently uses `z-[60]`; the shared portal must define a modal band above global chrome.
- Global/sibling toasts in EditSongButton, ProfilePanel, AdminPanel, ServicesPanel, ContentPanel, and ProposalEditor are not valid as the sole failure message while a dialog remains open and the application background is inert.

## 4. Mutation ownership

| Flow | Current risk | Slice correction |
|---|---|---:|
| EditSongButton metadata load/save | Metadata load lacks failure state; save failure uses sibling toast | 2A: inline dialog status; preserve exact PATCH payload and close only on `res.ok`. |
| Practice playlist generation | Selection unmounts the focused option; post-await `window.open` loses iOS/Safari user activation; failures lack durable feedback | 2A: synchronously reserve/detach a blank window, keep the pending trigger focusable with `aria-disabled` activation guards, restore trigger focus, assert exact POST body, prevent duplicate in-flight windows/requests, navigate only after valid success, close the reservation on every failure, show local retry, and clear pending in `finally`. |
| SongSheet history read | Authenticated API currently includes today/future referencing setlists while direct page is past-only | 2A: add Mexico City `week < today` parity, preserve response shape, and test past retention/future exclusion. |
| Setlist initial read | Non-OK becomes editable empty data; rejection can strand loading | 2B: independent setlist/tag states, authoritative ready gate, local retry, zero list mutations or PUT until a successful current response hydrates entries. |
| Setlist create song/tag | No complete `try/catch/finally`; network failure can strand loading and HTTP failure is silent | 2B: keep child open, reset loading, local alert, exact request regression tests. |
| Setlist save/dismiss | Failure stays open, but current shared `onClose` makes ServicesPanel report Cancel as saved | 2B: split dismiss from saved callbacks; cancel/Escape/backdrop send no PUT/refetch/toast, and only `ok` PUT triggers parent success through both parents. |
| ServicesPanel initial/refresh read | Rejection strands loading; refresh unmounts the grid and focus target | 2B: initial retryable error instead of false empty; background failure preserves the last complete snapshot/keyed cards/focus, clears busy in `finally`, and reports retryably. |
| Admin member add/edit/password/delete | Modal failures use a sibling toast; photo upload is a separate row action | 3: for each modal handler assert exact endpoint/method/body, success close/refetch, non-2xx/rejection, loading reset, and local alert. Leave photo behavior unchanged. |
| Shared SongForm tag/author local flags | Rejected callback can strand internal loading | 3: harden with `finally` when both consumers migrate/restyle. |
| Content add/edit/delete/tag/author | Failures use outside toast; tag/author callbacks can reject into SongForm | 3: local dialog status, exact payload tests, no close on failure. |
| Services add/edit/delete | Errors use outside toast | 3: assert exact URL/method/body and success close/refetch; non-2xx/rejection stays open with reset loading and local status. |
| Services swap | Confirmation closes even on non-2xx; partial multi-request success is possible | 3: assert exact PATCH bodies for card/member variants; keep/report failure, refresh truthful server state, never claim full success, require review after partial result. |
| Copy instruments | Native confirm; clears mode/refreshes even on HTTP failure | 3: CueDialog confirmation, exact request once, pending state, cancel sends zero requests. |
| Bulk publish | Native confirm with no pending state | 3: CueDialog confirmation, exact request once, local failure, cancel sends zero requests. |
| Profile mutations | Handlers reset correctly, but most drawer feedback is outside | 3: errors/pending inside drawer; successful post-close feedback may remain global. |
| Proposal save | Correct failure/409 handling; confirmation closes before save | 3: preserve state and behavior; migrate confirmation semantics only. |
| Availability save | Compliant inline behavior | 3: preserve; only improve popover focus restoration. |

## 5. Dormant and excluded surfaces

- `BottomNav` has no active importer. Keep it unmounted and out of all slices.
- `CmsNavbar` belongs to the separate embedded Studio/admin layout and is not a client Navbar consumer.
- Native `beforeunload` in AvailabilityCalendar protects dirty data and remains intentional.
- Android runtime and offline behavior remain outside this migration.

## 6. Checkpoint matrix

| Slice | Required route/context coverage | Production-data constraint |
|---|---|---|
| 1 | Sign-in, not-a-member, home, not-found, catalog/tag/author routes plus representative `/posts/[slug]`, `/schedule`, `/me`, proposal, and `/admin` Navbar consumers; 320/390/768/1440 shell, role menus, badge, alias title, impersonation fixture, search announcements, PWA/iOS safe area and max text | No form submissions. Authenticated surfaces require telemetry consent. |
| 2A | Direct song and loading state; named ChordChart/audio/editor controls; Home DayCard practice disclosure at 390/max text; Calendar day → DayCard → disclosure Escape isolation; one read-only target-runtime Música/Letras popup-generation check; global audio readiness/transport and connected/disconnected-origin close focus; PlayerContext races; history API; legacy SongSheet structural regression; 390/1440, PWA/iOS | No edit or Sanity-writing submission. Mocked tests own mutation success/failure/payload assertions except the single read-only practice popup check. SongSheet/Calendar remain legacy. |
| 2B | SongSheet close/load/history/audio; schedule loading; Calendar → SongSheet → history; Calendar → DayCard → SetlistEditor → create; Home DayCard chain with special roleId; ServicesPanel chain, load failure/retry, delayed/failed refresh; `/me` DayCards; MonthGenerator; PWA/iOS | No edit, setlist, song/tag creation, publish, or generator submission. Mocked tests own mutations. No intermediate 2B tree on `preview`. |
| 3A | `/me`, Profile drawer, Availability popover, proposal confirmation, max text, PWA/iOS keyboard and safe areas | Open/type/cancel only; no profile, availability, preference, photo/password, or proposal save. |
| 3B | `/admin` permitted roles/tabs, member/service/content dialogs, disclosures, confirmations, SetlistEditor regression | Open/type/cancel only; no content/member/service/publish/swap/copy/generator mutation. |

Every checkpoint uses the canonical Vercel project and pushes only `preview`. Authenticated web, PWA, and Simulator sessions may each cause production `lastSeen` telemetry; obtain explicit consent first.
