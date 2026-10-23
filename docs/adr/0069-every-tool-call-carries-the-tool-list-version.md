# ADR-0069: Every tool call carries the tool list's version, and a stale one hears about it

**Date:** 2026-10-23 · **Status:** Accepted

## Context

claude.ai reads the connector's `tools/list` once, when it connects, and keeps that copy of the
names, descriptions and input schemas. Twice in two days a release changed that list and Frank's
Claude went on using the old one:
- PR #171 added the `focus` argument, and Claude still opened the whole month.
- PR #187 changed a description.

Each time the fix was the same: Settings → Connectors → disconnect and connect again. Nothing told
him it was needed (2026-10-23: «¿No hay forma de que yo no tenga que estar conectando y
reconectando cada que hay una actualización?»).

The protocol's answer is `notifications/tools/list_changed`, but it does not reach claude.ai from
this server:
- The server is stateless with no held streams (`listChanged: false`, `maxSubscriptions: 0` in
  `app/api/mcp/route.ts`), so it has no channel to send the notification on.
- Public reports say claude.ai ignores the notification anyway and keeps its cached list
  (anthropics/claude-ai-mcp #45, #137).

A call carries nothing that says which copy the client holds.

## Decision

`app/mcp/toolList.ts` registers every tool and computes `TOOL_LIST_VERSION`. That version is the
first 8 hex characters of a SHA-256 over what a client caches about each tool:
- name and title;
- description;
- input and output JSON Schemas;
- annotations and `_meta`.

The hash does not cover the commit, so a release that only changes code behind the tools keeps the
same version.

`versionToolList` (`app/mcp/toolListVersion.ts`) runs first in the route's init. It gives every
model-visible tool one more optional argument, `toolsVersion`, whose description asks Claude to
always pass that exact value. The handler never sees the argument.

When a call sends no value or a different one, the tool still runs and answers. Its answer gains
one more text block, `STALE_TOOL_LIST_NOTE`, which asks Claude to tell the user once to refresh the
connector («⋯» → «Refresh tools list», or disconnect and connect) and to continue in a new chat.
The block is marked `audience: ["assistant"]`, and the card's `textLines` drops it and any line
that starts with its prefix (`STALE_NOTE_PREFIX`, kept in step by `storedMonthCard.test.tsx`).
`structuredContent` is untouched.

The note also reaches the cases an old copy most often runs into. The SDK validates arguments
before the handler runs, and a refused argument (renamed, removed, an old enum value) is answered
with the SDK's error text alone. `versionToolList` therefore also wraps the instance's
`validateToolInput`, so a stale call's refusal carries the note too.

The card's app-only twins don't get the argument, because the card calls them, not the model. The
check answers name their argument lines by prefix («la línea "Argumentos para …"»), not as «la
última línea», since the note now follows them.

Guidance that depends on an answer belongs in that answer, which is always current, not in a
description that a stale client keeps. Example: the save and copy descriptions no longer say «si
dice "sin confirmar", repite». The save's answer already says when to repeat and when to check
again, and the two had drifted apart.

## Rejected

- **Sending `tools/list_changed`.** It needs a held stream, which this server refuses on purpose:
  revocation must bite within 30 s, and an open stream keeps a function alive. claude.ai is
  reported to ignore the notification anyway.
- **Revoking Frank's grant after a release that changes the list**, so that Claude has to sign in
  again. It is a production write, and every tool fails in the middle of whatever he is doing.
  claude.ai doesn't document whether a 401 offers a reconnect from the chat or only shows an
  error, and #137 reports that even a reconnect sometimes keeps the old list.
- **Refusing a stale call.** The server validates every argument it accepts, so an old copy can't
  get anything past it. Refusing would only turn the refresh reminder into a failed task. A
  required `toolsVersion` would do the same at the SDK, before the note could be added.
- **The commit as the version.** Every deployment would look like a change and would nag for
  nothing.

**The card's URI is versioned too** (added 2026-10-23, after the release). As observed, not
documented by the host, the Claude app keeps a card's HTML by its resource URI. After #189 shipped, Frank's card still sent the «Guardar» message
of a build two releases old, while the server already served the new one. `PROPOSAL_CARD_URI` is
now `ui://owt/proposal-editor/<8 hex of the HTML's SHA-256>` (`app/mcp/apps/proposalCard.ts`). A
new build therefore names a new URI in the tools' `_meta`, which changes the tool list version and
makes the host read the new document. The first URI, and any earlier build's URI (an unlisted
template), still serve the current HTML, so no client ever gets «resource not found». Every card
rebuild now also triggers the refresh note.

## Consequences

- Any release that changes a tool's name, title, description, schema, annotations or `_meta`
  changes the version. From then on every answer to an old copy, a refusal of its arguments
  included, carries the note until Frank refreshes. This is intended: it is the only signal he gets.
- The argument is optional, so a current client that leaves it out also gets the note. The
  wording («sin repetirlo si ya se lo dijiste») keeps that to one sentence in the chat.
- A handler that throws gets no note, but by the tool rules (`ping.ts`) no handler throws.
- Rolling back past this change breaks a client that has refreshed: it sends `toolsVersion`, the
  older `.strict()` schemas refuse it, and every call fails (nothing is written) until the next
  refresh.
- Don't make `toolsVersion` required, and don't compute the hash over the served list (which
  contains the version itself).
- A new tool file goes in `registerAllTools`, never directly in the route, or it stays out of the
  digest (`mcpRoute.test.ts` asserts the recorded names equal `tools/list`).
