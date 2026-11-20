# Plan: the solver rules name a person by their member id, not by their name

- **Date:** 2026-11-20
- **Item:** C1 of the 2026-11-19 improvement proposal («Reglas del solver por persona, no por nombre»).
- **Requirement, in Frank's terms (proposal doc, approved order «antes de generar enero»):** a rule says
  «Vale» as text; if someone changes that alias the rule stops applying to her without anyone noticing
  (it happened: `scripts/fix-vale-sosa-rule.mjs`, 2026-08-31). Make the rules point at the person,
  so changing a name or alias anywhere (the app, the chat, **Studio**) can never detach a rule again.
  Production data changes only with Frank's explicit consent, dry run first.
- **Risk tier:** critical. This changes a production writer's payload and module boundary
  (`solverConfigCommit.ts`, the rules POST and the MCP rule tools) and migrates stored data. Two PRs; each PR's diff gets the usual
  merge-range code review.

## 1. What is true today (verified 2026-11-20 against main `fb685076` and production)

1. **Pools already store ids.** `sundayLeads`, `saturdayLeads`, `support` are `teamMember._id` lists
   (`plannerModel.ts` `solverPools` maps them through `memberIdToName`; `memberDelete.ts`
   `solverPoolCleanupPatch`; `ruleEdits.ts` pool edits push `m._id`). Nothing in this plan touches pools.
2. **Only four rule fields hold a person, as text:** `restrictions[].person`, `conflicts[].personA`,
   `conflicts[].personB`, `presence[].persons[]` (`sanity/schemas/solverConfig.ts`, `plannerModel.ts`
   types `PersonRestriction`/`ConflictRule`/`PresenceRule`). Stored by `personOf` = `normalizeLabel`
   (`solverConfigWriteRequest.ts`), case kept.
3. **How a text is matched:** `rulePersonNamesMember` (`app/utils/memberRuleNames.ts`): `member_name`
   or alias, trimmed, case-insensitive. v3's resolver `resolveRulePersonId` (`app/utils/sundayCadence.ts`)
   applies it to worship members only and demands exactly one match.
4. **What a detached rule does today:**
   - **v3 Auto (the live engine) refuses with a named line** when a rule's text matches nobody or more
     than one member (`resolveRulePersonId` callers: `v3Rules.ts`, `fairnessEligibility.ts`,
     `cadenceMembers`, `v3SolveRequest.preReadRefusals`). The solver itself already receives ids
     (`gcf_v3/owt_v3/request.py`: `people[].id`; unknown id → `Refusal("unknown_person")`). So in v3 a
     detached rule is LOUD, not silent: Auto stops until someone fixes the rule text.
   - **Silent today:** the planner grid's hard blocks (`ruleEnforcement.ts`) and the specials fill
     (`localFill.ts`) skip an unmatched name; the v2 rollback engine injects it as a phantom
     `support` person that binds nobody (`plannerModel.ts` `resolvedNameOrRaw`, `buildSolveRequest`).
5. **Who keeps names in sync today:** a rename through the app or the chat rewrites the rule texts in
   the same transaction (`memberRuleRename.planRuleRename`, called from `memberCommit.ts`; ADR-0082).
   A rename in **Studio** does not. A member DELETE cleans pools only; rules keep the orphan text.
6. **Production data (read-only query, 2026-11-20):** 11 restrictions, 7 conflicts, 1 presence; 13
   distinct names (Frank, Mkz, Gaby, Rex, Tony, Andy, «Vale 𑣲», Tay, Liu, Lucía, Niza, Hugo, Jakey).
   **Every one resolves to exactly one worship member.** One conflict is stored twice (Jakey–Hugo);
   this plan does not touch it (told to Frank separately).
7. **Exceptions that compare raw text:** `v3SolveRequest.ts` `exactLeadLabel` (`r.person !== person`),
   `solverConfigWriteRequest.ts` `exactCapOverlaps` (lower-cased text), and
   `leadPoolHistory.ts` `isExcludedFromLead` (`r.person === memberId`, a latent mismatch: it compares a
   name with an id and so never matches today).
8. **Constraints from records:** ADR-0049 (one writer chain `solverConfigFromDocument` →
   `parseSolverConfigWrite` → `solverConfigFields` under `ifRevisionId`; a change an older client would
   drop or rewrite bumps `SOLVER_CONFIG_VERSION`); ADR-0084 (the MCP rule tools are name-in, name-out:
   **no member id on the wire**, `monthToolHygiene.test.ts`); ADR-0082 (the rename's targeted `set`
   is an allowed targeted writer); ADR-0056 (the v2 rollback restore goes through the same chain);
   CLAUDE.md «Readable ≠ writable» precedent: ship the read side before anything writes the new form.

