# OWT MCP — admin parity, phase 1: stored services from the chat (plan)

**Status:** BUILT 2026-10-21 (Frank: «Sí, constrúyela», 17:20Z): S1–S4 on branch
`claude/project-thread-j7kvyq`; where the build differs from this plan is listed in ADR-0066
(«Where the build differs from the plan»). Not yet released.
**Approval:** S2 APPROVED by adversarial review 2026-10-21 (rounds 5 and 6 on the same bytes,
`9892c245…ed2d`; log: `2026-10-21-owt-mcp-admin-parity-f1-review-log.md`). Post-approval
non-blocking edits are listed there as un-reviewed. Q1 decided A by Frank (16:03Z); Q2 and Q3
proceed on A unless he says otherwise. Next: Frank's go-ahead to build.
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
| F3 | **Stateless change sets, target state per service, sorted before anything is judged; written one service at a time (Frank, 2026-10-21 16:37Z: keep the per-service save and fix its two failures).** A check answers, per changed service, `{service, baseRev, target, diff, mac, lines, waivers}`: the full five-section seats + header fields (members as tokens, and NEVER a `lockRev`: the commit reads the lock fresh and asserts the revision it read, so a weekend setlist saved between check and save, which heartbeats the lock, `setlistSaveCommit.ts`, cannot block the save; a SPECIAL's setlist lives on the role itself, so a setlist saved on a special or worship night between check and save moves its `_rev` and that service answers «cambió» with that reason). `save_service_edits` reads the month fresh and sorts every service: semantics equal to `target` (`sameRoleSemantics`) → «ya estaba»; `_rev` ≠ `baseRev` → «cambió desde que lo revisaste»; else «por guardar». Any «cambió» refuses the WHOLE call before any write. Only «por guardar» services are judged, have their lines compared and their waivers verified (for them, current == base, so the server's rendering reproduces the check's). **Groups are derived by the server, never sent:** services joined because a member leaves one changed service and enters another in the same call (transitively) form a group; a group's services are written back to back, and a group of more than 6 services is refused («guarda esos cambios en partes») so a group always fits the time limit (T2.5) | (a) Ops (place/clear) replayed against CURRENT state at save. (b) A stored change-set record like `mcpProposal`. (c) `/admin`'s «skip the stale one and continue». (d) One transaction for every service (offered to Frank; he chose this design) | (a) is not idempotent: a retry after a partial save would replay «pon a Ana» onto a seat she already holds. Target state + `baseRev` is `/admin`'s own model (`freezeSaveAttempt`, `reconcileSaveAttempt`, `plannerSaveModel.ts`), and sorting first makes a repeat of the same call finish the rest: written services answer «ya estaba» and are not re-judged. (b) adds a record type and a lifecycle for a list that lives minutes. (c) lets one side of a move land while the other is stale. A group carried by the client could be dropped or wrong, so the server derives it |
| F4 | **The permission prompt shows what will happen.** Each change carries its `lines` (the Spanish change lines and, for a forced seat, its waiver line); for every «por guardar» service they must equal the server's own rendering of `target` against that service's stored state (NFC multiset, the `sameWaiverItems` pattern). A mismatch refuses the whole call before any write. Lines on «ya estaba» services are not compared, and their waivers are not needed | Show only the JSON | The prompt is the guarantee Frank was given in ADR-0062 Q1 (2); tokens are unreadable, sentences are not |
| F5 | **Forcing a per-seat rule needs the card.** Every NEW rule finding on a «por guardar» service (the whole-board safety net, keyed by `FindingKey` as `editorBoard.ts`/`waivers.ts` key them: a role or week exclusion by service, seat and member; a pair by the unordered pair of members in that service) needs a waiver token minted by the app-only `check_service_edits_app` when Frank answers «Asignar de todos modos»: HMAC of `MCP_OAUTH_SECRET` under its own label over the `FindingKey`, the rule wording, the service and its `baseRev`. Binding `baseRev` makes a token die with the write it was minted for. Findings already on the stored service before the edit (forced earlier in `/admin`, stored nowhere) are the baseline: warnings, never refusals, as `waivers.ts` treats the base board; when the card forces one of them again, it mints no token but its waiver line still appears in `lines`, marked «ya estaba rota antes de este cambio», so every forced per-seat rule is in the permission prompt. A token for a finding that no longer arises is ignored | Let the save accept any echoed waiver; or key tokens by the seat the card asked about | Keeps ADR-0062's «Claude desde el chat nunca puede forzar» true for stored services: the model-visible preview never forces, and a waiver the model invents or reuses has no valid token. The save judges additions order-independently, so a pair finding may name the other member than the one the card asked about; `FindingKey` is what the safety net actually produces |
| F6 | **Member tokens scoped to the month**, HMAC over `"mcp-member-token|month|" + YYYY-MM + "|" + memberId`, reversed over the pool plus the month's seated ids | Reuse the proposal tokens (scoped to a lineage root) | A stored month has no lineage; a month scope still keeps ids off the wire (KH-1) |
| F7 | **«Cuenta para equidad» keeps its read rule** (`countsForFairness.ts`): absent = unchanged; a change (a value that differs from the service's effective stored value, `effectiveStoredCounts` in `fairnessToggleModel.ts` over the `countsForFairness.ts` read rule) on a service in a past CDMX month is refused on the server (the planner's Switch is client-only, C1-D7; the connector has no such client) | Mirror only the client | The connector is a second client; the server is the only place both share |
| F8 | **No delete in phase 1.** | — | Phase 2, with its own echo-list confirmation |

## 3. Questions for Frank

- **Q1 — how he edits saved services. DECIDED A (Frank, 2026-10-21 16:03Z, «Tarjeta y chat»).** (A)
  The same card as proposals, plus the chat. (B) Chat only, no card.
- **Q2 — where the save happens.** (A, recommended; the plan proceeds on it unless he says otherwise)
  Through the chat, so the Claude app asks before writing and the prompt lists each change (F4).
  (B) Directly from the card after its own confirmation, without the Claude app's prompt.
- **Q3 — forcing a rule on a saved service.** (A, recommended) As on proposals: only from the card,
  and the rule appears in the permission prompt (F5; a rule the service already broke before the
  edit shows there marked «ya estaba rota», without a token). (B) Never from the chat; force in `/admin`.

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
  does everything `patchHandler` does after `denyUnlessManager` and `parseEditRequest` (a request without `lockRev` loads the lock and heartbeats it under the revision it read, as the route already does when `lockRev` is absent): the dangling
  ref check, `loadRoleForWrite` under `request.rev`, the stored-type whitelist and refusals, the
  move path (kept for the route), occupancy, lock heartbeat or bootstrap, the special identity
  claim, ONE transaction under `ifRevisionId(role._rev)`, the conflict mapping, and the post-commit
  side effects (`isNoticeNeutralEdit`, `notifyRoleAssignments`, `queueRoleNotices` with `before`
  captured pre-commit, `revalidateRoleMutation`). It takes the side-effect options
  `{deferred, sweep, client}` (route: deferred, sweep on, the module clients — unchanged; MCP save:
  inline, sweep off, the time left; T2.5 item 4). It returns the same `{status, body}` the route
  sends. `copyInstrumentsCommit.ts` likewise from `copy-instruments/route.ts`. The routes keep auth,
  JSON reading and `withVerificationRunContext` only; their existing tests pass unchanged, and
  `serviceCommitCallers.test.ts` (with its `DELIVERY_CAPABLE_IMPORTS` fixture) and
  `protectedReadAudit.ts`'s `PROTECTED_RUNTIME_WRITERS` list both (eight write paths).
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
  board as read (F5); a force on a baseline finding mints no token (the rule was already broken
  before this edit) but still renders its waiver line, marked «ya estaba rota antes de este cambio»,
  so A4's visibility holds; only the token is skipped (ADR delta to ADR-0062 A4, stated in the ADR).
  Admission comes from `joinStoredRoleInventory` over a server-built `RoleDomainSummary`, as
  `v3MonthPlan.ts` builds it; an incoherent inventory makes the whole month read-only, as on `/admin`.
  The month check is `monthCheck` with every editable stored service as a planned column and the
  window's OTHER stored roles as `storedRoles`; its `entries` come from the month's `fairnessMonth`
  record (the frozen eligibility it already carries, read through the ledger GET) and the voice
  targets from the planner's rows; a month with
  no record is «sin revisar» for the lines that need it (E7). Members are named by display name; two
  members with the same display name are shown with their Tipo to tell them apart in every line.
- **T2.4 The check tools.** Every `target` carries the service's full header as stored: a timed
  special's `time` is always present, because an absent `time` CLEARS it (`parseEditRequest`); a
  target built from a chat request inherits the stored header, never a guess. The month check also
  warns when a worship night's song leader (`songs[].leads`) is no longer in its Lead (the role
  writer does not check it; ADR-0036 enforces it only at the setlist writer). `check_service_edits` (model-visible): `{month, edits}` with members by
  NAME (exact display name, refused when ambiguous), never forces, answers lines, warnings and the
  F3 change set. `check_service_edits_app` (app-only): the same with month-scoped tokens (F6), a
  seat's candidates, and `force` per edit (as `proposalEditor.ts` carries it), which mints F5's waiver tokens.
