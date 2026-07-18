# Slice 2B — Schedule and Service Operations

**Outcome:** Migrate SongSheet and integrate it with every Calendar, DayCard, setlist, and ServicesPanel parent, with authoritative loading and mutation safety, then deploy the complete connected graph atomically.

**Depends on:** approved, preview-verified, and merged [Slice 2A](./2026-07-16-backstage-cue-system-slice-2a-dialogs-songs.md), approved Slice 1, [master contract](./2026-07-16-backstage-cue-system.md), and [dependency matrix](./2026-07-16-backstage-cue-system-dependencies.md).

## Atomicity rule

No intermediate 2B commit merges or pushes to `preview` until this entire graph and all integration tests pass:

```text
Calendar day → DayCard → SongSheet → history dialog
Calendar day → DayCard editor → SetlistEditor → create-song dialog
ServicesPanel setlist host → SetlistEditor → create-song dialog
```

No provider-managed child may be deployed beneath a legacy parent. The first 2B preview is one complete tree based on the approved 2A baseline.

Shared-form seam:

- Characterize `SongFormModal.buildPayload` before changing its host.
- Stop SetlistEditor using `SongFormModal.Modal` while keeping `SongForm` markup and behavior unchanged.
- Keep the legacy `Modal` export unchanged for ContentPanel.
- Slice 3 migrates ContentPanel, restyles/hardens the shared form for both consumers, then deletes the zero-consumer wrapper.

---

## Task 1 — Migrate SongSheet and its history child

**Files**

- `app/components/SongSheet.tsx`
- `app/components/AudioTransport.tsx` as the frozen 2A interface; change it only if an integration defect forces the 2A approval to restart.
- Add focused SongSheet and nested-dialog tests.

**Work**

- Share the information order: identity → key/BPM/time → practice resources → lyrics/chords → history/set context → edit actions.
- Migrate SongSheet and its history `SetlistPopover` to CueDialog. Remove manual Escape, focus, body-lock, backdrop, and z-index ownership.
- Keep SongSheet’s shell and header close button mounted across loading, loaded, failed, song-switch, and transport states. Register the connected close button as fallback for disappearing history or transport controls.
- Render the frozen 2A AudioTransport in a sticky safe-area-aware region inside SongSheet when a track exists. The background global player remains inert/hidden; expose no duplicate accessible transport.
- Preserve chord transposition, playback, history links, PDF/reference URLs, permissions, and fallbacks.

**Tests**

- Home/catalog opening preserves background scroll.
- Loading, loaded, failed, close, Escape, and backdrop preserve focus/body state.
- History closes before SongSheet. Selecting another history song enters parent loading and focuses the persistent header close button, never `body`.
- In-dialog transport covers pointer/keyboard play, pause, seek, close, arrows, Home, End, safe areas, and provider audio readiness. Closing a focused transport returns focus to the SongSheet close button.
- The global transport is inaccessible while the sheet owns interaction, and playback state survives sheet open/close.

**Commit:** `feat(songs): migrate the backstage song sheet`

**Hold:** Do not deploy. Calendar remains a legacy parent until Task 2 and setlist parents remain incomplete until Tasks 3–4.

---

## Task 2 — Migrate schedule, DayCard, and service identity

**Files**

- `app/(client)/page.tsx`
- `app/components/NextServiceHero.tsx`
- `app/components/DayCard.tsx`
- `app/components/CalendarView.tsx`
- `app/(client)/schedule/page.tsx`
- `app/(client)/schedule/loading.tsx`
- `app/(client)/me/page.tsx` only for shared-DayCard framing.
- `app/components/AddToCalendarButton.tsx`
- `app/components/SectionNav.tsx`
- `app/components/admin/MonthGenerator.tsx` only for shared-DayCard preview framing.
- Add focused schedule and DayCard integration tests.

**Work**

