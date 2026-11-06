# OWT MCP — admin parity, phase 4, slice R: the solver rules from the chat (slice plan)

**Status:** DRAFT, critical tier (a production writer of a shared document, a full-document
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
Frank's word. A save changes the rules for the NEXT month generated: saved months do not move, and an
open `solve_month` proposal must be generated again (its `rulesRev` no longer matches; `applySchedule.ts`
already refuses it).

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
- **Who.** The connector's write tools are super-admin only (the full tool tier; ADR-0083 gives admins
  a read tier that this slice does not touch).

## 3. Decisions, and why

| # | Decision | Rejected | Why |
|---|---|---|---|
| R1 | `app/utils/solverConfigCommit.ts` owns the write: `saveSolverConfig(body, actorId)` is the route's POST body verbatim after auth; `checkRuleEdits` / `saveRuleEdits` are the chat's. The route keeps auth and the JSON parse. | Tools that call the route over HTTP. | ADR-0043/0066: one code path; the bearer is not a NextAuth session. |
| R2 | The chat edits BY PARTS (§4), applied to the freshly read config, never a whole `SolverConfig` from the model. | The chat sends the whole config, as the panel does. | A whole-document body is how a rule the model forgot disappears (ADR-0077's argument). |
| R3 | The chat's write is the panel's write: `parseSolverConfigWrite(edited)` → the same six-field `set` + stamp under `ifRevisionId`, with the server's own `SOLVER_CONFIG_VERSION`. | A targeted patch per edit. | The panel's serializer is the one place a rule value is validated (CLAUDE.md `solverConfig` invariant: no writer sets a rule value around it). Targeted writers are the documented exceptions, and an edit can create items, which a path patch cannot validate. |
| R4 | **Lossless gate.** Before a chat edit, the stored rule fields must round-trip: `solverConfigFields(parse(fromDocument(raw)))` deep-equals the raw document's six fields (key order ignored). Otherwise the check refuses every edit: «Las reglas guardadas tienen algo que esta versión leería distinto; ábrelas en /admin → Generar mes → Reglas y guárdalas una vez». | Write anyway, as the panel's save does. | The lenient reader coerces values it does not know (ADR-0082 rejected the parse pipeline for exactly this). The panel shows the coerced rule on screen before its save; the chat shows only the edited lines, so a silent coercion of an untouched rule would be invisible. Production passes today (§2). |
| R5 | **People must match** (parent D4). A person in an ADD edit must name exactly ONE current member (non-draft `teamMembers`, disabled included) by name or alias, `rulePersonNamesMember`'s criterion; the stored text is that member's display name through `normalizeLabel` (alias if set, else name), the same text slice M's rename keeps current. None or several → refused, listing up to five close names (accent- and case-folded prefix). A REMOVE or CHANGE may also name a rule's exact stored text (trim, case-insensitive) so an orphaned rule (one naming nobody) can be removed. | Free text, as the panel accepts. | Free text is how Vale's rule silently stopped applying. The chat cannot pick from a dropdown. |
| R6 | Pools take members by name (R5) and store ids. Adding someone already in the pool, or removing someone not in it, is «ya estaba así» (a no-op line, not a refusal). | Ids from the model. | Members on the wire are names, never ids (ADR-0062's rule for the editor; KH-1 for rules). |
| R7 | **Check then save**, token `mcp-rule-edits|` over `{rev, edits, lines}` (HMAC with `MCP_OAUTH_SECRET`, 30 minutes, the same shape as `songTokens.ts`). The save re-reads, refuses a different `_rev` («Las reglas cambiaron desde la revisión; revisa de nuevo»), re-applies the edits, re-renders the lines and requires them byte-equal to the token's, then writes under `ifRevisionId`. | `rev` alone; a two-half token as slice M. | The rules document's `_rev` moves only when the rules are saved (no `lastSeen` on it), so binding `rev` is safe here, unlike people. Frank compares sentences, so the lines are bound. |
| R8 | New items get `id = <prefix>-` + 12 hex of HMAC(token, index) (`r-`, `c-`, `p-`, `cap-`, `we-`), so a check and its save produce the same document; ids never reach a line or the model. | `crypto.randomUUID()` at save. | Deterministic ids keep the save a pure function of `(stored, edits, token)`, which is what the tests can pin; a retry after a landed save is refused by R7's `rev`, so no duplicate. |
| R9 | The check refuses an edit set whose result fails `parseSolverConfigWrite` (e.g. two exact counts for one person on one role, `exactCapOverlaps`), in Spanish, naming the rule. | Let the save fail. | The check is where Frank decides; a save that fails after his «sí» wastes his word. |
| R10 | No notification, no revalidation (the route has none and needs none). `updatedBy` = the bearer's member id, as the route stamps the session's. | — | Parity. |

## 4. The edits (`applyRuleEdits(config, edits, roster)`, pure, `app/utils/ruleEdits.ts`)

Patterns on the wire are words, never notation: `{day: "domingo" | "sábado" | "ambos", seat: "líder" |
"BGV" | "coro" | "líder o BGV" | "todo"}` → `Sun|Sat|*` . `Lead|BGV|Choir|LeadBGV|*`. Matching an
existing item compares canonical patterns (legacy alias resolved).

| Edit | Effect |
|---|---|
| `pool {pool: "líder domingo"|"líder sábado"|"soporte", add?: names[], remove?: names[]}` | ids added at the end / removed; R6 no-ops reported. |
| `never {person, pattern}` / `allowAgain {person, pattern}` | add to / remove from that person's `excludedPatterns`. |
| `weekOff {person, week (1–5), pattern}` / `weekOn {…}` | add / remove a week exclusion. |
| `count {person, pattern, op: "exactamente"|"al menos"|"como máximo", value?: 0–31, relative?: {minus: 0–5}}` | add a cap, or replace the ONE existing cap with that pattern and op. |
| `removeCount {person, pattern, op}` | remove that cap (none or several → refused). |
| `cadence {person, alternate: boolean}` | set/clear «Mes por medio». |
| `balance {person, exempt: boolean}` | `fairness` exempt / none («Holgura» is never written: it is stale under v3; a stored slack is cleared by `exempt:false`). |
| `removePerson {person}` | remove the person's whole rule card. |
| `notTogether {a, b, pattern}` / `removeNotTogether {a, b, pattern?}` | add a conflict / remove the one matching pair (order-free). |
| `together {persons: 2–8 names, pattern}` / `removeTogether {persons, pattern?}` | add a presence group / remove the matching one (set-equal persons). |

A person edit targets the person's ONE card (the restriction whose text names the member); none → a new
card is created for an add, refused for a remove; several cards for one member → refused with «dos
reglas nombran a X; únelas en /admin». An edit that changes nothing → «ya estaba así», no line. At most
30 edits per call.

## 5. Tools (`app/mcp/tools/rules.ts`, full tier only)

- `check_rule_edits {edits}` — read-only: the lossless gate, the edits, the lines (`Regla: «before» →
  «after»`, `Nueva regla: «…»`, `Se quita: «…»`, pools as `Líder Sábado: − Mkz`), the notes (an open
  proposal needs regenerating; a no-op), and the token. Never an id or `rev` in the text (`rev` travels
  inside the token only).
- `save_rule_edits {edits, token}` — destructive (I14). R7. Unknown outcome (a throw after the domain
  call) → «No sé si se guardó; lee las reglas con get_solver_rules antes de reintentar».
- `get_solver_rules` is unchanged.

## 6. Pins, tests, docs

- `serviceCommitCallers` (the route + `rules.ts`), `deliveryCapableImports`, `seatClashGuardCoverage`
  NON_SEAT_WRITERS, `srVerificationRunContext` (the route wrapped), `mcpSanityClients` (reads only via
  `app/mcp/reads/*`), tool digest + `mcp-dev-smoke.mjs` (54 tools), `monthToolHygiene` (no ids).
- Route tests unchanged and passing (the move is verbatim). New: `ruleEdits.test.ts` (every row of §4,
  R5's matching, R6 no-ops, the several-cards refusal, legacy patterns), `solverConfigCommit.test.ts`
  (lossless gate, stale `rev`, deterministic ids, lines bound, `exactCapOverlaps` refused at check),
  `rules.test.ts` (tools: token, expiry, unknown outcome, no ids in text).
- Docs in the same delivery: ADR (next free number at merge), `docs/MCP.md`, CLAUDE.md/AGENTS.md and
  `project-rules.md` (write-path list), `docs/UTILITIES_AND_COMPONENTS.md`, `docs/SECRETS.md` (a seventh
  `MCP_OAUTH_SECRET` use).

## 7. Release and live proof

Gates → one merge-range review → preview (dev alias) → PR to main → prod alias. Live proof with Frank,
after his explicit «sí» recorded in the PR: add a count to «Prueba MCP» (the disabled throwaway from
slice M; no Tipo, so it never enters a month), change it, remove the card; add and remove it in
«Soporte». Every step leaves the rules as they were; `get_solver_rules` before and after must match.

## 8. Out of scope

Re-keying rules by member id (parent §8). Creating the rules document (only the seed script may).
«Holgura» (stale under v3). Kids.
