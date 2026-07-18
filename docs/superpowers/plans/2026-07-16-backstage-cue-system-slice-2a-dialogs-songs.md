# Slice 2A — Dialog Platform and Song Cues

**Outcome:** Build the stack-safe dialog platform and independently migrate direct-song controls, practice, playback foundations, and async song infrastructure without touching the connected SongSheet/Calendar modal graph.

**Depends on:** approved Slice 1, [master contract](./2026-07-16-backstage-cue-system.md), and [dependency matrix](./2026-07-16-backstage-cue-system-dependencies.md).

## Atomic boundary

Slice 2A is independently deployable because it does **not** migrate SongSheet. CalendarView and every DayCard → SongSheet path remain consistently legacy until 2B migrates their complete connected graph.

- CueDialog is exercised by the independent EditSongButton dialog.
- PlayerContext request-generation and audio-readiness internals may harden without changing its public caller graph.
- AudioTransport’s global and future in-dialog-compatible interface is frozen here; 2B imports it without redesign.
- Catalog/legacy SongSheet is regression-only at this checkpoint, not a migrated design surface.

Moving SongSheet into 2A would violate this boundary because legacy Calendar focus/Escape ownership can parent it. SongSheet belongs exclusively to 2B.

---

## Task 1 — Build the shared dialog platform

**Files**

- Create `app/components/ui/CueDialog.tsx`
- Create `app/components/ui/CueDialogProvider.tsx`
- Create `app/components/ui/CueDialogStatus.tsx`
- Create tests under `app/components/ui/__tests__/`
- `app/(client)/layout.tsx`

**Contract**

- One provider is mounted in the client layout.
- Dialogs render through a body-level portal and register an ordered ID.
- Only the top layer handles Escape/backdrop and owns the active focus trap.
- Background application content and lower dialog layers become inert and `aria-hidden`; prior attributes are restored exactly.
- Body overflow is provider-owned and reference-counted; the original value returns only after the final dialog closes.
- Closing a child restores focus inside its parent; closing the final parent restores the original opener without scrolling.
- Callers whose opener is transient or unmounted may provide an explicit stable focus-restoration ref. Default behavior still captures the active opener.
- If a requested target disconnects while its dialog remains open, CueDialog focuses that dialog’s explicit stable fallback or focusable shell instead of `body`.
- Every dialog has `role="dialog"`, `aria-modal="true"`, and an accessible visible title or explicit label.
- `onDismiss` reports `escape` or `backdrop`; parents decide whether to close.
- Modal geometry, safe-area padding, and modal/mobile-sheet modes are centralized.
- `CueDialogStatus` renders inside the active dialog: errors use `role="alert"`; pending and non-destructive updates use polite status semantics.
- The provider’s portal modal band sits above Navbar, the Slice 1 ImpersonationBanner, AudioPlayer, and route stacking contexts without editing those shared-shell consumers.

**Tests**

- Portal placement and accessible naming.
- Initial focus without scroll, Tab/Shift+Tab trap, Escape and backdrop reasons.
- Parent/child topmost-only dismissal and lower-layer inertness.
- Child-to-parent and parent-to-route focus restoration.
- Explicit restoration to a stable trigger when a transient opener unmounts.
- Disconnected targets fall back inside the still-open parent; restoration never lands on `body`.
- Exact prior inert, `aria-hidden`, and body-overflow restoration.
- Route or unexpected unmount clears registry and lock.
- Status is announced inside the top layer while siblings and lower layers cannot receive focus.

**Commit:** `feat(ui): add stack-safe cue dialogs`

---

## Task 2 — Migrate direct-song controls, practice, and audio foundations

**Files**

- `app/context/PlayerContext.tsx`
- `app/api/song/[id]/route.ts`
- `app/(client)/posts/[slug]/page.tsx`
- `app/(client)/posts/[slug]/loading.tsx`
- `app/components/ChordChart.tsx`
- `app/components/SongAudioSection.tsx`
- `app/components/PracticePlaylistButton.tsx`
- `app/components/AudioPlayer.tsx`
- Create `app/components/AudioTransport.tsx`
- `app/components/EditSongButton.tsx`
- Add focused component, context, and API tests.

