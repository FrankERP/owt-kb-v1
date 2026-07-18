# Backstage Cue System — Master Contract

**Goal:** Carry the Backstage identity through the member and admin experience so the app feels like one clean, premium worship-production system rather than a branded shell around unrelated dark UI.

**Audience:** Oasis Worship Team members need to understand the next service, rehearse songs, and manage availability quickly. Leaders and administrators need a dense but calm operational workspace for setlists, assignments, content, and proposals.

This document is the stable design, safety, and delivery contract. Implementation detail lives in four bounded slice plans, and repository dependencies are recorded separately:

1. [Slice 1 — foundation, shell, and catalog](./2026-07-16-backstage-cue-system-slice-1-foundation.md)
2. [Slice 2A — dialog platform and song cues](./2026-07-16-backstage-cue-system-slice-2a-dialogs-songs.md)
3. [Slice 2B — schedule and service operations](./2026-07-16-backstage-cue-system-slice-2b-schedule-services.md)
4. [Slice 3 — member and admin workspaces](./2026-07-16-backstage-cue-system-slice-3-member-admin.md)
5. [Audited dependency matrix](./2026-07-16-backstage-cue-system-dependencies.md)

The dependency matrix, not route proximity, determines atomic migration boundaries.

---

## 1. Visual identity

### Thesis

Backstage is a **cue system**, not a generic neon dashboard. Its visual language comes from cue sheets, stage-light seams, equipment labels, and the calm precision of a production desk.

The logo-derived **Cue Cut** is the signature: a diagonal split crossed by a thin cyan beam. It appears only on the current, selected, or primary surface. This is the design’s one deliberate visual risk; everything around it stays quiet and disciplined.

### Palette

- **Blackout** `#010B17` — page field and modal backdrop.
- **Console** `#071624` — secondary workspace surfaces.
- **Deck** `#0D2234` — elevated and primary surfaces.
- **Beam** `#12C8F4` — navigation, focus, action, and the Cue Cut.
- **Signal** `#37F58A` — confirmed, assigned, ready, or currently active.
- **Frost** `#D7E7F6` — primary text and high-contrast markings.
- **Steel** `#7F94A8` — supporting text.
- **Caution** `#F0A33A`, **Special** `#9C83F6`, **Danger** `#F2636B` — semantic states only.

Cyan means “you can act or navigate.” Green means “ready or confirmed.” Neither is neutral decoration.

### Typography

- **Advent Pro 600 / `font-display`:** page and panel titles, song titles, service names.
- **Urbanist 400/600/800 / `font-body`:** names, lyrics, forms, readable content, and help.
- **Jura 600 / `font-label`:** keys, BPM, dates, statuses, navigation context, and short equipment labels.

Use sentence case for page and content titles. Reserve uppercase tracking for compact operational labels.

### Surface rules

1. One dominant surface per viewport section.
2. Nested content uses rows and dividers, not cards inside cards.
3. Cue Cut marks only primary/current/selected state; ordinary rows use a quiet cue rail or no accent.
4. Primary panels use 16px radii, controls 10–12px, and compact data cells 8–10px. Pills are status, not generic buttons.
5. Shadows establish depth; glow communicates live state. Normally only one strong glow is visible.
6. Decorative CSS never owns layout-critical positioning, inset, overflow, or transforms.

### Motion

- One 180–220ms Cue Cut reveal when a primary surface becomes current or a dialog opens.
- Hover/focus transitions remain 120–160ms.
- No per-card entrance animation in the song catalog.
- `prefers-reduced-motion: reduce` removes movement without hiding state.

### Responsive shell

```text
Desktop
┌─────────────────────────────────────────────────────────────────┐
│ [B + BACKSTAGE]          PAGE CONTEXT               [PROFILE]   │
├─────────────────────────────────────────────────────────────────┤
│ ╱ CUE CUT  PAGE TITLE                              STATE / CTA   │
│ │  primary operational surface · flat rows · data rails         │
└─────────────────────────────────────────────────────────────────┘

Mobile
┌──────────────────────────────┐
│ [B]                  [PROFILE]│  brand bar
├──────── PAGE CONTEXT ────────┤  centered cue strip
│ ╱ TITLE                STATE │
│ │ primary surface            │
└──────────────────────────────┘
```

---

## 2. Scope and invariants

### In scope