- **T2.5 `save_service_edits`** (destructive, `destructiveHint: true`): `{month, changes:
  [{service, baseRev, target, diff, mac, lines, waivers?}]}`.
  1. Admission (principal, super-admin). Every `service` is a role of `month`, `approved`, at most
     once; `target` parses as a `ParsedEditRequest` for that role with its STORED date and no
     `lockRev`; at most 31.
  2. One fresh read of the month (roles, locks, the integrity join); sort (F3). Any «cambió» → refuse,
     nothing written. All «ya estaba» → say so, nothing written. Derive the groups (F3) over EVERY
     service the call names, «ya estaba» ones included from each change's `diff` (who leaves and who enters
     each section, as tokens), which the check returns with a MAC (HMAC of `MCP_OAUTH_SECRET` under
     its own label over `service`, `baseRev`, `target` and `diff`); the save verifies every MAC, and
     for «por guardar» services also that `diff` equals `target` minus the stored state. A
     «ya estaba» service's base is gone, so its signed `diff` is the only record of what it changed:
     on a repeat after a partial group write, the remaining side is still in its group and a failure
     on it still says who is where.
  3. For the «por guardar» services only: the target is judged as a DIFF against the stored role
     (removals first, then each added person through the pick gate on the board without them, then
     the safety net) on the board made of the current state of every other service; every new
     finding has a valid token (F5); the lines match (F4); a `countsForFairness` value that differs from the effective
     stored one (`effectiveStoredCounts`) on a past CDMX month is refused (F7); a group over 6 services is refused. Any failure refuses all,
     nothing written.
  4. Writes, through `roleEditCommit` under `baseRev`, one service at a time: groups and single
     services in order of their earliest date, a group's services back to back. **Time model:**
     Next holds every `after()` callback registered during the call until the MCP response closes,
     then starts them all at once (`next/dist/server/after/after-context.js`, a paused queue), inside
     the same 60 s. So anything left in `after()` runs only once the
     whole call is over, and a call killed at 60 s loses it: the services already written would
     answer «ya estaba» on the repeat and never queue their notices. Therefore the MCP save runs
     each write's DURABLE side effects INLINE, awaited, before the next write starts (a
     `deferred: false` mode on the shared side-effect path; the route keeps its `after()`): the
     outbox upsert (`queueRoleNotices` with that write's pre-commit `before`); an upsert that fails
     or times out does not stop the run, and that service answers «guardado, avisos sin confirmar».
     Revalidation is called per write but only QUEUED on the request (`revalidatePath` runs when the
     request ends, `withExecuteRevalidates`): a killed call leaves those pages stale until the next
     write. Harmless, stated. Only the push stays in `after()` (best-effort, as on the route; the outbox is the record).
     The opportunistic layer-2 sweep is OFF in this call (`sweep: false`; the route keeps it ON).
     Nothing is lost by that: a seat edit's notice is debounced 15 minutes (`DEBOUNCE_MS`,
     `outboxNotice.ts`), and any notice that is due waits at most until layer 1 (every 5 minutes)
     flushes it. **Every Sanity request in the save carries a timeout** derived from the time left
     (`writeClient` has none of its own, so @sanity/client's 5-minute default would apply), with a
     hard stop at 45 s from the call's start: a request that times out is «sin confirmar» and
     STOPS the run. The save passes its own client (`withConfig` with that timeout and
     `maxRetries: 0`, since get-it otherwise retries GETs and queries up to 5 times) through the
     commit's loaders (`roleWriteOps.ts`: `loadRoleForWrite`, `loadLock`, `loadTargetOccupancy`,
     `loadCanonicalMemberIds`, `bootstrapLegacyLock`; `specialIdentityCoordinator.ts`) and the
     outbox upsert, and each write also races an outer deadline. The route keeps its clients. No group or single service STARTS after a cut-off set from a dev measurement of
     the WHOLE call (first write to the response, published services, the largest allowed group,
     each write with its inline upsert), so that the last started group ends with
     at least 15 s to spare; it starts at 30 s and only moves down. What did not start answers
     «pendiente». **Each write's outcome is classified as the planner classifies a PATCH**
     (`classifyPatchOutcome` in `plannerSaveModel.ts`, applied to the commit's status and error
     code): `knownCommitted`; `knownFailure` (only the proven pre-write codes in
     `PROVEN_PREWRITE_FAILURES`: nothing was written); anything else (a throw, a timeout, a 5xx, an
     unlisted code) is «sin confirmar» and STOPS the run. After a `knownFailure` the save re-reads
     that service: equal to its target (`sameRoleSemantics`, e.g. a twin call wrote it) → «ya
     estaba»; `stale_revision` with the `_rev` unchanged (the write lost to the service lock or a
     transient contention) → «no se guardó, repite la misma llamada»; any other code, or a changed
     `_rev` → «no se guardó» with its reason, «revisa el mes de nuevo». Only contention is ever
     told to repeat, so a persistent refusal (`ambiguous_target`, `integrity_conflict`,
     `invalid_request`) cannot loop. A `knownFailure` on a single service lets the run continue.
     **A `knownFailure` on a group service not yet written marks every unwritten service of that
     group «no se guardó»** (none of them is written) and the run continues with the next group or
     single; if the group already had a written service, item 5 applies.
  5. **A `knownFailure` inside a group after one of its services was written** (typically
     someone saved that service between this call's read and its write — the race no sequential
     save can close — or it was deleted, `not_found`) STOPS the run
     and says, in words, who is now where: «Ana quedó en sábado 7 y domingo 8» or «Ana ya no está en
     ningún servicio del mes», computed from the written targets against the unwritten side's stored
     state. The next step follows item 4's re-read: contention with the `_rev` unchanged → «repite la
     misma llamada» (the repeat finishes the group); otherwise a NEW check of the month. Accepted race, stated in the ADR, tested.
  6. The answer lists every service with its status and the next step. After «sin confirmar» or
     «pendiente», repeat the SAME call: written services answer «ya estaba» and are not re-judged,
     the rest are judged and written, so a group interrupted by an unknown outcome is completed.
  Stated, not built: a «sin confirmar» that did commit answers «ya estaba» on the repeat, so its
  notices are never queued (as on `/admin` after an unknown outcome); and a service someone else
  made equal to its target answers «ya estaba» too, so a move another admin half-made elsewhere can
  be completed by this save (the month check shows a doubled person as a warning).
