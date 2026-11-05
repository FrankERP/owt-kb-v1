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

**Narrowing, stated:** «cualquier agente» becomes «any agent that can finish the flow on a redirect
target from a closed list» (§3) — claude.ai, chatgpt.com, and the user's own computer (RFC 8252
loopback, any port). A hosted agent not on the list (a future web client) is added by a one-line PR.
An agent that ONLY offers a target outside the list (a custom scheme such as `cursor://`, or a web
forwarder such as `https://vscode.dev/redirect`) cannot connect; §3 says why the list is not opened
to every `https` URI and §3.1 which local agents are expected to work and on what evidence.

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

`isRedirectUriAllowed(uri, origin)` becomes, for each of the three known origins (production, preview,
local):

| Target | Rule | Shown on consent as |
|---|---|---|
| claude.ai | exactly `CLAUDE_AI_REDIRECT_URI` (unchanged) | «Claude (claude.ai)» |
| ChatGPT, stable | exactly `https://chatgpt.com/connector_platform_oauth_redirect` | «ChatGPT (chatgpt.com)» |
| Local agent | a loopback URI (§3.1) — **now also in production** | «Un programa en esta computadora» |

Any other origin (an unknown `VERCEL_ENV`) still allows nothing, as today. ChatGPT's per-connection
form `https://chatgpt.com/connector/oauth/{callback_id}` is NOT allowed: OpenAI uses it only for an AS
without RFC 9207 issuer identification, and ours has it; if the live proof shows otherwise, adding it
is a new reviewed change (the refused URI is logged, below).

A pure `redirectTargetKind(uri, origin): "claude" | "chatgpt" | "loopback" | null` beside it (null ⇔
not allowed on that origin) is the ONLY source of the consent screen's «Se conecta a» label and of the grant's `client`
field (§4.1).

**Why loopback in production is safe** (RFC 8252 §7.3/§8.3): the code is delivered to the browser's
own machine. A remote attacker who registers a loopback client and sends an admin the authorize link
gets nothing — the code lands on the admin's computer, and without it the attacker's PKCE verifier
is useless. The same holds for ANY port: whatever listens on the admin's own machine is the admin's.

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

### 3.1 Loopback, registration subsets and port variance

Exact, all-or-nothing matching shuts out real local agents. VS Code's DCR body
(microsoft/vscode `src/vs/base/common/oauth.ts`, `fetchDynamicRegistration`, fetched 2026-11-05)
registers `https://insiders.vscode.dev/redirect`, `https://vscode.dev/redirect`, `http://127.0.0.1/`
and `http://127.0.0.1:33418/` in ONE request; today's register route refuses the whole list when any
URI is off-list, and `isLoopbackRedirectUri` refuses a port-less loopback. And RFC 8252 §7.3 requires
the AS to accept any port at request time for a loopback redirect, because a native client binds a
free port at login. So:

1. **Loopback shape** — `isLoopbackRedirectUri` keeps every rule (`http:`, host exactly `127.0.0.1`
   or `localhost`, no userinfo, no fragment, printable, canonical `href === uri`) but the port
   becomes OPTIONAL (`http://127.0.0.1/` is canonical and allowed).
2. **Registration keeps the allowed subset** (RFC 7591 §3.2.1 lets the server replace requested
   metadata; the 201 already states what the server registered). `register/route.ts`: the signed
   client id carries ONLY the URIs that pass `isRedirectUriAllowed`, in request order; the 201's
   `redirect_uris` is that subset; the registration is refused (`invalid_redirect_uri`) only when
   the subset is EMPTY. Size/type checks on the raw array are unchanged (1–5 strings). The refused
   ones are still logged by the widened `shouldLogRefusedRedirect` (one line per request). Nothing
   off-list is ever signed, so authorize and token never see it as registered.
3. **Matching** — one pure function in `redirects.ts`,
   `matchRegisteredRedirect(requested, registered, origin): boolean` =
   `isRedirectUriAllowed(requested, origin)` AND (`registered.includes(requested)` OR
   (`isLoopbackRedirectUri(requested)` AND some `r` in `registered` with `isLoopbackRedirectUri(r)`
   and the same protocol, hostname, pathname and search as `requested` — port ignored, nothing
   else)). `localhost` and `127.0.0.1` are NOT interchangeable. It replaces the two
   `client.claims.redirectUris.includes(x) && isRedirectUriAllowed(x, origin)` checks:
   `authorizeRequest.ts` rule 2 and `token/route.ts` step 3. The code's own binding stays EXACT:
   `checkCodeBinding` (token step 4) still requires the token request's `redirect_uri` to equal the
   one the code was minted for (RFC 6749 §4.1.3), so port variance applies to «is it registered»,
   never to «is it the same request».
