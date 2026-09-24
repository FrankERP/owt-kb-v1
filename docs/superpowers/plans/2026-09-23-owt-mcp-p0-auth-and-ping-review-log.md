# Review log — `2026-09-23-owt-mcp-p0-auth-and-ping.md`

Written after the loop ended and never shown to any reviewer. **Approval is not
authorization to implement.**

## Result

**APPROVED at critical tier** — rounds 1 and 2, two sequential fresh reviewers, both
`APPROVED` on byte-identical digest
`8e52e91e92135bdfa70aaebf37fa0366a404d26d2190f6ebb2d9db8d4f44ce4b`, committed at
`289f3d03`. Changes made after that approval are listed below and are **un-reviewed**.

## Risk tier and why

**Critical**, derived from the ladder: the plan creates the app's first unauthenticated
endpoints and an auth/ACL/secret boundary (OAuth 2.1, token signing, revocation).

## Rounds

| Round | Digest | Verdict | Blockers | Streak |
|---|---|---|---|---|
| 1 | `8e52e91e` | **APPROVED** | 0 | 1 |
| 2 | `8e52e91e` | **APPROVED** | 0 | **2 — approved** |

Both reviewers verified the load-bearing premises against the code and live sources:
the consent page's sign-in round trip (NextAuth's middleware, its sign-in action and the
default `redirect` callback), `proxy.ts` running before `beforeFiles` rewrites, CSRF and
framing defences, `sanityConflictKind` for the replay signal, the Studio protection lists,
npm metadata for the pinned libraries, Anthropic's documented callback URI and Vercel's
Hobby rate-limit terms. Frank's go-ahead: "sí, commitea y lanza los reviews, cap de 15"
(shared with the P2 spec review).

## Non-blocking items

All adopted after approval (below). One is recorded as the plan's answer to a roadmap
row rather than a change: the roadmap's O3 verification ("filling the cap with junk never
displaces a consented registration") is moot under stateless registration, which stores
nothing and so has no cap to fill — step 6 says so.

## Process failures on the author's side

None surfaced by the loop. Round 2 did find a factual error the approval did not cover:
step 5 added `PUBLIC_ROUTES` entries before their route files existed, which would have
turned the suite red — fixed below.

## Post-approval changes — un-reviewed

1. Each `PUBLIC_ROUTES` entry lands with its route file (steps 6, 8, 9), not in step 5.
2. A test pins `next.config.mjs`'s `/.well-known/*` rewrites to exactly the discovery handlers.
3. Token verification pins HS256 and **requires** `typ`, `iss`, `exp`, and `aud` on access tokens.
4. The grant store is `server-only`; grants use a dotted, non-public `_id`; a missing grant is revoked.
5. The consent screen shows the full redirect URI.
6. The refresh grant binds the presented `client_id` to the grant's `clientHash`.
7. Both orderings of a concurrent refresh are stated (one revokes the grant, as O4 accepts).
8. Absent or unknown `scope` is accepted and ignored; the role is read from the live access record.
9. The WAF rule is created **before** the production merge; stop if Hobby's one rule is taken.
10. Refused redirect URIs on claude.ai / claude.com hosts are logged.
11. `MCP_DISABLED` gets a full `docs/SECRETS.md` entry; `docs/AUTH_AND_SECURITY.md` and
    `docs/DATA_MODEL.md` are updated; `CLAUDE.md` records the default-`redirect`-callback
    dependency, with a test that no custom callback exists.
12. The ADR notes the nested `jose@4` copy; the bundle-size delta is measured at step 1.
13. The dev smoke uses a small local script as the client.
14. Status line and terminal state record the approval.
