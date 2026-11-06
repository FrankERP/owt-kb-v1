# OWT MCP — admin parity, phase 4, slice R: the solver rules from the chat (slice plan)

**Status:** DRAFT (round 4), critical tier (a production writer of a shared document, a full-document
serializer behind it). Nothing built. Parent: `2026-11-04-owt-mcp-admin-parity-f4.md` (scope approved
by Frank 2026-11-05 15:01Z). Slice M (people, ADR-0082) shipped 2026-11-05 (PR #228) and its live proof
passed 2026-11-06 00:46Z; slice M already owns parent D6 (a rename renames its rules).

**Requirement (Frank, 2026-10-21 15:48Z, verbatim):** «Quiero poder hacer todo lo que hago en la
página como admin, pero desde el chat». Phase 4 of «Todo el admin desde el chat»: «Cambiar reglas y
grupos del solver». Parent §1.1 examples: «Agrégale a Gaby mínimo 3 domingos al mes», «Quita a Mkz de
Líder Sábado», «Pau y Tony no juntos en domingo».

---

## 1. What Frank gets

From the chat, everything `/admin` → «Generar mes» → Reglas edits: the three pools (Líder Domingo,
Líder Sábado, Soporte), a person's rules (never on a pattern, a week free, a count per month, «Mes
por medio», «Fuera del balance total»), «no coinciden» pairs and «cada semana» presence groups. Claude
shows each changed rule as the rules card words it (`ruleCopy.ts`), before → after, and saves only on
Frank's word. A save changes the rules for the NEXT month generated: saved months do not move; a month
whose fairness record already binds (`monthStateOf` = `bound`, `v3MonthSources.ts`) keeps its recorded
eligibility (pools, «nunca», a week free, exact counts, «Mes por medio», «cada semana»), but «al menos» /
«como máximo» counts and «no coinciden» pairs are read from the current rules for every month generated,
bound ones included (`v3Rules.ts:8-14`); and an open `solve_month` proposal must be
generated again (its `rulesRev` no longer matches; `applySchedule.ts:255` already refuses it).

## 2. Evidence (`origin/main` 8f02e27b)

- **The writer.** `POST /api/admin/solver-config` (`app/api/admin/solver-config/route.ts`, not a commit
  module): gate `requireActiveManager` minus content-editor; body `{rev, config, configVersion}`;
  `configVersion` must equal `SOLVER_CONFIG_VERSION` (2) before anything is read; `rev` must be a
  string; `parseSolverConfigWrite(config)` validates and mints `_key = id`; the stored document must
  exist (never created here) and its `_rev` must equal `rev`; the write is ONE `set` of all six fields
  plus `updatedAt`/`updatedBy` under `ifRevisionId(rev)`; only a Content Lake 409 is `stale_revision`;
  the answer is `{present, rev, config, configVersion}`. No revalidation (no ISR surface; the header
  says why).
- **The shape.** `SolverConfig` (`plannerModel.ts:402`): `sundayLeads`/`saturdayLeads`/`support`
  (member ids), `restrictions` (`person` TEXT, `excludedPatterns`, `fairness` none|exempt|slack,
  `fairnessSlack`, `weekExclusions {week, pattern}`, `caps {pattern, op, value, relative, relOffset}`,
  optional `sundayCadence: "alternate"`), `conflicts {personA, personB, pattern}`, `presence
  {persons[], pattern}`. Patterns are `<day>.<role>`, day ∈ Sun|Sat|*, role ∈ Lead|BGV|Choir|LeadBGV|*
  (`ruleCopy.ts` `parsePattern`; legacy spellings via `LEGACY_PATTERN_ALIASES`). The parser does NOT
  validate a pattern beyond `normalizeLabel`, and accepts any person text.
- **Reads.** `loadStoredSolverConfig` (`solverConfigRead.ts`) is the raw read; `solverConfigFromDocument`
  is the lenient reader; `readRules` (`v3MonthPlanReads.ts`) is what `get_solver_rules` and the planner
  use. Rules name people by text, matched by `rulePersonNamesMember` (trim, case-insensitive, name or
  alias).