4. **Which local agents are expected to work:** any client whose DCR list contains at least one
   loopback URI AND that then sends a loopback `redirect_uri` at authorize. VS Code: registers
   loopback (evidence above), so it registers; whether it then authorizes through loopback or
   through `vscode.dev/redirect` depends on its own flow choice — **expected, not proven**, checked
   by hand if an admin wants it. Claude Code, Codex CLI, Gemini CLI: documented as loopback clients
   by their vendors but their exact DCR bodies were NOT verified here — **expected, not proven**.
   `docs/MCP.md` says exactly this. Cursor (`cursor://`) is not expected to work.

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
ministries matrix for ACTIVE members (`canUseAdminChat` does not read `active`) (they stay separate functions because they gate different features).

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
  (the SDK's own error); it is never registered there, so no write module runs. The read handler's
  `capabilities` are `{ tools: { listChanged: false } }` only — no `resources` key, since it
  registers no resource (a route test pins what `resources/list` answers on the read tier).
### 4.1 App-only tools reach claude.ai grants only

Five tools are app-only (`_meta.ui.visibility: ["app"]`): `check_proposal_edits`,
`save_proposal_edits`, `check_service_edits_app`, `save_service_edits_app`, `delete_services_app`.
They mint waivers, force seats and save after the card's own confirmation. ADR-0062 Q1 (1), ADR-0066,
ADR-0072 and `docs/MCP.md` («The guarantee that the model cannot force rests on the host hiding
app-only tools») rely on the HOST hiding them from the model. Today only claude.ai can hold a
production token, and it hides them. Once a super-admin can connect ChatGPT or a local agent, that
host may show them to the model, and a prompt-injected lyric or note could then mint a waiver and
force a save with no card in between. So the app-only tools follow the CLIENT, not the role:

- **The grant records its client.** `createGrant` (token route, `authorization_code` grant) writes a
  new field `client: "claude" | "chatgpt" | "loopback"` = `redirectTargetKind(code's redirect URI, origin)`
  (already verified by token step 3). It is set once and never changed by a refresh (`rotateRefresh`
  patches only the refresh fields). It is a property of the connection, not of the person: the tier
  is still never stored.
- **Absent `client` (every grant minted before this release):** on the production origin it reads
  as `"claude"` (production allowed only claude.ai until now, so it is true); on any other origin it
  reads as `"loopback"` (fail closed: the dev smoke's old grants lose the app twins, which the smoke
  never calls). `loadGrant`'s parse accepts the field absent or one of the three values; any other
  value → malformed → revoked (existing rule).
- **Three handlers, not two:** `full` + `client === "claude"` → today's list exactly (45 tools + the
  card resources; digest pinned to today's); `full` + any other client → today's list WITHOUT the
  five app-only tools and WITHOUT the card resources (`registerAllTools(server, { version, tier,
  appsHost })`; the three bundles skip their app twins when `appsHost` is false); `read` → the 11
  reads, any client. The model-visible tools whose `_meta.ui.resourceUri` points at the card stay as
  they are; a host without the resource falls back to the text answer (known effect). Without
  `check_service_edits_app` nothing mints a waiver on such a grant, so nothing can be forced.
- `docs/MCP.md` and ADR-0062/0066/0072 get a one-line consequence addendum: «since ADR-0083, app-only
  tools are registered only for grants whose client is claude.ai».
- The grant type is hidden and read-only in Studio; `documentTypes.ts`'s field list,
  `docs/DATA_MODEL.md` and `scripts/revoke-mcp-grant.mjs`'s dry-run listing gain `client` (so Frank
  sees which agent each grant is).

- **Known effects, accepted:** the descriptions of `get_service`/`list_services` mention write tools
  the read tier lacks (changing them would change the `full` digest and send Frank a refresh note
  for nothing; the model simply cannot call them). `STALE_TOOL_LIST_NOTE` becomes agent-neutral
  («actualiza la lista de herramientas del conector en tu app (en Claude: …)») — it is answer text,
  not part of any digest. A client whose model omits the optional `toolsVersion` gets the note on
  every answer; observed in the live proof, and if ChatGPT does this, a follow-up decides.

