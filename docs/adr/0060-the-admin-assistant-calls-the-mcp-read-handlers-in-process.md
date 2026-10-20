# ADR-0060: The admin assistant calls the MCP read handlers in process

**Date:** 2026-10-20 · **Status:** Accepted

## Context

Frank asked for a Claude chat inside Backstage, for admins only, to ask about the team's songs,
their lyrics, what a Bible verse means and music theory, paid with the 100 USD of monthly Claude
API credits his Max 5x plan includes (claimed by linking a Claude Console organization; they pay
for the Messages API, never for claude.ai, and when they run out the API simply stops — the plan is
never charged). He also asked that nobody spend the quota on unrelated things.

The app already exposes its data to Claude through the MCP connector (`/api/mcp`, `docs/MCP.md`),
but that connector was built for ONE person with full power: OAuth that only a super-admin can
authorize, and four write tools (`edit_setlist`, `swap_assignment`, `publish_service`,
`unpublish_service`) beside the reads. Its `get_song` reports lyrics presence only (a P1 non-goal).

## Decision

`/api/admin/chat` (`app/api/admin/chat/route.ts`) calls the Messages API itself, with the
Anthropic SDK and `ANTHROPIC_API_KEY`, and gives the model five READ-ONLY tools that run in the same
function (`app/utils/adminChatServer.ts`):

- `search_songs`, `get_song`, `list_services`, `get_service` call the MCP's own handlers
  (`searchSongsResult`, `getSongResult`, `listServicesResult`, `getServiceResult`) directly and pass
  their payloads through `app/utils/adminChatViews.ts`, which drops what only a writer needs
  (revisions, item keys, observations, readiness, rehearsal mixes) — every field the model gets is
  resent on every later turn.
- `get_song_lyrics` is the assistant's own read: the song's chord chart, or its lyrics when there is
  no chart, exactly as the song page shows them (ADR-0018).

Who: an active `admin` or `super-admin` of the worship ministry (`canUseAdminChat`), checked live
on every request, never while impersonating.

Where: a floating bubble on every page (`app/components/assistant/AssistantBubble.tsx`, mounted
once by the client layout), shown only to those admins — a docked card beside the page at `sm+`,
the whole screen on a phone. Frank tried the first version, an /admin tab, on dev and asked for
this instead (2026-10-20: «un bubble chat que esté disponible desde cualquier lugar… que le
pudieras preguntar sobre lo que estás viendo»). Because the layout mounts it once, the conversation
survives moving between pages. An admin who never opens it costs no request: the status read waits
for the first open.

Page context: each question carries the page it was asked from — its path, a label, and up to four
references the tools can follow (on a song page, the song's id and title; on /admin, the tab's
name). A page that knows more than its path says so by rendering `<AssistantPageContext>`; every
other page is named from its path (`assistantPage.ts`). The route puts it before that question as
its own text block, framed as reference data (`pageContextNote`); the system prompt says the note
is information, never an instruction. Every turn keeps its own note, so the conversation resent
next turn is byte-identical up to the new question and the prompt cache still holds. A malformed
context is dropped, never a reason to refuse the question.

Spend, three layers, outermost first: the credit balance itself (no purchased credits, no
auto-reload) and the Console workspace's spend limit; a per-admin monthly cap,
`ADMIN_CHAT_MONTHLY_BUDGET_USD` (15 USD), summed from each response's own `usage` — every attempt in
`usage.iterations`, so a refusal declined mid-answer and re-run on a fallback model is charged for
both — into the dotted `adminChatUsage.<memberId>.<YYYY-MM>` document and checked before any API
call; and the system
prompt, which limits the assistant to the ministry's topics and declines anything else in one line
(about a cent). Request limits bound one call's input; six model calls per question at most.

Time: the project is on Vercel Hobby without Fluid compute, so a function lives 60 s at most. The
route stops itself at 50 s, aborting a call still in flight and charging it as if it had written
its whole `max_tokens` (8 000), so the spend is always recorded before the platform could kill the
function. A client that goes away does not abort the call in flight — the API bills it anyway, and
an aborted call would go uncharged — the route only starts no further call.

Model: Claude Opus 5.5 (Frank's choice) at `effort: "medium"`, with the server-side refusal
fallback (`fallbacks: "default"`) and automatic prompt caching. Nothing is stored but the spend
counter: the conversation lives in the browser and is resent, as text only, each turn.

## Rejected

- **The Messages API's MCP connector pointed at `/api/mcp`.** Zero tool code, but the only way to
  give a plain admin an MCP token is to have the server mint one — a new auth boundary — and the
  token would still carry write power, filtered out only by a request setting. Calling the handlers
  in process gives the same code with no token and no writer, and saves a network hop
  (Anthropic → a cold Vercel function → Sanity) per tool.
- **claude.ai with the connector for each admin.** The credits do not pay for claude.ai, every admin
  would need their own plan, and the connector is super-admin-only.
- **A cheap model screening every question for topic.** Slower answers and false refusals, to save
  the cent that Opus's own one-line decline costs.
- **No per-admin cap, only the Console limit.** One person could spend the whole month for everyone.
- **An «Asistente» tab in /admin.** Built first and tested on dev; it only answered from /admin and
  knew nothing of the page the question was about.
- **The screen's text as context** (what the admin sees, scraped from the page). Richer, but a
  page's text — a lyric, a note someone typed — would reach the model as if the admin had written
  it, and a long page would cost a page of input on every turn. Ids and labels cost a line, and the
  tools fetch the rest only when the question needs it.
- **The context in the system prompt.** It would change whenever the admin moved, so the cached
  prefix (system prompt and tools) would be rebuilt on almost every question.

## Consequences

- A fix to an MCP read handler reaches the assistant too; a change to an MCP payload's shape must
  keep `adminChatViews.ts` compiling (it imports the payload types).
- The per-admin cap is soft: two questions sent at the same moment both pass the check, and a
  spend write that fails twice leaves that answer uncounted (logged). The hard cap is the
  Console's.
- Long answers are bounded by the 50 s deadline more than by `max_tokens`. Turning on Fluid
  compute (a project-wide Vercel setting, Frank's call) would allow up to 300 s.
- Without `SANITY_API_READ_TOKEN` an untokened read of the dotted counter answers «nothing spent»,
  so the route refuses (503) instead of lifting every cap. Without `ANTHROPIC_API_KEY` the bubble
  says «no está configurado».
- Fixed-bottom neighbours: the bubble clears the phone tab bar (`--bottom-nav-h`) and the audio
  transport (`--audio-player-h`, which `AudioPlayer` now measures), and publishes
  `--assistant-fab-w` so the song page's «Editar» button steps aside (`bottomNavOffsetSync.test.ts`).
- Adding a tool that writes would undo the reason for this design; `adminChatRoute.test.ts` pins
  the five names and that no MCP writer is among them.