## 2. Decision

**A rule's person token becomes the member's `_id`.** Display names are derived at read time, as the
pools already do. During and after the move, every reader accepts BOTH forms through one resolver:
a token equal to a worship member's `_id` is that member; otherwise it is matched as a name exactly as
today. Writers produce ids only after every deployment that can read a rule understands ids.

Rejected:
- **Adding a `personId` beside `person`.** Two sources of truth; every writer must keep them in step,
  and Studio edits only one. The bug class stays.
- **More guards on names** (Studio validation, a nightly check). Keeps the class of error and only
  watches it; the proposal's reason for C1 is to make it disappear.
- **One PR that reads and writes ids.** `preview` writes the real dataset: the moment dev saved a rule
  as an id, production (still name-only) would refuse every Auto. Hence two PRs (expand, then contract).
- **Ids on the MCP wire.** ADR-0084 KH-1 stays: the chat sends and receives names; the server resolves.

## 3. PR 1 — readers understand ids (no stored data changes; no version bump)

### 3.1 One resolver, one label

- `memberRuleNames.ts`:
  - `rulePersonNamesMember(token, member)` takes `member: { _id: string; member_name: string; alias?: string }`
    and returns true when `token.trim() === member._id`, else the current name/alias test. Every caller
    passes `_id` (the type change makes `tsc` list them).
  - New `rulePersonLabel(token, roster)`, the ONLY way a stored token is shown to a person or put on
    the MCP wire. In order: a roster member whose `_id` equals the token → `displayMemberName(member)`;
    else, when the token is shaped like a member id (new `looksLikeMemberId`: no whitespace and
    `^[A-Za-z0-9_.-]{20,}$`, the shape of every member `_id` in production, UUIDs and 22-character
    Studio ids; no rule name in production has that shape) → «persona que ya no está en Alabanza»;
    else the token as written (legacy text, shown exactly as today). Callers pass the roster they
    already hold (the planner's worship members; the MCP tools' roster read). A member deleted or
    moved out of Alabanza therefore never shows as a raw id.
- `resolveRulePersonId` (`sundayCadence.ts`) is unchanged in shape; it inherits the id match through
  `rulePersonNamesMember`. An id that names a non-worship member stays «unresolved», exactly as a name
  of a non-worship member does today.

### 3.2 Every raw comparison goes through the resolver

- `v3SolveRequest.ts` `exactLeadLabel(person)`: compare `resolveRulePersonId(r.person)` and
  `resolveRulePersonId(person)` ids (both resolved once per call), not raw text.
- `leadPoolHistory.ts` `isExcludedFromLead(config, memberId, …)`: find the restriction whose token
  names `memberId` through `rulePersonNamesMember`, with the member row. This turns ON a check that
  was dead (§1.7): a Lead excluded by rule is no longer listed in «no dirigió el mes pasado». That is
  the function's documented purpose; the change is stated in the PR and has its own test.
- `plannerModel.ts` v2 path: `resolveToMemberName` matches `_id` first (`resolvedNameOrRaw` inherits),
  so v2's DSL still receives a NAME (the v2 solver is name-based by design) and an id token never
  reaches it raw. `nameToId` in `applySolveResponse` is unaffected (it maps solver output names).
- `ruleEnforcement.ts` (grid hard blocks, `unresolvedRuleNames` banner), `localFill.ts`,
  `pinViolations.ts`, `fairnessEligibility.ts`, `v3Rules.ts`, `scripts/lib/reconstructRun.ts`: each
  already matches through `rulePersonNamesMember`/`resolveRulePersonId`/`resolveToMemberName`; the PR
  verifies each call site and adds an id-token case to its existing test.
- `exactCapOverlaps` stays a text comparison in PR 1 (writers still write names, so two restrictions
  for one person are two equal texts). PR 2 makes every resolvable token an id, so text equality is
  id equality again. ADR-0049's build-time check by member id (C2) is unchanged.

### 3.3 Display: every printer, and a guard that catches the one this list misses

PR 1 must already print id tokens correctly: once PR 2 is on `preview` (which writes the real dataset),
production runs PR 1 against ids. So every place a stored rule token becomes text a person or the MCP
wire sees goes through `rulePersonLabel`. Inventory (grep of `.person`/`.personA`/`.personB`/`.persons`
interpolations on rule objects, main `fb685076`):

