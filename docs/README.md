# OWT Backstage — Documentation Index

> **Audience:** engineers and AI agents working on `owt-kb-v1` (the "Backstage" app for
> the **Oasis Worship Team**). This folder is the deep reference. If you only read one
> thing first, read [`ARCHITECTURE.md`](ARCHITECTURE.md).

The **Oasis Worship Team (OWT) Backstage** app is an internal, Spanish-language tool for a
church worship ministry. It manages a **song library** (lyrics, chord charts, audio,
references), **weekly setlists**, **team role assignments** (who plays/sings each service),
**member availability**, **shared setlist proposals**, and an **OR-Tools scheduling solver**
that auto-generates a monthly roster. It ships as a web app (Vercel), an embedded Sanity
Studio, and native iOS/Android apps (Capacitor).

---

## Start here (in order)

| # | Doc | What it answers |
|---|-----|-----------------|
| 1 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | The big picture: stack, request lifecycle, directory map, rendering/caching model, the load-bearing invariants you must not break. |
| 2 | [`DATA_MODEL.md`](DATA_MODEL.md) | Every Sanity document/object type, all fields, references, the draft/publish gate, and GROQ conventions. |
| 3 | [`ROUTES.md`](ROUTES.md) | Every page route, server vs client, ISR settings, access control, data fetched. |
| 4 | [`API_REFERENCE.md`](API_REFERENCE.md) | Every `app/api` endpoint: method, auth, body, response, side effects (writes, email, push, revalidation). |
| 5 | [`AUTH_AND_SECURITY.md`](AUTH_AND_SECURITY.md) | NextAuth config, the role model, impersonation, the middleware gate, the 30s-TTL access cache, env vars, security headers. |
| 6 | [`UTILITIES_AND_COMPONENTS.md`](UTILITIES_AND_COMPONENTS.md) | The reusable `app/utils` helpers (don't reinvent these), the single React context, and the component inventory. |
| 7 | [`SOLVER_AND_INFRA.md`](SOLVER_AND_INFRA.md) | The Python OR-Tools solver, its DSL, Cloud Build CI/CD, the `scripts/` catalog, mobile/Capacitor, testing. |
| 8 | [`DEVELOPMENT.md`](DEVELOPMENT.md) | Setup, commands, the verification gate, branching/commit conventions, how to run data scripts safely, common tasks. |

Also in this repo root:
- [`../CLAUDE.md`](../CLAUDE.md) / [`../AGENTS.md`](../AGENTS.md) — the terse "don't-break-these" briefing (the same invariants, condensed). **Read one of these before touching code.**
- [`MOBILE.md`](MOBILE.md) — native iOS/Android setup & handoff runbook.
- [`superpowers/`](superpowers/) — dated design **specs** and **plans** for every shipped feature (the "why" behind each subsystem). Great for archaeology.

---

## The one-paragraph mental model

A **member** signs in (Google SSO or email/password); their identity is a Sanity
`teamMembers` doc. Admins build **services** (`sunday_role` / `saturday_role` /
`special_role`) that assign members to five kinds of **seats** and attach a **setlist**
(`featuredSongs` for Sunday, `saturdarSongs` for Saturday — note the deliberate typo).
Services start as **drafts** (`published: false`) visible only to managers; publishing
reveals them to members and fires **push + email** notifications. Leads can co-author a
**shared `setlistProposal`** per service; an admin approves it, which writes the real
setlist. The **solver** (`/api/admin/solve` → Python OR-Tools) proposes a whole month's
roster. Everything is **Spanish UI**, **dark-mode-first**, timezone **America/Mexico_City**.

---

## Golden rules (the short list — full detail in the docs above)

1. **Timezone is `America/Mexico_City`.** Render stored dates at **local noon**
   (`new Date(iso.slice(0,10)+"T12:00:00")`), never bare `new Date(iso)`. See [ARCHITECTURE](ARCHITECTURE.md#timezone--dates).
2. **`saturdarSongs` is a deliberate typo — never rename it.** Renaming orphans data.
3. **Five member-referencing seats** on every role doc — any "who serves?" query must cover
   all five via `assignedMemberRefsQuery()`. See [DATA_MODEL](DATA_MODEL.md#the-five-member-referencing-seats).
4. **Member-facing reads must filter `published != false`** (draft gating).
5. **Sanity array-of-object writes need a `_key` per item.**
6. **Mutating routes must revalidate** the ISR pages they affect (`revalidate*` utils).
7. **Client mutation handlers** must check `res.ok`, use try/catch/finally, and never
   close-as-success on failure.
8. **Production Sanity writes need explicit user consent** — dry-run scripts first.
9. **Both must pass before "done":** `npx tsc --noEmit` and `npm test`.
10. **No AI/Claude attribution in commits.** Conventional commits, direct push to `main`
    (via a working branch), no PRs.

---

## Fast lookup

- **"Where is X rendered?"** → [ROUTES.md](ROUTES.md)
- **"What does endpoint Y do / who can call it?"** → [API_REFERENCE.md](API_REFERENCE.md)
- **"What fields does a song / service have?"** → [DATA_MODEL.md](DATA_MODEL.md)
- **"Is there already a helper for this?"** → [UTILITIES_AND_COMPONENTS.md](UTILITIES_AND_COMPONENTS.md)
- **"How does login / impersonation work?"** → [AUTH_AND_SECURITY.md](AUTH_AND_SECURITY.md)
- **"How does the auto-scheduler work?"** → [SOLVER_AND_INFRA.md](SOLVER_AND_INFRA.md)
- **"How do I run/verify a change?"** → [DEVELOPMENT.md](DEVELOPMENT.md)
