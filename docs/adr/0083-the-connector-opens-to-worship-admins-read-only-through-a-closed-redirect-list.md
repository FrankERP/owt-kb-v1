# ADR-0083: The connector opens to any agent through a closed redirect list, and to worship admins as in the page

**Date:** 2026-11-05 · **Status:** Accepted, amended 2026-11-09 by its addendum: worship admins write as in the page

> **Title.** The first slice opened the connector to worship admins read-only; the addendum below
> gives them the page's worship writes. The filename keeps the first slice's wording so links hold.

> **Numbering.** 0083 because records are numbered in the order they reach `main` (0082 is the last
> there); `preview`'s solver-ops record moves from 0083 to 0084 when this one merges there, as it
> moved from 0082 when ADR-0082 did.

## Context

Frank, 2026-11-05: «Sí me gustaría que nuestro server de MCP sea compatible con cualquier agente de
IA que se pueda conectar, siempre y cuando esté autenticado (conectado) con la cuenta de un admin»
(his example: Mkz connecting ChatGPT). Then, on a decision card: «Leer y algunas escrituras». This
record covers the first slice: any agent can connect, and a worship admin gets a read tier. Admin
writes (`edit_setlist` and the service-message tools) are a later slice with their own plan.

Plan (critical tier, two fresh approvals on the same bytes):
`docs/superpowers/plans/2026-11-05-owt-mcp-any-agent.md`, review log beside it.

Before this change, four gates (the consent page, the code-minting POST, both token grants,
`/api/mcp`) admitted only a live super-admin. Production allowed one redirect URI, claude.ai's. Every
token reached the same 52 tools. Five of those tools are app-only (`check_proposal_edits`,
`save_proposal_edits`, `check_service_edits_app`, `save_service_edits_app`, `delete_services_app`).
They mint waivers, force seats and save after the card's own confirmation. ADR-0062, ADR-0066 and
ADR-0072 rest their «the model cannot force» guarantee on the HOST hiding those tools from the model.
claude.ai hides them. Another agent may not.

## Decision

- **Tier from the live role, never stored** (`app/mcp/oauth/tier.ts`, `mcpTierOf`):
  - `"full"`: an active super-admin.
  - `"read"`: an active `admin` whose ministries include worship. This is the same audience as the
    in-app assistant (`canUseAdminChat`, ADR-0060), and a test pins the two equal.
  - `null`: everyone else, refused.

  All four gates use `mcpTierOf(access) !== null`. `/api/mcp` derives the tier on every request
  (30 s member cache), so a promotion or demotion bites without a new grant. The tier is not in the
  grant, the code or the token.
- **What a tier reaches is an allowlist.** `READ_TIER_TOOLS` (`app/mcp/toolList.ts`) is ping plus
  ten reads. Kids, people, conversation reads, every write, the card and its app-only tools are
  not in it. A tool added later lands only in the full lists unless someone adds it here on purpose.
- **Three handlers, one tool list each** (`app/api/mcp/route.ts`):
  - `full`: a super-admin on a claude.ai grant. Exactly the list before this change, with the
    same digest; a test pins it against the base.
  - `fullNoApps`: a super-admin on any other agent. The same list without the five app-only tools
    and without the card resources.
  - `read`: a worship admin on any agent. `READ_TIER_TOOLS` only.

  Each handler has its own `toolsVersion` digest (`TOOL_LIST_VERSIONS`). Only `full` advertises
  `resources`. All three keep `listChanged: false` and `maxSubscriptions: 0`. A tool missing from a
  handler is an unknown tool to the SDK (`Tool <name> not found`), so no write module runs.
