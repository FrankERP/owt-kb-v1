# ADR-0049: «Mes por medio» is a rule setting, and the rules POST refuses another config version

**Date:** 2026-10-06 · **Status:** Accepted

> **Numbering.** ADR numbers follow the order records reach `main`; this is the next free
> number on `main` when written, and is renumbered in the merge of `main` if another record
> lands first (`adrIndex.test.ts` keeps the index honest). Solver v3, child C3 (parent ruling
> A31: the child that introduces the behaviour writes its ADR). Spec:
> `docs/superpowers/specs/2026-10-05-solver-v3-c3-cadence-config-design.md`.

## Context

Some members lead Sundays every other month. Until v3 the only way to express it was ticking and
unticking them in the pool checkboxes by hand (ADR-0046), which records nothing. v3 needs the
setting stored, resolvable to one member, and inert under v2 until the flip.

The document it lives in is the hard part. `POST /api/admin/solver-config` replaces the WHOLE
`solverConfig` document, and its parser deliberately drops unknown fields («refusing to save
because the client is newer helps nobody»). The client normalises every read through the same
reader, which keeps only the fields it knows, and the rule form rebuilds a restriction from its
own state. So a tab whose bundle predates a field reads it away, and its next «Guardar reglas» —
about any rule — erases it for every admin. Preview writes the same document as production, and
`preview` deploys first, so during every release the older route is a live writer of a document
the newer one may have extended.

## Decision

- **A restriction setting, keyed by name, storing no state.** `solverConfig.restrictions[].sundayCadence`
  is absent («Normal») or `"alternate"` («Mes por medio») — never `null`, never `"normal"`. It is
  keyed by the restriction's `person` like every rule, not stored on `teamMembers` (ADR-0029: Tipo
  is the only eligibility axis; the cadence shapes a share, it never makes anyone eligible). The
  cadence STATE is never stored; C2 recomputes it.
- **Refuse, never merge: a config version.** `SOLVER_CONFIG_VERSION` (2) in
  `app/utils/solverConfigWriteRequest.ts`. Every save carries `configVersion`; the route refuses
  anything else with `400 invalid_request` (`details.issues: ["configVersion"]`) after auth and
  the body's JSON/shape check, before the stored document is read or `config` is parsed, and
  every GET and POST echo carries the version, so a client meeting another one disables its own
  save. A field **or an allowed value** an older
  client would drop or rewrite bumps it in the same change; `solverConfigVersion.test.ts` pins
  the key set at every level and the accepted values of `sundayCadence`, `fairness` and cap `op`.
- **One exact count per person per role (parent A38), checked at save by `person` TEXT.**
  `exactCapOverlaps` refuses two `==` caps whose `rolesOfPattern` roles intersect, within one
  restriction or across restrictions whose `person` matches case-insensitively after trimming.
  The route holds no roster, so two spellings of one member, and an overlap on `Sat.Choir` alone
  (not one of the five v2 keys), are refused at v3 build time by C2, by member id.
- **Every other writer of rule values goes through the parser and serializer.** A writer that
  sets or restores a restriction, cap, week exclusion, conflict, presence or cadence value reads
  through `solverConfigFromDocument`, changes only its paths, runs `parseSolverConfigWrite`, and
  writes only what `solverConfigFields` produced, under `ifRevisionId`. This supersedes the two
  one-off scripts of 2026-09-29 and 2026-10-01 (kept in the private log repository), which
  appended caps and whole restrictions with no parser — a repeat would bypass the A38 check and
  the field's validation. The member DELETE's pool-array patch and the rule-name repair script's
  single-`person` patch stay as they are.
- **The resolver filters by ministry itself.** `app/utils/sundayCadence.ts` resolves a rule name
  to exactly one member over the unfiltered roster minus non-worship members
  (`normalizeMinistries`), because the planner's `members` includes kids-only members for a
  super-admin and not for a worship admin; one config gives one answer for both.
- **v2 is inert.** `v2View` removes the field and every restriction that carried only it, and is
  applied inside `solverPools` and the first-match `isExcludedFromLead`;
  `cadenceV2Inert.test.ts` asserts every v2 answer equal for a config and its v2 view.

