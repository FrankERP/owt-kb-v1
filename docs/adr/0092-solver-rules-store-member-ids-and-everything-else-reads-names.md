# ADR-0092: The solver rules store member ids; everything else reads names

**Date:** 2026-11-24 · **Status:** Accepted

> **Numbering.** 0092 because records are numbered in the order they reach `main`. `preview` also holds
> a 0092 (the solver-ops record, PR #177, not yet on `main`); that one is renumbered when this reaches
> `preview`, as was done for ADR-0091.

## Context

C1 of the 2026-11-19 improvement proposal, approved by Frank «antes de generar enero». A solver rule
named its person by TEXT (`restrictions[].person`, `conflicts[].personA/personB`,
`presence[].persons[]`), matched to a member by name or alias (`rulePersonNamesMember`). A changed
alias detached Vale's rule in 2026-08 (`scripts/fix-vale-sosa-rule.mjs`). A rename through the app or
the chat rewrites the rule texts in the same transaction (ADR-0082); a rename in **Studio** does not.
v3 Auto refuses a name it cannot resolve, but the planner grid's hard blocks, the specials fill and the
v2 rollback engine skip it silently.

The plan, `docs/superpowers/plans/2026-11-20-solver-rules-by-member-id.md`, went through the
critical-tier review (seven rounds, Frank's go-ahead at the churn cap, approved twice; review log
beside it) and Frank approved it on 2026-11-24.

## Decision

**Ids in storage, names everywhere else.** Exactly two pure functions translate, in
`app/utils/solverConfigWriteRequest.ts`:

- `rulePeopleToNames(doc, roster)` at every READ: each stored id becomes a label that resolves
  (`resolveRulePersonId`) to exactly that member, or to nobody. A worship member reads as their display
  name (else `member_name`); two worship members sharing both texts read «… (persona repetida)»; a member
  outside Alabanza reads «<nombre> (fuera de Alabanza)» (never the bare name, which a worship namesake
  would receive); an id that is no member reads «persona que ya no está en Alabanza». Non-resolving
  labels that collide, or that would name someone, are numbered « (2)», « (3)»… in the order of the
  stored token strings, so deleting a rule moves no suffix. It also returns `back`, label → stored token.
- `rulePeopleToIds(config, stored, roster, setMarker?)` at the WRITE, in the target's mode: a name that
  resolves to one worship member → that id; else a label in `back` (recomputed from the FRESH read) →
  its token; else the save is refused with nothing written: `ambiguous_person`, `not_worship`,
  `name_unmatched` (a name that matches only after spacing/Unicode normalisation) as a 400, and
  `person_changed` as a 409 `stale_revision` (`details.detail`), which the panel answers with
  «Recargar reglas». Then a presence list keeps each id once, and two `==` caps that now fix one role
  for one id refuse (`exact_overlap`).

The switch is a document field, `personTokens: "id"`, declared hidden in the schema and in
`studioProtection.ts`'s field list. Without it both translations are the identity, so the release
changes no stored byte. Only the consented script `scripts/rekey-solver-rule-people.ts` sets or clears
it (dry run with names only and four checks; `--apply --fingerprint`; `--to-names` for rollback).

Where they run, and nowhere else (`solverConfigReadCoverage.test.ts` lists every reader):
`solverConfigGetBody(doc, roster)` (the rules GET and `readRules`, so the planner, every MCP tool, the
availability sweep and the integrity queue receive names); `solverConfigCommit.ts` (both writers judge
the names view and write through the core); `scripts/lib/reconstructRun.ts`. The roster is always
`rulePeopleRosterQuery()`: every published member, any ministry, with `ministries`. The write core is
`app/utils/solverConfigWrite.ts` (no `server-only`, no module-level client), imported only by
`solverConfigCommit.ts` and the migration. In id mode `planRuleRename` and `orphanRuleWarnings` return
nothing: a rule keyed by id can neither be detached nor inherited by a rename.

No `SOLVER_CONFIG_VERSION` bump: the GET and POST bodies still carry names in both modes, so an open
older tab reads and writes the same shape.

## Rejected

- **Ids in memory, a label at every printer** (the plan's first draft). Two independent reviews each
  found printers the inventory missed (the fairness «registrar» dialog, the availability proposals, a
  rename's warning lines, five v3 refusal reasons); each would have shown an id to a person or the chat.
  The defect is the method: it needs every printer, present and future, to remember a translation.
- **A `personId` beside `person`.** Two sources of truth that every writer must keep in step.
- **More guards on names** (a nightly check, a Studio warning). Keeps the class of error and only
  watches it.
- **Converting on every save.** Would rewrite production rules at the first save after release,
  before Frank saw a dry run.
- **Ids on the MCP wire.** ADR-0084 KH-1 stays: the chat sends and receives names.
- **Sanity references** (strong or weak). A strong reference would make deleting a person named by a
  rule refuse through the members DELETE's referential-integrity path, a behaviour change nobody asked
  for; a weak one is the same id with more ceremony.

## Consequences

- **Rollback order.** With the marker set, run `--to-names --apply` BEFORE reverting the PR, a Vercel
  instant rollback to an older deployment, or an ADR-0056 restore of a names-era rules snapshot:
  older code reads ids as names (every Auto refuses, the chat prints ids), and names written into an
  id-mode document read as people who left. With no marker, all three are safe at any time.
- **Older code still pointed at the dataset** (an older immutable deployment URL, an old Mac checkout)
  reads ids as names once the marker is set: loud, not silent; nobody saves rules from an old URL.
- **The swap limit.** If X is renamed away from «Gaby» and Y renamed TO «Gaby» while a tab is open,
  that tab's save moves X's rule to Y, exactly as before. Closing it would need a label-map fingerprint
  echoed by every client. A suffix can likewise drift if a deleted person's token sorts differently
  after another is removed; the label still never resolves to anyone.
- **The grid stays silent on non-resolving labels**, as it is on unresolved names today; only v3 Auto
  refuses loudly («una regla nombra a una persona que ya no está en Alabanza…», `v3Copy.ts`).
- **Isolation.** «<nombre> (fuera de Alabanza)» shows a worship admin the current name of someone who
  left Alabanza, read through an all-ministries roster, only where a rule they can already see named
  that person; and the `not_worship` refusal tells a worship admin that a name exists in another
  ministry. Admins are trusted with both.
- **Names mode is not byte-for-byte a no-op:** the GET and the POST now also read the roster and fail
  closed (the existing «no se pudieron leer las reglas» path) when that read fails.
- The rename's rule rewrite (ADR-0082) stays for a names-mode document; deleting it is a later cleanup
  once a dry run shows no text token left.
