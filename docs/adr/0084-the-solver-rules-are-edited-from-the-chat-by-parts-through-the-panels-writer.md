# ADR-0084: The solver rules are edited from the chat by parts, through the panel's writer

**Date:** 2026-11-11 · **Status:** Accepted

> **Numbering.** 0084 because records are numbered in the order they reach `main`; `preview`'s
> solver-ops record is 0086 (0085 went to the Jóvenes per-group leaders record).

## Context

Phase 4 of Frank's «Quiero poder hacer todo lo que hago en la página como admin, pero desde el chat»,
slice R (plan approved under the critical tier after five rounds, Frank's «Sí, constrúyelo»
2026-11-11: `docs/superpowers/plans/2026-11-06-owt-mcp-admin-parity-f4r-rules.md`, review log beside
it). `/admin` → «Generar mes» → Reglas saves the whole rule set (`POST /api/admin/solver-config`):
three pools of member ids and three lists of rules that name people by TEXT. Auto (solver v3) reads
that document for every month it plans. What made this slice a critical contract:

- A rule the model forgot, if the chat sent a whole document, would disappear for everyone.
- The solver refuses a whole unbound month for one bad rule (a name it cannot resolve, a person with no
  Tipo, «Mes por medio» next to an exact Sunday-lead count, a 21st presence group), so one chat save
  could stop Auto.
- Pools nest (Sat.Lead = Líder Domingo ∪ Líder Sábado; BGV and coro = any pool), so «quita a Mkz de
  Líder Sábado» does nothing while he is in Líder Domingo.
- `Sun.LeadBGV` and `Sat.LeadBGV` read as real sentences but expand to no role, so a rule using them is
  saved and silently ignored.

## Decision

- **One writer.** The route's POST body moved verbatim into `app/utils/solverConfigCommit.ts`
  (`saveSolverConfig`); the route keeps auth and the JSON parse, and its 47 tests pass unchanged. The
  chat's `checkRuleEdits` / `saveRuleEdits` write through the same parser and serializer, the same
  six-field `set` under `ifRevisionId`, with the server's own `SOLVER_CONFIG_VERSION`.
- **By parts, on a fresh read** (`app/utils/ruleEdits.ts`, pure): pool add/remove by name; never,
  allow again, a week off/on, a count (exact, minimum, maximum; absolute or «domingos del mes menos
  N»), «Mes por medio», «Fuera del balance total», remove a person's rule, two people not together,
  a group together, and their removals. Never a whole `SolverConfig` from the model.
- **Lossless gate.** The stored rules must survive the panel's own round trip unchanged (key order
  ignored), or every chat edit is refused with «ábrelas en /admin … y guárdalas una vez». The panel
  shows a coerced rule before its save; the chat shows only the edited lines.
- **People as the solver matches them.** An added name goes through the solver's own
  `resolveRulePersonId` over the planner's roster, must have Tipo Voz, and the stored text (the
  display name) must resolve back to that same person. A removal may name an orphaned rule's exact
  text. Pools store ids and take only a person whose Tipo fits (`memberFitsPool`).
- **Only the panel's eleven patterns** (`RULE_PATTERNS` in `ruleCopy.ts`, now read by the panel too;
  `patternRolesV3Sync.test.ts` pins that each one expands to a role). Anything else is refused with
  what to send instead.
- **The solver's judgement, new problems only.** The check runs the v3 eligibility resolver on the
  stored and the edited rules for the next CDMX month and refuses only a problem the edit ADDS; one
  already stored is shown as a note, so an unrelated edit is never blocked. It also refuses two
  absolute counts no month can satisfy (a minimum on A above a maximum on B whose roles contain A's),
  new ones only.
- **Lines that tell the truth.** Rules read before → after in the rules card's own words; a pool line
  says what the person starts or stops being able to do, or «no cambia nada» and why.
- **Check, then save.** The check answers the lines and a token `<iat>.<mac>` over `{rev, edits,
  lines}` (`MCP_OAUTH_SECRET`, 30 minutes). The save re-reads, re-plans, and writes only when the fresh
  revision, edits and lines match. Binding `_rev` is safe here, unlike people (ADR-0082): nothing but a
  rules save moves this document's revision. New item ids are HMACs of `(rev, edits, position)`, so the
  check and the save build the same document.
- **Nobody is notified, nothing is revalidated**, as the panel. `updatedBy` is the bearer's member id.

## Consequences

- 54 tools; `check_rule_edits` is read-only, `save_rule_edits` destructive, both only on write tiers
  (never the worship-admin read tier, ADR-0083).
- A known limit, declared in the plan: relative counts and partial pattern overlaps are not checked for
  contradiction (a v3 count is soft and clamped, so such a pair yields a violation line, never a crash).
- The bound-month note («si un mes ya tiene su registro de equidad guardado…») is shown whenever a
  balance or «Mes por medio» flag changes, a superset of the plan's «touches a person in a bound
  month's record»: the check does not read the ledger, and a superfluous note costs nothing.
- Rotating `MCP_OAUTH_SECRET` voids pending rules checks (`docs/SECRETS.md`).
- Released 2026-11-10 (PR #238); live proof passed 2026-11-11 (CDMX dates). That proof found that Claude Code shows the
  model only `structuredContent`, so the answers now carry their lines there too (members and songs too).

## Rejected

- Tools that call the route over HTTP (the bearer is not a NextAuth session; ADR-0043/0066).
- The whole document from the model, as the panel sends it.
- A targeted patch per edit (it bypasses the one parser that validates a rule value).
- Writing a lossy document anyway, as the panel does.
- Any day × seat, any member in any pool, ids on the wire.
- Letting the save or the solver find the contradiction after Frank's «sí».
- Random ids at save, or ids derived from the token (circular).
