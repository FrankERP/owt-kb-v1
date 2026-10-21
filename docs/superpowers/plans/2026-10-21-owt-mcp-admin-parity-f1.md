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
| F1 | **One writer, two shapes.** The PATCH handler of `app/api/admin/roles/[id]/route.ts` is split into a pure-ish planner and a committer in `app/utils/roleEditCommit.ts`: `planRoleEdit(role, request, reads)` returns the role's checks' verdict and the transaction operations for ONE role (the role patch under `ifRevisionId`, its lock heartbeat under the lock's CURRENT revision, the special-identity claim when its identity changes) plus its post-commit side effects; `commitRoleEdits(plans)` puts the operations of one or more plans into ONE transaction and, after it commits, runs each plan's side effects. The route calls it with one plan (date moves stay route-only, in the same module). `copy-instruments` is extracted into `copyInstrumentsCommit.ts` unchanged. Both join `serviceCommitCallers.test.ts` (six → eight write paths) | A second writer for the connector; or the MCP calling the single-role commit once per service | The repo's rule since ADR-0043: MCP writes go only through the admin's own commit code. Calling the single-role commit N times is the sequential save that review rounds 1–2 kept breaking (F3) |
| F2 | **The judge is the proposal editor's.** A stored month becomes a board through `storedRoleReadModel.ts` (the grid's own stored-mode reader); every edit is replayed server-side through `pickJudge`/`evaluateMove`/`ruleFindings` with inputs from `columnRuleInputs` (`editorBoard.ts`), and the whole month through `monthCheck.ts` | Trust the card's board; or let the PATCH route's (rule-free) validation be the only check | ADR-0062 E1 and E4: one judge, on the server. The PATCH route enforces no solver rule, so without this a chat edit would skip what `/admin`'s grid checks |
| F3 | **A save is ALL OR NOTHING: one transaction for every changed service.** A check answers, per changed service, `{service, baseRev, target, lines, waivers}` (the full five-section seats + header fields, members as tokens; never a `lockRev`). `save_service_edits` reads the month fresh and sorts every service: semantics equal to `target` (`sameRoleSemantics`) → «ya estaba»; `_rev` ≠ `baseRev` → «cambió desde que lo revisaste»; else «por guardar». Any «cambió» refuses the call. The «por guardar» services are judged, then written by ONE `commitRoleEdits` transaction: every role patch asserts its `baseRev`, every lock heartbeat asserts the lock revision read in THIS call. It commits whole or not at all | (a) Ops replayed against current state. (b) A stored change-set record. (c) Sequential per-service writes, with or without groups (this plan's rounds 1–2) | (a) is not idempotent. (b) adds a record and a lifecycle for a list that lives minutes. (c) can land one side of a move and not the other (a person doubled or dropped, which the chat does not show), needs a time cut-off and a retry protocol, and loops forever when a setlist save moves the weekend lock between check and save (`setlistSaveCommit.ts` heartbeats it; a client-carried `lockRev` would then 409 on every retry). One transaction removes all three: there is no partial state, the retry after an unknown outcome sorts unambiguously (all «ya estaba» or all at `baseRev`), and the lock revision is read at save. The cost: a Sanity conflict on any one service refuses the whole save, which Frank re-checks; `/admin`'s grid keeps its per-column save |
| F4 | **The permission prompt shows what will happen.** Each change carries its `lines` (the Spanish change lines and, for a forced seat, its waiver line); for every «por guardar» service they must equal the server's own rendering of `target` against that service's stored state (NFC multiset, the `sameWaiverItems` pattern). A mismatch refuses the whole call before any write. Lines on «ya estaba» services are not compared, and their waivers are not needed | Show only the JSON | The prompt is the guarantee Frank was given in ADR-0062 Q1 (2); tokens are unreadable, sentences are not |
| F5 | **Forcing a per-seat rule needs the card.** Every NEW rule finding on a «por guardar» service (the whole-board safety net, keyed by `FindingKey` as `editorBoard.ts`/`waivers.ts` key them: a role or week exclusion by service, seat and member; a pair by the unordered pair of members in that service) needs a waiver token minted by the app-only `check_service_edits_app` when Frank answers «Asignar de todos modos»: HMAC of `MCP_OAUTH_SECRET` under its own label over the `FindingKey`, the rule wording, the service and its `baseRev`. Binding `baseRev` makes a token die with the write it was minted for. Findings already on the stored service before the edit (forced earlier in `/admin`, stored nowhere) are the baseline: warnings, never refusals, as `waivers.ts` treats the base board. A token for a finding that no longer arises is ignored | Let the save accept any echoed waiver; or key tokens by the seat the card asked about | Keeps ADR-0062's «Claude desde el chat nunca puede forzar» true for stored services: the model-visible preview never forces, and a waiver the model invents or reuses has no valid token. The save judges additions order-independently, so a pair finding may name the other member than the one the card asked about; `FindingKey` is what the safety net actually produces |
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

- **T2.1 Extract the writers.** `roleEditCommit.ts` (F1): `planRoleEdit` holds everything
  `patchHandler` does between `parseEditRequest` and the transaction for a SAME-DATE edit (the
  dangling-ref check, `loadRoleForWrite` under `request.rev`, the stored-type whitelist and
  refusals, special occupancy, the lock plan, the special identity claim, `beforeSeats` captured
  pre-commit, the side-effect plan); `commitRoleEdits(plans)` builds one transaction, maps a Sanity
  conflict to `stale_revision` exactly as the route does, rethrows anything else, and runs every
  plan's side effects (`isNoticeNeutralEdit`, `notifyRoleAssignments`, `queueRoleNotices`,
  `revalidateRoleMutation`) after the commit. Several specials renamed in one save share ONE
  coordinator claim (the claim is a version bump of a single document; two claims in one
  transaction would conflict with themselves). A lock needing bootstrap refuses the save (only
  `approved` services are editable, F2/T2.2). The route keeps auth, JSON, the date-move path and
  `withVerificationRunContext`; its tests pass unchanged. `copyInstrumentsCommit.ts` likewise.
  `serviceCommitCallers.test.ts` (with `DELIVERY_CAPABLE_IMPORTS`) and `protectedReadAudit.ts`'s
  `PROTECTED_RUNTIME_WRITERS` list both (eight write paths).
