# Service Readiness foundation — split index

Date: 2026-07-18

## Decision

The former single data-integrity plan combined three independently risky programs. It has been replaced by three bounded plans:

1. [A1 — canonical operational reads](./2026-07-18-service-readiness-canonical-reads.md)
2. [A2 — protected mutation integrity](./2026-07-18-service-readiness-mutation-integrity.md)
3. [A3 — isolated verification and release](./2026-07-18-service-readiness-verification-release.md)

The Service Readiness UI remains a separate fourth plan:

4. [Plan B — admin journey and UI](./2026-07-18-service-readiness-ui.md)

## Boundaries

- A1 owns canonical `published` reads, raw-draft inventory, validation/grouping, integrity summaries, and fail-closed read consumers.
- A2 owns locks, observed revisions, atomic writers, dependency refusal, side effects, cleanup, Studio protection, and executable scripts.
- A3 owns the isolated Sanity/Vercel verification environment and exact `feature -> preview -> main` artifact proof.
- Plan B owns the admin customer journey and visual/interaction redesign while consuming A1/A2 contracts.

No plan may reimplement another plan's helpers or silently absorb its scope during implementation. A contract change that crosses a boundary updates every affected plan and resets only those plans' approval streaks.

## Review gate

Each of A1, A2, A3, and Plan B must independently receive two consecutive cold `VERDICT: APPROVED` results on byte-for-byte unchanged text.

Approval of this index does not approve any implementation plan.

## Execution order

1. Approve A1, A2, and A3 independently.
2. Implement A1 and pass its read-only local gate.
3. With explicit authorization, execute A3 Phase 1 to provision the isolated dataset, credential, branch-scoped Vercel variables, and harmless deployed smoke test.
4. Implement A2, pass isolated transaction tests/local gates, and verify its deployed mutations through A3's unique verification deployment.
5. Promote the A1/A2 foundation to `preview` through A3 and complete read-only stable-dev QA.
6. Revalidate Plan B against the implemented A1/A2 contracts; update/re-review only if those contracts changed materially.
7. Implement Plan B, verify locally and through A3's isolated/stable-preview paths.
8. Promote the exact approved `preview` commit to `main` through A3.

## Current status

- A1: cold-approved `2/2`; SHA-256 `307edd8f1cb1de9d478fa8db7fe2604484de0164687c2627e75186761687e608`
- A2: cold-approved `2/2`; SHA-256 `5c6330100d0d304a22dcdc93d1ba99ffe0d80d4d2cce021d277f087c6ec8d7d7`
- A3: cold-approved `2/2`; SHA-256 `ebce154b1b625bb98af5af932013f6769f8bc3d1d4a4abadf0af18328ec5b301`
- Plan B: cold-approved `2/2`; SHA-256 `dec718ca1becb7db5d59d926e3887b42f4b81b487b341a3600d5dbf4a1141fbc`
- Implementation: not started
