# ADR-0041: Admin write routes delegate to `*Commit` domain modules, and the MCP calls the same modules

**Date:** 2026-09-26 · **Status:** Accepted

> **The number is provisional.** ADR numbers follow the order in which records reach `main`.
> Two other branches claim 0041: P2's solver-history delivery and PR #102 (solver pins). P3 is
> meant to follow them, as 0042 (ruling P3-R13). It is written as 0041 on this branch because
> `adrIndex.test.ts` requires consecutive numbers and nothing numbered 0041 is on `main` yet
> (checked 2026-09-26: `origin/main` `a4bfbb19` ends at 0040; PR #102 is open). Whichever of
> these lands later renumbers in one commit: the file, its title, the index row, and every
> literal that cites it.

## Context

P3 of the MCP connector adds four write tools. Each has an admin counterpart that already guards
the same write:

| Tool | Counterpart | Domain module |
|---|---|---|
| `edit_setlist` | `PUT /api/admin/setlists` | `app/utils/setlistSaveCommit.ts` |
| `swap_assignment` | `POST /api/admin/roles/swap` | `roleSwapCommit.ts` |
| `publish_service` | `POST /api/admin/roles/publish-ready` | `publishReadyCommit.ts` |
| `unpublish_service` | `POST /api/admin/roles/unpublish` | `roleUnpublishCommit.ts` |

The first row lands with this record; the other three follow the same template.

Three facts decide how a tool reaches that guarded code:

- **Authorization cannot be shared.** Every MCP request is authenticated by a bearer token at
  `/api/mcp`, before any tool runs (spec I6). The admin guard, `requireActiveManager()`, takes
  no request and resolves the session from ambient cookies (`app/utils/authGuards.ts`), so a
  bearer caller cannot pass through it. Authorization has to be separated from domain logic.
- **A route cannot export its body.** Next type-checks a route module's export set against a
  fixed list (HTTP methods, `dynamic`, `revalidate`, `maxDuration`, …), so the domain function
  cannot simply be exported from `route.ts` (plan F3).
- **Parity is a promise, not a hope.** A tool must refuse at least everything its counterpart
  refuses, with the counterpart's code (I15). It must also send the same notices from the same
  pre-commit captures (I8) and invalidate the same caches (I12). Two implementations would keep
  those equal only as long as every future edit landed in both.

## Decision

**One code path.** Each counterpart route keeps its authorization prefix and JSON parse, then
sends whatever its domain module returns:

```ts
const outcome = await saveSetlist(raw);
return NextResponse.json(outcome.body, { status: outcome.status });
```

Everything after authorization moved **verbatim** into `app/utils/<x>Commit.ts`
(`import "server-only"`). The module takes the raw body and returns `CommitOutcome<E>`
(`app/utils/commitOutcome.ts`): `{ ok: false, status, body }` for a refusal, or
`{ ok: true, status: 200, body, effects }` for a success. `body` is exactly what the route
sends, so admin responses are byte-identical and the counterpart's route tests pass unedited.
The only edits allowed at the boundary are these:

- a refusal returns its outcome instead of sending it;
- success adds `effects`, built from values the write already held. `effects` carries the
  target, what was written (with its new `_key`s), the pre-commit subject, and the descriptors
  the post-commit helpers return. Nothing in it is re-read after the commit;
- a helper's return value is captured at its existing call site, with the same position, the
  same arguments and the same condition;
- a `mode: "recover"` early return becomes an outcome with an explicit empty `effects`.

A commit that fails for any reason other than a revision or creation conflict still throws, as
the route's 500 did.

The tool builds **the counterpart's own request body** and calls the same function, so it goes
through the same parser. So the route half of I15 holds by construction, and I8 and I12 do too.

**The audit registry follows the transaction (F4).** `protectedReadAudit` finds a protected write
where a Sanity client's mutation method is called in a region that names a protected type.
Once the transaction leaves a route, that route's `PROTECTED_RUNTIME_WRITERS` entry is dead. So
each `route.ts#METHOD` entry is replaced by `app/utils/<x>Commit.ts#module`, with the same reason
text. The MCP tool modules import no Sanity client, so they have no entry.

**The caller pin.** A per-route entry used to mean "a new write surface has to touch a reviewed
list". A module entry does not: any new file can import the module. So
`app/utils/__tests__/serviceCommitCallers.test.ts` pins the exact set of non-test importers of
every `*Commit` module, and later of the shared publish predicate. A new caller, or a new
`*Commit` module, fails that test until someone adds it on purpose. The pin counts value imports
only, and resolves each specifier: a type-only import cannot reach the writer.

**Delivery coverage (F5).** The SR-verification scan in `srVerificationRunContext.test.ts` decides
that a route is delivery-capable by looking at the route's **own** imports. A route that imports
only its domain module would drop out of the scan without any warning. So each `*Commit` name
joins `DELIVERY_CAPABLE_IMPORTS`. That list now lives in
`app/utils/__tests__/__fixtures__/deliveryCapableImports.ts`, so other suites can pin the same
list without importing a test file.

**The transport gate (F2, D4).** In the 2025-06-18 (legacy) transport, the SDK returns an SSE
`Response` at once and runs the tool asynchronously. The same happens in the 2026-07-28
transport when a tool sends a notification mid-call. Next resolves a route's pending
`revalidatePath` tags once, when the handler's promise settles, so a write tool's revalidation
would be silently dropped. Two changes close this:

- `/api/mcp` buffers every SSE response to its end (`app/mcp/transport/completeResponse.ts`).
  Every tool call, including its `revalidatePath` and `after()` registrations, therefore
  finishes inside the handler, whatever the protocol era.
- The request forwarded to the SDK is detached from the client's abort signal (`signal: null`).
  A disconnecting client therefore cannot end the exchange between a commit and its
  side effects.

Evidence: `app/api/__tests__/mcpToolCompletion.test.ts` failed without buffering in both the
legacy case and the modern notification case: nothing had run when `POST` resolved. It passes
with buffering. The local `next build && next start` spike (ruling P3-R9) must also show the
`pending revalidates promise finished` log line with buffering and its absence without.
**That output is still owed and is recorded here when it is run.**

Cost: a legacy-era client no longer receives early SSE bytes (keep-alive comments, progress
notifications) before the result. They now arrive together with the result. The ceiling on a
call is Vercel's 60 s function limit.

**I15's counterpart is the admin surface (D13), not the route alone.** `/admin` refuses more
than its routes do. For example, the setlist editor will not open a setlist with malformed
rows, will not add a song twice, and offers only catalogue songs. The stored planner swaps only
two services of the opened month whose admission is `approved`. Two halves cover this:

- the route half holds by construction (above);
- the client half holds by a gate table that gives every client-side gate one disposition:
  `mirror`, `mirror (behaviour)`, `structural`, `inherited` or `declared narrowing`. The full
  table is § «Admin surface gates» of
  `docs/superpowers/plans/2026-09-25-owt-mcp-p3-writes.md`. Its condensed form (gate →
  disposition) goes into `docs/MCP.md` when the write tools are documented there.

**The SR-verification gap on `/api/mcp` is stated, not excepted (D15).** `/api/mcp` reaches
delivery **transitively**: route → `app/mcp/tools/*` → `*Commit` → the side-effect helpers. The
coverage scan is per-file and follows no import, so an exception entry for `/api/mcp` would
never be exercised, and it would read as coverage that does not exist. The route is deliberately
unwrapped, because an MCP call is bearer-authenticated for one super-admin and is never an
SR-verification run. What gets pinned instead, with the MCP write foundation, is the one
property the scan can see: a test in `app/api/__tests__/mcpRoute.test.ts` asserting that the
route's own source has no direct delivery-capable import and no `withVerificationRunContext(`. An MCP write's delivery evidence therefore carries no run
markers. That is an evidence gap, not a safety hole: blocking never depends on a context
(`app/utils/srVerificationRunContext.ts`).

## Rejected

- **The tool calls the HTTP route internally.** It cannot authenticate. The route's guard reads
  a session cookie that a bearer caller does not have. Making it pass would mean a bypass inside
  the admin guard, which is exactly what I6 forbids.
- **A second writer in `app/mcp/`.** Two copies of every refusal, notice and revalidation drift
  apart, and I8, I12 and I15 would hold only by review. It also breaks `mcpSanityClients.test.ts`,
  which allows code under `app/mcp/` to import only the canonical operational clients. A writer
  there would need the write client, which that guard forbids.
- **One shared function that receives `writeClient` as a parameter.** The protected-write audit
  identifies clients by their import (`sanityClientIdentifiers`). A client passed in as a
  parameter is not one it knows, so `client.transaction()` would register no site, and the
  writer would leave the registry without anyone noticing. P1 met the same shape for reads,
  where a query passed as a parameter was invisible to the audit (`mcpSanityClients.test.ts`
  header). Keeping the import inside the module keeps the write visible.

## Consequences

- An admin write route no longer shows its writer. Follow the `*Commit` import. The route test
  still drives the full path, because its `vi.mock`s act on module identity, which the module
  imports too.
- A new `*Commit` module owes, in the same commit as the move:
  - its `PROTECTED_RUNTIME_WRITERS` entry;
  - its name in `DELIVERY_CAPABLE_IMPORTS`;
  - its row in `serviceCommitCallers.test.ts`.

  Adding a caller means editing the pin.
- **Undoing the move** means re-pointing the registry entry back at the route, dropping the name
  from both lists, and deleting the pin row. It also strands the tool, which cannot import from
  a route.
- **Rolling P3 back** removes the tools and their pin rows. The registry entries stay with the
  extraction, because the transactions stay in the modules.
- An MCP write's delivery evidence carries no SR-verification run markers (D15).