- Brand tokens, hierarchy, surfaces, controls, status language, motion, loading/empty/error states.
- Client shell, catalog, songs, services, schedule, member workflows, and admin workspaces.
- Stack-safe dialogs, accurate disclosure/popover semantics, focus restoration, and modal-local feedback.
- Desktop, mobile web, installed online PWA, and the online Capacitor iOS wrapper.
- Narrow mutation hardening only in handlers touched by the migration.
- One narrow member-read safety correction documented in Slice 2A: SongSheet history must match the direct song page’s past-only (`week < today` in America/Mexico_City) contract so upcoming setlists are not exposed as play history.

### Out of scope

- Sanity schema/data migrations, API payload contract changes, auth/role changes, notification changes, or GROQ result changes other than the single documented past-history safety correction.
- Embedded Sanity Studio redesign.
- New UI, icon, or animation dependencies.
- Dormant `BottomNav` activation or redesign.
- Android native runtime verification; responsive Android-sized browser checks still apply.
- Offline PWA/native support. The current PWA and Capacitor wrapper are online-only.
- The known one-chart save behavior in `SongFormModal` and `EditSongButton`.
- Business-logic refactors made only to reduce file size.

### Repository invariants

- Mexico City date handling remains unchanged; service dates render from local noon.
- Preserve deliberate `saturdarSongs` spelling.
- Preserve draft gating and all five member-reference seat categories.
- Preserve auth roles, server authorization, mutation payloads, revalidation, and successful behavior.
- Touched client mutations must catch failures, check `res.ok`, reset loading in `finally`, and never close as success on failure.

---

## 3. Delivery contract

### Branches and Vercel

1. Implement on `codex/backstage-cue-system`, starting from current `main`.
2. Commit bounded tasks with Conventional Commits and no attribution trailers.
3. Before a checkpoint, merge current `main` into the implementation branch and rerun its gates.
4. Update `preview` from current `main`, merge the implementation branch into `preview`, and require identical trees.
5. Push only `preview` to update `dev-owt-backstage.vercel.app`.
6. Before Vercel mutation, verify `.vercel/project.json` is project `owt-backstage`, ID `prj_elS88VGezKpy18wizFN1ffoy8cJ5`.
7. Record the deployed preview SHA. Approval belongs only to that SHA/tree.
8. Merge the exact approved preview tree to `main` only after explicit user approval.

Never deploy or alias the stable dev domain from a feature branch.

Slice 2A deliberately leaves SongSheet and Calendar legacy together and is independently preview-safe. Slice 2B then migrates the entire SongSheet → Calendar/DayCard → SetlistEditor/ServicesPanel graph in one preview tree; no intermediate 2B commit may reach `preview`.

### Checks for every implementation task

- `npx tsc --noEmit`
- `npm test`
- `git diff --check`
- Targeted browser checks at 390×844 and 1440×900.
- Keyboard-only checks for changed interactions.
- App “Máximo” text-size check for changed member-facing screens.

### Additional checks at every preview checkpoint

- `npm run build`
- Clean browser console/network for the checkpoint routes.
- Reduced-motion verification.
- Before/after screenshots at 390×844 and 1440×900.
- Installed online-PWA safe-area, text-size, focus, dialog, and scroll checks.
- iOS Simulator checks against the recorded preview SHA, followed by restoration to production configuration and a clean tracked diff.

Slice 1 must first add and document a validated `CAPACITOR_SERVER_URL` override. The default remains `https://owt-backstage.vercel.app`.

### Production-data safety during QA

Visual QA is read-only: open, type locally, navigate, and cancel, but do not submit profile, availability, proposal, content, member, service, setlist, publish, swap, copy, or generator mutations.

Authenticated QA is not completely write-free. Before opening authenticated web, installed-PWA, or Simulator sessions, obtain explicit consent for:

- `ActivityPing` potentially patching production `lastSeen` once per 30-minute browser/session surface.
- Fresh sign-in creating a `loginEvent` and potentially patching `googlePhotoUrl`.

If consent is denied, authenticated gates are blocked and must not be reported as passed.

---

## 4. Completion

The migration is complete when:

- Backstage is recognizable without the logo through hierarchy, typography, Cue Cut, cue rails, and status language.
- Songs, services, member workflows, and admin tools feel related without forcing identical density.
- Every active modal uses the shared stack contract; documented disclosures/popovers remain nonmodal.
- No modal failure relies only on feedback outside the active dialog.
- All repository invariants, payloads, permissions, and date behavior remain intact.
- All four slice plans and final preview gates pass.
- The approved preview and production trees are identical.
