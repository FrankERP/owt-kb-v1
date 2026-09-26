// The outcome every service domain module (`app/utils/*Commit.ts`) returns.
//
// An admin write route authorizes, parses JSON, calls its `*Commit` module and
// sends `NextResponse.json(outcome.body, { status: outcome.status })`. The MCP
// write tools call the same modules, so both surfaces refuse, write, notify and
// revalidate through one code path (ADR-0041). `body` is EXACTLY what the route
// sends: a refusal's `serviceError(...)` body, or the success JSON.
//
// `effects` exists only on success. It carries values the write already held —
// never a second read — so a caller can report what was written and what the
// post-commit helpers queued (their descriptors: `[]` = ran and notified nobody,
// `null` = skipped silently or swallowed a failure).
//
// `body` admits `ServiceErrorBody` explicitly because it is an interface, and an
// interface has no implicit index signature: `{ ok: false, ...serviceError(…) }`
// would not type as `Record<string, unknown>` alone.

import type { ServiceErrorBody } from "./serviceMutation";

export type CommitOutcome<E> =
  | { ok: true; status: 200; body: Record<string, unknown>; effects: E }
  | { ok: false; status: number; body: ServiceErrorBody | Record<string, unknown> };
