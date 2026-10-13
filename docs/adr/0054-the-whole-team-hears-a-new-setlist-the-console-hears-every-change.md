# ADR-0054: The whole team hears a new setlist; the console team hears every change

**Date:** 2026-10-13 · **Status:** Accepted

## Context

Frank asked that everyone get notified when a setlist is published, serving or not, and above
all the console team (Tipo `foh`), who prepare the mix per song whether or not they run it that
day. Until now the setlist email («Setlist listo» / «El setlist cambió») went only to the
service's participants (all five seats). The setlist PUSH already broadcast to the worship team
(`notifySetlistSaved`), but on 2026-10-13 **no member has a device token** (0 of 36), so push
reaches nobody: email is the only channel that actually notifies today.

The sender is a free Gmail account, bounded at roughly **500 recipients a day for all of the
app's mail** (`docs/SECRETS.md`). The worship team is 36 members.

## Decision

The `setlist` outbox notice keeps its participants and adds LISTENERS, resolved at flush in
`app/utils/outboxSweep.ts` (`SETLIST_LISTENERS_QUERY`, `resolveSetlistAudience`):

- **A new setlist** (empty `beforeSongs` snapshot, i.e. «Setlist listo» — the publish transition
  or the first songs on a published service) goes to **the whole worship team**: worship ministry
  (`WORSHIP_AUDIENCE_GROQ_FILTER`) and app access (`disabled != true`), **with or without a Tipo**
  (Frank, 2026-10-13: someone with no Tipo serves in no seat but still hears about the setlist).
  The two system accounts (`service-account-*`, `member-dev-verify`) are never listeners.
- **A change** («El setlist cambió») goes to the participants **plus the console team** only.
- Listeners are gated on the role being published, at the query, like the participants.
- Anyone the listeners query returns gets the diff on a change, never an introduction (the diff
  lists the whole current setlist anyway); that includes a console member newly seated.
- **`announcedRecipients`** on the notice records everyone «Setlist listo» reached, across
  sweeps, and a writer's re-queue does not clear it (unlike `servedRecipients`). A listener in it
  is not announced to again unless they are console. Without it, an edit landing while the large
  announcement is part-sent would send «Setlist listo» to the whole team twice.
- Each member's own «Setlist» email switch (`wantsNotification(…, "setlist")`) still applies.

## Rejected

- **Every change to everyone.** Changes repeat with every edit burst (each is its own email after
  the 5-minute debounce). At ~34 recipients a busy weekend — two publishes and a handful of edits —
  approaches Gmail's daily cap, and hitting it silences ALL mail for a day, assignments included.
  A new setlist happens once per service, so it is bounded.
- **«Setlist listo» to everyone, changes to participants only.** The console team would hold a
  stale setlist after any edit, which is exactly the group Frank asked about.
- **Console team only.** Frank asked for everyone; the cost of "ready" to everyone is bounded.
- **A push broadcast at publish.** Cheap, but reaches nobody until the iOS app ships with tokens.

## Consequences

- A «Setlist listo» notice now has ~34 recipients (counted read-only in production on 2026-10-13: 36 worship members minus the two system accounts, none disabled), above layer 2's `emailLimit` of 20, so it is
  selected ALONE and the clock bounds it: 24–32 go out in the publish request itself (3–4 waves,
  set by the read phase) and the rest re-pend losslessly to the next layer-1 tick (≤ 5 min). Two
  services published together: the second goes on the next tick.
- **Unpublish then republish re-announces** to the whole team (each publish is a new
  `[] -> songs`), about 34 emails each time where it used to be the participants only.
- Residual duplicate: an edit committed during the few seconds a sweep is SENDING the
  announcement makes that sweep's re-pend lose its revision check, so `announcedRecipients` is
  not updated and the next sweep announces again. Accepted: the window is the send itself.
- Gmail volume rises by ~34 per new setlist (~100/week) plus ~5 per change.
- Undoing the listeners puts non-serving members, including the console team, back to hearing
  nothing.
