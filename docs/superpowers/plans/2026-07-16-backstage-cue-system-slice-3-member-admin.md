# Slice 3 — Member and Admin Workspaces

**Outcome:** Apply the Backstage operating language to member and admin workflows, complete the remaining independent overlay migrations, and finalize shared SongForm only after all consumers can move together.

**Depends on:** approved Slices 1, 2A, and 2B, [master contract](./2026-07-16-backstage-cue-system.md), and [dependency matrix](./2026-07-16-backstage-cue-system-dependencies.md).

This plan has two checkpoints. Member work is reviewed before admin work begins; no unfinished member tree is carried into the admin checkpoint.

---

## Phase A — Member console

### Task 1 — Recompose profile, availability, and preferences

**Files**

- `app/(client)/me/page.tsx`
- `app/(client)/me/loading.tsx`
- `app/components/ProfilePanel.tsx`
- `app/components/AvailabilityCalendar.tsx`
- `app/components/TextSizeControl.tsx`
- Add focused tests under `app/components/__tests__/`

**Work**

- Present identity, upcoming assignments, availability, notification/text preferences, and proposals as distinct operating sections under one calm member console.
- Preserve alias-first display and make long names resilient at 390px and maximum text size.
- Migrate ProfilePanel’s drawer to CueDialog. Remove its independent focus/body-lock implementation while preserving file input, all mutation payloads, optimistic preference rollback, and mounted/closed behavior.
- Put pending/error feedback inside the open drawer. Successful post-close feedback may be global.
- Keep AvailabilityCalendar’s note editor nonmodal. Preserve anchoring, initial input focus, dirty-state/beforeunload, batch save, Escape, and outside click; add explicit focus restoration to the originating date trigger.
- Keep status colors semantic: available/ready, caution, unavailable/danger. Do not turn every date into a decorative chip.

**Tests**

- Profile, photo, password, and preference rejection/non-2xx retain the drawer, reset the correct loading state, and expose a local alert.
- Existing successful request bodies and optimistic preference rollback remain exact.
- Drawer naming, topmost dismissal, body lock, and focus restoration follow CueDialog.
- Availability stays nonmodal: the rest of the page remains operable, Escape/outside close it, trigger focus returns, dirty warning and save payload remain unchanged.
- 390px/max-text layout retains names, assignment content, and required actions without horizontal overflow.

**Commit:** `feat(profile): build the backstage member console`

### Task 2 — Migrate proposal workflow semantics

**Files**

- `app/(client)/me/propose/[roleId]/page.tsx`
- `app/(client)/me/propose/[roleId]/ProposalEditor.tsx`
- Add `app/components/__tests__/ProposalEditor.dialog.test.tsx`

**Work**

- Apply the same cue hierarchy, fields, buttons, validation, and status language as the member console.
- Migrate only the final submit confirmation to CueDialog.
- Keep the key picker and song search as nonmodal anchored popovers.
- Preserve the current interaction: confirmation closes before the POST begins; subsequent global feedback is therefore outside any active modal.
- Preserve all validation, exact payload, 409 conflict behavior, edits after failure, and success navigation.

**Tests**

- Escape/backdrop/cancel closes only confirmation and retains proposal edits.
- Confirm invokes the existing save exactly once with the same body.
- Network/non-2xx/409 behavior and `saving` reset remain unchanged.
- Key/search popovers retain outside-click behavior and do not claim modal/menu semantics.

**Commit:** `feat(proposals): align proposal workflow with cue system`

### Member preview checkpoint

Before beginning Phase B:

- Run required type, test, build, diff, browser, keyboard, max-text, screenshot, PWA, and iOS gates.
- Merge current `main`, then merge the exact member tree through `preview`; verify canonical project/tree and record SHA.
- Review `/me`, profile drawer, availability note, preferences, and `/me/propose/[roleId]` at 390×844 and 1440×900.
- Repeat representative flows in installed online PWA and iOS Simulator for safe areas, software keyboard, focus, and scroll restoration.

QA is open/type/cancel only. Do not save profile, photo/password, preferences, availability, or proposals. Authenticated surfaces require explicit telemetry consent; otherwise the checkpoint is blocked.

---

## Phase B — Stage-manager console

### Task 3 — Recompose the admin shell and operational rows

**Files**

- `app/(client)/admin/page.tsx`
- `app/components/admin/AdminPanel.tsx`
- `app/components/admin/AvailabilityPanel.tsx`
- `app/components/admin/ActivityPanel.tsx`
- `app/components/admin/ProposalsPanel.tsx`
- `app/components/admin/ParticipationSidebar.tsx`
- `app/components/admin/MonthGenerator.tsx`
- Add targeted tests under `app/components/admin/__tests__/`

