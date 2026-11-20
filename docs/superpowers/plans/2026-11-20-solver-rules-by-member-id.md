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
wraps; no `server-only`). `roster` = every `teamMembers` document, any ministry, disabled included,
projected `{ _id, member_name, alias }` (new `rulePeopleRosterQuery()` in `serviceReadQueries.ts`).

- When the document has no `personTokens: "id"`: `config` = `solverConfigFromDocument(doc)` unchanged.
- Otherwise every person token (the four fields of §1.2) is mapped to a label, in this order:
  - a token equal to the `_id` of a **worship** member → `normalizeLabel(displayMemberName(member))` if
    `resolveRulePersonId` resolves that text to this same member; else `normalizeLabel(member_name)` if
    that resolves to this member; else (two worship members share both texts)
    «<display name> (persona repetida)», which resolves to nobody, so v3 refuses it loudly;
  - a token equal to the `_id` of a member **outside Alabanza** → «<display name> (fuera de
    Alabanza)». It must not read as their bare name: a worship member with the same name would then
    receive the rule. It resolves to nobody, as a non-worship name is unresolved today;
  - a token that is no roster `_id` but has the id shape (no whitespace, `^[A-Za-z0-9_.-]{20,}$`) →
    «persona que ya no está en Alabanza»;
  - any other token (a legacy text the migration could not resolve) → itself.
  - **Labels are unique per stored token:** if two distinct stored tokens would get the same label,
    the later ones (by first appearance) get « (2)», « (3)» (skipping any suffix that would resolve to a
    member). Only non-resolving labels can collide, so `back` is a bijection.
  By construction a label resolves (`resolveRulePersonId`) either to exactly the member whose id it
  came from, or to nobody.
- `back` is the map from every produced label to the stored token it came from (the write uses it).

A deleted member's rule therefore reads as «persona que ya no está en Alabanza», which resolves to
nobody: v3 refuses with a named line, the grid skips it, v2 injects a phantom, exactly as a dangling name
does today. A member moved out of Alabanza reads «<nombre> (fuera de Alabanza)» and is refused the same
way. `v3Copy.ts`'s `unresolved` line gets one variant: for a label starting «persona que ya no está
en Alabanza» it reads «Una regla nombra a una persona que ya no está en Alabanza. Quita o cambia esa
regla.» (no token in it).

### 3.2 Write: `rulePeopleToIds(config, storedDoc, roster) → { ok, config } | { ok: false, path }`

Same module, pure. The last step before `solverConfigFields`, in the ONE writer core (§4.1).