| Printer | Reaches |
|---|---|
| `ruleCopy.ts` (every line that names a person) | rule cards, forms, MCP rule tools |
| `v3RuleIds.ts` `capCardLabel`, `conflictCardLabel`, `presenceCardLabel`, `weekExclusionLabel` (gain a `members` argument) | `v3Rules.ts`, `v3SolveRequest.ts`, and through `v3MonthPlan.ts` the `solve_month` notices and refusals (`monthProposals/reports.ts`) |
| `ruleEnforcement.ts` pair sentences («Regla: no puede coincidir con …», «Regla: A y B no pueden coincidir») | planner grid, and through `editorBoard.ts` / `storedJudge.ts` the proposal and saved-month editors on the MCP wire |
| `ruleEdits.ts` refusals and notes that quote a stored token | `check_rule_edits`, `save_rule_edits` |
| `pinViolations.ts` (v2) and the v2 omitted-caps notice in `plannerModel.ts` | planner (v2 rollback only) |
| `solverConfigSource.ts` `exactOverlapFormMessage` / `exactOverlapRefusalMessage` (callers pass the label) | rule form, save refusal |
| `v3Copy.ts` `unresolved` and the cadence `cadenceNameNone` line | Auto refusals |
| `RestrictionCard`, cadence chips, `unresolvedRuleNames` banner (`MonthGenerator.tsx`) | planner |
| `getSolverRules.ts` | `get_solver_rules` |

`v3Copy.ts` lines that go through `n.person(...)` already map a solver person id to a name and need no
change. For an id-shaped token the `unresolved` line reads «Una regla nombra a una persona que ya no
está en Alabanza. Quita o cambia esa regla.» instead of «Corrige el nombre en la regla», which would be
wrong advice for an id. The pair sentences' comment («named with the RULE's own wording») stays true:
for a legacy text token the label IS the rule's wording; for an id it is the member's current name.

**The guard (the list above is not trusted to be complete):** a canary test, `ruleIdCanary.test.ts`.
Fixture roster whose members have realistic ids (`zQ7canaryMember0000000001`, 26 chars) plus one
dangling id token not in the roster; a config whose every rule person is an id, with each rule kind
(cap, week exclusion, conflict, presence, exact Lead). The test drives every surface that emits rule
text on paths that DO emit it: the planner line builders (`ruleCopy`, `v3Rules` notices, `ruleEnforcement`
over a grid that breaks each pair/hard block, `pinViolations`, the v2 DSL notices), and the MCP
handlers `solve_month` (a refusal from the dangling id and a notice from an exact Lead), the proposal
editor check (a pair finding), `check_service_edits` (a pair finding), `get_solver_rules`,
`check_rule_edits` and `save_rule_edits` (a refusal quoting a stored person). Assertion: no output
string contains any fixture id (substring), and each fixture member's display name appears where its
rule is quoted. A printer this table misses fails the canary on the surface that reaches it.

### 3.4 The MCP rule tools (name-in, name-out kept)

- `getSolverRules.ts` prints rule persons through `rulePersonLabel` with the roster it already reads.
- `ruleEdits.ts` `personToChange` and its `names` helper: a stored token that is a member's `_id`
  matches that member (the helper passes `_id` to `rulePersonNamesMember`). The orphan path (the
  name given equals a stored text) is kept for legacy text. A dangling id is reached by the name the
  tools print for it, «persona que ya no está en Alabanza»: when exactly one distinct id-shaped token
  in the stored rules matches no roster member, that name targets it; when more than one does, the
  edit is refused with «Hay N personas que ya no están en Alabanza en las reglas; quítalas desde
  /admin.» No id is ever echoed.
- `personToAdd` unchanged in PR 1 (still stores the display text).

### 3.5 The forms carry value and label apart (in PR 1)

