# Plan: the solver rules name a person by their member id, not by their name

- **Date:** 2026-11-20
- **Item:** C1 of the 2026-11-19 improvement proposal («Reglas del solver por persona, no por nombre»).
- **Requirement, in Frank's terms (proposal doc, approved order «antes de generar enero»):** a rule says
  «Vale» as text; if someone changes that alias the rule stops applying to her without anyone noticing
  (it happened: `scripts/fix-vale-sosa-rule.mjs`, 2026-08-31). Make the rules point at the person,
  so changing a name or alias anywhere (the app, the chat, **Studio**) can never detach a rule again.
  Production data changes only with Frank's explicit consent, dry run first.
- **Risk tier:** critical. This changes a production writer's payload and module boundary
  (`solverConfigCommit.ts`, the rules POST and the MCP rule tools) and migrates stored data. One PR
  (its diff gets the usual merge-range code review) plus one consented data step.

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
9. **Every read of the rules document is one of six** (grep of `SOLVER_CONFIG_DOC_ID`,
   `solverConfigQuery`, `loadStoredSolverConfig`, `solverConfigFromDocument` under `app/**` and
   `scripts/**`, main `fb685076`):
   - `solverConfigGetBody(loadStoredSolverConfig())` (`solverConfigRead.ts`): the rules GET (the
     planner, through `useSolverConfig`/`sourceFromGet`) and `v3MonthPlanReads.readRules`, which feeds
     `loadV3PlanSources` (the MCP `solve_month`, `apply_schedule`, proposal and saved-month editors,
     `get_solver_rules`, the availability sweep) and the integrity queue.
   - `solverConfigCommit.ts` (the rules POST's `saveSolverConfig`; the chat's `saveRuleEdits` through
     `losslessRules`).
   - `memberCommit.ts` + `memberRuleRename.ts` (a rename's rule rewrite and `orphanRuleWarnings`).
   - `app/api/admin/members/[id]/route.ts` (the DELETE's pool cleanup: pools only, already ids).
   - `scripts/lib/reconstructRun.ts` (C4's consented reconstruction) and `scripts/seed-solver-config.ts`
     (creates the document only when absent).
   Everything that prints a rule person (the planner, the fairness «registrar» dialog, the availability
   proposals, every MCP tool) receives its config from the first or second of these.
10. **Studio cannot write or show the rules:** `solverConfig` is `hidden`, `readOnly`, and every
    mutating action is stripped (`sanity/schemas/solverConfig.ts`, `studioProtection.ts`). Studio can
    rename members, which is the gap this plan closes.

## 2. Decision

**Ids in storage, names everywhere else.** A rule's stored person becomes the member's `_id`. The
translation happens at exactly two places: when the rules document is READ (id → the member's current
name) and when it is WRITTEN (name → id). Every reader, printer, matcher, form, solver request and MCP
tool keeps working on names exactly as today, so no id can reach a person or the MCP wire through
code that was never taught about ids, and a rename anywhere (app, chat, Studio) changes what the next
read shows without touching the rules.

The switch is a field on the rules document, `personTokens: "id"`, set only by the consented migration.
Until it is set, both translations are the identity: the PR changes no behaviour and no stored byte.

Rejected:
- **Ids in memory, a label at every printer** (this plan's first draft). Two independent reviews each
  found printers the inventory missed (the fairness «registrar» dialog, the availability proposals, a
  rename's warning lines, five v3 refusal reasons); each would show an id to a person or the chat. The
  defect is the method: it needs every printer, present and future, to remember a translation.
- **Adding a `personId` beside `person`.** Two sources of truth; every writer must keep them in step.
- **More guards on names** (a nightly check, a Studio warning). Keeps the class of error and only
  watches it; C1 exists to make it disappear.
- **Converting on every save.** Would rewrite all production rules at the first save after release,
  before Frank saw a dry run. Only the consented migration flips storage.
- **Ids on the MCP wire.** ADR-0084 KH-1 stays: the chat sends and receives names.

## 3. The two translations

### 3.1 Read: `rulePeopleToNames(doc, roster) → { config, back }`

New, pure, in `app/utils/solverConfigWriteRequest.ts` (next to `solverConfigFromDocument`, which it
wraps; no `server-only`). `roster` = every published `teamMembers` document, any ministry, disabled
included, projected `{ _id, member_name, alias, ministries }` with the file's `CANONICAL` drafts filter
(new `rulePeopleRosterQuery()` in `serviceReadQueries.ts`). `ministries` is required: `resolveRulePersonId`
reads an absent `ministries` as worship (`sundayCadence.ts`), so a roster without it would make every
member look like worship. **Every** translation site of §3.3 and the migration script read this one
query; none passes a roster from another query. A test runs this query's projection shape (a Kids-only
member, a Jóvenes-only member, a worship member sharing an alias with a Kids member, a member with no
`ministries`) through `rulePeopleToNames`.

- When the document has no `personTokens: "id"`: `config` = `solverConfigFromDocument(doc)` unchanged.
- Otherwise every person token (the four fields of §1.2) is mapped to a label, in this order:
  - a token equal to the `_id` of a **worship** member → `normalizeLabel(displayMemberName(member))` if
    `resolveRulePersonId` resolves that text to this same member; else `normalizeLabel(member_name)` if
    that resolves to this member; else (two worship members share both texts)
    «<display name> (persona repetida)», which resolves to nobody, so v3 refuses it loudly;
  - a token equal to the `_id` of a member **outside Alabanza** → «<display name> (fuera de
    Alabanza)». It must not read as their bare name: a worship member with the same name would then
    receive the rule. It resolves to nobody, as a non-worship name is unresolved today;
  - any other token → «persona que ya no está en Alabanza». In id mode every stored token is an id
    (the migration refuses to set the marker while any token is unresolved or ambiguous, §4.2, and the
    writer never stores a text in id mode, §3.2), so a token that is no roster `_id` is a deleted
    member, whatever its shape (Kids-seeded ids like `kidsMember-ana` are shorter than 20 characters).
  - **Every label is passed through `normalizeLabel`** (the base text and any suffix), because the
    label crosses the GET → client `solverConfigFromDocument` → POST `parseSolverConfigWrite` path,
    which normalises; `back` is keyed by the normalised label, compared case-insensitively.
  - **Labels are unique per stored token, deterministically:** a non-resolving label (dangling,
    outside Alabanza, repeated person) that collides case-insensitively with another token's label, or
    that would itself resolve to a member (e.g. someone literally named «persona que ya no está en
    Alabanza»), gets « (2)», « (3)»… assigned in the order of the stored token strings (not their
    position in the document, so deleting or reordering rules does not move a suffix), skipping any
    suffix that would resolve to a member. Resolving labels cannot collide (each resolves to exactly
    its own member), so `back` is a bijection.
  By construction a label resolves (`resolveRulePersonId`) either to exactly the member whose id it
  came from, or to nobody.
- `back` is the map from every produced label to the stored token it came from (the write uses it);
  empty in names mode.

A deleted member's rule therefore reads as «persona que ya no está en Alabanza», which resolves to
nobody: v3 refuses with a named line, the grid skips it, v2 injects a phantom, exactly as a dangling name
does today. A member moved out of Alabanza reads «<nombre> (fuera de Alabanza)» and is refused the same
way. `v3Copy.ts`'s `unresolved` line gets one variant: for a label starting «persona que ya no está
en Alabanza» it reads «Una regla nombra a una persona que ya no está en Alabanza. Quita o cambia esa
regla.» (no token in it).

### 3.2 Write: `rulePeopleToIds(config, storedDoc, roster) → { ok, config } | { ok: false, path }`

Same module, pure. The last step before `solverConfigFields`, in the ONE writer core (§4.1).

- The mode is the **target** mode of the write: the `setMarker` the caller passes (§4.1: the
  migration passes `"id"`, `--to-names` passes `null`), else the stored document's marker. Names
  mode: every token is written as a name: a token that is a roster `_id` (only reachable by
  `--to-names`) becomes `normalizeLabel(displayMemberName(member))`; a name is written as given.
  (`--to-names` writes each id's `rulePeopleToNames` label instead, §4.2, so it never leaves an id.)
- Id mode, for each person token of the config being saved, using `back` recomputed from the FRESH
  stored document the writer just read (for the migration, the stored names document: `back` is then
  empty and every token must resolve):
  1. it resolves (`resolveRulePersonId`, worship, exactly one) → that member's `_id`;
  2. else it is a label in `back` → the stored token it came from (a dangling id, a non-worship
     member's id, a repeated person's id);
  3. else → refuse the whole save, nothing written, with one of three reasons. The rules POST answers
     each with a code the panel's `saveFailure` (`solverConfigSource.ts`) already branches on or is
     taught to, so the panel shows these texts and not «error 409» (a `saveFailure` test per reason);
     the chat returns the same texts:
     - the name matches more than one worship member: 400 `invalid_request`, issue
       `<path>:ambiguous_person`, mapped in `saveFailure` to «"<nombre>" coincide con más de una
       persona; elige a la persona otra vez.»;
     - the name matches a roster member outside Alabanza (a super-admin's person picker lists every
       ministry): 400 `invalid_request`, issue `<path>:not_worship`, «<nombre> no está en Alabanza; las
       reglas solo pueden nombrar a alguien de Alabanza.» (Today that save stores a text v3 then
       refuses; refusing at the save is earlier and clearer.);
     - it matches nobody: 409 `stale_revision` (so the panel offers its existing «Recargar reglas»;
       the chat's `changed`), with the message «Una persona de las reglas
       cambió mientras editabas (por ejemplo, alguien cambió su nombre). Recarga las reglas y vuelve a
       guardar; no se guardó nada.» This is the rename race: a tab that read «Vale» saves after Studio
       renamed her to «Valeria»; step 1 finds nobody named «Vale», step 2 finds no such label, and
       nothing is written instead of detaching her.
     Known limit, stated in the ADR: a SWAP (X renamed away from «Gaby» and Y renamed TO «Gaby» while a
     tab is open) moves X's rule to Y on that tab's save, exactly as it would today. Closing it would
     need a fingerprint of the label map echoed by every client, a client-contract change this plan
     does not make.
- Round trip (both modes): for an unchanged config, `rulePeopleToIds(rulePeopleToNames(doc).config, doc)` writes
  every token back byte-identical: a label either resolves to its own id (step 1) or to nobody, in which
  case `back` (a bijection) returns its token (step 2). Unit-tested with the repeated-person, outside-
  Alabanza and several-dangling cases.

### 3.3 Where the translations run (and nowhere else)

| Site (§1.9) | Change |
|---|---|
| `solverConfigGetBody(doc, roster)` | gains `roster`; returns `config` through `rulePeopleToNames`. Its two callers (the GET route, `readRules`) read the roster in the same `Promise.all`. The GET's body shape is unchanged. |
| `solverConfigCommit.ts` | both writers judge edits on the names view; the write goes through the core (§4.1), which applies `rulePeopleToIds`. `losslessRules(raw, roster)` keeps comparing against the **raw** stored fields: it computes the fields an unchanged save would write, `solverConfigFields(rulePeopleToIds(parse(namesView).config, raw, roster))`, and compares them with `raw[field]` for the six fields, so any coercion by `solverConfigFromDocument` (an unknown op, an item without id, an unknown fairness) is still `lossy`, in either mode. |
| `memberRuleRename.ts` / `memberCommit.ts` | names mode: unchanged (the targeted `set`, its `lines` and `orphanRuleWarnings` work on the raw text document exactly as today). Id mode: `planRuleRename` returns no sets and no lines, and `orphanRuleWarnings` returns `[]`, by an explicit check of the stored marker: a rule keyed by id can neither be detached nor inherited by a rename, so there is nothing to rewrite or warn about. (Building the warning from a post-rename names view would flag the renamed person's own rules, «empezaría a aplicarle», and `/me` refuses an alias change on any such line.) |
| `members/[id]` DELETE | unchanged (pools only). |
| `scripts/lib/reconstructRun.ts` | reads through `rulePeopleToNames` (its own roster read) before `resolveMonthEligibility`. |
| `scripts/seed-solver-config.ts` | unchanged (creates names, no marker). |

**Guard:** `solverConfigReadCoverage.test.ts` (the `draftGatingCoverage` pattern): every file under
`app/**` and `scripts/**` that imports `SOLVER_CONFIG_DOC_ID`, `solverConfigQuery`,
`loadStoredSolverConfig` or `solverConfigFromDocument` must be in an allowlist naming the site above
and why; a new reader fails the test until someone decides how it reads. The allowlist records which
sites use `solverConfigFromDocument` on a RAW document and why: `memberRuleRename.ts` (plans text
rewrites on the raw document, by design), `solverConfigWriteRequest.ts` (inside `rulePeopleToNames`),
`solverConfigSource.ts` (normalises the GET body, already names), the seed (absent-only). Readers that
use a literal GROQ instead of these symbols are outside the test and named here: the one-off
`scripts/fix-vale-sosa-rule.mjs` (ran 2026-08-31; it writes text, so it must never run against an
id-mode document; the PR adds a refusal when the document carries the marker) and the private ADR-0056
restore (§5.3).

**Id canary (behavioural):** with `personTokens: "id"` and a fixture roster of realistic ids (22- and
36-character), plus a dangling id and a non-worship member, run `solverConfigGetBody` →
`get_solver_rules`, `solve_month` (a refusal from the dangling id and from `no_tipo`), the planner's
`ruleCopy` lines, `resolverLines`, and `orphanRuleWarnings`; assert no fixture id appears in any output.
Because these all consume the read boundary's names, the canary checks the boundary, not a list of
printers.

## 4. The writer and the migration

### 4.1 One writer core, outside `server-only`

`solverConfigCommit.ts` imports `server-only` (through `operationalClient`/`solverConfigRead`), which a
script cannot import (`scripts/lib/reconstructRun.ts`). Following C4's precedent
(`executeFairnessMonthWrites` in `fairnessMonthWriteRequest.ts`, imported by
`scripts/reconstruct-fairness-months.mjs`), the write step moves into a new non-`server-only` module
`app/utils/solverConfigWrite.ts`: `writeSolverConfig(client, { config, stored, roster, setMarker? })` =
`parseSolverConfigWrite` → `rulePeopleToIds` in the TARGET mode (`setMarker` when passed, else the stored
marker, §3.2) → `solverConfigFields` (+ `personTokens: "id"` set, or unset, when `setMarker` is `"id"` or
`null`) → one `ifRevisionId(stored._rev)` patch. `personTokens` is declared on the `solverConfig`
schema (hidden, read-only like the rest). `saveSolverConfig` and `saveRuleEdits` keep
their auth, version check, fresh read, lossless gate and messages and call it; the migration script
calls it with its own client. Only `solverConfigCommit.ts` and the script may import it (pinned by the
coverage test of §3.3).

No `SOLVER_CONFIG_VERSION` bump: the GET body and the POST body still carry names, in both modes; an
older open tab reads and writes the same shape. `personTokens` is never sent by a client and never
written by `solverConfigFields`' six rule fields, so a client save cannot touch it; only
`writeSolverConfig` with `setMarker` writes it.

### 4.2 The migration (production data; Frank's consent required)

`scripts/rekey-solver-rule-people.ts`, run where the write token lives (the Mac):
`npx tsx --env-file=.env.local scripts/rekey-solver-rule-people.ts` (C4's command shape).

- **Dry run (default):** reads the document and the full roster with its own client and prints, for
  each distinct person token, `«Vale 𑣲» → Valeria …` (names only; the `_id` is not printed), plus
  `UNRESOLVED`/`AMBIGUOUS` lines for tokens that block the migration. Four checks, any failure exits
  non-zero:
  1. **Only person paths change:** the written document (the six fields + marker) differs from the
     stored one only at the four person fields and `personTokens` (a path-by-path diff).
  2. **Same person at every path:** for each changed path, `resolveRulePersonId(stored text)` equals
     the written id.
  3. **Same view:** `rulePeopleToNames(written)` resolves, at every path, to the same member as the
     stored text (labels may differ in spelling, e.g. «vale» vs «Vale 𑣲»; identity may not).
  4. **Target form:** in id mode every person token of the written document is a roster `_id`; and
     `rulePeopleToNames(written)` re-parsed passes `parseSolverConfigWrite` (no new `exact_overlap`
     from two spellings of one member collapsing into one id; presence lists keep their length) and
     the lossless gate of §3.3. For `--to-names`: no token is a roster `_id`.
  The dry run prints names to the local terminal only (deliberately unlike the seed's ordinals: Frank
  must recognise the people to consent; nothing is logged or committed). It prints a fingerprint
  (SHA-256 of the document it would write).
- **`--apply --fingerprint <hex>`:** recomputes and refuses unless the fingerprint matches; writes a
  JSON snapshot of the stored document to `.backfill-backups/` (gitignored); calls
  `writeSolverConfig(..., setMarker: "id")` with the `_rev` it read. Runbook: run it with no MCP proposal
  waiting to be applied (the save changes the rules `_rev`, and `apply_schedule` refuses a proposal made
  on an older one; such a proposal is regenerated). It refuses (dry run and apply)
  while any token is `UNRESOLVED` or `AMBIGUOUS`: those rules are fixed or removed in /admin first, so
  an id-mode document holds only ids.
- **`--to-names`:** the reverse for rollback: `writeSolverConfig(..., setMarker: null)` writes, at every
  path, the label `rulePeopleToNames` gives that token (so a repeated person, someone outside Alabanza
  or a deleted member is written as that same non-resolving label, which the older code reads as an
  unresolved name and refuses loudly; no id is left and no ambiguous bare name is created); the marker
  is removed. Same dry run, fingerprint and `--apply` shape; check 4 asserts no token is a roster `_id`.
- Expected dry run today: 13 tokens → 13 members, 0 unresolved (§1.6). The names-only output is shown
  to Frank; `--apply` runs only after his explicit «sí».
- After `--apply`: `get_solver_rules` from the chat prints the same people as before (captured before
  the run), the planner's Reglas panel shows them, and a dry-run re-run reports 0 tokens to convert.

## 5. Release and rollback

1. One PR: implement → gates → one code review → preview → dev alias → PR → Frank's go-ahead → prod
   alias. With no marker in the data, dev and production behave exactly as today (§2); `preview`
   writing the real dataset changes nothing because no writer sets the marker except the script.
2. Migration (§4.2) after the prod alias: dry run → names-only output to Frank → his «sí» →
   `--apply --fingerprint` → the checks of §4.2. This is the only step that changes stored rules.
3. **Rollback:** before reverting the PR with the marker set, or a Vercel instant rollback of
   production to a deployment older than the PR, run `--to-names --apply` (otherwise the older code
   would read ids as names: every Auto would refuse and the chat would print ids). The same holds
   before an ADR-0056 restore of a names-era rules snapshot: writing names into an id-mode document
   would read them as deleted people. The ADR and the PR description say so. With no marker set, all
   three are safe at any time. `--to-names` needs the Mac (the write token lives there).
4. **Older code still pointed at the dataset** (an older immutable production deployment URL, a Mac
   checkout of an older branch; ADR-0049 records the same exposure) reads ids as names once the marker
   is set: its Auto refuses on every rule, and a save from it would write name texts into an id-mode
   document, which then read as «persona que ya no está en Alabanza». Loud, not silent; the ADR says
   so, and nobody saves rules from an old URL by design.
5. A v2 flip-back (ADR-0056) keeps working: v2 reads the names view like everything else.

## 6. Tests

- `solverConfigWriteRequest.test.ts`: `rulePeopleToNames` (no marker = identity; id → display name;
  a short Kids-style id not in the roster → dangling label;
  colliding display name → `member_name`; double collision → «(persona repetida)»; outside-Alabanza id
  whose name a worship member also has → «(fuera de Alabanza)», resolving to nobody; several dangling
  ids → distinct labels); `rulePeopleToIds` (target mode from `setMarker` in both directions: names →
  ids with `"id"` on a names document, ids → names with `null` on an id document; resolve, `back`,
  `ambiguous`, `not_worship` and `changed` refusals; names mode = names); labels with double and trailing
  spaces and different case; a suffix that does not move when a rule is deleted or reordered; the
  round trip run through JSON → `solverConfigFromDocument` → `parseSolverConfigWrite` (the real path),
  not only the bare composition; the round trip byte-identical on a production-shaped fixture (§1.6) in both modes.
- `solverConfigCommit.test.ts`: both writers in id mode write ids; a rename between read and save
  refuses with nothing written; the lossless gate passes on a clean id-mode document and answers
  `lossy` for an id-mode document with a coerced value (an unknown cap op).
- `memberRuleRename.test.ts` / `memberCommit.test.ts`: in id mode a rename plans no rule write, no
  lines and no orphan warning; a `/me` alias change of a member who has rules is accepted; an admin and
  a chat rename of such a member produce no «empezaría a aplicarle» line.
- `solverConfigSource.test.ts`: `saveFailure` shows the `ambiguous_person`, `not_worship` and
  `stale_revision` texts.
- `solverConfigWrite.test.ts`: the core never writes `personTokens` unless `setMarker` is passed.
- The coverage test and the id canary of §3.3.
- The script's four dry-run checks on fixtures (a clean conversion; an unresolved token refuses the
  migration; a forced non-person diff refused; two spellings of one member that would collapse into an
  `exact_overlap` refused) and `--to-names` (round trip back to names; a dangling id, an outside-Alabanza id and a repeated person
  come back as their non-resolving labels, never as an id).

## 7. Records

- New ADR (next free number at merge): «Rules store member ids; everything else reads names», with the
  rejected alternatives of §2, the marker, the rename-race refusal and its swap limit, the rollback
  order of §5.3, the older-code exposure of §5.4, and one line on isolation: «<nombre> (fuera de
  Alabanza)» shows a worship admin the current name of someone who left Alabanza, read through an
  all-ministries roster, only when a rule they can already see named that person.
- ADR-0049 addendum: the writer core (`solverConfigWrite.ts`) and `rulePeopleToIds` in the chain.
- ADR-0084 addendum: storage is ids in id mode; the wire stays names (KH-1 unchanged).
- ADR-0082 note: in id mode the rename's rule rewrite finds nothing to rewrite (a names-mode document
  only).
- CLAUDE.md + AGENTS.md + `docs/agents/project-rules.md`: the `solverConfig` invariant gains one line
  («stored rule people are member ids once `personTokens: "id"`; only `rulePeopleToNames` /
  `rulePeopleToIds` translate; every reader goes through `solverConfigGetBody`»), and the two functions
  join the planner/solver utils list.

## 8. Out of scope

Re-keying rule `_key`s (C5-17/C6 KH-1 say not to); the duplicate Jakey–Hugo conflict; opening the
rule tools to worship admins (decision C2); removing v2; deleting the rename's rule rewrite (a later
cleanup once a dry run shows no text token left).

## 9. Post-approval amendments (NOT covered by the plan review)

The plan above (§1–§8) was approved on SHA-256 `dac676f929f6a893995bbedbb084e1936b09ff119ea2cb8d15c11e6872c74863`
(see `2026-11-20-solver-rules-by-member-id-review-log.md`). The items below came from the approving
reviewers' non-blocking notes and were adopted afterwards; they are outside that approval and are
checked by the implementation's merge-range code review. Where one contradicts the text above, this
section wins.

1. **§3.2 names mode, one rule:** in names mode a token that is a roster `_id` is written as the label
   `rulePeopleToNames` gives it (never bare `displayMemberName`), so a dangling or outside-Alabanza id
   never comes back as a bare name that resolves to someone. The sentence in §3.2 saying otherwise is
   superseded.
2. **Normalisation mismatch:** `rulePeopleToNames` compares through `normalizeLabel` on both sides
   (label and member texts) before deciding a label resolves, and a member whose name only differs by
   whitespace or Unicode form is labelled by their `normalizeLabel(displayMemberName)` with a distinct
   save refusal reason `<path>:name_unmatched` («El nombre de <nombre> tiene espacios o letras que no
   coinciden; corrígelo en su perfil.») instead of «(persona repetida)» or the rename-race 409.
3. **Writer dedupe:** after `rulePeopleToIds`, the core removes duplicate ids inside a `presence[].persons`
   list and re-runs the exact-cap overlap check keyed by id; an overlap refuses the save. So a stored
   id-mode document always re-reads lossless.
4. **Refusal codes:** the rename-race 409 carries `details.detail: "person_changed"` and `saveFailure`
   shows its own text plus «Recargar reglas»; the `ambiguous_person` text reads «… coincide con más de
   una persona; recarga las reglas.» (the picker shows a shared name once).
5. **Copy:** the «persona que ya no está en Alabanza» variant applies to every v3 line that quotes a
   rule person (`unresolved`, the resolver refusals, `cadenceNameNone`), not only `unresolved`.
6. **Canary:** the rules POST's response body joins the id canary (the panel adopts it as its new state).
7. **Studio:** `personTokens` is added to the `solverConfig` field list in `studioProtection.ts` as well
   as to the schema.
8. **Dry run:** besides the four checks, it lists every path whose label differs from the stored text
   or whose label also names a non-worship roster member (the grid, specials fill and v2 match
   first-hit over a super-admin's all-ministries list), so Frank sees respellings before saying yes.
   The fingerprint covers the six rule fields and the marker only (not `_updatedAt` or audit fields).
9. **Names mode is not byte-for-byte a no-op:** the GET and POST now also fail (fail closed, existing
   «no se pudieron leer las reglas» path) when the roster read fails. Stated in the PR.
10. **ADR additions:** Sanity references (strong or weak) as a rejected alternative (a strong one would
    make deleting a person named by a rule refuse through the DELETE's existing referential-integrity
    path, a behaviour change Frank did not ask for; a weak one is the same id with more ceremony); the
    `not_worship` refusal tells a worship admin whether a name exists in another ministry (admins are
    trusted; noted beside the isolation line); the grid's hard blocks stay silent on non-resolving
    labels, as today (only v3 Auto is loud); the suffix drift case beside the swap limit.