**Work**

- Build a dense stage-manager workspace: stable section navigation on wide screens, compact horizontal tabs on mobile, clear panel identity, and stable action areas.
- Add explicit JSX layout utilities to each Slice 3 caller before the final audit removes any legacy shared-selector layout fallback.
- Convert the member, proposal, availability, and activity cards owned by this task to flat operational rows whose columns collapse deliberately on mobile.
- Standardize draft/published, filled/unfilled, role, proposal, and activity states with SignalChip.
- Migrate AdminPanel’s member add/edit/password/delete wrappers to CueDialog with local pending/error status.
- Preserve role-visible tabs, server authorization, data fetching, solver behavior, notifications, Sanity mutations, and exact request payloads.
- Extract only repeated presentational leaves. Do not move business logic merely to shorten files.

**Tests**

- Super-admin/admin/content-editor visibility and endpoints remain unchanged.
- Member add: exact `POST /api/admin/members` body; success closes/refetches, while non-2xx/rejection stays open with local alert and loading reset.
- Member edit: exact `PATCH /api/admin/members/[id]` body with the same success/failure guarantees.
- Password: exact `POST /api/admin/set-password` body `{ sanityMemberId, password }` with the same success/failure guarantees.
- Delete: exact `DELETE /api/admin/members/[id]`; success closes/refetches, while non-2xx/rejection stays open with local alert and loading reset.
- Photo upload is initiated outside these dialogs and is not behaviorally changed by this task; retain its existing endpoint and row-level state.
- Member dialogs preserve focus and body lock through CueDialog.
- Every “who serves” display still includes Lead, BGVs, Chorus, instruments, and FOH.
- Tables/rows remain usable at 390px/max text without hiding required actions.

**Commit:** `feat(admin): establish the stage-manager workspace`

### Task 4 — Complete ServicesPanel dialogs and mutation safety

**Files**

- `app/components/admin/ServicesPanel.tsx`
- Add focused service dialog, confirmation, disclosure, and mutation tests.

**Work**

- Preserve the Slice 2B CueDialog setlist-host callsite, authoritative loading, background-refresh contract, and nested regression.
- Recompose service cards as dense operational rows/cards with deliberate mobile column collapse, without changing their data or actions.
- Migrate every remaining ServicesPanel local modal use: add/edit/delete, swap confirmation, and MonthGenerator host.
- Replace copy-instruments and bulk-publish native `window.confirm()` with CueDialog confirmations.
- Confirm sends the existing request exactly once; cancel sends none and restores trigger focus. Pending disables duplicate confirmation.
- Non-2xx/network failure keeps the relevant dialog open, resets loading, and reports locally.
- Fix swap failure handling within the existing invariant:
  - do not claim complete success when any request fails;
  - refresh to truthful server state because partial multi-request success cannot be rolled back client-side;
  - keep/report the failure and direct the admin to review the refreshed assignments.
- Convert card action overlays from partial ARIA menus to disclosures with unique trigger/panel IDs, normal Tab order, outside/action close, and Escape focus restoration.
- Do not change endpoints, bodies, service date handling, publish semantics, or solver logic.

**Tests**

- Add/edit/delete/swap/generator dialogs have accessible names, local failures, topmost dismissal, focus restoration, and continuous body lock.
- Service add asserts exact `POST /api/admin/roles` body; edit asserts exact `PATCH /api/admin/roles/[id]` body; delete asserts exact `DELETE /api/admin/roles/[id]`. For each, success closes and refetches, while non-2xx/rejection stays open, resets loading, and reports locally.
- Copy and publish confirmations cover Escape/backdrop/cancel, zero requests on cancel, pending state, exact request body, success, non-2xx, and rejection.
- Card-swap and member-swap tests assert every exact `PATCH /api/admin/roles/[id]` body generated by the existing helpers. They cover all-success, first/second failure, partial success followed by refresh, no false success message, active-dialog feedback, and loading reset.
- Multiple card disclosures have unique associations, normal keyboard traversal, outside click, per-trigger Escape restoration, and no false menu roles.
- Slice 2B ServicesPanel → SetlistEditor → create-song and load/refresh regressions stay green.

**Commit:** `feat(admin): complete service operations`

### Task 5 — Migrate ContentPanel and finalize shared SongForm

**Files**

- `app/components/admin/ContentPanel.tsx`
- `app/components/admin/SongFormModal.tsx`
- `app/components/admin/SetlistEditor.tsx` only for shared-form visual/status integration if required.
- Add `app/components/admin/__tests__/ContentPanel.mutations.test.tsx`
- Extend shared-form and SetlistEditor tests.

**Atomic rule**

