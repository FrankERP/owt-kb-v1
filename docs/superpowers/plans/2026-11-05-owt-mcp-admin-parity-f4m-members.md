# OWT MCP — admin parity, phase 4, slice M: creating and editing people from the chat (plan)

**Status:** DRAFT for the adversarial plan review (critical tier). Nothing built. Parent:
`2026-11-04-owt-mcp-admin-parity-f4.md` (scope approved by Frank 2026-11-05; D1, D5–D8 there are this
slice's starting decisions and are refined here). Review approval is not authorization to implement;
the build follows the release order in CLAUDE.md.
**Requirement (Frank, 2026-10-21 15:48Z, verbatim):** «Quiero poder hacer todo lo que hago en la
página como admin, pero desde el chat». Phase 4 row: Miembros — «Crear, editar (Tipo, ministerio,
rol), desactivar». Role limit (Frank, 2026-11-05 15:01Z and 15:04Z, verbatim): «Puede dar todos los
roles menos super admin. un admin puede agregar admins, pero no los puede revocar. Solo el super admin
puede revocarlos» and «Sí, solo el super admin puede hacer esto desde el MCP».
**Risk tier: critical**, from the ladder: an auth/ACL boundary (a member's `role`, `ministries`,
`managesMinistries`, `ministryRoles`, `email` and `disabled` decide who signs in and what they may
do), a production server writer, and a two-document transaction (D6: a member and the shared rules).
**Out of this slice:** member and song deletes (slice D), rule edits (slice R), photos, passwords,
login activity, each person's own email preferences.

---

## 1. What changes for Frank

1. «¿Quién está en Jóvenes?» / «Muéstrame a Vale» → `list_members` (the roster, no emails) and
   `get_member {memberId}` (one person, with email).
2. «Ponle a Pau Coro en Tipo y quítale Bajo» → `check_member_changes {memberId, edits}` (read-only)
   answers a before/after of ONLY what changes («Tipo: + Coro», «Instrumentos: − Bajo») plus a
   `token`. Claude shows it and waits for Frank's word; `save_member_changes {memberId, edits,
   token}` with the same values writes exactly that, or refuses («Esta persona cambió desde que la
   revisaste: vuelve a revisarla»).
3. «Cámbiale el alias a Vale por Valeria» → the check also lists the solver rules that name her by
   the old text and shows them renamed (the rules card's sentences); the save writes the person and
   the rules in ONE transaction (D6). The same happens in `/admin`'s editor. `/admin` changes in
   exactly three ways, all in the shared commit: D6's rename, D5's email refusal and D12's
   name/alias refusal.
4. «Da de alta a estas 8 personas de Jóvenes: …» → `check_new_members {members}` answers each
   person as it would be created and refuses an email someone already has or that the batch repeats,
   and a name or alias that another member or another person in the batch already has (D5, D12); `create_members
   {members, token}` creates all of them in one transaction, and a repeated call never makes a
   second copy (D7).
5. «Deshabilita a X» / «Vuelve a habilitar a X» → `set_member_access {memberId, enabled}`, after
   Claude shows who and waits for Frank's word (D9).
6. Refused from the chat, with the reason and «hazlo en la página»: granting or removing
   `super-admin`; lowering an `admin`; removing management someone holds (a Kids
   `managesMinistries` entry, a Jóvenes `admin` level); and, for anyone who HOLDS management (D8's
   one definition: role `admin` or `super-admin`, a non-empty `managesMinistries`, or a Jóvenes
   level `admin`), disabling them or changing their email (D8, D9).

No one is notified by any of this (as in `/admin`). Service views and `/me` refresh
(`revalidateServiceViews`, `revalidatePath("/me")`, as the routes).

## 2. Evidence (`origin/main` ca4a8426)

- **Create.** `POST /api/admin/members` (`app/api/admin/members/route.ts`), super-admin only:
  name + email required; `role ∈ VALID_ROLES`, default `member`; `validateMinistryWrite` for
  `ministries`/`managesMinistries` (an explicit `[]` refused; absent = worship); `ministryRoles`
  validated against the SAME request's `ministries` (`validateMinistryRolesWrite`);
  `worshipRoleWithoutWorship` refuses `admin`/`content-editor` without worship;
  `parseMemberInstruments`; `singsAndPlays` boolean; slug from the name; `writeClient.create` with a
  random id. NO email uniqueness check; `memberType` NOT filtered to `MEMBER_TYPES` (PATCH filters). `MembersPanel.handleAdd` always sends `ministries`.
- **Edit.** `PATCH /api/admin/members/[id]`, super-admin only: patches only the fields PRESENT in
  the body, but the form always sends `member_name`, `alias`, `email`, `role` and `memberType`
  (`MembersPanel.tsx` `handleEdit`), so a present field is not a changed one;
  `memberType` filtered to `MEMBER_TYPES`; `ministryRoles` set whole, or `droppedMinistryRolePaths`
  unset when `ministries` drops a leveled ministry; the worship-role rule judged on the RESULTING
  state, and only then the write asserts the read `_rev` (409 «Alguien más cambió a esta persona;
  recarga.»); otherwise last writer wins. The five email toggles (`notifPrefs.*`).
  `revalidateServiceViews()` + `revalidatePath("/me")`.
- **Access.** `PATCH …/[id]/disable`: refuses the operator's own id (token `sanityId` and
  `__realAdmin`), refuses leaving no enabled super-admin, and writes ONE transaction that asserts
  every other enabled super-admin's `_rev` (writing their `disabled` back as observed); one
  conservative retry after a 409. Enabling is a plain revision-asserted set.
- **Sign-in.** `auth.ts` `getMemberByEmail`: `*[_type == "teamMembers" && lower(email) ==
  lower($email)][0]` under the raw perspective (Studio drafts visible) — two documents with one email
  make sign-in pick one arbitrarily. Production 2026-11-05: 0 duplicate emails, 0 members whose name
  or alias equals another member's name or alias, 0 member drafts, 37 members, 2 super-admins, 4 admins, 1 content-editor, 2 with
  `managesMinistries`, 0 with `ministryRoles`.
- **Churn.** A member document's `_rev` moves without anyone editing the person:
  `/api/activity/ping` sets `lastSeen` (≤ once per 30 min per browser session), and `/api/me/*`
  writes theme, push token, availability, preferences. A token bound to `_rev` would refuse most
  saves (unlike a song).
- **Rules name people by text.** `restrictions[].person`, `conflicts[].personA/personB`,
  `presence[].persons[]` are matched by `rulePersonNamesMember` (`member_name` or `alias`, case-
  and space-insensitive, `app/utils/memberRuleNames.ts`). A changed alias silently orphans the rule
  (the 2026-10 Vale incident). CLAUDE.md: no writer sets a rule value except through
  `solverConfigFromDocument` → `parseSolverConfigWrite` → `solverConfigFields` under `ifRevisionId`.
- **Who uses the connector.** `app/api/mcp/route.ts` step 6: the bearer's subject must be an
  existing, enabled `super-admin` (`getMemberAccess`, 30 s cache), so every route's role gate is met.
- **Ids.** All 37 member ids are UUIDs; nothing found that validates their shape, but calendar
  feed URLs and Studio links carry them.

## 3. Decisions, and why

| # | Decision | Rejected alternative | Why |
|---|----------|----------------------|-----|
| D1 | `app/utils/memberCommit.ts` holds `createMembers`, `patchMember`, `setMemberDisabled` (ADR-0043 `CommitOutcome`). The three routes keep `requireActiveManager`, the super-admin check, the JSON parse and the operator ids, and call it with no `opts`. Their existing tests keep every assertion; their read mocks grow for the reads D5, D6 and D12 add, and new tests cover those three changes. Whatever the repository's `*Commit`-importer guards require of a route (as `songSaveCommit` needed `withVerificationRunContext`, `DELIVERY_CAPABLE_IMPORTS`, `protectedReadAudit`) is done the same way. | MCP tools that call the routes over HTTP. | One code path (ADR-0066). The bearer is not a NextAuth session. |
| D2 | Edits by parts, applied by a pure `applyMemberEdits(stored, edits)` to the freshly read person: `set` for `name`, `alias` (`""` clears), `email`, `role`, `singsAndPlays`; `add`/`remove` for `tipo` (only `MEMBER_TYPES`), `instruments`, `ministries`, `managesMinistries`; `jovenes {level, groups}` or `jovenes: null`. The result is the route's own touched-field body, so the writer validates it exactly as `/admin`. | The chat sends whole arrays, as the form does. | A forgotten Tipo or ministry is a removed one; `ministries` is an access field. |
| D3 | **The token binds the rendered change, not `_rev`:** token `${iat}.${mac}`, the HMAC (label `mcp-member-edits|`) over `{memberId, edits, lines, iat}`, `lines` = the before/after of every CHANGED field plus every rule D6 renames; dead after 30 minutes. The save re-reads the person (and the rules when D6 applies), re-applies, re-renders, verifies the token, and writes under `ifRevisionId` of THAT fresh read. The check adds, outside `lines`, «Ojo: hay un borrador de esta persona en Studio; si alguien lo publica, sobrescribe este cambio» when `drafts.<id>` exists. | Bind `_rev` (as songs, ADR-0077). | `lastSeen` and `/me` writes move `_rev` constantly (§2). A concurrent change to a field Frank saw changes its line and refuses; a change elsewhere is untouched by the patch; the fresh `ifRevisionId` closes the read→write window. |
| D4 | Every access verdict (worship-role rule, D8's limits, the leveled-ministry rules) is judged on the fresh read inside the commit and asserted by the same `ifRevisionId`. | Judge at check time. | The check is minutes older than the write. |
| D5 | Email: trimmed, lowercased, one `@`. Refused when any other `teamMembers` document has it case-insensitively — disabled members and other people's Studio drafts included, only the person's own `drafts.<id>` excluded (sign-in reads the raw perspective) — and, on create, when the batch repeats it. Judged only when the email CHANGES (D13). Both surfaces. | No check (today). | Sign-in takes the first match (§2). Not transactional: two concurrent writes of one new email can still both land (named in the ADR). |
| D6 | **A name or alias change renames the rules that name the person** and would stop matching: each rule person text `s` with `rulePersonNamesMember(s, before) && !rulePersonNamesMember(s, after)` becomes `displayMemberName(after)`, unless `s` also names another current member (then it is left and the check says so). One transaction: the member patch and the rules write, each under its own fresh `ifRevisionId`; the rules go through `solverConfigFromDocument` → rename → `parseSolverConfigWrite` → `solverConfigFields`, stamped `updatedAt`/`updatedBy` as the rules POST does. If the renamed rules fail `parseSolverConfigWrite` (e.g. two texts converging into an exact-cap overlap), nothing is written and the answer names the rule. The ADR names that this rewrite goes through the same reader that drops malformed items, as the rules panel's save does. The check warns that a rename changes the rules' revision, so an open month proposal from `solve_month` must be generated again. Both surfaces; `/admin`'s PATCH answers which rules moved, and a 409 on the RULES document answers «Alguien cambió las reglas mientras guardabas; recarga y vuelve a guardar», distinct from the member's 409. | Leave rules naming the old text (today). | The Vale incident. One transaction means no state where the person was renamed and the rules were not. |
| D7 | Create in batches of up to 20 per check. Token `${iat}.${mac}` (label `mcp-member-create|`) over the canonical batch, dead after 30 minutes; person `i`'s id is the first 128 bits of `HMAC(key, "mcp-member-id|" + token + "|" + i)` written in UUID form. `create_members` reads those ids first: ALL present → «ya estaban», nothing written; NONE present → re-runs D5 and D12 on the fresh roster and writes ONE transaction of `createIfNotExists`; SOME present (only possible if someone deleted one in the page meanwhile, since the write is all or nothing) → refused, nothing written, «vuelve a revisar». `ministries` is REQUIRED in the chat (never absent ⇒ worship by accident); `tipo` only `MEMBER_TYPES`. | A random id per person (the route); one call per person. | A retry after an unknown outcome must not make second accounts; one transaction leaves no half-loaded batch. UUID-shaped because every existing id is a UUID. |
| D8 | **The chat grants, never revokes, management** (Frank, Q1). ONE definition, `holdsManagement(m)`: role `admin` or `super-admin`, a non-empty `managesMinistries`, or a Jóvenes level `admin`. `chatAccessRefusal(stored, next)` refuses: a new role `super-admin`; any role change when the stored role is `super-admin`; a stored `admin` whose new role is not `admin`; removing a `managesMinistries` entry; a Jóvenes level dropping from `admin`, or `jovenes` leaving `ministries` while its level is `admin`; and, when `holdsManagement(stored)`, any email change. Granting (new role `content-editor`/`admin`, adding a `managesMinistries` entry, raising a Jóvenes level to `admin`) is allowed. Chat-only (an `opts.chat` flag the routes never pass). | Every role from the chat; protecting only worship admins. | A super-admin is who can use the connector; minting one mints write access to everything, and revoking one can lock Frank out. Changing a manager's email hands that management to whoever owns the new address. Kids and Jóvenes management are management too. |
| D9 | Refined from the parent plan's «behind its own check»: `set_member_access {memberId, enabled}` writes through `setMemberDisabled` after Claude shows who and waits (no token: one reversible field, as S1 D3). Refused from the chat: disabling anyone for whom `holdsManagement` is true (D8); the route's own refusals hold, the operator being the bearer's member (`principalOf(ctx)`) for «self». Frank is told of this refinement with the slice. | A check/save token pair. | A token adds nothing for one boolean the answer names; enabling again undoes it. |
| D10 | Reads: `list_members {ministry?, includeDisabled?}` (id, name, alias, Tipo, instruments, «Canta y toca», ministries, Jóvenes level/groups, Kids management, role, disabled; NO email) and `get_member {memberId}` (the same plus email). | Emails in the list. | Frank asked for parity, not a mailing list in the conversation. |
| D11 | No email-preference fields, no `notifEmail`, no photo, no password from the chat. | Parity on every field. | Each person owns their preferences at `/me`; the rest were excluded in the inventory. |
| D12 | **A name or alias may not equal another member's name or alias** (case- and space-insensitive, as `rulePersonNamesMember`): judged on a rename, on create against the roster AND the rest of the batch, both surfaces. On create, the check also says when a new name or alias equals a rule text that names nobody today («la regla "…" empezaría a aplicarle»). | Allow duplicates (today). | A rule text that names two people resolves to whichever comes first (`resolveToMemberName`); a new person silently inheriting an orphaned rule is the Vale incident in reverse. Production has 0 such collisions today (§2). |
| D13 | **A present field is not a changed field.** D5, D6, D12 and D8 trigger only when the normalized new value differs from the fresh stored one (email: trimmed+lowercased; name/alias: trimmed, compared as `rulePersonNamesMember` compares), as the PATCH already does for the worship-role rule. | Trigger on presence. | The form always re-sends name, alias, email and role (§2): a presence trigger would lock every `/admin` save of a person with a legacy collision. |

## 4. Tasks

1. **Extract** `memberCommit.ts` from the three routes, behaviour byte-identical (D1); pin it in
   `serviceCommitCallers.test.ts` and the protected-write audit; the routes' existing assertions pass.
2. **D5, D6, D12, D13 in the commit** for both surfaces, with tests: duplicate email refused (case,
   disabled member, another person's draft; own draft ignored; repeated in a batch); rename moves
   exactly the rules that would stop matching (restriction, conflict A/B, presence), an ambiguous
   text is left and reported, the rules write goes through the parse pipeline under `ifRevisionId`
   with `updatedAt`/`updatedBy`, a parse failure writes nothing, a 409 on either document writes
   neither (and `/admin` names which); a duplicate name/alias refused on rename, on create against
   the roster and within the batch; an orphaned rule text matching a new name is reported; a form
   save that re-sends unchanged name, alias and email triggers none of these; no solverConfig
   document → member only.
3. **Pure** `applyMemberEdits` + `memberChangeLines` (Spanish, the form's labels; `MEMBER_TYPE_LABEL`,
   `ruleCopy.ts` for rules), `holdsManagement` and `chatAccessRefusal(stored, next)`, each with
   tests (every D8 refusal and every D8 grant, for a worship admin, a Kids manager and a Jóvenes
   admin; a no-op edit gives no line).
4. **Tokens** `app/mcp/members/peopleTokens.ts` on `memberTokenKey` (`app/mcp/monthProposals/memberTokens.ts`, `MCP_OAUTH_SECRET`), canonical
   JSON, `sameMac`; tests: binding, label separation, age, malformed, UUID shape and stability.
5. **Tools** `app/mcp/tools/members.ts`: `list_members`, `get_member`, `check_member_changes`,
   `save_member_changes`, `check_new_members`, `create_members`, `set_member_access`; registered in
   `registerAllTools`; strict zod; reads `{readOnlyHint: true}`, writes destructive. Tests per
   refusal: not found, draft id, stale line («cambió»), bad token, expired, D8 rows, a 409, an
   unknown commit failure answered as an unknown outcome («no sé si se guardó»), a retried create
   (all present, none present, some present), a disable refused for each kind of manager.
6. **Smoke and digest:** `scripts/mcp-dev-smoke.mjs`, `mcpDevSmoke.test.ts`, `mcpRoute.test.ts`
   (tool count 45 → 52).
7. **Docs:** ADR (number at merge) «People are edited from the chat by parts; the chat grants but
   never revokes management»; `docs/MCP.md`; CLAUDE.md / AGENTS.md / `project-rules.md` write-path
   line; `docs/UTILITIES_AND_COMPONENTS.md`; `docs/SECRETS.md` (a sixth use of `MCP_OAUTH_SECRET`).

## 5. Release and proof

Gates → one merge-range review → preview, dev alias → PR to main, `gates` → prod alias. Live proof
with Frank, throwaway data only: create «Prueba MCP» (worship, Tipo voz) from the chat; add a test
rule naming it in `/admin`; change its alias from the chat and see the rule follow; make it admin;
see the chat refuse to lower it; disable it in the page; delete it in the page; remove the test
rule.

## 6. Out of scope

Deletes (slice D). Rule edits (slice R; D6 only renames). Re-keying rules by member id. Admins who
are not super-admin editing people (Frank, 2026-11-05: only the super-admin, from the MCP). Kids
volunteers (`/api/kids/*`, paused).
