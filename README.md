# OWT Backstage (`owt-kb-v1`)

Internal app for the **Oasis Worship Team** (Oasis church music ministry). A single source of
truth for the **song library**, **weekly setlists**, **team role assignments**, **member
availability**, **shared setlist proposals**, and an **OR-Tools auto-scheduler**. Spanish-language
UI, dark-mode-first, timezone **America/Mexico_City**. Ships as a web app (Vercel), an embedded
Sanity Studio, and native iOS/Android apps (Capacitor).

> **New here — human or AI agent? Read [`docs/`](docs/README.md) first.** It is the complete,
> AI-agent-ready reference. Also read [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) for the
> terse list of load-bearing invariants before touching code.

---

## Stack

Next.js 16 (App Router; `proxy.ts` = middleware) · React 19 · Sanity v5 (`next-sanity`) ·
Tailwind · NextAuth v4 · Fuse.js · Node 22 · Python OR-Tools solver (Google Cloud Function) ·
Capacitor 8. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick start

```bash
nvm use            # Node 22 (from .nvmrc)
npm install
# create .env.local (see docs/AUTH_AND_SECURITY.md#environment-variables)
npm run dev        # http://localhost:3000
```

The whole app is behind a login gate; sign in with Google SSO (your email must exist as a
`teamMembers` doc in Sanity) or email/password. The embedded Sanity Studio is at `/studio`
(admin+ only).

## The "done" gate

Before claiming any change is complete, **both must pass**:

```bash
npx tsc --noEmit
npm test
```

## Documentation map

| Doc | Contents |
|-----|----------|
| [docs/README.md](docs/README.md) | Documentation index + the golden rules. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, request lifecycle, rendering/caching, invariants, diagrams. |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Every Sanity type, fields, references, draft/publish gating. |
| [docs/ROUTES.md](docs/ROUTES.md) | Page routes, rendering, access control. |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Every `app/api` endpoint. |
| [docs/AUTH_AND_SECURITY.md](docs/AUTH_AND_SECURITY.md) | Auth, roles, impersonation, middleware, env vars, headers. |
| [docs/UTILITIES_AND_COMPONENTS.md](docs/UTILITIES_AND_COMPONENTS.md) | Reusable helpers, context, component inventory. |
| [docs/SOLVER_AND_INFRA.md](docs/SOLVER_AND_INFRA.md) | OR-Tools solver, CI/CD, scripts, mobile, testing. |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, commands, conventions, data scripts, common tasks. |
| [docs/MOBILE.md](docs/MOBILE.md) | iOS/Android (Capacitor) setup & handoff. |
| [docs/superpowers/](docs/superpowers/) | Dated design specs + plans for every shipped feature. |

## The five things most likely to bite you

1. **Timezone = America/Mexico_City.** Render dates at local noon
   (`new Date(iso.slice(0,10)+"T12:00:00")`), never bare `new Date(iso)`.
2. **`saturdarSongs` is a deliberate typo — never rename it** (Sunday setlist = `featuredSongs`).
3. **Five member-referencing seats** per role doc — use `assignedMemberRefsQuery()`.
4. **Member-facing reads filter `published != false`**; setlists gate via `publishedSetlist()`.
5. **Mutations must revalidate** their ISR pages, and **array-of-object writes need a `_key`**.

Full list in [docs/ARCHITECTURE.md §11](docs/ARCHITECTURE.md#11-the-load-bearing-invariants-do-not-break).

## Conventions

Work on a branch, merge to `main` periodically (direct push, **no PRs**). Conventional commits;
the body explains the *why*. **Never** add AI/Claude attribution. Production Sanity writes need
explicit user consent (dry-run scripts first). See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
