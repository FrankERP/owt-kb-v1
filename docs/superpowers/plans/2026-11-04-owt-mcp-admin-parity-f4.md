# OWT MCP — admin parity, phase 4: rules, members and deletes from the chat (scope plan)

**Status:** SCOPE APPROVED by Frank 2026-11-05 15:01Z (Q1 below; Q2 taken as recommended: M first).
Nothing built. Each slice below owns a
critical contract, so each gets its own slice plan and the adversarial plan review
(`.agents/skills/adversarial-plan-review/`) after Frank approves the scope, as phase 3 did.
Frank's summary (Spanish): a Claude Doc linked from the thread «MCP de la página».
**Requirement (Frank, 2026-10-21 15:48Z, verbatim):** «Quiero poder hacer todo lo que hago en la
página como admin, pero desde el chat». Phase 4 of the Claude Doc «Todo el admin desde el chat»
(https://claude.ai/artifact/LhYG6BgY7GRio3sUXmSg9H): «Cambiar reglas y grupos del solver, crear y
editar miembros, borrar canciones y miembros». Excluded there, and still excluded: passwords,
photos, login activity.
**Builds on:** ADR-0066 (the chat writes through `/admin`'s own writer, check then save), ADR-0072
(a delete repeats the exact list the check showed), ADR-0077 (edits by parts, a token over the
rendered before/after, `ifRevisionId`, a token-keyed create).

---

## 1. What Frank gets

1. **Rules (slice R).** «Agrégale a Gaby mínimo 3 domingos al mes», «Quita a Mkz de Líder
   Sábado», «Pau y Tony no juntos en domingo». Claude shows the rule as the rules card words it
   (`ruleCopy.ts`), before and after, and saves only on Frank's word. It changes the rules for the
   NEXT month generated; saved months do not move.
2. **Members (slice M).** Create a person (one or several at once), edit name, alias, email, Tipo,
   instruments, «Canta y toca a la vez», ministries and Jóvenes level, role, and disable or
   re-enable access. Claude shows the before/after of only what changes.
3. **Deletes (slice D).** Delete a song or a person that nothing uses yet (a duplicate, a
   mistake). For anything with history Claude says where it is used and offers what `/admin`
   offers instead (for a person: disable access, or remove the Tipo).

`/admin` keeps working as today, except the fixes named in §3 (D6, D9, D10), which apply to both
surfaces because both call the same module.

## 2. Evidence (today, `origin/main` 57bdf591)

- **Rules.** `POST /api/admin/solver-config` (203 lines, not a commit module): `{rev, config,
  configVersion}`, the version must equal `SOLVER_CONFIG_VERSION` (2), `parseSolverConfigWrite`
  validates and mints `_key = id`, the write is a whole-document `set` under `ifRevisionId`, only
  a real Content Lake 409 is `stale_revision`. It never creates the document. No revalidation (no
  ISR surface). `SolverConfig` = three pools of member ids (`sundayLeads`, `saturdayLeads`,
  `support`) + `restrictions` (per person: excluded patterns, fairness, week exclusions, caps,
  «Mes por medio») + `conflicts` + `presence`. Rules name people by display TEXT
  (`rulePersonNamesMember`), which is how Vale's rule broke when her alias changed. The chat
  already reads them (`get_solver_rules`).
- **Members.** `POST /api/admin/members` (create, super-admin): no email uniqueness check, a
  random id. `PATCH /api/admin/members/[id]`: touched fields only, `ifRevisionId` ONLY when role or
  ministries change (otherwise last writer wins), `revalidateServiceViews` + `/me`.
  `PATCH …/[id]/disable`: refuses the operator's own account and the last enabled super-admin, one
  transaction asserting every other super-admin's revision. `/super-admin` (on preview, PR #216)
  hosts the same `MembersPanel`; the routes are unchanged there.
- **Deletes.** `DELETE /api/content/posts/[id]` (admin/super-admin) and
  `DELETE /api/admin/members/[id]` (super-admin) call `writeClient.delete`. Content Lake refuses a
  document that is referenced. Production 2026-11-04: 142 of 147 songs and 34 of 37 members are
  referenced (setlists, proposals, specials, records), so a delete only ever succeeds on something
  new. The song route answers a referenced song with an unhandled 500 («Error al eliminar.»). The
  member route then cleans the pools in a SECOND write, so a failure leaves «deleted, pools stale»
  (`MEMBER_POOL_CLEANUP_FAILED_MESSAGE`). A song's rehearsal mixes and PDFs are files on the song;
  deleting it leaves the files unreachable.
- **Who.** The connector is super-admin only, so every route's role gate is met.

## 3. Decisions, and why

| # | Decision | Rejected alternative | Why |
|---|----------|----------------------|-----|
| D1 | Three commit modules: `solverConfigCommit`, `memberCommit` (create, patch, disable, delete), and the song delete in `songSaveCommit`. The routes call them. | Tools that call the routes over HTTP. | ADR-0043/0066: one code path. The bearer is not a NextAuth session. |
| D2 | Rules are edited by parts: add, change or remove ONE rule, add or remove a name in a pool, applied to the freshly read config and written through `parseSolverConfigWrite` under `ifRevisionId`. | The chat sends the whole `SolverConfig`, as the panel does. | The whole-document set is how a forgotten rule disappears. Same reason ADR-0077 rejected whole arrays. |
| D3 | Check then save, bound by a token over `{rev, edits, lines}` (`lines` = the rules card's sentences before/after). | `rev` alone. | Same as ADR-0077: Frank compares sentences, not JSON, and the token makes the edits he saw the only ones that save. |
| D4 | A rule's person must name exactly ONE current member (by name or alias); otherwise the check refuses and lists the close names. | Accept free text, as the panel does. | Free text is how Vale's rule silently stopped applying. The chat cannot pick from a dropdown, so it must match. |
| D5 | Members: check then save, token over `{memberId, rev, changes, lines}`, written under `ifRevisionId` always. | The route's «guard only role/ministries». | Two admins (or a member's own `/me` save) editing at once must not overwrite each other from the chat. |
| D6 | **An alias or name change renames that person's rules in the same transaction** (member patch + rules patch, both revision-asserted), and the check shows which rules move. Applies to `/admin` too. | Leave the rules naming the old text (today). | The 2026-10 Vale incident. One transaction means no state where the person was renamed and the rules were not. |
| D7 | Create: a token-keyed id (`teamMembers-mcp-` + hex of the token, as ADR-0077), `createIfNotExists`, and an email that already belongs to someone is refused. Several people in one check. | A random id, no email check (the route). | A retry must not make a second account, and two accounts for one Google email is ambiguous at sign-in. Several at once serves the Jóvenes account load. |
| D8 | Role (Frank, Q1, 2026-11-05): the chat GRANTS `member`, `content-editor` or `admin`, never `super-admin`, and never REVOKES an admin or a super-admin («un admin puede agregar admins, pero no los puede revocar; solo el super admin puede revocarlos»; «solo el super admin puede hacer esto desde el MCP»). Revoking stays in the page. | Every role from the chat. | A super-admin is who can use this connector. A chat that can mint one can mint write access to everything; removing one can lock Frank out. |
| D9 | Deletes repeat the exact list the check showed (ADR-0072) and delete only what nothing references; the check names each reference by service date or proposal. A referenced song answers a clear refusal on `/admin` too (today an unhandled 500). | Delete and let Content Lake refuse. | Frank sees where a song or person is used before anything is tried. |
| D10 | A member delete and its pool cleanup are ONE transaction (both surfaces). Rules that name the person are listed by the check and removed only on Frank's word, through slice R. | Today's two writes. | No «deleted, pools stale» state. Rules are Frank's call, not a side effect. |
| D11 | Notification preferences, photos, passwords and login activity stay out. | Parity on every field. | Each person owns their own preferences at `/me`; the others were excluded in the inventory. |

## 4. Slices and order

Each slice is its own slice plan + adversarial review, PR, preview, prod and live proof.
Recommended order (Q2): **M → R → D**.

- **M (members).** `memberCommit.ts`; tools `get_members` (read: the roster with Tipo, ministries,
  role, disabled; emails only on `{memberId}`), `check_member_changes` / `save_member_changes`,
  `check_new_members` / `create_members`, `set_member_access` (disable/enable, behind its own
  check). Pins: `serviceCommitCallers`, protected-write audit, tool digest.
- **R (rules).** `solverConfigCommit.ts`; pure `applyRuleEdits(config, edits, roster)`; tools
  `check_rule_edits` / `save_rule_edits`. D6 lands here if R ships before M, else in M.
- **D (deletes).** `check_deletes {songs?, members?}` / `apply_deletes` (echoed list + token).

## 5. Questions for Frank

- **Q1. Roles from the chat:** Frank 2026-11-05: every role except super-admin; an admin is
  granted from the chat but never revoked there (D8). The connector stays super-admin only.
- **Q2. Order:** not answered; taken as recommended (M → R → D), Frank told so 2026-11-05.

## 6. Release and proof

Per slice: gates → one merge-range review → preview, dev alias → PR to main, `gates` → prod alias.
Live proof with throwaway data only: a test person created, edited (alias with a test rule
following it), disabled, re-enabled and deleted; a test rule added, changed and removed; a test
song created from the chat and deleted.

## 7. Docs in the same delivery

`docs/MCP.md` (tools, count), one ADR per slice (numbered at merge), CLAUDE.md / AGENTS.md /
`project-rules.md` (the write-path list), `docs/UTILITIES_AND_COMPONENTS.md`.

## 8. Out of scope

Re-keying rules by member id (a data migration; D4 and D6 make text names safe enough for now).
Tags (Studio). Kids (paused by Frank). Deleting anything referenced.