`PersonRestrictionForm`, `ConflictForm`, `PresenceForm` (`MonthGenerator.tsx`) move from
`personNameOptions(members, preserve)` (a list of strings used as both value and label) to options
`{ value, label }`: each worship member is `{ value: normalizeLabel(displayMemberName(m)), label: same }`
in PR 1 (still writing names), and each stored token being edited is preserved as
`{ value: token, label: rulePersonLabel(token, members) }`. The select's value stays the stored token,
so editing a rule whose person is an id never shows the id and never loses it (the duty
`personNameOptions`' comment describes). `personNameOptions` becomes `personOptions` returning
`{value,label}[]`; its test keeps the "preserved token stays selectable" case and adds "an id token is
labelled, not shown".

### 3.6 Tests PR 1 adds

- `memberRuleNames.test.ts`: id match, name match, id of a non-worship member; labels of an id, of a
  name, of a dangling id with a realistic 22- and 36-character id; and a pinned case for the known
  limit of `looksLikeMemberId`: a legacy text token of ≥20 characters with no space and no match is
  labelled «persona que ya no está en Alabanza» (no production token has that shape, §1.6).
- One id-token case in each of: `sundayCadence.test.ts`, `fairnessEligibility.test.ts`,
  `v3Rules.test.ts`, `v3SolveRequest.test.ts` (exactLeadLabel), `ruleEnforcement.test.ts`,
  `localFill.test.ts`, `plannerModel.test.ts` (v2 DSL gets the name), `leadPoolHistory.test.ts`
  (newly live exclusion), `ruleCopy.test.ts`, `pinViolations.test.ts`, MCP `rules.test.ts`.
- The canary test of §3.3.
- **Equivalence test:** a fixture shaped like production's rules (§1.6, names replaced by fixture
  members) is evaluated once with names and once with the same rules re-keyed to ids; v3 eligibility
  (`resolveMonthEligibility`, fixture ledger inputs), the v3 rule set (`v3Rules`), the v2 DSL, the
  grid's hard blocks and every `ruleCopy` line are identical.

PR 1 ships to production through the normal release order. It changes no stored byte.

## 4. PR 2 — new picks are stored as ids; the bulk conversion is one consented script

Starts only after PR 1's production alias is verified (so dev, which writes the real dataset, can
never write an id that production cannot read).

### 4.1 No save rewrites a rule nobody touched

There is **no** blanket canonicalization on save. A save writes back every stored token exactly as it
read it; only a person the editor PICKS in this edit is stored as an id. So shipping PR 2 to `preview`
or production converts nothing by itself: the existing 19 rules stay text until the consented script
of §4.3 runs, and the chat's R4/R7 guarantee (no change the check did not show) is untouched.

- Forms: the member options' `value` becomes `m._id` (label unchanged). A preserved stored token keeps
  its own value (§3.5), so re-saving an untouched rule writes the same token.
- Chat: `ruleEdits.ts` `personToAdd` returns `member._id` as the stored token. Its §9.2
  back-resolution check (the text must name only this member) is not needed for an id and is removed;
  the `voz` check stays. Output stays names (§3.4).
- **Overlap by person, not by text:** `exactCapOverlaps` gains a key function argument; every caller
  passes `ruleTokenKey(token, roster)` = the resolved worship member's `_id` when
  `resolveRulePersonId` finds exactly one, else the lower-cased trimmed text. The rules POST and
  `saveRuleEdits` run it on the config being saved with the roster read in the commit; the form runs
  it with its members. So a new id restriction beside a legacy text restriction for the same person
  and role is refused at the save that creates it, not by every later save.
- **No `SOLVER_CONFIG_VERSION` bump.** ADR-0049 bumps it when an older client would drop or rewrite a
  field or allowed value. After PR 1 every client reads ids and, per §3.5, preserves any stored token
  verbatim; a pre-PR-1 tab still open would preserve an id through `personNameOptions`' preserve list
  too (as raw text in its select, no loss). Nothing is dropped, so the version and
  `solverConfigVersion.test.ts`' SHAPES stay as they are; the PR says why.

### 4.2 The writer core leaves `server-only` (so the script uses the same writer)

`solverConfigCommit.ts` imports `server-only` (through `operationalClient`/`solverConfigRead`), which a
script cannot import (`scripts/lib/reconstructRun.ts`). Following C4's precedent
(`executeFairnessMonthWrites` in `fairnessMonthWriteRequest.ts`, imported by
`scripts/reconstruct-fairness-months.mjs` with its own `@sanity/client`), PR 2 moves the write step
into a new non-`server-only` module `app/utils/solverConfigWrite.ts`:
`writeSolverConfig(client, { config, rev, roster })` = parse (`parseSolverConfigWrite`) → overlap check
by person (§4.1) → `solverConfigFields` → one `ifRevisionId` set. `saveSolverConfig` and `saveRuleEdits`
keep their auth, version check, fresh read, lossless gate and errors, and call it with their client;
the script calls it with its own. One write path; `solverConfigCommit.ts` stays the only importer in
`app/**` (a test pins the importers: the commit module and the script).

### 4.3 The migration (production data; Frank's consent required)