- Recompose DayCard as service identity, setlist cue rows, and a clear personnel/equipment roster without card nesting.
- Bring schedule loading skeletons into the same hierarchy without changing data boundaries.
- Preserve Sunday/action, Saturday/caution, special/special, and multi-service legend meaning.
- Preserve long names, aliases, practice/edit permissions, medleys, add-to-calendar behavior, all five seat categories, draft gating, `saturdarSongs`, and Mexico City date rules.
- Add `roleId` to CalendarView’s `ActiveDay` type. Propagate every special service `_id` through schedule construction and every CalendarView list/detail DayCard, home, `/me`, NextServiceHero, and DayCard. Sunday/Saturday callers omit it.
- Treat `roleId` presence as authoritative for special theme and API type before display `day`.
- Calendar list grouping classifies `roleId` entries as specials first, even when `day` is exactly `Domingo` or `Sábado`; only entries without `roleId` may fill the weekly Sunday/Saturday slots.
- Update every DayCard frame: home, CalendarView list/dialog, `/me`, NextServiceHero, and MonthGenerator’s `max-h-[50vh]` preview.
- Migrate Calendar day detail and DayCard editor to CueDialog; remove manual Escape, focus, backdrop, and body-lock ownership.

**Tests**

- Calendar → SongSheet → history: three Escapes close history, sheet, then calendar; focus restores one level; body stays locked; background scroll never changes.
- Calendar DayCard editor remains in the Calendar parent scope and restores focus without exposing the route behind it.
- A week with real Sunday/Saturday plus specials named exactly `Domingo` and `Sábado` renders all four entries in list and calendar detail. Special DayCards retain `roleId`, theme, GET type, and PUT identity.
- DayCard behavior is covered in every consumer, including `/me` at maximum text and MonthGenerator at 390px inside `max-h-[50vh]`.

**Commit:** `feat(schedule): integrate service cues and calendar dialogs`

---

## Task 3 — Make SetlistEditor authoritative before mutation

**Files**

- `app/components/admin/SetlistEditor.tsx`
- `app/components/admin/SongFormModal.tsx` only as the unchanged shared form import.
- Add focused load, mutation, payload, and nested-dialog tests.

**Work**

- Stop importing the legacy `Modal`; render unchanged `SongForm` in a nested CueDialog.
- Split initial setlist and tag loading into independent states. One failed request must not masquerade as an authoritative empty result for the other.
- The setlist state is `loading`, `ready`, or `error`. Only a successful `res.ok` response parsed for the current `{ week, type, roleId }` generation may set `ready` and hydrate entries/recent history.
- On setlist non-2xx, rejection, stale response, or parse failure, show a dialog-local alert and retry. Do not render “Sin canciones todavía” as if the empty state were authoritative.
- Until the authoritative setlist reaches `ready`, disable save and every mutation of the unknown list, including search-add, remove, reorder, medley changes, and create-song.
- Tag non-2xx/rejection has its own local alert and retry. It does not clear a ready setlist or convert missing tags into a successful empty tag catalog.
- Split dismissal from successful save. Cancel/Escape/backdrop close without PUT, refetch, or success toast; only an `ok` PUT calls the parent’s saved callback.
- Harden create-song and create-tag callbacks with `try/catch/finally`, `res.ok`, local error, and loading reset. Preserve request bodies and successful add/select behavior.
- Preserve compliant save failure behavior inside the active dialog.
- Characterize the exact shared `buildPayload` mapping without changing the shared form or known one-chart behavior.

**Tests**

- Setlist non-2xx, rejection, stale response, and parse failure each clear loading, show retry, keep mutations disabled, issue zero PUTs, and never expose a false empty-setlist state.
- A failed authoritative load cannot overwrite an existing server setlist with `songs: []`. Retry hydrates the real songs before enabling edit/save.
- Tag failure is independently retryable and does not erase a successfully loaded setlist; setlist failure does not claim a successful empty tag load.
- Calendar/DayCard editor → SetlistEditor → create-song and ServicesPanel host → SetlistEditor → create-song close one layer at a time and keep continuous lock/focus.
- Create-song/tag rejection and non-2xx keep the child open, clear loading, and announce locally.
- Successful song creation asserts exact URL/method/body, adds the result, and closes only the child.
- Successful tag creation asserts the exact POST body, inserts/selects the tag, clears its query, and leaves create-song open.
- Save failure retains edits and parent. Cancel, Escape, and backdrop issue zero PUTs/refetches/toasts. Only an `ok` PUT invokes the saved callback with the unchanged payload.
- Shared `buildPayload` characterization freezes lyrics/chords/reference/tag/author mapping.

**Commit:** `feat(setlists): guard authoritative loading and nested editing`

---

## Task 4 — Integrate the ServicesPanel setlist host safely

**Files**

- `app/components/admin/ServicesPanel.tsx` only for data loading and the setlist-host callsite.
- Add focused ServicesPanel loading, coexistence, focus, and parent-contract tests.

