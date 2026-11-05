# Plan: the MCP connector for any AI agent, for any worship admin (read-only below super-admin)

**Date:** 2026-11-05 · **Builds on:** ADR-0039 (stateless DCR), ADR-0060 (the admin assistant's
audience), ADR-0069 (tool-list version), `docs/MCP.md` · **Tier:** critical (auth/security
boundary: who may hold a token, which redirect targets receive codes, which tools a token reaches).

## 1. The requirement (Frank, verbatim, 2026-11-05)

> «Una duda sobre el MCP, está disponible desde el chatbot de la página? Puedo mandarselo a Mkz por
> ejemplo y que lo conecte con su chatGPT?»

and, after being told that opening it is a security decision and that a read-only start for admins
was recommended:

> «Sí me gustaría que nuestro server de MCP sea compatible con cualquier agente de IA que se pueda
> conectar, siempre y cuando esté autenticado (conectado) con la cuenta de un admin»

Read as: (a) an MCP client other than claude.ai (ChatGPT first, local agents too) can complete the
OAuth flow and use the connector; (b) an `admin` (not only `super-admin`) can authorize it with
their own Backstage account. Standing constraints (Frank, 2026-11-05, other thread): writes about
people from the MCP are super-admin only; the coordinator's brief keeps EVERY write tool
super-admin-only unless Frank says otherwise. What an admin may read is Frank's call on a decision
card; this plan is written for the recommended option, «Leer todo lo de Alabanza» (§4), and the
other read-only option is a strict subset (only the `READ_TIER_TOOLS` list in §4 changes).

**Narrowing, stated:** «cualquier agente» becomes «any agent whose redirect target is on a closed
list» (§3) — claude.ai, chatgpt.com and any agent that runs on the user's own computer (RFC 8252
loopback). A hosted agent not on the list (a future web client) is added by a one-line PR. §3 says
why the list is not opened to every `https` URI.

## 2. What exists (premises, with pointers)

- **Four role gates, all `role === "super-admin"` on the LIVE role (`getMemberAccess`, 30 s cache):**
  the consent page (`app/(client)/oauth/authorize/page.tsx`, the `access.role !== "super-admin"`
  branch, plus copy «Sólo un super-admin…», «…conexión con Claude…»); the code-minting POST
  (`app/api/oauth/authorize/route.ts` step 5, `access.role !== "super-admin"` → 403); the token
  route's `subjectStatus` (`app/api/oauth/token/route.ts`, used by both the `authorization_code`
  and the `refresh_token` grants); `/api/mcp` step 6 (`app/api/mcp/route.ts`, `authenticate`).
  Impersonation is refused at consent (page + POST).
- **Redirect allowlist** `isRedirectUriAllowed(uri, origin)` (`app/mcp/oauth/redirects.ts`):
  production → exactly `https://claude.ai/api/mcp/auth_callback`; preview/local → that plus
  `isLoopbackRedirectUri`. Re-checked at registration (`app/api/oauth/register/route.ts`, every
  registered URI must pass or the registration is refused), authorize (`authorizeRequest.ts` rule 2)
  and token (`token/route.ts`, the code's redirect URI). `shouldLogRefusedRedirect` logs a refused
  URI only when its host is claude.ai/claude.com.
- **The AS already meets ChatGPT's published requirements** (developers.openai.com/apps-sdk/build/auth,
  fetched 2026-11-05): PRM at `/.well-known/oauth-protected-resource[/api/mcp]` with
  `authorization_servers`; AS metadata with `issuer`, `code_challenge_methods_supported: ["S256"]`,
  `registration_endpoint`, `token_endpoint_auth_methods_supported: ["none"]`,
  `authorization_response_iss_parameter_supported: true`
  (`app/api/oauth/discovery/authorization-server/route.ts`); every authorize response, errors
  included, carries `iss` (`authorizeRequest.ts`, `authorize/route.ts`); `resource` (RFC 8707) is
  checked against `${origin}/api/mcp` (`resolveResource`, `origin.ts`). ChatGPT: «Both [CIMD and DCR]
  are supported. CIMD is preferred … DCR is used when … CIMD is unavailable»; redirect
  `https://chatgpt.com/connector_platform_oauth_redirect` when the AS supports RFC 9207 issuer
  identification, `https://chatgpt.com/connector/oauth/{callback_id}` otherwise.
