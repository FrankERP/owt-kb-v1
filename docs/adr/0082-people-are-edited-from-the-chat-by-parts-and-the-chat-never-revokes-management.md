# ADR-0082: People are edited from the chat by parts; the chat grants but never revokes management

**Date:** 2026-11-05 · **Status:** Accepted

> **Numbering.** 0082 because records are numbered in the order they reach `main`; `preview`'s
> solver-ops record moves to 0083 when this one merges there.

## Context

Phase 4 of Frank's «Quiero poder hacer todo lo que hago en la página como admin, pero desde el chat»,
slice M (plan approved under the critical tier after six rounds, 2026-11-05:
`docs/superpowers/plans/2026-11-05-owt-mcp-admin-parity-f4m-members.md`, review log beside it).
`/super-admin` → Personas creates a person (`POST /api/admin/members`), edits one (`PATCH …/[id]`) and
disables or re-enables access (`PATCH …/[id]/disable`); every member edits their own alias and email
at `/me` (`PATCH /api/me`). Four facts shaped the decision:

- A person's `role`, `ministries`, `managesMinistries`, `ministryRoles`, `email` and `disabled` decide
  who signs in and what they may do. The connector is super-admin only, so a chat that could mint or
  restore a super-admin could mint write access to everything, and one that could remove a manager
  could lock Frank out.
- Sign-in (`auth.ts`) takes the FIRST `teamMembers` document with the email, drafts included, and
  nothing refused a second document with the same email.
- Solver rules name people by display TEXT. A changed alias silently orphaned Vale's rule in 2026-10;
  a rule text that names two people resolves to whichever comes first. `/me` let any member rename
  themselves with no check at all, which is plausibly the most common way an alias changes.
- A member document's `_rev` moves without anyone editing the person (`lastSeen` pings, `/me/*`
  writes), so a chat token bound to `_rev`, as songs do (ADR-0077), would refuse most saves.

## Decision

