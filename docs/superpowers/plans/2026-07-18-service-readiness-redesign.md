# Service Readiness redesign — split implementation program

Date: 2026-07-18

## Decision

The original combined plan mixed a visual/customer-journey redesign with canonical reads, mutation/concurrency enforcement, and release verification. It is split into four independently reviewable plans:

1. [A1 — canonical operational reads](./2026-07-18-service-readiness-canonical-reads.md)
2. [A2 — protected mutation integrity](./2026-07-18-service-readiness-mutation-integrity.md)
3. [A3 — isolated verification and release](./2026-07-18-service-readiness-verification-release.md)
4. [Plan B — admin journey and UI](./2026-07-18-service-readiness-ui.md)

The former Plan A path remains as a [split index](./2026-07-18-service-readiness-data-integrity.md) so existing references do not point at stale requirements.

## Dependency

A1 must be implemented before A2. A3's isolated environment must exist before A2 replaces writers. Plan B begins only after A1/A2 are implemented and verified through A3. Plan B consumes their read/mutation contracts and must not recreate integrity logic in client components.

## Review gate

Each of A1, A2, A3, and Plan B must independently receive two consecutive cold `VERDICT: APPROVED` results on byte-for-byte unchanged text under the `adversarial-plan-review` workflow.

Approval of one plan does not approve another. Any edit resets only the affected plan's streak unless it changes a cross-plan contract.

## Delivery sequence

1. Approve A1, A2, and A3 independently.
2. Implement A1.
3. Execute A3's authorized isolation preflight, then implement/verify A2.
4. Promote the foundation to `preview` through A3.
5. Revalidate and implement Plan B against the actual A1/A2 contracts.
6. Verify Plan B through A3 and promote it to `preview`.
7. Fast-forward `main` to the exact approved preview commit through A3.

## Current status

- The product decision remains confirmed: routine service date changes/deletions are blocked when setlist or proposal dependencies exist; resolution requires an explicit guarded cleanup/migration workflow.
- A1: cold-approved `2/2` on SHA-256 `307edd8f1cb1de9d478fa8db7fe2604484de0164687c2627e75186761687e608`.
- A2: cold-approved `2/2` on SHA-256 `5c6330100d0d304a22dcdc93d1ba99ffe0d80d4d2cce021d277f087c6ec8d7d7`.
- A3: cold-approved `2/2` on SHA-256 `ebce154b1b625bb98af5af932013f6769f8bc3d1d4a4abadf0af18328ec5b301`.
- Plan B: cold-approved `2/2` on SHA-256 `dec718ca1becb7db5d59d926e3887b42f4b81b487b341a3600d5dbf4a1141fbc`.
- Implementation: not started.

Any byte change to an approved plan invalidates only that plan's recorded streak unless the change alters a cross-plan contract.