- **T2.6 Tests.** Route parity: the route's existing PATCH and copy tests unchanged; the same body
  through the commit and the route produces the same notices (outbox rows) for a published service
  and none for a draft. Save: a partial run (one service written, then «sin confirmar»; and one cut off as «pendiente»)
  repeated with the same call writes only the rest and answers «ya estaba» for the written ones,
  their waivers unused; a group interrupted by «sin confirmar» is completed by the repeat; a 409 on
  the second service of a group stops the run and names the person and both services; a 404
  (service deleted) on the second service of a group does the same; a 409 on the
  FIRST service of a group writes nothing of that group and the run goes on; a lock contention
  (`knownFailure` with the `_rev` unchanged) answers «repite la misma llamada» and the repeat
  writes it; a stalled Sanity request (a fake that never answers, at the loaders' level, retries
  off) times out as «sin confirmar» before 45 s and stops the run; an `ambiguous_target` refusal
  is never told «repite»; a re-read equal to the target after a `knownFailure` answers «ya
  estaba»; a failed inline upsert answers «guardado, avisos sin confirmar» and the run goes on; each write's outbox upsert is awaited before the next write
  starts (a fake that records the order), so a call killed after write k has queued the notices
  of writes 1..k; a repeat after a
  partial group write still treats the remaining side as grouped; a save of published services runs
  no layer-2 sweep and still upserts every notice, inline, with its pre-commit `before`; a group of 7
  refused before any write; groups are derived by the server (a client-sent `group` field is
  rejected by the schema); a weekend setlist saved between check and save does not block the save; a special's
  setlist saved between check and save answers «cambió» with that reason;
  a stale service refuses the whole call; a waiver token replayed on
  a later `baseRev` refused; a pair forced from the card accepted whichever member the save's
  finding names; a stored service already breaking a rule can still be edited (baseline); a move
  out of a non-`approved` service refused at check; a C1–C3 addition refused before any write; a
  C4 without a token, with a token for another finding, and after the rule wording changed; a
  `lines` mismatch; a
  `countsForFairness` change on a past CDMX month refused; a non-`approved` service refused; a date in
  `target` different from the stored one refused. Latency: the WHOLE call (first write to the response,
  inline side effects included) is measured on dev with published services and a 6-service group; the start
  cut-off (30 s) and the group cap (6) are lowered before release until the call ends with 15 s to
  spare. Hygiene: no member
  id, rule key or rules revision in any result, and no id or name in any log line
  (`monthToolHygiene.test.ts`); services cross as the role ids `get_service` already returns.