**Work**

- Migrate only the setlist-host callsite to CueDialog. Remaining add/edit/delete/swap/generator overlays stay on the local wrapper until Slice 3.
- Add bidirectional state guards: any open legacy overlay blocks setlist opening without closing or clearing its form; an open setlist host blocks every legacy-overlay opener. At most one overlay state is truthy.
- Pass the persistent card Actions button ref instead of the transient menu item as final focus target.
- Replace the single `loading` lifecycle with explicit initial-load and background-refresh state.
- Initial roles and members responses are checked independently for non-2xx, rejection, and parse failure. Any failed required resource clears loading in `finally`, avoids a false empty-services state, and shows retryable panel-local failure feedback; only a complete pair establishes the first snapshot.
- After an authoritative snapshot exists, background refresh keeps the last successful roles/members snapshot, keyed ServiceCards, and focusable Actions buttons mounted. It may mark the region busy but must not replace the grid with skeletons or disable the focused Actions target.
- A background roles or members non-2xx, rejection, or parse failure retains the prior complete snapshot and focus target, clears refreshing in `finally`, and shows retryable panel-local feedback. Only a complete successful pair replaces the snapshot.
- Successful setlist save closes the host, restores focus, then refreshes in the background. Cancel/dismiss never refetches or reports saved.
- If that post-save refresh fails, report both outcomes truthfully: the setlist was saved, but services could not be refreshed. Keep the prior grid and retry action; never turn the refresh failure into a false save failure or full-success claim.

**Tests**

- Roles and members each independently cover initial non-2xx, rejection, and parse failure: loading clears, retry appears, and “no services” is not rendered from unknown data. Retry can establish the first complete snapshot.
- Delayed successful background refresh keeps the same Actions node connected and focused until replacement settles.
- Roles and members each independently cover background non-2xx, rejection, and parse failure: cards and focus remain, busy clears, retry appears, and no skeleton or false empty data replaces the snapshot. A failure after save reports “saved, refresh failed” semantics.
- Every remaining legacy overlay is tested in both directions against the setlist host. A blocked second open is a no-op, preserves the existing form, and never mounts a mixed stack.
- Create-song child then ServicesPanel host closure returns focus to the originating card’s Actions button, not `body` or the removed menu item.
- Setlist save success alone triggers the unchanged success behavior and background refresh; cancel/Escape/backdrop trigger neither.
- Special-service GET contains `type=special`, `week`, and role document ID; PUT retains `roleId`. Same-label special fixtures remain special.
- Repository search proves ContentPanel still imports the unchanged legacy wrapper and shared SongForm output is unchanged.

**Commit:** `feat(services): complete the atomic setlist host`

---

## Slice 2B combined preview checkpoint

Only after Tasks 1–4 and all connected tests pass:

1. Run `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check`.
2. Merge current `main` into the implementation branch and rerun 2A regressions and all 2B gates.
3. Prove the candidate tree descends from the approved 2A baseline and contains no partial 2B variant.
4. Merge the combined tree through `preview`, prove tree equality, verify canonical Vercel project, and record the deployed SHA.

Review on that SHA:

- Catalog → SongSheet, direct `/posts/[slug]`, loading, practice disclosure, EditSongButton without saving, and audio transport.
- `/schedule` loading, Calendar → SongSheet → history, and Calendar day → DayCard editor → SetlistEditor → create-song without submitting.
- Home special-service DayCard → editor → create-song without submitting, proving `roleId` remains authoritative through the visible chain.
- `/admin` ServicesPanel → setlist host → create-song without submitting, including local initial/background loading states through mocked tests.
- `/me` DayCards and MonthGenerator preview at 390px/max text.
- Nested close order, focus restoration, lower-layer inertness, continuous lock, unchanged scroll, safe areas, software keyboard, and reduced motion.
- Repeat both exact Calendar-parent chains and the representative ServicesPanel chain in installed online PWA and iOS Simulator.

Do not submit edit, setlist, song/tag creation, publish, or generator actions. Mocked tests own mutation and failure verification. Obtain telemetry consent before authenticated web/PWA/Simulator sessions.

**Slice 2B is done when** the complete 2A+2B graph is approved on one recorded preview SHA, authoritative-load failures cannot produce destructive saves or false empty states, ContentPanel/shared SongForm output remains unchanged, and no mixed-stack tree was deployed.