- **T2.2 The stored-month board** (`storedMonthBoard.ts`, neutral, no I/O): the month's stored
  roles → `translateStoredRole`/`buildStoredGridRows` → an `EditorBoard` whose `editable` set is
  the `approved` services, each column carrying `roleId` and `rev`. Rule inputs come only from
  `columnRuleInputs` (`editorInputs.test.ts`'s grep extends to the new modules) with the CURRENT
  `solverConfig` (a stored month has no bound rule set; a rule changed between check and save shows
  up as different lines and F4 refuses).
- **T2.3 The judge.** An edit list (`place`, `clear`, `exchange`, `move`, header changes) is replayed
  as ADR-0062 E4 replays it (`pickJudge`, the exchange unit, the whole-board safety net), except that
  a `move` is judged in STORED mode (`moveGate.ts`: P2 = both endpoints serialize), and both
  endpoints must be `approved` (a separate check: stored mode has no `canReceive`). Stored columns
  carry `admission` and `storedFairness` as the grid's do. The safety net's baseline is the stored
  board as read (F5); a force on a baseline finding mints nothing and renders no waiver line (the
  rule was already broken before this edit; ADR delta to ADR-0062 A4, stated in the ADR).
  Admission comes from `joinStoredRoleInventory` over a server-built `RoleDomainSummary`, as
  `v3MonthPlan.ts` builds it; an incoherent inventory makes the whole month read-only, as on `/admin`.
  The month check (`monthCheck`) gets its `entries` from the month's `fairnessMonth` record (the
  frozen eligibility it already carries) and the voice targets from the planner's rows; a month with
  no record is «sin revisar» for the lines that need it (E7). Members are named by display name; two
  members with the same display name are shown with their Tipo to tell them apart in every line. The month check is `monthCheck` with every editable stored service as a
  planned column and the window's OTHER stored roles as `storedRoles`; eligibility for fair share
  comes from the month's `fairnessMonth` record through the ledger GET (a month with no record is
  judged «sin revisar» for the ledger lines only, E7).
- **T2.4 The check tools.** `check_service_edits` (model-visible): `{month, edits}` with members by
  NAME (exact display name, refused when ambiguous), never forces, answers lines, warnings and the
  F3 change set. `check_service_edits_app` (app-only): the same with month-scoped tokens (F6), a
  seat's candidates, and `force` on the last edit, which mints F5's waiver tokens.