- **The grant records which agent it belongs to** (`client`: `"claude"` | `"chatgpt"` |
  `"loopback"`).
  - It is set once, at the code exchange, from `redirectTargetKind(code's redirect URI)`. A
    refresh never changes it.
  - The store projects it, and a test pins the projection (`GRANT_READ_FIELDS`) to the parser.
  - An unknown value means the grant is malformed, so it reads as revoked.
  - An ABSENT value reads as `"claude"` only for a production grant created before
    `LEGACY_GRANT_CUTOFF`, because production allowed only claude.ai until this release. Every
    other absent case reads as `"loopback"` (`effectiveGrantClient`). So a projection that ever
    drops the field costs a reconnect, never app tools on another host.
- **A closed redirect list** (`app/mcp/oauth/redirects.ts`), the same on production, preview and
  local:
  - claude.ai's callback, exactly.
  - ChatGPT's stable `https://chatgpt.com/connector_platform_oauth_redirect`, exactly. OpenAI uses
    it for an authorization server with RFC 9207 issuer identification, which this one has.
  - An RFC 8252 loopback URI, now also on production, with an optional port. `localhost` is kept
    beside `127.0.0.1` on purpose: either way the code reaches the browser's own machine, and
    clients register it.

  `redirectTargetKind` is the only source of the consent screen's «Se conecta a» and of the grant's
  `client`.
- **Real clients register.**
  - Registration signs the allowed SUBSET of the requested URIs (RFC 7591 §3.2.1) and refuses only
    when that subset is empty. VS Code sends four URIs in one request, two of them off-list.
  - A loopback redirect may differ from a registered one in the port only (RFC 8252 §7.3,
    `matchRegisteredRedirect`), at both authorize and token.
  - The code's own binding (`checkCodeBinding`) stays exact.
  - Every register refusal logs one fixed reason line, never the body.
- **Consent says what is being granted.** «Se conecta a» (the verified target) and «Podrá» (the
  tier, `consentCopy.ts`), and the warning «Aprueba solo si tú acabas de pedir esta conexión desde tu
  agente de IA.»

## Rejected

- **Any `https` redirect URI.** Registration is open (ADR-0039). Anyone could register
  `https://evil.example/cb` and send an admin the authorize link. One careless «Permitir» hands the
  code to a stranger, who redeems it with their own PKCE verifier. With more people able to approve,
  the consent screen alone is too thin a barrier.
- **Registering every tool and refusing writes inside each handler for the read tier.** One
  forgotten refusal in about 25 tool files leaks a write. The model would also see tools it cannot
  use. ChatGPT treats a tool without `readOnlyHint` as a write and asks for confirmation. An
  allowlisted list cannot leak, and a test checks it.
- **App-only tools for every super-admin grant.** Their safety is the host hiding them. A host that
  shows them lets a prompt-injected note mint a waiver and force a save with no card in between.
- **Storing the tier in the grant or token.** A demotion would not bite until the grant was revoked.
  Frank's existing grant would also need a migration.
- **The per-connection ChatGPT URI** (`https://chatgpt.com/connector/oauth/{id}`), custom schemes
  (`cursor://`), `https://vscode.dev/redirect` (a forwarder whose final target comes from the
  request), and CIMD (ADR-0039 keeps stateless DCR, and ChatGPT falls back to DCR).

## Consequences

- **Residual risks, accepted:**
  - An attacker with their OWN ChatGPT or Claude account can start a flow and send the link to an
    admin. If the admin presses «Permitir», the attacker's account gets that admin's tier. This is
    the same as for claude.ai before. The mitigations are the consent wording, the verified target
    label, a read-only tier for admins, and revocation (`scripts/revoke-mcp-grant.mjs`, ≤ 30 s).
  - With loopback on any port and path, a local service on the admin's machine that publishes
    request URLs could leak a code. That code lives 60 s and still needs the PKCE verifier.
  - A per-grant email notice and a per-grant rate limit are named follow-ups.
- **Human gates depend on the host.** ADR-0072's «the Claude app's permission prompt is the human
  gate» for a model-visible destructive tool holds only on Claude. On another host, the gate is
  whatever that host does. Never «always allow» or auto-approve destructive tools in a local agent.
