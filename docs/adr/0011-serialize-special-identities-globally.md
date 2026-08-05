# ADR-0011: Serialize special-service identities with one global coordinator

**Date:** 2026-08-04 · **Status:** Accepted

## Context

A special service is uniquely identified by its normalized `{date, service_name}` pair, but its
Sanity document `_rev` can serialize only writes to that one document. It cannot serialize two
creates, or a create and rename, when different documents concurrently claim the same normalized
identity. Special services deliberately have no weekend `roleTargetLock`.

## Decision

Use one deterministic internal document, `specialIdentityCoordinator.global` of type
`specialIdentityCoordinator`, as the shared mutex for special-service identity changes.
`app/utils/specialIdentityCoordinator.ts` plans its lazy first creation at version 1 with a fresh
nonce. Every later claim asserts the observed `_rev`, advances the version, and writes another fresh
nonce. The claim belongs in the same transaction as the special create or date/name change.

The document is loaded only through the published-perspective operational client. Malformed state
blocks identity writes instead of being repaired. Its schema is hidden and read-only, and the Studio
policy removes every create, update, and delete path. No migration pre-creates it.

## Rejected

Do not give each special service a weekend `roleTargetLock` or derive a lock from the requested
special identity. Two requests can begin from different document IDs and different old/new
identities; without a target-independent common assertion, create/create and create/rename races can
still each observe an empty destination and commit. Expanding weekend locks would also erase the
intentional distinction that weekend targets are date-addressed while specials retain their own
document identity.

## Consequences

All special identity changes contend on one document, which favors correctness over parallelism at
the app's current volume. A transaction conflict requires fresh occupancy/coordinator readback; the
business transaction is never blindly retried. After rollback, a lazily created coordinator is inert
and may remain in the dataset; deleting it is not a rollback step.