- When the stored document has no `personTokens: "id"`: identity.
- Otherwise, for each person token of the config being saved, using `back` recomputed from the FRESH
  stored document the writer just read:
  1. it resolves (`resolveRulePersonId`, worship, exactly one) → that member's `_id`. (A legacy text
     that has since come to name exactly one member is written as that id: v3 already applied it to
     that member.);
  2. else it is a label in `back` → the stored token it came from (a dangling id, a non-worship
     member's id, a legacy text);
  3. else → refuse the whole save with `{ path }` (HTTP 409 / the chat's `changed`): «Una persona de
     las reglas cambió mientras editabas (por ejemplo, alguien cambió su nombre). Recarga las reglas y
     vuelve a guardar; no se guardó nada.» This is the rename race: a tab that read «Vale» saves after
     Studio renamed her to «Valeria»; step 1 finds nobody named «Vale», step 2 finds no such label, and
     nothing is written instead of detaching her.
- Round trip: for an unchanged config, `rulePeopleToIds(rulePeopleToNames(doc).config, doc)` writes
  every token back byte-identical: a label either resolves to its own id (step 1) or to nobody, in which
  case `back` (a bijection) returns its token (step 2). Unit-tested with the repeated-person, outside-
  Alabanza, several-dangling and legacy-text cases.

### 3.3 Where the translations run (and nowhere else)

| Site (§1.9) | Change |
|---|---|
| `solverConfigGetBody(doc, roster)` | gains `roster`; returns `config` through `rulePeopleToNames`. Its two callers (the GET route, `readRules`) read the roster in the same `Promise.all`. The GET's body shape is unchanged. |
| `solverConfigCommit.ts` | both writers judge on the names view (`losslessRules` gains the roster and compares the names view's re-parse with the names view, so the gate keeps meaning "this version reads what is stored"); the write goes through the core (§4.1), which applies `rulePeopleToIds`. |
| `memberRuleRename.ts` / `memberCommit.ts` | planning the targeted `set` stays on the RAW document (it rewrites text tokens that name the renamed member; an id token never names anyone, so in id mode it rewrites nothing, by construction); the warning and `lines` text are built from the names view, read with the roster after the rename. |
| `members/[id]` DELETE | unchanged (pools only). |
| `scripts/lib/reconstructRun.ts` | reads through `rulePeopleToNames` (its own roster read) before `resolveMonthEligibility`. |
| `scripts/seed-solver-config.ts` | unchanged (creates names, no marker). |

**Guard:** `solverConfigReadCoverage.test.ts` (the `draftGatingCoverage` pattern): every file under
`app/**` and `scripts/**` that imports `SOLVER_CONFIG_DOC_ID`, `solverConfigQuery`,
`loadStoredSolverConfig` or `solverConfigFromDocument` must be in an allowlist naming the site above
and why; a new reader fails the test until someone decides how it reads. `solverConfigFromDocument`
alone is allowed only in `solverConfigWriteRequest.ts`, `solverConfigSource.ts` (it normalises the GET
body, already names) and the seed.

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
`parseSolverConfigWrite` → `rulePeopleToIds` → `solverConfigFields` (+ `personTokens` when `setMarker`
is `"id"` or `null`) → one `ifRevisionId(stored._rev)` set. `saveSolverConfig` and `saveRuleEdits` keep
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
  `UNRESOLVED`/`AMBIGUOUS` lines for tokens that stay text. Three checks, any failure exits non-zero:
  1. **Only person paths change:** the written document (the six fields + marker) differs from the
     stored one only at the four person fields and `personTokens` (a path-by-path diff).
  2. **Same person at every path:** for each changed path, `resolveRulePersonId(stored text)` equals
     the written id.
  3. **Same view:** `rulePeopleToNames(written)` resolves, at every path, to the same member as the
     stored text (labels may differ in spelling, e.g. «vale» vs «Vale 𑣲»; identity may not).
  It prints a fingerprint (SHA-256 of the document it would write).
- **`--apply --fingerprint <hex>`:** recomputes and refuses unless the fingerprint matches; writes a
  JSON snapshot of the stored document to `.backfill-backups/` (gitignored); calls
  `writeSolverConfig(..., setMarker: "id")` with the `_rev` it read. Unresolved tokens stay text.
- **`--to-names`:** the reverse for rollback: every id token → `normalizeLabel(displayMemberName)`,
  dangling ids → kept as stored (and listed), marker removed (`setMarker: null`); same dry run,
  fingerprint and `--apply` shape.
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
3. **Rollback:** before reverting the PR with the marker set, run `--to-names --apply` (otherwise the
   reverted code would read ids as names and every Auto would refuse). The ADR and the PR description
   say so. Reverting with no marker set is safe at any time.
4. A v2 flip-back (ADR-0056) keeps working: v2 reads the names view like everything else.

## 6. Tests

- `solverConfigWriteRequest.test.ts`: `rulePeopleToNames` (no marker = identity; id → display name;
  colliding display name → `member_name`; double collision → «(persona repetida)»; outside-Alabanza id
  whose name a worship member also has → «(fuera de Alabanza)», resolving to nobody; several dangling
  ids → distinct labels; legacy text kept; a 20+-character legacy text with no space is labelled as a dangling person,
  pinned as the known limit); `rulePeopleToIds` (resolve, `back`, refuse on an unknown name, no marker =
  identity); the round trip byte-identical on a production-shaped fixture (§1.6) in both modes.
- `solverConfigCommit.test.ts`: both writers in id mode write ids; a rename between read and save
  refuses with nothing written; the lossless gate passes on an id-mode document.
- `memberRuleRename.test.ts`: in id mode a rename plans no rule write and its lines name people.
- `solverConfigWrite.test.ts`: the core never writes `personTokens` unless `setMarker` is passed.
- The coverage test and the id canary of §3.3.
- The script's three dry-run checks on fixtures (a clean conversion; an unresolved token kept; a
  forced non-person diff refused).

## 7. Records

- New ADR (next free number at merge): «Rules store member ids; everything else reads names», with the
  rejected alternatives of §2, the marker, the rename-race refusal and the rollback order of §5.3.
- ADR-0049 addendum: the writer core (`solverConfigWrite.ts`) and `rulePeopleToIds` in the chain.
- ADR-0084 addendum: storage is ids in id mode; the wire stays names (KH-1 unchanged).
- ADR-0082 note: in id mode the rename's rule rewrite finds nothing to rewrite (legacy texts only).
- CLAUDE.md + AGENTS.md + `docs/agents/project-rules.md`: the `solverConfig` invariant gains one line
  («stored rule people are member ids once `personTokens: "id"`; only `rulePeopleToNames` /
  `rulePeopleToIds` translate; every reader goes through `solverConfigGetBody`»), and the two functions
  join the planner/solver utils list.

## 8. Out of scope

Re-keying rule `_key`s (C5-17/C6 KH-1 say not to); the duplicate Jakey–Hugo conflict; opening the
rule tools to worship admins (decision C2); removing v2; deleting the rename's rule rewrite (a later
cleanup once a dry run shows no text token left).
