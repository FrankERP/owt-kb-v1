# OWT MCP — admin parity, phase 1: stored services from the chat (plan)

**Status:** DRAFT 2026-10-21. Q1 decided A by Frank (16:03Z); Q2 and Q3 proceed on A unless he says
otherwise. Next: adversarial review of S2 (critical), then Frank's go-ahead.
**Requirement (Frank, 2026-10-21 15:48Z, verbatim):** «Quiero poder hacer todo lo que hago en la
página como admin, pero desde el chat». Phase order chosen on a decision card at 15:57Z: «Fase 1
primero (servicios guardados)». The four phases and the inventory behind them: the Claude Doc «Todo
el admin desde el chat».
**Builds on:** the proposal editor (ADR-0062, PR #160 `2e075190`, inline panels PR #162 `8c78fb3c`)
and the six admin write paths (`serviceCommitCallers.test.ts`).
**Risk tier:** S2 is **critical** (a production writer over several documents, reached from the
chat; the mutation trust boundary). S1, S3 and S4 are **standard**. Only S2 goes through
`.agents/skills/adversarial-plan-review/` (§Review policy).

---

## 1. What Frank gets

1. «Editar noviembre» in the chat opens the same card he already knows, now over the month's
   SAVED services: every service of the month, its seats, the planner's candidates in the planner's
   order, «¿Asignar de todos modos?» for a per-seat rule, and the month warnings (caps, presence,
   protections, Lead, empty seats, fair share) live as he edits.
2. He can also change a special's name or time and «Cuenta para equidad» on any service, as the
   grid's header does.
3. «Guardar» does not write from the card. It sends the change list to the chat in plain Spanish
   («domingo 8 nov · Lead: entra Ana, sale Bruno»), and Claude calls the destructive
   `save_service_edits`, so the Claude app asks before anything changes in production and the
   permission prompt shows each change and each forced rule.
4. The same works without the card: «pon a Ana en el Lead del 8 en lugar de Bruno» → Claude previews
   with `check_service_edits`, shows the same lines, and saves with the same tool.
5. Published services send exactly the emails `/admin` sends for the same save (the route's own
   notices, captured pre-commit).
6. New: `create_service` (one empty weekend service, special or «Noche de alabanza» on a date with
   none, as `/admin`'s «Crear servicio» does), `copy_instruments` (one service's instruments onto
   another), and three reads: the fairness ledger, the solver rules (as Spanish lines), the integrity
   queue.

What does not change: `/admin`, the PATCH and create routes' rules, the notices, the fairness records
(seat edits never touch eligibility), and the in-app assistant (still read-only, ADR-0060).

## 2. The decisions, and why

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| F1 | **One writer.** The PATCH handler of `app/api/admin/roles/[id]/route.ts` (seats, date, name, time, `countsForFairness`; lock, receipt and special-identity coordination; notices; revalidation) is extracted into `app/utils/roleEditCommit.ts`, called by the route and by the MCP. `copy-instruments` likewise into `copyInstrumentsCommit.ts`. Both join `serviceCommitCallers.test.ts` (six → eight write paths) | A second writer for the connector | The repo's rule since ADR-0043: MCP writes go only through the admin's own commit modules. The route keeps its auth and HTTP mapping only |
| F2 | **The judge is the proposal editor's.** A stored month becomes a board through `storedRoleReadModel.ts` (the grid's own stored-mode reader); every edit is replayed server-side through `pickJudge`/`evaluateMove`/`ruleFindings` with inputs from `columnRuleInputs` (`editorBoard.ts`), and the whole month through `monthCheck.ts` | Trust the card's board; or let the PATCH route's (rule-free) validation be the only check | ADR-0062 E1 and E4: one judge, on the server. The PATCH route enforces no solver rule, so without this a chat edit would skip what `/admin`'s grid checks |
| F3 | **Stateless change sets, target state per service.** A check answers, per changed service, `{service, baseRev, target}` (the full five-section seats + header fields as `serializeStoredColumn` would send them, members as tokens) plus the Spanish lines. `save_service_edits` takes that list back, re-judges it, and per service: current semantics == target → «ya estaba» (no write); current `_rev` == `baseRev` → write through `roleEditCommit` under that rev; else refused «cambió desde que lo revisaste». Services go one at a time, in date order; an unknown commit outcome stops the run and says so | (a) Ops (place/clear) replayed against CURRENT state at save. (b) A stored change-set record like `mcpProposal` | (a) is not idempotent: a retry after a partial save would replay «pon a Ana» onto a seat she already holds. Target state + `baseRev` is `/admin`'s own model (`freezeSaveAttempt`, `reconcileSaveAttempt`, `plannerSaveModel.ts`), so a retry of the same call finishes the rest and reports the rest as «ya estaba». (b) adds a record type and a lifecycle for a list that lives minutes; nothing needs it to outlive the chat turn |
| F4 | **The permission prompt shows what will happen.** `save_service_edits` requires `lines`: the Spanish change and waiver lines, which must equal the server's own rendering of the submitted targets against the stored services (the `sameWaiverItems` pattern, NFC multiset). A mismatch refuses before any write | Show only the JSON | The prompt is the guarantee Frank was given in ADR-0062 Q1 (2); tokens are unreadable, sentences are not |
| F5 | **Forcing a per-seat rule needs the card.** A C4 (role or week exclusion, pair) is accepted at save only with a waiver token minted by the app-only `check_service_edits_app` when Frank answers «Asignar de todos modos» (HMAC of `MCP_OAUTH_SECRET` over the service, seat, member and rule wording, under a distinct label); the waiver's line is also in `lines` | Let the save accept any echoed waiver | Keeps ADR-0062's «Claude desde el chat nunca puede forzar» true for stored services as it is for proposals: the model-visible preview never forces, and a waiver the model invents has no valid token |
| F6 | **Member tokens scoped to the month**, HMAC over `"mcp-member-token|month|" + YYYY-MM + "|" + memberId`, reversed over the pool plus the month's seated ids | Reuse the proposal tokens (scoped to a lineage root) | A stored month has no lineage; a month scope still keeps ids off the wire (KH-1) |
| F7 | **«Cuenta para equidad» keeps its read rule** (`countsForFairness.ts`): absent = unchanged; a change on a service in a past CDMX month is refused on the server (the planner's Switch is client-only, C1-D7; the connector has no such client) | Mirror only the client | The connector is a second client; the server is the only place both share |
| F8 | **No delete in phase 1.** | — | Phase 2, with its own echo-list confirmation |

## 3. Questions for Frank

- **Q1 — how he edits saved services. DECIDED A (Frank, 2026-10-21 16:03Z, «Tarjeta y chat»).** (A)
  The same card as proposals, plus the chat. (B) Chat only, no card.
- **Q2 — where the save happens.** (A, recommended; the plan proceeds on it unless he says otherwise)
  Through the chat, so the Claude app asks before writing and the prompt lists each change (F4).
  (B) Directly from the card after its own confirmation, without the Claude app's prompt.
- **Q3 — forcing a rule on a saved service.** (A, recommended) As on proposals: only from the card,
  and the rule appears in the permission prompt (F5). (B) Never from the chat; force in `/admin`.

## 4. Slices and tasks

### S1 — reads (standard)

- `get_fairness_ledger {month?}`: what `/admin` → Equidad shows, through `assembleFairnessLedger`
  (the GET's one call, ADR-0055) with `SANITY_API_READ_TOKEN` (fails closed, ADR-0050). Names, never
  ids.
- `get_solver_rules`: the rules and pools as Spanish lines (the planner's rule wording), never a rule
  key or the rules revision (KH-1, `monthToolHygiene.test.ts` extended).
- `get_integrity_queue {month?}`: the three `service-integrity` summaries, as `/admin` lists them.

### S2 — stored-month edits (critical)

**Scope of an edit.** Seats in all five sections, a special's `service_name` and `time`, and
`countsForFairness`. **Never the date**: a date move needs the dependency refusal, a destination
lock claim and occupancy checks (`route.ts` PATCH, `isMove`), and moving a column also moves every
rule input the judge reads; it stays in `/admin` until a later phase. A service whose stored
admission is not `approved` (`storedRoleReadModel.ts` `StoredRoleAdmission`: `bootstrapEligible`,
`readOnly`) is shown read-only, as the grid shows it, and any edit to it is refused.

- **T2.1 Extract the writers.** `roleEditCommit.ts` takes `{id, request: ParsedEditRequest}` and
  does everything `patchHandler` does after `denyUnlessManager` and `parseEditRequest`: the dangling
  ref check, `loadRoleForWrite` under `request.rev`, the stored-type whitelist and refusals, the
  move path (kept for the route), occupancy, lock heartbeat or bootstrap, the special identity
  claim, ONE transaction under `ifRevisionId(role._rev)`, the conflict mapping, and the post-commit
  side effects (`isNoticeNeutralEdit`, `notifyRoleAssignments`, `queueRoleNotices` with `before`
  captured pre-commit, `revalidateRoleMutation`). It returns the same `{status, body}` the route
  sends. `copyInstrumentsCommit.ts` likewise from `copy-instruments/route.ts`. The routes keep auth,
  JSON reading and `withVerificationRunContext` only; their existing tests pass unchanged, and
  `serviceCommitCallers.test.ts` lists both (eight write paths).
- **T2.2 The stored-month board** (`storedMonthBoard.ts`, neutral, no I/O): the month's stored
  roles → `translateStoredRole`/`buildStoredGridRows` → an `EditorBoard` whose `editable` set is
  the `approved` services, each column carrying `roleId` and `rev`. Rule inputs come only from
  `columnRuleInputs` (`editorInputs.test.ts`'s grep extends to the new modules) with the CURRENT
  `solverConfig` (a stored month has no bound rule set; a rule changed between check and save shows
  up as different lines and F4 refuses).
- **T2.3 The judge.** An edit list (`place`, `clear`, `exchange`, `move`, header changes) is replayed
  exactly as ADR-0062 E4 replays it (`pickJudge`, `evaluateMove`, the exchange unit, the
  whole-board safety net). The month check is `monthCheck` with every editable stored service as a
  planned column and the window's OTHER stored roles as `storedRoles`; eligibility for fair share
  comes from the month's `fairnessMonth` record through the ledger GET (a month with no record is
  judged «sin revisar» for the ledger lines only, E7).
- **T2.4 The check tools.** `check_service_edits` (model-visible): `{month, edits}` with members by
  NAME (exact display name, refused when ambiguous), never forces, answers lines, warnings and the
  F3 change set. `check_service_edits_app` (app-only): the same with month-scoped tokens (F6), a
  seat's candidates, and `force` on the last edit, which mints F5's waiver tokens.
- **T2.5 `save_service_edits`** (destructive, `destructiveHint: true`): `{month, changes:
  [{service, baseRev, target, waivers?}], lines}`. In order: admission (principal, super-admin);
  every `service` is a role of `month`, `approved`, at most once; `target` parses as a
  `ParsedEditRequest` for that role with the stored date; the target is judged as a DIFF against the
  stored role (removals first, then each added person through the pick gate on the board without
  them, then the safety net), never trusted; every C4 has a valid waiver token for exactly that
  service, seat, member and rule; the rendered lines equal `lines` (NFC multiset). Only then, one
  service at a time in date order: semantics already equal the target (`sameRoleSemantics`) →
  «ya estaba», no write; `_rev` ≠ `baseRev` → «cambió desde que lo revisaste», not written, the run
  continues with the rest (each service is independent, as `/admin`'s save is); otherwise
  `roleEditCommit` under `baseRev`. A thrown or non-409 commit failure is «sin confirmar» and STOPS
  the run (an unknown outcome must not be followed by more writes, as `/admin` breaks on a
  non-committed transport). The answer lists every service with its status and the next step
  (repeat the same call: done services answer «ya estaba»).
- **T2.6 Tests.** Route parity: the route's existing PATCH and copy tests unchanged; the same body
  through the commit and the route produces the same notices (outbox rows) for a published service
  and none for a draft. Save: idempotent retry after a partial run; stale `baseRev`; a target that
  adds a person the gate refuses (C1–C3) is refused before any write; a C4 without a token, with a
  token for another seat, and with a token after the rule wording changed; a `lines` mismatch; a
  `countsForFairness` change on a past CDMX month refused; a non-`approved` service refused; a date in
  `target` different from the stored one refused; a thrown commit stops the run. Hygiene: no member
  id, rule key or rules revision in any result, and no id or name in any log line
  (`monthToolHygiene.test.ts`); services cross as the role ids `get_service` already returns.

### S3 — create and copy (standard, over existing commits)

- `create_service {date, type, name?, time?, worshipNight?}` (destructive) through
  `roleCreateCommit` with the composer's `countsForFairness` rule and an idempotent
  `creationRequestId` = hash of the call; seats empty.
- `copy_instruments {from, to}` (destructive) through T2.1's commit, both revisions read fresh.

### S4 — the card over a stored month (standard)

- The proposal card gains a «mes guardado» mode: same board, panels and lock; «Guardar» sends the
  change list to the chat (`app.sendMessage`) as «Cargar» does.

## 5. Gates and release

tsc, vitest, eslint (0 errors); no `gcf_v3` change. One merge-range review (S1–S4); preview → dev
alias verified → PR → prod alias. Live proof with Frank: one service changed from the card, one
from the chat, a retry of the same save («ya estaba»), and `/admin` shows the result.

## 6. Out of scope

Deleting services and «Limpiar mes» (phase 2); proposals, songs, Kids (phase 3); rules and members
(phase 4); passwords, photos, login activity (never from the chat).

## 7. Docs in the same delivery

ADR (stored-service edits from the chat: F3, F4, F5), `docs/MCP.md` (the new tools, the permission
prompt), `docs/SECRETS.md` (the month-scoped token and the waiver token labels on
`MCP_OAUTH_SECRET`), CLAUDE.md + AGENTS.md + project-rules (eight write paths).
