# ADR-0036: A «Noche de alabanza» is a special's `format`, not a fourth role type

**Date:** 2026-09-22 · **Status:** Accepted

## Context

The Campamento wanted per-song leaders for its Noche de Alabanza (Saturday 3 October
2026): a block's Lead pool leads one or two songs each, while the others sing BGV for
that song, and every song row needs to show who leads it. Three role types
(`sunday_role`/`saturday_role`/`special_role`) are already enumerated across member
reads, reminders, notifications, integrity, publishing, identity, the planner and the
group fill (spec `2026-09-22-worship-night-song-leads-design.md` §2). PR #90 had just
given specials their own `time`, and PR #91 their own stored-mode group fill; both are
built on `special_role` being one document shape.

## Decision

«Noche de alabanza» is `special_role.format = "worship_night"`, set once at creation.
`POST /api/admin/roles` accepts it; the PATCH route never sets or unsets it — it is not
in `buildRoleEditPatch`'s `set` or `unset` — so a stored-mode full-array save cannot
erase it. A wrong format is fixed by deleting the empty service and creating it again.
Each song item of a worship night's `songs` gains an optional `leads`: one or two keyed
member references, drawn from the role's own `Lead`. `app/utils/serviceFormat.ts`
(`WORSHIP_NIGHT_FORMAT`, `isWorshipNight`) is the one definition of the format;
`app/utils/songLeads.ts` is the one set of rules for who may lead a song.

## Rejected

**A fourth document type, `worship_night`.** Every one of the eight surfaces above would
need a fourth branch for behaviour a boolean-shaped flag already carries, and a new type
starts over on everything specials just got: date+name identity (ADR-0011) and `time`
validation (`app/utils/serviceTime.ts`), group fill (`fillSpecialGroup`), stored-mode
keying, and the create/PATCH split that keeps a fingerprint stable. Nothing about "who
leads this song" needs a different document — it needs one more optional field on the
one that already exists.

**Leaders on every special, no format flag.** Simpler storage — one field, no gate — but
the setlist editor would offer a leader picker and nag «Aún no dirigen» on every ordinary
vigil, where the concept does not apply. The format flag is what lets the editor, the
planner's Lead cap, and the notification email all ask one question instead of inferring
intent from whether any song happens to carry `leads`.

## Consequences

- Per-song leaders live only on a worship night's own song items; weekend setlists
  (`featuredSongs`/`saturdarSongs`) and proposals never carry `leads` in this delivery.
- The setlist writer validates `leads` against the target's `Lead` seat as loaded for
  that write, under the role `_rev` the write already asserts, and refuses the write
  (400) when a leader is not in that seat — a seat change landing between the check and
  the commit fails the write rather than storing a leader who has just left Lead.
  Proposal approval never refuses: it FILTERS the carried-over leaders to the current
  Lead, dropping anyone no longer seated there, so an approval always succeeds and a
  stale leader is silently dropped rather than blocking the approval.
- The format cannot be changed after creation. There is no migration path from an
  ordinary special to a worship night or back; the only fix is deleting an empty service
  and recreating it with the right choice in «+ Nuevo servicio».
- `leads` is a strong Sanity reference, the same as every other seat reference. A member
  who still leads a song on a stored worship night cannot be deleted in Studio until that
  reference is cleared — an admin must remove them from the song (or the song) first,
  the same workflow already required to delete a member seated in Lead/BGV/Chorus.
- **Release-window hazard.** Between the push to `preview` and the merge to `main`, dev
  and production run different code against the SAME Sanity dataset. Production's old
  setlist PUT and old proposal approval still rebuild a special's `songs` without
  `leads`, so a save or an approval made through production wipes any leaders assigned on
  dev; production's old outbox sweep drops `leads` on both sides of its comparison, so a
  leader-only change made on dev nets out to silence with no email once production's code
  reads it. Assign song leaders only after this delivery has reached production — see
  `docs/NOTIFICATIONS.md`. A variant of this hazard outlives the release window: an admin
  BROWSER TAB loaded before the production deploy runs the OLD `SetlistEditor`, which
  sends rows with no `leadIds` at all. The NEW setlist PUT, already live in production,
  parses that missing field as "no leaders" and stores the songs without `leads` — so
  after the production deploy, every admin reloads `/admin` (and the phone app) before
  editing a worship night's setlist.