- New pure `canonicalRulePeople(config, roster) → { config, changed: Array<{ from, toId }>, unresolved,
  ambiguous }` in `app/utils/solverConfigWriteRequest.ts`: every token `resolveRulePersonId` resolves
  to exactly one worship member becomes that `_id`; anything else is kept as stored. Unit-tested.
- `scripts/rekey-solver-rule-people.ts`, run on the Mac with
  `npx tsx --env-file=.env.local scripts/rekey-solver-rule-people.ts` (the C4 runbook's command shape;
  the write token lives only there):
  - **Dry run (default):** reads `solverConfig` and the worship roster with its own client, prints one
    line per distinct token (`«Vale 𑣲» → Valeria …`, ids shown only in this local terminal, never in a
    chat or log) plus `UNRESOLVED`/`AMBIGUOUS` lines, and an equivalence check computed from the stored
    config and from the canonical one: `v3Rules` output, `ruleCopy` lines, the v2 DSL rule lines and the
    grid hard-block table must be identical (all pure in config + roster; no ledger read needed).
    Exits non-zero if they differ.
  - **`--apply`:** refuses unless the dry run's fingerprint (SHA-256 of the canonical config) is passed
    back with `--fingerprint`; writes a JSON snapshot of the stored document to `.backfill-backups/`
    (gitignored), then calls `writeSolverConfig` with the `_rev` it read. No other write.
  - **`--to-names`:** the reverse (id → `normalizeLabel(displayMemberName)`), same dry-run/fingerprint/
    `--apply` shape, for the rollback of §5.4.
- Expected dry run today: 13 tokens → 13 members, 0 unresolved (§1.6). The dry-run output (names only)
  is shown to Frank; `--apply` runs only after his explicit «sí».
- After `--apply`: `get_solver_rules` from the chat must print the same names as before (captured
  before the run); the dry run re-run must report 0 tokens left to convert.

### 4.4 What stays, what goes

- `memberRuleRename` (the rename's targeted `set`) stays: it still rewrites any legacy text token and
  is a no-op on ids. Removing it (and its targeted-writer entry in CLAUDE.md/ADR-0082) is a later
  cleanup once a dry run shows no text token left for a month.
- The member DELETE is unchanged: a rule naming a deleted member keeps a dangling id; v3 refuses with a
  named line and the panel shows «persona que ya no está en Alabanza». Deleting rules automatically is
  out of scope.
- `scripts/fix-vale-sosa-rule.mjs` (ran 2026-08-31) and `scripts/seed-solver-config.ts` are untouched
  (a fresh dataset's seeded names stay text until the script runs there).

## 5. Release and rollback

1. PR 1: implement → gates → one code review → preview → dev alias → PR → Frank's go-ahead → prod alias.
2. PR 2: same, only after step 1's prod alias. Because PR 1 is already in production, a rule saved on
   dev with an id (dev writes the real dataset) is read correctly by production; and because no save
   rewrites untouched rules (§4.1), PR 2 reaching dev or production converts nothing by itself.
3. Migration: dry run on the Mac → its names-only output shown to Frank → his explicit «sí» →
   `--apply --fingerprint` → the two checks of §4.3. Only this step converts the existing rules.
4. **Rollback:** reverting PR 2 leaves ids in the data, which PR 1 reads (safe). Reverting PR 1 is
   allowed only after `--to-names --apply` (otherwise production would read ids as names and every Auto
   would refuse); the PR 1 revert's description must say so, and the ADR states it.
5. A v2 flip-back (ADR-0056) keeps working at every step: v2 reads through `resolveToMemberName`.

## 6. Records

- New ADR (next free number at merge; 0092 if 0091 is still preview-only): «A rule names a person by
  member id; names are derived», with the rejected alternatives of §2 and the rollback order of §5.4.
- ADR-0084 addendum: storage is ids; the wire stays names (KH-1 unchanged); a chat save never
  rewrites a rule the check did not show (no canonicalization on save).
- ADR-0082 note: the rename's rule rewrite is legacy-only after the migration.
- CLAUDE.md + `docs/agents/project-rules.md` + AGENTS.md: the `solverConfig` invariant gains one line
  («a rule's person is a member `_id`; legacy text still reads; `rulePersonLabel` is the only display»),
  and `rulePersonLabel` joins the planner/solver utils list.

## 7. Out of scope

Re-keying rule `_key`s (seed-era names, C5-17/C6 KH-1 say not to); the duplicate Jakey–Hugo conflict;
opening the rule tools to worship admins (decision C2); removing v2.