**Work**

- Recompose the direct song page in the order identity → key/BPM/time → practice resources → lyrics/chords → past context → edit action.
- Use one primary Cue Cut at song identity; resources become flat equipment-style rows.
- Add explicit JSX layout utilities to 2A callers before overriding any legacy shared-selector property they depend on. Keep shared CSS fallbacks for later consumers.
- `ChordChart` is shared with the legacy SongSheet. Keep its existing rendered structure, layout classes, transposition behavior, and content output unchanged in 2A except for accessible naming/state attributes. Apply the direct-page cue surface around it at the page callsite; the shared component stays visually stable through 2B.
- Make sheet requests generation-owned and abortable in PlayerContext without changing its public contract. Starting a newer song or closing the legacy sheet invalidates the prior request; only the current generation may set sheet, loading, error, or play-key state.
- Expose minimal observable audio readiness after PlayerContext creates its `Audio` element. Transports subscribe from that state rather than calling `getAudio()` once before initialization.
- When `playTrack` begins from a focused control, capture that connected element as the audio origin. The client layout marks `<main>` as a programmatically focusable route fallback outside normal Tab order.
- Bring authenticated SongSheet history into parity with the direct song page: compute `today` in America/Mexico_City and require `week < $today`. This is the master contract’s sole read-result exception; preserve response shape and legitimate past history.
- Migrate EditSongButton’s independent editor to CueDialog. Name the icon trigger with the song title and the dialog close action. Associate title, artist filter, key, BPM, time signature, lyrics, musical URL, lyrics-video URL, and tag filter labels with controls.
- Give EditSongButton’s section/format toolbar, tutorial/reference add actions, and every indexed repeated field/remove action unique names. Name/group the author and tag collections, and expose each option with `aria-pressed`.
- Give ChordChart’s switch the name “Mostrar acordes” while preserving `aria-checked`. Index duplicate chart selectors in their names and expose selection with `aria-pressed`; retain the already named/pressed transposition-key controls.
- Give every SongAudioSection play/pause/download action an indexed name containing its track title so duplicate titles remain distinguishable.
- Preserve chord transposition, playback, history links, PDF/reference URLs, permissions, fallbacks, and the known one-chart save behavior. Characterize EditSongButton’s exact payload.
- Harden EditSongButton tag and author metadata loads independently. Each has pending, failure, and retry state. Save failure stays inside the open dialog; success may use a global toast only after close.
- Convert PracticePlaylistButton from partial menu semantics to a disclosure with a stable trigger ref, `aria-controls`, `aria-expanded`, normal Tab order, and outside-click/selection close. Escape and selection restore the still-focusable trigger with `preventScroll`. While a practice request is pending, keep the trigger focusable with `aria-disabled="true"` instead of native `disabled`; guard click, Enter, and Space activation so repeated activation cannot open a second reserved window or send a second request.
- When the disclosure handles Escape, call `preventDefault` and stop propagation before closing so CalendarView’s legacy window listener cannot dismiss its parent day dialog.
- On Música/Letras selection, synchronously reserve a blank external window during the trusted click before awaiting `/api/practice-playlist`, immediately detach its `opener`, close the disclosure, and restore the trigger. If reservation is blocked, show local retry feedback and do not begin a request.
- Preserve the exact practice POST body. After a valid `res.ok` response with a non-empty URL, navigate the reserved window to that URL. On non-2xx, rejection, parse failure, or empty URL, close the reserved window, show local retry feedback, and clear pending in `finally`.

### Audio contract

- Extract existing play/pause, seek, elapsed/duration, and close-track controls into presentational `AudioTransport`.
- Global AudioPlayer renders that transport when no dialog owns interaction.
- Freeze props and behavior needed for 2B to render the same transport inside SongSheet without revisiting PlayerContext or AudioPlayer.
- PlayerContext remains the sole playback owner; audio survives sheet open/close.
- Closing the global transport restores focus with `preventScroll` to the captured audio origin when it is still connected and operable. If it disconnected, focus moves to the route `<main>` fallback rather than `body`. The frozen close interface also accepts a caller-owned fallback so 2B can prioritize SongSheet’s connected close button while the route is inert.