- **T2.5 `save_service_edits`** (destructive, `destructiveHint: true`): `{month, changes:
  [{service, baseRev, target, lines, waivers?}]}`.
  1. Admission (principal, super-admin). Every `service` is a role of `month`, `approved`, at most
     once; `target` parses as a `ParsedEditRequest` for that role with its STORED date and no
     `lockRev`; at most 31.
  2. One fresh read of the month (roles, locks, the integrity join); sort (F3). Any «cambió» → refuse,
     nothing written. All «ya estaba» → say so, nothing written. A MIX of «ya estaba» whose `_rev` ≠
     `baseRev` and «por guardar» → refuse as «cambió»: an atomic save of ours cannot leave that mix,
     so someone else changed part of the month (e.g. moved a person this save would now double).
  3. For the «por guardar» services: each target is judged as a DIFF against its stored role
     (removals first, then each added person through the pick gate on the board without them, then
     the safety net) on the board of the current month; every new finding has a valid token (F5);
     the lines match (F4); a `countsForFairness` change on a past CDMX month is refused (F7). Any
     failure refuses all.
  4. `planRoleEdit` for each, then ONE `commitRoleEdits`. A conflict → «no se guardó nada: algo
     cambió mientras guardaba; vuelve a revisar». A thrown or unknown outcome → «sin confirmar:
     repite la misma llamada». The repeat sorts the month again: all «ya estaba» (it committed; its
     notices were not queued, as with `/admin` after an unknown outcome — said in the answer) or all
     at `baseRev` (it did not; it is written now).
- **T2.6 Tests.** Route parity: the route's existing PATCH and copy tests unchanged; the same body
  through the commit and the route produces the same notices (outbox rows) for a published service
  and none for a draft. Save: one save of three services commits in one transaction (a Sanity conflict injected on the
  third leaves all three unchanged); an unknown outcome then the same call answers «ya estaba» for
  all when it had committed, and writes all when it had not; a weekend setlist saved between check
  and save does not block the save (the lock revision is read at save); two specials renamed in one
  save make one coordinator claim; a stale service refuses the whole call; a waiver token replayed on
  a later `baseRev` refused; a pair forced from the card accepted whichever member the save's
  finding names; a stored service already breaking a rule can still be edited (baseline); a move
  out of a non-`approved` service refused at check; a C1–C3 addition refused before any write; a
  C4 without a token, with a token for another finding, and after the rule wording changed; a
  `lines` mismatch; a
  `countsForFairness` change on a past CDMX month refused; a non-`approved` service refused; a date in
  `target` different from the stored one refused. Hygiene: no member
  id, rule key or rules revision in any result, and no id or name in any log line
  (`monthToolHygiene.test.ts`); services cross as the role ids `get_service` already returns.

### S3 — create and copy (standard, over existing commits)

- `create_service {date, type, name?, time?, worshipNight?}` (destructive) through
  `roleCreateCommit` with the composer's `countsForFairness` rule and an idempotent
  `creationRequestId` = hash of the call; seats empty.
- `copy_instruments {from, to, lines}` (destructive) through T2.1's commit, both revisions read
  fresh; `lines` names every person the copy seats («domingo 8 nov · Batería: Carlos»), compared as
  in F4, so the permission prompt shows who is seated.

### S4 — the card over a stored month (standard)

- The proposal card gains a «mes guardado» mode: same board, panels and lock; «Guardar» sends the
  change list to the chat (`app.sendMessage`) as «Cargar» does.

## 5. Gates and release

tsc, vitest, eslint (0 errors); no `gcf_v3` change. One merge-range review (S1–S4); preview → dev
alias verified → PR → prod alias. Live proof with Frank: one service changed from the card, one
from the chat, a retry of the same save («ya estaba»), and `/admin` shows the result.

## 6. Out of scope

What `/admin` does that phase 1 still leaves there: moving a service to another date, and editing
legacy services the integrity join marks `bootstrapEligible` (the grid bootstraps their lock on save;
the chat shows them read-only). Deleting services and «Limpiar mes» (phase 2); proposals, songs, Kids (phase 3); rules and members
(phase 4); passwords, photos, login activity (never from the chat).

## 7. Docs in the same delivery

ADR (stored-service edits from the chat: F3, F4, F5), `docs/MCP.md` (the new tools, the permission
prompt), `docs/SECRETS.md` (the month-scoped token and the waiver token labels on
`MCP_OAUTH_SECRET`), CLAUDE.md + AGENTS.md + project-rules (eight write paths; the editor invariant reworded: a STORED
month's save judges each target as a diff and commits in one transaction; ADR-0062 guarantee (1)'s
caveat, that a client without MCP Apps support shows app-only tools to the model, repeated for
`check_service_edits_app`'s `force`).