### S3 — create and copy (standard, over existing commits)

- `create_service {date, type, name?, time?, worshipNight?}` (destructive) through
  `roleCreateCommit` with the composer's `countsForFairness` rule and an idempotent
  `creationRequestId` = hash of the call; seats empty.
- `copy_instruments {from, to, lines, waivers?}` (destructive) through T2.1's commit, both
  revisions read fresh; the resulting `to` service is judged by T2.3's judge (the same diff
  judge as a seat edit), its new findings need F5 tokens from `check_service_edits_app`, and its
  side effects run inline as in T2.5 item 4; `lines` names every person the copy seats («domingo 8 nov · Batería: Carlos»), compared as
  in F4, so the permission prompt shows who is seated.

### S4 — the card over a stored month (standard)

- The proposal card gains a «mes guardado» mode: same board, panels and lock; «Guardar» sends the
  change list to the chat (`app.sendMessage`) as «Cargar» does. The check returns the derived
  groups; when one exceeds 6 services the card says so before «Guardar» and offers to send the
  changes in parts (whole groups per part).

## 5. Gates and release

tsc, vitest, eslint (0 errors); no `gcf_v3` change. One merge-range review (S1–S4); preview → dev
alias verified → PR → prod alias. Live proof with Frank: one service changed from the card, one
from the chat, a retry of the same save («ya estaba»), and `/admin` shows the result.

## 6. Out of scope

What `/admin` does that phase 1 still leaves there: moving a service to another date, and editing
legacy services the integrity join marks `bootstrapEligible` (the grid bootstraps their lock on save;
the chat shows them read-only), and adding a new instrument or FOH row (the grid's adders; phase 1
edits existing rows). Deleting services and «Limpiar mes» (phase 2); proposals, songs, Kids (phase 3); rules and members
(phase 4); passwords, photos, login activity (never from the chat).

## 7. Docs in the same delivery

ADR (stored-service edits from the chat: F3, F4, F5), `docs/MCP.md` (the new tools, the permission
prompt), `docs/SECRETS.md` (three new labels on `MCP_OAUTH_SECRET`: the month-scoped token, the waiver
token and the change-set MAC; rotating it mid-save invalidates every pending change set and token,
so the next save answers «revisa de nuevo»), CLAUDE.md + AGENTS.md + project-rules (eight write paths; the editor invariant reworded: a STORED
month's save judges each target as a diff, writes one service at a time, and derives move groups on the server; ADR-0062 guarantee (1)'s
caveat, that a client without MCP Apps support shows app-only tools to the model, repeated for
`check_service_edits_app`'s `force`).