- **Production today (read 2026-11-06, `_rev` CTyFX3i2…):** 11 restrictions, 7 conflicts, 1 presence;
  every item's `_key` equals its `id` and carries its `_type`; patterns all in the grammar above.
- **What the solver refuses (round 1, verified).** `resolveMonthEligibility`
  (`fairnessEligibility.ts:118-282`) runs on every Auto and `solve_month` for each unbound month
  (`v3MonthSources.ts:92-96`) and refuses the WHOLE solve when a rule person is unresolved, ambiguous or
  has no Tipo (persons resolve among WORSHIP members only: `resolveRulePersonId`, `sundayCadence.ts:56`),
  for «Mes por medio» plus an exact Sun.Lead count (`cadence_and_exact`), overlapping exact counts, an
  exact count outside 0–31, or a «cada semana» person without `voz` (`presence_member_not_listed`); it
  also stops on more than 20 presence groups (`too_many_presence`) and a group outside 2–12 members
  (`presence_members`, `RECORD_LIMITS`, `fairnessVocabulary.ts:91-98`). The panel avoids most of this by
  construction: its RuleBuilder offers only `voz` members (`MonthGenerator.tsx:2086`) and its pool
  checkboxes only members whose Tipo fits (`memberFitsPool`, `MonthGenerator.tsx:1944-1946`); an
  off-Tipo pool id is silently dropped at solve (`pooledForRoleKey`). The chat has no dropdown, so it
  must apply the same filters itself, and judge the result the way the solver will (R5, R6, R11).
- **Who.** The connector's write tools are super-admin only (ADR-0083: the `full` and `fullNoApps`
  tiers; the admins' `read` tier does not get them).

## 3. Decisions, and why

