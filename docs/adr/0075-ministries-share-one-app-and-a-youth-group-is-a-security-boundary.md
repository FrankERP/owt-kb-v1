# ADR-0075: Ministries share one app, and a youth group is a security boundary

**Date:** 2026-10-27 · **Status:** Accepted

Amends [ADR-0019](0019-generalize-at-the-third-ministry.md): the third ministry has arrived, so the
generalization it deferred starts here, extracted from the two that exist. Implementation plan:
`docs/superpowers/plans/2026-10-27-multi-ministry-phase1.md`.

## Context

Frank asked (2026-10-26) to make Backstage serve several ministries «sin agregar ruido entre sí»,
like Planning Center. On 2026-10-27 he named the third ministry: **Pastores de jóvenes**, with three
groups, «Otro Nivel» (12–17), «Invencibles» (17–21/22) and «Emprendedores» (university's last year or
working, onward). They mostly run separately and sometimes together: every Saturday ONE roster names
pastors of all three groups («Encargado», «Apoyo», «Quién comparte»); a pastors' board meets every
three months; Sundays and weekdays each group keeps its own calendar; some events join two or three
groups. And: «No me gustaría que los pastores de Emprendedores vean el calendario de los de Otro
Nivel y viceversa».

Other facts that shaped it: worship's documents carry no ministry field (ADR-0019) and its permission
`requireActiveManager` is called from 35 files; Kids' planner has never saved a month (0
`kidsSchedule` documents, read 2026-10-20); a member with no `ministries` is a worship member
(`normalizeMinistries`), which is what made Kids a no-migration change.

## Decision

1. **One app, one roster.** A person is the church's, not a ministry's: one login, one profile, one
   list of unavailable dates. New ministry-owned documents of a generic type carry a `ministry` field
   in the same dataset; absent means worship. (Today's ministry documents carry none: worship's and
   Kids' own types, such as `kidsPair` and `kidsSchedule`, say which ministry they belong to.)
2. **Jóvenes is ONE ministry with three groups inside**, and the group is a security boundary enforced
   on the server, exactly like the ministry (ADR-0020): a meeting names the groups it belongs to, and
   only members of one of those groups, the ministry's admins and a super-admin may read it. A joint
   meeting is visible, with its whole team, to the groups that take part.
3. **Permissions are added beside the legacy fields, not instead of them.** `ministries` stays the
   membership list (and must name a new ministry explicitly); `role` stays worship's level;
   `managesMinistries` stays Kids'. A new `ministryRoles` (ministry, level `member`/`leader`/`admin`,
   groups) carries level and groups for ministries that need them. One function reads all four.
4. **Worship is not migrated.** Its documents, solver v3, the fairness ledger and its nine write paths
   stay as they are. Kids moves onto the generic model first (phase 3): it has never saved a month, and
   its pairs (`kidsPair`) are its only stored data (read 2026-10-20), so its move is small but is still a data change
   that needs a dry run and Frank's consent.
5. **Each ministry has its own OPTIONAL engine and its own rules**; planning by hand is the base. No
   load is summed or shown across ministries (Frank, 2026-10-27).

## Rejected

- **Each youth group as its own ministry.** Isolation would come free, but the weekly Saturday roster
  and the joint events would be created and kept identical three times, a pastor in two groups would
  get every notice twice, and the ministry's admins would hop between three ministries to see one
  week. The joint meetings are weekly, not rare.
- **Groups as tags or a screen filter.** A filter hides; it does not protect. Typing the URL would
  show another group's calendar — the exact thing Frank asked to prevent.
- **One `ministryRoles` for everyone now, migrating worship and Kids into it.** The cleanest model, but
  it rewrites every member's permissions in production with a script and touches every guard, in a phase
  meant to change nothing visible. A mistake there locks someone out or lets someone in.
- **A dataset or an app per ministry.** Splits the roster; cross-dataset references are a paid Sanity
  feature; ADR-0019 already rejected a separate app.

## Consequences

- **The trap this creates:** absent `ministries` means worship. A pastor written with only
  `ministryRoles` would read as a worship member and see the catalog, the setlist emails and the
  calendar feed. Every write of `ministryRoles` therefore requires its ministry to be named explicitly
  in `ministries`, and the read ignores a `ministryRoles` entry for a ministry the person is not in.
- **Old code reads the new id as worship.** Code that predates registering `jovenes` drops the
  unknown id, and an empty list falls back to worship, so a stored `["jovenes"]` reads as a worship
  member there. The code that reads `jovenes` therefore reaches production before anything can write
  it, and is never rolled back while anyone holds it (the access plan's §4).
- **Two permission shapes coexist** until worship or Kids move. That is the price of not migrating;
  one read function keeps the guards from open-coding either shape.
- Do not "simplify" groups into separate ministries or into a UI filter: both were weighed above.
- **People live outside worship's admin** (Frank, 2026-10-29). `/admin` is Alabanza's admin
  (`requireActiveManager` reads the worship `role`), so the roster that spans every ministry moved
  from its Miembros tab to `/super-admin` «Personas» (super-admin only; an old `?tab=members` link
  redirects there). Next, each ministry's own admin manages its own people (phase 3); do not move
  «Personas» back under `/admin`.