**Tests**

- Legacy catalog/DayCard SongSheet activation and background scroll remain unchanged.
- PlayerContext close-during-load and out-of-order request tests prove stale work cannot reopen or overwrite the newest legacy sheet or play key.
- Audio readiness attaches elapsed/duration listeners once, cleans them up, and updates after metadata/time events when the transport mounted before `Audio` existed.
- SongSheet API excludes today/future referencing setlists and retains ordered past history with the unchanged shape.
- Direct-song loading, loaded, and failed states preserve hierarchy and navigation.
- ChordChart fixtures with two same-key charts cover indexed selector names and pressed state, the named switch, transposition/content parity, and identical legacy SongSheet structure/classes while the direct page supplies only external framing.
- Global audio covers pointer and keyboard play/pause, close, arrows, Home, End, and mobile safe areas.
- Global close from a focused control restores the connected playback origin without scrolling; after that origin unmounts, the same close restores the programmatic route fallback and never `body`.
- EditSongButton metadata rejection/non-2xx is independent per source, retryable, locally announced, and always clears pending. Save asserts the exact PATCH body and closes only after `res.ok`.
- Every editor field/action is located by accessible role and name, including indexed repeated rows.
- SongAudioSection fixtures include duplicate-titled tracks and require singular indexed play/pause/download role-name queries.
- EditSongButton tests use singular role-name queries for the named icon trigger, close, every associated field, section/format action, tutorial/reference add action, and two indexed tutorial/reference rows. Author/tag groups and options assert accessible names plus `aria-pressed` true/false state.
- With fetch deliberately deferred, Música and Letras each create/detach exactly one blank window synchronously before the promise resolves, assert the exact POST body, close the disclosure, and leave the trigger focused in pending and settled states. While pending, repeated click, Enter, and Space activation on the `aria-disabled` trigger creates no additional reserved windows and sends no additional requests. Success navigates the reserved window only after a valid response. Popup-blocked, non-2xx, rejection, parse, and empty-URL cases close any reservation, stay local/retryable, and clear pending; Escape reserves nothing and sends no request.
- In `/schedule` Calendar day → DayCard → practice disclosure, one Escape closes only the disclosure, restores its trigger, and leaves Calendar open; the next Escape closes Calendar.

**Commit:** `feat(songs): align direct song controls`

---

## Slice 2A preview checkpoint

1. Run `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check`.
2. Merge current `main` into the implementation branch and rerun.
3. Merge the complete 2A tree through `preview`, prove tree equality, verify the canonical Vercel project, and record the deployed SHA.
4. Review direct `/posts/[slug]`, its loading state, EditSongButton without saving, and global audio readiness/transport at 390×844 and 1440×900. Verify connected-origin and disconnected-origin close focus without scroll.
5. On Home `/`, open an upcoming DayCard’s practice disclosure at 390×844 with maximum text: association, normal Tab traversal, Escape and outside-click close, trigger restoration, and no submission. Repeat this DayCard disclosure check in the installed online PWA and iOS Simulator.
6. On `/schedule`, open Calendar day → DayCard → practice disclosure and verify one Escape leaves Calendar open and focused at the disclosure trigger. Repeat this nested check in one installed online runtime.
7. In one installed online PWA or iOS Simulator session on the deployed preview, perform exactly one read-only Música or Letras practice popup-generation check from a DayCard: verify the external blank window is created synchronously from the user gesture, its `opener` is detached, the app stays local and retryable while pending, and the reserved window navigates only after a valid response. This endpoint is allowed here because it creates no Sanity write; do not repeat it beyond the single recorded target-runtime check.
8. Repeat direct-song checks in the installed online PWA and iOS Simulator. Open the catalog/legacy SongSheet only as an unchanged structural, transposition, and control regression check.

Do not submit edits or any Sanity-writing mutations during manual QA. Practice generation remains mocked for success/failure/payload assertions except for the single target-runtime read-only popup check above. Obtain telemetry consent before authenticated surfaces.

**Slice 2A is done when** its cold approvals and gates pass on one recorded preview SHA, SongSheet/Calendar remain behaviorally legacy, and its approved tree becomes the required baseline for 2B.