- **Data leaves to the agent's provider.** Whatever a connected admin's agent reads (names, seats,
  free-text unavailability notes) goes to that agent's provider (OpenAI for ChatGPT).
- **ChatGPT is unproven until the production live proof.** Dev sits behind Deployment Protection,
  which ChatGPT cannot pass.
- **Undoing it.** Revert the PR. Before that, revoke every grant whose EFFECTIVE client is not
  `"claude"` (a pre-cutoff production grant without `client` is Claude's and is kept). Those
  revocations are production writes: dry run first, then Frank's explicit consent. Old code ignores
  the `client` field.
- **A Claude grant made after the cutoff by old code** (for example, after a revert and a re-release)
  reads as `"loopback"` and loses the card. The fix is to reconnect the connector.
- **The smoke** (`scripts/mcp-dev-smoke.mjs`) uses a loopback grant, so `--expect-tier full`
  expects the no-apps list. `--expect-tier read` sends one boundary probe: `edit_setlist` with `{}`,
  which its schema refuses on any tier. That probe is the only exception to «the smoke never calls a
  write», in both of its guards.

## Addendum — worship admins write as in the page, 2026-11-09

Frank, 2026-11-05 (decision card): «Todo como en la página» — every worship write an admin already
does in `/admin`, through the same writers. People and Oasis Kids stay super-admin only («Personas
sigue siendo solo tuyo»; 2026-11-09: «kids ahorita no juega»). Admins may set the «Mensaje del
pastor». Plan (critical tier): `docs/superpowers/plans/2026-11-05-owt-mcp-admin-writes.md`, review
log beside it. This is the slice the record above announced, so it is an addendum, not a new record.

- **The tier is renamed** `"read"` → `"admin"` (`McpTier = "full" | "admin"`, same predicate, same
  `canUseAdminChat` parity test). `extra.tier` carries `"admin"`. Nothing stores a tier.
- **Five scopes, five handlers** (`ToolListScope`), chosen per request in `/api/mcp`:

  | live tier | grant | scope |
  |---|---|---|
  | `full` | client `claude` | `full` |
  | `full` | any other client | `fullNoApps` |
  | `admin` | `adminScopeOf(grant) === "adminRead"` | `adminRead` (= slice A's read list, same digest) |
  | `admin` | after the cutoff, client `claude` | `admin` (40 tools, card and resources) |
  | `admin` | after the cutoff, any other client | `adminNoApps` (35 tools) |

- **One classification, total.** `SUPER_ADMIN_ONLY_TOOLS` (5 Kids + 7 people) and
  `ADMIN_TIER_TOOLS` (every other tool, written out by name) are literal lists in
  `app/mcp/toolList.ts`; a test fails until every tool of the full list is in exactly one of them.
  Admin registrations go through `allowlistedServer`, so a tool added to a shared bundle later
  reaches no admin until its name is added on purpose. The handlers still do not refuse by tier
  (the rejection above stands).
- **Every admin write is the page's write.** Each tool calls the same `*Commit.ts` writer as its
  `/admin` route, with the same rules, refusals and notifications; no writer changed. The card's
  forcing is available to an admin on a claude.ai grant, as in the page; on other hosts nobody can
  force. The writer's per-person rules hold for everyone (only one's own conversation messages).
- **The member read binds `all` as the page does** (ADR-0075's isolation at the query, not by
  downstream filters). `adminMembersQuery(true)` turns the worship filter off. The members GET binds
  it from the live role; the connector now binds it from the live tier through
  `readsAllMembers(ctx)` (`"full"` → every ministry; `"admin"`, absent or unknown → worship only).
  `loadV3PlanSources({ allMembers })` takes it as a required parameter (the month tools pass their
  principal's), and `get_solver_rules` binds it the same way. The availability sweep, which has no
  MCP caller, is pinned to `{ allMembers: true }`, unchanged. Consequence: an admin's service edits
  no longer find a seated member of another ministry by NAME; tokens and stored seats are
  unaffected, and the page behaves the same.
- **Connections approved under «Solo leer … No podrá cambiar nada» keep that list.** A worship
  admin's grant reaches the admin list only when its `createdAt` (set once, at the code exchange)
  parses and is at or after `ADMIN_WRITES_CUTOFF` (`adminScopeOf`, fail closed). The cutoff is the
  planned merge time plus one hour. **Any re-release after a revert, a Vercel rollback or a failed
  post-merge build that needs a fix-forward resets it** to just after the re-release; after a
  rollback the slice-B deployment is never re-promoted (it carries the old cutoff). The residual
  window [cutoff, max(cutoff, ready) + 1 h] is checked once it has closed, across every origin;
  a developer's local server still running older code could mint a local grant under the read-only
  wording later (only super-admins run the app locally today).
- **Every model-visible write asks the person first.** `PERSON_CONFIRMS_RULE`
  (`app/mcp/writes/confirmRule.ts`) is appended at registration to every tool with
  `destructiveHint: true` that the model sees; app-only twins are exempt (the card confirms). The
  only model-visible tools with neither `readOnlyHint` nor the rule are `solve_month` and
  `revise_proposal` (each only creates a proposal nobody is told of). `edit_setlist` no longer says
  «sin confirmación». This moved the `full` and `fullNoApps` digests once (one refresh note each in
  Frank's Claude and ChatGPT).
- **Tokens restated.** ADR-0072's delete tokens and the saved-month editor's waiver tokens
  (`serviceEditor.ts`) are bound to the services' `_rev`s and the findings, not to a principal. A
  worship admin now reaches those tools too; the conclusion holds, because any principal who reaches
  the save can mint their own token with the check, so binding it to a principal would add nothing.
- **The smoke** (`scripts/mcp-dev-smoke.mjs`): `--expect-tier admin` expects the `adminNoApps`
  list (`read` is refused with a pointer to `admin`). The boundary probe moved from `edit_setlist`
  to `set_member_access` with `{}`: a super-admin-only people write whose strict schema refuses `{}`
  before any handler code, so on a wrong tier it is a schema refusal, never a write and never a read
  of people data. It is still the only exception to «the smoke never calls a write», in both guards.
- **Consent** (`TIER_CONSENT_TEXT.admin`) says what is handed over: the page's worship work, that
  changes notify the team as in the page, that the agent sees names, availability and notes, and
  that it cannot manage people or Oasis Kids.

### Risks, restated (Frank: «ok», 2026-11-09 22:19Z)

- **Everything an admin can break in the page, a misled agent can now break from a chat**:
  publish (first notices to the whole service), replace setlists and seats, generate and apply a
  month, delete future services (only with the check's echoed list and token, never a past one),
  edit songs, approve a proposal. Defences: the rule above, the host's prompt, each tool's own
  tokens and `_rev` checks, and each writer's refusals. **Never «always allow» or auto-approve write
  tools in a local agent** — with that on, the rule is the only gate, for admins as for Frank.
- **A phished admin hands a stranger all of the above.** The «Residual risks, accepted» above leaned
  partly on admins being read-only; that no longer holds. Remaining: the consent names the agent and
  the redirect, the closed redirect list, revocation (≤ 30 s).
- **Notification and compute loops have no limit, as in the page.** A looping agent can repeat a
  notifying write (free Gmail, ~500 recipients a day for the whole app) or `solve_month`. Named
  follow-ups: a per-person cap on notifying writes from the MCP, and an email to Frank on every new
  grant.

### Rollback

Reverting the PR removes admin writes on the next request after the deploy (tier and scope are
live) and moves the digests again. A Vercel Instant Rollback does the same without a commit; the
slice-B deployment is then never re-promoted. A later re-release is a new commit with a new
`ADMIN_WRITES_CUTOFF` and a new window check. `MCP_DISABLED` is the emergency stop; one admin's
access ends by revoking the grant or changing the role (≤ 30 s).
