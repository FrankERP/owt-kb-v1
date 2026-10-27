# Multi-ministry — phase 1: invisible foundations (plan)

**Status:** PLANNED 2026-10-27 on Frank's «Dale» (23:20Z). ADR-0075. PR 1 (this file, the ADR, the
glossary) in review. The access slice (PRs 2 and 3) is a critical contract and has its own plan and
adversarial review: `2026-10-27-multi-ministry-phase1-access.md`.
**Requirement (Frank, 2026-10-26 20:26Z, verbatim):** «Puedes ayudarme a planear cómo convertiríamos
esto en una app que pueda servirle a varios ministerios sin agregar ruido entre sí? Algo como planning
center por ejemplo». Phase 1 of the Claude Doc «Backstage para varios ministerios»
(https://claude.ai/artifact/F1qn13J9ud8P3Urh6aF6th, tab «Fase 1: plan de trabajo»), whose decisions
Frank made on 2026-10-27 (third ministry = Pastores de jóvenes with three isolated groups; volunteers
choose combined or one-at-a-time; no cross-ministry load; worship keeps its documents; Oasis only, but
scalable). On how to build it, Frank (23:15Z): «Cómo crees que podemos manejarlo para no romper nada
de la app? Ya que esto seguro tomará un rato».
**Risk tier:** standard for this parent plan (docs, a read-only GROQ helper). The access slice is
critical and reviewed on its own.

---

## 1. What phase 1 delivers

At the end the app knows who is in Jóvenes, at which level and in which groups, and **nothing a
person sees changes**. Frank can register Noemí, Goma and Gaby as Jóvenes admins and the group
leaders (Otro Nivel: Jakey, Andy; Invencibles: Jakey, Andy; Emprendedores: Noemí, Hugo) from Miembros.
Jóvenes screens arrive in phase 3.

## 2. The PRs

| PR | What | Tier | Visible |
|---|---|---|---|
| 1 | ADR-0075 (amends ADR-0019), glossary in `CONTEXT.md`, this plan and the access plan with its review log | standard | nothing |
| 2 | Access model, read side: registry gains `jovenes` and its groups; `teamMembers.ministryRoles`; one pure access module; the two ministry guards rebuilt on it; an equivalence test against the old guards | **critical** | nothing |
| 3 | Access model, write side: the members POST/PATCH accept and validate `ministryRoles`; Miembros shows a Jóvenes block to the super-admin | **critical** | Frank only, in Miembros |
| 4 | `ministryAudienceFilter(ministry)` replaces `WORSHIP_AUDIENCE_GROQ_FILTER`, byte-identical for worship (asserted) | standard | nothing |

Order: 1 → 2 → 3, with the release rule of the access plan (PR 2 in **production** before PR 3
touches `preview`). PR 4 may go any time after 1.

### Changes against the Claude Doc's first draft (found reading the code, 2026-10-27)

- **The per-ministry daily mail quota moves to phase 3.** No daily cap exists today: the outbox
  bounds a sweep (`EMAIL_LIMIT` 40, `app/utils/outboxSweep.ts:76`), and only worship sends mail
  (Kids sends none). There is nothing to share until Jóvenes sends its Saturday roster.
- **The group coverage test moves to phase 3.** It checks every read of Jóvenes meetings filters by
  group; those documents do not exist yet. Phase 1's guard is the equivalence test (PR 2).
- **Notices do not gain a `ministry` field.** The Claude Doc's PR 4 said each outbox notice would
  record its ministry. A notice's `kind` already implies it (`role`, `setlist`, `leadNotes` are
  worship's; Jóvenes will add its own kinds in phase 3), so a stored field would be a second source of
  truth with no reader. PR 4 is the audience helper only.
- **Worship and Kids keep their permission fields** (`role`, `managesMinistries`):
  `requireActiveManager` is called from 35 files. ADR-0075 §Rejected.

## 3. PR 4 in detail (standard)

- `app/ministries.ts`: `ministryAudienceFilter(ministry: MinistryId): string`. For `worship` it
  returns exactly today's `WORSHIP_AUDIENCE_GROQ_FILTER` string; for any other ministry
  `("<id>" in ministries)` — a non-worship ministry has no legacy «absent» arm. `WORSHIP_AUDIENCE_GROQ_FILTER`
  stays exported as `ministryAudienceFilter("worship")` so its six importers do not move in this PR.
- Group narrowing is NOT added here: no group-scoped document exists yet, and a GROQ arm with no
  reader is untestable against real data. Phase 3 adds it with its first query.
- Test: the worship string is byte-identical to the literal it replaces; a `kids` filter never
  matches an absent `ministries`; an id outside the registry throws (no interpolation of unknown text).

## 4. How nothing breaks (Frank's question, 23:15Z)

1. **Small PRs that reach `main` dark**, never a long-lived branch: other threads (design, MCP) ship
   daily, and a branch of weeks would merge everything at once.
2. **Additive schema only**: new fields, never a rename or a removal. Old code ignores an unknown
   field, so a revert leaves no orphan data. One exception is named in the access plan (§6): a stored
   `"jovenes"` reads as worship under code that predates PR 2, which is why PR 2 reaches production
   first and why PR 2 is never reverted while anyone holds `"jovenes"`.
3. **Equivalence tests** freeze today's permissions for every existing shape of member.
4. **Switched on by data**: Jóvenes surfaces will show only to people with a Jóvenes membership; in
   phase 3 the registry entry carries a rollout state (hidden → super-admin → Jóvenes admins → all).
5. **Dev first, every time**: `scripts/dev-verify.ts` signs in as the Verificador bot as seeded (a
   worship admin who manages Kids) and checks its worship and Kids screens are unchanged. `preview`
   writes the real dataset, so phase 1 changes no person's data to test: a Kids-only and a
   Jóvenes-only member are proven by tests, and a dedicated Jóvenes bot (seeded with Frank's consent)
   arrives in phase 3, when there are Jóvenes screens.
6. **Worship is never migrated.**

## 5. Gate to phase 2

- [ ] The equivalence test is green: every existing member shape has exactly the permissions it had.
- [ ] On dev, Frank's account and the Verificador bot (worship, Kids manager) look as they do today.
- [ ] Tests prove a Jóvenes-only pastor sees nothing of worship (guards, worship pages, setlist
  audience, calendar feed 404).
- [ ] Frank registered the Jóvenes admins and leaders from production Miembros.

## 6. Open with Frank

- The list of Jóvenes pastors and whether they already sign in with Google (needed after PR 3).
- Whether Jóvenes' Gaby is worship's Gaby (then her `ministries` is `["worship","jovenes"]`).
- Days and times of each group's weekday calendar (phase 3; does not block the Saturday roster).