- **Tools:** `registerAllTools(server, { version })` (`app/mcp/toolList.ts`) registers 45 tools + the
  card resource for every caller; `TOOL_LIST_VERSION = toolListDigest(...)` over that one list
  (ADR-0069). The route builds ONE `createMcpHandler` at module scope. Reads declare
  `readOnlyHint: true`; writes `readOnlyHint: false, destructiveHint: true` (spec I14).
- **The admin read audience already exists:** `canUseAdminChat` (`app/utils/adminChat.ts`) =
  super-admin, or `admin` whose `ministries` include `worship` — the in-app assistant (ADR-0060)
  already answers those admins from the MCP read handlers (`search_songs`, `get_song`,
  `list_services`, `get_service`). The app counterparts of the other worship reads are open to
  `admin` (`requireActiveManager` on `/api/admin/fairness`, `/api/admin/solver-config`,
  `/api/admin/service-integrity/*`, `/api/admin/proposals`; content-editor refused in those
  handlers).

## 3. Redirect targets (the closed list) — `redirects.ts`

`isRedirectUriAllowed(uri, origin)` becomes, for **every** origin (production, preview, local):

| Target | Rule | Shown on consent as |
|---|---|---|
| claude.ai | exactly `CLAUDE_AI_REDIRECT_URI` (unchanged) | «Claude (claude.ai)» |
| ChatGPT, stable | exactly `https://chatgpt.com/connector_platform_oauth_redirect` | «ChatGPT (chatgpt.com)» |
| ChatGPT, per-connection | `^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]{1,128}$` AND `new URL(uri).href === uri` | «ChatGPT (chatgpt.com)» |
| Local agent | `isLoopbackRedirectUri` (unchanged rule) — **now also in production** | «Un programa en esta computadora (puerto N)» |

A pure `redirectTargetLabel(uri): string | null` beside it returns the label (null ⇔ not allowed);
it is the ONLY source of the consent screen's «Se conecta a» line.

**Why loopback in production is safe** (RFC 8252 §7.3/§8.3): the code is delivered to the browser's
own machine. A remote attacker who registers a loopback client and sends an admin the authorize link
gets nothing — the code lands on the admin's computer, and without it the attacker's PKCE verifier
is useless. It is what Claude Code, Codex CLI, Gemini CLI and VS Code use.

**Why not «any https URI»:** registration is open (ADR-0039), so an open list lets anyone register
`https://evil.example/cb`, start a flow, and send the link to an admin; one careless «Permitir»
delivers the code to the attacker, who redeems it with their own verifier. The consent screen would
be the only barrier, and with more people able to authorize, that is too thin. With a closed list the
code only ever reaches Claude's or OpenAI's callback (which binds it to the session that started the
flow by `state`) or the user's own machine.

**The residual risk, accepted and documented (same as today for claude.ai):** an attacker with their
OWN ChatGPT/Claude account starts a flow and sends the link to an admin; if the admin presses
«Permitir», the attacker's ChatGPT/Claude account gets that admin's tier. Mitigations: the consent
screen says plainly «Aprueba solo si tú acabas de pedir esta conexión desde tu agente» and names the
target by its verified label (not the unverified `client_name`); an admin's tier is read-only (§4);
every grant is revocable (`scripts/revoke-mcp-grant.mjs`, ≤ 30 s). A per-grant email notice is a
named follow-up, not in this plan.

**Not added:** custom schemes (`cursor://…`, any app can claim one), `https://vscode.dev/redirect`
(a forwarder whose final target comes from the request), CIMD (ADR-0039 keeps stateless DCR;
ChatGPT falls back to DCR when `client_id_metadata_document_supported` is absent — it stays absent).

`shouldLogRefusedRedirect` widens to hosts claude.ai, claude.com, chatgpt.com, openai.com and their
subdomains (same R11 printable-ASCII and 2048-char guards), so a moved callback is visible.

## 4. Tiers — who may connect and what they reach

New pure module `app/mcp/oauth/tier.ts`:

```ts
export type McpTier = "full" | "read";
export function mcpTierOf(access: MemberAccess): McpTier | null
//   !access.active                                           → null
//   access.role === "super-admin"                            → "full"
//   access.role === "admin" && access.ministries.includes("worship") → "read"
//   otherwise (content-editor, member, admin without worship) → null
```

