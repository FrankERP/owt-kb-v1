# «Noche de alabanza»: who leads each song — design (delivery 1)

**Date:** 2026-09-22 · **Status:** released to production 2026-09-23 (PR #93); song
leaders go in only after that release · **Risk tier:** mixed — the setlist writer and the proposal-approval carry-over are a
**critical** slice (§9); the rest is standard · **Builds on:** PR #90 (`special_role.time`) and
PR #91 (stored-mode group fill) · **Motivating event:** the Campamento's Noche de Alabanza,
Saturday 3 October 2026, 20:45.

## 1. How the team runs a worship night

Frank's description, 2026-09-22:

- A worship night is split into **blocks**. Each block has a **stage pool** of about five
  voices.
- **Each song is led by one or two people** from that pool. While one leads, the others
  sing BGV for that song. Some voices lead no song in the block and sing BGV throughout.
- Everyone not on stage in that block may be in the Coro. Voices rotate **between blocks**.
- **The goal** is variety of voices, and that everyone gets the chance to lead at a special
  event.
- **Admins decide who leads which song.** A later mode may let the leaders sign up for
  songs themselves, first come first served — delivery 2, out of scope here (§11).
- The app does not need to show the per-song rotation. It shows each block's pool, and
  who leads each song.

## 2. Decision

1. **«Noche de alabanza» is a format of a special service, not a new document type.** It is
   offered as its own choice in «+ Nuevo servicio», and stored as a `special_role` with
   `format: "worship_night"`. One service per block, each with its own name and time, as
   PR #90 already allows.
2. **The block's pool is its seats.** Whoever leads at least one song goes in **Lead**,
   which has no cap on a worship night; voices who only sing BGV go in **BGV**; Coro stays
   as it is.
3. **Each song of a worship night may name one or two leaders**, chosen from the block's
   Lead seat. The field is optional: a set can be built first and the leaders assigned
   later.
4. **Members see it.** Each song row shows «Dirige: Nombre» (or «Nombre y Nombre»);
   `/me` tells each member which songs they lead.

### Rejected

- **A fourth document type (`worship_night`).** Three role types are enumerated across
  member reads, reminders, notifications, integrity, publishing, identity, the planner and
  the group fill. A fourth would touch all of them for no behaviour a format flag cannot
  carry, and it would lose everything PR #90/#91 just built for specials.
- **«Dirige» on every special, no format.** Simpler storage, but the setlist editor would
  offer a leader picker and nag «Aún no dirigen» on every ordinary vigil.
- **A per-song roster** (who is BGV on each song). Frank ruled it out: the pool plus the
  leader per song is enough.

## 3. Data

### 3.1 `special_role.format`

- Optional string. The only value is `"worship_night"`. Absent means an ordinary special.
- Sanity schema: `specialRole.ts` gains the field (Studio stays read-only, as for every
  special field).
- **Set once, at creation.** `POST /api/admin/roles` accepts it; the PATCH route never sets
  or unsets it (it is not in `buildRoleEditPatch`'s `set` or `unset`), so a full-array
  stored-mode save cannot erase it. A mistaken format is fixed by deleting the empty
  service and creating it again.
- Create canonicalization emits `format` **only when present**, so every existing
  fingerprint stays byte-identical (the same rule as `time`). A weekend type carrying
  `format` is refused with issue `["format"]`; any value other than `"worship_night"` is
  refused the same way.
- Projected by `ROLE_PROJECTION` and the admin roles GET; typed on `ServiceRole`,
  `SpecialRole` and `GridColumn` (copied by `translateStoredRole`).

### 3.2 Song leaders on a worship night's setlist

- A special's songs live on the special document (`special_role.songs`). Each song item
  gains an optional **`leads`**: an array of **one or two** member references, each with
  its own `_key` (Sanity array rule).
- Present only on a worship night's songs. Weekend setlists (`featuredSongs` /
  `saturdarSongs`) and proposals (`setlistProposal.songs`) never carry it in this delivery.
- `setlistContentState` ignores the field, so content validity is unchanged.

## 4. Writing song leaders (critical slice — §9)

### 4.1 The setlist writer, `POST /api/admin/setlists`

- A song row may carry **`leadIds`**: an array of 0–2 distinct canonical member ids.
  Absent or empty means "no leader".
- **Refused** with issue `songs[i].leadIds` when:
  - the target is a weekend setlist, or a special whose stored `format` is not
    `"worship_night"`;
  - the array has more than two ids, a duplicate, or a non-canonical id;
  - an id is **not in the special's `Lead` seat as loaded for this write**.
- The special write already asserts the role document's `_rev`
  (`tx.patch(targetId, (p) => p.ifRevisionId(rev).set({ songs }))`), so a seat change that
  lands between the check and the commit makes the write fail instead of storing a leader
  who has just left Lead.
- `buildSetlistSongDocs` writes `leads` items (`{ _key, _type: "reference", _ref }`) only
  when the row has leaders.

### 4.2 Proposal approval, `PATCH /api/admin/proposals/[id]` (approve)

Approving a shared proposal rewrites the live setlist from the proposal's songs, which
carry no leaders. On a worship night that would silently wipe every assignment. So, **only
for a worship-night target**, approval **carries leaders over**: each new song row takes
the `leads` of the first not-yet-used live song with the same song reference, keeping only
the leaders still in the role's `Lead`. A song that is new to the list has no leader. The
approval transaction already asserts the role's revision, so the carry-over reads the same
state it commits against.

### 4.3 Seats changing after assignment

Stored-mode saves PATCH the seats and never touch `songs`. If a member who leads a song is
removed from Lead, their name stays on the song until an admin re-saves the setlist; the
setlist editor marks that song «Dirige alguien que ya no está en Lead» and the next
setlist save refuses it (4.1) until corrected. This is not an integrity error — it is a
workflow state an admin resolves.

## 5. Planner (stored mode)

- **No Lead cap on a worship night.** `hasTarget` returns `false` for the `lead` row on a
  column whose `format` is `"worship_night"`, so there is no target and no amber «+N».
- **The group fill does not pick leaders on a worship night.** `fillSpecialGroup` fills a
  worship-night column's BGV and instruments as today and skips its Lead row: leaders are
  chosen by an admin, so everyone gets their turn by design, not by load.
- **Composer:** the «Tipo» select gains «Noche de alabanza». It posts a `special_role` with
  `format: "worship_night"`, and needs a name and optionally a time, like «Especial».
- The stored column header shows «Noche de alabanza» instead of «Especial».
- The month CREATE flow never drafts a worship night.

## 6. Setlist editor (admin)

For a worship-night target only:

- Each song row gets a **«Dirige»** control: up to two people from the block's Lead, via
  the house `Menu` (never a bare `<select>`). Clearing it is allowed.
- A line under the list: **«Aún no dirigen: …»** — the people in Lead who lead no song yet
  in this set. It disappears when everyone has a song.
- A song whose leader is no longer in Lead shows «Dirige alguien que ya no está en Lead».
- Save sends `leadIds` per row.

## 7. What members see

- **Song rows** wherever a member sees a service's setlist — `DayCard` on home,
  `/schedule` and `/me`, and `SongSheet`'s list — show «Dirige: Nombre» or «Dirige: Nombre y
  Nombre» (alias when set) under the song title. A song with no leader shows nothing extra.
- **`/me`:** a worship night where the member leads songs shows «Diriges: Canción A,
  Canción B».
- Member reads project `"leads": leads[]->{ _id, member_name, alias }` and keep
  `published != false`. An unresolved reference (a deleted member) is skipped.

## 8. Notifications

- The setlist-change snapshot (`OutboxSongRow`) gains `leads: string[]` (member ids,
  sorted). A leader change is a setlist change and is emailed like any other.
- The setlist email renders each song's leaders after the title («— dirige Nombre»).
- `before` stays captured pre-commit (CLAUDE.md invariant).
- Audience is unchanged: a song leader is written only while in Lead, which is already one
  of the five seats every "who serves" query covers. A stale leader (§4.3) who has left
  every seat is not notified until an admin corrects the song.

## 9. Risk tier

- **Critical slice:** §4.1 and §4.2 — the setlist writer's full-array song serializer and
  the approval writer gain a member reference validated against another field of the same
  document. Per CLAUDE.md this slice gets an adversarial plan review: two sequential fresh
  `APPROVED` verdicts on byte-identical plan text, reviewers one at a time, churn cap after
  two substantive rounds.
- **Standard:** the create-time `format` (additive, fingerprint-stable, never patched —
  the same shape PR #90 used for `time`), the planner, the editor UI, member display and
  the email rendering. Fresh code review of the diff before any merge, as always.

## 10. Tests

- Create: `format` accepted on a special, refused on a weekend type and for any other
  value; fingerprint of a payload without `format` unchanged (pinned hex).
- PATCH: a stored-mode save of a worship night leaves `format` in place.
- Setlist writer: `leadIds` accepted on a worship night for Lead members; refused on a
  weekend target, on an ordinary special, for a non-Lead member, for three ids, for a
  duplicate; a concurrent seat change (stale `_rev`) fails the write.
- Approval carry-over: leaders kept for matching songs, dropped for new songs and for
  leaders no longer in Lead; an ordinary special's approval unchanged.
- Planner: no Lead target on a worship-night column; the group fill leaves its Lead empty
  and fills BGV.
- Editor: «Dirige» limited to Lead; «Aún no dirigen» lists exactly the unassigned Lead
  members; the stale-leader warning.
- Members: the «Dirige:» line and `/me` «Diriges:»; unresolved references skipped.
- Notifications: a leader change produces a setlist notice; the email shows leaders.

## 11. Delivery 2 (out of scope, recorded)

«Abierto para apuntarse»: a per-set switch that lets the block's Lead members claim songs
themselves, first come first served; a second claim on a taken song is refused and shown
as taken. It is a member-facing writer with a race by definition, so it gets its own spec
and its own critical review. The shared-proposal flow, which already arbitrates concurrent
co-lead edits, is the first candidate to carry it.

## 12. Rollout and timing

- Branch `claude/worship-night-song-leads`, stacked on PR #91.
- Target: in production before Saturday 3 October 2026, so the camp's Noche de Alabanza
  can use it.
- **Fallback that works today:** put every leader of the block in Lead and write the order
  in «Mensaje para el equipo».

## 13. Amendments made while planning (2026-09-22)

Read from the code for the plan (`docs/superpowers/plans/2026-09-22-worship-night-song-leads.md`):

- **The setlist writer is `PUT /api/admin/setlists`**, not POST. §4.1 applies to it.
- **`SongSheet` is out of §7.** Its «Set completo» list is a song's weekend play history, not
  a service's setlist; members see leaders on `DayCard`'s song rows (home, `/schedule`,
  `/me`), which is every place a member reads a service's setlist.
- **Proposals refuse `leadIds`** rather than dropping them: the shared song-row parser now
  reads the field, and a proposal that sent one would otherwise lose it silently.
- **Two neutral modules hold the rules** — `app/utils/serviceFormat.ts` (the format) and
  `app/utils/songLeads.ts` (every song-leader rule) — because client components import them
  and `roleWriteRequest.ts` pulls server-only code.
- **Notification snapshot compatibility:** `OutboxSongRow.leads` is present only when a song
  has leaders, so notices queued before this delivery, and every setlist without leaders,
  compare exactly as before. The email resolves leader names with one extra read in the
  sweep's read stage, before the send budget clock starts, like the song titles.
- **Approval builds its songs after loading the target**, because the carry-over needs the
  live songs and Lead; the approval fingerprint still hashes song id, key and medley only.
- **The flush side keeps leaders too.** `outboxSweep`'s `normalizeSnapshotRows`, which reads
  the stored `beforeSongs`, keeps `leads` (sorted, absent when empty); without it a no-op
  save would email and a clearing of every leader would not.
- **The leader-name read is best-effort:** if it fails, the email goes without names.
- **«Dirige» uses the house `Select`** (a `Menu` popover on desktop, the native picker on
  touch), not a bare `Menu` as §6 first said.
- **The Studio schema** gains `leads` on the special's inline `setlist_song` type, so Studio
  shows the field instead of «unknown field».
- **The setlist PUT checks leaders after the observed-target comparison**, so a stale editor
  gets the 409 reload path rather than a 400 a retry cannot clear.
- **Member reads project `leads[]->{ member_name, alias }`** (no `_id`, which nothing on the
  read side uses) on the home page, `/schedule` and `/me`; `/me` also projects `myLeadSongs`,
  the caller's own led-song titles, from `songs[$id in leads[]._ref]`.