| # | Decision | Rejected | Why |
|---|---|---|---|
| R1 | `app/utils/solverConfigCommit.ts` owns the write: `saveSolverConfig(body, actorId)` is the route's POST body verbatim after auth; `checkRuleEdits` / `saveRuleEdits` are the chat's. The route keeps auth and the JSON parse. | Tools that call the route over HTTP. | ADR-0043/0066: one code path; the bearer is not a NextAuth session. |
| R2 | The chat edits BY PARTS (§4), applied to the freshly read config, never a whole `SolverConfig` from the model. | The chat sends the whole config, as the panel does. | A whole-document body is how a rule the model forgot disappears (ADR-0077's argument). |
| R3 | The chat's write is the panel's write: `parseSolverConfigWrite(edited)` → the same six-field `set` + stamp under `ifRevisionId`, with the server's own `SOLVER_CONFIG_VERSION`. | A targeted patch per edit. | The panel's serializer is the one place a rule value is validated (CLAUDE.md `solverConfig` invariant: no writer sets a rule value around it). Targeted writers are the documented exceptions, and an edit can create items, which a path patch cannot validate. |
| R4 | **Lossless gate.** Before a chat edit, the stored rule fields must round-trip: `solverConfigFields(parse(fromDocument(raw)))` deep-equals the raw document's six fields (key order ignored). Otherwise the check refuses every edit: «Las reglas guardadas tienen algo que esta versión leería distinto; ábrelas en /admin → Generar mes → Reglas y guárdalas una vez». | Write anyway, as the panel's save does. | The lenient reader coerces values it does not know (ADR-0082 rejected the parse pipeline for exactly this). The panel shows the coerced rule on screen before its save; the chat shows only the edited lines, so a silent coercion of an untouched rule would be invisible. Production passes today (§2). |
| R5 | **People must match the way the solver matches** (parent D4). A person in an ADD edit is resolved with the solver's own `resolveRulePersonId` over the planner's roster (`adminMembersQuery(true)`, as `loadV3PlanSources` reads it: worship members, disabled included; the resolver keeps WORSHIP members only), and must then carry Tipo `voz` (the RuleBuilder's own list). The stored text is that member's display name through `normalizeLabel` (alias if set, else name), the same text slice M's rename keeps current. Unresolved or ambiguous → refused, listing up to five close worship names (accent- and case-folded prefix); a member outside Alabanza is unresolved by construction; no `voz` → «X no canta en Alabanza (Tipo); las reglas solo aplican a quien canta. Cámbialo en Personas». A REMOVE or CHANGE may also name a rule's exact stored text (trim, case-insensitive) so an orphaned rule (one naming nobody) can be removed. | Any current member; free text, as the panel's text once allowed. | Free text is how Vale's rule silently stopped applying; a non-worship or no-Tipo name is refused by the solver for EVERY unbound month (§2), so one chat save could stop Auto. The chat cannot pick from a filtered dropdown, so the server filters. |
| R6 | Pools take members by name (R5's resolver) and store ids. An ADD must pass `memberFitsPool(m, pool)` (the panel's checkbox list), else «X no tiene el Tipo de Líder Domingo; cámbialo en Personas»; a REMOVE takes anyone in the pool, a stale off-Tipo tick included (the panel's mismatch banner is how it is unticked today). Adding someone already in the pool, or removing someone not in it, is «ya estaba así» (a no-op line, not a refusal). | Ids from the model; any member in any pool. | Members on the wire are names, never ids (ADR-0062's rule for the editor; KH-1 for rules). An off-Tipo id is dropped at solve without a word, so accepting it would tell Frank «guardado» for a change that does nothing. |
| R13 | **A pool line says what the person can do after, not only which list changed.** v3 pools nest (`pooledForRoleKey`, `fairnessEligibility.ts:110-116`): Sat.Lead = Líder Domingo ∪ Líder Sábado, and every BGV/coro key = any of the three pools. For each member a pool edit touches, the check compares `pooledForRoleKey(m, config, k)` over `ROLE_KEYS` before and after (the edited config, all pool edits applied) and the line carries the effect in words: «Líder Sábado: − Mkz (deja de poder: líder sábado)». When the effect is empty, the line says so and why, with the edit that does what Frank likely means: «Líder Sábado: − Mkz (no cambia nada: sigue en Líder Domingo, que también dirige sábados. Para que no dirija sábados: «nunca líder sábado»)». Such a line still saves if Frank says so (tidying a list is legitimate), but it is never a bare «guardado»: the effect is part of the lines the token binds. | Report the list change only; refuse a no-effect pool edit. | Frank's own example «Quita a Mkz de Líder Sábado» does nothing while Mkz is in Líder Domingo; a line that only says «− Mkz» would read as «Mkz ya no dirige sábados». Refusing would block a legitimate list cleanup; stating the effect lets Frank decide with the truth in front of him. |
| R7 | **Check then save**, token `mcp-rule-edits|` over `{rev, edits, lines}` (HMAC with `MCP_OAUTH_SECRET`). The token is `<iat>.<mac>` with `iat` (seconds) inside the MAC, as `peopleTokens.ts` does; expired when `now − iat` > 30 minutes or `iat` is more than 60 s in the future, refused with «la revisión venció; revisa de nuevo». The save re-reads, refuses a different `_rev` («Las reglas cambiaron desde la revisión; revisa de nuevo»), re-applies the edits, re-renders the lines and requires them byte-equal to the token's, then writes under `ifRevisionId`. | `rev` alone; a two-half token as slice M. | The rules document's `_rev` moves only when the rules are saved (no `lastSeen` on it), so binding `rev` is safe here, unlike people. Frank compares sentences, so the lines are bound. |
| R8 | New items get `id = <prefix>-` + 12 hex of HMAC(`MCP_OAUTH_SECRET`, `"mcp-rule-ids|" + rev + "|" + canonicalJson(edits) + "|" + i + "/" + j`), `i` = the edit's position in the list, `j` = the item's position among the items that edit creates (a new card is `j = 0`, its cap `j = 1`); prefixes `r-`, `c-`, `p-`, `cap-`, `we-`. The ids do NOT depend on the token, so the check (which has no token yet) and the save compute the same document; ids never reach a line or the model. | `crypto.randomUUID()` at save; ids from the token. | Deterministic ids keep the save a pure function of `(stored, edits)`, which is what the tests can pin; a retry after a landed save is refused by R7's `rev`, so no duplicate. Ids from the token would be circular (the token binds lines computed from the edited config). |
| R9 | The check refuses an edit set whose result fails `parseSolverConfigWrite` (e.g. two exact counts for one person on one role, `exactCapOverlaps`), in Spanish, naming the rule. It also refuses two absolute counts of one person that no month can satisfy together: for counts on patterns A and B whose roles satisfy `rolesOfPatternV3(A)` ⊆ `rolesOfPatternV3(B)`, a minimum on A («al menos» or «exactamente») above a maximum on B («como máximo» or «exactamente»), e.g. «exactamente 2 domingos» next to «al menos 3 domingos», or «al menos 3 de líder domingo» next to «como máximo 2 domingos». Relative counts and partial overlaps are a known limit (under v3 a count is soft and clamped, `gcf_v3/owt_v3/facts.py:47-56`, so such a pair yields a violation line, never a crash). As in R11, only a contradiction the EDITED rules have and the stored ones do not is refused; one already stored (the panel allows it) is listed as a note, so an unrelated edit is never blocked by it. | Let the save fail; let the solver find the month infeasible. | The check is where Frank decides; a save that fails after his «sí», or a month that cannot be generated, wastes his word. |
| R11 | **The solver's judgement, before and after.** The check runs `resolveMonthEligibility` on the stored config AND on the edited config, for the next CDMX month, with the planner's roster (the verdict does not depend on the month: absolute counts are compared as written and relative ones resolve to `max(0, weeks − n)` ≤ 5, `plannerModel.ts:811-813`). A refusal (`person`, `reason`) or issue (`code`, `ruleKey`) that the edited result has and the stored one does not is a NEW problem: the check refuses the whole edit set and words it with the planner's own copy (`V3_RESOLVER_REFUSAL` / `V3_RESOLVER_ISSUE`). Problems the stored rules already have do not block (an edit may be the fix) and are listed as a note «Las reglas ya tienen este problema: …». The save re-runs the same judgement on its fresh read. | R5/R6 alone. | R5/R6 cover single persons, not combinations (`cadence_and_exact`, overlapping exact counts, a 21st group, a group past 12). The solver's own function is the one judge that cannot drift from the solver; the «new only» comparison is slice M's pattern (`memberRuleRename.ts` `issuesOf`). The check also adds the panel's warning as a NOTE (never a refusal) when «Mes por medio» names someone outside the Líder Domingo pool (`cadenceOutsideSundayPool`, `sundayCadence.ts:112`): it saves but does nothing until that person leads Sundays. And a note when a `balance` or `cadence` edit touches a person listed in a bound month's record: a solve whose months include that bound month and an unbound one refuses until the two agree (`flagDisagreementLines`, `v3People.ts:83-99`), as the panel's save already does. |
| R12 | **Only the panel's patterns.** The chat writes only the eleven patterns the panel offers (`PATTERNS` / `EXCL_PATTERNS`, `MonthGenerator.tsx:429-449`): Sun.*, Sat.*, \*.\*, Sun.Lead, Sat.Lead, Sun.BGV, Sat.BGV, Sun.Choir, \*.Lead, \*.BGV, \*.LeadBGV. The list moves to ONE exported constant (`RULE_PATTERNS` in `ruleCopy.ts`) that the panel and the chat both read, and a test asserts `rolesOfPatternV3(p)` is non-empty for every entry (`patternRolesV3Sync.test.ts` reads the values; it moves with them). Any other combination is refused at the check in Spanish, naming what to send instead: «domingo, líder o BGV» → «envía dos: domingo líder y domingo BGV»; «sábado, coro» → «elige sábado (todo) o domingo coro». Removing an existing item may name any stored pattern (matched canonically), so a hand-edited oddity can still be taken out. | Any day × seat (15 combinations). | `Sun.LeadBGV`, `Sat.LeadBGV` and `*.Choir`-style spellings expand to no role in both solver expansions (`plannerModel.ts:766-793`), so the rule would be saved, worded by `ruleCopy` as a real sentence («No líder ni BGV en domingo»), and silently ignored (`v3Rules.ts:14-15`), the same «guardado for nothing» R6 prevents. One shared list means the chat and the panel cannot drift. |
| R10 | No notification, no revalidation (the route has none and needs none). `updatedBy` = the bearer's member id, as the route stamps the session's. | — | Parity. |

## 4. The edits (`applyRuleEdits(config, edits, roster)`, pure, `app/utils/ruleEdits.ts`)

Patterns on the wire are words, never notation: `{day: "domingo" | "sábado" | "ambos", seat: "líder" |
"BGV" | "coro" | "líder o BGV" | "todo"}` → `Sun|Sat|*` . `Lead|BGV|Choir|LeadBGV|*`, and the result must
be one of R12's eleven patterns (else refused, R12). Matching an existing item compares canonical
patterns (legacy alias resolved). Counts are whole numbers (`value` an integer 0–31, `minus` an integer
0–5); a fraction is refused at the check (the solver refuses `not_whole`). The field the edit does not
use is stored as the panel's new-cap default (`MonthGenerator.tsx:1113`): a relative count stores
`value: 2`, an absolute one `relOffset: 2`, so the save is deterministic and the parser (which needs a
finite `value`) accepts it.

| Edit | Effect |
|---|---|
| `pool {pool: "líder domingo"|"líder sábado"|"soporte", add?: names[], remove?: names[]}` | ids added at the end / removed; R6 no-ops reported. |
| `never {person, pattern}` / `allowAgain {person, pattern}` | add to / remove from that person's `excludedPatterns`. |
| `weekOff {person, week (1–5), pattern}` / `weekOn {…}` | add / remove a week exclusion. |
| `count {person, pattern, op: "exactamente"|"al menos"|"como máximo", value?: 0–31, relative?: {minus: 0–5}}` | add a cap, or replace the ONE existing cap with that pattern and op. |
| `removeCount {person, pattern, op}` | remove that cap (none or several → refused). |
| `cadence {person, alternate: boolean}` | set/clear «Mes por medio». |
| `balance {person, exempt: boolean}` | `fairness` exempt / none («Holgura» is never written: it is stale under v3; a stored slack is cleared by `exempt:false`). `exempt:false` is a CHANGE (it may name the stored text, no `voz` needed), so a card whose person lost `voz` can still be un-exempted. |
| `removePerson {person}` | remove the person's whole rule card. |
| `notTogether {a, b, pattern}` / `removeNotTogether {a, b, pattern?}` | add a conflict / remove the one matching pair (order-free). `a` and `b` resolving to the same member is refused (the solver's pair refuses duplicates; `collectV3Rules` would drop it silently). |
| `together {persons: 2–12 names, pattern}` / `removeTogether {persons, pattern?}` | add a presence group / remove the matching one (set-equal persons). 2–12 is `RECORD_LIMITS.presenceMembersMin/Max`; at most 20 groups is R11's `too_many_presence`. |

Every person named in an ADD edit (`never`, `weekOff`, `count`, `cadence` on, `balance` exempt, `notTogether`, `together`) goes through R5; `pool` adds go through R6. A person edit targets the person's ONE card (the restriction whose text names the member); none → a new
card is created for an add, refused for a remove; several cards for one member → refused with «dos
reglas nombran a X; únelas en /admin». An edit that changes nothing → «ya estaba así», no line. At most
30 edits per call.

## 5. Tools (`app/mcp/tools/rules.ts`, registered with the other write tools: served on the `full` and `fullNoApps` tiers, never on `read`)

- `check_rule_edits {edits}` — read-only: the lossless gate, the edits, R9, R11, R13's effects, the lines (`Regla: «before» →
  «after»`, `Nueva regla: «…»`, `Se quita: «…»`, pools as `Líder Sábado: − Mkz (deja de poder: líder sábado)`, R13), the notes (an open
  proposal needs regenerating; a no-op), and the token. Never an id or `rev` in the text (`rev` travels
  inside the token only).
- `save_rule_edits {edits, token}` — destructive (I14). R7; R4, R9 and R11 again on the fresh read. Unknown outcome (a throw after the domain
  call) → «No sé si se guardó; lee las reglas con get_solver_rules antes de reintentar».
- `get_solver_rules` is unchanged.

## 6. Pins, tests, docs

- `serviceCommitCallers` (the route + `rules.ts`), `deliveryCapableImports`, `seatClashGuardCoverage`
  NON_SEAT_WRITERS, `srVerificationRunContext` (the route wrapped), `mcpSanityClients` (reads only via
  `app/mcp/reads/*`), tool digest + `mcp-dev-smoke.mjs` (54 tools), `monthToolHygiene` (no ids).
- Route tests unchanged and passing (the move is verbatim). New: `ruleEdits.test.ts` (every row of §4,
  R5's matching: a non-worship name, a no-`voz` name, an ambiguous alias; R6: an off-Tipo pool add
  refused, a stale off-Tipo tick removable; R6 no-ops, the several-cards refusal, legacy patterns,
  R8's ids equal at check and save; R13: Frank's example — remove Mkz from Líder Sábado while he is in
Líder Domingo → the «no cambia nada» line with the «nunca líder sábado» hint; remove from both →
«deja de poder: líder sábado, líder domingo, …»; add to Soporte someone in a lead pool → no effect;
relative/absolute counts store the default unused field; R12: every day × seat combination outside the eleven refused with
  its hint, every one of the eleven non-empty under `rolesOfPatternV3`; integers only; `notTogether`
  with one member twice refused; `balance exempt:false` on a no-`voz` card allowed), `solverConfigCommit.test.ts` (lossless gate, stale `rev`, lines
  bound, R9: a contradiction already stored only noted, an unrelated edit still allowed; `exactCapOverlaps`, «al menos» above «como máximo», «exactamente 2 domingos» with «al menos 3
  domingos», a Sun.Lead minimum above a Sun.* maximum, each refused at check; R11: «Mes por medio» plus
  an exact Sun.Lead count, overlapping exact counts, a 21st presence group, a 13-person group, each
  refused as NEW; a problem already stored only noted; the cadence-outside-pool note),
  `rules.test.ts` (tools: token, expiry, unknown outcome, no ids in text).
- Docs in the same delivery: ADR (next free number at merge), `docs/MCP.md`, CLAUDE.md/AGENTS.md and
  `project-rules.md` (write-path list), `docs/UTILITIES_AND_COMPONENTS.md`, `docs/SECRETS.md` (a seventh
  `MCP_OAUTH_SECRET` use).

## 7. Release and live proof

Gates → one merge-range review → preview (dev alias) → PR to main → prod alias. Dev is no sandbox
(`preview` writes the production dataset), so the proof runs once, in production, with Frank, after his
explicit «sí» recorded in the PR, and only on a rule that cannot change any month:

1. Before: `get_solver_rules` (kept as the reference), a read-only raw snapshot of the `solverConfig`
   document with its `_rev` (Sanity MCP query, kept in the session; Sanity history also has it), and `list_proposals` (an open `solve_month`
   proposal needs regenerating after the first save; prove only when none is open, or Frank accepts
   regenerating it).
2. Frank picks a worship member with Tipo `voz`, already in a pool with Sunday roles (a rule makes its
   person a solver person, `v3SolveRequest.ts:263`, so someone already planned keeps «Auto plans exactly
   as before» strict), who has NO rule card yet. Check and save
   `count {person, pattern: domingo/todo, op: "como máximo", value: 31}`: a ceiling no month can reach
   (at most five Sundays), so Auto plans exactly as before while it exists. R11 shows no new problem.
3. Change it to «como máximo 30» (still unreachable). Check, save.
4. `removePerson` for that member: check, save. The card was created in step 2, so nothing else goes.
5. Pools, a check only, never a save: add someone already in «Líder Domingo» (proves the «ya estaba
   así» no-op) and an off-Tipo name (proves R6's refusal). No pool is written live; the pool write is
   proved by the tests and by the same serializer the count steps used.
6. After: `get_solver_rules` equals step 1's reference (rule for rule) and the document's `_rev` moved
   three times.

If the proof stops between steps 2 and 4 (a token expires, Frank steps away), the leftover rule is a
ceiling that never binds, so planning is unaffected; it is removed with `removePerson` from the chat or
the card's trash in /admin → Reglas, and step 6 is repeated. «Prueba MCP» is NOT used: it has no Tipo,
so any rule naming it would stop every Auto (`no_tipo`, §2), and R5 now refuses it anyway.

## 8. Out of scope

Re-keying rules by member id (parent §8). Creating the rules document (only the seed script may).
«Holgura» (stale under v3). Kids.