`access.ministries` is already normalized by `accessFromDoc` (absent ⇒ worship). The "read" rule is
the same audience as `canUseAdminChat`; a test pins the two predicates equal over the role ×
ministries matrix (they stay separate functions because they gate different features).

**The four gates** (§2) replace `role === "super-admin"` with `mcpTierOf(access) !== null`. Each
keeps its order, its refusal codes and its impersonation check. The tier is **never stored** — not
in the grant, the code or the token. `/api/mcp` derives it from the live role on every request
(step 6), so a demotion or promotion bites within the 30 s member cache, and existing grants (Frank's)
keep working unchanged.

**What a tier reaches** — `app/mcp/toolList.ts`:

- `registerAllTools(server, { version, tier })`. `tier: "full"` registers exactly today's list in
  today's order (45 tools + the card resource).
- `tier: "read"` registers ONLY `READ_TIER_TOOLS`, an explicit exported allowlist:
  `ping`, `get_service`, `list_services`, `search_songs`, `get_song`, `get_member_availability`,
  `get_participation`, `list_proposals`, `get_fairness_ledger`, `get_solver_rules`,
  `get_integrity_queue` (11). No card resource, no app-only tool, no Kids tool, no
  `get_service_messages` (registered inside the messages bundle with its writes; a later PR may
  split it out). A tool added to the connector later lands in "full" only unless someone adds it
  to the allowlist on purpose.
- Two digests: `TOOL_LIST_VERSIONS = { full, read }`. **`full` must equal today's
  `TOOL_LIST_VERSION` byte for byte** (a test pins it against a digest computed with the
  pre-change registration), so Frank's Claude gets no stale-list note from this release.
- `/api/mcp` builds two handlers at module scope (`handlers.full`, `handlers.read`), each with its
  own `versionToolList(server, TOOL_LIST_VERSIONS[tier])`, and dispatches on the tier `authenticate`
  returned. `authInfo.extra` gains `tier`. A write tool's name on the read handler is an unknown tool
  (the SDK's own error); it is never registered there, so no write module runs.

**Why a separate tool list and not «register everything, refuse writes in the handler»:** the model
never sees a tool it can't use (no wasted call, no prompt-injected «call delete_services»); ChatGPT
treats any tool without `readOnlyHint` as a write and asks for confirmation; and a forgotten refusal
in one of 25 tool files cannot leak a write, because the read list is an allowlist checked by a test.

**Why a worship admin reads all of these:** each is something that admin already sees in `/admin`
(§2), and «¿quién puede el 15?» needs availability. Kids and Jóvenes stay out (ministry isolation,
ADR-0075). What leaves the app: whatever the admin's agent asks for goes to that agent's provider
(OpenAI for ChatGPT) — the same data the admin could copy from the screen; Frank is told this
before release.

## 5. Consent screen and copy

- «Sólo un super-admin…» → «Solo los administradores de Alabanza pueden conectar un agente de IA.»
  «…conexión con Claude…» → «…conexión con agentes de IA…» (page, metadata, `ERROR_PAGE_TEXT`
  untouched where not Claude-specific).
- New fact line «Se conecta a»: `redirectTargetLabel(request.redirectUri)` (verified). The exact
  redirect URI and the unverified client name stay shown as today.
- New fact line «Podrá»: "full" → «Todo lo que puedes hacer como super-admin, incluido cambiar
  servicios, setlists y canciones»; "read" → «Solo leer: servicios, canciones, disponibilidad,
  participación, equidad, reglas, propuestas e integridad. No podrá cambiar nada.» (copy in one
  module, `app/mcp/oauth/consentCopy.ts`).
- The warning line: «Aprueba solo si tú acabas de pedir esta conexión desde tu agente.»
- Form controls unchanged (no new inputs). Theme-gallery/inputFontSize guards unaffected.

## 6. Docs

- `docs/MCP.md`: «Adding the connector» splits into Claude / ChatGPT (developer mode; URL
  `https://owt-backstage.vercel.app/api/mcp`, OAuth, leave client id/secret empty so it registers
  itself) / local agents (loopback); a «Tiers» section; the endpoints table's consent rows say
  «a live, non-impersonating super-admin or worship admin»; refusal-logging hosts; status banner.
- New ADR (next free number on BOTH `main` and `preview` at PR time; 0083 today): «The connector
  opens to worship admins read-only, and to agents through a closed redirect list», with the
  rejected alternatives (open https list, refuse-in-handler, stored tier, CIMD now).
- `CLAUDE.md` + `docs/agents/project-rules.md` «OAuth/MCP routes» invariant: one line on tiers
  (live role, `READ_TIER_TOOLS` allowlist, writes never in "read") and the closed redirect list.

## 7. Tests (vitest; all existing MCP/OAuth suites stay green)

1. `redirects.test.ts`: per origin, allow the four targets; refuse `http://chatgpt.com/…`,
   `https://chatgpt.com/connector/oauth/` (empty id), ids with `.`/`%`/`/`, 129 chars,
   `https://CHATGPT.com/…`, `https://chatgpt.com.evil.example/…`, userinfo, port, query, fragment,
   trailing slash on the stable URI, `https://vscode.dev/redirect`, `cursor://…`; label for each
   allowed one, null otherwise; logging host matrix incl. R11 cases for the new hosts.
2. `tier.test.ts`: the role × active × ministries matrix; parity with `canUseAdminChat`.
3. `toolList.test.ts`: read list = `READ_TIER_TOOLS` exactly, in order; every one has
   `readOnlyHint: true` and no `_meta.ui`; the read list has no resource; `full` digest equals the
   pinned pre-change digest; `read` digest differs.
4. Route (`/api/mcp`): an admin token → `tools/list` is the read list and `toolsVersion` note logic
   uses the read digest; `tools/call edit_setlist` → SDK unknown-tool error and the write module is
   not called (spy); super-admin unchanged; content-editor / admin without worship / disabled →
   401 `invalid_token`; a super-admin demoted (cache expired) → read list.
5. Token route: admin redeems a code and refreshes; content-editor refused on both grants.
6. Authorize POST: admin 303 with code; content-editor 403; impersonation still 403.
7. Consent page: admin sees «Solo leer…» and the target label; content-editor sees the refusal.
8. Register route: a ChatGPT stable and a per-connection registration succeed in production;
   a mixed list with one off-list URI is still refused whole.

Gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors). No solver tree touched.

## 8. Release and verification

1. Branch → gates → one merge-range `code-reviewer` (§Review policy) → fixes → gates.
2. Merge into `preview`, verify the dev alias (alias + SHA). Dev is behind Deployment Protection, so
   ChatGPT cannot reach it; on dev run `scripts/mcp-dev-smoke.mjs` (loopback client) as Frank:
   full tier unchanged (`tools/list` = 45).
3. PR to `main`, `gates` green, merge, verify the prod alias + SHA.
4. **Live proof in production** (needs people): (a) Frank's existing Claude connector still works
   with no refresh note (`ping`); (b) a worship admin (Mkz) adds ChatGPT (developer mode) → consent
   shows «ChatGPT (chatgpt.com)» and «Solo leer…» → «¿Quién sirve el domingo?» answers; his
   `tools/list` has 11 tools; (c) the grant shows in `revoke-mcp-grant.mjs` (dry run).
   If ChatGPT is refused with `invalid_target` (it sends a `resource` other than
   `${origin}/api/mcp`), that is a NEW change with its own review, not a hot fix.
5. **Rollback:** revert the merge (tier gates return to super-admin; any admin grant then fails
   step 6 with 401 within 30 s), or the kill switch (`docs/MCP.md` «Kill switch») for everything.

## 9. Out of scope (named follow-ups)

Email notice on a new grant; a «Conexiones» screen listing/revoking grants; admin writes; Kids/
Jóvenes reads; `get_service_messages` for admins; CIMD; the proposal card in ChatGPT (MCP Apps
rendering there is untested; tools already answer in text).

## 10. Coordination

The «MCP de la página» thread (phase 4, members/rules/deletes) edits `toolList.ts` and may edit the
route. Its new tools are super-admin-only, which is exactly where "full" puts any tool not in
`READ_TIER_TOOLS`; whichever PR lands second rebases, and the `full` digest pin moves with phase 4's
own tool additions (the pin is «unchanged BY THIS PR»).