**Why a separate tool list and not «register everything, refuse writes in the handler»** (the same
reasoning drives §4.1): the model
never sees a tool it can't use (no wasted call, no prompt-injected «call delete_services»); ChatGPT
treats any tool without `readOnlyHint` as a write and asks for confirmation; and a forgotten refusal
in one of 25 tool files cannot leak a write, because the read list is an allowlist checked by a test.

**Why a worship admin reads all of these:** each is something that admin already sees in `/admin`
(§2), and «¿quién puede el 15?» needs availability. Kids and Jóvenes stay out (ministry isolation,
ADR-0075). **What leaves the app, told to Frank specifically before release:** whatever the
admin's agent asks for goes to that agent's provider (OpenAI for ChatGPT), including members'
free-text unavailability notes (`get_member_availability`), names and seats. **Load:** MCP reads
have no per-admin cap (the admin assistant's cap is about Anthropic spend, ADR-0060); each read
costs Sanity API requests on the free plan, so more connected admins means more reads. A per-grant
rate limit is a named follow-up, triggered if usage shows it.

## 5. Consent screen and copy

- Every super-admin/Claude-specific line on the page: «Sólo un super-admin puede autorizar
  conexiones con Claude.» → «Solo los administradores de Alabanza pueden conectar un agente de IA.»;
  «Necesitas una sesión activa de super-admin para autorizar una conexión.» → «Necesitas una sesión
  activa de administrador para autorizar una conexión.»; «La conexión con Claude no está disponible
  en este momento.» → «La conexión con agentes de IA no está disponible en este momento.»
  (`ERROR_PAGE_TEXT` has no Claude wording and stays.)
- New fact line «Se conecta a»: the label of `redirectTargetKind(request.redirectUri, origin)` (verified). The exact
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
- Stale text this change creates, updated in the same PR: `project-rules.md` «The admin
  assistant…» («super-admin OAuth, write tools on the same server»); `docs/MCP.md` lines that say
  only a super-admin reaches consent; ADR-0039 Consequences («only a live super-admin session can
  approve one») as a dated addendum; the «refused redirect_uri from a claude host» log text
  (register route, `authorizeRequest.ts`); the `redirects.ts` header comment; the smoke's refusal
  reason; the consequence lines of ADR-0062/0066/0072 (§4.1).
- The new ADR notes that `localhost` loopback is kept although RFC 8252 §8.3 prefers `127.0.0.1`
  (harmless here: the code reaches the browser's own machine), so a later "fix" doesn't break clients.
- `CLAUDE.md` + `docs/agents/project-rules.md` «OAuth/MCP routes» invariant: one line on tiers
  (live role, `READ_TIER_TOOLS` allowlist, writes never in "read", app-only tools only for a claude.ai
  grant) and the closed redirect list.

## 7. Tests (vitest; all existing MCP/OAuth suites stay green)

1. `redirects.test.ts`: per origin, allow the three targets; refuse `http://chatgpt.com/…`, any
   `https://chatgpt.com/connector/oauth/…`, `https://CHATGPT.com/…`,
   `https://chatgpt.com.evil.example/…`, userinfo, port, query, fragment, trailing slash on the
   stable URI, `https://vscode.dev/redirect`, `cursor://…`; the kind for each allowed one, null
   otherwise; logging host matrix incl. R11 cases for the new hosts.
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
8. Register route: a ChatGPT stable registration succeeds in production; a per-connection
   `chatgpt.com/connector/oauth/…` URI is refused (and logged).

9. `redirects.test.ts` + authorize/token: port-less loopback allowed; `matchRegisteredRedirect`
   matrix (registered `http://127.0.0.1/` matches requested `http://127.0.0.1:54321/`; registered
   `http://127.0.0.1:33418/cb` does NOT match `…:5/other` or `http://localhost:5/cb`; a non-loopback
   never matches by port); token step 4 still refuses a code minted for `:5` redeemed with `:6`.
10. Register: VS Code's exact four-URI body → 201 whose `redirect_uris` are the two loopback ones
   (and the client id carries only those); an all-off-list body → `invalid_redirect_uri`.

11. Grant `client`: written from the code's redirect at the code exchange; kept across refresh;
   absent → `"claude"` on production, `"loopback"` elsewhere; an unknown value → revoked. Route: a
   full grant with client `chatgpt`/`loopback` lists 40 tools, none app-only, no resource, and
   `tools/call save_service_edits_app` is an unknown tool; a full grant with client `claude` (or
   absent on production) lists today's 45 + resources.
12. Unknown origin: `isRedirectUriAllowed` and `redirectTargetKind` refuse everything.

**Intended flips of existing tests** (update them, never the code back):
- admin admitted: `mcpRoute.test.ts` (the `liveAccess("admin")` refusal), `authorizePage.test.tsx`
  (admin refused), `oauthAuthorizeRoute.test.ts` (admin → 403 cases), `oauthTokenRoute.test.ts`
  («demoted to admin» → `invalid_grant`; becomes «demoted to content-editor»);
- production loopback: the `redirects.test.ts`, `authorizeRequest.test.ts`,
  `oauthRegisterRoute.test.ts`, `oauthTokenRoute.test.ts` and `oauthAuthorizeRoute.test.ts` cases
  asserting production refuses loopback. **These carry O1 (the redirect is re-checked against the
  allowlist, never trusted from the client id)**: re-target each to a client id SIGNED DIRECTLY in
  the test with an off-list URI (e.g. `https://evil.example/cb`) and assert authorize and token still
  refuse it. Never delete them: once registration signs only allowed URIs the re-check looks
  redundant, and it is not;
- register: cases asserting a mixed list is refused whole become «the allowed subset is signed».
Every other existing case stays as is.

Gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors). No solver tree touched.

## 8. Release and verification

1. Branch → gates → one merge-range `code-reviewer` (§Review policy) → fixes → gates.
2. Merge into `preview`, verify the dev alias (alias + SHA). Dev is behind Deployment Protection, so
   ChatGPT cannot reach it. `scripts/mcp-dev-smoke.mjs` gains `--expect-tier full|read` (default
   `full`): `full` expects today's list minus the five app-only tools (a loopback grant, §4.1);
   `read` expects exactly `READ_TIER_TOOLS` and that no write name is listed. Its write-call guard
   (`toolCallRequest` refuses write names, because dev writes the production dataset) STAYS; the
   boundary probe is a `tools/call` of `edit_setlist` with arguments that fail schema validation on
   ANY tier (e.g. `{}`), expecting the unknown-tool error on `read`, so a broken boundary still cannot
   write. Its production refusal message («no loopback entry») is reworded; the refusal stays (the
   smoke writes grants). Run (a) as Frank (`full`) and (b) as a worship-admin account (`read`). If
   (b) can't be run (a browser signed in as that account), say so in the PR; §7.4 is then the only
   pre-production proof of the boundary.
3. PR to `main`, `gates` green, merge, verify the prod alias + SHA.
4. **Live proof in production** (needs people): (a) Frank's existing Claude connector still works
   with no refresh note (`ping`); (b) a worship admin (Mkz) adds ChatGPT (developer mode) → consent
   shows «ChatGPT (chatgpt.com)» and «Solo leer…» → «¿Quién sirve el domingo?» answers; his
   `tools/list` has 11 tools; (c) the grant shows in `revoke-mcp-grant.mjs` (dry run).
   Any ChatGPT incompatibility found here — `invalid_target` (a `resource` other than
   `${origin}/api/mcp`), a DCR `token_endpoint_auth_method` other than `none`, an empty
   `client_secret` field refused by the token route, a redirect form not on the list, a stale-list
   note on every answer because the model omits `toolsVersion` — is a NEW change with its own
   review, not a hot fix.
5. **Rollback, fastest first:** one misbehaving grant → `scripts/revoke-mcp-grant.mjs --id … --apply`
   (bites ≤ 30 s); every admin grant → the same script per id (the dry run lists `sub` and
   `client`); everything → the kill switch (`docs/MCP.md` «Kill switch»; it needs a redeploy, so it
   is no faster than a revert); the code → revert the merge through a `main` PR (minutes, gated),
   after which the tier gates return to super-admin and
   any admin grant fails step 6 with 401 within 30 s. There is no switch for the read tier alone;
   accepted, since per-grant revocation covers it.

## 9. Out of scope (named follow-ups)

Email notice on a new grant (the cheapest detector for §3's residual risk, now that every worship
admin can authorize; offered to Frank as the first follow-up); a per-grant rate limit; a «Conexiones» screen listing/revoking grants; admin writes; Kids/
Jóvenes reads; `get_service_messages` for admins; CIMD; the proposal card in ChatGPT (MCP Apps
rendering there is untested; tools already answer in text).

## 10. Coordination

The «MCP de la página» thread (phase 4, members/rules/deletes) edits `toolList.ts` and may edit the
route. Its new tools are super-admin-only, which is exactly where "full" puts any tool not in
`READ_TIER_TOOLS`; whichever PR lands second rebases, and the `full` digest pin moves with phase 4's
own tool additions (the pin is «unchanged BY THIS PR»).