ContentPanel and shared SongForm land in one commit. Do not change shared form output earlier in this project.

**Work**

- Migrate ContentPanel add/edit/delete to CueDialog with inline pending/error status.
- Recompose content cards as flat cue-index rows with deliberate mobile action placement, preserving search, sort, permissions, and activation behavior.
- Restyle the shared SongForm with cue fields, actions, and status presentation now that both consumers are in reviewed dialog hosts.
- Harden local tag/author loading with `try/catch/finally`; a rejected callback cannot strand `creatingTag`/`creatingAuthor`.
- Harden ContentPanel tag/author callbacks and preserve selection updates on success.
- Retest SetlistEditor with the new shared form presentation and behavior in both DayCard and ServicesPanel parents.
- Preserve `buildPayload` exactly, including the documented one-chart behavior.
- After repository search proves no consumers remain, delete the legacy exported `Modal` and its manual Escape/focus code. Keep `SongForm`, `buildPayload`, and types.
- Keep global toasts only for success after the active dialog closes.

**Tests**

- Add/edit/delete/tag/author rejection and non-2xx keep the dialog open, preserve form contents, reset all loading, and expose a local alert.
- Tag success asserts exact `POST /api/content/tags` body `{ name }`; author success asserts exact `POST /api/content/authors` body `{ name }`. Each inserts/selects the returned option and clears its query.
- Tag/author non-2xx and rejection reset both the consumer callback state and SongForm’s internal loading state while keeping the form open with a local alert.
- Successful song creation/edit/delete sends exact existing URL/method/body and closes only on `res.ok`.
- Shared payload characterization remains unchanged for chord-marker and plain-lyrics input.
- Both SetlistEditor parent chains retain create-song success/failure and stack behavior after shared-form restyling.
- `rg`/dependency test proves zero `SongFormModal.Modal` imports or uses before deletion.

**Commit:** `feat(content): finalize cue-based song administration`

### Task 6 — Final interaction and identity audit

**Files**

- Audit `app/(client)` and `app/components`; modify only inconsistent states directly caused or exposed by this migration.

**Work**

- Inventory `role="dialog"`, `aria-modal`, modal-like fixed backdrops, `useFocusTrap`, and body-overflow writes. Every active modal must use CueDialog.
- Inventory `confirm(`. Only AvailabilityCalendar’s intentional `beforeunload` prompt remains native; ServicesPanel confirmations do not.
- Inventory active `role="menu"`, `role="menuitem"`, and `aria-haspopup="menu"`. NavMenu, PracticePlaylistButton, and ServicesPanel actions use disclosure semantics.
- Audit every modal mutation’s feedback location; failures/pending do not rely on inert siblings.
- Verify loading, empty, error, disabled, selected, focus, hover, safe-area, max-text, and reduced-motion states.
- Check Spanish action/result vocabulary for consistency.
- Remove only brand/modal classes made obsolete by this migration.
- After a repository-wide caller search proves every active consumer owns its required JSX geometry, remove the legacy layout-critical `position`/inset/overflow/transform fallbacks from decorative brand selectors and rerun all Slice 1–3 visual regressions.
- Remove excess Cue Cuts or glows if more than one strong signature competes in a viewport.

**Commit:** `fix(ui): complete backstage cue consistency`

---

## Admin and final preview checkpoint

1. Run `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check`.
2. Merge current `main` into the implementation branch and rerun.
3. Merge through `preview`, prove identical trees, verify the canonical Vercel project, and record the deployed SHA.

Review:

- `/admin` for every permitted role/tab: member, service, setlist, content, proposals, availability, activity, participation, and MonthGenerator.
- Member checkpoint routes again as regression coverage.
- Direct song, SongSheet, schedule/calendar, both SetlistEditor parents, and shared SongForm regressions.
- 390×844, 768×1024, 1440×900; max text; keyboard; reduced motion; clean console/network.
- Installed online PWA and iOS Simulator: safe areas, software keyboard, dialogs, focus/body lock, audio, and scroll restoration.
- Restore production Capacitor target and require a clean tracked native diff.

QA is open/type/cancel only. Do not submit content, member, service, setlist, publish, swap, copy, generator, profile, availability, or proposal mutations. Mocked tests own every success/failure/payload assertion. Authenticated sessions require telemetry consent.

Request explicit user approval of the recorded SHA/tree. If `main` moves afterward, rebuild/redeploy/review. Merge the exact approved preview tree to `main`; never substitute the sibling feature branch.

**Slice 3 is done when** member and admin checkpoints pass, all active dialogs share one stack contract, no legacy wrapper remains, design identity is consistent without excess decoration, and production receives only the explicitly approved preview tree.