## Rejected

- **Merging on the server** the fields a body lacks: indistinguishable from a deliberate
  «Normal», which is also absence.
- **Requiring the field on every restriction**: guards this one field; a version guards the next.
- **A required enum `"normal"|"alternate"`** as the field's shape: every stored restriction would
  change on its next save, for nothing.
- **`stale_revision` as the refusal**: an old tab renders it as «Recargar reglas», whose re-read
  goes through that tab's own field-dropping reader and can never produce an accepted body. A
  new conflict code would print «(error 409)».
- **v2 equivalence with only the field stripped**: holds trivially, but a cadence-only
  restriction would still reach `solverPools` and inject its person into `support` (or make v2
  refuse the month for a member with no Tipo) — which is why `v2View` removes whole restrictions
  that carried only the cadence.
- **Refusing a name at save** (and **a roster read on save** to judge A38 by member id): a read
  on a critical writer, and still unsound after a rename. Names are refused at build time (C2's
  resolver, C6's Auto) and warned at edit.
- **Checking A38 within one restriction only**: two cards for one person are reachable from the
  UI (E22), so the check also looks across restrictions.
- **Waiting for C2 IF2-16** (the six-key role map) before checking A38: C3 has no prerequisites.
  **A second, six-key pattern map** in C3 is worse: two expansions that can drift; C2 owns the
  six-key expansion, and the `Sat.Choir`-only gap is unreachable from the form and closed by C2
  at build time.
- **Accepting a stored overlapping pair until it is edited**: a save path that bypasses the rule.
  Every save is refused, naming the pair, instead.
- **An ambiguity chip on every card**: a v2-visible warning about a v3-only refusal, which C6
  already names at Auto. Under v2 an ambiguous non-cadence name has a defined first-match
  meaning, so the chip is on cadence restrictions only.
- **Rendering the «not ticked» warning under v2 with «don't tick yet» copy**: noisy for months
  and easy to misread. It is built in C3 and rendered only under v3.
- **Gating the engine-dependent copy on `SOLVER_ENGINE` now**: equivalent until C6, wrong under a
  Preview override after. The copy renders unconditionally and C6 adapts it on its
  effective-engine prop.
- **A caller-side ministry filter**: every consumer would have to remember it, and a forgotten
  one shows false «Nombre ambiguo» chips and v3 refusals for a super-admin only. **Narrowing the
  members route** instead: it changes a super-admin's admin lists, and a super-admin is the only
  role that edits `ministries`.
- **A third no-Tipo reason in the «not ticked» predicate**, with «Auto no correrá…» copy: it
  duplicates C6's refusal and changes the union that C6 and C7 consume. A cadence member with no
  Tipo is left out of the warning because its sentences («… este mes no dirige domingo ni sábado
  de compensación.») would misdescribe her: no month is solved for her to sit out, because the v3
  build refuses the whole month over her missing Tipo, and C6 names that refusal before any solve.

## Consequences

- **Rollback is UI-only once C2 ships.** Removing the «Domingo» control, the chips and the warning
  keeps the type, parser, serializer, reader, resolver, the guard (still 2), the A38 check — and
  the form's data path: `PersonRestrictionForm` still carries `sundayCadence` from
  `initialValues` to `onAdd`, or the first edit of a cadence card would erase it while the guard
  waved the body through. A full revert exists only before C2 ships, after listing every stored
  setting; a Vercel Instant Rollback or promote of production (or of `dev-owt-backstage`) to a
  deployment older than C3 IS that full revert.
- **Any pre-C3 deployment is a live writer of the shared document**: not only production during
  the release window, but older immutable deployment URLs and the `verify/service-readiness`
  deployment. No «Mes por medio» is saved anywhere until the production alias serves C3, and a
  tab loaded before the release sees «El servidor rechazó las reglas y no guardó nada.» on its
  next save (its old bundle cannot say more) — reload open admin tabs after the release.
- **A pair of exact counts saved before C3 blocks every save** until one cap is removed; the
  panel marks both cards so it is never a dead end.