- **One writer.** The three routes' and `/me`'s bodies moved into `app/utils/memberCommit.ts`
  (ADR-0043's `CommitOutcome`): `createMember`, `patchMember`, `setMemberDisabled`, `patchOwnProfile`,
  and the chat's `checkMemberEdits` / `saveMemberEdits` / `planNewMembers` / `createMembers`. The routes
  keep their session checks and JSON parse; their existing assertions pass (one test changed on
  purpose: an alias PATCH now reads and pins the person). Every PATCH reads the person type-pinned first, so an id
  that is not a `teamMembers` answers 404 (W9, ADR-0081); only a change judged against the stored
  person pins the write to that read.
- **Every surface gained three refusals, judged only on CHANGE** (a present field is not a changed
  one; the form re-sends name, alias and email on every save), plus `/me`'s email-format check
  (`MEMBER_EMAIL_RE`) now on `/admin`'s create and edit too (§7.2: `x@localhost`, which the form's
  `type=email` accepted, is a 400). Names and aliases are stored NFC, as the rules reader reads them. The three:
  - an email any other `teamMembers` document has, case-insensitively, drafts and disabled people
    included (only the person's own `drafts.<id>` excluded);
  - a name or alias equal to another member's name or alias (trimmed, case-insensitive);
  - a name or alias change **renames the solver rules that would stop naming the person, in ONE
    transaction with the person**, each document under its own `ifRevisionId`. The rules are written by
    a TARGETED `set` of exactly the renamed person paths (`restrictions[_key=="k"].person`,
    `conflicts[_key=="k"].personA/personB`, one presence item's `persons`), each only where the raw
    stored value is exactly the text the reader reads, plus `updatedAt`/`updatedBy`
    (`app/utils/memberRuleRename.ts`). Nothing else of the rules document is read back and rewritten,
    so a value or field this bundle does not know survives. The renamed rules are parsed in memory
    only to refuse a NEW issue (two exact caps converging). A text that also names someone else is
    left and reported; a new name equal to a rule text that names nobody is reported («empezaría a
    aplicarle») on /admin and the chat, refused at /me. This is the third targeted rules writer
    CLAUDE.md allows (after the member DELETE's pool patch and the repair script).
- **/me never names anyone else**: «Ese correo ya está en uso», «Ese alias ya lo usa otra persona»,
  «Ese alias no está disponible; elige otro», «No se pudo guardar tu alias; pídele a un administrador
  que lo cambie». A 409 is retried once, re-planned from a fresh read, and only when the member's
  alias and email are still what the first attempt read (a `lastSeen` ping is the usual cause);
  otherwise «Alguien más cambió tu perfil».
- **The chat edits by parts** (`applyMemberEdits`, `app/utils/memberEdits.ts`, pure): set name, alias
  (`""` clears), email, role; `singsAndPlays`; add/remove Tipo, instruments, ministries,
  `managesMinistries`; a Jóvenes level and groups (always sent with `ministries`). Ministries are read
  through `normalizeMinistries` first, so adding Kids to a legacy member keeps worship.
- **Tokens bind the rendered change, not `_rev`** (`app/mcp/members/peopleTokens.ts`):
  `<iat>.<call>.<result>`. `call` binds the person and the edits (or the batch) and is verified first,
  so a retry after a save that landed answers «ya estaba guardado» / «ya estaban»; `result` also binds
  the lines the check showed (field before/after, renamed rules, warnings), re-rendered inside the
  writer from its own fresh read, whose revision the write asserts. Dead after 30 minutes. A create's
  ids are HMACs of its token in UUID form; the batch is one transaction of `createIfNotExists`.
- **The chat grants, never revokes, management** (Frank, 2026-11-05: «Puede dar todos los roles menos
  super admin. un admin puede agregar admins, pero no los puede revocar»). One table,
  `chatAccessRefusal` / `chatAccessToggleRefusal`, judged on the fresh read (on the disable's retry
  too): never grant or change a super-admin, never lower an admin, never remove a management (Kids or
  a Jóvenes admin level), never change the email of anyone who manages or edits content, never
  disable a manager, never enable a super-admin. `content-editor` is outside «manages» (Frank,
  16:11Z): the chat may set, lower or disable one. The routes never apply it.
- **`set_member_access` has no token** (Frank, 16:11Z): one reversible field, after Claude names the
  person and waits for his word.

## Consequences

- `/admin` gains a toast «Miembro actualizado; 2 reglas cambiaron de nombre» and the D12 note.
- Studio edits bypass all three refusals (as every Studio write bypasses the app's checks).
- The email check is not transactional: two concurrent writes of one new email can both land.
- A rename from `/admin` or `/me` moves the rules' revision, so an open `solve_month` proposal must be
  generated again (only the chat's check says so).
- A member can learn at `/me` whether an address belongs to someone on the team; accepted.
- A check's token replayed within its 30 minutes re-applies the same change even if someone reverted
  it meanwhile; accepted, because Frank's word was given for exactly that change.
- Seven tools (52 in all): `list_members`, `get_member`, `check_member_changes`,
  `save_member_changes`, `check_new_members`, `create_members`, `set_member_access`. A sixth use of
  `MCP_OAUTH_SECRET` (`docs/SECRETS.md`).

## Alternatives rejected

- **Tools that call the routes over HTTP**: the bearer is not a NextAuth session; one code path
  (ADR-0066).
- **Bind `_rev`, as songs**: `lastSeen` moves it constantly.
- **Rewrite the rules document through the parse pipeline on a rename**: the lenient reader coerces
  values it does not know, so a people edit could silently change a rule.
- **Every role from the chat**, or protecting only worship admins: Kids and Jóvenes management are
  management too, and two review rounds found paths the per-tool lists missed.

## Addendum — ADR-0083, 2026-11-05

The connector now also admits a worship admin, with a read-only list (`READ_TIER_TOOLS`). None of
this record's people tools is in it: they stay super-admin only, so the reasoning above («the
connector is super-admin only») still holds for every tool this record adds.
