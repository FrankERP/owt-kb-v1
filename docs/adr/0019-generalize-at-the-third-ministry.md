# ADR-0019: Ship Kids as its own vertical; generalize at the third ministry

**Date:** 2026-08-19 · **Status:** Accepted

## Context

Kids leadership asked for the same automated monthly scheduling the worship team
has, under rules that share almost nothing with worship's: every Sunday needs
four **pairs** (Enseñanza plus three age rooms), each room has a fixed roster of
four pairs that only cover that room, Enseñanza draws from the whole pool, and a
pair cannot hold two seats the same Sunday. Worship schedules *individuals* into
role documents (`sunday_role`/`saturday_role`/`special_role`) across five
member-referencing seat shapes, on Saturdays and Sundays, solved by an OR-Tools
service. Kids has no Saturdays, no solver, no setlist, no proposals.

The overlap between the two ministries is exactly the primitives every ministry
needs identically: member documents, SSO, `unavailableDates`, and
ministry-scoped auth. Everything above that line differs.

That is a two-example dataset, and Backstage is meant to keep growing toward a
multi-ministry app. The choice this forced: build the generic
"ministry scheduling" model now, on one exemplar plus a plan, or build the second
vertical concretely and extract later.

## Decision

**Kids ships as a Kids-specific vertical.** `kidsPair` and `kidsSchedule`
(`sanity/schemas/`) are Kids document types with Kids field names; the rotation
is a pure in-app function (`app/utils/kidsRotation.ts`, `kidsTypes.ts`) with
Kids vocabulary — `KidsRoom`, `KidsSeat`, `ensenanza` — not a configurable
constraint engine. `/kids` and `/api/kids/*` are Kids routes.

What is **shared** is only the layer that was already identical for both:
`teamMembers` (one roster, one SSO login, one `/me` availability form) and the
ministry-scoped guards in `app/utils/authGuards.ts`.

`app/ministries.ts` is a code-level registry of two entries. Adding a ministry
is a code change on purpose, and its header comment points here.

**Generalization is deferred until a THIRD ministry exists**, so the abstraction
is extracted from two working examples rather than speculated from one.

## Rejected

**Generic ministry-scheduling schemas now** — a `ministrySchedule` document with
configurable seats, eligibility rules and a rule-driven rotation, so Kids is
"just configuration" and ministry three is free.

With n=1 real exemplar, the generic model would have been fitted to worship's
shape and then bent to Kids'. The two disagree on the unit being scheduled (a
person vs. a **pair**), on the calendar (Sat+Sun vs. Sun only), on where seats
live (five distinct member-referencing shapes on three role types vs. one flat
seat map), and on how a schedule is produced (a remote OR-Tools solver vs. 127
lines of local rotation). A configuration surface wide enough to express both
would encode worship's accidents as the framework's rules — and the cost of
discovering that is a **schema migration of live production documents**, which
this repo pays for in dry-run scripts, explicit consent, and a Studio redeploy.
Deferring costs nothing today; guessing costs a migration.

**A separate Kids app.** It splits the roster — the same people appear in both
ministries (a worship musician who also teaches Kids), and the rotation's
worship-overlap warning depends on reading worship assignments for the same
Sunday. Two apps means two auth stacks, two deploys, two upgrade treadmills, and
a cross-app read for a warning that is a local array lookup here.

## Consequences

**The third ministry pays an extraction cost**, and it is the intended bill: it
generalizes from `kids*` plus worship's role documents rather than from a
guess. Read this record before starting — the answer is "extract from the two
that exist", not "design a framework".

**Until then, Kids code stays boring and greppable.** `grep -rn kids` finds the
entire vertical; a Kids bug is fixed in Kids files and cannot regress worship.
The reverse also holds: worship changes must not reach for kids types.

**Do not "DRY up" Kids and worship into a shared scheduler because they look
similar.** That is precisely the move this record rejects, and doing it with two
examples in hand is a judgement call to make deliberately (and re-record here),
not a cleanup.

**Worship documents carry no ministry field and never will until generalization
day.** Absent `ministries` means worship — that is what made this a
migration-free change (`normalizeMinistries`, `app/ministries.ts`), and it is a
constraint on the eventual generic model, not an accident to tidy away.
